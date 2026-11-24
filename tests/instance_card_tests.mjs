import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skillDisplay } from '../src/tavern/instance-card.js';

test('skill card shows every active mixed-damage component and its determinate amount', () => {
  const display = skillDisplay({
    damage: { count: 1, sides: 4, stat: 'int', type: 'physical' },
    rules: [{ hook: 'active', program: [{ op: 'if', then: [{ op: 'damage', damageType: 'energy', amount: 'event.power * 0.5' }] }] }],
  });
  assert.equal(display.damage, '物理 1d4 + 智力、能量 按公式 event.power * 0.5');
});

test('skill card does not imply zero costs and separates cast range from area', () => {
  const display = skillDisplay({ ap: 1, sp: 0, mp: 0, range: 8, shape: 'circle', radius: 2 });
  assert.deepEqual(display.costs, []);
  assert.equal(display.range, 8);
  assert.equal(display.area, '圆形，半径 2');
});

test('skill card ignores non-active damage hooks when describing the main hit', () => {
  const display = skillDisplay({
    rules: [
      { hook: 'after_hit', program: [{ op: 'damage', damageType: 'true', amount: 9 }] },
      { hook: 'active', program: [{ op: 'damage', damageType: 'mental', amount: 3 }] },
    ],
  });
  assert.equal(display.damage, '精神 3');
});
