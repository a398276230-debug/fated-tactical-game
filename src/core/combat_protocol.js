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
export const TIER_CELL_M = Object.freeze([null, 2, 2, 5, 15, 50, 250, 1000]);
export const QUALITY_TIER = Object.freeze({ 普通: 1, 优良: 2, 稀有: 3, 史诗: 4, 传说: 5, 神话: 6 });
export const QUALITY_AUTHORITY = Object.freeze({ ...QUALITY_TIER, 唯一: 8 });
const clampTier = tier => Math.max(1, Math.min(7, Math.trunc(Number(tier) || 1)));
export function resolveEffectiveTier(carrierKind, quality, unitTier) {
  const actorTier = clampTier(unitTier);
  if (!quality || quality === '唯一') return actorTier;
  const qualityTier = QUALITY_TIER[quality];
  if (!qualityTier) return actorTier;
  return carrierKind === 'skill' ? Math.max(qualityTier, actorTier) : Math.min(qualityTier, actorTier);
}
export function resolveAuthorityRank(carrier = {}, ownerUnit = {}) {
  const unitTier = clampTier(ownerUnit.tier ?? carrier.sourceTier ?? 1);
  const authorityRank = carrier.quality === '唯一' ? 8
    : QUALITY_AUTHORITY[carrier.quality] ?? Math.max(1, Math.min(7, Math.trunc(Number(carrier.authorityRank ?? carrier.tier ?? unitTier) || unitTier)));
  return { authorityRank, unitTier };
}
function scaledMeters(raw, effectiveTier) { return Number(raw || 0) * (TIER_CELL_M[clampTier(effectiveTier)] ?? TIER_CELL_M[1]); }
export function scaledCells(raw, effectiveTier, cellM, { max = Infinity, floor = false } = {}) {
  const cells = scaledMeters(raw, effectiveTier) / Math.max(1e-9, Number(cellM) || 1);
  return Math.max(0, Math.min(max, floor ? Math.floor(cells + 1e-9) : cells));
}
export const scaledMoveCells = (raw, effectiveTier, cellM) => scaledCells(raw, effectiveTier, cellM, { floor: true });

export function scaledTemplate(state, unit, template, kind) {
  if (!template) return template;
  const tier = resolveEffectiveTier(kind, template.quality, unit.tier);
  const cellM = state.scale?.cellM ?? 2;
  const result = { ...template };
  if (template.target === 'self') result.range = 0;
  else if (template.rawRange != null) result.range = scaledCells(template.rawRange, tier, cellM, { max: 64, floor: true });
  for (const [rawKey, key] of [['rawRadius', 'radius'], ['rawInnerRadius', 'innerRadius'], ['rawWidth', 'width']]) {
    if (template[rawKey] != null) result[key] = scaledCells(template[rawKey], tier, cellM, { max: 30 });
  }
  return result;
}
export const DISTANCE_TABLE = Object.freeze([
  { name: '贴身', min: 0, max: 0, hit: 4, range: 6 }, { name: '近程', min: 1, max: 2, hit: 0, range: 2 },
  { name: '中程', min: 3, max: 5, hit: -2, range: 0 }, { name: '远程', min: 6, max: 10, hit: -4, range: 0 },
  { name: '超距', min: 11, max: null, hit: -6, range: 0 },
]);
export const UNIT_STATS = Object.freeze(['str', 'agi', 'con', 'int', 'spi']);
export const DAMAGE_TYPES = Object.freeze(['physical', 'energy', 'mental', 'true']);
export const STANCES = Object.freeze(['light_blade', 'dual_wield', 'attunement', 'greatsword', 'sword_shield', 'unarmed']);
export const MORALE_STATES = Object.freeze(['steady', 'shaken', 'routed']);
export const INTENTS = Object.freeze({ normal: { name: '常规', difficulty: 0, multiplier: 1 },
  function: { name: '机能限制', difficulty: 5, multiplier: 1.1 }, core: { name: '核心要害', difficulty: 10, multiplier: 1.4 },
  kill: { name: '抹杀', difficulty: 15, multiplier: 1.7 }, concept: { name: '概念破碎', difficulty: 20, multiplier: 2 } });
export const MORALE = Object.freeze({ spar: { threshold: .4, check: false }, arena: { threshold: .3, check: false },
  suppress: { threshold: .5, check: false }, deathmatch: { threshold: .1, check: true }, standard: { threshold: .3, check: true }, guard: { threshold: .35, check: true } });
export const stanceFor = (slots = {}) => {
  const main = slots.mainHand ?? slots.weapon ?? null, off = slots.offHand ?? null, shield = slots.shield ?? null;
  if (shield) return 'sword_shield';
  if (!main) return 'unarmed';
  if (off?.kind === 'consumable') return 'attunement';
  if (main?.heavy || main?.twoHanded) return 'greatsword';
  if (off) return 'dual_wield';
  if (main?.ranged || main?.kind === 'ranged') return 'light_blade';
  return main ? 'light_blade' : 'unarmed';
};
export const stanceLabel = Object.freeze({ light_blade: '轻剑', dual_wield: '双持', attunement: '同调', greatsword: '重剑', sword_shield: '剑盾', unarmed: '无械' });
export const STANCE_RULES = Object.freeze({
  light_blade: { armorPenetration: .08, closeRange: true, rangedDistancePenalty: 0 },
  dual_wield: { offHandDamage: .5, comboOffHandDamage: .75, followUp: true },
  attunement: { itemCharges: 2 },
  greatsword: { offensiveDamage: 1.3, defensiveDamage: 1.5, armorPenetration: .05, parryQuota: 2, parryReduction: .6, perfectParryReduction: 1 },
  sword_shield: { blockReduction: .25, heavyBlockReduction: .45, shieldDamageFactor: .3 },
  unarmed: {},
});
export function stanceRules(stance) { return STANCE_RULES[stance] ?? STANCE_RULES.unarmed; }
export function sizeFor(bodyLengthM) { return BL_SIZE_TABLE.find(x => Number.isFinite(bodyLengthM) && bodyLengthM < x.max) ?? BL_SIZE_TABLE[2]; }
export function sizeClassFor(bodyLengthM) { return Math.min(5, 3 - sizeFor(bodyLengthM).value); }
function sizeForUnit(unit = {}) { return unit.bodyLengthM == null ? (BL_SIZE_TABLE.find(x => x.id === unit.sizeId) ?? BL_SIZE_TABLE[2]) : sizeFor(unit.bodyLengthM); }
// Keep the descriptor-facing table's closed integer endpoints unchanged. For continuous distances,
// d=0 is the exact 贴身 point; d in (0,1) maps to 近程, and d >= 1 is floored into
// the table's effective half-open ranges [1,3), [3,6), [6,11), and [11,+∞).
export function distanceTier(distance) {
  const value = Number(distance);
  if (value === 0) return DISTANCE_TABLE[0];
  const normalized = value > 0 && value < 1 ? 1 : Math.floor(value);
  return DISTANCE_TABLE.find(entry => normalized >= entry.min && (entry.max == null || normalized <= entry.max)) ?? DISTANCE_TABLE.at(-1);
}
export function ratingFor(total) { return RATING_TABLE.find(x => x.min === null || total >= x.min); }
export function initiative({ agility = 0, percent = 0, d20 = 0, attack = [], action = [], flat = 0 } = {}) { return agility * (1 + percent) + d20 + Math.max(0, ...attack, 0) + Math.max(0, ...action, 0) + flat; }
export function bodySizeLabel(unit) {
  const meters = unit.bodyLengthM ?? 1.7;
  return `${sizeFor(meters).name} (${meters}m${unit.mc >= 2 ? ` · MC ${unit.mc}` : ''})`;
}
export function sizeHitModifier(attacker, defender) { const a = sizeForUnit(attacker), d = sizeForUnit(defender); return (defender.mc ?? 1) >= 2 ? a.value + 2 * ((defender.mc ?? 1) - 1) : a.value - d.value; }
export function meleeMultiplier(unit = {}) { const s = sizeForUnit(unit); return (unit.mc ?? 1) >= 2 ? 1 : s.melee; }
export function intentCheck(intent = 'normal', attackerTier = 1, defenderTier = 1, attackerD20 = 10, defenderD20 = 10, ratingBonus = 0) {
  const spec = typeof intent === 'string' ? INTENTS[intent] ?? INTENTS.normal : intent;
  const special = spec.name !== INTENTS.normal.name;
  if (!special) return { required: false, success: true, ...spec };
  // The tier wall is a rule of special intent itself; do not let a negative
  // difficulty modifier turn a two-tier gap into an ordinary contest.
  if (attackerTier < defenderTier - 1) return { required: true, success: false, forced: true, ...spec };
  return { required: true, success: attackerTier * 5 + attackerD20 + ratingBonus >= defenderTier * 5 + defenderD20 + spec.difficulty, ...spec };
}
export function typedArmor(type, defense) {
  return type === 'physical' ? defense : type === 'energy' ? defense / 2 : 0;
}
export function damageAttributeReduction(type, { con = 0, str = 0, agi = 0, spi = 0, int = 0 } = {}) {
  if (type === 'physical') return (con + str + agi) * .0025;
  if (type === 'energy') return (spi + int) * .004;
  return type === 'mental' ? spi * .008 : 0;
}
export function damagePipeline({ initial = 0, bonus = 0, reductions = [], type = 'physical', defense = 0, penetration = 0, attributes = {}, flatReduction = 0, dr = 0, damageMultiplier = 1 } = {}) {
  const reduction = type === 'true' ? 0 : Math.min(1, reductions.slice().sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  const effectiveDefense = typedArmor(type, Math.max(0, defense * (1 - penetration)));
  const armor = 2000 / (effectiveDefense + 2000);
  const attributeReduction = damageAttributeReduction(type, attributes);
  const composed = (initial + bonus) * damageMultiplier * (1 - reduction);
  const afterArmor = type === 'true' ? composed : composed * armor;
  const result = Math.max(0, afterArmor * (1 - attributeReduction) - (type === 'true' ? 0 : flatReduction));
  return { initial, bonus, reduction, effectiveDefense, armorMultiplier: armor, attributeReduction, beforeDR: result, damage: result * (1 - (type === 'true' ? 0 : Math.max(0, Math.min(1, dr)))) };
}
export function areaResolution({ baseDamage, mc = 1, coverage = 1, rangeTier = 1, members = 1, colossus = false } = {}) {
  const nHit = Math.max(1, Math.min(members, Math.ceil(members * Math.min(rangeTier, 10) / 10 * coverage)));
  const per = colossus ? baseDamage * mc * coverage : baseDamage;
  return { nHit, damage: per * nHit, perTarget: per };
}
export const moraleTypes = Object.freeze({标准:'standard',切磋:'spar',竞技:'arena',压制:'suppress',死斗:'deathmatch',守卫:'guard'});
export const moraleTypeFor = value => Object.hasOwn(MORALE,value) ? value : Object.hasOwn(moraleTypes,value) ? moraleTypes[value] : null;
export const moraleLabels = Object.freeze({steady:'坚守',shaken:'动摇',routed:'溃逃'});
export const moraleModifiers = Object.freeze({shaken:Object.freeze({accuracy:-2}),routed:Object.freeze({accuracy:-4})});
export function moraleResult({ type = 'standard', hp, maxHp, d20 } = {}) {
  const {threshold,check} = MORALE[type] ?? MORALE.standard;
  const triggered = maxHp > 0 && hp / maxHp < threshold;
  const roll = triggered && check ? d20 ?? null : null;
  return {threshold,check,triggered,roll,outcome: !triggered ? 'steady' : !check ? 'shaken' : roll !== null && roll < 12 ? 'routed' : 'steady'};
}
export function nonLethalHp(hp, nonLethal) { return nonLethal ? Math.max(1, hp) : Math.max(0, hp); }
export function normalizeEquipment(unit = {}) { return { mainHand: unit.mainHand ?? unit.weapon ?? null, offHand: unit.offHand ?? null, shield: unit.shield ?? null }; }
