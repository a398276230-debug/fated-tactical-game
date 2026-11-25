const GLOBAL_CHAT_ID = '__global__';
const SCOPES = new Set(['chat', 'global', 'chat_and_global']);

const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const clone = value => {
  try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
};
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
  return JSON.stringify([pathFamily(warning.originPath), warning.scope ?? '', normalizeClauseForHash(clause)]);
}

export function exemptionStorageKey(chatId, global = false) {
  return `fated-tactical/tavern/${global ? GLOBAL_CHAT_ID : String(chatId || 'default')}/narrativeExemptions`;
}

function readJSON(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? 'null');
    return value;
  } catch (_) { return null; }
}
function writeJSON(storage, key, value) {
  try { return Boolean(storage?.setItem(key, JSON.stringify(value))); } catch (_) { return false; }
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

function flattenStored(value, fallbackOrigin = 'manual') {
  if (Array.isArray(value)) return value.map(record => normalizedRecord(record, fallbackOrigin)).filter(Boolean);
  // One-time read compatibility for the previously shipped battle-key map.
  if (value && typeof value === 'object') return Object.values(value).flatMap(bucket => flattenStored(bucket, fallbackOrigin));
  return [];
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
    const current = sourceFor(warning.unitId, `${pathFamily(warning.originPath)}:${text(warning.originPath).split('/')[2] ?? ''}`);
    if (current && winner.source !== current && winner.staticFingerprint && winner.staticFingerprint !== normalizeClauseForHash(current)) return null;
  }
  return winner;
}

export class ExemptionLedger {
  constructor({ storage = null, chatId = 'default', scope = 'chat_and_global' } = {}) {
    this.storage = storage;
    this.chatId = String(chatId || 'default');
    this.scope = SCOPES.has(scope) ? scope : 'chat_and_global';
    this.chatRecords = [];
    this.globalRecords = [];
    this.reload();
  }
  keys() {
    return {
      chat: exemptionStorageKey(this.chatId),
      global: exemptionStorageKey(this.chatId, true),
    };
  }
  reload() {
    const keys = this.keys();
    this.chatRecords = flattenStored(readJSON(this.storage, keys.chat));
    this.globalRecords = flattenStored(readJSON(this.storage, keys.global));
    return this;
  }
  records() {
    const values = this.scope === 'global' ? this.globalRecords
      : this.scope === 'chat' ? this.chatRecords : [...this.globalRecords, ...this.chatRecords];
    return mergeExemptionRecords(values);
  }
  active(warnings = [], sourceFor) {
    const records = this.records();
    return warnings.flatMap(warning => {
      const receipt = activeRecordFor(warning, records, sourceFor);
      return receipt ? [{ warning, receipt }] : [];
    });
  }
  save(records, target = 'chat') {
    const key = target === 'global' ? this.keys().global : this.keys().chat;
    const ok = writeJSON(this.storage, key, records);
    if (target === 'global') this.globalRecords = records;
    else this.chatRecords = records;
    return ok;
  }
  upsert(warning, { reason = '', origin = 'manual', source = null } = {}, target = 'chat') {
    this.reload();
    const semanticKey = semanticExemptionKey(warning);
    const current = target === 'global' ? this.globalRecords : this.chatRecords;
    const record = normalizedRecord({
      unitId: warning.unitId ?? null, key: warning.key, originPath: warning.originPath ?? null,
      message: warning.message, semanticKey, source, reason, origin,
      staticFingerprint: normalizeClauseForHash(warning.message), status: 'active', updatedAt: Date.now(),
    }, origin);
    return this.save([...current.filter(item => recordKey(item) !== semanticKey), record], target);
  }
  revoke(warning, { reason = '玩家已恢复为待编译', origin = 'manual' } = {}, target = 'chat') {
    this.reload();
    const semanticKey = semanticExemptionKey(warning);
    const current = target === 'global' ? this.globalRecords : this.chatRecords;
    const tombstone = normalizedRecord({ semanticKey, unitId: warning.unitId ?? null,
      key: warning.key, originPath: warning.originPath ?? null, message: warning.message,
      reason, origin, status: 'revoked', updatedAt: Date.now() }, origin);
    return this.save([...current.filter(item => recordKey(item) !== semanticKey), tombstone], target);
  }
  removeWarnings(warnings = [], target = 'chat') {
    this.reload();
    const keys = new Set(warnings.map(semanticExemptionKey));
    const current = target === 'global' ? this.globalRecords : this.chatRecords;
    return this.save(current.filter(item => !keys.has(recordKey(item))), target);
  }
}

export function activeExemption(warning, records, sourceFor) {
  return activeRecordFor(warning, records.map(normalizedRecord).filter(Boolean), sourceFor);
}

export { GLOBAL_CHAT_ID };
