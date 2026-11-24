# Phase 2 工作日志

- 基线 master `4cf6060`，干净；本会话串行。probe4：描述符 (11,11) 正确，装载后单位 (0,0)、掩体 (9,9)。probe5：护甲 10→2，寒冷/半速可达数均与基线 24 相同；缺概率阈值实际为 0。
- Batch 1 `1bd4873`：BUG-02/SIMP-13/BUG-09 证实。converter.js 按棋盘尺寸读取坐标、逐个按引擎容量放置，整盘行优先绕回，保留合法叠放，JSON 越界/换位有诊断，无处放置明确失败；descriptor 本来就严格拒绝越界。vm-select.js/tactical-vm.js 越界表达式及寄存器不再夹到边格，执行上下文记录 warning。tests/scale_grid_tavern_tests.mjs、vm_expr_tests.mjs 增加矩形边界/容量/越界回归。npm test 349/349。全量测试后四个 dist 文件已发生变化，最终按构建产物另批处理。
- Batch 2 `10080ff`：BUG-01/03/04、ORTH-11。sunder 保留可编辑的原生 armor，删除重复 VM flat；预设疾走/寒冷无需改格式。combat.js 把实际 moveM（无此字段的预设用 move×cellM）换算成同阶单位，加原生 movement 后使用 aggregateModifiers/applyStatMod，再乘层级尺度换成米，最后统一按棋盘格、冲刺与余量计算。非移动的 checkBonus/initiativeFlat 是加值而非总检定，schema 仅允许 flat，协议同步。聚合公式自身不是 bug。测试 bellica_spatial_tests、vm_schema_tests；npm test 350/350。
- Batch 3a `590de92`：BUG-05/06。combat.js/vm-runtime.js/vm-commit.js/vm-carriers.js：可序列化的大轮边界（含首轮），按实际确认死亡逐个通知存活同阵营者，再结算击杀；原生 expiry 接入实际施法、命中/承击、扣血/回血、死亡/队友死亡/击杀。修正 ds 定位：on_equip 位于 combat.js；轮末/轮初的语义不能靠同步 fire-and-forget，伤害与命中也不能合并（援护、护盾、碎冰）。tests/unit_tests.mjs 与 vm_corpus_tests.mjs 验证隐身/冰冻、援护、直接与间接伤害、队友及轮末询问恢复。npm test 352/352。
- Batch 3b `34a6a2c`：BUG-07/11/12。vm-schema.js/vm-rules.js 要求 chance 显式 dc（0 合法），未校验的运行时指令缺阈值记录 warning，不投骰。tactical-vm.js 对合法候选稳定排序：进攻格/安全格分别最小化/最大化与最近敌人三维距离；最高威胁优先活敌的最高攻击相关属性；first 保持选择器顺序，多选取前 N，仍走原有实体引用与录像输出。ai.js 目标估值读取汇总 locks，避免按状态数重复奖励同一控制。修正 ds：first 原本已等效实现；AI 的旧代码是目标估值，不是动作合法性判断。tests/vm_corpus_tests.mjs，npm test 354/354。复跑 probe4/5：守卫 (11,11)、墙 (11,10)，护甲 10→6，寒冷 24→15、半速 24→8，缺 dc 产生诊断而非假装投骰失败。

- 构建 `92e89c5`：package.json 的 exports 直接指向 dist，四个追踪产物已随源码发生变化；显式 npm run build 后单独提交 dist/index.{mjs,iife.js}、dist/tavern.{mjs,iife.js}。提交前最终 npm test 354/354，无跳过；git status --short 无输出。未 push，未运行独立 Chrome E2E。

- Batch 3A-1（本次落地，提交前）：核验并修复濒死 VM heal 放行、伪资源浮点取整、apMax 回合上限接线、VM 控制锁在跳过/借机/移动/护卫/必中路径的消费、状态 apply 的 appliedRound/appliedTurn 与 extend/stack 护盾累加；统一状态移除清理附属池并保留 removedStatus 快照，after_status_removed 可读取 status.vars/stacks 且自然到期/护盾归零派发亡语；perform 事件加入 chainDepth/triggered 上下文并截断深度。npm test 354/354。四个 dist 文件未纳入本批。

## 待架构汇合确认
列入本轮的运行时缺陷没有因等待架构而搁置。未将三种空间/威胁策略扩展为完整的装备、视线、地形、技能杀伤预测；当前是明确且确定性的启发式。原生 modifiers 与 VM mods 的整体迁移、模板表与标准化协议重整仍交由架构分支，本轮不删旧协议。

## Phase 3A 收尾提交
- `cc56480`：VM 生命周期、回合恢复、状态移除统一化、状态池清理与相关语料测试；提交前 `npm test` 360/360。
- `cd87528`：VM schema/formula/validation 集中化；`validatePools` 增加带 poolId 的孤儿池、贡献者不匹配、缺失引用诊断，并新增单测；提交前 `npm test` 360/360。
- `d8f068d`：确认 `src/core/status_modifiers.js` 全仓无保留调用，将校验迁入 `vm-schema.js` 后删除旧模块；清理 `combat_protocol.js` 中无调用的比例尺别名导出与死导出，保留 `sizeForUnit` 函数体及 `protocolDistance` 公开链路；提交前 `npm test` 360/360。
- `53298b0`：执行 `npm run build`，单独提交 `dist/index.mjs`、`dist/index.iife.js`、`dist/tavern.mjs`、`dist/tavern.iife.js`；构建后再次 `npm test` 360/360。
- 最终核验：旧 `status_modifiers.js` 已删除，协议距离仍由 `prebattle_resources.js` 经 `game_api.js` 公开，工作树清理后无未提交文件；未 push。

## Phase 3B 验收

| 批次 | 提交 | 结果 |
| --- | --- | --- |
| 3B-1 | `72965b1` | 将技能与武器的运行时几何换算集中到 `combat_protocol.js`。`descriptor.js` 现行职责是解析开场声明，两种导入输入均保留原始距离，并经同一战斗运行时换算。验证普通武器、史诗技能与唯一技能的实际射程和半径。变参 `min/max`、`has_status` 和 `zone.x/y` 已有实现及测试。辅助协议校验 hook、stat、flags、aiPolicy 和指令说明的完整集合。`npm test` 361/361。 |
| 3B-2 | `00bcd1a` | 标准化按五种互斥状态显示。默认队列仅发送待编译词条。条目说明和核销收据逐条校验，允许只有说明且省略空 `patch` 的响应。忽略和恢复沿用原浏览器存储键与原警告标识。补丁禁止改写运行时实例资源池绑定。`npm test` 363/363。 |
| 3B-2 补充 | `dde43ba` | Claude、Gemini 原生纯推理返回也会提供输出长度提示，保留字符数和结束原因。 |
| 3B-3 | `cfde920`、`3f0b0d8` | `npm run build` 重新生成四份 `dist/index.{mjs,iife.js}` 与 `dist/tavern.{mjs,iife.js}`。 |
| 3B-3 回归 | `94c596a` | Chrome 覆盖坏收据同批保留两处合法补丁、已解释条目退出重试、辅助 AI 预填、忽略跨重载保存、恢复待编译。补充字段错误准确定位的单测。 |

最终构建后按顺序复跑，全部通过，无跳过。Chrome 版本为 `158.0.8127.36`。

- `npm test` 365/365。
- `npm run test:e2e` 3/3。实测 100 格、4 掩体、4 互动点，1440px 无重叠，390px 竖屏及 844×390 横屏整盘可见。`pageerror` 和 `console.error` 均为 0。
- `node tests/e2e_scale_grid_chrome.mjs` 1/1。验证矩形棋盘、比例尺徽标、同格叠放和精确目标选择。
- 本地 `master` 分批提交，最终工作树干净，未推送。

## Phase 4 Round 2 当前落地（截至 2026-03-06）

- R2-A `04dbb44`：修复装备实例去重（同模板双持/双饰品独立生效）、纯选择器 Schema 与 `shareRulesTo` 校验、零基座 stat 约束、`ask.kind × aiPolicy` 约束、persistent/undispellable 强制驱散门控、重甲命中预览与实际 RATING_TABLE 数学对齐、`untargetableSingle` 单体拦截、spawn 地形 AI 识别；新增回归测试。`npm test` 371/371。
- R2-C 部分 `169ad27`：删除 converter 的旧花括号解析分支；加入诊断 scope 校验（实际调用集合包含 `field`）；overlay 基线单槽深拷贝缓存；补充裸字符串未解决项的冲突锁注释。桥接测试 73/73。
- `9f0f05b`：combat 使用 core 层共享的 `validVmExpiry`，不反向依赖 api 校验层。
- 构建 `0f20ea0`：重新生成并提交四份追踪 dist 产物；`npm test` 371/371，`npm run test:e2e` 3/3，`node tests/e2e_scale_grid_chrome.mjs` 1/1，Chrome pageerror/console.error 均为 0。
- R2-B 已完成：27 个内置状态统一为 VM `vars`/`mods`/`rules`/`flags`/`expireOn` 模板；schema 新增 `incomingAccuracy`、`intentDifficulty`、`shatter` 与 `hidden`、`intercept`、`taunted`、`infiniteAmmo`；combat、VM runtime、命令校验和状态实例化统一读取 VM 聚合结果。旧 `modifiers`、`stackRule`、`tickTiming`、`expireInto`、`statusModifier` 双轨生产路径已删除；`upsert_status` 支持表达式层数上限安全求值。战报改为投影 `mods`/`locks`/`flags`/`rules`/`expireOn`，协议与实例卡同步。`npm test` 371/371，桥接/报告/实例卡测试 61/61，Chrome E2E 3/3，scale-grid E2E 1/1，均无页面异常。

## Phase 4 Round 2 D/E 完成

- `0e6c629`：combat facade 拆分为 `combat-modifiers.js`、`combat-status.js`、`combat-turn.js`、`combat-geo-preview.js`、`combat-actions.js`，保留 `src/core/combat.js` 公共入口；核心回归 390/390。
- `d82cd64`：converter facade 拆分为 `converter-parse.js`、`converter-effects.js`、`converter-unit.js`、`converter-patch.js`，保留 `src/tavern/converter.js` 公共入口；酒馆/比例尺/地形回归 55/55。
- `8fb2dde`：overlay facade 拆分为 `overlay-ai.js`、`overlay-patch.js`、`overlay-sources.js`、`overlay-diagnostics-view.js`，保留 `src/tavern/overlay.js` 公共入口；加入三入口加载契约和 `TAVERN_VERSION === package.json.version` 断言；`npm test` 372/372，Chrome E2E 3/3，scale-grid E2E 1/1。
- `1c6ae88`：基于现行 VM 源码重写 `docs/README.md`、`docs/architecture.md`、`docs/dsl.md`、`docs/status.md`，移除旧双轨和旧 DSL 的现状描述，仅在迁移说明中保留删除记录。
- 最终构建更新四份 `dist/`；`npm test` 372/372，`npm run test:e2e` 3/3，`node tests/e2e_scale_grid_chrome.mjs` 1/1，Chrome pageerror/console.error 均为 0。

## Round 3 Batch R3-B/R3-C 完成

- `479884f`：新增共享 `resolveStatusApplication`，统一原生/VM 状态层数、时长、replace/refresh/stack/extend、变量过滤、护盾叠加、来源位格和模板深拷贝；修复资源 swap 跨池致死判定与零 HP 尸体重复致死问题。
- `e436198`：新增 `EVENT_SCALAR_KEYS` 闭合事件字段校验，并补齐 VM schema 枚举导出（stat、skill shape、selector/zone shape、target、flags、locks、stack/duration 集合）和 combat protocol 基础枚举。
- `e4f1931`：本地 tactical AI 新增基于 VM `zones` 的区域利弊评分，移动/疾跑/撤离/走位后攻击纳入脱离危险区收益；LLM battle AI payload 携带 zones 摘要并提示规避敌方危险区域。
- 最终验证：`npm test` 372/372；`npm run test:e2e` 3/3；`node tests/e2e_scale_grid_chrome.mjs` 1/1；Chrome pageerror/console.error 均为 0。构建已更新四份 `dist/`。

## Round 3 Phase 5C-1 完成

- `3538f10`：validation 接入 VM/combat protocol 权威枚举，补事件字段、技能/区域形状和 corpse 目标回归。
- `122a30a`：converter 真物理拆为 parse/effects/unit/patch 四个实心模块，入口保持 barrel，Tavern/scale/terrain 56/56。
- 本轮 overlay 真物理拆为 AI、patch、sources、diagnostics-view、mount 五个实心模块；入口保持 barrel，DOM id/class/data 选择器和消息事件名未改，Tavern 模块静态依赖环为 0。
- 最终验证：`npm test` 374/374；`npm run test:e2e` 3/3；`node tests/e2e_scale_grid_chrome.mjs` 1/1；Chrome pageerror/console.error 均为 0。补充修正后 `overlay-diagnostics-view.js` 143 行、`overlay-sources.js` 226 行，满足职责模块实心行数护栏；最终构建再次更新四份 `dist/`。

## Round 3 Final 收口（当前真实状态）

- `f011281`：删除四个全仓零引用的 combat 假空壳模块：`combat-modifiers.js`、`combat-status.js`、`combat-turn.js`、`combat-geo-preview.js`；`npm test` 374/374。
- `fc996d8`：纠正文档快照版本、VM/状态计数、命令说明、状态字段、selector/event 白名单说明；新增 `tests/doc_and_arch_contract_tests.mjs` 并接入 `unit_tests.mjs`，契约门禁通过；源码实际命令白名单为 15 项，非任务稿中的 13 项。
- `8e7d3ab`：构建并提交四份 dist 产物。
- 最终实测：`npm test` 378/378；`npm run test:e2e` 3/3；`node tests/e2e_scale_grid_chrome.mjs` 1/1；Chrome pageerror/console.error 均为 0。
- 契约门禁确认 converter/overlay 依赖环为 0、三个门面行数分别为 combat 3、converter 5、overlay 6；四个 combat 假空壳不存在。全仓静态扫描仍发现 combat↔VM 14 条 DFS 路径（`combat.js → combat-actions.js → vm-runtime.js → combat.js`，以及经 `vm-action.js` 的变体），本轮按策略暂不做高风险断环拆分，后续需专门解耦。
