import { DEFAULT_SLOTS, describeSlots, makeCustomSlot, resolveSlotContent } from './prompts.js';
import { fetchModels, normalizationApiConfig, requestViaCustomApi, requestViaTavern } from './api.js';
import { normalizationLimits } from './normalization-batches.js';

// Only prompt-tab layout lives here; palette, panels, fields, buttons and the
// switch come from theme.js, which mirrors styles/battle-theme.css.
const css = `
.fated-settings {display:grid;gap:10px;min-width:0}
.fated-settings .wf-dashboard {margin:0}
.fated-settings .wf-dashboard .wf-hero {flex:none;color:var(--gold-soft);font-size:.8em;letter-spacing:.05em;font-family:var(--font-display)}
.fated-settings .wf-toolbar {display:flex;flex-wrap:wrap;gap:6px;padding:9px 12px}
.fated-settings .slot-pipeline {display:grid;gap:0;min-width:0}
.fated-settings .wf-card {display:block;margin:0 0 8px}
.fated-settings .slot-head {display:flex;align-items:center;gap:8px;min-width:0;padding:7px 10px 7px 12px;background:var(--header-bg);border-bottom:1px solid var(--header-line)}
.fated-settings .slot-head:last-child {border-bottom:0}
.fated-settings .slot-title {flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gold);font-family:var(--font-display);font-size:1em;font-weight:700;letter-spacing:.05em;text-shadow:var(--title-shadow)}
.fated-settings .wf-card:has(> .slot-head input.toggle-switch:not(:checked)) .slot-desc {opacity:.55}
.fated-settings .wf-card:has(> .slot-head input.toggle-switch:not(:checked)) .role-badge {opacity:.65}
.fated-settings .role-badge {flex:none;padding:0 7px;border:1px solid;border-radius:999px;background:transparent;font:600 .7em/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em;text-transform:lowercase}
.fated-settings .role-badge[data-role=system] {border-color:rgb(var(--gold-rgb)/.6);background:rgb(var(--gold-rgb)/.1);color:var(--gold)}
.fated-settings .role-badge[data-role=user] {border-color:var(--blue-line);background:rgb(95 147 200/.12);background:color-mix(in srgb, var(--blue-line) 14%, transparent);color:var(--blue-text)}
.fated-settings .role-badge[data-role=assistant] {border-color:rgb(var(--glow-rgb)/.6);background:rgb(var(--glow-rgb)/.16);color:var(--text-key)}
.fated-settings .slot-actions {display:flex;flex:none;gap:1px;margin-left:auto}
.fated-settings .slot-actions button {min-height:24px;padding:0 7px;border-color:transparent;background:transparent;color:var(--gold-soft);font-size:.8em;opacity:.85}
.fated-settings .slot-actions button:hover,.fated-settings .slot-actions button:focus-visible {border-color:var(--line-mid);background:var(--row-bg);opacity:1}
.fated-settings .slot-actions button:disabled {opacity:.22;border-color:transparent;background:transparent}
.fated-settings .slot-actions .danger:hover {border-color:var(--red-line);color:var(--red-text)}
.fated-settings .wf-card .switch {margin-left:6px}
.fated-settings .slot-desc {margin:0;padding:6px 12px 8px;color:var(--text-muted);font-size:.78em;line-height:1.5;overflow-wrap:anywhere}
.fated-settings .slot-editor {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));gap:8px 10px;padding:9px 12px 12px;border-top:1px solid var(--row-border);background:var(--row-bg)}
.fated-settings .slot-editor .wide {grid-column:1/-1}
.fated-settings .slot-editor .hint {color:var(--gold-dim);font-size:.74em;line-height:1.5;overflow-wrap:anywhere}
.fated-settings .slot-editor textarea {min-height:8.5em}
.fated-settings .slot-preview {margin:0;padding:7px 9px;border:1px solid var(--line-mid);border-radius:6px;background:var(--field);color:var(--text-soft);max-height:16em;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent;font:.8em/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}
.fated-settings .wf-empty {padding:14px 12px;color:var(--text-muted);text-align:center}
.fated-settings .fated-settings pre {margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:.78em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.fated-settings .preview-panel pre {max-height:22em;overflow:auto;padding:9px 12px 12px;color:var(--text-soft);background:var(--row-bg)}
.fated-settings .preview-panel summary {display:flex;align-items:center;gap:8px;padding:0;cursor:pointer;list-style:none}
.fated-settings .preview-panel summary::-webkit-details-marker {display:none}
.fated-settings .preview-panel summary::after {content:'▾';flex:none;padding-right:12px;color:var(--gold-dim);font-size:.8em}
.fated-settings .preview-panel[open] summary {border-bottom:1px solid var(--header-line)}
.fated-settings .preview-panel summary .panel-title {padding:8px 12px}
.fated-settings .api-card .form-grid {grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:12px}
.fated-settings .field.wide {grid-column:1/-1}
.fated-settings .switch-field {display:flex;align-items:center;justify-content:flex-start;gap:14px;min-height:32px}
.fated-settings .switch-field > span {color:var(--text-soft);font-size:.84em}
.fated-settings .cmd-row {display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.fated-settings .api-card .api-status {margin:6px 0 0}
.fated-settings .api-status {margin:0 12px 12px;padding:7px 10px;border:1px solid var(--row-border);border-radius:6px;background:var(--row-bg);color:var(--text-soft);font-size:.82em;white-space:pre-wrap;overflow-wrap:anywhere}
.fated-settings .api-status:empty {display:none}
.fated-settings .api-status[data-error=true] {border-color:var(--red-line);color:var(--red-text);background:rgb(192 114 122/.1);background:color-mix(in srgb, var(--red-line) 12%, transparent)}
/* Narrow windows: keep the switch and target sizes usable without scaling the layout. */
@media (max-width:560px) {
  .fated-settings .slot-head {flex-wrap:wrap;row-gap:6px}
  .fated-settings .slot-title {flex:1 1 auto}
  .fated-settings .slot-head .switch {order:2}
  .fated-settings .slot-actions {order:3;flex-basis:100%;margin-left:0}
  .fated-settings .slot-actions button {min-height:32px;padding:0 10px;font-size:.85em}
  .fated-settings .slot-editor {grid-template-columns:1fr}
  .fated-settings .api-card .form-grid {grid-template-columns:1fr}
  .fated-settings .wf-toolbar button {min-height:34px}
  [data-fated-tavern-overlay] .fated-tavern-tabs {gap:2px;padding:5px 6px}
  [data-fated-tavern-overlay] .fated-tavern-tabs button {padding:4px 6px;font-size:.8em}
}
`;

function mount(page) {
  const doc = page.ownerDocument;
  const make = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const root = make('div', 'fated-settings');
  page.replaceChildren(make('style', '', css), root);
  const button = (text, cls = 'pill-btn') => Object.assign(make('button', cls, text), { type: 'button' });
  const panel = (title) => {
    const section = make('section', 'action-panel form-card');
    const bar = make('div', 'panel-header-bar');
    bar.append(make('h3', 'panel-title', title));
    section.append(bar);
    return { section, bar };
  };
  return { make, root, button, panel };
}

export function renderPromptTab(page, ctx) {
  const { make, root, button, panel } = mount(page);
  let slots = describeSlots(ctx.slots ?? ctx.settings.slots);
  let editing = null;
  const editors = new Map();
  const field = (title, control, wide = false) => {
    const label = make('label', wide ? 'field wide' : 'field', title);
    label.append(control);
    return label;
  };

  const dashboard = make('section', 'action-panel form-card wf-dashboard');
  const dashBar = make('div', 'panel-header-bar');
  const hero = make('strong', 'wf-hero');
  dashBar.append(make('h3', 'panel-title', '🧩 提示词槽位'), hero);
  const toolbar = make('div', 'wf-toolbar');
  const add = button('+ 新建槽位');
  const reset = button('恢复默认');
  const previewKind = make('select');
  previewKind.setAttribute('aria-label', '提示词预览类型');
  for (const [value, label] of [['validate', '标准化预览'], ['chat', '辅助聊天预览']]) {
    previewKind.append(Object.assign(make('option', '', label), { value }));
  }
  toolbar.append(add, reset, previewKind);
  dashboard.append(dashBar, toolbar);

  const pipeline = make('div', 'slot-pipeline');
  const preview = make('details', 'action-panel form-card preview-panel');
  const summary = make('summary', 'panel-header-bar');
  summary.append(make('span', 'panel-title', '最终 messages 预览（JSON）'));
  const json = make('pre');
  preview.append(summary, json);
  root.append(dashboard, pipeline, preview);

  const extraText = () => ctx.settings.extraText ?? '';
  const last = make('details', 'action-panel form-card preview-panel');
  const lastSummary = make('summary', 'panel-header-bar');
  lastSummary.append(make('span', 'panel-title', '上次实际发送的 messages（组装快照）'));
  const lastJson = make('pre'); last.append(lastSummary, lastJson); root.append(last);
  const showLast = () => {
    const messages = ctx.lastSent(); last.hidden = !messages;
    if (messages) lastJson.textContent = JSON.stringify(messages, null, 2);
  };
  ctx.onPreview((messages, kind) => {
    showLast();
    if (kind !== previewKind.value) return;
    summary.firstChild.textContent = `最终 messages 预览（${kind === 'chat' ? '辅助聊天' : '标准化'}）`;
    json.textContent = JSON.stringify(messages, null, 2);
  });
  const refresh = () => {
    hero.textContent = `已启用 ${slots.filter(s => s.enabled !== false).length} / ${slots.length}`;
    ctx.prepareMessages(previewKind.value);
  };
  function saveSlots(next, fields = {}) {
    const previous = slots;
    slots = next;
    ctx.save({ ...fields, slots }, previous);
    refresh();
  }
  const blank = () => {
    pipeline.replaceChildren(make('p', 'wf-empty', '没有槽位了。点「新建槽位」添加自定义提示词，或点「恢复默认」。'));
  };

  function drawCards() {
    pipeline.replaceChildren();
    editors.clear();
    if (!slots.length) { refresh(); return blank(); }
    const previewContext = ctx.assemblyContext(previewKind.value);
    slots.forEach((slot, i) => {
      const card = make('article', 'action-panel wf-card');
      const head = make('div', 'slot-head');
      const switchWrap = make('label', 'switch');
      const toggle = make('input', 'toggle-switch');
      toggle.type = 'checkbox';
      toggle.checked = slot.enabled !== false;
      switchWrap.append(toggle, make('span', 'switch-track'));
      const title = make('strong', 'slot-title');
      const badge = make('span', 'role-badge', slot.role);
      badge.dataset.role = slot.role;
      const actions = make('div', 'slot-actions');
      const edit = button('编辑');
      const up = button('▲');
      up.title = '上移';
      const down = button('▼');
      down.title = '下移';
      const remove = button('✕', 'pill-btn danger');
      remove.disabled = slot.id === 'identity' || slot.id === 'raw';
      remove.title = remove.disabled ? '可使用开关停用此内置槽位' : slot.custom ? '删除此槽位' : '隐藏此内置槽位（可从「恢复默认」找回）';
      actions.append(edit, up, down, remove);
      head.append(title, badge, actions, switchWrap);

      const setTitle = value => {
        title.textContent = value.trim() || '未命名槽位';
        title.title = title.textContent;
        toggle.setAttribute('aria-label', `启用：${title.textContent}`);
        for (const action of actions.children) action.setAttribute('aria-label', `${action.title}：${title.textContent}`);
      };
      setTitle(slot.label);

      const desc = slot.desc || (slot.custom ? '自定义槽位' : '');
      const body = make('p', 'slot-desc', desc);
      const editable = slot.custom === true || slot.id === 'extra';
      const form = make('div', 'slot-editor');
      form.hidden = editing !== slot.id;
      const labelInput = make('input');
      labelInput.value = slot.label;
      labelInput.setAttribute('aria-label', '槽位标题');
      const role = make('select');
      role.setAttribute('aria-label', '消息角色');
      for (const value of ['system', 'user', 'assistant']) role.append(Object.assign(make('option', '', value), { value }));
      role.value = slot.role;
      const staticContent = slot.content || (slot.id === 'extra' ? extraText() : '');
      const content = editable ? make('textarea') : make('pre', 'slot-preview');
      content.setAttribute('aria-label', '槽位内容');
      if (editable) content.value = staticContent;
      else {
        content.textContent = resolveSlotContent(slot, previewContext);
        content.setAttribute('aria-readonly', 'true');
        content.tabIndex = 0;
      }
      form.append(field('标题', labelInput), field('角色', role), field(editable ? '内容' : '内容（动态生成，只读）', content, true));
      if (editable) form.append(make('p', 'hint wide', '可用占位符：{{battle_init}}、{{battle_state}}、{{warnings}}、{{user_instruction}}、{{roster}}、{{battle}}、{{mvu_data}}、{{latest_floor}}、{{standardized_roster}}。留空则不发送。'));

      const expand = open => {
        form.hidden = !open;
        edit.setAttribute('aria-expanded', String(open));
      };
      expand(editing === slot.id);
      editors.set(slot.id, { edit, label: labelInput, content, expand });
      edit.onclick = () => {
        const open = form.hidden;
        editors.get(editing)?.expand(false);
        editing = open ? slot.id : null;
        expand(open);
        if (open) labelInput.focus();
      };

      // Inputs stay mounted across saves so typing and IME composition are not interrupted.
      const patch = changes => saveSlots(slots.map((s, j) => j === i ? { ...s, ...changes } : s));
      toggle.onchange = () => patch({ enabled: toggle.checked });
      labelInput.oninput = () => { setTitle(labelInput.value); patch({ label: labelInput.value }); };
      role.onchange = () => { badge.textContent = badge.dataset.role = role.value; patch({ role: role.value }); };
      if (editable) {
        content.oninput = () => {
          // The legacy `extra` slot migrates its text into static slot content on first edit.
          if (slot.id === 'extra') saveSlots(slots.map((s, j) => j === i ? { ...s, content: content.value } : s), { extraText: '' });
          else patch({ content: content.value });
        };
      }
      const move = to => {
        const next = slots.slice();
        [next[i], next[to]] = [next[to], next[i]];
        saveSlots(next);
        drawCards();
        editors.get(slot.id)?.edit.focus();
      };
      up.disabled = i === 0;
      down.disabled = i === slots.length - 1;
      up.onclick = () => move(i - 1);
      down.onclick = () => move(i + 1);
      remove.onclick = () => {
        if (editing === slot.id) editing = null;
        saveSlots(slots.filter((_, j) => j !== i));
        drawCards();
        (editors.get(slots[i]?.id ?? slots[i - 1]?.id)?.edit ?? add).focus();
      };
      card.append(head, body, form);
      pipeline.append(card);
    });
    refresh();
  }
  previewKind.onchange = drawCards;
  add.onclick = () => {
    const slot = makeCustomSlot();
    editing = slot.id;
    saveSlots([...slots, slot]);
    drawCards();
    editors.get(slot.id)?.label.focus();
  };
  reset.onclick = () => {
    editing = null;
    saveSlots(describeSlots(DEFAULT_SLOTS), { extraText: '' });
    drawCards();
  };
  drawCards();
}

export function renderApiTab(page, ctx) {
  const { make, root, button, panel } = mount(page);
  const settings = ctx.settings;
  const tavern = (settings.apiMode ?? 'tavern') === 'tavern';
  function card(title) {
    const { section } = panel(title);
    const grid = make('div', 'form-grid');
    section.className = 'action-panel form-card api-card';
    section.append(grid);
    root.append(section);
    return grid;
  }
  function field(grid, key, title, input, fallback, disabled = false, wide = false) {
    const wrap = make('div', wide ? 'field wide' : 'field');
    const label = make('label', '', title);
    input.name = key;
    input.disabled = disabled;
    const checkbox = input.type === 'checkbox';
    if (checkbox) input.checked = settings[key] ?? fallback;
    else input.value = settings[key] ?? fallback;
    input.onchange = () => {
      if (input.type === 'number' && (!input.reportValidity() || !Number.isFinite(input.valueAsNumber))) return;
      ctx.save({ [key]: checkbox ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value });
      if (['apiMode', 'apiTransport', 'normalizationAiMode', 'normalizationAiApiTransport', 'battleAiMode'].includes(key)) renderApiTab(page, ctx);
    };
    label.append(input);
    wrap.append(label);
    grid.append(wrap);
    return wrap;
  }
  const select = options => {
    const input = make('select');
    for (const [value, text] of options) input.append(Object.assign(make('option', '', text), { value }));
    return input;
  };
  const input = (type, props = {}) => Object.assign(make('input'), { type }, props);
  const api = card('🔌 辅助 AI（聊天）');
  field(api, 'apiMode', '接口调用方式', select([
    ['custom', '🚀 独立自定义 API'],
    ['tavern', '🍺 酒馆当前连接 API (TavernHelper.generateRaw)'],
  ]), 'tavern');
  field(api, 'apiTransport', '独立 API 请求路径', select([
    ['direct', '浏览器直连'],
    ['tavern', '经酒馆后端（OpenAI 兼容）'],
  ]), 'direct', tavern);
  if (settings.apiTransport !== 'tavern') field(api, 'apiSource', '独立 API 协议类型', select([
    ['openai', 'OpenAI 兼容接口 (反代/DeepSeek/硅基/OneAPI等)'], ['gemini', 'Google Gemini 原生接口 (/v1beta/models)'],
    ['claude', 'Anthropic Claude 原生接口 (/v1/messages)'],
  ]), 'openai', tavern);
  field(api, 'baseUrl', 'API 地址 (Base URL)', input('text', { placeholder: '例如 https://api.deepseek.com 或 https://你的反代域名/v1' }), '', tavern);
  field(api, 'apiKey', 'API 密钥 (API Key)', input('password', { className: 'masked-key-input', autocomplete: 'off' }), '', tavern);
  const model = input('text');
  const modelField = field(api, 'model', '模型名称', model, '', tavern, true);
  function modelCommands(modelField, model, getSettings, { viaTavern = false, pickerLabel = '可用模型' } = {}) {
    const commands = make('div', 'cmd-row');
    const load = button('🔄 拉取模型');
    const test = button('⚡ 测试连接');
    commands.append(load, test);
    const status = make('div', 'api-status');
    status.setAttribute('role', 'status');
    modelField.append(commands, status);
    load.disabled = viaTavern;
    const requestOptions = { host: ctx.host, fetchImpl: ctx.fetchImpl };
    async function run(pending, action) {
      load.disabled = test.disabled = true;
      status.dataset.error = 'false';
      status.textContent = pending;
      try { status.textContent = await action(); }
      catch (err) {
        status.dataset.error = 'true';
        status.textContent = `请求失败：${err?.message || String(err)}`;
      } finally { load.disabled = viaTavern; test.disabled = false; }
    }
    let picker;
    load.onclick = () => run('正在拉取模型…', async () => {
      picker?.remove();
      const names = await fetchModels(getSettings(), requestOptions);
      if (!names.length) throw new Error('接口未返回可用模型');
      picker = select([['', '请选择模型'], ...names.map(name => [name, name])]);
      picker.setAttribute('aria-label', pickerLabel);
      picker.onchange = () => {
        if (!picker.value) return;
        model.value = picker.value;
        ctx.save({ [model.name]: model.value });
      };
      modelField.append(picker);
      return `已拉取 ${names.length} 个模型`;
    });
    test.onclick = () => run('正在测试连接…', async () => {
      const probe = { ...getSettings(), max_tokens: 8 };
      const messages = [{ role: 'user', content: '只回复 OK' }];
      if (viaTavern) await requestViaTavern(ctx.host, probe, messages, {});
      else await requestViaCustomApi(probe, messages, requestOptions);
      return '测试连接成功';
    });
  }
  modelCommands(modelField, model, () => ctx.settings, { viaTavern: tavern });

  const normalization = card('🛠️ 标准化 AI');
  field(normalization, 'normalizationAiMode', '调用通道', select([
    ['same', '复用辅助 AI 配置'], ['custom', '独立标准化 AI API'],
  ]), 'same');
  const separate = settings.normalizationAiMode === 'custom';
  field(normalization, 'normalizationAiApiTransport', '独立 API 请求路径', select([
    ['direct', '浏览器直连'], ['tavern', '经酒馆后端（OpenAI 兼容）'],
  ]), 'direct', !separate);
  if (settings.normalizationAiApiTransport !== 'tavern') field(normalization, 'normalizationAiApiSource', '独立 API 协议类型', select([
    ['openai', 'OpenAI 兼容接口'], ['gemini', 'Google Gemini 原生接口'], ['claude', 'Anthropic Claude 原生接口'],
  ]), 'openai', !separate);
  field(normalization, 'normalizationAiBaseUrl', '标准化 AI API 地址', input('text', { placeholder: 'https://你的反代域名/v1' }), '', !separate);
  field(normalization, 'normalizationAiApiKey', '标准化 AI API 密钥', input('password', { autocomplete: 'off' }), '', !separate);
  const normalizationModel = input('text');
  const normalizationModelField = field(normalization, 'normalizationAiModel', '标准化 AI 模型', normalizationModel, '', !separate, true);
  if (separate) modelCommands(normalizationModelField, normalizationModel, () => normalizationApiConfig(ctx.settings), { pickerLabel: '标准化可用模型' });
  normalization.append(make('p', 'hint wide', '自动标准化、手动标准化和失败补丁的修复请求共用此通道。'));
  const settlement = card('战后结算');
  field(settlement, 'mvuWritebackMode', '战果同步至 MVU', select([['confirm', '写回前确认'], ['auto', '自动同步并交付'], ['off', '仅交付战报']]), 'confirm');
  const battle = card('⚔️ 战斗 AI（敌方陪玩）');
  field(battle, 'battleAiEnabled', '启用战斗 AI', Object.assign(input('checkbox'), { type:'checkbox' }), false);
  field(battle, 'battleAiMode', '调用通道', select([['same','复用辅助 AI 配置'],['custom','独立战斗 AI API']]), 'same');
  field(battle, 'battleAiBaseUrl', '战斗 AI API 地址', input('text', {placeholder:'http://127.0.0.1:8317/v1'}), '', settings.battleAiMode !== 'custom');
  field(battle, 'battleAiApiKey', '战斗 AI API 密钥', input('password', {autocomplete:'off'}), '', settings.battleAiMode !== 'custom');
  field(battle, 'battleAiModel', '战斗 AI 模型', input('text', {placeholder:'deepseek-v4.1-flash'}), '', settings.battleAiMode !== 'custom');
  const battleHelp = make('p', 'hint wide', '战斗 AI 只接收当前敌方连续回合的可行动角色、技能与装备、攻击范围、互动、地形高度和隔断。模型输出非法 JSON 或非法动作时自动重试一次，仍失败则使用本地 AI。');
  battle.append(battleHelp);
  const sampling = card('⚙ 采样参数');
  field(sampling, 'temperature', '温度 (temperature)', input('number', { step: 'any', required: true }), 0.8);
  field(sampling, 'max_tokens', '最大输出长度 (max_tokens)', input('number', { min: '1', step: '1', required: true }), 32000);
  for (const [key, label] of [['normalizationConcurrency', '标准化最大并发请求数'], ['normalizationWarningsPerBatch', '标准化每批警告数']]) {
    const { fallback, max } = normalizationLimits[key];
    field(sampling, key, label, input('number', { min: '1', max: String(max), step: '1', required: true }), fallback);
  }
  const streamField = make('div', 'field switch-field');
  const streamSwitch = make('label', 'switch');
  const streamInput = Object.assign(make('input'), { type: 'checkbox', name: 'stream', checked: settings.stream ?? true });
  streamSwitch.append(streamInput, make('span', 'switch-track'));
  streamInput.onchange = () => ctx.save({ stream: streamInput.checked });
  streamField.append(make('span', '', '流式响应 (stream)'), streamSwitch);
  sampling.append(streamField);
  const timeoutField = make('div', 'field');
  const timeoutLabel = make('label', '', '请求超时（秒）');
  const timeout = input('number', { name: 'timeoutMs', min: '5', max: '3600', step: '5', required: true, value: (settings.timeoutMs ?? 240000) / 1000 });
  timeout.onchange = () => {
    if (Number.isFinite(timeout.valueAsNumber)) timeout.value = Math.min(3600, Math.max(5, timeout.valueAsNumber));
    if (timeout.reportValidity()) ctx.save({ timeoutMs: timeout.valueAsNumber * 1000 });
  };
  timeoutLabel.append(timeout);
  timeoutField.append(timeoutLabel);
  sampling.append(timeoutField);
}

export function renderSettings(page, key, ctx) {
  if (key === 'prompt') return renderPromptTab(page, ctx);
  if (key === 'api') return renderApiTab(page, ctx);
}
