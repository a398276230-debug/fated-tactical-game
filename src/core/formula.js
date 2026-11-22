// Expression identifiers and queries expose a bounded, read-only combat context.
const variables = new Map();
const families = [];
const queries = new Map();
const register = (name, description, read, legacy = false) => variables.set(name, { description, read, legacy });
const family = (name, pattern, description, read, legacy = false) => families.push({ name, pattern, description, read, legacy });
const query = (name, args, signature, description, read) => queries.set(name, { args, signature, description, read });
const own = (record, key) => record == null ? undefined : Object.getOwnPropertyDescriptor(record, key)?.value;
const path = (record, ...keys) => keys.reduce(own, record);
const scalar = value => Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string' ? value : null;
const idPattern = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}';
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safeKey = key => !blockedKeys.has(key);
const callback = (context, key, ...args) => {
  const read = own(context, key);
  return typeof read === 'function' ? read(...args, context) : undefined;
};
const unitFields = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神', tier: '层级',
  hp: '当前生命', maxHp: '生命上限', initialMaxHp: '初始生命上限', mp: '当前法力', maxMp: '法力上限', initialMaxMp: '初始法力上限', sp: '当前体力', maxSp: '体力上限', initialMaxSp: '初始体力上限'
};
const vmUnitFields = {
  id: '实体 ID', armor: '护甲', x: '横坐标', y: '纵坐标', z: '实际高度',
  altitude: '离地高度', mc: '巨型系数', alive: '是否存活且在场', team: '阵营', summoned: '是否为召唤物'
};
const unitScopes = { self: '效果主体', attacker: '事件攻击者', target: '当前目标', source: '效果来源', candidate: '当前筛选实体' };
const legacyScopes = new Set(['self', 'attacker', 'target']);
const entityScopes = new Set([...Object.keys(unitScopes), 'status', 'zone']);
const statusFields = { id: '状态 ID', category: '状态类别', tier: '状态层级', stacks: '状态层数', remainingTurns: '剩余回合' };
const tapeFields = { round: '记录轮数', turn: '记录时的行动者索引', actorId: '行动者 ID', team: '行动者阵营', actionType: '行动类型', skillId: '技能 ID' };
const refTypes = new Set(['unit', 'status', 'zone', 'item']);
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const frameValue = (context, id) => path(context, 'vars', id);

function frameEntity(context, id, kind) {
  const value = frameValue(context, id);
  if (value == null) return undefined;
  const resolveEntity = own(context, 'resolveEntity');
  const resolved = typeof resolveEntity === 'function' ? resolveEntity(value, kind) : undefined;
  if (isObject(resolved)) return resolved;
  const type = own(value, 'type');
  return isObject(value) && !refTypes.has(type) && type !== 'literal' ? value : undefined;
}

function unitField(context, unit, field) {
  const value = own(unit, field);
  if (field === 'alive') {
    const hp = own(unit, 'hp');
    return value ?? (Number.isFinite(hp) ? hp > 0 && !own(unit, 'fled') : undefined);
  }
  if (field === 'z' && unit != null) return callback(context, 'elevation', unit) ?? value;
  return path(unit, 'stats', field) ?? value;
}

function* records(collection) {
  for (const key of Object.keys(collection ?? {})) yield own(collection, key);
}

function statusOf(unit, id) {
  const statuses = own(unit, 'statuses');
  const direct = own(statuses, id);
  if (direct != null && !Array.isArray(statuses)) return direct;
  for (const status of records(statuses)) {
    if (own(status, 'templateId') === id || own(status, 'id') === id) return status;
  }
  return undefined;
}

function dynamicFamily(prefix, description, read, legacy = false) {
  family(`${prefix}.<id>`, new RegExp(`^${prefix.replaceAll('.', '\\.')}\\.(${idPattern})$`), description, read, legacy);
}

function hpRatio(unit) {
  const maxHp = own(unit, 'maxHp');
  return maxHp == null || maxHp === 0 ? 0 : numeric((a, b) => a / b, own(unit, 'hp'), maxHp);
}

const entityFamilies = {
  resource: ['资源余额，使用资源 ID', (context, entity, id) => callback(context, 'resource', entity, id) ?? path(entity, 'resources', id)],
  stacks: ['状态层数，使用状态 ID', (context, entity, id) => callback(context, 'stacks', entity, id) ?? own(statusOf(entity, id), 'stacks') ?? 0],
  vars: ['变量', (context, entity, id) => path(entity, 'vars', id)]
};
const allUnitFields = { ...unitFields, ...vmUnitFields };
for (const [scope, label] of Object.entries(unitScopes)) {
  const legacy = legacyScopes.has(scope);
  for (const [field, meaning] of Object.entries(allUnitFields)) {
    register(`${scope}.${field}`, `${label}的${meaning}`, context => unitField(context, own(context, scope), field), legacy && Object.hasOwn(unitFields, field));
  }
  register(`${scope}.hpRatio`, `${label}的生命比例（0…1）`, context => hpRatio(own(context, scope)), legacy);
  for (const [field, [meaning, read]] of Object.entries(entityFamilies)) {
    dynamicFamily(`${scope}.${field}`, `${label}的${meaning}`, (context, id) => read(context, own(context, scope), id), legacy && field !== 'vars');
  }
}

dynamicFamily('vars', '当前栈帧的局部变量，带 ID 的实体引用返回其 ID', (context, id) => {
  const value = frameValue(context, id);
  return refTypes.has(own(value, 'type')) ? own(value, 'id') : value;
});
const frameEntityFields = { ...statusFields, ...tapeFields, ...allUnitFields, hpRatio: '生命比例（0…1）', name: '名称', templateId: '模板 ID' };
for (const [field, meaning] of Object.entries(frameEntityFields)) {
  family(`vars.<id>.${field}`, new RegExp(`^vars\\.(${idPattern})\\.${field}$`), `局部实体的${meaning}`, (context, id) => {
    const entity = frameEntity(context, id);
    if (entity == null) return undefined;
    if (field === 'hpRatio') return hpRatio(entity);
    return Object.hasOwn(allUnitFields, field) ? unitField(context, entity, field) : own(entity, field);
  });
}
for (const [field, [meaning, read]] of Object.entries(entityFamilies)) {
  family(`vars.<id>.${field}.<id>`, new RegExp(`^vars\\.(${idPattern})\\.${field}\\.(${idPattern})$`), `局部实体的${meaning}`, (context, id, key) => {
    const entity = frameEntity(context, id);
    return entity == null ? undefined : read(context, entity, key);
  });
}
for (const [scope, label] of Object.entries({ status: '状态', zone: '区域', skill: '持有技能', item: '装备' })) {
  dynamicFamily(`${scope}.vars`, `${label}实例的变量`, (context, id) => path(context, scope, 'vars', id));
}
register('zone.team', '区域创建时的阵营；无阵营时为 null', context => path(context, 'zone', 'team'));
register('zone.sourceId', '区域创建者 ID', context => path(context, 'zone', 'sourceId'));
register('candidate.sourceId', '当前候选实体的创建者 ID', context => path(context, 'candidate', 'sourceId'));
for (const [scope, fields] of Object.entries({ status: statusFields, tape: tapeFields })) {
  for (const [field, description] of Object.entries(fields)) {
    register(`${scope}.${field}`, description, context => path(context, scope, field));
    // Selector predicates always bind their row as candidate, including rows
    // from statuses and the replay tape. Keep these fields closed and read-only.
    if (!variables.has(`candidate.${field}`)) {
      register(`candidate.${field}`, `当前筛选实体的${description}`, context => own(context.candidate, field));
    }
  }
}
register('round', '当前轮数', context => own(context, 'round'), true);
register('turn', '当前行动者在先攻顺序中的索引（从 0 开始）', context => own(context, 'turn'), true);
register('timeOfDay', '战场时段（dawn/day/dusk/night）', context => own(context, 'timeOfDay'));
register('pool', '资源指令当前处理的资源池键', context => own(context, 'pool'));
register('distance', '效果主体到当前目标的三维距离', context => readDistance(context, own(context, 'self'), own(context, 'target')), true);
register('weapon.attack', '事件武器模板的攻击力', context => own(callback(context, 'weapon'), 'attack'), true);
register('weapon.range', '事件武器模板的基础射程', context => own(callback(context, 'weapon'), 'range'), true);
for (const [name, description] of Object.entries({
  power: '技能威力', dealt: '本次实际扣除的 HP', absorbed: '本次被护盾吸收的伤害',
  previous: '当前效果链上一步实际数值', healing: '本次治疗量', statusId: '触发本次检定或事件的状态 ID', checkKind: '检定类型（如 attack/save/contest）', baseDC: 'VM 检定初始 DC', finalDC: 'VM 检定完成时计入修饰后的 DC'
})) register(`event.${name}`, description, context => path(context, 'event', name), true);
// Existing authored check filters used event.kind before checkKind was documented.
register('event.kind', '事件类型，检定中等同于 event.checkKind', context => path(context, 'event', 'kind') ?? path(context, 'event', 'checkKind'));
family('event.<field>', /^event\.([A-Za-z_][A-Za-z0-9_]{0,63})$/, '活跃事件的自有标量字段', (context, key) => path(context, 'event', key));

function readDistance(context, from, to) {
  if (typeof own(context, 'distance') === 'function') return callback(context, 'distance', from, to);
  if (from == null || to == null) return null;
  const coords = entity => ['x', 'y', 'z'].map(axis => axis === 'z'
    ? callback(context, 'elevation', entity) ?? own(entity, 'z') ?? own(entity, 'altitude') ?? 0
    : own(entity, axis));
  const a = coords(from), b = coords(to);
  return a.every(Number.isFinite) && b.every(Number.isFinite) ? Math.hypot(...b.map((value, i) => value - a[i])) : null;
}

const numeric = (fn, ...args) => args.every(Number.isFinite) ? scalar(fn(...args)) : null;
query('min', ['value', 'value'], 'min(a, b)', '取两个数的较小值', ([a, b]) => numeric(Math.min, a, b));
query('max', ['value', 'value'], 'max(a, b)', '取两个数的较大值', ([a, b]) => numeric(Math.max, a, b));
query('floor', ['value'], 'floor(value)', '向下取整', ([value]) => numeric(Math.floor, value));
query('ceil', ['value'], 'ceil(value)', '向上取整', ([value]) => numeric(Math.ceil, value));
query('abs', ['value'], 'abs(value)', '取绝对值', ([value]) => numeric(Math.abs, value));
query('clamp', ['value', 'value', 'value'], 'clamp(value, lo, hi)', '将数值钳制在上下限之间', ([value, lo, hi]) => numeric((x, min, max) => Math.min(max, Math.max(min, x)), value, lo, hi));
query('distance', ['unit', 'unit'], 'distance() / distance(unitA, unitB)', '读取两单位的三维距离，无参时默认 self 到 target', ([a, b], context) => readDistance(context, a, b));

const booleanQuery = value => typeof value === 'boolean' ? value : null;
const statusPresent = (context, entity, id) => booleanQuery(callback(context, 'hasStatus', entity, id) ?? (statusOf(entity, id) != null));
function tagged(entity, tag) {
  const tags = own(entity, 'tags');
  if (!Array.isArray(tags)) return false;
  for (const entry of records(tags)) if (entry === tag) return true;
  return false;
}
const withId = read => ([entity, id], context) => typeof id === 'string' && safeKey(id) ? booleanQuery(read(context, entity, id)) : null;
query('has_status', ['unit', 'value'], "has_status(unit, 'statusId')", '查询单位是否持有状态', withId(statusPresent));
query('has_tag', ['entity', 'value'], "has_tag(entity, 'tag')", '查询实体是否带有标签', withId((context, entity, tag) => callback(context, 'hasTag', entity, tag) ?? tagged(entity, tag)));
query('in_zone', ['unit', 'value'], "in_zone(unit, 'tagOrTemplateId')", '查询单位是否在指定区域内', withId((context, entity, id) => callback(context, 'inZone', entity, id)));
query('is_immune', ['unit', 'value'], "is_immune(unit, 'statusIdOrTag')", '只读干跑免疫拦截', withId((context, entity, id) => {
  const read = own(context, 'isImmune');
  return typeof read === 'function' ? read(entity, id, { dryRun: true }, context) : null;
}));
query('any_unit_has_status', ['value'], "any_unit_has_status('statusId')", '查询战场上是否有任意单位持有状态', ([id], context, runtime) => {
  if (typeof id !== 'string' || !safeKey(id) || own(context, 'units') == null) return null;
  for (const unit of records(own(context, 'units'))) {
    if (!runtime.step()) return null;
    const present = statusPresent(context, unit, id);
    if (present !== false) return present;
  }
  return false;
});
query('count_units', ['predicate'], 'count_units(predicate)', '按 candidate 逐个计算谓词，也可传入带引号的表达式文本', ([expr], context, runtime) => {
  const units = own(context, 'units');
  return units == null ? null : aggregate(units, expr, context, runtime, false);
});
query('count', ['value'], "count('selector')", '读取纯选择器回调返回的实体数量', ([key], context) => selected(context, key)?.length);
query('sum', ['value', 'expr'], "sum('selector', expr)", '逐个绑定 candidate 并求和，如 sum(\'selector\', candidate.hp)', ([key, expr], context, runtime) => {
  const candidates = selected(context, key);
  return candidates == null ? null : aggregate(candidates, expr, context, runtime, true);
});

function selected(context, key) {
  if (typeof key !== 'string' || !safeKey(key)) return null;
  const candidates = callback(context, 'select', key);
  return Array.isArray(candidates) ? candidates : null;
}

function aggregate(collection, expr, context, runtime, sum) {
  let total = 0;
  const fields = Object.getOwnPropertyDescriptors(context);
  for (const candidate of records(collection)) {
    if (!runtime.step()) return null;
    if (candidate == null) continue;
    fields.candidate = { value: candidate, enumerable: true };
    const value = runtime.visit(expr, Object.create(null, fields));
    if (sum ? !Number.isFinite(value) : typeof value !== 'boolean') return null;
    total += sum ? value : Number(value);
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

export const formulaVariableNames = () => [...variables.keys(), ...families.map(entry => entry.name)];
export const formulaQueryNames = () => [...queries.keys()];
export const formulaReference = [...variables].map(([name, { description }]) => `${name}（${description}）`)
  .concat(families.map(({ name, description }) => `${name}（${description}）`)).join('，');
export const formulaFunctionReference = [...queries.values()].map(({ signature, description }) => `${signature}（${description}）`).join('，');

function resolveVariable(name, legacy) {
  const exact = variables.get(name);
  if (exact && (!legacy || exact.legacy)) return exact.read;
  for (const { pattern, read, legacy: supported } of families) {
    if (legacy && !supported) continue;
    const match = pattern.exec(name);
    const keys = match?.slice(1);
    if (keys?.every(safeKey)) return context => read(context, ...keys);
  }
  return null;
}

const numericLiteral = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/;
// Custom IDs may contain hyphens. Delimit subtraction after an ID with whitespace or parentheses.
const frameVariable = new RegExp(`^vars\\.(${idPattern})$`);
const frameIdentifier = new RegExp(`vars\\.${idPattern}(?:\\.(?:(?:resource|stacks|vars)\\.${idPattern}|[A-Za-z_][\\w.]*))?`);
const dynamicIdentifier = new RegExp(`[A-Za-z]+\\.(?:resource|stacks|vars)\\.${idPattern}`);
const legacyIdentifier = /[A-Za-z]+\.(?:resource|stacks)\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}/;
const identifier = /[A-Za-z_][\w.]*/;
const quoted = /'(?:[^'\\\r\n]|\\(?:['"\\/bfnrt]|u[0-9a-fA-F]{4}))*'|"(?:[^"\\\r\n]|\\(?:['"\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;
const quotedToken = new RegExp(`^(?:${quoted.source})$`);
const escapedCharacters = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const decodeString = token => token.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, escape) =>
  escape.length > 1 ? String.fromCharCode(Number.parseInt(escape.slice(1), 16)) : escapedCharacters[escape] ?? escape);
const lexer = (...patterns) => new RegExp([...patterns.map(pattern => pattern.source), '[^\\s]'].join('|'), 'g');
const vmTokens = lexer(frameIdentifier, dynamicIdentifier, numericLiteral, identifier, quoted, /&&|\|\||<=|>=|==|!=/);
const legacyTokens = lexer(legacyIdentifier, /\d+(?:\.\d+)?/, identifier);
const precedence = new Map([
  ['||', 1], ['&&', 2], ['==', 3], ['!=', 3], ['<', 4], ['<=', 4], ['>', 4], ['>=', 4],
  ['+', 5], ['-', 5], ['*', 6], ['/', 6], ['%', 6]
]);
const legacyOperators = new Set(['+', '-', '*', '/']);
const VM_LIMITS = { length: 1024, tokens: 256 };
const LEGACY_LIMITS = { length: 200, tokens: 80 };

function parse(text, legacy, dependencies) {
  const limits = legacy ? LEGACY_LIMITS : VM_LIMITS;
  if (!text.length || text.length > limits.length) throw new SyntaxError('Invalid expression length');
  const tokens = text.match(legacy ? legacyTokens : vmTokens) ?? [];
  if (tokens.length > limits.tokens) throw new SyntaxError('Too many expression tokens');
  let index = 0;
  const take = token => {
    if (tokens[index] !== token) return false;
    index++;
    return true;
  };
  const expect = token => {
    if (!take(token)) throw new SyntaxError(`Expected ${token}`);
  };

  function readCall(name) {
    const entry = queries.get(name);
    if (!entry) throw new SyntaxError(`Unknown query: ${name}`);
    const args = [];
    if (name === 'distance' && take(')')) {
      args.push(readScope('self', 'unit'), readScope('target', 'unit'));
    } else {
      for (const [i, kind] of entry.args.entries()) {
        if (i > 0) expect(',');
        if (kind === 'entity' || kind === 'unit') {
          args.push(readScope(tokens[index++], kind));
          continue;
        }
        let expr = expression();
        // count_units also accepts source text for the candidate predicate.
        if (kind === 'predicate' && expr[0] === 'literal' && typeof expr[1] === 'string') {
          expr = parse(expr[1], false, dependencies);
        }
        args.push(kind === 'value' ? expr : ['deferred', expr]);
      }
      expect(')');
    }
    return ['call', entry.read, args];
  }

  function readScope(scope, kind) {
    const frameId = frameVariable.exec(scope)?.[1];
    if (frameId && safeKey(frameId)) {
      dependencies.add(scope);
      return ['frameScope', frameId, kind];
    }
    const allowed = kind === 'unit' ? Object.hasOwn(unitScopes, scope) : entityScopes.has(scope);
    if (!allowed) throw new SyntaxError(`Expected ${kind} scope`);
    dependencies.add(scope);
    return ['scope', scope];
  }

  function atom() {
    const token = tokens[index++];
    if (token === '-' || token === '+' || (!legacy && token === '!')) return ['unary', token, atom()];
    if (token === '(') {
      const inner = expression();
      expect(')');
      return inner;
    }
    if (token && /^(?:\d|\.\d)/.test(token) && Number.isFinite(Number(token))) return ['literal', Number(token)];
    if (!legacy) {
      if (token === 'true' || token === 'false') return ['literal', token === 'true'];
      if (token === 'null') return ['literal', explicitNull];
      if (token && quotedToken.test(token)) return ['literal', decodeString(token)];
      if (take('(')) return readCall(token);
    }
    const read = resolveVariable(token, legacy);
    if (!read) throw new SyntaxError(`Unknown expression operand: ${token}`);
    dependencies.add(token);
    return ['variable', read];
  }

  function expression(min = 0) {
    let left = atom();
    for (;;) {
      const op = tokens[index];
      const level = precedence.get(op);
      if (level === undefined || level < min || (legacy && !legacyOperators.has(op))) break;
      index++;
      left = ['binary', op, left, expression(level + 1)];
    }
    if (min === 0 && !legacy && take('?')) {
      const yes = expression();
      expect(':');
      return ['conditional', left, yes, expression()];
    }
    return left;
  }

  const tree = expression();
  if (index !== tokens.length) throw new SyntaxError('Unexpected expression token');
  return tree;
}

const operations = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '%': (a, b) => a % b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b
};

// Keep explicit null and absent reads distinguishable from invalid computations.
const explicitNull = Symbol('explicit null');
const unavailable = value => value == null || value === explicitNull;

function evaluate(tree, context, legacy) {
  let remaining = 100_000;
  const step = () => remaining-- > 0;
  const runtime = { visit, step };
  function visit(node, current) {
    if (!step()) return null;
    const [kind, first, second, third] = node;
    switch (kind) {
      case 'literal': return first;
      case 'scope': return own(current, first) ?? null;
      case 'frameScope': return frameEntity(current, first, second);
      case 'deferred': return first;
      case 'variable': {
        const value = first(current);
        if (legacy) return scalar(value ?? 0);
        if (value === null) return explicitNull;
        return value === undefined ? undefined : scalar(value);
      }
      case 'call': {
        const args = [];
        for (const arg of second) {
          const value = visit(arg, current);
          if (unavailable(value)) return null;
          args.push(value);
        }
        return scalar(first(args, current, runtime));
      }
      case 'conditional': {
        const condition = visit(first, current);
        return unavailable(condition) ? null : visit(condition ? second : third, current);
      }
      case 'unary': {
        const value = visit(second, current);
        if (unavailable(value)) return null;
        if (first === '!') return !value;
        if (legacy && first === '+') return value;
        return numeric(first === '-' ? x => -x : x => +x, value);
      }
      case 'binary': {
        const a = visit(second, current);
        if (a === null) return null;
        const equality = first === '==' || first === '!=';
        if (!equality && unavailable(a)) return null;
        if (first === '&&' && !a) return false;
        if (first === '||' && a) return true;
        const b = visit(third, current);
        if (b === null) return null;
        if (equality) {
          if ((a === undefined || b === undefined) && a !== explicitNull && b !== explicitNull) return null;
          const equal = (a ?? explicitNull) === (b ?? explicitNull);
          return first === '==' ? equal : !equal;
        }
        if (unavailable(b)) return null;
        if (first === '&&' || first === '||') return Boolean(b);
        return numeric(operations[first], a, b);
      }
    }
    return null;
  }
  return scalar(visit(tree, context));
}

const legacyCache = new Map();
const exprCache = new Map();
function compile(value, legacy) {
  if (typeof value !== 'string') return !legacy && (value === null || scalar(value) !== null)
    ? { tree: ['literal', value === null ? explicitNull : value], dependencies: new Set() } : null;
  const cache = legacy ? legacyCache : exprCache;
  if (value.length > (legacy ? LEGACY_LIMITS : VM_LIMITS).length) return null;
  if (cache.has(value)) return cache.get(value);
  const dependencies = new Set();
  let compiled = null;
  try {
    compiled = { tree: parse(value, legacy, dependencies), dependencies };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (cache.size >= 512) cache.clear();
  cache.set(value, compiled);
  return compiled;
}

export const validFormula = text => compile(text, true) !== null;
export const formulaUses = (text, name) => compile(text, true)?.dependencies.has(name) ?? false;
export function evaluateFormula(text, context) {
  const compiled = compile(text, true);
  const value = compiled ? evaluate(compiled.tree, context, true) : null;
  return Number.isFinite(value) ? value : null;
}

// Numbers, booleans and null are direct literals. Strings are expression source;
// write single or double quotes in the source for a string literal. Missing or invalid values return null.
// resolveEntity(value, kind) resolves a frame variable for entity reads; kind is 'unit',
// 'entity', or undefined for a field read.
// All callbacks are synchronous and read-only. Resource, stack, status, tag and
// zone callbacks receive (entity, key, context). Distance receives (from, to, context)
// and elevation receives (entity, context). isImmune receives (entity, key, { dryRun: true }, context).
// select(key, context) resolves a selector reference to a deterministic array without
// advancing RNG. units is an array or ID-keyed record for battlefield-wide queries.
export const validExpr = value => compile(value, false) !== null;
export const exprUses = (value, name) => compile(value, false)?.dependencies.has(name) ?? false;
export function compileExpr(value) {
  const compiled = compile(value, false);
  if (!compiled) return null;
  return { dependencies: new Set(compiled.dependencies), evaluate: context => evaluate(compiled.tree, context, false) };
}
export function evaluateExpr(value, context) {
  const compiled = compile(value, false);
  return compiled ? evaluate(compiled.tree, context, false) : null;
}
