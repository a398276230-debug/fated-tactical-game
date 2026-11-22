import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, corpses, currentUnit, equippedActiveSkills, living, preview } from '../src/core/combat.js';
import { chooseAction } from '../src/core/ai.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { parseBattleTime } from '../src/core/battle_time.js';
import { validExpr, evaluateExpr } from '../src/core/formula.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';
import { isStatusImmune } from '../src/core/vm-immunity.js';
import { carrierScope, collectRules } from '../src/core/vm-carriers.js';

function battle() {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), enemy = state.units.scout;
  actor.nonLethal = enemy.nonLethal = false;
  return { state, actor, enemy };
}
function learn({ state, actor, enemy }, id, program, fields = {}, rule = {}) {
  state.skills[id] = { name: id, range: 3, ap: 1, slot: 'action', shape: 'single', target: 'enemy',
    rules: [{ id, hook: 'active', program, ...rule }], ...fields };
  actor.skills.push(id);
  const point = fields.target === 'self' ? actor : enemy;
  return { type: 'skill', skillId: id, x: point.x, y: point.y };
}
const damage = (amount, target = 'target') => ({ op: 'damage', target, amount, damageType: 'true' });

test('status immunity queries drive deterministic 1.3x modifiers on native and VM damage', () => {
  const makeFixture = () => {
    const fixture = battle();
    const { state, actor, enemy } = fixture;
    const statusId = 'freeze-test';
    state.statusTemplates = { [statusId]: { id: statusId, name: '测试冻结', category: 'control', remainingTurns: 1 } };
    enemy.skills = ['immune-skill'];
    state.skills['immune-skill'] = { name: '免疫测试', passive: true, rules: [{ id: 'immune-freeze', hook: 'before_status',
      filter: "event.statusId == 'freeze-test' && event.targetId == self.id",
      program: [{ op: 'mutate_event', patch: { cancel: true } }] }] };
    actor.mods = [{ stat: 'finalDamageMult', mult: "is_immune(target, 'freeze-test') ? 1.3 : 1" }];
    const weapon = state.equipment[state.items[actor.mainHand ?? actor.weapon].templateId];
    Object.assign(weapon, { range: 3, damage: { count: 0, sides: 0, bonus: 10, type: 'true' } });
    return { state, actor, enemy, statusId };
  };

  const native = makeFixture();
  const nativeBefore = native.enemy.hp;
  native.actor.ap = 2; native.actor.used = { attack: 0, action: 0 };
  applyAction(native.state, { type: 'attack', x: native.enemy.x, y: native.enemy.y });
  const immuneNativeDamage = nativeBefore - native.enemy.hp;
  const normalNative = makeFixture();
  normalNative.enemy.skills = [];
  const normalBefore = normalNative.enemy.hp;
  normalNative.actor.ap = 2; normalNative.actor.used = { attack: 0, action: 0 };
  applyAction(normalNative.state, { type: 'attack', x: normalNative.enemy.x, y: normalNative.enemy.y });
  assert.equal(immuneNativeDamage, Math.round((normalBefore - normalNative.enemy.hp) * 1.3), 'native damage sees target immunity through carrierScope');
  assert.equal(isStatusImmune(native.state, native.enemy, native.statusId, native.actor, { collectRules, carrierScope }), true);
  const nativeSnapshot = structuredClone(native.state);
  assert.equal(isStatusImmune(native.state, native.enemy, native.statusId, native.actor, { collectRules, carrierScope }), true);
  assert.deepEqual(native.state, nativeSnapshot, 'immunity query is read-only');

  const vm = makeFixture();
  vm.enemy.skills = [];
  vm.state.skills.vm_hit = { name: 'VM伤害', range: 3, ap: 1, slot: 'action', shape: 'single', target: 'enemy',
    rules: [{ id: 'vm-hit', hook: 'active', program: [{ op: 'damage', target: 'target', amount: 10, damageType: 'true' }] }] };
  vm.actor.skills.push('vm_hit');
  const ordinaryBefore = vm.enemy.hp;
  vm.actor.ap = 2; vm.actor.used = { attack: 0, action: 0 };
  applyAction(vm.state, { type: 'skill', skillId: 'vm_hit', x: vm.enemy.x, y: vm.enemy.y });
  assert.equal(ordinaryBefore - vm.enemy.hp, 10, 'ordinary target keeps the base VM damage');
  assert.equal(isStatusImmune(vm.state, vm.enemy, vm.statusId, vm.actor, { collectRules, carrierScope }), false);

  const vmImmune = makeFixture();
  vmImmune.state.skills.vm_hit = vm.state.skills.vm_hit;
  vmImmune.actor.skills.push('vm_hit');
  const vmImmuneBefore = vmImmune.enemy.hp;
  vmImmune.actor.ap = 2; vmImmune.actor.used = { attack: 0, action: 0 };
  applyAction(vmImmune.state, { type: 'skill', skillId: 'vm_hit', x: vmImmune.enemy.x, y: vmImmune.enemy.y });
  assert.equal(vmImmuneBefore - vmImmune.enemy.hp, 13, 'immune target receives the 1.3x VM damage');
});

test('VM expressions use caster stats, arithmetic and runtime comparisons', () => {
  const fixture = battle();
  const { state, actor, enemy } = fixture;
  actor.stats.str = 10;
  const cast = learn(fixture, 'formula', [{ op: 'if', cond: 'self.str - 5 >= 5',
    then: [damage('(self.str - 5) / self.str * 6')], else: [damage(1)] }]);
  const before = enemy.hp;
  validateState(state);
  applyAction(state, cast);
  assert.equal(before - enemy.hp, 3);
});

test('expression paths are closed and divide by zero cannot produce a damage amount', () => {
  assert.equal(validExpr('我方力量 + 1'), false);
  assert.equal(validExpr('state.units.e1.hp'), false);
  assert.equal(evaluateExpr('10 / 0', {}), null);
  const fixture = battle();
  const { state, enemy } = fixture;
  const cast = learn(fixture, 'bad-amount', [damage('10 / 0')]);
  const before = enemy.hp;
  applyAction(state, cast);
  assert.equal(enemy.hp, before);
});

test('a full-health cast consumes its use and preview stays free of side effects', () => {
  const fixture = battle();
  const { state, actor } = fixture;
  const cast = learn(fixture, 'once', [{ op: 'heal', target: 'self', amount: 5 }], { target: 'self', range: 0 }, { usesPerBattle: 1 });
  const before = structuredClone(state);
  assert.equal(preview(state, cast).usesLeft, 1);
  assert.deepEqual(state, before);
  applyAction(state, cast);
  actor.ap = 2;
  actor.used = { attack: 0, action: 0 };
  assert.equal(preview(state, cast).usesLeft, 0);
  assert.equal(preview(state, cast).ok, false);
});

test('a failed chance check still consumes the active rule use', () => {
  const fixture = battle();
  const { state, actor, enemy } = fixture;
  const cast = learn(fixture, 'chance', [{ op: 'check', kind: 'chance', dc: 0, onPass: [damage(1)] }], {}, { usesPerBattle: 1 });
  const hp = enemy.hp;
  assert.equal(preview(state, cast).usesLeft, 1);
  applyAction(state, cast);
  assert.equal(enemy.hp, hp);
  actor.ap = 2;
  actor.used = { attack: 0, action: 0 };
  assert.equal(preview(state, cast).usesLeft, 0);
});

test('an equipment skill can chain committed resource amounts into restoration and item creation', () => {
  const { state, actor } = battle();
  const item = state.items[actor.weapon];
  state.equipment[item.templateId].skills = ['transmute'];
  state.equipment.token = { name: '灵魂结晶', kind: 'consumable' };
  state.skills.transmute = { name: '转化', range: 0, ap: 1, slot: 'action', shape: 'single', target: 'self',
    rules: [{ id: 'transmute', hook: 'active', usesPerBattle: 1, program: [
      { op: 'resource', target: 'self', pool: 'hp', mode: 'sub', amount: 10, minRemain: 1, requireFull: true, out: 'spent' },
      { op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: '-vars.spent / 2' },
      { op: 'spawn', entityKind: 'item', spec: { templateId: 'token' } },
    ] }] };
  const [[skillId]] = equippedActiveSkills(state, actor);
  updatePoolCurrent(state, getPool(state, actor.id, 'mp').id, 'set', 0);
  const before = actor.hp;
  const cast = { type: 'skill', skillId, x: actor.x, y: actor.y };
  validateState(state);
  applyAction(state, cast);
  assert.equal(actor.hp, before - 10);
  assert.equal(actor.mp, Math.min(actor.maxMp, 5));
  assert.equal(actor.inventory.token, 1);
  validateState(JSON.parse(JSON.stringify(state)));
});

test('defeat isolates the corpse, and VM revive restores the original unit and turn order', () => {
  const fixture = battle();
  const { state, actor, enemy } = fixture;
  const kill = learn(fixture, 'kill-test', [damage(9999)]);
  const revive = learn(fixture, 'revive-test', [{ op: 'revive', target: 'target', hpPercent: 0.5 }], { target: 'corpse' });
  assert.equal(preview(state, revive).ok, false);
  applyAction(state, kill);
  assert.ok(corpses(state).includes(enemy));
  assert.ok(!living(state).includes(enemy));
  assert.equal(preview(state, kill).ok, false);
  actor.ap = 2;
  actor.used = { attack: 0, action: 0 };
  assert.ok(preview(state, revive).ok);
  applyAction(state, revive);
  assert.equal(enemy.hp, Math.floor(enemy.maxHp / 2));
  assert.ok(living(state).includes(enemy));
  assert.ok(!corpses(state).includes(enemy));
  assert.equal(state.order.filter(id => id === enemy.id).length, 1);
  validateState(JSON.parse(JSON.stringify(state)));
});

test('battle time hydrates from tp and a rule can branch on day or night', () => {
  const tp = clock => `<tp>复兴纪元488年-10月-14日-星期四-${clock} @ 城区 08:15</tp>`;
  const { state } = hydrateFromSources({ task: tp('11:25') }, { throwOnValidation: true });
  assert.deepEqual(state.time, { raw: '复兴纪元488年-10月-14日-星期四-11:25', hour: 11, minute: 25, timeOfDay: 'day', calendar: '复兴纪元488年-10月-14日-星期四' });
  for (const [clock, period] of [['04:59', 'night'], ['05:00', 'dawn'], ['07:59', 'dawn'], ['08:00', 'day'], ['16:59', 'day'], ['17:00', 'dusk'], ['19:29', 'dusk'], ['19:30', 'night']]) {
    assert.equal(parseBattleTime(tp(clock)).timeOfDay, period);
  }
  for (const [clock, amount] of [['11:25', 0], ['22:30', 2]]) {
    const fixture = battle();
    fixture.state.time = parseBattleTime(tp(clock));
    const cast = learn(fixture, 'moon', [{ op: 'if', cond: "timeOfDay == 'night'", then: [damage(2)] }]);
    const before = fixture.enemy.hp;
    applyAction(fixture.state, cast);
    assert.equal(before - fixture.enemy.hp, amount);
  }
});

test('active VM damage is included in skill preview and matches execution', () => {
  const fixture = battle();
  const { state, enemy } = fixture;
  const cast = learn(fixture, 'preview-damage', [damage('event.power * 1.2')], { power: 5 });
  const plan = preview(state, cast);
  assert.equal(plan.ok, true, plan.error);
  assert.deepEqual(plan.targets[0].damage, [6, 6]);
  const before = enemy.hp;
  applyAction(state, cast);
  assert.equal(before - enemy.hp, plan.targets[0].damage[0]);
});

test('qualified damage reduction affects only its type and shields still absorb true damage', () => {
  for (const [damageType, expected] of [['physical', 2], ['energy', 6], ['mental', 6], ['true', 6]]) {
    const fixture = battle();
    const { state, actor, enemy } = fixture;
    enemy.armor = 0;
    Object.assign(enemy.stats, { str: 0, agi: 0, con: 0, int: 0, spi: 0 });
    enemy.mods = [{ stat: 'damageReduction', damageType: 'physical', flat: 0.5 }];
    state.statusTemplates = { ward: { id: 'ward', name: '护盾', category: 'shield', vars: { shieldAmount: 2 } } };
    const ward = learn(fixture, 'ward-test', [{ op: 'apply_status', target: 'target', statusId: 'ward' }]);
    const strike = learn(fixture, 'typed-test', [{ op: 'damage', target: 'target', amount: 8, damageType }]);
    validateState(state);
    applyAction(state, ward);
    actor.ap = 2;
    actor.used = { attack: 0, action: 0 };
    assert.deepEqual(preview(state, strike).targets[0].damage, [expected, expected], damageType);
    const hp = enemy.hp;
    applyAction(state, strike);
    assert.equal(hp - enemy.hp, expected, damageType);
    assert.equal(enemy.statuses.ward, undefined);
  }
});

test('VM modifiers reject percentage-point and multiplier field mistakes', () => {
  for (const [mod, error] of [
    [{ stat: 'damageReduction', additivePercent: 0.3 }, /基值为 0.*flat.*0.3/],
    [{ stat: 'armorPiercePercent', flat: 20 }, /基值为 0.*flat.*-1\.\.1/],
    [{ stat: 'damageMult', flat: 0.3 }, /基值为 1.*mult/],
  ]) {
    const { state, enemy } = battle();
    enemy.mods = [mod];
    assert.throws(() => validateState(state), error);
  }
});

test('defender dodge modifier reduces the weapon attack accuracy used in settlement', () => {
  const { state, actor, enemy } = battle();
  const weapon = state.equipment[state.items[actor.mainHand ?? actor.weapon].templateId];
  weapon.range = 3;
  const attack = { type: 'attack', x: enemy.x, y: enemy.y };
  const original = preview(state, attack).targets[0].accuracy;
  enemy.mods = [{ stat: 'dodge', flat: 10 }];
  validateState(state);
  const profile = preview(state, attack).targets[0];
  assert.equal(profile.accuracy, original - 10);
  applyAction(state, attack);
  assert.ok(state.logs.some(log => log.detail?.accuracy === profile.accuracy));
});

test('native weapon and VM damage share flat and separate percentage mitigation', () => {
  const mods = [
    { stat: 'damageReduction', flat: 0.3 },
    { stat: 'damageReductionFlat', flat: 8 },
    { stat: 'dr', flat: 0.15, when: 'event.targetId == self.id && attacker.id != self.id' },
  ];
  const reduced = raw => Math.floor(Math.max(0, Math.floor(raw * 0.7 - 8)) * 0.85);
  for (const damageType of ['physical', 'true']) {
    const fixture = battle();
    const { state, actor, enemy } = fixture;
    state.ruleset = 'sandbox';
    actor.skills = [];
    enemy.skills = [];
    enemy.armor = 0;
    const weapon = state.equipment[state.items[actor.mainHand ?? actor.weapon].templateId];
    Object.assign(weapon, { range: 3, damage: { count: 0, sides: 0, bonus: 100, type: damageType } });
    actor.rules = [{ id: 'guaranteed-strike', hook: 'before_check', program: [{ op: 'mutate_event', patch: { forceOutcome: 'hit' } }] }];
    const attack = { type: 'attack', x: enemy.x, y: enemy.y };
    const baseline = preview(state, attack).targets[0].damage[0];
    enemy.mods = mods;
    const spell = learn(fixture, 'typed-mitigation', [{ op: 'damage', target: 'target', amount: 100, damageType }]);
    validateState(state);
    const expected = damageType === 'physical' ? reduced : raw => raw;
    assert.equal(preview(state, attack).targets[0].damage[0], expected(baseline));
    assert.equal(preview(state, spell).targets[0].damage[0], expected(100));
    const before = enemy.hp;
    applyAction(state, attack);
    const { dice, ratingMultiplier, attackMultiplier, intent, stanceScale, offHandScale } = state.logs.findLast(entry => entry.type === 'damage').detail;
    assert.equal(before - enemy.hp, expected(dice.value * ratingMultiplier * attackMultiplier * intent.multiplier * stanceScale * offHandScale));
    const then = enemy.hp;
    applyAction(state, spell);
    assert.equal(then - enemy.hp, expected(100));
  }
});

test('percentage piercing uses decimal fractions and clamps dynamic values on both damage paths', () => {
  for (const [flat, effectivePercent] of [[0.2, 0.2], ['self.maxHp', 1]]) {
    const fixture = battle();
    const { state, actor, enemy } = fixture;
    state.ruleset = 'sandbox';
    actor.skills = [];
    enemy.skills = [];
    enemy.armor = 2000;
    state.equipment[state.items[actor.mainHand ?? actor.weapon].templateId].range = 3;
    actor.mods = [{ stat: 'armorPiercePercent', flat }];
    const attack = { type: 'attack', x: enemy.x, y: enemy.y };
    const plan = preview(state, attack);
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.targets[0].armorPierce.percent, Math.min(1, (plan.targets[0].stanceRules.armorPenetration ?? 0) + effectivePercent));
    const spell = learn(fixture, 'piercing', [{ op: 'damage', target: 'target', amount: 180, damageType: 'physical' }]);
    validateState(state);
    const before = enemy.hp;
    applyAction(state, spell);
    assert.equal(before - enemy.hp, Math.floor(180 * (2000 / (2000 + 2000 * (1 - effectivePercent)))));
  }
});

test('costMult reduces shown, required, and paid skill resources but not AP', () => {
  const fixture = battle();
  const { state, actor } = fixture;
  actor.mods = [{ stat: 'costMult', mult: 0.7, when: "event.skillId == 'discounted'" }];
  updatePoolCurrent(state, getPool(state, actor.id, 'mp').id, 'set', 7);
  const cast = learn(fixture, 'discounted', [], { target: 'self', range: 0, mp: 10 });
  const plan = preview(state, cast);
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.mp, 7);
  assert.equal(plan.ap, 1);
  applyAction(state, cast);
  assert.equal(actor.mp, 0);
  assert.equal(actor.ap, 1);
});

test('an area rule damages each enemy it selects once and spends one use', () => {
  const fixture = battle();
  const { state, actor, enemy } = fixture;
  const second = state.units.raider;
  Object.assign(second, { x: enemy.x, y: enemy.y + 1 });
  state.grid[second.y][second.x] = { kind: 'floor', z: 0 };
  const select = { from: 'units', area: { shape: 'circle', origin: 'center', radius: 1 },
    where: 'candidate.alive && candidate.team != self.team' };
  const cast = learn(fixture, 'area-test', [{ op: 'for_each', select, body: [damage(1)] }],
    { shape: 'circle', radius: 1 }, { usesPerBattle: 1 });
  validateState(state);
  const hp = Object.fromEntries([enemy, second, actor].map(unit => [unit.id, unit.hp]));
  applyAction(state, cast);
  assert.equal(hp[enemy.id] - enemy.hp, 1);
  assert.equal(hp[second.id] - second.hp, 1);
  assert.equal(actor.hp, hp[actor.id]);
  actor.ap = 2;
  actor.used = { attack: 0, action: 0 };
  assert.equal(preview(state, cast).usesLeft, 0);
});

for (const source of ['learned', 'equipment', 'backpack']) test(`AI considers VM healing from ${source} without mutating state`, () => {
  const fixture = battle();
  const { state, actor } = fixture;
  updatePoolCurrent(state, getPool(state, actor.id, 'hp').id, 'set', Math.floor(actor.maxHp / 2));
  const program = [{ op: 'heal', target: 'self', amount: 1000 }];
  let cast = { type: 'skill', x: actor.x, y: actor.y };
  if (source === 'equipment') {
    const item = state.items[actor.weapon];
    state.skills.support = { name: 'support', range: 0, ap: 1, slot: 'action', shape: 'single', target: 'self',
      rules: [{ id: 'support', hook: 'active', usesPerBattle: 1, program }] };
    state.equipment[item.templateId].skills = ['support'];
    [[cast.skillId]] = equippedActiveSkills(state, actor);
  } else {
    cast = learn(fixture, 'support', program, { target: 'self', range: 0 }, { usesPerBattle: 1 });
    if (source === 'backpack') {
      state.skills.support.backpackItem = true;
      actor.skills = actor.skills.filter(id => id !== 'support');
      actor.inventory = { support: 1 };
    }
  }
  const before = structuredClone(state);
  assert.deepEqual(chooseAction(state), { ...cast, targetId: actor.id });
  assert.deepEqual(state, before);
  applyAction(state, cast);
  assert.equal(actor.hp, actor.maxHp);
  if (source === 'backpack') assert.equal(actor.inventory.support, 0);
});
