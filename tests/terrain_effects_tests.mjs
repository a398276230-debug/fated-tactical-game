import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { elevation, hasLOS } from '../src/core/spatial.js';
import { validateState } from '../src/api/validation.js';
import { validVmOpcode } from '../src/core/vm-schema.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';

const terrain = (x, y, spec) => ({ op: 'spawn', entityKind: 'terrain', at: { x, y }, spec });
function setup() {
  const { state } = hydrateFromSources({ battleInit: { units: [
    { id: 'p', name: '术士', team: 'blue', x: 1, y: 1 },
    { id: 'e', name: '敌人', team: 'red', x: 4, y: 1 },
    { id: 'reserve', name: '援军', team: 'blue', x: 8, y: 8 },
  ], grid: { slopes: [[2, 1, 1]] } } }, { throwOnValidation: true });
  state.turn = state.order.indexOf('p');
  function cast(...program) {
    const actor = currentUnit(state);
    actor.ap = 2;
    actor.used = { action: 0, attack: 0 };
    state.skills.terrain = { name: '地形', ap: 1, slot: 'action', range: 4, shape: 'single', target: 'cell',
      rules: [{ id: 'edit-terrain', hook: 'active', program }] };
    if (!actor.skills.includes('terrain')) actor.skills.push('terrain');
    validateState(state);
    const logs = applyAction(state, { type: 'skill', skillId: 'terrain', x: actor.x, y: actor.y });
    validateState(structuredClone(state));
    return logs;
  }
  function nextRound() {
    const round = state.round;
    for (let i = 0; i < state.order.length && state.round === round; i++) applyAction(state, { type: 'end' });
    assert.equal(state.round, round + 1);
    validateState(state);
  }
  return { state, cast, nextRound };
}

test('raising a rectangle changes elevation under units and preserves existing slopes', () => {
  const { state, cast } = setup();
  cast(terrain(1, 1, { height: 2, mode: 'raise', area: { shape: 'rect', width: 1, radius: 1 } }));
  assert.equal(elevation(state, state.units.p), 2);
  assert.equal(state.grid[2][2].z, 2);
  assert.equal(state.grid[1][2].z, 3);
  assert.equal(state.grid[3][3].z, 0);
});

test('walls exclude occupied cells, block LOS, and create no layer for a wholly occupied area', () => {
  const { state, cast } = setup();
  assert.ok(hasLOS(state, state.units.p, state.units.e));
  const logs = cast(terrain(1, 1, { kind: 'wall', area: { shape: 'rect', width: 1, radius: 0 } }));
  assert.equal(state.grid[1][1].kind, 'floor');
  assert.equal(state.grid[1][2].kind, 'wall');
  assert.equal(hasLOS(state, state.units.p, state.units.e), false);
  assert.ok(logs.some(log => log.type === 'terrain' && log.detail.count === 2));
  const before = structuredClone(state.spatialTerrain);
  cast(terrain(1, 1, { kind: 'wall' }));
  assert.deepEqual(state.spatialTerrain, before);
});

test('temporary cover and terrain expire independently while permanent terrain stays', () => {
  const { state, cast, nextRound } = setup();
  const before = { ...state.grid[1][2] };
  cast(terrain(2, 1, { kind: 'wall', remainingTurns: 3 }),
    { op: 'spawn', entityKind: 'cover', at: { x: 3, y: 1 }, spec: { hp: 30, remainingTurns: 1 } },
    terrain(3, 2, { kind: 'slope', persistent: true }));
  assert.equal(Object.values(state.covers)[0].hp, 30);
  nextRound();
  assert.deepEqual(state.covers, {});
  nextRound();
  assert.equal(state.grid[1][2].kind, 'wall');
  nextRound();
  assert.deepEqual(state.grid[1][2], before);
  assert.equal(state.grid[2][3].kind, 'slope');
});

for (const first of [1, 2]) test(`overlapping terrain replays surviving layers after ${first}-round effect`, () => {
  const { state, cast, nextRound } = setup();
  const before = { ...state.grid[1][2] };
  cast(terrain(2, 1, { height: 2, mode: 'raise', remainingTurns: first }),
    terrain(2, 1, { kind: 'wall', remainingTurns: 2 }));
  nextRound();
  assert.deepEqual(state.grid[1][2], { kind: 'wall', z: before.z + (first === 1 ? 0 : 2) });
  nextRound();
  assert.deepEqual(state.grid[1][2], before);
});

test('restoring an occupied wall displaces its occupant', () => {
  const { state, cast, nextRound } = setup();
  state.grid[2][2] = { kind: 'wall', z: 2 };
  cast(terrain(2, 2, { kind: 'floor', remainingTurns: 1 }));
  Object.assign(state.units.p, { x: 2, y: 2 });
  nextRound();
  assert.deepEqual(state.grid[2][2], { kind: 'wall', z: 2 });
  assert.notDeepEqual([state.units.p.x, state.units.p.y], [2, 2]);
  assert.deepEqual(state.spatialTerrain, {});
});

test('restoring terrain commits 50 true damage per level through the battle VM', () => {
  const { state, cast, nextRound } = setup();
  const before = { ...state.grid[2][2] };
  cast(terrain(2, 2, { height: 3, remainingTurns: 1 }));
  const unit = state.units.reserve;
  Object.assign(unit, { x: 2, y: 2, maxHp: 500 });
  const pool = getPool(state, unit.id, 'hp');
  pool.max = pool.contributors[0].maxBase = 500;
  updatePoolCurrent(state, pool.id, 'set', 500);
  nextRound();
  assert.deepEqual(state.grid[2][2], before);
  assert.equal(getPool(state, unit.id, 'hp').current, 350);
  const log = state.logs.find(entry => entry.type === 'damage' && entry.detail.targetId === unit.id);
  assert.equal(log?.detail.amount, 150);
  assert.equal(log.detail.damageType, 'true');
  assert.deepEqual(log.positions[unit.id], { x: 2, y: 2, z: 0 });
});

test('direct height reduction damages live occupants and leaves fled units alone', () => {
  const { state, cast } = setup();
  state.grid[2][2] = { kind: 'floor', z: 3 };
  state.grid[8][8] = { kind: 'floor', z: 3 };
  Object.assign(state.units.e, { x: 2, y: 2 });
  updatePoolCurrent(state, getPool(state, 'e', 'hp').id, 'set', 1);
  state.units.reserve.fled = true;
  const reserve = state.units.reserve.hp;
  cast(terrain(2, 2, { height: 0 }), terrain(8, 8, { height: 0 }));
  assert.equal(state.units.e.hp, 0);
  assert.ok(state.logs.some(log => log.type === 'defeat' && log.detail.targetId === 'e'));
  assert.equal(state.units.reserve.hp, reserve);
});

test('terrain schema rejects mixed shapes, unsupported terrain following, and zero turns', () => {
  assert.equal(validVmOpcode(terrain(1, 1, { kind: 'wall', area: { shape: 'circle', radius: 2 } })), true);
  for (const spec of [
    { kind: 'wall', area: { shape: 'rect', cells: [{ x: 1, y: 1 }] } },
    { kind: 'wall', follow: true }, { kind: 'wall', remainingTurns: 0 },
  ]) assert.equal(validVmOpcode(terrain(1, 1, spec)), false);
});
