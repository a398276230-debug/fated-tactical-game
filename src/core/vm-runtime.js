import { coverDamage, grantStatus, movementBudget, actionSkill, continueStrike, continueRound, initializeSummonTurn, getStatusTemplate, statusLogDetail, preview, retargetStrike, mitigation, damageAfterFlatReduction, encounterNonlethal, insufficientHP, paySkillEquipmentCost, needsTarget, isAiControlled } from './combat.js';
import { answerVM, newEvent, newVM, pushFrame, scheduleHooks, stepVM } from './tactical-vm.js';
import { aggregateModifiers, applyStatMod, collectRules, carrierScope, eventOwners } from './vm-carriers.js';
import { isStatusImmune } from './vm-immunity.js';
import { commitOps, continueCommit, continueLethal, scheduleCommit } from './vm-commit.js';
import { continueApplyStatus, continueCheck, continueRemoveStatus, removeStatus, ruleOps } from './vm-rules.js';
import { continueAction, perform, queueVMAction } from './vm-action.js';
import { createPool, getPool, initializeUnitPools, poolNumber, syncUnitPools, updatePoolCurrent } from './vm-pools.js';
import { spatialOps, spatialContinuations, refreshFollowingZones, expireSpatialEffects } from './vm-spatial-ops.js';
import { elevation } from './spatial.js';
import { evaluateExpr } from './formula.js';
import { ruleAvailability } from './vm-rule-limits.js';
import { validVmSourceSkillId } from './vm-schema.js';
import { vmAttribution, normalizeProse } from './log-attribution.js';
import { actionActor, syncLinkedGroupSlots } from './turn-routing.js';
import { continueSpatialImpulse } from './element-impulse.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const values = table => Object.values(table ?? {});
const lookUp = (state, event, ownerId, name) => aggregateModifiers(state, ownerId, event).stats[name];
const mod = (state, event, ownerId, name, base) => applyStatMod(base, lookUp(state, event, ownerId, name));


export function recordVM(state, unit, type, text, detail = {}) {
  const positions = Object.fromEntries(Object.values(state.units).map(unit => [unit.id, { x: unit.x, y: unit.y, z: elevation(state, unit) }]));
  const cause = vmAttribution(state);
  const loggedDetail = cause ? { ...detail, attribution: cause } : detail;
  state.logs.push({ round: state.round, actor: unit?.id ?? null, type, text: normalizeProse(text), detail: loggedDetail, positions });
}

const handlers = {
  action: continueAction, commit: continueCommit, lethal: continueLethal, check: continueCheck,
  apply_status: continueApplyStatus, remove_status: continueRemoveStatus,
  ...spatialContinuations,
  spatial_impulse: continueSpatialImpulse,
  strike: continueStrike,
  round: continueRound,
};

export function initializeVMWorld(state) {
  state.vm ??= newVM();
  state.pools ??= {};
  const units = values(state.units);
  const holders = new Map();
  for (const unit of units) if (!unit.pools?.hp) initializeUnitPools(state, unit.id);
  for (const unit of units) {
    for (const id of [unit.mainHand, unit.weapon, unit.offHand, unit.shield, ...(unit.gear ?? []), ...(unit.bagWeapons ?? [])]) {
      const item = own(state.items, id);
      if (item) holders.set(item.id, unit);
    }
    syncUnitPools(state, unit);
  }
  for (const item of values(state.items)) {
    const context = { state, self: holders.get(item.id) ?? own(state.units, item.ownerId), item };
    for (const [key, definition] of Object.entries(own(state.equipment, item.templateId)?.pools ?? {})) {
      if (!getPool(state, item.id, key, 'item')) createPool(state, {
        ownerKind: 'item', ownerId: item.id, key, max: poolNumber(definition.cap, context),
        current: poolNumber(definition.initial, context), reloadable: definition.reloadable ?? false,
      });
    }
  }
}

export function advanceVMRound(state) {
  initializeVMWorld(state);
  state.vm.stepsRemaining = 2000;
  pushFrame(state, { native: 'round', ownerId: null, sourceId: null });
  stepVM(state, vmHost);
}

export function advanceVMSpatial(state, options = {}) {
  initializeVMWorld(state);
  if (state.vm.pendingAsk) return;
  const idle = !state.vm.stack.length;
  if (idle) state.vm.stepsRemaining = 2000;
  const parent = state.vm.stack.at(-1) ?? { ownerId: null, sourceId: null };
  expireSpatialEffects(state, vmHost, { advance: true, ...options, parent });
  if (idle) stepVM(state, vmHost);
}

export function advanceVMAnchorTurn(state, anchorUnitId) {
  initializeVMWorld(state);
  if (state.vm.pendingAsk) return;
  const idle = !state.vm.stack.length;
  if (idle) state.vm.stepsRemaining = 2000;
  const parent = state.vm.stack.at(-1) ?? { ownerId: anchorUnitId, sourceId: anchorUnitId };
  expireSpatialEffects(state, vmHost, { advance: true, anchorUnitId, parent });
  if (idle) stepVM(state, vmHost);
}

export function dispatchVMHook(state, hook, event) {
  initializeVMWorld(state);
  const parent = state.vm.stack.at(-1) ?? { sourceId: event.actorId };
  const idle = state.vm.stack.length === 0;
  if (idle) state.vm.stepsRemaining = 2000;
  scheduleHooks(state, parent, hook, newEvent(state, event), vmHost);
  if (idle) stepVM(state, vmHost);
}

export function removeVMStatus(state, target, status, reason, actor, detail) {
  initializeVMWorld(state);
  const parent = state.vm.stack.at(-1) ?? { sourceId: actor?.id };
  const idle = state.vm.stack.length === 0;
  if (idle) state.vm.stepsRemaining = 2000;
  const removed = removeStatus(state, target, status, reason, actor, vmHost, parent, detail);
  if (idle) stepVM(state, vmHost);
  return removed;
}

export function commitVMEffect(state, data) {
  initializeVMWorld(state);
  const parent = state.vm.stack.at(-1) ?? { ownerId: data.sourceId ?? data.targetId, sourceId: data.sourceId ?? null };
  const idle = !state.vm.stack.length;
  if (idle) state.vm.stepsRemaining = 2000;
  scheduleCommit(state, parent, { pool: 'hp', ...data });
  if (idle) stepVM(state, vmHost);
}

export const vmHost = {
  grantStatus, coverDamage,
  ops: { ...ruleOps, ...commitOps, ...spatialOps, perform },
  log: recordVM,
  isAI: isAiControlled,
  initializeSummonTurn,
  event: newEvent,
  hooks: (state, frame, hook, ref) => scheduleHooks(state, frame, hook, ref, vmHost),
  commit: scheduleCommit,
  opportunity(state, unit, center, profile, weapon) {
    pushFrame(state, { native: 'strike', ownerId: unit.id, sourceId: unit.id,
      data: { type: 'attack', x: center.x, y: center.y }, plan: { center, targets: [profile], hostile: true }, weapon });
  },
  followup(state, frame, weapon, profile) {
    pushFrame(state, { native: 'strike', ownerId: frame.ownerId, sourceId: frame.sourceId,
      eventRef: frame.eventRef, data: frame.data, plan: { center: profile, targets: [profile] }, weapon, followup: true, started: true });
  },
  expireMatchingStatuses(state, hook, event) {
    const ids = new Set([event.actorId, event.targetId, ...eventOwners(state, hook, event)]);
    for (const id of ids) {
      const unit = own(state.units, id);
      for (const status of Object.values(unit?.statuses ?? {})) {
        const expires = [status.expireOn].flat().some(rule => rule?.hook === hook &&
          (rule.filter === undefined || evaluateExpr(rule.filter, { self: unit, status, event,
            source: own(state.units, status.sourceId), target: own(state.units, event.targetId),
            attacker: own(state.units, event.actorId) })));
        if (!expires) continue;
        removeStatus(state, unit, status, 'expired', unit, vmHost, { sourceId: id }, { hook });
      }
    }
  },
  rules(state, hook, event) {
    const entries = collectRules(state, hook, event);
    const actor = own(state.units, event.actorId);
    const skill = actionSkill(state, actor, event.skillId);
    const isHeld = actor?.skills?.includes(event.skillId);
    const actionRules = hook === 'active' || !isHeld ? skill?.rules : undefined;
    const usedItem = event.actionType === 'use_item' ? event.itemId : null;
    const carrier = usedItem || skill?.itemId ? { type: 'item', id: usedItem ?? skill.itemId }
      : skill ? { type: 'skill', id: event.skillId, ownerId: actor?.id } : null;
    return [...entries, ...(event.rules ?? actionRules ?? []).filter(rule => rule.hook === hook).map(rule => ({
      rule, ownerId: event.actorId, sourceId: event.actorId, carrierOrder: -1, carrier,
      ...(skill && !event.rules && { sourceSkillId: event.skillId }),
      useKey: JSON.stringify([event.actorId, usedItem ?? event.skillId, rule.id]),
    }))];
  },
  enterRule(state, frame, key) {
    const { rule } = frame;
    const { usesLeft, cooldownRemaining, sameTurn, roundUsed, stamp } = ruleAvailability(state, rule, key);
    if (usesLeft <= 0 || cooldownRemaining > 0) return false;
    if (rule.usesPerBattle !== undefined) (state.vm.uses ??= {})[key] = (own(state.vm.uses, key) ?? 0) + 1;
    if (rule.usesPerTurn !== undefined || rule.usesPerRound !== undefined || rule.cooldownTurns !== undefined) {
      (state.vm.ruleTurns ??= {})[key] = { round: state.round, turn: state.turn, count: sameTurn ? stamp.count + 1 : 1,
        ...(rule.usesPerRound !== undefined && { roundCount: roundUsed + 1 }) };
    }
    return true;
  },
  continue(env) {
    const handler = own(handlers, env.frame.native);
    if (!handler) throw new Error(`未知结算阶段 ${env.frame.native}`);
    handler(env);
  },
  resource: (state, unit, key) => {
    if (!unit) return undefined;
    if (key === 'move') return movementBudget(state, unit).remainingCells;
    if (key === 'attack' || key === 'action') return Math.max(0, 1 - (unit.used?.[key] ?? 0));
    if (key === 'reaction') return unit.reactionAvailable === false ? 0 : 1;
    return getPool(state, unit.id, key)?.current;
  },
  statusTemplate: getStatusTemplate,
  statusLogDetail,
  flag: (state, unit, flag) => aggregateModifiers(state, unit.id).flags[flag] === true,
  stat: (state, unit, key) => mod(state, {}, unit.id, key, unit.stats?.[key] ?? 0),
  checkBonus: (state, unit, event) => mod(state, event, unit.id, 'checkBonus', 0)
    + (event.checkKind === 'save' ? mod(state, event, unit.id, 'resistBonus', 0) : 0),
  advantage: (state, unit, event) => mod(state, event, unit.id, 'advantage', 0),
  resistBonus: (state, unit, event) => mod(state, event, unit.id, 'resistBonus', 0),
  dcBonus: (state, unit, event) => mod(state, event, unit.id, 'dcBonus', 0),
  isImmune: (state, unit, key, frame) => {
    const event = frame?.eventRef ? state.vm?.events?.[frame.eventRef] : undefined;
    const source = own(state.units, event?.actorId ?? event?.sourceId ?? frame?.sourceId);
    return isStatusImmune(state, unit, key, source, { collectRules, carrierScope });
  },
  prepareDamage(state, source, target, data) {
    const { damageType } = data;
    const event = { damageType, actorId: source?.id ?? null, targetId: target.id, weaponTemplateId: data.weaponTemplateId ?? null,
      actionType: data.actionType ?? null, skillId: data.skillId ?? null, backstab: data.backstab ?? false,
      melee: data.melee ?? false, critical: data.critical ?? false,
      ratingMultiplier: data.ratingMultiplier ?? 1,
      ...(typeof data.intent === 'string' && { intent: data.intent }) };
    if (source && vmHost.flag(state, source, 'harmless')) return 0;
    let amount = data.amount;
    if (source) {
      amount += mod(state, event, source.id, 'damageFlat', 0);
      amount = mod(state, event, source.id, 'damageMult', amount);
    }
    if (damageType === 'true') amount = mod(state, event, target.id, 'incomingDamageMult', amount);
    else {
      const pierce = data.armorPierce ?? { flat: source ? mod(state, event, source.id, 'armorPierce', 0) : 0,
        percent: source ? mod(state, event, source.id, 'armorPiercePercent', 0) : 0 };
      const context = { ...event, attacker: source, intercepting: data.intercepted, ignoreArmor: data.ignoreArmor };
      const reduction = mitigation(state, target, damageType, data.direct !== false, pierce, context);
      if (data.direct === false) {
        const reduced = Math.floor(amount * reduction.multiplier * (1 - reduction.attributeReduction));
        amount = Math.max(0, reduced - (reduction.multiplier === 1 ? Math.ceil(reduction.armor) : 0));
      } else {
        amount *= reduction.multiplier * (1 - reduction.attributeReduction);
        amount *= reduction.armorMultiplier;
      }
      amount = damageAfterFlatReduction(state, target, amount, context);
      amount *= 1 - reduction.dr;
    }
    return Math.max(0, source ? mod(state, event, source.id, 'finalDamageMult', amount) : amount);
  },
  preserveLife: encounterNonlethal,
  rejectAction(state, actor, action, error) {
    if (error !== insufficientHP) return false;
    recordVM(state, actor, 'skill_rejected', error, { skillId: action.skillId });
    return true;
  },
  prepareHeal(state, source, target, data) {
    if (source && vmHost.flag(state, source, 'harmless')) return 0;
    const event = { actorId: source?.id ?? null, targetId: target.id, actionType: data.actionType ?? null,
      ...(typeof data.intent === 'string' && { intent: data.intent }) };
    const scaled = source ? mod(state, event, source.id, 'healingMult', data.amount) : data.amount;
    return Math.max(0, mod(state, event, target.id, 'incomingHealMult', scaled));
  },
  planAction(state, actor, action, overrides) {
    // Preview against the invoking actor, including recursive actions by a different unit.
    const unit = { ...actor };
    if (overrides.free) Object.assign(unit, { hp: unit.maxHp, mp: unit.maxMp, sp: unit.maxSp });
    if (overrides.ignoreSlots) Object.assign(unit, { ap: 2, used: { attack: 0, action: 0 } });
    const skill = actionSkill(state, actor, action.skillId);
    const view = { ...state, units: { ...state.units, [actor.id]: unit } };
    const planned = preview(view, action, { actingUnit: unit, simulateRules: false, actionOrigin: overrides.origin,
      ignoreRange: overrides.ignoreRange === true, ignoreLOS: overrides.ignoreLOS === true,
      deferGeometry: overrides.deferGeometry === true, limitClock: state });
    if (!planned.ok) return planned;
    if (needsTarget(action.type) && action.x === undefined && !planned.center) return { ok: false, error: '缺少目标坐标' };
    if (overrides.interactiveId && planned.interactiveId !== overrides.interactiveId) return { ok: false, error: '原互动点已不可用' };
    const primary = planned.targets?.find(row => row.id === planned.targetId) ?? planned.targets?.[0];
    const basePower = evaluateExpr(skill?.power, { self: actor, source: actor, attacker: actor, units: state.units });
    const power = skill?.power == null ? 0 : primary?.power ?? (Number.isFinite(basePower) ? basePower : 0);
    return { ...planned, center: planned.center ?? { x: action.x ?? actor.x, y: action.y ?? actor.y }, targetIds: planned.corpseId ? [planned.corpseId] : (planned.targets ?? []).filter(row => row.kind !== 'cover').map(row => row.id),
      costTemplate: skill ?? (planned.poolCostId ? { resourceCost: { resource: planned.poolCostId } } : null),
      power, initiativeBonus: skill?.initiativeBonus ?? 0, isSingle: planned.shape == null || planned.shape === 'single',
      isRanged: planned.actionContext.isRanged, damageType: planned.actionContext.damageType,
      weaponTemplateId: planned.actionContext.weaponTemplateId };
  },
  payAction(state, actor, plan, event, overrides) {
    if (!overrides.ignoreSlots && plan.ap > 0) {
      actor.ap -= plan.ap;
      for (const slot of plan.ap === 2 ? ['attack', 'action'] : plan.slot ? [plan.slot] : []) {
        actor.used[slot]++;
        syncLinkedGroupSlots(state, actor, slot, actor.used[slot]);
      }
    }
    if (overrides.free) return;
    const scaledPoolCost = amount => Math.max(0, Math.floor(amount * (event.costScale ?? 1)));
    paySkillEquipmentCost(state, actor, plan.costTemplate, scaledPoolCost(event.poolCost ?? 0));
    for (const [resource, amount] of plan.extraPoolCosts ?? []) {
      const cost = scaledPoolCost(amount);
      const pool = getPool(state, actor.id, resource);
      if (!cost || !pool) continue;
      const { before, after } = updatePoolCurrent(state, pool.id, 'sub', cost);
      recordVM(state, actor, 'resource', `${actor.name} · ${resource} ${before} → ${after}`,
        { targetId: actor.id, resource, amount: before - after, before, after });
    }
    for (const key of ['hp', 'mp', 'sp']) {
      const cost = Math.max(0, Math.floor((event[`${key}Cost`] ?? 0) * (event.costScale ?? 1)));
      if (!cost) continue;
      const pool = getPool(state, actor.id, key);
      const { before, after } = updatePoolCurrent(state, pool.id, 'sub', cost, { minRemain: key === 'hp' ? 1 : 0 });
      recordVM(state, actor, 'resource', `${actor.name}因${plan.name}消耗${before - after}点 ${key.toUpperCase()}`,
        { targetId: actor.id, resource: key, amount: before - after, before, after });
    }
  },
  runAction({ state, frame, actor, plan, event, overrides }) {
    event.power *= overrides.scale ?? 1;
    event.power *= event.damageScale ?? 1;
    const skill = own(state.skills, event.skillId);
    if (skill?.backpackItem) {
      const before = actor.inventory[event.skillId];
      actor.inventory[event.skillId] = before - 1;
      recordVM(state, actor, 'item_spent', `${actor.name}消耗${skill.name}（数量 ${before} → ${before - 1}）`,
        { itemId: event.skillId, before, after: before - 1 });
    }
    const name = plan.name ?? skill?.name ?? '技能';
    const intent = plan.isSingle ? plan.intent ?? 'normal' : 'normal';
    const covers = !event.redirectTarget && !event.replaceTarget ? (plan.targets ?? []).filter(profile => profile.kind === 'cover') : [];
    recordVM(state, actor, 'action', `${actor.name}：${name}`, {
      action: frame.data.action, targetId: event.targetId, intent, attackSource: name,
      attackTargets: [...event.targets.map(id => ({ unit: id })), ...covers.map(profile => ({ cover: profile.name }))],
      ap: plan.ap, mp: plan.mp, sp: plan.sp, remainingAP: actor.ap,
    });
    const targets = event.targets.filter(id => id !== plan.corpseId).map(id => (plan.targets ?? []).find(profile => profile.id === id)
      ?? retargetStrike(state, actor, frame.data.action, state.units[id], plan));
    targets.push(...covers);
    pushFrame(state, { native: 'strike', ownerId: actor.id, sourceId: actor.id, eventRef: frame.eventRef,
      data: frame.data.action, plan: { ...plan, targets }, beforeTargetPosition: frame.beforeTargetPosition, scale: overrides.scale ?? 1 });
    scheduleHooks(state, frame, 'active', frame.eventRef, vmHost);
  },
};

export function validVmState(state) {
  const { vm, pools } = state;
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  if (!plain(vm) || !Array.isArray(vm.stack) || vm.stack.length > 64 || !plain(vm.events)
      || !Number.isSafeInteger(vm.serial) || vm.serial < 0 || !Number.isInteger(vm.stepsRemaining)
      || Boolean(vm.stack.length) !== Boolean(vm.pendingAsk) || !plain(pools)) return false;
  if (vm.startingTurn !== undefined && (!vm.pendingAsk || vm.endingTurn !== undefined
      || vm.startingTurn !== state.order?.[state.turn] || !own(state.units, vm.startingTurn))) return false;
  if (vm.endingTurn !== undefined && (!vm.pendingAsk || typeof vm.endingTurn !== 'string'
      || vm.endingTurn !== state.order?.[state.turn] || !own(state.units, vm.endingTurn))) return false;
  const remaining = vm.endingStatuses;
  if (remaining !== undefined && (!vm.endingTurn || !Array.isArray(remaining)
      || !remaining.every(id => typeof id === 'string'))) return false;
  for (const record of [...vm.stack, ...Object.values(vm.events)]) {
    if (!plain(record) || (Object.hasOwn(record, 'sourceSkillId') && !validVmSourceSkillId(record.sourceSkillId))) return false;
  }
  for (const unit of Object.values(state.units ?? {})) {
    for (const [key, maximum] of [['hp', 'maxHp'], ['mp', 'maxMp'], ['sp', 'maxSp']]) {
      const pool = own(pools, own(unit.pools, key));
      if (!pool || pool.kind !== key || pool.current !== unit[key] || pool.max !== unit[maximum]
          || !Array.isArray(pool.contributors) || !pool.contributors.some(c => c.ownerKind === 'unit' && c.ownerId === unit.id)) return false;
    }
  }
  return state.tape === undefined || Array.isArray(state.tape);
}

export function resolveVMAction(state, action, { actor = actionActor(state, action), dryRun = false } = {}) {
  if (dryRun) {
    state = structuredClone(state);
    actor = own(state.units, actor?.id);
  }
  initializeVMWorld(state);
  if (action.type === 'answer') answerVM(state, action, vmHost);
  else {
    if (state.vm.stack.length || state.vm.pendingAsk) throw new Error('请先回答当前战斗选择');
    if (!actor) throw new Error('没有行动者');
    state.vm.stepsRemaining = 2000;
    queueVMAction(state, { actorId: actor.id, action, record: true });
  }
  const runOptions = { dryRun, onCancel(event) {
    this.canceled = true;
    this.cancelReason = event.cancelReason || '行动被规则拦截';
  } };
  const result = stepVM(state, vmHost, runOptions);
  refreshFollowingZones(state, vmHost);
  return { ...result, canceled: Boolean(runOptions.canceled), cancelReason: runOptions.cancelReason ?? null,
    ...(dryRun && { state }) };
}
