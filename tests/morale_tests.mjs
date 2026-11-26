import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBattleDescriptor } from '../src/tavern/descriptor.js';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { validateState } from '../src/api/validation.js';
import { applyAction, preview, refreshOutcome, grantStatus, settleTurn } from '../src/core/combat.js';
import { chooseAction } from '../src/core/ai.js';
const fixture = () => hydrateFromSources({battleInit:parseBattleDescriptor('battle|1|test|试炼|flat|42|战斗类型=切磋\nunit|p|blue|mvu:主角|旅人|1,1\nunit|e|red|char_info|守卫|2,1\nunit|f|red|char_info|剑士|3,1'),mvu:{主角:{属性:{敏捷:30},生命值:{当前:100,上限:100}}},charInfo:[{名称:'守卫',hp:100},{名称:'剑士',hp:100}]},{throwOnValidation:true}).state;
function nextRound(s) {const r=s.round;while(s.round===r)applyAction(s,{type:'end'});}
test('整场类型传入，主角豁免，自动动摇与恢复均不耗骰、不重复播报',()=>{
  const s=fixture(),{p,e,f}=s.units;
  assert.equal(p.protagonist,true);assert.equal(e.moraleType,'spar');assert.equal(f.moraleType,'spar');
  const rng=s.rng;p.hp=e.hp=35;nextRound(s);assert.equal(s.rng,rng);
  assert.equal(p.moraleState,undefined);assert.equal(e.moraleState,'shaken');
  nextRound(s);assert.equal(s.logs.filter(l=>l.type==='morale').length,1);
  e.hp=e.maxHp;nextRound(s);const logs=s.logs.filter(l=>l.type==='morale');assert.deepEqual(logs.map(l=>[l.detail.outcome,l.detail.roll]),[['shaken',null],['steady',null]]);assert.equal(s.rng,rng);
  e.moraleType='未知';assert.throws(()=>validateState(s));e.moraleType='standard';e.moraleState='panic';assert.throws(()=>validateState(s));
});
test('control policy locks morale and permits friendly and self attack targets', () => {
  const state = fixture();
  const { p, e } = state.units;
  const selfAttack = { type: 'attack', x: p.x, y: p.y };
  assert.equal(preview(state, selfAttack).ok, false);
  p.mods = [{ controlPolicy: { allowFriendlyTarget: true } }];
  const result = preview(state, selfAttack);
  assert.equal(result.ok, true);
  assert.equal(result.targets[0]?.id, p.id);
  e.mods = [{ controlPolicy: { moraleLock: 'steady' } }];
  e.hp = 35;
  e.moraleState = 'shaken';
  nextRound(state);
  assert.equal(e.moraleState, 'steady');
  nextRound(state);
  assert.equal(state.logs.filter(log => log.type === 'morale' && log.actor === e.id).length, 1);
});

test('切磋严格低于三成才退场，包含主角，保留实际余血且不重复记录',()=>{
  const s=fixture(),{p,e}=s.units;
  p.hp=30;e.hp=29;refreshOutcome(s);assert.ok(!p.fled);assert.equal(e.fled,true);assert.equal(e.hp,29);assert.equal(s.outcome,null);
  p.hp=1;refreshOutcome(s);assert.equal(p.hp,1);assert.equal(s.outcome,'red');
  assert.equal(s.logs.filter(l=>l.type==='yield' && l.text.includes('切磋退场')).length,2);
  assert.ok(!s.logs.some(l=>['defeat','flee'].includes(l.type)));
});
test('切磋可叫停，竞技可认输，压制与守卫可在双方仍存活时结算',()=>{
  for (const [type,outcome] of [['spar','draw'],['arena','red'],['suppress','blue'],['guard','blue']]) {
    const s=fixture();s.battleType=type;if(type==='suppress')s.suppressingTeam='blue';s.turn=s.order.indexOf('p');s.units.p.ap=2;
    if (['spar','arena'].includes(type)) applyAction(s,{type:'end_encounter'});
    else {assert.equal(preview(s,{type:'end_encounter'}).ok,false); if(type==='guard')s.round=5;else for(const u of [s.units.e,s.units.f]) grantStatus(s,u,'suppressed',{sourceId:'p', vars:{holdTotal:25}});if(type==='guard') nextRound(s);else refreshOutcome(s);}
    assert.equal(s.outcome,outcome);assert.ok(s.battleConclusion);validateState(s);
  }
});
test('竞技双方非致死，压制战双方都可致死',()=>{
  for(const [type,side,shouldLive] of [['arena',null,true],['suppress','blue',false],['suppress','red',false]]) {
    const s=fixture(),{p,e}=s.units;s.battleType=type;if(side)s.suppressingTeam=side;
    s.skills.test={name:'测试攻击',range:2,ap:1,slot:'attack',shape:'single',target:'enemy',rules:[{id:'blast',hook:'active',program:[{op:'damage',target:'target',amount:1000,damageType:'true'}]}]};
    p.skills.push('test');s.turn=s.order.indexOf('p');p.ap=2;p.used={action:0,attack:0};
    e.hp=29;refreshOutcome(s);assert.ok(!e.fled);applyAction(s,{type:'skill',skillId:'test',x:e.x,y:e.y});
    assert.equal(e.hp,shouldLive?1:0);assert.equal(!!e.fled,shouldLive);validateState(s);
  }
  const body='battle|1|test|测试|flat|战斗类型=压制';const unit='\nunit|p|blue|mvu:主角|旅人|1,1';
  assert.throws(()=>parseBattleDescriptor(body+unit),/压制方/);assert.equal(parseBattleDescriptor(body+'|压制方=red'+unit).suppressingTeam,'red');
});
test('压制先命中再对抗，存储原点数，挣脱与边界逃跑、死亡结局',()=>{
  const s=fixture(),{p,e,f}=s.units;s.battleType='suppress';s.suppressingTeam='blue';s.turn=s.order.indexOf('p');p.ap=2;p.used={attack:0,action:0};p.stats.str=22;
  assert.match(preview(s,{type:'flee'}).error,/边界/);p.y=0;assert.equal(preview(s,{type:'flee'}).ok,true);p.y=1;
  const a={type:'suppress',x:e.x,y:e.y};assert.equal(preview(s,{...a,x:f.x}).ok,false);
  for(let seed=1;seed<1000;seed++){s.rng=seed;const copy=structuredClone(s);applyAction(copy,a);if(copy.units.e.statuses.suppressed)break;}
  applyAction(s,a);assert.equal(e.hp,e.maxHp);const hold=e.statuses.suppressed.vars.holdTotal;assert.ok(hold>22);validateState(s);
  const counter=fixture();counter.battleType='suppress';counter.suppressingTeam='blue';counter.turn=counter.order.indexOf('p');Object.assign(counter.units.p,{ap:2,used:{action:0,attack:0}});counter.rng=seedForHit(s);counter.units.p.stats.str=-20;counter.units.e.stats.str=50;
  function seedForHit(){for(let n=1;n<1000;n++){const c=structuredClone(counter);c.rng=n;c.units.p.stats.str=-20;c.units.e.stats.str=50;applyAction(c,a);if(c.units.p.statuses.stun)return n;}throw Error('no counter seed');}
  applyAction(counter,a);assert.equal(counter.units.p.statuses.stun.remainingTurns,1);assert.ok(!counter.units.e.statuses.suppressed);
  s.turn=s.order.indexOf('e');e.stats.str=11;e.hp=25;e.stats.con=50;p.stats.str=0;settleTurn(s);const check=s.logs.findLast(l=>l.type==='break_hold');assert.equal(check.detail.total,check.detail.roll+2);assert.equal(e.statuses.suppressed.vars.holdTotal,hold);e.stats.str=50;e.hp=e.maxHp;s.turn=s.order.indexOf('e');settleTurn(s);assert.equal(e.statuses.suppressed,undefined);
  grantStatus(s,e,'suppressed',{sourceId:'p', vars:{holdTotal:hold}});
  const allDead=structuredClone(s);allDead.units.e.hp=allDead.units.f.hp=0;refreshOutcome(allDead);assert.equal(allDead.outcome,'red');assert.match(allDead.battleConclusion,/蓝方过失致死，压制失败/);
  f.hp=0;refreshOutcome(s);assert.equal(s.outcome,'blue');assert.match(s.battleConclusion,/蓝方压制成功，过失致死：剑士/);
});
test('抵抗方移动后可花攻击槽解救相邻队友，不掷骰、不赠额外回合',()=>{
  const s=fixture(),{e,f}=s.units;s.battleType='suppress';s.suppressingTeam='blue';
  s.turn=s.order.indexOf('f');f.ap=2;f.used={attack:0,action:0};f.x=4;
  grantStatus(s,e,'suppressed',{sourceId:'p', vars:{holdTotal:25}});
  const rescue={type:'free_ally',targetId:e.id,x:e.x,y:e.y};assert.equal(preview(s,rescue).ok,false);
  const move=chooseAction(s);assert.equal(move.type,'move');applyAction(s,move);
  assert.deepEqual(chooseAction(s),rescue);assert.equal(preview(s,rescue).slot,'attack');
  const rng=s.rng, ap=e.ap;applyAction(s,rescue);assert.equal(e.statuses.suppressed,undefined);assert.equal(e.ap,ap);assert.equal(s.rng,rng);assert.equal(f.used.attack,1);
  assert.ok(s.logs.some(l=>l.type==='free_ally' && l.text.includes('剑士为守卫解除压制')));
});

test('溃逃 AI 进行逃跑对抗，队友在场不直接判负；处决评级有保底',()=>{
  const s=fixture(),{p,e}=s.units;e.moraleState='routed';
  s.turn=s.order.indexOf('p');p.used={action:0,attack:0};p.ap=2;
  const atk={type:'attack',intent:'kill',x:e.x,y:e.y};assert.equal(preview(s,atk).targets[0].execution,true);
  assert.equal(preview(s,{...atk,intent:'normal'}).targets[0].execution,false);
  const copy=structuredClone(s);applyAction(copy,atk);const roll=copy.logs.findLast(l=>l.type==='roll');assert.equal(roll.detail.execution,true);if(roll.detail.hit)assert.ok(roll.detail.rating.multiplier>=1.3);
  s.turn=s.order.indexOf('e');e.ap=2;e.used={action:0,attack:0};e.stats.agi=100;
  for (const type of ['standard','arena','spar','suppress','deathmatch','guard']) {
    s.battleType=type;assert.match(preview(s,{type:'flee'}).error,/边界/);
  }
  const move=chooseAction(s);assert.equal(move.type,'move');applyAction(s,move);assert.ok(!e.fled);assert.equal(preview(s,{type:'flee'}).ok,true);
  const escape=chooseAction(s);assert.equal(escape.type,'flee');applyAction(s,escape);assert.equal(e.fled,true);assert.equal(s.outcome,null);
});
