import { getStatusTemplate, isTapeAction } from '../core/combat.js';
import { canOccupy } from '../core/spatial.js';
import { actionStatuses, STATUSES } from '../presets/status-defaults.js';
import { carrierFlags, damageTypes, durationTypes, skillShapes, skillTargets, stackModes as vmStackModes, zoneAreaShapes } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';

import { INTENTS, MORALE, MORALE_STATES, QUALITY_TIER, STANCES, UNIT_STATS, moraleLabels } from '../core/combat_protocol.js';
import { timeOfDay } from '../core/battle_time.js';
import { validVmOpcode, vmRuleError, vmStatModError, validVmTag, validVmSourceSkillId, validVmExpiry, validVmPureSelector, carrierFields, validCarrierScalar } from '../core/vm-schema.js';
import { validVmState } from '../core/vm-runtime.js';

function validateRules(rules, state) {
  list(rules, 200, () => true, 'VM 规则');
  for (const [index, rule] of rules.entries()) {
    const issue = vmRuleError(rule, { statusTemplates: state?.statusTemplates });
    requireThat(!issue, `VM 规则 rules/${index}${typeof rule?.id === 'string' ? `（${rule.id}）` : ''}/${issue}`);
  }
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
export const inGrid = (state, x, y) => int(y, 0, (state.grid?.length ?? 0) - 1)
  && int(x, 0, (state.grid[y]?.length ?? 0) - 1);
export const attrs = UNIT_STATS;
const statusDurations = durationTypes;
const statusLabels = ['name', 'icon', 'category', 'description'];
const maxStatusStacks = 999999;
export const maxStatusTemplates = 64;
export const has = (record, key) => id(key) && own(record ?? {}, key);
export function fields(v, required, optional = [], entityLabel = '对象') {
  requireThat(plain(v), entityLabel);
  const missing = required.filter(key => !own(v, key));
  const unsupported = Object.keys(v).filter(key => !required.includes(key) && !optional.includes(key));
  if (missing.length) error(`${entityLabel}缺少必填字段：${missing.join('、')}`);
  if (unsupported.length) error(`${entityLabel}包含不支持的字段：${unsupported.join('、')}`);
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
const stackModes = vmStackModes;
const numericExpr = value => Number.isFinite(value) || typeof value === 'string' && validExpr(value);
function carrierFieldsValue(value, state, resolved = false) {
  if (own(value, 'tags')) list(value.tags, 32, resolved ? tag => text(tag) : validVmTag, 'VM 标签');
  if (own(value, 'flags')) list(value.flags, 8, flag => carrierFlags.includes(flag), 'VM 标记');
  checkOptional(value, 'tier', tier => int(tier, 1, 7));
  if (own(value, 'vars')) table(value.vars, entry => requireThat(resolved ? jsonTree(entry)
    : validCarrierScalar(entry), 'VM 变量'));
  if (own(value, 'mods')) list(value.mods, 200, (mod, index) => {
    const error = vmStatModError(mod);
    requireThat(!error, `mods[${index}]：${error}`);
    return true;
  }, 'VM 修饰');
  if (own(value, 'rules')) validateRules(value.rules, state);
  checkOptional(value, 'shareRulesTo', validVmPureSelector);
  if (own(value, 'unitPools')) unitPoolDefinitions(value.unitPools);
}
function unitPoolDefinitions(value) { poolDefinitions(value, true); }
function poolDefinitions(value, unit = false) {
  table(value, definition => {
    fields(definition, ['cap'], ['initial', unit ? 'name' : 'reloadable']);
    requireThat(numericExpr(definition.cap) && (typeof definition.cap !== 'number' || definition.cap >= 0), '资源池上限');
    checkOptional(definition, 'initial', initial => numericExpr(initial) && (typeof initial !== 'number' || initial >= 0
      && (typeof definition.cap !== 'number' || initial <= definition.cap)));
    checkOptional(definition, 'reloadable', flag => typeof flag === 'boolean');
    checkOptional(definition, 'name', name => text(name, 100));
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
  requireThat(!own(value, 'unitPools'), '状态模板不能声明单位池');
  requireThat(id(key) && key === value.id && text(value.name), 'VM 状态 ID/名称');
  checkOptional(value, 'icon', icon => text(icon, 24));
  checkOptional(value, 'description', description => text(description, 300));
  checkOptional(value, 'category', category => text(category, 32));
  checkOptional(value, 'remainingTurns', turns => int(turns, 1, 100));
  checkOptional(value, 'durationType', duration => statusDurations.includes(duration));
  checkOptional(value, 'stackMode', mode => stackModes.includes(mode));
  checkOptional(value, 'maxStacks', validStackCap);
  checkOptional(value, 'expireOn', validVmExpiry);
  carrierFieldsValue(value, state);
}
export function statusTemplateTable(v) {
  const state = { statusTemplates: v };
  table(v, (template, key) => statusTemplate(template, key, state), maxStatusTemplates);
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
const rawDistanceFields = ['rawRange', 'rawRadius', 'rawInnerRadius', 'rawWidth', 'rawMoveDistance'];
function validateAreaDimensions(v) {
  for (const key of rawDistanceFields) checkOptional(v, key, x => num(x, 0, 1000000));
  for (const key of ['radius', 'innerRadius', 'width']) checkOptional(v, key, x => Number.isFinite(x) && x >= 0 && x <= 30);
  checkOptional(v, 'angle', x => int(x, 1, 360));
}
export function equipmentTemplate(v, state) {
  fields(v, ['name'], ['quality','kind','weaponClass','hand','rangeType','ranged','closeQuarters','heavy','twoHanded','shield','range', 'accuracy', 'attack', 'damage', 'armor', 'defense', 'boundTo', 'weaponType', 'shape', 'target', 'radius', 'innerRadius', 'width', 'angle', ...rawDistanceFields, ...carrierFields, 'pools', 'skills']);
  if (own(v, 'skills')) {
    list(v.skills, 32, skillId => state ? has(state.skills, skillId) : id(skillId), '装备技能');
    requireThat(new Set(v.skills).size === v.skills.length, '重复装备技能');
  }
  checkOptional(v, 'boundTo', id); checkOptional(v, 'weaponType', text);
  requireThat(text(v.name), 'name');
  checkOptional(v, 'quality', x => x === '唯一' || Object.hasOwn(QUALITY_TIER, x));
  checkOptional(v, 'range', x => int(x, 0, 64)); checkOptional(v, 'attack', x => int(x, 0, 1000000000)); checkOptional(v, 'accuracy', x => int(x, -100, 100));
  checkOptional(v, 'armor', x => int(x, 0, 1000000)); checkOptional(v, 'defense', x => int(x, 0, 1000000));
  checkOptional(v, 'kind', x => ['weapon','shield','armor','accessory','consumable'].includes(x));
  checkOptional(v, 'weaponClass', x => ['light_blade','ranged','greatsword','staff','shield','auxiliary'].includes(x));
  checkOptional(v, 'hand', x => ['one_handed','two_handed','off_hand'].includes(x)); checkOptional(v, 'rangeType', x => ['melee','ranged'].includes(x));
  for (const field of ['ranged','closeQuarters','heavy','twoHanded','shield']) checkOptional(v, field, x => typeof x === 'boolean');
  checkOptional(v, 'shape', x => skillShapes.includes(x));
  checkOptional(v, 'target', x => skillTargets.filter(target => target !== 'corpse').includes(x));
  validateAreaDimensions(v);
  if (own(v, 'damage')) dice(v.damage);
  requireThat(own(v, 'range') === own(v, 'damage'), '武器 range/damage');
  carrierFieldsValue(v, state);
  if (own(v, 'pools')) poolDefinitions(v.pools);
}
export function skillTemplate(v, state) {
  fields(v, ['name', 'ap', 'slot', 'range', 'shape', 'target'], ['quality','power','mp', 'sp', 'radius', 'innerRadius', 'width', 'angle', 'accuracy', 'save', 'saveDC', 'damage', 'heal', 'resourceCost', 'school', 'damageType','backpackItem', 'initiativeBonus', 'passive', ...rawDistanceFields, ...carrierFields, 'pools']);
  carrierFieldsValue(v, state);
  if (own(v, 'pools')) poolDefinitions(v.pools);
  checkOptional(v, 'backpackItem', flag => flag === true && v.ap === 1 && v.slot === 'action');
  checkOptional(v, 'damageType', type => damageTypes.includes(type));
  checkOptional(v, 'school', text);
  checkOptional(v, 'resourceCost', resourceCost);
  checkOptional(v, 'initiativeBonus', value => int(value, -100, 100));
  checkOptional(v, 'passive', value => typeof value === 'boolean');
  requireThat(text(v.name) && int(v.ap, 0, 2) && ['attack', 'action'].includes(v.slot) && int(v.range, 0, 64)
    && skillShapes.includes(v.shape) && skillTargets.includes(v.target), '技能');
  checkOptional(v, 'power', x => int(x, 0, 1000000000));
  for (const k of ['mp', 'sp']) checkOptional(v, k, x => int(x, 0, 25000));
  validateAreaDimensions(v);
  checkOptional(v, 'accuracy', x => int(x, -100, 100)); checkOptional(v, 'save', x => attrs.includes(x));
  checkOptional(v, 'saveDC', dc => validSaveDC(dc) || typeof dc === 'string' && validExpr(dc));
  requireThat(own(v, 'save') === own(v, 'saveDC'), 'save/saveDC');
  for (const k of ['damage', 'heal']) if (own(v, k)) dice(v[k]);
}
export function statusValue(v, key, state, ownerId) {
  if (own(v ?? {}, 'templateId')) {
    const { templateId, ownerId: owner, sourceId, sourceCarrier, authorityRank, sourceTier, effectiveTier, stacks, pools, appliedRound, appliedTurn, ...rest } = v;
    const template = getStatusTemplate(state, key);
    const { vars, ...definition } = rest;
    if (sourceCarrier != null) {
      fields(sourceCarrier, ['type', 'id'], ['ownerId']);
      requireThat(['unit', 'skill', 'status', 'item', 'zone'].includes(sourceCarrier.type)
        && validVmSourceSkillId(sourceCarrier.id), '状态来源载体');
      checkOptional(sourceCarrier, 'ownerId', id);
    }
    if (appliedRound !== undefined || appliedTurn !== undefined) requireThat(int(appliedRound, 1, 1000000) && int(appliedTurn, 0, 199), '状态施加回合');
    checkOptional(v, 'effectiveTier', x => int(x, 1, 7));
    if (own(v, 'authorityRank') || own(v, 'sourceTier')) requireThat(int(authorityRank, 1, 8) && int(sourceTier, 1, 7), '状态来源位格');
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
  requireThat(id(key) && t, '状态 ID');
  fields(v, ['id', 'templateId', 'ownerId', 'name', 'remainingTurns', 'durationType', 'stackMode', 'maxStacks', 'stacks'], ['icon', 'category', 'description', 'sourceId', 'sourceCarrier', 'authorityRank', 'sourceTier', 'effectiveTier', 'appliedRound', 'appliedTurn', 'expireOn', ...carrierFields]);
  carrierFieldsValue(v, state, true);
  checkOptional(v, 'expireOn', x => x === null || validVmExpiry(x));
  requireThat(v.id === key && v.templateId === key && v.name === t.name && int(v.maxStacks, 1, stackCapLimit(t))
    && int(v.stacks, 1, v.maxStacks) && int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType)
    && stackModes.includes(v.stackMode) && id(v.ownerId) && (ownerId === undefined || v.ownerId === ownerId)
    && (v.sourceId === null || v.sourceId === undefined || id(v.sourceId)), 'VM 状态实例');
  if (own(v, 'vars')) table(v.vars, entry => requireThat(jsonTree(entry), 'VM 状态变量'));
}
export function validateCell(v) {
  fields(v, ['kind', 'z']);
  requireThat(['floor', 'slope', 'wall'].includes(v.kind) && int(v.z, -4, 8), '地形');
}
const unitKeys = ['id','name','team','x','y','facing','hp','maxHp','mp','maxMp','sp','maxSp','ap','used','stats','armor','size','move','weapon','gear','skills','statuses'];
const protocolUnitKeys = ['followupUsed','level','mainHand','offHand','shield','bodyLengthM','tier','mc','nonLethal','intent','bonusDice','penaltyDice','stance','protagonist','moraleType','moraleState','greatswordMode','attunementCharges','initiativePercent','attackInit','actionInit','flatInitiative','lockedTargetId','moraleCheckedRound'];
export function unitValue(v, key, state) {
  fields(v, unitKeys, ['initialMaxHp','initialMaxMp','initialMaxSp','apMax','moved','rawMove','moveM','moveCarryPermille','lastMoveDir','remainingTurns','moveSpent','reactionAvailable', ...protocolUnitKeys, 'fled', 'diedAt', 'corpseOf', 'corpseConsumed', 'creatureType', 'resources', 'inventory', 'bagWeapons', 'altitude', ...carrierFields, 'pools', 'templateId', 'sourceId', 'sourceSkillId', 'summonGroup', 'summoned']);
  carrierFieldsValue(v, state, true);
  if (own(v, 'pools')) poolBindings(v.pools);
  for (const k of ['templateId', 'sourceId']) checkOptional(v, k, id);
  checkOptional(v, 'sourceSkillId', skillId => v.summoned === true && validVmSourceSkillId(skillId));
  checkOptional(v, 'summonGroup', group => text(group, 512));
  if (own(v, 'altitude')) requireThat(int(v.altitude, 0, 12), '离地高度');
  checkOptional(v, 'summoned', x => x === true);
  for (const key of ['initialMaxHp', 'initialMaxMp', 'initialMaxSp', 'apMax']) checkOptional(v, key, x => int(x, 0, 1000000000));
  checkOptional(v, 'moved', x => int(x, 0, 1000000000));
  checkOptional(v, 'rawMove', x => num(x, 0, 1000));
  checkOptional(v, 'moveM', x => num(x, 0, 1000000));
  checkOptional(v, 'moveCarryPermille', x => int(x, 0, 999));
  checkOptional(v, 'lastMoveDir', x => x === null || ['N', 'S', 'E', 'W'].includes(x));
  checkOptional(v, 'remainingTurns', x => int(x, 1, 100));
  checkOptional(v, 'moveSpent', x => int(x, 0, 1000000000));
  for (const k of ['fled','corpseConsumed']) checkOptional(v, k, x => typeof x === 'boolean');
  checkOptional(v, 'corpseOf', id);
  checkOptional(v, 'diedAt', x => plain(x) && Object.keys(x).length === 2 && int(x.round, 1, state.round) && int(x.turn, 0, 199));
  checkOptional(v, 'creatureType', x => text(x) || Array.isArray(x) && x.length <= 12 && Array.from(x).every(t => text(t)));
  for (const k of ['resources','inventory']) if (own(v, k)) table(v[k], x => requireThat(int(x, 0, 1e9), k));
  checkOptional(v, 'reactionAvailable', x => typeof x === 'boolean');
  requireThat(v.id === key && text(v.name) && team(v.team) && inGrid(state, v.x, v.y), '棋子');
  list(v.facing, 2, x => int(x, -1, 1), '朝向');
  requireThat(v.facing.length === 2 && v.facing.some(Boolean), '朝向');
  for (const [r, max] of [['hp','maxHp'], ['mp','maxMp'], ['sp','maxSp']]) requireThat((v.pools ? num : int)(v[max], r === 'hp' ? 1 : 0, 1000000000) && (v.pools ? num : int)(v[r], 0, v[max]), r);
  fields(v.used, ['action', 'attack']); fields(v.stats, attrs);
  requireThat(attrs.every(k => int(v.stats[k], -20, 50)) && int(v.ap, 0, v.apMax ?? 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2)
    && int(v.armor, 0, 1000000) && int(v.size, 1, 5) && int(v.move, 0, 1000000), '单位数值');
  requireThat(v.weapon === null || id(v.weapon), 'weapon');
  for (const slot of ['mainHand','offHand','shield']) checkOptional(v, slot, x => x === null || id(x));
  checkOptional(v, 'bodyLengthM', x => num(x, .01, 1e9)); checkOptional(v, 'tier', x => int(x, 1, 7));
  checkOptional(v, 'mc', x => int(x, 1, 64)); checkOptional(v, 'nonLethal', x => typeof x === 'boolean');
  checkOptional(v, 'moraleCheckedRound', x => int(x, 1, 1000000));
  checkOptional(v, 'initiativePercent', x => num(x, -1, 10)); checkOptional(v, 'flatInitiative', x => int(x, -1000, 1000));
  for (const field of ['attackInit','actionInit']) checkOptional(v, field, x => Array.isArray(x) && x.length <= 16 && x.every(n => int(n, -1000, 1000)));
  checkOptional(v, 'followupUsed', x => typeof x === 'boolean');
  checkOptional(v, 'level', x => Number.isSafeInteger(x) && x >= 1);
  checkOptional(v, 'lockedTargetId', x => x === null || id(x));
  checkOptional(v, 'intent', x => typeof x === 'string' && Object.hasOwn(INTENTS, x));
  checkOptional(v, 'bonusDice', x => int(x, 0, 2)); checkOptional(v, 'penaltyDice', x => int(x, 0, 1));
  checkOptional(v, 'stance', x => STANCES.includes(x)); checkOptional(v, 'protagonist', x => x === true); checkOptional(v, 'moraleType', x => typeof x === 'string' && Object.hasOwn(MORALE,x)); checkOptional(v, 'moraleState', x => MORALE_STATES.includes(x));
  checkOptional(v, 'greatswordMode', x => ['offensive','defensive'].includes(x)); checkOptional(v, 'attunementCharges', x => int(x, 0, 2));
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
function pointValue(state, value) {
  return plain(value) && Object.keys(value).length === 2 && inGrid(state, value.x, value.y);
}
export function zoneValue(value, key, state) {
  fields(value, ['id', 'name', 'area', 'follow', 'persistent', 'remainingTurns'], ['templateId', 'sourceId', 'team', 'anchorPosition', 'pools', ...carrierFields]);
  checkOptional(value, 'team', value => value === null || team(value));
  requireThat(id(key) && value.id === key && text(value.name), 'VM 区域 ID/名称');
  checkOptional(value, 'templateId', id);
  checkOptional(value, 'sourceId', source => source === null || id(source));
  requireThat(value.sourceId != null || !own(value, 'unitPools'), '无主区域不能声明单位池');
  carrierFieldsValue(value, state, true);
  if (own(value, 'pools')) poolBindings(value.pools);
  const { area, follow, persistent, remainingTurns } = value;
  requireThat(zoneAreaShapes.includes(area.shape), 'VM 区域形状');
  checkOptional(area, 'z1', z => int(z, -4, 20));
  checkOptional(area, 'z2', z => int(z, -4, 20));
  if (own(area, 'z1') && own(area, 'z2')) requireThat(area.z1 <= area.z2, 'VM 区域高度区间');
  requireThat(validVmOpcode({ op: 'spawn', entityKind: 'zone', spec: { area, follow, persistent, remainingTurns } }), 'VM 区域');
  requireThat(int(remainingTurns, 1, 100), 'VM 区域持续回合');
  const validPoint = point => pointValue(state, point);
  if (['single', 'circle', 'ring'].includes(area.shape)) requireThat(validPoint(area.center), 'VM 区域中心');
  else checkOptional(area, 'center', validPoint);
  if (['circle', 'ring'].includes(area.shape)) requireThat(Number.isFinite(area.radius) && area.radius >= 0, 'VM 区域半径');
  else checkOptional(area, 'radius', radius => Number.isFinite(radius) && radius >= 0);
  if (area.cells) requireThat(area.cells.length <= 400 && area.cells.every(validPoint), 'VM 区域格');
  if (area.rect) requireThat(inGrid(state, area.rect.x1, area.rect.y1) && inGrid(state, area.rect.x2, area.rect.y2), 'VM 区域矩形');
  requireThat(follow ? id(area.anchorUnitId) && validPoint(value.anchorPosition) : !own(area, 'anchorUnitId') && !own(value, 'anchorPosition'), 'VM 区域锚点');
}
function tapeValue(tape, state) {
  let seq = 0;
  let round = 1;
  list(tape, 100000, record => {
    fields(record, ['seq', 'round', 'turn', 'actorId', 'team', 'actionType', 'skillId', 'targetSpec', 'origin'],
      ['aimed', 'interactiveId', 'parameters']);
    requireThat(Number.isSafeInteger(record.seq) && record.seq === seq + 1 && int(record.round, round, state.round)
      && int(record.turn, 0, 199) && id(record.actorId) && team(record.team)
      && isTapeAction(record.actionType)
      && (record.actionType === 'skill' ? validVmSourceSkillId(record.skillId) : record.skillId === null), 'VM 磁带记录');
    checkOptional(record, 'aimed', value => value === false);
    checkOptional(record, 'interactiveId', value => id(value) && ['attack', 'interact'].includes(record.actionType));
    if (own(record, 'parameters')) {
      const { parameters } = record;
      fields(parameters, [], ['itemId', 'maneuver', 'intent', 'nonLethal', 'bonusDice']);
      checkOptional(parameters, 'itemId', value => record.actionType === 'switch_weapon' && id(value));
      checkOptional(parameters, 'maneuver', value => typeof value === 'string');
      checkOptional(parameters, 'intent', value => ['normal', 'function', 'core', 'kill', 'concept'].includes(value));
      checkOptional(parameters, 'nonLethal', value => typeof value === 'boolean');
      checkOptional(parameters, 'bonusDice', value => int(value, 0, 2));
    }
    const { targetSpec } = record;
    fields(targetSpec, ['x', 'y', 'targetId', 'answers'], ['z']);
    requireThat(inGrid(state, targetSpec.x, targetSpec.y) && (targetSpec.targetId === null || id(targetSpec.targetId)), 'VM 磁带目标');
    checkOptional(targetSpec, 'z', z => int(z, -4, 20));
    list(targetSpec.answers, 2000, answer => id(answer) || Number.isFinite(answer) || pointValue(state, answer)
      || Array.isArray(answer) && answer.length > 0 && answer.length <= 200 && answer.every(id), 'VM 磁带答案');
    requireThat(pointValue(state, record.origin), 'VM 磁带起点');
    seq = record.seq;
    round = record.round;
    return true;
  }, 'VM 磁带');
}
export function validatePools(state) {
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
    if (!owners?.size) error(`资源池 ${key} 是无人引用的孤儿池`);
    if (pool.kind === 'custom' && owners.size > 1) {
      error(`自定义资源池 ${key} 被多个实体重复绑定（${[...owners.keys()].join('、')}）。请在模板 /equipment/<id>/pools 或 /skills/<id>/pools 声明自定义池，实例 /units/.../pools 或 /items/.../pools 只保存绑定。`);
    }
    list(pool.contributors, 200, contribution => {
      fields(contribution, ['ownerKind', 'ownerId', 'maxBase'], ['initialMaxBase']);
      const ownerKey = `${contribution.ownerKind}/${contribution.ownerId}`;
      return id(contribution.ownerId) && owners.get(ownerKey) === pool.kind
        && num(contribution.maxBase, 0, Number.MAX_VALUE)
        && (!own(contribution, 'initialMaxBase') || num(contribution.initialMaxBase, 0, Number.MAX_VALUE)) && owners.delete(ownerKey);
    }, '资源池贡献者');
    if (owners.size) error(`资源池 ${key} 的贡献者未完整匹配：${[...owners.keys()].join('、')}`);
    if (own(pool, 'initialMax')) {
      const initialTotal = pool.contributors.reduce((sum, contribution) => sum + (contribution.initialMaxBase ?? contribution.maxBase), 0);
      requireThat(pool.initialMax === initialTotal, '资源池初始上限');
    }
    bindings.delete(key);
  }
  if (bindings.size) error(`资源池引用错误：${[...bindings.keys()].join('、')} 未在资源池表中声明（或存在无效 poolId）`);
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
  fields(s, ['scenarioId','title','mode','ruleset','round','turn','order','units','items','equipment','skills','grid','covers','interactives','rng','logs','outcome'], ['statusTemplates','zones','time','summonTemplates','spatialTerrain','spatialSerial','battleType','battleConclusion','suppressingTeam','vm','pools','tape','scale']);
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
  requireThat(Array.isArray(s.grid) && int(s.grid.length, 8, 20), '棋盘');
  const width = s.grid[0]?.length;
  requireThat(int(width, 8, 20), '棋盘宽度');
  if (own(s, 'scale')) {
    fields(s.scale, ['cellM', 'width', 'height', 'anchorTier'], ['explicit']);
    requireThat(num(s.scale.cellM, 1, 10000) && int(s.scale.anchorTier, 1, 7)
      && s.scale.width === width && s.scale.height === s.grid.length, '战场比例尺');
    checkOptional(s.scale, 'explicit', value => typeof value === 'boolean');
  } else requireThat(width === 10 && s.grid.length === 10, '棋盘比例尺');
  for (const row of s.grid) {
    requireThat(Array.isArray(row) && row.length === width, '棋盘行');
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
    requireThat(v.id === k && text(v.name) && text(v.material) && inGrid(s, v.x, v.y) && s.grid[v.y][v.x].kind !== 'wall'
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
    list(v.cells, 400, cell => {
      fields(cell, ['x', 'y', 'before']);
      validateCell(cell.before);
      return inGrid(s, cell.x, cell.y);
    }, '地形变更');
    list(v.coverIds, 100, id, '临时掩体');
    requireThat(!(v.cells.length && v.coverIds.length) && validVmOpcode({ op: 'spawn', entityKind: v.coverIds.length ? 'cover' : 'terrain', spec: v.spec }), '地形声明');
  }, 64);
  table(s.interactives, (v, k) => {
    fields(v, ['id','name','x','y','kind','spent'], ['z','effect','radius','damage']);
    requireThat(v.id === k && text(v.name) && inGrid(s, v.x, v.y) && (!own(v,'z') || int(v.z, -4, 8)) && s.grid[v.y][v.x].kind !== 'wall'
      && ['barrel','altar'].includes(v.kind) && (!own(v,'effect') || ['explode','heal','shield','restore'].includes(v.effect))
      && (!own(v,'radius') || int(v.radius, 0, 10)) && (!own(v,'damage') || int(v.damage, 0, 100000)) && typeof v.spent === 'boolean', '互动点');
  });
  const equipped = new Set();
  table(s.units, (v, k) => {
    unitValue(v, k, s);
    if (v.hp > 0 && !v.fled) requireThat(canOccupy(s, v.x, v.y, v), '棋子位置超容量或阻挡');
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
      && (!log.positions || plain(log.positions) && Object.values(log.positions).every(point => plain(point) && inGrid(s, point.x, point.y) && (!own(point,'z') || int(point.z,-4,20)))), '日志事件');
  }
  return s;
}
