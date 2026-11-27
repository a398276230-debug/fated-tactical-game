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
标识符格式：规则／模板／变量 ID 匹配 ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$；tag 匹配 ^[a-z0-9][a-z0-9_-]{0,31}$；状态与载体顶层 flags 枚举为 ${statusFlags.join(' / ')}。伤害类型共 14 项：physical(物理)、energy(能量)、mental(精神)、true(真实)、fire(火焰)、cold(冰霜)、lightning(雷电)、thunder(雷鸣)、acid(酸蚀)、poison(毒素)、necrotic(暗蚀)、radiant(光耀)、force(力场)、psychic(心灵)，或使用已登记 customElements ID。元素物理特质共 8 项：heat(高温)、ignite(引燃)、cold(寒霜)、wet(浸润)、shock(导电)、corrode(蚀解)、flammable(可燃)、gust(气浪)。引擎内置物理媒介与附着相变（fire 默认 heat+ignite、cold 默认 cold、lightning 默认 shock、thunder 默认 gust、acid 默认 corrode；载体 tags 可附带上述特质名；customElements 可选声明 1…4 项 traits）：常规水/火/冰/雷/风/酸技能只需照常填写 damageType 或元素 tags，落点会自动结算水体导电、融冰化汽、引燃油污毒瘴、吹移云雾及爆桶掩体联动，切勿在每个技能里手写冗长的环境检测指令！

【全局事件管线与载体作用域】
• 单次行动结算序：[准入与计费预检：mods 依次结算各池 costFlat/costMult 缩放、costRedirect 跨池代付及 forbidAction 动作准入门禁] → before_action（覆盖全部结算动作：扣费倍率缩放、取消行动、改写生效起点 origin 与无视视线 ignoreLOS；期间若改变持有者 controlPolicy.intentLock 会自动重规划并刷新 event.intent）→ before_target（取消指向、redirectTarget 覆写为单一目标或 replaceTarget:{from,to} 单点替身承伤并保留其余范围目标、伤害倍率缩放；可读 event.backX/event.backY 获取主目标背后一格坐标）→ before_check（改 DC/加值/优劣势、无视闪避、保底评级、强制判定结果，可读 event.stat 区分 str/agi/con/int/spi）→ after_natural_roll（自然 d20 出骰后读 event.naturalRoll 并可用 replaceNaturalRoll 改骰）→ after_check → [模板主击/治疗 或 hook:"active" 规则执行] → before_commit（在 damage/heal/resource 落盘前统一拦截，按 event.commitKind 区分类型，可读 event.targetId/pool/finalAmount/sourceRuleId/critical/ratingMultiplier，支持 ask 交互截取并改写 cancel/finalAmount/preserveLife）→ [HP 归零时：先跑 on_lethal_p1 处理遗言、治疗或换池 → 仍 ≤0 再跑 on_lethal_p2 处理 heal 或 preventDeath 免死锁血（两阶段均可读 event.rawAmount/finalAmount/dealt/absorbed/overkill 获取本次致死伤害量）→ 仍 ≤0 才结算 on_death / on_ally_death / on_kill] → after_damage / after_heal → after_hit → after_action。
• event.intent 单字段收敛与安全边界：仅敌对打击链挂载字符串枚举 event.intent（normal / function / core / kill / concept；范围与非敌对行动归并为 'normal'）。检定前及检定中（before_action / before_target / before_check / after_natural_roll / intentBonus 与 intentDifficulty 求值）为声明意图；一旦意图检定失败（含低目标两阶强制失败、concept_immune 位格拦截或对抗未过），该受击分支在 after_check / prepareDamage / before_commit / after_damage / on_lethal_* / on_death / on_kill / after_hit 中自动回退为 'normal'（写 when:"event.intent != 'normal'" 或 event.intent == 'core' 在检定后天然仅在意图实际成立时生效）。位移、回合首尾、纯状态及独立周期结算不挂载 intent（undefined，三值逻辑下 != 'normal' 与 == 'normal' 均返回 null 不误判，判无意图用 event.intent == null）；同主语透传保证仅行动发起者自身的追伤继承生效 intent，受击方反伤不继承攻方意图。
• 独立生命周期钩子：after_move（实际位移或高度变化后触发，attacker/target 指移动单位，可读 event.fromX/fromY/toX/toY）；before_status / after_status_applied / after_status_removed / on_status_immunized（状态拦截、施加、移除、被免疫，可读 event.statusId；状态规则内 status.* 指向本宿主状态自身而非待施加状态）；on_summon_evict（同源旧召唤物被顶替或到期消散前触发，target 为旧召唤物，source 与 attacker 为召唤者，event.sourceSkillId 为原召唤技能 ID——被动监听己方召唤物消散检 source.id == self.id 或 target.summoned && target.sourceId == self.id，切勿与被动技能自身 skill.id 比较）；turn_start / turn_end（单位回合首尾）；round_start / round_end（大轮首尾）。任意钩子均可使用 ask 挂起等待选择。
• 监听范围与第三方反应（listenScope）：mods 仅对载体当前受众生效，从不全局广播；非 active 规则默认 listenScope:"participants"，仅派发给事件参与者（攻防/检定/伤疗/状态钩子通知发起方与目标双方，on_lethal_p1/p2 与 on_death 仅通知濒死/阵亡者及同命池成员，after_move 与 round_start/end 默认全场存活单位，on_ally_death 默认存活友军）。编写第三方旁观反应——如法术反制（监听敌方 before_action 施法并 cancel:true）、旁观替伤/援护（监听友军 before_target 用 replaceTarget 或 before_commit 分伤）、或跨单位监听他人 on_death（如召唤者监听 target.summoned && target.sourceId == self.id）——必须显式设 listenScope:"board"（仅存活持有者响应）；消耗反应槽时配 usesPerRound:1 并执行 {"op":"resource","target":"self","pool":"reaction","mode":"sub","amount":1,"requireFull":true}（filter 可先检 self.resource.reaction >= 1；requireFull:true 扣减失败时自动中止本规则后续指令）。
• 生命绑定与专注（bindToSource / concentration）：/skills/<id>、/statusTemplates/<id>、/summonTemplates/<id> 顶层及 apply_status、spawn(unit/zone)（不含 terrain/cover/item 与初始 /zones/<id>）可设 bindToSource:true 或 concentration:true。主动技能顶层设为 true 时，其 hook:"active" 本次施放产出的状态、区域与召唤物一键自动继承（优先序：指令显式值 > 主动技能顶层 > 状态/召唤模板；指令显式写 false 可单独豁免）。bindToSource 使产物在来源离场（阵亡/逃离/消散）时自动清理；concentration 含离场清理，且来源开启新专注时自动解除旧专注（同次施法的多产物共享 concentrationRef 不互顶），陷入全行动封锁失能或受创专注豁免（con/spi 取高，DC = min(30, 10 + floor(dealt / maxHp * 20))）失败时立即中断。
• 四类载体作用域矩阵：
  1. unit / item：self 为持有者（装备规则与修饰内 item.id / item.templateId 指向本装备实例与模板），持有期间（含主副手、防具饰品及背包备用武器 bagWeapons）mods 与非 active 规则常驻。① 钩子主语隔离：因攻防事件同时通知攻守双方、同命池共享濒死事件，进攻/命中/击杀钩子（before_check / after_hit / after_damage / on_kill 等）“持有者发起”必写 attacker.id == self.id；受击、结算拦截、状态拦截及濒死/死亡钩子（before_check / before_commit / before_status / after_damage / on_lethal_p1 / on_lethal_p2 / on_death）“持有者自身受击/濒死/阵亡”必写 filter:"target.id == self.id"；② 仅武器模板（kind:"weapon"）限定“本武器普攻/命中/造成伤害”时写 event.weaponTemplateId == item.templateId（防具、饰品、盾牌等非武器装备严禁写此条件）；③ 致死帧（on_lethal_p1/p2、on_death、on_kill、on_ally_death）中 event.weaponTemplateId 与 event.skillId 恒为 null：角色全局击杀用 on_kill，限定特定武器或技能击杀须在 after_damage 写 attacker.id == self.id && !target.alive && event.dealt > 0 并配来源过滤（武器含斩杀补刀写 (event.weaponTemplateId == item.templateId || event.sourceRuleId == '<斩杀规则ID>')，技能写 event.skillId == skill.id）；④ 限定远程攻击生效写 !event.melee 或 event.isRanged（无 weapon.ranged 字段）。
  2. skill：self 为持有者，skill.id 为本技能自身 ID。hook:"active" 仅在主动施放本技能时按序执行；其余非 active 钩子与 mods 在持有期间常驻（默认仅监听事件参与者）。仅在施放本技能时生效的非 active 规则，filter 必含 event.skillId == skill.id（勿混用仅属召唤顶替事件的 event.sourceSkillId）。单次主动施放内的顺序因果链（如伤害后按实扣量回血/回能/二段判定）直接写在 hook:"active" 内用 out 变量串联。
  3. status：self 为状态携带者，source 为施加者，status 为当前状态实例。
  4. zone：区域可挂 tags / vars / mods / rules；对处于 zone.area（含可选 z1..z2 海拔层）内的存活单位生效，单位级钩子与 mods.when 中 self 恒为受影响的区域内单位；初始战场区域（sourceId 为 null）无创建者，source 会回退为 self 或事件源，故初始区域限定阵营必写字面量 self.team == 'blue' 或 self.team == 'red'，严禁写 self.team != source.team（仅技能动态 spawn 且有施法者的区域可读 source.team）；覆盖攻守双方的区域会对区域内每名参与者分别求值，故区域内监听进攻钩子须配 attacker.id == self.id，监听受击/拦截钩子须配 target.id == self.id；外部可用 in_zone(unit, zoneIdOrTag) 按 id、templateId 或 tags 查询。物理媒介区域可选设 layer（surface 地表层：water / ice / oil / fire / acid / electrified_water；cloud 云雾层：steam / smoke / poison_cloud / electrified_steam；填 medium 时必配对应 layer）、blocksLOS:true（阻断远程视线，trueSight 可看穿）与 moveCost:1..4（仅增加 altitude == 0 地面步进消耗，飞行无视）：同层同格新媒介自动裁剪旧媒介（高 tier 或 undispellable / concept_immune 位格受保护不被低位格覆盖），未设 layer 的常规法术区域互不裁剪。
• shareRulesTo 将作用域共享给选择器得到的单位。使用纯选择器，pick 只接受 all、{first:N} 或 {nearest:N}，不接受 random。
• 同一载体内规则 ID 唯一。规则按 priority 从高到低执行，program 按数组顺序执行；filter 求值为 true 才进入规则。

【Opcode】每个指令对象必填 op（闭合枚举，只接受列出的字段，? 表示可省）：
${instructions.join('\n')}
ask 的 kind 与 aiPolicy 对应关系：${Object.entries(askPolicies).map(([kind, policies]) => `${kind} → ${policies.join(' / ')}`).join('；')}。
check：kind 为 chance 时用 dc 与 d100 比较（如 dc:25 为 25%）；豁免未通过进入 onFail；状态豁免写 kind:"save" 与 statusId:"已声明状态ID"（检定钩子与 mods 可读 event.statusId；注意 check(kind:"save") 默认由当前帧 target 掷骰，若在受击方钩子内要求进攻方豁免，先用省略 bind 的 for_each(select:{from:"attacker"}) 将子帧 target 切至进攻方）。ask：kind 为 cell/entity 时必填 select，option 必填 options，number 必填 min/max；必填 aiPolicy 供 AI 与预览自动决策。damage / heal / resource / check / ask / spawn 均支持 out:"裸变量名"（remove_status 用 outCount:"裸变量名"）将本次实际结算值或实体引用写入当前帧，后续指令通过 vars.<变量名> 读取（spawn 在 count > 1 时 out 仅存首个实体 ID，同批全体新召唤物用 from:"units" 配 candidate.summoned && candidate.sourceId == self.id 遍历）。perform：actionKind 为 skill 时只配 skillId，replay 时只配 tapeRecord（配合 from:"tape" 筛选本回合或指定单位已执行记录，磁带重放默认免槽免耗并跳过已失效目标，子行动不再入带）；overrides 支持 free / ignoreSlots / ignoreRange / ignoreLOS / intent / scale / origin（overrides.intent 可强制指定 attack / skill / shield_bash 子打击或磁带重放的意图，优先级低于范围／非敌对归零与 controlPolicy.intentLock，高于磁带原意图与单位默认意图；无蓄力直发覆盖字段，立即释放高倍率技能用 scale 或前置状态表达）。resource：mode 为 add/sub/set 时需 amount，swap 时需单个 pool 与 otherPool；pool 支持内置池 hp/mp/sp、自定义池 ID 或行动伪池 attack/action/move/reaction（本回合剩余攻击槽、动作槽、移动格、反应；move 与真实移动共享预算，turn_start 的 add 可追加当回合移动格；sub 配 requireFull:true 在余额不足时不扣减并中止当前规则分支）；mode 为 add_max/sub_max/set_max 时修改 HP/MP/SP 上限并同步当前值与 initialMax 镜像，minRemain 限制最低上限。move：mode 为 step/teleport 时用 to，push/pull 用 distance，altitude 用 deltaZ 或 land:true。mods:[{locks:["fly","teleport"]}] 禁止升空与瞬移（已在空中需另用 land:true 强制降落）。不可驱散写在状态模板顶层 flags:["undispellable"]。expireOn 接受单个条件或非空条件数组，任一条件满足即可过期。despawn：entityKind:"unit" 用于移除召唤物且不计击杀。
原生攻击在 before_check 可写 ratingDelta（整数档数，可用公式，正升负降）：先从基础评级移动并在表两端封顶，再按 minRating 保底。精准类远程攻击在本规则的远程过滤条件下写 {"op":"mutate_event","patch":{"ratingDelta":1,"minRating":"有效","forceOutcome":"hit"}}；最后一项用于原文明说必中、连天然1也不能失手的情形，不要求必中则省略。after_hit 在主击扣血后触发：生命阈值斩杀在 after_hit（限定 attacker.id == self.id 及来源且 target.alive && target.hpRatio < 阈值）调用 damage 并设 instantDeath:true（绕过护甲直接致死；若斩杀伴随该武器的击杀收割叠层，将叠层写在 after_damage 中匹配 !target.alive && event.dealt > 0 且限定 event.weaponTemplateId == item.templateId 或 event.sourceRuleId == '<斩杀规则ID>'，切勿在无武器字段的 on_kill 中写 event.weaponTemplateId）；静态或条件禁招（如禁耗蓝、禁远程、禁某标签动作、禁移动或前置层数未满）一律优先写 mods 的 forbidAction:true（配 forbidReason 与 when），UI 直接灰显且 AI 自动避开，仅需在发起瞬间先跑动态交互再取消时才用 before_action 的 mutate_event:{cancel:true}；全面禁回血回能用 mods.flags:["blockResourceRestore"]，仅封锁特定单池恢复才在 before_commit 按 event.pool 执行 mutate_event:{cancel:true}。\nmutate_event 的 patch 至少含一个字段，仅限下列可写 hook（before_check.minRating 取值枚举：超暴击 / 强暴击 / 平暴击 / 有效 / 勉强 / 擦伤 / 失手）：
${eventPatches.join('\n')}
before_target.redirectTarget 将整个目标列表覆写为单一实体，范围行动中仅替单名受击者转移承伤用 replaceTarget:{from,to}；护盾用 category:"shield" 的状态，实际剩余盾值存于 vars.shieldAmount（apply_status 施加时须在 vars 中显式传入初始或叠加后的 shieldAmount）。
清除敌方区域时 where 可写 "zone.team != null && zone.team != self.team"（zone.team / candidate.team 读创建阵营，zone.sourceId / candidate.sourceId 读创建者 ID）。spawn 的 spec 由 entityKind 决定；unit 的 templateId 可搭配 spawnPanel 覆写蓝图，copyOf 与两者互斥，均省略时按施术者预算自动生成面板；tier、count、remainingTurns、area.radius 支持数值表达式；terrain 至少含 kind 或 height，填 mode 时必填 height：
${spawnSpecs.join('\n')}
召唤蓝图优先复用 state.summonTemplates 中已有 templateId。spawn(entityKind:"unit") 的 group、stackPolicy、maxActive、turnMode、turnAnchor、durationUnit、durationAnchor 共同表达同组累积、附随行动与锚点到期。随召唤者行动、无独立阶段或多体集群用 linked_group（每只独立走位，共享攻槽、动槽），精锐独立双宠用 linked_each，纯触发单位用 none，独立回合用 independent。开场效果用 round_start 且 filter:"round == 1"。规则牵引可写 move.ignoreLocks:true，分伤在 before_commit 中同时写 shareTo、shareRatio，并用 !event.shared 排除派生伤害。省略 maxHp/maxMp/maxSp 时由引擎按 count 切分批次总量，并对每个实例独立四舍五入。有效层级 T=min(施术者 tier, spec.tier ?? 7)，关联属性 A 由 attribute 指定，缺省 max(int,spi)。单项 cap=min(A,[8,10,12,14,16,18,20][T-1])，总和 sum=max(T*5,A*5-30)。批次 HP=con*100*[1,2,4,10,20,40,100][T-1]*(mc ?? 1)+五维和，MP=(int+spi)*50*[1,2.5,6,15,35,80,160][T-1]，SP=(str+agi)*50*同倍率。只在原文明确固定或按比例规定资源时填每实例 maxHp/maxMp/maxSp。
zoneArea：${describe(defs.spawn_zone.properties.area)}。single 仅中心格；circle/ring 必填 radius；rect 必填 rect 对象；cells 必填 cells 数组；z1/z2 可选限定三维海拔闭区间（地面z + 离地altitude，self.z 亦可读单位海拔）。

【表达式与选择器】
Expr 为 JSON 数字、布尔值或安全表达式字符串。字符串字面量支持单双引号，空值用 null，支持 + - !、算术、比较、&&、||、?: 三元与括号。严格使用注册变量与函数签名，无数组字面量或任意属性路径。
let.name、bind、out、outCount 定义时写裸名称，读取时一律加 vars. 前缀（scope:"owner" 按当前规则所属载体写入：装备读 item.vars.<名>、技能读 skill.vars.<名>、状态读 status.vars.<名>、区域读 zone.vars.<名>、仅单位自身规则读 self.vars.<名>；未写入前为 null，空值兜底用三元表达式 (x == null ? 0 : x)，严禁调用未注册的 coalesce 函数！）。实体引用可直接作 target:"vars.<名>"、读字段 vars.<名>.hp 或传入查询函数。
• 对称只读面与标签查询：has_tag(entity, '<tag>') 支持 self / attacker / target / source / candidate / status / zone / skill / item / event 及 vars.<名> 全作用域（event 自动合并当前动作技能与关联武器/道具标签；查标签一律调 has_tag(...)，严禁直接读 .tags 属性）。事件可读 event.actionType、event.apCost/hpCost/mpCost/spCost/poolCost/poolCostId（缩放及代付后实付值）、event.isRanged/melee/infiniteAmmo、event.skillId/itemId/weaponId/weaponTemplateId；事件武器可读 weapon.attack/weapon.range；全体单位作用域（self/attacker/target/source/candidate/vars.<名>）对称可读 .altitude（离地高度，地面为 0）/.sourceId/.summonGroup/.sourceSkillId（含装备虚拟技能 equip:<实例ID>:<规则ID>）/.level/.reactionAvailable。
• 资源池与跨载体自定义池：self.resource.<池> 与 resource(self, '<池>') 读取单位级池（内置 hp / mp / sp、伪池 attack / action / move / reaction 及 unitPools 声明的命名池）；装备规则作用域用 item.resource.<池> 读取当前装备实例池，缺省为 0，不得再读取 event.souls 等业务特判字段。equipment / skill / unit 模板可声明 unitPools:{"<池ID>":{name?:文本,cap:数值或 Expr,initial?:数值或 Expr}}；初始化时同一单位的同名声明合并为一个单位池，current 默认 initial ?? 0（未填 initial 时为 0），跨载体技能直接复用同一 poolId。resource 的 local:true 仅读写装备实例池；普通 resource 先查单位池，技能 resourceCost:{resource:"<池ID>",amount:N} 同样按装备实例池、单位池顺序扣费。装备 pools 仍用于本装备 ammo 等实例池，不要用它替代 unitPools。跨批标准化必须复用 roster 末尾 <role_readonly_index> 的 sharedPoolLedger 中既有 poolId，不得为同一共享池另起近义 ID。
变量：${formulaReference}。
函数签名：${formulaFunctionReference}。count_units 的条件可直接写布尔表达式或字符串字面量（JSON 字符串内双引号需转义）。
selector：${describe(defs.selector)}。
• 集合全集语义：from:"units" 默认包含全场存活者、阵亡尸体、友军与 self 自身，不会自动过滤敌我或生死！必须在 where 中按原描述显式组合 candidate.alive、candidate.team（blue/red，比较 self.team）与 candidate.id != self.id。of 仅用于 from:"statuses"；statuses 候选可读 candidate.id/category/tier/stacks/remainingTurns；zones 候选可读 candidate.id/team/sourceId；tape 候选按时间序保留记录，可读 candidate.round/turn/actorId/team/actionType/skillId；options 传入候选 ID 字符串数组配合 pick:{random:N} 做确定性不放回抽样，for_each 以 bind 取出所选 ID 赋给 statusId:"vars.<名>" 或 skillId:"vars.<名>"。
• 几何与尺度：area.origin 或 area.center 指定中心（缺省为 self）；词条相对档位距离／半径用 scale_cells(n)，明确米数用 cells_m(meters)。line/fan/cone 从原点朝当前 target；原点与 target 同格时，沿 attacker（缺省 self）到 target 的方向延伸，方向不可确定时仍用原点朝向。相对朝向扇区用纯函数 facing_arc(observer, point)（返回 'front' / 'side' / 'back'，如后方受击闪避或背刺增伤写 facing_arc(target, attacker) == 'back' 或受击侧 facing_arc(self, attacker) == 'back'）；before_target 钩子内可直接读 event.backX / event.backY 定位主目标背后格（如瞬移至目标背后写 to:{x:"event.backX", y:"event.backY"}）。“对同一目标整场战斗／每回合限生效一次”直接通过给目标施加 durationType:"persistent"（或 1 回合）的隐藏标记状态并在 before_action / filter 中检查 !has_status(target, '<标记状态ID>') 精确实现，切勿误判为 engine_limit！
• 命中后溅射：主击保留 shape:"single"，用 after_hit（技能规则按 attacker.id == self.id && event.skillId == skill.id 限定）在 area.center:"target" 处选一圈单位，再写 damage，不做第二次命中检定。只伤周围单位就在 where 排除 candidate.id == target.id。不填 bind 时，循环体中的 target 是当前溅射目标，check(kind:"save") 也由它掷；填 bind 则保留原 target，仅用 vars.<名称> 访问当前候选。
pointRef：可写 {x,y,z?}、作用域枚举 self / source / target / attacker / center 或 vars.<名称>。
targetRef：${describe(defs.targetRef)}。特定快照实体可用选择器 {"from":"units","where":"candidate.id == '<快照ID>'"}。

【声明式修饰 mods】
mods 数组每项：${describe(defs.statMod)}。至少含 stat、locks、flags、controlPolicy、forbidAction 或 costRedirect 之一；数值修饰必指定 stat。计算公式为 (基值 + flat 之和) × (1 + additivePercent 之和) × mult 连乘（additivePercent 以 1 为 100% 小数制，如 +50% 写 0.5 或 0.5 * 层数而勿写 50，比例公式如 (self.str - 5) / self.str 直接写入勿再 * 100；mult 为直接乘数，×200% 写 2）；when 求值为 true 时生效；checkKind 可限定检定类别（attack / save / contest / skill / chance / d20 / authority / flee 或状态 ID／标签，其中 checkKind:"flee" 可修饰原生逃跑检定加值或 advantage 优劣势骰）。
• 动作准入门禁（forbidAction）：{forbidAction:true, forbidReason?:"原因文本", when?:"布尔Expr"} 在预览与结算准入阶段直接拦截动作（UI 灰显展示 forbidReason，AI 选招自动避开，不扣槽不扣费；end 结束回合不受阻；填 forbidReason 必配 forbidAction:true）。常见写法：禁魔/缄默写 when:"event.mpCost > 0"，禁远程写 when:"event.isRanged"，禁火系写 when:"has_tag(event, 'fire')"，禁移动写 when:"event.actionType == 'move'"，前置层数门槛写 when:"event.skillId == 'xxx' && self.stacks.charge < 3"。
• 分池费率与血代蓝（pool + costFlat/costMult + costRedirect）：costFlat（flat-only，基值 0）与 costMult（基值 1，仅用 mult 或 additivePercent）可配 pool:"mp"（或 "sp"/"hp"/自定义池 ID）仅缩放该池消耗（动作某池基础费用为 0 时，仅显式带 pool 的 costFlat 会加费）；costRedirect:{from:"mp", to:"hp", ratio?:1}（from !== to，可配 when）在各池缩放后将 from 池账单单跳改扣至 to 池，扣额为 ceil(原费 * ratio)（同 from 多条仅首项生效，不链式传递；扣减 hp 自动保底保留 1 HP，当前 HP ≤ 应付 HP 时禁止施放）。
• 以下修饰只接受 flat 加值：${flatOnlyStats.filter(name => defs.statMod.properties.stat.enum.includes(name)).join(' / ')}。
• 输出侧（持有者进攻）：flat / additivePercent / mult 均支持动态 Expr。武器普攻中 event.power 为 null（面板攻击力读 weapon.attack）；“每层提升攻击力 X%”或“命中附加基础伤害 × 比例”优先直接写 mods 的 stat:"damageMult", additivePercent:"比例公式"（本武器词条配 when:"event.weaponTemplateId == item.templateId"），避免在 after_hit 误读 event.power 或重复结算护甲。damageFlat 固定加伤（基值 0，用 flat）；damageMult 输出倍率、finalDamageMult 最终伤害倍率（基值 1，用 mult 或 additivePercent，禁用 flat）；critDamageBonus 暴击伤害倍率加成（基值 0，只接受 flat 小数如 {stat:"critDamageBonus", flat:0.3}，禁用 mult/additivePercent；伤害阶段可读 event.critical 与 event.ratingMultiplier）；armorPierce 固定穿甲（用 flat）；armorPiercePercent 百分比穿甲（基值 0，用 flat:-1..1，禁用 additivePercent）。
• 承伤侧（持有者受击）：damageReductionFlat 受击固定减伤（基值 0，用正数 flat，勿写成负 damageFlat）；damageReduction 与 dr 受击比例减伤（基值 0，用 flat:-1..1，正数减伤、负数增伤（+0.3 减伤 30%），禁用 additivePercent；damageReduction 在固减前乘算，dr 在固减后乘算；真实伤害无视减伤）。
• 机动与距离：movement 的基值与 flat 均为同阶移动单位，叠加后应用倍率，再按层级米数折算为格；checkBonus、initiativeFlat 仅接受 flat 数值加值，不乘检定或先攻总值；incomingDistanceOffset 用 flat 写敌方测算射程、范围与距离档位时的表观距离增量（可用 scale_cells(n)）。
• 状态扩展与行为标志：incomingAccuracy（被命中修正）、intentBonus（攻方意图检定加值，flat-only：正数利攻等价于意图 DC -N，负数损攻如“攻击时意图 DC +8”写 flat:-8 或 "-1 * status.stacks"；全意图省略意图条件，单意图如“命中核心判定 +5”写 {stat:"intentBonus", flat:5, when:"event.intent == 'core'"}，限本武器再并入 event.weaponTemplateId == item.templateId；勿混入 checkBonus，不突破低两阶强制失败）、intentDifficulty（守方受击意图难度修正，flat-only：正数增难利守，负数降难，when 可读 event.intent / !event.melee 等）、shatter（碎裂增伤）均用 stat flat；mods.flags 实装生效项为 guaranteed_hit（攻击必中且免天然 1 失手）、guaranteed_crit（攻击必暴击）、preserveLife（受击致死保留 1 HP）、blockRevive（禁绝复活）、untargetableSingle（不可被敌方单体指向选中）、harmless（造成的伤疗归零）、hidden（隐身）、trueSight（真视：无视目标隐身并看穿 blocksLOS 云雾遮蔽，when 可按 target 过滤）、blockResourceRestore（禁回血及单位级池恢复，拦截 heal、mp/sp/自定义池正向恢复与场景恢复点，不影响扣减、上限变更、装备 local 池与行动伪池）、intercept（可援护拦截）、taunted（被嘲讽）、infiniteAmmo（弹药不限）。
• 检定与属性：dodge 受击闪避（基值 0，正数 flat 扣敌方命中、负数降自身闪避；省略 checkKind：无独立闪避检定，严禁写 checkKind:"dodge" 或 {stat:"checkBonus",checkKind:"dodge"}，可配 when:"facing_arc(self, attacker) == 'back'"）、checkBonus 检定加值（检定与豁免暴露 event.stat 为 'str'/'agi'/'con'/'int'/'spi'，按五维限定直接写 {stat:"checkBonus", flat:-5, when:"event.stat == 'spi'"}）、dcBonus 豁免难度加值（挂施加者，可配 statusId:"<状态ID>"、checkKind:"save" 或 when:"event.stat == '...'"，施加侧 check(kind:"save") 同步填 statusId）、resistBonus 豁免抵抗加值（挂豁免者，同上限定）、advantage 优劣势骰数（支持 checkKind:"flee" 或 when:"event.stat == '...'"）、initiativeFlat 先手加值，基值均为 0，增益填正 flat、减益填负 flat；healingMult / incomingHealMult / costMult 基值均为 1，用 mult 或 additivePercent（禁用 flat）；str/agi/con/int/spi/armor 叠加持有者面板值。对免疫某状态目标增伤用 finalDamageMult 配 when:"is_immune(target, '<状态ID>')"。
controlPolicy：${describe(defs.controlPolicy)}。心智控场写 {controlPolicy:{mindControl:"berserk"}}（狂乱：AI 接管无差别攻击敌我）或 {controlPolicy:{mindControl:"charm"}}（魅惑：AI 接管并临时倒向施加者阵营，自动禁打施加者，不改持久 team）；{controlPolicy:{forbidTargetSource:true}} 禁止单体或范围敌对行动将施加者（sourceId）纳入目标（魅惑已自带，威慑/不可侵犯状态可单配）；战意、友伤与意图锁定写 {controlPolicy:{moraleLock:"steady"}}、{controlPolicy:{allowFriendlyTarget:true}} 或 {controlPolicy:{intentLock:"kill"}}（原生打击按条件如“目标 HP≤20% 视为抹杀”临时升级意图时，在 before_action 对 self 施加 expireOn:{hook:"after_action"} 且带 controlPolicy:{intentLock:"kill"} 的瞬时状态触发重规划）。以上字段均属于 controlPolicy 对象，严禁写成 stat:"moraleLock" 等！

【常见误写】
• resolves 仅属于顶层 patch[i] 操作对象（{op, path, value, resolves}），严禁写进 rules[i] 规则对象或 mods[i] 修饰对象内部！
• 技能冷却写在 rules[i].cooldownTurns；扣减剩余行动槽用 resource，调整行动点上限用 stat:"apMax"。
• 不可驱散是载体顶层 flags，勿写入 mods[i].flags；强制驱散使用 remove_status 的 force。
• vars 中的值可以是表达式或标量；表达式里的字符串字面量需要引号。
• expireOn 有多个条件时写对象数组；勿把事件名拼成一个字符串。`;
