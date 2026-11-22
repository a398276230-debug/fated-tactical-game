import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { equippedActiveSkills } from '../src/core/combat.js';
import { aggregateModifiers, collectRules } from '../src/core/vm-carriers.js';
import { startVM, stepVM, answerVM } from '../src/core/tactical-vm.js';
import { commitVMEffect, vmHost } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { hydrateFromSources } from '../src/tavern/converter.js';

// Verbatim origin skill/item records from fated-sim-arena-test-battle.json.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/arena-a1.json', import.meta.url), 'utf8'));

test('status-tagged saves read DC from caster and resistance from defender only for matching status', () => {
  const state = buildScenario('ruins');
  const [caster, defender] = Object.values(state.units);
  const when = "event.statusId == 'freeze'";
  caster.mods = [{ stat: 'dcBonus', flat: 10, when }];
  defender.mods = [{ stat: 'resistBonus', flat: 10, when }];
  for (const statusId of ['freeze', 'burn']) {
    startVM(state, { ownerId: caster.id, sourceId: caster.id, scope: { target: { type: 'unit', id: defender.id } },
      program: [{ op: 'check', kind: 'save', dc: 12, statusId }] });
    stepVM(state, vmHost);
    const { saveDC, saveBonus } = state.logs.findLast(log => log.type === 'save').detail;
    assert.deepEqual([saveDC, saveBonus], statusId === 'freeze' ? [22, 10] : [12, 0]);
  }
});

test('arena export: held skills contribute passive checks and damage rules without casting', () => {
  const battle = buildScenario('ruins');
  const actor = { ...battle.units[battle.order[0]], id: 'a1', skills: Object.keys(fixture.skills) };
  const state = { ...battle, units: { a1: actor }, skills: fixture.skills };
  const active = { actorId: 'a1', targetId: 'a1', checkKind: 'attack' };
  assert.equal(aggregateModifiers(state, 'a1', active).stats.checkBonus.flat, 32);
  assert.equal(aggregateModifiers(state, 'a1').stats.initiativeFlat.flat, 16);
  const ids = hook => collectRules(state, hook, active).map(entry => entry.rule.id);
  assert.ok(ids('before_check').includes('veteran_instinct_dodge'));
  assert.ok(ids('before_commit').includes('winter_dominion_immune_amp'));
  assert.ok(ids('before_commit').includes('veteran_instinct_redirect'));

  const enemy = Object.values(battle.units).find(unit => unit.team !== actor.team);
  const combat = { ...battle, units: { ...battle.units, a1: actor }, skills: fixture.skills };
  delete combat.units[battle.order[0]];
  startVM(combat, { ownerId: 'a1', sourceId: 'a1', scope: { target: { type: 'unit', id: enemy.id } },
    program: [{ op: 'check', kind: 'save', statusId: 'ice_gnaw', dc: 30 }] });
  stepVM(combat, vmHost);
  assert.equal(combat.logs.findLast(log => log.type === 'save').detail.saveBonus, 10);

  const hp = enemy.hp;
  commitVMEffect(combat, { op: 'damage', amount: 15, damageType: 'true', sourceId: 'a1', targetId: enemy.id });
  const ask = combat.vm.pendingAsk;
  assert.equal(ask?.options.max, 15);
  answerVM(combat, { type: 'answer', askId: ask.askId, value: 7 }, vmHost);
  stepVM(combat, vmHost);
  assert.equal(enemy.hp, hp - 7);
});

test('arena export: the equipped ring appears in inspection and teleports at zero AP once per turn', () => {
  const state = buildScenario('ruins');
  const actor = state.units[state.order[state.turn]];
  actor.skills = [];
  actor.gear.push(fixture.item.id);
  state.items[fixture.item.id] = { id: fixture.item.id, templateId: fixture.item.templateId };
  state.equipment[fixture.item.templateId] = fixture.equipment;
  const skillId = `equip:${fixture.item.id}:void_step`;
  assert.equal(new Map(equippedActiveSkills(state, actor)).get(skillId)?.name, '虚空折跃');
  assert.equal(new Map(equippedActiveSkills(state, actor)).get(skillId)?.usesPerTurn, 1);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  assert.equal(api.inspectUnit(actor.id).skillUsage[skillId]?.usesLeft, 1);
  const action = { type: 'skill', skillId, x: actor.x, y: actor.y };
  assert.equal(api.previewAction(action).ap, 0);
  api.playAction(action);
  const ask = api.getBattleState().vm.pendingAsk;
  const point = ask.options.find(p => (p.x !== actor.x || p.y !== actor.y)
    && state.grid[p.y]?.[p.x].kind === 'floor'
    && !Object.values(state.units).some(u => u.x === p.x && u.y === p.y)
    && !Object.values(state.covers).some(c => c.x === p.x && c.y === p.y));
  assert.ok(point);
  api.playAction({ type: 'answer', askId: ask.askId, x: point.x, y: point.y });
  const after = api.inspectUnit(actor.id);
  assert.deepEqual([after.x, after.y, after.ap, after.used], [point.x, point.y, actor.ap, actor.used]);
  assert.equal(after.skillUsage[skillId].usesLeft, 0);
  assert.equal(api.previewAction({ ...action, x: after.x, y: after.y }).ok, false);
  const replay = createGameAPI();
  replay.restoreBattleSnapshot(api.exportBattleSnapshot());
  assert.deepEqual(replay.getBattleState(), api.getBattleState());
});

test('original ring and armor tags hydrate to one defense contribution each and passive modes are preserved', () => {
  const { state, warnings } = hydrateFromSources({
    battleInit: 'battle|1|arena|试炼|flat|42\nunit|p|blue|mvu:主角|旅人|1,1\nunit|e|red|char_info|守卫|2,1',
    mvu: { 主角: { 装备: {
      星弧裂空之戒: { 类型: '饰品', 标签: ['防御: 2500', '戒指', '自身', '有效距离: 贴身(0)'] },
      格诺克的永叹冥甲: { 类型: '防具', 标签: ['防御: 2500', '重甲'] },
    }, 技能: {
      三极绝狱的统御: { 模式: '被动' },
      千年战帅的本能: { passive: true },
      混合: { mode: '主动/被动' },
    } } },
    charInfo: [{ 名称: '守卫', hp: 100 }],
  }, { throwOnValidation: true });
  for (const name of ['星弧裂空之戒', '格诺克的永叹冥甲']) {
    const template = Object.values(state.equipment).find(entry => entry.name === name);
    assert.equal(template.defense, 2500);
    assert.equal(template.armor, undefined);
    assert.equal(template.range, undefined);
  }
  assert.ok(!warnings.some(w => String(w.message ?? w).includes('贴身(0)')));
  const skills = Object.fromEntries(Object.values(state.skills).map(skill => [skill.name, skill]));
  assert.equal(skills.三极绝狱的统御.passive, true);
  assert.equal(skills.千年战帅的本能.ap, 0);
  assert.equal(skills.混合.passive, undefined);
});
