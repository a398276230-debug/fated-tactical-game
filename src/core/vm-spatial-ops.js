import { resolveEffectiveTier, scaledMoveCells, sizeClassFor } from './combat_protocol.js';
import { evaluateExpr } from './formula.js';
import { MAX_CELL_CAPACITY, unitCellCost, canOccupy, cellAt, canStep, coverAt, distance3D, elevation, facingToward, findPath, isGround, unitAt, unitsAt } from './spatial.js';
import { spawnPanel } from './spawn-unit.js';
import { newEvent, pushFrame, scheduleHooks } from './tactical-vm.js';
import { scheduleCommit } from './vm-commit.js';
import { createPool, initializeUnitPools, unlinkPools } from './vm-pools.js';
import { resolvePoint, selectVM } from './vm-select.js';
import { aggregateModifiers } from './vm-carriers.js';

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
  const bounds = { tier: [1, 7], count: [1, kind === 'unit' ? 10 : Infinity], remainingTurns: [1, 100] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (spec[key] === undefined) continue;
    resolved[key] = spawnNumber(spec[key], context, min, max);
    if (resolved[key] === undefined) return;
  }
  if (spec.spawnPanel?.tier !== undefined) {
    const tier = spawnNumber(spec.spawnPanel.tier, context, 1, 7);
    if (tier === undefined) return;
    resolved.spawnPanel = { ...spec.spawnPanel, tier };
  }
  if (spec.area?.radius !== undefined) {
    const radius = spawnNumber(spec.area.radius, context, 0, Infinity, false);
    if (radius === undefined) return;
    resolved.area = { ...spec.area, radius };
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
  return scaledMoveCells(distance, resolveEffectiveTier(kind, template?.quality, context.self?.tier), state.scale?.cellM ?? 2);
}

function teleport({ state, frame, host, context, op }, targets) {
  const anchor = targets[0];
  if (targets.some(unit => aggregateModifiers(state, unit.id).locks.teleport)) return;
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
  for (const { unit, from } of landings) if (!same(unit, from)) logMove(state, host, unit, 'teleport', from, []);
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
  if (!live(unit) || (op.mode !== 'push' && op.mode !== 'pull' && aggregateModifiers(state, unit.id).locks.move)) return;
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

function carrier(spec, sourceId, id, templateId, context) {
  const vars = Object.fromEntries(Object.entries(spec.vars ?? {}).flatMap(([key, expression]) => {
    const value = evaluateExpr(expression, context);
    return value === null ? [] : [[key, value]];
  }));
  return { id, templateId, name: spec.name ?? templateId, sourceId, tier: spec.tier ?? context.self?.tier ?? 1,
    tags: [...(spec.tags ?? [])], vars, mods: structuredClone(spec.mods ?? []), rules: structuredClone(spec.rules ?? []) };
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
  const panel = spec.spawnPanel ? spawnPanel(actor, { ...spec.spawnPanel, tier: spec.tier ?? spec.spawnPanel.tier, count }) : original;
  if (!panel || !panel.stats || ![panel.maxHp, panel.maxMp, panel.maxSp].every(Number.isFinite)
      || panel.maxHp <= 0 || panel.maxMp < 0 || panel.maxSp < 0) return undefined;
  const loads = spec.spawnPanel ?? original;
  const equipment = id => own(state.items, id)?.templateId ?? id;
  const gear = Object.fromEntries(['mainHand', 'offHand', 'shield'].map(slot => [slot,
    equipment(loads[slot] ?? (slot === 'mainHand' ? loads.weapon : null)) ?? null]));
  gear.gear = (loads.gear ?? []).map(equipment);
  const items = [...new Set([gear.mainHand, gear.offHand, gear.shield, ...gear.gear].filter(Boolean))];
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
  return { count, gear, panel: { stats, ...maxima, bodyLengthM, size: panel.size ?? sizeClassFor(bodyLengthM),
    mc: panel.mc ?? (bodyLengthM >= 10 ? 2 : 1), armor: panel.armor ?? 0, move: panel.move ?? 3,
    skills: [...(loads.skills ?? [])], team: actor.team, facing: [...(actor.facing ?? [1, 0])],
    tier: panel.tier ?? actor.tier ?? 1 } };
}

function removeSummon(state, unit) {
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
  }
}

function spawnUnits({ state, frame, host, context, op, select, push }, center) {
  const actor = context.self;
  if (!actor || !center) return;
  const spec = op.spec.templateId === undefined && op.spec.copyOf === undefined
    ? { ...op.spec, spawnPanel: op.spec.spawnPanel ?? {} } : op.spec;
  const original = spec.copyOf ? select(spec.copyOf).find(unit => own(state.units, unit.id) === unit)
    : own(state.summonTemplates, spec.templateId);
  const plan = unitPlan(state, context, spec, original);
  if (!plan) return;
  const templateId = spec.templateId ?? original?.templateId ?? original?.id ?? frame.ruleId ?? 'summon';
  const form = spec.copyOf ? 'copy' : spec.spawnPanel ? 'panel' : 'template';
  const group = JSON.stringify([actor.id, context.event.skillId ?? null, frame.ruleId, form, templateId, spec.name ?? null]);
  const data = { plan, center: xy(center), out: op.out ?? null,
    fields: carrier({ ...original, ...spec, tier: spec.spawnPanel ? plan.panel.tier : spec.tier ?? plan.panel.tier,
      vars: { ...(spec.copyOf ? {} : original?.vars), ...spec.vars } }, actor.id, '', templateId, context),
    group, evictIds: [], pendingId: null };
  if (original && spec.copyOf) data.fields.vars = { ...(original.vars ?? {}), ...data.fields.vars };
  // An eviction hook may summon another group, but cannot reenter its own replacement.
  if (state.vm.stack.some(entry => entry.native === 'spatialSpawn' && entry.data.group === data.group)) return;
  data.evictIds = Object.keys(state.units).sort().filter(id => own(state.units, id).summonGroup === data.group && id !== actor.id);
  const leaving = new Set(data.evictIds);
  const slots = [plan.gear.mainHand, plan.gear.offHand, plan.gear.shield, ...plan.gear.gear].filter(Boolean);
  const keptItems = values(state.items).filter(item => !leaving.has(item.ownerId)).length;
  if (values(state.units).length - leaving.size + plan.count > 200 || keptItems + slots.length * plan.count > 200
    || cells(state).filter(cell => !blocked(state, cell, leaving)).length < plan.count) {
    host.log(state, actor, 'spawn', `${data.fields.name}未能登场：可用战场空间不足`);
    return;
  }
  const sourceSkillId = frame.sourceSkillId ?? (frame.carrier?.type === 'skill' ? frame.carrier.id : undefined);
  push({ ...inherit(frame), native: 'spatialSpawn', data, ...(sourceSkillId && { sourceSkillId }) });
}

function continueSpawn({ state, frame, host, context }) {
  const { data } = frame;
  const actor = own(state.units, frame.ownerId);
  if (data.pendingId) {
    const old = own(state.units, data.pendingId);
    if (old) {
      host.log(state, old, 'spawn', `${old.name}结束召唤并离场`, { unitId: old.id, evicted: true });
      removeSummon(state, old);
      refreshFollowingZones(state, host);
    }
    data.pendingId = null;
    delete frame.awaitEvent;
  }
  while (frame.pc < data.evictIds.length) {
    const old = own(state.units, data.evictIds[frame.pc++]);
    if (!old || old.summonGroup !== data.group) continue;
    if (!live(old)) {
      removeSummon(state, old);
      refreshFollowingZones(state, host);
      continue;
    }
    data.pendingId = old.id;
    frame.awaitEvent = newEvent(state, { actorId: actor?.id ?? frame.ownerId, targetId: old.id,
      sourceId: actor?.id ?? frame.ownerId, summonId: old.id, templateId: old.templateId, center: at(state, old),
      ...(old.sourceSkillId && { sourceSkillId: old.sourceSkillId }) });
    scheduleHooks(state, frame, 'on_summon_evict', frame.awaitEvent, host);
    return;
  }
  const { plan, center } = data;
  const landings = cells(state).filter(cell => !blocked(state, cell))
    .sort((a, b) => distance3D(state, center, a) - distance3D(state, center, b));
  const { gear } = plan;
  const templateIds = [gear.mainHand, gear.offHand, gear.shield, ...gear.gear].filter(Boolean);
  const items = new Map(templateIds.map(id => [id, itemPlan(state, id, context)]));
  if (landings.length < plan.count || values(state.units).length + plan.count > 200 || [...items.values()].some(item => !item)
      || values(state.items).length + templateIds.length * plan.count > 200) {
    host.log(state, actor, 'spawn', `${data.fields.name}未能登场：可用格子或装备实例不足`);
    state.vm.stack.pop();
    return;
  }
  let first;
  for (const placement of landings.slice(0, plan.count)) {
    const id = nextId(state, state.units, 'summon');
    const unit = { ...structuredClone(plan.panel), ...structuredClone(data.fields), id, ...placement, altitude: 0,
      summonGroup: data.group, summoned: true, used: { attack: 0, action: 0 }, ap: 0, statuses: {},
      ...(frame.sourceSkillId && { sourceSkillId: frame.sourceSkillId }) };
    unit.hp = unit.maxHp;
    unit.mp = unit.maxMp;
    unit.sp = unit.maxSp;
    state.units[id] = unit;
    initializeUnitPools(state, id);
    const mint = templateId => templateId ? mintItem(state, items.get(templateId), data.fields.sourceId, id, context) : null;
    unit.weapon = unit.mainHand = mint(gear.mainHand);
    unit.offHand = mint(gear.offHand);
    unit.shield = mint(gear.shield);
    unit.gear = gear.gear.map(mint);
    state.order.push(id);
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
  const origin = area.center === undefined ? anchor ?? center : resolvePoint(area.center, context);
  if ((area.center !== undefined || ['circle', 'ring', 'single'].includes(area.shape)) && !point(origin)) return;
  if (['circle', 'ring'].includes(area.shape) && !Number.isFinite(area.radius)) return;
  if (origin) area.center = xy(origin);
  if (spec.follow) area.anchorUnitId = anchor.id;
  else delete area.anchorUnitId;
  const id = nextId(state, state.zones ??= {}, 'zone');
  const zone = { ...carrier(spec, context.self?.id ?? frame.sourceId, id, spec.templateId ?? id, context), team: context.self?.team ?? null,
    area, follow: spec.follow === true, persistent: spec.persistent === true, remainingTurns: spec.remainingTurns ?? 1,
    ...(spec.follow ? { anchorPosition: xy(anchor) } : {}) };
  state.zones[id] = zone;
  publishOut(state, frame, op.out, id);
  host.log(state, context.self, 'zone', `展开${zone.name}`, { zoneId: id });
}

export function removeZone(state, host, zoneId, reason = '解除') {
  const zone = own(state.zones, zoneId);
  if (!zone) return false;
  delete state.zones[zoneId];
  for (const poolId of values(zone.pools)) delete state.pools[poolId];
  host.log(state, own(state.units, zone.sourceId), 'zone', `${zone.name}${reason}后消散`, { zoneId, expired: true });
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
  const origin = area?.origin === undefined ? center : resolvePoint(area.origin, context);
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
export function expireSpatialEffects(state, host, { advance = false, parent = state.vm?.stack.at(-1) } = {}) {
  refreshFollowingZones(state, host);
  if (!advance) return;
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
    for (const unit of [...targets].filter(unit => own(state.units, unit.id) === unit && unit.summoned === true)) {
      removeSummon(state, unit);
      host.log(state, context.self, 'despawn', `${unit.name}被移除`, { unitId: unit.id, summoned: true });
    }
  }
}

function spawn(env) {
  const { op, context } = env;
  const spec = resolveSpawnSpec(op.spec, context, op.entityKind);
  if (!spec) return;
  const resolved = { ...env, op: { ...op, spec } };
  if (op.entityKind === 'item') { spawnItems(resolved); return; }
  const center = op.at === undefined ? context.center ?? context.target ?? context.self : resolvePoint(op.at, context);
  if ((op.at !== undefined && !center) || (center && !point(center))) return;
  if (op.entityKind === 'unit') spawnUnits(resolved, center);
  else if (op.entityKind === 'zone') spawnZone(resolved, center);
  else spawnTerrain(resolved, center);
}

export const spatialOps = Object.freeze({ move, spawn, despawn });
export const spatialContinuations = Object.freeze({ spatialMove: continueMove, spatialSpawn: continueSpawn });
