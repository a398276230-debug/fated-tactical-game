import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNarrativeExemptions, MAX_NORMALIZATION_REPAIRS, normalizationLimit, normalizationRepairAllowed,
  planNormalizationBatches, normalizationOperations, readNarrativeExemptions, runOrderedBatches,
} from '../src/tavern/normalization-batches.js';

import { applyPatch, normalizationPath, parseAIResponse, partitionNormalizationPatch } from '../src/tavern/overlay.js';
import { readFileSync } from 'node:fs';
import { classifyWarnings, existingEffectReceipts, missingDispositions, resolvedDiagnostics, warningKey } from '../src/tavern/resolved-warnings.js';

const warning = (unitId, originPath, message) => ({ unitId, originPath, message, source: 'mvu', scope: 'effect' });

test('empty patch with prose claiming existing work has no machine-readable coverage', () => {
  const response = parseAIResponse(JSON.stringify({ patch: [], unresolved: [], narrative: [],
    text: '已完成标准化，无需重复写入。' }));
  const sent = [warning('e2', '/equipment/crossbow', '装备效果待标准化：强劲弓弦与精准照门')];
  const solved = resolvedDiagnostics(sent, { e2: {} }, response.data.patch);
  assert.equal(response.data.existing, undefined);
  assert.deepEqual(missingDispositions(sent, solved, [], []), sent);
});

test('normalization repair policy is exactly one pass and never repairs explicit unresolved output', () => {
  assert.equal(MAX_NORMALIZATION_REPAIRS, 1);
  assert.equal(normalizationRepairAllowed(), true);
  assert.equal(normalizationRepairAllowed({ attempts: 1 }), false);
  assert.equal(normalizationRepairAllowed({ explicitUnresolved: true }), false);
});

test('real armor operations with no receipts are incomplete, unique scoped receipts account for them without guessing', () => {
  const { armorPatch, templateOnlyPaths } = JSON.parse(readFileSync(new URL('./fixtures/arena-missing-receipts.json', import.meta.url)));
  const path = armorPatch[0].path.split('/').slice(0, 3).join('/');
  const titles = ['微弱法则[精金壁垒]', '微弱法则[黑雾虚化]', '微弱法则[不朽骨座]'];
  const sent = titles.map(t => warning('a1', path, `装备效果待标准化「${t}」：描述。请用 VM rules / mods / pools 实现`));
  const solve = (ops, list = sent) => resolvedDiagnostics(list, { a1: {} }, ops);
  assert.deepEqual(missingDispositions(sent, solve(armorPatch), [], []), sent);
  const refs = titles.map(effectName => ({ unitId: 'a1', originPath: path, effectName }));
  const fixed = armorPatch.map((op,i) => ({ ...op, resolves: i ? refs.slice(2) : refs.slice(0,2) }));
  assert.deepEqual(missingDispositions(sent, solve(fixed), [], []), []);
  assert.deepEqual(solve(fixed, [...sent, { ...sent[0], message: sent[0].message + '！' }]), sent.slice(1));
  const skills = [12,13].map(i => warning('a1', `/skills/skill-a1-7t47mv-${i}`, '未挂载'));
  assert.deepEqual(missingDispositions(skills, solve(templateOnlyPaths.map(path => ({ op: 'add', path })), skills), [], []), skills);
});

test('existing armor receipt requires a previous write on the exact live mechanic; no fake no-op required', () => {
  const path = '/equipment/armor', mod = {stat:'dr',flat:0.15};
  const w = warning('a1',path,'装备效果待标准化「不朽骨座」：DR+15%');
  const ref = { unitId:'a1',originPath:path,effectName:'不朽骨座',path:`${path}/mods/0`,value:mod };
  const origin = {equipment:{armor:{mods:[]}}}, applied = {equipment:{armor:{mods:[mod]}}};
  const fp = (s,p) => JSON.stringify(p.slice(1).split('/').reduce((o,k)=>o?.[k],s));
  assert.equal(existingEffectReceipts([ref],[w],origin,applied,applied,fp)[0].warning,w);
  for (const [base,persisted,current] of [[applied,applied,applied],[origin,origin,applied],[origin,applied,origin]]) {
    assert.throws(()=>existingEffectReceipts([ref],[w],base,persisted,current,fp));
  }
  assert.throws(()=>existingEffectReceipts([{...ref,value:{stat:'dr',flat:.3}}],[w],origin,applied,applied,fp));
});

test('normalization settings enforce defaults and bounded positive integers', () => {
  assert.equal(normalizationLimit({}, 'normalizationConcurrency'), 1);
  assert.equal(normalizationLimit({}, 'normalizationWarningsPerBatch'), 6);
  assert.equal(normalizationLimit({ normalizationConcurrency: 3 }, 'normalizationConcurrency'), 3);
  assert.equal(normalizationLimit({ normalizationConcurrency: 0 }, 'normalizationConcurrency'), 1);
  assert.equal(normalizationLimit({ normalizationWarningsPerBatch: 99 }, 'normalizationWarningsPerBatch'), 6);
});

test('batch planning keeps shared equipment dependents together and caps independent warnings', () => {
  const warnings = [warning('a', '/equipment/sword', 'one'), warning('b', '/equipment/sword', 'two'),
    ...Array.from({ length: 5 }, (_, i) => warning(`u${i}`, `/skills/s${i}`, `independent ${i}`))];
  const batches = planNormalizationBatches(['a', 'b', 'u0', 'u1', 'u2', 'u3', 'u4'], warnings, {
    equipment: { sword: {} }, skills: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`s${i}`, {}])),
  }, { maxWarnings: 2 });
  assert.deepEqual(batches[0].warnings.map(item => item.message), ['one', 'two']);
  assert.deepEqual(batches.slice(1).map(batch => batch.warnings.length), [2, 2, 1]);
});

test('a single oversized equipment entry still respects the configured warning ceiling', () => {
  const warnings = Array.from({ length: 48 }, (_, index) => warning('boss', '/equipment/artifact', `effect ${index}`));
  const batches = planNormalizationBatches(['boss'], warnings, {}, { maxWarnings: 6 });
  assert.deepEqual(batches.map(batch => batch.warnings.length), Array(8).fill(6));
  assert.equal(new Set(batches.flatMap(batch => batch.warnings)).size, 48);
});

test('narrative exemptions must uniquely match sent warnings and persist only for the same source', () => {
  const w = warning('p1', '/skills/frost/rules', 'unsupported effect');
  const source = { p1: 'input-a' };
  const { matched: entries } = readNarrativeExemptions([{ ...w, reason: '保留为纯叙事' }], [w], id => source[id]);
  assert.equal(entries[0].receipt.source, 'input-a');
  assert.equal(activeNarrativeExemptions([w], entries.map(item => item.receipt), id => source[id]).length, 1);
  source.p1 = 'input-b';
  assert.equal(activeNarrativeExemptions([w], entries.map(item => item.receipt), id => source[id]).length, 0);
  const entry = { ...w, reason: 'ignored' };
  assert.match(readNarrativeExemptions([entry], [], id => source[id]).invalid[0], /唯一匹配/);
  assert.match(readNarrativeExemptions([entry], [w], id => source[id], { solved: [w] }).invalid[0], /冲突/);
  assert.match(readNarrativeExemptions([entry], [w], id => source[id], { unresolved: [{ warning: w }] }).invalid[0], /冲突/);
  const other = { ...w, unitId: 'p2' };
  const partial = readNarrativeExemptions([{ ...w, reason: ' ' }, entry], [w, other], id => source[id], { unresolved: [{ warning: other }] });
  assert.equal(partial.matched.length, 1);
  assert.equal(partial.invalid.length, 1);
});

test('warning groups are exclusive and select only pending work for the default queue', () => {
  const adjusted = { ...warning(null, undefined, '起点已避让'), kind: 'auto_adjusted' };
  const [pending, approx, attention, ignored] = ['待编译', '近似', '缺数值', '制作'].map((message, i) => warning('p1', `/skills/s${i}`, message));
  const all = [adjusted, pending, approx, attention, ignored];
  const store = JSON.parse(JSON.stringify({ notes: { p1: {
    [warningKey(approx)]: { source: 'original', reason: '可用', evidence: [['/skills/s1/rules', 'live']] },
    [warningKey(attention)]: { source: 'original', reason: '缺伤害数值', kind: 'missing_info' },
  } }, exemptions: [{ unitId: 'p1', key: warningKey(ignored), source: 'original', reason: '玩家忽略', dismissed: true }] }));
  const bindings = { ...store, sourceFor: () => 'original', fingerprint: () => 'live' };
  const groups = classifyWarnings(all, bindings);
  assert.deepEqual(groups.autoAdjusted, [adjusted]);
  assert.deepEqual(groups.pending, [pending]);
  assert.equal(groups.approximated[0].warning, approx);
  assert.equal(groups.needsAttention[0].warning, attention);
  assert.equal(groups.nonCombat[0].warning, ignored);
  assert.deepEqual(planNormalizationBatches(['p1', 'p2'], [adjusted, ...groups.pending], {}), [{ unitIds: ['p1'], warnings: [pending] }]);
  assert.deepEqual(planNormalizationBatches(['p1'], [adjusted], {}), []);
  assert.deepEqual(classifyWarnings(all, { ...bindings, exemptions: [], fingerprint: () => undefined }).pending, [pending, approx, ignored]);
});

test('normalization accepts pool definitions and rejects direct and whole-instance pool writes', () => {
  const state = { equipment: { blade: {} }, items: { blade: {}, bound: { pools: { charge: 'runtime-id' } } } };
  const paths = ['/units/u1/pools', '/items/blade/pools', '/items/blade/pools/charge'];
  for (const path of paths) assert.equal(normalizationPath.test(path), false, path);
  assert.equal(normalizationPath.test('/skills/s1/pools/charge'), true);
  const rawPatch = [...paths.map(path => ({ op: 'add', path, value: {} })),
    { op: 'replace', path: '/items/blade', value: { pools: { charge: 'invalid' } } },
    { op: 'replace', path: '/items/bound', value: {} },
    { op: 'add', path: '/equipment/blade/pools', value: { charge: { cap: 5 } } }];
  const result = partitionNormalizationPatch({ liveState: state, baselineState: state, rawPatch });
  assert.equal(result.rejected.length, 5);
  assert.deepEqual(result.workLive.equipment.blade.pools, { charge: { cap: 5 } });
});

test('simultaneous batches reuse the first shared definition and retain both skill programs', async () => {
  const snapshot = { statusTemplates: {}, skills: {} };
  const current = { statusTemplates: { freeze: { id: 'freeze', name: '冰冻' } }, skills: {} };
  const created = new Map([['/statusTemplates/freeze', JSON.stringify(current.statusTemplates.freeze)]]);
  const fingerprint = (state, path) => {
    const value = path.slice(1).split('/').reduce((entry, key) => entry?.[key], state);
    return value === undefined ? undefined : JSON.stringify(value);
  };
  const add = { op: 'add', path: '/statusTemplates/freeze', value: current.statusTemplates.freeze };
  assert.throws(() => normalizationOperations([add], snapshot, current, new Map(), fingerprint), /修改/);
  created.clear();
  let live = structuredClone(snapshot);
  await runOrderedBatches(['a','b'], 2, async skill => ({ snapshot: structuredClone(live), patch: [
    { ...add, value: { ...add.value, name: `冰冻-${skill}` } },
    { op: 'add', path: `/skills/${skill}`, value: { rules: [{ id: 'ice', hook: 'active', program: [{ op: 'apply_status', target: 'target', statusId: 'freeze' }] }] } },
  ] }), async ({ value }) => {
    const effective = normalizationOperations(value.patch, value.snapshot, live, created, fingerprint);
    live = applyPatch(live, effective, true);
    for (const op of effective) created.set(op.path, fingerprint(live, op.path));
  }, new AbortController().signal);
  assert.equal(live.statusTemplates.freeze.name, '冰冻-a');
  assert.deepEqual(Object.keys(live.skills), ['a','b']);
});

test('a mechanic write cannot implicitly resolve sibling warnings on the same template', () => {
  const sent = ['A','B','C','D'].map(name => warning('u', '/skills/ice', name));
  sent.push(warning('u', '/skills/fire', 'E'));
  const options = { narrative: [{ warning: sent[3] }] };
  const solve = patch => resolvedDiagnostics(sent, { u: {} }, patch, [{ warning: sent[2] }], options);
  const operation = { op: 'add', path: '/skills/ice/rules/-' };
  assert.deepEqual(solve([operation]), []);
  assert.deepEqual(solve([{ ...operation, resolves: sent }]), [sent[0], sent[1]]);
});

test('concurrent requests commit deterministically by batch order', async () => {
  const batches = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const order = [];
  const controller = new AbortController();
  await runOrderedBatches(batches, 2, async batch => {
    await new Promise(resolve => setTimeout(resolve, batch.id === 0 ? 10 : 1));
    order.push(`request${batch.id}`);
    return batch.id;
  }, async ({ value }, batch) => order.push(`commit${batch.id}:${value}`), controller.signal);
  assert.deepEqual(order.filter(entry => entry.startsWith('commit')), ['commit0:0', 'commit1:1', 'commit2:2']);
  assert.ok(order.indexOf('request1') < order.indexOf('commit0:0'));
});
