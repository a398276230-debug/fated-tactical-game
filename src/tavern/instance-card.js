import { bodySizeLabel } from '../core/combat_protocol.js';
import { equippedActiveSkills, STATUSES } from '../core/combat.js';
const attributes = {str:'力量',agi:'敏捷',con:'体质',int:'智力',spi:'精神'};
const types = {physical:'物理',energy:'能量',mental:'精神',true:'真实'};
const when = { active: '主动', after_hit: '命中时', before_action: '行动前', after_damage: '伤害结算后', after_heal: '治疗后', turn_start: '回合开始', turn_end: '回合结束', on_kill: '击倒时', on_death: '倒下时' };
const verbs = { let: '记录数值', if: '条件分支', for_each: '逐个结算', check: '检定', ask: '等待选择', mutate_event: '调整结算', damage: '伤害', heal: '治疗', resource: '调整资源', apply_status: '施加状态', remove_status: '移除状态', move: '位移', spawn: '生成', remove: '移除', perform: '执行行动', link_pool: '调整共享资源' };
export function ruleSummary(rule, state) {
  const statusName = id => state?.statusTemplates?.[id]?.name ?? STATUSES[id]?.name ?? id;
  const describe = op => {
    const prefix = op.enabled === false ? '已关闭：' : '';
    if (op.op === 'apply_status') return `${prefix}施加 ${statusName(op.statusId)}${typeof op.turns === 'number' ? ` ${op.turns} 回合` : ''}`;
    return [prefix + (verbs[op.op] ?? '效果'), types[op.damageType], typeof op.amount === 'number' ? op.amount : null].filter(value => value != null).join(' ');
  };
  return `${rule.enabled === false ? '已关闭：' : ''}${when[rule.hook] ?? '触发'} → ${rule.program.map(describe).join('；')}`;
}
const modLabels = {
  ...attributes, armor:'护甲', armorPierce:'固定穿甲', armorPiercePercent:'百分比穿甲',
  damageFlat:'输出固定伤害', damageMult:'全伤害倍率', finalDamageMult:'最终伤害倍率',
  damageReductionFlat:'受击固定减伤', damageReduction:'受击伤害减免', dr:'受击伤害减免',
  healingMult:'施疗倍率', incomingHealMult:'受疗倍率', costMult:'技能消耗倍率',
  checkBonus:'检定加值', dcBonus:'检定难度', resistBonus:'豁免加值', advantage:'检定优势', initiativeFlat:'先攻',
};
const ratioStats = new Set(['armorPiercePercent','damageReduction','dr']);
const percent = new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:10});
const slots = {action:'动作',attack:'攻击',move:'移动',cast:'施法',reaction:'反应'};
const flags = {preserveLife:'保留生命',blockRevive:'禁止复活',blockResourceRestore:'禁止资源恢复',untargetableSingle:'不可被单体选中',harmless:'无害'};
const checks = {attack:'攻击',save:'豁免',contest:'对抗',d20:'普通',chance:'概率'};
const signed = (n, asPercent) => typeof n === 'number' ? `${n>=0?'+':''}${asPercent?percent.format(n):n}` : `按公式 ${n}`;
function modSummary(mod) {
  const parts = [];
  if(mod.stat){
    const values = [mod.flat!=null?signed(mod.flat,ratioStats.has(mod.stat)):null,
      mod.mult!=null?`×${typeof mod.mult==='number'?mod.mult:`（${mod.mult}）`}`:null,
      mod.additivePercent!=null?signed(mod.additivePercent,true):null].filter(Boolean);
    parts.push([modLabels[mod.stat],...values].join(' '));
  }
  if(mod.locks?.length) parts.push(`禁止${mod.locks.map(slot=>slots[slot]).join('、')}`);
  if(mod.flags?.length) parts.push(...mod.flags.map(flag=>flags[flag]));
  const policy = mod.controlPolicy;
  if(policy?.controller) parts.push(policy.controller==='ai'?'由 AI 控制':'恢复默认控制');
  if(policy?.allegiance) parts.push(({normal:'正常阵营关系',friendly_only:'仅友方',all_hostile:'所有单位视为敌方'})[policy.allegiance]);
  if(policy?.forcedActionKinds?.length) parts.push(`强制行动类型：${policy.forcedActionKinds.map(kind=>kind==='attack'?'攻击':'技能').join('、')}`);
  if(policy?.allowFriendlyTarget != null) parts.push(policy.allowFriendlyTarget?'可选友方为目标':'不可选友方为目标');
  if(policy?.moraleLock==='steady') parts.push('士气恒定坚守');
  const scope = [mod.damageType?`${types[mod.damageType]}伤害`:null,mod.checkKind?`${checks[mod.checkKind]??mod.checkKind}检定`:null].filter(Boolean);
  return `${parts.filter(Boolean).join('；')||'修饰'}${scope.length?`（${scope.join('、')}）`:''}${mod.when!=null?` · 条件：${mod.when===true?'始终':mod.when===false?'从不':mod.when}`:''}`;
}
const RESOURCES = [['hp','HP','maxHp'],['mp','MP','maxMp'],['sp','SP','maxSp']];
const TEAMS = {blue:'我方',red:'敌方'};
const ratio=(v,max)=>max?Math.min(1,Math.max(0,(Number(v)||0)/max)):0;

/**
 * 渲染一张角色实例卡。卡头（头像、名字、标签、迷你资源条、选择框、折叠按钮）始终可见，
 * 其余内容放进返回的 body，折叠时隐藏。调用方可以把诊断和操作按钮追加进 body。
 */
export function fillInstance(box,make,unit,state,raw,select,{collapsed=false,onToggle,warnings=0,count=1,narrative=[],onDiscardEntry,canDiscardEntry}={}) {
  const line=(tag,cls,value)=>make(tag,{class:cls},value);
  const name=unit.name??unit.id;
  box.classList.add('fated-char-card');
  if(unit.team) box.dataset.team=unit.team;

  const header=line('div','fated-char-heading');
  const avatar=line('span','fated-char-avatar',[...String(name)][0]??'?');
  const title=line('div','fated-char-title');
  const nameRow=line('div','fated-char-name-row');
  nameRow.append(line('strong','fated-char-name',name));
  if(count>1) nameRow.append(line('span','fated-char-tag',`×${count}`));
  if(warnings) nameRow.append(make('span',{class:'fated-char-warn',title:`${warnings} 条诊断`},`⚠ ${warnings}`));
  const tags=line('div','fated-char-tags');
  for(const text of [TEAMS[unit.team],unit.tier?`第 ${unit.tier} 层级`:null,`体型 ${bodySizeLabel(unit)}`,unit.source??'AI 编辑']) if(text) tags.append(line('span','fated-char-tag',text));
  title.append(nameRow,tags);
  const mini=line('div','fated-char-mini');
  for(const [key,label,maxKey] of RESOURCES){const bar=make('span',{class:`fated-char-mini-bar is-${key}`,title:`${label} ${unit[key]??'—'} / ${unit[maxKey]??'—'}`});bar.style.setProperty('--ratio',ratio(unit[key],unit[maxKey]));mini.append(bar);}
  const toggle=make('button',{type:'button',class:'fated-char-toggle','aria-expanded':String(!collapsed),'aria-label':`${collapsed?'展开':'折叠'} ${name}`,title:collapsed?'展开':'折叠'},'');
  header.append(avatar,title,mini,select,toggle);
  box.append(header);

  const body=line('div','fated-char-body');
  body.hidden=collapsed;
  box.dataset.collapsed=String(collapsed);
  const setCollapsed=next=>{body.hidden=next;box.dataset.collapsed=String(next);toggle.setAttribute('aria-expanded',String(!next));toggle.title=next?'展开':'折叠';toggle.setAttribute('aria-label',`${next?'展开':'折叠'} ${name}`);onToggle?.(next);};
  toggle.addEventListener('click',()=>setCollapsed(!body.hidden));
  // 点卡头空白处也能折叠，但不抢选择框和按钮的点击
  header.addEventListener('click',e=>{if(e.target===header||e.target===avatar||title.contains(e.target)||mini.contains(e.target))setCollapsed(!body.hidden);});

  const resources=line('div','fated-char-resources');
  for(const [key,label,maxKey] of RESOURCES){
    const max=unit[maxKey],v=unit[key];
    const bar=line('div',`fated-char-bar is-${key}`);
    bar.style.setProperty('--ratio',ratio(v,max));
    // 保留旧的 --fill 百分比，兼容可能依赖它的自定义样式
    bar.style.setProperty('--fill',`${Math.round(ratio(v,max)*100)}%`);
    bar.append(make('i'),line('b','',label),line('span','',`${v??'—'} / ${max??'—'}`));
    resources.append(bar);
  }
  body.append(resources);

  const stats=line('dl','fated-char-stats');
  for(const [key,label] of Object.entries(attributes)){const pair=make('div');pair.append(make('dt',{},label),make('dd',{},unit.stats?.[key]??'—'));stats.append(pair);}
  body.append(stats);

  const section=(heading,rows)=>{
    const block=line('section','fated-char-section');
    block.append(make('h5',{},`${heading}${rows.length?` · ${rows.length}`:''}`));
    if(!rows.length) block.append(line('p','fated-mini',`暂无${heading}`));
    for(const {label,meta,template,path,item} of rows){
      const fx = [...(template?.rules ?? []),...(item?.rules ?? [])];
      const mods = [...(template?.mods ?? []),...(item?.mods ?? [])];
      const grantedSkills = template?.skills ?? [];
      const effectCount = fx.length + mods.length + grantedSkills.length;
      const story = path ? narrative.filter(entry => entry.originPath === path || entry.originPath?.startsWith(`${path}/`)) : [];
      const expandable = effectCount || story.length;
      const row=make(expandable?'details':'div',{class:'fated-char-row'});
      const head=make(expandable?'summary':'div',{class:'fated-char-row-head'});
      head.append(line('span','fated-char-row-name',label));
      for(const m of meta) head.append(line('span','fated-char-chip',m));
      if(effectCount) head.append(line('span','fated-char-fx',`${effectCount} 个效果`));
      if (onDiscardEntry && path && (!canDiscardEntry || canDiscardEntry(path))) {
        const discard = make('button', { type: 'button', class: 'fated-entry-discard', title: '删除此标准化大词条并重新标准化' }, '删除并重roll');
        discard.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onDiscardEntry({ path, label }); });
        head.append(discard);
      }
      row.append(head);
      for(const rule of fx) row.append(line('p','fated-mini',`${rule.label?`${rule.label} · `:''}${ruleSummary(rule,state)}`));
      for(const mod of mods) row.append(line('p','fated-mini',modSummary(mod)));
      for(const id of grantedSkills) row.append(line('p','fated-mini',`附带技能 · ${state?.skills?.[id]?.name??id}`));
      for(const { message, reason } of story) row.append(make('p',{class:'fated-mini',title:reason},`仅叙事 · ${message}`));
      block.append(row);
    }
    body.append(block);
  };
  const wear=[['主手',unit.mainHand??unit.weapon],['副手',unit.offHand],['盾牌',unit.shield],...(unit.gear??[]).map(id=>['穿戴',id])];
  const shownItems = new Set();
  const gear=[];
  for(const [slot,id] of wear){
    if(!id||shownItems.has(id)) continue;
    shownItems.add(id);
    const item=state?.items?.[id],t=state?.equipment?.[item?.templateId]??unit.equipment?.find(e=>e.id===id)?.template;const d=t?.damage;
    const dice=d?`${d.count}d${d.sides}${d.bonus?` ${d.bonus>0?'+':''}${d.bonus}`:''}${d.stat?` + ${attributes[d.stat]??d.stat}`:''} ${types[d.type]??''}`.trim():null;
    gear.push({label:`[${slot}] ${t?.name??id}`,path:item?.templateId ? `/equipment/${item.templateId}` : null,meta:[t?.attack!=null?`攻击 ${t.attack}`:null,t?.defense?`防御 ${t.defense}`:null,t?.range!=null?`距离 ${t.range}`:null,dice].filter(Boolean),template:t,item});
  }
  section('装备',gear);
  const innate = new Set(unit.skills??[]);
  const skillTemplates = new Map([...innate].map(id=>[id,state?.skills?.[id]]));
  if(state) for(const [id,template] of equippedActiveSkills(state,unit)) if(!skillTemplates.has(id)) skillTemplates.set(id,template);
  const skills=[...skillTemplates].map(([id,t])=>{
    const damage=[...new Set([t?.damage?.type,t?.damageType,...(t?.rules ?? []).flatMap(rule => rule.program.filter(op => op.op === 'damage').map(op => op.damageType)),unit.skillInfo?.[id]?.damageType].filter(Boolean))].map(type=>types[type]).join('/');
    const cost=[`${t?.resourceCost?.sp??t?.sp??0} SP`,(t?.resourceCost?.mp??t?.mp)?`${t.resourceCost?.mp??t.mp} MP`:null,t?.resourceCost?.hp?`${t.resourceCost.hp} HP`:null].filter(Boolean).join(' / ');
    return {label:t?.name??id,path:innate.has(id)||state?.skills?.[id]?`/skills/${id}`:null,meta:[!innate.has(id)?'装备附带':null,t?.passive&&!t.rules?.some(rule=>rule.hook==='active')?'被动':null,`消耗 ${cost}`,`威力 ${t?.power??'—'}`,damage||'无伤害类型',`距离 ${t?.range??'—'}`].filter(Boolean),template:t};
  });
  section('技能',skills);
  const details=make('details',{class:'fated-char-raw'});
  details.append(make('summary',{},'原始数据'),make('pre',{},JSON.stringify({instance:unit,source:raw,equipment:gear.map(r=>r.template),skills:skills.map(r=>r.template)},null,2)));
  body.append(details);
  box.append(body);
  return {body,setCollapsed};
}
