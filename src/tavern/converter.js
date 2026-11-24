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

function activeRule(id, program) { return { id, hook: 'active', program }; }

function readRules(value, warnings) {
  if (value == null) return [];
  if (!Array.isArray(value)) { warnings.push('rules 必须是 Rule 数组'); return []; }
  const rules = [], ids = new Set();
  for (const [index, rule] of value.entries()) {
    const location = `rules[${index}]${rule?.id ? ` (${rule.id})` : ''}`;
    if (!validVmRule(rule)) warnings.push(`${location} 不符合 VM 规则 Schema：${describe(rule)}`);
    else if (ids.has(rule.id)) warnings.push(`${location} 的规则 ID 重复`);
    else if (rules.length === 200) warnings.push(`${location} 超过规则数量上限 200`);
    else { rules.push(clone(rule)); ids.add(rule.id); }
  }
  return rules;
}

function appendRules(rules, additions, warnings) {
  for (const rule of additions) {
    if (rules.some(existing => existing.id === rule.id)) warnings.push(`生成规则 ${rule.id} 与已声明规则 ID 重复`);
    else if (rules.length === 200) warnings.push(`生成规则 ${rule.id} 超过规则数量上限 200`);
    else rules.push(rule);
  }
}

function readMods(value, warnings) {
  if (value == null) return [];
  if (!Array.isArray(value)) { warnings.push('mods 必须是 StatMod 数组'); return []; }
  return value.flatMap((mod, index) => {
    if (index < 200 && validVmStatMod(mod)) return [clone(mod)];
    warnings.push(`mods[${index}] 无效或超出数量上限：${describe(mod)}`);
    return [];
  });
}

function readPools(value, warnings) {
  if (value == null) return {};
  if (!object(value)) { warnings.push('pools 必须是资源池声明对象'); return {}; }
  return Object.fromEntries(Object.entries(value).filter(([key, pool]) => {
    const allowed = validId(key) && object(pool) && Object.keys(pool).every(k => ['cap', 'initial', 'reloadable'].includes(k))
      && Number.isInteger(pool.cap) && pool.cap >= 0 && pool.cap <= 1e9
      && (!own(pool, 'initial') || Number.isInteger(pool.initial) && pool.initial >= 0 && pool.initial <= pool.cap)
      && (!own(pool, 'reloadable') || typeof pool.reloadable === 'boolean');
    if (!allowed) warnings.push(`pools.${key} 需要有效的资源 ID、整数 cap (0 到 1e9)、可选整数 initial (0 到 cap) 和可选布尔 reloadable`);
    return allowed;
  }).map(([key, pool]) => [key, { initial: pool.cap, ...pool }]));
}

/** Map narrative effect input to validated VM rules. */
export function mapEffects(effects, context = 'skill', warnings = [], prefix = 'imported') {
  const sink = warningSink(warnings, null, null, 'effect');
  if (context === 'equipment') return readEquipmentNarrative(effects, sink);
  return convertNarrative(effects, sink, deterministicId(prefix, 'rule'), { allowPower: true });
}
export const mapEffect = (raw, context, warnings) => mapEffects([raw], context, warnings)[0] ?? null;

function readEquipmentNarrative(effects, warnings) {
  return convertNarrative(effects, warnings, '', { equipment: true });
}

function convertNarrative(effects, warnings, prefix, { allowPower = false, equipment = false, areaDamage = false } = {}) {
  const rules = [];
  for (const [index, [label, entry]] of narrativeEntries(effects).entries()) {
    if (validVmRule(entry)) {
      appendRules(rules, [clone(entry)], warnings);
      continue;
    }
    const program = !equipment && typeof entry === 'string' ? narrativeDamage(label, entry, allowPower) : [];
    const rawExcerpt = [entry].flat().map(value => typeof value === 'string' ? blockBody(value)
      : text(value?.描述 ?? value?.description ?? value?.效果 ?? value?.effect)).filter(Boolean).join('；');
    const excerpt = [...rawExcerpt];
    const summary = excerpt.length ? `${excerpt.slice(0, 80).join('')}${excerpt.length > 80 ? '…' : ''}` : '待转换为战斗规则';
    const metadata = { rawExcerpt, userSummary: `${label ? `「${label}」` : '效果'}：${summary}` };
    if (program.length && areaDamage) {
      warnings.push(`范围伤害待标准化${label ? `「${label}」` : ''}：${describe(entry)}。请为规则声明精确的目标选择器`, metadata);
    } else if (program.length) appendRules(rules, [activeRule(`${prefix.slice(0, 45)}-narrative-${index}`, program)], warnings);
    else warnings.push(`${equipment ? '装备' : ''}效果待标准化${label ? `「${label}」` : ''}：${describe(entry)}。请用 VM rules / mods / pools 实现行为与触发时机；缺少状态或召唤物专属技能时，同批新增 /statusTemplates/<id> 或 /skills/<id> 后引用`, metadata);
  }
  return rules;
}

const damageAliases = new Map(Object.entries({ 物理: 'physical', 能量: 'energy', 精神: 'mental', 真实: 'true' }));
const damageTypes = ['physical', 'energy', 'mental', 'true'];
function skillCosts(value) {
  const cost = object(value) ? Object.entries(value).map(([k,v]) => `${k}: ${v}`).join(' ') : text(value);
  const slots = [...cost.matchAll(/(攻击|动作)\s*[:：]\s*(\d+)/g)];
  const resources = {};
  for (const [,n,key] of cost.matchAll(/(\d+)\s*(SP|MP|HP)\b/gi)) resources[key.toLowerCase()] = Number(n);
  return { ...resources, slot: slots[0]?.[1] === '动作' ? 'action' : 'attack', ap: /^(?:消耗\s*[:：]\s*)?(?:无|无消耗|none|0)$/i.test(cost.trim()) ? 0 : new Set(slots.map(s => s[1])).size === 2 ? 2 : 1 };
}
const damageOp = (damageType, amount) => ({ op: 'damage', target: 'target', damageType, amount });
const powerAmount = percent => percent === 100 ? 'event.power' : `event.power * (${percent} / 100)`;
function damageTags(value, power) {
  if (!value) return [];
  const single = damageAliases.get(value);
  if (single) return [damageOp(single, 'event.power')];
  const parts = value.split(/[/／]/).map(s => s.trim().match(/^(物理|能量|精神|真实)\s*(\d+(?:\.\d+)?)\s*([%％]?)$/));
  if (parts.length < 2 || parts.some(p => !p || !finite(Number(p[2])))) return [];
  const percent = parts.every(p => p[3]);
  if (!percent && !(parts.every(p => !p[3]) && parts.reduce((n,p) => n + Number(p[2]),0) === Number(power))) return [];
  return parts.map(([, type, n]) => damageOp(damageAliases.get(type), percent ? powerAmount(Number(n)) : Number(n)));
}
function narrativeDamage(label, entry, allowPower) {
  const body = blockBody(entry);
  const flat = /^(?:造成\s*)?(\d+)\s*(?:点)?\s*(物理|能量|精神|真实)伤害[。.]?$/.exec(body);
  if (flat && finite(Number(flat[1]))) return [damageOp(damageAliases.get(flat[2]), Number(flat[1]))];
  const typedLabel = /^(物理|能量|精神|真实)伤害$/.exec(label);
  const labelledFlat = typedLabel && /^造成\s*(\d+)\s*(?:点)?伤害[。.]?$/.exec(body);
  if (labelledFlat && finite(Number(labelledFlat[1]))) return [damageOp(damageAliases.get(typedLabel[1]), Number(labelledFlat[1]))];
  if (!allowPower) return [];
  const parts = body.split(/[/／、+＋]/).map(part => part.trim().match(/^(\d+(?:\.\d+)?)\s*[%％]\s*(物理|能量|精神|真实)(?:伤害)?[。.]?$/));
  if (parts.some(part => !part || Number(part[1]) <= 0 || Number(part[1]) > 1000)) return [];
  return parts.map(([, percent, type]) => damageOp(damageAliases.get(type), powerAmount(Number(percent))));
}
function normalizeDice(raw) {
  const dice = asObject(raw);
  const stat = own(statAliases, dice.stat) ? statAliases[dice.stat] : dice.stat;
  const type = damageAliases.get(dice.type) ?? dice.type;
  const count = bound(dice.count, 0, 1000000, 1);
  return {
    count, sides: bound(dice.sides, count ? 1 : 0, 1000000, 4),
    bonus: bound(dice.bonus, -1e9, 1e9, 0),
    ...(attrNames.includes(stat) ? { stat } : {}),
    ...(finite(dice.multiplier) ? { multiplier: Math.max(0, Math.min(8, dice.multiplier)) } : {}),
    type: damageTypes.includes(type) ? type : 'physical',
  };
}

function areaFields(raw, warnings, name) {
  const tags = parseAreaTags(raw.tags ?? raw.标签);
  if (tags.missingRange && raw.range == null && raw.有效距离 == null) warnings.push(`「${name}」有效距离标签缺少格数`);
  if (tags.missingRadius && tags.radius == null && raw.radius == null) warnings.push(`「${name}」范围标签缺少半径格数`);
  const tier = DISTANCE_TABLE.find(row => row.name === tags.rangeTier);
  if (tier && (tags.range < tier.min || (tier.max != null && tags.range > tier.max))) {
    warnings.push(`「${name}」有效距离 ${tags.range} 格与「${tier.name}」的距离区间不符`);
  }
  const shape = raw.shape ?? tags.shape;
  const range = raw.range ?? raw.有效距离 ?? tags.range;
  const radius = raw.radius ?? tags.radius;
  const innerRadius = raw.innerRadius ?? tags.innerRadius;
  const width = raw.width ?? (tags.width != null ? tags.width / 2 : shape === 'line' ? 0.5 : null);
  return { range, ...(range != null ? { rawRange: range } : {}), shape,
    target: raw.target ?? tags.target ?? (raw.heal != null || tags.healing ? 'ally' : null),
    radius, ...(radius != null ? { rawRadius: radius } : {}), innerRadius, ...(innerRadius != null ? { rawInnerRadius: innerRadius } : {}),
    angle: raw.angle ?? tags.angle, moveDistance: tags.moveDistance,
    width, ...(width != null ? { rawWidth: width } : {}) };
}

// VM `target` is one unit, so a generated target opcode cannot reuse the full aim set.
const isAreaDamage = area => (area.shape != null && area.shape !== 'single') || area.target === 'cell';

function geometryFields(area) {
  const result = {};
  for (const key of ['shape', 'target']) if (area[key] != null) result[key] = area[key];
  for (const key of ['radius', 'innerRadius', 'width', 'angle']) {
    if (area[key] != null && Number.isFinite(Number(area[key]))) {
      result[key] = key === 'angle' ? bound(area[key], 1, 360) : Math.max(0, Math.min(30, Number(area[key])));
      if (key !== 'angle') result[`raw${key[0].toUpperCase()}${key.slice(1)}`] = Math.max(0, Number(area[key]));
    }
  }
  if (area.moveDistance != null) result.rawMoveDistance = area.moveDistance;
  return result;
}

function ammoCapacity(raw) {
  const match = tagEntries(raw?.tags ?? raw?.标签).map(tag => tag.match(/^弹药\s*[:：]\s*(\d+)$/u)).find(Boolean);
  return match ? bound(match[1], 0, 1000000, 0) : null;
}
function attachAmmoPool(item, capacity) {
  const { template } = item;
  if (capacity == null || template.kind !== 'weapon' || !template.ranged) return;
  const declared = template.pools.ammo;
  template.pools.ammo = { ...declared, initial: capacity, cap: Math.max(declared?.cap ?? 0, capacity) };
}

function* instructions(program) {
  for (const instruction of program) {
    if (instruction.enabled === false) continue;
    yield instruction;
    for (const key of ['then', 'else', 'body', 'onPass', 'onFail', 'onCollide']) {
      if (instruction[key]) yield* instructions(instruction[key]);
    }
  }
}

function finalizeEquipment(item, warnings) {
  const { template, templateId } = item;
  const localOperations = template.rules.filter(rule => rule.enabled !== false).flatMap(rule =>
    [...instructions(rule.program)].filter(op => op.op === 'resource' && op.local).map(op => ({ rule, op })));
  for (const { rule, op } of localOperations) {
    const missing = [...new Set([].concat(op.pool, op.otherPool ?? []))].filter(key => !own(template.pools, key));
    if (missing.length) warnings.push(`规则「${rule.id}」引用未声明的装备资源池：${missing.join('、')}。请在 pools 中声明`);
  }
  if (template.kind !== 'weapon' || !template.ranged || !template.pools.ammo) return;
  if (localOperations.some(({ op }) => op.mode === 'sub' && [].concat(op.pool).includes('ammo'))) return;
  appendRules(template.rules, [{
    id: `ammo-${hash(templateId).toString(36)}`,
    hook: 'before_action',
    filter: `event.actorId == self.id && event.weaponTemplateId == '${templateId}' && event.actionType == 'attack' && !has_status(self, 'infinite_ammo')`,
    program: [{ op: 'resource', target: 'self', pool: 'ammo', mode: 'sub', amount: 1, local: true, requireFull: true }],
  }], warnings);
}
function normalizeEquipment(raw, slot, owner, key, sink) {
  const r = asObject(raw), name = text(r.name ?? r.名称 ?? r.itemName) || `${slot || '装备'}${key}`;
  const isShield = slot === 'shield' || r.kind === 'shield' || r.shield === true || r.weaponClass === 'shield' || /盾/.test(name);
  const labels = Array.isArray(r.tags ?? r.标签) ? (r.tags ?? r.标签).join(' ') : text(r.tags ?? r.标签);
  const kindAliases = new Map([['武器', 'weapon'], ['防具', 'armor'], ['饰品', 'accessory'], ['弹药容器', 'accessory'], ['消耗品', 'consumable']]);
  const declaredKind = ['weapon', 'armor', 'accessory', 'consumable'].includes(r.kind) ? r.kind : kindAliases.get(r.类型);
  const kind = isShield ? 'shield' : declaredKind || (['mainHand', 'offHand', 'twoHands'].includes(slot)
    || r.damage || r.attack != null || r.weaponClass || /攻击|双手|巨剑|长戟|弓|弩|火枪|投掷武器/.test(`${name} ${labels}`) ? 'weapon' : 'accessory');
  const isWeapon = kind === 'weapon';
  const idBase = `item-${owner.length}-${owner.slice(0, 31)}-${hash(owner).toString(36)}-${key}`;
  const templateId = `template-${idBase}`;
  const warnings = sink('effect', `/equipment/${templateId}`);
  const rules = readRules(r.rules, warnings);
  const template = { name: name.slice(0, 100), kind, rules, mods: readMods(r.mods, warnings), pools: readPools(r.pools, warnings), ...(qualityOf(r) ? { quality: qualityOf(r) } : {}), ...(rawTagValues(r).length ? { tags: rawTagValues(r).slice(0, 32) } : {}) };
  const effectEntries = narrativeEntries(r.effects ?? r.effectsList ?? r.效果);
  const { rangeValues, radius, shape, target } = parseAreaTags(r.tags ?? r.标签);
  const equipmentWarnings = !isWeapon || rangeValues.length < 2 ? warnings : {
    push(message, metadata) {
      const effectIndex = effectEntries.findIndex(([label, value]) => label ? message.includes(`「${label}」`) : message.includes(describe(value)));
      const rawRange = rangeValues[effectIndex + 1];
      const suffix = effectIndex >= 0 && rawRange != null
        ? `。该装备主动效果的原始距离为 rawRange:${rawRange}${radius != null ? `、rawRadius:${radius}` : ''}${shape ? `、shape:${shape}` : ''}${target ? `、target:${target}` : ''}，请写到装备挂载的技能模板中`
        : '';
      warnings.push(message + suffix, metadata);
    },
  };
  appendRules(rules, readEquipmentNarrative(r.effects ?? r.effectsList ?? r.效果, equipmentWarnings), warnings);
  const defenseTag = labels.match(/防御\s*[:：]\s*([\d.e+-]+)/i);
  const defense = bound(r.defense ?? r.防御 ?? defenseTag?.[1], 0, 1000000, kind === 'shield' ? 1 : 0);
  if (kind === 'shield') Object.assign(template, { weaponClass: 'shield', hand: 'off_hand', shield: true, defense });
  else if (isWeapon) {
    const area = areaFields(r, sink('field', `/equipment/${templateId}`), name);
    if (rangeValues.length > 1) { area.shape = 'single'; area.target = 'enemy'; area.radius = area.innerRadius = area.width = null; }
    const classes = ['ranged', 'light_blade', 'greatsword', 'staff', 'auxiliary'];
    const weaponClassAlias = new Map([['bow', 'ranged'], ['crossbow', 'ranged'], ['arcane', 'staff']]);
    const explicitClass = weaponClassAlias.get(r.weaponClass) ?? r.weaponClass;
    const subtype = tagEntries(r.tags ?? r.标签).find(tag => ['弓','弩','火枪','投掷武器'].includes(tag));
    const ranged = r.ranged ?? (r.rangeType ? r.rangeType === 'ranged' : Boolean(subtype));
    const twoHanded = slot === 'twoHands' || r.twoHanded === true || r.hand === 'two_handed' || explicitClass === 'greatsword'
      || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${labels}`);
    const attackTag = labels.match(/攻击(?:力)?\s*[:：]\s*([\d.e+-]+)/i);
    const weaponClass = classes.includes(explicitClass) ? explicitClass : ranged ? 'ranged' : twoHanded ? 'greatsword' : 'light_blade';
    Object.assign(template, {
      ...(r.weaponType || subtype ? { weaponType: r.weaponType || subtype } : {}),
      weaponClass, hand: twoHanded ? 'two_handed' : slot === 'offHand' ? 'off_hand' : 'one_handed',
      ranged: Boolean(ranged), rangeType: ranged ? 'ranged' : 'melee',
      range: bound(area.range, 0, 64, ranged ? 4 : 1), rawRange: area.range ?? (ranged ? 4 : 1),
      attack: bound(r.attack ?? r.攻击 ?? attackTag?.[1], 0, 1e9), accuracy: bound(r.accuracy ?? r.命中, -20, 30, 0),
      damage: normalizeDice(r.damage ?? { stat: 'str' }),
      ...geometryFields(area),
    });
    if (twoHanded) Object.assign(template, { twoHanded: true, heavy: r.heavy ?? !ranged });
  } else Object.assign(template, { defense, ...(own(r, 'armor') ? { armor: bound(r.armor, 0, 1000000, 0) } : {}) });
  const item = { id: idBase, templateId, template, slot, name };
  attachAmmoPool(item, ammoCapacity(r));
  return item;
}

function sourceEquipment(record) {
  const value = record.equipment ?? record.equipments ?? record.items ?? record.装备 ?? [];
  const slots = new Map(Object.entries({ mainHand: 'mainHand', main: 'mainHand', weapon: 'mainHand', 主手: 'mainHand', 双手: 'twoHands', 双手武器: 'twoHands', offHand: 'offHand', off: 'offHand', 副手: 'offHand', shield: 'shield', 盾牌: 'shield' }));
  const entries = Array.isArray(value) ? value.map(v => ['', v]) : Object.entries(asObject(value));
  return entries.filter(([, item]) => object(item)).map(([key, item], i) => {
    // A later narrative placement overrides the starting hand declared in equipment tags.
    const position = [item.slot, item.position, item.位置].map(text).find(Boolean);
    const tags = [].concat(item.tags ?? item.标签 ?? []).map(text).join(',');
    const hand = tags.match(/(?:^|[\s,，、;；\[\]【】])(?:位置\s*[:：]\s*)?(主手|副手|双手(?:武器)?|盾牌)(?=$|[\s,，、;；\[\]【】])/u)?.[1];
    const rawSlot = position || (slots.has(key) ? key : hand || key);
    const name = item.name ?? item.名称 ?? (slots.has(key) ? '' : key);
    return [slots.get(rawSlot) ?? rawSlot, { ...item, name }, item.id ?? item.ID ?? (name || `unnamed-${i}`)];
  });
}
function normalizeBattleDefinition(raw, id = '') {
  const value = clone(asObject(raw));
  if (!value.name) value.name = id;
  if (value.weaponClass === 'bow' || value.weaponClass === 'crossbow' || value.weaponClass === 'arcane') value.weaponClass = value.weaponClass === 'arcane' ? 'staff' : 'ranged';
  if (value.hand === 'one') value.hand = 'one_handed';
  if (value.hand === 'two') value.hand = 'two_handed';
  if (value.hand === 'off') value.hand = 'off_hand';
  if (value.rangeType === 'ranged') value.ranged = true;
  if (value.rangeType === 'melee') value.ranged = false;
  const damageType = { '物理': 'physical', '能量': 'energy', '精神': 'mental', '真实': 'true' };
  if (object(value.damage) && damageType[value.damage.type]) value.damage.type = damageType[value.damage.type];
  return value;
}
function battleEquipmentRecord(participant, battle) {
  const definitions = asObject(battle?.equipment), result = {};
  for (const [field, slot] of [['mainHand', 'mainHand'], ['offHand', 'offHand'], ['shield', 'shield']]) {
    const id = text(participant?.[field]), definition = definitions[id];
    if (id && object(definition)) result[slot] = normalizeBattleDefinition(definition, id);
  }
  return Object.keys(result).length ? result : null;
}
function battleSkillsRecord(participant, battle) {
  const definitions = asObject(battle?.skills), result = {};
  for (const id of Array.isArray(participant?.skills) ? participant.skills : []) if (object(definitions[id])) result[id] = clone(definitions[id]);
  return Object.keys(result).length ? result : null;
}
const lengthKeys = ['bodyLengthM', 'bodyLength', 'BL', 'bl', '体长', '身高'];
const lengthToken = /(\d+(?:\.\d+)?|\.\d+)\s*(厘米|cm|米|m)?/i;
const modifiers = '(?:大约|约|[~～])?\\s*';
const explicitLength = new RegExp(`^${modifiers}${lengthToken.source}$`, 'i');
const describedLength = new RegExp(`(?:身高|体长|高度|高约|长约)\\s*[:：]?\\s*${modifiers}${lengthToken.source}(?![\\d.a-z])`, 'gi');
function meters(match) {
  if (!match) return null;
  const n = Number(match[1]) / (/^(cm|厘米)$/i.test(match[2]) ? 100 : 1);
  return Number.isFinite(n) && n > 0 ? Math.max(.01, Math.min(1e9, n)) : null;
}
function readBodyLength(record, warnings) {
  const keys = lengthKeys.filter(key => own(record, key));
  for (const key of keys) {
    const raw = record[key];
    const length = typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? Math.max(.01, Math.min(1e9, raw))
      : typeof raw === 'string' ? meters(explicitLength.exec(raw.replace(/\([^()]*\)|（[^（）]*）/g, '').trim())) : null;
    if (length !== null) return length;
  }
  for (const field of ['外貌特质','外貌','描述','appearance','description']) {
    const value = record[field];
    // YAML appearance blocks can be lists or labelled fields such as 身高: 168cm.
    const prose = Array.isArray(value) ? value.filter(s => typeof s === 'string').join('\n')
      : object(value) ? Object.entries(value).filter(([,v]) => typeof v === 'string' || typeof v === 'number').map(([k,v]) => `${k}: ${v}`).join('\n') : value;
    if (typeof prose !== 'string') continue;
    for (const match of prose.matchAll(describedLength)) {
      const length = meters(match);
      if (length !== null) return length;
    }
  }
  if (keys.length) warnings.push(`体长「${text(record[keys[0]])}」无法解析，已按默认 1.7 米处理`, { kind: 'auto_adjusted' });
  return 1.7;
}
function mergeBattleParticipant(record, participant, battle) {
  const fallback = asObject(record), inline = asObject(participant);
  const battleEquipment = battleEquipmentRecord(participant, battle), battleSkills = battleSkillsRecord(participant, battle);
  // Keep MVU/char_info values intact. Add only missing battle snapshot data;
  // placement/faction remain on participant and are consumed separately.
  const merged = { ...fallback };
  if (!(merged.equipment ?? merged.equipments ?? merged.items ?? merged.装备) && battleEquipment) merged.equipment = battleEquipment;
  if (!(merged.skills ?? merged.abilities ?? merged.技能) && battleSkills) merged.skills = battleSkills;
  const fields = {
    bodyLengthM: lengthKeys, mc: ['mc', 'MC', 'massClass'],
    tier: ['tier', 'levelTier', '层级', '生命层级'], armor: ['armor', 'defense', '护甲'],
    stats: ['stats', 'attributes', '属性', ...attrNames, ...Object.keys(statAliases)],
    statuses: ['statuses', '状态效果', '状态', 'effects'],
    hp: ['hp', 'HP', '生命值', 'resources', 'resource', '资源'],
    mp: ['mp', 'MP', '法力值', 'resources', 'resource', '资源'],
    sp: ['sp', 'SP', '体力值', 'resources', 'resource', '资源'],
  };
  for (const [field, aliases] of Object.entries(fields)) {
    if (inline[field] != null && !aliases.some(alias => own(merged, alias))) merged[field] = clone(inline[field]);
  }
  for (const field of ['maxHp', 'maxMp', 'maxSp']) if (!own(merged, field) && inline[field] != null) merged[field] = inline[field];
  return merged;
}
function sourceSkills(record) {
  const value = record.skills ?? record.abilities ?? record.技能 ?? [];
  if (Array.isArray(value)) return value.map((v, i) => [v, i]);
  return Object.entries(asObject(value)).map(([name, v], i) => [({ ...asObject(v), name: v?.name ?? v?.名称 ?? name }), i]);
}
export function mergeRecords(records) {
  const result = new Map();
  for (const record of records) {
    const key = sourceId(record) || sourceName(record) || record.__sourceKey;
    if (!key) continue;
    const id = deterministicId(key);
    result.set(id, { ...(result.get(id) ?? {}), ...record, stats: { ...(result.get(id)?.stats ?? {}), ...(record.stats ?? {}) } });
  }
  return result;
}

function participantList(battle) {
  const value = Array.isArray(battle.units) ? battle.units : battle.participants ?? battle.roster ?? [];
  const list = Array.isArray(value) ? value : Object.entries(asObject(value)).map(([id, participant]) => ({ ...(asObject(participant)), id: participant?.id ?? id }));
  const seen = new Set();
  return list.filter((participant, index) => {
    if (!object(participant)) return false;
    const source = text(participant.source);
    const key = text(participant?.id || participant?.uid)
      || (source && !charSources.includes(source.toLowerCase()) ? source : `${source}|${text(participant?.name) || index}|${index}`);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function teamOf(value, fallback = 'red') { const t = text(value).toLowerCase(); return ['blue','player','ally','友方','我方'].includes(t) ? 'blue' : ['red','enemy','foe','敌方'].includes(t) ? 'red' : fallback; }
function xyzOf(value, board, warnings) {
  const xyz = Array.isArray(value) ? value : [value.x, value.y, value.z];
  const x = integer(xyz[0]), y = integer(xyz[1]);
  const boundedX = Math.max(0, Math.min((board.width ?? 10) - 1, x));
  const boundedY = Math.max(0, Math.min((board.height ?? 10) - 1, y));
  if (x !== boundedX || y !== boundedY) warnings.push(`坐标 (${x},${y}) 越界，调整为 (${boundedX},${boundedY})`, { kind: 'auto_adjusted' });
  return { x: boundedX, y: boundedY, z: integer(xyz[2]) };
}

function importBackpack(bag, owner, skills, sink) {
  const inventory = {};
  for (const [name, item] of Object.entries(asObject(bag))) {
    if (item?.类型 !== '消耗品' && item?.kind !== 'consumable') continue;
    const count = bound(item.数量 ?? item.count, 0, 1e9, 1);
    if (!count) continue;
    const id = `bag-${hash(owner).toString(36)}-${hash(name).toString(36)}`;
    const warnings = sink('effect', `/skills/${id}`);
    const raw = item.effects ?? item.效果;
    const tags = [].concat(item.tags ?? item.标签 ?? []).join(' ');
    const area = areaFields(item, warnings, name);
    const range = bound(area.range, 0, 30, 3);
    const entries = [];
    const notes = { push: (message, metadata) => entries.push({ message, metadata }) };
    const rules = readRules(item.rules, notes);
    appendRules(rules, convertNarrative(raw, notes, id, { areaDamage: isAreaDamage(area) }), notes);
    for (const { message, metadata } of entries) warnings.push(`背包消耗品「${name}」：${message}`, metadata);
    if (!rules.length && !entries.length) warnings.push(`背包消耗品「${name}」缺少效果：请补全用途、目标和数值`);
    skills[id] = {name:name.slice(0,100),backpackItem:true,ap:1,slot:'action',range,
      shape:area.shape ?? 'single',target:area.target ?? 'enemy',rules,...geometryFields(area)};
    inventory[id] = count;
  }
  return inventory;
}

function unitFrom(record, participant, index, equipment, skills, items, sink, isProtagonist, board) {
  const resourcesSink = sink('resource'), warnings = sink('status');
  const p = participant ?? {};
  const name = text(p.protagonistName || p.name) || sourceName(record, p.id) || `单位 ${index + 1}`;
  const id = p.id;
  const stats = statsOf(record), level = Math.max(1, integer(findValue(record, ['level','等级'], 1), 1));
  const tier = Math.max(1, Math.min(7, tierNumber(findValue(record, ['tier','levelTier','层级','生命层级'], level), level)));
  const bodyLengthM = readBodyLength(record, sink('state'));
  const size = sizeClassFor(bodyLengthM);
  const mc = Math.max(1, Math.min(64, integer(findValue(record, ['mc','MC','massClass'], bodyLengthM >= 10 ? 2 : 1), 1)));
  const resources = { hp: safeResource(resource(record, 'hp', Math.max(1, stats.con * 100)), 'hp', resourcesSink), mp: safeResource(resource(record, 'mp', Math.max(0, (stats.int + stats.spi) * 10)), 'mp', resourcesSink), sp: safeResource(resource(record, 'sp', Math.max(0, (stats.str + stats.agi) * 10)), 'sp', resourcesSink) };
  const sourceEntries = sourceEquipment(record);
  const entrySources = {}, equipmentKeys = new Map();
  const equipmentEntry = ([slot, raw, identity]) => {
    const key = hash(String(identity)).toString(36);
    const occurrence = equipmentKeys.get(key) ?? 0;
    equipmentKeys.set(key, occurrence + 1);
    const item = normalizeEquipment(raw, slot, id, occurrence ? `${key}-${occurrence}` : key, sink);
    const { slot: _slot, position: _position, 位置: _placement, count: _count, 数量: _quantity, ...definition } = raw;
    entrySources[`equipment:${item.templateId}`] = definition;
    return item;
  };
  const slotItems = sourceEntries.map(equipmentEntry);
  const main = slotItems.find(i => i.template.kind === 'weapon' && i.template.twoHanded)
    ?? slotItems.find(i => i.template.kind === 'weapon' && i.slot === 'mainHand')
    ?? slotItems.find(i => i.template.kind === 'weapon' && i.slot !== 'offHand');
  const off = !main?.template.twoHanded && slotItems.find(i => i.slot === 'offHand' && ['weapon', 'consumable'].includes(i.template.kind));
  const shield = !main?.template.twoHanded && slotItems.find(i => i.template.kind === 'shield');
  const gear = slotItems.filter(i => ![main, off, shield].includes(i));
  const bagEntries = record.__sourceKind === 'MVU' ? sourceEquipment({装备:record.背包}) : [];
  const containerCounts = [...sourceEntries, ...bagEntries].map(([, raw]) =>
    raw.类型 === '武器' || raw.kind === 'weapon' ? null : ammoCapacity(raw)).filter(value => value != null);
  const ammoWeapon = [main, off, ...gear].find(item => item?.template?.ranged);
  if (ammoWeapon && containerCounts.length) {
    const ownAmmo = ammoWeapon.template.pools.ammo?.initial ?? 0;
    attachAmmoPool(ammoWeapon, Math.min(1e9, ownAmmo + containerCounts.reduce((sum, count) => sum + count, 0)));
  }
  for (const item of slotItems) {
    finalizeEquipment(item, sink('effect', `/equipment/${item.templateId}`));
    equipment[item.templateId] = item.template;
    items.push(item);
  }
  const mainId = main?.id ?? null, offId = off?.id ?? null, shieldId = shield?.id ?? null;
  const skillInfo = {};
  const skillKeys = new Map();
  const normalizedSkills = sourceSkills(record).slice(0, 32).map(([raw, i]) => {
    const r = asObject(raw);
    const skillName = text(r.name ?? r.名称).slice(0, 100) || `技能${i + 1}`;
    const key = hash(String(r.id ?? r.ID ?? skillName)).toString(36);
    const occurrence = skillKeys.get(key) ?? 0;
    skillKeys.set(key, occurrence + 1);
    const sid = `skill-${id.slice(0, 31)}-${hash(id).toString(36)}-${key}${occurrence ? `-${occurrence}` : ''}`;
    entrySources[`skills:${sid}`] = r;
    const labels = [].concat(r.tags ?? r.标签 ?? [], r.description ?? r.描述 ?? '').join(' ');
    const taggedPower = labels.match(/威力\s*[:：]\s*(\d+)/)?.[1];
    const notes = sink('effect', `/skills/${sid}`);
    const area = areaFields(r, notes, skillName);
    const costs = skillCosts(r.cost ?? r.消耗);
    const mode = text(r.模式 ?? r.mode);
    const passive = r.passive === true || mode.includes('被动') && !mode.includes('主动');
    const tag = tagEntries(r.tags ?? r.标签).map(label => label.match(/^伤害\s*[:：]\s*(.+)$/)?.[1]?.trim()).find(Boolean);
    const rawEffects = r.effects ?? r.效果;
    const power = r.power ?? taggedPower;
    const numericPower = number(power, NaN);
    const hasPower = Number.isFinite(numericPower) && numericPower >= 0;
    const statTag = tagEntries(r.tags ?? r.标签)
      .map(label => statAliases[label.match(/^(?:关联属性\s*[:：]\s*)?(力量|敏捷|体质|智力|精神)$/)?.[1]]).find(Boolean);
    const rules = readRules(r.rules, notes);
    const prefix = `fx-${hash(sid).toString(36)}`;
    const areaDamage = isAreaDamage(area);
    const narrativeNotes = [];
    appendRules(rules, convertNarrative(rawEffects, { push: (message, metadata) => narrativeNotes.push({ message, metadata }) }, prefix, { allowPower: !r.damage && hasPower, areaDamage }), notes);
    const singleTaggedType = damageAliases.get(tag);
    const hasActiveDamage = rules.some(rule => rule.enabled !== false && rule.hook === 'active' && [...instructions(rule.program)].some(op => op.op === 'damage'));
    if (!passive && !r.damage && !r.heal && !hasActiveDamage && tag) {
      const packets = hasPower ? damageTags(tag, power) : [];
      if (!singleTaggedType && packets.length && area.target !== 'cell') {
        const program = areaDamage ? [{ op: 'for_each', select: { from: 'action_targets' }, body: packets }] : packets;
        appendRules(rules, [activeRule(`${prefix}-damage`, program)], notes);
      } else if (!singleTaggedType || !hasPower) {
        notes.push(`「${skillName}」伤害标签待标准化：威力 ${power ?? '未声明'}、伤害「${tag}」（缺少明确分量或受击对象）`);
      } else if (!areaDamage && !rules.length && !narrativeEntries(rawEffects).length) {
        appendRules(rules, [activeRule(`${prefix}-damage`, packets)], notes);
      }
    }
    const damageOps = rules.filter(rule => rule.enabled !== false && rule.hook === 'active')
      .flatMap(rule => [...instructions(rule.program)].filter(op => op.op === 'damage'));
    const types = [...new Set(damageOps.map(op => op.damageType))];
    const rawDamageType = r.damageType ?? damageAliases.get(tag);
    const explicitDamageType = damageAliases.get(rawDamageType) ?? rawDamageType;
    const generatedDamageType = singleTaggedType ?? (damageTypes.includes(explicitDamageType) ? explicitDamageType : undefined);
    const generatedMainDamage = hasPower && !passive && !r.damage && !r.heal && !damageOps.length && (!tag || singleTaggedType)
      ? { count: 1, sides: 4, ...(statTag ? { stat: statTag } : {}), ...(generatedDamageType ? { type: generatedDamageType } : {}) }
      : null;
    if (generatedMainDamage && !generatedDamageType && narrativeNotes.length) {
      notes.push(`主击伤害类型待标准化「主击伤害类型」：根据原始效果补全 /skills/${sid}/damage/type；若原文明确以混合伤害或独立公式替代主击，请移除模板 damage 并以 active 规则结算。`, { userSummary: `技能「${skillName}」：待从原文识别主击伤害类型` });
    }
    const mainParsed = hasPower && (generatedMainDamage || damageOps.length);
    for (const { message, metadata } of narrativeNotes) notes.push(mainParsed
      ? `${message}。主击与威力 ${numericPower} 已解析，只补本条尚未实现的效果，不要重复添加主击。` : message, metadata);
    const damageType = explicitDamageType ?? (types.length === 1 ? types[0] : undefined);
    skillInfo[sid] = { description:text(r.description ?? r.描述), damageType, hp:costs.hp };
    skills[sid] = {
      name: skillName,
      ...(qualityOf(r) ? { quality: qualityOf(r) } : {}), ...(rawTagValues(r).length ? { tags: rawTagValues(r).slice(0, 32) } : {}), rawRange: area.range ?? 1, ...(passive && { passive: true }), ap: passive ? 0 : bound(r.ap ?? costs.ap, 0, 2), slot: (r.slot ?? costs.slot) === 'action' ? 'action' : 'attack',
      range: bound(area.range, 0, 64, 1), shape: area.shape ?? 'single',
      target: area.target ?? (areaDamage && object(r.damage) ? 'any' : 'enemy'), ...geometryFields(area),
      ...(text(r.school) ? { school: text(r.school).slice(0, 100) } : {}),
      ...(generatedMainDamage ? { damage: generatedMainDamage } : {}),
      rules, mods: readMods(r.mods, notes), pools: readPools(r.pools, notes),
    };
    if (damageTypes.includes(damageType)) skills[sid].damageType = damageType;
    else if (damageType != null) notes.push(`「${skillName}」未知伤害类型：${damageType}`);
    for (const [key, min, max] of [['mp', 0, 25000], ['sp', 0, 25000], ['accuracy', -20, 30], ['initiativeBonus', -100, 100], ['power', 0, 1e9]]) {
      const value = r[key] ?? (key === 'power' ? taggedPower : costs[key]);
      if (value != null) skills[sid][key] = bound(value, min, max);
    }
    if (r.save != null || r.saveDC != null) {
      const save = statAliases[r.save] ?? r.save;
      const dc = number(r.saveDC, NaN);
      const saveDC = Number.isInteger(dc) && dc >= 1 && dc <= 50 ? dc
        : typeof r.saveDC === 'string' && !Number.isFinite(dc) && validExpr(r.saveDC) ? r.saveDC : null;
      if (attrNames.includes(save) && saveDC != null && (r.damage || r.heal || !rules.length)) {
        Object.assign(skills[sid], { save, saveDC });
      } else notes.push(`「${skillName}」豁免待标准化：${describe({ save: r.save, saveDC: r.saveDC })}。规则效果请用 check 声明通过与失败分支`, { userSummary: `技能「${skillName}」：待确认抵抗检定的属性和难度` });
    }
    if (object(r.resourceCost)) skills[sid].resourceCost = clone(r.resourceCost);
    if (costs.hp != null) skills[sid].resourceCost = { hp:bound(costs.hp, 0, 25000), ...skills[sid].resourceCost };
    for (const key of ['damage', 'heal']) if (object(r[key])) skills[sid][key] = normalizeDice(r[key]);
    return sid;
  });
  const pos = xyzOf(p.xyz ?? p, board, sink('state'));
  const sourceStatuses = record.statuses ?? record.状态效果 ?? record.状态 ?? record.effects;
  const statuses = {};
  const statusEntries = Array.isArray(sourceStatuses)
    ? sourceStatuses.map(s => [typeof s === 'string' ? s : s?.id ?? s?.statusId ?? s?.name ?? s?.名称, s])
    : Object.entries(asObject(sourceStatuses));
  for (const [rawId, rawStatus] of statusEntries) {
    if ((Array.isArray(sourceStatuses) && emptyEntry(rawStatus)) || (typeof rawId === 'string' && emptyEntry(rawId))) continue;
    const sid = statusId(rawStatus?.statusId ?? rawStatus?.id ?? rawId);
    const template = STATUSES[sid];
    const description = text(rawStatus?.效果 ?? rawStatus?.description ?? rawStatus?.描述 ?? (rawStatus !== rawId && typeof rawStatus === 'string' ? rawStatus : ''));
    if (!template || description && description !== template.description) {
      warnings.push(`状态待标准化：${rawId ?? 'unknown'}${description ? `：${description}` : ''}`);
      continue;
    }
    const remainingTurns = statusTurns(rawStatus?.remainingTurns ?? rawStatus?.剩余回合 ?? rawStatus?.剩余时间, template.remainingTurns);
    const stacks = bound(rawStatus?.stacks ?? rawStatus?.层数, 1, template.maxStacks);
    if (!emptyEntry(rawStatus?.modifiers)) warnings.push(`状态 ${sid} 的 modifiers 待标准化：${describe(rawStatus.modifiers)}。请在状态模板上声明 mods 或 rules`, { userSummary: `状态「${template.name}」：附带效果待转换` });
    const durationType = ['battle_turns', 'until_removed', 'persistent'].includes(rawStatus?.durationType)
      ? rawStatus.durationType : template.durationType;
    const shieldAmount = template.category === 'shield'
      ? bound(rawStatus?.amount ?? rawStatus?.护盾值, 1, 1e9, template.vars.shieldAmount) : null;
    statuses[sid] = { ...clone(template), templateId: sid, ownerId: id, sourceId: null, durationType, remainingTurns, stacks,
      ...(shieldAmount != null && { vars: { ...template.vars, shieldAmount } }),
    };
  }
  const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
  const team = teamOf(p.faction ?? p.team, 'red');
  const rawFacing = Array.isArray(p.facing) ? p.facing : [team === 'blue' ? 1 : -1, 0];
  const facing = rawFacing.slice(0, 2).map(n => Math.sign(integer(n)));
  if (facing.length !== 2 || !facing.some(Boolean)) facing.splice(0, 2, team === 'blue' ? 1 : -1, 0);
  const rawMove = number(findValue(record, ['move','movement','移动'], null), NaN);
  const defaultMove = Math.min(5, 3 + Math.floor(Math.log10(Math.max(1, stats.agi / 10))));
  const unit = { rawMove: Number.isFinite(rawMove) ? Math.max(0, rawMove) : defaultMove, id, name, team, x: pos.x, y: pos.y, ...(Number.isInteger(p.altitude) && p.altitude > 0 ? { altitude: p.altitude } : {}), facing, hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats, armor: Math.max(0, Math.min(1000000, integer(findValue(record, ['armor','defense','护甲'], 0), 0))), size, move: Math.max(1, Math.min(10, integer(findValue(record, ['move','movement','移动'], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.slice(0, 12).map(item => item.id), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: 'offensive', parryQuota: stance === 'greatsword' ? 2 : 0, parryRefunded: false, attunementCharges: stance === 'attunement' ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: 'normal', nonLethal: p.nonLethal === true, moraleType: moraleTypeFor(p.moraleType) ?? 'standard', ...(isProtagonist && {protagonist:true}) };
  if (p.moraleType && !moraleTypeFor(p.moraleType)) sink('state').push(`未知战斗类型「${p.moraleType}」，按标准处理`);
  if (isProtagonist) {
    const bagWeapons = [];
    for (const [slot, raw, identity] of sourceEquipment({装备:record.背包})) {
      if ((raw.类型 !== '武器' && raw.kind !== 'weapon') || bound(raw.数量 ?? raw.count, 0, 1e9, 1) === 0) continue;
      const item = equipmentEntry([slot, raw, identity]);
      if (item.template.kind === 'weapon') {
        finalizeEquipment(item, sink('effect', `/equipment/${item.templateId}`));
        equipment[item.templateId] = item.template;
        items.push(item);
        bagWeapons.push(item.id);
      }
    }
    if (bagWeapons.length) unit.bagWeapons = bagWeapons;
    const inventory = importBackpack(record.背包, id, skills, sink);
    if (Object.keys(inventory).length) unit.inventory = inventory;
  }
  const creatureType = p.creatureType ?? record.creatureType;
  if (Array.isArray(creatureType)) unit.creatureType = creatureType.map(text).filter(Boolean).slice(0, 12);
  else if (text(creatureType)) unit.creatureType = text(creatureType).slice(0, 100);
  const tags = p.tags ?? record.tags;
  if (Array.isArray(tags)) unit.tags = tags.map(text).filter(tag => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag)).slice(0, 32);
  unit.rules = readRules(record.rules, sink('effect', `/units/${id}`));
  unit.mods = readMods(record.mods, sink('effect', `/units/${id}`));
  return { unit, entrySources, profile: { id, skillInfo, level, tier, stats, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, equipment: clone(slotItems), sourcePath: record.__sourcePath ?? null, sourceKind: record.__sourceKind || 'unknown', fieldSources: { numeric: record.__sourceKind || 'unknown', equipment: record.__sourceKind || 'unknown', placement: 'battle_init', faction: 'battle_init', name: p.protagonistName ? 'persona' : (p.name ? 'battle_init' : (record.__sourceKind || 'unknown')) } }, participant: p };
}

function terrainState(battle, state, warnings) {
  state.grid = createBattleGrid(battle, state.rng, Object.values(state.units), warnings);
  for (const [i, raw] of (Array.isArray(battle.covers) ? battle.covers : []).entries()) {
    if (!object(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw, battle, warnings), id = deterministicId(raw.id ?? `cover-${i}`, 'cover');
    if (state.grid[p.y][p.x].kind === 'wall') {
      warnings.push(`忽略位于墙体内的掩体：${id}`);
      continue;
    }
    const full = Number(raw.cover ?? raw.shielding) >= 5 || raw.material === '全';
    const defaultHp = defaultCoverHp(state.scale?.cellM ?? 2, full);
    state.covers[id] = { id, name: text(raw.name) || `掩体${i + 1}`, x: p.x, y: p.y, z: p.z, material: text(raw.material) || '未知材料', hp: Math.max(0, Math.min(1000000000, integer(raw.hp ?? raw.maxHp ?? defaultHp, defaultHp))), maxHp: Math.max(1, Math.min(1000000000, integer(raw.maxHp ?? raw.hp ?? defaultHp, defaultHp))), cover: Math.max(0, Math.min(12, integer(raw.cover ?? raw.shielding, 2))) };
    state.covers[id].hp = Math.min(state.covers[id].hp, state.covers[id].maxHp);
  }
  const interactives = battle.interacts ?? battle.interactives;
  for (const [i, raw] of (Array.isArray(interactives) ? interactives : []).entries()) {
    if (!object(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw, battle, warnings), id = deterministicId(raw.id ?? `interactive-${i}`, 'interactive');
    if (state.grid[p.y][p.x].kind === 'wall') {
      warnings.push(`忽略位于墙体内的互动点：${id}`);
      continue;
    }
    const declared = text(raw.kind ?? raw.type).toLowerCase();
    const kind = ['altar', 'barrel'].includes(declared) ? declared : /祭坛|altar/.test(text(raw.name)) ? 'altar' : 'barrel';
    state.interactives[id] = { id, name: text(raw.name) || (kind === 'altar' ? '星辉祭坛' : '余烬爆桶'), x: p.x, y: p.y, z: p.z, kind, effect: text(raw.effect) || (kind === 'barrel' ? 'explode' : 'heal'), radius: integer(raw.radius, 2), damage: integer(raw.damage, kind === 'barrel' ? 12 : 0), spent: Boolean(raw.spent) };
  }
  return state;
}

function placeUnits(state, warnings) {
  const placed = { ...state, units: {} };
  const { width, height } = state.scale;
  for (const unit of Object.values(state.units)) {
    const start = unit.y * width + unit.x;
    for (let n = 0; ; n++) {
      if (n === width * height) throw new Error(`棋盘没有可放置 ${unit.id} 的位置`);
      const index = (start + n) % (width * height), x = index % width, y = Math.floor(index / width);
      if (!canOccupy(placed, x, y, unit)) continue;
      if (n) warnings.push(`${unit.id} 起点不可用，从 (${unit.x},${unit.y}) 移至 (${x},${y})`);
      Object.assign(unit, { x, y }); placed.units[unit.id] = unit;
      break;
    }
  }
}

/** Convert MVU stat_data, one or more char_info blocks, and battle_init into a
 * validated tactical state. The returned roster retains level/source metadata
 * which the engine unit schema intentionally does not store. */
export function hydrateFromSources(input = {}, options = {}) {
  const source = asObject(input), warnings = [];
  const sink = (unitId, source, scope, path) => warningSink(warnings, unitId, source, scope, path);
  const protagonistName = text(source.protagonistName ?? options.protagonistName);
  const mvu = source.mvu ?? source.statData ?? source.stat_data ?? {};
  const battle = parseBattleInit(source.battleInit ?? source.battle_init ?? source.battle ?? {});
  const chars = parseCharInfo(source.charInfo ?? source.char_info ?? '').map(record => ({ ...record, __sourceKind: 'char_info' }));
  const mvuRecords = collectMvu(mvu);
  const protagonist = protagonistAliases.flatMap(alias => mvuRecords.filter(record => samePath(record.__sourcePath, [alias])))[0];
  const descriptor = battle.version === 1 && ['flat', 'terrain'].includes(battle.terrainMode);
  const participants = participantList(battle);
  const resolved = participants.map(participant => resolveParticipant(participant, mvuRecords, chars, protagonist));
  // Older chapter JSON uses generated unit IDs and rarely names the MVU path.
  if (!descriptor && protagonist && !resolved.includes(protagonist)) {
    const eligible = p => !text(p.source) && teamOf(p.faction ?? p.team) === 'blue';
    const byPersona = protagonistName ? participants.findIndex((p, i) => eligible(p) && text(p.name) === protagonistName
      && resolved[i]?.__sourceKind !== 'MVU') : -1;
    const fallbackIndex = byPersona >= 0 ? byPersona : participants.findIndex((p, i) => eligible(p) && !resolved[i]);
    if (fallbackIndex >= 0) resolved[fallbackIndex] = protagonist;
  }
  const equipment = clone(EQUIPMENT), skills = clone(SKILLS), items = [];
  const units = {}, profiles = {}, sourceMap = {}, entrySources = {}, archetypes = new Map();
  const add = (participant, record, index) => {
    const base = descriptor ? participant.id : deterministicId(participant.id || participant.uid || participant.source || `${participant.name}-${index}`, 'unit');
    let id = base;
    for (let suffix = 2; own(units, id); suffix++) id = `${base.slice(0, 52)}-${suffix}`;
    const persona = !descriptor && record === protagonist && protagonistName ? { protagonistName } : {};
    const origin = record.__sourceKind?.toLowerCase() ?? 'battle_init';
    if (index < participants.length && !resolved[index] && participant.source) sink(id, 'battle_init', 'state').push(`未找到参战来源：${participant.source}（${participant.name ?? participant.id}）`);
    const merged = mergeBattleParticipant(record, participant, battle);
    const placement = { moraleType:battle.moraleType, ...participant, ...persona, id };
    const startWarnings = warnings.length;
    const made = unitFrom(merged, placement, index, equipment, skills, items, (scope, path) => sink(id, origin, scope, path), record === protagonist, battle);
    if (origin === 'char_info') {
      // Preserve source order: it can decide which weapon is selected as main hand.
      const { 数量: _quantity, count: _count, ...definition } = merged;
      const signature = JSON.stringify([definition, made.unit.tags, made.unit.creatureType, made.unit.nonLethal, made.unit.moraleType]);
      if (!archetypes.has(signature)) archetypes.set(signature, id);
      made.profile.archetypeId = archetypes.get(signature);
      if (made.profile.archetypeId !== id) warnings.splice(startWarnings);
    }
    units[id] = made.unit;
    profiles[id] = made.profile;
    entrySources[id] = made.entrySources;
    sourceMap[id] = { path: record?.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record), isProtagonist: record === protagonist };
  };
  for (const [i, participant] of participants.entries()) {
    const record = resolved[i];
    const count = record?.__sourceKind === 'char_info' ? bound(record.数量 ?? record.count, 1, 100, 1) : 1;
    for (let copy = 0; copy < count; copy++) {
      const placement = copy ? { ...participant, id: `${participant.id ?? participant.uid ?? participant.name}-${copy + 1}` } : participant;
      add(placement, record ?? { __sourceKind: 'battle_init' }, i * count + copy);
    }
  }
  // Older battles without an explicit roster retain the discovered characters.
  if (!participants.length) {
    const records = [...mvuRecords, ...chars.filter(char => !mvuRecords.some(record => sourceName(record, record.__sourceKey) === sourceName(char)))];
    let index = 0;
    for (const [i, record] of records.entries()) {
      const count = record.__sourceKind === 'char_info' ? bound(record.数量 ?? record.count, 1, 100, 1) : 1;
      for (let copy = 0; copy < count; copy++, index++) {
        add({ name: sourceName(record, record.__sourceKey), source: sourceId(record), faction: i ? 'red' : 'blue', x: index % (battle.width ?? 10), y: Math.floor(index / (battle.width ?? 10)) % (battle.height ?? 10) }, record, index);
      }
    }
  }
  const title = text(battle.sceneTitle ?? battle.title ?? options.title).slice(0, 100) || '酒馆战术战局';
  const seed = integer(options.seed ?? battle.seed, hash(battle.battleId ?? title)) >>> 0;
  const anchorTier = Math.max(1, ...Object.values(units).map(unit => unit.tier ?? 1));
  const cellM = battle.cellM ?? TIER_CELL_M[anchorTier];
  const state = { ...(battle.suppressingTeam && {suppressingTeam:battle.suppressingTeam}), battleType:moraleTypeFor(battle.moraleType) ?? 'standard', scenarioId: descriptor ? battle.battleId : deterministicId(battle.battleId ?? title, 'battle'), title, mode: 'split', ruleset: ['protocol','sandbox'].includes(options.ruleset) ? options.ruleset : 'protocol', scale: { cellM, width: battle.width ?? 10, height: battle.height ?? 10, anchorTier, explicit: battle.explicitScale === true }, round: 1, turn: 0, order: Object.keys(units), units, items: Object.fromEntries(items.map(({ id, templateId }) => [id, { id, templateId }])), equipment, skills, statusTemplates: {}, grid: [], covers: {}, interactives: {}, zones: {}, rng: seed, logs: [], outcome: null, tape: [] };
  initializeVMWorld(state);
  const time = parseBattleTime(source.task, source.battle, source.battleText, source.latestFloor, source.battleInit, source.battle_init);
  if (time) state.time = time;
  for (const unit of Object.values(units)) {
    unit.moveM = unit.rawMove * TIER_CELL_M[unit.tier];
    unit.move = scaledCells(unit.rawMove, unit.tier, cellM, { floor: true });
    unit.moveCarryPermille = 0;
  }
  const adjustmentSink = (source, scope) => ({ push: message => sink(null, source, scope).push(message, { kind: 'auto_adjusted' }) });
  terrainState(battle, state, adjustmentSink('terrain', 'terrain'));
  placeUnits(state, adjustmentSink('battle_init', 'state'));
  let valid = true;
  try { validateState(state); } catch (error) {
    valid = false;
    sink(null, null, 'state').push(`转换结果未通过校验：${error.message}`);
    if (options.throwOnValidation) throw error;
  }
  if (valid) beginBattle(state);
  const roster = Object.values(units).map(unit => ({ ...profiles[unit.id], ...clone(unit), source: profiles[unit.id].sourceKind }));
  // Keep conversion diagnostics out of serialized engine state (which has a strict schema).
  Object.defineProperty(state, 'warnings', { value: warnings });
  return { state, roster, warnings, sourceMap, entrySources, battleInit: battle, seed };
}

export function warningsForUnit(warnings = [], unitIds, includeGlobal = true) {
  if (!unitIds?.length) return warnings;
  const selected = new Set(unitIds);
  return warnings.filter(w => w.unitId === null ? includeGlobal : selected.has(w.unitId));
}

export const convertSources = hydrateFromSources;
export const buildState = (input, options) => hydrateFromSources(input, options).state;

function pointer(path) { return '/' + path.map(x => String(x).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'); }
/** Return RFC 6902 operations for the host's MVU JSONPatch handler. No host
 * mutation happens here; callers can wrap these operations in UpdateVariable. */
export function battleReportToMvuPatch(report, sourceMap = {}, options = {}) {
  const state = report?.state ?? report?.battleState ?? report;
  const units = state?.units ?? (Array.isArray(report?.units) ? Object.fromEntries(report.units.map(u => [u.id, u])) : {});
  const ops = [];
  for (const [id, unit] of Object.entries(units)) {
    const mapping = sourceMap[id] ?? {};
    const path = Array.isArray(mapping.path) ? mapping.path : ['characters', id];
    for (const key of ['hp','mp','sp']) if (unit && Number.isFinite(unit[key])) ops.push({ op: 'replace', path: pointer([options.root ?? 'stat_data', ...path, key]), value: unit[key] });
    if (unit?.statuses && options.includeStatuses !== false) ops.push({ op: 'replace', path: pointer([options.root ?? 'stat_data', ...path, 'statuses']), value: clone(unit.statuses) });
  }
  return ops;
}
export const buildPostBattlePatch = battleReportToMvuPatch;
export function buildMvuJsonPatch(report, sourceMap = {}, options = {}) {
  const patch = battleReportToMvuPatch(report, sourceMap, options);
  return `<UpdateVariable><JSONPatch>${JSON.stringify(patch)}</JSONPatch></UpdateVariable>`;
}
