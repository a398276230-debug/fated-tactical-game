import { evaluateExpr } from './formula.js';
import { nextRng } from './rng.js';
import { aoeCells, distance3D } from './spatial.js';

const coordinate = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
const sortedValues = table => Object.keys(table ?? {}).sort().map(key => table[key]);
const cellKey = ({x, y}) => `${x},${y}`;

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
  const distance = distance3D(state, origin, at);
  return distance <= radius && (shape === 'circle' || (shape === 'ring' && distance >= (innerRadius ?? 0)));
}

function rows(state, selector, context) {
  switch (selector.from) {
    case 'units': return sortedValues(state.units);
    case 'zones': return sortedValues(state.zones);
    case 'tape': return state.tape ?? [];
    case 'statuses': return sortedValues(context[selector.of ?? 'target']?.statuses);
    case 'cells': return state.grid.flatMap((row, y) => row.map(({z}, x) => ({x, y, z})));
    case 'self': case 'source': case 'target': case 'attacker': return [context[selector.from]].filter(Boolean);
    default: return [];
  }
}

export function selectVM(state, selector, context, { pure = false } = {}) {
  if (typeof selector === 'string') selector = { from: selector };
  if (!selector) return [];
  let candidates = rows(state, selector, context);
  if (selector.area) {
    const { origin: from = 'self', shape, radius, innerRadius, width, angle } = selector.area;
    const origin = typeof from === 'string' ? context[from] : from;
    if (!coordinate(origin)) return [];
    const aim = ['line', 'fan', 'cone'].includes(shape) && coordinate(context.target) ? context.target : origin;
    const cells = new Set(aoeCells(state, origin, aim, { shape, radius, innerRadius, width, angle, range: Infinity }).map(cellKey));
    candidates = candidates.filter(candidate => coordinate(candidate) && cells.has(cellKey(candidate)));
  }
  if (selector.where !== undefined) {
    candidates = candidates.filter(candidate => {
      const scope = { ...context, candidate };
      if (selector.from === 'statuses') scope.status = candidate;
      if (selector.from === 'zones') scope.zone = candidate;
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
