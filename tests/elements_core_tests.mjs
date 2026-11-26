import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_DAMAGE_TYPES, elementMitigationCategory, resolveElementAlias } from '../src/core/elements.js';
import { DAMAGE_TYPES, damageAttributeReduction, typedArmor } from '../src/core/combat_protocol.js';
import { validateState } from '../src/api/validation.js';
import { validVmRule } from '../src/core/vm-schema.js';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { commitVMEffect } from '../src/core/vm-runtime.js';

test('内置伤害类型包含完整 14 项并解析别名', () => {
  assert.deepEqual(BUILTIN_DAMAGE_TYPES, ['physical', 'energy', 'mental', 'true', 'fire', 'cold', 'lightning', 'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic']);
  assert.deepEqual(DAMAGE_TYPES, BUILTIN_DAMAGE_TYPES);
  assert.equal(resolveElementAlias('寒冰'), 'cold');
  assert.equal(resolveElementAlias('神圣'), 'radiant');
  assert.equal(resolveElementAlias('奥术'), 'force');
});

test('元素减伤归类复用物理、能量和精神曲线', () => {
  assert.equal(elementMitigationCategory('fire'), 'energy');
  assert.equal(elementMitigationCategory('psychic'), 'mental');
  assert.equal(typedArmor('fire', 10), 5);
  assert.equal(typedArmor('psychic', 10), 0);
  assert.equal(damageAttributeReduction('fire', { spi: 5, int: 5 }), .04);
});

test('自定义元素严格校验并进入动态 damageType 上下文', () => {
  const api = createGameAPI();
  api.createBattle({ scenarioId: 'ruins', ruleset: 'sandbox' });
  const state = api.getBattleState();
  state.customElements = { void: { id: 'void', name: '虚空', category: 'energy' } };
  validateState(state);
  assert.equal(validVmRule({ id: 'void-hit', hook: 'active', program: [{ op: 'damage', target: 'self', amount: 1, damageType: 'void' }] }, { customElements: state.customElements }), true);
  assert.equal(validVmRule({ id: 'bad-hit', hook: 'active', program: [{ op: 'damage', target: 'self', amount: 1, damageType: 'frie' }] }, { customElements: state.customElements }), false);
  const invalid = structuredClone(state);
  invalid.customElements = { constructor: { id: 'constructor', name: '坏', category: 'energy' } };
  assert.throws(() => validateState(invalid), /自定义元素 ID 无效/);
});

test('before_commit 改写 damageType 后立即按新元素重算', () => {
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'sandbox' });
  const source = state.units.swordsman;
  const target = state.units.gunner;
  source.rules = [{ id: 'enchant', hook: 'before_commit', filter: "event.damageType == 'physical' && event.commitKind == 'damage'", program: [{ op: 'mutate_event', patch: { damageType: 'fire' } }] }];
  target.armor = 1000;
  target.hp = target.maxHp = 500;
  state.pools[target.pools.hp].current = state.pools[target.pools.hp].max = 500;
  const before = target.hp;
  commitVMEffect(state, { op: 'damage', sourceId: source.id, targetId: target.id, amount: 100, damageType: 'physical', direct: true });
  const log = state.logs.find(entry => entry.type === 'damage' && entry.detail.targetId === target.id);
  assert.equal(log.detail.damageType, 'fire');
  assert.equal(before - target.hp, 80);
});

test('跨战档案保留自定义元素', () => {
  const api = createGameAPI();
  api.createBattle({ scenarioId: 'ruins', ruleset: 'sandbox' });
  const state = api.getBattleState();
  state.customElements = { void: { id: 'void', name: '虚空', category: 'energy' } };
  const withElements = createGameAPI();
  withElements.createBattle({ kind: 'custom_state', state });
  const carry = withElements.exportPersistentCarryOver();
  assert.deepEqual(carry.customElements.void, state.customElements.void);
  const next = createGameAPI();
  next.createBattle({ scenarioId: 'ruins', ruleset: 'sandbox', persistentSnapshot: carry });
  assert.deepEqual(next.getBattleState().customElements.void, state.customElements.void);
});
