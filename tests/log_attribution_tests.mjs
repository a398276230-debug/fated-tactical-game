import assert from 'node:assert/strict';
import { test } from 'node:test';
import { narrate } from '../src/ui/narrate.js';
import { applyAction } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { formatBattleReportText } from '../src/api/battle_report.js';

function setup(program) {
  const state = buildScenario('ruins');
  const actor = state.units.swordsman;
  const target = state.units.scout;
  target.x = actor.x + 1;
  target.y = actor.y;
  actor.skills.push('passive_reaction');
  state.skills.passive_reaction = {
    id: 'passive_reaction', name: '寒星回响', passive: true,
    rules: [{ id: 'echo_after_action', hook: 'after_action', filter: 'event.actorId == self.id', program }],
  };
  return { state, actor, target, action: { type: 'attack', x: target.x, y: target.y } };
}

test('passive VM logs identify skill, rule and original attack in UI and export', () => {
  const { state, actor, target, action } = setup([
    { op: 'damage', target: 'self', amount: 1, damageType: 'true', label: '回响' },
  ]);
  applyAction(state, action);
  const log = state.logs.find(entry => entry.type === 'damage' && entry.detail?.attribution);
  assert.ok(log, 'passive damage log exists');
  assert.deepEqual(log.detail.attribution, {
    carrierType: 'skill', skillId: 'passive_reaction', skillName: '寒星回响',
    ruleId: 'echo_after_action', action: { type: 'attack' },
  });
  const report = formatBattleReportText({ title: '测试', units: Object.values(state.units), rounds: [{ round: 1, events: state.logs }] });
  assert.match(report, /寒星回响/);
  assert.match(report, /echo_after_action/);
  assert.match(report, /源行动：普通攻击/);
  assert.match(narrate(log, state).lines.join(' '), /寒星回响.*echo_after_action.*普通攻击/);
  assert.equal(log.detail.amount, 1);
  assert.equal(log.detail.rawAmount, undefined);
  assert.equal(actor.hp, actor.maxHp - 1);
});

test('attribution survives an ask suspension and is attached after resume', () => {
  const { state, actor, action } = setup([
    { op: 'ask', chooser: 'self', kind: 'number', min: 1, max: 2, out: 'chosen', prompt: '选择伤害' },
    { op: 'damage', target: 'self', amount: 'vars.chosen', damageType: 'true', label: '挂起回响' },
  ]);
  applyAction(state, action);
  assert.ok(state.vm.pendingAsk, 'the passive rule is suspended at ask');
  const askId = state.vm.pendingAsk.askId;
  const resumed = JSON.parse(JSON.stringify(state));
  applyAction(resumed, { type: 'answer', askId, value: 2 });
  const log = resumed.logs.find(entry => entry.type === 'damage' && entry.detail?.attribution?.skillId === 'passive_reaction');
  assert.ok(log, 'resumed passive damage log exists');
  assert.equal(log.detail.amount, 2);
  assert.equal(log.detail.attribution.skillName, '寒星回响');
  assert.equal(log.detail.attribution.ruleId, 'echo_after_action');
  assert.equal(log.detail.attribution.action.type, 'attack');
  assert.equal(resumed.units[actor.id].hp, actor.hp - 2);
});

test('prose rounds floating point noise without changing structured values', () => {
  const report = formatBattleReportText({ title: '测试', units: [{ id: 'u', name: '单位', x: 1, y: 1 }], rounds: [{ round: 1, events: [{
    type: 'resource', actor: 'u', text: '单位恢复122.000000000003点 MP', detail: { resource: 'mp', before: 114960, after: 115082.00000000001 }, positions: { u: { x: 1, y: 1 } },
  }] }] });
  assert.doesNotMatch(report, /000000/);
  assert.match(report, /114960 → 115082/);
});
