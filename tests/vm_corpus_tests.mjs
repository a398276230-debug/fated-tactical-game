import assert from 'node:assert/strict';
import { buildScenario } from '../src/presets/scenarios.js';
import { commitVMEffect, dispatchVMHook, resolveVMAction } from '../src/core/vm-runtime.js';
import { applyAction, beginBattle, grantStatus } from '../src/core/combat.js';
import { applyPatch } from '../src/tavern/overlay.js';
import { test } from 'node:test';
import { tactics } from '../src/core/ai.js';
import { validVmRule } from '../src/core/vm-schema.js';
import { createGameAPI } from '../src/api/game_api.js';
import { validateState } from '../src/api/validation.js';

const skill = (name, program, shape = 'single') => ({ name, ap: 1, slot: 'attack', range: 10, shape,
  target: 'any', rules: [{ id: 'active', hook: 'active', program }] });
const resource = (pool, amount) => ({ op: 'resource', target: 'self', pool, mode: 'set', amount });
const damage = (target, amount) => ({ op: 'damage', target, amount, damageType: 'true' });

test('held three-pool last chance intercepts exactly once; only real death triggers killer passive', () => {
  const { state, first, second } = fixture();
  Object.assign(first, { mp: 0, sp: 0 });
  second.mp = 0;
  first.skills = ['ice_coffin'];
  second.skills = ['reward'];
  state.skills.ice_coffin = { ...skill('冰棺', []), passive: true, rules: [{ id: 'survive', hook: 'on_lethal_p2', usesPerBattle: 1,
    filter: 'self.hp == 0 && self.mp == 0 && self.sp == 0', program: [{ op: 'mutate_event', patch: { preventDeath: true } }] }] };
  state.skills.reward = { ...skill('击杀奖励', []), passive: true, rules: [{ id: 'reward_kill', hook: 'on_kill',
    program: [{ op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 1 }] }] };
  const strike = () => commitVMEffect(state, { op: 'damage', amount: 500000, damageType: 'true', sourceId: second.id, targetId: first.id });
  strike(); assert.equal(first.hp, 1); assert.equal(second.mp, 0);
  strike(); assert.equal(first.hp, 0); assert.equal(second.mp, 1);
});
for (const hook of ['on_lethal_p1', 'on_lethal_p2']) {
  test(`${hook} can heal a dying unit before death is recorded`, () => {
    const { state, first, second } = fixture();
    first.rules = [{ id: 'rescue', hook, program: [{ op: 'heal', target: 'self', amount: 7 }] }];
    commitVMEffect(state, { op: 'damage', amount: first.hp, damageType: 'true', sourceId: second.id, targetId: first.id });
    assert.equal(first.hp, 7);
    assert.equal(first.diedAt, undefined);
  });
}

for (const stunned of [false, true]) {
  test(`turn_start resumes without restarting the turn (stunned: ${stunned})`, () => {
    const { state } = fixture();
    const opening = beginBattle(structuredClone(state));
    const actor = state.units[opening.order[opening.turn]];
    state.logs = [];
    actor.mods = [{ stat: 'apMax', flat: 1 }, ...(stunned ? [{ locks: ['attack', 'action', 'move', 'cast'] }] : [])];
    actor.rules = [{ id: 'question', hook: 'turn_start', program: [damage('self', 1),
      { op: 'ask', chooser: 'self', kind: 'number', out: 'n', min: 0, max: 1, prompt: '回合开始', aiPolicy: 'min' }] }];
    actor.protagonist = true;
    const hp = actor.hp;
    beginBattle(state);
    assert.ok(state.vm.pendingAsk);
    assert.equal(actor.hp, hp - 1);
    assert.equal(actor.ap, 3);
    const resumed = JSON.parse(JSON.stringify(state));
    applyAction(resumed, { type: 'answer', askId: resumed.vm.pendingAsk.askId, value: 1 });
    assert.equal(resumed.units[actor.id].hp, hp - 1);
    assert.equal(resumed.logs.filter(log => log.type === 'turn' && log.actor === actor.id).length, 1);
    assert.equal(resumed.order[resumed.turn] === actor.id, !stunned);
  });
}

test('round-end choice pauses the cursor; round-start runs once at opening and after resume', () => {
  const {state, first} = fixture();
  first.rules = [{id:'start', hook:'round_start', program:[{op:'let',name:'started',scope:'owner',value:'round'}]},
    {id:'end', hook:'round_end', program:[{op:'ask',chooser:'self',kind:'number',out:'n',min:0,max:1,prompt:'轮末',aiPolicy:'min'}]}];
  beginBattle(state); assert.equal(first.vars.started, 1);
  state.turn = state.order.length - 1; applyAction(state, {type:'end'});
  assert.equal(state.round, 1); assert.equal(state.vm.pendingAsk.prompt, '轮末');
  const resumed = JSON.parse(JSON.stringify(state));
  applyAction(resumed, {type:'answer',askId:resumed.vm.pendingAsk.askId,value:1});
  assert.equal(resumed.round, 2); assert.equal(resumed.turn, 0); assert.equal(resumed.units[first.id].vars.started, 2);
});

test('natural expiry removes the pool and runs the status rule with its final snapshot', () => {
  const { state, first } = fixture();
  const api = createGameAPI();
  const rule = { id: 'last_words', hook: 'after_status_removed',
    program: [resource('mp', 'status.vars.value * status.stacks')] };
  state.statusTemplates.farewell = { id: 'farewell', name: '告别', maxStacks: 2, rules: [rule] };
  first.statuses.farewell = { ...state.statusTemplates.farewell, templateId: 'farewell', ownerId: first.id, sourceId: first.id,
    remainingTurns: 1, durationType: 'battle_turns', stackMode: 'refresh', stacks: 2, vars: { value: 4 }, pools: { marker: 'pool_marker' } };
  state.pools = { pool_marker: { id: 'pool_marker', kind: 'custom', current: 2, max: 2, reloadable: false,
    contributors: [{ ownerKind: 'status', ownerId: 'farewell', maxBase: 2 }] } };
  first.rules = [{ ...rule, id: 'observe_removal', filter: "status.id == 'farewell'",
    program: [{ op: 'let', scope: 'owner', name: 'observed', value: 'status.vars.value * status.stacks' }] }];
  api.createBattle({ kind: 'custom_state', state });
  api.playAction({ type: 'end' });
  const snapshot = api.exportBattleSnapshot();
  assert.equal(snapshot.state.pools.pool_marker, undefined);
  assert.equal(snapshot.state.units[first.id].vars.observed, 8);
  assert.equal(snapshot.state.units[first.id].mp, 8);
  assert.equal(snapshot.state.units[first.id].statuses.farewell, undefined);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(snapshot);
  assert.deepEqual(restored.exportBattleSnapshot(), snapshot);
});

test('perform recursion reaches its own depth limit and finishes the outer action', () => {
  const { state, first } = fixture();
  first.skills = ['echo'];
  state.skills.echo = { ...skill('回声', []), ap: 0, target: 'self' };
  first.rules = [{ id: 'repeat', hook: 'after_action', program: [
    { op: 'perform', actor: 'self', actionKind: 'skill', skillId: 'echo', target: 'self', overrides: { free: true, ignoreSlots: true } },
  ] }];
  resolveVMAction(state, { type: 'skill', skillId: 'echo', x: first.x, y: first.y });
  assert.equal(state.logs.filter(log => log.type === 'warning' && log.text.includes('perform')).length, 1);
  assert.equal(state.logs.some(log => log.type === 'vm_halt'), false);
  assert.equal(state.tape.at(-1).skillId, 'echo');
});

test('confirmed ally death reaches living allies without crediting self-kills', () => {
  const {state,first,second} = fixture();
  const ally = state.units.witness = {...structuredClone(first), id:'witness', rules:[{id:'notice',hook:'on_ally_death',program:[{op:'let',scope:'owner',name:'dead',value:'target.id'}]}]};
  grantStatus(state, first, 'mark', { expireOn: {hook:'after_damage',filter:'target.id == self.id && event.direct == false && event.dealt > 0'} });
  const hit = (amount,direct) => commitVMEffect(state,{op:'damage',amount,damageType:'true',direct,sourceId:second.id,targetId:first.id});
  hit(1,true); assert.ok(first.statuses.mark); hit(1,false); assert.equal(first.statuses.mark,undefined);
  hit(500000,true); assert.equal(ally.vars.dead,first.id); assert.equal(second.vars?.dead,undefined);
});

test('chance requires an explicit threshold, including legal zero', () => {
  const valid = node => validVmRule({id:'prob',hook:'active',program:[{op:'check',kind:'chance',...node}]});
  assert.equal(valid({}),false); assert.ok(valid({dc:0})); assert.ok(valid({dc:100}));
});

test('automatic choices rank only selected candidates without consuming an extra roll', () => {
  const {state,first,second} = fixture();
  state.skills.choices = {...skill('选位', ['safest_cell','best_offensive_cell','highest_threat'].map((aiPolicy,i) => ({
    op:'ask',kind:i===2?'entity':'cell',chooser:'self',prompt:aiPolicy,out:`p${i}`,aiPolicy,
    select:i===2?{from:'units'}:{from:'cells',where:'candidate.y == 1 && (candidate.x == 3 || candidate.x == 8)'}
  }))), target:'self'};
  first.skills = ['choices']; const {state:after} = resolveVMAction(state,{type:'skill',skillId:'choices',x:first.x,y:first.y},{dryRun:true});
  assert.deepEqual(after.tape.at(-1).targetSpec.answers,[{x:8,y:1},{x:3,y:1},second.id]);
  const plan = {ok:true,targets:[{id:second.id,expectedDamage:1}]};
  const score = () => tactics(state,first,{type:'attack'},plan);
  const base = score(); second.mods = [{locks:['move']}]; assert.equal(score(),base+8);
});

test('VM save exposes both original and effective DC to the after_check hook', () => {
  const { state, first, second } = fixture();
  first.skills = ['test_save'];
  first.mp = 0;
  first.mods = [{stat:'dcBonus',flat:5}];
  first.rules = [{id:'observe',hook:'after_check',filter:'event.baseDC == 30 && event.finalDC == 35',program:[resource('mp',1)]}];
  state.skills.test_save = skill('检定', [{op:'check',kind:'save',target:'target',stat:'con',dc:30}]);
  resolveVMAction(state,{type:'skill',skillId:'test_save',x:second.x,y:second.y});
  assert.equal(first.mp,1);
});
test('summon provenance distinguishes same-group specs from different active skills and survives eviction replay', () => {
  const { state, first } = fixture();
  const evict = { id: 'evict', hook: 'on_summon_evict',
    filter: "event.sourceSkillId == 'summon_a' && self.sourceSkillId == event.sourceSkillId && target.sourceSkillId == self.sourceSkillId",
    program: [{ op: 'ask', chooser: 'source', kind: 'number', min: 0, max: 1, prompt: '确认消散', out: 'choice', aiPolicy: 'min' }] };
  const spawn = { op: 'spawn', entityKind: 'unit', out: 'created', spec: { name: '同名召唤物', rules: [evict] } };
  const a = { ...skill('召唤甲', [spawn, {
    op: 'for_each', bind: 'matched', select: { from: 'units', where: "candidate.sourceSkillId == 'summon_a' && candidate.id == vars.created" },
    body: [{ op: 'if', cond: "vars.matched.sourceSkillId == 'summon_a' && vars.created.sourceSkillId == 'summon_a'",
      then: [{ op: 'let', scope: 'owner', name: 'verified', value: true }] }],
  }]), ap: 0, slot: 'action', target: 'self' };
  state.skills.summon_a = a;
  state.skills.summon_b = { ...a, name: '召唤乙', rules: [{ id: 'active', hook: 'active', program: [spawn] }] };
  first.skills = ['summon_a', 'summon_b'];
  const game = createGameAPI();
  game.createBattle({ kind: 'custom_state', state });
  const cast = skillId => game.playAction({ type: 'skill', skillId, x: first.x, y: first.y });
  cast('summon_a');
  cast('summon_b');
  const summoned = api => Object.values(api.getBattleState().units).filter(unit => unit.summoned);
  assert.deepEqual(summoned(game).map(unit => [unit.id, unit.sourceSkillId]), [['summon-1', 'summon_a'], ['summon-2', 'summon_b']]);
  assert.equal(game.getBattleState().vm.skillVars[JSON.stringify([first.id, 'summon_a'])].verified, true);
  cast('summon_a');
  const pending = game.getBattleState().vm.pendingAsk;
  assert.equal(pending.prompt, '确认消散');
  const snapshot = JSON.parse(JSON.stringify(game.exportBattleSnapshot()));
  validateState(snapshot.state);
  const malformed = structuredClone(snapshot.state);
  malformed.units['summon-1'].sourceSkillId = 'equip:bad';
  assert.throws(() => validateState(malformed), /sourceSkillId/);
  const restored = createGameAPI();
  const legacyPending = structuredClone(snapshot);
  for (const record of [...Object.values(legacyPending.state.units), ...legacyPending.state.vm.stack,
    ...Object.values(legacyPending.state.vm.events)]) delete record.sourceSkillId;
  restored.restoreBattleSnapshot(legacyPending);
  assert.deepEqual(restored.getBattleState(), game.getBattleState());
  restored.restoreBattleSnapshot(snapshot);
  const answer = { type: 'answer', askId: pending.askId, value: 1 };
  game.playAction(answer);
  restored.playAction(answer);
  assert.deepEqual(restored.getBattleState(), game.getBattleState());
  assert.deepEqual(summoned(game).map(unit => [unit.id, unit.sourceSkillId]), [['summon-2', 'summon_b'], ['summon-3', 'summon_a']]);
  const older = JSON.parse(JSON.stringify(game.exportBattleSnapshot()));
  for (const unit of Object.values(older.state.units)) delete unit.sourceSkillId;
  restored.restoreBattleSnapshot(older);
  assert.deepEqual(restored.getBattleState(), game.getBattleState());
  older.state.units['summon-3'].sourceSkillId = 'summon_b';
  assert.throws(() => restored.restoreBattleSnapshot(older), /重放不一致/);
});

test('summon provenance follows nested equipment rules and passive skill carriers', () => {
  const { state, first } = fixture();
  const equipId = first.mainHand ?? first.weapon;
  const template = state.equipment[state.items[equipId].templateId];
  const spawn = name => ({ op: 'spawn', entityKind: 'unit', spec: { name } });
  template.rules = [{ id: 'call', hook: 'active', program: [{ op: 'check', kind: 'chance', dc: 100, onPass: [
    { op: 'if', cond: true, then: [spawn('装备召唤')] },
  ] }] }];
  const equipSkillId = `equip:${equipId}:call`;
  state.skills.summon_passive = { ...skill('应召', []), passive: true, rules: [{ id: 'react', hook: 'after_action',
    filter: `event.skillId == '${equipSkillId}'`, program: [spawn('被动召唤')] }] };
  first.skills = ['summon_passive'];
  first.rules = [{ id: 'react_unit', hook: 'after_action', filter: `event.skillId == '${equipSkillId}'`, program: [spawn('单位规则召唤')] }];
  resolveVMAction(state, { type: 'skill', skillId: equipSkillId, x: first.x, y: first.y });
  const summoning = Object.fromEntries(Object.values(state.units).filter(unit => unit.summoned).map(unit => [unit.name, unit.sourceSkillId]));
  assert.deepEqual(summoning, { 装备召唤: equipSkillId, 被动召唤: 'summon_passive', 单位规则召唤: undefined });
  // Provenance remains valid if the actual producing item is no longer available.
  for (const slot of ['mainHand', 'weapon', 'offHand', 'shield']) if (first[slot] === equipId) first[slot] = null;
  for (const poolId of Object.values(state.items[equipId].pools ?? {})) delete state.pools[poolId];
  delete state.items[equipId];
  state.tape = []; // This fixture exercises unit provenance independently of tape validation.
  validateState(state);
});

test('turn_end choice holds the current turn through snapshot replay and advances exactly once', () => {
  const { state, first, second } = fixture();
  first.mp = 0;
  first.rules = [{ id: 'closing_choice', hook: 'turn_end', program: [
    { op: 'ask', chooser: 'self', kind: 'number', prompt: '回合末恢复量', min: 0, max: 5, out: 'amount', aiPolicy: 'max' },
    resource('mp', 'vars.amount'),
  ] }];
  const game = createGameAPI();
  game.createBattle({ kind: 'custom_state', state });
  game.playAction({ type: 'end' });
  const pending = game.getBattleState();
  assert.equal(pending.order[pending.turn], first.id);
  assert.ok(pending.vm.pendingAsk);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(JSON.parse(JSON.stringify(game.exportBattleSnapshot())));
  const answer = { type: 'answer', askId: pending.vm.pendingAsk.askId, value: 3 };
  game.playAction(answer);
  restored.playAction(answer);
  const result = game.getBattleState();
  assert.equal(result.order[result.turn], second.id);
  assert.equal(result.units[first.id].mp, 3);
  assert.equal(result.logs.filter(log => log.type === 'end' && log.actor === first.id).length, 1);
  assert.deepEqual(restored.getBattleState(), result);
});
test('turn tape preserves native movement, interaction and combat order across replay and snapshot suspension', () => {
  const { state, first, second } = fixture();
  Object.assign(first, { x: 1, y: 1, move: 4, hp: 40, reactionAvailable: false });
  Object.assign(second, { x: 4, y: 1, reactionAvailable: false });
  state.interactives = { altar: { id: 'altar', name: '祭坛', kind: 'altar', effect: 'heal', damage: 2, x: 3, y: 1, spent: false } };
  first.skills = ['tape_strike'];
  state.skills.tape_strike = skill('重演测试', [
    { op: 'ask', chooser: 'self', kind: 'number', prompt: '重演伤害', min: 1, max: 3, out: 'amount', aiPolicy: 'min' },
    damage('target', 'vars.amount'),
    { op: 'if', cond: 'self.resource.action == 0 && self.resource.attack == 0', then: [
      { op: 'resource', target: 'self', pool: 'action', mode: 'set', amount: 1 },
    ] },
  ]);
  first.rules = [{ id: 'repeat_turn', hook: 'turn_end', usesPerBattle: 1,
    filter: 'self.resource.attack == 0 && self.resource.action == 0', program: [
      { op: 'move', target: 'self', mode: 'teleport', to: { x: 1, y: 1 } },
      { op: 'for_each', select: { from: 'tape', where: 'candidate.actorId == self.id && candidate.round == round && candidate.turn == turn' },
        bind: 'entry', body: [{ op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord: 'vars.entry' }] },
    ] }];
  const game = createGameAPI();
  game.createBattle({ kind: 'custom_state', state });
  const askAnswer = (api, value) => ({ type: 'answer', askId: api.getBattleState().vm.pendingAsk.askId, value });
  game.playAction({ type: 'move', x: 3, y: 1 });
  game.playAction({ type: 'skill', skillId: 'tape_strike', x: 4, y: 1 });
  game.playAction(askAnswer(game, 1));
  game.playAction({ type: 'interact', x: 3, y: 1 });
  game.playAction({ type: 'end' });
  const pending = game.getBattleState();
  assert.deepEqual(pending.tape.map(row => [row.seq, row.actionType]), [[1, 'move'], [2, 'skill'], [3, 'interact']]);
  assert.deepEqual(pending.logs.filter(log => log.type === 'action').map(log => log.detail.action.type), ['move', 'skill', 'interact', 'move', 'skill']);
  assert.equal(pending.order[pending.turn], first.id);
  assert.equal(pending.units[first.id].x, 3);
  assert.equal(pending.logs.filter(log => log.type === 'end').length, 0);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(JSON.parse(JSON.stringify(game.exportBattleSnapshot())));
  assert.deepEqual(restored.getBattleState(), pending);
  const answer = askAnswer(game, 3);
  game.playAction(answer);
  restored.playAction(answer);
  const result = game.getBattleState();
  assert.deepEqual(restored.getBattleState(), result);
  assert.deepEqual(result.tape, pending.tape);
  assert.equal(result.order[result.turn], second.id);
  assert.equal(result.logs.filter(log => log.actor === first.id && log.type === 'end').length, 1);
  assert.equal(result.logs.filter(log => log.type === 'interact').length, 1);
  assert.equal(result.units[second.id].hp, second.hp - 4);
  game.playAction({ type: 'end' });
  game.playAction({ type: 'sprint', x: 2, y: 1 });
  game.playAction({ type: 'end' });
  const next = game.getBattleState();
  assert.equal(next.vm.pendingAsk, null);
  assert.equal(next.order[next.turn], second.id);
  assert.equal(next.units[first.id].x, 2);
  assert.deepEqual(next.tape.map(row => row.actionType), ['move', 'skill', 'interact', 'sprint']);
});

test('a native interaction resumes its remaining effects before recording and ending the turn', () => {
  const { state, first } = fixture();
  Object.assign(first, { hp: 30, mp: 0, sp: 0, move: 0, used: { attack: 1, action: 0 }, ap: 1 });
  state.interactives = { altar: { id: 'altar', name: '恢复点', kind: 'altar', effect: 'restore', damage: 5, x: 1, y: 1, spent: false } };
  first.rules = [{ id: 'choose_heal', hook: 'before_commit', filter: "target.id == self.id && event.commitKind == 'heal'", program: [
    { op: 'ask', chooser: 'self', kind: 'number', prompt: '选择治疗量', min: 1, max: 5, out: 'amount', aiPolicy: 'max' },
    { op: 'mutate_event', patch: { finalAmount: 'vars.amount' } },
  ] }];
  const game = createGameAPI();
  game.createBattle({ kind: 'custom_state', state });
  game.playAction({ type: 'interact', x: 1, y: 1 });
  const pending = game.getBattleState();
  assert.ok(pending.vm.pendingAsk);
  assert.equal(pending.tape?.length ?? 0, 0);
  assert.equal(pending.units[first.id].mp, 0);
  assert.equal(pending.logs.filter(log => log.type === 'end').length, 0);
  const restored = createGameAPI();
  restored.restoreBattleSnapshot(JSON.parse(JSON.stringify(game.exportBattleSnapshot())));
  const answer = { type: 'answer', askId: pending.vm.pendingAsk.askId, value: 2 };
  game.playAction(answer);
  restored.playAction(answer);
  const result = game.getBattleState();
  assert.deepEqual(restored.getBattleState(), result);
  assert.deepEqual([result.units[first.id].hp, result.units[first.id].mp, result.units[first.id].sp], [32, 5, 5]);
  assert.deepEqual(result.tape.map(row => [row.actionType, row.targetSpec.answers]), [['interact', [2]]]);
  assert.equal(result.logs.filter(log => log.type === 'interact').length, 1);
  assert.equal(result.logs.filter(log => log.type === 'end').length, 1);
});

test('normalization locates invalid expressions and runs a dynamic resource conversion through the production VM', () => {
  const { state, first } = fixture();
  Object.assign(first, { mp: 12, maxMp: 20, sp: 3, maxSp: 20 });
  const skillId = 'skill-a1-7t47mv-18';
  first.skills.push(skillId);
  state.skills[skillId] = { name: '三相魂炉的流转', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', passive: true, rules: [] };
  const rule = { id: 'tri_phase_shift', hook: 'turn_start', program: [
    { op: 'let', name: 'fromPool', value: "'mp'" },
    { op: 'let', name: 'toPool', value: "'sp'" },
    { op: 'if', cond: 'vars.fromPool != vars.toPool', then: [
      { op: 'ask', chooser: 'self', kind: 'number', prompt: '选择转移数值', min: 0, max: 'self.resource[vars.fromPool]', out: 'amount', aiPolicy: 'min' },
      { op: 'resource', target: 'self', pool: 'vars.fromPool', mode: 'sub', amount: 'vars.amount' },
      { op: 'resource', target: 'self', pool: 'vars.toPool', mode: 'add', amount: 'vars.amount' },
    ] },
  ] };
  const patched = () => applyPatch(state, [{ op: 'add', path: `/skills/${skillId}/rules/-`, value: rule }], true);
  assert.throws(() => validateState(patched()), /VM 规则 rules\/0（tri_phase_shift）\/program\/2\/then\/0\/max/);
  assert.equal(state.skills[skillId].rules.length, 0);
  rule.program[2].then[0].max = 'resource(self, vars.fromPool)';
  const next = patched();
  validateState(next);
  dispatchVMHook(next, 'turn_start', { actorId: first.id });
  assert.equal(next.vm.pendingAsk.options.max, 12);
  resolveVMAction(next, { type: 'answer', askId: next.vm.pendingAsk.askId, value: 5 });
  assert.deepEqual([next.units[first.id].mp, next.units[first.id].sp], [7, 8]);
});

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
  assert.deepEqual(preview.state.tape.at(-1).targetSpec.answers[0], [first.id, second.id]);
  assert.equal(preview.state.units[second.id].hp, before.units[second.id].hp - 1);
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
