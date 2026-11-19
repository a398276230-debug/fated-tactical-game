import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { renderBattleInitEntry } from '../src/tavern/regex.js';

const mvu = {
  主角: {
    等级: 1,
    生命层级: '第一层级/普通',
    属性: { 力量: 6, 敏捷: 6, 体质: 6, 智力: 5, 精神: 5 },
    生命值: { 当前: 628, 上限: { _基础: 628, 额外: 0 } },
    法力值: { 当前: 500, 上限: { _基础: 500, 额外: 0 } },
    体力值: { 当前: 600, 上限: { _基础: 600, 额外: 0 } },
    装备: { 冰霜之弓: { 品质: '稀有', 类型: '武器', 标签: ['弓', '攻击: 185'], 位置: '' } },
  },
};

test('酒馆 battle_init participant source 映射中文 MVU 主角并保留装备', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    battleId: 'test',
    participants: [
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
      { name: '木头人', faction: 'red', source: 'narrative_char_info', xyz: [7, 7, 2] },
    ],
  } });
  const protagonist = Object.values(result.state.units).find(unit => unit.team === 'blue');
  assert.deepEqual(protagonist.stats, { str: 6, agi: 6, con: 6, int: 5, spi: 5 });
  assert.deepEqual([protagonist.hp, protagonist.maxHp, protagonist.mp, protagonist.maxMp, protagonist.sp, protagonist.maxSp], [628, 628, 500, 500, 600, 600]);
  assert.ok(protagonist.mainHand);
  assert.equal(result.roster.find(item => item.team === 'blue').sourcePath.join('.'), '主角');
});

test('酒馆重复 participant source 只生成一个单位', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    participants: [
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
    ],
  } });
  assert.equal(Object.values(result.state.units).length, 1);
});

test('battle_init 配套正则输出可点击入口', () => {
  const output = renderBattleInitEntry('<battle_init>{"battleId":"x"}</battle_init>');
  assert.match(output, /data-fated-battle-open="true"/);
  assert.match(output, /eventEmit/);
  assert.match(output, /<pre class="fated-battle-source">/);
  assert.doesNotMatch(output, /<battle_init>/);
});
