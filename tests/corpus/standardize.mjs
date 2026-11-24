#!/usr/bin/env node
// 把 tests/corpus 里的每一条效果交给 LLM 标准化成战术 VM 的 rules，并用引擎自己的校验器验收。
//
// 用法：
//   VM_API_KEY=... node tests/corpus/standardize.mjs            # 全量
//   VM_API_KEY=... LIMIT=4 node tests/corpus/standardize.mjs    # 冒烟
//   ONLY=反派角色 LIMIT=20 ...                                  # 只跑某张卡
// 环境变量：VM_API(base)、VM_API_KEY、VM_MODEL、CONCURRENCY、LIMIT、ONLY、REPAIR_ROUNDS、MAX_TOKENS
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './load.mjs';
import { VM_EFFECT_PROTOCOL } from '../../src/tavern/vm-effect-protocol.js';
import { validVmRule, validVmOpcode, vmHooks, vmOpcodeSchema, vmSchema } from '../../src/core/vm-schema.js';
import { validExpr, formulaReference, formulaQueryNames } from '../../src/core/formula.js';
import { equipmentTemplate, skillTemplate } from '../../src/api/validation.js';
import { buildScenario } from '../../src/presets/scenarios.js';
import { STATUSES } from '../../src/presets/status-defaults.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = (process.env.VM_API ?? 'http://127.0.0.1:8317/v1').replace(/\/$/, '');
const KEY = process.env.VM_API_KEY ?? '';
const MODEL = process.env.VM_MODEL ?? 'deepseek-v4.1-flash';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 3));
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const ONLY = process.env.ONLY ?? '';
// Production policy: one local repair maximum. REPAIR is retained as a documented
// alias for old runs, but values above one are deliberately clamped.
const REPAIR = Math.min(1, Math.max(0, Number(process.env.REPAIR_ROUNDS ?? process.env.REPAIR ?? 0) || 0));
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 2600);
// 只重跑上一次失败的那批条目：传入上一轮 failed.json 的路径。
const FAILED_FROM = process.env.FAILED_FROM ?? '';
const OUTDIR = join(HERE, 'results');

if (!KEY) { console.error('缺少 VM_API_KEY'); process.exit(2); }

// 校验用的真实战局状态：状态模板表必须是引擎认可的那一份
const scenario = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol' });
const state = { statusTemplates: scenario.statusTemplates, skills: scenario.skills, equipment: scenario.equipment };
const STATUS_LIST = Object.keys(STATUSES).join(', ');

// ---------- 分组：一个条目一次请求 ----------
const rows = loadCorpus().filter(row => !ONLY || row.file.includes(ONLY));
const items = new Map();
for (const row of rows) {
  const key = `${row.file}|${row.source.uid}|${row.item.name}|${row.item.section ?? ''}`;
  if (!items.has(key)) items.set(key, { key, row, effects: [] });
  items.get(key).effects.push(row.effect);
}
const failedKeys = FAILED_FROM ? new Set(JSON.parse(readFileSync(FAILED_FROM, 'utf8')).map(record => record.key)) : null;
const work = [...items.values()].filter(entry => !failedKeys || failedKeys.has(entry.key)).slice(0, LIMIT);
console.log(`条目 ${work.length} 个（效果 ${work.reduce((n, w) => n + w.effects.length, 0)} 条），并发 ${CONCURRENCY}，模型 ${MODEL}`
  + (failedKeys ? `，只重跑上一轮失败的 ${failedKeys.size} 个` : ''));

// ---------- 提示词 ----------
const SYSTEM = `你是「命定战术沙盘」的 VM 规则编译器。把中文技能/装备效果编译成战术 VM 的 rules 数组。
只输出一个 JSON 对象，形如 {"rules":[...]}，不要解释、不要 Markdown 代码块。
规则：{id, hook, program, label?, priority?, usesPerBattle?, filter?}，program 是 opcode 数组。
要求：
1. 效果里每一条（每个「效果名」或每个自然段）至少产出一个 rule，按出现顺序排列；多条效果可以拆成多条 rule。
2. hook 只能取协议里列出的枚举值；「受到伤害时」用 after_damage，「致命伤害」用 on_lethal_p2（preventDeath）或 on_death，「命中后」用 after_hit，「行动前拦截」用 before_action，「检定前」用 before_check，「施加状态前」用 before_status，「主动技能」用 active，「回合开始/结束」用 turn_start/turn_end。
3. 状态 ID 只能从这份已注册表里选：${STATUS_LIST}。描述里出现表外状态名时，用最接近的已注册状态近似，并在 rule.label 里写原名。
4. 无法精确表达的机制，用现有 opcode 近似，并把近似点写进 label，不要发明新 opcode 或新字段。
5. 数值用协议允许的形式：数字或表达式字符串（如 "3 + self.tier"）。表达式里的字符串字面量用单引号。
6. 描述里没有数量的（如「高额」「少量」），按下列基准取整：一次攻击的一击 ≈ 目标 10% 最大 HP；"固定伤害+N" 写成 damage.amount 的常量 N；"减伤 X%" 写成 statMod(dr, flat: X/100)；"伤害提高 X%" 写成 statMod(damageMult, mult: 1+X)。`;

const userPrompt = ({ row, effects }) => {
  const item = row.item;
  const lines = [
    `条目类型：${row.category === 'equipment' ? '装备' : row.category === 'skill' ? '技能' : '未知'}`,
    `名称：${item.name}`,
    item.quality ? `品质：${item.quality}` : null,
    item.mode ? `模式：${item.mode}` : null,
    item.cost ? `消耗：${item.cost}` : null,
    item.kind ? `子类：${item.kind}` : null,
    item.tags?.length ? `标签：${item.tags.join(' ')}` : null,
    item.description ? `描述：${item.description.slice(0, 200)}` : null,
    '',
    '效果：',
    ...effects.map((e, i) => `${i + 1}. ${e.name ? `${e.name}：` : ''}${e.text}`),
    '',
    '输出 {"rules":[...]}，至少一条规则；每条效果的规则 id 用英文小写下划线，唯一。',
  ];
  return lines.filter(l => l !== null).join('\n');
};

// ---------- HTTP ----------
async function chat(messages, { maxTokens = MAX_TOKENS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(`${API}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0, stream: false }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(timer); }
}

const stripFence = raw => {
  let text = String(raw ?? '').trim();
  text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};

// ---------- 诊断：把「不符合 vmSchema」拆成可读的原因 ----------
// 通过与否只由引擎判定（validVmRule / validVmOpcode）；下面的 walker 只负责在不通过时
// 说清是哪个字段、为什么，避免把「模型写错」和「诊断误判」混为一谈。
const OPCODES = Object.fromEntries(vmOpcodeSchema.$defs.opcode.oneOf.map(schema => [schema.properties.op.const, schema]));
const DEFS = vmSchema.$defs;
const deref = schema => schema && schema.$ref ? DEFS[schema.$ref.split('/').pop()] : schema;
const BRANCHES = ['then', 'else', 'body', 'onPass', 'onFail', 'onCollide'];
const show = value => JSON.stringify(value)?.slice(0, 120) ?? String(value);

// 递归按 schema 走一遍，返回第一个具体问题（路径 + 原因）
function walk(value, schema, path, hook) {
  schema = deref(schema);
  if (!schema) return null;
  if (schema.allOf) for (const sub of schema.allOf) {
    const reason = walk(value, sub, path, hook);
    if (reason) return reason;
  }
  // if/then/else 是条件分支：if 只作为判定，不报错
  if (schema.if) {
    const matched = walk(value, schema.if, path, hook) === null;
    const branch = matched ? schema.then : schema.else;
    if (branch) {
      const reason = walk(value, branch, path, hook);
      if (reason) return reason;
    }
  }
  if (schema.oneOf || schema.anyOf) {
    const errors = [];
    for (const branch of schema.oneOf ?? schema.anyOf) {
      const reason = walk(value, branch, path, hook);
      if (!reason) return null;
      errors.push(reason);
    }
    // 类型不匹配的分支说明不了什么，优先报表达式/枚举这类具体问题
    const typeOnly = /不是(布尔值|数字|字符串|整数|数组|对象)/;
    return errors.find(error => error.includes('表达式不合法')) ?? errors.find(error => !typeOnly.test(error)) ?? errors[0];
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return `${path}=${show(value)} 应为 ${show(schema.const)}`;
  if (schema.enum && !schema.enum.includes(value)) return `${path}=${show(value)} 不在 ${schema.enum.slice(0, 12).join('/')}${schema.enum.length > 12 ? '…' : ''} 之内`;
  if (schema.format === 'tactical-expr' || schema.format === 'combat-formula') {
    return typeof value === 'string' && !validExpr(value) ? `${path} 的表达式不合法：${show(value)}` : null;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} 应为对象，实际 ${show(value)}`;
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const extra = Object.keys(value).filter(key => !Object.hasOwn(props, key));
      if (extra.length) return `${path} 出现未定义字段 ${extra.join(',')}（允许：${Object.keys(props).join(',') || '无'}）`;
    }
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return `${path} 缺少必填字段 ${key}`;
    for (const [key, sub] of Object.entries(props)) {
      if (!Object.hasOwn(value, key)) continue;
      const reason = walk(value[key], sub, `${path}.${key}`, hook);
      if (reason) return reason;
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} 应为数组，实际 ${show(value)}`;
    for (const [index, child] of value.entries()) {
      const reason = walk(child, schema.items ?? {}, `${path}[${index}]`, hook);
      if (reason) return reason;
    }
    return null;
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) return `${path}=${show(value)} 不是整数`;
  if (schema.type === 'number' && !Number.isFinite(value)) return `${path}=${show(value)} 不是数字`;
  if (schema.type === 'string' && typeof value !== 'string') return `${path}=${show(value)} 不是字符串`;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path}=${show(value)} 不是布尔值`;
  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path}=${value} 小于 ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path}=${value} 大于 ${schema.maximum}`;
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value))
    return `${path}=${show(value)} 不符合格式 ${schema.pattern}`;
  return null;
}

function explainOpcode(op, hook, path = '') {
  if (!op || typeof op !== 'object') return `${path} 不是对象`;
  const schema = OPCODES[op.op];
  if (!schema) return `${path} op=${show(op.op)} 不是合法指令`;
  const extra = Object.keys(op).filter(key => !Object.hasOwn(schema.properties, key));
  if (extra.length) return `${path} ${op.op} 出现未定义字段 ${extra.join(',')}`;
  const missing = (schema.required ?? []).filter(key => !Object.hasOwn(op, key));
  if (missing.length) return `${path} ${op.op} 缺少必填字段 ${missing.join(',')}`;
  if (op.op === 'mutate_event') {
    const patch = DEFS[`patch_${hook}`];
    if (!patch) return `${path} mutate_event 不能用于 ${hook}`;
    const reason = walk(op.patch, patch, `${path}.patch`, hook);
    if (reason) return `${reason}（${hook} 可写：${Object.keys(patch.properties).join(',') || '无'}）`;
    const rest = walk({ ...op, patch: undefined }, { ...schema, properties: { ...schema.properties, patch: { type: 'object' } } }, path, hook);
    return rest;
  }
  // entityKind 之类会切换 spec 的整份 schema，直接按 allOf 条件展开
  const reason = walk(op, schema, path, hook);
  if (reason) return reason;
  for (const branch of BRANCHES) {
    for (const [index, child] of (Array.isArray(op[branch]) ? op[branch] : []).entries()) {
      const childReason = explainOpcode(child, hook, `${path}.${branch}[${index}]`);
      if (childReason) return childReason;
    }
  }
  return null;
}

// 引擎说 opcode 不合法、但 walker 没定位到时的兜底：逐个删键探测，谁删掉就合法就是谁。
function collectPaths(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push({ path, depth: path.split('.').length });
    collectPaths(child, path, out);
  }
  return out;
}
function deleteAt(target, path) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((node, key) => node?.[key], target);
  if (parent && typeof parent === 'object') delete parent[last];
}
function isolate(op, hook) {
  const candidates = collectPaths(op).sort((a, b) => b.depth - a.depth);
  for (const { path } of candidates) {
    const clone = structuredClone(op);
    deleteAt(clone, path);
    if (validVmOpcode(clone, { hook })) return path;
  }
  return null;
}

function explainRule(rule) {
  if (!rule || typeof rule !== 'object') return 'rule 不是对象';
  if (validVmRule(rule, { statusTemplates: state.statusTemplates })) return null;
  if (!vmHooks.includes(rule.hook)) return `hook=${show(rule.hook)} 不在允许枚举`;
  if (!Array.isArray(rule.program)) return 'program 不是数组';
  for (const [index, op] of rule.program.entries()) {
    const reason = explainOpcode(op, rule.hook, `program[${index}]`);
    if (reason) return reason;
  }
  for (const [index, op] of rule.program.entries()) {
    if (validVmOpcode(op, { hook: rule.hook })) continue;
    const path = isolate(op, rule.hook);
    if (path) return `program[${index}] ${op.op} 的 ${path} 非法（删掉它就通过校验）`;
  }
  const reason = walk(rule, DEFS.rule, 'rule', rule.hook);
  return reason ?? 'rule 其余字段不合法（id/label/priority/usesPerTurn/usesPerBattle/cooldownTurns/filter/enabled/dedupeKey）';
}

// ---------- 校验 ----------
function validate(item, rules) {
  const problems = [];
  if (!Array.isArray(rules)) return { ok: false, problems: ['rules 不是数组'] };
  if (!rules.length) problems.push('rules 为空');
  rules.forEach((rule, index) => {
    const reason = explainRule(rule);
    if (reason) problems.push(`rule[${index}] ${rule?.id ?? '?'}: ${reason}`);
  });
  // 整条目校验：把 rules 挂到模板上，走引擎真正的入口
  if (problems.length === 0) {
    try {
      if (item.category === 'equipment') equipmentTemplate({ name: item.name, rules }, state);
      else skillTemplate({ name: item.name, ap: 1, slot: 'action', range: 1, shape: 'single', target: 'enemy', rules }, state);
    } catch (error) { problems.push(`条目校验失败：${error.message}`); }
  }
  return { ok: problems.length === 0, problems };
}

// ---------- 并发池 ----------
const results = [];
let done = 0;
async function handle(entry) {
  const user = userPrompt(entry);
  const record = { key: entry.key, file: entry.row.file, uid: entry.row.source.uid, name: entry.row.item.name,
    category: entry.row.category, effects: entry.effects.length, attempts: 0, ok: false, problems: [], rules: [] };
  try {
    let content = await chat([{ role: 'system', content: SYSTEM + '\n\n' + VM_EFFECT_PROTOCOL }, { role: 'user', content: user }]);
    record.attempts++;
    let rules, verdict;
    const accept = text => {
      let parsed;
      try { parsed = JSON.parse(stripFence(text)); } catch (error) { return { error: `JSON 解析失败：${error.message}` }; }
      const explicitUnresolved = Array.isArray(parsed?.unresolved) && parsed.unresolved.length > 0;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rules)) return { error: '缺少 rules 数组', explicitUnresolved };
      const verdict = validate(entry.row.item, parsed.rules);
      return { rules: parsed.rules, ...verdict, explicitUnresolved };
    };
    let outcome = accept(content);
    record.firstPass = !outcome.error && outcome.ok === true;
    // Repair syntax, schema, and VM validation failures once. An explicit
    // unresolved disposition is a deliberate answer and must never be repaired.
    for (let round = 0; round < REPAIR && !outcome.explicitUnresolved && (outcome.error || !outcome.ok); round++) {
      const diagnostic = outcome.error || outcome.problems.join('；') || 'VM 校验失败';
      content = await chat([
        { role: 'system', content: SYSTEM + '\n\n' + VM_EFFECT_PROTOCOL },
        { role: 'user', content: user },
        { role: 'assistant', content: content.slice(0, 4000) },
        { role: 'user', content: `输出不合格，精确诊断：${diagnostic}。只输出修正后的 {"rules":[...]}，不要输出 unresolved。` },
      ]);
      record.attempts++;
      outcome = accept(content);
    }
    if (outcome.error) record.problems.push(outcome.error);
    else {
      record.rules = outcome.rules;
      record.problems = outcome.problems;
      record.ok = outcome.ok;
      record.hooks = [...new Set(outcome.rules.map(r => r?.hook))];
      record.opcodes = [...new Set(outcome.rules.flatMap(r => Array.isArray(r?.program) ? r.program.map(o => o?.op) : []))];
    }
    record.raw = content.slice(0, 4000);
  } catch (error) {
    record.problems.push(`请求失败：${error.message}`);
  }
  results.push(record);
  done++;
  if (done % 10 === 0 || done === work.length) {
    const okCount = results.filter(r => r.ok).length;
    console.log(`[${done}/${work.length}] 通过 ${okCount}（${((okCount / done) * 100).toFixed(0)}%）`);
  }
  return record;
}

// 写盘：边跑边落，避免中途断掉白跑
mkdirSync(OUTDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = join(OUTDIR, `run-${stamp}.jsonl`);
writeFileSync(outFile, '');
const save = record => appendFileSync(outFile, JSON.stringify(record) + '\n');

async function main() {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
    while (cursor < work.length) {
      const entry = work[cursor++];
      save(await handle(entry));
    }
  }));
  const ok = results.filter(r => r.ok);
  const stats = {};
  const bucket = text => text.includes('hook=')
    ? 'hook 不在枚举'
    : text.includes('未定义字段') ? '指令出现未定义字段'
    : text.includes('缺少必填字段') ? '指令缺必填字段'
    : text.includes('.of 只能配') ? 'selector.of 用错 from'
    : text.includes('patch 用于') ? 'mutate_event 字段与 hook 不匹配'
    : text.includes('不在 ') ? '字段值不在枚举/范围'
    : text.includes('不是合法指令') ? 'op 名不存在'
    : text.includes('表达式不合法') ? '表达式不合法'
    : text.includes('条目校验失败') ? '整条目校验失败'
    : text.includes('JSON') ? 'JSON 解析失败'
    : text.includes('请求失败') ? '请求失败'
    : text.includes('表达式不合法') ? '表达式不合法'
    : text.includes('枚举') || text.includes('不在 ') ? '字段值不在枚举/范围'
    : text.includes('应为对象') || text.includes('应为数组') || text.includes('不是布尔值')
      || text.includes('不是数字') || text.includes('不是整数') || text.includes('不是字符串') ? '字段类型不符'
    : text.includes('小于') || text.includes('大于') ? '数值越界'
    : text.includes('rule 其余字段') ? 'rule 其余字段不合法'
    : '其它';
  for (const r of results) for (const p of r.problems) {
    const key = bucket(p);
    stats[key] = (stats[key] ?? 0) + 1;
  }
  const hookCount = {}, opcodeCount = {};
  for (const r of ok) for (const h of r.hooks ?? []) hookCount[h] = (hookCount[h] ?? 0) + 1;
  for (const r of ok) for (const o of r.opcodes ?? []) if (o) opcodeCount[o] = (opcodeCount[o] ?? 0) + 1;
  const report = {
    model: MODEL, at: stamp, items: results.length, effects: work.reduce((n, w) => n + w.effects.length, 0),
    repairRounds: REPAIR,
    prerequisites: 'VM_API_KEY plus VM_API (or documented local compatible endpoint); this corpus runner makes paid model requests when configured.',
    firstPassPassed: results.filter(row => row.firstPass).length,
    firstPassRate: `${(results.filter(row => row.firstPass).length * 100 / results.length).toFixed(1)}%`,
    passed: ok.length, failed: results.length - ok.length,
    passRate: `${((ok.length / results.length) * 100).toFixed(1)}%`,
    rulesProduced: results.reduce((n, r) => n + (r.rules?.length ?? 0), 0),
    rulesInvalid: results.reduce((n, r) => n + r.problems.filter(p => p.startsWith('rule[')).length, 0),
    hookCount, opcodeCount, problemKinds: stats,
  };
  writeFileSync(join(OUTDIR, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUTDIR, 'failed.json'), JSON.stringify(results.filter(r => !r.ok), null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('详细：' + outFile);
}

main();
