import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { validateState } from '../api/validation.js';
import { sizeFor, stanceFor } from '../core/combat_protocol.js';
import { beginBattle, STATUSES } from '../core/combat.js';
import { parseBattleDescriptor } from './descriptor.js';
import { createBattleGrid } from './terrain.js';

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
      const colon = rest.indexOf(':');
      if (colon > 0 && !rest.startsWith('{')) {
        const child = {}; parent.push(child);
        child[rest.slice(0, colon).trim()] = scalar(rest.slice(colon + 1));
        stack.push({ indent: line.indent, value: child });
      } else parent.push(scalar(rest));
      continue;
    }
    const colon = line.value.indexOf(':');
    if (colon < 1 || !object(parent)) continue;
    const key = line.value.slice(0, colon).trim();
    const tail = line.value.slice(colon + 1).trim();
    if (tail === '|' || tail === '>') {
      const chunks = [];
      for (let j = i + 1; j < lines.length && lines[j].indent > line.indent; j++) { chunks.push(lines[j].value); i = j; }
      parent[key] = chunks.join(tail === '>' ? ' ' : '\n');
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
    // Legacy prompt routes used brace-delimited blocks rather than XML.
    const legacy = value.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*([\s\S]*?)\s*\{\s*\/\s*(?:battle_in|战术沙盘)\s*\}/i);
    if (legacy) return parseBattleBody(legacy[1]);
    const brace = value.match(/^\s*\{\s*(?:battle_in|战术沙盘)\s*:\s*([\s\S]+)\}\s*$/i);
    return parseBattleBody(brace ? brace[1] : value);
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
  if (max > 1000000000 || pair.current > 1000000000) { warnings.push(`${key} 超出引擎上限，已截到 1e9`); max = Math.min(max, 1000000000); current = Math.min(current, max); }
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
  const char = chars.find(record => sourceName(record) === name);
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
  const found = [];
  const visit = (node, key = '', path = []) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, String(i), [...path, i]));
    if (!object(node)) return;
    const name = sourceName(node, key), hasStats = node.stats || node.attributes || node.属性 || ['力量','敏捷','体质','智力','精神'].some(k => own(node, k));
    const hasResource = ['hp', 'maxHp', 'mp', 'sp', 'tier', 'level', 'equipment', 'skills', '生命值', '法力值', '体力值', '装备', '技能', '资源'].some(k => own(node, k));
    if (name && (hasStats || hasResource)) found.push({ ...clone(node), __sourceKey: key, __sourcePath: path, __sourceKind: 'MVU' });
    for (const [k, v] of Object.entries(node)) if (!['stats', 'attributes', '属性', 'resources', '资源', 'equipment', '装备', 'skills', '技能', 'statuses', '状态效果'].includes(k)) visit(v, k, [...path, k]);
  };
  visit(root);
  return found;
}

const effectAliases = {
  killcharge: 'kill_charge_weapon', kill_charge: 'kill_charge_weapon', ammo_charge: 'ammo', bleed: 'backstab',
  knock_back: 'knockback', teleport_backstab: 'teleport_backstab', cleanse_status: 'cleanse', root: 'opportunity_root',
};
const equipmentEffects = new Set(['kill_charge_weapon', 'ammo', 'frost_thorns', 'backstab', 'healing_shield', 'opportunity_root']);
const skillEffects = new Set(['status', 'knockback', 'teleport_backstab', 'cleanse']);
const statusAliases = { burning: 'burn', fire: 'burn', bleeding: 'bleed', frozen: 'freeze', immobilize: 'root', 燃烧: 'burn', 冻结: 'freeze', 晕眩: 'stun', 加速: 'haste' };
const statusNames = new Map(Object.values(STATUSES).map(status => [status.name, status.id]));
function statusId(value) {
  const key = text(value).toLowerCase();
  return own(STATUSES, key) ? key : statusNames.get(key) ?? (own(statusAliases, key) ? statusAliases[key] : null);
}
const bound = (value, min, max, fallback = min) => Math.max(min, Math.min(max, integer(value, fallback)));
function statusTurns(value, fallback) {
  const turns = typeof value === 'string' ? value.match(/^\s*(\d+)\s*(?:回合|轮)\s*$/)?.[1] ?? value : value;
  return bound(turns, 1, 100, fallback);
}

/** Map only effects understood by validation/engine. Unknown effects are
 * intentionally dropped (level 3 safety downgrade), never executed. */
export function mapEffect(raw, context = 'skill', warnings = []) {
  const input = typeof raw === 'string' ? { kind: raw } : asObject(raw);
  let kind = text(input.kind ?? input.type ?? input.effect ?? input.name ?? input.类型).toLowerCase().replace(/[ -]/g, '_');
  if (own(effectAliases, kind)) kind = effectAliases[kind];
  const allowed = context === 'equipment' ? equipmentEffects : skillEffects;
  if (allowed.has(kind)) {
    if (kind === 'status') {
      const rawId = input.statusId ?? input.status ?? input.value ?? input.状态;
      const id = statusId(rawId);
      if (!id) { warnings.push(`效果引用未知状态，已忽略：${text(rawId) || 'unknown'}`); return null; }
      const turns = input.turns ?? input.剩余回合 ?? input.持续回合;
      const stacks = input.stacks ?? input.层数;
      return { kind, statusId: id,
        ...(turns != null ? { turns: statusTurns(turns, STATUSES[id].remainingTurns) } : {}),
        ...(stacks != null ? { stacks: bound(stacks, 1, STATUSES[id].maxStacks) } : {}),
        ...(id === 'shield' && input.amount != null ? { amount: bound(input.amount, 1, 500) } : {}),
      };
    }
    // Construct a narrow, validator-compatible shape rather than copying
    // arbitrary source keys into an engine template.
    if (kind === 'cleanse' || kind === 'opportunity_root') return { kind };
    if (kind === 'knockback') return { kind, distance: Math.max(1, Math.min(5, integer(input.distance ?? input.amount, 1))), collisionDamage: Math.max(0, Math.min(80, integer(input.collisionDamage, 0))) };
    if (kind === 'teleport_backstab') return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, .5))) };
    if (kind === 'kill_charge_weapon') return { kind, counterKey: deterministicId(input.counterKey ?? 'souls', 'counter'), bonusPerStack: Math.max(0, Math.min(2, number(input.bonusPerStack, .5))), maxStacks: Math.max(1, Math.min(50, integer(input.maxStacks, 10))) };
    if (kind === 'ammo') return { kind, counterKey: deterministicId(input.counterKey ?? 'ammo', 'counter'), capacity: Math.max(1, Math.min(50, integer(input.capacity, 6))), armorPierce: Math.max(0, Math.min(50, integer(input.armorPierce, 0))), highGroundRange: Math.max(0, Math.min(6, integer(input.highGroundRange, 0))), highGroundAccuracy: Math.max(0, Math.min(12, integer(input.highGroundAccuracy, 0))) };
    if (kind === 'frost_thorns') {
      const id = statusId(input.statusId ?? 'chill');
      if (!id) { warnings.push(`效果引用未知状态，已忽略：${text(input.statusId)}`); return null; }
      return { kind, damage: bound(input.damage, 0, 50, 3), chance: Math.max(0, Math.min(1, number(input.chance, .4))), statusId: id };
    }
    if (kind === 'backstab') return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, .4))), bleedStacks: Math.max(1, Math.min(5, integer(input.bleedStacks, 1))), comboDamage: Math.max(0, Math.min(50, integer(input.comboDamage, 0))) };
    if (kind === 'healing_shield') return { kind, healBonus: Math.max(0, Math.min(4, number(input.healBonus, .25))), shieldRatio: Math.max(0, Math.min(4, number(input.shieldRatio, .5))) };
  }
  const id = statusId(input.statusId ?? input.status ?? kind);
  if (context === 'skill' && id) { warnings.push(`效果 ${kind} 按状态别名降级为 ${id}`); return { kind: 'status', statusId: id }; }
  warnings.push(`不支持的效果已忽略：${kind || 'unknown'}`);
  return null;
}
export function mapEffects(effects, context = 'skill', warnings = []) {
  let input = Array.isArray(effects) ? effects : effects == null ? [] : [effects];
  if (object(effects) && !['kind', 'type', 'effect', 'name', '类型'].some(key => own(effects, key))) {
    input = [];
    for (const [name, value] of Object.entries(effects)) {
      if (object(value)) input.push({ kind: name, ...value });
      else warnings.push(`不支持的描述性效果已忽略：${name}${text(value) ? `：${text(value)}` : ''}`);
    }
  }
  const result = [], seen = new Set();
  for (const raw of input) {
    const effect = mapEffect(raw, context, warnings);
    if (!effect) continue;
    const key = effect.counterKey ?? effect.kind;
    if (result.length >= 12 || (seen.has(key) && effect.kind !== 'status')) {
      warnings.push(`重复或超量效果已忽略：${effect.kind}`);
      continue;
    }
    result.push(effect);
    seen.add(key);
  }
  return result;
}

const damageAliases = new Map(Object.entries({ 物理: 'physical', 能量: 'energy', 精神: 'mental', 真实: 'true' }));
const damageTypes = ['physical', 'energy', 'mental', 'true'];
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

function normalizeEquipment(raw, slot, owner, index, warnings) {
  const r = asObject(raw), name = text(r.name ?? r.名称 ?? r.itemName) || `${slot || '装备'}${index + 1}`;
  const isShield = slot === 'shield' || r.kind === 'shield' || r.shield === true || r.weaponClass === 'shield' || /盾/.test(name);
  const labels = Array.isArray(r.tags ?? r.标签) ? (r.tags ?? r.标签).join(' ') : text(r.tags ?? r.标签);
  const kindAliases = new Map([['武器', 'weapon'], ['防具', 'armor'], ['饰品', 'accessory'], ['消耗品', 'consumable']]);
  const declaredKind = ['weapon', 'armor', 'accessory', 'consumable'].includes(r.kind) ? r.kind : kindAliases.get(r.类型);
  const kind = isShield ? 'shield' : declaredKind || (['mainHand', 'offHand', 'twoHands'].includes(slot)
    || r.damage || r.attack != null || r.weaponClass || /攻击|双手|巨剑|长戟|弓|弩|法杖|发射器/.test(`${name} ${labels}`) ? 'weapon' : 'accessory');
  const isWeapon = kind === 'weapon';
  const idBase = `item-${owner.length}-${owner.slice(0, 31)}-${hash(owner).toString(36)}-${index}`;
  const templateId = `template-${idBase}`;
  const effects = mapEffects(r.effects ?? r.effectsList ?? r.效果, 'equipment', warnings).filter(effect => {
    const weaponEffect = !['frost_thorns', 'healing_shield'].includes(effect.kind);
    if (weaponEffect === isWeapon) return true;
    warnings.push(`装备特效与装备类型不匹配，已忽略：${name}/${effect.kind}`);
    return false;
  });
  const template = { name: name.slice(0, 100), kind, effects };
  const defenseTag = labels.match(/防御\s*[:：]\s*([\d.e+-]+)/i);
  const defense = bound(r.defense ?? r.防御 ?? defenseTag?.[1], 0, 1000000, kind === 'shield' ? 1 : 0);
  if (kind === 'shield') Object.assign(template, { weaponClass: 'shield', hand: 'off_hand', shield: true, defense });
  else if (isWeapon) {
    const classes = ['ranged', 'light_blade', 'greatsword', 'staff', 'auxiliary'];
    const weaponClassAlias = new Map([['bow', 'ranged'], ['crossbow', 'ranged'], ['arcane', 'staff']]);
    const explicitClass = weaponClassAlias.get(r.weaponClass) ?? r.weaponClass;
    const ranged = r.ranged ?? (r.rangeType ? r.rangeType === 'ranged' : ['ranged', 'staff'].includes(explicitClass) || /弓|弩|法杖|远程|发射器/.test(`${name} ${labels}`));
    const twoHanded = slot === 'twoHands' || r.twoHanded === true || r.hand === 'two_handed' || explicitClass === 'greatsword'
      || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${labels}`);
    const attackTag = labels.match(/攻击\s*[:：]\s*([\d.e+-]+)/i), rangeTag = labels.match(/(?:有效距离|射程)[^\d]*(\d+)/i);
    const weaponClass = classes.includes(explicitClass) ? explicitClass : ranged ? 'ranged' : twoHanded ? 'greatsword' : 'light_blade';
    Object.assign(template, {
      weaponClass, hand: twoHanded ? 'two_handed' : slot === 'offHand' ? 'off_hand' : 'one_handed',
      ranged: Boolean(ranged), rangeType: ranged ? 'ranged' : 'melee',
      range: bound(r.range ?? r.有效距离 ?? rangeTag?.[1], 1, 15, ranged ? 4 : 1),
      attack: bound(r.attack ?? r.攻击 ?? attackTag?.[1], 0, 1e9), accuracy: bound(r.accuracy ?? r.命中, -20, 30, 0),
      damage: normalizeDice(r.damage ?? { stat: 'str' }),
    });
    if (twoHanded) Object.assign(template, { twoHanded: true, heavy: r.heavy ?? !ranged });
  } else Object.assign(template, { armor: bound(r.armor, 0, 1000000, defense), defense });
  const counters = Object.fromEntries(effects.flatMap(e => e.kind === 'ammo' ? [[e.counterKey || 'ammo', integer(e.capacity, 1)]] : e.kind === 'kill_charge_weapon' ? [[e.counterKey || 'souls', 0]] : []));
  return { id: idBase, templateId, template, counters, slot, name };
}

function sourceEquipment(record) {
  const value = record.equipment ?? record.equipments ?? record.items ?? record.装备 ?? [];
  const slots = new Map(Object.entries({ mainHand: 'mainHand', main: 'mainHand', weapon: 'mainHand', 主手: 'mainHand', 双手: 'twoHands', 双手武器: 'twoHands', offHand: 'offHand', off: 'offHand', 副手: 'offHand', shield: 'shield', 盾牌: 'shield' }));
  const entries = Array.isArray(value) ? value.map(v => ['', v]) : Object.entries(asObject(value));
  return entries.filter(([, item]) => object(item)).map(([key, item], i) => {
    const rawSlot = text(item.slot ?? item.position ?? item.位置) || key;
    return [slots.get(rawSlot) ?? rawSlot, { ...item, name: item.name ?? item.名称 ?? (slots.has(key) ? '' : key) }, i];
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
  if (Array.isArray(value.effects)) value.effects = value.effects.map(effect => typeof effect === 'string' ? { kind: effect } : effect);
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
function mergeBattleParticipant(record, participant, battle) {
  const fallback = asObject(record), inline = asObject(participant);
  const battleEquipment = battleEquipmentRecord(participant, battle), battleSkills = battleSkillsRecord(participant, battle);
  // Keep MVU/char_info values intact. Add only missing battle snapshot data;
  // placement/faction remain on participant and are consumed separately.
  const merged = { ...fallback };
  if (!(merged.equipment ?? merged.equipments ?? merged.items ?? merged.装备) && battleEquipment) merged.equipment = battleEquipment;
  if (!(merged.skills ?? merged.abilities ?? merged.技能) && battleSkills) merged.skills = battleSkills;
  const fields = {
    bodyLengthM: ['bodyLengthM', 'bodyLength', 'bl', '体长'], mc: ['mc', 'MC', 'massClass'],
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
      || (source && !charSources.includes(source.toLowerCase()) ? source : `${source}|${text(participant?.name) || index}`);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function teamOf(value, fallback = 'red') { const t = text(value).toLowerCase(); return ['blue','player','ally','友方','我方'].includes(t) ? 'blue' : ['red','enemy','foe','敌方'].includes(t) ? 'red' : fallback; }
function xyzOf(value) { const p = asObject(value); const xyz = Array.isArray(value) ? value : Array.isArray(p.xyz) ? p.xyz : [p.x, p.y, p.z]; return { x: Math.max(0, Math.min(9, integer(xyz[0], 0))), y: Math.max(0, Math.min(9, integer(xyz[1], 0))), z: integer(xyz[2], 0) }; }

function unitFrom(record, participant, index, equipment, skills, items, warnings) {
  const p = participant ?? {};
  const name = text(p.protagonistName || p.name) || sourceName(record, p.id) || `单位 ${index + 1}`;
  const id = p.id;
  const stats = statsOf(record), level = Math.max(1, integer(findValue(record, ['level','等级'], 1), 1));
  const tier = Math.max(1, Math.min(7, tierNumber(findValue(record, ['tier','levelTier','层级','生命层级'], level), level)));
  const bodyLengthM = Math.max(.01, Math.min(1e9, number(findValue(record, ['bodyLengthM','bodyLength','bl','体长'], 1.7), 1.7)));
  const size = Math.max(1, Math.min(5, sizeFor(bodyLengthM).value === 2 ? 1 : sizeFor(bodyLengthM).value === 1 ? 2 : sizeFor(bodyLengthM).value === 0 ? 3 : sizeFor(bodyLengthM).value === -1 ? 4 : 5));
  const mc = Math.max(1, Math.min(64, integer(findValue(record, ['mc','MC','massClass'], bodyLengthM >= 10 ? 2 : 1), 1)));
  const resources = { hp: safeResource(resource(record, 'hp', Math.max(1, stats.con * 100)), 'hp', warnings), mp: safeResource(resource(record, 'mp', Math.max(0, (stats.int + stats.spi) * 10)), 'mp', warnings), sp: safeResource(resource(record, 'sp', Math.max(0, (stats.str + stats.agi) * 10)), 'sp', warnings) };
  const slotItems = sourceEquipment(record).map(([slot, value, i]) => normalizeEquipment(value, slot, id, i, warnings));
  for (const item of slotItems) {
    equipment[item.templateId] ??= item.template;
    items[item.id] = { id: item.id, templateId: item.templateId, counters: item.counters };
  }
  const main = slotItems.find(i => i.template.kind === 'weapon' && ['mainHand', 'twoHands'].includes(i.slot))
    ?? slotItems.find(i => i.template.kind === 'weapon' && i.slot !== 'offHand');
  const off = !main?.template.twoHanded && slotItems.find(i => i.slot === 'offHand' && ['weapon', 'consumable'].includes(i.template.kind));
  const shield = !main?.template.twoHanded && slotItems.find(i => i.template.kind === 'shield');
  const gear = slotItems.filter(i => ![main, off, shield].includes(i));
  const mainId = main?.id ?? null, offId = off?.id ?? null, shieldId = shield?.id ?? null;
  const normalizedSkills = sourceSkills(record).slice(0, 32).map(([raw, i]) => {
    const r = asObject(raw), sid = `skill-${id.slice(0, 31)}-${hash(id).toString(36)}-${i}`;
    skills[sid] = {
      name: text(r.name ?? r.名称).slice(0, 100) || `技能${i + 1}`,
      quality: '普通', ap: bound(r.ap, 1, 2), slot: r.slot === 'action' ? 'action' : 'attack',
      range: bound(r.range, 0, 15, 1), shape: ['single', 'circle', 'fan', 'cone', 'line'].includes(r.shape) ? r.shape : 'single',
      target: ['enemy', 'ally', 'self', 'any'].includes(r.target) ? r.target : 'enemy',
      effects: mapEffects(r.effects ?? r.效果, 'skill', warnings),
    };
    for (const [key, min, max] of [['mp', 0, 25000], ['sp', 0, 25000], ['radius', 0, 6], ['width', 0, 6], ['accuracy', -20, 30], ['power', 0, 1e9]]) {
      if (r[key] != null) skills[sid][key] = bound(r[key], min, max);
    }
    if (attrNames.includes(r.save) && r.saveDC != null) Object.assign(skills[sid], { save: r.save, saveDC: bound(r.saveDC, 1, 50) });
    for (const key of ['damage', 'heal']) if (object(r[key])) skills[sid][key] = normalizeDice(r[key]);
    return sid;
  });
  const pos = xyzOf(p.xyz ?? p);
  const sourceStatuses = record.statuses ?? record.状态效果 ?? record.状态 ?? record.effects;
  const statuses = {};
  const statusEntries = Array.isArray(sourceStatuses)
    ? sourceStatuses.map(s => [typeof s === 'string' ? s : s?.id ?? s?.statusId ?? s?.name ?? s?.名称, s])
    : Object.entries(asObject(sourceStatuses));
  for (const [rawId, rawStatus] of statusEntries) {
    const sid = statusId(rawId) || statusId(rawStatus?.id ?? rawStatus?.name ?? rawStatus?.名称);
    if (!sid) {
      const description = text(rawStatus?.效果 ?? rawStatus?.description);
      warnings.push(`忽略未知状态：${rawId ?? 'unknown'}${description ? `：${description}` : ''}`);
      continue;
    }
    const template = STATUSES[sid];
    const remainingTurns = statusTurns(rawStatus?.remainingTurns ?? rawStatus?.剩余回合 ?? rawStatus?.剩余时间, template.remainingTurns);
    const stacks = bound(rawStatus?.stacks ?? rawStatus?.层数, 1, template.maxStacks);
    statuses[sid] = { ...template, remainingTurns, stacks, sourceUnitId: null, modifiers: { ...template.modifiers },
      ...(sid === 'shield' ? { amount: bound(rawStatus?.amount ?? rawStatus?.护盾值, 1, 1e9, template.modifiers.amount) } : {}),
    };
  }
  const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
  const team = teamOf(p.faction ?? p.team, 'red');
  const rawFacing = Array.isArray(p.facing) ? p.facing : [team === 'blue' ? 1 : -1, 0];
  const facing = rawFacing.slice(0, 2).map(n => Math.sign(integer(n)));
  if (facing.length !== 2 || !facing.some(Boolean)) facing.splice(0, 2, team === 'blue' ? 1 : -1, 0);
  const unit = { id, name, team, x: pos.x, y: pos.y, facing, hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats, armor: Math.max(0, Math.min(1000000, integer(findValue(record, ['armor','defense','护甲'], 0), 0))), size, move: Math.max(1, Math.min(10, integer(findValue(record, ['move','movement','移动'], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.slice(0, 12).map(item => item.id), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: 'offensive', parryQuota: stance === 'greatsword' ? 2 : 0, parryRefunded: false, attunementCharges: stance === 'attunement' ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: 'normal', nonLethal: p.nonLethal === true, moraleType: text(p.moraleType) || 'standard' };
  return { unit, profile: { id, level, tier, stats, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, equipment: clone(slotItems), sourcePath: record.__sourcePath ?? null, sourceKind: record.__sourceKind || 'unknown', fieldSources: { numeric: record.__sourceKind || 'unknown', equipment: record.__sourceKind || 'unknown', placement: 'battle_init', faction: 'battle_init', name: p.protagonistName ? 'persona' : (p.name ? 'battle_init' : (record.__sourceKind || 'unknown')) } }, participant: p };
}

function terrainState(battle, state, warnings) {
  state.grid = createBattleGrid(battle, state.rng, Object.values(state.units), warnings);
  for (const [i, raw] of (Array.isArray(battle.covers) ? battle.covers : []).entries()) {
    if (!object(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw), id = deterministicId(raw.id ?? `cover-${i}`, 'cover');
    if (state.grid[p.y][p.x].kind === 'wall') {
      warnings.push(`忽略位于墙体内的掩体：${id}`);
      continue;
    }
    state.covers[id] = { id, name: text(raw.name) || `掩体${i + 1}`, x: p.x, y: p.y, material: text(raw.material) || '未知材料', hp: Math.max(0, Math.min(1000000000, integer(raw.hp ?? raw.maxHp, 10))), maxHp: Math.max(1, Math.min(1000000000, integer(raw.maxHp ?? raw.hp, 10))), cover: Math.max(0, Math.min(12, integer(raw.cover ?? raw.shielding, 2))) };
    state.covers[id].hp = Math.min(state.covers[id].hp, state.covers[id].maxHp);
  }
  const interactives = battle.interacts ?? battle.interactives;
  for (const [i, raw] of (Array.isArray(interactives) ? interactives : []).entries()) {
    if (!object(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw), id = deterministicId(raw.id ?? `interactive-${i}`, 'interactive');
    if (state.grid[p.y][p.x].kind === 'wall') {
      warnings.push(`忽略位于墙体内的互动点：${id}`);
      continue;
    }
    const kind = text(raw.kind ?? raw.type).toLowerCase() === 'altar' || /祭坛|altar/.test(text(raw.name)) ? 'altar' : 'barrel';
    state.interactives[id] = { id, name: text(raw.name) || (kind === 'altar' ? '星辉祭坛' : '余烬爆桶'), x: p.x, y: p.y, kind, spent: Boolean(raw.spent) };
  }
  return state;
}

function uniquePositions(units, state) {
  const used = new Set();
  for (const unit of Object.values(units)) {
    let x = unit.x, y = unit.y;
    for (let n = 0; n < 100 && (used.has(`${x},${y}`) || state.grid[y][x].kind === 'wall' || Object.values(state.covers).some(c => c.x === x && c.y === y && c.hp > 0)); n++) { x = (x + 1) % 10; if (x === 0) y = (y + 1) % 10; }
    unit.x = x; unit.y = y; used.add(`${x},${y}`);
  }
}

/** Convert MVU stat_data, one or more char_info blocks, and battle_init into a
 * validated tactical state. The returned roster retains level/source metadata
 * which the engine unit schema intentionally does not store. */
export function hydrateFromSources(input = {}, options = {}) {
  const source = asObject(input), warnings = [];
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
  const equipment = clone(EQUIPMENT), skills = clone(SKILLS), items = {};
  const units = {}, profiles = {}, sourceMap = {};
  const add = (participant, record, index) => {
    const base = descriptor ? participant.id : deterministicId(participant.id || participant.uid || participant.source || `${participant.name}-${index}`, 'unit');
    let id = base;
    for (let suffix = 2; own(units, id); suffix++) id = `${base.slice(0, 52)}-${suffix}`;
    const persona = !descriptor && record === protagonist && protagonistName ? { protagonistName } : {};
    const made = unitFrom(mergeBattleParticipant(record, participant, battle), { ...participant, ...persona, id }, index, equipment, skills, items, warnings);
    units[id] = made.unit;
    profiles[id] = made.profile;
    sourceMap[id] = { path: record?.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record) };
  };
  for (const [i, participant] of participants.entries()) {
    const record = resolved[i];
    if (!record && participant.source) warnings.push(`未找到参战来源：${participant.source}（${participant.name ?? participant.id}）`);
    add(participant, record ?? { __sourceKind: 'battle_init' }, i);
  }
  // Older battles without an explicit roster retain the discovered characters.
  if (!participants.length) {
    const records = [...mvuRecords, ...chars.filter(char => !mvuRecords.some(record => sourceName(record, record.__sourceKey) === sourceName(char)))];
    for (const [i, record] of records.entries()) {
      add({ name: sourceName(record, record.__sourceKey), source: sourceId(record), faction: i ? 'red' : 'blue', x: i, y: 0 }, record, i);
    }
  }
  const title = text(battle.sceneTitle ?? battle.title ?? options.title).slice(0, 100) || '酒馆战术战局';
  const seed = integer(options.seed ?? battle.seed, hash(battle.battleId ?? title)) >>> 0;
  const mode = options.mode ?? battle.mode;
  const state = { scenarioId: descriptor ? battle.battleId : deterministicId(battle.battleId ?? title, 'battle'), title, mode: ['free','split'].includes(mode) ? mode : 'free', ruleset: ['protocol','sandbox'].includes(options.ruleset) ? options.ruleset : 'protocol', round: 1, turn: 0, order: Object.keys(units), units, items, equipment, skills, grid: [], covers: {}, interactives: {}, zones: {}, rng: seed, logs: [], outcome: null };
  terrainState(battle, state, warnings);
  uniquePositions(state.units, state);
  let valid = true;
  try { validateState(state); } catch (error) {
    valid = false;
    warnings.push(`转换结果未通过校验：${error.message}`);
    if (options.throwOnValidation) throw error;
  }
  if (valid) beginBattle(state);
  const roster = Object.values(units).map(unit => ({ ...profiles[unit.id], ...clone(unit), source: profiles[unit.id].sourceKind }));
  return { state, roster, warnings, sourceMap, battleInit: battle, seed };
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
