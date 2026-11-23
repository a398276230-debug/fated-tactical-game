import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/presets/scenarios.js';
import { actionSkill, applyAction, currentUnit, preview } from '../src/core/combat.js';
import { canStep, coverBetween, unitsAt } from '../src/core/spatial.js';
import { chooseAction } from '../src/core/ai.js';
import { battleAiPayload } from '../src/core/battle-ai.js';
import { narrate } from '../src/ui/narrate.js';

test('shared-cell occupancy, precise single-target aim, and scaled regional cover', () => {
  const state = buildScenario('ruins');
  const [actorId, firstId, secondId] = state.order;
  const actor = state.units[actorId], first = state.units[firstId], second = state.units[secondId];
  first.x = second.x = 3; first.y = second.y = 2;
  actor.x = 2; actor.y = 2;
  assert.deepEqual(unitsAt(state, 3, 2).map(unit => unit.id), [firstId, secondId].sort());
  const aim = preview(state, { type: 'attack', targetId: secondId, x: 3, y: 2 });
  assert.equal(aim.ok, true, aim.error);
  assert.deepEqual(aim.targets.filter(target => target.kind !== 'cover').map(target => target.id), [secondId]);

  state.scale.cellM = 50;
  state.grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.covers.region = { id: 'region', name: '断壁', x: 4, y: 4, cover: 5, hp: 2500, maxHp: 2500 };
  const occupant = { ...first, id: 'cover-occupant', x: 3, y: 4, bodyLengthM: 1.7 };
  state.units[occupant.id] = occupant;
  const adjacent = { ...occupant, x: 4, y: 4 };
  assert.equal(canStep(state, occupant, adjacent), true);
  assert.equal(coverBetween(state, { x: 4, y: 8 }, { ...adjacent, bodyLengthM: 1.7 })?.id, 'region');
  assert.equal(coverBetween(state, { x: 4, y: 8 }, { ...adjacent, bodyLengthM: 60 }), null);
});

test('subcell movement banks 600 permille then spends a step and retains 200', () => {
  const state = buildScenario('ruins');
  Object.assign(state.scale, { anchorTier: 4, cellM: 15 });
  const actor = currentUnit(state);
  actor.moveM = 9;
  actor.move = 0;
  const { x, y } = actor;
  applyAction(state, { type: 'move', x, y });
  assert.equal(actor.moveCarryPermille, 600);
  const bankLog = state.logs.find(log => log.detail.progressPermille === 600);
  assert.match(bankLog.text, /蓄步推进（跨区进度约 60%）$/);
  assert.match(narrate(bankLog, state).title, /蓄步推进.*约 60%/);
  assert.doesNotMatch(narrate(bankLog, state).title, /\d+m|移动 0 格/);
  actor.ap = 2;
  actor.used.action = 0;
  const destination = preview(state, { type: 'move' }).cells.find(cell => cell.steps === 1);
  assert.ok(destination);
  applyAction(state, { type: 'move', x: destination.x, y: destination.y });
  assert.equal(actor.moveCarryPermille, 200);
  assert.deepEqual([actor.x, actor.y], [destination.x, destination.y]);
});

test('T5 and higher reject subcell movement and sprint while allowing full steps', () => {
  for (const [anchorTier, cellM] of [[5, 50], [6, 250], [7, 1000]]) {
    const state = buildScenario('ruins');
    Object.assign(state.scale, { anchorTier, cellM });
    const actor = currentUnit(state);
    actor.moveM = 6;
    actor.move = 0;
    const { x, y } = actor;
    for (const type of ['move', 'sprint']) {
      assert.deepEqual(preview(state, { type }).cells, []);
      assert.equal(preview(state, { type, x, y }).ok, false);
      assert.throws(() => applyAction(structuredClone(state), { type, x, y }), /无法到达/);
    }
    assert.equal(actor.moveCarryPermille ?? 0, 0);
    actor.moveM = cellM;
    const step = preview(state, { type: 'move' }).cells.find(cell => cell.steps === 1);
    assert.ok(step);
    applyAction(state, { type: 'move', x: step.x, y: step.y });
    assert.deepEqual([actor.x, actor.y], [step.x, step.y]);
  }
});

test('enemy AI banks movement on a reachable route and spends it on a later turn', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  actor.team = 'red';
  actor.skills = [];
  actor.x = actor.y = 1;
  actor.moveM = 600;
  actor.moveCarryPermille = 0;
  state.scale.cellM = 1000;
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.interactives = {};
  for (const unit of Object.values(state.units)) {
    if (unit === actor) continue;
    unit.team = 'blue';
    unit.x = 8;
    unit.y = 8;
  }
  actor.moveM = 300;
  assert.deepEqual(battleAiPayload(state).battle.movementCarry[actor.id], {
    currentPercent: 0, movePercent: 30, sprintPercent: 60,
  });
  actor.moveM = 600;
  // With the attack slot already spent, the AI has only ordinary movement available.
  actor.used = { attack: 1, action: 0 };
  actor.ap = 1;
  const action = chooseAction(state);
  assert.deepEqual(action, { type: 'move', x: 1, y: 1 });
  applyAction(state, action);
  assert.equal(actor.moveCarryPermille, 600);
  state.turn = state.order.indexOf(actor.id);
  actor.used = { attack: 1, action: 0 };
  actor.ap = 1;
  const next = chooseAction(state);
  assert.equal(next.type, 'move');
  assert.equal(preview(state, next).steps, 1);
  applyAction(state, next);
  assert.equal(actor.moveCarryPermille, 200);
});

test('skill geometry is resolved for the individual caster and preserves fractional radius', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  state.skills.scaled = { name: '测试', ap: 1, slot: 'attack', target: 'enemy', shape: 'circle', range: 4, radius: 2, rawRange: 4, rawRadius: 2, quality: '普通' };
  state.scale.cellM = 1000;
  actor.tier = 6;
  assert.equal(actionSkill(state, actor, 'scaled').range, 1);
  assert.equal(actionSkill(state, actor, 'scaled').radius, 0.5);
  actor.tier = 7;
  assert.equal(actionSkill(state, actor, 'scaled').range, 4);
});
