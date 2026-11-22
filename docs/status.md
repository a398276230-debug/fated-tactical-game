# 状态系统

`src/presets/status-defaults.js` 提供 26 个默认模板和内建动作的授予映射。`state.statusTemplates` 中的同名定义优先；未知 ID 必须先注册。`src/core/status_modifiers.js` 是修饰键类型与范围的唯一来源。酒馆辅助模型的状态目录从这两份数据实时生成。

## 模板和实例

- 模板字段：`id`、`name`、`icon`、`description`、`category`、`durationType`、`remainingTurns`、`tickTiming`、`stackRule`、`maxStacks`、`modifiers`，以及可选的 `expireOn`、`expireInto`。战局模板最多 64 条，`defineStatus` 不重复注册已有战局定义。
- `category` 可为 `buff`、`debuff`、`control`、`dot`、`hot`、`shield`，用于展示及按类别移除。它不决定状态实际效果。
- 每个单位以 `unit.statuses[id]` 保存一个实例，包括模板展示字段、当前修饰键值、层数、来源单位 ID、剩余时长。修改模板时，已有实例的字段必须仍与有效模板相符。
- DSL `grantStatus`、命令 `upsert_status` 和 `patchStatus` 使用同一套模板数据；数值覆盖只能修改模板已声明的修饰键。`refresh` 和 `replace` 不累计层数，`stack` 累计到实例上限。
- `battle_turns` 按持有者回合末递减，`until_removed` 与 `persistent` 不递减。仅 `persistent` 纳入跨战档案。`damage` 和 `heal` 按 `tickTiming` 结算，乘以层数。`expireInto` 声明普通时长耗尽后接续的状态，不参与提前解除。

## 通用结算

- `hidden` 控制敌方远距直接锁定，AI 与玩家共用可见性判定。`rooted` 禁止移动或瞬移；`skip` 跳过行动。`taunted` 使用声明该标记的状态实例的 `sourceUnitId`，有多个有效来源时按状态 ID 顺序选择第一个可攻击来源。
- 多数数值修饰键按各实例值乘层数后求和。`finalDamageMultiplier` 使用独立乘区。`shatter` 在命中时加到碎裂乘区；需要碎裂后移除的模板声明 `expireOn: {trigger:'on_struck'}`。
- 模板声明 `modifiers.amount` 就会创建护盾池。实例 `amount` 保存当前余量；`modifiers.amount` 保存授予值。结算按状态 ID 顺序依次扣池，耗尽即移除该实例。预览读取所有池的总量。`shield` 节点是向默认护盾模板授予/叠加的简写；自定义护盾用 `grantStatus`。
- `modifiers.damageType` 指定周期伤害的类型，省略时周期伤害按真实伤害结算。它也会限定同一状态的护甲、比例减伤、易伤、碎裂、反伤触发和主击增伤修饰。移动、控制和护盾池等通用修饰独立生效。
- 流血和中毒是真实伤害，跳过护甲、属性减伤、比例减伤和固定减伤，护盾仍可吸收。灼烧是能量伤害。周期伤害直接结算，不进行命中或弹反检定。
- 缴械动作直接清空主手，不再另挂装饰状态。

## 提前解除

`expireOn` 可为单条规则或数组，任意一条匹配即移除并记录原因。授予指定的规则优先；未指定时保留已有实例规则，否则使用模板规则。`patchStatus` 可将其设为 `null`，关闭该实例的提前解除。

- `on_struck`：命中结算计算碎裂倍率之后、扣除护盾之前，完整吸收也触发。默认冰冻与潜行使用它。
- `on_damaged`：只有实际扣除 HP 才触发。可用 `damageType: 'direct' | 'indirect' | 'any'` 筛选；不填等同 `any`。
- `on_attack`：发起攻击或敌对技能时触发。默认潜行用它声明主动现形。此处描述的是状态生命周期；武器的 DSL 攻击钩子仍按攻击类型派发。
- 其余解除事件包括 `on_hit`、`on_kill`、`on_death`、`on_turn_start`、`on_turn_end`、`on_skill_cast`、`on_equip`、`on_heal`、`on_ally_death`。`exceptSource:'self'` 可排除来自持有者自身的事件。
