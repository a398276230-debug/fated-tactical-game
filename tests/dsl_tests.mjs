import { expression as fx } from '../src/core/effects.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, corpses, currentUnit, equippedActiveSkills, grantStatus, living, preview, syncEquipmentEffects } from '../src/core/combat.js';
import { chooseAction } from '../src/core/ai.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { hydrateFromSources, mapEffects } from '../src/tavern/converter.js';
import { parseBattleTime } from '../src/core/battle_time.js';
import { validFormula, evaluateFormula } from '../src/core/formula.js';

const expr = (id, trigger, target, effects, extra = {}) => ({ id, trigger, target, effects, ...extra });
const strike = { type: 'attack', x: 3, y: 2 };
function setup(effects = []) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), enemy = state.units.scout, item = state.items[actor.weapon];
  item.templateId = 'v10_weapon'; item.counters = {};
  const weapon = state.equipment.v10_weapon = { name: 'DSL 测试剑', range: 2, damage: { count: 1, sides: 4, type: 'true' }, effects: [fx('no-miss', 'passive', 'self', [{ kind: 'forceOutcome', mode: 'hit' }]), fx('fixed', 'passive', 'self', [{ kind: 'modifyDamageBase', value: 20 }]), ...effects] };
  Object.assign(enemy, { hp: 1000, maxHp: 1000, nonLethal: false });
  return { state, actor, enemy, weapon };
}

test('四则公式支持受控变量、括号和除法，并用于命中后伤害', () => {
  const {state, actor, enemy} = setup();
  actor.stats.str = 10;
  state.equipment.v10_weapon.effects.push(expr('formula-bonus','on_hit','hitTarget',[
    {kind:'damage', flat:'(attacker.str-5)/attacker.str*20', damageType:'true'}
  ]));
  const before = enemy.hp;
  applyAction(state, strike);
  assert.equal(before - enemy.hp, 36, '26 主击 + 10 附伤');
});

test('公式变量是闭集，中文名、任意路径和除零均被拒绝或跳过', () => {
  assert.equal(validFormula('我方力量+1'), false);
  assert.equal(validFormula('state.units.e1.hp'), false);
  assert.equal(evaluateFormula('10/0', {}), null);
});

test('条件也支持运行时公式比较', () => {
  const {state, actor, enemy} = setup();
  actor.stats.str = 10;
  const effect = expr('conditional-formula','on_hit','hitTarget', [{kind:'damage',flat:7}], {
    condition:{type:'compare',left:'attacker.str-5',op:'>=',right:5}
  });
  state.equipment.v10_weapon.effects.push(effect);
  applyAction(state, strike);
  assert.equal(enemy.hp, 967);
});

test('主动限次技能即使满血空放也消耗次数，并限制基础治疗', () => {
  const {state, actor} = setup();
  actor.hp = actor.maxHp;
  actor.skills.push('limited');
  state.skills.limited = { name:'限次试验', ap:1, slot:'action', range:0, shape:'single', target:'self',
    heal:{count:1,sides:4}, effects:[expr('once','active','self',[{kind:'heal',amount:5}],{params:{usesPerBattle:1}})] };
  const cast = {type:'skill',skillId:'limited',x:actor.x,y:actor.y};
  applyAction(state,cast);
  actor.ap=2; actor.used={action:0,attack:0};
  assert.match(preview(state,cast).error ?? '', /次数已用尽/);
});

test('基础伤害技能的冷却和次数在概率效果落空时也照常结算', () => {
  const {state, actor, enemy} = setup();
  actor.skills.push('limited');
  state.skills.limited = { name:'限次攻击', ap:1, slot:'attack', range:3, shape:'single', target:'enemy',
    damage:{count:1,sides:4,stat:'str',type:'true'},
    effects:[expr('once','active','hitTarget',[{kind:'damage',flat:5}],{roll:{chance:0},params:{usesPerBattle:2,cooldown:2}})] };
  const cast = {...strike,type:'skill',skillId:'limited'};
  assert.equal(preview(state,cast).usesLeft,2);
  assert.equal(preview(state,{...cast,x:actor.x,y:actor.y}).ok,false);
  assert.equal(actor.effectUsage,undefined);
  applyAction(state,cast);
  assert.deepEqual(actor.effectUsage['skill-limited:once'],{count:1,round:1});
  const cooling = preview(state,cast);
  assert.equal(cooling.ok,false);
  assert.equal(cooling.usesLeft,1);
  assert.equal(cooling.cooldownRemaining,2);
  state.round+=2; actor.ap=2; actor.used={action:0,attack:0};
  assert.equal(preview(state,cast).ok,true);
  applyAction(state,cast);
  assert.equal(preview(state,cast).usesLeft,0);
  assert.ok(enemy.hp>0);
  validateState(state);
});

test('按名称映射的效果对象保留主动表达式和次数限制', () => {
  const effect = { trigger:'active', target:'self', params:{usesPerBattle:3}, effects:[{kind:'heal',amount:5}] };
  const warnings = [];
  const [mapped] = mapEffects({突进:effect}, 'skill', warnings);
  assert.deepEqual(warnings, []);
  const {id, ...body} = mapped;
  assert.deepEqual(body, effect);
  assert.equal(mapEffects({突进:effect})[0].id, id);
  assert.equal(mapEffects({dash:{...effect,id:'explicit'}})[0].id,'explicit');
});

test('on_equip 缺省每战一次，显式 null 允许再次触发', () => {
  for (const [params, expected] of [[{},1],[{usesPerBattle:null},2]]) {
    const {state, actor} = setup([expr('equip','on_equip','self',[{kind:'heal',amount:1}],{params})]);
    actor.hp=actor.maxHp-3;
    const hp=actor.hp;
    syncEquipmentEffects(state);
    syncEquipmentEffects(state);
    assert.equal(actor.hp-hp,expected);
  }
});

test('G55/G56 death, corpse isolation and resurrection', () => {
  const { state, actor, enemy } = setup();
  enemy.hp = 1;
  applyAction(state, strike);
  assert.deepEqual(enemy.diedAt, { round: 1, turn: 0 });
  assert.ok(corpses(state).includes(enemy));
  assert.ok(!living(state).includes(enemy));
  assert.equal(grantStatus(state, enemy, 'haste'), null);
  assert.equal(preview(state, strike).ok, false);
  state.skills.necromancy = { name: '复生', ap: 1, slot: 'action', range: 3, shape: 'single', target: 'corpse', effects: [expr('raise', 'active', 'corpse', [{ kind: 'raiseDead', statScale: .5 }], { params: { usesPerBattle: 1 } })] };
  actor.skills.push('necromancy');
  applyAction(state, { ...strike, type: 'skill', skillId: 'necromancy' });
  const raised = living(state).find(u => u.corpseOf === enemy.id);
  assert.equal(raised.name, enemy.name);
  assert.equal(raised.team, actor.team);
  assert.equal(raised.maxHp, 500);
  assert.equal(enemy.corpseConsumed, true);
  assert.ok(!corpses(state).includes(enemy));
  validateState(JSON.parse(JSON.stringify(state)));
  console.log('G55/G56', JSON.stringify({ diedAt: enemy.diedAt, corpseConsumed: enemy.corpseConsumed, raised: { name: raised.name, hp: raised.hp, team: raised.team } }));
});

test('G58/G59 tp hydration and night effect', () => {
  const tp = clock => `<tp>复兴纪元488年-10月-14日-星期四-${clock} @ 城区 08:15</tp>`;
  const { state } = hydrateFromSources({ task: tp('11:25') }, { throwOnValidation: true });
  assert.deepEqual(state.time, { raw: '复兴纪元488年-10月-14日-星期四-11:25', hour: 11, minute: 25, timeOfDay: 'day', calendar: '复兴纪元488年-10月-14日-星期四' });
  for (const [clock, value] of [['04:59','night'],['05:00','dawn'],['07:59','dawn'],['08:00','day'],['16:59','day'],['17:00','dusk'],['19:29','dusk'],['19:30','night']]) assert.equal(parseBattleTime(tp(clock)).timeOfDay, value);
  const results = {};
  for (const clock of ['11:25','22:30']) {
    const { state } = setup([expr('moon', 'on_hit', 'hitTarget', [{ kind: 'damage', amount: 40 }], { condition: { type: 'timeOfDay', value: 'night' } })]);
    state.time = parseBattleTime(tp(clock));
    results[clock] = applyAction(state, strike).filter(log => log.detail.effectId === 'moon').map(log => log.detail.amount);
  }
  assert.deepEqual(results, { '11:25': [], '22:30': [40] });
  console.log('G58/G59', JSON.stringify({ time: state.time, results }));
});

test('G60/G61 combined and opposed saves', () => {
  for (const mode of ['all','any','contest']) {
    const save = fx('save-gate', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'stun' }], { roll: mode === 'contest' ? { contest: { attacker: 'str', defender: 'con', dc: 10 } } : { save: ['str','con'], dc: 20, mode } });
    const { state, actor, enemy } = setup([save]);
    Object.assign(enemy.stats, { str: 50, con: -20 }); actor.stats.str = 50;
    validateState(state);
    const { detail } = applyAction(state, strike).find(log => log.type === 'save');
    assert.equal(detail.saved, mode === 'any');
    assert.equal(!!enemy.statuses.stun, mode !== 'any');
    if (mode === 'contest') { assert.equal(detail.contest.attack.saveBonus, 50); assert.equal(detail.contest.defense.saveBonus, -20); }
    else assert.deepEqual(detail.checks.map(check => check.saved), [true, false]);
    console.log(mode === 'contest' ? 'G61' : 'G60', JSON.stringify(detail));
  }
});

test('DSL area resolves each affected unit once and applies school scaling', () => {
  const { state, actor, enemy } = setup([expr('divine_power', 'passive', 'self', [{ kind: 'modifyStat', stat: 'skillPower', percent: .2 }], { condition: { type: 'skillSchool', value: 'divine' } })]);
  const second = structuredClone(enemy);
  Object.assign(second, { id: 'second_scout', x: enemy.x, y: enemy.y + 1, weapon: null, gear: [] });
  state.units[second.id] = second;
  state.order.push(second.id);
  state.grid[second.y][second.x] = { kind: 'floor', z: 0 };
  state.skills.area_test = { name: '范围测试', school: 'divine', ap: 1, slot: 'action', range: 3, shape: 'circle', radius: 1, target: 'enemy', effects: [expr('area_damage', 'active', 'hitTarget', [{ kind: 'damage', amount: 100 }], { params: { usesPerBattle: 1 } })] };
  actor.skills.push('area_test');
  const hits = applyAction(state, { ...strike, type: 'skill', skillId: 'area_test' }).filter(log => log.detail.effectId === 'area_damage');
  assert.deepEqual(hits.map(log => [log.detail.targetId, log.detail.amount]).sort(), [[enemy.id, 120], [second.id, 120]].sort());
  assert.equal(actor.effectUsage['skill-area_test:area_damage'].count, 1);
});

test('DSL active damage is included in skill preview and matches execution', () => {
  const { state, actor, enemy } = setup();
  state.skills.dsl_preview_damage = {
    name: 'DSL 预览伤害', ap: 1, slot: 'attack', range: 2, shape: 'single', target: 'enemy',
    power: 100, effects: [expr('preview_damage', 'active', 'hitTarget', [
      { kind: 'damage', percentOfPower: 1.2, damageType: 'energy' },
    ])], damageType: 'energy',
  };
  actor.skills.push('dsl_preview_damage');
  actor.x = enemy.x; actor.y = enemy.y - 1;
  const action = { type: 'skill', skillId: 'dsl_preview_damage', x: enemy.x, y: enemy.y };
  const plan = preview(state, action);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.targets[0].damage, [120, 120]);
  const hpBefore = enemy.hp;
  applyAction(state, action);
  const damageLog = state.logs.slice(-10).find(log => log.type === 'damage' && log.detail?.effectId === 'preview_damage');
  assert.ok(damageLog);
  assert.equal(damageLog.detail.amount, hpBefore - enemy.hp);
  assert.equal(damageLog.detail.amount, plan.targets[0].damage[0]);
});

test('伤害类型限定状态减伤，真伤穿过减伤但仍消耗护盾', () => {
  for (const [type, expected] of [['physical', 9], ['energy', 67], ['mental', 67], ['true', 97]]) {
    const { state, actor, enemy } = setup();
    enemy.armor = 0;
    enemy.statuses.typed = { modifiers: { damageType: 'physical', armor: 8, reduction: .5 }, stacks: 1 };
    enemy.statuses.general = { modifiers: { reduction: .2 }, stacks: 1 };
    enemy.statuses.shield = { id: 'shield', name: '护盾', modifiers: {}, amount: 3, stacks: 1 };
    enemy.gear.push('test-armor');
    state.items['test-armor'] = { id: 'test-armor', templateId: 'test-armor', counters: {} };
    state.equipment['test-armor'] = { name: '测试护甲', effects: [expr('flat-reduction', 'passive', 'self', [{ kind: 'modifyStat', stat: 'damageReductionFlat', flat: 10 }])] };
    state.skills.typed_damage = {
      name: '伤害类型测试', ap: 1, slot: 'attack', range: 2, shape: 'single', target: 'enemy',
      effects: [expr('typed-packet', 'active', 'hitTarget', [{ kind: 'damage', flat: 100, damageType: type }])],
    };
    actor.skills.push('typed_damage');
    actor.x = enemy.x; actor.y = enemy.y - 1;
    const action = { type: 'skill', skillId: 'typed_damage', x: enemy.x, y: enemy.y };
    const plan = preview(state, action);
    assert.equal(plan.ok, true, plan.error);
    assert.deepEqual(plan.targets[0].damage, [expected, expected], type);
    const before = enemy.hp;
    applyAction(state, action);
    assert.equal(before - enemy.hp, expected, type);
    assert.equal(enemy.statuses.shield, undefined);
  }
});

test('AI considers DSL healing and shields across learned, equipment and backpack skills', () => {
  for (const source of ['learned', 'equipment', 'backpack']) {
    const node = source === 'equipment' ? {kind:'shield',amount:1000} : {kind:'heal',amount:1000};
    const effect = expr('support', 'active', 'self', [node], {params:{usesPerBattle:1}});
    const {state, actor} = setup(source === 'equipment' ? [effect] : []);
    actor.hp = Math.floor(actor.maxHp / 2);
    let skillId = 'support_test';
    if (source === 'equipment') {
      [[skillId]] = equippedActiveSkills(state, actor);
      grantStatus(state, actor, 'shield', {amount:10});
    } else {
      state.skills[skillId] = {name:'支援测试',ap:1,slot:'action',range:0,shape:'single',target:'self',effects:[effect]};
      if (source === 'learned') actor.skills.push(skillId);
      else {
        state.skills[skillId].backpackItem = true;
        actor.inventory = {[skillId]:1};
      }
    }
    const cast = {type:'skill',skillId,x:actor.x,y:actor.y};
    const before = structuredClone(state);
    const [{heal,shieldGain}] = preview(state,cast).support;
    assert.equal(heal, source === 'equipment' ? 0 : actor.maxHp - actor.hp);
    assert.equal(shieldGain, source === 'equipment' ? 990 : 0);
    assert.deepEqual(chooseAction(state),cast);
    assert.deepEqual(state,before);
    applyAction(state,cast);
    if (source === 'equipment') assert.equal(actor.statuses.shield.amount,1000);
    else assert.equal(actor.hp,actor.maxHp);
    if (source === 'backpack') assert.equal(actor.inventory[skillId],0);
    assert.notDeepEqual(chooseAction(state),cast);
  }
});

test('DSL active equipment, chain, proc, cooldown and serialization', () => {
  const active = expr('active_test', 'active', 'self', [{ kind: 'chainEffect', effects: [
    { kind: 'drainResource', resource: 'hp', amount: 12, minimumRemaining: 1, requireFull: true },
    { kind: 'restoreResource', resource: 'mp', percentOfPrevious: .5 },
    { kind: 'procEffect', ref: 'crystal' },
  ] }], { roll: { dice: 'd20', gte: 1 }, params: { usesPerBattle: 1, cooldown: 2 } });
  const { state, actor } = setup([active]);
  actor.mp = 0;
  state.effectTemplates = { crystal: expr('crystal', 'active', 'self', [{ kind: 'addItem', itemId: 'soul_crystal' }]) };
  validateState(state);
  const [[key]] = equippedActiveSkills(state, actor);
  applyAction(state, { type: 'skill', skillId: key, x: actor.x, y: actor.y });
  assert.equal(actor.mp, Math.min(actor.maxMp, 6));
  assert.equal(actor.inventory.soul_crystal, 1);
  assert.equal(preview(state, { type: 'skill', skillId: key }).ok, false);
  validateState(JSON.parse(JSON.stringify(state)));
  state.effectTemplates.crystal.effects.push({ kind: 'procEffect', ref: 'active_test' });
  assert.throws(() => validateState(state), /循环引用/);
});
