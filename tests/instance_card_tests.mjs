import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillInstance, ruleSummary, skillDisplay } from '../src/tavern/instance-card.js';

function cardText(unit, state) {
  const make = (tag, attrs = {}, value = '') => ({
    tag, attrs, value, children: [], dataset: {}, style: { setProperty() {} }, classList: { add() {} },
    append(...nodes) { this.children.push(...nodes); },
    addEventListener() {},
    get textContent() { return [this.value, ...this.children.map(node => node.textContent)].join('\\n'); },
  });
  const { body } = fillInstance(make('article'), make, unit, state, {}, make('input'));
  return body.textContent;
}

test('instance card summarizes fly and teleport locks, guaranteed flags, despawn and revive', () => {
  const text = cardText({ id: 'u1', gear: ['item'], skills: [] }, {
    items: { item: { templateId: 'equipment' } },
    equipment: { equipment: { name: '护符', mods: [{ locks: ['fly', 'teleport'], flags: ['guaranteed_hit', 'guaranteed_crit'] }] } },
    skills: {},
  });
  assert.match(text, /禁止升空、瞬移/);
  assert.match(text, /必定命中/);
  assert.match(text, /必定暴击/);
  assert.match(ruleSummary({ hook: 'active', program: [{ op: 'despawn' }] }), /主动 → 移除/);
  assert.match(ruleSummary({ hook: 'active', program: [{ op: 'revive' }] }), /主动 → 复活/);
  assert.doesNotMatch(text, /undefined/);
});

test('skill card shows every active mixed-damage component and its determinate amount', () => {
  const display = skillDisplay({
    damage: { count: 1, sides: 4, stat: 'int', type: 'physical' },
    rules: [{ hook: 'active', program: [{ op: 'if', then: [{ op: 'damage', damageType: 'energy', amount: 'event.power * 0.5' }] }] }],
  });
  assert.equal(display.damage, '物理 1d4 + 智力、能量 按公式 event.power * 0.5');
});

test('instance card and skill display use custom element labels', () => {
  const state = { customElements: { void: { id: 'void', name: '虚空', category: 'energy' } }, items: {}, equipment: {}, skills: {} };
  const text = cardText({ id: 'u1', skills: ['void_skill'] }, { ...state, skills: { void_skill: { name: '虚空裂隙', damageType: 'void' } } });
  assert.match(text, /虚空/);
  assert.equal(skillDisplay({ damageType: 'void' }, {}, state.customElements).damage, '虚空');
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
