import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateExpr } from '../src/core/formula.js';
import { validVmRule, validVmStatMod } from '../src/core/vm-schema.js';
import { commitVMEffect, dispatchVMHook, resolveVMAction } from '../src/core/vm-runtime.js';
import { preview, applyAction } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { rollD20 } from '../src/core/rng.js';

function fixture() {
  const state = buildScenario('ruins');
  const first = Object.values(state.units).find(unit => unit.team === 'blue');
  const second = Object.values(state.units).find(unit => unit.team === 'red');
  state.units = { [first.id]: first, [second.id]: second };
  state.order = [first.id, second.id];
  state.turn = 0;
  state.ruleset = 'sandbox';
  state.outcome = null;
  delete state.vm;
  delete state.pools;
  for (const carrier of [...Object.values(state.units), ...Object.values(state.items)]) delete carrier.pools;
  state.logs = [];
  state.covers = {};
  state.zones = {};
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  Object.assign(first, { x: 1, y: 1, ap: 2, used: { attack: 0, action: 0 }, statuses: {}, skills: [] });
  Object.assign(second, { x: 2, y: 1, ap: 2, used: { attack: 0, action: 0 }, statuses: {}, skills: [] });
  return { state, first, second };
}

function settle(state) {
  while (state.vm?.stack?.length) {
    resolveVMAction(state, { type: 'end' });
    if (state.vm.stack.length === 0) break;
  }
  return state;
}

function resetTurn(state, actor) {
  state.order = [actor.id]; state.turn = 0; actor.ap = 2; actor.used = { attack: 0, action: 0 };
}

test('Stage 4 Batch A: flat-only crit modifier, event scalars and facing_arc are valid', () => {
  assert.equal(validVmStatMod({ stat: 'critDamageBonus', flat: 0.3 }), true);
  assert.equal(validVmStatMod({ stat: 'critDamageBonus', mult: 1.3 }), false);
  assert.equal(validVmRule({ id: 'front', hook: 'after_check', filter: "facing_arc(self, attacker) == 'back'", program: [] }), true);
  const observer = { x: 4, y: 4, facing: [1, 0] };
  assert.equal(evaluateExpr("facing_arc(self, target)", { self: observer, target: { x: 2, y: 4 } }), 'back');
  assert.equal(evaluateExpr("facing_arc(self, target)", { self: observer, target: { x: 4, y: 2 } }), 'side');
  assert.equal(evaluateExpr("facing_arc(self, target)", { self: observer, target: { x: 6, y: 4 } }), 'front');
});

test('Stage 4 Batch A: multi-stat VM checks evaluate bonuses against each stat', () => {
  const { state, first, second } = fixture();
  first.mods = [
    { stat: 'checkBonus', flat: 8, when: "event.stat == 'spi'" },
    { stat: 'checkBonus', flat: -3, when: "event.stat == 'int'" },
  ];
  first.skills = ['dual_check'];
  state.skills.dual_check = { name: '双属性检定', ap: 1, slot: 'attack', range: 1, target: 'self', rules: [{ id: 'roll', hook: 'active', program: [
    { op: 'check', kind: 'd20', stat: ['spi', 'int'], dc: 1, rawNatural: true },
  ] }] };
  resolveVMAction(state, { type: 'skill', skillId: 'dual_check', x: first.x, y: first.y });
  const check = state.logs.find(log => log.type === 'vm_check');
  assert.ok(check, 'check result logged');
  const outcomes = check.detail.outcomes;
  assert.equal(outcomes[0].total - outcomes[0].roll - first.stats.spi, 8);
  assert.equal(outcomes[1].total - outcomes[1].roll - first.stats.int, -3);
  assert.ok(state.units[second.id]);
});

test('Stage 4 Batch A: critical damage bonus modifies rating scale and reaches commit hooks', () => {
  const { state, first, second } = fixture();
  first.x = 1; first.y = 1; second.x = 2; second.y = 1;
  first.mods = [{ flags: ['guaranteed_crit'] }, { stat: 'critDamageBonus', flat: 0.5 }];
  first.skills = ['test_crit'];
  state.skills.test_crit = { name: '暴击测试', ap: 1, slot: 'attack', range: 2, target: 'enemy',
    damage: { count: 1, sides: 1, stat: 'str', type: 'true' }, rules: [] };
  resolveVMAction(state, { type: 'skill', skillId: 'test_crit', x: second.x, y: second.y });
  const damage = state.logs.find(log => log.type === 'damage' && log.detail.targetId === second.id);
  const roll = state.logs.find(log => log.type === 'roll' && log.detail.targetId === second.id);
  assert.ok(roll && damage);
  assert.equal(roll.detail.critical, true);
  assert.equal(damage.detail.ratingMultiplier, roll.detail.rating.multiplier + 0.5);
});

test('Stage 4 Batch A: lethal hooks receive applied damage and overkill scalars', () => {
  const { state, first, second } = fixture();
  first.hp = 5;
  first.mp = 0;
  first.rules = [{ id: 'read_lethal_damage', hook: 'on_lethal_p1', program: [
    { op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 'event.dealt' },
  ] }];
  commitVMEffect(state, { op: 'damage', amount: 12, damageType: 'true', sourceId: second.id, targetId: first.id });
  assert.equal(first.mp, 5);
  assert.equal(first.hp, 0);
});
