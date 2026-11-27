import { evaluateExpr } from './formula.js';
import { nextRng } from './rng.js';
import { aoeCells, distance3D, elevation, zoneContains } from './spatial.js';
export { zoneContains } from './spatial.js';

const coordinate = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
export const pointElevation = (state, point) => coordinate(point)
  ? (Number.isFinite(point.z) ? point.z : elevation(state, point)) : undefined;
const sortedValues = table => Object.keys(table ?? {}).sort().map(key => table[key]);
const cellKey = ({x, y}) => `${x},${y}`;

const readRegister = (context, key) => Object.hasOwn(context.vars ?? {}, key) ? context.vars[key] : undefined;
const resolveRegister = (context, key) => {
  const value = readRegister(context, key);
  return context.resolveEntity ? context.resolveEntity(value) : value;
};

export function resolvePoint(value, context) {
  const point = typeof value !== 'string' ? value : value.startsWith('vars.')
    ? resolveRegister(context, value.slice(5)) : context[value];
  if (!point || typeof point !== 'object') return null;
  const inside = (x, y) => {
    if (x >= 0 && x < (context.boardW ?? Infinity) && y >= 0 && y < (context.boardH ?? Infinity)) return true;
    context.warn?.(`坐标 (${x},${y}) 越界，忽略该落点`);
    return false;
  };
  if (typeof value === 'string') return coordinate(point) && inside(point.x, point.y) ? point : null;
  const x = evaluateExpr(point.x, context), y = evaluateExpr(point.y, context);
  const z = point.z === undefined ? undefined : evaluateExpr(point.z, context);
  if (![x, y].every(Number.isFinite) || (z !== undefined && !Number.isFinite(z))) return null;
  const col = Math.round(x), row = Math.round(y);
  return inside(col, row) ? { x: col, y: row, ...(z === undefined ? {} : { z }) } : null;
}

export function selectorOwner(selector, context) {
  const of = selector.of ?? 'target';
  return of.startsWith('vars.') ? resolveRegister(context, of.slice(5)) : context[of];
}

function rows(state, selector, context) {
  if (selector.options) return [...new Set(selector.options)];
  switch (selector.from) {
    case 'units': return sortedValues(state.units);
    case 'action_targets': return (context.event?.targets ?? []).map(id => state.units[id]).filter(Boolean);
    case 'zones': return sortedValues(state.zones);
    case 'covers': return sortedValues(state.covers);
    case 'terrain': return sortedValues(state.spatialTerrain);
    case 'tape': return state.tape ?? [];
    case 'statuses': return sortedValues(selectorOwner(selector, context)?.statuses);
    case 'cells': return state.grid.flatMap((row, y) => row.map(({z, kind}, x) => ({x, y, z, kind})));
    case 'self': case 'source': case 'target': case 'attacker': return [context[selector.from]].filter(Boolean);
    default: {
      if (!selector.from.startsWith('vars.')) return [];
      const register = readRegister(context, selector.from.slice(5));
      const refs = Array.isArray(register) ? register : [register];
      return refs.map(ref => context.resolveEntity ? context.resolveEntity(ref) : ref)
        .filter(entity => entity && typeof entity === 'object');
    }
  }
}

export function selectVM(state, selector, context, { pure = false } = {}) {
  if (typeof selector === 'string') {
    if (selector.startsWith('vars.')) {
      const value = readRegister(context, selector.slice(5));
      const refs = Array.isArray(value) ? value : [value];
      return refs.map(ref => context.resolveEntity ? context.resolveEntity(ref) : ref)
        .filter(entity => entity && typeof entity === 'object');
    }
    selector = { from: selector };
  }
  if (!selector) return [];
  let candidates = rows(state, selector, context);
  if (selector.area) {
    const { origin: from = selector.area.center ?? 'self', shape, radius, innerRadius, width, angle } = selector.area;
    const origin = resolvePoint(from, context);
    if (!coordinate(origin)) return [];
    const aim = ['line', 'fan', 'cone'].includes(shape) && coordinate(context.target) ? context.target : origin;
    const attacker = context.attacker ?? context.self;
    // At the impact point, continue along the incoming ray instead of the target's facing.
    const facing = aim === context.target && aim.x === origin.x && aim.y === origin.y && coordinate(attacker)
      && (attacker.x !== aim.x || attacker.y !== aim.y) ? [aim.x - attacker.x, aim.y - attacker.y] : origin.facing;
    const resolvedRadius = typeof radius === 'string' ? evaluateExpr(radius, context) : radius;
    const resolvedInnerRadius = typeof innerRadius === 'string' ? evaluateExpr(innerRadius, context) : innerRadius;
    const resolvedWidth = typeof width === 'string' ? evaluateExpr(width, context) : width;
    const resolvedAngle = typeof angle === 'string' ? evaluateExpr(angle, context) : angle;
    const cells = new Set(selector.from === 'terrain' && shape === 'single' && coordinate(origin)
      ? [cellKey(origin)]
      : aoeCells(state, origin, aim, { shape, radius: resolvedRadius, innerRadius: resolvedInnerRadius, width: resolvedWidth, angle: resolvedAngle, facing, range: Infinity,
        ignoreLOS: selector.from === 'terrain' }).map(cellKey));
    const withinArea = candidate => {
      const points = selector.from === 'terrain' ? candidate.cells ?? []
        : selector.from === 'zones' ? state.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
          .filter(point => zoneContains(state, candidate, point, { ignoreZ: true })) : [candidate];
      return points.some(point => coordinate(point) && cells.has(cellKey(point)) && (
        !context.hostileAreaDistance || !['circle', 'ring', 'single'].includes(shape)
        || (context.hostileAreaDistance(origin, point) ?? 0) <= (shape === 'single' ? 0 : resolvedRadius ?? 1.5) + 1e-9));
    };
    candidates = candidates.filter(withinArea);
  }
  if (selector.where !== undefined) {
    candidates = candidates.filter(candidate => {
      const scope = { ...context, candidate };
      if (selector.from === 'statuses') scope.status = candidate;
      if (selector.from === 'zones') scope.zone = candidate;
      if (selector.from === 'covers') scope.cover = candidate;
      if (selector.from === 'terrain') scope.terrain = candidate;
      if (selector.from === 'tape') scope.tape = candidate;
      return evaluateExpr(selector.where, scope) === true;
    });
  }
  const { pick } = selector;
  if (!pick || pick === 'all') return candidates;
  if (pick.first !== undefined) return candidates.slice(0, pick.first);
  if (pick.nearest !== undefined && coordinate(context.self)) {
    return candidates.filter(coordinate).sort((a, b) => distance3D(state, context.self, a) - distance3D(state, context.self, b)).slice(0, pick.nearest);
  }
  if (pick.random !== undefined && !pure) {
    const remaining = [...candidates], selected = [];
    while (remaining.length && selected.length < pick.random) {
      const sample = nextRng(state.rng);
      state.rng = sample.rng;
      selected.push(...remaining.splice(Math.floor(sample.value * remaining.length), 1));
    }
    return selected;
  }
  return [];
}
