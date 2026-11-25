import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { id as validId, validateState } from '../api/validation.js';
import { DISTANCE_TABLE, sizeClassFor, stanceFor, moraleTypeFor, TIER_CELL_M, QUALITY_TIER, resolveEffectiveTier, scaledCells } from '../core/combat_protocol.js';
import { validVmRule, vmStatModError } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';
import { initializeVMWorld } from '../core/vm-runtime.js';
import { beginBattle, STATUSES } from '../core/combat.js';
import { canOccupy } from '../core/spatial.js';
import { parseBattleDescriptor } from './descriptor.js';
import { createBattleGrid } from './terrain.js';
import { parseBattleTime } from '../core/battle_time.js';
import { parseAreaTags, tagEntries } from './area-tags.js';
import { attrNames, blockBody, bound, clone, describe, deterministicId, finite, hash, narrativeEntries, object, own, qualityOf, rawTagValues, statAliases, text, warningSink, asObject } from './converter-parse.js'

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
export function activeRule(id, program) { return { id, hook: 'active', program }; }

export function readRules(value, warnings) {
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

export function appendRules(rules, additions, warnings) {
  for (const rule of additions) {
    if (rules.some(existing => existing.id === rule.id)) warnings.push(`生成规则 ${rule.id} 与已声明规则 ID 重复`);
    else if (rules.length === 200) warnings.push(`生成规则 ${rule.id} 超过规则数量上限 200`);
    else rules.push(rule);
  }
}

export function readMods(value, warnings) {
  if (value == null) return [];
  if (!Array.isArray(value)) { warnings.push('mods 必须是 StatMod 数组'); return []; }
  return value.flatMap((mod, index) => {
    const error = index < 200 ? vmStatModError(mod) : '超出数量上限 200';
    if (!error) return [clone(mod)];
    warnings.push(`mods[${index}] ${error}：${describe(mod)}`);
    return [];
  });
}

// Geometry is handled by parseAreaTags. Only complete combat declarations enter
// this table: a qualifier such as 无视防御 is not a defense-panel declaration.
const combatTag = /^(攻击力?|防御力?|防具|护甲|命中|闪避|先手|暴击|威力)\s*(?:\([^()]*\)|（[^（）]*）)?\s*[:：]\s*(.*)$/u;
const numberTag = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const powerTag = /^(\d+)(?:\s*(物理|能量|精神|真实))?$/u;
const canonicalKey = { 攻击力:'攻击', 防御力:'防御', 护甲:'防御', 防具:'防御' };

export function readCombatTags(raw, kind, name, warnings) {
  const mods = readMods(raw.mods, warnings), fields = {}, summary = [], groups = new Map();
  const weapon = kind === 'weapon', active = kind === 'active', passive = kind === 'passive';
  const entries = tagEntries(raw.tags ?? raw.标签);
  const warn = (tag, advice = '') => warnings.push(`「${name}」标签「${tag}」待标准化：请结合词条语义映射为合法 VM mods / rules 或标明 engine_limit${advice && `；${advice}`}`);
  for (const tag of entries) {
    const match = combatTag.exec(tag) ?? /^(先手)\s*([+-]?\d.*)$/u.exec(tag);
    if (!match) continue;
    const key = canonicalKey[match[1]] ?? match[1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ tag, value:match[2] });
  }
  let powerType;
  const equipmentPower = [], activeAttack = [];
  for (const [key, group] of groups) {
    const values = [];
    for (const { tag, value } of group) {
      if (key === '暴击') { warn(tag, '区分暴击档位与暴击伤害'); continue; }
      if (key === '威力' && !active) {
        if (passive) warn(tag, '纯被动技能不结算主击威力');
        else equipmentPower.push(tag);
        continue;
      }
      if (key === '攻击' && active) { activeAttack.push(tag); continue; }
      if (key === '攻击' && !weapon) { warn(tag, '请结合描述裁定伤害加值或触发效果'); continue; }
      if (active && (key === '防御' || key === '闪避')) { warn(tag, '主动技能不能直接提供常驻加成，请裁定是否施加状态'); continue; }
      const power = key === '威力' ? powerTag.exec(value) : null;
      const n = power ? Number(power[1]) : numberTag.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(n) || (key === '威力' && n < 0)) { warn(tag); continue; }
      if (power && !values.length) powerType = power[2];
      values.push(n);
    }
    if (!values.length) continue;
    const total = values.reduce((sum, n) => sum + n, 0);
    const field = key === '攻击' ? 'attack' : key === '防御' && !weapon && !passive ? 'defense'
      : key === '命中' && (weapon || active) ? 'accuracy' : key === '先手' && active ? 'initiativeBonus' : key === '威力' ? 'power' : null;
    if (field) {
      // Explicit template fields win. Power describes one main strike, not a stackable bonus.
      if ((raw[field] ?? raw[key]) != null) continue;
      const n = field === 'power' ? values[0] : total;
      const panel = field === 'attack' || field === 'power' ? bound(n, 0, 1e9) : field === 'defense' ? bound(n, 0, 1e6) : bound(n, -100, 100);
      fields[field] = panel;
      summary.push([key, panel]);
    } else {
      const stat = { 防御:'armor', 命中:'checkBonus', 闪避:'dodge', 先手:'initiativeFlat' }[key];
      const checkKind = key === '命中' ? 'attack' : undefined;
      if (!total || (weapon && stat === 'armor' && total < 0) || mods.some(mod => mod.stat === stat && mod.checkKind === checkKind &&
        mod.when === undefined && mod.damageType === undefined && mod.statusId === undefined)) continue;
      if (mods.length >= 200 || !Number.isSafeInteger(total)) { for (const { tag } of group) warn(tag, '合计数值或 mods 数量超限'); continue; }
      mods.push({ stat, flat:total, ...(checkKind && {checkKind}) });
      summary.push([key, total]);
    }
  }
  const suffix = summary.length ? `。已由静态标签解析落盘：${summary.map(([label, n]) => `${label} ${n >= 0 ? '+' : ''}${n}`).join('、')}；补丁改写 mods 时须保留既有项（或用 /mods/- 追加）且切勿重复叠加同一数值；若本条仅重申该静态加成而无额外局内机制，直接归入 narrative 说明即可。` : '';
  return { entries, fields, mods, suffix, powerType, equipmentPower, activeAttack };
}

export function readPools(value, warnings) {
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

function readEquipmentNarrative(effects, warnings, onNarrativeWarning) {
  return convertNarrative(effects, warnings, '', { equipment: true, onNarrativeWarning });
}

export function convertNarrative(effects, warnings, prefix, { allowPower = false, equipment = false, areaDamage = false, passive = false,
  onNarrativeWarning = (message, metadata) => warnings.push(message, metadata) } = {}) {
  const rules = [];
  for (const [index, [label, entry]] of narrativeEntries(effects).entries()) {
    if (validVmRule(entry)) {
      appendRules(rules, [clone(entry)], warnings);
      continue;
    }
    const program = !equipment && !passive && typeof entry === 'string' ? narrativeDamage(label, entry, allowPower) : [];
    const rawExcerpt = [entry].flat().map(value => typeof value === 'string' ? blockBody(value)
      : text(value?.描述 ?? value?.description ?? value?.效果 ?? value?.effect)).filter(Boolean).join('；');
    const excerpt = [...rawExcerpt];
    const summary = excerpt.length ? `${excerpt.slice(0, 80).join('')}${excerpt.length > 80 ? '…' : ''}` : '待转换为战斗规则';
    const metadata = { rawExcerpt, userSummary: `${label ? `「${label}」` : '效果'}：${summary}` };
    if (program.length && areaDamage) {
      onNarrativeWarning(`范围伤害待标准化${label ? `「${label}」` : ''}：${describe(entry)}。请为规则声明精确的目标选择器`, metadata, index, label);
    } else if (program.length) appendRules(rules, [activeRule(`${prefix.slice(0, 45)}-narrative-${index}`, program)], warnings);
    else onNarrativeWarning(`${equipment ? '装备' : ''}效果待标准化${label ? `「${label}」` : ''}：${describe(entry)}。请用 VM rules / mods / pools 实现行为与触发时机；缺少状态或召唤物专属技能时，同批新增 /statusTemplates/<id> 或 /skills/<id> 后引用`, metadata, index, label);
  }
  return rules;
}

export const damageAliases = new Map(Object.entries({ 物理: 'physical', 能量: 'energy', 精神: 'mental', 真实: 'true' }));
export const damageTypes = ['physical', 'energy', 'mental', 'true'];
export function skillCosts(value) {
  const cost = object(value) ? Object.entries(value).map(([k,v]) => `${k}: ${v}`).join(' ') : text(value);
  const slots = [...cost.matchAll(/(攻击|动作)\s*[:：]\s*(\d+)/g)];
  const resources = {};
  for (const [,n,key] of cost.matchAll(/(\d+)\s*(SP|MP|HP)\b/gi)) resources[key.toLowerCase()] = Number(n);
  return { ...resources, slot: slots[0]?.[1] === '动作' ? 'action' : 'attack', ap: /^(?:消耗\s*[:：]\s*)?(?:无|无消耗|none|0)$/i.test(cost.trim()) ? 0 : new Set(slots.map(s => s[1])).size === 2 ? 2 : 1 };
}
const damageOp = (damageType, amount) => ({ op: 'damage', target: 'target', damageType, amount });
const powerAmount = percent => percent === 100 ? 'event.power' : `event.power * (${percent} / 100)`;
export function damageTags(value, power) {
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
export function normalizeDice(raw) {
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

export function areaFields(raw, warnings, name) {
  const declaredRange = raw.range ?? raw.有效距离 ?? raw.距离;
  const tags = parseAreaTags([...(declaredRange != null ? [`有效距离: ${declaredRange}`] : []), ...(raw.范围 != null ? [raw.范围 === '单体' ? '单体' : `范围: ${raw.范围}`] : []), ...[].concat(raw.tags ?? raw.标签 ?? [])]);
  if (tags.missingRange) warnings.push(`「${name}」有效距离标签缺少格数`);
  if (tags.missingRadius && tags.radius == null && raw.radius == null) warnings.push(`「${name}」范围标签缺少半径格数`);
  const tier = DISTANCE_TABLE.find(row => row.name === tags.rangeTier);
  if (tier && (tags.range < tier.min || (tier.max != null && tags.range > tier.max))) {
    warnings.push(`「${name}」有效距离 ${tags.range} 格与「${tier.name}」的距离区间不符`);
  }
  const shape = raw.shape ?? tags.shape;
  const range = tags.range;
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
export const isAreaDamage = area => (area.shape != null && area.shape !== 'single') || area.target === 'cell';

export function geometryFields(area) {
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

export function ammoCounter(raw) {
  const field = ['currentAmmo', '当前弹药'].find(key => Number.isInteger(raw[key]) && raw[key] >= 0);
  if (field) return { current: bound(raw[field], 0, 1e9), initialRawValue: raw[field], path: [field], format: { kind: 'field_number' } };
  const key = raw.tags != null ? 'tags' : '标签';
  const tags = raw[key];
  for (const [index, value] of [].concat(tags ?? []).entries()) {
    const rawTag = text(value);
    const match = /(?<prefix>(?:^|[\[【])\s*)弹药(?<sep>\s*[:：]\s*)(?<current>\d+)(?:(?<slash>\s*[/／]\s*)(?<max>\d+))?(?=\s*(?:[\]】]|$))/u.exec(rawTag);
    if (!match) continue;
    const { prefix, sep, current, slash, max } = match.groups;
    return { current: bound(current, 0, 1e9), max: max == null ? null : bound(max, 0, 1e9), rawLabel: '弹药', initialRawValue: rawTag,
      path: Array.isArray(tags) ? [key, index] : [key],
      format: { kind: max == null ? 'tag_single' : 'tag_slash', sep, slash,
        prefix: rawTag.slice(0, match.index) + prefix,
        suffix: rawTag.slice(match.index + match[0].length) } };
  }
  return null;
}
export function attachAmmoPool(item, initial, cap = initial) {
  const { template } = item;
  if (initial == null || template.kind !== 'weapon' || !template.ranged) return;
  const declared = template.pools.ammo;
  template.pools.ammo = { ...declared, initial, cap: Math.max(declared?.cap ?? 0, cap, initial) };
}

export function* instructions(program) {
  for (const instruction of program) {
    if (instruction.enabled === false) continue;
    yield instruction;
    for (const key of ['then', 'else', 'body', 'onPass', 'onFail', 'onCollide']) {
      if (instruction[key]) yield* instructions(instruction[key]);
    }
  }
}

export function finalizeEquipment(item, warnings) {
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
    filter: `event.actorId == self.id && event.weaponTemplateId == '${templateId}' && event.actionType == 'attack' && event.weaponId == item.id && !event.infiniteAmmo`,
    program: [{ op: 'resource', target: 'self', pool: 'ammo', mode: 'sub', amount: 1, local: true, requireFull: true }],
  }], warnings);
}
export function normalizeEquipment(raw, slot, owner, key, sink) {
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
  const parsed = readCombatTags(r, kind, name, warnings);
  const template = { name: name.slice(0, 100), kind, rules, mods: parsed.mods, pools: readPools(r.pools, warnings), ...(qualityOf(r) ? { quality: qualityOf(r) } : {}), ...(rawTagValues(r).length ? { tags: rawTagValues(r).slice(0, 32) } : {}) };
  const { rangeValues, radius, shape, target } = parseAreaTags(r.tags ?? r.标签);
  let powerCovered = false;
  const onNarrativeWarning = (message, metadata, index, label) => {
    const rawRange = isWeapon && rangeValues.length > 1 ? rangeValues[index + 1] : null;
    const rangeNote = rawRange != null
      ? `。该装备主动效果的原始距离为 rawRange:${rawRange}${radius != null ? `、rawRadius:${radius}` : ''}${shape ? `、shape:${shape}` : ''}${target ? `、target:${target}` : ''}，请写到装备挂载的技能模板中` : '';
    const powerEffect = parsed.equipmentPower.length && (rawRange != null || /威力|主动|造成.{0,24}伤害/u.test(`${label} ${metadata.rawExcerpt}`));
    const powerNote = powerEffect ? `。装备标签「${parsed.equipmentPower.join('、')}」尚未落盘，请结合原词条裁定挂载技能的威力` : '';
    if (powerEffect) powerCovered = true;
    warnings.push(message + rangeNote + powerNote + parsed.suffix, metadata);
  };
  appendRules(rules, readEquipmentNarrative(r.effects ?? r.effectsList ?? r.效果, warnings, onNarrativeWarning), warnings);
  if (!powerCovered) for (const tag of parsed.equipmentPower) warnings.push(`「${name}」标签「${tag}」待标准化：装备没有主击威力面板，请结合描述裁定挂载主动技能`);
  const defense = bound(r.defense ?? r.防御 ?? parsed.fields.defense, 0, 1000000, kind === 'shield' ? 1 : 0);
  if (kind === 'shield') Object.assign(template, { weaponClass: 'shield', hand: 'off_hand', shield: true, defense });
  else if (isWeapon) {
    const area = areaFields(r, sink('field', `/equipment/${templateId}`), name);
    if (rangeValues.length > 1) { area.shape = 'single'; area.target = 'enemy'; area.radius = area.innerRadius = area.width = null; }
    const classes = ['ranged', 'light_blade', 'greatsword', 'staff', 'auxiliary'];
    const weaponClassAlias = new Map([['bow', 'ranged'], ['crossbow', 'ranged'], ['arcane', 'staff']]);
    const explicitClass = weaponClassAlias.get(r.weaponClass) ?? r.weaponClass;
    const tags = parsed.entries;
    const subtype = tags.find(tag => ['弓','弩','火枪','投掷武器'].includes(tag));
    const ranged = r.ranged ?? (r.rangeType ? r.rangeType === 'ranged' : Boolean(subtype));
    const twoHanded = slot === 'twoHands' || r.twoHanded === true || r.hand === 'two_handed' || explicitClass === 'greatsword'
      || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${labels}`);
    const weaponClass = classes.includes(explicitClass) ? explicitClass : ranged ? 'ranged' : twoHanded ? 'greatsword' : 'light_blade';
    Object.assign(template, {
      ...(r.weaponType || subtype ? { weaponType: r.weaponType || subtype } : {}),
      weaponClass, hand: twoHanded ? 'two_handed' : slot === 'offHand' ? 'off_hand' : 'one_handed',
      ranged: Boolean(ranged), rangeType: ranged ? 'ranged' : 'melee',
      ...(r.closeQuarters === true || tags.some(tag => /近战射击|贴身射击/u.test(tag)) ? { closeQuarters: true } : {}),
      range: bound(area.range, 0, 64, ranged ? 4 : 1), rawRange: area.range ?? (ranged ? 4 : 1),
      attack: bound(r.attack ?? r.攻击 ?? parsed.fields.attack, 0, 1e9), accuracy: bound(r.accuracy ?? r.命中 ?? parsed.fields.accuracy, -100, 100, 0),
      damage: normalizeDice(r.damage ?? { stat: 'str' }),
      ...geometryFields(area),
    });
    if (twoHanded) Object.assign(template, { twoHanded: true, heavy: r.heavy ?? !ranged });
  } else Object.assign(template, { defense, ...(own(r, 'armor') ? { armor: bound(r.armor, 0, 1000000, 0) } : {}) });
  const item = { id: idBase, templateId, template, slot, name };
  if (isWeapon && template.ranged) {
    const ammo = ammoCounter(r);
    if (ammo) attachAmmoPool(item, ammo.current, ammo.max ?? ammo.current);
  }
  return item;
}
