# 计数器资源名与显示名 —— 交接说明

> 目标读者：接手实现的模型。所有行号基于当前仓库 `version 0.2.9`，改动前请先自行核对一遍再动手。
> 只做两件事：**A 资源名的运行时校验**、**B 计数器显示名统一**。
> 不做计数器跨战斗持久化（那是主模型更新 MVU 的事，与本仓库无关）。

---

## 0. 一句话结论

`produceResource` 这套计数器机制**功能完整、无需新增节点**，缺的只是两个边角：
名字写错了没人管（运行时静默返回 0），以及界面上只有 `souls`/`ammo` 有中文名。

---

## 1. 现状事实（都可核对，写实现前先读一遍）

### 1.1 节点与两个池

`src/core/effect_schema.js:101` 注册了三个资源类节点：

```js
...['restoreResource','drainResource','produceResource'].map(kind => node(kind, {
  ...resource,                                   // resource: id, amount, percent, scaling...
  minimumRemaining: amount, requireFull: bool, local: bool,
  ...(kind === 'produceResource' ? { cap: integer(1,1e9), initial: integer(0,1e9), reloadable: bool, targetTierBase: integer(1,8) } : {}),
  percentPerCost: fraction }, ['resource']))
```

其中 `resource` 字段用的是 `effect_schema.js:8` 的 `id`：

```js
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };
```

两个存储位置：

| 写法 | 落在哪 | 代码 |
| --- | --- | --- |
| `local: true` | 装备实例 `items[<id>].counters[resource]` | `effects.js:230-246` → `combat.js:1260 changeCounter` |
| 不写 `local` | 单位 `unit.resources[resource]` | `effects.js:246` |

读取统一走 `effects.js:117-121`：

```js
function resource(state, unit, name) {
  if (['hp','mp','sp','ap'].includes(name)) return unit[name] ?? 0;
  if (name === 'action' || name === 'attack') return unit.used[name] ? 0 : 1;
  return own(unit.resources, name) ?? io.resourcePool(state, unit, name)?.amount ?? 0;
}
```

按目标阶级产出（指数，`targetTierBase: 4` → tier1:1 / tier2:4 / tier3:16）在 `effects.js:189`。

### 1.2 已有的校验

| 位置 | 已校验的内容 |
| --- | --- |
| `validation.js:103-105` | `node.initial != null` 时必须有 `node.cap` 且 `initial <= cap` |
| `validation.js:258-262` | `items[].counters` 的键必须与该装备模板声明的计数器一一对应，且数值 `0 <= n <= cap` |
| `commands.js:62-67` | `adjust_item_counter` 的 `counterKey` 必须已存在于实例 |
| `commands.js:78-79` | 不允许热改装备槽类型或计数器定义 |

### 1.3 缺口（就是本次要补的）

1. **`validateEffect` 完全不校验 `resource` 名。** 运行时校验是手写的（`validation.js:79`），它不走 JSON Schema，所以 `effect_schema.js:8` 那个 `pattern` 在运行时**实际不生效**。`resource: '魂数'`、`resource: 'has space'`、`resource: ''` 都能进 state。
2. **`local: true` 找不到池时静默跳过。** `effects.js:232` 的 `if (node.local && !pool) return false;` 没有任何 warning。拼错一个字母，效果永远不触发，界面上什么都没发生。
3. **内置名可以被当成实例计数器。** `changeResource` 里 `name === 'hp'` 走 `io.heal/loseHP`（`effects.js:234-236`），所以 `{kind:'produceResource', resource:'hp', local:true}` 不会写计数器，而是**直接治疗血量**。

### 1.4 显示名散落三处

| 位置 | 写法 |
| --- | --- |
| `src/ui/narrate.js:14` | `const COUNTER_NAMES = { souls: '魂数', ammo: '弹药' };`，仅 `:225` 使用 |
| `src/ui/render.js:272` | 内联同一张表：`({ souls:'魂数', ammo:'弹药' })[k] ?? k` |
| `src/api/battle_report.js:206` | 正则替换：`.replace(/\bsouls\b/g,'魂数').replace(/\bammo\b/g,'弹药')` |

任何其他计数器（`kills`、`charge`、`blood`…）在三处都会原样显示英文键名。

### 1.5 顺带一条需要更正的事实

`damageReductionFlat`（固定减伤）**是存在且生效的**，不是死代码：

- `combat.js:370` 定义 `damageAfterFlatReduction`
- `combat.js:346`（普通伤害）与 `combat.js:1227`（AOE 伤害）都调用了它
- `stats` 枚举里有它（`effect_schema.js:16`），`battle_report.js:5` 也有中译

所以「额外提供 5 点物理减伤」可以写成：

```json
{ "kind": "modifyStat", "stat": "damageReductionFlat", "flat": 5, "damageType": "physical" }
```

不需要新增任何节点。**本次不涉及这一条**，仅作记录。

---

## 2. 修改 A：资源名校验

### A1 新增 `src/core/resource_names.js`

`src/core` 出边必须为 0（不许 import 其他目录），这个文件只导出常量和一个纯函数：

```js
// 内置资源：读写走 unit 上的固定字段，不能当实例计数器用。
export const BUILTIN_RESOURCES = Object.freeze(['hp', 'mp', 'sp', 'ap', 'action', 'attack']);

// 已知资源的中文名。自定义计数器不在表里时原样显示键名。
export const RESOURCE_NAMES = Object.freeze({
  hp: '生命', mp: '法力', sp: '体力', ap: '行动点', action: '动作', attack: '攻击',
  souls: '魂数', ammo: '弹药',
});

export const resourceLabel = name => RESOURCE_NAMES[name] ?? name;

// 与 effect_schema.js:8 的 id pattern 保持一致。
export const validResourceName = name => typeof name === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)
  && !Object.hasOwn(Object.prototype, name) && name !== 'prototype';
```

### A2 在 `validateEffect` 里补校验

`src/api/validation.js`，在 `for (const node of effectNodes(e.effects))` 循环体内，**紧挨现有的 `node.initial` 判断之前**插入：

```js
if (['restoreResource', 'drainResource', 'produceResource'].includes(node.kind)) {
  requireThat(validResourceName(node.resource), `DSL resource 名称 ${node.resource}`);
  if (node.local) requireThat(!BUILTIN_RESOURCES.includes(node.resource), `DSL 实例计数器不能使用内置资源 ${node.resource}`);
}
```

顶部加 `import { BUILTIN_RESOURCES, validResourceName } from '../core/resource_names.js';`。

注意：`local` 不限定时可以合法地 `restoreResource {resource:'hp'}`（恢复生命），**所以内置名的限制只在 `local: true` 时生效**，别写反。

### A3 转换期给出「引用了未声明计数器」的警告

`src/tavern/converter.js` 的 `normalizeEquipment`（约 `:392-428`），在 `const template = { name, kind, effects }` 组装完成后、`const counters = initialCounters(template)` 之前插入：

```js
const declaredResources = new Set(resourceDefinitions(template).map(node => node.resource));
for (const expr of template.effects) {
  for (const node of effectNodes(expr.effects)) {
    if (!node.local || !['produceResource', 'restoreResource', 'drainResource'].includes(node.kind)) continue;
    if (!declaredResources.has(node.resource)) {
      sink.push(`装备「${name}」引用了未声明的实例计数器 ${node.resource}，运行时会被跳过`);
    }
  }
}
```

需要的 import 改动（`converter.js` 顶部）：

```js
import { adaptLegacyEffects, initialCounters, resourceDefinitions } from '../core/effects.js';
// effectNodes 若尚未引入，从 './effect_schema.js' 或 '../core/effect_schema.js' 引入
```

`sink` 在 `normalizeEquipment` 的参数里已经有（`sink` 由 `hydrateFromSources` 传入的 `sink(unitId, source, scope, path)` 构造），直接 `sink.push(...)` 即可，warning 会带上 `unitId`/`originPath`，扫描诊断块里能看见。

**保留 `effects.js:232` 的静默 `return false` 不要动**——运行时容错是刻意的，A3 只是让它在转换期可见。

---

## 3. 修改 B：显示名统一

### B1 `src/ui/narrate.js`

删除 `:14` 的 `const COUNTER_NAMES = ...`，改为：

```js
import { resourceLabel } from '../core/resource_names.js';
```

`:225` 改成：

```js
return out({ icon: '◈', quiet: true, title: `${item} 的${resourceLabel(d.counterKey)} ${d.before} → ${d.after}` });
```

**注意**：`narrate.js` 目前没有导出 `COUNTER_NAMES`，所以删除不会破坏其他模块；但也请顺手确认 `grep -rn "COUNTER_NAMES" src/` 为空。

### B2 `src/ui/render.js`

`:272` 的

```js
const counters = Object.entries(inst?.counters ?? {}).map(([k, n]) => `${({ souls: '魂数', ammo: '弹药' })[k] ?? k} ${n}`);
```

改成

```js
const counters = Object.entries(inst?.counters ?? {}).map(([k, n]) => `${resourceLabel(k)} ${n}`);
```

顶部加 `import { resourceLabel } from '../core/resource_names.js';`（该文件已 import 了 `../core/effects.js` 等核心模块，不违反分层）。

### B3 `src/api/battle_report.js`

`:206` 的两个全局正则替换，改成只替换本事件真正涉及的那个键：

```js
case 'counter':
  add(replaceUnitNames(event, text).replace(
    detail.counterKey ? new RegExp(`\\b${detail.counterKey}\\b`, 'g') : /$^/,
    resourceLabel(detail.counterKey)));
  break;
```

理由：原来那两行会把正文里任何 `souls`/`ammo` 字样都换掉，且对 `kills` 之类无效；按 `detail.counterKey` 精确替换才是对的。`counter` 事件的 detail 形状见 `combat.js:1264`（`{instanceId, counterKey, before, after}`）。

顶部加 `import { resourceLabel } from '../core/resource_names.js';`。

### B4 `src/tavern/engine-summary.js`（可做可不做）

`:26` 目前只有一句「装备模板 equipment 与实例 items 用 templateId 关联；计数在实例 counters」。若想帮主模型记住可用词，可以补一句：

```
计数器的名字自定义，界面上 souls 显示为「魂数」、ammo 显示为「弹药」；其他名字原样显示。实例计数器必须在同一装备的 passive/self 里用 produceResource 声明 cap，否则运行时跳过。
```

改这段不影响测试（`tests/ai_session_tests.mjs` 只检查节点说明是否出现在组装消息里，不检查这句话）。

---

## 4. 测试（必须补，写进 `tests/unit_tests.mjs`）

1. **合法计数器可正常读写**：模板含 `{trigger:'passive',target:'self',effects:[{kind:'produceResource',resource:'souls',cap:10,initial:0}]}` + 实例 `counters:{souls:0}` → `validateState` 通过；`initialCounters(template)` 返回 `{souls:0}`。
2. **非法 resource 名被拒**：`resource: '魂数'`、`resource: 'has space'`、`resource: ''` 三种都要 `assert.throws`。
3. **内置名不能当实例计数器**：`{kind:'produceResource', resource:'hp', local:true}` 要 `assert.throws`；同样的节点去掉 `local` 或换成 `restoreResource {resource:'hp'}` 必须**通过**。
4. **未声明计数器产生 warning**：用一个含 `{kind:'produceResource', resource:'soul', local:true}` 但 passive 里声明的是 `souls` 的模板走 `mapEffects`/`convertSources`，断言 warnings 里存在以「引用了未声明的实例计数器 soul」结尾的条目。
5. **显示名**：`resourceLabel('souls') === '魂数'`、`resourceLabel('kills') === 'kills'`；一条 `counter` 事件经 `battle_report` 渲染后文本包含「魂数」且不含 `souls`。

建议直接扩 `tests/dsl_tests.mjs` 或 `tests/api_expansion_tests.mjs`（后者已有计数器命令的用例可参照）。

---

## 5. 明确排除

- **不改 MVU 持久化**：计数器生命期就是一场战斗（`state` 内），跨战斗由主模型写回 MVU，仓库侧不做回写。
- **不加 resource 白名单**：自定义计数器（`kills`/`charge`/`blood`）是设计允许的，A2 只挡非法字符与内置名冲突。
- **不动 `effects.js:232` 的静默返回**。
- **不动 `damageReductionFlat`**（见 1.5，已生效）。
- **不动 CSS**：本次不涉及 `styles/*.css`，因此**不需要重新生成 `src/ui/styles.js`**。

---

## 6. 验收

```bash
npm test                    # 已知既有失败：char-snapshots 的 crypto is not defined（Node 18 的 node:test 子进程无全局 crypto），与本次无关
node.exe build.mjs          # 构建通过，dist/ 更新
```

改动面：新增 1 个文件、改 5 个文件、补 5 组断言。无 schema 破坏性变更，旧快照不受影响（校验只是变严，且只对 `local: true` + 内置名这一种写法生效——仓库内现有预设与快照均未使用该组合）。
