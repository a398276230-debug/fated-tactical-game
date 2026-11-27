import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, preview } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';
import { resolveVMAction } from '../src/core/vm-runtime.js';

function fixture() {
  const state = buildScenario('ruins');
  const unit = state.units.swordsman;
  state.turn = state.order.indexOf(unit.id);
  unit.ap = 2;
  unit.used = { attack: 0, action: 0 };
  state.skills.orthogonal = { name: '试验法术', ap: 1, slot: 'action', mp: 4, sp: 2, range: 0, target: 'self', shape: 'single', tags: ['fire'],
    rules: [{ id: 'cast', hook: 'active', program: [{ op: 'let', scope: 'owner', name: 'castOnce', value: 1 }] }] };
  unit.skills.push('orthogonal');
  const action = { type: 'skill', skillId: 'orthogonal', x: unit.x, y: unit.y };
  const set = (key, amount) => updatePoolCurrent(state, getPool(state, unit.id, key).id, 'set', amount);
  return { state, unit, action, set };
}

const observe = (hook, name, value, filter) => ({ id: name, hook, filter, program: [{ op: 'let', scope: 'owner', name, value }] });

test('费用按池缩放，门禁读取最终成本与标签，原生攻击保留准入', () => {
  const { state, unit, action } = fixture();
  unit.mods = [
    { stat: 'costFlat', flat: 2 },
    { stat: 'costFlat', pool: 'mp', flat: 3 },
    { stat: 'costMult', pool: 'mp', mult: 2 },
    { forbidAction: true, forbidReason: '缄默', when: "event.mpCost > 0 && has_tag(event, 'fire')" },
  ];
  const plan = preview(state, action);
  assert.equal(plan.error, '缄默');
  assert.deepEqual([plan.hp, plan.mp, plan.sp, plan.forbidden], [0, 18, 4, true]);
  assert.equal(preview(state, { type: 'attack' }).ok, true);
  unit.mods = [{ stat: 'costMult', pool: 'sp', mult: 0.5 }];
  unit.shield = 'fixture-shield';
  assert.equal(preview(state, { type: 'shield_bash' }).sp, 1);
});

test('血代蓝单跳，保留 1 HP，预览与执行使用同一账单', () => {
  const { state, unit, action, set } = fixture();
  state.skills.orthogonal.resourceCost = { hp: 2 };
  set('mp', 0);
  unit.mods = [
    { costRedirect: { from: 'mp', to: 'hp', ratio: 2 }, when: 'event.mpCost == 4' },
    { costRedirect: { from: 'hp', to: 'sp', ratio: 0.25 } },
    { costRedirect: { from: 'mp', to: 'sp' } },
    { forbidAction: true, when: 'event.mpCost > 0' },
  ];
  unit.rules = [observe('before_action', 'hpBill', 'event.hpCost'), observe('after_action', 'spBill', 'event.spCost')];
  set('hp', 8);
  assert.match(preview(state, action).error, /HP 不足/);
  set('hp', 9);
  const sp = unit.sp;
  const plan = preview(state, action);
  assert.ok(plan.ok, plan.error);
  assert.deepEqual([plan.hp, plan.mp, plan.sp], [8, 0, 3]);
  applyAction(state, action);
  assert.deepEqual([unit.hp, unit.mp, unit.sp, unit.vars.hpBill, unit.vars.spBill], [1, 0, sp - 3, 8, 3]);
});

test('非打击动作走动作钩子，确定性取消变为预览禁用且不消耗 AP', () => {
  const { state, unit } = fixture();
  const brace = { type: 'brace' };
  unit.rules = [
    { id: 'stop', hook: 'before_action', filter: "event.actionType == 'brace' && event.apCost == 1 && event.slot == 'action'",
      program: [{ op: 'mutate_event', patch: { cancel: true } }] },
    observe('after_action', 'acted', 'event.apCost'),
  ];
  const plan = preview(state, brace);
  assert.equal(plan.forbidden, true);
  assert.match(plan.error, /拦截/);
  assert.equal(unit.ap, 2);
  assert.equal(resolveVMAction(state, brace).canceled, true);
  assert.equal(unit.ap, 2);
  assert.equal(unit.vars?.acted, undefined);
  unit.rules.shift();
  assert.equal(preview(state, brace).ok, true);
  applyAction(state, brace);
  assert.equal(unit.vars.acted, 1);
  assert.equal(unit.ap, 1);
});
