import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { validateState } from '../src/api/validation.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit } from '../src/core/combat.js';
import { initialCounters } from '../src/core/effects.js';

function fixture(spec = {}, tier=1, a=3) {
  const s=buildScenario('ruins'), actor=currentUnit(s);
  actor.tier=tier; actor.stats.int=a; actor.stats.spi=a;
  s.equipment.vial={kind:'consumable',name:'药瓶',effects:[{id:'vial_charges',trigger:'passive',target:'self',effects:[{kind:'produceResource',resource:'charges',cap:4,initial:3}]}]};
  actor.skills.push('call');
  s.skills.call={name:'召唤术',target:'self',range:1,shape:'single',ap:1,slot:'action',effects:[{id:'call_sand',trigger:'active',target:'self',effects:[{kind:'spawnUnit',name:'沙偶',...spec}]}]};
  const action={type:'skill',skillId:'call',x:actor.x,y:actor.y};
  return {s,actor,action,cast:()=>{validateState(s);const logs=applyAction(s,action);validateState(s);return logs;}};
}
for(const [tier,a,stat,hp] of [[1,3,1,105],[4,9,4,4020],[7,20,14,140070]]) test(`召唤术 T${tier}/A${a} 最终五维与资源`,()=>{
  const {s,cast}=fixture({},tier,a);cast();const u=s.units['summon-1'];assert.deepEqual(Object.values(u.stats),Array(5).fill(stat));assert.equal(u.maxHp,hp);
});
test('召唤术显式五维拒绝单项或总和超预算；关联属性和节点层级生效',()=>{
  for(const stats of [{str:4,agi:0,con:1,int:0,spi:0},{str:2,agi:1,con:1,int:1,spi:1}]) assert.throws(()=>validateState(fixture({stats}).s),/五维预算/);
  const {s,actor,cast}=fixture({tier:2,attribute:'agi'},5,20);actor.stats.agi=3;cast();const u=s.units['summon-1'];assert.equal(u.tier,2);assert.equal(u.maxHp,410);
});
test('召唤术只引用已有模板，拒绝错误槽位、内联定义和重复技能',()=>{
  for(const spec of [{skills:['absent']},{mainHand:'absent'},{shield:'vial'},{skills:['call','call']},{gear:[{name:'内联'}]}]) assert.throws(()=>validateState(fixture(spec).s));
});
test('十个召唤物各自铸造装备和计数器；登场日志、落点及 ID 唯一',()=>{
  const {s,actor,cast}=fixture({count:10,mainHand:'vial',shield:null,skills:['brand'],bodyLengthM:12});const logs=cast().filter(e=>e.type==='spawn');
  assert.equal(logs.length,10);const spots=new Set(), instances=new Set();
  for(let i=0;i<10;i++){const id=`summon-${i+1}`,u=s.units[id];assert.equal(logs[i].detail.unitId,id);assert.equal(u.team,actor.team);assert.equal(u.ap,0);assert.equal(u.weapon,u.mainHand);assert.deepEqual(u.skills,['brand']);assert.equal(u.size,5);assert.equal(u.mc,2);assert.equal(u.maxHp,25);spots.add(`${u.x},${u.y}`);instances.add(u.mainHand);assert.deepEqual(s.items[u.mainHand].counters,initialCounters(s.equipment.vial));}
  assert.equal(spots.size,10);assert.equal(instances.size,10);
});
test('落点不足整批拒绝，不遗留棋子或装备实例',()=>{
  const {s,cast}=fixture({count:2,mainHand:'vial'});
  s.interactives={};s.covers={};for(const [y,row] of s.grid.entries())for(const [x,cell] of row.entries())if(!Object.values(s.units).some(u=>u.x===x&&u.y===y))cell.kind='wall';
  const items=structuredClone(s.items),order=[...s.order];assert.ok(cast().some(l=>l.type==='spawn_unresolved'));assert.deepEqual(s.items,items);assert.deepEqual(s.order,order);
});
test('满实例表时整批拒绝，不遗留单位',()=>{
  const {s,cast}=fixture({mainHand:'vial'});let n=1;while(Object.keys(s.items).length<200){const id=`fill-${n++}`;s.items[id]={id,templateId:'vial',counters:initialCounters(s.equipment.vial)};}const logs=cast();assert.ok(logs.some(l=>l.type==='spawn_unresolved'));assert.equal(s.units['summon-1'],undefined);assert.equal(Object.keys(s.items).length,200);
});
test('旧 summon 保持克隆原型，两种节点共享确定性编号',()=>{
  const {s,actor,cast}=fixture();s.skills.call.effects[0].effects.unshift({kind:'summon',templateId:actor.id,statScale:.5,count:1});cast();assert.equal(s.units['summon-1'].name,actor.name);assert.equal(s.units['summon-1'].maxHp,Math.max(1,Math.round(actor.maxHp*.5)));assert.equal(s.units['summon-2'].name,'沙偶');
});
test('召唤事务：快照重放一致，提案撤销同时回滚单位、实例与日志',()=>{
  const {s,action}=fixture({count:2,mainHand:'vial'});const api=createGameAPI();api.createBattle({kind:'custom_state',state:s});const before=api.exportBattleSnapshot();api.playAction(action);const after=api.exportBattleSnapshot();assert.ok(api.getBattleState().units['summon-2']);
  const imported=createGameAPI();imported.restoreBattleSnapshot(JSON.parse(JSON.stringify(after)));assert.deepEqual(imported.exportBattleSnapshot(),after);
  const p=imported.proposeCommands([{type:'replay_or_undo',operation:'undo'}],{baseRevision:imported.getStateSummary().revision,reason:'撤销召唤'});assert.equal(p.ok,true,p.error);assert.equal(imported.commitProposal(p.proposalId).ok,true);assert.deepEqual(imported.exportBattleSnapshot(),before);imported.playAction(action);assert.deepEqual(imported.exportBattleSnapshot(),after);
});
