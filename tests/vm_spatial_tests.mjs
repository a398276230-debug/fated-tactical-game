import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerVM, newEvent, startVM, stepVM } from '../src/core/tactical-vm.js';
import { continueAction, perform, queueVMAction } from '../src/core/vm-action.js';
import { ruleOps } from '../src/core/vm-rules.js';
import { commitOps, continueCommit } from '../src/core/vm-commit.js';
import { initializeUnitPools } from '../src/core/vm-pools.js';
import { expireSpatialEffects, spatialContinuations, spatialOps } from '../src/core/vm-spatial-ops.js';
import { vmHost } from '../src/core/vm-runtime.js';
import { zoneContains } from '../src/core/vm-select.js';
import { preview } from '../src/core/combat.js';
import { aggregateModifiers } from '../src/core/vm-carriers.js';
import { dispatchVMHook } from '../src/core/vm-runtime.js';
import { reachableCells } from '../src/core/spatial.js';
import { zoneCellScore } from '../src/core/ai.js';

const unit = (id, x, y) => ({ id, name: id, x, y, hp: 30, maxHp: 30, mp: 10, maxMp: 10, sp: 10, maxSp: 10,
  team: 'blue', facing: [1, 0], tier: 3, stats: { str: 10, agi: 10, con: 10, int: 10, spi: 10 }, statuses: {} });
const position = ({ x, y }) => [x, y];
function board() {
  const state = { grid: Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ({ kind: 'floor', z: 0 }))),
    units: { actor: unit('actor', 0, 1), other: unit('other', 1, 1) }, order: ['actor', 'other'], turn: 0,
    covers: {}, items: {}, zones: {}, logs: [], equipment: { sword: { name: '剑', pools: { charges: { cap: 3, initial: 2 } } } } };
  for (const id of state.order) initializeUnitPools(state, id);
  return state;
}
const host = {
  ops: { ...commitOps, ...spatialOps },
  continue: env => ({ ...spatialContinuations, commit: continueCommit })[env.frame.native](env),
  log: (state, unit, type, text, detail) => state.logs.push({ unitId: unit?.id ?? null, type, text, ...(detail ? { detail } : {}) }),
  rules(state, hook, event) {
    if (hook !== 'on_summon_evict') return [];
    const old = state.units[event.targetId];
    return old.rules.filter(rule => rule.hook === hook).map(rule => ({ ownerId: old.id, carrierOrder: 0, rule }));
  },
};
function run(state, program, scope, event) {
  const frame = startVM(state, { ownerId: 'actor', sourceId: 'actor', program, ...(scope ? { scope } : {}) });
  if (event) frame.eventRef = newEvent(state, event);
  stepVM(state, host);
  return frame.vars;
}
const self = { type: 'unit', id: 'other' };

test('zones retain creator team after allegiance changes and enemy despawn filters zone and candidate', () => {
  const state = board();
  const spawn = { op: 'spawn', entityKind: 'zone', spec: { area: { shape: 'single' } } };
  run(state, [spawn]);
  state.units.other.team = 'red';
  startVM(state, { ownerId: 'other', sourceId: 'other', program: [spawn] });
  stepVM(state, host);
  assert.equal(state.zones['zone-2'].team, 'red');
  state.units.other.team = 'blue';
  run(state, [{ op: 'despawn', entityKind: 'zone', select: { from: 'zones', where: "zone.team != self.team && candidate.team == 'red' && zone.sourceId == candidate.sourceId && zone.sourceId == 'other'" } }]);
  assert.deepEqual(Object.keys(state.zones), ['zone-1']);
});

test('height-bounded rect distinguishes ground from flight in the same cell', () => {
  const state = board();
  state.grid[1][0].z = 1;
  state.units.other.x = 0;
  state.units.other.altitude = 1;
  const area = { shape: 'rect', rect: { x1: 0, y1: 1, x2: 1, y2: 2 }, z1: 0, z2: 1 };
  run(state, [{ op: 'spawn', entityKind: 'zone', spec: { area } }]);
  const zone = state.zones['zone-1'];
  assert.equal(zone.area.z1, 0);
  assert.equal(zone.area.z2, 1);
  assert.equal(zoneContains(state, zone, state.units.actor), true);
  assert.equal(zoneContains(state, zone, state.units.other), false);
  assert.equal(zoneContains(state, zone, { x: 3, y: 1, z: 1 }), false);
});

test('high-altitude board zone applies modifiers and turn-start rules using VM elevation formulas', () => {
  const state = board();
  state.grid[1][1].z = 1;
  state.units.other.altitude = 1;
  state.grid[1][2].z = 2;
  state.units.plateau = unit('plateau', 2, 1);
  initializeUnitPools(state, 'plateau');
  run(state, [{ op: 'spawn', entityKind: 'zone', spec: {
    area: { shape: 'board', z1: 2, z2: 12 },
    mods: [{ locks: ['fly'], when: 'self.z == 2 && target.z == 0' }],
    rules: [{ id: 'turbulence', hook: 'turn_start', filter: 'self.z == 2 && target.z == 0 && attacker.z == 2', program: [
      { op: 'damage', target: { from: 'self', where: 'candidate.z == 2' }, amount: 3, damageType: 'true', direct: false },
    ] }],
  } }]);
  for (const id of ['actor', 'other', 'plateau']) {
    const event = { actorId: id, targetId: 'actor' };
    assert.equal(aggregateModifiers(state, id, event).locks.fly, id !== 'actor');
    dispatchVMHook(state, 'turn_start', event);
    assert.equal(state.units[id].hp, id === 'actor' ? 30 : 27);
  }
});

test('2D zone despawn selects suspended zones by footprint', () => {
  const state = board();
  const area = { shape: 'rect', rect: { x1: 0, y1: 1, x2: 1, y2: 2 }, z1: 3, z2: 6 };
  run(state, [
    { op: 'spawn', entityKind: 'zone', spec: { area } },
    { op: 'spawn', entityKind: 'zone', spec: { area: { ...area, rect: { x1: 4, y1: 1, x2: 5, y2: 2 } } } },
  ]);
  assert.equal(zoneContains(state, state.zones['zone-1'], state.units.actor), false);
  run(state, [{ op: 'despawn', entityKind: 'zone', select: { from: 'zones', area: { shape: 'single', origin: 'self' } } }]);
  assert.deepEqual(Object.keys(state.zones), ['zone-2']);
});

test('AI zone scoring uses absolute z on reachable flight destinations', () => {
  const state = board(), actor = state.units.actor;
  actor.altitude = 2;
  state.grid[0][0].z = 1;
  run(state, [{ op: 'spawn', entityKind: 'zone', spec: {
    area: { shape: 'board', z1: 3 }, mods: [{ locks: ['fly'] }],
  } }]);
  const cells = reachableCells(state, actor, 1);
  const elevated = cells.find(({ x, y }) => x === 0 && y === 0);
  const lower = cells.find(({ x, y }) => x === 0 && y === 2);
  assert.equal(elevated.z, 3);
  assert.equal(lower.z, 2);
  assert.equal(zoneCellScore(state, actor, elevated), 12);
  assert.equal(zoneCellScore(state, actor, lower), 0);
});

test('gravity locks block teleport and ascent but allow forced landing; dispel cannot forge expiry', () => {
  const state = board(), unit = state.units.actor;
  unit.mods = [{ locks: ['fly','teleport'] }];
  run(state, [{ op: 'move', target: 'self', mode: 'teleport', to: {x:3,y:1} },
    { op: 'move', target: 'self', mode: 'altitude', deltaZ: 2 }]);
  assert.deepEqual([unit.x,unit.y,unit.altitude ?? 0], [0,1,0]);
  unit.altitude = 3;
  run(state, [{ op: 'move', target: 'self', mode: 'altitude', land: true }]);
  assert.equal(unit.altitude, 0);
  unit.statuses.form = { id:'form', name:'形态', flags:['undispellable'], remainingTurns: 1 };
  for (const reason of ['dispelled','cleansed','expired']) {
    startVM(state, { ownerId: unit.id, sourceId: unit.id, program: [{ op:'remove_status', target:'self', where:'true', reason }] });
    stepVM(state, vmHost);
    assert.ok(unit.statuses.form);
  }
});

test('unit despawn removes only summons, not native units, without death or kill credit', () => {
  const state = board();
  run(state, [{ op:'spawn', entityKind:'unit', spec:{ name:'召唤物' } }]);
  const summon = Object.values(state.units).find(unit => unit.summoned);
  run(state, [{ op:'spawn', entityKind:'zone', spec:{follow:true, area:{shape:'single',anchorUnitId:summon.id}} }]);
  assert.equal(state.zones['zone-1'].area.anchorUnitId, summon.id);
  run(state, [{ op:'despawn', entityKind:'unit', select:{from:'units', where:'candidate.summoned == true'} }]);
  assert.deepEqual(Object.keys(state.units).sort(), ['actor','other']);
  assert.deepEqual(Object.keys(state.zones), []);
  run(state, [{ op:'despawn', entityKind:'unit', select:{from:'units'} }]);
  assert.deepEqual(state.order, ['actor','other']);
  assert.equal(state.logs.some(log => log.type === 'defeat'), false);
});

test('group teleport is atomic, preserves spacing, and crosses intervening walls', () => {
  const state = board();
  state.grid[1][2].kind = 'wall';
  const op = { op: 'move', target: { from: 'units' }, mode: 'teleport', to: { x: 3, y: 1 } };
  state.grid[1][4].kind = 'wall';
  run(state, [op]);
  assert.deepEqual(Object.values(state.units).map(position), [[0, 1], [1, 1]]);
  state.grid[1][4].kind = 'floor';
  run(state, [op]);
  assert.deepEqual(Object.values(state.units).map(position), [[3, 1], [4, 1]]);
});

test('push collision commits damage and resumes a target-scoped branch after a JSON round trip', () => {
  const state = board();
  state.grid[1][3].kind = 'wall';
  const registers = run(state, [{ op: 'move', target: 'target', mode: 'push', distance: 4, collisionDamage: 3, onCollide: [
    { op: 'ask', chooser: 'self', kind: 'number', min: 1, max: 4, out: 'rise', aiPolicy: 'min', prompt: '选择高度' },
    { op: 'move', target: 'target', mode: 'altitude', deltaZ: 'vars.rise' },
  ] }, { op: 'let', name: 'done', value: true }], { target: self });
  assert.deepEqual(registers, {});
  assert.deepEqual(position(state.units.other), [2, 1]);
  assert.equal(state.units.other.hp, 27);
  const saved = JSON.parse(JSON.stringify(state));
  for (const battle of [state, saved]) {
    const top = battle.vm.stack[0];
    answerVM(battle, { askId: battle.vm.pendingAsk.askId, value: 4 }, host);
    stepVM(battle, host);
    assert.deepEqual(top.vars, { rise: 4, done: true });
  }
  assert.equal(saved.units.other.altitude, 4);
  assert.deepEqual(saved, state);
});

test('two cell choices can drive consecutive teleports and a step respects its path limit', () => {
  const state = board();
  const ask = { op: 'ask', chooser: 'self', kind: 'cell', select: { from: 'cells' }, prompt: '选择格子', out: 'cell', aiPolicy: 'first' };
  const blink = { op: 'move', target: 'self', mode: 'teleport', to: 'vars.cell' };
  run(state, [ask, blink, ask, blink]);
  for (const [x, y] of [[2, 1], [0, 1]]) {
    const action = { askId: state.vm.pendingAsk.askId, x, y };
    answerVM(state, action, host);
    stepVM(state, host);
    assert.deepEqual(position(state.units.actor), [x, y]);
  }
  run(state, [{ op: 'move', mode: 'step', target: 'self', to: { x: 0, y: 3 } }]);
  assert.deepEqual(position(state.units.actor), [0, 1]);
  run(state, [{ op: 'move', mode: 'step', target: 'self', to: { x: 0, y: 3 }, distance: 2 }]);
  assert.deepEqual(position(state.units.actor), [0, 3]);
});

test('summon replacement waits for its eviction hook and creates independent deterministic pools and gear', () => {
  const state = board();
  const summoning = { op: 'spawn', entityKind: 'unit', out: 'summoned', at: { x: 3, y: 3 }, spec: {
    name: '使魔', count: 2, spawnPanel: { maxHp: 20, maxMp: 5, maxSp: 4, mainHand: 'sword' },
    rules: [{ id: 'evict', hook: 'on_summon_evict', program: [
      { op: 'ask', chooser: 'self', kind: 'number', min: 0, max: 1, out: 'ok', prompt: '确认', aiPolicy: 'first' },
    ] }],
  } };
  assert.equal(run(state, [summoning]).summoned, 'summon-1');
  assert.notEqual(state.units['summon-1'].pools.hp, state.units['summon-2'].pools.hp);
  assert.equal(state.pools[state.items['item-1'].pools.charges].current, 2);
  run(state, [summoning]);
  const saved = JSON.parse(JSON.stringify(state));
  for (const battle of [state, saved]) {
    for (const id of ['summon-1', 'summon-2']) {
      assert.ok(battle.units[id]);
      assert.equal(battle.vm.pendingAsk.chooserId, id);
      answerVM(battle, { askId: battle.vm.pendingAsk.askId, value: 1 }, host);
      stepVM(battle, host);
      assert.equal(battle.units[id], undefined);
    }
    assert.deepEqual(battle.order, ['actor', 'other', 'summon-3', 'summon-4']);
    assert.deepEqual(Object.keys(battle.items), ['item-3', 'item-4']);
    assert.equal(battle.pools.pool_summon_1_hp, undefined);
  }
  assert.deepEqual(saved, state);
});

test('template summons and mirror copies use private pools and independent gear', () => {
  const state = board();
  state.summonTemplates = { echo: { ...unit('echo', 0, 0), mainHand: 'sword', tags: ['illusion'] } };
  const templateId = run(state, [{ op: 'spawn', entityKind: 'unit', out: 'result', spec: { templateId: 'echo' } }]).result;
  const cloneId = run(state, [{ op: 'spawn', entityKind: 'unit', out: 'result', spec: {
    copyOf: { from: 'units', where: "candidate.id == 'summon-1'" }, name: '镜像',
  } }]).result;
  const original = state.units[templateId], clone = state.units[cloneId];
  assert.deepEqual(clone.stats, original.stats);
  assert.deepEqual(clone.tags, ['illusion']);
  assert.equal(clone.maxHp, 30);
  assert.notEqual(clone.pools.hp, original.pools.hp);
  assert.notEqual(clone.mainHand, original.mainHand);
  assert.equal(state.items[clone.mainHand].templateId, 'sword');
});

test('following zones travel with anchors, expire by round, and disappear on anchor loss', () => {
  const state = board();
  const zone = { op: 'spawn', entityKind: 'zone', out: 'zone', spec: { templateId: 'ward', follow: true,
    tags: ['ward'], remainingTurns: 2, area: { shape: 'circle', radius: 1 } } };
  const id = run(state, [zone]).zone;
  assert.ok(zoneContains(state, state.zones[id], state.units.other));
  run(state, [{ op: 'move', target: 'self', mode: 'teleport', to: { x: 4, y: 4 } }]);
  assert.deepEqual(state.zones[id].area.center, { x: 4, y: 4 });
  assert.equal(zoneContains(state, state.zones[id], state.units.other), false);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.zones[id].remainingTurns, 1);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.zones[id], undefined);
  const fixed = run(state, [{ ...zone, spec: { ...zone.spec, persistent: true } }]).zone;
  state.units.actor.fled = true;
  expireSpatialEffects(state, host);
  assert.equal(state.zones[fixed], undefined);
});

test('terrain layers replay on expiry, and cover and inventory instances have deterministic IDs', () => {
  const state = board();
  const effect = (height, remainingTurns) => ({ op: 'spawn', entityKind: 'terrain', at: { x: 2, y: 2 },
    spec: { height, mode: 'raise', remainingTurns } });
  const registers = run(state, [effect(2, 1), effect(3, 2),
    { op: 'spawn', entityKind: 'cover', at: { x: 3, y: 3 }, out: 'cover', spec: { cover: 5, remainingTurns: 1 } },
    { op: 'spawn', entityKind: 'item', out: 'item', spec: { templateId: 'sword', count: 2 } },
  ]);
  assert.deepEqual(registers, { cover: 'cover-1', item: 'item-1' });
  assert.equal(state.grid[2][2].z, 5);
  assert.equal(state.covers['cover-1'].cover, 5);
  assert.equal(state.units.actor.inventory.sword, 2);
  assert.deepEqual(Object.keys(state.items), ['item-1', 'item-2']);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.grid[2][2].z, 3);
  assert.equal(state.covers['cover-1'], undefined);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.grid[2][2].z, 0);
});

const spawnSpatial = (entityKind, x, y, spec, out) => ({ op: 'spawn', entityKind, at: { x, y }, spec, ...(out && { out }) });
const despawn = (entityKind, select) => ({ op: 'despawn', entityKind, select });
const singleArea = (x, y) => ({ shape: 'single', origin: { x, y } });

test('despawn selects zones by footprint and removes their pools', () => {
  const state = board();
  run(state, [
    spawnSpatial('zone', 2, 2, { templateId: 'ward', persistent: true, area: { shape: 'circle', radius: 1 } }),
    spawnSpatial('zone', 3, 2, { templateId: 'other-ward', persistent: true, area: { shape: 'single' } }),
    spawnSpatial('zone', 5, 4, { templateId: 'ward', persistent: true, area: { shape: 'single' } }),
  ]);
  const zone = state.zones['zone-1'];
  zone.pools = { charge: 'zone-charge' };
  state.pools['zone-charge'] = { current: 1 };
  run(state, [despawn('zone', { from: 'zones', where: "candidate.id != 'zone-2'", area: singleArea(3, 2) })]);
  assert.deepEqual(Object.keys(state.zones), ['zone-2', 'zone-3']);
  assert.equal(state.pools['zone-charge'], undefined);
  assert.match(state.logs.at(-1).text, /ward解除后消散/);
});

test('despawn removes selected cover independently and leaves siblings to expire', () => {
  const state = board();
  state.covers.native = { id: 'native', name: '天然掩体', x: 5, y: 4, cover: 2, hp: 10 };
  run(state, [spawnSpatial('cover', 3, 3, { remainingTurns: 1, area: { shape: 'circle', radius: 1 } }, 'cover'),
    despawn('terrain', 'terrain'), despawn('cover', { from: 'covers', where: "candidate.id == 'cover-1'" })]);
  assert.deepEqual(Object.keys(state.covers), ['native', 'cover-2', 'cover-3', 'cover-4', 'cover-5']);
  assert.deepEqual(state.spatialTerrain['terrain-1'].coverIds, ['cover-2', 'cover-3', 'cover-4', 'cover-5']);
  run(state, [despawn('cover', { from: 'covers', where: "candidate.id == 'native'", area: singleArea(5, 4) })]);
  assert.equal(state.covers.native, undefined);
  expireSpatialEffects(state, host, { advance: true });
  assert.deepEqual(state.covers, {});
  assert.deepEqual(state.spatialTerrain, {});
});

test('despawn restores overlapping terrain across the whole selected footprint and preserves native tiles', () => {
  const state = board();
  state.grid[2][3] = { kind: 'slope', z: 1 };
  state.grid[4][5] = { kind: 'wall', z: 6 };
  const spawn = [
    spawnSpatial('terrain', 2, 2, { height: 2, mode: 'raise', area: { shape: 'rect', width: 1, radius: 0 } }),
    spawnSpatial('terrain', 3, 2, { height: 3, mode: 'raise', remainingTurns: 1 }),
  ];
  run(state, spawn);
  assert.equal(state.grid[2][3].z, 6);
  run(state, [despawn('terrain', { from: 'terrain', area: singleArea(3, 2), pick: { first: 1 } }),
    despawn('terrain', { from: 'cells', where: 'candidate.x == 5 && candidate.y == 4' })]);
  assert.deepEqual(Object.keys(state.spatialTerrain), ['terrain-2']);
  assert.deepEqual(state.grid[2][2], { kind: 'floor', z: 0 });
  assert.deepEqual(state.grid[2][3], { kind: 'slope', z: 4 });
  assert.deepEqual(state.grid[4][5], { kind: 'wall', z: 6 });
  expireSpatialEffects(state, host, { advance: true });
  assert.deepEqual(state.grid[2][3], { kind: 'slope', z: 1 });
});

test('despawn targets spawned wall layers while preserving native terrain', () => {
  const state = board();
  state.grid[4][5] = { kind: 'wall', z: 6 };
  run(state, [spawnSpatial('terrain', 3, 2, { kind: 'wall' }),
    spawnSpatial('terrain', 4, 2, { kind: 'wall' })]);
  run(state, [despawn('terrain', { from: 'terrain', area: singleArea(5, 4) }),
    despawn('terrain', { from: 'terrain', area: singleArea(3, 2) })]);
  assert.equal(state.grid[2][3].kind, 'floor');
  assert.equal(state.grid[2][4].kind, 'wall');
  assert.deepEqual(state.grid[4][5], { kind: 'wall', z: 6 });
});

test('despawn applies one net change per tile without falling through intermediate heights', () => {
  const state = board();
  run(state, [
    spawnSpatial('terrain', 3, 2, { height: 4, mode: 'raise' }),
    spawnSpatial('terrain', 3, 2, { height: 4, mode: 'lower' }),
    { op: 'move', mode: 'teleport', target: 'target', to: { x: 3, y: 2 } },
    despawn('terrain', 'terrain'),
  ], { target: self });
  assert.deepEqual(state.spatialTerrain, {});
  assert.equal(state.grid[2][3].z, 0);
  assert.equal(state.units.other.hp, 30);
  assert.equal(state.logs.some(log => log.type === 'damage'), false);
});

test('despawn commits one fall against the final height and preserves a newer layer across JSON replay', () => {
  const state = board();
  const hp = state.pools[state.units.other.pools.hp];
  state.units.other.hp = state.units.other.maxHp = hp.current = hp.max = hp.contributors[0].maxBase = 300;
  run(state, [
    spawnSpatial('terrain', 1, 1, { height: 1, mode: 'raise' }),
    spawnSpatial('terrain', 1, 1, { height: 2, mode: 'raise' }),
    spawnSpatial('terrain', 1, 1, { height: 1, mode: 'raise', remainingTurns: 1 }),
  ]);
  const saved = JSON.parse(JSON.stringify(state));
  for (const battle of [state, saved]) {
    run(battle, [despawn('terrain', { from: 'terrain', where: "candidate.id != 'terrain-3'" })]);
    assert.equal(battle.grid[1][1].z, 1);
    assert.equal(battle.units.other.hp, 150);
    assert.equal(battle.logs.filter(log => log.type === 'damage').length, 1);
    const parent = startVM(battle, { ownerId: 'actor', sourceId: 'actor' });
    expireSpatialEffects(battle, host, { advance: true, parent });
    stepVM(battle, host);
    assert.equal(battle.grid[1][1].z, 0);
    assert.equal(battle.units.other.hp, 100);
  }
  assert.deepEqual(saved, state);
});

test('despawn restores a native wall, clears obstacles and relocates its occupant', () => {
  const state = board();
  state.grid[2][2] = { kind: 'wall', z: 2 };
  run(state, [spawnSpatial('terrain', 2, 2, { kind: 'floor', height: 0 }),
    despawn('terrain', { from: 'terrain' })]);
  assert.deepEqual(state.grid[2][2], { kind: 'wall', z: 2 });
  assert.deepEqual(state.covers, {});
  assert.deepEqual(state.spatialTerrain, {});

  run(state, [spawnSpatial('terrain', 2, 2, { kind: 'floor', height: 0 }),
    { op: 'move', mode: 'teleport', target: 'target', to: { x: 2, y: 2 } },
    despawn('terrain', { from: 'terrain' })], { target: self });
  assert.deepEqual(state.grid[2][2], { kind: 'wall', z: 2 });
  assert.notDeepEqual(position(state.units.other), [2, 2]);
  assert.equal(state.grid[state.units.other.y][state.units.other.x].kind, 'floor');
  assert.equal(state.units.other.hp, 30);
});

test('generated units resolve count and tier before calculating a panel', () => {
  const state = board();
  const spawn = spec => ({ op: 'spawn', entityKind: 'unit', at: { x: 3, y: 3 }, out: 'unit', spec });
  const { unit: id } = run(state, [spawn({ name: '默认面板', count: 'self.tier + 20', tier: 'self.tier / 2' })]);
  assert.equal(state.order.length, 12);
  assert.equal(state.units[id].tier, 1);
  assert.ok(state.units[id].maxHp > 0);
  const { unit: custom } = run(state, [spawn({ name: '指定面板', count: '-4', spawnPanel: { tier: 'self.tier - 1' } })]);
  assert.equal(state.order.length, 13);
  assert.equal(state.units[custom].tier, 2);
  const { unit: capped } = run(state, [spawn({ name: '超出层级', tier: '99', spawnPanel: { tier: '1' } })]);
  assert.equal(state.units[capped].tier, state.units.actor.tier);
  assert.deepEqual(run(state, [spawn({ count: 'vars.missing' })]), {});
  assert.equal(state.order.length, 14);
});

test('items, zones, terrain and cover store resolved spawn quantities', () => {
  const state = board();
  const registers = run(state, [
    { op: 'spawn', entityKind: 'item', out: 'item', spec: { templateId: 'sword', count: 'self.tier - 0.2' } },
    { op: 'spawn', entityKind: 'zone', out: 'zone', spec: { tier: 'self.tier + 15', remainingTurns: 'self.tier * 50',
      area: { shape: 'circle', center: 'target', radius: 'self.tier / 2' } } },
    { op: 'spawn', entityKind: 'terrain', out: 'terrain', at: { x: 4, y: 1 }, spec: { height: 1,
      remainingTurns: 'self.tier - 10', area: { shape: 'circle', radius: '-1' } } },
    { op: 'spawn', entityKind: 'cover', out: 'cover', at: { x: 4, y: 3 }, spec: { remainingTurns: 'self.tier / 1.5' } },
  ], { target: self });
  assert.deepEqual(registers, { item: 'item-1', zone: 'zone-1', terrain: 'terrain-1', cover: 'cover-1' });
  assert.equal(state.units.other.inventory.sword, 2);
  assert.equal(state.zones[registers.zone].tier, 7);
  assert.equal(state.zones[registers.zone].remainingTurns, 100);
  assert.deepEqual(state.zones[registers.zone].area, { shape: 'circle', center: { x: 1, y: 1 }, radius: 1.5 });
  assert.equal(state.spatialTerrain[registers.terrain].remainingTurns, 1);
  assert.equal(state.spatialTerrain[registers.terrain].spec.area.radius, 0);
  assert.equal(state.spatialTerrain['terrain-2'].remainingTurns, 2);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.grid[1][4].z, 0);
  assert.ok(state.covers[registers.cover]);
  expireSpatialEffects(state, host, { advance: true });
  assert.equal(state.covers[registers.cover], undefined);
});

test('area origin point references use VM scope for both selectors and terrain', () => {
  for (const [origin, x, y] of [['self', 0, 1], ['target', 1, 1], ['center', 2, 2], ['vars.cell', 3, 3]]) {
    const state = board();
    const area = { shape: 'single', origin };
    const vars = run(state, [
      { op: 'ask', chooser: 'self', kind: 'cell', select: { from: 'cells' }, out: 'cell', aiPolicy: 'first', prompt: '选格' },
      { op: 'for_each', select: { from: 'cells', area }, bind: 'matched', body: [
        { op: 'let', name: 'matchedX', value: 'vars.matched.x' },
        { op: 'let', name: 'matchedY', value: 'vars.matched.y' },
      ] },
      { op: 'spawn', entityKind: 'terrain', at: { x: 5, y: 0 }, spec: { height: 2, area } },
      { op: 'spawn', entityKind: 'zone', spec: { area: { shape: 'single', center: origin } } },
    ], { target: self }, { center: { x: 2, y: 2 } });
    answerVM(state, { askId: state.vm.pendingAsk.askId, x: 3, y: 3 }, host);
    stepVM(state, host);
    assert.deepEqual([vars.matchedX, vars.matchedY], [x, y], origin);
    assert.equal(state.grid[y][x].z, 2, origin);
    assert.equal(state.grid[0][5].z, 0, origin);
    const zone = state.zones['zone-1'];
    assert.deepEqual(zone.area.center, { x, y });
    assert.ok(zoneContains(state, zone, { x, y }));
    assert.equal(zoneContains(state, zone, { x: x + 1, y }), false);
  }
});

test('perform resolves an entity choice used as the action origin', () => {
  const state = board();
  const origins = [];
  const actionHost = {
    ...host, rules: () => [], ops: { perform }, continue: continueAction,
    planAction: () => ({ ok: true, targetIds: [], center: { x: 2, y: 2 } }),
    payAction() {}, runAction: ({ event }) => origins.push(event.origin),
  };
  startVM(state, { ownerId: 'actor', sourceId: 'actor', program: [
    { op: 'ask', chooser: 'self', kind: 'entity', select: { from: 'units' }, out: 'origin', aiPolicy: 'first', prompt: '选单位' },
    { op: 'perform', actor: 'self', actionKind: 'attack', overrides: { origin: 'vars.origin' } },
  ] });
  stepVM(state, actionHost);
  answerVM(state, { askId: state.vm.pendingAsk.askId, value: 'other' }, actionHost);
  stepVM(state, actionHost);
  assert.deepEqual(origins, [{ x: 1, y: 1 }]);
});

test('zone follow resolves an entity choice and rejects a missing explicit anchor', () => {
  const state = board();
  const spawn = anchorUnitId => ({ op: 'spawn', entityKind: 'zone', spec: { follow: true, area: { shape: 'single', anchorUnitId } } });
  run(state, [
    { op: 'ask', chooser: 'self', kind: 'entity', select: { from: 'units' }, out: 'anchor', aiPolicy: 'first', prompt: '选锚点' },
    spawn('vars.anchor'), spawn('vars.missing'),
  ]);
  answerVM(state, { askId: state.vm.pendingAsk.askId, value: 'other' }, host);
  stepVM(state, host);
  assert.deepEqual(Object.keys(state.zones), ['zone-1']);
  assert.equal(state.zones['zone-1'].area.anchorUnitId, 'other');
  run(state, [{ op: 'move', target: 'target', mode: 'teleport', to: { x: 4, y: 2 } }], { target: self });
  assert.deepEqual(state.zones['zone-1'].area.center, { x: 4, y: 2 });
});

test('perform replay unwraps a bound tape record and falls back only for a missing register', () => {
  const state = board();
  state.tape = [{ actionType: 'attack', targetSpec: { x: 2, y: 3 } }];
  const actions = [];
  const actionHost = {
    ...host, rules: () => [], ops: { perform }, continue: continueAction,
    planAction: (_, actor, action) => {
      actions.push(action);
      return { ok: true, targetIds: [], center: { x: action.x, y: action.y } };
    },
    payAction() {}, runAction() {},
  };
  const replay = tapeRecord => ({ op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord });
  startVM(state, { ownerId: 'actor', sourceId: 'actor', program: [
    { op: 'for_each', select: { from: 'tape' }, bind: 'record', body: [
      replay('vars.record'), replay('vars.missing'),
      { op: 'let', name: 'wrong', value: "'other'" }, replay('vars.wrong'),
    ] },
  ] });
  stepVM(state, actionHost);
  assert.deepEqual(actions, Array(2).fill({ type: 'attack', x: 2, y: 3 }));
});

test('before_action resolves origin in the hook scope and records the point on tape', () => {
  const state = board();
  const origins = [];
  const actionHost = {
    ...host, ops: ruleOps, continue: continueAction,
    rules: (_, hook) => hook === 'before_action' ? [{ ownerId: 'other', carrierOrder: 0, rule: {
      id: 'origin-override', hook, program: [{ op: 'mutate_event', patch: { origin: 'self' } }],
    } }] : [],
    planAction: () => ({ ok: true, targetIds: [], center: { x: 2, y: 2 } }),
    payAction() {}, runAction: ({ event }) => origins.push(event.origin),
  };
  startVM(state, { ownerId: 'actor', sourceId: 'actor' });
  queueVMAction(state, { actorId: 'actor', action: { type: 'attack' }, record: true });
  stepVM(state, actionHost);
  assert.deepEqual(origins, [{ x: 1, y: 1 }]);
  assert.deepEqual(state.tape[0].origin, { x: 1, y: 1 });
});

test('perform resolves a vars skillId and replay tape var through real combat planning', () => {
  const state = board();
  Object.assign(state.units.actor, { skills: ['ranged'], ap: 2, used: { attack: 0, action: 0 }, mainHand: null, weapon: null });
  Object.assign(state.units.other, { team: 'red' });
  state.skills = { ranged: { name: '远射', ap: 1, slot: 'attack', range: 5, target: 'enemy', damage: { count: 0, sides: 0, bonus: 1 } } };
  state.tape = [{ actionType: 'skill', skillId: 'ranged', targetSpec: { x: 1, y: 1 } }];
  const frame = startVM(state, { ownerId: 'actor', sourceId: 'actor', program: [
    { op: 'let', name: 'chosen', value: "'ranged'" },
    { op: 'for_each', select: { from: 'tape' }, bind: 't', body: [
      { op: 'perform', actor: 'self', actionKind: 'skill', skillId: 'vars.chosen', target: 'target', overrides: { free: true, ignoreSlots: true } },
      { op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord: 'vars.t', overrides: { free: true, ignoreSlots: true } },
    ] },
  ], scope: { target: self } });
  stepVM(state, vmHost);
  assert.equal(state.logs.filter(log => log.type === 'action').length, 2);
  assert.ok(state.logs.filter(log => log.type === 'action').every(log => log.detail.action.skillId === 'ranged'));
  assert.equal(frame.vars.chosen, 'ranged');
});

test('perform origin and opt-in range/LOS bypass affect real targeting and geometry', () => {
  const state = board();
  Object.assign(state.units.actor, { skills: ['ranged'], ap: 2, used: { attack: 0, action: 0 } });
  Object.assign(state.units.other, { team: 'red', x: 5, y: 1 });
  state.skills = { ranged: { name: '远射', ap: 1, slot: 'attack', range: 2, target: 'enemy', damage: { count: 0, sides: 0, bonus: 1 } } };
  state.grid[1][1].kind = 'wall';
  state.units.actor.rules = [{ id: 'origin-change', hook: 'before_action', program: [
    { op: 'mutate_event', patch: { origin: { x: 3, y: 1 } } },
  ] }];
  const action = { type: 'skill', skillId: 'ranged', x: 5, y: 1 };
  const actionTarget = { type: 'skill', skillId: 'ranged', x: 5, y: 1 };
  const actorPlan = preview(state, actionTarget, { simulateRules: false });
  const alternateOriginPlan = preview(state, actionTarget, { simulateRules: false, actionOrigin: { x: 3, y: 1 } });
  assert.equal(actorPlan.ok, false, 'actor origin is blocked by range and LOS');
  assert.equal(alternateOriginPlan.ok, true, 'alternate origin is close enough and has clear LOS');
  assert.equal(preview(state, actionTarget, { simulateRules: false, actionOrigin: { x: 0, y: 1 }, ignoreRange: true }).ok, false,
    'range bypass does not also bypass LOS');
  assert.equal(preview(state, actionTarget, { simulateRules: false, actionOrigin: { x: 0, y: 1 }, ignoreRange: true, ignoreLOS: true }).ok, true);

  const before = state.logs.length;
  state.units.actor.ap = 2;
  const start = startVM(state, { ownerId: 'actor', sourceId: 'actor', program: [
    { op: 'perform', actor: 'self', actionKind: 'skill', skillId: 'ranged', target: 'target', overrides: { free: true, ignoreSlots: true } },
  ], scope: { target: self } });
  stepVM(state, vmHost);
  assert.equal(state.logs.slice(before).filter(log => log.type === 'action').length, 1,
    'before_action origin change is replanned before action resolves');
});

test('runtime host wires spatial movement and commits terrain falls through damage', () => {
  const state = board();
  state.units.other.hp = state.units.other.maxHp = 200;
  const hp = state.pools[state.units.other.pools.hp];
  hp.current = hp.max = hp.contributors[0].maxBase = 200;
  state.units.other.x = 4;
  const phase = startVM(state, { ownerId: 'actor', sourceId: 'actor', scope: { target: self }, program: [
    { op: 'move', target: 'target', mode: 'pull', to: { x: 2, y: 0 }, distance: 4 },
    { op: 'spawn', entityKind: 'terrain', at: 'target', spec: { height: 2, remainingTurns: 1 } },
  ] });
  stepVM(state, vmHost);
  assert.deepEqual(position(state.units.other), [2, 0]);
  assert.equal(state.grid[0][2].z, 2);
  startVM(state, { ownerId: phase.ownerId, sourceId: phase.sourceId });
  expireSpatialEffects(state, vmHost, { advance: true });
  stepVM(state, vmHost);
  assert.equal(state.units.other.hp, 100);
  assert.equal(state.grid[0][2].z, 0);
  assert.deepEqual(position(state.logs.find(log => log.type === 'damage').positions.other), [2, 0]);
});
