// Default status bindings for engine actions and the shield DSL shorthand.
export const actionStatuses = Object.freeze({
  brace: 'guarded', block: 'guarded', charge: 'charge', lock_on: 'lock_on', scan: 'weakness',
  grapple: 'grappled', trip: 'prone', use_item: 'haste', altar: 'haste',
  shield: 'shield', collision: 'stun', shield_bash: 'stun',
});

const def = (name, icon, category, remainingTurns, description, modifiers = {}, options = {}) =>
  Object.freeze({ name, icon, category, description, remainingTurns, durationType: 'battle_turns',
    tickTiming: 'onTurnStart', stackRule: 'refresh', maxStacks: 1,
    modifiers: Object.freeze(modifiers), ...options });

export const STATUSES = Object.freeze(Object.fromEntries(Object.entries({
  burn: def('灼烧', '🔥', 'dot', 2, '回合初受到火焰能量伤害。', { damage: 5, damageType: 'energy' }),
  bleed: def('流血', '🩸', 'dot', 3, '回合末每层受到 3 点真实伤害。', { damage: 3, damageType: 'true' },
    { stackRule: 'stack', maxStacks: 5, tickTiming: 'onTurnEnd' }),
  poison: def('中毒', '☠️', 'dot', 3, '回合初每层受到 3 点真实伤害。', { damage: 3, damageType: 'true' },
    { stackRule: 'stack', maxStacks: 4 }),
  regen: def('再生', '💚', 'hot', 3, '回合初恢复生命。', { heal: 5 }),
  shield: def('护盾', '🛡️', 'shield', 2, '独立吸收伤害；耗尽时破裂。', { amount: 8 }, { stackRule: 'replace' }),
  guarded: def('坚壁', '🧱', 'buff', 1, '受到的伤害减少 35%。', { reduction: .35 }),
  taunt: def('嘲讽', '📣', 'control', 1, '可攻击嘲讽来源时，进攻必须指定该来源。', { taunted: true }),
  guard: def('援护', '🤝', 'buff', 2, '替相邻友军承受伤害；不会连续转交。', { intercept: true }),
  thorns: def('反伤棘甲', '🌵', 'buff', 2, '被近战命中时，对进攻者造成真实伤害。', { reflect: 5 }),
  stun: def('眩晕', '💫', 'control', 1, '跳过行动。', { skip: true }),
  freeze: def('冰冻', '🧊', 'control', 1, '跳过行动；被打击时碎冰，受到额外伤害。', { skip: true, shatter: .5 }, { expireOn: Object.freeze({ trigger: 'on_struck' }) }),
  root: def('定身', '⛓️', 'control', 2, '无法移动或瞬移，仍可攻击或施法。', { rooted: true }),
  blind: def('致盲', '🌑', 'debuff', 2, '命中检定带劣势。', { disadvantage: 1 }),
  vulnerable: def('易伤', '💢', 'debuff', 2, '受到的伤害增加 35%。', { vulnerability: .35 }),
  sunder: def('破甲', '🔨', 'debuff', 2, '护甲降低 4 点。', { armor: -4 }),
  mark: def('标记', '🎯', 'debuff', 2, '攻击此单位的命中加 2。', { incomingAccuracy: 2 }),
  stealth: def('隐身', '👤', 'buff', 2, '无法被敌方远距直接锁定；发动进攻或遭攻击伤害时现形。', { hidden: true, advantage: 1 }, { expireOn: Object.freeze([Object.freeze({ trigger: 'on_attack' }), Object.freeze({ trigger: 'on_struck' })]) }),
  haste: def('疾走', '💨', 'buff', 2, '移动距离增加 1。', { movement: 1 }),
  chill: def('寒冷', '❄️', 'debuff', 2, '移动距离和命中降低。', { movement: -1, accuracy: -2 }),
  charge: def('蓄力', '⚡', 'buff', 1, '本回合下一次攻击增伤。', { damageBonus: .15 }),
  lock_on: def('定位', '⌖', 'buff', 1, '本回合对锁定目标命中提高。', { accuracy: 1 }),
  weakness: def('弱点识别', '◉', 'buff', 3, '每层使意图难度降低 2。', { intentDifficulty: -2 }, { stackRule: 'stack', maxStacks: 3 }),
  grappled: def('擒抱', '⛓', 'control', 1, '无法移动，仍可进行近身攻击。', { rooted: true }),
  prone: def('倒地', '▽', 'debuff', 1, '无法移动，闪避降低。', { incomingAccuracy: 2, rooted: true }),
  infinite_ammo: def('无限弹药', '🏹', 'buff', 1, '远程射击无需装填，也不消耗弹药。', { infiniteAmmo: true }),
}).map(([id, status]) => [id, Object.freeze({ id, ...status })])));
