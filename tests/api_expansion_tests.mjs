import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI, buildScenario, defineStatus } from '../src/index.js';
import { grantStatus } from '../src/core/combat.js';
import { narrate } from '../src/ui/narrate.js';
import { fields } from '../src/api/validation.js';

test('template field errors name the missing or unexpected key', () => {
  assert.throws(() => fields({ name: '试验技能' }, ['name', 'slot']), /缺少必填字段：slot$/);
  assert.throws(() => fields({ name: '试验技能', slot: 'action', cooldown: 2 }, ['name', 'slot']), /包含不支持的字段：cooldown$/);
});
import { createPool, getPool, updatePoolCurrent } from '../src/core/vm-pools.js';

const onHit = (id, program) => ({ id, hook: 'after_hit', filter: "event.actorId == self.id && event.weaponTemplateId == 'crossbow'", program });
const iceArrow = chance => onHit('ice-arrow', [{ op: 'check', kind: 'chance', dc: chance * 100, onPass: [
  { op: 'check', kind: 'save', stat: 'int', dc: 14, onFail: [{ op: 'apply_status', target: 'target', statusId: 'freeze', turns: 1 }] },
] }]);
const shot = { type: 'attack', x: 3, y: 2 };
const spell = { ...shot, type: 'skill', skillId: 'challenge' };
const arrows = api => getPool(api.getBattleState(), 'soulblade-lan', 'ammo', 'item').current;
const setHp = (state, id, value) => updatePoolCurrent(state, state.units[id].pools.hp, 'set', value);
function boot(configure = () => {}, ruleset = 'protocol') {
  const state = buildScenario({ scenarioId: 'ruins', ruleset });
  const hp = getPool(state, 'scout', 'hp');
  hp.max = hp.contributors[0].maxBase = 200;
  state.units.scout.armor = 0;
  setHp(state, 'scout', 200);
  configure(state);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  return api;
}
function bow(state, ...extra) {
  const id = 'soulblade-lan';
  delete state.pools[state.items[id].pools.souls];
  state.items[id] = { id, templateId: 'crossbow' };
  createPool(state, { ownerKind: 'item', ownerId: id, key: 'ammo', max: 3, current: 3, reloadable: true });
  state.equipment.crossbow.rules.push(...extra);
  Object.assign(state.equipment.crossbow, { accuracy: 30, attack: 0, damage: { count: 1, sides: 1, bonus: 9, stat: 'agi', type: 'physical' } });
  state.units.swordsman.stats.agi = 0;
}
function advance(api, id) {
  for (let i = 0; i < 20 && api.getStateSummary().currentUnitId !== id; i++) api.playAction({ type: 'end' });
  assert.equal(api.getStateSummary().currentUnitId, id);
}
const fixedDamage = (amount, damageType) => [{ id: 'fixed', hook: 'active', program: [{ op: 'damage', target: 'target', amount, damageType }] }];
const shield = { id: 'test_shield', name: '试验护盾', category: 'shield', remainingTurns: 3, stackMode: 'replace', vars: { shieldAmount: 4 } };

test('冰冻箭仅在命中、触发且豁免失败时施加一回合冰冻', () => {
  for (const [int, chance, accuracy, expected] of [[-20, 1, 30, false], [50, 1, 30, true], [-20, 0, 30, undefined], [-20, 1, -20, undefined]]) {
    const api = boot(s => {
      bow(s, iceArrow(chance));
      s.units.scout.stats.int = int;
      s.equipment.crossbow.accuracy = accuracy;
    });
    api.playAction(shot);
    const state = api.getBattleState();
    const check = state.logs.find(log => log.type === 'save');
    if (expected !== undefined) {
      assert.ok(check);
      const entry = narrate(check, state);
      const verdict = expected ? '通过' : '失败';
      assert.match(entry.lines[0], new RegExp(`智力豁免：d20 得 \\d+ [+-]?\\d+ = -?\\d+，需要 14 → ${verdict}`));
      assert.equal(entry.roll.total, entry.roll.kept + entry.roll.modifier);
      assert.match(api.exportBattleReportText(), expected ? /通过智力豁免（(?:大)?成功/ : /未通过智力豁免（(?:大)?失败/);
    }
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

test('恒定伤害与显式敏捷缩放在两种规则下都按表达式结算', () => {
  for (const ruleset of ['protocol', 'sandbox']) {
    for (const [agi, amount, expected] of [[30, 10, 10], [2, '10 + self.agi', 12]]) {
      const api = boot(s => {
        s.units.swordsman.stats.agi = agi;
        s.skills.challenge.rules = fixedDamage(amount, 'true');
      }, ruleset);
      const before = api.exportBattleSnapshot();
      assert.equal(api.previewAction(spell).ok, true);
      assert.deepEqual(api.exportBattleSnapshot(), before);
      api.playAction(spell);
      const damage = api.getBattleState().logs.find(log => log.type === 'damage');
      assert.equal(damage.detail.amount, expected);
      assert.equal(api.inspectUnit('scout').hp, 200 - expected);
    }
  }
});

test('无限弹药可空仓开火，关闭后恢复正常消耗', () => {
  for (const ammo of [0, 2]) {
    const api = boot(s => {
      bow(s);
      updatePoolCurrent(s, getPool(s, 'soulblade-lan', 'ammo', 'item').id, 'set', ammo);
      grantStatus(s, s.units.swordsman, 'infinite_ammo', { durationType: 'until_removed' });
    });
    assert.equal(api.previewAction(shot).infiniteAmmo, true);
    api.playAction(shot);
    assert.equal(arrows(api), ammo);
    api.undoLastCommit();
    const remove = api.proposeCommands([{ type: 'remove_status', unitId: 'swordsman', statusId: 'infinite_ammo' }],
      { baseRevision: api.getStateSummary().revision, reason: '关闭无限弹药' });
    assert.equal(remove.ok, true, remove.error);
    assert.equal(api.commitProposal(remove.proposalId).ok, true);
    if (!ammo) assert.throws(() => api.playAction(shot), /弹仓已空/);
    else {
      api.playAction(shot);
      assert.equal(arrows(api), ammo - 1);
    }
  }
});

test('固定技能伤害经过护盾且跳过攻方属性和架势倍率', () => {
  const api = boot(s => {
    s.units.swordsman.stats.str = 50;
    grantStatus(s, s.units.swordsman, 'charge');
    defineStatus(s, shield.id, shield);
    s.units.scout.statuses[shield.id] = {
      ...structuredClone(shield), templateId: shield.id, ownerId: 'scout', sourceId: null,
      durationType: 'battle_turns', stacks: 1,
    };
    s.skills.challenge.rules = fixedDamage(10, 'physical');
    s.units.scout.stats = { str: 0, agi: 0, con: 0, int: 0, spi: 0 };
  });
  assert.equal(api.previewAction(spell).ok, true);
  api.playAction(spell);
  const damage = api.getBattleState().logs.find(log => log.type === 'damage');
  assert.equal(damage.detail.absorbed, 4);
  assert.equal(damage.detail.amount, 6);
  assert.equal(api.inspectUnit('scout').hp, 194);
});

const regen = { id: 'custom_regen', name: '试验再生', category: 'hot', remainingTurns: 3, vars: { heal: 5 }, rules: [
  { id: 'regen-tick', hook: 'turn_start', program: [{ op: 'heal', target: 'self', amount: 'status.vars.heal' }] },
] };
const venom = { id: 'custom_venom', name: '试验中毒', category: 'dot', stackMode: 'stack', maxStacks: 4, remainingTurns: 3, vars: { damage: 3 }, rules: [
  { id: 'venom-tick', hook: 'turn_start', program: [{ op: 'damage', target: 'self', amount: 'status.vars.damage * status.stacks', damageType: 'true', direct: false }] },
] };

test('再生和护盾各自使用实例的覆盖值', () => {
  const api = boot(s => { setHp(s, 'scout', 100); });
  assert.equal(api.defineStatus(regen.id, regen).ok, true);
  assert.equal(api.defineStatus(shield.id, shield).ok, true);
  const setup = api.proposeCommands([
    { type: 'upsert_status', unitId: 'scout', statusId: regen.id, options: { vars: { heal: 30 } } },
    { type: 'upsert_status', unitId: 'scout', statusId: shield.id, options: { vars: { shieldAmount: 100000 } } },
  ], { baseRevision: api.getStateSummary().revision, reason: '测试状态实例覆盖' });
  assert.equal(setup.ok, true, setup.error);
  assert.equal(api.commitProposal(setup.proposalId).ok, true);
  assert.equal(api.inspectUnit('scout').statuses[shield.id].vars.shieldAmount, 100000);
  assert.equal(api.patchStatus('scout', shield.id, { vars: { shieldAmount: 33 } }).ok, true);
  assert.equal(api.inspectUnit('scout').statuses[shield.id].vars.shieldAmount, 33);
  advance(api, 'scout');
  assert.equal(api.inspectUnit('scout').hp, 130);
  const { statusTemplates } = api.getBattleState();
  assert.equal(statusTemplates[regen.id].vars.heal, 5);
  assert.equal(statusTemplates[shield.id].vars.shieldAmount, 4);
});

test('自定义状态、武器状态覆盖及实例补丁可以随快照重放', () => {
  const api = boot(s => {
    defineStatus(s, venom.id, venom);
    bow(s, onHit('poison-hit', [{ op: 'apply_status', target: 'target', statusId: venom.id, stacks: 2, vars: { damage: 12 } }]));
  });
  const state = api.getBattleState();
  assert.throws(() => defineStatus(state, venom.id, venom), /自定义状态 ID/);
  assert.equal(api.defineStatus(regen.id, regen).ok, true);
  api.playAction(shot);
  assert.equal(api.inspectUnit('scout').statuses[venom.id].vars.damage, 12);
  assert.equal(api.inspectUnit('scout').statuses[venom.id].stacks, 2);
  const hp = api.inspectUnit('scout').hp;
  advance(api, 'scout');
  assert.equal(api.inspectUnit('scout').hp, hp - 24);
  assert.equal(api.patchStatus('scout', venom.id, { vars: { damage: 20 } }).ok, true);
  const before = api.exportBattleSnapshot();
  assert.equal(api.patchStatus('scout', venom.id, { vars: { damage: Infinity } }).ok, false);
  assert.deepEqual(api.exportBattleSnapshot(), before);
  assert.equal(before.state.units.scout.statuses[venom.id].vars.damage, 20);
  assert.ok(before.state.logs.some(log => log.type === 'status_patch' && log.detail.statusId === venom.id));
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(before);
  assert.deepEqual(restored.getBattleState(), before.state);
  assert.equal(restored.getBattleState().statusTemplates[venom.id].vars.damage, 3);
  assert.equal(api.patchStatus('swordsman', venom.id, { vars: { damage: 1 } }).ok, false);
});
