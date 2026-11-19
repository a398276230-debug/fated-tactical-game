import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrateFromSources, parseBattleInit } from '../src/tavern/converter.js';
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
  const protagonistProfile = result.roster.find(item => item.team === 'blue');
  assert.equal(protagonistProfile.sourcePath.join('.'), '主角');
  assert.equal(protagonistProfile.sourceKind, 'MVU');
  assert.deepEqual(protagonistProfile.fieldSources, { numeric: 'MVU', equipment: 'MVU', placement: 'battle_init', faction: 'battle_init', name: 'battle_init' });
  assert.deepEqual([protagonist.x, protagonist.y], [2, 2]);
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

test('battle_init units 提供站位与战术快照，MVU 仍覆盖主角数值', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    units: [
      { id: 'unit_1', name: '瑞吉', team: 'blue', x: 2, y: 2, mainHand: 'bow_snapshot' },
      { id: 'unit_2', name: '木头人', team: 'red', x: 7, y: 7 },
    ],
    equipment: { bow_snapshot: { name: '快照弓', kind: 'weapon', weaponClass: 'ranged', rangeType: 'ranged', range: 6, attack: 10 } },
  } });
  const protagonist = Object.values(result.state.units).find(unit => unit.team === 'blue');
  assert.deepEqual([protagonist.x, protagonist.y], [2, 2]);
  assert.deepEqual(protagonist.stats, { str: 6, agi: 6, con: 6, int: 5, spi: 5 });
  assert.equal(protagonist.maxHp, 628);
  assert.ok(protagonist.mainHand);
});

test('battle 描述符解析精确 MVU 路径、terrain 与 seed', () => {
  const descriptor = `<battle_init>\nbattle|1|chapter-7|雾晶港演武场|terrain|123\nunit|p1|blue|mvu:主角|瑞吉|2,2\nunit|a1|blue|mvu:关系列表/队友A|队友A|3,2\nunit|e1|red|char_info|木头人|7,7\n</battle_init>`;
  const parsed = parseBattleInit(descriptor);
  assert.equal(parsed.terrainMode, 'terrain');
  assert.deepEqual(parsed.units[1], { id: 'a1', team: 'blue', source: 'mvu:关系列表/队友A', name: '队友A', x: 3, y: 2 });
  const result = hydrateFromSources({ mvu: { 主角: mvu.主角, 关系列表: { 队友A: { ...mvu.主角, 属性: { 力量: 3, 敏捷: 5, 体质: 3, 智力: 2, 精神: 2 } } } }, battleInit: descriptor, charInfo: { name: '木头人', 属性: mvu.主角.属性 } }, { seed: 456, throwOnValidation: true });
  assert.equal(result.seed, 456);
  assert.equal(result.state.scenarioId, 'chapter-7');
  assert.equal(result.state.units.p1.stats.str, 6);
  assert.equal(result.state.units.a1.stats.agi, 5);
  assert.equal(result.state.units.e1.team, 'red');
  assert.equal(result.state.logs.filter(log => log.type === 'initiative').length, 1);
  assert.equal(result.state.units[result.state.order[result.state.turn]].ap, 2);
  assert.notEqual(result.state.rng, result.seed);
  assert.ok(result.state.grid.flat().some(cell => cell.kind === 'slope'));
  assert.ok(result.state.grid.flat().some(cell => cell.z === 2));
  const restarted = hydrateFromSources({ battleInit: descriptor }, { seed: result.seed });
  assert.deepEqual(restarted.state.grid, result.state.grid);
  assert.ok(hydrateFromSources({ battleInit: descriptor.replace('|terrain|', '|flat|') }).state.grid.flat().every(cell => cell.kind === 'floor' && cell.z === 0));
});

test('explicit sources keep narrative names separate and never fall back to another MVU path', () => {
  const battleInit = `battle|1|exact|演武场|flat
unit|p1|blue|mvu:主角|同名|1,1
unit|a1|blue|mvu:不存在/队友A|队友A|2,2
unit|e1|red|char_info|同名|7,7
unit|e2|red|char_info|木偶|8,7`;
  const result = hydrateFromSources({ battleInit, protagonistName: '化名', mvu: {
    主角: mvu.主角,
    关系列表: { 队友A: { stats: { str: 9 } } },
  }, charInfo: [{ name: '同名', stats: { str: 4 } }, { name: '木偶', stats: { str: 5 } }] }, { throwOnValidation: true });
  assert.equal(result.state.units.p1.name, '同名');
  assert.equal(result.state.units.p1.stats.str, 6);
  assert.equal(result.state.units.a1.stats.str, 0);
  assert.equal(result.state.units.e1.stats.str, 4);
  assert.equal(result.state.units.e2.stats.str, 5);
  assert.ok(result.warnings.some(w => w.includes('mvu:不存在/队友A')));
});

test('battle_init 描述符拒绝重复起点与模糊 MVU 来源', () => {
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|mvu|敌人|1,1'), /battle_init 描述符/);
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|char_info|敌人|1,1'), /起点重复/);
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat|4294967296'), /seed/);
});

test('legacy TT JSON imports grid rectangles, slopes and walls and falls back to MVU once', () => {
  const battle = {
    title: '雾晶港', mode: 'split', seed: 99,
    grid: { walls: [[6, 5], [-1, 5]], slopes: [[6, 7, 1]], elevation: [{ x1: 7, x2: 8, y1: 7, y2: 8, z: 2 }] },
    units: [
      { id: 'unit_1', name: '瑞吉', team: 'blue', x: 2, y: 2, stats: { str: 1 } },
      { id: 'unit_2', name: '同伴', team: 'blue', x: 3, y: 2, stats: { str: 2 } },
      { id: 'unit_3', name: '木头人', team: 'red', x: 7, y: 7, stats: { str: 3 } },
    ],
  };
  const battleInit = `<battle_init>\n\`\`\`json\n${JSON.stringify(battle)}\n\`\`\`\n</battle_init>`;
  assert.deepEqual(parseBattleInit(battleInit), battle);
  const input = { mvu, battleInit, protagonistName: '酒馆化名' };
  const { state, seed, warnings } = hydrateFromSources(input, { throwOnValidation: true });
  assert.equal(seed, 99);
  assert.deepEqual(hydrateFromSources(input, { seed }).state, state);
  assert.equal(state.mode, 'split');
  assert.equal(state.units.unit_1.name, '酒馆化名');
  assert.equal(state.units.unit_1.stats.str, 6);
  assert.equal(state.units.unit_2.name, '同伴');
  assert.equal(state.units.unit_2.stats.str, 2);
  assert.deepEqual(state.grid[5][6], { kind: 'wall', z: 0 });
  assert.deepEqual(state.grid[7][6], { kind: 'slope', z: 1 });
  assert.deepEqual(state.grid[8][8], { kind: 'floor', z: 2 });
  assert.ok(warnings.some(w => w.includes('grid.walls')));
});

test('Chinese slots, status durations and unsupported effect warnings', () => {
  const battleInit = 'battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|char_info|敌人|7,7';
  const result = hydrateFromSources({ battleInit, charInfo: { name: '敌人' }, mvu: { 主角: {
    ...mvu.主角,
    状态效果: { 定身: { 层数: 1, 剩余时间: '3回合' }, 场地弹药补给: {} },
    装备: {
      匕首: { 类型: '武器', 位置: '主手' },
      木盾: { 类型: '防具', 位置: '副手' },
      皮甲: { 类型: '防具', 位置: '躯干', 标签: ['防御：6'], 效果: { 轻便: '描述文字' } },
    },
    技能: { 冰箭: { 效果: [{ kind: 'status', status: '冰冻' }, { kind: 'status', status: '不存在' }] } },
  } } }, { throwOnValidation: true });
  const { state, warnings } = result;
  const p = state.units.p1;
  assert.equal(p.offHand, null);
  assert.equal(state.equipment[state.items[p.mainHand].templateId].name, '匕首');
  assert.equal(state.equipment[state.items[p.shield].templateId].name, '木盾');
  assert.equal(state.equipment[state.items[p.gear[0]].templateId].armor, 6);
  assert.equal(p.statuses.root.remainingTurns, 3);
  assert.deepEqual(state.skills[p.skills[0]].effects, [{ kind: 'status', statusId: 'freeze' }]);
  for (const label of ['场地弹药补给', '轻便', '不存在']) assert.ok(warnings.some(w => w.includes(label)));
});

test('battle_init 配套正则输出可点击入口', () => {
  const output = renderBattleInitEntry('<battle_init>{"battleId":"x"}</battle_init>');
  assert.match(output, /data-fated-battle-open="true"/);
  assert.match(output, /eventEmit/);
  assert.match(output, /<pre class="fated-battle-source">/);
  assert.doesNotMatch(output, /<battle_init>/);
});
