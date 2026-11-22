import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, currentUnit, preview } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { applyPatch } from '../src/tavern/overlay.js';

function battle(program) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  actor.skills.push('probe');
  state.skills.probe = { name: '检定', range: 3, ap: 1, slot: 'action', shape: 'single', target: 'enemy',
    rules: [{ id: 'probe', hook: 'active', program }] };
  return { state, actor, target, action: { type: 'skill', skillId: 'probe', x: target.x, y: target.y } };
}

const stun = { op: 'apply_status', target: 'target', statusId: 'stun' };

test('save DC reads the current caster stat and applies expression bounds with fractions', () => {
  const dc = 'max(4, min(24, 6 + self.spi * 0.5))';
  for (const [spirit, expectedDC] of [[-10, 4], [10, 11], [11, 11.5], [20, 16], [50, 24]]) {
    const { state, actor, action } = battle([{ op: 'check', kind: 'save', stat: 'spi', dc }]);
    actor.stats.spi = spirit;
    validateState(state);
    const log = applyAction(state, action).find(entry => entry.type === 'save');
    assert.equal(log?.detail.dc, expectedDC);
  }
});

test('combined and opposed checks execute distinct branches', () => {
  for (const [fields, succeeds] of [
    [{ kind: 'save', stat: ['str', 'con'], dc: 20, mode: 'all' }, false],
    [{ kind: 'save', stat: ['str', 'con'], dc: 20, mode: 'any' }, true],
    [{ kind: 'contest', stat: 'str', defenderStat: 'con' }, true],
  ]) {
    const { state, actor, target, action } = battle([{ op: 'check', ...fields, onPass: [stun] }]);
    actor.stats.str = target.stats.str = 50;
    target.stats.con = -20;
    validateState(state);
    applyAction(state, action);
    assert.equal(Boolean(target.statuses.stun), succeeds);
  }
});

test('patching enabled on one opcode preserves its sibling and changes the next resolution', () => {
  const { state, action, target } = battle([
    { op: 'damage', target: 'target', damageType: 'true', amount: 2, enabled: true },
    { op: 'damage', target: 'target', damageType: 'true', amount: 1 },
  ]);
  const path = '/skills/probe/rules/0/program/0/enabled';
  for (const [value, expected] of [[true, 3], [false, 1], [true, 3]]) {
    const trial = validateState(applyPatch(state, [{ op: 'replace', path, value }]));
    const hp = trial.units[target.id].hp;
    assert.ok(preview(trial, action).ok);
    applyAction(trial, action);
    assert.equal(hp - trial.units[target.id].hp, expected);
  }
});

test('VM status expiry filters direct damage from indirect damage', () => {
  const id = 'brittle';
  for (const direct of [false, true]) {
    const { state, action, target } = battle([
      { op: 'apply_status', statusId: id, target: 'target', expireOn: { hook: 'after_damage', filter: 'event.direct == true' } },
      { op: 'damage', target: 'target', damageType: 'true', amount: 1, direct },
    ]);
    state.statusTemplates = { [id]: { id, name: '易碎' } };
    validateState(state);
    applyAction(state, action);
    assert.equal(Boolean(target.statuses[id]), !direct);
  }
});
