import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equipmentTemplate, statusTemplate, validateState, zoneValue } from '../src/api/validation.js';
import { createGameAPI } from '../src/api/game_api.js';
import { applyCommand } from '../src/api/commands.js';
import { applyAction, preview } from '../src/core/combat.js';
import { evaluateExpr } from '../src/core/formula.js';
import { getPool, updatePoolMax } from '../src/core/vm-pools.js';
import { initializeVMWorld } from '../src/core/vm-runtime.js';
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
