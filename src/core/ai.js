import { weaponInfo, actionSkill, currentUnit, equippedActiveSkills, getStatusTemplate, isPassiveSkill, preview, reachable, shieldTotal, visibleEnemy } from './combat.js';
import { aggregateModifiers, unitSkipped } from './vm-carriers.js';
import { zoneContains } from './vm-select.js';
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
    const locks = aggregateModifiers(state, target.id).locks;
    const controlled = unitSkipped(state, target) || Object.values(locks).some(Boolean);
    const statusValue = (controlled ? (enemy ? 8 : -8) : 0)
      + Object.values(target.statuses ?? {}).filter(status => status.durationType === 'battle_turns').length;
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
      const control = op.op === 'apply_status' && status?.category === 'control';
      const profile = (plan.targets ?? []).find(row => (row.recipientId ?? row.id) === target.id);
      if (control && profile?.expectedDamage > 0 && !target.statuses[op.statusId]) {
        score += enemy ? 7 + (target.used.attack ? 2 : 0) : -7;
      }
      if (op.op === 'remove_status' && Object.values(target.statuses ?? {}).some(value => ['debuff', 'control', 'dot'].includes(value.category))) score += enemy ? -4 : 8;
    }
  }
  if (programs.some(op => op.op === 'spawn' && ['zone', 'terrain', 'cover'].includes(op.entityKind))) {
    score += Object.values(state.units).some(unit => unit.team !== actor.team && unit.hp > 0 && !unit.fled) ? 2 : 0;
  }
  return score / (plan.ap === 2 ? 1.35 : 1) - plan.mp * .35 - plan.sp * .25;
}

function protocolTactics(state, actor, plan) {
  const impact = plan.ruleImpact;
  const nativeRecipients = new Set();
  let score = 0;
  for (const profile of plan.targets ?? []) {
    if (profile.kind === 'cover') {
      const cover = state.covers[profile.id];
      if (cover) score += Math.min(2, 2 * (profile.expectedDamage ?? 0) / cover.hp);
      continue;
    }
    if (!profile.dice && impact) continue;
    const target = state.units[profile.recipientId ?? profile.id];
    if (!target) continue;
    nativeRecipients.add(target.id);
    const enemy = target.team !== actor.team;
    const hit = profile.hitChance ?? 1;
    const damage = Math.min(target.hp * hit, profile.expectedDamage ?? 0);
    const defeat = (profile.damageMin ?? 0) >= target.hp ? hit : 0;
    score += (enemy ? 1 : -1.5) * (20 * damage / target.maxHp + 6 * defeat);
    if (!impact && profile.heal) {
      const healing = Math.min(healthGap(target), (profile.heal[0] + profile.heal[1]) / 2);
      score += (enemy ? -1 : 1) * 28 * healing / target.maxHp;
    }
  }
  const confidence = impact?.conditional ? .8 : 1;
  for (const effect of impact?.units ?? []) {
    const target = state.units[effect.id];
    const direction = target.team === actor.team ? 1 : -1;
    const hp = effect.hp + (target === actor ? plan.hp ?? 0 : 0)
      + (nativeRecipients.has(effect.id) ? effect.strikeDamage : 0);
    const survived = target.hp + effect.hp > 0;
    score += confidence * direction * ((hp > 0 ? 28 : 20) * hp / target.maxHp + 8 * effect.shield / target.maxHp
      + (survived ? 3 * (effect.cleared - effect.control) : 0) - (target.hp > 0 && hp <= -target.hp ? 6 : 0));
  }
  if (impact?.summons) {
    const defeated = new Set(impact.units.filter(effect => state.units[effect.id].hp + effect.hp <= 0).map(effect => effect.id));
    const remainingEnemy = Object.values(state.units).some(unit => unit.team !== actor.team && unit.hp > 0 && !unit.fled && !defeated.has(unit.id));
    if (remainingEnemy) score += confidence * Math.min(12, 4 * impact.summons);
  }
  const fraction = (cost, pool) => (cost ?? 0) / Math.max(1, pool ?? 0);
  const cost = 12 * fraction(plan.hp, actor.hp) + 5 * (fraction(plan.mp, actor.mp) + fraction(plan.sp, actor.sp));
  return score / (plan.ap === 2 ? 1.35 : 1) - cost;
}

export function aimedOptions(state, actor, attacksOnly = false) {
  const units = Object.values(state.units).filter(u => u.hp > 0 && !u.fled).sort(byId);
  const covers = Object.values(state.covers).filter(c => c.hp > 0).sort(byId);
  const choices = [];
  const protocol = state.ruleset === 'protocol';
  const vmAimBudget = attacksOnly ? 2 : 6;
  const score = (action, plan) => protocol && plan.kind !== 'altar' ? protocolTactics(state, actor, plan) : tactics(state, actor, action, plan);
  const offensiveProgram = program => (program ?? []).some(op => {
    if (op.enabled === false) return false;
    if (op.op === 'damage' || op.op === 'resource' && ['sub', 'sub_max'].includes(op.mode) && op.pool === 'hp') return true;
    if (op.op === 'apply_status') {
      const category = getStatusTemplate(state, op.statusId)?.category;
      return ['control', 'debuff', 'dot'].includes(category);
    }
    return op.op === 'if' && (offensiveProgram(op.then) || offensiveProgram(op.else))
      || op.op === 'for_each' && offensiveProgram(op.body)
      || op.op === 'check' && (offensiveProgram(op.onPass) || offensiveProgram(op.onFail));
  });
  const isOffensiveAreaSkill = skill => {
    if (!skill || (skill.shape ?? 'single') === 'single' || skill.target === 'ally' || skill.target === 'self') return false;
    if (skill.damage != null || skill.target === 'enemy') return true;
    return (skill.rules ?? []).filter(rule => rule.enabled !== false && rule.hook === 'active')
      .some(rule => offensiveProgram(rule.program));
  };
  const hitsEnemy = plan => (plan.targets ?? []).some(target => target.kind !== 'cover'
    && state.units[target.recipientId ?? target.id]?.team !== actor.team)
    || (plan.ruleImpact?.units ?? []).some(effect => {
      const target = state.units[effect.id];
      return target?.team !== actor.team && (effect.hp < 0 || effect.control > 0 || effect.cleared > 0);
    });
  function consider(action, plan = preview(state, action, { actingUnit: actor })) {
    const skill = action.type === 'skill' ? actionSkill(state, actor, action.skillId) : null;
    if (plan.ok && !(isOffensiveAreaSkill(skill) && !hitsEnemy(plan))) choices.push({ action, score: score(action, plan) });
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
    const query = preview(state, { type: 'skill', skillId }, { actingUnit: actor });
    if (!query.ok) continue;
    const effectiveSkill = actionSkill(state, actor, skillId) ?? skill;
    const directed = ['fan', 'cone', 'line'].includes(effectiveSkill?.shape ?? skill.shape);
    const range = effectiveSkill?.range ?? skill.range ?? 0;
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
    if (directed && range > 0) candidates = candidates.filter(candidate => !samePosition(candidate, actor));
    const actionAt = ({ x, y, id }) => ({ type: 'skill', skillId, x, y, ...(id ? { targetId: id } : {}) });
    const runsVm = skill.rules?.some(rule => rule.hook === 'active' && rule.enabled !== false);
    if (protocol && runsVm && candidates.length > vmAimBudget) {
      // Preview geometry and native strikes for every legal aim. Spend the VM
      // budget on the strongest aims and cells closest to relevant units.
      const objectives = isOffensiveAreaSkill(effectiveSkill) ? enemies
        : skill.target === 'ally' || skill.slot === 'action' ? units : enemies;
      candidates = candidates.map(candidate => {
        const action = actionAt(candidate);
        const plan = preview(state, action, { simulateRules: false, actingUnit: actor });
        const proximity = Math.min(Infinity, ...objectives.map(target => dist(candidate, target)));
        return { candidate, rank: plan.ok ? score(action, plan) + (1 / (1 + proximity)) : -Infinity };
      }).filter(entry => Number.isFinite(entry.rank)).sort((a, b) => b.rank - a.rank).slice(0, vmAimBudget).map(entry => entry.candidate);
    }
    for (const candidate of candidates) consider(actionAt(candidate));
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
    const attack = preview(s, { type: 'attack', targetId: target.id, x: target.x, y: target.y }, { actingUnit: s.units[actor.id] });
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

function zoneOperationScore(state, zone, unit) {
  const owner = state.units?.[zone.ownerId];
  const hostile = owner?.team != null && owner.team !== unit.team;
  const text = rule => typeof rule.filter === 'string' && /target\\.team\\s*!=\\s*source\\.team/.test(rule.filter);
  const walk = (program, multiplier = 1) => (program ?? []).reduce((score, op) => {
    let value = 0;
    if (op.op === 'damage') value = -26;
    else if (op.op === 'resource' && ['sub', 'sub_max'].includes(op.mode) && op.pool === 'hp') value = -26;
    else if (op.op === 'heal') value = 14;
    else if (op.op === 'apply_status') {
      const category = getStatusTemplate(state, op.statusId)?.category;
      value = category === 'control' ? -24 : ['dot', 'debuff'].includes(category) ? -16 : ['buff', 'hot', 'shield'].includes(category) ? 12 : 0;
    }
    if (op.op === 'if') value += walk(op.then, multiplier) + walk(op.else, multiplier);
    if (op.op === 'for_each') value += walk(op.body, multiplier);
    if (op.op === 'check') value += walk(op.onPass, multiplier) + walk(op.onFail, multiplier);
    return score + value * multiplier;
  }, 0);
  return (zone.rules ?? []).reduce((score, rule) => {
    const value = walk(rule.program);
    return score + (hostile || !text(rule) ? value : Math.max(0, value));
  }, 0) + (zone.mods ?? []).reduce((score, mod) => {
    if (mod.locks?.length) return score + (hostile ? -24 : 12);
    const flat = typeof mod.flat === 'number' ? mod.flat : 0;
    const mult = typeof mod.mult === 'number' ? mod.mult : 1;
    const negative = (mod.stat === 'incomingDamageMult' && mult > 1) || (['movement', 'dodge', 'checkBonus', 'damageReduction', 'dr'].includes(mod.stat) && flat < 0) || (mod.stat === 'incomingAccuracy' && flat > 0);
    const positive = (mod.stat === 'damageReduction' || mod.stat === 'dr' || mod.stat === 'damageMult' || mod.stat === 'armor') && (flat > 0 || mult > 1)
      || mod.flags?.some(flag => ['hidden', 'untargetableSingle', 'intercept'].includes(flag));
    return score + (negative ? (hostile ? -14 : 0) : positive ? (hostile ? 0 : 12) : 0);
  }, 0);
}

export function zoneCellScore(state, unit, cell = unit) {
  return Object.values(state.zones ?? {}).reduce((score, zone) => {
    if (!zoneContains(state, zone, { ...cell, z: cell.z ?? elevation(state, cell) })) return score;
    return score + zoneOperationScore(state, zone, { ...unit, x: cell.x, y: cell.y });
  }, 0);
}

function coverQuality(state, destination, enemies) {
  return Math.max(0, ...enemies.map(enemy => (coverBetween(state, enemy, destination)?.cover ?? 0) * .35));
}

/** Choose a legal command without consuming the live battle's RNG or mutating its state. */
export function chooseAction(state, actor = currentUnit(state)) {
  if (state.outcome) return null;
  if (!actor || !actor.hp) return { ...END };
  const plan = action => preview(state, action, { actingUnit: actor });
  if (!actor.ap && !plan({ type: 'move' }).ok) return { ...END };
  const enemies = Object.values(state.units).filter(u => u.hp > 0 && !u.fled && u.team !== actor.team).sort(byId);
  if (!enemies.length) return { ...END };
  const bankStep = move => move.cells?.find(cell => cell.bankedProgress > (actor.moveCarryPermille ?? 0));
  if (actor.moraleState === 'routed') {
    if (atBattleEdge(state,actor)) return plan({type:'flee'}).ok ? {type:'flee'} : {...END};
    const move = plan({type:'move'});
    if (!move.ok) return {...END};
    const exit = reachable(state,'move',actor,Infinity).filter(cell=>atBattleEdge(state,cell)).sort((a,b)=>a.steps-b.steps)[0];
    const dest = exit && (exit.path.slice().reverse().find(p=>move.cells.some(c=>samePosition(c,p))) ?? bankStep(move));
    return dest ? {type:'move',x:dest.x,y:dest.y} : {...END};
  }
  if (state.battleType === 'suppress' && state.suppressingTeam !== actor.team && !actor.used.attack && !actor.statuses.suppressed) {
    const held = Object.values(state.units).filter(t=>t.team===actor.team && t.hp>0 && !t.fled && t.statuses.suppressed).sort(byId);
    for (const ally of held) {
      const rescue={type:'free_ally',targetId:ally.id,x:ally.x,y:ally.y};
      if (plan(rescue).ok) return rescue;
    }
    if (held.length) {
      const move=plan({type:'move'});
      if (move.ok) {
        const route=approach(state,actor,held,true);
        const dest=route.slice().reverse().find(p=>move.cells.some(c=>samePosition(c,p))) ?? (route.length ? bankStep(move) : undefined);
        if(dest) return {type:'move',x:dest.x,y:dest.y};
      }
    }
  }
  if (state.battleType === 'suppress' && state.suppressingTeam === actor.team) {
    for (const enemy of enemies) {
      const action={type:'suppress',targetId:enemy.id,x:enemy.x,y:enemy.y};
      if (plan(action).ok) return action;
    }
    const targets=enemies.filter(t=>!t.statuses.suppressed && visibleEnemy(state,actor,t));
    const path=targets.length && approach(state,actor,targets,true);
    if (path?.length) {
      const move=plan({type:'move'});
      const dest=path.slice().reverse().find(p=>move.cells?.some(c=>samePosition(c,p))) ?? bankStep(move);
      if (dest) return {type:'move',x:dest.x,y:dest.y};
    }
    return {...END};
  }
  const visible = enemies.filter(u => visibleEnemy(state, actor, u));
  const objectives = visible.length ? visible : enemies;
  let best = { action: END, score: .6 };
  const attackChoices = [];
  function consider(choice) {
    if (choice.action.type === 'attack' || choice.action.type === 'skill' && actionSkill(state, actor, choice.action.skillId)?.slot === 'attack') {
      attackChoices.push(choice);
    }
    if (choice.score > best.score + 1e-8) best = choice;
  }
  for (const choice of aimedOptions(state, actor)) consider(choice);
  const canReload = plan({ type: 'reload' });
  if (canReload.ok) consider({ action: { type: 'reload' }, score: canReload.ammo === 0 ? 7.5 : (canReload.capacity - canReload.ammo) * .5 });

  const plannedPath = approach(state, actor, objectives);
  const z0 = elevation(state, actor);
  const startingCover = coverQuality(state, actor, objectives);
  const baseline = Math.min(...objectives.map(u => dist(actor, u)));
  const ordinary = plan({ type: 'move' });
  const riskyDestinations = new Set((ordinary.cells ?? []).filter(c => c.opportunities?.length).map(c => `${c.x},${c.y}`));
  const movements = [];
  for (const type of ['move', 'sprint', 'disengage']) {
    if (type === 'disengage' && !riskyDestinations.size) continue;
    const options = type === 'move' ? ordinary : plan({ type });
    if (!options.ok) continue;
    for (const cell of options.cells) {
      if (type === 'disengage' && !riskyDestinations.has(`${cell.x},${cell.y}`)) continue;
      const projectedDepth = plannedPath.findIndex(point => samePosition(point, cell)) + 1;
      const distance = Math.min(...objectives.map(u => dist(cell, u)));
      const progress = baseline - distance;
      const high = elevation(state, cell) - z0;
      const cover = coverQuality(state, cell, objectives) - startingCover;
      const zoneDelta = zoneCellScore(state, actor, cell) - zoneCellScore(state, actor, actor);
      let score = (projectedDepth ? 1.8 + projectedDepth * .55 : progress * .35) + high * .8 + cover + zoneDelta;
      if (zoneCellScore(state, actor, actor) <= -14 && zoneDelta > 0) score += Math.min(50, 14 + zoneDelta);
      if (cell.bankedProgress != null) {
        const gain = cell.bankedProgress - (actor.moveCarryPermille ?? 0);
        if (gain <= 0 || !plannedPath.length) continue;
        score = 1.6 + cell.bankedProgress / 1000 + gain / 1000 - (type === 'sprint' ? .6 : 0);
      } else if (type === 'sprint') score = score * .82 - 1.2;
      score -= (cell.opportunities?.length ?? 0) * 3.5;
      if (type === 'disengage') score -= .2;
      movements.push({ type, cell, score, available: actor.ap - options.ap });
    }
  }
  const evaluatedMoves = state.ruleset === 'protocol'
    ? movements.sort((a, b) => b.score - a.score).slice(0, 3) : movements;
  for (const { type, cell, available, score: movementScore } of evaluatedMoves) {
    let score = movementScore;
    if (available > 0 && !actor.used.attack) {
      const moved = { ...actor, x: cell.x, y: cell.y, ap: available,
        facing: cell.steps === 0 ? actor.facing : facingToward(cell.path.at(-2) ?? actor, cell),
        used: { ...actor.used, action: actor.used.action + 1 } };
      const shadow = { ...state, units: { ...state.units, [actor.id]: moved } };
      const followup = Math.max(0, ...aimedOptions(shadow, moved, true).map(choice => choice.score));
      if (followup > 0) score += followup * .84 + (zoneCellScore(state, moved, moved) - zoneCellScore(state, actor, actor)) * .35;
      // Reload and wait instead of charging blindly with an empty weapon.
      if (followup === 0 && canReload.ok && canReload.ammo === 0) score -= 3;
    }
    consider({ action: { type, x: cell.x, y: cell.y }, score });
  }
  const bracing = plan({ type: 'brace' });
  if (bracing.ok && !aggregateModifiers(state, actor.id).stats.damageReduction?.flat && baseline <= 5) consider({ action: { type: 'brace' }, score: bracing.coverId ? 2.5 : 1.4 });
  // Ending while a legal attack slot is still available throws away a whole
  // resource. Keep higher-value movement, brace, reload, or skill choices,
  // but use the best legal attack whenever END would otherwise win.
  if (best.action.type === 'end' && !actor.used.attack) {
    const positiveAttacks = attackChoices.filter(choice => choice.score > 0);
    if (positiveAttacks.length) best = positiveAttacks.reduce((choice, current) => choice.score > current.score ? choice : current);
  }
  return { ...best.action };
}
