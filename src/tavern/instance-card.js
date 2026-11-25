import { bodySizeLabel, INTENTS } from '../core/combat_protocol.js';
import { equippedActiveSkills, STATUSES } from '../core/combat.js';
const attributes = {str:'力量',agi:'敏捷',con:'体质',int:'智力',spi:'精神'};
const types = {physical:'物理',energy:'能量',mental:'精神',true:'真实'};
const shapes = {single:'单体',circle:'圆形',ring:'环形',cone:'锥形',fan:'扇形',line:'直线'};
const when = { active: '主动', after_hit: '命中时', before_action: '行动前', after_damage: '伤害结算后', after_heal: '治疗后', turn_start: '回合开始', turn_end: '回合结束', on_kill: '击倒时', on_death: '倒下时' };

const displayNumber = value => typeof value === 'number' ? String(value) : typeof value === 'string' ? `按公式 ${value}` : null;
function diceLabel(dice) {
  if (!dice) return null;
  const count = displayNumber(dice.count), sides = displayNumber(dice.sides);
  if (!count || !sides) return null;
  const bonus = dice.bonus ? `${dice.bonus > 0 ? '+' : ''}${dice.bonus}` : '';
  return `${count}d${sides}${bonus}${dice.stat ? ` + ${attributes[dice.stat] ?? dice.stat}` : ''}`;
}
function collectDamageOps(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (Array.isArray(value)) { for (const child of value) collectDamageOps(child, result); return result; }
  if (value.op === 'damage') result.push(value);
  for (const [key, child] of Object.entries(value)) if (key !== 'damage') collectDamageOps(child, result);
  return result;
}

/** Derive only facts that the skill card can prove from the stored template. */
export function skillDisplay(template = {}, skillInfo = {}) {
  const components = [];
  const add = (type, amount, formatted = false) => {
    if (!type || !types[type]) return;
    const suffix = amount == null ? null : formatted ? amount : displayNumber(amount);
    const text = `${types[type]}${suffix ? ` ${suffix}` : ''}`;
    if (!components.includes(text)) components.push(text);
  };
  if (template.damage) add(template.damage.type ?? template.damageType, diceLabel(template.damage), true);
  else if (template.damageType) add(template.damageType);
  for (const rule of template.rules ?? []) {
    if (rule.enabled !== false && rule.hook === 'active') for (const op of collectDamageOps(rule.program)) add(op.damageType, op.amount);
  }
  if (!components.length && skillInfo.damageType && types[skillInfo.damageType]) add(skillInfo.damageType);
  const costs = [['sp', 'SP'], ['mp', 'MP'], ['hp', 'HP']]
    .map(([key, label]) => [label, template.resourceCost?.[key] ?? template[key]])
    .filter(([, value]) => value !== undefined && value !== null && value !== 0 && value !== '0')
    .map(([label, value]) => `${displayNumber(value) ?? value} ${label}`);
  const area = [];
  if (template.shape && template.shape !== 'single') area.push(shapes[template.shape] ?? template.shape);
  if (template.radius != null) area.push(`半径 ${template.radius}`);
  if (template.innerRadius != null) area.push(`内径 ${template.innerRadius}`);
  if (template.width != null) area.push(`宽度 ${template.width}`);
  if (template.angle != null) area.push(`角度 ${template.angle}`);
  return { damage: components.join('、'), costs, range: template.range ?? '—', area: area.join('，') || '单体' };
}
const verbs = { let: '记录数值', if: '条件分支', for_each: '逐个结算', check: '检定', ask: '等待选择', mutate_event: '调整结算', damage: '伤害', heal: '治疗', resource: '调整资源', apply_status: '施加状态', remove_status: '移除状态', move: '位移', spawn: '生成', despawn: '移除', revive: '复活', perform: '执行行动', link_pool: '调整共享资源' };
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
  ...attributes, dodge:'闪避', movement:'移动距离', incomingDistanceOffset:'表观距离', critDamageBonus:'暴击伤害加成', incomingDamageMult:'受击易伤倍率', apMax:'行动点上限', armor:'护甲', armorPierce:'固定穿甲', armorPiercePercent:'百分比穿甲',
  damageFlat:'输出固定伤害', damageMult:'全伤害倍率', finalDamageMult:'最终伤害倍率',
  damageReductionFlat:'受击固定减伤', damageReduction:'受击伤害减免', dr:'受击伤害减免',
  healingMult:'施疗倍率', incomingHealMult:'受疗倍率', costMult:'技能消耗倍率',
  checkBonus:'检定加值', dcBonus:'检定难度', resistBonus:'豁免加值', advantage:'检定优势', initiativeFlat:'先攻', incomingAccuracy:'被命中修正', intentBonus:'意图加值', intentDifficulty:'意图难度', shatter:'碎裂增伤',
};
const ratioStats = new Set(['armorPiercePercent','damageReduction','dr']);
const percent = new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:10});
const slots = {action:'动作',attack:'攻击',move:'移动',cast:'施法',reaction:'反应',fly:'升空',teleport:'瞬移'};
const flags = {preserveLife:'保留生命',blockRevive:'禁止复活',blockResourceRestore:'禁止资源恢复',untargetableSingle:'不可被单体选中',harmless:'无害',guaranteed_hit:'必定命中',guaranteed_crit:'必定暴击',hidden:'隐身',intercept:'可拦截攻击',taunted:'被嘲讽',infiniteAmmo:'弹药不限'};
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
  if(policy?.allowFriendlyTarget != null) parts.push(policy.allowFriendlyTarget?'可选友方为目标':'不可选友方为目标');
  if(policy?.intentLock) parts.push(`锁定意图：${INTENTS[policy.intentLock]?.name ?? policy.intentLock}`);
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
export function fillInstance(box,make,unit,state,raw,select,{collapsed=false,onToggle,warnings=0,attention=0,count=1,onDiscardEntry,canDiscardEntry}={}) {
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
  if(warnings) nameRow.append(make('span',{class:'fated-char-warn',title:`${warnings} 条词条待编译`},`⏳ ${warnings}`));
  if(attention) nameRow.append(make('span',{class:'fated-char-tag',title:`${attention} 条词条需确认`},`ⓘ ${attention}`));
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
      const expandable = effectCount > 0;
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
    gear.push({label:`[${slot}] ${t?.name??id}`,path:item?.templateId ? `/equipment/${item.templateId}` : null,meta:[t?.attack!=null?`攻击 ${t.attack}`:null,t?.defense?`防御 ${t.defense}`:null,t?.accuracy?`命中 ${signed(t.accuracy)}`:null,t?.range!=null?`距离 ${t.range}`:null,dice].filter(Boolean),template:t,item});
  }
  section('装备',gear);
  const innate = new Set(unit.skills??[]);
  const skillTemplates = new Map([...innate].map(id=>[id,state?.skills?.[id]]));
  if(state) for(const [id,template] of equippedActiveSkills(state,unit)) if(!skillTemplates.has(id)) skillTemplates.set(id,template);
  const skills=[...skillTemplates].map(([id,t])=>{
    const display=skillDisplay(t,unit.skillInfo?.[id]);
    const cost=display.costs.join(' / ');
    return {label:t?.name??id,path:innate.has(id)||state?.skills?.[id]?`/skills/${id}`:null,meta:[!innate.has(id)?'装备附带':null,t?.passive&&!t.rules?.some(rule=>rule.hook==='active')?'被动':null,cost?`消耗 ${cost}`:'无资源消耗',t?.power!=null?`威力 ${t.power}`:null,display.damage||'无伤害类型',`射程 ${display.range}`,`范围 ${display.area}`].filter(Boolean),template:t};
  });
  section('技能',skills);
  const details=make('details',{class:'fated-char-raw'});
  details.append(make('summary',{},'原始数据'),make('pre',{},JSON.stringify({instance:unit,source:raw,equipment:gear.map(r=>r.template),skills:skills.map(r=>r.template)},null,2)));
  body.append(details);
  box.append(body);
  return {body,setCollapsed};
}
