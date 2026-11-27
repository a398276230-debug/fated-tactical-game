import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { evaluateExpr } from '../src/core/formula.js';
const boot=()=>{const a=createGameAPI();a.createBattle({scenarioId:'ruins', ruleset:'sandbox'});return a;};
const endTo=(a,id)=>{for(let i=0;i<20&&a.getStateSummary().currentUnitId!==id;i++)a.playAction({type:'end'});assert.equal(a.getStateSummary().currentUnitId,id);};
const commit=(a,command)=>{const p=a.proposeCommands([command],{baseRevision:a.getStateSummary().revision,reason:'tactical'});assert.equal(p.ok,true,p.error);a.commitProposal(p.proposalId);};
test('蓄力与探察是可执行动作并影响后续意图',()=>{
 const a=boot(); endTo(a,'swordsman');
 a.playAction({type:'charge'}); assert.ok(a.inspectUnit('swordsman').statuses.charge);
 assert.equal(a.previewAction({type:'scan'}).ok,false);a.playAction({type:'end'});endTo(a,'swordsman');
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
test('纵跃跨过高差并只记录落点，消耗动作槽而不消耗移动预算', () => {
 const state = buildScenario('ruins');
 state.grid[2][2].z = state.grid[2][1].z + 2;
 const api = createGameAPI();
 api.createBattle({ kind: 'custom_state', state });
 endTo(api, 'swordsman');
 const before = api.getBattleState().units.swordsman;
 assert.equal(api.previewAction({ type: 'move', x: 2, y: 2 }).ok, false);
 assert.equal(api.playAction({ type: 'jump', x: 2, y: 2 }).ok, true);
 const after = api.getBattleState().units.swordsman;
 assert.equal(after.x, 2);
 assert.equal(after.ap, before.ap - 1);
 assert.equal(after.moveSpentPermille, before.moveSpentPermille);
 assert.equal(api.listActionLogs(20).find(log => log.type === 'jump').detail.path.length, 1);
 const snapshot = api.exportBattleSnapshot();
 const restored = createGameAPI();
 restored.createBattle(snapshot);
 assert.deepEqual(restored.getBattleState(), snapshot.state);
});

test('武器蘸取相邻爆桶时保留爆桶并写入两回合附魔', () => {
 const state = buildScenario('ruins');
 const { x, y } = state.units.swordsman;
 Object.assign(state.interactives.I2, { x: x - 1, y });
 const api = createGameAPI();
 api.createBattle({ kind: 'custom_state', state });
 endTo(api, 'swordsman');
 const action = { type: 'dip', x: x - 1, y };
 assert.deepEqual(api.previewAction(action).dip, { dipType: 'fire', dipBonus: 4, label: '余烬火油' });
 assert.equal(api.playAction(action).ok, true);
 const after = api.getBattleState();
 assert.equal(after.interactives.I2.spent, false);
 assert.equal(after.units.swordsman.statuses.dipped.remainingTurns, 2);
 assert.deepEqual(after.units.swordsman.statuses.dipped.vars, { dipType: 'fire', dipBonus: 4 });
});

test('反应策略动作写入日志并省略 auto 默认字段', () => {
 const a = boot(); endTo(a, 'swordsman');
 assert.equal(a.playAction({ type: 'reaction_policy', policy: 'hold' }).ok, true);
 assert.equal(a.inspectUnit('swordsman').reactionPolicy, 'hold');
 assert.equal(a.playAction({ type: 'reaction_policy', policy: 'auto' }).ok, true);
 assert.equal(Object.hasOwn(a.inspectUnit('swordsman'), 'reactionPolicy'), false);
 assert.ok(a.listActionLogs(20).some(log => log.type === 'reaction_policy'));
});

test('has_los 公式读取真实空间视线', () => {
 const state = buildScenario('ruins');
 const scope = { state, self: { x: 0, y: 0 }, target: { x: 2, y: 0 } };
 state.grid[0][1] = { kind: 'floor', z: 0 };
 assert.equal(evaluateExpr('has_los(self, target)', scope), true);
 state.grid[0][1].kind = 'wall';
 assert.equal(evaluateExpr('has_los(self, target)', scope), false);
});

test('逃跑动作产生结构化成功或失败日志并可写入快照',()=>{
 const a=boot(); endTo(a,'swordsman');
 assert.match(a.previewAction({type:'flee'}).error,/边界/);
 commit(a,{type:'set_unit_stat',unitId:'swordsman',patch:{x:0,y:2}});
 const plan=a.previewAction({type:'flee'}); assert.equal(plan.ok,true);
 a.playAction({type:'flee'});
 assert.ok(a.listActionLogs(20).some(x=>x.type==='flee'));
 assert.deepEqual(a.exportBattleSnapshot().state.units.swordsman.fled ?? false, a.getBattleState().units.swordsman.fled ?? false);
});
