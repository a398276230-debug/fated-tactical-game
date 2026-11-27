import { isGround, zoneContains } from './spatial.js';
import { rollDie } from './rng.js';

export const ZONE_LAYERS = Object.freeze(['surface', 'cloud']);
export const SURFACE_MEDIA = Object.freeze(['water', 'ice', 'oil', 'fire', 'acid', 'electrified_water']);
export const CLOUD_MEDIA = Object.freeze(['steam', 'smoke', 'poison_cloud', 'electrified_steam']);
export const ZONE_MEDIA = Object.freeze([...SURFACE_MEDIA, ...CLOUD_MEDIA]);
export const physicsEnabled = state => state?.elementalPhysics !== 'off';
export const zoneMediumLayer = medium => SURFACE_MEDIA.includes(medium) ? 'surface' : CLOUD_MEDIA.includes(medium) ? 'cloud' : undefined;
export const zoneMediumFields = ['layer', 'medium', 'blocksLOS', 'moveCost'];

const ground = 'self.altitude == 0';
const clear = (...ids) => ({ op: 'remove_status', target: 'self', where: ids.map(id => `status.id == "${id}"`).join(' || ') });
const apply = statusId => ({ op: 'apply_status', target: 'self', statusId, turns: 2 });
const damage = (damageType, minimum, percent) => ({ op: 'damage', target: 'self', damageType, direct: false,
  amount: `max(${minimum}, floor(self.maxHp * ${percent}))` });
const exposure = (id, program, filter = ground, onEntry = false) => [
  { id: `${id}_turn`, hook: 'turn_start', priority: 10, ...(filter && { filter }), program },
  ...(onEntry ? [{ id: `${id}_entry`, hook: 'after_move', filter: [filter, 'self.id == event.actorId'].filter(Boolean).join(' && '), program }] : []),
];

const templates = {
  water: ['浅水洼', 3, ['water', 'wet'], { rules: exposure('water', [clear('burning', 'oiled'), apply('wet')], ground, true) }],
  ice: ['冰面', 3, ['ice', 'cold'], { moveCost: 2 }],
  oil: ['油污', 3, ['oil', 'flammable'], { moveCost: 2, rules: exposure('oil', [apply('oiled')], ground, true) }],
  fire: ['火海', 2, ['fire', 'heat'], { rules: exposure('fire', [damage('fire', 5, 0.05), apply('burning')], ground, true) }],
  acid: ['强酸池', 2, ['acid', 'corrode'], { mods: [{ stat: 'armor', additivePercent: -0.25, when: ground }], rules: exposure('acid', [damage('acid', 4, 0.04)], ground, true) }],
  electrified_water: ['带电水体', 1, ['water', 'lightning', 'shock'], { rules: exposure('electrified_water', [damage('lightning', 5, 0.05)], ground, true) }],
  steam: ['蒸汽云', 2, ['steam', 'wet', 'obscure'], { rules: exposure('steam', [clear('burning'), apply('wet')], null, true) }],
  smoke: ['浓烟', 2, ['smoke', 'obscure'], {}],
  poison_cloud: ['可燃毒雾', 3, ['poison', 'flammable', 'obscure'], { rules: exposure('poison_cloud', [damage('poison', 4, 0.04)], null, true) }],
  electrified_steam: ['雷暴蒸汽', 1, ['steam', 'lightning', 'shock', 'obscure'], { rules: exposure('electrified_steam', [damage('lightning', 5, 0.05)], null, true) }],
};

export function mediumZone(medium) {
  const layer = zoneMediumLayer(medium);
  if (!layer) return undefined;
  const [name, remainingTurns, tags, fields] = templates[medium];
  return { layer, medium, name, remainingTurns, tags: [...tags, 'elemental_medium'],
    ...(layer === 'cloud' && { blocksLOS: true }), ...structuredClone(fields) };
}

export const isMedium = zone => !!zone?.layer && zoneMediumLayer(zone.medium) === zone.layer && (zone.persistent || !(zone.remainingTurns <= 0));
export const mediumRank = zone => zone.flags?.includes('concept_immune') ? 8
  : zone.flags?.includes('undispellable') ? Math.max(7, zone.tier ?? 1) : zone.tier ?? 1;
const cellKey = ({ x, y }) => `${x},${y}`;
export function mediaCells(state, zone) {
  return state.grid.flatMap((row, y) => row.flatMap((_, x) => {
    const at = { x, y };
    return isGround(state, at) && zoneContains(state, zone, at, { ignoreZ: true }) ? [at] : [];
  }));
}

export function removeZone(state, host, zoneId, reason = '解除', detail = {}) {
  const zone = Object.hasOwn(state.zones ?? {}, zoneId) ? state.zones[zoneId] : undefined;
  if (!zone) return false;
  delete state.zones[zoneId];
  for (const poolId of Object.values(zone.pools ?? {})) delete state.pools[poolId];
  host.log(state, state.units?.[zone.sourceId], 'zone', `${zone.name}${reason}后消散`, { zoneId, expired: true, ...detail });
  return true;
}

function setCells(zone, cells) {
  const { z1, z2, anchorUnitId } = zone.area;
  zone.area = { shape: 'cells', cells, ...(z1 !== undefined && { z1 }), ...(z2 !== undefined && { z2 }), ...(anchorUnitId && { anchorUnitId }) };
}

export function removeMediumCells(state, host, zone, cells) {
  const removed = new Set(cells.map(cellKey));
  const remaining = mediaCells(state, zone).filter(at => !removed.has(cellKey(at)));
  if (remaining.length) setCells(zone, remaining);
  else removeZone(state, host, zone.id, '相变');
}

export function putMedium(state, host, zone, rank = mediumRank(zone)) {
  const incoming = { follow: false, persistent: false, ...mediumZone(zone.medium), ...zone };
  if (!isMedium(incoming)) return undefined;
  const overlaps = Object.values(state.zones ?? {}).filter(old => old !== zone && isMedium(old) && old.layer === incoming.layer)
    .map(old => ({ old, cells: mediaCells(state, old) }));
  const protectedCells = new Set(overlaps.filter(({ old }) => mediumRank(old) > rank).flatMap(({ cells }) => cells.map(cellKey)));
  const incomingCells = mediaCells(state, incoming).filter(at => !protectedCells.has(cellKey(at)));
  if (!incomingCells.length) return undefined;
  const keys = new Set(incomingCells.map(cellKey));
  const clipped = overlaps.map(({ old, cells }) => ({ old, cells: cells.filter(at => keys.has(cellKey(at))), size: cells.length }));
  const canReplace = clipped.some(({ cells, size }) => size > 0 && cells.length === size);
  if (!canReplace && Object.keys(state.zones ?? {}).length >= 200) return undefined;
  for (const { old, cells } of clipped) if (cells.length) removeMediumCells(state, host, old, cells);
  setCells(incoming, incomingCells);
  const zones = state.zones ??= {};
  if (!incoming.id) {
    const serials = state.spatialSerial ??= {};
    const used = Object.keys(zones).map(id => Number(/^zone-(\d+)$/.exec(id)?.[1]) || 0);
    serials.zone = Math.max(serials.zone ?? 0, ...used) + 1;
    incoming.id = `zone-${serials.zone}`;
  }
  zones[incoming.id] = incoming;
  return incoming;
}

export function applyMediumEntry(state, host, frame, unit, to) {
  if (!physicsEnabled(state) || unit.altitude > 0 || !Object.values(state.zones ?? {})
    .some(zone => isMedium(zone) && zone.medium === 'ice' && zoneContains(state, zone, { x: to.x, y: to.y }))) return false;
  const roll = rollDie(state.rng, 20);
  state.rng = roll.rng;
  const total = roll.value + Math.floor((unit.stats?.agi ?? 0) / 2);
  if (total >= 12) return false;
  host.grantStatus(state, unit, 'prone', { remainingTurns: 1 });
  host.log(state, unit, 'terrain', `${unit.name}在冰面滑倒`, { targetId: unit.id, x: to.x, y: to.y, roll: roll.value, total });
  return true;
}
