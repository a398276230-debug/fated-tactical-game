// Static prompt reference, not executable combat logic. Keep the table helpers
// distinct from the paths actually taken by combat.js during a strike.
export const PROTOCOL_RULES = `【判定｜protocol 实战】
行动规则固定为每回合 1 动作槽 + 1 攻击槽；2 AP 行动同时用两槽。祭坛相邻激活耗动作槽；爆桶在武器射程及视线内引爆耗攻击槽，爆炸可伤及友方。
先攻＝agi×(1+initiativePercent)+d20+max(0,...attackInit)+max(0,...actionInit)+flatInitiative；总分降序，同分先比敏捷，再按 ID 升序。
普通攻击按所取 d20+accuracy 分档（下限含等号）：<4 失手×0，4 擦伤×0.3，8 勉强×0.8，11 有效×1，20 平暴击×1.3，25 强暴击×1.6，30 超暴击×2。自然1必失；自然20标记 critical，但仍须总分≥4。实战不以预览 defense 为命中门槛；attack 是伤害，不是 accuracy。无默认力/敏命中或敏捷防御。通常净优势/劣势掷2取高/低；协议奖励骰0~2、惩罚骰0~1，相等取1骰，奖励占优且有2奖励取3骰中位。
射程取三维欧氏距离；命中计体型、高差、距离、射程、状态、夹击、掩体。体型命中加值＝目标基础项＋攻守档差，合计只加一次；打掩体为0。基础项=max(0,目标size−1)（旧字符串large为+2、small为−1，其余0）。按体长依次分微/小/中/大/巨/超巨，分界为0.6/1.3/2.6/5.5/10米（等于分界进下一档），档值依次为2/1/0/−1/−2/−4。目标MC<2时档差=攻击者档值−目标档值；目标MC≥2时改用攻击者档值＋2×(目标MC−1)。

【意图｜难度/成功倍率】normal 常规0/1，function 机能限制5/1.1，core 核心要害10/1.4，kill 抹杀15/1.7，concept 概念破碎20/2。范围攻击对单位固定常规。命中后，难度取max(0,基础+守方intentDifficulty)，为0直接成立；否则攻比守低≥2级必败。攻阶×5+原攻击骰+评级奖（平/强/超暴击+10/20/30）≥守阶×5+守d20+难度才成立；失败保留原命中，意图倍率回到1。自动命中及豁免分支不作该对抗。

【伤害｜计算函数与实战不可混用】
协议起伤＝关联属性（damage.stat，缺省近战str、否则int）×10×层级系数(1~7阶:2/2.8/4/8/15/35/80)+power(默认20)+武器attack(默认0)。实战主击乘攻击增益、体型倍率（此处不限近战）、评级、成功意图、姿态/副手系数、豁免成功×0.5，再向下取整。豁免为守d20+指定属性≥saveDC（默认12+floor(攻int/2)），成功免除该次附带效果。
属性减伤：physical=(con+str+agi)×.0025，energy=(spi+int)×.004，mental=spi×.008，true=0。
实战命中走另一管线：可援护替伤、近战重剑弹反；有效甲=max(0,总甲×(1−百分比穿透)−固定穿透)，物理全甲、能量半甲、其余0。乘(1+碎冰加成)(1+易伤)(1−状态总减伤[0,1])、护甲倍率和(1−属性减伤)，向下取整且不低于0；护盾先吸收，余量扣HP。持续伤等非命中类伤害按倍率取整减有效甲。DSL 固定减伤先于护盾；nonLethal 保底 1 HP。
范围技能按覆盖格逐目标结算。

【姿态】盾→剑盾；消耗/辅助副手→同调；重型/双手主手→重剑；其他副手→双持；仅主手→轻剑；空手→无械。姿态决定穿甲、追击、弹反和格挡。

【士气与逃跑】换轮检查士气。主动flee以自身敏+d20对存活敌方最高敏+d20，平手可逃。`;

export const ENGINE_API_SUMMARY = `${PROTOCOL_RULES}

【API 映射】
状态先查战局 statusTemplates，再查默认模板；拒绝未知 ID。自定义状态使用同一套修饰键，见下方状态目录。
技能 saveDC、DSL roll.dc 和 roll.contest.dc 使用同一规则。可传 1…50 的整数，或 {base:6,scaleBy:{stat:'spi',perUnit:0.5},min:1,max:50}。stat 只能为 str/con/agi/int/spi。base 与 perUnit 可为小数或负数，范围 −1e9…1e9。计算为 base + perUnit × 施术者当前生效属性，保留小数并 clamp 到 min/max，缺省 1/50。显式上下限为 1…1e9 的数值，min 不得高于 max。
装备模板 equipment 与实例 items 用 templateId 关联；计数在实例 counters。

装备与技能统一使用效果 DSL。外层声明触发、条件、检定、目标与节点列表。实例计数由装备的资源声明决定。完整 DSL 协议见下节。
一回合 battle_turns 模板可加 expireInto 指已定义状态，自己施加时本回合末到期，战斗未结束才续接。先定义续接状态，再定义前置状态。

【状态数值覆盖】
模板数值是默认值。grantStatus 节点可用 modifiers 覆盖模板已有键，按状态目录范围校验。DoT/HoT 每次结算取实例值乘层数。
公开 API：defineStatus(state,id,template) 注册战局模板，可覆盖同名默认模板，但不能重复注册战局已有定义。patchStatus(state,unitId,statusId,{damage:12}) 更新已附加实例并写入日志。statusModifierKeys(statusId,state?) 查询合法键。GameAPI 对应的无 state 方法支持运行中的战局。
damageType 随 damage；受击碎裂用 shatter 配合 expireOn:on_struck（规则写为 {trigger:'on_struck'}）。`;
