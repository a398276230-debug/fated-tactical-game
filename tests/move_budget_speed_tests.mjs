import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { applyAction, currentUnit, preview, reachable } from '../src/core/combat.js';
import { defaultMoveFromAgi, boardMoveCellsFromMoveM } from '../src/core/combat_protocol.js';
import { initializeVMWorld, vmHost } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { hydrateFromSources } from '../src/tavern/converter.js';

function fixture() {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'sandbox' });
  const actor = currentUnit(state);
  state.grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.interactives = {};
  for (const [i, unit] of Object.values(state.units).filter(unit => unit !== actor).entries()) {
    Object.assign(unit, { x: i, y: 8 });
  }
  Object.assign(actor, { x: 1, y: 2, move: 3, bonusDice: 0, stance: 'light_blade' });
  return { state, actor };
}

const move = (x, y = 2) => ({ type: 'move', x, y });
const remaining = (state, actor) => vmHost.resource(state, actor, 'move');

test('敏捷五档的默认移动力', () => {
  assert.deepEqual([undefined, 0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 25].map(defaultMoveFromAgi),
    [3, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6]);
  const { state } = hydrateFromSources({
    battleInit: 'battle|1|move-override|移动测试|flat\nunit|p1|blue|char_info|甲|1,1',
    charInfo: [{ name: '甲', stats: { agi: 20 }, 移动: 4 }],
  }, { throwOnValidation: true });
  assert.equal(state.units.p1.rawMove, 4);
});

test('盘面格数、寻路与 VM 伪池共用尺度预算', () => {
  const { state, actor } = fixture();
  state.scale = { ...state.scale, width: 10, height: 10, anchorTier: 1, cellM: 2 };
  Object.assign(actor, { tier: 4, moveM: 45, move: boardMoveCellsFromMoveM(45, state.scale) });
  assert.equal(actor.move, 20);
  assert.equal(remaining(state, actor), 20);
  assert.deepEqual(reachable(state), reachable(state, 'move', actor, 20));
  state.scale = { ...state.scale, anchorTier: 4, cellM: 15 };
  actor.skills.push('call');
  state.skills.call = { name: '召唤', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self',
    rules: [{ id: 'call', hook: 'active', program: [{ op: 'spawn', entityKind: 'unit', spec: { turnMode: 'linked_each', spawnPanel: { tier: 1, move: 3 } } }] }] };
  applyAction(state, { type: 'skill', skillId: 'call', x: actor.x, y: actor.y });
  const summon = Object.values(state.units).find(unit => unit.summoned);
  assert.equal(summon.rawMove, 3);
  assert.equal(summon.move, 0);
  assert.equal(remaining(state, summon), 0);
  assert.equal(preview(state, { type: 'sprint', actorId: summon.id, x: summon.x + 3, y: summon.y }).ok, false);
  assert.equal(reachable(state, 'move', summon)[0].bankedProgress, 400);
});

test('分步移动穿插普攻，疾跑追加预算并可重放', () => {
  const { state, actor } = fixture();
  const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
  Object.assign(enemy, { x: 3, y: 3 });
  initializeVMWorld(state);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  const actions = [move(3), { type: 'attack', x: 3, y: 3 }, move(4), { type: 'sprint', x: 6, y: 2 }, move(7)];
  for (const [i, action] of actions.entries()) {
    const result = api.playAction(action);
    assert.equal(result.ok, true, result.error);
    const after = api.getBattleState();
    const unit = after.units[actor.id];
    assert.equal(unit.ap, [2, 1, 1, 0, 0][i]);
    assert.equal(remaining(after, unit), [1, 1, 0, 1, 0][i]);
    const snapshot = api.exportBattleSnapshot();
    const replay = createGameAPI();
    replay.createBattle(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(JSON.stringify(replay.exportBattleSnapshot()), JSON.stringify(snapshot));
  }
});

test('原地蓄步与轻剑奖励骰每回合只结算一次', () => {
  const { state, actor } = fixture();
  actor.moveM = 1;
  applyAction(state, move(1));
  assert.equal(actor.ap, 2);
  assert.equal(actor.moveCarryPermille, 500);
  assert.match(preview(state, move(1)).error, /移动力已耗尽/);
  const fresh = fixture();
  for (const x of [2, 3, 4]) applyAction(fresh.state, move(x));
  assert.equal(fresh.actor.bonusDice, 1);
});

test('AP 用完后可走光移动力再自动交棒', () => {
  const { state, actor } = fixture();
  const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
  Object.assign(enemy, { x: 1, y: 3, hp: 1000, maxHp: 1000 });
  applyAction(state, { type: 'attack', x: 1, y: 3 });
  applyAction(state, { type: 'brace' });
  assert.equal(actor.ap, 0);
  assert.equal(remaining(state, actor), 3);
  assert.equal(currentUnit(state).id, actor.id);
  applyAction(state, move(3));
  assert.equal(currentUnit(state).id, actor.id);
  applyAction(state, move(4));
  assert.notEqual(currentUnit(state).id, actor.id);
});
