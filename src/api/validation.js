import { getStatusTemplate } from '../core/combat.js';
import { actionStatuses, STATUSES } from '../presets/status-defaults.js';
import { damageTypes, validateStatusModifiers } from '../core/status_modifiers.js';
import { validExpr } from '../core/formula.js';

import { MORALE, moraleLabels } from '../core/combat_protocol.js';
import { timeOfDay } from '../core/battle_time.js';
import { validVmOpcode, validVmRule, vmStatModError, validVmTag, vmHooks } from '../core/vm-schema.js';
import { validVmState } from '../core/vm-runtime.js';

function validateRules(rules, state) {
  list(rules, 200, rule => validVmRule(rule, { statusTemplates: state?.statusTemplates }), 'VM 规则');
  requireThat(new Set(rules.map(rule => rule.id)).size === rules.length, 'VM 规则 ID 重复');
}

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
const maxStatusStacks = 999999;
export const maxStatusTemplates = 64;
export const has = (record, key) => id(key) && own(record ?? {}, key);
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
const damageEvents = ['on_attack','on_hit','on_damaged','on_kill','on_death','on_turn_start','on_turn_end','on_skill_cast','on_equip','on_heal','on_ally_death','on_struck'];
function nativeExpiry(value) {
  const valid = rule => plain(rule) && damageEvents.includes(rule.trigger)
    && Object.keys(rule).every(key => ['trigger', 'exceptSource', 'damageType'].includes(key))
    && (!own(rule, 'exceptSource') || rule.exceptSource === 'self')
    && (!own(rule, 'damageType') || rule.trigger === 'on_damaged' && ['any', 'direct', 'indirect'].includes(rule.damageType));
  return Array.isArray(value) ? value.length <= 12 && Array.from(value).every(valid) : valid(value);
}
const vmExpiry = value => plain(value) && vmHooks.includes(value.hook)
  && Object.keys(value).every(key => ['hook', 'filter'].includes(key))
  && (!own(value, 'filter') || typeof value.filter === 'boolean' || typeof value.filter === 'string' && validExpr(value.filter));
const stackModes = ['refresh', 'stack', 'replace', 'extend'];
const carrierFields = ['tags', 'tier', 'vars', 'flags', 'mods', 'rules'];
const numericExpr = value => Number.isFinite(value) || typeof value === 'string' && validExpr(value);
function carrierFieldsValue(value, state, resolved = false) {
  if (own(value, 'tags')) list(value.tags, 32, resolved ? tag => text(tag) : validVmTag, 'VM 标签');
  if (own(value, 'flags')) list(value.flags, 8, flag => flag === 'undispellable', 'VM 标记');
  checkOptional(value, 'tier', tier => int(tier, 1, 7));
  if (own(value, 'vars')) table(value.vars, entry => requireThat(resolved ? jsonTree(entry)
    : typeof entry === 'boolean' || numericExpr(entry), 'VM 变量'));
  if (own(value, 'mods')) list(value.mods, 200, mod => {
    const error = vmStatModError(mod);
    requireThat(!error, error);
    return true;
  }, 'VM 修饰');
  if (own(value, 'rules')) validateRules(value.rules, state);
}
function poolDefinitions(value) {
  table(value, definition => {
    fields(definition, ['cap'], ['initial', 'reloadable']);
    requireThat(numericExpr(definition.cap) && (typeof definition.cap !== 'number' || definition.cap >= 0), '资源池上限');
    checkOptional(definition, 'initial', initial => numericExpr(initial) && (typeof initial !== 'number' || initial >= 0
      && (typeof definition.cap !== 'number' || initial <= definition.cap)));
    checkOptional(definition, 'reloadable', flag => typeof flag === 'boolean');
  });
}
const validPoolId = value => typeof value === 'string' && /^pool_[A-Za-z0-9_-]{1,250}$/.test(value);
function poolBindings(value) {
  table(value, poolId => requireThat(validPoolId(poolId), '资源池 ID'));
}
const validStackCap = value => int(value, 1, maxStatusStacks) || typeof value === 'string' && validExpr(value);
const stackCapLimit = template => typeof template.maxStacks === 'string' ? maxStatusStacks : template.maxStacks ?? 1;

export function statusTemplate(value, key = value?.id, state) {
  fields(value, ['id', 'name'], ['icon', 'category', 'description', 'remainingTurns', 'durationType', 'stackMode', 'maxStacks', 'expireOn', ...carrierFields]);
  requireThat(id(key) && key === value.id && text(value.name), 'VM 状态 ID/名称');
  checkOptional(value, 'icon', icon => text(icon, 24));
  checkOptional(value, 'description', description => text(description, 300));
  checkOptional(value, 'category', category => text(category, 32));
  checkOptional(value, 'remainingTurns', turns => int(turns, 1, 100));
  checkOptional(value, 'durationType', duration => statusDurations.includes(duration));
  checkOptional(value, 'stackMode', mode => stackModes.includes(mode));
  checkOptional(value, 'maxStacks', validStackCap);
  checkOptional(value, 'expireOn', vmExpiry);
  carrierFieldsValue(value, state);
}
function statusLifetime(v) {
  return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType)
    && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
}
function nativeStatusTemplate(v, key) {
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers'], ['expireInto', 'expireOn']);
  checkOptional(v, 'expireInto', id);
  checkOptional(v, 'expireOn', nativeExpiry);
  requireThat(id(key) && v.id === key, '自定义状态 ID');
  requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300)
    && ['buff', 'debuff', 'control', 'dot', 'hot', 'shield'].includes(v.category), '状态名/图标/描述/类别');
  requireThat(statusLifetime(v) && validStackCap(v.maxStacks), '状态时长/层数');
  requireThat(plain(v.modifiers) && Object.keys(v.modifiers).length > 0 && (!own(v.modifiers, 'damageType') || own(v.modifiers, 'damage')), '状态特效');
  validateStatusModifiers(v, v.modifiers);
  requireThat(key !== actionStatuses.shield || own(v.modifiers, 'amount'), '默认护盾模板需要 amount');
}
export function statusTemplateTable(v) {
  const state = { statusTemplates: v };
  table(v, (template, key) => {
    if (own(template ?? {}, 'modifiers')) nativeStatusTemplate(template, key);
    else statusTemplate(template, key, state);
  }, maxStatusTemplates);
  for (const t of Object.values(v)) if (t.expireInto) {
    const next = getStatusTemplate({ statusTemplates: v }, t.expireInto);
    requireThat(t.durationType === 'battle_turns' && t.remainingTurns === 1 && t.expireInto !== t.id
      && next && !next.expireInto, '状态到期目标');
  }
}

export function defineStatus(state, key, template) {
  requireThat(plain(template) && (!own(template, 'id') || template.id === key), '自定义状态 ID');
  const definition = { ...template, id: key };
  statusTemplate(definition, key, { statusTemplates: { ...state.statusTemplates, [key]: definition } });
  requireThat(!own(state.statusTemplates ?? {}, key) && !own(STATUSES, key), '自定义状态 ID 已存在');
  requireThat(Object.keys(state.statusTemplates ?? {}).length < maxStatusTemplates, '自定义状态模板数量');
  (state.statusTemplates ??= {})[key] = structuredClone(definition);
  return structuredClone(definition);
}

const resourceCost = x => plain(x) && (Object.keys(x).length === 2 && id(x.resource) && int(x.amount, 1, 1000000)
  || Object.keys(x).length > 0 && Object.entries(x).every(([key, amount]) => ['hp','mp','sp'].includes(key) && int(amount, 0, 25000)));
export function validSaveDC(value) {
  if (int(value, 1, 50)) return true;
  return plain(value) && own(value, 'base') && own(value, 'scaleBy')
    && Object.keys(value).every(key => ['base', 'scaleBy', 'min', 'max'].includes(key))
    && num(value.base, -1e9, 1e9) && plain(value.scaleBy) && Object.keys(value.scaleBy).length === 2
    && own(value.scaleBy, 'stat') && own(value.scaleBy, 'perUnit')
    && attrs.includes(value.scaleBy.stat) && num(value.scaleBy.perUnit, -1e9, 1e9)
    && (!own(value, 'min') || num(value.min, 1, 1e9)) && (!own(value, 'max') || num(value.max, 1, 1e9))
    && (value.min ?? 1) <= (value.max ?? 50);
}
function validateAreaDimensions(v) {
  for (const key of ['radius', 'innerRadius', 'width']) checkOptional(v, key, x => Number.isFinite(x) && x >= 0 && x <= 30);
  checkOptional(v, 'angle', x => int(x, 1, 360));
}
export function equipmentTemplate(v, state) {
  fields(v, ['name'], ['quality','kind','weaponClass','hand','rangeType','ranged','heavy','twoHanded','shield','range', 'accuracy', 'attack', 'damage', 'armor', 'defense', 'boundTo', 'weaponType', 'shape', 'target', 'radius', 'innerRadius', 'width', 'angle', ...carrierFields, 'pools', 'skills']);
  if (own(v, 'skills')) {
    list(v.skills, 32, skillId => state ? has(state.skills, skillId) : id(skillId), '装备技能');
    requireThat(new Set(v.skills).size === v.skills.length, '重复装备技能');
  }
  checkOptional(v, 'boundTo', id); checkOptional(v, 'weaponType', text);
  requireThat(text(v.name), 'name');
  checkOptional(v, 'quality', x => ['唯一','普通','优良','稀有','史诗','传说','神话'].includes(x));
  checkOptional(v, 'range', x => int(x, 1, 30)); checkOptional(v, 'attack', x => int(x, 0, 1000000000)); checkOptional(v, 'accuracy', x => int(x, -20, 30));
  checkOptional(v, 'armor', x => int(x, 0, 1000000)); checkOptional(v, 'defense', x => int(x, 0, 1000000));
  checkOptional(v, 'kind', x => ['weapon','shield','armor','accessory','consumable'].includes(x));
  checkOptional(v, 'weaponClass', x => ['light_blade','ranged','greatsword','staff','shield','auxiliary'].includes(x));
  checkOptional(v, 'hand', x => ['one_handed','two_handed','off_hand'].includes(x)); checkOptional(v, 'rangeType', x => ['melee','ranged'].includes(x));
  for (const field of ['ranged','heavy','twoHanded','shield']) checkOptional(v, field, x => typeof x === 'boolean');
  checkOptional(v, 'shape', x => ['single','circle','ring','fan','cone','line'].includes(x));
  checkOptional(v, 'target', x => ['enemy','ally','self','any','cell'].includes(x));
  validateAreaDimensions(v);
  if (own(v, 'damage')) dice(v.damage);
  requireThat(own(v, 'range') === own(v, 'damage'), '武器 range/damage');
  carrierFieldsValue(v, state);
  if (own(v, 'pools')) poolDefinitions(v.pools);
}
export function skillTemplate(v, state) {
  fields(v, ['name', 'ap', 'slot', 'range', 'shape', 'target'], ['quality','power','mp', 'sp', 'radius', 'innerRadius', 'width', 'angle', 'accuracy', 'save', 'saveDC', 'damage', 'heal', 'resourceCost', 'school', 'damageType','backpackItem', 'initiativeBonus', 'passive', ...carrierFields, 'pools']);
  carrierFieldsValue(v, state);
  if (own(v, 'pools')) poolDefinitions(v.pools);
  checkOptional(v, 'backpackItem', flag => flag === true && v.ap === 1 && v.slot === 'action');
  checkOptional(v, 'damageType', type => damageTypes.includes(type));
  checkOptional(v, 'school', text);
  checkOptional(v, 'resourceCost', resourceCost);
  checkOptional(v, 'initiativeBonus', value => int(value, -100, 100));
  checkOptional(v, 'passive', value => typeof value === 'boolean');
  requireThat(text(v.name) && int(v.ap, 0, 2) && ['attack', 'action'].includes(v.slot) && int(v.range, 0, 30)
    && ['single', 'circle', 'ring', 'fan', 'cone', 'line'].includes(v.shape) && ['enemy', 'ally', 'self', 'any', 'corpse', 'cell'].includes(v.target), '技能');
  checkOptional(v, 'power', x => int(x, 0, 1000000000));
  for (const k of ['mp', 'sp']) checkOptional(v, k, x => int(x, 0, 25000));
  validateAreaDimensions(v);
  checkOptional(v, 'accuracy', x => int(x, -20, 30)); checkOptional(v, 'save', x => attrs.includes(x));
  checkOptional(v, 'saveDC', dc => validSaveDC(dc) || typeof dc === 'string' && validExpr(dc));
  requireThat(own(v, 'save') === own(v, 'saveDC'), 'save/saveDC');
  for (const k of ['damage', 'heal']) if (own(v, k)) dice(v[k]);
}
export function statusValue(v, key, state, ownerId) {
  if (own(v ?? {}, 'templateId')) {
    const { templateId, ownerId: owner, sourceId, stacks, pools, ...rest } = v;
    const template = getStatusTemplate(state, key);
    const { vars, modifiers, stackRule, tickTiming, expireInto, amount, ...definition } = rest;
    if (template?.modifiers) {
      if (own(definition, 'expireOn') && nativeExpiry(definition.expireOn)) delete definition.expireOn;
      if (own(rest, 'modifiers')) validateStatusModifiers(template, modifiers);
      if (own(rest, 'stackRule')) requireThat(statusStackRules.includes(stackRule), '原生状态叠层');
      if (own(rest, 'tickTiming')) requireThat(statusTickTimings.includes(tickTiming), '原生状态时机');
      if (own(rest, 'expireInto')) requireThat(expireInto === template.expireInto, '状态到期目标');
      if (own(rest, 'amount')) requireThat(own(template.modifiers, 'amount') && num(amount, 0, 1e9), '护盾池');
    } else requireThat(['modifiers', 'stackRule', 'tickTiming', 'expireInto', 'amount'].every(field => !own(rest, field)), 'VM 状态字段');
    statusTemplate(definition, key, state);
    const maxStacks = v.maxStacks ?? template?.maxStacks ?? 1;
    requireThat(templateId === key && template && id(owner) && (ownerId === undefined || owner === ownerId) && (sourceId === null || id(sourceId))
      && int(maxStacks, 1, stackCapLimit(template)) && int(stacks, 1, maxStacks)
      && int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType) && stackModes.includes(v.stackMode), 'VM 状态实例');
    if (own(v, 'vars')) table(vars, entry => requireThat(jsonTree(entry), 'VM 状态变量'));
    if (own(v, 'pools')) poolBindings(pools);
    return;
  }
  const t = getStatusTemplate(state, key);
  requireThat(id(key) && t?.modifiers, '状态 ID');
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers', 'stacks', 'sourceUnitId'], ['appliedRound', 'appliedTurn', 'amount', 'expireInto', 'expireOn', 'holdTotal', 'stackMode', ...carrierFields]);
  checkOptional(v, 'stackMode', mode => stackModes.includes(mode));
  carrierFieldsValue(v, state, true);
  checkOptional(v,'holdTotal',x=>v.id==='suppressed' && Number.isFinite(x));
  checkOptional(v, 'expireOn', x => x === null || nativeExpiry(x));
  requireThat(v.expireInto === t.expireInto, '状态到期目标');
  requireThat(v.id === key && statusLabels.every(k => v[k] === t[k]) && statusLifetime(v)
    && int(v.maxStacks, 1, stackCapLimit(t)) && int(v.stacks, 1, v.maxStacks)
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
const protocolUnitKeys = ['mainHand','offHand','shield','bodyLengthM','tier','mc','nonLethal','intent','bonusDice','penaltyDice','stance','protagonist','moraleType','moraleState','greatswordMode','parryQuota','parryRefunded','attunementCharges','blockMode','initiativePercent','attackInit','actionInit','flatInitiative','lockedTargetId','moraleCheckedRound','maneuvers'];
export function unitValue(v, key, state) {
  fields(v, unitKeys, ['initialMaxHp','initialMaxMp','initialMaxSp','moved','reactionAvailable', ...protocolUnitKeys, 'fled', 'diedAt', 'corpseOf', 'corpseConsumed', 'creatureType', 'resources', 'inventory', 'bagWeapons', 'altitude', ...carrierFields, 'pools', 'templateId', 'sourceId', 'summonGroup', 'summoned']);
  carrierFieldsValue(v, state, true);
  if (own(v, 'pools')) poolBindings(v.pools);
  for (const k of ['templateId', 'sourceId']) checkOptional(v, k, id);
  checkOptional(v, 'summonGroup', group => text(group, 512));
  if (own(v, 'altitude')) requireThat(int(v.altitude, 0, 12), '离地高度');
  checkOptional(v, 'summoned', x => x === true);
  for (const key of ['initialMaxHp', 'initialMaxMp', 'initialMaxSp']) checkOptional(v, key, x => int(x, 0, 1000000000));
  checkOptional(v, 'moved', x => int(x, 0, 1000000000));
  for (const k of ['fled','corpseConsumed']) checkOptional(v, k, x => typeof x === 'boolean');
  checkOptional(v, 'corpseOf', id);
  checkOptional(v, 'diedAt', x => plain(x) && Object.keys(x).length === 2 && int(x.round, 1, state.round) && int(x.turn, 0, 199));
  checkOptional(v, 'creatureType', x => text(x) || Array.isArray(x) && x.length <= 12 && Array.from(x).every(t => text(t)));
  for (const k of ['resources','inventory']) if (own(v, k)) table(v[k], x => requireThat(int(x, 0, 1e9), k));
  checkOptional(v, 'reactionAvailable', x => typeof x === 'boolean');
  requireThat(v.id === key && text(v.name) && team(v.team) && coord(v.x) && coord(v.y), '棋子');
  list(v.facing, 2, x => int(x, -1, 1), '朝向');
  requireThat(v.facing.length === 2 && v.facing.some(Boolean), '朝向');
  for (const [r, max] of [['hp','maxHp'], ['mp','maxMp'], ['sp','maxSp']]) requireThat((v.pools ? num : int)(v[max], r === 'hp' ? 1 : 0, 1000000000) && (v.pools ? num : int)(v[r], 0, v[max]), r);
  fields(v.used, ['action', 'attack']); fields(v.stats, attrs);
  requireThat(attrs.every(k => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2)
    && (!own(v, 'moved') || num(v.moved, 0, v.move)) && int(v.armor, 0, 1000000) && int(v.size, 1, 5) && int(v.move, 1, 10), '单位数值');
  requireThat(v.weapon === null || id(v.weapon), 'weapon');
  for (const slot of ['mainHand','offHand','shield']) checkOptional(v, slot, x => x === null || id(x));
  checkOptional(v, 'bodyLengthM', x => num(x, .01, 1e9)); checkOptional(v, 'tier', x => int(x, 1, 7));
  checkOptional(v, 'mc', x => int(x, 1, 64)); checkOptional(v, 'nonLethal', x => typeof x === 'boolean');
  checkOptional(v, 'moraleCheckedRound', x => int(x, 1, 1000000));
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
  table(v.statuses, (status, statusId) => statusValue(status, statusId, state, key), maxStatusTemplates + Object.keys(STATUSES).length);
}
function jsonTree(v, depth = 0) {
  if (depth > 12) return false;
  if (v === null || ['string','boolean'].includes(typeof v) || Number.isFinite(v)) return true;
  if (Array.isArray(v)) return v.length <= 500 && Array.from(v).every(x => jsonTree(x, depth + 1));
  return plain(v) && Object.keys(v).length <= 250 && Object.entries(v).every(([key, x]) => !own(Object.prototype, key) && jsonTree(x, depth + 1));
}
function pointValue(value) {
  return plain(value) && Object.keys(value).length === 2 && coord(value.x) && coord(value.y);
}
export function zoneValue(value, key, state) {
  fields(value, ['id', 'name', 'area', 'follow', 'persistent', 'remainingTurns'], ['templateId', 'sourceId', 'team', 'anchorPosition', 'pools', ...carrierFields]);
  checkOptional(value, 'team', value => value === null || team(value));
  requireThat(id(key) && value.id === key && text(value.name), 'VM 区域 ID/名称');
  checkOptional(value, 'templateId', id);
  checkOptional(value, 'sourceId', source => source === null || id(source));
  carrierFieldsValue(value, state, true);
  if (own(value, 'pools')) poolBindings(value.pools);
  const { area, follow, persistent, remainingTurns } = value;
  requireThat(validVmOpcode({ op: 'spawn', entityKind: 'zone', spec: { area, follow, persistent, remainingTurns } }), 'VM 区域');
  requireThat(int(remainingTurns, 1, 100), 'VM 区域持续回合');
  if (['single', 'circle', 'ring'].includes(area.shape)) requireThat(pointValue(area.center), 'VM 区域中心');
  else checkOptional(area, 'center', pointValue);
  if (['circle', 'ring'].includes(area.shape)) requireThat(Number.isFinite(area.radius) && area.radius >= 0, 'VM 区域半径');
  else checkOptional(area, 'radius', radius => Number.isFinite(radius) && radius >= 0);
  if (area.cells) requireThat(area.cells.length <= 100 && area.cells.every(pointValue), 'VM 区域格');
  if (area.rect) requireThat(Object.values(area.rect).every(coord), 'VM 区域矩形');
  requireThat(follow ? id(area.anchorUnitId) && pointValue(value.anchorPosition) : !own(area, 'anchorUnitId') && !own(value, 'anchorPosition'), 'VM 区域锚点');
}
function tapeValue(tape, state) {
  let seq = 0;
  let round = 1;
  list(tape, 100000, record => {
    fields(record, ['seq', 'round', 'turn', 'actorId', 'team', 'actionType', 'skillId', 'targetSpec', 'origin']);
    requireThat(Number.isSafeInteger(record.seq) && record.seq === seq + 1 && int(record.round, round, state.round)
      && int(record.turn, 0, 199) && id(record.actorId) && team(record.team)
      && ['skill', 'attack', 'move'].includes(record.actionType)
      && (record.actionType === 'skill' ? has(state.skills, record.skillId) : record.skillId === null), 'VM 磁带记录');
    const { targetSpec } = record;
    fields(targetSpec, ['x', 'y', 'targetId', 'answers'], ['z']);
    requireThat(coord(targetSpec.x) && coord(targetSpec.y) && (targetSpec.targetId === null || id(targetSpec.targetId)), 'VM 磁带目标');
    checkOptional(targetSpec, 'z', z => int(z, -4, 20));
    list(targetSpec.answers, 2000, answer => id(answer) || Number.isFinite(answer) || pointValue(answer), 'VM 磁带答案');
    requireThat(pointValue(record.origin), 'VM 磁带起点');
    seq = record.seq;
    round = record.round;
    return true;
  }, 'VM 磁带');
}
function validatePools(state) {
  const bindings = new Map();
  const add = (ownerKind, owner) => {
    for (const [key, poolId] of Object.entries(owner.pools ?? {})) {
      const kind = ownerKind === 'unit' && ['hp', 'mp', 'sp'].includes(key) ? key : 'custom';
      const owners = bindings.get(poolId) ?? new Map();
      const ownerKey = `${ownerKind}/${owner.id}`;
      requireThat(!owners.has(ownerKey), '资源池重复绑定');
      owners.set(ownerKey, kind);
      bindings.set(poolId, owners);
    }
  };
  for (const unit of Object.values(state.units)) {
    add('unit', unit);
    for (const status of Object.values(unit.statuses)) add('status', status);
  }
  for (const [kind, collection] of [['item', state.items], ['zone', state.zones ?? {}]]) {
    for (const owner of Object.values(collection)) add(kind, owner);
  }
  const pools = own(state, 'pools') ? state.pools : {};
  requireThat(plain(pools) && Object.keys(pools).length <= 10000, '资源池表');
  for (const [key, pool] of Object.entries(pools)) {
    fields(pool, ['id', 'kind', 'contributors', 'current', 'max', 'reloadable'], ['initialMax']);
    requireThat(validPoolId(key) && pool.id === key && ['hp', 'mp', 'sp', 'custom'].includes(pool.kind)
      && num(pool.max, 0, Number.MAX_VALUE) && (!own(pool, 'initialMax') || num(pool.initialMax, 0, Number.MAX_VALUE))
      && num(pool.current, 0, pool.max) && typeof pool.reloadable === 'boolean', '资源池');
    const owners = bindings.get(key);
    requireThat(owners?.size > 0 && (pool.kind !== 'custom' || owners.size === 1), '资源池归属');
    list(pool.contributors, 200, contribution => {
      fields(contribution, ['ownerKind', 'ownerId', 'maxBase'], ['initialMaxBase']);
      const ownerKey = `${contribution.ownerKind}/${contribution.ownerId}`;
      return id(contribution.ownerId) && owners.get(ownerKey) === pool.kind
        && num(contribution.maxBase, 0, Number.MAX_VALUE)
        && (!own(contribution, 'initialMaxBase') || num(contribution.initialMaxBase, 0, Number.MAX_VALUE)) && owners.delete(ownerKey);
    }, '资源池贡献者');
    requireThat(owners.size === 0, '资源池绑定');
    if (own(pool, 'initialMax')) {
      const initialTotal = pool.contributors.reduce((sum, contribution) => sum + (contribution.initialMaxBase ?? contribution.maxBase), 0);
      requireThat(pool.initialMax === initialTotal, '资源池初始上限');
    }
    bindings.delete(key);
  }
  requireThat(bindings.size === 0, '资源池引用');
  for (const unit of Object.values(state.units)) {
    for (const [kind, maxKey] of [['hp', 'maxHp'], ['mp', 'maxMp'], ['sp', 'maxSp']]) {
      const pool = pools[unit.pools?.[kind]];
      if (pool) {
        const initialKey = `initialMax${kind[0].toUpperCase()}${kind.slice(1)}`;
        const contributor = pool.contributors.find(row => row.ownerKind === 'unit' && row.ownerId === unit.id);
        requireThat(pool.current === unit[kind] && pool.max === unit[maxKey]
          && (!own(unit, initialKey) || unit[initialKey] === (contributor?.initialMaxBase ?? pool.initialMax ?? pool.max)), '原生资源镜像');
      }
    }
  }
}
export function validateState(s) {
  fields(s, ['scenarioId','title','mode','ruleset','round','turn','order','units','items','equipment','skills','grid','covers','interactives','rng','logs','outcome'], ['statusTemplates','zones','time','summonTemplates','spatialTerrain','spatialSerial','battleType','battleConclusion','suppressingTeam','vm','pools','tape']);
  requireThat(s.battleType === 'suppress' ? ['blue','red'].includes(s.suppressingTeam) : s.suppressingTeam === undefined, '压制方');
  checkOptional(s,'battleType',x=>typeof x==='string' && Object.hasOwn(MORALE,x));
  checkOptional(s,'battleConclusion',x=>typeof x==='string' && x.trim().length>0 && s.outcome != null);
  if (own(s, 'time')) {
    fields(s.time, ['raw','hour','minute','timeOfDay','calendar']);
    requireThat(text(s.time.raw, 500) && typeof s.time.calendar === 'string' && s.time.calendar.length <= 500 && int(s.time.hour, 0, 23)
      && int(s.time.minute, 0, 59) && s.time.timeOfDay === timeOfDay(s.time.hour, s.time.minute), 'time');
  }
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
  table(s.items, (v, k) => {
    fields(v, ['id','templateId'], ['name', 'sourceId', 'ownerId', 'counters', 'pools', ...carrierFields]);
    requireThat(v.id === k && has(s.equipment, v.templateId), '装备实例');
    checkOptional(v, 'name', text);
    checkOptional(v, 'sourceId', source => source === null || id(source));
    checkOptional(v, 'ownerId', owner => owner === null || id(owner));
    carrierFieldsValue(v, s, true);
    if (own(v, 'counters')) table(v.counters, value => requireThat(int(value, 0, 1e9), '原生计数器'));
    if (own(v, 'pools')) poolBindings(v.pools);
  });
  table(s.covers, (v, k) => {
    fields(v, ['id','name','x','y','material','hp','maxHp','cover'], ['z']);
    requireThat(!own(v,'z') || int(v.z,-4,8), '掩体高度');
    requireThat(v.id === k && text(v.name) && text(v.material) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== 'wall'
      && int(v.maxHp, 1, 1000000000) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), '掩体');
  });
  if (own(s, 'zones')) table(s.zones, (v, k) => zoneValue(v, k, s), 200);
  if (own(s, 'spatialSerial')) {
    fields(s.spatialSerial, [], ['item', 'summon', 'zone', 'terrain', 'cover']);
    requireThat(Object.values(s.spatialSerial).every(serial => int(serial, 0, Number.MAX_SAFE_INTEGER)), '空间实例编号');
  }
  if (own(s, 'spatialTerrain')) table(s.spatialTerrain, (v, k) => {
    fields(v, ['id', 'spec', 'cells', 'coverIds', 'persistent', 'remainingTurns']);
    requireThat(v.id === k && typeof v.persistent === 'boolean' && int(v.remainingTurns, 1, 100), '地形效果');
    list(v.cells, 100, cell => {
      fields(cell, ['x', 'y', 'before']);
      validateCell(cell.before);
      return coord(cell.x) && coord(cell.y);
    }, '地形变更');
    list(v.coverIds, 100, id, '临时掩体');
    requireThat(!(v.cells.length && v.coverIds.length) && validVmOpcode({ op: 'spawn', entityKind: v.coverIds.length ? 'cover' : 'terrain', spec: v.spec }), '地形声明');
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
  });
  if (own(s, 'vm')) requireThat(validVmState(s), 'VM 运行状态');
  if (own(s, 'tape')) tapeValue(s.tape, s);
  validatePools(s);
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
