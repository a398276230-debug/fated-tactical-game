import { activeWarningExemption, diagnosticText, identifiesWarning, isSceneZoneWarning, warningEntryKey, warningKey } from './resolved-warnings.js';
import { semanticExemptionKey, normalizeClauseForHash } from './exemption-ledger.js';

export const normalizationPath = /^\/(?:equipment|skills|statusTemplates)\/|^\/items\/[^/]+(?:\/(?!pools(?:\/|$)).+)?$|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)|^\/zones\/[^/]+\/(?:rules|mods|tags|vars|flags|tier|shareRulesTo|persistent|remainingTurns)(?:\/|$)/;
export const SCENE_LANE = '__scene__';

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
  normalizationWarningsPerBatch: { fallback: 5, max: 30 },
};

const genericMechanismKeywords = new Set([
  '主动', '被动', '位移', '动作', '攻击', '消耗', '技能', '装备', '武器', '效果', '状态',
  '触发', '范围', '单体', '自身', '目标', '友军', '敌人', '命中', '伤害', '防御', '检定',
]);

/** Extract bracketed mechanism terms shared by prompt assembly and batch planning. */
export function mechanismTerms(text) {
  const terms = new Set();
  const patterns = [/[「]([^「\[【」\]】{}:"'`,]{1,24})[」]/g, /\[([^「\[【」\]】{}:"'`,]{1,24})\]/g, /【([^「\[【」\]】{}:"'`,]{1,24})】/g];
  for (const pattern of patterns) for (const match of String(text ?? '').matchAll(pattern)) {
    const term = match[1].trim();
    if (term && !genericMechanismKeywords.has(term.split(/[：:]/)[0].trim()) && !/^\d+(?:[+〜~-]\d+)?$/.test(term)) terms.add(term);
  }
  return terms;
}

const mechanismKeywords = value => mechanismTerms(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
export function normalizationLimit(config, key) {
  const { fallback, max } = normalizationLimits[key];
  const value = config[key];
  return Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}

export function planNormalizationBatches(unitIds, warnings, state, { maxWarnings = normalizationLimits.normalizationWarningsPerBatch.fallback, maxUnits = 1, rawSources = {}, includeScene = true } = {}) {
  const units = [...new Set(unitIds)];
  const selected = new Set(units);
  const carriers = new Map();
  // Separate character buckets except when they actually share a mutable template.
  const pathOwners = new Map();
  for (const warning of warnings) {
    const path = targetPath(warning?.originPath);
    if (!path || !selected.has(warning.unitId) || warning.kind === 'auto_adjusted') continue;
    if (!pathOwners.has(path)) pathOwners.set(path, new Set());
    pathOwners.get(path).add(warning.unitId);
  }
  const shared = new Map();
  for (const warning of warnings) {
    if (!warning || warning.kind === 'auto_adjusted') continue;
    const scene = isSceneZoneWarning(warning);
    if (scene ? !includeScene : warning.unitId === null ? !units.length : !selected.has(warning.unitId)) continue;
    const unitId = scene ? SCENE_LANE : warning.unitId ?? units[0];
    const path = targetPath(warning.originPath) ?? `unit:${unitId}`;
    if (pathOwners.get(path)?.size > 1) {
      if (!shared.has(path)) shared.set(path, []);
      shared.get(path).push(warning);
      continue;
    }
    const key = `${unitId}|${path}`;
    const carrier = carriers.get(key) ?? { unitId, path, keys: new Set(), warnings: [], terms: new Set(), passive: false };
    for (const dependency of dependencies(state, warning)) carrier.keys.add(dependency);
    carrier.warnings.push(warning);
    carriers.set(key, carrier);
  }
  // Keep already-shared scene/role dependencies in a single cluster. A
  // warning with no real dependency stays on its own lane, even if its text is similar.
  const sceneDependencies = new Set([...carriers.values()].filter(c => c.unitId === SCENE_LANE).flatMap(c => [...c.keys]));
  const grouped = new Map();
  for (const carrier of carriers.values()) {
    const [, table, id] = carrier.path.split('/');
    const template = state?.[table]?.[id];
    const source = rawSources?.[carrier.unitId]?.[`${table}:${id}`];
    for (const term of [...mechanismKeywords(carrier.warnings.map(item => item.message).join('\n')),
      ...mechanismKeywords(source ?? template)]) carrier.terms.add(term);
    carrier.passive = template?.passive === true;
    const lane = [...carrier.keys].some(key => sceneDependencies.has(key)) ? SCENE_LANE : carrier.unitId;
    const list = grouped.get(lane) ?? [];
    list.push(carrier);
    grouped.set(lane, list);
  }
  for (const [unitId, list] of grouped) {
    const clusters = [];
    for (const carrier of list) {
      const joined = clusters.filter(cluster => [...carrier.keys].some(key => cluster.keys.has(key)));
      const cluster = joined.shift() ?? { path: carrier.path, keys: new Set(), warnings: [], terms: new Set(), members: [], passive: false, coreScore: 0 };
      cluster.path = [cluster.path, carrier.path].filter(Boolean).sort()[0];
      for (const other of joined) {
        for (const key of other.keys) cluster.keys.add(key);
        cluster.warnings.push(...other.warnings);
        cluster.members.push(...other.members);
        for (const term of other.terms) cluster.terms.add(term);
        cluster.passive ||= other.passive;
        cluster.path = [cluster.path, other.path].filter(Boolean).sort()[0];
        clusters.splice(clusters.indexOf(other), 1);
      }
      for (const key of carrier.keys) cluster.keys.add(key);
      cluster.warnings.push(...carrier.warnings);
      cluster.members.push(carrier);
      for (const term of carrier.terms) cluster.terms.add(term);
      cluster.passive ||= carrier.passive;
      if (!clusters.includes(cluster)) clusters.push(cluster);
    }
    const elasticMax = Math.max(maxWarnings, 8);
    const bounded = clusters.flatMap(cluster => {
      if (cluster.warnings.length <= elasticMax) return [cluster];
      const parts = [];
      let part = { path: '', keys: new Set(), warnings: [], terms: new Set(), members: [], passive: false, coreScore: 0 };
      for (const member of cluster.members) {
        if (part.warnings.length && part.warnings.length + member.warnings.length > elasticMax) {
          parts.push(part);
          part = { path: '', keys: new Set(), warnings: [], terms: new Set(), members: [], passive: false, coreScore: 0 };
        }
        for (const key of member.keys) part.keys.add(key);
        part.warnings.push(...member.warnings);
        part.members.push(member);
        for (const term of member.terms) part.terms.add(term);
        part.passive ||= member.passive;
      }
      if (part.warnings.length) parts.push(part);
      return parts;
    });
    grouped.set(unitId, bounded);
  }

  const result = [];
  for (const [path, group] of shared) {
    const owners = [...pathOwners.get(path)], size = group.length <= Math.max(8, maxWarnings) ? group.length : maxWarnings;
    for (let i = 0; i < group.length; i += size) result.push({unitIds: owners, warnings: group.slice(i, i + size)});
  }
  for (const [unitId, list] of grouped) {
    const frequency = new Map();
    for (const carrier of list) for (const term of carrier.terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    for (const carrier of list) carrier.coreScore = [...carrier.terms].reduce((sum, term) => sum + (frequency.get(term) ?? 0) - 1, 0);
    const remaining = [...list].sort((a, b) => Number(b.passive) - Number(a.passive) || b.coreScore - a.coreScore || a.path.localeCompare(b.path));
    while (remaining.length) {
      const first = remaining.shift();
      const elasticMax = Math.max(maxWarnings, 8);
      if (first.warnings.length > elasticMax) {
        const chunkSize = Math.max(1, maxWarnings);
        for (let offset = 0; offset < first.warnings.length; offset += chunkSize) {
          result.push({ unitIds: [unitId], warnings: first.warnings.slice(offset, offset + chunkSize) });
        }
        continue;
      }
      const batch = { unitIds: [unitId], warnings: [...first.warnings] };
      const terms = new Set(first.terms);
      while (true) {
        let bestIndex = -1, bestAffinity = -1;
        for (let index = 0; index < remaining.length; index++) {
          const candidate = remaining[index];
          const intersection = [...candidate.terms].filter(term => terms.has(term)).length;
          const union = new Set([...candidate.terms, ...terms]).size;
          const affinity = union ? intersection / union : 0;
          if (affinity > bestAffinity) { bestAffinity = affinity; bestIndex = index; }
        }
        if (bestIndex < 0) break;
        const candidate = remaining[bestIndex];
        if (batch.warnings.length + candidate.warnings.length > maxWarnings || maxUnits < 1) {
          // Carry affinity across the batch boundary rather than reverting to path order.
          if (bestAffinity > 0) remaining.unshift(...remaining.splice(bestIndex, 1));
          break;
        }
        const [next] = remaining.splice(bestIndex, 1);
        batch.warnings.push(...next.warnings);
        for (const term of next.terms) terms.add(term);
      }
      result.push(batch);
    }
  }
  return result.map(batch => batch.unitIds[0] !== SCENE_LANE ? batch : {
    unitIds: [...new Set(batch.warnings.map(w => w.unitId).filter(Boolean))],
    sceneZoneIds: [...new Set(batch.warnings.filter(isSceneZoneWarning).map(w => w.originPath.split('/')[2]))],
    warnings: batch.warnings,
  });
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
  if (batches.some(batch => Array.isArray(batch?.unitIds))) {
    return runUnitOrderedBatches(batches, concurrency, request, commit, signal);
  }
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

export async function runUnitOrderedBatches(batches, concurrency, request, commit, signal) {
  const previousByUnit = new Map();
  const completed = new Set();
  const pending = new Map();
  const remainingByUnit = new Map();
  const lanes = batches.map(batch => [...new Set([
    ...(batch.unitIds ?? []), ...(!batch.unitIds?.length || batch.sceneZoneIds?.length ? [SCENE_LANE] : []),
  ])]);
  const dependenciesByIndex = lanes.map((lane, index) => {
    const dependencies = new Set();
    for (const unitId of lane) {
      const previous = previousByUnit.get(unitId);
      if (previous !== undefined) dependencies.add(previous);
      previousByUnit.set(unitId, index);
      remainingByUnit.set(unitId, (remainingByUnit.get(unitId) ?? 0) + 1);
    }
    return dependencies;
  });
  const ready = index => [...dependenciesByIndex[index]].every(dependency => completed.has(dependency));
  const priority = index => Math.max(0, ...lanes[index].map(id => remainingByUnit.get(id) ?? 0));
  const selectReady = () => batches.map((_, index) => index)
    .filter(index => !completed.has(index) && !pending.has(index) && ready(index))
    .sort((a, b) => priority(b) - priority(a) || a - b)[0];
  let stopped = false, failure;
  const launch = index => {
    const batch = batches[index];
    const task = (async () => {
      try {
        let result;
        try { result = { value: await request(batch, index) }; }
        catch (error) { result = { error }; }
        signal.throwIfAborted();
        await commit(result, batch, index);
        completed.add(index);
        for (const unitId of lanes[index]) remainingByUnit.set(unitId, remainingByUnit.get(unitId) - 1);
      } catch (error) {
        stopped = true;
        failure ??= error;
      } finally {
        pending.delete(index);
      }
    })();
    pending.set(index, task);
  };
  try {
    while (!stopped && completed.size < batches.length) {
      signal.throwIfAborted();
      while (!stopped && pending.size < concurrency) {
        const index = selectReady();
        if (index === undefined) break;
        launch(index);
      }
      if (pending.size) {
        await Promise.race(pending.values());
      } else if (!stopped && completed.size < batches.length) {
        throw new Error('标准化批次依赖无法满足');
      }
    }
  } catch (error) {
    stopped = true;
    failure ??= error;
  }
  if (pending.size) await Promise.allSettled(pending.values());
  if (failure) throw failure;
}

export function readNarrativeExemptions(value = [], sent, sourceFor, { solved = [], unresolved = [] } = {}) {
  const matched = [], invalid = [];
  if (!Array.isArray(value)) return { matched, invalid: ['未能读取模型的非战斗说明'] };
  const seen = new Set();
  for (const [i, entry] of value.entries()) {
    const label = `第 ${i + 1} 条非战斗说明`;
    const reason = diagnosticText(entry?.reason, '');
    if (!reason) {
      invalid.push(`${label}缺少词条引用或原因`);
      continue;
    }
    const matches = sent.filter(warning => identifiesWarning(entry, warning));
    if (matches.length !== 1) {
      invalid.push(`${label}无法唯一匹配本批词条`);
      continue;
    }
    const [warning] = matches;
    const reference = warningKey(warning);
    if (seen.has(reference)) {
      invalid.push(`${label}无法唯一匹配本批词条`);
      continue;
    }
    if (solved.some(item => identifiesWarning(item, warning)) || unresolved.some(item => item.warning === warning)) {
      invalid.push(`${label}与本批处理结果冲突`);
      continue;
    }
    const source = sourceFor(warning.unitId, warningEntryKey(warning));
    if (!source) {
      invalid.push(`${label}缺少词条来源`);
      continue;
    }
    seen.add(reference);
    matched.push({ warning, receipt: { unitId: warning.unitId, key: reference, source, reason, origin: 'ai',
      semanticKey: semanticExemptionKey(warning), staticFingerprint: normalizeClauseForHash(warning.message), status: 'active' } });
  }
  return { matched, invalid };
}

export function activeNarrativeExemptions(warnings, receipts, sourceFor) {
  return warnings.flatMap(warning => {
    const receipt = activeWarningExemption(warning, receipts, sourceFor);
    return receipt ? [{ warning, receipt }] : [];
  });
}
