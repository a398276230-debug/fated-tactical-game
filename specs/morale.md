# 战意（morale）—— 现状与整改交接说明

> 目标读者：接手实现的模型。行号基于当前仓库 `version 0.2.9`，动手前请自行核对。
> 规范来源：`roming/combat/几个重要条目内容.md` 的「第七阶段: 战意判定」（约 673–690 行）与「处决目标」（约 534 行）。
> 引擎实现：`src/core/combat_protocol.js`（规则表与纯函数）、`src/core/combat.js`（`moraleCheck`）。

---

## 0. 名词对齐

| 世界书 | 代码 | 备注 |
| --- | --- | --- |
| 战意判定 / 战意动摇 / 崩溃 | `morale` / `shaken` / `routed` | 代码里统一叫 morale |
| 战斗类型 | `unit.moraleType` | six values |
| 战意状态 | `unit.moraleState` | `undefined` / `'shaken'` / `'routed'` |

**本次不新增 DSL 节点**。战意是引擎层的规则，效果则通过现有状态机制表达（见 P1）。

---

## 1. 现状：判定链路

### 1.1 调用点

`combat.js:488` `advanceCursor` 在回合游标溢出、`state.round++` 之后调用 `moraleCheck(state)`（`combat.js:514`）。也就是**每个新回合开始时检查一次**。

### 1.2 检查对象

```js
// combat.js:270-278
function moraleCheck(state) {
  for (const unit of living(state)) {
    const result = moraleResult({ type: unit.moraleType ?? 'standard', hp: unit.hp, maxHp: unit.maxHp, d20: randomDie(state, 20) });
    if (!result.triggered || unit.moraleCheckedRound === state.round) continue;
    unit.moraleCheckedRound = state.round;
    if (!result.check) { unit.moraleState = 'shaken'; continue; }
    unit.moraleState = result.shaken ? 'shaken' : 'routed';
    record(state, unit, 'morale', `${unit.name}${result.shaken ? '动摇' : '溃逃'}`, { targetId: unit.id, ...result });
  }
}
```

`living(state)`（`combat.js:31`）只过滤死亡与已逃跑，**不区分阵营，因此主角也会被检查**。

### 1.3 类型来源与阈值表

`combat_protocol.js:25-26`：

```js
export const MORALE = Object.freeze({ spar: { threshold: .4, check: false }, arena: { threshold: .3, check: false },
  suppress: { threshold: .5, check: false }, deathmatch: { threshold: .1, check: true }, standard: { threshold: .3, check: true }, guard: { threshold: .35, check: true } });
```

| type | 世界书 | 阈值 | 是否检定 | 规范要求 |
| --- | --- | --- | --- | --- |
| `spar` | 切磋 | 40% | 否 | 自动「战意动摇」 |
| `arena` | 竞技 | 30% | 否 | 自动「战意动摇」 |
| `suppress` | 压制 | 50% | 否 | 自动「战意动摇」 |
| `deathmatch` | 死斗 | 10% | d20 | d20<12 → 丧失战意/崩溃 |
| `standard` | 标准 | 30% | d20 | 同上 |
| `guard` | 守卫 | 35% | d20 | 同上 |

**阈值与规范完全一致，不需要改。**

类型可写入的路径只有三处：

| 路径 | 位置 |
| --- | --- |
| `battle_init` 的 participant `moraleType` | `converter.js:697` `moraleType: text(p.moraleType) \|\| 'standard'` |
| `set_unit_stat` 命令的 patch 白名单 | `commands.js:14-15` |
| `custom_state` 直接给单位 | `validation.js:174` 的 `protocolUnitKeys` 含 `moraleType` |

预设固定为 `'standard'`（`presets/scenarios.js:90`）。

### 1.4 判定公式

`combat_protocol.js:80`：

```js
export function moraleResult({ type = 'standard', hp, maxHp, d20 = 20 } = {}) {
  const rule = MORALE[type] ?? MORALE.standard;
  const triggered = hp / maxHp < rule.threshold;
  return { threshold: rule.threshold, triggered, check: rule.check, roll: rule.check ? d20 : null,
    shaken: triggered && (!rule.check || d20 < 12) };
}
```

### 1.5 状态值

`moraleState ∈ { undefined, 'shaken', 'routed' }`，触发后**从不复位**。`moraleCheckedRound` 只拦同一轮重复检查。

---

## 2. 现状：机制效果 —— 零

全仓读取 `moraleState` 的地方只有三处，没有一处影响战斗：

| 位置 | 用途 |
| --- | --- |
| `game_api.js:212-213` | 面板数据输出：`moraleState: moraleState ?? 'steady'` |
| `validation.js:216` | 格式校验（只要求 string） |
| `commands.js:14-15` | patch 白名单 |

`src/ui/` 没有任何地方读取它，`narrate.js` 只处理日志事件，所以**玩家在棋盘上看不到战意状态**。

规范要求但未实现的部分：

1. 「崩溃行为：投降、认输、求饶、溃逃、撤退、阵线溃散、内讧」（第 3 条）
2. 「投降/认输/求饶须等待对方回应；溃逃/撤退须执行逃跑检定」（第 4 条）
3. 「处决选项」（第 5 条）
4. **处决目标加成**（第 534 行）：*目标已战意动摇或崩溃，且攻方意图处决时，目标闪避修正无效且评级保底为平暴击(1.3)*
5. `<user>` 主动投降/认输/求饶触发判定

---

## 3. 缺陷清单

下表按严重度排序，每条给出定位、后果、规范依据、修法。

### D1 检定结果反向（严重，逻辑 bug）

- **定位**：`combat_protocol.js:80` 的 `shaken` 字段 + `combat.js:276`
  ```js
  shaken: triggered && (!rule.check || d20 < 12)          // d20<12 → true
  unit.moraleState = result.shaken ? 'shaken' : 'routed'; // true → 动摇
  ```
- **后果**：d20<12（未通过）拿到较轻的「动摇」，d20≥12（通过）拿到更重的「溃逃」。恰好与规范相反。
- **依据**：`几个重要条目内容.md:678`「需要检定(d20<12 触发[丧失战意/崩溃])」。
- **修法**：结果改成三态枚举，判定放在 `moraleResult` 里（见 §4 P0-1）。

### D2 无检定的三档不写日志

- **定位**：`combat.js:275` `if (!result.check) { unit.moraleState = 'shaken'; continue; }` 跳过了 `record`。
- **后果**：切磋/竞技/压制触发战意时，`state.logs` 里什么都没有 → `narrate.js` 不播报、`battle_report.js` 不出现、UI 无动画。
- **修法**：先算结果再决定是否 `record`，不要用 `continue` 短路。

### D3 主角参与战意判定

- **定位**：`combat.js:271` `for (const unit of living(state))`，无阵营/身份过滤。
- **后果**：主角血量跌破 30% 会被设成 `shaken`。规范明确「仅非 `<user>` 单位 HP 低于阈值时触发」。
- **修法**：给主角单位加显式标记（见 P2-1），`moraleCheck` 里跳过。

### D4 状态永不复位

- **定位**：只有 `combat.js:275-276` 写入，没有任何写入 `undefined` / `'steady'` 的路径。
- **后果**：被治疗回满血、复活后仍保持 `routed`；`game_api.js:213` 的 `moraleState ?? 'steady'` 里的 `'steady'` 是个实际**永远不会产生**的兜底值。
- **修法**：见 P2-2（是否复位属于设计决策）。

### D5 状态零机制效果

- **定位**：全仓无消费点（见 §2）。
- **后果**：战意判定只是往日志里写一行字，对命中、伤害、行动、AI 决策、胜负判定都没有影响。规范里「战意动摇本身不等于战斗结束」意味着后面还该有行为，但这些都不存在。
- **修法**：见 P1。

### D6 `moraleType` 无白名单，拼错静默回落

- **定位**：`converter.js:697` 用 `text(p.moraleType) || 'standard'`，不做枚举校验；`combat_protocol.js:80` 用 `?? MORALE.standard` 兜底。
- **后果**：写「死斗」而不是 `deathmatch` → 静默变成 `standard`（30%/需检定），没有任何警告。
- **修法**：converter 里白名单 + warning；`validation.js` 加枚举。

### D7 `moraleState` 无 UI 显示

- **定位**：`src/ui/render.js` 的 `renderActor`（:217-234）和 `renderUnitCard`（:236 起）都没有读这个字段。
- **后果**：玩家只能在战报里看到一行字；棋盘上无法判断敌人是否已经动摇。
- **修法**：见 P2-3。

### D8 每轮无条件掷 d20（RNG 消耗）

- **定位**：`combat.js:272` 的 `d20: randomDie(state, 20)` 是实参，先于 `triggered` 判断求值。
- **后果**：每个存活单位每回合固定消耗一个 d20，即使血量满、根本没触发。影响快照重放与「同一 seed 同结果」的可预测性，也让掷骰序列无谓地拉长。
- **修法**：先判断 `triggered`（不掷骰），需要检定时才掷。

### D9 文案与骰卡绑定在错误的布尔上

- **定位**：
  - `narrate.js:212-215`：`tone: d.shaken ? 'status' : 'defeat'`，`verdict: d.shaken ? '动摇' : '溃逃'`，正文写死「生命跌破 X%，士气动摇」。
  - `battle_report.js:166-167`：`checkGrade(detail.shaken, detail.roll)` —— `checkGrade(success, roll)` 把 `shaken` 当成「检定成功」。
- **后果**：一旦修 D1，这三处会全部给出相反结论；反过来，现在它们和 D1 一起错，所以表面自洽。
- **修法**：随 D1 一起改成读显式的 `outcome` 字段。

### D10 `validation.js` 不校验枚举

- **定位**：`validation.js:216`
  ```js
  checkOptional(v, 'stance', x => typeof x === 'string'); checkOptional(v, 'moraleType', x => typeof x === 'string'); checkOptional(v, 'moraleState', x => typeof x === 'string');
  ```
- **后果**：任何字符串都能通过校验，包括 `'steady'`（引擎不认识的值）和拼错的类型名。
- **修法**：`moraleType` 用 `MORALE` 的键做枚举；`moraleState` 用 `['steady','shaken','routed']`。

### D11 处决加成未实现

- **定位**：规范 `几个重要条目内容.md:534`；引擎无实现（`combat.js` 的 preview 里无 `moraleState` 读取）。
- **后果**：对手已经崩溃，玩家选择「抹杀」意图时，拿不到规范承诺的「闪避修正无效 + 评级保底平暴击」。
- **修法**：见 P1-2。

---

## 4. 整改方案

### P0 修 bug（必须做，行为等价性可测）

#### P0-1 重写 `moraleResult`，输出三态

`src/core/combat_protocol.js`，替换第 80 行：

```js
// 触发的判定只看血量；需要检定的类型由调用方传入 d20。
export function moraleResult({ type = 'standard', hp, maxHp, d20 } = {}) {
  const rule = MORALE[type] ?? MORALE.standard;
  const triggered = maxHp > 0 && hp / maxHp < rule.threshold;
  const base = { threshold: rule.threshold, triggered, check: rule.check };
  if (!triggered) return { ...base, roll: null, outcome: 'none' };
  if (!rule.check) return { ...base, roll: null, outcome: 'shaken' };          // 自动动摇
  const roll = Number.isFinite(d20) ? d20 : null;
  const broke = roll !== null && roll < 12;
  return { ...base, roll, outcome: broke ? 'routed' : 'none' };               // 失败=崩溃，成功=坚守
}
```

三态的语义（与规范对齐）：

| outcome | 含义 | 来源 |
| --- | --- | --- |
| `none` | 未触发，或需检定且通过（坚守） | 血量高于阈值 / d20≥12 |
| `shaken` | 战意动摇 | 仅无检定的三档 |
| `routed` | 丧失战意/崩溃 | 需检定且 d20<12 |

**注意**：`outcome: 'none'` 同时覆盖「没触发」和「通过检定」两种情况。需要区分时用 `triggered`。

#### P0-2 重写 `moraleCheck`

`src/core/combat.js:270-278`，替换为：

```js
function moraleCheck(state) {
  for (const unit of living(state)) {
    if (unit.protagonist || unit.moraleCheckedRound === state.round) continue;
    const type = unit.moraleType ?? 'standard';
    const rule = MORALE[type] ?? MORALE.standard;
    if (unit.maxHp <= 0 || unit.hp / unit.maxHp >= rule.threshold) continue;
    unit.moraleCheckedRound = state.round;
    const result = moraleResult({ type, hp: unit.hp, maxHp: unit.maxHp, d20: rule.check ? randomDie(state, 20) : undefined });
    if (result.outcome === 'none') {
      record(state, unit, 'morale', `${unit.name}坚守战意`, { targetId: unit.id, ...result, quiet: true });
      continue;
    }
    unit.moraleState = result.outcome;
    record(state, unit, 'morale', `${unit.name}${result.outcome === 'shaken' ? '战意动摇' : '丧失战意'}`, { targetId: unit.id, ...result });
  }
}
```

要点：
- `d20` 只在 `rule.check` 时掷（修 D8）
- 无检定档也走 `record`（修 D2）
- 跳过 `unit.protagonist`（修 D3，标记见 P2-1）
- 通过检定时写一条 `quiet` 日志（是否要这条日志是决策点，见 §7）
- 需要在 `combat.js:6` 的 import 里补 `MORALE`

#### P0-3 修 `narrate.js`

`src/ui/narrate.js:212-215`：

```js
case 'morale': {
  const outcome = d.outcome ?? (d.shaken ? 'shaken' : 'routed');   // 兼容旧快照
  const label = { shaken: '战意动摇', routed: '丧失战意', none: '坚守战意' }[outcome] ?? outcome;
  return out({ tone: outcome === 'none' ? 'info' : outcome === 'shaken' ? 'status' : 'defeat', icon: '🏳️',
    lines: [`生命跌破 ${pct(d.threshold ?? 0)}，${label}`, Number.isFinite(d.roll) ? `战意检定 d20 得 ${d.roll}` : null].filter(Boolean),
    roll: Number.isFinite(d.roll) ? { kind: 'd20', label: `${nameOf(state, d.targetId)} · 战意检定`, dice: [d.roll], kept: d.roll, mode: 'normal', modifier: 0, total: d.roll,
      verdict: d.roll < 12 ? '崩溃' : '坚守', tone: d.roll < 12 ? 'miss' : 'hit' } : undefined });
}
```

#### P0-4 修 `battle_report.js`

`src/api/battle_report.js:166-167`，`checkGrade(detail.shaken, detail.roll)` 的语义反转，改为：

```js
case 'morale': {
  const outcome = detail.outcome ?? (detail.shaken ? 'shaken' : 'routed');
  add(replaceUnitNames(event, text) + (detail.check ? notes([`战意检定${detail.roll < 12 ? '失败' : '通过'}`]) : ''));
  break;
}
```

（`checkGrade` 的「大成功/大失败」粒度对士气检定没有意义，直接写失败/通过更清楚；若坚持复用 `checkGrade`，必须传 `detail.roll >= 12` 而不是 `detail.shaken`。）

#### P0-5 枚举校验

`src/api/validation.js:216`：

```js
checkOptional(v, 'stance', x => typeof x === 'string');
checkOptional(v, 'moraleType', x => typeof x === 'string' && Object.hasOwn(MORALE, x));
checkOptional(v, 'moraleState', x => ['steady', 'shaken', 'routed'].includes(x));
```

顶部 `import { MORALE } from '../core/combat_protocol.js';`

`src/tavern/converter.js:697` 的 `moraleType: text(p.moraleType) || 'standard'`，改为：

```js
moraleType: (() => {
  const declared = text(p.moraleType);
  if (!declared) return 'standard';
  if (!Object.hasOwn(MORALE, declared)) {
    sink.push(`战意类型「${declared}」未知，已按 standard 处理（可用：${Object.keys(MORALE).join('/')}）`);
    return 'standard';
  }
  return declared;
})(),
```

（converter 需要 import `MORALE`；`sink` 在该作用域已可用。）

### P1 机制效果（需要先拍板，见 §7）

#### P1-1 战意状态的实际效果

推荐做法：**不把数值硬编码进引擎**，而是新增两条内置状态，由 `moraleCheck` 触发时 `grantStatus`。这样数值可以被 `custom_state` 覆盖，也能被 DSL 的 `selfStatusModifier` 读写。

`src/presets/status-defaults.js` 新增（数值待定，下列为起点）：

```js
shaken: def({ name: '战意动摇', category: 'debuff', description: '战意崩解边缘，无法全力应战',
  modifiers: { accuracy: -2, damageReduction: -0.1 }, maxStacks: 1, durationType: 'battle_turns', remainingTurns: 99 }),
routed: def({ name: '丧失战意', category: 'control', description: '只想脱离战斗，无法主动进攻',
  modifiers: { accuracy: -4, skip: true }, maxStacks: 1, durationType: 'battle_turns', remainingTurns: 99 }),
```

要点：
- 注册到内置表意味着 `docs/status.md` 的 26 条变成 28 条，AI 权重表也要补两行
- `skip: true` 会让 `moraleCheck` 之外的控制逻辑（`combat.js:471`）每轮跳过他——**这会直接让单位失去行动权**，是否符合「溃逃」语义需要确认；另一种做法是不给 `skip`，改为「每回合强制建议逃跑检定」
- 状态随战斗结束清除，`moraleState` 字段仍保留作为快速判定位

替代方案（不加状态）：在 `preview` / `hitOdds` 里读 `target.moraleState` 直接扣命中与闪避。缺点是把数值埋进引擎，与「DSL 接管底层」的方向相反。

#### P1-2 处决加成

规范 534 行。落点 `src/core/combat.js:868-873`：

```js
const guaranteeCrit = ...;
const guaranteeHit = ...;
const moraleBreak = ['shaken', 'routed'].includes(target?.moraleState);
const executionIntent = (context.intent ?? 'normal') === 'kill' || (context.intent ?? 'normal') === 'concept';
const execution = Boolean(target && moraleBreak && executionIntent && hasStrikeDamage(template));
const tierUp = hasStrikeDamage(template) && (hasNode('upgradeHitTier') || execution);
const dodge = cover || execution ? 0 : dsl.stat(...);   // 闪避修正无效
```

即：`dodge = 0` + `tierUp = true`（评级保底升到平暴击）。注意 `tierUp` 目前只由 `upgradeHitTier` 节点驱动，这里是**第二个来源**，要在返回值里能区分（建议加 `execution: true` 到 profile，UI 才能说明「处决加成」）。

### P2 通道与显示

#### P2-1 主角标记

`converter.js:697` 的 unit 字面量加 `protagonist: isProtagonist || undefined`（`isProtagonist` 在该函数作用域已有，见 `:596` 的参数与 `:698` 的判断）。
`validation.js:174` 的 `protocolUnitKeys` 加 `'protagonist'`，并在 `:209` 附近加 `checkOptional(v, 'protagonist', x => x === true)`。

#### P2-2 状态复位

若采纳「血量回到阈值以上则恢复」，在 `moraleCheck` 的开头加：

```js
if (unit.moraleState && unit.hp / unit.maxHp >= rule.threshold) {
  unit.moraleState = 'steady';
  record(state, unit, 'morale', `${unit.name}重振战意`, { targetId: unit.id, threshold: rule.threshold, outcome: 'steady', recovered: true });
  continue;
}
```

`moraleCheckedRound` 不必清空（同一轮内不重复判）。

#### P2-3 协议通道（让 AI 能声明战斗类型）

`src/tavern/descriptor.js:45-50` 目前要求 unit 行 `tail.length === 0`（`unit|id|team|source|名字|x,y,z` 六段，多一段就 fail）。改成允许 `键=值` 形式的尾巴：

```js
const tailOk = tail => tail.every(x => /^(?:战意|morale)=[a-z]+$/.test(x));
// ...
if (row !== 'unit' || !tailOk(tail) || !identifier.test(id ?? '') || ...) fail(...)
const moraleToken = tail.map(x => x.split('=')).find(([k]) => k === '战意' || k === 'morale')?.[1];
```

再把 `moraleType` 合进 participant（`converter.js` 的 participant 归一化处，与 `p.moraleType` 同一优先级）。可用值只允许 `MORALE` 的键；非法值回落 `standard` 并 warning。

写法示例：`unit|e1|red|char_info|石像鬼|7,2,0|战意=死斗`——**注意值必须是英文 key**（`deathmatch`），中译留给面板显示。

同时更新 `src/tavern/effect-protocol.js` 或 `prompts.js` 里的协议说明（若协议段落是自动生成的，改生成源而不是产物）。

#### P2-4 UI 显示

- `render.js` 的 `renderActor`（:225 附近）：在 `meta` 里加
  ```js
  if (u.moraleState && u.moraleState !== 'steady') meta.append(el('span', 'ft-chip', u.moraleState === 'shaken' ? '动摇' : '溃逃'));
  ```
- `render.js` 的 `renderUnitCard`：在 `stats` 的 kv 里加一行「战意」
- 若要配色，复用 `ft-chip`，不新增 CSS 文件 → **不需要重新生成 `src/ui/styles.js`**

---

## 5. 测试

写进 `tests/control_state_tests.mjs` 或新建 `tests/morale_tests.mjs`：

1. **阈值边界**：`hp/maxHp` 恰好等于阈值时不触发（`<` 严格小于）；略低时触发。
2. **三态判定**：`standard` + `d20=11` → `routed`；`d20=12` → `none`；`spar` 任意 d20 → `shaken`。**这条是 D1 的回归断言，必须写。**
3. **`none` 也写日志**（若采纳 P0-2 的写法）：`state.logs` 末尾有 `type === 'morale'` 且 `detail.outcome === 'none'`。
4. **主角不被判定**：带 `protagonist: true` 的单位血量跌破阈值，跑一轮后 `moraleState` 仍为 `undefined`。
5. **无检定档写日志**：`spar` 类型触发后 `state.logs` 里有 `morale` 事件（D2 回归）。
6. **RNG 不被无谓消耗**：同一 seed，两场相同战斗——一场全员满血、一场有人跌破阈值——记录 `state.rng` 的差值，前者变化必须为 0（D8 回归）。
7. **枚举校验**：`moraleType: '死斗'` → `assert.throws`；`moraleState: 'steady'` 通过，`'panic'` 抛错。
8. **处决加成**（若实现 P1-2）：目标 `moraleState='shaken'` + `intent='kill'` 的 preview，`dodge === 0` 且 `tierUp === true`；目标 `moraleState=undefined` 时两者为默认值。

---

## 6. 排除与验收

- **不改阈值表**：与规范逐项一致（40/30/50/10/30/35）。
- **不改 `living()`**，主角过滤在 `moraleCheck` 内做。
- **不引入新 DSL 节点**。
- **不改 CSS**，因此不需要重新生成 `src/ui/styles.js`。
- **旧快照兼容**：`morale` 日志的 `detail` 新增 `outcome` 字段，`narrate`/`battle_report` 用 `?? (shaken ? ...)` 兜底旧快照，不破坏已存战报重放。

```bash
npm test                    # 已知既有失败：char-snapshots 的 crypto is not defined（Node 18 的 node:test 子进程无全局 crypto），与本次无关
node.exe build.mjs
```

---

## 7. 需要拍板的决策点

实现前请确认，这些是规则语义而不是实现细节：

1. **需检定且通过（d20≥12）时，是「坚守（无状态）」还是「仍给动摇」？**
   规范只写了 d20<12 触发崩溃，没写通过之后的模样。当前 P0-1 按「坚守」实现（最贴字面）。若希望「通过检定也留一点惩罚」，把 `outcome` 改成 `'shaken'` 即可，但那等于规范外的加码。
2. **`routed` 是否给 `skip`（每轮失去行动）？**
   给 = 单位直接瘫痪，AI 不再控制它；不给 = 只是个标记，需要另做「强制逃跑检定」的机制。
3. **战意状态是否会在血量回升后复位？**（P2-2）
   复位的风险：治疗把濒死单位救回来就立刻洗掉崩溃，可能被当成免死金牌。
4. **是否新增两条内置状态？**（P1-1）
   会改动 `docs/status.md` 的 26 条内置表、AI 权重表、以及 `tests/custom_status_tests.mjs` 里对内置数量的断言（若有）。
5. **`<user>` 主动投降/认输/求饶**是叙事事件，引擎无法自行感知。要不要开一个命令通道（如 `set_unit_stat {moraleState:'shaken'}`）让 AI 声明？现在只有 UI 的命令面板能做。
