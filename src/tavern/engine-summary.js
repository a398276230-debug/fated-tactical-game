// The auxiliary model needs the editable contract, not the engine's arithmetic.
export const PROTOCOL_RULES = `【战斗协议｜模板与规则的分工】
• 每回合有 1 动作槽和 1 攻击槽。ap:1 占对应 slot，ap:2 占双槽，ap:0 不占槽。initiativeBonus 按 slot 计入开场 attackInit 或 actionInit，每槽取最高非负值。开场先攻默认已全额计入单位面板 agi；协议模式下命中与受击闪避基值均为 0（不自动计入五维），仅统计显式的 accuracy、checkBonus 与 dodge 修饰。
• 常规主击写技能模板的 power 和 damage；治疗写 heal。引擎结算命中评级、体型、高差、护甲、暴击、意图（normal / function / core[核心要害，即“命中核心”] / kill / concept；受击方承受意图弱点用 mods.stat:"intentDifficulty"，进攻方无针对核心或其他特定意图的独立检定加值 stat，切勿误写进常规攻击 checkBonus；且无专门潜行检定维度）和士气。范围主击自动命中。附带效果若需抵抗，在 DSL 中写独立检定。power 单独填写不会开启主击，须配合 damage 骰子对象。伤害拆分或额外效果才写 rules，避免重复打出主击。
• range 是施放射程（上限 64 格），radius 是覆盖半径（radius、innerRadius、width 上限为 30 格）。
• 装备模板 equipment 和实例 items 通过 templateId 关联。技能模板在 skills，已有单位的技能由 units.<id>.skills 引用（穿戴装备 skills 数组中的技能也会自动对持有者生效）。状态模板在 statusTemplates。主动技能的额外程序写 hook:active。`;

export const ENGINE_API_SUMMARY = PROTOCOL_RULES;
