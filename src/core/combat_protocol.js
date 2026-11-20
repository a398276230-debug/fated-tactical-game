// Authoritative, deterministic combat-protocol calculations.
// This module is deliberately pure: callers provide rolls and state, so previews never consume RNG.
export const BL_SIZE_TABLE = Object.freeze([
  { id: 'tiny', name: '微型', max: .6, value: 2, martial: -8, melee: .7 },
  { id: 'small', name: '小型', max: 1.3, value: 1, martial: -4, melee: .85 },
  { id: 'medium', name: '中型', max: 2.6, value: 0, martial: 0, melee: 1 },
  { id: 'large', name: '大型', max: 5.5, value: -1, martial: 4, melee: 1.2 },
  { id: 'huge', name: '巨型', max: 10, value: -2, martial: 8, melee: 1.4 },
  { id: 'gargantuan', name: '超巨型', max: Infinity, value: -4, martial: 12, melee: 1 },
]);
export const RATING_TABLE = Object.freeze([
  { min: 30, name: '超暴击', multiplier: 2 }, { min: 25, name: '强暴击', multiplier: 1.6 },
  { min: 20, name: '平暴击', multiplier: 1.3 }, { min: 11, name: '有效', multiplier: 1 },
  { min: 8, name: '勉强', multiplier: .8 }, { min: 4, name: '擦伤', multiplier: .3 },
  { min: null, name: '失手', multiplier: 0 },
]);
export const DISTANCE_TABLE = Object.freeze([
  { name: '贴身', min: 0, max: 0, hit: 4, range: 6 }, { name: '近程', min: 1, max: 2, hit: 0, range: 2 },
  { name: '中程', min: 3, max: 5, hit: -2, range: 0 }, { name: '远程', min: 6, max: 10, hit: -4, range: 0 },
  { name: '超距', min: 11, max: null, hit: -6, range: 0 },
]);
export const INTENTS = Object.freeze({ normal: { name: '常规', difficulty: 0, multiplier: 1 },
  function: { name: '机能限制', difficulty: 5, multiplier: 1.1 }, core: { name: '核心要害', difficulty: 10, multiplier: 1.4 },
  kill: { name: '抹杀', difficulty: 15, multiplier: 1.7 }, concept: { name: '概念破碎', difficulty: 20, multiplier: 2 } });
export const MORALE = Object.freeze({ spar: { threshold: .4, check: false }, arena: { threshold: .3, check: false },
  suppress: { threshold: .5, check: false }, deathmatch: { threshold: .1, check: true }, standard: { threshold: .3, check: true }, guard: { threshold: .35, check: true } });
export const stanceFor = (slots = {}) => {
  const main = slots.mainHand ?? slots.weapon ?? null, off = slots.offHand ?? null, shield = slots.shield ?? null;
  if (shield) return 'sword_shield';
  if (off?.kind === 'consumable' || off?.kind === 'auxiliary') return 'attunement';
  if (main?.heavy || main?.twoHanded) return 'greatsword';
  if (off) return 'dual_wield';
  if (main?.ranged || main?.kind === 'ranged') return 'light_blade';
  return main ? 'light_blade' : 'unarmed';
};
export const stanceLabel = Object.freeze({ light_blade: '轻剑', dual_wield: '双持', attunement: '同调', greatsword: '重剑', sword_shield: '剑盾', unarmed: '无械' });
export const STANCE_RULES = Object.freeze({
  light_blade: Object.freeze({ armorPenetration: .08, closeRange: true, rangedDistancePenalty: 0 }),
  dual_wield: Object.freeze({ offHandDamage: .5, comboOffHandDamage: .75, followUp: true }),
  attunement: Object.freeze({ itemCharges: 2 }),
  greatsword: Object.freeze({ offensiveDamage: 1.3, defensiveDamage: 1.5, armorPenetration: .05, parryQuota: 2, parryReduction: .6, perfectParryReduction: 1 }),
  sword_shield: Object.freeze({ blockReduction: .25, heavyBlockReduction: .45, shieldDamageFactor: .3 }),
  unarmed: Object.freeze({}),
});
export function stanceRules(stance) { return STANCE_RULES[stance] ?? STANCE_RULES.unarmed; }
export function sizeFor(bodyLengthM) { return BL_SIZE_TABLE.find(x => Number.isFinite(bodyLengthM) && bodyLengthM < x.max) ?? BL_SIZE_TABLE[2]; }
export function sizeClassFor(bodyLengthM) { return Math.min(5, 3 - sizeFor(bodyLengthM).value); }
export function sizeForUnit(unit = {}) { return unit.bodyLengthM == null ? (BL_SIZE_TABLE.find(x => x.id === unit.sizeId) ?? BL_SIZE_TABLE[2]) : sizeFor(unit.bodyLengthM); }
export function distanceTier(distance) { return DISTANCE_TABLE.find(x => distance >= x.min && distance <= x.max) ?? DISTANCE_TABLE.at(-1); }
export function ratingFor(total) { return RATING_TABLE.find(x => x.min === null || total >= x.min); }
export function initiative({ agility = 0, percent = 0, d20 = 0, attack = [], action = [], flat = 0 } = {}) { return agility * (1 + percent) + d20 + Math.max(0, ...attack, 0) + Math.max(0, ...action, 0) + flat; }
export function bodySizeLabel(unit) {
  const meters = unit.bodyLengthM ?? 1.7;
  return `${sizeFor(meters).name} (${meters}m${unit.mc >= 2 ? ` · MC ${unit.mc}` : ''})`;
}
export function sizeHitModifier(attacker, defender) { const a = sizeForUnit(attacker), d = sizeForUnit(defender); return (defender.mc ?? 1) >= 2 ? a.value + 2 * ((defender.mc ?? 1) - 1) : a.value - d.value; }
export function martialContest(attacker, defender, attackerRoll, defenderRoll) { return attackerRoll + (attacker.martial ?? sizeForUnit(attacker).martial) >= defenderRoll + (defender.martial ?? sizeForUnit(defender).martial); }
export function meleeMultiplier(unit = {}) { const s = sizeForUnit(unit); return (unit.mc ?? 1) >= 2 ? 1 : s.melee; }
export function intentCheck(intent = 'normal', attackerTier = 1, defenderTier = 1, attackerD20 = 10, defenderD20 = 10, ratingBonus = 0) {
  const spec = typeof intent === 'string' ? INTENTS[intent] ?? INTENTS.normal : intent;
  if (!spec.difficulty) return { required: false, success: true, ...spec };
  if (attackerTier < defenderTier - 1) return { required: true, success: false, forced: true, ...spec };
  return { required: true, success: attackerTier * 5 + attackerD20 + ratingBonus >= defenderTier * 5 + defenderD20 + spec.difficulty, ...spec };
}
export function damagePipeline({ initial = 0, bonus = 0, reductions = [], type = 'physical', defense = 0, penetration = 0, attributes = {}, flatReduction = 0, dr = 0, damageMultiplier = 1 } = {}) {
  const reduction = Math.min(1, reductions.slice().sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  const effectiveDefense = Math.max(0, defense * (1 - penetration));
  const armor = type === 'true' ? 1 : 2000 / (effectiveDefense + 2000);
  const attributeReduction = type === 'physical' ? (attributes.con + attributes.str + attributes.agi) * .0025 : type === 'energy' ? (attributes.spi + attributes.int) * .004 : type === 'mental' ? attributes.spi * .008 : 0;
  const composed = (initial + bonus) * damageMultiplier * (1 - reduction);
  const afterArmor = type === 'true' ? composed : composed * armor;
  const result = Math.max(0, afterArmor * (1 - attributeReduction) - (type === 'true' ? 0 : flatReduction));
  return { initial, bonus, reduction, effectiveDefense, armorMultiplier: armor, attributeReduction, beforeDR: result, damage: result * (1 - Math.max(0, Math.min(1, dr))) };
}
export function areaResolution({ baseDamage, mc = 1, coverage = 1, rangeTier = 1, members = 1, colossus = false } = {}) {
  const nHit = Math.max(1, Math.min(members, Math.ceil(members * Math.min(rangeTier, 10) / 10 * coverage)));
  const per = colossus ? baseDamage * mc * coverage : baseDamage;
  return { nHit, damage: per * nHit, perTarget: per };
}
export function moraleResult({ type = 'standard', hp, maxHp, d20 = 20 } = {}) { const rule = MORALE[type] ?? MORALE.standard; const triggered = hp / maxHp < rule.threshold; return { threshold: rule.threshold, triggered, check: rule.check, roll: rule.check ? d20 : null, shaken: triggered && (!rule.check || d20 < 12) }; }
export function nonLethalHp(hp, nonLethal) { return nonLethal ? Math.max(1, hp) : Math.max(0, hp); }
export function normalizeEquipment(unit = {}) { return { mainHand: unit.mainHand ?? unit.weapon ?? null, offHand: unit.offHand ?? null, shield: unit.shield ?? null }; }
