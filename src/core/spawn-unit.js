import { calculatePrebattleResources } from './prebattle_resources.js';
import { sizeClassFor } from './combat_protocol.js';

const attrs = ['str','agi','con','int','spi'];
const tierCaps = [8,10,12,14,16,18,20];
function budget(actor, spec) {
  const tier = Math.min(actor.tier ?? 1, spec.tier ?? 7);
  const a = spec.attribute ? actor.stats[spec.attribute] : Math.max(actor.stats.int, actor.stats.spi);
  return {tier, sum:Math.max(tier * 5, a * 5 - 30), cap:Math.min(a, tierCaps[tier-1])};
}
export function spawnStatsAllowed(actor, spec) {
  const {cap,sum} = budget(actor,spec);
  return !spec.stats || (attrs.every(k => spec.stats[k] >= 0 && spec.stats[k] <= cap) && attrs.reduce((n,k)=>n+spec.stats[k],0) <= sum);
}
export function spawnPanel(actor, spec) {
  const {tier,cap,sum} = budget(actor,spec);
  // Distribute only spendable points: equivalent to redistributing overflow until all five hit cap.
  const total = Math.min(sum, 5*cap);
  if (total < 0 || !spawnStatsAllowed(actor,spec)) return null;
  const stats = spec.stats ? {...spec.stats} : Object.fromEntries(attrs.map((k,i)=>[k,Math.floor(total/5)+Number(i<total%5)]));
  const bodyLengthM = spec.bodyLengthM ?? 1.7;
  const {resources,mc} = calculatePrebattleResources({stats,tier,bodyLengthM,summonCount:spec.count ?? 1});
  return {stats,tier,bodyLengthM,mc:spec.mc ?? mc,size:spec.size ?? sizeClassFor(bodyLengthM),armor:spec.armor ?? 0,move:spec.move ?? 3,
    maxHp:spec.maxHp ?? resources.hp.max,maxMp:spec.maxMp ?? resources.mp.max,maxSp:spec.maxSp ?? resources.sp.max};
}
