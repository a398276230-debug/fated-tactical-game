import { aoeCells, canStep, cellAt as tileAt, coverAt, coverBetween, distance3D as distance,
  elevation, facingArc, facingToward as signFacing, gridDistance as near, hasLOS as clearSight,
  isFlanked as flank, isGround as ground, movementOptions, passableEdge as fitsHeight, unitAt } from './spatial.js';
import { critChance as criticalOdds, hitChance as hitOdds, nextRng, rollD20, rollProtocolD20, rollDice, rollDie,
  saveChance as saveOdds } from './rng.js';
import { stanceFor, stanceLabel, stanceRules, distanceTier, ratingFor, sizeHitModifier, meleeMultiplier, intentCheck, INTENTS, moraleResult, damagePipeline, initiative as protocolInitiative } from './combat_protocol.js';

// Pure tactical rules. Templates hold static data; mutable counters live in state.items.
// Damage/heal: {count,sides,bonus?,stat?,multiplier?,type?}.
// Equipment: {name,range?,accuracy?,damage?,defense?,effects:[{kind,...}]};
// kinds: kill_charge_weapon(counterKey,bonusPerStack,maxStacks), ammo(counterKey,capacity,
// armorPierce,highGroundRange,highGroundAccuracy), frost_thorns(damage,chance,statusId),
// backstab(bonusMultiplier,bleedStacks,comboDamage), healing_shield(healBonus,shieldRatio),
// opportunity_root (a successful opportunity attack roots its recipient for one turn).
// Skills: {name,ap,slot,mp?,sp?,range,shape,target,radius?,width?,accuracy?,save?,saveDC?,
// damage?,heal?,effects:[{kind,...}]} where effects are status(statusId,turns,stacks,amount),
// knockback(distance,collisionDamage), teleport_backstab(bonusMultiplier), or cleanse.

const def = (name, icon, category, remainingTurns, description, modifiers = {}, options = {}) =>
  Object.freeze({ name, icon, category, description, remainingTurns, durationType: 'battle_turns',
    tickTiming: 'onTurnStart', stackRule: 'refresh', maxStacks: 1,
    modifiers: Object.freeze(modifiers), ...options });

export const STATUSES = Object.freeze(Object.fromEntries(Object.entries({
  burn: def('灼烧', '🔥', 'dot', 2, '回合初受到火焰能量伤害。', { damage: 5, damageType: 'energy' }),
  bleed: def('流血', '🩸', 'dot', 3, '回合末每层受到 3 点真实伤害。', { damage: 3, damageType: 'true' },
    { stackRule: 'stack', maxStacks: 5, tickTiming: 'onTurnEnd' }),
  poison: def('中毒', '☠️', 'dot', 3, '回合初每层受到 3 点真实伤害。', { damage: 3, damageType: 'true' },
    { stackRule: 'stack', maxStacks: 4 }),
  regen: def('再生', '💚', 'hot', 3, '回合初恢复生命。', { heal: 5 }),
  shield: def('护盾', '🛡️', 'shield', 2, '独立吸收伤害；耗尽时破裂。', { amount: 8 }, { stackRule: 'replace' }),
  guarded: def('坚壁', '🧱', 'buff', 1, '受到的伤害减少 35%。', { reduction: .35 }),
  taunt: def('嘲讽', '📣', 'control', 1, '可攻击嘲讽来源时，进攻必须指定该来源。', { taunted: true }),
  guard: def('援护', '🤝', 'buff', 2, '替相邻友军承受伤害；不会连续转交。', { intercept: true }),
  thorns: def('反伤棘甲', '🌵', 'buff', 2, '被近战命中时，对进攻者造成真实伤害。', { reflect: 5 }),
  stun: def('眩晕', '💫', 'control', 1, '跳过行动。', { skip: true }),
  freeze: def('冰冻', '🧊', 'control', 1, '跳过行动；被打击时碎冰，受到额外伤害。', { skip: true, shatter: .5 }),
  root: def('定身', '⛓️', 'control', 2, '无法移动或瞬移，仍可攻击或施法。', { rooted: true }),
  blind: def('致盲', '🌑', 'debuff', 2, '命中检定带劣势。', { disadvantage: 1 }),
  vulnerable: def('易伤', '💢', 'debuff', 2, '受到的伤害增加 35%。', { vulnerability: .35 }),
  sunder: def('破甲', '🔨', 'debuff', 2, '护甲降低 4 点。', { armor: -4 }),
  mark: def('标记', '🎯', 'debuff', 2, '攻击此单位的命中加 2。', { incomingAccuracy: 2 }),
  stealth: def('隐身', '👤', 'buff', 2, '无法被敌方远距直接锁定；发动进攻或遭攻击伤害时现形。', { hidden: true, advantage: 1 }),
  haste: def('疾走', '💨', 'buff', 2, '移动距离增加 1。', { movement: 1 }),
  chill: def('寒冷', '❄️', 'debuff', 2, '移动距离和命中降低。', { movement: -1, accuracy: -2 }),
  charge: def('蓄力', '⚡', 'buff', 1, '本回合下一次攻击增伤。', { damageBonus: .15 }),
  lock_on: def('定位', '⌖', 'buff', 1, '本回合对锁定目标命中提高。', { accuracy: 1 }),
  weakness: def('弱点识别', '◉', 'buff', 3, '每层使意图难度降低 2。', { intentDifficulty: -2 }, { stackRule: 'stack', maxStacks: 3 }),
  grappled: def('擒抱', '⛓', 'control', 1, '无法移动，仍可进行近身攻击。', { rooted: true }),
  prone: def('倒地', '▽', 'debuff', 1, '无法移动，闪避降低。', { incomingAccuracy: 2, rooted: true }),
  disarmed: def('缴械', '⚔', 'debuff', 1, '无法使用主手武器。', { disarmed: true }),
}).map(([id, status]) => [id, Object.freeze({ id, ...status })])));

function randomUnit(state) {
  const { rng, value } = nextRng(state.rng);
  state.rng = rng;
  return value;
}
function randomDie(state, sides) {
  const { rng, value } = rollDie(state.rng, sides);
  state.rng = rng;
  return value;
}

const values = object => Object.values(object ?? {});
const alive = unit => unit && unit.hp > 0;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const living = state => values(state.units).filter(alive).sort(byId);
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const pos = (x, y) => ({ x, y });
const key = (x, y) => `${x},${y}`;
const stat = (unit, id) => Number(unit.stats?.[id] ?? 0);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const changes = (unit, name) => values(unit.statuses).reduce((sum, s) =>
  sum + Number(s.modifiers?.[name] ?? STATUSES[s.id]?.modifiers?.[name] ?? 0) * (s.stacks ?? 1), 0);
const statusOf = (unit, id) => Object.hasOwn(unit.statuses ?? {}, id) ? unit.statuses[id] : undefined;
export const currentUnit = state => Object.hasOwn(state.units, state.order[state.turn]) ? state.units[state.order[state.turn]] : undefined;

function record(state, unit, type, text, detail = {}) {
  const event = { round: state.round, actor: typeof unit === 'string' ? unit : unit?.id ?? null, type, text, detail };
  state.logs.push(event);
  return event;
}

function tableEntry(table, id) { return Object.hasOwn(table ?? {}, id) ? table[id] : undefined; }

export function getStatusTemplate(state, statusId) {
  if (typeof statusId !== 'string') return undefined;
  return tableEntry(STATUSES, statusId) ?? tableEntry(state?.statusTemplates, statusId);
}

function equipmentFor(state, instanceId) {
  const instance = tableEntry(state.items, instanceId);
  const template = tableEntry(state.equipment, instance?.templateId);
  return { instance, template, effects: template?.effects ?? [] };
}
const gearFor = (state, unit) => (unit.gear ?? []).map(id => equipmentFor(state, id));
const gearEffects = (state, unit, kind) => gearFor(state, unit).flatMap(g => g.effects).filter(e => e.kind === kind);
const statusAmount = status => status.amount ?? status.modifiers?.amount ?? STATUSES[status.id]?.modifiers.amount ?? 0;

export function grantStatus(state, unit, statusId, options = {}) {
  const template = getStatusTemplate(state, statusId);
  if (!unit || !template) throw new Error(`未知状态：${statusId}`);
  unit.statuses ??= {};
  const previous = statusOf(unit, statusId);
  const stackRule = options.stackRule ?? previous?.stackRule ?? template.stackRule;
  const maxStacks = options.maxStacks ?? previous?.maxStacks ?? template.maxStacks;
  const addedStacks = options.stacks ?? 1;
  const stacks = clamp(stackRule === 'stack' ? (previous?.stacks ?? 0) + addedStacks : addedStacks, 1, maxStacks);
  const remainingTurns = options.remainingTurns ?? options.turns ?? template.remainingTurns;
  const applied = { ...template, stackRule, maxStacks, stacks,
    durationType: options.durationType ?? previous?.durationType ?? template.durationType,
    remainingTurns: stackRule === 'stack' && options.remainingTurns == null && options.turns == null
      ? Math.max(previous?.remainingTurns ?? 0, remainingTurns) : remainingTurns,
    tickTiming: options.tickTiming ?? template.tickTiming,
    modifiers: { ...template.modifiers, ...(options.modifiers ?? {}) },
    sourceUnitId: options.sourceUnitId ?? previous?.sourceUnitId ?? null,
    appliedRound: state.round, appliedTurn: state.turn };
  if (statusId === 'shield') applied.amount = clamp(options.amount ?? applied.modifiers.amount, 1, 10000);
  unit.statuses[statusId] = applied;
  record(state, applied.sourceUnitId ?? unit.id, 'status', `${unit.name}获得${template.name} ×${stacks}`,
    { targetId: unit.id, statusId, stacks, remainingTurns: applied.remainingTurns,
      ...(statusId === 'shield' ? { amount: applied.amount } : {}) });
  return applied;
}

export function refreshOutcome(state) {
  let blue = false, red = false;
  for (const unit of values(state.units)) if (alive(unit) && !unit.fled) {
    blue ||= unit.team === 'blue';
    red ||= unit.team === 'red';
  }
  const result = blue && red ? null : blue ? 'blue' : red ? 'red' : 'draw';
  if (state.outcome !== result) {
    state.outcome = result;
    if (result) record(state, null, 'outcome', result === 'draw' ? '战斗结束：平局' : `战斗结束：${result === 'blue' ? '蓝方' : '红方'}获胜`, { outcome: result });
  }
  return result;
}

function loseHP(state, target, raw, sourceUnitId, type, label, detail = {}) {
  const hpBefore = target.hp;
  target.hp = target.nonLethal ? Math.max(1, hpBefore - raw) : Math.max(0, hpBefore - raw);
  const amount = hpBefore - target.hp;
  record(state, sourceUnitId, 'damage', `${target.name}受到${amount}点${label}伤害`,
    { ...detail, targetId: target.id, damageType: type, amount, hpBefore, hpAfter: target.hp });
  if (!alive(target)) {
    record(state, sourceUnitId, 'defeat', `${target.name}倒下`, { targetId: target.id });
    triggerDeathrattle(state, target, sourceUnitId);
  }
  return amount;
}

function triggerDeathrattle(state, target, sourceUnitId) {
  const effect = target.deathrattle;
  if (!effect || target.deathrattleTriggered) return;
  target.deathrattleTriggered = true;
  record(state, target, 'deathrattle', `${target.name}触发亡语`, { targetId: target.id, effect: structuredClone(effect) });
  const at = { x: target.x, y: target.y };
  if (effect.kind === 'damage') {
    for (const unit of living(state)) if (unit.team !== target.team && distance(state, at, unit) <= (effect.radius ?? 1))
      damageTarget(state, unit, sourceUnitId, effect.amount ?? 0, effect.damageType ?? 'energy', effect.name ?? '亡语', { reaction: true });
  } else if (effect.kind === 'status') {
    for (const unit of living(state)) if (unit.team !== target.team && distance(state, at, unit) <= (effect.radius ?? 1))
      grantStatus(state, unit, effect.statusId, { turns: effect.turns, sourceUnitId });
  } else if (effect.kind === 'zone') {
    state.zones ??= {};
    const id = effect.id ?? `deathrattle-${target.id}-${state.round}-${state.logs.length}`;
    state.zones[id] = { id, name: effect.name ?? '亡语领域', x: at.x, y: at.y, radius: effect.radius ?? 1,
      remainingTurns: effect.remainingTurns ?? 2, damage: effect.amount ?? 0, damageType: effect.damageType ?? 'energy', team: effect.team ?? 'all' };
    record(state, target, 'zone', `${effect.name ?? '亡语领域'}形成`, { zoneId: id });
  } else if (effect.kind === 'spawn' && effect.unit && !state.units[effect.unit.id]) {
    const unit = structuredClone(effect.unit); unit.x = at.x; unit.y = at.y; unit.hp = unit.maxHp;
    state.units[unit.id] = unit; state.order.push(unit.id); record(state, target, 'spawn', `${unit.name}由亡语诞生`, { unitId: unit.id });
  }
}

function moraleCheck(state) {
  for (const unit of living(state)) {
    const result = moraleResult({ type: unit.moraleType ?? 'standard', hp: unit.hp, maxHp: unit.maxHp, d20: randomDie(state, 20) });
    if (!result.triggered || unit.moraleCheckedRound === state.round) continue;
    unit.moraleCheckedRound = state.round;
    if (!result.check) { unit.moraleState = 'shaken'; continue; }
    unit.moraleState = result.shaken ? 'shaken' : 'routed';
    record(state, unit, 'morale', `${unit.name}${result.shaken ? '动摇' : '溃逃'}`, { targetId: unit.id, ...result });
  }
}

function restoreHP(state, target, raw, sourceUnitId, label, detail = {}) {
  const amount = Math.min(raw, target.maxHp - target.hp);
  target.hp += amount;
  record(state, sourceUnitId, 'heal', `${target.name}因${label}恢复${amount}点生命`, { ...detail, targetId: target.id, amount });
  return amount;
}

function armorOf(state, unit, damageType, pierce = 0) {
  const equipmentDefense = gearFor(state, unit).reduce((sum, g) => sum + (g.template?.defense ?? 0), 0)
    + (unit.shield ? equipmentFor(state, unit.shield).template?.defense ?? 0 : 0);
  const base = Math.max(0, unit.armor + equipmentDefense + changes(unit, 'armor') + gearFor(state, unit).reduce((sum, g) => sum + (g.template?.armor ?? 0), 0));
  const flat = typeof pierce === 'object' ? (pierce.flat ?? 0) : pierce;
  const percent = typeof pierce === 'object' ? (pierce.percent ?? 0) : 0;
  const effective = Math.max(0, base * (1 - percent) - flat);
  return damageType === 'physical' ? effective : damageType === 'energy' ? effective / 2 : 0;
}

function damageTarget(state, target, sourceUnitId, amount, type, label, options = {}) {
  const { attacker, hit = false, melee = false, armorPierce = 0, reaction = false, details = {} } = options;
  let recipient = target;
  if (hit && !reaction) {
    recipient = guardFor(state, target) ?? target;
    if (recipient !== target) record(state, recipient, 'guard', `${recipient.name}替${target.name}承受打击`, { targetId: target.id });
  }
  let parry = null;
  if (hit && melee && !reaction && recipient !== attacker && recipient?.stance === 'greatsword'
    && recipient.greatswordMode === 'defensive' && (recipient.parryQuota ?? 0) > 0) {
    const defenderRoll = randomDie(state, 20), attackerRoll = randomDie(state, 20);
    const defenderTotal = stat(recipient, 'str') + defenderRoll;
    const attackerTotal = stat(attacker, 'str') + attackerRoll;
    const success = defenderTotal >= attackerTotal;
    const perfect = success && (details.ratingMultiplier ?? 0) >= 1.3 && !recipient.parryRefunded;
    recipient.parryQuota--;
    if (perfect) { recipient.parryQuota = Math.min(2, recipient.parryQuota + 1); recipient.parryRefunded = true; }
    parry = { success, perfect, defenderRoll, attackerRoll, defenderTotal, attackerTotal, reduction: perfect ? 1 : success ? .6 : 0, quota: recipient.parryQuota };
    record(state, recipient, 'parry', `${recipient.name}${perfect ? '完美弹反' : success ? '弹反成功' : '弹反失败'}`, { targetId: attacker?.id ?? null, ...parry });
    if (perfect) amount = 0;
    else if (success) amount *= .4;
  }
  const formula = mitigation(state, recipient, type, hit, armorPierce);
  const modified = Math.max(0, hit
    ? Math.floor(amount * formula.multiplier * formula.armorMultiplier * (1 - formula.attributeReduction))
    : Math.floor(amount * formula.multiplier) - Math.floor(formula.armor));
  if (formula.shatter) {
    delete recipient.statuses.freeze;
    record(state, sourceUnitId, 'shatter', `${recipient.name}的冰层碎裂`, { targetId: recipient.id, multiplier: 1 + formula.shatter });
  }
  if (hit && statusOf(recipient, 'stealth')) {
    delete recipient.statuses.stealth;
    record(state, recipient, 'reveal', `${recipient.name}现形`, { targetId: recipient.id });
  }
  const shield = statusOf(recipient, 'shield');
  const absorbed = Math.min(shield ? statusAmount(shield) : 0, modified);
  if (absorbed > 0) {
    shield.amount = statusAmount(shield) - absorbed;
    record(state, recipient, 'shield', `${recipient.name}的护盾吸收${absorbed}点伤害`, { absorbed, remaining: shield.amount });
    if (shield.amount <= 0) {
      delete recipient.statuses.shield;
      record(state, recipient, 'shield_break', `${recipient.name}的护盾破裂`, { targetId: recipient.id });
    }
  }
  const dealt = loseHP(state, recipient, modified - absorbed, sourceUnitId, type, label,
    { ...details, ...formula, ...(parry ? { parry } : {}), raw: amount, absorbed, intendedTargetId: target.id });
  if (hit && melee && !reaction && alive(attacker) && attacker.id !== recipient.id) {
    const reflect = changes(recipient, 'reflect');
    if (reflect > 0) damageTarget(state, attacker, recipient.id, reflect, 'true', '棘甲反伤', { reaction: true });
    for (const effect of gearEffects(state, recipient, 'frost_thorns')) {
      if (!alive(attacker)) break;
      if ((effect.damage ?? 0) > 0) damageTarget(state, attacker, recipient.id, effect.damage, 'true', '霜纹荆棘', { reaction: true });
      if (!alive(attacker)) break;
      const roll = randomUnit(state);
      const chance = effect.chance ?? .35;
      const statusId = effect.statusId ?? 'chill';
      const statusName = getStatusTemplate(state, statusId)?.name ?? statusId;
      record(state, recipient, 'proc', `霜纹荆棘·${statusName}检定`, { targetId: attacker.id, roll, chance, triggered: roll < chance });
      if (roll < chance) grantStatus(state, attacker, statusId, { sourceUnitId: recipient.id });
    }
  }
  return { recipient, dealt };
}

function mitigation(state, unit, type, hit, pierce) {
  const shatter = hit ? changes(unit, 'shatter') : 0;
  const vulnerability = changes(unit, 'vulnerability');
  const reduction = clamp(changes(unit, 'reduction'), 0, 1);
  const defense = armorOf(state, unit, type, pierce);
  const armorMultiplier = type === 'true' ? 1 : 2000 / (defense + 2000);
  const attributes = unit.stats ?? {};
  const attributeReduction = state.ruleset === 'protocol'
    ? type === 'physical'
      ? (Number(attributes.con ?? 0) + Number(attributes.str ?? 0) + Number(attributes.agi ?? 0)) * .0025
      : type === 'energy'
        ? (Number(attributes.spi ?? 0) + Number(attributes.int ?? 0)) * .004
        : type === 'mental'
          ? Number(attributes.spi ?? 0) * .008
          : 0
    : 0;
  return { shatter, vulnerability, reduction, attributeReduction,
    multiplier: (1 + shatter) * (1 + vulnerability) * (1 - reduction),
    armor: defense, armorMultiplier };
}

function guardFor(state, target) {
  return living(state).find(u => u !== target && u.team === target.team && changes(u, 'intercept') &&
    !changes(u, 'skip') && near(u, target) <= 1 && Math.abs(elevation(state, u) - elevation(state, target)) <= 1 &&
    clearSight(state, u, target));
}

function tick(state, unit, timing) {
  for (const status of values(unit.statuses)) {
    if (!alive(unit)) return;
    if (status.tickTiming !== timing) continue;
    if (status.appliedRound === state.round && status.appliedTurn === state.turn) continue;
    const source = status.sourceUnitId ?? unit.id;
    const amount = status.modifiers?.damage;
    if (amount) damageTarget(state, unit, source, amount * status.stacks, status.modifiers.damageType ?? 'true', status.name);
    const heal = status.modifiers?.heal;
    if (heal && alive(unit)) restoreHP(state, unit, heal * status.stacks, source, status.name);
  }
}

function tickZones(state, unit) {
  for (const zone of values(state.zones)) {
    if (zone.remainingTurns <= 0 || distance(state, unit, zone) > zone.radius) continue;
    if (zone.team !== 'all' && zone.team !== unit.team) continue;
    if (zone.damage > 0) damageTarget(state, unit, zone.sourceUnitId ?? null, zone.damage, zone.damageType, zone.name);
    record(state, zone.sourceUnitId ?? null, 'zone', `${unit.name}受到${zone.name}区域影响`, { zoneId: zone.id, targetId: unit.id, damage: zone.damage });
  }
}
function decayZones(state) {
  for (const zone of values(state.zones)) if (--zone.remainingTurns <= 0) { delete state.zones[zone.id]; record(state, null, 'zone_expire', `${zone.name}区域消散`, { zoneId: zone.id }); }
}

function endTurn(state, unit) {
  if (!unit) return;
  unit.ap = 0;
  tick(state, unit, 'onTurnEnd');
  for (const status of values(unit.statuses)) {
    if (status.durationType !== 'battle_turns') continue;
    if (status.appliedRound === state.round && status.appliedTurn === state.turn) continue;
    if (--status.remainingTurns > 0) continue;
    delete unit.statuses[status.id];
    record(state, unit, 'expire', `${unit.name}的${status.name}结束`, { targetId: unit.id, statusId: status.id });
  }
  record(state, unit, 'end', `${unit.name}结束回合`);
  if (unit === state.units[state.order.at(-1)]) decayZones(state);
}

// Automatic skips are bounded even if sandbox commands make every living unit permanently stunned.
export function settleTurn(state) {
  for (let checked = 0; checked < state.order.length; checked++) {
    const unit = currentUnit(state);
    if (alive(unit)) {
      unit.used = { attack: 0, action: 0 };
      unit.reactionAvailable = true;
      unit.ap = 2;
      record(state, unit, 'turn', `${unit.name}开始回合`, { turn: state.turn });
      tick(state, unit, 'onTurnStart');
      tickZones(state, unit);
      if (refreshOutcome(state)) { unit.ap = 0; return; }
      if (alive(unit) && !changes(unit, 'skip')) return;
      if (alive(unit)) record(state, unit, 'skip', `${unit.name}因控制跳过行动`);
      endTurn(state, unit);
      if (refreshOutcome(state)) return;
    }
    advanceCursor(state);
  }
  const stalled = currentUnit(state);
  if (stalled) stalled.ap = 0;
}

function resetFacing(state) {
  for (const unit of living(state)) {
    const target = unit.lockedTargetId ? state.units[unit.lockedTargetId] : null;
    if (target && alive(target)) unit.facing = signFacing(unit, target);
  }
}
function advanceCursor(state) {
  state.turn++;
  if (state.turn >= state.order.length) { state.turn = 0; state.round++; resetFacing(state); moraleCheck(state); }
}

export function beginBattle(state) {
  state.logs ??= [];
  state.round = 1;
  state.turn = 0;
  state.outcome = null;
  const initiative = living(state).map(unit => {
    const roll = randomDie(state, 20), agility = stat(unit, 'agi');
    const agilityPercent = Number(unit.initiativePercent ?? 0);
    const attackInit = Array.isArray(unit.attackInit) ? unit.attackInit : [];
    const actionInit = Array.isArray(unit.actionInit) ? unit.actionInit : [];
    const flatInit = Number(unit.flatInitiative ?? 0);
    const total = protocolInitiative({ agility, percent: agilityPercent, d20: roll, attack: attackInit, action: actionInit, flat: flatInit });
    return { unitId: unit.id, roll, agility, agilityPercent, attackInit:Math.max(0,...attackInit,0), actionInit:Math.max(0,...actionInit,0), flatInit, total };
  }).sort((a, b) => b.total - a.total || b.agility - a.agility ||
    (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
  state.order = initiative.map(entry => entry.unitId);
  for (const unit of values(state.units)) {
    unit.ap = 0;
    unit.used = { attack: 0, action: 0 };
    unit.reactionAvailable = true;
    // Imported current duration is preserved, but timestamps from another battle are not.
    for (const status of values(unit.statuses)) {
      delete status.appliedRound;
      delete status.appliedTurn;
    }
  }
  record(state, null, 'initiative', '敏捷 + d20：确定先攻次序', { initiative });
  if (!refreshOutcome(state)) settleTurn(state);
  return state;
}

const locateUnit = (state, { x, y }) => unitAt(state, x, y);
const locateCover = (state, { x, y }) => coverAt(state, x, y);
const emptyGround = (state, at) => ground(state, at) && !locateUnit(state, at) && !locateCover(state, at);
const allCells = state => state.grid.flatMap((row, y) => row.map((_, x) => pos(x, y)));

export function reachable(state, type = 'move', unit = currentUnit(state), distanceLimit = undefined) {
  if (!alive(unit) || changes(unit, 'rooted') || changes(unit, 'skip')) return [];
  const limit = distanceLimit ?? Math.max(1, unit.move + changes(unit, 'movement')) * (type === 'sprint' ? 2 : 1);
  const routes = movementOptions(state, unit, limit);
  const sources = type === 'disengage' ? [] : opportunitySources(state, unit).filter(source => canReact(state, source, unit));
  const routeCell = ({ cost, ...cell }, opportunities = []) => ({ ...cell, steps: cost, opportunities });
  if (!sources.length || !routes.length) return routes.map(route => routeCell(route));

  const threatCache = new Map();
  const threatAt = at => {
    const id = key(at.x, at.y);
    if (!threatCache.has(id)) threatCache.set(id, sources.filter(source => threatens(state, source, unit, at)));
    return threatCache.get(id);
  };
  const exits = (from, to) => threatAt(from).filter(source => !threatAt(to).includes(source));
  const safe = new Map(movementOptions(state, unit, limit, {
    allowsStep: (from, to) => !exits(from, to).length,
  }).map(route => [key(route.x, route.y), route]));
  return routes.map(route => {
    const alternate = safe.get(key(route.x, route.y));
    if (alternate) return routeCell(alternate);
    const spent = new Set(), opportunities = [];
    let from = unit;
    for (const to of route.path) {
      for (const { unit: source } of exits(from, to)) {
        if (spent.has(source.id)) continue;
        spent.add(source.id);
        opportunities.push(opportunityDetail(source, from, to));
      }
      from = to;
    }
    return routeCell(route, opportunities);
  });
}

// Split mode assigns an AP to each slot. Two-AP actions occupy both slots.
function paymentError(state, unit, ap, slot, template = {}) {
  if (unit.ap < ap) return `需要 ${ap} AP`;
  if (state.mode === 'split' && (ap === 2 ? unit.used.attack || unit.used.action : unit.used[slot])) {
    return '本回合对应的行动槽已使用';
  }
  if (unit.mp < (template.mp ?? 0)) return '魔力不足';
  if (unit.sp < (template.sp ?? 0)) return '体力不足';
  return null;
}

const normalAttack = Object.freeze({ name: '徒手', range: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' } });
const resourceKey = (effect, fallback) => effect.counterKey ?? fallback;
const counter = (weapon, effect, fallback, initial = 0) => weapon.instance?.counters?.[resourceKey(effect, fallback)] ?? initial;
const findEffect = (effects, kind) => effects.find(e => e.kind === kind);
const isMelee = template => (template.range ?? 1.5) <= 2;

function weaponInfo(state, unit) {
  const mainId = unit.mainHand ?? unit.weapon;
  const weapon = equipmentFor(state, mainId);
  const ammo = findEffect(weapon.effects, 'ammo');
  const soul = findEffect(weapon.effects, 'kill_charge_weapon');
  const backstab = findEffect(weapon.effects, 'backstab');
  const ammoCount = ammo ? counter(weapon, ammo, 'ammo', ammo.capacity) : null;
  const souls = soul ? clamp(counter(weapon, soul, 'souls'), 0, soul.maxStacks ?? 10) : 0;
  const offHand = equipmentFor(state, unit.offHand);
  const stance = unit.stance ?? stanceFor({ mainHand: weapon.template, offHand: offHand.template, shield: equipmentFor(state, unit.shield).template });
  return { ...weapon, ammo, ammoCount, soul, souls, backstab, offHand, stance,
    template: weapon.template ?? normalAttack, soulMultiplier: 1 + souls * (soul?.bonusPerStack ?? .5) };
}

function reaches(state, actor, at, template, ammo) {
  const dz = elevation(state, actor) - elevation(state, at);
  const melee = isMelee(template) && !ammo;
  const range = (template.range ?? 1.5) + (melee || !dz ? 0 : dz > 0 ? (ammo?.highGroundRange ?? 1) : -1);
  return { distance: distance(state, actor, at), dz, range: Math.max(0, range), melee };
}

function validReach(state, actor, at, template, ammo) {
  const geometry = reaches(state, actor, at, template, ammo);
  return ground(state, at) && geometry.distance <= geometry.range + 1e-9 && clearSight(state, actor, at);
}

function visibleEnemy(state, actor, target) {
  return target.team !== actor.team && (!changes(target, 'hidden') || (near(actor, target) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target)) <= 1));
}

function tauntFor(state, actor, template, ammo) {
  const id = statusOf(actor, 'taunt')?.sourceUnitId;
  const taunter = tableEntry(state.units, id);
  const teleport = findEffect(template.effects ?? [], 'teleport_backstab');
  if (!alive(taunter) || !visibleEnemy(state, actor, taunter) || !validReach(state, actor, taunter, template, ammo)) return null;
  if (teleport && (!backCell(state, taunter) || changes(actor, 'rooted'))) return null;
  return taunter;
}

// Threat is the set of tiles the reactor can legally target with its melee weapon.
// Root does not prevent attacking; stun and freeze do. A missing charge means ready
// for snapshots written before opportunity attacks existed.
function opportunitySources(state, mover) {
  return living(state).filter(unit => unit.team !== mover.team && unit.reactionAvailable !== false && !changes(unit, 'skip'))
    .map(unit => ({ unit, weapon: weaponInfo(state, unit) }))
    .filter(({ weapon }) => !weapon.ammo && isMelee(weapon.template) && weapon.template.damage != null);
}

function canReact(state, { unit, weapon }, mover) {
  if (!alive(unit) || unit.reactionAvailable === false || changes(unit, 'skip')) return false;
  const taunter = tauntFor(state, unit, weapon.template);
  return !taunter || taunter.id === mover.id;
}

function threatens(state, source, mover, at) {
  return visibleEnemy(state, source.unit, { ...mover, x: at.x, y: at.y }) &&
    validReach(state, source.unit, at, source.weapon.template);
}

const opportunityDetail = (source, from, to) => ({ unitId: source.id, name: source.name,
  from: pos(from.x, from.y), to: pos(to.x, to.y) });

function area(state, actor, center, template, ammo) {
  return aoeCells(state, actor, center, { ...template, range: at => reaches(state, actor, at, template, ammo).range });
}

function selectionAllows(template, actor, unit) {
  if (!unit) return false;
  switch (template.target ?? 'enemy') {
    case 'enemy': return actor.team !== unit.team;
    case 'ally': return actor.team === unit.team;
    case 'self': return actor.id === unit.id;
    default: return true;
  }
}

function backCell(state, target) {
  const [dx, dy] = target.facing ?? [1, 0];
  const at = pos(target.x - dx, target.y - dy);
  return emptyGround(state, at) && fitsHeight(state, target, at) ? at : null;
}

function diceFormula(spec, actor) {
  if (typeof spec === 'number') return { count: 0, sides: 0, bonus: spec };
  const count = spec?.count ?? 1, sides = spec?.sides ?? 1;
  return { count, sides, bonus: Math.floor((spec?.bonus ?? 0) + stat(actor, spec?.stat) * (spec?.multiplier ?? 1)) };
}
function diceBounds(dice, critical = false) {
  const count = critical ? dice.count * 2 : dice.count;
  return [Math.max(0, count + dice.bonus), Math.max(0, count * dice.sides + dice.bonus)];
}
// Cache distributions by die shape only. Bonuses, mitigation and target state stay live.
const oddsCache = new Map();
function diceAverage(dice, map, critical = false) {
  const count = critical ? dice.count * 2 : dice.count;
  const key = `${count}d${dice.sides}`;
  let probabilities = oddsCache.get(key);
  if (!probabilities) {
    probabilities = [1];
    for (let die = 0; die < count; die++) {
      const next = Array(probabilities.length + dice.sides).fill(0);
      let window = 0;
      for (let i = 1; i < next.length; i++) {
        window += (probabilities[i - 1] ?? 0) - (probabilities[i - dice.sides - 1] ?? 0);
        next[i] = Math.max(0, window / dice.sides);
      }
      probabilities = next;
    }
    if (oddsCache.size >= 64) oddsCache.delete(oddsCache.keys().next().value);
    oddsCache.set(key, probabilities);
  }
  return probabilities.reduce((sum, probability, raw) => sum + probability * map(Math.max(0, raw + dice.bonus)), 0);
}
function diceRoll(state, formula, critical = false) {
  const count = critical ? formula.count * 2 : formula.count;
  const { rng, rolls, total } = rollDice(state.rng, count, formula.sides);
  state.rng = rng;
  return { rolls, ...formula, value: Math.max(0, total + formula.bonus) };
}

function targetProfile(state, actor, target, at, template, context = {}) {
  const { weapon, origin = actor, teleport, cover = false } = context;
  const geometry = reaches(state, origin, at, template, weapon?.ammo);
  const high = Math.sign(geometry.dz) * 2 + (geometry.dz > 0 ? weapon?.ammo?.highGroundAccuracy ?? 0 : 0);
  const arc = target && !cover ? facingArc(target, origin) : 'front';
  const backstab = weapon?.backstab && arc !== 'front' && geometry.melee;
  const flanked = target && !cover ? flank(state, origin, target) : false;
  const protectedBy = target && !cover && !geometry.melee ? coverBetween(state, origin, target) : null;
  const penalty = protectedBy?.cover ?? 0;
  const size = cover ? 0 : typeof target?.size === 'number' ? Math.max(0, target.size - 1) : target?.size === 'large' ? 2 : target?.size === 'small' ? -1 : 0;
  const sizeModifier = cover || !target ? 0 : sizeHitModifier(actor, target);
  const distanceModifier = distanceTier(geometry.distance).hit;
  const weaponRangeModifier = distanceTier(Math.max(geometry.distance, geometry.range)).range;
  const stance = weapon?.stance ?? actor.stance ?? 'unarmed';
  const rules = stanceRules(stance);
  const rangedDistance = weapon && !geometry.melee && distanceModifier < 0 ? rules.rangedDistancePenalty ?? distanceModifier : distanceModifier;
  const closeRange = rules.closeRange && geometry.melee && geometry.distance <= 2 ? 4 : rangedDistance;
  // The protocol does not grant an implicit STR/AGI-to-hit bonus. Associated attributes
  // belong in the damage formula; hit comes from explicit weapon/skill and combat modifiers.
  const accuracy = (template.accuracy ?? 0) + (state.ruleset === 'sandbox' ? stat(actor, geometry.melee ? 'str' : 'agi') : 0)
    + high + size + closeRange + (state.ruleset === 'sandbox' ? 0 : weaponRangeModifier) + changes(actor, 'accuracy')
    + (cover || !target ? 0 : changes(target, 'incomingAccuracy')) + (flanked ? 2 : 0) - penalty;
  const explicitEvasion = changes(target, 'evasion') + changes(target, 'incomingAccuracy');
  const equipmentDefense = gearFor(state, target).reduce((d, g) => d + (g.template?.defense ?? 0), 0)
    + (target.shield ? equipmentFor(state, target.shield).template?.defense ?? 0 : 0);
  // Protocol mode has no implicit AGI-to-defense; sandbox keeps its legacy balance only for regression fixtures.
  const defense = cover ? 8 : state.ruleset === 'sandbox'
    ? 10 + Math.floor(stat(target, 'agi') / 2) + equipmentDefense
    : 10 + explicitEvasion + equipmentDefense;
  const advantages = changes(actor, 'advantage') + Number(Boolean(backstab || teleport)) + (template.advantage ?? 0);
  const disadvantages = changes(actor, 'disadvantage') + (template.disadvantage ?? 0);
  const advantage = Math.sign(advantages - disadvantages);
  const saveStat = !cover && target ? template.save : null;
  const saveDC = saveStat ? (template.saveDC ?? 12 + Math.floor(stat(actor, 'int') / 2)) : null;
  const saveBonus = saveStat ? stat(target, saveStat) : 0;
  const saveChance = saveStat ? saveOdds(saveDC, saveBonus) : 0;
  const automatic = !weapon && (!template.damage || saveStat || template.autoHit);
  const hitChance = automatic ? 1 : hitOdds(defense, accuracy, advantages, disadvantages);
  const critChance = automatic ? 0 : criticalOdds(advantages, disadvantages);
  const offHandMultiplier = weapon?.stance === 'dual_wield' && weapon.offHand?.template?.damage ? 1.5 : 1;
  const intentSpec = INTENTS[context.intent ?? 'normal'] ?? INTENTS.normal;
  // Intent is applied once in applyStrike after the intent contest; do not fold it into this preview multiplier.
  const multiplier = (weapon?.soulMultiplier ?? 1) * offHandMultiplier * (1 + changes(actor, 'damageBonus')) * (backstab ? 1 + (weapon.backstab.bonusMultiplier ?? .25) : 1)
    * (teleport ? 1 + (teleport.bonusMultiplier ?? .5) : 1);
  const damageType = template.damage?.type ?? 'physical';
  const tierPower = ({1:2, 2:2.8, 3:4, 4:8, 5:15, 6:35, 7:80})[actor.tier ?? 1] ?? 2;
  const protocolInitial = state.ruleset === 'protocol' && template.damage
    ? stat(actor, template.damage.stat ?? (geometry.melee ? 'str' : 'int')) * 10 * tierPower
      + Number(template.power ?? 20) + Number(weapon?.template?.attack ?? 0)
    : null;
  const armorPierce = { flat: weapon?.ammo?.armorPierce ?? template.armorPierce ?? 0, percent: rules.armorPenetration ?? 0 };
  const recipient = cover || template.damage == null ? target : guardFor(state, target) ?? target;
  const reduction = cover ? { multiplier: 1, armor: target.armor ?? 0 } : mitigation(state, recipient, damageType, true, armorPierce);
  const shield = cover ? null : statusOf(recipient, 'shield');
  const absorb = shield ? statusAmount(shield) : 0;
  const dice = template.damage == null ? null : diceFormula(template.damage, actor);
  const shown = (raw, factor = 1) => Math.max(0, Math.floor(Math.floor(raw * multiplier * factor) * reduction.multiplier * reduction.armorMultiplier) - absorb);
  const damage = dice ? (protocolInitial == null ? diceBounds(dice).map(n => shown(n)) : [shown(protocolInitial), shown(protocolInitial)]) : [0, 0];
  const criticalDamage = dice && critChance > 0 ? diceBounds(dice, true).map(n => shown(n)) : null;
  const savedDamage = dice && saveStat ? diceBounds(dice).map(n => shown(n, .5)) : null;
  const expectedDamage = !dice ? 0 : (hitChance - critChance - saveChance) * diceAverage(dice, shown)
    + (criticalDamage ? critChance * diceAverage(dice, shown, true) : 0)
    + (savedDamage ? saveChance * diceAverage(dice, raw => shown(raw, .5)) : 0);
  const expectedD20 = saveStat ? 10.5 : automatic ? null : advantage > 0 ? 13.825 : advantage < 0 ? 7.175 : 10.5;
  const combo = !cover && weapon?.backstab ? { bleedStacks: weapon.backstab.bleedStacks ?? 1,
    bonusDamage: weapon.backstab.comboDamage ?? 0, on: backstab ? 'hit' : 'critical' } : null;
  return { id: target.id, targetId: target.id, name: target.name, x: at.x, y: at.y, ...geometry,
    recipientId: recipient.id, arc, backstab: Boolean(backstab), flanked, accuracy, defense, highGround: high,
    sizeModifier, distanceModifier: closeRange, weaponRangeModifier, stance, stanceRules: rules,
    accuracySources: { explicit: template.accuracy ?? 0, highGround: high, size: size + sizeModifier, distance: closeRange, weaponRange: weaponRangeModifier, status: changes(actor, 'accuracy') },
    intent: context.intent ?? 'normal', intentDifficulty: intentSpec.difficulty, intentMultiplier: intentSpec.multiplier,
    cover: penalty, coverId: protectedBy?.id ?? null, advantage, advantages, disadvantages, hitChance, critChance, expectedD20,
    automatic: Boolean(automatic), saveStat, saveDC, saveBonus, saveChance, multiplier, damageType, armorPierce, protocolInitial,
    stance, offHand: Boolean(weapon?.offHand?.template), armor: reduction.armor, damagePipeline: reduction.armorMultiplier,
    shield: absorb, damage, damageMin: damage[0], damageMax: damage[1], protocolInitial, criticalDamage,
    savedDamage, expectedDamage, dice, combo };
}

const ACTIONS = Object.freeze({
  move: { ap: 1, slot: 'action' }, sprint: { ap: 2, slot: 'action' }, disengage: { ap: 1, slot: 'action' },
  attack: { ap: 1, slot: 'attack' }, reload: { ap: 1, slot: 'action' },
  brace: { ap: 1, slot: 'action' }, block: { ap: 1, slot: 'action' }, shield_bash: { ap: 1, slot: 'attack', sp: 2 }, use_item: { ap: 0, slot: null },
  charge: { ap: 1, slot: 'action' }, lock_on: { ap: 1, slot: 'action' }, scan: { ap: 1, slot: 'action' },
  grapple: { ap: 1, slot: 'attack' }, disarm: { ap: 1, slot: 'attack' }, trip: { ap: 1, slot: 'attack' }, push: { ap: 1, slot: 'attack' },
  flee: { ap: 1, slot: 'action' }, detour: { ap: 1, slot: 'action' }, interact: { ap: 1, slot: 'action' }, end: { ap: 0, slot: null },
});
const movementNames = Object.freeze({ move: '移动', sprint: '疾跑', disengage: '撤离' });
const isMovement = type => Object.hasOwn(movementNames, type);
const needsTarget = type => isMovement(type) || ['attack', 'skill', 'shield_bash', 'interact', 'lock_on', 'grapple', 'disarm', 'trip', 'push'].includes(type);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const healMultiplier = (state, actor) => 1 + gearEffects(state, actor, 'healing_shield').reduce((sum, effect) => sum + (effect.healBonus ?? .25), 0);
const healShieldRatio = (state, actor) => gearEffects(state, actor, 'healing_shield').reduce((sum, effect) => sum + (effect.shieldRatio ?? .5), 0);

function inInteractionRange(state, actor, at) {
  return near(actor, at) <= 1 && Math.abs(elevation(state, actor) - elevation(state, at)) <= 1 && clearSight(state, actor, at);
}
function nearbyCovers(state, at) {
  return values(state.covers).filter(c => c.hp > 0 && inInteractionRange(state, at, c)).sort(byId);
}

function usableTiles(state, actor, template, weapon) {
  return allCells(state).filter(at => validReach(state, actor, at, template, weapon?.ammo) &&
    !((template.shape === 'line' || template.shape === 'cone' || template.shape === 'fan') && sameCell(actor, at)));
}
function shapeTargets(state, actor, cells, template) {
  const keys = new Set(cells.map(at => key(at.x, at.y)));
  return living(state).filter(unit => keys.has(key(unit.x, unit.y)) && selectionAllows(template, actor, unit));
}

/** With no x/y, queries highlighting. With both coordinates, validates one executable action. */
export function preview(state, action) {
  if (state.outcome) return fail('战斗已经结束');
  const unit = currentUnit(state);
  if (!alive(unit) && action?.type !== 'end') return fail('当前单位不能行动');
  if (!action || typeof action !== 'object' || Array.isArray(action)) return fail('动作格式错误');
  const { type, x, y, skillId } = action;
  if (!Object.keys(action).every(field => ['type', 'x', 'y', 'skillId', 'bonusDice', 'intent', 'nonLethal', 'maneuver'].includes(field))) return fail('动作含未知字段');
  if (action.bonusDice !== undefined && (!Number.isInteger(action.bonusDice) || action.bonusDice < 0 || action.bonusDice > Math.min(2, unit?.bonusDice ?? 0))) return fail('奖励骰储备不足');
  if (action.intent !== undefined && !['normal','function','core','kill','concept'].includes(action.intent)) return fail('意图类型无效');
  const skill = type === 'skill' ? tableEntry(state.skills, skillId) : null;
  if (type === 'skill' && (!skill || !unit.skills.includes(skillId))) return fail('单位没有此技能');
  const cost = skill ?? tableEntry(ACTIONS, type);
  if (!cost) return fail('未知动作');
  const aimed = needsTarget(type);
  const unplaced = x === undefined && y === undefined;
  if (type !== 'skill' && skillId !== undefined || (!unplaced && !aimed)) return fail('动作带有不适用的参数');
  if (!unplaced && (!Number.isInteger(x) || !Number.isInteger(y) || !tileAt(state, x, y))) return fail('目标坐标超出棋盘');
  const { ap, slot } = cost;
  const common = { ok: true, ap, cost: ap, slot, mp: cost.mp ?? 0, sp: cost.sp ?? 0 };
  if (type === 'end') return common;
  if (changes(unit, 'skip')) return fail('当前单位受控制，只能结束回合');
  const cannotPay = paymentError(state, unit, ap, slot, cost);
  if (cannotPay) return fail(cannotPay, { ap });
  const center = unplaced ? undefined : pos(x, y);
  const weapon = weaponInfo(state, unit);
  if (type === 'shield_bash' && !unit.shield) return fail('没有盾牌');
  if (type === 'reload') {
    if (!weapon.ammo) return fail('当前武器不需要装填');
    if (weapon.ammoCount >= weapon.ammo.capacity) return fail('弹仓已满');
    return { ...common, ammo: weapon.ammoCount, capacity: weapon.ammo.capacity };
  }
  if (type === 'block') {
    if (stanceFor({ mainHand: weapon.template, offHand: weapon.offHand?.template, shield: equipmentFor(state, unit.shield).template }) !== 'sword_shield') return fail('只有剑盾姿态可格挡');
    return { ...common, name: '格挡', reduction: unit.blockMode === 'heavy' ? .45 : .25, turns: 1 };
  }
  if (type === 'brace') {
    const [nearbyCover] = nearbyCovers(state, unit);
    return { ...common, name: '架势防御', coverId: nearbyCover?.id ?? null, reduction: STATUSES.guarded.modifiers.reduction,
      turns: nearbyCover ? 2 : 1 };
  }
  if (type === 'use_item') {
    const item = equipmentFor(state, unit.offHand);
    if (unit.stance !== 'attunement' || item.template?.kind !== 'consumable') return fail('只有同调姿态可以免费使用副手道具');
    if ((unit.attunementCharges ?? 0) <= 0) return fail('同调道具次数已用尽');
    return { ...common, name: `使用${item.template.name}`, maneuver: 'use_item', itemId: unit.offHand };
  }
  if (type === 'charge') return { ...common, name: '蓄力', maneuver: 'charge' };
  if (type === 'scan') return { ...common, name: '探察', maneuver: 'scan' };
  if (type === 'flee') return { ...common, name: '逃跑', maneuver: 'flee' };
  if (type === 'detour') return { ...common, name: '绕行', maneuver: 'detour' };
  if (type === 'lock_on') {
    const target = locateUnit(state, center);
    if (!target || target.team === unit.team) return fail('定位必须指定敌方单位');
    return { ...common, name: '定位', maneuver: 'lock_on', targetId: target.id };
  }
  if (['grapple','disarm','trip','push'].includes(type)) {
    const target = locateUnit(state, center);
    if (!target || target.team === unit.team) return fail('战术对抗必须指定敌方单位');
    if (near(unit, target) > 1 || !clearSight(state, unit, target)) return fail('战术对抗需要贴身且视线畅通');
    return { ...common, name: ({ grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞' })[type], maneuver: type, targetId: target.id };
  }
  if (isMovement(type)) {
    if (changes(unit, 'rooted')) return fail('定身时不能移动');
    const cells = reachable(state, type, unit);
    if (unplaced) return { ...common, cells };
    const choice = cells.find(at => sameCell(at, center));
    if (!choice) return fail('无法到达：距离、占位、墙体或陡崖阻挡', { cells });
    return { ...common, cells, path: choice.path, steps: choice.steps, opportunities: choice.opportunities,
      dz: elevation(state, center) - elevation(state, unit) };
  }
  if (type === 'interact') {
    const objects = values(state.interactives).filter(v => !v.spent && inInteractionRange(state, unit, v)).sort(byId);
    if (unplaced) return { ...common, cells: objects.map(v => pos(v.x, v.y)) };
    const item = objects.find(v => sameCell(v, center));
    if (!item) return fail('没有可用的邻近互动点');
    const cells = item.kind === 'barrel' ? area(state, unit, center, { shape: 'circle', range: 2, radius: 1.5 }) : [center];
    const keyset = new Set(cells.map(at => key(at.x, at.y)));
    const targets = item.kind === 'altar' ? [{ id: unit.id, targetId: unit.id, name: unit.name, x: unit.x, y: unit.y, heal: [8, 8] }]
      : living(state).filter(u => keyset.has(key(u.x, u.y))).map(u => {
        const guard = guardFor(state, u) ?? u;
        const hit = mitigation(state, guard, 'energy', true, 0);
        const shield = statusOf(guard, 'shield');
        const damage = Math.max(0, Math.floor(12 * hit.multiplier) - hit.armor - (shield ? statusAmount(shield) : 0));
        return { id: u.id, targetId: u.id, recipientId: guard.id, name: u.name, x: u.x, y: u.y, damage: [damage, damage], expectedDamage: damage, hitChance: 1 };
      });
    return { ...common, interactiveId: item.id, kind: item.kind, cells, targets, center };
  }
  const attack = type === 'attack' || type === 'shield_bash';
  const shieldBash = type === 'shield_bash';
  const template = shieldBash ? { name: '盾击', range: 1, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' }, effects: [{ kind: 'knockback', distance: 1 }, { kind: 'status', statusId: 'stun', turns: 1 }] } : attack ? weapon.template : skill;
  const effect = attack ? undefined : findEffect(template.effects ?? [], 'teleport_backstab');
  if (effect && changes(unit, 'rooted')) return fail('定身时不能瞬移');
  if (attack && !shieldBash && weapon.ammo && weapon.ammoCount <= 0) return fail('弹仓已空，请装填');
  const triggers = attack && !shieldBash ? weapon.effects.map(e => ({ ...e })) : (template.effects ?? []).map(e => ({ ...e }));
  const stance = unit.stance ?? (unit.offHand ? (unit.offHand.kind === 'consumable' ? 'attunement' : 'dual_wield') : unit.shield ? 'sword_shield' : 'light_blade');
  const tuning = { name: template.name, shape: template.shape ?? 'single', stance, effects: triggers,
    ...(attack && !shieldBash ? { souls: weapon.souls, multiplier: weapon.soulMultiplier, ammo: weapon.ammoCount,
      instanceId: weapon.instance?.id ?? null } : {}) };
  if (unplaced) {
    return { ...common, ...tuning, cells: usableTiles(state, unit, template, attack && !shieldBash ? weapon : null) };
  }
  const geometry = reaches(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  if (!ground(state, center)) return fail('墙体无法指定', geometry);
  if (geometry.distance > geometry.range + 1e-9) return fail('目标超出射程', geometry);
  if (!clearSight(state, unit, center)) return fail('墙体阻断视线', geometry);
  const aimedUnit = locateUnit(state, center);
  const solid = locateCover(state, center);
  const coverTarget = Boolean(solid && (attack || template.damage != null));
  const cells = area(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  const aoe = (template.shape ?? 'single') !== 'single';
  if (!cells.length) return fail('请选择一个方向', geometry);
  if (!aoe) {
    if (!(attack ? aimedUnit && aimedUnit.team !== unit.team : selectionAllows(template, unit, aimedUnit)) && !coverTarget && template.target !== 'cell') {
      return fail('该格没有合适的目标', geometry);
    }
    if (aimedUnit && aimedUnit.team !== unit.team && !visibleEnemy(state, unit, aimedUnit)) return fail('目标正在隐身', geometry);
  }
  const hostile = attack || template.target === 'enemy' || (template.damage != null && template.target !== 'ally' && template.target !== 'self');
  const taunter = hostile ? tauntFor(state, unit, template, attack && !shieldBash ? weapon.ammo : null) : null;
  if (taunter && (!aimedUnit || aimedUnit.id !== taunter.id)) return fail(`受嘲讽，必须指定${taunter.name}`, geometry);
  const blink = effect && aimedUnit ? backCell(state, aimedUnit) : null;
  if (effect && !blink) return fail('目标背后的瞬移落点被阻挡', geometry);
  const origin = blink ? { ...unit, ...blink } : unit;
  const templateForHit = blink ? { ...template, range: 1.5 } : template;
  const targetUnits = attack ? aimedUnit ? [aimedUnit] : [] : shapeTargets(state, unit, cells, template);
  const areaAttack = (template.shape ?? 'single') !== 'single';
  const declaredIntent = action.intent ?? unit.intent ?? 'normal';
  const resolvedIntent = areaAttack ? 'normal' : declaredIntent;
  const targets = targetUnits.map(t => ({ ...targetProfile(state, unit, t, t, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, teleport: effect, intent: resolvedIntent }),
    bonusDice: action.bonusDice ?? 0, intent: resolvedIntent, nonLethal: action.nonLethal ?? unit.nonLethal ?? false }));
  if (template.damage != null) {
    for (const c of values(state.covers).filter(c => c.hp > 0 && cells.some(at => sameCell(at, c))).sort(byId)) {
      targets.push({ ...targetProfile(state, unit, c, c, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, cover: true, intent: action.intent ?? unit.intent ?? 'normal' }), kind: 'cover' });
    }
  }
  if (template.heal != null) {
    const healing = diceBounds(diceFormula(template.heal, unit)).map(n => Math.floor(n * healMultiplier(state, unit)));
    for (const target of targets) if (target.kind !== 'cover') {
      target.heal = healing;
      target.healMin = healing[0]; target.healMax = healing[1];
      target.healingShield = healing.map(n => Math.min(10000, Math.floor(n * healShieldRatio(state, unit))));
    }
  }
  const first = targets.find(t => sameCell(t, center)) ?? targets[0];
  return { ...first, ...common, ...geometry, ...tuning, ...(first ? { damageMultiplier: first.multiplier } : {}),
    bonusDice: action.bonusDice ?? 0, intent: action.intent ?? unit.intent ?? 'normal', nonLethal: action.nonLethal ?? unit.nonLethal ?? false,
    dXYZ: geometry.distance, cells, targets, center, ...(blink ? { teleport: blink } : {}), hostile };
}

function maneuverContest(state, actor, target, maneuver) {
  const attackStat = maneuver === 'grapple' ? 'str' : 'agi';
  const defenseStat = maneuver === 'trip' ? 'agi' : 'str';
  const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
  const attackerTotal = stat(actor, attackStat) + attackerRoll;
  const defenderTotal = stat(target, defenseStat) + defenderRoll;
  const success = attackerTotal >= defenderTotal;
  record(state, actor, 'contest', `${actor.name}${success ? '成功' : '未能'}${({ grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞' })[maneuver]}`, {
    maneuver, targetId: target.id, attackerRoll, defenderRoll, attackerTotal, defenderTotal, success });
  return success;
}
function changeCounter(state, actor, weapon, effect, fallback, after) {
  const counterKey = resourceKey(effect, fallback);
  const before = counter(weapon, effect, fallback, fallback === 'ammo' ? effect.capacity : 0);
  weapon.instance.counters ??= {};
  weapon.instance.counters[counterKey] = after;
  record(state, actor, 'counter', `${weapon.template.name} · ${counterKey} ${before} → ${after}`,
    { instanceId: weapon.instance.id, counterKey, before, after });
}

function resolveCheck(state, actor, profile) {
  if (profile.saveStat) {
    const saveRoll = randomDie(state, 20), saveTotal = saveRoll + profile.saveBonus;
    const saved = saveTotal >= profile.saveDC;
    record(state, actor, 'save', `${profile.name}${saved ? '通过' : '未通过'}豁免 (${saveTotal}/${profile.saveDC})`,
      { targetId: profile.id, saveStat: profile.saveStat, saveRoll, saveBonus: profile.saveBonus, saveTotal, saveDC: profile.saveDC, saved });
    return { hit: true, critical: false, saved };
  }
  if (profile.automatic) return { hit: true, critical: false, rating: ratingFor(11), intent: { success: true, multiplier: 1 }, saved: false };
  const requestedBonus = profile.bonusDice ?? 0;
  const { rng, rolls: dice, value: selected } = requestedBonus || actor.penaltyDice
    ? rollProtocolD20(state.rng, { bonus: requestedBonus, penalty: actor.penaltyDice ?? 0 })
    : rollD20(state.rng, profile.advantages, profile.disadvantages);
  actor.bonusDice = Math.max(0, (actor.bonusDice ?? 0) - requestedBonus); actor.penaltyDice = 0;
  state.rng = rng;
  const total = selected + profile.accuracy;
  const rating = ratingFor(total);
  const critical = selected === 20;
  const hit = selected !== 1 && rating.multiplier > 0;
  let intent = { required: false, success: true, multiplier: 1 };
  const defender = state.units[profile.id];
  if (hit && defender && profile.intent && profile.intent !== 'normal') {
    const defenderD20 = randomDie(state, 20);
    const weakness = changes(defender, 'intentDifficulty');
    const intentSpec = { ...(INTENTS[profile.intent] ?? INTENTS.normal), difficulty: Math.max(0, (INTENTS[profile.intent]?.difficulty ?? 0) + weakness) };
    const ratingBonus = { 平暴击: 10, 强暴击: 20, 超暴击: 30 }[rating.name] ?? 0;
    const attackerTier = actor.tier ?? 1, defenderTier = defender.tier ?? 1;
    const attackerBase = attackerTier * 5, defenderBase = defenderTier * 5;
    const attackerTotal = attackerBase + selected + ratingBonus;
    const defenderTotal = defenderBase + defenderD20 + intentSpec.difficulty;
    intent = intentCheck(intentSpec, attackerTier, defenderTier, selected, defenderD20, ratingBonus);
    record(state, actor, 'intent', `${profile.name}${intent.success ? '意图成立' : '意图受阻'}`, {
      targetId: profile.id, intent: profile.intent, attackerTier, defenderTier, attackerBase, attackerD20: selected,
      rating: rating.name, ratingBonus, attackerTotal, defenderBase, defenderD20, intentDifficulty: intentSpec.difficulty,
      defenderTotal, ...intent });
  }
  // Failed intent falls back to an ordinary landed hit; it does not erase the attack.
  const effectiveHit = hit;
  record(state, actor, 'roll', `${profile.name}：${critical ? '暴击' : hit ? '命中' : '未命中'} (${total}/${profile.defense})`, {
    targetId: profile.id, dice, selected, total, accuracy: profile.accuracy, defense: profile.defense, advantage: profile.advantage,
    advantages: profile.advantages, disadvantages: profile.disadvantages, highGround: profile.highGround, cover: profile.cover,
    ...(profile.coverId ? { coverId: profile.coverId } : {}),
    rating, distanceTier: distanceTier(profile.distance), bonusDice: requestedBonus,
    distance: profile.distance, dz: profile.dz, flanked: profile.flanked, arc: profile.arc, hit: effectiveHit, critical,
    intent,
  });
  return { hit: effectiveHit, critical, rating, intent, saved: false };
}

function coverDamage(state, actor, cover, amount, details) {
  const before = cover.hp;
  cover.hp = Math.max(0, before - Math.max(0, amount - (cover.armor ?? 0)));
  record(state, actor, 'cover_damage', `${cover.name}受到${before - cover.hp}点伤害`,
    { ...details, coverId: cover.id, amount: before - cover.hp, hpBefore: before, hpAfter: cover.hp });
  if (!cover.hp) record(state, actor, 'cover_break', `${cover.name}坍塌`, { coverId: cover.id });
}

function knockback(state, actor, target, effect) {
  const [dx, dy] = signFacing(actor, target);
  if (!dx && !dy) return;
  const from = pos(target.x, target.y);
  for (let i = 0; i < (effect.distance ?? 1); i++) {
    const at = pos(target.x + dx, target.y + dy);
    if (!canStep(state, target, at)) {
      damageTarget(state, target, actor.id, effect.collisionDamage ?? 5, 'true', '撞击');
      if (alive(target)) grantStatus(state, target, effect.statusId ?? 'stun', { sourceUnitId: actor.id });
      break;
    }
    Object.assign(target, at);
  }
  record(state, actor, 'knockback', `${target.name}遭到击退`, { targetId: target.id, from, to: pos(target.x, target.y) });
}

function healWithGear(state, actor, target, spec, name) {
  const dice = diceRoll(state, diceFormula(spec, actor));
  const multiplier = healMultiplier(state, actor), ratio = healShieldRatio(state, actor);
  const amount = Math.floor(dice.value * multiplier);
  restoreHP(state, target, amount, actor.id, name, { dice, multiplier });
  const shield = Math.floor(amount * ratio);
  if (shield > 0) grantStatus(state, target, 'shield', { sourceUnitId: actor.id, amount: shield });
}

function offHandFollowup(state, actor, target, primaryProfile, primaryRating) {
  const weapon = weaponInfo(state, actor);
  if (weapon.stance !== 'dual_wield' || !weapon.offHand.template?.damage || !alive(target)) return;
  const cost = (actor.tier ?? 1) * 10;
  if ((actor.sp ?? 0) < cost || (primaryRating?.multiplier ?? 0) < .8) return;
  actor.sp -= cost;
  const offTemplate = weapon.offHand.template;
  const profile = targetProfile(state, actor, target, target, offTemplate, { weapon: { ...weapon.offHand, stance: 'dual_wield' } });
  profile.dice = diceFormula(offTemplate.damage, actor);
  profile.disadvantages = primaryRating?.multiplier >= 1.3 ? 0 : Math.max(1, profile.disadvantages ?? 0);
  profile.bonusDice = 0;
  record(state, actor, 'followup', `${actor.name}发动副手追击`, { targetId: target.id, cost, weaponId: weapon.offHand.instance?.id ?? null });
  const result = resolveCheck(state, actor, profile);
  if (!result.hit) return;
  const dice = diceRoll(state, profile.dice, result.critical);
  const scaled = Math.floor(dice.value * profile.multiplier * (result.rating?.multiplier ?? 1) * .5);
  damageTarget(state, target, actor.id, scaled, profile.damageType, '副手追击', {
    attacker: actor, hit: true, melee: profile.melee, armorPierce: profile.armorPierce,
    details: { dice, rating: result.rating?.name, followup: true, cost },
  });
}

function applyEffects(state, actor, target, effects) {
  for (const effect of effects) {
    if (!alive(target)) break;
    if (effect.kind === 'knockback') knockback(state, actor, target, effect);
    else if (effect.kind === 'status') {
      const recipient = effect.target === 'self' || effect.statusId === 'stealth' && actor.team !== target.team ? actor : target;
      if (alive(recipient)) grantStatus(state, recipient, effect.statusId, { ...effect, sourceUnitId: actor.id });
    } else if (effect.kind === 'cleanse') {
      const cleared = Object.values(target.statuses).filter(s => ['control', 'dot', 'debuff'].includes(s.category));
      for (const status of cleared) if (status.durationType !== 'persistent') delete target.statuses[status.id];
      record(state, actor, 'cleanse', `${target.name}受到净化`,
        { targetId: target.id, removed: cleared.filter(s => s.durationType !== 'persistent').map(s => s.id) });
    }
  }
}

function applyStrike(state, actor, action, plan, opportunityWeapon = null) {
  const weapon = opportunityWeapon ?? (action.type === 'attack' ? weaponInfo(state, actor) : null);
  const template = action.type === 'shield_bash'
    ? { name: '盾击', range: 1, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' }, effects: [{ kind: 'knockback', distance: 1 }, { kind: 'status', statusId: 'stun', turns: 1 }] }
    : weapon ? weapon.template : state.skills[action.skillId];
  if (weapon?.ammo) changeCounter(state, actor, weapon, weapon.ammo, 'ammo', weapon.ammoCount - 1);
  if (plan.hostile && statusOf(actor, 'stealth')) {
    delete actor.statuses.stealth;
    record(state, actor, 'reveal', `${actor.name}发动进攻，解除隐身`);
  }
  if (plan.teleport) {
    const from = pos(actor.x, actor.y);
    Object.assign(actor, plan.teleport);
    record(state, actor, 'teleport', `${actor.name}瞬移至目标背后`, { from, to: plan.teleport });
  }
  if (!sameCell(actor, plan.center)) actor.facing = signFacing(actor, plan.center);
  for (const profile of plan.targets) {
    const target = (profile.kind === 'cover' ? state.covers : state.units)[profile.id];
    if (!alive(target)) continue;
      const { hit, critical, rating, intent, saved } = resolveCheck(state, actor, profile);
    if (!hit) continue;
    let recipient = target;
    if (profile.dice) {
      const dice = state.ruleset === 'protocol' && profile.protocolInitial != null
        ? { rolls: [], count: 0, sides: 0, bonus: profile.protocolInitial, value: profile.protocolInitial }
        : diceRoll(state, profile.dice, critical);
      const stance = actor.stance ?? stanceLabel[stanceFor({ mainHand: actor.mainHand ?? actor.weapon, offHand: actor.offHand, shield: actor.shield })];
      const sizeScale = meleeMultiplier(actor);
      const ratingScale = rating?.multiplier ?? (critical ? 2 : 1);
      const intentScale = intent?.success ? intent.multiplier ?? 1 : 1;

      const stanceScale = profile.stance === 'greatsword' ? (actor.greatswordMode === 'defensive' ? 1.5 : 1.3) : 1;
      const offHandScale = profile.stance === 'dual_wield' && profile.offHand ? .5 : 1;
          const scaled = Math.floor(dice.value * profile.multiplier * sizeScale * ratingScale * intentScale * stanceScale * offHandScale * (saved ? .5 : 1));
        const details = { dice, critical, saved, rating: rating?.name ?? '有效', ratingMultiplier: ratingScale, intent: intent ?? { success: true, multiplier: 1 }, attackMultiplier: profile.multiplier, stanceScale, offHandScale };
      if (profile.kind === 'cover') { coverDamage(state, actor, target, scaled, details); continue; }
      const hpBefore = target.hp;
      ({ recipient } = damageTarget(state, target, actor.id, scaled, profile.damageType, template.name,
        { attacker: actor, hit: true, melee: profile.melee, armorPierce: profile.armorPierce, details }));
      if (profile.nonLethal && target === recipient && target.hp === 0) {
        target.hp = 1;
        record(state, actor, 'nonlethal', `${target.name}被非致死攻击留有 1 HP`, { targetId: target.id, hpBefore, hpAfter: 1 });
      }
      if (weapon?.backstab && alive(recipient) && (critical || profile.backstab)) {
        grantStatus(state, recipient, 'bleed', { stacks: weapon.backstab.bleedStacks ?? 1, sourceUnitId: actor.id });
        if ((weapon.backstab.comboDamage ?? 0) > 0 && alive(actor)) {
          damageTarget(state, recipient, actor.id, weapon.backstab.comboDamage, profile.damageType, '双生血牙连击', { reaction: true });
        }
      }
      if (action.type === 'attack' && alive(recipient) && recipient.team !== actor.team) offHandFollowup(state, actor, recipient, profile, rating);
      // Guard interception is a direct killing blow if the guard and victim are enemies.
      if (weapon?.soul && !alive(recipient) && recipient.team !== actor.team) {
        const before = counter(weapon, weapon.soul, 'souls');
        const cap = weapon.soul.maxStacks ?? 10;
        if (before < cap) changeCounter(state, actor, weapon, weapon.soul, 'souls', before + 1);
      }
    }
    if (profile.kind === 'cover' || !alive(recipient)) continue;
    if (template.heal != null) healWithGear(state, actor, recipient, template.heal, template.name);
    if (opportunityWeapon) {
      if (alive(actor) && findEffect(weapon.effects, 'opportunity_root')) {
        grantStatus(state, recipient, 'root', { sourceUnitId: actor.id, turns: 1 });
      }
    } else if (!saved) applyEffects(state, actor, recipient, template.effects ?? []);
  }
}

function applyMovement(state, actor, type, plan) {
  const from = pos(actor.x, actor.y), path = [];
  const canContinue = () => alive(actor) && !changes(actor, 'skip') && !changes(actor, 'rooted');
  for (const to of plan.path) {
    if (type !== 'disengage') {
      // Snapshot the reactor order, but recheck eligibility before each strike:
      // interception, retaliation and status effects can change the live board.
      const sources = opportunitySources(state, actor);
      for (const source of sources) {
        const { unit, weapon } = source;
        if (!canReact(state, source, actor) || !threatens(state, source, actor, actor) ||
          threatens(state, source, actor, to)) continue;
        unit.reactionAvailable = false;
        const center = pos(actor.x, actor.y);
        record(state, unit, 'opportunity', `${unit.name}对${actor.name}发动借机攻击`,
          { ...opportunityDetail(unit, center, to), targetId: actor.id });
        const profile = targetProfile(state, unit, actor, center, weapon.template, { weapon });
        applyStrike(state, unit, { type: 'attack' }, { center, targets: [profile], hostile: true }, weapon);
        if (!canContinue()) break;
      }
    }
    if (!canContinue() || !canStep(state, actor, to)) break;
    actor.facing = signFacing(actor, to);
    Object.assign(actor, pos(to.x, to.y));
    path.push(to);
  }
  const to = pos(actor.x, actor.y), interrupted = path.length !== plan.path.length;
  record(state, actor, type, `${actor.name}${movementNames[type]}${interrupted ? '受阻，停在' : '至'} (${to.x}, ${to.y})`,
    { from, to, path, steps: path.length, interrupted });
}

function applyInteraction(state, actor, plan) {
  const item = state.interactives[plan.interactiveId];
  item.spent = true;
  if (!sameCell(actor, item)) actor.facing = signFacing(actor, item);
  record(state, actor, 'interact', `${actor.name}${item.kind === 'barrel' ? '引爆' : '激活'}${item.name}`, { interactiveId: item.id });
  if (item.kind === 'barrel') {
    for (const profile of plan.targets) {
      const target = state.units[profile.id];
      if (alive(target)) damageTarget(state, target, actor.id, 12, 'energy', '爆桶', { attacker: actor, hit: true });
    }
    for (const cover of values(state.covers).filter(c => c.hp > 0 && plan.cells.some(at => sameCell(at, c))).sort(byId)) {
      coverDamage(state, actor, cover, 12, { interactiveId: item.id });
    }
  } else {
    restoreHP(state, actor, 8, actor.id, '星辉祭坛');
    actor.mp = Math.min(actor.maxMp, actor.mp + 5);
    actor.sp = Math.min(actor.maxSp, actor.sp + 3);
    grantStatus(state, actor, 'shield', { amount: 10, sourceUnitId: actor.id });
    grantStatus(state, actor, 'haste', { sourceUnitId: actor.id });
  }
}

export function applyAction(state, action) {
  const plan = preview(state, action);
  if (!plan.ok) throw new Error(plan.error);
  const { type, x, y, skillId } = action;
  if (needsTarget(type) && x === undefined) throw new Error('缺少目标坐标');
  const actor = currentUnit(state);
  const before = state.logs.length;
  const moving = ['move', 'sprint', 'disengage'].includes(type);
  const initialCover = moving ? new Set(nearbyCovers(state, actor).map(c => c.id)) : null;
  if (type !== 'end') {
    actor.ap -= plan.ap;
    actor.mp -= plan.mp;
    actor.sp -= plan.sp;
    if (plan.ap === 2 && state.mode === 'split') { actor.used.attack++; actor.used.action++; }
    else if (plan.slot) actor.used[plan.slot]++;
    const actionIntent = ['attack', 'skill'].includes(type) && plan.intent && plan.intent !== 'normal' && plan.shape === 'single' ? plan.intent : 'normal';
    const targetId = plan.targets?.find(target => target.kind !== 'cover')?.id ?? null;
    const intentNames = { function: '机能限制', core: '核心要害', kill: '抹杀', concept: '概念破碎' };
    const actionLabel = plan.name ?? (movementNames[type] ?? ({ reload: '装填', brace: '依托防御', interact: '互动' })[type]);
    const actionText = actionIntent !== 'normal'
      ? `${actor.name}：${actionLabel}以意图：${intentNames[actionIntent]}攻击${state.units[targetId]?.name ?? '目标'}`
      : `${actor.name}：${actionLabel}`;
    record(state, actor, 'action', actionText,
      { action: { type, ...(x === undefined ? {} : { x, y }), ...(skillId === undefined ? {} : { skillId }) }, intent: actionIntent, targetId,
        ap: plan.ap, mp: plan.mp, sp: plan.sp, remainingAP: actor.ap });
  }
  switch (type) {
    case 'move': case 'sprint': case 'disengage': applyMovement(state, actor, type, plan); break;
    case 'attack': case 'skill': case 'shield_bash': applyStrike(state, actor, { type, skillId }, plan); break;
    case 'use_item': {
      actor.attunementCharges = Math.max(0, (actor.attunementCharges ?? 2) - 1);
      record(state, actor, 'item', `${actor.name}使用同调副手道具`, { itemId: plan.itemId, remaining: actor.attunementCharges });
      grantStatus(state, actor, 'haste', { sourceUnitId: actor.id });
      if (!actor.attunementCharges) actor.stance = 'light_blade';
      break;
    }
    case 'charge': grantStatus(state, actor, 'charge', { sourceUnitId: actor.id }); break;
    case 'lock_on': actor.lockedTargetId = plan.targetId; grantStatus(state, actor, 'lock_on', { sourceUnitId: actor.id }); record(state, actor, 'maneuver', `${actor.name}锁定${state.units[plan.targetId].name}`, { targetId: plan.targetId }); break;
    case 'scan': grantStatus(state, actor, 'weakness', { sourceUnitId: actor.id, stacks: 3 }); break;
    case 'flee': {
      const enemies = living(state).filter(u => u.team !== actor.team).sort((a,b) => stat(b,'agi') - stat(a,'agi') || byId(a,b));
      const target = enemies[0]; const attackerRoll = randomDie(state,20), defenderRoll = randomDie(state,20);
      const success = target ? stat(actor,'agi') + attackerRoll >= stat(target,'agi') + defenderRoll : true;
      record(state, actor, 'flee', `${actor.name}${success ? '逃跑成功' : '逃跑失败'}`, { targetId: target?.id ?? null, attackerRoll, defenderRoll, success });
      if (success) { actor.fled = true; state.outcome = actor.team === 'blue' ? 'red' : 'blue'; }
      break;
    }
    case 'detour': record(state, actor, 'maneuver', `${actor.name}选择绕行`, { maneuver: 'detour' }); break;
    case 'grapple': case 'disarm': case 'trip': case 'push': {
      const target = state.units[plan.targetId];
      if (target && maneuverContest(state, actor, target, type)) {
        if (type === 'grapple') grantStatus(state, target, 'grappled', { sourceUnitId: actor.id });
        if (type === 'disarm') { const held = target.mainHand ?? target.weapon; target.disarmedItem = held ?? null; target.mainHand = null; target.weapon = null; grantStatus(state, target, 'disarmed', { sourceUnitId: actor.id }); }
        if (type === 'trip') grantStatus(state, target, 'prone', { sourceUnitId: actor.id });
        if (type === 'push') knockback(state, actor, target, { distance: 1, collisionDamage: 3 });
      }
      break;
    }
    case 'block':
      actor.blockMode = action.maneuver === 'heavy' ? 'heavy' : 'normal';
      grantStatus(state, actor, 'guarded', { sourceUnitId: actor.id, turns: 1, modifiers: { reduction: actor.blockMode === 'heavy' ? .45 : .25 } });
      record(state, actor, 'block', `${actor.name}${actor.blockMode === 'heavy' ? '重' : ''}格挡`, { reduction: actor.blockMode === 'heavy' ? .45 : .25 });
      break;
    case 'reload': {
      const weapon = weaponInfo(state, actor);
      changeCounter(state, actor, weapon, weapon.ammo, 'ammo', weapon.ammo.capacity);
      break;
    }
    case 'brace':
      record(state, actor, 'brace', `${actor.name}${plan.coverId ? `借 ${plan.coverId} ` : '原地'}架势防御（减伤 35%，${plan.turns} 回合）`,
        { coverId: plan.coverId, reduction: plan.reduction, turns: plan.turns });
      grantStatus(state, actor, 'guarded', { sourceUnitId: actor.id, turns: plan.turns });
      break;
    case 'interact': applyInteraction(state, actor, plan); break;
  }
  if (moving && alive(actor)) {
    const stance = actor.stance ?? 'unarmed';
    if (type === 'move' && stance === 'light_blade') actor.bonusDice = Math.min(2, (actor.bonusDice ?? 0) + 1);
    const coverIds = nearbyCovers(state, actor).filter(c => !initialCover.has(c.id)).map(c => c.id);
    if (coverIds.length) record(state, actor, 'cover_approach', `${actor.name}移至掩体 ${coverIds.join('、')} 旁`, { coverIds });
  }
  if (refreshOutcome(state)) { if (actor) actor.ap = 0; return state.logs.slice(before); }
  if (type === 'end' || !alive(actor) || !actor.ap) {
    endTurn(state, actor);
    if (!refreshOutcome(state)) { advanceCursor(state); settleTurn(state); }
  }
  return state.logs.slice(before);
}
