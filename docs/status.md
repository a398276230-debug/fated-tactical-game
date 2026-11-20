# 状态系统（现状记录）

源码分布：

| 位置 | 内容 |
| --- | --- |
| `src/core/combat.js` | `STATUSES` 内置表（26 条）、`grantStatus`、`patchStatus`、`expireStatuses`、`tick`、时长递减 |
| `src/core/status_modifiers.js` | 修饰键合法区间、类型判别、`damageTypes` |
| `src/api/validation.js` | 自定义模板校验、实例校验、`defineStatus` |
| `src/tavern/status-catalog.js` | 由内置表渲染的状态目录文本（注入提示词） |
| `src/tavern/converter.js` | 导入时的状态 ID 归一（别名/中文名） |
| `src/core/ai.js` | 敌方 AI 的状态价值权重 |

内置状态数量为 **26 条**（`Object.keys(STATUSES).length === 26`）。其中 7 条（`shield`、`guard`、`taunt`、`thorns`、`freeze`、`stealth`、`infinite_ammo`）在引擎里有专用分支，其余由通用修饰键读取驱动。仓内不存在“14 条基础状态”的划分或常量。

---

## 1. 内置状态表

`STATUSES` 由 `def(name, icon, category, remainingTurns, description, modifiers, options)` 冻结生成，字段固定为
`{id, name, icon, category, description, remainingTurns, durationType:'battle_turns', tickTiming:'onTurnStart', stackRule:'refresh', maxStacks:1, modifiers}`。

| id | 名称 | category | 默认回合 | tick | 叠层 | 默认 modifiers |
| --- | --- | --- | --- | --- | --- | --- |
| `burn` | 灼烧 | dot | 2 | onTurnStart | refresh/1 | `damage:5, damageType:'energy'` |
| `bleed` | 流血 | dot | 3 | **onTurnEnd** | stack/5 | `damage:3, damageType:'true'` |
| `poison` | 中毒 | dot | 3 | onTurnStart | stack/4 | `damage:3, damageType:'true'` |
| `regen` | 再生 | hot | 3 | onTurnStart | refresh/1 | `heal:5` |
| `shield` | 护盾 | shield | 2 | onTurnStart | replace/1 | `amount:8` |
| `guarded` | 坚壁 | buff | 1 | onTurnStart | refresh/1 | `reduction:0.35` |
| `taunt` | 嘲讽 | control | 1 | onTurnStart | refresh/1 | `taunted:true` |
| `guard` | 援护 | buff | 2 | onTurnStart | refresh/1 | `intercept:true` |
| `thorns` | 反伤棘甲 | buff | 2 | onTurnStart | refresh/1 | `reflect:5` |
| `stun` | 眩晕 | control | 1 | onTurnStart | refresh/1 | `skip:true` |
| `freeze` | 冰冻 | control | 1 | onTurnStart | refresh/1 | `skip:true, shatter:0.5` |
| `root` | 定身 | control | 2 | onTurnStart | refresh/1 | `rooted:true` |
| `blind` | 致盲 | debuff | 2 | onTurnStart | refresh/1 | `disadvantage:1` |
| `vulnerable` | 易伤 | debuff | 2 | onTurnStart | refresh/1 | `vulnerability:0.35` |
| `sunder` | 破甲 | debuff | 2 | onTurnStart | refresh/1 | `armor:-4` |
| `mark` | 标记 | debuff | 2 | onTurnStart | refresh/1 | `incomingAccuracy:2` |
| `stealth` | 隐身 | buff | 2 | onTurnStart | refresh/1 | `hidden:true, advantage:1` |
| `haste` | 疾走 | buff | 2 | onTurnStart | refresh/1 | `movement:1` |
| `chill` | 寒冷 | debuff | 2 | onTurnStart | refresh/1 | `movement:-1, accuracy:-2` |
| `charge` | 蓄力 | buff | 1 | onTurnStart | refresh/1 | `damageBonus:0.15` |
| `lock_on` | 定位 | buff | 1 | onTurnStart | refresh/1 | `accuracy:1` |
| `weakness` | 弱点识别 | buff | 3 | onTurnStart | stack/3 | `intentDifficulty:-2` |
| `grappled` | 擒抱 | control | 1 | onTurnStart | refresh/1 | `rooted:true` |
| `prone` | 倒地 | debuff | 1 | onTurnStart | refresh/1 | `incomingAccuracy:2, rooted:true` |
| `disarmed` | 缴械 | debuff | 1 | onTurnStart | refresh/1 | `disarmed:true` |
| `infinite_ammo` | 无限弹药 | buff | 1 | onTurnStart | refresh/1 | `infiniteAmmo:true` |

分类分布：dot 3、hot 1、shield 1、buff 9、control 5、debuff 7。
`shield` 是内置表里唯一的 `category:'shield'`；自定义模板不允许该分类（见第 5 节）。

---

## 2. 实例字段

`statusValue()` 的白名单即权威清单：

```
id, name, icon, category, description, remainingTurns, durationType, tickTiming,
stackRule, maxStacks, modifiers, stacks, sourceUnitId,
appliedRound?, appliedTurn?, amount?, expireInto?, expireOn?
```

- `id/name/icon/category/description` 必须与模板一致（实例不可改名）。
- `remainingTurns` 1…100；`maxStacks` 1…模板上限；`stacks` 1…`maxStacks`。
- `durationType`：`battle_turns`（自身回合末递减）/ `until_removed` / `persistent`（后两者不递减，`persistent` 不受净化）。
- `tickTiming`：`onTurnStart` / `onTurnEnd`。
- `stackRule`：`refresh` / `stack` / `replace`。
- `sourceUnitId`：单位 ID 或 `null`。
- `amount`：只允许 `shield`，1…1e9（施加时 `grantStatus` 的 `options.amount` 上限 10000）。
- `appliedRound`/`appliedTurn`：施加时刻，用于“当回合不结算、不递减”。
- `expireInto`：必须与模板一致。
- `modifiers`：键集必须与模板一致，值按区间校验。

实例存于 `unit.statuses[id]`，一个单位同一状态只保留一个实例（叠层靠 `stacks`）。

---

## 3. 修饰键空间

`status_modifiers.js` 定义两类键：数值键（有区间）与布尔标志。

| 键 | 区间/取值 | 引擎读取点 | 可被自定义模板设置 |
| --- | --- | --- | --- |
| `damage` | 整数 1…100000 | `tick()` → `damageTarget`（×层数） | 是 |
| `heal` | 整数 1…100000 | `tick()` → `restoreHP`（×层数） | 是 |
| `amount` | 整数 1…100000 | `statusAmount()` 护盾池 | 是（但仅 `shield` 实例语义） |
| `reflect` | 整数 1…100000 | `damageTarget` 近战反伤 | 是 |
| `armor` | 内置默认 −4 时为 −100000…−1；0 起为 0…100000 | `armorOf` 的 `changes(armor)` | 是 |
| `movement` | 整数 −3…3 | `reachable` 的移动上限 | 是 |
| `accuracy` | 整数 −10…10 | `targetProfile` 命中构成 | 是 |
| `incomingAccuracy` | 整数 −10…10 | 命中构成 + `explicitEvasion`（同时进“防御”值） | 是 |
| `advantage` / `disadvantage` | 整数 1…3 | `rollD20` 优势/劣势计数 | 是 |
| `reduction` | 0…1（分数） | `mitigation` 减伤 | 是 |
| `vulnerability` | 0…1 | `mitigation` 易伤 | 是 |
| `shatter` | 0…1 | `mitigation` 碎冰加成（`freeze` 专用） | 否 |
| `damageBonus` | 0…1 | `targetProfile` 伤害乘区（`charge` 专用） | 否 |
| `dodgeBonus` | 整数 −30…30 | `targetProfile` 闪避（与 `modifyCheck.dodgeBonus` 相加） | 是 |
| `attackPercent` | 分数 −1…4 | 伤害乘区 `1+Σ` | 是 |
| `attributePercent` | 分数 −1…4 | `stat()` 全体五维乘区 | 是 |
| `finalDamageMultiplier` | 0…8 | `damageTarget` 的独立乘区（`** stacks`） | 是 |
| `intentDifficulty` | 整数 −10…10 | 意图难度（`weakness` 专用） | 否 |
| `taunted` | 布尔 | `tauntFor` | 否 |
| `intercept` | 布尔 | `guardFor` | 否 |
| `skip` | 布尔 | `settleTurn` 跳过行动、`reachable`/`opportunitySources` 等 | 是 |
| `rooted` | 布尔 | `reachable`、`teleportBehind`、预览分支 | 否 |
| `hidden` | 布尔 | `visibleEnemy`（隐身目标只能贴身锁定） | 否 |
| `disarmed` | 布尔 | 无读取点（见第 7 节） | 否 |
| `infiniteAmmo` | 布尔 | `weaponInfo` 跳过弹药消耗 | 否 |
| `guaranteed_hit` / `guaranteed_crit` | 布尔 | `targetProfile` 强制命中/暴击 | 是 |
| `blockResourceRestore` | 布尔 | `paymentError`、`changeResource` 阻断恢复 | 是 |
| `preserveLife` | 布尔 | `loseHP`、`execute` 保命 | 是 |
| `damageType` | `physical/energy/mental/true` | 与 `damage` 成对使用 | 是 |

自定义模板可用的键集由 `validation.customModifierKeys` 固定为 21 个：
`damage, damageType, heal, movement, armor, accuracy, incomingAccuracy, advantage, disadvantage, reduction, vulnerability, reflect, dodgeBonus, attackPercent, attributePercent, finalDamageMultiplier, guaranteed_hit, guaranteed_crit, blockResourceRestore, preserveLife, skip`。

数值读取的统一入口是 `changes(unit, key)`：`Σ(status.modifiers[key] ?? 0) × stacks`。`reduction` 另经 `dsl.stat(...,'damageReduction')` 取上限 0…1；`finalDamageMultiplier` 用 `modifier ** stacks`；护盾池不走 `changes`，走 `statusAmount()`。

---

## 4. 生命周期

### 4.1 施加 `grantStatus(state, unit, statusId, options)`

- 未知 ID 抛错；死亡或已撤离单位返回 `null`。
- `stackRule` 优先取 `options.stackRule` → 已有实例 → 模板。`stack` 累加（clamp 到 `maxStacks`），`refresh`/`replace` 直接取本次值。
- `remainingTurns` 取 `options.remainingTurns ?? options.turns ?? 模板`；`stack` 规则且本次未给时长时取“旧剩余”与“模板默认”较大者。
- `modifiers` = 模板值 + `options.modifiers`（覆盖前按模板校验键集与区间）。
- `expireOn` 优先级：`options.expireOn` → 旧实例 → 模板；`grantStatus` 传入的 `expireOn` 会校验。
- `shield` 的 `amount` 取 `options.amount`（1…10000），缺省用 `modifiers.amount`。
- 写入后记录 `status` 日志：`<单位>获得<名称> ×<层数>`。

### 4.2 定义自定义模板 `defineStatus / define_status_template`

- 最多 64 个；不可覆盖内置 ID。
- 必填：`id, name, icon, category, description, remainingTurns, durationType, tickTiming, stackRule, maxStacks, modifiers`。
- `category` 只允许 `buff/debuff/control/dot/hot`（不允许 `shield`）。
- `maxStacks` 1…10；`modifiers` 非空，且 `damageType` 必须与 `damage` 同时出现。
- `expireInto` 只能指向已定义状态，且要求 `durationType:'battle_turns'`、`remainingTurns:1`、不可自引用、目标不能再有 `expireInto`。

### 4.3 修改 `patchStatus`

- 只改 `modifiers`（键必须是模板已有键）与可选的 `expireOn`（传 `null` 关闭）。
- `modifiers.amount` 会同步 `shield` 的护盾池并 clamp 1…100000。
- 写 `status_patch` 日志；不改变时长与层数。

### 4.4 结算 `tick`

- 只在 `endTurn`/`settleTurn` 的 `tickTiming` 匹配时执行。
- 施加当回合不结算：`appliedRound === state.round && appliedTurn === state.turn` 直接跳过。
- `damage` 走 `damageTarget`（×`stacks`，类型取 `modifiers.damageType ?? 'true'`，来源为 `sourceUnitId ?? 自身`）；`heal` 走 `restoreHP`（×`stacks`）。
- 结算过程中单位死亡立即停止剩余状态。

### 4.5 时长与到期

- `battle_turns` 在持有者 `endTurn` 时递减 1；施加当回合不递减（`expireInto` 且来源为自身时例外，可当回合续接）。
- 归零即删除并写 `expire` 日志；若模板有 `expireInto`，且单位存活、战斗未结束，则立刻 `grantStatus(expireInto)`。
- `until_removed` / `persistent` 不递减。
- `expireOn` 在事件发生时立即删除实例并写 `expire` 日志（原因记为对应事件）：
  - 触发器集合：`on_damaged`（可加 `damageType: any|direct|indirect`）、`on_attack, on_hit, on_kill, on_death, on_turn_start, on_turn_end, on_skill_cast, on_equip, on_heal, on_ally_death`；
  - `exceptSource:'self'` 排除来源为持有者自己的事件；
  - 可写成数组（多条规则任一命中即移除）。

### 4.6 移除与净化

- `removeStatus` 节点/命令：`statusId` 与 `category` 二选一。
- `category:'all_negative'` 命中 `control/dot/debuff`；`persistent` 一律免疫。
- 写 `cleanse` 日志（按分类移除时）。

### 4.7 持久化

- `exportPersistentCarryOver()` 只导出 `durationType === 'persistent'` 的实例。
- 跨战导入时校验：`durationType` 必须为 `persistent`，其余按 `statusValue` 校验。
- 快照 v2/v3 保存完整 `statuses`，`beginBattle` 会清掉 `appliedRound/appliedTurn`。

---

## 5. 引擎专用分支（7 条）

| 状态 | 分支 |
| --- | --- |
| `shield` | `damageTarget` 先扣护盾池（`statusAmount`），归零即删除并写 `shield_break`；`grantStatus`/`patchStatus` 单独维护 `amount` |
| `guard` | `guardFor` 在命中时查找相邻、视线通畅、高差 ≤1、未跳过的同队 `intercept` 单位转交伤害 |
| `taunt` | `tauntFor` 读取 `taunted` 与实例 `sourceUnitId`，限制攻击目标；不可见/不可达时限制失效 |
| `thorns` | `damageTarget` 在“近战、非反应、命中”条件下按 `reflect` 反伤（真实伤害，不再连锁） |
| `freeze` | `mitigation` 读 `shatter` 加成；命中后删除实例并写 `shatter` 日志 |
| `stealth` | `visibleEnemy` 限制远程锁定；`applyStrike` 发动进攻时解除；受击时在 `damageTarget` 解除并写 `reveal` |
| `infinite_ammo` | `weaponInfo` 标记 `infiniteAmmo`，跳过弹药检查与 `drainResource` 条件 |

---

## 6. 谁会施加上状态（内置来源）

| 来源 | 状态 |
| --- | --- |
| 祭坛互动 | `shield`（10）+ `haste` |
| `charge` 动作 | `charge` |
| `lock_on` 动作 | `lock_on` |
| `scan` 动作 | `weakness ×3` |
| `block` / `brace` | `guarded`（格挡按普通/重格挡覆盖 `reduction`；架势按是否有掩体给 1/2 回合） |
| `use_item`（同调） | `haste` |
| `grapple` / `disarm` / `trip` | `grappled` / `disarmed` / `prone` |
| `knockback` 碰撞 | `stun`（默认） |
| 盾击 | `stun`（1 回合） |
| 预设装备/技能 | `burn, mark, sunder, guard, guarded, taunt, freeze, bleed, poison, blind, root, stealth, regen, haste, thorns, shield, vulnerable, chill` |
| 命令/补丁 | `upsert_status`、`define_status_template` |
| 摄取 | `converter` 按 ID/中文名/别名映射为内置 ID（`burning/fire→burn`、`bleeding→bleed`、`frozen→freeze`、`immobilize→root`、`燃烧/冻结/晕眩/加速`） |

AI 评分权重（`ai.js` 的 `weights`，仅影响敌方选招）：
`stun 8, freeze 8, burn 4, poison 4, bleed 3, root 3, sunder 3, vulnerable 3, mark 2, chill 2, blind 2.5, taunt 1, regen ≤4, shield/haste/guarded/guard/thorns/stealth 视附近敌人 0.25…3`。

---

## 7. 现状残留与未接线

- `disarmed`：布尔标志存在、被 `disarm` 动作授予，但**没有任何读取点**。缴械效果完全来自动作里直接 `mainHand = null`，状态本身只是展示。
- `evasion`：`targetProfile` 读取 `changes(target,'evasion')`，但 `status_modifiers.js` 没有该键的区间，`customModifierKeys` 也没有它 —— 内置与自定义模板都无法设置，属不可达读取。
- `shatter`、`damageBonus`、`intentDifficulty`、`taunted`、`intercept`、`rooted`、`hidden`、`infiniteAmmo`、`disarmed` 只能由内置模板给出；自定义控制状态只能用 `skip` 表达“跳过行动”。
- `dodgeBonus` 有两个来源：状态修饰键（`changes`）与 `modifyCheck.dodgeBonus`（`dsl.check`），在 `targetProfile` 中相加。
- `damageReduction`、`damageReductionFlat`、`armor`、`dodge`、`healing`、`skillPower` 等是 `modifyStat` 的 `stat` 名，不是状态修饰键；状态侧的对应键只有 `reduction`。
- `amount` 只在 `shield` 实例上有意义；其他状态带 `amount` 会被校验拒绝。
- doT/HoT 只认 `modifiers.damage`/`modifiers.heal`，没有按状态 ID 的特判（`bleed` 的“回合末”来自 `tickTiming`，不是代码分支）。
- 快照校验把单位状态数量上限设为 `64（自定义模板）+ 26（内置）`，与“一个状态一个实例”的模型对应。
