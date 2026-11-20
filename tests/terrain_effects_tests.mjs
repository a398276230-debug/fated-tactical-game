import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { applyAction, currentUnit, refreshOutcome } from '../src/core/combat.js';
import { elevation, hasLOS } from '../src/core/spatial.js';
import { validateState } from '../src/api/validation.js';
import { validExpression } from '../src/core/effect_schema.js';

const point = (x, y) => ({ cells: [{x,y}] });
const wall = (area, duration = {}) => ({kind:'setTerrainKind',terrainKind:'wall',area,...duration});
const raise = (area, duration = {}) => ({kind:'modifyTerrain',terrain:'raise',amount:2,area,...duration});
function setup() {
  const {state} = hydrateFromSources({battleInit:{units:[
    {id:'p',name:'术士',team:'blue',x:1,y:1}, {id:'e',name:'敌人',team:'red',x:4,y:1},
    {id:'reserve',name:'援军',team:'blue',x:8,y:8}],grid:{slopes:[[2,1,1]]}}}, {throwOnValidation:true});
  const cast = (...nodes) => {
    const actor = currentUnit(state);
    actor.ap = 2;
    actor.used = {action:0,attack:0};
    const id = 'test_terrain';
    state.skills[id] = {name:'地形',ap:1,slot:'action',range:4,shape:'single',target:'cell',effects:[{id,trigger:'active',target:'self',effects:nodes}]};
    if (!actor.skills.includes(id)) actor.skills.push(id);
    validateState(state);
    const logs = applyAction(state,{type:'skill',skillId:id,x:actor.x,y:actor.y});
    validateState(structuredClone(state));
    return logs;
  };
  const end = () => {applyAction(state,{type:'end'});validateState(state);};
  return {state,cast,end};
}

test('G146/G147 矩形抬高及单位实际高度',()=>{
  const {state,cast}=setup();cast(raise({rect:{x1:1,y1:1,x2:2,y2:2}}));
  assert.equal(elevation(state,state.units.p),2);assert.equal(state.grid[2][2].z,2);assert.equal(state.grid[1][2].z,3);
});
test('G148/G149/G156 墙避开单位，失败标为未解决，视线实时阻断',()=>{
  const {state,cast}=setup();assert.ok(hasLOS(state,state.units.p,state.units.e));
  const logs=cast(wall({rect:{x1:1,y1:1,x2:2,y2:1}}));assert.equal(state.grid[1][1].kind,'floor');assert.equal(state.grid[1][2].kind,'wall');assert.ok(!hasLOS(state,state.units.p,state.units.e));
  assert.ok(logs.some(l=>l.text==='1 格因单位占用被跳过'));
  const rejected=cast(wall(point(1,1)));assert.ok(rejected.some(l=>l.detail.unresolved===true&&l.text==='地形效果未生效：目标区域全部被单位占用'));assert.equal(Object.keys(state.terrainPatches).length,1);
});
test('G150/G151/G152 临时掩体与三回合精确还原，永久坡保留',()=>{
  const {state,cast,end}=setup();const before={...state.grid[1][2]};assert.equal(before.kind,'slope');
  cast(wall(point(2,1),{remainingTurns:3}),{kind:'addCover',hp:30,area:point(3,1)}, {kind:'setTerrainKind',terrainKind:'slope',area:point(3,2),persistent:true});
  assert.equal(Object.values(state.covers)[0].hp,30);end();assert.equal(Object.keys(state.covers).length,0);end();assert.equal(state.grid[1][2].kind,'wall');end();assert.deepEqual(state.grid[1][2],before);assert.equal(state.grid[2][3].kind,'slope');
});
test('G153 重叠同回合逆序还原及旧层先到期',()=>{
  for (const first of [1,2]) {
    const {state,cast,end}=setup();const before={...state.grid[1][2]};cast(raise(point(2,1),{remainingTurns:first}),wall(point(2,1),{remainingTurns:2}));
    end();assert.deepEqual(state.grid[1][2],{kind:'wall',z:before.z+(first===1?0:2)});end();assert.deepEqual(state.grid[1][2],before);
  }
});
test('G154/G155 跟随锚点换格，伤害击倒锚点后即时清除',()=>{
  const {state,cast,end}=setup();state.turn=state.order.indexOf('p');cast(raise({center:'self',radius:0,follow:true},{persistent:true}));
  state.units.p.x=2;state.units.p.y=2;end();assert.equal(state.grid[1][1].z,0);assert.equal(elevation(state,state.units.p),2);
  state.turn=state.order.indexOf('e');state.units.e.hp=1;
  // A second following effect anchored to a unit on the verge of defeat.
  cast(raise({center:'self',radius:0,follow:true},{persistent:true}),{kind:'damage',amount:9999,damageType:'true'});
  assert.equal(state.units.e.hp,0);assert.equal(state.grid[1][4].z,0);assert.equal(Object.keys(state.terrainPatches).length,1);assert.ok(state.logs.some(l=>l.type==='terrain_expire'));
  state.units.p.fled = true;
  refreshOutcome(state);
  assert.equal(state.grid[2][2].z, 0);
  assert.equal(Object.keys(state.terrainPatches).length, 0);
  assert.match(state.logs.findLast(l => l.type === 'terrain_expire').text, /因锚点离场而消散/);
});
test('到期立即还原被占用的原墙，单位不留在墙内',()=>{
  const {state,cast,end}=setup();
  state.grid[2][2]={kind:'wall',z:2};
  cast({kind:'setTerrainKind',terrainKind:'floor',area:point(2,2)});
  state.units.p.x=2;state.units.p.y=2;
  end();assert.deepEqual(state.grid[2][2],{kind:'wall',z:2});
  assert.notDeepEqual([state.units.p.x,state.units.p.y],[2,2]);
  assert.deepEqual(state.terrainPatches,{});
});

for (const [gate, before, node, damage] of [
  [158,{kind:'floor',z:0},{kind:'modifyTerrain',terrain:'set',amount:3},150],
  [159,{kind:'slope',z:3},{kind:'setTerrainKind',terrainKind:'floor'},100],
  [160,{kind:'floor',z:0},{kind:'setTerrainKind',terrainKind:'slope'},50],
]) test(`G${gate} 到期立即还原并扣 ${damage} HP`,()=>{
  const {state,cast,end}=setup();
  state.grid[2][2]=before;
  cast({...node,area:point(2,2)});
  const unit=state.units.p;
  Object.assign(unit,{x:2,y:2,hp:500,maxHp:500});
  end();
  assert.deepEqual(state.grid[2][2],before);
  assert.equal(unit.hp,500-damage);
  assert.deepEqual(state.terrainPatches,{});
  assert.ok(state.logs.some(l=>l.type==='damage'&&l.detail.targetId===unit.id&&l.detail.amount===damage&&l.text.includes('坠落')));
});

test('直接降低高度走正式扣血、倒下和尸体流程，逃离单位不受伤',()=>{
  const {state,cast}=setup();
  state.grid[2][2]={kind:'floor',z:3};
  Object.assign(state.units.e,{x:2,y:2,hp:100,maxHp:100});
  Object.assign(state.units.reserve,{fled:true});
  const reserve=state.units.reserve.hp;
  state.grid[8][8]={kind:'floor',z:3};
  cast({kind:'modifyTerrain',terrain:'set',amount:0,area:{cells:[{x:2,y:2},{x:8,y:8}]}});
  assert.equal(state.units.e.hp,0);
  assert.equal(state.units.e.corpseOf,'e');
  assert.ok(state.logs.some(l=>l.type==='defeat'&&l.detail.targetId==='e'));
  assert.equal(state.units.reserve.hp,reserve);
});
test('跟随区重叠格不因内部移除和重放而重复坠落',()=>{
  const {state,cast,end}=setup();
  state.turn=state.order.indexOf('p');
  cast(raise({center:'self',radius:1,follow:true},{persistent:true}));
  const unit=state.units.p;
  Object.assign(unit,{x:2,y:1,hp:500,maxHp:500});
  end();
  assert.equal(unit.hp,500);
  assert.equal(state.grid[1][2].z,3);
});

test('地形范围与时限校验拒绝混用范围和无单位跟随',()=>{
  const check = area => validExpression({id:'t',trigger:'active',target:'self',effects:[wall(area)]});
  assert.equal(check({center:{x:3,y:3},radius:1,follow:true}),false);
  assert.equal(check({rect:{x1:0,y1:0,x2:2,y2:2},...point(1,1)}),false);
  assert.equal(check({center:'hitTarget',radius:2,follow:true}),true);
});
