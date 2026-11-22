import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerVM, startVM, stepVM } from '../src/core/tactical-vm.js';
import { commitOps, continueCommit } from '../src/core/vm-commit.js';
import { initializeUnitPools } from '../src/core/vm-pools.js';
import { expireSpatialEffects, spatialContinuations, spatialOps } from '../src/core/vm-spatial-ops.js';
import { vmHost } from '../src/core/vm-runtime.js';
import { zoneContains } from '../src/core/vm-select.js';

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
function run(state, program, scope) {
  const frame = startVM(state, { ownerId: 'actor', sourceId: 'actor', program, ...(scope ? { scope } : {}) });
  stepVM(state, host);
  return frame.vars;
}
const self = { type: 'unit', id: 'other' };

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
