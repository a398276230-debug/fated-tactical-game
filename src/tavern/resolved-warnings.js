// Receipts identify an individual conversion diagnostic, not every warning on a unit.
export const warningKey = w => JSON.stringify([w.source, w.scope, w.originPath ?? '', w.message]);
const strings = v => (Array.isArray(v) ? v : [v]).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
const matches = (message, s) => message.includes(s) || s.includes(message);
const subject = message => message.match(/已忽略[：:]\s*([^：:，。]+)/)?.[1]?.trim()
  ?? message.match(/^(?:效果|状态)\s+(.+?)\s*已拒绝/)?.[1]?.trim();

const describesWarning = (item, warning) => {
  const label = subject(warning.message);
  return matches(warning.message, item) || Boolean(label && item.includes(label));
};

export function pendingDiagnostics(warnings, unresolved) {
  const notes = [...new Set(strings(unresolved))];
  return [
    ...warnings.map(warning => {
      const details = notes.filter(note => note !== warning.message && describesWarning(note, warning));
      return details.length ? `${warning.message}（模型说明：${details.join('；')}）` : warning.message;
    }),
    ...notes.filter(note => !warnings.some(warning => describesWarning(note, warning))),
  ];
}

export function resolvedDiagnostics(sent, records, patch, reply) {
  const top = [...strings(reply.resolved), ...strings(reply.resolvedWarnings)];
  const declared = top.length || patch.some(op => op.resolves != null);
  const identified = (op, warning) => [].concat(op.resolves ?? []).some(receipt =>
    receipt && typeof receipt === 'object' && receipt.unitId === warning.unitId
    && receipt.originPath === (warning.originPath ?? null) && receipt.message === warning.message);
  const pending = strings(reply.unresolved);
  const isPending = w => pending.some(item => describesWarning(item, w));
  return sent.filter(w => {
    if (w.unitId == null || !Object.hasOwn(records, w.unitId) || isPending(w)) return false;
    const label = subject(w.message);
    if (top.some(s => w.message.includes(s) && sent.filter(other => other.unitId != null
      && Object.hasOwn(records, other.unitId) && other.message.includes(s)).length === 1)) return true;
    return patch.some(op => {
      const owner = op.path.match(/^\/units\/([^/]+)/)?.[1];
      if (owner && owner !== w.unitId) return false;
      // A declaration for another template with the same effect name must not clear this one.
      const path = op.path.split('/').slice(0,3).join('/');
      if (w.originPath && path.split('/')[1] === w.originPath.split('/')[1] && path !== w.originPath) return false;
      if (declared) return identified(op, w) || strings(op.resolves).some(s => w.message.includes(s)
        && sent.filter(other => Object.hasOwn(records, other.unitId) && other.message.includes(s)
          && (!owner || other.unitId === owner)
          && (!other.originPath || path.split('/')[1] !== other.originPath.split('/')[1] || path === other.originPath)).length === 1);
      // Older responses: infer only an unambiguous diagnosis on the actual patched object.
      if (!w.originPath) {
        const [, , , field, statusId] = op.path.split('/');
        return owner === w.unitId && field === 'statuses' && w.scope === 'status' && !!statusId && w.message.includes(statusId);
      }
      if (path !== w.originPath) return false;
      return sent.filter(other => other.unitId === w.unitId && other.originPath === path && !isPending(other)).length === 1
        || (label && JSON.stringify(op.value ?? '').includes(label));
    });
  });
}

// A receipt can survive unrelated character changes only while its patch is replayable.
export function activeWarningReceipts(batches) {
  const receipts = new Map();
  for (const batch of batches) for (const { unitId, key } of batch.receipts ?? []) {
    if (!receipts.has(unitId)) receipts.set(unitId, new Set());
    receipts.get(unitId).add(key);
  }
  return receipts;
}

export function normalizationCandidates(characters, snapshots, warnings) {
  const pending = new Set(warnings.map(w => w.unitId));
  return Object.keys(characters).filter(id => pending.has(id) || !snapshots[id]?.normalized || snapshots[id].hash !== characters[id].hash);
}

export function remainingDiagnostics(warnings, snapshots, characters, batches = []) {
  const receipts = activeWarningReceipts(batches);
  return warnings.filter(w => {
    const snapshot = snapshots[w.unitId];
    const key = warningKey(w);
    return !receipts.get(w.unitId)?.has(key)
      && (!snapshot || snapshot.hash !== characters[w.unitId]?.hash || !snapshot.resolvedWarnings?.includes(key));
  });
}
