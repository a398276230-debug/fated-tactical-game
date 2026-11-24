import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorityContest, authorityFor, resolveAuthorityRank } from '../src/core/vm-authority.js';
import { validVmOpcode } from '../src/core/vm-schema.js';
import { startVM, stepVM } from '../src/core/tactical-vm.js';
import { vmHost, initializeVMWorld } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { getPool } from '../src/core/vm-pools.js';

test('authority keeps unique protection above tier seven and separate from range semantics', () => {
  assert.deepEqual(resolveAuthorityRank({ quality: '唯一' }, { tier: 1 }), { authorityRank: 8, unitTier: 1 });
  assert.deepEqual(resolveAuthorityRank({}, { tier: 7 }), { authorityRank: 7, unitTier: 7 });
  assert.equal(resolveAuthorityRank({ quality: '唯一' }, { tier: 1 }).authorityRank > 7, true);
  const itemState = { units: { u: { tier: 7 } }, items: { i: { id: 'i', templateId: 'blade', quality: '普通' } }, equipment: { blade: { quality: '传说' } } };
  assert.deepEqual(authorityFor(itemState, { type: 'item', id: 'i' }, 'u'), { authorityRank: 5, unitTier: 7 });
});

test('authority contest is deterministic when supplied the actual dice source', () => {
  const state = { units: {
    a: { id: 'a', stats: { int: 10 } }, d: { id: 'd', stats: { con: 10 } },
  }, rng: { seed: 1 } };
  const rolls = [9, 8];
  const result = authorityContest(state,
    { authorityRank: 6, unitTier: 4, unitId: 'a' },
    { authorityRank: 6, unitTier: 4, unitId: 'd' },
    { attackStat: 'int', defenseStat: 'con', roll: () => rolls.shift() });
  assert.equal(result.result, 1);
  assert.deepEqual({ attackRank: result.attackRank, defenderRank: result.defenderRank, attack: result.attack },
    { attackRank: 6, defenderRank: 6, attack: { roll: 9, bonus: 10, total: 19 } });
  assert.deepEqual(result.defense, { roll: 8, bonus: 10, total: 18 });
  const before = JSON.stringify(state.rng);
  assert.deepEqual(authorityContest(state,
    { authorityRank: 6, unitTier: 4, unitId: 'a' }, { authorityRank: 6, unitTier: 4, unitId: 'd' }, { dryRun: true }),
    { result: 0, contested: true, conditional: true });
  assert.equal(JSON.stringify(state.rng), before);
});

test('actual VM rules keep ordinary immunity active unless ignoreImmunity is explicit', () => {
  const state = { units: {
    caster: { id: 'caster', name: '施法者', hp: 10, statuses: {}, skills: [], stats: {}, tier: 1 },
    target: { id: 'target', name: '目标', hp: 10, statuses: {}, skills: ['ward'], stats: {}, tier: 1 },
  }, skills: { ward: { rules: [{ id: 'ward', hook: 'before_status', program: [{ op: 'mutate_event', patch: { cancel: true } }] }] } },
    statusTemplates: { mark: { id: 'mark', name: '标记', category: 'debuff', remainingTurns: 1 } },
    items: {}, equipment: {}, zones: {}, pools: {}, logs: [], order: ['caster', 'target'], round: 1, turn: 1,
  };
  const frame = startVM(state, { ownerId: 'caster', sourceId: 'caster', scope: { target: { type: 'unit', id: 'target' } },
    program: [{ op: 'apply_status', target: 'target', statusId: 'mark' }] });
  stepVM(state, vmHost); stepVM(state, vmHost); stepVM(state, vmHost);
  assert.equal(state.units.target.statuses.mark, undefined);
  assert.equal(frame.vars?.mark, undefined);
});

test('protection activators are explicit and ordinary lethal remains ordinary damage', () => {
  assert.equal(validVmOpcode({ op: 'apply_status', target: 'self', statusId: 'x', ignoreImmunity: true }), false);
  assert.equal(validVmOpcode({ op: 'remove_status', target: 'self', where: 'true', force: true }), true);
  assert.equal(validVmOpcode({ op: 'damage', target: 'self', amount: 1, damageType: 'true' }), true);
  assert.equal(validVmOpcode({ op: 'damage', target: 'self', amount: 1, damageType: 'true', instantDeath: true }), true);
});

function run(state, spec) {
  startVM(state, spec);
  for (let i = 0; i < 100 && (state.vm.stack.length || state.vm.pendingAsk); i++) stepVM(state, vmHost);
  assert.equal(state.vm.stack.length, 0);
}

test('actual VM resource action changes max and preserves the authoritative result', () => {
  const state = buildScenario('ruins');
  initializeVMWorld(state);
  const target = state.units.scout;
  const hp = getPool(state, target.id, 'hp');
  const before = hp.max;
  run(state, { ownerId: state.order[0], sourceId: state.order[0], scope: { target: { type: 'unit', id: target.id } },
    program: [{ op: 'resource', target: 'target', pool: 'hp', mode: 'sub_max', amount: 7 }] });
  assert.equal(getPool(state, target.id, 'hp').max, before - 7);
  assert.equal(target.maxHp, before - 7);
});

test('actual VM force removal uses the source carrier rank and records an exact contest', () => {
  const state = buildScenario('ruins');
  initializeVMWorld(state);
  const source = state.units[state.order[0]], target = state.units.scout;
  target.statuses ??= {};
  state.statusTemplates ??= {};
  state.statusTemplates.ward = { id: 'ward', name: '守护', category: 'special', flags: ['undispellable'], durationType: 'until_removed' };
  target.statuses.ward = { ...state.statusTemplates.ward, id: 'ward', templateId: 'ward', ownerId: target.id,
    sourceId: target.id, sourceCarrier: { type: 'skill', id: 'ward-source', ownerId: target.id }, stacks: 1, maxStacks: 1, remainingTurns: 1 };
  state.skills['ward-source'] = { id: 'ward-source', quality: '普通', rules: [] };
  state.skills.purge = { id: 'purge', quality: '唯一', rules: [] };
  const program = [{ op: 'remove_status', target: 'target', where: "status.id == 'ward'", force: true, outCount: 'removed' }];
  run(state, { ownerId: source.id, sourceId: source.id, carrier: { type: 'skill', id: 'purge', ownerId: source.id },
    scope: { target: { type: 'unit', id: target.id } }, program });
  assert.equal(target.statuses.ward, undefined);
  const cleanse = state.logs.findLast(log => log.type === 'cleanse' && log.detail?.contest);
  assert.ok(cleanse);
  assert.deepEqual({ attacker: cleanse.detail.contest.attackRank ?? cleanse.detail.contest.authorityRank,
    defender: cleanse.detail.contest.defenderRank ?? cleanse.detail.contest.defender?.authorityRank,
    result: cleanse.detail.contest.result }, { attacker: 8, defender: 1, result: 1 });
});

test('persistent status resists routine dispel and yields to stronger authority or its owner', () => {
  const state = buildScenario('ruins');
  initializeVMWorld(state);
  const [caster, target] = state.order.map(id => state.units[id]);
  const ward = { id: 'ward', templateId: 'ward', ownerId: target.id, sourceId: target.id,
    name: '常驻守护', stacks: 1, durationType: 'persistent', authorityRank: 4, sourceTier: 4 };
  target.statuses.ward = ward;
  const purge = (owner, quality, force) => {
    state.skills.purge = { quality };
    run(state, { ownerId: owner.id, sourceId: owner.id, carrier: { type: 'skill', id: 'purge', ownerId: owner.id },
      scope: { target: { type: 'unit', id: target.id } },
      program: [{ op: 'remove_status', target: 'target', where: "status.id == 'ward'", force }] });
  };
  purge(caster, '唯一', false);
  assert.equal(target.statuses.ward, ward);
  purge(caster, '普通', true);
  assert.equal(target.statuses.ward, ward);
  purge(caster, '唯一', true);
  assert.equal(target.statuses.ward, undefined);
  target.statuses.ward = ward;
  purge(target, '普通', true);
  assert.equal(target.statuses.ward, undefined);
});
