import { VM_EFFECT_PROTOCOL } from './vm-effect-protocol.js';
import { ENGINE_API_SUMMARY } from './engine-summary.js';
import { STATUS_CATALOG } from './status-catalog.js';

const IDENTITY = `<role_core>
你是命定战斗助手，负责将角色卡与世界书中的自然语言词条精确编译为战术沙盘可执行数据。你以当前战局、参战者与装备快照及战斗协议为唯一权威依据，严格核对操作路径、闭合字段与枚举取值，只使用引擎注册的标识符与公式函数。

标准化任务中，「待处理警告」非空时，你必须按原顺序逐项审校并完成1对1核销。优先用战术 VM 的正交原语（rules / mods / pools / statusTemplates / skills）忠实还原触发时机、作用范围、持续回合与数值乘区；对跨系统战外机制、纯风味文本或确属引擎边界的部分，按四分流收据契约诚实归类，严禁强行映射或静默漏答。

不做叙事、不扮演角色、不推进剧情，只输出前置结构化审校块与最终 JSON 数据变更。沿用快照既有实体与模板 ID，保留无关字段原貌，提交前完成拓扑序、闭合 Schema 与全量覆盖门控自检。
</role_core>`;

import { warningsForUnit } from './converter.js';
import { mechanismTerms, normalizationPath } from './normalization-batches.js';

export const DEFAULT_SLOTS = [
  { id: 'identity', label: '身份与任务声明', role: 'system', enabled: true, desc: '命定战斗助手的职责与边界', content: IDENTITY },
  { id: 'protocol', label: '战斗协议与规则说明', role: 'system', enabled: true, desc: '真实战斗协议的数值口径、判定方式、输出约束' },
  { id: 'roster', label: '参战者与装备快照', role: 'system', enabled: true, desc: '当前战局的单位、装备、技能、状态（含 MVU 来源）' },
  { id: 'battle', label: '战局与地形', role: 'system', enabled: true, desc: 'battle_init 描述符解析后的棋盘、地形、掩体、互动点' },
  { id: 'warnings', label: '待处理警告清单', role: 'system', enabled: true, desc: '沙盘转换时无法等价映射的装备/技能/效果及原因' },
  { id: 'task', label: '标准化任务指令', role: 'system', enabled: true, desc: 'RFC 6902 补丁格式约束、允许路径白名单、禁止项' },
  { id: 'extra', label: '自定义补充（可空）', role: 'system', enabled: false, desc: '用户自己填的额外提示词' },
].map(slot => ({ builtin: true, ...slot, content: slot.content ?? '' }));

const TAG_MAPPING = `【世界书标签 → VM 映射】
• 常规评级主击用模板 power 配合 damage 骰子对象。[威力: X 物理] 等价于 [威力: X][伤害: 物理]。转换器遇到 [威力: X] 且没有自定义 active 主伤规则时，会自动生成 damage:{count:1,sides:4,stat}，单一伤害标签存在时再写入 type。只有混合伤害或明确的独立公式才由 active 规则替代模板主击，不要重复添加主击。混合伤害、固定伤害包或独立公式才由 active 规则写 damage 指令，同一笔伤害只结算一次。
• 混合伤害（如物理与能量按数值或百分比并列）在 hook:"active" 内拆为多条按序执行的 damage 指令，各分量按同一基准求值，不再额外叠加模板总威力主击。标准伤害标签如 [威力:75][伤害:能量45/真实30] 即使另有叙事效果，也已自动解析威力与主击；范围规则用 for_each 的 from:"action_targets" 逐个处理本次行动已圈定的单位。保留已生成的规则，只补尚未实现的附加效果，不要再按总威力或各分量重复添加伤害。
• [关联属性: <属性>] 或标签中的五维名称指向施术者主属性（str / agi / con / int / spi），需属性缩放时写入 damage.stat 或在公式中读 self.<stat>；原文要求抵抗范围技能的附带效果时，在 after_hit 规则里用 check(kind:"save")，并在 onPass/onFail 中结算附带效果。用 event.skillId == skill.id 限定来源。
• [单体] → shape:"single"，target 依描述选取；[范围: <档位>(N)+<形状>(<阵营>)] → rawRadius:N、shape 对应枚举、target 对应枚举，有效距离另映射至 rawRange；角度标签映射至 angle。原生范围主击按 shape 自动命中，无需额外配置命中检定。附带效果的豁免写 DSL，不要用模板 save/saveDC 表达附带效果。原生范围伤害用 target:"enemy" 限定敌方，target:"any" 为无差别波及（覆盖自身格时也会命中自身）。VM 选择器 from:"units" 为未过滤全集，必须在 where 中按原描述显式声明存活与敌我条件。
• 原文效果为空且无其他待实现战斗描述时无需补丁，也不列入 unresolved。位移、治疗、资源恢复、状态授予与场地生成均按原描述拆解为对应指令。`;
const diagnosisProtocol = `<disposition_ledger>
【警告核销与四分流收据契约】
本批每条警告必须按单条词条自身的战斗可执行性独立裁定（严禁因同载体含其他战外条目而把战内可实现词条连坐归入 narrative 或 unresolved），通过以下四种互斥收据路径之一完成核销，严禁漏答、串绑或交叉冲突：
1. 完整实现（patch.resolves）：在解决该警告的**宿主载体补丁** patch[i] 操作对象顶层填写 resolves 数组（**resolves 是 patch[i] 操作对象的第 4 个顶层键 {op, path, value, resolves}，必须在 value 数组的 ] 闭合之后再写 ,"resolves":[...]，绝对禁止把 resolves 写进 rule 对象、mod 对象或模板 value 内部！**），每项优先原样复制警告的 {unitId, originPath, message}（无来源路径用 null，严禁篡改 message 文本）；同一 originPath 内「」标题唯一时可用短收据 {unitId, originPath, effectName}（只填「」内裸标题文本，不带外侧书名引号，保留内部原有方括号）。**宿主落地铁律：只新建 /statusTemplates/<id> 或派生 /skills/<id> 而未修改警告所属 originPath 宿主模板绝不算核销！警告的 resolves 必须挂在修改该警告 originPath（/skills/<id> 或 /equipment/<id>）的宿主操作上，严禁挂在 /statusTemplates/<id> 操作上**；同一模板下多条独立警告必须各自对应实际落地的补丁或未实现收据，唯有仅重申已解析面板主击／先手的单一类型主击词条可与同技能补全 /damage/type 的操作并表共享 resolves。
2. 部分实现（唯一合法双收据组合）：若同一条警告只实现了一部分（确有半边属引擎未开放维度），在实现该部分的操作上写 resolves，并在 unresolved 里用同一引用说明还缺什么（必填独立非空中文 reason 字段；注意：凡整条机制可用协议原语如 from:"tape"+replay、before_action.origin、spawn+link_pool、dcBonus/resistBonus 完整表达时，一律直接走「1. 完整实现」只写 patch.resolves，切勿多余塞入 unresolved！）。
3. 先前已实现（existing）：仅当该行为已由**更早标准化批次或首轮已落盘补丁**新增在当前快照的 rules/N 或 mods/N 时，在顶层 existing 提交 {unitId, originPath, message(或唯一effectName), path, value}（**path 必须带具体数字下标如 /skills/<id>/rules/0 或 /skills/<id>/mods/0，value 为该单条对象 {...}，严禁写不带下标的 /rules 或 /mods 整数组**；若返修轮正在提交同技能 rules 补丁，直接将同技能已落盘警告并入该 rules 补丁的 resolves 即可，不要重发无变化的 no-op 补丁）；绝对禁止用转换器初始生成的未修改面板字段冒充 existing！
4. 纯未实现（unresolved）或非战斗外围（narrative）：无补丁改动时二选一——战内缺参或引擎边界归入 unresolved（必填 {unitId, originPath, message, kind, reason}），纯风味外观或战外系统（含所有消耗 fp / FP 外部叙事专用资源的词条！）归入 narrative（必填 {unitId, originPath, message, reason}）。reason 必须为独立非空中文短句！同一条警告严禁同时出现在 narrative 与 patch.resolves / unresolved / existing 中，严禁把本技能主击伤害词条误归入 narrative！
</disposition_ledger>`;
const protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, VM_EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`<output_contract>
【输出契约与材料权威边界】
• 快照的 raw、MVU 和 char_info 是只读来源，里面的「效果」/ effects 只用于理解词条原意；补丁路径严格以当前战局快照的可写模板为准，禁止写 /effects/... 或修改来源资料，只写入对应模板的 rules / mods / pools / skills 等合法字段。
• 顶层 JSON 载荷包含 patch、unresolved、narrative 三个数组（引用先前批次已落地的规则时另附 existing 数组）。narrative 数组每项为 {unitId,originPath,message,reason}，收录纯外观风味及非战棋外围机制；无法在局内实现的机制用同样形状写进 unresolved，附 kind:"missing_info"（原文缺可计算参数）或 kind:"engine_limit"（局内机制暂不支持）。reason 用玩家能理解的简短中文，不暴露 JSON 路径和内部字段名。
</output_contract>

<compilation_invariants>
【五大高阶编译不变式】
1. 战斗域隔离不变式（Domain Boundary）：
   • 沙盘仅结算本场战斗内的棋盘空间、回合时序、检定攻防、状态生灭与局内池（hp / mp / sp / ap）。
   • **消耗 fp（FP / 命运点）硬分流铁律**：只要效果描述中包含消耗 fp（FP）这种外部叙事专用资源（包括消耗 fp 许愿、改写因果或兑换效果），**一律整条直接归入 narrative**（在 reason 中用通俗人话补全说明即可，**既不要映射为战棋战斗规则或局内 mp / sp / hp，也绝对不要塞进 unresolved**）！
   • 其他战外系统分流：纯外观清洁、宝库收纳、跨世界／跨位面随机漫游传送、战外数小时延时复活与库存获取限制同样归入 narrative；不涉及消耗 fp、确属战棋局内规则意图但依赖引擎未开放机制（如永久篡改剥夺敌方技能模板）或缺少战内固定参数的部分，才归入 unresolved（标明 engine_limit 或 missing_info）。严禁把跨世界传送强行映射为棋盘格 move！
2. 快照增量、幂等引用与主击守恒不变式（Snapshot Delta, Idempotency & Conservation）：
   • 快照增量与已存模板禁重定义：动笔前（尤含返修轮次！）先查当前 roster 快照的 skills、statusTemplates 与宿主模板现有键——① 凡当前快照中**已存在**的状态模板或派生技能 ID（含前序批次或首轮已成功落盘的模板），**直接按既有 ID 引用，绝对禁止再次输出 add /skills/<id> 或 add /statusTemplates/<id>**（重复 add 已存在模板会触发共享模板定义冲突并级联拒收宿主规则！）；② 已解析的 initiativeBonus、rawRange / rawRadius / shape、power 直接保留；移除或替换 /skills/<id>/damage 前先核实当前快照该技能确实存在 damage 键（已移除或本来无 damage 键时严禁再 remove/replace /damage，remove /damage 后更严禁再写 /damage/type！）。
   • 主击完备性与并表核销：同时缺少 damage 骰子对象和 active 主击伤害规则时，才缺少主击。转换器会为 [威力: X] 自动写入 damage：① 若原文为单一伤害类型主击，仅用 add 写入 /skills/<id>/damage/type（已有该键用 replace）保留原生主击，并将「主击伤害类型」警告与同技能仅重申该单一主击比例及已解析先手／范围的原词条一并挂在该补丁操作的 resolves 上共同核销（严禁再追加第二段 100% 伤害规则，严禁塞入 existing 或 narrative）；② 若原文明确要求多属性混合主击或独立公式替代主击，同批先核实存在 damage 后 remove /skills/<id>/damage，并在 hook:"active" 内拆为多条 damage 原语，将该混合主击词条与「主击伤害类型」一并挂在主击补丁 resolves 上核销；③ 原文无法确认类型时写 unresolved。
   • 面板去重与单次恢复：HP/MP/SP 是资源池，sp、maxSp 等不是 mods.stat；若来源加成或成长已计入当前快照面板值，保留当前面板，严禁二次叠加。heal 指令本身已直接恢复生命，严禁在同一效果内再写 resource(pool:"hp") 造成双倍回血。
3. 载体定性、宿主直挂与量词保真不变式（Carrier Polarity, Host Reachability & Quantifier Fidelity）：
   • 载体定性与宿主直挂闭环：纯被动载体（passive:true、ap:0，含纯被动技能、常驻背包道具规则载体、长阶被动分支）严禁存在 damage 骰子对象或 hook:"active" 规则；兼具环境／条件常驻生效与主动施放的双态载体，必须同时实现常驻触发／脱离解除钩子与 hook:"active" 分支，严禁丢失常驻半边退化为纯主动！被动首次触发逻辑（如濒死 on_lethal_p1/p2、回合初、受击响应）**必须直接挂在角色当前已持有的宿主技能或装备／道具模板自身的 rules 上**，严禁把首次触发钩子只写进一个尚未挂在角色身上的衍生状态模板里（未持有该状态则钩子永不可达！）。装备自身的无目标 0 AP 开关写装备模板 hook:"active"（配 label）；需选落点、选目标或有射程耗能的装备主动能力，先 add /skills/<id> 再将该 ID 并入装备 skills 数组（或在无目标 active 内先 ask 选格再传 to，严禁写缺 to 的裸 teleport）。
   • 常驻监听精准过滤：单位持有的所有装备（含主副手、防具饰品及备用武器 bagWeapons）与技能的非 active 规则及 mods 默认全局常驻监听全场所有单位！① 全场广播钩子主语强制绑定：在进攻／命中／击杀钩子（before_check / after_hit / after_damage / on_kill）中，“我方发起”必写 attacker.id == self.id；在**受击、防御预判、结算拦截、状态拦截及濒死／阵亡钩子（before_check / before_commit / before_status / after_damage / on_lethal_p1 / on_lethal_p2 / on_death）**中，“我方受击／针对我方检定／我方濒死或阵亡”**必须显式写 filter:"target.id == self.id"**（防御敌方攻击配 target.id == self.id && attacker.team != self.team；**绝不可在 on_lethal_p1/p2 或 on_death 留 filter:null**，否则全场任何敌友濒死都会误触发我方濒死被动！）；受击方钩子内若需令进攻方掷 check(kind:"save")，必须先用省略 bind 的 for_each(select:{from:"attacker"}) 切换子帧 target，防止己方替敌方掷豁免！② 武器与非武器隔离：仅在 kind:"weapon" 武器模板限定本武器时写 event.weaponTemplateId == item.templateId，防具／头饰／靴子／箭袋／饰品（kind:"armor" / "accessory" / "shield"）严禁写此条件；③ 远程、技能来源与召唤顶替：远程限定必写 !event.melee；仅施放本主动技能时触发的非 active 规则必写 event.skillId == skill.id；**被动监听己方旧召唤物被顶替或到期消散用 on_summon_evict 配 filter:"source.id == self.id"（或 target.summoned && target.team == self.team，注意单位 target/self 无 .sourceId 字段，.sourceId 仅属 candidate 与 zone；查单位标签必用函数 has_tag(candidate, '<tag>') 而严禁写 candidate.tags！）**；④ 单次主动施放内的顺序因果链全部按序写在同一个 hook:"active" 内用 out / outCount 串联。
   • 空间边界与计次量词保真：select.from == "units" 包含全场存活者、尸体、友军与自身！选敌必写 where:"candidate.alive && candidate.team != self.team"，无差别排除自身写 where:"candidate.alive && candidate.id != self.id"，选友军写 where:"candidate.alive && candidate.team == self.team"，复活阵亡友军写 !candidate.alive && candidate.team == self.team；原文限定在技能范围或指定半径内生效时必须配 from:"action_targets" 或 area 几何半径，严禁无范围全场遍历，更严禁写 || true 等恒真过滤！严格区分存在布尔（任一满足触发一次 → ||）与独立基数累加（“每存在一种指定状态／每有一层／每命中一目标各叠加一次”必须按 (condA ? 1 : 0) + (condB ? 1 : 0) + ... 或乘以层数逐项累加，严禁坍缩为 > 0 单次加成！）。词条相对档位距离在模板写 rawRange / rawRadius，在公式写 scale_cells(n)；位移标签 [位移: X] 写 distance:X 与 distanceUnit:"position"。
4. 符号对称、参数闭环与正交原语穷尽不变式（Sign Symmetry, Closure & Primitive Exhaustion）：
   • 增益为正、减益为负与参数闭环：所有声明式修饰严格遵守符号方向——正面收益与受击减免（增伤、穿甲、自身闪避加成、检定加值及受击减伤 damageReduction / dr / damageReductionFlat）一律填**正数**（如受击减伤 30% 必写 flat:0.3）；反之，挂在负面减益／控制状态上**削弱受控目标闪避、检定、移动或五维**的修饰，flat **必须填负数**（如令目标闪避降低 10 必写 stat:"dodge", flat:-10，填正数会反给敌人加闪避！）。凡状态或载体模板读取 vars.*（特别是 category:"shield" 读取 vars.shieldAmount），每次 apply_status 必须在 vars 中显式传入求值表达式，严禁漏传参数或留空壳状态模板！控制状态若限制瞬移／飞行，须在 locks 中完整并入 "teleport" / "fly"。
   • 先尝试用正交原语拆解组合，再考虑放弃：动用 engine_limit 前必须穷尽协议已披露原语——① 状态施加／自身抵抗加值用 mods 的 dcBonus / resistBonus（配 statusId:"<状态ID>" 或 checkKind:"save"），**按单一五维属性拆分的检定／豁免加值直接用 mods 的 checkBonus / dcBonus / resistBonus / advantage 配 when:"event.stat == 'spi'"（str/agi/con/int/spi），逃跑检定修饰配 checkKind:"flee"**；② **暴击伤害倍率加成直接写 mods 的 {stat:"critDamageBonus", flat:0.3}（仅用 flat），对免疫某状态目标增伤用 is_immune(target, '<状态ID>')，相对朝向／背身判定直接用 facing_arc(observer, point) == 'back' 及 before_target 的 event.backX / event.backY**；③ 复刻重演本回合已执行行动（无论单条或遍历多条历史技能记录）一律用 for_each(select:{from:"tape", where:...}) 配合 perform(actionKind:"replay", tapeRecord:"vars.x") 与 usesPerBattle:1 直接落地；④ 改变技能生效原点（如把施法起点投射至指定坐标或实体）直接用 before_action 的 mutate_event:{patch:{origin:...}} 落地；⑤ 范围攻击中替特定友军单点承伤用 before_target 的 replaceTarget:{from, to}（全目标改指才用 redirectTarget）；⑥ 双生同命分身用 round_start/turn_start 判重 + spawn(entityKind:"unit") + link_pool(pools:["hp","mp","sp"]) + shareRulesTo 落地，**濒死帧（on_lethal_p1 / on_lethal_p2）可直接读取 event.finalAmount / event.dealt / event.overkill 获取本次致死伤害量（如按致死伤害回蓝或转化）**，濒死换池用 resource(mode:"swap")，按任意数额截取伤害或转化资源用 ask(kind:"number") 配合 before_commit.finalAmount 或 resource；⑦ 战意锁定与友军可选用 controlPolicy（moraleLock:"steady", allowFriendlyTarget:true）；⑧ 跨载体计数与**“每目标限一次”标记（给目标挂 persistent 隐藏标记状态并用 !has_status(target, '<标记ID>') 门控）**统一用状态模板实现；定时状态到期后置效果挂该状态自身 after_status_removed（filter:"event.statusId == status.id && event.reason == 'expired'"）。
   • 真实边界诚实披露：唯有确属引擎未开放维度（如暴击阈值档位平移、拦截外部任意未知 ID 控制类别的泛化条件、无蓄力直发覆盖、跨战长延时或永久篡改剥夺敌方技能／装备表等），在将可实现部分落地后，仍无法表达的部分列入 unresolved 并附清晰中文 reason，严禁把局部细分加值硬塞进无条件全局 checkBonus！
5. 批内自足、只读索引复用、RFC 6902 数组类型铁律与闭合 Schema 不变式（Self-Containment, Readonly Index Reuse, Array Type Contract & Schema Closure）：
   • **<role_readonly_index> 共享状态复用与跨载体只读边界**：
     ① 看见快照末尾 <role_readonly_index DO_NOT_PATCH="true"> 内 sharedStatusLedger 已列出的状态模板（及内置 STATUSES、当前快照 statusTemplates）时，**凡同名或同机制状态必须直接复用其既定英文 statusId，绝对禁止重复输出 add /statusTemplates/<该ID> 或另起近义 ID 重复建表**！确属尚未注册的新状态或派生技能，才在当前批次 patch 数组最前部先 add 完整模板定义（严禁建空对象 {}！），本批内所有引用逐字符一致，同一模板 rules 内规则 id 互不重复。
     ② <role_readonly_index> 中的 siblingCarriersIndex 仅供了解同角色其他装备／技能的联动状态命名与触发语义，**绝对禁止对未出现在本批 warnings 中的兄弟载体输出任何 patch 操作或核销收据**！
   • **RFC 6902 数组字段 [...] vs 元素追加 /- 铁律（严禁类型错配与重复整表覆盖！）**：
     ① 当 path 指向数组属性本身（末尾**不带** /-，如 /skills/<id>/rules、/equipment/<id>/mods、/equipment/<id>/skills）时，**value 必须是 JSON 数组 [...]**（即使只有 1 条规则或 1 个技能 ID，也必须写成 [{"id":...}] 或 ["skill_x"]，**绝对禁止对不带 /- 的 /rules、/mods、/skills 传入单个对象 {...} 或裸字符串，否则必触发 Schema 拒收与运行时崩溃！**）；且同一批次内对同一模板的同一数组属性**最多只允许写一次**（同一载体的多条规则必须合并进同一个 [rule1, rule2, ...] 数组，严禁在同批写两次 add .../rules 导致后一条把前一条规则整表覆盖抹除！）。
     ② 当向快照已存在的 rules 或 mods 数组逐条追加单个元素时，path **必须以 /- 结尾**（如 /skills/<id>/rules/-、/equipment/<id>/mods/-），此时 value 才是单个规则或修饰对象 {...}（注意装备初始无 skills 数组键，故装备挂载主动技能一律写 /equipment/<id>/skills 并传去重后的字符串数组 ["<技能ID>"]）。
   • 闭合 Schema、顶层 resolves 边界与括号配平：所有宿主模板、rule、statMod 与 opcode 均为严格闭合 Schema（**特别注意：/statusTemplates/<id> 状态模板只有 stackMode 与 maxStacks，严禁写运行时字段 stacks；costMult / damageMult / finalDamageMult / healingMult 基值为 1，只用 mult 或 additivePercent，严禁写 flat（哪怕 flat:null 也会被拒收）！**）；**严禁在 rule 对象（{"id":...,"hook":...,"program":[...]}）或 mod 对象内部写入 resolves、comment 等键！当向 /skills/<id>/rules 写入规则数组时，program 的 ] 闭合后，必须先写 }] 依次闭合当前 rule 对象与 value 数组，然后才能在 patch[i] 操作对象层级写 ,"resolves":[...]（形如 ..."program":[...]}],"resolves":[...]}）**！多召唤物、召唤物阵亡反噬或多段 if/else 分支规则一律拆为宿主 rules 数组下扁平并列的独立 rule（如监听召唤物死亡直接并列写 hook:"on_death", filter:"target.summoned && target.team == self.team" 规则，切勿在 spawn 指令内部再深层嵌套 rules/for_each 导致 ]} 多括号失配！）。
</compilation_invariants>

【宿主模板闭合字段与枚举全表】
• 骰子对象 dice（用于 damage / heal）：必填 count（整数 0…1000000）、sides（count>0 时整数 ≥1）；可选 bonus（整数）、stat（枚举：str / agi / con / int / spi）、multiplier（数值 0…8）、type（damage 伤害类型枚举：physical / energy / mental / true）。协议规则下常规主击由模板 power、关联属性 stat 与伤害类型 type 驱动，但 damage 对象必须存在（如 {"count":1,"sides":4,"stat":"str","type":"physical"}）。
• 额外消耗对象 resourceCost：{"hp"?:0…25000, "mp"?:0…25000, "sp"?:0…25000}（至少一项），或自定义装备池 {"resource":"<池ID>", "amount":1…1000000}。
• 自定义池表 pools：{"<池ID>": {"cap": 非负数或数值Expr, "initial"?: 非负数或数值Expr（≤cap）, "reloadable"?: boolean}}（已有装备初始化需数值 cap；装备自身规则内用 resource 的 local:true 读写本实例池，跨技能动态计数请改用常驻叠层状态 self.stacks.<状态ID>）。
• 通用载体字段（装备、技能、状态模板均支持）：tags（小写标签数组 ^[a-z0-9][a-z0-9_-]{0,31}$）、tier（整数 1…7）、vars（ID → Expr）、flags（枚举数组：undispellable / concept_immune）、mods（statMod 数组）、rules（rule 数组）、pools（装备与技能支持）。
• 技能模板 /skills/<id>：
  - 必填：name（非空文本）、ap（整数 0 / 1 / 2，0 不占槽）、slot（枚举：attack / action）、range（整数 0…64）、shape（枚举：single / circle / ring / fan / cone / line）、target（枚举：enemy / ally / self / any / corpse / cell）。
  - 可选：quality（枚举：唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、power（整数 0…1000000000）、mp（整数 0…25000）、sp（整数 0…25000）、resourceCost、damage（dice 对象）、heal（dice 对象）、damageType（枚举：physical / energy / mental / true）、accuracy（整数 -20…30）、initiativeBonus（整数 -100…100，按 slot 计入开场先手）、passive（boolean）、backpackItem（仅背包消耗品为 true，须配 ap:1、slot:"action"，保留库存且不加入单位 skills）、school（文本）、save（枚举：str / agi / con / int / spi，须与 saveDC 成对出现）、saveDC（整数 1…50、缩放对象或 Expr 字符串）、radius / innerRadius / width（数值 0…30）、angle（整数 1…360）、rawRange / rawRadius / rawInnerRadius / rawWidth / rawMoveDistance（非负数）。
• 装备模板 /equipment/<id>：
  - 必填：name。武器若声明 range（整数 0…64）则必须同时声明 damage（dice 对象），二者成对出现；武器斜杠分段距离第一项归模板普攻，后续项依次归挂载的装备主动技能。
  - 可选枚举：quality（唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、kind（weapon / shield / armor / accessory / consumable）、weaponClass（light_blade / ranged / greatsword / staff / shield / auxiliary）、hand（one_handed / two_handed / off_hand）、rangeType（melee / ranged）、shape（single / circle / ring / fan / cone / line）、target（enemy / ally / self / any / cell）。
  - 可选数值与布尔：attack（整数 0…1000000000）、accuracy（整数 -20…30）、armor（整数 0…1000000）、defense（整数 0…1000000）、ranged / closeQuarters / heavy / twoHanded / shield（boolean）、boundTo（单位 ID）、weaponType（文本）、skills（技能 ID 数组，去重）、radius / innerRadius / width / angle / raw* 距离字段及通用载体字段。

<std_audit_workflow>
【五步前置审校工作流（<std_audit>）】
正式生成 JSON 前，必须先在 <std_audit>...</std_audit> 标签内按以下五步完成极简结构化审校（每条警告仅占紧凑一行，严禁长篇推导挤占输出空间）：
Step 0 [警告盘点]：按输入原序编号列出本批全部警告 W1..Wn（单位ID | originPath | 效果标题），确认总数一致。
Step 1 [边界与快照增量裁定]：逐条核查战斗域边界（**凡包含消耗 fp / FP 外部叙事资源的词条一律整条定性为 NARRATIVE，绝不入 UNRESOLVED**）、当前快照已解析字段（先手/范围/威力/纯被动 vs 双态载体）及原语可表达性，定性为 FULL_PATCH / PARTIAL_PATCH / EXISTING / UNRESOLVED / NARRATIVE（严禁把主击归入 narrative 或初始面板归入 existing）。
Step 2 [作用域、量词与符号核对]：锁定宿主载体路径（被动首次触发必挂已持有宿主自身 rules 而非未施加状态模板！）、钩子与过滤条件（进攻检 attacker.id == self.id；**受击、防御预判、before_commit、before_status 及濒死 on_lethal_p1/p2、on_death 必显式写 filter:"target.id == self.id"，严禁在濒死钩子留 filter:null！** on_summon_evict 检 source.id == self.id，切勿写不存在的 target.sourceId 或 candidate.tags；仅武器检 weaponTemplateId；限定武器／技能击杀用 after_damage 检 !target.alive && event.dealt > 0；远程检 !event.melee；主动技附效检 event.skillId == skill.id；选人必检存活、阵营与空间范围；受击迫使进攻方豁免用无 bind 的 for_each(from:"attacker")）；核对正负号（自身增益与受击减伤 flat 为正数，负面状态扣闪避／检定／移动 flat 必为负数！）、护盾等状态 vars 传参闭环、多状态／多层累加量词（逐项相加而非 >0 布尔）及 persistent 状态 remove_status 必带 force:true。
Step 3 [批内自足拓扑、只读账本复用、数组类型与收据绑定]：先查 <role_readonly_index> 的 sharedStatusLedger、内置 STATUSES 与当前快照，**凡已列出的状态／技能 ID 直接复用且严禁再次 add，同时严禁触碰未在本批 warnings 出现的 siblingCarriersIndex 载体**；确需新建的状态／派生技能按「新建基础状态 → 新建复合状态 → 新建派生技能 → 本批警告宿主载体」排列 patch；**逐条硬核对 RFC 6902 数组类型：不带 /- 的 .../rules、.../mods、.../skills 其 value 必须是 [...] 数组（绝不可为单对象 {...}！）且同路径同批最多写一次**；确认操作 /damage 前快照确有该键且 remove /damage 后不再写 /damage/type；为每条 FULL_PATCH / PARTIAL_PATCH 绑定宿主载体顶层 patch[i].resolves（勿挂在 /statusTemplates/... 上；返修轮对前轮已落盘项直接并入本轮同宿主有效补丁 resolves 或用带数字下标的 existing 如 /skills/<id>/rules/0 核销，切勿重发 no-op 补丁！），并为每条 UNRESOLVED 与 NARRATIVE 准备独立非空中文 reason；核对路径白名单：${normalizationPath}（禁止写 /units/<id>/pools、/items/<id>/pools、运行时当前 HP/MP/SP、坐标或先攻队列；若 /items/<id> 已自带 rules 或 mods 需同步更新）。
Step 4 [闭合 Schema 与括号配平门控]：逐项检查 hook 枚举、op 闭合字段、目标引用、池名称、状态 ID 与数值范围（再次确认不带 /- 的 /rules、/mods、/skills 全部为 [...] 数组而非 {...} 对象！critDamageBonus 只用 flat 小数如 0.3；additivePercent 为小数制如 0.5 而非 50；顶层 flags 仅写 undispellable / concept_immune，行为标志写 mods[i].flags；ask 按 kind 配齐必填键与合法 aiPolicy；mutate_event 仅写当前 hook 允许字段）；**重点核查每一个 rules 补丁的闭合序列：program 结束 ] 后必须紧跟 }] 闭合 rule 对象与 value 数组，随后才是 ,"resolves":[...]（rule 对象内部严禁出现 resolves 键！）**；确认 W1..Wn 100% 覆盖且收据严格互斥，最后写出 Coverage: PASS | Schema: PASS。
</std_audit_workflow>

<tail_anchor>
【最终输出格式与启动锚点】
严格按「一个闭合 <std_audit>...</std_audit> 块 + 紧接唯一一个顶层纯 JSON 对象」输出。JSON 顶层结构固定为：
  {"patch":[{"op":"add","path":"<允许路径>","value":"<合法模板或字段值>","resolves":[{"unitId":"<单位ID>","originPath":"<来源路径或null>","message":"<原警告全文>"}]}],"unresolved":[],"narrative":[]}
整批仅有 unresolved 或 narrative 时提交 "patch":[]；引用既有标准化成果时另附 "existing":[...]。输出大型规则或多召唤指令时保持扁平层级并逐层核对 } 与 ] 闭合配对，</std_audit> 闭合后立即以 { 开始输出完整合法的纯 JSON，**顶层 JSON 对象的根 } 一旦闭合必须立即结束输出——严禁在开头输出尖括号或代码围栏，严禁在最终 JSON 的根 } 之后重复输出 </std_audit> 闭合标签、多余括号、注释或拆成两段顶层 JSON 对象**！
现在立即从 <std_audit> 开始执行审校并输出最终 JSON：
</tail_anchor>`;
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
  const slots = entries.map(slot => ({ ...defaults.get(slot.id), ...slot,
    ...(needsIdentity && defaults.has(slot.id) && slot.role === 'user' ? { role: 'system' } : {}),
  }));
  return needsIdentity ? [{ ...DEFAULT_SLOTS[0] }, ...slots] : slots;
}

const distinct = values => [...new Set(values.filter(Boolean))];
function scopedRoster(ctx, state, warnings) {
  const pick = (table, ids) => Object.fromEntries(distinct(ids).filter(id => Object.hasOwn(table ?? {}, id)).map(id => [id, table[id]]));
  const units = pick(state.units, ctx.onlyUnitIds), rows = Object.values(units);
  const items = pick(state.items, rows.flatMap(u => [u.mainHand,u.weapon,u.offHand,u.shield,...(u.gear ?? []),...(u.bagWeapons ?? [])]));
  const equipment = pick(state.equipment, Object.values(items).map(i => i.templateId));
  const skills = pick(state.skills, [...rows.flatMap(u => [...(u.skills ?? []), ...Object.keys(u.inventory ?? {})]), ...Object.values(equipment).flatMap(e => e.skills ?? [])]);
  const roster = { raw:pick(ctx.rawCharacters, ctx.onlyUnitIds), units, items, equipment, skills, statusTemplates:state.statusTemplates };
  if (!warnings.length) return json(roster);

  // Match canonical converter identities (not display names, which can collide).
  const targets = new Set(warnings.map(w => {
    const [, table, id] = (w.originPath ?? '').split('/');
    return table === 'items' && items[id] ? `equipment:${items[id].templateId}` : `${table}:${id}`;
  }));
  const entryTables = ctx.characterEntries ?? {};
  roster.raw = Object.fromEntries(ctx.onlyUnitIds.map(id => {
    const entries = entryTables[id] ?? {};
    return [id, { unit:entries.unit ?? units[id], ...pick(entries, [...targets]) }];
  }));
  const rawCarriers = Object.assign({}, ...ctx.onlyUnitIds.map(id => entryTables[id]));
  const siblings = [];
  for (const [table, carriers] of Object.entries({skills,equipment})) for (const [id, c] of Object.entries(carriers)) {
    const key = `${table}:${id}`;
    if (targets.has(key)) continue;
    const type = table === 'equipment' ? '装备' : c.passive ? '被动技能' : '主动技能';
    const terms = [...mechanismTerms(JSON.stringify(rawCarriers[key] ?? c))].slice(0, 4);
    const count = c.rules?.length ?? 0, mods = c.mods?.length ?? 0;
    siblings.push(`[${type}]${id} ${c.name ?? ''}|${terms.join('/')}|${count || mods ? `${count}规则${mods ? `/${mods}修饰` : ''}` : '待后批'}`);
  }
  const ledger = Object.entries(state.statusTemplates ?? {}).map(([id,s]) => [id, s.name, `${s.maxStacks ?? 1}/${s.stackMode ?? 'refresh'}`,
    s.tags?.join('/') ?? '', distinct((s.mods ?? []).map(m => m.stat)).join('/'), distinct((s.rules ?? []).map(r => r.hook)).join('/')].join('|'));
  return `${json(roster)}\n<role_readonly_index DO_NOT_PATCH="true">\nsharedStatusLedger：ID|名|层/叠法|标签|mods|hooks；复用 statusId，勿重复 add。\n${ledger.join('\n')}\nsiblingCarriersIndex：仅供联动，勿改勿核销。\n${siblings.join('\n')}\n</role_readonly_index>`;
}

export function resolveSlotContent(slot, ctx = {}) {
  const { sources = {}, state, instruction = '' } = ctx;
  const warnings = warningsForUnit(sources.warnings, ctx.onlyUnitIds);
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
    return json({ roster: ctx.roster ?? sources.roster, units: state.units, equipment, skills: used(state.skills, skillIds), items: state.items, statusTemplates: state.statusTemplates });
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
    case 'warnings': return ctx.warningsText ?? (warnings.length ? `待处理警告：\n${variables.warnings()}` : '');
    case 'task': return expand(ctx.taskText ?? (ctx.kind === 'chat' ? '【辅助 AI 对话】玩家咨询时，直接用文字回答。玩家明确要求调整已加载的战局时，输出 {"patch":[{"op":"replace","path":"/units/p1/armor","value":6}],"unresolved":[]} 形状的 JSON，按请求使用快照中的真实路径和值。装备、技能和状态的变更值遵循上面的 VM 协议。标准化任务单独处理警告。' : PATCH_RULES + (instruction ? '\n玩家补充：{{user_instruction}}' : '')));
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
