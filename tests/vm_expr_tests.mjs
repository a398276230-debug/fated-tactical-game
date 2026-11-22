import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileExpr, evaluateExpr, evaluateFormula, exprUses, formulaQueryNames,
  formulaReference, formulaUses, validExpr, validFormula
} from '../src/core/formula.js';

test('Expr supports scalar literals, precedence, associativity and lazy branches', () => {
  assert.equal(evaluateExpr(2), 2);
  assert.equal(evaluateExpr(false), false);
  assert.equal(evaluateExpr("'energy'"), 'energy');
  assert.equal(evaluateExpr('-(4 + 2) + +17 % 5 * 2'), -2);
  assert.equal(evaluateExpr('12 / 2 / 3'), 2);
  assert.equal(evaluateExpr('1 + 2 < 4 == true && false || !false'), true);
  assert.equal(evaluateExpr('true || false && false'), true);
  assert.equal(evaluateExpr("false ? 'x' : false ? 'y' : 'z'"), 'z');
  assert.equal(evaluateExpr("'1' == 1"), false);
  assert.equal(evaluateExpr('1 / 0'), null);
  assert.equal(evaluateExpr('1 % 0'), null);
  assert.equal(evaluateExpr('1e308 * 1e308'), null);
  assert.equal(evaluateExpr("'2' + 3"), null);
  assert.equal(evaluateExpr('event.missing == event.other', { event: {} }), null);
  const context = { target: {}, isImmune: () => assert.fail('unselected branch ran') };
  assert.equal(evaluateExpr("false && is_immune(target, 'freeze')", context), false);
  assert.equal(evaluateExpr("true || is_immune(target, 'freeze')", context), true);
  assert.equal(evaluateExpr('true ? 4 : 1 / 0'), 4);
});

test('Expr registers unit, container, event, tape and frame reads', () => {
  const self = { id: 'self', stats: { str: 4 }, hp: 6, maxHp: 8, resources: { 'soul-ash': 2 }, statuses: { freeze: { stacks: 3 } } };
  const context = {
    self, source: { armor: 7, x: 1, y: 2, z: 3, altitude: 2, mc: 4 },
    target: { team: 'red', hp: 0, id: 'target' }, attacker: { tier: 2 }, candidate: { vars: { score: 1 } },
    vars: { picked: 'red' }, event: { finalAmount: 15, canceled: false }, status: { id: 'freeze', vars: { dc: 5 } },
    zone: { vars: { damage: 10 } }, tape: { round: 1, team: 'red', actionType: 'skill', skillId: 'winter', actorId: 'target' },
    timeOfDay: 'night', round: 2, turn: 0, pool: 'hp'
  };
  assert.equal(evaluateExpr('self.str + self.resource.soul-ash + self.stacks.freeze + candidate.vars.score', context), 10);
  assert.equal(evaluateExpr("target.team == vars.picked && !target.alive && self.id != target.id", context), true);
  assert.equal(evaluateExpr('source.armor + source.x + source.y + source.z + source.altitude + source.mc + attacker.tier', context), 21);
  assert.equal(evaluateExpr('event.finalAmount + status.vars.dc + zone.vars.damage', context), 30);
  assert.equal(evaluateExpr("status.id == 'freeze' && tape.round == round - 1 && tape.actorId == target.id", context), true);
  assert.equal(evaluateExpr("timeOfDay == 'night' && !event.canceled && turn == 0", context), true);
  assert.equal(evaluateExpr("pool == 'hp' ? self.hpRatio : 0", context), 0.75);
  assert.equal(evaluateExpr('target.stacks.freeze', context), 0);
});

test('queries use deterministic read-only context and bind candidate per result', () => {
  const self = Object.freeze({ hp: 6, x: 0, y: 0, team: 'blue' });
  const target = Object.freeze({ hp: 8, x: 0, y: 3, z: 4, team: 'red', statuses: { instance1: { templateId: 'freeze' } } });
  const units = Object.freeze({ self, target });
  const context = Object.freeze({
    self, target, units, candidate: self, zone: { tags: ['darkness'] },
    select: (key, readContext) => {
      assert.equal(readContext.self, self);
      return key === 'selected' ? [target, self] : [];
    },
    inZone: (entity, key) => entity === self && key === 'darkness',
    isImmune: (entity, key, options, readContext) => {
      assert.deepEqual(options, { dryRun: true });
      return entity === readContext.target && key === 'freeze';
    }
  });
  assert.equal(evaluateExpr('clamp(max(abs(-5), floor(2.5)), 1, min(7, ceil(3.1)))', context), 4);
  assert.equal(evaluateExpr('distance() + distance(self, target)', context), 10);
  assert.equal(evaluateExpr('distance(target, self)', { ...context, distance: (a, b) => a === target && b === self ? 12 : 0 }), 12);
  assert.equal(evaluateExpr("has_status(target, 'freeze') && any_unit_has_status('freeze')", context), true);
  assert.equal(evaluateExpr("has_tag(zone, 'darkness') && in_zone(self, 'darkness') && is_immune(target, 'freeze')", context), true);
  assert.equal(evaluateExpr("count('selected') + sum('selected', candidate.hp)", context), 16);
  assert.equal(evaluateExpr("sum('empty', 1 / 0)", context), 0);
  assert.equal(evaluateExpr("count_units(candidate.team != self.team)", context), 1);
  assert.equal(evaluateExpr("count_units('candidate.team != self.team && candidate.alive')", context), 1);
  assert.equal(evaluateExpr("count_units('candidate.team == \\'red\\'')", context), 1);
  assert.equal(evaluateExpr("sum('selected', candidate.team)", context), null);
  assert.equal(evaluateExpr("is_immune(target, 'freeze')", { target }), null);
  assert.equal(context.candidate, self);
});

test('compilation reports static reads and protects the cached dependency set', () => {
  const source = "count_units('candidate.hp > vars.cutoff') > 0 ? distance() : event.finalAmount";
  const expression = compileExpr(source);
  assert.deepEqual(expression.dependencies, new Set(['candidate.hp', 'vars.cutoff', 'self', 'target', 'event.finalAmount']));
  assert.equal(exprUses(source, 'event.finalAmount'), true);
  expression.dependencies.clear();
  assert.equal(compileExpr(source).dependencies.size, 5);
  assert.equal(expression.evaluate({ units: [], event: { finalAmount: 20 } }), 20);
  assert.equal(formulaQueryNames().includes('is_immune'), true);
  assert.match(formulaReference, /candidate\.vars\.<id>/);
  assert.match(formulaReference, /is_immune\(unit,/);
});

test('Expr rejects unknown paths, malformed input and inherited or accessor values', () => {
  for (const bad of [
    'Math.random()', 'state.units.e1.hp', 'self.__proto__.hp', 'vars.constructor', 'event.prototype',
    'event.__proto__', 'event.actor.id', 'random()', 'has_tag(tape, \'mind\')', "has_status('self', 'freeze')",
    'min(1)', 'distance(self)', 'floor(1, 2)', 'true ? 1', '1 2', '1 === 1', '"energy"',
    "count_units('candidate.unknown')", '('.repeat(130) + '1' + ')'.repeat(130)
  ]) assert.equal(validExpr(bad), false, bad);
  const vars = Object.create({ inherited: 9 });
  Object.defineProperty(vars, 'getter', { get() { assert.fail('accessor ran'); } });
  assert.equal(evaluateExpr('vars.inherited', { vars }), null);
  assert.equal(evaluateExpr('vars.getter', { vars }), null);
  assert.equal(evaluateExpr('self.hp', Object.create({ self: { hp: 9 } })), null);
  assert.equal(evaluateExpr('event.targets', { event: { targets: ['e1'] } }), null);
  const aggregateContext = { units: [{}] };
  Object.defineProperty(aggregateContext, 'event', { enumerable: true, get() { assert.fail('accessor ran'); } });
  assert.equal(evaluateExpr('count_units(true)', aggregateContext), 1);
});

test('legacy numeric formulas retain syntax, zero defaults and dependency checks', () => {
  assert.equal(evaluateFormula('self.str + event.dealt * 2', { event: { dealt: 4 } }), 8);
  assert.equal(evaluateFormula('distance+weapon.attack', { distance: () => 3, weapon: () => ({ attack: 4 }) }), 7);
  assert.equal(evaluateFormula('self.resource.soul-ash - 2', { resource: (entity, id) => id === 'soul-ash' ? 5 : 0 }), 3);
  assert.equal(formulaUses('self.str + event.dealt * 2', 'event.dealt'), true);
  assert.equal(validFormula('true'), false);
  assert.equal(validFormula('floor(2)'), false);
  assert.equal(validFormula('source.hp'), false);
  assert.equal(evaluateFormula('10/0', {}), null);
});
