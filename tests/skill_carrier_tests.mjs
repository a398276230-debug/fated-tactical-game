import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, equippedActiveSkills, preview } from '../src/core/combat.js';
import { aimedOptions } from '../src/core/ai.js';
import { getPool } from '../src/core/vm-pools.js';

const rule = (id, hook, program, fields = {}) => ({ id, hook, program, ...fields });
const skill = fields => ({ name: '测试技能', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self', ...fields });
const resource = (pool, amount, local = false) => ({ op: 'resource', target: 'self', pool, mode: 'sub', amount, local });

function fixture() {
  const state = buildScenario('ruins');
  const actor = state.units[state.order[state.turn]];
  actor.skills = [];
  return { state, actor };
}

test('held skill hooks run once when cast and while another skill is cast', () => {
  const { state, actor } = fixture();
  state.skills.both = skill({ ap: 0, rules: [rule('cast', 'active', []), rule('watch', 'after_action', [resource('mp', 1)])] });
  state.skills.passive = skill({ passive: true, rules: [rule('watch', 'after_action', [resource('sp', 1)])] });
  state.skills.other = skill({ ap: 0, rules: [] });
  actor.skills = ['both', 'passive', 'other'];
  const { mp, sp } = actor;
  const cast = skillId => ({ type: 'skill', skillId, x: actor.x, y: actor.y });
  assert.match(preview(state, cast('passive')).error, /被动/);
  applyAction(state, cast('both'));
  assert.equal(actor.mp, mp - 1);
  assert.equal(actor.sp, sp - 1);
  applyAction(state, cast('other'));
  assert.equal(actor.mp, mp - 2);
  assert.equal(actor.sp, sp - 2);
  assert.ok(!aimedOptions(state, actor).some(({ action }) => ['both', 'other', 'passive'].includes(action.skillId)));
});

test('virtual equipment skills retain item pool context and ignore occupied action slots', () => {
  const { state, actor } = fixture();
  const id = 'active-trinket', templateId = 'trinket';
  actor.gear.push(id);
  actor.ap = 1;
  actor.used.action = 1;
  state.items[id] = { id, templateId, rules: [rule('instance', 'active', [])] };
  state.equipment[templateId] = { name: '饰品', kind: 'accessory', pools: { charge: { cap: 2, initial: 2 } },
    rules: [rule('expend', 'active', [resource('charge', 1, true)], { usesPerTurn: 1 })] };
  const active = `equip:${id}:expend`;
  assert.deepEqual(equippedActiveSkills(state, actor).map(([id]) => id), [active, `equip:${id}:instance`]);
  const action = { type: 'skill', skillId: active };
  assert.equal(preview(state, action).ap, 0);
  applyAction(state, action);
  assert.equal(getPool(state, id, 'charge', 'item').current, 1);
  assert.equal(actor.ap, 1);
  assert.deepEqual(actor.used, { attack: 0, action: 1 });
  assert.match(preview(state, action).error, /次数/);
  actor.mods = [{ locks: ['action'] }];
  assert.match(preview(state, { type: 'skill', skillId: `equip:${id}:instance` }).error, /锁定/);
});

test('a shared skill template keeps owner variables private to each holder', () => {
  const { state, actor } = fixture();
  const second = Object.values(state.units).find(unit => unit.id !== actor.id);
  actor.skills = second.skills = ['shared'];
  state.skills.shared = skill({ ap: 0, vars: { count: 0 }, rules: [rule('count', 'active', [
    { op: 'let', scope: 'owner', name: 'count', value: 'skill.vars.count + 1' },
    resource('mp', 'skill.vars.count'),
  ])] });
  const before = actor.mp;
  const action = { type: 'skill', skillId: 'shared', x: actor.x, y: actor.y };
  applyAction(state, action);
  applyAction(state, action);
  assert.equal(actor.mp, before - 3);
  assert.equal(state.skills.shared.vars.count, 0);
  assert.equal(state.vm.skillVars[JSON.stringify([second.id, 'shared'])], undefined);
});
