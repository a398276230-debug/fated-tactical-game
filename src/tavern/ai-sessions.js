const roles = new Set(['user', 'assistant', 'system', 'tool']);

export function createAiSessions(saved, persist, now = Date.now) {
  const data = { sessions: Array.isArray(saved?.sessions) ? structuredClone(saved.sessions) : [], activeId: saved?.activeId };
  const get = id => data.sessions.find(session => session.id === id);
  const active = () => get(data.activeId);
  const save = () => persist(data);
  let lastId = 0;

  function create(title = '新建会话') {
    const ts = now();
    do { lastId = Math.max(ts, lastId + 1); } while (get(`sess_${lastId}`));
    const session = { id: `sess_${lastId}`, title, createdAt: ts, updatedAt: ts, messages: [] };
    data.sessions.push(session);
    data.activeId = session.id;
    return session;
  }

  if (!active()) {
    const first = data.sessions[0] ?? create();
    data.activeId = first.id;
  }

  function change(session) {
    session.updatedAt = now();
    save();
  }

  const historyBefore = (session, index) => session.messages.slice(0, index).filter(message =>
    ['user', 'assistant'].includes(message.role) && message.content?.trim() && !['error', 'aborted'].includes(message.status)
  ).map(({ role, content }) => ({ role, content }));
  const blankReply = () => ({ ts: now(), role: 'assistant', content: '' });
  const versionOf = ({ versions, versionIndex, ...reply }) => reply;

  return {
    data, active, get,
    create() { const session = create(); save(); return session; },
    select(id) { if (get(id)) { data.activeId = id; save(); } },
    rename(id, title) {
      const session = get(id);
      if (!session || !title.trim()) return;
      session.title = title.trim();
      change(session);
    },
    remove(id) {
      const index = data.sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      data.sessions.splice(index, 1);
      if (data.activeId === id) data.activeId = (data.sessions[Math.min(index, data.sessions.length - 1)] ?? create()).id;
      save();
    },
    clear(id) {
      const session = get(id);
      if (!session) return;
      session.messages.length = 0;
      change(session);
    },
    append(id, ...messages) {
      const session = get(id);
      if (!session) return [];
      const entries = messages.map(message => {
        if (!roles.has(message.role)) throw new TypeError(`未知消息角色：${message.role}`);
        return { ts: now(), ...message };
      });
      session.messages.push(...entries);
      change(session);
      return entries;
    },
    update(id, message, fields) {
      const session = get(id);
      if (!session?.messages.includes(message)) return;
      Object.assign(message, fields);
      change(session);
    },
    prepareReroll(id, targetAssistantMessage) {
      const session = get(id);
      const idx = session?.messages.indexOf(targetAssistantMessage) ?? -1;
      if (idx < 0 || targetAssistantMessage.role !== 'assistant') return null;
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (session.messages[i].role === 'user') { userIdx = i; break; }
      }
      if (userIdx < 0) return null;
      const historyBeforeUser = historyBefore(session, userIdx);
      const versions = [...(targetAssistantMessage.versions ?? [])];
      versions[targetAssistantMessage.versionIndex ?? 0] = versionOf(targetAssistantMessage);
      const versionIndex = versions.length;
      versions.push(null);
      const assistantMessage = { ...blankReply(), versions, versionIndex };
      session.messages[idx] = assistantMessage;
      change(session);
      return { userMessage: session.messages[userIdx], assistantMessage, historyBeforeUser };
    },
    selectVersion(id, message, index) {
      const session = get(id);
      const slot = session?.messages.indexOf(message) ?? -1;
      if (slot < 0 || !message.versions?.[index] || message.versionIndex === index) return;
      const versions = [...message.versions];
      versions[message.versionIndex] = versionOf(message);
      const selected = versions[index];
      versions[index] = null;
      session.messages[slot] = { ...selected, versions, versionIndex: index };
      change(session);
    },
    prepareEdit(id, message, input) {
      const session = get(id);
      const index = session?.messages.findLastIndex(entry => entry.role === 'user') ?? -1;
      const content = input.trim();
      if (index < 0 || session.messages[index] !== message || !content) return null;
      if (session.messages.slice(index + 1).some(reply => reply.undoReceipt || reply.versions?.some(version => version?.undoReceipt))) {
        throw new Error('请先撤销此轮回复已应用的补丁，再编辑提问');
      }
      const historyBeforeUser = historyBefore(session, index);
      const assistantMessage = blankReply();
      message.content = content;
      session.messages.splice(index + 1, Infinity, assistantMessage);
      change(session);
      return { userMessage: message, assistantMessage, historyBeforeUser };
    },
  };
}
