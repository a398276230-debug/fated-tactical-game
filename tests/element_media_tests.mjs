import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/presets/scenarios.js';
import { validateState } from '../src/api/validation.js';
import { STATUSES, PHYSICAL_STATUSES, getStatusTemplate } from '../src/presets/status-defaults.js';
import { validVmOpcode } from '../src/core/vm-schema.js';
import { applyMediumEntry, mediumZone, putMedium, ZONE_MEDIA } from '../src/core/element-media.js';
import { cellStepCost, hasLOS, reachableCells } from '../src/core/spatial.js';

const host = { log() {}, grantStatus: (state, unit, id) => { unit.statuses[id] = { id }; } };
const place = (state, medium, cells, fields) => putMedium(state, host, { medium, area: { shape: 'cells', cells }, ...fields });

test('physical templates are fallback-only and every medium validates', () => {
  assert.equal(Object.keys(STATUSES).length, 9);
  assert.equal(Object.keys(PHYSICAL_STATUSES).length, 4);
  const state = buildScenario('ruins');
  const templates = structuredClone(state.statusTemplates);
  for (const medium of ZONE_MEDIA) {
    const id = `test-${medium}`;
    state.zones ??= {};
    state.zones[id] = { id, ...mediumZone(medium), follow: false, persistent: false, area: { shape: 'cells', cells: [{ x: 1, y: 1 }] } };
  }
  validateState(state);
  assert.deepEqual(state.statusTemplates, templates);
  const wet = { id: 'wet', name: '自定义潮湿' };
  assert.equal(getStatusTemplate({ statusTemplates: { wet } }, 'wet'), wet);
  const opcode = { op: 'apply_status', target: 'self', statusId: 'wet' };
  assert.equal(validVmOpcode(opcode), true);
  assert.equal(validVmOpcode(opcode, { declaredStatusTemplatesOnly: true }), false);
  const zone = { op: 'spawn', entityKind: 'zone', spec: { medium: 'water', layer: 'cloud', area: { shape: 'board' } } };
  assert.equal(validVmOpcode(zone), false);
});

test('media layers crop independently with rank protection and obscure LOS', () => {
  const state = buildScenario('boss');
  const gravefire = structuredClone(state.zones.Z1);
  const first = { x: 1, y: 1 }, second = { x: 2, y: 1 };
  for (const { x, y } of [first, second]) state.grid[y][x] = { kind: 'floor', z: 0 };
  const water = place(state, 'water', [first, second]);
  const steam = place(state, 'steam', [second]);
  assert.equal(hasLOS(state, first, second), false);
  assert.equal(hasLOS(state, first, second, { ignoreObscure: true }), true);
  assert.equal(hasLOS(state, second, second), true);
  place(state, 'ice', [second]);
  assert.deepEqual(state.zones[water.id].area.cells, [first]);
  assert.deepEqual(state.zones[steam.id].area.cells, [second]);
  const fire = place(state, 'fire', [first], { flags: ['undispellable'] });
  assert.equal(place(state, 'water', [first], { tier: 2 }), undefined);
  assert.equal(state.zones[fire.id], fire);
  assert.deepEqual(state.zones.Z1, gravefire);
});

test('ice step costs apply to ground paths and only ground steps can slip', () => {
  const state = buildScenario('ruins');
  state.units = {};
  state.covers = {};
  state.rng = 0;
  const from = { x: 1, y: 1, stats: { agi: 0 }, statuses: {} }, to = { x: 2, y: 1 };
  place(state, 'ice', [to]);
  assert.equal(cellStepCost(state, from, to), 2);
  assert.equal(cellStepCost(state, { ...from, altitude: 1 }, to), 1);
  assert(!reachableCells(state, from, 1).some(at => at.x === to.x && at.y === to.y));
  assert.equal(applyMediumEntry(state, host, null, { ...from, altitude: 1 }, to), false);
  assert.equal(state.rng, 0);
  assert.equal(applyMediumEntry(state, host, null, from, to), true);
  assert.equal(from.statuses.prone.id, 'prone');
});
