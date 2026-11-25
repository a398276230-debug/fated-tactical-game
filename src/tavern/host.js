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

const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const clone = value => {
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};
const safeKey = key => key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
const pathParts = path => {
  if (path === '') return [];
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`无效的 JSON Pointer：${path}`);
  return path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
};
function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left == null || right == null) return false;
  if (typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, i) => deepEqual(value, right[i]));
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => own(right, key) && deepEqual(left[key], right[key]));
}

/** Apply the small, strict RFC 6902 subset accepted by the MVU write bridge. */
function applyRfc6902(target, patch) {
  if (!Array.isArray(patch)) throw new TypeError('MVU 写回补丁必须是 RFC 6902 数组');
  const result = clone(target);
  const fail = (message, code = 'INVALID_PATCH') => { const error = new Error(message); error.code = code; throw error; };
  for (const operation of patch) {
    const op = operation?.op;
    if (!['add', 'remove', 'replace', 'test'].includes(op)) fail(`不支持的 MVU 补丁操作：${op ?? '缺少 op'}`);
    const parts = pathParts(operation.path);
    if (!parts.every(safeKey)) fail(`MVU 补丁路径包含受保护键：${operation.path}`);
    if (!parts.length) {
      if (op === 'test') {
        if (!deepEqual(result, operation.value)) fail(`MVU 补丁 test 未通过：${operation.path}`, 'PATCH_TEST_FAILED');
        continue;
      }
      if (op === 'remove') fail('MVU 补丁不能 remove 根对象');
      if (op === 'add' || op === 'replace') { Object.assign(result, clone(operation.value)); continue; }
    }
    const last = parts.pop();
    let parent = result;
    for (const key of parts) {
      if (parent == null || typeof parent !== 'object' || !own(parent, key)) fail(`MVU 补丁路径不存在：${operation.path}`);
      parent = parent[key];
    }
    if (parent == null || typeof parent !== 'object') fail(`MVU 补丁路径不可写：${operation.path}`);
    const array = Array.isArray(parent);
    const index = array && last !== '-' && /^(0|[1-9]\d*)$/.test(last) ? Number(last) : -1;
    const exists = array ? index >= 0 && index < parent.length : own(parent, last);
    if (op === 'test') {
      if (!exists || !deepEqual(parent[last], operation.value)) fail(`MVU 补丁 test 未通过：${operation.path}`, 'PATCH_TEST_FAILED');
    } else if (op === 'remove') {
      if (!exists) fail(`MVU 补丁路径不存在：${operation.path}`);
      if (array) parent.splice(index, 1); else delete parent[last];
    } else if (op === 'replace') {
      if (!exists) fail(`MVU 补丁路径不存在：${operation.path}`);
      parent[last] = clone(operation.value);
    } else if (array) {
      if (last === '-') parent.push(clone(operation.value));
      else if (index >= 0 && index <= parent.length) parent.splice(index, 0, clone(operation.value));
      else fail(`MVU 数组索引无效：${operation.path}`);
    } else {
      parent[last] = clone(operation.value);
    }
  }
  return result;
}

function messageSwipeId(host, messageId, envelope) {
  const direct = envelope?.swipe_id ?? envelope?.swipeId ?? envelope?.message?.swipe_id;
  if (direct != null) return Number(direct);
  try {
    const message = host?.SillyTavern?.getContext?.()?.chat?.[messageId];
    const value = message?.swipe_id;
    return value == null ? null : Number(value);
  } catch { return null; }
}

function messageVariables(message) {
  const variables = message?.variables;
  if (Array.isArray(variables)) return variables[message?.swipe_id ?? 0] ?? null;
  return variables ?? null;
}

async function exactEnvelope(host, messageId) {
  if (!Number.isInteger(Number(messageId)) || Number(messageId) < 0) throw new Error(`无效的 MVU 楼层：${messageId}`);
  const id = Number(messageId);
  const readers = [];
  for (const scope of hostScopes(host)) {
    try {
      if (typeof scope.Mvu?.getMvuData === 'function') readers.push(scope.Mvu.getMvuData.bind(scope.Mvu));
    } catch { /* bridge unavailable */ }
  }
  const helper = hostMethod(host, 'getVariables');
  if (helper) readers.push(helper);
  for (const read of readers) {
    try {
      const envelope = await read({ type: 'message', message_id: id });
      if (statData(envelope)) return { envelope, statData: statData(envelope), swipeId: messageSwipeId(host, id, envelope) };
    } catch { /* try the next exact-floor driver */ }
  }
  try {
    const context = host?.SillyTavern?.getContext?.();
    const message = context?.chat?.[id];
    const variables = messageVariables(message);
    if (statData(variables)) return { envelope: variables, statData: statData(variables), swipeId: message?.swipe_id == null ? null : Number(message.swipe_id), nativeMessage: message, context };
  } catch { /* no native context */ }
  throw new Error(`找不到楼层 ${id} 的 MVU stat_data`);
}

/** Read exactly one floor. Unlike readBattleVariables this never falls back to floor -1. */
export async function readWritebackTarget(host, messageId) {
  const target = await exactEnvelope(host, messageId);
  return { statData: clone(target.statData), swipeId: target.swipeId };
}

export async function readBattleVariables(host, messageId) {
  try { return (await readWritebackTarget(host, messageId)).statData; } catch { return {}; }
}

/** Report which write bridge will be used, without mutating the host. */
export function probeMvuWriteCapability(host) {
  let busy = false;
  for (const scope of hostScopes(host)) {
    try { if (scope.Mvu?.isDuringExtraAnalysis?.() === true) busy = true; } catch { /* unavailable */ }
  }
  for (const scope of hostScopes(host)) {
    try {
      if (typeof scope.Mvu?.replaceMvuData === 'function') return { writable: !busy, driver: 'mvu', busy };
    } catch { /* bridge unavailable */ }
  }
  if (hostMethod(host, 'updateVariablesWith')) return { writable: !busy, driver: 'tavern_helper_updater', busy };
  if (hostMethod(host, 'replaceVariables')) return { writable: !busy, driver: 'tavern_helper_replace', busy };
  try {
    if (typeof host?.SillyTavern?.getContext === 'function') return { writable: !busy, driver: 'st_context', busy };
  } catch { /* bridge unavailable */ }
  return { writable: false, driver: 'none', busy };
}

function mismatch(code, message) { return { ok: false, code, message }; }

/**
 * Apply a battle patch to one exact message/swipe. The target is checked before
 * selecting a driver, so a helper that silently uses the active swipe cannot
 * overwrite a different branch.
 */
export async function writeBattleVariables(host, { messageId, expectedSwipeId, patch = [], expectedStatData } = {}) {
  const target = await exactEnvelope(host, messageId);
  if (expectedSwipeId != null && target.swipeId != null && Number(expectedSwipeId) !== Number(target.swipeId)) {
    return mismatch('SWIPE_MISMATCH', '触发战斗的楼层已切换至其他 Swipe 分支，已阻止跨分支覆盖变量');
  }
  if (expectedStatData !== undefined && !deepEqual(target.statData, expectedStatData)) {
    return mismatch('STAT_DATA_MISMATCH', '目标楼层 MVU 已发生变化，已阻止覆盖并发更新');
  }
  let patched;
  try { patched = applyRfc6902({ stat_data: clone(target.statData) }, patch).stat_data; }
  catch (error) {
    if (error?.code === 'PATCH_TEST_FAILED') return mismatch('PATCH_TEST_FAILED', error.message);
    throw error;
  }
  const id = Number(messageId), options = { type: 'message', message_id: id }, errors = [];
  for (const scope of hostScopes(host)) {
    try {
      if (typeof scope.Mvu?.isDuringExtraAnalysis === 'function' && scope.Mvu.isDuringExtraAnalysis()) {
        const error = new Error('MVU 正在执行变量解析，请稍候再试'); error.code = 'MVU_BUSY'; throw error;
      }
    } catch (error) { if (error?.code === 'MVU_BUSY') throw error; }
  }
  for (const scope of hostScopes(host)) {
    try {
      if (typeof scope.Mvu?.replaceMvuData !== 'function') continue;
      const current = await scope.Mvu.getMvuData({ type: 'message', message_id: id });
      if (!statData(current)) continue;
      const next = { ...clone(current), stat_data: patched };
      await scope.Mvu.replaceMvuData(next, options);
      return { ok: true, driver: 'mvu', messageId: id, swipeId: target.swipeId, statData: clone(patched) };
    } catch (error) { errors.push(error); }
  }
  const updater = hostMethod(host, 'updateVariablesWith');
  if (updater) {
    try {
      await updater(variables => ({ ...clone(variables ?? {}), stat_data: patched }), options);
      return { ok: true, driver: 'tavern_helper_updater', messageId: id, swipeId: target.swipeId, statData: clone(patched) };
    } catch (error) { errors.push(error); }
  }
  const replacer = hostMethod(host, 'replaceVariables');
  if (replacer) {
    try {
      const current = await (hostMethod(host, 'getVariables')?.(options) ?? target.envelope);
      const next = { ...clone(current ?? {}), stat_data: patched };
      await replacer(next, options);
      return { ok: true, driver: 'tavern_helper_replace', messageId: id, swipeId: target.swipeId, statData: clone(patched) };
    } catch (error) { errors.push(error); }
  }
  try {
    const context = host?.SillyTavern?.getContext?.(), message = context?.chat?.[id];
    if (!message) throw new Error(`找不到楼层 ${id}`);
    const swipe = message.swipe_id ?? 0;
    if (expectedSwipeId != null && Number(expectedSwipeId) !== Number(swipe)) return mismatch('SWIPE_MISMATCH', '触发战斗的楼层已切换至其他 Swipe 分支，已阻止跨分支覆盖变量');
    if (Array.isArray(message.variables)) {
      const nextVariables = clone(message.variables);
      nextVariables[swipe] = { ...(nextVariables[swipe] ?? {}), stat_data: patched };
      message.variables = nextVariables;
    } else message.variables = { ...(message.variables ?? {}), stat_data: patched };
    if (id === context.chat.length - 1 && statData(context.chatMetadata?.variables)) {
      context.chatMetadata.variables = { ...clone(context.chatMetadata.variables), stat_data: clone(patched) };
    }
    const save = context.saveChatConditional ?? context.saveChat;
    if (typeof save !== 'function') throw new Error('SillyTavern 没有可用的保存接口');
    await save.call(context);
    return { ok: true, driver: 'st_context', messageId: id, swipeId: Number(swipe), statData: clone(patched) };
  } catch (error) { errors.push(error); }
  return { ok: false, code: 'NO_WRITE_DRIVER', message: errors.at(-1)?.message ?? '没有可用的 MVU 写回接口', errors };
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
