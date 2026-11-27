import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateState } from '../src/api/validation.js';
import { aimedOptions } from '../src/core/ai.js';
import { currentUnit, preview } from '../src/core/combat.js';
import { collectRules } from '../src/core/vm-carriers.js';
import { ruleAvailability } from '../src/core/vm-rule-limits.js';
import { dispatchVMHook, resolveVMAction, vmHost } from '../src/core/vm-runtime.js';
import { validVmRule } from '../src/core/vm-schema.js';
import { buildScenario } from '../src/presets/scenarios.js';

const ownerVar = (name, value) => ({ op: 'let', name, value, scope: 'owner' });
const spend = (pool, amount = 1) => ({ op: 'resource', target: 'self', pool, mode: 'sub', amount, requireFull: true });

function addSkill(state, actor, id, fields = {}) {
  state.skills[id] = { name: id, range: 3, ap: 0, slot: 'action', shape: 'single', target: 'enemy',
    rules: [{ id, hook: 'active', program: [] }], ...fields };
  actor.skills.push(id);
}

function aimed(type, skillId, target) {
  return { type, skillId, x: target.x, y: target.y, ...(target.id && { targetId: target.id }) };
}

test('rule schema accepts positive round counts and exact listening scopes', () => {
  const rule = { id: 'reaction-rule', hook: 'before_action', program: [spend('reaction')] };
  for (const listenScope of ['participants', 'board']) assert.ok(validVmRule({ ...rule, usesPerRound: 1, listenScope }));
  for (const fields of [{ usesPerRound: 0 }, { usesPerRound: 1.5 }, { listenScope: 'global' }]) {
    assert.equal(validVmRule({ ...rule, ...fields }), false);
  }
});

test('round limits survive turn changes, reset next round and intersect turn/battle limits', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const limited = { id: 'limited', hook: 'turn_start', usesPerTurn: 1, usesPerRound: 2, usesPerBattle: 3, program: [] };
  actor.rules = [limited, { id: 'legacy', hook: 'turn_start', usesPerTurn: 2, program: [] }];
  const event = { actorId: actor.id };
  const keyFor = id => collectRules(state, 'turn_start', event).find(({ rule }) => rule.id === id).useKey;
  const limitedKey = keyFor('limited'), legacyKey = keyFor('legacy');
  const fire = () => dispatchVMHook(state, 'turn_start', event);
  const usesLeft = () => ruleAvailability(state, limited, limitedKey).usesLeft;
  assert.equal(usesLeft(), 1);
  fire(); fire();
  assert.equal(usesLeft(), 0);
  assert.deepEqual(state.vm.ruleTurns[limitedKey], { round: state.round, turn: state.turn, count: 1, roundCount: 1 });
  assert.equal(JSON.stringify(state.vm.ruleTurns[legacyKey]), JSON.stringify({ round: state.round, turn: state.turn, count: 2 }));
  state.turn++;
  assert.equal(usesLeft(), 1);
  fire();
  assert.deepEqual(state.vm.ruleTurns[limitedKey], { round: state.round, turn: state.turn, count: 1, roundCount: 2 });
  state.turn++;
  assert.equal(usesLeft(), 0);
  fire();
  assert.equal(state.vm.uses[limitedKey], 2);
  state.round++;
  assert.equal(usesLeft(), 1);
  fire();
  assert.equal(state.vm.ruleTurns[limitedKey].roundCount, 1);
  state.round++;
  assert.equal(usesLeft(), 0);
});

test('round limits recognize old stamps and permit limited free skills in the greedy AI', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  addSkill(state, actor, 'round-skill', { range: 0, target: 'self',
    rules: [{ id: 'round-skill', hook: 'active', usesPerRound: 2, program: [] }] });
  const cast = aimed('skill', 'round-skill', actor);
  const key = JSON.stringify([actor.id, 'round-skill', 'round-skill']);
  state.vm.ruleTurns = { [key]: { round: state.round, turn: state.turn, count: 1 } };
  assert.equal(preview(state, cast, { simulateRules: false }).usesLeft, 1);
  assert.ok(aimedOptions(state, actor).some(({ action }) => action.skillId === 'round-skill'));
  resolveVMAction(state, cast);
  assert.deepEqual(state.vm.ruleTurns[key], { round: state.round, turn: state.turn, count: 2, roundCount: 2 });
  assert.equal(preview(state, cast, { simulateRules: false }).usesLeft, 0);
  assert.ok(!aimedOptions(state, actor).some(({ action }) => action.skillId === 'round-skill'));
});

test('reaction pseudo pool reads and writes the shared budget without changing AP or slots', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const budget = { ap: actor.ap, used: { ...actor.used } };
  delete actor.reactionAvailable;
  actor.rules = [{ id: 'spend-reaction', hook: 'before_action', filter: "self.resource.reaction == 1 && resource(self, 'reaction') == 1",
    program: [spend('reaction'), ownerVar('remaining', "self.resource.reaction + resource(self, 'reaction')")] },
  { id: 'refill-reaction', hook: 'after_action', program: [{ ...spend('reaction', 3), mode: 'add' }] }];
  const event = { actorId: actor.id };
  assert.equal(vmHost.resource(state, actor, 'reaction'), 1);
  dispatchVMHook(state, 'before_action', event);
  assert.equal(actor.reactionAvailable, false);
  assert.equal(actor.vars.remaining, 0);
  assert.equal(vmHost.resource(state, actor, 'reaction'), 0);
  const { detail } = state.logs.findLast(row => row.type === 'resource');
  assert.deepEqual([detail.resource, detail.resourceLabel, detail.before, detail.after], ['reaction', '反应', 1, 0]);
  dispatchVMHook(state, 'after_action', event);
  assert.equal(actor.reactionAvailable, true);
  assert.deepEqual({ ap: actor.ap, used: actor.used }, budget);
  assert.equal(actor.pools.reaction, undefined);
});

test('insufficient subtraction from any pseudo pool leaves its balance untouched and aborts the caller', () => {
  for (const pool of ['reaction', 'attack', 'action', 'move']) {
    const state = buildScenario('ruins');
    const actor = currentUnit(state);
    const before = vmHost.resource(state, actor, pool);
    const initialResources = state.logs.filter(({ type }) => type === 'resource').length;
    actor.rules = [{ id: 'overdraw', hook: 'turn_start', program: [spend(pool, before + 1), ownerVar('ran', true)] }];
    dispatchVMHook(state, 'turn_start', { actorId: actor.id });
    assert.equal(vmHost.resource(state, actor, pool), before, pool);
    assert.equal(actor.vars?.ran, undefined, pool);
    assert.equal(state.logs.filter(({ type }) => type === 'resource').length, initialResources, pool);
  }
});

test('board listeners keep participant defaults and deterministically order living third parties', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  const { oracle, ranger, gunner, raider } = state.units;
  const rule = (id, fields = {}) => ({ id, hook: 'before_action', program: [], ...fields });
  const board = { listenScope: 'board' };
  actor.rules = [rule('default')];
  target.rules = [rule('explicit', { listenScope: 'participants' })];
  oracle.rules = [rule('z', board), rule('a', board), rule('local'), rule('disabled', { ...board, enabled: false })];
  ranger.rules = [rule('high', { ...board, priority: 10 })];
  gunner.rules = [rule('dead', board)];
  gunner.hp = 0;
  raider.rules = [rule('fled', board)];
  raider.fled = true;
  const order = event => collectRules(state, 'before_action', event).map(entry => `${entry.ownerId}:${entry.rule.id}`);
  assert.deepEqual(order({ actorId: actor.id, targetId: target.id }), ['ranger:high', 'oracle:a', 'oracle:z', 'scout:explicit', `${actor.id}:default`]);
  assert.deepEqual(order({}), ['ranger:high', 'oracle:a', 'oracle:z']);
});

test('a third-party board listener suspends a cast for the blue player and pays reaction to cancel', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout, bystander = state.units.oracle;
  const skillId = 'interruptible';
  addSkill(state, actor, skillId, { ap: 1, mp: 2, rules: [{ id: skillId, hook: 'active', program: [ownerVar('cast', true)] }] });
  const ask = { op: 'ask', chooser: 'self', kind: 'option', prompt: '使用反应反制？', out: 'choice', aiPolicy: 'first',
    options: [{ id: 'yes', label: '反制' }, { id: 'no', label: '放行' }] };
  const cancel = { op: 'mutate_event', patch: { cancel: true, consumeCostOnCancel: true } };
  bystander.rules = [{ id: 'counter', hook: 'before_action', listenScope: 'board', usesPerRound: 1,
    filter: `event.skillId == '${skillId}' && attacker.id == '${actor.id}' && target.id == '${target.id}' && self.id == '${bystander.id}'`,
    program: [ask, { op: 'if', cond: "vars.choice == 'yes'", then: [spend('reaction'), cancel] }] }];
  validateState(state);
  const origin = structuredClone(state);
  for (const [value, spentBefore, canceled] of [['yes', false, true], ['no', false, false], ['yes', true, false]]) {
    const trial = structuredClone(origin);
    const caster = trial.units[actor.id], observer = trial.units[bystander.id];
    observer.reactionAvailable = !spentBefore;
    const { ap, mp } = caster;
    const { pendingAsk } = resolveVMAction(trial, aimed('skill', skillId, target));
    assert.equal(pendingAsk.chooserId, observer.id);
    assert.deepEqual([caster.ap, caster.mp], [ap, mp]);
    const suspended = JSON.parse(JSON.stringify(trial));
    validateState(suspended);
    const result = resolveVMAction(suspended, { type: 'answer', askId: pendingAsk.askId, value });
    assert.equal(result.pendingAsk, null);
    assert.deepEqual([suspended.units[caster.id].ap, suspended.units[caster.id].mp], [ap - 1, mp - 2]);
    assert.equal(suspended.vm.skillVars?.[JSON.stringify([actor.id, skillId])]?.cast, canceled ? undefined : true,
      `answer=${value}, reaction already spent=${spentBefore}`);
    assert.equal(suspended.units[observer.id].reactionAvailable, !(spentBefore || canceled));
    assert.equal(Object.values(suspended.vm.ruleTurns).find(stamp => stamp.roundCount)?.roundCount, 1);
  }
});

test('a board listener can use the aim coordinates of a ground cast without a unit target in the command', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), observer = state.units.oracle;
  const aim = { x: actor.x, y: actor.y };
  addSkill(state, actor, 'ground-cast', { range: 0, target: 'cell' });
  observer.rules = [{ id: 'ground-listener', hook: 'before_action', listenScope: 'board',
    filter: `event.skillId == 'ground-cast' && target.id == '${actor.id}' && event.centerX == ${aim.x} && event.centerY == ${aim.y}`,
    program: [ownerVar('ground', true)] }];
  assert.ok(validVmRule(observer.rules[0]));
  resolveVMAction(state, aimed('skill', 'ground-cast', aim));
  assert.equal(observer.vars?.ground, true);
});

test('native guard intercepts one damaging strike and shares its budget with the DSL reaction pool', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout, guard = state.units.gunner;
  Object.assign(target, { x: 2, y: 2 });
  Object.assign(guard, { x: 2, y: 3, mods: [{ flags: ['intercept'] }] });
  actor.mods = [{ flags: ['guaranteed_hit'] }];
  addSkill(state, actor, 'guard-probe', { damage: { count: 0, sides: 0, bonus: 1, type: 'true' } });
  guard.rules = [{ id: 'recover', hook: 'turn_start', program: [{ ...spend('reaction'), mode: 'set' }] }];
  const cast = aimed('skill', 'guard-probe', target);
  const damageRecipient = () => {
    const start = state.logs.length;
    resolveVMAction(state, cast);
    return state.logs.slice(start).find(row => row.type === 'damage')?.detail.targetId;
  };
  assert.equal(damageRecipient(), guard.id);
  assert.equal(vmHost.resource(state, guard, 'reaction'), 0);
  assert.equal(damageRecipient(), target.id);
  dispatchVMHook(state, 'turn_start', { actorId: guard.id });
  assert.equal(vmHost.resource(state, guard, 'reaction'), 1);
  assert.equal(damageRecipient(), guard.id);
});
