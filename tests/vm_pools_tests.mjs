import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPool, getPool, initializeUnitPools, linkPools, refreshPoolMax,
  swapPoolCurrents, unlinkPools, updatePoolCurrent, updatePoolMax,
} from '../src/core/vm-pools.js';

const resources = ['hp', 'mp', 'sp'];

function setup() {
  const state = { units: {
    a: { hp: 30, maxHp: 100, mp: 15, maxMp: 30, sp: 5, maxSp: 12 },
    b: { hp: 150, maxHp: 300, mp: 10, maxMp: 20, sp: 10, maxSp: 25 },
    c: { hp: 140, maxHp: 200, mp: 5, maxMp: 8, sp: 12, maxSp: 16 },
  }, items: { ammoBox: {} } };
  for (const id of Object.keys(state.units)) initializeUnitPools(state, id);
  return state;
}

function assertMirrors(state, id, kind, current, max) {
  const unit = state.units[id];
  const pool = getPool(state, id, kind);
  const maxField = `max${kind[0].toUpperCase()}${kind.slice(1)}`;
  assert.deepEqual([unit[kind], unit[maxField]], [current, max]);
  assert.deepEqual([pool.current, pool.max], [current, max]);
}

test('creates JSON pools and binds built-in and item-local resources', () => {
  const state = setup();
  assert.deepEqual(state.units.a.pools, { hp: 'pool_a_hp', mp: 'pool_a_mp', sp: 'pool_a_sp' });
  assert.deepEqual(getPool(state, 'a', 'hp'), {
    id: 'pool_a_hp', kind: 'hp', contributors: [{ ownerKind: 'unit', ownerId: 'a', maxBase: 100, initialMaxBase: 100 }],
    current: 30, max: 100, initialMax: 100, reloadable: false,
  });
  const ammoId = createPool(state, { ownerKind: 'item', ownerId: 'ammoBox', key: 'ammo', max: 12,
    current: 20, reloadable: true });
  assert.equal(getPool(state, 'ammoBox', 'ammo', 'item').id, ammoId);
  assert.deepEqual(state.pools[ammoId], {
    id: ammoId, kind: 'custom', contributors: [{ ownerKind: 'item', ownerId: 'ammoBox', maxBase: 12, initialMaxBase: 12 }],
    current: 12, max: 12, initialMax: 12, reloadable: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('linking merges each whole pool once, and selector order does not affect JSON', () => {
  const first = setup(), second = setup();
  linkPools(first, ['a', 'b'], resources);
  linkPools(second, ['b', 'a'], [...resources].reverse());
  linkPools(first, ['a', 'b', 'c', 'c'], resources);
  linkPools(second, ['c', 'a'], resources);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  for (const id of ['a', 'b', 'c']) assertMirrors(first, id, 'hp', 320, 600);
  assert.deepEqual(getPool(first, 'a', 'hp').contributors.map(c => c.ownerId), ['a', 'b', 'c']);
  assert.equal(Object.keys(first.pools).length, 3);
  assert.deepEqual(linkPools(first, ['a', 'b'], resources), []);
});

test('partial unlink splits current proportionally and retains the remaining shared binding', () => {
  const state = setup();
  linkPools(state, ['a', 'b', 'c'], ['hp']);
  const sharedId = state.units.b.pools.hp;
  updatePoolCurrent(state, sharedId, 'set', 303);
  unlinkPools(state, ['a'], ['hp']);
  assertMirrors(state, 'a', 'hp', 50.5, 100);
  for (const id of ['b', 'c']) {
    assertMirrors(state, id, 'hp', 252.5, 500);
    assert.equal(state.units[id].pools.hp, sharedId);
  }
  unlinkPools(state, ['c', 'b'], ['hp']);
  assertMirrors(state, 'b', 'hp', 151.5, 300);
  assertMirrors(state, 'c', 'hp', 101, 200);
  assert.equal(Object.hasOwn(state.pools, sharedId), false);
  assert.equal(['a', 'b', 'c'].reduce((sum, id) => sum + state.units[id].hp, 0), 303);
});

test('unlinking a full pool leaves each resulting pool exactly full', () => {
  const state = setup();
  linkPools(state, ['a', 'b', 'c'], ['sp']);
  const { id, max } = getPool(state, 'a', 'sp');
  updatePoolCurrent(state, id, 'set', max);
  unlinkPools(state, ['a', 'b', 'c'], ['sp']);
  assertMirrors(state, 'a', 'sp', 12, 12);
  assertMirrors(state, 'b', 'sp', 25, 25);
  assertMirrors(state, 'c', 'sp', 16, 16);
});

test('current updates synchronize members and report the shared lethal edge exactly once', () => {
  const state = setup();
  linkPools(state, ['a', 'b'], ['hp']);
  const { id } = getPool(state, 'b', 'hp');
  assert.deepEqual(updatePoolCurrent(state, id, 'sub', 200), {
    poolId: id, before: 180, after: 0, applied: true, lethal: { poolId: id, units: ['a', 'b'] },
  });
  assert.equal(updatePoolCurrent(state, id, 'sub', 1).lethal, null);
  for (const member of ['a', 'b']) assertMirrors(state, member, 'hp', 0, 400);
  updatePoolCurrent(state, id, 'add', 999);
  for (const member of ['a', 'b']) assertMirrors(state, member, 'hp', 400, 400);
  updatePoolCurrent(state, id, 'sub', 999, { minRemain: 1 });
  for (const member of ['a', 'b']) assertMirrors(state, member, 'hp', 1, 400);
});

test('swaps use both original currents, clamp receiving pools and handle identical references', () => {
  const state = setup();
  linkPools(state, ['a', 'b'], ['hp', 'sp']);
  const hp = state.units.a.pools.hp, sp = state.units.b.pools.sp;
  assert.deepEqual(swapPoolCurrents(state, hp, sp).map(change => [change.before, change.after]),
    [[180, 15], [15, 37]]);
  for (const id of ['a', 'b']) {
    assertMirrors(state, id, 'hp', 15, 400);
    assertMirrors(state, id, 'sp', 37, 37);
  }
  assert.deepEqual(swapPoolCurrents(state, hp, state.units.b.pools.hp), []);
  updatePoolCurrent(state, hp, 'set', 0);
  swapPoolCurrents(state, hp, sp);
  for (const id of ['a', 'b']) {
    assertMirrors(state, id, 'hp', 37, 400);
    assertMirrors(state, id, 'sp', 0, 37);
  }
  const lethal = swapPoolCurrents(state, hp, sp).flatMap(change => change.lethal ? [change.lethal] : []);
  assert.deepEqual(lethal, [{ poolId: hp, units: ['a', 'b'] }]);
});

test('refresh uses effective maxima and does not change contributor bases', () => {
  const state = setup();
  linkPools(state, ['a', 'b'], ['hp']);
  const { id } = getPool(state, 'a', 'hp');
  const effectiveMax = c => c.ownerId === 'a' ? c.maxBase / 2 : 0;
  refreshPoolMax(state, id, { effectiveMax });
  assertMirrors(state, 'a', 'hp', 50, 50);
  assertMirrors(state, 'b', 'hp', 50, 50);
  assert.deepEqual(state.pools[id].contributors.map(c => c.maxBase), [100, 300]);
  unlinkPools(state, ['a'], ['hp'], { effectiveMax });
  assertMirrors(state, 'a', 'hp', 50, 50);
  assertMirrors(state, 'b', 'hp', 0, 0);
});

test('max updates clamp current, preserve initialMax, and repartition shared maxBase', () => {
  const state = setup();
  linkPools(state, ['a', 'b'], ['hp']);
  const pool = getPool(state, 'a', 'hp');
  updatePoolCurrent(state, pool.id, 'set', 250);
  const result = updatePoolMax(state, pool.id, 'add_max', 200);
  assert.equal(result.afterMax, 600);
  assert.equal(state.pools[pool.id].initialMax, 400);
  assert.equal(state.units.a.initialMaxHp, 100);
  assert.equal(state.units.b.initialMaxHp, 300);
  assert.equal(state.pools[pool.id].contributors.reduce((sum, c) => sum + c.maxBase, 0), 600);
  assert.equal(state.units.a.maxHp, 600);
  assert.equal(state.units.b.maxHp, 600);
  updatePoolMax(state, pool.id, 'sub_max', 500, { minRemain: 180 });
  assert.equal(state.pools[pool.id].max, 180);
  assert.equal(state.pools[pool.id].current, 180);
  assert.equal(state.units.a.hp, 180);
  assert.equal(state.units.b.hp, 180);
});

test('failed initialization, multi-kind topology changes, updates and swaps publish nothing', () => {
  const state = setup();
  state.units.incomplete = { hp: 5, maxHp: 5 };
  const before = JSON.stringify(state);
  assert.throws(() => initializeUnitPools(state, 'incomplete'), RangeError);
  assert.throws(() => linkPools(state, ['a', 'b'], ['hp', 'unknown']), RangeError);
  const id = state.units.a.pools.hp;
  assert.throws(() => swapPoolCurrents(state, id, 'missing'), RangeError);
  assert.throws(() => updatePoolCurrent(state, id, 'set', Infinity), RangeError);
  assert.equal(updatePoolCurrent(state, id, 'sub', 26, { minRemain: 5, requireFull: true }).applied, false);
  assert.equal(JSON.stringify(state), before);
});
