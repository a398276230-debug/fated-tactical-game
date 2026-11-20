import { STATUSES } from '../core/combat.js';
const attributes = {str:'力量',agi:'敏捷',con:'体质',int:'智力',spi:'精神'};
const types = {physical:'物理',energy:'能量',mental:'精神',true:'真实'};
const when = {passive:'被动',active:'主动',on_hit:'命中时',on_attack:'攻击时',on_skill_cast:'施放时',on_damaged:'受伤时',on_heal:'治疗时',on_turn_start:'回合开始',on_turn_end:'回合结束',on_kill:'击倒时',on_death:'倒下时',on_equip:'装备时',on_ally_death:'队友倒下时'};
const verbs={heal:'治疗',modifyStat:'属性修正',modifyCheck:'检定修正',restoreResource:'恢复资源',drainResource:'消耗资源',produceResource:'获得资源',removeStatus:'移除状态',shield:'护盾',knockback:'击退',teleportBackstab:'瞬移背刺',execute:'斩杀',raiseDead:'复生',chainEffect:'效果链',procEffect:'触发效果',addItem:'获得物品',upgradeHitTier:'提升命中评级',forceOutcome:'强制判定',multiplyDamage:'伤害倍率',modifyDamageBase:'基础伤害',summon:'召唤'};
export function effectSummary(expr,state) {
  const status = id=>state?.statusTemplates?.[id]?.name ?? STATUSES[id]?.name ?? id;
  const node = n => (n.enabled===false?'[已关闭] ':'')+(n.kind==='damage'?['伤害',n.percentOfPower!=null?`威力${Math.round(n.percentOfPower*100)}%`:n.amount??n.flat,types[n.damageType]].filter(v=>v!=null).join(' '):n.kind==='grantStatus'?`施加 ${status(n.statusId)}${n.turns?` ${n.turns} 回合`:''}`:n.kind==='chainEffect'?n.effects.map(node).join('，'): [verbs[n.kind]??'效果',n.label??attributes[n.stat]??n.stat??n.resource??'',n.amount??n.flat??n.factor??(n.percent!=null?`${n.percent*100}%`:'')].filter(v=>v!=='').join(' '));
  const roll=expr.roll;
  return `${when[expr.trigger]??'触发'}${roll?.dice?` ${roll.dice}≥${roll.gte}`:roll?.save?' 豁免失败':roll?.chance!=null?` ${Math.round(roll.chance*100)}%`:''} → ${(expr.effects??[]).map(node).join('；')}`;
}
export function fillInstance(box,make,unit,state,raw,select) {
  const line=(tag,cls,value)=>make(tag,{class:cls},value);
  const header=line('div','fated-char-heading'), title=make('div');
  title.append(line('strong','fated-char-name',unit.name??unit.id),line('small','fated-source-label',unit.source??'AI 编辑'));header.append(title,select);box.append(header);
  const stats=line('dl','fated-char-stats');
  for(const [key,name] of Object.entries(attributes)){const pair=make('div');pair.append(make('dt',{},name),make('dd',{},unit.stats?.[key]??'—'));stats.append(pair);}box.append(stats);
  const resources=line('p','fated-char-resources');for(const key of ['hp','mp','sp']){const max=unit['max'+key[0].toUpperCase()+key.slice(1)],v=unit[key];const cell=make('span',{},`${key.toUpperCase()} ${v??'—'} / ${max??'—'}`);cell.style.setProperty('--fill',`${max?Math.min(100,Math.max(0,v/max*100)):0}%`);resources.append(cell);}box.append(resources);
  const section=(title,rows)=>{box.append(make('h5',{},title));if(!rows.length)box.append(line('p','fated-mini',`暂无${title}`));for(const [title,template] of rows){const row=make(template?.effects?.length?'details':'div',{class:'fated-char-row'});row.append(make(template?.effects?.length?'summary':'span',{},title));for(const fx of template?.effects??[])row.append(line('p','fated-mini',effectSummary(fx,state)));box.append(row);}};
  const wear=[['主手',unit.mainHand??unit.weapon],['副手',unit.offHand],['盾牌',unit.shield],...(unit.gear??[]).map(id=>['穿戴',id])];
  const gear=wear.filter(([,id])=>id).map(([slot,id])=>{const item=state?.items?.[id],t=state?.equipment?.[item?.templateId]??unit.equipment?.find(e=>e.id===id)?.template;const d=t?.damage;return [`[${slot}] ${t?.name??id} · 攻击 ${t?.attack??'—'} · 距离 ${t?.range??'—'}${d?` · ${d.count}d${d.sides}${d.bonus?` ${d.bonus>0?'+':''}${d.bonus}`:''}${d.stat?` + ${attributes[d.stat]??d.stat}`:''} ${types[d.type]??''}`:''}`,t];});section('装备',gear);
  const skills=(unit.skills??[]).map(id=>{const t=state?.skills?.[id];const damage=[...new Set([t?.damage?.type,t?.damageType,...(t?.effects??[]).flatMap(e=>e.effects.filter(n=>n.kind==='damage').map(n=>n.damageType)),unit.skillInfo?.[id]?.damageType].filter(Boolean))].map(type=>types[type]).join('/');return [`${t?.name??id} · 消耗 ${t?.resourceCost?.sp??t?.sp??0} SP${(t?.resourceCost?.mp??t?.mp)?` / ${t.resourceCost?.mp??t.mp} MP`:''}${t?.resourceCost?.hp?` / ${t.resourceCost.hp} HP`:''} · 威力 ${t?.power??'—'} · ${damage||'无伤害类型'} · 距离 ${t?.range??'—'}`,t];});section('技能',skills);
  const details=make('details',{class:'fated-char-raw'});details.append(make('summary',{},'原始数据'),make('pre',{},JSON.stringify({instance:unit,source:raw,equipment:gear.map(r=>r[1]),skills:skills.map(r=>r[1])},null,2)));box.append(details);
}
