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
  if (schema.$ref) return schema.$ref.split('/').at(-1);
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
允许 hook：${vmHooks.join(' / ')}。
选时机：active 主动施放；before_action 行动执行前扣费与取消控制；before_target 目标确定后重定向；before_check / after_check 检定前改判与检定后读结果；after_hit 命中后；after_damage / after_heal 实际伤害／治疗后；after_action 行动完成。
生命周期：before_status 施加状态前拦截；after_status_applied / after_status_removed 状态施加／移除后；on_status_immunized 状态被免疫；on_summon_evict 同源旧召唤物被替换、消散前（target 为旧召唤物）；on_lethal_p1 濒死先处理遗言，生命仍归零才进入 on_lethal_p2 处理免死等拦截；on_death / on_ally_death / on_kill 倒下／友方倒下／击杀；turn_start / turn_end 单位回合首尾；round_start / round_end 整轮首尾。
before_commit 在 damage、heal、resource 提交前触发，区分 event.commitKind，读取 event.targetId、event.pool、event.sourceRuleId，可用 cancel 或 finalAmount 改写本笔提交。
同一载体内规则 ID 唯一。规则由高 priority 到低 priority 执行；program 按数组顺序执行。filter 必须求得 true 才进入规则。规则和指令均可写 enabled:false 暂停执行，label 为显示名。只有与事件相符的载体会触发规则；用 filter 区分事件的施放者或承受者，例如 "attacker.id == self.id"。

【Opcode】每个指令对象必填 op，其值是下列名称。? 表示可省，闭合对象只接受列出的字段。
${instructions.join('\n')}
check 的 kind:chance 用 dc 与 d100 点数比较，例如 dc:25 表示 25% 成功率。豁免未通过时运行 onFail。状态豁免用 kind:"save"、statusId:"已声明状态ID"；检定钩子可读取 event.statusId。ask 的 kind 为 cell/entity 时必填 select，为 option 时必填 options，为 number 时必填 min/max。perform 的 skill 只配 skillId，replay 只配 tapeRecord。resource 的 add/sub/set 需要 amount，swap 需要一个 pool 和 otherPool；pool 可写 hp/mp/sp，或伪池 attack/action/move（本回合剩余攻击槽、动作槽、移动格），也支持 add_max/sub_max/set_max 修改 HP/MP/SP 上限并自动同步当前值与 initialMax 镜像；minRemain 可限制最大值下限。move 的 step/teleport 用 to，push/pull 用 distance，altitude 用 deltaZ 或 land:true。mods:[{locks:["fly","teleport"]}] 禁升空/瞬移，已在空中须另用 land:true 强制落地；锁不阻止降落。不可驱散写在状态模板顶层 flags:["undispellable"]，而不是持有者的 mods.flags；到期仍会自然结束。despawn 的 entityKind:"unit" 只移除召唤物，不计击杀。
mutate_event 的 patch 必须至少有一个字段，只能用于下列可写 hook，嵌套分支亦然：
${eventPatches.join('\n')}
清除敌方区域用 {"op":"despawn","entityKind":"zone","select":{"from":"zones","where":"zone.team != null && zone.team != self.team"}}。zone.team 和 candidate.team 读取创建时的阵营；zone.sourceId 和 candidate.sourceId 读取创建者 ID。若需限定范围，用 select.area 筛选区域覆盖格。spawn 的 spec 由 entityKind 决定，unit 的 templateId/copyOf/spawnPanel 至多选一个；都不写时按施术者预算自动生成面板。生成规格中的 tier、count、remainingTurns、area.radius 可写数值表达式，例如 tier:"max(1, self.tier - 1)"。terrain 至少有 kind 或 height，提供 mode 时必须有 height：
${spawnSpecs.join('\n')}
zoneArea：${describe(defs.spawn_zone.properties.area)}。single 只覆盖中心格；rect 需 rect 对象，cells 需 cells 数组。

【表达式与选择】
Expr 为 JSON 数字、布尔值或安全表达式字符串。表达式内支持单双引号字面量和 null，例如 "event.damageType == 'physical'"、"self.vars.cooldown == null"。支持 + - !、算术、比较、&&、||、三元与括号。变量和查询严格使用注册表，不支持任意属性路径或副作用函数。
let.name、bind、out、outCount 写裸名称；读取一律带作用域，例如 vars.lostStacks，不能裸写 lostStacks。实体绑定可作为 target:"vars.victim"、通过 vars.victim.id 读字段，或传给 has_status(vars.victim, 'taunt')。
变量：${formulaReference}。
函数签名：${formulaFunctionReference}。count_units 的 predicate 可直接写 candidate.team != self.team，也可传表达式文本，如 count_units("candidate.id == 'p1'")；整条表达式放进 JSON 字符串时按 JSON 规则转义内部双引号。
selector：${describe(defs.selector)}。of 只用于 statuses；where 逐个检查 candidate。statuses 行可读 candidate.id/category/stacks/remainingTurns；tape 行可读 candidate.round/turn/actorId/team/actionType/skillId，保留记录顺序。random 使用战局 RNG。area.origin 省略时以 self 为中心。
pointRef 可写 {x,y,z?}、self/source/target/attacker/center 或 vars.<名称>（格子或实体位置）。
targetRef：${describe(defs.targetRef)}。for_each.bind 或 ask(kind:entity) 取得的实体直接用 vars.<名称>。用选择器指定 ID 时，可用 {"from":"units","where":"candidate.id == 'p1'"}，并将 p1 替换为快照 ID。

【声明式修饰】
mods 是修饰数组，每项 ${describe(defs.statMod)}。至少有 stat、locks、flags 或 controlPolicy；填写数值修饰时必须指定 stat。组合值为 (基础 + flat 总和) × (1 + additivePercent 总和) × mult 连乘。when 必须求得 true 才生效。
• 输出方（自己打别人）：damageFlat 输出固定加伤，基值 0，用 flat；damageMult 输出倍率、finalDamageMult 最终伤害倍率，基值 1，用 mult:1.3 或 additivePercent:0.3 表示 +30%；armorPierce 固定穿甲，基值为已有穿甲，用 flat；armorPiercePercent 百分比穿甲，基值 0（武器姿态可自带穿甲），用 flat:0.2 表示 +20%。
• 承伤方（自己挨打）：damageReductionFlat 受击固定减伤，基值 0，用正数 flat:800（不要写成负的 damageFlat）；damageReduction / dr 受击百分比减伤，基值 0，用 flat:0.3 表示 +30%。damageReduction 先算，dr 在固定减伤之后另乘；真实伤害无视这些减伤。
• 闪避：在受击方写 {"stat":"dodge","flat":4}，普通攻击检定扣除 4 点命中。闪避、豁免难度与抵抗加值基值均为 0，用 flat。check.statusId 会透传到 event.statusId，例如 mods: [{"stat":"dcBonus","flat":10,"when":"event.statusId == 'freeze'"},{"stat":"resistBonus","flat":10,"when":"event.statusId == 'freeze'"}]；前者读取施加者，后者读取豁免者。
• 其余：healingMult 施疗倍率、incomingHealMult 受疗倍率、costMult 技能消耗倍率，基值 1，用 mult（如技能资源消耗 -30% 写 mult:0.7）；checkBonus 检定加值、dcBonus 难度加值、resistBonus 豁免加值、advantage 优势、initiativeFlat 先手加值，基值 0（initiativeFlat 叠加已有先手加值），用 flat；str/agi/con/int/spi/armor 叠加所在载体持有者的已有属性／护甲值。
• 比例型 damageReduction、dr、armorPiercePercent 不允许 additivePercent；flat 数字必须在 -1..1，负数表示降低该比例。倍率型 damageMult、finalDamageMult、healingMult、incomingHealMult、costMult 不允许 flat。
controlPolicy：${describe(defs.controlPolicy)}。恒定坚守用 moraleLock:"steady"；allowFriendlyTarget:true 允许原本指定 enemy 的攻击选择友军或自己，仍受射程与其他合法性约束。`;
