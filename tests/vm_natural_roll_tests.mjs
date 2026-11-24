import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { dispatchVMHook } from '../src/core/vm-runtime.js';
import { rollDie } from '../src/core/rng.js';

const coin = { id: 'coin', hook: 'after_natural_roll', filter: 'attacker.id == self.id && event.naturalRoll < 6',
  program: [{ op: 'mutate_event', patch: { replaceNaturalRoll: 11 } }] };

test('natural d20 replacement changes native attack settlement without a reroll', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const target = Object.values(state.units).find(unit => unit.team !== actor.team);
  Object.assign(target, { x: actor.x, y: actor.y });
  actor.rules = [coin];
  state.rng = 1972;
  const original = structuredClone(state);
  original.units[actor.id].rules = [];
  const command = { type: 'attack', x: target.x, y: target.y, targetId: target.id };
  const baseline = applyAction(original, command).find(log => log.type === 'roll');
  const replaced = applyAction(state, command).find(log => log.type === 'roll');
  assert.equal(baseline.detail.selected, 1);
  assert.deepEqual(replaced.detail.dice, baseline.detail.dice);
  assert.equal(replaced.detail.selected, 11);
});

test('before_check 的 minRating 同时保底原生攻击评级和实际伤害倍率', () => {
  for (const [face, expected, multiplier, hit] of [[4,'有效',1,true],[20,'强暴击',1.6,true],[1,'擦伤',0.3,false]]) {
    const state=buildScenario('ruins'), actor=currentUnit(state);
    const target=Object.values(state.units).find(unit=>unit.team!==actor.team);
    Object.assign(target,{x:actor.x,y:actor.y});
    actor.rules=[{id:'precision',hook:'before_check',program:[{op:'mutate_event',patch:{bonusDelta:-6,minRating:'有效'}}]},
      {id:'fixed_face',hook:'after_natural_roll',program:[{op:'mutate_event',patch:{replaceNaturalRoll:face}}]}];
    const logs=applyAction(state,{type:'attack',x:target.x,y:target.y,targetId:target.id});
    const roll=logs.find(l=>l.type==='roll').detail, damage=logs.find(l=>l.type==='damage')?.detail;
    assert.deepEqual([roll.total,roll.rating.name,roll.rating.multiplier,roll.hit],[face+5,expected,multiplier,hit]);
    if(hit) assert.deepEqual([damage.rating,damage.ratingMultiplier],[expected,multiplier]);
    else assert.equal(damage,undefined);
  }
});

test('原生攻击先按档数升降再保底，必中独立覆盖天然1', () => {
  for (const [face, delta, minimum, force, expected, mult, hit] of [
    [4,1,'有效',false,'有效',1,true], [8,1,'有效',false,'平暴击',1.3,true],
    [4,-2,'有效',false,'有效',1,true], [20,6,'有效',false,'超暴击',2,true],
    [4,-6,null,false,'失手',0,false], [1,1,'有效',true,'有效',1,true], [1,1,'有效',false,'擦伤',.3,false],
  ]) {
    const s=buildScenario('ruins'), a=currentUnit(s), t=Object.values(s.units).find(u=>u.team!==a.team);
    Object.assign(t,{x:a.x,y:a.y});
    a.rules=[{id:'precision',hook:'before_check',program:[{op:'mutate_event',patch:{bonusDelta:-6,ratingDelta:delta,
      ...(minimum && {minRating:minimum}), ...(force && {forceOutcome:'hit'})}}]},
      {id:'face',hook:'after_natural_roll',program:[{op:'mutate_event',patch:{replaceNaturalRoll:face}}]}];
    const logs=applyAction(s,{type:'attack',x:t.x,y:t.y,targetId:t.id});
    const r=logs.find(l=>l.type==='roll').detail, d=logs.find(l=>l.type==='damage')?.detail;
    assert.deepEqual([r.total,r.hit,r.rating.name,r.rating.multiplier,d?.ratingMultiplier],[face+5,hit,expected,mult,hit?mult:undefined]);
  }
});

test('VM rawNatural keeps the original roll and fixed RNG consumption', () => {
  for (const rawNatural of [false, true]) {
    const state = buildScenario('ruins');
    const actor = currentUnit(state);
    state.rng = 1972;
    actor.rules = [coin, { id: 'probe', hook: 'turn_start', program: [{ op: 'check', kind: 'd20', dc: 10, rawNatural }] }];
    dispatchVMHook(state, 'turn_start', { actorId: actor.id, targetId: actor.id });
    const log = state.logs.findLast(entry => entry.type === 'vm_check');
    assert.equal(log.detail.outcomes[0].roll, rawNatural ? 1 : 11);
    assert.equal(log.detail.success, !rawNatural);
    assert.equal(state.rng, rollDie(1972, 20).rng);
  }
});
