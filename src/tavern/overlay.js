import { resolvedDiagnostics, remainingDiagnostics, warningKey } from './resolved-warnings.js';
import { hydrateFromSources as hydrateBattleState, parseBattleInit, parseSimpleYaml, warningsForUnit } from './converter.js';
import { mount as defaultMount } from '../ui/mount.js';
import { validateState as defaultValidateState } from '../api/validation.js';
import { refreshOpeningInitiative, refreshOutcome, syncEquipmentEffects } from '../core/combat.js';
import { hostMethod, readBattleVariables, readChatMessages, statData } from './host.js';
import { tavernTheme } from './theme.js';
import { assembleMessages, describeSlots } from './prompts.js';
import { requestViaTavern, requestViaCustomApi } from './api.js';
import { renderSettings } from './settings.js';
import { createAiSessions } from './ai-sessions.js';
import { characterRecords } from './char-snapshots.js';
import { fillInstance } from './instance-card.js';
import { mountAiPage } from './ai-page.js';

/*
 * Tavern integration.  This file deliberately has no dependency on SillyTavern: it
 * can be loaded from an iframe, from a normal web page, or from a test DOM.  The
 * game and converter are supplied by the library entry point (or by options).
 */

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const safeProperty = key => !['__proto__', 'prototype', 'constructor'].includes(key);
const clone = value => {
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

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
function safeStorage(host) {
  try { return host.localStorage; } catch (_) { return null; }
}
function text(value) { return value == null ? '' : String(value); }
function el(doc, tag, attrs, content) {
  const n = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') n.className = value;
    else if (key === 'style') n.style.cssText = value;
    else if (key === 'text') n.textContent = value;
    else if (value != null) n.setAttribute(key, value);
  }
  if (content != null) n.textContent = content;
  return n;
}
function parseJSON(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function balancedJSONObjects(source) {
  const value = text(source).replaceAll('&quot;', '"').replaceAll('&#34;', '"');
  const results = [];
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < value.length; i++) {
      const ch = value[i];
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        const parsed = parseJSON(value.slice(start, i + 1), null);
        if (parsed) results.push(parsed);
        break;
      }
    }
  }
  return results;
}
function findBattleJSON(source) {
  return balancedJSONObjects(source).reverse().find(value => isObject(value) && (Array.isArray(value.units) || Array.isArray(value.participants) || value.battleId || value.title || value.sceneTitle)) || null;
}
function deepMerge(base, extra) {
  const result = isObject(base) ? clone(base) : {};
  if (!isObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (!safeProperty(key)) continue;
    if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}
function deletePath(object, path) {
  if (!path) return;
  const parts = String(path).trim().replace(/^\$\.?/, '').split('.').filter(Boolean);
  if (!parts.length || !parts.every(safeProperty)) return;
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts.at(-1)];
}
function excludedList(value) {
  if (Array.isArray(value)) return value.flatMap(excludedList);
  if (typeof value !== 'string') return [];
  return value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
}

/** Build an OpenAI-compatible request without mutating user configuration. */
export function buildAIRequest(config = {}, messages = []) {
  const body = deepMerge({
    model: config.model || '', messages: clone(messages),
    ...(config.temperature !== '' && config.temperature != null ? { temperature: Number(config.temperature) } : {}),
    ...(config.max_tokens !== '' && config.max_tokens != null ? { max_tokens: Number(config.max_tokens) } : {}),
  }, parseJSON(config.extraBody ?? config.additionalBody ?? config.body, {}));
  for (const path of excludedList(config.excludeParams ?? config.excludedParams ?? config.excludeBodyParams)) deletePath(body, path);
  const headers = { 'Content-Type': 'application/json', ...parseJSON(config.headers ?? config.extraHeaders ?? config.additionalHeaders ?? config.requestHeaders, {}) };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let url = text(config.baseUrl || config.url || '').trim();
  if (!url) url = '/v1/chat/completions';
  const [endpoint, query] = url.split(/\?(.*)/s, 2);
  const path = endpoint.replace(/\/+$/, '');
  url = (/\/chat\/completions$/.test(path) ? path : `${path}/chat/completions`) + (query ? `?${query}` : '');
  return { url, body, headers };
}
export async function requestAI(config, messages, fetchImpl, signal) {
  const request = buildAIRequest(config, messages);
  const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetcher) throw new Error('当前浏览器没有 fetch');
  const response = await fetcher(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal });
  const raw = await response.text();
  const data = parseJSON(raw, { content: raw });
  if (!response.ok) throw new Error(`API ${response.status}: ${data?.error?.message || raw || response.statusText}`);
  return data;
}

function messageContent(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  return text(message.content ?? message.message ?? message.text ?? message.mes ?? message.data?.content ?? '');
}
function messageMeta(message, index = 0) {
  if (!message || typeof message !== 'object') return { messageId: `floor-${index}`, swipeId: '0' };
  const messageId = message.message_id ?? message.messageId ?? message.mesid ?? message.mesId ?? message.id ?? message.data?.message_id ?? `floor-${index}`;
  const swipeId = message.swipe_id ?? message.swipeId ?? message.swipe_id_string ?? message.swipe ?? message.data?.swipe_id ?? '0';
  return { messageId: String(messageId), swipeId: String(swipeId) };
}
function safeKey(value) { return text(value).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96) || 'unknown';
}
function battleKeyFor(chat, message, battle) {
  const meta = messageMeta(message);
  const explicit = battle?.battleId ?? battle?.id ?? 'unnamed';
  return [safeKey(chat), safeKey(meta.messageId), safeKey(meta.swipeId), safeKey(explicit)].join('__');
}
function extractTag(source, names) {
  const value = text(source);
  for (const name of names) {
    // The legacy world-book routes use {battle_in}/{战术沙盘}, while current
    // prompts use XML. Accept both forms without interpreting arbitrary HTML.
    const re = new RegExp(`(?:<${name}[^>]*>|\\{${name}\\s*\\})([\\s\\S]*?)(?:<\\/${name}>|\\{\\/${name}\\s*\\})`, 'i');
    const match = value.match(re);
    if (match) return match[1].trim();
    const open = new RegExp(`(?:<${name}[^>]*>|\\{${name}\\s*\\})([\\s\\S]*)$`, 'i').exec(value);
    if (open) return open[1].replace(new RegExp(`(?:<\\/${name}>|\\{\\/${name}\\s*\\})[\\s\\S]*$`, 'i'), '').trim();
  }
  return '';
}
function parseTaggedJSON(source, names) {
  const raw = extractTag(source, names);
  if (!raw) return null;
  return parseJSON(raw, parseJSON(raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim(), null));
}
function extractTags(source, name) {
  const value = text(source), result = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
  for (const match of value.matchAll(re)) result.push(match[1].trim());
  return result;
}
function parseLooseYaml(value) {
  // Keep a local fallback for standalone builds; the converter's safe YAML
  // reader is preferred when it is available.
  try { return parseSimpleYaml(value); } catch (_) { /* use minimal reader below */ }
  // char_info is intentionally a small interoperability format. JSON is always
  // preferred; this parser handles the common flat/nested key: value subset.
  const output = {};
  const lines = text(value).replace(/^```(?:yaml|yml)?\s*|\s*```$/gim, '').split(/\r?\n/);
  const stack = [{ indent: -1, object: output }];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^(\s*)([-\w\u4e00-\u9fff]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length, key = match[2], raw = match[3].trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    let valueOut = raw;
    if (!raw) { valueOut = {}; stack.push({ indent, object: valueOut }); }
    else if (/^(true|false)$/i.test(raw)) valueOut = raw.toLowerCase() === 'true';
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) valueOut = Number(raw);
    else valueOut = parseJSON(raw, raw.replace(/^['"]|['"]$/g, ''));
    stack.at(-1).object[key] = valueOut;
    if (isObject(valueOut)) stack.push({ indent, object: valueOut });
  }
  return output;
}

export function parseAIResponse(value) {
  const source = typeof value === 'object' ? JSON.stringify(value) : text(value);
  const candidates = [];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  candidates.push(...fenced.map(x => x.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()));
  candidates.push(source.trim());
  let parsed = null;
  for (const candidate of candidates) {
    parsed = parseJSON(candidate, null);
    if (parsed) break;
  }
  if (!parsed) {
    const objectMatch = source.match(/\{[\s\S]*\}/);
    parsed = parseJSON(objectMatch?.[0], null);
  }
  const patch = parsed?.battle_patch || parsed?.unit_patch || parsed?.patch ||
    (parsed && (parsed.op || parsed.path || parsed.value) ? parsed : null);
  return { data: parsed, patch, text: source };
}
export function requestTavernAI(host, config, messages, fetchImpl, signal, onStreamChunk) {
  const options = { fetchImpl, signal, onStreamChunk };
  return config.apiMode === 'custom' || config.apiMode === 'direct'
    ? requestViaCustomApi(config, messages, options)
    : requestViaTavern(host, config, messages, options);
}

export function parseJSONPatch(value) {
  const parsed = parseAIResponse(value).data;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.patch)) return parsed.patch;
  if (Array.isArray(parsed?.patches)) return parsed.patches;
  if (Array.isArray(parsed?.jsonPatch)) return parsed.jsonPatch;
  if (Array.isArray(parsed?.battle_patch)) return parsed.battle_patch;
  if (Array.isArray(parsed?.unit_patch)) return parsed.unit_patch;
  if (Array.isArray(parsed?.battlePatch)) return parsed.battlePatch;
  if (Array.isArray(parsed?.unitPatch)) return parsed.unitPatch;
  return null;
}

export { deepMerge, applyPatch };
export const normalizationPath = /^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/;

export const TAVERN_VERSION = '0.2.4';

const DEFAULT_CONFIG = {
  apiMode: 'tavern', baseUrl: '', apiKey: '', model: '', temperature: 0.2, max_tokens: 2400,
  extraBody: '{}', excludeParams: '', headers: '{}', hideLauncher: false, autoScan: true,
  charSnapshots: {}, rosterSelection: null, normalizationBatches: {},
  slots: describeSlots(), extraText: '', aiSessions: { sessions: [], activeId: null }, debugPrompts: false, apiSource: 'openai', stream: true, timeoutMs: 60000,
};
function configFor(storage, key) {
  try {
    const saved = parseJSON(storage?.getItem(key), {});
    const mode = saved?.apiMode ?? (saved?.baseUrl ? 'direct' : 'tavern');
    return deepMerge(DEFAULT_CONFIG, { ...saved, apiMode: mode === 'direct' ? 'custom' : mode, slots: describeSlots(saved?.slots) });
  } catch { return clone(DEFAULT_CONFIG); }
}
function putConfig(storage, key, value) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function chatId(host) {
  try {
    const id = hostMethod(host, 'getChatId')?.() ?? getGlobal(host, 'SillyTavern')?.getContext?.()?.chatId;
    if (id != null) return String(id);
  } catch { /* fallback */ }
  return text(host?.location?.pathname || 'default').replace(/[^\w.-]+/g, '_') || 'default';
}
function tavernIdentity(host) {
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

async function tavernMessages(host) {
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
  const decodeTags = value => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');
  const battleSource = eligible.findLast(message => extractTag(decodeTags(messageContent(message)), tags));
  const sourceIndex = battleSource ? list.indexOf(battleSource) : list.length - 1;
  // Live scans include subsequent char_info updates; historical battle selection stays bounded to its floor.
  const joined = (preferredMessageId == null ? list : list.slice(0, sourceIndex + 1)).map(messageContent).join('\n');
  const allText = decodeTags(messageContent(battleSource ?? eligible.at(-1)));
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
  const charBlocks = extractTags(joined, 'char_info').reverse();
  const charRaw = charBlocks[0] || '';
  const charInfo = charBlocks.flatMap(raw => {
    const value = parseJSON(raw, null);
    return Array.isArray(value) ? value : value ? [value] : [parseLooseYaml(raw)];
  });
  const mvuData = statData(variables) ?? variables ?? {};
  const sourceMessage = battleSource ?? eligible.at(-1);
  const battleKey = battleInit ? battleKeyFor(chat, sourceMessage, battleInit) : null;
  return { mvuData, latestFloor: battleSource ? messageContent(battleSource) : latestFloor, battleInit, charInfo, battleRaw, charRaw, roster: '', protagonistName: '', battleKey,
    source: sourceMessage ? { ...messageMeta(sourceMessage, sourceIndex), chatId: chat } : null };
}

function patchValue(value, table) {
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(value.filter(item => item && (item.id || item.name)).map((item, index) => {
    const normalized = clone(item);
    if (table === 'covers' || table === 'interactives' || table === 'zones') {
      const xyz = normalized.xyz;
      if (Array.isArray(xyz)) { normalized.x = Number(xyz[0] ?? 0); normalized.y = Number(xyz[1] ?? 0); delete normalized.xyz; }
    }
    if (table === 'covers') {
      normalized.name ??= `掩体${index + 1}`; normalized.material ??= '未知材料'; normalized.maxHp ??= normalized.hp ?? 1; normalized.hp ??= normalized.maxHp; normalized.cover ??= normalized.shielding ?? 2;
      for (const key of Object.keys(normalized)) if (!['id','name','x','y','material','hp','maxHp','cover'].includes(key)) delete normalized[key];
    }
    if (table === 'interactives') { normalized.name ??= '互动点'; normalized.kind ??= 'barrel'; normalized.spent ??= false; for (const key of Object.keys(normalized)) if (!['id','name','x','y','kind','spent'].includes(key)) delete normalized[key]; }
    const key = String(normalized.id || normalized.name || index);
    return [key, normalized];
  }));
}
function normalizeSemanticPatch(patch) {
  if (!isObject(patch)) return patch;
  const result = clone(patch);
  for (const key of ['units', 'covers', 'interactives', 'zones', 'items', 'equipment', 'skills']) if (Array.isArray(result[key])) result[key] = patchValue(result[key], key);
  if (isObject(result.unit_patch)) {
    const unitPatch = result.unit_patch;
    const id = unitPatch.unitId || unitPatch.id;
    if (id && isObject(unitPatch.patch)) result.units = { [id]: unitPatch.patch };
  }
  return result;
}
function applyPatch(target, patch, strict = false) {
  let result = clone(target);
  // AI assistants commonly return a semantic battle_patch/unit_patch object
  // rather than RFC 6902 operations. Normalize array tables to engine maps first.
  if (isObject(patch) && !Array.isArray(patch) && !Array.isArray(patch.patch) && !Array.isArray(patch.jsonPatch)) {
    return deepMerge(result, normalizeSemanticPatch(patch.battle_patch || patch));
  }
  const list = Array.isArray(patch) ? patch : patch?.patch || patch?.jsonPatch;
  if (!Array.isArray(list)) return result;
  const pointer = path => String(path || '').split('/').slice(1).map(x => x.replaceAll('~1', '/').replaceAll('~0', '~'));
  for (const operation of list) {
    if (!operation || !operation.op) continue;
    const keys = pointer(operation.path);
    if (!keys.length || !keys.every(safeProperty)) throw new Error('AI 返回了不支持的补丁路径');
    const last = keys.pop();
    let parent = result;
    for (const key of keys) {
      if (!own(parent, key)) throw new Error(`补丁路径不存在：${operation.path}`);
      parent = parent[key];
    }
    if (parent == null || typeof parent !== 'object') throw new Error(`补丁路径不可写：${operation.path}`);
    if (strict) {
      if (Array.isArray(parent)) {
        const append = last === '-' && operation.op === 'add';
        if (!append && (!/^(0|[1-9]\d*)$/.test(last) || Number(last) > parent.length)) throw new Error(`数组索引无效：${operation.path}`);
      }
      if (operation.op !== 'add' && !own(parent, last)) throw new Error(`补丁路径不存在：${operation.path}`);
      if (operation.op === 'add' && Array.isArray(parent) && last !== '-') { parent.splice(Number(last), 0, clone(operation.value)); continue; }
    }
    if (operation.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
    else if (operation.op === 'add' || operation.op === 'replace') { if (Array.isArray(parent) && last === '-') parent.push(clone(operation.value)); else parent[last] = clone(operation.value); }
  }
  return result;
}

function style(doc) {
  const installed = doc.querySelector('style[data-fated-tavern-overlay]');
  if (installed) {
    installed.textContent = tavernTheme;
    return;
  }
  (doc.head || doc.documentElement)?.append(el(doc, 'style', { 'data-fated-tavern-overlay': '' }, tavernTheme));
}

/** Mount the Tavern console. Calling it repeatedly disposes the previous console. */
export function mountTavernOverlay(options = {}) {
  const host = options.host || hostWindow();
  const doc = options.document || hostDocument(host);
  if (!doc || !doc.createElement) return { dispose() {}, open() {}, close() {} };
  try { host.__fatedTacticalTavern?.dispose?.(); } catch (_) { /* stale instance */ }
  style(doc);
  const storage = options.storage || safeStorage(host);
  const id = options.instanceId || chatId(host);
  const configKey = `fated-tactical/tavern/${id}`;
  const stateKey = `fated-tactical/instances/${id}`;
  let config = configFor(storage, configKey);
  const aiSessions = createAiSessions(config.aiSessions, value => persistSettings({ aiSessions: value }));

  let disposed = false, gameMount = null, sources = {}, currentState = null, scanEpoch = 0, activeBattleKey = null;
  let selectedMessageId = null, aiController = null, aiFinished, askAI, retryAI = null, aiPage = null;
  let characters = {}, mountedHashes = {}, scanStatus = '';
  const selectedIds = () => (config.rosterSelection ?? Object.keys(config.instances)).filter(key => own(config.instances,key));
  const batches = key => config.normalizationBatches?.[key] ?? [];
  const operations = key => batches(key).flatMap(batch=>batch.patch);
  let battleObserver = null, removeOpenEvent = null, diagnostics = { phase: 'created' };
  const listeners = [], controller = typeof AbortController === 'function' ? new AbortController() : null;
  const on = (node, event, fn, opts = {}) => { if (!node) return; const options2 = controller ? { ...opts, signal: controller.signal } : opts; node.addEventListener(event, fn, options2); if (!controller) listeners.push(() => node.removeEventListener(event, fn, opts)); };
  const root = el(doc, 'div', { 'data-fated-tavern-overlay': '' });
  const launcher = el(doc, 'button', { class: 'fated-tavern-launcher', title: `打开命定战术控制台 · v${TAVERN_VERSION}`, 'aria-label': `打开命定战术控制台 · v${TAVERN_VERSION}`, type: 'button' }, '🪄');
  const panel = el(doc, 'section', { class: 'fated-tavern-panel', role: 'dialog', 'aria-label': '命定战术酒馆控制台', hidden: '' });
  const header = el(doc, 'header', { class: 'fated-tavern-header' });
  const title = el(doc, 'strong', {}, `命定战术控制台 v${TAVERN_VERSION}`);
  const fullscreen = el(doc, 'button', { type: 'button', class: 'fated-tavern-fullscreen', title: '全屏', 'aria-label': '全屏' }, '□');
  const minimize = el(doc, 'button', { type: 'button', title: '最小化', 'aria-label': '最小化' }, '−');
  const close = el(doc, 'button', { type: 'button', title: '关闭', 'aria-label': '关闭' }, '×');
  const resizeHandle = el(doc, 'span', { class: 'fated-tavern-resize', 'aria-hidden': 'true' });
  header.append(title, fullscreen, minimize, close);
  const tabs = el(doc, 'nav', { class: 'fated-tavern-tabs', role: 'tablist' });
  const content = el(doc, 'div', { class: 'fated-tavern-content' });
  const pages = {};
  for (const [key, label] of [['instances', '📦 实例维护'], ['prompt', '🧩 提示词组装'], ['api', '🔌 API 设置'], ['ai', '🤖 辅助 AI'], ['sandbox', '⚔️ 沙盘']]) {
    const button = el(doc, 'button', { type: 'button', role: 'tab', 'aria-selected': key === 'instances' ? 'true' : 'false', 'data-tab': key }, label);
    const page = el(doc, 'div', { class: `fated-tab ${key === 'instances' ? 'active' : ''}`, 'data-page': key });
    tabs.append(button); content.append(page); pages[key] = page;
    on(button, 'click', () => { Object.entries(pages).forEach(([name, node]) => { node.classList.toggle('active', name === key); }); [...tabs.children].forEach(x => x.setAttribute('aria-selected', String(x === button))); if (key === 'prompt' || key === 'api') renderSettings(page, key, settingsContext()); if (key === 'ai') aiPage?.show(); });
  }
  const toast = el(doc, 'aside', { class: 'fated-toast', hidden: '', role: 'status', 'aria-live': 'polite' });
  const noticeTitle = el(doc, 'strong'), noticeBody = el(doc, 'p');
  const retry = el(doc, 'button', { type: 'button' }, '重试');
  const dismiss = el(doc, 'button', { type: 'button' }, '关闭');
  const icon = el(doc, 'span', { 'aria-hidden': 'true' });
  const heading = el(doc, 'header'); heading.append(icon, noticeTitle);
  const issues = el(doc, 'section', { class: 'fated-toast-issues' });
  const summary = el(doc, 'p', { class: 'fated-toast-summary' });
  const actions = el(doc, 'footer'); actions.append(retry, dismiss);
  toast.append(heading, noticeBody, summary, actions);
  on(retry, 'click', () => retryAI?.());
  on(dismiss, 'click', () => { toast.hidden = true; });
  let rawDetails;
  function notify(title, detail = '', onRetry = null, busy = false, { tone = 'neutral', applied, unresolved = [], raw = '' } = {}) {
    retryAI = onRetry;
    toast.dataset.tone = tone;
    icon.textContent = busy ? '…' : tone === 'success' ? '✓' : tone === 'error' ? '!' : 'ⓘ';
    summary.hidden = applied == null;
    summary.textContent = applied == null ? '' : `已应用 ${applied} 项补丁 · 剩余 ${unresolved.length} 项未解决`;
    rawDetails?.remove();
    rawDetails = null;
    issues.remove();
    if (unresolved.length) {
      const list = el(doc, 'ul');
      for (const issue of unresolved) list.append(el(doc, 'li', {}, issue));
      issues.replaceChildren(el(doc, 'h4', {}, `未解决（${unresolved.length} 项）`), list);
      toast.insertBefore(issues, actions);
    }
    if (raw) {
      rawDetails = el(doc, 'details', { class: 'fated-toast-raw' });
      rawDetails.append(el(doc, 'summary', {}, `模型返回结果（已应用 ${applied ?? 0} 项）`), el(doc, 'pre', {}, raw));
      toast.insertBefore(rawDetails, actions);
    }
    noticeTitle.textContent = title;
    noticeBody.textContent = detail;
    noticeBody.hidden = !detail;
    retry.hidden = !onRetry;
    dismiss.hidden = busy;
    toast.hidden = false;
  }
  panel.append(header, tabs, content, resizeHandle); root.append(launcher, panel, toast); (doc.body || doc.documentElement)?.append(root);
  const instances = (() => { try { return parseJSON(storage?.getItem(stateKey)) ?? config.instances; } catch { return config.instances; } })();
  config.instances = isObject(instances) ? instances : {};

  // Battle scans/normalization must never write an old copy of the settings.
  function save() { putConfig(storage, stateKey, config.instances); }
  let localOnly = false;
  function syncSettings() {
    if (localOnly || !storage) return;
    const { instances: _legacyInstances, aiSessions: _savedSessions, ...latest } = configFor(storage, configKey);
    Object.assign(config, latest);
  }
  function persistSettings(patch, previousSlots = config.slots) {
    syncSettings();
    if (patch.slots && JSON.stringify(previousSlots) !== JSON.stringify(config.slots)) {
      renderSettings(pages.prompt, 'prompt', settingsContext());
      notify('槽位已在其他窗口更新', '已载入最新列表，请重新执行刚才的编辑。');
      return;
    }
    Object.assign(config, patch);
    const { instances, ...settings } = config;
    // Older configs embedded the instance table. Preserve it before splitting the keys.
    try { if (storage && storage.getItem(stateKey) == null) putConfig(storage, stateKey, instances); } catch { /* unavailable */ }
    localOnly = !putConfig(storage, configKey, settings);
    if (localOnly) notify('设置仅在本窗口生效', '无法写入浏览器存储；重载后可能丢失。');
  }
  if (!config.aiSessions?.sessions?.length || config.aiSessions.activeId !== aiSessions.data.activeId) {
    persistSettings({ aiSessions: aiSessions.data });
  } else config.aiSessions = aiSessions.data;
  async function open() {
    if (disposed) return;
    panel.hidden = false;
    launcher.hidden = true;
    if (config.autoScan !== false) { selectedMessageId = null; await scan(); }
  }
  let panelFullscreen = false;
  let panelRestore = null;
  function setFullscreen(value) {
    panelFullscreen = Boolean(value);
    if (panelFullscreen) {
      const rect = panel.getBoundingClientRect();
      panelRestore = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: panel.style.right, bottom: panel.style.bottom };
      panel.classList.add('is-fullscreen');
      panel.style.left = '0px'; panel.style.top = '0px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.width = '100vw'; panel.style.height = '100dvh';
      fullscreen.textContent = '❐'; fullscreen.title = '还原'; fullscreen.setAttribute('aria-label', '还原');
    } else {
      panel.classList.remove('is-fullscreen');
      const restore = panelRestore;
      panelRestore = null;
      panel.style.right = restore?.right || '16px'; panel.style.bottom = restore?.bottom || '16px';
      panel.style.left = restore ? `${restore.left}px` : '';
      panel.style.top = restore ? `${restore.top}px` : '';
      panel.style.width = restore ? `${restore.width}px` : '';
      panel.style.height = restore ? `${restore.height}px` : '';
      fullscreen.textContent = '□'; fullscreen.title = '全屏'; fullscreen.setAttribute('aria-label', '全屏');
    }
  }
  function hide() { panel.hidden = true; launcher.hidden = Boolean(config.hideLauncher); }
  function bindEventBus() {
    const eventOn = hostMethod(host, 'eventOn');
    if (typeof eventOn !== 'function') return;
    const handler = () => { open().catch(showError); };
    try {
      const result = eventOn('fated_tactical:open_ui', handler);
      if (typeof result === 'function') removeOpenEvent = result;
      else if (result?.off && typeof result.off === 'function') removeOpenEvent = () => result.off();
    } catch (_) { /* event bus is optional outside JS-Slash-Runner */ }
  }
  function closePanel() { hide(); }
  on(launcher, 'click', event => { if (launcher.dataset.dragged === 'true') { delete launcher.dataset.dragged; event.preventDefault(); return; } open(); });
  on(fullscreen, 'click', () => setFullscreen(!panelFullscreen));
  on(close, 'click', closePanel); on(minimize, 'click', hide);
  // The Tavern regex processor may inject the entry after this overlay mounts,
  // so bind the generated button through delegation instead of only binding
  // buttons created by our own DOM renderer.
  on(doc, 'click', event => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const trigger = path.find(node => node?.matches?.('[data-fated-battle-open], .fated-battle-enter'));
    if (trigger) {
      event.preventDefault(); event.stopPropagation();
      const floor = trigger.closest('[mesid], [data-message-id], [data-mesid]');
      selectedMessageId = floor?.getAttribute('mesid') ?? floor?.dataset.messageId ?? floor?.dataset.mesid ?? null;
      panel.hidden = false; launcher.hidden = true;
      switchTab('sandbox');
      void scan();
    }
  }, { capture: true });

  // Dragging works for both the launcher and the large window. Coordinates are
  // clamped only by CSS; no browser-specific pointer API is required.
  function draggable(node, handle) {
    const surface = handle || node;
    let drag = null;
    on(surface, 'pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = node.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    });
    on(surface, 'pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        node.style.right = 'auto'; node.style.bottom = 'auto';
        node.style.left = `${drag.left}px`; node.style.top = `${drag.top}px`;
        try { surface.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      node.style.left = `${Math.max(0, drag.left + dx)}px`;
      node.style.top = `${Math.max(0, drag.top + dy)}px`;
      event.preventDefault();
    });
    const stop = event => { if (drag?.pointerId === event.pointerId) drag = null; };
    on(surface, 'pointerup', stop); on(surface, 'pointercancel', stop); on(surface, 'lostpointercapture', stop);
  }
  function draggableLauncher() {
    let drag = null;
    const start = event => {
      if (event.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      drag = { pointerId: event.pointerId ?? null, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    };
    on(launcher, 'pointerdown', start);
    on(launcher, 'mousedown', event => { if (!drag) start(event); });
    const move = event => {
      if (!drag || (drag.pointerId != null && event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
      if (!drag.moved) {
        drag.moved = true; launcher.dataset.dragged = 'true';
        launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
        launcher.style.left = `${drag.left}px`; launcher.style.top = `${drag.top}px`;
        try { launcher.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
      const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
      launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`;
      launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
      event.preventDefault();
    };
    on(doc, 'pointermove', move); on(launcher, 'pointermove', move);
    on(doc, 'mousemove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
      drag.moved = true; launcher.dataset.dragged = 'true'; launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
      const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
      const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
      launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`; launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
      event.preventDefault();
    });
    const stop = event => { if (drag && (drag.pointerId == null || event.pointerId == null || drag.pointerId === event.pointerId)) drag = null; };
    on(doc, 'pointerup', stop); on(doc, 'pointercancel', stop); on(doc, 'mouseup', stop); on(launcher, 'lostpointercapture', stop);
  }
  draggableLauncher();
  draggable(panel, header);
  function resizable() {
    let resize = null;
    on(resizeHandle, 'pointerdown', event => {
      if (panelFullscreen || event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      resize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      try { resizeHandle.setPointerCapture?.(event.pointerId); } catch (_) {} event.preventDefault();
    });
    on(resizeHandle, 'pointermove', event => {
      if (!resize || event.pointerId !== resize.pointerId) return;
      const vw = host.innerWidth || doc.documentElement.clientWidth || resize.width;
      const vh = host.innerHeight || doc.documentElement.clientHeight || resize.height;
      const width = Math.min(vw - 16, Math.max(480, resize.width + event.clientX - resize.x));
      const height = Math.min(vh - 16, Math.max(360, resize.height + event.clientY - resize.y));
      panel.style.width = `${width}px`; panel.style.height = `${height}px`; event.preventDefault();
    });
    const stop = event => { if (resize?.pointerId === event.pointerId) resize = null; };
    on(resizeHandle, 'pointerup', stop); on(resizeHandle, 'pointercancel', stop); on(resizeHandle, 'lostpointercapture', stop);
  }
  resizable();

  function battleEntry(raw) {
    const details = el(doc, 'details', { class: 'fated-battle-entry' });
    const summary = el(doc, 'summary', {}, '⚔ 进入战场 · 点击展开入口');
    const meta = el(doc, 'div', { class: 'fated-battle-meta' }, '已识别 battle_init · 可在控制台加载战局');
    const pre = el(doc, 'pre', { class: 'fated-battle-source' }, raw);
    const enter = el(doc, 'button', { type: 'button', class: 'fated-battle-enter' }, '打开战场控制台');
    details.append(summary, meta, pre, enter);
    return details;
  }
  function foldBattleEntries() {
    const candidates = [...doc.querySelectorAll('.mes_text, .mes_text_wrap, .mes, .chat-msg, .message, [data-content], [data-message-id], [data-mesid]')];
    const seen = new Set();
    for (const content of candidates) {
      const rootNode = content.matches?.('.mes, .chat-msg, [data-message-id], [data-mesid]') ? content.querySelector('.mes_text, .mes_text_wrap, .message, [data-content]') || content : content;
      if (!rootNode || seen.has(rootNode) || rootNode.closest('[data-fated-tavern-overlay]') || rootNode.dataset.fatedBattleFolded === 'true') continue;
      seen.add(rootNode);
      const tag = rootNode.querySelector?.('battle_init');
      if (tag) {
        tag.replaceWith(battleEntry(`<battle_init>\n${tag.textContent || ''}\n</battle_init>`));
        rootNode.dataset.fatedBattleFolded = 'true';
        continue;
      }
      const walker = doc.createTreeWalker?.(rootNode, 4);
      if (!walker) continue;
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node of textNodes) {
        const raw = node.nodeValue || '';
        const match = raw.match(/(?:<|&lt;)battle_init(?:\s[^>]*?)?(?:>|&gt;)[\s\S]*?(?:<|&lt;)\/battle_init(?:>|&gt;)/i);
        if (!match) continue;
        const replacement = doc.createDocumentFragment();
        if (match.index) replacement.append(doc.createTextNode(raw.slice(0, match.index)));
        replacement.append(battleEntry(match[0].replaceAll('&lt;', '<').replaceAll('&gt;', '>')));
        if (match.index + match[0].length < raw.length) replacement.append(doc.createTextNode(raw.slice(match.index + match[0].length)));
        node.parentNode?.replaceChild(replacement, node);
        rootNode.dataset.fatedBattleFolded = 'true';
        break;
      }
    }
  }

  function renderInstances() {
    const page = pages.instances; page.replaceChildren(el(doc, 'h3', {}, '战场入口'));
    const battleCard = el(doc, 'article', { class: 'fated-battle-card' });
    const battle = sources.battleInit;
    battleCard.append(el(doc, 'div', { class: 'fated-card-kicker' }, `命定战术控制台 v${TAVERN_VERSION} · ${battle ? 'BATTLE INIT · 已识别' : 'BATTLE INIT · 等待扫描'}`));
    battleCard.append(el(doc, 'h4', {}, battle?.sceneTitle || battle?.title || '尚未发现正文战场'));
    battleCard.append(el(doc, 'p', { class: 'fated-mini' }, battle ? `${battle.battleType || '标准战斗'} · ${battle.units?.length || battle.participants?.length || 0} 名参与者 · ${battle.covers?.length || 0} 个掩体` : '点击扫描当前聊天，读取最新正文中的 battle_init。'));
    const battleActions = el(doc, 'div', { class: 'fated-actions' });
    const loadBattle = el(doc, 'button', { type: 'button', class: 'fated-primary' }, battle ? '加载战场' : '扫描并加载');
    const showSource = el(doc, 'details', { class: 'fated-battle-source-box' });
    showSource.append(el(doc, 'summary', {}, '查看原始 battle_init'), el(doc, 'pre', { class: 'fated-battle-source' }, sources.battleRaw || '暂无原始数据'));
    const normalize = el(doc,'button',{type:'button','data-normalize':''},'标准化');
    normalize.disabled = !selectedIds().length || !activeBattleKey || !!aiController;
    const hint = !selectedIds().length ? [scanStatus,'请先勾选要标准化的角色'].filter(Boolean).join(' · ') : scanStatus;
    normalize.title = hint;
    on(normalize,'click',()=>runNormalize(selectedIds(),{force:true}));
    battleActions.append(loadBattle,normalize); battleCard.append(battleActions,el(doc,'p',{class:'fated-mini','data-normalize-status':''},hint),showSource); page.append(battleCard);
    const diag = el(doc, 'details', { class: 'fated-diagnostics' });
    diag.append(el(doc, 'summary', {}, '诊断日志（扫描来源 / 去重）'));
    diag.append(el(doc, 'pre', { class: 'fated-status', 'data-diagnostics': '' }, JSON.stringify(diagnostics, null, 2)));
    page.append(diag);
    on(loadBattle, 'click', async () => { switchTab('sandbox'); await scan(); });
    const toolbar = el(doc, 'div', { class: 'fated-actions' });
    const refresh = el(doc, 'button', { type: 'button' }, '从当前聊天重新水合'); toolbar.append(refresh); page.append(toolbar);
    const choose = ids => { persistSettings({rosterSelection:ids}); renderInstances(); };
    for (const [label,all] of [['全选',true],['取消全选',false]]) { const b=el(doc,'button',{type:'button'},label); on(b,'click',()=>choose(all?Object.keys(config.instances):[])); toolbar.append(b); }
    const list = el(doc, 'div'); page.append(list);
    const entries = Object.entries(config.instances);
    if (!entries.length) list.append(el(doc, 'p', { class: 'fated-mini' }, '暂无实例。打开沙盘会自动读取当前 MVU、char_info 和 battle_init。'));
    for (const [key, instance] of entries) {
      const box = el(doc, 'article', { class: 'fated-instance' });
      box.dataset.unitId = key;
      const select = el(doc,'input',{type:'checkbox','aria-label':`选择 ${instance.name || key}`});
      select.checked = selectedIds().includes(key);
      on(select,'change',()=>choose(select.checked?[...new Set([...selectedIds(),key])]:selectedIds().filter(k=>k!==key)));
      fillInstance(box,(tag,attrs,value)=>el(doc,tag,attrs,value),instance,liveState(),characters[key]?.raw,select);
      const messages = warningsForUnit(sources.warnings, [key], false);
      if (messages.length) {
        const details = el(doc,'details',{class:'fated-char-diagnostics'}), list = el(doc,'ul');
        for (const { message } of messages) list.append(el(doc,'li',{},message));
        details.append(el(doc,'summary',{},`⚠ ${messages.length} 条诊断`),list);
        box.append(details);
      }
      const actions = el(doc, 'div', { class: 'fated-actions' }); const edit = el(doc, 'button', { type: 'button' }, '编辑 JSON'); const remove = el(doc, 'button', { type: 'button' }, '删除');
      actions.append(edit, remove); box.append(actions); list.append(box);
      on(remove, 'click', () => { delete config.instances[key]; save(); choose(selectedIds()); });
      on(edit, 'click', () => { const value = prompt('编辑实例 JSON', JSON.stringify(instance, null, 2)); const parsed = parseJSON(value, null); if (isObject(parsed)) { config.instances[key] = { ...parsed, id:key, source:'AI 编辑' }; save(); renderInstances(); } });
    }
    on(refresh, 'click', () => { selectedMessageId = null; void scan(true); });
  }
  function switchTab(key) {
    const button = tabs.querySelector(`[data-tab="${key}"]`);
    button?.click();
  }

  let promptKind = 'validate', promptInstruction = '';
  let previewSink, lastSent = null;
  function assemblyContext(kind = promptKind, instruction = promptInstruction, onlyUnitIds = kind === 'validate' ? selectedIds() : undefined) {
    return { kind, instruction, onlyUnitIds, rawCharacters:Object.fromEntries(Object.entries(characters).map(([id,c])=>[id,c.raw])), state: liveState(), sources, roster: Object.values(config.instances), extraText: config.extraText };
  }
  function publishMessages(messages, kind = promptKind) {
    previewSink?.(messages, kind);
    return messages;
  }
  function prepareMessages(kind = promptKind, instruction = promptInstruction, sending = false, unitIds) {
    const slots = config.slots;
    const messages = assembleMessages(slots, assemblyContext(kind, instruction,unitIds));
    if (config.debugPrompts) console.debug('[fated:prompts]', { kind, slots: slots.map(s => ({ id: s.id, enabled: s.enabled })),
      messages: messages.map(({ slotId, role, content }) => ({ slotId, role, chars: content.length })) });
    if (sending && messages.length) lastSent = messages;
    return publishMessages(messages, kind);
  }
  function settingsContext() {
    syncSettings();
    return { host, settings: config, slots: config.slots, assemblyContext, prepareMessages, lastSent: () => lastSent,
      onPreview(fn) { previewSink = fn; }, fetchImpl: options.fetch, save: persistSettings };
  }
  function runNormalize(unitIds = Object.keys(characters), {force=false, sessionId=force?aiSessions.active().id:undefined} = {}) {
    const stored=config.charSnapshots[activeBattleKey]??{};
    const ids=unitIds.filter(id=>characters[id] && (force || !stored[id]?.normalized || stored[id].hash!==characters[id].hash));
    if (!ids.length) return;
    const records=Object.fromEntries(ids.map(id=>[id,{hash:characters[id].hash,sourceKind:characters[id].sourceKind}]));
    return askAI('validate','',sessionId,records);
  }

  async function hydrate(epoch) {
    const messages = await tavernMessages(host);
    const nextSources = sourceBundle({}, messages, chatId(host), selectedMessageId);
    const messageId = Number(nextSources.source?.messageId);
    // MVU may return objects created in the parent window. Clone them into
    // the script realm before passing them to the converter's plain-object checks.
    nextSources.mvuData = clone(await readBattleVariables(host, messageId));
    nextSources.protagonistName = tavernIdentity(host);
    if (epoch !== scanEpoch || disposed) return null;
    sources = nextSources;
    foldBattleEntries();
    if (!sources.battleInit) { diagnostics = { phase: 'no-battle' }; config.instances = {}; return null; }
    const converter = options.converter || getGlobal(host, 'FatedTactical')?.hydrateBattleState || getGlobal(host, 'hydrateBattleState') || hydrateBattleState;
    let hydrated = null;
    let conversionError = null;
    if (typeof converter === 'function') {
      const input = { mvu: sources.mvuData, stat_data: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, protagonistName: sources.protagonistName };
      try { hydrated = await converter(input); }
      catch (error) { conversionError = error; }
    }
    if (epoch !== scanEpoch || disposed) return null;
    if (conversionError) {
      diagnostics = { phase: 'conversion-error', error: conversionError?.stack || conversionError?.message || String(conversionError), mvuKeys: Object.keys(sources.mvuData || {}), charCount: sources.charInfo?.length || 0, participantCount: sources.battleInit?.units?.length || sources.battleInit?.participants?.length || 0 };
      try { console.error('[fated-tactical] hydrate failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      throw conversionError;
    }
    sources.warnings = hydrated?.warnings ?? [];
    sources.sourceMap = hydrated?.sourceMap ?? {};
    sources.seed = hydrated?.seed ?? hydrated?.state?.rng;
    sources.input = { mvu: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, latestFloor: sources.latestFloor, battleText: sources.battleRaw, protagonistName: sources.protagonistName };
    if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
    const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
    // Instances are a projection of the latest scan, not an append-only log.
    // Keeping old entries here made a previous narrative_char_info enemy appear
    // twice and could hide the current MVU protagonist in the maintenance page.
    const nextInstances = {};
    for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) {
      const key = item.id || item.uid || item.name || `unit-${Object.keys(nextInstances).length + 1}`;
      nextInstances[key] = { ...clone(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? 'MVU 主角' : '正文 <char_info>') };
    }
    config.instances = nextInstances;
    diagnostics = {
      phase: 'hydrated',
      version: TAVERN_VERSION,
      mvuKeys: Object.keys(sources.mvuData || {}),
      protagonistName: sources.protagonistName || '',
      charCount: sources.charInfo?.length || 0,
      participantCount: sources.battleInit?.units?.length || sources.battleInit?.participants?.length || 0,
      rosterCount: Array.isArray(roster) ? roster.length : Object.keys(roster || {}).length,
      rosterIds: (Array.isArray(roster) ? roster : Object.values(roster || {})).map(item => `${item.id || item.name}:${item.source || 'unknown'}`),
      fieldSources: (Array.isArray(roster) ? roster : Object.values(roster || {})).map(item => ({ id: item.id, name: item.name, source: item.source, fieldSources: item.fieldSources })),
      instanceCount: Object.keys(config.instances).length,
      unitIds: Object.values(hydrated?.state?.units || {}).map(unit => `${unit.id}:${unit.name}:${unit.team}`),
      warnings: hydrated?.warnings || [],
    };
    save();
    const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
    if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
    return hydrated;
  }
  let stopTerrainNotices;
  function mountState(state, restoreSaved = false) {
    stopTerrainNotices?.();
    stopTerrainNotices = undefined;
    gameMount?.unmount?.();
    gameMount = null;
    if (!state) return;
    const battleInstanceId = sources.battleKey || id;
    const battleInput = sources.input;
    const target = pages.sandbox.querySelector('[data-sandbox-mount]');
    const restart = ({ seed }) => {
      const next = hydrateBattleState(battleInput, { seed, throwOnValidation: true }).state;
      return applyNormalization(next, operations(battleInstanceId));
    };
    gameMount = (options.mount || defaultMount)(target, {
      instanceId: battleInstanceId, storage, state, customBattle: { seed: sources.seed, restart, restoreSaved },
    });
    const game = gameMount?.api;
    if (game?.subscribe) {
      let seen = game.getBattleState().logs.length;
      stopTerrainNotices = game.subscribe(() => {
        const logs = game.getBattleState().logs;
        const unresolved = logs.slice(seen).filter(log => log.type === 'terrain_unresolved').map(log => log.text);
        seen = logs.length;
        if (unresolved.length) notify('地形效果', '', null, false, { tone: 'error', unresolved });
      });
    }
  }
  function showError(error) { const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = `错误：${error?.message || error}`; }
  function filterResolved(stored, records) {
    const warnings = sources.warnings ??= [];
    const remaining = remainingDiagnostics(warnings, stored, records);
    warnings.splice(0, warnings.length, ...remaining);
    diagnostics.warnings = warnings;
  }
  function liveState() { return gameMount?.getState?.() ?? currentState; }
  function applyNormalization(state, patch) {
    if (!patch?.length) return state;
    const next = applyPatch(state, patch, true);
    (options.validateState || defaultValidateState)(next);
    refreshOpeningInitiative(next);
    syncEquipmentEffects(next);
    refreshOutcome(next);
    return next;
  }
  async function scan(force = false) {
    const epoch = ++scanEpoch;
    const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = '正在读取 MVU、最新楼层并转换…';
    try {
      const hydrated = await hydrate(epoch);
      if (epoch !== scanEpoch || disposed) return;
      const nextState = hydrated?.state ?? null;
      const key=sources.battleKey;
      const fresh=key ? await characterRecords(sources,hydrated) : {};
      if(epoch!==scanEpoch || disposed) return;
      syncSettings();
      const ids=Object.keys(fresh), stored={...(config.charSnapshots[key]??{})};
      const removed=Object.keys(stored).filter(id=>!fresh[id]);
      diagnostics.removedCharacters=removed;
      for(const id of removed) delete stored[id];
      const changed=ids.filter(id=>!stored[id]?.normalized || stored[id].hash!==fresh[id].hash);
      const sourceChanged=activeBattleKey===key && (ids.some(id=>mountedHashes[id]!==fresh[id].hash)||Object.keys(mountedHashes).some(id=>!fresh[id]));
      if (sourceChanged || !gameMount || activeBattleKey !== key) {
        if (aiController) {
          const finished = aiFinished;
          aiController.abort();
          await finished;
          if (epoch !== scanEpoch || disposed) return;
        }
        toast.hidden = true;
        // Replay only batches whose input still matches; never resurrect obsolete equipment effects.
        const kept=batches(key).filter(batch=>Object.entries(batch.hashes).some(([id,hash])=>fresh[id]?.hash===hash));
        const invalid=batches(key).filter(batch=>!kept.includes(batch));
        if(invalid.length) {
          persistSettings({normalizationBatches:{...config.normalizationBatches,[key]:kept}});
        }
        currentState = nextState ? applyNormalization(nextState, operations(key)) : null;
        activeBattleKey = key;
        mountState(currentState, !sourceChanged && !invalid.length && !changed.length);
      }
      characters=fresh; mountedHashes=Object.fromEntries(ids.map(id=>[id,fresh[id].hash]));
      for(const id of changed) if(stored[id]?.hash!==fresh[id].hash) stored[id]={hash:fresh[id].hash,sourceKind:fresh[id].sourceKind,at:Date.now(),normalized:false};
      if(key && (changed.length||removed.length)) persistSettings({charSnapshots:{...config.charSnapshots,[key]:stored}});
      if(config.rosterSelection===null && ids.length) persistSettings({rosterSelection:ids});
      filterResolved(stored, fresh);
      const live=liveState();
      for(const unit of Object.values(live?.units??{})) if(config.instances[unit.id]) Object.assign(config.instances[unit.id],unit);
      scanStatus=changed.length?`待标准化 ${changed.length} 个角色`:'无变化，跳过自动标准化';
      renderInstances();
      if (currentState && !aiController && changed.length) void runNormalize(changed,{force:false});
      if (node) node.textContent = currentState
        ? `扫描完成：${Object.values(currentState.units || {}).map(unit => `${unit.name}(${unit.id})`).join('、')} · ${scanStatus}`
        : '扫描完成（未找到可挂载的战局）。';
    } catch (e) {
      diagnostics = { ...diagnostics, phase: 'scan-error', error: e?.stack || e?.message || String(e) };
      try { console.error('[fated-tactical] scan failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      showError(e);
      notify('战局加载失败', e.message, () => scan(force));
    }
  }
  function renderSandbox() {
    const page = pages.sandbox; page.replaceChildren(el(doc, 'h3', {}, '沙盘'));
    const status = el(doc, 'div', { class: 'fated-status', 'data-status': '' }, '打开此页会自动侦测当前聊天。'); page.append(status);
    const mountTarget = el(doc, 'div', { 'data-sandbox-mount': '' }); page.append(mountTarget);
    const actions = el(doc, 'div', { class: 'fated-actions' }); const report = el(doc, 'button', { type: 'button' }, '战报交付'); const refresh = el(doc, 'button', { type: 'button' }, '重新扫描'); actions.append(report, refresh); page.append(actions);
    const output = status;
    on(refresh, 'click', () => scan(true).catch(showError));
    on(report, 'click', () => { try { const result = gameMount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.() || (currentState ? `当前战局：${currentState.title} · 回合 ${currentState.round} · ${Object.values(currentState.units || {}).length} 个单位` : ''); const textarea = doc.querySelector('#send_textarea'); if (textarea) { textarea.value = result; textarea.dispatchEvent(new Event('input', { bubbles: true })); } if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(result).catch(() => {}); output.textContent = result || '当前没有可交付的战报。'; } catch (e) { showError(e); } });
  }
  askAI = async (kind, requestText = '', sessionId = kind === 'chat' ? aiSessions.active().id : undefined, records) => {
      if (aiController || (kind === 'chat' && !requestText)) return;
      syncSettings();
      promptKind = kind; promptInstruction = requestText;
      const normalize = kind === 'validate';
      const session = aiSessions.get(sessionId);
      if (sessionId && !session) return;
      const history = !normalize && session ? session.messages.filter(m =>
        (m.role === 'user' || m.role === 'assistant') && m.content?.trim() && m.status !== 'error' && m.status !== 'aborted'
      ).map(({ role, content }) => ({ role, content })) : [];
      const entries = session ? aiSessions.append(session.id,
        { role: 'user', content: normalize ? '标准化' : requestText, status: 'ok' }, { role: 'assistant', content: '' }) : [];
      const assistantMessage = entries[1];
      const feed = (...messages) => { if (session) aiPage?.feed(session.id, ...messages); };
      const updateReply = (fields, persist = true) => {
        if (!assistantMessage) return;
        if (persist) aiSessions.update(session.id, assistantMessage, fields);
        else Object.assign(assistantMessage, fields);
        feed(assistantMessage);
      };
      const postStatus = (content, status) => {
        if (session) feed(...aiSessions.append(session.id, { role: 'system', content, status }));
      };
      feed(...entries);
      const key = activeBattleKey;
      const controller = new AbortController();
      aiController = controller;
      let finish;
      aiFinished = new Promise(resolve => { finish = resolve; });
      aiPage?.setBusy(true);
      const normalizeButton = pages.instances.querySelector('[data-normalize]');
      if (normalizeButton) normalizeButton.disabled = true;
      const timeout = setTimeout(() => controller.abort(new Error('请求超时，请检查酒馆主接口或独立 API')), config.timeoutMs ?? 60000);
      const label = normalize ? '标准化' : 'AI 调整';
      const retryRequest = () => normalize ? runNormalize(Object.keys(records),{force:true, sessionId:sessionId??null}) : askAI(kind, requestText, sessionId);
      if (normalize) notify('正在标准化中…', '', null, true);
      else toast.hidden = true;
      let receivedPatch = normalize, replyText = '', unresolved = [], appliedCount = 0;
      try {
        if (normalize && !liveState()) {
          if (!session) { toast.hidden = true; return; }
          throw new Error('没有可标准化的战局，请先扫描沙盘');
        }
        let prompts = prepareMessages(kind, requestText, true, records && Object.keys(records));
        const sentWarnings = normalize ? warningsForUnit(sources.warnings, Object.keys(records)).filter(w =>
          prompts.some(m => m.content.includes(JSON.stringify(w.message)))) : [];
        if (!normalize) {
          prompts = [...prompts, ...history, { role: 'user', content: requestText }];
          lastSent = prompts;
          publishMessages(prompts, kind);
        }
        if (!prompts.length) throw new Error('没有可发送的提示词，请在提示词组装页启用有内容的槽位');
        const streamUpdate = (snapshot, done, info) => {
          if (disposed || controller.signal.aborted || aiController !== controller || activeBattleKey !== key) return;
          if (snapshot) updateReply({ content: snapshot }, false);
          if (!normalize) return;
          noticeBody.textContent = info?.isHeartbeat ? `已等待 ${info.elapsedSec} 秒，连接仍在保持…` :
            done ? '已收到完整响应，正在校验…' : `已收到 ${snapshot.length} 字符…`;
          noticeBody.hidden = false;
        };
        const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
        const validate = options.validateState || defaultValidateState;
        let patch, nextState, combined, solved;
        for (let attempt = 0; ; attempt++) {
          const reply = await Promise.race([
            requestTavernAI(host, config, prompts, options.fetch, controller.signal, streamUpdate), cancelled,
          ]);
          controller.signal.throwIfAborted();
          if (disposed || aiController !== controller || key !== activeBattleKey) return;
          replyText = reply;
          try {
            const parsed = parseAIResponse(reply);
            patch = parseJSONPatch(reply) ?? (normalize ? null : parsed.patch);
            const pending = parsed.data?.unresolved ?? [];
            if (!Array.isArray(pending) && normalize) throw new Error('unresolved 必须是 JSON 数组');
            unresolved = Array.isArray(pending) ? pending.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : [];
            receivedPatch = normalize || patch != null || ['patch', 'battle_patch', 'unit_patch'].some(field => Object.hasOwn(parsed.data ?? {}, field));
            if (!receivedPatch) { updateReply({ content: reply, status: 'ok' }); return; }
            if (!patch) throw new Error('模型未返回有效的战局补丁');
            if (!liveState()) throw new Error('没有可应用补丁的战局，请先扫描沙盘');
            if (normalize) {
              if (!Array.isArray(patch)) throw new Error('patch 必须是 JSON 数组');
              for (const [index, operation] of patch.entries()) {
                if (!['add', 'replace', 'remove'].includes(operation?.op) || typeof operation.path !== 'string' ||
                    !normalizationPath.test(operation.path) || (operation.op !== 'remove' && !own(operation, 'value'))) {
                  throw new Error(`第 ${index + 1} 项路径或操作无效（${text(operation?.path).slice(0, 120) || '缺少 path'}）`);
                }
              }
            }
            if (normalize && !patch.length) throw new Error('模型返回空补丁，没有可注入的变更');
            if (normalize) {
              solved = resolvedDiagnostics(sentWarnings, records, patch, {...parsed.data, unresolved});
              patch = patch.map(({resolves, ...operation}) => operation);
            }
            nextState = (options.applyPatch ?? applyPatch)(liveState(), patch, normalize);
            validate(nextState);
            if (normalize && patch.length) {
              refreshOpeningInitiative(nextState);
              combined = [...operations(key), ...patch];
              const baseline = hydrateBattleState(sources.input, { throwOnValidation: true }).state;
              validate(applyNormalization(baseline, combined));
            }
            syncEquipmentEffects(nextState);
            refreshOutcome(nextState);
            validate(nextState);
            break;
          } catch (error) {
            if (!normalize || attempt > 0) throw error;
            notify('正在标准化中…', '模型正在修正补丁格式', null, true);
            prompts = [...prompts, { role: 'user', content: `上一条输出校验失败（${error.message}）。按上面的例子使用精确 ID 和路径，重新输出完整 JSON 对象。\n上一条输出：${reply.slice(0, 3500)}` }];
            lastSent = prompts;
            publishMessages(prompts, kind);
          }
        }
        if (!Array.isArray(patch) || patch.length) {
          if (typeof gameMount?.loadState !== 'function') throw new Error('沙盘未就绪，无法注入补丁');
          gameMount.loadState(nextState);
          appliedCount = Array.isArray(patch) ? patch.length : 1;
          currentState = nextState;
          for (const unit of Object.values(nextState.units)) config.instances[unit.id] = { ...config.instances[unit.id], ...unit };
          save(); renderInstances();
        }
        if (combined) {
          const stored={...config.charSnapshots[key]}, hashes={};
          for(const [id,rec] of Object.entries(records)) {
            const previous = stored[id]?.hash === rec.hash ? stored[id].resolvedWarnings ?? [] : [];
            const resolvedWarnings = [...new Set([...previous, ...solved.filter(w=>w.unitId===id).map(warningKey)])];
            stored[id]={...rec,at:Date.now(),normalized:true,resolvedWarnings};hashes[id]=rec.hash;
          }
          // Keep operation order, tagging each operation with the units that actually use its target.
          // Shared template definitions remain available while any dependent unit is unchanged.
          const additions=patch.map(op=>{
            const [,table,target]=op.path.split('/');
            const owners=Object.keys(records).filter(id=>{
              const u=nextState.units[id]; const items=[u?.weapon,u?.mainHand,u?.offHand,u?.shield,...(u?.gear??[])];
              if(table==='units') return target===id;
              if(table==='skills') return u?.skills?.includes(target);
              if(table==='items') return items.includes(target);
              if(table==='equipment') return items.some(k=>nextState.items[k]?.templateId===target);
              return false;
            });
            return {patch:[op],hashes:owners.length?Object.fromEntries(owners.map(id=>[id,hashes[id]])):hashes};
          });
          persistSettings({charSnapshots:{...config.charSnapshots,[key]:stored},normalizationBatches:{...config.normalizationBatches,[key]:[...batches(key),...additions]}});
          filterResolved(stored, characters);
          scanStatus=`已标准化 ${Object.keys(records).length} 个角色`; renderInstances(); prepareMessages();
        }
        updateReply({ content: replyText, status: 'ok' });
        const result = Array.isArray(patch) && !patch.length ? '无补丁变更' : '补丁已应用';
        postStatus(`${label}：${result}${unresolved.length ? `，待处理：${unresolved.join('；')}` : ''}`, 'ok');
        if (normalize) notify('标准化完成', '', unresolved.length ? retryRequest : null, false,
          { tone: 'success', applied: appliedCount, unresolved, raw: replyText });
      } catch (e) {
        if (aiController !== controller) return;
        const aborted = e?.name === 'AbortError';
        const status = aborted ? 'aborted' : 'error';
        const detail = e?.message || String(e);
        const partial = assistantMessage?.content || replyText;
        updateReply({ status, content: aborted ? partial ?? '' : [partial, `错误：${detail}`].filter(Boolean).join('\n\n') });
        if (receivedPatch) postStatus(`${label}${aborted ? '已中止' : '失败'}：${detail}${unresolved.length ? `；未解决：${unresolved.join('；')}` : ''}`, status);
        if (normalize && !disposed) notify(`${label}${aborted ? '已中止' : '失败'}`, detail, aborted ? null : retryRequest, false,
          aborted ? { raw: replyText } : { tone: 'error', applied: appliedCount, unresolved, raw: replyText });
      } finally {
        clearTimeout(timeout);
        if (aiController === controller) aiController = null;
        if (!disposed) { aiPage?.setBusy(false); renderInstances(); }
        finish();
      }
  };
  function updateMagic() {
    launcher.hidden = Boolean(config.hideLauncher) || !panel.hidden;
    const wand = doc.querySelector('#extensionsMenu, #data_bank_wand_container'); if (!wand) return;
    let entry = wand.querySelector('[data-fated-tavern-entry]');
    if (config.hideLauncher) { if (!entry) { entry = el(doc, 'button', { type: 'button', 'data-fated-tavern-entry': '' }, '🪄 命定战术控制台'); wand.append(entry); on(entry, 'click', open); } }
    else entry?.remove();
    // Do not call replaceScriptButtons() without its required button array. The
    // native launcher is already mounted; the optional magic-wand entry above is
    // deliberately managed as a normal DOM button.
  }
  renderInstances(); renderSandbox();
  aiPage = mountAiPage(pages.ai, { make: (tag, attrs, content) => el(doc, tag, attrs, content), on, sessions: aiSessions,
    send: message => askAI('chat', message), stop: () => aiController?.abort(new DOMException('已取消', 'AbortError')) });
  updateMagic();
  bindEventBus();
  foldBattleEntries();
  if (typeof MutationObserver === 'function' && doc.body) {
    battleObserver = new MutationObserver(() => foldBattleEntries());
    battleObserver.observe(doc.body, { childList: true, subtree: true });
  }
  const api = { version: TAVERN_VERSION, open, close: closePanel, dispose, scan, getConfig: () => clone(config), getDiagnostics: () => clone(diagnostics), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, getSources: () => clone(sources), getState: () => { const state = clone(liveState()); if (state) Object.defineProperty(state,'warnings',{value:clone(sources.warnings ?? [])}); return state; } };
  function dispose() {
    if (disposed) return; disposed = true; stopTerrainNotices?.(); aiController?.abort(); battleObserver?.disconnect(); removeOpenEvent?.(); try { controller?.abort(); } catch (_) {} for (const remove of listeners.splice(0)) remove(); try { gameMount?.unmount?.(); } catch (_) {} root.remove(); try { if (host.__fatedTacticalTavern === api) delete host.__fatedTacticalTavern; } catch (_) {} }
  try { host.__fatedTacticalTavern = api; } catch (_) {}
  if (options.open) open();
  return api;
}
export const mount = mountTavernOverlay;
export { hydrateBattleState };
export default mountTavernOverlay;
