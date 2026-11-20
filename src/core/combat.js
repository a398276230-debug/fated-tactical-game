import { aoeCells, canStep, cellAt as tileAt, coverAt, coverBetween, distance3D as distance,
  elevation, facingArc, facingToward as signFacing, gridDistance as near, hasLOS as clearSight,
  isFlanked as flank, isGround as ground, movementOptions, passableEdge as fitsHeight, unitAt } from './spatial.js';
import { critChance as criticalOdds, hitChance as hitOdds, nextRng, rollD20, rollProtocolD20, rollDice, rollDie,
  saveChance as saveOdds } from './rng.js';
import { stanceFor, stanceLabel, stanceRules, distanceTier, ratingFor, sizeHitModifier, meleeMultiplier, intentCheck, INTENTS, RATING_TABLE, moraleResult, initiative as protocolInitiative } from './combat_protocol.js';

import { validateStatusModifiers } from './status_modifiers.js';
import { applyTerrainEffect, updateTerrainPatches } from './terrain-effects.js';
import { spawnPanel } from './spawn-unit.js';
import { createEffectEngine, corpses, expression, initialCounters, resourceDefinitions } from './effects.js';
import { effectNodes, isExpression, validExpireOn } from './effect_schema.js';
export { corpses };


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
  infinite_ammo: def('无限弹药', '🏹', 'buff', 1, '远程射击无需装填，也不消耗弹药。', { infiniteAmmo: true }),
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
export const living = state => values(state.units).filter(unit => alive(unit) && !unit.fled).sort(byId);
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const pos = (x, y) => ({ x, y });
const key = (x, y) => `${x},${y}`;
const stat = (unit, id) => Number(unit.stats?.[id] ?? 0) * Math.max(0, 1 + changes(unit, 'attributePercent'));
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const changes = (unit, name) => values(unit.statuses).reduce((sum, s) =>
  sum + Number(s.modifiers?.[name] ?? STATUSES[s.id]?.modifiers?.[name] ?? 0) * (s.stacks ?? 1), 0);
const statusOf = (unit, id) => Object.hasOwn(unit.statuses ?? {}, id) ? unit.statuses[id] : undefined;
export const currentUnit = state => Object.hasOwn(state.units, state.order[state.turn]) ? state.units[state.order[state.turn]] : undefined;

function record(state, unit, type, text, detail = {}) {
  const actor = typeof unit === 'string' ? unit : unit?.id ?? null;
  const positions = Object.fromEntries(values(state.units).map(current => [current.id, { x: current.x, y: current.y }]));
  const event = { round: state.round, actor, text, type, detail, positions };
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
const equipped = (state, unit) => [...new Set([unit.mainHand ?? unit.weapon, unit.offHand, unit.shield, ...(unit.gear ?? [])].filter(Boolean))].map(id => equipmentFor(state, id)).filter(({ template }) => !template?.boundTo || template.boundTo === unit.id);
const effectiveStat = (state, unit, key) => dsl.stat(state, unit, key, stat(unit, key));
const resolveDC = (state, actor, dc) => typeof dc === 'number' ? dc
  : clamp(dc.base + dc.scaleBy.perUnit * effectiveStat(state, actor, dc.scaleBy.stat), dc.min ?? 1, dc.max ?? 50);
const finalDamageMultiplier = unit => values(unit.statuses).reduce((mult, s) => mult * (s.modifiers?.finalDamageMultiplier ?? 1) ** (s.stacks ?? 1), 1);
const resourcePool = (state, unit, resource, instance) => {
  for (const item of equipped(state, unit)) {
    if (instance && item.instance !== instance) continue;
    const effect = resourceDefinitions(item.template, true).find(node => node.resource === resource);
    if (effect) return { item, effect, amount: item.instance.counters?.[resource] ?? effect.initial ?? 0 };
  }
  return null;
};

export function stealthCheck(state, unit, d20, dc) {
  const bonus = dsl.check(state, unit, 'stealthBonus');
  return { total: d20 + bonus, bonus, success: d20 + bonus >= dc };
}

const statusAmount = status => status.amount ?? status.modifiers?.amount ?? STATUSES[status.id]?.modifiers.amount ?? 0;

export function statusModifierKeys(statusId, state) {
  return Object.keys(getStatusTemplate(state, statusId)?.modifiers ?? {});
}

// patch 直接传入要更新的 modifier 键值，保留实例时长及层数。
export function patchStatus(state, unitId, statusId, patch) {
  const unit = tableEntry(state.units, unitId);
  const status = unit && statusOf(unit, statusId);
  const template = getStatusTemplate(state, statusId);
  if (!status || !template) throw new Error(`找不到状态实例：${unitId}/${statusId}`);
  if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || !Object.keys(patch).length) throw new Error('状态参数补丁须为非空对象');
  const { expireOn, ...modifiers } = patch;
  const patchExpiry = Object.hasOwn(patch, 'expireOn');
  validateStatusModifiers(template, modifiers);
  if (patchExpiry && expireOn !== null && !validExpireOn(expireOn)) throw new Error('无效字段：expireOn');
  status.modifiers = { ...status.modifiers, ...modifiers };
  if (patchExpiry) status.expireOn = structuredClone(expireOn);
  if (statusId === 'shield' && Object.hasOwn(modifiers, 'amount')) status.amount = clamp(modifiers.amount, 1, 100000);
  record(state, unit, 'status_patch', `${unit.name}的${status.name}参数已更新`,
    { targetId: unitId, statusId, modifiers, ...(patchExpiry ? { expireOn: status.expireOn } : {}) });
  return status;
}

export function grantStatus(state, unit, statusId, options = {}) {
  const template = getStatusTemplate(state, statusId);
  if (!unit || !template) throw new Error(`未知状态：${statusId}`);
  if (!alive(unit) || unit.fled) return null;
  if (Object.hasOwn(options, 'modifiers')) validateStatusModifiers(template, options.modifiers);
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
  if (Object.hasOwn(options, 'expireOn')) {
    if (!validExpireOn(options.expireOn)) throw new Error('无效字段：expireOn');
    applied.expireOn = structuredClone(options.expireOn);
  } else if (Object.hasOwn(previous ?? {}, 'expireOn')) applied.expireOn = previous.expireOn;
  if (statusId === 'shield') applied.amount = options.amount == null
    ? applied.modifiers.amount : clamp(options.amount, 1, 10000);
  unit.statuses[statusId] = applied;
  record(state, applied.sourceUnitId ?? unit.id, 'status', `${unit.name}获得${template.name} ×${stacks}`,
    { targetId: unit.id, statusId, stacks, remainingTurns: applied.remainingTurns,
      ...(statusId === 'shield' ? { amount: applied.amount } : {}) });
  return applied;
}

export function refreshOutcome(state) {
  updateTerrainPatches(state, record, terrainDamage);
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

const eventLabels = { on_attack: '发动攻击', on_hit: '攻击命中', on_damaged: '受到伤害', on_kill: '击杀',
  on_death: '倒下', on_turn_start: '回合开始', on_turn_end: '回合结束', on_skill_cast: '施放技能',
  on_equip: '装备生效', on_heal: '受到治疗', on_ally_death: '队友倒下' };

function expireStatuses(state, unit, trigger, { sourceUnitId = null, direct = false } = {}) {
  for (const status of values(unit.statuses)) {
    if (!status.expireOn) continue;
    const rule = [].concat(status.expireOn).find(rule => rule.trigger === trigger
      && (rule.damageType == null || rule.damageType === 'any' || rule.damageType === (direct ? 'direct' : 'indirect'))
      && (rule.exceptSource !== 'self' || sourceUnitId !== unit.id));
    if (!rule) continue;
    delete unit.statuses[status.id];
    record(state, unit, 'expire', `${unit.name}的${status.name}因${eventLabels[trigger]}提前解除`,
      { targetId: unit.id, statusId: status.id, trigger, sourceUnitId, ...(trigger === 'on_damaged' ? { direct } : {}) });
  }
}

function dispatchEffect(state, actor, trigger, context = {}, extra = []) {
  if (actor && !['on_damaged','on_heal','active'].includes(trigger)) {
    expireStatuses(state, actor, trigger, { sourceUnitId: context.sourceUnitId ?? actor.id });
  }
  dsl.dispatch(state, actor, trigger, context, extra);
}

function loseHP(state, target, raw, sourceUnitId, type, label, detail = {}, triggerDamage = true, effectContext = {}) {
  if (!alive(target) || (target.fled && !effectContext.forcedDisplacement)) return 0;
  const hpBefore = target.hp;
  const source = tableEntry(state.units, sourceUnitId);
  const preserveLife = !effectContext.forcedDisplacement && (effectContext.preserveLife || target.nonLethal || changes(target, 'preserveLife'));
  target.hp = Math.max(preserveLife ? 1 : 0, hpBefore - Math.max(0, Math.floor(raw)));
  const amount = hpBefore - target.hp;
  record(state, sourceUnitId, 'damage', `${effectContext.damagePrefix ?? ''}${target.name}受到${amount}点${label}伤害`,
    { ...detail, targetId: target.id, damageType: type, amount, hpBefore, hpAfter: target.hp });
  if (amount > 0) expireStatuses(state, target, 'on_damaged', { sourceUnitId, direct: effectContext.direct });
  if (!alive(target)) {
    const allies = living(state).filter(unit => unit.team === target.team);
    target.diedAt = { round: state.round, turn: state.turn };
    target.corpseOf ??= target.id;
    record(state, sourceUnitId, 'defeat', `${target.name}倒下`, { targetId: target.id });
    updateTerrainPatches(state, record, terrainDamage);
    triggerDeathrattle(state, target, sourceUnitId);
    dispatchEffect(state, target, 'on_death', { target: source, attacker: source, killed: target, dealt: amount, damageType: type, weaponId: detail.weaponId, sourceUnitId });
    for (const ally of allies) if (alive(ally)) dispatchEffect(state, ally, 'on_ally_death', { target, killed: target, attacker: source, sourceUnitId: target.id });
    if (source && source.team !== target.team) dispatchEffect(state, source, 'on_kill', { target, killed: target, dealt: amount, damageType: type, weaponId: detail.weaponId });
  } else if (amount > 0 && triggerDamage) {
    dsl.dispatch(state, target, 'on_damaged', { target: source, attacker: source, dealt: amount, damageType: type, ...effectContext });
  }
  return amount;
}

function terrainDamage(state, target, raw, prefix, detail) {
  const { forcedDisplacement } = detail;
  return loseHP(state, target, raw, null, 'true', forcedDisplacement ? '坍塌' : '坠落',
    { ...detail, raw }, true, { direct: false, forcedDisplacement, damagePrefix: prefix });
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
  if (!alive(target) || target.fled) return 0;
  const healer = tableEntry(state.units, sourceUnitId);
  const healing = Math.max(0, Math.floor(healer ? dsl.stat(state, healer, 'healing', raw, { target, ...detail }) : raw));
  const amount = Math.min(healing, target.maxHp - target.hp);
  target.hp += amount;
  record(state, sourceUnitId, 'heal', `${target.name}因${label}恢复${amount}点生命`, { ...detail, targetId: target.id, amount });
  if (amount > 0) expireStatuses(state, target, 'on_heal', { sourceUnitId });
  if (healer && healing) dsl.dispatch(state, healer, 'on_heal', { target, healing, actionType: detail.actionType });
  return amount;
}

function armorOf(state, unit, damageType, pierce = 0, context = {}) {
  const equipmentDefense = gearFor(state, unit).reduce((sum, g) => sum + (g.template?.defense ?? 0), 0)
    + (unit.shield ? equipmentFor(state, unit.shield).template?.defense ?? 0 : 0);
  const base = unit.armor + equipmentDefense + changes(unit, 'armor')
    + gearFor(state, unit).reduce((sum, g) => sum + (g.template?.armor ?? 0), 0);
  const ctx = { ...context, target: context.attacker, damageType };
  const armor = Math.max(0, dsl.stat(state, unit, 'defense', dsl.stat(state, unit, 'armor', base, ctx), ctx));
  const flat = typeof pierce === 'object' ? (pierce.flat ?? 0) : pierce;
  const percent = typeof pierce === 'object' ? (pierce.percent ?? 0) : 0;
  const effective = Math.max(0, armor * (1 - percent) - flat);
  return damageType === 'physical' ? effective : damageType === 'energy' ? effective / 2 : 0;
}

function damageTarget(state, target, sourceUnitId, amount, type, label, options = {}) {
  const { attacker, hit = false, melee = false, armorPierce = 0, reaction = false, details = {}, committedRecipient } = options;
  let recipient = committedRecipient ?? target;
  if (hit && !reaction && !committedRecipient) {
    recipient = guardFor(state, target) ?? target;
    if (recipient !== target) record(state, recipient, 'guard', `${recipient.name}替${target.name}承受打击`, { targetId: target.id });
  }
  let parry = null;
  if (hit && melee && !reaction && recipient !== attacker && recipient?.stance === 'greatsword'
    && recipient.greatswordMode === 'defensive' && (recipient.parryQuota ?? 0) > 0) {
    const defenderRoll = randomDie(state, 20), attackerRoll = randomDie(state, 20);
    const defenderTotal = effectiveStat(state, recipient, 'str') + defenderRoll;
    const attackerTotal = effectiveStat(state, attacker, 'str') + attackerRoll;
    const success = defenderTotal >= attackerTotal;
    const perfect = success && (details.ratingMultiplier ?? 0) >= 1.3 && !recipient.parryRefunded;
    recipient.parryQuota--;
    if (perfect) { recipient.parryQuota = Math.min(2, recipient.parryQuota + 1); recipient.parryRefunded = true; }
    parry = { success, perfect, defenderRoll, attackerRoll, defenderTotal, attackerTotal, reduction: perfect ? 1 : success ? .6 : 0, quota: recipient.parryQuota };
    record(state, recipient, 'parry', `${recipient.name}${perfect ? '完美弹反' : success ? '弹反成功' : '弹反失败'}`, { targetId: attacker?.id ?? null, ...parry });
    if (perfect) amount = 0;
    else if (success) amount *= .4;
  }
  if (!alive(recipient) || recipient.fled) return { recipient, dealt: 0 };
  const formula = mitigation(state, recipient, type, hit, armorPierce, { attacker, intercepting: recipient !== target, ignoreArmor: options.ignoreArmor });
  const modified = Math.max(0, hit
    ? Math.floor(amount * formula.multiplier * formula.armorMultiplier * (1 - formula.attributeReduction) * (attacker ? finalDamageMultiplier(attacker) : 1))
    : Math.floor(amount * formula.multiplier) - Math.floor(formula.armor));
  if (formula.shatter) {
    delete recipient.statuses.freeze;
    record(state, sourceUnitId, 'shatter', `${recipient.name}的冰层碎裂`, { targetId: recipient.id, multiplier: 1 + formula.shatter });
  }
  if (hit && statusOf(recipient, 'stealth')) {
    delete recipient.statuses.stealth;
    record(state, recipient, 'reveal', `${recipient.name}现形`, { targetId: recipient.id });
  }
  const net = Math.max(0, Math.floor(modified - dsl.stat(state, recipient, 'damageReductionFlat', 0, { target: attacker, damageType: type, intercepting: recipient !== target })));
  const shield = statusOf(recipient, 'shield');
  const absorbed = Math.min(shield ? statusAmount(shield) : 0, net);
  if (absorbed > 0) {
    shield.amount = statusAmount(shield) - absorbed;
    record(state, recipient, 'shield', `${recipient.name}的护盾吸收${absorbed}点伤害`, { absorbed, remaining: shield.amount });
    if (shield.amount <= 0) {
      delete recipient.statuses.shield;
      record(state, recipient, 'shield_break', `${recipient.name}的护盾破裂`, { targetId: recipient.id });
    }
  }
  const pending = net - absorbed;
  const dealt = loseHP(state, recipient, pending, sourceUnitId, type, label,
    { ...details, ...formula, ...(parry ? { parry } : {}), raw: amount, absorbed, intendedTargetId: target.id }, true,
    { preserveLife: options.preserveLife, melee: hit && melee, reaction, intercepting: recipient !== target, direct: options.direct ?? hit });
  if (hit && melee && !reaction && alive(attacker) && attacker.id !== recipient.id) {
    const reflect = changes(recipient, 'reflect');
    if (reflect > 0) damageTarget(state, attacker, recipient.id, reflect, 'true', '棘甲反伤', { reaction: true });
  }
  return { recipient, dealt };
}

function mitigation(state, unit, type, hit, pierce, ctx = {}) {
  const shatter = hit ? changes(unit, 'shatter') : 0;
  const vulnerability = changes(unit, 'vulnerability');
  const reduction = clamp(dsl.stat(state, unit, 'damageReduction', changes(unit, 'reduction'), { ...ctx, target: ctx.attacker, damageType: type }), 0, 1);
  const defense = ctx.ignoreArmor ? 0 : armorOf(state, unit, type, pierce, ctx);
  const armorMultiplier = type === 'true' ? 1 : 2000 / (defense + 2000);
  const attributes = Object.fromEntries(Object.keys(unit.stats ?? {}).map(key => [key, effectiveStat(state, unit, key)]));
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
    if (unit.statuses[status.id] !== status || status.tickTiming !== timing) continue;
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
  for (const [id, modifier] of Object.entries(unit.effectModifiers ?? {})) {
    if (modifier.round === state.round && modifier.turn === state.turn) continue;
    if (--modifier.turns <= 0) delete unit.effectModifiers[id];
  }
  expireStatuses(state, unit, 'on_turn_end', { sourceUnitId: unit.id });
  tick(state, unit, 'onTurnEnd');
  dsl.dispatch(state, unit, 'on_turn_end');
  for (const status of values(unit.statuses)) {
    if (status.durationType !== 'battle_turns') continue;
    if (status.appliedRound === state.round && status.appliedTurn === state.turn
      && (!status.expireInto || status.sourceUnitId !== unit.id)) continue;
    if (--status.remainingTurns > 0) continue;
    delete unit.statuses[status.id];
    record(state, unit, 'expire', `${unit.name}的${status.name}结束`, { targetId: unit.id, statusId: status.id });
    if (status.expireInto && alive(unit) && !refreshOutcome(state)) grantStatus(state, unit, status.expireInto, { sourceUnitId: unit.id });
  }
  record(state, unit, 'end', `${unit.name}结束回合`);
  if (unit === state.units[state.order.at(-1)]) decayZones(state);
  updateTerrainPatches(state, record, terrainDamage, true);
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
      expireStatuses(state, unit, 'on_turn_start', { sourceUnitId: unit.id });
      tick(state, unit, 'onTurnStart');
      tickZones(state, unit);
      dsl.dispatch(state, unit, 'on_turn_start');
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
  if (state.turn < state.order.length) return;
  state.turn = 0;
  state.round++;
  const opening = state.logs.find(log => log.type === 'initiative')?.detail?.initiative;
  // A temporary initiative modifier changes the next round's order. Reuse the
  // opening scores and leave summoned units at the end in their join order.
  const openingRows = opening?.filter(row => state.order.includes(row.unitId)) ?? [];
  const hasModifier = living(state).some(unit => values(unit.effectModifiers).some(m => m.stat === 'initiative'));
  const lastChange = state.logs.findLast(log => log.type === 'initiative_order');
  if (openingRows.length && (hasModifier || lastChange?.detail.modified)) {
    const ranked = openingRows.map((row, index) => {
      const unit = state.units[row.unitId];
      const delta = dsl.stat(state, unit, 'initiative', row.flatInit, {}, true) - row.flatInit;
      return { id: row.unitId, total: row.total + delta, index };
    }).sort((a, b) => b.total - a.total || a.index - b.index).map(row => row.id);
    const included = new Set(ranked);
    const order = [...ranked, ...state.order.filter(id => !included.has(id))];
    if (order.some((id, index) => id !== state.order[index])) {
      state.order = order;
      record(state, null, 'initiative_order', '先攻修正改变行动顺序', { order, modified: hasModifier });
    } else if (!hasModifier) {
      record(state, null, 'initiative_order', '先攻修正结束', { order, modified: false });
    }
  }
  resetFacing(state);
  moraleCheck(state);
}

export function beginBattle(state) {
  state.logs ??= [];
  state.round = 1;
  state.turn = 0;
  for (const unit of values(state.units)) { delete unit.effectUsage; delete unit.effectModifiers; }
  state.outcome = null;
  syncEquipmentEffects(state);
  const initiative = initiativeOrder(state, () => randomDie(state, 20));
  state.order = initiative.map(entry => entry.unitId);
  for (const unit of values(state.units)) {
    unit.ap = 0;
    unit.used = { attack: 0, action: 0 };
    unit.reactionAvailable = true;
    for (const status of values(unit.statuses)) {
      delete status.appliedRound;
      delete status.appliedTurn;
    }
  }
  record(state, null, 'initiative', '敏捷 + d20：确定先攻次序', { initiative });
  if (!refreshOutcome(state)) settleTurn(state);
  return state;
}

function initiativeOrder(state, rollFor) {
  return living(state).map(unit => {
    const roll = rollFor(unit), agility = effectiveStat(state, unit, 'agi') + dsl.check(state, unit, 'initiativeAgility');
    const agilityPercent = Number(unit.initiativePercent ?? 0);
    const attackInit = Array.isArray(unit.attackInit) ? unit.attackInit : [];
    const actionInit = Array.isArray(unit.actionInit) ? unit.actionInit : [];
    const flatInit = dsl.stat(state, unit, 'initiative', Number(unit.flatInitiative ?? 0) + dsl.check(state, unit, 'iniBonus'));
    const total = protocolInitiative({ agility, percent: agilityPercent, d20: roll, attack: attackInit, action: actionInit, flat: flatInit });
    return { unitId: unit.id, roll, agility, agilityPercent, attackInit:Math.max(0,...attackInit,0), actionInit:Math.max(0,...actionInit,0), flatInit, total };
  }).sort((a, b) => b.total - a.total || b.agility - a.agility ||
    (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}

// Reuse the opening dice when normalization changes check bonuses before play.
export function refreshOpeningInitiative(state) {
  const [entry, turn] = state.logs;
  if (state.round !== 1 || state.turn !== 0 || state.logs.length !== 2 || entry.type !== 'initiative' || turn.type !== 'turn') return;
  const previous = entry.detail.initiative;
  if (!Array.isArray(previous) || !currentUnit(state)) return;
  const rolls = new Map(previous.filter(row => row && Number.isInteger(row.roll)).map(row => [row.unitId, row.roll]));
  if (living(state).some(unit => !rolls.has(unit.id) || changes(unit, 'skip'))) return;
  const initiative = initiativeOrder(state, unit => rolls.get(unit.id));
  if (initiative.every((row, i) => row.unitId === previous[i]?.unitId && row.total === previous[i]?.total)) return;
  currentUnit(state).ap = 0;
  state.order = initiative.map(row => row.unitId);
  entry.detail.initiative = initiative;
  const first = currentUnit(state);
  first.ap = 2;
  state.logs.pop();
  record(state, first, 'turn', `${first.name}开始回合`, { turn: 0 });
}

const locateUnit = (state, { x, y }) => unitAt(state, x, y);
const locateCover = (state, { x, y }) => coverAt(state, x, y);
const emptyGround = (state, at) => ground(state, at) && !locateUnit(state, at) && !locateCover(state, at);
const allCells = state => state.grid.flatMap((row, y) => row.map((_, x) => pos(x, y)));

function spawnEffectUnit(state, actor, original, center, scale, corpse) {
  if (!original || state.order.length >= 200 || Object.keys(state.units).length >= 200) return false;
  const at = allCells(state).filter(cell => emptyGround(state, cell))
    .sort((a, b) => distance(state, center, a) - distance(state, center, b))[0];
  if (!at) return false;
  let index = 1;
  while (Object.hasOwn(state.units, `summon-${index}`)) index++;
  const id = `summon-${index}`;
  const scaled = (value, min = 0) => Math.max(min, Math.round(value * scale));
  const maxHp = scaled(original.maxHp, 1), maxMp = scaled(original.maxMp), maxSp = scaled(original.maxSp);
  const unit = { id, name: original.name, team: actor.team, ...at, facing: [...actor.facing], hp: maxHp, maxHp,
    mp: maxMp, maxMp, sp: maxSp, maxSp, ap: 0, used: { attack: 0, action: 0 },
    stats: Object.fromEntries(Object.entries(original.stats).map(([stat, value]) => [stat, Math.round(value * scale)])),
    armor: scaled(original.armor), size: original.size, move: scaled(original.move, 1), weapon: null, gear: [],
    skills: [...original.skills], statuses: {}, ...(original.tier ? { tier: original.tier } : {}),
    ...(corpse ? { creatureType: 'undead', corpseOf: original.id } : {}) };
  state.units[id] = unit;
  state.order.push(id);
  if (corpse) original.corpseConsumed = true;
  record(state, actor, corpse ? 'raise_dead' : 'spawn', `${unit.name}${corpse ? '复生' : '登场'}`, { unitId: id, ...(corpse ? { corpseId: original.id } : {}) });
  return true;
}

function nextFreeId(table, prefix) {
  let n = 1;
  while (Object.hasOwn(table, `${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
function spawnUnitEffect(state, actor, spec, center) {
  const count = spec.count ?? 1;
  const reject = reason => {
    record(state, actor, 'spawn_unresolved', `召唤${spec.name}失败：${reason}`, {unresolved:true});
    return false;
  };
  if (Object.keys(state.units).length + count > 200 || state.order.length + count > 200) return reject('单位数量达到上限');
  const slots = [spec.mainHand, spec.offHand, spec.shield, ...(spec.gear ?? [])].filter(Boolean);
  if (Object.keys(state.items).length + slots.length * count > 200) return reject('装备实例数量达到上限');
  const panel = spawnPanel(actor, spec);
  if (!panel || panel.maxHp < 1) return reject('召唤者属性预算不足');
  const cells = allCells(state).filter(p => emptyGround(state,p)).sort((a,b)=>distance(state,center,a)-distance(state,center,b));
  if (cells.length < count) return reject('可用空格不足');
  const mint = templateId => {
    if (!templateId) return null;
    const id = nextFreeId(state.items,'item');
    state.items[id] = {id,templateId,counters:initialCounters(state.equipment[templateId])};
    return id;
  };
  for (const at of cells.slice(0,count)) {
    const id = nextFreeId(state.units,'summon'), mainHand = mint(spec.mainHand);
    state.units[id] = {...panel, stats:{...panel.stats}, id, name:spec.name, team:actor.team, ...at, facing:[...actor.facing],
      hp:panel.maxHp, mp:panel.maxMp, sp:panel.maxSp, ap:0, used:{attack:0,action:0}, weapon:mainHand, mainHand,
      offHand:mint(spec.offHand), shield:mint(spec.shield), gear:(spec.gear ?? []).map(mint), skills:[...(spec.skills ?? [])], statuses:{}};
    state.order.push(id);
    record(state, actor, 'spawn', `${spec.name}登场`, {unitId:id});
  }
  return true;
}

const dsl = createEffectEngine({ spawn: spawnUnitEffect, terrain: (state, actor, node, ctx) => applyTerrainEffect(state, actor, node, ctx, record, terrainDamage), equipped, living, resourcePool, distance, die: randomDie, random: randomUnit,
  counter: changeCounter, damage: damageTarget, loseHP, heal: restoreHP, grant: grantStatus, record, saved: effectSaved, removeStatus, knockback, teleport: teleportBehind, statusModifier: changes, blockRestore: unit => changes(unit, 'blockResourceRestore'),
  weaponType: (state, actor) => { const weapon = weaponInfo(state, actor).template; return weapon.weaponType ?? weapon.weaponClass ?? weapon.rangeType; },
  findExpression: (state, ref) => [...values(state.equipment), ...values(state.skills)].flatMap(t => t.effects).find(e => isExpression(e) && e.id === ref),
  raise: (state, actor, target, scale) => corpses(state).includes(target) && spawnEffectUnit(state, actor, target, target, scale, true),
  summon: (state, actor, id, at, scale, count) => {
    let spawned = false;
    for (let i = 0; i < count; i++) spawned = spawnEffectUnit(state, actor, tableEntry(state.summonTemplates, id) ?? tableEntry(state.units, id), at, scale, false) || spawned;
    return spawned;
  },
});

export const equippedActiveSkills = (state, unit) => dsl.activeSkills(state, unit);
export function syncEquipmentEffects(state) {
  for (const unit of living(state)) dispatchEffect(state, unit, 'on_equip');
}

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

// Apply the skill default as expression parameters, not by mutating saved DSL nodes.
// executeNodes merges explicit node fields over params, including inside chainEffect.
function skillExpressions(skill, id) {
  const entries = dsl.skillExpressions(skill, id);
  if (!skill?.damageType) return entries;
  return entries.map(entry => ({ ...entry, expr: { ...entry.expr, params: {damageType:skill.damageType, ...entry.expr.params} } }));
}
function actorCost(template) {
  const cost = template.resourceCost;
  return { hp: cost?.hp ?? 0, mp: cost?.mp ?? template.mp ?? 0, sp: cost?.sp ?? template.sp ?? 0 };
}
const insufficientHP = 'HP 不足，无法施放';

// Split mode assigns an AP to each slot. Two-AP actions occupy both slots.
function paymentError(state, unit, ap, slot, template = {}) {
  if (unit.ap < ap) return `需要 ${ap} AP`;
  if (state.mode === 'split' && (ap === 2 ? unit.used.attack || unit.used.action : unit.used[slot])) {
    return '本回合对应的行动槽已使用';
  }
  const {hp,mp,sp} = actorCost(template);
  if (hp > 0 && hp >= unit.hp) return insufficientHP;
  if (unit.mp < mp) return '魔力不足';
  if (unit.sp < sp) return '体力不足';
  if (template.resourceCost?.resource && (resourcePool(state, unit, template.resourceCost.resource)?.amount ?? 0) < template.resourceCost.amount) return '装备资源不足';
  if (findNode(template, 'restoreResource') && changes(unit, 'blockResourceRestore')) return '当前状态禁止装备资源恢复';
  return null;
}

const normalAttack = Object.freeze({ name: '徒手', range: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' } });
const findNode = (template, kind, predicate = () => true) => (template?.effects ?? [])
  .flatMap(expr => [...effectNodes(expr.effects, true)]).find(node => node.kind === kind && predicate(node));
const shieldBashEffects = [expression('shield-bash-hit', 'on_hit', 'hitTarget', [
  { kind: 'knockback', distance: 1 }, { kind: 'grantStatus', statusId: 'stun', turns: 1 },
])];
const isMelee = template => template.rangeType !== 'ranged' && !template.ranged && template.weaponClass !== 'ranged' && (template.range ?? 1.5) <= 2;

function weaponInfo(state, unit) {
  const mainId = unit.mainHand ?? unit.weapon;
  const candidate = equipmentFor(state, mainId);
  const weapon = candidate.template?.boundTo && candidate.template.boundTo !== unit.id ? equipmentFor(state, null) : candidate;
  const pools = resourceDefinitions(weapon.template, true);
  const ammo = pools.find(node => node.reloadable);
  const ammoCount = ammo ? resourcePool(state, unit, ammo.resource, weapon.instance)?.amount : null;
  const infiniteAmmo = Boolean(ammo && changes(unit, 'infiniteAmmo'));
  const scale = findNode(weapon.template ?? normalAttack, 'multiplyDamage', node => node.local && node.resourceScale);
  const souls = scale ? resourcePool(state, unit, scale.resourceScale.resource, weapon.instance)?.amount ?? 0 : 0;
  const offHand = equipmentFor(state, unit.offHand);
  const stance = unit.stance ?? stanceFor({ mainHand: weapon.template, offHand: offHand.template, shield: equipmentFor(state, unit.shield).template });
  return { ...weapon, ammo, ammoCount, infiniteAmmo, souls, offHand, stance,
    template: weapon.template ?? normalAttack, soulMultiplier: 1 + souls * (scale?.resourceScale.perUnit ?? 0) };
}

function reaches(state, actor, at, template, ammo) {
  const dz = elevation(state, actor) - elevation(state, at);
  const melee = isMelee(template) && !ammo;
  const range = (template.range ?? 1.5) + (melee || !dz ? 0 : dz > 0 ? (ammo ? dsl.check(state, actor, 'highGroundRange', { weaponId: actor.mainHand ?? actor.weapon, highGround: true }) : 1) : -1);
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
  const id = changes(actor, 'taunted') ? statusOf(actor, 'taunt')?.sourceUnitId : null;
  const taunter = tableEntry(state.units, id);
  const teleport = findNode(template, 'teleportBackstab');
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

function diceFormula(state, spec, actor) {
  if (typeof spec === 'number') return { count: 0, sides: 0, bonus: spec };
  const count = spec?.count ?? 1, sides = spec?.sides ?? 1;
  return { count, sides, bonus: Math.floor((spec?.bonus ?? 0) + effectiveStat(state, actor, spec?.stat) * (spec?.multiplier ?? 1)) };
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

const fixedDamageOf = template => findNode(template, 'modifyDamageBase', node => node.unscaled);
const hasStrikeDamage = template => template.damage != null || Boolean(fixedDamageOf(template));
const flatDice = value => ({ rolls: [], count: 0, sides: 0, bonus: value, value });

function targetProfile(state, actor, target, at, template, context = {}) {
  const { weapon, origin = actor, teleport, cover = false } = context;
  const geometry = reaches(state, origin, at, template, weapon?.ammo);
  const arrow = Boolean(weapon?.ammo);
  const arc = target && !cover ? facingArc(target, origin) : 'front';
  const backstab = !cover && arc !== 'front' && geometry.melee;
  const strike = { target, melee: geometry.melee, arrow, backstab, highGround: geometry.dz > 0,
    weaponId: weapon?.instance?.id, actionType: weapon ? 'attack' : 'skill', school: template.school,
    damageType: template.damage?.type ?? template.damageType, entries: weapon ? [] : template.entry ? [template.entry] : skillExpressions(template, context.skillId ?? 'preview') };
  const nodes = dsl.passiveNodes(state, actor, strike, strike.entries);
  const hasNode = (kind, mode) => nodes.some(node => node.kind === kind && (!mode || node.mode === mode));
  const guaranteeCrit = hasStrikeDamage(template) && Boolean(changes(actor, 'guaranteed_crit') || hasNode('forceOutcome', 'crit'));
  const guaranteeHit = hasStrikeDamage(template) && Boolean(guaranteeCrit || changes(actor, 'guaranteed_hit') || hasNode('forceOutcome', 'hit'));
  const tierUp = hasStrikeDamage(template) && hasNode('upgradeHitTier');
  const dodge = cover ? 0 : dsl.stat(state, target, 'dodge', dsl.check(state, target, 'dodgeBonus', { target: actor })
    + dsl.check(state, target, 'dodgeAgility', { target: actor }) + changes(target, 'dodgeBonus'), { target: actor });
  const high = Math.sign(geometry.dz) * 2 + (geometry.dz > 0 ? dsl.check(state, actor, 'highGroundAccuracy', strike) : 0);
  const flanked = target && !cover ? flank(state, origin, target) : false;
  const protectedBy = target && !cover && !geometry.melee ? coverBetween(state, origin, target) : null;
  const penalty = protectedBy?.cover ?? 0;
  const size = cover ? 0 : typeof target?.size === 'number' ? Math.max(0, target.size - 1) : target?.size === 'large' ? 2 : target?.size === 'small' ? -1 : 0;
  const sizeModifier = cover || !target ? 0 : sizeHitModifier(actor, target);
  const sizeAccuracy = size + sizeModifier;
  const distanceModifier = distanceTier(geometry.distance).hit;
  const weaponRangeModifier = distanceTier(Math.max(geometry.distance, geometry.range)).range;
  const stance = weapon?.stance ?? actor.stance ?? 'unarmed';
  const rules = stanceRules(stance);
  const rangedDistance = weapon && !geometry.melee && distanceModifier < 0 ? rules.rangedDistancePenalty ?? distanceModifier : distanceModifier;
  const closeRange = rules.closeRange && geometry.melee && geometry.distance <= 2 ? 4 : rangedDistance;
  // The protocol does not grant an implicit STR/AGI-to-hit bonus. Associated attributes
  // belong in the damage formula; hit comes from explicit weapon/skill and combat modifiers.
  const accuracy = dsl.stat(state, actor, 'accuracy', (template.accuracy ?? 0) + (state.ruleset === 'sandbox' ? effectiveStat(state, actor, geometry.melee ? 'str' : 'agi') : 0)
    + high + sizeAccuracy + closeRange + (state.ruleset === 'sandbox' ? 0 : weaponRangeModifier) + changes(actor, 'accuracy')
    + (cover || !target ? 0 : changes(target, 'incomingAccuracy')) + (flanked ? 2 : 0) - penalty
    + dsl.check(state, actor, 'accuracyBonus', strike), strike) - dodge;
  const explicitEvasion = changes(target, 'evasion') + changes(target, 'incomingAccuracy');
  const equipmentDefense = gearFor(state, target).reduce((d, g) => d + (g.template?.defense ?? 0), 0)
    + (target.shield ? equipmentFor(state, target.shield).template?.defense ?? 0 : 0);
  // Protocol mode has no implicit AGI-to-defense; sandbox keeps its legacy balance only for regression fixtures.
  const defense = cover ? 8 : state.ruleset === 'sandbox'
    ? 10 + Math.floor(effectiveStat(state, target, 'agi') / 2) + equipmentDefense
    : 10 + explicitEvasion + equipmentDefense;
  const advantages = changes(actor, 'advantage') + dsl.check(state, actor, 'advantage', strike) + Number(Boolean(teleport)) + (template.advantage ?? 0);
  const disadvantages = changes(actor, 'disadvantage') + (template.disadvantage ?? 0);
  const advantage = Math.sign(advantages - disadvantages);
  const saveStat = !cover && target ? template.save : null;
  const saveDC = saveStat ? (resolveDC(state, actor, template.saveDC ?? 12 + Math.floor(effectiveStat(state, actor, 'int') / 2))) : null;
  const saveBonus = saveStat ? effectiveStat(state, target, saveStat) : 0;
  const saveChance = saveStat ? saveOdds(saveDC, saveBonus) : 0;
  const automatic = !weapon && (!template.damage || saveStat || template.autoHit);
  const hitChance = automatic || guaranteeHit ? 1 : tierUp || dodge || dsl.check(state, actor, 'accuracyBonus', strike)
    ? saveOdds(4, accuracy, advantages, disadvantages) - (accuracy + 1 >= 4 ? 1 - saveOdds(2, 0, advantages, disadvantages) : 0) : hitOdds(defense, accuracy, advantages, disadvantages);
  const critChance = saveStat ? 0 : guaranteeCrit ? 1 : automatic ? 0 : criticalOdds(advantages, disadvantages);
  const offHandMultiplier = weapon?.stance === 'dual_wield' && weapon.offHand?.template?.damage ? 1.5 : 1;
  const intentSpec = INTENTS[context.intent ?? 'normal'] ?? INTENTS.normal;
  // Intent is applied once in applyStrike after the intent contest; do not fold it into this preview multiplier.
  const multiplier = offHandMultiplier * (1 + changes(actor, 'damageBonus')) * Math.max(0, 1 + changes(actor, 'attackPercent'))
    * (teleport ? 1 + (teleport.bonusMultiplier ?? .5) : 1);
  const fixed = nodes.find(node => node.kind === 'modifyDamageBase');
  const fixedDamage = fixed?.unscaled ? fixed : null;
  const fixedAttack = fixed?.unscaled ? null : fixed;
  const damageType = fixedDamage?.damageType ?? template.damage?.type ?? template.damageType ?? 'physical';
  const tierPower = ({1:2, 2:2.8, 3:4, 4:8, 5:15, 6:35, 7:80})[actor.tier ?? 1] ?? 2;
  const attributeBase = () => state.ruleset === 'protocol'
    ? effectiveStat(state, actor, template.damage.stat ?? (geometry.melee ? 'str' : 'int')) * 10 * tierPower
    : Math.floor(effectiveStat(state, actor, template.damage.stat) * (template.damage.multiplier ?? 1));
  const flatAttack = fixedAttack ? Math.max(0, fixedAttack.value + (fixedAttack.ignoreAttributes === false ? attributeBase() : 0)) : null;
  const protocolInitial = fixedDamage?.value ?? flatAttack ?? (state.ruleset === 'protocol' && template.damage
    ? attributeBase() + Number(template.power ?? 20) + Number(weapon?.template?.attack ?? 0)
    : null);
  const armorPierce = { flat: dsl.stat(state, actor, 'armorPierce', template.armorPierce ?? 0, { ...strike, damageType }), percent: rules.armorPenetration ?? 0 };
  const recipient = cover || !hasStrikeDamage(template) ? target : guardFor(state, target) ?? target;
  const reduction = cover ? { multiplier: 1, armorMultiplier: fixedDamage || fixedAttack ? 1 : undefined, armor: target.armor ?? 0 }
    : mitigation(state, recipient, damageType, true, armorPierce, { attacker: actor, intercepting: recipient !== target });
  const shield = cover ? null : statusOf(recipient, 'shield');
  const absorb = shield ? statusAmount(shield) : 0;
  const dice = fixedDamage ? flatDice(fixedDamage.value) : template.damage == null ? null : diceFormula(state, template.damage, actor);
  const shown = (raw, factor = 1) => Math.max(0, Math.floor(Math.floor(dsl.stat(state, actor, 'damage', raw * (fixedDamage ? 1 : multiplier) * factor * dsl.damageFactor(state, actor, { ...strike, damageType }), { ...strike, damageType }))
    * reduction.multiplier * reduction.armorMultiplier * finalDamageMultiplier(actor) * (fixedDamage ? 1 - (reduction.attributeReduction ?? 0) : 1)) - absorb);
  const flat = fixedAttack || fixedDamage;
  const bounds = (critical = false, factor = 1) => (flat ? [protocolInitial, protocolInitial] : diceBounds(dice, critical)).map(n => shown(n, factor));
  const average = (critical = false, factor = 1) => flat ? shown(protocolInitial, factor) : diceAverage(dice, n => shown(n, factor), critical);
  const damage = dice ? (protocolInitial == null ? bounds() : [shown(protocolInitial), shown(protocolInitial)]) : [0, 0];
  const criticalDamage = dice && critChance > 0 ? bounds(true) : null;
  const savedDamage = dice && saveStat ? bounds(false, .5) : null;
  const expectedDamage = !dice ? 0 : Math.max(0, hitChance - critChance - saveChance) * average()
    + (criticalDamage ? critChance * average(true) : 0)
    + (savedDamage ? saveChance * average(false, .5) : 0);
  const expectedD20 = saveStat ? 10.5 : automatic ? null : advantage > 0 ? 13.825 : advantage < 0 ? 7.175 : 10.5;
  const combo = !cover && weapon && (template.effects ?? []).find(expr => expr.trigger === 'on_hit'
    && [...effectNodes(expr.effects, true)].some(node => node.kind === 'grantStatus' && node.statusId === 'bleed'));
  return { id: target.id, targetId: target.id, name: target.name, x: at.x, y: at.y, ...geometry,
    recipientId: recipient.id, arc, backstab: Boolean(backstab), flanked, accuracy, defense, highGround: high,
    sizeModifier, distanceModifier: closeRange, weaponRangeModifier, stance, stanceRules: rules,
    accuracySources: { explicit: template.accuracy ?? 0, highGround: high, size: sizeAccuracy, distance: closeRange, weaponRange: weaponRangeModifier, status: changes(actor, 'accuracy') },
    intent: context.intent ?? 'normal', intentDifficulty: intentSpec.difficulty, intentMultiplier: intentSpec.multiplier,
    cover: penalty, coverId: protectedBy?.id ?? null, advantage, advantages, disadvantages, hitChance, critChance, expectedD20,
    automatic: Boolean(automatic), guaranteeHit, guaranteeCrit, tierUp, arrow, saveStat, saveDC, saveBonus, saveChance, multiplier, damageType, armorPierce, protocolInitial,
    coreBonus: dsl.check(state, actor, 'coreBonus', strike), dodgeBonus: dodge,
    damageMultiplier: dsl.stat(state, actor, 'damage', multiplier * dsl.damageFactor(state, actor, { ...strike, damageType }), { ...strike, damageType }),
    offHand: Boolean(weapon?.offHand?.template), armor: reduction.armor, damagePipeline: reduction.armorMultiplier,
    shield: absorb, damage, damageMin: damage[0], damageMax: damage[1], fixedDamage: Boolean(fixedDamage), criticalDamage,
    savedDamage, expectedDamage, dice, combo: combo ? { bleedStacks: [...effectNodes(combo.effects, true)].find(n => n.statusId === 'bleed').stacks ?? 1,
      bonusDamage: [...effectNodes(combo.effects, true)].find(n => n.kind === 'damage')?.amount ?? 0, on: backstab ? 'hit' : 'critical' } : null };
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
const healMultiplier = (state, actor) => dsl.stat(state, actor, 'healing', 1, { actionType: 'skill' });
const healShieldRatio = (state, actor) => equipped(state, actor).reduce((sum, item) => sum +
  (findNode(item.template, 'shield', node => node.percentOfHealing != null)?.percentOfHealing ?? 0), 0);

function inInteractionRange(state, actor, at) {
  return near(actor, at) <= 1 && Math.abs(elevation(state, actor) - elevation(state, at)) <= 1 && clearSight(state, actor, at);
}
function nearbyCovers(state, at) {
  return values(state.covers).filter(c => c.hp > 0 && inInteractionRange(state, at, c)).sort(byId);
}

function canExecute(state, actor, target, effect, nonLethal) {
  return alive(target) && target.team !== actor.team && visibleEnemy(state, actor, target)
    && (effect.strict ? target.hp / target.maxHp < effect.threshold : target.hp / target.maxHp <= effect.threshold) && !nonLethal && !target.nonLethal && !changes(target, 'preserveLife')
    && (!effect.requiresPool || Boolean(resourcePool(state, actor, effect.requiresPool)));
}

function usableTiles(state, actor, template, weapon, nonLethal) {
  const execute = findNode(template, 'execute', node => node.requiresPool);
  return allCells(state).filter(at => validReach(state, actor, at, template, weapon?.ammo) &&
    (!execute || canExecute(state, actor, locateUnit(state, at), execute, nonLethal)) &&
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
  const equipmentSkill = type === 'skill' ? new Map(equippedActiveSkills(state, unit)).get(skillId) : null;
  const skill = type === 'skill' ? equipmentSkill ?? tableEntry(state.skills, skillId) : null;
  if (type === 'skill' && (!skill || (!equipmentSkill && !unit.skills.includes(skillId)))) return fail('单位没有此技能');
  if (equipmentSkill && !dsl.available(state, unit, equipmentSkill.entry)) return fail('装备技能次数已用尽或冷却中');
  if (skill && !equipmentSkill) {
    const entries = dsl.skillExpressions(skill, skillId);
    if (entries.length && entries.length === skill.effects.length && !skill.damage && !skill.heal
      && !entries.some(entry => dsl.available(state, unit, entry))) return fail('技能次数已用尽或冷却中');
  }
  const cost = skill ?? tableEntry(ACTIONS, type);
  if (!cost) return fail('未知动作');
  const aimed = needsTarget(type);
  const unplaced = x === undefined && y === undefined;
  if (type !== 'skill' && skillId !== undefined || (!unplaced && !aimed)) return fail('动作带有不适用的参数');
  if (!unplaced && (!Number.isInteger(x) || !Number.isInteger(y) || !tileAt(state, x, y))) return fail('目标坐标超出棋盘');
  const { ap, slot } = cost;
  const common = { ok: true, ap, cost: ap, slot, ...actorCost(cost) };
  if (type === 'end') return common;
  if (changes(unit, 'skip')) return fail('当前单位受控制，只能结束回合');
  const cannotPay = paymentError(state, unit, ap, slot, cost);
  if (cannotPay) return fail(cannotPay, { ap });
  const center = unplaced ? undefined : pos(x, y);
  const weapon = weaponInfo(state, unit);
  if (type === 'shield_bash' && !unit.shield) return fail('没有盾牌');
  if (type === 'reload') {
    if (!weapon.ammo || weapon.infiniteAmmo) return fail('当前武器不需要装填');
    if (weapon.ammoCount >= weapon.ammo.cap) return fail('弹仓已满');
    return { ...common, ammo: weapon.ammoCount, capacity: weapon.ammo.cap };
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
  const template = shieldBash ? { name: '盾击', range: 1, accuracy: 0, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' }, effects: shieldBashEffects } : attack ? weapon.template : skill;
  const effect = attack ? undefined : findNode(template, 'teleportBackstab');
  if (effect && changes(unit, 'rooted')) return fail('定身时不能瞬移');
  if (attack && !shieldBash && weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail('弹仓已空，请装填');
  const triggers = attack && !shieldBash ? weapon.effects.map(e => ({ ...e })) : (template.effects ?? []).map(e => ({ ...e }));
  const stance = unit.stance ?? (unit.offHand ? (unit.offHand.kind === 'consumable' ? 'attunement' : 'dual_wield') : unit.shield ? 'sword_shield' : 'light_blade');
  const tuning = { name: template.name, shape: template.shape ?? 'single', stance, effects: triggers,
    ...(attack && !shieldBash ? { souls: weapon.souls, multiplier: weapon.soulMultiplier, ammo: weapon.ammoCount, infiniteAmmo: weapon.infiniteAmmo,
      instanceId: weapon.instance?.id ?? null } : {}) };
  const corpseSkill = template.target === 'corpse' || template.effects?.some(e => isExpression(e) && e.target === 'corpse' && ['active','on_skill_cast'].includes(e.trigger));
  if (corpseSkill && unplaced) {
    return { ...common, ...tuning, cells: corpses(state).filter(c => validReach(state, unit, c, template)).map(c => pos(c.x, c.y)) };
  }
  if (unplaced) {
    return { ...common, ...tuning, cells: usableTiles(state, unit, template, attack && !shieldBash ? weapon : null, action.nonLethal ?? unit.nonLethal) };
  }
  const geometry = reaches(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  if (!ground(state, center)) return fail('墙体无法指定', geometry);
  if (geometry.distance > geometry.range + 1e-9) return fail('目标超出射程', geometry);
  if (!clearSight(state, unit, center)) return fail('墙体阻断视线', geometry);
  const aimedUnit = locateUnit(state, center);
  if (corpseSkill) {
    const corpse = corpses(state).find(c => sameCell(c, center));
    return corpse ? { ...common, ...geometry, ...tuning, cells: [center], targets: [], center, corpseId: corpse.id } : fail('目标格没有可用尸体');
  }
  const execute = findNode(template, 'execute', node => node.requiresPool);
  if (execute && !canExecute(state, unit, aimedUnit, execute, action.nonLethal ?? unit.nonLethal)) return fail('目标或装备资源不满足斩杀条件');
  const solid = locateCover(state, center);
  const coverTarget = Boolean(solid && (attack || hasStrikeDamage(template)));
  const cells = area(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  const aoe = (template.shape ?? 'single') !== 'single';
  if (!cells.length) return fail('请选择一个方向', geometry);
  if (!aoe) {
    if (!(attack ? aimedUnit && aimedUnit.team !== unit.team : selectionAllows(template, unit, aimedUnit)) && !coverTarget && template.target !== 'cell') {
      return fail('该格没有合适的目标', geometry);
    }
    if (aimedUnit && aimedUnit.team !== unit.team && !visibleEnemy(state, unit, aimedUnit)) return fail('目标正在隐身', geometry);
  }
  const hostile = attack || template.target === 'enemy' || (hasStrikeDamage(template) && template.target !== 'ally' && template.target !== 'self');
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
  const targets = targetUnits.map(t => ({ ...targetProfile(state, unit, t, t, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, teleport: effect, intent: resolvedIntent, skillId: action.skillId }),
    bonusDice: action.bonusDice ?? 0, intent: resolvedIntent, nonLethal: action.nonLethal ?? unit.nonLethal ?? false }));
  if (hasStrikeDamage(template)) {
    for (const c of values(state.covers).filter(c => c.hp > 0 && cells.some(at => sameCell(at, c))).sort(byId)) {
      targets.push({ ...targetProfile(state, unit, c, c, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, cover: true, intent: action.intent ?? unit.intent ?? 'normal' }), kind: 'cover' });
    }
  }
  if (template.heal != null) {
    const healing = diceBounds(diceFormula(state, template.heal, unit)).map(n => Math.floor(n * healMultiplier(state, unit)));
    for (const target of targets) if (target.kind !== 'cover') {
      target.heal = healing;
      target.healMin = healing[0]; target.healMax = healing[1];
      target.healingShield = healing.map(n => Math.min(10000, Math.floor(n * healShieldRatio(state, unit))));
    }
  }
  const first = targets.find(t => sameCell(t, center)) ?? targets[0];
  return { ...first, ...common, ...geometry, ...tuning, ...(first ? { damageMultiplier: first.damageMultiplier } : {}),
    bonusDice: action.bonusDice ?? 0, intent: action.intent ?? unit.intent ?? 'normal', nonLethal: action.nonLethal ?? unit.nonLethal ?? false,
    dXYZ: geometry.distance, cells, targets, center, ...(blink ? { teleport: blink } : {}), hostile };
}

function maneuverContest(state, actor, target, maneuver) {
  const attackStat = maneuver === 'grapple' ? 'str' : 'agi';
  const defenseStat = maneuver === 'trip' ? 'agi' : 'str';
  const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
  const attackerTotal = effectiveStat(state, actor, attackStat) + attackerRoll;
  const defenderTotal = effectiveStat(state, target, defenseStat) + defenderRoll;
  const success = attackerTotal >= defenderTotal;
  record(state, actor, 'contest', `${actor.name}${success ? '成功' : '未能'}${({ grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞' })[maneuver]}`, {
    maneuver, targetId: target.id, attackerRoll, defenderRoll, attackerTotal, defenderTotal, success });
  return success;
}
function changeCounter(state, actor, weapon, effect, resource, after) {
  const before = weapon.instance.counters?.[resource] ?? effect.initial ?? 0;
  (weapon.instance.counters ??= {})[resource] = after;
  record(state, actor, 'counter', `${weapon.template.name} · ${resource} ${before} → ${after}`,
    { instanceId: weapon.instance.id, counterKey: resource, before, after });
}

function resolveCheck(state, actor, profile) {
  if (profile.saveStat) {
    const saveRoll = randomDie(state, 20), saveTotal = saveRoll + profile.saveBonus;
    const saved = saveTotal >= profile.saveDC;
    record(state, actor, 'save', `${profile.name}${saved ? '通过' : '未通过'}豁免 (${saveTotal}/${profile.saveDC})`,
      { targetId: profile.id, saveStat: profile.saveStat, saveRoll, saveBonus: profile.saveBonus, saveTotal, saveDC: profile.saveDC, saved });
    return { hit: true, critical: false, saved };
  }
  if (profile.automatic) return { hit: true, critical: profile.guaranteeCrit, rating: ratingFor(profile.guaranteeCrit ? 20 : 11), intent: { success: true, multiplier: 1 }, saved: false };
  const requestedBonus = profile.bonusDice ?? 0;
  const { rng, rolls: dice, value: selected } = requestedBonus || actor.penaltyDice
    ? rollProtocolD20(state.rng, { bonus: requestedBonus, penalty: actor.penaltyDice ?? 0 })
    : rollD20(state.rng, profile.advantages, profile.disadvantages);
  actor.bonusDice = Math.max(0, (actor.bonusDice ?? 0) - requestedBonus); actor.penaltyDice = 0;
  state.rng = rng;
  const total = selected + profile.accuracy;
  let rating = ratingFor(total);
  if (profile.tierUp && rating.multiplier) rating = RATING_TABLE[Math.max(0, RATING_TABLE.indexOf(rating) - 1)];
  if (profile.guaranteeHit && (selected === 1 || !rating.multiplier)) rating = ratingFor(11);
  if (profile.guaranteeCrit && rating.multiplier < 1.3) rating = ratingFor(20);
  const critical = profile.guaranteeCrit || selected === 20;
  const hit = Boolean(profile.guaranteeHit || selected !== 1 && rating.multiplier > 0);
  let intent = { required: false, success: true, multiplier: 1 };
  const defender = state.units[profile.id];
  if (hit && defender && profile.intent && profile.intent !== 'normal') {
    const defenderD20 = randomDie(state, 20);
    const weakness = changes(defender, 'intentDifficulty');
    const intentSpec = { ...(INTENTS[profile.intent] ?? INTENTS.normal), difficulty: Math.max(0, (INTENTS[profile.intent]?.difficulty ?? 0) + weakness) };
    const ratingBonus = { 平暴击: 10, 强暴击: 20, 超暴击: 30 }[rating.name] ?? 0;
    const attackerTier = actor.tier ?? 1, defenderTier = defender.tier ?? 1;
    const attackerBase = attackerTier * 5, defenderBase = defenderTier * 5;
    const coreBonus = profile.intent === 'core' ? profile.coreBonus : 0;
    const attackerTotal = attackerBase + selected + ratingBonus + coreBonus;
    const defenderTotal = defenderBase + defenderD20 + intentSpec.difficulty;
    intent = intentCheck(intentSpec, attackerTier, defenderTier, selected, defenderD20, ratingBonus + coreBonus);
    record(state, actor, 'intent', `${profile.name}${intent.success ? '意图成立' : '意图受阻'}`, {
      targetId: profile.id, intent: profile.intent, attackerTier, defenderTier, attackerBase, attackerD20: selected,
      rating: rating.name, ratingBonus, ...(coreBonus ? { coreBonus } : {}), attackerTotal, defenderBase, defenderD20, intentDifficulty: intentSpec.difficulty,
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

function healWithGear(state, actor, target, spec, name, skillScale = 1) {
  const dice = diceRoll(state, diceFormula(state, spec, actor));
  restoreHP(state, target, Math.floor(dice.value * skillScale), actor.id, name, { dice, actionType: 'skill' });
}

function offHandFollowup(state, actor, target, primaryProfile, primaryRating) {
  const weapon = weaponInfo(state, actor);
  if (weapon.stance !== 'dual_wield' || !weapon.offHand.template?.damage || !alive(target)) return;
  const cost = (actor.tier ?? 1) * 10;
  if ((actor.sp ?? 0) < cost || (primaryRating?.multiplier ?? 0) < .8) return;
  actor.sp -= cost;
  const offTemplate = weapon.offHand.template;
  const profile = targetProfile(state, actor, target, target, offTemplate, { weapon: { ...weapon.offHand, stance: 'dual_wield' } });
  profile.disadvantages = primaryRating?.multiplier >= 1.3 ? 0 : Math.max(1, profile.disadvantages ?? 0);
  profile.bonusDice = 0;
  record(state, actor, 'followup', `${actor.name}发动副手追击`, { targetId: target.id, cost, weaponId: weapon.offHand.instance?.id ?? null });
  const result = resolveCheck(state, actor, profile);
  if (!result.hit) return;
  const dice = profile.protocolInitial != null
    ? flatDice(profile.protocolInitial) : diceRoll(state, profile.dice, result.critical);
  const scaled = Math.floor(dice.value * profile.multiplier * (result.rating?.multiplier ?? 1) * .5);
  const { recipient } = damageTarget(state, target, actor.id, scaled, profile.damageType, '副手追击', {
    attacker: actor, hit: true, melee: profile.melee, armorPierce: profile.armorPierce,
    details: { dice, rating: result.rating?.name, followup: true, cost },
  });
  dispatchEffect(state, actor, 'on_hit', { target: recipient, melee: profile.melee, arrow: profile.arrow, backstab: profile.backstab, critical: result.critical, weaponId: weapon.offHand.instance?.id, damageType: profile.damageType });
}

function effectSaved(state, actor, target, effect) {
  const check = (unit, saveStat, saveDC) => {
    const saveRoll = randomDie(state, 20), saveBonus = effectiveStat(state, unit, saveStat);
    const saveTotal = saveRoll + saveBonus;
    return { saveStat, saveRoll, saveBonus, saveTotal, saveDC, saved: saveTotal >= saveDC };
  };
  let detail;
  const dc = resolveDC(state, actor, effect.contest?.dc ?? effect.dc);
  if (effect.contest) {
    const { attacker, defender } = effect.contest;
    const attack = check(actor, attacker, dc), defense = check(target, defender, dc);
    detail = { contest: { attack, defense, dc }, saved: attack.saveTotal - defense.saveTotal < dc };
  } else if (Array.isArray(effect.save)) {
    const checks = effect.save.map(stat => check(target, stat, dc));
    detail = { checks, mode: effect.mode, saved: effect.mode === 'all' ? checks.every(x => x.saved) : checks.some(x => x.saved) };
  } else detail = check(target, effect.save, dc);
  const { saved } = detail;
  record(state, actor, 'save', `${target.name}${saved ? '通过' : '未通过'}豁免`, { targetId: target.id, ...detail });
  return saved;
}

function removeStatus(state, actor, target, effect) {
  const removed = [];
  for (const status of values(target.statuses)) {
    const categoryMatches = effect.category === 'all_negative' ? ['control','dot','debuff'].includes(status.category) : status.category === effect.category;
    if (effect.statusId ? effect.statusId !== status.id : !categoryMatches || status.durationType === 'persistent') continue;
    delete target.statuses[status.id];
    removed.push(status.id);
  }
  if (effect.category) record(state, actor, 'cleanse', `${target.name}受到净化`, { targetId: target.id, removed });
  return removed.length > 0;
}

function teleportBehind(state, actor, target) {
  const to = backCell(state, target);
  if (!to || changes(actor, 'rooted')) return false;
  const from = pos(actor.x, actor.y);
  Object.assign(actor, to);
  record(state, actor, 'teleport', `${actor.name}瞬移至目标背后`, { from, to });
  return true;
}

function applyStrike(state, actor, action, plan, opportunityWeapon = null) {
  const weapon = opportunityWeapon ?? (action.type === 'attack' ? weaponInfo(state, actor) : null);
  const template = action.type === 'shield_bash'
    ? { name: '盾击', range: 1, damage: { count: 1, sides: 4, stat: 'str', type: 'physical' }, effects: shieldBashEffects }
    : weapon ? weapon.template : tableEntry(state.skills, action.skillId) ?? new Map(equippedActiveSkills(state, actor)).get(action.skillId);
  const skillEntries = template.entry ? [template.entry] : skillExpressions(weapon ? null : template, action.skillId);
  const mainTarget = state.units[plan.corpseId ?? plan.targets.find(t => t.kind !== 'cover')?.id];
  const multipliers = [];
  const skillScale = action.type === 'skill' ? Math.max(0, dsl.stat(state, actor, 'skillPower', 1, { target: mainTarget, school: template.school, actionType: 'skill' })) : 1;
  const effectContext = { target: mainTarget, center: plan.center, terrainTarget: template.target === 'cell' ? locateUnit(state, plan.center) ?? plan.center : null,
    actionType: action.type, school: template.school, multipliers, skillScale, entries: skillEntries, weaponId: weapon?.instance?.id ?? template.entry?.instance?.id,
    resourceCost: template.resourceCost?.amount, opportunityAttack: Boolean(opportunityWeapon),
    melee: plan.targets[0]?.melee, arrow: Boolean(weapon?.ammo),
    ...(action.type === 'skill' && template.shape !== 'single' ? { skillArea: new Set(plan.targets.map(target => target.id)) } : {}),
    damageType: template.damage?.type ?? template.damageType, power: template.power ?? template.attack ?? Math.max(0, effectiveStat(state, actor, template.damage?.stat ?? 'int') * 10), nonLethal: plan.nonLethal };
  if (action.type === 'skill') {
    dispatchEffect(state, actor, 'on_skill_cast', effectContext, skillEntries);
    if (template.shape !== 'single' && plan.targets.length) {
      const perTarget = skillEntries.filter(({ expr }) => expr.target === 'hitTarget');
      dsl.dispatch(state, actor, 'active', effectContext, skillEntries.filter(entry => !perTarget.includes(entry)));
      for (const target of plan.targets) if (target.kind !== 'cover') dsl.dispatch(state, actor, 'active', { ...effectContext, target: state.units[target.id] }, perTarget);
    } else dsl.dispatch(state, actor, 'active', effectContext, skillEntries);
    if (!alive(actor)) return;
  }
  if (plan.hostile && statusOf(actor, 'stealth')) {
    delete actor.statuses.stealth;
    record(state, actor, 'reveal', `${actor.name}发动进攻，解除隐身`);
  }
  if (!sameCell(actor, plan.center)) actor.facing = signFacing(actor, plan.center);
  if (weapon || action.type === 'shield_bash') dispatchEffect(state, actor, 'on_attack', effectContext);
  for (const preview of plan.targets) {
    if (!alive(actor)) break;
    const cover = preview.kind === 'cover';
    const target = (cover ? state.covers : state.units)[preview.id];
    if (!alive(target)) continue;
    let profile = preview;
    if (preview.saveStat && typeof template.saveDC === 'object') {
      profile = { ...profile, saveDC: resolveDC(state, actor, template.saveDC), saveBonus: effectiveStat(state, target, preview.saveStat) };
    }
    const { hit, critical, rating, intent, saved } = resolveCheck(state, actor, profile);
    if (!hit) continue;
    let recipient = target, dealt = 0;
    const hitContext = { ...effectContext, target, center: pos(target.x, target.y), damageType: profile.damageType, hitRating: rating?.name, melee: profile.melee, arrow: profile.arrow, backstab: profile.backstab, critical, saved };
    const factor = damageType => dsl.damageFactor(state, actor, { ...hitContext, damageType }, multipliers);
    if (profile.dice) {
      const dice = profile.protocolInitial != null
        ? flatDice(profile.protocolInitial)
        : diceRoll(state, profile.dice, critical);
      const stance = actor.stance ?? stanceLabel[stanceFor({ mainHand: actor.mainHand ?? actor.weapon, offHand: actor.offHand, shield: actor.shield })];
      const sizeScale = meleeMultiplier(actor);
      const ratingScale = rating?.multiplier ?? (critical ? 2 : 1);
      const intentScale = intent?.success ? intent.multiplier ?? 1 : 1;

      const stanceScale = profile.stance === 'greatsword' ? (actor.greatswordMode === 'defensive' ? 1.5 : 1.3) : 1;
      const offHandScale = profile.stance === 'dual_wield' && profile.offHand ? .5 : 1;
      const attackDamage = profile.fixedDamage ? dice.value
        : dice.value * profile.multiplier * sizeScale * ratingScale * intentScale * stanceScale * offHandScale;
      const scaled = Math.floor(Math.max(0, dsl.stat(state, actor, 'damage', attackDamage * skillScale * factor(profile.damageType), hitContext)) * (saved ? .5 : 1));
      const details = { dice, critical, saved, rating: rating?.name ?? '有效', ratingMultiplier: ratingScale, intent: intent ?? { success: true, multiplier: 1 }, attackMultiplier: profile.fixedDamage ? 1 : profile.multiplier * factor(profile.damageType), ...(hitContext.weaponId ? { weaponId: hitContext.weaponId } : {}), stanceScale, offHandScale };
      if (profile.kind === 'cover') { coverDamage(state, actor, target, scaled, details); continue; }
      ({ recipient, dealt } = damageTarget(state, target, actor.id, scaled, profile.damageType, template.name,
        { attacker: actor, hit: true, melee: profile.melee, armorPierce: profile.armorPierce, details, preserveLife: profile.nonLethal }));
      if (profile.nonLethal && recipient.hp === 1 && dealt > 0) {
        record(state, actor, 'nonlethal', `${recipient.name}被非致死攻击留有 1 HP`, { targetId: recipient.id, hpBefore: dealt + 1, hpAfter: 1 });
      }
    }
    if (profile.kind === 'cover') continue;
    dispatchEffect(state, actor, 'on_hit', { ...hitContext, target: recipient, dealt, damageFactor: factor }, skillEntries);
    if (alive(recipient) && template.heal != null) healWithGear(state, actor, recipient, template.heal, template.name, skillScale);
    if (profile.dice && action.type === 'attack' && alive(actor) && alive(recipient) && recipient.team !== actor.team) {
      offHandFollowup(state, actor, recipient, profile, rating);
    }
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
      if (alive(target)) damageTarget(state, target, actor.id, 12, 'energy', '爆桶', { attacker: actor, hit: true, direct: false });
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
  if (!plan.ok) {
    // The API simulates on a copy: throwing after record() would discard the rejection log.
    if (plan.error === insufficientHP) {
      record(state, currentUnit(state), 'skill_rejected', insufficientHP, {skillId:action.skillId});
      return state.logs.slice(-1);
    }
    throw new Error(plan.error);
  }
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
    if (type === 'skill') {
      const skill = tableEntry(state.skills, skillId);
      if (plan.hp) {
        actor.hp -= plan.hp;
        record(state, actor, 'skill_cost', `施放 ${skill.name} 消耗 ${plan.hp} HP`, {skillId, hp:plan.hp, remainingHP:actor.hp});
      }
      if (skill?.resourceCost?.resource) {
        const { resource, amount: cost } = skill.resourceCost;
        const { item, effect, amount } = resourcePool(state, actor, resource);
        changeCounter(state, actor, item, effect, resource, amount - cost);
      }
    }
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
      const enemies = living(state).filter(u => u.team !== actor.team).sort((a,b) => effectiveStat(state, b, 'agi') - effectiveStat(state, a, 'agi') || byId(a,b));
      const target = enemies[0]; const attackerRoll = randomDie(state,20), defenderRoll = randomDie(state,20);
      const success = target ? effectiveStat(state, actor, 'agi') + attackerRoll >= effectiveStat(state, target, 'agi') + defenderRoll : true;
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
      dsl.changeResource(state, actor, actor, { kind: 'produceResource', resource: weapon.ammo.resource, local: true }, weapon.ammo.cap, '装填', { instance: weapon.instance });
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
