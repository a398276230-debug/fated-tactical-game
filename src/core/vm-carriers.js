import { evaluateExpr } from './formula.js';
import { movementBudget } from './combat-actions.js';
import { isStatusImmune } from './vm-immunity.js';
import { distance3D } from './spatial.js';
import { resolveEffectiveTier } from './combat_protocol.js';
import { pointElevation, selectVM, zoneContains } from './vm-select.js';
import { getPool } from './vm-pools.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const entries = table => Object.keys(table ?? {}).sort().map(key => [key, table[key]]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const alive = unit => Boolean(unit && !unit.fled && (unit.alive ?? unit.hp > 0));
const active = entity => entity.persistent || entity.durationType === 'persistent'
  || entity.durationType === 'until_removed' || !(entity.remainingTurns <= 0);
const idOf = ref => typeof ref === 'string' ? ref : ref?.id;
const slots = ['attack', 'action', 'move', 'cast', 'reaction', 'fly', 'teleport'];

export function itemRules(template, item) {
  return [...new Map([...(template?.rules ?? []), ...(item?.rules ?? [])].map(rule => [rule.id, rule])).values()];
}

export function skillCarrierVars(state, { id, ownerId }) {
  return { ...own(state.skills, id)?.vars, ...own(state.vm?.skillVars, JSON.stringify([ownerId, id])) };
}

// Enumeration order is unit, nested status, held skill, item, zone.
// References use table keys so VM owner writes reach the original instance.
function carriers(state) {
  const units = entries(state.units);
  const equippedBy = new Map();
  const result = [];
  for (const [id, unit] of units) {
    result.push({ entity: unit, carrier: { type: 'unit', id }, nativeOwnerId: id });
    for (const itemId of [unit.mainHand, unit.offHand, unit.shield, unit.weapon, ...(unit.gear ?? []), ...(unit.bagWeapons ?? [])]) {
      if (itemId != null && !equippedBy.has(itemId)) equippedBy.set(itemId, id);
    }
  }
  for (const [ownerId, unit] of units) {
    for (const [id, entity] of entries(unit.statuses)) {
      if (active(entity)) result.push({ entity, carrier: { type: 'status', id, ownerId }, nativeOwnerId: ownerId });
    }
  }
  for (const [ownerId, unit] of units) {
    if (unit.fled) continue;
    for (const id of [...new Set(unit.skills ?? [])].sort()) {
      const skill = own(state.skills, id);
      if (!skill) continue;
      const carrier = { type: 'skill', id, ownerId };
      result.push({ entity: { ...skill, id, vars: skillCarrierVars(state, carrier) }, carrier, nativeOwnerId: ownerId });
    }
  }
  for (const [id, entity] of entries(state.items)) {
    const nativeOwnerId = equippedBy.get(id) ?? entity.ownerId;
    const template = own(state.equipment, entity.templateId);
    if (own(state.units, nativeOwnerId) && (!template?.boundTo || template.boundTo === nativeOwnerId)) {
      result.push({ entity: { ...template, ...entity, id, vars: { ...template?.vars, ...entity.vars } }, carrier: { type: 'item', id }, nativeOwnerId });
    }
  }
  for (const [id, entity] of entries(state.zones)) {
    if (!entity.area) continue;
    const anchorId = entity.area.anchorUnitId;
    if (!active(entity) || (entity.follow && anchorId && !alive(own(state.units, anchorId)))) continue;
    result.push({ entity, carrier: { type: 'zone', id }, nativeOwnerId: anchorId ?? entity.sourceId });
  }
  return result;
}

export function incomingDistanceOffset(state, actor, target, event = {}) {
  if (!actor?.team || !target?.team || actor.team === target.team || !own(state.units, target.id)) return 0;
  return Math.max(0, applyStatMod(0, aggregateModifiers(state, target.id, {
    ...event, actorId: actor.id, targetId: target.id,
  }).stats.incomingDistanceOffset));
}

export function carrierEffectiveTier(state, ref, owner) {
  const nativeOwner = own(state.units, ref?.ownerId) ?? owner;
  if (ref?.type === 'status') {
    const status = own(nativeOwner?.statuses, ref.id);
    return status?.effectiveTier ?? resolveEffectiveTier('unit', null, status?.sourceTier ?? nativeOwner?.tier);
  }
  if (ref?.type === 'skill') {
    const skill = own(state.skills, ref.id);
    return resolveEffectiveTier(skill?.backpackItem ? 'item' : 'skill', skill?.quality, nativeOwner?.tier);
  }
  if (ref?.type === 'item') {
    const item = own(state.items, ref.id);
    return resolveEffectiveTier('item', own(state.equipment, item?.templateId)?.quality, nativeOwner?.tier);
  }
  if (ref?.type === 'zone') return own(state.zones, ref.id)?.effectiveTier ?? resolveEffectiveTier('unit', null, nativeOwner?.tier);
  return resolveEffectiveTier('unit', null, nativeOwner?.tier);
}

function eventUnit(state, ref) {
  return own(state.units, idOf(ref));
}

function sourceIdOf(row, ownerId, event) {
  return row.entity.sourceId ?? row.nativeOwnerId ?? event.sourceId ?? idOf(event.source) ?? ownerId;
}

export function eventWeapon(state, event, item, unit) {
  const weapon = own(state.equipment, event.weaponTemplateId)
    ?? own(state.equipment, own(state.items, event.weaponId)?.templateId);
  if (weapon) return weapon;
  const carried = own(state.equipment, item?.templateId);
  if (carried?.kind === 'weapon' && carried.attack !== undefined) return carried;
  const main = own(state.items, unit?.mainHand ?? unit?.weapon);
  const template = own(state.equipment, main?.templateId);
  return !template?.boundTo || template.boundTo === unit?.id ? template : null;
}

export function carrierScope(state, row, ownerId, event, queries = {}) {
  const self = own(state.units, ownerId);
  const immunity = queries.isImmune ?? ((currentState, unit, key, context) => isStatusImmune(
    currentState, unit, key, context?.source ?? own(currentState.units, event.sourceId ?? event.actorId),
    { collectRules, carrierScope }));
  const source = eventUnit(state, sourceIdOf(row, ownerId, event));
  const target = eventUnit(state, event.targetId ?? event.target);
  const attacker = eventUnit(state, event.actorId ?? event.actor ?? event.attackerId ?? event.attacker
    ?? event.sourceId ?? event.source ?? event.killerId ?? event.killer) ?? source;
  return {
    self, source, target, attacker, event: { ...event, actor: attacker, source, target },
    vars: row.entity.vars,
    status: row.carrier.type === 'status' ? row.entity : undefined,
    zone: row.carrier.type === 'zone' ? row.entity : undefined,
    skill: row.carrier.type === 'skill' ? row.entity : undefined,
    item: row.carrier.type === 'item' ? row.entity : undefined,
    center: event.center, round: state.round, turn: state.turn, timeOfDay: state.time?.timeOfDay,
    units: state.units, zones: state.zones,
    effectiveTier: carrierEffectiveTier(state, row.carrier, own(state.units, row.nativeOwnerId) ?? self),
    cellM: state.scale?.cellM ?? 2, boardW: state.grid?.[0]?.length, boardH: state.grid?.length,
    ...(state.grid && { distance: (a = self, b = target) => Number.isFinite(a?.x) && Number.isFinite(a?.y)
      && Number.isFinite(b?.x) && Number.isFinite(b?.y) ? distance3D(state, a, b) : null }),
    elevation: entity => pointElevation(state, entity),
    resource: (unit, key) => key === 'move' ? (unit ? movementBudget(state, unit).remainingCells : 0)
      : key === 'attack' || key === 'action' ? Math.max(0, 1 - (unit?.used?.[key] ?? 0))
      : key === 'reaction' && unit ? (unit.reactionAvailable === false ? 0 : 1)
      : getPool(state, unit?.id, key, 'unit')?.current ?? own(unit, key),
    itemResource: (item, key) => getPool(state, item?.id, key, 'item')?.current ?? 0,
    inZone: (unit, key) => entries(state.zones).some(([, zone]) => active(zone)
      && (zone.id === key || zone.templateId === key || zone.tags?.includes(key)) && zoneContains(state, zone, unit)),
    isImmune: (unit, key, context) => immunity(state, unit, key, context ?? { source }),
    weapon: () => eventWeapon(state, event, row.carrier.type === 'item' ? row.entity : undefined, attacker ?? self),
    select: (key, context) => selectVM(state, own(queries.selectors, key) ?? key, context, { pure: true }),
  };
}

function recipients(state, row, unitIds, event, queries, hook) {
  const { entity, carrier, nativeOwnerId } = row;
  const shared = entity.shareRulesTo ? new Set(selectVM(state, entity.shareRulesTo,
    carrierScope(state, row, nativeOwnerId, event, queries), { pure: true })) : null;
  return unitIds.filter(id => {
    const unit = own(state.units, id);
    return carrier.type === 'zone' ? zoneContains(state, entity, unit)
      || (hook === 'after_move' && id === event.actorId && Array.isArray(event.traversedCells)
        && event.traversedCells.some(pt => zoneContains(state, entity, pt)))
      || shared?.has(unit) : id === nativeOwnerId || shared?.has(unit);
  });
}

export function eventOwners(state, hook, event) {
  const actor = event.actorId ?? event.actor ?? event.sourceId ?? event.source;
  const target = event.targetId ?? event.target;
  const killer = event.killerId ?? event.killer ?? actor;
  const dead = event.deadId ?? event.killedId ?? (typeof event.killed === 'boolean' ? undefined : event.killed) ?? target;
  let refs;
  if (event.ownerIds) refs = event.ownerIds;
  else if (hook === 'after_move' || hook === 'round_start' || hook === 'round_end') refs = entries(state.units).filter(([, unit]) => alive(unit)).map(([id]) => id);
  else if (hook === 'on_lethal_p1' || hook === 'on_lethal_p2') {
    refs = event.units ?? entries(state.units).filter(([, unit]) => event.poolId != null && unit.pools?.hp === event.poolId).map(([id]) => id);
  } else if (hook === 'on_ally_death') {
    const ally = eventUnit(state, dead);
    refs = ally ? entries(state.units).filter(([id, unit]) => id !== ally.id && unit.team === ally.team && alive(unit)).map(([id]) => id) : [];
  } else if (hook === 'on_death') refs = event.units ?? [dead];
  else if (hook === 'on_kill') refs = [killer];
  else if (hook === 'turn_start' || hook === 'turn_end') refs = [event.unitId ?? event.unit ?? actor ?? target];
  else refs = [actor, event.sourceId ?? event.source, target, ...(event.targets ?? [])];
  return [...new Set(refs.map(idOf).filter(id => id != null && own(state.units, id)))].sort();
}

function carrierDedupePrefix({ entity, carrier, nativeOwnerId }, ownerId, pooled = false) {
  if (!pooled && ownerId === nativeOwnerId && carrier.type === 'item') return `item:${carrier.id}`;
  return entity.templateId ?? JSON.stringify([carrier.type, carrier.ownerId, carrier.id]);
}

/**
 * Tactical VM host.rules callback. Event participants use unit IDs (actorId,
 * sourceId, targetId, targets). ownerIds explicitly selects participants;
 * board rules instead consider all living units as potential recipients.
 * Lethal hooks use units or the HP binding poolId and dedupe across that group.
 * The first rule in priority/carrier/ID order represents each dedupe key.
 * Filters and battle-use counters are evaluated by the VM on frame entry.
 */
export function collectRules(state, hook, event = {}, queries = {}) {
  if (hook === 'active') return [];
  const unitIds = eventOwners(state, hook, event);
  let boardUnitIds;
  const boardOwners = () => boardUnitIds ??= entries(state.units).filter(([, unit]) => alive(unit)).map(([id]) => id);
  const candidates = [];
  const pooled = hook === 'on_lethal_p1' || hook === 'on_lethal_p2';
  const carrierRows = carriers(state);
  if (hook === 'after_status_removed' && event.removedStatus?.rules?.length) {
    const removed = event.removedStatus;
    carrierRows.push({ entity: removed, carrier: { type: 'status', id: removed.id, ownerId: event.targetId }, nativeOwnerId: event.targetId });
  }
  for (const [carrierOrder, row] of carrierRows.entries()) {
    // The HP pool has already hit zero during lethal interception; the owner
    // still gets their own last-chance skills before they become a corpse.
    if (hook === 'after_move' && row.nativeOwnerId && !alive(own(state.units, row.nativeOwnerId))) continue;
    if (row.carrier.type === 'skill' && !['on_lethal_p1', 'on_lethal_p2', 'on_death'].includes(hook)
      && !alive(own(state.units, row.nativeOwnerId))) continue;
    const rules = row.entity.rules?.filter(rule => rule.enabled !== false && rule.hook === hook);
    if (!rules?.length) continue;
    let participantRecipients, boardRecipients;
    for (const rule of rules) {
      const owners = rule.listenScope === 'board'
        ? (boardRecipients ??= recipients(state, row, boardOwners(), event, queries, hook))
        : (participantRecipients ??= unitIds.length ? recipients(state, row, unitIds, event, queries, hook) : []);
      for (const ownerId of owners) {
        const dedupeKey = rule.dedupeKey ?? `${carrierDedupePrefix(row, ownerId, pooled)}:${rule.id}`;
        const useKey = JSON.stringify([ownerId, dedupeKey]);
        candidates.push({ dedupeKey, entry: { rule, carrierOrder, ownerId, sourceId: sourceIdOf(row, ownerId, event), carrier: row.carrier, useKey } });
      }
    }
  }
  candidates.sort(({ entry: a }, { entry: b }) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0)
    || a.carrierOrder - b.carrierOrder || compare(a.rule.id, b.rule.id) || compare(a.ownerId, b.ownerId));
  const seen = new Set();
  return candidates.flatMap(({ dedupeKey, entry }) => {
    const key = pooled ? dedupeKey : entry.useKey;
    if (seen.has(key)) return [];
    seen.add(key);
    return [entry];
  });
}

function matchesModifier(mod, event) {
  return (mod.damageType === undefined || mod.damageType === event.damageType)
    && (mod.statusId === undefined || mod.statusId === event.statusId)
    && (mod.pool === undefined || mod.pool === event.pool)
    && (mod.checkKind === undefined || mod.checkKind === event.checkKind
      || mod.checkKind === event.statusId || event.tags?.includes(mod.checkKind));
}

/**
 * Read a unit's effective { stats, locks, flags, controlPolicy }. Each stats
 * entry has flat, mult and additivePercent totals. A missing entry is neutral.
 * Mod identity is template + declaration index. First applicable declaration
 * wins. Lock/flag grants union together and the first explicit policy field wins.
 * Target prohibitions union across applicable sources; charmTeam is the first charm's source team.
 * The optional queries object supplies selectors by name and isImmune(state, unit, key).
 */
export function aggregateModifiers(state, unitId, event = {}, queries = {}) {
  const stats = new Map();
  const locks = Object.fromEntries(slots.map(slot => [slot, false]));
  const flags = new Set();
  const policy = new Map();
  const costRedirects = [];
  let forbid = false;
  let forbidReason = null;
  let pooledCostFlat = 0;
  const forbiddenTargetIds = new Set();
  let charmTeam = null, foundCharm = false;
  const seen = new Set();
  if (own(state.units, unitId)) {
    for (const row of carriers(state)) {
      if (row.carrier.type === 'skill' && !alive(own(state.units, row.nativeOwnerId))) continue;
      if (!row.entity.mods?.length || !recipients(state, row, [unitId], event, queries).length) continue;
      const context = carrierScope(state, row, unitId, event, queries);
      for (const [index, mod] of row.entity.mods.entries()) {
        const key = JSON.stringify([carrierDedupePrefix(row, unitId), index]);
        if (seen.has(key) || !matchesModifier(mod, event)
          || (mod.when !== undefined && evaluateExpr(mod.when, context) !== true)) continue;
        const values = {};
        for (const field of ['flat', 'mult', 'additivePercent']) {
          if (mod[field] === undefined) continue;
          const value = evaluateExpr(mod[field], context);
          if (Number.isFinite(value)) values[field] = value;
        }
        if (!Object.keys(values).length && !mod.locks?.length && !mod.flags?.length && !Object.keys(mod.controlPolicy ?? {}).length
          && mod.forbidAction !== true && !mod.costRedirect) continue;
        seen.add(key);
        if (mod.forbidAction === true && !forbid) {
          forbid = true;
          forbidReason = mod.forbidReason || (row.entity.name ? `受【${row.entity.name}】限制，无法执行该行动` : '当前规则禁止执行该行动');
        }
        if (mod.costRedirect) costRedirects.push(mod.costRedirect);
        if (mod.stat === 'costFlat' && mod.pool !== undefined) pooledCostFlat += values.flat ?? 0;
        if (mod.stat && Object.keys(values).length) {
          const total = stats.get(mod.stat) ?? { flat: 0, mult: 1, additivePercent: 0 };
          total.flat += values.flat ?? 0;
          total.mult *= values.mult ?? 1;
          total.additivePercent += values.additivePercent ?? 0;
          stats.set(mod.stat, total);
        }
        for (const lock of mod.locks ?? []) if (Object.hasOwn(locks, lock)) locks[lock] = true;
        for (const flag of mod.flags ?? []) flags.add(flag);
        for (const [field, value] of Object.entries(mod.controlPolicy ?? {})) {
          if (!policy.has(field)) policy.set(field, Array.isArray(value) ? [...value] : value);
        }
        const charm = mod.controlPolicy?.mindControl === 'charm';
        if (charm || mod.controlPolicy?.forbidTargetSource === true) {
          const sourceId = sourceIdOf(row, unitId, event);
          if (sourceId != null) forbiddenTargetIds.add(sourceId);
          if (charm && !foundCharm) {
            foundCharm = true;
            charmTeam = context.source?.team ?? null;
          }
        }
      }
    }
  }
  return {
    stats: Object.fromEntries(stats), locks, flags: Object.fromEntries([...flags].map(flag => [flag, true])),
    controlPolicy: Object.fromEntries(policy), forbiddenTargetIds, charmTeam, forbid, forbidReason, costRedirects, pooledCostFlat,
  };
}

export function unitSkipped(state, unit) {
  const { locks } = aggregateModifiers(state, unit.id);
  return locks.attack && locks.action && locks.move && locks.cast;
}

export function reactionBlocked(state, unit) {
  const { locks } = aggregateModifiers(state, unit.id);
  return locks.reaction || locks.attack;
}

/** Combine a base stat with the corresponding entry in aggregateModifiers().stats. */
export function applyStatMod(base, { flat = 0, mult = 1, additivePercent = 0 } = {}) {
  return (base + flat) * (1 + additivePercent) * mult;
}
