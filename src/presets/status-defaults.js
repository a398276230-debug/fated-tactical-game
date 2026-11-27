export function getStatusTemplate(state, statusId) {
  if (typeof statusId !== 'string') return undefined;
  const templates = state?.statusTemplates;
  return (Object.hasOwn(templates ?? {}, statusId) ? templates[statusId] : undefined)
    ?? (Object.hasOwn(STATUSES, statusId) ? STATUSES[statusId] : undefined)
    ?? (Object.hasOwn(PHYSICAL_STATUSES, statusId) ? PHYSICAL_STATUSES[statusId] : undefined);
}

// Default status bindings for engine actions. Only suppressed is a reserved ID.
export const actionStatuses = Object.freeze({
  brace: 'guarded', block: 'guarded', charge: 'charge', lock_on: 'lock_on', scan: 'weakness',
  grapple: 'grappled', trip: 'prone', shield: 'shield', collision: 'stun', shield_bash: 'stun',
});

export const allSlots = ['attack', 'action', 'move', 'cast', 'reaction', 'fly', 'teleport'];
export const def = (id, name, icon, category, remainingTurns, description, options = {}) => Object.freeze({
  id, name, icon, category, description, remainingTurns, durationType: 'battle_turns',
  stackMode: 'refresh', maxStacks: 1, tier: 1, tags: Object.freeze([]), vars: Object.freeze({}),
  mods: Object.freeze([]), rules: Object.freeze([]), ...options,
});

export const STATUSES = Object.freeze({
  suppressed: def('suppressed', '被压制', '⛓️', 'control', 1, '无法行动，自己的回合开始时尝试挣脱。', {
    durationType: 'until_removed', tags: ['control'], vars: { holdTotal: 0 }, mods: [{ locks: allSlots }],
  }),
  shield: def('shield', '护盾', '🛡️', 'shield', 2, '独立吸收伤害；耗尽时破裂。', {
    stackMode: 'replace',
  }),
  guarded: def('guarded', '坚壁', '🧱', 'buff', 1, '受到的伤害减少 35%。', {
    vars: { reduction: 0.35 }, mods: [{ stat: 'damageReduction', flat: 'status.vars.reduction' }],
  }),
  stun: def('stun', '眩晕', '💫', 'control', 1, '跳过行动。', {
    tags: ['control'], mods: [{ locks: allSlots }],
  }),
  charge: def('charge', '蓄力', '⚡', 'buff', 1, '本回合下一次攻击增伤。', {
    mods: [{ stat: 'damageMult', additivePercent: '0.15 * status.stacks', when: 'event.actionType == "attack"' }],
  }),
  lock_on: def('lock_on', '定位', '⌖', 'buff', 1, '本回合对锁定目标命中提高。', {
    mods: [{ stat: 'checkBonus', checkKind: 'attack', flat: '1 * status.stacks', when: 'event.targetId == status.vars.targetId' }],
  }),
  weakness: def('weakness', '弱点识别', '◉', 'buff', 3, '每层为探察者的意图检定加 2。', {
    stackMode: 'stack', maxStacks: 3, mods: [{ stat: 'intentBonus', flat: '2 * status.stacks' }],
  }),
  grappled: def('grappled', '擒抱', '⛓', 'control', 1, '无法移动，仍可进行近身攻击。', {
    tags: ['control'], mods: [{ locks: ['move'] }],
  }),
  prone: def('prone', '倒地', '▽', 'debuff', 1, '无法移动，闪避降低。', {
    mods: [{ locks: ['move'] }, { stat: 'incomingAccuracy', flat: '2 * status.stacks' }],
  }),
});

export const PHYSICAL_STATUSES = Object.freeze({
  wet: def('wet', '潮湿', '💧', 'debuff', 2, '火焰伤害减免 25%，受到冰霜与雷电伤害提高 25%；遇热蒸干，遇寒结霜。', {
    tags: ['wet', 'elemental_state'],
    mods: [
      { stat: 'damageReduction', flat: 0.25, damageType: 'fire' },
      { stat: 'incomingDamageMult', mult: 1.25, damageType: 'cold' },
      { stat: 'incomingDamageMult', mult: 1.25, damageType: 'lightning' },
    ],
  }),
  oiled: def('oiled', '覆油', '🛢️', 'debuff', 2, '移动距离减少 1；遇明火引燃，遇浸润冲刷清除。', {
    tags: ['oiled', 'flammable', 'elemental_state'], mods: [{ stat: 'movement', flat: -1 }],
  }),
  burning: def('burning', '灼烧', '🔥', 'dot', 2, '每回合开始受到火焰伤害；水体、浸润和寒霜可熄灭。', {
    tags: ['burning', 'fire', 'elemental_state'],
    rules: [{ id: 'burning_tick', hook: 'turn_start', program: [
      { op: 'damage', target: 'self', amount: 'max(4, floor(self.maxHp * 0.04))', damageType: 'fire', direct: false },
    ] }],
  }),
  chilled: def('chilled', '霜滞', '❄️', 'debuff', 1, '移动距离和闪避各减少 2；遇高温消解。', {
    tags: ['chilled', 'cold', 'elemental_state'], mods: [{ stat: 'movement', flat: -2 }, { stat: 'dodge', flat: -2 }],
  }),
});
