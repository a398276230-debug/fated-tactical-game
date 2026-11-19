// The script iframe and its parent can expose different Tavern Helper globals.
export function hostScopes(host, local = globalThis) {
  const scopes = new Set([local, host]);
  for (const window of [...scopes]) {
    try { if (window?.TavernHelper) scopes.add(window.TavernHelper); } catch { /* cross-origin parent */ }
  }
  return [...scopes].filter(Boolean);
}

export function hostMethod(host, name) {
  for (const scope of hostScopes(host)) {
    try { if (typeof scope[name] === 'function') return scope[name].bind(scope); } catch { /* bridge unavailable */ }
  }
  return null;
}

export function statData(variables) {
  const data = variables?.stat_data ?? variables?.statData ?? variables?.message?.stat_data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

export async function readBattleVariables(host, messageId) {
  const ids = [...new Set([messageId, -1].filter(id => Number.isInteger(id)))];
  const readers = hostScopes(host).flatMap(scope => {
    try { return typeof scope.Mvu?.getMvuData === 'function' ? [scope.Mvu.getMvuData.bind(scope.Mvu)] : []; }
    catch { return []; }
  });
  const helper = hostMethod(host, 'getVariables');
  if (helper) readers.push(helper);
  for (const id of ids) {
    for (const read of readers) {
      try {
        const data = statData(await read({ type: 'message', message_id: id }));
        if (data && Object.keys(data).length) return data;
      } catch { /* missing or uninitialized message variables */ }
    }
  }
  try {
    const context = host?.SillyTavern?.getContext?.();
    for (const id of ids) {
      const message = context?.chat?.at(id);
      const variables = message?.variables;
      const data = statData(Array.isArray(variables) ? variables[message.swipe_id ?? 0] : variables);
      if (data && Object.keys(data).length) return data;
    }
    return statData(context?.chatMetadata?.variables) ?? statData(context?.chatMetadata) ?? {};
  } catch { return {}; }
}

export async function readChatMessages(host) {
  const getMessages = hostMethod(host, 'getChatMessages');
  const getLastId = hostMethod(host, 'getLastMessageId');
  if (getMessages) {
    try {
      const last = getLastId ? await getLastId() : -1;
      const messages = await getMessages(last >= 0 ? `0-${last}` : '0-{{lastMessageId}}', { include_swipes: false });
      if (Array.isArray(messages) && messages.length) return messages;
    } catch { /* fall back to the native chat array */ }
  }
  try {
    const chat = host?.SillyTavern?.getContext?.()?.chat;
    if (Array.isArray(chat) && chat.length) return chat.map((message, message_id) => ({ ...message, message_id }));
  } catch { /* no native chat */ }
  return [];
}
