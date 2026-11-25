const text = value => value == null ? '' : String(value);

/**
 * Canonicalize narrative wording for a static exemption identity.
 * Runtime counters, quantities, ids and formatting noise are deliberately not
 * part of the identity: "灵魂计数：0" and "灵魂计数：5" are one clause.
 */
export function normalizeClauseForHash(value) {
  return text(typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    .normalize('NFKC')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/(?:当前|剩余|已有|持有|数量|计数|层数|层级|堆叠|次数|额度|耐久|弹药|灵魂|魂数)\s*[：:]?\s*[-+]?\d+(?:\.\d+)?/giu,
      match => match.replace(/[-+]?\d+(?:\.\d+)?/g, '<DYNAMIC>'))
    .replace(/[-+]?\d+(?:\.\d+)?/g, '<DYNAMIC>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .trim().toLowerCase();
}

function pathFamily(path) {
  const match = text(path).match(/^\/?([^/]+)/);
  return match?.[1] ?? 'unit';
}

/**
 * Identity independent of generated unit/template ids. The human clause is
 * the durable identity; the table family prevents an equipment warning from
 * colliding with an unrelated unit-level warning with the same wording.
 */
export function semanticExemptionKey(warning = {}, clause = warning.message) {
  const family = pathFamily(warning.originPath);
  // Scene ranges and numbers describe fixed mechanics, not mutable counters.
  const identity = family === 'zones' ? text(clause).normalize('NFKC').replace(/\s+/g, ' ').trim() : normalizeClauseForHash(clause);
  return JSON.stringify([family, warning.scope ?? '', identity]);
}

function recordKey(record) {
  return record?.semanticKey ?? (record ? semanticExemptionKey(record, record.message) : '');
}
function normalizedRecord(record, fallbackOrigin = 'manual') {
  if (!record || typeof record !== 'object') return null;
  const semanticKey = recordKey(record);
  if (!semanticKey) return null;
  return {
    ...record,
    semanticKey,
    origin: record.origin === 'ai' ? 'ai' : fallbackOrigin,
    status: record.status === 'revoked' || record.revoked === true ? 'revoked' : 'active',
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  };
}

function preference(record) {
  return [record.updatedAt ?? 0, record.origin === 'manual' ? 1 : 0];
}

/** Merge records by semantic identity; a later tombstone remains effective. */
export function mergeExemptionRecords(records = []) {
  const groups = new Map();
  for (const item of records.map(normalizedRecord).filter(Boolean)) {
    const list = groups.get(item.semanticKey) ?? [];
    list.push(item);
    groups.set(item.semanticKey, list);
  }
  return [...groups.values()].map(list => list.reduce((winner, item) => {
    if (!winner) return item;
    const [at, origin] = preference(item), [wat, worigin] = preference(winner);
    return at > wat || at === wat && origin > worigin ? item : winner;
  }, null));
}

function activeRecordFor(warning, records, sourceFor) {
  const key = semanticExemptionKey(warning);
  const candidates = records.filter(record => record.semanticKey === key);
  if (!candidates.length) {
    // Existing in-memory/test receipts did not have semanticKey yet.
    const legacy = records.find(record => record.unitId === warning.unitId && record.key === JSON.stringify([record.source,
      warning.scope, warning.originPath ?? '', warning.message]));
    return legacy?.status === 'revoked' ? null : legacy;
  }
  const winner = mergeExemptionRecords(candidates)[0];
  if (!winner || winner.status === 'revoked') return null;
  // AI receipts are tied to the clause as it was converted. Manual decisions
  // intentionally survive source hash churn and generated-id changes.
  if (winner.origin === 'ai' && winner.source && sourceFor) {
    const family = pathFamily(warning.originPath);
    const current = sourceFor(warning.unitId, `${family}:${text(warning.originPath).split('/')[2] ?? ''}`);
    if (family === 'zones' && winner.source !== current) {
      // Different floors can use different IDs for the exact same clause.
      const sceneContent = source => {
        try { const { id, ...entry } = JSON.parse(source); return JSON.stringify(entry); } catch { return undefined; }
      };
      if (!current || !sceneContent(current) || sceneContent(winner.source) !== sceneContent(current)) return null;
    } else if (current && winner.source !== current && winner.staticFingerprint && winner.staticFingerprint !== normalizeClauseForHash(current)) return null;
  }
  return winner;
}

export function activeExemption(warning, records, sourceFor) {
  return activeRecordFor(warning, records.map(normalizedRecord).filter(Boolean), sourceFor);
}
