# 架构与文件归属（现状记录）

记录口径：仓库当前代码（`package.json` 0.2.0，快照 `battleVersion = 3`，跨战档案 `version = 1`）。
本文只描述已存在的结构、边界和字段，不含规划项。效果 DSL 见 [dsl.md](dsl.md)，状态系统见 [status.md](status.md)。

---

## 1. 入口与产物

| 产物 | 入口 | 格式 | 全局名 |
| --- | --- | --- | --- |
| `dist/index.mjs` | `src/index.js` | ESM | — |
| `dist/index.iife.js` | `src/index.js` | IIFE | `FatedTactical` |
| `dist/tavern.mjs` | `src/tavern/main.js` | ESM | — |
| `dist/tavern.iife.js` | `src/tavern/main.js` | IIFE | `FatedTacticalTavern` |

- `build.mjs`：esbuild，`target: es2022`，`bundle: true`，每次构建先清空 `dist/`。`dist/` 是入库的构建产物。
- `scripts/dev.mjs`：esbuild watch + 静态服务器，默认 `127.0.0.1:8787`（`PORT` 可改），响应带 `Cache-Control: no-store`。
- `src/index.js` 对外导出 10 组符号：`createGameAPI` / `GameAPI`、`SCENARIOS` / `buildScenario`、`mount` / `mountStyles`、converter 的 8 个函数、`mountTavernOverlay`、`regex` 的 4 个常量与 `renderBattleInitEntry`、`validateState` / `defineStatus`、`corpses` / `living` / `patchStatus` / `statusModifierKeys`、`parseBattleTime`、`effectSchema`。
- `src/tavern/main.js`：浏览器环境下自动 `mountTavernOverlay({host, mount, hydrateFromSources, validateState, buildMvuJsonPatch})`，host 取 `window.parent`。
- `src/ui/standalone.js`：非酒馆页面独立启动，`initializeUI(document.body, {game})`。
- 运行时不依赖任何第三方库；`esbuild` 是唯一 devDependency。`node tests/*.mjs` 直接跑源码，不需要打包。

---

## 2. 分层与依赖方向

层内文件之间没有强制边界，但跨层 import 的方向是单向的（实测 `from '../<dir>/'` 计数）：

| 层 | 目录 | 实测出边 | 约束 |
| --- | --- | --- | --- |
| L0 规则核心 | `src/core/` | 无任何出边 | 不引用 API、模板、酒馆、UI；不碰 DOM、网络、宿主 API |
| L1 事务与校验 | `src/api/` | core ×11、presets ×1 | 持有可变战局、事务、快照、校验、导出 |
| L2 内置内容 | `src/presets/` | core ×4、api ×1（`validation.js`） | 只提供初始数据与关卡布局 |
| L3 宿主适配 | `src/tavern/` | core ×10、api ×3、presets ×1、ui ×2 | 读酒馆数据、转成 state、拼提示词、控制台 UI |
| L4 棋盘前端 | `src/ui/` | core ×6、api ×3、presets ×2 | 重构中；除 `narrate.js` 外不在本套文档的覆盖范围 |

L3 对 L4 的两条出边是 `tavern/main.js → ui/mount.js` 与 `tavern/overlay.js → ui/theme` 相关引用，即控制台复用棋盘的挂载/主题层。

---

## 3. 文件归属

### 3.1 L0 `src/core/`（11 个文件，2825 行）

| 文件 | 行 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `battle_time.js` | 23 | 从 `<tp>` 文本取战斗时刻，派生 `dawn/day/dusk/night` | `timeOfDay`, `parseBattleTime` |
| `combat_protocol.js` | 77 | 纯数值表与纯函数：体型/评级/距离/意图/士气/姿态/先攻/伤害管线公式 | `RATING_TABLE`, `DISTANCE_TABLE`, `INTENTS`, `MORALE`, `STANCE_RULES`, `stanceFor`, `stanceRules`, `ratingFor`, `distanceTier`, `intentCheck`, `initiative`, `moraleResult`, `damagePipeline`, `areaResolution`, `sizeFor`, `sizeHitModifier`, `meleeMultiplier`, `nonLethalHp`, `normalizeEquipment` |
| `rng.js` | 91 | uint32 显式状态 RNG；d20 优势/劣势/协议奖励骰；命中率与暴击率解析式 | `seedRng`, `nextRng`, `rollDie`, `rollDice`, `rollD20`, `rollProtocolD20`, `hitChance`, `critChance`, `saveChance` |
| `spatial.js` | 205 | 10×10 网格几何：高度、可走边、BFS 可达、supercover 视线、AOE 形状、掩体遮挡、朝向弧、夹击 | `cellAt`, `elevation`, `isGround`, `unitAt`, `coverAt`, `gridDistance`, `distance3D`, `passableEdge`, `canStep`, `reachableCells`, `movementOptions`, `findPath`, `supercoverLine`, `hasLOS`, `aoeCells`, `coverBetween`, `facingToward`, `facingArc`, `flankPosition`, `isFlanked` |
| `prebattle_resources.js` | 37 | 原协议 v1.3.40 战前资源推演 | `calculatePrebattleResources`, `protocolDistance` |
| `status_modifiers.js` | 40 | 状态修饰键的合法区间表、类型判别与报错文案 | `damageTypes`, `statusModifierRange`, `validateStatusModifiers` |
| `effect_schema.js` | 124 | 效果 DSL 的 JSON Schema（draft 2020-12）与手写匹配器 | `effectSchema`, `isExpression`, `validExpression`, `validSaveDC`, `validExpireOn`, `validTerrainNode`, `terrainKinds`, `effectNodes` |
| `effects.js` | 378 | DSL 解释器 + 旧效果适配器：表达式查找、条件求值、目标解析、数值组装、节点执行、passive 节点读取 | `expression`, `adaptLegacyEffects`, `migrateStateEffects`, `createEffectEngine`, `resourceDefinitions`, `initialCounters`, `effectLabel`, `corpses` |
| `combat.js` | 1505 | 战斗运行时：`STATUSES` 表、日志、状态生命周期、伤害管线、回合推进、`preview`/`targetProfile`、`applyAction` 与全部动作分支、DSL 的 IO 注入 | `STATUSES`, `getStatusTemplate`, `grantStatus`, `patchStatus`, `statusModifierKeys`, `living`, `corpses`, `currentUnit`, `preview`, `applyAction`, `settleTurn`, `beginBattle`, `refreshOutcome`, `refreshOpeningInitiative`, `reachable`, `equippedActiveSkills`, `syncEquipmentEffects`, `stealthCheck` |
| `terrain-effects.js` | 175 | 地形 DSL 节点落地、层次化还原、跟随锚点、落差伤害、墙还原位移 | `applyTerrainEffect`, `updateTerrainPatches` |
| `ai.js` | 170 | 本地敌方 AI：动作枚举 + 评分，不消耗 RNG、不产生战局变更 | `chooseAction` |

`combat.js` 内部按段落组织，没有拆子模块：

1. `STATUSES` 冻结表（26 条，见 status.md）
2. `record()` 日志写入与 `randomUnit`/`randomDie`
3. 状态生命周期：`grantStatus`、`patchStatus`、`expireStatuses`、`tick`、`endTurn` 中的时长递减
4. 伤害管线：`loseHP`、`armorOf`、`damageTarget`、`mitigation`、`guardFor`、`coverDamage`
5. 回合与先攻：`beginBattle`、`settleTurn`、`endTurn`、`advanceCursor`、`moraleCheck`
6. 位移与借机：`reachable`、`opportunitySources`、`canReact`、`threatens`、`applyMovement`
7. 命中预览：`targetProfile`、`diceFormula`、`diceBounds`、`diceAverage`、`oddsCache`
8. 动作入口：`preview`（含全部动作合法性分支）、`applyAction`（扣除与分支）、`applyStrike`
9. DSL 接线：`createEffectEngine({...})` 的 IO 表与 `dispatchEffect`

### 3.2 L1 `src/api/`（4 个文件，842 行）

| 文件 | 行 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `game_api.js` | 288 | 单例战局门面：创建/恢复/导出、事务模拟与提交、提案、撤销、订阅 | `createGameAPI`, `GameAPI`, 再导出 `calculatePrebattleResources`, `protocolDistance` |
| `commands.js` | 162 | 15 条带校验的写命令 | `applyCommand` |
| `validation.js` | 315 | 全 state 校验、状态模板注册、DSL 效果校验、单位/地形/表的字段白名单 | `validateState`, `validateEffect`, `unitValue`, `equipmentTemplate`, `skillTemplate`, `statusTemplate`, `statusTemplateTable`, `statusValue`, `validateCell`, `defineStatus`, `fields`, `requireThat`, `id`, `int`, `num`, `text`, `coord`, `attrs`, `maxStatusTemplates` |
| `battle_report.js` | 77 | 把结构化战报投影成按轮分组的纯文本（叙事投影，不是审计记录） | `formatBattleReportText` |

### 3.3 L2 `src/presets/`（2 个文件，207 行）

| 文件 | 行 | 职责 |
| --- | --- | --- |
| `catalog.js` | 59 | 内置 `EQUIPMENT`（11 件）与 `SKILLS`（14 个）模板，全部使用现代表达式 DSL |
| `scenarios.js` | 148 | 三个关卡（`ruins`/`altar`/`boss`）的棋盘、单位、掩体、互动点、区域；跨战档案导入；`custom_state` 直通 |

### 3.4 L3 `src/tavern/`（18 个文件，3324 行）

| 文件 | 行 | 职责 |
| --- | --- | --- |
| `converter.js` | 742 | 数据摄取：MVU `stat_data`、`char_info`、`battle_init` → 校验通过的 state；旧效果 kind → 表达式；战报 → RFC 6902 patch |
| `overlay.js` | 1071 | 控制台页面、四页签、加载/标准化流程、MVU 写入、事件总线（UI 归属，细节不在本文范围） |
| `settings.js` | 381 | 提示词槽位页与 API 页的表单渲染 |
| `theme.js` | 206 | 控制台配色与组件样式（对齐 `styles/battle-theme.css`） |
| `api.js` | 194 | 请求层：酒馆主接口（流式）、独立 OpenAI 兼容 API、模型列表、SSE 解析、错误诊断 |
| `prompts.js` | 158 | 提示词槽位：7 个内置槽 + 自定义槽；协议槽由三段生成文本拼成 |
| `ai-page.js` | 134 | 标准化对话页（消息渲染 + 流式输出） |
| `ai-sessions.js` | 70 | 标准化会话的持久化存储 |
| `host.js` | 65 | 酒馆宿主桥：作用域、方法查找、`stat_data` 读取、读楼层变量与聊天消息 |
| `terrain.js` | 58 | `battle_init` 地形 → 10×10 网格：`flat`、程序化 `terrain`、旧 `grid`/`terrain` 结构 |
| `effect-protocol.js` | 46 | 由 `effectSchema` 现场渲染出 DSL 文本协议（注入提示词） |
| `status-catalog.js` | 35 | 由状态表生成的状态目录文本（注入提示词） |
| `engine-summary.js` | 33 | 固定协议摘要 + API 映射 + 状态数值覆盖说明（注入提示词） |
| `descriptor.js` | 37 | `<battle_init>` v1 竖线描述符解析（`battle|1|ID|标题|flat|seed` + `unit|...`） |
| `char-snapshots.js` | 28 | 角色原始快照提取 |
| `instance-card.js` | 24 | 单位实例卡：属性/资源/装备/技能/原始数据 |
| `regex.js` | 30 | 酒馆正则脚本：`<battle_init>` 折叠入口卡片 |
| `main.js` | 12 | 酒馆包入口，自动挂载 |

### 3.5 L4 `src/ui/`（9 个文件，2043 行，重构中）

`main.js`（事件与流程）、`render.js`（棋盘与面板）、`styles.js`（样式注入）、`template.js`、`animation.js`、`target_card.js`、`mount.js`、`narrate.js`（日志 → 玩家可读叙述，纯函数）、`standalone.js`（独立启动）。本套文档只引用 `narrate.js` 作为日志消费方，不复述其结构。

---

## 4. 战局状态模型 `state`

`validateState` 的必填/可选字段即为权威清单。

### 4.1 顶层

| 字段 | 类型/范围 | 写入方 |
| --- | --- | --- |
| `scenarioId` | ID ≤64 | `buildScenario` / `hydrateFromSources` |
| `title` | 文本 ≤100 | 同上 |
| `mode` | `free` / `split` | 开局参数；`split` 下动作按 `attack`/`action` 槽计费 |
| `ruleset` | `protocol` / `sandbox` | 开局参数；`sandbox` 仅测试夹具使用 |
| `round` | 1…1e6 | `advanceCursor` |
| `turn` | 0…order.length-1 | `advanceCursor` / `remove_unit` |
| `order` | 长度 ≤200 的单位 ID 数组 | `beginBattle`、`advanceCursor`、`spawn_unit`、`remove_unit` |
| `units` | 表，≤200 | `applyCommand` / `spawnEffectUnit` |
| `items` | 实例表 `{id, templateId, counters}` | 装备/计数器命令、跨战导入 |
| `equipment` | 模板表 | 预设、`patch_equipment_template` |
| `skills` | 模板表 | 预设、`patch_skill_template` |
| `grid` | 固定 10×10，`{kind: floor\|slope\|wall, z: -4…8}` | 预设、`set_terrain_cell`、地形效果 |
| `covers` | 掩体表 `{id,name,x,y,material,hp,maxHp,cover:0…12}` | 预设/摄取、`coverDamage`、地形效果 |
| `interactives` | `{id,name,x,y,kind: barrel\|altar,spent}` | 预设/摄取、`applyInteraction` |
| `rng` | uint32 | 每次掷骰 |
| `logs` | ≤100000 条事件 | `record` |
| `outcome` | `null`/`blue`/`red`/`draw` | `refreshOutcome`、`flee` |
| `statusTemplates` | 可选，≤64 条自定义模板 | `define_status_template`、跨战导入 |
| `zones` | 可选，≤64 | `set_zone`、亡语区域 |
| `time` | 可选，`{raw,hour,minute,timeOfDay,calendar}` | `parseBattleTime` |
| `effectTemplates` | 可选，表达式表 | 仅校验与 `procEffect` 解析；仓内没有写入路径 |
| `summonTemplates` | 可选，单位表 | 仅校验与 `summon` 解析；仓内没有写入路径 |
| `terrainPatches` | 可选，≤64 层 | `applyTerrainEffect` / `updateTerrainPatches` |

### 4.2 单位

必填：`id,name,team,x,y,facing,hp,maxHp,mp,maxMp,sp,maxSp,ap,used,stats,armor,size,move,weapon,gear,skills,statuses`。
可选：`reactionAvailable,fled,diedAt,corpseOf,corpseConsumed,creatureType,tags,resources,inventory,effectUsage,effectModifiers`，以及协议字段 `mainHand,offHand,shield,bodyLengthM,tier,mc,nonLethal,intent,bonusDice,penaltyDice,stance,moraleType,moraleState,greatswordMode,parryQuota,parryRefunded,attunementCharges,blockMode,initiativePercent,attackInit,actionInit,flatInitiative,lockedTargetId,deathrattle,deathrattleTriggered,moraleCheckedRound,maneuvers`。

- `facing` 是 `[-1|0|1, -1|0|1]`，至少一个非零。
- `used: {action, attack}` 只在 `split` 模式计费，`ap` 每回合补到 2。
- `gear` ≤12、`skills` ≤32、`statuses` 条数上限 `64 + 26`。
- `resources`/`inventory` 是整数表；`effectUsage` 记录 `{count, round}`；`effectModifiers` 记录临时属性修正 `{stat, flat, percent, turns, round, turn, damageType?}`。
- 同一格不能有多个 `hp > 0` 的单位，也不能压墙或压存活掩体。

---

## 5. 事务、撤销与快照

```
playAction(action)         → transaction {kind:'actions', entries:[action]}
proposeCommands(cmds, opts) → 试算：copy → simulate → diff → 暂存 proposal
commitProposal(id)          → frames.push({before, transaction}) ; state = next ; revision++
undoLastCommit()            → state = frames.pop().before
```

- `simulate(base, transaction)` 永远在 `structuredClone` 副本上跑；`actions` 逐条 `applyAction`，`commands` 逐条 `applyCommand` 后 `validateState → syncEquipmentEffects → refreshOutcome → validateState`，必要时 `settleTurn`。
- 上限：`maxBatch = 32` 条/事务，`maxHistory = 2000` 个事务，待提交提案 16 个。
- `revision` 每次提交自增；提案绑定 `baseRevision`，过期即拒绝。
- 订阅：`subscribe(listener)` → `publish()` 在提交/撤销/恢复/开局时触发。

快照种类：

| 导出 | 形状 | 说明 |
| --- | --- | --- |
| `exportBattleSnapshot()` | `{kind:'battle', version:3, origin, state, journal}` | `origin` 是开局态，`journal` 是事务序列；恢复时逐条重放，并与 `state` 做差异比对，有任何差异即报错 |
| `restoreBattleSnapshot()` | 同上，接受 version 1/2/3 | 低版本先 `migrateStateEffects`；迁移分支不重放日志，直接采用 `state` 并清空 journal |
| `exportPersistentCarryOver()` | `{kind:'persistent', version:1, units, items, statusTemplates?}` | 单位只带 `durationType==='persistent'` 的状态、`weapon`、`gear`；不带 HP/AP/短期状态 |
| `createBattle({kind:'custom_state', state})` | — | 直通 `buildScenario`，`migrateStateEffects` 后校验 |

`createBattle` 还接受字符串关卡 id、`{scenarioId, seed, mode, ruleset, persistentSnapshot}`，以及 battle 快照（转 `restoreBattleSnapshot`）。

---

## 6. 动作与命令

### 6.1 动作（`applyAction` / `preview`）

固定 AP/槽位表（`ACTIONS`）：

| 动作 | AP | 槽 | 备注 |
| --- | --- | --- | --- |
| `move` | 1 | action | 轻剑姿态每次移动 +1 奖励骰（上限 2） |
| `sprint` | 2 | action | 距离 ×2 |
| `disengage` | 1 | action | 不触发借机 |
| `attack` | 1 | attack | 走武器模板 |
| `skill` | 模板 `ap` 1…2 | 模板 `slot` | 装备自带 `active` 表达式也走这个类型 |
| `shield_bash` | 1 | attack | 需盾牌，消耗 2 SP |
| `reload` | 1 | action | 需 `reloadable` 资源池且未满 |
| `brace` | 1 | action | 附近有掩体给 2 回合 `guarded`，否则 1 回合 |
| `block` | 1 | action | 仅剑盾姿态；普通 25% / 重格挡 45% |
| `use_item` | 0 | — | 仅同调姿态，消耗 `attunementCharges` |
| `charge` / `lock_on` / `scan` | 1 | action | 分别给 `charge` / `lock_on` / `weakness ×3` |
| `grapple`/`disarm`/`trip`/`push` | 1 | attack | 贴身 + 视线；`str`/`agi` 对抗 |
| `flee` | 1 | action | 敏 + d20 对抗敌方最高敏；成功即 `fled` 并判负 |
| `detour` | 1 | action | 仅记录 `maneuver` 日志 |
| `interact` | 1 | action | 爆桶 12 能量伤害 / 祭坛 8 HP + 5 MP + 3 SP + 护盾 10 + 疾走 |
| `end` | 0 | — | 结束当前单位回合 |

`preview(action)` 两种模式：只给 `{type}`（或 `{type, skillId}`）返回可选格/候选；给 `x,y` 则校验这一手并返回完整计划。任何不合法都返回 `{ok:false, error}`，不抛异常；`applyAction` 才在非法时抛错（`HP 不足` 例外：写一条 `skill_rejected` 日志后返回该条）。

### 6.2 命令（`applyCommand`）

| 命令 | 作用 | 校验要点 |
| --- | --- | --- |
| `set_unit_stat` | 改单位字段/五维 | 字段白名单；`mainHand↔weapon`、`bonusDice≤2`、`penaltyDice≤1` |
| `define_status_template` | 注册自定义状态 | 不可覆盖内置；≤64 条 |
| `patch_status` | 改状态实例的 modifiers / `expireOn` | 键必须是模板已有键；`shield.amount` 同步护盾池 |
| `upsert_status` | 施加/覆盖状态实例 | 时长/层数/规则/时机白名单；`taunt` 必须指向敌对来源 |
| `remove_status` | 删除状态实例 | — |
| `adjust_item_counter` | `set`/`add` 装备计数器 | 上限取模板 `cap` 与当前值较大者 |
| `patch_equipment_template` | 热改装备模板 | 不可改变资源池集合、不可改变是否带 `damage` |
| `patch_skill_template` | 热改技能模板 | 模板校验；effects 走旧效果适配 |
| `spawn_unit` | 增援 | 存活、未行动、坐标/装备/技能合法 |
| `remove_unit` | 移除单位 | 同步 `order`/`turn` |
| `equip_item` | 移动实例到槽位 | 先清空所有单位的同名实例引用 |
| `set_zone` / `remove_zone` | 持续区域 | 字段白名单 |
| `set_terrain_cell` | 单格地形 | `{kind,z}` 合法 |
| `set_interactive_status` | 掩体 HP / 互动点 `spent` | 按 ID 归属二选一 |

---

## 7. 预览数据结构（`preview` 返回）

公共：`ok, ap, cost, slot, hp, mp, sp`（后三项为本次消耗）。

移动分支：`cells[{x,y,z,steps,path,opportunities[]}]`、选中格再返回 `path, steps, opportunities, dz`。
`opportunities` 每项 `{unitId, name, from{x,y}, to{x,y}}`。

交互分支：`interactiveId, kind, cells, targets[], center`；爆桶目标 `{id,targetId,recipientId,name,x,y,damage:[a,b],expectedDamage,hitChance}`，祭坛目标 `{id,targetId,name,x,y,heal:[8,8]}`。

打击分支（`applyStrike` 的 `plan`）：

| 组 | 字段 |
| --- | --- |
| 定身 | `name, shape, stance, effects, souls, multiplier, ammo, infiniteAmmo, instanceId, corpseId, hostile, bonusDice, intent, nonLethal, teleport` |
| 几何 | `distance, dz, range, melee, dXYZ, cells, targets, center` |
| 每个目标（`targetProfile`）几何/朝向 | `id,targetId,name,x,y,recipientId,arc,backstab,flanked,cover,coverId` |
| 命中构成 | `accuracy, defense, highGround, sizeModifier, distanceModifier, weaponRangeModifier, stance, stanceRules, accuracySources{explicit,highGround,size,distance,weaponRange,status}, advantage, advantages, disadvantages, expectedD20, hitChance, automatic, guaranteeHit, guaranteeCrit, tierUp, arrow` |
| 豁免 | `saveStat, saveDC, saveBonus, saveChance` |
| 意图 | `intent, intentDifficulty, intentMultiplier, coreBonus` |
| 伤害 | `multiplier, damageType, armorPierce, protocolInitial, damageMultiplier, offHand, armor, damagePipeline, shield, damage[a,b], damageMin, damageMax, fixedDamage, criticalDamage, savedDamage, expectedDamage, dice{rolls,count,sides,bonus,value}, combo{bleedStacks,bonusDamage,on}` |
| 其它 | `dodgeBonus`, `critChance` |

消费方：`src/core/ai.js` 的 `tactics()` 使用 `expectedDamage, hitChance, damageMax, heal, healingShield, saveChance, kind==='cover'`；`src/ui/*` 读取其余字段做展示（重构中）。`preview` 不消耗 RNG：概率全部由 `rng.js` 的解析式给出，掷骰只发生在 `applyAction` 里。

---

## 8. 日志事件

写入函数 `record(state, actor, type, text, detail)`，事件形状固定 `{round, actor, type, text, detail}`。`detail` 必须是可 JSON 化的树（深度 ≤12、对象键 ≤250、数组 ≤500）。日志只追加，不裁剪，上限 100000 条。

按写入阶段分组（字面量 52 个，另有 `move`/`sprint`/`disengage`/`raise_dead` 由动作名或三元式写入，共 56 个 type）：

| 阶段 | type |
| --- | --- |
| 开局与轮次 | `initiative`, `turn`, `end`, `skip`, `initiative_order`, `morale`, `outcome` |
| 行动与移动 | `action`, `move`, `sprint`, `disengage`, `teleport`, `knockback`, `interact`, `block`, `brace`, `maneuver`, `flee`, `detour`, `item`, `skill_cost`, `skill_rejected`, `nonlethal`, `cover_approach` |
| 判定 | `roll`, `intent`, `save`, `contest`, `opportunity`, `parry`, `followup`, `proc` |
| 伤害与资源 | `damage`, `heal`, `shield`, `shield_break`, `shatter`, `reveal`, `guard`, `counter`, `cleanse`, `defeat`, `deathrattle`, `spawn`, `raise_dead` |
| 掩体 | `cover_damage`, `cover_break` |
| 地形 | `terrain`, `terrain_skip`, `terrain_expire`, `terrain_unresolved`, `terrain_displace` |
| 区域 | `zone`, `zone_expire` |
| 状态 | `status`, `status_patch`, `expire` |

消费方：
- `src/api/game_api.js`：`listActionLogs(limit)`、`exportBattleReport()`（按轮分组）、`exportBattleReportText()`。
- `src/api/battle_report.js`：文本投影，显式处理 `initiative/turn/end/action/roll/save/intent/status/counter/outcome`，其余走 `default`；`proc/expire` 被显式跳过。
- `src/ui/narrate.js`：逐 type 生成 `{type,tone,icon,title,lines,roll?,quiet,actorId,targetId}`；未覆盖的 type 走空投影。

---

## 9. 规则结算顺序（`core/combat.js`）

命中后一次打击的固定顺序：

1. `resolveCheck`：豁免分支（`save`）→ d20（奖励/惩罚骰或优势/劣势）→ `ratingFor(total)` → `tierUp`/`guaranteeHit`/`guaranteeCrit` 修正 → 意图对抗。
2. `targetProfile` 预算的乘区：`dice.value × multiplier × sizeScale × ratingScale × intentScale × stanceScale × offHandScale`，再乘 `skillScale` 与 `dsl.damageFactor`；豁免成功 ×0.5。
3. `damageTarget`：援护转交（`guardFor`）→ 重剑弹反（`parry`）→ `mitigation`（碎冰/易伤/减伤/有效护甲/护甲倍率/属性减伤）→ `finalDamageMultiplier`（攻击方状态乘区）→ `damageReductionFlat` → 护盾吸收 → `loseHP`。
4. `loseHP`：HP 扣减（`nonLethal`/`preserveLife` 保 1）→ `on_damaged` 的 `expireOn` → 死亡处理（`on_death`/`on_ally_death`/`on_kill`、亡语）→ `on_damaged` 派发。
5. 命中后：近战反伤（`reflect`）、`on_hit` 派发、治疗、双持副手追击（`sp` 成本 = `tier × 10`，仅主击评级 ≥ 勉强）。

回合顺序：`beginBattle`（清 `effectUsage`/`effectModifiers` → `syncEquipmentEffects` → 先攻 → `settleTurn`）→ `settleTurn`（AP 2、`on_turn_start`、DoT/HoT、区域、控制跳过）→ `endTurn`（`on_turn_end`、时长递减、区域衰减、地形推进）→ `advanceCursor`（换轮：先攻修正重排、朝向重置、士气检查）。

`ruleset` 差异仅在两处：`sandbox` 把力/敏隐式加入命中和防御（`accuracy` 加 `str|agi`、`defense = 10 + agi/2`），且不做属性减伤；`protocol` 两者都不加。

---

## 10. 酒馆数据流

```
MVU stat_data ─┐
char_info ─────┼→ hydrateFromSources() → validateState() → beginBattle() → state
battle_init ───┘        │
                        └→ warnings（非序列化属性，defineProperty 挂到 state 上）

state → exportBattleReport() → battleReportToMvuPatch() → <UpdateVariable><JSONPatch>
```

- 来源解析：`collectMvu()` 递归找带五维或资源特征的记录；`parseCharInfo()` 解 `<char_info>`；`parseBattleInit()` 解描述符 v1（`battle|1|ID|标题|flat|seed` + `unit|ID|team|source|名称|x,y`），`descriptor.js` 单独负责这条竖线格式并做 ID/坐标/来源校验。
- 单位装配：`participantList` → `resolveParticipant`（`char_info` / `mvu:路径` / persona）→ `mergeBattleParticipant`（battle 内联定义只补缺）→ `unitFrom`（五维、层级、体长→体型、资源、装备槽、技能、状态、姿态）。
- 地形：`createBattleGrid` 三种模式（`flat`、程序化 `terrain`（按 seed 旋转/镜像，不消耗战斗 RNG）、旧 `grid`/`terrain` 结构）；随后导入掩体与互动点，`uniquePositions` 消解重叠。
- 装备/技能：`normalizeEquipment`、`normalizeDice`、`convertEffects`（旧 kind → 表达式），无法映射的进 `warnings`。
- 提示词：`prompts.js` 的 7 个内置槽 + 自定义槽；协议槽 = `ENGINE_API_SUMMARY` + 标签映射 + `EFFECT_PROTOCOL`（由 `effectSchema` 现场渲染）+ `STATUS_CATALOG`（由状态表生成）。
- 输出补丁：只允许 `add/replace/remove`，路径白名单 `/^(equipment|skills|items|statusTemplates)\/|^\/units\/<id>\/(statuses|armor|skills)/`（`overlay.js` 的 `normalizationPath`）。
- 时刻：`parseBattleTime` 从 `<tp>` 取，按分钟划档（<300 或 ≥1170 夜、<480 晨、<1020 日、其余黄昏）。

---

## 11. 容量与上限

| 项 | 上限 | 位置 |
| --- | --- | --- |
| 棋盘 | 固定 10×10 | `validateState`、`spatial.js` |
| 单位 / 先攻队列 | 200 | `validateState`、`spawnEffectUnit` |
| 每条模板的表达式 | 24 | `validation.effects`、`convertEffects` |
| 每条表达式的节点 | 12 | `effectSchema` |
| 条件数组 | 12 | `effectSchema` |
| 自定义状态模板 | 64 | `validation.maxStatusTemplates` |
| 状态实例/单位 | 64 + 26 | `unitValue` |
| 持续区域 | 64 | `validateState`、`set_zone` |
| 地形效果层 | 64 | `terrain-effects.maxPatches` |
| 临时掩体 | 200 | `terrain-effects.place` |
| 日志 | 100000 条 | `validateState` |
| 事务历史 | 2000 | `game_api.maxHistory` |
| 单事务条目 | 32 | `game_api.maxBatch` |
| 待提交提案 | 16 | `game_api.proposeCommands` |

---

## 12. 现状残留（可直接观察到的）

- `effectTemplates`、`summonTemplates` 有 schema 与解析（`procEffect`、`summon` 会查表），但仓内没有写入它们的路径，只有 `custom_state` 导入能携带。
- `ruleset: 'sandbox'` 只出现在测试夹具，生产开局走 `protocol`。
- 旧效果 kind 与表达式 DSL 双轨并存，适配器在摄取侧（详见 dsl.md 第 9 节）。
- 状态字段 `disarmed`、修饰键 `evasion` 存在但未接入结算（详见 status.md 第 6 节）。
- `combat.js` 1505 行单文件承载规则表、结算、日志、预览、动作分支与 DSL 接线，没有子模块拆分。
- `dist/` 构建产物入库，源码改动后需要重新 `npm run build` 才会反映到 `dist/`。
