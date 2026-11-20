import { cellAt, coverAt, elevation, unitAt } from './spatial.js';

const unitsAt = (state, x, y) => Object.values(state.units).filter(u => u.x === x && u.y === y);
const present = unit => unit && unit.hp > 0 && !unit.fled;
const same = (a, b) => a.x === b.x && a.y === b.y;
const occupiedByUnit = (state, point) => unitsAt(state, point.x, point.y).some(unit => unit.hp > 0);
const blocked = (state, point) => occupiedByUnit(state, point)
  || [...Object.values(state.covers), ...Object.values(state.interactives)].some(other => same(other, point));
const maxPatches = 64;

function cellsIn(state, area, center) {
  const { rect } = area;
  const points = area.cells ?? state.grid.flatMap((row, y) => row.flatMap((_, x) => {
    const inside = rect ? x >= Math.min(rect.x1, rect.x2) && x <= Math.max(rect.x1, rect.x2)
      && y >= Math.min(rect.y1, rect.y2) && y <= Math.max(rect.y1, rect.y2)
      : center && Math.hypot(x - center.x, y - center.y) <= area.radius;
    return inside ? [{ x, y }] : [];
  }));
  return [...new Map(points.filter(p => cellAt(state, p.x, p.y)).map(p => [`${p.x},${p.y}`, p])).values()];
}

function changeCell(cell, node) {
  if (node.kind === 'setTerrainKind') return { ...cell, kind: node.terrainKind };
  const z = node.terrain === 'set' ? node.amount : cell.z + (node.terrain === 'raise' ? node.amount : -node.amount);
  return { ...cell, z: Math.min(8, Math.max(-4, z)) };
}

const effectiveHeight = cell => cell.kind === 'slope' ? 1 : cell.z;

function writeCell(state, { x, y }, after, changes, restored = false) {
  const before = state.grid[y][x];
  state.grid[y][x] = after;
  changes.push({ x, y, before, after, restored, units: unitsAt(state, x, y) });
}

function settleChanges(state, changes, record, damage) {
  // Finish grid/patch mutations before damage can dispatch death effects or remove anchors.
  for (const change of changes) {
    const { x, y } = change;
    const cell = state.grid[y][x];
    if (cell.kind !== 'wall') continue;
    for (const table of [state.covers, state.interactives]) {
      for (const [id, item] of Object.entries(table)) if (same(item, change)) delete table[id];
    }
    for (const unit of unitsAt(state, x, y).filter(unit => unit.hp > 0)) {
      const free = state.grid.flatMap((row, y) => row.flatMap((tile, x) =>
        tile.kind !== 'wall' && !unitAt(state, x, y) && !coverAt(state, x, y) ? [{ x, y }] : []));
      const distance = p => (p.x - x) ** 2 + (p.y - y) ** 2;
      const landing = free.sort((a, b) => distance(a) - distance(b))[0];
      if (landing) {
        const from = {x:unit.x,y:unit.y,z:change.before.z + (unit.altitude ?? 0)};
        Object.assign(unit, landing);
        const to = {...landing,z:elevation(state,unit)};
        record(state, unit, 'terrain_displace', `${unit.name}因墙体还原移至 (${to.x}, ${to.y}, z=${to.z})`, { x:to.x, y:to.y, from, to });
      } else damage(state, unit, unit.hp, '墙体还原，无可站立格', { forcedDisplacement: true });
    }
  }
  for (const { before, after, restored, units } of changes) {
    const drop = effectiveHeight(before) - effectiveHeight(after);
    for (const unit of units.filter(present)) {
      if (drop > 0 && !unit.altitude) damage(state, unit, drop * 50, `地形${restored ? '还原' : '变化'}高度落差 ${drop}，`, { drop });
    }
  }
}

export function applyTerrainEffect(state, actor, node, context, record, damage) {
  const area = node.area;
  const center = area.center === 'self' ? actor : area.center === 'hitTarget' ? context.terrainTarget ?? context.target ?? context.center : area.center;
  const name = node.label ?? node.kind;
  const unresolved = reason => {
    record(state, actor, 'terrain_unresolved', `地形效果未生效：${reason}`, { unresolved: true, name });
    return false;
  };
  if (area.follow && !present(center)) return unresolved('区域没有存活的锚点单位');
  if (Object.keys(state.terrainPatches ?? {}).length >= maxPatches) return unresolved('地形效果数量达到上限');
  let n = 1;
  while (Object.hasOwn(state.terrainPatches ?? {}, `terrain-${n}`)
    || Object.keys(state.covers).some(id => id.startsWith(`terrain-${n}-`))) n++;
  const entry = {
    id: `terrain-${n}`, name, node, ...(area.follow ? { anchorUnitId: center.id, center: { x: center.x, y: center.y } } : {}),
    remainingTurns: node.remainingTurns ?? 1, persistent: node.persistent === true, patch: [], covers: [],
  };
  const points = cellsIn(state, area, center);
  const changes = [];
  const count = place(state, entry, points, record, actor, changes);
  if (!count) {
    const occupied = points.length && points.every(p => occupiedByUnit(state, p));
    return unresolved(occupied ? '目标区域全部被单位占用' : '目标区域没有可用格子');
  }
  (state.terrainPatches ??= {})[entry.id] = entry;
  record(state, actor, 'terrain', `${name}影响了 ${count} 格`, { terrainId: entry.id, count });
  settleChanges(state, changes, record, damage);
  return true;
}

function place(state, entry, points, record, actor, changes) {
  const { node } = entry;
  let occupied = 0;
  for (const { x, y } of points) {
    const cell = cellAt(state, x, y);
    const point = { x, y };
    if (node.terrainKind === 'wall' || node.kind === 'addCover') {
      if (occupiedByUnit(state, point)) occupied++;
      if (blocked(state, point) || node.kind === 'addCover' && (cell.kind === 'wall' || Object.keys(state.covers).length >= 200)) continue;
    }
    if (node.kind === 'addCover') {
      const id = `${entry.id}-${x}-${y}`;
      state.covers[id] = { id, name: entry.name, x, y, material: '地形效果', hp: node.hp, maxHp: node.hp, cover: 2 };
      entry.covers.push({ id, x, y, before: null });
    } else {
      const after = changeCell(cell, node);
      entry.patch.push({ x, y, before: { ...cell }, after });
      writeCell(state, point, after, changes);
    }
  }
  if (occupied) record(state, actor, 'terrain_skip', `${occupied} 格因单位占用被跳过`, { count: occupied });
  return entry.patch.length + entry.covers.length;
}

function remove(state, entry, entries, changes) {
  for (const { id } of entry.covers) delete state.covers[id];
  for (const patch of entry.patch) {
    let cell = patch.before;
    const replay = [];
    // Replay only layers above the removed one, even if the older layer expires first.
    for (const other of entries.slice(entries.indexOf(entry) + 1)) {
      const layer = other.patch.find(p => same(p, patch));
      if (!layer) continue;
      const after = changeCell(cell, other.node);
      replay.push({ layer, before: cell, after });
      cell = after;
    }
    for (const { layer, before, after } of replay) Object.assign(layer, { before, after });
    writeCell(state, patch, cell, changes, true);
  }
  entry.patch = [];
  entry.covers = [];
}

export function updateTerrainPatches(state, record, damage, advance = false) {
  const entries = Object.values(state.terrainPatches ?? {});
  const moved = [], changes = [], movingChanges = [];
  for (const entry of entries.slice().reverse()) {
    const anchor = state.units[entry.anchorUnitId];
    const lost = entry.anchorUnitId && !present(anchor);
    if (advance && !entry.persistent && entry.remainingTurns > 0) entry.remainingTurns--;
    if (lost || !entry.persistent && entry.remainingTurns === 0) {
      entry.remainingTurns = 0;
      entry.persistent = false;
      remove(state, entry, entries, changes);
      delete state.terrainPatches[entry.id];
      record(state, anchor, 'terrain_expire', `${entry.name}${lost ? '因锚点离场而消散' : '到期还原'}`, { terrainId: entry.id });
    } else if (advance && anchor && !same(anchor, entry.center)) {
      remove(state, entry, entries, movingChanges);
      entry.center = { x: anchor.x, y: anchor.y };
      moved.unshift(entry);
    }
  }
  for (const entry of moved) {
    // Reapplication at the new position is a new layer in application order.
    delete state.terrainPatches[entry.id];
    state.terrainPatches[entry.id] = entry;
    place(state, entry, cellsIn(state, entry.node.area, entry.center), record, state.units[entry.anchorUnitId], movingChanges);
  }
  // A following area can cover the same cell before and after moving; don't
  // count the intermediate remove/reapply as a fall.
  const movedCells = new Map();
  for (const change of movingChanges) {
    const key = `${change.x},${change.y}`;
    const first = movedCells.get(key);
    if (first) first.after = change.after;
    else movedCells.set(key, change);
  }
  settleChanges(state, [...changes, ...movedCells.values()], record, damage);
}
