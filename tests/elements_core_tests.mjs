import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_DAMAGE_TYPES, elementTraits, inferElementTraits, validateCustomElements, elementMitigationCategory, resolveElementAlias } from '../src/core/elements.js';
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

import { mitigation } from '../src/core/combat-actions.js';
import { resolveDamageType } from '../src/tavern/converter-effects.js';

test('元素物理轴按固定顺序合并载体标签，自定义元素只写非空特质', () => {
  const defaults = { fire: ['heat','ignite'], cold: ['cold'], lightning: ['shock'], thunder: ['gust'], acid: ['corrode'] };
  for (const type of BUILTIN_DAMAGE_TYPES) assert.deepEqual(elementTraits(type), defaults[type] ?? []);
  assert.deepEqual(elementTraits('fire', {}, ['gust','heat','wet','other']), ['heat','ignite','wet','gust']);
  const registry = {};
  for (const [name, traits] of Object.entries({ 苍蓝雷霆:['shock'], 永冻幽霜:['cold'], 黑油魔焰:['heat','ignite','flammable'], 流水:['wet'], 蒸汽:['heat','wet'], 风暴:['gust'] })) {
    const id = resolveDamageType(name, registry, true);
    assert.deepEqual(registry[id].traits, traits);
    assert.deepEqual(elementTraits(id, registry), traits);
  }
  for (const name of '虚空 星界 混沌 鲜血 大地 自然 蚀月 时空 重力 梦魇 晶石'.split(' ')) assert.deepEqual(inferElementTraits(name), []);
  resolveDamageType('虚空', registry, true);
  assert.deepEqual(registry.void, { id:'void', name:'虚空', category:'energy' });
  validateCustomElements(registry);
  for (const traits of ['wet', ['fake'], ['wet','wet'], ['heat','ignite','wet','cold','shock']]) assert.throws(() => validateCustomElements({ void:{ ...registry.void, traits } }), /特质无效/);
});

test('实际减伤管线按自定义归类折算护甲', () => {
  const state = buildScenario({ scenarioId:'ruins', ruleset:'sandbox' }), target = state.units.gunner;
  target.armor = 200;
  for (const [type, category] of [['rock','physical'], ['dream','mental']]) {
    state.customElements = { [type]:{ id:type, name:type, category } };
    assert.equal(mitigation(state, target, type).armor, mitigation(state, target, category).armor);
  }
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
