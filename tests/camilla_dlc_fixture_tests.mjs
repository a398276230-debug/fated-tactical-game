import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';
import { characterRecords } from '../src/tavern/char-snapshots.js';
import { normalizationPath } from '../src/tavern/normalization-batches.js';

// Compact values transcribed from the external Camilla DLC audit. The test is
// deliberately self-contained so clean checkouts do not depend on that card.
const owner = {
  name: '卡梅拉', tier: 4, level: 16,
  属性: { 力量: 8, 敏捷: 14, 体质: 6, 智力: 6, 精神: 6 },
  技能: [{ 名称: '召唤', 类型: '主动', 标签: ['攻击', '威力: 1'] }],
};
const musician = {
  姓名: '亡灵乐手', 生命层级: 4, 等级: 16, 体长: 1.7,
  属性: { 力量: 8, 敏捷: 14, 体质: 6, 智力: 6, 精神: 6 },
  技能: [{ 名称: '军团之势', 类型: '被动', 效果: '同集群每存活1单位，威力与连击数随数量增加' }],
};
const battle = `battle|1|camilla-fixture|召唤物水合|flat|棋盘=10x10\nunit|e1|red|char_info|卡梅拉|2,2\nsummon|musicians|e1|char_info|亡灵乐手|分组=musicians|模式=随动|上限=12|策略=队列`;

test('Batch 4 descriptor parses summon rows without making roster units', () => {
  const parsed = parseBattleDescriptor(battle);
  assert.equal(parsed.units.length, 1);
  assert.deepEqual(parsed.summons[0], {
    id: 'musicians', ownerId: 'e1', source: 'char_info', name: '亡灵乐手', group: 'musicians',
    turnMode: 'linked_group', maxActive: 12, stackPolicy: 'fifo',
  });
});

test('Batch 4 char_info channel hydrates a deterministic summon blueprint', () => {
  const { state, warnings } = hydrateFromSources({ battleInit: battle, charInfo: [owner, musician] }, { throwOnValidation: true });
  const template = state.summonTemplates.musicians;
  assert.ok(template);
  assert.equal(Object.keys(state.units).length, 1);
  assert.equal(template.name, '亡灵乐手');
  assert.deepEqual(template.stats, { str: 4, agi: 4, con: 4, int: 4, spi: 4 });
  assert.equal(template.tier, 4);
  assert.equal(template.turnMode, 'linked_group');
  assert.equal(template.stackPolicy, 'fifo');
  assert.equal(template.maxActive, 12);
  assert.ok(warnings.some(warning => warning.kind === 'auto_adjusted' && warning.message.includes('亡灵乐手')));
});

test('Batch 4 MVU channel carries tacticalSummons and excludes nested summon records', () => {
  const note = { ...musician, 技能: { 军团之势: { 品质:'稀有', 类型:'被动', 消耗:'', 标签:['增益'], 效果:{ 集群增幅:'随存活数提高威力' }, 描述:'众魂齐鸣' } },
    装备: { 法杖:{ 品质:'稀有', 类型:'武器', 标签:['主手'], 效果:{ 威力:'攻击 20' }, 描述:'指挥杖', 位置:'主手' } },
    特征: { 行动模式:'随主共享', 存续:'2回合', 上限:6, 分组:'band', 说明:'合奏' } };
  const mvu = { 事件: { 战术扩展: { 召唤物: { 主角: { 亡灵乐手: note }, 伙伴:{ 卡梅拉:{ 号手:{ ...note, 特征:{ 行动模式:'随主独立', 存续:'3轮', 分组:'horn' } } } } } } },
    主角: owner, 关系列表:{ 卡梅拉:{ ...owner, name:'伙伴卡梅拉' } } };
  const input = {
    mvu,
    battleInit: { terrainMode: 'flat', units: [{ id: 'p1', team: 'blue', source: 'mvu:主角', name: '卡梅拉', x: 1, y: 1 },
      { id:'a1', team:'blue', source:'mvu:关系列表/卡梅拉', name:'伙伴卡梅拉', x:2, y:1 }] },
  };
  const { state } = hydrateFromSources(input, { throwOnValidation: true });
  assert.deepEqual(Object.keys(state.units).sort(), ['a1', 'p1']);
  const [lead, companion] = ['p1', 'a1'].map(id => Object.values(state.summonTemplates).find(template => template.ownerId === id));
  assert.deepEqual([lead.turnMode, lead.remainingTurns, lead.durationUnit, lead.maxActive, lead.group], ['linked_group', 2, 'anchor_turns', 6, 'band']);
  assert.deepEqual([companion.turnMode, companion.remainingTurns, companion.durationUnit, companion.group], ['linked_each', 3, 'rounds', 'horn']);
  assert.equal(state.equipment[lead.mainHand]?.name, '法杖');
  assert.equal(state.skills[lead.skills[0]]?.name, '军团之势');
});

test('opening declaration spawns at the owner before the first turn and tracks source edits', async () => {
  const descriptor = parseBattleDescriptor(`${battle}|开场=随主\nunit|p1|blue|char_info|对手|6,6`);
  const opponent = { ...owner, name: '对手' };
  const input = { battleInit: descriptor, charInfo: [owner, musician, opponent] };
  const hydrated = hydrateFromSources(input, { throwOnValidation: true });
  const { state } = hydrated;
  const summon = Object.values(state.units).find(unit => unit.summoned);
  assert.ok(summon);
  assert.deepEqual([summon.x, summon.y, summon.sourceId], [2, 2, 'e1']);
  assert.ok(state.logs.findIndex(log => log.type === 'spawn') < state.logs.findIndex(log => log.type === 'turn'));
  assert.equal(hydrated.roster.some(unit => unit.summoned), false);
  const changed = { ...input, charInfo: [owner, { ...musician, 体长: 2 }, opponent] };
  const before = await characterRecords(input, hydrated);
  const after = await characterRecords(changed, hydrateFromSources(changed, { throwOnValidation: true }));
  assert.notEqual(after.e1.hash, before.e1.hash);
  assert.notEqual(after.e1.entryHashes['summonTemplates:musicians'], before.e1.entryHashes['summonTemplates:musicians']);
  assert.equal(after.p1.hash, before.p1.hash);
});

test('Batch 4 normalization accepts summon template paths', () => {
  assert.ok(normalizationPath.test('/summonTemplates/musicians/rules'));
  assert.ok(normalizationPath.test('/summonTemplates/musicians/stats'));
});
