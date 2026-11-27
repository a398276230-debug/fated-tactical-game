import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aimedOptions, chooseAction } from '../src/core/ai.js';
import { currentUnit, preview } from '../src/core/combat.js';
import { mediumZone } from '../src/core/element-media.js';
import { buildScenario } from '../src/presets/scenarios.js';

for (const ruleset of ['protocol', 'sandbox']) {
  test(`${ruleset} AI aims at an empty puddle to defeat an out-of-range enemy`, () => {
    const state = buildScenario('ruins');
    const actor = currentUnit(state);
    const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
    const ally = Object.values(state.units).find(unit => unit !== actor && unit.team === actor.team);
    for (const unit of Object.values(state.units)) if (unit !== actor && unit !== enemy) unit.hp = 0;
    state.ruleset = ruleset;
    state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
    state.covers = {};
    state.interactives = {};
    Object.assign(actor, { x: 1, y: 1, ap: 1, skills: ['arc'], used: { attack: 0, action: 0 } });
    Object.assign(enemy, { x: 7, y: 1, hp: 1 });
    state.skills.arc = { name: '电弧', ap: 1, slot: 'attack', range: 2, radius: 1, shape: 'circle', target: 'enemy',
      damage: { count: 1, sides: 1, stat: 'int', type: 'lightning' } };
    state.zones = { puddle: { ...mediumZone('water'), id: 'puddle', tier: actor.tier, area: {
      shape: 'cells', cells: Array.from({ length: 5 }, (_, index) => ({ x: index + 3, y: 1 })),
    } } };

    const skill = { type: 'skill', skillId: 'arc' };
    assert.equal(preview(state, { ...skill, x: enemy.x, y: enemy.y }).ok, false);
    const before = structuredClone(state);
    const chosen = chooseAction(state);
    assert.equal(chosen.skillId, 'arc');
    const plan = preview(state, chosen);
    assert.deepEqual(plan.targets, []);
    assert.ok(plan.surfaceImpact.secondaryTargets.some(target => target.id === enemy.id && target.expectedDamage >= enemy.hp));
    assert.deepEqual(state, before);

    const clean = aimedOptions(state, actor).find(row => row.action.skillId === 'arc' && row.action.x === chosen.x && row.action.y === chosen.y);
    Object.assign(ally, { x: 4, y: 1, hp: 1 });
    const dangerous = aimedOptions(state, actor).find(row => row.action.skillId === 'arc' && row.action.x === chosen.x && row.action.y === chosen.y);
    assert.ok(dangerous.score < clean.score);
  });
}
