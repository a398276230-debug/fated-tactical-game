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
