import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const boot=()=>{const a=createGameAPI();a.createBattle({scenarioId:'boss', ruleset:'sandbox'});return a;};
test('持续区域在回合开始结算并可通过命令创建/移除',()=>{
 const a=boot(); const s=a.getBattleState(); const p=a.proposeCommands([{type:'set_zone',zone:{id:'ZT',name:'测试毒雾',x:s.units.swordsman.x,y:s.units.swordsman.y,radius:10,remainingTurns:2,damage:3,damageType:'true',team:'all'}}],{baseRevision:a.getStateSummary().revision,reason:'zone'}); assert.equal(p.ok,true,p.error); a.commitProposal(p.proposalId);
 const before=a.getStateSummary().revision; a.playAction({type:'end'}); assert.ok(a.getBattleState().logs.some(e=>e.type==='zone')); assert.ok(a.getStateSummary().revision>before);
 const q=a.proposeCommands([{type:'remove_zone',zoneId:'ZT'}],{baseRevision:a.getStateSummary().revision,reason:'cleanup'}); assert.equal(q.ok,true,q.error); a.commitProposal(q.proposalId); assert.equal(a.getBattleState().zones.ZT,undefined);
});
