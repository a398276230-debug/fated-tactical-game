import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, preview } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';

const strike = { type: 'attack', x: 3, y: 2 };
function battle(souls) {
  const state = buildScenario('ruins');
  const actor = state.units.swordsman, target = state.units.scout;
  actor.x = 2;
  actor.nonLethal = target.nonLethal = false;
  const item = state.items[actor.weapon];
  item.rules = [...item.rules, { id: 'assured-hit', hook: 'before_check', filter: "event.checkKind == 'attack'",
    program: [{ op: 'mutate_event', patch: { forceOutcome: 'hit' } }] }];
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', 1);
  updatePoolCurrent(state, getPool(state, item.id, 'souls', 'item').id, 'set', souls);
  return state;
}

test('native VM soulblade applies stored souls, credits its own kill and caps the pool', () => {
  for (const souls of [0, 2, 10]) {
    const state = battle(souls);
    assert.equal(preview(state, strike).damageMultiplier, 1 + souls * .5);
    applyAction(state, strike);
    assert.equal(state.units.scout.hp, 0);
    assert.equal(getPool(state, 'soulblade-lan', 'souls', 'item').current, Math.min(10, souls + 1));
    assert.equal(getPool(state, 'soulblade-spare', 'souls', 'item').current, 0);
    validateState(JSON.parse(JSON.stringify(state)));
  }
});

test('removed effects are rejected at the state and snapshot boundaries', () => {
  const state = battle(0);
  state.equipment.soulblade.effects = [{ kind: 'kill_charge_weapon' }];
  assert.throws(() => validateState(state), /无效字段/);
  const api = createGameAPI();
  assert.throws(() => api.restoreBattleSnapshot({ kind: 'battle', version: 2, origin: state, state, journal: [] }));
});
