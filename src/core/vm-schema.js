import { STATUSES } from '../presets/status-defaults.js';
import { validExpr } from './formula.js';

const enumOf = (...values) => ({ enum: values });
const ref = name => ({ $ref: `#/$defs/${name}` });
const either = (...anyOf) => ({ anyOf });
const variants = (...oneOf) => ({ oneOf });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const list = (items, minItems = 0) => ({ type: 'array', items, minItems });
const needs = (...required) => ({ required });
const when = (field, condition, then) => ({ if: { properties: { [field]: condition }, required: [field] }, then });
const withRules = (schema, ...allOf) => ({ ...schema, allOf });
const literal = value => ({ const: value });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, ...(maximum === undefined ? {} : { maximum }) });
const number = { type: 'number' };
const bool = { type: 'boolean' };
const text = { type: 'string', pattern: '\\S' };
const reserved = [...Object.getOwnPropertyNames(Object.prototype), 'prototype'];
const idPattern = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const id = { type: 'string', pattern: `^${idPattern}$`, not: enumOf(...reserved) };
const variable = { type: 'string', pattern: `^vars\\.${idPattern}$`, not: enumOf(...reserved.map(key => `vars.${key}`)) };
const tag = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' };
const statusId = { ...id, format: 'tactical-status-id' };
const formula = { ...text, format: 'tactical-expr' };
const expr = ref('expr');
const numericExpr = either(number, formula);
const booleanExpr = either(bool, formula);
const entityId = either(id, variable);
const damageType = enumOf('physical', 'energy', 'mental', 'true');
const attribute = enumOf('str', 'agi', 'con', 'int', 'spi');
const slot = enumOf('attack', 'action', 'move', 'cast', 'reaction', 'fly', 'teleport');
const point2 = object({ x: number, y: number }, ['x', 'y']);
const point = object({ x: number, y: number, z: number }, ['x', 'y']);
const scopes = ['self', 'source', 'target', 'attacker'];
const pointRef = either(point, enumOf(...scopes, 'center'), variable);
const selector = ref('selector');
const target = ref('targetRef');
const program = ref('program');
const chooseOptions = list(object({ id, label: text }, ['id', 'label']), 1);
const mapOf = (key, value) => ({ type: 'object', propertyNames: key, additionalProperties: value });

const eventPatchFields = {
  before_action: { cancel: booleanExpr, consumeCostOnCancel: booleanExpr, costScale: numericExpr, origin: pointRef, ignoreLOS: booleanExpr },
  before_target: { cancel: booleanExpr, redirectTarget: entityId, replaceTarget: object({ from: entityId, to: entityId }, ['from', 'to']), skipColossusArea: booleanExpr, damageScale: numericExpr },
  before_check: { dcDelta: numericExpr, bonusDelta: numericExpr, advantageDelta: numericExpr, ignoreDodge: booleanExpr, minRating: text, forceOutcome: enumOf('pass', 'fail', 'hit', 'miss', 'crit') },
  before_commit: { cancel: booleanExpr, finalAmount: numericExpr, preserveLife: booleanExpr },
  before_status: { cancel: booleanExpr },
  on_lethal_p2: { preventDeath: booleanExpr },
};
export const vmHooks = Object.freeze([
  'active', 'before_action', 'before_target', 'before_check', 'after_check', 'before_commit', 'before_status',
  'on_lethal_p1', 'on_lethal_p2', 'after_action', 'after_hit', 'after_damage', 'after_heal',
  'after_status_applied', 'after_status_removed', 'on_status_immunized', 'on_summon_evict',
  'on_death', 'on_ally_death', 'on_kill', 'turn_start', 'turn_end', 'round_start', 'round_end',
]);
const hook = enumOf(...vmHooks);
const patchSchemas = Object.fromEntries(Object.entries(eventPatchFields).map(([name, fields]) => [
  name, { ...object(fields), minProperties: 1 },
]));

export const opNotes = Object.freeze({
  let: 'name 写裸名称（如 bonus），读取写 vars.bonus。默认写当前帧，scope:owner 写规则宿主（用 self.vars.bonus 或对应载体变量读取）。',
  if: '按 cond 选择 then 或 else 指令序列。未提供 else 时为假即跳过。',
  for_each: '对 Selector 的结果快照逐项执行 body。bind 写裸名称，如 victim；body 内通过 vars.victim 选实体、vars.victim.hp 读字段。省略 bind 时，遍历单位的子帧 target 是当前单位。',
  check: '走统一检定和随机数管线，按结果进入 onPass 或 onFail；out 写裸名称；后续通过 vars.<名称> 读取。',
  ask: '向 chooser 请求选择，玩家可挂起结算，AI 或预览按 aiPolicy 自动选择。选格和选实体用 select，选项用 options，数值用 min/max。entity 的 maxSelect 开启多选，将 ID 数组写入 out，for_each 以 {from:"vars.<名称>"} 遍历。out 写裸名称，单选实体可用 vars.<名称> 作目标。',
  damage: '走完整伤害和致死管线，out 记录实际扣血量，写裸名称、读 vars.<名称>。裸扣资源使用 resource。',
  heal: '仅治疗存活且允许受疗的单位，经过治疗倍率与落盘拦截。恢复其他池使用 resource。',
  resource: '直接改资源池并经过落盘拦截。pool 可写 hp/mp/sp 或伪池 attack/action/move：前两者表示本回合未用槽位，move 表示剩余移动格；mode 用 add/sub/set。add_max/sub_max/set_max 改 HP/MP/SP 上限并同步镜像，minRemain 可限制最低上限；swap 使用单个 pool 和 otherPool。',
  link_pool: '用 units 选择单位，将指定的 HP/MP/SP 池合并共享或拆回独立池。',
  apply_status: '施加已注册的状态模板，vars 求值后存入状态。护盾使用 shield 状态与 shieldAmount 变量。flags:["undispellable"] 的状态不能被 dispelled 或 cleansed，只能自然 expired。',
  remove_status: '在目标持有的状态中用 where 筛选可移除项。outCount 写裸名称（如 lostStacks），后续读 vars.lostStacks，表示成功移除的数量。',
  mutate_event: '仅在有可写字段的拦截钩子改写当前事件。patch 的键必须属于当前 Rule.hook。',
  move: '统一移动、瞬移、推拉与高度变化。push/pull 逐格判碰撞，altitude 可用 deltaZ 或 land。',
  spawn: '按 entityKind 提供对应的 spec 生成单位、结界、地形、掩体或库存物品；at 指定落点。',
  despawn: '用 select 清除指定的 zone、cover、terrain 或 unit；unit 通常配 where: "candidate.summoned == true" 只移除召唤物，不触发死亡/亡语。筛选敌方区域时用 candidate.team != null && candidate.team != self.team；terrain 只清除 VM 生成的地形层。',
  revive: '只对未被 blockRevive 禁止的阵亡单位生效；hpPercent/mpPercent/spPercent 以 1 为满额。',
  perform: '压入独立子动作；skill 用技能 ID 或 vars.<名称>，replay 用 tapeRecord 引用磁带记录。overrides.origin 可改生效原点；跨距离或阻隔需显式设置 ignoreRange 或 ignoreLOS。',
});
function opcode(op, properties, required, ...conditions) {
  if (!Object.hasOwn(opNotes, op) || !opNotes[op].trim()) throw new Error(`VM 指令 ${op} 缺少用法说明`);
  const schema = { ...object({ op: literal(op), enabled: { ...bool, default: true }, label: text, ...properties }, ['op', ...required]), description: opNotes[op] };
  return conditions.length ? withRules(schema, ...conditions) : schema;
}

const controlPolicy = object({
  controller: enumOf('default', 'ai'), allegiance: enumOf('normal', 'friendly_only', 'all_hostile'),
  forcedActionKinds: list(enumOf('attack', 'skill')), allowFriendlyTarget: bool, moraleLock: literal('steady'),
});
const stat = enumOf(...attribute.enum, 'armor', 'armorPierce', 'armorPiercePercent', 'damageMult', 'finalDamageMult',
  'damageFlat', 'damageReduction', 'damageReductionFlat', 'dr', 'healingMult', 'incomingHealMult', 'costMult',
  'checkBonus', 'dcBonus', 'resistBonus', 'dodge', 'advantage', 'initiativeFlat');
const ratioStats = enumOf('damageReduction', 'dr', 'armorPiercePercent');
const multiplierStats = enumOf('damageMult', 'finalDamageMult', 'healingMult', 'incomingHealMult', 'costMult');
const ratioFlat = either({ ...number, minimum: -1, maximum: 1 }, formula);
const statMod = withRules(object({
  stat, flat: numericExpr, mult: numericExpr, additivePercent: numericExpr, damageType, checkKind: text, statusId: id,
  locks: list(slot, 1), flags: list(enumOf('preserveLife', 'blockRevive', 'blockResourceRestore', 'untargetableSingle', 'harmless'), 1),
  controlPolicy, when: booleanExpr,
}), either(needs('stat'), needs('locks'), needs('flags'), needs('controlPolicy')),
when('flat', {}, needs('stat')), when('mult', {}, needs('stat')), when('additivePercent', {}, needs('stat')),
when('stat', ratioStats, { properties: { flat: ratioFlat }, not: needs('additivePercent') }),
when('stat', multiplierStats, { not: needs('flat') }));
const overrides = object({ free: bool, ignoreSlots: bool, ignoreRange: bool, ignoreLOS: bool, intent: text, charged: bool, scale: numericExpr, origin: pointRef });
const expireRule = object({ hook, filter: booleanExpr }, ['hook']);
const area = object({
  shape: enumOf('single', 'circle', 'ring', 'fan', 'cone', 'line', 'rect'),
  origin: pointRef,
  radius: { type: 'number', minimum: 0 }, innerRadius: { type: 'number', minimum: 0 },
  width: { type: 'number', minimum: 0 }, angle: { type: 'number', minimum: 0 },
}, ['shape']);
const spawnTier = either(integer(1, 7), formula);
const spawnTurns = either(integer(1, 100), formula);
const spawnRadius = either({ type: 'number', minimum: 0 }, formula);
const spawnArea = { ...area, properties: { ...area.properties, radius: spawnRadius } };
const zoneArea = withRules(object({
  shape: enumOf('single', 'circle', 'ring', 'rect', 'cells', 'board'), anchorUnitId: entityId, center: pointRef,
  radius: spawnRadius, innerRadius: { type: 'number', minimum: 0 },
  rect: object({ x1: number, y1: number, x2: number, y2: number }, ['x1', 'y1', 'x2', 'y2']), cells: list(point2, 1),
}, ['shape']), when('shape', literal('rect'), needs('rect')), when('shape', literal('cells'), needs('cells')));
const carrier = { name: text, tags: list(tag), tier: integer(1, 7), vars: mapOf(id, expr), flags: list(enumOf('undispellable'), 1), mods: list(ref('statMod')), rules: list(ref('rule')) };
const spawnSpecs = {
  unit: withRules(object({
    ...carrier, tier: spawnTier, templateId: id, copyOf: target, count: either(integer(1, 10), formula),
    spawnPanel: object({
      attribute, tier: spawnTier, stats: object(Object.fromEntries(attribute.enum.map(name => [name, integer(0, 20)])), attribute.enum),
      maxHp: integer(1), maxMp: integer(0), maxSp: integer(0), armor: integer(0), size: integer(1, 5),
      bodyLengthM: { type: 'number', exclusiveMinimum: 0 }, mc: integer(1), move: integer(0),
      skills: list(id), gear: list(id), mainHand: id, offHand: id, shield: id,
    }),
  }), variants(needs('templateId'), needs('copyOf'), needs('spawnPanel'), { not: either(needs('templateId'), needs('copyOf'), needs('spawnPanel')) })),
  zone: object({ ...carrier, tier: spawnTier, templateId: id, area: zoneArea, follow: bool, remainingTurns: spawnTurns, persistent: bool }, ['area']),
  terrain: withRules(object({ kind: enumOf('floor', 'wall', 'slope'), height: number, mode: enumOf('set', 'raise', 'lower'), area: spawnArea, remainingTurns: spawnTurns, persistent: bool }), either(needs('kind'), needs('height')), when('mode', {}, needs('height'))),
  cover: object({ name: text, hp: integer(1), cover: integer(0, 12), material: text, area: spawnArea, remainingTurns: spawnTurns, persistent: bool }),
  item: object({ templateId: id, count: either(integer(1), formula) }, ['templateId']),
};

const opcodeSchemas = [
  opcode('let', { name: id, value: expr, scope: enumOf('frame', 'owner') }, ['name', 'value']),
  opcode('if', { cond: booleanExpr, then: program, else: program }, ['cond', 'then']),
  opcode('for_each', { select: selector, bind: id, body: program }, ['select', 'body']),
  opcode('check', { kind: enumOf('save', 'contest', 'd20', 'chance', 'attack'), stat: either(attribute, list(attribute, 1)), defenderStat: attribute,
    dc: numericExpr, mode: enumOf('all', 'any'), statusId, tags: list(tag), onPass: program, onFail: program, out: id }, ['kind']),
  opcode('ask', { chooser: target, kind: enumOf('cell', 'entity', 'option', 'number'), prompt: text, out: id,
    aiPolicy: enumOf('max', 'min', 'best_offensive_cell', 'safest_cell', 'highest_threat', 'first'), select: selector,
    options: chooseOptions, min: numericExpr, max: numericExpr, maxSelect: integer(1, 200) }, ['chooser', 'kind', 'prompt', 'out', 'aiPolicy'],
  when('maxSelect', {}, { properties: { kind: literal('entity') } }),
  when('kind', enumOf('cell', 'entity'), withRules(needs('select'), { not: either(needs('options'), needs('min'), needs('max')) })),
  when('kind', literal('option'), withRules(needs('options'), { not: either(needs('select'), needs('min'), needs('max')) })),
  when('kind', literal('number'), withRules(needs('min', 'max'), { not: either(needs('options'), needs('select')) }))),
  opcode('damage', { target, amount: numericExpr, damageType, ignoreArmor: bool, lethal: bool, direct: bool, out: id }, ['target', 'amount', 'damageType']),
  opcode('heal', { target, amount: numericExpr, out: id }, ['target', 'amount']),
  opcode('resource', { target, pool: either(id, list(id, 1)), mode: enumOf('add', 'sub', 'set', 'swap', 'add_max', 'sub_max', 'set_max'), amount: numericExpr, otherPool: id,
    local: bool, minRemain: numericExpr, requireFull: bool, out: id }, ['target', 'pool', 'mode'],
  when('mode', literal('swap'), withRules({ ...needs('otherPool'), properties: { pool: id } }, { not: needs('amount') })),
  when('mode', enumOf('add', 'sub', 'set', 'add_max', 'sub_max', 'set_max'), { ...needs('amount'), not: needs('otherPool') })),
  opcode('link_pool', { units: selector, pools: list(enumOf('hp', 'mp', 'sp'), 1), mode: enumOf('link', 'unlink') }, ['units', 'pools', 'mode']),
  opcode('apply_status', { target, statusId, turns: numericExpr, stacks: numericExpr, stackMode: enumOf('refresh', 'stack', 'replace', 'extend'),
    extendTurns: numericExpr, vars: mapOf(id, expr), expireOn: ref('expireRule') }, ['target', 'statusId']),
  opcode('remove_status', { target, where: booleanExpr, reason: enumOf('dispelled', 'cleansed', 'expired'), outCount: id }, ['target', 'where']),
  opcode('mutate_event', { patch: either(...Object.keys(patchSchemas).map(name => ref(`patch_${name}`))) }, ['patch']),
  opcode('move', { target, mode: enumOf('teleport', 'step', 'push', 'pull', 'altitude'),
    to: pointRef, distance: numericExpr, deltaZ: numericExpr, land: bool, collisionDamage: numericExpr, onCollide: program }, ['target', 'mode']),
  opcode('spawn', { entityKind: enumOf(...Object.keys(spawnSpecs)), spec: { type: 'object' }, at: pointRef, out: id }, ['entityKind', 'spec'],
  ...Object.keys(spawnSpecs).map(kind => when('entityKind', literal(kind), { properties: { spec: ref(`spawn_${kind}`) } }))),
  opcode('despawn', { entityKind: enumOf('zone', 'cover', 'terrain', 'unit'), select: selector }, ['entityKind', 'select']),
  opcode('revive', { target, hpPercent: numericExpr, mpPercent: numericExpr, spPercent: numericExpr, hpFlat: numericExpr }, ['target']),
  opcode('perform', { actor: target, actionKind: enumOf('skill', 'attack', 'replay'), skillId: entityId, tapeRecord: variable, target, overrides }, ['actor', 'actionKind'],
  when('actionKind', literal('skill'), { ...needs('skillId'), not: needs('tapeRecord') }),
  when('actionKind', literal('replay'), { ...needs('tapeRecord'), not: needs('skillId') }),
  when('actionKind', literal('attack'), { not: either(needs('skillId'), needs('tapeRecord')) })),
];
export const vmOpcodes = Object.freeze(opcodeSchemas.map(schema => schema.properties.op.const));

// Walk only instruction branches. Rules declared on spawned entities start their own hook context.
const instructionBranches = ['then', 'else', 'body', 'onPass', 'onFail', 'onCollide'];
const guardedHooks = [...Object.keys(patchSchemas), 'readOnly'];
const hookGuard = name => ref(`opcodeGuard_${name}`);
const guardedProgram = name => list(hookGuard(name));
const defs = {
  expr: either(number, bool, formula),
  tag,
  selector: withRules(object({
    from: either(enumOf(...scopes, 'units', 'statuses', 'zones', 'covers', 'terrain', 'cells', 'tape'), variable), of: enumOf(...scopes),
    area, where: booleanExpr, pick: variants(literal('all'), ...['first', 'random', 'nearest'].map(key => object({ [key]: integer(1) }, [key]))),
  }, ['from']), when('of', {}, { properties: { from: literal('statuses') } })),
  targetRef: either(enumOf(...scopes), variable, selector),
  expireRule,
  statMod,
  controlPolicy,
  ...Object.fromEntries(Object.entries(patchSchemas).map(([name, schema]) => [`patch_${name}`, schema])),
  ...Object.fromEntries(Object.entries(spawnSpecs).map(([name, schema]) => [`spawn_${name}`, schema])),
  ...Object.fromEntries(guardedHooks.map(name => {
    const properties = Object.fromEntries(instructionBranches.map(branch => [branch, guardedProgram(name)]));
    return [`opcodeGuard_${name}`, name === 'readOnly'
      ? { properties, not: needs('patch') }
      : { properties: { ...properties, patch: ref(`patch_${name}`) } }];
  })),
  opcode: variants(...opcodeSchemas),
  program: list(ref('opcode')),
  rule: withRules(object({ id, hook, program, label: text, enabled: { ...bool, default: true },
    priority: { type: 'integer' }, dedupeKey: text, usesPerBattle: integer(1), usesPerTurn: integer(1), cooldownTurns: integer(1, 100), filter: booleanExpr }, ['id', 'hook', 'program']),
  ...Object.keys(patchSchemas).map(name => when('hook', literal(name), { properties: { program: guardedProgram(name) } })),
  when('hook', { not: enumOf(...Object.keys(patchSchemas)) }, { properties: { program: guardedProgram('readOnly') } })),
};

const root = (title, name) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', title, ...ref(name), $defs: defs });
export const vmSchema = root('Fated Tactical VM Rule', 'rule');
export const vmOpcodeSchema = root('Fated Tactical VM Opcode', 'opcode');
export const vmProgramSchema = root('Fated Tactical VM Program', 'program');
export const vmSelectorSchema = root('Fated Tactical VM Selector', 'selector');
export const vmStatModSchema = root('Fated Tactical VM StatMod', 'statMod');

// Interpret the same definitions in the runtime. External validators can register the two custom formats.
function matches(value, schema, context, depth = 0) {
  if (depth > 512) return false;
  const next = (item, rule) => matches(item, rule, context, depth + 1);
  if (schema.$ref && !next(value, defs[schema.$ref.split('/').at(-1)])) return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.not && next(value, schema.not)) return false;
  if (schema.anyOf && !schema.anyOf.some(rule => next(value, rule))) return false;
  if (schema.oneOf && schema.oneOf.filter(rule => next(value, rule)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every(rule => next(value, rule))) return false;
  if (schema.if && next(value, schema.if) && !next(value, schema.then)) return false;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number' || schema.type === 'integer') {
    return Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value))
      && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum)
      && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum);
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))) return false;
    if (schema.format === 'tactical-expr') return validExpr(value);
    if (schema.format === 'tactical-status-id') return Object.hasOwn(STATUSES, value) || Object.hasOwn(context.statusTemplates ?? {}, value);
    return true;
  }
  if (schema.type === 'array') {
    return Array.isArray(value) && value.length >= schema.minItems && Array.from(value).every(item => next(item, schema.items));
  }
  const plainObject = value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
  if (schema.type === 'object' && !plainObject) return false;
  if (plainObject) {
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
    const entries = Object.entries(value);
    if (entries.length < (schema.minProperties ?? 0)) return false;
    return entries.every(([key, item]) => {
      if (schema.propertyNames && !next(key, schema.propertyNames)) return false;
      if (Object.hasOwn(schema.properties ?? {}, key)) return next(item, schema.properties[key]);
      if (schema.additionalProperties === false) return false;
      return !schema.additionalProperties || next(item, schema.additionalProperties);
    });
  }
  return true;
}

const valid = (value, name, options) => Boolean(matches(value, defs[name], options));
const validHook = (value, options, guard) => options.hook === undefined || (vmHooks.includes(options.hook)
  && matches(value, guard(Object.hasOwn(patchSchemas, options.hook) ? options.hook : 'readOnly'), options));
export const validVmOpcode = (value, options = {}) => valid(value, 'opcode', options) && validHook(value, options, hookGuard);
export const validVmProgram = (value, options = {}) => valid(value, 'program', options) && validHook(value, options, guardedProgram);
export const validVmRule = (value, options = {}) => valid(value, 'rule', options);
export const validVmSelector = (value, options = {}) => valid(value, 'selector', options);
export const validVmStatMod = (value, options = {}) => valid(value, 'statMod', options);
export function vmStatModError(mod) {
  if (validVmStatMod(mod)) return undefined;
  if (mod && ratioStats.enum.includes(mod.stat) && (Object.hasOwn(mod, 'additivePercent')
    || typeof mod.flat === 'number' && !matches(mod.flat, ratioFlat, {}))) {
    return `VM 修饰 ${mod.stat} 基值为 0，不能用 additivePercent；请用 flat 填写 -1..1 的小数（如 0.3 代表 30%）或数值表达式`;
  }
  if (mod && multiplierStats.enum.includes(mod.stat) && Object.hasOwn(mod, 'flat')) {
    return `VM 修饰 ${mod.stat} 基值为 1，不能用 flat；请用 mult（如 1.3）或 additivePercent（如 0.3）`;
  }
  return 'VM 修饰';
}
export const validVmTargetRef = (value, options = {}) => valid(value, 'targetRef', options);
export const validVmTag = value => valid(value, 'tag', {});
