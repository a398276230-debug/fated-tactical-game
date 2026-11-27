import { resolveEffectiveTier, scaledMoveCells, sizeClassFor, stanceFor, stanceRules, TIER_CELL_M, defaultMoveFromAgi, boardMoveCellsFromMoveM } from './combat_protocol.js';
import { evaluateExpr } from './formula.js';
import { MAX_CELL_CAPACITY, unitCellCost, canOccupy, cellAt, canStep, coverAt, distance3D, elevation, facingToward, findPath, isGround, unitAt, unitsAt } from './spatial.js';
import { spawnPanel, spawnBudgetIssue } from './spawn-unit.js';
import { sizeMultiplier } from './prebattle_resources.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { scheduleCommit } from './vm-commit.js';
import { createPool, initializeUnitPools, syncUnitPools, unlinkPools } from './vm-pools.js';
import { resolvePoint, selectVM } from './vm-select.js';
import { aggregateModifiers } from './vm-carriers.js';
import { canPlaceBoundEffect, cleanupSourceBoundEntities, effectLifecycle, switchConcentration } from './vm-lifecycle.js';

const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const values = table => Object.values(table ?? {});
const live = unit => unit && unit.hp > 0 && !unit.fled;
const point = value => Number.isSafeInteger(value?.x) && Number.isSafeInteger(value?.y);
const xy = ({ x, y }) => ({ x, y });
const same = (a, b) => a.x === b.x && a.y === b.y;
const cellKey = ({ x, y }) => `${x},${y}`;
const at = (state, entity) => ({ ...xy(entity), z: elevation(state, entity) });
const cells = state => state.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })));
const blocked = (state, p, ignored = new Set(), occupants = []) => !isGround(state, p) || (state.scale?.cellM ?? 2) < 10 && coverAt(state, p.x, p.y)
  || occupants.some(unit => !canOccupy(state, p.x, p.y, unit, ignored.has(unit.id) ? unit.id : undefined))
  || (!occupants.length && unitsAt(state, p.x, p.y).some(unit => live(unit) && !ignored.has(unit.id)));
const fixture = (state, p) => values(state.interactives).some(item => same(item, p));
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const capitalize = key => key[0].toUpperCase() + key.slice(1);

function nextId(state, table, prefix) {
  state.spatialSerial ??= {};
  let serial = state.spatialSerial[prefix] ?? 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of Object.keys(table)) {
    const suffix = Number(pattern.exec(id)?.[1]);
    if (Number.isSafeInteger(suffix)) serial = Math.max(serial, suffix);
  }
  state.spatialSerial[prefix] = serial + 1;
  return `${prefix}-${serial + 1}`;
}

function spawnNumber(expression, context, min, max = Infinity, integer = true) {
  const value = evaluateExpr(expression, context);
  if (!Number.isFinite(value)) return undefined;
  return clamp(integer ? Math.floor(value) : value, min, max);
}

function resolveSpawnSpec(spec, context, kind) {
  const resolved = { ...spec };
  const bounds = { tier: [1, 7], count: [1, kind === 'unit' ? 10 : Infinity], maxActive: [1, kind === 'unit' ? 50 : Infinity], remainingTurns: [1, 100] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (spec[key] === undefined) continue;
    resolved[key] = spawnNumber(spec[key], context, min, max);
    if (resolved[key] === undefined) return;
  }
  if (spec.spawnPanel) {
    resolved.spawnPanel = { ...spec.spawnPanel };
    if (spec.spawnPanel.stats) {
      resolved.spawnPanel.stats = {};
      for (const [key, expr] of Object.entries(spec.spawnPanel.stats)) {
        const value = evaluateExpr(expr, context);
        if (!Number.isFinite(value) || !Number.isSafeInteger(Math.floor(value))) return;
        resolved.spawnPanel.stats[key] = Math.floor(value);
      }
    }
    for (const key of ['tier', 'maxHp', 'maxMp', 'maxSp', 'armor', 'move']) {
      if (spec.spawnPanel[key] === undefined) continue;
      const value = evaluateExpr(spec.spawnPanel[key], context);
      const max = ['armor', 'move'].includes(key) ? 1e6 : 1e9;
      if (!Number.isFinite(value) || key !== 'tier' && (value < 0 || value > max)) return;
      resolved.spawnPanel[key] = key === 'tier' ? clamp(Math.floor(value), 1, 7) : Math.floor(value);
    }
  }
  if (spec.area) {
    resolved.area = { ...spec.area };
    for (const key of ['radius', 'innerRadius', 'width']) {
      if (spec.area[key] === undefined) continue;
      const value = spawnNumber(spec.area[key], context, 0, Infinity, false);
      if (value === undefined) return;
      resolved.area[key] = value;
    }
  }
  return resolved;
}

function inherit(frame) {
  return { ownerId: frame.ownerId, sourceId: frame.sourceId, ruleId: frame.ruleId, eventRef: frame.eventRef,
    carrier: frame.carrier ?? null, scope: frame.scope ?? {}, hook: frame.hook ?? null,
    localsRef: frame.localsRef ?? frame.frameId,
    ...(frame.sourceSkillId && { sourceSkillId: frame.sourceSkillId }) };
}

function logMove(state, host, unit, mode, from, path, collision) {
  const types = { teleport: 'teleport', step: 'move', push: 'knockback', pull: 'knockback', altitude: 'altitude' };
  const verbs = { teleport: '瞬移', step: '移动', push: '被推离', pull: '被拉近', altitude: '改变高度' };
  const to = at(state, unit);
  const destination = `(${to.x}, ${to.y}, z=${to.z})`;
  const text = `${unit.name}${verbs[mode]}至 ${destination}${collision ? '，遇到阻挡' : ''}`;
  host.log(state, unit, types[mode], text, { targetId: unit.id, from, to, path, ...(collision ? { collision } : {}) });
}

function moveDistance(state, frame, context, op) {
  const distance = op.distance === undefined ? 1 : evaluateExpr(op.distance, context);
  if (!Number.isFinite(distance) || op.distanceUnit !== 'position') return distance;
  const ref = frame.carrier;
  const item = ref?.type === 'item' ? own(state.items, ref.id) : null;
  const template = item ? own(state.equipment, item.templateId) : ref?.type === 'skill' ? own(state.skills, ref.id) : context.status;
  const kind = ref?.type === 'skill' && !template?.backpackItem ? 'skill' : 'item';
  const maxBoardSteps = (state.scale?.width ?? 10) + (state.scale?.height ?? 10);
  return scaledMoveCells(distance, resolveEffectiveTier(kind, template?.quality, context.self?.tier), state.scale?.cellM ?? 2, { max: maxBoardSteps });
}

function teleport({ state, frame, host, context, op }, targets) {
  const anchor = targets[0];
  if (!op.ignoreLocks && targets.some(unit => aggregateModifiers(state, unit.id).locks.teleport)) return;
  const destination = resolvePoint(op.to, { ...context, target: context.target ?? anchor });
  if (!point(destination)) return;
  const ignored = new Set(targets.map(unit => unit.id));
  const landings = targets.map(unit => ({ unit, from: at(state, unit),
    to: { x: destination.x + unit.x - anchor.x, y: destination.y + unit.y - anchor.y } }));
  const arrivals = new Map();
  for (const { unit, to } of landings) {
    if (op.distance !== undefined) {
      const limit = moveDistance(state, frame, { ...context, target: unit }, op);
      if (!Number.isFinite(limit) || distance3D(state, unit, { ...unit, ...to }) > limit + 1e-9) return;
    }
    if (!isGround(state, to) || (state.scale?.cellM ?? 2) < 10 && coverAt(state, to.x, to.y)) return;
    const key = cellKey(to);
    const residentCost = () => unitsAt(state, to.x, to.y).filter(other => !ignored.has(other.id))
      .reduce((sum, other) => sum + unitCellCost(state, other), 0);
    const cost = (arrivals.get(key) ?? residentCost()) + unitCellCost(state, unit);
    if (cost > MAX_CELL_CAPACITY) return;
    arrivals.set(key, cost);
  }
  for (const { unit, to } of landings) Object.assign(unit, to);
  refreshFollowingZones(state, host);
  for (const { unit, from } of landings) if (!same(unit, from)) {
    const dx = unit.x - from.x, dy = unit.y - from.y;
    if (dx || dy) unit.lastMoveDir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : (dy < 0 ? 'N' : 'S');
    unit.moved = (unit.moved ?? 0) + Math.max(Math.abs(dx), Math.abs(dy));
    host.hooks?.(state, frame, 'after_move', newEvent(state, { actorId: unit.id, targetId: unit.id,
      fromX: from.x, fromY: from.y, toX: unit.x, toY: unit.y,
      steps: Math.max(Math.abs(dx), Math.abs(dy)), moveKind: 'teleport' }));
    logMove(state, host, unit, 'teleport', from, []);
  }
}

function move(env) {
  const { state, frame, op, context, select, push } = env;
  const targets = select(op.target).filter(unit => own(state.units, unit.id) === unit && live(unit));
  if (!targets.length) return;
  if (op.mode === 'teleport') { teleport(env, targets); return; }
  push({ ...inherit(frame), native: 'spatialMove', data: { op, unitIds: targets.map(unit => unit.id) } });
}

function continueMove({ state, frame, host, context }) {
  const { op, unitIds } = frame.data;
  if (frame.pc >= unitIds.length) { state.vm.stack.pop(); return; }
  const unit = own(state.units, unitIds[frame.pc++]);
  const forced = op.mode === 'push' || op.mode === 'pull' || op.mode === 'step' && op.ignoreLocks;
  if (!live(unit) || (!forced && aggregateModifiers(state, unit.id).locks.move)) return;
  const scope = { ...context, target: unit };
  const from = at(state, unit);
  const path = [];
  let collision;
  if (op.mode === 'altitude') {
    const delta = op.deltaZ === undefined ? 3 : evaluateExpr(op.deltaZ, scope);
    if (!op.land && !Number.isFinite(delta)) return;
    const altitude = op.land ? 0 : clamp((unit.altitude ?? 0) + Math.trunc(delta), 0, 12);
    if (altitude === (unit.altitude ?? 0) || altitude > (unit.altitude ?? 0) && aggregateModifiers(state, unit.id).locks.fly) return;
    unit.altitude = altitude;
  } else if (op.mode === 'step') {
    const to = resolvePoint(op.to, scope);
    const distance = moveDistance(state, frame, scope, op);
    if (!point(to) || !Number.isFinite(distance)) return;
    const steps = findPath(state, unit, to, Math.floor(distance));
    if (!steps?.length) return;
    path.push(...steps);
    Object.assign(unit, xy(to));
  } else {
    const origin = op.to === undefined ? context.self ?? context.source : resolvePoint(op.to, scope);
    const distance = moveDistance(state, frame, scope, op);
    if (!point(origin) || !Number.isFinite(distance)) return;
    const away = facingToward(origin, unit);
    if (!away.some(Boolean)) return;
    for (let step = 0; step < Math.floor(distance); step++) {
      const [dx, dy] = op.mode === 'push' ? away : facingToward(unit, origin);
      if (!dx && !dy) break;
      const next = { x: unit.x + dx, y: unit.y + dy, altitude: unit.altitude ?? 0 };
      if (!canStep(state, unit, next)) { collision = xy(next); break; }
      Object.assign(unit, xy(next));
      path.push(at(state, unit));
    }
    if (!path.length && !collision) return;
  }
  refreshFollowingZones(state, host);
  if (!same(unit, from) || (op.mode === 'altitude' && at(state, unit).z !== from.z)) {
    const dx = unit.x - from.x, dy = unit.y - from.y;
    if (dx || dy) unit.lastMoveDir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : (dy < 0 ? 'N' : 'S');
    unit.moved = (unit.moved ?? 0) + path.length;
    host.hooks?.(state, frame, 'after_move', newEvent(state, { actorId: unit.id, targetId: unit.id,
      fromX: from.x, fromY: from.y, toX: unit.x, toY: unit.y, steps: path.length,
      moveKind: op.mode }));
  }
  logMove(state, host, unit, op.mode, from, path, collision);
  if (!collision) return;
  const target = { type: 'unit', id: unit.id };
  const inherited = inherit(frame);
  if (op.onCollide?.length) pushFrame(state, { ...inherited, kind: frame.hook ? 'hook' : 'action',
    scope: { ...inherited.scope, target }, program: op.onCollide });
  const amount = evaluateExpr(op.collisionDamage, scope);
  if (Number.isFinite(amount) && amount > 0) scheduleCommit(state, frame, {
    op: 'damage', pool: 'hp', damageType: 'true', direct: false, amount, targetId: unit.id,
    sourceId: context.self?.id ?? frame.sourceId, label: op.label ?? '撞击',
  });
}

function carrier(spec, sourceId, id, templateId, context, { allowUnitPools = false } = {}) {
  const vars = Object.fromEntries(Object.entries(spec.vars ?? {}).flatMap(([key, expression]) => {
    const value = evaluateExpr(expression, context);
    return value === null ? [] : [[key, value]];
  }));
  return { id, templateId, name: spec.name ?? templateId, sourceId, tier: spec.tier ?? context.self?.tier ?? 1,
    tags: [...(spec.tags ?? [])], vars, mods: structuredClone(spec.mods ?? []), rules: structuredClone(spec.rules ?? []),
    ...(spec.flags?.length ? { flags: [...spec.flags] } : {}),
    ...(spec.shareRulesTo ? { shareRulesTo: structuredClone(spec.shareRulesTo) } : {}),
    ...(allowUnitPools && spec.unitPools ? { unitPools: structuredClone(spec.unitPools) } : {}) };
}

function publishOut(state, frame, out, id) {
  if (out === undefined || !id) return;
  const registers = state.vm.stack.find(entry => entry.frameId === frame.localsRef) ?? frame;
  Object.defineProperty(registers.vars, out, { value: id, writable: true, enumerable: true, configurable: true });
}

function itemPlan(state, templateId, context) {
  const template = own(state.equipment, templateId);
  if (!template) return undefined;
  const pools = Object.entries(template.pools ?? {}).map(([key, definition]) => {
    const max = evaluateExpr(definition.cap, context);
    const current = definition.initial === undefined ? max : evaluateExpr(definition.initial, context);
    return { key, max, current, reloadable: definition.reloadable === true };
  });
  if (pools.some(({ max, current }) => !Number.isFinite(max) || max < 0 || !Number.isFinite(current))) return undefined;
  return { template, templateId, pools };
}

function mintItem(state, plan, sourceId, ownerId, context) {
  const id = nextId(state, state.items ??= {}, 'item');
  const { template, templateId, pools } = plan;
  const item = { ...carrier(template, sourceId, id, templateId, context), ownerId };
  state.items[id] = item;
  for (const pool of pools) createPool(state, { ...pool, ownerKind: 'item', ownerId: id });
  return id;
}

function spawnItems({ state, frame, host, context, op }) {
  const owner = context.target && own(state.units, context.target.id) === context.target ? context.target : context.self;
  if (!live(owner)) return;
  const { templateId, count = 1 } = op.spec;
  const plan = itemPlan(state, templateId, { ...context, target: owner });
  if (!plan || values(state.items).length + count > 200) return;
  let first;
  for (let i = 0; i < count; i++) {
    const id = mintItem(state, plan, context.self?.id ?? frame.sourceId, owner.id, context);
    (owner.inventory ??= {})[templateId] = (own(owner.inventory, templateId) ?? 0) + 1;
    first ??= id;
  }
  publishOut(state, frame, op.out, first);
  host.log(state, owner, 'spawn', `${owner.name}获得 ${count} 件${plan.template.name ?? templateId}`, { itemId: first, count });
}

function unitPlan(state, context, spec, original) {
  const actor = context.self;
  const count = spec.count ?? 1;
  const panelSpec = spec.spawnPanel ? { ...spec.spawnPanel, tier: spec.tier ?? spec.spawnPanel.tier, count } : null;
  const issue = panelSpec && spawnBudgetIssue(actor, panelSpec);
  if (issue) return { error: 'budget_exceeded', detail: issue };
  const panel = panelSpec ? spawnPanel(actor, panelSpec) : original;
  if (!panel || !panel.stats || ![panel.maxHp, panel.maxMp, panel.maxSp].every(Number.isFinite)
      || panel.maxHp <= 0 || panel.maxMp < 0 || panel.maxSp < 0) return undefined;
  const loads = spec.spawnPanel ?? original;
  const equipment = id => spec.copyOf ? own(state.items, id)?.templateId ?? id : id;
  const gear = Object.fromEntries(['mainHand', 'offHand', 'shield'].map(slot => [slot,
    equipment(loads[slot] ?? (slot === 'mainHand' ? loads.weapon : null)) ?? null]));
  gear.gear = (loads.gear ?? []).map(equipment);
  const items = [...new Set([gear.mainHand, gear.offHand, gear.shield, ...gear.gear].filter(Boolean))];
  const equipmentId = items.find(id => !own(state.equipment, id));
  if (equipmentId) return { error: 'missing_equipment', detail: { equipmentId } };
  const skillId = loads.skills?.find(id => !own(state.skills, id));
  if (skillId) return { error: 'missing_skill', detail: { skillId } };
  if (items.some(id => !itemPlan(state, id, context))) return undefined;
  const bodyLengthM = panel.bodyLengthM ?? 1.7;
  const stats = { ...panel.stats };
  // Shared-pool mirrors aggregate the entire pool. Copy only the original unit's contribution.
  const maxima = Object.fromEntries(['hp', 'mp', 'sp'].map(key => {
    const pool = own(state.pools, own(panel.pools, key));
    const field = `max${capitalize(key)}`;
    const contributor = pool?.contributors.find(entry => entry.ownerKind === 'unit' && entry.ownerId === panel.id);
    return [field, contributor?.maxBase ?? panel[field]];
  }));
  const resolvedTier = spec.copyOf ? spec.tier ?? panel.tier ?? actor.tier : panel.tier;
  const tier = Math.max(1, Math.min(7, Math.trunc(Number(resolvedTier) || 1)));
  const rawMove = spec.move != null ? Math.max(0, Number(spec.move))
    : panel.rawMove ?? (spec.copyOf && panel.moveM != null
      ? panel.moveM / TIER_CELL_M[tier]
      : panel.move ?? defaultMoveFromAgi(stats.agi, tier));
  return { count, gear, panel: { stats, ...maxima, bodyLengthM, size: panel.size ?? sizeClassFor(bodyLengthM),
    mc: panel.mc ?? sizeMultiplier(bodyLengthM), armor: panel.armor ?? 0, rawMove, move: Math.round(rawMove),
    skills: [...(loads.skills ?? [])], team: actor.team, facing: [...(actor.facing ?? [1, 0])],
    level: (spec.templateId && original?.level) || actor.level || actor.tier || 1, tier } };
}

export function removeSummon(state, unit, host, frame, reason, seen = new Set()) {
  if (seen.has(unit.id) || own(state.units, unit.id) !== unit) return;
  cleanupSourceBoundEntities(state, unit.id, '来源离场', host, frame, seen);
  for (const zone of values(state.zones)) if (zone.area?.anchorUnitId === unit.id) removeZone(state, host, zone.id, '锚点离场');
  if (reason) host.log(state, unit, 'despawn', `${unit.name}因${reason}离场`, { unitId: unit.id, summoned: true, reason });
  const shared = ['hp', 'mp', 'sp'].filter(key => own(state.pools, own(unit.pools, key))?.contributors.length > 1);
  if (shared.length) unlinkPools(state, [unit.id], shared);
  const ownedItems = values(state.items).filter(item => item.ownerId === unit.id);
  for (const carrier of [unit, ...ownedItems, ...values(unit.statuses)]) {
    for (const poolId of values(carrier.pools)) delete state.pools[poolId];
  }
  for (const item of ownedItems) delete state.items[item.id];
  delete state.units[unit.id];
  const index = state.order.indexOf(unit.id);
  if (index !== -1) {
    state.order.splice(index, 1);
    if (index < state.turn) state.turn--;
    if (reason && state.turn >= state.order.length) state.turn = Math.max(0, state.order.length - 1);
  }
}

function logSpawnFailure(state, host, actor, name, reason, detail = {}) {
  const messages = {
    budget_exceeded: () => `五维面板超出施术者预算（单项上限 ${detail.cap}，总和上限 ${detail.sum}，实际 [${Object.values(detail.stats)}] 合计 ${detail.actualSum}）`,
    missing_template: () => `找不到召唤模板 ${detail.templateId}`,
    missing_equipment: () => `找不到装备模板 ${detail.equipmentId}`,
    missing_skill: () => `找不到技能 ${detail.skillId}`,
    invalid_panel: () => '召唤面板、引用或数值无效',
    max_active: () => `同组在场数量已达上限（${detail.maxActive}）`,
    capacity: () => '可用格子或实体槽不足',
    reentrant_group: () => '同组召唤正在结算',
  };
  host.log(state, actor, 'spawn', `${name}未能登场：${messages[reason]()}`, { failed: true, reason, ...detail });
}

function summonLandings(state, { center, explicitAt, plan }, leaving = new Set()) {
  const candidates = cells(state).filter(cell => !same(cell, center) || !explicitAt)
    .filter(cell => !blocked(state, cell, leaving))
    .sort((a, b) => distance3D(state, center, a) - distance3D(state, center, b));
  if (explicitAt && isGround(state, center) && ((state.scale?.cellM ?? 2) >= 10 || !coverAt(state, center.x, center.y))) {
    const occupied = unitsAt(state, center.x, center.y).filter(unit => !leaving.has(unit.id))
      .reduce((total, unit) => total + unitCellCost(state, unit), 0);
    const available = Math.floor((MAX_CELL_CAPACITY - occupied) / unitCellCost(state, plan.panel));
    candidates.unshift(...Array.from({ length: Math.max(0, available) }, () => xy(center)));
  }
  return candidates.slice(0, plan.count).map(cell => ({ ...cell, altitude: Number.isFinite(center.z)
    ? clamp(Math.round(center.z - elevation(state, cell)), 0, 12) : 0 }));
}

function spawnUnits({ state, frame, host, context, op, select, push }, center) {
  const requested = op.spec;
  const firstUnit = selector => select(selector).find(unit => own(state.units, unit.id) === unit);
  const actor = requested.summoner ? firstUnit(requested.summoner) : context.self;
  const original = requested.copyOf ? firstUnit(requested.copyOf) : own(state.summonTemplates, requested.templateId);
  const name = requested.name ?? original?.name ?? requested.templateId ?? '召唤物';
  const fail = (reason, detail) => logSpawnFailure(state, host, actor ?? context.self, name, reason, detail);
  if (requested.templateId && !original) return fail('missing_template', { templateId: requested.templateId });
  if (!actor || !point(center) || requested.copyOf && !original) return fail('invalid_panel');
  const form = requested.copyOf ? 'copy' : requested.spawnPanel ? 'panel' : requested.templateId ? 'template' : 'panel';
  const defaults = {};
  if (requested.templateId) for (const key of ['group', 'maxActive', 'stackPolicy', 'remainingTurns']) {
    if (original[key] !== undefined) defaults[key] = original[key];
  }
  const spec = resolveSpawnSpec({ ...defaults, ...requested, ...(requested.copyOf ? {} : { spawnPanel: { ...original, ...requested.spawnPanel } }) }, context, 'unit');
  if (!spec) return fail('invalid_panel');
  const templateId = spec.templateId ?? original?.templateId ?? original?.id ?? frame.ruleId ?? 'summon';
  const group = JSON.stringify(spec.group ? [actor.id, spec.group]
    : [actor.id, context.event.skillId ?? null, frame.ruleId, form, templateId, spec.name ?? null]);
  const durationUnit = spec.durationUnit ?? (spec.templateId ? original.durationUnit : undefined) ?? 'rounds';
  const timed = spec.remainingTurns !== undefined;
  const turnMode = spec.turnMode ?? (spec.templateId ? original.turnMode : undefined) ?? 'independent';
  const turnAnchor = spec.turnAnchor ? firstUnit(spec.turnAnchor) : actor;
  if (['linked_group', 'linked_each'].includes(turnMode) && !live(turnAnchor)) return fail('invalid_panel');
  const anchor = timed && durationUnit === 'anchor_turns' ? (spec.durationAnchor ? firstUnit(spec.durationAnchor) : turnAnchor) : null;
  if (timed && durationUnit === 'anchor_turns' && !anchor) return fail('invalid_panel');
  // An eviction hook may summon another group, but cannot reenter its own replacement.
  if (state.vm.stack.some(entry => entry.native === 'spatialSpawn' && entry.data.group === group)) return fail('reentrant_group');
  const groupUnits = values(state.units).filter(unit => unit.summoned && unit.summonGroup === group && unit.id !== actor.id);
  for (const old of groupUnits) {
    if (!live(old) && !aggregateModifiers(state, old.id).flags.blockRevive) removeSummon(state, old, host, frame);
  }
  const serial = unit => Number(unit.id.match(/^summon-(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const livingGroup = groupUnits.filter(live).sort((a, b) => serial(a) - serial(b));
  const stackPolicy = spec.stackPolicy ?? 'replace';
  const maxActive = spec.maxActive ?? (stackPolicy === 'replace' ? Infinity : 12);
  const allowed = stackPolicy === 'cap' ? Math.max(0, maxActive - livingGroup.length) : maxActive;
  const count = Math.min(spec.count ?? 1, allowed);
  if (!count) return fail('max_active', { maxActive });
  const plan = unitPlan(state, { ...context, self: actor }, { ...spec, count }, original);
  if (!plan || plan.error) return fail(plan?.error ?? 'invalid_panel', plan?.detail);
  const evictCount = stackPolicy === 'replace' ? livingGroup.length : stackPolicy === 'fifo' ? Math.max(0, livingGroup.length + count - maxActive) : 0;
  const evictIds = livingGroup.slice(0, evictCount).map(unit => unit.id);
  const fields = carrier({ ...original, ...spec, tier: plan.panel.tier,
    vars: { ...(spec.copyOf ? {} : original?.vars), ...spec.vars },
    unitPools: original?.unitPools || spec.unitPools ? { ...original?.unitPools, ...spec.unitPools } : undefined,
  }, actor.id, '', templateId, context, { allowUnitPools: true });
  if (spec.copyOf) fields.vars = { ...(original.vars ?? {}), ...fields.vars };
  Object.assign(fields, effectLifecycle(state, frame, context.event, requested, requested.templateId ? original : null));
  if (!canPlaceBoundEffect(state, fields)) return;
  const explicitAt = op.at !== undefined;
  const z = explicitAt ? center.z : undefined;
  const data = { plan, center: { ...xy(center), ...(Number.isFinite(z) && { z }) }, explicitAt,
    out: op.out ?? null, fields, group, evictIds, pendingId: null, turnMode, turnAnchorId: turnAnchor?.id,
    moraleType: actor.moraleType ?? state.battleType ?? 'standard',
    ...(timed && { duration: { remainingTurns: spec.remainingTurns, durationUnit, ...(anchor && { durationAnchorId: anchor.id }) } }) };
  const leaving = new Set(data.evictIds);
  const slots = [plan.gear.mainHand, plan.gear.offHand, plan.gear.shield, ...plan.gear.gear].filter(Boolean);
  const keptItems = values(state.items).filter(item => !leaving.has(item.ownerId)).length;
  if (values(state.units).length - leaving.size + plan.count > 200 || keptItems + slots.length * plan.count > 200
    || summonLandings(state, data, leaving).length < plan.count) {
    return fail('capacity');
  }
  const sourceSkillId = frame.sourceSkillId ?? (frame.carrier?.type === 'skill' ? frame.carrier.id : undefined);
  push({ ...inherit(frame), native: 'spatialSpawn', data, ...(sourceSkillId && { sourceSkillId }) });
}

function continueSpawn({ state, frame, host, context }) {
  const { data } = frame;
  const actor = own(state.units, data.fields.sourceId);
  if (data.pendingId) {
    const old = own(state.units, data.pendingId);
    if (old) {
      host.log(state, old, 'spawn', `${old.name}结束召唤并离场`, { unitId: old.id, evicted: true });
      removeSummon(state, old, host, frame);
    }
    data.pendingId = null;
    delete frame.awaitEvent;
    if (state.vm.stack.at(-1) !== frame) return;
  }
  if (!actor || !canPlaceBoundEffect(state, data.fields)) { state.vm.stack.pop(); return; }
  while (frame.pc < data.evictIds.length) {
    const old = own(state.units, data.evictIds[frame.pc++]);
    if (!old || old.summonGroup !== data.group) continue;
    if (!live(old)) {
      removeSummon(state, old, host, frame);
      if (state.vm.stack.at(-1) !== frame) return;
      continue;
    }
    data.pendingId = old.id;
    frame.awaitEvent = newEvent(state, { actorId: data.fields.sourceId, targetId: old.id,
      sourceId: data.fields.sourceId, summonId: old.id, templateId: old.templateId, center: at(state, old), reason: 'replaced',
      ...(old.sourceSkillId && { sourceSkillId: old.sourceSkillId }) });
    scheduleHooks(state, frame, 'on_summon_evict', frame.awaitEvent, host);
    return;
  }
  const { plan } = data;
  const landings = summonLandings(state, data);
  const { gear } = plan;
  const templateIds = [gear.mainHand, gear.offHand, gear.shield, ...gear.gear].filter(Boolean);
  const items = new Map(templateIds.map(id => [id, itemPlan(state, id, context)]));
  if (landings.length < plan.count || values(state.units).length + plan.count > 200 || [...items.values()].some(item => !item)
      || values(state.items).length + templateIds.length * plan.count > 200) {
    const equipmentId = templateIds.find(id => !own(state.equipment, id));
    const reason = equipmentId ? 'missing_equipment' : [...items.values()].some(item => !item) ? 'invalid_panel' : 'capacity';
    logSpawnFailure(state, host, actor, data.fields.name, reason, equipmentId ? { equipmentId } : {});
    state.vm.stack.pop();
    return;
  }
  if (data.fields.concentration && !frame.switchedConcentration) {
    frame.switchedConcentration = true;
    switchConcentration(state, data.fields, host, frame);
    return;
  }
  let first;
  for (const placement of landings) {
    const id = nextId(state, state.units, 'summon');
    const unit = { ...structuredClone(plan.panel), ...structuredClone(data.fields), id, ...placement,
      moraleType: data.moraleType, summonGroup: data.group, summoned: true, used: { attack: 0, action: 0 }, ap: 0, statuses: {},
      ...(data.turnMode !== 'independent' && { turnMode: data.turnMode }),
      ...(['linked_group', 'linked_each'].includes(data.turnMode) && { turnAnchorId: data.turnAnchorId }),
      ...data.duration,
      ...(frame.sourceSkillId && { sourceSkillId: frame.sourceSkillId }) };
    unit.moveM = unit.rawMove * TIER_CELL_M[Math.max(1, Math.min(7, unit.tier ?? 1))];
    unit.move = boardMoveCellsFromMoveM(unit.moveM, state.scale);
    unit.moveCarryPermille = 0;
    unit.hp = unit.maxHp;
    unit.mp = unit.maxMp;
    unit.sp = unit.maxSp;
    state.units[id] = unit;
    initializeUnitPools(state, id);
    const mint = templateId => templateId ? mintItem(state, items.get(templateId), data.fields.sourceId, id, context) : null;
    unit.weapon = unit.mainHand = mint(gear.mainHand);
    unit.offHand = mint(gear.offHand);
    unit.shield = mint(gear.shield);
    unit.attunementCharges = stanceRules('attunement').itemCharges;
    unit.stance = stanceFor({ mainHand: state.equipment[gear.mainHand], offHand: state.equipment[gear.offHand], shield: state.equipment[gear.shield] });
    unit.gear = gear.gear.map(mint);
    syncUnitPools(state, unit);
    if (data.turnMode === 'independent') state.order.push(id);
    else host.initializeSummonTurn?.(state, unit);
    first ??= id;
    host.log(state, actor, 'spawn', `${unit.name}登场`, { unitId: id, ...at(state, unit) });
  }
  publishOut(state, frame, data.out ?? undefined, first);
  state.vm.stack.pop();
}

function spawnZone({ state, frame, host, context, op }, center) {
  const { spec } = op;
  const area = structuredClone(spec.area);
  const anchorRef = area.anchorUnitId;
  const anchorId = anchorRef?.startsWith('vars.')
    ? context.resolveEntity(own(context.vars, anchorRef.slice(5)), 'unit')?.id : anchorRef;
  const anchor = own(state.units, anchorRef === undefined && spec.follow ? context.self?.id : anchorId);
  if ((anchorRef || spec.follow) && !live(anchor)) return;
  const centerRef = area.origin ?? area.center;
  const origin = centerRef === undefined ? anchor ?? center : resolvePoint(centerRef, context);
  if ((centerRef !== undefined || ['circle', 'ring', 'single'].includes(area.shape)) && !point(origin)) return;
  delete area.origin;
  if (['circle', 'ring'].includes(area.shape) && !Number.isFinite(area.radius)) return;
  if (origin) area.center = xy(origin);
  if (spec.follow) area.anchorUnitId = anchor.id;
  else delete area.anchorUnitId;
  const sourceId = context.self?.id ?? frame.sourceId;
  const lifecycle = effectLifecycle(state, frame, context.event, spec);
  const effect = { sourceId, ...lifecycle };
  if (!canPlaceBoundEffect(state, effect)) return;
  switchConcentration(state, effect, host, frame);
  if (spec.follow && own(state.units, anchor.id) !== anchor) return;
  const id = nextId(state, state.zones ??= {}, 'zone');
  const zone = { ...carrier(spec, sourceId, id, spec.templateId ?? id, context), ...lifecycle, team: context.self?.team ?? null,
    area, follow: spec.follow === true, persistent: spec.persistent === true, remainingTurns: spec.remainingTurns ?? 1,
    ...(spec.follow ? { anchorPosition: xy(anchor) } : {}) };
  state.zones[id] = zone;
  publishOut(state, frame, op.out, id);
  host.log(state, context.self, 'zone', `展开${zone.name}`, { zoneId: id });
}

export function removeZone(state, host, zoneId, reason = '解除', detail = {}) {
  const zone = own(state.zones, zoneId);
  if (!zone) return false;
  delete state.zones[zoneId];
  for (const poolId of values(zone.pools)) delete state.pools[poolId];
  host.log(state, own(state.units, zone.sourceId), 'zone', `${zone.name}${reason}后消散`, { zoneId, expired: true, ...detail });
  return true;
}

export function refreshFollowingZones(state, host) {
  for (const zone of values(state.zones)) {
    if (!zone.follow) continue;
    const anchor = own(state.units, zone.area.anchorUnitId);
    if (!live(anchor)) { removeZone(state, host, zone.id, '锚点离场'); continue; }
    const previous = zone.anchorPosition ?? anchor;
    const dx = anchor.x - previous.x, dy = anchor.y - previous.y;
    const { area } = zone;
    area.center = xy(anchor);
    zone.anchorPosition = xy(anchor);
    if (area.rect) {
      area.rect.x1 += dx;
      area.rect.x2 += dx;
      area.rect.y1 += dy;
      area.rect.y2 += dy;
    }
    if (area.cells) for (const cell of area.cells) { cell.x += dx; cell.y += dy; }
  }
}

function terrainTile(tile, spec) {
  const mode = spec.mode ?? 'set';
  let z = tile.z;
  if (spec.height !== undefined) {
    const height = Math.trunc(spec.height);
    z = clamp(mode === 'set' ? height : z + (mode === 'raise' ? height : -height), -4, 8);
  }
  return { ...tile, z, kind: spec.kind ?? tile.kind };
}

function spawnTerrain({ state, frame, host, context, op }, center) {
  if (!center) return;
  const { spec, entityKind } = op;
  const area = spec.area;
  const origin = area?.origin == null && area?.center == null ? center : resolvePoint(area.origin ?? area.center, context);
  if (!origin) return;
  let selected = [center];
  if (area?.shape === 'rect') {
    selected = cells(state).filter(p => Math.abs(p.x - origin.x) <= (area.width ?? area.radius ?? 0)
      && Math.abs(p.y - origin.y) <= (area.radius ?? area.width ?? 0));
  } else if (area) {
    selected = selectVM(state, { from: 'cells', area: { ...area, origin } }, { ...context, target: center }, { pure: true });
  }
  const cover = entityKind === 'cover';
  const spots = selected.filter(p => cellAt(state, p.x, p.y) && (!(cover || spec.kind === 'wall')
    || (!blocked(state, p) && !fixture(state, p))));
  if (!spots.length || cover && values(state.covers).length + spots.length > 200) return;
  const effects = state.spatialTerrain ??= {};
  if (values(effects).length >= 64) return;
  const id = nextId(state, effects, 'terrain');
  const effect = { id, spec: area ? { ...spec, area: { ...area, origin: xy(origin) } } : spec,
    cells: [], coverIds: [], persistent: spec.persistent ?? spec.remainingTurns === undefined,
    remainingTurns: spec.remainingTurns ?? 1 };
  effects[id] = effect;
  for (const p of spots) {
    if (cover) {
      const coverId = nextId(state, state.covers ??= {}, 'cover');
      const hp = spec.hp ?? 10;
      state.covers[coverId] = { id: coverId, ...xy(p), name: spec.name ?? '掩体', hp, maxHp: hp,
        cover: spec.cover ?? 2, material: spec.material ?? '地形效果' };
      effect.coverIds.push(coverId);
    } else {
      const before = state.grid[p.y][p.x];
      effect.cells.push({ ...xy(p), before });
      state.grid[p.y][p.x] = terrainTile(before, spec);
    }
  }
  const drops = effect.cells.map(p => ({ ...p, after: state.grid[p.y][p.x] }));
  scheduleTerrainFalls(state, frame, drops);
  publishOut(state, frame, op.out, effect.coverIds[0] ?? id);
  host.log(state, context.self, 'terrain', `${cover ? '掩体' : '地形变化'}影响了 ${spots.length} 格`,
    { terrainId: id, count: spots.length });
}

function scheduleTerrainFalls(state, parent, changes) {
  if (!parent) return;
  const height = tile => tile.kind === 'slope' ? 1 : tile.z;
  for (const p of changes.slice().reverse()) {
    if (p.after.kind === 'wall') continue;
    const drop = height(p.before) - height(p.after);
    const unit = drop > 0 && unitAt(state, p.x, p.y);
    if (!unit || unit.altitude > 0) continue;
    scheduleCommit(state, parent, { op: 'damage', pool: 'hp', damageType: 'true', direct: false,
      amount: drop * 50, targetId: unit.id, sourceId: null, label: '地形高度下降' });
  }
}

function removeCovers(state, ids) {
  if (!ids.size) return;
  for (const id of ids) delete state.covers[id];
  for (const effect of values(state.spatialTerrain)) {
    if (!effect.coverIds.some(id => ids.has(id))) continue;
    effect.coverIds = effect.coverIds.filter(id => !ids.has(id));
  }
}

function settleRestoredWalls(state, host, walls, parent) {
  const wallKeys = new Set(walls.map(cellKey));
  removeCovers(state, new Set(values(state.covers).filter(cover => wallKeys.has(cellKey(cover))).map(cover => cover.id)));
  for (const item of values(state.interactives)) {
    if (wallKeys.has(cellKey(item))) delete state.interactives[item.id];
  }
  for (const p of walls) {
    const unit = unitAt(state, p.x, p.y);
    if (!unit) continue;
    const destination = cells(state).filter(cell => !blocked(state, cell))
      .sort((a, b) => distance3D(state, p, a) - distance3D(state, p, b))[0];
    if (destination) {
      const from = { ...xy(unit), z: p.before.z + (unit.altitude ?? 0) };
      Object.assign(unit, xy(destination));
      logMove(state, host, unit, 'step', from, [at(state, unit)]);
    } else if (parent) {
      scheduleCommit(state, parent, { op: 'damage', pool: 'hp', damageType: 'true', direct: false,
        amount: unit.hp, targetId: unit.id, sourceId: parent.sourceId, label: '地形恢复后无可站立格' });
    }
  }
}

function removeTerrainLayers(state, host, parent, ids, reason) {
  if (!ids.size) return;
  const layers = values(state.spatialTerrain);
  const removed = layers.filter(layer => ids.has(layer.id));
  const affected = new Set(removed.flatMap(layer => layer.cells.map(cellKey)));
  const changes = new Map();
  // Each cell's oldest patch holds its native tile. Replay surviving layers in creation order.
  for (const layer of layers) {
    for (const patch of layer.cells) {
      const key = cellKey(patch);
      if (!affected.has(key)) continue;
      let change = changes.get(key);
      if (!change) {
        change = { ...xy(patch), before: state.grid[patch.y][patch.x], after: patch.before };
        changes.set(key, change);
      }
      if (!ids.has(layer.id)) {
        if (!change.firstSurvivor) {
          patch.before = change.after;
          change.firstSurvivor = true;
        }
        change.after = terrainTile(change.after, layer.spec);
      }
    }
  }
  for (const { x, y, after } of changes.values()) state.grid[y][x] = after;
  for (const layer of removed) delete state.spatialTerrain[layer.id];
  removeCovers(state, new Set(removed.flatMap(layer => layer.coverIds)));

  const restored = [...changes.values()];
  scheduleTerrainFalls(state, parent, restored);
  settleRestoredWalls(state, host, restored.filter(p => p.before.kind !== 'wall' && p.after.kind === 'wall'), parent);
  refreshFollowingZones(state, host);
  for (const layer of removed) {
    host.log(state, null, 'terrain', `地形效果${reason}还原`, { terrainId: layer.id });
  }
}

/** Call on lifecycle boundaries. Set advance once per round after round-end hooks. */
export function expireSpatialEffects(state, host, { advance = false, anchorUnitId = null, parent = state.vm?.stack.at(-1) } = {}) {
  refreshFollowingZones(state, host);
  if (!advance) return;
  for (const id of Object.keys(state.units).sort()) {
    const unit = own(state.units, id);
    if (unit?.summoned && unit.durationUnit === 'anchor_turns' && (unit.bindToSource || unit.concentration)
        && !live(own(state.units, unit.durationAnchorId))) removeSummon(state, unit, host, parent, '锚点离场');
  }
  const expiring = values(state.units).filter(unit => unit.summoned && unit.remainingTurns != null
    && (anchorUnitId === null ? (unit.durationUnit ?? 'rounds') === 'rounds'
      || !live(own(state.units, unit.durationAnchorId)) : unit.durationUnit === 'anchor_turns' && unit.durationAnchorId === anchorUnitId)
    && --unit.remainingTurns === 0);
  for (const unit of expiring.reverse()) {
    unit.remainingTurns = 1;
    pushFrame(state, { kind: 'action', native: 'expireSummon', ownerId: unit.id, sourceId: unit.sourceId ?? unit.id });
  }
  if (anchorUnitId !== null) return;
  for (const zone of values(state.zones)) {
    if (!zone.persistent && --zone.remainingTurns <= 0) removeZone(state, host, zone.id, '到期');
  }
  const expired = values(state.spatialTerrain).filter(layer => !layer.persistent && --layer.remainingTurns <= 0);
  removeTerrainLayers(state, host, parent, new Set(expired.map(layer => layer.id)), '到期');
}

function despawn({ state, frame, host, context, op, select }) {
  const targets = new Set(select(op.select));
  if (!targets.size) return;
  if (op.entityKind === 'zone') {
    for (const zone of targets) {
      if (own(state.zones, zone.id) === zone) removeZone(state, host, zone.id);
    }
  } else if (op.entityKind === 'cover') {
    const covers = [...targets].filter(cover => own(state.covers, cover.id) === cover);
    removeCovers(state, new Set(covers.map(cover => cover.id)));
    for (const cover of covers) {
      host.log(state, context.self, 'terrain', `${cover.name ?? '掩体'}被移除`, { coverId: cover.id });
    }
  } else if (op.entityKind === 'terrain') {
    const layers = [...targets].filter(layer => own(state.spatialTerrain, layer.id) === layer && layer.cells.length);
    removeTerrainLayers(state, host, frame, new Set(layers.map(layer => layer.id)), '解除后');
  } else if (op.entityKind === 'unit') {
    for (const unit of targets) {
      if (own(state.units, unit.id) !== unit || unit.summoned !== true) continue;
      removeSummon(state, unit, host, frame);
      host.log(state, context.self, 'despawn', `${unit.name}被移除`, { unitId: unit.id, summoned: true });
    }
  }
}

function spawn(env) {
  const { op, context } = env;
  const center = () => op.at === undefined ? context.center ?? context.target ?? context.self : resolvePoint(op.at, context);
  if (op.entityKind === 'unit') return spawnUnits(env, center());
  const spec = resolveSpawnSpec(op.spec, context, op.entityKind);
  if (!spec) return;
  const resolved = { ...env, op: { ...op, spec } };
  if (op.entityKind === 'item') { spawnItems(resolved); return; }
  const location = center();
  if ((op.at !== undefined && !location) || (location && !point(location))) return;
  if (op.entityKind === 'zone') spawnZone(resolved, location);
  else spawnTerrain(resolved, location);
}

export const spatialOps = Object.freeze({ move, spawn, despawn });
function continueExpireSummon({ state, frame, host }) {
  const unit = own(state.units, frame.ownerId);
  if (unit && frame.pc === 0 && live(unit)) {
    frame.pc++;
    frame.awaitEvent = newEvent(state, { actorId: unit.id, targetId: unit.id, deadId: unit.id, sourceId: unit.sourceId ?? null,
      summonId: unit.id, templateId: unit.templateId ?? null, sourceSkillId: unit.sourceSkillId ?? null, center: at(state, unit), reason: 'expired' });
    scheduleHooks(state, frame, 'on_summon_evict', frame.awaitEvent, host);
    return;
  }
  if (unit && frame.pc === 1 && live(unit)) {
    frame.pc++;
    scheduleHooks(state, frame, 'on_death', frame.awaitEvent, host);
    return;
  }
  if (unit) {
    host.log(state, unit, 'despawn', `${unit.name}召唤期限结束`, { unitId: unit.id, summoned: true, expired: true });
    state.vm.stack.pop();
    removeSummon(state, unit, host, frame);
    if (state.turn >= state.order.length) state.turn = 0;
    return;
  }
  state.vm.stack.pop();
}

export const spatialContinuations = Object.freeze({ spatialMove: continueMove, spatialSpawn: continueSpawn, expireSummon: continueExpireSummon });
