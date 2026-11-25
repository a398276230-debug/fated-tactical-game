import { readWritebackTarget, writeBattleVariables } from './host.js';

const field = (key, suffix) => `fated-tactical/${key}/mvu-${suffix}`;
const branch = id => id != null && /^\d+$/.test(String(id)) ? Number(id) : NaN;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function at(root, path) {
  if (!path.startsWith('/stat_data/')) throw new Error('战果路径不在 stat_data 内');
  let value = root;
  for (const part of path.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}
function read(storage, key) { return JSON.parse(storage.getItem(key) || 'null'); }
export async function outcomeDigest(patch) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(patch)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
const counter = /^(.+?[:：]\s*)(\d+)(\s*[/／]\s*(\d+))?$/u;
function project(old, end, latest, path, cap) {
  if (old.exists && end.exists && latest.exists) {
    const a = old.value, b = end.value, c = latest.value;
    if ([a,b,c].every(Number.isFinite)) return { exists: true, value: Math.max(0, Math.min(cap, c + b - a)) };
    const [x,y,z] = [a,b,c].map(v => typeof v === 'string' && counter.exec(v));
    if (x && y && z && x[1] === y[1] && y[1] === z[1]) {
      const max = z[4] ?? y[4];
      const n = Math.min(max == null ? Infinity : +max, Math.max(0, +z[2] + +y[2] - +x[2]));
      return { exists: true, value: `${z[1]}${n}${z[3] ?? (n < +max ? y[3] ?? '' : '')}` };
    }
  }
  if (equal(old, latest)) return end;
  throw new Error(`最新楼层的字段已改变，无法安全合并：${path}`);
}
function difference(path, before, after) {
  return equal(before, after) ? [] : [after.exists ? { op: before.exists ? 'replace' : 'add', path, value: after.value } : { op: 'remove', path }];
}
const active = new Map();
async function exclusive(key, callback) {
  if (active.has(key)) throw new Error('本场 MVU 同步正在进行');
  active.set(key, true);
  try { return await (globalThis.navigator?.locks ? navigator.locks.request(`fated-mvu:${key}`, callback) : callback()); }
  finally { active.delete(key); }
}
export function writebackReceipt(storage, key) { return read(storage, field(key, 'writeback-receipt')); }
export function rollbackBattleOutcome({ storage, host, key, lastMessageId, assertContext = () => {} }) {
  return exclusive(key, async () => {
    const journalKey = field(key, 'pre-writeback'), journal = read(storage, journalKey);
    if (!journal || Number(lastMessageId) > journal.targetMessageId) return false;
    const { statData, swipeId } = await readWritebackTarget(host, journal.targetMessageId);
    if (branch(swipeId) !== branch(journal.targetSwipeId)) throw new Error('SWIPE_MISMATCH：无法回滚其他 Swipe');
    const root = { stat_data: statData }, patch = [];
    for (const [path, baseline] of Object.entries(journal.baselineValues)) {
      const now = at(root, path);
      if (!equal(now, baseline) && !equal(now, journal.finalValues[path])) throw new Error(`写回后变量已被修改，未回滚：${path}`);
      patch.push(...difference(path, now, baseline));
    }
    assertContext();
    if (patch.length) await guardedWrite(host, journal, patch, statData);
    storage.removeItem(field(key, 'writeback-receipt')); storage.removeItem(journalKey);
    return true;
  });
}
async function guardedWrite(host, target, patch, expectedStatData) {
  const result = await writeBattleVariables(host, { messageId: target.targetMessageId, expectedSwipeId: target.targetSwipeId, patch, expectedStatData });
  if (!result?.ok) throw new Error(`${result?.code ?? 'MVU_WRITE_FAILED'}：${result?.message ?? '未写入'}`);
}
export function writeBattleOutcome({ storage, host, key, battleId, opening, patch, source, targetMessageId, targetSwipeId, force = false, assertContext = () => {} }) {
  return exclusive(key, async () => {
    const origin = await readWritebackTarget(host, Number(source.messageId));
    if (branch(origin.swipeId) !== branch(source.swipeId)) throw new Error('SWIPE_MISMATCH：触发战斗的楼层已切换 Swipe');
    const sameFloor = Number(source.messageId) === targetMessageId;
    const target = sameFloor ? origin : await readWritebackTarget(host, targetMessageId);
    if (branch(target.swipeId) !== branch(targetSwipeId)) throw new Error('SWIPE_MISMATCH：目标楼层已切换 Swipe');
    const digest = await outcomeDigest(patch), receipt = writebackReceipt(storage, key);
    const journalKey = field(key, 'pre-writeback');
    const prior = read(storage, journalKey);
    if (prior && (prior.targetMessageId !== targetMessageId || String(prior.targetSwipeId) !== String(targetSwipeId))) throw new Error('本场已绑定其他写回楼层或 Swipe，请先回滚');
    if (!force && receipt?.outcomeDigest === digest && prior && receipt.targetMessageId === targetMessageId && String(receipt.targetSwipeId) === String(targetSwipeId)) return receipt;
    const journal = { targetMessageId, targetSwipeId, baselineValues: { ...prior?.baselineValues }, finalValues: {}, outcomeDigest: digest };
    const root = { stat_data: target.statData }, initial = { stat_data: opening };
    const desired = new Map(patch.map(op => [op.path, op.op === 'remove' ? { exists: false } : { exists: true, value: op.value }]));
    const applied = [];
    for (const path of new Set([...Object.keys(journal.baselineValues), ...desired.keys()])) {
      const now = at(root, path), old = at(initial, path);
      const baseline = journal.baselineValues[path] ??= now;
      if (prior?.finalValues[path] && !equal(now, prior.finalValues[path]) && !equal(now, baseline)) throw new Error(`战果写回后字段已被修改：${path}`);
      const max = path.endsWith('/当前') ? at(root, path.slice(0, -2) + '上限').value : null;
      const cap = typeof max === 'number' ? max : Number.isFinite(max?._基础) ? max._基础 + (Number(max.额外 ?? max._额外) || 0) : Infinity;
      const end = desired.get(path);
      if (sameFloor && end && !equal(old, baseline)) throw new Error(`战斗楼层与开场基线不符：${path}`);
      const final = !end ? baseline : sameFloor ? end : project(old, end, baseline, path, cap);
      journal.finalValues[path] = final;
      applied.push(...difference(path, now, final));
    }
    assertContext();
    journal.appliedPatch = applied;
    storage.setItem(journalKey, JSON.stringify(journal)); // Persist recovery data before touching the host.
    if (applied.length) {
      try { await guardedWrite(host, journal, applied, target.statData); }
      catch (error) {
        // Leave recovery information if a host failed after mutating variables.
        const check = await readWritebackTarget(host, targetMessageId).catch(() => null);
        if (check && equal(check.statData, target.statData)) {
          if (prior) storage.setItem(journalKey, JSON.stringify(prior)); else storage.removeItem(journalKey);
        }
        throw error;
      }
    }
    const next = { battleKey: key, battleId, outcomeDigest: digest, targetMessageId, targetSwipeId, writtenAt: Date.now() };
    storage.setItem(field(key, 'writeback-receipt'), JSON.stringify(next));
    return next;
  });
}
