import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNarrativeExemptions, MAX_NORMALIZATION_REPAIRS, mechanismTerms, normalizationLimit, normalizationRepairAllowed,
  planNormalizationBatches, normalizationOperations, readNarrativeExemptions, runOrderedBatches, runUnitOrderedBatches,
} from '../src/tavern/normalization-batches.js';

import { applyPatch, normalizationPath, parseAIResponse, partitionNormalizationPatch } from '../src/tavern/overlay.js';
import { readFileSync } from 'node:fs';
import { classifyWarnings, existingEffectReceipts, missingDispositions, resolvedDiagnostics, warningKey } from '../src/tavern/resolved-warnings.js';
import { acceptNormalizationResponse, repairWarnings, runNormalizationRepair } from '../src/tavern/normalization-commit.js';

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
  assert.equal(normalizationLimit({}, 'normalizationWarningsPerBatch'), 5);
  assert.equal(normalizationLimit({ normalizationConcurrency: 3 }, 'normalizationConcurrency'), 3);
  assert.equal(normalizationLimit({ normalizationConcurrency: 0 }, 'normalizationConcurrency'), 1);
  assert.equal(normalizationLimit({ normalizationWarningsPerBatch: 99 }, 'normalizationWarningsPerBatch'), 5);
});

test('batch planning keeps each carrier atomic, separates roles, and caps independent warnings', () => {
  const warnings = [warning('a', '/equipment/sword', 'one'), warning('b', '/equipment/bow', 'two'),
    ...Array.from({ length: 5 }, (_, i) => warning('a', `/skills/s${i}`, `independent ${i}`))];
  const batches = planNormalizationBatches(['a', 'b'], warnings, {
    equipment: { sword: {} }, skills: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`s${i}`, {}])),
  }, { maxWarnings: 2 });
  assert.deepEqual(batches[0].warnings.map(item => item.message), ['one', 'independent 0']);
  assert.equal(batches.every(batch => batch.unitIds.length === 1), true);
  assert.deepEqual(batches.filter(batch => batch.unitIds[0] === 'a').map(batch => batch.warnings.length), [2, 2, 2]);
  assert.deepEqual(batches.find(batch => batch.unitIds[0] === 'b').warnings.map(item => item.message), ['two']);
});

test('两个角色确实共用同一载体时不把写同一模板的警告分散到两条泳道', () => {
  const warnings=['a','b'].map(id=>warning(id,'/equipment/shared/rules',id));
  assert.deepEqual(planNormalizationBatches(['a','b'],warnings,{}, {maxWarnings:1}), [{unitIds:['a','b'],warnings}]);
});

test('carrier clusters up to elastic limit stay atomic while larger ones split only at that limit', () => {
  const atomic = Array.from({ length: 8 }, (_, index) => warning('boss', '/equipment/artifact', `effect ${index}`));
  const oversized = Array.from({ length: 19 }, (_, index) => warning('boss', '/equipment/armor', `effect ${index}`));
  const batches = planNormalizationBatches(['boss'], [...atomic, ...oversized], {}, { maxWarnings: 5 });
  assert.deepEqual(batches.map(batch => batch.warnings.length).sort((a, b) => b - a), [8, 5, 5, 5, 4]);
  assert.equal(new Set(batches.flatMap(batch => batch.warnings)).size, 27);
});

test('首批优先定义共享状态的被动；跨批边界保持原文术语亲和，不把零 AP 主动误当核心被动', () => {
  const ids=['a','b','c','z'], state={skills:{a:{ap:0},b:{},c:{},z:{passive:true}}};
  const terms=['【攻击】【位移：4】','无','[冻伤]','「冻伤」'];
  const rawSources={boss:Object.fromEntries(ids.map((id,i)=>[`skills:${id}`,{效果:terms[i]}]))};
  const warnings=ids.map(id=>warning('boss',`/skills/${id}`, '待标准化'));
  for(const maxWarnings of [1,2]) {
    const batches=planNormalizationBatches(['boss'],warnings,state,{maxWarnings,rawSources});
    assert.deepEqual(batches.flatMap(b=>b.warnings).slice(0,2).map(w=>w.originPath),['/skills/z','/skills/c']);
  }
});

test('mechanismTerms extracts only closed bracketed terms and filters generic and structured tags', () => {
  assert.deepEqual([...mechanismTerms(JSON.stringify('「冻伤」[冰封][被动][位移: 4][未闭合「破损]'))], ['冻伤', '冰封']);
});

test('narrative exemptions use unresolved-compatible unique matching and persist only for the same source', () => {
  const w = warning('p1', '/skills/frost/rules', '待标准化「霜冻」：unsupported effect');
  const source = { p1: 'input-a' };
  const { matched: entries } = readNarrativeExemptions([{ unitId: 'p1', originPath: w.originPath, effectName: '霜冻', reason: '保留为纯叙事' }], [w], id => source[id]);
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

test('production acceptance keeps every appended mechanic value for P3 resolution', () => {
  const w1 = warning('u1', '/skills/frost/mods', '基础机制');
  const w2 = warning('u1', '/skills/frost/mods', '追加机制');
  const state = { skills: { frost: { mods: [] } }, statusTemplates: {} };
  const result = acceptNormalizationResponse({
    reply: JSON.stringify({ patch: [
      { op: 'add', path: '/skills/frost/mods', value: [{ stat: 'dr', flat: 1 }], resolves: [w1] },
      { op: 'add', path: '/skills/frost/mods/-', value: { stat: 'speed', flat: 2 }, resolves: [w2] },
    ] }),
    snapshot: structuredClone(state), sent: [w1, w2], unitIds: ['u1'], current: structuredClone(state), baseline: structuredClone(state),
    records: { u1: {} }, validate: () => {}, sourceFor: () => 'source',
  });
  assert.equal(result.changedOperations.length, 2);
  assert.deepEqual(result.solved, [w1, w2]);
  assert.deepEqual(result.next.skills.frost.mods, [{ stat: 'dr', flat: 1 }, { stat: 'speed', flat: 2 }]);
});

test('production acceptance reports shared-template conflict guidance for repair', () => {
  const warningEntry = warning('u1', '/statusTemplates/freeze', '共享状态定义');
  const state = { skills: {}, statusTemplates: { freeze: { name: '冻伤', category: 'debuff', stackMode: 'stack', maxStacks: 3, mods: [{ stat: 'speed' }], rules: [{ hook: 'turn_end' }] } } };
  const result = acceptNormalizationResponse({
    reply: JSON.stringify({ patch: [{ op: 'add', path: '/statusTemplates/freeze', value: { name: '另一个冻伤', mods: [{ stat: 'damage' }] }, resolves: [warningEntry] }] }),
    snapshot: structuredClone(state), sent: [warningEntry], unitIds: ['u1'], current: structuredClone(state), baseline: structuredClone(state),
    createdTemplates: new Map([['/statusTemplates/freeze', JSON.stringify(state.statusTemplates.freeze)]]), records: { u1: {} }, validate: () => {}, sourceFor: () => 'source',
  });
  assert.equal(result.repairWarnings.length, 1);
  assert.match(result.repairError.message, /liveState已有模板摘要/);
  assert.match(result.repairError.message, /若机制一致请删去 add 直接引用/);
});

test('production repair merges rejected and silently missing warnings into one request', async () => {
  const first = warning('u1', '/skills/frost/mods', '被拒');
  const second = warning('u1', '/skills/frost/rules', '遗漏');
  const calls = [];
  let count = 0;
  const result = await runNormalizationRepair({
    batch: { unitIds: ['u1'], warnings: [first, second] }, index: 2, result: { reply: 'initial' },
    commit: (_batch, _reply) => count++ ? { repairWarnings: [], missing: [] } : { repairWarnings: [first], missing: [second] },
    request: async (batch, index, correction) => { calls.push({ batch, index, correction }); return { reply: 'repair' }; },
  });
  assert.equal(result.repairAttempts, 1);
  assert.deepEqual(calls[0].batch.warnings, [first, second]);
  assert.match(calls[0].correction.message, /校验被拒/);
  assert.equal(result.repaired.repairWarnings.length, 0);
  assert.deepEqual(repairWarnings({ repairWarnings: [first], missing: [second] }), [first, second]);
});

test('scene lane preserves legacy non-zone null diagnostics on role batches only', () => {
  const fog = warning(null, '/zones/f1', '雾区');
  const wind = warning(null, '/zones/f2', '乱流');
  const legacy = warning(null, '/equipment/legacy', '场景以外全局诊断');
  const shared = warning('p1', '/skills/shared', '共享命中效果');
  const unrelated = warning('p1', '/skills/unrelated', '无关角色诊断');
  const usesShared = { rules: [{ program: [{ op: 'apply_status', statusId: 'frost' }] }] };
  const state = { zones: { f1: usesShared }, skills: { shared: usesShared } };
  const all = [fog, wind, legacy, shared, unrelated];
  assert.deepEqual(planNormalizationBatches([], all, state, { maxWarnings: 1 }), [
    { unitIds: [], sceneZoneIds: ['f1'], warnings: [fog] }, { unitIds: [], sceneZoneIds: ['f2'], warnings: [wind] },
  ]);
  const planned = planNormalizationBatches(['p1'], all, state, { maxWarnings: 1 });
  assert.deepEqual(planned.find(batch => batch.sceneZoneIds?.includes('f1')), { unitIds: ['p1'], sceneZoneIds: ['f1'], warnings: [fog, shared] });
  assert.deepEqual(planned.filter(batch => !batch.sceneZoneIds).flatMap(batch => batch.warnings), [legacy, unrelated]);
  assert.deepEqual(planNormalizationBatches(['p1'], all, state, { includeScene: false }).flatMap(batch => batch.warnings), [legacy, shared, unrelated]);
});

test('pure and mixed scene batches share the scene lock but allow unrelated roles in parallel', async () => {
  const batches = [
    { id: 'scene1', unitIds: [], sceneZoneIds: ['f1'] },
    { id: 'role', unitIds: ['p2'] },
    { id: 'mixed', unitIds: ['p1'], sceneZoneIds: ['f2'] },
    { id: 'scene2', unitIds: [], sceneZoneIds: ['f3'] },
  ];
  const events = [];
  await runOrderedBatches(batches, 2, async batch => { events.push(`request:${batch.id}`); },
    async (_result, batch) => { events.push(`commit:${batch.id}`); }, new AbortController().signal);
  assert.ok(events.indexOf('request:role') < events.indexOf('commit:scene1'));
  assert.ok(events.indexOf('request:mixed') > events.indexOf('commit:scene1'));
  assert.ok(events.indexOf('request:scene2') > events.indexOf('commit:mixed'));
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

test('unit dependency DAG allows fork branches in parallel and joins after both commits', async () => {
  const batches = [
    { id: 'a1', unitIds: ['a'] }, { id: 'b1', unitIds: ['b'] },
    { id: 'ab2', unitIds: ['a', 'b'] }, { id: 'a3', unitIds: ['a'] },
  ];
  const order = [], live = { a: 0, b: 0 };
  let active = 0, maxActive = 0;
  const controller = new AbortController();
  await runUnitOrderedBatches(batches, 2, async batch => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`request:${batch.id}`);
    await new Promise(resolve => setTimeout(resolve, 3));
    const version = Object.fromEntries(batch.unitIds.map(id => [id, live[id]]));
    active--;
    return version;
  }, async ({ value }, batch) => {
    for (const unitId of batch.unitIds) {
      assert.equal(value[unitId], live[unitId]);
      live[unitId]++;
    }
    order.push(`commit:${batch.id}`);
  }, controller.signal);
  assert.equal(maxActive, 2);
  assert.ok(order.indexOf('request:ab2') > order.indexOf('commit:a1'));
  assert.ok(order.indexOf('request:ab2') > order.indexOf('commit:b1'));
  assert.ok(order.indexOf('request:a3') > order.indexOf('commit:ab2'));
});

test('a lane failure stops new launches and waits for in-flight batches', async () => {
  const batches = [
    { id: 'fail', unitIds: ['a'] }, { id: 'inflight', unitIds: ['b'] },
    { id: 'not-launched', unitIds: ['c'] },
  ];
  const events = [];
  const controller = new AbortController();
  await assert.rejects(runUnitOrderedBatches(batches, 2, async batch => {
    events.push(`request:${batch.id}`);
    if (batch.id === 'fail') throw new Error('request failed');
    await new Promise(resolve => setTimeout(resolve, 5));
    return batch.id;
  }, async (result, batch) => {
    if (result.error) throw result.error;
    events.push(`commit:${batch.id}:${result.value}`);
  }, controller.signal), /request failed/);
  assert.ok(events.includes('commit:inflight:inflight'));
  assert.equal(events.includes('request:not-launched'), false);
});
