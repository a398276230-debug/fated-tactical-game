import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI, calculatePrebattleResources, protocolDistance } from '../src/api/game_api.js';
import { chooseAction } from '../src/core/ai.js';
import './spatial_tests.mjs';
import './opportunity_tests.mjs';
import './custom_status_tests.mjs';
import './combat_protocol_tests.mjs';

const boot = (request = 'ruins') => { const a = createGameAPI(); a.createBattle(request); return a; };
const act = (a, type, x, y, skillId) => a.playAction({ type, ...(x === undefined ? {} : { x, y }), ...(skillId ? { skillId } : {}) });
const probe = (a, type, x, y, skillId) => a.previewAction({ type, x, y, ...(skillId ? { skillId } : {}) });
const stats = (unitId, patch) => ({ type:'set_unit_stat', unitId, patch });
const status = (unitId, statusId, options) => ({ type:'upsert_status', unitId, statusId, ...(options ? { options } : {}) });
const remove = (unitId, statusId) => ({ type:'remove_status', unitId, statusId });
const counter = (instanceId, value, counterKey = 'souls') => ({ type:'adjust_item_counter', instanceId, counterKey, operation:'set', value });
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

test('自由 2 AP：移动→普攻，RNG/动作日志与击杀计数可撤销并精确重放', () => {
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
  assert.equal(a.getBattleState().items['soulblade-lan'].counters.souls,1);
  assert.equal(a.getBattleState().items['soulblade-spare'].counters.souls,0);
  a.undoLastCommit(); assert.deepEqual(a.exportBattleSnapshot(),before);
  act(a,'attack',3,2); assert.deepEqual(a.exportBattleSnapshot(),after);
});

test('架势防御区分空地与借掩体，战报不把站位当成遮蔽', () => {
  const a=boot();
  assert.equal(a.previewAction({type:'brace'}).turns,1);
  commit(a, stats('scout',{x:3,y:0}));
  act(a,'move',3,2);
  const p=a.previewAction({type:'brace'});
  assert.equal(p.coverId,'C1'); assert.equal(p.turns,2); assert.equal(p.reduction,.35);
  act(a,'brace');
  const text=a.exportBattleReportText();
  assert.match(text,/移至掩体 C1 旁/);
  assert.match(text,/借 C1 架势防御（减伤 35%，2 回合）/);
  assert.doesNotMatch(text,/遮蔽/);
});

test('旧战局按末态续接，不将新规则反算到旧撤销记录', () => {
  const a=boot(); act(a,'move',2,2);
  const saved=a.exportBattleSnapshot(); saved.version=1;
  const b=createGameAPI(); assert.equal(b.restoreBattleSnapshot(saved).migratedFrom,1);
  assert.deepEqual(b.getBattleState(),saved.state);
  assert.equal(b.undoLastCommit().ok,false);
  assert.equal(b.exportBattleSnapshot().version,2);
});

test('精简战报按轮和行动单位分组，不带骰值、JSON 或重复移动', () => {
  const a=boot();
  act(a,'move',2,2); act(a,'attack',3,2);
  const before=a.exportBattleSnapshot();
  const text=a.exportBattleReportText();
  assert.match(text,/^- 回合一$/m);
  assert.match(text,/确定先攻次序：岚 · 噬魂剑客 → /);
  assert.match(text,/岚 · 噬魂剑客开始回合：移动至 \(2, 2\)；使用噬魂太刀/);
  assert.match(text,/受伤斥候倒下；噬魂太刀 · 魂数 0 → 1/);
  assert.doesNotMatch(text,/d20|swordsman|\bjournal\b|26\/12/);
  assert.deepEqual(a.exportBattleSnapshot(),before);
  assert.ok(a.exportBattleReport().rounds[0].events.some(e=>e.type==='roll'));
});

test('双槽禁止两次移动；重技占 2 AP；轻技消耗 MP、施加状态', () => {
  const a = boot({mode:'split'});
  act(a,'move',2,2);
  assert.match(probe(a,'move',3,3).error,/槽/);
  assert.match(probe(a,'skill',3,2,'surge').error,/2 AP/);
  assert.throws(() => act(a,'skill',2,2,'armor'), /槽/);
  const b = boot();
  act(b,'skill',3,2,'challenge');
  assert.equal(u(b,'scout').statuses.taunt.sourceUnitId,'swordsman');
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
  commit(a,counter('soulblade-lan',3),counter('soulblade-spare',2), status('swordsman','haste',{durationType:'persistent'}), status('swordsman','blind'));
  commit(a,{type:'patch_equipment_template',templateId:'soulblade',patch:{effects:[{kind:'kill_charge_weapon',counterKey:'souls',bonusPerStack:.75,maxStacks:8}]}},
    {type:'equip_item',instanceId:'soulblade-lan',unitId:'ranger'},{type:'equip_item',instanceId:'soulblade-spare',unitId:'swordsman'});
  assert.equal(u(a,'ranger').equipment[0].counters.souls,3);
  assert.equal(u(a,'swordsman').equipment[0].counters.souls,2);
  assert.equal(a.previewAction({type:'attack'}).multiplier,2.5);
  const b=boot({scenarioId:'altar',persistentSnapshot:JSON.parse(JSON.stringify(a.exportPersistentCarryOver()))});
  assert.equal(u(b,'ranger').weapon,'soulblade-lan');
  assert.equal(u(b,'ranger').equipment[0].counters.souls,3);
  assert.ok(u(b,'swordsman').statuses.haste);
  assert.equal(u(b,'swordsman').statuses.blind,undefined);
});

test('DoT / HoT、叠层及持续：开头灼烧中毒再生，回合末流血', () => {
  const a=boot();
  commit(a,stats('oracle',{hp:25}),status('oracle','burn'),status('oracle','regen'),status('oracle','poison'),status('oracle','bleed'),status('oracle','bleed'));
  turn(a,'oracle'); assert.equal(u(a,'oracle').hp,22); assert.equal(u(a,'oracle').statuses.bleed.stacks,2);
  end(a); assert.equal(u(a,'oracle').hp,16);
  assert.equal(u(a,'oracle').statuses.bleed.remainingTurns,2);
  assert.equal(a.getBattleState().items['soulblade-lan'].counters.souls,0);
});

test('护盾、冻伤碎冰、棘甲反伤、援护在同一笔伤害事务中正确归因', () => {
  const a=boot();
  commit(a,stats('scout',{x:2}),stats('gunner',{x:2,y:3}),status('gunner','guard'),status('scout','freeze'),status('gunner','shield',{amount:2}),status('gunner','thorns'));
  const p=probe(a,'attack',2,2);
  assert.equal(p.recipientId,'gunner'); assert.equal(p.shield,2);
  act(a,'attack',2,2);
  assert.equal(u(a,'scout').hp,4);
  assert.equal(u(a,'swordsman').hp,39);
  assert.ok(events(a).some(e=>e.type==='shield_break'));
  const b=boot();
  commit(b,stats('gunner',{x:2,y:2}),status('gunner','freeze'));
  act(b,'attack',2,2);
  assert.ok(events(b).some(e=>e.type==='shatter'));
  assert.ok(u(a,'gunner').hp<27);
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

test('弩弹、1AP 装填、同一槽内复用；祭坛给予可见护盾疾走', () => {
  const a=boot(); turn(a,'ranger');
  commit(a,counter('ranger-weapon',0,'ammo'));
  assert.match(a.previewAction({type:'attack'}).error,/弹仓/);
  act(a,'reload'); assert.equal(u(a,'ranger').ap,1);
  assert.equal(a.getBattleState().items['ranger-weapon'].counters.ammo,6);
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
  assert.ok(u(a,'swordsman').statuses.shield.amount>0);
  assert.ok(u(a,'swordsman').hp>19);
  end(a); turn(a,'oracle');
  const p=probe(a,'skill',1,3,'hymn');
  assert.ok(p.targets.some(t=>t.id==='swordsman'&&t.healingShield[0]>0));
  assert.ok(p.targets.some(t=>t.id==='ranger'));
  act(a,'skill',1,3,'hymn');
  assert.ok(u(a,'ranger').statuses.regen);
});

test('重斩击退撞墙并晕眩；爆桶不是刀的直杀来源', () => {
  const a=boot('boss');
  commit(a,stats('colossus',{x:2,y:4}),cell(3,4,{z:2}));
  act(a,'skill',2,4,'surge');
  assert.ok(events(a).some(e=>e.type==='knockback'));
  assert.ok(events(a).some(e=>e.type==='damage'&&e.text.includes('撞击')));
  assert.ok(u(a,'colossus').statuses.stun);
  const b=boot();
  commit(b,stats('swordsman',{x:6,y:7}),stats('scout',{x:7,y:7}));
  act(b,'interact',7,6);
  assert.equal(u(b,'scout').hp,0);
  assert.equal(b.getBattleState().items['soulblade-lan'].counters.souls,0);
});

test('白名单拒绝畸形值；事务原子；幂等检查、真实 diff 和 revision 失效', () => {
  const a=boot(); const snap=a.exportBattleSnapshot();
  for (const command of [{}, {type:'nope'}, stats('swordsman',{}), stats('swordsman',{hp:100000}), stats('swordsman',{x:10}), stats('swordsman',{mp:NaN}), status('swordsman','not_real'), counter('soulblade-lan',11), cell(1,2,{kind:'wall'}), JSON.parse('{"type":"set_unit_stat","unitId":"swordsman","patch":{"__proto__":{}}}')]) {
    assert.equal(propose(a,command).ok,false,JSON.stringify(command));
  }
  assert.equal(propose(a,counter('soulblade-lan',3),{}).ok,false);
  const p=propose(a,counter('soulblade-lan',3));
  assert.deepEqual(a.exportBattleSnapshot(),snap);
  assert.deepEqual(p.diff,[{path:['items','soulblade-lan','counters','souls'],before:0,after:3}]);
  assert.equal(a.commitProposal(p.proposalId).ok,true);
  assert.equal(a.commitProposal(p.proposalId).ok,false);
  const stale=propose(a,counter('soulblade-lan',4));
  const rollback=propose(a,{type:'replay_or_undo',operation:'undo'});
  assert.equal(a.commitProposal(rollback.proposalId).ok,true);
  assert.equal(a.commitProposal(stale.proposalId).ok,false);
  assert.deepEqual(a.exportBattleSnapshot(),snap);
});

test('技能热改、增援/撤离与复原；篡改快照无法替换战局', () => {
  const a=boot();
  const copy=a.getBattleState().units.scout;
  Object.assign(copy,{id:'reserve',name:'援军',x:9,y:9,weapon:null,ap:0});
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

test('三个预设均可打到胜负；完整战报和 JSON 日志可重放', () => {
  for (const [scenarioId, expected] of [['ruins','blue'],['altar','blue'],['boss','red']]) {
    const a=boot(scenarioId);
    for(let i=0; i<200&&!a.getStateSummary().outcome; i++) {
      a.playAction(chooseAction(a.getBattleState()));
    }
    assert.equal(a.getStateSummary().outcome,expected,scenarioId);
    const snapshot=JSON.parse(JSON.stringify(a.exportBattleSnapshot()));
    const b=createGameAPI(); b.createBattle(snapshot);
    assert.deepEqual(b.exportBattleSnapshot(),snapshot);
    assert.deepEqual(b.exportBattleReport(),a.exportBattleReport());
  }
});
