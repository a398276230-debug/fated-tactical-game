import { expression as fx } from '../src/core/effects.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { reachable } from '../src/core/combat.js';

const brew = (patch = {}) => ({ id: 'slow-venom', name: '迟滞毒素', icon: '☣', category: 'dot',
  description: '每层造成伤害并减慢移动。', remainingTurns: 2, durationType: 'battle_turns',
  tickTiming: 'onTurnStart', stackRule: 'stack', maxStacks: 3,
  modifiers: { damage: 1, damageType: 'true', movement: -1 }, ...patch });
const define = (patch) => ({ type: 'define_status_template', template: brew(patch) });
const upsert = (unitId, statusId, options = {}) => ({ type: 'upsert_status', unitId, statusId, options });
const effect = (overrides = {}) => fx('venom-hit', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'slow-venom', ...overrides }]);
const skill = (...effects) => ({ type: 'patch_skill_template', templateId: 'challenge', patch: { effects } });
const gear = (...effects) => ({ type: 'patch_equipment_template', templateId: 'frostplate', patch: { effects } });
const boot = (request = { scenarioId:'ruins', ruleset:'sandbox' }) => { const a = createGameAPI(); a.createBattle(typeof request === 'string' ? { scenarioId:request, ruleset:'sandbox' } : request); return a; };
const propose = (a, ...commands) => a.proposeCommands(commands,
  { baseRevision: a.getStateSummary().revision, reason: 'custom status test' });
function commit(a, ...commands) {
  const p = propose(a, ...commands);
  assert.equal(p.ok, true, p.error);
  assert.equal(a.commitProposal(p.proposalId).ok, true);
}
function turn(a, id) {
  for (let i = 0; i < 12 && a.getStateSummary().currentUnitId !== id; i++) a.playAction({ type: 'end' });
  assert.equal(a.getStateSummary().currentUnitId, id);
}

test('a skill applies composed DoT and movement modifiers with bounded stacks and expiry', () => {
  const a = boot();
  const before = a.getBattleState();
  const originalReach = reachable(before, 'move', before.units.scout).length;
  const cmd = define();
  const p = propose(a, cmd, skill(effect({ turns: 1, stacks: 2 }), { ...effect({ turns: 1 }), id: 'venom-hit-second' }));
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(a.getBattleState(), before);
  cmd.template.modifiers.damage = 50;
  assert.equal(a.commitProposal(p.proposalId).ok, true);
  assert.equal(a.getBattleState().statusTemplates['slow-venom'].modifiers.damage, 1);
  a.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 });
  const applied = a.getBattleState();
  assert.equal(applied.units.scout.statuses['slow-venom'].stacks, 3);
  assert.equal(applied.units.scout.statuses['slow-venom'].sourceUnitId, 'swordsman');
  assert.ok(reachable(applied, 'move', applied.units.scout).length < originalReach);
  turn(a, 'scout');
  assert.equal(a.inspectUnit('scout').hp, 1);
  assert.equal(a.inspectUnit('scout').statuses['slow-venom'].remainingTurns, 1);
  a.playAction({ type: 'end' });
  assert.equal(a.inspectUnit('scout').statuses['slow-venom'], undefined);
});

test('自定义状态按模板声明结算周期伤害，缺省真实伤害', () => {
  for (const type of ['physical', 'energy', 'mental', 'true', undefined]) {
    const a = boot();
    const modifiers = type == null ? { damage: 10 } : { damage: 10, damageType: type };
    commit(a, define({ name: '星屑侵蚀', modifiers }), upsert('oracle', 'slow-venom'), upsert('oracle', 'guarded'));
    const before = a.inspectUnit('oracle').hp;
    turn(a, 'oracle');
    const log = a.getBattleState().logs.find(entry => entry.type === 'damage' && entry.detail.statusId === 'slow-venom');
    assert.equal(log?.detail.damageType, type ?? 'true');
    const expected = { physical: 5, energy: 6, mental: 6, true: 10 }[type ?? 'true'];
    assert.equal(before - a.inspectUnit('oracle').hp, expected, type);
  }
});

test('existing frost_thorns equipment hook resolves a custom status on melee hit', () => {
  const a = boot();
  commit(a, define(), gear(fx('venom-reaction', 'on_damaged', 'attacker', [{ kind: 'grantStatus', statusId: 'slow-venom' }], { condition: { type: 'melee' }, roll: { chance: 1 } })),
    { type: 'set_unit_stat', unitId: 'scout', patch: { x: 2, y: 2, stats: { str: 50 } } });
  turn(a, 'scout');
  a.playAction({ type: 'attack', x: 1, y: 2 });
  const applied = a.inspectUnit('scout').statuses['slow-venom'];
  assert.equal(applied.id, 'slow-venom');
  assert.equal(applied.sourceUnitId, 'swordsman');
});

test('snapshots replay a custom definition and instances; undo restores the absent map', () => {
  const a = boot(), before = a.exportBattleSnapshot();
  assert.equal(Object.hasOwn(before.state, 'statusTemplates'), false);
  commit(a, define(), upsert('swordsman', 'slow-venom'),
    { type: 'set_unit_stat', unitId: 'swordsman', patch: { hp: 40 } });
  const snapshot = JSON.parse(JSON.stringify(a.exportBattleSnapshot()));
  const restored = boot(snapshot);
  assert.deepEqual(restored.exportBattleSnapshot(), snapshot);
  assert.equal(restored.undoLastCommit().ok, true);
  assert.deepEqual(restored.exportBattleSnapshot(), before);
  assert.deepEqual(boot(before).exportBattleSnapshot(), before);
  const tampered = structuredClone(snapshot);
  tampered.state.units.swordsman.statuses['slow-venom'].modifiers.damage = 5;
  assert.throws(() => boot(tampered));
  const detached = structuredClone(snapshot);
  delete detached.state.statusTemplates;
  assert.throws(() => boot(detached));
  commit(a, { type: 'remove_status', unitId: 'swordsman', statusId: 'slow-venom' });
  assert.equal(a.inspectUnit('swordsman').statuses['slow-venom'], undefined);
});

test('carry import validates and retains referenced custom definitions before their instances', () => {
  const a = boot();
  commit(a, define(), upsert('ranger', 'slow-venom', { durationType: 'persistent', stacks: 2 }));
  const carry = JSON.parse(JSON.stringify(a.exportPersistentCarryOver()));
  assert.deepEqual(carry.statusTemplates?.['slow-venom'], brew());
  const imported = boot({ scenarioId: 'boss', persistentSnapshot: carry });
  const applied = imported.inspectUnit('ranger').statuses['slow-venom'];
  assert.equal(applied.stacks, 2);
  assert.equal(applied.durationType, 'persistent');
  assert.equal(Object.hasOwn(applied, 'appliedRound'), false);
  assert.deepEqual(imported.getBattleState().statusTemplates['slow-venom'], brew());
  const fromCarry = imported.exportBattleSnapshot();
  assert.deepEqual(boot(fromCarry).exportBattleSnapshot(), fromCarry);
  for (const bad of [
    { ...carry, statusTemplates: {} },
    { ...carry, statusTemplates: { 'slow-venom': brew({ modifiers: { movement: -100 } }) } },
    { ...carry, statusTemplates: { 'slow-venom': brew({ id: 'other' }) } },
  ]) assert.throws(() => boot({ persistentSnapshot: bad }));
});

test('arbitrary status IDs share shield, hit expiry, and actual HP damage rules', () => {
  const a = boot();
  commit(a,
    define({ id: 'a-ward', category: 'shield', modifiers: { amount: 2 } }),
    define({ id: 'b-ward', category: 'buff', modifiers: { amount: 100 } }),
    define({ id: 'brittle', modifiers: { shatter: .5 }, expireOn: { trigger: 'on_struck' } }),
    define({ id: 'injured-only', modifiers: { armor: 1 }, expireOn: { trigger: 'on_damaged' } }),
    { type: 'set_unit_stat', unitId: 'scout', patch: { x: 2 } },
    upsert('scout', 'a-ward'), upsert('scout', 'b-ward', { amount: 1000 }),
    upsert('scout', 'brittle'), upsert('scout', 'injured-only'));
  const action = { type: 'attack', x: 2, y: 2 };
  const before = a.inspectUnit('scout');
  a.playAction(action);
  const after = a.inspectUnit('scout');
  assert.equal(after.hp, before.hp);
  assert.equal(after.statuses['a-ward'], undefined);
  assert.equal(after.statuses.brittle, undefined);
  assert.ok(after.statuses['injured-only']);
  assert.ok(after.statuses['b-ward'].amount < 1000);
  assert.equal(after.statuses['b-ward'].modifiers.amount, 100);
  const snapshot = a.exportBattleSnapshot();
  const loaded = createGameAPI();
  loaded.restoreBattleSnapshot(snapshot);
  assert.deepEqual(loaded.inspectUnit('scout').statuses, after.statuses);
});

test('DSL can grant a custom shield and expire a renamed hidden status on attack', () => {
  const a = boot();
  commit(a,
    define({ id: 'ward', modifiers: { amount: 2 } }),
    define({ id: 'veil', modifiers: { hidden: true }, expireOn: { trigger: 'on_attack' } }),
    gear(fx('ward-on-atk', 'on_attack', 'self', [{ kind: 'grantStatus', statusId: 'ward', amount: 17 }])),
    { type: 'set_unit_stat', unitId: 'scout', patch: { x: 2 } },
    upsert('swordsman', 'veil'));
  a.playAction({ type: 'attack', x: 2, y: 2 });
  assert.equal(a.inspectUnit('swordsman').statuses.veil, undefined);
  assert.equal(a.inspectUnit('swordsman').statuses.ward?.amount, 17);
});

test('custom control modifiers drive movement and taunt preview regardless of ID', () => {
  const a = boot();
  commit(a,
    define({ id: 'binding', modifiers: { rooted: true, taunted: true } }),
    { type: 'set_unit_stat', unitId: 'scout', patch: { x: 2 } },
    { type: 'set_unit_stat', unitId: 'raider', patch: { x: 1, y: 1 } },
    upsert('swordsman', 'binding', { sourceUnitId: 'raider' }));
  const state = a.getBattleState();
  assert.equal(reachable(state, 'move', state.units.swordsman).length, 0);
  assert.match(a.previewAction({ type: 'attack', x: 2, y: 2 }).error, /嘲讽/);
});

test('a battle-local default override drives both brace preview and its applied status', () => {
  const a = boot();
  const template = a.listStatusTemplates().guarded;
  assert.equal(a.defineStatus('guarded', { ...template, modifiers: { reduction: .6 } }).ok, true);
  assert.equal(a.previewAction({ type: 'brace' }).reduction, .6);
  a.playAction({ type: 'brace' });
  assert.equal(a.inspectUnit('swordsman').statuses.guarded.modifiers.reduction, .6);
  assert.equal(boot().listStatusTemplates().guarded.modifiers.reduction, .35);
});

test('only bounded modifier data and trusted effect kinds may enter the battle', () => {
  const a = boot(), start = a.exportBattleSnapshot();
  for (const cmd of [
    define({ id: 'shield' }), define({ id: '__proto__' }), define({ id: 'constructor' }),
    define({ script: 'arbitrary code' }), define({ maxStacks: 11 }), define({ remainingTurns: 0 }),
    define({ modifiers: {} }), define({ modifiers: { damageType: 'true' } }),
    define({ modifiers: { move: -1 } }), define({ modifiers: { damage: 100001 } }),
    define({ modifiers: { damage: 1, damageType: 'unrecognized' } }),
    define({ modifiers: { heal: Infinity } }), define({ modifiers: { movement: {} } }),
    define({ modifiers: { movement: () => 1 } }), define({ modifiers: JSON.parse('{"__proto__":1}') }),
    skill(effect()), gear(effect({ statusId: 'missing' })),
    upsert('scout', 'slow-venom'),
  ]) assert.equal(propose(a, cmd).ok, false, JSON.stringify(cmd));
  for (const cmd of [skill({ kind: 'eval' }), skill(effect({ amount: 1 })), skill(effect({ stacks: 4 })),
    skill(effect({ modifiers: { damage: 0 } })), gear({ ...effect(), trigger: 'unknown' }), define()]) {
    assert.equal(propose(a, define(), cmd).ok, false, JSON.stringify(cmd));
  }
  assert.deepEqual(a.exportBattleSnapshot(), start);
});

test('custom definitions are battle-local and the registry is capped at 64 entries', () => {
  const a = boot();
  const batch = (offset) => Array.from({ length: 32 }, (_, i) => define({ id: `custom-${offset + i}` }));
  commit(a, ...batch(0));
  commit(a, ...batch(32));
  assert.equal(Object.keys(a.getBattleState().statusTemplates).length, 64);
  assert.equal(propose(a, define()).ok, false);
  assert.equal(Object.hasOwn(boot().getBattleState(), 'statusTemplates'), false);
  assert.equal(a.undoLastCommit().ok, true);
  commit(a, define());
});
