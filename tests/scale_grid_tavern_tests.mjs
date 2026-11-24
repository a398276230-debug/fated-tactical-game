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
