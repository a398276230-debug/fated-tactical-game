import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateState } from '../src/api/validation.js';
import { applyAction, preview, switchableWeapons } from '../src/core/combat.js';
import { resolvedDiagnostics, remainingDiagnostics, warningKey } from '../src/tavern/resolved-warnings.js';
import { characterRecords } from '../src/tavern/char-snapshots.js';
import { effectSummary } from '../src/tavern/instance-card.js';
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
  state.turn=state.order.indexOf('p');p.ap=2;p.used={attack:0,action:0};e.hp=e.maxHp=500;
  const use={type:'skill',skillId:bomb,x:e.x,y:e.y};assert.equal(preview(state,{...use,skillId:potion}).ok,false);
  assert.equal(preview(state,{...use,x:p.x,y:p.y}).ok,false);assert.equal(p.inventory[bomb],3);
  applyAction(state,use);assert.equal(p.inventory[bomb],2);assert.equal(bag.手榴弹.数量,3);assert.equal(e.hp,400);
  assert.deepEqual(p.used,{attack:0,action:1});assert.ok(state.logs.some(log=>log.text.includes('手榴弹（数量 3 → 2）')));validateState(state);
});

test('主手弓命中后，小刀只在自己射程内追击和扣 SP', () => {
  for (const dist of [1,4]) {
    const {state}=hydrateFromSources({mvu:{主角:{...mvu.主角,装备:{弓:{类型:'武器',位置:'主手',effects:[{id:'guarantee',trigger:'passive',target:'self',effects:[{kind:'forceOutcome',mode:'crit'}]}]},小刀:{类型:'武器',位置:'副手'}}}},charInfo:{name:'木偶',hp:99999},battleInit:{terrainMode:'flat',units:[{id:'p',source:'mvu:主角',name:'主角',team:'blue',x:1,y:1},{id:'e',source:'char_info',name:'木偶',team:'red',x:1+dist,y:1}]}},{throwOnValidation:true});
    const {p,e}=state.units;state.turn=state.order.indexOf('p');p.used={attack:0,action:0};p.ap=2;e.hp=e.maxHp=99999;const sp=p.sp;
    applyAction(state,{type:'attack',x:e.x,y:e.y});assert.ok(e.hp<99999);
    assert.equal(state.logs.some(l=>l.type==='followup'),dist===1);assert.equal(sp-p.sp,dist===1?10:0);
  }
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

test('battle_init 描述符拒绝重复起点与模糊 MVU 来源', () => {
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|mvu|敌人|1,1'), /battle_init 描述符/);
  assert.throws(() => parseBattleInit('battle|1|x|场景|flat\nunit|p1|blue|mvu:主角|主角|1,1\nunit|e1|red|char_info|敌人|1,1'), /位置重复/);
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
    状态效果: { 定身: { 层数: 1, 剩余时间: '3回合' }, 场地弹药补给: {} },
    装备: {
      匕首: { 类型: '武器', 位置: '主手' },
      木盾: { 类型: '防具', 位置: '副手' },
      皮甲: { 类型: '防具', 位置: '躯干', 标签: ['防御：6'], 效果: { 轻便: '描述文字' } },
    },
    技能: { 冰箭: { 效果: [{ kind: 'status', status: '冰冻' }, { kind: 'status', status: '不存在' }] } },
  } } }, { throwOnValidation: true });
  const { state, warnings } = result;
  const p = state.units.p1;
  assert.equal(p.offHand, null);
  assert.equal(state.equipment[state.items[p.mainHand].templateId].name, '匕首');
  assert.equal(state.equipment[state.items[p.shield].templateId].name, '木盾');
  assert.equal(state.equipment[state.items[p.gear[0]].templateId].armor, 6);
  assert.equal(p.statuses.root.remainingTurns, 3);
  assert.deepEqual(state.skills[p.skills[0]].effects.map(e => e.effects), [[{ kind: 'grantStatus', statusId: 'freeze' }]]);
  for (const label of ['场地弹药补给', '轻便', '不存在']) assert.ok(warnings.some(w => w.message.includes(label)));
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
test('G100 populated YAML block keeps executable content and diagnoses unknown content', () => {
  const warnings = [];
  const block = '| \n 平直射击: knockback';
  assert.equal(mapEffects(block, 'skill', warnings)[0]?.effects[0]?.kind, 'knockback');
  for (const header of ['|','>-','|2']) {
    const {state, warnings: actual} = hydrateDummy(shooterYaml.replace('效果: |', `效果: ${header}\n      平直射击: knockback`));
    assert.equal(state.skills[state.units.e1.skills[0]].effects[0]?.effects[0]?.kind, 'knockback');
    assert.deepEqual(actual, []);
  }
  assert.deepEqual(warnings, []);
  assert.deepEqual(mapEffects('|\n 平直射击: 尚未定义的动作', 'skill', warnings), []);
  assert.ok(warnings.some(w => w.message.includes('尚未定义的动作')));
});
test('G101 status placeholders are silent without hiding invalid modifier overrides', () => {
  const {state,warnings} = hydrateDummy({ 状态: ['|', '>-', {}, null, {id:'stun',modifiers:'|'}] });
  assert.deepEqual(warnings, []);
  assert.equal(state.units.e1.statuses.stun.modifiers.skip, true);
  const bad = hydrateDummy({ 状态: [{id:'stun',modifiers:{badKey:2}}] });
  assert.ok(bad.warnings.some(w => w.message.includes('状态 stun 已拒绝')));
});
test('G102/G103 original YAML and rejected effects retain the referenced skill template', () => {
  const {state,warnings} = hydrateDummy(shooterYaml.replace('[伤害: 物理]',''));
  const [id] = state.units.e1.skills;
  assert.equal(id, 'skill-e1-10nk26b-0');
  assert.deepEqual(warnings, []);
  const skill = state.skills[id];
  assert.deepEqual([skill.name,skill.effects,skill.power,skill.range,skill.target], ['制式轻矢点射',[],50,5,'enemy']);
  const rejected = hydrateDummy(shooterYaml.replace('效果: |','效果: 不认识的动作'));
  assert.deepEqual(rejected.state.skills[id], { ...skill, damageType:'physical' });
  assert.ok(rejected.warnings.some(w => w.message.includes('不认识的动作')));
  console.log('G103 skill', id, JSON.stringify(skill), 'warnings=[]');
});

test('G124–G126/G129/G130 原文标签生成独立伤害节点，实际施放扣 SP', () => {
  for (const [label,type] of Object.entries({物理:'physical',能量:'energy',精神:'mental',真实:'true'})) {
    const {state,roster,warnings}=hydrateDummy(shooterYaml.replace('[伤害: 物理]',`[伤害: ${label}]`));
    const actor=state.units.e1, target=state.units.p1, id=actor.skills[0], s=state.skills[id];
    assert.deepEqual(warnings,[]);assert.equal(roster.find(u=>u.id==='e1').skillInfo[id].damageType,type);
    assert.deepEqual(s.effects[0].effects,[{kind:'damage',percentOfPower:1,damageType:type}]);assert.equal(s.sp,20);assert.equal(s.slot,'attack');
    state.turn=state.order.indexOf(actor.id);actor.ap=2;actor.used={attack:0,action:0};actor.sp=actor.maxSp=40;actor.x=1;actor.y=1;target.x=2;target.y=1;
    const before=target.hp;applyAction(state,{type:'skill',skillId:id,x:2,y:1});assert.equal(actor.sp,20);assert.ok(target.hp<before);
    if(label==='物理') console.log('G130',JSON.stringify({[id]:s}),`SP 40→${actor.sp}; HP ${before}→${target.hp}`);
  }
});
test('旧技能效果中的百分比伤害按威力结算一次，混合类型独立结算', () => {
  for (const [effect, expected] of [
    ['100%物理伤害', [['physical', 1]]],
    ['60％物理伤害/40%能量伤害', [['physical', .6], ['energy', .4]]],
  ]) {
    const {state, warnings} = hydrateDummy(shooterYaml.replace('[伤害: 物理]', '').replace('效果: |', `效果：${effect}`));
    const actor = state.units.e1, target = state.units.p1, skillId = actor.skills[0];
    const skill = state.skills[skillId];
    assert.deepEqual(warnings, []);
    assert.equal(skill.power, 50);
    assert.equal(skill.effects.length, 1);
    assert.deepEqual(skill.effects[0].effects.map(n => [n.damageType, n.percentOfPower]), expected);
    state.turn = state.order.indexOf(actor.id);
    Object.assign(actor, { ap: 2, used: { attack: 0, action: 0 }, sp: 40, maxSp: 40, x: 1, y: 1 });
    Object.assign(target, { hp: 500, maxHp: 500, armor: 0, x: 2, y: 1 });
    const start = state.logs.length;
    applyAction(state, { type: 'skill', skillId, x: 2, y: 1 });
    assert.deepEqual(state.logs.slice(start).filter(e => e.type === 'damage').map(e => e.detail.raw), expected.map(([,ratio]) => 50 * ratio));
    assert.equal(target.hp, 450);
  }
});
function castFixture(cost='攻击: 20 SP') {
  const {state,warnings}=hydrateDummy(shooterYaml.replace('攻击: 20 SP',cost));
  assert.deepEqual(warnings,[]);
  const actor=state.units.e1,target=state.units.p1,id=actor.skills[0],skill=state.skills[id];
  state.turn=state.order.indexOf(actor.id);actor.ap=2;actor.used={attack:0,action:0};actor.hp=actor.maxHp=21;actor.mp=actor.maxMp=20;actor.sp=actor.maxSp=40;actor.x=1;actor.y=1;target.x=2;target.y=1;target.hp=target.maxHp=500;
  return {state,actor,skill,action:{type:'skill',skillId:id,x:2,y:1}};
}
test('G124-a/d 顶层伤害类型校验',()=>{
  const {state,skill}=castFixture();assert.equal(skill.damageType,'physical');validateState(state);skill.damageType='fire';assert.throws(()=>validateState(state),/damageType/);
});
test('G124-b/c 实际伤害日志记录节点覆盖或技能默认',()=>{
  for (const override of [undefined,'mental']) {
    const {state,skill,action}=castFixture();skill.damageType='energy';const node=skill.effects[0].effects[0];delete node.damageType;if(override)node.damageType=override;
    validateState(state);const log=applyAction(state,action).find(l=>l.detail.effectId===skill.effects[0].id && l.detail.hpBefore);
    assert.equal(log.detail.damageType,override??'energy');
  }
});
test('G125-a/b HP 付费保留最后 1 HP，拒绝无副作用且有日志',()=>{
  for(const hp of [21,20,19]) {
    const {state,actor,action,skill}=castFixture();actor.hp=hp;skill.resourceCost={hp:20};validateState(state);
    if(hp>20){applyAction(state,action);assert.equal(actor.hp,1);assert.ok(state.logs.some(l=>l.text==='施放 制式轻矢点射 消耗 20 HP'));}
    else {const n=state.logs.length;assert.equal(preview(state,action).error,'HP 不足，无法施放');assert.equal(state.logs.length,n);assert.equal(applyAction(state,action)[0].type,'skill_rejected');assert.equal(state.logs.at(-1).text,'HP 不足，无法施放');assert.deepEqual([actor.hp,actor.sp,actor.ap],[hp,40,2]);}
  }
});
test('G125-c/d 组合资源与双槽，以及原文 1 HP',()=>{
  const {state,actor,action,skill}=castFixture('1 HP');assert.deepEqual(skill.resourceCost,{hp:1});skill.resourceCost={mp:10,sp:5,hp:3};validateState(state);applyAction(state,action);assert.deepEqual([actor.mp,actor.sp,actor.hp],[10,35,18]);
  const b=castFixture('攻击: 1 动作: 1，20 SP，10 HP');b.state.mode='split';applyAction(b.state,b.action);assert.deepEqual([b.actor.hp,b.actor.sp,b.actor.ap,b.actor.used],[11,20,0,{attack:1,action:1}]);
  for(const bad of [{},{hp:-1},{hp:25001},{hp:1,foo:1},{hp:1.1}]){skill.resourceCost=bad;assert.throws(()=>validateState(state),/resourceCost/);}
});

test('G127 混合伤害区分绝对值和百分比；动作、MP 和双槽消耗', () => {
  for(const [tag,nodes,cost,expected] of [['物理40/能量20',[{flat:40},{flat:20}],'攻击: 1 动作: 1',{ap:2,slot:'attack'}],['物理40%/能量20%',[{percentOfPower:.4},{percentOfPower:.2}],'动作: 1',{ap:1,slot:'action'}],['物理40/能量20',[{flat:40},{flat:20}],'20 MP',{mp:20}]]){
    const {state}=hydrateDummy(shooterYaml.replace('威力: 50','威力: 60').replace('伤害: 物理',`伤害: ${tag}`).replace('攻击: 20 SP',cost));const s=state.skills[state.units.e1.skills[0]];
    for(const [k,v] of Object.entries(expected))assert.equal(s[k],v);
    assert.deepEqual(s.effects[0].effects,nodes.map((n,i)=>({kind:'damage',damageType:i?'energy':'physical',...n})));
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

test('诊断收据：操作声明和顶层别名只消除已发送、已解决的目标角色诊断',()=>{
  const mk=(name,id='p')=>({message:`不支持的描述性效果已忽略：${name}：原描述`,unitId:id,originPath:'/skills/ice',source:'mvu',scope:'effect'});
  const ice=mk('冰冻箭'),fire=mk('火矢'),enemy=mk('冰冻箭','e'), warnings=[ice,fire,enemy];
  const records={p:{hash:'h'}};const op={op:'replace',path:'/skills/ice/effects',value:[]};
  for(const [patch,reply] of [[[ {...op,resolves:'冰冻箭'} ],{}],[[op],{resolved:[ice.message]}],[[op],{resolvedWarnings:['冰冻箭']}],[[{...op,resolves:['冰冻箭','火矢']}],{unresolved:['火矢：尚不能转换']}]]) {
    assert.deepEqual(resolvedDiagnostics(warnings,records,patch,reply),[ice]);
  }
  assert.deepEqual(resolvedDiagnostics(warnings,records,[op],{}),[]);
  assert.deepEqual(resolvedDiagnostics([ice],records,[op],{}),[ice]);
  assert.deepEqual(resolvedDiagnostics([ice],records,[{...op,path:'/skills/other/effects'}],{}),[]);
  const explicit = { ...op, resolves: [{ unitId:'p', originPath:ice.originPath, message:ice.message }] };
  assert.deepEqual(resolvedDiagnostics(warnings, {...records,e:{hash:'e'}}, [explicit], {}), [ice]);
  assert.deepEqual(resolvedDiagnostics(warnings, {...records,e:{hash:'e'}}, [{...op,resolves:'冰冻箭'}], {}), []);
  const snapshots={p:{hash:'h',resolvedWarnings:[warningKey(ice)]}};
  assert.deepEqual(remainingDiagnostics(warnings,snapshots,records),[fire,enemy]);
  assert.deepEqual(remainingDiagnostics(warnings,snapshots,{p:{hash:'changed'}}),warnings);
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
test('scoped roster omits other units and item/skill templates; human DSL summary includes roll and turns', () => {
  const ctx={state:{units:{p:{weapon:'i',skills:['a']},q:{weapon:'j',skills:['b']}},items:{i:{templateId:'t'},j:{templateId:'u'}},equipment:{t:{},u:{}},skills:{a:{},b:{}}},rawCharacters:{p:{tag:'原始'},q:{}},onlyUnitIds:['p']};
  const row=JSON.parse(resolveSlotContent({id:'roster'},ctx)); for(const [key,id] of Object.entries({units:'p',items:'i',equipment:'t',skills:'a',raw:'p'}))assert.deepEqual(Object.keys(row[key]),[id]);
  assert.equal(effectSummary({trigger:'on_hit',roll:{dice:'d20',gte:16},effects:[{kind:'grantStatus',statusId:'bleed',turns:2}]}),'命中时 d20≥16 → 施加 流血 2 回合');
});

test('battle_init 配套正则输出可点击入口', () => {
  const output = renderBattleInitEntry('<battle_init>{"battleId":"x"}</battle_init>');
  assert.match(output, /data-fated-battle-open="true"/);
  assert.match(output, /eventEmit/);
  assert.match(output, /<pre class="fated-battle-source">/);
  assert.doesNotMatch(output, /<battle_init>/);
});
