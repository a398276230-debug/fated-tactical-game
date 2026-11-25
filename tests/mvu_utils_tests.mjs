import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJsonPatch } from '../src/tavern/mvu-utils.js';
import { applyPatch, fingerprintAt } from '../src/tavern/overlay-patch.js';
import { sourceBundle } from '../src/tavern/overlay-sources.js';

test('array add inserts by index and appends with /- without mutating the input', () => {
  const source = { stat_data: { 主角: { 装备: { 弓: { tags: ['双手', '弓'] } } } } };
  const value = { ammo: 20 };
  const patch = [
    { op: 'add', path: '/stat_data/主角/装备/弓/tags/1', value: '主手' },
    { op: 'add', path: '/stat_data/主角/装备/弓/tags/-', value },
  ];
  const updated = applyJsonPatch(source, patch);
  assert.deepEqual(updated.stat_data.主角.装备.弓.tags, ['双手', '主手', '弓', { ammo: 20 }]);
  assert.deepEqual(applyPatch(source, patch, true), updated);
  assert.deepEqual(applyPatch(source, patch), updated);
  updated.stat_data.主角.装备.弓.tags.at(-1).ammo = 17;
  assert.deepEqual(source.stat_data.主角.装备.弓.tags, ['双手', '弓']);
  assert.equal(value.ammo, 20);
});

test('source replay builds missing tables and decodes deep JSON Pointers in operation order', () => {
  const source = { stat_data: { 主角: { 装备: '无' } } };
  const target = '/stat_data/主角/装备/弓~1箭~0袋/tags';
  const patch = [
    { op: 'add', path: target, value: [] },
    { op: 'add', path: `${target}/-`, value: '原标签' },
    { op: 'replace', path: `${target}/0`, value: '弹药: 20' },
    { op: 'add', path: `${target}/0`, value: '临时' },
    { op: 'remove', path: `${target}/0` },
  ];
  const updated = applyJsonPatch(source, patch);
  assert.deepEqual(updated, { stat_data: { 主角: { 装备: { '弓/箭~袋': { tags: ['弹药: 20'] } } } } });
  assert.equal(fingerprintAt(updated, target), '["弹药: 20"]');
  assert.throws(() => applyPatch(source, patch, true), /补丁路径不可写|补丁路径不存在/);
  assert.throws(() => applyPatch(updated, [{ op: 'replace', path: `${target}/1`, value: '不存在' }], true), /补丁路径不存在/);
});

test('opening sources still read wrapped MVU and select the requested battle floor', () => {
  const stats = { 主角: { 生命值: { 当前: 20 } } };
  const entry = (id, battle) => ({ message_id: id, content: `<battle_init>\nbattle|1|${battle}|北门|flat\nunit|p1|blue|mvu:主角|主角|2,2\n</battle_init>` });
  const source = sourceBundle({ message: { stat_data: stats } }, [entry(1, 'first'), entry(2, 'second')], 'chat', 1);
  assert.deepEqual(source.mvuData, stats);
  assert.equal(source.battleInit.battleId, 'first');
  assert.equal(source.source.messageId, '1');
});
