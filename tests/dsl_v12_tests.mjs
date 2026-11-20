import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, currentUnit, grantStatus, patchStatus, preview } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { applyPatch } from '../src/tavern/overlay.js';

const strike = { type: 'attack', x: 3, y: 2 };
const formula = { base: 6, scaleBy: { stat: 'spi', perUnit: .5 } };
export function setup(effects = []) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), enemy = state.units.scout, item = state.items[actor.weapon];
  item.templateId = 'v12_weapon'; item.counters = {};
  const weapon = state.equipment.v12_weapon = { name: 'DSL 测试剑', range: 2, damage: { count: 1, sides: 4, type: 'physical' }, effects: [
    { id: 'v12_hit', trigger: 'passive', target: 'self', effects: [{ kind: 'forceOutcome', mode: 'hit' }, { kind: 'modifyDamageBase', value: 100 }] },
    ...effects,
  ] };
  Object.assign(enemy, { hp: 1000, maxHp: 1000, nonLethal: false });
  return { state, actor, enemy, weapon };
}

export const laugh = {
  id: 'laugh_disabled', name: '狂笑失能', icon: '😆', category: 'control', description: '跳过行动，实际受到直接伤害时解除。',
  remainingTurns: 1, durationType: 'battle_turns', tickTiming: 'onTurnStart', stackRule: 'refresh', maxStacks: 1,
  modifiers: { skip: true }, expireOn: { trigger: 'on_damaged', damageType: 'direct' },
};
export const oath = {
  id: 'knight_oath', label: '骑士誓言', trigger: 'passive', target: 'self', condition: { type: 'intercepting' },
  effects: [{ kind: 'modifyStat', stat: 'defense', percent: .12, enabled: true },
    { kind: 'modifyStat', stat: 'defense', flat: 20 }],
};

function saveDCs(stat, dc) {
  const { state, actor } = setup([{ id: 'v12_save', trigger: 'on_hit', target: 'hitTarget', roll: { save: 'spi', dc }, effects: [{ kind: 'grantStatus', statusId: 'stun' }] }]);
  actor.stats.spi = stat;
  state.skills.v12_check = { name: '动态豁免', ap: 1, slot: 'action', range: 2, shape: 'single', target: 'enemy', save: 'spi', saveDC: dc, effects: [] };
  actor.skills.push('v12_check');
  validateState(state);
  const skill = { ...strike, type: 'skill', skillId: 'v12_check' };
  return [preview(state, skill).targets[0].saveDC, applyAction(state, strike).find(log => log.type === 'save').detail.saveDC,
    applyAction(state, skill).find(log => log.type === 'save').detail.saveDC];
}

test('G69/G70 dynamic save DC across skill preview, DSL and skill resolution', () => {
  const spirit10 = saveDCs(10, formula), spirit20 = saveDCs(20, formula);
  assert.deepEqual(spirit10, [11, 11, 11]);
  assert.deepEqual(spirit20, [16, 16, 16]);
  assert.deepEqual(saveDCs(11, formula), [11.5, 11.5, 11.5]);
  const bounds = { base: 20, scaleBy: { stat: 'spi', perUnit: -2 }, min: 4, max: 24 };
  const min = saveDCs(20, bounds), max = saveDCs(-10, bounds);
  assert.deepEqual(min, [4, 4, 4]); assert.deepEqual(max, [24, 24, 24]);
  assert.throws(() => saveDCs(10, { ...formula, min: 60 }), /DSL expression/);
  console.log('G69 PASS', JSON.stringify({ spirit10, spirit20 }));
  console.log('G70 PASS', JSON.stringify({ min, max }));
});

test('G71–G73 status expiry from damage, filtering, arrays and patched instances', () => {
  const cases = [
    { gate: 71, rule: laugh.expireOn, expected: 'on_damaged' },
    { gate: 72, rule: laugh.expireOn, zone: true, expected: null },
    { gate: 73, rule: [laugh.expireOn, { trigger: 'on_turn_start' }], zone: true, expected: 'on_turn_start' },
    { gate: 72, rule: { trigger: 'on_damaged', damageType: 'indirect' }, zone: true, expected: 'on_damaged' },
  ];
  for (const { gate, rule, zone, expected } of cases) {
    const { state, actor, enemy } = setup();
    state.statusTemplates = { [laugh.id]: structuredClone(laugh) };
    grantStatus(state, enemy, laugh.id);
    patchStatus(state, enemy.id, laugh.id, { expireOn: rule });
    grantStatus(state, enemy, laugh.id);
    assert.deepEqual(enemy.statuses[laugh.id].expireOn, rule);
    assert.throws(() => patchStatus(state, enemy.id, laugh.id, { expireOn: { trigger: 'on_heal', damageType: 'direct' } }), /expireOn/);
    validateState(state);
    if (zone) {
      state.zones = { field: { id: 'field', name: '环境伤害', x: enemy.x, y: enemy.y, radius: 0, team: 'all', damage: 5, damageType: 'true', remainingTurns: 2 } };
      state.order = [actor.id, enemy.id, ...state.order.filter(id => id !== actor.id && id !== enemy.id)];
      applyAction(state, { type: 'end' });
      assert.ok(state.logs.some(log => log.type === 'damage' && log.detail.targetId === enemy.id));
    } else applyAction(state, strike);
    const log = state.logs.find(log => log.type === 'expire' && log.detail.statusId === laugh.id && log.detail.trigger);
    assert.equal(log?.detail.trigger ?? null, expected);
    if (gate === 71) assert.equal(log.detail.direct, true);
    if (expected == null) {
      assert.ok(state.logs.some(log => log.type === 'skip' && log.actor === enemy.id));
    } else {
      assert.equal(enemy.statuses[laugh.id], undefined);
      if (zone && expected === 'on_damaged') {
        assert.equal(log.detail.direct, false);
        assert.equal(state.logs.some(log => log.type === 'skip' && log.actor === enemy.id), false);
      }
    }
    console.log(`G${gate} PASS`, JSON.stringify(log?.detail ?? { interrupted: false }));
  }
});

function verifyOath() {
  let { state, actor, enemy } = setup([oath]);
  const ally = Object.values(state.units).find(unit => unit.team === actor.team && unit !== actor);
  assert.ok(ally);
  Object.assign(ally, { x: 2, y: 2 });
  state.grid[2][2] = { kind: 'floor', z: state.grid[actor.y][actor.x].z };
  state.grid[2][3] = { kind: 'floor', z: state.grid[actor.y][actor.x].z };
  const attackerTurn = state.order.indexOf(enemy.id);
  const knightTurn = state.order.indexOf(actor.id);
  actor.armor = 100;
  grantStatus(state, actor, 'guard');
  const armor = () => {
    state.turn = attackerTurn;
    state.units[enemy.id].ap = 2;
    state.units[enemy.id].used = { attack: 0, action: 0 };
    const attackAlly = { type: 'attack', x: ally.x, y: ally.y };
    const profile = preview(state, attackAlly);
    const trial = structuredClone(state);
    const enemyTemplate = trial.equipment[trial.items[enemy.mainHand ?? enemy.weapon].templateId];
    enemyTemplate.effects.push({ id: 'v12_assured_interception', trigger: 'passive', target: 'self', effects: [{ kind: 'forceOutcome', mode: 'hit' }] });
    const damage = applyAction(trial, attackAlly).find(log => log.type === 'damage' && log.detail.targetId === actor.id);
    state.turn = knightTurn;
    assert.ok(profile.ok, JSON.stringify(profile));
    assert.equal(profile.targets[0].recipientId, actor.id);
    assert.equal(damage?.detail.armor, profile.targets[0].armor);
    return damage.detail.armor;
  };
  validateState(state);
  const node = '/equipment/v12_weapon/effects/1/effects';
  const replace = (path, value) => { state = validateState(applyPatch(state, [{ op: 'replace', path, value }])); };
  const explicit = armor();
  replace(`${node}/0/enabled`, false);
  const disabled = armor();
  replace(`${node}/1`, { ...oath.effects[1], enabled: false });
  const baseline = armor();
  assert.ok(disabled > baseline, 'the independent flat bonus still applies');
  const { enabled, ...defaultNode } = oath.effects[0];
  replace(`${node}/0`, defaultNode);
  const omitted = armor();
  assert.ok(omitted > baseline);
  assert.ok(Math.abs((explicit - disabled) - (omitted - baseline) - (disabled - baseline) * .12) < 1e-9);
  replace(`${node}/0/enabled`, true);
  const restored = armor();
  assert.equal(restored, omitted);
  replace(`${node}/0/enabled`, false);
  const afterReplace = armor();
  assert.equal(afterReplace, baseline);
  console.log('G74 PASS', JSON.stringify({ explicit, disabled, baseline }));
  console.log('G75 PASS', JSON.stringify({ omitted, restored, afterReplace }));
}

test('G74/G75 node switch preserves siblings and applies replace immediately', verifyOath);

test('grantStatus node overrides template expiry and excludes self-sourced healing', () => {
  const rule = { trigger: 'on_heal', exceptSource: 'self' };
  const { state, actor, enemy } = setup([{ id: 'v12_expiry', trigger: 'on_hit', target: 'hitTarget', effects: [
    { kind: 'chainEffect', enabled: false, effects: [{ kind: 'grantStatus', statusId: 'stun' }] },
    { kind: 'grantStatus', statusId: laugh.id, expireOn: rule },
  ] }]);
  state.statusTemplates = { [laugh.id]: laugh };
  const addHeal = (id, target) => {
    state.skills[id] = { name: id, ap: 1, slot: 'action', range: 3, shape: 'single', target, effects: [], heal: { count: 1, sides: 4 } };
  };
  addHeal('self_mend', 'self');
  addHeal('other_mend', 'any');
  enemy.skills.push('self_mend');
  actor.skills.push('other_mend');
  validateState(state);
  applyAction(state, strike);
  assert.deepEqual(enemy.statuses[laugh.id].expireOn, rule);
  assert.equal(enemy.statuses.stun, undefined);
  patchStatus(state, enemy.id, laugh.id, { skip: false });
  state.turn = state.order.indexOf(enemy.id);
  enemy.ap = 2; enemy.used = { attack: 0, action: 0 };
  assert.ok(applyAction(state, { type: 'skill', skillId: 'self_mend', x: enemy.x, y: enemy.y }).some(log => log.type === 'heal' && log.detail.amount > 0));
  assert.ok(enemy.statuses[laugh.id]);
  state.turn = state.order.indexOf(actor.id);
  actor.ap = 2; actor.used.action = 0;
  const expiry = applyAction(state, { ...strike, type: 'skill', skillId: 'other_mend' }).find(log => log.type === 'expire' && log.detail.statusId === laugh.id);
  assert.equal(expiry?.detail.trigger, 'on_heal');
  assert.equal(enemy.statuses[laugh.id], undefined);
});
