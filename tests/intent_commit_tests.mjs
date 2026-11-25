import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { commitVMEffect, dispatchVMHook } from '../src/core/vm-runtime.js';
import { getPool, updatePoolCurrent, updatePoolMax } from '../src/core/vm-pools.js';

function fixture() {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'sandbox' });
  const attacker = state.units.swordsman;
  const target = state.units.scout;
  const ally = state.units.ranger;
  state.units = { [attacker.id]: attacker, [target.id]: target, [ally.id]: ally };
  ally.team = target.team;
  updatePoolMax(state, getPool(state, target.id, 'hp').id, 'set_max', 1000);
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', 800);
  state.order = [attacker.id, target.id, ally.id];
  state.turn = 0;
  state.logs = [];
  state.covers = {};
  state.zones = {};
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  for (const unit of Object.values(state.units)) {
    unit.statuses = {};
    unit.rules = [];
    unit.mods = [];
    unit.mp = 0;
    unit.sp = 0;
    for (const key of ['mp', 'sp']) updatePoolCurrent(state, getPool(state, unit.id, key).id, 'set', 0);
  }
  return { state, attacker, target, ally };
}

const setEventIntent = (name, hook, filter = "event.intent == 'core'") => ({
  id: `${name}-${hook}`, hook, filter,
  program: [{ op: 'let', scope: 'owner', name, value: 'event.intent' }],
});

test('a hit after a failed core contest commits normal damage, not core bonuses', () => {
  function strike(withBonus) {
    const state = buildScenario('ruins');
    const actor = state.units.swordsman, target = state.units.scout;
    target.x = actor.x + 1; target.y = actor.y;
    actor.mods = [{ stat: 'intentBonus', flat: -100 }];
    if (withBonus) state.equipment[state.items[actor.mainHand].templateId].mods = [
      { stat: 'finalDamageMult', additivePercent: 0.5, when: "event.intent == 'core'" },
    ];
    actor.rules = [{ id: 'hit', hook: 'before_check', program: [{ op: 'mutate_event', patch: { forceOutcome: 'crit' } }] }];
    target.rules = [setEventIntent('actual', 'after_damage', "event.intent == 'normal'"), setEventIntent('leak', 'after_damage')];
    applyAction(state, { type: 'attack', intent: 'core', targetId: target.id, x: target.x, y: target.y });
    assert.equal(target.vars?.actual, 'normal');
    assert.equal(target.vars?.leak, undefined);
    return target.hp;
  }
  assert.equal(strike(true), strike(false));
});

test('commit damage carries effective intent through prepareDamage and after_damage', () => {
  const { state, attacker, target } = fixture();
  attacker.mods = [{ stat: 'damageFlat', flat: 5, when: "event.intent == 'core'" }];
  target.mods = [{ stat: 'incomingDamageMult', mult: 0.5, when: "event.intent == 'core'" }];
  target.rules = [setEventIntent('damageIntent', 'after_damage')];
  const before = target.hp;

  commitVMEffect(state, { op: 'damage', amount: 10, damageType: 'true', sourceId: attacker.id,
    targetId: target.id, intent: 'core' });

  assert.equal(target.hp, before - 7, '攻方 +5 与受击方 0.5 倍均读取 effective intent');
  assert.equal(target.vars.damageIntent, 'core');
});

test('after_damage retaliation keeps the defender as subject and does not inherit attack intent', () => {
  const { state, attacker, target } = fixture();
  target.mods = [{ stat: 'damageFlat', flat: 100, when: "event.intent == 'core'" }];
  target.rules = [
    { id: 'retaliate', hook: 'after_damage', filter: `event.actorId == '${attacker.id}' && event.intent == 'core'`,
      program: [{ op: 'damage', target: 'attacker', amount: 2, damageType: 'true' }] },
    { id: 'observe-retaliation-commit', hook: 'before_commit',
      filter: `event.commitKind == 'damage' && event.targetId == '${attacker.id}' && event.intent == null`,
      program: [{ op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 1 }] },
  ];
  const before = attacker.hp;

  commitVMEffect(state, { op: 'damage', amount: 10, damageType: 'true', sourceId: attacker.id,
    targetId: target.id, intent: 'core' });

  assert.equal(attacker.hp, before - 2, '受击方自身的意图加成不能读取攻击方 intent');
  const retaliation = state.logs.find(log => log.type === 'damage' && log.detail.targetId === attacker.id);
  assert.equal(retaliation?.detail.amount, 2);
  assert.equal(target.mp, 1, '反伤 before_commit 观察到 event.intent == null');
});

test('heal carries intent through prepareHeal and after_heal', () => {
  const { state, attacker, target } = fixture();
  target.hp = 10;
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', target.hp);
  attacker.mods = [{ stat: 'healingMult', mult: 2, when: "event.intent == 'core'" }];
  target.rules = [setEventIntent('healIntent', 'after_heal')];

  commitVMEffect(state, { op: 'heal', amount: 3, sourceId: attacker.id, targetId: target.id, intent: 'core' });

  assert.equal(target.hp, 16, 'prepareHeal 使用带 intent 的修饰事件');
  assert.equal(target.vars.healIntent, 'core');
});

test('same-subject follow-up damage and resource commits retain intent', () => {
  const { state, attacker, target } = fixture();
  target.hp = 500;
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', target.hp);
  attacker.mods = [{ stat: 'damageFlat', flat: 100, when: "event.intent == 'core'" }];
  attacker.rules = [
    { id: 'follow-up', hook: 'after_damage', usesPerBattle: 1,
      filter: `event.actorId == '${attacker.id}' && event.intent == 'core'`,
      program: [
        { op: 'damage', target: 'target', amount: 2, damageType: 'true' },
        { op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 1 },
      ] },
    { id: 'observe-follow-up-damage', hook: 'before_commit',
      filter: `event.commitKind == 'damage' && event.intent == 'core'`,
      program: [{ op: 'let', scope: 'owner', name: 'followUpDamageIntent', value: 'event.intent' }] },
    { id: 'observe-follow-up-resource', hook: 'before_commit',
      filter: `event.commitKind == 'resource' && event.intent == 'core'`,
      program: [{ op: 'let', scope: 'owner', name: 'followUpResourceIntent', value: 'event.intent' }] },
  ];

  dispatchVMHook(state, 'after_damage', { actorId: attacker.id, targetId: target.id, intent: 'core' });

  assert.equal(target.hp, 398, '同主语追伤使用了带 core 的 damageFlat');
  assert.equal(attacker.mp, 1);
  assert.equal(attacker.vars.followUpDamageIntent, 'core');
  assert.equal(attacker.vars.followUpResourceIntent, 'core');
});

test('commits without an intent keep the event intent key absent to the DSL', () => {
  const { state, attacker, target } = fixture();
  target.rules = [{ id: 'observe-missing-intent', hook: 'before_commit',
    filter: `event.commitKind == 'damage' && event.targetId == '${target.id}' && event.intent == null`,
    program: [{ op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 1 }] }];

  commitVMEffect(state, { op: 'damage', amount: 1, damageType: 'true', sourceId: attacker.id, targetId: target.id });

  assert.equal(target.mp, 1);
});

test('lethal hooks all receive the same effective intent', () => {
  const { state, attacker, target, ally } = fixture();
  target.hp = 5;
  updatePoolCurrent(state, getPool(state, target.id, 'hp').id, 'set', target.hp);
  target.rules = [
    setEventIntent('p1Intent', 'on_lethal_p1'),
    setEventIntent('p2Intent', 'on_lethal_p2'),
    setEventIntent('deathIntent', 'on_death'),
  ];
  ally.rules = [setEventIntent('allyDeathIntent', 'on_ally_death')];
  attacker.rules = [setEventIntent('killIntent', 'on_kill')];

  commitVMEffect(state, { op: 'damage', amount: 10, damageType: 'true', sourceId: attacker.id,
    targetId: target.id, intent: 'core' });

  assert.equal(target.vars.p1Intent, 'core');
  assert.equal(target.vars.p2Intent, 'core');
  assert.equal(target.vars.deathIntent, 'core');
  assert.equal(ally.vars.allyDeathIntent, 'core');
  assert.equal(attacker.vars.killIntent, 'core');
});
