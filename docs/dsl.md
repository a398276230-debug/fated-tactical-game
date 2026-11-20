# 效果 DSL（现状记录）

源码：`src/core/effect_schema.js`（Schema + 匹配器）、`src/core/effects.js`（解释器 + 旧效果适配）、
`src/api/validation.js`（效果校验）、`src/core/combat.js`（派发点与 IO 注入）。
分层与文件归属见 [architecture.md](architecture.md)，状态词汇见 [status.md](status.md)。

---

## 1. 三级结构

```
模板（equipment / skills / state.effectTemplates）
└─ 表达式 expression   外层，声明 WHEN / IF / ROLL / TARGET
   └─ 节点 node        最小执行单元，必须带 kind
      └─ 字段          数值、资源、状态、地形…
```

- **最小单元是节点**：一个 `{kind, ...字段}` 对象就是引擎能执行或读取的最小粒度。节点只有 `chainEffect` 会包含子节点（`effects` ≤12），`procEffect` 通过 `ref` 间接跳转。
- **表达式外层没有 `kind`**，只有节点有。`isExpression(e)` 的唯一判据是 `Object.hasOwn(e,'trigger')`。
- 节点可写的公共键：`kind`（必填）、`enabled`（默认 `true`）、`label`、`target`、`condition`、`radius`（0…15）。
- 模板上的 `effects` 是表达式数组（≤24，id 在战局内唯一）。`items` 只存 `{id, templateId, counters}`，效果永远挂在模板上。

存储位置：

| 位置 | 内容 |
| --- | --- |
| `state.equipment[id].effects` | 装备模板的表达式 |
| `state.skills[id].effects` | 技能模板的表达式 |
| `state.effectTemplates[id]` | 独立表达式，供 `procEffect.ref` 引用（仓内无写入路径） |
| `state.items[id].counters` | 装备实例的资源计数，键必须与模板 `produceResource.cap` 声明一一对应 |

---

## 2. 表达式字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 战局内唯一；`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` |
| `label` | 否 | 日志/UI 显示名，缺省回退 `id` |
| `trigger` | 是 | 13 值枚举，见第 3 节 |
| `condition` | 否 | 单条规则或规则数组（数组 = AND），见第 5 节 |
| `roll` | 否 | 4 种形式之一，见第 4 节 |
| `target` | 是 | `self / hitTarget / attacker / enemiesInRadius / alliesInRadius / corpse / killedUnit` |
| `effects` | 是 | 节点数组，1…12 |
| `params` | 否 | 共享参数：`perLevel, levelScaling, resourceScale, radius, turns, stacks, amount, percent, usesPerBattle, cooldown, ap, mp, sp, slot, range, source` |

节点字段会覆盖同名 `params` 字段：执行时合成 `{...expr.params, ...node}`。

---

## 3. 触发器与派发点

| trigger | 语义 | 派发位置 |
| --- | --- | --- |
| `passive` | 常驻读取，不派发 | `dsl.stat` / `dsl.check` / `dsl.damageFactor` / `dsl.passiveNodes` |
| `on_attack` | 武器出手、掷骰前 | `applyStrike`（仅武器或盾击） |
| `on_hit` | 判定命中并结算伤害后，对实际承伤者 | `applyStrike` 每目标；`offHandFollowup` 单独派发 |
| `on_damaged` | 实际扣 HP 后 | `loseHP` |
| `on_kill` | 击倒敌方 | `loseHP` 死亡分支 |
| `on_death` | 自身倒下 | 同上 |
| `on_ally_death` | 队友倒下（`target` 为倒下者） | 同上，对每名存活队友 |
| `on_turn_start` | 自身回合开始，状态 tick 之后 | `settleTurn` |
| `on_turn_end` | 自身回合结束，状态时长递减之前 | `endTurn` |
| `on_skill_cast` | 技能释放，主击结算前 | `applyStrike` |
| `on_equip` | 装备同步，默认每战一次 | `syncEquipmentEffects`（开局、命令事务后） |
| `on_heal` | 发出治疗且实际恢复 | `restoreHP` |
| `active` | 主动发动 | 技能 `applyStrike`；装备上的 `active` 由 `dsl.activeSkills` 生成独立动作 |

事件上下文（`ctx`）携带：`target, center, terrainTarget, actionType, school, multipliers, skillScale, entries, weaponId, resourceCost, opportunityAttack, melee, arrow, skillArea, damageType, power, nonLethal`，命中相关追加 `dealt, damageFactor, hitRating, critical, saved, backstab`。`on_damaged` 追加 `attacker, direct`；`on_death` 追加 `killed`。

---

## 4. 检定 `roll`

| 形式 | 行为 |
| --- | --- |
| `{dice:'d20', gte}` | `dsl.die(state,20) < gte` 时整条表达式中止 |
| `{chance}` | `dsl.random(state) >= chance` 中止；会写一条 `proc` 日志（含 roll/chance/triggered） |
| `{save, dc, mode?, chance?}` | 每个目标做豁免检定，通过则跳过该目标；`save` 可为属性数组（2…5 项，互不重复），`mode` 必填（`all`/`any`） |
| `{contest:{attacker,defender,dc}, chance?}` | 攻方 d20+攻击属性 减 守方 d20+防御属性 `< dc` 视为“通过”，跳过该目标 |

`dc` 与技能 `saveDC` 同一规则：`1…50` 整数，或 `{base, scaleBy:{stat,perUnit}, min?, max?}`；运行时 `clamp(base + perUnit × 施术者当前生效属性, min??1, max??50)`。
`chance` 在豁免/对抗形式中作为前置概率门，两者可同时给出。
未命中、豁免成功、概率失败都不消耗 `usesPerBattle`。

---

## 5. 条件 `condition`

规则对象形如 `{type, value?, op?}`；数组等价 AND；`and`/`or`/`not` 组合子带 `conditions`。

| 分组 | type |
| --- | --- |
| 组合 | `and`, `or`, `not` |
| 血量/资源 | `selfHp`(op,value 0…1), `targetHp`(op,value), `resourceAtLeast`(resource,amount) |
| 距离/层级 | `distance`(op 0…20), `targetLevel`(op `self`) |
| 状态 | `selfHasStatus`, `targetHasStatus`, `targetHasCategory`(`none`/`negative`/具体 category), `selfStatusModifier`(key,value 布尔) |
| 单位属性 | `targetCreatureType`, `selfHasTag`, `targetHasTag`, `duel` |
| 战场 | `timeOfDay`(`dawn/day/dusk/night`), `highGround`, `saved`, `enemy`, `reaction`, `opportunityAttack` |
| 动作上下文 | `weaponType`, `skillSchool`, `actionType`, `damageType`, `hitRating` |
| 布尔标签 | `intercepting`, `melee`, `arrow`, `backstab`, `critical` |
| 次数 | `usesLeft`（读 `available()`） |

布尔型条件省略 `value` 等于 `true`。`targetHasCategory:'negative'` = `debuff|dot|control`。目标类条件在 `self` 表达式下检查当前攻击/技能对象（`subject()` 规则）。

---

## 6. 目标解析

| target | 解析 |
| --- | --- |
| `self` | 施术者 |
| `hitTarget` | 当前命中/选中单位 |
| `attacker` | 攻击者 |
| `killedUnit` | 被击倒单位 |
| `corpse` | 未消耗尸体；有 `center` 时要求同格，否则取 `distance ≤ radius` 中第一个 |
| `enemiesInRadius` / `alliesInRadius` | 以 `ctx.center ?? 施术者` 为中心；有 `ctx.skillArea` 时按覆盖格集合筛选，否则按 `radius`（节点或 `params`，默认 1） |

节点自带 `target` 且与表达式 `target` 不同时，节点自己重新解析目标；相同时沿用表达式筛出的目标列表。

---

## 7. 节点表（25 种 kind / 26 个 schema 分支）

`modifyTerrain` 有两个 schema 分支（`raise|lower` 与 `set`），运行时是同一个 kind。

**新增节点规范：** 在 `src/core/effect_schema.js` 的 `nodeNotes` 为每个新 `kind` 写一句给辅助助手看的中文说明：它解决什么问题，以及最容易写错的引用、结算时机或与相邻节点的区别。同一 `kind` 的多个 schema 分支共用说明。`node()` 会把说明写入 JSON Schema 的 `description`；默认 `protocol` 槽自动渲染它，不另抄提示词。缺少说明会报错。

“执行”列：`exec` = `executeNodes` 有分支；`passive` = 只在 `passiveNodes` 读取路径生效。

| kind | 主要字段 | 执行 | 行为 |
| --- | --- | --- | --- |
| `damage` | `amount, flat, percent, percentOf*, perLevel, levelScaling, resourceScale, damageType, ignoreArmor, excludeHitTarget, strikeBonus, inheritDamageType, resourceMultiplier, lethal` | exec | `strikeBonus` 跳过 `damageFactor`（用于主击的附加段）；`resourceMultiplier` 按资源存量乘一次；默认 `damageType='true'` |
| `heal` | `amount, percent, percentOfMaxHp, percentOf*, perLevel, levelScaling, resourceScale` | exec | 走 `restoreHP`，受 `healing` 属性与 `on_heal` 影响 |
| `restoreResource` | `resource, amount, percent, minimumRemaining, requireFull, local, percentPerCost, ...` | exec | 受 `blockResourceRestore` 阻断 |
| `drainResource` | 同上 | exec | `requireFull` 且余额不足时返回 `false`，链会中断 |
| `produceResource` | 同上 + `cap, initial, reloadable, targetTierBase` | exec | `cap/initial/reloadable` 只在 `passive` 读取时被 `resourceDefinitions` 采集 |
| `grantStatus` | `statusId, turns, stacks, modifiers, amount, durationType, expireOn` | exec | `amount` 仅模板声明了 `modifiers.amount` 时合法；`turns` 会被 `skillScale` 缩放并 clamp 1…100 |
| `removeStatus` | `statusId` 或 `category`（二选一） | exec | `all_negative` = `debuff/dot/control`；`persistent` 不受清理 |
| `modifyStat` | `stat, flat, percent, duration, damageType, levelScaling` | exec + passive | passive 读取为常驻修正；exec 写入 `unit.effectModifiers`（按回合递减） |
| `modifyDamageBase` | `value, ignoreAttributes, unscaled, damageType` | passive | 替换起伤：`unscaled` 跳过评级/姿态倍率，`ignoreAttributes` 默认 true |
| `modifyCheck` | `iniBonus, dodgeBonus, stealthBonus, accuracyBonus, initiativeAgility, dodgeAgility, coreBonus, highGroundRange, highGroundAccuracy, advantage` | passive | 由 `dsl.check(key)` 读取 |
| `forceOutcome` | `mode: hit\|crit` | passive | 只在模板本身带伤害时生效 |
| `upgradeHitTier` | — | passive | 已命中后提升一档评级 |
| `multiplyDamage` | `factor, damageType, additive, resourceScale, local` | exec + passive | exec 时把节点推入 `ctx.multipliers`（主击统一再算）；passive 时参与 `damageFactor` |
| `knockback` | `distance 1…5, collisionDamage` | exec | 逐格推；受阻时结算碰撞伤害（默认 5，`effect.collisionDamage ?? 5`）并施加 `stun` |
| `teleportBackstab` | `bonusMultiplier` | exec | 目标背后空格校验；预览阶段同时改写命中上下文 |
| `shield` | `amount, percent, percentOfHealing, turns, stack` | exec | 授予默认护盾模板；`stack` 时叠加该模板对应的现有池 |
| `execute` | `threshold, strict, requiresPool` | exec | 直接清空 HP；`nonLethal`/`preserveLife` 可阻断；`requiresPool` 要求该资源池存在 |
| `spawnUnit` | 必填 `name`；可选 `count`（1–10）、`tier, attribute, stats, maxHp/maxMp/maxSp, armor, size, bodyLengthM, mc, move, skills, mainHand/offHand/shield, gear` | exec | 无需单位原型。层级取施术者与节点较低者；默认关联属性取智力、精神较高者。最终五维均分 `max(5T,5A−30)`，余数依力量、敏捷、体质、智力、精神分配，各项不超过关联属性及层级上限。按召唤总数推算每只的资源。技能引用现有技能 ID；装备引用模板 ID，各单位独立铸造实例。无足够空格或预算时整批不生成。 |
| `summon` | `templateId, statScale, count` | exec | 从 `state.summonTemplates` 或现有单位取原型；落点取距 `ctx.center` 最近空格；ID `summon-N` |
| `raiseDead` | `statScale` | exec | 只对未消耗尸体生效，`creatureType='undead'` |
| `addItem` | `itemId, count` | exec | 写 `unit.inventory`（不是 `state.items`） |
| `modifyTerrain` | `area, terrain: raise\|lower\|set, amount, remainingTurns, persistent` | exec | `z` clamp −4…8 |
| `setTerrainKind` | `area, terrainKind: floor\|wall\|slope, ...` | exec | 造墙跳过被单位占用格；全部占用时记 `terrain_unresolved` |
| `addCover` | `area, hp, ...` | exec | 生成 `terrain-<n>-<x>-<y>` 临时掩体，`cover=2` |
| `chainEffect` | `effects, stopOnFailure` | exec | 逐节点执行；`stopOnFailure` 在首个未产生效果的节点停止 |
| `procEffect` | `ref` | exec | 按 `state.effectTemplates[ref]` → 装备/技能里同 id 表达式查找；`depth+1` |

`modifyDamageBase`/`modifyCheck`/`forceOutcome`/`upgradeHitTier` 在非 `passive` 触发器上执行时不产生任何效果：`executeNodes` 的内部 switch 没有这四个分支。

---

## 8. 两条消费路径

1. **`passiveNodes(state, actor, ctx, extra)`** — 收集 `trigger:'passive'`、无 `roll`、`target:'self'`、条件成立的表达式，递归展开 `chainEffect`/`procEffect`（带 seen 集，≤8 层），返回扁平节点数组。`dsl.stat()`（`modifyStat`）、`dsl.check()`（`modifyCheck`）、`dsl.damageFactor()`（`multiplyDamage`）、`targetProfile`（`modifyDamageBase`/`forceOutcome`/`upgradeHitTier`）都从这里读。
2. **`dsl.dispatch(state, actor, trigger, ctx, extra)`** — 取装备表达式 + 显式 `entries`（技能表达式），对 `trigger` 匹配者执行 `run()` → `executeNodes()`。

`passive` 节点不派发；`active` 节点不进 `passiveNodes`。同一条表达式在本次 `run()` 内不会被重复执行（seen 集按 `expr.id`）。

---

## 9. 数值语义

单个节点的量：

```
p        = { ...expr.params, ...node }
level    = levelScaling.perLevel != null ? 1 + perLevel × (tier-1)
                                        : min + (max-min) × (tier-1)/6
units    = resourceScale ? 资源量 / (unitSize ?? 1) : 0
magnitude = (amount × level) + perLevel × tier
          + units × resourceScale.perUnit + flat
          + percentOfHealing × 治疗量 + percentOfDamageDealt × 本次实际伤害
          + percentOfPrevious × 链内上一数值节点结果
          + percentOfSelfMaxHp × 自身 maxHp
          + (percentOfTargetMaxHp ?? percentOfMaxHp) × 目标 maxHp
          + targetTierBase^(目标 tier-1)
          + percentOfPower × ctx.power
amount   = max(0, min(1e9, floor((magnitude + (heal|shield|damage 时 percent × 目标maxHp) ) × skillScale)))
```

- `skillScale` 只对 `action.type==='skill'` 生效，来自 `dsl.stat(actor,'skillPower',1,…)`，同时缩放 `grantStatus.turns`。
- `params.damageType` 由技能模板的 `damageType` 注入（`skillExpressions()`），节点同名字段优先。
- 伤害主击的乘区：`dice × multiplier × 体型 × 评级 × 意图 × 姿态 × 副手 × skillPower × damageFactor`；`saved` 再 ×0.5。
- `multiplyDamage` 的 `factor` 是总系数；`additive:true` 时各节点按 `(factor-1)` 相加后再乘。
- 资源上限：`hp→maxHp, mp→maxMp, sp→maxSp, ap→2, action/attack→1`，其余取 `pool.effect.cap ?? node.cap ?? 1e9`。
- `local:true` 只访问声明该资源的装备实例计数（`items[id].counters[resource]`）。

---

## 10. 资源池

声明方式：`passive` + `target:'self'` 的 `produceResource{resource, cap, initial?, reloadable?}`。

- `resourceDefinitions(template)` 只采集这种节点；`initialCounters(template)` 用它生成实例初值。
- `items.counters` 的键必须与模板声明的池完全一致（校验强制）。
- 装填流：`reloadable:true` + `on_attack` 的 `drainResource{requireFull:true, amount:1, local:true}`，条件里用 `selfStatusModifier(key:'infiniteAmmo', value:false)` 让 `infinite_ammo` 状态生效。
- 技能花费：模板 `resourceCost`（`{resource, amount}` 或 `{hp|mp|sp}`）在施放前扣除；节点 `percentPerCost` 按本次花费恢复。
- `minimumRemaining` 设定扣减后的最低保留量；`requireFull` 余额不足时中断当前链。

---

## 11. 地形节点

`area` 四种写法：

| 写法 | 例 |
| --- | --- |
| 格列表 | `{"cells":[{"x":3,"y":4}]}` |
| 矩形 | `{"rect":{"x1":3,"y1":4,"x2":5,"y2":6}}` |
| 圆形 | `{"center":"hitTarget","radius":1}`（`center` 还可用 `self` 或 `{x,y}`） |
| 跟随锚点 | `{"center":"self","radius":1,"follow":true}` |

- `center` 解析：`self`→施术者；`hitTarget`→`ctx.terrainTarget ?? ctx.target ?? ctx.center`；其余按坐标。`follow` 必须有存活的真实单位锚点。
- 每层记录为 `state.terrainPatches[terrain-N] = {node, anchorUnitId?, center?, remainingTurns, persistent, patch[], covers[]}`；≤64 层。
- 还原：`endTurn` 时 `advance=true` 递减非 `persistent` 层；到期或锚点离场即逐格写回 `before`。同格多层按应用顺序重放，避免旧层先到期时丢新层。
- 落差：`effectiveHeight = kind==='slope' ? 1 : z`；高度下降时格上存活单位受 `50 × 落差` 固定伤害。
- 造墙：跳过被单位/掩体/互动点占用的格；墙还原时若原格已不可站，单位被移到最近空格，无空格则直接死亡。
- 计数日志：`terrain`、`terrain_skip`、`terrain_unresolved`、`terrain_expire`、`terrain_displace`。

---

## 12. 非致命与保命

- `damage.lethal` 默认 `true`；`lethal:false` 只保护该节点的实际承伤者，结算后最低留 1 HP。
- 单位 `nonLethal:true` 或状态 `modifiers.preserveLife:true` 对所有来源保命，`lethal:true` 不能绕开。
- `execute`、环境/坠落伤害不受节点 `lethal` 影响；`execute` 被 `nonLethal`/`preserveLife` 阻断。
- 倍率不能保证不致死；`preserveLife` 只在 `loseHP` 里生效。

---

## 13. 校验链

1. `validExpression(e)`：手写 `matches()` 对 `effectSchema` 求值；`additionalProperties:false`，未知字段直接不合法。
2. `validateEffect(e)`：`removeStatus` 必须二选一；`statusId` 必须已注册；`modifiers` 按模板校验；`stacks` 不超过模板上限；`amount` 仅限声明了护盾池的模板；`initial ≤ cap`；`save` 数组必须有 `mode` 且无重复。
3. `effects(v)`：≤24 条、id 不重复。
4. `validateState`：`effectTemplates ∪ equipment.effects ∪ skills.effects` 的 id 全局唯一；`procEffect.ref` 必须能解析；递归检测循环引用。

运行时另有两道上限：`run()` 的 `depth ≤ 8`、`dispatch` 递归 ≤8 层。

---

## 14. 与提示词的关系

`src/tavern/effect-protocol.js` 的 `EFFECT_PROTOCOL` 不是手写文档，而是从 `effectSchema.$defs` 现渲染出的文本（表达式字段、条件枚举、节点字段都取自 schema），再由 `prompts.js` 拼进协议槽。
因此改 schema 会同时改 AI 看到的协议文本；`status-catalog.js` 与 `engine-summary.js` 是另外两段手写/生成的补充说明。

---

## 15. 残留的 `kind`（旧效果词汇表）

旧格式是“一条效果一个 `kind`”，在摄取时被翻译为新表达式。适配器 `adaptLegacyEffects(effects, context, prefix)` 识别 25 个 kind：

| 旧 kind | 翻译结果 |
| --- | --- |
| `status` | `on_hit/hitTarget`（`target:'self'` 时改自身）`grantStatus`；目标为敌方且状态是 `stealth` 时拆成“给敌方 + 给自己”两条 |
| `save_or_status` | `on_hit` + `grantStatus`，`roll` 取 `save`/`contest` 与 `chance` |
| `fixed_attack` | `passive` `modifyDamageBase{value, ignoreAttributes}` |
| `fixed_damage` | `passive` `modifyDamageBase{value, damageType, unscaled:true}` |
| `bonus_damage` | `on_hit` `damage{flat, damageType, strikeBonus:true}`，条件 `enemy` |
| `check_bonus` | `passive` `modifyCheck{...除 kind 外全部字段}` |
| `guaranteed_hit` / `guaranteed_crit` | `passive` `forceOutcome{mode}` |
| `hit_tier_up` | `passive` `upgradeHitTier` |
| `infinite_ammo` | `on_equip` `grantStatus('infinite_ammo', durationType:'until_removed')` |
| `on_hit_status` | `on_hit` `grantStatus`，条件 `[saved:false, enemy, scope?]` |
| `tier_growth` | `passive` 五个 `modifyStat percent:1 levelScaling`（或 `damage`） |
| `resource_pool` | `passive` `produceResource{counterKey→resource, capacity→cap}` |
| `resource_scale` | `passive` `multiplyDamage{additive:true, resourceScale}` |
| `resource_restore` | `active` 三条 `restoreResource{percentPerCost}`（hp/mp/sp） |
| `execute_threshold` | `active` `chainEffect[execute(strict, requiresPool), produceResource(targetTierBase)]` |
| `kill_charge_weapon` | `passive` `produceResource` + `multiplyDamage(local)`；另一条 `on_kill` `produceResource amount:1` |
| `ammo` | `passive` `produceResource(initial/cap/reloadable)` + `modifyStat armorPierce` + `modifyCheck highGround*`；`on_attack` `drainResource requireFull` |
| `frost_thorns` | `on_damaged/attacker` 伤害 + 40% 概率 `chill`（条件 `melee, reaction:false, enemy`） |
| `backstab` | `passive` `multiplyDamage` + `modifyCheck advantage`（条件 `backstab`）；`on_hit` `grantStatus bleed` + `damage`（条件 `backstab||critical`） |
| `healing_shield` | `passive` `modifyStat healing`（条件 `actionType:skill`）+ `on_heal` `shield{percentOfHealing, stack}` |
| `opportunity_root` | `on_hit` `grantStatus root`（条件 `opportunityAttack`） |
| `knockback` | `on_hit` `knockback` |
| `teleport_backstab` | `active` `teleportBackstab` |
| `cleanse` | `on_hit` `removeStatus{category:'all_negative'}` |

别名（`converter.effectAliases`）：`killcharge`/`kill_charge`→`kill_charge_weapon`，`ammo_charge`→`ammo`，`bleed`→`backstab`，`knock_back`→`knockback`，`teleport_backstab`→`teleport_backstab`，`cleanse_status`→`cleanse`，`root`→`opportunity_root`。

翻译只发生在摄取与热改路径：

| 调用点 | 场景 |
| --- | --- |
| `converter.convertEffects` | MVU / `char_info` / 技能装备字段导入 |
| `commands.patch_equipment_template` / `patch_skill_template` | 运行中热改 effects |
| `effects.migrateStateEffects` | 快照 version 1/2 迁移 |
| `scenarios.buildScenario` | `custom_state` 直通前的迁移 |

未知 kind 由适配器原样返回（`default` 分支），随后 `validateEffect` 失败，摄取侧降级为 warning（`效果 X 已拒绝：…`），不会静默生效。
预设内容（`presets/catalog.js`）已经全部使用现代表达式，不再产生旧 kind。

---

## 16. 只读或未接线的字段（现状）

- `modifyDamageBase` / `modifyCheck` / `forceOutcome` / `upgradeHitTier`：仅 `passive` 路径生效（见第 7 节）。
- `effectTemplates`、`summonTemplates`：schema、校验、`procEffect`/`summon` 查表都存在，仓内无写入路径。
- `node.radius` 只影响 `enemiesInRadius`/`alliesInRadius`/`corpse`。
- `params.source='weapon'` 只在本次使用的装备实例匹配时生效。
- `addItem` 写 `unit.inventory`，不创建 `state.items` 条目。
- 状态实例仅在模板声明 `modifiers.amount` 时拥有 `amount`（剩余护盾池）。
- `enabled:false` 会跳过整个节点；`chainEffect` 被关闭时子节点一并跳过。
- `label` 只影响日志与界面文案。
