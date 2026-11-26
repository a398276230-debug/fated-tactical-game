import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { id as validId, validateState } from '../api/validation.js';
import { DISTANCE_TABLE, sizeClassFor, stanceFor, moraleTypeFor, TIER_CELL_M, QUALITY_TIER, resolveEffectiveTier, scaledCells } from '../core/combat_protocol.js';
import { validVmRule, validVmStatMod } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';
import { initializeVMWorld } from '../core/vm-runtime.js';
import { STATUSES } from '../presets/status-defaults.js';
import { canOccupy } from '../core/spatial.js';
import { parseBattleDescriptor } from './descriptor.js';
import { createBattleGrid } from './terrain.js';
import { parseBattleTime } from '../core/battle_time.js';
import { parseAreaTags, tagEntries } from './area-tags.js';

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
const own = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const asObject = v => object(v) ? v : {};
const finite = v => typeof v === 'number' && Number.isFinite(v);
const number = (v, fallback = 0) => {
  if (finite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
const integer = (v, fallback = 0) => Math.round(number(v, fallback));
const text = v => typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
const clone = v => structuredClone(v);
export { resolveEffectiveTier };
const QUALITY_NAMES = new Set([...Object.keys(QUALITY_TIER), '唯一']);
export function defaultCoverHp(cellM, isFullCover = false) {
  const base = isFullCover ? 25 : 10;
  // Calibrated to the explicit acceptance point: 50m full cover = 2500 HP.
  // This intentionally supersedes the inconsistent prose values for 250m/1000m.
  const factor = cellM <= 2 ? 1 : Math.round(Math.pow(cellM / 2, Math.log(100) / Math.log(25)));
  return base * factor;
}
function qualityOf(raw) {
  const direct = text(raw?.quality ?? raw?.品质);
  if (QUALITY_NAMES.has(direct)) return direct;
  const meta = [].concat(raw?.meta ?? raw?.元数据 ?? []).map(text);
  const declared = meta.find(value => QUALITY_NAMES.has(value));
  if (declared) return declared;
  for (const tag of tagEntries(raw?.tags ?? raw?.标签)) {
    const value = /^品质\s*(?:\([^()]*\)|（[^（）]*）)?\s*[:：]\s*(.+)$/u.exec(tag)?.[1];
    if (!value) continue;
    if (QUALITY_NAMES.has(value)) return value;
    const quality = Object.keys(QUALITY_TIER).find(key => String(QUALITY_TIER[key]) === value);
    if (quality) return quality;
  }
}
function rawTagValues(raw) {
  return [].concat(raw?.tags ?? raw?.标签 ?? []).map(text)
    .filter(tag => /^[a-z0-9][a-z0-9_-]{0,31}$/u.test(tag));
}

// Runtime counters are deliberately identified at the source boundary. Their
// current values must never participate in normalization fingerprints.
export const DYNAMIC_TAG_RE = /^(?<label>[^:：0-9]+?(?:计数|层数|充能|弹药|箭矢|灵魂|能量|魔力|耐久|次数|印记|残弹|装填))(?<sep>\s*[:：]\s*)(?<cur>\d+)(?:\s*(?<slash>[\/／])\s*(?<max>\d+))?$/u;
const DYNAMIC_FIELD_KEYS = new Set(['当前弹药', '当前充能', '当前层数', 'currentCharges', 'currentAmmo', 'currentStacks']);
export const UNIT_COUNTER_KEY_RE = /^(?:当前)?[^:：0-9]{1,16}?(?:计数|充能|层数|魂量|魂数|剑意|怒气|狂怒|战意|理智|印记|残弹|信仰值|能量值|连击点)$/u;
const STATIC_UNIT_COUNTER_KEYS = new Set(['等级', '生命层级', '层级', '体长', '身高', '体重', '年龄', '护甲', '防御', '防御力', '攻击', '攻击力', '命中', '闪避', '先手', '暴击', '移动力', '速度', '金币', '金钱', '货币', '好感', '好感度', '经验', '经验值']);
const RUNTIME_STATUS_KEYS = new Set(['层数', 'stacks', '剩余回合', 'remainingTurns', '剩余时间', 'remainingTime', '护盾值', 'amount']);
const STATIC_TAG_KEY_RE = /^(?:攻击|攻击力|防御|防御力|防具|护甲|威力|射程|有效距离|范围|先手|命中|闪避|暴击|重量|等级|层级|品质|体型)(?:\([^)]*\))?$/u;

export function dynamicTag(value) {
  const match = text(value).match(DYNAMIC_TAG_RE);
  if (!match || STATIC_TAG_KEY_RE.test(match.groups.label.trim())) return null;
  const label = match.groups.label.trim(), current = Number(match.groups.cur);
  const max = match.groups.max == null ? null : Number(match.groups.max);
  // A bare ammo value and an ammo value with a denominator represent the same
  // static declaration; only the current amount is dynamic.
  const normalized = label === '弹药' || max == null
    ? `${label}:<DYNAMIC>`
    : `${label}:<DYNAMIC>/${max}`;
  return { label, current, max, sep: match.groups.sep, slash: match.groups.slash, normalized };
}

export function staticProjection(value, context = {}) {
  if (Array.isArray(value)) {
    return value.map(item => staticProjection(item, context));
  }
  if (!object(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (context.resource && (typeof child === 'number' || typeof child === 'string') && !['上限', 'max', 'maximum'].includes(key)) { result[key] = '<DYNAMIC>'; continue; }
    if (DYNAMIC_FIELD_KEYS.has(key)) { result[key] = '<DYNAMIC>'; continue; }
    if (context.pool && ['initial', 'current', '当前', 'now', 'value'].includes(key)) { result[key] = '<DYNAMIC>'; continue; }
    if (context.resource && ['current', '当前', 'now', 'value'].includes(key)) { result[key] = '<DYNAMIC>'; continue; }
    if (context.status && RUNTIME_STATUS_KEYS.has(key)) continue;
    if (key === '标签' || key === 'tags') {
      result[key] = [].concat(child).map(item => dynamicTag(item)?.normalized ?? item);
      continue;
    }
    if (key === 'pools' || key === 'unitPools' || key === '资源池') {
      result[key] = Object.fromEntries(Object.entries(asObject(child)).map(([poolKey, pool]) => [poolKey,
        staticProjection(pool, { pool: true })]));
      continue;
    }
    if (key === 'resources' || key === 'resource' || key === '资源' || key === '计数器' || key === 'counters') {
      result[key] = staticProjection(child, { resource: true });
      continue;
    }
    if ((UNIT_COUNTER_KEY_RE.test(key) && !STATIC_UNIT_COUNTER_KEYS.has(key)) || key === '当前') {
      result[key] = typeof child === 'number' || typeof child === 'string' ? '<DYNAMIC>' : staticProjection(child, context);
      continue;
    }
    if (['生命值', '法力值', '体力值', 'hp', 'mp', 'sp'].includes(key)) {
      result[key] = object(child) ? staticProjection(child, { resource: true }) : '<DYNAMIC>';
      continue;
    }
    if (key === '状态效果' || key === 'statuses' || key === '状态') {
      // Keep names and static descriptions for diagnostics, but discard live
      // stacks/durations. This allows a custom status edit to invalidate a
      // fingerprint without making combat damage invalidate it.
      result[key] = staticProjection(child, { status: true });
      continue;
    }
    result[key] = staticProjection(child, context);
  }
  return result;
}

const SEMANTIC_UNIT_POOL_KEYS = [
  [/^(?:灵魂|魂量|魂数|魂魄)(?:计数|值|池)?$/u, 'souls'],
  [/^剑意(?:层数|值|池)?$/u, 'sword_intent'],
  [/^(?:怒气|狂怒|战意)(?:值|池)?$/u, 'rage'],
  [/^(?:充能|蓄能)(?:层数|计数|值)?$/u, 'charge'],
  [/^(?:理智|精神值|san|SAN)(?:值)?$/u, 'sanity'],
  [/^(?:信仰|虔诚)(?:值|力)?$/u, 'faith'],
  [/^(?:印记|刻印)(?:层数|计数)?$/u, 'marks'],
  [/^(?:连击|连段)(?:点|数|层数)?$/u, 'combo'],
  [/^(?:能量|源能|灵能)(?:值|池)?$/u, 'energy_pool'],
  [/^(?:魔力|法术位)(?:计数|充能|值)?$/u, 'arcane_charge'],
];

export function unitPoolKeyFromLabel(rawName) {
  const name = text(rawName);
  if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) && !['hp', 'mp', 'sp'].includes(name)) return name;
  return SEMANTIC_UNIT_POOL_KEYS.find(([pattern]) => pattern.test(name))?.[1]
    ?? deterministicId(name, 'pool').replaceAll('-', '_');
}

const RESERVED_UNIT_KEYS = new Set(['姓名', 'name', 'id', 'ID', '等级', 'level', '生命层级', 'tier', '体长', 'bodyLengthM', '属性', 'stats', 'attributes', '生命值', '法力值', '体力值', 'hp', 'HP', 'mp', 'MP', 'sp', 'SP', '护甲', 'armor', '防御', '移动力', 'move', 'mc', '装备', 'equipment', 'gear', '武器', '技能', 'skills', '背包', 'inventory', 'bag', '道具', 'items', '状态', '状态效果', 'statuses', 'effects', '登神长阶', '位置', '坐标', 'position', '朝向', 'facing', '阵营', 'team', '立绘', 'avatar', 'portrait', '标签', 'tags', '元数据', 'meta', '规则', 'rules', 'mods', 'pools', 'unitPools', '资源池', '资源', 'resource', 'resources', '计数器', 'counters']);
const CURRENT_KEYS = ['当前', 'current', 'now', 'value'];
const MAX_KEYS = ['上限', 'max', 'maximum'];
function finiteCounter(value) {
  const parsed = number(value, NaN);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}
function poolEntry(rawKey, label, current, explicitMax, subPath, format = { kind: 'field_number' }, initialRawValue) {
  const value = finiteCounter(current) ?? 0;
  const max = finiteCounter(explicitMax);
  return { rawKey, label: text(label) || text(rawKey), current: value, explicitMax: max, cap: max ?? Math.max(value, 999), subPath,
    format, ...(initialRawValue !== undefined ? { initialRawValue } : {}) };
}
function resourceEntry(rawKey, label, value, subPath) {
  const currentKey = CURRENT_KEYS.find(key => own(value, key));
  const current = object(value) ? value[currentKey] : value;
  const maxRaw = object(value) ? MAX_KEYS.find(key => own(value, key)) && value[MAX_KEYS.find(key => own(value, key))] : undefined;
  const explicitMax = object(maxRaw) ? finiteCounter(number(maxRaw._基础, 0) + number(maxRaw.额外, 0)) : finiteCounter(maxRaw);
  return poolEntry(rawKey, label, current, explicitMax, [...subPath, ...(currentKey ? [currentKey] : [])]);
}
export function extractUnitPoolEntries(record) {
  const source = asObject(record), entries = [], seen = new Set();
  const add = entry => { const key = JSON.stringify(entry.subPath); if (!seen.has(key)) { seen.add(key); entries.push(entry); } };
  for (const [rawKey, value] of Object.entries(asObject(source.unitPools ?? source.资源池))) {
    if (!object(value)) continue;
    const currentKey = CURRENT_KEYS.find(key => own(value, key));
    add(poolEntry(rawKey, value.name ?? value.名称 ?? rawKey, value[currentKey] ?? value.initial, value.cap ?? value.max ?? value.上限,
      ['unitPools', rawKey, ...(currentKey ? [currentKey] : ['initial'])], { kind: 'field_number' }, value[currentKey] ?? value.initial));
  }
  for (const containerKey of ['资源', 'resources', 'resource']) {
    for (const [rawKey, value] of Object.entries(asObject(source[containerKey]))) {
      if (RESOURCE_ALIASES.hp.includes(rawKey) || RESOURCE_ALIASES.mp.includes(rawKey) || RESOURCE_ALIASES.sp.includes(rawKey)
        || RESOURCE_MAX_ALIASES.hp.includes(rawKey) || RESOURCE_MAX_ALIASES.mp.includes(rawKey) || RESOURCE_MAX_ALIASES.sp.includes(rawKey)) continue;
      const sibling = asObject(source[containerKey]);
      const maxKey = [`${rawKey}上限`, `${rawKey}Max`].find(key => own(sibling, key));
      add(resourceEntry(rawKey, rawKey, object(value) ? value : { current: value, ...(maxKey ? { max: sibling[maxKey] } : {}) }, [containerKey, rawKey]));
    }
  }
  for (const [rawKey, value] of Object.entries(source)) {
    if (RESERVED_UNIT_KEYS.has(rawKey)) continue;
    if (object(value) && CURRENT_KEYS.some(key => own(value, key)) && !['效果', '类型', '品质', '层数', 'stacks', '剩余回合', 'remainingTurns', '剩余时间'].some(key => own(value, key))) {
      add(resourceEntry(rawKey, rawKey, value, [rawKey]));
      continue;
    }
    if (finiteCounter(value) != null && (DYNAMIC_FIELD_KEYS.has(rawKey) || UNIT_COUNTER_KEY_RE.test(rawKey)) && !STATIC_UNIT_COUNTER_KEYS.has(rawKey)) {
      const maxKey = [`${rawKey}上限`, `${rawKey}Max`].find(key => own(source, key));
      add(poolEntry(rawKey, rawKey, value, maxKey ? source[maxKey] : null, [rawKey]));
    }
  }
  for (const containerKey of ['计数器', 'counters']) {
    for (const [rawKey, value] of Object.entries(asObject(source[containerKey]))) {
      add(resourceEntry(rawKey, rawKey, value, [containerKey, rawKey]));
    }
  }
  for (const [tagsKey, tags] of [['标签', source.标签], ['tags', source.tags]]) {
    if (!Array.isArray(tags)) continue;
    tags.forEach((rawTag, index) => { const dynamic = dynamicTag(rawTag); if (!dynamic) return;
      add(poolEntry(dynamic.label, dynamic.label, dynamic.current, dynamic.max, [tagsKey, index],
        { kind: dynamic.max == null ? 'tag_single' : 'tag_slash', sep: dynamic.sep, slash: dynamic.slash }, text(rawTag))); });
  }
  return entries;
}

export function normalizeClauseForHash(value) {
  return text(value).replaceAll('：', ':').replaceAll('（', '(').replaceAll('）', ')')
    .replace(/(数量|当前|剩余|层数|计数|充能|弹药)\s*:\s*\d+(?:\s*[/／]\s*\d+)?/gu, '$1:<DYNAMIC>')
    .replace(/\s+/gu, ' ').trim();
}

function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A stable ASCII identifier.  ASCII names remain readable; non-ASCII names
 * receive a short FNV-1a suffix rather than relying on locale transliteration. */
export function deterministicId(value, prefix = 'unit') {
  const raw = text(value) || prefix;
  const ascii = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  let id = ascii || `${prefix}-${hash(raw).toString(36)}`;
  if (!/^[A-Za-z]/.test(id)) id = `${prefix}-${id}`;
  if (id.length > 52) id = id.slice(0, 52);
  // The validator rejects these Object.prototype names.
  if (['constructor', 'prototype', '__proto__'].includes(id)) id = `${prefix}-${hash(raw).toString(36)}`;
  return id || `${prefix}-${hash(raw).toString(36)}`;
}

const blockHeaders = new Set(['|', '>', '|-', '|+', '>-', '>+', '|2', '>2']);
function emptyEntry(value) {
  if (value == null || (object(value) && !Object.keys(value).length)) return true;
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return !s || blockHeaders.has(s) || /^\{\s*\}$/.test(s);
}

function scalar(value) {
  const v = text(value);
  if (!v) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).replace(/\\n/g, '\n');
  if (v === 'true' || v === 'false') return v === 'true';
  if (v === 'null' || v === '~') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v)) return Number(v);
  const equation = v.match(/=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i);
  if (equation) return Number(equation[1]);
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { return JSON.parse(v); } catch { /* simple YAML fallback below */ }
  }
  return v;
}

/** Small YAML reader for char_info. It deliberately supports only YAML data,
 * not anchors, tags, expressions, or arbitrary JavaScript. */
export function parseSimpleYaml(input) {
  if (object(input) || Array.isArray(input)) return clone(input);
  const source = text(input).replace(/^```(?:yaml|yml)?\s*/i, '').replace(/\s*```$/i, '');
  const lines = source.split(/\r?\n/).map((raw, index) => ({
    index, indent: raw.match(/^\s*/)[0].length, value: raw.trim(), raw,
  })).filter(x => x.value && !x.value.startsWith('#') && !x.value.startsWith('---') && !x.value.startsWith('...'));
  if (!lines.length) return {};
  const root = lines[0].value.startsWith('- ') ? [] : {};
  const stack = [{ indent: -1, value: root }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    while (stack.length > 1 && line.indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (line.value.startsWith('- ')) {
      if (!Array.isArray(parent)) continue;
      const rest = line.value.slice(2).trim();
      if (!rest) { const child = {}; parent.push(child); stack.push({ indent: line.indent, value: child }); continue; }
      const colon = rest.search(/:(?:\s|$)/u);
      const quoted = /^(?:".*"|'.*')$/u.test(rest);
      if (colon > 0 && !quoted && !rest.startsWith('{')) {
        const child = {}; parent.push(child);
        child[rest.slice(0, colon).trim()] = scalar(rest.slice(colon + 1));
        stack.push({ indent: line.indent, value: child });
      } else parent.push(scalar(rest));
      continue;
    }
    const colon = line.value.search(/[:：]/);
    if (colon < 1 || !object(parent)) continue;
    const key = line.value.slice(0, colon).trim();
    const tail = line.value.slice(colon + 1).trim();
    if (blockHeaders.has(tail)) {
      const chunks = [];
      for (let j = i + 1; j < lines.length && lines[j].indent > line.indent; j++) { chunks.push(lines[j].value); i = j; }
      parent[key] = chunks.join(tail.startsWith('>') ? ' ' : '\n');
      continue;
    }
    if (tail) { parent[key] = scalar(tail); continue; }
    const next = lines[i + 1];
    const child = next && next.indent > line.indent && next.value.startsWith('- ') ? [] : {};
    parent[key] = child;
    stack.push({ indent: line.indent, value: child });
  }
  return root;
}

function unwrap(value, tag) {
  if (typeof value !== 'string') return value;
  const re = tag === 'battle' ? /<(?:battle_init|battle-in|battle_in)>\s*([\s\S]*?)\s*<\/\s*(?:battle_init|battle-in|battle_in)>/i
    : /<char_info>\s*([\s\S]*?)\s*<\/char_info>/ig;
  if (tag === 'battle') {
    const match = value.match(re);
    if (match) return parseBattleBody(match[1]);
    return parseBattleBody(value);
  }
  return [...value.matchAll(re)].map(m => parseSimpleYaml(m[1]));
}
function parseStructured(value) {
  if (object(value)) return value;
  if (typeof value !== 'string') return {};
  const source = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { const parsed = JSON.parse(source); return object(parsed) ? parsed : {}; } catch {
    let depth = 0, quoted = false, escaped = false;
    for (let start = 0; start < source.length; start++) {
      if (source[start] !== '{') continue;
      depth = 0; quoted = false; escaped = false;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try { const parsed = JSON.parse(source.slice(start, i + 1)); if (object(parsed)) return parsed; } catch (_) {}
          break;
        }
      }
    }
    return parseSimpleYaml(source);
  }
}
function parseBattleBody(value) {
  const battle = parseBattleDescriptor(value) ?? parseStructured(value);
  return battle.battle_init ?? battle.battle_in ?? battle.战术沙盘 ?? battle;
}
export function parseBattleInit(value) { return asObject(typeof value === 'string' ? unwrap(value, 'battle') : parseBattleBody(value)); }
export { qualityOf, rawTagValues, object, asObject, finite, number, integer, text, clone, own, findValue, sourceName, tierNumber, sourceId, samePath, bound, statusTurns, warningSink, describe, blockBody, narrativeEntries, protagonistAliases, charSources, statusId, resolveParticipant, attrNames, statAliases, safeResource, resource, resourceValue, RESOURCE_ALIASES, RESOURCE_MAX_ALIASES, emptyEntry, hash };

export function parseCharInfo(value) {
  if (Array.isArray(value)) return value.flatMap(parseCharInfo);
  if (object(value)) return [clone(value)];
  if (typeof value !== 'string') return [];
  const tagged = unwrap(value, 'char');
  return tagged.length ? tagged : [parseSimpleYaml(value)].filter(x => Object.keys(x).length);
}

const attrNames = ['str', 'agi', 'con', 'int', 'spi'];
const statAliases = { strength: 'str', dexterity: 'agi', agility: 'agi', constitution: 'con', intelligence: 'int', spirit: 'spi', wisdom: 'spi', 力量: 'str', 敏捷: 'agi', 体质: 'con', 智力: 'int', 精神: 'spi' };
function findValue(record, names, fallback) {
  const r = asObject(record);
  for (const name of names) if (own(r, name)) return r[name];
  return fallback;
}
export function statsOf(record) {
  const r = asObject(record), nested = asObject(r.stats && Object.keys(r.stats).length ? r.stats : r.attributes && Object.keys(r.attributes).length ? r.attributes : r.属性);
  const result = {};
  for (const key of attrNames) {
    const aliases = [key, ...Object.entries(statAliases).filter(([, v]) => v === key).map(([k]) => k)];
    result[key] = Math.max(-20, Math.min(50, integer(
      aliases.find(alias => own(nested, alias)) !== undefined ? nested[aliases.find(alias => own(nested, alias))] : findValue(r, aliases, 0), 0)));
  }
  return result;
}
const RESOURCE_ALIASES = Object.freeze({
  hp: ['hp', 'HP', '生命值'], mp: ['mp', 'MP', '法力值'], sp: ['sp', 'SP', '体力值'],
});
const RESOURCE_MAX_ALIASES = Object.freeze({
  hp: ['maxHp', 'hpMax', '生命值上限'], mp: ['maxMp', 'mpMax', '法力值上限'], sp: ['maxSp', 'spMax', '体力值上限'],
});
function resourceValue(record, key) {
  const r = asObject(record), nested = asObject(r.resources ?? r.resource ?? r.资源);
  const aliases = RESOURCE_ALIASES[key] ?? [];
  for (const name of aliases) if (own(r, name)) return { value: r[name], key: name };
  for (const name of aliases) if (own(nested, name)) return { value: nested[name], key: name };
  return { value: undefined, key: null };
}
function resource(record, key, fallback, warnings) {
  const r = asObject(record), aliases = RESOURCE_ALIASES[key] ?? [], { value } = resourceValue(r, key);
  const numeric = raw => { const parsed = number(raw, NaN); return Number.isFinite(parsed) ? Math.round(parsed) : null; };
  const warn = (kind, raw) => warnings?.push(`${aliases[2]}${kind}${raw === undefined ? '缺失' : `「${text(raw)}」无法解析`}，已按五维公式兜底`, { kind: 'unmapped_field', field: `${key}.${kind}` });
  if (object(value)) {
    const currentKey = ['current', '当前', 'now', 'value'].find(name => own(value, name));
    const currentRaw = currentKey === undefined ? undefined : value[currentKey];
    const currentValue = currentKey === undefined ? null : numeric(currentRaw);
    if (currentValue === null) warn('当前', currentRaw ?? value);
    const current = currentValue ?? fallback;
    const upperKey = ['max', 'maximum', '上限'].find(name => own(value, name));
    if (upperKey === undefined) {
      const outerMaxKey = (RESOURCE_MAX_ALIASES[key] ?? []).find(name => own(r, name));
      if (outerMaxKey !== undefined) {
        const outerMax = numeric(r[outerMaxKey]);
        if (outerMax !== null) return { current, max: outerMax };
        warn('上限', r[outerMaxKey]);
      } else warn('上限', undefined);
      return { current, max: fallback };
    }
    const upper = value[upperKey];
    let max = null;
    if (object(upper)) {
      const hasBase = own(upper, '_基础'), hasExtra = own(upper, '额外');
      if (!hasBase && !hasExtra) warn('上限', upper);
      else {
        const base = hasBase ? numeric(upper._基础) : 0;
        const extra = hasExtra ? numeric(upper.额外) : 0;
        if (base === null || extra === null) warn('上限', upper);
        else max = base + extra;
      }
    } else {
      max = numeric(upper);
      if (max === null) warn('上限', upper);
    }
    return { current, max: max ?? fallback };
  }
  const currentValue = value === undefined ? null : numeric(value);
  if (value !== undefined && currentValue === null) warn('当前', value);
  const current = currentValue ?? fallback;
  const maxName = (RESOURCE_MAX_ALIASES[key] ?? []).find(name => own(r, name));
  const maxRaw = maxName === undefined ? undefined : r[maxName];
  const maxValue = maxName === undefined ? current : numeric(maxRaw);
  if (maxName !== undefined && maxValue === null) warn('上限', maxRaw);
  return { current, max: maxValue ?? current };
}
function safeResource(pair, key, warnings) {
  let max = Math.max(key === 'hp' ? 1 : 0, pair.max), current = Math.max(0, Math.min(max, pair.current));
  if (max > 1000000000 || pair.current > 1000000000) { warnings.push(`${key} 超出引擎上限，已截到 1e9`, { kind: 'auto_adjusted' }); max = Math.min(max, 1000000000); current = Math.min(current, max); }
  return { current, max };
}
function sourceName(record, key = '') { return text(findValue(record, ['name', 'displayName', 'characterName', '角色名', '姓名', '名称'], key)); }
function tierNumber(value, fallback = 1) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = text(value).match(/[一二三四五六七]层级?/);
  return match ? '一二三四五六七'.indexOf(match[0][0]) + 1 : fallback;
}
function sourceId(record, key = '') { return text(findValue(record, ['id', 'uid', 'characterId', 'instanceId', 'ID'], key)); }
const protagonistAliases = ['主角', '玩家', '主控', 'protagonist', 'player', 'mvu_protagonist'];
const charSources = ['char_info', 'narrative_char_info'];
const samePath = (a, b) => a.length === b.length && a.every((part, i) => String(part) === b[i]);

const charNameKeys = ['name', 'displayName', 'characterName', '角色名', '姓名', '名称'];
const charIdKeys = ['id', 'uid', 'characterId', 'instanceId', 'ID'];
const statContainers = ['stats', 'attributes', '属性'];
const resourceContainers = ['resources', 'resource', '资源'];
const panelAliases = [charNameKeys, charIdKeys, ['tier', 'levelTier', '层级', '生命层级'], ['level', '等级'],
  ['bodyLengthM', 'bodyLength', 'BL', 'bl', '体长', '身高'], ['equipment', 'equipments', 'items', '装备'],
  ['skills', 'abilities', '技能'], ['道具', 'consumables'], ['数量', 'count']];
const present = value => !emptyEntry(value) && (!Array.isArray(value) || value.length > 0);

function mergePanelFields(base, newer, groups = []) {
  for (const [key, value] of Object.entries(newer)) {
    if (!present(value) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    for (const alias of groups.find(group => group.includes(key)) ?? []) {
      if (alias !== key) delete base[alias];
    }
    base[key] = value;
  }
  return base;
}

export function resolveCharPanel(chars, matches, useRecord) {
  const anchor = chars.find(matches);
  if (!anchor) return undefined;
  const id = sourceId(anchor), name = sourceName(anchor);
  const namedIds = !id && new Set(chars.filter(record => name && sourceName(record) === name).map(record => sourceId(record)).filter(Boolean));
  const records = chars.filter(record => {
    const otherId = sourceId(record);
    if (record === anchor || (id && id === otherId)) return true;
    return (!otherId || (!id && namedIds.size === 1)) && name && sourceName(record) === name &&
      (!anchor.归属 || !record.归属 || anchor.归属 === record.归属);
  });
  records.forEach(record => useRecord?.(record));
  if (records.length === 1) return anchor;

  const merged = {}, stats = {}, resources = {};
  const statKeys = attrNames.map(key => [key, ...Object.keys(statAliases).filter(alias => statAliases[alias] === key)]);
  const resourceKeys = Object.values(RESOURCE_ALIASES);
  const scalarAliases = [...panelAliases, ...Object.values(RESOURCE_MAX_ALIASES)];
  for (const record of records.toReversed()) {
    const flat = { ...record };
    const mergeGroup = (target, containers, keys, flatWins) => {
      const nested = asObject(containers.map(key => flat[key]).find(present));
      const direct = Object.fromEntries(keys.flat().filter(key => own(flat, key)).map(key => [key, flat[key]]));
      for (const fields of flatWins ? [nested, direct] : [direct, nested]) mergePanelFields(target, fields, keys);
      for (const key of [...containers, ...keys.flat()]) delete flat[key];
    };
    mergeGroup(stats, statContainers, statKeys, false);
    // Resource maxima are also read from the top level by the unit converter.
    mergeGroup(resources, resourceContainers, resourceKeys, true);
    mergePanelFields(merged, flat, scalarAliases);
  }
  if (Object.keys(stats).length) merged.stats = stats;
  if (Object.keys(resources).length) merged.resources = resources;
  return merged;
}

function resolveParticipant(participant, mvuRecords, chars, protagonist, useRecord) {
  const source = text(participant.source), name = text(participant.name);
  if (source.startsWith('mvu:')) {
    const path = source.slice(4).split('/');
    return mvuRecords.find(record => samePath(record.__sourcePath, path));
  }
  if (protagonistAliases.includes(source.toLowerCase())) return protagonist;
  const char = () => {
    const id = text(participant.id ?? participant.uid);
    return (id && resolveCharPanel(chars, record => sourceId(record) === id, useRecord))
      || resolveCharPanel(chars, record => name && sourceName(record) === name, useRecord);
  };
  if (charSources.includes(source.toLowerCase())) return char();
  const matches = (record, key) => [sourceId(record), sourceName(record), record.__sourceKey].includes(key);
  if (source) return mvuRecords.find(record => matches(record, source))
    ?? resolveCharPanel(chars, record => matches(record, source), useRecord);
  const exact = [text(participant.id ?? participant.uid), name].filter(Boolean);
  for (const key of exact) {
    const record = mvuRecords.find(record => matches(record, key));
    if (record) return record;
  }
  return char();
}

export function resolveSummonSource(row, ownerRecord, mvuRecords, chars, useRecord) {
  if (row.source === 'char_info') {
    const eligible = chars.filter(record => !record.归属 || record.归属 === sourceName(ownerRecord));
    return resolveCharPanel(eligible, record => sourceName(record) === row.name, useRecord);
  }
  const notes = asObject(ownerRecord?.tacticalSummons);
  const ownerPath = ownerRecord?.__sourcePath ?? [];
  if (row.source.startsWith('mvu:')) {
    const leaf = row.source.slice(4).split('/').at(-1);
    const path = row.source.slice(4).split('/');
    if (samePath(path.slice(0, -1), ownerPath) && own(notes, leaf)) return notes[leaf];
    const root = ['事件', '战术扩展', '召唤物'];
    const notePath = ownerPath[0] === '关系列表' ? [...root, '伙伴', ownerPath[1]] : [...root, '主角'];
    if (samePath(path.slice(0, -1), notePath)) return own(notes, leaf) ? notes[leaf] : undefined;
    if (!mvuRecords.some(record => record === ownerRecord && samePath(record.__sourcePath, path))) return undefined;
  }
  return own(notes, row.name) ? notes[row.name] : Object.values(notes).find(note => object(note) && sourceName(note) === row.name);
}

export function collectMvu(value) {
  const root = asObject(value?.stat_data ?? value?.statData ?? value);
  const lengths = asObject(root.事件?.战术扩展?.体长);
  const companionLengths = asObject(lengths.伙伴);
  const summons = asObject(root.事件?.战术扩展?.召唤物);
  const companionSummons = asObject(summons.伙伴);
  const found = [];
  const visit = (node, key = '', path = []) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, String(i), [...path, i]));
    if (!object(node)) return;
    const name = sourceName(node, key), hasStats = node.stats || node.attributes || node.属性 || ['力量','敏捷','体质','智力','精神'].some(k => own(node, k));
    const hasResource = ['hp', 'maxHp', 'mp', 'sp', 'tier', 'level', 'equipment', 'skills', '生命值', '法力值', '体力值', '装备', '技能', '资源'].some(k => own(node, k));
    if (name && (hasStats || hasResource)) {
      // Resolve by MVU path, not the battle display name. Include the value in
      // the character record so snapshot hashes also track form changes.
      const length = path.length === 1 && protagonistAliases.includes(path[0]) ? lengths.主角
        : path.length === 2 && path[0] === '关系列表' && own(companionLengths, key) ? companionLengths[key] : undefined;
      const record = clone(node);
      const notes = path.length === 1 && protagonistAliases.includes(path[0]) ? own(summons, '主角')
        : path.length === 2 && path[0] === '关系列表' ? own(companionSummons, key) : undefined;
      if (object(notes)) record.tacticalSummons = clone(notes);
      if (Number.isFinite(length) && length > 0) record.bodyLengthM = length;
      found.push({ ...record, __sourceKey: key, __sourcePath: path, __sourceKind: 'MVU' });
    }
    for (const [k, v] of Object.entries(node)) if (!['stats', 'attributes', '属性', 'resources', '资源', 'equipment', '装备', 'skills', '技能', 'statuses', '状态效果', '战术扩展', 'tacticalSummons'].includes(k)) visit(v, k, [...path, k]);
  };
  visit(root);
  const protagonist = found.find(record => record.__sourcePath.length === 1 && protagonistAliases.includes(record.__sourcePath[0]));
  if (protagonist && object(summons.主角)) protagonist.tacticalSummons = clone(summons.主角);
  for (const record of found) {
    if (record.__sourcePath.length === 2 && record.__sourcePath[0] === '关系列表' && object(companionSummons[record.__sourcePath[1]])) {
      record.tacticalSummons = clone(companionSummons[record.__sourcePath[1]]);
    }
  }
  return found;
}

function statusId(value) {
  const key = text(value);
  return key === 'suppressed' || key === STATUSES.suppressed.name ? 'suppressed' : null;
}
const bound = (value, min, max, fallback = min) => Math.max(min, Math.min(max, integer(value, fallback)));
function statusTurns(value, fallback) {
  const turns = typeof value === 'string' ? value.match(/^\s*(\d+)\s*(?:回合|轮)\s*$/)?.[1] ?? value : value;
  return bound(turns, 1, 100, fallback);
}

export const WARNING_SCOPES = Object.freeze(['effect', 'status', 'resource', 'state', 'terrain', 'field', 'scene']);
function warningSink(warnings, unitId, source, scope, originPath) {
  if (!WARNING_SCOPES.includes(scope)) throw new TypeError(`未知诊断 scope：${scope}`);
  return { push: (message, metadata) => warnings.push({ message, unitId, source, scope, ...(originPath && {originPath}), ...metadata }) };
}

const blockBody = value => value.trim().replace(/^[|>](?:[-+2])?[^\S\r\n]*\r?\n/, '').trim();
const describe = value => typeof value === 'string' ? blockBody(value) : JSON.stringify(value);

function narrativeEntries(value) {
  if (emptyEntry(value)) return [];
  if (Array.isArray(value)) return value.flatMap(entry => narrativeEntries(entry));
  if (typeof value === 'string') {
    const body = blockBody(value);
    const labelled = body.match(/^([^\n:{}]+)[:：]\s*(\{[^\n]*\})$/);
    const payload = labelled?.[2] ?? body;
    if (payload.startsWith('{') || payload.startsWith('[')) {
      try { return narrativeEntries(JSON.parse(payload)); } catch { /* Diagnose the original text below. */ }
    }
    return emptyEntry(body) ? [] : [['', body]];
  }
  if (object(value) && Object.values(value).every(entry => typeof entry === 'string' || object(entry) || emptyEntry(entry))
    && !['id', 'hook', 'program', 'op', 'target', 'effects'].some(key => own(value, key))) {
    return Object.entries(value).filter(([, entry]) => !emptyEntry(entry));
  }
  return [['', value]];
}
