// Formula identifiers expose a bounded combat context. Each registration owns its lookup and documentation.
const variables = new Map();
const families = [];
const register = (name, description, read) => variables.set(name, { description, read });
export const formulaVariableNames = () => [...variables.keys(), ...families.map(family => family.name)];
const family = (name, pattern, description, read) => families.push({ name, pattern, description, read });
const unitFields = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神', tier: '层级',
  hp: '当前生命', maxHp: '生命上限', mp: '当前法力', maxMp: '法力上限', sp: '当前体力', maxSp: '体力上限'
};
const scopes = { self: '效果主体', attacker: '事件攻击者', target: '当前目标' };
for (const [scope, label] of Object.entries(scopes)) {
  for (const [field, meaning] of Object.entries(unitFields)) {
    register(`${scope}.${field}`, `${label}的${meaning}`, context => context[scope]?.stats?.[field] ?? context[scope]?.[field]);
  }
  register(`${scope}.hpRatio`, `${label}的生命比例（0…1）`, context => {
    const unit = context[scope];
    return unit?.maxHp ? unit.hp / unit.maxHp : 0;
  });
  family(`${scope}.resource.<id>`, new RegExp(`^${scope}\\.resource\\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$`),
    `${label}的资源余额，使用资源 ID`, (context, id) => context.resource(context[scope], id));
  family(`${scope}.stacks.<id>`, new RegExp(`^${scope}\\.stacks\\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$`),
    `${label}的状态层数，使用状态 ID`, (context, id) => {
      const statuses = context[scope]?.statuses;
      return statuses && Object.hasOwn(statuses, id) ? statuses[id].stacks : 0;
    });
}
register('distance', '效果主体到当前目标的三维距离', context => context.distance());
register('round', '当前轮数', context => context.round);
register('turn', '当前行动者在先攻顺序中的索引（从 0 开始）', context => context.turn);
register('weapon.attack', '事件武器模板的攻击力', context => context.weapon()?.attack);
register('weapon.range', '事件武器模板的基础射程', context => context.weapon()?.range);
for (const [name, description] of Object.entries({
  power: '技能威力', dealt: '本次实际扣除的 HP', absorbed: '本次被护盾吸收的伤害',
  previous: '当前效果链上一步实际数值', healing: '本次治疗量'
})) register(`event.${name}`, description, context => context.event[name]);

export const formulaReference = [...variables.entries()].map(([name, { description }]) => `${name}（${description}）`)
  .concat(families.map(({ name, description }) => `${name}（${description}）`)).join('，');

function resolveVariable(name) {
  const exact = variables.get(name);
  if (exact) return exact.read;
  for (const { pattern, read } of families) {
    const match = pattern.exec(name);
    if (match) return context => read(context, match[1]);
  }
  return null;
}

const cache = new Map();
function compile(text) {
  if (typeof text !== 'string' || !text.length || text.length > 200) return null;
  if (cache.has(text)) return cache.get(text);
  // Brackets keep hyphens in custom IDs distinct from the subtraction operator.
  const tokens = text.match(/[A-Za-z]+\.(?:resource|stacks)\.[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}|\d+(?:\.\d+)?|[A-Za-z_][\w.]*|[^\s]/g) ?? [];
  if (tokens.length > 80) return null;
  const dependencies = new Set();
  let index = 0;
  function atom() {
    const token = tokens[index++];
    if (token === '-') return ['neg', atom()];
    if (token === '+') return atom();
    if (token === '(') {
      const expression = sum();
      if (tokens[index++] !== ')') throw new SyntaxError('Expected closing parenthesis');
      return expression;
    }
    if (token && /^\d/.test(token) && Number.isFinite(+token)) return +token;
    const name = token;
    const read = resolveVariable(name);
    if (!read) throw new SyntaxError(`Unknown formula operand: ${token}`);
    dependencies.add(name);
    return read;
  }
  function product() {
    let left = atom();
    while (['*', '/'].includes(tokens[index])) left = [tokens[index++], left, atom()];
    return left;
  }
  function sum() {
    let left = product();
    while (['+', '-'].includes(tokens[index])) left = [tokens[index++], left, product()];
    return left;
  }
  let compiled = null;
  try {
    const tree = sum();
    if (index === tokens.length) compiled = { tree, dependencies };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (cache.size >= 512) cache.clear();
  cache.set(text, compiled);
  return compiled;
}

export const validFormula = text => compile(text) !== null;
export const formulaUses = (text, name) => compile(text)?.dependencies.has(name) ?? false;
export function evaluateFormula(text, context) {
  function visit(tree) {
    if (typeof tree === 'number') return tree;
    if (typeof tree === 'function') return tree(context) ?? 0;
    const [op, left, right] = tree;
    const a = visit(left);
    if (op === 'neg') return -a;
    const b = visit(right);
    const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b === 0 ? NaN : a / b;
    return Number.isFinite(result) ? result : NaN;
  }
  const compiled = compile(text);
  const value = compiled ? visit(compiled.tree) : NaN;
  return Number.isFinite(value) ? value : null;
}
