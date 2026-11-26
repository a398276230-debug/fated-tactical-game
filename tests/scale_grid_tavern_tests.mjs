import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';
import { parseAreaTags } from '../src/tavern/area-tags.js';
import { defaultCoverHp, resolveEffectiveTier, hydrateFromSources } from '../src/tavern/converter.js';
import { actionSkill, weaponInfo } from '../src/core/combat.js';

test('battle_init parses rectangular board, scale units, and stacked units', () => {
  const value = `<battle_init>\nbattle|1|scale-test|断桥|flat|棋盘=16×8|比例尺=1km|42\nunit|p1|blue|char_info|甲|15,7,0\nunit|p2|blue|char_info|乙|15,7,0\n</battle_init>`;
  const battle = parseBattleDescriptor(value.replace(/^<battle_init>\n|\n<\/battle_init>$/g, ''));
  assert.deepEqual({ width: battle.width, height: battle.height, cellM: battle.cellM, seed: battle.seed }, { width: 16, height: 8, cellM: 1000, seed: 42 });
  assert.equal(battle.units.length, 2);
  const overCapacity = value.replace('15,7,0\nunit|p2|blue|char_info|乙|15,7,0', '15,7,0\nunit|p2|blue|char_info|乙|15,7,0\nunit|p3|blue|char_info|丙|15,7,0\nunit|p4|blue|char_info|丁|15,7,0\nunit|p5|blue|char_info|戊|15,7,0').replace(/^<battle_init>\n|\n<\/battle_init>$/g, '');
  assert.throws(() => parseBattleDescriptor(overCapacity), /同格单位超过容量/);
});

test('battle_init accepts independent tier and physical scale declarations', () => {
  const tier = parseBattleDescriptor('battle|1|tier|近身|flat|战场层级=第 2 层级\nunit|p|blue|char_info|甲|1,1');
  assert.deepEqual({ scaleTier: tier.scaleTier, explicitScale: tier.explicitScale, cellM: tier.cellM ?? null }, { scaleTier: 2, explicitScale: true, cellM: null });
  const alias = parseBattleDescriptor('battle|1|alias|庭院|flat|尺度层级=5级|比例尺=12m\nunit|p|blue|char_info|甲|1,1');
  assert.deepEqual({ scaleTier: alias.scaleTier, cellM: alias.cellM, explicitScale: alias.explicitScale }, { scaleTier: 5, cellM: 12, explicitScale: true });
  for (const header of [
    'battle|1|bad-tier|错误|flat|战场层级=0',
    'battle|1|bad-tier|错误|flat|战场层级=8',
    'battle|1|bad-tier|错误|flat|尺度层级=2.5',
    'battle|1|duplicate-tier|错误|flat|战场层级=2|尺度层级=2',
  ]) assert.throws(() => parseBattleDescriptor(`${header}\nunit|p|blue|char_info|甲|1,1`), /战场层级/);
});

test('hydrate arbitrates explicit scale axes and defaults to the lowest unit tier', () => {
  const battle = 'battle|1|scale-default|混合队|flat\nunit|low|blue|char_info|低阶|1,1\nunit|high|red|char_info|高阶|2,1';
  const charInfo = [{ name: '低阶', tier: 1 }, { name: '高阶', tier: 5 }];
  const defaultScale = hydrateFromSources({ battleInit: battle, charInfo }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(defaultScale, { cellM: 2, width: 10, height: 10, anchorTier: 1, explicit: false });
  const highOnly = hydrateFromSources({ battleInit: 'battle|1|scale-high|高阶|flat\nunit|high|blue|char_info|高阶|1,1', charInfo: [{ name: '高阶', tier: 5 }] }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(highOnly, { cellM: 50, width: 10, height: 10, anchorTier: 5, explicit: false });
  const declaredTier = hydrateFromSources({ battleInit: battle.replace('|flat\n', '|flat|战场层级=5\n'), charInfo }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(declaredTier, { cellM: 50, width: 10, height: 10, anchorTier: 5, explicit: true });
  const declaredCell = hydrateFromSources({ battleInit: battle.replace('|flat\n', '|flat|比例尺=2m\n'), charInfo }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(declaredCell, { cellM: 2, width: 10, height: 10, anchorTier: 1, explicit: true });
  const orthogonal = hydrateFromSources({ battleInit: battle.replace('|flat\n', '|flat|战场层级=5|比例尺=2m\n'), charInfo }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(orthogonal, { cellM: 2, width: 10, height: 10, anchorTier: 5, explicit: true });
});

test('hydrate accepts structured anchorTier and scaleTier declarations', () => {
  const source = { charInfo: [{ name: '甲', tier: 1 }], battleInit: {
    battleId: 'structured-tier', terrainMode: 'flat', sceneTitle: '结构化',
    units: [{ id: 'p', team: 'blue', source: 'char_info', name: '甲', x: 1, y: 1 }],
    scaleTier: 4, cellM: 7,
  } };
  assert.deepEqual(hydrateFromSources(source, { throwOnValidation: true }).state.scale, { cellM: 7, width: 10, height: 10, anchorTier: 4, explicit: true });
  const anchor = { ...source, battleInit: { ...source.battleInit, scaleTier: undefined, anchorTier: 6, cellM: undefined } };
  assert.deepEqual(hydrateFromSources(anchor, { throwOnValidation: true }).state.scale, { cellM: 250, width: 10, height: 10, anchorTier: 6, explicit: true });
  for (const scaleTier of [true, [5], 2.5, 8]) {
    assert.throws(() => hydrateFromSources({ ...source, battleInit: { ...source.battleInit, scaleTier } }), /战场层级/);
  }
  const markerOnly = { ...source, battleInit: { ...source.battleInit, scaleTier: undefined, anchorTier: undefined, cellM: undefined, explicitScale: true } };
  assert.equal(hydrateFromSources(markerOnly, { throwOnValidation: true }).state.scale.explicit, false);
  const empty = hydrateFromSources({ battleInit: { battleId: 'empty', terrainMode: 'flat', sceneTitle: '空场', explicitScale: true } }, { throwOnValidation: true }).state.scale;
  assert.deepEqual(empty, { cellM: 2, width: 10, height: 10, anchorTier: 1, explicit: false });
});

test('hydrate preserves the far corner, legal stacks and rectangular wraparound', () => {
  const { state, warnings } = hydrateFromSources({ battleInit: `battle|1|edge|边界|flat|棋盘=20x12
unit|a|blue|char_info|甲|19,11
unit|b|red|char_info|乙|19,11
unit|c|red|char_info|丙|19,11
cover|wall|全|石墙|18,11,0` }, { throwOnValidation: true });
  assert.deepEqual([state.units.a,state.units.b,state.units.c,state.covers.wall].map(({x,y}) => [x,y]), [[19,11],[19,11],[0,0],[18,11]]);
  assert.equal(warnings.find(w => /起点不可用/.test(w.message))?.kind, 'auto_adjusted');
});

test('area tags preserve zero/fractional raw distances and slash components', () => {
  const area = parseAreaTags(['[范围: 近程(2)+圆(敌方)]', '[有效距离: 贴身(0)/中程(4)]', '[位移: 3]']);
  assert.deepEqual(area.rangeValues, [0, 4]);
  assert.deepEqual(area.rangeTiers, ['贴身', '中程']);
  assert.equal(area.range, 0);
  assert.equal(area.shape, 'circle');
  assert.equal(area.target, 'enemy');
});

test('虚海大幻觉 retains numeric rawRange from the char_info distance field', () => {
  const { state } = hydrateFromSources({ battleInit: 'battle|1|range|测试|flat\nunit|e1|red|char_info|塞尔塞特|1,1',
    charInfo: [{ name: '塞尔塞特', level: 21, skills: [{ name: '虚海大幻觉', 有效距离: '远程(8)', 标签: ['有效距离: 远程(8)'] }] }],
  }, { throwOnValidation: true });
  assert.equal(state.skills[state.units.e1.skills[0]].rawRange, 8);
  assert.deepEqual([state.units.e1.level, state.units.e1.tier], [21, 6]);
});

test('untagged equipment and skill default ranges use the battle scale', () => {
  const { state } = hydrateFromSources({
    battleInit: '<battle_init>\nbattle|1|default-range|神战|flat|比例尺=1km\nunit|p1|blue|char_info|甲|1,1,0\n</battle_init>',
    charInfo: [{ name: '甲', tier: 1, equipment: [{ name: '铁剑', kind: 'weapon', slot: 'mainHand' }], skills: [{ name: '重击' }] }],
  }, { throwOnValidation: true });
  const unit = state.units.p1;
  assert.equal(state.equipment[state.items[unit.mainHand].templateId].rawRange, 1);
  assert.equal(state.skills[unit.skills[0]].rawRange, 1);
  assert.equal(weaponInfo(state, unit).template.range, 0);
  assert.equal(actionSkill(state, unit, unit.skills[0]).range, 0);
});

test('parsed and structured battle declarations resolve identical cross-tier action geometry', () => {
  const declaration = 'battle|1|cross-tier|断桥|flat|比例尺=5m\nunit|p1|blue|char_info|甲|1,1';
  const charInfo = [{ name: '甲', tier: 3,
    equipment: [{ name: '剑', kind: 'weapon', slot: 'mainHand', quality: '普通', range: 4 }],
    skills: [{ name: '史诗波', quality: '史诗', range: 4, radius: 2, shape: 'circle' },
      { name: '唯一波', quality: '唯一', range: 4, radius: 2, shape: 'circle' }],
  }];
  for (const battleInit of [declaration, parseBattleDescriptor(declaration)]) {
    const { state } = hydrateFromSources({ charInfo, battleInit }, { throwOnValidation: true });
    const unit = state.units.p1;
    assert.equal(weaponInfo(state, unit).template.range, 1);
    assert.deepEqual(unit.skills.map(id => {
      const { range, radius } = actionSkill(state, unit, id);
      return [range, radius];
    }), [[12, 6], [4, 2]]);
  }
});

test('effective tier and cover HP follow scale acceptance', () => {
  assert.equal(resolveEffectiveTier('skill', '神话', 2), 6);
  assert.equal(resolveEffectiveTier('item', '神话', 2), 2);
  assert.equal(resolveEffectiveTier('item', '唯一', 2), 2);
  assert.equal(defaultCoverHp(2, true), 25);
  assert.equal(defaultCoverHp(50, true), 2500);
  const { state } = hydrateFromSources({ battleInit: `<battle_init>\nbattle|1|cover-test|神战|flat|比例尺=50m\nunit|p1|blue|char_info|甲|1,1,0\ncover|c1|全|断壁废墟|4,4,0\n</battle_init>` }, { throwOnValidation: true });
  assert.equal(state.scale.cellM, 50);
  assert.equal(state.covers.c1.maxHp, 2500);
});
