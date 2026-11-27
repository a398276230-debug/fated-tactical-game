import assert from 'node:assert/strict';
import { previewSpatialImpulse, resolveSpatialImpulse, continueSpatialImpulse } from '../src/core/element-impulse.js';
import { mediumZone } from '../src/core/element-media.js';
import { newVM, pushFrame, stepVM } from '../src/core/tactical-vm.js';
import { continueCommit } from '../src/core/vm-commit.js';
import { initializeUnitPools } from '../src/core/vm-pools.js';
import { grantStatus } from '../src/core/combat-actions.js';

const at = (x, y) => ({ x, y });
const makeState = () => ({
  grid: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ kind: 'floor', z: 0 }))),
  zones: {}, interactives: {}, units: {}, covers: {}, pools: {}, vm: newVM(),
  rng: 1, round: 1, turn: 0, logs: [],
});
const addZone = (state, id, medium, cells, extra = {}) => {
  state.zones[id] = { id, ...mediumZone(medium), tier: 1, area: { shape: 'cells', cells }, ...extra };
};
const addUnit = (state, id, x, y, altitude = 0) => {
  const unit = state.units[id] = { id, name: id, x, y, altitude, team: 'blue', tier: 1, hp: 100, maxHp: 100,
    mp: 0, maxMp: 0, sp: 0, maxSp: 0, statuses: {} };
  initializeUnitPools(state, unit.id);
  return unit;
};
const host = {
  continue(env) {
    const { state, frame } = env;
    if (frame.native === 'spatial_impulse') continueSpatialImpulse(env);
    else if (frame.native === 'commit') continueCommit(env);
    else if (frame.native === 'test_root') state.vm.stack.pop();
    else assert.fail(`Unexpected VM frame ${frame.native}`);
  },
  log(state, actor, type, text, detail) { state.logs.push({ type, text, detail }); },
  grantStatus,
  coverDamage(state, actor, cover, amount) { cover.hp -= amount; },
};
const apply = (state, impulse) => {
  const root = pushFrame(state, { native: 'test_root' });
  const result = resolveSpatialImpulse(state, host, root, impulse);
  stepVM(state, host);
  assert.equal(state.logs.some(entry => entry.type === 'vm_halt'), false);
  return result;
};

{
  const state = makeState();
  const target = addUnit(state, 'target', 4, 4);
  const impulse = { cells: [target], traits: ['wet'] };
  const before = structuredClone(state);
  const preview = previewSpatialImpulse(state, impulse);
  assert.deepEqual(state, before);
  assert.deepEqual(apply(state, impulse), preview);
  assert.equal(target.statuses.wet.remainingTurns, 2);
  assert.equal(Object.values(state.zones)[0].medium, 'water');
  assert.equal(Object.values(state.zones)[0].remainingTurns, 2);
  apply(state, { ...impulse, traits: ['cold'] });
  assert.equal(target.statuses.wet, undefined);
  assert.equal(target.statuses.chilled.remainingTurns, 1);
  assert.equal(Object.values(state.zones)[0].medium, 'ice');
  apply(state, { ...impulse, traits: ['heat', 'ignite'] });
  assert.equal(target.statuses.chilled, undefined);
  assert.equal(Object.values(state.zones)[0].medium, 'water');
  apply(state, { ...impulse, traits: ['heat', 'ignite'] });
  assert.equal(Object.values(state.zones)[0].medium, 'steam');
  assert.equal(state.rng, before.rng);
}

{
  const state = makeState();
  const direct = addUnit(state, 'direct', 1, 1);
  const ground = addUnit(state, 'ground', 3, 1);
  const air = addUnit(state, 'air', 3, 1, 1);
  addZone(state, 'water', 'water', [at(1, 1), at(2, 1), at(3, 1)]);
  direct.stats = { con: 24 };
  const impulse = { cells: [direct], traits: ['shock'], directTargetIds: [direct.id] };
  const before = structuredClone(state);
  const preview = previewSpatialImpulse(state, impulse);
  assert.deepEqual(state, before);
  assert.deepEqual(preview.secondaryTargets, [{ id: ground.id, kind: 'conduct', expectedDamage: 6 }]);
  assert.deepEqual(apply(state, impulse), preview);
  assert.equal(direct.hp, 100);
  assert.equal(ground.hp, 94);
  assert.equal(ground.statuses.stun.remainingTurns, 1);
  assert.equal(air.hp, 100);
  assert.equal(Object.values(state.zones)[0].medium, 'electrified_water');
  assert.notEqual(state.rng, before.rng);
}

{
  const state = makeState();
  addZone(state, 'cloud', 'smoke', [at(2, 2), at(3, 2)]);
  addZone(state, 'protected', 'fire', [at(3, 2)], { tier: 5 });
  addZone(state, 'spell', 'fire', [at(3, 2)], { layer: undefined });
  apply(state, { cells: [at(3, 2)], traits: ['wet'] });
  assert.equal(state.zones.protected.medium, 'fire');
  assert.equal(state.zones.spell.medium, 'fire');
  apply(state, { cells: [at(3, 2), at(2, 2)], traits: ['gust'], origin: at(1, 2), center: at(2, 2) });
  const smoke = Object.values(state.zones).find(zone => zone.medium === 'smoke');
  assert.deepEqual(smoke.area.cells, [at(3, 2), at(4, 2)]);
}

{
  const state = makeState();
  const cells = Array.from({ length: 24 }, (_, i) => at(i % 6, Math.floor(i / 6)));
  addZone(state, 'oil', 'oil', [...cells, at(0, 4)]);
  const units = cells.flatMap(({ x, y }, i) => [0, 1, 2].map(n => addUnit(state, `unit_${i}_${n}`, x, y)));
  const impulse = { cells: [at(0, 0), at(0, 4)], traits: ['heat', 'ignite'] };
  const preview = previewSpatialImpulse(state, impulse);
  assert.ok(preview.reactions.every(reaction => reaction.cells.length <= 24));
  assert.equal(preview.reactions[0].cells.length, 24);
  assert.equal(preview.reactions.reduce((total, reaction) => total + reaction.cells.length, 0), 25);
  assert.equal(preview.secondaryTargets.length, 72);
  assert.deepEqual(apply(state, impulse), preview);
  assert.ok(units.every(unit => unit.hp === 92));
}

{
  const state = makeState();
  for (let i = 0; i < 4; i++) {
    const id = `barrel_${i}`;
    state.interactives[id] = { id, name: id, kind: 'barrel', spent: false, x: i * 2, y: 2 };
  }
  const impulse = { cells: [at(0, 2)], traits: ['shock'] };
  const preview = previewSpatialImpulse(state, impulse);
  assert.equal(preview.reactions.filter(reaction => reaction.kind === 'barrel').length, 3);
  assert.deepEqual(apply(state, impulse), preview);
  assert.deepEqual(Object.values(state.interactives).map(item => item.spent), [true, true, true, false]);
  assert.deepEqual(apply(state, { ...impulse, cells: [at(6, 2)] }).reactions.map(reaction => reaction.kind), ['barrel']);
}

{
  const state = makeState();
  addZone(state, 'oil', 'oil', [at(2, 2)]);
  addZone(state, 'poison', 'poison_cloud', [at(2, 2)]);
  const target = addUnit(state, 'ground', 2, 2);
  const air = addUnit(state, 'air', 2, 2, 1);
  const impulse = { cells: [at(2, 2)], traits: ['ignite'] };
  const root = pushFrame(state, { native: 'test_root' });
  const preview = previewSpatialImpulse(state, impulse);
  assert.deepEqual(resolveSpatialImpulse(state, host, root, impulse), preview);
  const encoded = JSON.parse(JSON.stringify(state));
  stepVM(encoded, host);
  stepVM(state, host);
  assert.deepEqual(state, encoded);
  assert.equal(target.hp, 82);
  assert.equal(air.hp, 90);
}

{
  const state = makeState();
  addUnit(state, 'target', 2, 2);
  const before = structuredClone(state);
  const impulse = { cells: [at(2, 2)], traits: ['heat', 'ignite', 'cold', 'shock', 'gust', 'corrode'] };
  assert.deepEqual(previewSpatialImpulse(state, impulse), { reactions: [], secondaryTargets: [] });
  assert.deepEqual(apply(state, impulse), { reactions: [], secondaryTargets: [] });
  assert.equal(state.rng, before.rng);
  assert.deepEqual(state.units, before.units);
  assert.deepEqual(state.zones, before.zones);
}

{
  const state = makeState();
  const position = at(2, 2);
  const cover = state.covers.cover = { ...position, id: 'cover', hp: 20, maxHp: 20, material: '木' };
  state.elementalPhysics = 'off';
  assert.deepEqual(apply(state, { cells: [position], traits: ['ignite', 'corrode'] }), { reactions: [], secondaryTargets: [] });
  assert.equal(cover.hp, 20);
  delete state.elementalPhysics;
  const impulse = { cells: [position], traits: ['ignite', 'corrode'] };
  const preview = previewSpatialImpulse(state, impulse);
  assert.deepEqual(apply(state, impulse), preview);
  assert.equal(cover.hp, 13);
  state.scale = { cellM: 50 };
  apply(state, { cells: [position], traits: ['wet'], tier: 2 });
  assert.deepEqual(state.zones, {});
  apply(state, { cells: [position], traits: ['wet'], tier: 3 });
  assert.equal(Object.values(state.zones)[0].medium, 'water');
  apply(state, { cells: [position], traits: ['cold'], tier: 3 });
  assert.equal(Object.values(state.zones)[0].medium, 'ice');
}

console.log('Element impulse tests passed');
