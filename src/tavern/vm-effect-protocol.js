import { formulaReference, formulaFunctionReference } from '../core/formula.js';
import { askPolicies, flatOnlyStats, opNotes, vmHooks, vmSchema } from '../core/vm-schema.js';

const defs = vmSchema.$defs;
const statusFlags = defs.spawn_zone.properties.flags.items.enum;
const range = schema => [
  schema.minimum === undefined ? '' : `≥${schema.minimum}`,
  schema.maximum === undefined ? '' : `≤${schema.maximum}`,
  schema.exclusiveMinimum === undefined ? '' : `>${schema.exclusiveMinimum}`,
].filter(Boolean).join(' ');

function describe(schema) {
  if (schema.format === 'tactical-expr') return 'Expr 字符串';
  if (schema.format === 'tactical-status-id') return '已定义状态 ID';
  if (schema.format === 'tactical-damage-type') return 'physical / energy / mental / true / fire / cold / lightning / thunder / acid / poison / necrotic / radiant / force / psychic 或已登记 customElements ID';
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
标识符格式：规则／模板／变量 ID 匹配 ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$；tag 匹配 ^[a-z0-9][a-z0-9_-]{0,31}$；状态与载体顶层 flags 枚举为 ${statusFlags.join(' / ')}。伤害类型共 14 项：physical(物理)、energy(能量)、mental(精神)、true(真实)、fire(火焰)、cold(冰霜)、lightning(雷电)、thunder(雷鸣)、acid(酸蚀)、poison(毒素)、necrotic(暗蚀)、radiant(光耀)、force(力场)、psychic(心灵)，或使用已登记 customElements ID。

【全局事件管线与载体作用域】
• 单次行动结算序：before_action（扣费缩放、取消行动、改写生效起点 origin 与无视视线 ignoreLOS；期间若改变持有者 controlPolicy.intentLock 会自动触发重规划并刷新 event.intent）→ before_target（取消指向、redirectTarget 覆写为单一目标或 replaceTarget:{from,to} 单点替身承伤并保留其余范围目标、伤害倍率缩放；可读 event.backX/event.backY 获取主目标相对自身朝向的背后一格坐标）→ before_check（改 DC/加值/优劣势、无视闪避、保底评级、强制判定结果，可读 event.stat 区分 str/agi/con/int/spi 检定属性）→ after_natural_roll（自然 d20 出骰后读 event.naturalRoll 并可用 replaceNaturalRoll 改骰）→ after_check → [模板主击/治疗 或 hook:"active" 规则执行] → before_commit（在 damage/heal/resource 实际落盘前统一拦截，通过 event.commitKind 区分类型，可读 event.targetId/pool/finalAmount/sourceRuleId/critical/ratingMultiplier，支持 ask 交互截取并改写 cancel/finalAmount/preserveLife）→ [HP 归零时：先跑 on_lethal_p1 处理遗言、治疗或换池 → 仍 ≤0 再跑 on_lethal_p2 处理 heal 治疗或 preventDeath 免死锁血（on_lethal_p1 与 on_lethal_p2 均可直接读取 event.rawAmount/finalAmount/dealt/absorbed/overkill 获取本次致死伤害量，如按致死伤害恢复法力或反伤！） → 仍 ≤0 才结算 on_death / on_ally_death / on_kill] → after_damage / after_heal → after_hit → after_action。
• event.intent 单字段收敛与安全边界：仅敌对打击链挂载字符串枚举 event.intent（normal / function / core / kill / concept；范围与非敌对行动归并为 'normal'）。检定前及检定中（before_action / before_target / before_check / after_natural_roll / intentBonus 与 intentDifficulty 求值）为声明意图；一旦意图检定失败（含低目标两阶强制失败、concept_immune 位格拦截或对抗未过），该受击分支在 after_check / prepareDamage / before_commit / after_damage / on_lethal_* / on_death / on_kill / after_hit 中自动回退为 'normal'（故写 when:"event.intent != 'normal'" 或 event.intent == 'core' 在检定后天然仅在意图实际成立时生效，无需额外成功字段）。位移、回合首尾、纯状态及独立周期结算等非打击事件不挂载 intent（undefined，三值逻辑下 event.intent != 'normal' 与 == 'normal' 均返回 null 安全不误判，判无意图用 event.intent == null）；同主语透传保证仅行动发起者自身的追伤继承生效 intent，受击方在 after_damage 中的反伤绝不继承攻方意图。
• 独立生命周期钩子：after_move（实际位移或高度变化后触发，attacker/target 指移动单位，可读 event.fromX/fromY/toX/toY）；before_status / after_status_applied / after_status_removed / on_status_immunized（状态拦截、施加、移除、被免疫，可读 event.statusId；注意状态规则内 status.* 指向当前宿主状态自身而非待施加状态）；on_summon_evict（同源旧召唤物被顶替或到期消散前触发，target 为旧召唤物，source 与 attacker 为召唤者，event.sourceSkillId 为生成该旧召唤物的召唤技能 ID——全局被动监听己方召唤物消散时检 source.id == self.id 或 target.summoned && target.team == self.team，注意 target/self 无 .sourceId 字段，且切勿与被动技能自身 skill.id 比较！）；turn_start / turn_end（单位回合首尾）；round_start / round_end（大轮首尾）。任意钩子均可使用 ask 挂起等待选择。
• 五类载体作用域矩阵：
  1. unit / item：self 为持有者（装备规则与修饰内 item.id / item.templateId 指向当前装备实例与模板），持有期间（含主副手、防具饰品及背包备用武器 bagWeapons）mods 与非 active 规则全局常驻监听全场所有单位事件！因此：① 全场广播钩子主语强制隔离：在进攻／命中／击杀钩子（before_check / after_hit / after_damage / on_kill 等）中，“持有者发起”必写 attacker.id == self.id；在**受击、结算拦截、状态拦截及濒死／死亡钩子（before_check / before_commit / before_status / after_damage / on_lethal_p1 / on_lethal_p2 / on_death）**中，“持有者自身受击／濒死／阵亡”**必须显式写 filter:"target.id == self.id"**（绝不可留 filter:null，否则场上任何敌友濒死或受击都会误触发持有者自身被动！）；② 仅在**武器模板（kind:"weapon"）**限定“使用本把武器普攻／命中／造成伤害”时，才写 event.weaponTemplateId == item.templateId（防具、头饰、靴子、箭袋、饰品等非武器装备的 item.templateId 永远不等于当前进攻武器 event.weaponTemplateId，严禁在非武器装备上写 event.weaponTemplateId == item.templateId！）；③ 注意致死帧（on_lethal_p1/p2、on_death、on_kill、on_ally_death）不携带 event.weaponTemplateId 与 event.skillId（二者在致死帧中恒为 null！）：不限武器／技能的角色全局击杀才用 on_kill，而**限定特定武器或特定技能击杀触发**必须在 after_damage 中写 attacker.id == self.id && !target.alive && event.dealt > 0 并配来源过滤（武器含斩杀补刀规则时写 (event.weaponTemplateId == item.templateId || event.sourceRuleId == '<本斩杀规则ID>')，技能写 event.skillId == skill.id）；④ 仅对远程攻击（含防具／箭袋／饰品上的远程加成与命中附效）生效必写 !event.melee（近战为 true、远程为 false，无 weapon.ranged 字段）。
  2. skill：self 为持有者，skill.id 为本技能自身 ID。hook:"active" 仅在主动施放本技能时按序执行；其余所有非 active 钩子与 mods 在单位持有该技能期间全局常驻监听全场！若某条非 active 规则仅在施放本技能时生效，filter 必须包含 event.skillId == skill.id（普通行动／命中／伤害事件一律读 event.skillId，勿用仅属召唤物顶替事件的 event.sourceSkillId）。单次主动施放内的顺序因果链（如造成伤害后按实扣量回血／回能／二段判定）应直接写在 hook:"active" 内用 out 变量串联，无需拆成常驻事件钩子。
  3. status：self 为状态携带者，source 为施加者，status 为当前状态实例。
  4. zone：区域自身可挂 tags / vars / mods / rules；对处于 zone.area（含可选 z1..z2 海拔层）内的存活单位生效，单位级钩子（如 turn_start / turn_end / after_move / before_check）与 mods.when 中 self 恒为处于区域内的受影响单位；注意初始战场环境区域（sourceId 为 null）无创建者单位，此时 source 会回退为 self 或事件源，故初始战场区域限定阵营**必须写字面量比较 self.team == 'blue' 或 self.team == 'red'，绝对禁止写 self.team != source.team**（仅由技能动态 spawn 且有施法者的区域才可读 source.team）；当区域同时覆盖攻守双方（尤指 board 全场区域）时同一事件会对区域内每名参与者分别求值，故在区域内监听进攻／施放钩子（before_action / before_target / before_check / after_hit / after_damage）须配 attacker.id == self.id，监听受击／结算拦截（before_commit / after_damage / before_status）仍须配 target.id == self.id 以锁定触发主体；其他规则可用 in_zone(unit, zoneIdOrTag) 按区域 id、templateId 或 tags 查询。
• shareRulesTo 将作用域共享给选择器得到的单位。使用纯选择器，pick 只接受 all、{first:N} 或 {nearest:N}，不接受 random。
• 同一载体内规则 ID 唯一。规则按 priority 从高到低执行，program 按数组顺序执行；filter 求值为 true 才进入规则。

【Opcode】每个指令对象必填 op（闭合枚举，只接受列出的字段，? 表示可省）：
${instructions.join('\n')}
ask 的 kind 与 aiPolicy 对应关系：${Object.entries(askPolicies).map(([kind, policies]) => `${kind} → ${policies.join(' / ')}`).join('；')}。
check：kind 为 chance 时用 dc 与 d100 比较（如 dc:25 为 25%）；豁免未通过进入 onFail；状态豁免写 kind:"save" 与 statusId:"已声明状态ID"（检定钩子与 mods 可读 event.statusId；注意 check(kind:"save") 默认由当前帧 target 掷骰，若在受击方钩子内要求进攻方豁免，先用省略 bind 的 for_each(select:{from:"attacker"}) 将子帧 target 切至进攻方）。ask：kind 为 cell/entity 时必填 select，option 必填 options，number 必填 min/max；必填 aiPolicy 供 AI 与预览自动决策。damage / heal / resource / check / ask / spawn 均支持 out:"裸变量名"（remove_status 用 outCount:"裸变量名"）将本次实际结算值或实体引用写入当前帧，后续指令通过 vars.<变量名> 读取（注意 spawn 在 count > 1 时 out 仅存首个生成实体 ID；需对同批全体新召唤物追加动作时，后续用 from:"units" 配 candidate.summoned && candidate.sourceId == self.id 筛选遍历——注意 .sourceId 仅在 candidate 与 zone 上注册，target/self 无 .sourceId，且查标签必须调函数 has_tag(candidate, '<tag>') 而不可读 candidate.tags！）。perform：actionKind 为 skill 时只配 skillId，replay 时只配 tapeRecord（配合 from:"tape" 筛选本回合或指定单位已执行记录，磁带重放默认免槽免耗并跳过已失效目标，子行动不再入带）；overrides 支持 free / ignoreSlots / ignoreRange / ignoreLOS / intent / scale / origin（overrides.intent 可强制指定 attack / skill / shield_bash 子打击或磁带重放的意图，优先级低于范围／非敌对归零与 controlPolicy.intentLock，高于磁带原意图与单位默认意图；无蓄力直发覆盖字段，立即释放高倍率技能用 scale 或前置状态表达）。resource：mode 为 add/sub/set 时需 amount，swap 时需单个 pool 与 otherPool；pool 支持内置池 hp/mp/sp、自定义池 ID 或行动伪池 attack/action/move（本回合剩余攻击槽、动作槽、移动格）；mode 为 add_max/sub_max/set_max 时修改 HP/MP/SP 上限并同步当前值与 initialMax 镜像，minRemain 限制最低上限。move：mode 为 step/teleport 时用 to，push/pull 用 distance，altitude 用 deltaZ 或 land:true。mods:[{locks:["fly","teleport"]}] 禁止升空与瞬移（已在空中需另用 land:true 强制降落）。不可驱散写在状态模板顶层 flags:["undispellable"]。expireOn 接受单个条件或非空条件数组，任一条件满足即可过期。despawn：entityKind:"unit" 用于移除召唤物且不计击杀。
原生攻击在 before_check 可写 ratingDelta（整数档数，可用公式，正升负降）：先从基础评级移动并在表两端封顶，再按 minRating 保底。精准类远程攻击在本规则的远程过滤条件下写 {"op":"mutate_event","patch":{"ratingDelta":1,"minRating":"有效","forceOutcome":"hit"}}；最后一项用于原文明说必中、连天然1也不能失手的情形，不要求必中则省略。after_hit 在主击扣血后触发：生命阈值斩杀在 after_hit（限定 attacker.id == self.id 及来源且 target.alive && target.hpRatio < 阈值）调用 damage 并设 instantDeath:true（绕过护甲直接致死；若斩杀伴随该武器的击杀收割叠层，将叠层写在 after_damage 中匹配 !target.alive && event.dealt > 0 且限定 event.weaponTemplateId == item.templateId 或 event.sourceRuleId == '<斩杀规则ID>'，切勿在无武器字段的 on_kill 中写 event.weaponTemplateId）；主动技能有前置层数门槛或受特定负面状态禁用时，优先在 before_action（匹配 attacker.id == self.id 与 event.skillId）执行 mutate_event:{cancel:true} 直接拦截施放而不白扣行动槽，封锁资源恢复则在 before_commit 执行 mutate_event:{cancel:true}。\nmutate_event 的 patch 至少含一个字段，仅限下列可写 hook（before_check.minRating 取值枚举：超暴击 / 强暴击 / 平暴击 / 有效 / 勉强 / 擦伤 / 失手）：
${eventPatches.join('\n')}
before_target.redirectTarget 将整个目标列表覆写为单一实体，范围行动中仅替单名受击者转移承伤用 replaceTarget:{from,to}；护盾用 category:"shield" 的状态，实际剩余盾值存于 vars.shieldAmount（apply_status 施加时须在 vars 中显式传入初始或叠加后的 shieldAmount）。
清除敌方区域时 where 可写 "zone.team != null && zone.team != self.team"（zone.team / candidate.team 读创建阵营，zone.sourceId / candidate.sourceId 读创建者 ID）。spawn 的 spec 由 entityKind 决定；unit 的 templateId/copyOf/spawnPanel 至多选一，均省略时按施术者预算自动生成面板；tier、count、remainingTurns、area.radius 支持数值表达式；terrain 至少含 kind 或 height，填 mode 时必填 height：
${spawnSpecs.join('\n')}
召唤物 sourceSkillId 由引擎只读记录生成它的技能 ID（含装备虚拟技能 equip:<实例ID>:<规则ID>），可通过 self/target/candidate/vars.<实体>.sourceSkillId 读取。
zoneArea：${describe(defs.spawn_zone.properties.area)}。single 仅中心格；circle/ring 必填 radius；rect 必填 rect 对象；cells 必填 cells 数组；z1/z2 可选限定三维海拔闭区间（地面z + 离地altitude，self.z 亦可读单位海拔）。

【表达式与选择器】
Expr 为 JSON 数字、布尔值或安全表达式字符串。字符串字面量支持单双引号，空值用 null，支持 + - !、算术、比较、&&、||、?: 三元与括号。严格使用注册变量与函数签名，无数组字面量或任意属性路径。
let.name、bind、out、outCount 定义时写裸名称，读取时一律加 vars. 前缀（scope:"owner" 按当前规则所属载体写入：装备读 item.vars.<名>、技能读 skill.vars.<名>、状态读 status.vars.<名>、区域读 zone.vars.<名>、仅单位自身规则读 self.vars.<名>；未写入前为 null，空值兜底用三元表达式 (x == null ? 0 : x)，严禁调用未注册的 coalesce 函数！）。实体引用可直接作 target:"vars.<名>"、读字段 vars.<名>.hp 或传入查询函数。
• 资源池与跨载体自定义池：self.resource.<池> 与 resource(self, '<池>') 读取单位级池（内置 hp / mp / sp 及伪池 attack / action / move，也包括由 unitPools 声明的命名池）；装备规则作用域用 item.resource.<池> 读取当前装备实例池，缺省为 0，不得再读取 event.souls 等业务特判字段。equipment / skill / unit 模板可声明 unitPools:{"<池ID>":{name?:文本,cap:数值或 Expr,initial?:数值或 Expr}}；初始化时同一单位的同名声明合并为一个单位池，current 默认 initial ?? 0（未填 initial 时为 0），跨载体技能直接复用同一 poolId。resource 的 local:true 仅读写装备实例池；普通 resource 先查单位池，技能 resourceCost:{resource:"<池ID>",amount:N} 同样按装备实例池、单位池顺序扣费。装备 pools 仍用于本装备 ammo 等实例池，不要用它替代 unitPools。跨批标准化必须复用 roster 末尾 <role_readonly_index> 的 sharedPoolLedger 中既有 poolId，不得为同一共享池另起近义 ID。
变量：${formulaReference}。
函数签名：${formulaFunctionReference}。count_units 的条件可直接写布尔表达式或字符串字面量（JSON 字符串内双引号需转义）。
selector：${describe(defs.selector)}。
• 集合全集语义：from:"units" 默认包含全场存活者、阵亡尸体、友军与 self 自身，不会自动过滤敌我或生死！必须在 where 中按原描述显式组合 candidate.alive、candidate.team（blue/red，比较 self.team）与 candidate.id != self.id。of 仅用于 from:"statuses"；statuses 候选可读 candidate.id/category/tier/stacks/remainingTurns；zones 候选可读 candidate.id/team/sourceId；tape 候选按时间序保留记录，可读 candidate.round/turn/actorId/team/actionType/skillId；options 传入候选 ID 字符串数组配合 pick:{random:N} 做确定性不放回抽样，for_each 以 bind 取出所选 ID 赋给 statusId:"vars.<名>" 或 skillId:"vars.<名>"。
• 几何与尺度：area.origin 或 area.center 指定中心（缺省为 self）；词条相对档位距离／半径用 scale_cells(n)，明确米数用 cells_m(meters)。line/fan/cone 从原点朝当前 target；原点与 target 同格时，沿 attacker（缺省 self）到 target 的方向延伸，方向不可确定时仍用原点朝向。相对朝向扇区用纯函数 facing_arc(observer, point)（返回 'front' / 'side' / 'back'，如后方受击闪避或背刺增伤写 facing_arc(target, attacker) == 'back' 或受击侧 facing_arc(self, attacker) == 'back'）；before_target 钩子内可直接读 event.backX / event.backY 定位主目标背后格（如瞬移至目标背后写 to:{x:"event.backX", y:"event.backY"}）。“对同一目标整场战斗／每回合限生效一次”直接通过给目标施加 durationType:"persistent"（或 1 回合）的隐藏标记状态并在 before_action / filter 中检查 !has_status(target, '<标记状态ID>') 精确实现，切勿误判为 engine_limit！
• 命中后溅射：主击保留 shape:"single"，用 after_hit（技能规则按 attacker.id == self.id && event.skillId == skill.id 限定）在 area.center:"target" 处选一圈单位，再写 damage，不做第二次命中检定。只伤周围单位就在 where 排除 candidate.id == target.id。不填 bind 时，循环体中的 target 是当前溅射目标，check(kind:"save") 也由它掷；填 bind 则保留原 target，仅用 vars.<名称> 访问当前候选。
pointRef：可写 {x,y,z?}、作用域枚举 self / source / target / attacker / center 或 vars.<名称>。
targetRef：${describe(defs.targetRef)}。特定快照实体可用选择器 {"from":"units","where":"candidate.id == '<快照ID>'"}。

【声明式修饰 mods】
mods 数组每项：${describe(defs.statMod)}。至少含 stat、locks、flags 或 controlPolicy 之一；数值修饰必指定 stat。计算公式为 (基值 + flat 之和) × (1 + additivePercent 之和) × mult 连乘（注意：additivePercent 以 1 为 100% 小数制，如 +50% 必须写 0.5 或 0.5 * 层数而严禁写 50，比例公式如 (self.str - 5) / self.str 直接作小数写入而严禁再 * 100！mult 为直接乘数，如 ×200% 写 2）；when 求值为 true 时生效；checkKind 可限定检定类别（attack / save / contest / skill / chance / d20 / authority / flee 或状态 ID／标签，其中 checkKind:"flee" 可修饰原生逃跑检定加值或 advantage 优劣势骰）。
• 以下修饰只接受 flat 加值：${flatOnlyStats.filter(name => defs.statMod.properties.stat.enum.includes(name)).join(' / ')}。
• 输出侧（持有者进攻）：flat / additivePercent / mult 均支持动态 Expr 公式。注意武器普攻中 event.power 为 null（事件武器面板攻击力为 weapon.attack）；凡“每层提升攻击力 X%”或“命中附加基础伤害 × 比例”均属基础乘区比例增幅，优先直接写载体 mods 的 stat:"damageMult", additivePercent:"比例公式"（武器本身词条配 when:"event.weaponTemplateId == item.templateId"），避免在 after_hit 误读为 null 的 event.power 或重复结算护甲！damageFlat 固定加伤（基值 0，用 flat）；damageMult 输出倍率、finalDamageMult 最终伤害倍率（基值 1，用 mult 或 additivePercent，禁用 flat）；critDamageBonus 暴击伤害倍率加成（基值 0，只接受 flat 小数加值，如暴击伤害 +30% 或暴击倍率 +0.5 直接写 {stat:"critDamageBonus", flat:0.3} 或 flat:0.5，严禁写 mult/additivePercent！伤害相关阶段亦可读 event.critical 与 event.ratingMultiplier）；armorPierce 固定穿甲（用 flat）；armorPiercePercent 百分比穿甲（基值 0，用 flat:-1..1，禁用 additivePercent）。
• 承伤侧（持有者受击）：damageReductionFlat 受击固定减伤（基值 0，用正数 flat，勿写成负 damageFlat）；damageReduction 与 dr 受击比例减伤（基值 0，用 flat:-1..1，正数减伤、负数增伤（+0.3 减伤 30%），禁用 additivePercent；damageReduction 在固减前乘算，dr 在固减后乘算；真实伤害无视减伤）。
• 机动与距离：movement 的基值与 flat 均为同阶移动单位，叠加后应用倍率，再按层级米数折算为格；checkBonus、initiativeFlat 仅接受 flat 数值加值，不乘检定或先攻总值；incomingDistanceOffset 用 flat 写敌方测算射程、范围与距离档位时的表观距离增量（可用 scale_cells(n)）。
• 状态扩展与行为标志：incomingAccuracy（被命中修正）、intentBonus（攻方意图检定加值，flat-only：正数利攻等价于自身发起意图 DC -N，负数损攻如挂在进攻方身上的减益“攻击时意图 DC +8”写 flat:-8 或 "-1 * status.stacks"；全意图省略意图过滤，单意图如猎人帽“命中核心判定 +5”写 {stat:"intentBonus", flat:5, when:"event.intent == 'core'"}，仅限本把武器时再并入 event.weaponTemplateId == item.templateId；严禁混入常规 checkBonus，且不可突破低两阶强制失败壁垒）、intentDifficulty（守方受击意图难度修正，flat-only：正数提高敌方意图难度利守，负数暴露弱点降难度，when 同样可读 event.intent / !event.melee 等上下文）、shatter（碎裂增伤）均使用 stat flat；mods.flags 实装生效项为 guaranteed_hit（攻击必中且免天然 1 失手）、guaranteed_crit（攻击必暴击）、preserveLife（受击致死保留 1 HP）、blockRevive（禁绝复活）、untargetableSingle（不可被敌方单体指向选中）、harmless（造成的伤疗归零）、hidden（隐身）、intercept（可援护拦截）、taunted（被嘲讽）、infiniteAmmo（弹药不限）（注：封锁特定恢复技能或资源回复请用 before_action / before_commit 的 cancel:true 实现）。
• 检定与属性：dodge 受击闪避（基值 0，正数 flat 扣敌方命中、负数降低自身闪避。省略 checkKind：没有独立闪避检定，严禁写 checkKind:"dodge" 或 {stat:"checkBonus",checkKind:"dodge"}。可配 when:"facing_arc(self, attacker) == 'back'" 等朝向条件）、checkBonus 检定加值（支持按单一五维属性限定！检定与豁免事件暴露 event.stat 为 'str' / 'agi' / 'con' / 'int' / 'spi'，如“精神检定 -5”或“力量与体质检定 +3”直接写 {stat:"checkBonus", flat:-5, when:"event.stat == 'spi'"} 或组合 ||，无需判 engine_limit！）、dcBonus 豁免难度加值（挂施加者，可配 statusId:"<状态ID>" 限定特定状态、checkKind:"save" 或 when:"event.stat == '...'"，施加侧 check(kind:"save") 须同步填 statusId）、resistBonus 豁免抵抗加值（挂豁免者，同样支持 statusId、checkKind:"save" 或 when:"event.stat == '...'" 限定）、advantage 优劣势骰数（支持 checkKind:"flee" 或 when:"event.stat == '...'"）、initiativeFlat 先手加值，基值均为 0，正向收益填正数 flat、负面减益填负数 flat；healingMult / incomingHealMult / costMult 基值均为 1，用 mult 或 additivePercent（禁用 flat）；str/agi/con/int/spi/armor 叠加持有者对应面板值。对免疫特定状态的目标增伤可直接用 mods 的 finalDamageMult 配 when:"is_immune(target, '<状态ID>')"。
controlPolicy：${describe(defs.controlPolicy)}（写成 mods:[{controlPolicy:{moraleLock:"steady"}}]、{controlPolicy:{allowFriendlyTarget:true}} 或 {controlPolicy:{intentLock:"kill"}}；原生打击需按条件如“目标 HP≤20% 时意图视为抹杀”临时升级意图时，在 before_action 对 self 施加 expireOn:{hook:"after_action"} 且带 controlPolicy:{intentLock:"kill"} 的瞬时状态触发重规划；注意 moraleLock / allowFriendlyTarget / intentLock 属于 controlPolicy 对象，严禁写成 stat:"moraleLock"！）。

【常见误写】
• resolves 仅属于顶层 patch[i] 操作对象（{op, path, value, resolves}），严禁写进 rules[i] 规则对象或 mods[i] 修饰对象内部！
• 技能冷却写在 rules[i].cooldownTurns；扣减剩余行动槽用 resource，调整行动点上限用 stat:"apMax"。
• 不可驱散是载体顶层 flags，勿写入 mods[i].flags；强制驱散使用 remove_status 的 force。
• vars 中的值可以是表达式或标量；表达式里的字符串字面量需要引号。
• expireOn 有多个条件时写对象数组；勿把事件名拼成一个字符串。`;
