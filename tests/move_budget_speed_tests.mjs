import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { applyAction, currentUnit, preview, reachable } from '../src/core/combat.js';
import { defaultMoveFromAgi, boardMoveCellsFromMoveM, TIER_CELL_M } from '../src/core/combat_protocol.js';
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

test('七阶敏捷曲线按四分之一格取整，缺省敏捷仍为三格', () => {
  const agility = [-1, 0, 2, 5, 8, 12, 15, 18, 20, 25];
  const anchors = [
    [2,    2,    2,    3,    4,    4.5, 4.5,  4.5,  4.5,  4.5],
    [2.5,  2.5,  2.5,  3.75, 5,    5.5, 5.5,  5.5,  5.5,  5.5],
    [2.25, 2.25, 2.25, 2.25, 3,    4,   4.75, 5,    5,    5],
    [2,    2,    2,    2,    2,    3,   3.75, 4.5,  5,    5],
    [2,    2,    2,    2,    2,    2.5, 3.25, 4,    4.5,  4.5],
    [2,    2,    2,    2,    2,    2,   2.75, 3.5,  4,    4],
    [2,    2,    2,    2,    2,    2,   2.5,  3.25, 3.75, 3.75],
  ];
  for (const [i, expected] of anchors.entries()) {
    const tier = i + 1;
    for (const agi of [null, undefined, NaN, Infinity, -Infinity, '无效']) {
      assert.equal(defaultMoveFromAgi(agi, tier), 3, `T${tier} agi=${agi}`);
    }
    for (const [j, agi] of agility.entries()) {
      assert.equal(defaultMoveFromAgi(agi, tier), expected[j], `T${tier} agi=${agi}`);
    }
  }
  assert.equal(defaultMoveFromAgi(undefined), 3);
  assert.equal(defaultMoveFromAgi(3), 2.25);
  assert.equal(defaultMoveFromAgi('5', '2.9'), 3.75);
  assert.equal(defaultMoveFromAgi(15, -1), 4.5);
  assert.equal(defaultMoveFromAgi(15, 8), 2.5);
});

test('同阶增敏不降速，同敏升阶米数不减，升阶兼增敏米数严格增加', () => {
  const meters = (agi, tier) => defaultMoveFromAgi(agi, tier) * TIER_CELL_M[tier];
  for (let tier = 1; tier <= 7; tier++) {
    for (let agi = 0; agi <= 20; agi++) {
      const raw = defaultMoveFromAgi(agi, tier);
      const label = `T${tier} agi=${agi}`;
      assert.ok(Number.isInteger(raw * 4), `四分之一格: ${label}`);
      assert.ok(defaultMoveFromAgi(agi + 1, tier) >= raw, `同阶: ${label}`);
      if (tier < 7) {
        assert.ok(meters(agi, tier + 1) >= meters(agi, tier), `同敏升阶: ${label}`);
        assert.ok(meters(agi + 1, tier + 1) > meters(agi, tier), `升阶增敏: ${label}`);
      }
    }
  }
});

function fractionalBattle() {
  return hydrateFromSources({
    battleInit: 'battle|1|steps|平地|flat|42\nunit|p1|blue|char_info|甲|1,2\nunit|e1|red|char_info|乙|9,9',
    charInfo: [{ name: '甲', tier: 4, stats: { agi: 15 } }, { name: '乙', tier: 4, stats: { agi: 1 } }],
  }, { throwOnValidation: true }).state;
}

test('同阶 3.75 格移动可走三格，余下 750‰ 随真实回合交接兑现', () => {
  const state = fractionalBattle();
  const actor = state.units.p1;
  assert.equal(currentUnit(state).id, actor.id);
  assert.equal(state.scale.cellM, 15);
  assert.deepEqual([actor.rawMove, actor.moveM, actor.move], [3.75, 56.25, 3]);
  assert.equal(remaining(state, actor), 3);
  assert.equal(preview(state, move(5)).ok, false);
  applyAction(state, move(4));
  assert.deepEqual([actor.x, remaining(state, actor), actor.moveCarryPermille], [4, 0, 750]);
  applyAction(state, { type: 'end' });
  assert.equal(currentUnit(state).id, 'e1');
  applyAction(state, { type: 'end' });
  assert.equal(currentUnit(state).id, actor.id);
  assert.equal(remaining(state, actor), 4);
  applyAction(state, move(8));
  assert.deepEqual([actor.x, remaining(state, actor), actor.moveCarryPermille], [8, 0, 500]);
});

test('同阶 3.75 格首回合直接疾跑七格，保留 500‰', () => {
  const state = fractionalBattle();
  const actor = state.units.p1;
  assert.equal(preview(state, { type: 'sprint', x: 9, y: 2 }).ok, false);
  applyAction(state, { type: 'sprint', x: 8, y: 2 });
  assert.deepEqual([actor.x, remaining(state, actor), actor.moveCarryPermille], [8, 0, 500]);
});

test('显式移动力覆盖敏捷曲线', () => {
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
