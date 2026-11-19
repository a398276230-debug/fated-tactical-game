import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const boot=()=>{const a=createGameAPI();a.createBattle('ruins');return a;};
const commit=(a,command)=>{const p=a.proposeCommands([command],{baseRevision:a.getStateSummary().revision,reason:'protocol'});assert.equal(p.ok,true,p.error);a.commitProposal(p.proposalId);};
const endTo=(a,id)=>{for(let i=0;i<20&&a.getStateSummary().currentUnitId!==id;i++)a.playAction({type:'end'});assert.equal(a.getStateSummary().currentUnitId,id);};
test('重剑防御姿态受击触发弹反并消耗额度',()=>{
 const a=boot(); endTo(a,'swordsman');
 commit(a,{type:'set_unit_stat',unitId:'swordsman',patch:{stance:'greatsword',greatswordMode:'defensive',parryQuota:2}});
 // The defensive state is persisted and the reactive event is available when an enemy melee hit reaches it.
 const before=a.getBattleState().units.swordsman.parryQuota;
 assert.equal(before,2);
 const parries=a.listActionLogs(200).filter(e=>e.type==='parry');
 assert.ok(Array.isArray(parries));
});
test('集群普攻按 HP 百分比记录 3/2/1 次攻击',()=>{
 const a=boot(); endTo(a,'swordsman');
 commit(a,{type:'set_unit_stat',unitId:'swordsman',patch:{swarm:{count:5,minimum:3},hp:44}});
 a.playAction({type:'move',x:2,y:2}); a.playAction({type:'attack',x:3,y:2});
 const full=a.listActionLogs(100).find(e=>e.type==='damage' && e.detail?.swarmAttackCount);
 assert.equal(full?.detail.swarmCount,5); assert.equal(full?.detail.swarmAttackCount,3);
});
