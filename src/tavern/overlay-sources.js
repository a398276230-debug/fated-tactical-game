import { battleKeyFor, extractTag, extractTags, findBattleJSON, messageContent, messageMeta, parseLooseYaml, stripMetaAndReasoning } from './overlay-ai.js';
import { parseBattleInit } from './converter.js';
import { normalizationLimits } from './normalization-batches.js';
import { hostMethod, readChatMessages, statData } from './host.js';
import { describeSlots } from './prompts.js';
import { deepClone, deepMerge, isObject } from './mvu-utils.js';

function hostWindow() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  try { return w.parent && w.parent.document ? w.parent : w; } catch (_) { return w; }
}
function hostDocument(preferred) {
  const w = preferred || hostWindow();
  try { return w.document || document; } catch (_) { return typeof document !== 'undefined' ? document : null; }
}
function getGlobal(host, name) {
  try { return host?.[name] ?? globalThis?.[name]; } catch (_) { return undefined; }
}
function text(value) { return value == null ? '' : String(value); }
function parseJSON(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
export const TAVERN_VERSION = '0.4.7';

export const LARGE_CONFIG_KEYS = ['charSnapshots', 'normalizationBatches', 'narrativeExemptions', 'unresolvedNotes'];
export const separateConfigKey = (key, field) => `${key}/${field}`;
const DEFAULT_CONFIG = {
  apiMode: 'tavern', baseUrl: '', apiKey: '', model: '', temperature: 0.8, max_tokens: 32000,
  normalizationAiMode: 'same', normalizationAiBaseUrl: '', normalizationAiApiKey: '', normalizationAiModel: '',
  normalizationAiApiTransport: 'direct', normalizationAiApiSource: 'openai',
  battleAiEnabled: false, battleAiMode: 'same', battleAiBaseUrl: '', battleAiApiKey: '', battleAiModel: '', battleAiApiTransport: 'direct', battleAiApiSource: 'openai',
  extraBody: '{}', excludeParams: '', headers: '{}', hideLauncher: false, autoScan: true, autoDeliverBattleReport: true, mvuWritebackMode: 'confirm',
  charSnapshots: {}, rosterSelection: null, normalizationBatches: {}, narrativeExemptions: {}, unresolvedNotes: {},
  ...Object.fromEntries(Object.entries(normalizationLimits).map(([key, { fallback }]) => [key, fallback])),
  slots: describeSlots(), extraText: '', aiSessions: { sessions: [], activeId: null }, debugPrompts: false, apiSource: 'openai', stream: true, timeoutMs: 240000,
};
export function configFor(storage, key) {
  try {
    const saved = parseJSON(storage?.getItem(key), {});
    const settings = Object.fromEntries(Object.entries(saved ?? {}).filter(([field]) =>
      field !== 'instances' && field !== 'aiSessions' && field !== 'nonCombatPersistenceScope' && !LARGE_CONFIG_KEYS.includes(field)));
    const separateSessions = parseJSON(storage?.getItem(`${key}/ai-sessions`), null);
    const separateLarge = Object.fromEntries(LARGE_CONFIG_KEYS.flatMap(field => {
      const value = parseJSON(storage?.getItem(separateConfigKey(key, field)), null);
      return value == null ? [] : [[field, value]];
    }));
    const mode = saved?.apiMode ?? (saved?.baseUrl ? 'direct' : 'tavern');
    return deepMerge(DEFAULT_CONFIG, {
      ...settings,
      ...separateLarge,
      ...(separateSessions ? { aiSessions: separateSessions } : {}),
      apiMode: mode === 'direct' ? 'custom' : mode,
      slots: describeSlots(saved?.slots),
    });
  } catch { return deepClone(DEFAULT_CONFIG); }
}
export function putConfig(storage, key, value) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function chatId(host) {
  try {
    const id = hostMethod(host, 'getChatId')?.() ?? getGlobal(host, 'SillyTavern')?.getContext?.()?.chatId;
    if (id != null) return String(id);
  } catch { /* fallback */ }
  return text(host?.location?.pathname || 'default').replace(/[^\w.-]+/g, '_') || 'default';
}
export function tavernIdentity(host) {
  const helper = getGlobal(host, 'TavernHelper');
  const st = getGlobal(host, 'SillyTavern');
  const context = (() => { try { return st?.getContext?.() || {}; } catch (_) { return {}; } })();
  const candidates = [
    context.name1, context.personaName, context.persona_name, context.persona?.name,
    getGlobal(host, 'personaName'),
  ];
  for (const value of candidates) if (typeof value === 'string' && value.trim()) return value.trim();
  for (const fn of [hostMethod(host, 'getPersonaName')]) {
    try { const value = typeof fn === 'function' ? fn.call(helper) : ''; if (typeof value === 'string' && value.trim()) return value.trim(); } catch (_) {}
  }
  return '';
}

export async function tavernMessages(host) {
  const messages = await readChatMessages(host);
  if (messages.length) return messages;
  const doc = hostDocument(host);
  const nodes = doc ? [...doc.querySelectorAll('.mes, .chat-msg, [data-message-id], [data-mesid]')] : [];
  return nodes.map((node, index) => ({
    message_id: node.getAttribute('mesid') ?? node.dataset.messageId ?? node.dataset.mesid ?? node.dataset.id ?? `floor-${index}`,
    swipe_id: node.dataset.swipeId ?? node.dataset.swipe ?? '0',
    content: node.querySelector('.mes_text, .message, [data-content]')?.textContent || node.textContent,
  })).filter(item => item.content);
}

export function sourceBundle(variables, messages, chat = 'default', preferredMessageId) {
  const list = Array.isArray(messages) ? messages : [];
  const latestMessage = list.at(-1);
  const latestFloor = messageContent(latestMessage ?? variables?.latest_floor ?? variables?.latestFloor ?? '');
  const eligible = list.filter(message => message?.role !== 'user' && !message?.is_user && message?.role !== 'system' && !message?.is_system &&
    (preferredMessageId == null || messageMeta(message).messageId === String(preferredMessageId)));
  const tags = ['battle_init', 'battle_in', '战术沙盘'];
  const cleanMessage = message => stripMetaAndReasoning(messageContent(message)
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
  const battleSource = eligible.findLast(message => extractTag(cleanMessage(message), tags));
  const sourceIndex = battleSource ? list.indexOf(battleSource) : list.length - 1;
  const allText = cleanMessage(battleSource ?? eligible.at(-1));
  let battleRaw = extractTag(allText, tags);
  // Some older prompt routes emit a marker without a closing marker, e.g.
  // `{battle_in}: {"participants": [...]}`. Keep this compatibility path
  // bounded to the known marker names and let JSON/YAML parsing reject noise.
  if (!battleRaw) {
    const legacy = allText.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*[:：]?\s*([\s\S]+)/i);
    if (legacy) battleRaw = legacy[1].trim();
    else {
      const wrapped = allText.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\\s\\S]+)\}/i);
      if (wrapped) battleRaw = wrapped[1].trim();
    }
  }
  let battleInit = battleRaw ? parseBattleInit(battleRaw) : null;
  // Tavern may strip XML tags, escape them, or wrap the JSON in markdown.
  // Recover the canonical battle object by shape instead of treating it as a
  // char_info block.
  if (!isObject(battleInit) || (!Array.isArray(battleInit.units) && !Array.isArray(battleInit.participants))) {
    const recovered = battleRaw ? findBattleJSON(battleRaw) : null;
    if (recovered) { battleInit = recovered; battleRaw = JSON.stringify(recovered, null, 2); }
  }
  // Parse each opening-source message independently so no tag spans chat floors.
  const charBlocks = list.slice(0, sourceIndex + 1).flatMap(message => extractTags(cleanMessage(message), 'char_info')).reverse();
  const charInfo = charBlocks.flatMap(raw => {
    const value = parseJSON(raw, null);
    return Array.isArray(value) ? value : value ? [value] : [parseLooseYaml(raw)];
  });
  const mvuData = statData(variables) ?? variables ?? {};
  const sourceMessage = battleSource ?? eligible.at(-1);
  const battleKey = battleInit ? battleKeyFor(chat, sourceMessage, battleInit) : null;
  return { mvuData, latestFloor: battleSource ? messageContent(battleSource) : latestFloor, battleInit, charInfo, battleRaw, protagonistName: '', battleKey,
    source: sourceMessage ? { ...messageMeta(sourceMessage, sourceIndex), chatId: chat } : null };
}

export function sourceMessageRange(messages, source) {
  const list = Array.isArray(messages) ? messages : [];
  const index = source ? list.indexOf(source) : -1;
  return index < 0 ? [] : list.slice(0, index + 1);
}

export function sourceSummary(bundle = {}) {
  return {
    battleKey: bundle.battleKey ?? null,
    messageId: bundle.source?.messageId ?? null,
    swipeId: bundle.source?.swipeId ?? null,
    protagonistName: bundle.protagonistName ?? '',
    hasBattleInit: Boolean(bundle.battleInit),
    charCount: Array.isArray(bundle.charInfo) ? bundle.charInfo.length : 0,
  };
}
