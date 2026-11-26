import { normalizationPath } from './normalization-batches.js';
import { normalizationTransactions } from './normalization-replay.js';
import { parseAIResponse } from './overlay-ai.js';
import { applyJsonPatch, deepClone as clone, deepMerge, isObject, normalizePath, own, safeProperty } from './mvu-utils.js';

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
  const keys = normalizePath(path);
  if (!keys.length) return undefined;
  let value = state;
  for (const key of keys) {
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
    } else {
      const zoneId = operation.path.match(/^\/zones\/([^/]+)\//)?.[1];
      if (zoneId && !Object.hasOwn(liveState?.zones ?? {}, zoneId)) {
        rejected.push({ index, op: operation, path: operation.path, reason: '目标战场区域不存在（标准化禁止凭空新建静态 /zones/<id>）' });
      } else candidates.push({ index, op: operation, lastError: '' });
    }
  }
  // Only move creations of absent parents ahead of children; never reorder
  // replacements or array operations relative to each other.
  const declarations = candidates.filter(({ op }) => op.op === 'add' && /^\/(?:customElements|skills|statusTemplates)\/[^/]+$/.test(op.path) && fingerprintAt(liveState, op.path) === undefined);
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
  const declarationRank = item => first.has(item) ? Number(!item.op.path.startsWith('/customElements/')) : 2;
  candidates.sort((a, b) => declarationRank(a) - declarationRank(b));
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
  return `[未应用] ${table === 'skills' ? '技能' : table === 'equipment' ? '装备' : table === 'zones' ? '战场效果' : '条目'}「${entity}」(${item.path || '无路径'})：${item.reason || '补丁校验失败'}`;
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
  for (const key of ['units', 'covers', 'interactives', 'zones', 'items', 'equipment', 'skills', 'customElements']) if (Array.isArray(result[key])) result[key] = patchValue(result[key], key);
  if (isObject(result.unit_patch)) {
    const unitPatch = result.unit_patch;
    const id = unitPatch.unitId || unitPatch.id;
    if (id && isObject(unitPatch.patch)) result.units = { [id]: unitPatch.patch };
  }
  return result;
}
function applyPatch(target, patch, strict = false) {
  // AI assistants can also return a semantic battle_patch/unit_patch object.
  if (isObject(patch) && !Array.isArray(patch.patch) && !Array.isArray(patch.jsonPatch)) {
    return deepMerge(target, normalizeSemanticPatch(patch.battle_patch || patch));
  }
  let list = Array.isArray(patch) ? patch : patch?.patch || patch?.jsonPatch;
  if (!Array.isArray(list)) list = [];
  if (!own(target, 'customElements')) {
    const index = list.findIndex(op => typeof op?.path === 'string' && /^\/customElements(?:\/|$)/.test(op.path));
    const first = list[index];
    if (first?.op === 'add' && /^\/customElements\/[^/]+$/.test(first.path)) {
      list = [...list.slice(0, index), { op: 'add', path: '/customElements', value: {} }, ...list.slice(index)];
    }
  }
  const result = applyJsonPatch(target, list, { strict });
  if (isObject(result.customElements) && !Object.keys(result.customElements).length) delete result.customElements;
  return result;
}

const chatTables = ['units', 'skills', 'equipment', 'items', 'statusTemplates', 'customElements', 'covers', 'interactives', 'zones'];
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
