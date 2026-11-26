import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';

for (const turnMode of ['independent', 'linked_group', 'linked_each', 'none']) {
  test(`summon initiative and action routing for ${turnMode}`, () => {
    const state = buildScenario('ruins');
    const owner = state.units[state.order[state.turn]];
    owner.skills.push('call');
    state.skills.call = { name: '召唤', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self',
      rules: [{ id: 'call', hook: 'active', program: [{ op: 'spawn', entityKind: 'unit', spec: { turnMode, count: 2 } }] }] };
    const api = createGameAPI();
    api.createBattle({ kind: 'custom_state', state });
    assert.equal(api.playAction({ type: 'skill', skillId: 'call', x: owner.x, y: owner.y }).ok, true);
    const spawned = api.getBattleState();
    const units = Object.values(spawned.units).filter(unit => unit.summoned);
    assert.equal(units.length, 2);
    for (const unit of units) {
      assert.equal(spawned.order.includes(unit.id), turnMode === 'independent');
      assert.equal(api.previewAction({ type: 'move', actorId: unit.id }).ok, turnMode.startsWith('linked_'));
    }
    const snapshot = JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
    const restored = createGameAPI();
    restored.createBattle(snapshot);
    assert.deepEqual(restored.exportBattleSnapshot(), snapshot);
    assert.equal(api.playAction({ type: 'end' }).ok, true);
    assert.notEqual(api.getBattleState().order[api.getBattleState().turn], owner.id);
  });
}
