import { GLOBAL_UI_PREF_KEYS } from '../ui/mount.js';

const PREFIX = 'fated-tactical/';
const GLOBAL_STATE_KEYS = new Set(['battle-v1', 'battle-v1/seed', 'carry-v1', 'reset-probe']
  .map(key => PREFIX + key));
const BATTLE_SNAPSHOT = `${PREFIX}battle-v1`;
const TAVERN_PREFIX = `${PREFIX}tavern/`;
const INSTANCES_PREFIX = `${PREFIX}instances/`;
const MAX_RETAINED_BATCH_BATTLES = 2;

function parseStoredBattleKey(key) {
  if (!key?.startsWith(PREFIX) || key.startsWith(TAVERN_PREFIX) || key.startsWith(INSTANCES_PREFIX) || GLOBAL_STATE_KEYS.has(key)) return null;
  const slash = key.indexOf('/', PREFIX.length);
  return slash > PREFIX.length ? key.slice(PREFIX.length, slash) : null;
}

export function pruneBattleStorageExcept(storage, keepKey) {
  let removedKeys = 0, freedBytes = 0;
  try {
    const keys = Array.from({ length: storage?.length ?? 0 }, (_, i) => storage.key(i));
    for (const key of keys) {
      const battle = parseStoredBattleKey(key);
      if (!battle || (battle === keepKey && !GLOBAL_UI_PREF_KEYS.has(key.slice(PREFIX.length + battle.length + 1)))) continue;
      try {
        const bytes = (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
        storage.removeItem(key);
        removedKeys += 1;
        freedBytes += bytes;
      } catch { /* continue with the remaining keys */ }
    }
  } catch { /* storage enumeration unavailable */ }
  return { removedKeys, freedBytes };
}

export function pruneBattleScopedMap(record, activeKey, maxBattles = MAX_RETAINED_BATCH_BATTLES) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || maxBattles < 1) return {};
  const hasActive = activeKey && Object.hasOwn(record, activeKey);
  const others = Object.entries(record).filter(([key, value]) => key !== activeKey &&
    value && typeof value === 'object' && Object.keys(value).length > 0);
  const limit = maxBattles - Number(Boolean(activeKey));
  const result = Object.fromEntries(limit > 0 ? others.slice(-limit) : []);
  if (hasActive) result[activeKey] = record[activeKey];
  return result;
}

export function toStoredCharSnapshot({ hash, entryHashes }, resolvedWarnings = []) {
  return { hash, entryHashes, resolvedWarnings };
}

export function toPersistedOpeningSource({ mvuData, latestFloor, battleInit, battleRaw, charInfo, protagonistName, battleKey, source }) {
  return structuredClone({ mvuData, latestFloor, battleInit, battleRaw, charInfo, protagonistName, battleKey, source });
}

function storageCategory(key) {
  if (key.startsWith(INSTANCES_PREFIX)) return 'instancesBytes';
  if (key.startsWith(TAVERN_PREFIX)) {
    const match = key.slice(TAVERN_PREFIX.length).match(/\/(ai-sessions|charSnapshots|normalizationBatches|narrativeExemptions|unresolvedNotes)$/);
    if (match?.[1] === 'ai-sessions') return 'aiSessionsBytes';
    if (match?.[1] === 'charSnapshots') return 'charSnapshotsBytes';
    return match ? 'normalizationBatchesBytes' : 'chatConfigBytes';
  }
  const battle = parseStoredBattleKey(key);
  const field = battle ? key.slice(PREFIX.length + battle.length + 1) : key;
  if (field === BATTLE_SNAPSHOT || field === `${BATTLE_SNAPSHOT}/seed`) return 'battleSnapshotBytes';
  if (field === 'opening-source' || field === 'chat-opening-patches') return 'openingSourceBytes';
  if (field.startsWith('mvu-')) return 'mvuWritebackBytes';
  return 'otherFatedBytes';
}

export function computeStorageDiagnostics(storage, activeBattleKey) {
  const categories = {
    battleSnapshotBytes: 0, openingSourceBytes: 0, mvuWritebackBytes: 0,
    chatConfigBytes: 0, aiSessionsBytes: 0, charSnapshotsBytes: 0,
    normalizationBatchesBytes: 0, instancesBytes: 0, otherFatedBytes: 0,
  };
  const summary = { totalBytes: 0, keyCount: 0, activeBattleKey: activeBattleKey ?? null, categories };
  // Approximate localStorage usage from the UTF-16 key and value lengths.
  try {
    for (let i = 0; i < (storage?.length ?? 0); i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const bytes = (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
      summary.totalBytes += bytes;
      summary.keyCount += 1;
      categories[storageCategory(key)] += bytes;
    }
  } catch { /* storage enumeration unavailable */ }
  return summary;
}
