import { evaluateExpr, validExpr } from './formula.js';
import { rollDie } from './rng.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { validVmOpcode } from './vm-schema.js';
import { resolvePoint } from './vm-select.js';
import { deleteOwnedPools, getPool, updatePoolCurrent } from './vm-pools.js';
import { authorityContest, authorityFor, compareAuthority, authorityProse } from './vm-authority.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const bounded = (value, min, max) => Math.min(max, Math.max(min, Math.floor(value)));
const evaluate = (expression, context, fallback) => expression === undefined ? fallback : evaluateExpr(expression, context);
const live = unit => unit?.hp > 0 && !unit.fled;

function operation({ state, frame, op, context, select }, native, selector) {
  const targets = selector === undefined ? [context.target ?? context.self] : select(selector);
  for (const target of targets.reverse()) {
    if (!target || own(state.units, target.id) !== target) continue;
    pushFrame(state, { native, ownerId: frame.ownerId, sourceId: frame.sourceId, ruleId: frame.ruleId,
      carrier: frame.carrier ?? null, attribution: frame.attribution ?? null,
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
      const resolveId = id => {
        if (['self', 'source', 'target', 'attacker'].includes(id)) return context[id]?.id;
        if (id.startsWith('vars.')) {
          const value = own(context.vars, id.slice(5));
          return context.resolveEntity(value, 'unit')?.id ?? (typeof value === 'string' ? value : undefined);
        }
        return own(state.units, id)?.id ?? evaluateExpr(id, context);
      };
      let value;
      if (key === 'redirectTarget') value = resolveId(expression);
      else if (key === 'replaceTarget') value = { from: resolveId(expression.from), to: resolveId(expression.to) };
      else if (key === 'origin') {
        const point = resolvePoint(expression, context);
        if (point) value = { x: point.x, y: point.y, ...(Number.isFinite(point.z) && { z: point.z }) };
      } else if (typeof expression === 'object' || ['minRating', 'forceOutcome'].includes(key)) value = expression;
      else value = evaluateExpr(expression, context);
      if (value == null || (key === 'replaceTarget' && (!value.from || !value.to))) continue;
      event[key] = value;
      if (frame.hook === 'before_status' && key === 'cancel') {
        if (!value) { delete event.immunityCarrier; delete event.immunityOwnerId; }
        else {
          const carrier = frame.carrier ?? { type: 'unit', id: frame.ownerId };
          if (!event.immunityCarrier || compareAuthority(authorityFor(state, carrier, frame.ownerId),
            authorityFor(state, event.immunityCarrier, event.immunityOwnerId)) > 0) {
            event.immunityCarrier = carrier;
            event.immunityOwnerId = frame.ownerId;
          }
        }
      }
      if (key === 'redirectTarget') host.log(state, context.self, 'redirect', `${context.self.name}重定向了目标`, { targetId: value });
      else if (key === 'cancel' && value) host.log(state, context.self, 'intercept', `${context.self.name}拦截了本次结算`, { targetId: event.targetId });
    }
  },
};

export function continueCheck({ state, frame, host, context }) {
  const { data: op } = frame;
  if (frame.pc === 0) {
    const dc = evaluate(op.dc, context, op.kind === 'chance' ? undefined : 10);
    if (op.kind === 'chance' && !Number.isFinite(dc)) host.log(state, context.self, 'warning', '概率判定缺少有效 dc，忽略该检定');
    if (!Number.isFinite(dc)) { state.vm.stack.pop(); return; }
    frame.eventRef = newEvent(state, { checkKind: op.kind, actorId: context.self.id, targetId: context.target.id,
      dc, baseDC: dc, stat: op.stat ?? null, statusId: op.statusId ?? null, tags: op.tags ?? [] });
    frame.pc++;
    scheduleHooks(state, frame, 'before_check', frame.eventRef, host);
    return;
  }
  const event = state.vm.events[frame.eventRef];
  if (frame.pc === 1) {
    const stats = [op.stat ?? null].flat();
    const outcomes = frame.naturalOutcomes ??= [];
    if (frame.pendingNatural) {
      const replacement = event.replaceNaturalRoll;
      outcomes.push({ ...frame.pendingNatural, roll: Number.isFinite(replacement) ? bounded(replacement, 1, 20) : event.naturalRoll });
      delete frame.pendingNatural;
      delete event.replaceNaturalRoll;
    }
    if (outcomes.length === stats.length) { frame.pc++; return; }
    const key = stats[outcomes.length];
    const sides = op.kind === 'chance' ? 100 : 20;
    const rollWith = delta => {
      const first = dice(state, sides);
      return delta > 0 ? Math.max(first, dice(state, sides)) : delta < 0 ? Math.min(first, dice(state, sides)) : first;
    };
    const subject = op.kind === 'save' ? context.target : context.self;
    const roll = rollWith((event.advantageDelta ?? 0) + (sides === 20 ? host.advantage?.(state, subject, event) ?? 0 : 0));
    const defenderRoll = op.kind === 'contest' ? rollWith(host.advantage?.(state, context.target, event) ?? 0) : null;
    event.naturalRoll = roll;
    if (op.rawNatural || sides !== 20) outcomes.push({ key, roll, defenderRoll });
    else {
      frame.pendingNatural = { key, defenderRoll };
      scheduleHooks(state, frame, 'after_natural_roll', frame.eventRef, host);
    }
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    const kind = op.kind;
    const subject = kind === 'save' ? context.target : context.self;
    const stat = (unit, key) => host.stat?.(state, unit, key) ?? unit.stats?.[key] ?? 0;
    const stats = [op.stat ?? null].flat();
    const checkBonus = host.checkBonus?.(state, subject, event) ?? 0;
    const dc = event.dc + (event.dcDelta ?? 0) + (host.dcBonus?.(state, context.self, event) ?? 0);
    const outcomes = frame.naturalOutcomes.map(({ key, roll, defenderRoll }) => {
      const total = roll + (key ? stat(subject, key) : 0) + checkBonus + (event.bonusDelta ?? 0);
      const difficulty = kind === 'contest' ? defenderRoll + stat(context.target, op.defenderStat ?? key)
        + (host.checkBonus?.(state, context.target, event) ?? 0) + (host.resistBonus?.(state, context.target, event) ?? 0)
        - (host.dcBonus?.(state, context.self, event) ?? 0) : dc;
      const passed = kind === 'chance' ? roll <= difficulty : total >= difficulty;
      return { roll, total, difficulty, passed };
    });
    const { roll, total } = outcomes[0];
    const passed = ['pass', 'hit', 'crit'].includes(event.forceOutcome) ? true : ['fail', 'miss'].includes(event.forceOutcome) ? false
      : op.mode === 'any' ? outcomes.some(outcome => outcome.passed) : outcomes.every(outcome => outcome.passed);
    Object.assign(event, { roll, total, dc, finalDC: dc, passed, rating: event.forceOutcome === 'crit' ? 'crit' : event.minRating ?? (passed ? 'hit' : 'miss') });
    const verdict = passed ? '成功' : '失败';
    const label = { save: '豁免', chance: '概率判定', d20: '检定', contest: '对抗检定', attack: '攻击检定' }[kind];
    const text = `${subject.name}${label}${verdict}（${outcomes.map(outcome => kind === 'chance'
      ? `d100 掷出 ${outcome.roll}，阈值 ${outcome.difficulty}`
      : `d20 掷出 ${outcome.roll}，合计 ${outcome.total} 对 ${outcome.difficulty}`).join('；')}）`;
    const targetId = context.target.id;
    if (kind === 'save') {
      const checks = outcomes.map((outcome, index) => ({
        saveStat: stats[index], saveRoll: outcome.roll, saveBonus: outcome.total - outcome.roll,
        saveTotal: outcome.total, saveDC: outcome.difficulty, saved: outcome.passed,
      }));
      const detail = checks.length > 1 ? { checks, mode: op.mode ?? 'all' } : checks[0];
      host.log(state, subject, 'save', text, { targetId, ...detail, saved: passed });
    } else {
      host.log(state, subject, 'vm_check', text, { targetId, kind, outcomes, success: passed });
    }
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
      scope: parent.scope ?? null, localsRef: frame.callerId,
      ...(parent.sourceSkillId && { sourceSkillId: parent.sourceSkillId }), program });
  }
}

export function continueApplyStatus({ state, frame, host, context, options }) {
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
    if (event.cancel && op.ignoreImmunity === true) {
      const attacker = authorityFor(state, frame.carrier, context.self?.id);
      const defenderRef = event.immunityCarrier ?? { type: 'unit', id: target.id };
      const defender = authorityFor(state, defenderRef, event.immunityOwnerId ?? target.id);
      const contest = authorityContest(state, { ...attacker, unitId: context.self?.id }, { ...defender, unitId: target.id }, {
        preview: options,
        checkBonus: (unit, side) => host.checkBonus?.(state, unit, { checkKind: 'authority', targetId: side === 'attacker' ? target.id : context.self?.id }) ?? 0,
      });
      event.authorityContest = contest;
      if (contest.conditional) { state.vm.stack.pop(); return; }
      host.log(state, context.self, 'authority', `${target.name}的状态免疫${contest.result > 0 ? '被穿透' : '生效'}${authorityProse(contest)}`, { targetId: target.id, contest });
      if (contest.result > 0) event.cancel = false;
    }
    if (event.cancel) {
      host.log(state, target, 'status_immune', `${target.name}免疫了${template.name}`, { targetId: target.id, statusId: op.statusId, ...(event.authorityContest ? { contest: event.authorityContest } : {}) });
      scheduleHooks(state, frame, 'on_status_immunized', frame.awaitEvent, host);
      return;
    }
    if (!live(target)) return;
    const previous = own(target.statuses, op.statusId);
    const stackMode = op.stackMode ?? template.stackMode ?? 'refresh';
    const values = { ...template.vars, ...op.vars };
    const vars = Object.fromEntries(Object.entries(values).map(([key, expr]) => [key, typeof expr === 'string' && !validExpr(expr) ? expr : evaluateExpr(expr, context)]).filter(([, value]) => value !== null));
    const cap = evaluate(template.maxStacks, context, 1);
    const duration = evaluate(op.turns, context, template.remainingTurns ?? 1);
    const count = evaluate(op.stacks, context, stackMode === 'extend' ? previous?.stacks ?? 1 : 1);
    const extension = evaluate(op.extendTurns, context, 1);
    if (![cap, duration, count, extension].every(Number.isFinite)) return;
    const maxStacks = bounded(cap, 1, 999999);
    const sourceCarrier = frame.carrier ?? null;
    const sourceAuthority = authorityFor(state, sourceCarrier, context.self?.id);
    const status = { ...structuredClone(template), id: op.statusId, templateId: op.statusId, ownerId: target.id,
      sourceId: context.self?.id ?? null, sourceCarrier, authorityRank: sourceAuthority.authorityRank, sourceTier: sourceAuthority.unitTier, ...(context.effectiveTier !== sourceAuthority.unitTier && { effectiveTier: context.effectiveTier }), vars, tags: template.tags ?? [], flags: template.flags ?? [], tier: template.tier ?? 1,
      mods: template.mods ?? [], rules: template.rules ?? [], stackMode, maxStacks, stacks: bounded(count, 1, maxStacks),
      durationType: template.durationType ?? 'battle_turns', remainingTurns: bounded(duration, 1, 100) };
    if (op.expireOn) status.expireOn = op.expireOn;
    if (previous && stackMode === 'stack') {
      status.stacks = bounded(previous.stacks + status.stacks, 1, maxStacks);
      if (status.category === 'shield') status.vars.shieldAmount += previous.vars?.shieldAmount ?? 0;
    }
    status.appliedRound = state.round;
    status.appliedTurn = state.turn;
    if (previous && stackMode === 'extend') status.remainingTurns = bounded(previous.remainingTurns + extension, 1, 100);
    target.statuses[op.statusId] = status;
    host.log(state, context.self, 'status', `${target.name}获得${status.name}（${status.stacks}层）`, host.statusLogDetail(target, status));
    scheduleHooks(state, frame, 'after_status_applied', frame.awaitEvent, host);
    return;
  }
  state.vm.stack.pop();
}

export function continueRemoveStatus({ state, frame, host, context, options }) {
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
  if (!status || status.durationType === 'persistent'
    || evaluateExpr(op.where, { ...context, status }) !== true) return;
  let authorityContestDetail;
  if (status.flags?.includes('undispellable')) {
    if (op.force !== true) return;
    const attacker = authorityFor(state, frame.carrier, context.self?.id);
    const defender = Number.isFinite(status.authorityRank) && Number.isFinite(status.sourceTier)
      ? { authorityRank: status.authorityRank, unitTier: status.sourceTier }
      : authorityFor(state, status.sourceCarrier ?? { type: 'unit', id: status.sourceId ?? target.id }, status.sourceId ?? target.id);
    authorityContestDetail = authorityContest(state, { ...attacker, unitId: context.self?.id }, { ...defender, unitId: target.id }, {
      preview: options,
      checkBonus: (unit, side) => host.checkBonus?.(state, unit, { checkKind: 'authority', targetId: side === 'attacker' ? target.id : context.self?.id }) ?? 0,
    });
    if (authorityContestDetail.conditional) return;
    host.log(state, context.self, 'authority', `${status.name}${authorityContestDetail.result > 0 ? '被强制移除' : '抵抗了强制移除'}${authorityProse(authorityContestDetail)}`, { targetId: target.id, contest: authorityContestDetail });
    if (authorityContestDetail.result <= 0) return;
  }
  delete target.statuses[statusId];
  deleteOwnedPools(state, status);
  frame.removed = (frame.removed ?? 0) + 1;
  const reason = op.reason ?? 'dispelled';
  frame.eventRef = newEvent(state, { actorId: context.self?.id ?? null, targetId: target.id, statusId, removeReason: reason, reason, removedStatus: structuredClone(status) });
  host.log(state, context.self, reason === 'expired' ? 'expire' : 'cleanse', `${target.name}失去${status.name}`, {
    targetId: target.id, statusId, ...(authorityContestDetail ? { contest: authorityContestDetail } : {}) });
  scheduleHooks(state, frame, 'after_status_removed', frame.eventRef, host);
}
