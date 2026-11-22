import { getPool, linkPools, swapPoolCurrents, unlinkPools, updatePoolCurrent } from './vm-pools.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { evaluateExpr } from './formula.js';

const alive = unit => unit?.hp > 0 && !unit.fled;
const entry = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

export function scheduleCommit(state, parent, data) {
  return pushFrame(state, { native: 'commit', ownerId: parent.ownerId, sourceId: parent.sourceId,
    ruleId: parent.ruleId, callerId: parent.localsRef ?? parent.frameId, data });
}

function commitOp(env) {
  const { state, frame, op, context, select } = env;
  const targets = select(op.target).filter(unit => entry(state.units, unit.id) === unit);
  const sourceId = context.self?.id ?? frame.sourceId;
  for (const target of targets.reverse()) {
    const pools = op.op === 'resource' ? [op.pool].flat() : ['hp'];
    for (const pool of pools.reverse()) {
      const amount = op.amount === undefined ? 0 : evaluateExpr(op.amount, { ...context, target, pool });
      const minRemain = op.minRemain === undefined ? 0 : evaluateExpr(op.minRemain, { ...context, target, pool });
      if (!Number.isFinite(amount) || !Number.isFinite(minRemain)) continue;
      const action = context.event;
      const label = context.status?.name ?? entry(state.skills, action?.skillId)?.name;
      scheduleCommit(state, frame, { ...op, sourceId, targetId: target.id, pool, amount, minRemain,
        ...(label && { label }), actionType: action?.actionType ?? null, skillId: action?.skillId ?? null,
        ...(frame.carrier?.type === 'item' ? { carrierId: frame.carrier.id } : {}) });
    }
  }
}

export const commitOps = {
  damage: commitOp, heal: commitOp, resource: commitOp,
  link_pool({ state, context, select, op, host }) {
    const ids = select(op.units).filter(unit => entry(state.units, unit.id) === unit).map(unit => unit.id);
    if (ids.length < (op.mode === 'link' ? 2 : 1)) return;
    (op.mode === 'link' ? linkPools : unlinkPools)(state, ids, op.pools);
    host.log(state, context.self, 'pool_link', `${context.self.name}${op.mode === 'link' ? '连接' : '拆分'}了资源池`);
  },
};

export function continueCommit({ state, frame, host }) {
  const { data } = frame;
  const { op, pool: key } = data;
  const target = entry(state.units, data.targetId), source = entry(state.units, data.sourceId);
  const localOwner = data.local && frame.data.carrierId;
  const pool = getPool(state, localOwner || data.targetId, key, localOwner ? 'item' : 'unit');
  if (!pool || !target) { state.vm.stack.pop(); return; }
  let event = entry(state.vm.events, frame.eventRef);
  if (frame.pc === 0) {
    const dying = state.vm.stack.some(parent => parent.native === 'lethal' && parent.data.poolId === target.pools?.hp);
    if (!alive(target) && !(op === 'resource' && dying && !target.fled)) { state.vm.stack.pop(); return; }
    const amount = op === 'damage' ? host.prepareDamage?.(state, source, target, data) ?? data.amount
      : op === 'heal' ? host.prepareHeal?.(state, source, target, data) ?? data.amount : data.amount;
    frame.eventRef = newEvent(state, { commitKind: op, actorId: data.sourceId, targetId: target.id, pool: key,
      poolId: pool.id, damageType: data.damageType ?? null, rawAmount: data.amount, finalAmount: amount,
      sourceRuleId: frame.ruleId, direct: data.direct ?? true, preserveLife: data.lethal === false || Boolean(target.nonLethal || host.flag?.(state, target, 'preserveLife') || host.preserveLife?.(state, source)),
      actionType: data.actionType ?? null, skillId: data.skillId ?? null, weaponTemplateId: data.weaponTemplateId ?? null,
      melee: data.melee ?? false, backstab: data.backstab ?? false });
    frame.pc++;
    scheduleHooks(state, frame, 'before_commit', frame.eventRef, host);
    return;
  }
  if (frame.pc === 1) {
    frame.pc++;
    if (event.cancel || !Number.isFinite(event.finalAmount)) { state.vm.stack.pop(); return; }
    const before = pool.current;
    let absorbed = 0;
    if (op === 'damage') {
      let pending = Math.max(0, Math.floor(event.finalAmount));
      for (const statusKey of Object.keys(target.statuses ?? {}).sort()) {
        const status = target.statuses[statusKey];
        const shield = status.category === 'shield' ? status.vars?.shieldAmount : 0;
        if (!(shield > 0) || !pending) continue;
        const amount = Math.min(shield, pending);
        pending -= amount;
        absorbed += amount;
        status.vars.shieldAmount -= amount;
        host.log(state, target, 'shield', `${target.name}的${status.name}吸收${amount}点伤害`, { targetId: target.id, statusId: status.id ?? status.templateId ?? null });
        if (!status.vars.shieldAmount) delete target.statuses[statusKey];
      }
      updatePoolCurrent(state, pool.id, 'sub', pending, { minRemain: event.preserveLife ? 1 : 0 });
      event.dealt = before - getPool(state, target.id, key).current;
      event.absorbed = absorbed;
      host.log(state, source, 'damage', `${target.name}受到${event.dealt}点${data.label ?? ''}伤害`, { ...data.details, targetId: target.id, damageType: event.damageType, amount: event.dealt, absorbed, hpBefore: before, hpAfter: target.hp });
    } else if (op === 'heal') {
      updatePoolCurrent(state, pool.id, 'add', Math.max(0, Math.floor(event.finalAmount)));
      event.healing = target.hp - before;
      host.log(state, source, 'heal', `${target.name}${data.label ? `因${data.label}` : ''}恢复${event.healing}点生命`, { ...data.details, targetId: target.id, amount: event.healing, hpBefore: before, hpAfter: target.hp });
    } else {
      if (data.mode === 'swap') {
        const other = getPool(state, localOwner || target.id, data.otherPool, localOwner ? 'item' : 'unit');
        if (other) swapPoolCurrents(state, pool.id, other.id);
      } else {
        const amount = data.mode === 'sub' ? Math.max(0, event.finalAmount) : event.finalAmount;
        const changed = updatePoolCurrent(state, pool.id, data.mode, amount, { minRemain: Math.max(0, data.minRemain), requireFull: data.requireFull });
        if (!changed.applied) {
          const caller = state.vm.stack.find(parent => parent.frameId === frame.callerId);
          if (caller) caller.pc = caller.program.length;
          state.vm.stack.pop();
          return;
        }
      }
      const after = entry(state.pools, pool.id).current;
      event.change = after - before;
      host.log(state, source, 'resource', `${target.name}${data.label ? `因${data.label}` : ''}${after >= before ? '恢复' : '消耗'}${Math.abs(after - before)}点 ${key.toUpperCase()}`, { targetId: target.id, resource: key, before, after });
    }
    const result = entry(state.vm.events, data.resultEventRef);
    if (result) for (const key of ['dealt', 'absorbed', 'healing']) if (event[key] !== undefined) result[key] = event[key];
    if (data.out) {
      const caller = state.vm.stack.find(parent => parent.frameId === frame.callerId);
      if (caller) caller.vars[data.out] = event.dealt ?? event.healing ?? event.change;
    }
    const depletion = Object.values(state.pools).filter(candidate => candidate.kind === 'hp' && candidate.current === 0 &&
      (candidate.id === pool.id && before > 0 || op === 'resource' && data.mode === 'swap' && candidate.id === target.pools?.[data.otherPool]) &&
      !state.vm.stack.some(parent => parent.native === 'lethal' && parent.data.poolId === candidate.id));
    for (const depleted of depletion.reverse()) pushFrame(state, { native: 'lethal', ownerId: target.id, sourceId: data.sourceId,
      data: { poolId: depleted.id, damageType: event.damageType, targetId: target.id,
        overkill: Math.max(0, event.finalAmount - absorbed - before) } });
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    const hook = op === 'damage' ? 'after_damage' : op === 'heal' ? 'after_heal' : null;
    if (hook) scheduleHooks(state, frame, hook, frame.eventRef, host);
    return;
  }
  state.vm.stack.pop();
}

export function continueLethal({ state, frame, host }) {
  const { data } = frame;
  const pool = entry(state.pools, data.poolId);
  if (!pool) { state.vm.stack.pop(); return; }
  if (frame.pc === 0) {
    frame.eventRef = newEvent(state, { ...data, actorId: frame.sourceId, killer: frame.sourceId,
      units: pool.contributors.filter(c => c.ownerKind === 'unit').map(c => c.ownerId).sort() });
    frame.pc++;
    scheduleHooks(state, frame, 'on_lethal_p1', frame.eventRef, host);
    return;
  }
  if (frame.pc === 1) {
    frame.pc++;
    if (pool.current <= 0) scheduleHooks(state, frame, 'on_lethal_p2', frame.eventRef, host);
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    const event = state.vm.events[frame.eventRef];
    if (pool.current > 0) return;
    if (event.preventDeath) { updatePoolCurrent(state, pool.id, 'set', 1); return; }
    for (const unitId of event.units) {
      const unit = entry(state.units, unitId);
      if (!unit || unit.pools?.hp !== pool.id) continue;
      unit.diedAt = { round: state.round, turn: state.turn };
      unit.corpseOf ??= unit.id;
      host.log(state, entry(state.units, frame.sourceId), 'defeat', `${unit.name}倒下`, { targetId: unit.id });
    }
    scheduleHooks(state, frame, 'on_death', frame.eventRef, host);
    return;
  }
  state.vm.stack.pop();
}
