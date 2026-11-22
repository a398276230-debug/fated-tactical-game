import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';
import { parseAreaTags } from '../src/tavern/area-tags.js';
import { defaultCoverHp, resolveEffectiveTier, hydrateFromSources } from '../src/tavern/converter.js';

test('battle_init parses rectangular board, scale units, and stacked units', () => {
  const value = `<battle_init>\nbattle|1|scale-test|断桥|flat|棋盘=16×8|比例尺=1km|42\nunit|p1|blue|char_info|甲|15,7,0\nunit|p2|blue|char_info|乙|15,7,0\n</battle_init>`;
  const battle = parseBattleDescriptor(value.replace(/^<battle_init>\n|\n<\/battle_init>$/g, ''));
  assert.deepEqual({ width: battle.width, height: battle.height, cellM: battle.cellM, seed: battle.seed }, { width: 16, height: 8, cellM: 1000, seed: 42 });
  assert.equal(battle.units.length, 2);
  const overCapacity = value.replace('15,7,0\nunit|p2|blue|char_info|乙|15,7,0', '15,7,0\nunit|p2|blue|char_info|乙|15,7,0\nunit|p3|blue|char_info|丙|15,7,0\nunit|p4|blue|char_info|丁|15,7,0\nunit|p5|blue|char_info|戊|15,7,0').replace(/^<battle_init>\n|\n<\/battle_init>$/g, '');
  assert.throws(() => parseBattleDescriptor(overCapacity), /同格单位超过容量/);
});

test('area tags preserve zero/fractional raw distances and slash components', () => {
  const area = parseAreaTags(['[范围: 近程(2)+圆(敌方)]', '[有效距离: 贴身(0)/中程(4)]', '[位移: 3]']);
  assert.deepEqual(area.rangeValues, [0, 4]);
  assert.deepEqual(area.rangeTiers, ['贴身', '中程']);
  assert.equal(area.range, 0);
  assert.equal(area.shape, 'circle');
  assert.equal(area.target, 'enemy');
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
