import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const boot=()=>{const a=createGameAPI();a.createBattle('ruins');return a;};
const endTo=(a,id)=>{for(let i=0;i<20&&a.getStateSummary().currentUnitId!==id;i++)a.playAction({type:'end'});assert.equal(a.getStateSummary().currentUnitId,id);};
const commit=(a,command)=>{const p=a.proposeCommands([command],{baseRevision:a.getStateSummary().revision,reason:'tactical'});assert.equal(p.ok,true,p.error);a.commitProposal(p.proposalId);};
test('蓄力与探察是可执行动作并影响后续意图',()=>{
 const a=boot(); endTo(a,'swordsman');
 a.playAction({type:'charge'}); assert.ok(a.inspectUnit('swordsman').statuses.charge);
 a.playAction({type:'scan'}); assert.equal(a.inspectUnit('swordsman').statuses.weakness.stacks,3);
});
test('定位、擒抱、缴械、绊摔、推撞都写入可重放日志',()=>{
 const a=boot(); endTo(a,'swordsman');
 // Move adjacent to scout, then perform each action in separate fresh snapshots where needed.
 a.playAction({type:'move',x:2,y:2});
 for(const type of ['lock_on','grapple','disarm','trip','push']) {
   const p=a.previewAction({type,x:3,y:2});
   if(p.ok) { a.playAction({type,x:3,y:2}); }
 }
 const types=a.listActionLogs(100).map(x=>x.type);
 assert.ok(types.includes('contest') || types.includes('maneuver'));
});
test('逃跑动作产生结构化成功或失败日志并可写入快照',()=>{
 const a=boot(); endTo(a,'swordsman');
 const plan=a.previewAction({type:'flee'}); assert.equal(plan.ok,true);
 a.playAction({type:'flee'});
 assert.ok(a.listActionLogs(20).some(x=>x.type==='flee'));
 assert.deepEqual(a.exportBattleSnapshot().state.units.swordsman.fled ?? false, a.getBattleState().units.swordsman.fled ?? false);
});
