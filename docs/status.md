# VM 状态系统

权威模板位于 `src/presets/status-defaults.js` 的 `STATUSES`，校验位于 `src/api/validation.js`，运行时载体和 modifier 聚合位于 `src/core/vm-carriers.js`。当前共有 27 个内置状态。

## 1. 统一模板和实例

模板使用以下现行字段：

- 展示：`id`、`name`、`icon`、`category`、`description`。
- 时长：`durationType`、`remainingTurns`、`stackMode`、`maxStacks`。
- VM：`vars`、`mods`、`rules`、`flags`、`expireOn`、`tags`、`tier`。

实例在 `unit.statuses[id]` 中保存模板身份和运行时字段：`id`、`templateId`、`ownerId`、`sourceId`、`sourceCarrier`、`vars`、`mods`、`rules`、`flags`、`stacks`、`maxStacks`、`remainingTurns`、`durationType`、`stackMode`、`expireOn` 以及可选的 authority/applied 字段。

所有状态入口——`grantStatus`、VM `apply_status`、`upsert_status`、converter——都生成该结构。模板和实例均使用 VM 校验。表达式型 `maxStacks` 在命令入口以当前 source/target scope 安全求值。

现行状态系统不使用 `modifiers`、`stackRule`、`tickTiming` 或 `expireInto`。这些字段是已删除的旧双轨格式；外部脏输入只能被 converter 标记为待标准化。

## 2. 内置状态目录

| 状态 | 类别 | VM 语义 |
| --- | --- | --- |
| `suppressed` | control | 全部行动槽锁定；`vars.holdTotal` 保存挣脱阈值 |
| `burn` | dot | `turn_start` 能量伤害 |
| `bleed` | dot | `turn_end` 每层真实伤害 |
| `poison` | dot | `turn_start` 每层真实伤害 |
| `regen` | hot | `turn_start` 治疗 |
| `shield` | shield | `vars.shieldAmount` 吸收伤害 |
| `guarded` | buff | `vars.reduction` 驱动 `damageReduction` |
| `taunt` | control | `mods.flags: taunted` 强制敌方目标 |
| `guard` | buff | `mods.flags: intercept` 拦截伤害 |
| `thorns` | buff | `after_damage` 反伤规则 |
| `stun` | control | 全部行动槽锁定 |
| `freeze` | control | 全部行动槽锁定并提供 `shatter`，命中后解除 |
| `root` | control | 锁 `move` 和 `teleport` |
| `blind` | debuff | 攻击检定劣势 |
| `vulnerable` | debuff | `incomingDamageMult` 增加承伤 |
| `sunder` | debuff | armor flat 降低 |
| `mark` | debuff | `incomingAccuracy` 增加 |
| `stealth` | buff | `hidden`、攻击优势，敌对攻击/行动后解除 |
| `haste` | buff | `movement` 增加 |
| `chill` | debuff | `movement` 和攻击 `checkBonus` 降低 |
| `charge` | buff | `damageMult` additivePercent |
| `lock_on` | buff | 对攻击目标 `checkBonus` 增加 |
| `weakness` | buff | `intentDifficulty` 每层降低 |
| `grappled` | control | 锁 `move` |
| `prone` | debuff | 锁 `move` 并增加 `incomingAccuracy` |
| `infinite_ammo` | buff | `infiniteAmmo` flag |

动作映射由 `actionStatuses` 管理；状态本身仍是普通 VM 模板，不是引擎特例。

## 3. 聚合与结算

`aggregateModifiers(state, unitId, event)` 遍历单位、状态、技能、装备和区域载体：

- `mods.stat` 进入 `stats`，支持 `flat`、`mult`、`additivePercent`。
- `mods.locks` 进入七个行动槽的布尔表。
- `mods.flags` 进入 flags 集合。
- `mods.controlPolicy` 使用字段首次声明值并保留默认策略。
- `when`、`damageType`、`checkKind`、`statusId` 和事件上下文决定某条 modifier 是否适用。

伤害顺序由 combat 与 VM runtime 统一处理：护盾先按状态实例吸收，减伤/护甲/穿透/碎裂/易伤遵循统一管线；`shatter` 是独立比例 stat，`incomingAccuracy` 不等同自身 dodge，避免 `ignoreDodge` 时错误清除受击暴露修正。

## 4. 生命周期

- `battle_turns` 在持有者回合结算时递减。
- `until_removed` 直到显式移除或 `expireOn` 命中。
- `persistent` 跨战快照保留。
- `stackMode` 为 `refresh`、`replace`、`stack` 或 `extend` 时，分别刷新时长、替换、累加层数或延长时长；`maxStacks` 约束累加。
- `ask` 或 VM action 挂起时，状态 frame 序列化保存；恢复不重掷、不重复扣资源、不重复推进回合。
- `persistent`、`undispellable` 等保护由 VM authority/force 规则判断，不由旧状态字段分支实现。

## 5. 提前解除

`expireOn` 是单条或数组规则，每条包含 `hook` 和可选 `filter`。当前 hook 由 `vmHooks` 校验，常见规则包括：

- `after_hit`：受到命中或命中目标后解除。
- `after_damage`：受到伤害后按事件过滤。
- `after_action`：行动结束解除。
- `turn_start` / `turn_end`：回合边界解除。
- `on_death` / `on_kill`：死亡或击杀事件解除。

状态移除使用 `removeVMStatus`，并产生结构化 `after_status_removed` 日志。没有 unit 匹配时，战报按日志中的 `targetId` 解析，不回退到施法者。

## 6. 战报投影

`statusLogDetail(unit, status)` 只输出 VM 快照：`targetId`、状态标识、层数/时长、`vars`、`mods`、`rules`、`flags` 和 `expireOn`。`src/api/battle_report.js` 将其投影为中文：

- `mods.flat`、`mult`、`additivePercent` 显示数值或每层数值。
- `locks` 显示“跳过行动”“无法移动”或具体封锁槽。
- flags 显示隐身、嘲讽、拦截、无限弹药、不可被单体选中等语义。
- 周期 `rules` 显示回合开始/结束的伤害或治疗。
- `expireOn` 显示 hook 和过滤条件。

战报是结构化日志的纯文本投影，不写回状态，也不重新计算战斗结果。
