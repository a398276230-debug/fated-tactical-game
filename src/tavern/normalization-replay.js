import { warningEntryKey, warningKey } from './resolved-warnings.js';

export const entryRoot = path => path.split('/').slice(0, path.startsWith('/units/') ? 4 : 3).join('/');
const tableKey = path => path.split('/').slice(1, 3).join(':');
const under = (path, root) => path === root || path.startsWith(`${root}/`);

// Separate unrelated writes even when the model returned them in one request.
// Keep new definitions and their consumers together, including multi-hop dependencies.
export function normalizationTransactions({ patch, solved, verified, records, before, fingerprint, linkedRoots = [] }) {
  const groups = new Map();
  const group = path => {
    if (!groups.has(path)) groups.set(path, { roots: new Set([path]), guards: new Set(), warnings: [] });
    return groups.get(path);
  };
  for (const op of patch) {
    const root = entryRoot(op.path);
    // Guard the changed field independently of placement-derived fields (e.g. hand).
    const guard = op.path.split('/').slice(0, root.split('/').length + 1).join('/');
    group(root).guards.add(guard);
  }
  const rootForWarning = warning => {
    const path = warning.originPath;
    return path && [...groups.keys()].find(root => under(root, path) || under(path, root));
  };
  for (const warning of solved) {
    const evidence = verified.find(item => item.warning === warning);
    const root = evidence ? entryRoot(evidence.path) : rootForWarning(warning);
    if (!root) continue;
    const target = group(root);
    if (evidence) target.guards.add(evidence.path);
    target.warnings.push(warning);
  }
  const join = (left, right) => {
    const a = groups.get(left), b = groups.get(right);
    if (a === b) return;
    for (const root of b.roots) { a.roots.add(root); groups.set(root, a); }
    for (const guard of b.guards) a.guards.add(guard);
    a.warnings.push(...b.warnings);
  };
  for (const paths of linkedRoots) {
    const roots = [...new Set(paths.map(entryRoot))].filter(root => groups.has(root));
    for (const root of roots.slice(1)) join(roots[0], root);
  }
  const definitions = new Map();
  for (const root of groups.keys()) {
    if (/^\/(skills|statusTemplates|equipment|items|summonTemplates|zones|customElements)\//.test(root)) {
      const id = root.split('/')[2];
      definitions.set(id, [...(definitions.get(id) ?? []), root]);
    }
  }
  const visit = (value, root) => {
    if (typeof value === 'string') {
      for (const dependency of definitions.get(value) ?? []) join(root, dependency);
      for (const [, , id] of value.matchAll(/\bin_zone\s*\([^,]+,\s*(['"])([\w-]+)\1\s*\)/g)) {
        const zone = `/zones/${id}`;
        if (groups.has(zone)) join(root, zone);
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { visit(key, root); visit(child, root); }
    }
  };
  for (const op of patch) visit(op.value, entryRoot(op.path));
  return [...new Set(groups.values())].map(({ roots, guards, warnings }) => {
    const refs = new Map();
    const addRef = (id, key) => {
      const hash = records[id]?.entryHashes?.[key];
      if (hash) refs.set(JSON.stringify([id, key]), [id, key, hash]);
    };
    for (const root of roots) {
      if (root.startsWith('/units/')) addRef(root.split('/')[2], 'unit');
      else for (const id of Object.keys(records)) addRef(id, tableKey(root));
    }
    for (const warning of warnings) addRef(warning.unitId, warningEntryKey(warning));
    const sceneBound = [...roots].some(root => root.startsWith('/zones/'));
    return {
      ...(sceneBound && { sceneBound }),
      patch: patch.filter(op => roots.has(entryRoot(op.path))), entries: [...refs.values()],
      receipts: warnings.map(w => ({ unitId: w.unitId, key: warningKey(w) })),
      guards: [...guards].map(path => [path, fingerprint(before, path) ?? null]),
    };
  });
}

export function replayNormalization(state, batches, records, warnings, { apply, validate, fingerprint }) {
  const kept = [];
  const diagnosticKeys = new Set(warnings.map(w => JSON.stringify([w.unitId, warningKey(w)])));
  for (const batch of batches) {
    const sameDiagnostics = batch.receipts?.length && batch.receipts.every(({ unitId, key }) => diagnosticKeys.has(JSON.stringify([unitId, key])));
    if (batch.entries) {
      if (!batch.entries.every(([id, entry, hash]) => records[id]?.entryHashes?.[entry] === hash)) continue;
      if (batch.receipts?.length && !sameDiagnostics) continue;
    } else {
      const owners = Object.entries(batch.hashes ?? {});
      if (!sameDiagnostics && (!owners.length || !owners.every(([id, hash]) => records[id]?.hash === hash))) continue;
    }
    const alreadyRegistered = new Set((batch.patch ?? []).filter(op => op.op === 'add' &&
      /^\/customElements\/[^/]+$/.test(op.path) && fingerprint(state, op.path) === JSON.stringify(op.value)).map(op => op.path));
    if (batch.guards?.some(([path, value]) => (fingerprint(state, path) ?? null) !== value && !alreadyRegistered.has(path))) continue;
    try {
      const next = apply(state, batch.patch, true);
      validate(next);
      state = next;
      kept.push(batch);
    } catch (_) { /* An earlier dependency was not replayed or the source target disappeared. */ }
  }
  return { state, kept };
}
