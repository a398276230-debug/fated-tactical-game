// 全屏战旗：棋盘铺满舞台，其余面板以右侧抽屉拉出。
// 带 id 的节点被 main.js / 测试引用，改名前先全局搜索。
export const TEMPLATE = `<div class="ft-app" data-busy="false">
  <section class="ft-stage" aria-label="战场">
    <div class="axis-scroll ft-scroll" id="board-scroll">
      <div class="ft-board battle-axis" id="board-frame">
        <div class="tactical-grid ft-grid" id="board" aria-label="战旗棋盘"></div>
        <div class="ft-tokens" id="board-tokens" aria-hidden="true"></div>
        <div class="ft-fx" id="board-fx" aria-hidden="true"></div>
      </div>
    </div>

    <header class="ft-hud-top">
      <div class="ft-hud-title">
        <span class="ft-eyebrow">◆ 命定之诗</span>
        <strong id="battle-title" class="ft-title"></strong>
        <span id="round-badge" class="ft-round"></span>
      </div>
      <div id="turn-order" class="ft-initiative" aria-label="先攻序列"></div>
      <nav class="ft-hud-menu" aria-label="面板">
        <button type="button" class="ft-icon-button" data-open-drawer="log" aria-label="战况日志" title="战况日志">📜<span id="log-unread" class="ft-dot" hidden></span></button>
        <button type="button" class="ft-icon-button" data-open-drawer="unit" aria-label="单位情报" title="单位情报">◈</button>
        <button type="button" class="ft-icon-button" data-open-drawer="tools" aria-label="工具" title="工具">⚒</button>
        <button type="button" class="ft-icon-button" data-open-drawer="settings" aria-label="战局设置" title="战局设置">⚙</button>
      </nav>
    </header>

    <p id="terrain-inspector" class="ft-inspector" aria-live="polite"></p>

    <div class="ft-overlay" aria-live="polite">
      <div id="turn-banner" class="ft-banner" hidden></div>
      <div id="action-ribbon" class="ft-ribbon" hidden></div>
      <div id="dice-stage" class="ft-dice-stage"></div>
      <ol id="caption" class="ft-caption"></ol>
    </div>
    <button type="button" id="skip-playback" class="ft-skip" hidden>跳过动画 ▸▸</button>

    <footer class="ft-dock">
      <div id="actor-card" class="ft-actor"></div>
      <div class="ft-dock-actions">
        <p id="battle-status" class="ft-status" role="status"></p>
        <p id="sprint-indicator" class="ft-hint"></p>
        <p id="action-error" class="ft-error" role="alert" hidden></p>
        <div class="ft-row">
          <button id="end-turn" type="button" class="game-button primary">结束回合</button>
          <button id="undo-button" type="button" class="game-button">撤销</button>
          <button id="ai-step" type="button" class="game-button">敌方单步</button>
          <label class="ft-switch"><input id="auto-ai" type="checkbox" checked> 自动敌方</label>
          <label class="ft-mini-select">间隔 <select id="ai-speed"><option value="800">慢</option><option value="350" selected>标准</option><option value="80">快</option></select></label>
        </div>
      </div>
    </footer>
  </section>

  <section id="target-actions" class="ft-target-card" aria-labelledby="target-title" hidden>
    <div class="ft-target-head">
      <strong id="target-title"></strong>
      <button type="button" id="close-target" class="ft-close" aria-label="关闭">×</button>
    </div>
    <div id="target-options" class="ft-target-options" hidden>
      <label>意图 <select id="intent-select"><option value="normal">常规</option><option value="function">机能限制</option><option value="core">核心要害</option><option value="kill">抹杀</option><option value="concept">概念破碎</option></select></label>
      <label><input id="nonlethal-toggle" type="checkbox"> 非致死</label>
      <label>奖励骰 <select id="bonus-dice-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    </div>
    <div id="action-toolbar" class="ft-actions" aria-label="可用动作"></div>
    <div id="tactical-preview" class="ft-preview" aria-label="战术预览" tabindex="0"></div>
    <button type="button" id="confirm-action" class="game-button primary ft-confirm" hidden>确认</button>
  </section>

  <div class="ft-scrim" id="drawer-scrim" hidden></div>

  <aside class="ft-drawer" data-drawer="log" aria-label="战况日志" hidden>
    <header class="ft-drawer-head"><h2>📜 战况日志</h2><button type="button" class="ft-close" data-close-drawer aria-label="关闭">×</button></header>
    <div id="combat-log" class="ft-log"></div>
  </aside>

  <aside class="ft-drawer" data-drawer="unit" aria-label="单位情报" hidden>
    <header class="ft-drawer-head"><h2>◈ 单位情报</h2><button type="button" class="ft-close" data-close-drawer aria-label="关闭">×</button></header>
    <div id="unit-card" class="ft-unit-card"></div>
    <h3 class="ft-section">掩体与互动点</h3>
    <div id="feature-cards" class="ft-features"></div>
  </aside>

  <aside class="ft-drawer" data-drawer="settings" aria-label="战局设置" hidden>
    <header class="ft-drawer-head"><h2>⚙ 战局设置</h2><button type="button" class="ft-close" data-close-drawer aria-label="关闭">×</button></header>
    <div class="ft-form">
      <label data-scenario-only>预设战局 <select id="scenario-select"></select></label>
      <p id="scenario-preview" class="muted"></p>
      <label>行动规则 <select id="mode-select"><option value="free">自由 2 AP</option><option value="split">1 动作 + 1 攻击</option></select></label>
      <label>随机种子 <input id="seed-input" type="number" min="0" max="4294967295" step="1" required></label>
      <div class="ft-row">
        <button type="button" id="reset-button" class="game-button primary">重开战局</button>
        <button type="button" id="clear-persistent" class="game-button" hidden>清除跨战数据</button>
      </div>
      <h3 class="ft-section">显示</h3>
      <label>动画速度 <select id="anim-speed"><option value="1.6">慢（看清每一步）</option><option value="1" selected>标准</option><option value="0.5">快</option><option value="0">关闭</option></select></label>
      <label>面板配色 <select id="theme-select"><option value="amethyst">紫晶</option><option value="night-gold">夜金</option><option value="frost-silver">霜银</option></select></label>
    </div>
  </aside>

  <aside class="ft-drawer" data-drawer="tools" aria-label="工具" hidden>
    <header class="ft-drawer-head"><h2>⚒ 工具</h2><button type="button" class="ft-close" data-close-drawer aria-label="关闭">×</button></header>
    <div class="ft-form">
      <h3 class="ft-section">战报与存档</h3>
      <div class="ft-row">
        <button type="button" id="export-report" class="game-button primary">导出战报</button>
        <button type="button" id="export-snapshot" class="game-button">下载快照</button>
        <button type="button" id="export-persistent" class="game-button">下载跨战数据</button>
        <button type="button" id="import-button" class="game-button">导入存档</button>
        <input id="import-snapshot" type="file" accept=".json,application/json" hidden>
      </div>
      <h3 class="ft-section">测距</h3>
      <div class="ft-row">
        <label>起点 <select id="measure-origin"></select></label>
        <label>目标 <select id="measure-target"></select></label>
      </div>
      <p id="measure-readout" class="ft-readout" aria-live="polite"></p>
      <h3 class="ft-section">推演</h3>
      <button type="button" id="resource-button" class="game-button">战前资源推演</button>
      <details id="api-sandbox" class="ft-dev">
        <summary>开发者沙盒（GameAPI 命令）</summary>
        <p class="muted">先试算，只显示会改变什么；确认后才写入战局。</p>
        <div class="ft-row">
          <button type="button" class="game-button" data-example="counter">装备计数 +1</button>
          <button type="button" class="game-button" data-example="status">施加疾走</button>
          <button type="button" class="game-button" data-example="custom-status">自定义状态</button>
          <button type="button" class="game-button" data-example="terrain">改地形</button>
        </div>
        <label>说明 <input id="sandbox-reason" type="text" value="沙盒调试" maxlength="160"></label>
        <label>命令 <textarea id="sandbox-editor" rows="7" spellcheck="false">[]</textarea></label>
        <div class="ft-row">
          <button type="button" id="sandbox-preview" class="game-button">试算</button>
          <button type="button" id="sandbox-commit" class="game-button primary" disabled>确认提交</button>
          <button type="button" id="sandbox-undo" class="game-button">撤销</button>
        </div>
        <div id="sandbox-output" class="ft-readout" aria-live="polite"></div>
      </details>
    </div>
  </aside>

  <dialog id="report-dialog" class="ft-dialog" aria-labelledby="report-title">
    <h2 id="report-title">精简战报</h2>
    <p class="muted">可直接粘贴给 AI 扩写；不会自动发送。</p>
    <textarea id="report-text" rows="13" readonly aria-label="战报文本"></textarea>
    <div class="ft-row">
      <button type="button" id="copy-report" class="game-button primary">复制战报</button>
      <button type="button" id="download-report" class="game-button">下载 TXT</button>
      <form method="dialog"><button class="game-button">关闭</button></form>
    </div>
    <p id="report-message" role="status"></p>
  </dialog>

  <dialog id="resource-dialog" class="ft-dialog" aria-labelledby="resource-title">
    <h2 id="resource-title">战前资源推演</h2>
    <p class="muted">默认填入所选单位的五维，层级暂填一层。只做计算，不改当前战斗。</p>
    <textarea id="resource-input" rows="8" aria-label="推演输入"></textarea>
    <div class="ft-row">
      <button type="button" id="calculate-resources" class="game-button primary">计算</button>
      <form method="dialog"><button class="game-button">关闭</button></form>
    </div>
    <div id="resource-output" class="ft-readout" aria-live="polite"></div>
  </dialog>
</div>`;
