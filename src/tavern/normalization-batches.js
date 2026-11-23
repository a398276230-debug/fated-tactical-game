import { diagnosticText, warningKey } from './resolved-warnings.js';

export const warningReference = ({ unitId, originPath, message }) => ({ unitId, originPath: originPath ?? null, message });
const referenceKey = warning => JSON.stringify(Object.values(warningReference(warning)));
const targetPath = path => path?.split('/').slice(0, 3).join('/');

function dependencies(state, warning) {
  const path = targetPath(warning.originPath);
  if (!path) return [`unit:${warning.unitId}`];
  const [, table, id] = path.split('/');
  const entry = state?.[table]?.[id];
  const keys = new Set([path]);
  if (table === 'items' && entry?.templateId) keys.add(`/equipment/${entry.templateId}`);
  for (const skillId of table === 'equipment' ? entry?.skills ?? [] : []) keys.add(`/skills/${skillId}`);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.statusId === 'string') keys.add(`/statusTemplates/${value.statusId}`);
    for (const child of Object.values(value)) visit(child);
  }
  visit(entry?.rules);
  if (table === 'units' && warning.originPath?.startsWith(`${path}/statuses/`)) {
    keys.add(`/statusTemplates/${warning.originPath.split('/')[4]}`);
  }
  return keys;
}

// Keep related diagnostics adjacent but respect the configured request ceiling.
export const MAX_NORMALIZATION_REPAIRS = 1;
export function normalizationRepairAllowed({ attempts = 0, explicitUnresolved = false } = {}) {
  return !explicitUnresolved && attempts < MAX_NORMALIZATION_REPAIRS;
}

export const normalizationLimits = {
  normalizationConcurrency: { fallback: 1, max: 8 },
  normalizationWarningsPerBatch: { fallback: 6, max: 30 },
};
export function normalizationLimit(config, key) {
  const { fallback, max } = normalizationLimits[key];
  const value = config[key];
  return Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}

export function planNormalizationBatches(unitIds, warnings, state, { maxWarnings = normalizationLimits.normalizationWarningsPerBatch.fallback, maxUnits = 3 } = {}) {
  const units = [...new Set(unitIds)];
  const selected = new Set(units);
  const assigned = new Set();
  const groups = [];
  for (const warning of warnings) {
    if (!units.length || (warning.unitId !== null && !selected.has(warning.unitId))) continue;
    const keys = new Set(dependencies(state, warning));
    const group = { keys, unitIds: new Set(warning.unitId === null ? [units[0]] : [warning.unitId]), warnings: [warning] };
    for (let index = groups.length - 1; index >= 0; index--) {
      const previous = groups[index];
      if (![...previous.keys].some(key => keys.has(key))) continue;
      for (const key of previous.keys) keys.add(key);
      for (const id of previous.unitIds) group.unitIds.add(id);
      group.warnings.unshift(...previous.warnings);
      groups.splice(index, 1);
    }
    for (const id of group.unitIds) assigned.add(id);
    groups.push(group);
  }
  for (const id of units) if (!assigned.has(id)) groups.push({ unitIds: new Set([id]), warnings: [] });

  const result = [];
  let current = { unitIds: [], warnings: [] };
  const append = (ids, diagnostics) => {
    const combinedIds = [...new Set([...current.unitIds, ...ids])];
    if (current.unitIds.length && (combinedIds.length > maxUnits || current.warnings.length + diagnostics.length > maxWarnings)) {
      result.push(current);
      current = { unitIds: [...ids], warnings: [...diagnostics] };
    } else {
      current.unitIds = combinedIds;
      current.warnings.push(...diagnostics);
    }
  };
  for (const group of groups) {
    if (group.warnings.length <= maxWarnings && group.unitIds.size <= maxUnits) append(group.unitIds, group.warnings);
    else for (const warning of group.warnings) append([warning.unitId ?? units[0]], [warning]);
  }
  if (current.unitIds.length) result.push(current);
  return result;
}

// The first validated shared definition wins within a run; external edits still require a rebase.
export function normalizationOperations(operations, snapshot, current, created, fingerprintAt) {
  return operations.filter(operation => {
    const { op, path } = operation;
    const root = path.split('/').slice(0, path.startsWith('/units/') ? 4 : 3).join('/');
    const live = fingerprintAt(current, root);
    const original = fingerprintAt(snapshot, root);
    if (live === original) return true;
    if (op === 'add' && /^\/(?:statusTemplates|skills)\/[^/]+$/.test(path)
      && original === undefined && created.has(path) && live === created.get(path)) {
      return false;
    }
    throw new Error('补丁目标已被更早的批次或战局操作修改');
  });
}

// Keep a bounded window of requests in flight and commit in plan order. A new
// request sees all changes committed before it starts, including serial mode.
export async function runOrderedBatches(batches, concurrency, request, commit, signal) {
  const pending = new Map();
  let next = 0;
  const fill = () => {
    while (!signal.aborted && pending.size < concurrency && next < batches.length) {
      const index = next++;
      pending.set(index, Promise.resolve(request(batches[index], index)).then(value => ({ value }), error => ({ error })));
    }
  };
  try {
    fill();
    for (let index = 0; index < batches.length; index++) {
      signal.throwIfAborted();
      const result = await pending.get(index);
      signal.throwIfAborted();
      await commit(result, batches[index], index);
      pending.delete(index);
      fill();
    }
  } finally {
    await Promise.all(pending.values());
  }
}

export function readNarrativeExemptions(value = [], sent, sourceFor, { solved = [], unresolved = [] } = {}) {
  if (!Array.isArray(value)) throw new Error('narrative 必须是 JSON 数组');
  const index = new Map();
  for (const warning of sent) {
    const key = referenceKey(warning);
    const matches = index.get(key) ?? [];
    if (!matches.some(match => warningKey(match) === warningKey(warning))) matches.push(warning);
    index.set(key, matches);
  }
  const seen = new Set();
  return value.map(entry => {
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim() || !Object.hasOwn(entry, 'originPath')) {
      throw new Error('narrative 每项必须包含完整警告引用和非空 reason');
    }
    const reference = referenceKey(entry);
    const matches = index.get(reference);
    if (matches?.length !== 1 || seen.has(reference)) throw new Error('narrative 必须唯一匹配本批警告');
    const [warning] = matches;
    if (entry.originPath !== (warning.originPath ?? null) || solved.some(item => referenceKey(item) === reference)
      || unresolved.some(item => item.warning === warning)) {
      throw new Error('narrative 警告与本批处理结果冲突');
    }
    seen.add(reference);
    const source = sourceFor(warning.unitId);
    if (!source) throw new Error('narrative 警告缺少来源');
    return { warning, receipt: { unitId: warning.unitId, key: warningKey(warning), source, reason: diagnosticText(entry.reason) } };
  });
}

export function activeNarrativeExemptions(warnings, receipts, sourceFor) {
  return warnings.flatMap(warning => {
    const source = sourceFor(warning.unitId);
    const receipt = source && receipts.find(item => item.unitId === warning.unitId && item.key === warningKey(warning) && item.source === source);
    return receipt ? [{ warning, receipt }] : [];
  });
}
