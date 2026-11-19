import { currentUnit, preview, reachable } from './combat.js';
import { coverBetween, distance3D, elevation, facingToward, gridDistance, hasLOS } from './spatial.js';

const END = Object.freeze({ type: 'end' });
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const healthGap = unit => unit.maxHp - unit.hp;
const samePosition = (a, b) => a.x === b.x && a.y === b.y;
const canSee = (state, actor, target) => !target.statuses.stealth ||
  (gridDistance(actor, target) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target)) <= 1);

function tactics(state, actor, action, plan) {
  const skill = action.type === 'skill' ? state.skills[action.skillId] : undefined;
  if (action.type === 'interact' && plan.kind === 'altar') return 4 + Math.min(8, healthGap(actor)) * .95 + Math.min(5, actor.maxMp - actor.mp) * .55;
  let score = 0;
  for (const profile of plan.targets ?? []) {
    if (profile.kind === 'cover') {
      // Break a path only when no better attack or approach exists.
      const cover = state.covers[profile.id];
      score += 0.5 + Math.min(cover.hp, profile.expectedDamage) * .12;
      continue;
    }
    const target = state.units[profile.recipientId ?? profile.id];
    if (!target) continue;
    const enemy = target.team !== actor.team;
    const sign = enemy ? 1 : (target === actor ? -1.5 : -1.15);
    const damage = profile.expectedDamage ?? 0;
    const kill = profile.damageMax >= target.hp ? Math.min(profile.hitChance ?? 1, damage / target.hp) : 0;
    score += sign * (Math.min(target.hp, damage) + kill * 6);
    if (profile.heal) {
      const healing = (profile.heal[0] + profile.heal[1]) / 2;
      score -= sign * (Math.min(healthGap(target), healing) * .9 + (profile.healingShield?.[0] ?? 0) * (target.statuses.shield ? .14 : .34));
    }
    for (const effect of skill?.effects ?? []) {
      const applied = effect.target === 'self' || (enemy && effect.statusId === 'stealth') ? actor : target;
      const existing = applied.statuses[effect.statusId];
      const useful = !existing || existing.stackRule === 'stack' && existing.stacks < existing.maxStacks;
      const chance = (profile.hitChance ?? 1) * (1 - (profile.saveChance ?? 0));
      const nearbyEnemy = Object.values(state.units).some(u => u.hp > 0 && u.team !== applied.team && dist(u, applied) < 4.5);
      if (effect.kind === 'cleanse') {
        const bad = Object.values(applied.statuses).filter(s => s.durationType !== 'persistent' && ['dot', 'control', 'debuff'].includes(s.category));
        score += bad.reduce((total, s) => total + (s.category === 'control' ? 6 : 3), 0);
      } else if (effect.kind === 'knockback') score += enemy ? 2 * chance : -2;
      else if (effect.kind === 'status' && useful) {
        const weights = { stun: 8, freeze: 8, burn: 4, bleed: 3, poison: 4, chill: 2, blind: 2.5, root: 3, mark: 2,
          sunder: 3, vulnerable: 3, taunt: 1, regen: Math.min(healthGap(applied) * .2, 4), shield: nearbyEnemy ? 3 : .25,
          haste: nearbyEnemy ? 2 : .5, guarded: nearbyEnemy ? 3 : .25, guard: nearbyEnemy ? 2 : .25, thorns: nearbyEnemy ? 3 : .25,
          stealth: nearbyEnemy ? 2.5 : .5 };
        score += (weights[effect.statusId] ?? 1) * chance * (applied.team !== actor.team && !enemy ? -1 : 1);
      }
    }
  }
  return score / (plan.ap === 2 ? 1.35 : 1) - plan.mp * .35 - plan.sp * .25;
}

function aimedOptions(state, actor, attacksOnly = false) {
  const units = Object.values(state.units).filter(u => u.hp > 0).sort(byId);
  const covers = Object.values(state.covers).filter(c => c.hp > 0).sort(byId);
  const choices = [];
  function consider(action) {
    const plan = preview(state, action);
    if (plan.ok) choices.push({ action, score: tactics(state, actor, action, plan) });
  }
  const enemies = units.filter(u => u.team !== actor.team && canSee(state, actor, u));
  for (const target of [...enemies, ...(attacksOnly ? [] : covers)]) consider({ type: 'attack', x: target.x, y: target.y });
  for (const skillId of [...actor.skills].sort()) {
    const skill = state.skills[skillId];
    if (!skill || attacksOnly && (skill.slot !== 'attack' || skill.ap > 1)) continue;
    const query = preview(state, { type: 'skill', skillId });
    if (!query.ok) continue;
    let candidates;
    if (skill.shape === 'single') {
      candidates = skill.target === 'enemy' ? enemies : skill.target === 'self' ? [actor] : units.filter(u => skill.target === 'any' || u.team === actor.team);
    } else if (attacksOnly) {
      candidates = enemies;
    } else {
      candidates = query.cells;
    }
    for (const { x, y } of candidates) consider({ type: 'skill', skillId, x, y });
  }
  if (!attacksOnly) for (const { x, y } of preview(state, { type: 'interact' }).cells ?? []) consider({ type: 'interact', x, y });
  return choices;
}

// Obstacle-aware objective distances. Firing positions include cells facing ranged targets,
// while melee units pursue the boundary around their opponents rather than the occupied tile.
function approach(state, actor, enemies) {
  const weapon = state.equipment[state.items[actor.weapon]?.templateId];
  const range = weapon?.range ?? 1.5;
  const spots = [{ x: actor.x, y: actor.y, steps: 0 }, ...reachable(state, 'move', actor, Infinity)];
  const clearAttackCell = probe => enemies.some(target => {
    const d = distance3D(state, probe, target);
    if (d > range + 1) return false;
    const u = { ...actor, x: probe.x, y: probe.y, ap: 2, used: { attack: 0, action: 0 } };
    const s = { ...state, units: { ...state.units, [actor.id]: u } };
    const attack = preview(s, { type: 'attack', x: target.x, y: target.y });
    if (attack.ok || attack.error === '弹仓已空，请装填' && d <= range && hasLOS(state, probe, target)) return true;
    return false;
  });
  const pathToAttack = spots.find(clearAttackCell);
  if (pathToAttack?.steps > 0) return pathToAttack.path;
  if (pathToAttack?.steps === 0) return [];
  // No reachable legal firing tile, e.g. targets on a disconnected cliff. Approach as far as allowed.
  let best, bestValue = Infinity;
  for (const spot of spots) {
    const score = Math.min(...enemies.map(enemy => dist(spot, enemy) + Math.abs(elevation(state, spot) - elevation(state, enemy)) * .7)) + spot.steps * .025;
    if (score < bestValue) { best = spot; bestValue = score; }
  }
  return best?.path ?? [];
}

function coverQuality(state, destination, enemies) {
  return Math.max(0, ...enemies.map(enemy => (coverBetween(state, enemy, destination)?.cover ?? 0) * .35));
}

/** Choose a legal command without RNG, mutations, hidden rolls or lookahead simulation of rolls. */
export function chooseAction(state) {
  if (state.outcome) return null;
  const actor = currentUnit(state);
  if (!actor || !actor.hp || !actor.ap) return { ...END };
  const enemies = Object.values(state.units).filter(u => u.hp > 0 && u.team !== actor.team).sort(byId);
  if (!enemies.length) return { ...END };
  const visible = enemies.filter(u => canSee(state, actor, u));
  const objectives = visible.length ? visible : enemies;
  let best = { action: END, score: .6 };
  function consider(choice) { if (choice.score > best.score + 1e-8) best = choice; }
  for (const choice of aimedOptions(state, actor)) consider(choice);
  const canReload = preview(state, { type: 'reload' });
  if (canReload.ok) consider({ action: { type: 'reload' }, score: canReload.ammo === 0 ? 7.5 : (canReload.capacity - canReload.ammo) * .5 });

  const plannedPath = approach(state, actor, objectives);
  const z0 = elevation(state, actor);
  const startingCover = coverQuality(state, actor, objectives);
  const baseline = Math.min(...objectives.map(u => dist(actor, u)));
  const ordinary = preview(state, { type: 'move' });
  const riskyDestinations = new Set((ordinary.cells ?? []).filter(c => c.opportunities?.length).map(c => `${c.x},${c.y}`));
  for (const type of ['move', 'sprint', 'disengage']) {
    if (type === 'disengage' && !riskyDestinations.size) continue;
    const options = type === 'move' ? ordinary : preview(state, { type });
    if (!options.ok) continue;
    for (const cell of options.cells) {
      if (type === 'disengage' && !riskyDestinations.has(`${cell.x},${cell.y}`)) continue;
      const projectedDepth = plannedPath.findIndex(point => samePosition(point, cell)) + 1;
      const distance = Math.min(...objectives.map(u => dist(cell, u)));
      const progress = baseline - distance;
      const high = elevation(state, cell) - z0;
      const cover = coverQuality(state, cell, objectives) - startingCover;
      let score = (projectedDepth ? 1.8 + projectedDepth * .55 : progress * .35) + high * .8 + cover;
      if (type === 'sprint') score = score * .82 - 1.2;
      score -= (cell.opportunities?.length ?? 0) * 3.5;
      if (type === 'disengage') score -= .2;
      const available = actor.ap - options.ap;
      if (available > 0) {
        const moved = { ...actor, x: cell.x, y: cell.y, ap: available,
          facing: facingToward(cell.path.at(-2) ?? actor, cell),
          used: { ...actor.used, action: actor.used.action + 1 } };
        const shadow = { ...state, units: { ...state.units, [actor.id]: moved } };
        const followup = Math.max(0, ...aimedOptions(shadow, moved, true).map(choice => choice.score));
        if (followup > 0) score += followup * .84;
        // Reload and wait instead of charging blindly with an empty weapon.
        if (followup === 0 && canReload.ok && canReload.ammo === 0) score -= 3;
      }
      // No movement should beat already having a good shot unless the new position pays off.
      consider({ action: { type, x: cell.x, y: cell.y }, score });
    }
  }
  const bracing = preview(state, { type: 'brace' });
  if (bracing.ok && !actor.statuses.guarded && baseline <= 5) consider({ action: { type: 'brace' }, score: bracing.coverId ? 2.5 : 1.4 });
  return { ...best.action };
}
