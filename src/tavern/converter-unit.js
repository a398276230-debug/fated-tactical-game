import { id as validId, validateState } from '../api/validation.js';
import { DISTANCE_TABLE, sizeClassFor, stanceFor, stanceRules, moraleTypeFor, TIER_CELL_M, QUALITY_TIER, resolveEffectiveTier, scaledCells, tierFromCellM, defaultMoveFromAgi, boardMoveCellsFromMoveM } from '../core/combat_protocol.js';
import { validVmRule, validVmStatMod } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';
import { initializeVMWorld } from '../core/vm-runtime.js';
import { getPool, updatePoolCurrent, updatePoolMax } from '../core/vm-pools.js';
import { beginBattle, STATUSES } from '../core/combat.js';
import { fitSpawnStats, spawnBudgetIssue } from '../core/spawn-unit.js';
import { sizeMultiplier } from '../core/prebattle_resources.js';
import { canOccupy, elevation, zoneContains } from '../core/spatial.js';
import { mediaCells, mediumZone, putMedium } from '../core/element-media.js';
import { parseBattleDescriptor } from './descriptor.js';
import { createBattleGrid } from './terrain.js';
import { parseBattleTime } from '../core/battle_time.js';
import { parseAreaTags, tagEntries } from './area-tags.js';
import { asObject, attrNames, bound, charSources, clone, collectMvu, defaultCoverHp, describe, deterministicId, dynamicTag, emptyEntry, extractUnitPoolEntries, findValue, hash, integer, narrativeEntries, number, object, own, parseBattleInit, parseCharInfo, protagonistAliases, qualityOf, rawTagValues, resolveParticipant, resolveSummonSource, resource, resourceValue, RESOURCE_ALIASES, RESOURCE_MAX_ALIASES, safeResource, samePath, sourceId, sourceName, staticProjection, statAliases, statsOf, statusId, statusTurns, text, tierNumber, unitPoolKeyFromLabel, warningSink, WARNING_SCOPES } from './converter-parse.js';
import { activeRule, ammoCounter, appendRules, areaFields, attachAmmoPool, convertNarrative, damageTags, elementTags, finalizeEquipment, geometryFields, instructions, isAreaDamage, mapEffects, normalizeDice, normalizeEquipment, readCombatTags, readMods, readPools, readRules, resolveDamageType, skillCosts } from './converter-effects.js';

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
function dynamicPoolKey(item, label) {
  const pools = Object.keys(item.template?.pools ?? {});
  if (!pools.length) return null;
  const normalized = text(label);
  const semantic = normalized.match(/弹药|箭矢|残弹|装填/u) ? 'ammo'
    : normalized.match(/灵魂|魂数/u) ? 'souls'
      : normalized.match(/充能|能量/u) ? 'charge'
        : normalized.match(/层数|堆叠/u) ? 'stacks'
          : normalized.match(/次数|计数/u) ? 'count' : null;
  if (semantic && pools.includes(semantic)) return semantic;
  if (pools.includes(normalized)) return normalized;
  return pools.length === 1 ? pools[0] : null;
}

function sourceEquipment(value, path) {
  const slots = new Map(Object.entries({ mainHand: 'mainHand', main: 'mainHand', weapon: 'mainHand', 主手: 'mainHand', 双手: 'twoHands', 双手武器: 'twoHands', offHand: 'offHand', off: 'offHand', 副手: 'offHand', shield: 'shield', 盾牌: 'shield' }));
  const entries = Array.isArray(value) ? value.map((v, i) => ['', v, i]) : Object.entries(asObject(value)).map(([key, item]) => [key, item, key]);
  return entries.filter(([, item]) => object(item)).map(([key, item, sourceKey], i) => {
    // A later narrative placement overrides the starting hand declared in equipment tags.
    const position = [item.slot, item.position, item.位置].map(text).find(Boolean);
    const tags = [].concat(item.tags ?? item.标签 ?? []).map(text).join(',');
    const hand = tags.match(/(?:^|[\s,，、;；\[\]【】])(?:位置\s*[:：]\s*)?(主手|副手|双手(?:武器)?|盾牌)(?=$|[\s,，、;；\[\]【】])/u)?.[1];
    const rawSlot = position || (slots.has(key) ? key : hand || key);
    const name = item.name ?? item.名称 ?? (slots.has(key) ? '' : key);
    return [slots.get(rawSlot) ?? rawSlot, { ...item, name }, item.id ?? item.ID ?? (name || `unnamed-${i}`), path ? [...path, sourceKey] : null];
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
  const type = resolveDamageType(value.damage?.type);
  if (type) value.damage.type = type;
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
  };
  for (const [field, aliases] of Object.entries(fields)) {
    if (inline[field] != null && !aliases.some(alias => own(merged, alias))) merged[field] = clone(inline[field]);
  }
  const resourceSource = (recordValue, key) => {
    const aliases = RESOURCE_ALIASES[key] ?? [];
    const direct = aliases.find(name => own(recordValue, name));
    if (direct) return { container: null, key: direct, value: recordValue[direct] };
    const container = ['resources', 'resource', '资源'].find(name => object(recordValue?.[name]) && aliases.some(alias => own(recordValue[name], alias)));
    if (!container) return null;
    const nestedKey = aliases.find(name => own(recordValue[container], name));
    return { container, key: nestedKey, value: recordValue[container][nestedKey] };
  };
  for (const key of ['hp', 'mp', 'sp']) {
    const source = resourceSource(inline, key);
    if (!source || resourceValue(merged, key).value !== undefined) continue;
    if (source.container) merged[source.container] = { ...asObject(merged[source.container]), [source.key]: clone(source.value) };
    else merged[source.key] = clone(source.value);
  }
  const resourceMaxAliases = {
    hp: ['maxHp', 'hpMax', '生命值上限'], mp: ['maxMp', 'mpMax', '法力值上限'], sp: ['maxSp', 'spMax', '体力值上限'],
  };
  const hasResourceMax = (recordValue, key) => {
    const source = asObject(recordValue), nested = asObject(source.resources ?? source.resource ?? source.资源);
    return resourceMaxAliases[key].some(alias => own(source, alias) || own(nested, alias));
  };
  for (const [field, key] of [['maxHp', 'hp'], ['maxMp', 'mp'], ['maxSp', 'sp']]) {
    if (inline[field] != null && !hasResourceMax(merged, key)) merged[field] = clone(inline[field]);
  }
  return merged;
}
function sourceResourcePath(record, key) {
  const aliases = RESOURCE_ALIASES[key] ?? [];
  const direct = aliases.find(name => own(record, name));
  const containerKey = ['resources', 'resource', '资源'].find(name => object(record?.[name]) && aliases.some(alias => own(record[name], alias)));
  const owner = direct ? record[direct] : containerKey ? record[containerKey] : undefined;
  const ownerPath = direct ? [direct] : containerKey ? [containerKey, aliases.find(name => own(record[containerKey], name))] : null;
  if (!ownerPath) return null;
  if (!object(owner)) return ownerPath;
  const current = ['current', '当前', 'now', 'value'].find(name => own(owner, name));
  return current ? [...ownerPath, current] : ownerPath;
}
function sourceSkills(record) {
  const value = record.skills ?? record.abilities ?? record.技能 ?? [];
  const list = Array.isArray(value) ? [...value] : Object.entries(asObject(value)).map(([name, v]) => ({ ...asObject(v), name: v?.name ?? v?.名称 ?? name }));
  // Carried relics are persistent carriers, not expendable inventory actions.
  for (const [name, item] of Object.entries(asObject(record.背包))) {
    if (item?.类型 !== '道具' || bound(item.数量 ?? item.count, 0, 1e9, 1) === 0) continue;
    const declared = item.rules ?? item.规则;
    const rules = Array.isArray(declared) ? declared.filter(rule => validVmRule(rule)) : [];
    const narrative = Array.isArray(declared) ? declared.filter(rule => !validVmRule(rule)) : declared;
    const effects = [item.effects ?? item.效果, item.被动, narrative].filter(v => narrativeEntries(v).length);
    if (effects.length || rules.length) list.push({ ...item, id: `bag:${name}`, name, passive: !rules.some(rule => rule.hook === 'active'), effects, rules });
  }
  const ladder = record.登神长阶;
  if (ladder && ladder.是否开启 !== false) for (const group of ['要素', '权能', '法则']) {
    for (const [name, entry] of Object.entries(asObject(ladder[group]))) {
      const effects = object(entry) ? Object.fromEntries(Object.entries(entry).filter(([key]) => !['描述','名称','品质'].includes(key))) : entry;
      if (!narrativeEntries(effects).length) continue;
      list.push({ id: `ascension:${group}:${name}`, name, 描述: entry?.描述, effects, passive: !Object.keys(asObject(effects)).some(label => label.startsWith('主动')) });
    }
  }
  return list.map((v, i) => [v, i]);
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

function importBackpack(bag, owner, skills, sink, entrySources, inventoryPaths, sourcePath) {
  const inventory = {};
  for (const [name, item] of Object.entries(asObject(bag))) {
    if (item?.类型 !== '消耗品' && item?.kind !== 'consumable') continue;
    const count = bound(item.数量 ?? item.count, 0, 1e9, 1);
    if (!count) continue;
    const id = `bag-${hash(owner).toString(36)}-${hash(name).toString(36)}`;
    entrySources[`skills:${id}`] = staticProjection(item);
    if (Array.isArray(sourcePath)) inventoryPaths[id] = {
      skillId: id,
      countPath: [...sourcePath, '背包', name, Object.hasOwn(item, '数量') ? '数量' : 'count'],
      initialCount: count,
    };
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

function unitFrom(record, participant, index, equipment, skills, items, sink, isProtagonist, board, sourceRecord, customElements = {}) {
  const resourcesSink = sink('resource'), warnings = sink('status');
  const p = participant ?? {};
  const name = text(p.protagonistName || p.name) || sourceName(record, p.id) || `单位 ${index + 1}`;
  const id = p.id;
  const stats = statsOf(record), level = Math.max(1, integer(findValue(record, ['level','等级'], 1), 1));
  const levelTier = Math.min(7, Math.ceil(level / 4));
  const declaredTier = findValue(record, ['tier','levelTier','层级','生命层级'], null);
  const tier = Math.max(1, Math.min(7, tierNumber(declaredTier ?? levelTier, levelTier)));
  const bodyLengthM = readBodyLength(record, sink('state'));
  const size = sizeClassFor(bodyLengthM);
  const mc = Math.max(1, Math.min(64, integer(findValue(record, ['mc','MC','massClass'], bodyLengthM >= 10 ? 2 : 1), 1)));
  const resources = { hp: safeResource(resource(record, 'hp', Math.max(1, stats.con * 100), resourcesSink), 'hp', resourcesSink), mp: safeResource(resource(record, 'mp', Math.max(0, (stats.int + stats.spi) * 10), resourcesSink), 'mp', resourcesSink), sp: safeResource(resource(record, 'sp', Math.max(0, (stats.str + stats.agi) * 10), resourcesSink), 'sp', resourcesSink) };
  const sourcePath = Array.isArray(record.__sourcePath) ? record.__sourcePath : null;
  const equipmentKey = ['equipment', 'equipments', 'items', '装备'].find(key => record[key] != null);
  const equipmentPath = sourcePath && sourceRecord[equipmentKey] != null ? [...sourcePath, equipmentKey] : null;
  const sourceEntries = sourceEquipment(record[equipmentKey], equipmentPath);
  const bagEntries = sourceEquipment(record.背包, sourcePath ? [...sourcePath, '背包'] : null);
  const entrySources = {}, equipmentKeys = new Map();
  const dynamicOverlay = { units: {}, itemCounters: {}, unitCounters: {}, inventory: {} };
  const counterBindings = [];
  const unitPools = {};
  const usedUnitPoolKeys = new Set();
  for (const entry of extractUnitPoolEntries(record)) {
    const baseKey = unitPoolKeyFromLabel(entry.rawKey || entry.label);
    let poolKey = baseKey;
    for (let suffix = 2; Object.hasOwn(unitPools, poolKey); suffix++) poolKey = `${baseKey}_${suffix}`;
    usedUnitPoolKeys.add(poolKey);
    unitPools[poolKey] = { name: entry.label, cap: entry.cap, initial: Math.min(entry.cap, entry.current) };
    if (Array.isArray(sourcePath) && sourcePath.length && entry.subPath) {
      const binding = { ownerKind: 'unit', target: { kind: 'unit_pool', poolKey }, poolKey, label: entry.label,
        unitId: id, current: entry.current, max: entry.explicitMax ?? null, hasExplicitCap: entry.explicitMax != null,
        ...(entry.initialRawValue !== undefined ? { initialRawValue: entry.initialRawValue } : {}), format: entry.format,
        mvuPath: [...sourcePath, ...entry.subPath] };
      counterBindings.push(binding);
      dynamicOverlay.unitCounters[poolKey] = binding;
    }
  }
  const inventoryPaths = {};
  const addBinding = (item, path, { path: suffix, ...counter }, poolKey) => {
    const binding = { ...counter, ownerKind: 'item', poolKey, itemId: item.id, templateId: item.templateId, itemName: item.template.name,
      mvuPath: path ? [...path, ...suffix] : null, unitId: id };
    counterBindings.push(binding);
    dynamicOverlay.itemCounters[item.id] ??= [];
    dynamicOverlay.itemCounters[item.id].push(binding);
    return binding;
  };
  const weaponAmmoBindings = new Map();
  const equipmentEntry = ([slot, raw, identity, path]) => {
    const key = hash(String(identity)).toString(36);
    const occurrence = equipmentKeys.get(key) ?? 0;
    equipmentKeys.set(key, occurrence + 1);
    const item = normalizeEquipment(raw, slot, id, occurrence ? `${key}-${occurrence}` : key, sink, customElements);
    const { slot: _slot, position: _position, 位置: _placement, count: _count, 数量: _quantity, ...definition } = raw;
    entrySources[`equipment:${item.templateId}`] = staticProjection(definition);
    const ammo = ammoCounter(raw);
    const rangedWeapon = item.template.kind === 'weapon' && item.template.ranged;
    if (rangedWeapon && ammo) {
      weaponAmmoBindings.set(item.id, addBinding(item, path, { ...ammo, max: ammo.max ?? item.template.pools.ammo.cap }, 'ammo'));
    }
    const tagKey = raw.tags != null ? 'tags' : '标签';
    [].concat(raw[tagKey] ?? []).forEach((tag, index) => {
      const dynamic = dynamicTag(tag);
      if (!dynamic || ammo && dynamic.label === '弹药') return;
      const poolKey = dynamicPoolKey(item, dynamic.label);
      if (poolKey === 'ammo' && weaponAmmoBindings.has(item.id)) return;
      const binding = addBinding(item, path, { rawLabel: dynamic.label, current: dynamic.current, max: dynamic.max,
        path: Array.isArray(raw[tagKey]) ? [tagKey, index] : [tagKey],
        format: { kind: dynamic.max == null ? 'tag_single' : 'tag_slash', sep: dynamic.sep, slash: dynamic.slash }, initialRawValue: text(tag) }, poolKey);
      if (rangedWeapon && poolKey === 'ammo') weaponAmmoBindings.set(item.id, binding);
    });
    return item;
  };
  const slotItems = sourceEntries.map(equipmentEntry);
  const main = slotItems.find(i => i.template.kind === 'weapon' && i.template.twoHanded)
    ?? slotItems.find(i => i.template.kind === 'weapon' && i.slot === 'mainHand')
    ?? slotItems.find(i => i.template.kind === 'weapon' && i.slot !== 'offHand');
  const off = !main?.template.twoHanded && slotItems.find(i => i.slot === 'offHand' && ['weapon', 'consumable'].includes(i.template.kind));
  const shield = !main?.template.twoHanded && slotItems.find(i => i.template.kind === 'shield');
  const gear = slotItems.filter(i => ![main, off, shield].includes(i));
  if (main?.template.ranged) {
    const containers = [
      ...sourceEntries.filter((_, i) => slotItems[i].template.kind !== 'weapon'),
      ...(record.__sourceKind === 'MVU' ? bagEntries.filter(([, raw]) =>
        raw.类型 !== '武器' && raw.kind !== 'weapon' && bound(raw.数量 ?? raw.count, 0, 1e9, 1) > 0) : []),
    ].flatMap(([, raw, , path]) => {
      const counter = ammoCounter(raw);
      return counter ? [{ counter, name: raw.name, path }] : [];
    });
    if (containers.length) {
      const weaponPool = main.template.pools.ammo;
      const ownBinding = weaponAmmoBindings.get(main.id);
      const ownAmmo = bound(ownBinding?.current ?? weaponPool?.initial, 0, 1e9, 0);
      if (ownBinding) Object.assign(ownBinding, { sliceBase: 0, sliceCap: ownAmmo });
      // Remaining rounds occupy consecutive slices: weapon first, then equipped and bag containers in source order.
      let total = ownAmmo, cap = weaponPool?.cap ?? 0;
      for (const { counter, name, path } of containers) {
        const sliceCap = Math.min(counter.current, 1e9 - total);
        const binding = addBinding(main, path, { ...counter, max: counter.max ?? counter.current, sliceBase: total, sliceCap }, 'ammo');
        binding.itemName = name;
        total += sliceCap;
        cap += Math.max(counter.max ?? 0, counter.current);
      }
      attachAmmoPool(main, total, Math.min(1e9, cap));
    }
  }
  for (const item of slotItems) {
    finalizeEquipment(item, sink('effect', `/equipment/${item.templateId}`));
    equipment[item.templateId] = item.template;
    items.push(item);
  }
  const mainId = main?.id ?? null, offId = off?.id ?? null, shieldId = shield?.id ?? null;
  const skillInfo = {};
  const skillKeys = new Map();
  const skillSources = sourceSkills(record);
  for (const [extra] of skillSources.slice(32)) sink('effect', `/units/${id}`).push(`技能数量超过上限 32，未导入「${extra?.name ?? extra?.名称 ?? '未知技能'}」`);
  const normalizedSkills = skillSources.slice(0, 32).map(([raw, i]) => {
    const input = asObject(raw);
    const r = input.damage == null && object(input.伤害) ? { ...input, damage: input.伤害 } : input;
    const skillName = text(r.name ?? r.名称).slice(0, 100) || `技能${i + 1}`;
    const key = hash(String(r.id ?? r.ID ?? skillName)).toString(36);
    const occurrence = skillKeys.get(key) ?? 0;
    skillKeys.set(key, occurrence + 1);
    const sid = `skill-${id.slice(0, 31)}-${hash(id).toString(36)}-${key}${occurrence ? `-${occurrence}` : ''}`;
    entrySources[`skills:${sid}`] = staticProjection(input);
    const notes = sink('effect', `/skills/${sid}`);
    const area = areaFields(r, notes, skillName);
    const costs = skillCosts(r.cost ?? r.消耗);
    const mode = text(r.模式 ?? r.mode ?? r.类型 ?? r.type).toLowerCase();
    const passive = r.passive === true || mode === 'passive' || mode.includes('被动') && !mode.includes('主动');
    const parsed = readCombatTags(r, passive ? 'passive' : 'active', skillName, notes, { customElements });
    const tag = (typeof r.伤害 === 'string' ? r.伤害 : null) ?? parsed.entries.map(label => label.match(/^伤害\s*[:：]\s*(.+)$/)?.[1]?.trim()).find(Boolean) ?? parsed.damageType ?? parsed.powerType;
    const rawEffects = r.effects ?? r.效果;
    // Old cards sometimes put the power declaration in the description rather than tags.
    const descriptionPower = text(r.description ?? r.描述).match(/(?:^|[\s，。；【\[])威力\s*[:：]\s*(\d+)(?=$|[\s，。；：、】\]]|物理|能量|精神|真实)/u)?.[1];
    // A passive tag cannot synthesize strike fields. Explicit template fields still round-trip.
    const power = r.power ?? r.威力 ?? (passive ? undefined : parsed.fields.power ?? descriptionPower);
    const initiative = r.initiativeBonus ?? (passive ? undefined : r.先手 ?? parsed.fields.initiativeBonus
      ?? narrativeEntries(rawEffects).map(([, v]) => typeof v === 'string' && v.match(/^(?:\[[^\]]+\]\s*)*本技能先手\s*([+-]\d+)(?=[，。；、\s]|$)/)?.[1]).find(Boolean));
    const numericPower = number(power, NaN);
    const hasPower = !passive && Number.isFinite(numericPower) && numericPower >= 0;
    if (!hasPower) for (const attack of parsed.activeAttack) notes.push(`「${skillName}」标签「${attack}」待标准化：未声明主击威力，请结合词条语义裁定，不直接把攻击填作 power`);
    const statTag = parsed.entries
      .map(label => statAliases[label.match(/^(?:关联属性\s*[:：]\s*)?(力量|敏捷|体质|智力|精神)$/)?.[1]]).find(Boolean);
    const rules = readRules(r.rules, notes, customElements);
    const prefix = `fx-${hash(sid).toString(36)}`;
    const areaDamage = isAreaDamage(area);
    const narrativeNotes = [];
    appendRules(rules, convertNarrative(rawEffects, notes, prefix, { allowPower: !r.damage && hasPower, areaDamage, passive, customElements,
      onNarrativeWarning: (message, metadata) => narrativeNotes.push({ message, metadata }) }), notes);
    const singleTaggedType = resolveDamageType(tag, customElements);
    const hasActiveDamage = rules.some(rule => rule.enabled !== false && rule.hook === 'active' && [...instructions(rule.program)].some(op => op.op === 'damage'));
    if (!passive && !r.damage && !r.heal && !hasActiveDamage && tag) {
      const packets = hasPower ? damageTags(tag, power, customElements) : [];
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
    const explicitDamageType = resolveDamageType(r.damageType, customElements);
    if (r.damageType != null && !explicitDamageType) notes.push(`「${skillName}」未知伤害类型：${r.damageType}`);
    const generatedDamageType = explicitDamageType ?? singleTaggedType;
    const generatedMainDamage = hasPower && !passive && !r.damage && !r.heal && !damageOps.length && (!tag || singleTaggedType)
      ? { count: 1, sides: 4, ...(statTag ? { stat: statTag } : {}), ...(generatedDamageType ? { type: generatedDamageType } : {}) }
      : null;
    if (generatedMainDamage && !generatedDamageType && narrativeNotes.length) {
      notes.push(`主击伤害类型待标准化「主击伤害类型」：根据原始效果补全 /skills/${sid}/damage/type；若原文明确以混合伤害或独立公式替代主击，请移除模板 damage 并以 active 规则结算。`, { userSummary: `技能「${skillName}」：待从原文识别主击伤害类型` });
    }
    const mainParsed = hasPower && (generatedMainDamage || damageOps.length);
    for (const { message, metadata } of narrativeNotes) {
      const mainNote = mainParsed ? `。主击与威力 ${numericPower} 已解析，只补本条尚未实现的效果，不要重复添加主击。` : '';
      notes.push(message + mainNote + parsed.suffix, metadata);
    }
    const damageType = explicitDamageType ?? resolveDamageType(r.damage?.type, customElements) ?? singleTaggedType ?? (types.length === 1 ? types[0] : undefined);
    const tags = elementTags(r, singleTaggedType);
    skillInfo[sid] = { description:text(r.description ?? r.描述), damageType, hp:costs.hp };
    skills[sid] = {
      name: skillName,
      ...(qualityOf(r) ? { quality: qualityOf(r) } : {}), ...(tags.length ? { tags } : {}), rawRange: area.range ?? 1, ...(passive ? { passive: true } : r.passive === false ? { passive: false } : {}), ap: passive ? 0 : bound(r.ap ?? costs.ap, 0, 2), slot: passive || (r.slot ?? costs.slot) === 'action' ? 'action' : 'attack',
      range: bound(area.range, 0, 64, 1), shape: area.shape ?? 'single',
      target: area.target ?? (areaDamage && object(r.damage) ? 'any' : 'enemy'), ...geometryFields(area),
      ...(text(r.school) ? { school: text(r.school).slice(0, 100) } : {}),
      ...(generatedMainDamage ? { damage: generatedMainDamage } : {}),
      rules, mods: parsed.mods, pools: readPools(r.pools, notes),
    };
    if (damageType) skills[sid].damageType = damageType;
    for (const key of ['mp', 'sp']) if ((r[key] ?? costs[key]) != null) skills[sid][key] = bound(r[key] ?? costs[key], 0, 25000);
    const accuracy = r.accuracy ?? (passive ? undefined : r.命中 ?? parsed.fields.accuracy);
    if (accuracy != null) skills[sid].accuracy = bound(accuracy, -100, 100);
    if (initiative != null) skills[sid].initiativeBonus = bound(initiative, -100, 100);
    if (power != null) skills[sid].power = bound(power, 0, 1e9);
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
    for (const key of ['damage', 'heal']) if (!passive && object(r[key])) skills[sid][key] = normalizeDice(r[key], customElements, key === 'damage' ? damageType : undefined);
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
    const template = sid === 'suppressed' ? STATUSES.suppressed : null;
    const description = text(rawStatus?.效果 ?? rawStatus?.description ?? rawStatus?.描述 ?? (rawStatus !== rawId && typeof rawStatus === 'string' ? rawStatus : ''));
    if (!template || description && description !== template.description) {
      const details = object(rawStatus) && !emptyEntry(rawStatus) ? describe(rawStatus) : description;
      warnings.push(`状态待标准化：${rawId ?? 'unknown'}${description ? `：${description}` : ''}${details && details !== description ? `（原文 ${details}）` : ''}`);
      continue;
    }
    const remainingTurns = statusTurns(rawStatus?.remainingTurns ?? rawStatus?.剩余回合 ?? rawStatus?.剩余时间, template.remainingTurns);
    const stacks = bound(rawStatus?.stacks ?? rawStatus?.层数, 1, template.maxStacks);
    if (!emptyEntry(rawStatus?.modifiers)) warnings.push(`状态 ${sid} 的 modifiers 待标准化：${describe(rawStatus.modifiers)}。请在状态模板上声明 mods 或 rules`, { userSummary: `状态「${template.name}」：附带效果待转换` });
    const durationType = ['battle_turns', 'until_removed', 'persistent'].includes(rawStatus?.durationType)
      ? rawStatus.durationType : template.durationType;
    statuses[sid] = { ...clone(template), templateId: sid, ownerId: id, sourceId: null, durationType, remainingTurns, stacks };
  }
  const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
  const team = teamOf(p.faction ?? p.team, 'red');
  const rawFacing = Array.isArray(p.facing) ? p.facing : [team === 'blue' ? 1 : -1, 0];
  const facing = rawFacing.slice(0, 2).map(n => Math.sign(integer(n)));
  if (facing.length !== 2 || !facing.some(Boolean)) facing.splice(0, 2, team === 'blue' ? 1 : -1, 0);
  const rawMove = number(findValue(record, ['move','movement','移动'], null), NaN);
  const defaultMove = defaultMoveFromAgi(stats.agi, tier);
  const unit = { rawMove: Number.isFinite(rawMove) ? Math.max(0, rawMove) : defaultMove, id, name, team, x: pos.x, y: pos.y, facing, ...(Number.isInteger(p.altitude) && p.altitude > 0 ? { altitude: p.altitude } : {}), hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ...(Object.keys(unitPools).length ? { unitPools } : {}), ap: 0, used: { action: 0, attack: 0 }, stats, armor: Math.max(0, Math.min(1000000, integer(findValue(record, ['armor','defense','护甲'], 0), 0))), size, move: Math.round(Number.isFinite(rawMove) ? Math.max(0, rawMove) : defaultMove), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.slice(0, 12).map(item => item.id), skills: normalizedSkills, statuses, level, tier, bodyLengthM, mc, stance, ...(p.surprised && { surprised: true }), greatswordMode: 'offensive', attunementCharges: stanceRules('attunement').itemCharges, bonusDice: 0, penaltyDice: 0, intent: 'normal', nonLethal: p.nonLethal === true, moraleType: moraleTypeFor(p.moraleType) ?? 'standard', ...(isProtagonist && {protagonist:true}) };
  if (p.moraleType && !moraleTypeFor(p.moraleType)) sink('state').push(`未知战斗类型「${p.moraleType}」，按标准处理`);
  if (isProtagonist) {
    const bagWeapons = [];
    for (const entry of bagEntries) {
      const [, raw] = entry;
      if ((raw.类型 !== '武器' && raw.kind !== 'weapon') || bound(raw.数量 ?? raw.count, 0, 1e9, 1) === 0) continue;
      const item = equipmentEntry(entry);
      if (item.template.kind === 'weapon') {
        finalizeEquipment(item, sink('effect', `/equipment/${item.templateId}`));
        equipment[item.templateId] = item.template;
        items.push(item);
        bagWeapons.push(item.id);
      }
    }
    if (bagWeapons.length) unit.bagWeapons = bagWeapons;
    const inventory = importBackpack(record.背包, id, skills, sink, entrySources, inventoryPaths, sourcePath);
    dynamicOverlay.inventory = inventoryPaths;
    if (Object.keys(inventory).length) unit.inventory = inventory;
  }
  const creatureType = p.creatureType ?? record.creatureType;
  if (Array.isArray(creatureType)) unit.creatureType = creatureType.map(text).filter(Boolean).slice(0, 12);
  else if (text(creatureType)) unit.creatureType = text(creatureType).slice(0, 100);
  const tags = p.tags ?? record.tags;
  if (Array.isArray(tags)) unit.tags = tags.map(text).filter(tag => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag)).slice(0, 32);
  unit.rules = readRules(record.rules, sink('effect', `/units/${id}`));
  unit.mods = readMods(record.mods, sink('effect', `/units/${id}`));
  dynamicOverlay.units[id] = { hp: resources.hp.current, mp: resources.mp.current, sp: resources.sp.current,
    statuses: clone(statuses), inventory: clone(inventoryPaths), unitPools: clone(unitPools) };
  return { unit, entrySources, dynamicOverlay, counterBindings, inventoryPaths, profile: { id, skillInfo, level, tier, stats, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, equipment: clone(slotItems), sourcePath: record.__sourcePath ?? null, sourceKind: record.__sourceKind || 'unknown', fieldSources: { numeric: record.__sourceKind || 'unknown', equipment: record.__sourceKind || 'unknown', placement: 'battle_init', faction: 'battle_init', name: p.protagonistName ? 'persona' : (p.name ? 'battle_init' : (record.__sourceKind || 'unknown')) } }, participant: p };
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

function normalizeSceneArea(raw, grid) {
  if (raw === undefined) return { shape: 'board' };
  if (!object(raw) || !['board', 'rect'].includes(raw.shape)) return null;
  const area = { shape: raw.shape };
  if (area.shape === 'rect') {
    if (!object(raw.rect)) return null;
    const { x1, y1, x2, y2 } = raw.rect;
    if (![x1, y1, x2, y2].every(Number.isInteger) || x1 < 0 || y1 < 0 || x1 > x2 || y1 > y2
      || y2 >= grid.length || x2 >= (grid[y2]?.length ?? 0)) return null;
    area.rect = { x1, y1, x2, y2 };
  }
  for (const key of ['z1', 'z2']) {
    if (!own(raw, key)) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < -4 || raw[key] > 20) return null;
    area[key] = raw[key];
  }
  if (area.z1 > area.z2) return null;
  return area;
}

const sceneMedia = new Map([
  ['浅水洼', 'water'], ['水洼', 'water'], ['积水', 'water'], ['浅滩', 'water'],
  ['冰面', 'ice'], ['薄冰', 'ice'], ['冻土冰面', 'ice'],
  ['油污', 'oil'], ['火油', 'oil'], ['油脂地面', 'oil'],
  ['火海', 'fire'], ['地面余火', 'fire'], ['烈焰地面', 'fire'],
  ['强酸池', 'acid'], ['酸液池', 'acid'], ['酸沼', 'acid'],
  ['蒸汽云', 'steam'], ['水汽云', 'steam'],
  ['浓烟', 'smoke'], ['黑烟', 'smoke'], ['烟幕', 'smoke'],
  ['可燃毒雾', 'poison_cloud'], ['毒瘴云', 'poison_cloud'], ['沼气毒雾', 'poison_cloud'],
]);

// Opening declarations define the initial board and do not produce combat log entries.
const sceneZoneHost = { log() {} };
function sceneMediumArea(state, area, layer) {
  const zone = { area };
  const cells = mediaCells(state, zone).filter(at => layer === 'cloud' || zoneContains(state, zone, at));
  const { z1, z2 } = area;
  return { shape: 'cells', cells, ...(z1 !== undefined && { z1 }), ...(z2 !== undefined && { z2 }) };
}

function sceneZonesState(battle, state, warnings) {
  const zoneEntries = {};
  if (!Array.isArray(battle.effects)) return zoneEntries;
  const used = new Set(Object.keys(state.zones).map(id => id.toLowerCase()));
  const adjusted = warningSink(warnings, null, 'battle_init', 'terrain');
  if (battle.effects.length > 16) adjusted.push('最多 16 条 效果 记录，已忽略超出部分', { kind: 'auto_adjusted' });
  for (const [index, raw] of battle.effects.slice(0, 16).entries()) {
    if (!object(raw)) {
      adjusted.push(`忽略无效的第 ${index + 1} 条战场效果`, { kind: 'auto_adjusted' });
      continue;
    }
    const nameText = typeof raw.name === 'string' ? raw.name.trim() : '';
    const area = normalizeSceneArea(own(raw, 'area') ? raw.area : undefined, state.grid);
    if (!area) {
      adjusted.push(`忽略范围无效的战场效果「${nameText || index + 1}」`, { kind: 'auto_adjusted' });
      continue;
    }
    const base = validId(raw.id) ? raw.id : deterministicId(nameText || 'zone', 'zone');
    let id = base;
    for (let n = 2; used.has(id.toLowerCase()); n++) {
      const suffix = `_${n}`;
      id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    }
    used.add(id.toLowerCase());
    const name = (nameText || id).slice(0, 100);
    const rawDescription = typeof raw.description === 'string' ? raw.description.trim() : '';
    const description = (rawDescription || name).slice(0, 500);
    const targetTeam = ['blue', 'red'].includes(raw.targetTeam) ? raw.targetTeam : null;
    const medium = raw.targetTeam === null && (!rawDescription || rawDescription === nameText) ? sceneMedia.get(nameText) : undefined;
    zoneEntries[id] = { id, name, targetTeam, description, area: clone(area) };
    if (medium) {
      const blueprint = mediumZone(medium);
      const mediumArea = sceneMediumArea(state, area, blueprint.layer);
      putMedium(state, sceneZoneHost, { ...blueprint, id, name, area: mediumArea, sourceId: null, team: null,
        persistent: raw.persistent === true,
        remainingTurns: raw.remainingTurns ?? blueprint.remainingTurns,
        ...(raw.tier !== undefined && { tier: raw.tier }) });
      continue;
    }
    state.zones[id] = { id, name, area, follow: false, persistent: true, remainingTurns: 1,
      sourceId: null, team: null, tags: ['scene_effect'], mods: [], rules: [] };
    const teamLabel = targetTeam === null ? '全体' : `仅${targetTeam === 'blue' ? '蓝' : '红'}方(self.team == '${targetTeam}')`;
    const zText = own(area, 'z1') || own(area, 'z2') ? `(${area.z1 ?? -4}-${area.z2 ?? 20})` : '';
    const horizontal = area.shape === 'board' ? '全场' : `(${area.rect.x1}-${area.rect.x2})(${area.rect.y1}-${area.rect.y2})`;
    warningSink(warnings, null, 'battle_init', 'scene', `/zones/${id}`).push(
      `战场效果待标准化「${name}」[作用阵营:${teamLabel}][范围:${horizontal}${zText}]：${description}`);
  }
  return zoneEntries;
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
const markedSummon = record => record?.角色定位 === '召唤物' || record?.类型 === '召唤物';

function addOwnedSummonRows(summonRows, chars, participants, resolved, onAdd) {
  for (const record of chars.filter(markedSummon)) {
    const name = sourceName(record);
    const ownerName = text(record.归属);
    if (!ownerName) continue;
    const owner = participants.find((p, i) => p.name === ownerName || sourceName(resolved[i]) === ownerName);
    if (!owner?.id || !name || summonRows.some(row => row.ownerId === owner.id && row.name === name)) continue;
    summonRows.push({ id: deterministicId(`${owner.id}-${name}`, 'summon'), ownerId: owner.id, source: 'char_info', name });
    onAdd?.(owner.id, name);
    // The declaration may come from an older panel even if a newer panel supplies its stats.
  }
}

function resolveRoster(battle, mvu, chars, protagonistName, useRecord) {
  const mvuRecords = collectMvu(mvu);
  const protagonist = protagonistAliases.flatMap(alias => mvuRecords.filter(record => samePath(record.__sourcePath, [alias])))[0];
  const descriptor = battle.version === 1 && ['flat', 'terrain'].includes(battle.terrainMode);
  const participants = participantList(battle);
  const resolved = participants.map(participant => resolveParticipant(participant, mvuRecords, chars, protagonist, useRecord));
  // Older chapter JSON uses generated unit IDs and rarely names the MVU path.
  if (!descriptor && protagonist && !resolved.includes(protagonist)) {
    const eligible = p => !text(p.source) && teamOf(p.faction ?? p.team) === 'blue';
    const byPersona = protagonistName ? participants.findIndex((p, i) => eligible(p) && text(p.name) === protagonistName
      && resolved[i]?.__sourceKind !== 'MVU') : -1;
    const fallbackIndex = byPersona >= 0 ? byPersona : participants.findIndex((p, i) => eligible(p) && !resolved[i]);
    if (fallbackIndex >= 0) resolved[fallbackIndex] = protagonist;
  }
  return { mvuRecords, protagonist, descriptor, participants, resolved };
}

export function openingCharInfo(battle, mvu, chars, protagonistName) {
  if (!Array.isArray(chars) || !chars.length || !battle) return chars;
  const used = new Set();
  const keep = record => used.add(record);
  const { mvuRecords, participants, resolved } = resolveRoster(battle, mvu, chars, protagonistName, keep);
  // A legacy battle with no roster discovers its units from the source records.
  if (!participants.length) return chars;
  const summons = [...(battle.summons ?? [])];
  addOwnedSummonRows(summons, chars, participants, resolved);
  for (const row of summons) {
    if (row.source !== 'char_info') continue;
    const ownerIndex = participants.findIndex(p => p.id === row.ownerId);
    if (ownerIndex < 0) continue;
    const owner = resolved[ownerIndex];
    resolveSummonSource(row, owner, mvuRecords, chars, keep);
    // Preserve the record that supplies implicit summon discovery on replay.
    for (const record of chars) {
      if (markedSummon(record) && sourceName(record) === row.name && record.归属 &&
          [participants[ownerIndex].name, sourceName(owner)].includes(record.归属)) keep(record);
    }
  }
  return chars.filter(record => used.has(record));
}

export function hydrateFromSources(input = {}, options = {}) {
  const source = asObject(input), warnings = [];
  const sink = (unitId, source, scope, path) => warningSink(warnings, unitId, source, scope, path);
  const protagonistName = text(source.protagonistName ?? options.protagonistName);
  const mvu = source.mvu ?? source.statData ?? source.stat_data ?? {};
  const battle = parseBattleInit(source.battleInit ?? source.battle_init ?? source.battle ?? {});
  const chars = parseCharInfo(source.charInfo ?? source.char_info ?? '').map(record => ({ ...record, __sourceKind: 'char_info' }));
  const { mvuRecords, protagonist, descriptor, participants, resolved } = resolveRoster(battle, mvu, chars, protagonistName);
  const customElements = clone(source.customElements ?? options.customElements ?? {});
  // Do not preload the demo catalog: its rules intentionally reference demo-only
  // status templates. Hydrated Tavern battles contain only source-backed entries.
  const equipment = {}, skills = {}, items = [];
  const units = {}, profiles = {}, sourceMap = {}, entrySources = {}, summonTemplates = {}, archetypes = new Map();
  const add = (participant, record, index) => {
    const base = descriptor ? participant.id : deterministicId(participant.id || participant.uid || participant.source || `${participant.name}-${index}`, 'unit');
    let id = base;
    for (let suffix = 2; own(units, id); suffix++) id = `${base.slice(0, 52)}-${suffix}`;
    const persona = !descriptor && record === protagonist && protagonistName ? { protagonistName } : {};
    const origin = record.__sourceKind?.toLowerCase() ?? 'battle_init';
    if (index < participants.length && !resolved[index] && participant.source) sink(id, 'battle_init', 'state').push(`未找到参战来源：${participant.source}（${participant.name ?? participant.id}）`);
    const merged = mergeBattleParticipant(record, participant, battle);
    const placement = { moraleType:battle.moraleType, ...(battle.surprisedTeam && { surprised: battle.surprisedTeam === participant.team }), ...participant, ...persona, id };
    const startWarnings = warnings.length;
    const made = unitFrom(merged, placement, index, equipment, skills, items, (scope, path) => sink(id, origin, scope, path), record === protagonist, battle, record, customElements);
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
    sourceMap[id] = {
      path: record?.__sourcePath,
      resourcePaths: Object.fromEntries(['hp', 'mp', 'sp'].map(key => [key, sourceResourcePath(record, key)]).filter(([, path]) => path)),
      statusesPath: ['statuses', '状态效果', '状态', 'effects'].find(key => own(record, key)) ? [
        ['statuses', '状态效果', '状态', 'effects'].find(key => own(record, key)),
      ] : undefined,
      counterBindings: made.counterBindings,
      inventoryPaths: made.inventoryPaths,
      sourceId: sourceId(record), sourceName: sourceName(record), isProtagonist: record === protagonist,
    };
  };
  const summonRows = [...(battle.summons ?? [])];
  addOwnedSummonRows(summonRows, chars, participants, resolved, (ownerId, name) => {
    sink(ownerId, 'char_info', 'state').push(`已按归属补录召唤物「${name}」`, { kind: 'auto_adjusted' });
  });
  for (const [i, participant] of participants.entries()) {
    const record = resolved[i];
    const summon = summonRows.find(row => row.ownerId !== participant.id && row.name === participant.name);
    const name = text(participant.name);
    const mentioned = !record && name.length >= 2 && participants.some((other, j) => j !== i && resolved[j]
      && (other.team ?? other.faction) === (participant.team ?? participant.faction)
      && JSON.stringify([resolved[j].技能, resolved[j].装备, resolved[j].skills, resolved[j].equipment]).includes(name));
    const isSummonRecord = record?.__sourceKind === 'char_info' && (markedSummon(record) || summon);
    if (isSummonRecord || (!record && summon) || mentioned) {
      sink(null, 'battle_init', 'state').push(`已忽略误写为 unit 的召唤物「${participant.name}」，请使用 summon| 行`, { kind: 'auto_adjusted' });
      continue;
    }
    const count = record?.__sourceKind === 'char_info' ? bound(record.数量 ?? record.count, 1, 100, 1) : 1;
    for (let copy = 0; copy < count; copy++) {
      const placement = copy ? { ...participant, id: `${participant.id ?? participant.uid ?? participant.name}-${copy + 1}` } : participant;
      add(placement, record ?? { __sourceKind: 'battle_init' }, i * count + copy);
    }
  }
  // Older battles without an explicit roster retain the discovered characters.
  if (!participants.length) {
    const records = [...mvuRecords, ...chars.filter(char => !markedSummon(char) && !summonRows.some(row => row.source === 'char_info' && row.name === sourceName(char)) && !mvuRecords.some(record => sourceName(record, record.__sourceKey) === sourceName(char)))];
    let index = 0;
    for (const [i, record] of records.entries()) {
      const count = record.__sourceKind === 'char_info' ? bound(record.数量 ?? record.count, 1, 100, 1) : 1;
      for (let copy = 0; copy < count; copy++, index++) {
        add({ name: sourceName(record, record.__sourceKey), source: sourceId(record), faction: i ? 'red' : 'blue', x: index % (battle.width ?? 10), y: Math.floor(index / (battle.width ?? 10)) % (battle.height ?? 10) }, record, index);
      }
    }
  }
  const openingSummons = [];
  for (const [ownerIndex, ownerRecord] of resolved.entries()) {
    const ownerId = participants[ownerIndex]?.id;
    for (const name of Object.keys(ownerRecord?.tacticalSummons ?? {})) {
      if (ownerId && !summonRows.some(row => row.ownerId === ownerId && row.name === name)) {
        summonRows.push({ id: deterministicId(`${ownerId}-${name}`, 'summon'), ownerId, source: `mvu:${ownerRecord.__sourcePath?.join('/') ?? '主角'}/${name}`, name });
      }
    }
  }
  for (const [index, row] of summonRows.entries()) {
    const ownerIndex = participants.findIndex(participant => participant.id === row.ownerId);
    const owner = units[row.ownerId];
    const ownerRecord = ownerIndex >= 0 ? resolved[ownerIndex] : null;
    if (!owner) { sink(null, 'battle_init', 'state').push(`召唤物「${row.name}」找不到归属单位「${row.ownerId}」`); continue; }
    const sourceRecord = resolveSummonSource(row, ownerRecord, mvuRecords, chars);
    if (!sourceRecord) { sink(row.ownerId, row.source, 'state').push(`未找到召唤物来源：${row.source}（${row.name}）`); continue; }
    const templateId = deterministicId(row.id, 'summon');
    const firstItem = items.length;
    const made = unitFrom({ ...asObject(sourceRecord), __sourceKind: sourceRecord.__sourceKind ?? row.source },
      { id: `summon-template-${templateId}`, name: row.name, team: owner.team, x: owner.x, y: owner.y }, index,
      equipment, skills, items, (scope, path) => sink(row.ownerId, row.source, scope, path), false, battle, sourceRecord, customElements);
    const summonUnit = made.unit;
    const itemTemplate = id => id && items.find(item => item.id === id)?.templateId;
    const features = asObject(sourceRecord.特征);
    const mode = features.行动模式 ?? sourceRecord.行动模式 ?? sourceRecord.turnMode;
    const modes = { 随主共享:'linked_group', 随主独立:'linked_each', 独立回合:'independent', 纯被动:'none', 随动:'linked_group', 各自随动:'linked_each', 独立:'independent', 瞬发:'none' };
    const turnMode = row.turnMode ?? (own(modes, mode) ? modes[mode] : undefined) ?? (['linked_group','linked_each','independent','none'].includes(mode) ? mode : undefined);
    const rawGroup = features.分组 ?? sourceRecord.分组 ?? sourceRecord.group;
    const group = rawGroup && (!row.group || row.group === row.id) ? deterministicId(rawGroup, 'summon-group') : row.group ?? templateId;
    const limit = features.上限 ?? sourceRecord.上限 ?? sourceRecord.maxActive;
    const maxActive = row.maxActive ?? (limit == null ? undefined : bound(limit, 1, 20));
    const duration = text(features.存续 ?? sourceRecord.存续);
    const amount = duration.match(/^(\d+)\s*(?:个)?(大轮|轮|回合)$/);
    const turns = amount ? bound(amount[1], 1, 100, 1) : /本回合结束/.test(duration) && !/依召唤|或/.test(duration) ? 1 : null;
    const panel = { stats: summonUnit.stats, tier: Math.min(summonUnit.tier, owner.tier) };
    if (spawnBudgetIssue(owner, panel)) {
      panel.stats = fitSpawnStats(owner, panel);
      sink(row.ownerId, row.source, 'state').push(`召唤物「${row.name}」的五维已按归属者预算收敛`, { kind: 'auto_adjusted' });
    }
    summonTemplates[templateId] = {
      name: row.name, ownerId: row.ownerId, ...panel,
      ...(Number.isFinite(number(findValue(sourceRecord, ['move', 'movement', '移动'], null), NaN)) && { move: summonUnit.rawMove }),
      ...(findValue(sourceRecord, ['level', '等级'], null) != null && { level: summonUnit.level }),
      bodyLengthM: summonUnit.bodyLengthM, size: summonUnit.size,
      mc: bound(findValue(sourceRecord, ['mc','MC','massClass'], sizeMultiplier(summonUnit.bodyLengthM)), 1, 64, 1),
      skills: [...(summonUnit.skills ?? [])], ...(itemTemplate(summonUnit.mainHand) && { mainHand: itemTemplate(summonUnit.mainHand) }),
      ...(itemTemplate(summonUnit.offHand) && { offHand: itemTemplate(summonUnit.offHand) }),
      ...(itemTemplate(summonUnit.shield) && { shield: itemTemplate(summonUnit.shield) }),
      gear: summonUnit.gear.map(itemTemplate).filter(Boolean),
      group, ...(turnMode && { turnMode }), ...(maxActive && { maxActive }),
      ...(row.stackPolicy && { stackPolicy: row.stackPolicy }),
      ...(turns && { remainingTurns: turns, durationUnit: amount?.[2].endsWith('轮') ? 'rounds' : 'anchor_turns' }),
    };
    if (row.opening) openingSummons.push({ owner, templateId, opening: row.opening });
    items.splice(firstItem);
    entrySources[row.ownerId] ??= {};
    Object.assign(entrySources[row.ownerId], made.entrySources, { [`summonTemplates:${templateId}`]: { record: staticProjection(sourceRecord), declaration: row } });
  }
  const title = text(battle.sceneTitle ?? battle.title ?? options.title).slice(0, 100) || '酒馆战术战局';
  const seed = integer(options.seed ?? battle.seed, hash(battle.battleId ?? title)) >>> 0;
  const tierValue = battle.scaleTier ?? battle.anchorTier;
  const hasDeclaredTier = tierValue != null;
  const hasDeclaredCellM = battle.cellM != null;
  const explicitScale = hasDeclaredTier || hasDeclaredCellM;
  if (hasDeclaredTier && (!Number.isInteger(tierValue) || tierValue < 1 || tierValue > 7)) {
    throw new Error('战场层级必须是 1 至 7 的整数');
  }
  const unitTiers = Object.values(units).map(unit => unit.tier ?? 1);
  const defaultTier = unitTiers.length ? Math.max(1, Math.min(...unitTiers)) : 1;
  const anchorTier = tierValue ?? (hasDeclaredCellM ? tierFromCellM(battle.cellM) : defaultTier);
  const cellM = hasDeclaredCellM ? battle.cellM : TIER_CELL_M[anchorTier];
  const state = { ...(battle.suppressingTeam && {suppressingTeam:battle.suppressingTeam}), ...(battle.heroicDowned === true && { heroicDowned: true }), ...(Object.keys(customElements).length ? { customElements } : {}), battleType:moraleTypeFor(battle.moraleType) ?? 'standard', scenarioId: descriptor ? battle.battleId : deterministicId(battle.battleId ?? title, 'battle'), title, mode: 'split', ruleset: ['protocol','sandbox'].includes(options.ruleset) ? options.ruleset : 'protocol', scale: { cellM, width: battle.width ?? 10, height: battle.height ?? 10, anchorTier, explicit: explicitScale }, round: 1, turn: 0, order: Object.keys(units), units, summonTemplates, items: Object.fromEntries(items.map(({ id, templateId }) => [id, { id, templateId }])), equipment, skills, statusTemplates: {}, grid: [], covers: {}, interactives: {}, zones: {}, rng: seed, logs: [], outcome: null, tape: [] };
  if (battle.elementalPhysics === 'off' || battle.elementalPhysics === 'standard') state.elementalPhysics = battle.elementalPhysics;
  initializeVMWorld(state);
  for (const binding of Object.values(sourceMap).flatMap(mapping => mapping.counterBindings ?? [])) {
    if (binding.poolKey == null || binding.current == null || binding.sliceCap != null) continue;
    const isUnit = binding.ownerKind === 'unit' || binding.target?.kind === 'unit_pool';
    const pool = isUnit
      ? getPool(state, binding.unitId, binding.poolKey, 'unit')
      : getPool(state, binding.itemId, binding.poolKey, 'item');
    if (!pool) continue;
    if (binding.current > pool.max) updatePoolMax(state, pool.id, 'set_max', binding.current);
    updatePoolCurrent(state, pool.id, 'set', binding.current);
  }
  const time = parseBattleTime(source.task, source.battle, source.battleText, source.latestFloor, source.battleInit, source.battle_init);
  if (time) state.time = time;
  for (const unit of Object.values(units)) {
    unit.moveM = unit.rawMove * TIER_CELL_M[unit.tier];
    unit.move = boardMoveCellsFromMoveM(unit.moveM, state.scale);
    unit.moveCarryPermille = 0;
  }
  const adjustmentSink = (source, scope) => ({ push: message => sink(null, source, scope).push(message, { kind: 'auto_adjusted' }) });
  terrainState(battle, state, adjustmentSink('terrain', 'terrain'));
  const zoneEntries = sceneZonesState(battle, state, warnings);
  placeUnits(state, adjustmentSink('battle_init', 'state'));
  let valid = true;
  try { validateState(state); } catch (error) {
    valid = false;
    sink(null, null, 'state').push(`转换结果未通过校验：${error.message}`);
    if (options.throwOnValidation) throw error;
  }
  if (valid) {
    const ownerRules = new Map();
    for (const { owner, templateId, opening } of openingSummons) {
      if (!ownerRules.has(owner)) ownerRules.set(owner, owner.rules);
      const at = opening === 'owner' ? { x: owner.x, y: owner.y, z: elevation(state, owner) }
        : { x: opening.x, y: opening.y, z: (opening.z ?? state.grid[opening.y][opening.x].z) + (opening.altitude ?? 0) };
      owner.rules = [...(owner.rules ?? []), { id: `open-${hash(templateId)}`, hook: 'round_start', filter: 'round == 1',
        program: [{ op: 'spawn', entityKind: 'unit', at, spec: { templateId } }] }];
    }
    beginBattle(state);
    for (const [owner, rules] of ownerRules) {
      if (rules === undefined) delete owner.rules;
      else owner.rules = rules;
    }
  }
  const roster = Object.values(units).filter(unit => profiles[unit.id]).map(unit => ({ ...profiles[unit.id], ...clone(unit), source: profiles[unit.id].sourceKind }));
  // Keep conversion diagnostics out of serialized engine state (which has a strict schema).
  Object.defineProperty(state, 'warnings', { value: warnings });
  return { state, roster, warnings, sourceMap, entrySources, zoneEntries, battleInit: battle, seed };
}

export function warningsForUnit(warnings = [], unitIds, includeGlobal = true) {
  if (!unitIds?.length) return warnings;
  const selected = new Set(unitIds);
  return warnings.filter(w => w.unitId === null ? includeGlobal : selected.has(w.unitId));
}

export const convertSources = hydrateFromSources;
export const buildState = (input, options) => hydrateFromSources(input, options).state;
