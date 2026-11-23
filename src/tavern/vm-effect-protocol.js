import { formulaReference, formulaFunctionReference } from '../core/formula.js';
import { opNotes, vmHooks, vmSchema } from '../core/vm-schema.js';

const defs = vmSchema.$defs;
const range = schema => [
  schema.minimum === undefined ? '' : `≥${schema.minimum}`,
  schema.maximum === undefined ? '' : `≤${schema.maximum}`,
  schema.exclusiveMinimum === undefined ? '' : `>${schema.exclusiveMinimum}`,
].filter(Boolean).join(' ');

function describe(schema) {
  if (schema.format === 'tactical-expr') return 'Expr 字符串';
  if (schema.format === 'tactical-status-id') return '已定义状态 ID';
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    return name === 'expireRule' ? `{${fields(defs.expireRule)}}` : name;
  }
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map(describe).join(' 或 ');
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.join(' / ');
  if (schema.type === 'array') return `数组<${describe(schema.items)}>${schema.minItems > 0 ? `（至少 ${schema.minItems} 项）` : ''}`;
  if (schema.properties) return `{${fields(schema)}}`;
  if (schema.type === 'object' && schema.propertyNames) return `ID → ${describe(schema.additionalProperties)} 的对象`;
  if (schema.pattern) return `字符串（${schema.pattern}）`;
  return [schema.type, range(schema)].filter(Boolean).join(' ');
}

function fields(schema, omit = []) {
  return Object.entries(schema.properties).filter(([key]) => !omit.includes(key))
    .map(([key, value]) => `${key}${schema.required?.includes(key) ? '' : '?'}: ${describe(value)}`).join('，');
}

const instructions = defs.opcode.oneOf.map(schema => {
  const op = schema.properties.op.const;
  return `• ${op}：${opNotes[op]} {${fields(schema, ['op', 'enabled', 'label'])}}`;
});
const eventPatches = Object.entries(defs).filter(([key]) => key.startsWith('patch_'))
  .map(([key, schema]) => `• ${key.slice('patch_'.length)}：{${fields(schema)}}`);
const spawnSpecs = Object.entries(defs).filter(([key]) => key.startsWith('spawn_'))
  .map(([key, schema]) => `• ${key.slice('spawn_'.length)}：{${fields(schema)}}`);

export const VM_EFFECT_PROTOCOL = `【战术 VM 效果协议】
rules 是规则数组。规则：{${fields(defs.rule, ['hook'])}，hook: 以下枚举}。
允许 hook 枚举：${vmHooks.join(' / ')}。
标识符格式：规则／模板／变量 ID 匹配 ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$；tag 匹配 ^[a-z0-9][a-z0-9_-]{0,31}$；状态与载体顶层 flags 枚举为 undispellable / concept_immune。

【全局事件管线与载体作用域】
• 单次行动结算序：before_action（扣费缩放、取消行动、改写起点与无视视线）→ before_target（取消指向、重定向或替换目标、伤害倍率缩放）→ before_check（改 DC/加值/优劣势、无视闪避、保底评级、强制判定结果）→ after_natural_roll（自然 d20 出骰后读 event.naturalRoll 并可用 replaceNaturalRoll 改骰）→ after_check → [模板主击/治疗 或 hook:"active" 规则执行] → before_commit（在 damage/heal/resource 实际落盘前统一拦截，通过 event.commitKind 区分类型，可读 event.targetId/pool/rawAmount/finalAmount/sourceRuleId，支持 cancel/finalAmount/preserveLife）→ [HP 归零时：先跑 on_lethal_p1 处理遗言或换池 → 仍 ≤0 再跑 on_lethal_p2 处理 preventDeath 免死锁血 → 仍 ≤0 才结算 on_death / on_ally_death / on_kill] → after_damage / after_heal → after_hit → after_action。
• 独立生命周期钩子：after_move（实际位移或高度变化后触发，attacker/target 指移动单位，可读 event.fromX/fromY/toX/toY/steps/moveKind）；before_status / after_status_applied / after_status_removed / on_status_immunized（状态拦截、施加、移除、被免疫）；on_summon_evict（同源旧召唤物被顶替消散前，target 为旧召唤物，event.sourceSkillId 为其来源技能）；turn_start / turn_end（单位回合首尾）；round_start / round_end（大轮首尾）。任意钩子均可使用 ask 挂起等待选择。
• 五类载体作用域矩阵：
  1. unit / item：self 为持有者（装备规则内 item.id / item.templateId 指向当前装备实例与模板），持有或穿戴期间 mods 与非 active 规则全局常驻。
  2. skill：self 为持有者，skill.id 为本技能自身 ID。hook:"active" 仅在主动施放本技能时按序执行；其余所有非 active 钩子与 mods 在单位持有该技能期间全局常驻监听全场！若某条非 active 规则仅在施放本技能时生效，filter 必须包含 event.skillId == skill.id（普通行动／命中／伤害事件一律读 event.skillId，勿用仅属召唤物顶替事件的 event.sourceSkillId）。单次主动施放内的顺序因果链（如造成伤害后按实扣量回血／回能／二段判定）应直接写在 hook:"active" 内用 out 变量串联，无需拆成常驻事件钩子。
  3. status：self 为状态携带者，source 为施加者，status 为当前状态实例。
  4. zone：区域自身可挂 tags / vars / mods / rules；在区域内的单位钩子（如 turn_start）中 self 为处于区域内的单位，source 为区域创建者；其他规则可用 in_zone(unit, tagOrId) 查询。
• 同一载体内规则 ID 唯一。规则按 priority 从高到低执行，program 按数组顺序执行；filter 求值为 true 才进入规则。

【Opcode】每个指令对象必填 op（闭合枚举，只接受列出的字段，? 表示可省）：
${instructions.join('\n')}
check：kind 为 chance 时用 dc 与 d100 比较（如 dc:25 为 25%）；豁免未通过进入 onFail；状态豁免写 kind:"save" 与 statusId:"已声明状态ID"（检定钩子与 mods 可读 event.statusId）。ask：kind 为 cell/entity 时必填 select，option 必填 options，number 必填 min/max；必填 aiPolicy 供 AI 与预览自动决策。damage / heal / resource / check / ask / spawn 均支持 out:"裸变量名"（remove_status 用 outCount:"裸变量名"）将本次实际结算值或实体引用写入当前帧，后续指令通过 vars.<变量名> 读取。perform：actionKind 为 skill 时只配 skillId，replay 时只配 tapeRecord（磁带重放默认免槽免耗并跳过已失效目标，子行动不再入带）。resource：mode 为 add/sub/set 时需 amount，swap 时需单个 pool 与 otherPool；pool 支持内置池 hp/mp/sp、自定义池 ID 或行动伪池 attack/action/move（本回合剩余攻击槽、动作槽、移动格）；mode 为 add_max/sub_max/set_max 时修改 HP/MP/SP 上限并同步当前值与 initialMax 镜像，minRemain 限制最低上限。move：mode 为 step/teleport 时用 to，push/pull 用 distance，altitude 用 deltaZ 或 land:true。mods:[{locks:["fly","teleport"]}] 禁止升空与瞬移（已在空中需另用 land:true 强制降落）。不可驱散写在状态模板顶层 flags:["undispellable"]。despawn：entityKind:"unit" 用于移除召唤物且不计击杀。
mutate_event 的 patch 至少含一个字段，仅限下列可写 hook（before_check.minRating 取值枚举：超暴击 / 强暴击 / 平暴击 / 有效 / 勉强 / 擦伤 / 失手）：
${eventPatches.join('\n')}
清除敌方区域时 where 可写 "zone.team != null && zone.team != self.team"（zone.team / candidate.team 读创建阵营，zone.sourceId / candidate.sourceId 读创建者 ID）。spawn 的 spec 由 entityKind 决定；unit 的 templateId/copyOf/spawnPanel 至多选一，均省略时按施术者预算自动生成面板；tier、count、remainingTurns、area.radius 支持数值表达式；terrain 至少含 kind 或 height，填 mode 时必填 height：
${spawnSpecs.join('\n')}
召唤物 sourceSkillId 由引擎只读记录生成它的技能 ID（含装备虚拟技能 equip:<实例ID>:<规则ID>），可通过 self/target/candidate/vars.<实体>.sourceSkillId 读取。
zoneArea：${describe(defs.spawn_zone.properties.area)}。single 仅中心格；rect 必填 rect 对象；cells 必填 cells 数组。

【表达式与选择器】
Expr 为 JSON 数字、布尔值或安全表达式字符串。字符串字面量支持单双引号，空值用 null，支持 + - !、算术、比较、&&、||、?: 三元与括号。严格使用注册变量与函数签名，无数组字面量或任意属性路径。
let.name、bind、out、outCount 定义时写裸名称，读取时一律加 vars. 前缀（scope:"owner" 写入宿主变量，用 self.vars.<名> 读取）。实体引用可直接作 target:"vars.<名>"、读字段 vars.<名>.hp 或传入查询函数。
变量：${formulaReference}。
函数签名：${formulaFunctionReference}。count_units 的条件可直接写布尔表达式或字符串字面量（JSON 字符串内双引号需转义）。
selector：${describe(defs.selector)}。
• 集合全集语义：from:"units" 默认包含全场存活者、阵亡尸体、友军与 self 自身，不会自动过滤敌我或生死！必须在 where 中按原描述显式组合 candidate.alive、candidate.team（blue/red，比较 self.team）与 candidate.id != self.id。of 仅用于 from:"statuses"；statuses 候选可读 candidate.id/category/tier/stacks/remainingTurns；zones 候选可读 candidate.id/team/sourceId；tape 候选按时间序保留记录，可读 candidate.round/turn/actorId/team/actionType/skillId；options 传入候选 ID 字符串数组配合 pick:{random:N} 做确定性不放回抽样，for_each 以 bind 取出所选 ID 赋给 statusId:"vars.<名>" 或 skillId:"vars.<名>"。
• 几何与尺度：area.origin 或 area.center 指定中心（缺省为 self）；词条相对档位距离／半径用 scale_cells(n)，明确米数用 cells_m(meters)。
pointRef：可写 {x,y,z?}、作用域枚举 self / source / target / attacker / center 或 vars.<名称>。
targetRef：${describe(defs.targetRef)}。特定快照实体可用选择器 {"from":"units","where":"candidate.id == '<快照ID>'"}。

【声明式修饰 mods】
mods 数组每项：${describe(defs.statMod)}。至少含 stat、locks、flags 或 controlPolicy 之一；数值修饰必指定 stat。计算公式为 (基值 + flat 之和) × (1 + additivePercent 之和) × mult 连乘；when 求值为 true 时生效；checkKind 可限定检定类别（attack / save / contest / skill / chance / d20 / dodge / authority 或状态 ID／标签）。
• 输出侧（持有者进攻）：damageFlat 固定加伤（基值 0，用 flat）；damageMult 输出倍率、finalDamageMult 最终伤害倍率（基值 1，用 mult 或 additivePercent，禁用 flat）；armorPierce 固定穿甲（用 flat）；armorPiercePercent 百分比穿甲（基值 0，用 flat:-1..1，禁用 additivePercent）。
• 承伤侧（持有者受击）：damageReductionFlat 受击固定减伤（基值 0，用正数 flat，勿写成负 damageFlat）；damageReduction 与 dr 受击比例减伤（基值 0，用 flat:-1..1，禁用 additivePercent；damageReduction 在固减前乘算，dr 在固减后乘算；真实伤害无视减伤）。
• 机动与距离：movement 用 flat 写同阶移动增减（引擎自动折算战场格数）；incomingDistanceOffset 用 flat 写敌方测算射程、范围与距离档位时的表观距离增量（可用 scale_cells(n)）。
• 检定与属性：dodge 受击闪避（基值 0，用正数 flat 扣敌方命中）、checkBonus 检定加值、dcBonus 豁免难度加值（挂施加者）、resistBonus 豁免抵抗加值（挂豁免者）、advantage 优劣势骰数、initiativeFlat 先手加值，基值均为 0，用 flat；healingMult / incomingHealMult / costMult 基值均为 1，用 mult 或 additivePercent（禁用 flat）；str/agi/con/int/spi/armor 叠加持有者对应面板值。
controlPolicy：${describe(defs.controlPolicy)}。moraleLock 仅枚举值 "steady"；allowFriendlyTarget:true 允许敌方指向动作合法选中友军或自身。`;
