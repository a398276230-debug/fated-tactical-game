import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { unitValue } from '../src/api/validation.js';
import { STANCE_RULES } from '../src/core/combat_protocol.js';
import { applyAction, beginBattle, loadoutStance, mitigation, preview } from '../src/core/combat-actions.js';
import { createPool } from '../src/core/vm-pools.js';
const stance = u => u.stance;

function rangedFixture() {
 const g=createGameAPI(); g.createBattle({scenarioId:'ruins', ruleset:'protocol'});
 const s=g.getBattleState(), u=s.units.swordsman, target=Object.values(s.units).find(t=>t.team!==u.team);
 s.turn=s.order.indexOf(u.id); u.ap=2; u.used={action:0,attack:0}; u.moved=0;
 const weapon=s.equipment[s.items[u.mainHand].templateId];
 Object.assign(weapon,{twoHanded:true,ranged:true,weaponClass:'ranged',rangeType:'ranged',range:10});
 u.stance=loadoutStance(s,u);
 return {s,u,target,weapon};
}

test('重剑攻势 1.5×、零 AP 切沉势 1.2×，只减免 15% 非真伤', () => {
 const {s,u,target,weapon}=rangedFixture();
 Object.assign(weapon,{ranged:false,weaponClass:'greatsword',rangeType:'melee',range:1.5,attack:100});
 u.stance=loadoutStance(s,u); Object.assign(target,{x:u.x,y:u.y});
 assert.equal(u.stance,'greatsword');
 for (const key of ['parryQuota','parryRefunded','maneuvers','blockMode']) {
   assert.ok(!Object.hasOwn(u,key));
   assert.throws(()=>unitValue({...u,[key]:0},u.id,s),new RegExp(key));
 }
 const attack={type:'attack',targetId:target.id,x:target.x,y:target.y};
 const damage=()=>preview(s,attack).targets[0].damageMax;
 const unscaled=()=>{const before=weapon.attack; weapon.attack=0; try { return damage(); } finally { weapon.attack=before; }};
 weapon.damage={...weapon.damage,type:'true'};
 assert.equal(damage()-unscaled(),150);
 assert.equal(mitigation(s,u,'physical',true,0).reduction,0);
 const switchMode={type:'stance_mode',maneuver:'defensive'};
 assert.equal(preview(s,switchMode).ap,0); const ap=u.ap;
 applyAction(s,switchMode); assert.equal(u.ap,ap); assert.equal(u.greatswordMode,'defensive');
 assert.equal(damage()-unscaled(),120);
 assert.equal(mitigation(s,u,'physical',true,0).multiplier,.85);
 assert.equal(mitigation(s,u,'true',true,0).multiplier,1);
});

test('双手远程只在正距离缓和衰减，贴身 -4，装填与高地射程独立', () => {
 const {s,u,target,weapon}=rangedFixture();
 assert.equal(u.stance,'ranged');
 const at=(dx,dy=0)=>{
   Object.assign(u,{x:0,y:0}); Object.assign(target,{x:dx,y:dy});
   const plan=preview(s,{type:'attack',targetId:target.id,x:dx,y:dy});
   assert.equal(plan.ok,true,plan.error); return plan;
 };
 const hit=(...args)=>at(...args).targets[0].distanceModifier;
 assert.equal(hit(0),-4); weapon.closeQuarters=true; assert.equal(hit(0),0); delete weapon.closeQuarters;
 assert.equal(hit(4),0); assert.equal(hit(7),-2);
 u.stance='dual_wield'; assert.equal(hit(0),-4); assert.equal(hit(4),-2);
 weapon.rawRange=6; assert.equal(hit(2,2),0); delete weapon.rawRange;
 u.stance='ranged'; u.altitude=1;
 createPool(s,{ownerKind:'item',ownerId:u.mainHand,key:'ammo',max:5,current:5,reloadable:true});
 weapon.pools={ammo:{cap:5,initial:5,reloadable:true}};
 assert.equal(at(0).range,11); weapon.vars={highGroundRange:2}; assert.equal(at(0).range,12);
 u.altitude=0; const before=u.bonusDice;
 const move={type:'move',x:1,y:0}; assert.ok(preview(s,move).ok); applyAction(s,move); assert.equal(u.bonusDice,before);
});

test('开场初始化同调次数，持弓耗尽后回到射击', () => {
 const {s,u,weapon}=rangedFixture(); weapon.twoHanded=false;
 u.offHand=s.units.oracle.offHand; s.units.oracle.offHand=null;
 delete u.stance; delete u.attunementCharges; beginBattle(s);
 assert.equal(u.stance,'attunement'); assert.equal(u.attunementCharges,2);
 s.turn=s.order.indexOf(u.id); u.ap=2;
 for (let i=0;i<2;i++) { assert.ok(preview(s,{type:'use_item'}).ok); applyAction(s,{type:'use_item'}); }
 assert.equal(u.attunementCharges,0); assert.equal(u.stance,'ranged');
});
test('同调按副手实例执行两次主动规则，不扣 AP、不替换为疾走', () => {
 const g=createGameAPI(); g.createBattle('ruins'); const s=g.getBattleState(), u=s.units.oracle;
 s.turn=s.order.indexOf(u.id); u.ap=2; const ap=u.ap, item=s.items[u.offHand];
 item.rules=[{id:'potion-haste',hook:'active',program:[{op:'apply_status',target:'self',statusId:'guarded'}]}];
 for(const remaining of [1,0]) { assert.ok(preview(s,{type:'use_item'}).ok); applyAction(s,{type:'use_item'});
   assert.ok(u.statuses.guarded); assert.equal(u.statuses.haste,undefined); assert.equal(u.attunementCharges,remaining); assert.equal(u.ap,ap); }
 assert.equal(preview(s,{type:'use_item'}).ok,false); assert.equal(u.stance,'light_blade');
});
test('剑盾格挡减伤读取姿态规则表，普通与重格挡保持一致', () => {
 const rules=STANCE_RULES.sword_shield, original={blockReduction:rules.blockReduction,heavyBlockReduction:rules.heavyBlockReduction};
 try {
   rules.blockReduction=.17; rules.heavyBlockReduction=.83;
   const g=createGameAPI(); g.createBattle({scenarioId:'altar'}); const s=g.getBattleState(), u=s.units.sentinel;
   s.turn=s.order.indexOf(u.id); u.ap=2; u.used={attack:0,action:0};
   s.items.testShield={id:'testShield',templateId:'towerShield'}; u.shield='testShield'; u.stance='sword_shield';
   for (const [maneuver, expected] of [['normal', rules.blockReduction], ['heavy', rules.heavyBlockReduction]]) {
     u.ap=2; u.used={attack:0,action:0}; delete u.statuses.guarded;
     const action = {type:'block', ...(maneuver === 'heavy' ? {maneuver} : {})};
     const plan = preview(s, action);
     assert.equal(plan.reduction, expected);
     applyAction(s, action);
     assert.equal(u.statuses.guarded.vars.reduction, expected);
   }
 } finally {
   rules.blockReduction=original.blockReduction; rules.heavyBlockReduction=original.heavyBlockReduction;
 }
});
test('无械随装备卸下派生；不能凭空切重剑', () => {
 const g=createGameAPI(); g.createBattle({scenarioId:'altar'});
 const id='sentinel', instanceId=g.inspectWeaponSlots(id).mainHand.id;
 assert.equal(g.setWeaponStance(id,'light_blade').ok,false);
 const p=g.proposeCommands([{type:'equip_item',instanceId,unitId:null}],{baseRevision:g.getStateSummary().revision,reason:'卸下长戟'});
 assert.ok(p.ok); assert.ok(g.commitProposal(p.proposalId).ok);
 assert.equal(g.inspectWeaponSlots(id).stance,'unarmed'); assert.ok(g.setWeaponStance(id,'unarmed').ok);
});
test('预设装备分类与姿态不是全部轻剑',()=>{
 const a=createGameAPI(); a.createBattle({scenarioId:'ruins', ruleset:'sandbox'});
 const s=a.getBattleState();
 assert.equal(stance(s.units.swordsman),'light_blade');
 assert.equal(stance(s.units.ranger),'dual_wield');
 assert.equal(stance(s.units.oracle),'attunement');
 assert.equal(s.equipment.shortblade.weaponClass,'light_blade');
 assert.equal(s.equipment.potion.kind,'consumable');
 assert.equal(s.equipment.greatsword.twoHanded,true);
});
test('旧 weapon 字段与 mainHand 保持兼容，槽位实例不重复占用',()=>{
 const a=createGameAPI();a.createBattle({scenarioId:'ruins', ruleset:'sandbox'}); const s=a.getBattleState();
 for(const u of Object.values(s.units)) assert.equal(u.weapon,u.mainHand);
 const all=[]; for(const u of Object.values(s.units)) all.push(u.mainHand,u.offHand,u.shield,...u.gear);
 assert.equal(new Set(all.filter(Boolean)).size,all.filter(Boolean).length);
});
