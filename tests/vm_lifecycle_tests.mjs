import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { skillTemplate, statusTemplate, validateState, zoneValue } from '../src/api/validation.js';
import { applyAction } from '../src/core/combat.js';
import { validVmOpcode } from '../src/core/vm-schema.js';
import { startVM, stepVM } from '../src/core/tactical-vm.js';
import { commitVMEffect, resolveVMAction, vmHost } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';

const statusOp = (statusId, target = 'self', fields = {}) => ({ op: 'apply_status', target, statusId, ...fields });
const zoneOp = (name, fields = {}) => ({ op: 'spawn', entityKind: 'zone', spec: { name, area: { shape: 'single' }, persistent: true, ...fields } });
const summonOp = (fields = {}) => ({ op: 'spawn', entityKind: 'unit', spec: { templateId: 'spirit', turnMode: 'none', ...fields } });
const rule = (id, hook, program, filter) => ({ id, hook, program, ...(filter && { filter }) });
const summonIds = state => Object.keys(state.units).filter(id => state.units[id].summoned);
const zones = state => Object.values(state.zones);

function fixture() {
  const state = buildScenario('ruins');
  const units = Object.values(state.units);
  const caster = units.find(u => u.team === 'blue');
  const enemy = units.find(u => u.team === 'red');
  const ally = units.find(u => u.team === 'blue' && u !== caster);
  state.order = [caster.id, ...state.order.filter(id => id !== caster.id)];
  state.turn = 0;
  caster.ap = 2;
  caster.used = { attack: 0, action: 0 };
  state.covers = {};
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  // Start the caster at the edge so a real flee action is legal.
  Object.assign(caster, { x: 0, y: 0 });
  Object.assign(enemy, { x: 1, y: 0 });
  Object.assign(ally, { x: 1, y: 1 });
  state.statusTemplates = { ...state.statusTemplates, first: { id: 'first', name: '第一专注', durationType: 'persistent' },
    second: { id: 'second', name: '第二专注', durationType: 'persistent' }, unbound: { id: 'unbound', name: '不绑定', concentration: false, bindToSource: false },
    bound: { id: 'bound', name: '来源绑定', bindToSource: true, durationType: 'persistent' },
    locked: { id: 'locked', name: '完全失能', mods: [{ locks: ['attack', 'action', 'move', 'cast'] }] },
    partial: { id: 'partial', name: '部分失能', mods: [{ locks: ['attack', 'action', 'move'] }] } };
  state.summonTemplates = { spirit: { name: '灵体', tier: 1, stats: { str: 1, agi: 1, con: 1, int: 1, spi: 1 }, bindToSource: true } };
  const defineSkill = (id, program, fields = {}) => {
    caster.skills.push(id);
    state.skills[id] = { name: id, ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', ...fields,
      rules: [rule(id, 'active', program)] };
  };
  const cast = id => resolveVMAction(state, { type: 'skill', skillId: id, x: caster.x, y: caster.y }, { actor: caster });
  const run = (source, program, target = source) => {
    startVM(state, { ownerId: source.id, sourceId: source.id, scope: { target: { type: 'unit', id: target.id } }, program });
    stepVM(state, vmHost);
  };
  const damage = amount => commitVMEffect(state, { op: 'damage', sourceId: enemy.id, targetId: caster.id, amount, damageType: 'true' });
  return { state, caster, enemy, ally, defineSkill, cast, run, damage };
}

function assertNoLifecycle(entity) {
  for (const key of ['bindToSource', 'concentration', 'concentrationRef']) assert.equal(Object.hasOwn(entity, key), false, key);
}

function installFocus(fx) {
  const { defineSkill, cast } = fx;
  defineSkill('focus', [statusOp('first'), zoneOp('专注区域'), summonOp()], { concentration: true });
  cast('focus');
}

test('D.2 lifecycle flags are closed booleans, with references allowed only on applicable records', () => {
  const fx = fixture();
  const schemaOptions = { statusTemplates: fx.state.statusTemplates };
  for (const op of [statusOp('first', 'self', { bindToSource: false, concentration: true }),
    zoneOp('区域', { bindToSource: true, concentration: false }), summonOp({ bindToSource: true, concentration: true })]) {
    assert.equal(validVmOpcode(op, schemaOptions), true);
    const badFlag = structuredClone(op);
    (badFlag.spec ?? badFlag).concentration = 'true';
    assert.equal(validVmOpcode(badFlag, schemaOptions), false);
    const badRef = structuredClone(op);
    (badRef.spec ?? badRef).concentrationRef = 'init';
    assert.equal(validVmOpcode(badRef, schemaOptions), false);
  }
  assert.equal(validVmOpcode({ op: 'spawn', entityKind: 'item', spec: { templateId: 'item', bindToSource: true } }), false);
  assert.throws(() => statusTemplate({ id: 'first', name: '无效', concentration: 1 }));
  assert.throws(() => skillTemplate({ name: '无效', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', bindToSource: 'true' }));
  installFocus(fx);
  validateState(fx.state);
  const area = zones(fx.state)[0];
  assert.throws(() => zoneValue({ ...area, concentrationRef: 1 }, area.id, fx.state));
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state: fx.state });
  const snapshot = JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
  const restored = createGameAPI();
  restored.createBattle(snapshot);
  assert.equal(snapshot.version, 11);
  assert.deepEqual(restored.exportBattleSnapshot(), snapshot);
});

test('D.2 active defaults share an action reference across targets, carriers and nested branches', () => {
  const { state, caster, enemy, ally, defineSkill, cast } = fixture();
  defineSkill('group_focus', [{ op: 'for_each', select: { from: 'units', where: `candidate.id == '${enemy.id}' || candidate.id == '${ally.id}'` },
    body: [{ op: 'check', kind: 'chance', dc: 100, onPass: [statusOp('first', 'target')] }] }, zoneOp('集中'), summonOp({ count: 2 }),
  statusOp('unbound', 'self', { bindToSource: false, concentration: false }), zoneOp('独立区域', { bindToSource: false, concentration: false }),
  summonOp({ group: 'unbound', bindToSource: false, concentration: false })], { bindToSource: true, concentration: true });
  caster.rules = [rule('side_effect', 'after_action', [zoneOp('旁路区域')])];
  cast('group_focus');
  const [ward, isolated, passive] = zones(state);
  const [first, second, unbound] = summonIds(state).map(id => state.units[id]);
  const batch = [enemy.statuses.first, ally.statuses.first, ward, first, second];
  assert.ok(batch.every(entity => entity?.concentration && entity.bindToSource), JSON.stringify(batch.map(entity => [entity?.id, entity?.concentration, entity?.bindToSource])));
  assert.match(ward.concentrationRef, /^ev/);
  assert.ok(batch.every(entity => entity.concentrationRef === ward.concentrationRef));
  for (const entity of [caster.statuses.unbound, isolated, passive, unbound]) assertNoLifecycle(entity);

  defineSkill('next_focus', [statusOp('second', 'self', { concentration: true })]);
  cast('next_focus');
  assert.notEqual(caster.statuses.second.concentrationRef, ward.concentrationRef);
  assert.ok(!enemy.statuses.first && !ally.statuses.first && !state.zones[ward.id] && !state.units[first.id] && !state.units[second.id]);
  assert.ok(caster.statuses.unbound && state.zones[isolated.id] && state.units[unbound.id]);
  assert.equal(state.logs.filter(log => log.detail.reason === '切换专注').length, 5);
  validateState(state);
});

test('D.2 damage save uses actual HP loss, the ordinary check hooks and per-stat resist bonus', () => {
  const fx = fixture();
  const { state, caster, damage } = fx;
  installFocus(fx);
  const maximum = caster.maxHp;
  const amount = Math.ceil(maximum / 2);
  caster.mods = [{ stat: 'resistBonus', flat: 30, checkKind: 'concentration', when: "event.stat == 'spi'" }];
  const concentration = "has_tag(event, 'concentration')";
  caster.rules = [rule('more_difficult', 'before_check', [{ op: 'mutate_event', patch: { dcDelta: 1 } }], concentration),
    rule('fixed_roll', 'after_natural_roll', [{ op: 'mutate_event', patch: { replaceNaturalRoll: 3 } }], concentration)];
  damage(0);
  assert.equal(state.logs.filter(log => log.type === 'save').length, 0);
  damage(amount);
  const save = state.logs.findLast(log => log.type === 'save');
  assert.equal(save.actor, caster.id);
  assert.equal(save.detail.mode, 'any');
  assert.equal(save.detail.saved, true);
  assert.deepEqual(save.detail.checks.map(row => [row.saveStat, row.saveRoll, row.saveBonus, row.saveDC, row.saved]), [
    ['con', 3, caster.stats.con, 21, false], ['spi', 3, caster.stats.spi + 30, 21, true],
  ]);
  assert.ok(caster.statuses.first);

  caster.mods = [];
  damage(1);
  assert.equal(state.logs.findLast(log => log.type === 'save').detail.saved, false);
  assert.deepEqual([Boolean(caster.statuses.first), zones(state).map(zone => [zone.name, zone.concentration]), summonIds(state).map(id => [id, state.units[id].concentration])], [false, [], []]);
  assert.equal(state.logs.filter(log => log.detail.reason === '受创豁免失败，专注中断').length, 3);
});

test('D.2 a pending concentration save survives v11 snapshot restore and replays exactly', () => {
  const fx = fixture();
  const { state, caster, defineSkill } = fx;
  installFocus(fx);
  defineSkill('self_damage', [{ op: 'damage', target: 'self', amount: 1, damageType: 'true' }]);
  caster.rules = [rule('ask_to_hold', 'before_check', [
    { op: 'ask', chooser: 'self', kind: 'option', prompt: '维持专注？', out: 'choice', aiPolicy: 'first',
      options: [{ id: 'drop', label: '松手' }, { id: 'keep', label: '维持' }] },
    { op: 'if', cond: "vars.choice == 'drop'", then: [{ op: 'mutate_event', patch: { forceOutcome: 'fail' } }] },
  ], "has_tag(event, 'concentration')")];
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  const attempt = api.playAction({ type: 'skill', skillId: 'self_damage', x: caster.x, y: caster.y });
  assert.equal(attempt.ok, true, attempt.error);
  const pending = api.getBattleState();
  const ask = pending.vm.pendingAsk;
  assert.equal(ask.chooserId, caster.id);
  assert.ok(pending.units[caster.id].statuses.first);
  validateState(pending);
  const snapshot = JSON.parse(JSON.stringify(api.exportBattleSnapshot()));
  const restored = createGameAPI();
  restored.createBattle(snapshot);
  const answer = { type: 'answer', askId: ask.askId, value: 'drop' };
  assert.equal(api.playAction(answer).ok, true);
  assert.equal(restored.playAction(answer).ok, true);
  assert.deepEqual(restored.exportBattleSnapshot(), api.exportBattleSnapshot());
  const settled = restored.getBattleState();
  assert.equal(settled.logs.findLast(log => log.type === 'save').detail.saved, false);
  assert.ok(!settled.units[caster.id].statuses.first && !zones(settled).length && !summonIds(settled).length);
});

test('D.2 only full incapacitation immediately breaks concentration', () => {
  const fx = fixture();
  const { state, caster, enemy, run } = fx;
  installFocus(fx);
  run(enemy, [statusOp('partial', 'target')], caster);
  assert.ok(caster.statuses.first);
  run(enemy, [statusOp('locked', 'target')], caster);
  assert.ok(caster.statuses.locked && !caster.statuses.first && !zones(state).length && !summonIds(state).length);
  assert.equal(state.logs.filter(log => log.detail.reason === '陷入失能，专注中断').length, 3);
});

test('D.2 death, successful flee and explicit despawn cascade through bound children and run removal hooks', () => {
  for (const exit of ['death', 'flee', 'despawn']) {
    const { state, caster, enemy, ally, run, damage } = fixture();
    const removal = rule('record_removal', 'after_status_removed', [{ op: 'resource', target: 'self', pool: 'mp', mode: 'sub', amount: 1 }],
      "event.reason == '来源离场' && self.id == target.id");
    state.statusTemplates.bound.rules = [removal];
    run(caster, [summonOp(), zoneOp('不绑定的区域'), statusOp('unbound', 'target')], ally);
    const [parentId] = summonIds(state);
    const parent = state.units[parentId];
    run(parent, [summonOp(), statusOp('bound', 'target'), zoneOp('子区', { concentration: true })], ally);
    const childId = summonIds(state).find(id => id !== parentId);
    run(state.units[childId], [zoneOp('孙区', { bindToSource: true })]);
    const mp = ally.mp;
    if (exit === 'death') {
      caster.rules = [rule('survive', 'on_lethal_p1', [{ op: 'resource', target: 'self', pool: 'hp', mode: 'set', amount: 1 }])];
      damage(caster.hp);
      assert.equal(caster.hp, 1);
      assert.ok(state.units[childId] && ally.statuses.bound);
      caster.rules = [];
      damage(caster.hp);
      assert.ok(caster.diedAt);
      assert.equal(state.logs.filter(log => log.type === 'save').length, 0);
    } else if (exit === 'flee') {
      caster.stats.agi = 50;
      for (const unit of Object.values(state.units)) if (unit.team === enemy.team) unit.stats.agi = -20;
      applyAction(state, { type: 'flee' });
      assert.equal(caster.fled, true);
      assert.equal(state.logs.filter(log => log.type === 'flee').length, 1);
    } else {
      run(caster, [{ op: 'despawn', entityKind: 'unit', select: { from: 'units', where: `candidate.id == '${parentId}'` } }]);
    }
    assert.deepEqual(summonIds(state), []);
    assert.deepEqual(zones(state).map(zone => zone.name), ['不绑定的区域']);
    assert.ok(ally.statuses.unbound);
    assert.ok(!ally.statuses.bound);
    assert.equal(ally.mp, mp - 1);
    validateState(state);
  }
});

test('D.2 bound summon with a different duration anchor leaves when that anchor dies', () => {
  const { state, caster, enemy, run } = fixture();
  const anchored = { durationUnit: 'anchor_turns', durationAnchor: 'target', remainingTurns: 5 };
  run(caster, [summonOp({ ...anchored, group: 'bound' }), summonOp({ ...anchored, group: 'unbound', bindToSource: false })], enemy);
  const [bound, unbound] = summonIds(state);
  commitVMEffect(state, { op: 'damage', sourceId: caster.id, targetId: enemy.id, amount: enemy.hp, damageType: 'true' });
  assert.ok(!state.units[bound]);
  assert.equal(state.units[unbound].remainingTurns, 5);
  validateState(state);
});
