import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { validateState } from '../api/validation.js';
import { sizeFor, stanceFor } from '../core/combat_protocol.js';
import { STATUSES } from '../core/combat.js';

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
    if (match) return parseStructured(match[1]);
    // Legacy prompt routes used brace-delimited blocks rather than XML.
    const legacy = value.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*([\s\S]*?)\s*\{\s*\/\s*(?:battle_in|战术沙盘)\s*\}/i);
    if (legacy) return parseStructured(legacy[1]);
    const brace = value.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\s\S]+?)\s*\}/i);
    return brace ? parseStructured(brace[1]) : parseStructured(value);
  }
  return [...value.matchAll(re)].map(m => parseSimpleYaml(m[1]));
}
function parseStructured(value) {
  if (object(value)) return value;
  if (typeof value !== 'string') return {};
  try { const parsed = JSON.parse(value); return object(parsed) ? parsed : {}; } catch { return parseSimpleYaml(value); }
}
export function parseBattleInit(value) { return asObject(unwrap(value, 'battle')); }
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

export function collectMvu(value) {
  const root = asObject(value?.stat_data ?? value?.statData ?? value);
  const found = [];
  const visit = (node, key = '', path = []) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, String(i), [...path, i]));
    if (!object(node)) return;
    const name = sourceName(node, key), hasStats = node.stats || node.attributes || node.属性 || ['力量','敏捷','体质','智力','精神'].some(k => own(node, k));
    const hasResource = ['hp', 'maxHp', 'mp', 'sp', 'tier', 'level', 'equipment', 'skills', '生命值', '法力值', '体力值', '装备', '技能', '资源'].some(k => own(node, k));
    if (name && (hasStats || hasResource)) found.push({ ...clone(node), __sourceKey: key, __sourcePath: path });
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
const statusAliases = { burning: 'burn', fire: 'burn', poison: 'poison', bleeding: 'bleed', frozen: 'freeze', stun: 'stun', immobilize: 'root', shield: 'shield', regen: 'regen', haste: 'haste', blind: 'blind', mark: 'mark' };
function statusId(value) { const key = text(value).toLowerCase(); return STATUSES[key] ? key : statusAliases[key] ?? null; }

/** Map only effects understood by validation/engine. Unknown effects are
 * intentionally dropped (level 3 safety downgrade), never executed. */
export function mapEffect(raw, context = 'skill', warnings = []) {
  if (!object(raw) && typeof raw !== 'string') return null;
  const input = typeof raw === 'string' ? { kind: raw } : raw;
  let kind = text(input.kind ?? input.type ?? input.effect ?? input.name).toLowerCase().replace(/[ -]/g, '_');
  kind = effectAliases[kind] ?? kind;
  const allowed = context === 'equipment' ? equipmentEffects : skillEffects;
  if (allowed.has(kind)) {
    if (kind === 'status') {
      const id = statusId(input.statusId ?? input.status ?? input.value);
      return id ? { kind, statusId: id, ...(Number.isInteger(input.turns) ? { turns: Math.max(1, Math.min(100, input.turns)) } : {}), ...(Number.isInteger(input.stacks) ? { stacks: Math.max(1, Math.min(10, input.stacks)) } : {}) } : null;
    }
    // Construct a narrow, validator-compatible shape rather than copying
    // arbitrary source keys into an engine template.
    if (kind === 'cleanse' || kind === 'opportunity_root') return { kind };
    if (kind === 'knockback') return { kind, distance: Math.max(1, Math.min(5, integer(input.distance ?? input.amount, 1))), collisionDamage: Math.max(0, Math.min(80, integer(input.collisionDamage, 0))) };
    if (kind === 'teleport_backstab') return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, .5))) };
    if (kind === 'kill_charge_weapon') return { kind, counterKey: deterministicId(input.counterKey ?? 'souls', 'counter'), bonusPerStack: Math.max(0, Math.min(2, number(input.bonusPerStack, .5))), maxStacks: Math.max(1, Math.min(50, integer(input.maxStacks, 10))) };
    if (kind === 'ammo') return { kind, counterKey: deterministicId(input.counterKey ?? 'ammo', 'counter'), capacity: Math.max(1, Math.min(50, integer(input.capacity, 6))), armorPierce: Math.max(0, Math.min(50, integer(input.armorPierce, 0))), highGroundRange: Math.max(0, Math.min(6, integer(input.highGroundRange, 0))), highGroundAccuracy: Math.max(0, Math.min(12, integer(input.highGroundAccuracy, 0))) };
    if (kind === 'frost_thorns') { const id = statusId(input.statusId ?? 'chill'); return id ? { kind, damage: Math.max(0, Math.min(50, integer(input.damage, 3))), chance: Math.max(0, Math.min(1, number(input.chance, .4))), statusId: id } : null; }
    if (kind === 'backstab') return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, .4))), bleedStacks: Math.max(1, Math.min(5, integer(input.bleedStacks, 1))), comboDamage: Math.max(0, Math.min(50, integer(input.comboDamage, 0))) };
    if (kind === 'healing_shield') return { kind, healBonus: Math.max(0, Math.min(4, number(input.healBonus, .25))), shieldRatio: Math.max(0, Math.min(4, number(input.shieldRatio, .5))) };
  }
  const id = statusId(input.statusId ?? input.status ?? (statusAliases[kind] ? kind : null));
  if (context === 'skill' && id) { warnings.push(`效果 ${kind} 按状态别名降级为 ${id}`); return { kind: 'status', statusId: id }; }
  warnings.push(`不支持的效果已忽略：${kind || 'unknown'}`);
  return null;
}
export function mapEffects(effects, context = 'skill', warnings = []) {
  const input = Array.isArray(effects) ? effects : effects == null ? [] : [effects];
  const result = [], seen = new Set();
  for (const raw of input) { const effect = mapEffect(raw, context, warnings); if (effect && (!seen.has(effect.kind) || effect.kind === 'status')) { result.push(effect); seen.add(effect.kind); } }
  return result;
}

function normalizeEquipment(raw, slot, owner, index, warnings) {
  const r = asObject(raw), name = text(r.name ?? r.名称 ?? r.itemName) || `${slot || '装备'}${index + 1}`;
  const isShield = slot === 'shield' || r.shield === true || /盾/.test(name);
  const labels = Array.isArray(r.tags ?? r.标签) ? (r.tags ?? r.标签).join(' ') : text(r.tags ?? r.标签);
  const isWeapon = !isShield && (slot === 'mainHand' || slot === 'offHand' || r.damage || r.attack != null || r.weaponClass || r.kind === 'weapon' || r.类型 === '武器' || /攻击|双手|巨剑|长戟|弓|弩|法杖/.test(`${name} ${labels}`));
  const kind = isShield ? 'shield' : isWeapon ? 'weapon' : (['armor', 'accessory', 'consumable'].includes(r.kind) ? r.kind : r.类型 === '防具' ? 'armor' : r.类型 === '饰品' ? 'accessory' : 'accessory');
  const idBase = deterministicId(`${owner}-${slot || 'gear'}-${name}-${index}`, 'item');
  const templateId = deterministicId(`template-${name}-${kind}-${index}`, 'equipment');
  const effects = mapEffects(r.effects ?? r.effectsList ?? r.效果, 'equipment', warnings);
  const template = { name, kind, effects };
  if (kind === 'shield') Object.assign(template, { weaponClass: 'shield', hand: 'off_hand', shield: true, defense: Math.max(0, integer(r.defense ?? r.防御, 1)) });
  else if (isWeapon) {
    const ranged = r.ranged === true || r.rangeType === 'ranged' || r.weaponClass === 'ranged' || /弓|弩|枪|法杖|远程/.test(name);
    const twoHanded = r.twoHanded === true || r.hand === 'two_handed' || r.weaponClass === 'greatsword' || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${slot} ${labels}`);
    const attackTag = labels.match(/攻击\s*:\s*([\d.e+-]+)/i), rangeTag = labels.match(/(?:有效距离|射程)[^\d]*(\d+)/i);
    Object.assign(template, { weaponClass: text(r.weaponClass) || (twoHanded ? 'greatsword' : ranged ? 'ranged' : 'light_blade'), hand: twoHanded ? 'two_handed' : slot === 'offHand' ? 'off_hand' : 'one_handed', ranged, rangeType: ranged ? 'ranged' : 'melee', range: Math.max(1, Math.min(15, integer(r.range ?? r.有效距离 ?? rangeTag?.[1], ranged ? 4 : 1))), attack: Math.max(0, Math.min(1000000000, integer(r.attack ?? r.攻击 ?? attackTag?.[1], 0))), accuracy: Math.max(-20, Math.min(30, integer(r.accuracy ?? r.命中, 0))), damage: r.damage && object(r.damage) ? { count: Math.max(0, Math.min(1000000, integer(r.damage.count, 1))), sides: Math.max(1, Math.min(1000000, integer(r.damage.sides, 6))), ...(r.damage.stat ? { stat: r.damage.stat } : {}), type: ['physical','energy','mental','true'].includes(r.damage.type) ? r.damage.type : 'physical', bonus: integer(r.damage.bonus, 0) } : { count: 1, sides: 4, stat: 'str', type: 'physical', bonus: 0 } });
    if (twoHanded) template.heavy = r.heavy !== false, template.twoHanded = true;
  } else Object.assign(template, { armor: Math.max(0, Math.min(1000000, integer(r.armor ?? r.防御, 0))), defense: Math.max(0, Math.min(1000000, integer(r.defense ?? r.防御, 0))) });
  const counters = Object.fromEntries(effects.flatMap(e => e.kind === 'ammo' ? [[e.counterKey || 'ammo', integer(e.capacity, 1)]] : e.kind === 'kill_charge_weapon' ? [[e.counterKey || 'souls', 0]] : []));
  return { id: idBase, templateId, template, counters, slot, name };
}

function sourceEquipment(record) {
  const value = record.equipment ?? record.equipments ?? record.items ?? record.装备 ?? [];
  if (Array.isArray(value)) return value.map((v, i) => [text(v?.slot ?? v?.position ?? v?.位置 ?? v?.位置), v, i]);
  return Object.entries(asObject(value)).map(([slot, v], i) => [slot, { ...asObject(v), name: v?.name ?? v?.名称 ?? slot }, i]);
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
  const value = battle.participants ?? battle.units ?? battle.roster ?? [];
  return Array.isArray(value) ? value : Object.entries(asObject(value)).map(([id, participant]) => ({ ...(asObject(participant)), id: participant?.id ?? id }));
}
function teamOf(value, fallback = 'red') { const t = text(value).toLowerCase(); return ['blue','player','ally','友方','我方'].includes(t) ? 'blue' : ['red','enemy','foe','敌方'].includes(t) ? 'red' : fallback; }
function xyzOf(value) { const p = asObject(value); const xyz = Array.isArray(value) ? value : Array.isArray(p.xyz) ? p.xyz : [p.x, p.y, p.z]; return { x: Math.max(0, Math.min(9, integer(xyz[0], 0))), y: Math.max(0, Math.min(9, integer(xyz[1], 0))), z: integer(xyz[2], 0) }; }

function unitFrom(record, participant, index, equipment, skills, items, warnings) {
  const name = sourceName(record, participant?.name ?? participant?.id ?? `unit-${index}`) || `单位 ${index + 1}`;
  const id = deterministicId(`${name}-${index}`, 'unit');
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
  const bySlot = slot => slotItems.find(i => ['mainHand','main','weapon','主手','双手'].includes(slot) && ['mainHand','main','weapon','主手','双手'].includes(i.slot) || slot === 'offHand' && ['offHand','off','副手'].includes(i.slot) || slot === 'shield' && ['shield','盾牌'].includes(i.slot));
  const main = bySlot('mainHand') ?? slotItems.find(i => i.template.kind === 'weapon') ?? null;
  const off = bySlot('offHand');
  const shield = bySlot('shield') ?? slotItems.find(i => i.template.kind === 'shield') ?? null;
  const gear = slotItems.filter(i => ![main, off, shield].includes(i));
  const put = item => { if (!item) return null; const id2 = item.id; skills.__items ??= {}; return id2; };
  const mainId = put(main), offId = put(off), shieldId = put(shield);
  for (const item of gear) put(item);
  const normalizedSkills = sourceSkills(record).map(([raw, i]) => {
    const r = asObject(raw), sid = deterministicId(`${id}-skill-${r.id ?? r.name ?? i}`, 'skill');
    skills[sid] ??= { name: text(r.name ?? r.名称) || `技能${i + 1}`, quality: '普通', ap: Math.max(1, Math.min(2, integer(r.ap, 1))), slot: 'attack', range: Math.max(0, Math.min(15, integer(r.range, 1))), shape: 'single', target: 'enemy', effects: mapEffects(r.effects, 'skill', warnings), ...(r.damage && object(r.damage) ? { damage: { count: 1, sides: 4, stat: 'str', type: 'physical', bonus: 0, ...r.damage } } : {}) };
    return sid;
  });
  const p = participant ?? {};
  const pos = xyzOf(p.xyz ?? p);
  const sourceStatuses = record.statuses ?? record.effects ?? record.状态 ?? {};
  const statuses = {};
  for (const [rawId, rawStatus] of Object.entries(Array.isArray(sourceStatuses) ? Object.fromEntries(sourceStatuses.map(x => [x.id ?? x.statusId, x])) : asObject(sourceStatuses))) {
    const sid = statusId(rawId) || statusId(rawStatus?.id ?? rawStatus?.name);
    if (!sid) { warnings.push(`忽略未知状态：${rawId}`); continue; }
    const template = STATUSES[sid], stacks = Math.max(1, Math.min(template.maxStacks, integer(rawStatus?.stacks ?? 1)));
    statuses[sid] = { ...template, remainingTurns: Math.max(1, Math.min(100, integer(rawStatus?.remainingTurns, template.remainingTurns))), stacks, maxStacks: template.maxStacks, sourceUnitId: null, modifiers: { ...template.modifiers }, appliedRound: 1, appliedTurn: 0, ...(sid === 'shield' ? { amount: Math.max(1, integer(rawStatus?.amount ?? template.modifiers.amount, 1)) } : {}) };
  }
  const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
  const unit = { id, name, team: teamOf(p.faction ?? p.team, 'red'), x: pos.x, y: pos.y, facing: [teamOf(p.faction ?? p.team, 'red') === 'blue' ? 1 : -1, 0], hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats, armor: Math.max(0, Math.min(1000000, integer(findValue(record, ['armor','defense','护甲'], 0), 0))), size, move: Math.max(1, Math.min(10, integer(findValue(record, ['move','movement','移动'], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.map(put), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: 'offensive', parryQuota: stance === 'greatsword' ? 2 : 0, parryRefunded: false, attunementCharges: stance === 'attunement' ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: 'normal', nonLethal: false, moraleType: 'standard' };
  return { unit, profile: { id, level, tier, stats, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, sourcePath: record.__sourcePath ?? null }, participant: p };
}

function terrainState(battle, state, warnings) {
  const terrain = battle.terrain ?? battle.grid;
  if (Array.isArray(terrain)) for (const cell of terrain) {
    const p = xyzOf(cell.xyz ?? cell); if (p.x > 9 || p.y > 9) continue;
    const kind = text(cell.kind ?? cell.type).toLowerCase(); state.grid[p.y][p.x] = { kind: ['floor','slope','wall'].includes(kind) ? kind : kind === 'highground' ? 'slope' : 'floor', z: Math.max(-4, Math.min(8, p.z)) };
  }
  for (const [i, raw] of (battle.covers ?? []).entries()) {
    const p = xyzOf(raw.xyz ?? raw), id = deterministicId(raw.id ?? `cover-${i}`, 'cover');
    if (state.grid[p.y][p.x].kind === 'wall') state.grid[p.y][p.x].kind = 'floor';
    state.covers[id] = { id, name: text(raw.name) || `掩体${i + 1}`, x: p.x, y: p.y, material: text(raw.material) || '未知材料', hp: Math.max(0, Math.min(1000000000, integer(raw.hp ?? raw.maxHp, 10))), maxHp: Math.max(1, Math.min(1000000000, integer(raw.maxHp ?? raw.hp, 10))), cover: Math.max(0, Math.min(12, integer(raw.cover ?? raw.shielding, 2))) };
    state.covers[id].hp = Math.min(state.covers[id].hp, state.covers[id].maxHp);
  }
  for (const [i, raw] of (battle.interacts ?? battle.interactives ?? []).entries()) {
    const p = xyzOf(raw.xyz ?? raw), id = deterministicId(raw.id ?? `interactive-${i}`, 'interactive');
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
  const mvu = source.mvu ?? source.statData ?? source.stat_data ?? {};
  const battle = parseBattleInit(source.battleInit ?? source.battle_init ?? source.battle ?? {});
  const chars = parseCharInfo(source.charInfo ?? source.char_info ?? '');
  const records = [...collectMvu(mvu), ...chars];
  const merged = mergeRecords(records);
  const participants = participantList(battle);
  const equipment = clone(EQUIPMENT), skills = clone(SKILLS), items = {};
  const units = {}, roster = [], sourceMap = {};
  for (const [i, participant] of participants.entries()) {
    const ref = text(participant?.source ?? participant?.id ?? participant?.uid ?? participant?.name);
    const record = [...merged.values()].find(r => sourceName(r) === text(participant?.name))
      ?? [...merged.values()].find(r => sourceId(r) && sourceId(r) === ref)
      ?? [...merged.values()][i] ?? { name: participant?.name ?? `单位${i + 1}` };
    const made = unitFrom(record, participant, i, equipment, skills, items, warnings);
    // Two records with the same display name still get deterministic distinct IDs.
    if (units[made.unit.id]) { made.unit.id = deterministicId(`${made.unit.id}-${i}`, 'unit'); made.profile.id = made.unit.id; }
    units[made.unit.id] = made.unit;
    roster.push({ ...made.profile, ...clone(made.unit), name: made.unit.name, team: made.unit.team, source: record.__sourcePath ? 'MVU' : 'char_info' });
    sourceMap[made.unit.id] = { path: record.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record) };
  }
  // A battle_init is allowed to omit participants; retaining discovered MVU
  // characters makes the converter useful with older prompt formats.
  if (!participants.length) for (const [i, record] of merged.values().entries()) {
    const made = unitFrom(record, { name: sourceName(record), source: sourceId(record), faction: i ? 'red' : 'blue', x: i, y: 0 }, i, equipment, skills, items, warnings);
    units[made.unit.id] = made.unit; roster.push({ ...made.profile, ...clone(made.unit), name: made.unit.name, team: made.unit.team, source: 'MVU' }); sourceMap[made.unit.id] = { path: record.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record) };
  }
  delete skills.__items;
  const title = text(battle.sceneTitle ?? battle.title) || options.title || '酒馆战术战局';
  const state = { scenarioId: deterministicId(battle.battleId ?? title, 'battle'), title, mode: ['free','split'].includes(options.mode) ? options.mode : 'free', ruleset: ['protocol','sandbox'].includes(options.ruleset) ? options.ruleset : 'protocol', round: 1, turn: 0, order: Object.keys(units), units, items, equipment, skills, grid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: 'floor', z: 0 }))), covers: {}, interactives: {}, zones: {}, rng: (integer(battle.seed ?? options.seed, hash(title)) >>> 0), logs: [], outcome: null };
  terrainState(battle, state, warnings); uniquePositions(state.units, state);
  // Items are generated after templates are known. unitFrom intentionally stores
  // only IDs; reconstructing their counters here keeps state.items authoritative.
  for (const unit of Object.values(state.units)) for (const itemId of [unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean)) {
    const templateId = itemId.includes('-') ? Object.keys(state.equipment).find(t => itemId.includes(deterministicId(state.equipment[t].name, 'x'))) : null;
    // IDs are opaque, so resolve by the unit's source slot/template in a small
    // deterministic fallback: each generated ID is inserted by matching suffix.
    const template = Object.entries(state.equipment).find(([tid, t]) => itemId.includes(tid) || t.name && itemId.includes(deterministicId(t.name, 'item')))?.[0] ?? Object.keys(state.equipment).find(t => state.equipment[t].name === itemId);
    if (template && !state.items[itemId]) state.items[itemId] = { id: itemId, templateId: template, counters: Object.fromEntries((state.equipment[template].effects ?? []).flatMap(e => e.kind === 'ammo' ? [[e.counterKey || 'ammo', integer(e.capacity, 1)]] : e.kind === 'kill_charge_weapon' ? [[e.counterKey || 'souls', 0]] : [])) };
  }
  // The generated item IDs carry no template token in the public schema. The
  // following deterministic matching handles all normal generated records.
  for (const unit of Object.values(state.units)) for (const itemId of [unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean)) if (!state.items[itemId]) {
    const candidates = Object.keys(state.equipment).filter(t => !Object.values(state.items).some(i => i.templateId === t && false));
    const t = candidates.find(t => (unit.mainHand === itemId && state.equipment[t].kind === 'weapon') || (unit.shield === itemId && state.equipment[t].kind === 'shield')) ?? candidates[0];
    if (t) state.items[itemId] = { id: itemId, templateId: t, counters: {} };
  }
  try { validateState(state); } catch (error) {
    warnings.push(`转换结果未通过校验：${error.message}`);
    if (options.throwOnValidation) throw error;
  }
  return { state, roster, warnings, sourceMap, battleInit: battle };
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
