import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { STANCE_RULES } from '../src/core/combat_protocol.js';
import { applyAction, preview } from '../src/core/combat.js';
const stance = u => u.stance;
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
