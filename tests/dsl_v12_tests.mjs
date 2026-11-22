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

test('free skills leave both slots untouched and consume only the configured turn and cooldown limits', () => {
  const { state, actor, action } = battle([{ op: 'damage', target: 'target', amount: 1, damageType: 'true' }]);
  const skill = state.skills.probe;
  skill.ap = 0;
  skill.initiativeBonus = 8;
  skill.rules[0].usesPerTurn = 1;
  skill.rules[0].filter = 'event.initiativeBonus == 8';
  skill.rules[0].cooldownTurns = 2;
  actor.used = { attack: 1, action: 1 };
  actor.ap = 0;
  validateState(state);
  const initialRound = state.round;
  assert.equal(preview(state, action).ap, 0);
  assert.equal(preview(state, action).usesLeft, 1);
  actor.used = { attack: 1, action: 0 };
  actor.ap = 1;
  applyAction(state, action);
  assert.deepEqual(actor.used, { attack: 1, action: 0 });
  assert.equal(actor.ap, 1);
  assert.equal(preview(state, action).usesLeft, 0);
  for (let i = 0; i < state.order.length * 3 && !(currentUnit(state)?.id === actor.id && state.round === initialRound + 1); i++) applyAction(state, { type: 'end' });
  assert.equal(preview(state, action).cooldownRemaining, 1);
  for (let i = 0; i < state.order.length * 3 && !(currentUnit(state)?.id === actor.id && state.round === initialRound + 2); i++) applyAction(state, { type: 'end' });
  assert.equal(preview(state, action).ok, true);
});

test('save DC reads the current caster stat and applies expression bounds with fractions', () => {
  const dc = 'max(4, min(24, 6 + self.spi * 0.5))';
  for (const [spirit, expectedDC] of [[-10, 4], [10, 11], [11, 11.5], [20, 16], [50, 24]]) {
    const { state, actor, action } = battle([{ op: 'check', kind: 'save', stat: 'spi', dc }]);
    actor.stats.spi = spirit;
    validateState(state);
    const log = applyAction(state, action).find(entry => entry.type === 'save');
    assert.equal(log?.detail.saveDC, expectedDC);
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
    const logs = applyAction(state, action);
    assert.equal(Boolean(target.statuses.stun), succeeds);
    if (fields.kind === 'save') {
      const { detail } = logs.find(log => log.type === 'save');
      assert.equal(detail.mode, fields.mode);
      assert.equal(detail.saved, succeeds);
      assert.deepEqual(detail.checks.map(check => [check.saveStat, check.saveDC, check.saved]), [['str', 20, true], ['con', 20, false]]);
      for (const check of detail.checks) assert.equal(check.saveTotal, check.saveRoll + check.saveBonus);
    }
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
