import { expression as fx } from '../src/core/effects.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI, buildScenario, defineStatus, patchStatus, statusModifierKeys } from '../src/index.js';
import { STATUSES, grantStatus } from '../src/core/combat.js';

const fixedAttack = fx('fixed', 'passive', 'self', [{ kind: 'modifyDamageBase', value: 10 }]);
const iceArrow = fx('ice-arrow', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'freeze', turns: 1 }], { roll: { save: 'int', dc: 14 } });
const shot = { type: 'attack', x: 3, y: 2 };
const spell = { ...shot, type: 'skill', skillId: 'challenge' };
function boot(configure = () => {}, ruleset = 'protocol') {
  const state = buildScenario({ scenarioId: 'ruins', ruleset });
  Object.assign(state.units.scout, { hp: 200, maxHp: 200, armor: 0 });
  configure(state);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  return api;
}
function bow(state, ...extra) {
  state.items['soulblade-lan'] = { id: 'soulblade-lan', templateId: 'crossbow', counters: { ammo: 3 } };
  state.equipment.crossbow.effects.push(structuredClone(fixedAttack), ...extra);
  state.equipment.crossbow.accuracy = 30;
}
function advance(api, id) {
  for (let i = 0; i < 20 && api.getStateSummary().currentUnitId !== id; i++) api.playAction({ type: 'end' });
  assert.equal(api.getStateSummary().currentUnitId, id);
}

test('冰冻箭仅在命中、触发且豁免失败时施加一回合冰冻', () => {
  for (const [int, chance, accuracy, expected] of [[-20, 1, 30, false], [50, 1, 30, true], [-20, 0, 30, undefined], [-20, 1, -20, undefined]]) {
    const api = boot(s => {
      bow(s, { ...iceArrow, roll: { ...iceArrow.roll, chance } });
      s.units.scout.stats.int = int;
      s.equipment.crossbow.accuracy = accuracy;
    });
    api.playAction(shot);
    const check = api.getBattleState().logs.find(log => log.type === 'save');
    assert.equal(check?.detail.saved, expected);
    assert.equal(api.inspectUnit('scout').statuses.freeze?.remainingTurns, expected === false ? 1 : undefined);
    if (expected === false) {
      const skipped = () => api.getBattleState().logs.some(log => log.actor === 'scout' && log.type === 'skip');
      for (let i = 0; i < 6 && !skipped(); i++) {
        api.playAction({ type: 'end' });
        assert.notEqual(api.getStateSummary().currentUnitId, 'scout');
      }
      assert.ok(skipped());
    }
  }
});

test('恒定拉距在两种规则下固定起伤，显式 false 可加关联属性', () => {
  for (const ruleset of ['protocol', 'sandbox']) {
    for (const [agi, ignoreAttributes, expected] of [[1, undefined, 10], [30, true, 10], [2, false, ruleset === 'protocol' ? 50 : 12]]) {
      const api = boot(s => {
        bow(s);
        s.units.swordsman.stats.agi = agi;
        if (ignoreAttributes !== undefined) s.equipment.crossbow.effects.at(-1).effects[0].ignoreAttributes = ignoreAttributes;
      }, ruleset);
      assert.equal(api.previewAction(shot).targets[0].protocolInitial, expected);
      api.playAction(shot);
      const damage = api.getBattleState().logs.find(log => log.type === 'damage');
      assert.equal(damage.detail.dice.value, expected);
      assert.deepEqual(damage.detail.dice.rolls, []);
    }
  }
});

test('无限弹药可空仓开火，关闭后恢复正常消耗', () => {
  for (const ammo of [0, 2]) {
    const api = boot(s => {
      bow(s);
      s.items['soulblade-lan'].counters.ammo = ammo;
      grantStatus(s, s.units.swordsman, 'infinite_ammo', { durationType: 'until_removed' });
    });
    assert.equal(api.previewAction(shot).infiniteAmmo, true);
    api.playAction(shot);
    assert.equal(api.getBattleState().items['soulblade-lan'].counters.ammo, ammo);
    api.undoLastCommit();
    assert.equal(api.patchStatus('swordsman', 'infinite_ammo', { infiniteAmmo: false }).ok, true);
    if (!ammo) assert.throws(() => api.playAction(shot), /弹仓已空/);
    else {
      api.playAction(shot);
      assert.equal(api.getBattleState().items['soulblade-lan'].counters.ammo, ammo - 1);
    }
  }
});

test('固定技能伤害经过护盾且跳过攻方属性和倍率', () => {
  const api = boot(s => {
    s.units.swordsman.stats.str = 50;
    grantStatus(s, s.units.swordsman, 'charge');
    grantStatus(s, s.units.scout, 'shield', { modifiers: { amount: 4 } });
    s.skills.challenge.effects = [fx('fixed-skill', 'passive', 'self', [{ kind: 'modifyDamageBase', value: 10, damageType: 'physical', unscaled: true }])];
    s.units.scout.stats = { str: 0, agi: 0, con: 0, int: 0, spi: 0 };
  });
  assert.deepEqual(api.previewAction(spell).targets[0].damage, [6, 6]);
  api.playAction(spell);
  assert.equal(api.inspectUnit('scout').hp, 194);
  assert.equal(api.getBattleState().logs.find(log => log.type === 'damage').detail.raw, 10);
});

test('再生和护盾各自使用实例的覆盖值', () => {
  const api = boot(s => {
    s.units.scout.hp = 100;
    grantStatus(s, s.units.scout, 'regen', { modifiers: { heal: 30 } });
    grantStatus(s, s.units.scout, 'shield', { modifiers: { amount: 100000 } });
  });
  assert.equal(api.inspectUnit('scout').statuses.shield.amount, 100000);
  assert.equal(api.patchStatus('scout', 'shield', { amount: 33 }).ok, true);
  assert.equal(api.inspectUnit('scout').statuses.shield.amount, 33);
  advance(api, 'scout');
  assert.equal(api.inspectUnit('scout').hp, 130);
  assert.equal(STATUSES.regen.modifiers.heal, 5);
});

test('自定义状态、武器状态覆盖及实例补丁可以随快照重放', () => {
  const api = boot(s => bow(s, fx('poison-hit', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'poison', stacks: 2, modifiers: { damage: 12 } }])));
  const { id, ...template } = STATUSES.regen;
  const state = api.getBattleState();
  defineStatus(state, 'custom_regen', template);
  assert.deepEqual(statusModifierKeys('custom_regen', state), ['heal']);
  defineStatus(state, id, { ...template, modifiers: { heal: 9 } });
  assert.equal(state.statusTemplates[id].modifiers.heal, 9);
  assert.throws(() => defineStatus(state, id, template), /自定义状态 ID/);
  assert.equal(api.defineStatus('custom_regen', template).ok, true);
  assert.deepEqual(api.statusModifierKeys('custom_regen'), ['heal']);
  api.playAction(shot);
  assert.equal(api.inspectUnit('scout').statuses.poison.modifiers.damage, 12);
  assert.equal(api.inspectUnit('scout').statuses.poison.stacks, 2);
  const hp = api.inspectUnit('scout').hp;
  advance(api, 'scout');
  assert.equal(api.inspectUnit('scout').hp, hp - 24);
  assert.equal(api.patchStatus('scout', 'poison', { damage: 20 }).ok, true);
  const before = api.exportBattleSnapshot();
  assert.equal(api.patchStatus('scout', 'poison', { damage: 0 }).ok, false);
  assert.deepEqual(api.exportBattleSnapshot(), before);
  assert.ok(before.state.logs.some(log => log.type === 'status_patch' && log.detail.modifiers.damage === 20));
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(before);
  assert.deepEqual(restored.getBattleState(), before.state);
  assert.equal(STATUSES.poison.modifiers.damage, 3);
  assert.throws(() => patchStatus(state, 'scout', 'poison', { damage: 1 }), /找不到状态实例/);
});
