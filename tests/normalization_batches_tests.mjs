import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNarrativeExemptions, normalizationLimit, planNormalizationBatches,
  readNarrativeExemptions, runOrderedBatches,
} from '../src/tavern/normalization-batches.js';

const warning = (unitId, originPath, message) => ({ unitId, originPath, message, source: 'mvu', scope: 'effect' });

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
  const entries = readNarrativeExemptions([{ ...w, reason: '保留为纯叙事' }], [w], id => source[id]);
  assert.equal(entries[0].receipt.source, 'input-a');
  assert.equal(activeNarrativeExemptions([w], entries.map(item => item.receipt), id => source[id]).length, 1);
  source.p1 = 'input-b';
  assert.equal(activeNarrativeExemptions([w], entries.map(item => item.receipt), id => source[id]).length, 0);
  assert.throws(() => readNarrativeExemptions([{ ...w, reason: 'ignored' }], [], id => source[id]), /唯一匹配/);
  assert.throws(() => readNarrativeExemptions([{ ...w, reason: 'ignored' }], [w], id => source[id], { solved: [w] }), /冲突/);
  assert.throws(() => readNarrativeExemptions([{ ...w, reason: 'ignored' }], [w], id => source[id], { unresolved: [{ warning: w }] }), /冲突/);
  const other = { ...w, unitId: 'p2' };
  assert.equal(readNarrativeExemptions([{ ...w, reason: 'ignored' }], [w, other], id => source[id], { unresolved: [{ warning: other }] }).length, 1);
  assert.throws(() => readNarrativeExemptions([{ ...w, reason: ' ' }], [w], id => source[id]), /非空/);
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
