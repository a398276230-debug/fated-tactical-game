import {
  diagnosticTitle,
  existingEffectReceipts,
  identifiesWarning,
  missingDispositions,
  readUnresolvedDiagnostics,
  resolvedDiagnostics,
} from './resolved-warnings.js';
import {
  normalizationOperations,
  normalizationRepairAllowed,
  readNarrativeExemptions,
} from './normalization-batches.js';
import { parseAIResponse, stripReasoningBlocks } from './overlay-ai.js';
import { entryRoot as rootPath } from './normalization-replay.js';
import { applyPatch as defaultApplyPatch, fingerprintAt, formatRejectedItem, partitionNormalizationPatch } from './overlay-patch.js';

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

export function rejectedWarning(item, warning) {
  return (Array.isArray(item.op?.resolves) && item.op.resolves.some(reference => identifiesWarning(reference, warning)))
    || (warning.originPath && (item.path === warning.originPath || item.path?.startsWith(`${warning.originPath}/`)));
}

export function repairWarnings(accepted = {}) {
  const output = [];
  const seen = new Set();
  for (const warning of [...(accepted.repairWarnings ?? []), ...(accepted.missingWarnings ?? accepted.missing ?? [])]) {
    const key = JSON.stringify([warning?.unitId ?? null, warning?.originPath ?? null, warning?.message ?? '']);
    if (!seen.has(key)) { seen.add(key); output.push(warning); }
  }
  return output;
}

function templateSummary(state, path) {
  const value = JSON.parse(fingerprintAt(state, path) ?? 'null');
  if (!value || typeof value !== 'object') return '';
  const mods = Array.isArray(value.mods) ? value.mods.map(mod => mod?.stat ?? mod?.kind ?? '?').join(',') : '';
  const hooks = Array.isArray(value.rules) ? value.rules.map(rule => rule?.hook ?? rule?.kind ?? '?').join(',') : '';
  return `；liveState已有模板摘要：name=${value.name ?? ''}, category=${value.category ?? ''}, stackMode=${value.stackMode ?? ''}, maxStacks=${value.maxStacks ?? ''}, mods=[${mods}], hooks=[${hooks}]。若机制一致请删去 add 直接引用，若属本角色专属机制请改用带前缀的新 ID 并同步更新本批引用`;
}

function conflictRepairError(rejected, current) {
  if (!rejected.length) return null;
  const message = rejected.map(item => {
    const detail = formatRejectedItem(item, current);
    return /^共享模板定义冲突：\/(?:statusTemplates|skills)\//.test(item.reason ?? '')
      ? `${detail}${templateSummary(current, item.path)}` : detail;
  }).join('；');
  return Object.assign(new Error(message), { raw: JSON.stringify(rejected.map(item => item.op)) });
}

/**
 * Evaluate one model response against the live normalization state.
 * This is the sole production acceptance path used by the overlay and corpus harness.
 * It does not persist or mount state; callers perform those domain-specific effects.
 */
export function acceptNormalizationResponse({
  reply,
  snapshot,
  sent,
  unitIds,
  current,
  baseline,
  existingOps = [],
  createdTemplates = new Map(),
  records = {},
  sourceFor = () => undefined,
  duplicateOperations = operation => [],
  apply = defaultApplyPatch,
  validate = () => {},
  normalize = state => state,
  acceptPartial = false,
}) {
  const { data, parseError } = parseAIResponse(reply);
  const explicitUnresolved = Array.isArray(data?.unresolved) && data.unresolved.length > 0;
  const explicitNarrative = Array.isArray(data?.narrative) && data.narrative.length > 0;
  if (isObject(data) && !Object.hasOwn(data, 'patch') && (explicitUnresolved || explicitNarrative || Array.isArray(data.existing) && data.existing.length)) data.patch = [];
  if (!Array.isArray(data?.patch)) {
    const error = new Error(`模型未返回有效的战局补丁${parseError ? `：${parseError}` : ''}`);
    const source = typeof reply === 'string' ? stripReasoningBlocks(reply) : '';
    error.raw = /^[\s<]*(?:```(?:json)?\s*)?[{[]/i.test(source)
      ? source.slice(source.search(/[{[]/)) : undefined;
    if (explicitUnresolved) error.noRepair = true;
    throw error;
  }

  const raw = JSON.stringify(data, null, 2);
  try {
    const { matched: notes, invalid: unmatchedNotes } = readUnresolvedDiagnostics(data.unresolved, sent);
    const conflicts = [];
    const expand = operation => [operation, ...duplicateOperations(operation)];
    const rebasedPatch = data.patch.flatMap((operation, index) => {
      if (typeof operation?.path !== 'string') return [operation];
      try {
        const accepted = normalizationOperations([operation], snapshot, current, createdTemplates, fingerprintAt);
        if (accepted.length) normalizationOperations(duplicateOperations(operation), snapshot, current, createdTemplates, fingerprintAt);
        return accepted;
      } catch (error) {
        conflicts.push({ index, op: operation, path: operation.path, reason: error.message });
        return [];
      }
    });
    const partition = partitionNormalizationPatch({
      liveState: current,
      baselineState: baseline,
      existingOps,
      rawPatch: rebasedPatch,
      conflictingDefinitions: conflicts
        .filter(item => item.op.op === 'add' && /^\/(?:skills|statusTemplates)\/[^/]+$/.test(item.path))
        .map(item => item.path),
      allowedUnitIds: unitIds,
      expand,
      apply,
      validate,
      normalize,
    });
    const rejected = [...conflicts, ...partition.rejected];
    const blockedWarnings = new Set(sent.filter(warning => rejected.some(item => rejectedWarning(item, warning))));
    const eligibleWarnings = sent.filter(warning => !blockedWarnings.has(warning));
    const repair = sent.filter(warning => blockedWarnings.has(warning) && !notes.some(note => note.warning === warning && note.detail));
    const repairError = conflictRepairError(rejected, current);

    data.patch = partition.accepted.map(item => item.op);
    const operationsToApply = data.patch;
    const paths = [...new Set(operationsToApply.flatMap(expand).map(operation => rootPath(operation.path)))];
    let next = current;
    const changedAtApply = new Map();
    for (const operation of operationsToApply) {
      const parentPath = operation.path.slice(0, operation.path.lastIndexOf('/'));
      const path = operation.op === 'replace' || !fingerprintAt(next, parentPath)?.startsWith('[')
        ? operation.path : parentPath;
      const before = fingerprintAt(next, path);
      next = apply(next, expand(operation), true);
      const after = fingerprintAt(next, path);
      if (after !== before) changedAtApply.set(operation, { path, after });
    }
    const changed = new Set(paths.filter(path => fingerprintAt(next, path) !== fingerprintAt(current, path)));
    const effective = operationsToApply.filter(operation => expand(operation).some(copy => changed.has(rootPath(copy.path))));
    const patch = effective.flatMap(({ resolves, ...operation }) => expand(operation));
    const changedOperations = effective.filter(operation => {
      const change = changedAtApply.get(operation);
      if (!change || fingerprintAt(current, change.path) === fingerprintAt(next, change.path)) return false;
      if (change.path === operation.path) {
        const final = fingerprintAt(next, change.path);
        if (final === change.after) return true;
        if (operation.op !== 'add' || !Array.isArray(operation.value) || !operation.value.length) return false;
        const array = JSON.parse(final ?? 'null');
        if (!Array.isArray(array)) return false;
        const remaining = array.map(value => JSON.stringify(value));
        return operation.value.every(value => {
          const index = remaining.indexOf(JSON.stringify(value));
          if (index < 0) return false;
          remaining.splice(index, 1);
          return true;
        });
      }
      const array = JSON.parse(fingerprintAt(next, change.path) ?? 'null');
      const values = Array.isArray(operation.value) ? operation.value : [operation.value];
      return operation.op === 'remove' ? fingerprintAt(next, change.path) === change.after
        : Array.isArray(array) && values.every(expected => array.some(value => JSON.stringify(value) === JSON.stringify(expected)));
    });
    const solved = resolvedDiagnostics(eligibleWarnings, records, changedOperations, notes);
    const { matched: narrative, invalid: invalidNarrative } = readNarrativeExemptions(data.narrative, eligibleWarnings,
      sourceFor, { solved, unresolved: notes });
    unmatchedNotes.push(...invalidNarrative);
    if (operationsToApply.length && !patch.length && !narrative.length && !data.existing?.length && !notes.some(note => note.warning && note.detail)) {
      throw new Error('模型返回的补丁没有改变战局');
    }

    let before;
    if (patch.length || data.existing?.length) before = apply(baseline, existingOps, true);
    const verified = (Array.isArray(data.existing) ? data.existing : []).flatMap((receipt, index) => {
      try {
        const [entry] = existingEffectReceipts([receipt], sent, baseline, before, current, fingerprintAt);
        const { warning, path, fingerprint } = entry;
        if (blockedWarnings.has(warning) || notes.some(note => note.warning === warning)
          || narrative.some(note => note.warning === warning) || fingerprintAt(next, path) !== fingerprint) throw new Error('已有实现与本批处理结果冲突');
        if (!solved.includes(warning)) solved.push(warning);
        return [entry];
      } catch {
        unmatchedNotes.push(`第 ${index + 1} 条已有实现说明未通过核对`);
        return [];
      }
    });
    if (data.existing !== undefined && !Array.isArray(data.existing)) unmatchedNotes.push('未能读取模型的已有实现说明');
    const missing = missingDispositions(sent, solved, notes, narrative);
    if (missing.length && !patch.length && !verified.length && !notes.some(note => note.detail) && !narrative.length && !rejected.length && !unmatchedNotes.length) {
      const error = new Error(`模型没有提交任何可核销结果，仍缺 ${missing.length} 项：${missing.map(w => `${w.originPath ?? w.unitId}「${diagnosticTitle(w)}」`).join('、')}`);
      error.missingCoverage = true; error.missingWarnings = missing; error.noRepair = Boolean(acceptPartial); throw error;
    }
    if (missing.length && !acceptPartial && !patch.length && !repair.length && !unmatchedNotes.length && !verified.length
      && !notes.some(note => note.detail) && !narrative.length) {
      const error = new Error(`本批漏答 ${missing.length} 项：${missing.map(w => `${w.originPath ?? w.unitId}「${diagnosticTitle(w)}」`).join('、')}。本批尚未写入；保留已完成的补丁，重新提交完整结果。已实现的效果请在实际修改的操作上补 resolves；只创建依赖模板还须接回原技能。其余逐项写 unresolved 并说明原因，纯叙事才写 narrative。`);
      error.missingCoverage = true; error.missingWarnings = missing; throw error;
    }
    for (const note of notes) {
      const path = note.warning?.originPath;
      if (!note.detail || !path) continue;
      note.evidence = changedOperations.flatMap(op => {
        if (op.op === 'remove' || !Array.isArray(op.resolves) || !op.resolves.some(ref => identifiesWarning(ref, note.warning)
          && sent.filter(w => identifiesWarning(ref, w)).length === 1)) return [];
        return ['rules','mods','pools','damage','heal'].flatMap(field => {
          const pointer = `${path}/${field}`;
          if (op.path !== path && op.path !== pointer && !op.path.startsWith(`${pointer}/`)) return [];
          const value = fingerprintAt(next, pointer);
          return value !== undefined && value !== '[]' && value !== '{}' && value !== fingerprintAt(current, pointer) ? [[pointer, value]] : [];
        });
      });
    }
    return { data, notes, unmatchedNotes, current, next, baseline, before, rebasedPatch, conflicts, partition, rejected,
      blockedWarnings, eligibleWarnings, repairWarnings: repair, repairError, operationsToApply, effective, patch,
      changedOperations, solved, narrative, verified, missing, missingWarnings: missing,
      explicitUnresolved, explicitNarrative, accepted: effective.length };
  } catch (error) {
    error.raw ??= raw;
    throw error;
  }
}

export async function runNormalizationRepair({ batch, index, result, commit, request, onRepair = () => {}, repairAllowed = normalizationRepairAllowed }) {
  let repairAttempts = 0;
  let accepted;
  let repaired;
  try {
    accepted = commit(batch, result);
  } catch (error) {
    if (!repairAllowed({ attempts: repairAttempts, explicitUnresolved: error.noRepair || result?.explicitUnresolved })) throw error;
    repairAttempts++;
    const revisedBatch = error.missingWarnings?.length ? { ...batch, warnings: error.missingWarnings } : batch;
    const correction = error.missingCoverage
      ? Object.assign(new Error(`上一轮静默遗漏：${error.message}`), { raw: error.raw }) : error;
    onRepair({ kind: 'initial', batch: revisedBatch, correction, attempts: repairAttempts });
    const revised = await request(revisedBatch, index, correction);
    try {
      accepted = commit(revisedBatch, revised, { acceptPartial: true });
    } catch (retryError) {
      if (!error.missingCoverage) throw retryError;
      accepted = commit(batch, result, { acceptPartial: true });
    }
  }
  if (!repairAttempts && repairWarnings(accepted).length) {
    repairAttempts++;
    const toRepair = repairWarnings(accepted);
    const revisedBatch = { ...batch, warnings: toRepair };
    const rejected = new Set(accepted.repairWarnings ?? []);
    const titles = list => list.map(w => `${w.originPath ?? w.unitId}「${diagnosticTitle(w)}」`).join('、');
    const omitted = toRepair.filter(w => !rejected.has(w));
    const message = [rejected.size && `校验被拒：${titles([...rejected])}。${accepted.repairError?.message ?? ''}`,
      omitted.length && `上一轮静默遗漏：${titles(omitted)}。请逐项补答。`].filter(Boolean).join('\n');
    const correction = Object.assign(new Error(message), { raw: accepted.repairError?.raw });
    onRepair({ kind: 'rejected-or-missing', batch: revisedBatch, correction, attempts: repairAttempts });
    try {
      const revised = await request(revisedBatch, index, correction);
      repaired = commit(revisedBatch, revised, { acceptPartial: true });
    } catch (error) {
      repaired = null;
      onRepair({ kind: 'failed', error, batch: revisedBatch, correction, attempts: repairAttempts });
    }
  }
  return { accepted, repaired, repairAttempts };
}

