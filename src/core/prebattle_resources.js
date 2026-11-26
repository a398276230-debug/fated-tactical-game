// Original v1.3.40 pre-battle resource projection, not a combat balance conversion.
const hpTier = [1, 2, 4, 10, 20, 40, 100];
const manaTier = [1, 2.5, 6, 15, 35, 80, 160];
const attributes = ['str', 'agi', 'con', 'int', 'spi'];
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isSafeInteger(n) && finite(n, min, max);
const fail = field => { throw new Error(`战前资源推演：${field}无效`); };

export const sizeMultiplier = bodyLengthM => bodyLengthM >= 10 ? 2 + Math.floor(Math.log2(bodyLengthM / 10)) : 1;

export function calculatePrebattleResources(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('输入');
  const { stats, tier, bodyLengthM = null, mc = sizeMultiplier(bodyLengthM), count = 1, summonCount = 1, previous = {} } = input;
  if (!stats || !attributes.every(k => integer(stats[k], 0, 1000000))) fail('五维');
  if (!integer(tier, 1, 7)) fail('层级');
  if (bodyLengthM !== null && !finite(bodyLengthM, Number.MIN_VALUE, 1e9)) fail('体长');
  if (!integer(count, 1, 1000000) || !integer(summonCount, 1, 1000000)) fail('集群数量或召唤初始总数');
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) fail('旧资源');
  const { str, agi, con, int, spi } = stats;
  const statSum = str + agi + con + int + spi;
  if (!integer(mc, 1, 64)) fail('体型倍率');
  const baseMultipliers = { hp: hpTier[tier - 1], mp: manaTier[tier - 1], sp: manaTier[tier - 1] };
  const hp = baseMultipliers.hp * mc / summonCount, mp = baseMultipliers.mp / summonCount;
  const batch = { hp: con * 100 * baseMultipliers.hp * mc + statSum,
    mp: (int + spi) * 50 * baseMultipliers.mp, sp: (str + agi) * 50 * baseMultipliers.sp };
  const resources = {};
  for (const [key, total] of Object.entries(batch)) {
    const value = total / summonCount * count;
    const old = previous[key];
    if (Object.hasOwn(previous, key) && (!old || !finite(old.max, 0, Number.MAX_SAFE_INTEGER) || !finite(old.current, 0, old.max))) fail(`旧 ${key.toUpperCase()} `);
    // No rounding rule in the source excerpt: preserve the raw result and expose
    // a single explicit nearest-integer policy for panels needing integers.
    const ratio = old ? (old.max ? old.current / old.max : 0) : 1;
    const max = key === 'hp' ? Math.max(1, Math.round(value)) : Math.round(value);
    resources[key] = { rawMax: value, max, current: ratio === 1 ? max : Math.round(value * ratio), ratio };
  }
  return { tier, statSum, mc, count, summonCount, baseMultipliers, multipliers: { hp, mp, sp: mp }, resources };
}

export function protocolDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + Math.ceil(Math.abs(a.z - b.z) / 2);
}
