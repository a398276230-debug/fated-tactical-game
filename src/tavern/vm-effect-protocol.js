import { formulaReference, formulaQueryNames } from '../core/formula.js';
import { opNotes, vmHooks, vmSchema } from '../core/vm-schema.js';

const defs = vmSchema.$defs;
const range = schema => [
  schema.minimum === undefined ? '' : `≥${schema.minimum}`,
  schema.maximum === undefined ? '' : `≤${schema.maximum}`,
  schema.exclusiveMinimum === undefined ? '' : `>${schema.exclusiveMinimum}`,
].filter(Boolean).join(' ');

function describe(schema) {
  if (schema.format === 'tactical-expr') return 'Expr 字符串';
  if (schema.format === 'tactical-status-id') return '已定义状态 ID';
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map(describe).join(' 或 ');
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.join(' / ');
  if (schema.type === 'array') return `数组<${describe(schema.items)}>${schema.minItems > 0 ? `（至少 ${schema.minItems} 项）` : ''}`;
  if (schema.properties) return `{${fields(schema)}}`;
  if (schema.type === 'object' && schema.propertyNames) return `ID → ${describe(schema.additionalProperties)} 的对象`;
  if (schema.pattern) return `字符串（${schema.pattern}）`;
  return [schema.type, range(schema)].filter(Boolean).join(' ');
}

function fields(schema, omit = []) {
  return Object.entries(schema.properties).filter(([key]) => !omit.includes(key))
    .map(([key, value]) => `${key}${schema.required?.includes(key) ? '' : '?'}: ${describe(value)}`).join('，');
}

const instructions = defs.opcode.oneOf.map(schema => {
  const op = schema.properties.op.const;
  return `• ${op}：${opNotes[op]} {${fields(schema, ['op', 'enabled', 'label'])}}`;
});
const eventPatches = Object.entries(defs).filter(([key]) => key.startsWith('patch_'))
  .map(([key, schema]) => `• ${key.slice('patch_'.length)}：{${fields(schema)}}`);
const spawnSpecs = Object.entries(defs).filter(([key]) => key.startsWith('spawn_'))
  .map(([key, schema]) => `• ${key.slice('spawn_'.length)}：{${fields(schema)}}`);

export const VM_EFFECT_PROTOCOL = `【战术 VM 效果协议】
rules 是规则数组。规则：{${fields(defs.rule, ['hook'])}，hook: 以下枚举}。
允许 hook：${vmHooks.join(' / ')}。
同一载体内规则 ID 唯一。规则由高 priority 到低 priority 执行；program 按数组顺序执行。filter 必须求得 true 才进入规则。规则和指令均可写 enabled:false 暂停执行，label 为显示名。只有与事件相符的载体会触发规则；用 filter 区分事件的施放者或承受者，例如 "attacker.id == self.id"。

【Opcode】每个指令对象必填 op，其值是下列名称。? 表示可省，闭合对象只接受列出的字段。
${instructions.join('\n')}
check 的 kind:chance 用 dc 与 d100 点数比较，例如 dc:25 表示 25% 成功率。豁免未通过时运行 onFail。ask 的 kind 为 cell/entity 时必填 select，为 option 时必填 options，为 number 时必填 min/max。perform 的 skill 只配 skillId，replay 只配 tapeRecord。resource 的 add/sub/set 需要 amount，swap 需要一个 pool 和 otherPool。move 的 step/teleport 用 to，push/pull 用 distance，altitude 用 deltaZ 或 land:true。
mutate_event 的 patch 必须至少有一个字段，只能用于下列可写 hook，嵌套分支亦然：
${eventPatches.join('\n')}
spawn 的 spec 由 entityKind 决定，unit 的 templateId/copyOf/spawnPanel 三选一；terrain 至少有 kind 或 height，提供 mode 时必须有 height：
${spawnSpecs.join('\n')}
zoneArea：${describe(defs.spawn_zone.properties.area)}。rect 需 rect 对象，cells 需 cells 数组。

【表达式与选择】
Expr 为 JSON 数字、布尔值或安全表达式字符串。表达式内的字符串字面量用单引号，例如 "event.damageType == 'physical'"。支持 + - !、算术、比较、&&、||、三元与括号。变量和查询严格使用注册表，不支持任意属性路径或副作用函数。
变量：${formulaReference}。
查询：${formulaQueryNames().join('、')}。
selector：${describe(defs.selector)}。of 只用于 statuses；where 逐个检查 candidate；random 使用战局 RNG。area.origin 省略时以 self 为中心。
targetRef：${describe(defs.targetRef)}。用选择器指定 ID 时，可用 {"from":"units","where":"candidate.id == 'p1'"}，并将 p1 替换为快照 ID。

【声明式修饰】
mods 是修饰数组，每项 ${describe(defs.statMod)}。至少有 stat、locks、flags 或 controlPolicy；填写数值修饰时必须指定 stat。组合值为 (基础 + flat 总和) × (1 + additivePercent 总和) × mult 连乘。when 必须求得 true 才生效。controlPolicy：${describe(defs.controlPolicy)}。`;
