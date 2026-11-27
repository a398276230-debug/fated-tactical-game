import { isMedium, mediaCells, mediumRank, mediumZone, physicsEnabled, putMedium, removeMediumCells } from './element-media.js';
import { rollDie } from './rng.js';
import { aoeCells, distance3D, isGround } from './spatial.js';
import { pushFrame } from './tactical-vm.js';
import { scheduleCommit } from './vm-commit.js';
import { removeStatus } from './vm-rules.js';

const CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const MAX_FLOOD = 24;
const MAX_DEPTH = 3;
const byCell = (a, b) => a.y - b.y || a.x - b.x;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const key = ({ x, y }) => `${x},${y}`;
const xy = ({ x, y }) => ({ x, y });
const alive = unit => unit?.hp > 0 && !unit.fled;
const ground = unit => (unit.altitude ?? 0) === 0;
const get = (table, id) => Object.hasOwn(table ?? {}, id) ? table[id] : undefined;
const neighbors = ({ x, y }) => CARDINAL.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
const delta = (at, dx, dy) => ({ x: at.x + dx, y: at.y + dy });
const sortedCells = cells => [...new Map(cells.map(at => [key(at), xy(at)])).values()].sort(byCell);
const water = medium => medium === 'water' || medium === 'electrified_water';

function groupByCell(values) {
  const groups = new Map();
  for (const entity of values.sort(byId)) {
    const id = key(entity);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entity);
  }
  return groups;
}

// Keep only the original zone references per cell and the changed cells. The
// same view drives preview and application, including rank checks between waves.
function mediumView(state) {
  const original = { surface: new Map(), cloud: new Map() };
  const changes = { surface: new Map(), cloud: new Map() };
  for (const zone of Object.values(state.zones ?? {}).filter(isMedium).sort(byId)) {
    const rank = mediumRank(zone);
    const map = original[zone.layer];
    for (const at of mediaCells(state, zone)) {
      const id = key(at);
      if (!map.has(id) || map.get(id).rank <= rank) map.set(id, { zone, rank });
    }
  }
  return {
    changes, original,
    read(layer, at) {
      const id = key(at);
      return changes[layer].has(id) ? changes[layer].get(id).record : original[layer].get(id);
    },
    set(layer, at, record) {
      changes[layer].set(key(at), { at, record });
    },
  };
}

function planImpulse(state, impulse, seen = []) {
  const reactions = [], secondaryTargets = [], effects = [];
  if (!physicsEnabled(state) || !impulse.traits?.length || !impulse.cells?.length) return { reactions, secondaryTargets, effects };
  const visited = new Set(seen);
  const view = mediumView(state);
  const units = groupByCell(Object.values(state.units ?? {}).filter(alive));
  const covers = groupByCell(Object.values(state.covers ?? {}).filter(cover => cover.hp > 0));
  const barrels = groupByCell(Object.values(state.interactives ?? {}).filter(item => !item.spent && item.kind === 'barrel'));
  const spent = new Set(), dried = new Set(), statuses = new Map(), coverHp = new Map();
  const direct = new Set(impulse.directTargetIds);
  const sourceId = impulse.sourceId ?? null;
  const tier = impulse.tier ?? 1, rank = impulse.rank ?? tier;
  const team = get(state.units, sourceId)?.team ?? null;
  const queue = [{ ...impulse, depth: 0 }];
  const claim = (at, kind) => {
    const id = `${key(at)}:${kind}`;
    if (visited.has(id)) return false;
    visited.add(id);
    return true;
  };
  const reaction = (kind, label, cells) => reactions.push({ kind, label, cells: sortedCells(cells) });
  const draft = (medium, remainingTurns, inherited) => {
    const blueprint = mediumZone(medium);
    return { rank: inherited?.rank ?? rank, zone: {
      ...blueprint, medium, remainingTurns: remainingTurns ?? blueprint.remainingTurns,
      tier: inherited?.zone.tier ?? tier, team: inherited ? inherited.zone.team ?? null : team,
      sourceId: inherited ? inherited.zone.sourceId ?? null : sourceId,
      ...(inherited?.zone.flags && { flags: inherited.zone.flags }),
    } };
  };
  const changeStatus = (unit, statusId, turns) => {
    // A shadow presence map is enough. Checks and custom status hooks run on apply.
    if (!statuses.has(unit.id)) statuses.set(unit.id, new Map());
    statuses.get(unit.id).set(statusId, turns > 0);
    effects.push({ op: 'status', targetId: unit.id, statusId, turns });
  };
  const hasStatus = (unit, id) => statuses.get(unit.id)?.get(id) ?? Boolean(get(unit.statuses, id));
  const damage = (unit, kind, amount, damageType, label, details) => {
    secondaryTargets.push({ id: unit.id, kind, expectedDamage: amount });
    effects.push({ op: 'damage', pool: 'hp', targetId: unit.id, sourceId, amount, damageType, direct: false, reactionChain: true, label, ...(details && { details }) });
  };
  const hitCover = (cover, amount, details) => {
    const before = coverHp.get(cover.id) ?? cover.hp;
    if (before <= 0) return false;
    coverHp.set(cover.id, before - Math.max(0, amount - (cover.armor ?? 0)));
    effects.push({ op: 'cover', coverId: cover.id, amount, details });
    return true;
  };
  const checkShock = (unit, inWater) => effects.push({ op: 'shock', targetId: unit.id, inWater });

  for (const wave of queue) {
    const traits = new Set(wave.traits);
    const heat = traits.has('heat'), ignite = traits.has('ignite'), cold = traits.has('cold');
    const wet = traits.has('wet'), shock = traits.has('shock'), gust = traits.has('gust');
    const wetDeposit = wet && !heat && !ignite, oilDeposit = traits.has('flammable') && !ignite;
    const cells = sortedCells(wave.cells.filter(at => isGround(state, at)));
    const stepX = wave.origin && wave.center ? Math.sign(wave.center.x - wave.origin.x) : 0;
    const stepY = wave.origin && wave.center ? Math.sign(wave.center.y - wave.origin.y) : 0;
    const directional = Boolean(stepX || stepY);
    const put = (at, record) => {
      const layer = record.zone.layer;
      if (!isGround(state, at) || (view.read(layer, at)?.rank ?? 0) > record.rank) return false;
      view.set(layer, at, record);
      return true;
    };
    const enqueue = (cells, traits, center) => {
      if (wave.depth + 1 < MAX_DEPTH && cells.length) queue.push({ cells, traits, origin: center, center, depth: wave.depth + 1 });
    };
    const phaseDrafts = new Map();
    const phaseMedium = (medium, turns) => {
      const id = `${medium}:${turns ?? ''}`;
      if (!phaseDrafts.has(id)) phaseDrafts.set(id, draft(medium, turns));
      return phaseDrafts.get(id);
    };
    const marks = new Map();
    const mark = (kind, label, at) => {
      if (!marks.has(label)) marks.set(label, { kind, cells: [] });
      marks.get(label).cells.push(at);
    };
    const burn = unit => { if (!dried.has(unit.id)) changeStatus(unit, 'burning', 2); };
    const shockOnce = (unit, inWater = false) => {
      if ((inWater || hasStatus(unit, 'wet')) && claim(unit, `shock_${unit.id}`)) checkShock(unit, inWater);
    };
    const floodCounts = new Map();

    for (const at of cells) {
      for (const unit of units.get(key(at)) ?? []) {
        const wasWet = hasStatus(unit, 'wet');
        const dryOff = wasWet && (heat || ignite) && claim(at, `dry_${unit.id}`);
        if (dryOff) {
          dried.add(unit.id);
          changeStatus(unit, 'wet', 0);
        } else if (wasWet && cold && claim(at, `freeze_${unit.id}`)) {
          changeStatus(unit, 'wet', 0);
          changeStatus(unit, 'chilled', 1);
        } else if (shock) {
          shockOnce(unit);
        }
        if (hasStatus(unit, 'oiled') && ignite && claim(at, `ignite_${unit.id}`)) {
          changeStatus(unit, 'oiled', 0);
          burn(unit);
          damage(unit, 'attachment', Math.max(6, Math.floor(unit.maxHp * .05)), 'fire', '覆油爆燃');
          mark('attachment', '覆油爆燃', at);
        }
        if ((wet || cold) && hasStatus(unit, 'burning') && claim(at, `quench_${unit.id}`)) changeStatus(unit, 'burning', 0);
        if (!(wasWet && cold) && (wet || heat || ignite) && hasStatus(unit, 'chilled') && claim(at, `thaw_${unit.id}`)) changeStatus(unit, 'chilled', 0);
        if (wetDeposit && ground(unit) && claim(at, `wet_${unit.id}`)) {
          if (hasStatus(unit, 'oiled')) changeStatus(unit, 'oiled', 0);
          if (!wasWet || !cold) changeStatus(unit, 'wet', 2);
        }
        if (oilDeposit && ground(unit) && claim(at, `oil_${unit.id}`)) changeStatus(unit, 'oiled', 2);
      }
    }

    const moveCloud = [], spreadFire = [];
    for (const at of cells) {
      const surface = view.read('surface', at);
      const cloud = view.read('cloud', at);
      const surfaceMedium = surface?.zone.medium;
      const cloudMedium = cloud?.zone.medium;
      const flood = (layer, matches, kind) => {
        const found = [], pending = [];
        const add = cell => {
          const count = floodCounts.get(kind) ?? 0;
          if (count >= MAX_FLOOD) return;
          const record = view.read(layer, cell);
          if (record && record.rank <= rank && matches(record.zone.medium) && claim(cell, kind)) {
            pending.push(cell);
            floodCounts.set(kind, count + 1);
          }
        };
        add(at);
        for (const cell of pending) {
          found.push(cell);
          for (const next of neighbors(cell)) add(next);
        }
        return found.sort(byCell);
      };
      const combust = (layer, medium, label, min, ratio, altitude, turns) => {
        const found = flood(layer, candidate => candidate === medium, `combust_${layer}`);
        if (!found.length) return;
        for (const cell of found) {
          if (layer === 'cloud') view.set(layer, cell, undefined);
          put(cell, phaseMedium('fire', turns));
          for (const unit of units.get(key(cell)) ?? []) {
            if ((unit.altitude ?? 0) > altitude) continue;
            if (layer === 'surface') burn(unit);
            damage(unit, 'combust', Math.max(min, Math.floor(unit.maxHp * ratio)), 'fire', label);
          }
        }
        reaction('combust', label, found);
        const inside = new Set(found.map(key));
        enqueue(sortedCells(found.flatMap(neighbors).filter(cell => !inside.has(key(cell)))),
          layer === 'cloud' ? ['heat', 'ignite', 'gust'] : ['heat', 'ignite']);
      };
      const phase = (label, medium, extra) => {
        if (!claim(at, 'phase')) return;
        if (medium) put(at, phaseMedium(medium));
        else view.set('surface', at, undefined);
        if (extra) put(at, phaseMedium(extra));
        mark('phase', label, at);
      };
      if (surface && surface.rank <= rank) {
        if (surfaceMedium === 'oil' && ignite) combust('surface', 'oil', '引燃油面', 8, .06, 0, 2);
        else if (water(surfaceMedium) && shock) {
          const found = flood('surface', water, 'conduct');
          if (found.length) {
            for (const cell of found) {
              put(cell, phaseMedium('electrified_water'));
              for (const unit of units.get(key(cell)) ?? []) {
                if (!ground(unit)) continue;
                shockOnce(unit, true);
                if (!direct.has(unit.id)) damage(unit, 'conduct', Math.max(6, Math.floor(unit.maxHp * .05)), 'lightning', '水体导电');
              }
            }
            reaction('conduct', '水体导电', found);
          }
        } else if (surfaceMedium === 'water' && cold) phase('水面冻结', 'ice');
        else if (surfaceMedium === 'water' && heat) phase('水面汽化', null, 'steam');
        else if (surfaceMedium === 'ice' && (heat || ignite)) phase('冰面融化', 'water');
        else if (surfaceMedium === 'ice' && gust) phase('冰面碎裂', null);
        else if (surfaceMedium === 'fire' && wet) phase('火海熄灭', null, 'steam');
        else if (surfaceMedium === 'fire' && cold) phase('火海冻灭', null);
        else if (surfaceMedium === 'fire' && gust && directional) spreadFire.push(at);
      } else if (!surface && (tier > 2 || (state.scale?.cellM ?? 2) < 50) && (wetDeposit || oilDeposit)) {
        if (claim(at, 'phase')) {
          put(at, phaseMedium(wetDeposit ? 'water' : 'oil', 2));
          mark('phase', wetDeposit ? '落地积水' : '落地覆油', at);
        }
      }
      // The cloud above this cell is read before the surface reaction, so newly
      // formed steam does not immediately react again to the same impact.
      if (cloud && cloud.rank <= rank && view.read('cloud', at) === cloud) {
        if (cloudMedium === 'poison_cloud' && ignite) combust('cloud', 'poison_cloud', '引爆毒瘴', 10, .08, 1, 1);
        else if (cloudMedium === 'steam' && shock) {
          if (claim(at, 'cloud_conduct')) {
            put(at, phaseMedium('electrified_steam'));
            mark('conduct', '蒸汽带电', at);
          }
        } else if (gust) moveCloud.push({ at, cloud });
      }

      if (ignite || shock) {
        for (const item of barrels.get(key(at)) ?? []) {
          if (spent.has(item.id) || !claim(at, 'barrel')) break;
          spent.add(item.id);
          const radius = item.radius ?? 2, amount = item.damage ?? 12;
          const blast = aoeCells(state, item, item, { shape: 'circle', radius, ignoreObscure: true });
          const details = { interactiveId: item.id };
          effects.push({ op: 'barrel', id: item.id });
          for (const cell of blast) {
            for (const unit of units.get(key(cell)) ?? []) {
              if (distance3D(state, item, unit) <= radius + 1e-9) damage(unit, 'barrel', amount, 'fire', item.name, details);
            }
            for (const cover of covers.get(key(cell)) ?? []) hitCover(cover, amount, details);
          }
          reaction('barrel', `引爆${item.name}`, blast);
          enqueue(blast, ['heat', 'ignite', 'gust'], item);
        }
      }
      for (const cover of covers.get(key(at)) ?? []) {
        const material = `${cover.material ?? ''}${cover.name ?? ''}`;
        const corrode = traits.has('corrode');
        if (!corrode && !(ignite && /木|藤|草|竹|布|栅/u.test(material)) && !(heat && /冰|霜|雪/u.test(material))) continue;
        if (!claim(at, `cover_${cover.id}`)) continue;
        if (hitCover(cover, Math.max(4, Math.ceil(cover.maxHp * .35)), { damageType: corrode ? 'acid' : 'fire' })) {
          mark('cover', '结构破坏', at);
        }
      }
    }

    // Lift all eligible cloud cells before writing destinations. An AoE pushes
    // an entire contiguous cloud one step regardless of traversal direction.
    const movedDrafts = new Map();
    const lifted = moveCloud.filter(({ at, cloud }) => view.read('cloud', at) === cloud && claim(at, 'cloud_gust'));
    for (const { at } of lifted) view.set('cloud', at, undefined);
    for (const { at, cloud } of lifted) {
      const to = delta(at, stepX, stepY);
      const medium = cloud.zone.medium;
      const id = cloud.zone;
      if (!movedDrafts.has(id)) movedDrafts.set(id, draft(medium, cloud.zone.remainingTurns, cloud));
      if (directional && put(to, movedDrafts.get(id))) {
        mark('gust', '云雾吹移', at);
        mark('gust', '云雾吹移', to);
      } else mark('gust', '云雾吹散', at);
    }
    for (const at of spreadFire) {
      const to = delta(at, stepX, stepY);
      if (!view.read('surface', to) && isGround(state, to) && claim(at, 'surface_gust')) {
        put(to, phaseMedium('fire'));
        mark('gust', '火势蔓延', to);
      }
    }
    for (const [label, { kind, cells }] of marks) reaction(kind, label, cells);
  }
  return { reactions, secondaryTargets, effects, view, visited };
}

export function previewSpatialImpulse(state, impulse) {
  const { reactions, secondaryTargets } = planImpulse(state, impulse);
  return { reactions, secondaryTargets };
}

function applyMedia(state, host, view) {
  const removed = new Map(), inserted = new Map();
  const add = (table, id, at) => {
    if (!table.has(id)) table.set(id, []);
    table.get(id).push(at);
  };
  for (const layer of ['surface', 'cloud']) {
    for (const [id, { at, record }] of view.changes[layer]) {
      const before = view.original[layer].get(id)?.zone;
      if (before) add(removed, before, at);
      if (record) add(inserted, record, at);
    }
  }
  for (const [zone, cells] of removed) removeMediumCells(state, host, zone, sortedCells(cells));
  for (const [{ zone, rank }, cells] of inserted) {
    putMedium(state, host, { ...zone, area: { shape: 'cells', cells: sortedCells(cells) } }, rank);
  }
}

export function resolveSpatialImpulse(state, host, frame, impulse) {
  const root = state.vm?.stack[0] ?? frame;
  const { reactions, secondaryTargets, effects, view, visited } = planImpulse(state, impulse, root.impulseVisited);
  if (!effects.length && !reactions.length) return { reactions, secondaryTargets };
  // Arrays survive JSON snapshot round-trips while a nested choice is pending.
  root.impulseVisited = [...visited];
  const actor = get(state.units, impulse.sourceId);
  applyMedia(state, host, view);
  for (const { kind, label, cells } of reactions) {
    if (kind !== 'barrel' && kind !== 'attachment' && kind !== 'cover') host.log(state, actor, 'zone', label, { reaction: kind, cells });
  }
  if (effects.length) pushFrame(state, {
    native: 'spatial_impulse', ownerId: frame.ownerId, sourceId: impulse.sourceId ?? null,
    ruleId: frame.ruleId, attribution: frame.attribution ?? null, carrier: frame.carrier ?? null,
    data: { effects },
  });
  return { reactions, secondaryTargets };
}

// Resume after scheduled commits and status-removal hooks, keeping the VM
// stack depth independent of the number of units hit by a reaction.
export function continueSpatialImpulse({ state, host, frame }) {
  const effect = frame.data.effects[frame.pc++];
  if (!effect) { state.vm.stack.pop(); return; }
  const actor = get(state.units, frame.sourceId);
  if (effect.op === 'barrel') {
    const item = get(state.interactives, effect.id);
    if (item && !item.spent) {
      item.spent = true;
      host.log(state, actor, 'interact', `引爆${item.name}`, { interactiveId: item.id });
    }
    return;
  }
  if (effect.op === 'cover') {
    const cover = get(state.covers, effect.coverId);
    if (cover?.hp > 0) host.coverDamage(state, actor, cover, effect.amount, effect.details);
    return;
  }
  const target = get(state.units, effect.targetId);
  if (!alive(target)) return;
  if (effect.op === 'damage') scheduleCommit(state, frame, effect);
  else if (effect.op === 'status') {
    if (effect.turns > 0) host.grantStatus(state, target, effect.statusId, { sourceId: frame.sourceId, remainingTurns: effect.turns });
    else {
      const status = get(target.statuses, effect.statusId);
      if (status) removeStatus(state, target, status, 'elemental_reaction', actor, host, frame);
    }
  } else if (effect.op === 'shock' && (effect.inWater || get(target.statuses, 'wet'))) {
    const roll = rollDie(state.rng, 20);
    state.rng = roll.rng;
    const bonus = Math.floor((target.stats?.con ?? 0) / 2);
    const total = roll.value + bonus, success = total >= 12;
    host.log(state, actor, 'save', `${target.name}${success ? '抵抗了' : '未抵抗'}麻痹`, {
      targetId: target.id, saveStat: 'con', saveRoll: roll.value, saveBonus: bonus, saveTotal: total, saveDC: 12, saved: success,
    });
    if (!success) host.grantStatus(state, target, 'stun', { sourceId: frame.sourceId, remainingTurns: 1 });
  }
}
