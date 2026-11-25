import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { validVmStatMod, vmStatModError } from '../src/core/vm-schema.js';
import { unitStandingStats } from '../src/core/combat.js';

const dodgeMod = flat => ({ stat: 'dodge', flat });
const attack = (x = 2, y = 2, extra = {}) => ({ type: 'attack', x, y, ...extra });

function customState({ actorRules = [], targetMods = [], targetPatch = {} } = {}) {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol', seed: 17 });
  const actor = state.units.swordsman;
  const target = state.units.scout;
  const actorSkill = 'dodge-test-actor';
  const targetSkill = 'dodge-test-target';
  actor.skills.push(actorSkill);
  target.skills.push(targetSkill);
  state.skills[actorSkill] = { ...structuredClone(state.skills.fan), name: '闪避管线测试主动规则', passive: true, mods: [], rules: actorRules };
  state.skills[targetSkill] = { ...structuredClone(state.skills.fan), name: '闪避管线测试常驻修饰', passive: true, mods: targetMods, rules: [] };
  Object.assign(actor, { x: 1, y: 2 });
  Object.assign(target, { x: 2, y: 2, ...targetPatch });
  return state;
}

function start(state) {
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  return api;
}

function endTo(api, id) {
  for (let i = 0; i < 30 && api.getStateSummary().currentUnitId !== id; i++) api.playAction({ type: 'end' });
  assert.equal(api.getStateSummary().currentUnitId, id);
}

test('禁止 checkKind dodge，并在完整状态校验中给出直接 dodge 写法', () => {
  for (const mod of [
    { stat: 'checkBonus', flat: 2, checkKind: 'dodge' },
    { stat: 'dodge', flat: 2, checkKind: 'dodge' },
  ]) {
    assert.equal(validVmStatMod(mod), false);
    assert.match(vmStatModError(mod), /\{stat:"dodge", flat:\.\.\.\}/);
    const state = buildScenario('ruins');
    state.units.swordsman.mods = [mod];
    assert.throws(() => validateState(state), error => /dodge/.test(error.message) && /\{stat:"dodge", flat:\.\.\.\}/.test(error.message));
  }
});

test('targetProfile 与 roll 日志保持攻方命中减守方闪避恒等式', () => {
  const api = start(customState({ targetMods: [{ ...dodgeMod(5), checkKind: 'attack', when: 'event.distance >= 0' }] }));
  endTo(api, 'swordsman');
  const preview = api.previewAction(attack());
  assert.equal(preview.ok, true, preview.error);
  const target = preview.targets.find(entry => entry.targetId === 'scout');
  assert.ok(target, 'preview must expose scout target');
  assert.equal(target.dodgeBonus, 5);
  assert.equal(target.attackAccuracy - target.dodgeBonus, target.accuracy);

  const played = api.playAction(attack());
  assert.equal(played.ok, true, played.error);
  const roll = api.listActionLogs(50).find(entry => entry.type === 'roll' && entry.detail?.targetId === 'scout');
  assert.ok(roll, 'attack must write a roll log');
  assert.equal(roll.detail.dodgeBonus, 5);
  assert.deepEqual([roll.detail.ruleset, roll.detail.targetKind], ['protocol', 'unit']);
  assert.match(roll.text, /合计 .*守方闪避 \+5/);
  assert.equal(roll.detail.attackAccuracy - roll.detail.dodgeBonus, roll.detail.accuracy);
  assert.equal(roll.detail.total, roll.detail.selected + roll.detail.accuracy);
});

test('before_check 的 ignoreDodge 与 bonusDelta 同步更新结算字段', () => {
  const api = start(customState({
    targetMods: [dodgeMod(7)],
    actorRules: [{ id: 'pierce-dodge', hook: 'before_check', program: [
      { op: 'mutate_event', patch: { ignoreDodge: true, bonusDelta: 3 } },
    ] }],
  }));
  endTo(api, 'swordsman');
  const before = api.previewAction(attack()).targets.find(t => t.id === 'scout');
  assert.equal(before.dodgeBonus, 7);
  assert.equal(api.playAction(attack()).ok, true);
  const roll = api.listActionLogs(50).find(entry => entry.type === 'roll' && entry.detail?.targetId === 'scout');
  assert.ok(roll);
  assert.equal(roll.detail.dodgeBonus, 0);
  assert.equal(roll.detail.rawDodgeBonus, 7);
  assert.equal(roll.detail.ignoreDodge, true);
  assert.equal(roll.detail.bonusDelta, 3);
  assert.equal(roll.detail.attackAccuracy, before.attackAccuracy + 3);
  assert.equal(roll.detail.accuracy, roll.detail.attackAccuracy);
  assert.equal(roll.detail.total, roll.detail.selected + roll.detail.accuracy);
});

test('after_natural_roll 替换骰面时保留检定前的命中加值与无视闪避', () => {
  const api = start(customState({
    targetMods: [dodgeMod(7)],
    actorRules: [
      { id: 'pierce-dodge', hook: 'before_check', program: [
        { op: 'mutate_event', patch: { ignoreDodge: true, bonusDelta: 3 } },
      ] },
      { id: 'replace-roll', hook: 'after_natural_roll', program: [
        { op: 'mutate_event', patch: { replaceNaturalRoll: 12 } },
      ] },
    ],
  }));
  endTo(api, 'swordsman');
  assert.equal(api.playAction(attack()).ok, true);
  const roll = api.listActionLogs(50).find(entry => entry.type === 'roll' && entry.detail?.targetId === 'scout')?.detail;
  assert.ok(roll);
  assert.deepEqual([roll.selected, roll.rawDodgeBonus, roll.dodgeBonus, roll.ignoreDodge, roll.bonusDelta], [12, 7, 0, true, 3]);
  assert.equal(roll.accuracy, roll.attackAccuracy - roll.dodgeBonus);
  assert.equal(roll.total, roll.selected + roll.accuracy);
});

test('处决意图对陷入动摇的敌人自动清零闪避', () => {
  const api = start(customState({
    targetMods: [dodgeMod(9)],
    targetPatch: { moraleState: 'shaken' },
  }));
  endTo(api, 'swordsman');
  const preview = api.previewAction(attack(2, 2, { intent: 'kill' }));
  assert.equal(preview.ok, true, preview.error);
  const target = preview.targets.find(entry => entry.targetId === 'scout');
  assert.ok(target);
  assert.equal(target.execution, true);
  assert.equal(target.dodgeBonus, 0);
  assert.equal(target.attackAccuracy, target.accuracy);
});

test('unitStandingStats 汇总穿戴防具防御与常驻闪避', () => {
  const state = customState({ targetMods: [dodgeMod(6)] });
  const scout = state.units.scout;
  const gearId = 'scout-frostplate';
  state.items[gearId] = { id: gearId, templateId: 'frostplate', sourceId: null, name: '霜纹荆棘重甲', tags: [], tier: 1, mods: [], rules: [], pools: {} };
  scout.gear = [gearId];
  const before = structuredClone(state);
  const standing = unitStandingStats(state, scout);
  assert.deepEqual(state, before);
  assert.deepEqual(standing, { armor: 28, dodge: 6 });
});
