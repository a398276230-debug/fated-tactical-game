// Default status bindings for engine actions and the shield DSL shorthand.
export const actionStatuses = Object.freeze({
  brace: 'guarded', block: 'guarded', charge: 'charge', lock_on: 'lock_on', scan: 'weakness',
  grapple: 'grappled', trip: 'prone', use_item: 'haste', altar: 'haste',
  shield: 'shield', collision: 'stun', shield_bash: 'stun',
});

const def = (name, icon, category, remainingTurns, description, modifiers = {}, options = {}) => {
  const { stackMode = 'refresh', tags = [], vars = {}, mods = [], rules = [], ...rest } = options;
  return Object.freeze({ name, icon, category, description, remainingTurns, durationType: 'battle_turns',
    tickTiming: 'onTurnStart', stackMode, stackRule: stackMode, maxStacks: 1, tier: 1,
    tags: Object.freeze(tags), vars: Object.freeze(vars), mods: Object.freeze(mods), rules: Object.freeze(rules),
    modifiers: Object.freeze(modifiers), ...rest });
};

const allSlots = ['attack', 'action', 'move', 'cast', 'reaction'];
const tick = (id, hook, op) => ({ id, hook, program: [{ target: 'self', ...op }] });
const dot = (id, hook, amount, damageType) => tick(id, hook, { op: 'damage', amount, damageType, direct: false });

export const STATUSES = Object.freeze(Object.fromEntries(Object.entries({
  // Native combat reads modifiers for reporting and its movement, action, and strike calculations.
  suppressed: def('被压制','⛓️','control',1,'无法行动，自己的回合开始时尝试挣脱。',{skip:true},
    {durationType:'until_removed', tags: ['control'], mods: [{ locks: allSlots }]}),
  burn: def('灼烧', '🔥', 'dot', 2, '回合初受到火焰能量伤害。', {},
    { tags: ['fire'], rules: [dot('burn-tick', 'turn_start', 5, 'energy')] }),
  bleed: def('流血', '🩸', 'dot', 3, '回合末每层受到 3 点真实伤害。', {},
    { stackMode: 'stack', maxStacks: 5, tickTiming: 'onTurnEnd', rules: [dot('bleed-tick', 'turn_end', '3 * status.stacks', 'true')] }),
  poison: def('中毒', '☠️', 'dot', 3, '回合初每层受到 3 点真实伤害。', {},
    { stackMode: 'stack', maxStacks: 4, tags: ['poison'], rules: [dot('poison-tick', 'turn_start', '3 * status.stacks', 'true')] }),
  regen: def('再生', '💚', 'hot', 3, '回合初恢复生命。', {},
    { rules: [tick('regen-tick', 'turn_start', { op: 'heal', amount: 5 })] }),
  shield: def('护盾', '🛡️', 'shield', 2, '独立吸收伤害；耗尽时破裂。', { amount: 8 },
    { stackMode: 'replace', vars: { shieldAmount: 8 } }),
  guarded: def('坚壁', '🧱', 'buff', 1, '受到的伤害减少 35%。', { reduction: .35 }),
  taunt: def('嘲讽', '📣', 'control', 1, '可攻击嘲讽来源时，进攻必须指定该来源。', { taunted: true }),
  guard: def('援护', '🤝', 'buff', 2, '替相邻友军承受伤害；不会连续转交。', { intercept: true }),
  thorns: def('反伤棘甲', '🌵', 'buff', 2, '被近战命中时，对进攻者造成真实伤害。', {}, {
    rules: [{ id: 'thorns-retaliate', hook: 'after_damage',
      filter: 'event.targetId == self.id && event.melee == true && event.direct == true && attacker.alive && attacker.team != self.team',
      program: [{ op: 'damage', target: 'attacker', amount: 5, damageType: 'true', direct: false }] }],
  }),
  stun: def('眩晕', '💫', 'control', 1, '跳过行动。', { skip: true }, { tags: ['control'], mods: [{ locks: allSlots }] }),
  freeze: def('冰冻', '🧊', 'control', 1, '跳过行动；被打击时碎冰，受到额外伤害。', { skip: true, shatter: .5 },
    { tags: ['control', 'ice'], mods: [{ locks: allSlots }], expireOn: Object.freeze({ trigger: 'on_struck' }) }),
  root: def('定身', '⛓️', 'control', 2, '无法移动或瞬移，仍可攻击或施法。', { rooted: true },
    { tags: ['control'], mods: [{ locks: ['move'] }] }),
  blind: def('致盲', '🌑', 'debuff', 2, '命中检定带劣势。', {},
    { mods: [{ stat: 'advantage', flat: -1, checkKind: 'attack' }] }),
  vulnerable: def('易伤', '💢', 'debuff', 2, '受到的伤害增加 35%。', {},
    { mods: [{ stat: 'incomingDamageMult', mult: 1.35 }] }),
  sunder: def('破甲', '🔨', 'debuff', 2, '护甲降低 4 点。', {}, { mods: [{ stat: 'armor', flat: -4 }] }),
  mark: def('标记', '🎯', 'debuff', 2, '攻击此单位的命中加 2。', { incomingAccuracy: 2 }),
  stealth: def('隐身', '👤', 'buff', 2, '无法被敌方远距直接锁定；发动进攻或遭攻击伤害时现形。', { hidden: true },
    { tags: ['stealth'], mods: [{ stat: 'advantage', flat: 1, checkKind: 'attack' }],
      expireOn: Object.freeze([Object.freeze({ trigger: 'on_attack' }), Object.freeze({ trigger: 'on_struck' })]) }),
  haste: def('疾走', '💨', 'buff', 2, '移动距离增加 1。', { movement: 1 }),
  chill: def('寒冷', '❄️', 'debuff', 2, '移动距离和命中降低。', { movement: -1, accuracy: -2 }),
  charge: def('蓄力', '⚡', 'buff', 1, '本回合下一次攻击增伤。', { damageBonus: .15 }),
  lock_on: def('定位', '⌖', 'buff', 1, '本回合对锁定目标命中提高。', { accuracy: 1 }),
  weakness: def('弱点识别', '◉', 'buff', 3, '每层使意图难度降低 2。', { intentDifficulty: -2 }, { stackMode: 'stack', maxStacks: 3 }),
  grappled: def('擒抱', '⛓', 'control', 1, '无法移动，仍可进行近身攻击。', { rooted: true },
    { tags: ['control'], mods: [{ locks: ['move'] }] }),
  prone: def('倒地', '▽', 'debuff', 1, '无法移动，闪避降低。', { incomingAccuracy: 2, rooted: true }, { mods: [{ locks: ['move'] }] }),
  infinite_ammo: def('无限弹药', '🏹', 'buff', 1, '远程射击无需装填，也不消耗弹药。', { infiniteAmmo: true }),
}).map(([id, status]) => [id, Object.freeze({ id, ...status })])));
