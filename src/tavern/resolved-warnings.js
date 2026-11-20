// Receipts identify an individual conversion diagnostic, not every warning on a unit.
export const warningKey = w => JSON.stringify([w.source, w.scope, w.originPath ?? '', w.message]);
const strings = v => (Array.isArray(v) ? v : [v]).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
const matches = (message, s) => message.includes(s) || s.includes(message);
const subject = message => message.match(/已忽略[：:]\s*([^：:，。]+)/)?.[1]?.trim()
  ?? message.match(/^(?:效果|状态)\s+(.+?)\s*已拒绝/)?.[1]?.trim();

export function resolvedDiagnostics(sent, records, patch, reply) {
  const top = [...strings(reply.resolved), ...strings(reply.resolvedWarnings)];
  const declared = top.length || patch.some(op => strings(op.resolves).length);
  const pending = strings(reply.unresolved);
  const isPending = w => pending.some(s => matches(w.message,s) || (subject(w.message) && s.includes(subject(w.message))));
  return sent.filter(w => {
    if (w.unitId == null || !Object.hasOwn(records, w.unitId) || isPending(w)) return false;
    const label = subject(w.message);
    if (top.some(s => w.message.includes(s))) return true;
    return patch.some(op => {
      const owner = op.path.match(/^\/units\/([^/]+)/)?.[1];
      if (owner && owner !== w.unitId) return false;
      // A declaration for another template with the same effect name must not clear this one.
      const path = op.path.split('/').slice(0,3).join('/');
      if (w.originPath && path.split('/')[1] === w.originPath.split('/')[1] && path !== w.originPath) return false;
      if (declared) return strings(op.resolves).some(s => w.message.includes(s));
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

export function remainingDiagnostics(warnings, snapshots, characters) {
  return warnings.filter(w => {
    const snapshot = snapshots[w.unitId];
    return !snapshot || snapshot.hash !== characters[w.unitId]?.hash || !snapshot.resolvedWarnings?.includes(warningKey(w));
  });
}
