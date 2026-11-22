import { weaponInfo, actionSkill, currentUnit, equippedActiveSkills, getStatusTemplate, isPassiveSkill, preview, reachable, shieldTotal, statusModifier, visibleEnemy } from './combat.js';
import { atBattleEdge, coverBetween, distance3D, elevation, facingToward, hasLOS } from './spatial.js';

const END = Object.freeze({ type: 'end' });
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const healthGap = unit => unit.maxHp - unit.hp;
const samePosition = (a, b) => a.x === b.x && a.y === b.y;

export function tactics(state, actor, action, plan) {
  if (!plan?.ok) return -Infinity;
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
    const statusValue = target.statuses ? Object.values(target.statuses).reduce((value, status) => {
      const control = status.modifiers?.skip || status.modifiers?.root || status.modifiers?.disadvantage;
      return value + (control ? (enemy ? 8 : -8) : 0) + (status.durationType === 'battle_turns' ? 1 : 0);
    }, 0) : 0;
    score += sign * (Math.min(target.hp, damage) + kill * 6 + statusValue);
    if (profile.heal) {
      const healing = (profile.heal[0] + profile.heal[1]) / 2;
      score -= sign * (Math.min(healthGap(target), healing) * .9 + (profile.healingShield?.[0] ?? 0) * (shieldTotal(target) ? .14 : .34));
    }
  }
  for (const { id, heal, shieldGain } of plan.support ?? []) {
    const target = state.units[id];
    if (!target) continue;
    const sign = target.team === actor.team ? 1 : -1;
    score += sign * (heal * .9 + Math.min(shieldGain, target.maxHp) * .5);
  }
  const skill = action.type === 'skill' ? actionSkill(state, actor, action.skillId) : null;
  const programs = (skill?.rules ?? []).filter(rule => rule.enabled !== false && ['active', 'after_hit'].includes(rule.hook))
    .flatMap(rule => rule.program).filter(op => op.enabled !== false);
  for (const op of programs) {
    const targetAtAction = Number.isFinite(action.x) && Number.isFinite(action.y)
      ? Object.values(state.units).find(unit => unit.x === action.x && unit.y === action.y) : null;
    const targets = op.target === 'self' ? [actor]
      : (plan.targets ?? []).map(profile => state.units[profile.recipientId ?? profile.id]).filter(Boolean);
    if (!targets.length && targetAtAction) targets.push(targetAtAction);
    if (op.op === 'spawn') score += op.entityKind === 'unit' ? 4 : 2;
    for (const target of targets) {
      const enemy = target.team !== actor.team;
      const status = getStatusTemplate(state, op.statusId);
      const control = op.op === 'apply_status' && (status?.category === 'control' || ['stun', 'root', 'freeze', 'suppressed'].includes(op.statusId));
      const profile = (plan.targets ?? []).find(row => (row.recipientId ?? row.id) === target.id);
      if (control && profile?.expectedDamage > 0 && !target.statuses[op.statusId]) {
        score += enemy ? 7 + (target.used.attack ? 2 : 0) : -7;
      }
      if (op.op === 'remove_status' && Object.values(target.statuses ?? {}).some(value => ['debuff', 'control', 'dot'].includes(value.category))) score += enemy ? -4 : 8;
    }
  }
  if (programs.some(op => ['set_terrain', 'modify_terrain', 'add_cover'].includes(op.op))) {
    score += Object.values(state.units).some(unit => unit.team !== actor.team && unit.hp > 0 && !unit.fled) ? 2 : 0;
  }
  return score / (plan.ap === 2 ? 1.35 : 1) - plan.mp * .35 - plan.sp * .25;
}

export function aimedOptions(state, actor, attacksOnly = false) {
  const units = Object.values(state.units).filter(u => u.hp > 0 && !u.fled).sort(byId);
  const covers = Object.values(state.covers).filter(c => c.hp > 0).sort(byId);
  const choices = [];
  function consider(action) {
    const plan = preview(state, action);
    if (plan.ok) choices.push({ action, score: tactics(state, actor, action, plan) });
  }
  const enemies = units.filter(u => visibleEnemy(state, actor, u));
  for (const target of [...enemies, ...(attacksOnly ? [] : covers)]) consider({ type: 'attack', x: target.x, y: target.y, ...(target.id ? { targetId: target.id } : {}) });
  const items = Object.entries(actor.inventory ?? {}).filter(([id, count]) => count > 0 && state.skills[id]?.backpackItem);
  const templates = new Map([...actor.skills.map(id => [id, state.skills[id]]), ...items.map(([id]) => [id, state.skills[id]]), ...equippedActiveSkills(state, actor)]);
  for (const skillId of [...templates.keys()].sort()) {
    const skill = templates.get(skillId);
    if (!skill || isPassiveSkill(skill) || attacksOnly && (skill.slot !== 'attack' || skill.ap > 1)) continue;
    // The greedy planner cannot guarantee progress on a free skill unless it
    // exhausts a budget. Filters could skip consumption, so do not rely on them.
    if (skill.ap === 0 && !skill.backpackItem && !skill.rules?.some(rule => rule.hook === 'active' && rule.enabled !== false
      && (rule.filter === undefined || rule.filter === true) && (rule.usesPerTurn || rule.usesPerBattle || rule.cooldownTurns))) continue;
    const query = preview(state, { type: 'skill', skillId });
    if (!query.ok) continue;
    let candidates;
    if (skill.target === 'cell' || skill.target === 'corpse') {
      candidates = query.cells;
    } else if (skill.shape === 'single') {
      candidates = skill.target === 'enemy' ? enemies : skill.target === 'self' ? [actor] : units.filter(u => skill.target === 'any' || u.team === actor.team);
    } else if (attacksOnly) {
      candidates = enemies;
    } else {
      candidates = query.cells;
    }
    for (const candidate of candidates) {
      const { x, y } = candidate;
      consider({ type: 'skill', skillId, x, y, ...(candidate.id ? { targetId: candidate.id } : {}) });
    }
  }
  for (const { x, y, kind, spent } of Object.values(state.interactives).sort(byId)) {
    if (spent) continue;
    if (kind === 'barrel') consider({ type: 'attack', x, y });
    else if (!attacksOnly) consider({ type: 'interact', x, y });
  }
  return choices;
}

// Obstacle-aware objective distances. Firing positions include cells facing ranged targets,
// while melee units pursue the boundary around their opponents rather than the occupied tile.
function approach(state, actor, enemies, suppress = false) {
  const range = weaponInfo(state, actor).template.range ?? 0;
  const spots = [{ x: actor.x, y: actor.y, steps: 0 }, ...reachable(state, 'move', actor, Infinity)];
  const clearAttackCell = probe => enemies.some(target => {
    const d = distance3D(state, probe, target);
    if (suppress) return d <= 1 && hasLOS(state,probe,target);
    if (d > range + 1) return false;
    const u = { ...actor, x: probe.x, y: probe.y, ap: 2, used: { attack: 0, action: 0 } };
    const s = { ...state, units: { ...state.units, [actor.id]: u } };
    const attack = preview(s, { type: 'attack', targetId: target.id, x: target.x, y: target.y });
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
  const enemies = Object.values(state.units).filter(u => u.hp > 0 && !u.fled && u.team !== actor.team).sort(byId);
  if (!enemies.length) return { ...END };
  if (actor.moraleState === 'routed') {
    if (atBattleEdge(state,actor)) return preview(state,{type:'flee'}).ok ? {type:'flee'} : {...END};
    const move = preview(state,{type:'move'});
    if (!move.ok) return {...END};
    const exit = reachable(state,'move',actor,Infinity).filter(cell=>atBattleEdge(state,cell)).sort((a,b)=>a.steps-b.steps)[0];
    const dest = exit?.path.slice().reverse().find(p=>move.cells.some(c=>samePosition(c,p)));
    return dest ? {type:'move',x:dest.x,y:dest.y} : {...END};
  }
  if (state.battleType === 'suppress' && state.suppressingTeam !== actor.team && !actor.used.attack && !actor.statuses.suppressed) {
    const held = Object.values(state.units).filter(t=>t.team===actor.team && t.hp>0 && !t.fled && t.statuses.suppressed).sort(byId);
    for (const ally of held) {
      const rescue={type:'free_ally',targetId:ally.id,x:ally.x,y:ally.y};
      if (preview(state,rescue).ok) return rescue;
    }
    if (held.length) {
      const move=preview(state,{type:'move'});
      if (move.ok) {
        const route=approach(state,actor,held,true);
        const dest=route.slice().reverse().find(p=>move.cells.some(c=>samePosition(c,p)));
        if(dest) return {type:'move',x:dest.x,y:dest.y};
      }
    }
  }
  if (state.battleType === 'suppress' && state.suppressingTeam === actor.team) {
    for (const enemy of enemies) {
      const action={type:'suppress',targetId:enemy.id,x:enemy.x,y:enemy.y};
      if (preview(state,action).ok) return action;
    }
    const targets=enemies.filter(t=>!t.statuses.suppressed && visibleEnemy(state,actor,t));
    const path=targets.length && approach(state,actor,targets,true);
    if (path?.length) {
      const move=preview(state,{type:'move'});
      const dest=path.slice().reverse().find(p=>move.cells?.some(c=>samePosition(c,p)));
      if (dest) return {type:'move',x:dest.x,y:dest.y};
    }
    return {...END};
  }
  const visible = enemies.filter(u => visibleEnemy(state, actor, u));
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
      if (cell.steps === 0 && actor.moveM > 0 && baseline > 0) score += 1;
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
  if (bracing.ok && !statusModifier(actor, 'reduction') && baseline <= 5) consider({ action: { type: 'brace' }, score: bracing.coverId ? 2.5 : 1.4 });
  return { ...best.action };
}
