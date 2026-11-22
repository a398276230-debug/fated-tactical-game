const own = (object, key) => object != null && Object.hasOwn(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}

export function chatUndoChanges(before, after) {
  const changes = [];
  function visit(a, b, path) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = `${path}/${pointer(key)}`;
      const had = own(a, key), has = own(b, key);
      if (had && has && record(a[key]) && record(b[key])) visit(a[key], b[key], next);
      else if (had !== has || !equal(a[key], b[key])) {
        changes.push({ path: next, has, ...(has ? { expected: b[key] } : {}), inverse: had
          ? { op: has ? 'replace' : 'add', path: next, value: a[key] }
          : { op: 'remove', path: next } });
      }
    }
  }
  visit(before, after, '');
  return changes;
}

export function chatInversePatch(state, changes) {
  return changes.map(({ path, has, expected, inverse }) => {
    const keys = path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = keys.pop();
    let parent = state;
    for (const part of keys) parent = own(parent, part) ? parent[part] : undefined;
    if (!record(parent) || own(parent, key) !== has || (has && !equal(parent[key], expected))) {
      throw new Error(`字段已被后续操作修改：${path}`);
    }
    return inverse;
  });
}
