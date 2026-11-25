export const own = (value, key) => value != null && Object.hasOwn(value, key);
export const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
export const safeProperty = key => !['__proto__', 'prototype', 'constructor'].includes(key);

export function deepClone(value) {
  try { return structuredClone(value); } catch {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }
}

export function deepMerge(base, extra) {
  const result = isObject(base) ? deepClone(base) : {};
  if (!isObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (!safeProperty(key)) continue;
    result[key] = isObject(value) && isObject(result[key]) ? deepMerge(result[key], value) : deepClone(value);
  }
  return result;
}

export function normalizePath(path) {
  return typeof path === 'string' && path.startsWith('/')
    ? path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~')) : [];
}

const arrayIndex = key => /^(0|[1-9]\d*)$/.test(key);

// Tolerant replay can create missing intermediate tables. Battle patch validation
// uses strict mode so an operation cannot silently repair an invalid path.
export function applyJsonPatch(document, patch, { strict = false } = {}) {
  const result = deepClone(document);
  for (const operation of patch) {
    const { op, path, value } = operation ?? {};
    if (!['add', 'replace', 'remove'].includes(op)) continue;
    const keys = normalizePath(path);
    if (!keys.length || !keys.every(safeProperty)) throw new Error('AI 返回了不支持的补丁路径');
    const last = keys.pop();
    let parent = result;
    for (const key of keys) {
      if (!parent || typeof parent !== 'object') throw new Error(`补丁路径不可写：${path}`);
      if (Array.isArray(parent) && (!arrayIndex(key) || Number(key) >= parent.length)) throw new Error(`数组索引无效：${path}`);
      if (!own(parent, key) || (!strict && (!parent[key] || typeof parent[key] !== 'object'))) {
        if (strict) throw new Error(`补丁路径不存在：${path}`);
        if (op === 'remove') { parent = null; break; }
        parent[key] = {};
      }
      parent = parent[key];
    }
    if (!strict && parent === null && op === 'remove') continue;
    if (!parent || typeof parent !== 'object') throw new Error(`补丁路径不可写：${path}`);
    if (Array.isArray(parent)) {
      if (last === '-' && op === 'add') { parent.push(deepClone(value)); continue; }
      if (!arrayIndex(last) || Number(last) > parent.length) throw new Error(`数组索引无效：${path}`);
      if (op === 'add') { parent.splice(Number(last), 0, deepClone(value)); continue; }
    }
    if (strict && op !== 'add' && !own(parent, last)) throw new Error(`补丁路径不存在：${path}`);
    if (op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else parent[last] = deepClone(value);
  }
  return result;
}
