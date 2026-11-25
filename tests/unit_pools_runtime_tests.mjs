import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equipmentTemplate, statusTemplate, validateState, zoneValue } from '../src/api/validation.js';
import { createGameAPI } from '../src/api/game_api.js';
import { applyAction, preview } from '../src/core/combat.js';
import { evaluateExpr } from '../src/core/formula.js';
import { getPool, updatePoolMax } from '../src/core/vm-pools.js';
import { initializeVMWorld } from '../src/core/vm-runtime.js';
import { battleReportToMvuPatch } from '../src/tavern/converter-patch.js';
import { normalizationPath } from '../src/tavern/normalization-batches.js';

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

test('资源池声明封闭校验：拒绝非法数值、状态模板、无主区域及其标准化补丁', () => {
  for (const definition of [{ cap: -1 }, { cap: 1, initial: 2 }, { cap: 1, reloadable: true }, { cap: 1, name: 'x'.repeat(101) }]) {
    assert.throws(() => equipmentTemplate({ name: '装备', unitPools: { souls: definition } }));
  }
  const unitPools = { souls: { name: '灵魂', cap: 1 } };
  assert.throws(() => statusTemplate({ id: 'soul', name: '灵魂', unitPools }), /不能声明单位池/);
  assert.throws(() => zoneValue({ id: 'zone', name: '环境', area: { shape: 'board' }, sourceId: null,
    follow: false, persistent: true, remainingTurns: 1, unitPools }, 'zone'), /不能声明单位池/);
  assert.ok(!normalizationPath.test('/zones/zone/unitPools/souls'));
});
