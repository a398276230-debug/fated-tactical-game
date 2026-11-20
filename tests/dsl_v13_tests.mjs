import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit, grantStatus } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';

function impact(node, { nonLethal = false, status = false } = {}) {
  const state = buildScenario('ruins'), actor = currentUnit(state), target = state.units.scout;
  Object.assign(target, { hp: 10, nonLethal });
  actor.nonLethal = false;
  actor.resources = { charge: 10 };
  if (status) {
    state.statusTemplates = { safe: { id: 'safe', name: '校准保护', icon: '◇', category: 'buff', description: '承伤保命', remainingTurns: 1, durationType: 'battle_turns', tickTiming: 'onTurnStart', stackRule: 'refresh', maxStacks: 1, modifiers: { preserveLife: true } } };
    grantStatus(state, target, 'safe');
  }
  actor.skills.push('impact');
  state.skills.impact = { name: '校准', target: 'enemy', slot: 'action', shape: 'single', range: 3, ap: 1, effects: [{ id: 'impact_v13', trigger: 'active', target: 'hitTarget', effects: [{ kind: 'damage', damageType: 'true', amount: 9999, ...node }] }] };
  validateState(state);
  const logs = applyAction(state, { type: 'skill', skillId: 'impact', x: target.x, y: target.y });
  assert.ok(logs.some(log => log.type === 'damage' && log.detail.effectId === 'impact_v13'));
  return [target.hp, logs.some(log => log.type === 'defeat' && log.detail.targetId === target.id)];
}
for (const [gate, node, options, hp] of [
  [79, { lethal: false }, {}, 1], [80, {}, {}, 0], [81, { lethal: true }, { nonLethal: true }, 1],
  [82, { amount: 2, resourceMultiplier: 'charge', strikeBonus: true, lethal: false }, {}, 1],
]) test(`G${gate} damage HP floor`, () => {
  const actual = impact(node, options); assert.deepEqual(actual, [hp, hp === 0]);
  console.log(`G${gate} PASS hp=${hp} defeat=${actual[1]}`);
});
test('recipient preserveLife modifier protects against explicitly lethal damage', () => assert.deepEqual(impact({ lethal: true }, { status: true }), [1, false]));
