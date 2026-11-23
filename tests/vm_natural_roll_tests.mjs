import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { dispatchVMHook } from '../src/core/vm-runtime.js';
import { rollDie } from '../src/core/rng.js';

const coin = { id: 'coin', hook: 'after_natural_roll', filter: 'attacker.id == self.id && event.naturalRoll < 6',
  program: [{ op: 'mutate_event', patch: { replaceNaturalRoll: 11 } }] };

test('natural d20 replacement changes native attack settlement without a reroll', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const target = Object.values(state.units).find(unit => unit.team !== actor.team);
  Object.assign(target, { x: actor.x, y: actor.y });
  actor.rules = [coin];
  state.rng = 1972;
  const original = structuredClone(state);
  original.units[actor.id].rules = [];
  const command = { type: 'attack', x: target.x, y: target.y, targetId: target.id };
  const baseline = applyAction(original, command).find(log => log.type === 'roll');
  const replaced = applyAction(state, command).find(log => log.type === 'roll');
  assert.equal(baseline.detail.selected, 1);
  assert.deepEqual(replaced.detail.dice, baseline.detail.dice);
  assert.equal(replaced.detail.selected, 11);
});

test('VM rawNatural keeps the original roll and fixed RNG consumption', () => {
  for (const rawNatural of [false, true]) {
    const state = buildScenario('ruins');
    const actor = currentUnit(state);
    state.rng = 1972;
    actor.rules = [coin, { id: 'probe', hook: 'turn_start', program: [{ op: 'check', kind: 'd20', dc: 10, rawNatural }] }];
    dispatchVMHook(state, 'turn_start', { actorId: actor.id, targetId: actor.id });
    const log = state.logs.findLast(entry => entry.type === 'vm_check');
    assert.equal(log.detail.outcomes[0].roll, rawNatural ? 1 : 11);
    assert.equal(log.detail.success, !rawNatural);
    assert.equal(state.rng, rollDie(1972, 20).rng);
  }
});
