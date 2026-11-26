const linkedModes = new Set(['linked_group', 'linked_each']);

export const isLinkedMode = unit => linkedModes.has(unit?.turnMode);

export function linkedUnitsOf(state, anchorId) {
  return Object.values(state.units ?? {})
    .filter(unit => unit.summoned && unit.turnAnchorId === anchorId && isLinkedMode(unit)
      && unit.hp > 0 && !unit.fled)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function linkedGroupKey(unit) {
  return unit?.turnMode === 'linked_group' && unit.summonGroup && unit.turnAnchorId
    ? `${unit.turnAnchorId}:${unit.summonGroup}` : null;
}

export function canRouteActor(state, actorId) {
  const anchor = state.units?.[state.order?.[state.turn]];
  const actor = state.units?.[actorId];
  if (!anchor || !actor || actor.hp <= 0 || actor.fled) return false;
  return actor.id === anchor.id || (isLinkedMode(actor) && actor.turnAnchorId === anchor.id && actor.team === anchor.team);
}

export function actionActor(state, action) {
  const actorId = action?.actorId ?? state.order?.[state.turn];
  return canRouteActor(state, actorId) ? state.units[actorId] : undefined;
}

export function syncLinkedGroupSlots(state, actor, slot, used) {
  const key = linkedGroupKey(actor);
  if (!key || !['attack', 'action'].includes(slot)) return;
  state.vm ??= {};
  state.vm.linkedGroupUsed ??= {};
  state.vm.linkedGroupUsed[key] ??= { attack: 0, action: 0 };
  state.vm.linkedGroupUsed[key][slot] = used;
  for (const unit of linkedUnitsOf(state, actor.turnAnchorId)) {
    if (linkedGroupKey(unit) !== key) continue;
    unit.used ??= { attack: 0, action: 0 };
    unit.used[slot] = used;
    unit.ap = Math.max(0, (unit.apMax ?? 2) - (unit.used.attack ?? 0) - (unit.used.action ?? 0));
  }
}
