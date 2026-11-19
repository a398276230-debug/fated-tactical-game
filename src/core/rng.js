// Explicit uint32 state: every operation returns the next state without mutation.
const UINT32_SIZE = 0x100000000;

/** Numeric seeds preserve all 32 bits; text seeds hash UTF-16 code units. */
export function seedRng(seed = 0) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed !== 'string') throw new TypeError('Seed must be a finite number or string');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function advance(rng) {
  return (Math.imul(rng, 1664525) + 1013904223) >>> 0;
}

/** Next uniform sample in [0,1) and its serializable state. */
export function nextRng(rng) {
  rng = advance(rng);
  return { rng, value: rng / UINT32_SIZE };
}

/** Roll 1..sides. Rejection avoids giving leftover uint32 values to some faces. */
export function rollDie(rng, sides) {
  if (!Number.isInteger(sides) || sides < 1 || sides > UINT32_SIZE) throw new RangeError('Invalid die size');
  const bucket = Math.floor(UINT32_SIZE / sides);
  const boundary = bucket * sides;
  do { rng = advance(rng); } while (rng >= boundary);
  return { rng, value: Math.floor(rng / bucket) + 1 };
}

export function rollDice(rng, count, sides) {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid dice count');
  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const roll = rollDie(rng, sides);
    rng = roll.rng;
    rolls.push(roll.value);
    total += roll.value;
  }
  return { rng, total, rolls };
}

// Opposing sources cancel one for one; a nonzero remainder selects 2d20.
const edge = (advantage, disadvantage) => Math.sign(Number(advantage) - Number(disadvantage));

export function rollD20(rng, advantage = 0, disadvantage = 0) {
  const sign = edge(advantage, disadvantage);
  const result = rollDice(rng, sign ? 2 : 1, 20);
  const { rolls } = result;
  return {
    rng: result.rng, rolls,
    value: sign > 0 ? Math.max(...rolls) : sign < 0 ? Math.min(...rolls) : rolls[0],
    mode: sign > 0 ? 'advantage' : sign < 0 ? 'disadvantage' : 'normal',
  };
}

function probability(successes, advantage, disadvantage) {
  const sign = edge(advantage, disadvantage);
  if (sign > 0) return (400 - (20 - successes) ** 2) / 400;
  if (sign < 0) return successes ** 2 / 400;
  return successes / 20;
}

/** Natural 1 always misses and natural 20 always hits. */
export function hitChance(target, modifier = 0, advantage = 0, disadvantage = 0) {
  const needed = Math.ceil(target - modifier);
  return probability(Math.max(1, Math.min(19, 21 - needed)), advantage, disadvantage);
}

export function critChance(advantage = 0, disadvantage = 0) {
  return probability(1, advantage, disadvantage);
}

/** Saving throws use roll + modifier >= target, with no natural 1/20 override. */
export function saveChance(target, modifier = 0, advantage = 0, disadvantage = 0) {
  const needed = Math.ceil(target - modifier);
  return probability(Math.max(0, Math.min(20, 21 - needed)), advantage, disadvantage);
}
