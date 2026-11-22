import { effectSchema } from '../core/effect_schema.js';
import { formulaReference } from '../core/formula.js';

const { expression, condition, node, expireOn } = effectSchema.$defs;
function describe(rule) {
  if (rule.$ref) return rule.$ref.split('/').at(-1);
  if (rule.oneOf) return rule.oneOf.map(describe).join(' 或 ');
  if (rule.enum) return rule.enum.join(' / ');
  if (Object.hasOwn(rule, 'const')) return JSON.stringify(rule.const);
  if (rule.type === 'array') return `${rule.minItems}…${rule.maxItems} 项 ${describe(rule.items)} 数组`;
  if (rule.type === 'object') return rule.additionalProperties ? `键→${describe(rule.additionalProperties)}` : `{${fields(rule)}}`;
  if (rule.type === 'integer' || rule.type === 'number') return `${rule.type === 'integer' ? '整数' : '数值'} ${rule.minimum}…${rule.maximum}`;
  if (rule.pattern) return `ID (${rule.pattern})`;
  if (rule.type === 'string') return `非空字符串，字段长度 ${rule.minLength}…${rule.maxLength}`;
  return rule.type;
}
function fields(rule, skip = []) {
  return Object.entries(rule.properties).filter(([key]) => !skip.includes(key))
    .map(([key, value]) => `${key}${rule.required.includes(key) ? '' : '?'}=${describe(value)}`).join('，');
}

export const EFFECT_PROTOCOL = `【统一效果 DSL】
场景声明规则：battle_init 的 unit 行可写 x,y,z，z 为初始地形高度（-4…8）；省略 z 为 0。terrain 模式会围绕显式高程合理生成高台和坡道，flat 模式仍全为 z=0。初始飞行或悬浮由 unit 坐标末尾的 飞行=n 或 悬浮=n 声明，表示离开脚下地形的高度，未注明高度时按 3 处理。可选 0–2 条 cover 行，格式为 cover|掩体ID|半或全|掩体名称|x,y,z，半掩体 cover=2、全掩体 cover=5；可选 0–2 条 interact 行，格式为 interact|互动ID|altar或barrel|效果|范围|伤害数值|互动名称|x,y,z。效果枚举为 explode、heal、shield、restore。explode 用攻击槽并按武器射程和视线触发，范围为半径、伤害数值为爆炸伤害；heal 用动作槽相邻激活并回复伤害数值的 HP；shield 用动作槽相邻激活并给予伤害数值的护盾；restore 用动作槽相邻激活并同时回复伤害数值的 HP、MP、SP。
changeAltitude 是辅助模型用于把技能、装备或状态效果标准化为飞行/悬浮的 DSL 节点。它不属于 battle_init。节点默认 delta 为 3，可用负值下降，land:true 直接落地。单位离地高度会进入三维距离、移动、视线和战报 z 快照。地形节点 modifyTerrain（terrain: raise/lower/set，整数 amount；z 限 −4…8）、setTerrainKind（terrainKind: floor/wall/slope）、addCover（hp）均必填 area。area 四种写法：{"cells":[{"x":3,"y":4}]}、{"rect":{"x1":3,"y1":4,"x2":5,"y2":6}}、{"center":"hitTarget","radius":1}（也可 self 或 {x,y}）、{"center":"self","radius":1,"follow":true}。圆以棋盘平面欧氏距离计算。主动地形技能用技能模板 target: cell 选择地面格，表达式 target: self，area.center: hitTarget 取瞄准格。follow 必须有真实单位锚点，回合结束更新，死亡或离场消散。
remainingTurns 以单位回合结束递减，省略为 1，persistent:true 在本场持续（跟随区域仍受锚点生存限制）。到期或消散时立即还原原高度、类型并移除临时掩体，不因占用延迟。施加或还原地形时，坡的等效高度固定为 1，其他格按 z；等效高度下降时，格上的存活且未离场单位按每 1 高度差受到 50 点固定坠落伤害。抬高时单位随脚下地形升高。新造墙跳过占用格，全部因单位占用时记录未解决。已有掩体或互动点也会阻止造墙。
装备与技能 effects 都是表达式数组（0…24 项）。每条表达式使用战局内唯一 id，label 是界面显示名。外层没有 kind，内层节点必须有 kind。五段写法：WHEN(trigger) → IF(condition，可省) → ROLL(可省) → TARGET(target) → DO(effects)，WITH 以节点字段或共享 params 表达。节点同名字段覆盖 params。除表中声明字段外不允许额外字段，? 表示可省。
表达式字段：${fields(expression)}。

WHEN：passive 持续读取，常驻修正用 self 且省略 roll。on_attack 为武器出手、命中前。on_hit 为判定命中后，对实际承伤者触发，若不希望豁免成功时触发则加 saved=false。on_damaged 为实际扣血后，可读 attacker、伤害量和 melee 等标签。on_kill 为击倒敌人，on_death 为自身死亡，on_ally_death 为队友死亡（事件目标为倒下的队友）。on_turn_start / on_turn_end 对应自身回合。on_skill_cast 为技能释放，结算主击前。on_equip 装备同步时触发，默认每战一次。on_heal 为发出治疗后，可读治疗量。active 为技能主动发动，写在装备上时独立生成按钮，默认 1AP 和 action 槽。技能的 active / on_skill_cast 表达式声明 params.usesPerBattle 或 cooldown 时限制整招，合法施放即扣一次，失手、豁免或空放也计数；装备生成的 active 技能同理。只限制命中追加效果时在 on_hit 表达式声明，实际生效才计数。usesPerBattle:null 表示不限次数（也覆盖 on_equip 默认每战一次），cooldown 以战斗轮计。params.source=weapon 表示只在本次使用该装备实例时生效。

IF：数组等价于 AND，or 任一成立、not 取反。self 为受益者时，目标条件优先检查当前攻击或技能对象。targetHasCategory 的 negative 指 debuff/dot/control，none 指无三类负面状态。timeOfDay 来自 <tp>，targetLevel 与自身比较。布尔条件省略 value 等同 true。weaponType 可匹配实际出手武器的子类（弓、弩、火枪、投掷武器）或大类（如 ranged）。饰品仅强化弓普攻时用 condition:[{type:'actionType',value:'attack'},{type:'weaponType',value:'弓'}]，配合 on_hit 追加伤害；不要用 arrow 代指弓，也不要给饰品写 params.source:'weapon'。skillSchool、标签及物种字符串与快照一致。
• ${condition.oneOf.map(rule => rule.type === 'array' ? describe(rule) : `${rule.properties.type.const} ${fields(rule, ['type'])}`).join('\n• ')}

ROLL：无 roll 时一定尝试。chance 直接用 0…1 比例，d20 比较 >= gte。save 取目标 d20+属性，达到 dc 则通过并跳过节点。save 数组必须提供 mode，成员唯一，每项独立掷骰。contest 的攻方 d20+attacker 减守方 d20+defender 达到 dc 时执行节点。豁免或对抗可同时提供 chance 作为前置概率门。dc 与技能 saveDC 均支持公式，见上节数值协议。

生命周期：状态模板和 grantStatus 节点均可声明 expireOn = ${describe(expireOn)}。任一规则匹配就立即移除并记录原因。on_struck 在命中结算中、计算碎裂增伤之后且扣减护盾之前匹配，即使护盾完全吸收也触发；on_attack 在发动攻击或敌对技能时匹配。on_damaged 只在实际扣 HP 时匹配；缺省或 any 匹配全部，direct 匹配主击或主动命中的伤害，indirect 匹配周期、反伤及环境等非直接伤害。on_heal 在持有者实际恢复 HP 时匹配；回合事件在周期结算前打断。exceptSource:self 排除来源为状态持有者的事件。授予节点的规则优先，其次保留实例规则，最后使用模板规则。patchStatus 可覆盖实例 expireOn，传 null 关闭。
效果开关：每个节点可写 enabled:true 或 enabled:false，缺省视为 true。false 跳过该节点（如果是 chainEffect，也跳过其子节点），其他节点照常结算。剧情/语义判断由模型自行决定，通过 enabled 开关表达，引擎不做条件求值。已结算的结果按各自的规则继续处理。防御节点 modifyStat(stat:defense) 修正护甲结算，condition:intercepting 将其限制在替队友承伤时。

TARGET：self 自身，hitTarget 当前命中或选中的单位，attacker 攻击者，killedUnit 被击倒单位，corpse 未被消耗的尸体。enemiesInRadius / alliesInRadius 使用 params.radius 或节点 radius（默认1格），施法范围内从覆盖格筛选。节点可覆写目标。技能范围支持 single/circle/ring/fan/cone/line，可用 radius、innerRadius、width、angle(1…360)。范围伤害默认按覆盖格筛选敌我双方（会吃友伤）；单体技能必须明确 target:enemy/ally/self/any；target:cell 只选地面格。尸体不会阻挡移动，raiseDead 会消耗尸体。

DO / WITH：节点按数组顺序执行，每个节点均可加 label、target、condition 和 radius（0…15）。数值字段也支持安全的四则公式字符串，可用数字、括号、+ - * /，不支持函数调用、属性访问或随机数。变量来自受控的公式上下文注册表，而不是任意 state 路径。当前可用变量为 ${formulaReference}。self 是效果主体，attacker 是事件攻击者，target 是当前效果目标。资源和状态层数只能使用注册表提供的 self.resource.<resourceId>、target.resource.<resourceId>、self.stacks.<statusId> 形态。例：命中后按攻击者力量缩放，写 {"kind":"damage","flat":"weapon.attack*(attacker.str-5)/attacker.str","damageType":"physical"}。公式只在该节点实际结算时读取当前上下文，除零或无效运行时结果会跳过该节点并记录公式错误。condition 可用 {"type":"compare","left":"attacker.str-5","op":">=","right":5}。变量名大小写敏感。公式中不能使用中文变量名、任意 state 路径或函数调用。
• ${node.oneOf.map(rule => `${rule.properties.kind.const}：${rule.description} ${fields(rule, ['kind','enabled','label','target','condition','radius'])}`).join('\n• ')}

伤害类型：physical 使用全额护甲，energy 使用一半护甲，mental 和 true 无视护甲。true 跳过属性、比例与固定减伤，仍消耗护盾。流血、中毒及未注明类型的状态周期伤害按 true 结算。状态 modifiers.damageType 同时限定该状态的伤害相关修饰，通用修饰独立生效。
非致命：damage 节点 lethal 默认为 true。lethal:false 只保护该节点的实际承伤者，允许组合 resourceMultiplier、strikeBonus；抵扣结算后最低留 1 HP。承伤单位 nonLethal:true 或其状态 modifiers.preserveLife:true 也保命，lethal:true 不能绕开。倍率不能保证不致死。独立的主击和其他伤害节点不自动继承此开关。
数值与结算：amount/flat 是绝对量，也可以是上述公式；百分比以小数表示。percentOfPrevious 读取链内上一数值节点的实际结果，percentOfDamageDealt 读取本次实际扣血，percentOfPower 乘技能基础威力，percentOfHealing 读取治疗经加成后的量。公式使用本次事件上下文：event.dealt 是已经实际扣除的 HP，不是原始伤害；event.power 是技能威力；event.previous 是同一节点链上一步数值；event.healing 是实际治疗量。levelScaling.perLevel 从 1 阶基准每阶增长，min/max 则在 1…7 阶线性插值。resourceScale 读取存量，可用 unitSize 向下取整分组。multiplyDamage 的 factor 是总系数（+12% 写 1.12），additive=true 合并各系数相对 1 的增量。主击乘区使用 passive/on_attack/on_skill_cast。modifyDamageBase 替换起伤，ignoreAttributes 缺省为 true，unscaled 跳过评级和姿态等攻击倍率。forceOutcome 保障命中或暴击，upgradeHitTier 提高已命中的评级。modifyCheck 的各项分别服务于先攻、闪避、潜行、命中、核心意图、高地和优势。teleportBackstab 校验背后空格再移动，提供优势和伤害倍率。knockback 碰撞默认伤害 5 并眩晕。
资源：hp/mp/sp/ap 和 attack/action 为内置资源。其他资源可存于单位，或由 passive/self 的 produceResource(cap,initial) 声明为装备实例计数，items.counters 必须与资源声明相符。local=true 只访问该装备自己的池。reloadable 声明可装填资源，配 on_attack 的 drainResource 消耗。无限弹药是状态 infinite_ammo，消耗条件可用 selfStatusModifier(key=infiniteAmmo,value=false)。requireFull 余额不足时停止当前节点列表，minimumRemaining 设置最低保留量。技能 resourceCost 在施放前扣除，percentPerCost 按花费恢复。execute 的 strict 选择严格低于阈值，requiresPool 检查指定装备池。stopOnFailure 链会在首个未产生效果的节点停止。
资源方案：先在持有装备 effects 加一条 passive/self 表达式，节点 produceResource 写 resource、cap 和 initial；同批向对应实例 /items/<id>/counters/<resource> 添加初值。只写实例计数会被拒绝。斩杀技能先 execute，成功后在同链对 self 使用 produceResource(targetTierBase)，该数值按目标阶级计算。自用技能设 target=self、range=0，通过模板 resourceCost 扣装备资源，恢复各项用 restoreResource 的 percentPerCost。装备成长可分别放五个基础属性节点，或对伤害用 modifyStat(stat=damage)，用 percent=1 与 levelScaling:{min,max} 表示成长比例范围。检定加值用 modifyCheck，箭矢与一般远程分别用 arrow=true 与 melee=false。
状态：grantStatus 使用已有 ID，若需自定义先定义 statusTemplates。modifiers 只可覆盖模板已有键。amount 仅用于模板声明了 modifiers.amount 的状态，范围 1…10000。removeStatus 必须选 statusId 或 category 之一，all_negative 清除非永久 debuff/dot/control。procEffect 通过 ref 查找已定义表达式并执行，其自身门槛仍有效，禁止循环引用。addItem 按物品 ID 增加单位库存。`;
