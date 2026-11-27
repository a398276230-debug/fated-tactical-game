import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { preview } from '../src/core/combat.js';
import { mediumZone } from '../src/core/element-media.js';
import { rollDie } from '../src/core/rng.js';
import { buildScenario } from '../src/presets/scenarios.js';

const point = (x, y = 2) => ({ x, y });
const cast = (x, skillId = 'element') => ({ type: 'skill', skillId, ...point(x) });
const step = (x, y = 2) => ({ type: 'move', ...point(x, y) });
const standingAt = (state, id) => point(state.units[id].x, state.units[id].y);

function fixture(damageType = 'fire', skill = {}) {
  const state = buildScenario({ scenarioId: 'ruins', seed: 17, ruleset: 'sandbox' });
  const actor = state.units.swordsman;
  state.order = [actor.id, ...state.order.filter(id => id !== actor.id)];
  state.turn = 0;
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.interactives = {};
  Object.assign(actor, { ...point(1), ap: 2, used: { attack: 0, action: 0 }, skills: ['element'], moveM: 8 });
  Object.assign(state.units.scout, point(6));
  state.skills.element = { name: '测试冲量', ap: 0, slot: 'action', range: 4, shape: 'single', target: 'cell', damageType, ...skill };
  return state;
}

function zone(state, medium, cells) {
  const id = `fixture-${medium}`;
  state.zones[id] = { ...mediumZone(medium), id, tier: 1, follow: false, persistent: false,
    area: { shape: 'cells', cells }, sourceId: 'swordsman', team: 'blue' };
}

function boot(state) {
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  return api;
}

const media = (state, medium) => Object.values(state.zones).filter(zone => zone.medium === medium);

test('fire previews ice melt and water evaporation without touching state or RNG', () => {
  for (const [before, after] of [['ice', 'water'], ['water', 'steam']]) {
    const state = fixture();
    zone(state, before, [point(3)]);
    const api = boot(state);
    const snapshot = api.exportBattleSnapshot();
    const action = cast(3);
    const plan = api.previewAction(action);
    assert.ok(plan.surfaceImpact?.reactions.length);
    assert.deepEqual(api.exportBattleSnapshot(), snapshot);
    api.playAction(action);
    assert.equal(media(api.getBattleState(), before).length, 0);
    assert.equal(media(api.getBattleState(), after).length, 1);
  }
});

test('lightning hitting empty water reaches a connected enemy past the aim point', () => {
  const state = fixture('lightning');
  zone(state, 'water', [point(3), point(4), point(5), point(6)]);
  const api = boot(state);
  const before = api.getBattleState();
  const plan = api.previewAction(cast(3));
  assert.deepEqual(plan.targets, []);
  assert.ok(plan.surfaceImpact?.secondaryTargets.some(target => target.id === 'scout' && target.expectedDamage > 0));
  api.playAction(cast(3));
  const after = api.getBattleState();
  assert.ok(after.units.scout.hp < before.units.scout.hp);
  assert.equal(media(after, 'electrified_water').length, 1);
});

test('landed lightning hits a target in water only once', () => {
  const state = fixture('lightning', { shape: 'circle', radius: 1, target: 'enemy', damage: { type: 'lightning', count: 1, sides: 6 } });
  Object.assign(state.units.scout, point(3));
  zone(state, 'water', [point(3), point(4), point(5)]);
  const api = boot(state);
  const action = cast(3);
  assert.ok(api.previewAction(action).targets.some(target => target.id === 'scout'));
  api.playAction(action);
  const after = api.getBattleState();
  assert.equal(media(after, 'electrified_water').length, 1);
  assert.equal(after.logs.filter(log => log.type === 'damage' && log.detail.targetId === 'scout').length, 1);
});

test('standalone direct DSL fire melts the target cell and indirect fire leaves it alone', () => {
  for (const direct of [true, false]) {
    const state = fixture('energy', { rules: [{ id: 'dsl-hit', hook: 'active', program: [{
      op: 'damage', target: { from: 'units', where: "candidate.id == 'scout'" }, damageType: 'fire', amount: 5, direct,
    }] }] });
    zone(state, 'ice', [point(6)]);
    const api = boot(state);
    api.playAction(cast(3));
    const after = api.getBattleState();
    assert.equal(media(after, 'ice').length, direct ? 0 : 1);
    assert.equal(media(after, 'water').length, direct ? 1 : 0);
  }
});

test('direct barrel preview is equal via attack and interact with a live chain', () => {
  const state = fixture();
  state.interactives = Object.fromEntries([[2, 'first'], [3, 'second']].map(([x, id]) => [id, {
    id, kind: 'barrel', name: id, ...point(x), spent: false, damage: 12, radius: 1,
  }]));
  zone(state, 'oil', [point(4)]);
  const api = boot(state);
  const { actionContext: attackContext, ...attack } = api.previewAction({ type: 'attack', ...point(2) });
  const { actionContext: interactContext, ...interact } = api.previewAction({ type: 'interact', ...point(2) });
  assert.equal(attackContext.actionType, 'attack');
  assert.equal(interactContext.actionType, 'interact');
  assert.deepEqual(attack, interact);
  assert.equal(attack.surfaceImpact.reactions.filter(reaction => reaction.kind === 'barrel').length, 1);
  api.playAction({ type: 'interact', ...point(2) });
  const after = api.getBattleState();
  for (const id of ['first', 'second']) {
    assert.equal(after.interactives[id].spent, true);
    assert.equal(after.logs.filter(log => log.type === 'interact' && log.detail.interactiveId === id).length, 1);
  }
  assert.equal(media(after, 'fire').length, 1);
});

test('corrosion damages cover through the deferred impulse host', () => {
  const state = fixture('acid');
  state.covers.wood = { id: 'wood', name: '木栅', material: '木', ...point(3), maxHp: 40, hp: 40, cover: 2 };
  const api = boot(state);
  api.playAction(cast(3));
  const after = api.getBattleState();
  assert.equal(after.covers.wood.hp, 26);
  assert.deepEqual(after.logs.filter(log => log.type === 'cover_damage').map(log => log.detail.coverId), ['wood']);
});

test('true sight sees through steam and still respects walls', () => {
  const state = fixture();
  zone(state, 'steam', [point(2)]);
  assert.equal(preview(state, cast(3)).ok, false);
  state.units.swordsman.mods = [{ flags: ['trueSight'] }];
  assert.equal(preview(state, cast(3)).ok, true);
  state.grid[2][2].kind = 'wall';
  assert.equal(preview(state, cast(3)).ok, false);
});

test('ice costs two movement units and a failed balance roll stops before entry', () => {
  const state = fixture();
  zone(state, 'ice', [point(2)]);
  const actor = state.units.swordsman;
  actor.stats.agi = 0;
  const seed = Array.from({ length: 100 }, (_, i) => i + 1).find(i => rollDie(i, 20).value < 12);
  state.rng = seed;
  const api = boot(state);
  const plan = api.previewAction(step(2));
  assert.equal(plan.steps, 1);
  assert.equal(plan.costPermille, 2000);
  api.playAction(step(2));
  const after = api.getBattleState();
  assert.deepEqual(standingAt(after, actor.id), point(1));
  assert.ok(after.units[actor.id].statuses.prone);
  assert.equal(after.rng, rollDie(seed, 20).rng);
});

test('water movement applies wet, and grounded travel pays weighted costs', () => {
  const state = fixture();
  zone(state, 'oil', [point(2)]);
  zone(state, 'water', [point(3)]);
  const api = boot(state);
  api.playAction(step(2));
  assert.equal(api.getBattleState().units.swordsman.moveSpentPermille, 2000);
  assert.ok(api.getBattleState().units.swordsman.statuses.oiled);
  api.playAction(step(3));
  assert.equal(api.getBattleState().units.swordsman.moveSpentPermille, 3000);
  assert.ok(api.getBattleState().units.swordsman.statuses.wet);
  assert.equal(api.getBattleState().units.swordsman.statuses.oiled, undefined);
});

test('a pending secondary damage choice round-trips through a v11 snapshot', () => {
  const state = fixture('lightning');
  zone(state, 'water', [point(3), point(4), point(5), point(6)]);
  const actor = state.units.swordsman;
  actor.skills.push('impulse-choice');
  state.skills['impulse-choice'] = { name: '导电选择', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [{
    id: 'arc-choice', hook: 'before_commit', filter: "event.damageType == 'lightning' && !event.direct",
    program: [{ op: 'ask', chooser: 'self', kind: 'number', min: 1, max: 2, out: 'chosen', prompt: '选择', aiPolicy: 'max' }],
  }] };
  const api = boot(state);
  api.playAction(cast(3));
  const snapshot = JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
  assert.equal(snapshot.version, 11);
  const ask = api.getBattleState().vm.pendingAsk;
  assert.ok(ask);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(snapshot);
  const answer = { type: 'answer', askId: ask.askId, value: 2 };
  api.playAction(answer);
  restored.playAction(answer);
  assert.deepEqual(restored.exportBattleSnapshot(), api.exportBattleSnapshot());
  assert.equal(restored.getBattleState().vm.pendingAsk, null);
  assert.equal(restored.getBattleState().logs.filter(log => log.type === 'damage' && log.detail.targetId === 'scout').length, 1);
});
