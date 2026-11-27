import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { aimedOptions, zoneCellScore } from '../src/core/ai.js';
import { battleAiPayload, requestBattleAi } from '../src/core/battle-ai.js';
import { applyAction, grantStatus, isAiControlled, preview, visibleEnemy } from '../src/core/combat.js';
import { aggregateModifiers } from '../src/core/vm-carriers.js';
import { validVmStatMod } from '../src/core/vm-schema.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { createRenderer } from '../src/ui/render.js';

function field(ruleset = 'protocol') {
  const state = buildScenario({ scenarioId: 'ruins', ruleset });
  state.grid = state.grid.map(row => row.map(() => ({ kind: 'floor', z: 0 })));
  state.covers = {};
  state.interactives = {};
  state.zones = {};
  const [actor, ally, source, sourceAlly] = Object.values(state.units);
  Object.assign(actor, { x: 1, y: 3, team: 'blue', moveM: 12, ap: 2, used: { attack: 0, action: 0 }, skills: [] });
  Object.assign(ally, { x: 2, y: 3, team: 'blue' });
  Object.assign(source, { x: 1, y: 4, team: 'red' });
  Object.assign(sourceAlly, { x: 8, y: 8, team: 'red' });
  state.turn = state.order.indexOf(actor.id);
  return { state, actor, ally, source, sourceAlly };
}

const attack = ({ id, x, y }) => ({ type: 'attack', targetId: id, x, y });
const skill = ({ id, x, y }, skillId) => ({ type: 'skill', skillId, targetId: id, x, y });
const cannotAttackSource = '受魅惑影响，无法攻击施术者';
const tally = (name, expectedSteps) => ({ id: name, hook: 'after_move',
  filter: `self.id == event.actorId && self.moved == ${expectedSteps} && event.steps == ${expectedSteps}`,
  program: [{ op: 'let', name, value: `vars.${name} == null ? 1 : vars.${name} + 1`, scope: 'owner' }] });

function addControl(state, target, source, id, controlPolicy, when) {
  state.statusTemplates[id] = { id, name: id, category: 'control', durationType: 'until_removed',
    mods: [{ controlPolicy, ...(when === undefined ? {} : { when }) }] };
  grantStatus(state, target, id, { sourceId: source.id });
}

function makeSkill(state, actor, id, template) {
  state.skills[id] = { name: id, ap: 1, slot: 'attack', range: 4, shape: 'single', target: 'enemy', ...template };
  actor.skills.push(id);
}

test('trueSight ignores hidden but can be restricted to the modifier event target', () => {
  const { state, actor, source } = field();
  Object.assign(source, { x: 4, y: 3 });
  source.mods = [{ flags: ['hidden'] }];
  makeSkill(state, actor, 'probe', { damage: 10 });
  assert.equal(visibleEnemy(state, actor, source), false);
  assert.match(preview(state, skill(source, 'probe')).error, /隐身/);
  const sight = { flags: ['trueSight'], when: `target.id == '${source.id}'` };
  assert.equal(validVmStatMod(sight), true);
  assert.equal(validVmStatMod({ flags: ['TrueSight'] }), false);
  actor.mods = [sight];
  assert.equal(visibleEnemy(state, actor, source), true);
  assert.equal(preview(state, skill(source, 'probe')).ok, true);
});

test('charm takes the source team for AI, guards every active source, and restores original control on removal', async () => {
  const { state, actor, ally, source, sourceAlly } = field();
  addControl(state, actor, source, 'charm', { mindControl: 'charm' });
  addControl(state, actor, sourceAlly, 'protection', { forbidTargetSource: true });
  addControl(state, actor, ally, 'inactive-protection', { forbidTargetSource: true }, false);
  const { controlPolicy, charmTeam, forbiddenTargetIds } = aggregateModifiers(state, actor.id);
  assert.equal(isAiControlled(state, actor), true);
  assert.equal(controlPolicy.mindControl, 'charm');
  assert.equal(controlPolicy.forbidTargetSource, true);
  assert.equal(charmTeam, 'red');
  assert.deepEqual(forbiddenTargetIds, new Set([source.id, sourceAlly.id]));
  assert.equal(preview(state, attack(source)).error, cannotAttackSource);
  assert.equal(preview(state, attack(ally)).ok, true);
  const options = aimedOptions(state, actor).filter(row => row.action.type === 'attack');
  assert.deepEqual(options.map(row => row.action.targetId), [ally.id]);
  assert.ok(options[0].score > 0);
  assert.deepEqual(await requestBattleAi(state, () => assert.fail('mind control must use deterministic local AI')), []);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  assert.equal(api.stepEnemy().ok, true);
  assert.equal(api.getBattleState().units[actor.id].team, 'blue');
  delete actor.statuses.charm;
  delete actor.statuses.protection;
  assert.equal(actor.team, 'blue');
  assert.equal(isAiControlled(state, actor), false);
  assert.equal(preview(state, attack(source)).ok, true);
  assert.equal(preview(state, attack(ally)).ok, false);
  assert.equal(validVmStatMod({ controlPolicy: { mindControl: 'berserk', forbidTargetSource: true } }), true);
  assert.equal(validVmStatMod({ controlPolicy: { mindControl: 'other' } }), false);
});

test('manual end-turn and AI step switch immediately when an allied unit gains or loses mind control', () => {
  const { state, actor, source } = field();
  const nodes = new Map(['turn-controls', 'turn-order', 'end-turn', 'ai-step'].map(id => [`[id="${id}"]`, {}]));
  const renderer = createRenderer({ querySelector: selector => nodes.get(selector), querySelectorAll: () => [] });
  const disabled = () => ['end-turn', 'ai-step'].map(id => nodes.get(`[id="${id}"]`).disabled);
  renderer.renderControls(state);
  assert.deepEqual(disabled(), [false, true]);
  addControl(state, actor, source, 'frenzy', { mindControl: 'berserk' });
  renderer.renderControls(state);
  assert.deepEqual(disabled(), [true, false]);
  delete actor.statuses.frenzy;
  renderer.renderControls(state);
  assert.deepEqual(disabled(), [false, true]);
});

test('berserk and friendly-fire AI score attacks on either team, not self, while the source is protected from splash', () => {
  const { state, actor, ally, source, sourceAlly } = field();
  addControl(state, actor, source, 'frenzy', { mindControl: 'berserk', forbidTargetSource: true });
  Object.assign(sourceAlly, { x: 1, y: 2 });
  const options = aimedOptions(state, actor).filter(row => row.action.type === 'attack');
  assert.deepEqual(new Set(options.map(row => row.action.targetId)), new Set([ally.id, sourceAlly.id]));
  assert.ok(options.every(row => row.score > 0));
  makeSkill(state, actor, 'splash', { damage: 10, radius: 1.5, shape: 'circle' });
  assert.equal(preview(state, skill(ally, 'splash')).error, cannotAttackSource);
  source.x = 6;
  const open = preview(state, skill(ally, 'splash'));
  assert.equal(open.ok, true);
  assert.ok(open.targets.some(row => row.id === ally.id));
  delete actor.statuses.frenzy;
  actor.mods = [{ controlPolicy: { allowFriendlyTarget: true } }];
  assert.ok(aimedOptions(state, actor).some(row => row.action.targetId === ally.id && row.score > 0));
});

test('zone scoring and external AI payload use zone team first and source team as fallback', () => {
  const { state, actor, source } = field();
  const zone = state.zones.test = { id: 'test', sourceId: source.id, area: { shape: 'board' }, remainingTurns: 2,
    mods: [{ stat: 'movement', flat: -1 }] };
  assert.equal(zoneCellScore(state, actor), -14);
  assert.deepEqual(battleAiPayload(state).battle.zones.map(({ ownerId, ownerTeam }) => [ownerId, ownerTeam]), [[source.id, 'red']]);
  zone.team = 'blue';
  assert.equal(zoneCellScore(state, actor), 0);
  assert.equal(battleAiPayload(state).battle.zones[0].ownerTeam, 'blue');
});

test('native walking refreshes a following rect before an intervening opportunity attack, and a following cells zone too', () => {
  const { state, actor, ally, source, sourceAlly } = field();
  state.grid.forEach((row, y) => row.forEach((cell, x) => {
    if (y !== 3 && !(y === 4 && x === 3)) cell.kind = 'wall';
  }));
  Object.assign(source, { x: 3, y: 4, reactionAvailable: true, mainHand: 'test-spear', weapon: 'test-spear' });
  Object.assign(ally, { x: 8, y: 3 });
  Object.assign(sourceAlly, { x: 9, y: 3, reactionAvailable: false });
  state.items['test-spear'] = { id: 'test-spear', templateId: 'test-spear' };
  state.equipment['test-spear'] = { kind: 'weapon', name: 'spear', range: 1.5, damage: { count: 1, sides: 1, bonus: 1, type: 'physical' } };
  const after = { id: 'reaction-position', hook: 'before_check', filter: 'event.opportunityAttack == true',
    program: [{ op: 'let', scope: 'owner', name: 'followingRectAt', value: 'target.x' }] };
  state.zones.rect = { id: 'rect', sourceId: actor.id, follow: true, anchorPosition: { x: actor.x, y: actor.y },
    area: { shape: 'rect', anchorUnitId: actor.id, rect: { x1: 1, x2: 1, y1: 3, y2: 3 } }, rules: [after] };
  state.zones.cells = { id: 'cells', sourceId: actor.id, follow: true, anchorPosition: { x: actor.x, y: actor.y },
    area: { shape: 'cells', anchorUnitId: actor.id, cells: [{ x: 1, y: 3 }] },
    rules: [{ ...after, id: 'reaction-cells', program: [{ ...after.program[0], name: 'followingCellsAt' }] }] };
  const logs = applyAction(state, { type: 'move', x: 5, y: 3 });
  assert.ok(logs.some(log => log.type === 'opportunity'));
  assert.deepEqual([state.zones.rect.vars?.followingRectAt, state.zones.cells.vars?.followingCellsAt], [3, 3]);
  assert.deepEqual(state.zones.rect.area.rect, { x1: 5, x2: 5, y1: 3, y2: 3 });
  assert.deepEqual(state.zones.cells.area.cells, [{ x: 5, y: 3 }]);
});

test('native push runs after_move exactly once only if the target actually moved', () => {
  const { state, actor, source } = field();
  actor.stats.agi = 100;
  const monitor = tally('pushCount', 1);
  monitor.filter += " && event.moveKind == 'push' && event.fromY == 4 && event.toY == 5 && self.lastMoveDir == 'S'";
  source.rules = [monitor];
  state.zones.follow = { id: 'follow', sourceId: source.id, follow: true, anchorPosition: { x: 1, y: 4 },
    area: { shape: 'cells', anchorUnitId: source.id, cells: [{ x: 1, y: 4 }] }, rules: [tally('zonePush', 1)] };
  const action = { ...attack(source), type: 'push' };
  const blocked = structuredClone(state);
  blocked.grid[5][1].kind = 'wall';
  applyAction(blocked, action);
  assert.equal(blocked.units[source.id].y, 4);
  assert.equal(blocked.units[source.id].vars?.pushCount, undefined);
  applyAction(state, action);
  assert.equal(source.vars?.pushCount, 1);
  assert.equal(state.zones.follow.vars?.zonePush, 1);
  assert.deepEqual(state.zones.follow.area.cells, [{ x: 1, y: 5 }]);
});

for (const mode of ['native', 'step', 'push', 'pull', 'teleport']) test(`${mode} emits one move event; only traversed hazard cells count`, () => {
  const { state, actor, ally, source, sourceAlly } = field();
  Object.assign(actor, { x: 1, y: 3, altitude: 2 });
  for (const [i, unit] of [ally, source, sourceAlly].entries()) Object.assign(unit, { x: 8, y: i + 2 });
  state.grid.forEach((row, y) => row.forEach(cell => { if (y !== 3) cell.kind = 'wall'; }));
  actor.rules = [tally('count', 4)];
  const zone = { sourceId: source.id, area: { shape: 'cells', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }] }, rules: [tally('hazard', 4)] };
  state.zones.a = { ...zone, id: 'a', area: { ...zone.area, z1: 2, z2: 2 } };
  state.zones.b = { ...zone, id: 'b', area: { ...zone.area, z1: 0, z2: 0 } };
  // Stepping through the middle of a 3D circle at the mover's actual height is also contact.
  state.zones.c = { ...zone, id: 'c', area: { shape: 'circle', center: { x: 3, y: 3, z: 2 }, radius: 0.75 } };
  if (mode === 'native') applyAction(state, { type: 'move', x: 5, y: 3 });
  else {
    const to = { x: mode === 'push' ? 0 : 5, y: 3 };
    makeSkill(state, actor, 'movement-test', { target: 'self', range: 0, rules: [{ id: 'move', hook: 'active',
      program: [{ op: 'move', mode, target: 'self', to, distance: 4 }] }] });
    applyAction(state, skill(actor, 'movement-test'));
  }
  assert.deepEqual([actor.x, actor.y, actor.altitude], [5, 3, 2]);
  assert.equal(actor.vars?.count, 1);
  assert.equal(state.zones.a.vars?.hazard, mode === 'teleport' ? undefined : 1);
  assert.equal(state.zones.b.vars?.hazard, undefined);
  assert.equal(state.zones.c.vars?.hazard, mode === 'teleport' ? undefined : 1);
});
