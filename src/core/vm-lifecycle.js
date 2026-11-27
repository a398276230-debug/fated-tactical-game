import { removeStatus } from './vm-rules.js';
import { removeSummon, removeZone } from './vm-spatial-ops.js';

const alive = unit => unit?.hp > 0 && !unit.fled;
const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const sourceBound = entity => entity.bindToSource === true || entity.concentration === true;

export function lifecycleFields(declaration, template, event, ref = 'init') {
  return {
    ...((declaration.bindToSource ?? event?.bindToSource ?? template?.bindToSource) === true && { bindToSource: true }),
    ...((declaration.concentration ?? event?.concentration ?? template?.concentration) === true && { concentration: true, concentrationRef: ref }),
  };
}

export function effectLifecycle(state, frame, event, declaration, template) {
  const action = state.vm.stack.findLast(entry => entry.native === 'action');
  const hook = frame.hook ?? state.vm.stack.find(entry => entry.frameId === frame.branchFrameId)?.hook;
  const defaults = hook === 'active' && action?.eventRef === frame.eventRef ? event : null;
  return lifecycleFields(declaration, template, defaults, action?.eventRef ?? 'init');
}

export function canPlaceBoundEffect(state, effect) {
  return !sourceBound(effect) || effect.sourceId == null || alive(own(state.units, effect.sourceId));
}

function removeBoundEntities(state, sourceId, matches, reason, host, frame, seen) {
  const source = own(state.units, sourceId);
  for (const unitId of Object.keys(state.units).sort()) {
    const unit = state.units[unitId];
    for (const statusId of Object.keys(unit.statuses ?? {}).sort()) {
      const status = own(unit.statuses, statusId);
      if (status?.sourceId === sourceId && matches(status)) removeStatus(state, unit, status, reason, source, host, frame);
    }
  }
  for (const zoneId of Object.keys(state.zones ?? {}).sort()) {
    const zone = state.zones[zoneId];
    if (zone.sourceId === sourceId && matches(zone)) removeZone(state, host, zone.id, reason, { reason });
  }
  for (const unitId of Object.keys(state.units).sort()) {
    const unit = own(state.units, unitId);
    if (unitId !== sourceId && unit?.summoned && unit.sourceId === sourceId && alive(unit) && matches(unit)) {
      removeSummon(state, unit, host, frame, reason, seen);
    }
  }
}

export function cleanupSourceBoundEntities(state, sourceId, reason, host, frame, seen = new Set()) {
  if (seen.has(sourceId)) return;
  seen.add(sourceId);
  removeBoundEntities(state, sourceId, sourceBound, reason, host, frame, seen);
  // A bound summon also leaves when its explicit duration anchor is gone,
  // even if the anchor is not the source that created it.
  for (const id of Object.keys(state.units).sort()) {
    const unit = own(state.units, id);
    if (unit?.summoned && alive(unit) && sourceBound(unit) && unit.durationAnchorId === sourceId) {
      removeSummon(state, unit, host, frame, reason, seen);
    }
  }
}

export function hasActiveConcentration(state, sourceId) {
  const matches = entity => entity.sourceId === sourceId && entity.concentration === true;
  return Object.values(state.zones ?? {}).some(matches) || Object.values(state.units).some(unit =>
    (unit.summoned && alive(unit) && matches(unit)) || Object.values(unit.statuses ?? {}).some(matches));
}

export function breakConcentration(state, sourceId, reason, host, frame, { exceptRef } = {}) {
  if (sourceId == null) return;
  const seen = new Set([sourceId]);
  removeBoundEntities(state, sourceId, entity => entity.concentration === true &&
    (exceptRef === undefined || entity.concentrationRef !== exceptRef), reason, host, frame, seen);
}

export function switchConcentration(state, effect, host, frame) {
  if (effect.concentration === true) breakConcentration(state, effect.sourceId, '切换专注', host, frame, { exceptRef: effect.concentrationRef });
}
