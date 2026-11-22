import { evaluateExpr } from './formula.js';
import { rollDie } from './rng.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { validVmOpcode } from './vm-schema.js';
import { getPool, updatePoolCurrent } from './vm-pools.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const bounded = (value, min, max) => Math.min(max, Math.max(min, Math.floor(value)));
const evaluate = (expression, context, fallback) => expression === undefined ? fallback : evaluateExpr(expression, context);
const live = unit => unit?.hp > 0 && !unit.fled;

function operation({ state, frame, op, context, select }, native, selector) {
  const targets = selector === undefined ? [context.target ?? context.self] : select(selector);
  for (const target of targets.reverse()) {
    if (!target || own(state.units, target.id) !== target) continue;
    pushFrame(state, { native, ownerId: frame.ownerId, sourceId: frame.sourceId, ruleId: frame.ruleId,
      scope: { ...frame.scope, target: { type: 'unit', id: target.id } },
      eventRef: frame.eventRef, localsRef: frame.localsRef ?? frame.frameId,
      callerId: frame.localsRef ?? frame.frameId, branchFrameId: frame.frameId, data: op });
  }
}

function output(state, frame, key, value) {
  if (key === undefined) return;
  const caller = state.vm.stack.find(entry => entry.frameId === frame.callerId);
  if (caller) caller.vars[key] = value;
}

function dice(state, sides) {
  const result = rollDie(state.rng, sides);
  state.rng = result.rng;
  return result.value;
}

export const ruleOps = {
  check(env) { operation(env, 'check'); },
  apply_status(env) { operation(env, 'apply_status', env.op.target); },
  remove_status(env) { operation(env, 'remove_status', env.op.target); },
  revive({ state, op, select, context, host }) {
    for (const target of select(op.target)) {
      const hp = getPool(state, target.id, 'hp');
      if (!hp || live(target) || target.fled || target.corpseConsumed || host.flag?.(state, target, 'blockRevive')) continue;
      if (hp.contributors.length !== 1) continue;
      const values = ['hp', 'mp', 'sp'].map(key => {
        const pool = getPool(state, target.id, key);
        const fraction = evaluate(op[`${key}Percent`], { ...context, target }, key === 'hp' ? 1 : 0);
        const flat = key === 'hp' && op.hpFlat !== undefined ? evaluateExpr(op.hpFlat, { ...context, target }) : fraction * pool.max;
        return { pool, flat };
      });
      if (values.some(({ flat }) => !Number.isFinite(flat))) continue;
      for (const { pool, flat } of values) updatePoolCurrent(state, pool.id, 'set', bounded(flat, pool.kind === 'hp' ? 1 : 0, pool.max));
      delete target.diedAt;
      if (!state.order.includes(target.id)) state.order.push(target.id);
      host.log(state, context.self, 'revive', `${target.name}复活，恢复至${target.hp}点生命`, { targetId: target.id });
    }
  },
  mutate_event({ state, frame, op, context, host }) {
    const event = own(state.vm.events, frame.eventRef);
    if (!event || !frame.hook || !validVmOpcode(op, { hook: frame.hook })) throw new Error('事件改写不符合当前拦截钩子');
    for (const [key, expression] of Object.entries(op.patch)) {
      const resolveId = id => id.startsWith('vars.') ? own(context.vars, id.slice(5)) : id;
      let value;
      if (key === 'redirectTarget') value = resolveId(expression);
      else if (key === 'replaceTarget') value = { from: resolveId(expression.from), to: resolveId(expression.to) };
      else if (typeof expression === 'object' || ['minRating', 'forceOutcome'].includes(key)) value = expression;
      else value = evaluateExpr(expression, context);
      if (value == null || (key === 'replaceTarget' && (!value.from || !value.to))) continue;
      event[key] = value;
      if (key === 'redirectTarget') host.log(state, context.self, 'redirect', `${context.self.name}重定向了目标`, { targetId: value });
      else if (key === 'cancel' && value) host.log(state, context.self, 'intercept', `${context.self.name}拦截了本次结算`, { targetId: event.targetId });
    }
  },
};

export function continueCheck({ state, frame, host, context }) {
  const { data: op } = frame;
  if (frame.pc === 0) {
    const dc = evaluate(op.dc, context, op.kind === 'chance' ? 0 : 10);
    if (!Number.isFinite(dc)) { state.vm.stack.pop(); return; }
    frame.eventRef = newEvent(state, { checkKind: op.kind, actorId: context.self.id, targetId: context.target.id,
      dc, stat: op.stat ?? null, statusId: op.statusId ?? null, tags: op.tags ?? [] });
    frame.pc++;
    scheduleHooks(state, frame, 'before_check', frame.eventRef, host);
    return;
  }
  const event = state.vm.events[frame.eventRef];
  if (frame.pc === 1) {
    frame.pc++;
    const kind = op.kind;
    const subject = kind === 'save' ? context.target : context.self;
    const stat = (unit, key) => host.stat?.(state, unit, key) ?? unit.stats?.[key] ?? 0;
    const stats = [op.stat ?? null].flat();
    const checkBonus = host.checkBonus?.(state, subject, event) ?? 0;
    const dc = event.dc + (event.dcDelta ?? 0);
    const outcomes = stats.map(key => {
      let roll = dice(state, kind === 'chance' ? 100 : 20);
      if (event.advantageDelta > 0) roll = Math.max(roll, dice(state, 20));
      if (event.advantageDelta < 0) roll = Math.min(roll, dice(state, 20));
      const total = roll + (key ? stat(subject, key) : 0) + checkBonus + (event.bonusDelta ?? 0);
      const difficulty = kind === 'contest' ? dice(state, 20) + stat(context.target, op.defenderStat ?? key) : dc;
      const passed = kind === 'chance' ? roll <= difficulty : total >= difficulty;
      return { roll, total, difficulty, passed };
    });
    const { roll, total } = outcomes[0];
    const passed = ['pass', 'hit', 'crit'].includes(event.forceOutcome) ? true : ['fail', 'miss'].includes(event.forceOutcome) ? false
      : op.mode === 'any' ? outcomes.some(outcome => outcome.passed) : outcomes.every(outcome => outcome.passed);
    Object.assign(event, { roll, total, dc, passed, rating: event.forceOutcome === 'crit' ? 'crit' : event.minRating ?? (passed ? 'hit' : 'miss') });
    host.log(state, subject, kind === 'save' ? 'save' : kind === 'attack' ? 'attack_roll' : 'proc',
      `${subject.name}检定${passed ? '成功' : '失败'}（${outcomes.map(outcome => `${outcome.roll}点，合计${outcome.total}对${outcome.difficulty}`).join('；')}）`,
      { targetId: context.target.id, roll, total, dc, success: passed });
    scheduleHooks(state, frame, 'after_check', frame.eventRef, host);
    return;
  }
  output(state, frame, op.out, event.passed);
  const program = event.passed ? op.onPass : op.onFail;
  state.vm.stack.pop();
  if (program?.length) {
    const parent = state.vm.stack.find(entry => entry.frameId === frame.branchFrameId);
    pushFrame(state, { kind: parent.kind === 'loop' ? 'action' : parent.kind, hook: parent.hook ?? null, carrier: parent.carrier ?? null,
      ownerId: parent.ownerId, sourceId: parent.sourceId, ruleId: parent.ruleId, eventRef: parent.eventRef,
      scope: parent.scope ?? null, localsRef: frame.callerId, program });
  }
}

export function continueApplyStatus({ state, frame, host, context }) {
  const { data: op } = frame;
  const target = context.target;
  const template = host.statusTemplate?.(state, op.statusId);
  if (!target || !template) { state.vm.stack.pop(); return; }
  if (frame.pc === 0) {
    frame.awaitEvent = newEvent(state, { actorId: context.self?.id ?? null, targetId: target.id, statusId: op.statusId,
      tags: template.tags ?? [], category: template.category ?? 'special', tier: template.tier ?? 1 });
    frame.pc++;
    scheduleHooks(state, frame, 'before_status', frame.awaitEvent, host);
    return;
  }
  if (frame.pc === 1) {
    frame.pc++;
    const event = state.vm.events[frame.awaitEvent];
    if (event.cancel) {
      host.log(state, target, 'status_immune', `${target.name}免疫了${template.name}`, { targetId: target.id, statusId: op.statusId });
      scheduleHooks(state, frame, 'on_status_immunized', frame.awaitEvent, host);
      return;
    }
    if (!live(target)) return;
    const previous = own(target.statuses, op.statusId);
    const stackMode = op.stackMode ?? template.stackMode ?? 'refresh';
    const values = { ...template.vars, ...op.vars };
    const vars = Object.fromEntries(Object.entries(values).map(([key, expr]) => [key, evaluateExpr(expr, context)]).filter(([, value]) => value !== null));
    const maxStacks = template.maxStacks ?? 1;
    const duration = evaluate(op.turns, context, template.remainingTurns ?? 1);
    const count = evaluate(op.stacks, context, 1);
    const extension = evaluate(op.extendTurns, context, 1);
    if (![duration, count, extension].every(Number.isFinite)) return;
    const status = { ...structuredClone(template), id: op.statusId, templateId: op.statusId, ownerId: target.id,
      sourceId: context.self?.id ?? null, vars, tags: template.tags ?? [], tier: template.tier ?? 1,
      mods: template.mods ?? [], rules: template.rules ?? [], stackMode, stacks: bounded(count, 1, maxStacks),
      durationType: template.durationType ?? 'battle_turns', remainingTurns: bounded(duration, 1, 100) };
    if (op.expireOn) status.expireOn = op.expireOn;
    if (previous && stackMode === 'stack') status.stacks = bounded(previous.stacks + status.stacks, 1, maxStacks);
    if (previous && stackMode === 'extend') status.remainingTurns = bounded(previous.remainingTurns + extension, 1, 100);
    target.statuses[op.statusId] = status;
    host.log(state, context.self, status.category === 'shield' ? 'shield' : 'status', `${target.name}获得${status.name}（${status.stacks}层）`, { targetId: target.id, statusId: op.statusId });
    scheduleHooks(state, frame, 'after_status_applied', frame.awaitEvent, host);
    return;
  }
  state.vm.stack.pop();
}

export function continueRemoveStatus({ state, frame, host, context }) {
  const { data: op } = frame;
  const target = context.target;
  if (!target) { state.vm.stack.pop(); return; }
  frame.statusKeys ??= Object.keys(target.statuses).sort();
  if (frame.pc >= frame.statusKeys.length) {
    output(state, frame, op.outCount, frame.removed ?? 0);
    state.vm.stack.pop();
    return;
  }
  const statusId = frame.statusKeys[frame.pc++];
  const status = own(target.statuses, statusId);
  if (!status || status.durationType === 'persistent' || evaluateExpr(op.where, { ...context, status }) !== true) return;
  delete target.statuses[statusId];
  frame.removed = (frame.removed ?? 0) + 1;
  const reason = op.reason ?? 'dispelled';
  frame.eventRef = newEvent(state, { actorId: context.self?.id ?? null, targetId: target.id, statusId, removeReason: reason, reason });
  host.log(state, context.self, reason === 'expired' ? 'expire' : 'cleanse', `${target.name}失去${status.name}`, { targetId: target.id, statusId });
  scheduleHooks(state, frame, 'after_status_removed', frame.eventRef, host);
}
