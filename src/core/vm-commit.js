import { getPool, linkPools, swapPoolCurrents, unlinkPools, updatePoolCurrent, updatePoolMax } from './vm-pools.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { evaluateExpr } from './formula.js';
import { removeStatus } from './vm-rules.js';
import { authorityContest, authorityFor, authorityProse, protectionCarrier } from './vm-authority.js';
import { movementBudget } from './combat-actions.js';
import { cleanupSourceBoundEntities, hasActiveConcentration } from './vm-lifecycle.js';

const alive = unit => unit?.hp > 0 && !unit.fled;
const entry = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const pseudoPool = new Set(['attack', 'action', 'move', 'reaction']);
function pseudoState(state, unit, key) {
  if (key === 'move') { const b = movementBudget(state, unit); return { current: b.remainingCells, max: b.maxBoardSteps }; }
  if (key === 'reaction') return { current: unit.reactionAvailable === false ? 0 : 1, max: 1 };
  return { current: Math.max(0, 1 - (unit.used?.[key] ?? 0)), max: 1 };
}
function applyPseudo(state, unit, key, mode, amount) {
  if (!Number.isInteger(amount)) return false;
  const before = pseudoState(state, unit, key).current;
  let current = mode === 'set' ? amount : mode === 'add' ? before + amount : mode === 'sub' ? before - amount : NaN;
  if (mode === 'add_max' || mode === 'sub_max' || mode === 'set_max') return false;
  if (!Number.isFinite(current)) return false;
  current = Math.max(0, Math.min(pseudoState(state, unit, key).max, current));
  if (key === 'move') {
    const delta = (current - before) * 1000;
    if (delta < 0) unit.moveSpentPermille = (unit.moveSpentPermille ?? 0) - delta;
    else if (delta > 0) {
      const refund = Math.min(unit.moveSpentPermille ?? 0, delta);
      unit.moveSpentPermille = (unit.moveSpentPermille ?? 0) - refund;
      unit.moveBonusPermille = (unit.moveBonusPermille ?? 0) + delta - refund;
      if (!unit.moveSpentPermille) delete unit.moveSpentPermille;
      if (!unit.moveBonusPermille) delete unit.moveBonusPermille;
    }
  } else if (key === 'reaction') {
    unit.reactionAvailable = current > 0;
  } else {
    unit.used[key] = 1 - current;
    // `ap` is the aggregate remaining split-slot budget. Keep it in sync
    // with slot refunds/confiscations; movement is deliberately not AP.
    unit.ap = Math.max(0, Math.min(unit.apMax ?? 2, unit.ap + current - before));
  }
  return true;
}

export function scheduleCommit(state, parent, data) {
  return pushFrame(state, { native: 'commit', ownerId: parent.ownerId, sourceId: parent.sourceId,
    ruleId: parent.ruleId, carrier: parent.carrier ?? null, attribution: parent.attribution ?? null,
    callerId: parent.localsRef ?? parent.frameId, data });
}

function commitOp(env) {
  const { state, frame, op, context, select } = env;
  const targets = select(op.target).filter(unit => entry(state.units, unit.id) === unit);
  const sourceId = context.self?.id ?? frame.sourceId;
  const poolId = ref => ref?.startsWith('vars.') ? entry(context.vars, ref.slice(5)) : ref;
  const validPoolId = key => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key);
  const pools = op.op === 'resource' ? [op.pool].flat().map(poolId).reverse() : ['hp'];
  const otherPool = poolId(op.otherPool);
  if (op.mode === 'swap' && !validPoolId(otherPool)) return;
  for (const target of targets.reverse()) {
    for (const pool of pools) {
      if (!validPoolId(pool)) continue;
      const amount = op.amount === undefined ? 0 : evaluateExpr(op.amount, { ...context, target, pool });
      const minRemain = op.minRemain === undefined ? 0 : evaluateExpr(op.minRemain, { ...context, target, pool });
      if (!Number.isFinite(amount) || !Number.isFinite(minRemain)) continue;
      const action = context.event;
      const item = frame.carrier?.type === 'item' ? entry(state.items, frame.carrier.id) : null;
      const label = op.label ?? context.status?.name ?? context.zone?.name
        ?? (frame.carrier?.type === 'skill' ? entry(state.skills, frame.carrier.id)?.name : undefined)
        ?? entry(state.equipment, item?.templateId)?.name ?? entry(state.skills, action?.skillId)?.name;
      scheduleCommit(state, frame, { ...op, sourceId, targetId: target.id, pool, amount, minRemain,
        ...(op.mode === 'swap' && { otherPool }),
        ...(label && { label }), actionType: action?.actionType ?? null, skillId: action?.skillId ?? null,
        ...(sourceId === action?.actorId && typeof action?.intent === 'string' ? { intent: action.intent } : {}),
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

export function continueCommit({ state, frame, host, options }) {
  const { data } = frame;
  const { op, pool: key } = data;
  const target = entry(state.units, data.targetId), source = entry(state.units, data.sourceId);
  if (!target) { state.vm.stack.pop(); return; }
  const localOwner = data.local && frame.data.carrierId;
  const pseudo = !localOwner && pseudoPool.has(key);
  const pool = pseudo ? pseudoState(state, target, key) : getPool(state, localOwner || data.targetId, key, localOwner ? 'item' : 'unit');
  const other = op === 'resource' && data.mode === 'swap'
    ? getPool(state, localOwner || data.targetId, data.otherPool, localOwner ? 'item' : 'unit') : null;
  const otherBefore = other?.current ?? 0;
  if (!pool) { state.vm.stack.pop(); return; }
  let event = entry(state.vm.events, frame.eventRef);
  if (frame.pc === 0) {
    const dying = state.vm.stack.some(parent => parent.native === 'lethal' && parent.data.poolId === target.pools?.hp);
    if (!alive(target) && !((op === 'resource' || op === 'heal') && dying && !target.fled)) { state.vm.stack.pop(); return; }
    const amount = op === 'damage' ? host.prepareDamage?.(state, source, target, data) ?? data.amount
      : op === 'heal' ? host.prepareHeal?.(state, source, target, data) ?? data.amount : data.amount;
    const authority = authorityFor(state, frame.carrier, data.sourceId);
    frame.eventRef = newEvent(state, { commitKind: op, actorId: data.sourceId, targetId: target.id, pool: key,
      authorityRank: authority.authorityRank, sourceTier: authority.unitTier,
      ...(data.instantDeath === true && { instantDeath: true }), poolId: pool.id, damageType: data.damageType ?? null, rawAmount: data.amount, finalAmount: amount,
      ...(op === 'damage' && { shared: data.shared === true, sharedFromId: data.sharedFromId ?? null }),
      isSingle: data.isSingle ?? null, isArea: data.isArea ?? null, isRanged: data.isRanged ?? null,
      sourceRuleId: frame.ruleId, direct: data.direct ?? true, preserveLife: data.lethal === false || Boolean(target.nonLethal || host.flag?.(state, target, 'preserveLife') || host.preserveLife?.(state, source)),
      actionType: data.actionType ?? null, skillId: data.skillId ?? null, weaponTemplateId: data.weaponTemplateId ?? null,
      melee: data.melee ?? false, backstab: data.backstab ?? false,
      critical: data.critical ?? false, ratingMultiplier: data.ratingMultiplier ?? 1,
      ...(typeof data.intent === 'string' && { intent: data.intent }) });
    frame.pc++;
    scheduleHooks(state, frame, 'before_commit', frame.eventRef, host);
    return;
  }
  if (frame.pc === 1) {
    frame.pc++;
    if (event.cancel || !Number.isFinite(event.finalAmount)) { state.vm.stack.pop(); return; }
    const conceptProtection = op === 'damage' && event.instantDeath === true ? protectionCarrier(state, target) : null;
    if (conceptProtection) {
      const attacker = authorityFor(state, frame.carrier, data.sourceId);
      const defender = authorityFor(state, conceptProtection, target.id);
      const contest = authorityContest(state, { ...attacker, unitId: data.sourceId }, { ...defender, unitId: target.id }, {
        preview: options,
        checkBonus: (unit, side) => host.checkBonus?.(state, unit, { checkKind: 'authority', targetId: side === 'attacker' ? target.id : data.sourceId }) ?? 0,
      });
      event.authorityContest = contest;
      if (contest.conditional) { state.vm.stack.pop(); return; }
      host.log(state, source, 'authority', `${target.name}的概念保护${contest.result < 0 ? '拦截了即死' : '被即死穿透'}${authorityProse(contest)}`, { targetId: target.id, contest });
      if (contest.result < 0) { state.vm.stack.pop(); return; }
    }
    const protector = op === 'damage' && !data.shared && entry(state.units, event.shareTo);
    const ratio = Number.isFinite(event.shareRatio) ? Math.max(0, Math.min(1, event.shareRatio)) : 0;
    if (ratio > 0 && alive(protector) && protector !== target) {
      const { resultEventRef, out, ...sharedData } = data;
      frame.sharedDamage = { ...sharedData, targetId: protector.id, amount: data.amount * ratio,
        damageType: event.damageType, shared: true, sharedFromId: target.id };
      event.finalAmount = Math.floor(event.finalAmount * (1 - ratio));
    }
    const before = pool.current, beforeMax = pool.max;
    event.previous = before;
    const canRestore = op === 'heal' || (op === 'resource' && !localOwner && !pseudo &&
      (data.mode === 'add' || data.mode === 'set' || data.mode === 'swap'));
    const blockRestore = canRestore && host.flag?.(state, target, 'blockResourceRestore') === true;
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
        if (!status.vars.shieldAmount) removeStatus(state, target, status, 'shield_depleted', source, host, frame);
      }
      updatePoolCurrent(state, pool.id, 'sub', pending, { minRemain: event.preserveLife ? 1 : 0 });
      event.dealt = before - getPool(state, target.id, key).current;
      event.absorbed = absorbed;
      host.log(state, source, 'damage', `${target.name}受到${event.dealt}点${data.label ?? ''}伤害`, { ...data.details, targetId: target.id, damageType: event.damageType, amount: event.dealt, absorbed, hpBefore: before, hpAfter: target.hp });
    } else if (op === 'heal') {
      if (blockRestore) event.finalAmount = 0;
      else updatePoolCurrent(state, pool.id, 'add', Math.max(0, Math.floor(event.finalAmount)));
      event.healing = target.hp - before;
      host.log(state, source, 'heal', `${target.name}${data.label ? `因${data.label}` : ''}恢复${event.healing}点生命`, { ...data.details, targetId: target.id, amount: event.healing, hpBefore: before, hpAfter: target.hp });
    } else {
      let applied = true;
      if (pseudo) {
        const amount = event.finalAmount;
        if (data.mode === 'sub' && data.requireFull && before < amount) applied = false;
        else if (!applyPseudo(state, target, key, data.mode, Math.floor(amount))) { state.vm.stack.pop(); return; }
      } else if (data.mode === 'swap') {
        if (other) {
          if (!blockRestore) swapPoolCurrents(state, pool.id, other.id);
          // Both sides belong to the target. Only the side that would fall can change.
          else if (otherBefore < before) updatePoolCurrent(state, pool.id, 'set', otherBefore);
          else if (before < otherBefore) updatePoolCurrent(state, other.id, 'set', before);
        }
      } else {
        if (['add_max', 'sub_max', 'set_max'].includes(data.mode) && !['hp', 'mp', 'sp'].includes(key)) {
          state.vm.stack.pop(); return;
        }
        if (blockRestore && data.mode === 'add') event.finalAmount = Math.min(0, event.finalAmount);
        if (blockRestore && data.mode === 'set') event.finalAmount = Math.min(before, event.finalAmount);
        const amount = data.mode === 'sub' ? Math.max(0, event.finalAmount) : event.finalAmount;
        const reducesMax = data.mode === 'sub_max' && amount > 0 || data.mode === 'set_max' && amount < pool.max;
        const protection = reducesMax ? protectionCarrier(state, target) : null;
        if (protection) {
          const attacker = authorityFor(state, frame.carrier, data.sourceId);
          const defender = authorityFor(state, protection, target.id);
          const contest = authorityContest(state, { ...attacker, unitId: data.sourceId }, { ...defender, unitId: target.id }, {
            preview: options,
            checkBonus: (unit, side) => host.checkBonus?.(state, unit, { checkKind: 'authority', targetId: side === 'attacker' ? target.id : data.sourceId }) ?? 0,
          });
          event.authorityContest = contest;
          if (contest.conditional) { state.vm.stack.pop(); return; }
          host.log(state, source, 'authority', `${target.name}的概念保护${contest.result < 0 ? '拦截了上限削减' : '被上限削减穿透'}${authorityProse(contest)}`, { targetId: target.id, contest });
          if (contest.result < 0) { state.vm.stack.pop(); return; }
        }
        const changed = ['add_max', 'sub_max', 'set_max'].includes(data.mode)
          ? updatePoolMax(state, pool.id, data.mode, amount, { minRemain: Math.max(0, data.minRemain) })
          : updatePoolCurrent(state, pool.id, data.mode, amount, { minRemain: Math.max(0, data.minRemain), requireFull: data.requireFull });
        applied = changed.applied;
      }
      if (!applied) {
        const caller = state.vm.stack.find(parent => parent.frameId === frame.callerId);
        if (caller) caller.pc = caller.program.length;
        // Branches share their rule's registers. A failed pseudo-pool payment
        // must also stop the active branch, e.g. a counter after an ask.
        if (pseudo) for (const branch of state.vm.stack) {
          if (branch.localsRef === frame.callerId) branch.pc = branch.items?.length ?? branch.program.length;
        }
        state.vm.stack.pop();
        return;
      }
      const after = pseudo ? pseudoState(state, target, key).current : entry(state.pools, pool.id).current;
      const maxChange = data.mode.endsWith('_max');
      const from = maxChange ? beforeMax : before, to = maxChange ? entry(state.pools, pool.id).max : after;
      const label = ({attack:'攻击槽',action:'动作槽',move:'剩余移动格',reaction:'反应'})[key] ?? key.toUpperCase();
      const field = label + (maxChange ? '上限' : '');
      event.change = to - from;
      host.log(state, source, 'resource', `${target.name}${data.label ? `因${data.label}` : ''}${maxChange ? (to >= from ? '提高' : '降低') : (to >= from ? '恢复' : '消耗')}${Math.abs(event.change)}点 ${field}`, { targetId: target.id, resource: key, resourceLabel: field, before: from, after: to });
    }
    const result = entry(state.vm.events, data.resultEventRef);
    if (result) for (const key of ['dealt', 'absorbed', 'healing']) if (event[key] !== undefined) result[key] = event[key];
    if (data.out) {
      const caller = state.vm.stack.find(parent => parent.frameId === frame.callerId);
      if (caller) caller.vars[data.out] = event.dealt ?? event.healing ?? event.change;
    }
    const depletion = Object.values(state.pools).filter(candidate => candidate.kind === 'hp' && candidate.current === 0 &&
      (candidate.id === pool.id && before > 0 || other && candidate.id === other.id && otherBefore > 0) &&
      !state.vm.stack.some(parent => parent.native === 'lethal' && parent.data.poolId === candidate.id));
    if (op === 'damage' && event.dealt > 0 && alive(target) && hasActiveConcentration(state, target.id)) {
      const dc = Math.min(30, 10 + Math.floor(event.dealt / Math.max(1, target.maxHp) * 20));
      pushFrame(state, { native: 'check', ownerId: source?.id ?? target.id, sourceId: source?.id ?? target.id,
        scope: { target: { type: 'unit', id: target.id } }, concentrationSave: true,
        data: { kind: 'save', stat: ['con', 'spi'], mode: 'any', dc, tags: ['concentration'] } });
    }
    for (const depleted of depletion.reverse()) pushFrame(state, { native: 'lethal', ownerId: target.id, sourceId: data.sourceId,
      data: { poolId: depleted.id, damageType: event.damageType, targetId: target.id,
        rawAmount: event.rawAmount ?? 0, finalAmount: event.finalAmount ?? 0, dealt: event.dealt ?? 0, absorbed: absorbed ?? 0,
        overkill: Math.max(0, (event.finalAmount ?? 0) - (absorbed ?? 0) - before),
        ...(typeof event.intent === 'string' && { intent: event.intent }) } });
    return;
  }
  if (frame.pc === 2) {
    frame.pc++;
    const hook = op === 'damage' ? 'after_damage' : op === 'heal' ? 'after_heal' : null;
    if (hook) scheduleHooks(state, frame, hook, frame.eventRef, host);
    return;
  }
  if (frame.sharedDamage) {
    const sharedDamage = frame.sharedDamage;
    delete frame.sharedDamage;
    scheduleCommit(state, frame, sharedDamage);
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
    data.victims = event.units.filter(id => entry(state.units, id)?.pools?.hp === pool.id);
    for (const id of data.victims) cleanupSourceBoundEntities(state, id, '来源离场', host, frame);
    scheduleHooks(state, frame, 'on_death', frame.eventRef, host);
    return;
  }
  // One phase at a time: an ally's pending choice must finish before kill credit.
  const index = Math.floor((frame.pc - 3) / 2), deadId = data.victims?.[index];
  if (!deadId) { state.vm.stack.pop(); return; }
  const allyPhase = frame.pc++ % 2 === 1, killerId = frame.sourceId;
  if (allyPhase || (killerId !== deadId && entry(state.units, killerId))) {
    const ref = newEvent(state, { ...state.vm.events[frame.eventRef], targetId: deadId, deadId, killerId });
    scheduleHooks(state, frame, allyPhase ? 'on_ally_death' : 'on_kill', ref, host);
  }
}
