import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validVmOpcode, validVmSelector, validVmStatMod } from '../src/core/vm-schema.js';
import { selectVM } from '../src/core/vm-select.js';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';

test('schema accepts entity let references and dynamic status ids', () => {
  assert.equal(validVmOpcode({ op: 'let', name: 'allyRef', value: 'self' }), true);
  assert.equal(validVmOpcode({ op: 'let', name: 'sid', value: 'self' }), true);
  assert.equal(validVmOpcode({ op: 'apply_status', target: 'target', statusId: 'vars.sid' }), true);
  assert.equal(validVmOpcode({ op: 'check', kind: 'd20', statusId: 'vars.sid', rawNatural: true }), true);
});

test('selector options are a static scalar candidate pool and random sampling is deterministic', () => {
  const selector = { options: ['poison', 'burn', 'freeze', 'stun'], pick: { first: 2 } };
  assert.equal(validVmSelector(selector), true);
  const state = { rng: 123, units: {}, zones: {}, covers: {}, spatialTerrain: {}, grid: [[{ z: 0 }, { z: 0 }]] };
  const context = { vars: {}, self: { x: 0, y: 0 }, resolveEntity: value => value };
  assert.deepEqual(selectVM(state, selector, context), ['poison', 'burn']);
});

test('selector area accepts center alias and expression-valued dimensions', () => {
  const selector = { from: 'units', area: { shape: 'circle', center: 'self', radius: '1 + 1', innerRadius: '0', width: '1' } };
  assert.equal(validVmSelector(selector), true);
  const unit = { id: 'u1', x: 1, y: 0 };
  const state = { rng: 1, units: { u1: unit }, zones: {}, covers: {}, spatialTerrain: {}, grid: [[{ z: 0 }, { z: 0 }, { z: 0 }]] };
  const context = { vars: {}, self: { x: 0, y: 0 }, resolveEntity: value => value };
  assert.deepEqual(selectVM(state, selector, context), [unit]);
});

test('entity registers and random status application survive battle journal replay', () => {
  const state = buildScenario('ruins');
  const actor = state.units[state.order[state.turn]];
  const skillId = 'random-status-probe';
  actor.skills.push(skillId);
  state.skills[skillId] = { name: '抽样', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [
    { id: 'sample', hook: 'active', program: [
      { op: 'let', name: 'recipient', value: 'self' },
      { op: 'if', cond: 'vars.recipient.hp > 0', then: [
        { op: 'for_each', select: { options: ['poison', 'burn', 'freeze', 'stun'], pick: { random: 2 } }, bind: 'sid', body: [
          { op: 'apply_status', target: 'vars.recipient', statusId: 'vars.sid', turns: 2 },
        ] },
      ] },
    ] },
  ] };
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  api.playAction({ type: 'skill', skillId, targetId: actor.id, x: actor.x, y: actor.y });
  const snapshot = api.exportBattleSnapshot();
  const sampled = Object.keys(snapshot.state.units[actor.id].statuses).filter(id => ['poison', 'burn', 'freeze', 'stun'].includes(id));
  assert.equal(sampled.length, 2);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored.exportBattleSnapshot(), snapshot);
});

test('movement and incoming distance modifiers are valid stat modifiers', () => {
  assert.equal(validVmStatMod({ stat: 'movement', flat: 3 }), true);
  assert.equal(validVmStatMod({ stat: 'incomingDistanceOffset', flat: 1 }), true);
});
