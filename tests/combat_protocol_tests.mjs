import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BL_SIZE_TABLE, DISTANCE_TABLE, INTENTS, MORALE, areaResolution, damagePipeline, distanceTier, initiative, intentCheck, meleeMultiplier, moraleResult, nonLethalHp, ratingFor, sizeFor, sizeHitModifier, stanceFor } from '../src/core/combat_protocol.js';
import { rollProtocolD20 } from '../src/core/rng.js';

test('六档体型、伤害档位与距离命中表边界', () => {
  assert.deepEqual(BL_SIZE_TABLE.map(x => x.value), [2,1,0,-1,-2,-4]);
  assert.equal(sizeFor(.6).id, 'small'); assert.equal(sizeFor(1.3).id, 'medium'); assert.equal(sizeFor(10).id, 'gargantuan');
  assert.equal(ratingFor(30).multiplier, 2); assert.equal(ratingFor(25).multiplier, 1.6); assert.equal(ratingFor(20).multiplier, 1.3);
  assert.equal(ratingFor(11).multiplier, 1); assert.equal(ratingFor(8).multiplier, .8); assert.equal(ratingFor(4).multiplier, .3); assert.equal(ratingFor(3).multiplier, 0);
  assert.deepEqual([0,1,3,6,11].map(d => distanceTier(d).hit), [4,0,-2,-4,-6]); assert.equal(DISTANCE_TABLE[0].range, 6);
});
test('BL/MC 互斥、近战倍率、战技与先手公式', () => {
  assert.equal(sizeHitModifier({bodyLengthM:.5},{bodyLengthM:20,mc:2}),4);
  assert.equal(sizeHitModifier({bodyLengthM:1.7},{bodyLengthM:1.7}),0);
  assert.equal(meleeMultiplier({bodyLengthM:4}),1.2); assert.equal(meleeMultiplier({bodyLengthM:12,mc:2}),1);
  assert.equal(initiative({agility:10,percent:.2,d20:4,attack:[2,6],action:[1,3],flat:2}),27);
  assert.equal(INTENTS.concept.difficulty,20); assert.equal(intentCheck('kill',1,3,20,1).success,false);
});
test('纯伤害流水线、集群命中数、战意与非致死下限', () => {
  const d=damagePipeline({initial:100,defense:2000,penetration:.5,type:'physical',attributes:{str:0,agi:0,con:0}});
  assert.equal(d.effectiveDefense,1000); assert.equal(d.armorMultiplier,2/3); assert.ok(Math.abs(d.damage-100*2/3)<1e-12);
  assert.deepEqual(areaResolution({baseDamage:10,rangeTier:5,members:10,coverage:.8}),{nHit:4,damage:40,perTarget:10});
  assert.deepEqual(areaResolution({baseDamage:10,mc:3,rangeTier:10,members:3,coverage:.5,colossus:true}),{nHit:2,damage:30,perTarget:15});
  assert.equal(moraleResult({type:'standard',hp:29,maxHp:100,d20:12}).outcome,'steady');
  assert.deepEqual(moraleResult({type:'spar',hp:39,maxHp:100}), {threshold:.4,triggered:true,check:false,roll:null,outcome:'shaken'});
  assert.equal(moraleResult({type:'standard',hp:29,maxHp:100,d20:11}).outcome,'routed');
  assert.equal(moraleResult({type:'deathmatch',hp:10,maxHp:100,d20:12}).triggered,false);
  assert.equal(nonLethalHp(0,true),1); assert.equal(nonLethalHp(0,false),0);
  assert.deepEqual(Object.keys(MORALE).length,6);
});
test('武器姿态映射及奖励/惩罚骰确定性与取中规则', () => {
  assert.equal(stanceFor({mainHand:{},offHand:{}}),'dual_wield');
  assert.equal(stanceFor({mainHand:{heavy:true}}),'greatsword');
  assert.equal(stanceFor({mainHand:{},shield:{}}),'sword_shield');
  assert.equal(stanceFor({mainHand:{},offHand:{kind:'consumable'}}),'attunement');
  const a=rollProtocolD20(9,{bonus:2}); const b=rollProtocolD20(9,{bonus:2});
  assert.deepEqual(a,b); assert.equal(a.rolls.length,3); assert.equal(a.value,[...a.rolls].sort((x,y)=>x-y)[1]);
  const penalty=rollProtocolD20(9,{penalty:1}); assert.equal(penalty.rolls.length,2); assert.equal(penalty.value,Math.min(...penalty.rolls));
});
