import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit, preview, reachable, refreshOpeningInitiative } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';
import { vmHost } from '../src/core/vm-runtime.js';

const strike = { type: 'attack', x: 3, y: 2 };
function battle() {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  const item = state.items[actor.weapon];
  state.equipment[item.templateId].range = 6;
  actor.nonLethal = false;
  target.nonLethal = false;
  return { state, actor, target, item };
}

function addSkill(state, actor, id, program, fields = {}) {
  state.skills[id] = { name: id, ap: 1, range: 2, shape: 'single', target: 'enemy', slot: 'action',
    rules: [{ id, hook: 'active', program }], ...fields };
  actor.skills.push(id);
  return { ...strike, type: 'skill', skillId: id };
}

test('a custom ranged hit hook applies its own damage packet', () => {
  const { state, item, target } = battle();
  item.rules = [
    { id: 'force-hit', hook: 'before_check', filter: "event.checkKind == 'attack'", program: [{ op: 'mutate_event', patch: { forceOutcome: 'hit' } }] },
    { id: 'extra-damage', hook: 'after_hit', filter: 'event.melee == false', program: [
      { op: 'damage', target: 'target', amount: 60, damageType: 'physical', direct: false, label: '额外物理伤害' },
    ] },
  ];
  validateState(state);
  const logs = applyAction(state, strike);
  const packet = logs.find(log => log.type === 'damage' && log.text.includes('额外物理伤害'));
  assert.equal(packet?.detail.targetId, target.id);
  assert.equal(packet.detail.damageType, 'physical');
});

test('strict execute threshold credits souls by target tier and updates weapon preview', () => {
  for (const [hp, kills] of [[1, true], [2, false]]) {
    const { state, actor, target, item } = battle();
    target.tier = 2;
    const pool = getPool(state, target.id, 'hp');
    target.maxHp = pool.max = pool.contributors[0].maxBase = 8;
    updatePoolCurrent(state, pool.id, 'set', hp);
    const action = addSkill(state, actor, 'reap', [{ op: 'if', cond: 'target.hp < target.maxHp * 0.25', then: [
      { op: 'damage', target: 'target', amount: 'target.hp', damageType: 'true' },
    ] }]);
    item.rules = [{ id: 'reap-credit', hook: 'after_action', filter: "event.skillId == 'reap' && target.hp == 0",
      program: [{ op: 'let', name: 'reward', value: 'target.tier * 4' },
        { op: 'resource', target: 'self', pool: 'souls', mode: 'add', amount: 'vars.reward', local: true }] }];
    validateState(state);
    applyAction(state, action);
    assert.equal(target.hp, kills ? 0 : hp);
    assert.equal(getPool(state, item.id, 'souls', 'item').current, kills ? 8 : 0);
    updatePoolCurrent(state, pool.id, 'set', 8);
    assert.equal(preview(state, strike).damageMultiplier, kills ? 5 : 1);
  }
});

test('on_kill can refund the consumed attack slot through the pseudo resource pool', () => {
  const { state, actor, target } = battle();
  target.hp = 1;
  getPool(state, target.id, 'hp').current = 1;
  const id = 'execute-and-refund';
  state.skills[id] = { name: id, ap: 0, range: 6, shape: 'single', target: 'enemy', slot: 'action',
    rules: [
      { id: 'strike', hook: 'active', program: [{ op: 'damage', target: 'target', amount: 10, damageType: 'true' }] },
      { id: 'refund', hook: 'on_kill', filter: 'event.killerId == self.id', program: [
        { op: 'resource', target: 'self', pool: 'attack', mode: 'add', amount: 1 },
      ] },
    ] };
  actor.skills.push(id);
  validateState(state);
  // The free action is performed after the attack slot was already spent;
  // its on_kill rule must refund that depleted slot.
  actor.used.attack = 1;
  actor.ap = 1;
  assert.equal(preview(state, { type: 'skill', skillId: id, x: target.x, y: target.y }).ok, true);
  applyAction(state, { type: 'skill', skillId: id, x: target.x, y: target.y });
  assert.equal(target.hp, 0);
  assert.equal(actor.used.attack, 0);
  assert.equal(actor.ap, 2, 'refund restores the aggregate AP budget');
  assert.ok(state.logs.some(log => log.type === 'resource' && log.detail.resource === 'attack'));
  const secondTarget = target;
  const secondPool = getPool(state, secondTarget.id, 'hp');
  secondPool.current = secondTarget.hp = secondTarget.maxHp;
  const second = { type: 'attack', x: secondTarget.x, y: secondTarget.y };
  assert.equal(preview(state, second).ok, true, `refunded attack slot is executable again: ${preview(state, second).error ?? 'unknown'}`);
  applyAction(state, second);
  assert.equal(state.units[actor.id].used.attack, 1);
});

test('move pseudo pool reaches zero and native preview honors the exhausted budget', () => {
  const { state, actor } = battle();
  const remaining = () => vmHost.resource(state, actor, 'move');
  assert.equal(remaining(), 3);
  for (const steps of [2, 1]) {
    const cell = reachable(state).find(cell => cell.steps === steps && !cell.opportunities.length);
    assert.ok(cell);
    applyAction(state, { type: 'move', x: cell.x, y: cell.y });
    assert.equal(remaining(), steps - 1);
  }
  assert.equal(preview(state, { type: 'move' }).cells?.length ?? 0, 0);
  assert.equal(preview(state, { type: 'move', x: actor.x + 1, y: actor.y }).ok, false);

  const fresh = battle();
  fresh.actor.moved = fresh.actor.move;
  assert.ok(reachable(fresh.state).length > 0);
  const drain = addSkill(fresh.state, fresh.actor, 'drain', [
    { op: 'resource', target: 'self', pool: 'move', mode: 'sub', amount: 3 },
  ]);
  applyAction(fresh.state, drain);
  assert.equal(vmHost.resource(fresh.state, fresh.actor, 'move'), 0);
  assert.deepEqual(reachable(fresh.state), []);
});

test('equipment initiative and attribute modifiers reuse the opening roll', () => {
  const { state, actor, item } = battle();
  const initiative = () => state.logs[0].detail.initiative.find(row => row.unitId === actor.id);
  const before = initiative();
  item.mods = [{ stat: 'initiativeFlat', flat: 2 }, { stat: 'agi', mult: 1.25 }];
  refreshOpeningInitiative(state);
  const after = initiative();
  assert.equal(after.roll, before.roll);
  assert.equal(after.agility, before.agility * 1.25);
  assert.equal(after.flatInit, before.flatInit + 2);
});
