# 任务：实现第 1 步「小游戏层」——独立可玩的《命定之诗》回合制战棋小游戏（照搬原有战斗美化样式 + 完整玩法特效 + 预留 GameAPI）

## 0. 任务范围与核心原则
用户（ruaji）已拍板将整体项目拆分为三层推进：
1. **小游戏层（本次唯一实现目标）**
2. **接入层**（以后再接 TauriTavern / MVU / 世界书，本次**不实现**宿主耦合代码，仅预留干净的导入/导出快照边界）
3. **辅助 AI 层**（以后再接独立模型，本次**不实现** LLM 调用，只在小游戏里**预留完整、规范、带 `dryRun` 试算与撤销的 `GameAPI`**，并附带一个前端「API 沙盒测试面板」验证该接口）

**工程目录**：`F:\hermescache\hermes-workspace\roming\fated-tactical-game\`
**只读参考目录（严禁修改其中任何文件！）**：
- 前端视觉样式唯一基准：
  - `F:\hermescache\hermes-workspace\roming\combat\regex-[工坊]_更复杂与全面的战斗协议（多行动版）（适配v4_3_4）_-_战斗&生产制作美化（ruaji改版）.json`
  - 以及已解码的 r7 源码参考：`F:\hermescache\hermes-workspace\roming\combat-xyz\decoded_payload\ruaji_r7_part0.html`、`ruaji_r7_part1.html`
- 地形与箱庭参考：`F:\hermescache\hermes-workspace\roming\combat-xyz\terrain_auto_script.js`
- 规则灵感来源（不向后兼容旧包袱，取其好玩机制与精炼规则）：`F:\hermescache\hermes-workspace\roming\fated_combat_review_20261119\plan_review_report.md` 及 `roming/combat/命定之诗与黄昏之歌v4.3.json` 中的战斗玩法概念。
- **严禁修改** `roming/combat/`、`roming/combat-xyz/`、`F:\TauriTavern\`、`F:\SillyTavern\` 中的任何文件。

---

## 1. 前端视觉与交互要求（照搬原有战斗美化 regex！）
1. **必须先读透 `ruaji_r7_part0.html` / `ruaji_r7_part1.html`（及对应 regex JSON）**：
   - 完整继承其原有的配色体系、CSS 质感、面板结构、10×10 战术网格（含 Z 轴角标、地形格、`#` 墙、`坡`）、单位棋子卡（阵营区分、血/蓝/体条、朝向箭头、状态徽章）、掩体 `C1..C4` 卡（材质/HP/遮蔽/坍塌）、互动点 `I1..I4` 卡（可用/已消耗）、测距与战况日志面板。
   - **升级为可玩战棋**：把原来纯展示的静态面板改造成真正的鼠标交互战棋：
     - 选中己方棋子：棋盘实时高亮可达移动格（区分普通步与坡道/高台限制，标注阻挡/AP消耗）、不可通行墙体/陡崖边缘。
     - 选中普通攻击或技能：高亮射程范围；鼠标悬停目标格/敌方棋子时，显示清晰的战术预览（距离 `dXYZ`、高差修正、掩体遮蔽、命中概率/预期掷骰、AOE 覆盖格高亮、预计伤害区间、会触发的武器特效/计数状态）。
     - 点击执行：即时结算掷骰并更新棋盘、飘字/高亮反馈、记录可展开核对的详细公式日志。
     - 支持预设关卡选择（至少 3 个可直接开打的丰富测试战局：如「废墟伏击战」「高台祭坛夺取战」「BOSS 与杂兵混编战」）+ 开局前简单预览/重开 + 战斗结束导出战报/持久化状态快照 JSON。

---

## 2. 玩法、特效、Buff & Debuff、装备计数器设计（核心爽点）
遵循干净、确定性、可审计的工程原则（拒绝屎山、拒绝 `eval`）：

1. **行动与回合制核心**：
   - 每回合单位拥有 **2 点行动力（2 AP）**（支持移动 1 AP、普通攻击 1 AP、轻技能 1 AP、重技能/全蓄力/疾跑 2 AP、依托掩体/装填/场景互动 1 AP；清晰展示剩余 AP 晶石，支持切换「自由 2AP」或「1动作+1攻击」约束）。
   - 先攻队列：基于敏捷 + 确定性 RNG 掷骰排定行动顺序；支持单步、全自动敌方回合（本地战术 AI 会找高台、借掩体、避障碍、走位攻击与放技能）与动画调速。
   - 事务级撤销（Undo）与可复现导出/恢复快照（序列化命令日志 + RNG 状态 + 当前棋盘/单位/装备实例状态，刷新不丢、同命令同结果）。

2. **D&D 风格掷骰与数值结算**：
   - 确定性可注入种子 RNG（`d20` 命中检定、优势 `2d20取高` / 劣势 `2d20取低` / 奖惩骰抵消、暴击判定、豁免/对抗检定、伤害骰 `NdM + 属性加成`、护甲减免与伤害类型：`physical / energy / mental / true`）。
   - 兼顾 Z 轴高差命中/射程修正、夹击修正、掩体减命中与可破坏掩体 HP 坍塌机制、大型单位/体型修正。

3. **完整的 Buff / Debuff 与持续机制**：
   - 标准状态模型：`id`, `name`, `category` (`buff` | `debuff` | `control` | `dot` | `hot` | `shield`), `stackRule` (`refresh` | `stack` | `replace`), `stacks`, `maxStacks`, `durationType` (`battle_turns` | `until_removed` | `persistent`), `remainingTurns`, `tickTiming` (`onTurnStart` | `onTurnEnd`), `modifiers`, `sourceUnitId`。
   - 实装全套常见效果并配齐图标/徽章与悬停说明：
     - **DoT / HoT**：`灼烧`（回合初火伤）、`流血`（行动或回合末真实/物理伤，可叠层）、`中毒`、`再生`
     - **护盾与防御**：`护盾`（独立吸收池，破盾触发事件）、`坚壁/减伤`、`嘲讽`、`援护/护卫`（替相邻队友承伤）、`反伤棘甲`
     - **控制与战术**：`眩晕`（跳过行动）、`冰冻`（跳过且受打击碎冰加伤）、`定身/束缚`（禁移动可施法）、`致盲`（攻击带劣势骰）、`易伤`、`破甲`、`标记/弱点识别`、`隐身`、`疾走`（移动+1格）
   - 明确支持 **跨战持久化标记（`persistent`）**：战斗结束后导出 `persistentSnapshot`，下一场开战导入时常驻 Buff/Debuff 与装备实例计数自动延续！

4. **参数化装备 / 武器 / 防具特效与实例级动态计数器（重点！）**：
   - **实例与模板分离**：武器/防具效果规则写在模板里，而运行时计数（例如 `souls: 3`、`ammo: 6`）严格绑定在**装备实例 `instanceId`** 上！两把同名武器绝不串数、换人装备不丢计数、修改模板参数不把现有实例计数清零。
   - 必须实装多种好玩且机制各异的内置武器/防具/道具与技能样本（供测试开局选用与 API 验证）：
     1. **噬魂太刀（实例计数器增伤）**：模板 `kill_charge_weapon`（`counterKey: 'souls'`, `bonusPerStack: 0.50`, `maxStacks: 10`）。只有**用该刀直接击杀**敌人时 `souls + 1`（跨战持久）；攻击时按当前层数提供 `+50% × souls` 增伤；界面清晰展示该刀当前魂数与增伤倍率。
     2. **霜纹荆棘重甲（受击反伤 + 施加状态）**：受近战攻击时对攻击者反弹伤害并有概率施加 `[寒冷]` 减速/降命中。
     3. **双生血牙匕首（暴击/背击流血 + 额外连击）**：从敌方背后或侧面攻击获优势/背刺增伤，命中挂 `[流血]` 叠层。
     4. **猎魔左轮 / 破甲重弩（弹药实例计数 + 装填动作 + 穿甲）**：消耗 `ammo` 实例计数、无视部分护甲、高台额外射程/命中；空弹需花 1 AP 装填。
     5. **圣咏庇护徽记（光环/治疗增强 + 护盾）**：施放治疗时额外附加等比 `[护盾]`。
     6. 丰富技能库：单体爆发、圆形/扇形/锥形/直线 AOE（受 `#` 墙体视线阻断）、击退位移（撞墙额外伤害 + 晕眩）、瞬移背刺、团队护盾治疗、净化驱散、场景交互引爆桶/祭坛增益。

---

## 3. 预留给第 2 层（接入层）与第 3 层（辅助 AI 层）的干净 API 设计
在小游戏内部抽出一层纯正、文档清晰、可独立 import 的控制门面 `src/api/game_api.js`（并导出到 `window.FatedTacticalGame`）：
1. **接入层边界（Layer 2 预留）**：
   - `GameAPI.createBattle(scenarioOrImportSnapshot)`
   - `GameAPI.exportBattleSnapshot()` / `GameAPI.restoreBattleSnapshot(snapshot)`
   - `GameAPI.exportPersistentCarryOver()`（导出战后常驻状态与全部装备实例计数器）
   - `GameAPI.exportBattleReport()`（结构化回合明细 + 战后汇总文本）
2. **辅助 AI 操作接口（Layer 3 预留）**：
   - **只读查询接口**（专为低 token 投喂设计）：`getStateSummary()`, `listUnits()`, `inspectUnit(unitId)`, `listActionLogs(limit)`
   - **白名单受控变更接口**：`proposeCommands(commands, { baseRevision, reason })`（纯试算 `dryRun`，返回校验结果 + 真实 state diff 预览，**不修改原状态**）和 `commitProposal(proposalId)` / `undoLastCommit()`。
   - 白名单命令集必须严格校验（拒绝空对象、拒绝缺字段/越界数值、拒绝非法状态 ID）：
     - `set_unit_stat`（调整 HP/MP/SP/五维/AP/坐标/阵营）
     - `upsert_status` / `remove_status`（挂/改/删标准 Buff/Debuff）
     - `adjust_item_counter`（按装备实例 `instanceId` 增减/设定如 `souls`/`ammo` 等计数器）
     - `patch_equipment_template` / `patch_skill_template`（热改参数化特效或数值，保留实例计数不归零）
     - `spawn_unit` / `remove_unit`（战场增援/撤离）
     - `set_terrain_cell` / `set_interactive_status`（改变地形格/高程/掩体HP/互动点状态）
     - `replay_or_undo`（回退一步操作）
   - 在 UI 右侧做一个可折叠的 **「🔌 预留 GameAPI 沙盒调试面板」**：内置几个快捷测试指令按钮 + JSON 编辑器，支持点击「试算 Diff 预览」→「确认提交」→「撤销」，用来肉眼直接验证第 3 层所需的全部 API 操作！

---

## 4. 工程结构、实测与验收标准
建议目录组织清晰简洁（ES Modules，无多余打包依赖，可直接静态服务器打开 `index.html` 玩，也支持 Node 直接跑 `core/` 测试）：
```text
F:\hermescache\hermes-workspace\roming\fated-tactical-game\
├── index.html                  # 小游戏主入口（照搬原战斗美化样式的独立可玩版）
├── styles/
│   └── battle-theme.css        # 提取自 combat-xyz r7 / 美化正则的纯正视觉样式 + 交互态增强
├── src/
│   ├── core/                   # 纯 JS 无 DOM 确定性内核（RNG、公式、2AP、状态机、Buff/Debuff、装备计数器钩子、地形、AOE/LOS、AI、Undo）
│   ├── presets/                # 预设剧本、英雄/敌人/武器/防具/技能标准样本库
│   ├── api/                    # 预留给接入层与辅助 AI 层的 GameAPI（含严格 Schema 校验与 dryRun diff）
│   └── ui/                     # 棋盘渲染、象棋交互高亮、悬停战术预览、行动栏、单位/状态/日志面板、API 沙盒调试抽屉
├── tests/
│   ├── unit_tests.mjs          # Node.js 全量核心逻辑与 GameAPI 单测
│   └── e2e_chrome.mjs          # 真实 Chrome Headless + CDP 对战与交互测试
└── README.md                   # 玩法说明、三层接口文档与测试验收报告
```

**必须亲自执行并全部通过的验证**：
1. `node tests/unit_tests.mjs`：覆盖 2 AP 移动/攻击/技能、d20 优劣势/奖惩骰、各种 Buff/Debuff（DoT/HoT/护盾/眩晕/冰冻/嘲讽/援护/反伤/叠层）、噬魂太刀实例计数器防串线 + 跨战持久化导入导出、掩体坍塌、AOE 墙体阻断、Undo 事务回滚、GameAPI 校验拒绝畸形命令 + `dryRun` diff + `commit` + `undo`。
2. `node tests/e2e_chrome.mjs`：启动本地静态 HTTP 服务加载 `index.html`，用 `C:/Program Files/Google/Chrome/Application/chrome.exe` 无头模式 + CDP 实测：
   - 验证页面样式布局与关键元素尺寸无重叠溢出（保留原有美化正则的棋盘、掩体卡、互动卡、单位卡结构）；
   - 实际点击选取预设战局 → 点选己方兵牌验证可达格高亮 → 移动 → 放技能挂 Buff/Debuff / 触发掩体或地形交互 → 用噬魂太刀击杀敌人并验证魂数 +1 → 触发敌方 AI 回合 → 打开预留 API 沙盒发送一条 `adjust_item_counter` 或 `upsert_status` 命令先试算 Diff 预览再应用并撤销 → 验证快照导出与恢复 → 确认全程 **0 `pageerror`、0 `console.error`**！
3. 最后写清楚 `README.md` 并向我汇报核心玩法清单、照搬并升级的美化样式要点、预留 `GameAPI` 契约以及全部真实测试输出。
