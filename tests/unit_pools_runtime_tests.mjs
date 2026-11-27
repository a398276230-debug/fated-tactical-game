import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equipmentTemplate, statusTemplate, validateState, zoneValue } from '../src/api/validation.js';
import { createGameAPI } from '../src/api/game_api.js';
import { applyCommand } from '../src/api/commands.js';
import { applyAction, preview } from '../src/core/combat.js';
import { evaluateExpr } from '../src/core/formula.js';
import { getPool, updatePoolCurrent, updatePoolMax } from '../src/core/vm-pools.js';
import { commitVMEffect, initializeVMWorld, vmHost } from '../src/core/vm-runtime.js';
import { newEvent, startVM, stepVM } from '../src/core/tactical-vm.js';
import { aggregateModifiers } from '../src/core/vm-carriers.js';
import { EVENT_SCALAR_KEYS, validVmRule } from '../src/core/vm-schema.js';
import { selectVM } from '../src/core/vm-select.js';
import { battleReportToMvuPatch } from '../src/tavern/converter-patch.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { normalizationPath } from '../src/tavern/normalization-batches.js';
import { staticProjection } from '../src/tavern/converter-parse.js';

function fixture() {
  const game = createGameAPI(); game.createBattle('ruins');
  const state = game.getBattleState(), unit = state.units.swordsman;
  const item = state.items[unit.mainHand], equipment = state.equipment[item.templateId];
  state.turn = state.order.indexOf(unit.id);
  unit.ap = 2; unit.used = { attack: 0, action: 0 };
  unit.unitPools = { innate: { cap: 1, initial: 1 } };
  equipment.unitPools = { souls: { cap: 10, initial: 2 } };
  delete equipment.pools.souls;
  delete state.pools[item.pools.souls];
  delete item.pools.souls;
  const skill = state.skills.soul_test = { name: '魂术', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self',
    unitPools: { souls: { cap: 'self.str - self.str + 12' } }, resourceCost: { resource: 'souls', amount: 2 },
    rules: [{ id: 'gain_sp', hook: 'active', program: [{ op: 'resource', target: 'self', pool: 'sp', mode: 'add', amount: 1 }] }] };
  unit.skills.push('soul_test');
  return { state, unit, item, equipment, skill, action: { type: 'skill', skillId: 'soul_test', targetId: unit.id, x: unit.x, y: unit.y } };
}

test('单位池跨载体合并，施放扣费，空池拒绝预览，战后写回 MVU', () => {
  const { state, unit, action, skill } = fixture();
  initializeVMWorld(state); validateState(state);
  const pool = () => getPool(state, unit.id, 'souls');
  assert.deepEqual([pool().max, pool().current], [12, 2]);
  assert.equal(evaluateExpr('self.resource.souls', { state, self: unit }), 2);
  assert.equal(evaluateExpr('self.resource.not_declared + 1', { state, self: unit }), 1);
  const plan = preview(state, action); assert.ok(plan.ok, plan.error);
  applyAction(state, action);
  assert.equal(pool().current, 0);
  assert.ok(state.logs.some(log => log.type === 'resource' && log.detail.resource === 'souls' && log.detail.amount === 2));
  assert.equal(preview(state, action).error, '自定义资源不足');
  const source = { [unit.id]: { path: ['主角'], counterBindings: { souls: { target: { kind: 'unit_pool', poolKey: 'souls' }, current: 2, format: { kind: 'field_number' }, mvuPath: ['主角','魂量'] } } } };
  assert.deepEqual(battleReportToMvuPatch(state, source).filter(op => op.path.endsWith('/魂量')), [{ op: 'replace', path: '/stat_data/主角/魂量', value: 0 }]);
  updatePoolMax(state, pool().id, 'set_max', 8);
  initializeVMWorld(state);
  assert.deepEqual([pool().max, pool().current], [8, 0]);
  skill.unitPools.souls = { cap: 14, initial: 10 };
  initializeVMWorld(state); validateState(state);
  assert.deepEqual([pool().max, pool().current], [14, 0]);
});

test('真实 MVU 资源池自动识别、开场同步、写回与静态指纹脱敏', () => {
  const mvu = { 主角: { 属性: { 力量: 5, 敏捷: 5, 体质: 5, 智力: 5, 精神: 5 },
    资源: { 剑意: { 当前: 7, 上限: 10 }, 魂量: 3 }, 灵魂计数: 4, 灵魂计数上限: 8,
    标签: ['灵魂计数：2', '品质：稀有'] } };
  const input = { mvu, battleInit: 'battle|1|pool-fixture|池测试|flat\nunit|p1|blue|mvu:主角|主角|1,1' };
  const hydrated = hydrateFromSources(input, { throwOnValidation: true });
  const unit = hydrated.state.units.p1;
  assert.deepEqual(Object.keys(unit.unitPools).sort(), ['souls', 'souls_2', 'souls_3', 'sword_intent']);
  assert.equal(hydrated.sourceMap.p1.counterBindings.filter(binding => binding.ownerKind === 'unit').length, 4);
  const bindings = Object.fromEntries(hydrated.sourceMap.p1.counterBindings.map(binding => [binding.poolKey, binding]));
  assert.deepEqual([bindings.sword_intent.current, bindings.sword_intent.max, bindings.sword_intent.mvuPath], [7, 10, ['主角', '资源', '剑意', '当前']]);
  assert.deepEqual([bindings.souls.current, bindings.souls.max, bindings.souls.mvuPath], [3, null, ['主角', '资源', '魂量', 'current']]);
  assert.deepEqual(bindings.souls_2.mvuPath, ['主角', '灵魂计数']);
  assert.deepEqual(bindings.souls_3.mvuPath, ['主角', '标签', 0]);
  assert.equal(getPool(hydrated.state, 'p1', 'sword_intent').current, 7);
  assert.equal(getPool(hydrated.state, 'p1', 'souls').current, 3);
  assert.equal(getPool(hydrated.state, 'p1', 'souls_2').current, 4);
  assert.deepEqual(battleReportToMvuPatch(hydrated.state, hydrated.sourceMap).filter(operation => operation.path.includes('/资源/剑意')), []);
  updatePoolMax(hydrated.state, getPool(hydrated.state, 'p1', 'sword_intent').id, 'set_max', 12);
  assert.deepEqual(staticProjection(mvu.主角).资源, { 剑意: { 当前: '<DYNAMIC>', 上限: 10 }, 魂量: '<DYNAMIC>' });
  assert.deepEqual(staticProjection({ unitPools: { souls: { cap: 10, initial: 4, current: 3 } } }), { unitPools: { souls: { cap: 10, initial: '<DYNAMIC>', current: '<DYNAMIC>' } } });
  assert.equal(staticProjection({ 灵魂计数: 4, 灵魂计数上限: 8 }).灵魂计数, '<DYNAMIC>');
});

test('持有装备实例池支持公式，扣费优先于同名单位池', () => {
  const { state, unit, item, equipment, action } = fixture();
  equipment.pools = { ...equipment.pools, souls: { cap: 'self.resource.souls + 2', initial: 'self.resource.souls' } };
  initializeVMWorld(state);
  const itemPool = () => getPool(state, item.id, 'souls', 'item');
  assert.deepEqual([itemPool().max, itemPool().current], [4, 2]);
  assert.ok(preview(state, action).ok); applyAction(state, action);
  assert.equal(itemPool().current, 0);
  assert.equal(getPool(state, unit.id, 'souls').current, 2);
  assert.equal(preview(state, action).error, '装备资源不足');
});

test('沙盒增援命令在返回前建立单位和技能声明的池', () => {
  const { state, unit } = fixture();
  const { pools, ...reserve } = structuredClone(unit);
  Object.assign(reserve, { id: 'reserve', ap: 0, used: { action: 0, attack: 0 }, weapon: null, mainHand: null });
  applyCommand(state, { type: 'spawn_unit', unit: reserve });
  assert.equal(getPool(state, 'reserve', 'hp').current, reserve.hp);
  assert.equal(getPool(state, 'reserve', 'innate').current, 1);
  assert.equal(getPool(state, 'reserve', 'souls').max, 12);
});

test('资源池声明封闭校验：拒绝非法数值、状态模板、战场区域及其标准化补丁', () => {
  for (const definition of [{ cap: -1 }, { cap: 1, initial: 2 }, { cap: 1, reloadable: true }, { cap: 1, name: 'x'.repeat(101) }]) {
    assert.throws(() => equipmentTemplate({ name: '装备', unitPools: { souls: definition } }));
  }
  const unitPools = { souls: { name: '灵魂', cap: 1 } };
  assert.throws(() => statusTemplate({ id: 'soul', name: '灵魂', unitPools }), /不能声明单位池/);
  for (const sourceId of [null, 'swordsman']) {
    assert.throws(() => zoneValue({ id: 'zone', name: '环境', area: { shape: 'board' }, sourceId,
      follow: false, persistent: true, remainingTurns: 1, unitPools }, 'zone'), /不能声明单位池/);
  }
  assert.ok(!normalizationPath.test('/zones/zone/unitPools/souls'));
});

test('提交规则与修饰器共享技能、装备、事件标签和资源读取', () => {
  const { state, unit, item, equipment, skill } = fixture();
  equipment.pools.ammo = { cap: 6, initial: 2 };
  equipment.tags = ['steel'];
  delete item.tags;
  skill.tags = ['fire'];
  skill.range = 3;
  const tagged = "has_tag(skill, 'fire') && has_tag(event, 'strike')";
  skill.mods = [{ stat: 'checkBonus', flat: "count('units') + sum('units', candidate.hp) + weapon.range + skill.range", when: tagged }];
  initializeVMWorld(state);
  const event = { tags: ['strike'], actorId: unit.id, targetId: unit.id, weaponId: item.id };
  assert.equal(aggregateModifiers(state, unit.id, event).stats.checkBonus.flat,
    Object.values(state.units).reduce((sum, u) => sum + u.hp + 1, 0) + equipment.range + 3);
  for (const [carrier, condition, value, expected] of [
    [{ type: 'skill', id: 'soul_test', ownerId: unit.id }, tagged, 'skill.range + weapon.attack', 3 + equipment.attack],
    [{ type: 'item', id: item.id }, "has_tag(item, 'steel')", 'item.resource.ammo + weapon.range', 2 + equipment.range],
  ]) {
    const eventRef = newEvent(state, event);
    startVM(state, { ownerId: unit.id, sourceId: unit.id, carrier, eventRef, program: [
      { op: 'if', cond: condition, then: [{ op: 'resource', target: 'self', pool: 'hp', mode: 'set', amount: value }] },
    ] });
    stepVM(state, vmHost);
    assert.equal(unit.hp, expected);
  }
});

test('新增事件标量均通过规则校验，格点与掩体选择器读出标量', () => {
  for (const key of ['mpCost', 'spCost', 'hpCost', 'apCost', 'slot', 'poolCost', 'poolCostId', 'itemId', 'centerX', 'centerY', 'category', 'tier', 'roll', 'total', 'previous']) {
    assert.ok(EVENT_SCALAR_KEYS.includes(key), key);
    assert.ok(validVmRule({ id: 'scalar', hook: 'after_check', filter: `event.${key} != null`, program: [] }), key);
  }
  const { state } = fixture();
  assert.deepEqual(selectVM(state, { from: 'cells', where: "candidate.terrain == 'wall'" }).map(({ x, y }) => [x, y]),
    state.grid.flatMap((row, y) => row.flatMap(({ kind }, x) => kind === 'wall' ? [[x, y]] : [])));
  assert.ok(selectVM(state, { from: 'covers', where: 'candidate.material != null && candidate.cover > 0' }).length);
});

function restoreFixture() {
  const { state, unit, item, equipment } = fixture();
  equipment.pools.ammo = { cap: 6, initial: 1, reloadable: true };
  equipment.pools.charges = { cap: 6, initial: 5 };
  initializeVMWorld(state);
  const pool = key => getPool(state, unit.id, key);
  const set = (key, amount) => updatePoolCurrent(state, pool(key).id, 'set', amount);
  const commit = data => commitVMEffect(state, { sourceId: unit.id, targetId: unit.id, minRemain: 0, ...data });
  const resource = (pool, mode, amount) => commit({ op: 'resource', pool, mode, amount });
  const swap = (pool, otherPool) => commit({ op: 'resource', pool, otherPool, mode: 'swap', amount: 0 });
  return { state, unit, item, pool, set, commit, resource, swap };
}

const restoreBlock = { flags: ['blockResourceRestore'] };

test('治疗在 before_commit 之后检查恢复禁令，after_heal 读到落盘前余额与实际恢复量', () => {
  const { state, unit, pool, set, commit } = restoreFixture();
  set('hp', 10);
  state.statusTemplates.no_restore = { id: 'no_restore', name: '禁止资源恢复', mods: [restoreBlock] };
  unit.rules = [
    { id: 'before_heal_commit', hook: 'before_commit', filter: "event.commitKind == 'heal'", usesPerBattle: 1, program: [
      { op: 'resource', target: 'self', pool: 'hp', mode: 'sub', amount: 2 },
      { op: 'apply_status', target: 'self', statusId: 'no_restore', turns: 2 },
    ] },
    { id: 'observe_heal', hook: 'after_heal', filter: 'event.previous == 8', program: [
      { op: 'let', scope: 'owner', name: 'hpBeforeHeal', value: 'event.previous' },
      { op: 'let', scope: 'owner', name: 'actualHeal', value: 'event.healing' },
    ] },
  ];
  validateState(state);
  commit({ op: 'heal', amount: 4 });
  assert.equal(pool('hp').current, 8);
  assert.equal(unit.hp, 8);
  assert.equal(unit.vars.hpBeforeHeal, 8);
  assert.equal(unit.vars.actualHeal, 0);
  assert.equal(state.logs.findLast(log => log.type === 'heal').detail.amount, 0);
});

test('恢复禁令只截断单位池的正向 add/set，扣减、上限和行动伪池照常结算', () => {
  const { state, unit, pool, set, resource } = restoreFixture();
  unit.mods = [restoreBlock];
  unit.rules = [{ id: 'raise_add', hook: 'before_commit', filter: "event.pool == 'mp' && event.rawAmount == 0", usesPerBattle: 1,
    program: [{ op: 'mutate_event', patch: { finalAmount: 3 } }] }];
  set('hp', 10);
  set('mp', 5);
  set('sp', 5);
  resource('mp', 'add', 0);
  resource('sp', 'set', 8);
  resource('souls', 'add', 3);
  resource('hp', 'set', 20);
  assert.deepEqual(['hp', 'mp', 'sp', 'souls'].map(key => pool(key).current), [10, 5, 5, 2]);

  resource('mp', 'add', -2);
  resource('sp', 'set', 2);
  resource('souls', 'sub', 1);
  assert.deepEqual(['mp', 'sp', 'souls'].map(key => pool(key).current), [3, 2, 1]);
  const mpMax = pool('mp').max;
  resource('mp', 'add_max', 5);
  assert.equal(pool('mp').max, mpMax + 5);
  resource('mp', 'sub_max', 3);
  assert.equal(pool('mp').max, mpMax + 2);
  resource('mp', 'set_max', 2);
  assert.deepEqual([pool('mp').max, pool('mp').current], [2, 2]);

  unit.used = { attack: 1, action: 1 };
  unit.ap = 0;
  resource('attack', 'add', 1);
  resource('action', 'set', 1);
  resource('move', 'sub', 1);
  assert.equal(unit.moveSpentPermille, 1000);
  resource('move', 'add', 1);
  assert.equal(unit.moveSpentPermille, undefined);
  assert.deepEqual([unit.used.attack, unit.used.action, unit.ap], [0, 0, 2]);

  delete unit.mods;
  resource('souls', 'add', 3);
  assert.equal(pool('souls').current, 4);
});

test('交换只截断受限单位上升的一侧，顺序不影响结果，装备本地池仍可交换和恢复', () => {
  const { state, unit, item, pool, set, swap } = restoreFixture();
  unit.mods = [restoreBlock];
  for (const [first, second] of [['mp', 'sp'], ['sp', 'mp']]) {
    set('mp', 3);
    set('sp', 9);
    swap(first, second);
    assert.deepEqual([pool('mp').current, pool('sp').current], [3, 3], `${first} -> ${second}`);
  }

  const localResource = data => ({ op: 'resource', target: 'self', local: true, ...data });
  startVM(state, { ownerId: unit.id, sourceId: unit.id, carrier: { type: 'item', id: item.id }, program: [
    localResource({ pool: 'ammo', mode: 'swap', otherPool: 'charges' }),
    localResource({ pool: 'ammo', mode: 'add', amount: 1 }),
    localResource({ pool: 'charges', mode: 'set', amount: 4 }),
  ] });
  stepVM(state, vmHost);
  assert.deepEqual(['ammo', 'charges'].map(key => getPool(state, item.id, key, 'item').current), [6, 4]);

  delete unit.mods;
  set('sp', 9);
  swap('mp', 'sp');
  assert.deepEqual([pool('mp').current, pool('sp').current], [9, 3]);
});

test('截断交换的正向恢复后，另一侧 HP 降至 0 仍触发死亡', () => {
  for (const [first, second] of [['hp', 'mp'], ['mp', 'hp']]) {
    const { unit, set, swap } = restoreFixture();
    unit.mods = [restoreBlock];
    set('hp', 10);
    set('mp', 0);
    swap(first, second);
    assert.equal(unit.mp, 0);
    assert.equal(unit.hp, 0);
    assert.ok(unit.diedAt, `${first} -> ${second}`);
  }
});

test('恢复禁令不阻止 preventDeath 或 revive', () => {
  const { state, unit, set, commit } = restoreFixture();
  unit.mods = [restoreBlock];
  set('hp', 10);
  unit.rules = [{ id: 'prevent_death', hook: 'on_lethal_p2', usesPerBattle: 1,
    program: [{ op: 'mutate_event', patch: { preventDeath: true } }] }];
  unit.rules.push({ id: 'try_heal', hook: 'on_lethal_p1', program: [{ op: 'heal', target: 'self', amount: 5 }] });
  const lethal = () => commit({ op: 'damage', amount: 10, damageType: 'true' });
  lethal();
  assert.equal(unit.hp, 1);
  assert.equal(unit.diedAt, undefined);
  lethal();
  assert.equal(unit.hp, 0);
  assert.ok(unit.diedAt);

  const ally = Object.values(state.units).find(candidate => candidate.team === unit.team && candidate !== unit);
  startVM(state, { ownerId: ally.id, sourceId: ally.id, scope: { target: { type: 'unit', id: unit.id } },
    program: [{ op: 'revive', target: 'target', hpFlat: 5, mpPercent: 0.5, spPercent: 0.5 }] });
  stepVM(state, vmHost);
  assert.equal(unit.hp, 5);
  assert.equal(unit.mp, unit.maxMp * 0.5);
  assert.equal(unit.sp, unit.maxSp * 0.5);
  assert.equal(unit.diedAt, undefined);
});
