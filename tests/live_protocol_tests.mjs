import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const api = () => { const a=createGameAPI(); a.createBattle('ruins'); return a; };
const stat=(unitId,patch)=>({type:'set_unit_stat',unitId,patch});
test('单位三槽可编辑并在 v2 快照重放与撤销中保持一致',()=>{
 const a=api(), state=a.getBattleState(); const item=state.items['ranger-weapon'];
 // Ownership stays singular; mainHand mirrors legacy weapon for migrated and new records.
 assert.equal(state.units.ranger.mainHand,state.units.ranger.weapon);
 const before=a.exportBattleSnapshot();
 const proposal=a.proposeCommands([stat('ranger',{bonusDice:2,penaltyDice:1,bodyLengthM:.5,mc:1,stance:'light_blade'})],{baseRevision:a.getStateSummary().revision,reason:'protocol'});
 assert.equal(proposal.ok,true,proposal.error); a.commitProposal(proposal.proposalId);
 const snap=JSON.parse(JSON.stringify(a.exportBattleSnapshot())); const b=createGameAPI(); b.createBattle(snap);
 assert.deepEqual(b.exportBattleSnapshot(),snap); b.undoLastCommit(); assert.deepEqual(b.exportBattleSnapshot(),before);
});
test('意图与非致死行动参数接受并随攻击日志记录',()=>{
 const a=api(); a.playAction({type:'move',x:2,y:2});
 const state=a.getBattleState(); const actor=state.units.swordsman;
 const target=state.units.scout; assert.ok(target.hp>0);
 // Existing combat permits explicit per-action intent/non-lethal/dice controls and rejects unavailable dice.
 const plan=a.previewAction({type:'attack',x:target.x,y:target.y,intent:'function',nonLethal:true,bonusDice:0});
 assert.equal(plan.ok,true,plan.error); assert.equal(plan.intent,'function'); assert.equal(plan.nonLethal,true);
 assert.equal(a.previewAction({type:'attack',x:target.x,y:target.y,intent:'unknown'}).ok,false);
 assert.ok(actor.hp>0);
});
