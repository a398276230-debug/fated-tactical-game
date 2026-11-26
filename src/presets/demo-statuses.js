// Sample mechanics for the three standalone scenarios, not defaults for character cards.
import { allSlots, def } from './status-defaults.js';

const tick = (id, hook, op) => ({ id, hook, program: [{ target: 'self', ...op }] });
const dot = (id, hook, amount, damageType) => tick(id, hook, { op: 'damage', amount, damageType, direct: false });

export const DEMO_STATUSES = Object.freeze({
  burn: def('burn', '灼烧', '🔥', 'dot', 2, '回合初受到火焰能量伤害。', {
    tags: ['fire'], rules: [dot('burn-tick', 'turn_start', 5, 'energy')],
  }),
  bleed: def('bleed', '流血', '🩸', 'dot', 3, '回合末每层受到 3 点真实伤害。', {
    stackMode: 'stack', maxStacks: 5, rules: [dot('bleed-tick', 'turn_end', '3 * status.stacks', 'true')],
  }),
  poison: def('poison', '中毒', '☠️', 'dot', 3, '回合初每层受到 3 点真实伤害。', {
    stackMode: 'stack', maxStacks: 4, tags: ['poison'], rules: [dot('poison-tick', 'turn_start', '3 * status.stacks', 'true')],
  }),
  regen: def('regen', '再生', '💚', 'hot', 3, '回合初恢复生命。', {
    rules: [tick('regen-tick', 'turn_start', { op: 'heal', amount: 5 })],
  }),
  taunt: def('taunt', '嘲讽', '📣', 'control', 1, '可攻击嘲讽来源时，进攻必须指定该来源。', {
    mods: [{ flags: ['taunted'] }],
  }),
  guard: def('guard', '援护', '🤝', 'buff', 2, '替相邻友军承受伤害；不会连续转交。', {
    mods: [{ flags: ['intercept'] }],
  }),
  thorns: def('thorns', '反伤棘甲', '🌵', 'buff', 2, '被近战命中时，对进攻者造成真实伤害。', {
    rules: [{ id: 'thorns-retaliate', hook: 'after_damage',
      filter: 'event.targetId == self.id && event.melee == true && event.direct == true && attacker.alive && attacker.team != self.team',
      program: [{ op: 'damage', target: 'attacker', amount: 5, damageType: 'true', direct: false }] }],
  }),
  freeze: def('freeze', '冰冻', '🧊', 'control', 1, '跳过行动；被打击时碎冰，受到额外伤害。', {
    tags: ['control', 'ice'], mods: [{ locks: allSlots }, { stat: 'shatter', flat: 0.5 }],
    expireOn: { hook: 'after_hit', filter: 'target.id == self.id && attacker.id != self.id' },
  }),
  root: def('root', '定身', '⛓️', 'control', 2, '无法移动或瞬移，仍可攻击或施法。', {
    tags: ['control'], mods: [{ locks: ['move', 'teleport'] }],
  }),
  blind: def('blind', '致盲', '🌑', 'debuff', 2, '命中检定带劣势。', {
    mods: [{ stat: 'advantage', flat: -1, checkKind: 'attack' }],
  }),
  vulnerable: def('vulnerable', '易伤', '💢', 'debuff', 2, '受到的伤害增加 35%。', {
    mods: [{ stat: 'incomingDamageMult', mult: 1.35 }],
  }),
  sunder: def('sunder', '破甲', '🔨', 'debuff', 2, '护甲降低 4 点。', {
    mods: [{ stat: 'armor', flat: -4 }],
  }),
  mark: def('mark', '标记', '🎯', 'debuff', 2, '攻击此单位的命中加 2。', {
    mods: [{ stat: 'incomingAccuracy', flat: '2 * status.stacks' }],
  }),
  stealth: def('stealth', '隐身', '👤', 'buff', 2, '无法被敌方远距直接锁定；发动进攻或遭攻击伤害时现形。', {
    tags: ['stealth'], mods: [{ flags: ['hidden'] }, { stat: 'advantage', flat: 2, checkKind: 'attack' }],
    expireOn: [{ hook: 'after_action', filter: 'attacker.id == self.id && event.hostile == true' },
      { hook: 'after_hit', filter: 'target.id == self.id && attacker.id != self.id' }],
  }),
  haste: def('haste', '疾走', '💨', 'buff', 2, '移动距离增加 1.', {
    mods: [{ stat: 'movement', flat: '1 * status.stacks' }],
  }),
  chill: def('chill', '寒冷', '❄️', 'debuff', 2, '移动距离和命中降低。', {
    mods: [{ stat: 'movement', flat: '-1 * status.stacks' }, { stat: 'checkBonus', checkKind: 'attack', flat: '-2 * status.stacks' }],
  }),
  infinite_ammo: def('infinite_ammo', '无限弹药', '🏹', 'buff', 1, '远程射击无需装填，也不消耗弹药。', {
    mods: [{ flags: ['infiniteAmmo'] }],
  }),
});
