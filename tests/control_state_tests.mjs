import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const boot=()=>{const a=createGameAPI();a.createBattle('altar');return a;};
const commit=(a,command)=>{const p=a.proposeCommands([command],{baseRevision:a.getStateSummary().revision,reason:'control'});assert.equal(p.ok,true,p.error);a.commitProposal(p.proposalId);};
test('倒地状态阻止移动但不阻止攻击',()=>{
 const a=boot(); for(let i=0;i<20&&a.getStateSummary().currentUnitId!=='sentinel';i++)a.playAction({type:'end'}); commit(a,{type:'upsert_status',unitId:'sentinel',statusId:'prone'});
 const s=a.getBattleState(); const u=s.units.sentinel;
 assert.equal(a.previewAction({type:'move',x:u.x-1,y:u.y}).ok,false);
 assert.equal(a.previewAction({type:'attack',x:1,y:3}).ok || a.previewAction({type:'attack'}).ok,true);
});
test('缴械后主手为空且攻击退回徒手模板',()=>{
 const a=boot(); for(let i=0;i<20&&a.getStateSummary().currentUnitId!=='sentinel';i++)a.playAction({type:'end'}); commit(a,{type:'set_unit_stat',unitId:'sentinel',patch:{weapon:null,mainHand:null}});
 const u=a.getBattleState().units.sentinel;
 assert.equal(u.weapon,null); assert.equal(u.mainHand,null);
 const p=a.previewAction({type:'attack'}); assert.equal(p.ok,true); assert.equal(p.name,'徒手');
});
