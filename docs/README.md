# Fated Tactical Game 文档索引

本文档描述当前仓库源码，不描述未来计划。代码入口以 `src/` 为准，构建产物由 `build.mjs` 生成到 `dist/`。

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 架构分层、入口、状态模型、事务、酒馆数据流和拆分后的模块边界 |
| [dsl.md](dsl.md) | Tactical VM 的 hooks、opcodes、selectors、stat mods、表达式和公式 |
| [status.md](status.md) | 9 个内核状态、战局自定义模板、实例结构、生命周期与战报投影 |
| [battle-types.md](battle-types.md) | `battle_init`、棋盘、比例尺和战场声明格式 |

## 当前规模

以下数字由当前源码直接统计：

- `src/core/vm-schema.js`：26 个 `vmHooks`、17 个 `vmOpcodes`。
- `src/core/vm-carriers.js`：7 个控制槽位：`attack`、`action`、`move`、`cast`、`reaction`、`fly`、`teleport`。
- `src/presets/status-defaults.js`：9 个内核状态，仅 `suppressed` 保留；演示状态不进入酒馆战局。
- `src/core/combat.js` 是公共门面，当前实现位于 `combat-actions.js`；`src/tavern/converter.js` 聚合 `converter-parse.js`、`converter-effects.js`、`converter-unit.js`、`converter-patch.js`；`src/tavern/overlay.js` 聚合 AI、patch、sources、diagnostics-view 和 mount 实现。
- `src/core/formula.js` 提供安全表达式解析器，不使用 JavaScript `eval`。

## 运行与验证

```sh
npm test
npm run build
npm run test:e2e
node tests/e2e_scale_grid_chrome.mjs
```

`npm test` 运行 `tests/unit_tests.mjs`，该入口加载全部测试集合。Chrome 测试要求本机可启动 Chrome。

## 已删除的旧概念

当前运行时不再使用 `effect_schema.js`、`effects.js`、`effect-protocol.js`、`status_modifiers.js`，也不使用状态双轨字段 `modifiers`、`stackRule`、`tickTiming`、`expireInto`。历史迁移代码或测试若提到这些名称，只表示旧输入的诊断/迁移语义，不是现行运行时契约。
