const roleLabels = { user: '玩家', assistant: '辅助 AI', system: '系统', tool: '工具' };
const statusLabels = { ok: '完成', error: '失败', aborted: '已中止' };
const formatTime = ts => new Date(ts).toLocaleString();

// Build Markdown with text nodes so streamed model output cannot inject HTML.
function renderMarkdown(target, content, make) {
  const blocks = content.split(/^```[^\n]*\n|^```[ \t]*(?:\n|$)/m);
  for (const [index, block] of blocks.entries()) {
    if (index % 2) {
      const pre = make('pre');
      pre.append(make('code', {}, block.replace(/\n$/, '')));
      target.append(pre);
      continue;
    }
    for (const paragraph of block.trim().split(/\n\s*\n/).filter(Boolean)) {
      const node = make('p');
      for (const [i, part] of paragraph.split(/`([^`\n]+)`/).entries()) {
        node.append(i % 2 ? make('code', {}, part) : part);
      }
      target.append(node);
    }
  }
}

export function mountAiPage(page, { make, on, sessions, send, stop }) {
  const button = label => make('button', { type: 'button' }, label);
  const toolbar = make('div', { class: 'fated-actions' });
  const select = make('select', { 'aria-label': '切换会话' });
  const create = button('新建'), rename = button('重命名'), remove = button('删除'), clear = button('清空当前会话');
  toolbar.append(select, create, rename, remove, clear);
  const edit = make('form', { class: 'fated-actions', hidden: '' });
  const title = make('input', { 'aria-label': '会话名称', maxlength: '80', required: '' });
  const cancel = button('取消');
  edit.append(title, make('button', { type: 'submit' }, '保存名称'), cancel);
  const info = make('p', { class: 'fated-ai-info' });
  const log = make('div', { class: 'fated-ai-log', role: 'log', 'aria-label': '消息流', tabindex: '0' });
  const composer = make('form', { class: 'fated-chat' });
  const input = make('textarea', { rows: '3', 'aria-label': '输入消息', placeholder: '输入消息 · Shift+Enter 换行' });
  const submit = make('button', { type: 'submit' }, '发送');
  const abort = button('停止');
  const status = make('span', { role: 'status' });
  composer.append(input, submit, abort, status);
  page.append(make('h3', {}, '辅助 AI'), toolbar, edit, info, log, composer);

  let shownId, busy = false, pinned = true;
  const rows = new Map(), drafts = new Map();
  function scrollToEnd() { if (pinned && log.clientHeight) log.scrollTop = log.scrollHeight; }

  function updateMessage(message) {
    let row = rows.get(message);
    if (!row) {
      const bubble = make('article', { class: 'fated-ai-message', 'data-role': message.role });
      const heading = make('header', {}, roleLabels[message.role] ?? message.role);
      const time = make('time', { datetime: new Date(message.ts).toISOString() }, formatTime(message.ts));
      const badge = make('span');
      heading.append(time, badge);
      const body = make('div', { class: 'fated-ai-body' });
      bubble.append(heading, body);
      log.append(bubble);
      row = { bubble, badge, body };
      rows.set(message, row);
    }
    row.bubble.dataset.status = message.status ?? '';
    row.badge.textContent = statusLabels[message.status] ?? '';
    row.body.replaceChildren();
    if (message.role === 'assistant') renderMarkdown(row.body, message.content, make);
    else row.body.textContent = [message.toolName, message.content, message.toolResult == null ? '' :
      typeof message.toolResult === 'string' ? message.toolResult : JSON.stringify(message.toolResult, null, 2)].filter(Boolean).join('\n');
  }

  function render() {
    const session = sessions.active();
    select.replaceChildren(...sessions.data.sessions.map(s => make('option', { value: s.id }, s.title)));
    select.value = session.id;
    if (shownId !== session.id) {
      shownId = session.id;
      edit.hidden = true;
      input.value = drafts.get(shownId) ?? '';
      pinned = true;
    }
    rows.clear();
    log.replaceChildren();
    for (const message of session.messages) updateMessage(message);
    refresh();
  }

  function refresh() {
    const session = sessions.active();
    info.textContent = `${session.messages.length} 条消息 · 创建于 ${formatTime(session.createdAt)}`;
    submit.disabled = busy || !input.value.trim();
    remove.disabled = clear.disabled = busy;
    abort.hidden = !busy;
    status.textContent = busy ? 'AI 正在回复…' : '';
    scrollToEnd();
  }

  function submitMessage() {
    const value = input.value.trim();
    if (busy || !value) return;
    input.value = '';
    drafts.delete(shownId);
    pinned = true;
    send(value);
    refresh();
  }

  on(log, 'scroll', () => { pinned = log.scrollHeight - log.clientHeight - log.scrollTop <= 24; });
  on(select, 'change', () => { sessions.select(select.value); render(); });
  on(create, 'click', () => { sessions.create(); render(); input.focus(); });
  on(rename, 'click', () => { title.value = sessions.active().title; edit.hidden = false; title.focus(); title.select(); });
  on(cancel, 'click', () => { edit.hidden = true; });
  on(edit, 'submit', event => { event.preventDefault(); if (!title.value.trim()) return; sessions.rename(shownId, title.value); edit.hidden = true; render(); });
  on(remove, 'click', () => { drafts.delete(shownId); sessions.remove(shownId); render(); });
  on(clear, 'click', () => { sessions.clear(shownId); render(); });
  on(abort, 'click', stop);
  on(input, 'input', () => { drafts.set(shownId, input.value); refresh(); });
  on(input, 'keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submitMessage();
  });
  on(composer, 'submit', event => { event.preventDefault(); submitMessage(); });
  render();

  return {
    show: scrollToEnd,
    setBusy(value) { busy = value; refresh(); },
    feed(id, ...messages) {
      if (id !== shownId) return;
      for (const message of messages) updateMessage(message);
      refresh();
    },
  };
}
