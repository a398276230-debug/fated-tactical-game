import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlayback } from '../src/ui/animation.js';

test('动画播放打碎掩体时保留施法者血量，单位受伤仍更新血量', async () => {
  const root = {
    ownerDocument: { defaultView: { setTimeout: fn => setTimeout(fn, 0), clearTimeout } },
    querySelector: () => null,
    querySelectorAll: () => [],
    dataset: {},
  };
  const before = { units: { p1: { hp: 4046 }, e3: { hp: 1428 } }, logs: [] };
  const after = {
    units: { p1: { hp: 4046 }, e3: { hp: 630 } },
    logs: [
      { type: 'damage', actor: 'p1', text: '荆棘兽受伤', detail: { targetId: 'e3', amount: 798, hpAfter: 630 } },
      { type: 'cover_damage', actor: 'p1', text: '倒木受伤', detail: { coverId: 'c2', amount: 40, hpAfter: 0 } },
    ],
  };
  const frames = [];
  await new Promise(resolve => {
    const playback = createPlayback(root, {
      show: state => frames.push([state.units.p1.hp, state.units.e3.hp]),
      onIdle: resolve,
    });
    assert.equal(playback.enqueue(before, after), true);
  });
  assert.deepEqual(frames, [[4046, 1428], [4046, 630], [4046, 630], [4046, 630]]);
});
