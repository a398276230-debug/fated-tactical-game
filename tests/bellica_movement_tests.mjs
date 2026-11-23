import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startVM, stepVM } from '../src/core/tactical-vm.js';
import { spatialOps, spatialContinuations, expireSpatialEffects } from '../src/core/vm-spatial-ops.js';

const makeUnit = (id, x, y, summoned = false) => ({ id, name: id, x, y, hp: 10, maxHp: 10,
  mp: 0, maxMp: 0, sp: 0, maxSp: 0, team: 'blue', facing: [1, 0], tier: 1,
  stats: { str: 1, agi: 1, con: 1, int: 1, spi: 1 }, statuses: {}, gear: [], skills: [],
  move: 3, used: { attack: 0, action: 0 }, ...(summoned ? { summoned: true, remainingTurns: 1 } : {}) });
const makeState = () => ({ grid: Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => ({ kind: 'floor', z: 0 }))),
  units: { actor: makeUnit('actor', 0, 1), summon: makeUnit('summon', 1, 1, true) }, order: ['actor', 'summon'], turn: 0,
  covers: {}, items: {}, pools: {}, zones: {}, spatialTerrain: {}, logs: {}, vm: { stack: [], events: {} } });

const host = events => ({ ops: spatialOps, continue: env => spatialContinuations[env.frame.native]?.(env),
  log: () => {}, hooks: (_state, _frame, hook, eventRef) => events.push({ hook, eventRef }),
  rules: () => [] });

test('VM movement records direction, distance, and after_move event', () => {
  const state = makeState(), events = [];
  startVM(state, { ownerId: 'actor', sourceId: 'actor', program: [{ op: 'move', target: 'self', mode: 'teleport', to: { x: 3, y: 1 } }] });
  stepVM(state, host(events));
  assert.deepEqual([state.units.actor.x, state.units.actor.y], [3, 1]);
  assert.equal(state.units.actor.lastMoveDir, 'E');
  assert.equal(state.units.actor.moved, 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].hook, 'after_move');
});

test('summon remainingTurns expires at spatial round advance', () => {
  const state = makeState(), events = [];
  expireSpatialEffects(state, host(events), { advance: true, parent: { ownerId: 'actor', sourceId: 'actor' } });
  stepVM(state, { ...host(events), rules: (_state, hook) => { events.push(hook); return []; } });
  assert.equal(state.units.summon, undefined);
  assert.deepEqual(events, ['on_summon_evict', 'on_death']);
});
