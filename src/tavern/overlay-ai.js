import { classifyWarnings, diagnosticText, diagnosticTitle, existingEffectReceipts, missingDispositions, identifiesWarning, readUnresolvedDiagnostics, resolvedDiagnostics, remainingDiagnostics, normalizationCandidates, warningEntryKey, warningKey } from './resolved-warnings.js';
import { hydrateFromSources as hydrateBattleState, parseBattleInit, parseSimpleYaml, warningsForUnit } from './converter.js';
import { activeNarrativeExemptions, normalizationLimit, normalizationLimits, normalizationOperations, normalizationPath, normalizationRepairAllowed, planNormalizationBatches, readNarrativeExemptions, runOrderedBatches, warningReference } from './normalization-batches.js';
import { mount as defaultMount } from '../ui/mount.js';
import { validateState as defaultValidateState } from '../api/validation.js';
import { refreshOpeningInitiative, refreshOutcome, syncEquipmentEffects } from '../core/combat.js';
import { hostMethod, readBattleVariables, readChatMessages, statData } from './host.js';
import { tavernTheme } from './theme.js';
import { readBattlePortraits } from './portraits.js';
import { assembleMessages, describeSlots } from './prompts.js';
import { normalizationApiConfig, requestViaTavern, requestViaCustomApi } from './api.js';
import { renderSettings } from './settings.js';
import { createAiSessions } from './ai-sessions.js';
import { characterRecords, stableSourceJson } from './char-snapshots.js';
import { entryRoot, normalizationTransactions, replayNormalization } from './normalization-replay.js';
import { duplicateMappings, duplicateOperations, instanceGroups } from './instance-groups.js';
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
export function findBattleJSON(source) {
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

export function messageContent(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  return text(message.content ?? message.message ?? message.text ?? message.mes ?? message.data?.content ?? '');
}
export function messageMeta(message, index = 0) {
  if (!message || typeof message !== 'object') return { messageId: `floor-${index}`, swipeId: '0' };
  const messageId = message.message_id ?? message.messageId ?? message.mesid ?? message.mesId ?? message.id ?? message.data?.message_id ?? `floor-${index}`;
  const swipeId = message.swipe_id ?? message.swipeId ?? message.swipe_id_string ?? message.swipe ?? message.data?.swipe_id ?? '0';
  return { messageId: String(messageId), swipeId: String(swipeId) };
}
export function safeKey(value) { return text(value).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96) || 'unknown';
}
export function battleKeyFor(chat, message, battle) {
  const meta = messageMeta(message);
  const explicit = battle?.battleId ?? battle?.id ?? 'unnamed';
  return [safeKey(chat), safeKey(meta.messageId), safeKey(meta.swipeId), safeKey(explicit)].join('__');
}
export function extractTag(source, names) {
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
export function extractTags(source, name) {
  const value = text(source), result = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
  for (const match of value.matchAll(re)) result.push(match[1].trim());
  return result;
}
export function parseLooseYaml(value) {
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

const REASONING_BLOCK_RE = /<(think|thinking|thought|analysis|std_audit)\b[^>]*>[\s\S]*?<\/\1>/gi;
const UNCLOSED_REASONING_RE = /<(?:think|thinking|thought|analysis|std_audit)\b[^>]*>[\s\S]*$/i;
export function stripReasoningBlocks(value) {
  return text(value).replace(REASONING_BLOCK_RE, '').replace(UNCLOSED_REASONING_RE, '').replace(/<\/(?:think|thinking|thought|analysis|std_audit)\s*>/gi, '').trim();
}

export function extractJsonBlocks(value, { withRanges = false } = {}) {
  const source = typeof value === 'object' ? JSON.stringify(value) : stripReasoningBlocks(value);
  const output = [];
  const accept = (candidate, index, end) => {
    const parsed = parseJSON(candidate, null);
    if (!((isObject(parsed) && Object.keys(parsed).length) || (Array.isArray(parsed) && parsed.length))) return;
    output.push({ parsed, index, end });
  };
  const fencedRanges = [];
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    accept(match[1].trim(), match.index, match.index + match[0].length);
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
      if (top?.ch === expected) { stack.pop(); if (!stack.length) accept(source.slice(top.start, i + 1), top.start, i + 1); }
      else if (top) stack.length = 0;
    }
  }
  output.sort((a, b) => a.index - b.index);
  return withRanges ? output : output.map(entry => entry.parsed);
}
export const preferredJson = source => extractJsonBlocks(source).sort((a, b) => jsonPriority(a) - jsonPriority(b)).at(-1);
function jsonPriority(value) {
  if (Array.isArray(value)) return value.every(item => item && typeof item.op === 'string' && typeof item.path === 'string') ? 4 : 1;
  if (!isObject(value)) return -1;
  if (['patch','patches','jsonPatch','battle_patch','unit_patch'].some(key => key in value) || value.op && value.path) return 4;
  if (['units','skills','equipment','items','statusTemplates','covers','interactives','zones'].some(key => key in value)) return 3;
  return 1;
}
export function parseAIResponse(value) {
  const source = typeof value === 'object' ? JSON.stringify(value) : text(value);
  // Never salvage nested operations from a malformed normalization envelope.
  const clean = stripReasoningBlocks(source);
  const envelope = /\{\s*"(?:patch|unresolved|existing|narrative)"\s*:/.exec(clean);
  let parsed;
  if (envelope && !/[{[]/.test(clean.slice(0, envelope.index))) {
    try { parsed = JSON.parse(clean.slice(envelope.index)); }
    catch (error) {
      // One Markdown fence can surround several envelopes. Remove only paired
      // delimiters; a stray fence or a partial object must still fail below.
      const batchText = clean.replace(/```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*```/gi, '$1').trim();
      const blocks = extractJsonBlocks(batchText, { withRanges: true });
      const keys = ['patch','unresolved','existing','narrative'];
      let cursor = 0;
      const intact = blocks.length && blocks.every(({ parsed: block, index, end }) => {
        const gap = batchText.slice(cursor, index);
        cursor = end;
        return !/[{}\[\]`]/.test(gap) && isObject(block) && Object.entries(block).every(([key, val]) => keys.includes(key) && Array.isArray(val));
      }) && !/[{}\[\]`]/.test(batchText.slice(cursor));
      if (!intact) return { data: null, patch: null, text: source, parseError: `最终 JSON 无效：${error.message}` };
      parsed = Object.fromEntries(keys.filter(key => blocks.some(b => Object.hasOwn(b.parsed, key)))
        .map(key => [key, blocks.flatMap(b => b.parsed[key] ?? [])]));
    }
  } else parsed = preferredJson(source) ?? null;
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
