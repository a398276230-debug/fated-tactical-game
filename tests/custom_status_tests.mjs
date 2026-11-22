import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { reachable } from '../src/core/combat.js';

const venom = (patch = {}) => ({ id: 'slow-venom', name: '迟滞毒素', category: 'dot', remainingTurns: 2,
  durationType: 'battle_turns', stackMode: 'stack', maxStacks: 3, vars: { damage: 1 },
  mods: [{ locks: ['move'] }], rules: [{ id: 'venom-tick', hook: 'turn_start', program: [
    { op: 'damage', target: 'self', amount: 'status.stacks * status.vars.damage', damageType: 'true', direct: false },
  ] }], ...patch });
const define = patch => ({ type: 'define_status_template', template: venom(patch) });
const upsert = (unitId, options = {}) => ({ type: 'upsert_status', unitId, statusId: 'slow-venom', options });
const applyVenom = (patch = {}) => ({ op: 'apply_status', target: 'target', statusId: 'slow-venom', ...patch });
const skill = (...rules) => ({ type: 'patch_skill_template', templateId: 'challenge', patch: { rules } });
function boot(request = { scenarioId: 'ruins', ruleset: 'sandbox' }) {
  const api = createGameAPI();
  api.createBattle(request);
  return api;
}
const propose = (api, ...commands) => api.proposeCommands(commands, { baseRevision: api.getStateSummary().revision, reason: 'custom status test' });
function commit(api, ...commands) {
  const proposal = propose(api, ...commands);
  assert.equal(proposal.ok, true, proposal.error);
  const result = api.commitProposal(proposal.proposalId);
  assert.equal(result.ok, true, result.error);
}
function turn(api, id) {
  for (let i = 0; i < 12 && api.getStateSummary().currentUnitId !== id; i++) api.playAction({ type: 'end' });
  assert.equal(api.getStateSummary().currentUnitId, id);
}

test('a skill stacks a registered status, locks movement, and ticks on its owner turn', () => {
  const api = boot();
  const before = api.getBattleState();
  const command = define();
  const proposal = propose(api, command, skill({ id: 'venom-hit', hook: 'active', program: [
    applyVenom({ stacks: 2 }), applyVenom({ stacks: 2 }),
  ] }));
  assert.equal(proposal.ok, true, proposal.error);
  assert.deepEqual(api.getBattleState(), before);
  command.template.vars.damage = 50;
  assert.equal(api.commitProposal(proposal.proposalId).ok, true);
  assert.equal(api.getBattleState().statusTemplates['slow-venom'].vars.damage, 1);
  api.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 });
  const applied = api.getBattleState();
  const scout = applied.units.scout;
  assert.equal(scout.statuses['slow-venom'].stacks, 3);
  assert.equal(scout.statuses['slow-venom'].sourceId, 'swordsman');
  assert.equal(reachable(applied, 'move', scout).length, 0);
  turn(api, 'scout');
  assert.equal(api.inspectUnit('scout').hp, scout.hp - 3);
  api.playAction({ type: 'end' });
  assert.equal(api.inspectUnit('scout').statuses['slow-venom'].remainingTurns, 1);
});

test('VM status caps resolve from the applying unit and persist as concrete replayable integers', () => {
  const api = boot();
  const before = api.getBattleState();
  const cap = before.units.swordsman.maxHp;
  assert.ok(cap > 10);
  assert.notEqual(cap, before.units.scout.maxHp);
  commit(api, define({ maxStacks: 'self.maxHp' }), skill({ id: 'dynamic-cap', hook: 'active', program: [
    applyVenom({ stacks: 'self.maxHp - 1' }), applyVenom({ stacks: 2 }),
  ] }));
  assert.equal(api.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 }).ok, true);
  const status = api.inspectUnit('scout').statuses['slow-venom'];
  assert.equal(status.maxStacks, cap);
  assert.equal(status.stacks, cap);
  const snapshot = JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
  assert.equal(snapshot.state.statusTemplates['slow-venom'].maxStacks, 'self.maxHp');
  assert.deepEqual(boot(snapshot).exportBattleSnapshot(), snapshot);
  commit(api, { type: 'patch_status', unitId: 'scout', statusId: 'slow-venom', patch: { stacks: cap - 1 } });
  assert.equal(propose(api, { type: 'patch_status', unitId: 'scout', statusId: 'slow-venom', patch: { stacks: cap + 1 } }).ok, false);
  for (const maxStacks of ['self.maxHp', Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(snapshot);
    invalid.state.units.scout.statuses['slow-venom'].maxStacks = maxStacks;
    assert.throws(() => boot(invalid));
  }
});

test('VM status stacks saturate at the supported ceiling for large numeric and expression caps', () => {
  for (const maxStacks of [999999, 'self.maxHp * 1e20']) {
    const api = boot();
    commit(api, define({ maxStacks }), skill({ id: 'high-cap', hook: 'active', program: [
      applyVenom({ stacks: 900000 }), applyVenom({ stacks: 1e20 }),
    ] }));
    assert.equal(api.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 }).ok, true);
    const status = api.inspectUnit('scout').statuses['slow-venom'];
    assert.equal(status.maxStacks, 999999);
    assert.equal(status.stacks, 999999);
  }
});

test('an expression that cannot resolve to a numeric cap leaves the current status intact', () => {
  const api = boot();
  commit(api, define({ maxStacks: 'vars.cap' }), skill({ id: 'conditional-cap', hook: 'active', program: [
    { op: 'let', name: 'cap', value: 2500.75 }, applyVenom({ stacks: 2000 }),
    { op: 'let', name: 'cap', value: true }, applyVenom({ stacks: 9999 }),
  ] }));
  assert.equal(api.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 }).ok, true);
  const status = api.inspectUnit('scout').statuses['slow-venom'];
  assert.equal(status.maxStacks, 2500);
  assert.equal(status.stacks, 2000);
});

test('a patched equipment reaction applies its registered status to the melee attacker', () => {
  const api = boot();
  commit(api, define(), { type: 'patch_equipment_template', templateId: 'frostplate', patch: { rules: [
    { id: 'venom-reaction', hook: 'after_damage', filter: 'event.melee == true && event.direct == true',
      program: [applyVenom({ target: 'attacker' })] },
  ] } }, { type: 'set_unit_stat', unitId: 'scout', patch: { x: 2, y: 2, stats: { str: 50 } } });
  turn(api, 'scout');
  api.playAction({ type: 'attack', x: 1, y: 2 });
  assert.equal(api.inspectUnit('scout').statuses['slow-venom']?.sourceId, 'swordsman');
});

test('custom VM shields absorb damage by capacity and disappear when exhausted', () => {
  const api = boot();
  const shield = id => ({ type: 'define_status_template', template: { id, name: id, category: 'shield',
    durationType: 'until_removed', vars: { shieldAmount: 2 } } });
  commit(api, shield('a-ward'), shield('b-ward'),
    { type: 'upsert_status', unitId: 'scout', statusId: 'a-ward' },
    { type: 'upsert_status', unitId: 'scout', statusId: 'b-ward', options: { vars: { shieldAmount: 5 } } },
    skill({ id: 'strike', hook: 'active', program: [{ op: 'damage', target: 'target', amount: 4, damageType: 'true' }] }));
  const hp = api.inspectUnit('scout').hp;
  api.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 });
  const scout = api.inspectUnit('scout');
  assert.equal(scout.hp, hp);
  assert.equal(scout.statuses['a-ward'], undefined);
  assert.equal(scout.statuses['b-ward'].vars.shieldAmount, 3);
  assert.deepEqual(boot(api.exportBattleSnapshot()).inspectUnit('scout').statuses, scout.statuses);
});

test('snapshot replay validates and restores VM status definitions, instances and undo', () => {
  const api = boot(), before = api.exportBattleSnapshot();
  const snapshot = () => JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
  assert.equal(Object.hasOwn(before.state, 'statusTemplates'), false);
  commit(api, define(), upsert('swordsman', { sourceId: 'scout', vars: { damage: 2 } }));
  const saved = snapshot(), restored = boot(saved);
  assert.deepEqual(restored.exportBattleSnapshot(), saved);
  assert.equal(restored.undoLastCommit().ok, true);
  assert.deepEqual(restored.exportBattleSnapshot(), before);
  const invalid = structuredClone(saved);
  invalid.state.units.swordsman.statuses['slow-venom'].mods = [{ stat: 'evil', flat: 1 }];
  assert.throws(() => boot(invalid));
  const detached = structuredClone(saved);
  delete detached.state.statusTemplates;
  assert.throws(() => boot(detached));
  commit(api, { type: 'remove_status', unitId: 'swordsman', statusId: 'slow-venom' });
  assert.equal(api.inspectUnit('swordsman').statuses['slow-venom'], undefined);
});

test('carryover retains persistent VM status instances and referenced templates', () => {
  const api = boot();
  commit(api, define(), upsert('ranger', { durationType: 'persistent', stacks: 2 }));
  const carry = JSON.parse(JSON.stringify(api.exportPersistentCarryOver()));
  assert.deepEqual(carry.statusTemplates['slow-venom'], venom());
  const imported = boot({ scenarioId: 'boss', persistentSnapshot: carry });
  const status = imported.inspectUnit('ranger').statuses['slow-venom'];
  assert.equal(status.stacks, 2);
  assert.equal(status.durationType, 'persistent');
  assert.deepEqual(imported.getBattleState().statusTemplates['slow-venom'], venom());
  assert.deepEqual(boot(imported.exportBattleSnapshot()).exportBattleSnapshot(), imported.exportBattleSnapshot());
  for (const statusTemplates of [{}, { 'slow-venom': venom({ id: 'other' }) }]) {
    assert.throws(() => boot({ scenarioId: 'boss', persistentSnapshot: { ...carry, statusTemplates } }));
  }
});

test('status templates and rules reject malformed data and unknown references atomically', () => {
  const api = boot(), start = api.exportBattleSnapshot();
  for (const command of [
    define({ id: 'shield' }), define({ id: '__proto__' }), define({ id: 'constructor' }),
    define({ script: 'arbitrary code' }), define({ maxStacks: 1000000 }), define({ maxStacks: 1.5 }),
    define({ maxStacks: 'self.unknown' }), define({ remainingTurns: 0 }),
    define({ mods: [{ stat: 'move', flat: -1 }] }), define({ mods: [{ stat: 'str', flat: Infinity }] }),
    define({ mods: [{ stat: 'str', flat: 'state.units.scout.hp' }] }), upsert('scout'),
    skill({ id: 'missing-status', hook: 'active', program: [applyVenom()] }),
  ]) assert.equal(propose(api, command).ok, false, JSON.stringify(command));
  for (const op of [{ op: 'eval' }, applyVenom({ amount: 1 }), applyVenom({ modifiers: { damage: 0 } })]) {
    assert.equal(propose(api, define(), skill({ id: 'invalid', hook: 'active', program: [op] })).ok, false);
  }
  assert.equal(propose(api, define(), define()).ok, false);
  assert.deepEqual(api.exportBattleSnapshot(), start);
});

test('custom definitions are battle-local and the registry is capped at 64 entries', () => {
  const api = boot();
  const batch = offset => Array.from({ length: 32 }, (_, i) => define({ id: `custom-${offset + i}`, rules: [] }));
  commit(api, ...batch(0));
  commit(api, ...batch(32));
  assert.equal(Object.keys(api.getBattleState().statusTemplates).length, 64);
  assert.equal(propose(api, define()).ok, false);
  assert.equal(Object.hasOwn(boot().getBattleState(), 'statusTemplates'), false);
  assert.equal(api.undoLastCommit().ok, true);
  commit(api, define());
});
