// Expression identifiers and queries expose a bounded, read-only combat context.
const variables = new Map();
const families = [];
const queries = new Map();
const register = (name, description, read, legacy = false) => variables.set(name, { description, read, legacy });
const family = (name, pattern, description, read, legacy = false) => families.push({ name, pattern, description, read, legacy });
const query = (name, args, description, read) => queries.set(name, { args, description, read });
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
  hp: '当前生命', maxHp: '生命上限', mp: '当前法力', maxMp: '法力上限', sp: '当前体力', maxSp: '体力上限'
};
const vmUnitFields = {
  id: '实体 ID', armor: '护甲', x: '横坐标', y: '纵坐标', z: '实际高度',
  altitude: '离地高度', mc: '巨型系数', alive: '是否存活且在场', team: '阵营'
};
const unitScopes = { self: '效果主体', attacker: '事件攻击者', target: '当前目标', source: '效果来源', candidate: '当前筛选实体' };
const legacyScopes = new Set(['self', 'attacker', 'target']);
const entityScopes = new Set([...Object.keys(unitScopes), 'status', 'zone']);

function unitField(context, scope, field) {
  const unit = own(context, scope);
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

for (const [scope, label] of Object.entries(unitScopes)) {
  const legacy = legacyScopes.has(scope);
  for (const [field, meaning] of Object.entries({ ...unitFields, ...vmUnitFields })) {
    register(`${scope}.${field}`, `${label}的${meaning}`, context => unitField(context, scope, field), legacy && Object.hasOwn(unitFields, field));
  }
  register(`${scope}.hpRatio`, `${label}的生命比例（0…1）`, context => {
    const unit = own(context, scope);
    const maxHp = own(unit, 'maxHp');
    const hp = own(unit, 'hp');
    return maxHp == null || maxHp === 0 ? 0 : numeric((a, b) => a / b, hp, maxHp);
  }, legacy);
  dynamicFamily(`${scope}.resource`, `${label}的资源余额，使用资源 ID`, (context, id) => {
    const entity = own(context, scope);
    return callback(context, 'resource', entity, id) ?? path(entity, 'resources', id);
  }, legacy);
  dynamicFamily(`${scope}.stacks`, `${label}的状态层数，使用状态 ID`, (context, id) => {
    const entity = own(context, scope);
    return callback(context, 'stacks', entity, id) ?? own(statusOf(entity, id), 'stacks') ?? 0;
  }, legacy);
  dynamicFamily(`${scope}.vars`, `${label}的变量`, (context, id) => path(context, scope, 'vars', id));
}

dynamicFamily('vars', '当前栈帧的局部变量', (context, id) => path(context, 'vars', id));
for (const scope of ['status', 'zone']) {
  dynamicFamily(`${scope}.vars`, `${scope === 'status' ? '状态' : '区域'}实例的变量`, (context, id) => path(context, scope, 'vars', id));
}
for (const [scope, fields] of Object.entries({
  status: { id: '状态 ID', category: '状态类别', tier: '状态层级', stacks: '状态层数', remainingTurns: '剩余回合' },
  tape: { round: '记录轮数', actorId: '行动者 ID', team: '行动者阵营', actionType: '行动类型', skillId: '技能 ID' }
})) {
  for (const [field, description] of Object.entries(fields)) {
    register(`${scope}.${field}`, description, context => path(context, scope, field));
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
  previous: '当前效果链上一步实际数值', healing: '本次治疗量'
})) register(`event.${name}`, description, context => path(context, 'event', name), true);
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
query('min', ['value', 'value'], '取两个数的较小值', ([a, b]) => numeric(Math.min, a, b));
query('max', ['value', 'value'], '取两个数的较大值', ([a, b]) => numeric(Math.max, a, b));
query('floor', ['value'], '向下取整', ([value]) => numeric(Math.floor, value));
query('ceil', ['value'], '向上取整', ([value]) => numeric(Math.ceil, value));
query('abs', ['value'], '取绝对值', ([value]) => numeric(Math.abs, value));
query('clamp', ['value', 'value', 'value'], '将数值钳制在上下限之间', ([value, lo, hi]) => numeric((x, min, max) => Math.min(max, Math.max(min, x)), value, lo, hi));
query('distance', ['unit', 'unit'], 'distance(a, b) 读取两单位的三维距离，distance() 默认 self 到 target', ([a, b], context) => readDistance(context, a, b));

const booleanQuery = value => typeof value === 'boolean' ? value : null;
const statusPresent = (context, entity, id) => booleanQuery(callback(context, 'hasStatus', entity, id) ?? (statusOf(entity, id) != null));
function tagged(entity, tag) {
  const tags = own(entity, 'tags');
  if (!Array.isArray(tags)) return false;
  for (const entry of records(tags)) if (entry === tag) return true;
  return false;
}
const withId = read => ([entity, id], context) => typeof id === 'string' && safeKey(id) ? booleanQuery(read(context, entity, id)) : null;
query('has_status', ['unit', 'value'], "has_status(unit, 'statusId') 查询单位是否持有状态", withId(statusPresent));
query('has_tag', ['entity', 'value'], "has_tag(entity, 'tag') 查询实体是否带有标签", withId((context, entity, tag) => callback(context, 'hasTag', entity, tag) ?? tagged(entity, tag)));
query('in_zone', ['unit', 'value'], "in_zone(unit, 'tagOrTemplateId') 查询单位是否在指定区域内", withId((context, entity, id) => callback(context, 'inZone', entity, id)));
query('is_immune', ['unit', 'value'], "is_immune(unit, 'statusIdOrTag') 只读干跑免疫拦截", withId((context, entity, id) => {
  const read = own(context, 'isImmune');
  return typeof read === 'function' ? read(entity, id, { dryRun: true }, context) : null;
}));
query('any_unit_has_status', ['value'], "any_unit_has_status('statusId') 查询战场上是否有任意单位持有状态", ([id], context, runtime) => {
  if (typeof id !== 'string' || !safeKey(id) || own(context, 'units') == null) return null;
  for (const unit of records(own(context, 'units'))) {
    if (!runtime.step()) return null;
    const present = statusPresent(context, unit, id);
    if (present !== false) return present;
  }
  return false;
});
query('count_units', ['predicate'], 'count_units(predicate) 按 candidate 逐个计算谓词，可使用单引号包裹表达式', ([expr], context, runtime) => {
  const units = own(context, 'units');
  return units == null ? null : aggregate(units, expr, context, runtime, false);
});
query('count', ['value'], "count('selector') 读取纯选择器回调返回的实体数量", ([key], context) => selected(context, key)?.length);
query('sum', ['value', 'expr'], "sum('selector', candidate.hp) 逐个绑定 candidate 并求和", ([key, expr], context, runtime) => {
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
  .concat(families.map(({ name, description }) => `${name}（${description}）`),
    [...queries].map(([name, { description }]) => `${name}（${description}）`)).join('，');

function resolveVariable(name, legacy) {
  const exact = variables.get(name);
  if (exact && (!legacy || exact.legacy)) return exact.read;
  for (const { pattern, read, legacy: supported } of families) {
    if (legacy && !supported) continue;
    const match = pattern.exec(name);
    if (match && safeKey(match[1])) return context => read(context, match[1]);
  }
  return null;
}

const numericLiteral = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/;
// Custom IDs may contain hyphens. Delimit subtraction after an ID with whitespace or parentheses.
const dynamicIdentifier = /(?:[A-Za-z]+\.(?:resource|stacks|vars)\.|vars\.)[A-Za-z0-9][A-Za-z0-9_-]{0,63}/;
const legacyIdentifier = /[A-Za-z]+\.(?:resource|stacks)\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}/;
const identifier = /[A-Za-z_][\w.]*/;
const quoted = /'(?:[^'\\\r\n]|\\['\\])*'/;
const lexer = (...patterns) => new RegExp([...patterns.map(pattern => pattern.source), '[^\\s]'].join('|'), 'g');
const vmTokens = lexer(dynamicIdentifier, numericLiteral, identifier, quoted, /&&|\|\||<=|>=|==|!=/);
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
      if (token && quoted.test(token)) return ['literal', token.slice(1, -1).replace(/\\(['\\])/g, '$1')];
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
      case 'deferred': return first;
      case 'variable': {
        const value = first(current);
        return scalar(legacy ? value ?? 0 : value);
      }
      case 'call': {
        const args = [];
        for (const arg of second) {
          const value = visit(arg, current);
          if (value === null) return null;
          args.push(value);
        }
        return scalar(first(args, current, runtime));
      }
      case 'conditional': {
        const condition = visit(first, current);
        return condition === null ? null : visit(condition ? second : third, current);
      }
      case 'unary': {
        const value = visit(second, current);
        if (value === null) return null;
        if (first === '!') return !value;
        if (legacy && first === '+') return value;
        return numeric(first === '-' ? x => -x : x => +x, value);
      }
      case 'binary': {
        const a = visit(second, current);
        if (a === null) return null;
        if (first === '&&' && !a) return false;
        if (first === '||' && a) return true;
        const b = visit(third, current);
        if (b === null) return null;
        if (first === '&&' || first === '||') return Boolean(b);
        if (first === '==') return a === b;
        if (first === '!=') return a !== b;
        return numeric(operations[first], a, b);
      }
    }
    return null;
  }
  return visit(tree, context);
}

const legacyCache = new Map();
const exprCache = new Map();
function compile(value, legacy) {
  if (typeof value !== 'string') return !legacy && scalar(value) !== null
    ? { tree: ['literal', value], dependencies: new Set() } : null;
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

// Numbers and booleans are direct literals. Strings are expression source;
// write single quotes in the source for a string literal. Missing or invalid values return null.
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
