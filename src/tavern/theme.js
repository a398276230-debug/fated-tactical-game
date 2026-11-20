// Console chrome. The variable values are the amethyst palette from
// styles/battle-theme.css so the Tavern console and the sandbox look like one UI.
const ciDark = `--ci-bg:#121417;--ci-surface:#1b1e22;--ci-surface-raised:#23272c;--ci-surface-soft:#2c3137;--ci-input:#0f1114;--ci-border:#494236;--ci-border-strong:#6a5b43;--ci-text:#f7f2e9;--ci-text-secondary:#d9cfbf;--ci-text-muted:#aea290;--ci-primary:#d2ac6d;--ci-primary-strong:#b88a46;--ci-primary-soft:rgb(210 172 109 / 18%);--ci-on-primary:#1d1811;--ci-success:#88a18e;--ci-danger:#d4878c;--ci-warning:#d2ad71;--ci-shadow:rgb(0 0 0 / 58%);color-scheme:dark`;
const ciLight = `--ci-bg:#e3ded6;--ci-surface:#f0ece6;--ci-surface-raised:#f6f2ec;--ci-surface-soft:#d5cec4;--ci-input:#f8f5ef;--ci-border:#b9aa96;--ci-border-strong:#806b50;--ci-text:#1f1d1a;--ci-text-secondary:#403a34;--ci-text-muted:#5d544a;--ci-primary:#6b4a22;--ci-primary-strong:#513615;--ci-primary-soft:rgb(107 74 34 / 12%);--ci-on-primary:#fff8ee;--ci-success:#365844;--ci-danger:#873941;--ci-warning:#68451f;--ci-shadow:rgb(58 47 36 / 24%);color-scheme:light`;
export const tavernTheme = `
:where([data-fated-tavern-overlay], .fated-battle-entry) {
  --ink-0:#141423; --ink-1:#1e1e32; --ink-2:#11111d;
  --surface:#252035; --surface-hover:#2f2a42; --raised-a:#393045; --raised-b:#292536;
  --field:#252035; --accent-rgb:176 142 92; --gold:#dfc080; --gold-rgb:223 192 128;
  --gold-bright:#ffd700; --gold-soft:#d7bb7c; --gold-dim:#8b7355;
  --frame-rgb:139 115 85; --glow-rgb:120 100 190; --sheen-rgb:255 240 220;
  --accent-text:#f0dfb9; --accent-label:#e0cb9d; --selected-bg:#3a3045;
  --btn-a:#776044; --btn-b:#5b4b3e; --btn-hover-a:#856d4f; --btn-hover-b:#665342;
  --btn-text:#fff0ca; --btn-line-rgb:209 179 118; --focus:#ffe2a0;
  --text:#e8d5b7; --text-soft:#d2c3ab; --text-key:#c7b4e2; --text-muted:#c9c0d0;
  --neutral-rgb:200 188 208; --scrollbar:#927753;
  --panel-bg:linear-gradient(180deg, rgba(30, 30, 50, .95) 0%, rgba(20, 20, 35, .98) 100%);
  --panel-border:2px solid #8b7355;
  --topline:linear-gradient(90deg, transparent, #ffd700, transparent);
  --topline-left:0px; --topline-width:100%; --topline-height:3px;
  --header-bg:linear-gradient(90deg, #2d2d44 0%, #3d3d5c 50%, #2d2d44 100%);
  --header-hover:linear-gradient(90deg, #3d3d5c 0%, #4d4d6c 50%, #3d3d5c 100%);
  --header-line:#8b7355; --title-shadow:0 0 10px rgba(255, 215, 0, .3);
  --row-bg:rgba(0, 0, 0, .3); --row-border:rgba(139, 115, 85, .3);
  --heading:#dfc080; --entry-text:#d2cbdc; --entry-current:#f4d98d;
  --icon-glow:0 0 10px rgba(255, 215, 0, .5);
  --font-display:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif;
  --font-body:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif;
  --line:rgb(var(--accent-rgb) / .13); --line-mid:rgb(var(--accent-rgb) / .26); --line-strong:rgb(var(--accent-rgb) / .46);
  --blue-line:#5f93c8; --blue-text:#cfe3f7; --red-line:#c0727a; --red-text:#f6d3d6;
  color-scheme:dark; color:var(--text); text-align:start;
  font:14px/1.55 var(--font-body);
}
[data-fated-tavern-overlay] { position:fixed; z-index:2147483000; pointer-events:none }
[data-fated-tavern-overlay] *, .fated-battle-entry { box-sizing:border-box }
[data-fated-tavern-overlay] [hidden] { display:none !important }

/* ---------- panels ---------- */
[data-fated-tavern-overlay] :is(.action-panel,.form-card,.wf-card,.fated-battle-card,.fated-instance,.fated-prompt):not([data-sandbox-mount] *) {
  position:relative; overflow:hidden; margin:0 0 12px;
  color:var(--text); background:var(--panel-bg); border:var(--panel-border); border-radius:10px;
  box-shadow:0 6px 20px rgba(0,0,0,.26), inset 0 1px 0 rgb(var(--sheen-rgb) / .035);
  overflow-wrap:anywhere;
}
[data-fated-tavern-overlay] :is(.action-panel,.form-card,.wf-card,.fated-battle-card,.fated-instance,.fated-prompt):not([data-sandbox-mount] *)::before {
  content:""; position:absolute; z-index:1; top:0; left:var(--topline-left); width:var(--topline-width);
  height:var(--topline-height); background:var(--topline); pointer-events:none;
}
.panel-header-bar { display:flex; align-items:center; gap:8px; min-width:0; padding:8px 12px; background:var(--header-bg); border-bottom:1px solid var(--header-line) }
.panel-title { flex:1; min-width:0; color:var(--gold-bright); font-family:var(--font-display); font-size:1.02em; font-weight:700; line-height:1.45; letter-spacing:.06em; text-shadow:var(--title-shadow); overflow-wrap:anywhere }
.panel-content { padding:10px 12px 12px }

/* ---------- buttons ---------- */
[data-fated-tavern-overlay] button:not([data-sandbox-mount] *), .fated-battle-entry button {
  display:inline-flex; align-items:center; justify-content:center; gap:5px; cursor:pointer;
  min-height:30px; padding:4px 10px; border:1px solid var(--line-mid); border-radius:6px;
  background:linear-gradient(160deg, var(--raised-a), var(--raised-b)); color:var(--text);
  font:inherit; font-size:.88em; overflow-wrap:anywhere;
}
[data-fated-tavern-overlay] .game-button.primary, [data-fated-tavern-overlay] button:not([data-sandbox-mount] *)[data-tone=primary] {
  background:linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color:rgb(var(--btn-line-rgb) / .75); color:var(--btn-text); font-weight:600;
}
@media (hover:hover) and (pointer:fine) {
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *):not(:disabled):hover, .fated-battle-entry button:hover { border-color:var(--gold); background:linear-gradient(160deg, var(--btn-hover-a), var(--btn-hover-b)); }
}
[data-fated-tavern-overlay] button:disabled { opacity:.45; cursor:not-allowed }
[data-fated-tavern-overlay] :focus-visible, .fated-battle-entry :focus-visible { outline:2px solid var(--focus); outline-offset:2px }

/* ---------- fields ---------- */
[data-fated-tavern-overlay] :is(input:not([type=checkbox]),textarea,select):not([data-sandbox-mount] *) {
  width:100%; min-width:0; min-height:32px; padding:5px 8px; border:1px solid var(--line-mid); border-radius:6px;
  background:var(--field); color:var(--text); font:inherit; font-size:.9em;
}
[data-fated-tavern-overlay] :is(input,textarea,select):not([data-sandbox-mount] *):focus { border-color:var(--gold); box-shadow:0 0 0 2px rgb(var(--gold-rgb) / .22); outline:none }
[data-fated-tavern-overlay] textarea:not([data-sandbox-mount] *) { min-height:56px; resize:vertical; font:.86em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace }
[data-fated-tavern-overlay] .masked-key-input { -webkit-text-security:disc }
[data-fated-tavern-overlay] .field { display:grid; gap:3px; min-width:0 }
[data-fated-tavern-overlay] .field > label, [data-fated-tavern-overlay] label.field { display:grid; gap:3px; min-width:0; color:var(--text-soft); font-size:.84em }
[data-fated-tavern-overlay] .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr)); gap:8px 10px; padding:10px 12px 12px }
[data-fated-tavern-overlay] .row-inline { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0 }
[data-fated-tavern-overlay] .row-inline input:not([type=checkbox]) { flex:1 1 10rem }
[data-fated-tavern-overlay] .pill-btn { border-radius:999px; padding-inline:12px }

/* ---------- console shell ---------- */
[data-fated-tavern-overlay] .fated-tavern-launcher {
  position:fixed; right:18px; bottom:18px; width:52px; height:52px; border-radius:50%;
  border-color:var(--gold); font-size:22px; box-shadow:0 8px 24px rgb(var(--accent-rgb) / .25); pointer-events:auto;
}
.fated-tavern-panel {
  position:fixed; right:16px; bottom:16px; width:min(1100px,calc(100vw - 32px));
  height:min(820px,calc(100dvh - 32px)); display:flex; flex-direction:column;
  border:var(--panel-border); border-radius:10px; background:var(--panel-bg);
  box-shadow:0 18px 54px rgba(0,0,0,.55); pointer-events:auto; overflow:hidden;
}
[data-fated-tavern-overlay] .fated-tavern-panel::before {
  content:""; position:absolute; z-index:2; top:0; left:var(--topline-left); width:var(--topline-width);
  height:var(--topline-height); background:var(--topline); pointer-events:none;
}
.fated-tavern-header { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:move; touch-action:none; user-select:none; background:var(--header-bg); border-bottom:1px solid var(--header-line) }
.fated-tavern-header strong { flex:1; color:var(--gold); font-family:var(--font-display); font-size:1.02rem; font-weight:700; letter-spacing:.07em; text-shadow:var(--title-shadow) }
.fated-tavern-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px; background:var(--row-bg); border-bottom:1px solid var(--header-line) }
[data-fated-tavern-overlay] .fated-tavern-tabs button {
  min-height:28px; border-radius:5px; border-color:transparent; background:transparent; color:var(--text-soft); font-size:.85em; letter-spacing:.04em;
}
[data-fated-tavern-overlay] .fated-tavern-tabs button[aria-selected=true] {
  background:linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color:rgb(var(--btn-line-rgb) / .75); color:var(--btn-text); font-weight:600;
}
.fated-tavern-content { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:10px 12px 14px; scrollbar-color:var(--scrollbar) transparent; scrollbar-width:thin }
.fated-tab { display:none }.fated-tab.active { display:block }
.fated-tab > h3 { margin:0 0 10px; color:var(--gold); font-family:var(--font-display); font-size:1rem; font-weight:700; letter-spacing:.08em }

/* ---------- instances / sandbox chrome ---------- */
.fated-battle-card h4 { margin:2px 0 4px; padding:0 12px; color:var(--accent-text); font-family:var(--font-display); font-size:1.1rem }
.fated-card-kicker { padding:8px 12px 0; color:var(--gold-dim); font:600 .72em/1.5 ui-monospace,monospace; letter-spacing:.08em }
.fated-instance { padding:10px 12px 12px; overflow-wrap:anywhere }
.fated-instance > * { margin-inline:0 }
.fated-battle-card > :is(p,details,.fated-actions,.fated-status) { margin-inline:12px }
.fated-mini,.fated-battle-meta { margin:5px 0; color:var(--text-muted); font-size:.82em }
.fated-status,.fated-battle-source {
  margin:6px 0; padding:7px 10px; border:1px solid var(--row-border); border-radius:6px;
  background:var(--row-bg); color:var(--text-soft); max-height:10lh; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--scrollbar) transparent;
  overflow-wrap:anywhere; white-space:pre-wrap; font:.78em/1.5 ui-monospace,monospace;
}
.fated-status:empty { display:none }
:is(.fated-battle-source-box,.fated-diagnostics) > summary { cursor:pointer; color:var(--accent-label); padding-block:4px }
.fated-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:8px 0 }
.fated-instance > strong { display:block; color:var(--accent-text) }
.fated-instance > .fated-status { max-height:8lh; scrollbar-width:thin; scrollbar-color:var(--scrollbar) transparent }
.fated-chat { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:8px 0 }
.fated-chat textarea { flex:1 1 230px }
.fated-ai-log { display:flex; flex-direction:column; gap:8px; max-height:380px; min-height:180px; overflow:auto; padding:4px; border:1px solid var(--line); border-radius:8px; background:rgb(0 0 0/.12); }
.fated-ai-message { flex:none; max-width:92%; padding:7px 9px; border:1px solid var(--line); border-radius:8px; background:rgb(255 255 255/.04); white-space:pre-wrap; overflow-wrap:anywhere; }
.fated-ai-message[data-role=user] { align-self:flex-end; background:rgb(95 147 200/.12); }
.fated-ai-message[data-role=assistant] { align-self:flex-start; border-color:rgb(var(--gold-rgb)/.35); }
.fated-ai-message[data-role=system] { align-self:center; opacity:.78; font-size:.86em; }
.fated-ai-message[data-role=tool] { align-self:flex-start; border-style:dashed; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.84em; }
.fated-ai-message[data-status=error] { border-color:#d66; }.fated-ai-message[data-status=aborted] { opacity:.7; }
.fated-ai-message header { display:flex; justify-content:space-between; gap:12px; color:var(--gold); font-size:.72em; margin-bottom:4px; }
.fated-ai-message header time { color:var(--text-muted, var(--blue-text)); font-weight:400; }.fated-ai-body p { margin:0 0 6px; }.fated-ai-body p:last-child { margin-bottom:0; }.fated-ai-body pre { margin:5px 0; padding:6px; overflow:auto; background:#0005; border-radius:5px; }
.fated-ai-info { color:var(--text-muted, var(--blue-text)); font-size:.78em; margin:5px 0; }
[data-fated-tavern-overlay] { ${ciDark} }
@media(prefers-color-scheme:light) { [data-fated-tavern-overlay] { ${ciLight} } }
.fated-ci-dark,.fated-ci-dark [data-fated-tavern-overlay] { ${ciDark} }
.fated-ci-light,.fated-ci-light [data-fated-tavern-overlay] { ${ciLight} }
[data-fated-tavern-overlay] article.fated-instance.fated-instance { padding:14px 16px; margin-block:8px; color:var(--ci-text); border:1px solid var(--ci-border); border-radius:10px; background:var(--ci-surface); box-shadow:none }
[data-fated-tavern-overlay] article.fated-instance::before { display:none }
.fated-char-heading { display:flex;align-items:center;justify-content:space-between;gap:12px }.fated-char-heading input { flex:none; accent-color:var(--ci-primary) }.fated-char-name { color:var(--ci-text) }.fated-source-label { margin-inline-start:8px;color:var(--ci-text-muted) }
.fated-char-stats,.fated-char-resources { display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin:10px 0 }.fated-char-stats div {padding:4px 6px;border-radius:4px;background:var(--ci-primary-soft)}.fated-char-stats dt {font-size:.8em;color:var(--ci-text-secondary)}.fated-char-stats dd {margin:0;font-weight:bold;color:var(--ci-primary)}
.fated-char-resources {grid-template-columns:repeat(3,minmax(0,1fr));color:var(--ci-text-secondary)}.fated-char-resources span {padding-block-end:5px;background:linear-gradient(to right,var(--ci-primary-soft) var(--fill),var(--ci-surface-soft) var(--fill)) left bottom / 100% 4px no-repeat}
.fated-instance h5 { margin:8px 0 2px;color:var(--ci-primary) }.fated-char-row { padding-block:3px }.fated-instance .fated-mini {color:var(--ci-text-muted)}.fated-instance summary { cursor:pointer }.fated-char-raw { border-top:1px solid var(--ci-border-strong); margin-block:8px; padding:6px 8px;background:var(--ci-input);color:var(--ci-text-secondary) }.fated-char-raw pre { max-height:12rem; overflow:auto;color:inherit }
[data-fated-tavern-overlay] .fated-instance button:not([data-sandbox-mount] *) {background:var(--ci-surface-raised);border-color:var(--ci-border);color:var(--ci-text-secondary)}
[data-fated-tavern-overlay] .fated-instance button:not([data-sandbox-mount] *):hover {background:var(--ci-primary-soft);border-color:var(--ci-primary);color:var(--ci-primary)}
.fated-toast {
  position:fixed; z-index:2; top:max(16px,env(safe-area-inset-top)); right:16px; width:min(380px,calc(100vw - 32px));
  padding:12px 14px; border:1px solid var(--header-line); border-inline-start:3px solid var(--notice-color,var(--blue-text)); border-radius:8px;
  background:var(--panel-bg); color:var(--text); box-shadow:0 12px 40px rgba(0,0,0,.5);
  pointer-events:auto; overflow-wrap:anywhere; max-height:calc(100dvh - 32px); overflow:auto;
}
.fated-toast[data-tone="success"] { --notice-color:var(--accent-text) }
.fated-toast[data-tone="error"] { --notice-color:var(--red-text) }
.fated-toast header { display:flex; align-items:center; gap:8px; color:var(--notice-color,var(--blue-text)) }
.fated-toast header span { display:grid; place-items:center; width:1.4em; height:1.4em; border:1px solid currentColor; border-radius:50%; font-weight:bold }
.fated-toast p { margin:6px 0; white-space:pre-wrap; color:var(--text-soft) }
.fated-toast-issues { border-top:1px solid var(--line); margin-top:8px; padding-top:8px }
.fated-toast-issues h4 { margin:0; color:var(--text-key) }.fated-toast-issues ul { margin:4px 0; padding-inline-start:1.5em }
.fated-toast-raw { margin-top:8px; border-top:1px solid var(--line); padding-top:8px }
.fated-toast-raw summary { display:list-item; cursor:pointer; color:var(--text-key) }
.fated-toast-raw summary:focus-visible { outline:2px solid var(--focus); outline-offset:2px }
.fated-toast-raw pre { margin:6px 0 0; padding:8px; max-height:min(12rem,35dvh); overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text); background:var(--surface); border-radius:4px }
.fated-toast footer { display:flex; justify-content:flex-end; gap:6px; margin-top:8px }.fated-toast footer:has(button:not([hidden])) { border-top:1px solid var(--line); padding-top:8px }

/* ---------- switch ---------- */
[data-fated-tavern-overlay] .switch { position:relative; flex:none; display:inline-flex; align-items:center; width:42px; height:22px; margin-left:auto; cursor:pointer }
[data-fated-tavern-overlay] .switch input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer }
[data-fated-tavern-overlay] .switch-track { position:absolute; inset:0; border:1px solid var(--line-mid); border-radius:999px; background:var(--row-bg); box-shadow:inset 0 1px 3px rgba(0,0,0,.45); transition:background-color .18s ease, border-color .18s ease; pointer-events:none }
[data-fated-tavern-overlay] .switch-track::after { content:""; position:absolute; top:1px; left:1px; width:18px; height:18px; border-radius:50%; background:var(--text-muted); box-shadow:0 1px 3px rgba(0,0,0,.55); transition:transform .18s cubic-bezier(.23,1,.32,1), background-color .18s ease }
[data-fated-tavern-overlay] .switch input:checked + .switch-track { background:rgb(var(--gold-rgb) / .22); border-color:var(--gold) }
[data-fated-tavern-overlay] .switch input:checked + .switch-track::after { transform:translateX(20px); background:var(--gold) }
[data-fated-tavern-overlay] .switch input:focus-visible + .switch-track { outline:2px solid var(--focus); outline-offset:2px }
@media (prefers-reduced-motion:reduce) { [data-fated-tavern-overlay] .switch-track, [data-fated-tavern-overlay] .switch-track::after { transition:none } }

/* ---------- sandbox game root keeps its own layout variables ---------- */
[data-fated-tavern-overlay] [data-sandbox-mount]:not(:empty) { min-width:0; margin:8px 0 }
[data-fated-tavern-overlay] .fated-tactical-root {
  --font-display:"Noto Sans SC",'PingFang SC','Microsoft YaHei',system-ui,sans-serif;
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
[data-fated-tavern-overlay] .battle-main,[data-fated-tavern-overlay] .battle-sidebar { min-width:0 }
@container fated-board (max-width:850px) { [data-fated-tavern-overlay] .game-columns { grid-template-columns:minmax(0,1fr) } }
@media (max-width:660px),(max-height:460px) {
  .fated-tavern-panel { inset:6px !important; width:auto; height:auto }
  .fated-tavern-header { cursor:default; touch-action:auto }
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *) { min-height:36px }
}
`;
