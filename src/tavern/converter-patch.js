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

/*
 * The tavern boundary is intentionally boring and deterministic.  It accepts
 * data, never evaluates it, and only emits shapes which the tactical validator
 * understands.  Keeping this file free of TavernHelper imports also makes it
 * useful to import from a worker, a test, or a normal browser page.
 */
function pointer(path) { return '/' + path.map(x => String(x).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'); }
/** Return RFC 6902 operations for the host's MVU JSONPatch handler. No host
 * mutation happens here; callers can wrap these operations in UpdateVariable. */
export function battleReportToMvuPatch(report, sourceMap = {}, options = {}) {
  const state = report?.state ?? report?.battleState ?? report;
  const units = state?.units ?? (Array.isArray(report?.units) ? Object.fromEntries(report.units.map(u => [u.id, u])) : {});
  const ops = [];
  for (const [id, unit] of Object.entries(units)) {
    const mapping = sourceMap[id] ?? {};
    const path = Array.isArray(mapping.path) ? mapping.path : ['characters', id];
    for (const key of ['hp','mp','sp']) if (unit && Number.isFinite(unit[key])) ops.push({ op: 'replace', path: pointer([options.root ?? 'stat_data', ...path, key]), value: unit[key] });
    if (unit?.statuses && options.includeStatuses !== false) ops.push({ op: 'replace', path: pointer([options.root ?? 'stat_data', ...path, 'statuses']), value: clone(unit.statuses) });
  }
  return ops;
}
export const buildPostBattlePatch = battleReportToMvuPatch;
export function buildMvuJsonPatch(report, sourceMap = {}, options = {}) {
  const patch = battleReportToMvuPatch(report, sourceMap, options);
  return `<UpdateVariable><JSONPatch>${JSON.stringify(patch)}</JSONPatch></UpdateVariable>`;
}
