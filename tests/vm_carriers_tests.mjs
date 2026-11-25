import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateExpr as evaluateScalar } from '../src/core/formula.js';
import { aggregateModifiers, applyStatMod, collectRules } from '../src/core/vm-carriers.js';
import { newEvent, scheduleHooks, startVM, stepVM } from '../src/core/tactical-vm.js';

test('伤害钩子优先读取提交后的暴击倍率，普通检定仍可从评级派生', () => {
  const rating={name:'平暴击',multiplier:1.3};
  assert.equal(evaluateScalar('event.ratingMultiplier',{event:{rating,ratingMultiplier:1.6}}),1.6);
  assert.equal(evaluateScalar('event.ratingMultiplier',{event:{rating}}),1.3);
  assert.equal(evaluateScalar('event.ratingMultiplier',{event:{ratingMultiplier:0}}),0);
});

const unit = (id, props = {}) => ({ id, hp: 20, x: 0, y: 0, team: 'blue', statuses: {}, ...props });
const rule = (id, props = {}) => ({ id, hook: 'before_check', program: [], ...props });
const stateOf = (...units) => ({ units: Object.fromEntries(units.map(u => [u.id, u])), items: {}, zones: {}, rng: 123,
  grid: [[{ z: 0 }, { z: 0 }, { z: 0 }]], round: 1, turn: 0 });

function peerSelector() {
  return { from: 'units', where: "candidate.team == self.team && candidate.alive && has_tag(candidate, 'echo')" };
}

test('rules collect actual carrier instances, order ties deterministically, and exclude unrelated owners', () => {
  const state = stateOf(unit('unrelated', { rules: [rule('unrelated', { priority: 100 })] }), unit('b', {
    rules: [rule('z'), rule('a'), rule('disabled', { enabled: false })],
    statuses: { frost: { id: 'status-1', sourceId: 'a', rules: [rule('frost', { priority: 20 })] },
      spent: { remainingTurns: 0, rules: [rule('expired')] } },
    mainHand: 'sword', weapon: 'sword', gear: ['sword'],
  }), unit('a', { x: 2, rules: [rule('actor-rule')] }));
  state.items.sword = { templateId: 'blade', rules: [rule('edge', { priority: 5 })] };
  state.items.spare = { templateId: 'blade', rules: [rule('spare', { priority: 50 })] };
  state.zones.fog = { sourceId: 'a', area: { shape: 'cells', cells: [{ x: 0, y: 0 }] }, rules: [rule('fog')] };
  const event = { actorId: 'a', targetId: 'b', targets: ['b'] };
  const result = collectRules(state, 'before_check', event);
  assert.deepEqual(result.map(({ ownerId, rule }) => [ownerId, rule.id]), [
    ['b', 'frost'], ['b', 'edge'], ['a', 'actor-rule'], ['b', 'a'], ['b', 'z'], ['b', 'fog'],
  ]);
  assert.deepEqual(result[0].carrier, { type: 'status', id: 'frost', ownerId: 'b' });
  assert.equal(result[0].sourceId, 'a');
  const reversed = { ...state, units: Object.fromEntries(Object.entries(state.units).reverse()) };
  assert.deepEqual(collectRules(reversed, 'before_check', event), result);
  assert.deepEqual(collectRules(state, 'after_check', event), []);
});

test('two worn instances of one template each contribute rules and modifiers', () => {
  const state = stateOf(unit('a', { mainHand: 'first', offHand: 'second', gear: ['first'] }));
  for (const id of ['first', 'second']) state.items[id] = { templateId: 'shared', rules: [rule('edge')], mods: [{ stat: 'str', flat: 4 }] };
  assert.equal(aggregateModifiers(state, 'a').stats.str.flat, 8);
  assert.deepEqual(collectRules(state, 'before_check', { actorId: 'a' }).map(entry => entry.carrier.id).sort(), ['first', 'second']);
});

test('sharing dedupes default and explicit keys per recipient and leaves nonrecipients alone', () => {
  const passive = { templateId: 'link', rules: [rule('passive'), rule('other', { dedupeKey: 'explicit' })],
    mods: [{ stat: 'str', flat: 2 }, { stat: 'str', flat: 3 }], shareRulesTo: peerSelector() };
  const state = stateOf(unit('a', { statuses: { link: passive } }), unit('b', {
    tags: ['echo'], statuses: { link: { ...passive, shareRulesTo: undefined },
      independent: { templateId: 'independent', rules: [rule('independent', { priority: 1, dedupeKey: 'explicit' })] } },
  }), unit('c', { tags: ['echo'], team: 'red' }));
  const before = structuredClone(state);
  const rules = collectRules(state, 'before_check', { ownerIds: ['a', 'b', 'c'] });
  assert.deepEqual(rules.map(({ ownerId, rule }) => [ownerId, rule.id]), [
    ['b', 'independent'], ['a', 'other'], ['a', 'passive'], ['b', 'passive'],
  ]);
  assert.equal(new Set(rules.map(entry => entry.useKey)).size, 4);
  assert.equal(aggregateModifiers(state, 'b').stats.str.flat, 5);
  assert.equal(aggregateModifiers(state, 'c').stats.str, undefined);
  assert.deepEqual(state, before);
});

test('lethal hooks collect only pool participants and dedupe matching rules across them', () => {
  const passive = rule('substitute', { hook: 'on_lethal_p2' });
  const state = stateOf(unit('a', { hp: 0, templateId: 'mirror', pools: { hp: 'shared' }, rules: [passive] }),
    unit('b', { hp: 0, templateId: 'mirror', pools: { hp: 'shared' }, rules: [passive,
      rule('blast', { hook: 'on_lethal_p1' }), rule('other', { hook: 'on_lethal_p2' })] }),
    unit('killer', { rules: [rule('irrelevant', { hook: 'on_lethal_p2' })] }));
  const event = { poolId: 'shared', killer: 'killer' };
  assert.deepEqual(collectRules(state, 'on_lethal_p1', event).map(e => e.rule.id), ['blast']);
  assert.deepEqual(collectRules(state, 'on_lethal_p2', event).map(e => [e.ownerId, e.rule.id]), [['a', 'substitute'], ['b', 'other']]);
  assert.deepEqual(collectRules(state, 'on_lethal_p2', { ...event, units: ['b'] }).map(e => e.ownerId), ['b', 'b']);
});

test('final death hooks still run for each shared-pool member', () => {
  const passive = rule('death', { hook: 'on_death' });
  const state = stateOf(unit('a', { hp: 0, templateId: 'mirror', rules: [passive] }),
    unit('b', { hp: 0, templateId: 'mirror', rules: [passive] }));
  assert.deepEqual(collectRules(state, 'on_death', { targetId: 'b', units: ['b', 'a'] }).map(e => e.ownerId), ['a', 'b']);
});

test('modifier operands aggregate independently with damage and check qualifiers', () => {
  const state = stateOf(unit('a', { vars: { warmth: 3 }, pools: { sp: 'energy' }, statuses: {
    buff: { stacks: 4, sourceId: 'a', vars: { bonus: 2 }, mods: [
      { stat: 'armor', flat: 'status.stacks + vars.bonus + self.resource.sp', mult: 2, additivePercent: 0.25 },
      { stat: 'armor', flat: '1 / 0', mult: "'2'", additivePercent: 0.25 },
      { stat: 'damageMult', damageType: 'energy', mult: 1.25 },
      { stat: 'checkBonus', checkKind: 'save', flat: 2 },
      { stat: 'checkBonus', checkKind: 'frost', flat: 3 },
      { stat: 'checkBonus', checkKind: 'mind', flat: 5 },
      { stat: 'checkBonus', checkKind: 'morale', flat: 7 },
    ] },
  }, mods: [{ stat: 'armor', flat: 'self.vars.warmth', mult: 0.5 }] }));
  state.pools = { energy: { current: 7 } };
  const plain = aggregateModifiers(state, 'a');
  assert.deepEqual(plain.stats, { armor: { flat: 16, mult: 1, additivePercent: 0.5 } });
  assert.equal(applyStatMod(4, plain.stats.armor), 30);
  assert.equal(applyStatMod(4, plain.stats.missing), 4);
  const effect = aggregateModifiers(state, 'a', { damageType: 'energy', checkKind: 'save', statusId: 'frost', tags: ['mind'] });
  assert.equal(effect.stats.damageMult.mult, 1.25);
  assert.equal(effect.stats.checkBonus.flat, 10);
});

test('following zones update modifiers, locks, flags and control policy from current position', () => {
  const state = stateOf(unit('a', { x: 0 }), unit('b', { x: 1, statuses: { confusion: { mods: [
    { locks: ['attack'], controlPolicy: { intentLock: 'kill', moraleLock: 'steady' } },
  ] } } }));
  state.zones.fog = { templateId: 'mist', tags: ['fog'], vars: { factor: 0.5 }, follow: true, remainingTurns: 2,
    area: { shape: 'circle', anchorUnitId: 'a', radius: 1 }, mods: [
      { stat: 'incomingHealMult', mult: 'zone.vars.factor', when: "in_zone(self, 'fog')", flags: ['blockRevive'] },
      { locks: ['move'], controlPolicy: { intentLock: 'core', allowFriendlyTarget: true } },
    ] };
  const mods = aggregateModifiers(state, 'b');
  assert.deepEqual(mods.locks, { attack: true, action: false, move: true, cast: false, reaction: false, fly: false, teleport: false });
  assert.deepEqual(mods.flags, { blockRevive: true });
  assert.deepEqual(mods.controlPolicy, { intentLock: 'kill', moraleLock: 'steady', allowFriendlyTarget: true });
  assert.equal(mods.stats.incomingHealMult.mult, 0.5);
  state.units.b.x = 2;
  assert.equal(aggregateModifiers(state, 'b').locks.move, false);
  state.units.a.x = 1;
  assert.equal(aggregateModifiers(state, 'b').locks.move, true);
  state.units.a.hp = 0;
  assert.deepEqual(aggregateModifiers(state, 'b').flags, {});
  delete state.units.b.statuses.confusion;
  assert.deepEqual(aggregateModifiers(state, 'b').controlPolicy, {});
});

test('VM uses shared recipient as self and resolves owner writes to the original carrier', () => {
  const state = stateOf(unit('a', { statuses: { original: { id: 'status-1', sourceId: 'a', vars: { count: 3 },
    shareRulesTo: peerSelector(), rules: [rule('shared', { filter: 'event.dc == 12 && self.id == target.id && source.id != self.id',
      program: [{ op: 'let', scope: 'owner', name: 'count', value: 'status.vars.count + 1' }] })],
  } } }), unit('b', { tags: ['echo'] }));
  state.units.b.rules = [rule('raise_dc', { priority: 10, program: [{ op: 'mutate_event' }] })];
  const host = { rules: collectRules, ops: {
    mutate_event: ({ state, frame }) => { state.vm.events[frame.eventRef].dc = 12; },
  }, log() {} };
  const parent = startVM(state, { ownerId: 'b' });
  const eventRef = newEvent(state, { targetId: 'b', dc: 8 });
  scheduleHooks(state, parent, 'before_check', eventRef, host);
  assert.equal(state.vm.stack.at(-1).ruleId, 'raise_dc');
  stepVM(state, host);
  assert.equal(state.units.a.statuses.original.vars.count, 4);
  assert.deepEqual(state.units.b.statuses, {});
});

test('pure collection never advances RNG for a random sharing selector', () => {
  const state = stateOf(unit('a', { rules: [rule('a')], shareRulesTo: { from: 'units', pick: { random: 1 } } }), unit('b'));
  assert.deepEqual(collectRules(state, 'before_check', { targetId: 'b' }), []);
  assert.equal(state.rng, 123);
});
