// Arithmetic only: no property traversal, JS evaluation, function calls or RNG.
const aliases = {
  '我方力量':'self.str', '我方敏捷':'self.agi', '我方体质':'self.con', '我方智力':'self.int', '我方精神':'self.spi',
  '目标力量':'target.str', '目标敏捷':'target.agi', '目标体质':'target.con', '目标智力':'target.int', '目标精神':'target.spi',
  '我方生命值':'self.hp', '我方生命上限':'self.maxHp', '目标生命值':'target.hp', '目标生命上限':'target.maxHp',
  '攻击':'weapon.attack', '武器攻击':'weapon.attack', '本次威力':'event.power', '本次伤害':'event.dealt',
  '上一步数值':'event.previous', '治疗量':'event.healing'
};
const variable = /^(?:(?:self|target)\.(?:str|agi|con|int|spi|tier|hp|maxHp|mp|maxMp|sp|maxSp)|weapon\.attack|event\.(?:power|dealt|previous|healing))$/;
const canonical = token => aliases[token] ?? token;
const cache = new Map();
function compile(text) {
  if (typeof text !== 'string' || !text.length || text.length > 200) return null;
  if (cache.has(text)) return cache.get(text);
  return parse(text);
}
function parse(text) {
  const tokens = text.match(/\d+(?:\.\d+)?|[\p{L}_][\p{L}\w.]*|[^\s]/gu) ?? [];
  if (tokens.length > 80) return null;
  let i = 0;
  function atom() {
    const t = tokens[i++];
    if (t === '-') return ['neg', atom()];
    if (t === '+') return atom();
    if (t === '(') { const a = sum(); if (tokens[i++] !== ')') throw 0; return a; }
    if (t && /^\d/.test(t) && Number.isFinite(+t)) return +t;
    const name = canonical(t);
    if (variable.test(name)) return name;
    throw 0;
  }
  function product() { let a = atom(); while (['*','/'].includes(tokens[i])) a = [tokens[i++], a, atom()]; return a; }
  function sum() { let a = product(); while (['+','-'].includes(tokens[i])) a = [tokens[i++], a, product()]; return a; }
  let tree = null;
  try { const a = sum(); if (i === tokens.length) tree = a; } catch { /* invalid grammar */ }
  if (cache.size >= 512) cache.clear();
  cache.set(text, tree);
  return tree;
}
export const validFormula = text => compile(text) !== null;
export const formulaUses = (text, name) => typeof text === 'string' && text.includes(name);
export function evaluateFormula(text, lookup) {
  function visit(a) {
    if (typeof a === 'number') return a;
    if (typeof a === 'string') return lookup(a) ?? 0;
    const [op,x,y] = a, l = visit(x);
    if (op === 'neg') return -l;
    const r = visit(y);
    return op === '+' ? l+r : op === '-' ? l-r : op === '*' ? l*r : r === 0 ? NaN : l/r;
  }
  const tree = compile(text), n = tree === null ? NaN : visit(tree);
  return Number.isFinite(n) ? n : 0;
}
