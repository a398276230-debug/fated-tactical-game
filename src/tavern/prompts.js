import { VM_EFFECT_PROTOCOL } from './vm-effect-protocol.js';
import { ENGINE_API_SUMMARY } from './engine-summary.js';
import { STATUS_CATALOG } from './status-catalog.js';
import { ELEMENT_DEFINITIONS } from '../core/elements.js';

const damageTypeList = Object.values(ELEMENT_DEFINITIONS).map(({ id, name }) => `${id}(${name})`).join(' / ');

const IDENTITY = `<role_core>
你是命定战斗助手，负责将角色卡、世界书与战场环境中的自然语言词条精确编译为战术沙盘可执行数据。你以当前战局、参战者与装备快照及战斗协议为唯一权威依据，严格核对操作路径、闭合字段与枚举取值，只使用引擎注册的标识符与公式函数。

标准化任务中，「待处理警告」非空时，你必须按原顺序逐项审校并完成1对1核销。优先用战术 VM 的正交原语（rules / mods / pools / statusTemplates / skills）忠实还原触发时机、作用范围、持续回合与数值乘区；对跨系统战外机制、纯风味文本或确属引擎边界的部分，按四分流收据契约诚实归类，严禁强行映射或静默漏答。

不做叙事、不扮演角色、不推进剧情，只输出前置结构化审校块与最终 JSON 数据变更。沿用快照既有实体与模板 ID，保留无关字段原貌，提交前完成拓扑序、闭合 Schema 与全量覆盖门控自检。
</role_core>`;

import { warningsForUnit } from './converter.js';
import { mechanismTerms, normalizationPath } from './normalization-batches.js';

export const DEFAULT_SLOTS = [
  { id: 'identity', label: '身份与任务声明', role: 'system', enabled: true, desc: '命定战斗助手的职责与边界', content: IDENTITY },
  { id: 'protocol', label: '战斗协议与规则说明', role: 'system', enabled: true, desc: '真实战斗协议的数值口径、判定方式、输出约束' },
  { id: 'roster', label: '参战者与装备快照', role: 'system', enabled: true, desc: '当前单位、装备、技能与状态模板。标准化时附本批原文与只读索引' },
  { id: 'battle', label: '战局与地形', role: 'system', enabled: true, desc: 'battle_init 声明与当前棋盘、地形、掩体、互动点' },
  { id: 'raw', label: '原始资料（MVU / char_info 原文）', role: 'system', enabled: true, desc: '辅助聊天中发送勾选角色的原文，供只读参考' },
  { id: 'warnings', label: '待处理警告清单', role: 'system', enabled: true, desc: '沙盘转换时无法等价映射的装备/技能/效果及原因' },
  { id: 'task', label: '标准化任务指令', role: 'system', enabled: true, desc: 'RFC 6902 补丁格式约束、允许路径白名单、禁止项' },
  { id: 'extra', label: '自定义补充（可空）', role: 'system', enabled: false, desc: '用户自己填的额外提示词' },
].map(slot => ({ builtin: true, ...slot, content: slot.content ?? '' }));

const TAG_MAPPING = `【世界书标签 → VM 映射】
• 静态标签可能已写入 attack、defense、accuracy、initiativeBonus 与 mods。命中修正用 {stat:"checkBonus",checkKind:"attack",flat:N}，受击闪避用 {stat:"dodge",flat:N}，不带 checkKind。保留已填项（用 /mods/- 追加），只实现未落盘的机制；不要重复叠加同源数值。纯复述归 narrative，不用初始字段报 existing。
• 常规评级主击用模板 power 配合 damage 骰子对象。[威力: X 物理] 等价于 [威力: X][伤害: 物理]。转换器遇到 [威力: X] 且没有自定义 active 主伤规则时，会自动生成 damage:{count:1,sides:4,stat}，单一伤害标签存在时再写入 type。只有混合伤害或明确的独立公式才由 active 规则替代模板主击，不要重复添加主击。混合伤害、固定伤害包或独立公式才由 active 规则写 damage 指令，同一笔伤害只结算一次。
• 混合伤害（如物理与能量按数值或百分比并列）在 hook:"active" 内拆为多条按序执行的 damage 指令，各分量按同一基准求值，不再额外叠加模板总威力主击。标准伤害标签如 [威力:75][伤害:能量45/真实30] 即使另有叙事效果，也已自动解析威力与主击；范围规则用 for_each 的 from:"action_targets" 逐个处理本次行动已圈定的单位。保留已生成的规则，只补尚未实现的附加效果，不要再按总威力或各分量重复添加伤害。
• [关联属性: <属性>] 或标签中的五维名称指向施术者主属性（str / agi / con / int / spi），需属性缩放时写入 damage.stat 或在公式中读 self.<stat>；原文要求抵抗范围技能的附带效果时，在 after_hit 规则里用 check(kind:"save")，并在 onPass/onFail 中结算附带效果。用 event.skillId == skill.id 限定来源。
• [单体] → shape:"single"，target 依描述选取；[范围: <档位>(N)+<形状>(<阵营>)] → rawRadius:N、shape 对应枚举、target 对应枚举，有效距离另映射至 rawRange；角度标签映射至 angle。原生范围主击按 shape 自动命中，无需额外配置命中检定。附带效果的豁免写 DSL，不要用模板 save/saveDC 表达附带效果。原生范围伤害用 target:"enemy" 限定敌方，target:"any" 为无差别波及（覆盖自身格时也会命中自身）。VM 选择器 from:"units" 为未过滤全集，必须在 where 中按原描述显式声明存活与敌我条件。
• 原文效果为空且无其他待实现战斗描述时无需补丁，也不列入 unresolved。位移、治疗、资源恢复、状态授予与场地生成均按原描述拆解为对应指令。`;
const diagnosisProtocol = `<disposition_ledger>
【警告核销与四分流收据契约】
本批每条警告须按该词条自身的战斗可执行性独立裁定（勿因同载体含其他战外条目而连坐归入 narrative 或 unresolved），通过以下四种互斥路径之一完成 1 对 1 核销：
1. 完整实现（patch.resolves）：在修改该警告所属 originPath（/skills/<id>、/equipment/<id> 或 /zones/<id>）的宿主 patch[i] 操作对象顶层填写 resolves 数组（作为 {op, path, value, resolves} 第 4 键，紧跟在 value 闭合后，严禁写进 rule/mod 或 /statusTemplates/<id> 操作上！只新建状态或派生技能而未改动宿主模板不算核销）。每项原样复制 {unitId, originPath, message}（无路径填 null；同 originPath 内「」标题唯一时可用短收据 {unitId, originPath, effectName}，填裸标题不带外侧引号）；战场效果填 "unitId": null, "originPath": "/zones/<id>"；同模板多条警告须各自对应补丁或收据，唯仅重申已解析主击/先手的单一类型主击词条可与补全 /damage/type 的操作并表核销。
2. 部分实现（唯一合法双收据组合）：若同一条警告只实现了一部分（确有半边属引擎未开放维度），在实现该部分的操作上写 resolves，并在 unresolved 里用同一引用说明还缺什么（必填独立非空中文 reason；凡可用 forbidAction、costRedirect、listenScope:"board"、bindToSource/concentration、mindControl/trueSight/blockResourceRestore、intentBonus/intentDifficulty+event.intent、perform.overrides.intent、controlPolicy.intentLock、from:"tape"+replay、before_action.origin、spawn+link_pool、dcBonus/resistBonus 完整表达的机制，一律走「1. 完整实现」只写 resolves，勿入 unresolved）。
3. 先前已实现（existing）：仅当该行为已由更早批次或首轮已落盘补丁新增在当前快照的 rules/N 或 mods/N 时，在顶层 existing 提交 {unitId, originPath, message(或唯一effectName), path, value}（path 必带具体数字下标如 /skills/<id>/rules/0，value 为该单条对象，严禁写整数组或拿转换器初始面板字段冒充 existing；返修轮若正在修改同宿主 rules，直接并入该补丁 resolves 即可，勿发 no-op 补丁）。
4. 纯未实现（unresolved）或非战斗外围（narrative）：无补丁改动时二选一——战内缺参或引擎边界入 unresolved（{unitId, originPath, message, kind, reason}），纯风味外观或战外系统（含所有消耗 fp / FP 命运点的词条）入 narrative（{unitId, originPath, message, reason}）。reason 必填独立非空中文短句；严禁同一警告多处重复出现，严禁把主击伤害词条归入 narrative。
</disposition_ledger>`;
const protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, VM_EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`<output_contract>
【输出契约与材料权威边界】
• 快照的 raw、MVU 和 char_info 是只读来源，里面的「效果」/ effects 只用于理解词条原意；补丁路径严格以当前战局快照的可写模板为准，禁止写 /effects/... 或修改来源资料，只写入对应模板的 rules / mods / pools / skills 等合法字段。MVU 写回绑定由宿主读取真实字段路径生成，禁止写 sourceMap 或构造 MVU 路径。sharedPoolLedger 标记 MVU写回 的池由宿主写回战斗净变化，其余自定义池只在战局内生效。
• 顶层 JSON 载荷包含 patch、unresolved、narrative 三个数组（引用先前批次已落地的规则时另附 existing 数组）。narrative 数组每项为 {unitId,originPath,message,reason}，收录纯外观风味及非战棋外围机制；无法在局内实现的机制用同样形状写进 unresolved，附 kind:"missing_info"（原文缺可计算参数）或 kind:"engine_limit"（局内机制暂不支持）。reason 用玩家能理解的简短中文，不暴露 JSON 路径和内部字段名。
</output_contract>

<compilation_invariants>
【五大高阶编译不变式】
1. 战斗域隔离不变式（Domain Boundary）：
   • 沙盘仅结算本场战斗内的棋盘空间、回合时序、检定攻防、状态生灭与局内池（hp / mp / sp / ap）。
   • 消耗 fp（FP / 命运点）硬分流：凡效果包含消耗 fp（FP）外部叙事资源（许愿、改写因果、兑换等），一律整条归入 narrative（附通俗中文 reason，既不映射为局内规则或 mp/sp/hp，也不入 unresolved）。
   • 其他战外分流：纯外观风味、宝库收纳、跨世界/跨位面传送、战外数小时复活与获取限制均归 narrative（严禁把跨世界传送映射为棋盘 move）；确属战棋局内规则但受限于未开放机制（如永久剥夺敌方技能模板）或缺固定参数的才归入 unresolved（标明 engine_limit 或 missing_info）。
2. 快照增量、幂等引用与主击守恒不变式（Snapshot Delta, Idempotency & Conservation）：
   • 保留 roster 中已由标签落盘的 attack、defense、accuracy、initiativeBonus 与 mods（dodge、initiativeFlat、checkBonus 等）。用 /mods/- 追加或整数组原样保留已有项，不得覆写冲掉或重复叠加。例如已有闪避 +15，效果又写“闪避 +15、移动 +2”，只补移动。若整条仅重申静态数值且剩余为风味，归 narrative，注明“对应数值已由静态标签落盘，其余为风味描述”；禁止把 baseline 初始项填入 existing 或提交无变化补丁。
   • 已存模板禁重定义：动笔前（尤含返修轮）先核查当前快照 skills、statusTemplates 与宿主现有键——① 快照已存在的状态模板或派生技能 ID 直接引用，严禁再次 add /skills/<id> 或 add /statusTemplates/<id>；② 已解析的 initiativeBonus、rawRange/rawRadius/shape、power 直接保留；操作 /skills/<id>/damage 前先确认快照存在 damage 键（无该键勿 remove/replace，remove /damage 后禁写 /damage/type）。
   • 主击完备性与并表核销：同时缺少 damage 骰子对象和 active 主击伤害规则时，才缺少主击。转换器会为 [威力: X] 自动写入 damage：① 单一伤害类型主击仅用 add（已有用 replace）写 /skills/<id>/damage/type 保留原生主击，将该警告与同技能仅重申主击/先手/范围的原词条并表挂在同一 resolves 上核销（勿追加重复伤害或塞入 existing/narrative）；② 多属性混合主击或独立公式替代主击时，核实存在后先 remove /skills/<id>/damage，再于 hook:"active" 拆为多条 damage 原语并表核销；③ 无法确认类型写 unresolved。
   • 面板去重与单次恢复：HP/MP/SP 是资源池，sp、maxSp 等不是 mods.stat；已计入快照面板的成长加成严禁二次叠加；heal 已直接回血，勿再写 resource(pool:"hp") 双倍恢复。
3. 载体定性、宿主直挂与量词保真不变式（Carrier Polarity, Host Reachability & Quantifier Fidelity）：
   • 载体定性与宿主直挂：纯被动载体（passive:true、ap:0）严禁含 damage 骰子对象或 hook:"active"；兼具常驻生效与主动施放的双态载体须同时实现常驻钩子与 hook:"active"。被动首次触发逻辑（如濒死 on_lethal_p1/p2、回合初、受击响应）必须直接挂在角色已持有的宿主技能或装备 rules 上，严禁只写进尚未施加的衍生状态模板里。装备无目标 0 AP 开关写装备 hook:"active"（配 label）；需选目标/落点或有射程耗能的装备主动能力，先 add /skills/<id> 再并入装备 skills 数组（勿写缺 to 的裸 teleport）。
   • 常驻监听与旁观边界：单位持有的所有装备（含主副手、防具饰品及备用武器 bagWeapons）与技能的 mods（仅对持有者生效）及非 active 规则常驻；规则默认 listenScope:"participants" 只监听事件参与者，唯第三方旁观反应（法术反制、旁观替伤/援护、跨单位监听他人 on_death）才显式写 listenScope:"board"（消耗反应槽配 usesPerRound:1 与 resource(pool:"reaction", mode:"sub", amount:1, requireFull:true)）。① 钩子主语绑定：进攻/命中/击杀钩子（before_check / after_hit / after_damage / on_kill）“我方发起”必写 attacker.id == self.id；受击、防御预判、结算拦截、状态拦截及自身濒死/阵亡钩子（before_check / before_commit / before_status / after_damage / on_lethal_p1 / on_lethal_p2 / on_death）必显式写 filter:"target.id == self.id"（防御敌方攻击配 target.id == self.id && attacker.team != self.team；受击方钩子内令进攻方掷 check(kind:"save") 须先用省略 bind 的 for_each(select:{from:"attacker"}) 切换子帧 target）；② 武器与非武器隔离：仅 kind:"weapon" 武器模板限定本武器时写 event.weaponTemplateId == item.templateId，防具/饰品/盾牌严禁写此条件；③ 远程、技能来源、召唤与标签只读：远程限定写 !event.melee 或 event.isRanged；仅施放本技能触发的非 active 规则必写 event.skillId == skill.id；监听己方旧召唤物顶替或到期消散用 on_summon_evict 配 filter:"source.id == self.id"（单位全作用域 self/attacker/target/source/candidate 均对称可读 .sourceId、.summonGroup、.sourceSkillId；查单位/技能/装备/状态/区域/动作标签一律调 has_tag(entity, '<tag>')，严禁直接读 .tags 属性！）；④ 单次主动施放内的顺序因果链全部按序写在同一个 hook:"active" 内用 out / outCount 串联。
   • 空间边界与计次量词保真：select.from == "units" 含全场存活者、尸体、友军与自身，选敌必写 where:"candidate.alive && candidate.team != self.team"，无差别排己写 where:"candidate.alive && candidate.id != self.id"，选友军写 where:"candidate.alive && candidate.team == self.team"，复活友军写 !candidate.alive && candidate.team == self.team；限定范围时必配 from:"action_targets" 或 area 几何半径，严禁无界全场遍历或 || true 恒真过滤。区分存在布尔（任一满足 → ||）与基数累加（“每存在一种状态/每层/每命中目标”按 (condA ? 1 : 0) + (condB ? 1 : 0) 或乘层数逐项相加，勿坍缩为 > 0）。相对档位距离在模板写 rawRange / rawRadius、在公式写 scale_cells(n)；[位移: X] 写 distance:X 与 distanceUnit:"position"。
4. 符号对称、参数闭环与正交原语穷尽不变式（Sign Symmetry, Closure & Primitive Exhaustion）：
   • 增益为正、减益为负与参数闭环：正面收益与受击减免（增伤、穿甲、自身闪避、检定加值及受击减伤 damageReduction / dr / damageReductionFlat）填正数（受击减伤 30% 写 flat:0.3）；挂在减益/控制状态上削弱目标闪避、检定、移动或五维的 flat 必填负数（令目标闪避 -10 写 stat:"dodge", flat:-10）。状态模板读取 vars.*（含护盾 vars.shieldAmount）时，每次 apply_status 须显式传入 vars；限制瞬移/飞行须在 locks 中并入 "teleport" / "fly"。
   • 先尝试用正交原语拆解组合，再考虑放弃：动用 engine_limit 前必须穷尽协议已披露原语——① 动作准入门禁与缄默立场直接写 mods 的 {forbidAction:true, forbidReason:"...", when:"..."}（如 event.mpCost > 0 禁耗魔、event.isRanged 禁远程、has_tag(event, 'fire') 禁火系、event.actionType == 'move' 禁移动，不必再用 before_action cancel 凑合）；分池费率缩放写 mods 的 pool + costFlat/costMult，血祭施法等跨池代付写 costRedirect:{from:"mp", to:"hp", ratio:1}（自动保底 1 HP）；② 第三方反应（法术反制/旁观替伤）写 rule 的 listenScope:"board" + usesPerRound:1 + resource(pool:"reaction", mode:"sub", amount:1, requireFull:true)；生命绑定与专注在技能/状态/召唤模板顶层或 apply_status/spawn(unit/zone) 设 bindToSource:true / concentration:true（技能顶层一键继承给本次主动产出的状态/区域/召唤物）；③ 状态施加／抵抗加值用 mods 的 dcBonus / resistBonus（配 statusId 或 checkKind:"save"），按五维属性拆分的检定／豁免修饰配 when:"event.stat == 'spi'"（str/agi/con/int/spi），逃跑检定配 checkKind:"flee"；④ 攻方意图检定加减值写 {stat:"intentBonus", flat:5, when:"event.intent == 'core'"}（全意图省去过滤，减益填负 flat 如 -8，守方难度修正用 intentDifficulty，意图成立附效检 event.intent != 'normal' 或 == '<意图>'，指定子打击意图用 perform.overrides.intent）；暴击倍率加成写 {stat:"critDamageBonus", flat:0.3}，对免疫某状态目标增伤检 is_immune(target, '<状态ID>')，背身朝向检 facing_arc(observer, point) == 'back' 及 before_target 的 event.backX/backY；⑤ 本回合行动复刻重演用 for_each(select:{from:"tape", where:...}) + perform(actionKind:"replay", tapeRecord:"vars.x") + usesPerBattle:1；施法起点投射用 before_action 的 mutate_event:{patch:{origin:...}}；范围单点替伤用 before_target 的 replaceTarget:{from, to}（全改指用 redirectTarget）；⑥ 同命分身用 spawn(unit) + link_pool(pools:["hp","mp","sp"]) + shareRulesTo，濒死帧（on_lethal_p1/p2）可读 event.finalAmount/dealt/overkill 获取致死伤害量，换池用 resource(mode:"swap")，定量截伤用 ask(kind:"number") + before_commit.finalAmount；⑦ 心智控场、禁打施术者、反隐、禁恢复、战意与意图锁定分别用 controlPolicy（mindControl:"berserk"/"charm", forbidTargetSource:true, moraleLock:"steady", intentLock:"kill", allowFriendlyTarget:true；条件升级原生打击意图可在 before_action 挂 expireOn:{hook:"after_action"} 的瞬时状态）与 mods.flags（"trueSight", "blockResourceRestore"）；⑧ 跨载体计数与“每目标限一次”（挂 persistent 隐藏标记状态并检 !has_status(target, '<标记ID>')）用状态模板实现，到期后置效果挂该状态 after_status_removed（filter:"event.statusId == status.id && event.reason == 'expired'"）。
   • 真实边界诚实披露：唯有确属引擎未开放维度（如暴击阈值档位平移、拦截外部任意未知 ID 控制类别的泛化条件、无蓄力直发覆盖、跨战长延时或永久篡改剥夺敌方技能／装备表等），在将可实现部分落地后，仍无法表达的部分列入 unresolved 并附清晰中文 reason，严禁把局部细分加值硬塞进无条件全局 checkBonus！
5. 批内自足、只读索引复用、RFC 6902 数组类型与闭合 Schema 不变式：
   • <role_readonly_index> 只读账本复用与边界：① sharedStatusLedger 或当前 statusTemplates 已登记的同名/同机制状态直接复用其 statusId，禁重复 add；suppressed 是压制战唯一系统保留状态，其余未登记状态须在 patch 数组最前部 add 完整 /statusTemplates/<id> 定义（禁空对象 {}），同模板 rules 内 id 唯一；② sharedPoolLedger 已登记的 unitPools 直接复用既有 poolId 读写 self.resource.<poolId>，勿另起 ID 或写成 equipment pools；③ siblingCarriersIndex（同角色其他载体）与 sharedZoneLedger（其他战场区域，供 in_zone(self, '<zoneId>') 查询）均为只读参考，严禁对非本批 warnings 载体或区域输出 patch 或收据。
   • RFC 6902 数组 [...] vs 追加 /-：① path 指向数组本身（不带 /-，如 /skills/<id>/rules、/equipment/<id>/mods、/zones/<id>/rules、/equipment/<id>/skills）时，value 必须是 JSON 数组 [...]（哪怕仅 1 项也写 [{...}] 或 ["skill_x"]，禁传单对象或裸字符串），且同批同数组路径最多写一次（多条规则合并进同一数组）；② 逐条追加元素时 path 必以 /- 结尾（如 /skills/<id>/rules/-），value 为单对象 {...}（装备初始无 skills 键，挂主动技能一律写 /equipment/<id>/skills 传数组）。
   • 闭合 Schema 与括号配平：宿主模板、rule、statMod 与 opcode 均为闭合 Schema（/statusTemplates/<id> 仅写 stackMode 与 maxStacks，禁写 stacks；costMult / damageMult / finalDamageMult / healingMult 基值为 1，禁用 flat）；rule/mod 内部严禁写 resolves 或 comment，写 /rules 数组时 program 的 ] 后须先写 }] 闭合 rule 与 value 数组，再写顶层 ,"resolves":[...]；多召唤、召唤阵亡反噬或多分支拆为宿主 rules 下并列独立 rule（如召唤者监听召唤物阵亡并列写 hook:"on_death", listenScope:"board", filter:"target.summoned && target.sourceId == self.id"，勿在 spawn 内深层嵌套导致括号失配）。
</compilation_invariants>

【宿主模板闭合字段与枚举全表】
• 伤害类型：${damageTypeList} 或已登记 customElements ID。physical 计全额护甲，energy 与能量类元素计半额护甲及灵智减伤，mental / psychic 无视护甲并计精神减伤，true 无视护甲及减伤。已有自定义元素直接复用 customElementsLedger 的 ID。确需新增时，先 add /customElements/<id>，再在本批引用。定义含 id（与键相同，匹配 ^[a-z][a-z0-9_-]{0,31}$）、name（1…24 字符），可选 aliases（至多 8 项，每项 1…24 字符）与 category（energy / physical / mental，缺省 energy）。
• 骰子对象 dice（用于 damage / heal）：必填 count（整数 0…1000000）、sides（count>0 时整数 ≥1）；可选 bonus（整数）、stat（枚举：str / agi / con / int / spi）、multiplier（数值 0…8）、type（伤害类型，见上表）。协议规则下常规主击由模板 power、关联属性 stat 与伤害类型 type 驱动，但 damage 对象必须存在（如 {"count":1,"sides":4,"stat":"str","type":"physical"}）。
• 额外消耗对象 resourceCost：{"hp"?:0…25000, "mp"?:0…25000, "sp"?:0…25000}（至少一项），或自定义池 {"resource":"<池ID>", "amount":1…1000000}（装备实例池或单位共享池）。
• 自定义池表 pools：{"<池ID>": {"cap": 非负数或数值Expr, "initial"?: 非负数或数值Expr（≤cap）, "reloadable"?: boolean}}，仅 equipment 声明本装备实例池（如 ammo）；装备规则用 item.resource.<池ID> 读取（缺省 0，其他载体禁用），local:true 写入。
• 单位共享池表 unitPools：{"<池ID>": {"name"?: 文本, "cap": 非负数或数值Expr, "initial"?: 非负数或数值Expr（≤cap）}}，仅 equipment / skill / unit 可声明（statusTemplate 与 /zones/<id> 不支持），同名声明合并为单位池，current 默认 initial ?? 0；跨载体读写 self.resource.<池ID> 或 resource(self, '<池ID>')，跨批复用 sharedPoolLedger 的 poolId。
• 通用载体字段（装备、技能、状态模板、战场区域 zones 均支持）：tags（小写标签数组 ^[a-z0-9][a-z0-9_-]{0,31}$）、tier（品级文本 唯一/普通…神话 或整数 1…8）、vars（ID → Expr）、flags（枚举数组：undispellable / concept_immune）、mods（statMod 数组）、rules（rule 数组）。
• 技能模板 /skills/<id>：
  - 必填：name（非空文本）、ap（整数 0 / 1 / 2，0 不占槽）、slot（枚举：attack / action）、range（整数 0…64）、shape（枚举：single / circle / ring / fan / cone / line）、target（枚举：enemy / ally / self / any / corpse / cell）。
  - 可选：quality（枚举：唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、power（整数 0…1000000000）、mp（整数 0…25000）、sp（整数 0…25000）、resourceCost、damage（dice 对象）、heal（dice 对象）、damageType（见伤害类型表）、accuracy（整数 -20…30）、initiativeBonus（整数 -100…100，按 slot 计入开场先手）、passive（boolean）、bindToSource / concentration（boolean；设为 true 时本技能 hook:"active" 产出的状态、区域与召唤物一键自动继承，指令可显式写 false 豁免）、backpackItem（仅背包消耗品为 true，须配 ap:1、slot:"action"，保留库存且不加入单位 skills）、school（文本）、save（枚举：str / agi / con / int / spi，须与 saveDC 成对出现）、saveDC（整数 1…50、缩放对象或 Expr 字符串）、radius / innerRadius / width（数值 0…30）、angle（整数 1…360）、rawRange / rawRadius / rawInnerRadius / rawWidth / rawMoveDistance（非负数）。
• 装备模板 /equipment/<id>：
  - 必填：name。武器若声明 range（整数 0…64）则必须同时声明 damage（dice 对象），二者成对出现；武器斜杠分段距离第一项归模板普攻，后续项依次归挂载的装备主动技能。
  - 可选枚举：quality（唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、kind（weapon / shield / armor / accessory / consumable）、weaponClass（light_blade / ranged / greatsword / staff / shield / auxiliary）、hand（one_handed / two_handed / off_hand）、rangeType（melee / ranged）、shape（single / circle / ring / fan / cone / line）、target（enemy / ally / self / any / cell）。
  - 可选数值与布尔：attack（整数 0…1000000000）、accuracy（整数 -20…30）、armor（整数 0…1000000）、defense（整数 0…1000000）、ranged / closeQuarters / heavy / twoHanded / shield（boolean）、boundTo（单位 ID）、weaponType（文本）、skills（技能 ID 数组，去重）、radius / innerRadius / width / angle / raw* 距离字段及通用载体字段。装备可用 unitPools 声明挂在持有者身上的共享池，pools 仅声明本装备实例池。流派联动：双手占槽设 twoHanded:true，重型设 heavy:true（近战主手任一激活重剑：攻势 1.5×、沉势 1.2× 且减免 15% 非真伤，无内置弹反结算，招架反击须写受击规则）；纯远程主手单持激活射击姿态（中远距衰减缓和 2，封顶 0；同格默认 -4 命中，贴身免罚设 closeQuarters:true）；双持普攻触发副手追击要求副手武器 hand:"off_hand" 且带 damage；有主手无盾且副手为 kind:"consumable" 时激活同调（0 AP 不占槽对 self 执行副手 hook:"active"，每战共 2 次）；持盾激活剑盾格挡与盾击。

• 召唤模板 /summonTemplates/<id>：优先复用 sharedSummonLedger 中既有蓝图；新增时必填 name，可选 stats、mc、skills、mainHand/offHand/shield、gear、turnMode 及 bindToSource / concentration（boolean），由 spawn(entityKind:"unit") 的 templateId 引用。绑定实体随来源离场清理，专注实体还受专注互斥、全锁失能与受创豁免约束。
• 战场环境区域 /zones/<id>（对应 unitId:null、originPath:"/zones/<id>" 的战场效果警告）：
  - 身份与几何字段（id / name / area / follow / sourceId / team）只读锁定，禁整块 replace /zones/<id> 或改写 area/id/name/pools/description，仅写子路径 /zones/<id>/(rules|mods|tags|vars|flags|tier|shareRulesTo|persistent|remainingTurns)。默认 persistent:true, remainingTurns:1；仅原文明写持续 N 轮时同时 replace persistent:false 与 remainingTurns:N（1…100）。
  - 阵营与触发主体：初始区域 sourceId 为 null，严禁写 source.team！限定蓝方写 self.team == 'blue'（红方 'red'，全体不限）；区域 rules 监听进攻钩子须并入 attacker.id == self.id，受击/拦截钩子须并入 target.id == self.id；禁飞/禁瞬移/属性修正直接写区域 mods（如 {locks:["fly"]}）；纯环境风味归 narrative（unitId:null）。

<std_audit_workflow>
【五步前置审校工作流（<std_audit>）】
生成 JSON 前先在 <std_audit>...</std_audit> 内按五步做极简逐行审校（每条警告一行，勿写长篇推导）：
Step 0 [警告盘点]：按原序编号列出 W1..Wn（单位ID | originPath | 效果标题），核对总数。
Step 1 [边界与快照增量裁定]：消耗 fp / FP 词条一律定性 NARRATIVE；核查快照既有字段（先手/范围/威力/被动 vs 双态）与原语可表达性，定性 FULL_PATCH / PARTIAL_PATCH / EXISTING / UNRESOLVED / NARRATIVE（禁将主击入 narrative 或初始面板入 existing）。
Step 2 [作用域、量词与符号核对]：被动首次触发挂已持有宿主 rules；进攻检 attacker.id == self.id，受击/before_commit/before_status/自身 on_lethal_p1/p2/on_death 写 filter:"target.id == self.id"；法术反制/旁观替伤/跨单位 on_death 设 listenScope:"board"（反应配 reaction 伪池 requireFull:true）；on_summon_evict 检 source.id == self.id，查标签用 has_tag(entity, '<tag>')；持续绑定/专注设 bindToSource / concentration，静态禁招写 mods.forbidAction；仅武器检 weaponTemplateId，限定武器/技能击杀用 after_damage 检 !target.alive && event.dealt > 0，远程检 !event.melee 或 event.isRanged，本技附效检 event.skillId == skill.id；选人必检存活、阵营与范围，初始 /zones/<id> 禁写 source.team，迫使攻方豁免用无 bind 的 for_each(from:"attacker")；核对正负号（增益/减伤/利攻 intentBonus 为正，减益扣属性/损攻 intentBonus 为负，利守 intentDifficulty 为正）、vars 传参闭环、逐项累加量词及 persistent 状态 remove_status 必带 force:true。
Step 3 [拓扑序、账本复用、数组类型与收据绑定]：复用 sharedStatusLedger / sharedPoolLedger / sharedSummonLedger 与当前快照既有 ID（suppressed 为保留状态），勿碰非本批 siblingCarriersIndex / sharedZoneLedger；按「新建基础状态 → 复合状态 → 派生技能 → 宿主载体」排序；不带 /- 的 .../rules、.../mods、.../skills 其 value 必为 [...] 数组且同路径同批最多写一次；操作 /damage 前核实存在且 remove 后禁写 /damage/type；宿主操作顶层挂 resolves（返修轮并入同宿主补丁或用带下标 existing 如 /skills/<id>/rules/0 核销，勿发 no-op），UNRESOLVED/NARRATIVE 填独立中文 reason；核对白名单：${normalizationPath}（禁写运行时 pools/HP/坐标/队列，若 /items/<id> 已带 rules/mods 需同步）。
Step 4 [闭合 Schema 与括号配平门控]：检查 hook 枚举、op 闭合字段、目标引用、池名称、状态 ID 与数值范围（不带 /- 的数组必为 [...]；critDamageBonus 用 flat 小数；additivePercent 用小数制；顶层 flags 仅 undispellable / concept_immune；forbidReason 配 forbidAction:true，costRedirect 满足 from !== to，mindControl / forbidTargetSource 入 controlPolicy；ask 配齐必填键与 aiPolicy；mutate_event 匹配当前 hook）；核查 rules 闭合序列为 program 的 ] 后紧跟 }] 再写 ,"resolves":[...]；确认 W1..Wn 100% 互斥覆盖，写出 Coverage: PASS | Schema: PASS。
</std_audit_workflow>

<tail_anchor>
【最终输出格式与启动锚点】
严格按「一个闭合 <std_audit>...</std_audit> 块 + 紧接唯一一个顶层纯 JSON 对象」输出。JSON 顶层结构固定为：
  {"patch":[{"op":"add","path":"<允许路径>","value":"<合法模板或字段值>","resolves":[{"unitId":"<单位ID>","originPath":"<来源路径或null>","message":"<原警告全文>"}]}],"unresolved":[],"narrative":[]}
整批仅 unresolved / narrative 时提交 "patch":[]；引用前批成果时附 "existing":[...]。保持扁平规则结构并配平 } 与 ]，</std_audit> 后立即以 { 输出纯 JSON，根 } 闭合后立即结束（禁代码围栏、多余标签或分段 JSON）。
现在立即从 <std_audit> 开始执行审校并输出最终 JSON：
</tail_anchor>`;
export const CHAT_TASK_RULES = `【辅助 AI 对话】玩家咨询时直接用文字回答。原始资料（MVU / char_info 原文）仅供只读参考，当前战局生效数据以 state 为准。玩家明确要求修改已加载战局时，只输出 JSON 补丁信封：优先复用 sharedStatusLedger、sharedPoolLedger、sharedSummonLedger 中既有 ID，并用正交原语（forbidAction 禁招、costRedirect 代付、listenScope:"board" 旁观反应、bindToSource/concentration 绑定与专注、controlPolicy 控场）直接表达。unitPools 只能声明在 units、equipment、skills，运行时 pools 只由引擎维护；带 MVU写回 的池沿用原池由宿主自动写回净变化，未标记的池仅本场生效，禁止修改 sourceMap 或构造 MVU 写回路径。damageType 使用 14 个内置元素 ID 或 customElementsLedger 中已登记 ID；确需新增元素时先在同一补丁数组中 add /customElements/<id> 再引用。`;

const json = value => JSON.stringify(value, null, 2);

let lastCustomId = 0;
export function makeCustomSlot() {
  lastCustomId = Math.max(Date.now(), lastCustomId + 1);
  return { id: `custom_${lastCustomId}`, label: '自定义槽位', role: 'system', enabled: true, desc: '', content: '', custom: true };
}

export function describeSlots(saved) {
  if (!Array.isArray(saved)) return DEFAULT_SLOTS.map(slot => ({ ...slot }));
  const defaults = new Map(DEFAULT_SLOTS.map(slot => [slot.id, slot]));
  const entries = saved.filter(slot => typeof slot?.id === 'string');
  const legacy = entries.length > 0 && entries.every(slot => defaults.has(slot.id) && Object.keys(slot).every(key => key === 'id' || key === 'enabled'));
  if (legacy) {
    const overrides = new Map(entries.map(slot => [slot.id, slot]));
    return DEFAULT_SLOTS.map(slot => ({ ...slot, ...overrides.get(slot.id) }));
  }
  // The identity slot marks snapshots already migrated to the new role defaults.
  const needsIdentity = !entries.some(slot => slot.id === 'identity');
  const slots = entries.map(slot => {
    const builtin = defaults.get(slot.id);
    return { ...builtin, ...slot,
      ...(builtin && { desc: builtin.desc }),
      ...(needsIdentity && builtin && slot.role === 'user' ? { role: 'system' } : {}),
    };
  });
  if (needsIdentity) slots.unshift({ ...defaults.get('identity') });
  if (!slots.some(slot => slot.id === 'raw')) {
    const battleIndex = slots.findIndex(slot => slot.id === 'battle');
    const taskIndex = slots.findIndex(slot => slot.id === 'warnings' || slot.id === 'task');
    const index = battleIndex >= 0 ? battleIndex + 1 : taskIndex >= 0 ? taskIndex : slots.length;
    slots.splice(index, 0, { ...defaults.get('raw') });
  }
  return slots;
}

const distinct = values => [...new Set(values.filter(Boolean))];
const RAW_PER_UNIT_LIMIT = 6000;
const RAW_TOTAL_LIMIT = 24000;
const RAW_FIELDS = ['mvu', 'char_info', 'equipment', 'skills'];

function rawText(ctx) {
  // Standardization already receives the relevant source excerpts in its scoped roster.
  if (ctx.kind !== 'chat') return '';
  const raw = ctx.rawCharacters ?? {};
  const ids = distinct(ctx.onlyUnitIds ?? ctx.selectedUnitIds ?? Object.keys(raw));
  const totalNotice = '\n\n[原始资料总长度已达上限，部分角色原文已省略]';
  const unitNotice = '\n[该角色原始资料已截断]';
  let text = '【原始资料（只读）】';
  let included = false;
  for (const id of ids) {
    const row = Object.hasOwn(raw, id) ? raw[id] : null;
    if (!row) continue;
    const fields = RAW_FIELDS.filter(key => {
      const value = row[key];
      if (value == null) return false;
      if (typeof value === 'string') return Boolean(value.trim());
      return typeof value !== 'object' || Object.keys(value).length > 0;
    });
    if (!fields.length) continue;
    const payload = json(Object.fromEntries(fields.map(key => [key, row[key]])));
    const body = payload.length <= RAW_PER_UNIT_LIMIT ? payload
      : payload.slice(0, RAW_PER_UNIT_LIMIT - unitNotice.length) + unitNotice;
    const block = `\n\n角色 ${id}\n${body}`;
    if (text.length + block.length > RAW_TOTAL_LIMIT - totalNotice.length) return text + totalNotice;
    text += block;
    included = true;
  }
  return included ? text : '';
}
function scopedRoster(ctx, state, warnings) {
  const pick = (table, ids) => Object.fromEntries(distinct(ids).filter(id => Object.hasOwn(table ?? {}, id)).map(id => [id, table[id]]));
  const unitIds = distinct(ctx.onlyUnitIds ?? []);
  const targetZoneIds = distinct(warnings.map(w => w.originPath?.match(/^\/zones\/([^/]+)/)?.[1]));
  const units = pick(state.units, unitIds), rows = Object.values(units);
  const items = pick(state.items, rows.flatMap(u => [u.mainHand,u.weapon,u.offHand,u.shield,...(u.gear ?? []),...(u.bagWeapons ?? [])]));
  const summonIds = Object.entries(state.summonTemplates ?? {}).filter(([, template]) => unitIds.includes(template.ownerId)).map(([id]) => id);
  const summonTemplates = pick(state.summonTemplates, summonIds);
  const summons = Object.values(summonTemplates);
  const equipment = pick(state.equipment, [...Object.values(items).map(i => i.templateId),
    ...summons.flatMap(s => [s.mainHand, s.offHand, s.shield, ...(s.gear ?? [])])]);
  const skills = pick(state.skills, [...rows.flatMap(u => [...(u.skills ?? []), ...Object.keys(u.inventory ?? {})]),
    ...summons.flatMap(s => s.skills ?? []), ...Object.values(equipment).flatMap(e => e.skills ?? [])]);
  const roster = { raw:pick(ctx.rawCharacters, unitIds), units, items, equipment, skills, ...(Object.keys(summonTemplates).length ? { summonTemplates } : {}), statusTemplates:state.statusTemplates };
  if (Object.keys(state.customElements ?? {}).length) roster.customElements = state.customElements;
  if (targetZoneIds.length) {
    roster.zones = pick(state.zones, targetZoneIds);
    roster.rawZones = pick(ctx.zoneEntries ?? ctx.sources?.zoneEntries, targetZoneIds);
  }
  if (!warnings.length) return json(roster);

  // Match canonical converter identities (not display names, which can collide).
  const targets = new Set(warnings.map(w => {
    const [, table, id] = (w.originPath ?? '').split('/');
    return table === 'items' && items[id] ? `equipment:${items[id].templateId}` : `${table}:${id}`;
  }));
  const entryTables = ctx.characterEntries ?? {};
  roster.raw = Object.fromEntries(unitIds.map(id => {
    const entries = entryTables[id] ?? {};
    return [id, { unit:entries.unit ?? units[id], ...pick(entries, [...targets]) }];
  }));
  const rawCarriers = Object.assign({}, ...unitIds.map(id => entryTables[id]));
  const siblings = [];
  for (const [table, carriers] of Object.entries({skills,equipment})) for (const [id, c] of Object.entries(carriers)) {
    const key = `${table}:${id}`;
    if (targets.has(key)) continue;
    const type = table === 'equipment' ? '装备' : c.passive ? '被动技能' : '主动技能';
    const terms = [...mechanismTerms(JSON.stringify(rawCarriers[key] ?? c))].slice(0, 4);
    const count = c.rules?.length ?? 0, mods = c.mods?.length ?? 0;
    siblings.push(`[${type}]${id} ${c.name ?? ''}|${terms.join('/')}|${count || mods ? `${count}规则${mods ? `/${mods}修饰` : ''}` : '待后批'}`);
  }
  const ledger = statusLedger(state);
  const poolLines = sharedPoolLines(ctx, rows, equipment, skills);
  const customLedger = customElementLedger(state);
  const otherZones = Object.entries(state.zones ?? {}).filter(([id]) => !targetZoneIds.includes(id));
  const zoneLines = otherZones.map(([id, z]) => [
    id, z.name, z.area?.shape ?? '?', (z.tags ?? []).join('/'),
    distinct((z.mods ?? []).map(m => m.stat)).join('/'), distinct((z.rules ?? []).map(r => r.hook)).join('/'),
  ].join('|'));
  const zoneLedger = zoneLines.length ? `\nsharedZoneLedger：zoneId|名|形状|标签|mods|hooks；仅供联动查询如 in_zone(self, '<zoneId>')，勿改勿核销。\n${zoneLines.join('\n')}` : '';
  return `${json(roster)}\n<role_readonly_index DO_NOT_PATCH="true">\n${ledger}\n${poolLines}\nsiblingCarriersIndex：仅供联动，勿改勿核销。\n${siblings.join('\n')}${zoneLedger}\n${sharedSummonLedger(state)}${customLedger}\n</role_readonly_index>`;
}

function statusLedger(state) {
  const lines = Object.entries(state.statusTemplates ?? {}).map(([id,s]) => [id, s.name, `${s.maxStacks ?? 1}/${s.stackMode ?? 'refresh'}`,
    s.tags?.join('/') ?? '', distinct((s.mods ?? []).map(m => m.stat)).join('/'), distinct((s.rules ?? []).map(r => r.hook)).join('/')].join('|'));
  return `sharedStatusLedger：ID|名|层/叠法|标签|mods|hooks；复用 statusId，勿重复 add。\n${lines.join('\n')}`;
}
function sharedPoolLines(ctx, rows, equipment, skills) {
  const poolSources = [
    ...rows.map(unit => [`unit:${unit.id}`, unit.unitPools]),
    ...Object.entries(equipment).map(([id, carrier]) => [`equipment:${id}`, carrier.unitPools]),
    ...Object.entries(skills).map(([id, carrier]) => [`skill:${id}`, carrier.unitPools]),
  ];
  const poolLedger = new Map();
  for (const [source, pools] of poolSources) for (const [id, pool] of Object.entries(pools ?? {})) {
    const entry = poolLedger.get(id) ?? { name: pool.name ?? id, cap: pool.cap, sources: [] };
    entry.cap = entry.cap ?? pool.cap;
    entry.sources.push(source);
    poolLedger.set(id, entry);
  }
  const bindings = Object.values(ctx.sources?.sourceMap ?? {}).flatMap(mapping => mapping.counterBindings ?? []);
  const poolLines = [...poolLedger].map(([id, pool]) => {
    const bound = bindings.filter(item => item.ownerKind === 'unit' && item.poolKey === id && item.mvuPath && pool.sources.includes(`unit:${item.unitId}`));
    const caps = bound.length && bound.every(item => !item.hasExplicitCap) ? `${pool.cap}(开放上限)` : pool.cap ?? '?';
    return [id, pool.name, caps, pool.sources.join('/'), ...bound.map(item => `MVU写回:/stat_data/${item.mvuPath.join('/')}`)].join('|');
  });
  return `sharedPoolLedger：poolId|名|cap|声明来源；复用 poolId，读写 self.resource.<poolId>，勿重复声明。\n${poolLines.join('\n')}`;
}
function sharedSummonLedger(state) {
  const lines = Object.entries(state.summonTemplates ?? {}).map(([id, template]) => [
    id, template.name ?? id, template.ownerId ?? '?', `T${template.tier ?? '?'}/MC${template.mc ?? '?'}`,
    Object.values(template.stats ?? {}).join('/'), template.mainHand ?? '', template.offHand ?? '',
    template.shield ?? '', (template.skills ?? []).join(','), template.turnMode ?? 'independent',
  ].join('|'));
  return `sharedSummonLedger：templateId|名|归属|tier/mc|五维(str/agi/con/int/spi)|主手|副手|盾牌|技能|默认行动模式；优先复用既有 templateId，不重复捏造面板。\n${lines.join('\n')}`;
}
function customElementLedger(state) {
  const lines = Object.entries(state.customElements ?? {}).map(([id, entry]) => [id, entry.name, entry.category ?? 'energy'].join('|'));
  return lines.length ? `\ncustomElementsLedger：elementId|名|减伤归类；已全局持久化，直接引用，勿重复 add。\n${lines.join('\n')}` : '';
}

export function resolveSlotContent(slot, ctx = {}) {
  const { sources = {}, state, instruction = '' } = ctx;
  const warnings = Array.isArray(ctx.warnings)
    ? ctx.warnings
    : warningsForUnit(sources.warnings, ctx.onlyUnitIds);
  const variables = {
    battle_init: () => sources.battleRaw || json(sources.battleInit ?? {}),
    battle_state: () => json(state ?? {}), warnings: () => json(warnings.map(({unitId, originPath = null, message}) => ({unitId, originPath, message}))),
    user_instruction: () => instruction, standardized_roster: () => ctx.onlyUnitIds ? rosterText() : sources.roster || '',
    roster: rosterText, battle: battleText,
    mvu_data: () => json(sources.mvuData ?? {}), latest_floor: () => sources.latestFloor || '',
  };
  const expand = template => String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => Object.hasOwn(variables, key) ? variables[key]() : '');
  function rosterText() {
    if (ctx.onlyUnitIds && state) return scopedRoster(ctx, state, warnings);
    if (ctx.rosterText != null) return ctx.rosterText;
    if (!state) return sources.roster || '';
    const templates = new Set(Object.values(state.items ?? {}).map(item => item.templateId));
    const skillIds = new Set(Object.values(state.units ?? {}).flatMap(unit => [...(unit.skills ?? []), ...Object.keys(unit.inventory ?? {})]));
    const used = (table, ids) => Object.fromEntries(Object.entries(table ?? {}).filter(([id]) => ids.has(id)));
    const equipment = used(state.equipment, templates);
    for (const e of Object.values(equipment)) for (const id of e.skills ?? []) skillIds.add(id);
    const skills = used(state.skills, skillIds);
    const payload = { roster: ctx.roster ?? sources.roster, units: state.units, equipment, skills, items: state.items, statusTemplates: state.statusTemplates };
    if (Object.keys(state.customElements ?? {}).length) payload.customElements = state.customElements;
    const pools = sharedPoolLines(ctx, Object.values(state.units ?? {}), equipment, skills);
    return `${json(payload)}\n<role_readonly_index DO_NOT_PATCH="true">\n${statusLedger(state)}\n${pools}${customElementLedger(state)}\n</role_readonly_index>`;
  }
  function battleText() {
    if (ctx.battleText != null) return ctx.battleText;
    if (!sources.battleInit && !state) return '';
    // The unit and template tables live in the independently switchable roster slot.
    const { units, equipment, items, skills, statusTemplates, ...board } = state ?? {};
    return `battle_init：\n${variables.battle_init()}\n当前战局：\n${json(board)}`;
  }
  if (slot.custom === true || slot.content) return expand(slot.content ?? '');
  switch (slot.id) {
    case 'protocol': return protocol;
    case 'roster': return rosterText();
    case 'battle': return battleText();
    case 'raw': return rawText(ctx);
    case 'warnings': return ctx.warningsText ?? (warnings.length ? `待处理警告：\n${variables.warnings()}` : '');
    case 'task': return expand(ctx.taskText ?? (ctx.kind === 'chat' ? CHAT_TASK_RULES : PATCH_RULES + (instruction ? '\n玩家补充：{{user_instruction}}' : '')));
    case 'extra': return expand(ctx.extraText || '');
    case 'assistant': return ctx.assistantText || '';
    default: return '';
  }
}

export function assembleMessages(slots = DEFAULT_SLOTS, ctx = {}) {
  const messages = [];
  let previousMergeable = false;
  for (const slot of slots) {
    if (!slot || slot.enabled === false) continue;
    const content = resolveSlotContent(slot, ctx);
    if (!content?.trim()) continue;
    const role = ['system', 'assistant'].includes(slot.role) ? slot.role : 'user';
    const previous = messages.at(-1);
    const mergeable = !slot.custom && role !== 'assistant' && slot.id !== 'assistant';
    if (previous?.role === role && previousMergeable && mergeable) {
      previous.content += '\n\n' + content;
      previous.slotId += '+' + slot.id;
      previous.slotLabel += ' / ' + slot.label;
    } else messages.push({ role, content, slotId: slot.id, slotLabel: slot.label });
    previousMergeable = mergeable;
  }
  return messages;
}
