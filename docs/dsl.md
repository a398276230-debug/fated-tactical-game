# Tactical VM DSL

现行效果协议是 RISC 风格的战术 VM。规则由 hook、条件、程序和正交指令组成；业务词汇通过组合 `mods`、`rules`、资源、锁和事件实现，不新增业务宏。

权威源码：`src/core/vm-schema.js`、`src/core/vm-rules.js`、`src/core/vm-runtime.js`、`src/core/vm-carriers.js`、`src/core/formula.js`。辅助 AI 看到的协议由 `src/tavern/vm-effect-protocol.js` 注入。

## 1. 规则形状

```json
{
  "hook": "before_check",
  "when": "target.team != self.team",
  "program": [
    { "op": "check", "chance": 50, "onPass": [{ "op": "mutate_event", "patch": { "cancel": true } }] }
  ]
}
```

规则可携带 `id`、`enabled`、`source`、`tags`、`tier`、`mods`、`locks`、`flags`、`controlPolicy` 和 `shareRulesTo`。状态、技能、装备、区域是 VM 载体；单位状态实例在 `vars` 中保存运行时数据。

## 2. Hooks（26）

`active`、`before_action`、`before_target`、`before_check`、`after_natural_roll`、`after_check`、`before_commit`、`before_status`、`on_lethal_p1`、`on_lethal_p2`、`after_action`、`after_move`、`after_hit`、`after_damage`、`after_heal`、`after_status_applied`、`after_status_removed`、`on_status_immunized`、`on_summon_evict`、`on_death`、`on_ally_death`、`on_kill`、`turn_start`、`turn_end`、`round_start`、`round_end`。

hook 的可写事件字段由 schema 针对每个 hook 限定。`before_check` 可改检定，`before_commit` 可改最终值或取消，`before_status` 可阻止状态，致命结算使用 `on_lethal_p1/p2` 两阶段。

## 3. Opcodes（17）

| opcode | 用途 |
| --- | --- |
| `let` | 将表达式结果写入当前 frame 或 owner scope |
| `if` | 条件分支 |
| `for_each` | 对 selector 快照逐项执行 body |
| `check` | 概率/DC 检定，分流 `onPass/onFail` |
| `ask` | 可挂起的玩家/AI 选择，结果写入 `vars` |
| `damage` | 走统一伤害和致死管线 |
| `heal` | 走治疗倍率、拦截和 `after_heal` |
| `resource` | 资源池 add/sub/set 及 max 操作 |
| `link_pool` | 合并或拆分单位资源池 |
| `apply_status` | 施加 VM 状态，支持免疫穿透裁定 |
| `remove_status` | 按 selector/where 移除状态，强制驱散需 `force` |
| `mutate_event` | 改写当前允许字段 |
| `move` | 移动、推拉、瞬移和高度 |
| `spawn` | 生成 unit、zone、terrain、cover 或 item |
| `despawn` | 清除指定 VM 实体 |
| `revive` | 复活并遵守 `blockRevive` |
| `perform` | 压入独立技能或 replay 动作 |

每个 opcode 都必须在 `vm-schema.js` 的 `opNotes` 有中文用途与易错点说明；缺注释的节点不会生成 schema。

## 4. stat mods、锁和 flags

`statMod.stat` 当前包括五维属性和：`movement`、`incomingDistanceOffset`、`armor`、`armorPierce`、`armorPiercePercent`、`damageMult`、`finalDamageMult`、`incomingDamageMult`、`damageFlat`、`damageReduction`、`damageReductionFlat`、`dr`、`healingMult`、`incomingHealMult`、`costMult`、`checkBonus`、`dcBonus`、`resistBonus`、`dodge`、`advantage`、`initiativeFlat`、`critDamageBonus`、`apMax`、`incomingAccuracy`、`intentBonus`、`intentDifficulty`、`shatter`。

- flat-only stats：`incomingDistanceOffset`、`armorPierce`、`damageFlat`、`damageReductionFlat`、`dcBonus`、`resistBonus`、`advantage`、`dodge`、`checkBonus`、`initiativeFlat`、`critDamageBonus`、`incomingAccuracy`、`intentBonus`、`intentDifficulty`。
- 受击闪避：`dodge` 是独立的 `statMod.stat`。攻方命中减去守方闪避得到净命中修正；引擎没有独立闪避检定，`statMod.checkKind` 禁止填写 `"dodge"`。例如 `{ "stat": "dodge", "flat": 15 }` 会扣减攻方 15 点命中。
- 意图对抗：攻方 `intentBonus` 加到攻方总值，守方 `intentDifficulty` 加到对抗难度，均不改变普通命中。例如猎人帽的「命中核心判定 +5」写 `{ "stat": "intentBonus", "flat": 5, "when": "event.intent == 'core'" }`。敌对打击检定前读取声明意图，检定失败后该目标分支读取 `normal`；外层 `after_action` 保留声明值，非打击事件不含此键。
- ratio stats：`damageReduction`、`dr`、`armorPiercePercent`、`shatter`。
- multiplier stats：`incomingDamageMult`、`damageMult`、`finalDamageMult`、`healingMult`、`incomingHealMult`、`costMult`。
- 控制槽：`attack`、`action`、`move`、`cast`、`reaction`、`fly`、`teleport`。
- flags：`preserveLife`、`blockRevive`、`blockResourceRestore`、`untargetableSingle`、`harmless`、`guaranteed_hit`、`guaranteed_crit`、`hidden`、`intercept`、`taunted`、`infiniteAmmo`。

`aggregateModifiers()` 汇总每个单位在事件上下文中的 stats、locks、flags、controlPolicy。表达式型 `flat`/`mult`/`additivePercent` 在 carrier scope 中求值；同一载体声明按模板和索引去重。

## 4.1 资源池作用域

`pools` 是装备实例池的模板声明，例如武器弹药。装备规则作用域用 `item.resource.<poolId>` 读取当前实例余额，缺省为数字 `0`；`resource` 指令的 `local:true` 才读写该实例池。`event.souls` 等业务专用事件字段不属于 DSL。

`unitPools` 是挂在单位身上的命名共享池，equipment、skill、unit 模板均可声明：

```json
{
  "unitPools": {
    "souls": { "name": "灵魂", "cap": 10, "initial": 0 }
  }
}
```

初始化时同一单位的同名声明合并为一个池，当前值默认 `initial ?? 0`。跨载体规则用 `self.resource.<poolId>` 或 `resource(self, "<poolId>")` 读取和修改；技能的 `resourceCost: {"resource":"<poolId>","amount":N}` 也按单位池扣费。标准化 AI 必须读取 roster 末尾的 `<role_readonly_index>`，复用其中 `sharedPoolLedger` 已登记的 `poolId`、名称和语义；不要把共享池写成 equipment `pools`，也不要为同一资源重新命名。

MVU 角色原本存在并被转换器绑定的单位池带有 `mvuBound` 语义，战斗结束的净变化按 `sourceMap` 写回原 MVU 路径。没有对应 MVU 字段的单位池只在本场战斗中生效，战后不会生成 MVU 写回补丁。标准化 AI 修改池的 `cap` 时应复用已有 `poolId`，不能覆盖整张 `unitPools` 表。

## 4.2 伤害类型与元素

`damageType` 统一表示内置和自定义伤害类型。14 种内置类型为 `physical`（物理）、`energy`（能量）、`mental`（精神）、`true`（真实）、`fire`（火焰）、`cold`（冰霜）、`lightning`（雷电）、`thunder`（雷鸣）、`acid`（酸蚀）、`poison`（毒素）、`necrotic`（暗蚀）、`radiant`（光耀）、`force`（力场）和 `psychic`（心灵）。`fire`、`cold`、`lightning`、`thunder`、`acid`、`poison`、`necrotic`、`radiant`、`force` 默认按能量类减伤，`psychic` 按精神类减伤。

持久自定义元素登记在 `customElements`，键必须是合法 ASCII ID，值至少包含同名 `id` 与展示用 `name`，可选 `aliases` 和 `category`（`physical`、`energy` 或 `mental`）。自定义元素仍使用 `damageType`，例如 `{ "damageType": "void" }`，不增加平行的 `element` 字段。`before_commit` 支持写入 `damageType`，引擎会按新的类型重新计算尚未显式覆盖的最终伤害。

```json
{
  "customElements": {
    "void": { "id": "void", "name": "虚空", "category": "energy" }
  },
  "damageType": "void"
}
```

## 5. Selector、spawn 和状态引用

selector 使用 `from`、`options`、`of`、`area`、`where`、`pick`、`flags`、`origin`、`sort` 等 schema 字段；纯 selector 才能用于载体共享规则。`event.<field>` 只允许 `vm-schema.js` 导出的 `EVENT_SCALAR_KEYS` 闭合白名单，未知字段在 schema 阶段拒绝；表达式运行时仍对缺失字段返回 `null`。`spawn` 的 `entityKind` 决定 spec：unit 支持 `templateId/copyOf/spawnPanel/count`，zone/terrain/cover 使用区域和剩余回合，item 支持模板与数量。生成 ID 由已用数字后缀确定性递增。

状态引用使用 `statusId`、`status.vars.<key>`、`status.stacks` 和 `status.remainingTurns`。所有入口生成同一种 VM 状态实例；状态效果不再使用原生修饰对象。

## 6. 安全表达式

`src/core/formula.js` 的 `validExpr`、`compileExpr`、`evaluateExpr` 只接受解析器支持的表达式，不执行任意 JavaScript。当前查询函数包括：

`min`、`max`、`floor`、`ceil`、`abs`、`cells_m`、`scale_cells`、`clamp`、`distance`、`resource`、`has_status`、`has_tag`、`in_zone`、`is_immune`、`any_unit_has_status`、`count_units`、`count`、`sum`。

公式上下文提供 `self`、`attacker`、`target`、`source`、`candidate`、`status`、`zone`、`skill`、`item`、`event`、`vars`、`round`、`turn`、`timeOfDay`、`cellM`、棋盘尺寸和资源/层数/变量引用。

## 7. 校验与执行

1. `vm-schema.js` 进行闭合字段、枚举、范围、hook 和 opcode 结构校验。
2. `validation.js` 校验模板、实例、单位、资源池和完整 state。
3. `tactical-vm.js` 负责 frame、hook 调度和可序列化 VM host。
4. `vm-runtime.js` 收集当前 hook 的规则并创建 frame。
5. `vm-rules.js` 逐步执行 frame；`ask` 可挂起且恢复不会重掷或重复扣费。
5. `vm-commit.js` 事务性写回并记录日志。

旧的 `effect_schema.js`、`effects.js`、`effect-protocol.js` 不属于现行 DSL；旧输入只在酒馆 converter 的兼容摄取路径中转成 VM 结构。
