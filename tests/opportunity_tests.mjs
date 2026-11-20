import { expression as fx } from '../src/core/effects.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, beginBattle, grantStatus, preview } from '../src/core/combat.js';

const unit = (id, team, x, y, extra = {}) => ({ id, name: id, team, x, y, hp: 50, maxHp: 50,
  armor: 0, stats: { str: 10, agi: 0 }, statuses: {}, ap: 0, mp: 10, sp: 10, move: 6,
  facing: [1, 0], used: { attack: 0, action: 0 }, skills: [], ...extra });
const mover = (x, y, extra) => unit('mover', 'blue', x, y, { ap: 2, ...extra });
const enemy = (id, x, y, extra) => unit(id, 'red', x, y, { weapon: 'spear', ...extra });
const damage = { count: 1, sides: 1, bonus: 8, type: 'physical' };
const state = (rows, units) => ({ grid: rows.map(row => [...row].map(ch => ({ kind: ch === '#' ? 'wall' : 'floor', z: 0 }))),
  units: Object.fromEntries(units.map(u => [u.id, u])), covers: {}, interactives: {}, logs: [],
  items: { spear: { id: 'spear', templateId: 'spear', counters: {} }, bow: { id: 'bow', templateId: 'bow', counters: {} } },
  equipment: { spear: { name: 'spear', range: 1.5, damage, effects: [] }, bow: { name: 'bow', range: 4, damage, effects: [] } },
  skills: {}, rng: 0, turn: 0, round: 1, outcome: null, order: units.map(u => u.id) });
const xy = at => ({ x: at.x, y: at.y });
const reactions = logs => logs.filter(entry => entry.type === 'opportunity');

// Walls keep movement in the row, but a cardinal side pocket lets the sentry reach the route.
function hall(extra = {}) {
  return state(['.....', '##.##'], [mover(0, 0, extra), enemy('sentry', 2, 1)]);
}

for (const type of ['move', 'sprint']) test(`${type}: pass-through provokes at the old square and replays exactly`, () => {
  const s = hall({ move: type === 'sprint' ? 2 : 4 });
  const action = { type, x: 4, y: 0 };
  const snapshot = structuredClone(s);
  const plan = preview(s, action);
  const warning = { unitId: 'sentry', name: 'sentry', from: { x: 2, y: 0 }, to: { x: 3, y: 0 } };
  assert.deepEqual(plan.opportunities, [warning]);
  assert.deepEqual(preview(s, { type }).cells.find(at => at.x === 4 && at.y === 0).opportunities, [warning]);
  assert.deepEqual(s, snapshot, 'preview does not spend reactions, RNG, or movement');

  const logs = applyAction(s, action);
  assert.deepEqual(reactions(logs).map(e => e.detail), [{ ...warning, targetId: 'mover' }]);
  assert.equal(logs.find(e => e.type === 'roll').detail.distance, 1, 'attack resolves while still next to sentry');
  assert.equal(s.units.mover.hp, 41);
  assert.deepEqual(xy(s.units.mover), { x: 4, y: 0 });
  assert.deepEqual(applyAction(snapshot, action), logs);
  assert.deepEqual(snapshot, s);
});

test('safe path can be longer; risk is offered only if all legal paths in the budget provoke', () => {
  const s = state(['.....', '.....', '.....', '.....'], [mover(0, 1), enemy('sentry', 2, 1)]);
  const action = { type: 'move', x: 4, y: 1 };
  const safe = preview(s, action);
  assert.equal(safe.ok, true);
  assert.ok(safe.steps > 4 && safe.steps <= 6);
  assert.deepEqual(safe.opportunities, []);
  assert.equal(reactions(applyAction(structuredClone(s), action)).length, 0);
  s.units.mover.move = 4;
  const risky = preview(s, action);
  assert.equal(risky.steps, 4);
  assert.ok(risky.opportunities.length > 0);
});

test('reactor charge is spent even on a miss; starts ready and refills on its own turn', () => {
  const s = hall();
  beginBattle(s);
  assert.equal(s.units.sentry.reactionAvailable, true);
  // Fix initiative after testing initialization; choose a seed whose next d20 is a natural 1.
  s.order = ['mover', 'sentry']; s.turn = 0; s.units.mover.ap = 2; s.rng = 1972;
  const logs = applyAction(s, { type: 'move', x: 4, y: 0 });
  assert.equal(logs.find(e => e.type === 'roll').detail.selected, 1);
  assert.equal(s.units.mover.hp, 50);
  assert.equal(s.units.sentry.reactionAvailable, false);
  assert.deepEqual(preview(s, { type: 'move', x: 0, y: 0 }).opportunities, []);
  assert.equal(reactions(applyAction(s, { type: 'move', x: 0, y: 0 })).length, 0);
  assert.equal(s.units.sentry.reactionAvailable, true);
  applyAction(s, { type: 'end' });
  assert.equal(preview(s, { type: 'move', x: 4, y: 0 }).opportunities.length, 1);
});

test('simultaneous exits react by stable unit ID without spending AP or action slots', () => {
  const s = state(['##.##', '.....', '##.##'], [mover(0, 1), enemy('z', 2, 0), enemy('a', 2, 2)]);
  const action = { type: 'move', x: 4, y: 1 };
  assert.deepEqual(preview(s, action).opportunities.map(o => o.unitId), ['a', 'z']);
  assert.deepEqual(reactions(applyAction(s, action)).map(e => e.actor), ['a', 'z']);
  for (const id of ['a', 'z']) {
    assert.equal(s.units[id].reactionAvailable, false);
    assert.equal(s.units[id].ap, 0);
    assert.deepEqual(s.units[id].used, { attack: 0, action: 0 });
  }
});

test('lethal or rooting reaction interrupts before entering the next square', () => {
  for (const lethal of [true, false]) {
    const s = hall({ hp: lethal ? 1 : 50 });
    if (!lethal) s.equipment.spear.effects = [fx('root-reaction', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'root', turns: 1 }], { condition: { type: 'opportunityAttack' } })];
    const logs = applyAction(s, { type: 'move', x: 4, y: 0 });
    assert.deepEqual(xy(s.units.mover), { x: 2, y: 0 });
    const move = logs.find(e => e.type === 'move').detail;
    assert.equal(move.interrupted, true);
    assert.equal(move.steps, 2);
    assert.deepEqual(move.path.map(xy), [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    if (lethal) assert.equal(s.units.mover.hp, 0);
    else {
      assert.equal(s.units.mover.statuses.root.remainingTurns, 1);
      assert.equal(s.units.mover.ap, 1);
      assert.equal(preview(s, { type: 'disengage', x: 4, y: 0 }).ok, false);
    }
  }
});

test('an interrupt cancels the attempted step without spending later reactors', () => {
  const s = state(['##.##', '.....', '##.##'], [mover(0, 1), enemy('a', 2, 0), enemy('z', 2, 2)]);
  s.equipment.spear.effects = [fx('root-reaction', 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'root', turns: 1 }], { condition: { type: 'opportunityAttack' } })];
  const action = { type: 'move', x: 4, y: 1 };
  assert.deepEqual(preview(s, action).opportunities.map(o => o.unitId), ['a', 'z']);
  assert.deepEqual(reactions(applyAction(s, action)).map(e => e.actor), ['a']);
  assert.notEqual(s.units.z.reactionAvailable, false);
  assert.deepEqual(xy(s.units.mover), { x: 2, y: 1 });
});

test('disengage is a 1 AP move that neither provokes nor consumes a reaction', () => {
  const s = hall();
  s.mode = 'split';
  const action = { type: 'disengage', x: 4, y: 0 };
  assert.equal(preview(s, action).ap, 1);
  assert.deepEqual(preview(s, action).opportunities, []);
  assert.equal(reactions(applyAction(s, action)).length, 0);
  assert.equal(s.units.mover.ap, 1);
  assert.deepEqual(s.units.mover.used, { attack: 0, action: 1 });
  assert.deepEqual(xy(s.units.mover), { x: 4, y: 0 });
  assert.notEqual(s.units.sentry.reactionAvailable, false);
  assert.equal(s.rng, 0);
  assert.equal(preview(s, action).ok, false);
  s.mode = 'free';
  assert.equal(preview(s, { type: 'move', x: 0, y: 0 }).opportunities.length, 1, 'immunity does not carry to another move');
});

test('threat requires hostile ready melee, line of sight, and 3D weapon reach, but allows rooted reactors', () => {
  const action = { type: 'move', x: 4, y: 0 };
  const checks = [
    [s => { s.units.sentry.weapon = 'bow'; }, false],
    [s => { s.equipment.spear.effects = [fx('ammo-pool', 'passive', 'self', [{ kind: 'produceResource', resource: 'ammo', cap: 1, reloadable: true }])]; }, false],
    [s => { s.units.sentry.team = 'blue'; }, false],
    [s => { s.units.sentry.hp = 0; }, false],
    [s => { s.units.sentry.reactionAvailable = false; }, false],
    [s => { s.grid[1][2].z = 2; }, false],
    ...['stun', 'freeze', 'root'].map(id => [s => grantStatus(s, s.units.sentry, id), id === 'root']),
  ];
  for (const [setup, threatens] of checks) {
    const s = hall(); setup(s);
    assert.equal(preview(s, action).opportunities.length, Number(threatens));
  }
  const corner = state(['.....', '.#.##'], [mover(0, 0), enemy('sentry', 2, 1)]);
  const exit = { type: 'move', x: 0, y: 0 };
  corner.units.mover.x = 1;
  assert.deepEqual(preview(corner, exit).opportunities, [], 'wall at the diagonal corner blocks threat');
  corner.grid[1][1].kind = 'floor';
  assert.equal(preview(corner, exit).opportunities.length, 1);
});

test('knockback and teleport bypass reactions even when leaving melee threat', () => {
  const s = state(['......', '......', '......'], [enemy('caster', 0, 1, { ap: 2, skills: ['push'] }),
    mover(1, 1), unit('watch', 'red', 1, 2)]);
  s.skills.push = { name: 'push', ap: 1, slot: 'attack', range: 1, target: 'enemy', effects: [fx('push', 'on_hit', 'hitTarget', [{ kind: 'knockback', distance: 3 }])] };
  const push = applyAction(s, { type: 'skill', skillId: 'push', x: 1, y: 1 });
  assert.equal(s.units.mover.x, 4);
  assert.equal(reactions(push).length, 0);
  assert.notEqual(s.units.watch.reactionAvailable, false);

  const t = state(['......', '......', '......'], [mover(0, 1, { skills: ['blink'] }), enemy('target', 4, 1), enemy('watch', 0, 2)]);
  t.skills.blink = { name: 'blink', ap: 1, slot: 'attack', range: 5, target: 'enemy', effects: [fx('blink', 'active', 'hitTarget', [{ kind: 'teleportBackstab' }])] };
  const blink = applyAction(t, { type: 'skill', skillId: 'blink', x: 4, y: 1 });
  assert.equal(t.units.mover.x, 3);
  assert.equal(reactions(blink).length, 0);
  assert.notEqual(t.units.watch.reactionAvailable, false);
});
