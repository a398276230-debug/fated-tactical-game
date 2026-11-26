import { calculatePrebattleResources } from './prebattle_resources.js';
import { sizeClassFor } from './combat_protocol.js';

const attrs = ['str','agi','con','int','spi'];
const tierCaps = [8,10,12,14,16,18,20];
function budget(actor, spec) {
  const tier = Math.min(actor.tier ?? 1, spec.tier ?? 7);
  const a = spec.attribute ? actor.stats[spec.attribute] : Math.max(actor.stats.int, actor.stats.spi);
  return {tier, sum:Math.max(tier * 5, a * 5 - 30), cap:Math.min(a, tierCaps[tier-1])};
}
export function fitSpawnStats(actor, spec) {
  const { cap, sum } = budget(actor, spec);
  const values = attrs.map(key => Math.max(0, Math.min(cap, spec.stats[key])));
  const total = values.reduce((a, b) => a + b, 0);
  const scaled = values.map(value => total > sum ? value * sum / total : value);
  const rounded = scaled.map(Math.floor);
  let spare = Math.min(total, sum) - rounded.reduce((a, b) => a + b, 0);
  for (const i of attrs.map((_, i) => i).sort((a, b) => (scaled[b] - rounded[b]) - (scaled[a] - rounded[a]))) {
    if (spare > 0 && rounded[i] < scaled[i]) { rounded[i]++; spare--; }
  }
  return Object.fromEntries(attrs.map((key, i) => [key, rounded[i]]));
}
export function spawnBudgetIssue(actor, spec) {
  if (!spec.stats) return null;
  const { cap, sum } = budget(actor, spec);
  const { stats } = spec;
  const actualSum = attrs.reduce((total, key) => total + stats[key], 0);
  return attrs.every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0 && stats[key] <= cap) && actualSum <= sum
    ? null : { cap, sum, actualSum, stats };
}
export const spawnStatsAllowed = (actor, spec) => !spawnBudgetIssue(actor, spec);
export function spawnPanel(actor, spec) {
  const {tier,cap,sum} = budget(actor,spec);
  // Distribute only spendable points: equivalent to redistributing overflow until all five hit cap.
  const total = Math.max(0, Math.min(sum, 5 * cap));
  if (!spawnStatsAllowed(actor, spec)) return null;
  const stats = spec.stats ? {...spec.stats} : Object.fromEntries(attrs.map((k,i)=>[k,Math.floor(total/5)+Number(i<total%5)]));
  const bodyLengthM = spec.bodyLengthM ?? (spec.mc >= 2 ? 10 * 2 ** (spec.mc - 2) : 1.7);
  if (bodyLengthM < 0.01 || bodyLengthM > 1e9) return null;
  const { resources, mc } = calculatePrebattleResources({ stats, tier, bodyLengthM, mc: spec.mc, summonCount: spec.count ?? 1 });
  return {stats,tier,bodyLengthM,mc,size:spec.size ?? sizeClassFor(bodyLengthM),armor:spec.armor ?? 0,move:spec.move ?? 3,
    maxHp:spec.maxHp ?? resources.hp.max,maxMp:spec.maxMp ?? resources.mp.max,maxSp:spec.maxSp ?? resources.sp.max};
}
