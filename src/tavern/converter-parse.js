import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { id as validId, validateState } from '../api/validation.js';
import { DISTANCE_TABLE, sizeClassFor, stanceFor, moraleTypeFor, TIER_CELL_M, QUALITY_TIER, resolveEffectiveTier, scaledCells } from '../core/combat_protocol.js';
import { validVmRule, validVmStatMod } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';
import { initializeVMWorld } from '../core/vm-runtime.js';
import { beginBattle, STATUSES } from '../core/combat.js';
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
  return meta.find(value => QUALITY_NAMES.has(value));
}
function rawTagValues(raw) {
  return [].concat(raw?.tags ?? raw?.标签 ?? []).map(text)
    .filter(tag => /^[a-z0-9][a-z0-9_-]{0,31}$/u.test(tag));
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
export { qualityOf, rawTagValues, object, asObject, finite, number, integer, text, clone, own, findValue, sourceName, tierNumber, sourceId, samePath, bound, statusTurns, warningSink, describe, blockBody, narrativeEntries, protagonistAliases, charSources, statusId, resolveParticipant, attrNames, statAliases, safeResource, resource, emptyEntry, hash };

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
function resource(record, key, fallback) {
  const r = asObject(record), nested = asObject(r.resources ?? r.resource ?? r.资源);
  const aliases = { hp: ['HP', '生命值'], mp: ['MP', '法力值'], sp: ['SP', '体力值'] }[key] ?? [];
  const value = own(r, key) ? r[key] : own(r, key.toUpperCase()) ? r[key.toUpperCase()] : own(r, aliases[1]) ? r[aliases[1]] : own(nested, key) ? nested[key] : own(nested, aliases[0]) ? nested[aliases[0]] : own(nested, aliases[1]) ? nested[aliases[1]] : undefined;
  if (object(value)) {
    const current = integer(value.current ?? value.当前 ?? value.now ?? value.value, fallback);
    const upper = value.max ?? value.maximum ?? value.上限;
    const max = object(upper) ? integer((upper._基础 ?? 0) + (upper.额外 ?? 0), fallback) : integer(upper, fallback);
    return { current, max };
  }
  const current = integer(value, fallback);
  const maxValue = findValue(r, [`max${key[0].toUpperCase()}${key.slice(1)}`, `${key}Max`, `${aliases[1]}上限`], current);
  const max = integer(maxValue, current);
  return { current, max };
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

function resolveParticipant(participant, mvuRecords, chars, protagonist) {
  const source = text(participant.source), name = text(participant.name);
  if (source.startsWith('mvu:')) {
    const path = source.slice(4).split('/');
    return mvuRecords.find(record => samePath(record.__sourcePath, path));
  }
  if (protagonistAliases.includes(source.toLowerCase())) return protagonist;
  const char = chars.find(record => sourceId(record) && sourceId(record) === text(participant.id ?? participant.uid))
    ?? chars.find(record => sourceName(record) === name);
  if (charSources.includes(source.toLowerCase())) return char;
  const matches = (record, key) => [sourceId(record), sourceName(record), record.__sourceKey].includes(key);
  if (source) return [...mvuRecords, ...chars].find(record => matches(record, source));
  const exact = [text(participant.id ?? participant.uid), name].filter(Boolean);
  for (const key of exact) {
    const record = mvuRecords.find(record => matches(record, key));
    if (record) return record;
  }
  return char;
}

export function collectMvu(value) {
  const root = asObject(value?.stat_data ?? value?.statData ?? value);
  const lengths = asObject(root.事件?.战术扩展?.体长);
  const companionLengths = asObject(lengths.伙伴);
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
      if (Number.isFinite(length) && length > 0) record.bodyLengthM = length;
      found.push({ ...record, __sourceKey: key, __sourcePath: path, __sourceKind: 'MVU' });
    }
    for (const [k, v] of Object.entries(node)) if (!['stats', 'attributes', '属性', 'resources', '资源', 'equipment', '装备', 'skills', '技能', 'statuses', '状态效果'].includes(k)) visit(v, k, [...path, k]);
  };
  visit(root);
  return found;
}

function statusId(value) {
  const key = text(value);
  if (own(STATUSES, key)) return key;
  return Object.keys(STATUSES).find(id => STATUSES[id].name === key) ?? null;
}
const bound = (value, min, max, fallback = min) => Math.max(min, Math.min(max, integer(value, fallback)));
function statusTurns(value, fallback) {
  const turns = typeof value === 'string' ? value.match(/^\s*(\d+)\s*(?:回合|轮)\s*$/)?.[1] ?? value : value;
  return bound(turns, 1, 100, fallback);
}

export const WARNING_SCOPES = Object.freeze(['effect', 'status', 'resource', 'state', 'terrain', 'field']);
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
