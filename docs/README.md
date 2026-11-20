# 文档索引

本目录只记录代码现状，不记录计划、不做辩护性说明。每条事实都能在列出的源文件里直接核对。

| 文档 | 覆盖 |
| --- | --- |
| [architecture.md](architecture.md) | 入口与产物、五层依赖方向、45 个源文件归属、战局状态模型、事务/撤销/快照、动作与命令、预览结构、日志事件、结算顺序、酒馆数据流、容量上限 |
| [dsl.md](dsl.md) | 效果 DSL 的三级结构、表达式字段、13 触发器、4 种检定、33 种条件、7 种目标、25 个节点 kind、passive/exec 两条路径、数值与资源语义、地形节点、校验链、旧 kind 迁移表 |
| [status.md](status.md) | 26 条内置状态、实例字段、修饰键三层空间、施加/结算/到期/净化/持久化、7 条引擎专用分支、内建来源、AI 权重、未接线字段 |

## 速查

| 项 | 数量 | 权威位置 |
| --- | --- | --- |
| 内置状态 | 26 | `src/core/combat.js` 的 `STATUSES` |
| 状态修饰键（引擎可读） | 19 数值键 + 11 布尔标志 + 1 枚举（`damageType`） | `src/core/status_modifiers.js` |
| 自定义模板可设修饰键 | 21 | `src/api/validation.js` 的 `customModifierKeys` |
| DSL 节点 kind | 25（26 个 schema 分支） | `src/core/effect_schema.js` 的 `$defs.node` |
| DSL 触发器 | 13 | 同上 `$defs.expression` |
| DSL 条件 | 33 个具名 type（数组形式等价 AND） | 同上 `$defs.condition` |
| DSL 目标 | 7 | 同上 |
| 检定形式 | 4（d20 门槛 / 概率 / 豁免 / 对抗） | 同上 `$defs.expression.roll` |
| 旧效果 kind | 25（+8 个别名） | `src/core/effects.js` 的 `adaptLegacyEffects` |
| 写命令 | 15 | `src/api/commands.js` |
| 动作类型 | 20 + `skill` | `src/core/combat.js` 的 `ACTIONS` + 技能模板 |
| 日志事件 type | 52 字面量 + 4 变量（move/sprint/disengage/raise_dead） | `src/core/combat.js`、`terrain-effects.js` |
| 源文件 | 45（core 11 / api 4 / presets 2 / tavern 18 / ui 9 / 根 1） | `src/` |
| 源码行数 | 9251（含 `src/index.js`） | `wc -l src/*.js src/*/*.js` |

## 复核方式

```sh
# 内置状态表与统计
node -e "import('./src/core/combat.js').then(m=>console.log(Object.keys(m.STATUSES).length))"

# DSL 节点/触发/条件枚举
node -e 'import("./src/core/effect_schema.js").then(m=>{const d=m.effectSchema.$defs;console.log(d.node.oneOf.map(r=>r.properties.kind.const));console.log(d.expression.properties.trigger.enum)})'

# 效果校验与迁移回归
node tests/unit_tests.mjs
node tests/dsl_tests.mjs && node tests/dsl_v12_tests.mjs && node tests/dsl_v13_tests.mjs
node tests/dsl_migration_tests.mjs && node tests/custom_status_tests.mjs

# 预览/日志/事务相关
node tests/api_expansion_tests.mjs && node tests/control_state_tests.mjs
```

已知现状：本机 Node 18.19 下 `node tests/unit_tests.mjs` 有 1 条失败（`char fingerprint merges raw sources…`），原因是 `node:test` 进程里没有全局 `crypto`，`src/tavern/char-snapshots.js` 的 `crypto.subtle.digest` 抛 `crypto is not defined`；单独用 `node` 直接调用同一函数可正常返回哈希。其余用例通过。

## 维护约定

- 改 `effect_schema.js`：同步 `dsl.md` 第 2/3/5/6/7 节；`EFFECT_PROTOCOL` 会自动跟随 schema，无需改 `effect-protocol.js`。
- 改 `STATUSES` 或 `status_modifiers.js`：同步 `status.md` 第 1/3 节；`status-catalog.js` 是手写文本，需要同时改。
- 改 `ACTIONS`、命令表或 `state` 字段：同步 `architecture.md` 第 4/6 节。
- 改日志 `record()` 的 type：同步 `architecture.md` 第 8 节与 `src/ui/narrate.js` 的投影。
