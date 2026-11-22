import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { validateState } from '../src/api/validation.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { getPool } from '../src/core/vm-pools.js';
import { initializeVMWorld } from '../src/core/vm-runtime.js';

function fixture(spawnPanel = {}, tier = 1, attribute = 3, count = 1) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  Object.assign(actor.stats, { int: attribute, spi: attribute });
  actor.tier = tier;
  state.equipment.vial = { kind: 'consumable', name: '药瓶', pools: { charges: { cap: 4, initial: 3 } } };
  const program = [{ op: 'spawn', entityKind: 'unit', spec: { name: '沙偶', count, spawnPanel } }];
  actor.skills.push('call');
  state.skills.call = { name: '召唤术', target: 'self', range: 1, shape: 'single', ap: 1, slot: 'action',
    rules: [{ id: 'call-sand', hook: 'active', program }] };
  const action = { type: 'skill', skillId: 'call', x: actor.x, y: actor.y };
  function cast() {
    validateState(state);
    const logs = applyAction(state, action);
    validateState(state);
    return logs;
  }
  return { state, actor, action, cast, program };
}

for (const [tier, attribute, stat, hp] of [[1, 3, 1, 105], [4, 9, 4, 4020], [7, 20, 14, 140070]]) {
  test(`召唤术 T${tier}/A${attribute} 最终五维与资源`, () => {
    const { state, cast } = fixture({}, tier, attribute);
    cast();
    const unit = state.units['summon-1'];
    assert.deepEqual(Object.values(unit.stats), Array(5).fill(stat));
    assert.equal(unit.maxHp, hp);
    assert.equal(getPool(state, unit.id, 'hp').current, hp);
  });
}

test('召唤术拒绝超过单项上限或五维总预算的面板', () => {
  for (const stats of [{ str: 4, agi: 0, con: 1, int: 0, spi: 0 }, { str: 2, agi: 1, con: 1, int: 1, spi: 1 }]) {
    const { state, cast } = fixture({ stats });
    const before = Object.keys(state.units);
    cast();
    assert.deepEqual(Object.keys(state.units), before);
    assert.equal(state.units['summon-1'], undefined);
  }
});

test('召唤术关联属性和节点层级决定五维与资源', () => {
  const { state, actor, cast } = fixture({ tier: 2, attribute: 'agi' }, 5, 20);
  actor.stats.agi = 3;
  cast();
  const unit = state.units['summon-1'];
  assert.equal(unit.tier, 2);
  assert.deepEqual(Object.values(unit.stats), Array(5).fill(2));
  assert.equal(unit.maxHp, 410);
});

test('十个召唤物各自铸造装备、资源池及唯一落点和编号', () => {
  const { state, actor, cast } = fixture({ mainHand: 'vial', skills: ['brand'], bodyLengthM: 12 }, 1, 3, 10);
  const ids = Array.from({ length: 10 }, (_, i) => `summon-${i + 1}`);
  assert.deepEqual(cast().filter(log => log.type === 'spawn').map(log => log.detail.unitId), ids);
  const units = ids.map(id => state.units[id]);
  assert.equal(new Set(units.map(unit => `${unit.x},${unit.y}`)).size, 10);
  assert.equal(new Set(units.map(unit => unit.mainHand)).size, 10);
  assert.equal(new Set(units.map(unit => unit.pools.hp)).size, 10);
  for (const unit of units) {
    assert.equal(unit.team, actor.team);
    assert.equal(unit.ap, 0);
    assert.equal(unit.weapon, unit.mainHand);
    assert.deepEqual(unit.skills, ['brand']);
    assert.equal(unit.size, 5);
    assert.equal(unit.mc, 2);
    assert.equal(unit.maxHp, 25);
    assert.equal(getPool(state, unit.mainHand, 'charges', 'item').current, 3);
  }
});

function assertAborted(state, cast) {
  initializeVMWorld(state);
  const before = structuredClone({ units: Object.keys(state.units), items: state.items, order: state.order, pools: Object.keys(state.pools) });
  assert.ok(cast().some(log => log.type === 'spawn' && /未能登场/.test(log.text)));
  assert.deepEqual({ units: Object.keys(state.units), items: state.items, order: state.order, pools: Object.keys(state.pools) }, before);
}

test('落点不足整批拒绝，不遗留棋子、资源池或装备实例', () => {
  const { state, cast } = fixture({ mainHand: 'vial' }, 1, 3, 2);
  state.interactives = {};
  state.covers = {};
  for (const [y, row] of state.grid.entries()) for (const [x, cell] of row.entries()) {
    if (!Object.values(state.units).some(unit => unit.x === x && unit.y === y)) cell.kind = 'wall';
  }
  assertAborted(state, cast);
});

test('满实例表时整批拒绝，不遗留单位或资源池', () => {
  const { state, cast } = fixture({ mainHand: 'vial' });
  for (let n = Object.keys(state.items).length; n < 200; n++) {
    const id = `fill-${n}`;
    state.items[id] = { id, templateId: 'vial' };
  }
  assertAborted(state, cast);
});

test('原型召唤与面板召唤共享确定性编号', () => {
  const { state, actor, cast, program } = fixture();
  state.summonTemplates = { echo: { ...structuredClone(actor), id: 'echo', mainHand: null, weapon: null, gear: [] } };
  program.unshift({ op: 'spawn', entityKind: 'unit', spec: { templateId: 'echo' } });
  cast();
  assert.equal(state.units['summon-1'].name, actor.name);
  assert.equal(state.units['summon-1'].maxHp, actor.maxHp);
  assert.equal(state.units['summon-2'].name, '沙偶');
});

test('召唤事务的快照重放与撤销包含单位、装备实例和资源池', () => {
  const { state, action } = fixture({ mainHand: 'vial' }, 1, 3, 2);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  const before = api.exportBattleSnapshot();
  api.playAction(action);
  const after = api.exportBattleSnapshot();
  assert.ok(api.getBattleState().units['summon-2']);
  const imported = createGameAPI();
  imported.restoreBattleSnapshot(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(imported.exportBattleSnapshot(), after);
  const proposal = imported.proposeCommands([{ type: 'replay_or_undo', operation: 'undo' }],
    { baseRevision: imported.getStateSummary().revision, reason: '撤销召唤' });
  assert.equal(proposal.ok, true, proposal.error);
  assert.equal(imported.commitProposal(proposal.proposalId).ok, true);
  assert.deepEqual(imported.exportBattleSnapshot(), before);
  imported.playAction(action);
  assert.deepEqual(imported.exportBattleSnapshot(), after);
});
