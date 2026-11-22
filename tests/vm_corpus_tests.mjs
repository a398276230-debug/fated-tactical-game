import assert from 'node:assert/strict';
import { buildScenario } from '../src/presets/scenarios.js';
import { resolveVMAction } from '../src/core/vm-runtime.js';
import { validVmRule } from '../src/core/vm-schema.js';
import { createGameAPI } from '../src/api/game_api.js';

const skill = (name, program, shape = 'single') => ({ name, ap: 1, slot: 'attack', range: 10, shape,
  target: 'any', rules: [{ id: 'active', hook: 'active', program }] });
const resource = (pool, amount) => ({ op: 'resource', target: 'self', pool, mode: 'set', amount });
const damage = (target, amount) => ({ op: 'damage', target, amount, damageType: 'true' });
function fixture() {
  const state = buildScenario('ruins');
  const first = Object.values(state.units).find(unit => unit.team === 'blue');
  const second = Object.values(state.units).find(unit => unit.team === 'red');
  state.units = { [first.id]: first, [second.id]: second };
  state.order = [first.id, second.id];
  state.turn = 0;
  state.ruleset = 'sandbox';
  state.outcome = null;
  delete state.vm;
  delete state.pools;
  for (const carrier of [...Object.values(state.units), ...Object.values(state.items)]) delete carrier.pools;
  state.logs = [];
  state.covers = {};
  state.zones = {};
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  Object.assign(first, { x: 1, y: 1, ap: 2, used: { attack: 0, action: 0 }, statuses: {}, skills: [] });
  Object.assign(second, { x: 2, y: 1, ap: 2, used: { attack: 0, action: 0 }, statuses: {}, skills: [] });
  return { state, first, second };
}

{
  const { state, first, second } = fixture();
  Object.assign(first, { hp: 50, maxHp: 100, mp: 0, maxMp: 100, sp: 10, maxSp: 100 });
  Object.assign(second, { hp: 100, maxHp: 100 });
  state.statusTemplates = { fading_glimmer: { name: '回光黯淡', category: 'special' } };
  first.rules = [{ id: 'reburn_lethal', hook: 'on_lethal_p2', usesPerBattle: 2, filter: 'target.id == self.id', program: [
    { op: 'mutate_event', patch: { preventDeath: true } }, resource('hp', 1),
    { op: 'apply_status', target: 'self', statusId: 'fading_glimmer', turns: 1 },
    { op: 'perform', actor: 'self', actionKind: 'skill', skillId: 'withered_fire_rain', target: { from: 'units', where: 'candidate.team != self.team', pick: { first: 1 } }, overrides: { free: true, ignoreSlots: true } },
    { op: 'remove_status', target: 'self', where: "status.id == 'fading_glimmer'" },
    resource(['hp', 'mp', 'sp'], "pool == 'hp' ? self.maxHp : (pool == 'mp' ? self.maxMp : self.maxSp)"),
  ] }];
  assert.ok(validVmRule(first.rules[0], { statusTemplates: state.statusTemplates }));
  state.skills = {
    withered_fire_rain: skill('枯朽燃雨', [{ op: 'if', cond: "has_status(self, 'fading_glimmer')", then: [damage('target', 10)] }]),
    fatal: skill('致死打击', [damage('target', 500)]),
  };
  first.skills.push('withered_fire_rain');
  second.skills.push('fatal');
  for (let turn = 1; turn <= 3; turn++) {
    Object.assign(second, { ap: 2, used: { attack: 0, action: 0 } });
    resolveVMAction(state, { type: 'skill', skillId: 'fatal', x: first.x, y: first.y }, { actor: second });
    assert.equal(first.hp, turn < 3 ? first.maxHp : 0);
    assert.equal(first.mp, first.maxMp);
    assert.equal(first.sp, first.maxSp);
    assert.equal(second.hp, 100 - Math.min(turn, 2) * 10);
    assert.deepEqual([first.x, first.y], [1, 1]);
    assert.equal(state.logs.filter(log => log.type === 'defeat').length, turn < 3 ? 0 : 1);
    assert.equal(first.statuses.fading_glimmer, undefined);
  }
  const types = state.logs.map(log => log.type);
  assert.ok(types.indexOf('status') < types.lastIndexOf('cleanse'));
  assert.ok(state.logs.every(log => log.positions[first.id]));
}

{
  const { state, first, second } = fixture();
  first.rules = [{ id: 'split', hook: 'before_commit', filter: "event.commitKind == 'damage' && self.id == attacker.id", program: [
    { op: 'ask', chooser: 'self', kind: 'number', prompt: '选择实伤', out: 'landed', aiPolicy: 'max', min: 0, max: 'event.finalAmount' },
    { op: 'mutate_event', patch: { finalAmount: 'vars.landed' } },
  ] }];
  Object.assign(second, { hp: 100, maxHp: 100 });
  state.skills = { split: skill('分流', [damage('target', 50)]) };
  first.skills.push('split');
  const action = { type: 'skill', skillId: 'split', x: second.x, y: second.y };
  const origin = JSON.stringify(state);
  const preview = resolveVMAction(state, action, { dryRun: true });
  assert.equal(preview.conditional, true);
  assert.equal(JSON.stringify(state), origin);
  const { pendingAsk } = resolveVMAction(state, action);
  assert.equal(second.hp, 100);
  assert.deepEqual(pendingAsk.options, { min: 0, max: 50, step: 1 });
  assert.throws(() => resolveVMAction(state, { type: 'answer', askId: pendingAsk.askId, value: 51 }));
  const saved = JSON.parse(JSON.stringify(state));
  const answer = { type: 'answer', askId: pendingAsk.askId, value: 20 };
  resolveVMAction(state, answer);
  resolveVMAction(saved, answer);
  assert.equal(second.hp, 80);
  assert.equal(JSON.stringify(state), JSON.stringify(saved));
}

{
  const game = createGameAPI();
  const state = buildScenario('ruins');
  const actor = state.units[state.order[state.turn]];
  actor.team = 'blue';
  actor.skills.push('choose_twice');
  state.skills.choose_twice = { ...skill('两段瞬移', [
    { op: 'ask', chooser: 'self', kind: 'cell', prompt: '选择突入格', out: 'in', aiPolicy: 'first', select: { from: 'cells', where: 'candidate.x == 4 && candidate.y == 4' } },
    { op: 'move', target: 'self', mode: 'teleport', to: 'vars.in' },
    { op: 'ask', chooser: 'self', kind: 'cell', prompt: '选择折返格', out: 'back', aiPolicy: 'first', select: { from: 'cells', where: 'candidate.x == 3 && candidate.y == 4' } },
    { op: 'move', target: 'self', mode: 'teleport', to: 'vars.back' },
  ]), target: 'self' };
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  for (const unit of Object.values(state.units)) if (unit.y === 4 && [3, 4].includes(unit.x)) unit.y = 3;
  game.createBattle({ kind: 'custom_state', state });
  game.playAction({ type: 'skill', skillId: 'choose_twice', x: actor.x, y: actor.y });
  let ask = game.getBattleState().vm.pendingAsk;
  assert.throws(() => game.playAction({ type: 'end' }));
  game.playAction({ type: 'answer', askId: ask.askId, x: 4, y: 4 });
  ask = game.getBattleState().vm.pendingAsk;
  const suspended = JSON.parse(JSON.stringify(game.exportBattleSnapshot()));
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(suspended);
  const answer = { type: 'answer', askId: ask.askId, x: 3, y: 4 };
  game.playAction(answer);
  restored.playAction(answer);
  assert.equal(JSON.stringify(restored.exportBattleSnapshot()), JSON.stringify(game.exportBattleSnapshot()));
  assert.deepEqual([game.getBattleState().units[actor.id].x, game.getBattleState().units[actor.id].y], [3, 4]);
}

{
  const { state, first, second } = fixture();
  Object.assign(first, { hp: 50, maxHp: 100 });
  Object.assign(second, { hp: 100, maxHp: 100 });
  const enemies = { from: 'units', where: 'candidate.team != self.team' };
  const program = [{ op: 'for_each', select: enemies, bind: 'victim', body: [
    { op: 'apply_status', target: 'vars.victim', statusId: 'stun' },
    { op: 'ask', chooser: 'self', kind: 'entity', prompt: '选择受术者', out: 'chosen', aiPolicy: 'first', select: enemies },
    { op: 'for_each', select: { from: 'self' }, bind: 'other', body: [
      { op: 'if', cond: "vars.other.id == self.id && vars.chosen.id == vars.victim.id && vars.victim.hp == 100 && has_status(vars.chosen, 'stun')", then: [
        damage('vars.victim', 3), damage('vars.chosen', 4),
      ] },
    ] },
  ] }];
  state.skills = { refs: skill('实体引用', program) };
  first.skills.push('refs');
  assert.ok(validVmRule(state.skills.refs.rules[0]));
  const { pendingAsk } = resolveVMAction(state, { type: 'skill', skillId: 'refs', x: second.x, y: second.y });
  assert.ok(pendingAsk.options.some(option => option.id === second.id));
  const saved = JSON.parse(JSON.stringify(state));
  const answer = { type: 'answer', askId: pendingAsk.askId, value: second.id };
  resolveVMAction(state, answer);
  resolveVMAction(saved, answer);
  assert.equal(second.hp, 93);
  assert.equal(first.hp, 50);
  assert.deepEqual(saved, state);
}

{
  const game = createGameAPI();
  const state = buildScenario('ruins');
  const actor = state.units[state.order[state.turn]];
  const select = { from: 'units', where: 'candidate.team != self.team' };
  const multi = { op: 'ask', chooser: 'self', kind: 'entity', prompt: '选多个目标', out: 'chosen', aiPolicy: 'first', select, maxSelect: 2 };
  state.skills.multi = { ...skill('多选', [multi,
    { op: 'for_each', select: { from: 'vars.chosen' }, bind: 'victim', body: [damage('vars.victim', 1)] },
  ]), target: 'self' };
  actor.skills.push('multi');
  const action = { type: 'skill', skillId: 'multi', x: actor.x, y: actor.y };
  assert.ok(validVmRule(state.skills.multi.rules[0]));
  for (const maxSelect of [0, 201, 1.5]) {
    assert.equal(validVmRule({ id: 'invalid', hook: 'active', program: [{ ...multi, maxSelect }] }), false);
  }
  assert.equal(validVmRule({ id: 'invalid', hook: 'active', program: [{ ...multi, kind: 'cell' }] }), false);
  game.createBattle({ kind: 'custom_state', state });
  const before = game.getBattleState();
  const preview = resolveVMAction(before, action, { dryRun: true });
  assert.equal(preview.conditional, true);
  assert.equal(preview.pendingAsk, null);
  const automaticId = preview.state.tape.at(-1).targetSpec.answers[0][0];
  assert.equal(preview.state.units[automaticId].hp, before.units[automaticId].hp - 1);

  game.playAction(action);
  const serialize = () => JSON.stringify(game.exportBattleSnapshot());
  const suspended = serialize();
  const pendingSnapshot = JSON.parse(suspended);
  const ask = pendingSnapshot.state.vm.pendingAsk;
  assert.equal(ask.maxSelect, 2);
  const [first, second, third] = ask.options;
  assert.equal(automaticId, first.id);
  for (const value of [first.id, [], [first.id, first.id], [first.id, 'unknown'], [first.id, 3], [first.id, second.id, third.id]]) {
    assert.throws(() => game.playAction({ type: 'answer', askId: ask.askId, value }));
  }
  assert.throws(() => game.playAction({ type: 'answer', askId: 'stale', value: [first.id] }));
  assert.equal(serialize(), suspended);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(pendingSnapshot);
  const answer = { type: 'answer', askId: ask.askId, value: [second.id, first.id] };
  game.playAction(answer);
  restored.playAction(answer);
  const after = game.getBattleState();
  assert.equal(after.vm.pendingAsk, null);
  assert.equal(after.units[first.id].hp, before.units[first.id].hp - 1);
  assert.equal(after.units[second.id].hp, before.units[second.id].hp - 1);
  assert.equal(after.units[third.id].hp, before.units[third.id].hp);
  assert.deepEqual(after.tape.at(-1).targetSpec.answers, [[first.id, second.id]]);
  assert.ok(after.logs.some(log => log.type === 'choice' && log.text.includes(`${first.label}、${second.label}`)));
  const completed = JSON.parse(JSON.stringify(game.exportBattleSnapshot()));
  assert.deepEqual(restored.exportBattleSnapshot(), game.exportBattleSnapshot());
  restored.restoreBattleSnapshot(completed);
  assert.deepEqual(restored.getBattleState(), after);
}

console.log('ok VM corpus: 复燃, suspension, entity references, multi-selection, and API replay');
