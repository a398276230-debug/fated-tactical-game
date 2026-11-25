import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateState } from '../src/api/validation.js';
import { evaluateExpr } from '../src/core/formula.js';
import { buildScenario } from '../src/presets/scenarios.js';
import {
  opNotes, vmHooks, vmOpcodes, vmSchema, vmOpcodeSchema, vmProgramSchema, vmSelectorSchema, vmStatModSchema,
  flatOnlyStats, askPolicies, EVENT_SCALAR_KEYS, skillShapes, zoneAreaShapes, skillTargets, validVmExpiry, validVmRule, validVmOpcode, validVmProgram, validVmSelector, validVmStatMod, validVmTargetRef, validVmTag,
} from '../src/core/vm-schema.js';

const mutation = patch => ({ op: 'mutate_event', patch });
const rule = (hook, ...program) => ({ id: 'test_rule', hook, program });
const select = { from: 'units', where: 'candidate.alive && candidate.team != self.team' };
const ask = { op: 'ask', chooser: 'self', prompt: '请选择', out: 'choice', aiPolicy: 'first' };
const minimal = {
  let: { name: 'x', value: 0 },
  if: { cond: true, then: [], else: [] },
  for_each: { select, body: [] },
  check: { kind: 'attack' },
  ask: { ...ask, kind: 'option', options: [{ id: 'attack', label: '攻击槽' }] },
  damage: { target: 'target', amount: 2, damageType: 'true' },
  heal: { target: 'target', amount: 1 },
  resource: { target: 'self', pool: ['mp', 'sp'], mode: 'add', amount: 'vars.x' },
  link_pool: { units: select, pools: ['hp'], mode: 'link' },
  apply_status: { target: 'target', statusId: 'freeze', turns: 3, stackMode: 'extend', extendTurns: 1 },
  remove_status: { target: 'self', where: "status.id == 'freeze'" },
  mutate_event: { patch: { preventDeath: true } },
  move: { target: 'self', mode: 'teleport', to: 'vars.choice' },
  spawn: { entityKind: 'unit', spec: { copyOf: 'self', tags: ['illusion', 'harmless'] } },
  despawn: { entityKind: 'zone', select: { from: 'zones' } },
  revive: { target: 'target', hpPercent: 1 },
  perform: { actor: 'self', actionKind: 'skill', skillId: 'winter_sword', overrides: { free: true } },
};

test('event fields are closed while runtime missing event values remain nullable', () => {
  assert.equal(validVmRule(rule('after_damage', { op: 'damage', target: 'target', amount: 'event.dmgType', damageType: 'true' })), false);
  assert.equal(validVmStatMod({ stat: 'checkBonus', flat: 'event.dmgType' }), false);
  assert.ok(EVENT_SCALAR_KEYS.includes('damageType'));
  assert.equal(validVmRule(rule('after_damage', { op: 'damage', target: 'target', amount: 'event.damageScale', damageType: 'true' })), true);
  assert.equal(evaluateExpr('event.missing == event.other', { event: {} }), null);
});

test('intent is a read-only strike scalar; intentBonus accepts only flat modifiers', () => {
  const when = "event.intent == 'core'";
  assert.ok(validVmStatMod({ stat: 'intentBonus', flat: 5, when }));
  assert.ok(flatOnlyStats.includes('intentBonus'));
  assert.ok(validVmRule({ ...rule('after_hit', { op: 'heal', ...minimal.heal }), filter: when }));
  assert.equal(validVmOpcode(mutation({ intent: 'kill' })), false);
  assert.equal(evaluateExpr(when, { event: { intent: 'core' } }), true);
  for (const op of ['==', '!=']) assert.equal(evaluateExpr(`event.intent ${op} 'normal'`, { event: {} }), null);
  assert.equal(evaluateExpr('event.intent == null', { event: {} }), true);
});

test('skill and zone shape enums stay separated and corpse remains a valid target', () => {
  assert.equal(skillShapes.includes('rect'), false);
  assert.deepEqual(zoneAreaShapes, ['single', 'circle', 'ring', 'rect', 'cells', 'board']);
  assert.equal(skillTargets.includes('corpse'), true);
});

test('carrier sharing permits only pure selectors in validated state', () => {
  const state = buildScenario('ruins');
  const unit = state.units[state.order[0]];
  unit.shareRulesTo = { from: 'units', pick: { first: 1 } };
  assert.doesNotThrow(() => validateState(state));
  unit.shareRulesTo.pick = { random: 1 };
  assert.throws(() => validateState(state), /shareRulesTo/);
});

test('expiry, flat-only modifiers and ask policies enforce their schema contracts', () => {
  assert.equal(validVmExpiry([{ hook: 'turn_end' }, { hook: 'after_hit', filter: 'target.id == self.id' }]), true);
  for (const invalid of [[], { hook: 'missing' }, { hook: 'turn_end', extra: true }]) assert.equal(validVmExpiry(invalid), false);
  for (const stat of flatOnlyStats.filter(name => vmStatModSchema.$defs.statMod.properties.stat.enum.includes(name))) {
    assert.equal(validVmStatMod({ stat, flat: 1 }), true);
    assert.equal(validVmStatMod({ stat, mult: 2 }), false);
    assert.equal(validVmStatMod({ stat, additivePercent: .2 }), false);
  }
  const specs = { number: { min: 0, max: 2 }, cell: { select: { from: 'cells' } }, entity: { select }, option: { options: [{ id: 'yes', label: '确认' }] } };
  for (const [kind, fields] of Object.entries(specs)) {
    for (const aiPolicy of new Set(Object.values(askPolicies).flat())) {
      assert.equal(validVmOpcode({ ...ask, ...fields, kind, aiPolicy }), askPolicies[kind].includes(aiPolicy), `${kind}/${aiPolicy}`);
    }
  }
});

test('all 17 opcodes have closed shapes and generated Chinese descriptions', () => {
  assert.deepEqual(vmOpcodes, Object.keys(minimal));
  assert.deepEqual(Object.keys(opNotes), vmOpcodes);
  assert.equal(vmOpcodes.length, 17);
  for (const schema of vmOpcodeSchema.$defs.opcode.oneOf) {
    const op = schema.properties.op.const;
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.description, opNotes[op]);
    assert.match(schema.description, /\p{Script=Han}/u);
    const instruction = { op, ...minimal[op], enabled: false, label: '说明' };
    assert.equal(validVmOpcode(instruction), true, op);
    assert.equal(validVmOpcode({ ...instruction, extra: 1 }), false, op);
    for (const key of schema.required) {
      const incomplete = { ...instruction };
      delete incomplete[key];
      assert.equal(validVmOpcode(incomplete), false, `${op}.${key}`);
    }
  }
  assert.equal(validVmOpcode({ kind: 'damage', target: 'target', amount: 2 }), false);
  assert.equal(validVmOpcode({ op: 'unknown', amount: 2 }), false);
  assert.equal(validVmOpcode({ op: 'damage', ...minimal.damage, amount: Infinity }), false);
  assert.equal(validVmOpcode({ op: 'damage', ...minimal.damage, amount: { ref: 'power' } }), false);
  assert.equal(validVmOpcode({ op: 'damage', ...minimal.damage, amount: '   ' }), false);
  for (const stat of ['checkBonus', 'initiativeFlat']) {
    assert.ok(validVmStatMod({ stat, flat: 3 }));
    assert.equal(validVmStatMod({ stat, mult: 2 }), false);
    assert.equal(validVmStatMod({ stat, additivePercent: 0.5 }), false);
  }
  assert.equal(validVmProgram(Array(1)), false);
  const cycle = { op: 'if', cond: true, then: [] };
  cycle.then.push(cycle);
  assert.equal(validVmProgram([cycle]), false);
});

test('generated roots serialize with local references and complete definitions', () => {
  for (const [schema, root] of [[vmSchema, 'rule'], [vmProgramSchema, 'program'], [vmOpcodeSchema, 'opcode'],
    [vmSelectorSchema, 'selector'], [vmStatModSchema, 'statMod']]) {
    const serialized = JSON.parse(JSON.stringify(schema));
    assert.equal(serialized.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(serialized.$ref, `#/$defs/${root}`);
    for (const match of JSON.stringify(serialized).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)) {
      assert.ok(Object.hasOwn(serialized.$defs, match[1]), match[1]);
    }
  }
});

test('selectors, entity shorthand and shared tags are closed', () => {
  assert.equal(validVmSelector({ from: 'statuses', of: 'attacker', area: { shape: 'ring', origin: { x: 1, y: 2 }, radius: 3, innerRadius: 1 }, pick: { nearest: 2 } }), true);
  assert.equal(validVmSelector({ from: 'units', of: 'self' }), false);
  assert.equal(validVmSelector({ from: 'units', pick: { first: 2, random: 1 } }), false);
  assert.equal(validVmSelector({ from: 'units', pick: { random: 0 } }), false);
  assert.equal(validVmSelector({ from: 'units', area: { shape: 'circle', origin: { x: 1 } } }), false);
  assert.equal(validVmSelector({ from: 'units', extra: [] }), false);
  assert.equal(validVmSelector('self'), false);
  assert.equal(validVmTargetRef('self'), true);
  assert.equal(validVmTargetRef('enemy'), false);
  assert.equal(validVmTag('black_snow-domain0'), true);
  assert.equal(validVmTag('Black Snow'), false);
});

test('hook authorization follows every nested branch and checks patch value types', () => {
  const allowed = mutation({ finalAmount: 'vars.diverted', preserveLife: true });
  for (const wrapper of [
    inner => ({ op: 'if', cond: true, then: [inner] }),
    inner => ({ op: 'if', cond: false, then: [], else: [inner] }),
    inner => ({ op: 'for_each', select, body: [inner] }),
    inner => ({ op: 'check', kind: 'attack', onPass: [inner] }),
    inner => ({ op: 'check', kind: 'attack', onFail: [inner] }),
    inner => ({ op: 'move', target: 'self', mode: 'push', onCollide: [inner] }),
  ]) {
    assert.equal(validVmRule(rule('before_commit', wrapper(allowed))), true);
    assert.equal(validVmRule(rule('before_target', wrapper(allowed))), false);
    assert.equal(validVmRule(rule('after_action', wrapper(allowed))), false);
  }
  for (const hook of vmHooks) {
    assert.equal(validVmRule(rule(hook)), true, hook);
  }
  assert.equal(validVmRule(rule('invented')), false);
  assert.equal(validVmRule(rule('before_commit', mutation({ finalAmount: true }))), false);
  assert.equal(validVmRule(rule('before_status', mutation({ cancel: true }))), true);
  assert.equal(validVmRule(rule('on_lethal_p1', mutation({ preventDeath: true }))), false);
  assert.equal(validVmRule(rule('on_lethal_p2', mutation({ preventDeath: true }))), true);
  assert.equal(validVmRule(rule('before_target', mutation({ replaceTarget: { from: 'u1', to: 'vars.redirected' } }))), true);
  assert.equal(validVmRule(rule('before_commit', mutation({ cancel: true, preventDeath: true }))), false);
  assert.equal(validVmProgram([allowed], { hook: 'before_commit' }), true);
  assert.equal(validVmOpcode(allowed, { hook: 'after_check' }), false);
  assert.equal(validVmOpcode(mutation({})), false);
  const spawn = { op: 'spawn', entityKind: 'zone', spec: { area: { shape: 'board' }, rules: [rule('before_commit', allowed)] } };
  assert.equal(validVmRule(rule('active', spawn)), true);
  assert.equal(validVmRule(rule('before_commit', { ...spawn, spec: { ...spawn.spec, rules: [rule('after_action', allowed)] } })), false);
});

test('conditional operand shapes match ask, resource, perform and spawn modes', () => {
  assert.equal(validVmOpcode({ ...ask, kind: 'cell', select: { from: 'cells', area: { shape: 'circle', radius: 3 } } }), true);
  assert.equal(validVmOpcode({ ...ask, kind: 'number', min: 0, max: 'event.finalAmount' }), true);
  assert.equal(validVmOpcode({ ...ask, kind: 'number', min: 0 }), false);
  assert.equal(validVmOpcode({ ...ask, kind: 'option', options: [{ id: 'a', label: 'A', extra: 1 }] }), false);
  assert.equal(validVmOpcode({ ...ask, kind: 'entity', select, min: 0 }), false);
  const swap = { op: 'resource', target: 'self', pool: 'hp', mode: 'swap', otherPool: 'sp' };
  assert.equal(validVmOpcode(swap), true);
  assert.equal(validVmOpcode({ ...swap, pool: ['hp', 'mp'] }), false);
  assert.equal(validVmOpcode({ ...swap, cap: 100 }), false);
  assert.equal(validVmOpcode({ ...swap, mode: 'add', amount: 1 }), false);
  assert.equal(validVmOpcode({ op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord: 'vars.action' }), true);
  assert.equal(validVmOpcode({ op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord: 'vars.constructor' }), false);
  assert.equal(validVmOpcode({ op: 'perform', actor: 'self', actionKind: 'skill' }), false);
  assert.equal(validVmOpcode({ op: 'perform', actor: 'self', actionKind: 'attack' }), true);
  assert.equal(validVmOpcode({ op: 'perform', actor: 'self', actionKind: 'attack', overrides: { charged: true } }), false);
  for (const [entityKind, spec] of Object.entries({ unit: { name: '镜像', spawnPanel: {} }, zone: { area: { shape: 'board' } },
    terrain: { kind: 'wall' }, cover: { hp: 10 }, item: { templateId: 'vial', count: 2 } })) {
    assert.equal(validVmOpcode({ op: 'spawn', entityKind, spec, at: { x: 1, y: 2, z: 0 } }), true, entityKind);
    assert.equal(validVmOpcode({ op: 'spawn', entityKind, spec: { ...spec, unknown: true } }), false, entityKind);
  }
  assert.equal(validVmOpcode({ op: 'spawn', entityKind: 'item', spec: { copyOf: 'self' } }), false);
  const zone = { op: 'spawn', entityKind: 'zone' };
  for (const shape of ['circle', 'ring']) {
    assert.equal(validVmOpcode({ ...zone, spec: { area: { shape, radius: 2 } } }), true);
    assert.equal(validVmOpcode({ ...zone, spec: { area: { shape } } }), false);
  }
  assert.equal(validVmOpcode({ ...zone, spec: { area: { shape: 'board' }, unitPools: { souls: { cap: 1 } } } }), false);
});

test('rule qualifiers, declaration modifiers and context validation share the closed definitions', () => {
  assert.equal(validVmStatMod({ stat: 'healingMult', mult: '1/3', when: "in_zone(self, 'darkness')" }), true);
  assert.equal(validVmStatMod({ locks: ['move'], flags: ['blockRevive'], controlPolicy: { intentLock: 'kill', allowFriendlyTarget: true, moraleLock: 'steady' } }), true);
  assert.equal(validVmStatMod({ locks: ['revive'] }), false);
  for (const controlPolicy of [{}, { controller: 'ai' }, { allegiance: 'friendly_only' }, { forcedActionKinds: ['attack'] }]) {
    assert.equal(validVmStatMod({ controlPolicy }), false);
  }
  assert.equal(validVmStatMod({ flags: ['harmless'], flat: 2 }), false);
  assert.equal(validVmStatMod({ stat: 'armor', wrongKey: 1 }), false);
  const apply = { op: 'apply_status', target: 'self', statusId: 'fading_glimmer', turns: 1 };
  assert.equal(validVmOpcode(apply), false);
  assert.equal(validVmOpcode(apply, { statusTemplates: { fading_glimmer: {} } }), true);
  assert.equal(validVmOpcode({ ...apply, vars: JSON.parse('{"__proto__": 1}') }, { statusTemplates: { fading_glimmer: {} } }), false);
  const bad = { ...rule('active'), filter: 'invalid!' };
  assert.equal(validVmRule(bad), false);
  assert.equal(validVmRule({ ...bad, filter: 'self.alive', usesPerBattle: 2, dedupeKey: 'skill:rule', priority: -1, enabled: false }), true);
  assert.equal(validVmRule({ ...rule('active'), usesPerBattle: -1 }), false);
});

test('the Reburn corpus rule validates against the production expression parser', () => {
  const reburn = {
    id: 'reburn_lethal', label: '复燃', hook: 'on_lethal_p2', usesPerBattle: 2,
    filter: 'target.id == self.id',
    program: [
      mutation({ preventDeath: true }),
      { op: 'resource', target: 'self', pool: 'hp', mode: 'set', amount: 1 },
      { op: 'apply_status', target: 'self', statusId: 'fading_glimmer', turns: 1 },
      { op: 'perform', actor: 'self', actionKind: 'skill', skillId: 'withered_fire_rain', overrides: { free: true, ignoreSlots: true } },
      { op: 'remove_status', target: 'self', where: "status.id == 'fading_glimmer'" },
      { op: 'resource', target: 'self', pool: ['hp', 'mp', 'sp'], mode: 'set', amount: "pool == 'hp' ? self.maxHp : (pool == 'mp' ? self.maxMp : self.maxSp)" },
    ],
  };
  assert.equal(validVmRule(reburn, { statusTemplates: { fading_glimmer: {} } }), true);
  assert.equal(validVmRule(reburn), false);
});
