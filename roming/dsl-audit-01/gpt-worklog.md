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
- R2-B 已完成：27 个内置状态统一为 VM `vars`/`mods`/`rules`/`flags`/`expireOn` 模板；schema 新增 `incomingAccuracy`、`intentDifficulty`、`shatter` 与 `hidden`、`intercept`、`taunted`、`infiniteAmmo`；combat、VM runtime、命令校验和状态实例化统一读取 VM 聚合结果。旧 `modifiers`、`stackRule`、`tickTiming`、`expireInto`、`statusModifier` 双轨生产路径已删除；`upsert_status` 支持表达式层数上限安全求值。战报改为投影 `mods`/`locks`/`flags`/`rules`/`expireOn`，协议与实例卡同步。`npm test` 371/371，桥接/报告/实例卡测试 61/61，Chrome E2E 3/3，scale-grid E2E 1/1，均无页面异常。R2-D 三大文件拆分与 R2-E 四份 docs 重写仍未完成，故本轮不标记 `GPT-PHASE4-DONE`。
