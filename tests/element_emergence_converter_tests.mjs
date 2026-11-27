import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBattleReportText } from '../src/api/battle_report.js';
import { applyAction, preview } from '../src/core/combat.js';
import { mediumZone } from '../src/core/element-media.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';
import { skillDisplay } from '../src/tavern/instance-card.js';

const header = 'battle|1|elements|元素试炼|flat|7';
const units = ['unit|mage|blue|char_info|元素师|1,1', 'unit|target|red|char_info|对手|1,1'];
const input = (options = '', ...effects) => [header + options, ...units, ...effects].join('\n');
const hydrate = (battleInit, skill) => hydrateFromSources({ battleInit, charInfo: [
  { 名称: '元素师', hp: 100, stats: { str: 10, agi: 100, con: 10, int: 12, spi: 10 },
    ...(skill && { 技能: [{ 名称: '元素冲击', 类型: '主动', 标签: ['威力: 20', '射程: 6', `[伤害类型: ${skill}]`] }] }) },
  { 名称: '对手', hp: 100, stats: { str: 10, agi: 1, con: 10, int: 10, spi: 10 } },
] }, { throwOnValidation: true });

const aliases = {
  water: ['浅水洼', '水洼', '积水', '浅滩'], ice: ['冰面', '薄冰', '冻土冰面'], oil: ['油污', '火油', '油脂地面'],
  fire: ['火海', '地面余火', '烈焰地面'], acid: ['强酸池', '酸液池', '酸沼'], steam: ['蒸汽云', '水汽云'],
  smoke: ['浓烟', '黑烟', '烟幕'], poison_cloud: ['可燃毒雾', '毒瘴云', '沼气毒雾'],
};

test('exact whole-team environment aliases install shared medium defaults without scene warnings', () => {
  for (const [medium, names] of Object.entries(aliases)) {
    const { state, zoneEntries, warnings } = hydrate(input('', ...names.map((name, i) =>
      `效果|z${i}|全体|${name}|(${i}-${i})(5-5)`)));
    assert.deepEqual(warnings.filter(w => w.scope === 'scene'), []);
    for (const [i, name] of names.entries()) {
      const id = `z${i}`, zone = state.zones[id];
      const { name: _canonicalName, ...defaults } = mediumZone(medium);
      assert.deepEqual(zone, { ...defaults, id, name, follow: false, sourceId: null, team: null, persistent: false,
        area: { shape: 'cells', cells: [{ x: i, y: 5 }] } });
      assert.deepEqual(zoneEntries[id].area, { shape: 'rect', rect: { x1: i, y1: 5, x2: i, y2: 5 } });
    }
  }
});

test('descriptions, team-specific effects, partial names, and omitted team remain inert', () => {
  const battle = parseBattleDescriptor(input('', '效果|mist|全体|雾|全场', '效果|team|红|水洼|全场',
    '效果|named|全体|水洼：移动减半|全场', '效果|long|全体|潮汐水洼|全场'));
  battle.effects.push({ id: 'missing', name: '水洼' });
  const { state, warnings } = hydrate(battle);
  assert.deepEqual(warnings.filter(w => w.scope === 'scene').map(w => w.originPath),
    ['mist', 'team', 'named', 'long', 'missing'].map(id => `/zones/${id}`));
  for (const zone of Object.values(state.zones)) {
    assert.ok(!Object.hasOwn(zone, 'medium'));
    assert.deepEqual(zone.tags, ['scene_effect']);
    assert.equal(zone.persistent, true);
  }
});

test('explicit scene duration, persistence, and tier survive hydration, with sorted non-wall cells and height bounds', () => {
  const battle = parseBattleDescriptor(input('', '效果|oil|全体|火油|全场(0-1)', '效果|steam|全体|蒸汽云|(5-5)(5-5)(3-3)'));
  Object.assign(battle.effects[0], { description: '  ', remainingTurns: 9, persistent: true, tier: 3 });
  delete battle.terrainMode;
  battle.terrain = { walls: [[2, 0, 0]], elevation: [{ x1: 1, x2: 1, y1: 0, y2: 0, z: 2 }] };
  const { state } = hydrate(battle);
  const oil = state.zones.oil;
  assert.equal(oil.remainingTurns, 9);
  assert.equal(oil.persistent, true);
  assert.equal(oil.tier, 3);
  assert.deepEqual(oil.area, { shape: 'cells', z1: 0, z2: 1, cells: state.grid.flatMap((row, y) => row.flatMap((cell, x) =>
    cell.kind !== 'wall' && cell.z <= 1 ? [{ x, y }] : [])) });
  assert.deepEqual(state.zones.steam.area, { shape: 'cells', cells: [{ x: 5, y: 5 }], z1: 3, z2: 3 });
});

test('opening declarations apply same-layer precedence while clouds coexist and non-medium zones stay untouched', () => {
  const battle = parseBattleDescriptor(input('', '效果|water|全体|积水|(0-2)(5-5)', '效果|ice|全体|冰面|(1-3)(5-5)',
    '效果|steam|全体|蒸汽云|(1-2)(5-5)', '效果|mist|全体|雾|(1-2)(5-5)'));
  battle.effects[0].tier = 3;
  const { state } = hydrate(battle);
  assert.deepEqual(state.zones.water.area.cells, [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }]);
  assert.deepEqual(state.zones.ice.area.cells, [{ x: 3, y: 5 }]);
  assert.deepEqual(state.zones.steam.area.cells, [{ x: 1, y: 5 }, { x: 2, y: 5 }]);
  assert.equal(state.zones.mist.area.shape, 'rect');
  battle.effects[1].tier = 3;
  assert.deepEqual(hydrate(battle).state.zones.water.area.cells, [{ x: 0, y: 5 }]);
});

test('descriptor consumes explicit switch alongside seed and scale with default key omission', () => {
  const off = input('|元素交互 = 关|比例尺=50m');
  assert.equal(parseBattleDescriptor(off).seed, 7);
  assert.equal(hydrate(off).state.elementalPhysics, 'off');
  assert.equal(hydrate(input('|法则=无元素涌现')).state.elementalPhysics, 'off');
  for (const battleInit of [input(), input('|元素交互=开')]) {
    assert.ok(!Object.hasOwn(parseBattleDescriptor(battleInit), 'elementalPhysics'));
    assert.ok(!Object.hasOwn(hydrate(battleInit).state, 'elementalPhysics'));
  }
  assert.throws(() => parseBattleDescriptor(input('|元素交互=开|法则=无元素涌现')), /只能声明一次/u);
  assert.throws(() => parseBattleDescriptor(input('|元素交互=错')), /必须是 开 或 关/u);
});

test('converted water element shows traits on its card and respects switch and large-grid filtering', () => {
  for (const [options, zones, wet] of [['', true, true], ['|比例尺=50m', false, true], ['|元素交互=关', false, false]]) {
    const { state } = hydrate(input(options), '流水');
    assert.deepEqual(state.customElements.water, { id: 'water', name: '流水', category: 'energy', traits: ['wet'] });
    const [skillId] = state.units.mage.skills;
    assert.match(skillDisplay(state.skills[skillId], {}, state.customElements).damage, /流水（浸润）/u);
    // A same-cell cast isolates scale filtering from range compression.
    const action = { type: 'skill', skillId, x: 1, y: 1, targetId: 'target' };
    const plan = preview(state, action);
    assert.equal(plan.ok, true, plan.error);
    applyAction(state, action);
    assert.equal(Object.values(state.zones).some(zone => zone.medium === 'water'), zones);
    assert.equal(Object.hasOwn(state.units.target.statuses, 'wet'), wet);
  }
});

test('structured reaction events show their cell count in battle report prose', () => {
  const text = formatBattleReportText({ title: '元素试炼', units: [], rounds: [{ round: 1, events: [
    { type: 'zone', text: '水体导电', detail: { reaction: 'conduct', cells: [{ x: 1, y: 2 }, { x: 1, y: 3 }] } },
    { type: 'zone', text: '展开墓火领域', detail: { zoneId: 'gravefire' } },
  ] }] });
  assert.match(text, /水体导电（波及 2 格）/u);
  assert.match(text, /展开墓火领域\n/u);
});
