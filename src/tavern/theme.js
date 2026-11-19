export const tavernTheme = `
:where([data-fated-tavern-overlay], .fated-battle-entry) {
  --base:#0b1120; --raised:#0f172a; --card:#131c2e; --hover:#18243a;
  --line:#2c3d58; --ink:#e5edf8; --muted:#a7b8cf; --gold:#d4af37; --sky:#38bdf8;
  color-scheme:dark; color:var(--ink); text-align:start;
  font:14px/1.55 'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;
}
[data-fated-tavern-overlay] { position:fixed; z-index:2147483000; pointer-events:none }
[data-fated-tavern-overlay] *, .fated-battle-entry { box-sizing:border-box }
[data-fated-tavern-overlay] [hidden] { display:none !important }
[data-fated-tavern-overlay] button:not([data-sandbox-mount] *), .fated-battle-entry button {
  cursor:pointer; min-height:34px; padding:6px 12px; background:var(--card);
  border:1px solid var(--line); border-radius:8px; color:var(--ink); font:inherit;
}
[data-fated-tavern-overlay] button:not([data-sandbox-mount] *):hover, .fated-battle-entry button:hover { background:var(--hover); border-color:var(--sky) }
[data-fated-tavern-overlay] :focus-visible, .fated-battle-entry :focus-visible { outline:2px solid var(--sky); outline-offset:2px }
[data-fated-tavern-overlay] .fated-tavern-launcher {
  position:fixed; right:18px; bottom:18px; width:52px; height:52px;
  border-radius:50%; border-color:var(--gold); font-size:22px;
  box-shadow:0 8px 24px #020611aa; pointer-events:auto;
}
.fated-tavern-panel {
  position:fixed; right:16px; bottom:16px; width:min(1100px,calc(100vw - 32px));
  height:min(820px,calc(100dvh - 32px)); display:flex; flex-direction:column;
  border:1px solid var(--line); border-radius:16px; background:var(--base);
  box-shadow:0 18px 54px #020611b0; pointer-events:auto; overflow:hidden;
}
.fated-tavern-header {
  display:flex; align-items:center; padding:11px 18px; gap:8px; cursor:move;
  touch-action:none; user-select:none; background:linear-gradient(105deg,var(--hover),var(--raised) 75%);
  border-bottom:1px solid var(--line);
}
.fated-tavern-header strong { flex:1; color:var(--gold); font-size:1.08rem; letter-spacing:.035em }
.fated-tavern-tabs,.fated-tavern-subtabs { display:flex; flex-wrap:wrap; gap:6px; padding:8px 14px; border-bottom:1px solid var(--line); background:var(--raised) }
.fated-tavern-subtabs { margin-bottom:14px; border:1px solid var(--line); border-radius:12px }
[data-fated-tavern-overlay] :is(.fated-tavern-tabs,.fated-tavern-subtabs) button { border-radius:999px; border-color:transparent; color:var(--muted); background:transparent }
[data-fated-tavern-overlay] :is(.fated-tavern-tabs,.fated-tavern-subtabs) button[aria-selected=true] { background:#132a43; border-color:#276184; color:#a6e3ff }
.fated-tavern-content { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:clamp(10px,2vw,20px); scrollbar-color:#465c7d var(--base); scrollbar-width:thin }
.fated-tab { display:none }.fated-tab.active { display:block }
.fated-tab > h3 { margin:0 0 12px; color:var(--ink); font-size:1.1rem }
.fated-tavern-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr)); gap:12px }
.fated-tavern-grid > .fated-status { grid-column:1/-1 }
:is(.fated-tavern-grid,.fated-prompt) label { display:grid; color:var(--muted); gap:5px }
.fated-tavern-grid label:has(input[type=checkbox]) { display:flex; align-items:center }
[data-fated-tavern-overlay] :is(input:not([type=checkbox]),textarea,select):not([data-sandbox-mount] *) {
  width:100%; min-width:0; min-height:36px; padding:7px 10px; background:var(--base);
  border:1px solid #415471; border-radius:8px; color:var(--ink); font:inherit;
}
[data-fated-tavern-overlay] textarea:not([data-sandbox-mount] *) { resize:vertical; min-height:56px }
.fated-prompt > :is(label,select) { margin-bottom:6px }
.fated-prompt button,.fated-tavern-prompts > button { margin-right:6px }
.fated-battle-card,.fated-instance,.fated-prompt,.fated-battle-entry {
  margin:0 0 12px; padding:clamp(12px,2vw,18px); border:1px solid var(--line);
  border-radius:12px; background:linear-gradient(145deg,var(--card),var(--raised)); overflow-wrap:anywhere;
}
.fated-battle-card,.fated-battle-entry { border-inline-start:3px solid var(--gold) }
.fated-battle-card h4 { margin:4px 0; color:var(--ink); font-size:clamp(1.2rem,3vw,1.55rem) }
.fated-card-kicker { color:var(--gold); font:700 .75rem/1.5 ui-monospace,monospace; letter-spacing:.06em }
.fated-mini,.fated-battle-meta { margin:5px 0; color:var(--muted); font-size:.85rem }
.fated-status,.fated-battle-source {
  margin:6px 0; padding:9px 12px; border:1px solid var(--line); border-radius:8px;
  background:var(--base); color:var(--muted); max-height:14rem; overflow:auto;
  overflow-wrap:anywhere; white-space:pre-wrap; font:.8rem/1.55 ui-monospace,monospace;
}
.fated-status:empty { display:none }
:is(.fated-battle-entry,.fated-battle-source-box,.fated-diagnostics) > summary { cursor:pointer; color:#a6e3ff; font-weight:650 }
.fated-actions,.fated-chat { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:10px 0 }
.fated-chat textarea { flex:1 1 230px }
[data-fated-tavern-overlay] .fated-primary { background:var(--gold); color:#0b1120; font-weight:750; border-color:#f1cd59 }
[data-fated-tavern-overlay] .fated-primary:hover { background:#f1cd59; border-color:#f1cd59 }
.fated-toast {
  position:fixed; z-index:2; top:max(16px,env(safe-area-inset-top)); right:16px; width:min(380px,calc(100vw - 32px));
  padding:14px; border:1px solid var(--line); border-inline-start:3px solid var(--sky); border-radius:12px;
  background:var(--raised); box-shadow:0 12px 40px #020611aa; pointer-events:auto; overflow-wrap:anywhere;
  max-height:calc(100dvh - 32px); overflow:auto;
}
.fated-toast strong { color:#a6e3ff }.fated-toast p { margin:5px 0 8px; white-space:pre-wrap }.fated-toast button { margin:4px 6px 0 0 }
[data-fated-tavern-overlay] [data-sandbox-mount]:not(:empty) { min-width:0; margin:8px 0 }
[data-fated-tavern-overlay] .fated-tactical-root {
  --font-display:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;
  --font-body:var(--font-display); min-height:0;
}
[data-fated-tavern-overlay] .fated-tactical-root[data-dlc-theme=amethyst] {
  --ink-0:#0b1120; --ink-1:#0f172a; --ink-2:#0b1120; --surface:#131c2e; --surface-hover:#18243a;
  --field:#0b1120; --gold:#d4af37; --gold-rgb:212 175 55; --gold-bright:#f1cd59; --focus:#38bdf8;
  --heading:#d4af37; --text:#e5edf8; --text-muted:#a7b8cf; --text-key:#a6e3ff;
  --frame-rgb:52 72 103; --accent-rgb:100 155 205; --glow-rgb:56 189 248;
  --panel-bg:#0f172a; --panel-border:1px solid #283750; --header-bg:linear-gradient(100deg,#18243a,#131c2e);
  --header-line:#283750; --title-shadow:none; --row-bg:#131c2e; --row-border:#283750;
  --line:#283750; --line-mid:#475979; --btn-a:#ebc751; --btn-b:#d4af37; --btn-text:#111827;
}
[data-fated-tavern-overlay] .fated-tactical-root > .game-layout { container:fated-board / inline-size; padding:0 }
[data-fated-tavern-overlay] .game-header { border-inline-start:3px solid var(--gold) }
[data-fated-tavern-overlay] .action-panel { border-radius:12px }
[data-fated-tavern-overlay] .battle-main,[data-fated-tavern-overlay] .battle-sidebar { min-width:0 }
@container fated-board (max-width:850px) { [data-fated-tavern-overlay] .game-columns { grid-template-columns:minmax(0,1fr) } }
@media (max-width:660px),(max-height:460px) {
  .fated-tavern-panel { inset:6px !important; width:auto; height:auto }
  .fated-tavern-header { cursor:default; touch-action:auto }
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *) { min-height:42px }
}
`;
