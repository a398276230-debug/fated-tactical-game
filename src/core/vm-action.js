import { evaluateExpr } from './formula.js';
import { actionSkill, isTapeAction, isStrikeAction, continueNativeAction } from './combat.js';
import { emitSpatialImpulse, makeActionImpulse } from './combat-actions.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { resolvePoint } from './vm-select.js';
import { aggregateModifiers } from './vm-carriers.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const MAX_ACTION_CHAIN_DEPTH = 3;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const aggregateIntentLock = (state, unitId) => aggregateModifiers(state, unitId).controlPolicy.intentLock;

export function queueVMAction(state, { actorId, action, overrides = {}, record = false, chainDepth = 0 }) {
  return pushFrame(state, { native: 'action', ownerId: actorId, sourceId: actorId, chainDepth,
    data: { action, overrides, record }, answers: [] });
}

export function perform({ state, context, select, op }) {
  const chainDepth = (state.vm.stack.findLast(frame => frame.native === 'action')?.chainDepth ?? 0) + 1;
  if (chainDepth > MAX_ACTION_CHAIN_DEPTH) {
    context.warn?.(`perform 嵌套超过 ${MAX_ACTION_CHAIN_DEPTH} 层，已截断`);
    return;
  }
  const actors = select(op.actor);
  for (const actor of actors.reverse()) {
    if (actor.hp <= 0 || actor.fled) continue;
    const tapeKey = typeof op.tapeRecord === 'string' ? op.tapeRecord.replace(/^vars\./, '') : null;
    const tapeRef = tapeKey === null ? undefined : own(context.vars, tapeKey);
    const tape = op.actionKind === 'replay'
      ? (tapeRef === undefined ? context.tape : context.resolveEntity(tapeRef)) : undefined;
    if (op.actionKind === 'replay' && !isTapeAction(tape?.actionType)) continue;
    const action = { type: tape?.actionType ?? op.actionKind, ...tape?.parameters };
    if (action.type === 'skill') {
      const ref = tape?.skillId ?? op.skillId;
      const skillId = typeof ref === 'string' && ref.startsWith('vars.') ? own(context.vars, ref.slice(5)) : ref;
      if (typeof skillId !== 'string' || !skillId) continue;
      action.skillId = skillId;
    }
    if (!tape || op.target || tape.aimed !== false) {
      const point = op.target ? select(op.target)[0] : tape?.targetSpec ?? context.target ?? actor;
      if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) continue;
      const targetId = op.target ? point.id : tape?.targetSpec?.targetId ?? point.id;
      Object.assign(action, { x: point.x, y: point.y });
      if (targetId && ['attack', 'skill', 'suppress', 'free_ally'].includes(action.type)) action.targetId = targetId;
    }
    const overrides = tape ? { free: true, ignoreSlots: true, ...op.overrides,
      ...(tape.interactiveId && { interactiveId: tape.interactiveId }) } : { ...op.overrides };
    if (['attack', 'skill', 'shield_bash'].includes(action.type) && overrides.intent !== undefined) {
      action.intent = overrides.intent;
    }
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
    queueVMAction(state, { actorId: actor.id, action, overrides, chainDepth });
  }
}

export function continueAction({ state, frame, host, options }) {
  const actor = own(state.units, frame.ownerId);
  const { action, overrides, record } = frame.data;
  if (!actor || (frame.pc < 3 && (actor.hp <= 0 || actor.fled))) { state.vm.stack.pop(); return; }
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
    const strike = isStrikeAction(action, plan);
    const hostileStrike = strike && plan.hostile === true;
    frame.initialIntentLock = aggregateIntentLock(state, actor.id);
    const lifecycle = action.type === 'skill' ? actionSkill(state, actor, action.skillId) : null;
    if (plan.kind === 'barrel') frame.ammoBefore = plan.ammo ?? null;
    frame.eventRef = newEvent(state, { ...plan.actionContext,
      actorId: actor.id, actionType: action.type, skillId: action.skillId ?? null,
      ...(lifecycle?.bindToSource === true && { bindToSource: true }),
      ...(lifecycle?.concentration === true && { concentration: true }),
      targetId: plan.targetIds[0] ?? plan.targetId ?? plan.actionContext?.targetId ?? null, center: plan.center,
      origin: frame.originalOrigin, ignoreLOS: overrides.ignoreLOS === true,
      ...(hostileStrike ? { intent: plan.intent ?? 'normal' } : {}),
      power: plan.power ?? 0, initiativeBonus: plan.initiativeBonus ?? 0, hostile: plan.hostile ?? false,
      instanceId: plan.instanceId ?? null, chainDepth: frame.chainDepth ?? 0, triggered: (frame.chainDepth ?? 0) > 0 });
    frame.pc++;
    scheduleHooks(state, frame, 'before_action', frame.eventRef, host);
    return;
  }
  const event = state.vm.events[frame.eventRef];
  let { plan } = frame;
  if (frame.pc === 1) {
    frame.pc++;
    if (event.cancel) {
      if (frame.chainDepth === 0) options?.onCancel?.(event);
      if (event.consumeCostOnCancel) host.payAction(state, actor, plan, event, overrides);
      state.vm.stack.pop();
      return;
    }
    if (!isStrikeAction(action, plan)) { frame.pc = 5; return; }
    const originalOrigin = frame.originalOrigin ?? overrides.origin ?? actor;
    const intentLock = aggregateIntentLock(state, actor.id);
    if (plan.provisional || event.origin.x !== originalOrigin.x || event.origin.y !== originalOrigin.y
        || event.origin.z !== originalOrigin.z || event.origin.altitude !== originalOrigin.altitude
        || (event.ignoreLOS === true) !== (overrides.ignoreLOS === true)
        || intentLock !== frame.initialIntentLock) {
      const replanned = host.planAction(state, actor, action, { ...overrides, origin: event.origin, ignoreLOS: event.ignoreLOS });
      if (!replanned?.ok) {
        if (record && !host.rejectAction?.(state, actor, action, replanned?.error)) throw new Error(replanned?.error ?? '无法执行动作');
        state.vm.stack.pop();
        return;
      }
      frame.plan = plan = replanned;
      Object.assign(event, plan.actionContext);
      frame.initialIntentLock = intentLock;
    }
    if (isStrikeAction(action, plan) && plan.hostile === true) event.intent = plan.intent ?? 'normal';
    host.payAction(state, actor, plan, event, overrides);
    frame.beforeTargetPosition = { x: actor.x, y: actor.y };
    const primary = own(state.units, plan.targetIds[0]);
    const [facingX, facingY] = primary?.facing ?? [1, 0];
    Object.assign(event, { targetId: plan.targetIds[0] ?? null, center: plan.center,
      targets: plan.targetIds, isSingle: plan.isSingle, isArea: !plan.isSingle,
      isRanged: plan.isRanged, damageType: plan.damageType ?? null,
      backX: primary ? clamp(primary.x - facingX, 0, state.grid[0].length - 1) : null,
      backY: primary ? clamp(primary.y - facingY, 0, state.grid.length - 1) : null });
    scheduleHooks(state, frame, 'before_target', frame.eventRef, host);
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    if (event.cancel) {
      if (frame.chainDepth === 0) options?.onCancel?.(event);
      state.vm.stack.pop();
      return;
    }
    if (event.redirectTarget) event.targets = [event.redirectTarget];
    if (event.replaceTarget) event.targets = event.targets.map(id => id === event.replaceTarget.from ? event.replaceTarget.to : id);
    event.targets = [...new Set(event.targets)].filter(id => own(state.units, id));
    event.targetId = event.targets[0] ?? null;
    host.runAction({ state, frame, actor, plan, event, overrides });
    return;
  }
  if (frame.pc === 3) {
    if (!frame.impulseEmitted) {
      const impulse = makeActionImpulse(state, actor, action, plan, event.origin, frame.impulseDirectTargets ?? []);
      if (impulse) {
        frame.impulseEmitted = true;
        emitSpatialImpulse(state, host, frame, impulse);
        return;
      }
    }
    frame.pc++;
    if (actor.hp > 0) scheduleHooks(state, frame, 'after_action', frame.eventRef, host);
    return;
  }
  if (frame.pc === 5) {
    if (continueNativeAction({ state, frame, actor, plan, event, overrides, host, options })) frame.pc = 3;
    return;
  }
  if (record && isTapeAction(action.type)) {
    const parameters = Object.fromEntries(['itemId', 'maneuver', 'intent', 'nonLethal', 'bonusDice']
      .filter(key => Object.hasOwn(action, key)).map(key => [key, action[key]]));
    state.tape ??= [];
    state.tape.push({ seq: (state.tape.at(-1)?.seq ?? 0) + 1, round: state.round, turn: state.turn,
      actorId: actor.id, team: actor.team, actionType: action.type, skillId: action.skillId ?? null,
      targetSpec: { ...event.center, targetId: isStrikeAction(action, plan) ? event.targetId : plan.targetIds[0] ?? plan.targetId ?? null, answers: frame.answers },
      origin: { x: event.origin.x, y: event.origin.y },
      ...(action.x === undefined && !isStrikeAction(action, plan) && { aimed: false }),
      ...(plan.interactiveId && { interactiveId: plan.interactiveId }),
      ...(Object.keys(parameters).length && { parameters }) });
  }
  state.vm.stack.pop();
}
