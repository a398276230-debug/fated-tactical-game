import assert from 'node:assert/strict';
import { aoeCells, canStep, coverBetween, distance3D, facingArc, facingToward, findPath, flankPosition,
  hasLOS, isFlanked, movementOptions, reachableCells, supercoverLine } from '../src/core/spatial.js';
import { critChance, hitChance, nextRng, rollD20, rollDice, rollDie, saveChance, seedRng } from '../src/core/rng.js';

const p = (x, y) => ({ x, y });
const grid = () => ({ grid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ z: 0, kind: 'floor' }))),
  units: {}, covers: {}, interactives: {}, rng: 0 });
const tile = (state, x, y, kind, z = 0) => { state.grid[y][x] = { kind, z }; };
const wall = (state, x, y) => tile(state, x, y, 'wall');
const includes = (mask, x, y) => mask.some(cell => cell.x === x && cell.y === y);
const cover = (id, x, y, rating = 2) => ({ id, x, y, hp: 10, cover: rating });

export function runSpatialTests() {
  {
    const state = grid(), actor = state.units.A = { ...p(0, 0), id: 'A', hp: 10 };
    tile(state, 1, 0, 'floor', 2);
    assert.equal(canStep(state, actor, p(1, 0)), false, 'flat ledge is a cliff');
    tile(state, 1, 0, 'slope', 2);
    assert.equal(canStep(state, actor, p(1, 0)), true);
    assert.equal(canStep(state, p(1, 0), actor), false, 'living units block the slope too');
    assert.equal(canStep(state, p(1, 0), actor, { ignoreUnitId: 'A' }), true);
    tile(state, 2, 0, 'floor', 5);
    assert.equal(canStep(state, p(1, 0), p(2, 0)), false, 'slopes do not bridge a three-level drop');
    wall(state, 0, 1);
    assert.equal(canStep(state, actor, p(1, 1)), false, 'no corner cutting');
    assert.deepEqual(findPath(state, actor, p(1, 1), 2), [{ x: 1, y: 0, z: 2 }, { x: 1, y: 1, z: 0 }]);
    assert.equal(findPath(state, actor, p(1, 1), 1), null);
    assert.deepEqual(findPath(state, actor, actor, 0), []);
    assert.equal(findPath(state, actor, p(10, 0)), null);
    assert.equal(distance3D(state, actor, p(1, 0)), Math.sqrt(5));
    const pristine = structuredClone(state);
    const mask = reachableCells(state, actor, 2);
    assert.deepEqual(mask, [{ x: 1, y: 0, z: 2, cost: 1 }, { x: 1, y: 1, z: 0, cost: 2 }]);
    assert.deepEqual(movementOptions(state, actor, 2).at(-1).path, findPath(state, actor, p(1, 1), 2));
    assert.deepEqual(state, pristine, 'movement previews do not alter state');
    state.covers.C = cover('C', 1, 0);
    assert.deepEqual(reachableCells(state, actor, 2), []);
    state.covers.C.hp = 0;
    assert.equal(reachableCells(state, actor, 2).length, 2);
  }
  {
    const state = grid();
    assert.deepEqual(supercoverLine(p(0, 0), p(1, 1)), [p(0, 0), p(1, 0), p(0, 1), p(1, 1)]);
    assert.deepEqual(supercoverLine(p(0, 0), p(3, 1)), [p(0, 0), p(1, 0), p(2, 0), p(1, 1), p(2, 1), p(3, 1)]);
    assert.deepEqual(supercoverLine(p(3, 1), p(0, 0)), supercoverLine(p(0, 0), p(3, 1)).reverse());
    wall(state, 1, 0);
    assert.equal(hasLOS(state, p(0, 0), p(1, 1)), false, 'a touched wall at a corner is opaque');
    assert.equal(hasLOS(state, p(1, 1), p(0, 0)), false);
    assert.equal(hasLOS(state, p(0, 0), p(1, 0)), false, 'wall endpoints block');
    assert.equal(hasLOS(state, p(0, 0), p(-1, 0)), false);
    assert.equal(hasLOS(state, p(0, 0), p(0, 3)), true);
  }
  {
    const state = grid(), origin = p(0, 2), target = p(1, 2);
    wall(state, 3, 2);
    const line = aoeCells(state, origin, target, { shape: 'line', range: 9, width: 0 });
    assert.deepEqual(line, [{ x: 1, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }]);
    const circle = aoeCells(state, origin, p(2, 2), { shape: 'circle', radius: 3, range: 3 });
    assert(includes(circle, 2, 3));
    assert(!includes(circle, 4, 2));
    assert(!includes(circle, 3, 2));
    tile(state, 2, 3, 'floor', 4);
    assert(!includes(aoeCells(state, origin, p(2, 2), { shape: 'circle', radius: 3, range: 3 }), 2, 3));
    const fan = aoeCells(state, origin, target, { shape: 'fan', range: 5 });
    const cone = aoeCells(state, origin, target, { shape: 'cone', range: 5 });
    assert(includes(fan, 1, 1));
    assert(!includes(cone, 1, 1));
    assert(!includes(fan, 4, 2));
    assert(!includes(cone, 4, 2));
    assert.deepEqual(aoeCells(state, origin, p(4, 2), { shape: 'circle', radius: 5 }), []);
    assert.deepEqual(aoeCells(state, origin, p(3, 3), { shape: 'fan', range: 1 }), []);
  }
  {
    const state = grid(), shooter = p(1, 1), defender = { ...p(5, 3), facing: [-1, 0] };
    state.covers.line = cover('line', 3, 2);
    state.covers.adj = cover('adj', 5, 2, 4);
    state.covers.rear = cover('rear', 6, 3, 8);
    assert.equal(coverBetween(state, shooter, defender)?.id, 'adj');
    state.covers.adj.hp = 0;
    assert.equal(coverBetween(state, shooter, defender)?.id, 'line');
    tile(state, 1, 1, 'floor', 2);
    assert.equal(coverBetween(state, shooter, defender), null);
    assert.deepEqual(facingToward(shooter, defender), [1, 1]);
    assert.equal(facingArc(defender, shooter), 'front');
    assert.equal(flankPosition(p(5, 4), defender), 'side');
    assert.equal(flankPosition(p(6, 3), defender), 'rear');
    const attacker = state.units.A = { id: 'A', team: 'blue', hp: 10, ...p(4, 3) };
    state.units.B = { id: 'B', team: 'blue', hp: 10, ...p(6, 2) };
    assert.equal(isFlanked(state, attacker, defender), true);
    wall(state, 5, 2);
    assert.equal(isFlanked(state, attacker, defender), false);
  }
  {
    assert.equal(seedRng(-1), 0xffffffff);
    assert.equal(seedRng(''), 2166136261);
    assert.equal(seedRng('foobar'), 0xbf9cf968);
    assert.equal(nextRng(0).rng, 1013904223);
    assert.equal(nextRng(1013904223).rng, 1196435762);
    assert.equal(rollDie(0, 1).value, 1);
    assert.throws(() => rollDie(0, 0), RangeError);
    // Invert the LCG to make the first state 0xffffffff, which d20 rejects.
    const rejectedSeed = Math.imul(0xffffffff - 1013904223, 4276115653) >>> 0;
    assert.equal(nextRng(rejectedSeed).rng, 0xffffffff);
    assert.equal(rollDie(rejectedSeed, 20).rng, nextRng(0xffffffff).rng);
    const seed = seedRng('battle 42'), dice = rollDice(seed, 4, 20);
    assert.deepEqual(rollDice(seed, 4, 20), dice);
    assert.equal(dice.total, dice.rolls.reduce((a, b) => a + b, 0));
    assert.deepEqual(rollD20(seed, 2, 2), { rng: rollDie(seed, 20).rng, value: dice.rolls[0], rolls: dice.rolls.slice(0, 1), mode: 'normal' });
    assert.equal(rollD20(seed, 2, 1).value, Math.max(...dice.rolls.slice(0, 2)));
    assert.equal(rollD20(seed, 1, 2).value, Math.min(...dice.rolls.slice(0, 2)));
    for (const threshold of [-100, 1, 11, 11.5, 20, 21, 100]) {
      const hit = n => n === 20 || (n !== 1 && n >= threshold);
      let single = 0, good = 0, bad = 0;
      for (let a = 1; a <= 20; a++) {
        single += Number(hit(a));
        for (let b = 1; b <= 20; b++) {
          good += Number(hit(Math.max(a, b)));
          bad += Number(hit(Math.min(a, b)));
        }
      }
      assert.equal(hitChance(threshold + 3, 3), single / 20);
      assert.equal(hitChance(threshold, 0, 1), good / 400);
      assert.equal(hitChance(threshold, 0, 0, 1), bad / 400);
    }
    assert.equal(critChance(1), 39 / 400);
    assert.equal(critChance(0, 1), 1 / 400);
    assert.equal(saveChance(21), 0);
    assert.equal(saveChance(21, 1), 1 / 20);
    assert.equal(saveChance(1), 1);
  }
}

runSpatialTests();
console.log('Spatial and RNG tests passed.');
