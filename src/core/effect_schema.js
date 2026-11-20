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
const node = (kind, properties, required = []) => object({ kind: { const: kind }, enabled: { ...bool, default: true }, label: string, target, condition: ref('condition'), radius: number(0, 15), ...properties }, ['kind', ...required]);
const resource = { resource: id, ...magnitudes, ...scaling };
const attribute = enumOf('str','agi','con','int','spi');
const events = ['on_attack','on_hit','on_damaged','on_kill','on_death','on_turn_start','on_turn_end','on_skill_cast','on_equip','on_heal','on_ally_death'];
const expireRule = union(
  object({ trigger: enumOf('on_damaged'), damageType: enumOf('any','direct','indirect'), exceptSource: enumOf('self') }, ['trigger']),
  object({ trigger: enumOf(...events.filter(event => event !== 'on_damaged')), exceptSource: enumOf('self') }, ['trigger']),
);
const checkKeys = ['iniBonus','dodgeBonus','stealthBonus','accuracyBonus','initiativeAgility','dodgeAgility','coreBonus','highGroundRange','highGroundAccuracy','advantage'];
const modifiers = { type: 'object', additionalProperties: union(number(-1e9, 1e9), string, { type: 'boolean' }) };
export const effectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Fated Tactical Game effect expression', $ref: '#/$defs/expression',
  $defs: {
    saveDC: union(integer(1, 50), object({ base: number(-1e9, 1e9),
      scaleBy: object({ stat: attribute, perUnit: number(-1e9, 1e9) }, ['stat','perUnit']),
      min: number(1, 1e9), max: number(1, 1e9) }, ['base','scaleBy'])),
    expireOn: union(expireRule, array(expireRule, 12)),
    condition: union(array(ref('condition'), 12), ...['and','or','not'].map(type => condition(type, { conditions: array(ref('condition'), type === 'not' ? 1 : 12) })),
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
      node('heal', { ...magnitudes, ...scaling, percentOfMaxHp: fraction }),
      ...['restoreResource','drainResource','produceResource'].map(kind => node(kind, { ...resource, minimumRemaining: amount, requireFull: bool, local: bool, ...(kind === 'produceResource' ? { cap: integer(1, 1000000000), initial: integer(0, 1000000000), reloadable: bool, targetTierBase: integer(1, 8) } : {}), percentPerCost: fraction }, ['resource'])),
      node('grantStatus', { statusId: id, turns, stacks: integer(1, 10), modifiers, amount, expireOn: ref('expireOn'), durationType: enumOf('battle_turns','until_removed','persistent') }, ['statusId']), node('removeStatus', { statusId: id, category: enumOf('all_negative','buff','debuff','control','dot','hot') }),
      node('modifyStat', { stat: stats, flat: number(-1e9, 1e9), percent: number(-1, 10), duration: turns, damageType, levelScaling: scaling.levelScaling }, ['stat']),
      node('modifyDamageBase', { value: amount, ignoreAttributes: bool, unscaled: bool, damageType }, ['value']),
      node('modifyCheck', Object.fromEntries(checkKeys.map(key => [key, number(-30, 30)]))),
      node('forceOutcome', { mode: enumOf('hit','crit') }, ['mode']), node('upgradeHitTier', {}),
      node('knockback', { distance: integer(1, 5), collisionDamage: integer(0, 80) }),
      node('teleportBackstab', { bonusMultiplier: number(0, 4) }),
      node('shield', { ...magnitudes, ...scaling, turns, stack: bool, percentOfHealing: number(0, 4) }),
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
    case 'string': return typeof value === 'string' && value.trim().length >= (schema.minLength ?? 1)
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
export const validExpression = effect => matches(effect, effectSchema.$defs.expression)
  && orderedDC(effect.roll?.contest?.dc ?? effect.roll?.dc);
export const effectNodes = function* (nodes, enabledOnly = false) {
  for (const node of nodes) {
    if (enabledOnly && node.enabled === false) continue;
    yield node;
    if (node.kind === 'chainEffect') yield* effectNodes(node.effects, enabledOnly);
  }
};
