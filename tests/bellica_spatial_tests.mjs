import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyAction, currentUnit, grantStatus, mitigation, preview, reachable } from '../src/core/combat.js';
import { advanceVMSpatial } from '../src/core/vm-runtime.js';
import { evaluateExpr } from '../src/core/formula.js';

function field() {
  const state = buildScenario('ruins');
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.interactives = {};
  const actor = currentUnit(state);
  const others = Object.values(state.units).filter(unit => unit !== actor);
  Object.assign(actor, { x: 1, y: 1, move: 4, ap: 2, used: { attack: 0, action: 0 } });
  others.forEach((unit, i) => Object.assign(unit, { x: 8, y: i + 2, team: actor.team === 'blue' ? 'red' : 'blue' }));
  return { state, actor, others };
}

const tag = (name, value) => ({ op: 'let', name, value, scope: 'owner' });

test('a vehicle observes boarding, moves its passenger, and reads actual moved distance', () => {
  const { state, actor: passenger, others: [vehicle] } = field();
  Object.assign(vehicle, { x: 2, y: 1, team: passenger.team, move: 4 });
  state.statusTemplates ??= {};
  state.statusTemplates.boarding = { id: 'boarding', name: '搭乘', category: 'special', durationType: 'until_removed' };
  vehicle.rules = [
    { id: 'board', hook: 'after_move', filter: 'attacker.id != self.id && attacker.team == self.team', program: [
      { op: 'if', cond: 'attacker.x == self.x && attacker.y == self.y', then: [{ op: 'apply_status', target: 'attacker', statusId: 'boarding', vars: { vehicle: 'self.id', label: '乘客' } }],
        else: [{ op: 'remove_status', target: 'attacker', where: "candidate.id == 'boarding' && status.vars.vehicle == self.id" }] },
    ] },
    { id: 'carry', hook: 'after_move', filter: 'attacker.id == self.id', program: [tag('distance', 'self.moved'),
      { op: 'for_each', select: { from: 'units', where: "candidate.team == self.team && has_status(candidate, 'boarding') && (candidate.x != self.x || candidate.y != self.y)" }, bind: 'p',
        body: [{ op: 'move', target: 'vars.p', mode: 'teleport', to: 'self' }] },
    ] },
  ];
  applyAction(state, { type: 'move', x: 2, y: 1 });
  assert.equal(passenger.statuses.boarding.vars.vehicle, vehicle.id);
  assert.equal(passenger.statuses.boarding.vars.label, '乘客');
  state.turn = state.order.indexOf(vehicle.id);
  Object.assign(vehicle, { ap: 2, used: { attack: 0, action: 0 } });
  applyAction(state, { type: 'move', x: 6, y: 1 });
  assert.deepEqual([passenger.x, passenger.y, vehicle.lastMoveDir, vehicle.vars.distance], [6, 1, 'E', 4]);
  assert.equal(state.logs.filter(log => log.type === 'opportunity').length, 0);
});

test('sunder counts once; movement combines native flat and VM multipliers before cell conversion', () => {
  const {state, actor} = field();
  actor.armor = 20;
  const armor = () => mitigation(state, actor, 'physical', true).armor;
  const initial = armor(); grantStatus(state, actor, 'sunder'); assert.equal(armor(), initial - 4);
  Object.assign(actor, { tier:3, moveM:20 }); state.scale.cellM = 5;
  const steps = () => Math.max(...reachable(state).map(c => c.steps));
  grantStatus(state, actor, 'chill'); assert.equal(steps(), 3);
  delete actor.statuses.chill; grantStatus(state, actor, 'haste'); assert.equal(steps(), 5);
  actor.mods = [{stat:'movement', mult:0.5}]; assert.equal(steps(), 2);
  state.scale.cellM = 2; assert.equal(steps(), 6);
});

test('movement modifiers scale in metres and hover protects only from hostile reach', () => {
  const { state, actor, others: [target] } = field();
  actor.tier = 5; actor.moveM = 150;
  actor.mods = [{ stat: 'movement', flat: 6 }];
  state.scale.cellM = 50;
  assert.equal(Math.max(...reachable(state).map(cell => cell.steps)), 9);
  state.scale.cellM = 200;
  assert.equal(Math.max(...reachable(state).map(cell => cell.steps)), 2);
  actor.mods[0].flat = -8;
  assert.equal(reachable(state).some(cell => cell.steps > 0), false);
  target.mods = [{ stat: 'incomingDistanceOffset', flat: 1 }];
  target.x = actor.x; target.y = actor.y;
  actor.skills = ['touch', 'explosion'];
  const attack = { name: '攻击', slot: 'attack', ap: 1, target: 'enemy', shape: 'single', range: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' } };
  state.skills.touch = attack;
  state.skills.explosion = { ...attack, shape: 'circle', range: 6, radius: 2 };
  assert.match(preview(state, { type: 'skill', skillId: 'touch', x: target.x, y: target.y, targetId: target.id }).error, /射程/);
  target.x = 5; target.y = 1;
  assert.ok(!preview(state, { type: 'skill', skillId: 'explosion', x: 3, y: 1 }).targets?.some(row => row.id === target.id));
});

test('summon expiry runs the actual last words while the source unit still exists', () => {
  const { state, actor, others: [summon] } = field();
  Object.assign(summon, { summoned: true, remainingTurns: 1, sourceId: actor.id, team: actor.team });
  actor.rules = [{ id: 'notice', hook: 'on_summon_evict', program: [tag('expired', 'target.name')] }];
  summon.rules = [{ id: 'last', hook: 'on_death', program: [{ op: 'damage', target: { from: 'units', where: 'candidate.team != self.team' }, amount: 1, damageType: 'true', direct: true }] }];
  const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
  const before = enemy.hp;
  advanceVMSpatial(state);
  assert.equal(state.units[summon.id], undefined);
  assert.equal(actor.vars.expired, summon.name);
  assert.equal(enemy.hp, before - 1);
});

test('effective scale and unit fields are scalar and share the same query table', () => {
  const self = { name: '代达罗斯', tier: 5, facing: [1, -1], lastMoveDir: 'N' };
  const context = { self, candidate: { templateId: 'daedalus' }, cellM: 50, effectiveTier: 6 };
  assert.equal(evaluateExpr("self.name == '代达罗斯' && self.moved == 0 && self.facing == 'E' && self.lastMoveDir == 'N' && candidate.templateId == 'daedalus'", context), true);
  assert.equal(evaluateExpr('scale_cells(15)', { ...context, effectiveTier: 5 }), 15);
  assert.equal(evaluateExpr('scale_cells(8)', context), 40);
});
