// 精确诊断：用 VM 自己的 schema 逐节点比对，报出「哪个字段、期望什么、实际是什么」。
// 与 vm-schema.js 的 matches() 判定保持一致，但会说明原因而不是返回 boolean。
import { vmHooks, vmOpcodeSchema } from '../../src/core/vm-schema.js';
import { validExpr } from '../../src/core/formula.js';

const DEFS = vmOpcodeSchema.$defs;
const OPCODES = Object.fromEntries(vmOpcodeSchema.$defs.opcode.oneOf.map(schema => [schema.properties.op.const, schema]));
const resolve = schema => (schema?.$ref ? DEFS[schema.$ref.split('/').at(-1)] : schema);
const kindOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const brief = value => {
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value);
  if (Array.isArray(value)) return `数组(${value.length})`;
  if (value && typeof value === 'object') return `{${Object.keys(value).slice(0, 6).join(',')}}`;
  return JSON.stringify(value);
};
const label = (schema, path) => {
  const name = schema?.$ref?.split('/').at(-1);
  return name ? `${path}（${name}）` : path;
};

const pathOf = reason => reason.slice(0, reason.indexOf(' '));
// 分支都失败时，优先报「表达式/枚举」这类能指路的错误，其次取路径最深的
const weight = reason => (/表达式/.test(reason) ? 3 : /必须是 .* 实际 「|状态 ID/.test(reason) ? 2 : /不接受|缺少必填/.test(reason) ? 2 : 1);
const deepest = reasons => reasons.filter(Boolean)
  .sort((a, b) => weight(b) - weight(a) || pathOf(b).length - pathOf(a).length)[0] ?? null;

export function violation(input, value, path = 'value', ctx = { statusTemplates: undefined }) {
  const schema = resolve(input);
  if (!schema) return null;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return `${path} 必须是 ${JSON.stringify(schema.const)}，实际 ${brief(value)}`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} 必须是 ${schema.enum.slice(0, 12).join(' / ')}，实际 ${brief(value)}`;
  if (schema.not && violation(schema.not, value, path, ctx) === null) return `${path} 命中了禁止的取值 ${brief(value)}`;

  const branches = schema.oneOf ?? schema.anyOf;
  if (branches) {
    // 指令/分支对象带 op 时只判对应变体，避免被其它变体的必填字段带偏
    if (value && typeof value === 'object' && typeof value.op === 'string') {
      const exact = branches.find(branch => branch.properties?.op?.const === value.op);
      if (exact) return violation(exact, value, path, ctx);
    }
    const reasons = branches.map(branch => violation(branch, value, path, ctx));
    const passed = reasons.filter(reason => reason === null).length;
    if (schema.oneOf && passed > 1) return `${path} 同时匹配了多个互斥分支`;
    if (passed > 0) return null;
    return deepest(reasons);
  }
  if (schema.allOf) {
    for (const rule of schema.allOf) {
      const reason = violation(rule, value, path, ctx);
      if (reason) return reason;
    }
  }
  if (schema.if) {
    const hit = violation(schema.if, value, path, ctx) === null;
    if (hit && schema.then) return violation(schema.then, value, path, ctx);
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} 必须是 boolean，实际 ${brief(value)}`;
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} 必须是数字，实际 ${brief(value)}`;
    if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} 必须是整数，实际 ${value}`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} 必须 ≥${schema.minimum}，实际 ${value}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} 必须 ≤${schema.maximum}，实际 ${value}`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `${path} 必须 >${schema.exclusiveMinimum}，实际 ${value}`;
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path} 必须是字符串，实际 ${brief(value)}`;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${path} 不匹配 ${schema.pattern}：${brief(value)}`;
    if (schema.format === 'tactical-expr') return validExpr(value) ? null : `${path} 不是合法表达式：${brief(value)}`;
    if (schema.format === 'tactical-status-id') {
      const known = value === 'suppressed' || Object.hasOwn(ctx.statusTemplates ?? {}, value);
      return known ? null : `${path} 的状态 ID「${value}」未注册`;
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} 必须是数组，实际 ${brief(value)}`;
    if (schema.minItems && value.length < schema.minItems) return `${path} 至少 ${schema.minItems} 项，实际 ${value.length}`;
    for (const [index, item] of value.entries()) {
      const reason = violation(schema.items, item, `${path}[${index}]`, ctx);
      if (reason) return reason;
    }
    return null;
  }
  if (schema.type === 'object' || schema.properties || schema.required || schema.minProperties || schema.additionalProperties === false) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path} 必须是对象，实际 ${brief(value)}`;
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) return `${path} 至少要有一个字段`;
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return `${path} 缺少必填字段 ${key}`;
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames) {
        const reason = violation(schema.propertyNames, key, `${path} 的键`, ctx);
        if (reason) return reason;
      }
      const child = schema.properties?.[key];
      if (!child) {
        if (schema.additionalProperties === false) return `${path} 不接受字段 ${key}`;
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          const reason = violation(schema.additionalProperties, item, `${path}.${key}`, ctx);
          if (reason) return reason;
        }
        continue;
      }
      const reason = violation(child, item, `${path}.${key}`, ctx);
      if (reason) return reason;
    }
    return null;
  }
  return null;
}

/** 校验一条 rule，返回第一条可读错误或 null。 */
export function ruleViolation(rule, ctx) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 'rule 不是对象';
  if (!vmHooks.includes(rule.hook)) return `rule.hook=${JSON.stringify(rule.hook)} 不在允许枚举（${vmHooks.length} 个）`;
  const opcodeSchema = OPCODES[rule.hook === undefined ? 'active' : 'active'];
  void opcodeSchema;
  // 用 rule 的 hook 生成带守卫的 program 判定
  const guarded = (name) => ({ properties: { then: { type: 'array' }, else: { type: 'array' }, body: { type: 'array' },
    onPass: { type: 'array' }, onFail: { type: 'array' }, onCollide: { type: 'array' } } });
  void guarded;
  return violation({ $ref: '#/$defs/rule' }, rule, 'rule', ctx);
}
