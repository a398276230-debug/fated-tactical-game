const mirrors = { hp: 'maxHp', mp: 'maxMp', sp: 'maxSp' };
const initialMirrors = { hp: 'initialMaxHp', mp: 'initialMaxMp', sp: 'initialMaxSp' };
const carrierTables = { unit: 'units', item: 'items', status: 'statuses', zone: 'zones' };

function own(record, key) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function carrier(state, ownerKind, ownerId) {
  const table = own(carrierTables, ownerKind);
  const owner = table && own(state[table], ownerId);
  if (!owner) throw new RangeError(`Unknown ${ownerKind} pool owner: ${ownerId}`);
  return owner;
}

function requirePool(state, poolId) {
  const pool = own(state.pools, poolId);
  if (!pool) throw new RangeError(`Unknown pool: ${poolId}`);
  return pool;
}

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}

function clamp(value, max) {
  return Math.max(0, Math.min(value, max));
}

function nextId(state, reserved, base) {
  let id = base;
  for (let suffix = 2; own(state.pools, id) || reserved.has(id); suffix++) id = `${base}_${suffix}`;
  reserved.add(id);
  return id;
}

function syncMirrors(state, pool) {
  const maxField = own(mirrors, pool.kind);
  if (!maxField) return;
  const initialField = own(initialMirrors, pool.kind);
  for (const { ownerKind, ownerId } of pool.contributors) {
    const unit = ownerKind === 'unit' && own(state.units, ownerId);
    if (unit && own(unit.pools, pool.kind) === pool.id) {
      unit[pool.kind] = pool.current;
      unit[maxField] = pool.max;
      if (initialField) {
        const contributor = pool.contributors.find(row => row.ownerKind === 'unit' && row.ownerId === ownerId);
        unit[initialField] = contributor?.initialMaxBase ?? pool.initialMax ?? unit[initialField] ?? pool.max;
      }
    }
  }
}

// All resolution, validation and calculations happen before publishing a plan.
function publish(state, pools, bindings = [], removed = []) {
  if (pools.length === 0) return;
  state.pools ??= {};
  for (const pool of pools) state.pools[pool.id] = pool;
  for (const { owner, key, poolId } of bindings) owner.pools = { ...owner.pools, [key]: poolId };
  for (const poolId of removed) delete state.pools[poolId];
  for (const pool of pools) syncMirrors(state, pool);
}

/** Resolve a binding on a unit or another carrier. Returns undefined for a missing binding. */
export function getPool(state, ownerId, key, ownerKind = 'unit') {
  const table = own(carrierTables, ownerKind);
  const owner = table && own(state[table], ownerId);
  return own(state.pools, own(owner?.pools, key));
}

export function deleteOwnedPools(state, owner) {
  for (const poolId of Object.values(owner?.pools ?? {})) delete state.pools[poolId];
  if (owner?.pools) owner.pools = {};
}

function planPool(state, reserved, { ownerKind = 'unit', ownerId, key, max, current = max, initialMax = max, reloadable = false }) {
  const owner = carrier(state, ownerKind, ownerId);
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('Pool key must be a nonempty string');
  if (own(owner.pools, key) !== undefined) throw new RangeError(`Pool already bound: ${ownerId}.${key}`);
  nonnegative(max, 'Pool max');
  nonnegative(initialMax, 'Pool initial max');
  if (!Number.isFinite(current)) throw new RangeError('Pool current must be finite');
  if (typeof reloadable !== 'boolean') throw new TypeError('Pool reloadable must be boolean');
  const id = nextId(state, reserved, `pool_${ownerKind === 'unit' ? '' : `${ownerKind}_`}${ownerId}_${key}`);
  const kind = ownerKind === 'unit' && Object.hasOwn(mirrors, key) ? key : 'custom';
  const pool = { id, kind, contributors: [{ ownerKind, ownerId, maxBase: max, initialMaxBase: initialMax }],
    current: clamp(current, max), max, initialMax, reloadable };
  return { pool, binding: { owner, key, poolId: id } };
}

/** Create and bind a pool from a resolved numeric capacity and initial value. Returns the pool ID. */
export function createPool(state, spec) {
  const { pool, binding } = planPool(state, new Set(), spec);
  publish(state, [pool], [binding]);
  return pool.id;
}

/** Seed all three built-ins once, from a new unit's HP/MP/SP fields or explicit definitions. */
export function initializeUnitPools(state, unitId, resources) {
  const unit = carrier(state, 'unit', unitId);
  const reserved = new Set();
  const plans = Object.entries(mirrors).map(([key, maxField]) => planPool(state, reserved, {
    max: resources ? own(resources, key)?.max : unit[maxField],
    initialMax: resources ? own(resources, key)?.initialMax ?? own(resources, key)?.max : unit[initialMirrors[key]] ?? unit[maxField],
    current: resources ? own(resources, key)?.current : unit[key],
    ownerId: unitId, key,
  }));
  publish(state, plans.map(p => p.pool), plans.map(p => p.binding));
  return Object.fromEntries(plans.map(({ pool }) => [pool.kind, pool.id]));
}

function maxFor(state, contributor, effectiveMax) {
  return nonnegative(effectiveMax ? effectiveMax(contributor, state) : contributor.maxBase, 'Contributor max');
}

function total(values, name) {
  return nonnegative(values.reduce((sum, value) => sum + value, 0), name);
}

function unitBindings(state, pool) {
  return pool.contributors.map(contributor => {
    const { ownerKind, ownerId } = contributor;
    const owner = carrier(state, ownerKind, ownerId);
    if (ownerKind !== 'unit' || getPool(state, ownerId, pool.kind) !== pool) {
      throw new RangeError(`Invalid contributor binding: ${pool.id}/${ownerId}`);
    }
    return { contributor, owner };
  });
}

function selectedPools(state, unitIds, kind) {
  const ids = unitIds.map(id => {
    const pool = getPool(state, id, kind);
    if (!pool || pool.kind !== kind) throw new RangeError(`Missing ${kind} pool for unit: ${id}`);
    return pool.id;
  });
  return [...new Set(ids)].sort().map(id => requirePool(state, id));
}

function topology(state, unitIds, kinds, plan, effectiveMax) {
  const units = [...new Set(unitIds)].sort();
  const reserved = new Set();
  const pools = [], bindings = [], removed = [];
  for (const kind of [...new Set(kinds)].sort()) {
    if (!Object.hasOwn(mirrors, kind)) throw new RangeError(`Pool cannot be linked or unlinked: ${kind}`);
    plan(state, selectedPools(state, units, kind), new Set(units), effectiveMax, {
      reserved, pools, bindings, removed,
    });
  }
  publish(state, pools, bindings, removed);
  return pools.map(pool => pool.id);
}

/** Merge whole pools touched by the selected units, including their existing linked members. */
export function linkPools(state, unitIds, kinds, { effectiveMax } = {}) {
  return topology(state, unitIds, kinds, (state, sources, _, effectiveMax, plan) => {
    if (sources.length < 2) return;
    const kind = sources[0].kind;
    const members = sources.flatMap(pool => unitBindings(state, pool));
    members.sort((a, b) => a.contributor.ownerId < b.contributor.ownerId ? -1 :
      a.contributor.ownerId > b.contributor.ownerId ? 1 : 0);
    const contributors = members.map(member => member.contributor);
      const max = total(contributors.map(c => maxFor(state, c, effectiveMax)), 'Shared pool max');
    const initialMax = total(contributors.map(c => c.initialMaxBase ?? c.maxBase), 'Shared pool initial max');
    const current = clamp(total(sources.map(pool => pool.current), 'Shared pool current'), max);
    const id = nextId(state, plan.reserved, `pool_shared_${kind}`);
    plan.pools.push({ id, kind, contributors, current, max, initialMax, reloadable: sources.every(pool => pool.reloadable) });
    for (const { owner } of members) plan.bindings.push({ owner, key: kind, poolId: id });
    for (const pool of sources) plan.removed.push(pool.id);
  }, effectiveMax);
}

/** Give selected members private pools. Other members stay linked and keep their proportional share. */
export function unlinkPools(state, unitIds, kinds, { effectiveMax } = {}) {
  return topology(state, unitIds, kinds, (state, sources, selected, effectiveMax, plan) => {
    for (const pool of sources) {
      if (pool.contributors.length < 2) continue;
      const groups = [], remaining = [];
      for (const member of unitBindings(state, pool)) {
        if (selected.has(member.contributor.ownerId)) groups.push([member]);
        else remaining.push(member);
      }
      if (remaining.length) groups.push(remaining);
      const capacities = groups.map(group => total(group.map(({ contributor }) =>
        maxFor(state, contributor, effectiveMax)), 'Unlinked pool max'));
      const maxTotal = total(capacities, 'Unlinked total max');
      const currentTotal = clamp(pool.current, maxTotal);
      const full = currentTotal === maxTotal;
      const ratio = full ? 1 : currentTotal / maxTotal;
      let currentLeft = currentTotal;
      for (const [index, members] of groups.entries()) {
        const max = capacities[index];
        const share = index === groups.length - 1 ? currentLeft : max * ratio;
        const current = full ? max : Math.min(currentLeft, clamp(share, max));
        currentLeft -= current;
        const keepId = members === remaining;
        const id = keepId ? pool.id : nextId(state, plan.reserved, `pool_${members[0].contributor.ownerId}_${pool.kind}`);
          const initialMax = total(members.map(({ contributor }) => contributor.initialMaxBase ?? contributor.maxBase), 'Unlinked pool initial max');
        plan.pools.push({ ...pool, id, contributors: members.map(member => member.contributor), current, max, initialMax });
        if (!keepId) plan.bindings.push({ owner: members[0].owner, key: pool.kind, poolId: id });
      }
      if (!remaining.length) plan.removed.push(pool.id);
    }
  }, effectiveMax);
}

// The VM consumes each lethal edge as one event and re-reads the pool after its hooks.
function change(pool, before, applied = true) {
  const lethal = pool.kind === 'hp' && before > 0 && pool.current === 0
    ? { poolId: pool.id, units: pool.contributors.map(c => c.ownerId) }
    : null;
  return { poolId: pool.id, before, after: pool.current, applied, lethal };
}

/** Re-evaluate capacity from base maxima or a pure effectiveMax(contributor, state) callback.
 * Return zero from the callback for inactive contributors. Their bindings remain available to the VM.
 * Use the same callback for link/unlink when effective capacities differ from base capacities.
 */
export function refreshPoolMax(state, poolId, { effectiveMax } = {}) {
  const pool = requirePool(state, poolId);
  const max = total(pool.contributors.map(c => maxFor(state, c, effectiveMax)), 'Pool max');
  const next = { ...pool, max, current: clamp(pool.current, max) };
  publish(state, [next]);
  return change(next, pool.current);
}

/** Apply a clamped numeric change. minRemain and requireFull apply to subtraction. */
export function updatePoolMax(state, poolId, mode, amount, { minRemain = 0 } = {}) {
  const pool = requirePool(state, poolId);
  if (!Number.isFinite(amount)) throw new RangeError('Pool max amount must be finite');
  const before = pool.max;
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Pool max amount must be nonnegative');
  const floor = Math.max(pool.kind === 'hp' ? 1 : 0, Number(minRemain) || 0);
  const max = mode === 'add_max' ? before + amount : mode === 'sub_max' ? Math.max(floor, before - amount) : mode === 'set_max' ? Math.max(floor, amount) : NaN;
  if (!Number.isFinite(max)) throw new RangeError(`Unknown pool max update mode: ${mode}`);
  const members = pool.contributors;
  const totalBase = members.reduce((sum, c) => sum + c.maxBase, 0);
  let remaining = max;
  const nextBase = members.map((c, index) => {
    const share = index === members.length - 1 ? remaining : Math.min(remaining, totalBase > 0 ? (c.maxBase / totalBase) * max : max / members.length);
    remaining -= share;
    return { ...c, initialMaxBase: c.initialMaxBase ?? c.maxBase, maxBase: share };
  });
  const next = { ...pool, initialMax: pool.initialMax ?? before, contributors: nextBase, max, current: clamp(pool.current, max) };
  publish(state, [next]);
  return { ...change(next, pool.current), beforeMax: before, afterMax: max };
}

export function updatePoolCurrent(state, poolId, mode, amount, { minRemain = 0, requireFull = false } = {}) {
  const pool = requirePool(state, poolId);
  if (!Number.isFinite(amount)) throw new RangeError('Pool amount must be finite');
  const before = pool.current;
  let current;
  switch (mode) {
    case 'set': current = amount; break;
    case 'add': current = before + amount; break;
    case 'sub': {
      nonnegative(amount, 'Pool subtraction');
      nonnegative(minRemain, 'Minimum pool remainder');
      const available = Math.max(0, before - minRemain);
      if (requireFull && amount > available) return change(pool, before, false);
      current = before - Math.min(available, amount);
      break;
    }
    default: throw new RangeError(`Unknown pool update mode: ${mode}`);
  }
  if (!Number.isFinite(current)) throw new RangeError('Pool update must produce a finite current');
  const next = { ...pool, current: clamp(current, pool.max) };
  publish(state, [next]);
  return change(next, before);
}

/** Swap from pre-operation values, clamp to each receiving capacity and publish both together. */
export function swapPoolCurrents(state, firstId, secondId) {
  const first = requirePool(state, firstId);
  const second = requirePool(state, secondId);
  if (firstId === secondId) return [];
  const nextFirst = { ...first, current: clamp(second.current, first.max) };
  const nextSecond = { ...second, current: clamp(first.current, second.max) };
  publish(state, [nextFirst, nextSecond]);
  return [change(nextFirst, first.current), change(nextSecond, second.current)];
}
