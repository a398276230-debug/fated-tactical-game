import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI, calculatePrebattleResources, protocolDistance } from '../src/api/game_api.js';
import { bodySizeLabel } from '../src/core/combat_protocol.js';
import { preview } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { getPool } from '../src/core/vm-pools.js';
import { validVmRule } from '../src/core/vm-schema.js';
import { resourceLabel } from '../src/core/resource_names.js';
import { formatBattleReportText } from '../src/api/battle_report.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { chooseAction } from '../src/core/ai.js';
import './spatial_tests.mjs';
import './opportunity_tests.mjs';
import './custom_status_tests.mjs';
import './api_expansion_tests.mjs';
import './custom_rules_tests.mjs';
import './dsl_tests.mjs';
import './dsl_v12_tests.mjs';
import './dsl_v13_tests.mjs';
import './dsl_migration_tests.mjs';
import './combat_protocol_tests.mjs';
import './live_protocol_tests.mjs';
import './zone_tests.mjs';
import './terrain_effects_tests.mjs';
import './spawn_unit_tests.mjs';
import './z_interaction_tests.mjs';
import './terrain_descriptor_regression_tests.mjs';
import './equipment_stance_tests.mjs';
import './report_intent_tests.mjs';
import './tactical_action_tests.mjs';
import './morale_tests.mjs';
import './control_state_tests.mjs';
import './tavern_tests.mjs';
import './ai_session_tests.mjs';
import './vm_expr_tests.mjs';
import './vm_schema_tests.mjs';
import './normalization_batches_tests.mjs';
import './arena_handoff_tests.mjs';
import './vm_pools_tests.mjs';
import './vm_carriers_tests.mjs';
import './vm_spatial_tests.mjs';
import './vm_corpus_tests.mjs';
import './skill_carrier_tests.mjs';
import './log_attribution_tests.mjs';
import './scale_grid_tavern_tests.mjs';
import './scale_runtime_tests.mjs';
import './vm_authority_tests.mjs';
import './vm_risc_symmetry_tests.mjs';
import './bellica_movement_tests.mjs';
import './bellica_spatial_tests.mjs';
import './vm_natural_roll_tests.mjs';
import './animation_tests.mjs';


const boot = (request = 'ruins') => { const a = createGameAPI(); a.createBattle(typeof request === 'string' ? {scenarioId:request, ruleset:'sandbox'} : {...request, ruleset:'sandbox'}); return a; };
test('实例资源池声明、命名、转换诊断与战报标签', () => {
  const rule = (pool, mode) => ({ id:'use-pool', hook:'active', program:[{ op:'resource', target:'self', pool, mode, amount:1, local:true }] });
  const state = boot().getBattleState();
  assert.deepEqual(state.equipment.soulblade.pools.souls, {cap:10, initial:0, reloadable:false});
  const {current, max} = getPool(state, 'soulblade-lan', 'souls', 'item');
  assert.deepEqual({current, max}, {current:0, max:10});
  validateState(state);
  for (const mode of ['add', 'set', 'sub']) {
    for (const key of ['魂数','has space','','constructor','prototype']) assert.equal(validVmRule(rule(key, mode)), false, key);
    assert.equal(validVmRule(rule('kill-charge_2', mode)), true);
  }
  const imported = hydrateFromSources({mvu:{主角:{装备:{魂刀:{类型:'武器',pools:{souls:{cap:10,initial:0},'has space':{cap:10}},rules:[rule('souls','sub')]}}}},battleInit:{units:[{id:'p',name:'主角',source:'mvu:主角',team:'blue',x:1,y:1},{id:'e',name:'敌',source:'char_info',team:'red',x:2,y:2}]}});
  const main = imported.state.units.p.mainHand;
  const templateId = imported.state.items[main].templateId;
  assert.deepEqual(imported.state.equipment[templateId].pools, {souls:{cap:10,initial:0}});
  assert.ok(imported.warnings.some(w=>w.unitId==='p' && w.originPath===`/equipment/${templateId}` && w.message.includes('pools.has space')));
  assert.equal(resourceLabel('souls'),'魂数');assert.equal(resourceLabel('kills'),'kills');
  const report = formatBattleReportText({title:'战报',units:[],rounds:[{round:1,events:[{type:'counter',text:'ammo souls · souls 0 → 1',detail:{counterKey:'souls',before:0,after:1}}]}]});
  assert.match(report,/ammo souls · 魂数 0 → 1/);
});

const act = (a, type, x, y, skillId) => a.playAction({ type, ...(x === undefined ? {} : { x, y }), ...(skillId ? { skillId } : {}) });
const probe = (a, type, x, y, skillId) => a.previewAction({ type, x, y, ...(skillId ? { skillId } : {}) });
const stats = (unitId, patch) => ({ type:'set_unit_stat', unitId, patch });
const status = (unitId, statusId, options) => ({ type:'upsert_status', unitId, statusId, ...(options ? { options } : {}) });
const remove = (unitId, statusId) => ({ type:'remove_status', unitId, statusId });
const pool = (a, itemId, key = 'souls') => getPool(a.getBattleState(), itemId, key, 'item');
const adjust = (a, itemId, value, key) => ({ type:'adjust_pool', poolId:pool(a,itemId,key).id, operation:'set', value });
const cell = (x,y,patch) => ({ type:'set_terrain_cell', x,y,patch });
const propose = (a, ...commands) => a.proposeCommands(commands, { baseRevision: a.getStateSummary().revision, reason:'验收' });
const commit = (a, ...commands) => {
  const p = propose(a, ...commands); assert.equal(p.ok, true, p.error); assert.equal(a.commitProposal(p.proposalId).ok, true); return p;
};
const u = (a, id) => a.inspectUnit(id);
const events = a => a.exportBattleReport().rounds.flatMap(r => r.events);
const end = a => act(a, 'end');
function turn(a, unitId) {
  for (let i = 0; i < 25 && a.getStateSummary().currentUnitId !== unitId; i++) end(a);
  assert.equal(a.getStateSummary().currentUnitId, unitId);
}

test('UI 体型标签按真实体长显示六档与 MC，不混淆巨型和超巨型',()=>{
  for(const [meters,name] of [[.5,'微型'],[.6,'小型'],[1.3,'中型'],[2.6,'大型'],[5.5,'巨型'],[10,'超巨型']]) {
    assert.equal(bodySizeLabel({bodyLengthM:meters,mc:meters>=10?2:1}),`${name} (${meters}m${meters>=10?' · MC 2':''})`);
  }
});
test('命中与来源使用同一体型加值：目标基础项、攻守档差及 MC 分支各计一次',()=>{
  const a=boot();act(a,'move',2,2);const s=a.getBattleState();s.ruleset='protocol';
  const target=s.units.scout, attacker=s.units.swordsman;attacker.bodyLengthM=1.7;
  const plan=()=>preview(s,{type:'attack',x:target.x,y:target.y}).targets[0];
  Object.assign(target,{size:3,bodyLengthM:1.7,mc:1});const base=plan();assert.equal(base.accuracySources.size,2);
  for(const [size,bodyLengthM,mc,expected] of [[4,3.2,1,4],[5,12,3,8],[1,.5,1,-2]]) {
    Object.assign(target,{size,bodyLengthM,mc});const result=plan();assert.equal(result.accuracySources.size,expected);assert.equal(result.accuracy-base.accuracy,expected-2);
  }
});

test('原协议资源：层级、巨兽、集群与固定召唤总数独立计算，保留受伤百分比', () => {
  const stats={str:7,agi:21,con:6,int:4,spi:4};
  const one=calculatePrebattleResources({ stats,tier:1,previous:{hp:{current:22,max:44}} });
  assert.deepEqual(one.resources.hp,{rawMax:642,max:642,current:321,ratio:.5});
  assert.equal(one.resources.mp.max,400); assert.equal(one.resources.sp.max,1400);
  const mix=calculatePrebattleResources({ stats,tier:2,bodyLengthM:50,count:3,summonCount:5 });
  assert.equal(mix.mc,4);
  assert.deepEqual(mix.multipliers,{hp:1.6,mp:.5,sp:.5});
  assert.equal(mix.resources.hp.max,3006); assert.equal(mix.resources.sp.max,2100);
  assert.equal(protocolDistance({x:0,y:0,z:0},{x:3,y:4,z:2}),5);
  assert.throws(()=>calculatePrebattleResources({stats,tier:8}), /层级/);
  assert.throws(()=>calculatePrebattleResources({stats,tier:1,summonCount:0}), /召唤/);
});

test('三个预设独立开局，种子 0 可用、读模型不泄漏引用', () => {
  for (const scenarioId of ['ruins','altar','boss']) {
    const a = boot({scenarioId,seed:0});
    assert.deepEqual(a.getBattleState(), boot({scenarioId,seed:0}).getBattleState());
    const view = a.getBattleState(); view.units.swordsman.hp = 0;
    assert.ok(u(a,'swordsman').hp > 0);
  }
});

test('固定双槽：移动→普攻，RNG/动作日志与击杀计数可撤销并精确重放', () => {
  const a = boot();
  assert.equal(u(a,'swordsman').ap,2);
  act(a,'move',2,2);
  const before = a.exportBattleSnapshot();
  assert.equal(u(a,'swordsman').ap,1);
  assert.equal(probe(a,'attack',3,2).hitChance,.95);
  assert.deepEqual(a.exportBattleSnapshot(),before);
  act(a,'attack',3,2);
  const after = a.exportBattleSnapshot();
  assert.equal(u(a,'scout').hp,0);
  a.undoLastCommit(); assert.deepEqual(a.exportBattleSnapshot(),before);
  act(a,'attack',3,2); assert.deepEqual(a.exportBattleSnapshot(),after);
  assert.equal(pool(a,'soulblade-spare').current,0);
  assert.equal(pool(a,'soulblade-lan').current,1);
});

test('架势防御区分空地与借掩体，战报不把站位当成遮蔽', () => {
  const a=boot();
  assert.equal(a.previewAction({type:'brace'}).turns,1);
  commit(a, stats('scout',{x:3,y:0}));
  act(a,'move',3,2);
  assert.equal(a.previewAction({type:'brace'}).ok,false); end(a); turn(a,'swordsman');
  const p=a.previewAction({type:'brace'});
  assert.equal(p.coverId,'C1'); assert.equal(p.turns,2); assert.equal(p.reduction,.35);
  act(a,'brace');
  const text=a.exportBattleReportText();
  assert.match(text,/移至掩体 C1 旁/);
  assert.match(text,/借 C1 架势防御（减伤 35%，2 回合）/);
  assert.doesNotMatch(text,/遮蔽/);
});

test('拒绝旧战局快照并保留当前 VM 战局；当前版本仍可恢复及撤销', () => {
  const a=boot(); const origin=a.exportBattleSnapshot(); act(a,'move',2,2);
  const saved=a.exportBattleSnapshot();
  const b=boot('boss'); const before=b.exportBattleSnapshot();
  assert.throws(() => b.restoreBattleSnapshot({...saved, version:1}), /仅支持版本 11/);
  assert.deepEqual(b.exportBattleSnapshot(),before);
  b.restoreBattleSnapshot(saved);
  assert.equal(b.exportBattleSnapshot().version,11);
  assert.deepEqual(b.exportBattleSnapshot(),saved);
  assert.equal(b.undoLastCommit().ok,true);
  assert.deepEqual(b.exportBattleSnapshot(),origin);
});

test('精简战报按轮和行动单位分组，不带骰值、JSON 或重复移动', () => {
  const a=boot();
  act(a,'move',2,2); act(a,'attack',3,2);
  const before=a.exportBattleSnapshot();
  const text=a.exportBattleReportText();
  assert.match(text,/^- 回合一$/m);
  assert.match(text,/确定先攻次序：岚 · 噬魂剑客\(1, 2, z=0\) → /);
  assert.match(text,/岚 · 噬魂剑客\(1, 2, z=0\)开始回合：移动至 \(2, 2, z=0\)；[^\n]*岚 · 噬魂剑客\(2, 2, z=0\)[^\n]*噬魂太刀[^\n]*受伤斥候\(3, 2, z=0\)/);
  assert.match(text,/受伤斥候\(3, 2, z=0\)倒下[^\n]*(?:魂数|SOULS) 0 → 1/);
  assert.equal(text.match(/移动至 \(2, 2, z=0\)/g)?.length,1);
  assert.doesNotMatch(text,/d20|swordsman|\bjournal\b|26\/12/);
  assert.deepEqual(a.exportBattleSnapshot(),before);
  assert.ok(a.exportBattleReport().rounds[0].events.some(e=>e.type==='roll' && e.positions?.swordsman));
  assert.doesNotMatch(text, /<UpdateVariable>/);
});

test('双槽禁止两次移动；重技占 2 AP；轻技消耗 MP、施加状态', () => {
  const a = boot({mode:'split'});
  act(a,'move',2,2);
  assert.match(probe(a,'move',3,3).error,/槽/);
  assert.match(probe(a,'skill',3,2,'surge').error,/2 AP/);
  assert.throws(() => act(a,'skill',2,2,'armor'), /槽/);
  const b = boot();
  act(b,'skill',3,2,'challenge');
  assert.equal(u(b,'scout').statuses.taunt.sourceId,'swordsman');
  assert.equal(u(b,'swordsman').mp,12);
});

test('优势/劣势抵消；自然 1/20 门槛与命中概率可审计', () => {
  const a = boot();
  commit(a, stats('scout',{x:2, hp:4}), status('swordsman','blind'));
  assert.equal(probe(a,'attack',2,2).advantage,-1);
  assert.equal(probe(a,'attack',2,2).hitChance,.95 ** 2);
  commit(a, status('swordsman','stealth'));
  assert.equal(probe(a,'attack',2,2).advantage,0);
  commit(a, remove('swordsman','blind'));
  assert.equal(probe(a,'attack',2,2).advantage,1);
  assert.ok(Math.abs(probe(a,'attack',2,2).hitChance-.9975)<1e-12);
  act(a,'attack',2,2); const roll=events(a).find(e=>e.type==='roll').detail;
  assert.equal(roll.selected,Math.max(...roll.dice)); assert.equal(roll.total,roll.selected+roll.accuracy);
});

test('装备转手/热改/跨战：同名两刀不串值，常驻状态跟随 ID', () => {
  const a = boot();
  commit(a,adjust(a,'soulblade-lan',3),adjust(a,'soulblade-spare',2), status('swordsman','haste',{durationType:'persistent'}), status('swordsman','blind'));
  const mods = a.getBattleState().equipment.soulblade.mods.map(mod => mod.stat === 'damageMult' ? {...mod, mult:'1 + 0.75 * event.souls'} : mod);
  commit(a,{type:'patch_equipment_template',templateId:'soulblade',patch:{mods}},
    {type:'equip_item',instanceId:'soulblade-lan',unitId:'ranger'},{type:'equip_item',instanceId:'soulblade-spare',unitId:'swordsman'});
  assert.equal(u(a,'ranger').equipment[0].id,'soulblade-lan');
  assert.equal(u(a,'swordsman').equipment[0].id,'soulblade-spare');
  assert.equal(pool(a,'soulblade-lan').current,3);
  assert.equal(pool(a,'soulblade-spare').current,2);
  assert.deepEqual(u(a,'swordsman').equipment[0].mods,mods);
  assert.equal(a.previewAction({type:'attack'}).multiplier,2.5);
  const b=boot({scenarioId:'altar',persistentSnapshot:JSON.parse(JSON.stringify(a.exportPersistentCarryOver()))});
  assert.equal(u(b,'ranger').weapon,'soulblade-lan');
  assert.ok(u(b,'swordsman').statuses.haste);
  assert.equal(u(b,'swordsman').statuses.blind,undefined);
  assert.equal(pool(b,'soulblade-lan').current,3);
});

test('DoT / HoT、叠层及持续：开头灼烧中毒再生，回合末流血', () => {
  const a=boot();
  commit(a,stats('oracle',{hp:25}),status('oracle','burn'),status('oracle','regen'),status('oracle','poison'),status('oracle','bleed'),status('oracle','bleed'));
  turn(a,'oracle'); assert.equal(u(a,'oracle').hp,23); assert.equal(u(a,'oracle').statuses.bleed.stacks,2);
  end(a); assert.equal(u(a,'oracle').hp,17);
  assert.equal(u(a,'oracle').statuses.bleed.remainingTurns,2);
  assert.equal(pool(a,'soulblade-lan').current,0);
});

test('流血和中毒跳过护甲与架势减伤，灼烧仍受减伤', () => {
  const a = boot();
  commit(a, stats('oracle', { hp: 25 }), status('oracle', 'guarded'),
    status('oracle', 'burn'), status('oracle', 'poison'), status('oracle', 'bleed'));
  turn(a, 'oracle');
  assert.equal(u(a, 'oracle').hp, 19);
  end(a);
  assert.equal(u(a, 'oracle').hp, 16);
  const ticks = events(a).filter(event => event.type === 'damage' && event.detail.targetId === 'oracle');
  assert.deepEqual(ticks.map(({ detail }) => [detail.damageType, detail.amount, detail.hpBefore, detail.hpAfter]), [
    ['energy', 3, 25, 22], ['true', 3, 22, 19], ['true', 3, 19, 16],
  ]);
});

test('护盾、冻伤碎冰、棘甲反伤、援护在同一笔伤害事务中正确归因', () => {
  const a=boot();
  commit(a,stats('scout',{x:2}),stats('gunner',{x:2,y:3}),status('gunner','guard'),status('scout','freeze'),status('gunner','shield',{amount:2}),status('gunner','thorns'));
  const p=probe(a,'attack',2,2);
  assert.equal(p.recipientId,'gunner'); assert.equal(p.shield,2);
  act(a,'attack',2,2);
  assert.equal(u(a,'scout').hp,4);
  assert.equal(u(a,'swordsman').hp,39);
  assert.equal(events(a).find(e=>e.type==='damage' && e.detail.targetId==='gunner').detail.absorbed,2);
  assert.equal(u(a,'gunner').statuses.shield,undefined);
  assert.ok(u(a,'gunner').hp<27);
  const b=boot(), baseline=boot();
  commit(b,stats('gunner',{x:2,y:2}),status('gunner','freeze'));
  commit(baseline,stats('gunner',{x:2,y:2}));
  act(b,'attack',2,2);
  act(baseline,'attack',2,2);
  assert.ok(u(b,'gunner').hp<u(baseline,'gunner').hp,'冻伤碎冰应增加实际伤害');
});

test('眩晕跳过一轮行动；定身仍可施法；嘲讽迫使选择来源', () => {
  const a=boot();
  commit(a,stats('scout',{x:2}),stats('raider',{x:1,y:1}),status('swordsman','root'),status('swordsman','taunt',{sourceUnitId:'raider'}),status('oracle','stun'));
  assert.match(probe(a,'move',0,2).error,/定身/);
  assert.match(probe(a,'attack',2,2).error,/嘲讽/);
  assert.equal(probe(a,'skill',1,1,'brand').ok,true);
  end(a); assert.notEqual(a.getStateSummary().currentUnitId,'oracle');
  assert.ok(events(a).some(e=>e.type==='skip'&&e.actor==='oracle'));
});

test('弩弹、1AP 装填、同一槽不能复用；祭坛给予可见护盾疾走', () => {
  const a=boot(); turn(a,'ranger');
  commit(a,adjust(a,'ranger-weapon',0,'ammo'));
  assert.match(a.previewAction({type:'attack'}).error,/弹仓/);
  act(a,'reload'); assert.equal(u(a,'ranger').ap,1);
  assert.equal(pool(a,'ranger-weapon','ammo').current,6);
  assert.equal(probe(a,'interact',2,3).ok,false); end(a);turn(a,'ranger');
  act(a,'interact',2,3); assert.ok(u(a,'ranger').statuses.haste); assert.equal(u(a,'ranger').statuses.shield.amount,10);
});

test('掩体坍塌让路径重新可通行；AOE 不透墙，Z 高差反映在预览', () => {
  const a=boot();
  commit(a,stats('scout',{x:3,y:1}),stats('swordsman',{x:3}),{type:'set_interactive_status',id:'C1',hp:1});
  assert.equal(probe(a,'move',4,2).ok,false);
  act(a,'attack',4,2); assert.equal(a.getBattleState().covers.C1.hp,0);
  assert.equal(probe(a,'move',4,2).ok,true);
  turn(a,'oracle');
  commit(a,stats('oracle',{x:1,y:1}),stats('gunner',{x:5,y:0}), cell(4,0,{kind:'wall'}),cell(4,1,{kind:'wall'}),cell(1,1,{z:2}));
  const p=probe(a,'skill',3,0,'frost');
  assert.equal(p.ok,true); assert.ok(p.dXYZ>2); assert.equal(p.dz,2);
  assert.ok(!p.cells.some(c=>c.x===5&&c.y===0));
});

test('圣咏徽记提升团队治疗并附盾；净化保留常驻效果', () => {
  const a=boot(); turn(a,'oracle');
  commit(a,stats('swordsman',{hp:19}),stats('ranger',{hp:20}), status('swordsman','root'), status('swordsman','vulnerable',{durationType:'persistent'}));
  act(a,'skill',1,2,'cleanse');
  assert.equal(u(a,'swordsman').statuses.root,undefined);
  assert.ok(u(a,'swordsman').statuses.vulnerable);
  assert.ok(u(a,'swordsman').hp>19);
  const cleanseShield=u(a,'swordsman').statuses.shield?.vars.shieldAmount;
  end(a); turn(a,'oracle');
  const p=probe(a,'skill',1,3,'hymn');
  assert.ok(p.targets.some(t=>t.id==='swordsman'));
  assert.ok(p.targets.some(t=>t.id==='ranger'));
  act(a,'skill',1,3,'hymn');
  assert.ok(u(a,'ranger').statuses.regen);
  assert.deepEqual({
    cleanse: cleanseShield > 0,
    hymn: u(a,'ranger').statuses.shield?.vars.shieldAmount > 0,
  }, {cleanse:true, hymn:true}, '净化和团队治疗均应触发圣咏徽记护盾');
});

test('重斩击退撞墙并晕眩；爆桶不是刀的直杀来源', () => {
  const a=boot('boss');
  commit(a,stats('colossus',{x:2,y:4}),cell(3,4,{z:2}));
  act(a,'skill',2,4,'surge');
  assert.ok(events(a).some(e=>e.type==='knockback'));
  assert.ok(events(a).some(e=>e.type==='damage'&&e.text.includes('撞击')));
  assert.ok(u(a,'colossus').statuses.stun);
  const b=boot();
  commit(b,stats('swordsman',{x:8,y:6}),stats('scout',{x:7,y:7}));
  act(b,'interact',7,6);
  assert.equal(u(b,'scout').hp,0);
  assert.equal(pool(b,'soulblade-lan').current,0);
});

test('爆桶按武器射程与视线引爆，祭坛独立消耗动作槽', () => {
  const a=boot({mode:'free'});
  assert.equal(a.getStateSummary().mode,'split');
  const barrel={x:7,y:6}, altar={x:2,y:3};
  commit(a,stats('swordsman',{x:7,y:9}),stats('scout',{x:7,y:7}));
  assert.equal(probe(a,'attack',barrel.x,barrel.y).ok,false);
  assert.equal(probe(a,'interact',barrel.x,barrel.y).ok,false);
  turn(a,'ranger');
  commit(a,stats('ranger',{x:7,y:9}),stats('swordsman',{x:1,y:2}),cell(7,8,{kind:'wall'}));
  assert.equal(probe(a,'attack',barrel.x,barrel.y).ok,false);
  commit(a,cell(7,8,{kind:'floor'}));
  assert.equal(probe(a,'interact',altar.x,altar.y).ok,false);
  const plan=probe(a,'attack',barrel.x,barrel.y);
  assert.equal(plan.distance,3);
  assert.equal(plan.slot,'attack');
  assert.deepEqual(probe(a,'interact',barrel.x,barrel.y),plan);
  assert.ok(plan.targets.some(target=>target.id==='scout'));
  assert.ok(a.previewAction({type:'interact'}).cells.some(at=>at.x===7&&at.y===6));
  act(a,'interact',barrel.x,barrel.y);
  assert.equal(a.getBattleState().interactives.I2.spent,true);
  assert.equal(u(a,'scout').hp,0);
  assert.equal(pool(a,'ranger-weapon','ammo').current,5);
  assert.equal(a.previewAction({type:'attack'}).ok,false);
  assert.equal(a.previewAction({type:'brace'}).ok,true);
});

test('白名单拒绝畸形值；事务原子；幂等检查、真实 diff 和 revision 失效', () => {
  const a=boot(); const snap=a.exportBattleSnapshot();
  const souls = value => adjust(a,'soulblade-lan',value);
  for (const command of [{}, {type:'nope'}, stats('swordsman',{}), stats('swordsman',{hp:100000}), stats('swordsman',{x:10}), stats('swordsman',{mp:NaN}), status('swordsman','not_real'), souls(11), cell(1,2,{kind:'wall'}), JSON.parse('{"type":"set_unit_stat","unitId":"swordsman","patch":{"__proto__":{}}}')]) {
    assert.equal(propose(a,command).ok,false,JSON.stringify(command));
  }
  assert.equal(propose(a,souls(3),{}).ok,false);
  const p=propose(a,souls(3));
  assert.deepEqual(a.exportBattleSnapshot(),snap);
  assert.deepEqual(p.diff,[{path:['pools',souls(3).poolId,'current'],before:0,after:3}]);
  assert.equal(a.commitProposal(p.proposalId).ok,true);
  assert.equal(a.commitProposal(p.proposalId).ok,false);
  const stale=propose(a,souls(4));
  const rollback=propose(a,{type:'replay_or_undo',operation:'undo'});
  assert.equal(a.commitProposal(rollback.proposalId).ok,true);
  assert.equal(a.commitProposal(stale.proposalId).ok,false);
  assert.deepEqual(a.exportBattleSnapshot(),snap);
});

test('技能热改、增援/撤离与复原；篡改快照无法替换战局', () => {
  const a=boot();
  const copy=a.getBattleState().units.scout;
  delete copy.pools;
  Object.assign(copy,{id:'reserve',name:'援军',x:9,y:9,weapon:null,mainHand:null,ap:0});
  commit(a,{type:'spawn_unit',unit:copy},{type:'patch_skill_template',templateId:'brand',patch:{mp:3}});
  assert.equal(u(a,'reserve').hp,4);
  assert.equal(probe(a,'skill',3,2,'brand').mp,3);
  commit(a,{type:'remove_unit',unitId:'reserve'});
  const saved=JSON.parse(JSON.stringify(a.exportBattleSnapshot()));
  const b=boot('boss'); b.restoreBattleSnapshot(saved); assert.deepEqual(b.exportBattleSnapshot(),saved);
  assert.equal(b.undoLastCommit().ok,true); assert.ok(u(b,'reserve'));
  saved.state.units.scout.hp=2;
  assert.throws(()=>b.restoreBattleSnapshot(saved),/不一致/); assert.ok(u(b,'reserve'));
});

test('当前单位撤离后自动交棒，不继承旧 AP；可完整撤销', () => {
  const a=boot(); const before=a.exportBattleSnapshot();
  commit(a,{type:'remove_unit',unitId:'swordsman'});
  assert.equal(a.getStateSummary().currentUnitId,before.state.order[1]);
  assert.equal(u(a,before.state.order[1]).ap,2);
  assert.equal(u(a,'swordsman'),null);
  a.undoLastCommit(); assert.deepEqual(a.exportBattleSnapshot(),before);
});

test('敌方战术 AI 给出确定且合法的一步，试算不改 RNG', () => {
  const a=boot(); turn(a,'gunner');
  const before=a.exportBattleSnapshot(), s=a.getBattleState(); const command=chooseAction(s);
  assert.deepEqual(command,chooseAction(a.getBattleState())); assert.deepEqual(s,before.state);
  assert.equal(a.previewAction(command).ok,true);
  assert.equal(a.stepEnemy().ok,true); assert.notDeepEqual(a.exportBattleSnapshot(),before);
});

// Shared-cell routes and point-blank actions change fixed-seed tactics.
// 敌方限定的毒雾锥不再误伤友军，祭坛战固定种子的行动序列随之改变。
for (const [scenarioId, winner] of [['ruins', 'blue'], ['altar', 'red'], ['boss', 'red']]) {
  test(`${scenarioId} 打到胜负并完整重放战报和 JSON 日志`, () => {
    const a=boot(scenarioId);
    for(let i=0; i<200&&!a.getStateSummary().outcome; i++) {
      a.playAction(chooseAction(a.getBattleState()));
    }
    const snapshot=JSON.parse(JSON.stringify(a.exportBattleSnapshot()));
    const b=createGameAPI(); b.createBattle(snapshot);
    assert.deepEqual(b.exportBattleSnapshot(),snapshot);
    assert.deepEqual(b.exportBattleReport(),a.exportBattleReport());
    assert.equal(a.getStateSummary().outcome, winner, scenarioId);
  });
}
