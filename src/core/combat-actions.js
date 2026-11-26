import { atBattleEdge, aoeCells, canStep, cellAt as tileAt, coverAt, coverBetween, distance3D as distance,
  elevation, facingArc, facingToward as signFacing, gridDistance as near, hasLOS as clearSight,
  isFlanked as flank, isGround as ground, movementOptions, unitAt, unitsAt } from './spatial.js';
import { critChance as criticalOdds, rollD20, rollProtocolD20, rollDice, rollDie,
  saveChance as saveOdds } from './rng.js';
import { isRangedMain, stanceFor, stanceLabel, stanceRules, distanceTier, ratingFor, sizeHitModifier, meleeMultiplier, intentCheck, INTENTS, RATING_TABLE, MORALE, moraleModifiers, moraleLabels, moraleResult, initiative as protocolInitiative, typedArmor, damageAttributeReduction, TIER_CELL_M, scaledCells, scaledTemplate } from './combat_protocol.js';

import { elementMitigationCategory } from './elements.js';
import { validVmExpiry as validExpiry } from './vm-schema.js';
import { evaluateExpr } from './formula.js';
import { zoneContains } from './vm-select.js';
import { aggregateModifiers, applyStatMod, itemRules, incomingDistanceOffset, unitSkipped, reactionBlocked } from './vm-carriers.js';
import { actionStatuses, getStatusTemplate, STATUSES } from '../presets/status-defaults.js';
import { ruleAvailability } from './vm-rule-limits.js';
import { resolveVMAction, dispatchVMHook, initializeVMWorld, removeVMStatus, commitVMEffect, advanceVMSpatial, advanceVMRound } from './vm-runtime.js';
import { getPool, updatePoolCurrent } from './vm-pools.js';
import { movementProgressText } from './log-attribution.js';
import { authorityContest, authorityFor, authorityProse, protectionCarrier } from './vm-authority.js';
import { resolveStatusApplication } from './status-application.js';
export { getStatusTemplate, STATUSES };
export const corpses = state => Object.values(state.units).filter(unit => unit.hp <= 0 && !unit.fled && !unit.corpseConsumed);


function randomDie(state, sides) {
  const { rng, value } = rollDie(state.rng, sides);
  state.rng = rng;
  return value;
}

const values = object => Object.values(object ?? {});
const alive = unit => unit && unit.hp > 0;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const living = state => values(state.units).filter(unit => alive(unit) && !unit.fled).sort(byId);
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const pos = (x, y) => ({ x, y });
const pointAt = (state, at) => ({ x:at.x, y:at.y, z:elevation(state, at) });
const key = (x, y) => `${x},${y}`;
const stat = (unit, id) => Number(unit.stats?.[id] ?? 0);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const vmFlag = (state, unit, name, context = {}) => aggregateModifiers(state, unit.id, modifierEvent(unit, context)).flags[name] === true;
const statusOf = (unit, id) => Object.hasOwn(unit.statuses ?? {}, id) ? unit.statuses[id] : undefined;
export const currentUnit = state => Object.hasOwn(state.units, state.order[state.turn]) ? state.units[state.order[state.turn]] : undefined;

function record(state, unit, type, text, detail = {}) {
  const actor = typeof unit === 'string' ? unit : unit?.id ?? null;
  const positions = Object.fromEntries(values(state.units).map(current => [current.id, pointAt(state, current)]));
  const event = { round: state.round, actor, text, type, detail, positions };
  state.logs.push(event);
  return event;
}

function tableEntry(table, id) { return Object.hasOwn(table ?? {}, id) ? table[id] : undefined; }

function equipmentFor(state, instanceId) {
  const instance = tableEntry(state.items, instanceId);
  const template = tableEntry(state.equipment, instance?.templateId);
  return { instance, template, rules: template?.rules ?? [] };
}
const isWeapon = template => template?.kind === 'weapon' || Boolean(template?.damage && !template.kind);
const gearFor = (state, unit) => (unit.gear ?? []).map(id => equipmentFor(state, id)).filter(({template}) => !isWeapon(template) && template?.kind !== 'shield');
export function loadoutStance(state, unit) {
  const main = equipmentFor(state, unit.mainHand ?? unit.weapon).template;
  const off = equipmentFor(state, unit.offHand).template;
  return stanceFor({ mainHand: main?.boundTo && main.boundTo !== unit.id ? null : main,
    offHand: off?.kind === 'consumable' && unit.attunementCharges === 0 ? null : off,
    shield: equipmentFor(state, unit.shield).template });
}
const effectiveStance = (state, unit) => unit.stance ?? loadoutStance(state, unit);
export function switchableWeapons(state, unit) {
  const main = unit.mainHand ?? unit.weapon;
  const bag = unit.bagWeapons ?? [];
  return [...new Set([...(isWeapon(equipmentFor(state, main).template) ? [unit.offHand, ...(unit.gear ?? [])] : []), ...bag])].filter(id => {
    if (!id || id === main) return false;
    const { template } = equipmentFor(state, id);
    return isWeapon(template) && (!template.boundTo || template.boundTo === unit.id)
      && !(template.twoHanded && (unit.offHand || unit.shield));
  });
}
const equipped = (state, unit) => [...new Set([unit.mainHand ?? unit.weapon, unit.offHand, unit.shield, ...gearFor(state, unit).map(g => g.instance?.id)].filter(Boolean))].map(id => equipmentFor(state, id)).filter(({ template }) => !template?.boundTo || template.boundTo === unit.id);
const effectiveStat = (state, unit, key) => modStat(state, unit, key, stat(unit, key));
const resolveDC = (state, actor, dc) => evaluateExpr(dc, { self: actor, source: actor, round: state.round, turn: state.turn }) ?? 12;

const resourcePool = (state, unit, resource, instance) => {
  for (const item of equipped(state, unit)) {
    if (instance && item.instance !== instance) continue;
    const effect = tableEntry(item.template?.pools, resource);
    const pool = effect && getPool(state, item.instance.id, resource, 'item');
    if (pool) return { item, effect, amount: pool.current };
  }
  return null;
};

export function stealthCheck(state, unit, d20, dc) {
  const bonus = 0;
  return { total: d20 + bonus, bonus, success: d20 + bonus >= dc };
}

export const shieldTotal = unit => values(unit.statuses).reduce((total, status) => total + (status.category === 'shield' ? status.vars?.shieldAmount ?? 0 : 0), 0);

export function grantStatus(state, unit, statusId, options = {}) {
  const template = getStatusTemplate(state, statusId);
  if (!unit || !template) throw new Error(`未知状态：${statusId}`);
  if (!alive(unit) || unit.fled) return null;
  unit.statuses ??= {};
  const result = resolveStatusApplication({ ...state, statusTemplates: { ...state.statusTemplates, [statusId]: template } }, unit, statusId, options, { strict: true });
  if (!result) return null;
  unit.statuses[statusId] = result.nextStatus;
  record(state, result.nextStatus.sourceId ?? unit.id, 'status', `${unit.name}获得${template.name} ×${result.nextStatus.stacks}`,
    statusLogDetail(unit, result.nextStatus));
  return result.nextStatus;
}

export function statusLogDetail(unit, status) {
  const { id: statusId, category, stacks, remainingTurns, durationType, vars, mods, rules, flags, expireOn } = status;
  const amount = category === 'shield' ? vars?.shieldAmount : undefined;
  return { targetId: unit.id, statusId, ...(category && { category }), stacks, remainingTurns, durationType,
    ...(amount === undefined ? {} : { amount }), ...(vars && Object.keys(vars).length ? { vars: structuredClone(vars) } : {}),
    ...(mods?.length ? { mods: structuredClone(mods) } : {}), ...(rules?.length ? { rules: structuredClone(rules) } : {}),
    ...(flags?.length ? { flags: [...flags] } : {}), ...(expireOn ? { expireOn: structuredClone(expireOn) } : {}) };
}

function grantShield(state, unit, amount, { stack, ...options } = {}) {
  const statusId = actionStatuses.shield;
  const previous = stack ? statusOf(unit, statusId)?.vars?.shieldAmount ?? 0 : 0;
  return grantStatus(state, unit, statusId, { ...options, amount: amount + previous });
}

function concludeObjective(state, outcome, reason) {
  state.battleConclusion = reason;
  state.outcome = outcome;
  record(state, null, 'outcome', `战斗结束：${reason}（${outcome === 'draw' ? '平局' : outcome === 'blue' ? '蓝方获胜' : '红方获胜'}）`, {outcome, reason});
  return outcome;
}
export function encounterNonlethal(state, source) {
  return state.battleType === 'spar' || state.battleType === 'arena';
}
function retireFromContest(state, unit, source) {
  if (unit.fled || unit.hp <= 0) return false;
  const label = state.battleType === 'spar' && unit.hp * 10 < unit.maxHp * 3 ? '生命低于 30%，切磋退场'
    : state.battleType === 'arena' && unit.hp === 1 ? '竞技落败出局'
    : null;
  if (!label) return false;
  unit.fled = true;
  unit.ap = 0;
  record(state, unit, 'yield', `${unit.name}${label}（HP ${unit.hp}/${unit.maxHp}）`, {targetId:unit.id,hp:unit.hp,maxHp:unit.maxHp});
  return true;
}
export function refreshOutcome(state) {
  if (state.battleConclusion) return state.outcome;
  if (['spar','arena'].includes(state.battleType)) for (const unit of living(state)) retireFromContest(state, unit);
  let blue = false, red = false;
  for (const unit of values(state.units)) if (alive(unit) && !unit.fled) {
    blue ||= unit.team === 'blue';
    red ||= unit.team === 'red';
  }
  if (state.battleType === 'suppress') {
    const side = state.suppressingTeam, label = side === 'blue' ? '蓝方' : '红方';
    const defenders = values(state.units).filter(u => u.team !== side);
    const present = defenders.filter(u => alive(u) && !u.fled);
    const dead = defenders.filter(u => !alive(u));
    if (!present.length && defenders.length) return concludeObjective(state,side === 'blue' ? 'red' : 'blue',
      dead.length === defenders.length ? `${label}过失致死，压制失败` : `${label}未能留住目标，压制失败`);
    if ((side === 'blue' ? blue : red) && present.length && present.every(u => u.statuses.suppressed?.vars?.holdTotal != null))
      return concludeObjective(state,side,`${label}压制成功${dead.length ? '，过失致死：'+dead.map(u=>u.name).join('、') : ''}`);
  }
  if (blue && red && state.battleType === 'guard' && state.round > 5) return concludeObjective(state,'blue','守方坚守五轮');
  const result = blue && red ? null : blue ? 'blue' : red ? 'red' : 'draw';
  if (state.outcome !== result) {
    state.outcome = result;
    if (result) record(state, null, 'outcome', result === 'draw' ? '战斗结束：平局' : `战斗结束：${result === 'blue' ? '蓝方' : '红方'}获胜`, { outcome: result });
  }
  return result;
}


function moraleCheck(state) {
  for (const unit of living(state)) {
    if (aggregateModifiers(state, unit.id).controlPolicy.moraleLock === 'steady') {
      if (unit.moraleState && unit.moraleState !== 'steady') {
        unit.moraleState = 'steady';
        record(state, unit, 'morale', `${unit.name}恢复坚守`, { targetId: unit.id, outcome: 'steady', locked: true });
      }
      continue;
    }
    if (unit.protagonist || unit.moraleCheckedRound === state.round) continue;
    const type = unit.moraleType ?? 'standard', rule = MORALE[type];
    const low = unit.hp / unit.maxHp < rule.threshold;
    const impaired = ['shaken','routed'].includes(unit.moraleState);
    if (low === impaired) continue; // Already broken, or healthy and steady.
    const result = moraleResult({type,hp:unit.hp,maxHp:unit.maxHp,d20:low && rule.check ? randomDie(state,20) : undefined});
    unit.moraleCheckedRound = state.round;
    unit.moraleState = result.outcome;
    record(state, unit, 'morale', `${unit.name}${low ? '战意：'+moraleLabels[result.outcome] : '重振战意'}`, {targetId:unit.id,...result,recovered:!low});
  }
}

function restoreHP(state, target, amount, sourceId, label, details = {}) {
  commitVMEffect(state, { op: 'heal', targetId: target.id, amount, sourceId, label, details });
}

function writePoolMirror(state, target, key, current) {
  const pool = target.pools && getPool(state, target.id, key);
  if (pool) updatePoolCurrent(state, pool.id, 'set', current);
  else target[key] = current;
}

function setResourceTotal(state, target, resource, after, sourceUnitId, label) {
  const before = target[resource];
  if (before === after) return;
  writePoolMirror(state, target, resource, after);
  const amount = Math.abs(after - before);
  record(state, sourceUnitId, 'resource', `${target.name}因${label}${after > before ? '恢复' : '消耗'}${amount}点 ${resource.toUpperCase()}`,
    { targetId: target.id, resource, amount, before, after });
}

function baseArmor(state, unit) {
  return (unit.armor ?? 0) + gearFor(state, unit).reduce((sum, g) => sum + (g.template?.defense ?? 0) + (g.template?.armor ?? 0), 0)
    + (unit.shield ? equipmentFor(state, unit.shield).template?.defense ?? 0 : 0);
}

export function unitStandingStats(state, unit) {
  if (!unit) return { armor: 0, dodge: 0 };
  return { armor: Math.max(0, Math.round(modStat(state, unit, 'armor', baseArmor(state, unit)))),
    dodge: Math.round(modStat(state, unit, 'dodge', 0)) };
}

function armorOf(state, unit, damageType, pierce = 0, context = {}) {
  const base = baseArmor(state, unit);
  const ctx = { ...context, target: context.attacker, damageType };
  const armor = Math.max(0, modStat(state, unit, 'armor', base, ctx));
  const flat = typeof pierce === 'object' ? (pierce.flat ?? 0) : pierce;
  const percent = typeof pierce === 'object' ? clamp(pierce.percent ?? 0, -1, 1) : 0;
  const effective = Math.max(0, armor * (1 - percent) - flat);
  return typedArmor(damageType, effective);
}

function damageTarget(state, target, sourceId, amount, damageType, label, options = {}) {
  const source = tableEntry(state.units, sourceId);
  commitVMEffect(state, { op: 'damage', targetId: target.id, sourceId, amount, damageType, label,
    direct: options.direct ?? options.hit ?? false, melee: options.melee ?? false,
    ...(options.details && { details: options.details }),
    lethal: !(options.preserveLife || target.nonLethal || vmFlag(state, target, 'preserveLife') || encounterNonlethal(state, source)) });
}

export function damageAfterFlatReduction(state, unit, amount, context) {
  const { attacker, damageType } = context;
  if (damageType === 'true') return amount;
  return Math.max(0, Math.floor(amount - modStat(state, unit, 'damageReductionFlat', 0, { ...context, target: attacker })));
}

export function mitigation(state, unit, type, hit, pierce, ctx = {}) {
  const shatter = hit ? modStat(state, unit, 'shatter', 0, { damageType: type }) : 0;
  const vulnerability = modStat(state, unit, 'incomingDamageMult', 1, { ...ctx, damageType: type }) - 1;
  const defensiveContext = { ...ctx, target: ctx.attacker, damageType: type };
  const stanceDR = unit?.greatswordMode === 'defensive' && effectiveStance(state, unit) === 'greatsword'
    ? stanceRules('greatsword').defensiveReduction : 0;
  const reduction = type === 'true' ? 0 : clamp(modStat(state, unit, 'damageReduction', stanceDR, defensiveContext), -1, 1);
  const dr = type === 'true' ? 0 : clamp(modStat(state, unit, 'dr', 0, defensiveContext), -1, 1);
  const category = elementMitigationCategory(type, state.customElements);
  const defense = ctx.ignoreArmor || category === 'true' || category === 'mental' ? 0 : armorOf(state, unit, type, pierce, ctx);
  const armorMultiplier = 2000 / (defense + 2000);
  const attributeReduction = state.ruleset === 'protocol' && type !== 'true'
    ? damageAttributeReduction(type, Object.fromEntries(Object.keys(unit.stats ?? {}).map(key => [key, effectiveStat(state, unit, key)])), state.customElements)
    : 0;
  return { shatter, vulnerability, reduction, dr, attributeReduction, category,
    multiplier: (1 + shatter) * (1 + vulnerability) * (1 - reduction),
    armor: defense, armorMultiplier };
}

function guardFor(state, target) {
  return living(state).find(u => u !== target && u.team === target.team && vmFlag(state, u, 'intercept', { target }) &&
    !reactionBlocked(state, u) && near(u, target) <= 1 && Math.abs(elevation(state, u) - elevation(state, target)) <= 1 &&
    clearSight(state, u, target));
}

function endTurn(state, unit) {
  if (!unit) return;
  unit.ap = 0;
  dispatchVMHook(state, 'turn_end', { actorId: unit.id, targetId: unit.id });
  if (state.vm?.pendingAsk) {
    state.vm.endingTurn = unit.id;
    return;
  }
  completeTurnEnd(state, unit);
}

function completeTurnEnd(state, unit, remaining = Object.keys(unit.statuses)) {
  for (const [index, id] of remaining.entries()) {
    const status = statusOf(unit, id);
    if (!status) continue;
    if (status.durationType !== 'battle_turns') continue;
    if (status.appliedRound === state.round && status.appliedTurn === state.turn) continue;
    if (--status.remainingTurns > 0) continue;
    removeVMStatus(state, unit, status, 'expired', unit);
    if (state.vm.pendingAsk) {
      state.vm.endingTurn = unit.id;
      state.vm.endingStatuses = remaining.slice(index + 1);
      return;
    }
  }
  record(state, unit, 'end', `${unit.name}结束回合`);
}

// Automatic skips are bounded even if sandbox commands make every living unit permanently stunned.
export function settleTurn(state) {
  if (state.vm?.pendingAsk) { state.vm.settlingTurn = true; return; }
  if (state.vm) delete state.vm.settlingTurn;
  for (let checked = 0; checked < state.order.length; checked++) {
    const unit = currentUnit(state);
    if (state.outcome) return;
    if (unit && (state.vm?.startingTurn === unit.id || (alive(unit) && !unit.fled))) {
      if (state.vm?.startingTurn !== unit.id) {
        beginUnitTurn(state, unit);
        if (state.vm.pendingAsk) {
          state.vm.startingTurn = unit.id;
          return;
        }
      }
      delete state.vm.startingTurn;
      if (refreshOutcome(state)) { unit.ap = 0; return; }
      if (unit.fled) { advanceCursor(state); if (state.vm?.pendingAsk) { state.vm.settlingTurn = true; return; } continue; }
      if (alive(unit) && !unitSkipped(state, unit)) return;
      if (alive(unit)) record(state, unit, 'skip', `${unit.name}因控制跳过行动`);
      endTurn(state, unit);
      if (state.vm?.pendingAsk || refreshOutcome(state)) return;
    }
    advanceCursor(state);
    if (state.vm?.pendingAsk) { state.vm.settlingTurn = true; return; }
  }
  const stalled = currentUnit(state);
  if (stalled) stalled.ap = 0;
}

function beginUnitTurn(state, unit) {
  delete unit.followupUsed;
  unit.used = { attack: 0, action: 0 };
  unit.moved = 0;
  delete unit.moveSpent;
  unit.reactionAvailable = true;
  unit.ap = unit.apMax = turnAP(state, unit);
  record(state, unit, 'turn', `${unit.name}开始回合`, { turn: state.turn });
  const hold = unit.statuses.suppressed;
  if (hold?.vars?.holdTotal != null) {
    const roll = randomDie(state, 20);
    const total = roll + Math.floor(effectiveStat(state, unit, 'str') * unit.hp / unit.maxHp);
    const success = total > hold.vars.holdTotal;
    if (success) removeVMStatus(state, unit, hold, 'escaped', unit);
    record(state, unit, 'break_hold', `${unit.name}挣脱检定${success ? '成功，解除被压制' : '失败，仍被压制'}（${total} 对 ${hold.vars.holdTotal}）`,
      { roll, total, threshold: hold.vars.holdTotal, success });
  }
  dispatchVMHook(state, 'turn_start', { actorId: unit.id, targetId: unit.id });
}

function turnAP(state, unit) {
  return clamp(Math.floor(modStat(state, unit, 'apMax', 2)), 0, 1000000000);
}

function resetFacing(state) {
  for (const unit of living(state)) {
    const target = unit.statuses[actionStatuses.lock_on] ? state.units[unit.lockedTargetId] : null;
    if (target && alive(target)) unit.facing = signFacing(unit, target);
  }
}
function advanceCursor(state) {
  if (state.turn + 1 < state.order.length) { state.turn++; return; }
  advanceVMRound(state);
}

export function continueRound({ state, frame, host }) {
  if (frame.pc++ === 0) {
    host.hooks(state, frame, 'round_end', host.event(state, { round: state.round }));
    return;
  }
  if (frame.pc === 2) {
    if (refreshOutcome(state)) { state.vm.stack.pop(); return; }
    state.turn = 0; state.round++;
    if (state.spatialTerrain || values(state.zones).length || values(state.units).some(unit => unit.summoned && unit.remainingTurns != null)) advanceVMSpatial(state);
    return;
  }
  state.vm.stack.pop();
  const opening = state.logs.find(log => log.type === 'initiative')?.detail?.initiative;
  // A temporary initiative modifier changes the next round's order. Reuse the
  // opening scores and leave summoned units at the end in their join order.
  const openingRows = opening?.filter(row => state.order.includes(row.unitId)) ?? [];
  const hasModifier = living(state).some(unit => aggregateModifiers(state, unit.id).stats.initiativeFlat);
  const lastChange = state.logs.findLast(log => log.type === 'initiative_order');
  if (openingRows.length && (hasModifier || lastChange?.detail.modified)) {
    const ranked = openingRows.map((row, index) => {
      const unit = state.units[row.unitId];
      const delta = modStat(state, unit, 'initiative', row.flatInit, {}, true) - row.flatInit;
      return { id: row.unitId, total: row.total + delta, index };
    }).sort((a, b) => b.total - a.total || a.index - b.index).map(row => row.id);
    const included = new Set(ranked);
    const order = [...ranked, ...state.order.filter(id => !included.has(id))];
    if (order.some((id, index) => id !== state.order[index])) {
      state.order = order;
      record(state, null, 'initiative_order', '先攻修正改变行动顺序', { order, modified: hasModifier });
    } else if (!hasModifier) {
      record(state, null, 'initiative_order', '先攻修正结束', { order, modified: false });
    }
  }
  resetFacing(state);
  moraleCheck(state);
  if (!refreshOutcome(state)) host.hooks(state, frame, 'round_start', host.event(state, { round: state.round }));
}

export function beginBattle(state) {
  state.logs ??= [];
  state.round = 1;
  state.turn = 0;
  state.outcome = null;
  syncEquipmentEffects(state);
  const initiative = initiativeOrder(state, () => randomDie(state, 20));
  state.order = initiative.map(entry => entry.unitId);
  for (const unit of values(state.units)) {
    unit.stance ??= loadoutStance(state, unit);
    if (unit.stance === 'attunement') unit.attunementCharges ??= stanceRules('attunement').itemCharges;
    unit.ap = 0;
    delete unit.followupUsed;
    unit.used = { attack: 0, action: 0 };
    unit.moved = 0;
    delete unit.moveSpent;
    unit.reactionAvailable = true;
    for (const status of values(unit.statuses)) {
      delete status.appliedRound;
      delete status.appliedTurn;
    }
  }
  record(state, null, 'initiative', '敏捷 + d20：确定先攻次序', { initiative });
  for (const unit of living(state)) for (const status of values(unit.statuses)) {
    record(state, status.sourceId ?? unit.id, 'status', `${unit.name}开场已有${status.name} ×${status.stacks}`,
      { ...statusLogDetail(unit, status), initial: true });
  }
  if (!refreshOutcome(state)) {
    dispatchVMHook(state, 'round_start', { round: state.round });
    if (!refreshOutcome(state)) settleTurn(state);
  }
  return state;
}

function initiativeOrder(state, rollFor) {
  return living(state).map(unit => {
    const roll = rollFor(unit), agility = effectiveStat(state, unit, 'agi');
    const agilityPercent = Number(unit.initiativePercent ?? 0);
    const attackInit = [...(unit.attackInit ?? [])];
    const actionInit = [...(unit.actionInit ?? [])];
    const skills = [...unit.skills.map(id => tableEntry(state.skills, id)), ...equippedActiveSkills(state, unit).map(([, skill]) => skill)];
    for (const skill of skills) {
      if (skill?.initiativeBonus === undefined) continue;
      (skill.slot === 'attack' ? attackInit : actionInit).push(skill.initiativeBonus);
    }
    const flatInit = modStat(state, unit, 'initiative', Number(unit.flatInitiative ?? 0));
    const total = protocolInitiative({ agility, percent: agilityPercent, d20: roll, attack: attackInit, action: actionInit, flat: flatInit });
    return { unitId: unit.id, roll, agility, agilityPercent, attackInit:Math.max(0,...attackInit,0), actionInit:Math.max(0,...actionInit,0), flatInit, total };
  }).sort((a, b) => b.total - a.total || b.agility - a.agility ||
    (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}

// Reuse the opening dice when normalization changes check bonuses before play.
export function refreshOpeningInitiative(state) {
  const [entry, ...following] = state.logs;
  const turn = following.pop();
  if (state.round !== 1 || state.turn !== 0 || entry?.type !== 'initiative' || turn?.type !== 'turn'
    || following.some(log => log.type !== 'status' || !log.detail.initial)) return;
  const previous = entry.detail.initiative;
  if (!Array.isArray(previous) || !currentUnit(state)) return;
  const rolls = new Map(previous.filter(row => row && Number.isInteger(row.roll)).map(row => [row.unitId, row.roll]));
  if (living(state).some(unit => !rolls.has(unit.id) || unitSkipped(state, unit))) return;
  const initiative = initiativeOrder(state, unit => rolls.get(unit.id));
  if (initiative.every((row, i) => row.unitId === previous[i]?.unitId && row.total === previous[i]?.total
      && row.attackInit === previous[i]?.attackInit && row.actionInit === previous[i]?.actionInit)) return;
  currentUnit(state).ap = 0;
  state.order = initiative.map(row => row.unitId);
  entry.detail.initiative = initiative;
  const first = currentUnit(state);
  first.ap = first.apMax = turnAP(state, first);
  state.logs.pop();
  record(state, first, 'turn', `${first.name}开始回合`, { turn: 0 });
}

const locateUnit = (state, { x, y }, targetId, match) => targetId
  ? tableEntry(state.units, targetId)
  : (match ? unitsAt(state, x, y).find(match) : undefined) ?? unitAt(state, x, y);
const locateCover = (state, { x, y }) => coverAt(state, x, y);
const emptyGround = (state, at) => ground(state, at) && !locateUnit(state, at)
  && ((state.scale?.cellM ?? 2) >= 10 || !locateCover(state, at));
const allCells = state => state.grid.flatMap((row, y) => row.map((_, x) => pos(x, y)));

const modifierEvent = (unit, context) => {
  const { target, attacker, ...rest } = context;
  return { ...rest, actorId: attacker?.id ?? rest.actorId ?? unit?.id, targetId: rest.targetId ?? target?.id ?? unit?.id };
};
function modStat(state, unit, name, base, context = {}) {
  const statName = { damage: 'damageMult', healing: 'healingMult', accuracy: 'checkBonus', initiative: 'initiativeFlat' }[name] ?? name;
  return applyStatMod(base, aggregateModifiers(state, unit?.id, modifierEvent(unit, context)).stats[statName]);
}

const activeRule = rule => rule.hook === 'active' && rule.enabled !== false;
export function isPassiveSkill(skill) {
  if (!skill || skill.rules?.some(activeRule)) return false;
  if (skill.passive !== undefined) return skill.passive;
  // Previously exported skills did not carry a mode. Infer only from hooks,
  // never from an empty rules array (unstandardized active placeholders).
  return skill.damage == null && skill.heal == null && Boolean(skill.rules?.some(rule => rule.hook !== 'active'));
}

export function equippedActiveSkills(state, unit) {
  if (!unit) return [];
  const ids = new Set([unit.mainHand, unit.weapon, unit.offHand, unit.shield, ...(unit.gear ?? [])].filter(Boolean));
  const result = new Map();
  for (const id of ids) {
    const { instance, template } = equipmentFor(state, id);
    if (!template || (template.boundTo && template.boundTo !== unit.id)) continue;
    for (const skillId of template.skills ?? []) {
      const skill = tableEntry(state.skills, skillId);
      if (skill && !isPassiveSkill(skill) && !result.has(skillId)) {
        result.set(skillId, { ...skill, quality: template.quality ?? skill.quality, itemInstance: instance });
      }
    }
    // Held consumables activate through use_item, which pays the battle-wide charge.
    if (template.kind === 'consumable') continue;
    for (const rule of itemRules(template, instance).filter(activeRule)) {
      result.set(`equip:${id}:${rule.id}`, { name: rule.label || `${template.name}·${rule.id}`, ap: 0,
        slot: 'action', range: 0, shape: 'single', target: 'self', rules: [rule], itemId: id,
        ...Object.fromEntries(['usesPerBattle', 'usesPerTurn', 'cooldownTurns']
          .filter(key => rule[key] !== undefined).map(key => [key, rule[key]])) });
    }
  }
  return [...result];
}

export function actionSkill(state, unit, id) {
  const equipped = new Map(equippedActiveSkills(state, unit)).get(id);
  const template = equipped ?? tableEntry(state.skills, id);
  return scaledTemplate(state, unit, template, equipped || template?.backpackItem ? 'item' : 'skill');
}
export const syncEquipmentEffects = initializeVMWorld;

function movementScale(state, unit, type) {
  const tier = Math.max(1, Math.min(7, Math.trunc(Number(unit.tier) || 1)));
  const cellM = state.scale?.cellM ?? 2;
  const tierM = TIER_CELL_M[tier];
  // Presets store cells; scaled units store metres. Apply all modifiers once in tier units.
  const base = (unit.moveM ?? unit.move * cellM) / tierM;
  const moveM = Math.max(0, modStat(state, unit, 'movement', base)) * tierM;
  const mult = type === 'sprint' ? 2 : 1;
  const carry = Math.max(0, Math.min(999, Math.trunc(Number(unit.moveCarryPermille) || 0)));
  const total = carry + Math.round(mult * moveM / cellM * 1000);
  const maxBoardSteps = (state.scale?.width ?? 10) + (state.scale?.height ?? 10);
  return { moveM, total, limit: Math.min(maxBoardSteps, Math.floor(total / 1000)) };
}
export function reachable(state, type = 'move', unit = currentUnit(state), distanceLimit = undefined) {
  if (!alive(unit) || aggregateModifiers(state, unit.id).locks.move) return [];
  const scale = movementScale(state, unit, type);
  const spent = unit.moveSpent ?? 0;
  const mult = type === 'sprint' ? 2 : 1;
  const limit = distanceLimit ?? Math.max(0, scale.limit - spent * mult);
  const routes = movementOptions(state, unit, limit, { ignoreZoc: type === 'disengage' });
  if (!routes.length && scale.limit === 0 && distanceLimit === undefined) {
    if (state.scale?.anchorTier >= 5) return [];
    return [{ x: unit.x, y: unit.y, z: elevation(state, unit), steps: 0, path: [], opportunities: [], bankedProgress: scale.total }];
  }
  const sources = type === 'disengage' ? [] : opportunitySources(state, unit).filter(source => canReact(state, source, unit));
  const routeCell = ({ cost, ...cell }, opportunities = []) => ({ ...cell, steps: cost, opportunities });
  if (!sources.length || !routes.length) return routes.map(route => routeCell(route));

  const threatCache = new Map();
  const threatAt = at => {
    const id = key(at.x, at.y);
    if (!threatCache.has(id)) threatCache.set(id, sources.filter(source => threatens(state, source, unit, at)));
    return threatCache.get(id);
  };
  const exits = (from, to) => threatAt(from).filter(source => sameCell(from, source.unit) || !threatAt(to).includes(source));
  const safe = new Map(movementOptions(state, unit, limit, {
    allowsStep: (from, to) => !exits(from, to).length,
  }).map(route => [key(route.x, route.y), route]));
  return routes.map(route => {
    const alternate = safe.get(key(route.x, route.y));
    if (alternate) return routeCell(alternate);
    const spent = new Set(), opportunities = [];
    let from = unit;
    for (const to of route.path) {
      for (const { unit: source } of exits(from, to)) {
        if (spent.has(source.id)) continue;
        spent.add(source.id);
        opportunities.push(opportunityDetail(source, from, to));
      }
      from = to;
    }
    return routeCell(route, opportunities);
  });
}

export function skillAvailability(state, actor, skill, id) {
  let usesLeft = Infinity, cooldownRemaining = 0;
  for (const rule of skill?.rules ?? []) if (rule.hook === 'active' && rule.enabled !== false) {
    const limits = ruleAvailability(state, rule, JSON.stringify([actor.id, id, rule.id]));
    usesLeft = Math.min(usesLeft, limits.usesLeft);
    cooldownRemaining = Math.max(cooldownRemaining, limits.cooldownRemaining);
  }
  return { usesLeft: Number.isFinite(usesLeft) ? usesLeft : null, cooldownRemaining };
}
function actorCost(state, unit, template, skillId) {
  const cost = template.resourceCost;
  const mult = skillId === undefined ? 1 : Math.max(0, modStat(state, unit, 'costMult', 1, { actionType: 'skill', skillId }));
  const scaled = amount => Math.floor(amount * mult);
  return { hp: scaled(cost?.hp ?? 0), mp: scaled(cost?.mp ?? template.mp ?? 0), sp: scaled(cost?.sp ?? template.sp ?? 0) };
}
export const insufficientHP = 'HP 不足，无法施放';

// Split mode assigns an AP to each slot. Two-AP actions occupy both slots.
function paymentError(state, unit, ap, slot, template, { hp, mp, sp }, skill = false) {
  const { locks } = aggregateModifiers(state, unit.id);
  if ((ap === 2 && (locks.attack || locks.action)) || locks[slot] || (skill && (locks.cast || (ap === 0 && locks.action)))) return '对应行动槽已锁定';
  if (ap > 0 && unit.ap < ap) return `需要 ${ap} AP`;
  if (ap > 0 && (ap === 2 ? unit.used.attack || unit.used.action : unit.used[slot])) {
    return '本回合对应的行动槽已使用';
  }
  if (hp > 0 && hp >= unit.hp) return insufficientHP;
  if (unit.mp < mp) return '魔力不足';
  if (unit.sp < sp) return '体力不足';
  const { resource, amount } = template.resourceCost ?? {};
  if (resource) {
    const item = resourcePool(state, unit, resource, template.itemInstance);
    const pool = !item && !template.itemInstance && getPool(state, unit.id, resource);
    if ((item?.amount ?? pool?.current ?? 0) < amount) return item || template.itemInstance ? '装备资源不足' : '自定义资源不足';
  }
  return null;
}

const normalAttack = Object.freeze({ name: '徒手', range: 1.5, rawRange: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' } });
const shieldBashRules = [{ id: 'shield-bash-hit', hook: 'after_hit', program: [
  { op: 'move', target: 'target', mode: 'push', distance: 1 },
  { op: 'apply_status', target: 'target', statusId: actionStatuses.shield_bash, turns: 1 },
] }];
const shieldBashTemplate = { name: '盾击', range: 1, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' }, rules: shieldBashRules };
const isMelee = template => template.rangeType !== 'ranged' && !isRangedMain(template) && (template.rawRange ?? template.range ?? 1.5) <= 2;

const weaponAmmo = template => {
  const pools = Object.entries(template?.pools ?? {}).map(([resource, pool]) => ({ resource, ...pool }));
  return pools.find(pool => pool.resource === 'ammo') ?? pools.find(pool => pool.reloadable);
};
const emptyAmmoMessage = ammo => ammo.reloadable ? '弹仓已空，请装填' : '弹药已耗尽';

export function weaponInfo(state, unit) {
  const mainId = unit.mainHand ?? unit.weapon;
  const candidate = equipmentFor(state, mainId);
  const weapon = candidate.template?.boundTo && candidate.template.boundTo !== unit.id ? equipmentFor(state, null) : candidate;
  weapon.template = scaledTemplate(state, unit, weapon.template, 'weapon');
  const ammo = weaponAmmo(weapon.template);
  const ammoCount = ammo ? resourcePool(state, unit, ammo.resource, weapon.instance)?.amount : null;
  const infiniteAmmo = vmFlag(state, unit, 'infiniteAmmo');
  const offHand = equipmentFor(state, unit.offHand);
  offHand.template = scaledTemplate(state, unit, offHand.template, 'weapon');
  const stance = effectiveStance(state, unit);
  const template = weapon.template ?? (() => {
    const unarmed = scaledTemplate(state, unit, normalAttack, 'weapon');
    unarmed.range = Math.min(1, unarmed.range);
    return unarmed;
  })();
  return { ...weapon, ammo, ammoCount, infiniteAmmo, offHand, stance, template };
}

function reaches(state, actor, at, template, ammo) {
  const dz = elevation(state, actor) - elevation(state, at);
  const melee = isMelee(template) && !ammo;
  const baseRange = template.range ?? 1.5;
  const range = baseRange + (baseRange === 0 || melee || !dz ? 0 : dz > 0 ? (template.vars?.highGroundRange ?? 1) : -1);
  const offset = incomingDistanceOffset(state, actor, at, { checkKind: 'attack' });
  return { distance: distance(state, actor, at) + offset, dz, range: Math.max(0, range), melee };
}

function validReach(state, actor, at, template, ammo) {
  const geometry = reaches(state, actor, at, template, ammo);
  return ground(state, at) && geometry.distance <= geometry.range + 1e-9 && clearSight(state, actor, at);
}

export function visibleEnemy(state, actor, target) {
  return target.team !== actor.team && (!vmFlag(state, target, 'hidden', { attacker: actor }) || (near(actor, target) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target)) <= 1));
}

function tauntFor(state, actor, template, ammo) {
  for (const status of values(actor.statuses).filter(status => status.mods?.some(mod => mod.flags?.includes('taunted'))).sort(byId)) {
    const source = tableEntry(state.units, status.sourceId);
    if (alive(source) && !source.fled && visibleEnemy(state, actor, source) && validReach(state, actor, source, template, ammo)) return source;
  }
  return null;
}

// Threat is the limited melee reach around the reactor used for opportunity attacks.
// Root does not prevent attacking; stun and freeze do. A missing charge means ready
// for snapshots written before opportunity attacks existed.
function opportunitySources(state, mover) {
  return living(state).filter(unit => unit.team !== mover.team && unit.reactionAvailable !== false && !reactionBlocked(state, unit))
    .map(unit => ({ unit, weapon: weaponInfo(state, unit) }))
    .filter(({ weapon }) => !weapon.ammo && isMelee(weapon.template) && weapon.template.damage != null);
}

function canReact(state, { unit, weapon }, mover) {
  if (!alive(unit) || unit.reactionAvailable === false || reactionBlocked(state, unit)) return false;
  const taunter = tauntFor(state, unit, weapon.template);
  return !taunter || taunter.id === mover.id;
}

function threatens(state, source, mover, at) {
  const template = source.weapon.template;
  const rawReach = template.rawRange ?? 1;
  const zocRange = Math.min(template.range ?? 0, Math.max(1, Math.floor(rawReach + 1e-9)));
  return visibleEnemy(state, source.unit, { ...mover, x: at.x, y: at.y }) &&
    validReach(state, source.unit, { ...at, altitude:mover.altitude }, { ...template, range: zocRange });
}

const opportunityDetail = (source, from, to) => ({ unitId: source.id, name: source.name,
  from: pos(from.x, from.y), to: pos(to.x, to.y) });

function area(state, actor, center, template, ammo, { ignoreRange, ignoreLOS, deferGeometry }) {
  const selfCentered = template.range === 0 && sameCell(actor, center);
  return aoeCells(state, actor, center, {
    ...template,
    radius: selfCentered ? template.radius ?? 1.5 : template.radius,
    range: at => ignoreRange || deferGeometry ? Infinity : reaches(state, actor, at, template, ammo).range,
    ignoreAimRange: ignoreRange || deferGeometry,
    ignoreLOS: ignoreLOS || deferGeometry,
  });
}

function selectionAllows(state, template, actor, unit, allowFriendlyTarget = false) {
  if (!unit) return false;
  if ((template.shape ?? 'single') === 'single' && unit.team !== actor.team &&
    aggregateModifiers(state, unit.id, modifierEvent(unit, { attacker: actor, target: unit })).flags.untargetableSingle) return false;
  switch (template.target ?? 'enemy') {
    case 'enemy': return allowFriendlyTarget || actor.team !== unit.team;
    case 'ally': return actor.team === unit.team;
    case 'self': return actor.id === unit.id;
    case 'cell': return false;
    default: return true;
  }
}

function diceFormula(state, spec, actor) {
  if (typeof spec === 'number') return { count: 0, sides: 0, bonus: spec };
  const count = spec?.count ?? 1, sides = spec?.sides ?? 1;
  return { count, sides, bonus: Math.floor((spec?.bonus ?? 0) + effectiveStat(state, actor, spec?.stat) * (spec?.multiplier ?? 1)) };
}
function diceBounds(dice, critical = false) {
  const count = critical ? dice.count * 2 : dice.count;
  return [Math.max(0, count + dice.bonus), Math.max(0, count * dice.sides + dice.bonus)];
}
// Cache distributions by die shape only. Bonuses, mitigation and target state stay live.
const oddsCache = new Map();
function diceAverage(dice, map, critical = false) {
  const count = critical ? dice.count * 2 : dice.count;
  const key = `${count}d${dice.sides}`;
  let probabilities = oddsCache.get(key);
  if (!probabilities) {
    probabilities = [1];
    for (let die = 0; die < count; die++) {
      const next = Array(probabilities.length + dice.sides).fill(0);
      let window = 0;
      for (let i = 1; i < next.length; i++) {
        window += (probabilities[i - 1] ?? 0) - (probabilities[i - dice.sides - 1] ?? 0);
        next[i] = Math.max(0, window / dice.sides);
      }
      probabilities = next;
    }
    if (oddsCache.size >= 64) oddsCache.delete(oddsCache.keys().next().value);
    oddsCache.set(key, probabilities);
  }
  return probabilities.reduce((sum, probability, raw) => sum + probability * map(Math.max(0, raw + dice.bonus)), 0);
}
function diceRoll(state, formula, critical = false) {
  const count = critical ? formula.count * 2 : formula.count;
  const { rng, rolls, total } = rollDice(state.rng, count, formula.sides);
  state.rng = rng;
  return { rolls, ...formula, value: Math.max(0, total + formula.bonus) };
}

const hasStrikeDamage = template => template.damage != null;
const flatDice = value => ({ rolls: [], count: 0, sides: 0, bonus: value, value });

function resolveArmorPierce(state, actor, template, weapon, strike) {
  const rules = stanceRules(weapon?.stance ?? actor.stance ?? 'unarmed');
  return { flat: modStat(state, actor, 'armorPierce', template.armorPierce ?? 0, strike),
    percent: clamp(modStat(state, actor, 'armorPiercePercent', rules.armorPenetration ?? 0, strike), -1, 1) };
}

function targetProfile(state, actor, target, at, template, context = {}) {
  const { weapon, origin = actor, teleport, cover = false } = context;
  const geometry = reaches(state, origin, at, template, weapon?.ammo);
  const arrow = Boolean(weapon?.ammo);
  const arc = target && !cover ? facingArc(target, origin) : 'front';
  const backstab = !cover && arc !== 'front' && geometry.melee;
  const intent = context.intent ?? 'normal';
  const strike = { target, distance: geometry.distance, melee: geometry.melee, arrow, backstab, highGround: geometry.dz > 0,
    weaponId: weapon?.instance?.id, actionType: weapon ? 'attack' : 'skill', skillId: context.skillId, school: template.school,
    damageType: template.damage?.type ?? template.damageType, weaponTemplateId: weapon?.instance?.templateId,
    checkKind: 'attack', intent, stat: template.damage?.stat ?? template.stat ?? (geometry.melee ? 'str' : 'agi') };
  const flags = aggregateModifiers(state, actor.id, modifierEvent(actor, strike)).flags;
  const guaranteeCrit = hasStrikeDamage(template) && Boolean(flags.guaranteed_crit);
  const guaranteeHit = hasStrikeDamage(template) && Boolean(guaranteeCrit || flags.guaranteed_hit);
  const execution = !cover && target?.team !== actor.team && ['shaken','routed'].includes(target?.moraleState) && ['kill','concept'].includes(context.intent) && hasStrikeDamage(template);
  const dodge = execution || cover || !target ? 0 : modStat(state, target, 'dodge', 0, { ...strike, attacker: actor });
  const highGroundBonus = equipmentFor(state, strike.weaponId ?? actor.mainHand ?? actor.weapon).template?.vars?.highGroundAccuracy ?? 0;
  const high = Math.sign(geometry.dz) * 2 + (geometry.dz > 0 ? highGroundBonus : 0);
  const flanked = target && !cover ? flank(state, origin, target) : false;
  const protectedBy = target && !cover && !geometry.melee ? coverBetween(state, origin, target) : null;
  const penalty = protectedBy?.cover ?? 0;
  const size = cover ? 0 : typeof target?.size === 'number' ? Math.max(0, target.size - 1) : target?.size === 'large' ? 2 : target?.size === 'small' ? -1 : 0;
  const sizeModifier = cover || !target ? 0 : sizeHitModifier(actor, target);
  const sizeAccuracy = size + sizeModifier;
  // A pure ranged weapon suffers the point-blank penalty in a shared cell;
  // close-quarters weapons keep the normal melee bonus. Spells use their
  // effective range tiers for distance lookup, but point-blank spells remain
  // ordinary close combat rather than inheriting a bow's penalty.
  const rangedWeapon = Boolean(weapon && (isRangedMain(template) || weapon.ammo));
  const rangedCarrier = Boolean(!weapon && !geometry.melee && (template.range ?? 0) > 0);
  const pointBlank = geometry.distance === 0 && rangedWeapon;
  const lookupDistance = (weapon || rangedCarrier) && template.rawRange != null
    ? (geometry.distance / Math.max(6, geometry.range)) * 6 : geometry.distance;
  const distanceModifier = pointBlank ? (template.closeQuarters ? 0 : -4) : distanceTier(lookupDistance).hit;
  const weaponRangeModifier = distanceTier(Math.max(geometry.distance, geometry.range)).range;
  const stance = weapon?.stance ?? effectiveStance(state, actor);
  const rules = stanceRules(stance);
  const rangedDistance = weapon && !geometry.melee && geometry.distance > 0 && distanceModifier < 0
    ? Math.min(0, distanceModifier + (rules.rangedPenaltyOffset ?? 0)) : distanceModifier;
  const closeRange = rules.closeRange && geometry.melee && geometry.distance <= 2 ? 4 : rangedDistance;
  // The protocol does not grant an implicit STR/AGI-to-hit bonus. Associated attributes
  // belong in the damage formula; hit comes from explicit weapon/skill and combat modifiers.
  const sandboxStat = state.ruleset === 'sandbox' ? effectiveStat(state, actor, geometry.melee ? 'str' : 'agi') : 0;
  const morale = moraleModifiers[actor.moraleState]?.accuracy ?? 0;
  const incomingAccuracy = execution || cover || !target ? 0 : modStat(state, target, 'incomingAccuracy', 0, { attacker: actor });
  const flankedBonus = flanked ? 2 : 0;
  const baseAccuracy = (template.accuracy ?? 0) + sandboxStat + high + sizeAccuracy + closeRange
    + (state.ruleset === 'sandbox' ? 0 : weaponRangeModifier) + morale + incomingAccuracy + flankedBonus - penalty;
  const attackAccuracy = modStat(state, actor, 'accuracy', baseAccuracy, strike);
  const checkBonus = attackAccuracy - baseAccuracy;
  const accuracy = attackAccuracy - dodge;
  const equipmentDefense = gearFor(state, target).reduce((d, g) => d + (g.template?.defense ?? 0), 0)
    + (target.shield ? equipmentFor(state, target.shield).template?.defense ?? 0 : 0);
  // Protocol mode has no implicit AGI-to-defense; sandbox keeps its legacy balance only for regression fixtures.
  const defense = cover ? 8 : state.ruleset === 'sandbox'
    ? 10 + Math.floor(effectiveStat(state, target, 'agi') / 2) + equipmentDefense
    : 4;
  const delta = modStat(state, actor, 'advantage', 0, strike);
  const advantages = Math.max(0, delta) + Number(Boolean(teleport)) + (template.advantage ?? 0);
  const disadvantages = Math.max(0, -delta) + (template.disadvantage ?? 0);
  const advantage = Math.sign(advantages - disadvantages);
  const saveStat = !cover && target ? template.save : null;
  const saveDC = saveStat ? (resolveDC(state, actor, template.saveDC ?? 12 + Math.floor(effectiveStat(state, actor, 'int') / 2))
    + modStat(state, actor, 'dcBonus', 0, { target, checkKind: 'save', stat: saveStat })) : null;
  const saveContext = { attacker: actor, target, checkKind: 'save', stat: saveStat };
  const saveBonus = saveStat ? effectiveStat(state, target, saveStat)
    + modStat(state, target, 'resistBonus', 0, saveContext)
    + modStat(state, target, 'checkBonus', 0, saveContext) : 0;
  const saveChance = saveStat ? saveOdds(saveDC, saveBonus) : 0;
  const areaStrike = hasStrikeDamage(template) && (template.shape ?? 'single') !== 'single';
  const automatic = areaStrike || !weapon && (!template.damage || saveStat || template.autoHit);
  const hitChance = automatic || guaranteeHit ? 1 : saveOdds(4, accuracy, advantages, disadvantages)
    - (accuracy + 1 >= 4 ? 1 - saveOdds(2, 0, advantages, disadvantages) : 0);
  const critChance = saveStat ? 0 : guaranteeCrit ? 1 : automatic ? 0 : criticalOdds(advantages, disadvantages);
  const loadout = weapon ?? (context.skillId && template.damage && actor.stance === 'dual_wield' ? weaponInfo(state, actor) : null);
  const off = loadout?.offHand;
  const combo = template.tags?.some(tag => /多段|连击/.test(tag));
  const offAttack = loadout?.stance === 'dual_wield' && off?.template?.damage && validReach(state, actor, at, off.template, weaponAmmo(off.template))
    ? (off.template.attack ?? 0) * (combo ? rules.comboOffHandDamage : rules.offHandDamage) : 0;
  const mainAttack = Number(loadout?.template?.attack ?? 0);
  const weaponAttack = mainAttack * (stance === 'greatsword' ? (actor.greatswordMode === 'defensive' ? rules.defensiveDamage : rules.offensiveDamage) : 1) + offAttack;
  const intentSpec = INTENTS[intent] ?? INTENTS.normal;
  // Intent is applied once in applyStrike after the intent contest; do not fold it into this preview multiplier.
  const damageType = template.damage?.type ?? template.damageType ?? 'physical';
  const sandboxDual = state.ruleset === 'sandbox' && weapon?.stance === 'dual_wield' && off?.template?.damage;
  const multiplier = (sandboxDual ? 0.75 : 1) * (teleport ? 1 + (teleport.bonusMultiplier ?? .5) : 1);
  const tierPower = ({1:2, 2:2.8, 3:4, 4:8, 5:15, 6:35, 7:80})[actor.tier ?? 1] ?? 2;
  const attributeBase = () => state.ruleset === 'protocol'
    ? effectiveStat(state, actor, template.damage.stat ?? (geometry.melee ? 'str' : 'int')) * 10 * tierPower
    : Math.floor(effectiveStat(state, actor, template.damage.stat) * (template.damage.multiplier ?? 1));
  const protocolInitial = state.ruleset === 'protocol' && template.damage
    ? attributeBase() + Number(template.power ?? 20) + weaponAttack : null;
  const armorPierce = resolveArmorPierce(state, actor, template, weapon, strike);
  const recipient = cover || !hasStrikeDamage(template) ? target : guardFor(state, target) ?? target;
  const reduction = cover ? { multiplier: 1, armor: target.armor ?? 0 }
    : mitigation(state, recipient, damageType, true, armorPierce,
      { ...strike, attacker: actor, targetId: recipient.id, intercepting: recipient !== target });
  const absorb = cover ? 0 : shieldTotal(recipient);
  const dice = template.damage == null ? null : diceFormula(state, template.damage, actor);
  const strikeEvent = { ...strike, damageType };
  const outgoing = aggregateModifiers(state, actor.id, modifierEvent(actor, strikeEvent)).stats;
  const flatDamage = applyStatMod(0, outgoing.damageFlat);
  const flatReduction = cover || damageType === 'true' ? 0 : modStat(state, recipient, 'damageReductionFlat', 0,
    { ...strikeEvent, attacker: actor, target: recipient, intercepting: recipient !== target });
  const shown = (raw, factor = 1) => {
    const scaled = Math.floor(applyStatMod(raw * multiplier * factor + flatDamage, outgoing.damageMult));
    if (cover) return Math.max(0, scaled - (target.armor ?? 0));
    const modified = Math.max(0, Math.floor(scaled * reduction.multiplier * reduction.armorMultiplier * (1 - reduction.attributeReduction)));
    const mitigated = Math.max(0, Math.floor(modified - flatReduction)) * (1 - reduction.dr);
    return Math.max(0, Math.floor(applyStatMod(mitigated, outgoing.finalDamageMult)) - absorb);
  };
  const flat = protocolInitial !== null;
  const bounds = (critical = false, factor = 1) => (flat ? [protocolInitial, protocolInitial] : diceBounds(dice, critical)).map(n => shown(n, factor));
  const average = (critical = false, factor = 1) => flat ? shown(protocolInitial, factor) : diceAverage(dice, n => shown(n, factor), critical);
  const minFactor = execution ? 1.3 : 1;
  const damage = dice ? (protocolInitial == null ? bounds(false,minFactor) : [shown(protocolInitial,minFactor), shown(protocolInitial,minFactor)]) : [0, 0];
  const criticalDamage = dice && critChance > 0 ? bounds(true) : null;
  const savedDamage = dice && saveStat ? bounds(false, .5) : null;
  const expectedDamage = !dice ? 0 : Math.max(0, hitChance - critChance - saveChance) * average()
    + (criticalDamage ? critChance * average(true) : 0)
    + (savedDamage ? saveChance * average(false, .5) : 0);
  const expectedD20 = saveStat ? 10.5 : automatic ? null : advantage > 0 ? 13.825 : advantage < 0 ? 7.175 : 10.5;
  return { id: target.id, targetId: target.id, name: target.name, x: at.x, y: at.y, ...geometry,
    ruleset: state.ruleset ?? 'protocol', kind: cover ? 'cover' : 'unit', attackAccuracy,
    recipientId: recipient.id, arc, backstab: Boolean(backstab), flanked, accuracy, defense, highGround: high,
    sizeModifier, distanceModifier: closeRange, weaponRangeModifier, stance, stanceRules: rules,
    accuracySources: { explicit: template.accuracy ?? 0, highGround: high, size: sizeAccuracy, distance: closeRange, weaponRange: weaponRangeModifier, status: checkBonus + morale,
      checkBonus, morale, incomingAccuracy, flanked: flankedBonus, cover: 0 - penalty, ...(sandboxStat && { statBonus: sandboxStat }) },
    ...(context.skillId && { skillId: context.skillId }), ...(weapon?.instance?.id && { weaponId: weapon.instance.id }),
    stat: template.damage?.stat ?? template.stat ?? (geometry.melee ? 'str' : 'agi'), intent, intentDifficulty: intentSpec.difficulty, intentMultiplier: intentSpec.multiplier,
    cover: penalty, coverId: protectedBy?.id ?? null, advantage, advantages, disadvantages, hitChance, critChance, expectedD20,
    automatic: Boolean(automatic), ...(areaStrike && !saveStat && { skipHitCheck: true }), execution, guaranteeHit, guaranteeCrit, arrow, saveStat, saveDC, saveBonus, saveChance, multiplier, damageType, armorPierce, protocolInitial,
    dodgeBonus: dodge,
    damageMultiplier: modStat(state, actor, 'damage', multiplier, { ...strike, damageType }),
    offHand: Boolean(weapon?.offHand?.template), armor: reduction.armor, damagePipeline: reduction.armorMultiplier,
    shield: absorb, damage, damageMin: damage[0], damageMax: damage[1], fixedDamage: false, criticalDamage,
    savedDamage, expectedDamage, dice };
}

const ACTIONS = Object.freeze({
  move: { ap: 1, slot: 'action' }, sprint: { ap: 2, slot: 'action' }, disengage: { ap: 1, slot: 'action' },
  end_encounter: {ap:0,slot:null}, switch_weapon: { ap: 0, slot: null }, attack: { ap: 1, slot: 'attack' }, reload: { ap: 1, slot: 'action' },
  stance_mode: { ap: 0, slot: null }, brace: { ap: 1, slot: 'action' }, block: { ap: 1, slot: 'action' }, shield_bash: { ap: 1, slot: 'attack', sp: 2 }, use_item: { ap: 0, slot: null },
  charge: { ap: 1, slot: 'action' }, lock_on: { ap: 1, slot: 'action' }, scan: { ap: 1, slot: 'action' },
  free_ally: { ap: 1, slot: 'attack' }, suppress: { ap: 1, slot: 'attack' }, grapple: { ap: 1, slot: 'attack' }, disarm: { ap: 1, slot: 'attack' }, trip: { ap: 1, slot: 'attack' }, push: { ap: 1, slot: 'attack' },
  flee: { ap: 1, slot: 'action' }, interact: { ap: 1, slot: 'action' }, end: { ap: 0, slot: null },
});
const movementNames = Object.freeze({ move: '移动', sprint: '疾跑', disengage: '撤离' });
const isMovement = type => Object.hasOwn(movementNames, type);
export const isTapeAction = type => type === 'skill' || (Object.hasOwn(ACTIONS, type) && type !== 'end' && type !== 'end_encounter');
export const isStrikeAction = (action, plan) => ['attack', 'skill', 'shield_bash'].includes(action.type) && !plan.interactiveId;
export const needsTarget = type => isMovement(type) || ['attack', 'skill', 'shield_bash', 'interact', 'lock_on', 'free_ally', 'suppress', 'grapple', 'disarm', 'trip', 'push'].includes(type);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const healMultiplier = (state, actor) => modStat(state, actor, 'healing', 1, { actionType: 'skill' });
function inInteractionRange(state, actor, at) {
  return near(actor, at) <= 1 && Math.abs(elevation(state, actor) - elevation(state, at)) <= 1 && clearSight(state, actor, at);
}
function nearbyCovers(state, at) {
  return values(state.covers).filter(c => c.hp > 0 && inInteractionRange(state, at, c)).sort(byId);
}

function usableTiles(state, actor, template, weapon) {
  const allowFriendlyTarget = aggregateModifiers(state, actor.id).controlPolicy.allowFriendlyTarget === true;
  return allCells(state).filter(at => validReach(state, actor,
    template.target === 'cell' || (template.shape ?? 'single') !== 'single' ? at
      : locateUnit(state, at, null, u => selectionAllows(state, template, actor, u, allowFriendlyTarget)) ?? at,
    template, weapon?.ammo));
}
function shapeTargets(state, actor, cells, template, aim, origin, ammo, ignoreRange, ignoreLOS, allowFriendlyTarget, targetId) {
  const keys = new Set(cells.map(at => key(at.x, at.y)));
  if (template.target === 'cell') return [];
  const areaDamage = (template.shape ?? 'single') !== 'single' && hasStrikeDamage(template);
  const targeting = areaDamage && template.target == null ? { target: 'any' } : template;
  return living(state).filter(unit => {
    if (!selectionAllows(state, targeting, actor, unit, !areaDamage && allowFriendlyTarget)) return false;
    if ((template.shape ?? 'single') === 'single') return targetId ? unit.id === targetId : sameCell(unit, aim);
    if (template.shape === 'circle' || template.shape === 'ring') {
      const distanceFromCenter = distance(state, aim, unit) + incomingDistanceOffset(state, actor, unit, { checkKind: 'attack' });
      return distanceFromCenter <= (template.radius ?? 1.5) + 1e-9 && (ignoreLOS || clearSight(state, aim, unit))
        && (template.shape !== 'ring' || (!sameCell(unit, aim) && distanceFromCenter >= (template.innerRadius ?? 0) - 1e-9));
    }
    const radius = template.radius ?? (template.range === 0 ? 1.5 : null);
    const geometry = reaches(state, origin, unit, template, ammo);
    return keys.has(key(unit.x, unit.y)) && (ignoreLOS || clearSight(state, origin, unit))
      && (radius == null ? ignoreRange || geometry.distance <= geometry.range + 1e-9 : geometry.distance <= radius + 1e-9);
  });
}

/** With no x/y, queries highlighting. With both coordinates, validates one executable action. */
export function preview(state, action, { simulateRules = true, actionOrigin, ignoreRange = false, ignoreLOS = false, deferGeometry = false, limitClock = state } = {}) {
  if (state.outcome) return fail('战斗已经结束');
  const unit = currentUnit(state);
  if (!alive(unit) && action?.type !== 'end') return fail('当前单位不能行动');
  if (!action || typeof action !== 'object' || Array.isArray(action)) return fail('动作格式错误');
  const { type, skillId } = action;
  let { x, y } = action;
  if (!Object.keys(action).every(field => (type === 'switch_weapon' && field === 'itemId') || ['type', 'x', 'y', 'targetId', 'skillId', 'bonusDice', 'intent', 'nonLethal', 'maneuver'].includes(field))) return fail('动作含未知字段');
  if (action.bonusDice !== undefined && (!Number.isInteger(action.bonusDice) || action.bonusDice < 0 || action.bonusDice > Math.min(2, unit?.bonusDice ?? 0))) return fail('奖励骰储备不足');
  if (action.intent !== undefined && !['normal','function','core','kill','concept'].includes(action.intent)) return fail('意图类型无效');
  const equipmentSkill = type === 'skill' ? new Map(equippedActiveSkills(state, unit)).get(skillId) : null;
  const skill = type === 'skill' ? actionSkill(state, unit, skillId) : null;
  if (skill?.backpackItem) {
    if (!(unit.inventory?.[skillId] > 0)) return fail('背包物品数量不足');
    if (!skill.damage && !skill.heal && !skill.rules?.some(rule => rule.hook === 'active' && rule.enabled !== false && rule.program.length)) return fail('背包物品尚无可执行效果，请先标准化');
  } else if (type === 'skill' && (!skill || (!equipmentSkill && !unit.skills.includes(skillId)))) return fail('单位没有此技能');
  if (isPassiveSkill(skill)) return fail('被动技能不能主动施放');
  if (skill?.itemId && x === undefined && y === undefined) ({ x, y } = unit);
  const availability = skill ? skillAvailability(limitClock, unit, skill, skillId) : {};
  if (availability.usesLeft === 0) return fail('技能次数已用尽', availability);
  if (availability.cooldownRemaining > 0) return fail(`技能冷却中，还需 ${availability.cooldownRemaining} 轮`, availability);
  if (type === 'flee' && !atBattleEdge(state,unit)) return fail('须先移动到战场边界才能逃跑');
  const cost = skill ?? tableEntry(ACTIONS, type);
  if (!cost) return fail('未知动作');
  const aimed = needsTarget(type);
  const unplaced = x === undefined && y === undefined;
  if (type !== 'skill' && skillId !== undefined || (!unplaced && !aimed)) return fail('动作带有不适用的参数');
  if (!unplaced && (!Number.isInteger(x) || !Number.isInteger(y) || !tileAt(state, x, y))) return fail('目标坐标超出棋盘');
  if (type === 'interact' && unplaced) {
    const cells = values(state.interactives).filter(v => !v.spent && preview(state, {type, x:v.x, y:v.y}).ok).sort(byId).map(v => pos(v.x,v.y));
    return cells.length ? {ok:true, ap:1, cost:1, cells} : fail('没有可用的互动点', {cells});
  }
  const item = !unplaced && (type === 'interact' || type === 'attack') ? values(state.interactives).find(v => !v.spent && v.x === x && v.y === y) : null;
  const detonate = item?.kind === 'barrel';
  const drawFromBag = type === 'switch_weapon' && unit.bagWeapons?.includes(action.itemId);
  const ap = drawFromBag ? 1 : cost.ap, slot = ap === 0 ? null : drawFromBag ? 'action' : detonate ? 'attack' : cost.slot;
  const resourceCosts = actorCost(state, unit, cost, type === 'skill' ? skillId : undefined);
  const common = { ok: true, ap, cost: ap, slot, ...resourceCosts, ...availability };
  if (type === 'end') return common;
  if (type === 'end_encounter') return ['spar','arena'].includes(state.battleType)
    ? {...common,name:state.battleType === 'spar' ? '叫停切磋（平局）' : '全队认输'} : fail('本场不能直接叫停或认输');
  if (unitSkipped(state, unit)) return fail('当前单位受控制，只能结束回合');
  const cannotPay = paymentError(state, unit, ap, slot, cost, resourceCosts, type === 'skill');
  if (cannotPay) return fail(cannotPay, { ap, ...availability });
  const center = unplaced ? undefined : pos(x, y);
  const weapon = weaponInfo(state, unit);
  if (type === 'switch_weapon') {
    if (!switchableWeapons(state, unit).includes(action.itemId)) return fail('没有可切换的武器');
    return { ...common, itemId: action.itemId, name: `${unit.bagWeapons?.includes(action.itemId) ? '从背包换装' : '切换武器'}：${equipmentFor(state, action.itemId).template.name}` };
  }
  if (type === 'shield_bash' && !unit.shield) return fail('没有盾牌');
  if (type === 'reload') {
    if (!weapon.ammo?.reloadable || weapon.infiniteAmmo) return fail('当前武器不需要装填');
    if (weapon.ammoCount >= weapon.ammo.cap) return fail('弹仓已满');
    return { ...common, ammo: weapon.ammoCount, capacity: weapon.ammo.cap };
  }
  if (type === 'stance_mode') {
    if (weapon.stance !== 'greatsword' || !['offensive','defensive'].includes(action.maneuver) || action.maneuver === (unit.greatswordMode ?? 'offensive')) return fail('当前不能切换该重剑态势');
    if (unit.used.attack || unit.used.action || unit.moved) return fail('只能在回合开始行动前切换重剑态势');
    return { ...common, name: action.maneuver === 'defensive' ? '转为沉势' : '转为攻势' };
  }
  if (type === 'block') {
    const stance = effectiveStance(state, unit);
    if (stance !== 'sword_shield') return fail('只有剑盾姿态可格挡');
    const rules = stanceRules(stance);
    return { ...common, name: '格挡', reduction: action.maneuver === 'heavy' ? rules.heavyBlockReduction : rules.blockReduction, turns: 1 };
  }
  if (type === 'brace') {
    const [nearbyCover] = nearbyCovers(state, unit);
    return { ...common, name: '架势防御', coverId: nearbyCover?.id ?? null, reduction: getStatusTemplate(state, actionStatuses.brace).vars?.reduction ?? 0,
      turns: nearbyCover ? 2 : 1 };
  }
  if (type === 'use_item') {
    const item = equipmentFor(state, unit.offHand);
    if (unit.stance !== 'attunement' || item.template?.kind !== 'consumable') return fail('只有同调姿态可以免费使用副手道具');
    if ((unit.attunementCharges ?? 0) <= 0) return fail('同调道具次数已用尽');
    const rules = itemRules(item.template, item.instance).filter(activeRule);
    if (!rules.some(rule => {
      const { usesLeft, cooldownRemaining } = ruleAvailability(state, rule, JSON.stringify([unit.id, unit.offHand, rule.id]));
      return rule.program.length && usesLeft > 0 && !cooldownRemaining;
    })) return fail('副手道具没有可执行的主动效果');
    return { ...common, name: `使用${item.template.name}`, maneuver: 'use_item', itemId: unit.offHand, rules };
  }
  if (type === 'charge') return { ...common, name: '蓄力', maneuver: 'charge' };
  if (type === 'scan') return { ...common, name: '探察', maneuver: 'scan' };

  if (type === 'flee') return { ...common, name: '逃跑', maneuver: 'flee' };
  if (type === 'lock_on') {
    const target = locateUnit(state, center, action.targetId, u => u.team !== unit.team);
    if (!target || target.team === unit.team || !sameCell(target, center)) return fail('定位必须指定敌方单位');
    return { ...common, name: '定位', maneuver: 'lock_on', targetId: target.id };
  }
  if (type === 'free_ally') {
    if (state.battleType !== 'suppress' || unit.team === state.suppressingTeam || unit.statuses.suppressed || unit.fled) return fail('仅未被压制的抵抗方可以救援');
    const allies = living(state).filter(t => t !== unit && t.team === unit.team && t.statuses.suppressed && distance(state,unit,t)<=1 && clearSight(state,unit,t));
    if (!center) return {...common,cells:allies.map(t=>pos(t.x,t.y))};
    const ally = allies.find(t=>t.id === action.targetId && sameCell(t,center)) ?? allies.find(t=>sameCell(t,center));
    return ally ? {...common,name:'解除压制',targetId:ally.id} : fail('需要贴近一格内被压制的队友');
  }
  if (type === 'suppress') {
    if (state.battleType !== 'suppress' || unit.team !== state.suppressingTeam) return fail('仅压制方可以使用压制');
    const available = living(state).filter(t => t.team !== unit.team && t.statuses.suppressed?.vars?.holdTotal == null && distance(state,unit,t)<=1 && visibleEnemy(state,unit,t) && clearSight(state,unit,t));
    if (!center) return {...common,cells:available.map(t=>pos(t.x,t.y))};
    const target = available.find(t=>t.id === action.targetId && sameCell(t,center)) ?? available.find(t=>sameCell(t,center));
    if (!target) return fail('压制需要一格内可见且未被压制的敌人');
    const profile = targetProfile(state,unit,target,target,normalAttack);
    return {...common,name:'压制',targetId:target.id,targets:[{...profile,damage:null,expectedDamage:0}]};
  }
  if (['grapple','disarm','trip','push'].includes(type)) {
    const target = locateUnit(state, center, action.targetId, u => u.team !== unit.team);
    if (!target || target.team === unit.team || !sameCell(target, center)) return fail('战术对抗必须指定敌方单位');
    if (type === 'disarm' && !(target.mainHand ?? target.weapon)) return fail('目标没有可缴械的主手武器');
    if (near(unit, target) > 1 || !clearSight(state, unit, target)) return fail('战术对抗需要贴身且视线畅通');
    return { ...common, name: ({ grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞' })[type], maneuver: type, targetId: target.id };
  }
  if (isMovement(type)) {
    if (aggregateModifiers(state, unit.id).locks.move) return fail('定身时不能移动');
    const cells = reachable(state, type, unit);
    if (unplaced) return { ...common, cells };
    const choice = cells.find(at => sameCell(at, center));
    if (!choice) return fail('无法到达：距离、占位、墙体或陡崖阻挡', { cells });
    return { ...common, cells, path: choice.path, steps: choice.steps, opportunities: choice.opportunities,
      ...(choice.bankedProgress != null && { bankedProgress: choice.bankedProgress }),
      dz: elevation(state, center) - elevation(state, unit) };
  }
  if (type === 'interact' || detonate) {
    if (!item) return fail('没有可用的互动点');
    if (detonate) {
      if (weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail(emptyAmmoMessage(weapon.ammo));
      if (!validReach(state, unit, item, weapon.template, weapon.ammo)) return fail('爆桶超出武器射程或被墙体阻挡');
    } else if (distance(state,unit,item) > 1.5 || !clearSight(state,unit,item)) return fail('需要靠近互动点');
    const cells = detonate ? aoeCells(state, center, center, { shape: 'circle', radius: item.radius ?? 1.5 }) : [center];
    const keyset = new Set(cells.map(at => key(at.x, at.y)));
    const targets = item.kind === 'altar' ? [{ id: unit.id, targetId: unit.id, name: unit.name, x: unit.x, y: unit.y,
      heal: item.effect === 'shield' && item.healAmount ? [item.healAmount, item.healAmount] : [0, 0] }]
      : living(state).filter(u => keyset.has(key(u.x, u.y)) && distance(state, center, u) + incomingDistanceOffset(state, unit, u, { checkKind: 'attack' }) <= (item.radius ?? 1.5) + 1e-9).map(u => {
        const guard = guardFor(state, u) ?? u;
        const context = { attacker: unit, targetId: guard.id, damageType: 'energy', intercepting: guard !== u };
        const formula = mitigation(state, guard, 'energy', true, 0, context);
        const modified = Math.floor((item.damage ?? 12) * formula.multiplier * formula.armorMultiplier
          * (1 - formula.attributeReduction) * modStat(state, unit, 'finalDamageMult', 1, { target: guard, damageType: 'energy' }));
        const damage = Math.max(0, Math.floor(damageAfterFlatReduction(state, guard, modified, context) * (1 - formula.dr)) - shieldTotal(guard));
        return { id: u.id, targetId: u.id, recipientId: guard.id, name: u.name, x: u.x, y: u.y,
          damage:[damage, damage], expectedDamage:damage, damageMax:damage, hitChance:1, automatic:true };
      });
    return { ...common, ...(detonate ? reaches(state, unit, item, weapon.template, weapon.ammo) : {}),
      name: `${detonate ? '引爆' : '激活'}${item.name}`, interactiveId: item.id, kind: item.kind, cells, targets, center };
  }
  const attack = type === 'attack' || type === 'shield_bash';
  const shieldBash = type === 'shield_bash';
  const template = shieldBash ? shieldBashTemplate : attack ? weapon.template : skill;
  if (attack && !shieldBash && weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail(emptyAmmoMessage(weapon.ammo));
  const triggers = template.rules ?? [];
  const stance = weapon.stance;
  const tuning = { name: template.name, shape: template.shape ?? 'single', stance, rules: triggers,
    ...(attack && !shieldBash ? { ammo: weapon.ammoCount, infiniteAmmo: weapon.infiniteAmmo,
      instanceId: weapon.instance?.id ?? null } : {}) };
  const corpseSkill = template.target === 'corpse';
  if (corpseSkill && unplaced) {
    return { ...common, ...tuning, cells: corpses(state).filter(c => validReach(state, unit, c, template)).map(c => pos(c.x, c.y)) };
  }
  if (unplaced) {
    return { ...common, ...tuning, cells: usableTiles(state, unit, template, attack && !shieldBash ? weapon : null, action.nonLethal ?? unit.nonLethal) };
  }
  const allowFriendlyTarget = aggregateModifiers(state, unit.id).controlPolicy.allowFriendlyTarget === true;
  const aoe = (template.shape ?? 'single') !== 'single';
  const aimedUnit = locateUnit(state, center, action.targetId, !aoe ? u => selectionAllows(state, template, unit, u, allowFriendlyTarget) : null);
  if (action.targetId && (!aimedUnit || !sameCell(aimedUnit, center))) return fail('目标单位不在指定格');
  const aim = template.target === 'cell' || aoe ? center : aimedUnit ?? center;
  const origin = actionOrigin ? { ...unit, x: actionOrigin.x, y: actionOrigin.y,
    altitude: actionOrigin.altitude ?? (actionOrigin.z === undefined ? 0 : actionOrigin.z - elevation(state, actionOrigin)) } : unit;
  const ammo = attack && !shieldBash ? weapon.ammo : null;
  const geometry = reaches(state, origin, aim, template, ammo);
  if (['fan', 'cone', 'line'].includes(template.shape) && template.range > 0 && sameCell(origin, center)) {
    return fail('有向技能需要选择方向', { ...geometry, originSensitive: true });
  }
  if (!ground(state, center)) return fail('墙体无法指定', geometry);
  if (!deferGeometry) {
    if (!ground(state, origin)) return fail('动作起点无效', { ...geometry, originSensitive: true });
    if (!ignoreRange && geometry.distance > geometry.range + 1e-9) return fail('目标超出射程', { ...geometry, originSensitive: true });
    if (!ignoreLOS && !clearSight(state, origin, center)) return fail('墙体阻断视线', { ...geometry, originSensitive: true });
  }
  if (corpseSkill) {
    const corpse = corpses(state).find(c => sameCell(c, center));
    return corpse ? { ...common, ...geometry, ...tuning, cells: [center], targets: [], center, corpseId: corpse.id } : fail('目标格没有可用尸体');
  }
  const solid = locateCover(state, center);
  const coverTarget = Boolean(solid && template.target !== 'cell' && (attack || hasStrikeDamage(template)));
  const cells = area(state, origin, aim, template, ammo, { ignoreRange, ignoreLOS, deferGeometry });
  if (!cells.length && !deferGeometry) return fail('请选择一个方向', { ...geometry, originSensitive: true });
  if (!aoe) {
    if (!selectionAllows(state, template, unit, aimedUnit, allowFriendlyTarget) && !coverTarget && template.target !== 'cell') {
      return fail('该格没有合适的目标', geometry);
    }
    if (!deferGeometry && aimedUnit && aimedUnit.team !== unit.team && !visibleEnemy(state, origin, aimedUnit)) return fail('目标正在隐身', { ...geometry, originSensitive: true });
  }
  const hostile = attack || template.target === 'enemy' || (hasStrikeDamage(template) && template.target !== 'ally' && template.target !== 'self');
  const taunter = hostile && !deferGeometry ? tauntFor(state, origin, template, ammo) : null;
  if (taunter && (!aimedUnit || aimedUnit.id !== taunter.id)) return fail(`受嘲讽，必须指定${taunter.name}`, { ...geometry, originSensitive: true });
  const templateForHit = template;
  const targetUnits = shapeTargets(state, unit, cells, template, aim, origin, ammo,
    ignoreRange || deferGeometry, ignoreLOS || deferGeometry, allowFriendlyTarget, action.targetId ?? (!aoe ? aimedUnit?.id : undefined));
  const areaAttack = (template.shape ?? 'single') !== 'single';
  const declaredIntent = action.intent ?? unit.intent ?? 'normal';
  const intentLock = aggregateModifiers(state, unit.id).controlPolicy.intentLock;
  const resolvedIntent = areaAttack || !hostile ? 'normal' : intentLock ?? declaredIntent;
  const targets = targetUnits.map(t => ({ ...targetProfile(state, unit, t, t, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, intent: resolvedIntent, skillId: action.skillId }),
    bonusDice: action.bonusDice ?? 0, intent: resolvedIntent, nonLethal: action.nonLethal ?? unit.nonLethal ?? false }));
  if (template.target !== 'cell' && hasStrikeDamage(template)) {
    for (const c of values(state.covers).filter(c => c.hp > 0 && cells.some(at => sameCell(at, c))).sort(byId)) {
      targets.push({ ...targetProfile(state, unit, c, c, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, cover: true, intent: resolvedIntent }), kind: 'cover' });
    }
  }
  if (template.heal != null) {
    const healing = diceBounds(diceFormula(state, template.heal, unit)).map(n => Math.floor(n * healMultiplier(state, unit)));
    for (const target of targets) if (target.kind !== 'cover') {
      target.heal = healing;
      target.healMin = healing[0]; target.healMax = healing[1];
      if (equipped(state, unit).some(({ template }) => template?.mods?.some(mod => mod.stat === 'healingMult'))) {
        target.healingShield = [Math.floor(healing[1] / 2) - 1, Math.floor(healing[1] / 2) - 1];
      }
    }
  }
  let support, ruleImpact;
  if (simulateRules && type === 'skill' && template.rules?.some(rule => rule.hook === 'active' && rule.enabled !== false)) {
    const result = resolveVMAction(state, action, { dryRun: true, actor: unit });
    const logs = result.state.logs.slice(state.logs.length);
    // Report actual recipients too: an active VM program may select units outside
    // the native template footprint, including when the target is an empty cell.
    ruleImpact = { conditional: Boolean(result.conditional), units: [], summons: 0 };
    const strikeDamage = new Map();
    for (const log of logs) {
      const { targetId, amount, dice } = log.detail;
      if (log.type === 'damage' && log.actor === unit.id && dice) {
        strikeDamage.set(targetId, (strikeDamage.get(targetId) ?? 0) + amount);
      }
    }
    for (const [id, before] of Object.entries(state.units)) {
      const after = result.state.units[id];
      if (!after) continue;
      const control = Object.entries(after.statuses ?? {}).filter(([key, status]) =>
        !before.statuses?.[key] && (status.category === 'control' || getStatusTemplate(state, key)?.category === 'control')).length;
      const cleared = Object.entries(before.statuses ?? {}).filter(([key, status]) =>
        !after.statuses?.[key] && ['control', 'debuff', 'dot'].includes(status.category ?? getStatusTemplate(state, key)?.category)).length;
      const hp = after.hp - before.hp, shield = shieldTotal(after) - shieldTotal(before);
      if (hp || shield || control || cleared) ruleImpact.units.push({ id, hp, strikeDamage: strikeDamage.get(id) ?? 0, shield, control, cleared });
    }
    ruleImpact.summons = Object.values(result.state.units).filter(other => !Object.hasOwn(state.units, other.id) && other.team === unit.team && alive(other)).length;
    const heals = new Map();
    for (const log of logs) {
      const { targetId, amount } = log.detail;
      if (log.type === 'heal' && log.actor === unit.id) heals.set(targetId, (heals.get(targetId) ?? 0) + amount);
    }
    support = [...heals].map(([id, heal]) => ({ id, heal, shieldGain: 0 }));
    for (const profile of targets) {
      if (profile.heal && profile.kind !== 'cover') {
        const shieldOps = template.rules.flatMap(rule => rule.program ?? [])
          .filter(op => op.op === 'apply_status' && getStatusTemplate(state, op.statusId)?.category === 'shield');
        if (shieldOps.length) profile.healingShield = [Math.floor(profile.heal[1] / 2), Math.floor(profile.heal[1] / 2)];
      }
      if (profile.dice) continue;
      const dealt = logs.filter(log => log.type === 'damage' && log.actor === unit.id && log.detail.targetId === profile.id)
        .reduce((sum, log) => sum + log.detail.amount, 0);
      profile.damage = [dealt, dealt];
      profile.damageMin = profile.damageMax = profile.expectedDamage = dealt;
      if (result.conditional) profile.conditionalDamage = true;
    }
  }
  const first = targets.find(t => sameCell(t, center)) ?? targets[0];
  return { ...first, ...common, ...geometry, ...tuning, ...(first ? { damageMultiplier: first.damageMultiplier } : {}),
    bonusDice: action.bonusDice ?? 0, intent: resolvedIntent, nonLethal: action.nonLethal ?? unit.nonLethal ?? false,
    dXYZ: geometry.distance, cells, targets, center, ...(support?.length ? { support } : {}), ...(ruleImpact ? { ruleImpact } : {}), hostile };
}

function maneuverContest(state, actor, target, maneuver) {
  const attackStat = maneuver === 'grapple' ? 'str' : 'agi';
  const defenseStat = maneuver === 'trip' ? 'agi' : 'str';
  const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
  const attackerTotal = effectiveStat(state, actor, attackStat) + attackerRoll;
  const defenderTotal = effectiveStat(state, target, defenseStat) + defenderRoll;
  const success = attackerTotal >= defenderTotal;
  record(state, actor, 'contest', `${actor.name}${success ? '成功' : '未能'}${({ grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞' })[maneuver]}`, {
    maneuver, targetId: target.id, attackerRoll, defenderRoll, attackerTotal, defenderTotal, success });
  return success;
}
function changeCounter(state, actor, weapon, effect, resource, after) {
  const pool = getPool(state, weapon.instance.id, resource, 'item');
  if (!pool) return;
  const before = pool.current;
  after = updatePoolCurrent(state, pool.id, 'set', after).after;
  record(state, actor, 'counter', `${weapon.template.name} · ${resource} ${before} → ${after}`,
    { instanceId: weapon.instance.id, counterKey: resource, before, after });
}

export function paySkillEquipmentCost(state, actor, skill) {
  const { resource, amount: cost } = skill?.resourceCost ?? {};
  if (!resource || !cost) return;
  const item = resourcePool(state, actor, resource, skill.itemInstance);
  if (item) {
    changeCounter(state, actor, item.item, item.effect, resource, item.amount - cost);
  } else if (!skill.itemInstance) {
    const pool = getPool(state, actor.id, resource);
    if (!pool) return;
    const { before, after } = updatePoolCurrent(state, pool.id, 'sub', cost);
    record(state, actor, 'resource', `${actor.name} · ${resource} ${before} → ${after}`,
      { targetId: actor.id, resource, amount: before - after, before, after });
  }
}

function spendAmmo(state, actor, weapon, ammo) {
  const pool = getPool(state, weapon.instance.id, ammo.resource, 'item');
  if (pool && pool.current > 0) changeCounter(state, actor, weapon, ammo, ammo.resource, pool.current - 1);
}

function adjustedRating(base, event) {
  const delta = Number.isFinite(event.ratingDelta) ? Math.trunc(event.ratingDelta) : 0;
  const rating = RATING_TABLE[clamp(RATING_TABLE.indexOf(base) - delta, 0, RATING_TABLE.length - 1)];
  const floor = event.minRating && RATING_TABLE.find(row => row.name === event.minRating);
  return floor && floor.multiplier > rating.multiplier ? floor : rating;
}

function resolveCheck(state, actor, profile, event = {}) {
  const intentContext = { ...event, actorId: actor.id, targetId: profile.id, attacker: actor,
    target: state.units[profile.id], actionType: profile.actionType, skillId: profile.skillId ?? null,
    weaponId: profile.weaponId ?? null, weaponTemplateId: profile.weaponTemplateId ?? null,
    damageType: profile.damageType, checkKind: 'intent', stat: 'intent', intent: profile.intent ?? 'normal' };
  const cover = profile.kind === 'cover' ? { targetKind: 'cover', targetName: profile.name } : {};
  if (profile.saveStat) {
    const saveRoll = event.replaceNaturalRoll ?? event.naturalRoll ?? randomDie(state, 20);
    const saveTotal = saveRoll + profile.saveBonus;
    const saved = saveTotal >= profile.saveDC;
    record(state, actor, 'save', `${profile.name}${saved ? '通过' : '未通过'}豁免 (${saveTotal}/${profile.saveDC})`,
      { targetId: profile.id, ...cover, saveStat: profile.saveStat, saveRoll, saveBonus: profile.saveBonus, saveTotal, saveDC: profile.saveDC, saved });
    return { hit: true, critical: false, saved };
  }
  if (profile.automatic) {
    const rating = adjustedRating(ratingFor(profile.guaranteeCrit || profile.execution ? 20 : 11), event);
    if (profile.dice) record(state, actor, 'hit_result', `${profile.name}：自动命中`, {
      targetId: profile.id, ...cover, automatic: true, hit: true, critical: Boolean(profile.guaranteeCrit), ...(profile.execution && {execution:true}), rating,
    });
    return { hit: true, critical: profile.guaranteeCrit, rating, intent: { success: true, multiplier: 1 }, saved: false };
  }
  const requestedBonus = profile.bonusDice ?? 0;
  const rolled = event.preRolled ?? (requestedBonus || actor.penaltyDice
    ? rollProtocolD20(state.rng, { bonus: requestedBonus, penalty: actor.penaltyDice ?? 0 })
    : rollD20(state.rng, profile.advantages, profile.disadvantages));
  const dice = rolled.rolls;
  const rawNatural = event.rawNatural ?? rolled.value;
  const selected = event.replaceNaturalRoll ?? rawNatural;
  if (!event.preRolled) {
    actor.bonusDice = Math.max(0, (actor.bonusDice ?? 0) - requestedBonus); actor.penaltyDice = 0;
    state.rng = rolled.rng;
  }
  const total = selected + profile.accuracy;
  let rating = ratingFor(total);
  if (selected !== 1 || profile.guaranteeHit) rating = adjustedRating(rating, event);
  if (profile.guaranteeHit && (!rating.multiplier || selected === 1 && rating.multiplier < 1)) rating = ratingFor(11);
  if (profile.guaranteeCrit && rating.multiplier < 1.3) rating = ratingFor(20);
  const critical = profile.guaranteeCrit || selected === 20;
  const hit = Boolean(profile.guaranteeHit || selected !== 1 && rating.multiplier > 0);
  if (profile.execution && hit && rating.multiplier < 1.3) rating = ratingFor(20);
  let intent = { required: false, success: true, multiplier: 1 };
  let intentDetail;
  const defender = state.units[profile.id];
  if (hit && defender && profile.intent && profile.intent !== 'normal') {
    const protection = ['kill', 'concept'].includes(profile.intent) ? protectionCarrier(state, defender) : null;
    if (protection) {
      const attackCarrier = profile.skillId ? { type: 'skill', id: profile.skillId, ownerId: actor.id }
        : profile.weaponId ? { type: 'item', id: profile.weaponId, ownerId: actor.id } : null;
      const contest = authorityContest(state, { ...authorityFor(state, attackCarrier, actor.id), unitId: actor.id },
        { ...authorityFor(state, protection, defender.id), unitId: defender.id }, {
          checkBonus: unit => modStat(state, unit, 'checkBonus', 0, { checkKind: 'authority' }),
        });
      record(state, actor, 'authority', `${defender.name}的概念保护${contest.result < 0 ? '拦截了意图' : '被意图穿透'}${authorityProse(contest)}`, { targetId: defender.id, contest });
      if (contest.result < 0) {
        return { hit, critical, rating, intent: { required: false, success: false, multiplier: 1 }, saved: false };
      }
    }
    const defenderD20 = randomDie(state, 20);
    const intentBonus = modStat(state, actor, 'intentBonus', 0, intentContext);
    const weakness = modStat(state, defender, 'intentDifficulty', 0, intentContext);
    const baseIntent = INTENTS[profile.intent] ?? INTENTS.normal;
    const intentSpec = { ...baseIntent, difficulty: Math.max(0, baseIntent.difficulty + weakness) };
    const ratingBonus = { 平暴击: 10, 强暴击: 20, 超暴击: 30 }[rating.name] ?? 0;
    const attackerTier = actor.tier ?? 1, defenderTier = defender.tier ?? 1;
    const attackerBase = attackerTier * 5, defenderBase = defenderTier * 5;
    const attackerTotal = attackerBase + selected + ratingBonus + intentBonus;
    const defenderTotal = defenderBase + defenderD20 + intentSpec.difficulty;
    intent = intentCheck(intentSpec, attackerTier, defenderTier, selected, defenderD20, ratingBonus + intentBonus);
    intentDetail = {
      targetId: profile.id, intent: profile.intent, attackerTier, defenderTier, attackerBase, attackerD20: selected,
      rating: rating.name, ratingBonus, ...(intentBonus ? { intentBonus } : {}), attackerTotal, defenderBase, defenderD20, intentDifficulty: intentSpec.difficulty,
      ...(weakness ? { intentDifficultyBonus: weakness } : {}), defenderTotal, ...intent };
  }
  // Failed intent falls back to an ordinary landed hit; it does not erase the attack.
  const effectiveHit = hit;
  const summary = state.ruleset === 'sandbox' || profile.kind === 'cover' ? ` (${total}/${profile.defense})`
    : `（合计 ${total}，${rating.name}${profile.dodgeBonus ? `，守方闪避 ${profile.dodgeBonus > 0 ? '+' : ''}${profile.dodgeBonus}` : ''}）`;
  record(state, actor, 'roll', `${profile.name}：${critical ? '暴击' : hit ? '命中' : '未命中'}${summary}`, {
    ruleset: state.ruleset ?? 'protocol', targetKind: profile.kind === 'cover' ? 'cover' : 'unit',
    attackAccuracy: profile.attackAccuracy ?? profile.accuracy, dodgeBonus: profile.dodgeBonus ?? 0,
    ...(profile.rawDodgeBonus && { rawDodgeBonus: profile.rawDodgeBonus }), ...(profile.ignoreDodge && { ignoreDodge: true }),
    ...(profile.bonusDelta && { bonusDelta: profile.bonusDelta }), ...(profile.accuracySources && { accuracySources: profile.accuracySources }),
    targetId: profile.id, ...cover, dice, selected, total, accuracy: profile.accuracy, defense: profile.defense, advantage: profile.advantage,
    advantages: profile.advantages, disadvantages: profile.disadvantages, highGround: profile.highGround, cover: profile.cover,
    ...(profile.coverId ? { coverId: profile.coverId } : {}),
    ...(profile.execution && {execution:true}), rating, distanceTier: distanceTier(profile.distance), bonusDice: requestedBonus,
    distance: profile.distance, dz: profile.dz, flanked: profile.flanked, arc: profile.arc, hit: effectiveHit, critical,
    intent,
  });
  if (intent.required) record(state, actor, 'intent', `${profile.name}${intent.success ? '意图成立' : '意图受阻'}`, intentDetail);
  return { hit: effectiveHit, critical, rating, intent, saved: false };
}

function coverDamage(state, actor, cover, amount, details) {
  const before = cover.hp;
  cover.hp = Math.max(0, before - Math.max(0, amount - (cover.armor ?? 0)));
  record(state, actor, 'cover_damage', `${cover.name}受到${before - cover.hp}点伤害`,
    { ...details, coverId: cover.id, amount: before - cover.hp, hpBefore: before, hpAfter: cover.hp });
  if (!cover.hp) record(state, actor, 'cover_break', `${cover.name}坍塌`, { coverId: cover.id });
}

function knockback(state, actor, target, effect) {
  const [dx, dy] = signFacing(actor, target);
  if (!dx && !dy) return;
  const from = pointAt(state, target);
  for (let i = 0; i < (effect.distance ?? 1); i++) {
    const at = pos(target.x + dx, target.y + dy);
    if (!canStep(state, target, at)) {
      damageTarget(state, target, actor.id, effect.collisionDamage ?? 5, 'true', '撞击');
      if (alive(target)) grantStatus(state, target, effect.statusId ?? actionStatuses.collision, { sourceId: actor.id });
      break;
    }
    Object.assign(target, at);
  }
  record(state, actor, 'knockback', `${target.name}遭到击退`, { targetId: target.id, from, to: pointAt(state, target) });
}

export function retargetStrike(state, actor, action, target, plan, previous = {}) {
  const weapon = action.type === 'attack' ? weaponInfo(state, actor) : null;
  const template = action.type === 'shield_bash' ? shieldBashTemplate : weapon?.template ?? actionSkill(state, actor, action.skillId) ?? normalAttack;
  return { ...previous, ...targetProfile(state, actor, target, target, template, { weapon, skillId: action.skillId, cover: previous.kind === 'cover', intent: previous.intent ?? plan.intent }),
    bonusDice: previous.bonusDice ?? action.bonusDice ?? 0, nonLethal: previous.nonLethal ?? action.nonLethal ?? actor.nonLethal ?? false };
}

export function continueStrike({ state, frame, host }) {
  const { data: action, plan } = frame;
  const actor = tableEntry(state.units, frame.ownerId);
  const actionEvent = state.vm.events[frame.eventRef];
  const weapon = frame.weapon ?? (action.type === 'attack' ? weaponInfo(state, actor) : null);
  const template = action.type === 'shield_bash'
    ? shieldBashTemplate
    : weapon ? weapon.template : actionSkill(state, actor, action.skillId);
  if (!alive(actor) || !template) { state.vm.stack.pop(); return; }
  if (!frame.started) {
    frame.started = true;
    if (!sameCell(actor, plan.center)) actor.facing = signFacing(actor, plan.center);
  }
  let profile = frame.profile ?? plan.targets?.[frame.pc];
  if (!profile) { state.vm.stack.pop(); return; }
  const target = tableEntry(profile.kind === 'cover' ? state.covers : state.units, profile.id);
  const beforeTargetPosition = frame.beforeTargetPosition;
  if (!frame.phase && target && beforeTargetPosition && (actor.x !== beforeTargetPosition.x || actor.y !== beforeTargetPosition.y)) {
    profile = retargetStrike(state, actor, action, target, plan, profile);
    frame.profile = profile;
  }
  const next = () => { frame.pc++; delete frame.phase; delete frame.profile; delete frame.awaitEvent; delete frame.preRolled; delete frame.intentOutcome; };
  const detail = { actorId: actor.id, targetId: target?.id ?? null, skillId: action.skillId ?? null, actionType: action.type,
    melee: profile.melee, backstab: profile.backstab, arrow: profile.arrow, opportunityAttack: Boolean(frame.weapon && !frame.followup),
    weaponTemplateId: weapon?.instance?.templateId ?? null, instanceId: weapon?.instance?.id ?? null, damageType: profile.damageType,
    intent: profile.intent ?? 'normal' };
  if (!frame.phase) {
    if (!alive(target) || target.fled) { next(); return; }
    if (profile.skipHitCheck) {
      const result = resolveCheck(state, actor, profile);
      frame.intentOutcome = result.intent;
      frame.awaitEvent = host.event(state, { ...detail, ...result, intent: result.intent?.success === false ? 'normal' : detail.intent, passed: result.hit });
      frame.phase = 'damage';
      return;
    }
    frame.phase = 'check';
    frame.awaitEvent = host.event(state, { ...detail, checkKind: profile.saveStat ? 'save' : 'attack',
      stat: profile.saveStat ?? profile.stat ?? null, dc: profile.saveDC ?? profile.defense });
    host.hooks(state, frame, 'before_check', frame.awaitEvent);
    return;
  }
  const event = state.vm.events[frame.awaitEvent];
  if (frame.phase === 'check') {
    frame.phase = 'natural';
    if (profile.automatic && !profile.saveStat) return;
    if (profile.saveStat) event.naturalRoll = randomDie(state, 20);
    else {
      const bonus = profile.bonusDice ?? 0;
      const penalty = actor.penaltyDice ?? 0;
      const rolled = bonus || penalty ? rollProtocolD20(state.rng, { bonus, penalty })
        : rollD20(state.rng, profile.advantages, profile.disadvantages);
      state.rng = rolled.rng;
      actor.bonusDice = Math.max(0, (actor.bonusDice ?? 0) - bonus);
      actor.penaltyDice = 0;
      frame.preRolled = rolled;
      event.naturalRoll = rolled.value;
    }
    host.hooks(state, frame, 'after_natural_roll', frame.awaitEvent);
    return;
  }
  if (frame.phase === 'natural') {
    const bonusDelta = event.bonusDelta ?? 0, ignoreDodge = Boolean(event.ignoreDodge);
    const rawDodgeBonus = profile.dodgeBonus ?? 0, dodgeBonus = ignoreDodge ? 0 : rawDodgeBonus;
    const attackAccuracy = (profile.attackAccuracy ?? (profile.accuracy + rawDodgeBonus)) + bonusDelta;
    const adjusted = { ...profile, attackAccuracy, dodgeBonus, rawDodgeBonus, ignoreDodge, bonusDelta, accuracy: attackAccuracy - dodgeBonus,
      advantage: profile.advantage + (event.advantageDelta ?? 0), saveDC: (profile.saveDC ?? 0) + (event.dcDelta ?? 0),
      guaranteeHit: profile.guaranteeHit || ['hit', 'crit'].includes(event.forceOutcome), guaranteeCrit: profile.guaranteeCrit || event.forceOutcome === 'crit' };
    const replacement = Number.isFinite(event.replaceNaturalRoll) ? clamp(Math.trunc(event.replaceNaturalRoll), 1, 20) : undefined;
    const result = resolveCheck(state, actor, adjusted, { ...event, replaceNaturalRoll: replacement,
      preRolled: frame.preRolled, rawNatural: event.naturalRoll });
    if (event.forceOutcome === 'miss') result.hit = false;
    if (event.forceOutcome === 'pass') result.saved = true;
    if (event.forceOutcome === 'fail') result.saved = false;
    frame.intentOutcome = result.intent;
    Object.assign(event, { ...result, intent: result.intent?.success === false ? 'normal' : detail.intent, passed: profile.saveStat ? result.saved : result.hit });
    frame.phase = 'damage';
    host.hooks(state, frame, 'after_check', frame.awaitEvent);
    return;
  }
  if (frame.phase === 'damage') {
    if (!event.hit) { next(); return; }
    frame.phase = 'heal';
    const { critical, rating, saved } = event;
    const intent = frame.intentOutcome;
    if (!profile.dice) return;
    const dice = profile.protocolInitial != null ? flatDice(profile.protocolInitial) : diceRoll(state, profile.dice, critical);
    const baseScale = rating?.multiplier ?? (critical ? 2 : 1);
    const isCritical = Boolean(critical) || baseScale > 1;
    const ratingScale = isCritical ? Math.max(0, baseScale + modStat(state, actor, 'critDamageBonus', 0,
      { ...detail, intent: event.intent, target, critical: true, ratingMultiplier: baseScale })) : baseScale;
    // Sandbox dice do not have a separate weapon attack term. Keep its heavy-weapon balance.
    const stanceScale = state.ruleset === 'sandbox' && profile.stance === 'greatsword'
      ? (actor.greatswordMode === 'defensive' ? profile.stanceRules.defensiveDamage : profile.stanceRules.offensiveDamage) : 1;
    const amount = dice.value * profile.multiplier * meleeMultiplier(actor) * ratingScale * (intent?.success ? intent.multiplier ?? 1 : 1)
      * stanceScale * (saved ? .5 : 1) * (actionEvent?.damageScale ?? 1) * (frame.scale ?? 1);
    const details = { dice, critical, saved, rating: rating?.name ?? '有效', ratingMultiplier: ratingScale,
      intent: intent ?? { success: true, multiplier: 1 }, attackMultiplier: profile.multiplier, stanceScale };
    if (profile.kind === 'cover') { coverDamage(state, actor, target, Math.floor(amount), details); return; }
    const recipient = guardFor(state, target) ?? target;
    event.targetId = recipient.id;
    host.commit(state, frame, { ...detail, intent: event.intent, op: 'damage', pool: 'hp', targetId: recipient.id, sourceId: actor.id,
      amount, label: template.name, direct: true, intercepted: recipient !== target, armorPierce: profile.armorPierce,
      critical: isCritical, ratingMultiplier: ratingScale, details, resultEventRef: frame.awaitEvent,
      lethal: !(profile.nonLethal || recipient.nonLethal || vmFlag(state, recipient, 'preserveLife') || encounterNonlethal(state, actor)) });
    return;
  }
  if (frame.phase === 'heal') {
    frame.phase = 'after_hit';
    const recipient = tableEntry(state.units, event.targetId);
    if (template.heal != null && alive(recipient)) host.commit(state, frame, { ...detail, intent: event.intent, op: 'heal', pool: 'hp',
      sourceId: actor.id, targetId: recipient.id, amount: diceRoll(state, diceFormula(state, template.heal, actor)).value,
      actionType: action.type, skillId: action.skillId ?? null, label: template.name });
    return;
  }
  if (frame.phase === 'after_hit' && profile.kind !== 'cover') {
    frame.phase = 'followup';
    if (action.type === 'shield_bash') event.rules = shieldBashRules;
    host.hooks(state, frame, 'after_hit', frame.awaitEvent);
    return;
  }
  if (frame.phase === 'followup' && action.type === 'attack' && !frame.weapon && !actor.followupUsed && stanceRules(weapon?.stance).followUp) {
    const recipient = tableEntry(state.units, event.targetId);
    const off = weapon.offHand;
    const ammo = weaponAmmo(off?.template);
    const level = actor.level ?? actor.tier ?? 1;
    const cost = level * 10;
    if (alive(recipient) && recipient.team !== actor.team && off?.template?.damage && off.template.hand === 'off_hand' && actor.sp >= cost
      && (event.rating?.multiplier ?? 0) >= .8 && validReach(state, actor, recipient, off.template, ammo)
      && (!ammo || weapon.infiniteAmmo || resourcePool(state, actor, ammo.resource, off.instance)?.amount > 0)) {
      actor.followupUsed = true;
      const followWeapon = { ...off, template: { ...off.template, power: level * 15 }, ammo, stance: 'dual_wield' };
      const follow = targetProfile(state, actor, recipient, recipient, followWeapon.template, { weapon: followWeapon });
      follow.disadvantages = event.rating.multiplier >= 1.3 ? 0 : Math.max(1, follow.disadvantages);
      record(state, actor, 'followup', `${actor.name}使用${off.template.name}追击${recipient.name}`, { targetId: recipient.id, cost, weaponId: off.instance.id });
      setResourceTotal(state, actor, 'sp', actor.sp - cost, actor.id, '副手追击');
      if (ammo && !weapon.infiniteAmmo) spendAmmo(state, actor, off, ammo);
      host.followup(state, frame, followWeapon, follow);
    }
  }
  next();
}

function movementDirection(from, to, previous) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return previous ?? null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'W' : 'E';
  return dy < 0 ? 'N' : 'S';
}

function continueMovement(state, actor, type, plan, progress, host) {
  progress.from ??= pointAt(state, actor);
  progress.path ??= [];
  progress.initialCover ??= nearbyCovers(state, actor).map(c => c.id);
  const path = progress.path;
  const to = plan.path[path.length];
  if (to && alive(actor) && !actor.fled && !aggregateModifiers(state, actor.id).locks.move) {
    progress.reactors ??= type === 'disengage' ? [] : opportunitySources(state, actor).map(({ unit }) => unit.id);
    while (progress.reactors.length) {
      const unit = tableEntry(state.units, progress.reactors.shift());
      if (!alive(unit)) continue;
      const weapon = weaponInfo(state, unit);
      const source = { unit, weapon };
      if (!canReact(state, source, actor) || !threatens(state, source, actor, actor)
        || (!sameCell(actor, unit) && threatens(state, source, actor, to))) continue;
      unit.reactionAvailable = false;
      const center = pos(actor.x, actor.y);
      record(state, unit, 'opportunity', `${unit.name}对${actor.name}发动借机攻击（${weapon.template.name}）`,
        { ...opportunityDetail(unit, center, to), targetId: actor.id });
      const profile = targetProfile(state, unit, actor, actor, weapon.template, { weapon });
      host.opportunity(state, unit, center, profile, weapon);
      return false;
    }
    if (canStep(state, actor, to)) {
      actor.facing = signFacing(actor, to);
      Object.assign(actor, pos(to.x, to.y));
      path.push(to);
      delete progress.reactors;
      return false;
    }
  }
  const landing = pointAt(state, actor), interrupted = path.length !== plan.path.length;
  const scale = movementScale(state, actor, type);
  const consumed = Math.min(scale.total, path.length * 1000);
  if (actor.moveM != null || scale.limit === 0) actor.moveCarryPermille = (scale.total - consumed) % 1000;
  // Actual displacement is tracked independently of explicit movement-pool changes.
  const carryText = path.length === 0 && scale.limit === 0
    ? `在广袤战区中奋力蓄步推进（跨区进度${movementProgressText(scale.total)}）` : null;
  const movedCells = path.length;
  actor.moved = (actor.moved ?? 0) + movedCells;
  if (movedCells || progress.from.z !== landing.z) {
    actor.lastMoveDir = movementDirection(progress.from, landing, actor.lastMoveDir);
    progress.moveEvent = { actorId: actor.id, targetId: actor.id,
      fromX: progress.from.x, fromY: progress.from.y, toX: landing.x, toY: landing.y,
      steps: movedCells, moveKind: type };
  }
  record(state, actor, type, carryText ?? `${actor.name}${movementNames[type]}${interrupted ? '受阻，停在' : '至'} (${landing.x}, ${landing.y}, z=${landing.z})`,
    { from: progress.from, to: landing, path, steps: path.length, interrupted, ...(actor.moveCarryPermille != null && { moveCarryPermille: actor.moveCarryPermille }), ...(carryText ? { moveM: scale.moveM, progressPermille: scale.total } : {}) });
  if (alive(actor)) {
    if (type === 'move' && actor.stance === 'light_blade') actor.bonusDice = Math.min(2, (actor.bonusDice ?? 0) + 1);
    const coverIds = nearbyCovers(state, actor).filter(c => !progress.initialCover.includes(c.id)).map(c => c.id);
    if (coverIds.length) record(state, actor, 'cover_approach', `${actor.name}移至掩体 ${coverIds.join('、')} 旁`, { coverIds });
  }
  return true;
}

function continueInteraction(state, actor, plan, progress) {
  const item = state.interactives[plan.interactiveId];
  const effect = item.effect ?? (item.kind === 'barrel' ? 'explode' : null);
  if (!progress.started) {
    progress.started = true;
    item.spent = true;
    if (!sameCell(actor, item)) actor.facing = signFacing(actor, item);
    record(state, actor, 'interact', `${actor.name}${item.kind === 'barrel' ? '引爆' : '激活'}${item.name}`, { interactiveId: item.id });
    if (effect === 'explode') {
      const weapon = weaponInfo(state, actor);
      if (weapon.ammo && !weapon.infiniteAmmo) spendAmmo(state, actor, weapon, weapon.ammo);
      progress.targets = plan.targets.map(profile => profile.id);
    } else if (effect !== 'shield') {
      if (effect) restoreHP(state, actor, item.damage ?? 8, actor.id, item.name);
      if (item.statusId) grantStatus(state, actor, item.statusId, { sourceId: actor.id });
      return false;
    }
  }
  if (effect === 'explode') {
    while (progress.targets.length) {
      const target = state.units[progress.targets.shift()];
      if (!alive(target)) continue;
      damageTarget(state, target, actor.id, item.damage ?? 12, 'energy', item.name, { direct: false });
      return false;
    }
    for (const cover of values(state.covers).filter(c => c.hp > 0 && plan.cells.some(at => sameCell(at, c))).sort(byId)) {
      coverDamage(state, actor, cover, item.damage ?? 12, { interactiveId: item.id });
    }
  } else if (effect === 'restore') {
    const amount = item.damage ?? 8;
    setResourceTotal(state, actor, 'mp', Math.min(actor.maxMp, actor.mp + amount), actor.id, item.name);
    setResourceTotal(state, actor, 'sp', Math.min(actor.maxSp, actor.sp + amount), actor.id, item.name);
  } else if (effect === 'shield') {
    if (item.healAmount) restoreHP(state, actor, item.healAmount, actor.id, item.name);
    grantShield(state, actor, item.damage ?? 10, { sourceId: actor.id });
    if (item.statusId) grantStatus(state, actor, item.statusId, { sourceId: actor.id });
  }
  return true;
}

export function applyAction(state, action) {
  if (action?.type === 'answer' || state.vm?.pendingAsk || action?.type && !['end', 'end_encounter'].includes(action.type)) {
    if (state.vm?.pendingAsk && action.type === 'end_encounter') {
      const concession = preview(state, action);
      if (!concession.ok) throw new Error(concession.error);
      state.vm.pendingAsk = null;
      state.vm.stack.length = 0;
      state.vm.events = {};
      delete state.vm.endingTurn;
      delete state.vm.endingStatuses;
      delete state.vm.startingTurn;
      delete state.vm.settlingTurn;
    } else {
      const before = state.logs.length;
      const actor = currentUnit(state);
      const result = resolveVMAction(state, action);
      if (!result.pendingAsk && state.vm.endingTurn) {
        const endingUnit = state.units[state.vm.endingTurn];
        const remainingStatuses = state.vm.endingStatuses;
        delete state.vm.endingTurn;
        delete state.vm.endingStatuses;
        completeTurnEnd(state, endingUnit, remainingStatuses);
        if (!state.vm.pendingAsk && !refreshOutcome(state)) { advanceCursor(state); settleTurn(state); }
      } else if (!result.pendingAsk && state.vm.startingTurn) {
        settleTurn(state);
      } else if (!result.pendingAsk && state.vm.settlingTurn) {
        if (!refreshOutcome(state)) settleTurn(state);
        else delete state.vm.settlingTurn;
      } else if (!result.pendingAsk) finishAction(state, actor, action.type);
      return state.logs.slice(before);
    }
  }
  const plan = preview(state, action);
  if (!plan.ok) {
    // The API simulates on a copy: throwing after record() would discard the rejection log.
    if (plan.error === insufficientHP) {
      record(state, currentUnit(state), 'skill_rejected', insufficientHP, {skillId:action.skillId});
      return state.logs.slice(-1);
    }
    throw new Error(plan.error);
  }
  const actor = currentUnit(state);
  const before = state.logs.length;
  if (action.type === 'end_encounter') {
    record(state, actor, 'action', `${actor.name}：${plan.name}`,
      { action: { type: action.type }, intent: 'normal', targetId: null, ap: plan.ap, mp: plan.mp, sp: plan.sp, remainingAP: actor.ap });
    concludeObjective(state,state.battleType === 'spar' ? 'draw' : actor.team === 'blue' ? 'red' : 'blue', state.battleType === 'spar' ? '双方点到为止' : `${actor.name}代表本队认输`);
  }
  finishAction(state, actor, action.type);
  return state.logs.slice(before);
}

export function continueNativeAction({ state, frame, actor, plan, event, overrides, host }) {
  const { action } = frame.data;
  const { type, x, y } = action;
  if (!frame.nativeProgress) {
    frame.nativeProgress = {};
    host.payAction(state, actor, plan, event, overrides);
    const label = plan.name ?? movementNames[type] ?? (type === 'reload' ? '装填' : '互动');
    record(state, actor, 'action', `${actor.name}：${label}`,
      { action: { type, ...(x === undefined ? {} : { x, y }), ...(action.targetId ? { targetId: action.targetId } : {}) }, intent: 'normal',
        targetId: action.targetId ?? plan.targets?.find(target => target.kind !== 'cover')?.id ?? null,
        ap: plan.ap, mp: plan.mp, sp: plan.sp, remainingAP: actor.ap });
  }
  if (isMovement(type)) {
    const progress = frame.nativeProgress;
    if (progress.movementSettled) return true;
    if (!continueMovement(state, actor, type, plan, progress, host)) return false;
    progress.movementSettled = true;
    if (!progress.moveEvent) return true;
    dispatchVMHook(state, 'after_move', progress.moveEvent);
    return false;
  }
  if (plan.interactiveId) return continueInteraction(state, actor, plan, frame.nativeProgress);
  switch (type) {
    case 'stance_mode': actor.greatswordMode = action.maneuver; break;
    case 'switch_weapon': {
      const old = actor.mainHand ?? actor.weapon;
      const fromOff = plan.itemId === actor.offHand;
      if (fromOff) actor.offHand = old;
      else if (actor.bagWeapons?.includes(plan.itemId)) actor.bagWeapons.splice(actor.bagWeapons.indexOf(plan.itemId), 1, ...(old ? [old] : []));
      else actor.gear[actor.gear.indexOf(plan.itemId)] = old;
      actor.mainHand = actor.weapon = plan.itemId;
      actor.stance = loadoutStance(state, actor);
      break;
    }
    case 'use_item': {
      if (frame.nativeProgress.itemUsed) return true;
      frame.nativeProgress.itemUsed = true;
      actor.attunementCharges--;
      record(state, actor, 'item', `${actor.name}使用同调副手道具`, { itemId: plan.itemId, remaining: actor.attunementCharges });
      if (!actor.attunementCharges) actor.stance = loadoutStance(state, actor);
      Object.assign(event, { targetId: actor.id, targets: [actor.id], itemId: plan.itemId, rules: plan.rules });
      host.hooks(state, frame, 'active', frame.eventRef);
      return false;
    }
    case 'charge': grantStatus(state, actor, actionStatuses.charge, { sourceId: actor.id }); break;
    case 'lock_on': actor.lockedTargetId = plan.targetId; grantStatus(state, actor, actionStatuses.lock_on, { sourceId: actor.id, vars: { targetId: plan.targetId } }); record(state, actor, 'maneuver', `${actor.name}锁定${state.units[plan.targetId].name}`, { targetId: plan.targetId }); break;
    case 'scan': grantStatus(state, actor, actionStatuses.scan, { sourceId: actor.id, stacks: 3 }); break;
    case 'flee': {
      const enemies = living(state).filter(u => u.team !== actor.team).sort((a,b) => effectiveStat(state, b, 'agi') - effectiveStat(state, a, 'agi') || byId(a,b));
      const target = enemies[0];
      const actorCheck = { checkKind: 'flee', stat: 'agi' };
      const chaseCheck = { checkKind: 'flee_chase', stat: 'agi' };
      const attackerRoll = rollD20(state.rng, modStat(state, actor, 'advantage', 0, actorCheck));
      state.rng = attackerRoll.rng;
      const defenderRoll = target ? rollD20(state.rng, modStat(state, target, 'advantage', 0, chaseCheck)) : { value: 0, rng: state.rng };
      state.rng = defenderRoll.rng;
      const success = target ? effectiveStat(state, actor, 'agi') + attackerRoll.value + modStat(state, actor, 'checkBonus', 0, actorCheck)
        >= effectiveStat(state, target, 'agi') + defenderRoll.value + modStat(state, target, 'checkBonus', 0, chaseCheck) : true;
      record(state, actor, 'flee', `${actor.name}${success ? '逃跑成功' : '逃跑失败'}`, {
        targetId: target?.id ?? null, attackerRoll: attackerRoll.value, defenderRoll: defenderRoll.value,
        attackerRolls: attackerRoll.rolls, defenderRolls: defenderRoll.rolls ?? [], success });
      if (success) { actor.fled = true; actor.ap = 0; }
      break;
    }
    case 'free_ally': {
      const ally = state.units[plan.targetId];
      removeVMStatus(state, ally, ally.statuses.suppressed, 'freed', actor);
      record(state,actor,'free_ally',`${actor.name}为${ally.name}解除压制`,{targetId:ally.id});
      break;
    }
    case 'suppress': {
      const target = state.units[plan.targetId];
      record(state,actor,'suppress_attack',`${actor.name}尝试压制${target.name}`,{targetId:target.id});
      if (!resolveCheck(state, actor, plan.targets[0]).hit) break;
      const attackerRoll=randomDie(state,20), defenderRoll=randomDie(state,20);
      const attackerTotal=attackerRoll+effectiveStat(state,actor,'str'), defenderTotal=defenderRoll+effectiveStat(state,target,'str');
      const success=attackerTotal>defenderTotal;
      record(state,actor,'suppress_check',`${actor.name}对${target.name}力量对抗${success?'成功':'失败'}（${attackerTotal} 对 ${defenderTotal}）`,{targetId:target.id,attackerRoll,defenderRoll,attackerTotal,defenderTotal,success});
      if (success) grantStatus(state, target, 'suppressed', { sourceId: actor.id, vars: { holdTotal: attackerTotal } });
      else if (defenderTotal > attackerTotal) grantStatus(state,actor,'stun',{sourceId:target.id,turns:1});
      break;
    }
    case 'grapple': case 'disarm': case 'trip': case 'push': {
      const target = state.units[plan.targetId];
      if (target && maneuverContest(state, actor, target, type)) {
        if (type === 'grapple') grantStatus(state, target, actionStatuses.grapple, { sourceId: actor.id });
        if (type === 'disarm') {
          const lost = state.items[target.mainHand ?? target.weapon];
          if (lost?.ownerId === target.id) lost.ownerId = null;
          target.mainHand = target.weapon = null;
          target.stance = loadoutStance(state, target);
        }
        if (type === 'trip') grantStatus(state, target, actionStatuses.trip, { sourceId: actor.id });
        if (type === 'push') knockback(state, actor, target, { distance: 1, collisionDamage: 3 });
      }
      break;
    }
    case 'block': {
      const heavy = action.maneuver === 'heavy';
      grantStatus(state, actor, actionStatuses.block, { sourceId: actor.id, remainingTurns: 1,
        vars: { reduction: plan.reduction } });
      record(state, actor, 'block', `${actor.name}${heavy ? '重' : ''}格挡`, { reduction: plan.reduction });
      break;
    }
    case 'reload': {
      const weapon = weaponInfo(state, actor);
      changeCounter(state, actor, weapon, weapon.ammo, weapon.ammo.resource, weapon.ammo.cap);
      break;
    }
    case 'brace':
      record(state, actor, 'brace', `${actor.name}${plan.coverId ? `借 ${plan.coverId} ` : '原地'}架势防御（减伤 ${Math.round(plan.reduction * 100)}%，${plan.turns} 回合）`,
        { coverId: plan.coverId, reduction: plan.reduction, turns: plan.turns });
      grantStatus(state, actor, actionStatuses.brace, { sourceId: actor.id, turns: plan.turns });
      break;
  }
  return true;
}

function finishAction(state, actor, type) {
  if (state.vm?.pendingAsk) return;
  if (refreshOutcome(state)) { if (actor) actor.ap = 0; return; }
  if (type === 'end' || !alive(actor) || !actor.ap) {
    if (!actor.fled) endTurn(state, actor);
    if (!state.vm?.pendingAsk && !refreshOutcome(state)) { advanceCursor(state); settleTurn(state); }
  }
}
