import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateState } from '../src/api/validation.js';
import { elevation } from '../src/core/spatial.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';

const header = 'battle|1|mist|幻雾海|terrain|42';
const gull = 'unit|e3|red|char_info|幻雾海鸥|';
const unit = `${gull}3,8,1,飞行=1`;
const mist = '效果|f1|全体|幻雾海蚀：远程命中-4|(0-9)(0-9)(0-2)';
const body = (...rows) => [header, unit, ...rows].join('\n');
const hydrate = battleInit => hydrateFromSources({ battleInit, charInfo: [{ 名称: '幻雾海鸥', hp: 100 }] }, { throwOnValidation: true });

function rejects(lines, pattern) {
  assert.throws(() => parseBattleDescriptor(lines.join('\n')), error => {
    assert.match(error.message, /^battle_init 描述符：/u);
    assert.match(error.message, pattern);
    return true;
  });
}

test('unit: four coordinate forms preserve ground and flight as independent axes', () => {
  for (const [point, heights] of [
    ['3,8', {}], ['3,8,1', { z: 1 }], ['3,8,飞行=1', { altitude: 1 }],
    ['3,8,0,悬浮=2', { z: 0, altitude: 2 }], ['3 , 8 , 1 , 飞行 = 1', { z: 1, altitude: 1 }],
    ['3,8,-4,悬浮=12', { z: -4, altitude: 12 }],
  ]) {
    assert.deepEqual(parseBattleDescriptor(`${header}\n${gull}${point}`).units[0], {
      id: 'e3', team: 'red', source: 'char_info', name: '幻雾海鸥', x: 3, y: 8, ...heights,
    });
  }
  const { state } = hydrate(body());
  assert.equal(state.grid[8][3].z, 1);
  assert.equal(state.units.e3.altitude, 1);
  assert.equal(state.units.e3.z, undefined);
  assert.equal(elevation(state, state.units.e3), 2);
  validateState(state);

  const baseline = hydrate(`${header}\n${gull}3,8`);
  const flying = hydrate(`${header}\n${gull}3,8,0,飞行=1`);
  assert.ok(baseline.state.grid.flat().some(cell => cell.z === 2));
  assert.deepEqual(flying.state.grid, baseline.state.grid);
  assert.equal(flying.state.units.e3.altitude, 1);
  assert.ok(!Object.hasOwn(baseline.battleInit, 'effects'));
  assert.deepEqual(baseline.zoneEntries, {});
});

test('effect: supported record forms, team aliases, text splitting and range forms', () => {
  const { effects } = parseBattleDescriptor(body(mist,
    '效果|f2|蓝方|效果|逆风: 禁止奔跑|全场 ( 2 - 8 )',
    'EfFeCt|f3|RED|深渊重力|移动减半：向下|(2-5)(3-6)',
    'effect|f4|ALL|沙尘|BoArD',
    '效果|f5|any|低处：|全图(-4--1)'));
  assert.deepEqual(effects, [
    { id: 'f1', targetTeam: null, name: '幻雾海蚀', description: '远程命中-4', rawText: '幻雾海蚀：远程命中-4', area: { shape: 'rect', rect: { x1: 0, y1: 0, x2: 9, y2: 9 }, z1: 0, z2: 2 } },
    { id: 'f2', targetTeam: 'blue', name: '逆风', description: '禁止奔跑', rawText: '逆风: 禁止奔跑', area: { shape: 'board', z1: 2, z2: 8 } },
    { id: 'f3', targetTeam: 'red', name: '深渊重力', description: '移动减半：向下', rawText: '深渊重力：移动减半：向下', area: { shape: 'rect', rect: { x1: 2, y1: 3, x2: 5, y2: 6 } } },
    { id: 'f4', targetTeam: null, name: '沙尘', description: '沙尘', rawText: '沙尘', area: { shape: 'board' } },
    { id: 'f5', targetTeam: null, name: '低处', description: '低处', rawText: '低处：', area: { shape: 'board', z1: -4, z2: -1 } },
  ]);
  for (const [team, expected] of [['全部', null], ['BLUE', 'blue'], ['蓝', 'blue'], ['红', 'red'], ['红方', 'red']]) {
    const { effects: [effect] } = parseBattleDescriptor(body(`effect|f|${team}|EFFECT|雾|全场`));
    assert.equal(effect.targetTeam, expected);
  }
});

test('effect: IDs are shared across row types but the areas never claim cells', () => {
  const stacked = [unit, ...[1, 2, 3].map(n => `unit|p${n}|blue|char_info|旅人|3,8`)];
  const covers = 'cover|c|全|墙|4,8,0';
  const interact = 'interact|i|altar|heal|0|0|祭坛|5,8,0';
  assert.equal(parseBattleDescriptor([header, mist, ...stacked, covers, interact].join('\n')).units.length, 4);
  assert.equal(parseBattleDescriptor(body(covers, interact, mist)).covers.length, 1);
  rejects([header, ...stacked, 'unit|p4|blue|char_info|旅人|3,8', mist], /同格单位超过容量 4/u);
  for (const id of ['E3', 'C', 'I', 'F1']) {
    rejects([header, unit, covers, interact, mist, `效果|${id}|全体|雾|全场`], /效果 记录需要唯一 ID/u);
  }
});

test('summon declarations share ID guards and require an admitted owner and safe source', () => {
  const summon = 'summon|s1|e3|char_info|幻雾幼鸟';
  assert.equal(parseBattleDescriptor([header, summon, unit].join('\n')).summons[0].ownerId, 'e3');
  for (const row of [summon.replace('|e3|', '|missing|'), summon.replace('|s1|', '|e3|'),
    summon.replace('|char_info|', '|mvu:主角/constructor|'), summon + '|上限=21']) {
    assert.throws(() => parseBattleDescriptor(body(row)), { message: /^battle_init 描述符：/u });
  }
});

test('descriptor reports individual header and row fields', () => {
  for (const [badHeader, pattern] of [
    ['unit|1|mist|幻雾海|flat', /首行前缀/u], ['battle|2|mist|幻雾海|flat', /首行版本号/u],
    ['battle|1|constructor|幻雾海|flat', /首行战场 ID/u], ['battle|1|mist||flat', /首行场景标题/u],
    ['battle|1|mist|幻雾海|bad', /首行地形模式/u], [`${header}|bad`, /无法识别的选项/u],
    ['battle|1|mist|幻雾海|flat|4294967296', /seed/u], [`${header}|棋盘=21x8`, /棋盘尺寸/u],
    [`${header}|比例尺=0`, /比例尺/u], [`${header}|战斗类型=错误`, /未知战斗类型/u],
    [`${header}|战斗类型=压制`, /压制方/u],
  ]) rejects([badHeader, unit], pattern);
  for (const [badRow, pattern] of [
    ['unknown|x', /第 3 条记录未知行类型/u], ['unit|p|blue', /unit 记录需要 6 段/u],
    ['unit|p|purple|char_info|旅人|3,2', /unit 记录的阵营/u],
    ['unit|p|blue|mvu:主角/constructor|旅人|3,2', /unit 记录的来源/u],
    ['unit|p|blue|char_info||3,2', /unit 记录的显示名/u],
    [`${gull.replace('e3', 'p')}x,2`, /坐标「x,2」格式/u],
    [`${gull.replace('e3', 'p')}3,8,飞行=1,飞行=2`, /坐标段「飞行=1」/u],
    [`${gull.replace('e3', 'p')}3,8,1,1`, /坐标段「1」/u],
    [`${gull.replace('e3', 'p')}10,8`, /坐标超出棋盘范围/u],
    [`${gull.replace('e3', 'p')}3,8,-5`, /地形高度 z=-5/u],
    [`${gull.replace('e3', 'p')}3,8,8,飞行=13`, /离地高度 13/u],
    ['cover|c|半|墙', /cover 记录需要 5 段/u], ['cover|c|薄|墙|4,8,0', /掩体类型/u],
    ['cover|c|半||4,8,0', /掩体名称/u], ['cover|c|半|墙|4,8', /坐标.*应为 x,y,z/u],
    ['cover|c|半|墙|4,8,9', /地形高度 z=9/u], ['cover|c|半|墙|3,8,0', /位置重复/u],
    ['interact|i|altar|heal|0|0|祭坛', /interact 记录需要 8 段/u],
    ['interact|i|gate|heal|0|0|祭坛|4,8,0', /互动类型/u], ['interact|i|altar|bad|0|0|祭坛|4,8,0', /互动效果/u],
    ['interact|i|altar|heal||0|祭坛|4,8,0', /半径/u], ['interact|i|altar|heal|0|-1|祭坛|4,8,0', /数值/u],
    ['interact|i|altar|heal|0|0||4,8,0', /互动名称/u], ['interact|i|altar|heal|0|0|祭坛|4,8', /坐标.*应为 x,y,z/u],
    ['效果|f|全体|雾', /效果 记录需要 5 段/u], ['效果|f|西|雾|全场', /目标阵营/u],
    ['效果|f|全体||全场', /名称不能为空/u], ['效果|f|全体|雾||全场', /效果描述不能为空/u],
    [`效果|f|全体|雾：${'雾'.repeat(499)}|全场`, /合并写法总长/u],
    ['效果|f|全体|雾|(0-9)', /范围.*格式无效/u], ['效果|f|全体|雾|(3-2)(0-9)', /区间起止颠倒/u],
    ['效果|f|全体|雾|(0-9)(0-10)', /坐标超出棋盘范围/u],
    ['效果|f|全体|雾|全场(1-0)', /高度区间/u], ['效果|f|全体|雾|全场(-5-20)', /高度区间/u],
    ['效果|f|全体|雾|(0-9)(0-9)(-4-21)', /高度区间/u],
  ]) rejects([header, unit, badRow], pattern);
  rejects([header, ...Array.from({ length: 16 }, (_, n) => `效果|f${n}|全体|雾|全场`)], /至少需要一条 unit/u);
  rejects([header, unit, ...Array.from({ length: 17 }, (_, n) => `效果|f${n}|全体|雾|全场`)], /最多 16 条 效果 记录/u);
  for (const key of ['constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty']) {
    rejects([header, unit, `效果|${key}|全体|雾|全场`], /效果 记录的 ID.*格式无效/u);
  }
});

test('hydration installs inert persistent carriers and keeps narrative metadata out of engine state', () => {
  const { state, zoneEntries, warnings } = hydrate(body(mist, '效果|f2|红|高空乱流：禁止飞行|全场(2-8)'));
  const area = { shape: 'rect', rect: { x1: 0, y1: 0, x2: 9, y2: 9 }, z1: 0, z2: 2 };
  assert.deepEqual(state.zones.f1, { id: 'f1', name: '幻雾海蚀', area, follow: false, persistent: true,
    remainingTurns: 1, sourceId: null, team: null, tags: ['scene_effect'], mods: [], rules: [] });
  assert.deepEqual(zoneEntries.f1, { id: 'f1', name: '幻雾海蚀', targetTeam: null, description: '远程命中-4', area });
  assert.equal(state.zones.f2.team, null);
  assert.equal(zoneEntries.f2.targetTeam, 'red');
  assert.deepEqual(warnings.filter(w => w.scope === 'scene'), [
    { unitId: null, source: 'battle_init', scope: 'scene', originPath: '/zones/f1', message: '战场效果待标准化「幻雾海蚀」[作用阵营:全体][范围:(0-9)(0-9)(0-2)]：远程命中-4' },
    { unitId: null, source: 'battle_init', scope: 'scene', originPath: '/zones/f2', message: "战场效果待标准化「高空乱流」[作用阵营:仅红方(self.team == 'red')][范围:全场(2-8)]：禁止飞行" },
  ]);
  validateState(state);
});

test('structured scene input: 64-character collisions terminate and prototype keys never become table keys', () => {
  const { execPath } = process;
  // A subprocess timeout prevents a recurrence of the synchronous loop from hanging the suite.
  const result = spawnSync(execPath, ['--input-type=module', '-e', `
    import { hydrateFromSources } from ${JSON.stringify(new URL('../src/tavern/converter.js', import.meta.url).href)};
    const long = 'x'.repeat(64);
    const base = ${JSON.stringify(parseBattleDescriptor(body()))};
    base.effects = [long.slice(0, 62) + '_2', long, long.toUpperCase(), long,
      '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString']
      .map(id => ({ id, name: ' 雾 ', area: { shape: 'board' } }));
    base.effects.push(null, { id: 'out-of-grid', area: {shape: 'rect', rect: {x1: 0, x2: 10, y1: 0, y2: 9}} });
    const {state, zoneEntries, warnings} = hydrateFromSources({battleInit: base, charInfo: [{名称: '幻雾海鸥', hp: 100}]}, {throwOnValidation: true});
    console.log(JSON.stringify({ids: Object.keys(state.zones), metadata: Object.keys(zoneEntries),
      safe: Object.getPrototypeOf(state.zones) === Object.prototype && Object.getPrototypeOf(zoneEntries) === Object.prototype,
      adjusted: warnings.filter(w => w.kind === 'auto_adjusted' && w.scope === 'terrain').length}));
  `], { timeout: 5000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const { ids, metadata, safe, adjusted } = JSON.parse(result.stdout);
  assert.deepEqual(ids.slice(0, 4), [`${'x'.repeat(62)}_2`, 'x'.repeat(64), `${'X'.repeat(62)}_3`, `${'x'.repeat(62)}_4`]);
  assert.deepEqual(ids, metadata);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids.map(id => id.toLowerCase())).size, ids.length);
  assert.ok(ids.every(id => id !== 'prototype' && !Object.hasOwn(Object.prototype, id)));
  assert.equal(safe, true);
  assert.equal(adjusted, 2);
});
