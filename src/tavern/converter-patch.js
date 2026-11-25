import { EQUIPMENT, SKILLS } from '../presets/catalog.js';
import { id as validId, validateState } from '../api/validation.js';
import { DISTANCE_TABLE, sizeClassFor, stanceFor, moraleTypeFor, TIER_CELL_M, QUALITY_TIER, resolveEffectiveTier, scaledCells } from '../core/combat_protocol.js';
import { validVmRule, validVmStatMod } from '../core/vm-schema.js';
import { validExpr } from '../core/formula.js';
import { initializeVMWorld } from '../core/vm-runtime.js';
import { beginBattle, STATUSES } from '../core/combat.js';
import { canOccupy } from '../core/spatial.js';
import { parseBattleDescriptor } from './descriptor.js';
import { createBattleGrid } from './terrain.js';
import { parseBattleTime } from '../core/battle_time.js';
import { parseAreaTags, tagEntries } from './area-tags.js';
import { clone } from './converter-parse.js';
import { getPool } from '../core/vm-pools.js';

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
function pointer(path) { return '/' + path.map(x => String(x).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'); }
const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const numberValue = value => Number.isFinite(Number(value)) ? Number(value) : null;
const sameValue = (left, right) => left === right || (numberValue(left) != null && numberValue(right) != null && numberValue(left) === numberValue(right));
const sourcePath = (root, mapping, suffix) => Array.isArray(mapping.path) && mapping.path.length
  ? [root, ...mapping.path, ...suffix] : null;

function initialResource(mapping, key, unit) {
  const values = mapping.initialResources ?? mapping.resourceInitials ?? mapping.initial ?? {};
  const value = values[key] ?? mapping[`initial${key[0].toUpperCase()}${key.slice(1)}`];
  return value == null ? null : numberValue(value);
}
function finalResource(unit, key) {
  const value = numberValue(unit?.[key]);
  return value == null ? null : Math.max(0, Math.round(value));
}
function asBindings(value) {
  if (Array.isArray(value)) return value.map((binding, index) => [String(index), binding]).filter(([, binding]) => binding && typeof binding === 'object');
  return Object.entries(value ?? {}).filter(([, binding]) => binding && typeof binding === 'object');
}
function poolCurrent(state, unit, binding) {
  const target = binding.resolvedTarget ?? binding.target ?? {};
  if (target.kind === 'item_pool' || binding.ownerKind === 'item') {
    const itemId = binding.itemId ?? target.itemId;
    const poolKey = target.poolKey ?? binding.poolKey ?? binding.key;
    const current = getPool(state, itemId, poolKey, 'item')?.current;
    if (current == null || binding.sliceCap == null) return current;
    return Math.max(0, Math.min(binding.sliceCap, current - binding.sliceBase));
  }
  if (target.kind === 'unit_pool' || binding.ownerKind === 'unit') {
    const poolKey = target.poolKey ?? binding.poolKey ?? binding.key;
    return getPool(state, unit.id, poolKey, 'unit')?.current;
  }
  if (target.kind === 'persistent_status' || binding.statusId) {
    const statusId = target.statusId ?? binding.statusId;
    return unit.statuses?.[statusId]?.stacks ?? 0;
  }
  return null;
}
function formatCounter(binding, current) {
  const value = Math.max(0, Math.round(Number(current)));
  const format = binding.format ?? {};
  if (format.kind === 'field_number' || format.kind === 'number') return value;
  const label = binding.rawLabel ?? format.label ?? '';
  const sep = format.sep ?? ': ';
  const cap = numberValue(binding.max ?? format.capInTag);
  const slash = format.slash ?? '/';
  const counter = `${format.prefix ?? ''}${label}${sep}${value}`;
  // A single-value ammo tag gains an explicit denominator only after it is used.
  const includeCap = format.kind === 'tag_slash' || /弹药|箭矢|残弹|装填/u.test(label) && cap != null && value < cap;
  return `${counter}${includeCap ? `${slash}${cap ?? ''}` : ''}${format.suffix ?? ''}`;
}
function counterInitial(binding) {
  if (binding.current != null) return binding.current;
  if (binding.initialRawValue == null) return null;
  if (typeof binding.initialRawValue === 'number') return binding.initialRawValue;
  const match = String(binding.initialRawValue).match(/(-?\d+)(?:\s*[\/]\s*(\d+))?\s*$/);
  return match ? Number(match[1]) : binding.initialRawValue;
}
function statusDefinition(state, statusId, instance) {
  return state.statusTemplates?.[statusId] ?? instance ?? {};
}
function isPersistent(template, instance) { return template?.durationType === 'persistent' || instance?.durationType === 'persistent'; }
function statusDisplay(template, instance, statusId) { return template?.name ?? instance?.name ?? statusId; }
function statusValue(template, instance) {
  return { 名称: statusDisplay(template, instance), 层数: instance?.stacks ?? 1, 类型: template?.category ?? instance?.category };
}

/** Return RFC 6902 operations for the host's MVU JSONPatch handler. No host
 * mutation happens here; callers can wrap these operations in UpdateVariable.
 * `report` may be a state object or `{ state }`. */
export function battleReportToMvuPatch(report, sourceMap = {}, options = {}) {
  const state = report?.state ?? report?.battleState ?? report;
  const units = state?.units ?? (Array.isArray(report?.units) ? Object.fromEntries(report.units.map(u => [u.id, u])) : {});
  const root = options.root ?? 'stat_data';
  const ops = [];
  const aliases = { hp: ['生命值', '当前'], mp: ['法力值', '当前'], sp: ['体力值', '当前'] };
  for (const [id, unit] of Object.entries(units ?? {})) {
    const mapping = sourceMap[id] ?? {};
    // A char_info/battle_init-only unit has no MVU path and must never create a
    // fictional /stat_data/characters/... branch.
    if (!Array.isArray(mapping.path) || mapping.path.length === 0) continue;
    const path = mapping.path;
    const resourcePaths = mapping.resourcePaths ?? {};
    for (const key of ['hp', 'mp', 'sp']) {
      const value = finalResource(unit, key), initial = initialResource(mapping, key, unit);
      if (value == null || initial != null && value === initial) continue;
      const mapped = Array.isArray(resourcePaths[key]) ? resourcePaths[key] : aliases[key];
      ops.push({ op: 'replace', path: pointer([root, ...path, ...mapped]), value });
    }

    for (const [, binding] of asBindings(mapping.counterBindings)) {
      const current = poolCurrent(state, unit, binding);
      if (current == null) continue;
      const initial = counterInitial(binding);
      const value = formatCounter(binding, current);
      if (initial != null && Number(current) === Number(initial)) continue;
      if (initial != null && typeof binding.initialRawValue === 'string' && value === binding.initialRawValue) continue;
      const mvuPath = Array.isArray(binding.mvuPath) ? binding.mvuPath : null;
      if (!mvuPath) continue;
      ops.push({ op: 'replace', path: pointer([root, ...mvuPath]), value });
    }

    for (const [, inventory] of asBindings(mapping.inventoryPaths)) {
      const skillId = inventory.skillId ?? inventory.id;
      const current = numberValue(unit.inventory?.[skillId]);
      const initial = numberValue(inventory.initialCount);
      const countPath = Array.isArray(inventory.countPath) ? inventory.countPath : null;
      if (current == null || initial == null || current === initial || !countPath) continue;
      ops.push({ op: 'replace', path: pointer([root, ...countPath]), value: Math.max(0, Math.round(current)) });
    }

    if (unit.statuses && options.includeStatuses !== false && Array.isArray(mapping.statusesPath)) {
      const statusRoot = [root, ...path, ...mapping.statusesPath];
      const bindings = asBindings(mapping.counterBindings).map(([, binding]) => binding);
      const boundStatusIds = new Set(bindings.map(binding => {
        const target = binding.resolvedTarget ?? binding.target;
        return target?.kind === 'persistent_status' ? target.statusId : binding.statusId;
      }).filter(Boolean));
      const currentNames = new Set();
      for (const [statusId, instance] of Object.entries(unit.statuses)) {
        const template = statusDefinition(state, statusId, instance);
        if (!isPersistent(template, instance) || boundStatusIds.has(statusId)) continue;
        const name = statusDisplay(template, instance, statusId);
        currentNames.add(name);
        ops.push({ op: own(mapping.initialStatusNames ?? {}, name) ? 'replace' : 'add', path: pointer([...statusRoot, name]), value: statusValue(template, instance) });
      }
      for (const name of Object.keys(mapping.initialStatusNames ?? {})) {
        if (!currentNames.has(name)) ops.push({ op: 'remove', path: pointer([...statusRoot, name]) });
      }
    }
  }
  return ops;
}
export const buildPostBattlePatch = battleReportToMvuPatch;
export function buildMvuJsonPatch(report, sourceMap = {}, options = {}) {
  const patch = battleReportToMvuPatch(report, sourceMap, options);
  return `<UpdateVariable><JSONPatch>${JSON.stringify(patch)}</JSONPatch></UpdateVariable>`;
}
