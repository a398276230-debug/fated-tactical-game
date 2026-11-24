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
      if (text.startsWith(label) && /^[：:]/.test(tail)) return [{ warning, detail: diagnosticText(tail.slice(1), '') }];
    }
    return [];
  });
  // A short title can be ambiguous. Keep all matching warnings pending, but do
  // not attribute the explanation to the wrong unit or template.
  if (match.length > 1) return match.map(({ warning }) => ({ warning }));
  return match;
}

export function readUnresolvedDiagnostics(value = [], sent) {
  const matched = [], invalid = [];
  if (!Array.isArray(value)) return { matched, invalid: ['未能读取模型的未转换说明'] };
  for (const [index, item] of value.entries()) {
    if (nonempty(item)) {
      const notes = readTextNote(item.trim(), sent);
      if (notes.length === 1 && notes[0].warning && notes[0].detail) matched.push(notes[0]);
      else {
        // Keep matched entries as conflict locks while invalid rejects a bare label without a reason.
        matched.push(...notes.filter(note => note.warning));
        invalid.push(`第 ${index + 1} 条未转换说明缺少可唯一匹配的词条或原因`);
      }
      continue;
    }
    const label = `unresolved 第 ${index + 1} 项`;
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !(item.unitId === null || nonempty(item.unitId)) || !(item.originPath === null || nonempty(item.originPath))
      || !(nonempty(item.effectName) || nonempty(item.message)) || !nonempty(item.reason)
      || (Object.hasOwn(item, 'effectName') && !nonempty(item.effectName))
      || (Object.hasOwn(item, 'message') && !nonempty(item.message))) {
      invalid.push(`${label}缺少有效的词条引用或原因`);
      continue;
    }
    // A valid-looking text note must still resolve to exactly one warning; otherwise it cannot safely lock a patch receipt.
    const matches = sent.filter(warning => identifiesWarning(item, warning));
    if (matches.length !== 1) {
      invalid.push(`${label}无法唯一匹配本批词条`);
      continue;
    }
    const detail = diagnosticText(item.reason, '');
    if (!detail) {
      invalid.push(`${label}缺少可读原因`);
      continue;
    }
    const kind = ['missing_info', 'engine_limit'].includes(item.kind) ? item.kind : undefined;
    matched.push({ warning: matches[0], detail, ...(kind && { kind }) });
  }
  return { matched, invalid };
}

export function classifyWarnings(warnings, { notes = {}, exemptions = [], sourceFor, fingerprint = () => undefined }) {
  const groups = { autoAdjusted: [], pending: [], approximated: [], needsAttention: [], nonCombat: [] };
  for (const warning of warnings) {
    if (warning.kind === 'auto_adjusted') {
      groups.autoAdjusted.push(warning);
      continue;
    }
    const key = warningKey(warning);
    const source = sourceFor(warning.unitId, warningEntryKey(warning));
    const exempt = source && exemptions.find(entry => entry.unitId === warning.unitId && entry.key === key && entry.source === source);
    const note = notes[warning.unitId ?? '']?.[key];
    if (exempt) groups.nonCombat.push({ ...exempt, warning });
    else if (source && note?.source === source && note.reason && !note.evidence?.length) groups.needsAttention.push({ ...note, warning });
    else if (source && note?.source === source && note.reason && note.evidence?.some(([path, value]) => fingerprint(path) === value)) {
      groups.approximated.push({ ...note, warning });
    } else groups.pending.push(warning);
  }
  return groups;
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

export function resolvedDiagnostics(sent, records, patch, notes = [], { narrative = [] } = {}) {
  const pending = new Set([...notes, ...narrative].map(({ warning }) => warning));
  return sent.filter(warning => {
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

export function warningEntryKey(warning) {
  const path = warning?.originPath ?? '';
  const match = path.match(/^\/(equipment|skills|items|statusTemplates)\/([^/]+)/);
  if (match) return `${match[1]}:${match[2]}`;
  return 'unit';
}

export function changedEntryKeys(snapshot, current) {
  if (!snapshot || !current) return new Set(['unit']);
  const previous = snapshot.entryHashes ?? {};
  const next = current.entryHashes ?? {};
  return new Set([...Object.keys(previous), ...Object.keys(next)].filter(key => previous[key] !== next[key]));
}

export function normalizationCandidates(characters, snapshots, warnings) {
  const pending = new Set(warnings.filter(w => w.kind !== 'auto_adjusted').map(w => w.unitId));
  return Object.keys(characters).filter(id => pending.has(id) || pending.has(null));
}

export function remainingDiagnostics(warnings, snapshots, characters, batches = []) {
  const receipts = activeWarningReceipts(batches);
  return warnings.filter(w => {
    const snapshot = snapshots[w.unitId];
    const key = warningKey(w);
    const current = characters[w.unitId];
    const entryChanged = snapshot && !snapshot.entryHashes
      ? snapshot.hash !== current?.hash
      : changedEntryKeys(snapshot, current).has(warningEntryKey(w));
    return !receipts.get(w.unitId)?.has(key)
      && (!snapshot || entryChanged || !snapshot.resolvedWarnings?.includes(key));
  });
}
