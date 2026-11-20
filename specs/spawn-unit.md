# SPEC：DSL 召唤单位（`spawnUnit`）

实现交接说明。现状依据见 `docs/dsl.md`、`docs/architecture.md`。
**本文只描述要做什么，不描述怎么论证**；每条改动都给了落点和验收标准。

---

## 0. 已定决策（不要再改）

| # | 决策 | 具体含义 |
| --- | --- | --- |
| 1 | 召唤物五维总和按**最终五维**解释 | 世界书 `sum = max(T×5, A×5−30)` 直接当作 `stats` 的最终值之和，不再叠加 `(T−1)` |
| 2 | 不做平衡性偏置 | 不加体质权重、不加 HP 下限、不做高层折减。默认分配为「均分 + 余数」 |
| 3 | 召唤物 `tier = min(召唤者 tier, 节点 tier)` | 节点 `tier` 可选，缺省视为 7（即实际取召唤者 tier） |

沙盘的技能模板没有 `tier` 字段（`src/api/validation.js:123-138` 只校验 `name/ap/slot/range/shape/target/effects` 与可选的 `quality/power/mp/sp/...`），所以「技能层级」当前无处可读，用节点的可选 `tier` 字段承载；`quality` 是未校验的自由文本，不做映射。

---

## 1. 默认值规则（唯一权威实现，写成一个函数）

```
输入：actor（召唤者）, spec（节点字段）
T     = min(actor.tier ?? 1, spec.tier ?? 7)             // 1…7
A     = spec.attribute ? actor.stats[spec.attribute]
      : max(actor.stats.int ?? 0, actor.stats.spi ?? 0)  // 无关联属性标签时
sum   = max(T * 5, A * 5 - 30)
cap   = min(A, TIER_CAP[T], 20)                          // TIER_CAP = [8,10,12,14,16,18,20]

// 均分，余数按固定顺序 str→agi→con→int→spi 各 +1
base  = floor(sum / 5), rem = sum % 5
attr  = [base,base,base,base,base] + (前 rem 项各 +1)

// 逐项套 cap，溢出回收到仍有空位的项；全部触顶则丢弃多余
for each attr: attr[i] = min(attr[i], cap)

// 资源：直接复用现有公式，不另写
resources = calculatePrebattleResources({ stats: attr, tier: T, bodyLengthM: spec.bodyLengthM ?? 1.7,
                                          count: 1, summonCount: spec.count ?? 1 }).resources
mc        = 同上函数的 mc
maxHp     = spec.maxHp ?? resources.hp.max
maxMp     = spec.maxMp ?? resources.mp.max
maxSp     = spec.maxSp ?? resources.sp.max
```

参照值（用于单测断言）：

| 场景 | T | A | sum | 每项 | cap | maxHp |
| --- | --- | --- | --- | --- | --- | --- |
| 弱召唤者 | 1 | 3 | 5 | 1/1/1/1/1 | 3 | 105 |
| 中段 | 4 | 9 | 20 | 4/4/4/4/4 | 9 | 4020 |
| 顶配 | 7 | 20 | 70 | 14×5 | 20 | 140070 |

显式 `spec.stats` 的校验：`每项 ≤ cap` 且 `总和 ≤ sum`，超限即校验失败（不允许 AI 用显式值超模）。

---

## 2. 节点定义

新增节点 kind（**不改 `summon`**，两者语义不同：`summon` 是克隆已有原型，`spawnUnit` 是凭空定义）：

```js
{
  kind: 'spawnUnit',
  name: '沙偶',            // 必填，1…100 字
  count: 1,                // 1…10
  tier: 3,                 // 可选，1…7，缺省取召唤者
  attribute: 'int',        // 可选，str|agi|con|int|spi，关联属性
  stats: { str: 2, agi: 1, con: 3, int: 2, spi: 1 },  // 可选，显式覆盖
  maxHp: 100, maxMp: 20, maxSp: 20,                   // 可选
  armor: 0, size: 3, bodyLengthM: 1.8, mc: 1, move: 2, // 全部可选
  skills: ['slam'],        // 可选，≤32，必须是 state.skills 里已有的 ID
  mainHand: 'wood-cudgel', // 可选，装备**模板** ID（state.equipment），实例由引擎铸造
  offHand: null, shield: null,
  gear: []                 // 可选，≤12，模板 ID，实例由引擎铸造
}
```

`label/target/condition/radius/enabled` 由公共 node helper 自动带上。

---

## 3. 改哪里

### 3.1 `src/core/effect_schema.js`

在 `node.oneOf` 里 `summon`（第 77 行）后面加一个分支：

```js
node('spawnUnit', {
  name: string, count: integer(1, 10), tier: integer(1, 7),
  attribute,                                  // 文件里已有：enumOf('str','agi','con','int','spi')
  stats: object({ str: integer(-20, 50), agi: integer(-20, 50), con: integer(-20, 50),
                  int: integer(-20, 50), spi: integer(-20, 50) }, ['str','agi','con','int','spi']),
  maxHp: integer(1, 1e9), maxMp: integer(0, 1e9), maxSp: integer(0, 1e9),
  armor: integer(0, 1e6), size: integer(1, 5), bodyLengthM: number(.01, 1e9),
  mc: integer(1, 64), move: integer(1, 10),
  skills: array(id, 32, 0), gear: array(id, 12, 0),
  mainHand: id, offHand: id, shield: id
}, ['name'])
```

`src/tavern/effect-protocol.js` 自动跟着 schema 更新（它遍历 `node.oneOf`），**不要手改**该文件。

### 3.2 `src/api/validation.js`

1. `validateEffect(e, state)`（第 80 行）里加 `spawnUnit` 分支：
   - `stats` 五键齐全、每项整数；`skills` 每项 `has(state.skills, id)`；`gear/mainHand/offHand/shield` 每项 `has(state.equipment, templateId)`；
   - `mainHand` 模板必须 `kind ∈ {weapon, ranged}` 或 `!kind`；`shield` 模板必须 `kind === 'shield'`；`gear` 模板 `kind ∈ {armor, accessory, auxiliary, consumable}`；
   - 用第 1 节的公式重算 `sum/cap`，若给了 `stats` 则校验 `每项 ≤ cap`、`总和 ≤ sum`。
   - `state` 缺失时跳过跨表检查（`validateEffect` 已有 `state` 参数，见第 80 行）。
2. `validateState`（第 211 行起）已会遍历 `equipment/skills/effectTemplates` 的表达式并调用 `validateEffect(e, state)`；确认新增分支在 `validateState` 路径上被覆盖，必要时补一条显式断言（参考第 218 行 `summonTemplates` 的写法）。

### 3.3 `src/core/effects.js`

`executeNodes` 的 switch（第 234 行 `case 'summon'` 旁边）加：

```js
case 'spawnUnit': result = io.spawn(state, actor, { ...p, node }, ctx); break;
```

`p` 已经是 `{...expr.params, ...node}`，节点字段优先，无需额外合并。

### 3.4 `src/core/combat.js`

新增 `function spawnUnitEffect(state, actor, spec, ctx)`，放在 `spawnEffectUnit`（第 559 行）之后，并在 `dsl` 工厂里注册 `spawn: (state, actor, spec, ctx) => spawnUnitEffect(...)`（第 588 行 `summon:` 旁边）。

职责（按顺序）：

1. **预算**：`count` 已由 schema 限 1…10；每次调用前检查 `Object.keys(state.units).length + count <= 200` 与 `state.order.length + count <= 200`，否则记日志并返回 `false`。
2. **数值**：按第 1 节算出 `stats/cap/tier/mc/maxHp/maxMp/maxSp`。
3. **装备铸造**：对 `mainHand/offHand/shield/gear` 每个模板 ID 生成实例
   ```js
   const id = nextItemId(state);                       // item-N，确定性递增
   state.items[id] = { id, templateId, counters: initialCounters(state.equipment[templateId]) };
   ```
   `initialCounters` 从 `./effects.js` 导入（已有导出）。`mainHand/offHand/shield` 指向刚铸造的实例 id，`gear` 收集其余实例 id。
4. **落点**：复用 `allCells/emptyGround/distance`，取距 `ctx.center ?? actor` 最近的空格（与 `spawnEffectUnit` 完全一致）。找不到空格时 `record(state, actor, 'spawn_unresolved', ...)` 并返回 `false`（不静默失败）。
5. **建单位**：`id = summon-N`，与现有 `summon` 共用同一计数器命名空间（`while (Object.hasOwn(state.units, 'summon-' + index)) index++`）。字段必须满足 `unitValue`：
   ```js
   { id, name: spec.name, team: actor.team, x, y, facing: [...actor.facing],
     hp: maxHp, maxHp, mp: maxMp, maxMp, sp: maxSp, maxSp, ap: 0, used: { attack: 0, action: 0 },
     stats, armor: spec.armor ?? 0, size: spec.size ?? sizeClassFor(bodyLengthM), move: spec.move ?? 3,
     weapon: mainHandInstanceId ?? null, mainHand: ..., offHand: ..., shield: ...,
     gear, skills: [...spec.skills], statuses: {}, tier, mc,
     ...(spec.bodyLengthM != null ? { bodyLengthM: spec.bodyLengthM } : {}) }
   ```
6. **写入**：`state.units[id] = unit; state.order.push(id);` 然后 `record(state, actor, 'spawn', `${name}登场`, { unitId: id })`（事件类型沿用现有 `spawn`，UI 已能播）。
7. **确定性**：全程不使用 `Math.random()`/日期；`item-N`、`summon-N` 都用「扫描已用编号」的方式递增，保证快照重放一致。

### 3.5 `src/core/combat_protocol.js`（可选但建议）

把 `converter.js:512` 里那串嵌套三元提取成：

```js
export function sizeClassFor(bodyLengthM) {
  const v = sizeFor(bodyLengthM).value;
  return v === 2 ? 1 : v === 1 ? 2 : v === 0 ? 3 : v === -1 ? 4 : 5;
}
```

`converter.js:512` 改为 `const size = sizeClassFor(bodyLengthM)`，行为不变。`spawnUnit` 复用同一函数，避免两处漂移。

### 3.6 文档

- `docs/dsl.md` 第 7 节节点表加一行 `spawnUnit`（字段 + 行为 + 与 `summon` 的区别）。
- `docs/architecture.md` 第 8 节日志事件表加 `spawn_unresolved`。
- 第 4 节的 `spawn_unit` 命令与新节点在文档里注明「命令=全量单位，DSL=按公式生成」。

---

## 4. 不做的事（明确排除）

- 不改 `summon` 节点语义（保持克隆 + `statScale`）。
- 允许内联定义技能/装备模板（等于让 AI 战斗中铸技能）。只认 `state.skills` / `state.equipment` 里已有的 ID。
- 不加体质权重、HP 下限、层级折减。
- 不加 `level` 字段（世界书召唤规则不使用等级）。
- 不动 `spawn_unit` 命令（它已经能造任意单位，供 UI 命令面板用）。

---

## 5. 验收

新增 `tests/spawn_unit_tests.mjs`，并在 `tests/unit_tests.mjs` 的 import 列表里注册。

必须覆盖：

1. **默认值**：T1/A=3 → `stats` 全 1、`maxHp=105`；T4/A=9 → 全 4、`maxHp=4020`；T7/A=20 → 全 14、`maxHp=140070`。
2. **cap**：T7/A=20 时 `stats` 每项 ≤20；T1/A=3 时显式 `stats:{str:4,...}` 被拒绝。
3. **总和上限**：显式 `stats` 总和 > `sum` 被拒绝。
4. **tier 取小**：召唤者 T5 + 节点 `tier:2` → 单位 `tier=2`、HP 用 `hpTier[1]`。
5. **引用校验**：`skills:['不存在']` 被拒绝；`mainHand:'不存在'` 被拒绝；`shield` 指向非盾牌模板被拒绝。
6. **装备铸造**：`mainHand` 指向消耗品模板时 `state.items` 多一个实例、`counters` 等于 `initialCounters`、`unit.mainHand` 指向该实例。
7. **落点与上限**：棋盘填满时返回失败并写 `spawn_unresolved`；`count:10` 生成 10 个单位、id 连续。
8. **日志**：每次成功生成写一条 `spawn`，`unitId` 正确。
9. **事务**：`proposeCommands` + `commitProposal` 能撤销一次含 `spawnUnit` 的行动（状态 diff 回到原样，`state.items` 里铸造的实例也回滚）。
10. **快照重放**：`exportSnapshot` → `importSnapshot` 后单位与实例 id 一致（确定性）。

跑法：`node tests/unit_tests.mjs`（本机 Node 18 已知有 1 条 `crypto is not defined` 的既有失败，与本次改动无关）。
