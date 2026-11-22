import { rollDie } from './rng.js';

import { QUALITY_AUTHORITY, resolveAuthorityRank } from './combat_protocol.js';
export { QUALITY_AUTHORITY, resolveAuthorityRank };
const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

export function authorityProse(contest) {
  if (contest.contested && contest.attack && contest.defense) {
    const { attack: a, defense: d } = contest;
    return `（攻方 d20 ${a.roll} + ${a.bonus} = ${a.total}，守方 d20 ${d.roll} + ${d.bonus} = ${d.total}）`;
  }
  return `（位格 ${contest.attackRank} 对 ${contest.defenderRank}，层级 ${contest.attackTier} 对 ${contest.defenderTier}）`;
}

export function compareAuthority(attacker, defender) {
  if (attacker.authorityRank !== defender.authorityRank) return attacker.authorityRank > defender.authorityRank ? 1 : -1;
  if (attacker.unitTier !== defender.unitTier) return attacker.unitTier > defender.unitTier ? 1 : -1;
  return 0;
}

const carrierOf = (state, ref) => {
  if (!ref) return null;
  if (ref.type === 'status') return own(own(state.units, ref.ownerId)?.statuses, ref.id);
  if (ref.type === 'skill') return own(state.skills, ref.id);
  if (ref.type === 'item') return own(state.items, ref.id);
  if (ref.type === 'unit') return own(state.units, ref.id);
  if (ref.type === 'zone') return own(state.zones, ref.id);
  return null;
};

export function authorityFor(state, ref, ownerId) {
  let carrier = carrierOf(state, ref) ?? ref ?? {};
  // Item instances only carry mutable counters/vars. Authority belongs to the
  // equipment definition, while an instance may add an explicit override.
  if (ref?.type === 'item') {
    const item = own(state.items, ref.id);
    const template = own(state.equipment, item?.templateId);
    carrier = { ...template, ...item, quality: template?.quality };
  }
  if (ref?.type === 'status' && Number.isInteger(carrier.authorityRank) && Number.isInteger(carrier.sourceTier)) {
    return { authorityRank: carrier.authorityRank, unitTier: carrier.sourceTier };
  }
  return resolveAuthorityRank(carrier, own(state.units, ownerId ?? ref?.ownerId));
}

export function protectionCarrier(state, target) {
  if (!target?.id) return null;
  const unit = own(state.units, target.id) ?? target;
  const protects = value => value?.flags?.includes('concept_immune');
  const refs = [];
  const add = (type, id) => refs.push({ type, id, ownerId: unit.id });
  if (protects(unit)) add('unit', unit.id);
  for (const [id, status] of Object.entries(unit.statuses ?? {}).sort()) if (protects(status)) add('status', id);
  for (const id of [...new Set(unit.skills ?? [])].sort()) if (protects(own(state.skills, id))) add('skill', id);
  const itemIds = [unit.mainHand, unit.offHand, unit.shield, unit.weapon, ...(unit.gear ?? [])].filter(Boolean);
  for (const id of [...new Set(itemIds)].sort()) {
    const item = own(state.items, id), template = own(state.equipment, item?.templateId);
    if ((!template?.boundTo || template.boundTo === unit.id) && (protects(item) || protects(template))) add('item', id);
  }
  return refs.reduce((best, ref) => !best || compareAuthority(authorityFor(state, ref), authorityFor(state, best)) > 0 ? ref : best, null);
}

export function authorityContest(state, attacker, defender, { dryRun = false, preview, attackStat = ['int', 'spi'], defenseStat = ['con', 'spi'], roll = null, checkBonus = null } = {}) {
  const order = compareAuthority(attacker, defender);
  if (order) return { result: order, contested: false, conditional: false,
    attackRank: attacker.authorityRank, defenderRank: defender.authorityRank,
    attackTier: attacker.unitTier, defenderTier: defender.unitTier };
  if (dryRun || preview?.dryRun) {
    if (preview) preview.conditional = true;
    return { result: 0, contested: true, conditional: true };
  }
  const a = own(state.units, attacker.unitId), d = own(state.units, defender.unitId);
  const ar = roll ? { value: roll(20) } : rollDie(state.rng, 20);
  if (!roll) state.rng = ar.rng;
  const dr = roll ? { value: roll(20) } : rollDie(state.rng, 20);
  if (!roll) state.rng = dr.rng;
  const statValue = (unit, key) => Array.isArray(key) ? Math.max(...key.map(name => unit?.stats?.[name] ?? 0)) : unit?.stats?.[key] ?? 0;
  const ab = statValue(a, attackStat), db = statValue(d, defenseStat);
  const aCheckBonus = checkBonus?.(a, 'attacker') ?? a?.checkBonus ?? 0;
  const dCheckBonus = checkBonus?.(d, 'defender') ?? d?.checkBonus ?? 0;
  const at = ar.value + ab + aCheckBonus, dt = dr.value + db + dCheckBonus;
  return { result: at >= dt ? 1 : -1, contested: true, conditional: false,
    attackRank: attacker.authorityRank, defenderRank: defender.authorityRank,
    attackTier: attacker.unitTier, defenderTier: defender.unitTier,
    attack: { roll: ar.value, bonus: ab + aCheckBonus, total: at },
    defense: { roll: dr.value, bonus: db + dCheckBonus, total: dt } };
}
