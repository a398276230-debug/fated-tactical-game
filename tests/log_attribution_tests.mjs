import assert from 'node:assert/strict';
import { test } from 'node:test';
import { narrate } from '../src/ui/narrate.js';
import { applyAction } from '../src/core/combat.js';
import { commitVMEffect } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { formatBattleReportText } from '../src/api/battle_report.js';
import { createGameAPI } from '../src/api/game_api.js';

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
  const choice = resumed.logs.find(entry => entry.type === 'choice');
  assert.equal(choice.detail.choice.automatic, false);
  assert.match(narrate(choice, resumed).title, /选择「选择伤害」：2/);
  const log = resumed.logs.find(entry => entry.type === 'damage' && entry.detail?.attribution?.skillId === 'passive_reaction');
  assert.ok(log, 'resumed passive damage log exists');
  assert.equal(log.detail.amount, 2);
  assert.equal(log.detail.attribution.skillName, '寒星回响');
  assert.equal(log.detail.attribution.ruleId, 'echo_after_action');
  assert.equal(log.detail.attribution.action.type, 'attack');
  assert.equal(resumed.units[actor.id].hp, actor.hp - 2);
});

test('battle report explains automatic cell selections and the amount pending in a damage choice', () => {
  const { state, actor, target } = setup([]);
  state.skills.passive_reaction.rules = [{ id: 'warlord_choice', hook: 'before_commit', filter: "event.commitKind == 'damage' && attacker.id == self.id", program: [
    { op: 'ask', chooser: 'self', kind: 'cell', prompt: '选择混沌球体引爆位置', select: { from: 'cells', where: 'candidate.x == 8 && candidate.y == 7' }, out: 'center', aiPolicy: 'first' },
    { op: 'ask', chooser: 'self', kind: 'number', prompt: '选择实际生效数值', min: 0, max: 'event.finalAmount', out: 'amount', aiPolicy: 'max' },
  ] }];
  actor.controlPolicy = { controller: 'ai' };
  const remainingHp = target.hp;
  commitVMEffect(state, { op: 'damage', damageType: 'true', amount: 10316, sourceId: actor.id, targetId: target.id });
  assert.equal(state.logs.find(entry => entry.type === 'damage').detail.amount, remainingHp);
  const choices = state.logs.filter(entry => entry.type === 'choice');
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[0].detail.choice.value, {x: 8, y: 7});
  assert.equal(choices[1].detail.choice.automatic, true);
  const report = formatBattleReportText({ title: '测试', units: Object.values(state.units), rounds: [{ round: 1, events: state.logs }] });
  assert.match(report, /自动选择「选择混沌球体引爆位置」：\(8, 7\)/);
  assert.match(report, /自动选择「选择实际生效数值」：10316.*伤害，待结算 10316.*可选范围 0 至 10316.*寒星回响.*warlord_choice/);
  assert.match(narrate(choices[1], state).lines.join(' '), /待结算 10316.*寒星回响/);
});

test('old choice logs regain their prompt when importing a journaled battle', () => {
  const { state, action } = setup([{ op: 'ask', chooser: 'self', kind: 'number', min: 1, max: 2,
    out: 'chosen', prompt: '决定效果数值', aiPolicy: 'max' }]);
  delete state.skills.passive_reaction.id;
  Object.assign(state.skills.passive_reaction, {ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self'});
  const game = createGameAPI();
  game.createBattle({kind: 'custom_state', state});
  game.playAction(action);
  game.playAction({type: 'answer', askId: game.getBattleState().vm.pendingAsk.askId, value: 2});
  const saved = game.exportBattleSnapshot();
  const choice = saved.state.logs.find(log => log.type === 'choice');
  choice.text = `${state.units[choice.actor].name}选择了2`;
  delete choice.detail.choice;
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(saved);
  assert.deepEqual(restored.getBattleState(), game.getBattleState());
  choice.text = `${state.units[choice.actor].name}选择了1`;
  assert.throws(() => restored.restoreBattleSnapshot(saved), /重放不一致/);
});

test('prose rounds floating point noise without changing structured values', () => {
  const report = formatBattleReportText({ title: '测试', units: [{ id: 'u', name: '单位', x: 1, y: 1 }], rounds: [{ round: 1, events: [{
    type: 'resource', actor: 'u', text: '单位恢复122.000000000003点 MP', detail: { resource: 'mp', before: 114960, after: 115082.00000000001 }, positions: { u: { x: 1, y: 1 } },
  }] }] });
  assert.doesNotMatch(report, /000000/);
  assert.match(report, /114960 → 115082/);
});
