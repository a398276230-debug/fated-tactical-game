import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';

function impact(fields, { nonLethal = false, preserveLife = false } = {}) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  target.nonLethal = nonLethal;
  actor.nonLethal = false;
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', 10);
  if (preserveLife) target.mods = [{ flags: ['preserveLife'] }];
  actor.skills.push('impact');
  state.skills.impact = { name: '校准', target: 'enemy', slot: 'action', shape: 'single', range: 3, ap: 1,
    rules: [{ id: 'impact', hook: 'active', program: [{ op: 'damage', target: 'target', damageType: 'true', amount: 9999, ...fields }] }] };
  validateState(state);
  const logs = applyAction(state, { type: 'skill', skillId: 'impact', x: target.x, y: target.y });
  assert.ok(logs.some(log => log.type === 'damage' && log.detail.targetId === target.id));
  return [target.hp, logs.some(log => log.type === 'defeat' && log.detail.targetId === target.id)];
}

for (const [name, fields, options, hp] of [
  ['explicit lethal false', { lethal: false }, {}, 1],
  ['default lethal', {}, {}, 0],
  ['nonlethal unit', { lethal: true }, { nonLethal: true }, 1],
  ['recipient preserveLife', { lethal: true }, { preserveLife: true }, 1],
]) test(`VM damage HP floor honors ${name}`, () => assert.deepEqual(impact(fields, options), [hp, hp === 0]));
