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
  };
}
