import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { flatOnlyStats, statNames, validVmStatMod } from '../src/core/vm-schema.js';
import { evaluateExpr } from '../src/core/formula.js';
import { grantStatus } from '../src/core/combat.js';
import { updatePoolCurrent, updatePoolMax } from '../src/core/vm-pools.js';

function start(state) {
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  return api;
}

function endTo(api, id) {
  for (let i = 0; i < 30 && api.getStateSummary().currentUnitId !== id; i++) api.playAction({ type: 'end' });
  assert.equal(api.getStateSummary().currentUnitId, id);
}

test('Batch 2 stat primitives expose ordered power, hits, and attack distance offset', () => {
  assert.deepEqual(statNames.slice(-3), ['power', 'hits', 'attackDistanceOffset']);
  assert.deepEqual(flatOnlyStats.slice(-2), ['hits', 'attackDistanceOffset']);
  assert.equal(validVmStatMod({ stat: 'power', mult: 2, flat: 1, additivePercent: 0.2 }), true);
  assert.equal(validVmStatMod({ stat: 'hits', flat: 2 }), true);
  assert.equal(validVmStatMod({ stat: 'attackDistanceOffset', flat: -5 }), true);
});

test('summoned unit formula scope exposes sourceId, summonGroup, and level', () => {
  const self = { id: 's1', tier: 4, level: 9, sourceId: 'owner', summonGroup: 'pack' };
  const context = { self, source: self, target: self, attacker: self, candidate: self, units: [self] };
  assert.equal(evaluateExpr('self.sourceId', context), 'owner');
  assert.equal(evaluateExpr('self.summonGroup', context), 'pack');
  assert.equal(evaluateExpr('self.level', context), 9);
});

test('before_commit shares raw damage while preserving original result output', () => {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol', seed: 17 });
  const actor = state.units.swordsman;
  const target = state.units.scout;
  const protector = state.units.ranger;
  Object.assign(actor, { x: 1, y: 2 });
  Object.assign(target, { x: 2, y: 2 });
  Object.assign(protector, { x: 1, y: 3 });
  state.statusTemplates.shareWard = { id: 'shareWard', name: '代承护盾', category: 'shield', vars: { shieldAmount: 30 } };
  grantStatus(state, protector, 'shareWard', { turns: 10 });
  protector.skills.push('share-retaliate');
  state.skills['share-retaliate'] = { name: '反击', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', passive: true, rules: [{ id: 'retaliate', hook: 'after_damage', filter: 'target.id == self.id && event.shared && event.isArea', program: [
    { op: 'damage', target: 'attacker', amount: 7, damageType: 'true' },
  ] }] };
  const skillId = 'share-test';
  const passiveId = 'share-guard';
  actor.skills.push(skillId);
  target.skills.push(passiveId);
  state.skills[skillId] = {
    name: '分伤测试', ap: 1, slot: 'attack', range: 5, shape: 'circle', radius: 0.5, target: 'enemy',
    power: 100, damage: { count: 0, sides: 1, stat: 'str', type: 'true', bonus: 0 },
    rules: [{ id: 'record-dealt', hook: 'after_hit', filter: 'attacker.id == self.id && event.skillId == skill.id', program: [
      { op: 'resource', target: 'self', pool: 'mp', mode: 'set', amount: 'event.dealt' },
    ] }],
  };
  state.skills[passiveId] = {
    name: '代承', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', passive: true,
    rules: [{ id: 'share', hook: 'before_commit', filter: 'target.id == self.id && event.commitKind == \'damage\'', program: [
      { op: 'mutate_event', patch: { finalAmount: 'event.rawAmount - 20', shareTo: 'ranger', shareRatio: 'event.isArea ? 0.5 : 1' } },
    ] }],
  };
  const api = start(state);
  endTo(api, actor.id);
  const action = { type: 'skill', skillId, targetId: target.id, x: target.x, y: target.y };
  const raw = api.previewAction(action).targets[0].protocolInitial;
  const beforeTarget = api.getBattleState().units[target.id].hp;
  const beforeProtector = api.getBattleState().units[protector.id].hp;
  const result = api.playAction(action);
  assert.equal(result.ok, true, result.error);
  const targetDamage = beforeTarget - api.getBattleState().units[target.id].hp;
  const protectorDamage = beforeProtector - api.getBattleState().units[protector.id].hp;
  // A pre-commit flat adjustment is scaled on the original, while the derived hit starts at half the raw amount.
  assert.equal(targetDamage, Math.floor((raw - 20) * 0.5));
  assert.equal(protectorDamage, Math.floor(raw * 0.5) - 30);
  const logs = api.getBattleState().logs;
  assert.equal(logs.find(log => log.type === 'damage' && log.detail.targetId === protector.id).detail.absorbed, 30);
  assert.equal(logs.find(log => log.type === 'resource' && log.detail.targetId === actor.id && log.detail.resource === 'mp').detail.after, targetDamage);
  assert.equal(logs.find(log => log.type === 'damage' && log.detail.targetId === actor.id).detail.amount, 7);
});

test('swarm power and hits track six then four living members and resume after every hit', () => {
  for (const size of [6, 4]) {
    const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol', seed: 17 });
    const actor = state.units.swordsman;
    const target = state.units.scout;
    Object.assign(target, { x: 2, y: 2 });
    for (const unit of Object.values(state.units)) Object.assign(unit, { summoned: true, sourceId: actor.id, summonGroup: 'test-swarm' });
    updatePoolMax(state, target.pools.hp, 'set_max', 10000);
    updatePoolCurrent(state, target.pools.hp, 'set', 10000);
    if (size === 4) for (const id of ['gunner', 'raider']) updatePoolCurrent(state, state.units[id].pools.hp, 'set', 0);
    const count = 'count_units("candidate.alive && candidate.summonGroup == self.summonGroup")';
    const skillId = 'swarm';
    actor.skills.push(skillId);
    actor.mods = [{ stat: 'power', mult: count }, { stat: 'hits', flat: `${count} - 1` }];
    state.skills[skillId] = {
      name: '集群齐射', ap: 1, slot: 'attack', range: 1, shape: 'single', target: 'enemy',
      accuracy: 100, power: 'self.level', hits: '1 + 0', damage: { count: 0, sides: 1, stat: 'str', type: 'true' },
      rules: [
        { id: 'force-hit', hook: 'before_check', filter: 'event.skillId == skill.id', program: [{ op: 'mutate_event', patch: { forceOutcome: 'hit' } }] },
        { id: 'each-hit', hook: 'after_hit', filter: 'event.skillId == skill.id', program: [
          { op: 'ask', chooser: 'self', kind: 'number', min: 1, max: 2, out: 'choice', prompt: '确认本段', aiPolicy: 'min' },
        ] },
      ],
    };
    let api = start(state);
    endTo(api, actor.id);
    const action = { type: 'skill', skillId, x: target.x, y: target.y, targetId: target.id };
    const preview = api.previewAction(action);
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.targets[0].hits, size);
    assert.equal(preview.targets[0].power, (actor.level ?? actor.tier ?? 1) * size);
    assert.equal(preview.targets[0].damageMin, preview.targets[0].protocolInitial * size);
    assert.equal(api.playAction(action).ok, true);
    for (let hit = 1; hit <= size; hit++) {
      const pending = api.getBattleState();
      assert.equal(pending.logs.filter(log => log.type === 'damage' && log.detail.targetId === target.id).length, hit);
      assert.ok(pending.vm.pendingAsk);
      if (hit === 1) {
        const restored = createGameAPI();
        restored.restoreBattleSnapshot(JSON.parse(JSON.stringify(api.exportBattleSnapshot())));
        api = restored;
      }
      assert.equal(api.playAction({ type: 'answer', askId: pending.vm.pendingAsk.askId, value: 1 }).ok, true);
    }
    const final = api.getBattleState();
    assert.equal(final.vm.pendingAsk, null);
    assert.equal(final.logs.filter(log => log.type === 'roll' && log.detail?.targetId === target.id).length, 1);
    assert.equal(final.logs.filter(log => log.type === 'damage' && log.detail.targetId === target.id).length, size);
  }
});

test('attackDistanceOffset controls highlighting and point-blank attack range', () => {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol', seed: 17 });
  const actor = state.units.swordsman;
  const target = state.units.scout;
  actor.skills.push('fortress');
  state.skills.fortress = { name: '要塞', ap: 1, slot: 'attack', range: 0, shape: 'single', target: 'enemy',
    power: 10, damage: { count: 0, sides: 1, stat: 'str', type: 'true' } };
  const action = { type: 'skill', skillId: 'fortress' };
  const aimed = { ...action, x: target.x, y: target.y, targetId: target.id };
  const baseline = start(state);
  endTo(baseline, actor.id);
  assert.equal(baseline.previewAction(aimed).ok, false);
  actor.mods = [{ stat: 'attackDistanceOffset', flat: '-scale_cells(5)' }];
  const api = start(state);
  endTo(api, actor.id);
  assert.ok(api.previewAction(action).cells.some(cell => cell.x === target.x && cell.y === target.y));
  const planned = api.previewAction(aimed);
  assert.equal(planned.ok, true, planned.error);
  assert.equal(planned.targets[0].distance, 0);
  assert.equal(api.playAction(aimed).ok, true);
});

test('step and teleport can carry a locked unit without consuming movement or provoking', () => {
  for (const mode of ['step', 'teleport']) for (const ignoreLocks of [false, true]) {
    const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol', seed: 17 });
    const actor = state.units.swordsman;
    actor.mods = [{ locks: ['move', 'teleport'] }];
    actor.skills.push('tow');
    state.skills.tow = { name: '牵引', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self',
      rules: [{ id: 'tow-step', hook: 'active', program: [
        { op: 'move', target: 'self', mode, to: { x: actor.x, y: actor.y + 1 }, ignoreLocks },
      ] }] };
    const api = start(state);
    endTo(api, actor.id);
    assert.equal(api.playAction({ type: 'skill', skillId: 'tow', x: actor.x, y: actor.y }).ok, true);
    const after = api.getBattleState();
    assert.equal(after.units[actor.id].y, actor.y + Number(ignoreLocks));
    assert.equal(after.units[actor.id].moveSpentPermille ?? 0, 0);
    assert.equal(after.logs.some(log => log.type === 'opportunity'), false);
  }
});
