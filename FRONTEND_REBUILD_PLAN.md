# 战旗前端重建计划

## 目标
将当前开发者向的战旗前端重建为玩家向的游戏界面：
- **全屏地图**：战旗地图占满屏幕主区域
- **抽屉式面板**：日志、控制、单位信息等用抽屉样式拉出
- **动画反馈**：移动、攻击、AI 行动必须有动画，玩家能跟上发生了什么
- **人话翻译**：投骰、检定、计算全部转换成人能看懂的文本，不显示原始 JSON

## 原有架构分析

### 文件结构
```
index.html              独立前端入口（<script src="./src/ui/standalone.js">）
src/ui/
  standalone.js         自动挂载到 document.body，创建 game API
  mount.js             可编程挂载接口，返回 { api, unmount, ... }
  main.js              核心 UI 逻辑（417 行）：事件绑定、状态更新、动作预览
  template.js          DOM 骨架（HTML 字符串）
  render.js            渲染器（460 行）：棋盘、单位、日志、预览面板
  target_card.js       浮动目标动作卡片定位逻辑
  styles.js            导出 battleTheme 和 tacticalUI 两个 CSS 字符串
styles/
  battle-theme.css     主题变量与配色（46KB，三套主题）
  tactical-ui.css      布局与交互样式（11KB）
```

### 当前布局
- **`.game-columns`** 两栏布局（1.65fr / 1fr）
  - **左侧** `.battle-main`：棋盘 + 测距工具
  - **右侧** `.battle-sidebar`：回合控制、单位卡片、日志、沙盒面板
- **顶部** `.game-header`：场景选择、种子、主题、重开按钮
- **浮动** `#target-actions`：点击格子后弹出的动作菜单（`position: fixed`）

### 核心渲染流程
1. `main.js#initializeUI()` 创建控制器，绑定所有事件监听
2. `render.js#createRenderer()` 返回 `{ render, feedback }` 两个方法
3. `render(state, ui)` 更新整个界面（棋盘格、先攻序列、卡片、日志）
4. `feedback(before, after)` 播放格子动画（±HP、移动、状态变化）

### 战斗日志结构
所有战斗事件存在 `state.logs`，每条 log 包含：
```js
{ round, type, text, detail, actorId?, targetId? }
```
**type 枚举**（从 combat.js 摸排）：
- `roll`（攻击检定）、`damage`、`heal`、`defeat`
- `move`、`teleport`、`flee`、`opportunity`
- `status_gain`、`status_lose`、`status_tick`
- `cover_break`、`interactive_trigger`
- `outcome`（战斗结束）

**detail 字段**常见内容（需转译成人话的部分）：
- `roll`: `{dice, selected, total, accuracy, defense, advantage, hit, critical, targetId}`
- `damage`: `{raw, final, reduction, shatter, targetId, lethal, overkill}`
- `status_gain`: `{statusId, stacks, durationType, source}`
- `move`: `{from, to, steps, teleport}`

### 色彩风格
三套主题（`data-dlc-theme`）：
- `amethyst`（默认）：紫晶金 `--gold:#dfc080` `--accent-rgb:176,142,92`
- `night-gold`：夜金蓝 `--gold:#c9a463` `--accent-rgb:185,149,89`
- `frost-silver`：霜银 `--gold:#b4c3d3` `--accent-rgb:150,166,184`

**关键色彩变量**：
- `--gold-*`：金色强调（标题、选中、按钮）
- `--blue-line/text`：蓝方单位边框与文字
- `--red-line/text`：红方单位边框与文字
- `--line*`：面板分隔线（`rgb(var(--accent-rgb) / .13~.46)`）
- `--panel-bg/border`：渐变背景与描边

---

## 新架构设计

### 布局策略
```
┌─────────────────────────────────────┐
│  [最小化标题栏]  种子 12  ruins  ⚙  │ ← 顶部极简控制条（theme/重开）
├─────────────────────────────────────┤
│                                     │
│                                     │
│          战旗地图（全屏填满）          │ ← `.battle-canvas`（绝对定位层叠）
│                                     │
│                                     │
│                                     │
│  [📜日志] [📋控制] [🎯单位] [⚙沙盒]    │ ← 底部抽屉触发器（固定底边）
└─────────────────────────────────────┘
```

**抽屉行为**：
- 默认全部收起，地图占满
- 点击触发器（如「📜日志」）：从底部滑出半屏抽屉，覆盖地图下半部分
- 再次点击或点击地图区域：抽屉滑回收起
- 同一时间只显示一个抽屉（切换时旧抽屉滑出，新抽屉滑入）

### 动画需求

#### 1. 移动动画
- 单位棋子从起点格平滑移动到终点格（CSS `translate` + `transition`）
- 路径中途格子逐个高亮（`path.length > 2` 时显示轨迹动画）
- 时长：每格 120ms，最多 500ms

#### 2. 攻击动画
- 攻击方棋子短暂前冲（`translateY(-8px)` + 回弹）
- 受击方棋子闪烁红光边框（`box-shadow` + `animation`）
- HP 变化数字从格子飞出（已有 `feedback()` 基础，增强缓动曲线）
- 时长：300ms

#### 3. 状态变化动画
- 获得 buff/debuff：格子周围光环扩散（`@keyframes ripple`）
- 失去状态：图标淡出（`opacity 1→0`）

#### 4. AI 行动速度控制
- 新增全局动画队列：每个 AI 行动（移动/攻击）入队
- 队列按序播放，每个动画播完才执行下一个
- `#ai-speed` 选项改为控制动画速度倍率（0.5x / 1x / 2x）
- 用户可中途点击「暂停 AI」打断队列

#### 5. 战斗日志实时翻译
**不再直接显示 `log.text`**，而是根据 `log.type + log.detail` 动态生成人话：

```js
// 示例翻译函数
function translateLog(log) {
  switch (log.type) {
    case 'roll':
      const { dice, selected, total, defense, hit, critical } = log.detail;
      const diceStr = dice.map((d, i) => selected.includes(i) ? `[${d}]` : d).join(' ');
      return `${unitName(log.actorId)} 对 ${unitName(log.detail.targetId)} 投骰 ${diceStr}，合计 ${total}（防御 ${defense}）→ ${critical ? '💥暴击' : hit ? '✓命中' : '✗未中'}`;
    
    case 'damage':
      const { raw, final, reduction, shatter } = log.detail;
      let parts = [`受到 ${final} 点伤害`];
      if (reduction) parts.push(`（减伤 ${(reduction*100).toFixed(0)}%）`);
      if (shatter) parts.push(`（破冰额外 ${(shatter*100).toFixed(0)}%）`);
      return `${unitName(log.detail.targetId)} ${parts.join('')}`;
    
    // ... 其他类型
  }
}
```

### 技术实现路径

#### 阶段一：布局重构（保持功能不变）
1. 修改 `template.js`：
   - 移除 `.game-columns` 双栏布局
   - 增加 `.battle-canvas`（全屏定位容器）
   - 底部增加 `.drawer-triggers`（四个抽屉按钮）
   - 四个抽屉面板 `.drawer-panel[data-drawer="log|control|unit|sandbox"]`

2. 修改 `tactical-ui.css`：
   - `.battle-canvas { position: relative; height: calc(100vh - 80px); }`
   - `.drawer-panel { position: fixed; bottom: 0; height: 50vh; transform: translateY(100%); transition: transform 0.3s ease; }`
   - `.drawer-panel.open { transform: translateY(0); }`

3. 修改 `main.js`：
   - 增加抽屉状态管理 `openDrawer(name)`、`closeDrawer()`
   - 绑定抽屉触发器点击事件

#### 阶段二：动画系统
1. 创建 `src/ui/animations.js`：
   ```js
   export class AnimationQueue {
     constructor() { this.queue = []; this.playing = false; }
     enqueue(fn) { this.queue.push(fn); if (!this.playing) this.play(); }
     async play() { /* 依次执行 queue */ }
     clear() { this.queue = []; this.playing = false; }
   }
   
   export function animateMove(cellFrom, cellTo, duration) { /* CSS transition */ }
   export function animateAttack(cell) { /* 前冲 + 回弹 */ }
   export function animateDamage(cell, value) { /* 数字飞出 */ }
   ```

2. 修改 `main.js`：
   - 引入 `AnimationQueue`
   - `game.subscribe()` 回调中：对比 `before`/`after` logs，检测新增事件
   - 每个新事件转换为动画任务入队（而非立即 `render()`）

#### 阶段三：日志翻译
1. 创建 `src/ui/log_translator.js`：
   - `translateLog(log, state)` 函数，返回富文本 HTML
   - 支持点击单位名跳转到对应格子

2. 修改 `render.js#renderLogs()`：
   - 调用 `translateLog()` 生成人话，替换原 `log.text`
   - detail 原始 JSON 放在 `<details>` 折叠块（开发者模式）

---

## 实施计划

**步骤 1**（当前）：备份完成 ✓  
**步骤 2**：阶段一布局重构（~2h）  
**步骤 3**：阶段二动画系统（~3h）  
**步骤 4**：阶段三日志翻译（~2h）  
**步骤 5**：端到端测试与调优（~1h）

**验收标准**：
- [ ] 战旗地图默认占满屏幕
- [ ] 四个抽屉可独立打开/关闭
- [ ] 玩家移动有平滑动画
- [ ] 攻击有打击感反馈
- [ ] AI 自动战斗时，每步动作可见（不闪现）
- [ ] 战斗日志显示人话而非 JSON
- [ ] 保持原有三套主题配色
- [ ] 所有现有测试通过（`npm test` / `npm run test:e2e`）
