import { getStatusTemplate } from '../core/combat.js';
import { actionStatuses, STATUSES } from '../presets/status-defaults.js';
import { damageTypes, validateStatusModifiers } from '../core/status_modifiers.js';
import { spawnStatsAllowed } from '../core/spawn-unit.js';
import { resourceDefinitions } from '../core/effects.js';

import { MORALE, moraleLabels } from '../core/combat_protocol.js';
import { BUILTIN_RESOURCES } from '../core/resource_names.js';
import { effectNodes, isExpression, validExpireOn, validExpression, validSaveDC, validTerrainNode } from '../core/effect_schema.js';
import { timeOfDay } from '../core/battle_time.js';

export const own = Object.hasOwn;
export const error = message => { throw new Error(message); };
export const requireThat = (yes, name) => { if (!yes) error(`无效字段：${name}`); };
export const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
export const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) && !own(Object.prototype, v) && v !== 'prototype';
export const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
export const text = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export const team = v => v === 'blue' || v === 'red';
export const coord = v => int(v, 0, 9);
export const attrs = ['str', 'agi', 'con', 'int', 'spi'];
const statusDurations = ['battle_turns', 'until_removed', 'persistent'];
const statusTickTimings = ['onTurnStart', 'onTurnEnd'];
const statusStackRules = ['refresh', 'stack', 'replace'];
const statusLabels = ['name', 'icon', 'category', 'description'];
export const maxStatusTemplates = 64;
export const has = (record, key) => id(key) && own(record, key);
export function fields(v, required, optional = []) {
  requireThat(plain(v) && required.every(k => own(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)), required.join('/') || '对象键');
}
export function checkOptional(o, key, check) { if (own(o, key)) requireThat(check(o[key]), key); }
export function table(v, test, max = 200) {
  requireThat(plain(v) && Object.keys(v).length <= max, '实体表');
  for (const [k, value] of Object.entries(v)) { requireThat(id(k), '实体 ID'); test(value, k); }
}
export function list(v, max, check, key) { requireThat(Array.isArray(v) && v.length <= max && Array.from(v).every(check), key); }
function dice(v) {
  fields(v, ['count', 'sides'], ['bonus', 'stat', 'multiplier', 'type']);
  requireThat(int(v.count, 0, 1000000) && int(v.sides, 0, 1000000) && (v.count === 0 || v.sides >= 1), '伤害骰');
  checkOptional(v, 'bonus', x => int(x, -1000000000, 1000000000)); checkOptional(v, 'stat', x => attrs.includes(x));
  checkOptional(v, 'multiplier', x => num(x, 0, 8)); checkOptional(v, 'type', x => damageTypes.includes(x));
}
function statusLifetime(v) {
  return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType)
    && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
}
export function statusTemplate(v, key = v?.id) {
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers'], ['expireInto', 'expireOn']);
  checkOptional(v, 'expireInto', id);
  checkOptional(v, 'expireOn', validExpireOn);
  requireThat(id(key) && v.id === key, '自定义状态 ID');
  requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300)
    && ['buff', 'debuff', 'control', 'dot', 'hot', 'shield'].includes(v.category), '状态名/图标/描述/类别');
  requireThat(statusLifetime(v) && int(v.maxStacks, 1, 10), '状态时长/层数');
  requireThat(plain(v.modifiers) && Object.keys(v.modifiers).length > 0 && (!own(v.modifiers, 'damageType') || own(v.modifiers, 'damage')), '状态特效');
  validateStatusModifiers(v, v.modifiers);
  requireThat(key !== actionStatuses.shield || own(v.modifiers, 'amount'), '默认护盾模板需要 amount');
}
export function statusTemplateTable(v) {
  table(v, statusTemplate, maxStatusTemplates);
  for (const t of Object.values(v)) if (t.expireInto) {
    const next = getStatusTemplate({ statusTemplates: v }, t.expireInto);
    requireThat(t.durationType === 'battle_turns' && t.remainingTurns === 1 && t.expireInto !== t.id
      && next && !next.expireInto, '状态到期目标');
  }
}

export function defineStatus(state, key, template) {
  requireThat(plain(template) && (!own(template, 'id') || template.id === key), '自定义状态 ID');
  const definition = { ...template, id: key };
  statusTemplate(definition, key);
  requireThat(!own(state.statusTemplates ?? {}, key), '自定义状态 ID 已存在');
  requireThat(Object.keys(state.statusTemplates ?? {}).length < maxStatusTemplates, '自定义状态模板数量');
  (state.statusTemplates ??= {})[key] = structuredClone(definition);
  return structuredClone(definition);
}

const resourceCost = x => plain(x) && (Object.keys(x).length === 2 && id(x.resource) && int(x.amount, 1, 1000000)
  || Object.keys(x).length > 0 && Object.entries(x).every(([key, amount]) => ['hp','mp','sp'].includes(key) && int(amount, 0, 25000)));
export function validateEffect(e, state) {
  requireThat(isExpression(e) && validExpression(e), 'DSL expression');
  if (Array.isArray(e.roll?.save)) requireThat(e.roll.mode && new Set(e.roll.save).size === e.roll.save.length, 'DSL save mode');
  else requireThat(!e.roll?.mode, 'DSL save mode');
  for (const node of effectNodes(e.effects)) {
    if (node.kind === 'spawnUnit' && state) {
      const skills = node.skills ?? [];
      requireThat(skills.every(k=>has(state.skills,k)) && new Set(skills).size === skills.length, 'spawnUnit 技能引用');
      for (const [slot, ids] of [['hand',[node.mainHand,node.offHand]], ['shield',[node.shield]], ['gear',node.gear ?? []]]) {
        for (const k of ids.filter(Boolean)) {
          requireThat(has(state.equipment,k), 'spawnUnit 装备模板引用');
          const t = state.equipment[k];
          requireThat(slot === 'shield' ? t.kind === 'shield' : slot === 'gear' ? ['armor','accessory','consumable'].includes(t.kind) :
            t.kind === 'consumable' || ((!t.kind || t.kind === 'weapon') && !!t.damage), 'spawnUnit 装备槽');
        }
      }
    }
    if (node.kind === 'removeStatus') requireThat(Boolean(node.statusId) !== Boolean(node.category), 'DSL removeStatus selector');
    if (node.statusId) {
      const template = getStatusTemplate(state, node.statusId);
      requireThat(template, `DSL status ${node.statusId}`);
      if (node.modifiers) validateStatusModifiers(template, node.modifiers);
      if (node.stacks && (!has(STATUSES, node.statusId) || has(state?.statusTemplates ?? {}, node.statusId))) requireThat(node.stacks <= template.maxStacks, 'DSL status stacks');
      if (node.amount != null) requireThat(own(template.modifiers, 'amount') && int(node.amount, 1, 10000), 'DSL status amount');
    }
    if (node.local && ['produceResource','restoreResource','drainResource'].includes(node.kind)) {
      requireThat(!BUILTIN_RESOURCES.includes(node.resource), `DSL 实例计数器不能使用内置资源 ${node.resource}`);
    }
    if (node.initial != null) requireThat(node.cap != null && node.initial <= node.cap, 'DSL resource initial');
  }
}

function effects(v, state) {
  requireThat(Array.isArray(v) && v.length <= 24, 'effects');
  const seen = new Set();
  for (const e of v) {
    validateEffect(e, state);
    requireThat(!seen.has(e.id), '重复特效');
    seen.add(e.id);
  }
}
export function equipmentTemplate(v, state) {
  fields(v, ['name', 'effects'], ['quality','kind','weaponClass','hand','rangeType','ranged','heavy','twoHanded','shield','range', 'accuracy', 'attack', 'damage', 'armor', 'defense', 'boundTo', 'weaponType']);
  checkOptional(v, 'boundTo', id); checkOptional(v, 'weaponType', text);
  requireThat(text(v.name), 'name');
  checkOptional(v, 'quality', x => ['唯一','普通','优良','稀有','史诗','传说','神话'].includes(x));
  checkOptional(v, 'range', x => int(x, 1, 15)); checkOptional(v, 'attack', x => int(x, 0, 1000000000)); checkOptional(v, 'accuracy', x => int(x, -20, 30));
  checkOptional(v, 'armor', x => int(x, 0, 1000000)); checkOptional(v, 'defense', x => int(x, 0, 1000000));
  checkOptional(v, 'kind', x => ['weapon','shield','armor','accessory','consumable'].includes(x));
  checkOptional(v, 'weaponClass', x => ['light_blade','ranged','greatsword','staff','shield','auxiliary'].includes(x));
  checkOptional(v, 'hand', x => ['one_handed','two_handed','off_hand'].includes(x)); checkOptional(v, 'rangeType', x => ['melee','ranged'].includes(x));
  for (const field of ['ranged','heavy','twoHanded','shield']) checkOptional(v, field, x => typeof x === 'boolean');
  if (own(v, 'damage')) dice(v.damage);
  requireThat(own(v, 'range') === own(v, 'damage'), '武器 range/damage');
  effects(v.effects, state);
  const pools = resourceDefinitions(v);
  requireThat(new Set(pools.map(pool => pool.resource)).size === pools.length, 'DSL 重复资源池');
}
export function skillTemplate(v, state) {
  fields(v, ['name', 'ap', 'slot', 'range', 'shape', 'target', 'effects'], ['quality','power','mp', 'sp', 'radius', 'width', 'accuracy', 'save', 'saveDC', 'damage', 'heal', 'resourceCost', 'school', 'damageType','backpackItem']);
  checkOptional(v, 'backpackItem', flag => flag === true && v.ap === 1 && v.slot === 'action');
  checkOptional(v, 'damageType', type => damageTypes.includes(type));
  checkOptional(v, 'school', text);
  checkOptional(v, 'resourceCost', resourceCost);
  requireThat(text(v.name) && int(v.ap, 1, 2) && ['attack', 'action'].includes(v.slot) && int(v.range, 0, 15)
    && ['single', 'circle', 'fan', 'cone', 'line'].includes(v.shape) && ['enemy', 'ally', 'self', 'any', 'corpse', 'cell'].includes(v.target), '技能');
  checkOptional(v, 'power', x => int(x, 0, 1000000000));
  for (const k of ['mp', 'sp']) checkOptional(v, k, x => int(x, 0, 25000));
  for (const k of ['radius', 'width']) checkOptional(v, k, x => int(x, 0, 6));
  checkOptional(v, 'accuracy', x => int(x, -20, 30)); checkOptional(v, 'save', x => attrs.includes(x));
  checkOptional(v, 'saveDC', validSaveDC);
  requireThat(own(v, 'save') === own(v, 'saveDC'), 'save/saveDC');
  for (const k of ['damage', 'heal']) if (own(v, k)) dice(v[k]);
  effects(v.effects, state);
}
export function statusValue(v, key, state) {
  const t = getStatusTemplate(state, key);
  requireThat(id(key) && t, '状态 ID');
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers', 'stacks', 'sourceUnitId'], ['appliedRound', 'appliedTurn', 'amount', 'expireInto', 'expireOn', 'holdTotal']);
  checkOptional(v,'holdTotal',x=>v.id==='suppressed' && Number.isFinite(x));
  checkOptional(v, 'expireOn', x => x === null || validExpireOn(x));
  requireThat(v.expireInto === t.expireInto, '状态到期目标');
  requireThat(v.id === key && statusLabels.every(k => v[k] === t[k]) && statusLifetime(v)
    && int(v.maxStacks, 1, t.maxStacks) && int(v.stacks, 1, v.maxStacks)
    && (v.sourceUnitId === null || id(v.sourceUnitId)), '状态实例');
  fields(v.modifiers, Object.keys(t.modifiers));
  validateStatusModifiers(t, v.modifiers);
  checkOptional(v, 'appliedRound', x => int(x, 1, 1000000)); checkOptional(v, 'appliedTurn', x => int(x, 0, 199));
  requireThat(own(t.modifiers, 'amount') ? int(v.amount, 1, 1000000000) : !own(v, 'amount'), '护盾池');
}
export function validateCell(v) {
  fields(v, ['kind', 'z']);
  requireThat(['floor', 'slope', 'wall'].includes(v.kind) && int(v.z, -4, 8), '地形');
}
const unitKeys = ['id','name','team','x','y','facing','hp','maxHp','mp','maxMp','sp','maxSp','ap','used','stats','armor','size','move','weapon','gear','skills','statuses'];
const protocolUnitKeys = ['mainHand','offHand','shield','bodyLengthM','tier','mc','nonLethal','intent','bonusDice','penaltyDice','stance','protagonist','moraleType','moraleState','greatswordMode','parryQuota','parryRefunded','attunementCharges','blockMode','initiativePercent','attackInit','actionInit','flatInitiative','lockedTargetId','deathrattle','deathrattleTriggered','moraleCheckedRound','maneuvers'];
export function unitValue(v, key, state) {
  fields(v, unitKeys, ['reactionAvailable', ...protocolUnitKeys, 'fled', 'diedAt', 'corpseOf', 'corpseConsumed', 'creatureType', 'tags', 'resources', 'inventory', 'bagWeapons', 'effectUsage', 'effectModifiers', 'altitude']);
  if (own(v, 'altitude')) requireThat(int(v.altitude, 0, 12), '离地高度');
  for (const k of ['fled','corpseConsumed']) checkOptional(v, k, x => typeof x === 'boolean');
  checkOptional(v, 'corpseOf', id);
  checkOptional(v, 'diedAt', x => plain(x) && Object.keys(x).length === 2 && int(x.round, 1, state.round) && int(x.turn, 0, 199));
  checkOptional(v, 'creatureType', x => text(x) || Array.isArray(x) && x.length <= 12 && Array.from(x).every(t => text(t)));
  if (own(v, 'tags')) list(v.tags, 32, x => text(x), 'tags');
  for (const k of ['resources','inventory']) if (own(v, k)) table(v[k], x => requireThat(int(x, 0, 1e9), k));
  for (const k of ['effectUsage','effectModifiers']) if (own(v, k)) {
    requireThat(plain(v[k]) && Object.keys(v[k]).length <= 1000 && jsonTree(v[k]), k);
    for (const entry of Object.values(v[k])) {
      if (k === 'effectUsage') {
        fields(entry, ['count','round']); requireThat(int(entry.count, 1, 1000000) && int(entry.round, 1, state.round), k);
      } else {
        fields(entry, ['stat','flat','percent','turns','round','turn'], ['damageType']);
        checkOptional(entry, 'damageType', x => damageTypes.includes(x));
        requireThat(int(entry.round, 1, state.round) && int(entry.turn, 0, 199), k);
        requireThat(text(entry.stat) && num(entry.flat, -1e9, 1e9) && num(entry.percent, -1, 10) && int(entry.turns, 1, 100), k);
      }
    }
  }
  checkOptional(v, 'reactionAvailable', x => typeof x === 'boolean');
  requireThat(v.id === key && text(v.name) && team(v.team) && coord(v.x) && coord(v.y), '棋子');
  list(v.facing, 2, x => int(x, -1, 1), '朝向');
  requireThat(v.facing.length === 2 && v.facing.some(Boolean), '朝向');
  for (const [r, max] of [['hp','maxHp'], ['mp','maxMp'], ['sp','maxSp']]) requireThat(int(v[max], r === 'hp' ? 1 : 0, 1000000000) && int(v[r], 0, v[max]), r);
  fields(v.used, ['action', 'attack']); fields(v.stats, attrs);
  requireThat(attrs.every(k => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2)
    && int(v.armor, 0, 1000000) && int(v.size, 1, 5) && int(v.move, 1, 10), '单位数值');
  requireThat(v.weapon === null || id(v.weapon), 'weapon');
  for (const slot of ['mainHand','offHand','shield']) checkOptional(v, slot, x => x === null || id(x));
  checkOptional(v, 'bodyLengthM', x => num(x, .01, 1e9)); checkOptional(v, 'tier', x => int(x, 1, 7));
  checkOptional(v, 'mc', x => int(x, 1, 64)); checkOptional(v, 'nonLethal', x => typeof x === 'boolean');
  checkOptional(v, 'deathrattle', x => plain(x) && typeof x.kind === 'string'); checkOptional(v, 'deathrattleTriggered', x => typeof x === 'boolean'); checkOptional(v, 'moraleCheckedRound', x => int(x, 1, 1000000));
  checkOptional(v, 'maneuvers', x => Array.isArray(x) && x.length <= 32 && x.every(id));
  checkOptional(v, 'initiativePercent', x => num(x, -1, 10)); checkOptional(v, 'flatInitiative', x => int(x, -1000, 1000));
  for (const field of ['attackInit','actionInit']) checkOptional(v, field, x => Array.isArray(x) && x.length <= 16 && x.every(n => int(n, -1000, 1000)));
  checkOptional(v, 'lockedTargetId', x => x === null || id(x));
  checkOptional(v, 'intent', x => typeof x === 'string' && ['normal','function','core','kill','concept'].includes(x));
  checkOptional(v, 'bonusDice', x => int(x, 0, 2)); checkOptional(v, 'penaltyDice', x => int(x, 0, 1));
  checkOptional(v, 'stance', x => typeof x === 'string'); checkOptional(v, 'protagonist', x => x === true); checkOptional(v, 'moraleType', x => typeof x === 'string' && Object.hasOwn(MORALE,x)); checkOptional(v, 'moraleState', x => typeof x === 'string' && Object.hasOwn(moraleLabels,x));
  checkOptional(v, 'greatswordMode', x => ['offensive','defensive'].includes(x)); checkOptional(v, 'parryQuota', x => int(x, 0, 2)); checkOptional(v, 'parryRefunded', x => typeof x === 'boolean'); checkOptional(v, 'attunementCharges', x => int(x, 0, 2)); checkOptional(v, 'blockMode', x => ['normal','heavy'].includes(x));
  if (own(v,'bagWeapons')) list(v.bagWeapons, 200, id, '背包武器');
  list(v.gear, 12, id, 'gear'); list(v.skills, 32, id, 'skills');
  table(v.statuses, (status, statusId) => statusValue(status, statusId, state), maxStatusTemplates + Object.keys(STATUSES).length);
}
function jsonTree(v, depth = 0) {
  if (depth > 12) return false;
  if (v === null || ['string','boolean'].includes(typeof v) || Number.isFinite(v)) return true;
  if (Array.isArray(v)) return v.length <= 500 && Array.from(v).every(x => jsonTree(x, depth + 1));
  return plain(v) && Object.keys(v).length <= 250 && Object.entries(v).every(([key, x]) => !own(Object.prototype, key) && jsonTree(x, depth + 1));
}
export function validateState(s) {
  fields(s, ['scenarioId','title','mode','ruleset','round','turn','order','units','items','equipment','skills','grid','covers','interactives','rng','logs','outcome'], ['statusTemplates','zones','time','effectTemplates','summonTemplates','terrainPatches','battleType','battleConclusion','suppressingTeam']);
  requireThat(s.battleType === 'suppress' ? ['blue','red'].includes(s.suppressingTeam) : s.suppressingTeam === undefined, '压制方');
  checkOptional(s,'battleType',x=>typeof x==='string' && Object.hasOwn(MORALE,x));
  checkOptional(s,'battleConclusion',x=>typeof x==='string' && x.trim().length>0 && s.outcome != null);
  if (own(s, 'time')) {
    fields(s.time, ['raw','hour','minute','timeOfDay','calendar']);
    requireThat(text(s.time.raw, 500) && typeof s.time.calendar === 'string' && s.time.calendar.length <= 500 && int(s.time.hour, 0, 23)
      && int(s.time.minute, 0, 59) && s.time.timeOfDay === timeOfDay(s.time.hour, s.time.minute), 'time');
  }
  if (own(s, 'effectTemplates')) table(s.effectTemplates, (e, key) => { requireThat(isExpression(e) && e.id === key, 'effectTemplates'); validateEffect(e, s); });
  if (own(s, 'summonTemplates')) table(s.summonTemplates, (u, key) => { unitValue(u, key, s); requireThat(u.skills.every(skill => has(s.skills, skill)), 'summon skills'); });
  if (own(s, 'statusTemplates')) statusTemplateTable(s.statusTemplates);
  requireThat(id(s.scenarioId) && text(s.title) && s.mode === 'split' && ['protocol','sandbox'].includes(s.ruleset) && int(s.round, 1, 1000000) && int(s.rng, 0, 0xffffffff)
    && [null,'blue','red','draw'].includes(s.outcome), '战局');
  requireThat(Array.isArray(s.grid) && s.grid.length === 10, '棋盘');
  for (const row of s.grid) {
    requireThat(Array.isArray(row) && row.length === 10, '棋盘行');
    for (const c of row) validateCell(c);
  }
  table(s.equipment, v => equipmentTemplate(v, s)); table(s.skills, v => skillTemplate(v, s));
  const expressions = [...Object.values(s.effectTemplates ?? {}), ...[...Object.values(s.equipment), ...Object.values(s.skills)].flatMap(t => t.effects.filter(isExpression))];
  const byId = new Map(expressions.map(expr => [expr.id, expr]));
  requireThat(byId.size === expressions.length, 'DSL 全局效果 ID 重复');
  const checked = new Set();
  function checkReferences(expr, path = new Set()) {
    requireThat(!path.has(expr.id), `DSL 循环引用 ${expr.id}`);
    if (checked.has(expr.id)) return;
    path.add(expr.id);
    for (const node of effectNodes(expr.effects)) if (node.kind === 'procEffect') {
      requireThat(byId.has(node.ref), `DSL 未知引用 ${node.ref}`);
      checkReferences(byId.get(node.ref), path);
    }
    path.delete(expr.id);
    checked.add(expr.id);
  }
  expressions.forEach(expr => checkReferences(expr));
  table(s.items, (v, k) => {
    fields(v, ['id','templateId','counters']);
    requireThat(v.id === k && has(s.equipment, v.templateId), '装备实例');
    const counters = resourceDefinitions(s.equipment[v.templateId]);
    fields(v.counters, counters.map(e => e.resource));
    for (const e of counters) requireThat(int(v.counters[e.resource], 0, e.cap), '计数器');
  });
  table(s.covers, (v, k) => {
    fields(v, ['id','name','x','y','material','hp','maxHp','cover'], ['z']);
    requireThat(!own(v,'z') || int(v.z,-4,8), '掩体高度');
    requireThat(v.id === k && text(v.name) && text(v.material) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== 'wall'
      && int(v.maxHp, 1, 1000000000) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), '掩体');
  });
  table(s.zones ?? {}, (v, k) => {
    fields(v, ['id','name','x','y','radius','remainingTurns','damage','damageType','team']);
    requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && int(v.radius,0,10) && int(v.remainingTurns,1,100)
      && int(v.damage,0,1000000000) && ['physical','energy','mental','true'].includes(v.damageType) && ['blue','red','all'].includes(v.team), '持续区域');
  }, 64);
  table(s.terrainPatches ?? {}, (v, k) => {
    fields(v, ['id','name','node','remainingTurns','persistent','patch','covers'], ['anchorUnitId','center']);
    requireThat(v.id === k && text(v.name) && validTerrainNode(v.node) && int(v.remainingTurns,0,100)
      && typeof v.persistent === 'boolean', '地形效果');
    const point = p => coord(p.x) && coord(p.y);
    if (v.node.area.follow) {
      requireThat(id(v.anchorUnitId), '地形锚点');
      fields(v.center, ['x','y']);
      requireThat(point(v.center), '地形圆心');
    } else requireThat(!own(v,'anchorUnitId') && !own(v,'center'), '地形锚点');
    list(v.patch, 100, p => {
      fields(p, ['x','y','before','after']);
      validateCell(p.before); validateCell(p.after);
      return point(p);
    }, '地形变更');
    list(v.covers, 100, p => {
      fields(p, ['id','x','y','before']);
      return id(p.id) && p.id === `${k}-${p.x}-${p.y}` && point(p) && p.before === null;
    }, '临时掩体');
  }, 64);
  table(s.interactives, (v, k) => {
    fields(v, ['id','name','x','y','kind','spent'], ['z','effect','radius','damage']);
    requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && (!own(v,'z') || int(v.z, -4, 8)) && s.grid[v.y][v.x].kind !== 'wall'
      && ['barrel','altar'].includes(v.kind) && (!own(v,'effect') || ['explode','heal','shield','restore'].includes(v.effect))
      && (!own(v,'radius') || int(v.radius, 0, 10)) && (!own(v,'damage') || int(v.damage, 0, 100000)) && typeof v.spent === 'boolean', '互动点');
  });
  const occupied = new Set(), equipped = new Set();
  table(s.units, (v, k) => {
    unitValue(v, k, s);
    const point = `${v.x},${v.y}`;
    if (v.hp > 0 && !v.fled) {
      requireThat(!occupied.has(point) && s.grid[v.y][v.x].kind !== 'wall'
        && !Object.values(s.covers).some(c => c.hp > 0 && c.x === v.x && c.y === v.y), '棋子位置重叠或阻挡');
      occupied.add(point);
    }
    const slots = [v.weapon, v.mainHand, v.offHand, v.shield, ...v.gear].filter(Boolean);
    for (const i of v.bagWeapons ?? []) {
      const t = s.equipment[s.items[i]?.templateId];
      requireThat(t?.damage && !slots.includes(i) && !equipped.has(i), '背包武器引用或归属');
      equipped.add(i);
    }
    for (const i of new Set(slots)) {
      const template = has(s.items, i) ? s.equipment[s.items[i].templateId] : null;
      const weaponSlot = i === v.weapon || i === v.mainHand || i === v.offHand;
      const isShieldSlot = i === v.shield;
      const isDamageItem = Boolean(template && own(template, 'damage'));
      requireThat(has(s.items, i) && !equipped.has(i) && (weaponSlot ? (isDamageItem || template?.kind === 'consumable') : isShieldSlot ? template?.kind === 'shield' : true), '装备引用或归属');
      equipped.add(i);
    }
    requireThat(v.skills.every(i => has(s.skills, i)) && new Set(v.skills).size === v.skills.length, '技能引用');
    // Shared templates have no caster of their own: check budgets for each actual owner.
    const visited = new Set();
    function checkSpawnBudget(expr) {
      if (visited.has(expr.id)) return;
      visited.add(expr.id);
      for (const n of effectNodes(expr.effects)) {
        if (n.kind === 'spawnUnit' && n.stats) requireThat(spawnStatsAllowed(v,n), 'spawnUnit 五维预算');
        if (n.kind === 'procEffect') checkSpawnBudget(byId.get(n.ref));
      }
    }
    for (const template of [...v.skills.map(id=>s.skills[id]), ...[...new Set(slots)].map(id=>s.equipment[s.items[id].templateId])])
      template.effects.forEach(checkSpawnBudget);
  });
  list(s.order, 200, x => has(s.units, x), '先攻队列');
  requireThat(new Set(s.order).size === s.order.length && int(s.turn, 0, Math.max(0, s.order.length - 1))
    && Object.values(s.units).every(u => u.hp <= 0 || s.order.includes(u.id)), '先攻索引');
  requireThat(Array.isArray(s.logs) && s.logs.length <= 100000, '日志');
  for (const log of s.logs) {
    fields(log, ['round','actor','type','text','detail'], ['positions']);
    requireThat(int(log.round, 1, s.round) && (log.actor === null || id(log.actor)) && text(log.type, 64) && text(log.text, 1000) && jsonTree(log.detail)
      && (!log.positions || plain(log.positions) && Object.values(log.positions).every(point => plain(point) && coord(point.x) && coord(point.y) && (!own(point,'z') || int(point.z,-4,20)))), '日志事件');
  }
  return s;
}
