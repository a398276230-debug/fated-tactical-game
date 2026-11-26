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
export const TAVERN_VERSION = '0.5.2';

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
export function isQuotaExceededError(error) {
  return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error?.code === 22 || error?.code === 1014;
}

export function putConfig(storage, key, value, onError) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { onError?.(error); return false; }
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

const floorNodes = doc => [...(doc?.querySelectorAll?.('.mes, .chat-msg, [data-message-id], [data-mesid]') ?? [])];
const floorId = node => ['mesid', 'data-message-id', 'data-mesid'].map(key => node.getAttribute(key))
  .map(id => text(id).trim()).find(Boolean);

export async function tavernMessages(host) {
  const messages = await readChatMessages(host);
  if (messages.length) return messages;
  return floorNodes(hostDocument(host)).map((node, index) => {
    const content = node.querySelector('.mes_text, .message, [data-content]')?.textContent || node.textContent;
    const pre = node.querySelector('.fated-battle-source')?.textContent ?? '';
    const battle = extractTag(pre, ['battle_init']) || pre;
    return {
      message_id: floorId(node) ?? node.dataset?.id ?? `floor-${index}`,
      swipe_id: node.dataset?.swipeId ?? node.dataset?.swipe ?? '0',
      content: battle?.trim() ? `${content}\n<battle_init>${battle}</battle_init>` : content,
    };
  }).filter(item => item.content);
}

export function renderedMinFloorIndex(messages, doc = hostDocument()) {
  const ids = new Set(floorNodes(doc).map(floorId).filter(Boolean));
  return messages.findIndex((message, index) => ids.has(messageMeta(message, index).messageId));
}

const entities = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };
function decodeEntities(value, pattern) {
  return value.replace(pattern, (entity, name) => {
    if (Object.hasOwn(entities, name)) return entities[name];
    const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
const cleanMessage = message => stripMetaAndReasoning(decodeEntities(messageContent(message), /&(lt|gt|quot);/g));
const comparableBattleText = value => decodeEntities(value, /&(#\d+|#[xX][0-9a-fA-F]+|lt|gt|quot|apos|nbsp|amp);/g)
  .replace(/\s+/gu, ' ').replace(/\s*([|,])\s*/gu, '$1').trim();
export function battleEntryIndex(messages, battleText) {
  const expected = comparableBattleText(extractTag(battleText, ['battle_init']) || battleText);
  return expected ? messages.findLastIndex(message => isBattleMessage(message) &&
    comparableBattleText(extractTag(cleanMessage(message), ['battle_init'])) === expected) : -1;
}
const isBattleMessage = message => message?.role !== 'user' && !message?.is_user && message?.role !== 'system' && !message?.is_system;

export function sourceBundle(variables, messages, chat = 'default', preferredMessageId, options) {
  const list = Array.isArray(messages) ? messages : [];
  const latestMessage = list.at(-1);
  const latestFloor = messageContent(latestMessage ?? variables?.latest_floor ?? variables?.latestFloor ?? '');
  const eligible = list.filter((message, index) => isBattleMessage(message) &&
    (preferredMessageId == null || messageMeta(message, index).messageId === String(preferredMessageId)));
  const tags = ['battle_init', 'battle_in', '战术沙盘'];
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
      const wrapped = allText.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\s\S]+)\}/i);
      if (wrapped) battleRaw = wrapped[1].trim();
    }
  }
  let battleInit = null;
  if (battleRaw) {
    try { battleInit = parseBattleInit(battleRaw); }
    catch { battleInit = null; }
  }
  // Tavern may strip XML tags, escape them, or wrap the JSON in markdown.
  // Recover the canonical battle object by shape instead of treating it as a
  // char_info block.
  if (!isObject(battleInit) || (!Array.isArray(battleInit.units) && !Array.isArray(battleInit.participants))) {
    const recovered = battleRaw ? findBattleJSON(battleRaw) : null;
    if (recovered) { battleInit = recovered; battleRaw = JSON.stringify(recovered, null, 2); }
    else if (!isObject(battleInit?.participants) && !battleInit?.roster && !battleInit?.battleId && !battleInit?.id && !battleInit?.title && !battleInit?.sceneTitle) battleInit = null;
  }
  // Parse each opening-source message independently so no tag spans chat floors.
  const renderedMinIndex = options?.minFloorIndex ?? renderedMinFloorIndex(list, options?.document);
  const startIndex = renderedMinIndex >= 0 && renderedMinIndex <= sourceIndex ? renderedMinIndex : 0;
  const charBlocks = list.slice(startIndex, sourceIndex + 1).flatMap(message => extractTags(cleanMessage(message), 'char_info')).reverse();
  const charInfo = charBlocks.flatMap(raw => {
    const value = parseJSON(raw, null);
    return Array.isArray(value) ? value : value ? [value] : [parseLooseYaml(raw)];
  });
  const mvuData = statData(variables) ?? variables ?? {};
  const sourceMessage = battleSource ?? eligible.at(-1);
  const battleKey = battleInit ? battleKeyFor(chat, sourceMessage, battleInit, sourceIndex) : null;
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
