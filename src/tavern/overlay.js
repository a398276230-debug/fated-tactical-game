import { hydrateFromSources as hydrateBattleState, buildMvuJsonPatch, parseBattleInit, parseCharInfo, parseSimpleYaml } from './converter.js';
import { mount as defaultMount } from '../ui/mount.js';
import { validateState as defaultValidateState } from '../api/validation.js';

/*
 * Tavern integration.  This file deliberately has no dependency on SillyTavern: it
 * can be loaded from an iframe, from a normal web page, or from a test DOM.  The
 * game and converter are supplied by the library entry point (or by options).
 */

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
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
function deepMerge(base, extra) {
  const result = isObject(base) ? clone(base) : {};
  if (!isObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}
function deletePath(object, path) {
  if (!path) return;
  const parts = String(path).trim().replace(/^\$\.?/, '').split('.').filter(Boolean);
  if (!parts.length) return;
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
  url = url.replace(/\/$/, '');
  if (!/\/chat\/completions(?:\?.*)?$/.test(url)) url += '/chat/completions';
  return { url, body, headers };
}
export async function requestAI(config, messages, fetchImpl) {
  const request = buildAIRequest(config, messages);
  const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetcher) throw new Error('当前浏览器没有 fetch');
  const response = await fetcher(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) });
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
function fnv1a(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function safeKey(value) { return text(value).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96) || 'unknown';
}
function battleKeyFor(chat, message, raw, battle) {
  const meta = messageMeta(message);
  const explicit = battle?.battleId ?? battle?.id ?? 'unnamed';
  return [safeKey(chat), safeKey(meta.messageId), safeKey(meta.swipeId), safeKey(explicit), `h_${fnv1a(raw)}`].join('__');
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
export function parseJSONPatch(value) {
  const parsed = parseAIResponse(value).data;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.patch)) return parsed.patch;
  if (Array.isArray(parsed?.jsonPatch)) return parsed.jsonPatch;
  if (Array.isArray(parsed?.battle_patch)) return parsed.battle_patch;
  if (Array.isArray(parsed?.unit_patch)) return parsed.unit_patch;
  if (Array.isArray(parsed?.battlePatch)) return parsed.battlePatch;
  if (Array.isArray(parsed?.unitPatch)) return parsed.unitPatch;
  return null;
}

export { deepMerge, applyPatch };

const DEFAULT_PROMPTS = [
  { title: '属性与战局标准化校验', role: 'system', enabled: true, content: '请校验 {{mvu_data}}、{{latest_floor}} 与 {{standardized_roster}} 的数值和结构，返回 JSON patch。' },
  { title: '地形/参数微调指令输出', role: 'user', enabled: true, content: '依据战场 {{battle_init}} 和当前状态 {{battle_state}}，处理玩家指令：{{user_instruction}}。只输出 battle_patch 或 unit_patch JSON。' },
];
const DEFAULT_CONFIG = {
  baseUrl: '', apiKey: '', model: '', temperature: 0.2, max_tokens: 1200,
  extraBody: '{}', excludeParams: '', headers: '{}', hideLauncher: false, autoScan: true,
  prompts: DEFAULT_PROMPTS,
};
function configFor(storage, key) {
  try { return deepMerge(DEFAULT_CONFIG, parseJSON(storage?.getItem(key), {})); } catch (_) { return clone(DEFAULT_CONFIG); }
}
function putConfig(storage, key, value) { try { storage?.setItem(key, JSON.stringify(value)); } catch (_) { /* private browsing */ } }
function chatId(host) {
  const helper = getGlobal(host, 'TavernHelper');
  for (const fn of [helper?.getChatId, getGlobal(host, 'getChatId')]) {
    try { if (typeof fn === 'function') { const id = fn.call(helper); if (id != null) return String(id); } } catch (_) { /* fallback */ }
  }
  return text(host?.location?.pathname || 'default').replace(/[^\w.-]+/g, '_') || 'default';
}
function tavernVariables(host) {
  const helper = getGlobal(host, 'TavernHelper');
  const funcs = [helper?.getVariables, getGlobal(host, 'getVariables')].filter(fn => typeof fn === 'function');
  for (const fn of funcs) {
    for (const arg of [{ type: 'message' }, undefined]) {
      try {
        const result = fn.call(helper, arg);
        if (result && typeof result.then === 'function') continue;
        if (result != null) return result;
      } catch (_) { /* API variants */ }
    }
  }
  try { return getGlobal(host, 'SillyTavern')?.getContext?.()?.chatMetadata?.stat_data || {}; } catch (_) { return {}; }
}
async function tavernVariablesAsync(host) {
  const helper = getGlobal(host, 'TavernHelper');
  const funcs = [helper?.getVariables, getGlobal(host, 'getVariables')].filter(fn => typeof fn === 'function');
  for (const fn of funcs) for (const arg of [{ type: 'message' }, undefined]) {
    try { const result = await fn.call(helper, arg); if (result != null) return result; } catch (_) { /* variant */ }
  }
  return tavernVariables(host);
}
async function tavernMessages(host) {
  const helper = getGlobal(host, 'TavernHelper');
  const funcs = [helper?.getChatMessages, getGlobal(host, 'getChatMessages')].filter(fn => typeof fn === 'function');
  for (const fn of funcs) {
    for (const arg of [-1, '0-999']) {
      try { const result = await fn.call(helper, arg, { include_swipes: false }); if (result != null) return Array.isArray(result) ? result : [result]; } catch (_) { /* variant */ }
    }
  }
  const doc = hostDocument();
  const nodes = doc ? [...doc.querySelectorAll('.mes, .chat-msg, [data-message-id], [data-mesid]')] : [];
  return nodes.map((node, index) => ({
    message_id: node.dataset.messageId ?? node.dataset.mesid ?? node.dataset.id ?? `floor-${index}`,
    swipe_id: node.dataset.swipeId ?? node.dataset.swipe ?? '0',
    content: node.querySelector('.mes_text, .message, [data-content]')?.textContent || node.textContent,
  })).filter(item => item.content);
}

function fillTemplate(value, sources, instruction = '') {
  const values = {
    battle_init: sources.battleRaw || JSON.stringify(sources.battleInit ?? {}, null, 2), standardized_roster: sources.roster || '',
    mvu_data: JSON.stringify(sources.mvuData ?? {}, null, 2), latest_floor: sources.latestFloor || '',
    battle_state: JSON.stringify(sources.state ?? {}, null, 2), user_instruction: instruction,
  };
  return text(value).replace(/\{\{([\w]+)\}\}/g, (_, key) => values[key] ?? '');
}
function sourceBundle(variables, messages, chat = 'default') {
  const list = Array.isArray(messages) ? messages : [];
  const latestMessage = list.at(-1);
  const latestFloor = messageContent(latestMessage ?? variables?.latest_floor ?? variables?.latestFloor ?? '');
  const joined = list.map(messageContent).join('\n');
  const allText = joined || latestFloor;
  let battleRaw = extractTag(allText, ['battle_init', 'battle_in', '战术沙盘']);
  // Some older prompt routes emit a marker without a closing marker, e.g.
  // `{battle_in}: {"participants": [...]}`. Keep this compatibility path
  // bounded to the known marker names and let JSON/YAML parsing reject noise.
  if (!battleRaw) {
    const legacy = allText.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*[:：]?\s*([\\s\\S]+)/i);
    if (legacy) battleRaw = legacy[1].trim();
    else {
      const wrapped = allText.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\\s\\S]+)\}/i);
      if (wrapped) battleRaw = wrapped[1].trim();
    }
  }
  const battleInit = parseJSON(battleRaw, battleRaw ? parseLooseYaml(battleRaw) : null);
  const charBlocks = extractTags(joined, 'char_info');
  const charRaw = charBlocks[0] || '';
  const charInfo = charBlocks.flatMap(raw => {
    const value = parseJSON(raw, null);
    return value ? [value] : [parseLooseYaml(raw)];
  });
  const mvuData = variables?.stat_data ?? variables?.message?.stat_data ?? variables ?? {};
  const battleSource = list.findLast?.(message => extractTag(messageContent(message), ['battle_init', 'battle_in', '战术沙盘'])) ?? latestMessage;
  const battleKey = battleInit ? battleKeyFor(chat, battleSource, battleRaw, battleInit) : null;
  return { mvuData, latestFloor, battleInit, charInfo, battleRaw, charRaw, messages: list, roster: '', battleKey,
    source: battleSource ? { ...messageMeta(battleSource, list.length - 1), chatId: chat } : null };
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
function applyPatch(target, patch) {
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
    const keys = pointer(operation.path), last = keys.pop();
    let parent = result;
    for (const key of keys) { if (parent == null) break; parent = parent[key]; }
    if (parent == null) continue;
    if (operation.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
    else if (operation.op === 'add' || operation.op === 'replace') { if (Array.isArray(parent) && last === '-') parent.push(clone(operation.value)); else parent[last] = clone(operation.value); }
  }
  return result;
}

function style(doc) {
  if (doc.querySelector('style[data-fated-tavern-overlay]')) return;
  const css = `
[data-fated-tavern-overlay]{position:fixed;z-index:2147483000;color:#e8edf5;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
[data-fated-tavern-overlay] *{box-sizing:border-box}[data-fated-tavern-overlay] button{cursor:pointer;color:inherit;background:#263348;border:1px solid #52627d;border-radius:4px;padding:5px 9px}[data-fated-tavern-overlay] button:hover{background:#354968}
.fated-tavern-launcher{pointer-events:auto;position:fixed;right:18px;bottom:18px;border-radius:50%!important;width:44px;height:44px;background:#566bea!important;border:0!important;font-size:20px}.fated-tavern-launcher[hidden]{display:none!important}.fated-tavern-panel{pointer-events:auto;position:fixed;right:64px;bottom:50px;width:min(860px,calc(100vw - 30px));height:min(700px,calc(100vh - 50px));min-width:360px;min-height:260px;resize:both;overflow:hidden;background:#141a25;border:1px solid #56627a;border-radius:8px;box-shadow:0 12px 44px #000b;display:flex;flex-direction:column}.fated-tavern-panel[hidden]{display:none}.fated-tavern-header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#202a3c;cursor:move}.fated-tavern-header strong{flex:1}.fated-tavern-header button{padding:2px 8px}.fated-tavern-tabs,.fated-tavern-subtabs{display:flex;gap:4px;padding:7px;background:#1a2231;border-bottom:1px solid #39465b}.fated-tavern-tabs button[aria-selected=true],.fated-tavern-subtabs button[aria-selected=true]{background:#566bea}.fated-tavern-content{overflow:auto;flex:1;padding:12px}.fated-tab{display:none}.fated-tab.active{display:block}.fated-tavern-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.fated-tavern-grid label{display:flex;flex-direction:column;gap:3px}.fated-tavern-grid input,.fated-tavern-grid textarea,.fated-tavern-grid select,[data-fated-tavern-overlay] textarea{background:#0d121b;color:#e8edf5;border:1px solid #4a5870;border-radius:4px;padding:6px}.fated-tavern-grid textarea{min-height:66px}.fated-tavern-prompts{display:flex;flex-direction:column;gap:8px}.fated-prompt{border:1px solid #3c4a61;padding:8px;margin:7px 0;border-radius:5px}.fated-prompt textarea{width:100%;min-height:70px}.fated-instance{border:1px solid #3c4a61;padding:8px;margin:7px 0;border-radius:5px;white-space:pre-wrap}.fated-status{padding:7px;background:#0d121b;border-radius:4px;white-space:pre-wrap;max-height:150px;overflow:auto}.fated-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.fated-chat{display:flex;gap:6px}.fated-chat textarea{flex:1;min-height:54px}.fated-mini{opacity:.75;font-size:12px}`;
  (doc.head || doc.documentElement)?.append(el(doc, 'style', { 'data-fated-tavern-overlay': '' }, css));
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
  let disposed = false, gameMount = null, sources = {}, currentState = null, scanEpoch = 0, activeBattleKey = null;
  const listeners = [], controller = typeof AbortController === 'function' ? new AbortController() : null;
  const on = (node, event, fn, opts = {}) => { if (!node) return; const options2 = controller ? { ...opts, signal: controller.signal } : opts; node.addEventListener(event, fn, options2); if (!controller) listeners.push(() => node.removeEventListener(event, fn, opts)); };
  const root = el(doc, 'div', { 'data-fated-tavern-overlay': '' });
  const launcher = el(doc, 'button', { class: 'fated-tavern-launcher', title: '打开命定战术控制台', 'aria-label': '打开命定战术控制台', type: 'button' }, '🪄');
  const panel = el(doc, 'section', { class: 'fated-tavern-panel', role: 'dialog', 'aria-label': '命定战术酒馆控制台', hidden: '' });
  const header = el(doc, 'header', { class: 'fated-tavern-header' });
  const title = el(doc, 'strong', {}, '命定战术控制台');
  const minimize = el(doc, 'button', { type: 'button', title: '最小化', 'aria-label': '最小化' }, '−');
  const close = el(doc, 'button', { type: 'button', title: '关闭', 'aria-label': '关闭' }, '×');
  header.append(title, minimize, close);
  const tabs = el(doc, 'nav', { class: 'fated-tavern-tabs', role: 'tablist' });
  const content = el(doc, 'div', { class: 'fated-tavern-content' });
  const pages = {};
  for (const [key, label] of [['instances', '维护实例'], ['config', '配置 / API + prompts'], ['sandbox', '沙盘']]) {
    const button = el(doc, 'button', { type: 'button', role: 'tab', 'aria-selected': key === 'instances' ? 'true' : 'false', 'data-tab': key }, label);
    const page = el(doc, 'div', { class: `fated-tab ${key === 'instances' ? 'active' : ''}`, 'data-page': key });
    tabs.append(button); content.append(page); pages[key] = page;
    on(button, 'click', () => { Object.entries(pages).forEach(([name, node]) => { node.classList.toggle('active', name === key); }); [...tabs.children].forEach(x => x.setAttribute('aria-selected', String(x === button))); if (key === 'sandbox') scan(); });
  }
  panel.append(header, tabs, content); root.append(launcher, panel); (doc.body || doc.documentElement)?.append(root);
  const instances = config.instances || (() => { try { return parseJSON(storage?.getItem(stateKey), {}) || {}; } catch (_) { return {}; } })();
  config.instances = isObject(instances) ? instances : {};

  function save() { putConfig(storage, configKey, config); putConfig(storage, stateKey, config.instances); }
  async function open() { if (disposed) return; panel.hidden = false; launcher.hidden = true; if (config.autoScan !== false) await scan(); }
  function hide() { panel.hidden = true; launcher.hidden = Boolean(config.hideLauncher); }
  function closePanel() { hide(); }
  on(launcher, 'click', open); on(close, 'click', closePanel); on(minimize, 'click', hide);

  // Dragging works for both the launcher and the large window. Coordinates are
  // clamped only by CSS; no browser-specific pointer API is required.
  function draggable(node, handle) {
    let drag = null;
    on(handle || node, 'pointerdown', event => { if (event.target.closest('button') && handle) return; const rect = node.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }; node.style.right = 'auto'; node.style.bottom = 'auto'; node.style.left = `${rect.left}px`; node.style.top = `${rect.top}px`; node.setPointerCapture?.(event.pointerId); });
    on(handle || node, 'pointermove', event => { if (!drag) return; node.style.left = `${Math.max(0, drag.left + event.clientX - drag.x)}px`; node.style.top = `${Math.max(0, drag.top + event.clientY - drag.y)}px`; });
    on(handle || node, 'pointerup', () => { drag = null; });
    on(handle || node, 'pointercancel', () => { drag = null; });
  }
  draggable(launcher); draggable(panel, header);

  function renderInstances() {
    const page = pages.instances; page.replaceChildren(el(doc, 'h3', {}, '已维护的实例'));
    const toolbar = el(doc, 'div', { class: 'fated-actions' });
    const refresh = el(doc, 'button', { type: 'button' }, '从当前聊天重新水合'); toolbar.append(refresh); page.append(toolbar);
    const list = el(doc, 'div'); page.append(list);
    const entries = Object.entries(config.instances);
    if (!entries.length) list.append(el(doc, 'p', { class: 'fated-mini' }, '暂无实例。打开沙盘会自动读取当前 MVU、char_info 和 battle_init。'));
    for (const [key, instance] of entries) {
      const box = el(doc, 'article', { class: 'fated-instance' });
      box.append(el(doc, 'strong', {}, instance.name || key), el(doc, 'div', { class: 'fated-mini' }, `来源：${instance.source || '手动或 AI 编辑'} · ${instance.notes || '已标准化'}`));
      box.append(el(doc, 'pre', { class: 'fated-status' }, JSON.stringify(instance, null, 2)));
      const actions = el(doc, 'div', { class: 'fated-actions' }); const edit = el(doc, 'button', { type: 'button' }, '编辑 JSON'); const remove = el(doc, 'button', { type: 'button' }, '删除');
      actions.append(edit, remove); box.append(actions); list.append(box);
      on(remove, 'click', () => { delete config.instances[key]; save(); renderInstances(); });
      on(edit, 'click', () => { const value = prompt('编辑实例 JSON', JSON.stringify(instance, null, 2)); const parsed = parseJSON(value, null); if (parsed) { config.instances[key] = parsed; save(); renderInstances(); } });
    }
    on(refresh, 'click', () => scan(true).catch(showError));
  }

  function field(label, value, type = 'text') { const labelNode = el(doc, 'label', {}, label); const input = el(doc, type === 'textarea' ? 'textarea' : 'input', { type: type === 'textarea' ? undefined : type }); input.value = value ?? ''; labelNode.append(input); return { labelNode, input }; }
  function renderConfig() {
    const page = pages.config; page.replaceChildren();
    const subtabs = el(doc, 'nav', { class: 'fated-tavern-subtabs' }); const apiPage = el(doc, 'div'); const promptPage = el(doc, 'div');
    for (const [name, label, target] of [['api', 'API 与界面', apiPage], ['prompts', '提示词', promptPage]]) { const b = el(doc, 'button', { type: 'button', 'aria-selected': name === 'api' ? 'true' : 'false' }, label); subtabs.append(b); on(b, 'click', () => { apiPage.hidden = name !== 'api'; promptPage.hidden = name !== 'prompts'; [...subtabs.children].forEach(x => x.setAttribute('aria-selected', String(x === b))); }); }
    apiPage.className = 'fated-tavern-grid'; promptPage.className = 'fated-tavern-prompts'; page.append(subtabs, apiPage, promptPage); promptPage.hidden = true;
    const fields = [['baseUrl', 'API 地址'], ['apiKey', 'API Key', 'password'], ['model', '模型名称'], ['temperature', 'temperature', 'number'], ['max_tokens', 'max_tokens', 'number'], ['excludeParams', '排除主体参数（逗号分隔）'], ['extraBody', '附加主体参数 JSON', 'textarea'], ['headers', '附加请求标头 JSON', 'textarea']];
    for (const [key, label, type] of fields) { const f = field(label, config[key], type); apiPage.append(f.labelNode); on(f.input, 'change', () => { config[key] = f.input.value; save(); }); }
    const hide = el(doc, 'label', {}); const checkbox = el(doc, 'input', { type: 'checkbox' }); checkbox.checked = Boolean(config.hideLauncher); hide.append(checkbox, ' 隐藏悬浮按钮到魔术棒菜单'); apiPage.append(hide);
    const auto = el(doc, 'label', {}); const autoCheck = el(doc, 'input', { type: 'checkbox' }); autoCheck.checked = config.autoScan !== false; auto.append(autoCheck, ' 打开沙盘时自动扫描'); apiPage.append(auto);
    on(checkbox, 'change', () => { config.hideLauncher = checkbox.checked; updateMagic(); save(); }); on(autoCheck, 'change', () => { config.autoScan = autoCheck.checked; save(); });
    const test = el(doc, 'button', { type: 'button' }, '测试连通性'); const models = el(doc, 'button', { type: 'button' }, '拉取模型'); const result = el(doc, 'div', { class: 'fated-status' }); apiPage.append(test, models, result);
    on(test, 'click', async () => { result.textContent = '请求中…'; try { const response = await requestAI(config, [{ role: 'user', content: '请只回复 OK' }]); result.textContent = JSON.stringify(response).slice(0, 1000); } catch (e) { result.textContent = `失败：${e.message}`; } });
    on(models, 'click', async () => { try { const fetcher = options.fetch || (typeof fetch === 'function' ? fetch : null); if (!fetcher) throw new Error('当前浏览器没有 fetch'); const url = text(config.baseUrl).replace(/\/$/, '').replace(/\/chat\/completions$/, '') + '/models'; const r = await fetcher(url, { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} }); result.textContent = await r.text(); } catch (e) { result.textContent = `失败：${e.message}`; } });
    const promptList = el(doc, 'div'); promptPage.append(promptList); const add = el(doc, 'button', { type: 'button' }, '新建提示词'); const reset = el(doc, 'button', { type: 'button' }, '重置默认模板'); promptPage.append(add, reset);
    const renderPrompts = () => { promptList.replaceChildren(); (config.prompts || []).forEach((prompt, index) => { const box = el(doc, 'article', { class: 'fated-prompt' }); const titleF = field('标题', prompt.title); const role = el(doc, 'select'); for (const r of ['system', 'user', 'assistant']) role.append(el(doc, 'option', { value: r, text: r })); role.value = prompt.role; const contentF = field('内容', prompt.content, 'textarea'); const enabled = el(doc, 'input', { type: 'checkbox' }); enabled.checked = prompt.enabled !== false; box.append(titleF.labelNode, role, contentF.labelNode, enabled, ' 启用 '); const up = el(doc, 'button', { type: 'button' }, '上移'); const down = el(doc, 'button', { type: 'button' }, '下移'); const del = el(doc, 'button', { type: 'button' }, '删除'); box.append(up, down, del); promptList.append(box); const changed = () => { prompt.title = titleF.input.value; prompt.role = role.value; prompt.content = contentF.input.value; prompt.enabled = enabled.checked; save(); }; on(titleF.input, 'change', changed); on(role, 'change', changed); on(contentF.input, 'change', changed); on(enabled, 'change', changed); on(up, 'click', () => { if (index) [config.prompts[index - 1], config.prompts[index]] = [config.prompts[index], config.prompts[index - 1]]; save(); renderPrompts(); }); on(down, 'click', () => { if (index < config.prompts.length - 1) [config.prompts[index + 1], config.prompts[index]] = [config.prompts[index], config.prompts[index + 1]]; save(); renderPrompts(); }); on(del, 'click', () => { config.prompts.splice(index, 1); save(); renderPrompts(); }); }); };
    on(add, 'click', () => { config.prompts.push({ title: '新提示词', role: 'user', enabled: true, content: '{{user_instruction}}' }); save(); renderPrompts(); }); on(reset, 'click', () => { config.prompts = clone(DEFAULT_PROMPTS); save(); renderPrompts(); }); renderPrompts();
  }

  async function hydrate() {
    const variables = await tavernVariablesAsync(host), messages = await tavernMessages(host); sources = sourceBundle(variables, messages, id);
    const converter = options.converter || getGlobal(host, 'FatedTactical')?.hydrateBattleState || getGlobal(host, 'hydrateBattleState') || hydrateBattleState;
    let hydrated = null;
    if (typeof converter === 'function') {
      const input = { mvu: sources.mvuData, stat_data: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleRaw || sources.battleInit };
      try { hydrated = await converter(input); } catch (_) { try { hydrated = await converter(sources.mvuData, sources.charInfo, sources.battleInit); } catch (_) { /* fallback view */ } }
    }
    const hydratedState = hydrated?.state || (hydrated && (hydrated.units || hydrated.grid) ? hydrated : null);
    if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
    const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
    for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) { const key = item.id || item.uid || item.name || `unit-${Object.keys(config.instances).length + 1}`; config.instances[key] = { ...clone(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? 'MVU 主角' : '正文 <char_info>') }; }
    save(); return hydrated;
  }
  async function mountState(state) {
    if (!state) return;
    const battleInstanceId = sources.battleKey || id;
    const mount = options.mount || defaultMount || getGlobal(host, 'FatedTactical')?.mount || getGlobal(host, 'mount');
    if (typeof mount !== 'function') return;
    const target = pages.sandbox.querySelector('[data-sandbox-mount]');
    try {
      gameMount?.unmount?.();
      gameMount = await mount(target, { instanceId: battleInstanceId, storage, state });
      // mount() receives the complete hydrated/custom state; its initialState path
      // must not replace it with the default scenario.
    } catch (e) { showError(e); }
  }
  function showError(error) { const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = `错误：${error?.message || error}`; }
  async function scan(force = false) {
    const epoch = ++scanEpoch;
    const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = '正在读取 MVU、最新楼层并转换…';
    try {
      const hydrated = await hydrate();
      if (epoch !== scanEpoch) return;
      const nextState = hydrated?.state || (hydrated && (hydrated.units || hydrated.grid) ? hydrated : null);
      if (!force && currentState && sources.battleKey && sources.battleKey === activeBattleKey) {
        renderInstances();
        if (node) node.textContent = '扫描完成，保留当前战局状态。';
        return;
      }
      currentState = nextState;
      activeBattleKey = sources.battleKey;
      await mountState(currentState);
      renderInstances(); if (node) node.textContent = currentState ? '扫描完成，已加载标准化状态。' : '扫描完成（未找到可挂载的战局）。';
    } catch (e) { showError(e); }
  }
  function renderSandbox() {
    const page = pages.sandbox; page.replaceChildren(el(doc, 'h3', {}, '沙盘'));
    const status = el(doc, 'div', { class: 'fated-status', 'data-status': '' }, '打开此页会自动侦测当前聊天。'); page.append(status);
    const mountTarget = el(doc, 'div', { 'data-sandbox-mount': '', style: 'min-height:90px;margin:8px 0;border:1px dashed #465675;padding:8px' }, '战棋界面挂载区'); page.append(mountTarget);
    const actions = el(doc, 'div', { class: 'fated-actions' }); const check = el(doc, 'button', { type: 'button' }, '校验'); const report = el(doc, 'button', { type: 'button' }, '战报交付'); const refresh = el(doc, 'button', { type: 'button' }, '重新扫描'); actions.append(check, report, refresh); page.append(actions);
    const instruction = el(doc, 'textarea', { placeholder: '让辅助 AI 调整地形、站位或角色参数…' }); instruction.style.width = '100%'; page.append(instruction);
    const chat = el(doc, 'div', { class: 'fated-chat' }); const send = el(doc, 'button', { type: 'button' }, '发送'); chat.append(instruction, send); page.append(chat);
    const output = el(doc, 'pre', { class: 'fated-status', 'data-ai-output': '' }); page.append(output);
    on(refresh, 'click', () => scan(true).catch(showError));
    on(report, 'click', () => { try { const reportText = gameMount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.() || (currentState ? `当前战局：${currentState.title} · 回合 ${currentState.round} · ${Object.values(currentState.units || {}).length} 个单位` : ''); const patch = currentState ? buildMvuJsonPatch(currentState) : (gameMount?.exportMvuPatch?.() || options.game?.exportMvuPatch?.() || ''); const result = [reportText, patch].filter(Boolean).join('\n\n'); const textarea = doc.querySelector('#send_textarea'); if (textarea) { textarea.value = result; textarea.dispatchEvent(new Event('input', { bubbles: true })); } if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(result).catch(() => {}); output.textContent = result || '当前没有可交付的战报。'; } catch (e) { showError(e); } });
    async function ask(kind) {
      const prompts = (config.prompts || []).filter(x => x.enabled !== false && (kind === 'validate' ? /校验|标准化/i.test(x.title || '') : !/校验|标准化/i.test(x.title || ''))).map(x => ({ role: x.role || 'user', content: fillTemplate(x.content, { ...sources, state: currentState }) }));
      if (kind === 'chat' && instruction.value.trim()) prompts.push({ role: 'user', content: instruction.value.trim() });
      if (!prompts.length) { output.textContent = '没有可发送的提示词。'; return; }
      try {
        const response = await requestAI(config, prompts, options.fetch || undefined);
        const content = response?.choices?.[0]?.message?.content || response?.content || JSON.stringify(response); output.textContent = content;
        const parsed = parseAIResponse(content);
        if (parsed.patch && currentState) {
          scanEpoch++;
          const nextState = applyPatch(currentState, parsed.patch);
          (options.validateState || defaultValidateState)(nextState);
          currentState = nextState;
          activeBattleKey = sources.battleKey;
          await mountState(currentState);
          const roster = Object.values(currentState.units || {}).map(unit => ({ ...unit, source: '手动或 AI 编辑' }));
          for (const unit of roster) config.instances[unit.id] = unit;
          save(); renderInstances();
        }
      } catch (e) { output.textContent = `AI 失败：${e.message}`; showError(e); }
    }
    on(check, 'click', () => ask('validate')); on(send, 'click', () => ask('chat'));
  }
  function updateMagic() {
    launcher.hidden = Boolean(config.hideLauncher) || !panel.hidden;
    const wand = doc.querySelector('#extensionsMenu, #data_bank_wand_container'); if (!wand) return;
    let entry = wand.querySelector('[data-fated-tavern-entry]');
    if (config.hideLauncher) { if (!entry) { entry = el(doc, 'button', { type: 'button', 'data-fated-tavern-entry': '' }, '🪄 命定战术控制台'); wand.append(entry); on(entry, 'click', open); } }
    else entry?.remove();
    try { getGlobal(host, 'replaceScriptButtons')?.(); } catch (_) { /* optional Tavern helper API */ }
  }
  renderInstances(); renderConfig(); renderSandbox(); updateMagic();
  const api = { open, close: closePanel, dispose, scan, getConfig: () => clone(config), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, getSources: () => clone(sources), getState: () => clone(currentState) };
  function dispose() {
    if (disposed) return; disposed = true; try { controller?.abort(); } catch (_) {} for (const remove of listeners.splice(0)) remove(); try { gameMount?.unmount?.(); } catch (_) {} root.remove(); try { if (host.__fatedTacticalTavern === api) delete host.__fatedTacticalTavern; } catch (_) {} }
  try { host.__fatedTacticalTavern = api; } catch (_) {}
  if (options.open) open();
  return api;
}
export const mount = mountTavernOverlay;
export { hydrateBattleState };
export default mountTavernOverlay;
