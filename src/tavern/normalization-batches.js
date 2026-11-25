import { diagnosticText, warningEntryKey, warningKey } from './resolved-warnings.js';

export const normalizationPath = /^\/(?:equipment|skills|statusTemplates)\/|^\/items\/[^/]+(?:\/(?!pools(?:\/|$)).+)?$|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/;

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
  const groups = [];
  for (const warning of warnings) {
    if (warning.kind === 'auto_adjusted' || !units.length || (warning.unitId !== null && !selected.has(warning.unitId))) continue;
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
    groups.push(group);
  }

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
    const sharedAdd = op === 'add' && /^\/(?:statusTemplates|skills)\/[^/]+$/.test(path) && created.has(path) && live === created.get(path);
    if (sharedAdd) {
      // Cosmetic naming differences don't change the mechanic. Never silently
      // bind a consumer to a different rule set with the same generated id.
      const mechanics = ({ name, description, ...fields }) => JSON.stringify(fields, function (_, value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value;
      });
      if (!operation.value || mechanics(operation.value) !== mechanics(JSON.parse(live))) throw new Error(`共享模板定义冲突：${path}`);
      return false;
    }
    if (live === original) return true;
    // Disjoint member edits commute. Never rebase an index across an array
    // change; only a trailing append has a stable insertion point.
    if (path !== root && original !== undefined && live !== undefined) {
      const parts = path.slice(root.length + 1).split('/');
      const append = op === 'add' && parts.at(-1) === '-';
      const field = append ? path.slice(0, path.lastIndexOf('/')) : path;
      if (!parts.some(part => /^\d+$/.test(part))) {
        const before = fingerprintAt(snapshot, field), after = fingerprintAt(current, field);
        if (before === after) return true;
        if (append && before?.startsWith('[') && after?.startsWith('[')) {
          const array = JSON.parse(after);
          if (JSON.parse(before).every((value, i) => JSON.stringify(value) === JSON.stringify(array[i]))) return true;
        }
      }
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
  const matched = [], invalid = [];
  if (!Array.isArray(value)) return { matched, invalid: ['未能读取模型的非战斗说明'] };
  const index = new Map();
  for (const warning of sent) {
    const key = referenceKey(warning);
    const matches = index.get(key) ?? [];
    if (!matches.some(match => warningKey(match) === warningKey(warning))) matches.push(warning);
    index.set(key, matches);
  }
  const seen = new Set();
  for (const [i, entry] of value.entries()) {
    const label = `第 ${i + 1} 条非战斗说明`;
    const reason = diagnosticText(entry?.reason, '');
    if (!reason || !Object.hasOwn(entry, 'originPath')) {
      invalid.push(`${label}缺少词条引用或原因`);
      continue;
    }
    const reference = referenceKey(entry);
    const matches = index.get(reference);
    if (matches?.length !== 1 || seen.has(reference)) {
      invalid.push(`${label}无法唯一匹配本批词条`);
      continue;
    }
    const [warning] = matches;
    if (entry.originPath !== (warning.originPath ?? null) || solved.some(item => referenceKey(item) === reference)
      || unresolved.some(item => item.warning === warning)) {
      invalid.push(`${label}与本批处理结果冲突`);
      continue;
    }
    const source = sourceFor(warning.unitId, warningEntryKey(warning));
    if (!source) {
      invalid.push(`${label}缺少词条来源`);
      continue;
    }
    seen.add(reference);
    matched.push({ warning, receipt: { unitId: warning.unitId, key: warningKey(warning), source, reason } });
  }
  return { matched, invalid };
}

export function activeNarrativeExemptions(warnings, receipts, sourceFor) {
  return warnings.flatMap(warning => {
    const source = sourceFor(warning.unitId, warningEntryKey(warning));
    const receipt = source && receipts.find(item => item.unitId === warning.unitId && item.key === warningKey(warning) && item.source === source);
    return receipt ? [{ warning, receipt }] : [];
  });
}
