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
import { asObject, attrNames, bound, charSources, clone, collectMvu, defaultCoverHp, describe, deterministicId, emptyEntry, findValue, hash, integer, narrativeEntries, number, object, own, parseBattleInit, parseCharInfo, protagonistAliases, qualityOf, rawTagValues, resolveParticipant, resource, safeResource, samePath, sourceId, sourceName, statAliases, statsOf, statusId, statusTurns, text, tierNumber, warningSink, WARNING_SCOPES } from './converter-parse.js';
import { activeRule, ammoCapacity, appendRules, areaFields, attachAmmoPool, convertNarrative, damageAliases, damageTags, damageTypes, finalizeEquipment, geometryFields, instructions, isAreaDamage, mapEffects, normalizeDice, normalizeEquipment, readMods, readPools, readRules, skillCosts } from './converter-effects.js';

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
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
