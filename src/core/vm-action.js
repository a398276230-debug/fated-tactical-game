import { evaluateExpr } from './formula.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { resolvePoint } from './vm-select.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

export function queueVMAction(state, { actorId, action, overrides = {}, record = false }) {
  return pushFrame(state, { native: 'action', ownerId: actorId, sourceId: actorId,
    data: { action, overrides, record }, answers: [] });
}

export function perform({ state, context, select, op }) {
  const actors = select(op.actor);
  for (const actor of actors.reverse()) {
    if (actor.hp <= 0 || actor.fled) continue;
    const tapeKey = typeof op.tapeRecord === 'string' ? op.tapeRecord.replace(/^vars\./, '') : null;
    const tapeRef = tapeKey === null ? undefined : own(context.vars, tapeKey);
    const tape = op.actionKind === 'replay'
      ? (tapeRef === undefined ? context.tape : context.resolveEntity(tapeRef)) : undefined;
    if (op.actionKind === 'replay' && !tape?.actionType) continue;
    const action = { type: tape?.actionType ?? op.actionKind };
    if (action.type === 'skill') {
      const ref = tape?.skillId ?? op.skillId;
      const skillId = typeof ref === 'string' && ref.startsWith('vars.') ? own(context.vars, ref.slice(5)) : ref;
      if (typeof skillId !== 'string' || !skillId) continue;
      action.skillId = skillId;
    }
    const point = op.target ? select(op.target)[0] : tape?.targetSpec ?? context.target ?? actor;
    if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) continue;
    Object.assign(action, { x: point.x, y: point.y });
    const overrides = tape ? { free: true, ignoreSlots: true, ...op.overrides } : { ...op.overrides };
    if (overrides.scale !== undefined) {
      overrides.scale = evaluateExpr(overrides.scale, context);
      if (!Number.isFinite(overrides.scale)) continue;
    }
    if (overrides.origin !== undefined) {
      const origin = resolvePoint(overrides.origin, context);
      if (!Number.isSafeInteger(origin?.x) || !Number.isSafeInteger(origin?.y)) continue;
      overrides.origin = { x: origin.x, y: origin.y,
        ...(Number.isFinite(origin.z) ? { z: origin.z } : Number.isFinite(origin.altitude) ? { altitude: origin.altitude } : {}) };
    }
    queueVMAction(state, { actorId: actor.id, action, overrides });
  }
}

export function continueAction({ state, frame, host }) {
  const actor = own(state.units, frame.ownerId);
  const { action, overrides, record } = frame.data;
  if (!actor || actor.hp <= 0 || actor.fled) { state.vm.stack.pop(); return; }
  if (frame.pc === 0) {
    let plan = host.planAction(state, actor, action, overrides);
    if (!plan?.ok && plan?.originSensitive) {
      const provisional = host.planAction(state, actor, action, { ...overrides, deferGeometry: true });
      if (provisional?.ok) plan = { ...provisional, provisional: true };
    }
    if (!plan?.ok) {
      if (record && !host.rejectAction?.(state, actor, action, plan?.error)) throw new Error(plan?.error ?? '无法执行动作');
      state.vm.stack.pop();
      return;
    }
    frame.plan = plan;
    frame.originalOrigin = overrides.origin ?? { x: actor.x, y: actor.y, ...(actor.altitude ? { altitude: actor.altitude } : {}) };
    frame.eventRef = newEvent(state, { actorId: actor.id, actionType: action.type, skillId: action.skillId ?? null,
      targetId: plan.targetIds[0] ?? null, center: plan.center, origin: frame.originalOrigin, ignoreLOS: overrides.ignoreLOS === true,
      mpCost: plan.mp ?? 0, spCost: plan.sp ?? 0, hpCost: plan.hp ?? 0, power: plan.power ?? 0, initiativeBonus: plan.initiativeBonus ?? 0, hostile: plan.hostile ?? false,
      weaponTemplateId: plan.weaponTemplateId ?? null });
    frame.pc++;
    scheduleHooks(state, frame, 'before_action', frame.eventRef, host);
    return;
  }
  const event = state.vm.events[frame.eventRef];
  let { plan } = frame;
  if (frame.pc === 1) {
    frame.pc++;
    if (event.cancel) {
      if (event.consumeCostOnCancel) host.payAction(state, actor, plan, event, overrides);
      state.vm.stack.pop();
      return;
    }
    const originalOrigin = frame.originalOrigin ?? overrides.origin ?? actor;
    if (plan.provisional || event.origin.x !== originalOrigin.x || event.origin.y !== originalOrigin.y
        || event.origin.z !== originalOrigin.z || event.origin.altitude !== originalOrigin.altitude
        || (event.ignoreLOS === true) !== (overrides.ignoreLOS === true)) {
      const replanned = host.planAction(state, actor, action, { ...overrides, origin: event.origin, ignoreLOS: event.ignoreLOS });
      if (!replanned?.ok) {
        if (record && !host.rejectAction?.(state, actor, action, replanned?.error)) throw new Error(replanned?.error ?? '无法执行动作');
        state.vm.stack.pop();
        return;
      }
      frame.plan = plan = replanned;
    }
    host.payAction(state, actor, plan, event, overrides);
    Object.assign(event, { targetId: plan.targetIds[0] ?? null, center: plan.center,
      targets: plan.targetIds, isSingle: plan.isSingle, isArea: !plan.isSingle,
      isRanged: plan.isRanged, damageType: plan.damageType ?? null });
    scheduleHooks(state, frame, 'before_target', frame.eventRef, host);
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    if (event.cancel) { state.vm.stack.pop(); return; }
    if (event.redirectTarget) event.targets = [event.redirectTarget];
    if (event.replaceTarget) event.targets = event.targets.map(id => id === event.replaceTarget.from ? event.replaceTarget.to : id);
    event.targets = [...new Set(event.targets)].filter(id => own(state.units, id));
    event.targetId = event.targets[0] ?? null;
    host.runAction({ state, frame, actor, plan, event, overrides });
    return;
  }
  if (frame.pc === 3) {
    frame.pc++;
    scheduleHooks(state, frame, 'after_action', frame.eventRef, host);
    return;
  }
  if (record && ['skill', 'attack', 'move'].includes(action.type)) {
    state.tape ??= [];
    state.tape.push({ seq: (state.tape.at(-1)?.seq ?? 0) + 1, round: state.round, turn: state.turn,
      actorId: actor.id, team: actor.team, actionType: action.type, skillId: action.skillId ?? null,
      targetSpec: { ...event.center, targetId: event.targetId, answers: frame.answers },
      origin: { x: event.origin.x, y: event.origin.y } });
  }
  state.vm.stack.pop();
}
