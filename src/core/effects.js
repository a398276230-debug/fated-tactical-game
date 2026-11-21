import { effectNodes, isExpression } from './effect_schema.js';

const levelScale = (ls, tier) => ls?.perLevel != null ? 1 + ls.perLevel * (tier - 1)
  : ls ? ls.min + (ls.max - ls.min) * (tier - 1) / 6 : 1;
const livingUnit = unit => unit && unit.hp > 0 && !unit.fled;
const own = (table, key) => Object.hasOwn(table ?? {}, key) ? table[key] : undefined;
const values = table => Object.values(table ?? {});
function legacyId(prefix, index) {
  if (prefix.length <= 45) return `${prefix}-${index}`;
  const hash = Array.from(prefix).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261);
  return `${prefix.slice(0, 35)}-${(hash >>> 0).toString(36)}-${index}`;
}
const compare = (left, op, right) => ({ '<': left < right, '<=': left <= right, '=': left === right, '>=': left >= right, '>': left > right })[op];
const ratio = unit => unit?.hp / unit?.maxHp;
export const corpses = state => values(state.units).filter(unit => unit.hp <= 0 && !unit.fled && !unit.corpseConsumed);

export const expression = (id, trigger, target, effects, extra = {}) => ({ id, trigger, target, effects, ...extra });
const equippedKey = (instance, expr) => `${instance.id}:${expr.id}`;
export const resourceDefinitions = (template, enabledOnly = false) => (template?.effects ?? []).filter(e => e.trigger === 'passive' && e.target === 'self').flatMap(e =>
  [...effectNodes(e.effects, enabledOnly)].filter(n => n.kind === 'produceResource' && n.cap != null));
export const initialCounters = template => Object.fromEntries(resourceDefinitions(template).map(n => [n.resource, n.initial ?? 0]));
export const effectLabel = expr => expr.label ?? `${expr.trigger} · ${expr.effects.map(n => n.label ?? n.kind).join(' / ')}`;

// Legacy adapter. Translate at ingestion, never in the combat resolver.
export function adaptLegacyEffects(effects, context, prefix = 'legacy') {
  return effects.flatMap((e, i) => {
    if (isExpression(e) || !e || typeof e !== 'object') return [e];
    const id = legacyId(prefix, i);
    const fields = (...keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(e, k)).map(k => [k, e[k]]));
    const rule = (type, value = true) => ({ type, value });
    const source = context === 'equipment' ? { params: { source: 'weapon' } } : {};
    const unsaved = rule('saved', false);
    const scope = e.scope === 'arrow' ? rule('arrow') : e.scope ? rule('melee', e.scope === 'melee') : null;
    const passive = (nodes, extra) => expression(id, 'passive', 'self', nodes, extra);
    const hit = (nodes, extra = {}) => expression(id, 'on_hit', 'hitTarget', nodes, { ...source, condition: unsaved, ...extra });
    const status = { kind: 'grantStatus', ...fields('statusId','turns','stacks','modifiers','amount') };
    const pool = (resource, cap, extra) => ({ kind: 'produceResource', resource, cap, ...extra });
    const scoped = scope ? { condition: scope } : {};
    switch (e.kind) {
      case 'status': return hit([{ ...status, ...(e.target === 'self' ? { target: 'self' } : {}),
        ...(e.statusId === 'stealth' && e.target !== 'self' ? { condition: rule('enemy', false) } : {}),
      }, ...(e.statusId === 'stealth' && e.target !== 'self' ? [{ ...status, target: 'self', condition: rule('enemy') }] : [])]);
      case 'save_or_status': return hit([status], { roll: { ...(e.contest ? { contest: e.contest } : { save: e.save, dc: e.saveDC, ...fields('mode') }), ...fields('chance') } });
      case 'fixed_attack': return passive([{ kind: 'modifyDamageBase', ...fields('value','ignoreAttributes') }], source);
      case 'fixed_damage': return passive([{ kind: 'modifyDamageBase', value: e.amount, damageType: e.damageType, unscaled: true }]);
      case 'bonus_damage': return hit([{ kind: 'damage', flat: e.amount, damageType: e.damageType, strikeBonus: true, label: '附加伤害' }], { params: {}, ...(scope ? { condition: scope } : { condition: rule('enemy') }) });
      case 'check_bonus': return passive([{ kind: 'modifyCheck', ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'kind')) }]);
      case 'guaranteed_hit': case 'guaranteed_crit': return passive([{ kind: 'forceOutcome', mode: e.kind === 'guaranteed_hit' ? 'hit' : 'crit' }], scoped);
      case 'hit_tier_up': return passive([{ kind: 'upgradeHitTier' }], scoped);
      case 'infinite_ammo': return expression(id, 'on_equip', 'self', [{ kind: 'grantStatus', statusId: 'infinite_ammo', durationType: 'until_removed' }]);
      case 'on_hit_status': return hit([status], { params: {}, condition: [unsaved, rule('enemy'), ...(scope ? [scope] : [])] });
      case 'tier_growth': return passive((e.stat === 'attributes' ? ['str','agi','con','int','spi'] : ['damage']).map(stat => ({ kind: 'modifyStat', stat, percent: 1, levelScaling: e.value })), e.stat === 'attack' ? source : {});
      case 'resource_pool': return passive([pool(e.counterKey, e.capacity)]);
      case 'resource_scale': return passive([{ kind: 'multiplyDamage', additive: true, resourceScale: { resource: e.resource, perUnit: e.perUnit } }]);
      case 'resource_restore': return expression(id, 'active', 'self', ['hp','mp','sp'].map(resource => ({ kind: 'restoreResource', resource, percentPerCost: e.perUnit })));
      case 'execute_threshold': return expression(id, 'active', 'hitTarget', [{ kind: 'chainEffect', stopOnFailure: true, effects: [
        { kind: 'execute', threshold: e.threshold, strict: true, requiresPool: e.resource },
        { kind: 'produceResource', target: 'self', resource: e.resource, targetTierBase: e.perTier },
      ] }]);
      case 'kill_charge_weapon': return [passive([pool(e.counterKey ?? 'souls', e.maxStacks ?? 10), { kind: 'multiplyDamage', local: true,
        resourceScale: { resource: e.counterKey ?? 'souls', perUnit: e.bonusPerStack ?? .5 } }], source), expression(`${id}-kill`, 'on_kill', 'self', [
        { kind: 'produceResource', resource: e.counterKey ?? 'souls', amount: 1, local: true },
      ], source)];
      case 'ammo': return [passive([pool(e.counterKey ?? 'ammo', e.capacity ?? 6, { initial: e.capacity ?? 6, reloadable: true }),
        { kind: 'modifyStat', stat: 'armorPierce', flat: e.armorPierce ?? 0 },
        { kind: 'modifyCheck', highGroundRange: e.highGroundRange ?? 0, highGroundAccuracy: e.highGroundAccuracy ?? 0 }], source),
        expression(`${id}-spend`, 'on_attack', 'self', [{ kind: 'drainResource', resource: e.counterKey ?? 'ammo', local: true, amount: 1, requireFull: true }], {
          ...source, condition: { type: 'not', conditions: [{ type: 'selfStatusModifier', key: 'infiniteAmmo', value: true }] },
        })];
      case 'frost_thorns': {
        const condition = [rule('melee'), rule('reaction', false), rule('enemy')];
        return [expression(id, 'on_damaged', 'attacker', [{ kind: 'damage', amount: e.damage ?? 3, label: '霜纹荆棘' }], { condition }),
          expression(`${id}-status`, 'on_damaged', 'attacker', [{ ...status, statusId: status.statusId ?? 'chill' }], { condition, roll: { chance: e.chance ?? .4 }, label: '霜纹荆棘' })];
      }
      case 'backstab': return [passive([{ kind: 'multiplyDamage', factor: 1 + (e.bonusMultiplier ?? .4) }, { kind: 'modifyCheck', advantage: 1 }], { ...source, condition: rule('backstab') }),
        expression(`${id}-hit`, 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId: 'bleed', stacks: e.bleedStacks ?? 1 },
          { kind: 'damage', amount: e.comboDamage ?? 0, inheritDamageType: true, label: '双生血牙连击' }],
          { ...source, condition: { type: 'or', conditions: [rule('backstab'), rule('critical')] } })];
      case 'healing_shield': return [passive([{ kind: 'modifyStat', stat: 'healing', percent: e.healBonus ?? .25, condition: { type: 'actionType', value: 'skill' } }]),
        expression(`${id}-shield`, 'on_heal', 'hitTarget', [{ kind: 'shield', percentOfHealing: e.shieldRatio ?? .5, stack: true }], { condition: rule('actionType', 'skill') })];
      case 'opportunity_root': return hit([{ kind: 'grantStatus', statusId: 'root', turns: 1 }], { condition: rule('opportunityAttack') });
      case 'knockback': return hit([{ kind: 'knockback', ...fields('distance','collisionDamage') }]);
      case 'teleport_backstab': return expression(id, 'active', 'hitTarget', [{ kind: 'teleportBackstab', ...fields('bonusMultiplier') }]);
      case 'cleanse': return hit([{ kind: 'removeStatus', category: 'all_negative' }]);
      default: return [e];
    }
  });
}

export function migrateStateEffects(state) {
  for (const [table, context] of [['equipment','equipment'], ['skills','skill']]) {
    for (const [id, template] of Object.entries(state[table] ?? {})) {
      if (Array.isArray(template?.effects) && template.effects.some(e => !isExpression(e))) {
        template.effects = adaptLegacyEffects(template.effects, context, `legacy-${table}-${id}`);
      }
    }
  }
  return state;
}

export function createEffectEngine(io) {
  const expressions = (state, actor) => io.equipped(state, actor).flatMap(({ template, instance }) => {
    if (template?.boundTo && template.boundTo !== actor.id) return [];
    return (template?.effects ?? []).filter(isExpression).map(expr => ({ expr, key: equippedKey(instance, expr), instance, sourceName: template.name }));
  });
  const skillExpressions = (skill, id) => (skill?.effects ?? []).filter(isExpression).map(expr => ({ expr, key: `skill-${id}:${expr.id}`, sourceName: skill.name }));
  const activeId = key => `effect:${key}`;
  function activeSkills(state, actor) {
    if (!actor) return [];
    return expressions(state, actor).filter(({ expr }) => expr.trigger === 'active' && [...effectNodes(expr.effects, true)].some(node => node.kind !== 'chainEffect')).map(entry => {
      const { expr, key } = entry, p = expr.params ?? {};
      return [activeId(key), { name: expr.label ?? expr.id, ap: p.ap ?? 1, mp: p.mp ?? 0, sp: p.sp ?? 0,
        slot: p.slot ?? 'action', range: p.range ?? (expr.target === 'self' ? 0 : 3), shape: 'single',
        target: expr.target === 'corpse' ? 'corpse' : expr.target === 'self' ? 'self' : 'any', effects: [expr], entry }];
    });
  }
  function resource(state, unit, name) {
    if (['hp','mp','sp','ap'].includes(name)) return unit[name] ?? 0;
    if (name === 'action' || name === 'attack') return unit.used[name] ? 0 : 1;
    return own(unit.resources, name) ?? io.resourcePool(state, unit, name)?.amount ?? 0;
  }
  function available(state, actor, { expr, key }) {
    const usage = own(actor.effectUsage, key);
    const p = expr.params ?? {};
    return (usage?.count ?? 0) < (p.usesPerBattle ?? (expr.trigger === 'on_equip' ? 1 : Infinity))
      && (usage == null || state.round - usage.round >= (p.cooldown ?? 0));
  }
  function condition(state, actor, subject, rule, ctx, entry) {
    if (!rule) return true;
    const check = child => condition(state, actor, subject, child, ctx, entry);
    if (Array.isArray(rule)) return rule.every(check);
    const { type, value, op } = rule;
    switch (type) {
      case 'and': return rule.conditions.every(check);
      case 'or': return rule.conditions.some(check);
      case 'not': return !check(rule.conditions[0]);
      case 'selfHp': return compare(ratio(actor), op, value);
      case 'targetHp': return compare(ratio(subject), op, value);
      case 'targetLevel': return !!subject && compare(subject.tier ?? 1, op, actor.tier ?? 1);
      case 'targetHasCategory': {
        if (!subject) return false;
        const categories = values(subject.statuses).map(s => s.category);
        const negative = categories.some(x => ['debuff','dot','control'].includes(x));
        return value === 'none' ? !negative : value === 'negative' ? negative : categories.includes(value);
      }
      case 'targetCreatureType': return [].concat(subject?.creatureType ?? []).includes(value);
      case 'timeOfDay': return state.time?.timeOfDay === value;
      case 'selfHasStatus': return !!own(actor.statuses, value);
      case 'selfStatusModifier': return Boolean(io.statusModifier(actor, rule.key)) === value;
      case 'targetHasStatus': return !!own(subject?.statuses, value);
      case 'selfHasTag': return actor.tags?.includes(value) ?? false;
      case 'targetHasTag': return subject?.tags?.includes(value) ?? false;
      case 'duel': return (io.living(state).length === 2) === (value ?? true);
      case 'resourceAtLeast': return resource(state, actor, rule.resource) >= rule.amount;
      case 'weaponType': return (ctx.weaponType ?? io.weaponType(state, actor)) === value;
      case 'skillSchool': return ctx.school === value;
      case 'actionType': return ctx.actionType === value;
      case 'damageType': return ctx.damageType === value;
      case 'hitRating': return ctx.hitRating === value;
      case 'enemy': return Boolean(subject && subject.team !== actor.team) === (value ?? true);
      case 'intercepting': case 'melee': case 'arrow': case 'backstab': case 'critical':
      case 'opportunityAttack': case 'saved': case 'reaction': case 'highGround': return Boolean(ctx[type]) === (value ?? true);
      case 'distance': return !!subject && compare(io.distance(state, actor, subject), op, value);
      case 'usesLeft': return available(state, actor, entry) === (value ?? true);
      default: return false;
    }
  }
  function targets(state, actor, name, ctx, radius) {
    const center = ctx.center ?? actor;
    switch (name) {
      case 'self': return [actor];
      case 'hitTarget': return ctx.target ? [ctx.target] : [];
      case 'attacker': return ctx.attacker ? [ctx.attacker] : [];
      case 'killedUnit': return ctx.killed ? [ctx.killed] : [];
      case 'corpse': return corpses(state).filter(u => ctx.center ? u.x === center.x && u.y === center.y : io.distance(state, actor, u) <= radius).slice(0, 1);
      default: return io.living(state).filter(u => (u.team === actor.team) === (name === 'alliesInRadius')
        && (ctx.skillArea ? ctx.skillArea.has(u.id) : io.distance(state, center, u) <= radius));
    }
  }
  const subject = (actor, target, ctx) => target === actor ? ctx.target ?? actor : target;
  function magnitude(state, actor, target, p, ctx) {
    const tier = actor.tier ?? 1;
    const ls = p.levelScaling;
    const level = levelScale(ls, tier);
    const rs = p.resourceScale;
    const units = rs ? resource(state, actor, rs.resource) / (rs.unitSize ?? 1) : 0;
    const scaled = (p.amount ?? 0) * level + (p.perLevel ?? 0) * tier + (rs ? (rs.unitSize ? Math.floor(units) : units) * rs.perUnit : 0);
    return scaled + (p.flat ?? 0) + (p.percentOfHealing ?? 0) * (ctx.healing ?? 0)
      + (p.targetTierBase ? p.targetTierBase ** ((ctx.target?.tier ?? 1) - 1) : 0) + (p.percentOfDamageDealt ?? 0) * (ctx.dealt ?? 0) + (p.percentOfPrevious ?? 0) * (ctx.previous ?? 0)
      + (p.percentOfSelfMaxHp ?? 0) * actor.maxHp + (p.percentOfTargetMaxHp ?? p.percentOfMaxHp ?? 0) * target.maxHp
      + (p.percentOfPower ?? 0) * (ctx.power ?? 0);
  }
  function nodeAmount(state, actor, target, p, ctx) {
    const extra = ['heal', 'shield', 'damage'].includes(p.kind) ? (p.percent ?? 0) * target.maxHp : 0;
    return Math.max(0, Math.min(1e9, Math.floor((magnitude(state, actor, target, p, ctx) + extra) * (ctx.skillScale ?? 1))));
  }
  function damagePacket(state, actor, target, p, ctx, amount) {
    const type = (p.inheritDamageType ? ctx.damageType : p.damageType) ?? 'true';
    const raw = amount * (p.resourceMultiplier ? resource(state, actor, p.resourceMultiplier) : 1)
      * (p.strikeBonus ? 1 : ctx.damageFactor?.(type) ?? damageFactor(state, actor, { ...ctx, target, damageType: type }));
    return { type, raw, hit: p.strikeBonus, ignoreArmor: p.ignoreArmor, preserveLife: p.lethal === false || ctx.nonLethal };
  }
  function previewDamage(state, actor, target, trigger, ctx, extra) {
    const packets = [];
    let conditional = false;
    const entries = new Map([...(trigger === 'active' ? [] : expressions(state, actor)), ...extra].map(entry => [entry.key, entry]));
    for (const entry of entries.values()) {
      const { expr } = entry;
      if (expr.trigger !== trigger || !available(state, actor, entry) || !sourceApplies(entry, ctx)) continue;
      const eligible = targets(state, actor, expr.target, ctx, expr.params?.radius ?? 1)
        .filter(unit => condition(state, actor, subject(actor, unit, ctx), expr.condition, ctx, entry));
      if (!eligible.length) continue;
      for (const node of expr.effects) {
        if (node.enabled === false) continue;
        if (node.kind === 'procEffect' || node.kind === 'chainEffect') { conditional = true; continue; }
        if (node.kind !== 'damage') continue;
        const p = { ...expr.params, ...node };
        const recipients = p.target && p.target !== expr.target ? targets(state, actor, p.target, ctx, p.radius ?? 1) : eligible;
        if (!recipients.some(unit => unit.id === target.id) || (p.excludeHitTarget && target.id === ctx.target?.id)) continue;
        if (!condition(state, actor, subject(actor, target, ctx), p.condition, ctx, entry)) continue;
        if (expr.roll || p.percentOfPrevious || p.percentOfDamageDealt || p.percentOfHealing) { conditional = true; continue; }
        packets.push(damagePacket(state, actor, target, p, ctx, nodeAmount(state, actor, target, p, ctx)));
      }
    }
    return { packets, conditional };
  }
  function changeResource(state, actor, target, node, amount, label, entry, ctx) {
    const name = node.resource, drain = node.kind === 'drainResource';
    if (node.kind === 'restoreResource' && io.blockRestore(target)) return false;
    const pool = io.resourcePool(state, target, name, node.local ? entry?.instance : undefined);
    if (node.local && !pool) return false;
    const before = pool?.amount ?? resource(state, target, name);
    const cap = ({ hp: target.maxHp, mp: target.maxMp, sp: target.maxSp, ap: 2, action: 1, attack: 1 })[name] ?? pool?.effect.cap ?? node.cap ?? 1e9;
    amount = Math.floor(amount + ((node.percent ?? 0) + (node.percentPerCost ?? 0) * (ctx?.resourceCost ?? 0)) * (drain ? before : cap));
    if (drain && node.requireFull && before - (node.minimumRemaining ?? 0) < amount) return false;
    const after = drain ? before - Math.min(amount, Math.max(0, before - (node.minimumRemaining ?? 0))) : Math.min(cap, before + amount);
    if (after === before) return 0;
    if (name === 'hp') return drain ? io.loseHP(state, target, before - after, actor.id, 'true', label, {}, false) : io.heal(state, target, after - before, actor.id, label);
    if (name === 'mp' || name === 'sp') io.setResourceTotal(state, target, name, after, actor.id, label);
    else if (name === 'ap') target.ap = after;
    else if (name === 'action' || name === 'attack') target.used[name] = 1 - after;
    else if (pool?.effect) io.counter(state, target, pool.item, pool.effect, name, after);
    else (target.resources ??= {})[name] = after;
    return Math.abs(before - after);
  }
  function executeNodes(state, actor, source, nodes, inherited, ctx, entry, seen, depth, exprTarget = entry.expr.target, stopOnFailure = false) {
    let applied = false;
    for (const node of nodes) {
      if (node.enabled === false) continue;
      const p = { ...entry.expr.params, ...node };
      const recipients = node.target && node.target !== exprTarget
        ? targets(state, actor, node.target, ctx, p.radius ?? 1) : [inherited];
      for (const target of recipients) {
        if (!condition(state, actor, subject(actor, target, ctx), p.condition, ctx, entry)) continue;
        const label = node.label ?? entry.expr.label ?? entry.sourceName ?? entry.expr.id;
        const amount = nodeAmount(state, actor, target, p, ctx);
        let result;
        switch (node.kind) {
          case 'procEffect': {
            const ref = own(state.effectTemplates, p.ref) ?? io.findExpression(state, p.ref);
            if (ref) result = run(state, actor, { ...entry, expr: ref, key: `${entry.key}:${p.ref}` }, ctx, seen, depth + 1);
            break;
          }
          case 'chainEffect': result = executeNodes(state, actor, source, p.effects, target, ctx, entry, seen, depth, node.target ?? exprTarget, p.stopOnFailure); break;
          case 'changeAltitude': if (livingUnit(actor)) result = io.changeAltitude(state, actor, p); break;
          case 'modifyTerrain': case 'setTerrainKind': case 'addCover':
            result = io.terrain(state, actor, { ...node, label }, ctx);
            break;
          case 'raiseDead': result = io.raise(state, actor, target, p.statScale ?? .5); break;
          case 'spawnUnit': if (livingUnit(actor)) result = io.spawn(state, actor, p, ctx.center ?? target ?? actor); break;
          case 'summon': if (livingUnit(actor)) result = io.summon(state, actor, p.templateId, ctx.center ?? target, p.statScale ?? 1, p.count ?? 1); break;
          case 'addItem': {
            if (!livingUnit(target)) break;
            const inventory = target.inventory ??= {};
            inventory[p.itemId] = Math.min(1e9, (own(inventory, p.itemId) ?? 0) + (p.count ?? 1)); result = true; break;
          }
          default: {
            if (!livingUnit(target)) break;
            switch (node.kind) {
              case 'damage':
                if (!(p.excludeHitTarget && target === ctx.target) && amount > 0) {
                  const { type, raw, hit, ignoreArmor, preserveLife } = damagePacket(state, actor, target, p, ctx, amount);
                  result = io.damage(state, target, actor.id, raw, type, label, {
                    attacker: actor, hit, melee: ctx.melee, reaction: true,
                    direct: p.strikeBonus || !['on_damaged','on_death','on_ally_death','on_turn_start','on_turn_end'].includes(entry.expr.trigger),
                    committedRecipient: p.strikeBonus ? target : undefined, preserveLife, ignoreArmor,
                    details: { effectId: entry.expr.id, ...(p.strikeBonus ? { bonusDamage: true } : {}) },
                  }).dealt;
                }
                break;
              case 'heal': if (amount > 0) result = io.heal(state, target, amount, actor.id, label, { actionType: ctx.actionType }); break;
              case 'restoreResource': case 'produceResource': case 'drainResource':
                result = changeResource(state, actor, target, p, amount, label, entry, ctx); break;
              case 'grantStatus': result = io.grant(state, target, p.statusId, { sourceUnitId: actor.id, ...(p.turns ? { turns: Math.min(100, Math.max(1, Math.round(p.turns * (ctx.skillScale ?? 1)))) } : {}), ...(p.stacks ? { stacks: p.stacks } : {}), ...(p.amount ? { amount: p.amount } : {}), ...(p.durationType ? { durationType: p.durationType } : {}), ...(p.modifiers ? { modifiers: p.modifiers } : {}), ...(p.expireOn ? { expireOn: p.expireOn } : {}) }); break;
              case 'removeStatus': result = io.removeStatus(state, actor, target, p); break;
              case 'knockback': io.knockback(state, actor, target, p); result = true; break;
              case 'teleportBackstab': result = io.teleport(state, actor, target); break;
              case 'shield': if (amount > 0) result = io.grantShield(state, target, amount, { sourceUnitId: actor.id, turns: p.turns, stack: p.stack }); break;
              case 'execute':
                if (!ctx.nonLethal && !target.nonLethal && !io.statusModifier(target, 'preserveLife') && compare(ratio(target), p.strict ? '<' : '<=', p.threshold)
                  && (!p.requiresPool || io.resourcePool(state, actor, p.requiresPool))) {
                  result = io.loseHP(state, target, target.hp, actor.id, 'true', label, { execute: true });
                }
                break;
              case 'multiplyDamage': if (ctx.multipliers && (!p.damageType || p.damageType === ctx.damageType)) { ctx.multipliers.push({ ...p, instance: entry.instance }); result = true; } break;
              case 'modifyStat': {
                const modifiers = target.effectModifiers ??= {};
                const scale = levelScale(p.levelScaling, actor.tier ?? 1);
                const modifier = { stat: p.stat, flat: (p.flat ?? 0) * scale, percent: (p.percent ?? 0) * scale,
                  turns: p.duration ?? p.turns ?? 1, ...(p.damageType ? { damageType: p.damageType } : {}),
                  round: state.round, turn: state.turn };
                modifiers[`${source.id}:${entry.key}:${p.stat}`] = modifier;
                io.record(state, actor, 'stat_modifier', `${target.name}获得${label}的属性修正`,
                  { targetId: target.id, ...modifier });
                result = true; break;
              }
            }
          }
        }
        if ((!result && stopOnFailure) || (result === false && node.kind === 'drainResource' && p.requireFull)) return applied;
        if (typeof result === 'number') ctx.previous = result;
        applied ||= Boolean(result);
      }
    }
    return applied;
  }
  function run(state, actor, entry, ctx, seen = new Set(), depth = 0) {
    if (depth > 8 || seen.has(entry.expr.id) || !available(state, actor, entry) || !sourceApplies(entry, ctx)) return false;
    const { expr, key } = entry;
    if (![...effectNodes(expr.effects, true)].some(node => node.kind !== 'chainEffect')) return false;
    const eligible = targets(state, actor, expr.target, ctx, expr.params?.radius ?? 1)
      .filter(target => condition(state, actor, subject(actor, target, ctx), expr.condition, ctx, entry));
    if (!eligible.length) return false;
    const roll = expr.roll;
    const label = expr.label ?? entry.sourceName ?? expr.id;
    const targetId = eligible.length === 1 && livingUnit(eligible[0]) ? eligible[0].id : null;
    if (roll?.dice) {
      const die = io.die(state, 20);
      const triggered = die >= roll.gte;
      io.record(state, actor, 'proc', label, { targetId, die, dc: roll.gte, triggered });
      if (!triggered) return false;
    }
    if (roll?.chance != null && (!roll.save && !roll.contest || roll.chance < 1)) {
      const draw = io.random(state);
      const triggered = draw < roll.chance;
      io.record(state, actor, 'proc', label, { targetId, roll: draw, chance: roll.chance, triggered });
      if (!triggered) return false;
    }
    seen.add(expr.id);
    let applied = false;
    for (const target of eligible) {
      if ((roll?.save || roll?.contest) && !livingUnit(target)) continue;
      if ((roll?.save || roll?.contest) && io.saved(state, actor, target, roll, label)) continue;
      applied = executeNodes(state, actor, actor, expr.effects, target, { ...ctx }, entry, seen, depth) || applied;
    }
    seen.delete(expr.id);
    if (applied && (expr.params?.usesPerBattle != null || expr.params?.cooldown || expr.trigger === 'on_equip')) {
      const usage = actor.effectUsage ??= {};
      usage[key] = { count: (usage[key]?.count ?? 0) + 1, round: state.round };
    }
    return applied;
  }
  const dispatches = new WeakMap();
  function dispatch(state, actor, trigger, context = {}, extra = []) {
    if (!actor || (trigger !== 'on_death' && trigger !== 'on_kill' && !livingUnit(actor))) return;
    const depth = dispatches.get(state) ?? 0;
    if (depth >= 8) return;
    dispatches.set(state, depth + 1);
    try {
      const equipment = expressions(state, actor);
      for (const entry of new Map([...(trigger === 'active' ? [] : equipment), ...extra].map(entry => [entry.key, entry])).values()) {
        if (entry.expr.trigger === trigger) run(state, actor, entry, { ...context });
      }
    } finally { dispatches.set(state, depth); }
  }
  function sourceApplies(entry, ctx) {
    return entry.expr.params?.source !== 'weapon' || Boolean(entry.instance && ctx.weaponId === entry.instance.id);
  }
  function passiveNodes(state, actor, ctx, extra = []) {
    if (!actor) return [];
    return [...expressions(state, actor), ...extra].flatMap(entry => {
      const { expr } = entry;
      if (!sourceApplies(entry, ctx) || expr.trigger !== 'passive' || expr.roll || expr.target !== 'self' || !available(state, actor, entry)
        || !condition(state, actor, ctx.target ?? actor, expr.condition, ctx, entry)) return [];
      const seen = new Set([expr.id]);
      const collect = (nodes, owner = expr) => nodes.flatMap(node => {
        if (node.enabled === false || (node.target && node.target !== 'self') || !condition(state, actor, ctx.target ?? actor, node.condition, ctx, entry)) return [];
        if (node.kind === 'chainEffect') return collect(node.effects, owner);
        if (node.kind === 'procEffect') {
          const ref = own(state.effectTemplates, node.ref) ?? io.findExpression(state, node.ref);
          if (!ref || seen.has(ref.id) || seen.size >= 8 || ref.roll || ref.target !== 'self' || !condition(state, actor, ctx.target ?? actor, ref.condition, ctx, entry)) return [];
          seen.add(ref.id);
          const resolved = collect(ref.effects, ref);
          seen.delete(ref.id);
          return resolved;
        }
        return [{ ...owner.params, ...node, instance: entry.instance }];
      });
      return collect(expr.effects);
    });
  }
  function stat(state, actor, name, base, ctx = {}, temporaryOnly = false) {
    const modifiers = values(actor.effectModifiers);
    if (!temporaryOnly) modifiers.push(...passiveNodes(state, actor, ctx, ctx.entries).filter(n => n.kind === 'modifyStat'));
    let flat = 0, percent = 0;
    for (const m of modifiers) if (m.stat === name && (!m.damageType || m.damageType === ctx.damageType)) {
      const scale = levelScale(m.levelScaling, actor.tier ?? 1);
      flat += (m.flat ?? 0) * scale;
      percent += (m.percent ?? 0) * scale;
    }
    return (base + flat) * Math.max(0, 1 + percent);
  }
  function damageFactor(state, actor, ctx, event = []) {
    const factors = [...event, ...passiveNodes(state, actor, ctx, ctx.entries)].filter(n => n.kind === 'multiplyDamage' && (!n.damageType || n.damageType === ctx.damageType));
    const factorOf = n => {
      const scale = n.resourceScale;
      const count = !scale ? 0 : n.local ? io.resourcePool(state, actor, scale.resource, n.instance)?.amount ?? 0 : resource(state, actor, scale.resource);
      return (n.factor ?? 1) + (scale ? (scale.unitSize ? Math.floor(count / scale.unitSize) : count) * scale.perUnit : 0);
    };
    return factors.filter(n => !n.additive).reduce((factor, n) => factor * factorOf(n), 1)
      * Math.max(0, 1 + factors.filter(n => n.additive).reduce((sum, n) => sum + factorOf(n) - 1, 0));
  }
  const check = (state, actor, key, ctx = {}) => passiveNodes(state, actor, ctx, ctx.entries)
    .reduce((sum, n) => sum + (n.kind === 'modifyCheck' ? n[key] ?? 0 : 0), 0);
  return { dispatch, stat, check, passiveNodes, damageFactor, previewDamage, activeSkills, skillExpressions, available, condition, changeResource };
}
