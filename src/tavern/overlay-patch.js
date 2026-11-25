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
import { parseAIResponse } from './overlay-ai.js';
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

export function fingerprintAt(state, path) {
  let value = state;
  for (const key of path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (value == null || !own(value, key)) return undefined;
    value = value[key];
  }
  return JSON.stringify(value);
}

export { deepMerge, applyPatch };
export function partitionNormalizationPatch({ liveState, baselineState, existingOps = [], rawPatch = [], conflictingDefinitions = [], validate = () => {}, apply = applyPatch, normalize = state => state, allowedUnitIds, expand = operation => [operation] }) {
  const candidates = [], rejected = [];
  for (const [index, operation] of (Array.isArray(rawPatch) ? rawPatch : []).entries()) {
    const unitId = typeof operation?.path === 'string' ? operation.path.match(/^\/units\/([^/]+)/)?.[1] : undefined;
    const itemRoot = typeof operation?.path === 'string' ? operation.path.match(/^\/items\/([^/]+)$/)?.[1] : undefined;
    const writesPoolBindings = itemRoot && operation?.op !== 'remove' &&
      (own(operation?.value ?? {}, 'pools') || Boolean(liveState?.items?.[itemRoot]?.pools) || Boolean(baselineState?.items?.[itemRoot]?.pools));
    if (writesPoolBindings || !['add', 'replace', 'remove'].includes(operation?.op) || typeof operation.path !== 'string' ||
        !normalizationPath.test(operation.path) || (operation.op !== 'remove' && !own(operation, 'value')) ||
        (unitId && allowedUnitIds && !allowedUnitIds.includes(unitId))) {
      rejected.push({ index, op: operation, path: typeof operation?.path === 'string' ? operation.path : '', reason: '路径或操作不在允许白名单内' });
    } else candidates.push({ index, op: operation, lastError: '' });
  }
  // Only move creations of absent parents ahead of children; never reorder
  // replacements or array operations relative to each other.
  const declarations = candidates.filter(({ op }) => op.op === 'add' && /^\/(?:skills|statusTemplates)\/[^/]+$/.test(op.path) && fingerprintAt(liveState, op.path) === undefined);
  const roots = new Set(), conflicted = new Set(conflictingDefinitions);
  for (const item of declarations) {
    if (roots.has(item.op.path)) {
      if (JSON.stringify(declarations.find(other => other.op.path === item.op.path).op.value) !== JSON.stringify(item.op.value)) conflicted.add(item.op.path);
      rejected.push({ ...item, path: item.op.path, reason: '同批重复创建模板' });
      candidates.splice(candidates.indexOf(item), 1);
    } else roots.add(item.op.path);
  }
  if (conflicted.size) {
    const markers = [...conflicted].map(path => ({ path }));
    const groups = normalizationTransactions({ patch: [...markers, ...candidates.map(i => i.op)], solved: [], verified: [], records: {}, before: liveState, fingerprint: fingerprintAt });
    const blocked = new Set(groups.filter(group => group.patch.some(op => markers.includes(op))).flatMap(group => group.patch));
    for (const item of candidates.slice()) if (blocked.has(item.op)) {
      rejected.push({ index: item.index, op: item.op, path: item.op.path, reason: '补丁依赖存在冲突的模板定义' });
      candidates.splice(candidates.indexOf(item), 1);
    }
  }
  const first = new Set(declarations);
  candidates.sort((a, b) => Number(first.has(b)) - Number(first.has(a)));
  const strip = item => { const { resolves, ...operation } = item.op; return operation; };
  const trial = (live, base, items) => {
    const operations = items.flatMap(item => expand(strip(item)));
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
    if (!progressed) {
      // Mutually referencing templates can only validate together. Retry each
      // dependency group atomically, isolated from unrelated malformed DSL.
      const groups = normalizationTransactions({ patch: next.map(item => item.op), solved: [], verified: [], records: {}, before: workBase, fingerprint: fingerprintAt });
      for (const group of groups) {
        const items = next.filter(item => group.patch.includes(item.op));
        if (items.length > 1) try {
          const result = trial(workLive, workBase, items);
          workLive = result.nextLive; workBase = result.nextBase; accepted.push(...items); continue;
        } catch { /* report the individual validation errors */ }
        rejected.push(...items.map(item => ({ index: item.index, op: item.op, path: item.op.path, reason: item.lastError })));
      }
      break;
    }
    remaining.splice(0, remaining.length, ...next);
  }
  return { accepted, rejected, workLive, workBase };
}
export function formatRejectedItem(item, state = {}) {
  const [, table, id] = String(item.path || '').split('/');
  const entity = item.op?.value?.name || state?.[table]?.[id]?.name || id || '未知条目';
  return `[未应用] ${table === 'skills' ? '技能' : table === 'equipment' ? '装备' : '条目'}「${entity}」(${item.path || '无路径'})：${item.reason || '补丁校验失败'}`;
}
export { normalizationPath };
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
