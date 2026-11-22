import { diagnosticText, diagnosticTitle, existingEffectReceipts, missingDispositions, identifiesWarning, readUnresolvedDiagnostics, resolvedDiagnostics, pendingDiagnostics, remainingDiagnostics, normalizationCandidates, warningKey } from './resolved-warnings.js';
import { hydrateFromSources as hydrateBattleState, parseBattleInit, parseSimpleYaml, warningsForUnit } from './converter.js';
import { activeNarrativeExemptions, normalizationLimit, normalizationLimits, normalizationOperations, planNormalizationBatches, readNarrativeExemptions, runOrderedBatches, warningReference } from './normalization-batches.js';
import { mount as defaultMount } from '../ui/mount.js';
import { validateState as defaultValidateState } from '../api/validation.js';
import { refreshOpeningInitiative, refreshOutcome, syncEquipmentEffects } from '../core/combat.js';
import { hostMethod, readBattleVariables, readChatMessages, statData } from './host.js';
import { tavernTheme } from './theme.js';
import { readBattlePortraits } from './portraits.js';
import { assembleMessages, describeSlots } from './prompts.js';
import { requestViaTavern, requestViaCustomApi } from './api.js';
import { renderSettings } from './settings.js';
import { createAiSessions } from './ai-sessions.js';
import { characterRecords } from './char-snapshots.js';
import { fillInstance } from './instance-card.js';
import { mountAiPage } from './ai-page.js';
import { chatUndoChanges, chatInversePatch } from './ai-patch-undo.js';

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

export function extractJsonBlocks(value) {
  const source = typeof value === 'object' ? JSON.stringify(value) : text(value);
  const output = [];
  const accept = (candidate, index) => {
    const parsed = parseJSON(candidate, null);
    if (!((isObject(parsed) && Object.keys(parsed).length) || (Array.isArray(parsed) && parsed.length))) return;
    output.push({ parsed, index });
  };
  const fencedRanges = [];
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    accept(match[1].trim(), match.index);
    fencedRanges.push([match.index, match.index + match[0].length]);
  }
  const hidden = index => fencedRanges.some(([start, end]) => index >= start && index < end);
  const stack = [];
  let quote = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    if (hidden(i)) { quote = false; escaped = false; continue; }
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quote = false; continue; }
    if (ch === '"' && stack.length) { quote = true; continue; }
    if (ch === '{' || ch === '[') stack.push({ ch, start: i });
    else if (ch === '}' || ch === ']') {
      const expected = ch === '}' ? '{' : '[';
      const top = stack.at(-1);
      if (top?.ch === expected) { stack.pop(); if (!stack.length) accept(source.slice(top.start, i + 1), top.start); }
      else if (top) stack.length = 0;
    }
  }
  return output.sort((a, b) => a.index - b.index).map(entry => entry.parsed);
}
const preferredJson = source => extractJsonBlocks(source).sort((a, b) => jsonPriority(a) - jsonPriority(b)).at(-1);
function jsonPriority(value) {
  if (Array.isArray(value)) return value.every(item => item && typeof item.op === 'string' && typeof item.path === 'string') ? 4 : 1;
  if (!isObject(value)) return -1;
  if (['patch','patches','jsonPatch','battle_patch','unit_patch'].some(key => key in value) || value.op && value.path) return 4;
  if (['units','skills','equipment','items','statusTemplates','covers','interactives','zones'].some(key => key in value)) return 3;
  return 1;
}
export function parseAIResponse(value) {
  const source = typeof value === 'object' ? JSON.stringify(value) : text(value);
  const parsed = preferredJson(source) ?? null;
  const patch = parsed?.battle_patch || parsed?.unit_patch || parsed?.patch ||
    (parsed && (parsed.op || parsed.path || parsed.value) ? parsed : null);
  return { data: parsed, patch, text: source };
}
export function requestTavernAI(host, config, messages, fetchImpl, signal, onStreamChunk) {
  const options = { host, fetchImpl, signal, onStreamChunk };
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

function fingerprintAt(state, path) {
  let value = state;
  for (const key of path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (value == null || !own(value, key)) return undefined;
    value = value[key];
  }
  return JSON.stringify(value);
}

export { deepMerge, applyPatch };
export function partitionNormalizationPatch({ liveState, baselineState, existingOps = [], rawPatch = [], validate = () => {}, apply = applyPatch, normalize = state => state, allowedUnitIds }) {
  const candidates = [], rejected = [];
  for (const [index, operation] of (Array.isArray(rawPatch) ? rawPatch : []).entries()) {
    const unitId = typeof operation?.path === 'string' ? operation.path.match(/^\/units\/([^/]+)/)?.[1] : undefined;
    if (!['add', 'replace', 'remove'].includes(operation?.op) || typeof operation.path !== 'string' ||
        !normalizationPath.test(operation.path) || (operation.op !== 'remove' && !own(operation, 'value')) ||
        (unitId && allowedUnitIds && !allowedUnitIds.includes(unitId))) {
      rejected.push({ index, op: operation, path: typeof operation?.path === 'string' ? operation.path : '', reason: '路径或操作不在允许白名单内' });
    } else candidates.push({ index, op: operation, lastError: '' });
  }
  const strip = item => { const { resolves, ...operation } = item.op; return operation; };
  const trial = (live, base, items) => {
    const operations = items.map(strip);
    const nextLive = apply(clone(live), operations, true);
    const nextBase = apply(clone(base), operations, true);
    for (const state of [nextLive, nextBase]) { normalize(state); validate(state); }
    return { nextLive, nextBase };
  };
  let workLive = clone(liveState), workBase = apply(clone(baselineState), existingOps, true);
  try {
    const { nextLive, nextBase } = trial(workLive, workBase, candidates);
    return { accepted: candidates, rejected, workLive: nextLive, workBase: nextBase };
  } catch (_) { /* isolate invalid operations below */ }
  const accepted = [], remaining = candidates.slice();
  while (remaining.length) {
    let progressed = false; const next = [];
    for (const item of remaining) {
      try {
        const result = trial(workLive, workBase, [item]);
        workLive = result.nextLive; workBase = result.nextBase; accepted.push(item); progressed = true;
      } catch (error) { item.lastError = error?.message || '补丁校验失败'; next.push(item); }
    }
    if (!progressed) { rejected.push(...next.map(item => ({ index: item.index, op: item.op, path: item.op.path, reason: item.lastError }))); break; }
    remaining.splice(0, remaining.length, ...next);
  }
  return { accepted, rejected, workLive, workBase };
}
export function formatRejectedItem(item, state = {}) {
  const [, table, id] = String(item.path || '').split('/');
  const entity = item.op?.value?.name || state?.[table]?.[id]?.name || id || '未知条目';
  return `[未应用] ${table === 'skills' ? '技能' : table === 'equipment' ? '装备' : '条目'}「${entity}」(${item.path || '无路径'})：${item.reason || '补丁校验失败'}`;
}
export const normalizationPath = /^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/;

export const TAVERN_VERSION = '0.4.0';

const DEFAULT_CONFIG = {
  apiMode: 'tavern', baseUrl: '', apiKey: '', model: '', temperature: 0.8, max_tokens: 32000,
  battleAiEnabled: false, battleAiMode: 'same', battleAiBaseUrl: '', battleAiApiKey: '', battleAiModel: '', battleAiApiTransport: 'direct', battleAiApiSource: 'openai',
  extraBody: '{}', excludeParams: '', headers: '{}', hideLauncher: false, autoScan: true, autoDeliverBattleReport: true,
  charSnapshots: {}, rosterSelection: null, normalizationBatches: {}, narrativeExemptions: {}, unresolvedNotes: {},
  ...Object.fromEntries(Object.entries(normalizationLimits).map(([key, { fallback }]) => [key, fallback])),
  slots: describeSlots(), extraText: '', aiSessions: { sessions: [], activeId: null }, debugPrompts: false, apiSource: 'openai', stream: true, timeoutMs: 240000,
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
  // Opening sources end at the entry floor, even when later narration is visible.
  const joined = list.slice(0, sourceIndex + 1).map(messageContent).join('\n');
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

const chatTables = ['units', 'skills', 'equipment', 'items', 'statusTemplates', 'covers', 'interactives', 'zones'];
export function chatPatch(state, payload) {
  const unrecognized = () => new Error('无法识别该 JSON 的目标路径，请让 AI 输出 {"patch":[{"op":"replace","path":"/...","value":...}]} 格式');
  const semantic = payload?.battle_patch ?? payload;
  const list = [payload, payload?.patch, payload?.patches, payload?.jsonPatch, payload?.battle_patch, payload?.unit_patch].find(Array.isArray)
    ?? (payload?.op ? [payload] : null);
  if (list) {
    for (const operation of list) {
      if (!['add', 'replace', 'remove'].includes(operation?.op) || (operation.op !== 'remove' && !own(operation, 'value'))) {
        throw new Error(`不支持的补丁操作：${operation?.path ?? '缺少路径'}`);
      }
      if (typeof operation.path !== 'string' || !operation.path.startsWith('/')) throw new Error('补丁路径必须以 / 开头');
    }
    return list;
  }
  if (!isObject(semantic)) throw unrecognized();
  const slice = Object.fromEntries(chatTables.filter(key => own(semantic, key)).map(key => [key, semantic[key]]));
  if (isObject(semantic.unit_patch)) {
    const { unitId, id = unitId, patch } = semantic.unit_patch;
    if (!id || !safeProperty(id) || !own(state.units, id) || !isObject(patch)) throw unrecognized();
    slice.units = { ...slice.units, [id]: patch };
  }
  if (Object.keys(slice).length) return normalizeSemanticPatch(slice);
  if (typeof semantic.name !== 'string') throw unrecognized();
  const matches = ['skills', 'equipment', 'statusTemplates'].flatMap(table => Object.entries(state[table] ?? {})
    .filter(([id, value]) => semantic.id ? id === semantic.id : value.name === semantic.name)
    .map(([id]) => ({ table, id })));
  const inferred = own(semantic, 'ap') || own(semantic, 'slot') ? 'skills'
    : own(semantic, 'kind') || own(semantic, 'weaponClass') ? 'equipment'
    : own(semantic, 'durationType') || own(semantic, 'maxStacks') || own(semantic, 'category') ? 'statusTemplates' : undefined;
  const scoped = inferred ? matches.filter(match => match.table === inferred) : matches;
  if (scoped.length > 1) throw unrecognized();
  const table = scoped[0]?.table ?? inferred, id = scoped[0]?.id ?? semantic.id;
  if (!table || typeof id !== 'string' || !id || !safeProperty(id)) throw unrecognized();
  const { id: ignored, ...definition } = semantic;
  const path = `/${table}/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  return [{ op: own(state[table], id) ? 'replace' : 'add', path, value: table === 'statusTemplates' ? { ...definition, id } : definition }];
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
  let selectedMessageId = null, selectedBattleText = '', aiController = null, aiFinished, retryAI = null, aiPage = null;
  let characters = {}, scanStatus = '';
  const openingSources = new Map();
  const enteredBattles = new Set();
  const selectedIds = () => (config.rosterSelection ?? Object.keys(config.instances)).filter(key => own(config.instances,key));
  const batches = key => config.normalizationBatches?.[key] ?? [];
  const operations = key => batches(key).flatMap(batch=>batch.patch);
  let battleObserver = null, diagnostics = { phase: 'created' };
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
  const warningDisplay = message => diagnosticText(
    message.replace(/[。\s]*请(?:用|提供)\s*VM\s+rules\s*\/\s*mods\s*\/\s*pools[\s\S]*$/, ''),
    '原诊断包含结构化数据，未提供文字说明');
  const pendingTitle = count => `⏳ 待标准化（${count} 项）`;
  const modelTitle = count => `ℹ️ 模型说明：受限 / 部分实现（${count} 项）`;
  const modelLine = ({ effectName, reason }) => `「${effectName}」 — ${reason}`;
  function warningGroups(warnings = sources.warnings ?? []) {
    const pending = [], reviewed = [];
    const notes = config.unresolvedNotes[activeBattleKey] ?? {};
    const sourceFor = narrativeSourceFor(characters);
    for (const warning of warnings) {
      const note = notes[warning.unitId ?? '']?.[warningKey(warning)];
      if (note?.source === sourceFor(warning.unitId) && note?.reason) reviewed.push({ warning, ...note });
      else pending.push(warning);
    }
    return { pending, reviewed };
  }
  function appendWarningGroups(container, { pending, reviewed }, expandable = false) {
    const add = (kind, label, rows) => {
      if (!rows.length) return;
      const group = el(doc, expandable ? 'details' : 'div', { class: 'fated-char-diagnostics', 'data-normalization-diagnostics': kind });
      const list = el(doc, 'ul');
      for (const [text, original] of rows) list.append(el(doc, 'li', original ? { title: original } : {}, text));
      group.append(el(doc, expandable ? 'summary' : 'h4', {}, label), list);
      container.append(group);
    };
    add('pending', pendingTitle(pending.length), pending.map(warning => [warningDisplay(warning.message)]));
    add('reviewed', modelTitle(reviewed.length), reviewed.map(note => [modelLine(note), warningDisplay(note.warning.message)]));
  }
  let rawDetails;
  function notify(title, detail = '', onRetry = null, busy = false, { tone = 'neutral', applied, unresolved = [], warningGroups: groups, raw = '' } = {}) {
    retryAI = onRetry;
    toast.dataset.tone = tone;
    icon.textContent = busy ? '…' : tone === 'success' ? '✓' : tone === 'warning' ? '⚠' : tone === 'error' ? '!' : 'ⓘ';
    summary.hidden = applied == null;
    summary.textContent = applied == null ? '' : `已应用 ${applied} 项补丁${groups ? '' : ` · 剩余 ${unresolved.length} 项未解决`}`;
    rawDetails?.remove();
    rawDetails = null;
    issues.remove();
    issues.replaceChildren();
    if (groups) appendWarningGroups(issues, groups);
    if (unresolved.length) {
      const list = el(doc, 'ul');
      for (const issue of unresolved) list.append(el(doc, 'li', {}, issue));
      issues.append(el(doc, 'h4', {}, `未解决（${unresolved.length} 项）`), list);
    }
    if (issues.childElementCount) toast.insertBefore(issues, actions);
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
    if (config.autoScan !== false) { selectedMessageId = null; selectedBattleText = ''; await scan(); }
  }
  async function openBattleEntry(messageId, battleText = '') {
    if (messageId == null && !battleText) return open();
    selectedMessageId = messageId == null ? null : String(messageId);
    selectedBattleText = battleText;
    panel.hidden = false;
    launcher.hidden = true;
    switchTab('sandbox');
    await scan();
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
    const bind = (name, handler) => {
      try {
        const result = eventOn(name, handler);
        listeners.push(typeof result === 'function' ? result : typeof result?.off === 'function'
          ? () => result.off() : () => hostMethod(host, 'eventRemoveListener')?.(name, handler));
      } catch (_) { /* event bus is optional outside JS-Slash-Runner */ }
    };
    bind('fated_tactical:open_ui', entry => { openBattleEntry(entry?.messageId, text(entry?.battleText)).catch(showError); });
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
      void openBattleEntry(floor?.getAttribute('mesid') ?? floor?.dataset.messageId ?? floor?.dataset.mesid);
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
    // 折叠状态按实例 ID 保存，人多时可以只展开正在看的那几张
    const collapsed = () => isObject(config.collapsedInstances) ? config.collapsedInstances : {};
    const setFolded = (ids, value) => { const next = { ...collapsed() }; for (const id of ids) { if (value) next[id] = true; else delete next[id]; } persistSettings({ collapsedInstances: next }); };
    for (const [label,value] of [['全部折叠',true],['全部展开',false]]) { const b=el(doc,'button',{type:'button','data-fold-all':String(value)},label); on(b,'click',()=>{ setFolded(Object.keys(config.instances),value); renderInstances(); }); toolbar.append(b); }
    const list = el(doc, 'div'); page.append(list);
    const entries = Object.entries(config.instances);
    if (!entries.length) list.append(el(doc, 'p', { class: 'fated-mini' }, '暂无实例。打开沙盘会自动读取当前 MVU、char_info 和 battle_init。'));
    for (const [key, instance] of entries) {
      const box = el(doc, 'article', { class: 'fated-instance' });
      box.dataset.unitId = key;
      const select = el(doc,'input',{type:'checkbox','aria-label':`选择 ${instance.name || key}`});
      select.checked = selectedIds().includes(key);
      on(select,'change',()=>choose(select.checked?[...new Set([...selectedIds(),key])]:selectedIds().filter(k=>k!==key)));
      const groups = warningGroups(warningsForUnit(sources.warnings, [key], false));
      const { body } = fillInstance(box,(tag,attrs,value)=>el(doc,tag,attrs,value),instance,liveState(),characters[key]?.raw,select,
        { collapsed: Boolean(collapsed()[key]), warnings: groups.pending.length,
          narrative: (diagnostics.narrativeExemptions ?? []).filter(entry => entry.unitId === key), canDiscardEntry: path => operations(activeBattleKey).some(operation => operation.path === path || operation.path.startsWith(`${path}/`)) ||
            (diagnostics.inputWarnings ?? []).some(warning => warning.originPath === path && warning.unitId === key && !warningGroups([warning]).pending.includes(warning)), onDiscardEntry: ref => discardStandardizedEntry(activeBattleKey, { ...ref, unitId: key }), onToggle: value => setFolded([key], value) });
      appendWarningGroups(body, groups, true);
      const actions = el(doc, 'div', { class: 'fated-actions' }); const edit = el(doc, 'button', { type: 'button' }, '编辑 JSON'); const remove = el(doc, 'button', { type: 'button' }, '删除');
      actions.append(edit, remove); body.append(actions); list.append(box);
      on(remove, 'click', () => { delete config.instances[key]; save(); choose(selectedIds()); });
      on(edit, 'click', () => { const value = prompt('编辑实例 JSON', JSON.stringify(instance, null, 2)); const parsed = parseJSON(value, null); if (isObject(parsed)) { config.instances[key] = { ...parsed, id:key, source:'AI 编辑' }; save(); renderInstances(); } });
    }
    on(refresh, 'click', () => {
      if (!host.confirm('从当前聊天重新读取本场参战者？这会重置本场战斗进度、清除本场标准化补丁并恢复原始诊断。不会请求 AI，也不影响其他战场。')) return;
      void scan({ rehydrate: true });
    });
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
  function prepareMessages(kind = promptKind, instruction = promptInstruction, sending = false, unitIds, warnings) {
    const slots = config.slots;
    const context = assemblyContext(kind, instruction, unitIds);
    if (kind === 'chat') context.sources = { ...sources, warnings: [] };
    else if (warnings) context.sources = { ...sources, warnings };
    const messages = assembleMessages(slots, context);
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
  async function runNormalize(unitIds = Object.keys(characters), { force = false } = {}) {
    if (aiController || !activeBattleKey || !liveState()) return;
    syncSettings();
    const key = activeBattleKey;
    const requestConfig = { ...config };
    const stored = config.charSnapshots[key] ?? {};
    const eligible = new Set(force ? Object.keys(characters) : normalizationCandidates(characters, stored, warningGroups().pending));
    const ids = unitIds.filter(id => eligible.has(id));
    if (!ids.length) return;
    const scoped = warningsForUnit(sources.warnings, ids);
    const { pending } = warningGroups(scoped);
    const pendingIds = new Set(pending.map(warning => warning.unitId));
    const queueIds = pending.length && !pendingIds.has(null) ? ids.filter(id => pendingIds.has(id)) : ids;
    const queue = planNormalizationBatches(queueIds, pending, liveState(), {
      maxWarnings: normalizationLimit(requestConfig, 'normalizationWarningsPerBatch'),
    });
    if (!queue.length) return;
    const controller = new AbortController();
    aiController = controller;
    let finish;
    aiFinished = new Promise(resolve => { finish = resolve; });
    aiPage?.setBusy(true);
    renderInstances();
    let applied = 0, completed = 0, failure;
    const replies = [], notes = [], rejectedItems = [];
    const createdTemplates = new Map();
    const progress = detail => notify('正在标准化中…', detail ?? `已完成 ${completed} / ${queue.length} 批`, null, true);
    const request = async (batch, index, correction) => {
      const snapshot = clone(liveState());
      const warnings = batch.warnings.filter(warning => sources.warnings.includes(warning));
      let prompts = prepareMessages('validate', '', true, batch.unitIds, warnings);
      const sent = warnings.filter(warning => prompts.some(message => message.content.includes(JSON.stringify(warning.message))));
      if (!prompts.length) throw new Error('没有可发送的提示词，请在提示词组装页启用有内容的槽位');
      if (correction) {
        prompts = [...prompts, { role: 'user', content: `上一条输出无法应用（${correction.message}）。请根据此消息中的最新快照调整，重新输出完整 JSON 对象。${correction.raw ? `\n上一条输出：${correction.raw.slice(0, 3500)}` : ''}` }];
        lastSent = prompts;
        publishMessages(prompts, 'validate');
      }
      const timeout = new AbortController();
      const signal = AbortSignal.any([controller.signal, timeout.signal]);
      signal.throwIfAborted();
      const timer = setTimeout(() => timeout.abort(new Error('请求超时，请检查酒馆主接口或独立 API')), requestConfig.timeoutMs ?? 240000);
      try {
        const reply = await requestTavernAI(host, requestConfig, prompts, options.fetch, signal, (text, done, info) => {
          if (!disposed && !signal.aborted) progress(`第 ${index + 1} 批${info?.isHeartbeat ? `已等待 ${info.elapsedSec} 秒` : done ? '已收到响应，等待校验' : `已收到 ${text.length} 字符`}`);
        });
        signal.throwIfAborted();
        return { snapshot, sent, reply };
      } finally { clearTimeout(timer); }
    };
    progress();
    try {
      await runOrderedBatches(queue, normalizationLimit(requestConfig, 'normalizationConcurrency'), request, async (result, batch, index) => {
        controller.signal.throwIfAborted();
        try {
          if (result.error) throw result.error;
          let accepted;
          try { accepted = commitNormalization(key, batch, result.value, createdTemplates); }
          catch (error) {
            progress(`第 ${index + 1} 批正在修正输出`);
            try {
              const revised = await request(batch, index, error);
              controller.signal.throwIfAborted();
              accepted = commitNormalization(key, batch, revised, createdTemplates, { acceptPartial: true });
            } catch (retryError) {
              controller.signal.throwIfAborted();
              if (!error.missingCoverage || key !== activeBattleKey) throw retryError;
              // Revalidate the initial response before preserving usable partial work.
              accepted = commitNormalization(key, batch, result.value, createdTemplates, { acceptPartial: true });
            }
          }
          applied += accepted.applied;
          replies.push(accepted.data);
          notes.push(...accepted.notes);
          rejectedItems.push(...accepted.rejected);
          completed++;
          progress();
        } catch (error) {
          failure ??= error;
          if (controller.signal.aborted) throw error;
          completed++;
          progress(`第 ${index + 1} 批失败；继续处理其余批次`);
        }
      }, controller.signal);
    } catch (error) { failure ??= error; }
    finally {
      const groups = warningGroups(warningsForUnit(sources.warnings, ids));
      const unresolved = [...rejectedItems.map(item => formatRejectedItem(item, liveState())), ...pendingDiagnostics([], notes)];
      const hasRemaining = groups.pending.length || groups.reviewed.length || unresolved.length;
      const raw = replies.length ? JSON.stringify(replies.length === 1 ? replies[0] : replies, null, 2) : failure?.raw ?? '';
      const aborted = failure?.name === 'AbortError';
      const partial = applied > 0 && (rejectedItems.length || failure || groups.pending.length);
      const title = aborted ? '标准化已中止' : partial && rejectedItems.length
        ? `标准化部分完成（已生效 ${applied} 项，${rejectedItems.length} 项报错未应用）`
        : partial || (!failure && groups.pending.length) ? '标准化部分完成' : failure ? '标准化失败' : '标准化完成';
      const detail = failure ? diagnosticText(failure.message ?? failure, '请求或补丁校验失败，未返回可读的错误说明') : '';
      if (!disposed && key === activeBattleKey) {
        const remainingIds = [...new Set([...groups.pending, ...groups.reviewed].map(warning => warning.unitId).filter(id => ids.includes(id)))];
        const retry = () => key === activeBattleKey && runNormalize(remainingIds.length && !groups.pending.some(w => !w.unitId) ? remainingIds : ids, { force: true });
        notify(title, detail, !aborted && (failure || hasRemaining) ? retry : null,
          false, { tone: aborted ? 'neutral' : partial || groups.pending.length && !failure ? 'warning' : failure ? 'error' : 'success', applied, unresolved, warningGroups: groups, raw });
      }
      aiController = null;
      if (!disposed) { aiPage?.setBusy(false); renderInstances(); }
      finish();
    }
  }

  const battleStorageKey = (key, field) => `fated-tactical/${key}/${field}`;
  function readBattleStorage(key, field) {
    try { return parseJSON(storage?.getItem(battleStorageKey(key, field))); }
    catch { return null; }
  }
  async function hydrate(epoch, candidate, rehydrate) {
    const key = candidate.battleKey;
    const opening = !rehydrate && key && (openingSources.get(key) ?? readBattleStorage(key, 'opening-source'));
    const nextSources = opening ? clone(opening) : candidate;
    if (key && !opening) {
      nextSources.mvuData = clone(await readBattleVariables(host, Number(candidate.source?.messageId)));
      nextSources.protagonistName = tavernIdentity(host);
    }
    if (epoch !== scanEpoch || disposed) return null;
    const openingSource = !opening && key ? clone(nextSources) : null;
    if (!nextSources.battleInit) {
      sources = nextSources;
      diagnostics = { phase: 'no-battle' };
      config.instances = {};
      return null;
    }
    const converter = options.converter || getGlobal(host, 'FatedTactical')?.hydrateBattleState || getGlobal(host, 'hydrateBattleState') || hydrateBattleState;
    let hydrated = null;
    let conversionError = null;
    if (typeof converter === 'function') {
      const { mvuData, charInfo, battleInit, protagonistName } = nextSources;
      const input = { mvu: mvuData, stat_data: mvuData, charInfo, battleInit, protagonistName };
      try { hydrated = await converter(input); }
      catch (error) { conversionError = error; }
    }
    if (epoch !== scanEpoch || disposed) return null;
    if (conversionError) {
      diagnostics = { phase: 'conversion-error', error: conversionError?.stack || conversionError?.message || String(conversionError), mvuKeys: Object.keys(nextSources.mvuData || {}), charCount: nextSources.charInfo?.length || 0, participantCount: nextSources.battleInit?.units?.length || nextSources.battleInit?.participants?.length || 0 };
      try { console.error('[fated-tactical] hydrate failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      throw conversionError;
    }
    sources = nextSources;
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
    if (openingSource && hydrated?.state) {
      openingSources.set(key, openingSource);
      putConfig(storage, battleStorageKey(key, 'opening-source'), openingSource);
    }
    return hydrated;
  }
  let stopTerrainNotices;
  function refreshPortraits(state, epoch) {
    const mount = gameMount;
    if (!mount?.setPortraits || !state) return;
    const isCurrent = () => !disposed && gameMount === mount && scanEpoch === epoch;
    void readBattlePortraits(host, state.units, sources.sourceMap ?? {}, isCurrent).then(portraits => {
      if (isCurrent()) mount.setPortraits(portraits);
    }).catch(() => { /* Portraits are optional. */ });
  }

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
      battleAiRequest: async (messages, signal) => {
        syncSettings();
        const battleConfig = config.battleAiMode === 'custom'
          ? { ...config, apiMode: 'custom', baseUrl: config.battleAiBaseUrl, apiKey: config.battleAiApiKey, model: config.battleAiModel,
              apiTransport: config.battleAiApiTransport, apiSource: config.battleAiApiSource, stream: false, max_tokens: 32000 }
          : { ...config, stream: false, max_tokens: 32000 };
        return requestTavernAI(host, battleConfig, messages, options.fetch, signal);
      },
      onVictory() {
        syncSettings;
        if (config.autoDeliverBattleReport !== false) void deliverBattleReport();
      },
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
  function narrativeSourceFor(records) {
    // Global diagnostics have no character source. Bind them to the entire opening input.
    const globalSource = JSON.stringify([sources.battleRaw, sources.mvuData, sources.charInfo]);
    return id => id === null ? globalSource : records[id]?.hash;
  }
  function filterResolved(stored, records, retained = batches(activeBattleKey)) {
    const warnings = sources.warnings ??= [];
    const exempt = activeNarrativeExemptions(diagnostics.inputWarnings ?? warnings,
      config.narrativeExemptions[activeBattleKey] ?? [], narrativeSourceFor(records));
    const excluded = new Set(exempt.map(({ warning }) => warning));
    const remaining = remainingDiagnostics(warnings, stored, records, retained);
    warnings.splice(0, warnings.length, ...remaining.filter(warning => !excluded.has(warning)));
    diagnostics.warnings = warnings;
    diagnostics.narrativeExemptions = exempt.map(({ warning, receipt }) => ({ ...warningReference(warning), reason: receipt.reason }));
  }
  function reconcileUnresolvedNotes(key, records, warnings, additions = [], { reset = false } = {}) {
    const previous = config.unresolvedNotes[key] ?? {};
    const next = {};
    const sourceFor = narrativeSourceFor(records);
    for (const warning of warnings) {
      const unitId = warning.unitId ?? '';
      const id = warningKey(warning);
      const source = sourceFor(warning.unitId);
      if (!source) continue;
      const details = [...new Set(additions.filter(note => note.warning === warning).map(note => note.detail).filter(Boolean))];
      const old = reset ? undefined : previous[unitId]?.[id];
      const note = details.length ? {
        source,
        effectName: warning.message.match(/待标准化「([^」]+)」/)?.[1]?.trim() || warningDisplay(warning.message),
        reason: details.join('；'),
      } : old?.source === source ? old : undefined;
      if (note) (next[unitId] ??= {})[id] = note;
    }
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const unresolvedNotes = { ...config.unresolvedNotes };
    if (Object.keys(next).length) unresolvedNotes[key] = next;
    else delete unresolvedNotes[key];
    persistSettings({ unresolvedNotes });
  }
  function liveState() { return gameMount?.getState?.() ?? currentState; }
  function pathUnder(path, root) { return path === root || path?.startsWith(`${root}/`); }
  function discardStandardizedEntry(key, ref) {
    const source = ref.path;
    if (!source || !/^\/(?:equipment|skills|items|statusTemplates)\/[^/]+$/.test(source)) return;
    const [, table, id] = source.split('/');
    const baseline = hydrateBattleState(sources.input, { throwOnValidation: true }).state;
    const current = liveState();
    if (!current?.[table] || !Object.hasOwn(current[table], id)) return;
    if (aiController) { notify('标准化进行中', '请等待当前批次完成后再重置大词条。'); return; }
    const rawWarnings = diagnostics.inputWarnings ?? [];
    // The reset changes the shared template, so reopen its diagnostics for every holder.
    const matchedKeys = new Set(rawWarnings.filter(warning => pathUnder(warning.originPath, source)).map(warningKey));
    const retained = [];
    for (const batch of batches(key)) {
      const patch = (batch.patch ?? []).filter(operation => !pathUnder(operation.path, source));
      const guards = (batch.guards ?? []).filter(([path]) => !pathUnder(path, source));
      const receipts = (batch.receipts ?? []).filter(receipt => !matchedKeys.has(receipt.key));
      if (patch.length || receipts.length || guards.length) retained.push({ ...batch, patch, guards, receipts });
    }
    // Restore exactly this named entry from the immutable hydrated snapshot. The
    // live state supplies combat progress and every unrelated entry, so this is
    // additive rollback rather than a battle rewind.
    const next = clone(current);
    next[table] = { ...next[table] };
    if (baseline[table][id] === undefined) delete next[table][id];
    else next[table][id] = clone(baseline[table][id]);
    try { (options.validateState || defaultValidateState)(next); } catch (error) { showError(error); return; }
    gameMount?.loadState?.(next);
    currentState = next;
    const exemptions = (config.narrativeExemptions[key] ?? []).filter(receipt => !matchedKeys.has(receipt.key));
    const notes = clone(config.unresolvedNotes[key] ?? {});
    for (const [unitId, entries] of Object.entries(notes)) {
      for (const warningId of Object.keys(entries)) if (matchedKeys.has(warningId)) delete entries[warningId];
      if (!Object.keys(entries).length) delete notes[unitId];
    }
    const snapshots = clone(config.charSnapshots);
    for (const snapshot of Object.values(snapshots[key] ?? {})) {
      if (snapshot.resolvedWarnings) snapshot.resolvedWarnings = snapshot.resolvedWarnings.filter(item => !matchedKeys.has(item.key ?? item));
    }
    const nextWarnings = [...rawWarnings];
    sources.warnings = nextWarnings;
    diagnostics.warnings = nextWarnings;
    persistSettings({
      normalizationBatches: { ...config.normalizationBatches, [key]: retained },
      narrativeExemptions: { ...config.narrativeExemptions, [key]: exemptions },
      unresolvedNotes: { ...config.unresolvedNotes, [key]: notes },
      charSnapshots: snapshots,
    });
    filterResolved(snapshots[key] ?? {}, characters, retained);
    reconcileUnresolvedNotes(key, characters, sources.warnings, [], { reset: false });
    renderInstances();
  }
  function applyNormalization(state, patch) {
    if (!patch?.length) return state;
    const next = applyPatch(state, patch, true);
    (options.validateState || defaultValidateState)(next);
    refreshOpeningInitiative(next);
    syncEquipmentEffects(next);
    refreshOutcome(next);
    return next;
  }
  async function scan({ rehydrate = false } = {}) {
    const epoch = ++scanEpoch;
    const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = '正在读取 MVU、最新楼层并转换…';
    try {
      const chat = chatId(host);
      const messages = await tavernMessages(host);
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      let entryId = selectedMessageId;
      if (entryId == null && selectedBattleText) {
        const entryIndex = messages.findLastIndex(message => message?.role !== 'user' && !message?.is_user &&
          extractTag(messageContent(message), ['battle_init'])?.trim() === selectedBattleText.trim());
        if (entryIndex >= 0) entryId = messageMeta(messages[entryIndex], entryIndex).messageId;
      }
      const candidate = sourceBundle({}, messages, chat, entryId);
      const key = candidate.battleKey;
      foldBattleEntries();
      if (!rehydrate && key && activeBattleKey === key && gameMount) {
        refreshPortraits(currentState, epoch);
        if (node) node.textContent = `已续接当前战局 · ${scanStatus}`;
        return;
      }
      if ((rehydrate || activeBattleKey !== key) && aiController) {
        const finished = aiFinished;
        aiController.abort();
        await finished;
        if (epoch !== scanEpoch || disposed) return;
      }
      const savedBattle = Boolean(key && readBattleStorage(key, 'fated-tactical/battle-v1')?.kind === 'battle');
      const hydrated = await hydrate(epoch, candidate, rehydrate);
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      const nextState = hydrated?.state ?? null;
      const fresh=key ? await characterRecords(sources,hydrated) : {};
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      syncSettings();
      const ids=Object.keys(fresh), stored=rehydrate ? {} : {...(config.charSnapshots[key]??{})};
      const removed=Object.keys(stored).filter(id=>!fresh[id]);
      diagnostics.removedCharacters=removed;
      for(const id of removed) delete stored[id];
      const rawWarnings = sources.warnings ?? [];
      diagnostics.inputWarnings = [...rawWarnings];
      const kept = [];
      let replay = nextState;
      for (const batch of rehydrate ? [] : batches(key)) {
        const owners = Object.entries(batch.hashes);
        const matchesHash = ([id, hash]) => fresh[id]?.hash === hash;
        const sameInput = batch.receipts ? owners.every(matchesHash) : owners.some(matchesHash);
        const sameDiagnostics = batch.receipts?.length && batch.receipts.every(({ unitId, key }) => fresh[unitId]
          && rawWarnings.some(w => w.unitId === unitId && warningKey(w) === key));
        if (!sameInput && !sameDiagnostics) continue;
        if (batch.guards && !batch.guards.every(([path, value]) => (fingerprintAt(replay, path) ?? null) === value)) continue;
        try {
          replay = applyPatch(replay, batch.patch, true);
          kept.push(batch);
        } catch (_) { /* a previous patch or its target is no longer available */ }
      }
      const invalid = batches(key).length !== kept.length;
      const exempt = new Set(activeNarrativeExemptions(rawWarnings, config.narrativeExemptions[key] ?? [], narrativeSourceFor(fresh))
        .map(({ warning }) => warning));
      const remaining = remainingDiagnostics(rawWarnings, stored, fresh, kept).filter(warning => !exempt.has(warning));
      toast.hidden = true;
      currentState = nextState ? applyNormalization(nextState, kept.flatMap(batch => batch.patch)) : null;
      if (invalid) persistSettings({normalizationBatches:{...config.normalizationBatches,[key]:kept}});
      mountState(currentState, savedBattle && !rehydrate);
      refreshPortraits(currentState, epoch);
      activeBattleKey = key;
      characters = fresh;
      const changed = normalizationCandidates(fresh, stored, warningGroups(remaining).pending);
      for(const id of changed) if(stored[id]?.hash!==fresh[id].hash) stored[id]={hash:fresh[id].hash,sourceKind:fresh[id].sourceKind,at:Date.now(),normalized:false};
      if(key && (rehydrate||changed.length||removed.length)) persistSettings({charSnapshots:{...config.charSnapshots,[key]:stored}});
      if((rehydrate || config.rosterSelection===null) && ids.length) persistSettings({rosterSelection:ids});
      filterResolved(stored, fresh, kept);
      if (key) reconcileUnresolvedNotes(key, fresh, sources.warnings, [], { reset: rehydrate });
      const live=liveState();
      for(const unit of Object.values(live?.units??{})) if(config.instances[unit.id]) Object.assign(config.instances[unit.id],unit);
      const firstEntry = !rehydrate && currentState && key && !savedBattle && !enteredBattles.has(key);
      if (key && currentState) enteredBattles.add(key);
      scanStatus = firstEntry && changed.length ? `待标准化 ${changed.length} 个角色` : '可手动标准化所选角色';
      renderInstances();
      if (firstEntry && changed.length) void runNormalize(changed, { force: false });
      if (node) node.textContent = currentState
        ? `扫描完成：${Object.values(currentState.units || {}).map(unit => `${unit.name}(${unit.id})`).join('、')} · ${scanStatus}`
        : '扫描完成（未找到可挂载的战局）。';
    } catch (e) {
      diagnostics = { ...diagnostics, phase: 'scan-error', error: e?.stack || e?.message || String(e) };
      try { console.error('[fated-tactical] scan failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      showError(e);
      notify('战局加载失败', e.message, () => scan({ rehydrate }));
    }
  }
  async function deliverBattleReport() {
    const mount = gameMount;
    try {
      const result = mount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.();
      if (!result?.trim()) throw new Error('当前没有可交付的战报。');
      const textarea = doc.querySelector('#send_textarea');
      const clipboard = doc.defaultView?.navigator?.clipboard;
      if (textarea) {
        textarea.value = result;
        textarea.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        clipboard?.writeText(result).catch(() => {});
      } else {
        if (!clipboard) throw new Error('找不到聊天输入框，也无法写入剪贴板。');
        await clipboard.writeText(result);
      }
      if (disposed || gameMount !== mount) return;
      pages.sandbox.querySelector('[data-status]').textContent = result;
      closePanel();
    } catch (error) {
      showError(error);
    }
  }
  function renderSandbox() {
    const page = pages.sandbox; page.replaceChildren(el(doc, 'h3', {}, '沙盘'));
    const status = el(doc, 'div', { class: 'fated-status', 'data-status': '' }, '打开此页会自动侦测当前聊天。'); page.append(status);
    const mountTarget = el(doc, 'div', { 'data-sandbox-mount': '' }); page.append(mountTarget);
    const actions = el(doc, 'div', { class: 'fated-actions' }); const report = el(doc, 'button', { type: 'button' }, '战报交付'); const refresh = el(doc, 'button', { type: 'button' }, '重新扫描'); actions.append(report, refresh); page.append(actions);
    const autoDeliver = el(doc, 'input', { type: 'checkbox', 'data-auto-deliver-report': '' });
    autoDeliver.checked = config.autoDeliverBattleReport !== false;
    const deliveryLabel = el(doc, 'label');
    deliveryLabel.append(autoDeliver, ' 胜负已定时自动交付战报');
    actions.append(deliveryLabel);
    on(autoDeliver, 'change', () => persistSettings({ autoDeliverBattleReport: autoDeliver.checked }));
    const hideLauncher = el(doc, 'input', { type: 'checkbox', 'data-hide-launcher': '' });
    hideLauncher.checked = Boolean(config.hideLauncher);
    const hideLabel = el(doc, 'label');
    hideLabel.append(hideLauncher, ' 隐藏悬浮按钮到魔术棒菜单');
    actions.append(hideLabel);
    on(hideLauncher, 'change', () => { persistSettings({ hideLauncher: hideLauncher.checked }); updateMagic(); });
    on(refresh, 'click', () => scan().catch(showError));
    on(report, 'click', deliverBattleReport);
  }
  function commitNormalization(key, { unitIds }, { snapshot, sent, reply }, createdTemplates, { acceptPartial = false } = {}) {
    const { data } = parseAIResponse(reply);
    if (!Array.isArray(data?.patch)) throw new Error('模型未返回有效的战局补丁');
    const raw = JSON.stringify(data, null, 2);
    try {
      const notes = readUnresolvedDiagnostics(data.unresolved, sent);
      const records = Object.fromEntries(unitIds.map(id => [id, { hash: characters[id].hash, sourceKind: characters[id].sourceKind }]));
      const current = liveState();
      const conflicts = [];
      const rebasedPatch = data.patch.flatMap((operation, index) => {
        if (typeof operation?.path !== 'string') return [operation];
        try { return normalizationOperations([operation], snapshot, current, createdTemplates, fingerprintAt); }
        catch (error) { conflicts.push({ index, op: operation, path: operation.path, reason: error.message }); return []; }
      });
      const baselineForPartition = hydrateBattleState(sources.input, { throwOnValidation: true }).state;
      const partition = partitionNormalizationPatch({
        liveState: current, baselineState: baselineForPartition, existingOps: operations(key), rawPatch: rebasedPatch,
        allowedUnitIds: unitIds, apply: options.applyPatch ?? applyPatch, validate: options.validateState || defaultValidateState,
        normalize: state => { refreshOpeningInitiative(state); syncEquipmentEffects(state); refreshOutcome(state); },
      });
      const rejected = [...conflicts, ...partition.rejected];
      const blockedWarnings = new Set(sent.filter(warning => rejected.some(item =>
        (Array.isArray(item.op?.resolves) && item.op.resolves.some(reference => identifiesWarning(reference, warning)))
        || (warning.originPath && (item.path === warning.originPath || item.path.startsWith(`${warning.originPath}/`))))));
      const eligibleWarnings = sent.filter(warning => !blockedWarnings.has(warning));
      if (rejected.length && !partition.accepted.length) {
        throw new Error(rejected.map(item => formatRejectedItem(item, current)).join('；') || '所有补丁均未通过校验');
      }
      data.patch = partition.accepted.map(item => item.op);
      const rootPath = path => path.split('/').slice(0, path.startsWith('/units/') ? 4 : 3).join('/');
      const operationsToApply = data.patch;
      const paths = [...new Set(operationsToApply.map(operation => rootPath(operation.path)))];
      const apply = options.applyPatch ?? applyPatch;
      let next = current;
      const changedAtApply = new Map();
      for (const operation of operationsToApply) {
        const parentPath = operation.path.slice(0, operation.path.lastIndexOf('/'));
        // Inserting/removing array entries also shifts the values at other indexes.
        const path = operation.op === 'replace' || !fingerprintAt(next, parentPath)?.startsWith('[')
          ? operation.path : parentPath;
        const before = fingerprintAt(next, path);
        next = apply(next, [operation], true);
        if (fingerprintAt(next, path) !== before) changedAtApply.set(operation, path);
      }
      const changed = new Set(paths.filter(path => fingerprintAt(next, path) !== fingerprintAt(current, path)));
      const effective = operationsToApply.filter(operation => changed.has(rootPath(operation.path)));
      const patch = effective.map(({ resolves, ...operation }) => operation);
      const changedOperations = effective.filter(operation => {
        const path = changedAtApply.get(operation);
        return path && fingerprintAt(current, path) !== fingerprintAt(next, path);
      });
      const narrative = readNarrativeExemptions(data.narrative, eligibleWarnings, narrativeSourceFor(records), { unresolved: notes });
      const solved = resolvedDiagnostics(eligibleWarnings, records, changedOperations.map(operation => ({
        ...operation,
        mechanicsChanged: ['rules', 'mods', 'pools'].some(field => {
          const after = fingerprintAt(next, `${operation.path}/${field}`);
          return after !== undefined && after !== '[]' && after !== '{}'
            && after !== fingerprintAt(current, `${operation.path}/${field}`);
        }),
      })), notes, { narrative, inferPartial: true });
      for (const { warning } of narrative) {
        if (data.patch.some(operation => Array.isArray(operation.resolves) && operation.resolves.some(reference => identifiesWarning(reference, warning)))) {
          throw new Error('narrative 警告不能同时声明为补丁已解决');
        }
      }
      if (operationsToApply.length && !patch.length && !narrative.length && !data.existing?.length && !notes.some(note => note.warning && note.detail)) {
        throw new Error('模型返回的补丁没有改变战局');
      }
      let baseline, before;
      if (patch.length || data.existing?.length) {
        baseline = hydrateBattleState(sources.input, { throwOnValidation: true }).state;
        before = applyPatch(baseline, operations(key), true);
      }
      const verified = existingEffectReceipts(data.existing, sent, baseline, before, current, fingerprintAt)
        .filter(({ warning }) => !blockedWarnings.has(warning));
      for (const { warning, path, fingerprint } of verified) {
        if (notes.some(note => note.warning === warning) || narrative.some(note => note.warning === warning)
          || fingerprintAt(next, path) !== fingerprint) throw new Error('已有实现收据与本批补丁或未解决说明冲突');
        if (!solved.includes(warning)) solved.push(warning);
      }
      const missing = missingDispositions(sent, solved, notes, narrative);
      if (missing.length && !acceptPartial && !patch.length) {
        const error = new Error(`本批漏答 ${missing.length} 项：${missing.map(w => `${w.originPath ?? w.unitId}「${diagnosticTitle(w)}」`).join('、')}。本批尚未写入；保留已完成的补丁，重新提交完整结果。已实现的效果请在实际修改的操作上补 resolves；只创建依赖模板还须接回原技能。其余逐项写 unresolved 并说明原因，纯叙事才写 narrative。`);
        error.missingCoverage = true;
        throw error;
      }
      const additions = [];
      if (patch.length || verified.length) {
        const validate = options.validateState || defaultValidateState;
        validate(next);
        const previous = operations(key);
        validate(applyNormalization(baseline, [...previous, ...patch]));
        additions.push({
          patch, hashes: Object.fromEntries(unitIds.map(id => [id, records[id].hash])),
          receipts: solved.map(w => ({ unitId: w.unitId, key: warningKey(w) })),
          guards: [...new Set([...changed, ...verified.map(entry => entry.path), ...solved.map(w => w.originPath).filter(Boolean)])]
            .map(path => [path, fingerprintAt(before, path) ?? null]),
        });
        if (patch.length) {
          refreshOpeningInitiative(next);
          syncEquipmentEffects(next);
          refreshOutcome(next);
          validate(next);
          if (typeof gameMount?.loadState !== 'function') throw new Error('沙盘未就绪，无法注入补丁');
          gameMount.loadState(next);
          currentState = next;
          for (const unit of Object.values(next.units)) config.instances[unit.id] = { ...config.instances[unit.id], ...unit };
          save();
        }
      }
      const stored = { ...config.charSnapshots[key] };
      const rejectedUnits = new Set(rejected.flatMap(item => {
        const direct = item.path.match(/^\/units\/([^/]+)/)?.[1];
        if (direct) return [direct];
        return [...blockedWarnings].map(warning => warning.unitId).filter(Boolean);
      }));
      for (const [id, record] of Object.entries(records)) {
        const previous = stored[id]?.hash === record.hash ? stored[id].resolvedWarnings ?? [] : [];
        stored[id] = { ...record, at: Date.now(), normalized: !rejectedUnits.has(id), resolvedWarnings: previous };
      }
      syncSettings();
      const receipts = narrative.map(({ receipt }) => receipt);
      const previousExemptions = config.narrativeExemptions[key] ?? [];
      persistSettings({
        charSnapshots: { ...config.charSnapshots, [key]: stored },
        normalizationBatches: { ...config.normalizationBatches, [key]: [...batches(key), ...additions] },
        narrativeExemptions: { ...config.narrativeExemptions, [key]: [...previousExemptions.filter(previous => !receipts.some(receipt => receipt.unitId === previous.unitId && receipt.key === previous.key)), ...receipts] },
      });
      for (const { op, path } of effective) {
        if (op === 'add' && /^\/(?:statusTemplates|skills)\/[^/]+$/.test(path) && fingerprintAt(current, path) === undefined) {
          const fingerprint = fingerprintAt(next, path);
          if (fingerprint !== undefined) createdTemplates.set(path, fingerprint);
        }
      }
      filterResolved(stored, characters);
      reconcileUnresolvedNotes(key, characters, sources.warnings, notes);
      scanStatus = `已标准化 ${unitIds.length} 个角色`;
      renderInstances();
      return { applied: patch.length, data, notes, rejected };
    } catch (error) {
      error.raw = raw;
      throw error;
    }
  }
  function installChatState(next, previous) {
    (options.validateState || defaultValidateState)(next);
    gameMount.loadState(next);
    currentState = liveState();
    for (const id of Object.keys(previous.units)) if (!own(currentState.units, id)) delete config.instances[id];
    for (const unit of Object.values(currentState.units)) {
      const metadata = { ...config.instances[unit.id] };
      for (const key of Object.keys(previous.units[unit.id] ?? {})) delete metadata[key];
      config.instances[unit.id] = { ...metadata, ...clone(unit) };
    }
    save(); renderInstances(); prepareMessages();
  }

  function changeChatPatch(message, payload, undo = false) {
    if (aiController) return;
    const sessionId = aiSessions.active().id;
    if (!aiSessions.active().messages.includes(message) || message.status !== 'ok' || Boolean(message.undoReceipt) !== undo) return;
    try {
      const current = liveState();
      if (!activeBattleKey || !current || typeof gameMount?.loadState !== 'function') throw new Error('当前没有已加载的沙盘战局，请先扫描或进入战局');
      if (undo && message.undoReceipt.battleKey !== activeBattleKey) throw new Error('请返回应用补丁时的战局');
      const patch = undo ? chatInversePatch(current, message.undoReceipt.changes) : chatPatch(current, payload);
      const next = applyPatch(current, patch, Array.isArray(patch));
      if (!undo) {
        syncEquipmentEffects(next);
        refreshOutcome(next);
        if (!chatUndoChanges(current, next).length) throw new Error('此补丁没有改变当前战局');
      }
      installChatState(next, current);
      const undoReceipt = undo ? null : { battleKey: activeBattleKey, changes: chatUndoChanges(current, currentState) };
      aiSessions.update(sessionId, message, { undoReceipt, applyError: null,
        applyNotice: undo ? '✓ 已撤销' : `✓ 已应用至当前战局（变更 ${undoReceipt.changes.length} 处）` });
    } catch (error) {
      aiSessions.update(sessionId, message, { applyError: `${undo ? '撤销' : '应用'}失败：${error.message}` });
    }
    aiPage.feed(sessionId, message);
  }

  async function copyChatText(text) {
    try {
      await doc.defaultView.navigator.clipboard.writeText(text);
      return;
    } catch {
      // SillyTavern may be opened over plain HTTP on a LAN address.
    }
    const previousFocus = doc.activeElement;
    const field = el(doc, 'textarea', { readonly: '', tabindex: '-1' });
    field.value = text;
    field.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0';
    doc.body.append(field);
    try {
      field.select();
      if (!doc.execCommand?.('copy')) throw new Error('无法访问剪贴板');
    } finally {
      field.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
  }

  function regenerateChat(prepare) {
    if (aiController) return;
    const id = aiSessions.active().id;
    const turn = prepare(id);
    if (!turn) return;
    aiPage.render();
    askChat(turn.userMessage.content, id, turn);
  }
  async function askChat(requestText, sessionId = aiSessions.active().id, rerollTurn) {
    const session = aiSessions.get(sessionId);
    if (aiController || !requestText || !session) return;
    syncSettings();
    promptKind = 'chat';
    promptInstruction = requestText;
    const history = (rerollTurn?.historyBeforeUser ?? session.messages).filter(message =>
      ['user', 'assistant'].includes(message.role) && message.content?.trim() && !['error', 'aborted'].includes(message.status)
    ).map(({ role, content }) => ({ role, content }));
    const entries = rerollTurn ? [rerollTurn.userMessage, rerollTurn.assistantMessage] : aiSessions.append(session.id,
      { role: 'user', content: requestText, status: 'ok' }, { role: 'assistant', content: '' });
    const assistant = entries[1];
    const update = (fields, persist) => {
      if (persist) aiSessions.update(session.id, assistant, fields);
      else Object.assign(assistant, fields);
      aiPage?.feed(session.id, assistant);
    };
    aiPage?.feed(session.id, ...entries);
    const key = activeBattleKey;
    const controller = new AbortController();
    aiController = controller;
    let finish;
    aiFinished = new Promise(resolve => { finish = resolve; });
    aiPage?.setBusy(true);
    renderInstances();
    toast.hidden = true;
    const timeout = setTimeout(() => controller.abort(new Error('请求超时，请检查酒馆主接口或独立 API')), config.timeoutMs ?? 240000);
    try {
      const prompts = [...prepareMessages('chat', requestText, true), ...history, { role: 'user', content: requestText }];
      lastSent = prompts;
      publishMessages(prompts, 'chat');
      const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      const reply = await Promise.race([requestTavernAI(host, config, prompts, options.fetch, controller.signal, snapshot => {
        if (snapshot && !disposed && !controller.signal.aborted && activeBattleKey === key) update({ content: snapshot }, false);
      }), cancelled]);
      controller.signal.throwIfAborted();
      if (!disposed && activeBattleKey === key) update({ content: reply, status: 'ok' }, true);
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      if (!disposed) update({ status: aborted ? 'aborted' : 'error', content: aborted ? assistant.content
        : [assistant.content, `错误：${diagnosticText(error?.message ?? error, '请求失败')}`].filter(Boolean).join('\n\n') }, true);
    } finally {
      clearTimeout(timeout);
      if (aiController === controller) aiController = null;
      if (!disposed) { aiPage?.setBusy(false); renderInstances(); }
      finish();
    }
  }
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
    send: message => askChat(message),
    reroll: message => regenerateChat(id => aiSessions.prepareReroll(id, message)),
    editMessage: (message, content) => regenerateChat(id => aiSessions.prepareEdit(id, message, content)),
    applyJson: changeChatPatch,
    undoJson: message => changeChatPatch(message, undefined, true),
    copyText: copyChatText,
    extractJson: text => { const candidate = preferredJson(text); return candidate ? [candidate] : []; }, stop: () => aiController?.abort(new DOMException('已取消', 'AbortError')) });
  updateMagic();
  bindEventBus();
  foldBattleEntries();
  if (typeof MutationObserver === 'function' && doc.body) {
    battleObserver = new MutationObserver(() => foldBattleEntries());
    battleObserver.observe(doc.body, { childList: true, subtree: true });
  }
  const api = { version: TAVERN_VERSION, open, close: closePanel, dispose, scan, getConfig: () => clone(config), getDiagnostics: () => clone(diagnostics), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, extractJsonBlocks, getSources: () => clone(sources), getState: () => { const state = clone(liveState()); if (state) Object.defineProperty(state,'warnings',{value:clone(sources.warnings ?? [])}); return state; } };
  function dispose() {
    if (disposed) return; disposed = true; stopTerrainNotices?.(); aiController?.abort(); battleObserver?.disconnect(); try { controller?.abort(); } catch (_) {} for (const remove of listeners.splice(0)) remove(); try { gameMount?.unmount?.(); } catch (_) {} root.remove(); try { if (host.__fatedTacticalTavern === api) delete host.__fatedTacticalTavern; } catch (_) {} }
  try { host.__fatedTacticalTavern = api; } catch (_) {}
  if (options.open) open();
  return api;
}
export const mount = mountTavernOverlay;
export { hydrateBattleState };
export default mountTavernOverlay;
