// Spatial rules use integer grid coordinates (x right, y down). These helpers
// read battle state but never modify it, including units, terrain and cover.
const EPSILON = 1e-9;
const CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const NEIGHBORS = [...CARDINAL, ...DIAGONAL];
const key = ({ x, y }) => `${x},${y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const table = collection => Object.values(collection ?? {});

export const atBattleEdge = (state, {x, y}) => x === 0 || y === 0 || y === state.grid.length - 1 || x === state.grid[y]?.length - 1;

export function cellAt(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return undefined;
  return state.grid[y]?.[x];
}
export const elevation = (state, at) => (cellAt(state, at.x, at.y)?.z ?? 0) + (at.altitude ?? 0);
export const isGround = (state, at) => {
  const cell = cellAt(state, at.x, at.y);
  return Boolean(cell && cell.kind !== 'wall');
};
export const unitAt = (state, x, y, exceptId) => table(state.units)
  .filter(unit => unit.hp > 0 && !unit.fled && unit.x === x && unit.y === y && unit.id !== exceptId).sort(byId)[0];
export const coverAt = (state, x, y) => table(state.covers)
  .filter(cover => cover.hp > 0 && cover.x === x && cover.y === y).sort(byId)[0];
export const gridDistance = (a, b) => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
export const distance3D = (state, a, b) => Math.hypot(b.x - a.x, b.y - a.y, elevation(state, b) - elevation(state, a));

// Floors allow one height level per edge, slopes allow two, walls allow none.
export function passableEdge(state, from, to) {
  if (!isGround(state, from) || !isGround(state, to)) return false;
  const slope = cellAt(state, from.x, from.y).kind === 'slope' || cellAt(state, to.x, to.y).kind === 'slope';
  return Math.abs(elevation(state, from) - elevation(state, to)) <= (slope ? 2 : 1);
}

export function canStep(state, from, to, { ignoreUnitId = from.id, diagonal = true } = {}) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const passable = at => from.altitude > 0 ? isGround(state, at) : passableEdge(state, from, at);
  if (gridDistance(from, to) !== 1 || !passable(to)) return false;
  const vacant = at => !unitAt(state, at.x, at.y, ignoreUnitId) && !coverAt(state, at.x, at.y);
  if (!vacant(to)) return false;
  if (!dx || !dy) return true;
  // A diagonal must not cut a corner made by a wall, cover, unit or cliff.
  return diagonal && [{ x: from.x, y: to.y }, { x: to.x, y: from.y }].every(at =>
    vacant(at) && passable(at) && passableEdge(state, at, to));
}

function search(state, unit, limit, options, target) {
  if (!isGround(state, unit) || !(limit >= 0)) return [];
  const start = { x: unit.x, y: unit.y, altitude:unit.altitude, z: elevation(state, unit), cost: 0, previous: null };
  const visited = new Set([key(start)]), queue = [start];
  const stepOptions = { ignoreUnitId: unit.id, ...options };
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    if (target && same(from, target)) return [from];
    if (from.cost + 1 > limit) continue;
    for (const [dx, dy] of stepOptions.diagonal === false ? CARDINAL : NEIGHBORS) {
      const to = { x: from.x + dx, y: from.y + dy, altitude:unit.altitude };
      const id = key(to);
      if (visited.has(id) || !canStep(state, from, to, stepOptions) ||
        (options?.allowsStep && !options.allowsStep(from, to))) continue;
      visited.add(id);
      queue.push({ ...to, z: elevation(state, to), cost: from.cost + 1, previous: from });
    }
  }
  return target ? [] : queue.slice(1);
}

const coords = ({ x, y, z }) => ({ x, y, z });
function unwind(last) {
  const path = [];
  for (let step = last; step.previous; step = step.previous) path.push(coords(step));
  return path.reverse();
}

/** Reachable destinations excluding the origin, in deterministic BFS order. */
export function reachableCells(state, unit, maxSteps = Infinity, options) {
  return search(state, unit, maxSteps, options).map(cell => ({ ...coords(cell), cost: cell.cost }));
}

/** Reachable destinations and their shortest paths (one BFS for all cells).
 * Optional allowsStep(from, to) can omit otherwise legal edges.
 */
export function movementOptions(state, unit, maxSteps = Infinity, options) {
  return search(state, unit, maxSteps, options).map(cell => ({ ...coords(cell), cost: cell.cost, path: unwind(cell) }));
}

/** The shortest path excludes the origin. Unreachable destinations return null. */
export function findPath(state, unit, target, maxSteps = Infinity, options) {
  const [last] = search(state, unit, maxSteps, options, target);
  return last ? unwind(last) : null;
}

/** All cells touched by the segment between tile centers, endpoints included.
 * At exact corner ties visit both side cells before entering the diagonal.
 */
export function supercoverLine(from, to) {
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) return [];
  let { x, y } = from;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  const sx = Math.sign(to.x - x), sy = Math.sign(to.y - y);
  const cells = [{ x, y }];
  for (let ix = 0, iy = 0; ix < dx || iy < dy;) {
    // Compare crossing times as integer products to avoid floating-point ties.
    const nextX = (2 * ix + 1) * dy, nextY = (2 * iy + 1) * dx;
    if (nextX === nextY) {
      cells.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx; y += sy; ix++; iy++;
    } else if (nextX < nextY) {
      x += sx; ix++;
    } else {
      y += sy; iy++;
    }
    cells.push({ x, y });
  }
  return cells;
}

/** Walls are opaque regardless of elevation; cover is handled separately. */
export function hasLOS(state, from, to) {
  if (!isGround(state, from) || !isGround(state, to)) return false;
  return supercoverLine(from, to).every(at => isGround(state, at));
}

/** Row-major masks. Circles spread from impact; directed shapes spread from
 * origin, which is excluded. Angle is full aperture in degrees, line width
 * is the lateral half-width in cells. Range can also be a per-cell function.
 */
export function aoeCells(state, origin, target, options = {}) {
  const { shape = 'single', radius = 1.5, width = .6, angle = shape === 'fan' ? 100 : 60,
    range = distance3D(state, origin, target) } = options;
  const limitAt = typeof range === 'function' ? range : () => range;
  const inRange = at => distance3D(state, origin, at) <= limitAt(at) + EPSILON;
  if (!hasLOS(state, origin, target) || !inRange(target)) return [];
  if (shape === 'single') return [{ x: target.x, y: target.y, z: elevation(state, target) }];
  const dx = target.x - origin.x, dy = target.y - origin.y, aimLength = Math.hypot(dx, dy);
  if (shape !== 'circle' && (!aimLength || !['line', 'fan', 'cone'].includes(shape))) return [];
  const minCosine = Math.cos(Math.max(0, Math.min(360, angle)) * Math.PI / 360);
  const result = [];
  state.grid.forEach((row, y) => row.forEach((cell, x) => {
    const at = { x, y, z: cell.z };
    if (shape === 'circle') {
      if (distance3D(state, target, at) <= radius + EPSILON && hasLOS(state, target, at)) result.push(at);
      return;
    }
    if (same(origin, at) || !inRange(at)) return;
    const vx = x - origin.x, vy = y - origin.y;
    const forward = (vx * dx + vy * dy) / aimLength;
    const inside = shape === 'line'
      ? forward > 0 && Math.abs(vx * dy - vy * dx) / aimLength <= width + EPSILON
      : forward / Math.hypot(vx, vy) >= minCosine - EPSILON;
    if (inside && hasLOS(state, origin, at)) result.push(at);
  }));
  return result;
}

/** Intact cover can shield a clear ray or stand near the defender on the
 * incoming side. A shooter >=2 elevations above the cover sees over it.
 */
export function coverBetween(state, from, to) {
  if (same(from, to) || !hasLOS(state, from, to)) return null;
  const ray = new Set(supercoverLine(from, to).slice(1, -1).map(key));
  const targetZ = elevation(state, to), sourceZ = elevation(state, from);
  const dx = from.x - to.x, dy = from.y - to.y, squaredLength = dx * dx + dy * dy;
  const covers = table(state.covers).filter(cover => {
    if (cover.hp <= 0 || !(cover.cover > 0) || same(cover, from) || same(cover, to) || !isGround(state, cover)) return false;
    const cx = cover.x - to.x, cy = cover.y - to.y;
    const fraction = (cx * dx + cy * dy) / squaredLength;
    if (fraction <= 0 || fraction >= 1) return false;
    const z = elevation(state, cover);
    if (sourceZ - z >= 2 || targetZ - z >= 2 || targetZ + (sourceZ - targetZ) * fraction - z >= 2) return false;
    const adjacentIncoming = gridDistance(cover, to) === 1 &&
      (!cx || Math.sign(cx) === Math.sign(dx)) && (!cy || Math.sign(cy) === Math.sign(dy));
    return ray.has(key(cover)) || (adjacentIncoming && hasLOS(state, cover, to));
  });
  return covers.sort((a, b) => b.cover - a.cover || distance3D(state, a, to) - distance3D(state, b, to) || byId(a, b))[0] ?? null;
}

/** Unit-facing vectors use the same orientation as grid coordinates. */
export function facingToward(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return [dx === 0 ? 0 : Math.sign(dx), dy === 0 ? 0 : Math.sign(dy)];
}

export function facingArc(defender, attacker) {
  const [fx, fy] = defender.facing ?? [1, 0];
  const dx = attacker.x - defender.x, dy = attacker.y - defender.y;
  const length = Math.hypot(dx, dy) * Math.hypot(fx, fy);
  if (!length) return 'front';
  const cosine = (dx * fx + dy * fy) / length;
  return cosine < -.5 ? 'back' : cosine < .5 ? 'side' : 'front';
}

export function flankPosition(attacker, defender) {
  const arc = facingArc(defender, attacker);
  return arc === 'back' ? 'rear' : arc;
}

/** A living ally on an opposing side of an adjacent, visible defender. */
export function isFlanked(state, attacker, defender) {
  const adjacent = unit => !same(unit, defender) && gridDistance(unit, defender) === 1 &&
    Math.abs(elevation(state, unit) - elevation(state, defender)) <= 1 && hasLOS(state, unit, defender);
  if (!adjacent(attacker)) return false;
  const dx = attacker.x - defender.x, dy = attacker.y - defender.y;
  return table(state.units).some(ally => ally.hp > 0 && !ally.fled && ally.id !== attacker.id && ally.team === attacker.team &&
    adjacent(ally) && dx * (ally.x - defender.x) + dy * (ally.y - defender.y) < 0);
}
