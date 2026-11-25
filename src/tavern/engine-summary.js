// The auxiliary model needs the editable contract, not the engine's arithmetic.
export const PROTOCOL_RULES = `【战斗协议｜模板与规则的分工】
• 每回合有 1 动作槽和 1 攻击槽。ap:1 占对应 slot，ap:2 占双槽，ap:0 不占槽。initiativeBonus 按 slot 计入开场 attackInit 或 actionInit，每槽取最高非负值。开场先攻默认已全额计入单位面板 agi；协议模式下命中与受击闪避基值均为 0（不自动计入五维），仅统计显式的 accuracy、checkBonus 与 dodge 修饰。
• 常规主击写技能模板的 power 和 damage；治疗写 heal。引擎结算命中评级、体型、高差、护甲、暴击、意图（normal / function / core[核心要害，即“命中核心”] / kill / concept；范围与非敌对行动强制 normal，低目标两阶及以上意图检定强制失败；攻方意图加值用 intentBonus，守方难度修正用 intentDifficulty；仅对核心生效加 when:"event.intent == 'core'"，不写进常规攻击 checkBonus；且无专门潜行检定维度）和士气。范围主击自动命中。附带效果若需抵抗，在 DSL 中写独立检定。power 单独填写不会开启主击，须配合 damage 骰子对象。伤害拆分或额外效果才写 rules，避免重复打出主击。
• range 是施放射程（上限 64 格），radius 是覆盖半径（radius、innerRadius、width 上限为 30 格）。
• 装备模板 equipment 和实例 items 通过 templateId 关联。技能模板在 skills，已有单位的技能由 units.<id>.skills 引用（穿戴装备 skills 数组中的技能也会自动对持有者生效）。状态模板在 statusTemplates；战场初始环境区域实例在 zones（按 area 空间包含关系对区域内单位挂载 mods 与 rules）。主动技能的额外程序写 hook:active。
• 武器流派与原生动作边界：持盾为剑盾（原生格挡 block / 盾击 shield_bash）；有主手无盾且副手为 kind:"consumable" 时激活同调（原生 use_item 0 AP 不占槽对自身执行副手 hook:"active"，每战共 2 次）；近战主手 heavy 或 twoHanded 激活重剑（twoHanded 占双手槽，heavy 标重型；攻势 1.5×、沉势 1.2× 且减免 15% 非真伤，无内置弹反结算，弹反／招架反击须写受击规则）；纯远程主手单持激活射击姿态（中远距衰减缓和 2，封顶 0；同格默认 -4 命中，贴身免罚设 closeQuarters:true）；主副手双武器激活双持（副手武器须设 hand:"off_hand" 且带 damage 才触发普攻副手追击）；酒馆转换远程武器由 pools.ammo 计弹药但默认不带 reloadable:true（不可原生装填，仅原文支持局内装填时才显式设 reloadable:true）。装备实例池在装备规则中通过 item.resource.<池ID> 读取，缺省为 0；equipment / skill / unit 可声明 unitPools，初始化后以 self.resource.<池ID> 共享读写，resourceCost:{resource:"<池ID>",amount:N} 可扣除单位池，跨批复用 sharedPoolLedger 中的 poolId，不使用 event.souls 特判。`;

export const ENGINE_API_SUMMARY = PROTOCOL_RULES;
