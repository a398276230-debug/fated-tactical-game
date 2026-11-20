import { expression as fx } from '../src/core/effects.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit, preview, refreshOpeningInitiative, stealthCheck, syncEquipmentEffects } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { rollD20 } from '../src/core/rng.js';
import { applyPatch } from '../src/tavern/overlay.js';

const attack = { type: 'attack', x: 3, y: 2 };
const shotSeed = value => {
  for (let i = 1; i < 1000; i++) if (rollD20(i * 100003).value === value) return i * 100003;
  throw new Error('missing test seed');
};
function battle() {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  const weapon = { ...state.equipment[state.items[actor.weapon].templateId], range: 2 };
  state.equipment.test_weapon = weapon;
  state.items[actor.weapon].templateId = 'test_weapon';
  Object.assign(target, { hp: 1000, maxHp: 1000, nonLethal: false, armor: 0 });
  for (const key of Object.keys(target.stats)) target.stats[key] = 0;
  weapon.effects = [fx('fixed', 'passive', 'self', [{ kind: 'modifyDamageBase', value: 20 }])];
  state.items[actor.weapon].counters = {};
  state.statusTemplates = {};
  return { state, actor, target, weapon };
}
function equip({ state, actor }, ...effects) {
  state.equipment.test_gear = { name: '测试装备', effects };
  state.items.test_gear = { id: 'test_gear', templateId: 'test_gear', counters: {} };
  actor.gear.push('test_gear');
}
function template(id, modifiers, extras = {}) {
  return { id, name: id, icon: '◈', category: 'debuff', description: id, remainingTurns: 1, durationType: 'battle_turns', tickTiming: 'onTurnEnd', stackRule: 'refresh', maxStacks: 1, modifiers, ...extras };
}
function skill({ state, actor }, id, effects, fields = {}) {
  state.skills[id] = { name: id, ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self', effects, ...fields };
  actor.skills.push(id);
  return { type: 'skill', skillId: id, x: actor.x, y: actor.y };
}
const pool = fx('soul-pool', 'passive', 'self', [{ kind: 'produceResource', resource: 'soul', cap: 1000000 }]);

test('核心意图独立 +5，远程命中附加 60 物理伤害', () => {
  const b = battle();
  equip(b, fx('core', 'passive', 'self', [{ kind: 'modifyCheck', coreBonus: 5 }]), fx('ranged-bonus', 'on_hit', 'hitTarget', [{ kind: 'damage', flat: 60, damageType: 'physical', strikeBonus: true }], { condition: { type: 'melee', value: false } }));
  b.weapon.range = 6;
  b.weapon.accuracy = 30;
  b.state.rng = shotSeed(10);
  validateState(b.state);
  applyAction(b.state, { ...attack, intent: 'core' });
  const contest = b.state.logs.find(log => log.type === 'intent');
  assert.equal(contest.detail.coreBonus, 5);
  assert.equal(contest.detail.attackerTotal, contest.detail.attackerBase + contest.detail.attackerD20 + contest.detail.ratingBonus + 5);
  const extra = b.state.logs.find(log => log.detail.bonusDamage);
  assert.equal(extra.detail.amount, 60);
  assert.equal(extra.detail.damageType, 'physical');
  validateState(b.state);
});

test('空仓箭矢命中施加补丁注册的灵魂损伤，叠层刷新并实算命中、闪避、攻击', () => {
  const b = battle();
  b.weapon.range = 6;
  b.weapon.effects.push(fx('ammo-pool', 'passive', 'self', [{ kind: 'produceResource', resource: 'ammo', cap: 6, reloadable: true }]));
  b.state.items[b.actor.weapon].counters.ammo = 0;
  equip(b, fx('unlimited', 'on_equip', 'self', [{ kind: 'grantStatus', statusId: 'infinite_ammo' }]), fx('soul-wound', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'soul_wound' }], { condition: { type: 'arrow' } }), fx('arrow-hit', 'passive', 'self', [{ kind: 'forceOutcome', mode: 'hit' }], { condition: { type: 'arrow' } }));
  syncEquipmentEffects(b.state);
  const original = preview(b.state, attack);
  const next = applyPatch(b.state, [{ op: 'add', path: '/statusTemplates/soul_wound', value: template('soul_wound', { accuracy: -2, dodgeBonus: -2, attackPercent: -.1 }, { maxStacks: 5, remainingTurns: 2, stackRule: 'stack' }) }]);
  validateState(next);
  next.rng = shotSeed(1);
  applyAction(next, attack);
  assert.equal(next.items[b.actor.weapon].counters.ammo, 0);
  const injured = next.units[b.target.id];
  assert.equal(injured.statuses.soul_wound.stacks, 1);
  assert.equal(preview(next, attack).accuracy, original.accuracy + 2);
  applyAction(next, attack);
  assert.equal(injured.statuses.soul_wound.stacks, 2);
  assert.equal(injured.statuses.soul_wound.remainingTurns, 2);
  next.turn = next.order.indexOf(injured.id);
  injured.ap = 2;
  injured.x = b.actor.x + 1;
  const retaliation = { type: 'attack', x: b.actor.x, y: b.actor.y };
  const hurt = preview(next, retaliation);
  assert.ok(hurt.ok, hurt.error);
  delete injured.statuses.soul_wound;
  const normal = preview(next, retaliation);
  assert.equal(hurt.accuracy, normal.accuracy - 4);
  assert.equal(hurt.damageMultiplier, normal.damageMultiplier * .8);
  validateState(next);
});

test('斩杀严格低于阈值，奖励随生命阶级增长且立即更新攻击倍率', () => {
  const b = battle();
  b.weapon.effects.push(pool, fx('soul-scale', 'passive', 'self', [{ kind: 'multiplyDamage', additive: true, resourceScale: { resource: 'soul', perUnit: .05 } }]));
  b.state.items[b.actor.weapon].counters.soul = 0;
  skill(b, 'reap', [fx('reap-execute', 'active', 'hitTarget', [{ kind: 'chainEffect', stopOnFailure: true, effects: [{ kind: 'execute', threshold: .25, strict: true, requiresPool: 'soul' }, { kind: 'produceResource', target: 'self', resource: 'soul', targetTierBase: 4 }] }])], { range: 2, target: 'enemy' });
  const reap = { ...attack, type: 'skill', skillId: 'reap' };
  b.target.tier = 3;
  b.target.hp = 250;
  assert.equal(preview(b.state, reap).ok, false);
  b.target.hp--;
  validateState(b.state);
  applyAction(b.state, reap);
  assert.equal(b.target.hp, 0);
  const item = b.state.items[b.actor.weapon];
  assert.equal(item.counters.soul, 16);
  b.target.hp = 1000;
  assert.equal(preview(b.state, attack).damageMultiplier, 1.8);
  validateState(b.state);
});

test('渎神支付十魂、保底命中暴击并乘终伤，回合末续接虚弱且禁止恢复', () => {
  const b = battle();
  b.weapon.effects.push(pool);
  const counters = b.state.items[b.actor.weapon].counters;
  counters.soul = 14;
  b.state.statusTemplates.weak = template('weak', { attributePercent: -.5, blockResourceRestore: true }, { remainingTurns: 5 });
  b.state.statusTemplates.god = template('god', { guaranteed_hit: true, guaranteed_crit: true, finalDamageMultiplier: 2 }, { expireInto: 'weak' });
  const god = skill(b, 'invoke', [fx('god', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'god' }])], { resourceCost: { resource: 'soul', amount: 10 } });
  const heal = skill(b, 'restore', [fx('soul-restore', 'active', 'self', ['hp','mp','sp'].map(resource => ({ kind: 'restoreResource', resource, percentPerCost: .25 })))], { resourceCost: { resource: 'soul', amount: 1 } });
  validateState(b.state);
  applyAction(b.state, god);
  assert.equal(counters.soul, 4);
  b.state.rng = shotSeed(1);
  assert.equal(preview(b.state, attack).critChance, 1);
  applyAction(b.state, attack);
  assert.equal(b.state.logs.find(log => log.type === 'roll').detail.critical, true);
  assert.equal(b.state.logs.find(log => log.type === 'damage').detail.amount, 52);
  if (currentUnit(b.state) === b.actor) applyAction(b.state, { type: 'end' });
  assert.equal(b.actor.statuses.god, undefined);
  assert.equal(b.actor.statuses.weak.remainingTurns, 5);
  b.state.turn = b.state.order.indexOf(b.actor.id);
  b.actor.ap = 2;
  assert.match(preview(b.state, heal).error, /禁止/);
  assert.equal(counters.soul, 4);
  delete b.actor.statuses.weak;
  Object.assign(b.actor, { hp: 1, mp: 0, sp: 0 });
  applyAction(b.state, heal);
  assert.equal(counters.soul, 3);
  assert.equal(b.actor.hp, 1 + Math.floor(b.actor.maxHp * .25));
  assert.equal(b.actor.mp, Math.floor(b.actor.maxMp * .25));
  assert.equal(b.actor.sp, Math.floor(b.actor.maxSp * .25));
  validateState(b.state);
});

test('先攻、潜行和成长读取装备，命中升阶保留自然 1 失手', () => {
  const b = battle();
  const initial = b.state.logs[0].detail.initiative.find(row => row.unitId === b.actor.id);
  equip(b, fx('checks', 'passive', 'self', [{ kind: 'modifyCheck', iniBonus: 2, initiativeAgility: 2, dodgeAgility: 2, stealthBonus: 3 }]), fx('attribute-growth', 'passive', 'self', ['str','agi','con','int','spi'].map(stat => ({ kind: 'modifyStat', stat, percent: 1, levelScaling: { min: .25, max: 1 } }))));
  refreshOpeningInitiative(b.state);
  const updated = b.state.logs[0].detail.initiative.find(row => row.unitId === b.actor.id);
  assert.equal(updated.roll, initial.roll);
  assert.equal(updated.agility, initial.agility * 1.25 + 2);
  assert.equal(updated.flatInit, initial.flatInit + 2);
  assert.deepEqual(stealthCheck(b.state, b.actor, 7, 10), { total: 10, bonus: 3, success: true });
  b.weapon.effects.push(fx('attack-growth', 'passive', 'self', [{ kind: 'modifyStat', stat: 'damage', percent: 1, levelScaling: { min: .25, max: 1 } }]), fx('upgrade', 'passive', 'self', [{ kind: 'upgradeHitTier' }]));
  b.actor.tier = 7;
  assert.equal(preview(b.state, attack).damageMultiplier, 2);
  b.state.rng = shotSeed(1);
  applyAction(b.state, attack);
  assert.equal(b.state.logs.find(log => log.type === 'roll').detail.hit, false);
  b.state.rng = shotSeed(10);
  applyAction(b.state, attack);
  const hit = b.state.logs.filter(log => log.type === 'roll').at(-1).detail;
  assert.equal(hit.rating.multiplier, 1.6);
  validateState(b.state);
});
