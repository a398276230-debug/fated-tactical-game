# SPEC：动态棋盘尺寸、战场比例尺与全尺度同格贴身系统（Scale & Multi-Unit Grid）

> **文档性质**：架构定案与实现交接说明书（供实现方直接落地编码与编写测试）。
> **前置基线**：建立在已落地的 Tactical RISC-VM（`src/core/tactical-vm.js`、`vm-*.js`、`formula.js`）之上。
> **📌 工作树提示**：仓库 `.gitignore` 忽略了 `specs/` 目录；若新建 `git worktree` 隔离开发，请直接按绝对路径读取本文件（`F:\hermescache\hermes-workspace\roming\fated-tactical-game\specs\scale-and-grid.md` 或 WSL `/mnt/f/hermescache/hermes-workspace/roming/fated-tactical-game/specs/scale-and-grid.md`）。

---

## 0. 背景问题与已拍板的五项顶层决策

### 0.1 要解决的核心矛盾
世界书角色从一阶凡人（刀剑 `2m`、步弓 `100m`）跨越到七阶登神者（剑气 `4km`、死域半径 `10km`，相差 $10^4$ 倍）。若锁死 `10×10` 棋盘 + 一格一人 + 简单线性整除，会出现四大崩坏：
1. **亚格死区悖论**：在 `1km/格` 战场上，`2m` 近战武器与 `150m` 弓除以 `1000m` 归零；若禁同格则永远打不着人，若保底 `1 格` 则变成原地一剑劈中 1 公里外的对手。
2. **掩体与地形失真**：掩体若固定 `10 HP` 且独占阻塞整格 `1km²`，在神战中既不合理也秒碎无用。
3. **精确物理米数挤占叙事空间且破坏旧卡兼容**：若强迫在武器/技能上写死精确米数（如 `有效距离：120m`），既锁死了跑团叙事的解释弹性，又与现有世界书/角色卡通用的小数值档位体系（`近程 1~2 / 中程 3~5 / 远程 6~10`）割裂。
4. **死正方形 `10×10` 局促且缺地形纵深**：`半径 3` 技能在 `10×10` 盖住近 1/3 地图，且无法表达断桥（`16×8`）、峡谷等狭长地形。

### 0.2 四项不可回退的顶层决策

| # | 决策项 | 权威定案 |
| --- | --- | --- |
| **S1** | **棋盘宽高 `W×H` 动态化（支持长方形）** | 主模型可在 `battle_init` 首行声明 `\|棋盘=<W>x<H>`，`W` 与 `H` 各自独立支持 **`8..20`** 任意整数（兼容长方形如 `16x8` 断桥、`14x12` 广场、`18x18` 决战）。未声明时回退 `10x10`（保证既有存档与单测零破坏），主模型提示词推荐常规战局优先使用 `12x12` ~ `14x12`。 |
| **S2** | **战场层级与比例尺独立声明** | `anchorTier` 决定蓄步规则，`cellM` 决定物理边长。都不指定时按最低参战层级选档（§1.1）。 |
| **S3** | **全尺度开放「一格多单位 = `0 格` 贴身缠斗」** | **无论比例尺大小**，全尺度统一废除“一格锁死一人”，改为基于单格容量上限（标准容量 `4`）的多单位同格系统。同格距离 `gridDistance == 0` 正式激活 `combat_protocol.js` 中的 **`贴身 (0格)`** 档位与同格友军交互。 |
| **S4** | **距离换算三法则（技能取 `max`、器物取 `min`、`唯一` 随人）** | 完全沿用《技能装备道具生成规则》原有小数值声明格式（`贴身(0)`、`近程(1~2)`、`中程(3~5)`、`远程(6~10)`、`超距/超视距(11+)`、`[位移: X]`）。换算使用 §2.1 的倍率，超过 5 倍的部分采用平方根阻尼；其中 **`唯一` 特例在射程换算中始终取 `角色层级`**，其余品质**技能取 `max{品质层级, 角色层级}`**，**武器/装备/道具取 `min{品质层级, 角色层级}`**。 |
| **S5** | **免疫穿透与概念对抗优先级（技能品级 ＞ 角色层级 ＞ 同层对抗，`唯一` 至高）** | 当发生「免疫 vs 无视免疫」「不可驱散 vs 强制抹除」「概念不灭 vs 即死/扣上限」等绝对词条对撞时，严禁写死某一方无条件覆盖另一方，统一按 **`载体品级位格 ＞ 角色层级 ＞ 同层对抗检定`** 三级瀑布裁定；**且在该优先级检定中，`唯一` 大于所有品级与层级（含神话与七阶），与 S4 射程换算中 `唯一` 随角色层级严格区分！** |

---

## 1. 战场尺度模型与 `battle_init` 协议扩展

### 1.1 七阶平均物理尺度表（`TIER_CELL_M`）与权威品质对照

严格对齐世界书 `<核心数值总表>`（`一层=Lv.1-4=普通 | 二层=Lv.5-8=优良 | 三层=Lv.9-12=稀有 | 四层=Lv.13-16=史诗 | 五层=Lv.17-20=传说 | 六层=Lv.21-24=神话 | 七层=Lv.25`），在 `src/core/combat_protocol.js` 中导出权威常量表：

```js
export const TIER_CELL_M = Object.freeze([null, 2, 2, 5, 15, 50, 250, 1000]);

export const QUALITY_TIER = Object.freeze({
  普通: 1,
  优良: 2,
  稀有: 3,
  史诗: 4,
  传说: 5,
  神话: 6,
  // 注意：「唯一」有两套截然不同的语义，严禁混用：
  // 1) 空间射程换算（§2.1 resolveEffectiveTier）：「唯一」动态绑定角色自身层级 unit.tier（1..7）；
  // 2) 概念/免疫对抗优先级（§2.4 resolveAuthorityRank）：「唯一」位格恒为 8，大于所有常规品级与 1..7 阶！
});

export const QUALITY_AUTHORITY = Object.freeze({
  普通: 1,
  优良: 2,
  稀有: 3,
  史诗: 4,
  传说: 5,
  神话: 6,
  唯一: 8, // 在免疫穿透/强制驱散/概念对抗中，「唯一」大于一切（含神话 6 与无品质七阶能力 7）
});
```

| 生命层级 (`tier`) | 等级范围 | 常规对应品质 | 默认单格边长 `cellM` | `12×12` 默认盘覆盖范围 | 同阶主力默认每回合物理移速（≈3~4格） |
| --- | --- | --- | --- | --- | --- |
| **T1 / T2** | Lv.1–8 | 普通(1) / 优良(2) | **`2m`** | `24m × 24m` | `6m ~ 8m` |
| **T3** | Lv.9–12 | 稀有(3) | **`5m`** | `60m × 60m` | `15m ~ 20m` |
| **T4** | Lv.13–16 | 史诗(4) | **`15m`** | `180m × 180m` | `45m ~ 60m` |
| **T5** | Lv.17–20 | 传说(5) | **`50m`** | `600m × 600m` | `150m ~ 200m` |
| **T6** | Lv.21–24 | 神话(6) | **`250m`** | `3km × 3km` | `750m ~ 1km` |
| **T7** | Lv.25 | *(常规最高神话6；唯一/登神随角色)* | **`1000m` (`1km`)** | `12km × 12km` | `3km ~ 4km` |

**开战时确定尺度；不改变任何单位自身层级**：
- 两项都省略：取初始参战单位最低层级（缺失按 1），由 `TIER_CELL_M[anchorTier]` 取单格米数。低阶成员不会因高阶单位入场失去走位，纯高阶队也不会退回室内尺度。
- 只声明层级：按声明取层级并查表取米数。只声明米数：保留米数；≤2 米为一阶，(2,15) 米为三阶，此后在 15、50、250、1000 米处分别升至四至七阶。二阶与一阶都是 2 米，需区分时显式声明层级。
- 两项都声明：各自生效。声明任一项即 `explicit: true`，仅默认推导为 `false`。

### 1.2 `state.scale` 状态结构与校验（`src/api/validation.js`）

在 `state` 顶层新增必填对象（旧预设初始化时自动补默认 `{ cellM: 2, width: 10, height: 10, anchorTier: 1 }`）：

```js
state.scale = {
  cellM: 50,          // 单格物理米数：有限正数，范围 [1, 10000]
  width: 14,          // 棋盘列数 W == state.grid[0].length，整数 [8, 20]
  height: 12,         // 棋盘行数 H == state.grid.length，整数 [8, 20]
  anchorTier: 5,      // 战场空间层级 1..7
  explicit: true      // 是否显式指定层级或比例尺
};
```

**`validation.js` 坐标校验改造**：
- 删除全局写死的 `export const coord = v => int(v, 0, 9);`！
- 改为传入 `state`（或网格宽高 `w, h`）的边界校验：`inGrid(state, x, y)` 要求 `int(x, 0, state.grid[0].length - 1) && int(y, 0, state.grid.length - 1)`；网格行数 `int(state.grid.length, 8, 20)`，每行列数一致且 `int(cols, 8, 20)`。

### 1.3 `src/tavern/descriptor.js` 与 `terrain.js` 解析规则

`battle_init` 首行格式（尾部键值参数顺序无关，全部可选）：
```text
battle|1|<ID>|<场景标题>|flat或terrain[|<seed>][|棋盘=<W>x<H>][|战场层级=<1..7>][|比例尺=<长度>][|战斗类型=<类型>][|压制方=blue|red]
```
- **`棋盘=<W>x<H>`**（兼容 `x`、`X`、`×`、`*`）：`W`、`H` 必须是 `8..20` 的整数；否则抛明确中文错误 `棋盘尺寸必须在 8x8 至 20x20 之间`。缺省 `10x10`。
- **`战场层级=<1..7>`**：接受别名 `尺度层级`，可带「第」「阶／级」修饰词。非 1 至 7 整数、同一首行重复声明（含别名混用）均报错。
- **`比例尺=<长度>`**：正则 `/^(\d+(?:\.\d+)?)\s*(km|千米|公里|m|米)?$/i`；带 `km/千米/公里` 乘 `1000`，缺单位默认 `m`；换算后须落在 `[1, 10000]` 米内。
- 各实体行坐标校验：允许两位数的 `x, y`（原正则 `/^\d\s*,.../` 只认一位数 `0..9`，**必须改为 `/^\d{1,2}\s*,\s*\d{1,2}.../`** 并校验 `0 <= x < width && 0 <= y < height`）！
- **同格占座放宽**：`descriptor.js` 中 `unit` 行允许多个单位声明在同一 `(x, y)`（只要不超过单格容量 4）；`cover` 与 `interact` 仍保持各自坐标不重名冲突。
- **`terrain.js` 动态网格生成**：`createBattleGrid` 按 `(battle.width ?? 10, battle.height ?? 10)` 创建 `height × width` 二维数组；默认 `terrain` 模式的平台与坡道按 `Math.floor(width / 2), Math.floor(height / 2)` 居中比例映射，不再硬编码 `9 - x`！

- **`unit` 坐标**：支持 `x,y`、`x,y,z`、`x,y,飞行=N`、`x,y,z,飞行=N`，其中 `飞行=N` 可换成 `悬浮=N`。四段式的第 3 段必须为整数地面高程 `z`（`-4..8`），第 4 段只接受 `飞行=N` 或 `悬浮=N`（整数离地格数 `0..12`）。显式 `z` 由 `terrain.js` 用于锚定 `grid[y][x].z`（全锚点 `z=0` 时保持 `terrain` 种子地形生成不变）；正的 `N` 落盘为 `state.units[id].altitude`，`N=0` 不写该字段。实时海拔为 `grid[y][x].z + (unit.altitude ?? 0)`。`cover` 与 `interact` 仍只接受 `x,y,z`，地面高程同为 `-4..8`。
- **初始战场效果**：标准格式为 `效果|<id>|<全体/蓝/红>|<名称：描述>|<范围>`；行前缀兼容 `effect`。六段式兼容 `效果|<id>|<阵营>|效果|<名称：描述>|<范围>`（第 4 段标记也可写 `effect`）或 `效果|<id>|<阵营>|<名称>|<描述>|<范围>`。同一描述符最多 16 条，ID 与其他实体共用唯一性校验，不占用格子站位。
  - 阵营别名：`全体` / `全部` / `all` / `any`、`蓝` / `蓝方` / `blue`、`红` / `红方` / `red`。
  - 范围：`全场`（别名 `全图` / `board`）、`全场(z1-z2)`、`(x1-x2)(y1-y2)` 或 `(x1-x2)(y1-y2)(z1-z2)`。矩形坐标必须有序且在棋盘内，不做夹紧；高度是比较单位实时海拔的闭区间，须满足 `-4 <= z1 <= z2 <= 20`，省略则不限高度。落盘及标准化见 §3.5。

---

## 2. 射程、范围与移动力的层级尺度换算公式

### 2.1 核心公式与三类载体 `effectiveTier` 定论

上游生成规范参见 `F:\hermescache\hermes-workspace\roming\技能装备道具生成规则.txt` 与 `<核心数值总表>`。武器、道具、技能、范围与位移效果**全部沿用世界书小数值 `X`**（无需写精确米数）：

令 `r = TIER_CELL_M[effectiveTier] / state.scale.cellM`。当 `r <= 5` 时保留线性换算；否则 `effRatio = 5 + sqrt(r - 5)`。以下 `sandboxCells` 指 `X × effRatio`（在线性区即 `X × r`）。表达式 `scale_cells(X)` 返回未取整的同一结果。

#### 权威 `effectiveTier` 结算函数（必改 `src/tavern/converter.js` 品质解析！）
> **⚠️ 现状坑点提示**：当前 `src/tavern/converter.js:755` 将技能 `quality` 硬编码写死了 `'普通'`！必须改为真实提取 `quality / 品质` 以及 `meta` 数组中的品级词（`唯一 | 普通 | 优良 | 稀有 | 史诗 | 传说 | 神话`，例如 `反派角色.json` 扎托克斯的 `meta: ["唯一", "被动"]` / `["神话", "被动"]`），缺失时记为 `undefined`（如登神长阶能力 `要素/权能/法则/神位/神国` 按规则本来就无品质字段！），严禁静默填 `'普通'`——否则既会算错跨阶射程，又会把神话/唯一技能在 §2.4 的对抗位格误降成 1 阶普通！

```js
export function resolveEffectiveTier(carrierKind, quality, unitTier) {
  const actorTier = clampInt(unitTier ?? 1, 1, 7);
  // 1. 特例：「唯一」品质（以及无品质字段的登神能力/徒手普攻），无论技能、武器、装备、道具，始终按角色层级算！
  if (!quality || quality === '唯一') return actorTier;
  const qTier = QUALITY_TIER[quality];
  if (!qTier) return actorTier;
  // 2. 技能：取 max{品质对应层级, 角色层级}
  //    （高阶强者放低阶基础法术随自身魔力升维投射；低阶角色血脉觉醒的高品质技能按技能高阶发挥）
  if (carrierKind === 'skill') return Math.max(qTier, actorTier);
  // 3. 武器、防具/饰品主动效果、道具：取 min{品质对应层级, 角色层级}
  //    （七阶强者拉一阶凡木弓受限于器物材质仍为一阶射程；一阶凡人握六阶神话枪受限于自身层次只能发挥一阶射程）
  return Math.min(qTier, actorTier);
}
```

#### 对齐《技能装备道具生成规则.txt》的五项标签解析要求（`area-tags.js` & `converter.js`）
1. **五档距离名补全**：`area-tags.js` 的档位词表由 `'贴身|近程|中程|远程|超距'` 扩充为 `'贴身|近程|中程|远程|超视距|超距'`。其中 `<核心数值总表>` 定义的 **`贴身(0)`（`X = 0`）** 换算后为 **`range = 0`**，原生对应本规范的**同格贴身攻击（`gridDistance === 0`）**！
2. **多独立目标斜杠分项拆解（见生成规则 `§多效果的目标与有效距离规范`）**：
   - 当标签出现 `[单体/范围: 近程(2)+圆(友方)]` 与 `[有效距离: 贴身(0)/中程(3)]` 时，必须按 `/` 同步逐项拆分：
   - 对武器而言：**第 1 项固定对应武器普通攻击（`mainHand`）**，第 2 项起依次对应武器的额外主动效果（严禁把整串含 `/` 的文本当成单个标签导致匹配失败或合并丢失）！
3. **范围几何换算 `radius / innerRadius / width`**：
   - 支持 `[范围: 层次(X)+形状(目标筛选)]`（形状：`圆/扇/线/环/锥`；筛选：`敌方/友方/环境/所有`）。
   - 跨尺度放大时，外半径以 `max(rawRadius, ceil(min(width,height) × 0.6))` 为上限；未放大的外半径、宽度和内半径仍以 30 格为上限。对 `sandboxCells` 应用相应上限（保留浮点精度如 `0.5`、`1.5`，解除旧代码 `Math.min(6, ...)` 截断）。
   - 当范围技能（`shape !== 'single'`）换算后 `radius < 0.5` 时，落点仅覆盖目标格 `(tx, ty)` 自身（对该格内全体符合筛选的同格单位生效）。
4. **位移标签 `[位移: X]` 同步换算（见生成规则 `§位移效果生成规范`）**：
   - 效果行中的 `[位移: X]`（单位为位置值 `X`，从被移动单位位移前位置起算，独立于有效距离）同样通过所在载体的 `effectiveTier` 折算：`maxMoveCells = Math.min(width + height, Math.floor(sandboxCells + 1e-9))`（供标准化辅助模型或运行时校准 `move` 操作码距离上限）。
5. **有效距离 `range` 落盘**：
   - 目标为 `'self'` 时固定 `range = 0`；其余 `range = clamp(Math.floor(sandboxCells + 1e-9), 0, 64)`（解除旧 15 格死上限；`range = 0` 完全合法）。徒手的缩放射程至多 1 格；近战借机威胁距离还不能超过原始武器距离向下取整（该上限至少 1 格），不能把放大后的普攻射程当成缠斗圈。

### 2.2 距离命中修正（`src/core/combat_protocol.js`）

1. **同格贴身（`dist === 0`）**：
   - 若使用的是**纯远程非近身武器**（`weapon?.ranged === true && !weapon?.closeQuarters`）：处于敌方贴身缠斗压制下，不享受 `+4` 贴身红利，改为承受 **`hit: -4`（贴身受迫）**！
   - 近战武器、徒手、擒抱、短兵或法术：正常取 `DISTANCE_TABLE[0]`（**`贴身：hit +4`**）。
2. **隔格交火（`dist >= 1`）**：
   - 对远程武器/技能，以**换算前的原始档位小数值 `rawRange`（或按当前 `effectiveRange` 归一化 `lookupDist = Math.round((dist / Math.max(6, effectiveRange)) * 6)`）**查 `DISTANCE_TABLE`，确保高阶技能在被放大到小比例尺地图时不会在自身正常射程内白吃超距惩罚。

### 2.3 单位移动力与「跨回合亚格累积槽 `moveCarryPermille`」

1. **单位物理移速 `unit.moveM`（米/回合）统一按小数值 × 自身层级尺度推演**：
   - 先取单位的小数值基础移动格数 `rawMove`：若角色数据显式填了 `move / 移动`（如预设的 `3` 或敏捷型 `4`）则取该小数值；未填则按敏捷给默认小数值 `clamp(3 + Math.floor(Math.log10(Math.max(1, unit.stats.agi / 10))), 3, 5)`。
   - 乘以单位自身层级的平均物理距离：**`unit.moveM = rawMove * TIER_CELL_M[unit.tier]`**！
   - 换算当前战局每回合步数：`unit.move = scaledCells(rawMove, unit.tier, cellM, { floor: true })`（同阶战局下恒等于 `rawMove`；跨入高维大比例尺战局时允许为 `0`）。
2. **亚格累积移动（防止低阶角色在大比例尺地图报错或瞬移 1 公里）**：
   - 在 `unit` 上维护整数状态字段 `moveCarryPermille: 0..999`（千分比进度，纯整数以符合快照/事务规范）。
   - 执行 `move`（倍率 `1`）或 `sprint`（倍率 `2`）时：
     - 本次总格数预算 `totalPermille = (unit.moveCarryPermille ?? 0) + Math.round((mult * unit.moveM / state.scale.cellM) * 1000)`；
     - 可迈出格数 `availableSteps = Math.min(width + height, Math.floor(totalPermille / 1000))`。
     - 若 `availableSteps >= 1`：正常寻路移动 `1..availableSteps` 格，扣除实际消耗步数对应的千分比后余数写回 `moveCarryPermille`。
     - 若 `availableSteps === 0`：一至四阶战场可原地消耗动作蓄步，`moveCarryPermille` 更新为 `totalPermille`；五至七阶战场不提供蓄步选项，零进度时面板显示「尺度压制（限同格）」。

### 2.4 免疫穿透、无视无视免疫与概念对抗的品级优先级裁定

在高层级角色卡与 BOSS 扩展（典型语料见 `反派角色.json` `[DLC][角色][反派扩展-扎托克斯]扎托克斯` 及唯一饰品《万象圣痕》）中，大量存在绝对词条的正面对撞：
- **扎托克斯·`不灭`（`唯一`·被动）**：任何即死、必杀、百分比直接抹杀、属性上限削减或因果律抹除效果对自身无效；针对自身发起的 `[抹杀/概念]` 意图判定强制失败（意图系数锁为 `1.0`）。
- **扎托克斯·`罹难`（`神话`·被动）**：弱控与减益无条件附加，**无视免疫效果**；自身 `HP≥30%` 时，**无需检定免疫强控效果**。
- **扎托克斯·`邪念`（`神话`·主动）**：附加持续至战斗结束、**非神位或法则不可移除**的「邪念标记」。
- **扎托克斯·`崩坏`（`神话`·主动）**：自然 `d20 >= 19` 时 **直接秒杀敌方**。
- **《万象圣痕》·`命定之死 / 黄金律法回归`（`唯一`·饰品）**：命中永久削减目标 `10%` 最大 HP 上限；主动抹除范围内一切增益、减益与结界。

为彻底解决“无视免疫”撞上“免疫一切 / 无视无视免疫”、“不可移除”撞上“抹除一切”时的死锁，确立全引擎唯一的**三级对抗优先级法则**：

$$\textbf{载体品级位格（技能/装备层级）} \;>\; \textbf{角色层级（unit.tier）} \;>\; \textbf{同层对抗检定（Contest）}$$

#### 1. 载体对抗位格 `resolveAuthorityRank`（注意：`唯一 = 8` 大于所有！）

```js
export function resolveAuthorityRank(carrier, ownerUnit) {
  const actorTier = clampInt(ownerUnit?.tier ?? carrier?.sourceTier ?? 1, 1, 7);
  const quality = carrier?.quality;
  // 关键红线：在概念/免疫/驱散对抗中，「唯一」大于所有品级与层级（固定为 8 > 神话 6 & 七阶登神 7）！
  if (quality === '唯一') return { authorityRank: 8, unitTier: actorTier };
  if (quality && QUALITY_AUTHORITY[quality]) {
    return { authorityRank: QUALITY_AUTHORITY[quality], unitTier: actorTier };
  }
  // 无品质字段的载体（如登神长阶的要素/权能/法则/神位/神国，或未单独标品质的派生状态）：
  // 优先取载体显式声明的 authorityRank / sourceQuality，否则回退为持有者角色层级 actorTier (1..7)
  const fallbackRank = clampInt(carrier?.authorityRank ?? carrier?.tier ?? actorTier, 1, 7);
  return { authorityRank: fallbackRank, unitTier: actorTier };
}
```
> **再次强调 `唯一` 的双重语义边界**：
> - 算**射程/范围/位移格数**（`resolveEffectiveTier`）时：`唯一` = `actorTier`（1 阶主角拿唯一剑不会砍出 1 公里）；
> - 算**免疫穿透/驱散保护/即死与锁上限对抗**（`resolveAuthorityRank`）时：**`唯一` = `8`（高于一切常规品质 `1..6` 及无品质七阶能力 `7`）**！即使低阶角色身负 `唯一` 级「不灭」，面对 `神话(6)` 级「崩坏（即死）」或「罹难（无视免疫）」，在第一顺位即以 `8 > 6` 直接压制生效！

初始战场区域以 `sourceId: null` 落盘，不绑定创建者，也不自带 `tier`。需要为明确具有位格的环境法则声明位格时，标准化可写 `/zones/<id>/tier`；当前区域校验接受整数 `1..7`，`resolveAuthorityRank` 将其作为载体位格的显式来源。未声明时沿用解析器的层级回退规则（由调用方提供对抗单位时取其层级；没有对抗单位或来源层级时回退到 `1`），不另设 `0` 位格。

#### 2. 三级瀑布裁定流程（进攻/穿透方 `A` vs 防御/守护方 `D`）

1. **第一顺位 —— 载体品级位格比较（`A.authorityRank` vs `D.authorityRank`）**：
   - `A.authorityRank > D.authorityRank`：**穿透方 `A` 直接胜出**（无需掷骰，无视免疫附加成功 / 强制剥离不可驱散状态 / 概念效果生效）；
   - `A.authorityRank < D.authorityRank`：**守护方 `D` 直接胜出**（无需掷骰，「无视免疫」被高位格免疫拦截 / 状态不可移除 / 即死与削上限无效）。
2. **第二顺位 —— 载体同品级时，比较双方角色层级（`A.unitTier` vs `D.unitTier`）**：
   - 当 `A.authorityRank === D.authorityRank`（如 `神话(6)` 对撞 `神话(6)`，或 `唯一(8)` 对撞 `唯一(8)`）时：
   - `A.unitTier > D.unitTier`：高阶角色直接压制低阶角色（`A` 胜出）；
   - `A.unitTier < D.unitTier`：高阶角色直接免疫低阶角色（`D` 胜出）。
3. **第三顺位 —— 品级与角色层级均相同时，执行「同层对抗检定（Contested Check）」**：
   - 当 `A.authorityRank === D.authorityRank` 且 `A.unitTier === D.unitTier` 时，任何一方均无绝对上位压制权，必须通过统一检定管线进行一次实时 **`contest` 属性对抗检定**：
     - 进攻方掷 `1d20 + 主属性调整值`（默认取来源单位最高施法/心智属性 `max(int, spi)` 或指令显式指定的 `stat`），防御方掷 `1d20 + 抵抗属性调整值`（默认 `max(con, spi)` 或指令指定的 `defenderStat`），计入双方常驻 `checkBonus`；
     - 进攻方胜出则本次穿透生效，否则守护方拦截成功；战斗日志输出可读中文裁定过程（严禁静默吞没或输出裸 JSON）。
     - 在纯函数只读查询 `is_immune()` 与 UI 悬停预览 `dryRun` 中：第一、二顺位直接返回确定布尔结果；落入第三顺位同层对抗时，不推进战局 RNG，预览标记 `conditional: true`。

#### 3. 在 Tactical VM 中的三处接入点（`vm-schema.js` / `vm-rules.js` / `vm-commit.js`）

1. **状态免疫 vs 无视免疫（`apply_status` ↔ `before_status`）**：
   - `apply_status` 新增可选布尔字段 `ignoreImmunity?: boolean`（状态实例落盘时同步快照记录来源的 `authorityRank` 与 `sourceTier`）。
   - 当目标 `before_status` 钩子将 `event.cancel` 置为 `true` 时记录声明该免疫的最高位格守护载体 `D`：
     - 若 `op.ignoreImmunity !== true`：`D` 直接免疫成功（保持现行行为）；
     - 若 `op.ignoreImmunity === true`（如扎托克斯 `罹难` 的弱控无视免疫）：以本次施放载体 `A` 对决守护载体 `D` 跑上述三级瀑布！`A` 胜出则清空 `event.cancel` 强行挂上状态；`D` 胜出则维持免疫并正常触发 `on_status_immunized`。
2. **不可驱散 vs 法则抹除（`undispellable` ↔ `remove_status`）**：
   - `remove_status` 新增可选布尔字段 `force?: boolean`（用于「回归白板」「神位/法则抹除」等强拆指令）。
   - 普通驱散（`force !== true`）遇到 `status.flags?.includes('undispellable')` 一律跳过；
   - 强拆驱散（`force === true`）遇到 `undispellable` 状态时，取当前施放载体 `A` 与该状态落盘时记录的来源位格 `D` 跑三级瀑布：例如 `唯一(8)`《万象圣痕》或 `T7 法则(7)` 强拆 `神话(6)`「邪念标记」→ `8 > 6` / `7 > 6` 直接移除；`传说(5)` 净化术即使写 `force: true` 也会因 `5 < 6` 被挡回。
3. **概念不灭 vs 削上限 / 必杀即死 / 抹杀意图（`before_commit` / `on_lethal_p2` / `combat.js`）**：
   - `commit` 事件（含 `sub_max` 削上限与致死伤害）自动注入来源载体的 `authorityRank` 与 `sourceTier`（公式可读 `event.authorityRank`、`self.authorityRank`），或提供内置比较纯函数 `out_ranks(attacker, defender)`；
   - 面对扎托克斯 `不灭 [唯一]`：敌方 `神话(6)` 的 `崩坏` 即死在第一顺位（`6 < 8`）直接判负拦截；敌方若以同阶 `唯一(8)`《万象圣痕·命定之死》削减其 `maxHp` 上限，则在 `8 == 8` 且同阶时自动落入第三顺位同层对抗检定。
   - 意图锁扩展：`controlPolicy` 或 `mods.flags` 支持 `lockEnemyIntent: 'normal'`（或 `before_check` 拦截敌方 `intent == 'concept' || intent == 'kill'` 强制将意图降级为普通 `1.0x`），原生覆盖扎托克斯 `不灭` 与 `邪念` 的“对自身发起的抹杀/概念意图强制失败”。

---

## 3. 全尺度「一格多人（0 格贴身）」空间与战斗规则

### 3.1 单格容量预算与 ZOC 阻滞（`src/core/spatial.js`）

1. **单格容量上限 `MAX_CELL_CAPACITY = 4`**：
   - 单位占格体积成本 `unitCellCost(state, unit)`：
     - `ratio = (unit.bodyLengthM ?? 1.7) / state.scale.cellM`
     - `ratio <= 0.5` → 占 **`1`** 容量（常规人类在 `2m` 盘最多 4 人同格；`160m` 巨龙在 `1km` 神战盘也只占 `1` 容量）；
     - `0.5 < ratio <= 1.0` → 占 **`2`** 容量；
     - `ratio > 1.0`（超单格巨物，如 `2m` 巷战盘里的 `15m` 巨龙）→ 占 **`4`** 容量（独占整格，他人不可挤入）。
   - 目标格 `(x, y)` 可容纳 `unit` 的充要条件：
     - `isGround(state, {x, y})`
     - 无**障碍型掩体**（见 §4.1：`cellM < 10` 时的实心掩体阻挡占格；`cellM >= 10` 时的区域掩体不阻挡！）
     - `sum(unitsAt(state, x, y, unit.id).map(u => unitCellCost(state, u))) + unitCellCost(state, unit) <= 4`。

2. **敌占格进入与 ZOC 停步规则（防止无视前排穿模冲后排）**：
   - 移动允许**走入存有存活敌方单位的格子**（只要剩余容量足够），进入后双方距离变为 `0`（贴身缠斗）。
   - **ZOC 阻滞**：普通移动（`move / sprint`）一旦踏入存有存活敌方单位的格子，**该步必须作为路径终点停下接战**，不可在同一段步行路径中直接从敌方头顶穿过去继续往后走！（`teleport`、`disengage`、或飞行高度差 `Math.abs(elevation(mover) - elevation(enemy)) >= 2` 不受地面敌军 ZOC 阻滞）。

3. **借机反应攻击（Opportunity Attack）适配**：
   - 近战威胁范围定义为 `gridDistance(reactor, mover) <= 1`（含同格 `0` 与相邻格 `1`）。
   - 当移动者从同格（`0`）迈出到相邻格（`1`），或从相邻格（`1`）迈出威胁区时，均触发敌方就绪的借机反应攻击（`disengage / push / pull / teleport` 豁免保持不变）。

4. **空间查询 API 升级**：
   - `spatial.js` 导出 **`unitsAt(state, x, y, exceptId)`**（返回该格全部存活未逃跑单位，按 `byId` 确定性排序）。
   - 保留 `unitAt(state, x, y, exceptId)` 返回 `unitsAt(...)[0]` 兼容单目标默认读取，但以下链路必须全部改为读取 `unitsAt` 全集：
     - **范围技能结算（`combat.js` / `vm-select.js`）**：覆盖格 `(x, y)` 内的**所有**符合敌友筛选的同格单位均受范围效果结算（扎堆同格天然全员吃满 AoE！）。
     - **单体瞄准、AI 寻路与点击（`combat.js` / `ai.js` / `ui/main.js`）**：
       - 单体攻击/技能/压制/解救动作必须通过 `{ type: 'attack'|'skill'|'suppress'|'free_ally', targetId: unit.id, x, y }` 中的 `targetId` 精确锁定同格内的目标单位，绝不误取同格内的行动者自身 `actor` 或队友！
       - **`ai.js` 必改细节**：`aimedOptions` 与 `approach` 生成候选攻击/单体技能动作时必须附带 `targetId: target.id`；`approach` 读取武器射程须写 `weapon?.range ?? 0`（严禁把合法的 `range === 0` 贴身武器回退成 `1.5`，确保手持 `贴身(0)` 武器的 AI 会主动走入敌方所在格 `dist = 0` 发起贴身攻击）！
     - **同格友军选择（如《裂渊夜幕之翼》）**：VM `Selector` 中 `"candidate.x == self.x && candidate.y == self.y && candidate.team == self.team"` 原生选出全部同格友军并随 `move(mode:'teleport')` 整组落位（落点格容量校验支持整组迁入）。

### 3.5 初始战场区域落盘与标准化

- 转换器将 `效果` 行落盘为 `state.zones[id]`：保留 `id`、`name` 和 `area`，并初始化 `sourceId: null`、`team: null`、`follow: false`、`persistent: true`、`remainingTurns: 1`、`tags: ['scene_effect']`、`mods: []`、`rules: []`。`persistent: true` 表示整场常驻，不受初始 `remainingTurns: 1` 影响。
- 生成 `scope: 'scene'`、`unitId: null`、`originPath: '/zones/<id>'` 的待标准化警告，携带叙事效果描述、阵营及范围；指定阵营时在补丁规则的 `filter` 或修饰的 `when` 写 `self.team` 条件，不改写 `zone.team`，也不引用没有创建者的 `source.team`。
- 场景使用独立标准化批次（`unitIds: []`）。只能增量修改现有区域的 `/zones/<id>/(rules|mods|tags|vars|flags|tier|shareRulesTo|persistent|remainingTurns)`，不能新建或整块替换区域，也不能改写空间和身份字段。其他批次的区域通过只读 `sharedZoneLedger` 提供给 `in_zone(unit, zoneIdOrTag)` 联动查询，不允许修改或核销。纯叙事氛围可用非战斗豁免账本跳过。

---

## 4. 掩体与地形的尺度自适应（解决大比例尺掩体无用）

### 4.1 障碍掩体 vs 区域地形遮蔽（`spatial.js`）

掩体根据当前战场单格尺度 `state.scale.cellM` 自动呈现正确的物理形态：

1. **小尺度障碍掩体（`cellM < 10`，即室内/街巷 `<10m/格`）**：
   - 物理含义：木箱、石柱、矮墙。
   - **占格阻挡**：不可与单位同格（完全保持既有 `cover_tests` 与预设关卡行为不变）。
   - **遮蔽判定**：沿用既有 `coverBetween`（射线穿过或攻击侧紧邻掩体）。

2. **中大尺度区域地形遮蔽（`cellM >= 10`，即 `10m ~ 1km/格`）**：
   - 物理含义：树林、废墟街区、战壕带、山脊断层、浮空碎石云层。
   - **不阻挡通行**：允许单位直接走入并驻留在掩体所在格 `(cover.x, cover.y)`！
   - **遮蔽判定扩展**：
     - 只要受击者**驻留在掩体格内**且攻击者不在同一格（`!same(from, to)`），或攻击射线穿过中间掩体格（高差未越顶），即享受该掩体的半掩体（`-2`）/ 全掩体（`-5`）命中修正！
     - **近身破掩体**：若攻击者冲进与受击者相同的格子（`dist === 0` 贴身交战），区域掩体遮蔽自动失效！
   - **体型遮蔽上限**：若受击者体长 `unit.bodyLengthM > state.scale.cellM * (cover.cover >= 5 ? 1.0 : 0.5)`（如 `10m/格` 地图上的 `160m` 巨龙），该掩体无法遮蔽其躯干，`coverBetween` 对其返回 `null`。

### 4.2 掩体耐久随战场尺度自动缩放（`converter.js`）

废除 `converter.js` 将所有掩体硬编码为 `hp: 10` 的旧逻辑。未显式指定 `hp` 时，按当前战场 `cellM` 查尺度耐久曲线计算默认 `hp / maxHp`：

```js
export function defaultCoverHp(cellM, isFullCover = false) {
  const base = isFullCover ? 25 : 10;
  // cellM=2 -> 25/10（小尺度保持轻脆可破坏）；cellM=10 -> 250/100；cellM=50 -> 2500/1000；
  // cellM=250 -> 31250/12500；cellM=1000 -> 250000/100000
  const factor = cellM <= 2 ? 1 : Math.round(Math.pow(cellM / 2, 1.8));
  return base * factor;
}
```
*(注：内置预设关卡 `scenarios.js` 若显式写了 `hp: 10` 则保留其显式值，确保旧预设坍塌单测 100% 兼容。)*

---

## 5. VM 公式与前端 UI 适配要求

### 5.1 `src/core/formula.js` 变量与纯函数注册
向受控表达式注册表新增以下只读战场尺度上下文（自动同步至 `formulaReference`）：
- 变量：`cellM`（单格米数）、`boardW`（棋盘列数）、`boardH`（棋盘行数）、`distanceM`（`distance3D * cellM` 物理米距）。
- 纯函数：`cells_m(meters)` → 返回 `meters / cellM`（供 VM `move` / `spawn(zone)` 等需要按物理米数动态折算格数时直接调用）。

### 5.2 前端棋盘渲染与同格选人交互（`src/ui/`）

1. **顶栏比例尺与全域尺寸徽标（`render.js` / `template.js`）**：
   - 在顶栏 `.ft-round` 文本中追加简洁物理尺度说明，例如：
     `第 1 回合 · 14×12 · 1格=50m (700m×600m)`（当 `cellM >= 1000` 时格式化为 `1km`，如 `16×16 · 1格=1km (16km×16km)`）。
2. **同格多单位渲染（`render.js` + `styles/tactical-ui.css`）**：
   - `render.js` 当前第 152 行只取了 `unitsAt.get(xy)?.[0]`，**必须改为渲染 `unitsAt.get(xy)` 全部单位**！
   - `.tactical-cell-units` 根据格内人数写入 `dataset.stack = String(count)`：
     - `count === 1`：保持现有单棋子全尺寸居中样式不变；
     - `count >= 2`（最多 4 人）：切换为 `display: grid; grid-template-columns: 1fr 1fr; gap: 2px;`，微缩头像与血条使 2~4 枚棋子清晰并列显示在同一格内，当前行动单位或被选中单位高亮金框。
   - **动画偏移**：`animation.js` 计算单位像素中心点时，若同格有多名单位，读取对应 `[data-unit-id]` DOM 节点的真实几何中心（而非整格中心），使浮字和弹道精准落在该棋子上。
   - **目标浮卡同格切换器（`main.js` / `#target-actions`）**：
     - 当玩家点击一个站有多名单位的格子时，`#target-actions` 顶部展示格内单位切换按钮组（标明敌友颜色、名字与当前 HP%），切换时实时刷新针对该具体 `targetId` 的命中率与伤害预览！
   - **CSS 同步铁律（规则 #190 / #176）**：
     - 修改 `styles/tactical-ui.css` 或 `styles/battle-theme.css` 后，**必须同步重新生成 `src/ui/styles.js`**；严禁破坏 `tests/e2e_chrome.mjs` 依赖的 `.tactical-cell[data-x][data-y]`、`[data-unit-id]`、`#board`、`#board-frame` 等既有选择器。

---

## 6. 主模型提示词协议更新（遵守规则 #218 / #262）

> **受众隔离红线**：主模型（酒馆跑文）只接收极简声明语法，**严禁**向主模型暴露 VM Opcode 或内部换算公式。

在主模型 `<战前资源推演>` / `battle_init` 格式说明中，使用以下可选声明（**武器和技能词条写法完全不变，继续沿用原有小数值！**）：

1. **首行可选棋盘尺寸 `|棋盘=<宽>x<高>`**（范围 `8x8` 至 `20x20`）：
   - 密室/擂台用 `8x8`~`10x10`；常规遭遇战推荐 `12x12` 或 `14x12`；断桥/长廊/峡谷用长方形如 `16x8`；大型群战/巨兽/神战用 `16x16`~`20x20`。
2. **首行可选战场比例尺 `|比例尺=<单格长度>`**（如 `2m`、`10m`、`50m`、`250m`、`1km`）：
   - 可另填 `|战场层级=1..7`；两项都不填时按最低参战层级匹配尺度。仅当场景有特殊空间约束（如高阶强者在狭小室内交手写 `|比例尺=2m`，或在超广袤平原追击写 `|比例尺=250m`）时显式填写。大比例尺下 `cover` 请声明对应体量的地貌掩体（如树林、废墟、山峰、浮岛）。
3. **装备与技能距离保持原样**：无需改写为米数，继续使用世界书标准小数值（如 `近程(1)`、`中程(5)`、`远程(10)`、`圆形(4)`），沙盘会自动结合该装备/技能所在层次与当前战场比例尺换算实际射程与范围。

4. 飞行单位同时处于高低起伏地形时，允许写 `x,y,z,飞行=N`（如 `3,8,1,飞行=1` 表示地面高 1、离地飞行高 1）。
5. 战场存在影响战斗的环境/区域效果时，可在底部追加 `效果|ID|全体或蓝或红|名称：效果描述|(x1-x2)(y1-y2)(z1-z2)` 或将范围写作 `全场`；严禁向主模型暴露 `zone`、`mods`、`rules` 或任何 VM 指令名。

---

## 7. 必测验收用例清单（`tests/scale_grid_tests.mjs`）

实现完成后须新增专项自动化测试覆盖以下 8 组核心场景，并确保原有全部单测与 Chrome E2E 全绿：

1. **动态长方形棋盘与两位坐标解析**：
   - 解析 `battle|1|bridge|断魂桥阻击|flat|7|棋盘=16x8|比例尺=10m`，单位部署在 `(15, 7)` 合法通过，`(16, 7)` 或 `(15, 8)` 准确报错；`atBattleEdge` 准确识别 `x=15` 与 `y=7` 边界逃跑格。
2. **最低参战层级自动定比例尺 vs 显式覆盖**：
   - `T7 恩摩索伦 + T3 侍从 vs T5 主角` 且两项均未填 → `state.scale.anchorTier === 3, state.scale.cellM === 5`；
   - 同一阵容显式声明 `|比例尺=2m`（密室压制）→ `state.scale.cellM === 2`。
3. **`effectiveTier` 三法则（技能 `max`、武器/道具 `min`、`唯一` 随人）专项验证**：
   - **唯一特例（双向验证）**：
     - **低阶持唯一**：`T1` 角色持有 **`唯一` 佩剑**（`[有效距离: 近程(2)]`）与 **`唯一` 技能**（`[有效距离: 中程(4)]`）在 `T1 (cellM = 2m)` 盘 → `effectiveTier` 均为 `1`（绝不误算为 `T7 1km`），沙盘格数为 **`2` 与 `4`**；当该角色升至 `T7` 进入 `cellM = 1000m` 盘 → `effectiveTier` 自动升为 `7`，沙盘格数仍为 **`2` 与 `4`**！
   - **技能 `max{品质, 角色层级}`**：
     - `T6 (250m)` 法师施放 **`普通(T1)` 火球术**（`中程(4), 范围: 近程(2)+圆(敌方)`）在 `cellM = 250m` 盘：`max(1, 6) = 6` → 射程 **`4` 格**、半径 **`2` 格**（随高阶施术者升维）；
     - `T2 (2m)` 血脉觉醒者施放 **`传说(T5, 50m)` 血脉技能**（`中程(3)`）在 `T2 (cellM = 2m)` 盘：`max(5, 2) = 5` → `floor(3 × (5 + sqrt(25 - 5)))` → **`range = 28`**。
   - **武器与道具 `min{品质, 角色层级}`**：
     - `T7 (1000m)` 强者手持 **`普通(T1, 2m)` 制式木弓**（`远程(8)`）在 `cellM = 1000m` 盘：`min(1, 7) = 1` → `floor(16 / 1000) = 0` → **`range = 0`**（凡木弓在神战盘只能同格贴脸射）；
     - `T2 (2m)` 凡人拾取 **`神话(T6, 250m)` 弑神枪**（`中程(4)`）在 `T6 (cellM = 250m)` 神话盘：`min(6, 2) = 2` → `floor(8 / 250) = 0` → **`range = 0`**（凡人催动不了神器远射，但在 `T2 (cellM = 2m)` 盘仍可打出 `4` 格）；
     - 多目标武器标签 `[单体/范围: 近程(2)+圆(敌方)]` + `[有效距离: 贴身(0)/中程(4)]`：普攻正确拆出 `range = 0`，武器主动效果拆出对应 `中程(4)` 换算值；`[位移: 3]` 按同一载体 `effectiveTier` 换算位移格数。
4. **跨层级移动与 `moveCarryPermille` 亚格累积槽**：
   - 在显式 `战场层级=4|比例尺=1km` 的盘上：T7 角色每回合正常走 `3~4` 格；T2 凡人（`moveM = 6m`）执行移动时不瞬移 1km、不报错崩溃，`moveCarryPermille` 精确累加 `6` 并记录推进战报；当某单位 `moveM = 600m` 时，普通 `move` 累积 `600`（原地蓄步），次回合再 `move` 满 `1200` 迈出 `1` 格并余 `200`（且 `exportSnapshot → importSnapshot` 完整重放一致）。
5. **全尺度一格多人与 `0 格` 贴身生态分化**：
   - 在 `2m/格` 与 `1000m/格` 下均允许最多 4 名标准单位走入同一格；第 5 人尝试走入时被容量上限拒绝；超单格巨兽（如 `2m` 盘上的 `15m` 巨兽）占满 4 容量独占该格。
   - 刺客走入敌方弓手所在格（`dist = 0`）：ZOC 强制刺客在该格停步；刺客匕首攻击享 `贴身 +4` 命中加成；弓手未脱身直接用长弓反击同格刺客时吃 `贴身受迫 -4` 惩罚；弓手不点脱身直接走出该格触发刺客借机攻击。
6. **同格 AoE 全吃与单体精准点名 + 携同格友军瞬移**：
   - 同一格内站有 2 名红方与 1 名蓝方：单体攻击通过 `targetId` 只打指定的那 1 名红方；对敌圆形 AoE 覆盖该格时，2 名红方各结算 1 次且不误伤蓝方（若为无差别爆炸则 3 人全结算）。
   - 蓝方施放携同格友军瞬移（《裂渊夜幕之翼》模式），同格队友随施术者一同瞬移至目标格。
7. **大尺度区域掩体（可进格遮蔽 + 近身破除 + 耐久缩放 + 巨兽不可藏）**：
   - `cellM = 50m` 下生成 `cover|c1|全|断壁废墟|4,4,0`：默认耐久为 `2500`（而非 `10`）；蓝方步兵可直接走进 `(4,4)` 格内，受 `(4,8)` 远程射击时享 `-5` 全掩体保护；红方近战冲进 `(4,4)` 同格挥砍时无掩体减值；体长 `60m` 的巨兽站在 `(4,4)` 不享受该掩体保护。
8. **前端多尺寸与同格多棋子 E2E 验证**：
   - `node.exe build.mjs` 与 `node.exe tests/e2e_chrome.mjs` 跑通，验证 `14×12` 棋盘 `--cols: 14; --rows: 12` 正常渲染缩放、同格 2 名单位在 `.tactical-cell-units` 内并列可见且可通过目标浮卡分别选中。
9. **品级对抗优先级三法则（以扎托克斯 `反派角色.json` 为验收语料）**：
   - **第一顺位（技能品级压制，且 `唯一 > 所有`）**：
     - `神话(6)` 技能 `罹难`（`apply_status { ignoreImmunity: true }`）攻击持有 `传说(5)` 异常免疫护符的目标 → `6 > 5`，直接穿透免疫挂上异常；
     - 同一 `神话(6)` 技能 `罹难` 或 `崩坏`（即死）攻击持有 **`唯一(8)` 被动 `不灭`** 的角色（哪怕该角色 `unit.tier` 更低）→ `6 < 8`，第一顺位直接由 `不灭` 拦截，`ignoreImmunity` 与即死均失效！
     - `唯一(8)` 饰品《万象圣痕》施放 `remove_status { force: true }` 作用于扎托克斯 **`神话(6)` `邪念`** 施加的 `undispellable`「邪念标记」→ `8 > 6` 成功移除；而 `传说(5)` 驱散即使带 `force: true` 也无法移除「邪念标记」。
   - **第二顺位（同品级比角色层级）**：
     - `T6` 扎托克斯的 `神话(6)` `罹难`（无视免疫）对决 `T5` 敌人的 `神话(6)` 强控免疫 → 品级同为 `6`，`unit.tier: 6 > 5`，扎托克斯无需掷骰直接穿透；反之对决 `T7` 敌人的 `神话(6)` 免疫则直接被挡回。
   - **第三顺位（同品级 + 同角色层级 → 同层对抗检定）**：
     - `T6` 佩戴 **`唯一(8)`《万象圣痕·命定之死》** 的角色攻击 `T6` 持有 **`唯一(8)` `不灭`** 的扎托克斯尝试削减 `maxHp` 上限 / 禁绝复活 → 品级同为 `8`、角色同为 `T6`，触发 `contest` 同层对抗检定并写入可读中文战报，固定不同 RNG 种子可分别复现穿透成功与被 `不灭` 弹开两种结果。
