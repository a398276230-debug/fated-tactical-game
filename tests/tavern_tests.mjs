import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateState } from '../src/api/validation.js';
import { getPool, refreshPoolMax, updatePoolCurrent } from '../src/core/vm-pools.js';
import { applyAction, preview, switchableWeapons } from '../src/core/combat.js';
import { changedEntryKeys, diagnosticText, normalizationCandidates, pendingDiagnostics, readUnresolvedDiagnostics, resolvedDiagnostics, remainingDiagnostics, warningEntryKey, warningKey } from '../src/tavern/resolved-warnings.js';
import { characterRecords } from '../src/tavern/char-snapshots.js';
import { normalizationTransactions, replayNormalization } from '../src/tavern/normalization-replay.js';
import { applyPatch } from '../src/tavern/overlay.js';
import { duplicateMappings, duplicateOperations, instanceGroups } from '../src/tavern/instance-groups.js';
import { fillInstance, ruleSummary } from '../src/tavern/instance-card.js';
import { resolveSlotContent } from '../src/tavern/prompts.js';
import { hydrateFromSources, parseBattleInit, mapEffects, warningsForUnit } from '../src/tavern/converter.js';
import { renderBattleInitEntry } from '../src/tavern/regex.js';

const mvu = {
  主角: {
    等级: 1,
    生命层级: '第一层级/普通',
    属性: { 力量: 6, 敏捷: 6, 体质: 6, 智力: 5, 精神: 5 },
    生命值: { 当前: 628, 上限: { _基础: 628, 额外: 0 } },
    法力值: { 当前: 500, 上限: { _基础: 500, 额外: 0 } },
    体力值: { 当前: 600, 上限: { _基础: 600, 额外: 0 } },
    装备: { 冰霜之弓: { 品质: '稀有', 类型: '武器', 标签: ['弓', '攻击: 185'], 位置: '' } },
  },
};

const damageOp = (damageType, amount) => ({ op: 'damage', target: 'target', damageType, amount });
const setResource = (state, unit, key, current) => updatePoolCurrent(state, getPool(state, unit.id, key).id, 'set', current);

function setMaxResource(state, unit, key, max, current = max) {
  const pool = getPool(state, unit.id, key);
  assert.equal(pool.contributors.length, 1);
  pool.contributors[0].maxBase = max;
  refreshPoolMax(state, pool.id);
  setResource(state, unit, key, current);
}

const guaranteeHit = {
  id: 'guarantee', hook: 'before_check', filter: "event.actorId == self.id && event.actionType == 'attack'",
  program: [{ op: 'mutate_event', patch: { forceOutcome: 'crit' } }],
};

test('char_info 数量与重复卡只产生一组标准化诊断，不合并战斗实例', () => {
  const grunt = { name:'卫兵', hp:100, 技能:[{名称:'突刺', 效果:'刺中后引发特殊效果'}], 装备:{弩:{类型:'武器',位置:'主手',标签:['弩','攻击: 10']}} };
  const player = { 主角:{name:'玩家', hp:500} };
  for (const charInfo of [[{...grunt, 数量:3}], [grunt, structuredClone(grunt), structuredClone(grunt)]]) {
    const { roster, state, warnings } = hydrateFromSources({mvu:player, charInfo}, {throwOnValidation:true});
    const [[hero], [first, ...copies]] = instanceGroups(Object.fromEntries(roster.map(unit => [unit.id, unit])));
    assert.ok(hero);
    assert.equal(copies.length, 2);
    assert.equal(new Set([first, ...copies].map(id => state.units[id].mainHand)).size, 3);
    assert.equal(warnings.filter(w => w.scope === 'effect').length, 1);
    const mappings = duplicateMappings(roster, state);
    const weapon = id => state.items[state.units[id].mainHand].templateId;
    const path = `/equipment/${weapon(first)}/rules`;
    const rule = { id:'probe', hook:'before_action', filter:`event.actorId == '${first}' && event.weaponTemplateId == '${weapon(first)}'`, program:[] };
    const ops = duplicateOperations({ op:'replace', path, value:[rule] }, mappings);
    assert.deepEqual(ops.map(op => [op.path, op.value[0].filter]), copies.map(id => [
      `/equipment/${weapon(id)}/rules`, `event.actorId == '${id}' && event.weaponTemplateId == '${weapon(id)}'`,
    ]));
  }
  const variant = {...grunt, hp:200};
  const { roster } = hydrateFromSources({mvu:player, charInfo:[grunt, variant]}, {throwOnValidation:true});
  assert.equal(new Set(roster.filter(unit => unit.source === 'char_info').map(unit => unit.archetypeId)).size, 2);
});

test('面积标签解析角度、环形和敌友，范围伤害允许友伤', () => {
  const damage = {count:1,sides:4,type:'physical',bonus:10};
  const {state}=hydrateFromSources({
    mvu:{主角:{...mvu.主角,技能:{
      扇击:{标签:['[范围: 中程(4)+扇(敌方)] [有效距离: 中程(4)] [角度:120°]'],rules:[{
        id:'fan-damage', hook:'active', program:[{op:'for_each', select:{from:'units',
          area:{shape:'fan',origin:'self',radius:4,angle:120}, where:'candidate.alive && candidate.id != self.id'},
          body:[damageOp('true',10)]}],
      }]},
      环击:{标签:['范围:近程(2)+环(所有)','有效距离:近程(2)'],damage},
      横扫:{标签:['范围:近程(2)+线(敌方)','有效距离:0'],damage},
      敌方圆击:{标签:['范围:近程(2)+圆(敌方)','有效距离:2','威力:50','伤害:物理'],rules:[
        {id:'no-attack-check',hook:'before_check',filter:"event.checkKind == 'attack' && event.skillId == skill.id",program:[{op:'mutate_event',patch:{forceOutcome:'miss'}}]},
        {id:'effect-save',hook:'after_hit',filter:'event.skillId == skill.id',program:[{op:'check',kind:'save',stat:'con',dc:12}]},
      ]},
      无差别:{shape:'circle',radius:2,range:2,damage},
      治疗:{标签:['单体','核心功能:治疗','有效距离:2'],heal:{count:1,sides:4}},
      环境:{标签:['范围:近程(2)+圆(环境)','有效距离:2'],damage},
    }}},
    charInfo:[{name:'木偶',hp:500},{name:'友军',hp:500}],
    battleInit:{terrain:'flat',units:[{id:'p',source:'mvu:主角',team:'blue',x:1,y:1},{id:'e',source:'char_info:木偶',team:'red',x:3,y:1},{id:'f',source:'char_info:友军',team:'blue',x:2,y:1}]},
  },{throwOnValidation:true});
  state.turn = state.order.indexOf('p');
  const actor = state.units.p;
  actor.ap = 2;
  actor.used = {attack:0,action:0};
  actor.facing = [1,0];
  const [fan, ring, line, enemyArea, defaultArea, heal, ground] = actor.skills;
  assert.deepEqual([state.skills[fan].shape,state.skills[fan].radius,state.skills[fan].angle], ['fan',4,120]);
  const aim = (skillId,x,y) => preview(state,{type:'skill',skillId,x,y});
  const fanPlan = aim(fan,3,1);
  assert.ok(fanPlan.ok && fanPlan.cells.length > 1);
  assert.ok(fanPlan.targets.some(target => target.id === 'e'));
  state.units.e.x = state.units.p.x;
  state.units.e.y = state.units.p.y;
  const closeFan = aim(fan,2,1);
  assert.ok(closeFan.ok, 'directed area skills remain aimable beside a same-cell enemy');
  assert.ok(closeFan.targets.some(target => target.id === 'e'), 'fan includes a hostile unit sharing the caster cell');
  state.units.e.x = 3;
  state.units.e.y = 1;
  const ringPlan = aim(ring,3,1);
  assert.ok(ringPlan.ok && ringPlan.cells.some(cell => cell.x === 2 && cell.y === 1));
  assert.ok(!ringPlan.cells.some(cell => cell.x === 3 && cell.y === 1));
  assert.ok(!ringPlan.targets.some(target => target.id === 'e'));
  assert.equal(state.skills[line].width, 0.5);
  assert.ok(aim(line,1,1).targets.some(target => target.id === 'e'));
  assert.deepEqual(aim(ring,2,1).targets.map(target => target.id), ['e','p']);
  for (const [skillId, targetIds] of [[enemyArea, ['e']], [defaultArea, ['e','f','p']]]) {
    const { targets } = aim(skillId,2,1);
    assert.deepEqual(targets.map(target => target.id), targetIds);
    assert.ok(targets.every(target => target.hitChance === 1 && target.expectedD20 === null));
    const native = structuredClone(state);
    applyAction(native,{type:'skill',skillId,x:2,y:1});
    const logs = native.logs.slice(state.logs.length);
    assert.ok(!logs.some(log => log.type === 'roll'));
    assert.deepEqual(logs.filter(log => log.type === 'hit_result').map(log => log.detail.targetId), targetIds);
    assert.deepEqual(logs.filter(log => log.type === 'damage').map(log => log.detail.targetId), targetIds);
    assert.deepEqual(logs.filter(log => log.type === 'save').map(log => log.detail.targetId), skillId === enemyArea ? ['e'] : []);
  }
  assert.ok(aim(heal,2,1).ok);
  assert.equal(aim(heal,3,1).ok, false);
  assert.deepEqual(aim(ground,3,1).targets, []);
  setMaxResource(state, state.units.f, 'hp', 100);
  setMaxResource(state, state.units.e, 'hp', 100);
  const { hp: allyHp } = state.units.f;
  const { hp: enemyHp } = state.units.e;
  validateState(state);
  applyAction(state,{type:'skill',skillId:fan,x:3,y:1});
  assert.equal(state.units.f.hp, allyHp - 10);
  assert.equal(state.units.e.hp, enemyHp - 10);
});

test('远程标签与弹药容器贯通 MVU 主角与 char_info', () => {
  const input = {
    mvu: { 主角: { ...mvu.主角, 装备: mvu.主角.装备, 背包:{箭筒:{类型:'弹药容器',标签:['弹药:20'],位置:'饰品'}} } },
    charInfo: `<char_info>
姓名: 发条木偶
生命层级: 第一层级
等级: 1
体长: 1.75
属性:
  力量: 1 + 0 + 0 = 1
  敏捷: 1 + 0 + 0 = 1
  体质: 6 + 0 + 0 = 6
  智力: 1 + 0 + 0 = 1
  精神: 1 + 0 + 0 = 1
资源:
  HP: 610
  MP: 100
  SP: 100
技能: []
装备:
  - 名称: 木弩臂
    类型: 武器
    标签:
      - 弩
      - "弹药: 5"
      - 主手
      - "攻击: 10"
      - "有效距离: 中程(5)"
    位置: 主手
  - 名称: 木矢筒
    类型: 弹药容器
    标签:
      - "弹药: 20"
    位置: 饰品
道具: []
</char_info>`,
    battleInit:'<battle_init>\nbattle|1|ammo-test|弹药测试|flat|123\nunit|p|blue|mvu:主角|主角|1,1\nunit|e|red|char_info|发条木偶|4,1\n</battle_init>'
  };
  const {state}=hydrateFromSources(input,{throwOnValidation:true});
  for (const [id, range, hp, stats] of [['p',4,628,[6,6,6,5,5]],['e',5,610,[1,1,6,1,1]]]) {
    const unit = state.units[id], item = state.items[unit.mainHand], template = state.equipment[item.templateId];
    assert.equal(template.weaponClass, 'ranged');
    assert.equal(template.weaponType, id === 'p' ? '弓' : '弩');
    const ammoRules = template.rules.filter(rule => rule.hook === 'before_action' &&
      rule.program.some(op => op.op === 'resource' && op.pool === 'ammo' && op.mode === 'sub' && op.local));
    assert.equal(ammoRules.length, 1);
    assert.equal(template.range, range);
    assert.deepEqual([unit.hp, unit.maxHp, unit.mp, unit.sp, unit.tier], [hp, hp, ...(id === 'p' ? [500,600,1] : [100,100,1])]);
    assert.equal(template.name, id === 'p' ? '冰霜之弓' : '木弩臂');
    assert.deepEqual(unit.skills, []);
    assert.deepEqual(Object.values(unit.stats), stats);
    assert.equal(getPool(state, item.id, 'ammo', 'item').current, id === 'p' ? 20 : 25);
  }
  assert.notEqual(state.units.p.mainHand,state.units.e.mainHand);
  state.turn = state.order.indexOf('p');
  const actor = state.units.p, item = state.items[actor.mainHand];
  actor.ap = 2;
  actor.used = {attack:0, action:0};
  const attack = {type:'attack', x:4, y:1};
  const shot = preview(state, attack);
  assert.ok(shot.ok, shot.error);
  assert.equal(shot.ammo, 20);
  applyAction(state, attack);
  const ammo = getPool(state, item.id, 'ammo', 'item');
  assert.equal(getPool(state, item.id, 'ammo', 'item').current, 19);
  updatePoolCurrent(state, ammo.id, 'set', 1);
  actor.ap = 2;
  actor.used = {attack:0, action:0};
  applyAction(state, attack);
  assert.equal(getPool(state, item.id, 'ammo', 'item').current, 0);
  actor.ap = 2;
  actor.used = {attack:0, action:0};
  assert.equal(preview(state, attack).error, '弹药已耗尽');
  assert.equal(preview(state, {type:'reload'}).ok, false);
  assert.deepEqual(input.mvu.主角.背包.箭筒.标签,['弹药:20']);
});

test('箭袋命中附伤只强化指定子类，不等同远程或有弹药', () => {
  for (const subtype of ['弓','弩','火枪','投掷武器']) {
    const {state} = hydrateFromSources({mvu:{主角:{...mvu.主角,装备:{
      冰霜之弓:{类型:'武器',标签:[subtype,'双手','攻击: 185','有效距离: 中程(5)'],accuracy:30},
      箭筒:{类型:'弹药容器',位置:'饰品',标签:['弹药: 20']}
    }}},charInfo:{name:'木偶',hp:10000},battleInit:'battle|1|q|箭袋|flat|123\nunit|p|blue|mvu:主角|主角|1,1\nunit|e|red|char_info|木偶|4,1'}, {throwOnValidation:true});
    state.turn = state.order.indexOf('p');
    Object.assign(state.units.p,{ap:2,used:{attack:0,action:0}});
    state.rng = 123456789;
    const bow = Object.entries(state.equipment).find(([, item]) => item.weaponType === '弓')?.[0] ?? 'other-bow';
    const quiver = Object.values(state.equipment).find(item => item.name === '箭筒');
    quiver.rules.push({ id:'quiver-bonus', hook:'after_hit',
      filter:`event.actorId == self.id && event.actionType == 'attack' && event.weaponTemplateId == '${bow}'`,
      program:[damageOp('true',8)] });
    const plain = structuredClone(state);
    Object.values(plain.equipment).find(t => t.name === '箭筒').rules = [];
    validateState(state);
    for (const s of [state, plain]) applyAction(s,{type:'attack',x:4,y:1});
    assert.ok(plain.units.e.hp < 10000, JSON.stringify(plain.logs.slice(-4)));
    assert.equal(plain.units.e.hp-state.units.e.hp, subtype === '弓' ? 8 : 0, subtype);
  }
});

test('主角背包消耗品扣库存、未知用途进入标准化，装备优先双手', () => {
  const bag = {手榴弹:{类型:'消耗品',数量:3,标签:['攻击：100'],效果:{物理伤害:'造成100伤害'}},小红瓶:{类型:'消耗品',数量:1},藏刀:{类型:'武器',标签:['主手']}};
  const input={mvu:{主角:{...mvu.主角,装备:{刀:{类型:'武器',标签:['主手']},匕首:{类型:'武器',标签:['副手']},战杖:{类型:'武器',标签:['双手']}},背包:bag}},charInfo:{name:'木偶',hp:500,背包:bag},battleInit:{units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'e',source:'char_info',name:'木偶',team:'red',x:2,y:1}]}};
  const {state,warnings}=hydrateFromSources(input,{throwOnValidation:true});
  const {p,e}=state.units;assert.equal(state.equipment[state.items[p.mainHand].templateId].name,'战杖');assert.equal(p.offHand,null);
  assert.equal(e.inventory,undefined);assert.equal(e.bagWeapons,undefined);
  const [bagKnife]=p.bagWeapons;assert.equal(state.equipment[state.items[bagKnife].templateId].name,'藏刀');
  const swapped=structuredClone(state), wielder=swapped.units.p;
  swapped.turn=swapped.order.indexOf('p');wielder.ap=2;wielder.used={attack:0,action:0};
  const draw={type:'switch_weapon',itemId:bagKnife};assert.equal(preview(swapped,draw).ap,1);
  applyAction(swapped,draw);assert.equal(wielder.mainHand,bagKnife);assert.deepEqual(wielder.bagWeapons,[p.mainHand]);
  assert.deepEqual(wielder.used,{attack:0,action:1});assert.equal(preview(swapped,{...draw,itemId:p.mainHand}).ok,false);validateState(swapped);
  const [bomb,potion]=Object.keys(p.inventory);assert.equal(p.inventory[bomb],3);assert.deepEqual(p.skills,[]);
  assert.ok(warnings.some(w=>w.unitId==='p' && w.originPath===`/skills/${potion}` && w.message.includes('小红瓶')));
  assert.match(resolveSlotContent({id:'roster'},{state,onlyUnitIds:['p']}),/小红瓶/);
  assert.deepEqual(state.skills[bomb].rules.map(rule=>rule.program),[[damageOp('physical',100)]]);
  state.turn=state.order.indexOf('p');p.ap=2;p.used={attack:0,action:0};
  const use={type:'skill',skillId:bomb,x:e.x,y:e.y};assert.equal(preview(state,{...use,skillId:potion}).ok,false);
  assert.equal(preview(state,{...use,x:p.x,y:p.y}).ok,false);assert.equal(p.inventory[bomb],3);
  const before = e.hp;
  const logs = applyAction(state,use);
  assert.equal(e.hp,before-100);assert.equal(bag.手榴弹.数量,3);
  assert.deepEqual(p.used,{attack:0,action:1});validateState(state);
  assert.equal(p.inventory[bomb],2,'VM cast must consume one backpack item');
  assert.ok(logs.some(log=>log.text.includes('手榴弹（数量 3 → 2）')));
});

test('只有副手标记的小刀能追击；切刀主攻后主手弓不追击也不扣 SP', () => {
  const followups = [];
  for (const [dist, swap] of [[1,false],[4,false],[1,true]]) {
    const {state}=hydrateFromSources({mvu:{主角:{...mvu.主角,装备:{弓:{类型:'武器',标签:['弓'],位置:'主手',rules:[guaranteeHit]},小刀:{类型:'武器',位置:'副手',rules:[guaranteeHit]}}}},charInfo:{name:'木偶',hp:99999},battleInit:{terrainMode:'flat',units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'e',source:'char_info',name:'木偶',team:'red',x:1+dist,y:1}]}},{throwOnValidation:true});
    const {p,e}=state.units;state.turn=state.order.indexOf('p');p.used={attack:0,action:0};p.ap=2;const sp=p.sp, hp=e.hp;
    validateState(state);
    assert.equal(state.equipment[state.items[p.offHand].templateId].name,'小刀');
    assert.equal(p.stance,'dual_wield');
    const { mainHand, offHand } = p;
    if (swap) {
      applyAction(state, { type:'switch_weapon', itemId:offHand });
      assert.deepEqual([p.mainHand, p.offHand, p.stance], [offHand, mainHand, 'dual_wield']);
      assert.equal(preview(state, { type:'attack', x:e.x, y:e.y }).targets[0].weaponId, offHand);
    }
    const logs=applyAction(state,{type:'attack',x:e.x,y:e.y});
    assert.ok(e.hp<hp);
    followups.push([dist,logs.find(l=>l.type==='followup')?.detail.weaponId,sp-p.sp]);
    assert.equal(followups.at(-1)[1], dist === 4 || swap ? undefined : offHand);
  }
  assert.deepEqual(followups.map(([dist, id, sp]) => [dist, Boolean(id), sp]), [[1,true,10],[4,false,0],[1,false,0]]);
});

test('MVU 和 char_info 可用装备标签声明初始主副手；剧情位置优先', () => {
  const equipment = (main, off, position) => ({
    黑灵: { 类型:'武器', 标签:off }, 风律弓: { 类型:'武器', 标签:main, 位置:position },
  });
  const input = { mvu:{主角:{...mvu.主角, 装备:equipment(['弓','位置：主手'], ['副手'], '')}},
    charInfo:{name:'怪物', 装备:equipment('[弓][主手]', '[匕首][位置: 副手]')},
    battleInit:{units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'e',source:'char_info',name:'怪物',team:'red',x:4,y:4}]}};
  function hands() {
    const { state } = hydrateFromSources(input, {throwOnValidation:true});
    const name = id => state.equipment[state.items[id]?.templateId]?.name;
    return Object.values(state.units).map(u => [name(u.mainHand), name(u.offHand), u.stance]);
  }
  assert.deepEqual(hands(), Array(2).fill(['风律弓','黑灵','dual_wield']));
  input.mvu.主角.装备.风律弓.位置 = '副手'; input.mvu.主角.装备.黑灵.位置 = '主手';
  assert.deepEqual(hands()[0], ['黑灵','风律弓','dual_wield']);
});

test('装备标签 [双手] 和 [盾牌] 决定持用槽位，不依赖装备名称', () => {
  const {state} = hydrateFromSources({mvu:{主角:{...mvu.主角,装备:{短刀:{类型:'武器'},长柄兵器:{类型:'武器',标签:'[双手]'}}}},
    charInfo:{name:'卫兵',装备:{短刀:{类型:'武器'},铁壁:{类型:'防具',标签:['[盾牌]']}}},
    battleInit:{units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'e',source:'char_info',name:'卫兵',team:'red',x:4,y:4}]}}, {throwOnValidation:true});
  const template = id => state.equipment[state.items[id].templateId];
  assert.equal(template(state.units.p.mainHand).name,'长柄兵器');
  assert.equal(template(state.units.p.mainHand).twoHanded,true);
  assert.equal(template(state.units.e.shield).name,'铁壁');
  assert.equal(state.units.e.stance,'sword_shield');
});

test('MVU 空位置的风律弓与黑灵可换主手，不自动双持', () => {
  const equipment = {
    风律弓:{类型:'武器',标签:['弓','攻击力：100','自进化'],效果:{精准:'远程攻击必命中或命中结果升一阶'},位置:''},
    猎人帽:{类型:'防具',标签:['头饰','防具：135'],位置:''},
    风行者套装:{类型:'防具',标签:['轻甲','防御：140'],位置:''},
    疾风之靴:{类型:'防具',标签:['靴子','防御(脚部): 160'],位置:''},
    黑灵:{类型:'武器',标签:['匕首','攻击：150','灵魂计数：0'],效果:{灵魂增幅:'每有1个灵魂，攻击力提高50%'},位置:''},
  };
  const {state, roster} = hydrateFromSources({mvu:{主角:{...mvu.主角,装备:equipment,技能:{}}},battleInit:{battleId:'switch', participants:[
    {name:'测试',faction:'blue',source:'mvu_protagonist',xyz:[2,2,0]}, {name:'木头人',faction:'red',source:'narrative_char_info',xyz:[7,7,0]}]}});
  const actor = Object.values(state.units).find(u=>u.team==='blue');
  const template = id=>state.equipment[state.items[id].templateId];
  assert.equal(Object.keys(state.units).length,2);
  assert.deepEqual(actor.stats,{str:6,agi:6,con:6,int:5,spi:5});
  assert.deepEqual([actor.hp,actor.maxHp,actor.mp,actor.sp,actor.tier,roster.find(r=>r.id===actor.id).level],[628,628,500,600,1,1]);
  assert.deepEqual(actor.skills,[]);
  const bow=actor.mainHand, knife=actor.gear.find(id=>template(id).name==='黑灵');
  assert.equal(template(bow).name,'风律弓');assert.equal(template(bow).attack,100);assert.equal(template(knife).attack,150);
  assert.deepEqual(actor.gear.map(id=>template(id).name),['猎人帽','风行者套装','疾风之靴','黑灵']);
  assert.equal(actor.offHand,null); assert.deepEqual(switchableWeapons(state,actor),[knife]);
  state.turn=state.order.indexOf(actor.id);actor.ap=2;actor.used={action:0,attack:0};
  const swap={type:'switch_weapon',itemId:knife};assert.ok(preview(state,swap).ok);
  applyAction(state,swap);assert.equal(actor.mainHand,knife);assert.equal(actor.weapon,knife);assert.equal(actor.offHand,null);
  assert.deepEqual(actor.used,{attack:0,action:0});assert.equal(actor.ap,2);assert.deepEqual(switchableWeapons(state,actor),[bow]);
  actor.used.action=1;actor.ap=1;assert.equal(preview(state,{...swap,itemId:bow}).ok,true);validateState(state);
});

test('酒馆 battle_init participant source 映射中文 MVU 主角并保留装备', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    battleId: 'test',
    participants: [
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
      { name: '木头人', faction: 'red', source: 'narrative_char_info', xyz: [7, 7, 2] },
    ],
  } });
  const protagonist = Object.values(result.state.units).find(unit => unit.team === 'blue');
  assert.deepEqual(protagonist.stats, { str: 6, agi: 6, con: 6, int: 5, spi: 5 });
  assert.deepEqual([protagonist.hp, protagonist.maxHp, protagonist.mp, protagonist.maxMp, protagonist.sp, protagonist.maxSp], [628, 628, 500, 500, 600, 600]);
  assert.ok(protagonist.mainHand);
  const protagonistProfile = result.roster.find(item => item.team === 'blue');
  assert.equal(protagonistProfile.sourcePath.join('.'), '主角');
  assert.equal(protagonistProfile.sourceKind, 'MVU');
  assert.deepEqual(protagonistProfile.fieldSources, { numeric: 'MVU', equipment: 'MVU', placement: 'battle_init', faction: 'battle_init', name: 'battle_init' });
  assert.deepEqual([protagonist.x, protagonist.y], [2, 2]);
});

test('酒馆重复 participant source 只生成一个单位', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    participants: [
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
      { name: '瑞吉', faction: 'blue', source: 'mvu_protagonist', xyz: [2, 2, 0] },
    ],
  } });
  assert.equal(Object.values(result.state.units).length, 1);
});

test('battle_init units 提供站位与战术快照，MVU 仍覆盖主角数值', () => {
  const result = hydrateFromSources({ mvu, battleInit: {
    units: [
      { id: 'unit_1', name: '瑞吉', team: 'blue', x: 2, y: 2, mainHand: 'bow_snapshot' },
      { id: 'unit_2', name: '木头人', team: 'red', x: 7, y: 7 },
    ],
    equipment: { bow_snapshot: { name: '快照弓', kind: 'weapon', weaponClass: 'ranged', rangeType: 'ranged', range: 6, attack: 10 } },
  } });
  const protagonist = Object.values(result.state.units).find(unit => unit.team === 'blue');
  assert.deepEqual([protagonist.x, protagonist.y], [2, 2]);
  assert.deepEqual(protagonist.stats, { str: 6, agi: 6, con: 6, int: 5, spi: 5 });
  assert.equal(protagonist.maxHp, 628);
  assert.ok(protagonist.mainHand);
});

test('battle 描述符解析精确 MVU 路径、terrain 与 seed', () => {
  const descriptor = `<battle_init>\nbattle|1|chapter-7|雾晶港演武场|terrain|123\nunit|p1|blue|mvu:主角|瑞吉|2,2\nunit|a1|blue|mvu:关系列表/队友A|队友A|3,2\nunit|e1|red|char_info|木头人|7,7\n</battle_init>`;
  const parsed = parseBattleInit(descriptor);
  assert.equal(parsed.terrainMode, 'terrain');
  assert.deepEqual(parsed.units[1], { id: 'a1', team: 'blue', source: 'mvu:关系列表/队友A', name: '队友A', x: 3, y: 2 });
  const result = hydrateFromSources({ mvu: { 主角: mvu.主角, 关系列表: { 队友A: { ...mvu.主角, 属性: { 力量: 3, 敏捷: 5, 体质: 3, 智力: 2, 精神: 2 } } } }, battleInit: descriptor, charInfo: { name: '木头人', 属性: mvu.主角.属性 } }, { seed: 456, throwOnValidation: true });
  assert.equal(result.seed, 456);
  assert.equal(result.state.scenarioId, 'chapter-7');
  assert.equal(result.state.units.p1.stats.str, 6);
  assert.equal(result.state.units.a1.stats.agi, 5);
  assert.equal(result.state.units.e1.team, 'red');
  assert.equal(result.state.logs.filter(log => log.type === 'initiative').length, 1);
  assert.equal(result.state.units[result.state.order[result.state.turn]].ap, 2);
  assert.notEqual(result.state.rng, result.seed);
  assert.ok(result.state.grid.flat().some(cell => cell.kind === 'slope'));
  assert.ok(result.state.grid.flat().some(cell => cell.z === 2));
  const restarted = hydrateFromSources({ battleInit: descriptor }, { seed: result.seed });
  assert.deepEqual(restarted.state.grid, result.state.grid);
  assert.ok(hydrateFromSources({ battleInit: descriptor.replace('|terrain|', '|flat|') }).state.grid.flat().every(cell => cell.kind === 'floor' && cell.z === 0));
});

test('explicit sources keep narrative names separate and never fall back to another MVU path', () => {
  const battleInit = `battle|1|exact|演武场|flat
unit|p1|blue|mvu:主角|同名|1,1
unit|a1|blue|mvu:不存在/队友A|队友A|2,2
unit|e1|red|char_info|同名|7,7
unit|e2|red|char_info|木偶|8,7`;
  const result = hydrateFromSources({ battleInit, protagonistName: '化名', mvu: {
    主角: mvu.主角,
    关系列表: { 队友A: { stats: { str: 9 } } },
  }, charInfo: [{ name: '同名', stats: { str: 4 } }, { name: '木偶', stats: { str: 5 } }] }, { throwOnValidation: true });
  assert.equal(result.state.units.p1.name, '同名');
  assert.equal(result.state.units.p1.stats.str, 6);
  assert.equal(result.state.units.a1.stats.str, 0);
  assert.equal(result.state.units.e1.stats.str, 4);
  assert.equal(result.state.units.e2.stats.str, 5);
  assert.ok(result.warnings.some(w => w.message.includes('mvu:不存在/队友A')));
});

test('battle_init 允许单位共用起点，拒绝超员与模糊 MVU 来源', () => {
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|mvu|敌人|1,1'), /battle_init 描述符/);
  const header = 'battle|1|x|场景|flat';
  const units = Array.from({ length: 5 }, (_, index) => `unit|u${index}|blue|char_info|角色${index}|1,1`);
  assert.equal(parseBattleInit([header, ...units.slice(0, 4)].join('\n')).units.length, 4);
  assert.throws(() => parseBattleInit([header, ...units].join('\n')), /同格单位超过容量/);
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat|4294967296'), /seed/);
});

test('legacy TT JSON imports grid rectangles, slopes and walls and falls back to MVU once', () => {
  const battle = {
    title: '雾晶港', mode: 'split', seed: 99,
    grid: { walls: [[6, 5], [-1, 5]], slopes: [[6, 7, 1]], elevation: [{ x1: 7, x2: 8, y1: 7, y2: 8, z: 2 }] },
    units: [
      { id: 'unit_1', name: '瑞吉', team: 'blue', x: 2, y: 2, stats: { str: 1 } },
      { id: 'unit_2', name: '同伴', team: 'blue', x: 3, y: 2, stats: { str: 2 } },
      { id: 'unit_3', name: '木头人', team: 'red', x: 7, y: 7, stats: { str: 3 } },
    ],
  };
  const battleInit = `<battle_init>\n\`\`\`json\n${JSON.stringify(battle)}\n\`\`\`\n</battle_init>`;
  assert.deepEqual(parseBattleInit(battleInit), battle);
  const input = { mvu, battleInit, protagonistName: '酒馆化名' };
  const { state, seed, warnings } = hydrateFromSources(input, { throwOnValidation: true });
  assert.equal(seed, 99);
  assert.deepEqual(hydrateFromSources(input, { seed }).state, state);
  assert.equal(state.mode, 'split');
  assert.equal(state.units.unit_1.name, '酒馆化名');
  assert.equal(state.units.unit_1.stats.str, 6);
  assert.equal(state.units.unit_2.name, '同伴');
  assert.equal(state.units.unit_2.stats.str, 2);
  assert.deepEqual(state.grid[5][6], { kind: 'wall', z: 0 });
  assert.deepEqual(state.grid[7][6], { kind: 'slope', z: 1 });
  assert.deepEqual(state.grid[8][8], { kind: 'floor', z: 2 });
  assert.ok(warnings.some(w => w.message.includes('grid.walls')));
});

test('Chinese slots, status durations and unsupported effect warnings', () => {
  const battleInit = 'battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|char_info|敌人|7,7';
  const result = hydrateFromSources({ battleInit, charInfo: { name: '敌人' }, mvu: { 主角: {
    ...mvu.主角,
    状态效果: { root: { 层数: 1, 剩余时间: '3回合' }, 中毒: { 描述: '每回合受到能量伤害' }, 场地弹药补给: {} },
    装备: {
      匕首: { 类型: '武器', 位置: '主手' },
      木盾: { 类型: '防具', 位置: '副手' },
      皮甲: { 类型: '防具', 位置: '躯干', 标签: ['防御：6'], 效果: { 轻便: '描述文字' } },
    },
    技能: { 冰箭: { 效果: [{ kind: 'status', statusId: 'freeze' }, { kind: 'status', status: '冰冻' }, { kind: 'status', status: '不存在' }] } },
  } } }, { throwOnValidation: true });
  const { state, warnings } = result;
  const p = state.units.p1;
  assert.equal(p.offHand, null);
  assert.equal(state.equipment[state.items[p.mainHand].templateId].name, '匕首');
  assert.equal(state.equipment[state.items[p.shield].templateId].name, '木盾');
  assert.equal(state.equipment[state.items[p.gear[0]].templateId].defense, 6);
  assert.equal(state.equipment[state.items[p.gear[0]].templateId].armor, undefined);
  assert.deepEqual(state.skills[p.skills[0]].rules, []);
  const skillWarnings = warnings.filter(w => w.originPath === `/skills/${p.skills[0]}`);
  assert.ok(skillWarnings.some(w => /statusId.*freeze/.test(w.message)));
  assert.equal(p.statuses.poison, undefined);
  for (const label of ['场地弹药补给', '轻便', '不存在', '冰冻', '中毒：每回合受到能量伤害']) assert.ok(warnings.some(w => w.message.includes(label)));
  assert.equal(p.statuses.root.remainingTurns, 3, 'opening status must retain its authored duration');
});

const shooterYaml = `技能:
  - 名称: 制式轻矢点射
    品质: 普通
    类型: 主动
    消耗: 攻击: 20 SP
    标签: [敏捷][单体][有效距离: 中程(5)][伤害][威力: 50][伤害: 物理]
    效果: |
    描述: 艾瑟嘉德演武场最基础的机械靶偶动作模块，只会在固定间隔内朝前方校准发射木矢。`;
const hydrateDummy = charInfo => hydrateFromSources({ battle: { participants: [
  { id: 'e1', source: 'char_info', name: '靶偶', team: 'red' }, { id: 'p1', name: '玩家', team: 'blue', x: 2 },
] }, charInfo: typeof charInfo === 'string' ? `名称: 靶偶\n${charInfo}` : { 名称: '靶偶', ...charInfo } }, { throwOnValidation: true });

test('体长：显式单位、别名与外貌兜底均换算为米，再派生 size/MC', () => {
  for (const [fields, expected] of [
    [{体长:'1.75米'},[1.75,3,1]], [{体长:'约165厘米'},[1.65,3,1]], [{体长:'180cm'},[1.8,3,1]],
    [{身高:'大约 0.5 m（不计翼展）'},[.5,1,1]], [{BL:'～12m'},[12,5,2]],
    [{外貌特质:'高度约3.2米'},[3.2,4,1]], [{外貌:'身高168cm'},[1.68,3,1]],
    [{体长:'未知',描述:'四足，体长约 4.2 米。'},[4.2,4,1]], [{bl:1,外貌:'长约 6 米'},[1,2,1]],
  ]) {
    const {state,warnings}=hydrateDummy(fields), u=state.units.e1;
    assert.deepEqual([u.bodyLengthM,u.size,u.mc],expected); assert.deepEqual(warnings,[]);
  }
});
test('MVU 战术扩展体长优先，伙伴按关系键匹配，快照跟踪形态变化', async () => {
  const stat_data = {
    主角: { ...mvu.主角, bodyLengthM: 4.2 },
    关系列表: { 艾莉亚: { ...mvu.主角, 体长: '180cm' } },
    事件: { 战术扩展: { 体长: { 主角: 1.7, 伙伴: { 艾莉亚: 1.7 } } } },
  };
  const battleInit = `<battle_init>
battle|1|size-test|演武场|flat
unit|p1|blue|mvu:主角|瑞吉|2,2
unit|a1|blue|mvu:关系列表/艾莉亚|艾莉亚·化身|3,2
unit|e1|red|char_info|木偶|7,7
</battle_init>`;
  const charInfo = [{ name: '木偶', 体长: '2米', 属性: mvu.主角.属性 }];
  const read = () => hydrateFromSources({ mvu: { stat_data }, battleInit, charInfo }, { throwOnValidation: true });
  const snapshot = result => characterRecords({ mvuData: stat_data, battleInit: result.battleInit, charInfo }, result);
  const first = read();
  assert.deepEqual(['p1', 'a1', 'e1'].map(id => first.state.units[id].bodyLengthM), [1.7, 1.7, 2]);
  assert.equal(stat_data.主角.bodyLengthM, 4.2);
  assert.equal(stat_data.关系列表.艾莉亚.体长, '180cm');
  const firstSnapshot = await snapshot(first);
  stat_data.事件.战术扩展.体长.伙伴.艾莉亚 = 3.2;
  const changed = read();
  assert.equal(changed.state.units.a1.bodyLengthM, 3.2);
  assert.equal(changed.state.units.a1.size, 4);
  const changedSnapshot = await snapshot(changed);
  assert.notEqual(changedSnapshot.a1.hash, firstSnapshot.a1.hash);
  assert.equal(changedSnapshot.p1.hash, firstSnapshot.p1.hash);
  stat_data.事件.战术扩展.体长.伙伴.艾莉亚 = -1;
  assert.equal(read().state.units.a1.bodyLengthM, 1.8);
});

test('体长：非法值单独归属该单位；没有填写则静默默认，不把武器长度当身高', () => {
  for (const bad of ['未知','0米','-2m',null]) {
    const {state,warnings}=hydrateDummy({体长:bad}); assert.equal(state.units.e1.bodyLengthM,1.7);
    assert.equal(warnings.length,1); assert.equal(warnings[0].unitId,'e1'); assert.equal(warnings[0].source,'char_info'); assert.match(warnings[0].message,/体长.*1\.7/);
  }
  const {state,warnings}=hydrateDummy({描述:'携带一把2米重剑'}); assert.equal(state.units.e1.bodyLengthM,1.7);assert.deepEqual(warnings,[]);
});

test('G98/G99 empty YAML scalars and objects emit neither effects nor warnings', () => {
  for (const context of ['skill','equipment']) for (const value of ['|','>','|-','|+','>-','>+','|2','>2','  |  ','','{}',{},null,undefined]) {
    const warnings = [];
    assert.deepEqual(mapEffects([value], context, warnings), []);
    assert.deepEqual(warnings, [], `${context}: ${JSON.stringify(value)}`);
  }
});
test('G100 populated YAML blocks keep VM rules and diagnose unstandardized text', () => {
  const rule = { id:'straight-shot', hook:'active', program:[{op:'move',target:'target',mode:'push',distance:1}] };
  const vmLine = `平直射击: ${JSON.stringify(rule)}`;
  const warnings = [];
  assert.deepEqual(mapEffects(`| \n ${vmLine}`, 'skill', warnings), [rule]);
  for (const header of ['|','>-','|2']) {
    const {state, warnings: actual} = hydrateDummy(shooterYaml.replace('效果: |', `效果: ${header}\n      ${vmLine}`));
    assert.deepEqual(state.skills[state.units.e1.skills[0]].rules, [rule]);
    assert.deepEqual(actual, []);
  }
  assert.deepEqual(warnings, []);
  for (const narrative of ['knockback', '尚未定义的动作']) {
    const {state, warnings: actual} = hydrateDummy(shooterYaml.replace('效果: |', `效果: |\n      平直射击: ${narrative}`));
    const id = state.units.e1.skills[0];
    assert.deepEqual(state.skills[id].rules, []);
    assert.ok(actual.some(w => w.originPath === `/skills/${id}` && w.message.includes(narrative)));
  }
});
test('G101 status placeholders are silent without hiding invalid modifier overrides', () => {
  const {state,warnings} = hydrateDummy({ 状态: ['|', '>-', {}, null, {id:'stun',modifiers:'|'}] });
  assert.deepEqual(warnings, []);
  assert.ok(state.units.e1.statuses.stun.mods.some(mod => mod.locks?.includes('action')));
  const bad = hydrateDummy({ 状态: [{id:'stun',modifiers:{badKey:2}}] });
  assert.ok(bad.state.units.e1.statuses.stun.mods.some(mod => mod.locks?.includes('action')));
  assert.ok(bad.warnings.some(w => w.message.includes('状态 stun 的 modifiers 待标准化') && w.message.includes('badKey')));
});
test('G102/G103 original YAML and rejected effects retain the referenced skill template', () => {
  const {state,warnings} = hydrateDummy(shooterYaml.replace('[伤害: 物理]',''));
  const [id] = state.units.e1.skills;
  assert.equal(hydrateDummy(shooterYaml).state.units.e1.skills[0], id);
  assert.deepEqual(warnings, []);
  const skill = state.skills[id];
  assert.deepEqual([skill.name,skill.rules,skill.power,skill.range,skill.target], ['制式轻矢点射',[],50,5,'enemy']);
  const rejected = hydrateDummy(shooterYaml.replace('效果: |','效果: 不认识的动作'));
  assert.deepEqual(rejected.state.skills[id], { ...skill, damage: { count: 1, sides: 4, stat: 'agi', type: 'physical' }, damageType:'physical' });
  assert.ok(rejected.warnings.some(w => w.originPath === `/skills/${id}` && w.message.includes('不认识的动作')));
});

test('G124–G126/G129/G130 原文标签生成独立伤害节点，实际施放扣 SP', () => {
  for (const [label,type] of Object.entries({物理:'physical',能量:'energy',精神:'mental',真实:'true'})) {
    const {state,roster,warnings}=hydrateDummy(shooterYaml.replace('[伤害: 物理]',`[伤害: ${label}]`));
    const actor=state.units.e1, target=state.units.p1, id=actor.skills[0], s=state.skills[id];
    assert.deepEqual(warnings,[]);assert.equal(roster.find(u=>u.id==='e1').skillInfo[id].damageType,type);
    assert.deepEqual(s.rules.map(rule=>[rule.hook,rule.program]),[['active',[damageOp(type,'event.power')]]]);
    assert.equal(s.sp,20);assert.equal(s.slot,'attack');
    state.turn=state.order.indexOf(actor.id);actor.ap=2;actor.used={attack:0,action:0};actor.x=1;actor.y=1;target.x=2;target.y=1;
    setMaxResource(state,actor,'sp',40);
    const before=target.hp;
    const logs=applyAction(state,{type:'skill',skillId:id,x:2,y:1});
    assert.equal(actor.sp,20);assert.ok(target.hp<before);
    assert.equal(logs.find(log=>log.type==='damage').detail.damageType,type);
  }
});
test('只有威力标签也生成无 type 的协议主击，并保留效果类型兜底', () => {
  const result = hydrateDummy(shooterYaml.replace('[伤害: 物理]', ''));
  const id = result.state.units.e1.skills[0];
  assert.deepEqual(result.state.skills[id].damage, { count: 1, sides: 4, stat: 'agi' });
  assert.equal(result.state.skills[id].damageType, undefined);
  assert.deepEqual(result.warnings, []);
  const natural = hydrateDummy(shooterYaml.replace('[伤害: 物理]', '').replace('效果: |', '效果：挥出能量斩并造成额外效果'));
  const naturalId = natural.state.units.e1.skills[0];
  assert.deepEqual(natural.state.skills[naturalId].damage, { count: 1, sides: 4, stat: 'agi' });
  const path = `/skills/${naturalId}`;
  const diagnostic = natural.warnings.find(w => w.originPath === path && w.message.includes('主击伤害类型待标准化'));
  assert.ok(diagnostic);
  assert.ok(diagnostic.message.includes(`${path}/damage/type`));
  const operation = { op: 'add', path: `${path}/damage/type`, value: 'energy', resolves: [referenceFor(diagnostic)] };
  const patched = applyPatch(natural.state, [operation], true);
  validateState(patched);
  assert.deepEqual(resolvedDiagnostics(natural.warnings, { e1: {} }, [operation]), [diagnostic]);
  const actor = patched.units.e1, target = patched.units.p1;
  patched.turn = patched.order.indexOf(actor.id);
  Object.assign(actor, { ap: 2, used: { attack: 0, action: 0 }, x: 1, y: 1 });
  Object.assign(target, { x: 2, y: 1 });
  setMaxResource(patched, actor, 'sp', 40);
  const cast = { type: 'skill', skillId: naturalId, x: target.x, y: target.y, targetId: target.id };
  assert.equal(preview(patched, cast).targets[0].damageType, 'energy');
  assert.deepEqual(patched.skills[naturalId].rules, []);
  const typedEffect = hydrateDummy(shooterYaml.replace('[伤害: 物理]', '').replace('效果: |', '效果：100%能量伤害'));
  const typedId = typedEffect.state.units.e1.skills[0];
  assert.equal(typedEffect.state.skills[typedId].damage, undefined);
  assert.deepEqual(typedEffect.state.skills[typedId].rules[0].program, [damageOp('energy', 'event.power')]);
});

test('单一伤害标签与效果主击不会双倍结算，旧格式仍从效果生成伤害', () => {
  const tagged = hydrateDummy(shooterYaml.replace('效果: |', '效果：100%物理伤害'));
  const taggedId = tagged.state.units.e1.skills[0];
  assert.equal(tagged.state.skills[taggedId].damage, undefined, '效果已生成 active 主击时不再自动生成模板 damage');
  assert.equal(tagged.state.skills[taggedId].rules.filter(rule => rule.hook === 'active').length, 1);
  assert.deepEqual(tagged.state.skills[taggedId].rules[0].program, [damageOp('physical', 'event.power')]);
  const legacy = hydrateDummy(shooterYaml.replace('[伤害: 物理]', '').replace('效果: |', '效果：100%物理伤害'));
  const legacyId = legacy.state.units.e1.skills[0];
  assert.equal(legacy.state.skills[legacyId].damage, undefined);
  assert.deepEqual(legacy.state.skills[legacyId].rules[0].program, [damageOp('physical', 'event.power')]);
});

test('旧技能效果中的百分比伤害按威力结算一次，混合类型独立结算', () => {
  for (const [effect, expected] of [
    ['100%物理伤害', [['physical', 'event.power', 50]]],
    ['60％物理伤害/40%能量伤害', [['physical', 'event.power * (60 / 100)', 30], ['energy', 'event.power * (40 / 100)', 20]]],
  ]) {
    const {state, warnings} = hydrateDummy(shooterYaml.replace('[伤害: 物理]', '').replace('效果: |', `效果：${effect}`));
    const actor = state.units.e1, target = state.units.p1, skillId = actor.skills[0];
    const skill = state.skills[skillId];
    assert.deepEqual(warnings, []);
    assert.equal(skill.power, 50);
    assert.deepEqual(skill.rules.map(rule=>rule.program),[expected.map(([type,amount])=>damageOp(type,amount))]);
    state.turn = state.order.indexOf(actor.id);
    Object.assign(actor, { ap: 2, used: { attack: 0, action: 0 }, x: 1, y: 1 });
    Object.assign(target, { armor: 0, x: 2, y: 1 });
    setMaxResource(state, actor, 'sp', 40);
    setMaxResource(state, target, 'hp', 500);
    const logs = applyAction(state, { type: 'skill', skillId, x: 2, y: 1 });
    assert.deepEqual(logs.filter(e => e.type === 'damage').map(e => [e.detail.damageType,e.detail.amount]), expected.map(([type,,amount]) => [type,amount]));
    assert.equal(target.hp, 450);
  }
});
function castFixture(cost='攻击: 20 SP') {
  const {state,warnings}=hydrateDummy(shooterYaml.replace('攻击: 20 SP',cost));
  assert.deepEqual(warnings,[]);
  const actor=state.units.e1,target=state.units.p1,id=actor.skills[0],skill=state.skills[id];
  state.turn=state.order.indexOf(actor.id);actor.ap=2;actor.used={attack:0,action:0};actor.x=1;actor.y=1;target.x=2;target.y=1;
  setMaxResource(state,actor,'hp',21);
  setMaxResource(state,actor,'mp',20);
  setMaxResource(state,actor,'sp',40);
  setMaxResource(state,target,'hp',500);
  return {state,actor,skill,action:{type:'skill',skillId:id,x:2,y:1}};
}
test('G124-a/d 顶层伤害类型校验',()=>{
  const {state,skill}=castFixture();assert.equal(skill.damageType,'physical');validateState(state);skill.damageType='fire';assert.throws(()=>validateState(state),/damageType/);
});
test('G124-b/c VM 伤害指令显式声明类型，结算日志使用该类型',()=>{
  for (const type of ['energy','mental']) {
    const {state,skill,action}=castFixture();
    skill.damageType='energy';
    const [op]=skill.rules[0].program;
    delete op.damageType;
    assert.throws(()=>validateState(state),/VM 规则/);
    op.damageType=type;
    validateState(state);
    const log=applyAction(state,action).find(l=>l.type==='damage');
    assert.equal(log.detail.damageType,type);
  }
});
test('G125-a HP 付费保留最后 1 HP，战报记录实际扣除量',()=>{
  const {state,actor,action,skill}=castFixture();
  skill.resourceCost={hp:20};
  validateState(state);
  const logs=applyAction(state,action);
  assert.equal(actor.hp,1);
  const cost=logs.find(log=>log.type==='resource' && log.detail.resource==='hp');
  assert.deepEqual(cost?.detail,{targetId:actor.id,resource:'hp',amount:20,before:21,after:1});
  assert.match(cost.text,/制式轻矢点射.*20点 HP/);
});
test('G125-b HP 不足时拒绝、保留行动状态并记录原因',()=>{
  for(const hp of [20,19]) {
    const {state,actor,action,skill}=castFixture();
    setResource(state,actor,'hp',hp);
    skill.resourceCost={hp:20};
    validateState(state);
    const before=structuredClone(state);
    assert.equal(preview(state,action).error,'HP 不足，无法施放');
    assert.deepEqual(state,before);
    const logs=applyAction(state,action);
    assert.deepEqual([actor.hp,actor.sp,actor.ap,actor.used],[hp,40,2,{attack:0,action:0}]);
    assert.deepEqual(logs.map(({type,text})=>[type,text]),[['skill_rejected','HP 不足，无法施放']]);
  }
});
test('G125-c/d 组合资源与双槽，以及原文 1 HP',()=>{
  const {state,actor,action,skill}=castFixture('1 HP');assert.deepEqual(skill.resourceCost,{hp:1});skill.resourceCost={mp:10,sp:5,hp:3};validateState(state);applyAction(state,action);assert.deepEqual([actor.mp,actor.sp,actor.hp],[10,35,18]);
  const b=castFixture('攻击: 1 动作: 1，20 SP，10 HP');b.state.mode='split';applyAction(b.state,b.action);assert.deepEqual([b.actor.hp,b.actor.sp,b.actor.ap,b.actor.used],[11,20,0,{attack:1,action:1}]);
  for(const bad of [{},{hp:-1},{hp:25001},{hp:1,foo:1},{hp:1.1}]){skill.resourceCost=bad;assert.throws(()=>validateState(state),/resourceCost/);}
});

test('刺壳寄居蟹：叙事附效不阻断标签主击，贴身起扇逐人结算能量45/真实30', () => {
  const crab = `姓名: 刺壳寄居蟹
生命层级: 第一层级
等级: 3
体长: 1.35
属性:
  力量: 5 + 0 + 1 = 6
  敏捷: 2 + 0 + 0 = 2
  体质: 6 + 0 + 1 = 7
  智力: 1 + 0 + 0 = 1
  精神: 3 + 0 + 0 = 3
资源:
  HP: 719
  MP: 200
  SP: 400
技能:
  - 名称: 重螯钳击
    品质: 普通
    类型: 主动
    消耗: [攻击: 45 SP]
    标签: [力量][单体][有效距离: 贴身(0)][伤害][威力: 85][伤害: 物理]
    效果: |
      碎骨锯齿: 额外造成18点穿刺与钝击物理伤害
  - 名称: 蚀壳酸沫
    品质: 普通
    类型: 主动
    消耗: [攻击: 60 MP]
    标签: [精神][范围: 近程(2)+扇(敌方)][有效距离: 贴身(0)][伤害][威力: 75][伤害: 能量45/真实30]
    效果: |
      缩壳蓄守: 施放后至下回合开始前自身受到的物理伤害固定减少10点`;
  const {state, roster, warnings}=hydrateFromSources({charInfo:crab,mvu:{主角:mvu.主角},battleInit:{terrainMode:'flat',units:[
    {id:'e',name:'刺壳寄居蟹',source:'char_info',team:'red',x:2,y:2},
    {id:'p',source:'mvu:主角',team:'blue',x:3,y:2}, {id:'q',source:'mvu:主角',team:'blue',x:4,y:2}]}},{throwOnValidation:true});
  const actor=state.units.e, [claw, acid]=actor.skills.map(id=>state.skills[id]);
  assert.deepEqual([actor.stats,actor.hp,actor.maxHp,actor.mp,actor.sp,actor.tier,actor.bodyLengthM,roster.find(r=>r.id==='e').level],
    [{str:6,agi:2,con:7,int:1,spi:3},719,719,200,400,1,1.35,3]);
  assert.deepEqual([claw.power,claw.damage.type,claw.range,claw.sp,acid.power,acid.range,acid.radius,acid.mp],[85,'physical',0,45,75,0,2,60]);
  assert.deepEqual(warnings.filter(w=>w.unitId==='e').map(w=>w.message.includes('碎骨锯齿')||w.message.includes('缩壳蓄守')),[true,true]);
  state.turn=state.order.indexOf(actor.id); Object.assign(actor,{ap:2,used:{attack:0,action:0},facing:[1,0]});
  const logs=applyAction(state,{type:'skill',skillId:actor.skills[1],x:actor.x,y:actor.y});
  assert.deepEqual(logs.filter(l=>l.type==='damage').map(l=>[l.detail.targetId,l.detail.damageType]),[['p','energy'],['p','true'],['q','energy'],['q','true']]);
  assert.deepEqual(acid.rules[0].program[0].body,[damageOp('energy',45),damageOp('true',30)]);
  assert.equal(actor.mp,140);
});

test('G127 混合伤害区分绝对值和百分比；动作、MP 和双槽消耗', () => {
  for(const [tag,amounts,cost,expected] of [['物理40/能量20',[40,20],'攻击: 1 动作: 1',{ap:2,slot:'attack'}],['物理40%/能量20%',['event.power * (40 / 100)','event.power * (20 / 100)'],'动作: 1',{ap:1,slot:'action'}],['物理40/能量20',[40,20],'20 MP',{mp:20}]]){
    const {state}=hydrateDummy(shooterYaml.replace('威力: 50','威力: 60').replace('伤害: 物理',`伤害: ${tag}`).replace('攻击: 20 SP',cost));const s=state.skills[state.units.e1.skills[0]];
    for(const [k,v] of Object.entries(expected))assert.equal(s[k],v);
    assert.deepEqual(s.rules.map(rule=>rule.program),[[damageOp('physical',amounts[0]),damageOp('energy',amounts[1])]]);
  }
});

test('G134/G137/G141 结构化诊断保留角色归属和全局地形',()=>{
  const input={mvu:{主角:{name:'主角',hp:100,skills:[{name:'例一',效果:'主角被动'}]}},charInfo:{name:'怪物',skills:[{name:'例二',效果:'低伤校准'}]},battleInit:{units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'monster-1',source:'char_info',name:'怪物',team:'red',x:4,y:4}],grid:{walls:[[-1,5]]}}};
  const result=hydrateFromSources(input,{throwOnValidation:true}),{warnings}=result.state;
  assert.deepEqual(warnings.map(({unitId,source,scope})=>({unitId,source,scope})),[{unitId:'p',source:'mvu',scope:'effect'},{unitId:'monster-1',source:'char_info',scope:'effect'},{unitId:null,source:'terrain',scope:'terrain'}]);
  assert.ok(warnings.every(w => typeof w.message === 'string'));
  assert.strictEqual(warnings, result.warnings);
  assert.strictEqual(warningsForUnit(warnings, []), warnings);
  assert.deepEqual(warningsForUnit(warnings, ['monster-1']), warnings.slice(1));
  assert.deepEqual(warningsForUnit(warnings, ['monster-1'], false), [warnings[1]]);
  for(const slot of [{id:'warnings'},{id:'custom',custom:true,content:'{{warnings}}'}]){const msg=resolveSlotContent(slot,{sources:result,onlyUnitIds:['monster-1']});assert.ok(msg.includes('低伤校准')&&msg.includes('grid.walls')&&!msg.includes('主角被动'));}
});

const effectWarning = (name, unitId = 'p', originPath = '/equipment/bow') => ({
  message: `装备效果待标准化「${name}」：原描述`, unitId, originPath, source: 'mvu', scope: 'effect',
});
const referenceFor = ({ unitId, originPath, message }) => ({ unitId, originPath, message });

test('快照按条目对比：新增技能效果不重置已标准化装备', () => {
  const before = { raw:{}, hash:'whole-old', entryHashes:{unit:'u', 'equipment:bow':'b', 'skills:old':'s'} };
  const after = { raw:{}, hash:'whole-new', entryHashes:{unit:'u', 'equipment:bow':'b', 'skills:old':'s', 'skills:new':'n'} };
  assert.deepEqual([...changedEntryKeys(before, after)], ['skills:new']);
  assert.equal(warningEntryKey(effectWarning('弩弦', 'p', '/equipment/bow')), 'equipment:bow');
  assert.deepEqual(normalizationCandidates({p:after}, {p:before}, []), []);
  const warnings = [effectWarning('弩弦', 'p', '/equipment/bow'), effectWarning('新技能', 'p', '/skills/new')];
  const snapshots = {p:{...after, resolvedWarnings:[warningKey(warnings[0])]}};
  assert.deepEqual(remainingDiagnostics(warnings, snapshots, {p:after}), [warnings[1]]);
});

test('水合回放：同批不同条目独立复用，回包保留武器，删除移除原条目和收据', async () => {
  const dagger = { 类型:'武器', 位置:'副手', 标签:['匕首','攻击: 14'], 效果:{ 断刃:'命中后折断自己的利刃' } };
  const spell = { 效果:{ 回响:'将这次施法回响至时间尽头' } };
  async function hydrate(moved, changed, removed) {
    const mvuData = { 主角:{ ...mvu.主角, 装备: moved ? {} : { 小刀:dagger },
      背包: moved && !removed ? { 小刀:{ ...dagger, 位置:'' } } : {},
      技能: removed ? {} : { 回响: changed ? { 效果:{ ...spell.效果, 扩展:'触发另一个法则' } } : spell } } };
    const hydrated = hydrateFromSources({ mvu:mvuData, battleInit:'battle|1|cache|测试|flat|42\nunit|p|blue|mvu:主角|玩家|1,1\nunit|e|red|char_info|守卫|2,1', charInfo:[{ 名称:'守卫', hp:100 }] }, { throwOnValidation:true });
    return { ...hydrated, records:await characterRecords({ mvuData, battleInit:hydrated.battleInit }, hydrated) };
  }
  const first = await hydrate(false, false, false);
  const unit = first.state.units.p;
  const itemId = unit.offHand, templateId = first.state.items[itemId].templateId, [skillId] = unit.skills;
  const bowPath = `/equipment/${templateId}`, skillPath = `/skills/${skillId}`;
  const solved = first.warnings.filter(w => [bowPath, skillPath].includes(w.originPath));
  assert.equal(solved.length, 2);
  const patch = [{ op:'add', path:`${bowPath}/attack`, value:28 }, { op:'add', path:`${skillPath}/power`, value:17 }];
  const fingerprint = (state, path) => JSON.stringify(path.split('/').slice(1).reduce((node, key) => node?.[key], state));
  const transactions = normalizationTransactions({ patch, solved, verified:[], before:first.state, records:first.records, fingerprint });
  assert.equal(transactions.length, 2);
  const replay = input => replayNormalization(input.state, transactions, input.records, input.warnings, { apply:applyPatch, validate:validateState, fingerprint });
  assert.equal(replay(await hydrate(false, false, false)).kept.length, 2);
  const changed = await hydrate(true, true, false);
  const after = replay(changed);
  assert.equal(after.kept.length, 1);
  assert.deepEqual(after.state.units.p.bagWeapons, [itemId]);
  assert.equal(after.state.units.p.offHand, null);
  assert.equal(after.state.equipment[templateId].attack, 28);
  assert.deepEqual(remainingDiagnostics(changed.warnings, {}, changed.records, after.kept).map(w => w.originPath), [skillPath, skillPath]);
  const removed = replay(await hydrate(true, false, true));
  assert.equal(removed.kept.length, 0);
  assert.equal(removed.state.items[itemId], undefined);
  assert.equal(removed.state.equipment[templateId], undefined);
  assert.equal(removed.state.skills[skillId], undefined);
});

test('诊断收据：只能核销唯一匹配已发送警告的结构化操作收据，不猜测最后一项', () => {
  const ice = effectWarning('冰冻箭'), fire = effectWarning('火矢'), enemy = effectWarning('冰冻箭', 'e');
  const warnings = [ice, fire, enemy];
  const records = { p: { hash:'h' }, e: { hash:'e' } };
  const op = { op:'replace', path:'/equipment/bow/rules', value:[{ id:'冰冻箭', hook:'after_hit', program:[] }] };
  const explicit = { ...op, resolves:[referenceFor(ice)] };
  assert.deepEqual(resolvedDiagnostics([ice], records, [op]), []);
  assert.deepEqual(resolvedDiagnostics(warnings, records, [op], readUnresolvedDiagnostics(['火矢'], warnings).matched), []);
  assert.deepEqual(resolvedDiagnostics(warnings, records, [{ ...op, resolves:['冰冻箭'] }]), []);
  assert.deepEqual(resolvedDiagnostics(warnings, records, [{ ...explicit, path:'/equipment/other/rules' }]), []);
  assert.deepEqual(resolvedDiagnostics(warnings, records, [explicit]), [ice]);
  const snapshots = { p:{ hash:'h', resolvedWarnings:[warningKey(ice)] } };
  assert.deepEqual(remainingDiagnostics(warnings, snapshots, records), [fire, enemy]);
  assert.deepEqual(remainingDiagnostics(warnings, snapshots, { p:{ hash:'changed' } }), warnings);
});

test('未解决诊断：结构化引用精确关联角色、路径与主题，阻止冲突的核销且不泄漏 JSON', () => {
  const title = '微弱法则[XXX]';
  const first = effectWarning(title), next = effectWarning(`${title}扩展`), otherTemplate = effectWarning(title, 'p', '/equipment/other');
  const otherUnit = effectWarning(title, 'e');
  const warnings = [first, next, otherTemplate, otherUnit];
  const unresolved = { unitId: 'p', originPath: '/equipment/bow', effectName: title, reason: '仍缺触发时机' };
  const { matched, invalid } = readUnresolvedDiagnostics([{ ...unresolved, kind: 'missing_info' },
    { ...referenceFor(otherUnit), reason: '对手的数值未确定' }, '{"bad":"raw model object"}',
    { ...referenceFor(next), reason: '{"nested":2}' }], warnings);
  assert.deepEqual(matched, [{ warning: first, detail: '仍缺触发时机', kind: 'missing_info' }, { warning: otherUnit, detail: '对手的数值未确定' }]);
  assert.equal(invalid.length, 2);
  assert.doesNotMatch(invalid.join(' '), /raw model object|nested|unitId|originPath/);
  assert.doesNotMatch(diagnosticText('HTTP 502：上游失败（{"error": "secret"}）'), /secret/);
  assert.deepEqual(pendingDiagnostics([first], readUnresolvedDiagnostics([`${title}：仍缺目标`], [first]).matched),
    [`${first.message}（模型说明：仍缺目标）`]);
  const records = { p:{hash:'h'}, e:{hash:'e'} };
  const op = { path:'/equipment/bow/rules', resolves:[referenceFor(first), referenceFor(otherUnit)] };
  assert.deepEqual(resolvedDiagnostics(warnings, records, [op], readUnresolvedDiagnostics([unresolved], warnings).matched), [otherUnit]);
  const malformed = readUnresolvedDiagnostics([{ ...unresolved, originPath:'/equipment/wrong' },
    { ...unresolved, message:next.message }, { ...unresolved, reason:{ bad:true } }], warnings);
  assert.deepEqual(malformed.matched, []);
  assert.equal(malformed.invalid.length, 3);
});

test('char fingerprint merges raw sources without hashing placement or actor AP', async () => {
  const sources={mvuData:{主角:{name:'阿青',hp:20,skills:[{ap:1}]}},charInfo:[{name:'阿青',描述:'原始信息'}],battleInit:{units:[{id:'p',x:1,ap:2}]}};
  const h={roster:[{id:'p',name:'阿青',source:'MVU'}],sourceMap:{p:{path:['主角']}}};
  const read=async()=>(await characterRecords(sources,h)).p;
  const first=await read(); assert.equal(first.raw.char_info.描述,'原始信息');
  sources.battleInit.units[0].x=9;sources.battleInit.units[0].ap=0;
  sources.mvuData.主角={skills:[{ap:1}],hp:20,name:'阿青'}; assert.equal((await read()).hash,first.hash);
  sources.mvuData.主角.skills[0].ap=2; assert.notEqual((await read()).hash,first.hash);
  sources.mvuData.主角.skills[0].ap=1;sources.charInfo[0].描述='修改';assert.notEqual((await read()).hash,first.hash);
});
test('scoped roster omits other units and their item/skill templates', () => {
  const ctx={state:{units:{p:{weapon:'i',skills:['a']},q:{weapon:'j',skills:['b']}},items:{i:{templateId:'t'},j:{templateId:'u'}},equipment:{t:{},u:{}},skills:{a:{},b:{}}},rawCharacters:{p:{tag:'原始'},q:{}},onlyUnitIds:['p']};
  const row=JSON.parse(resolveSlotContent({id:'roster'},ctx)); for(const [key,id] of Object.entries({units:'p',items:'i',equipment:'t',skills:'a',raw:'p'}))assert.deepEqual(Object.keys(row[key]),[id]);
});

test('instance-card rule formatter displays the trigger and status duration', () => {
  assert.equal(ruleSummary({hook:'after_hit',program:[{op:'apply_status',statusId:'bleed',turns:2}]}),'命中时 → 施加 流血 2 回合');
});

function cardSections(state, unit, options = {}) {
  const make = (tag, attrs = {}, value = '') => ({
    tag, attrs, value, children: [], dataset: {},
    style: { setProperty() {} }, classList: { add() {} }, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    dispatchEvent(event) { for (const fn of this.listeners[event.type ?? 'click'] ?? []) fn(event); },
    append(...nodes) { this.children.push(...nodes); },
    get textContent() { return [this.value, ...this.children.map(node => node.textContent)].join('\n'); },
  });
  const { body } = fillInstance(make('article'), make, unit, state, {}, make('input'), { ...options });
  return body.children.filter(node => node.tag === 'section').map(section => section.children.slice(1));
}

test('instance card counts and describes equipment mods, rules and granted skills', () => {
  const unit = { id: 'a1', gear: ['mail', 'ring'], skills: ['guard'] };
  const state = {
    items: { mail: { id: 'mail', templateId: 'armor' }, ring: { id: 'ring', templateId: 'accessory' } },
    equipment: {
      armor: { name: '冥甲', mods: [
        { stat: 'damageReductionFlat', flat: 800 }, { stat: 'damageReduction', flat: 0.3 },
        { stat: 'damageMult', mult: 1.3 }, { stat: 'armorPiercePercent', flat: 0.2 },
        { stat: 'armor', flat: 'self.con', when: 'self.hp > 0' }, { locks: ['move', 'cast'] },
      ] },
      accessory: { name: '星弧裂空之戒', skills: ['deflect'], mods: [{ stat: 'checkBonus', flat: 2 }], rules: [
        { id: 'bleed', hook: 'after_hit', program: [{ op: 'apply_status', statusId: 'bleed', turns: 2 }] },
      ] },
    },
    skills: { guard: { name: '战帅本能', passive: true }, deflect: { name: '星光偏转' } },
  };
  const [equipment, skills] = cardSections(state, unit);
  const [armor, ring] = equipment;
  assert.equal(armor.tag, 'details');
  assert.equal(armor.children[0].children.find(node => node.attrs.class === 'fated-char-fx').value, '6 个效果');
  for (const summary of ['受击固定减伤 +800', '受击伤害减免 +30%', '全伤害倍率 ×1.3', '百分比穿甲 +20%',
    '护甲 按公式 self.con · 条件：self.hp > 0', '禁止移动、施法']) assert.ok(armor.textContent.includes(summary), summary);
  assert.match(ring.textContent, /3 个效果/);
  assert.match(ring.textContent, /命中时 → 施加 流血 2 回合/);
  assert.match(ring.textContent, /附带技能 · 星光偏转/);
  assert.equal(skills.length, 2);
  assert.match(skills[0].textContent, /战帅本能\s+被动/);
  assert.match(skills[1].textContent, /星光偏转\s+装备附带/);
});

test('instance card offers one whole-entry reroll control, not one control per effect', () => {
  const unit = { id: 'a1', gear: ['ring'], skills: [] };
  const state = { items: { ring: { id: 'ring', templateId: 'accessory' } }, equipment: {
    accessory: { name: '星弧裂空之戒', rules: [{ id: 'step', hook: 'active', program: [] }], mods: [{ stat: 'dr', flat: 0.3 }] },
  }, skills: {} };
  const calls = [];
  const [equipment] = cardSections(state, unit, { onDiscardEntry: ref => calls.push(ref) });
  assert.match(equipment[0].textContent, /删除并重roll/);
  const buttons = equipment[0].children.filter(node => node.tag === 'summary')[0].children.filter(node => node.tag === 'button');
  assert.equal(buttons.length, 1);
  buttons[0].dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/equipment/accessory');
});

test('instance card lists virtual equipment actives once and excludes disabled rules', () => {
  const active = (id, label, enabled) => ({ id, label, hook: 'active', enabled, program: [{ op: 'move', kind: 'teleport', target: 'self', to: { x: 3, y: 2 } }] });
  const unit = { id: 'a1', mainHand: 'ring', gear: ['ring'], skills: [] };
  const state = {
    items: { ring: { id: 'ring', templateId: 'accessory', rules: [active('instance_step', '实例折跃', true)] } },
    equipment: { accessory: { name: '星弧裂空之戒', rules: [active('void_step', '虚空折跃', true), active('disabled', '已禁用法则', false)] } },
    skills: {},
  };
  const [equipment, skills] = cardSections(state, unit);
  assert.equal(equipment.length, 1);
  assert.equal(equipment[0].tag, 'details');
  assert.match(equipment[0].textContent, /3 个效果/);
  assert.match(equipment[0].textContent, /已禁用法则 · 已关闭：主动/);
  assert.deepEqual(skills.map(row => row.children[0].children[0].value).sort(), ['实例折跃', '虚空折跃'].sort());
  assert.ok(skills.every(row => row.textContent.includes('装备附带')));
});

test('battle_init 配套正则输出可点击入口', () => {
  const output = renderBattleInitEntry('<battle_init>{"battleId":"x"}</battle_init>');
  assert.match(output, /data-fated-battle-open="true"/);
  assert.match(output, /eventEmit/);
  assert.match(output, /<pre class="fated-battle-source">/);
  assert.doesNotMatch(output, /<battle_init>/);
});

test('含威力与单一伤害标签的技能由转换器确定性生成协议主击 damage', () => {
  const crabSkillYaml = `技能:\n  - 名称: 断铁巨螯夹击\n    消耗: 攻击: 80 SP\n    标签: [力量][单体][有效距离: 近程(1)][伤害][威力: 190][伤害: 物理]\n    效果:\n      重钳撕裂: 命中后额外造成 55 点物理伤害`;
  const { state, warnings } = hydrateDummy(crabSkillYaml);
  const sid = state.units.e1.skills[0];
  assert.equal(state.skills[sid].power, 190);
  assert.deepEqual(state.skills[sid].damage, { count: 1, sides: 4, stat: 'str', type: 'physical' });
  const diag = warnings.find(w => w.originPath === `/skills/${sid}`);
  assert.ok(diag, '附加效果仍应产生待标准化诊断');
  assert.match(diag.message, /效果待标准化「重钳撕裂」/);
  assert.doesNotMatch(diag.message, /缺少 damage 骰子对象/);
});

