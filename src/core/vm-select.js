import { evaluateExpr } from './formula.js';
import { nextRng } from './rng.js';
import { aoeCells, distance3D } from './spatial.js';

const coordinate = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
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
  return coordinate(point) ? point : null;
}

export function zoneContains(state, zone, at) {
  if (!coordinate(at)) return false;
  const { shape, anchorUnitId, center, radius, innerRadius, rect, cells } = zone.area;
  const anchor = anchorUnitId && Object.hasOwn(state.units, anchorUnitId) ? state.units[anchorUnitId] : null;
  if (zone.follow && anchorUnitId && (!anchor || anchor.hp <= 0 || anchor.fled)) return false;
  const origin = zone.follow ? anchor ?? center : center ?? anchor;
  if (shape === 'board') return state.grid[at.y]?.[at.x] != null;
  if (shape === 'cells') return cells?.some(cell => cell.x === at.x && cell.y === at.y) ?? false;
  if (shape === 'rect') return Boolean(rect && at.x >= Math.min(rect.x1, rect.x2) && at.x <= Math.max(rect.x1, rect.x2)
    && at.y >= Math.min(rect.y1, rect.y2) && at.y <= Math.max(rect.y1, rect.y2));
  if (!coordinate(origin)) return false;
  if (shape === 'single') return origin.x === at.x && origin.y === at.y;
  const distance = distance3D(state, origin, at);
  return distance <= radius && (shape === 'circle' || (shape === 'ring' && distance >= (innerRadius ?? 0)));
}

function rows(state, selector, context) {
  switch (selector.from) {
    case 'units': return sortedValues(state.units);
    case 'zones': return sortedValues(state.zones);
    case 'covers': return sortedValues(state.covers);
    case 'terrain': return sortedValues(state.spatialTerrain);
    case 'tape': return state.tape ?? [];
    case 'statuses': return sortedValues(context[selector.of ?? 'target']?.statuses);
    case 'cells': return state.grid.flatMap((row, y) => row.map(({z}, x) => ({x, y, z})));
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
    const { origin: from = 'self', shape, radius, innerRadius, width, angle } = selector.area;
    const origin = resolvePoint(from, context);
    if (!coordinate(origin)) return [];
    const aim = ['line', 'fan', 'cone'].includes(shape) && coordinate(context.target) ? context.target : origin;
    const cells = new Set(selector.from === 'terrain' && shape === 'single' && coordinate(origin)
      ? [cellKey(origin)]
      : aoeCells(state, origin, aim, { shape, radius, innerRadius, width, angle, range: Infinity,
        ignoreLOS: selector.from === 'terrain' }).map(cellKey));
    const withinArea = candidate => {
      const points = selector.from === 'terrain' ? candidate.cells ?? []
        : selector.from === 'zones' ? state.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
          .filter(point => zoneContains(state, candidate, point)) : [candidate];
      return points.some(point => coordinate(point) && cells.has(cellKey(point)));
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
