# 架构与模块边界

## 1. 入口和产物

| 产物 | 源入口 | 格式 |
| --- | --- | --- |
| `dist/index.mjs` | `src/index.js` | ESM |
| `dist/index.iife.js` | `src/index.js` | IIFE，全局 `FatedTactical` |
| `dist/tavern.mjs` | `src/tavern/main.js` | ESM |
| `dist/tavern.iife.js` | `src/tavern/main.js` | IIFE，全局 `FatedTacticalTavern` |

`build.mjs` 使用 esbuild、`target: es2022`、bundle 输出四个追踪产物。源码测试直接运行 Node ESM，不依赖 dist。

## 2. 分层

- `src/core/`：纯战术规则、VM schema/runtime、空间、随机数、战斗流程；`util.js` 是零依赖工具叶子，`status-application.js` 统一状态施加；不依赖 API、酒馆或 DOM。
- `src/api/`：状态校验、命令事务、快照、战报文本投影。
- `src/presets/`：场景、装备、技能和内置 VM 状态模板。
- `src/tavern/`：MVU/char_info/battle_init 摄取、辅助 AI、标准化、overlay 和宿主桥。
- `src/ui/`：棋盘和独立页面 UI。

依赖方向为 core → presets 的数据读取；api 调用 core；tavern 调用 core/api；UI 调用 core/api。核心模块不反向引用 tavern 或 UI。

## 3. 三个稳定门面

### Combat

`src/core/combat.js` 是公共 barrel facade，当前完整实现位于 `src/core/combat-actions.js`。四个历史空壳 combat 子模块已删除；`combat-actions.js` 与 `vm-runtime.js` 仍有待后续解耦的跨层入口，当前不宣称核心层完全无环。职责入口如下：

- `combat-actions.js`：状态、修饰、几何预览、回合推进和动作执行的当前统一实现节点。

所有旧调用仍从 `combat.js` 加载；门面不得改变导出名或 DOM/宿主契约。

### Converter

`src/tavern/converter.js` 是数据摄取门面，核心编排位于 `converter-unit.js`：

- `converter-parse.js`：YAML、battle_init、char_info、MVU、统计与警告 scope。
- `converter-effects.js`：叙事效果到 VM rule/mod 的转换。
- `converter-patch.js`：战报到 MVU JSON Patch 的转换。

MVU 是数值、装备和技能权威；battle_init 只负责站位、朝向、阵营和场景特征。按单位名/角色合并，重复来源只产生一个单位。

### Tavern overlay

`src/tavern/overlay.js` 是宿主挂载门面，浏览器实现按职责拆在以下模块：

- `overlay-ai.js`：请求、流式响应、JSON/JSON Patch 解析。
- `overlay-patch.js`：战局 patch 应用、标准化分区和聊天 patch。
- `overlay-sources.js`：宿主消息读取、开场来源组装与配置。
- `mvu-utils.js`：零依赖的数据工具，集中处理克隆、深合并、JSON Pointer 解码与 patch 回放；战局校验使用严格模式，拒绝不存在的中间路径。
- `overlay-diagnostics-view.js`：来源包和诊断导出。
- `overlay-mount.js`：宿主挂载与 DOM 编排。

`opening-source` 缓存该入口楼层的开场来源，不代表玩家已开打。尚无战斗进度时，重新打开同一入口会重读该楼 MVU；已有进度时，普通重开续接棋盘，不用后续跑文的血蓝覆盖存档。手动「从当前聊天重新水合」才会用变化后的来源重建开场。

拆分不改变既有元素 `id`、`class`、`data-*` 选择器、宿主事件总线事件名或入口正则。

## 4. 战局状态与事务

`state` 的核心表包括 `units`、`items`、`equipment`、`skills`、`statusTemplates`、`zones`、`covers`、`interactives`、`grid`、`logs`、`order`、`round`、`turn` 和 `rng`。状态通过 `validateState` 校验；VM 状态实例使用 `templateId`、`ownerId`、`sourceId`、`vars`、`mods`、`rules`、`flags`、`expireOn` 和时长/层数字段。

命令事务在 clone 上模拟，校验通过后提交并递增 revision；历史帧支持撤销。battle snapshot 包含 origin、state 和 journal，恢复会重放并比较结果。跨战快照只携带 persistent 状态、装备和允许的资源数据。

## 5. VM 运行链

1. `vm-carriers.js` 枚举单位、状态、技能、装备、区域载体。
2. `aggregateModifiers()` 按事件筛选 `mods`，汇总 `stats`、`locks`、`flags` 和 `controlPolicy`。
3. `vm-runtime.js` 收集 hook，创建可挂起的 VM frame。
4. `vm-rules.js` 解释 `let`、`if`、`check`、`ask`、伤害/治疗/资源、状态、移动、生成和动作指令。
5. `vm-commit.js` 将 frame 结果写回 state 并记录结构化日志。
6. `combat.js` 的预览与动作路径共同消费 VM 结果，避免预览与实战双轨。

## 6. 事件与日志

VM 日志包含 `targetId`、`sourceId`、状态/载体标识和可审计 detail。战报文本是 `src/api/battle_report.js` 对结构化日志的纯投影；状态日志只投影 VM `mods`、`locks`、`flags`、`rules` 和 `expireOn`，不读取旧状态修饰对象。
