// Battle instances retain their own IDs and mutable state. Only maintenance and
// standardization operate on a representative of each converted archetype.
export function instanceGroups(instances) {
  const groups = new Map();
  for (const [id, unit] of Object.entries(instances)) {
    const key = unit.archetypeId ?? id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  return [...groups.values()];
}

export function duplicateMappings(roster, state) {
  const groups = instanceGroups(Object.fromEntries(roster.map(unit => [unit.id, unit])));
  const paths = new Map();
  for (const [first, ...copies] of groups) {
    const representative = roster.find(unit => unit.id === first);
    for (const id of copies) {
      const copy = roster.find(unit => unit.id === id);
      const ids = new Map();
      const pairs = [['units', first, id]];
      representative.skills.forEach((skill, i) => pairs.push(['skills', skill, copy.skills[i]]));
      representative.equipment.forEach((item, i) => {
        const other = copy.equipment[i];
        pairs.push(['items', item.id, other.id], ['equipment', state.items[item.id].templateId, state.items[other.id].templateId]);
      });
      for (const [, from, to] of pairs) if (from && to && from !== to) ids.set(from, to);
      for (const [table, from, to] of pairs) {
        if (!ids.has(from)) continue;
        const path = `/${table}/${from}`;
        if (!paths.has(path)) paths.set(path, []);
        paths.get(path).push({ path: `/${table}/${to}`, ids, unitId: id });
      }
    }
  }
  return paths;
}

function replaceReferences(value, ids) {
  if (typeof value === 'string') return ids.get(value) ?? value.replace(/(['"])([^'"\n]+)\1/g, (match, quote, id) => ids.has(id) ? `${quote}${ids.get(id)}${quote}` : match);
  if (Array.isArray(value)) return value.map(entry => replaceReferences(entry, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [ids.get(key) ?? key, replaceReferences(entry, ids)]));
  return value;
}

export function duplicateOperations(operation, mappings) {
  const root = [...mappings.keys()].filter(key => operation.path === key || operation.path.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) return [];
  return (mappings.get(root) ?? []).map(({ path, ids }) => ({
    op: operation.op,
    path: path + operation.path.slice(root.length),
    ...(Object.hasOwn(operation, 'value') && { value: replaceReferences(operation.value, ids) }),
  }));
}
