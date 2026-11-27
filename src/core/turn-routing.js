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

function independentManualUnit(unit) {
  return unit && !unit.summoned && unit.team === 'blue' && unit.hp > 0 && !unit.fled;
}

export function manualSharedWindowIndices(state) {
  const order = state.order ?? [];
  const anchor = state.units?.[order[state.turn]];
  if (!anchor || !independentManualUnit(anchor)) return [];
  const shared = state.vm?.sharedTurn;
  const start = shared?.start ?? state.turn;
  const end = shared?.end ?? (() => {
    let last = state.turn;
    for (let index = state.turn + 1; index < order.length; index++) {
      const unit = state.units?.[order[index]];
      if (!unit || unit.hp <= 0 || unit.fled) continue;
      if (!independentManualUnit(unit) || unit.team !== anchor.team) break;
      last = index;
    }
    return last;
  })();
  const indices = [];
  for (let index = start; index <= end; index++) {
    const unit = state.units?.[order[index]];
    if (!unit || unit.hp <= 0 || unit.fled) continue;
    if (!independentManualUnit(unit) || unit.team !== anchor.team) break;
    indices.push(index);
  }
  return indices;
}

export function sharedSquadUnits(state) {
  const indices = manualSharedWindowIndices(state);
  const ended = new Set(state.vm?.sharedTurn?.ended ?? []);
  const shared = indices.length >= 2 ? indices.flatMap(index => {
    const owner = state.units[state.order[index]];
    if (ended.has(owner.id)) return [];
    return [owner, ...linkedUnitsOf(state, owner.id)];
  }) : [];
  const owner = state.units?.[state.order?.[state.turn]];
  const linked = owner && !isAiControlledUnit(owner) ? [owner, ...linkedUnitsOf(state, owner.id)] : [];
  return [...new Map([...shared, ...linked].map(unit => [unit.id, unit])).values()];
}

function isAiControlledUnit(unit) {
  return unit?.team === 'red' || unit?.controlPolicy?.mindControl;
}

export function canRouteActor(state, actorId) {
  const anchor = state.units?.[state.order?.[state.turn]];
  const actor = state.units?.[actorId];
  if (!anchor || !actor || actor.hp <= 0 || actor.fled) return false;
  if (actor.id === anchor.id || (isLinkedMode(actor) && actor.turnAnchorId === anchor.id && actor.team === anchor.team)) return true;
  return sharedSquadUnits(state).some(unit => unit.id === actor.id);
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
