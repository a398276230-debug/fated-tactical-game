// Static prompt reference, not executable combat logic. Keep the table helpers
// distinct from the paths actually taken by combat.js during a strike.
export const PROTOCOL_RULES = `【判定｜protocol 实战】
先攻＝agi×(1+initiativePercent)+d20+max(0,...attackInit)+max(0,...actionInit)+flatInitiative；总分降序，同分先比敏捷，再按 ID 升序。
普通攻击按所取 d20+accuracy 分档（下限含等号）：<4 失手×0，4 擦伤×0.3，8 勉强×0.8，11 有效×1，20 平暴击×1.3，25 强暴击×1.6，30 超暴击×2。自然1必失；自然20标记 critical，但仍须总分≥4。实战不以预览 defense 为命中门槛；attack 是伤害，不是 accuracy。无默认力/敏命中或敏捷防御。通常净优势/劣势掷2取高/低；协议奖励骰0~2、惩罚骰0~1，相等取1骰，奖励占优且有2奖励取3骰中位。
体长(m)按 <0.6/<1.3/<2.6/<5.5/<10/其余分微/小/中/大/巨/超巨。依次：体型值 2/1/0/−1/−2/−4，武技 −8/−4/0/4/8/12，近战倍率 0.7/0.85/1/1.2/1.4/1（攻击者mc≥2固定1）。体型命中修正函数＝攻值−守值，守mc≥2改为攻值+2×(守mc−1)；该函数值列入预览明细，不直接加到实掷accuracy。实掷体型加值取目标size：数值用max(0,size−1)，large +2，small −1。武技对抗＝攻骰+武技≥守骰+武技；实战擒抱/缴械/绊摔/推撞则用双方d20分别加 力对力/敏对力/敏对敏/敏对力。
距离档（实际距离:命中/射程加值）：0贴身:+4/+6，1~2近程:0/+2，3~5中程:−2/0，6~10远程:−4/0，其余超距:−6/0。protocolDistance＝max(|Δx|,|Δy|)+ceil(|Δz|/2)；实战射程用三维欧氏距离，不取整，档间小数回落超距。命中合计显式accuracy、高低地(±2及弹药高地加值)、目标size、距离、按max(距离,射程)查得的射程加值、状态、夹击(+2)，减掩体。

【意图｜难度/成功倍率】normal 常规0/1，function 机能限制5/1.1，core 核心要害10/1.4，kill 抹杀15/1.7，concept 概念破碎20/2。范围攻击对单位固定常规。命中后，难度取max(0,基础+守方intentDifficulty)，为0直接成立；否则攻比守低≥2级必败。攻阶×5+原攻击骰+评级奖（平/强/超暴击+10/20/30）≥守阶×5+守d20+难度才成立；失败保留原命中，意图倍率回到1。自动命中及豁免分支不作该对抗。

【伤害｜计算函数与实战不可混用】
协议起伤＝关联属性（damage.stat，缺省近战str、否则int）×10×层级系数(1~7阶:2/2.8/4/8/15/35/80)+power(默认20)+武器attack(默认0)。实战主击乘攻击增益、体型倍率（此处不限近战）、评级、成功意图、姿态/副手系数、豁免成功×0.5，再向下取整。豁免为守d20+指定属性≥saveDC（默认12+floor(攻int/2)），成功免除该次附带效果。
damagePipeline 纯函数：(initial+bonus)×damageMultiplier×(1−min(1,最高三项减伤之和))；有效防御=max(0,defense×(1−penetration))，护甲倍率=2000/(2000+有效防御)。再乘护甲倍率和(1−属性减伤)，减flatReduction，保底0，再乘(1−clamp(dr,0,1))。属性减伤：physical=(con+str+agi)×0.0025，energy=(spi+int)×0.004，mental=spi×0.008；true 跳过护甲、属性减伤和固定减伤，不跳过DR。
实战命中走另一管线：可援护替伤、近战重剑弹反；有效甲=max(0,总甲×(1−百分比穿透)−固定穿透)，物理全甲、能量半甲、其余0。乘(1+碎冰加成)(1+易伤)(1−状态总减伤[0,1])、护甲倍率和(1−属性减伤)，向下取整且不低于0；护盾先吸收，余量扣HP。不自动套用纯函数的最高三项、固定减伤或DR。非命中类伤害如持续伤另按倍率后取整减floor(有效甲)。目标自身nonLethal保底1 HP；非致死攻击只在原目标未被替伤且扣到0时回置1，不保证阻止已触发的亡语。
areaResolution 纯函数：命中数=max(1,min(members,ceil(members×min(rangeTier,10)/10×coverage)))；每目标baseDamage，colossus时另乘mc×coverage，总伤乘命中数。实战范围技能按覆盖格逐目标结算。

【姿态｜自动识别优先级】盾→剑盾；消耗/辅助副手→同调；重型/双手主手→重剑；其他副手→双持；仅主手→轻剑；空手→无械。
light_blade 轻剑：穿甲8%，近战距离≤2的距离项+4，远程武器负距离项归零；move后奖励骰+1，上限2。
dual_wield 双持：有伤害副手时主击×1.5再×0.5；主击≥勉强且敌存活，可花阶×10 SP追击，另掷副手伤害骰×评级等倍率×0.5；主击≥平暴击免追击劣势。
attunement 同调：免费用消耗品副手，默认2次；实战给予haste，用尽转轻剑。
greatsword 重剑：攻/守模式伤害×1.3/1.5，穿甲5%；防守有余次才对近战弹反（配额2），双方力+d20，守≥攻减60%；对≥平暴击首次成功全免并返1次。
sword_shield 剑盾：普通/重格挡减伤25%/45%，可盾击击退、眩晕；表中shieldDamageFactor=0.3不等于盾击实算倍率。unarmed 无械：无姿态加成。

【士气与逃跑】换轮时，存活单位HP/maxHP严格低于阈值才触发，每轮至多一次。spar 40%、arena 30%、suppress 50%直接shaken；deathmatch 10%、standard 30%、guard 35%检定：当前实装d20<12为shaken，否则routed。标记不等于离场。主动flee另以自身敏+d20≥存活敌方最高敏+d20判成功，平手可逃，成功对方获胜。`;

export const ENGINE_API_SUMMARY = `${PROTOCOL_RULES}

【引擎 API 索引｜仅供映射，不输出调用代码】
combat_protocol.js：BL_SIZE_TABLE/sizeFor/sizeForUnit、RATING_TABLE/ratingFor、DISTANCE_TABLE/distanceTier、INTENTS/intentCheck、MORALE/moraleResult、STANCE_RULES/stanceFor/stanceLabel/stanceRules；initiative、sizeHitModifier、martialContest、meleeMultiplier、damagePipeline、areaResolution、nonLethalHp、normalizeEquipment。
combat.js：beginBattle 排先攻，currentUnit 当前单位，settleTurn 开回合，reachable 可达格，preview(state,action) 检查合法性与预估，applyAction(state,action) 实际结算并返回新增日志，refreshOutcome 判胜负。getStatusTemplate 先查 STATUSES 再查本局 statusTemplates；grantStatus 拒绝未定义 ID。
装备模板 equipment 与物品实例 items 分开；实例用templateId关联，计数在实例counters。装备特效kind：kill_charge_weapon、ammo、frost_thorns、backstab、healing_shield、opportunity_root；技能特效：status、knockback、teleport_backstab、cleanse。不能用显示名或任意描述代替类型。
prebattle_resources.js：calculatePrebattleResources 推演战前HP/MP/SP（非战斗伤害公式）；protocolDistance 计算协议距离。
rng.js：seedRng/nextRng、rollDie/rollDice/rollD20/rollProtocolD20；hitChance/critChance/saveChance 为概率预估。
spatial.js：cellAt/elevation/isGround/unitAt/coverAt 查格，gridDistance/distance3D 测距，passableEdge/canStep/reachableCells/movementOptions/findPath 通行寻路，supercoverLine/hasLOS/aoeCells/coverBetween 视线范围与掩体，facingToward/facingArc/flankPosition/isFlanked 朝向夹击。交互由 combat 的 interact 动作处理。ai.js：chooseAction(state) 选择行动，不执行。`;
