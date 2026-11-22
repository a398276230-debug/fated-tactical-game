import { evaluateExpr } from './formula.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

export function queueVMAction(state, { actorId, action, overrides = {}, record = false }) {
  return pushFrame(state, { native: 'action', ownerId: actorId, sourceId: actorId,
    data: { action, overrides, record }, answers: [] });
}

export function perform({ state, frame, context, select, op }) {
  const actors = select(op.actor);
  for (const actor of actors.reverse()) {
    if (actor.hp <= 0 || actor.fled) continue;
    const ref = op.tapeRecord?.replace(/^vars\./, '');
    const tape = op.actionKind === 'replay' ? own(context.vars, ref) ?? context.tape : undefined;
    if (op.actionKind === 'replay' && !tape) continue;
    const action = { type: tape?.actionType ?? op.actionKind };
    const skillId = tape?.skillId ?? op.skillId;
    if (skillId) action.skillId = skillId;
    const target = op.target ? select(op.target)[0] : context.target;
    const point = tape?.targetSpec ?? target ?? actor;
    if (Number.isInteger(point.x) && Number.isInteger(point.y)) Object.assign(action, { x: point.x, y: point.y });
    const overrides = tape ? { free: true, ignoreSlots: true, ...op.overrides } : { ...op.overrides };
    if (overrides.scale !== undefined) {
      overrides.scale = evaluateExpr(overrides.scale, context);
      if (!Number.isFinite(overrides.scale)) continue;
    }
    if (typeof overrides.origin === 'string') {
      const point = context[overrides.origin] ?? own(context.vars, overrides.origin.replace(/^vars\./, ''));
      if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) continue;
      overrides.origin = { x: point.x, y: point.y };
    }
    queueVMAction(state, { actorId: actor.id, action, overrides });
  }
}

export function continueAction({ state, frame, host }) {
  const actor = own(state.units, frame.ownerId);
  const { action, overrides, record } = frame.data;
  if (!actor || actor.hp <= 0 || actor.fled) { state.vm.stack.pop(); return; }
  if (frame.pc === 0) {
    const plan = host.planAction(state, actor, action, overrides);
    if (!plan?.ok) {
      if (record && !host.rejectAction?.(state, actor, action, plan?.error)) throw new Error(plan?.error ?? '无法执行动作');
      state.vm.stack.pop();
      return;
    }
    frame.plan = plan;
    frame.eventRef = newEvent(state, { actorId: actor.id, actionType: action.type, skillId: action.skillId ?? null,
      targetId: plan.targetIds[0] ?? null, center: plan.center, origin: overrides.origin ?? { x: actor.x, y: actor.y },
      mpCost: plan.mp ?? 0, spCost: plan.sp ?? 0, hpCost: plan.hp ?? 0, power: plan.power ?? 0, hostile: plan.hostile ?? false,
      weaponTemplateId: plan.weaponTemplateId ?? null });
    frame.pc++;
    scheduleHooks(state, frame, 'before_action', frame.eventRef, host);
    return;
  }
  const event = state.vm.events[frame.eventRef];
  const { plan } = frame;
  if (frame.pc === 1) {
    frame.pc++;
    if (event.cancel) {
      if (event.consumeCostOnCancel) host.payAction(state, actor, plan, event, overrides);
      state.vm.stack.pop();
      return;
    }
    host.payAction(state, actor, plan, event, overrides);
    Object.assign(event, { targets: plan.targetIds, isSingle: plan.isSingle, isArea: !plan.isSingle,
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
      targetSpec: { ...event.center, targetId: event.targetId, answers: frame.answers }, origin: event.origin });
  }
  state.vm.stack.pop();
}
