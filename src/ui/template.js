// Reusable DOM skeleton; kept as markup so hosts can inject it without a global document.
export const TEMPLATE = `<main id="output-container" class="game-layout">
    <header class="action-panel game-header">
      <div class="game-brand"><p class="eyebrow">◆　命定之诗 / 战术箱庭</p><h1 id="battle-title">命定之诗</h1><p id="scenario-preview" class="muted"></p></div>
      <div class="top-controls">
        <label>预设战局 <select id="scenario-select" class="axis-select"></select></label>
        <label>行动规则 <select id="mode-select"><option value="free">自由 2 AP</option><option value="split">1 动作 + 1 攻击</option></select></label>
        <label>面板配色 <select id="theme-select"><option value="amethyst">紫晶</option><option value="night-gold">夜金</option><option value="frost-silver">霜银</option></select></label>
        <label>随机种子 <input id="seed-input" type="number" min="0" max="4294967295" step="1" required></label>
        <button type="button" id="reset-button" class="game-button">重开</button>
      </div>
    </header>
    <div class="game-columns">
      <div class="battle-main">
        <section class="action-panel" aria-labelledby="board-title">
          <div class="panel-header-bar game-heading"><h2 class="panel-title" id="board-title">◇　10×10 战术平面图</h2><span id="round-badge" class="tag tag-round"></span><span id="ap-display" aria-label="行动力"></span></div>
          <div class="panel-content">
            <div id="battle-status" role="status" class="data-row"></div>
            <div id="turn-order" class="turn-order" aria-label="先攻序列"></div>
            <div class="battle-axis">
              <div class="axis-meta"><span class="axis-caption">站位与距离 · XYZ</span><span class="axis-bounds">X 0–9　Y 0–9</span></div>
              <div class="axis-toolbar" aria-label="单位测距">
                <label>测距起点<select class="axis-select" id="measure-origin"></select></label>
                <label>测距目标<select class="axis-select" id="measure-target"></select></label>
              </div>
              <div id="measure-readout" class="axis-readout" aria-live="polite"></div>
              <p id="board-instructions" class="axis-bounds">先点目标格，再选动作；点当前兵牌切换疾跑。<span id="sprint-indicator"></span></p>
              <p class="axis-scroll-hint">窄屏可左右滑动查看完整棋盘</p>
              <div class="axis-scroll" role="region" aria-label="战术棋盘，可横向滚动" tabindex="0">
                <div class="tactical-board-wrap">
                  <div class="tactical-y-rail" id="board-y" aria-hidden="true"></div>
                  <div class="tactical-grid" id="board" aria-label="10×10 棋盘"></div>
                  <div class="tactical-x-rail" id="board-x" aria-hidden="true"></div>
                </div>
              </div>
              <div class="tactical-legend">角标 = Z 高度（金高／灰平／蓝低） · 棕 C 掩体 · 紫 I 互动 · # 墙 · 坡 斜坡 · 红边 陡崖 · <b class="tx-good">绿 可达</b> · <b class="tx-info">蓝 普攻射程</b>（绿格蓝点＝可达且在射程） · <b class="tx-violet">紫 影响区</b></div>
              <div id="terrain-inspector" class="tactical-inspector"></div>
            </div>
          </div>
        </section>
      </div>
      <aside class="battle-sidebar" aria-label="战术控制与日志">
        <section class="action-panel" aria-labelledby="action-title">
          <div class="panel-header-bar game-heading"><h2 class="panel-title" id="action-title">✦　回合控制</h2></div>
          <div class="panel-content">
            <div class="control-row turn-controls">
              <button id="end-turn" type="button" class="game-button primary">结束回合</button>
              <button id="ai-step" type="button" class="game-button">敌方单步</button>
              <button id="undo-button" type="button" class="game-button">撤销</button>
              <button id="resource-button" type="button" class="game-button">原协议资源推演</button>
              <label><input id="auto-ai" type="checkbox" checked> 自动敌方</label>
              <label>速度 <select id="ai-speed"><option value="800">慢速</option><option value="350" selected>标准</option><option value="80">快速</option></select></label>
            </div>
            <p id="action-error" class="tx-bad" role="alert" hidden></p>
          </div>
        </section>
        <section class="action-panel" aria-labelledby="card-title">
          <div class="panel-header-bar game-heading"><h2 id="card-title" class="panel-title">◈　单位 / 场景情报</h2></div>
          <div id="unit-card" class="panel-content"></div>
          <details class="feature-register"><summary>掩体与互动点</summary><div id="feature-cards" class="panel-content"></div></details>
        </section>
        <section class="action-panel" aria-labelledby="logs-title">
          <div class="panel-header-bar game-heading"><h2 id="logs-title" class="panel-title">≡　战况日志</h2></div>
          <div id="combat-log" class="panel-content" aria-label="战况日志"></div>
          <div class="panel-content control-row export-controls">
            <button type="button" id="export-report" class="game-button" title="打开便于粘贴给 AI 的精简战报">导出战报</button>
            <button type="button" id="export-snapshot" class="game-button" title="保存整局 JSON，导入后原地继续">导出快照</button>
            <button type="button" id="export-persistent" class="game-button" title="保存装备计数与常驻状态，供下一关继承">导出跨战数据</button>
            <button type="button" id="import-button" class="game-button">导入 JSON</button>
            <button type="button" id="clear-persistent" class="game-button" hidden>清除下场继承</button>
            <input id="import-snapshot" type="file" accept=".json,application/json" hidden>
          </div>
        </section>
        <details id="api-sandbox" class="action-panel">
          <summary class="panel-header-bar game-heading"><span class="panel-title">⌘　预留 GameAPI 沙盒调试面板</span></summary>
          <div class="panel-content">
            <p class="muted">试算只显示差异，不修改战局。确认后才提交。</p>
            <div class="control-row sandbox-examples">
              <button type="button" class="game-button" data-example="counter">装备计数</button>
              <button type="button" class="game-button" data-example="status">施加状态</button>
              <button type="button" class="game-button" data-example="custom-status">自定义状态</button>
              <button type="button" class="game-button" data-example="terrain">地形修改</button>
            </div>
            <label for="sandbox-reason">试算理由</label> <input id="sandbox-reason" value="局内测试" maxlength="300">
            <label>提案说明 <input id="sandbox-reason" type="text" value="沙盒调试" maxlength="160"></label>
            <label class="editor-label" for="sandbox-editor">命令 JSON</label><textarea id="sandbox-editor" rows="8" spellcheck="false">[]</textarea>
            <div class="control-row">
              <button type="button" id="sandbox-preview" class="game-button">试算 Diff 预览</button>
              <button type="button" id="sandbox-commit" class="game-button primary" disabled>确认提交</button>
              <button type="button" id="sandbox-undo" class="game-button">撤销</button>
            </div>
            <pre id="sandbox-output" aria-live="polite"></pre>
          </div>
        </details>
      </aside>
    </div>
  </main>
  <section id="target-actions" class="action-panel battle-axis" aria-labelledby="target-title" hidden>
    <div class="control-row target-head"><strong id="target-title"></strong><button type="button" id="close-target" class="game-button" aria-label="关闭目标动作">×</button></div>
    <div class="control-row target-protocol-controls" aria-label="攻击协议参数">
      <label>意图 <select id="intent-select"><option value="normal">常规</option><option value="function">机能限制</option><option value="core">核心要害</option><option value="kill">抹杀</option><option value="concept">概念破碎</option></select></label>
      <label><input id="nonlethal-toggle" type="checkbox"> 非致死</label>
      <label>奖励骰 <select id="bonus-dice-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    </div>
    <div id="action-toolbar" class="control-row action-toolbar" aria-label="目标可用动作"></div>
    <button type="button" id="confirm-action" class="game-button primary" hidden>确认施放</button>
    <details id="target-preview"><summary>战术预览</summary><div id="tactical-preview" class="axis-readout" aria-label="战术预览" tabindex="0"></div></details>
  </section>
  <dialog id="report-dialog" class="action-panel" aria-labelledby="report-title">
    <h2 id="report-title" class="panel-title">精简战报</h2>
    <p class="muted">可直接粘贴给 AI 扩写；不会自动发送。</p>
    <textarea id="report-text" rows="13" readonly aria-label="战报文本"></textarea>
    <div class="control-row">
      <button type="button" id="copy-report" class="game-button primary">复制战报</button>
      <button type="button" id="download-report" class="game-button">下载 TXT</button>
      <form method="dialog"><button class="game-button">关闭</button></form>
    </div>
    <p id="report-message" role="status"></p>
  </dialog>
  <dialog id="resource-dialog" class="action-panel" aria-labelledby="resource-title">
    <h2 id="resource-title" class="panel-title">原协议 · 战前资源推演</h2>
    <p class="muted">默认填入所选棋子的五维，层级暂填一层。仅对账，不改当前战斗。</p>
    <textarea id="resource-input" rows="8" aria-label="原协议推演输入 JSON"></textarea>
    <div class="control-row"><button type="button" id="calculate-resources" class="game-button primary">计算</button><form method="dialog"><button class="game-button">关闭</button></form></div>
    <pre id="resource-output" aria-live="polite"></pre>
  </dialog>`;
