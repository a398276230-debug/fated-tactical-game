import { validFormula } from './formula.js';
const enumOf = (...values) => ({ enum: values });
const number = (minimum, maximum, type = 'number') => ({ type, minimum, maximum });
const integer = (min, max) => number(min, max, 'integer');
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items, maxItems, minItems = 1) => ({ type: 'array', items, minItems, maxItems });
const union = (...oneOf) => ({ oneOf });
const ref = name => ({ $ref: `#/$defs/${name}` });
const string = { type: 'string', minLength: 1, maxLength: 100 };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };
const fraction = number(0, 1), amount = number(0, 1e9), turns = integer(1, 100);
const damageType = enumOf('physical', 'energy', 'mental', 'true');
const scaling = { perLevel: number(0, 10), levelScaling: union(object({ perLevel: number(0, 10) }, ['perLevel']), object({ min: number(0, 10), max: number(0, 10) }, ['min', 'max'])),
  resourceScale: object({ resource: id, perUnit: number(0, 1e6), unitSize: number(1, 1e9) }, ['resource', 'perUnit']) };
const magnitudes = { amount, percent: fraction, percentOfDamageDealt: fraction, percentOfPrevious: fraction };
const target = enumOf('self', 'hitTarget', 'attacker', 'enemiesInRadius', 'alliesInRadius', 'corpse', 'killedUnit');
const stats = enumOf('str', 'agi', 'con', 'int', 'spi', 'accuracy', 'dodge', 'defense', 'initiative', 'armor', 'armorPierce', 'damageReduction', 'damageReductionFlat', 'damage', 'healing', 'skillPower');
const compare = enumOf('<', '<=', '=', '>=', '>');
const condition = (type, properties, required = Object.keys(properties)) => object({ type: { const: type }, ...properties }, ['type', ...required]);
const comparison = (type, value) => condition(type, { op: compare, value });
const tags = ['targetHasCategory','targetCreatureType','selfHasStatus','targetHasStatus','weaponType','skillSchool','actionType','damageType','hitRating','selfHasTag','targetHasTag'];
const bool = { type: 'boolean' };
// These JSON Schema descriptions also serve as the assistant's node reference.
const nodeNotes = {
  damage: '对目标造成一次伤害；仅此段不能致死时写 lethal:false，不要用降低伤害倍率代替。',
  heal: '恢复目标生命并触发治疗事件；要恢复法力或体力请用 restoreResource。',
  changeAltitude: '改变施术者离地高度，默认升高 3。delta 为有符号高度差，0 离地高度表示落地；land:true 可直接落地。保持到再次改变高度，适用于飞行和悬浮。',
  modifyTerrain: '改变区域内格子的高度：raise/lower 是相对变化，set 是绝对高度；不改变地面类型。',
  setTerrainKind: '把区域改为地面、墙或坡；造墙跳过已占用格，临时墙用 remainingTurns 设置时限。',
  addCover: '在可用格生成有耐久的掩体；要彻底阻断视线请改用墙。',
  restoreResource: '向目标资源池返还资源；支持按施放费用返还，并受禁止恢复效果限制。',
  drainResource: '从目标资源池扣费；必须付足才继续时用 requireFull。',
  produceResource: '产生指定资源；要定义装备实例计数器，在 passive/self 中声明 cap 和 initial。',
  grantStatus: '施加已有状态模板；statusId 是模板 ID 而非显示名，自定义状态要先建模板。',
  removeStatus: '解除状态，按 statusId 或 category 二选一；不能清除永久状态。',
  modifyStat: '调整属性数值；被动用于常驻修正，触发式用于有期限的修正。',
  modifyDamageBase: '被动：替换攻击起伤，不是额外造成一段伤害。',
  modifyCheck: '被动：给指定检定加值；要改变基础属性用 modifyStat。',
  forceOutcome: '被动：让带伤害的主击必定命中或暴击，不单独造成伤害。',
  upgradeHitTier: '被动：将已经命中的评级提升一档，不把未命中变成命中。',
  multiplyDamage: '调整伤害倍率；factor 是总系数，增伤 12% 写 1.12。',
  knockback: '将目标逐格推离施术者；遇阻时结算碰撞伤害和眩晕。',
  teleportBackstab: '移到目标背后的可用格进行背刺，不是任意坐标传送。',
  shield: '为目标添加限时护盾吸收伤害；stack 用于叠加现有盾量。',
  execute: '按剩余生命比例判断斩杀；strict 表示严格低于阈值，仍受保命规则限制。',
  summon: '克隆已有原型；templateId 指向 summonTemplates 或场上单位，statScale 缩放面板，不继承装备。没有原型用 spawnUnit。',
  spawnUnit: '无需原型，按 name 生成友方棋子；通常省略五维与资源，由施术者预算推算，tier 不高于施术者。skills 填 state.skills 的 ID，装备槽填 state.equipment 模板 ID（不是实例 ID），每只独立铸装。',
  raiseDead: '消耗未使用的尸体生成亡灵；无尸体的召唤不要用此节点。',
  addItem: '增加单位库存中的物品数量，不铸造或装备 state.items 实例。',
  chainEffect: '依次执行子节点；前一步没有生效就应停止时写 stopOnFailure:true。',
  procEffect: '通过 ref 调用已有表达式的 ID，仍需通过其触发门槛；禁止循环引用。',
};
// Only runtime operands, never persisted capacities, costs or template geometry.
export const formulaFields = {
  damage:['amount','flat','percent','percentOfDamageDealt','percentOfPrevious','percentOfTargetMaxHp','percentOfSelfMaxHp','percentOfPower','perLevel'],
  heal:['amount','percent','percentOfDamageDealt','percentOfPrevious','percentOfMaxHp','perLevel'],
  shield:['amount','percent','percentOfDamageDealt','percentOfPrevious','percentOfHealing','perLevel'],
  restoreResource:['amount','percent','percentOfPrevious','percentPerCost','perLevel'],
  drainResource:['amount','percent','percentOfPrevious','percentPerCost','perLevel'],
  produceResource:['amount','percent','perLevel'], multiplyDamage:['factor'],
  modifyStat:['flat','percent'], modifyDamageBase:['value'], execute:['threshold']
};
export const formulaBounds = new Map();
const node = (kind, properties, required = []) => {
  for (const key of formulaFields[kind] ?? []) {
    if (!properties[key]) continue;
    formulaBounds.set(`${kind}.${key}`, properties[key]);
    properties[key] = union(properties[key], ref('formula'));
  }
  if (!Object.hasOwn(nodeNotes, kind) || !nodeNotes[kind].trim()) throw new Error(`DSL 节点 ${kind} 缺少用法说明`);
  return { ...object({ kind: { const: kind }, enabled: { ...bool, default: true }, label: string, target, condition: ref('condition'), radius: number(0, 15), ...properties }, ['kind', ...required]), description: nodeNotes[kind] };
};
const coord = integer(0, 9);
const point = object({x: coord, y: coord}, ['x','y']);
const anchor = enumOf('self','hitTarget');
const terrainDuration = {area: ref('terrainArea'), remainingTurns: turns, persistent: bool};
const resource = { resource: id, ...magnitudes, ...scaling };
const attribute = enumOf('str','agi','con','int','spi');
const events = ['on_attack','on_hit','on_damaged','on_kill','on_death','on_turn_start','on_turn_end','on_skill_cast','on_equip','on_heal','on_ally_death'];
const expireRule = union(
  object({ trigger: enumOf('on_damaged'), damageType: enumOf('any','direct','indirect'), exceptSource: enumOf('self') }, ['trigger']),
  object({ trigger: enumOf('on_struck', ...events.filter(event => event !== 'on_damaged')), exceptSource: enumOf('self') }, ['trigger']),
);
const checkKeys = ['iniBonus','dodgeBonus','stealthBonus','accuracyBonus','initiativeAgility','dodgeAgility','coreBonus','highGroundRange','highGroundAccuracy','advantage'];
const modifiers = { type: 'object', additionalProperties: union(number(-1e9, 1e9), string, { type: 'boolean' }) };
export const effectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Fated Tactical Game effect expression', $ref: '#/$defs/expression',
  $defs: {
    terrainArea: union(object({cells:array(point,100)}, ['cells']),
      object({rect:object({x1:coord,y1:coord,x2:coord,y2:coord}, ['x1','y1','x2','y2'])}, ['rect']),
      object({center:union(point,anchor),radius:number(0,15),follow:{const:false}}, ['center','radius']),
      object({center:anchor,radius:number(0,15),follow:{const:true}}, ['center','radius','follow'])),
    saveDC: union(integer(1, 50), object({ base: number(-1e9, 1e9),
      scaleBy: object({ stat: attribute, perUnit: number(-1e9, 1e9) }, ['stat','perUnit']),
      min: number(1, 1e9), max: number(1, 1e9) }, ['base','scaleBy'])),
    formula: {type:'string', minLength:1, maxLength:200, format:'combat-formula'},
    expireOn: union(expireRule, array(expireRule, 12)),
    condition: union(array(ref('condition'), 12), ...['and','or','not'].map(type => condition(type, { conditions: array(ref('condition'), type === 'not' ? 1 : 12) })),
      condition('compare', { left:union(number(-1e9,1e9),ref('formula')), op:compare, right:union(number(-1e9,1e9),ref('formula')) }),
      ...['selfHp','targetHp'].map(type => comparison(type, fraction)), comparison('distance', number(0, 20)), comparison('targetLevel', enumOf('self')),
      ...tags.map(type => condition(type, { value: string })), condition('timeOfDay', { value: enumOf('dawn','day','dusk','night') }),
      ...['duel','usesLeft','intercepting','melee','arrow','backstab','critical','opportunityAttack','saved','enemy','reaction','highGround'].map(type => condition(type, { value: { type: 'boolean' } }, [])),
      condition('selfStatusModifier', { key: string, value: bool }),
      condition('resourceAtLeast', { resource: id, amount })),
    expression: object({ id, label: string, trigger: enumOf('passive', ...events, 'active'),
      condition: ref('condition'), roll: union(object({ dice: { const: 'd20' }, gte: integer(1, 20) }, ['dice','gte']), object({ chance: fraction }, ['chance']),
        object({ save: union(attribute, array(attribute, 5, 2)), dc: ref('saveDC'), mode: enumOf('all','any'), chance: fraction }, ['save','dc']),
        object({ contest: object({ attacker: attribute, defender: attribute, dc: ref('saveDC') }, ['attacker','defender','dc']), chance: fraction }, ['contest'])), target,
      effects: array(ref('node'), 12), params: object({ ...scaling, radius: number(0, 15), turns, stacks: integer(1, 10), amount, percent: fraction,
        usesPerBattle: union(integer(1, 10000), { type: 'null' }), cooldown: turns, ap: integer(0, 2), mp: integer(0, 25000), sp: integer(0, 25000),
        slot: enumOf('attack','action'), range: integer(0, 15), source: enumOf('weapon') }) }, ['id','trigger','target','effects']),
    node: union(
      node('damage', { ...magnitudes, ...scaling, lethal: { ...bool, default: true }, resourceMultiplier: id, percentOfTargetMaxHp: fraction, percentOfSelfMaxHp: fraction, percentOfPower: number(0, 10), damageType, ignoreArmor: { type: 'boolean' }, excludeHitTarget: bool, flat: amount, strikeBonus: bool, inheritDamageType: bool }),
      node('modifyTerrain', { ...terrainDuration, terrain:enumOf('raise','lower'), amount:integer(0,12) }, ['area','terrain','amount']),
      node('modifyTerrain', { ...terrainDuration, terrain:enumOf('set'), amount:integer(-4,8) }, ['area','terrain','amount']),
      node('setTerrainKind', { ...terrainDuration, terrainKind:enumOf('floor','wall','slope') }, ['area','terrainKind']),
      node('addCover', { ...terrainDuration, hp:integer(1,1e9) }, ['area','hp']),
      node('heal', { ...magnitudes, ...scaling, percentOfMaxHp: fraction }),
      ...['restoreResource','drainResource','produceResource'].map(kind => node(kind, { ...resource, minimumRemaining: amount, requireFull: bool, local: bool, ...(kind === 'produceResource' ? { cap: integer(1, 1000000000), initial: integer(0, 1000000000), reloadable: bool, targetTierBase: integer(1, 8) } : {}), percentPerCost: fraction }, ['resource'])),
      node('grantStatus', { statusId: id, turns, stacks: integer(1, 10), modifiers, amount, expireOn: ref('expireOn'), durationType: enumOf('battle_turns','until_removed','persistent') }, ['statusId']), node('removeStatus', { statusId: id, category: enumOf('all_negative','buff','debuff','control','dot','hot','shield') }),
      node('modifyStat', { stat: stats, flat: number(-1e9, 1e9), percent: number(-1, 10), duration: turns, damageType, levelScaling: scaling.levelScaling }, ['stat']),
      node('modifyDamageBase', { value: amount, ignoreAttributes: bool, unscaled: bool, damageType }, ['value']),
      node('modifyCheck', Object.fromEntries(checkKeys.map(key => [key, number(-30, 30)]))),
      node('forceOutcome', { mode: enumOf('hit','crit') }, ['mode']), node('upgradeHitTier', {}),
      node('changeAltitude', { delta: integer(-12,12), land: {type:'boolean'} }),
      node('knockback', { distance: integer(1, 5), collisionDamage: integer(0, 80) }),
      node('teleportBackstab', { bonusMultiplier: number(0, 4) }),
      node('shield', { ...magnitudes, ...scaling, turns, stack: bool, percentOfHealing: number(0, 4) }),
      node('spawnUnit', { name:string, count:integer(1,10), tier:integer(1,7), attribute,
        stats:object(Object.fromEntries(attribute.enum.map(k=>[k,integer(0,20)])),attribute.enum),
        maxHp:integer(1,1e9), maxMp:integer(0,1e9), maxSp:integer(0,1e9), armor:integer(0,1e6), size:integer(1,5),
        bodyLengthM:number(.01,1e9), mc:integer(1,64), move:integer(1,10), skills:array(id,32,0), gear:array(id,12,0),
        ...Object.fromEntries(['mainHand','offHand','shield'].map(k=>[k,union(id,{type:'null'})])) }, ['name']),
      node('summon', { templateId: id, statScale: number(.01, 1), count: integer(1, 10) }, ['templateId']),
      node('raiseDead', { statScale: number(.01, 1) }), node('addItem', { itemId: id, count: integer(1, 10000) }, ['itemId']),
      node('execute', { threshold: fraction, strict: bool, requiresPool: id }, ['threshold']),
      node('multiplyDamage', { factor: number(0, 10), damageType, additive: bool, resourceScale: scaling.resourceScale, local: bool }),
      node('chainEffect', { effects: array(ref('node'), 12), stopOnFailure: bool }, ['effects']), node('procEffect', { ref: id }, ['ref']))
  }
};

function matches(value, schema, depth = 0) {
  if (depth > 24) return false;
  const next = (v, s) => matches(v, s, depth + 1);
  if (schema.$ref) return next(value, effectSchema.$defs[schema.$ref.split('/').at(-1)]);
  if (schema.oneOf) return schema.oneOf.filter(s => next(value, s)).length === 1;
  if (Object.hasOwn(schema, 'const')) return value === schema.const;
  if (schema.enum) return schema.enum.includes(value);
  switch (schema.type) {
    case 'object': return value && Object.getPrototypeOf(value) === Object.prototype
      && schema.required?.every(key => Object.hasOwn(value, key)) !== false
      && Object.entries(value).every(([key, item]) => !Object.hasOwn(Object.prototype, key) && key !== 'prototype'
        && (Object.hasOwn(schema.properties ?? {}, key) ? next(item, schema.properties[key])
          : schema.additionalProperties && next(item, schema.additionalProperties)));
    case 'array': return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems
      && Array.from(value).every(item => next(item, schema.items));
    case 'string': if (schema.format === 'combat-formula') return validFormula(value);
      return typeof value === 'string' && value.trim().length >= (schema.minLength ?? 1)
      && value.length <= (schema.maxLength ?? 100) && (!schema.pattern || (new RegExp(schema.pattern).test(value) && !Object.hasOwn(Object.prototype, value) && value !== 'prototype'));
    case 'integer': if (!Number.isInteger(value)) return false;
    // fall through
    case 'number': return Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
    case 'null': return value === null;
    default: return typeof value === schema.type;
  }
}

export const isExpression = effect => effect != null && Object.hasOwn(effect, 'trigger');
const orderedDC = dc => (dc?.min ?? 1) <= (dc?.max ?? 50);
export const validSaveDC = dc => matches(dc, effectSchema.$defs.saveDC) && orderedDC(dc);
export const validExpireOn = value => matches(value, effectSchema.$defs.expireOn);
export const terrainKinds = ['modifyTerrain','setTerrainKind','addCover'];
export const validTerrainNode = node => terrainKinds.includes(node?.kind) && matches(node, effectSchema.$defs.node);
export const validExpression = effect => matches(effect, effectSchema.$defs.expression)
  && orderedDC(effect.roll?.contest?.dc ?? effect.roll?.dc);
export const effectNodes = function* (nodes, enabledOnly = false) {
  for (const node of nodes) {
    if (enabledOnly && node.enabled === false) continue;
    yield node;
    if (node.kind === 'chainEffect') yield* effectNodes(node.effects, enabledOnly);
  }
};
