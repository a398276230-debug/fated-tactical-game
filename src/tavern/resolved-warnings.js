// Receipts identify an individual conversion diagnostic, not every warning on a unit.
export const warningKey = w => JSON.stringify([w.source, w.scope, w.originPath ?? '', w.message]);
const subject = message => message.match(/待标准化「([^」]+)」/)?.[1]?.trim()
  ?? message.match(/已忽略[：:]\s*([^：:，。]+)/)?.[1]?.trim()
  ?? message.match(/^(?:效果|状态)\s+(.+?)\s*已拒绝/)?.[1]?.trim();
const nonempty = value => typeof value === 'string' && value.trim() !== '';

// The expandable model response is for debugging; diagnostic lines are always prose.
export function diagnosticText(value, fallback = '模型返回了结构化数据，未提供文字说明') {
  if (!nonempty(value)) return fallback;
  const text = value.trim();
  const payload = text.search(/```|\{\s*(?:["'}]|$)|\[\s*(?:["{\[]|\]|(?:-?\d|true|false|null)[^\]]*\s*,)/);
  if (payload !== -1) {
    const prefix = text.slice(0, payload).trim().replace(/[（(：:]\s*$/, '').trim();
    return prefix ? `${prefix}（结构化详情已省略）` : fallback;
  }
  try { if (typeof JSON.parse(text) === 'object') return fallback; } catch { /* prose */ }
  return text;
}

function readTextNote(text, sent) {
  const exact = sent.filter(warning => text === warning.message);
  if (exact.length) return exact.map(warning => ({ warning }));
  const match = sent.flatMap(warning => {
    const title = subject(warning.message);
    if (!title) return [];
    for (const label of [title, `「${title}」`]) {
      if (text === label) return [{ warning }];
      const tail = text.slice(label.length);
      if (text.startsWith(label) && /^[：:]/.test(tail)) return [{ warning, detail: diagnosticText(tail.slice(1)) }];
    }
    return [];
  });
  // A short title can be ambiguous. Keep all matching warnings pending, but do
  // not attribute the explanation to the wrong unit or template.
  if (match.length > 1) return match.map(({ warning }) => ({ warning }));
  return match.length ? match : [{ detail: diagnosticText(text) }];
}

export function readUnresolvedDiagnostics(value, sent) {
  if (!Array.isArray(value)) throw new Error('unresolved 必须是 JSON 数组');
  return value.flatMap((item, index) => {
    if (nonempty(item)) return readTextNote(item.trim(), sent);
    const label = `unresolved 第 ${index + 1} 项`;
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !(item.unitId === null || nonempty(item.unitId)) || !(item.originPath === null || nonempty(item.originPath))
      || !(nonempty(item.effectName) || nonempty(item.message)) || !nonempty(item.reason)
      || (Object.hasOwn(item, 'effectName') && !nonempty(item.effectName))
      || (Object.hasOwn(item, 'message') && !nonempty(item.message))) {
      throw new Error(`${label}须包含单位 ID、来源路径、效果名或诊断原文，以及原因`);
    }
    const matches = sent.filter(warning => item.unitId === warning.unitId && item.originPath === (warning.originPath ?? null)
      && (item.effectName === undefined || item.effectName === subject(warning.message))
      && (item.message === undefined || item.message === warning.message));
    if (matches.length !== 1) throw new Error(`${label}必须唯一匹配本批警告`);
    return [{ warning: matches[0], detail: diagnosticText(item.reason) }];
  });
}

export function pendingDiagnostics(warnings, notes) {
  return [
    ...warnings.map(warning => {
      const details = [...new Set(notes.filter(note => note.warning === warning).map(note => note.detail).filter(Boolean))];
      const message = diagnosticText(warning.message, '原诊断包含结构化数据，未提供文字说明');
      return details.length ? `${message}（模型说明：${details.join('；')}）` : message;
    }),
    ...new Set(notes.filter(note => !note.warning && note.detail).map(note => note.detail)),
  ];
}

export const identifiesWarning = (receipt, warning) => receipt && typeof receipt === 'object'
  && receipt.unitId === warning.unitId && receipt.originPath === (warning.originPath ?? null)
  && (receipt.message !== undefined ? receipt.message === warning.message : nonempty(receipt.effectName))
  && (receipt.effectName === undefined || receipt.effectName === subject(warning.message));

// Check coverage of this request, not the number of patch operations. Never manufacture receipts.
export function missingDispositions(sent, solved, notes, narrative) {
  const accounted = new Set([...solved, ...notes.filter(note => note.detail).map(note => note.warning), ...narrative.map(entry => entry.warning)]);
  return sent.filter(warning => !accounted.has(warning));
}
export const diagnosticTitle = warning => subject(warning.message) ?? diagnosticText(warning.message);

// A verifier may attest to a previous normalization write, never to an
// unchanged baseline or a merely similar name. The exact leaf is guarded on replay.
export function existingEffectReceipts(refs = [], sent, baseline, before, current, fingerprintAt) {
  if (!Array.isArray(refs)) throw new Error('existing 必须是数组');
  return refs.map(ref => {
    const matches = sent.filter(w => identifiesWarning(ref, w));
    const origin = matches[0]?.originPath;
    if (matches.length !== 1 || !/^\/(equipment|skills|items)\/[\w-]+$/.test(origin ?? '')
      || typeof ref.path !== 'string' || !ref.path.startsWith(`${origin}/`)
      || !/^(rules|mods)\/(0|[1-9]\d*)$/.test(ref.path.slice(origin.length + 1))) {
      throw new Error('existing 需要唯一的本批诊断及其模板内具体 rules/N 或 mods/N 路径');
    }
    const live = fingerprintAt(current, ref.path), normalized = fingerprintAt(before, ref.path);
    if (live === undefined || live !== normalized || fingerprintAt(baseline, ref.path) === normalized
      || JSON.stringify(ref.value) !== live || ref.value?.enabled === false) {
      throw new Error(`已有实现未通过校验：${ref.path} 必须是先前标准化写入、当前仍有效的同一条规则或修饰`);
    }
    return { warning: matches[0], path: ref.path, fingerprint: live };
  });
}

export function resolvedDiagnostics(sent, records, patch, notes = [], { narrative = [], inferPartial = false } = {}) {
  const pending = new Set([...notes, ...narrative].map(({ warning }) => warning));
  const explicit = sent.filter(warning => {
    if (warning.unitId == null || !Object.hasOwn(records, warning.unitId) || pending.has(warning)) return false;
    return patch.some(op => {
      if (!Array.isArray(op.resolves)) return false;
      const owner = op.path.match(/^\/units\/([^/]+)/)?.[1];
      if (owner && owner !== warning.unitId) return false;
      const path = op.path.split('/').slice(0, 3).join('/');
      const origin = warning.originPath?.split('/').slice(0, 3).join('/');
      if (origin && path.split('/')[1] === origin.split('/')[1] && path !== origin) return false;
      return op.resolves.some(receipt => identifiesWarning(receipt, warning)
        && sent.filter(candidate => identifiesWarning(receipt, candidate)).length === 1);
    });
  });
  if (!inferPartial || notes.some(note => !note.warning)) return explicit;
  const solved = new Set(explicit);
  return sent.filter(warning => {
    if (warning.unitId == null || !Object.hasOwn(records, warning.unitId) || pending.has(warning)) return false;
    if (solved.has(warning)) return true;
    const path = warning.originPath;
    if (!/^\/(?:skills|equipment|items|statusTemplates)\/[^/]+$/.test(path ?? '')) return false;
    const siblings = sent.filter(candidate => candidate.unitId === warning.unitId && candidate.originPath === path);
    // Partial attribution requires an explicit pending/exempt sibling and an actual mechanic write.
    return siblings.some(candidate => pending.has(candidate)) && patch.some(op => op.op !== 'remove'
      && (op.path === `${path}/rules` || op.path.startsWith(`${path}/rules/`)
        || op.path === `${path}/mods` || op.path.startsWith(`${path}/mods/`)
        || op.path === `${path}/pools` || op.path.startsWith(`${path}/pools/`)
        || (op.path === path && op.mechanicsChanged === true)));
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
