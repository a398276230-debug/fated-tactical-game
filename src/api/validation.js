import { getStatusTemplate, STATUSES } from '../core/combat.js';

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
const damageTypes = ['physical', 'energy', 'mental', 'true'];
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
  requireThat(int(v.count, 1, 12) && int(v.sides, 2, 100), '伤害骰');
  checkOptional(v, 'bonus', x => int(x, -50, 100)); checkOptional(v, 'stat', x => attrs.includes(x));
  checkOptional(v, 'multiplier', x => num(x, 0, 8)); checkOptional(v, 'type', x => damageTypes.includes(x));
}
// Only modifiers the existing tactical engine can apply without ID-specific lifecycle logic.
const customModifiers = {
  damage: x => int(x, 1, 50), damageType: x => damageTypes.includes(x), heal: x => int(x, 1, 50),
  movement: x => int(x, -3, 3), armor: x => int(x, -10, 10),
  accuracy: x => int(x, -10, 10), incomingAccuracy: x => int(x, -10, 10),
  advantage: x => int(x, 1, 3), disadvantage: x => int(x, 1, 3),
  reduction: x => num(x, 0, 1), vulnerability: x => num(x, 0, 1), reflect: x => int(x, 1, 30),
};
function statusLifetime(v) {
  return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType)
    && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
}
export function statusTemplate(v, key = v?.id) {
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers']);
  requireThat(id(key) && !own(STATUSES, key) && v.id === key, '自定义状态 ID');
  requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300)
    && ['buff', 'debuff', 'control', 'dot', 'hot'].includes(v.category), '状态名/图标/描述/类别');
  requireThat(statusLifetime(v) && int(v.maxStacks, 1, 10), '状态时长/层数');
  fields(v.modifiers, [], Object.keys(customModifiers));
  requireThat(Object.keys(v.modifiers).length > 0 && (!own(v.modifiers, 'damageType') || own(v.modifiers, 'damage')), '状态特效');
  for (const [key, check] of Object.entries(customModifiers)) checkOptional(v.modifiers, key, check);
}
export function statusTemplateTable(v) { table(v, statusTemplate, maxStatusTemplates); }

const effectSpecs = {
  kill_charge_weapon: { counterKey: id, bonusPerStack: x => num(x, 0, 2), maxStacks: x => int(x, 1, 50) },
  ammo: { counterKey: id, capacity: x => int(x, 1, 50), armorPierce: x => int(x, 0, 50), highGroundRange: x => int(x, 0, 6), highGroundAccuracy: x => int(x, 0, 12) },
  frost_thorns: { damage: x => int(x, 0, 50), chance: x => num(x, 0, 1), statusId: (x, s) => id(x) && !!getStatusTemplate(s, x) },
  backstab: { bonusMultiplier: x => num(x, 0, 4), bleedStacks: x => int(x, 1, 5), comboDamage: x => int(x, 0, 50) },
  healing_shield: { healBonus: x => num(x, 0, 4), shieldRatio: x => num(x, 0, 4) },
  status: { statusId: (x, s) => id(x) && !!getStatusTemplate(s, x), turns: x => int(x, 1, 100), stacks: x => int(x, 1, 10), amount: x => int(x, 1, 500) },
  knockback: { distance: x => int(x, 1, 5), collisionDamage: x => int(x, 0, 80) },
  teleport_backstab: { bonusMultiplier: x => num(x, 0, 4) },
  cleanse: {},
  opportunity_root: {},
};
function effects(v, kinds, state) {
  requireThat(Array.isArray(v) && v.length <= 12, 'effects');
  const seen = new Set();
  for (const e of v) {
    requireThat(plain(e) && kinds.includes(e.kind), 'effect kind');
    const spec = effectSpecs[e.kind], keys = Object.keys(spec);
    const required = e.kind === 'status' ? ['statusId'] : keys;
    fields(e, ['kind', ...required], keys.filter(k => !required.includes(k)));
    for (const [key, check] of Object.entries(spec)) checkOptional(e, key, x => check(x, state));
    if (e.kind === 'status' && !has(STATUSES, e.statusId)) {
      requireThat(!own(e, 'amount'), 'amount 仅用于护盾');
      checkOptional(e, 'stacks', x => int(x, 1, getStatusTemplate(state, e.statusId).maxStacks));
    }
    requireThat(!seen.has(e.counterKey ?? e.kind) || e.kind === 'status', '重复特效');
    seen.add(e.counterKey ?? e.kind);
  }
}
export function equipmentTemplate(v, state) {
  fields(v, ['name', 'effects'], ['range', 'accuracy', 'damage', 'armor']);
  requireThat(text(v.name), 'name');
  checkOptional(v, 'range', x => int(x, 1, 15)); checkOptional(v, 'accuracy', x => int(x, -20, 30));
  checkOptional(v, 'armor', x => int(x, 0, 40)); if (own(v, 'damage')) dice(v.damage);
  requireThat(own(v, 'range') === own(v, 'damage'), '武器 range/damage');
  effects(v.effects, ['kill_charge_weapon', 'ammo', 'frost_thorns', 'backstab', 'healing_shield', 'opportunity_root'], state);
  requireThat(v.effects.every(e => ['kill_charge_weapon', 'ammo', 'backstab', 'opportunity_root'].includes(e.kind) === own(v, 'damage')), '装备特效不匹配');
}
export function skillTemplate(v, state) {
  fields(v, ['name', 'ap', 'slot', 'range', 'shape', 'target', 'effects'], ['mp', 'sp', 'radius', 'width', 'accuracy', 'save', 'saveDC', 'damage', 'heal']);
  requireThat(text(v.name) && int(v.ap, 1, 2) && ['attack', 'action'].includes(v.slot) && int(v.range, 0, 15)
    && ['single', 'circle', 'fan', 'cone', 'line'].includes(v.shape) && ['enemy', 'ally', 'self', 'any'].includes(v.target), '技能');
  for (const k of ['mp', 'sp']) checkOptional(v, k, x => int(x, 0, 100));
  for (const k of ['radius', 'width']) checkOptional(v, k, x => int(x, 0, 6));
  checkOptional(v, 'accuracy', x => int(x, -20, 30)); checkOptional(v, 'save', x => attrs.includes(x));
  checkOptional(v, 'saveDC', x => int(x, 1, 50));
  requireThat(own(v, 'save') === own(v, 'saveDC'), 'save/saveDC');
  for (const k of ['damage', 'heal']) if (own(v, k)) dice(v[k]);
  effects(v.effects, ['status', 'knockback', 'teleport_backstab', 'cleanse'], state);
}
export function statusValue(v, key, state) {
  const t = getStatusTemplate(state, key);
  requireThat(id(key) && t, '状态 ID');
  fields(v, ['id', ...statusLabels, 'remainingTurns', 'durationType', 'tickTiming', 'stackRule', 'maxStacks', 'modifiers', 'stacks', 'sourceUnitId'], ['appliedRound', 'appliedTurn', 'amount']);
  requireThat(v.id === key && statusLabels.every(k => v[k] === t[k]) && statusLifetime(v)
    && int(v.maxStacks, 1, t.maxStacks) && int(v.stacks, 1, v.maxStacks)
    && (v.sourceUnitId === null || id(v.sourceUnitId)), '状态实例');
  fields(v.modifiers, Object.keys(t.modifiers));
  for (const [k, def] of Object.entries(t.modifiers)) requireThat(v.modifiers[k] === def
    || (key === 'guarded' && k === 'reduction' && v.modifiers[k] === .5), `状态参数 ${k}`);
  checkOptional(v, 'appliedRound', x => int(x, 1, 1000000)); checkOptional(v, 'appliedTurn', x => int(x, 0, 199));
  requireThat(key === 'shield' ? int(v.amount, 1, 10000) : !own(v, 'amount'), '护盾池');
}
export function validateCell(v) {
  fields(v, ['kind', 'z']);
  requireThat(['floor', 'slope', 'wall'].includes(v.kind) && int(v.z, -4, 8), '地形');
}
const unitKeys = ['id','name','team','x','y','facing','hp','maxHp','mp','maxMp','sp','maxSp','ap','used','stats','armor','size','move','weapon','gear','skills','statuses'];
export function unitValue(v, key, state) {
  fields(v, unitKeys, ['reactionAvailable']);
  checkOptional(v, 'reactionAvailable', x => typeof x === 'boolean');
  requireThat(v.id === key && text(v.name) && team(v.team) && coord(v.x) && coord(v.y), '棋子');
  list(v.facing, 2, x => int(x, -1, 1), '朝向');
  requireThat(v.facing.length === 2 && v.facing.some(Boolean), '朝向');
  for (const [r, max] of [['hp','maxHp'], ['mp','maxMp'], ['sp','maxSp']]) requireThat(int(v[max], r === 'hp' ? 1 : 0, 10000) && int(v[r], 0, v[max]), r);
  fields(v.used, ['action', 'attack']); fields(v.stats, attrs);
  requireThat(attrs.every(k => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2)
    && int(v.armor, 0, 50) && int(v.size, 1, 5) && int(v.move, 1, 10), '单位数值');
  requireThat(v.weapon === null || id(v.weapon), 'weapon');
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
  fields(s, ['scenarioId','title','mode','round','turn','order','units','items','equipment','skills','grid','covers','interactives','rng','logs','outcome'], ['statusTemplates']);
  if (own(s, 'statusTemplates')) statusTemplateTable(s.statusTemplates);
  requireThat(id(s.scenarioId) && text(s.title) && ['free','split'].includes(s.mode) && int(s.round, 1, 1000000) && int(s.rng, 0, 0xffffffff)
    && [null,'blue','red','draw'].includes(s.outcome), '战局');
  requireThat(Array.isArray(s.grid) && s.grid.length === 10, '棋盘');
  for (const row of s.grid) {
    requireThat(Array.isArray(row) && row.length === 10, '棋盘行');
    for (const c of row) validateCell(c);
  }
  table(s.equipment, v => equipmentTemplate(v, s)); table(s.skills, v => skillTemplate(v, s));
  table(s.items, (v, k) => {
    fields(v, ['id','templateId','counters']);
    requireThat(v.id === k && has(s.equipment, v.templateId), '装备实例');
    const counterKeys = s.equipment[v.templateId].effects.filter(e => e.counterKey).map(e => e.counterKey);
    fields(v.counters, counterKeys);
    for (const n of Object.values(v.counters)) requireThat(int(n, 0, 50), '计数器');
  });
  table(s.covers, (v, k) => {
    fields(v, ['id','name','x','y','material','hp','maxHp','cover']);
    requireThat(v.id === k && text(v.name) && text(v.material) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== 'wall'
      && int(v.maxHp, 1, 1000) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), '掩体');
  });
  table(s.interactives, (v, k) => {
    fields(v, ['id','name','x','y','kind','spent']);
    requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== 'wall'
      && ['barrel','altar'].includes(v.kind) && typeof v.spent === 'boolean', '互动点');
  });
  const occupied = new Set(), equipped = new Set();
  table(s.units, (v, k) => {
    unitValue(v, k, s);
    const point = `${v.x},${v.y}`;
    if (v.hp > 0) {
      requireThat(!occupied.has(point) && s.grid[v.y][v.x].kind !== 'wall'
        && !Object.values(s.covers).some(c => c.hp > 0 && c.x === v.x && c.y === v.y), '棋子位置重叠或阻挡');
      occupied.add(point);
    }
    for (const i of [v.weapon, ...v.gear].filter(Boolean)) {
      requireThat(has(s.items, i) && !equipped.has(i) && own(s.equipment[s.items[i].templateId], 'damage') === (i === v.weapon), '装备引用或归属');
      equipped.add(i);
    }
    requireThat(v.skills.every(i => has(s.skills, i)) && new Set(v.skills).size === v.skills.length, '技能引用');
  });
  list(s.order, 200, x => has(s.units, x), '先攻队列');
  requireThat(new Set(s.order).size === s.order.length && int(s.turn, 0, Math.max(0, s.order.length - 1))
    && Object.values(s.units).every(u => u.hp <= 0 || s.order.includes(u.id)), '先攻索引');
  requireThat(Array.isArray(s.logs) && s.logs.length <= 100000, '日志');
  for (const log of s.logs) {
    fields(log, ['round','actor','type','text','detail']);
    requireThat(int(log.round, 1, s.round) && (log.actor === null || id(log.actor)) && text(log.type, 64) && text(log.text, 1000) && jsonTree(log.detail), '日志事件');
  }
  return s;
}
