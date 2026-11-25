import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { hydrateFromSources } from '../src/tavern/converter.js';
import { isPassiveSkill } from '../src/core/combat.js';
import { parseAIResponse } from '../src/tavern/overlay-ai.js';
import { fingerprintAt, partitionNormalizationPatch, parseJSONPatch } from '../src/tavern/overlay-patch.js';
import { normalizationOperations } from '../src/tavern/normalization-batches.js';
import { readUnresolvedDiagnostics, resolvedDiagnostics } from '../src/tavern/resolved-warnings.js';

const mvu = JSON.parse(readFileSync(new URL('./fixtures/enmosolen_mvu.json', import.meta.url)));
const [enmo, kaos] = Object.keys(mvu.关系列表);
const battleInit = `battle|1|test|入口|flat|12345\nunit|enmo|blue|mvu:关系列表/${enmo}|${enmo}|2,4\nunit|kaos|red|mvu:关系列表/${kaos}|${kaos}|3,4`;
test('原卡两名 MVU 角色：纯被动、混合技、勋章、独立长阶与面板', () => {
  const {state, roster, warnings, entrySources} = hydrateFromSources({mvu,battleInit},{throwOnValidation:true});
  assert.deepEqual(Object.keys(state.units), ['enmo','kaos']);
  for (const [id,name,n,hp,mp,sp,stats] of [['enmo',enmo,22,52073,120000,120000,[15,15,13,15,15]],['kaos',kaos,7,504073,112000,108000,[14,13,18,14,14]]]) {
    const unit = state.units[id];
    assert.deepEqual(['str','agi','con','int','spi'].map(k=>unit.stats[k]),stats);
    assert.deepEqual([unit.hp,unit.maxHp,unit.mp,unit.maxMp,unit.sp,unit.maxSp,unit.tier,roster.find(r=>r.id===id).level],[hp,hp,mp,mp,sp,sp,6,24]);
    assert.equal(unit.skills.length,n);
    for (const sid of unit.skills) {
      const skill=state.skills[sid], raw=mvu.关系列表[name].技能[skill.name];
      if (raw?.类型==='被动' || skill.name==='未授之勋') {
        assert.ok(isPassiveSkill(skill)); assert.equal(skill.ap,0); assert.equal(skill.damage,undefined); assert.ok(!skill.rules.some(r=>r.hook==='active'));
      } else if (raw?.类型==='主动/被动') assert.equal(isPassiveSkill(skill),false);
      if (['双生冥影法则','未授之勋'].includes(skill.name)) {
        assert.ok(entrySources[id][`skills:${sid}`]); assert.equal(warnings.filter(w=>w.originPath===`/skills/${sid}`).length,skill.name==='未授之勋'?3:2);
      }
    }
    assert.ok(unit.skills.some(sid=>state.skills[sid].name==='双生冥影法则'));
  }
  const u=state.units.enmo; assert.ok(u.skills.some(s=>state.skills[s].name==='未授之勋')); assert.equal(u.inventory,undefined);
  const equip=id=>state.equipment[state.items[id].templateId].name;
  assert.equal(equip(u.mainHand),'断罪残圣·蚀界魔剑'); assert.deepEqual(u.gear.map(equip),['星弧裂空之戒','格诺克的永叹冥甲']);
  assert.equal(state.skills[u.skills.find(s=>state.skills[s].name==='冥闪星坠斩')].initiativeBonus,8);
});
test('结构化距离、范围、伤害、先手与未开启的长阶',()=>{
  const input=structuredClone(mvu), r=input.关系列表[enmo];
  r.登神长阶.是否开启=false; r.技能={试验:{类型:'主动',距离:'远程(9)',范围:'中程(4)+扇(敌方)',威力:40,伤害:'物理',先手:6},被动:{type:'passive',效果:'造成5点真实伤害'}};
  const {state,warnings}=hydrateFromSources({mvu:input,battleInit},{throwOnValidation:true});
  const skills=state.units.enmo.skills.map(id=>state.skills[id]); assert.ok(!skills.some(s=>s.name==='双生冥影法则'));
  const s=skills.find(s=>s.name==='试验'); assert.deepEqual([s.rawRange,s.rawRadius,s.shape,s.initiativeBonus,s.damageType,s.power],[9,4,'fan',6,'physical',40]);
  const p=skills.find(s=>s.name==='被动'); assert.ok(isPassiveSkill(p));assert.deepEqual(p.rules,[]); assert.ok(warnings.some(w=>w.message.includes('造成5点真实伤害')));
});
test('声明先于子路径；无关坏操作不拖垮互相依赖的声明',()=>{
  const state={skills:{},statusTemplates:{}}, add=(path,value)=>({op:'add',path,value});
  const ops=[add('/skills/a/rules/-','b'),add('/skills/a',{rules:[],requires:'b'}),add('/statusTemplates/b',{requires:'a'}),add('/skills/bad',{invalid:true})];
  const r=partitionNormalizationPatch({liveState:state,baselineState:state,rawPatch:ops,validate:s=>{assert.ok(!s.skills.bad);assert.equal(!!s.skills.a,!!s.statusTemplates.b);}});
  assert.deepEqual(r.rejected.map(i=>i.index),[3]); assert.deepEqual(r.workLive.skills.a.rules,['b']); assert.deepEqual(r.workLive,r.workBase);
});
test('并发追加可合并，但不对已改变的数组重放索引',()=>{
  const s={skills:{a:{rules:[1]}}}, c={skills:{a:{rules:[1,2]}}}, append={op:'add',path:'/skills/a/rules/-',value:3};
  assert.deepEqual(normalizationOperations([append],s,c,new Map(),fingerprintAt),[append]);
  assert.throws(()=>normalizationOperations([{...append,path:'/skills/a/rules/0'}],s,c,new Map(),fingerprintAt));
});
test('共享模板的机制冲突隔离消费者，但独立写入仍可应用',()=>{
  const state={skills:{s:{},other:{}},statusTemplates:{ice:{name:'冰',rules:[1]}}};
  const create={op:'add',path:'/statusTemplates/ice',value:{name:'冰',rules:[2]}};
  assert.throws(()=>normalizationOperations([create],state,state,new Map([[create.path,JSON.stringify(state.statusTemplates.ice)]]),fingerprintAt),/冲突/);
  const ops=[{op:'add',path:'/skills/s/rules',value:[{statusId:'ice'}]},{op:'add',path:'/skills/other/rules',value:[]}];
  const r=partitionNormalizationPatch({liveState:state,baselineState:state,rawPatch:ops,conflictingDefinitions:[create.path]});
  assert.deepEqual(r.accepted.map(i=>i.index),[1]); assert.deepEqual(r.rejected.map(i=>i.index),[0]);
});
test('拒绝括号错配的最终回复，不能截取内嵌的操作作为补丁',()=>{
  const s='<think>{"patch":[]}</think><\n{"patch":[{"op":"add","value":[{}]}}],"unresolved":[]}';
  const r=parseAIResponse(s); assert.equal(r.data,null); assert.match(r.parseError,/JSON/);
  assert.deepEqual(parseJSONPatch('```json\n{"patch":[]}\n```'),[]);
});
test('结构化短名唯一匹配；部分实现和欠缺原因不能被核销',()=>{
  const w={unitId:'a',originPath:'/skills/a',message:'效果待标准化「微弱法则[旧骸归烬]」：原文'}, ref={unitId:'a',originPath:'/skills/a',effectName:'旧骸归烬'};
  const op={path:'/skills/a/rules',resolves:[ref]}; assert.deepEqual(resolvedDiagnostics([w],{a:{}},[op]),[w]);
  assert.deepEqual(resolvedDiagnostics([w,{...w,message:w.message+'二'}],{a:{}},[op]),[]);
  const n=readUnresolvedDiagnostics([{...ref,reason:'缺参数'}],[w]); assert.equal(n.matched[0].detail,'缺参数');
  const lock=readUnresolvedDiagnostics([ref],[w]); assert.equal(lock.invalid.length,1); assert.deepEqual(resolvedDiagnostics([w],{a:{}},[op],lock.matched),[]);
  const partial=readUnresolvedDiagnostics([{unitId:'a',originPath:'/skills/a',kind:'missing_info',message:'旧骸归烬的智力缩放系数未提供'}],[w]); assert.match(partial.matched[0].detail,/未提供/);
});
