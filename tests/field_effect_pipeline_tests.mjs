import assert from 'node:assert/strict';
import test from 'node:test';
import { validateState } from '../src/api/validation.js';
import { parseBattleInit, hydrateFromSources } from '../src/tavern/converter.js';
import { acceptNormalizationResponse } from '../src/tavern/normalization-commit.js';
import { activeNarrativeExemptions, planNormalizationBatches } from '../src/tavern/normalization-batches.js';
import { applyPatch, fingerprintAt, formatRejectedItem, normalizationPath, partitionNormalizationPatch } from '../src/tavern/overlay-patch.js';
import { normalizationTransactions, replayNormalization } from '../src/tavern/normalization-replay.js';
import { hasPendingSceneWarnings, isSceneZoneWarning, normalizationCandidates, remainingDiagnostics, warningEntryKey } from '../src/tavern/resolved-warnings.js';

function opening(description = '每回合初赋予冻伤', flavorId = 'f9') {
  return hydrateFromSources({ battleInit: parseBattleInit(`<battle_init>
battle|1|mist|风暴海岸|flat
unit|p1|blue|char_info|守卫|1,1
unit|e1|red|char_info|来客|3,3
效果|f1|红|幻雾海蚀：${description}|全场(0-2)
效果|${flavorId}|全体|海风：空气里有咸味|全场
</battle_init>`) });
}

const replayOptions = { apply: applyPatch, validate: validateState, fingerprint: fingerprintAt };
const records = { p1: { entryHashes: { unit: 'guard' } }, e1: { entryHashes: { unit: 'visitor' } } };
const accept = ({ state }, sent, data, options = {}) => acceptNormalizationResponse({
  reply: JSON.stringify(data), snapshot: state, sent, unitIds: [], current: state, baseline: state, records, validate: validateState, ...options,
});
const transactions = (accepted, recordSet = records) => normalizationTransactions({ ...accepted, records: recordSet, fingerprint: fingerprintAt });
const mod = { stat: 'dodge', flat: -2, when: "self.team == 'red'" };
const status = { id: 'mist_chill', name: '冻伤', category: 'debuff', stackMode: 'refresh', maxStacks: 1 };
const rule = { id: 'mist_chill', hook: 'turn_start', filter: "self.team == 'red'", program: [{ op: 'apply_status', target: 'self', statusId: status.id }] };
const mechanic = warning => [
  { op: 'add', path: '/statusTemplates/mist_chill', value: status },
  { op: 'replace', path: '/zones/f1/rules', value: [rule], resolves: [{ unitId: null, originPath: warning.originPath, effectName: '幻雾海蚀' }] },
  { op: 'replace', path: '/zones/f1/mods', value: [mod] },
];

test('hydrated scene diagnostics create scene-only batches; immutable or absent zones cannot be patched', () => {
  const { state, warnings } = opening();
  const scene = warnings.filter(isSceneZoneWarning);
  assert.deepEqual(scene.map(warningEntryKey), ['zones:f1', 'zones:f9']);
  assert.deepEqual(normalizationCandidates(records, {}, scene), []);
  assert.equal(hasPendingSceneWarnings(scene), true);
  assert.deepEqual(planNormalizationBatches([], scene, state), [{ unitIds: [], sceneZoneIds: ['f1', 'f9'], warnings: scene }]);
  assert.deepEqual(planNormalizationBatches([], scene, state, { includeScene: false }), []);
  const allowed = [
    { op: 'replace', path: '/zones/f1/rules', value: [] },
    { op: 'add', path: '/zones/f1/mods/-', value: mod },
    { op: 'replace', path: '/zones/f1/persistent', value: false },
    { op: 'replace', path: '/zones/f1/remainingTurns', value: 3 },
  ];
  const denied = ['/zones/f1', '/zones/f1/id', '/zones/f1/area', '/zones/f1/pools', '/zones/f1/description', '/zones/f1/sourceId', '/zones/f1/team', '/zones/ghost/rules'];
  assert.ok(allowed.every(({ path }) => normalizationPath.test(path)));
  assert.ok(denied.slice(0, -1).every(path => !normalizationPath.test(path)));
  const rawPatch = [...allowed, ...denied.map(path => ({ op: 'add', path, value: [] }))];
  const result = partitionNormalizationPatch({ liveState: state, baselineState: state, rawPatch, validate: validateState });
  assert.deepEqual(result.accepted.map(item => item.op), allowed);
  assert.deepEqual(result.rejected.map(item => item.path), denied);
  assert.match(formatRejectedItem(result.rejected.at(-1)), /战场效果.*目标战场区域不存在/);
});

test('scene receipts require the changed host, and replay restores only unchanged source with all dependencies', () => {
  const first = opening();
  const [fog, wind] = first.warnings.filter(isSceneZoneWarning);
  const patch = mechanic(fog);
  const onlyDefinition = accept(first, [fog], { patch: [{ ...patch[0], resolves: patch[1].resolves }] });
  assert.deepEqual(onlyDefinition.solved, []);
  const accepted = accept(first, [fog], { patch });
  assert.deepEqual(accepted.solved, [fog]);
  const [batch, ...others] = transactions(accepted);
  assert.deepEqual(others, []);
  assert.equal(batch.sceneBound, true);
  assert.deepEqual(batch.entries, []);
  const same = opening();
  const replay = replayNormalization(same.state, [batch], {}, same.warnings, replayOptions);
  assert.deepEqual(replay.kept, [batch]);
  assert.deepEqual(replay.state.zones.f1.mods, [mod]);
  assert.deepEqual(replay.state.statusTemplates.mist_chill, status);
  assert.deepEqual(remainingDiagnostics([fog, wind], {}, {}, replay.kept), [wind]);
  const edited = opening('仅作远程掩护');
  const invalidated = replayNormalization(edited.state, [batch], records, edited.warnings, replayOptions);
  assert.deepEqual(invalidated.kept, []);
  assert.deepEqual(invalidated.state.zones.f1.rules, []);
  assert.equal(invalidated.state.statusTemplates.mist_chill, undefined);
  const reset = replayNormalization(same.state, [], records, same.warnings, replayOptions);
  assert.deepEqual(reset.state.zones.f1.mods, []);
  assert.deepEqual(remainingDiagnostics([fog, wind], {}, {}, reset.kept), [fog, wind]);

  const existing = { ...patch[1].resolves[0], path: '/zones/f1/rules/0', value: rule };
  const verified = accept(first, [fog], { existing: [existing] }, { current: accepted.next, snapshot: accepted.next, existingOps: accepted.patch });
  assert.deepEqual(verified.solved, [fog]);
  assert.deepEqual(verified.verified.map(({ path }) => path), ['/zones/f1/rules/0']);
});

test('mixed scene and role writes replay atomically only for a real dependency; unrelated role writes stay reusable', () => {
  const first = opening();
  const [fog] = first.warnings.filter(isSceneZoneWarning);
  const skill = id => ({ name: id, ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', passive: true });
  first.state.skills = { linked: skill('linked'), independent: skill('independent') };
  first.state.units.p1.skills = ['linked'];
  first.state.units.e1.skills = ['independent'];
  const [linked, independent] = ['linked', 'independent'].map((id, i) => ({
    unitId: i ? 'e1' : 'p1', originPath: `/skills/${id}`, source: 'char_info', scope: 'effect', message: `待标准化「${id}」`,
  }));
  const characterRecords = {
    p1: { entryHashes: { 'skills:linked': 'skill1' } }, e1: { entryHashes: { 'skills:independent': 'skill2' } },
  };
  const patch = [...mechanic(fog), ...[linked, independent].map(w => ({
    op: 'add', path: `${w.originPath}/mods`, value: [{ stat: 'dodge', flat: 2, ...(w === linked && { when: "in_zone(self, 'f1')" }) }], resolves: [w],
  }))];
  const all = [fog, linked, independent];
  const accepted = accept(first, all, { patch }, { unitIds: ['p1', 'e1'], records: characterRecords });
  assert.deepEqual(accepted.solved, all);
  const batches = transactions(accepted, characterRecords);
  assert.equal(batches.length, 2);
  const mixed = batches.find(batch => batch.sceneBound);
  assert.deepEqual(new Set(mixed.receipts.map(receipt => receipt.unitId)), new Set([null, 'p1']));
  assert.ok(mixed.patch.some(op => op.path === '/skills/linked/mods'));
  const reusable = batches.filter(batch => !batch.sceneBound && batch.entries.length);
  assert.deepEqual(reusable[0].patch.map(op => op.path), ['/skills/independent/mods']);
  const survivingRole = replayNormalization(first.state, batches, { e1: characterRecords.e1 }, all, replayOptions);
  assert.deepEqual(survivingRole.kept, reusable);
  assert.deepEqual(survivingRole.state.zones.f1.rules, []);
});

test('scene AI narrative receipts use local source keys, survive an identical clause on another floor, and respect tombstones', () => {
  const first = opening();
  const wind = first.warnings.find(w => w.originPath === '/zones/f9');
  const sourceFor = context => (unitId, key) => unitId === null ? JSON.stringify(context.zoneEntries[key.slice('zones:'.length)]) : undefined;
  const accepted = accept(first, [wind], { narrative: [{ unitId: null, originPath: wind.originPath, effectName: '海风', reason: '只有环境描写' }] }, { sourceFor: sourceFor(first) });
  assert.deepEqual(accepted.missing, []);
  const { receipt } = accepted.narrative[0];
  first.state.units.p1.hp = 1;
  assert.equal(activeNarrativeExemptions([wind], [receipt], sourceFor(first)).length, 1);
  const second = opening(undefined, 'other');
  const other = second.warnings.find(w => w.originPath === '/zones/other');
  assert.equal(activeNarrativeExemptions([other], [receipt], sourceFor(second)).length, 1);
  assert.deepEqual(activeNarrativeExemptions([other], [receipt, { ...receipt, origin: 'manual', status: 'revoked', updatedAt: 1 }], sourceFor(second)), []);
});
