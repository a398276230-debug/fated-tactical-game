// src/core/effect_schema.js
var enumOf = (...values3) => ({ enum: values3 });
var number = (minimum, maximum, type = "number") => ({ type, minimum, maximum });
var integer = (min, max) => number(min, max, "integer");
var object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var array = (items, maxItems, minItems = 1) => ({ type: "array", items, minItems, maxItems });
var union = (...oneOf) => ({ oneOf });
var ref = (name) => ({ $ref: `#/$defs/${name}` });
var string = { type: "string", minLength: 1, maxLength: 100 };
var id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" };
var fraction = number(0, 1);
var amount = number(0, 1e9);
var turns = integer(1, 100);
var damageType = enumOf("physical", "energy", "mental", "true");
var scaling = {
  perLevel: number(0, 10),
  levelScaling: union(object({ perLevel: number(0, 10) }, ["perLevel"]), object({ min: number(0, 10), max: number(0, 10) }, ["min", "max"])),
  resourceScale: object({ resource: id, perUnit: number(0, 1e6), unitSize: number(1, 1e9) }, ["resource", "perUnit"])
};
var magnitudes = { amount, percent: fraction, percentOfDamageDealt: fraction, percentOfPrevious: fraction };
var target = enumOf("self", "hitTarget", "attacker", "enemiesInRadius", "alliesInRadius", "corpse", "killedUnit");
var stats = enumOf("str", "agi", "con", "int", "spi", "accuracy", "dodge", "defense", "initiative", "armor", "armorPierce", "damageReduction", "damageReductionFlat", "damage", "healing", "skillPower");
var compare = enumOf("<", "<=", "=", ">=", ">");
var condition = (type, properties, required = Object.keys(properties)) => object({ type: { const: type }, ...properties }, ["type", ...required]);
var comparison = (type, value) => condition(type, { op: compare, value });
var tags = ["targetHasCategory", "targetCreatureType", "selfHasStatus", "targetHasStatus", "weaponType", "skillSchool", "actionType", "damageType", "hitRating", "selfHasTag", "targetHasTag"];
var bool = { type: "boolean" };
var node = (kind, properties, required = []) => object({ kind: { const: kind }, enabled: { ...bool, default: true }, label: string, target, condition: ref("condition"), radius: number(0, 15), ...properties }, ["kind", ...required]);
var resource = { resource: id, ...magnitudes, ...scaling };
var attribute = enumOf("str", "agi", "con", "int", "spi");
var events = ["on_attack", "on_hit", "on_damaged", "on_kill", "on_death", "on_turn_start", "on_turn_end", "on_skill_cast", "on_equip", "on_heal", "on_ally_death"];
var expireRule = union(
  object({ trigger: enumOf("on_damaged"), damageType: enumOf("any", "direct", "indirect"), exceptSource: enumOf("self") }, ["trigger"]),
  object({ trigger: enumOf(...events.filter((event) => event !== "on_damaged")), exceptSource: enumOf("self") }, ["trigger"])
);
var checkKeys = ["iniBonus", "dodgeBonus", "stealthBonus", "accuracyBonus", "initiativeAgility", "dodgeAgility", "coreBonus", "highGroundRange", "highGroundAccuracy", "advantage"];
var modifiers = { type: "object", additionalProperties: union(number(-1e9, 1e9), string, { type: "boolean" }) };
var effectSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fated Tactical Game effect expression",
  $ref: "#/$defs/expression",
  $defs: {
    saveDC: union(integer(1, 50), object({
      base: number(-1e9, 1e9),
      scaleBy: object({ stat: attribute, perUnit: number(-1e9, 1e9) }, ["stat", "perUnit"]),
      min: number(1, 1e9),
      max: number(1, 1e9)
    }, ["base", "scaleBy"])),
    expireOn: union(expireRule, array(expireRule, 12)),
    condition: union(
      array(ref("condition"), 12),
      ...["and", "or", "not"].map((type) => condition(type, { conditions: array(ref("condition"), type === "not" ? 1 : 12) })),
      ...["selfHp", "targetHp"].map((type) => comparison(type, fraction)),
      comparison("distance", number(0, 20)),
      comparison("targetLevel", enumOf("self")),
      ...tags.map((type) => condition(type, { value: string })),
      condition("timeOfDay", { value: enumOf("dawn", "day", "dusk", "night") }),
      ...["duel", "usesLeft", "intercepting", "melee", "arrow", "backstab", "critical", "opportunityAttack", "saved", "enemy", "reaction", "highGround"].map((type) => condition(type, { value: { type: "boolean" } }, [])),
      condition("selfStatusModifier", { key: string, value: bool }),
      condition("resourceAtLeast", { resource: id, amount })
    ),
    expression: object({
      id,
      label: string,
      trigger: enumOf("passive", ...events, "active"),
      condition: ref("condition"),
      roll: union(
        object({ dice: { const: "d20" }, gte: integer(1, 20) }, ["dice", "gte"]),
        object({ chance: fraction }, ["chance"]),
        object({ save: union(attribute, array(attribute, 5, 2)), dc: ref("saveDC"), mode: enumOf("all", "any"), chance: fraction }, ["save", "dc"]),
        object({ contest: object({ attacker: attribute, defender: attribute, dc: ref("saveDC") }, ["attacker", "defender", "dc"]), chance: fraction }, ["contest"])
      ),
      target,
      effects: array(ref("node"), 12),
      params: object({
        ...scaling,
        radius: number(0, 15),
        turns,
        stacks: integer(1, 10),
        amount,
        percent: fraction,
        usesPerBattle: union(integer(1, 1e4), { type: "null" }),
        cooldown: turns,
        ap: integer(0, 2),
        mp: integer(0, 25e3),
        sp: integer(0, 25e3),
        slot: enumOf("attack", "action"),
        range: integer(0, 15),
        source: enumOf("weapon")
      })
    }, ["id", "trigger", "target", "effects"]),
    node: union(
      node("damage", { ...magnitudes, ...scaling, lethal: { ...bool, default: true }, resourceMultiplier: id, percentOfTargetMaxHp: fraction, percentOfSelfMaxHp: fraction, percentOfPower: number(0, 10), damageType, ignoreArmor: { type: "boolean" }, excludeHitTarget: bool, flat: amount, strikeBonus: bool, inheritDamageType: bool }),
      node("heal", { ...magnitudes, ...scaling, percentOfMaxHp: fraction }),
      ...["restoreResource", "drainResource", "produceResource"].map((kind) => node(kind, { ...resource, minimumRemaining: amount, requireFull: bool, local: bool, ...kind === "produceResource" ? { cap: integer(1, 1e9), initial: integer(0, 1e9), reloadable: bool, targetTierBase: integer(1, 8) } : {}, percentPerCost: fraction }, ["resource"])),
      node("grantStatus", { statusId: id, turns, stacks: integer(1, 10), modifiers, amount, expireOn: ref("expireOn"), durationType: enumOf("battle_turns", "until_removed", "persistent") }, ["statusId"]),
      node("removeStatus", { statusId: id, category: enumOf("all_negative", "buff", "debuff", "control", "dot", "hot") }),
      node("modifyStat", { stat: stats, flat: number(-1e9, 1e9), percent: number(-1, 10), duration: turns, damageType, levelScaling: scaling.levelScaling }, ["stat"]),
      node("modifyDamageBase", { value: amount, ignoreAttributes: bool, unscaled: bool, damageType }, ["value"]),
      node("modifyCheck", Object.fromEntries(checkKeys.map((key3) => [key3, number(-30, 30)]))),
      node("forceOutcome", { mode: enumOf("hit", "crit") }, ["mode"]),
      node("upgradeHitTier", {}),
      node("knockback", { distance: integer(1, 5), collisionDamage: integer(0, 80) }),
      node("teleportBackstab", { bonusMultiplier: number(0, 4) }),
      node("shield", { ...magnitudes, ...scaling, turns, stack: bool, percentOfHealing: number(0, 4) }),
      node("summon", { templateId: id, statScale: number(0.01, 1), count: integer(1, 10) }, ["templateId"]),
      node("raiseDead", { statScale: number(0.01, 1) }),
      node("addItem", { itemId: id, count: integer(1, 1e4) }, ["itemId"]),
      node("execute", { threshold: fraction, strict: bool, requiresPool: id }, ["threshold"]),
      node("multiplyDamage", { factor: number(0, 10), damageType, additive: bool, resourceScale: scaling.resourceScale, local: bool }),
      node("chainEffect", { effects: array(ref("node"), 12), stopOnFailure: bool }, ["effects"]),
      node("procEffect", { ref: id }, ["ref"])
    )
  }
};
function matches(value, schema, depth = 0) {
  if (depth > 24) return false;
  const next = (v, s) => matches(v, s, depth + 1);
  if (schema.$ref) return next(value, effectSchema.$defs[schema.$ref.split("/").at(-1)]);
  if (schema.oneOf) return schema.oneOf.filter((s) => next(value, s)).length === 1;
  if (Object.hasOwn(schema, "const")) return value === schema.const;
  if (schema.enum) return schema.enum.includes(value);
  switch (schema.type) {
    case "object":
      return value && Object.getPrototypeOf(value) === Object.prototype && schema.required?.every((key3) => Object.hasOwn(value, key3)) !== false && Object.entries(value).every(([key3, item]) => !Object.hasOwn(Object.prototype, key3) && key3 !== "prototype" && (Object.hasOwn(schema.properties ?? {}, key3) ? next(item, schema.properties[key3]) : schema.additionalProperties && next(item, schema.additionalProperties)));
    case "array":
      return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && Array.from(value).every((item) => next(item, schema.items));
    case "string":
      return typeof value === "string" && value.trim().length >= (schema.minLength ?? 1) && value.length <= (schema.maxLength ?? 100) && (!schema.pattern || new RegExp(schema.pattern).test(value) && !Object.hasOwn(Object.prototype, value) && value !== "prototype");
    case "integer":
      if (!Number.isInteger(value)) return false;
    // fall through
    case "number":
      return Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
    case "null":
      return value === null;
    default:
      return typeof value === schema.type;
  }
}
var isExpression = (effect) => effect != null && Object.hasOwn(effect, "trigger");
var orderedDC = (dc) => (dc?.min ?? 1) <= (dc?.max ?? 50);
var validSaveDC = (dc) => matches(dc, effectSchema.$defs.saveDC) && orderedDC(dc);
var validExpireOn = (value) => matches(value, effectSchema.$defs.expireOn);
var validExpression = (effect) => matches(effect, effectSchema.$defs.expression) && orderedDC(effect.roll?.contest?.dc ?? effect.roll?.dc);
var effectNodes = function* (nodes, enabledOnly = false) {
  for (const node3 of nodes) {
    if (enabledOnly && node3.enabled === false) continue;
    yield node3;
    if (node3.kind === "chainEffect") yield* effectNodes(node3.effects, enabledOnly);
  }
};

// src/core/effects.js
var levelScale = (ls, tier) => ls?.perLevel != null ? 1 + ls.perLevel * (tier - 1) : ls ? ls.min + (ls.max - ls.min) * (tier - 1) / 6 : 1;
var livingUnit = (unit) => unit && unit.hp > 0 && !unit.fled;
var own = (table3, key3) => Object.hasOwn(table3 ?? {}, key3) ? table3[key3] : void 0;
var values = (table3) => Object.values(table3 ?? {});
function legacyId(prefix, index) {
  if (prefix.length <= 45) return `${prefix}-${index}`;
  const hash2 = Array.from(prefix).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261);
  return `${prefix.slice(0, 35)}-${(hash2 >>> 0).toString(36)}-${index}`;
}
var compare2 = (left, op, right) => ({ "<": left < right, "<=": left <= right, "=": left === right, ">=": left >= right, ">": left > right })[op];
var ratio = (unit) => unit?.hp / unit?.maxHp;
var corpses = (state) => values(state.units).filter((unit) => unit.hp <= 0 && !unit.fled && !unit.corpseConsumed);
var expression = (id3, trigger, target2, effects2, extra = {}) => ({ id: id3, trigger, target: target2, effects: effects2, ...extra });
var equippedKey = (instance, expr) => `${instance.id}:${expr.id}`;
var resourceDefinitions = (template, enabledOnly = false) => (template?.effects ?? []).filter((e) => e.trigger === "passive" && e.target === "self").flatMap((e) => [...effectNodes(e.effects, enabledOnly)].filter((n) => n.kind === "produceResource" && n.cap != null));
var initialCounters = (template) => Object.fromEntries(resourceDefinitions(template).map((n) => [n.resource, n.initial ?? 0]));
var effectLabel = (expr) => expr.label ?? `${expr.trigger} \xB7 ${expr.effects.map((n) => n.label ?? n.kind).join(" / ")}`;
function adaptLegacyEffects(effects2, context, prefix = "legacy") {
  return effects2.flatMap((e, i) => {
    if (isExpression(e) || !e || typeof e !== "object") return [e];
    const id3 = legacyId(prefix, i);
    const fields3 = (...keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(e, k)).map((k) => [k, e[k]]));
    const rule = (type, value = true) => ({ type, value });
    const source = context === "equipment" ? { params: { source: "weapon" } } : {};
    const unsaved = rule("saved", false);
    const scope = e.scope === "arrow" ? rule("arrow") : e.scope ? rule("melee", e.scope === "melee") : null;
    const passive = (nodes, extra) => expression(id3, "passive", "self", nodes, extra);
    const hit = (nodes, extra = {}) => expression(id3, "on_hit", "hitTarget", nodes, { ...source, condition: unsaved, ...extra });
    const status2 = { kind: "grantStatus", ...fields3("statusId", "turns", "stacks", "modifiers", "amount") };
    const pool = (resource3, cap, extra) => ({ kind: "produceResource", resource: resource3, cap, ...extra });
    const scoped = scope ? { condition: scope } : {};
    switch (e.kind) {
      case "status":
        return hit([{
          ...status2,
          ...e.target === "self" ? { target: "self" } : {},
          ...e.statusId === "stealth" && e.target !== "self" ? { condition: rule("enemy", false) } : {}
        }, ...e.statusId === "stealth" && e.target !== "self" ? [{ ...status2, target: "self", condition: rule("enemy") }] : []]);
      case "save_or_status":
        return hit([status2], { roll: { ...e.contest ? { contest: e.contest } : { save: e.save, dc: e.saveDC, ...fields3("mode") }, ...fields3("chance") } });
      case "fixed_attack":
        return passive([{ kind: "modifyDamageBase", ...fields3("value", "ignoreAttributes") }], source);
      case "fixed_damage":
        return passive([{ kind: "modifyDamageBase", value: e.amount, damageType: e.damageType, unscaled: true }]);
      case "bonus_damage":
        return hit([{ kind: "damage", flat: e.amount, damageType: e.damageType, strikeBonus: true, label: "\u9644\u52A0\u4F24\u5BB3" }], { params: {}, ...scope ? { condition: scope } : { condition: rule("enemy") } });
      case "check_bonus":
        return passive([{ kind: "modifyCheck", ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== "kind")) }]);
      case "guaranteed_hit":
      case "guaranteed_crit":
        return passive([{ kind: "forceOutcome", mode: e.kind === "guaranteed_hit" ? "hit" : "crit" }], scoped);
      case "hit_tier_up":
        return passive([{ kind: "upgradeHitTier" }], scoped);
      case "infinite_ammo":
        return expression(id3, "on_equip", "self", [{ kind: "grantStatus", statusId: "infinite_ammo", durationType: "until_removed" }]);
      case "on_hit_status":
        return hit([status2], { params: {}, condition: [unsaved, rule("enemy"), ...scope ? [scope] : []] });
      case "tier_growth":
        return passive((e.stat === "attributes" ? ["str", "agi", "con", "int", "spi"] : ["damage"]).map((stat2) => ({ kind: "modifyStat", stat: stat2, percent: 1, levelScaling: e.value })), e.stat === "attack" ? source : {});
      case "resource_pool":
        return passive([pool(e.counterKey, e.capacity)]);
      case "resource_scale":
        return passive([{ kind: "multiplyDamage", additive: true, resourceScale: { resource: e.resource, perUnit: e.perUnit } }]);
      case "resource_restore":
        return expression(id3, "active", "self", ["hp", "mp", "sp"].map((resource3) => ({ kind: "restoreResource", resource: resource3, percentPerCost: e.perUnit })));
      case "execute_threshold":
        return expression(id3, "active", "hitTarget", [{ kind: "chainEffect", stopOnFailure: true, effects: [
          { kind: "execute", threshold: e.threshold, strict: true, requiresPool: e.resource },
          { kind: "produceResource", target: "self", resource: e.resource, targetTierBase: e.perTier }
        ] }]);
      case "kill_charge_weapon":
        return [passive([pool(e.counterKey ?? "souls", e.maxStacks ?? 10), {
          kind: "multiplyDamage",
          local: true,
          resourceScale: { resource: e.counterKey ?? "souls", perUnit: e.bonusPerStack ?? 0.5 }
        }], source), expression(`${id3}-kill`, "on_kill", "self", [
          { kind: "produceResource", resource: e.counterKey ?? "souls", amount: 1, local: true }
        ], source)];
      case "ammo":
        return [
          passive([
            pool(e.counterKey ?? "ammo", e.capacity ?? 6, { initial: e.capacity ?? 6, reloadable: true }),
            { kind: "modifyStat", stat: "armorPierce", flat: e.armorPierce ?? 0 },
            { kind: "modifyCheck", highGroundRange: e.highGroundRange ?? 0, highGroundAccuracy: e.highGroundAccuracy ?? 0 }
          ], source),
          expression(`${id3}-spend`, "on_attack", "self", [{ kind: "drainResource", resource: e.counterKey ?? "ammo", local: true, amount: 1, requireFull: true }], {
            ...source,
            condition: { type: "not", conditions: [{ type: "selfStatusModifier", key: "infiniteAmmo", value: true }] }
          })
        ];
      case "frost_thorns": {
        const condition3 = [rule("melee"), rule("reaction", false), rule("enemy")];
        return [
          expression(id3, "on_damaged", "attacker", [{ kind: "damage", amount: e.damage ?? 3, label: "\u971C\u7EB9\u8346\u68D8" }], { condition: condition3 }),
          expression(`${id3}-status`, "on_damaged", "attacker", [{ ...status2, statusId: status2.statusId ?? "chill" }], { condition: condition3, roll: { chance: e.chance ?? 0.4 }, label: "\u971C\u7EB9\u8346\u68D8" })
        ];
      }
      case "backstab":
        return [
          passive([{ kind: "multiplyDamage", factor: 1 + (e.bonusMultiplier ?? 0.4) }, { kind: "modifyCheck", advantage: 1 }], { ...source, condition: rule("backstab") }),
          expression(
            `${id3}-hit`,
            "on_hit",
            "hitTarget",
            [
              { kind: "grantStatus", statusId: "bleed", stacks: e.bleedStacks ?? 1 },
              { kind: "damage", amount: e.comboDamage ?? 0, inheritDamageType: true, label: "\u53CC\u751F\u8840\u7259\u8FDE\u51FB" }
            ],
            { ...source, condition: { type: "or", conditions: [rule("backstab"), rule("critical")] } }
          )
        ];
      case "healing_shield":
        return [
          passive([{ kind: "modifyStat", stat: "healing", percent: e.healBonus ?? 0.25, condition: { type: "actionType", value: "skill" } }]),
          expression(`${id3}-shield`, "on_heal", "hitTarget", [{ kind: "shield", percentOfHealing: e.shieldRatio ?? 0.5, stack: true }], { condition: rule("actionType", "skill") })
        ];
      case "opportunity_root":
        return hit([{ kind: "grantStatus", statusId: "root", turns: 1 }], { condition: rule("opportunityAttack") });
      case "knockback":
        return hit([{ kind: "knockback", ...fields3("distance", "collisionDamage") }]);
      case "teleport_backstab":
        return expression(id3, "active", "hitTarget", [{ kind: "teleportBackstab", ...fields3("bonusMultiplier") }]);
      case "cleanse":
        return hit([{ kind: "removeStatus", category: "all_negative" }]);
      default:
        return [e];
    }
  });
}
function migrateStateEffects(state) {
  for (const [table3, context] of [["equipment", "equipment"], ["skills", "skill"]]) {
    for (const [id3, template] of Object.entries(state[table3] ?? {})) {
      if (Array.isArray(template?.effects) && template.effects.some((e) => !isExpression(e))) {
        template.effects = adaptLegacyEffects(template.effects, context, `legacy-${table3}-${id3}`);
      }
    }
  }
  return state;
}
function createEffectEngine(io) {
  const expressions = (state, actor) => io.equipped(state, actor).flatMap(({ template, instance }) => {
    if (template?.boundTo && template.boundTo !== actor.id) return [];
    return (template?.effects ?? []).filter(isExpression).map((expr) => ({ expr, key: equippedKey(instance, expr), instance }));
  });
  const skillExpressions = (skill2, id3) => (skill2?.effects ?? []).filter(isExpression).map((expr) => ({ expr, key: `skill-${id3}:${expr.id}` }));
  const activeId = (key3) => `effect:${key3}`;
  function activeSkills(state, actor) {
    if (!actor) return [];
    return expressions(state, actor).filter(({ expr }) => expr.trigger === "active" && [...effectNodes(expr.effects, true)].some((node3) => node3.kind !== "chainEffect")).map((entry) => {
      const { expr, key: key3 } = entry, p = expr.params ?? {};
      return [activeId(key3), {
        name: expr.label ?? expr.id,
        ap: p.ap ?? 1,
        mp: p.mp ?? 0,
        sp: p.sp ?? 0,
        slot: p.slot ?? "action",
        range: p.range ?? (expr.target === "self" ? 0 : 3),
        shape: "single",
        target: expr.target === "corpse" ? "corpse" : expr.target === "self" ? "self" : "any",
        effects: [expr],
        entry
      }];
    });
  }
  function resource3(state, unit, name) {
    if (["hp", "mp", "sp", "ap"].includes(name)) return unit[name] ?? 0;
    if (name === "action" || name === "attack") return unit.used[name] ? 0 : 1;
    return own(unit.resources, name) ?? io.resourcePool(state, unit, name)?.amount ?? 0;
  }
  function available(state, actor, { expr, key: key3 }) {
    const usage = own(actor.effectUsage, key3);
    const p = expr.params ?? {};
    return (usage?.count ?? 0) < (p.usesPerBattle ?? (expr.trigger === "on_equip" ? 1 : Infinity)) && (usage == null || state.round - usage.round >= (p.cooldown ?? 0));
  }
  function condition3(state, actor, subject2, rule, ctx, entry) {
    if (!rule) return true;
    const check2 = (child) => condition3(state, actor, subject2, child, ctx, entry);
    if (Array.isArray(rule)) return rule.every(check2);
    const { type, value, op } = rule;
    switch (type) {
      case "and":
        return rule.conditions.every(check2);
      case "or":
        return rule.conditions.some(check2);
      case "not":
        return !check2(rule.conditions[0]);
      case "selfHp":
        return compare2(ratio(actor), op, value);
      case "targetHp":
        return compare2(ratio(subject2), op, value);
      case "targetLevel":
        return !!subject2 && compare2(subject2.tier ?? 1, op, actor.tier ?? 1);
      case "targetHasCategory": {
        if (!subject2) return false;
        const categories = values(subject2.statuses).map((s) => s.category);
        const negative = categories.some((x) => ["debuff", "dot", "control"].includes(x));
        return value === "none" ? !negative : value === "negative" ? negative : categories.includes(value);
      }
      case "targetCreatureType":
        return [].concat(subject2?.creatureType ?? []).includes(value);
      case "timeOfDay":
        return state.time?.timeOfDay === value;
      case "selfHasStatus":
        return !!own(actor.statuses, value);
      case "selfStatusModifier":
        return Boolean(io.statusModifier(actor, rule.key)) === value;
      case "targetHasStatus":
        return !!own(subject2?.statuses, value);
      case "selfHasTag":
        return actor.tags?.includes(value) ?? false;
      case "targetHasTag":
        return subject2?.tags?.includes(value) ?? false;
      case "duel":
        return io.living(state).length === 2 === (value ?? true);
      case "resourceAtLeast":
        return resource3(state, actor, rule.resource) >= rule.amount;
      case "weaponType":
        return (ctx.weaponType ?? io.weaponType(state, actor)) === value;
      case "skillSchool":
        return ctx.school === value;
      case "actionType":
        return ctx.actionType === value;
      case "damageType":
        return ctx.damageType === value;
      case "hitRating":
        return ctx.hitRating === value;
      case "enemy":
        return Boolean(subject2 && subject2.team !== actor.team) === (value ?? true);
      case "intercepting":
      case "melee":
      case "arrow":
      case "backstab":
      case "critical":
      case "opportunityAttack":
      case "saved":
      case "reaction":
      case "highGround":
        return Boolean(ctx[type]) === (value ?? true);
      case "distance":
        return !!subject2 && compare2(io.distance(state, actor, subject2), op, value);
      case "usesLeft":
        return available(state, actor, entry) === (value ?? true);
      default:
        return false;
    }
  }
  function targets(state, actor, name, ctx, radius) {
    const center = ctx.center ?? actor;
    switch (name) {
      case "self":
        return [actor];
      case "hitTarget":
        return ctx.target ? [ctx.target] : [];
      case "attacker":
        return ctx.attacker ? [ctx.attacker] : [];
      case "killedUnit":
        return ctx.killed ? [ctx.killed] : [];
      case "corpse":
        return corpses(state).filter((u) => ctx.center ? u.x === center.x && u.y === center.y : io.distance(state, actor, u) <= radius).slice(0, 1);
      default:
        return io.living(state).filter((u) => u.team === actor.team === (name === "alliesInRadius") && (ctx.skillArea ? ctx.skillArea.has(u.id) : io.distance(state, center, u) <= radius));
    }
  }
  const subject = (actor, target2, ctx) => target2 === actor ? ctx.target ?? actor : target2;
  function magnitude(state, actor, target2, p, ctx) {
    const tier = actor.tier ?? 1;
    const ls = p.levelScaling;
    const level = levelScale(ls, tier);
    const rs = p.resourceScale;
    const units = rs ? resource3(state, actor, rs.resource) / (rs.unitSize ?? 1) : 0;
    const scaled = (p.amount ?? 0) * level + (p.perLevel ?? 0) * tier + (rs ? (rs.unitSize ? Math.floor(units) : units) * rs.perUnit : 0);
    return scaled + (p.flat ?? 0) + (p.percentOfHealing ?? 0) * (ctx.healing ?? 0) + (p.targetTierBase ? p.targetTierBase ** ((ctx.target?.tier ?? 1) - 1) : 0) + (p.percentOfDamageDealt ?? 0) * (ctx.dealt ?? 0) + (p.percentOfPrevious ?? 0) * (ctx.previous ?? 0) + (p.percentOfSelfMaxHp ?? 0) * actor.maxHp + (p.percentOfTargetMaxHp ?? p.percentOfMaxHp ?? 0) * target2.maxHp + (p.percentOfPower ?? 0) * (ctx.power ?? 0);
  }
  function changeResource(state, actor, target2, node3, amount2, label, entry, ctx) {
    const name = node3.resource, drain = node3.kind === "drainResource";
    if (node3.kind === "restoreResource" && io.blockRestore(target2)) return false;
    const pool = io.resourcePool(state, target2, name, node3.local ? entry?.instance : void 0);
    if (node3.local && !pool) return false;
    const before = pool?.amount ?? resource3(state, target2, name);
    const cap = { hp: target2.maxHp, mp: target2.maxMp, sp: target2.maxSp, ap: 2, action: 1, attack: 1 }[name] ?? pool?.effect.cap ?? node3.cap ?? 1e9;
    amount2 = Math.floor(amount2 + ((node3.percent ?? 0) + (node3.percentPerCost ?? 0) * (ctx?.resourceCost ?? 0)) * (drain ? before : cap));
    if (drain && node3.requireFull && before - (node3.minimumRemaining ?? 0) < amount2) return false;
    const after = drain ? before - Math.min(amount2, Math.max(0, before - (node3.minimumRemaining ?? 0))) : Math.min(cap, before + amount2);
    if (after === before) return 0;
    if (name === "hp") return drain ? io.loseHP(state, target2, before - after, actor.id, "true", label, {}, false) : io.heal(state, target2, after - before, actor.id, label);
    if (["mp", "sp", "ap"].includes(name)) target2[name] = after;
    else if (name === "action" || name === "attack") target2.used[name] = 1 - after;
    else if (pool?.effect) io.counter(state, target2, pool.item, pool.effect, name, after);
    else (target2.resources ??= {})[name] = after;
    return Math.abs(before - after);
  }
  function executeNodes(state, actor, source, nodes, inherited, ctx, entry, seen, depth, exprTarget = entry.expr.target, stopOnFailure = false) {
    let applied = false;
    for (const node3 of nodes) {
      if (node3.enabled === false) continue;
      const p = { ...entry.expr.params, ...node3 };
      const recipients = node3.target && node3.target !== exprTarget ? targets(state, actor, node3.target, ctx, p.radius ?? 1) : [inherited];
      for (const target2 of recipients) {
        if (!condition3(state, actor, subject(actor, target2, ctx), p.condition, ctx, entry)) continue;
        const label = node3.label ?? entry.expr.label ?? entry.expr.id;
        const amount2 = Math.max(0, Math.min(1e9, Math.floor((magnitude(state, actor, target2, p, ctx) + (["heal", "shield", "damage"].includes(node3.kind) ? (p.percent ?? 0) * target2.maxHp : 0)) * (ctx.skillScale ?? 1))));
        let result;
        switch (node3.kind) {
          case "procEffect": {
            const ref2 = own(state.effectTemplates, p.ref) ?? io.findExpression(state, p.ref);
            if (ref2) result = run(state, actor, { ...entry, expr: ref2, key: `${entry.key}:${p.ref}` }, ctx, seen, depth + 1);
            break;
          }
          case "chainEffect":
            result = executeNodes(state, actor, source, p.effects, target2, ctx, entry, seen, depth, node3.target ?? exprTarget, p.stopOnFailure);
            break;
          case "raiseDead":
            result = io.raise(state, actor, target2, p.statScale ?? 0.5);
            break;
          case "summon":
            if (livingUnit(actor)) result = io.summon(state, actor, p.templateId, ctx.center ?? target2, p.statScale ?? 1, p.count ?? 1);
            break;
          case "addItem": {
            if (!livingUnit(target2)) break;
            const inventory = target2.inventory ??= {};
            inventory[p.itemId] = Math.min(1e9, (own(inventory, p.itemId) ?? 0) + (p.count ?? 1));
            result = true;
            break;
          }
          default: {
            if (!livingUnit(target2)) break;
            switch (node3.kind) {
              case "damage":
                if (!(p.excludeHitTarget && target2 === ctx.target) && amount2 > 0) {
                  const type = (p.inheritDamageType ? ctx.damageType : p.damageType) ?? "true";
                  const raw = amount2 * (p.resourceMultiplier ? resource3(state, actor, p.resourceMultiplier) : 1) * (p.strikeBonus ? 1 : ctx.damageFactor?.(type) ?? damageFactor(state, actor, { ...ctx, target: target2, damageType: type }));
                  result = io.damage(state, target2, actor.id, raw, type, label, {
                    attacker: actor,
                    hit: p.strikeBonus,
                    melee: ctx.melee,
                    reaction: true,
                    direct: p.strikeBonus || !["on_damaged", "on_death", "on_ally_death", "on_turn_start", "on_turn_end"].includes(entry.expr.trigger),
                    committedRecipient: p.strikeBonus ? target2 : void 0,
                    preserveLife: p.lethal === false || ctx.nonLethal,
                    ignoreArmor: p.ignoreArmor,
                    details: { effectId: entry.expr.id, ...p.strikeBonus ? { bonusDamage: true } : {} }
                  }).dealt;
                }
                break;
              case "heal":
                if (amount2 > 0) result = io.heal(state, target2, amount2, actor.id, label, { actionType: ctx.actionType });
                break;
              case "restoreResource":
              case "produceResource":
              case "drainResource":
                result = changeResource(state, actor, target2, p, amount2, label, entry, ctx);
                break;
              case "grantStatus":
                result = io.grant(state, target2, p.statusId, { sourceUnitId: actor.id, ...p.turns ? { turns: Math.min(100, Math.max(1, Math.round(p.turns * (ctx.skillScale ?? 1)))) } : {}, ...p.stacks ? { stacks: p.stacks } : {}, ...p.amount ? { amount: p.amount } : {}, ...p.durationType ? { durationType: p.durationType } : {}, ...p.modifiers ? { modifiers: p.modifiers } : {}, ...p.expireOn ? { expireOn: p.expireOn } : {} });
                break;
              case "removeStatus":
                result = io.removeStatus(state, actor, target2, p);
                break;
              case "knockback":
                io.knockback(state, actor, target2, p);
                result = true;
                break;
              case "teleportBackstab":
                result = io.teleport(state, actor, target2);
                break;
              case "shield":
                if (amount2 > 0) result = io.grant(state, target2, "shield", { sourceUnitId: actor.id, turns: p.turns, amount: amount2 + (p.stack ? target2.statuses.shield?.amount ?? 0 : 0) });
                break;
              case "execute":
                if (!ctx.nonLethal && !target2.nonLethal && !io.statusModifier(target2, "preserveLife") && compare2(ratio(target2), p.strict ? "<" : "<=", p.threshold) && (!p.requiresPool || io.resourcePool(state, actor, p.requiresPool))) {
                  result = io.loseHP(state, target2, target2.hp, actor.id, "true", label, { execute: true });
                }
                break;
              case "multiplyDamage":
                if (ctx.multipliers && (!p.damageType || p.damageType === ctx.damageType)) {
                  ctx.multipliers.push({ ...p, instance: entry.instance });
                  result = true;
                }
                break;
              case "modifyStat": {
                const modifiers2 = target2.effectModifiers ??= {};
                modifiers2[`${source.id}:${entry.key}:${p.stat}`] = {
                  stat: p.stat,
                  flat: (p.flat ?? 0) * levelScale(p.levelScaling, actor.tier ?? 1),
                  percent: (p.percent ?? 0) * levelScale(p.levelScaling, actor.tier ?? 1),
                  turns: p.duration ?? p.turns ?? 1,
                  ...p.damageType ? { damageType: p.damageType } : {},
                  round: state.round,
                  turn: state.turn
                };
                result = true;
                break;
              }
            }
          }
        }
        if (!result && stopOnFailure || result === false && node3.kind === "drainResource" && p.requireFull) return applied;
        if (typeof result === "number") ctx.previous = result;
        applied ||= Boolean(result);
      }
    }
    return applied;
  }
  function run(state, actor, entry, ctx, seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (depth > 8 || seen.has(entry.expr.id) || !available(state, actor, entry) || !sourceApplies(entry, ctx)) return false;
    const { expr, key: key3 } = entry;
    if (![...effectNodes(expr.effects, true)].some((node3) => node3.kind !== "chainEffect")) return false;
    const eligible = targets(state, actor, expr.target, ctx, expr.params?.radius ?? 1).filter((target2) => condition3(state, actor, subject(actor, target2, ctx), expr.condition, ctx, entry));
    if (!eligible.length) return false;
    const roll = expr.roll;
    if (roll?.dice && io.die(state, 20) < roll.gte) return false;
    if (roll?.chance != null && (!roll.save && !roll.contest || roll.chance < 1)) {
      const draw = io.random(state);
      io.record(state, actor, "proc", expr.label ?? expr.id, { targetId: eligible[0].id, roll: draw, chance: roll.chance, triggered: draw < roll.chance });
      if (draw >= roll.chance) return false;
    }
    seen.add(expr.id);
    let applied = false;
    for (const target2 of eligible) {
      if ((roll?.save || roll?.contest) && !livingUnit(target2)) continue;
      if ((roll?.save || roll?.contest) && io.saved(state, actor, target2, roll)) continue;
      applied = executeNodes(state, actor, actor, expr.effects, target2, { ...ctx }, entry, seen, depth) || applied;
    }
    seen.delete(expr.id);
    if (applied && (expr.params?.usesPerBattle != null || expr.params?.cooldown || expr.trigger === "on_equip")) {
      const usage = actor.effectUsage ??= {};
      usage[key3] = { count: (usage[key3]?.count ?? 0) + 1, round: state.round };
    }
    return applied;
  }
  const dispatches = /* @__PURE__ */ new WeakMap();
  function dispatch(state, actor, trigger, context = {}, extra = []) {
    if (!actor || trigger !== "on_death" && trigger !== "on_kill" && !livingUnit(actor)) return;
    const depth = dispatches.get(state) ?? 0;
    if (depth >= 8) return;
    dispatches.set(state, depth + 1);
    try {
      const equipment = expressions(state, actor);
      for (const entry of new Map([...trigger === "active" ? [] : equipment, ...extra].map((entry2) => [entry2.key, entry2])).values()) {
        if (entry.expr.trigger === trigger) run(state, actor, entry, { ...context });
      }
    } finally {
      dispatches.set(state, depth);
    }
  }
  function sourceApplies(entry, ctx) {
    return entry.expr.params?.source !== "weapon" || Boolean(entry.instance && ctx.weaponId === entry.instance.id);
  }
  function passiveNodes(state, actor, ctx, extra = []) {
    if (!actor) return [];
    return [...expressions(state, actor), ...extra].flatMap((entry) => {
      const { expr } = entry;
      if (!sourceApplies(entry, ctx) || expr.trigger !== "passive" || expr.roll || expr.target !== "self" || !available(state, actor, entry) || !condition3(state, actor, ctx.target ?? actor, expr.condition, ctx, entry)) return [];
      const seen = /* @__PURE__ */ new Set([expr.id]);
      const collect = (nodes, owner = expr) => nodes.flatMap((node3) => {
        if (node3.enabled === false || node3.target && node3.target !== "self" || !condition3(state, actor, ctx.target ?? actor, node3.condition, ctx, entry)) return [];
        if (node3.kind === "chainEffect") return collect(node3.effects, owner);
        if (node3.kind === "procEffect") {
          const ref2 = own(state.effectTemplates, node3.ref) ?? io.findExpression(state, node3.ref);
          if (!ref2 || seen.has(ref2.id) || seen.size >= 8 || ref2.roll || ref2.target !== "self" || !condition3(state, actor, ctx.target ?? actor, ref2.condition, ctx, entry)) return [];
          seen.add(ref2.id);
          const resolved = collect(ref2.effects, ref2);
          seen.delete(ref2.id);
          return resolved;
        }
        return [{ ...owner.params, ...node3, instance: entry.instance }];
      });
      return collect(expr.effects);
    });
  }
  function stat2(state, actor, name, base, ctx = {}, temporaryOnly = false) {
    const modifiers2 = values(actor.effectModifiers);
    if (!temporaryOnly) modifiers2.push(...passiveNodes(state, actor, ctx, ctx.entries).filter((n) => n.kind === "modifyStat"));
    let flat = 0, percent = 0;
    for (const m of modifiers2) if (m.stat === name && (!m.damageType || m.damageType === ctx.damageType)) {
      const scale = levelScale(m.levelScaling, actor.tier ?? 1);
      flat += (m.flat ?? 0) * scale;
      percent += (m.percent ?? 0) * scale;
    }
    return (base + flat) * Math.max(0, 1 + percent);
  }
  function damageFactor(state, actor, ctx, event = []) {
    const factors = [...event, ...passiveNodes(state, actor, ctx, ctx.entries)].filter((n) => n.kind === "multiplyDamage" && (!n.damageType || n.damageType === ctx.damageType));
    const factorOf = (n) => {
      const scale = n.resourceScale;
      const count = !scale ? 0 : n.local ? io.resourcePool(state, actor, scale.resource, n.instance)?.amount ?? 0 : resource3(state, actor, scale.resource);
      return (n.factor ?? 1) + (scale ? (scale.unitSize ? Math.floor(count / scale.unitSize) : count) * scale.perUnit : 0);
    };
    return factors.filter((n) => !n.additive).reduce((factor, n) => factor * factorOf(n), 1) * Math.max(0, 1 + factors.filter((n) => n.additive).reduce((sum, n) => sum + factorOf(n) - 1, 0));
  }
  const check = (state, actor, key3, ctx = {}) => passiveNodes(state, actor, ctx, ctx.entries).reduce((sum, n) => sum + (n.kind === "modifyCheck" ? n[key3] ?? 0 : 0), 0);
  return { dispatch, stat: stat2, check, passiveNodes, damageFactor, activeSkills, skillExpressions, available, condition: condition3, changeResource };
}

// src/core/spatial.js
var EPSILON = 1e-9;
var CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
var DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
var NEIGHBORS = [...CARDINAL, ...DIAGONAL];
var key = ({ x, y }) => `${x},${y}`;
var same = (a, b) => a.x === b.x && a.y === b.y;
var byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
var table = (collection) => Object.values(collection ?? {});
function cellAt(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return void 0;
  return state.grid[y]?.[x];
}
var elevation = (state, at) => cellAt(state, at.x, at.y)?.z ?? 0;
var isGround = (state, at) => {
  const cell = cellAt(state, at.x, at.y);
  return Boolean(cell && cell.kind !== "wall");
};
var unitAt = (state, x, y, exceptId) => table(state.units).filter((unit) => unit.hp > 0 && unit.x === x && unit.y === y && unit.id !== exceptId).sort(byId)[0];
var coverAt = (state, x, y) => table(state.covers).filter((cover) => cover.hp > 0 && cover.x === x && cover.y === y).sort(byId)[0];
var gridDistance = (a, b) => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
var distance3D = (state, a, b) => Math.hypot(b.x - a.x, b.y - a.y, elevation(state, b) - elevation(state, a));
function passableEdge(state, from, to) {
  if (!isGround(state, from) || !isGround(state, to)) return false;
  const slope = cellAt(state, from.x, from.y).kind === "slope" || cellAt(state, to.x, to.y).kind === "slope";
  return Math.abs(elevation(state, from) - elevation(state, to)) <= (slope ? 2 : 1);
}
function canStep(state, from, to, { ignoreUnitId = from.id, diagonal = true } = {}) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (gridDistance(from, to) !== 1 || !passableEdge(state, from, to)) return false;
  const vacant = (at) => !unitAt(state, at.x, at.y, ignoreUnitId) && !coverAt(state, at.x, at.y);
  if (!vacant(to)) return false;
  if (!dx || !dy) return true;
  return diagonal && [{ x: from.x, y: to.y }, { x: to.x, y: from.y }].every((at) => vacant(at) && passableEdge(state, from, at) && passableEdge(state, at, to));
}
function search(state, unit, limit, options, target2) {
  if (!isGround(state, unit) || !(limit >= 0)) return [];
  const start = { x: unit.x, y: unit.y, z: elevation(state, unit), cost: 0, previous: null };
  const visited = /* @__PURE__ */ new Set([key(start)]), queue = [start];
  const stepOptions = { ignoreUnitId: unit.id, ...options };
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    if (target2 && same(from, target2)) return [from];
    if (from.cost + 1 > limit) continue;
    for (const [dx, dy] of stepOptions.diagonal === false ? CARDINAL : NEIGHBORS) {
      const to = { x: from.x + dx, y: from.y + dy };
      const id3 = key(to);
      if (visited.has(id3) || !canStep(state, from, to, stepOptions) || options?.allowsStep && !options.allowsStep(from, to)) continue;
      visited.add(id3);
      queue.push({ ...to, z: elevation(state, to), cost: from.cost + 1, previous: from });
    }
  }
  return target2 ? [] : queue.slice(1);
}
var coords = ({ x, y, z }) => ({ x, y, z });
function unwind(last) {
  const path = [];
  for (let step = last; step.previous; step = step.previous) path.push(coords(step));
  return path.reverse();
}
function movementOptions(state, unit, maxSteps = Infinity, options) {
  return search(state, unit, maxSteps, options).map((cell) => ({ ...coords(cell), cost: cell.cost, path: unwind(cell) }));
}
function supercoverLine(from, to) {
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) return [];
  let { x, y } = from;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  const sx = Math.sign(to.x - x), sy = Math.sign(to.y - y);
  const cells = [{ x, y }];
  for (let ix = 0, iy = 0; ix < dx || iy < dy; ) {
    const nextX = (2 * ix + 1) * dy, nextY = (2 * iy + 1) * dx;
    if (nextX === nextY) {
      cells.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (nextX < nextY) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    cells.push({ x, y });
  }
  return cells;
}
function hasLOS(state, from, to) {
  if (!isGround(state, from) || !isGround(state, to)) return false;
  return supercoverLine(from, to).every((at) => isGround(state, at));
}
function aoeCells(state, origin, target2, options = {}) {
  const {
    shape: shape2 = "single",
    radius = 1.5,
    width = 0.6,
    angle = shape2 === "fan" ? 100 : 60,
    range = distance3D(state, origin, target2)
  } = options;
  const limitAt = typeof range === "function" ? range : () => range;
  const inRange = (at) => distance3D(state, origin, at) <= limitAt(at) + EPSILON;
  if (!hasLOS(state, origin, target2) || !inRange(target2)) return [];
  if (shape2 === "single") return [{ x: target2.x, y: target2.y, z: elevation(state, target2) }];
  const dx = target2.x - origin.x, dy = target2.y - origin.y, aimLength = Math.hypot(dx, dy);
  if (shape2 !== "circle" && (!aimLength || !["line", "fan", "cone"].includes(shape2))) return [];
  const minCosine = Math.cos(Math.max(0, Math.min(360, angle)) * Math.PI / 360);
  const result = [];
  state.grid.forEach((row, y) => row.forEach((cell, x) => {
    const at = { x, y, z: cell.z };
    if (shape2 === "circle") {
      if (distance3D(state, target2, at) <= radius + EPSILON && hasLOS(state, target2, at)) result.push(at);
      return;
    }
    if (same(origin, at) || !inRange(at)) return;
    const vx = x - origin.x, vy = y - origin.y;
    const forward = (vx * dx + vy * dy) / aimLength;
    const inside = shape2 === "line" ? forward > 0 && Math.abs(vx * dy - vy * dx) / aimLength <= width + EPSILON : forward / Math.hypot(vx, vy) >= minCosine - EPSILON;
    if (inside && hasLOS(state, origin, at)) result.push(at);
  }));
  return result;
}
function coverBetween(state, from, to) {
  if (same(from, to) || !hasLOS(state, from, to)) return null;
  const ray = new Set(supercoverLine(from, to).slice(1, -1).map(key));
  const targetZ = elevation(state, to), sourceZ = elevation(state, from);
  const dx = from.x - to.x, dy = from.y - to.y, squaredLength = dx * dx + dy * dy;
  const covers = table(state.covers).filter((cover) => {
    if (cover.hp <= 0 || !(cover.cover > 0) || same(cover, from) || same(cover, to) || !isGround(state, cover)) return false;
    const cx = cover.x - to.x, cy = cover.y - to.y;
    const fraction2 = (cx * dx + cy * dy) / squaredLength;
    if (fraction2 <= 0 || fraction2 >= 1) return false;
    const z = elevation(state, cover);
    if (sourceZ - z >= 2 || targetZ - z >= 2 || targetZ + (sourceZ - targetZ) * fraction2 - z >= 2) return false;
    const adjacentIncoming = gridDistance(cover, to) === 1 && (!cx || Math.sign(cx) === Math.sign(dx)) && (!cy || Math.sign(cy) === Math.sign(dy));
    return ray.has(key(cover)) || adjacentIncoming && hasLOS(state, cover, to);
  });
  return covers.sort((a, b) => b.cover - a.cover || distance3D(state, a, to) - distance3D(state, b, to) || byId(a, b))[0] ?? null;
}
function facingToward(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return [dx === 0 ? 0 : Math.sign(dx), dy === 0 ? 0 : Math.sign(dy)];
}
function facingArc(defender, attacker) {
  const [fx, fy] = defender.facing ?? [1, 0];
  const dx = attacker.x - defender.x, dy = attacker.y - defender.y;
  const length = Math.hypot(dx, dy) * Math.hypot(fx, fy);
  if (!length) return "front";
  const cosine = (dx * fx + dy * fy) / length;
  return cosine < -0.5 ? "back" : cosine < 0.5 ? "side" : "front";
}
function isFlanked(state, attacker, defender) {
  const adjacent = (unit) => !same(unit, defender) && gridDistance(unit, defender) === 1 && Math.abs(elevation(state, unit) - elevation(state, defender)) <= 1 && hasLOS(state, unit, defender);
  if (!adjacent(attacker)) return false;
  const dx = attacker.x - defender.x, dy = attacker.y - defender.y;
  return table(state.units).some((ally) => ally.hp > 0 && ally.id !== attacker.id && ally.team === attacker.team && adjacent(ally) && dx * (ally.x - defender.x) + dy * (ally.y - defender.y) < 0);
}

// src/core/rng.js
var UINT32_SIZE = 4294967296;
function advance(rng) {
  return Math.imul(rng, 1664525) + 1013904223 >>> 0;
}
function nextRng(rng) {
  rng = advance(rng);
  return { rng, value: rng / UINT32_SIZE };
}
function rollDie(rng, sides) {
  if (!Number.isInteger(sides) || sides < 1 || sides > UINT32_SIZE) throw new RangeError("Invalid die size");
  const bucket = Math.floor(UINT32_SIZE / sides);
  const boundary = bucket * sides;
  do {
    rng = advance(rng);
  } while (rng >= boundary);
  return { rng, value: Math.floor(rng / bucket) + 1 };
}
function rollDice(rng, count, sides) {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid dice count");
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
var edge = (advantage, disadvantage) => Math.sign(Number(advantage) - Number(disadvantage));
function rollD20(rng, advantage = 0, disadvantage = 0) {
  const sign = edge(advantage, disadvantage);
  const result = rollDice(rng, sign ? 2 : 1, 20);
  const { rolls } = result;
  return {
    rng: result.rng,
    rolls,
    value: sign > 0 ? Math.max(...rolls) : sign < 0 ? Math.min(...rolls) : rolls[0],
    mode: sign > 0 ? "advantage" : sign < 0 ? "disadvantage" : "normal"
  };
}
function rollProtocolD20(rng, { bonus = 0, penalty = 0, tierAdvantage = 0 } = {}) {
  const b = Math.max(0, Math.min(2, bonus)), p = Math.max(0, Math.min(1, penalty));
  const sign = b > p ? 1 : p > b ? -1 : 0;
  const count = sign === 0 ? 1 : b === 2 && sign > 0 || tierAdvantage && sign < 0 ? 3 : 2;
  const result = rollDice(rng, count, 20);
  const sorted = [...result.rolls].sort((a, z) => a - z);
  const value = count === 3 ? sorted[1] : sign > 0 ? Math.max(...result.rolls) : sign < 0 ? Math.min(...result.rolls) : result.rolls[0];
  return { rng: result.rng, rolls: result.rolls, value, mode: count === 3 ? "middle" : sign > 0 ? "bonus" : sign < 0 ? "penalty" : "normal" };
}
function probability(successes, advantage, disadvantage) {
  const sign = edge(advantage, disadvantage);
  if (sign > 0) return (400 - (20 - successes) ** 2) / 400;
  if (sign < 0) return successes ** 2 / 400;
  return successes / 20;
}
function hitChance(target2, modifier = 0, advantage = 0, disadvantage = 0) {
  const needed = Math.ceil(target2 - modifier);
  return probability(Math.max(1, Math.min(19, 21 - needed)), advantage, disadvantage);
}
function critChance(advantage = 0, disadvantage = 0) {
  return probability(1, advantage, disadvantage);
}
function saveChance(target2, modifier = 0, advantage = 0, disadvantage = 0) {
  const needed = Math.ceil(target2 - modifier);
  return probability(Math.max(0, Math.min(20, 21 - needed)), advantage, disadvantage);
}

// src/core/combat_protocol.js
var BL_SIZE_TABLE = Object.freeze([
  { id: "tiny", name: "\u5FAE\u578B", max: 0.6, value: 2, martial: -8, melee: 0.7 },
  { id: "small", name: "\u5C0F\u578B", max: 1.3, value: 1, martial: -4, melee: 0.85 },
  { id: "medium", name: "\u4E2D\u578B", max: 2.6, value: 0, martial: 0, melee: 1 },
  { id: "large", name: "\u5927\u578B", max: 5.5, value: -1, martial: 4, melee: 1.2 },
  { id: "huge", name: "\u5DE8\u578B", max: 10, value: -2, martial: 8, melee: 1.4 },
  { id: "gargantuan", name: "\u8D85\u5DE8\u578B", max: Infinity, value: -4, martial: 12, melee: 1 }
]);
var RATING_TABLE = Object.freeze([
  { min: 30, name: "\u8D85\u66B4\u51FB", multiplier: 2 },
  { min: 25, name: "\u5F3A\u66B4\u51FB", multiplier: 1.6 },
  { min: 20, name: "\u5E73\u66B4\u51FB", multiplier: 1.3 },
  { min: 11, name: "\u6709\u6548", multiplier: 1 },
  { min: 8, name: "\u52C9\u5F3A", multiplier: 0.8 },
  { min: 4, name: "\u64E6\u4F24", multiplier: 0.3 },
  { min: null, name: "\u5931\u624B", multiplier: 0 }
]);
var DISTANCE_TABLE = Object.freeze([
  { name: "\u8D34\u8EAB", min: 0, max: 0, hit: 4, range: 6 },
  { name: "\u8FD1\u7A0B", min: 1, max: 2, hit: 0, range: 2 },
  { name: "\u4E2D\u7A0B", min: 3, max: 5, hit: -2, range: 0 },
  { name: "\u8FDC\u7A0B", min: 6, max: 10, hit: -4, range: 0 },
  { name: "\u8D85\u8DDD", min: 11, max: null, hit: -6, range: 0 }
]);
var INTENTS = Object.freeze({
  normal: { name: "\u5E38\u89C4", difficulty: 0, multiplier: 1 },
  function: { name: "\u673A\u80FD\u9650\u5236", difficulty: 5, multiplier: 1.1 },
  core: { name: "\u6838\u5FC3\u8981\u5BB3", difficulty: 10, multiplier: 1.4 },
  kill: { name: "\u62B9\u6740", difficulty: 15, multiplier: 1.7 },
  concept: { name: "\u6982\u5FF5\u7834\u788E", difficulty: 20, multiplier: 2 }
});
var MORALE = Object.freeze({
  spar: { threshold: 0.4, check: false },
  arena: { threshold: 0.3, check: false },
  suppress: { threshold: 0.5, check: false },
  deathmatch: { threshold: 0.1, check: true },
  standard: { threshold: 0.3, check: true },
  guard: { threshold: 0.35, check: true }
});
var stanceFor = (slots = {}) => {
  const main = slots.mainHand ?? slots.weapon ?? null, off = slots.offHand ?? null, shield = slots.shield ?? null;
  if (shield) return "sword_shield";
  if (off?.kind === "consumable" || off?.kind === "auxiliary") return "attunement";
  if (main?.heavy || main?.twoHanded) return "greatsword";
  if (off) return "dual_wield";
  if (main?.ranged || main?.kind === "ranged") return "light_blade";
  return main ? "light_blade" : "unarmed";
};
var stanceLabel = Object.freeze({ light_blade: "\u8F7B\u5251", dual_wield: "\u53CC\u6301", attunement: "\u540C\u8C03", greatsword: "\u91CD\u5251", sword_shield: "\u5251\u76FE", unarmed: "\u65E0\u68B0" });
var STANCE_RULES = Object.freeze({
  light_blade: Object.freeze({ armorPenetration: 0.08, closeRange: true, rangedDistancePenalty: 0 }),
  dual_wield: Object.freeze({ offHandDamage: 0.5, comboOffHandDamage: 0.75, followUp: true }),
  attunement: Object.freeze({ itemCharges: 2 }),
  greatsword: Object.freeze({ offensiveDamage: 1.3, defensiveDamage: 1.5, armorPenetration: 0.05, parryQuota: 2, parryReduction: 0.6, perfectParryReduction: 1 }),
  sword_shield: Object.freeze({ blockReduction: 0.25, heavyBlockReduction: 0.45, shieldDamageFactor: 0.3 }),
  unarmed: Object.freeze({})
});
function stanceRules(stance) {
  return STANCE_RULES[stance] ?? STANCE_RULES.unarmed;
}
function sizeFor(bodyLengthM) {
  return BL_SIZE_TABLE.find((x) => Number.isFinite(bodyLengthM) && bodyLengthM < x.max) ?? BL_SIZE_TABLE[2];
}
function sizeForUnit(unit = {}) {
  return unit.bodyLengthM == null ? BL_SIZE_TABLE.find((x) => x.id === unit.sizeId) ?? BL_SIZE_TABLE[2] : sizeFor(unit.bodyLengthM);
}
function distanceTier(distance) {
  return DISTANCE_TABLE.find((x) => distance >= x.min && distance <= x.max) ?? DISTANCE_TABLE.at(-1);
}
function ratingFor(total) {
  return RATING_TABLE.find((x) => x.min === null || total >= x.min);
}
function initiative({ agility = 0, percent = 0, d20 = 0, attack = [], action = [], flat = 0 } = {}) {
  return agility * (1 + percent) + d20 + Math.max(0, ...attack, 0) + Math.max(0, ...action, 0) + flat;
}
function sizeHitModifier(attacker, defender) {
  const a = sizeForUnit(attacker), d = sizeForUnit(defender);
  return (defender.mc ?? 1) >= 2 ? a.value + 2 * ((defender.mc ?? 1) - 1) : a.value - d.value;
}
function meleeMultiplier(unit = {}) {
  const s = sizeForUnit(unit);
  return (unit.mc ?? 1) >= 2 ? 1 : s.melee;
}
function intentCheck(intent = "normal", attackerTier = 1, defenderTier = 1, attackerD20 = 10, defenderD20 = 10, ratingBonus = 0) {
  const spec = typeof intent === "string" ? INTENTS[intent] ?? INTENTS.normal : intent;
  if (!spec.difficulty) return { required: false, success: true, ...spec };
  if (attackerTier < defenderTier - 1) return { required: true, success: false, forced: true, ...spec };
  return { required: true, success: attackerTier * 5 + attackerD20 + ratingBonus >= defenderTier * 5 + defenderD20 + spec.difficulty, ...spec };
}
function moraleResult({ type = "standard", hp, maxHp, d20 = 20 } = {}) {
  const rule = MORALE[type] ?? MORALE.standard;
  const triggered = hp / maxHp < rule.threshold;
  return { threshold: rule.threshold, triggered, check: rule.check, roll: rule.check ? d20 : null, shaken: triggered && (!rule.check || d20 < 12) };
}

// src/core/status_modifiers.js
var damageTypes = Object.freeze(["physical", "energy", "mental", "true"]);
var ranges = {
  damage: [1, 1e5],
  heal: [1, 1e5],
  amount: [1, 1e5],
  reflect: [1, 1e5],
  armor: [1, 1e5],
  movement: [-3, 3],
  accuracy: [-10, 10],
  incomingAccuracy: [-10, 10],
  advantage: [1, 3],
  disadvantage: [1, 3],
  intentDifficulty: [-10, 10],
  reduction: [0, 1],
  vulnerability: [0, 1],
  shatter: [0, 1],
  damageBonus: [0, 1]
};
Object.assign(ranges, { dodgeBonus: [-30, 30], attackPercent: [-1, 4], attributePercent: [-1, 4], finalDamageMultiplier: [0, 8] });
var ratios = ["reduction", "vulnerability", "shatter", "damageBonus", "attackPercent", "attributePercent", "finalDamageMultiplier"];
var flags = ["taunted", "intercept", "skip", "rooted", "hidden", "disarmed", "infiniteAmmo", "guaranteed_hit", "guaranteed_crit", "blockResourceRestore", "preserveLife"];
function rangeFor(key3, template) {
  if (key3 === "armor") {
    const base = template?.modifiers.armor;
    if (base < 0) return [-1e5, -1];
    if (base === 0) return [0, 1e5];
  }
  return Object.hasOwn(ranges, key3) ? ranges[key3] : void 0;
}
function statusModifierRange(key3, template) {
  const range = rangeFor(key3, template);
  if (range) return range.join("\u2013");
  if (key3 === "damageType") return damageTypes.join("/");
  if (flags.includes(key3)) return "true/false";
  throw new Error(`\u672A\u77E5\u72B6\u6001\u53C2\u6570\uFF1A${key3}`);
}
function validateStatusModifiers(template, modifiers2) {
  if (!modifiers2 || Object.getPrototypeOf(modifiers2) !== Object.prototype) throw new Error("modifiers \u5FC5\u987B\u4E3A\u5BF9\u8C61");
  for (const [key3, value] of Object.entries(modifiers2)) {
    if (!Object.hasOwn(template.modifiers, key3)) throw new Error(`${template.id} \u4E0D\u5141\u8BB8\u8986\u76D6\u72B6\u6001\u53C2\u6570 ${key3}`);
    const range = rangeFor(key3, template);
    const valid = range ? (ratios.includes(key3) ? Number.isFinite(value) : Number.isInteger(value)) && value >= range[0] && value <= range[1] : key3 === "damageType" ? damageTypes.includes(value) : flags.includes(key3) && typeof value === "boolean";
    if (!valid) throw new Error(`\u65E0\u6548\u72B6\u6001\u53C2\u6570 ${template.id}.${key3}\uFF0C\u5408\u6CD5\u8303\u56F4\uFF1A${statusModifierRange(key3, template)}`);
  }
}

// src/core/combat.js
var def = (name, icon, category, remainingTurns, description, modifiers2 = {}, options = {}) => Object.freeze({
  name,
  icon,
  category,
  description,
  remainingTurns,
  durationType: "battle_turns",
  tickTiming: "onTurnStart",
  stackRule: "refresh",
  maxStacks: 1,
  modifiers: Object.freeze(modifiers2),
  ...options
});
var STATUSES = Object.freeze(Object.fromEntries(Object.entries({
  burn: def("\u707C\u70E7", "\u{1F525}", "dot", 2, "\u56DE\u5408\u521D\u53D7\u5230\u706B\u7130\u80FD\u91CF\u4F24\u5BB3\u3002", { damage: 5, damageType: "energy" }),
  bleed: def(
    "\u6D41\u8840",
    "\u{1FA78}",
    "dot",
    3,
    "\u56DE\u5408\u672B\u6BCF\u5C42\u53D7\u5230 3 \u70B9\u771F\u5B9E\u4F24\u5BB3\u3002",
    { damage: 3, damageType: "true" },
    { stackRule: "stack", maxStacks: 5, tickTiming: "onTurnEnd" }
  ),
  poison: def(
    "\u4E2D\u6BD2",
    "\u2620\uFE0F",
    "dot",
    3,
    "\u56DE\u5408\u521D\u6BCF\u5C42\u53D7\u5230 3 \u70B9\u771F\u5B9E\u4F24\u5BB3\u3002",
    { damage: 3, damageType: "true" },
    { stackRule: "stack", maxStacks: 4 }
  ),
  regen: def("\u518D\u751F", "\u{1F49A}", "hot", 3, "\u56DE\u5408\u521D\u6062\u590D\u751F\u547D\u3002", { heal: 5 }),
  shield: def("\u62A4\u76FE", "\u{1F6E1}\uFE0F", "shield", 2, "\u72EC\u7ACB\u5438\u6536\u4F24\u5BB3\uFF1B\u8017\u5C3D\u65F6\u7834\u88C2\u3002", { amount: 8 }, { stackRule: "replace" }),
  guarded: def("\u575A\u58C1", "\u{1F9F1}", "buff", 1, "\u53D7\u5230\u7684\u4F24\u5BB3\u51CF\u5C11 35%\u3002", { reduction: 0.35 }),
  taunt: def("\u5632\u8BBD", "\u{1F4E3}", "control", 1, "\u53EF\u653B\u51FB\u5632\u8BBD\u6765\u6E90\u65F6\uFF0C\u8FDB\u653B\u5FC5\u987B\u6307\u5B9A\u8BE5\u6765\u6E90\u3002", { taunted: true }),
  guard: def("\u63F4\u62A4", "\u{1F91D}", "buff", 2, "\u66FF\u76F8\u90BB\u53CB\u519B\u627F\u53D7\u4F24\u5BB3\uFF1B\u4E0D\u4F1A\u8FDE\u7EED\u8F6C\u4EA4\u3002", { intercept: true }),
  thorns: def("\u53CD\u4F24\u68D8\u7532", "\u{1F335}", "buff", 2, "\u88AB\u8FD1\u6218\u547D\u4E2D\u65F6\uFF0C\u5BF9\u8FDB\u653B\u8005\u9020\u6210\u771F\u5B9E\u4F24\u5BB3\u3002", { reflect: 5 }),
  stun: def("\u7729\u6655", "\u{1F4AB}", "control", 1, "\u8DF3\u8FC7\u884C\u52A8\u3002", { skip: true }),
  freeze: def("\u51B0\u51BB", "\u{1F9CA}", "control", 1, "\u8DF3\u8FC7\u884C\u52A8\uFF1B\u88AB\u6253\u51FB\u65F6\u788E\u51B0\uFF0C\u53D7\u5230\u989D\u5916\u4F24\u5BB3\u3002", { skip: true, shatter: 0.5 }),
  root: def("\u5B9A\u8EAB", "\u26D3\uFE0F", "control", 2, "\u65E0\u6CD5\u79FB\u52A8\u6216\u77AC\u79FB\uFF0C\u4ECD\u53EF\u653B\u51FB\u6216\u65BD\u6CD5\u3002", { rooted: true }),
  blind: def("\u81F4\u76F2", "\u{1F311}", "debuff", 2, "\u547D\u4E2D\u68C0\u5B9A\u5E26\u52A3\u52BF\u3002", { disadvantage: 1 }),
  vulnerable: def("\u6613\u4F24", "\u{1F4A2}", "debuff", 2, "\u53D7\u5230\u7684\u4F24\u5BB3\u589E\u52A0 35%\u3002", { vulnerability: 0.35 }),
  sunder: def("\u7834\u7532", "\u{1F528}", "debuff", 2, "\u62A4\u7532\u964D\u4F4E 4 \u70B9\u3002", { armor: -4 }),
  mark: def("\u6807\u8BB0", "\u{1F3AF}", "debuff", 2, "\u653B\u51FB\u6B64\u5355\u4F4D\u7684\u547D\u4E2D\u52A0 2\u3002", { incomingAccuracy: 2 }),
  stealth: def("\u9690\u8EAB", "\u{1F464}", "buff", 2, "\u65E0\u6CD5\u88AB\u654C\u65B9\u8FDC\u8DDD\u76F4\u63A5\u9501\u5B9A\uFF1B\u53D1\u52A8\u8FDB\u653B\u6216\u906D\u653B\u51FB\u4F24\u5BB3\u65F6\u73B0\u5F62\u3002", { hidden: true, advantage: 1 }),
  haste: def("\u75BE\u8D70", "\u{1F4A8}", "buff", 2, "\u79FB\u52A8\u8DDD\u79BB\u589E\u52A0 1\u3002", { movement: 1 }),
  chill: def("\u5BD2\u51B7", "\u2744\uFE0F", "debuff", 2, "\u79FB\u52A8\u8DDD\u79BB\u548C\u547D\u4E2D\u964D\u4F4E\u3002", { movement: -1, accuracy: -2 }),
  charge: def("\u84C4\u529B", "\u26A1", "buff", 1, "\u672C\u56DE\u5408\u4E0B\u4E00\u6B21\u653B\u51FB\u589E\u4F24\u3002", { damageBonus: 0.15 }),
  lock_on: def("\u5B9A\u4F4D", "\u2316", "buff", 1, "\u672C\u56DE\u5408\u5BF9\u9501\u5B9A\u76EE\u6807\u547D\u4E2D\u63D0\u9AD8\u3002", { accuracy: 1 }),
  weakness: def("\u5F31\u70B9\u8BC6\u522B", "\u25C9", "buff", 3, "\u6BCF\u5C42\u4F7F\u610F\u56FE\u96BE\u5EA6\u964D\u4F4E 2\u3002", { intentDifficulty: -2 }, { stackRule: "stack", maxStacks: 3 }),
  grappled: def("\u64D2\u62B1", "\u26D3", "control", 1, "\u65E0\u6CD5\u79FB\u52A8\uFF0C\u4ECD\u53EF\u8FDB\u884C\u8FD1\u8EAB\u653B\u51FB\u3002", { rooted: true }),
  prone: def("\u5012\u5730", "\u25BD", "debuff", 1, "\u65E0\u6CD5\u79FB\u52A8\uFF0C\u95EA\u907F\u964D\u4F4E\u3002", { incomingAccuracy: 2, rooted: true }),
  disarmed: def("\u7F34\u68B0", "\u2694", "debuff", 1, "\u65E0\u6CD5\u4F7F\u7528\u4E3B\u624B\u6B66\u5668\u3002", { disarmed: true }),
  infinite_ammo: def("\u65E0\u9650\u5F39\u836F", "\u{1F3F9}", "buff", 1, "\u8FDC\u7A0B\u5C04\u51FB\u65E0\u9700\u88C5\u586B\uFF0C\u4E5F\u4E0D\u6D88\u8017\u5F39\u836F\u3002", { infiniteAmmo: true })
}).map(([id3, status2]) => [id3, Object.freeze({ id: id3, ...status2 })])));
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
var values2 = (object4) => Object.values(object4 ?? {});
var alive = (unit) => unit && unit.hp > 0;
var byId2 = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
var living = (state) => values2(state.units).filter((unit) => alive(unit) && !unit.fled).sort(byId2);
var sameCell = (a, b) => a.x === b.x && a.y === b.y;
var pos = (x, y) => ({ x, y });
var key2 = (x, y) => `${x},${y}`;
var stat = (unit, id3) => Number(unit.stats?.[id3] ?? 0) * Math.max(0, 1 + changes(unit, "attributePercent"));
var clamp = (number3, min, max) => Math.max(min, Math.min(max, number3));
var changes = (unit, name) => values2(unit.statuses).reduce((sum, s) => sum + Number(s.modifiers?.[name] ?? STATUSES[s.id]?.modifiers?.[name] ?? 0) * (s.stacks ?? 1), 0);
var statusOf = (unit, id3) => Object.hasOwn(unit.statuses ?? {}, id3) ? unit.statuses[id3] : void 0;
var currentUnit = (state) => Object.hasOwn(state.units, state.order[state.turn]) ? state.units[state.order[state.turn]] : void 0;
function record(state, unit, type, text4, detail = {}) {
  const event = { round: state.round, actor: typeof unit === "string" ? unit : unit?.id ?? null, type, text: text4, detail };
  state.logs.push(event);
  return event;
}
function tableEntry(table3, id3) {
  return Object.hasOwn(table3 ?? {}, id3) ? table3[id3] : void 0;
}
function getStatusTemplate(state, statusId2) {
  if (typeof statusId2 !== "string") return void 0;
  return tableEntry(STATUSES, statusId2) ?? tableEntry(state?.statusTemplates, statusId2);
}
function equipmentFor(state, instanceId) {
  const instance = tableEntry(state.items, instanceId);
  const template = tableEntry(state.equipment, instance?.templateId);
  return { instance, template, effects: template?.effects ?? [] };
}
var gearFor = (state, unit) => (unit.gear ?? []).map((id3) => equipmentFor(state, id3));
var equipped = (state, unit) => [...new Set([unit.mainHand ?? unit.weapon, unit.offHand, unit.shield, ...unit.gear ?? []].filter(Boolean))].map((id3) => equipmentFor(state, id3)).filter(({ template }) => !template?.boundTo || template.boundTo === unit.id);
var effectiveStat = (state, unit, key3) => dsl.stat(state, unit, key3, stat(unit, key3));
var resolveDC = (state, actor, dc) => typeof dc === "number" ? dc : clamp(dc.base + dc.scaleBy.perUnit * effectiveStat(state, actor, dc.scaleBy.stat), dc.min ?? 1, dc.max ?? 50);
var finalDamageMultiplier = (unit) => values2(unit.statuses).reduce((mult, s) => mult * (s.modifiers?.finalDamageMultiplier ?? 1) ** (s.stacks ?? 1), 1);
var resourcePool = (state, unit, resource3, instance) => {
  for (const item of equipped(state, unit)) {
    if (instance && item.instance !== instance) continue;
    const effect = resourceDefinitions(item.template, true).find((node3) => node3.resource === resource3);
    if (effect) return { item, effect, amount: item.instance.counters?.[resource3] ?? effect.initial ?? 0 };
  }
  return null;
};
function stealthCheck(state, unit, d20, dc) {
  const bonus = dsl.check(state, unit, "stealthBonus");
  return { total: d20 + bonus, bonus, success: d20 + bonus >= dc };
}
var statusAmount = (status2) => status2.amount ?? status2.modifiers?.amount ?? STATUSES[status2.id]?.modifiers.amount ?? 0;
function statusModifierKeys(statusId2, state) {
  return Object.keys(getStatusTemplate(state, statusId2)?.modifiers ?? {});
}
function patchStatus(state, unitId, statusId2, patch) {
  const unit = tableEntry(state.units, unitId);
  const status2 = unit && statusOf(unit, statusId2);
  const template = getStatusTemplate(state, statusId2);
  if (!status2 || !template) throw new Error(`\u627E\u4E0D\u5230\u72B6\u6001\u5B9E\u4F8B\uFF1A${unitId}/${statusId2}`);
  if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || !Object.keys(patch).length) throw new Error("\u72B6\u6001\u53C2\u6570\u8865\u4E01\u987B\u4E3A\u975E\u7A7A\u5BF9\u8C61");
  const { expireOn: expireOn2, ...modifiers2 } = patch;
  const patchExpiry = Object.hasOwn(patch, "expireOn");
  validateStatusModifiers(template, modifiers2);
  if (patchExpiry && expireOn2 !== null && !validExpireOn(expireOn2)) throw new Error("\u65E0\u6548\u5B57\u6BB5\uFF1AexpireOn");
  status2.modifiers = { ...status2.modifiers, ...modifiers2 };
  if (patchExpiry) status2.expireOn = structuredClone(expireOn2);
  if (statusId2 === "shield" && Object.hasOwn(modifiers2, "amount")) status2.amount = clamp(modifiers2.amount, 1, 1e5);
  record(
    state,
    unit,
    "status_patch",
    `${unit.name}\u7684${status2.name}\u53C2\u6570\u5DF2\u66F4\u65B0`,
    { targetId: unitId, statusId: statusId2, modifiers: modifiers2, ...patchExpiry ? { expireOn: status2.expireOn } : {} }
  );
  return status2;
}
function grantStatus(state, unit, statusId2, options = {}) {
  const template = getStatusTemplate(state, statusId2);
  if (!unit || !template) throw new Error(`\u672A\u77E5\u72B6\u6001\uFF1A${statusId2}`);
  if (!alive(unit) || unit.fled) return null;
  if (Object.hasOwn(options, "modifiers")) validateStatusModifiers(template, options.modifiers);
  unit.statuses ??= {};
  const previous = statusOf(unit, statusId2);
  const stackRule = options.stackRule ?? previous?.stackRule ?? template.stackRule;
  const maxStacks = options.maxStacks ?? previous?.maxStacks ?? template.maxStacks;
  const addedStacks = options.stacks ?? 1;
  const stacks = clamp(stackRule === "stack" ? (previous?.stacks ?? 0) + addedStacks : addedStacks, 1, maxStacks);
  const remainingTurns = options.remainingTurns ?? options.turns ?? template.remainingTurns;
  const applied = {
    ...template,
    stackRule,
    maxStacks,
    stacks,
    durationType: options.durationType ?? previous?.durationType ?? template.durationType,
    remainingTurns: stackRule === "stack" && options.remainingTurns == null && options.turns == null ? Math.max(previous?.remainingTurns ?? 0, remainingTurns) : remainingTurns,
    tickTiming: options.tickTiming ?? template.tickTiming,
    modifiers: { ...template.modifiers, ...options.modifiers ?? {} },
    sourceUnitId: options.sourceUnitId ?? previous?.sourceUnitId ?? null,
    appliedRound: state.round,
    appliedTurn: state.turn
  };
  if (Object.hasOwn(options, "expireOn")) {
    if (!validExpireOn(options.expireOn)) throw new Error("\u65E0\u6548\u5B57\u6BB5\uFF1AexpireOn");
    applied.expireOn = structuredClone(options.expireOn);
  } else if (Object.hasOwn(previous ?? {}, "expireOn")) applied.expireOn = previous.expireOn;
  if (statusId2 === "shield") applied.amount = options.amount == null ? applied.modifiers.amount : clamp(options.amount, 1, 1e4);
  unit.statuses[statusId2] = applied;
  record(
    state,
    applied.sourceUnitId ?? unit.id,
    "status",
    `${unit.name}\u83B7\u5F97${template.name} \xD7${stacks}`,
    {
      targetId: unit.id,
      statusId: statusId2,
      stacks,
      remainingTurns: applied.remainingTurns,
      ...statusId2 === "shield" ? { amount: applied.amount } : {}
    }
  );
  return applied;
}
function refreshOutcome(state) {
  let blue = false, red = false;
  for (const unit of values2(state.units)) if (alive(unit) && !unit.fled) {
    blue ||= unit.team === "blue";
    red ||= unit.team === "red";
  }
  const result = blue && red ? null : blue ? "blue" : red ? "red" : "draw";
  if (state.outcome !== result) {
    state.outcome = result;
    if (result) record(state, null, "outcome", result === "draw" ? "\u6218\u6597\u7ED3\u675F\uFF1A\u5E73\u5C40" : `\u6218\u6597\u7ED3\u675F\uFF1A${result === "blue" ? "\u84DD\u65B9" : "\u7EA2\u65B9"}\u83B7\u80DC`, { outcome: result });
  }
  return result;
}
var eventLabels = {
  on_attack: "\u53D1\u52A8\u653B\u51FB",
  on_hit: "\u653B\u51FB\u547D\u4E2D",
  on_damaged: "\u53D7\u5230\u4F24\u5BB3",
  on_kill: "\u51FB\u6740",
  on_death: "\u5012\u4E0B",
  on_turn_start: "\u56DE\u5408\u5F00\u59CB",
  on_turn_end: "\u56DE\u5408\u7ED3\u675F",
  on_skill_cast: "\u65BD\u653E\u6280\u80FD",
  on_equip: "\u88C5\u5907\u751F\u6548",
  on_heal: "\u53D7\u5230\u6CBB\u7597",
  on_ally_death: "\u961F\u53CB\u5012\u4E0B"
};
function expireStatuses(state, unit, trigger, { sourceUnitId = null, direct = false } = {}) {
  for (const status2 of values2(unit.statuses)) {
    if (!status2.expireOn) continue;
    const rule = [].concat(status2.expireOn).find((rule2) => rule2.trigger === trigger && (rule2.damageType == null || rule2.damageType === "any" || rule2.damageType === (direct ? "direct" : "indirect")) && (rule2.exceptSource !== "self" || sourceUnitId !== unit.id));
    if (!rule) continue;
    delete unit.statuses[status2.id];
    record(
      state,
      unit,
      "expire",
      `${unit.name}\u7684${status2.name}\u56E0${eventLabels[trigger]}\u63D0\u524D\u89E3\u9664`,
      { targetId: unit.id, statusId: status2.id, trigger, sourceUnitId, ...trigger === "on_damaged" ? { direct } : {} }
    );
  }
}
function dispatchEffect(state, actor, trigger, context = {}, extra = []) {
  if (actor && !["on_damaged", "on_heal", "active"].includes(trigger)) {
    expireStatuses(state, actor, trigger, { sourceUnitId: context.sourceUnitId ?? actor.id });
  }
  dsl.dispatch(state, actor, trigger, context, extra);
}
function loseHP(state, target2, raw, sourceUnitId, type, label, detail = {}, triggerDamage = true, effectContext = {}) {
  if (!alive(target2) || target2.fled) return 0;
  const hpBefore = target2.hp;
  const source = tableEntry(state.units, sourceUnitId);
  const preserveLife = effectContext.preserveLife || target2.nonLethal || changes(target2, "preserveLife");
  target2.hp = Math.max(preserveLife ? 1 : 0, hpBefore - Math.max(0, Math.floor(raw)));
  const amount2 = hpBefore - target2.hp;
  record(
    state,
    sourceUnitId,
    "damage",
    `${target2.name}\u53D7\u5230${amount2}\u70B9${label}\u4F24\u5BB3`,
    { ...detail, targetId: target2.id, damageType: type, amount: amount2, hpBefore, hpAfter: target2.hp }
  );
  if (amount2 > 0) expireStatuses(state, target2, "on_damaged", { sourceUnitId, direct: effectContext.direct });
  if (!alive(target2)) {
    const allies = living(state).filter((unit) => unit.team === target2.team);
    target2.diedAt = { round: state.round, turn: state.turn };
    target2.corpseOf ??= target2.id;
    record(state, sourceUnitId, "defeat", `${target2.name}\u5012\u4E0B`, { targetId: target2.id });
    triggerDeathrattle(state, target2, sourceUnitId);
    dispatchEffect(state, target2, "on_death", { target: source, attacker: source, killed: target2, dealt: amount2, damageType: type, weaponId: detail.weaponId, sourceUnitId });
    for (const ally of allies) if (alive(ally)) dispatchEffect(state, ally, "on_ally_death", { target: target2, killed: target2, attacker: source, sourceUnitId: target2.id });
    if (source && source.team !== target2.team) dispatchEffect(state, source, "on_kill", { target: target2, killed: target2, dealt: amount2, damageType: type, weaponId: detail.weaponId });
  } else if (amount2 > 0 && triggerDamage) {
    dsl.dispatch(state, target2, "on_damaged", { target: source, attacker: source, dealt: amount2, damageType: type, ...effectContext });
  }
  return amount2;
}
function triggerDeathrattle(state, target2, sourceUnitId) {
  const effect = target2.deathrattle;
  if (!effect || target2.deathrattleTriggered) return;
  target2.deathrattleTriggered = true;
  record(state, target2, "deathrattle", `${target2.name}\u89E6\u53D1\u4EA1\u8BED`, { targetId: target2.id, effect: structuredClone(effect) });
  const at = { x: target2.x, y: target2.y };
  if (effect.kind === "damage") {
    for (const unit of living(state)) if (unit.team !== target2.team && distance3D(state, at, unit) <= (effect.radius ?? 1))
      damageTarget(state, unit, sourceUnitId, effect.amount ?? 0, effect.damageType ?? "energy", effect.name ?? "\u4EA1\u8BED", { reaction: true });
  } else if (effect.kind === "status") {
    for (const unit of living(state)) if (unit.team !== target2.team && distance3D(state, at, unit) <= (effect.radius ?? 1))
      grantStatus(state, unit, effect.statusId, { turns: effect.turns, sourceUnitId });
  } else if (effect.kind === "zone") {
    state.zones ??= {};
    const id3 = effect.id ?? `deathrattle-${target2.id}-${state.round}-${state.logs.length}`;
    state.zones[id3] = {
      id: id3,
      name: effect.name ?? "\u4EA1\u8BED\u9886\u57DF",
      x: at.x,
      y: at.y,
      radius: effect.radius ?? 1,
      remainingTurns: effect.remainingTurns ?? 2,
      damage: effect.amount ?? 0,
      damageType: effect.damageType ?? "energy",
      team: effect.team ?? "all"
    };
    record(state, target2, "zone", `${effect.name ?? "\u4EA1\u8BED\u9886\u57DF"}\u5F62\u6210`, { zoneId: id3 });
  } else if (effect.kind === "spawn" && effect.unit && !state.units[effect.unit.id]) {
    const unit = structuredClone(effect.unit);
    unit.x = at.x;
    unit.y = at.y;
    unit.hp = unit.maxHp;
    state.units[unit.id] = unit;
    state.order.push(unit.id);
    record(state, target2, "spawn", `${unit.name}\u7531\u4EA1\u8BED\u8BDE\u751F`, { unitId: unit.id });
  }
}
function moraleCheck(state) {
  for (const unit of living(state)) {
    const result = moraleResult({ type: unit.moraleType ?? "standard", hp: unit.hp, maxHp: unit.maxHp, d20: randomDie(state, 20) });
    if (!result.triggered || unit.moraleCheckedRound === state.round) continue;
    unit.moraleCheckedRound = state.round;
    if (!result.check) {
      unit.moraleState = "shaken";
      continue;
    }
    unit.moraleState = result.shaken ? "shaken" : "routed";
    record(state, unit, "morale", `${unit.name}${result.shaken ? "\u52A8\u6447" : "\u6E83\u9003"}`, { targetId: unit.id, ...result });
  }
}
function restoreHP(state, target2, raw, sourceUnitId, label, detail = {}) {
  if (!alive(target2) || target2.fled) return 0;
  const healer = tableEntry(state.units, sourceUnitId);
  const healing = Math.max(0, Math.floor(healer ? dsl.stat(state, healer, "healing", raw, { target: target2, ...detail }) : raw));
  const amount2 = Math.min(healing, target2.maxHp - target2.hp);
  target2.hp += amount2;
  record(state, sourceUnitId, "heal", `${target2.name}\u56E0${label}\u6062\u590D${amount2}\u70B9\u751F\u547D`, { ...detail, targetId: target2.id, amount: amount2 });
  if (amount2 > 0) expireStatuses(state, target2, "on_heal", { sourceUnitId });
  if (healer && healing) dsl.dispatch(state, healer, "on_heal", { target: target2, healing, actionType: detail.actionType });
  return amount2;
}
function armorOf(state, unit, damageType2, pierce = 0, context = {}) {
  const equipmentDefense = gearFor(state, unit).reduce((sum, g) => sum + (g.template?.defense ?? 0), 0) + (unit.shield ? equipmentFor(state, unit.shield).template?.defense ?? 0 : 0);
  const base = unit.armor + equipmentDefense + changes(unit, "armor") + gearFor(state, unit).reduce((sum, g) => sum + (g.template?.armor ?? 0), 0);
  const ctx = { ...context, target: context.attacker, damageType: damageType2 };
  const armor = Math.max(0, dsl.stat(state, unit, "defense", dsl.stat(state, unit, "armor", base, ctx), ctx));
  const flat = typeof pierce === "object" ? pierce.flat ?? 0 : pierce;
  const percent = typeof pierce === "object" ? pierce.percent ?? 0 : 0;
  const effective = Math.max(0, armor * (1 - percent) - flat);
  return damageType2 === "physical" ? effective : damageType2 === "energy" ? effective / 2 : 0;
}
function damageTarget(state, target2, sourceUnitId, amount2, type, label, options = {}) {
  const { attacker, hit = false, melee = false, armorPierce = 0, reaction = false, details = {}, committedRecipient } = options;
  let recipient = committedRecipient ?? target2;
  if (hit && !reaction && !committedRecipient) {
    recipient = guardFor(state, target2) ?? target2;
    if (recipient !== target2) record(state, recipient, "guard", `${recipient.name}\u66FF${target2.name}\u627F\u53D7\u6253\u51FB`, { targetId: target2.id });
  }
  let parry = null;
  if (hit && melee && !reaction && recipient !== attacker && recipient?.stance === "greatsword" && recipient.greatswordMode === "defensive" && (recipient.parryQuota ?? 0) > 0) {
    const defenderRoll = randomDie(state, 20), attackerRoll = randomDie(state, 20);
    const defenderTotal = effectiveStat(state, recipient, "str") + defenderRoll;
    const attackerTotal = effectiveStat(state, attacker, "str") + attackerRoll;
    const success = defenderTotal >= attackerTotal;
    const perfect = success && (details.ratingMultiplier ?? 0) >= 1.3 && !recipient.parryRefunded;
    recipient.parryQuota--;
    if (perfect) {
      recipient.parryQuota = Math.min(2, recipient.parryQuota + 1);
      recipient.parryRefunded = true;
    }
    parry = { success, perfect, defenderRoll, attackerRoll, defenderTotal, attackerTotal, reduction: perfect ? 1 : success ? 0.6 : 0, quota: recipient.parryQuota };
    record(state, recipient, "parry", `${recipient.name}${perfect ? "\u5B8C\u7F8E\u5F39\u53CD" : success ? "\u5F39\u53CD\u6210\u529F" : "\u5F39\u53CD\u5931\u8D25"}`, { targetId: attacker?.id ?? null, ...parry });
    if (perfect) amount2 = 0;
    else if (success) amount2 *= 0.4;
  }
  if (!alive(recipient) || recipient.fled) return { recipient, dealt: 0 };
  const formula = mitigation(state, recipient, type, hit, armorPierce, { attacker, intercepting: recipient !== target2, ignoreArmor: options.ignoreArmor });
  const modified = Math.max(0, hit ? Math.floor(amount2 * formula.multiplier * formula.armorMultiplier * (1 - formula.attributeReduction) * (attacker ? finalDamageMultiplier(attacker) : 1)) : Math.floor(amount2 * formula.multiplier) - Math.floor(formula.armor));
  if (formula.shatter) {
    delete recipient.statuses.freeze;
    record(state, sourceUnitId, "shatter", `${recipient.name}\u7684\u51B0\u5C42\u788E\u88C2`, { targetId: recipient.id, multiplier: 1 + formula.shatter });
  }
  if (hit && statusOf(recipient, "stealth")) {
    delete recipient.statuses.stealth;
    record(state, recipient, "reveal", `${recipient.name}\u73B0\u5F62`, { targetId: recipient.id });
  }
  const net = Math.max(0, Math.floor(modified - dsl.stat(state, recipient, "damageReductionFlat", 0, { target: attacker, damageType: type, intercepting: recipient !== target2 })));
  const shield = statusOf(recipient, "shield");
  const absorbed = Math.min(shield ? statusAmount(shield) : 0, net);
  if (absorbed > 0) {
    shield.amount = statusAmount(shield) - absorbed;
    record(state, recipient, "shield", `${recipient.name}\u7684\u62A4\u76FE\u5438\u6536${absorbed}\u70B9\u4F24\u5BB3`, { absorbed, remaining: shield.amount });
    if (shield.amount <= 0) {
      delete recipient.statuses.shield;
      record(state, recipient, "shield_break", `${recipient.name}\u7684\u62A4\u76FE\u7834\u88C2`, { targetId: recipient.id });
    }
  }
  const pending = net - absorbed;
  const dealt = loseHP(
    state,
    recipient,
    pending,
    sourceUnitId,
    type,
    label,
    { ...details, ...formula, ...parry ? { parry } : {}, raw: amount2, absorbed, intendedTargetId: target2.id },
    true,
    { preserveLife: options.preserveLife, melee: hit && melee, reaction, intercepting: recipient !== target2, direct: options.direct ?? hit }
  );
  if (hit && melee && !reaction && alive(attacker) && attacker.id !== recipient.id) {
    const reflect = changes(recipient, "reflect");
    if (reflect > 0) damageTarget(state, attacker, recipient.id, reflect, "true", "\u68D8\u7532\u53CD\u4F24", { reaction: true });
  }
  return { recipient, dealt };
}
function mitigation(state, unit, type, hit, pierce, ctx = {}) {
  const shatter = hit ? changes(unit, "shatter") : 0;
  const vulnerability = changes(unit, "vulnerability");
  const reduction = clamp(dsl.stat(state, unit, "damageReduction", changes(unit, "reduction"), { ...ctx, target: ctx.attacker, damageType: type }), 0, 1);
  const defense = ctx.ignoreArmor ? 0 : armorOf(state, unit, type, pierce, ctx);
  const armorMultiplier = type === "true" ? 1 : 2e3 / (defense + 2e3);
  const attributes2 = Object.fromEntries(Object.keys(unit.stats ?? {}).map((key3) => [key3, effectiveStat(state, unit, key3)]));
  const attributeReduction = state.ruleset === "protocol" ? type === "physical" ? (Number(attributes2.con ?? 0) + Number(attributes2.str ?? 0) + Number(attributes2.agi ?? 0)) * 25e-4 : type === "energy" ? (Number(attributes2.spi ?? 0) + Number(attributes2.int ?? 0)) * 4e-3 : type === "mental" ? Number(attributes2.spi ?? 0) * 8e-3 : 0 : 0;
  return {
    shatter,
    vulnerability,
    reduction,
    attributeReduction,
    multiplier: (1 + shatter) * (1 + vulnerability) * (1 - reduction),
    armor: defense,
    armorMultiplier
  };
}
function guardFor(state, target2) {
  return living(state).find((u) => u !== target2 && u.team === target2.team && changes(u, "intercept") && !changes(u, "skip") && gridDistance(u, target2) <= 1 && Math.abs(elevation(state, u) - elevation(state, target2)) <= 1 && hasLOS(state, u, target2));
}
function tick(state, unit, timing) {
  for (const status2 of values2(unit.statuses)) {
    if (!alive(unit)) return;
    if (unit.statuses[status2.id] !== status2 || status2.tickTiming !== timing) continue;
    if (status2.appliedRound === state.round && status2.appliedTurn === state.turn) continue;
    const source = status2.sourceUnitId ?? unit.id;
    const amount2 = status2.modifiers?.damage;
    if (amount2) damageTarget(state, unit, source, amount2 * status2.stacks, status2.modifiers.damageType ?? "true", status2.name);
    const heal = status2.modifiers?.heal;
    if (heal && alive(unit)) restoreHP(state, unit, heal * status2.stacks, source, status2.name);
  }
}
function tickZones(state, unit) {
  for (const zone of values2(state.zones)) {
    if (zone.remainingTurns <= 0 || distance3D(state, unit, zone) > zone.radius) continue;
    if (zone.team !== "all" && zone.team !== unit.team) continue;
    if (zone.damage > 0) damageTarget(state, unit, zone.sourceUnitId ?? null, zone.damage, zone.damageType, zone.name);
    record(state, zone.sourceUnitId ?? null, "zone", `${unit.name}\u53D7\u5230${zone.name}\u533A\u57DF\u5F71\u54CD`, { zoneId: zone.id, targetId: unit.id, damage: zone.damage });
  }
}
function decayZones(state) {
  for (const zone of values2(state.zones)) if (--zone.remainingTurns <= 0) {
    delete state.zones[zone.id];
    record(state, null, "zone_expire", `${zone.name}\u533A\u57DF\u6D88\u6563`, { zoneId: zone.id });
  }
}
function endTurn(state, unit) {
  if (!unit) return;
  unit.ap = 0;
  for (const [id3, modifier] of Object.entries(unit.effectModifiers ?? {})) {
    if (modifier.round === state.round && modifier.turn === state.turn) continue;
    if (--modifier.turns <= 0) delete unit.effectModifiers[id3];
  }
  expireStatuses(state, unit, "on_turn_end", { sourceUnitId: unit.id });
  tick(state, unit, "onTurnEnd");
  dsl.dispatch(state, unit, "on_turn_end");
  for (const status2 of values2(unit.statuses)) {
    if (status2.durationType !== "battle_turns") continue;
    if (status2.appliedRound === state.round && status2.appliedTurn === state.turn && (!status2.expireInto || status2.sourceUnitId !== unit.id)) continue;
    if (--status2.remainingTurns > 0) continue;
    delete unit.statuses[status2.id];
    record(state, unit, "expire", `${unit.name}\u7684${status2.name}\u7ED3\u675F`, { targetId: unit.id, statusId: status2.id });
    if (status2.expireInto && alive(unit) && !refreshOutcome(state)) grantStatus(state, unit, status2.expireInto, { sourceUnitId: unit.id });
  }
  record(state, unit, "end", `${unit.name}\u7ED3\u675F\u56DE\u5408`);
  if (unit === state.units[state.order.at(-1)]) decayZones(state);
}
function settleTurn(state) {
  for (let checked = 0; checked < state.order.length; checked++) {
    const unit = currentUnit(state);
    if (alive(unit)) {
      unit.used = { attack: 0, action: 0 };
      unit.reactionAvailable = true;
      unit.ap = 2;
      record(state, unit, "turn", `${unit.name}\u5F00\u59CB\u56DE\u5408`, { turn: state.turn });
      expireStatuses(state, unit, "on_turn_start", { sourceUnitId: unit.id });
      tick(state, unit, "onTurnStart");
      tickZones(state, unit);
      dsl.dispatch(state, unit, "on_turn_start");
      if (refreshOutcome(state)) {
        unit.ap = 0;
        return;
      }
      if (alive(unit) && !changes(unit, "skip")) return;
      if (alive(unit)) record(state, unit, "skip", `${unit.name}\u56E0\u63A7\u5236\u8DF3\u8FC7\u884C\u52A8`);
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
    const target2 = unit.lockedTargetId ? state.units[unit.lockedTargetId] : null;
    if (target2 && alive(target2)) unit.facing = facingToward(unit, target2);
  }
}
function advanceCursor(state) {
  state.turn++;
  if (state.turn < state.order.length) return;
  state.turn = 0;
  state.round++;
  const opening = state.logs.find((log) => log.type === "initiative")?.detail?.initiative;
  const openingRows = opening?.filter((row) => state.order.includes(row.unitId)) ?? [];
  const hasModifier = living(state).some((unit) => values2(unit.effectModifiers).some((m) => m.stat === "initiative"));
  const lastChange = state.logs.findLast((log) => log.type === "initiative_order");
  if (openingRows.length && (hasModifier || lastChange?.detail.modified)) {
    const ranked = openingRows.map((row, index) => {
      const unit = state.units[row.unitId];
      const delta = dsl.stat(state, unit, "initiative", row.flatInit, {}, true) - row.flatInit;
      return { id: row.unitId, total: row.total + delta, index };
    }).sort((a, b) => b.total - a.total || a.index - b.index).map((row) => row.id);
    const included = new Set(ranked);
    const order = [...ranked, ...state.order.filter((id3) => !included.has(id3))];
    if (order.some((id3, index) => id3 !== state.order[index])) {
      state.order = order;
      record(state, null, "initiative_order", "\u5148\u653B\u4FEE\u6B63\u6539\u53D8\u884C\u52A8\u987A\u5E8F", { order, modified: hasModifier });
    } else if (!hasModifier) {
      record(state, null, "initiative_order", "\u5148\u653B\u4FEE\u6B63\u7ED3\u675F", { order, modified: false });
    }
  }
  resetFacing(state);
  moraleCheck(state);
}
function beginBattle(state) {
  state.logs ??= [];
  state.round = 1;
  state.turn = 0;
  for (const unit of values2(state.units)) {
    delete unit.effectUsage;
    delete unit.effectModifiers;
  }
  state.outcome = null;
  syncEquipmentEffects(state);
  const initiative2 = initiativeOrder(state, () => randomDie(state, 20));
  state.order = initiative2.map((entry) => entry.unitId);
  for (const unit of values2(state.units)) {
    unit.ap = 0;
    unit.used = { attack: 0, action: 0 };
    unit.reactionAvailable = true;
    for (const status2 of values2(unit.statuses)) {
      delete status2.appliedRound;
      delete status2.appliedTurn;
    }
  }
  record(state, null, "initiative", "\u654F\u6377 + d20\uFF1A\u786E\u5B9A\u5148\u653B\u6B21\u5E8F", { initiative: initiative2 });
  if (!refreshOutcome(state)) settleTurn(state);
  return state;
}
function initiativeOrder(state, rollFor) {
  return living(state).map((unit) => {
    const roll = rollFor(unit), agility = effectiveStat(state, unit, "agi") + dsl.check(state, unit, "initiativeAgility");
    const agilityPercent = Number(unit.initiativePercent ?? 0);
    const attackInit = Array.isArray(unit.attackInit) ? unit.attackInit : [];
    const actionInit = Array.isArray(unit.actionInit) ? unit.actionInit : [];
    const flatInit = dsl.stat(state, unit, "initiative", Number(unit.flatInitiative ?? 0) + dsl.check(state, unit, "iniBonus"));
    const total = initiative({ agility, percent: agilityPercent, d20: roll, attack: attackInit, action: actionInit, flat: flatInit });
    return { unitId: unit.id, roll, agility, agilityPercent, attackInit: Math.max(0, ...attackInit, 0), actionInit: Math.max(0, ...actionInit, 0), flatInit, total };
  }).sort((a, b) => b.total - a.total || b.agility - a.agility || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}
function refreshOpeningInitiative(state) {
  const [entry, turn] = state.logs;
  if (state.round !== 1 || state.turn !== 0 || state.logs.length !== 2 || entry.type !== "initiative" || turn.type !== "turn") return;
  const previous = entry.detail.initiative;
  if (!Array.isArray(previous) || !currentUnit(state)) return;
  const rolls = new Map(previous.filter((row) => row && Number.isInteger(row.roll)).map((row) => [row.unitId, row.roll]));
  if (living(state).some((unit) => !rolls.has(unit.id) || changes(unit, "skip"))) return;
  const initiative2 = initiativeOrder(state, (unit) => rolls.get(unit.id));
  if (initiative2.every((row, i) => row.unitId === previous[i]?.unitId && row.total === previous[i]?.total)) return;
  currentUnit(state).ap = 0;
  state.order = initiative2.map((row) => row.unitId);
  entry.detail.initiative = initiative2;
  const first = currentUnit(state);
  first.ap = 2;
  state.logs.pop();
  record(state, first, "turn", `${first.name}\u5F00\u59CB\u56DE\u5408`, { turn: 0 });
}
var locateUnit = (state, { x, y }) => unitAt(state, x, y);
var locateCover = (state, { x, y }) => coverAt(state, x, y);
var emptyGround = (state, at) => isGround(state, at) && !locateUnit(state, at) && !locateCover(state, at);
var allCells = (state) => state.grid.flatMap((row, y) => row.map((_, x) => pos(x, y)));
function spawnEffectUnit(state, actor, original, center, scale, corpse) {
  if (!original || state.order.length >= 200 || Object.keys(state.units).length >= 200) return false;
  const at = allCells(state).filter((cell) => emptyGround(state, cell)).sort((a, b) => distance3D(state, center, a) - distance3D(state, center, b))[0];
  if (!at) return false;
  let index = 1;
  while (Object.hasOwn(state.units, `summon-${index}`)) index++;
  const id3 = `summon-${index}`;
  const scaled = (value, min = 0) => Math.max(min, Math.round(value * scale));
  const maxHp = scaled(original.maxHp, 1), maxMp = scaled(original.maxMp), maxSp = scaled(original.maxSp);
  const unit = {
    id: id3,
    name: original.name,
    team: actor.team,
    ...at,
    facing: [...actor.facing],
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    sp: maxSp,
    maxSp,
    ap: 0,
    used: { attack: 0, action: 0 },
    stats: Object.fromEntries(Object.entries(original.stats).map(([stat2, value]) => [stat2, Math.round(value * scale)])),
    armor: scaled(original.armor),
    size: original.size,
    move: scaled(original.move, 1),
    weapon: null,
    gear: [],
    skills: [...original.skills],
    statuses: {},
    ...original.tier ? { tier: original.tier } : {},
    ...corpse ? { creatureType: "undead", corpseOf: original.id } : {}
  };
  state.units[id3] = unit;
  state.order.push(id3);
  if (corpse) original.corpseConsumed = true;
  record(state, actor, corpse ? "raise_dead" : "spawn", `${unit.name}${corpse ? "\u590D\u751F" : "\u767B\u573A"}`, { unitId: id3, ...corpse ? { corpseId: original.id } : {} });
  return true;
}
var dsl = createEffectEngine({
  equipped,
  living,
  resourcePool,
  distance: distance3D,
  die: randomDie,
  random: randomUnit,
  counter: changeCounter,
  damage: damageTarget,
  loseHP,
  heal: restoreHP,
  grant: grantStatus,
  record,
  saved: effectSaved,
  removeStatus,
  knockback,
  teleport: teleportBehind,
  statusModifier: changes,
  blockRestore: (unit) => changes(unit, "blockResourceRestore"),
  weaponType: (state, actor) => {
    const weapon = weaponInfo(state, actor).template;
    return weapon.weaponType ?? weapon.weaponClass ?? weapon.rangeType;
  },
  findExpression: (state, ref2) => [...values2(state.equipment), ...values2(state.skills)].flatMap((t) => t.effects).find((e) => isExpression(e) && e.id === ref2),
  raise: (state, actor, target2, scale) => corpses(state).includes(target2) && spawnEffectUnit(state, actor, target2, target2, scale, true),
  summon: (state, actor, id3, at, scale, count) => {
    let spawned = false;
    for (let i = 0; i < count; i++) spawned = spawnEffectUnit(state, actor, tableEntry(state.summonTemplates, id3) ?? tableEntry(state.units, id3), at, scale, false) || spawned;
    return spawned;
  }
});
var equippedActiveSkills = (state, unit) => dsl.activeSkills(state, unit);
function syncEquipmentEffects(state) {
  for (const unit of living(state)) dispatchEffect(state, unit, "on_equip");
}
function reachable(state, type = "move", unit = currentUnit(state), distanceLimit = void 0) {
  if (!alive(unit) || changes(unit, "rooted") || changes(unit, "skip")) return [];
  const limit = distanceLimit ?? Math.max(1, unit.move + changes(unit, "movement")) * (type === "sprint" ? 2 : 1);
  const routes = movementOptions(state, unit, limit);
  const sources = type === "disengage" ? [] : opportunitySources(state, unit).filter((source) => canReact(state, source, unit));
  const routeCell = ({ cost, ...cell }, opportunities = []) => ({ ...cell, steps: cost, opportunities });
  if (!sources.length || !routes.length) return routes.map((route) => routeCell(route));
  const threatCache = /* @__PURE__ */ new Map();
  const threatAt = (at) => {
    const id3 = key2(at.x, at.y);
    if (!threatCache.has(id3)) threatCache.set(id3, sources.filter((source) => threatens(state, source, unit, at)));
    return threatCache.get(id3);
  };
  const exits = (from, to) => threatAt(from).filter((source) => !threatAt(to).includes(source));
  const safe = new Map(movementOptions(state, unit, limit, {
    allowsStep: (from, to) => !exits(from, to).length
  }).map((route) => [key2(route.x, route.y), route]));
  return routes.map((route) => {
    const alternate = safe.get(key2(route.x, route.y));
    if (alternate) return routeCell(alternate);
    const spent = /* @__PURE__ */ new Set(), opportunities = [];
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
function paymentError(state, unit, ap, slot, template = {}) {
  if (unit.ap < ap) return `\u9700\u8981 ${ap} AP`;
  if (state.mode === "split" && (ap === 2 ? unit.used.attack || unit.used.action : unit.used[slot])) {
    return "\u672C\u56DE\u5408\u5BF9\u5E94\u7684\u884C\u52A8\u69FD\u5DF2\u4F7F\u7528";
  }
  if (unit.mp < (template.mp ?? 0)) return "\u9B54\u529B\u4E0D\u8DB3";
  if (unit.sp < (template.sp ?? 0)) return "\u4F53\u529B\u4E0D\u8DB3";
  if (template.resourceCost && (resourcePool(state, unit, template.resourceCost.resource)?.amount ?? 0) < template.resourceCost.amount) return "\u88C5\u5907\u8D44\u6E90\u4E0D\u8DB3";
  if (findNode(template, "restoreResource") && changes(unit, "blockResourceRestore")) return "\u5F53\u524D\u72B6\u6001\u7981\u6B62\u88C5\u5907\u8D44\u6E90\u6062\u590D";
  return null;
}
var normalAttack = Object.freeze({ name: "\u5F92\u624B", range: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: "str", type: "physical" } });
var findNode = (template, kind, predicate = () => true) => (template?.effects ?? []).flatMap((expr) => [...effectNodes(expr.effects, true)]).find((node3) => node3.kind === kind && predicate(node3));
var shieldBashEffects = [expression("shield-bash-hit", "on_hit", "hitTarget", [
  { kind: "knockback", distance: 1 },
  { kind: "grantStatus", statusId: "stun", turns: 1 }
])];
var isMelee = (template) => template.rangeType !== "ranged" && !template.ranged && template.weaponClass !== "ranged" && (template.range ?? 1.5) <= 2;
function weaponInfo(state, unit) {
  const mainId = unit.mainHand ?? unit.weapon;
  const candidate = equipmentFor(state, mainId);
  const weapon = candidate.template?.boundTo && candidate.template.boundTo !== unit.id ? equipmentFor(state, null) : candidate;
  const pools = resourceDefinitions(weapon.template, true);
  const ammo = pools.find((node3) => node3.reloadable);
  const ammoCount = ammo ? resourcePool(state, unit, ammo.resource, weapon.instance)?.amount : null;
  const infiniteAmmo = Boolean(ammo && changes(unit, "infiniteAmmo"));
  const scale = findNode(weapon.template ?? normalAttack, "multiplyDamage", (node3) => node3.local && node3.resourceScale);
  const souls = scale ? resourcePool(state, unit, scale.resourceScale.resource, weapon.instance)?.amount ?? 0 : 0;
  const offHand = equipmentFor(state, unit.offHand);
  const stance = unit.stance ?? stanceFor({ mainHand: weapon.template, offHand: offHand.template, shield: equipmentFor(state, unit.shield).template });
  return {
    ...weapon,
    ammo,
    ammoCount,
    infiniteAmmo,
    souls,
    offHand,
    stance,
    template: weapon.template ?? normalAttack,
    soulMultiplier: 1 + souls * (scale?.resourceScale.perUnit ?? 0)
  };
}
function reaches(state, actor, at, template, ammo) {
  const dz = elevation(state, actor) - elevation(state, at);
  const melee = isMelee(template) && !ammo;
  const range = (template.range ?? 1.5) + (melee || !dz ? 0 : dz > 0 ? ammo ? dsl.check(state, actor, "highGroundRange", { weaponId: actor.mainHand ?? actor.weapon, highGround: true }) : 1 : -1);
  return { distance: distance3D(state, actor, at), dz, range: Math.max(0, range), melee };
}
function validReach(state, actor, at, template, ammo) {
  const geometry = reaches(state, actor, at, template, ammo);
  return isGround(state, at) && geometry.distance <= geometry.range + 1e-9 && hasLOS(state, actor, at);
}
function visibleEnemy(state, actor, target2) {
  return target2.team !== actor.team && (!changes(target2, "hidden") || gridDistance(actor, target2) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target2)) <= 1);
}
function tauntFor(state, actor, template, ammo) {
  const id3 = changes(actor, "taunted") ? statusOf(actor, "taunt")?.sourceUnitId : null;
  const taunter = tableEntry(state.units, id3);
  const teleport = findNode(template, "teleportBackstab");
  if (!alive(taunter) || !visibleEnemy(state, actor, taunter) || !validReach(state, actor, taunter, template, ammo)) return null;
  if (teleport && (!backCell(state, taunter) || changes(actor, "rooted"))) return null;
  return taunter;
}
function opportunitySources(state, mover) {
  return living(state).filter((unit) => unit.team !== mover.team && unit.reactionAvailable !== false && !changes(unit, "skip")).map((unit) => ({ unit, weapon: weaponInfo(state, unit) })).filter(({ weapon }) => !weapon.ammo && isMelee(weapon.template) && weapon.template.damage != null);
}
function canReact(state, { unit, weapon }, mover) {
  if (!alive(unit) || unit.reactionAvailable === false || changes(unit, "skip")) return false;
  const taunter = tauntFor(state, unit, weapon.template);
  return !taunter || taunter.id === mover.id;
}
function threatens(state, source, mover, at) {
  return visibleEnemy(state, source.unit, { ...mover, x: at.x, y: at.y }) && validReach(state, source.unit, at, source.weapon.template);
}
var opportunityDetail = (source, from, to) => ({
  unitId: source.id,
  name: source.name,
  from: pos(from.x, from.y),
  to: pos(to.x, to.y)
});
function area(state, actor, center, template, ammo) {
  return aoeCells(state, actor, center, { ...template, range: (at) => reaches(state, actor, at, template, ammo).range });
}
function selectionAllows(template, actor, unit) {
  if (!unit) return false;
  switch (template.target ?? "enemy") {
    case "enemy":
      return actor.team !== unit.team;
    case "ally":
      return actor.team === unit.team;
    case "self":
      return actor.id === unit.id;
    default:
      return true;
  }
}
function backCell(state, target2) {
  const [dx, dy] = target2.facing ?? [1, 0];
  const at = pos(target2.x - dx, target2.y - dy);
  return emptyGround(state, at) && passableEdge(state, target2, at) ? at : null;
}
function diceFormula(state, spec, actor) {
  if (typeof spec === "number") return { count: 0, sides: 0, bonus: spec };
  const count = spec?.count ?? 1, sides = spec?.sides ?? 1;
  return { count, sides, bonus: Math.floor((spec?.bonus ?? 0) + effectiveStat(state, actor, spec?.stat) * (spec?.multiplier ?? 1)) };
}
function diceBounds(dice3, critical = false) {
  const count = critical ? dice3.count * 2 : dice3.count;
  return [Math.max(0, count + dice3.bonus), Math.max(0, count * dice3.sides + dice3.bonus)];
}
var oddsCache = /* @__PURE__ */ new Map();
function diceAverage(dice3, map, critical = false) {
  const count = critical ? dice3.count * 2 : dice3.count;
  const key3 = `${count}d${dice3.sides}`;
  let probabilities = oddsCache.get(key3);
  if (!probabilities) {
    probabilities = [1];
    for (let die = 0; die < count; die++) {
      const next = Array(probabilities.length + dice3.sides).fill(0);
      let window2 = 0;
      for (let i = 1; i < next.length; i++) {
        window2 += (probabilities[i - 1] ?? 0) - (probabilities[i - dice3.sides - 1] ?? 0);
        next[i] = Math.max(0, window2 / dice3.sides);
      }
      probabilities = next;
    }
    if (oddsCache.size >= 64) oddsCache.delete(oddsCache.keys().next().value);
    oddsCache.set(key3, probabilities);
  }
  return probabilities.reduce((sum, probability2, raw) => sum + probability2 * map(Math.max(0, raw + dice3.bonus)), 0);
}
function diceRoll(state, formula, critical = false) {
  const count = critical ? formula.count * 2 : formula.count;
  const { rng, rolls, total } = rollDice(state.rng, count, formula.sides);
  state.rng = rng;
  return { rolls, ...formula, value: Math.max(0, total + formula.bonus) };
}
var fixedDamageOf = (template) => findNode(template, "modifyDamageBase", (node3) => node3.unscaled);
var hasStrikeDamage = (template) => template.damage != null || Boolean(fixedDamageOf(template));
var flatDice = (value) => ({ rolls: [], count: 0, sides: 0, bonus: value, value });
function targetProfile(state, actor, target2, at, template, context = {}) {
  const { weapon, origin = actor, teleport, cover = false } = context;
  const geometry = reaches(state, origin, at, template, weapon?.ammo);
  const arrow = Boolean(weapon?.ammo);
  const arc = target2 && !cover ? facingArc(target2, origin) : "front";
  const backstab = !cover && arc !== "front" && geometry.melee;
  const strike = {
    target: target2,
    melee: geometry.melee,
    arrow,
    backstab,
    highGround: geometry.dz > 0,
    weaponId: weapon?.instance?.id,
    actionType: weapon ? "attack" : "skill",
    school: template.school,
    damageType: template.damage?.type,
    entries: weapon ? [] : template.entry ? [template.entry] : dsl.skillExpressions(template, context.skillId ?? "preview")
  };
  const nodes = dsl.passiveNodes(state, actor, strike, strike.entries);
  const hasNode = (kind, mode) => nodes.some((node3) => node3.kind === kind && (!mode || node3.mode === mode));
  const guaranteeCrit = hasStrikeDamage(template) && Boolean(changes(actor, "guaranteed_crit") || hasNode("forceOutcome", "crit"));
  const guaranteeHit = hasStrikeDamage(template) && Boolean(guaranteeCrit || changes(actor, "guaranteed_hit") || hasNode("forceOutcome", "hit"));
  const tierUp = hasStrikeDamage(template) && hasNode("upgradeHitTier");
  const dodge = cover ? 0 : dsl.stat(state, target2, "dodge", dsl.check(state, target2, "dodgeBonus", { target: actor }) + dsl.check(state, target2, "dodgeAgility", { target: actor }) + changes(target2, "dodgeBonus"), { target: actor });
  const high = Math.sign(geometry.dz) * 2 + (geometry.dz > 0 ? dsl.check(state, actor, "highGroundAccuracy", strike) : 0);
  const flanked = target2 && !cover ? isFlanked(state, origin, target2) : false;
  const protectedBy = target2 && !cover && !geometry.melee ? coverBetween(state, origin, target2) : null;
  const penalty = protectedBy?.cover ?? 0;
  const size = cover ? 0 : typeof target2?.size === "number" ? Math.max(0, target2.size - 1) : target2?.size === "large" ? 2 : target2?.size === "small" ? -1 : 0;
  const sizeModifier = cover || !target2 ? 0 : sizeHitModifier(actor, target2);
  const distanceModifier = distanceTier(geometry.distance).hit;
  const weaponRangeModifier = distanceTier(Math.max(geometry.distance, geometry.range)).range;
  const stance = weapon?.stance ?? actor.stance ?? "unarmed";
  const rules = stanceRules(stance);
  const rangedDistance = weapon && !geometry.melee && distanceModifier < 0 ? rules.rangedDistancePenalty ?? distanceModifier : distanceModifier;
  const closeRange = rules.closeRange && geometry.melee && geometry.distance <= 2 ? 4 : rangedDistance;
  const accuracy = dsl.stat(state, actor, "accuracy", (template.accuracy ?? 0) + (state.ruleset === "sandbox" ? effectiveStat(state, actor, geometry.melee ? "str" : "agi") : 0) + high + size + closeRange + (state.ruleset === "sandbox" ? 0 : weaponRangeModifier) + changes(actor, "accuracy") + (cover || !target2 ? 0 : changes(target2, "incomingAccuracy")) + (flanked ? 2 : 0) - penalty + dsl.check(state, actor, "accuracyBonus", strike), strike) - dodge;
  const explicitEvasion = changes(target2, "evasion") + changes(target2, "incomingAccuracy");
  const equipmentDefense = gearFor(state, target2).reduce((d, g) => d + (g.template?.defense ?? 0), 0) + (target2.shield ? equipmentFor(state, target2.shield).template?.defense ?? 0 : 0);
  const defense = cover ? 8 : state.ruleset === "sandbox" ? 10 + Math.floor(effectiveStat(state, target2, "agi") / 2) + equipmentDefense : 10 + explicitEvasion + equipmentDefense;
  const advantages = changes(actor, "advantage") + dsl.check(state, actor, "advantage", strike) + Number(Boolean(teleport)) + (template.advantage ?? 0);
  const disadvantages = changes(actor, "disadvantage") + (template.disadvantage ?? 0);
  const advantage = Math.sign(advantages - disadvantages);
  const saveStat = !cover && target2 ? template.save : null;
  const saveDC = saveStat ? resolveDC(state, actor, template.saveDC ?? 12 + Math.floor(effectiveStat(state, actor, "int") / 2)) : null;
  const saveBonus = saveStat ? effectiveStat(state, target2, saveStat) : 0;
  const saveChance2 = saveStat ? saveChance(saveDC, saveBonus) : 0;
  const automatic = !weapon && (!template.damage || saveStat || template.autoHit);
  const hitChance2 = automatic || guaranteeHit ? 1 : tierUp || dodge || dsl.check(state, actor, "accuracyBonus", strike) ? saveChance(4, accuracy, advantages, disadvantages) - (accuracy + 1 >= 4 ? 1 - saveChance(2, 0, advantages, disadvantages) : 0) : hitChance(defense, accuracy, advantages, disadvantages);
  const critChance2 = saveStat ? 0 : guaranteeCrit ? 1 : automatic ? 0 : critChance(advantages, disadvantages);
  const offHandMultiplier = weapon?.stance === "dual_wield" && weapon.offHand?.template?.damage ? 1.5 : 1;
  const intentSpec = INTENTS[context.intent ?? "normal"] ?? INTENTS.normal;
  const multiplier = offHandMultiplier * (1 + changes(actor, "damageBonus")) * Math.max(0, 1 + changes(actor, "attackPercent")) * (teleport ? 1 + (teleport.bonusMultiplier ?? 0.5) : 1);
  const fixed = nodes.find((node3) => node3.kind === "modifyDamageBase");
  const fixedDamage = fixed?.unscaled ? fixed : null;
  const fixedAttack = fixed?.unscaled ? null : fixed;
  const damageType2 = fixedDamage?.damageType ?? template.damage?.type ?? "physical";
  const tierPower = { 1: 2, 2: 2.8, 3: 4, 4: 8, 5: 15, 6: 35, 7: 80 }[actor.tier ?? 1] ?? 2;
  const attributeBase = () => state.ruleset === "protocol" ? effectiveStat(state, actor, template.damage.stat ?? (geometry.melee ? "str" : "int")) * 10 * tierPower : Math.floor(effectiveStat(state, actor, template.damage.stat) * (template.damage.multiplier ?? 1));
  const flatAttack = fixedAttack ? Math.max(0, fixedAttack.value + (fixedAttack.ignoreAttributes === false ? attributeBase() : 0)) : null;
  const protocolInitial = fixedDamage?.value ?? flatAttack ?? (state.ruleset === "protocol" && template.damage ? attributeBase() + Number(template.power ?? 20) + Number(weapon?.template?.attack ?? 0) : null);
  const armorPierce = { flat: dsl.stat(state, actor, "armorPierce", template.armorPierce ?? 0, { ...strike, damageType: damageType2 }), percent: rules.armorPenetration ?? 0 };
  const recipient = cover || !hasStrikeDamage(template) ? target2 : guardFor(state, target2) ?? target2;
  const reduction = cover ? { multiplier: 1, armorMultiplier: fixedDamage || fixedAttack ? 1 : void 0, armor: target2.armor ?? 0 } : mitigation(state, recipient, damageType2, true, armorPierce, { attacker: actor, intercepting: recipient !== target2 });
  const shield = cover ? null : statusOf(recipient, "shield");
  const absorb = shield ? statusAmount(shield) : 0;
  const dice3 = fixedDamage ? flatDice(fixedDamage.value) : template.damage == null ? null : diceFormula(state, template.damage, actor);
  const shown = (raw, factor = 1) => Math.max(0, Math.floor(Math.floor(dsl.stat(state, actor, "damage", raw * (fixedDamage ? 1 : multiplier) * factor * dsl.damageFactor(state, actor, { ...strike, damageType: damageType2 }), { ...strike, damageType: damageType2 })) * reduction.multiplier * reduction.armorMultiplier * finalDamageMultiplier(actor) * (fixedDamage ? 1 - (reduction.attributeReduction ?? 0) : 1)) - absorb);
  const flat = fixedAttack || fixedDamage;
  const bounds = (critical = false, factor = 1) => (flat ? [protocolInitial, protocolInitial] : diceBounds(dice3, critical)).map((n) => shown(n, factor));
  const average = (critical = false, factor = 1) => flat ? shown(protocolInitial, factor) : diceAverage(dice3, (n) => shown(n, factor), critical);
  const damage = dice3 ? protocolInitial == null ? bounds() : [shown(protocolInitial), shown(protocolInitial)] : [0, 0];
  const criticalDamage = dice3 && critChance2 > 0 ? bounds(true) : null;
  const savedDamage = dice3 && saveStat ? bounds(false, 0.5) : null;
  const expectedDamage = !dice3 ? 0 : Math.max(0, hitChance2 - critChance2 - saveChance2) * average() + (criticalDamage ? critChance2 * average(true) : 0) + (savedDamage ? saveChance2 * average(false, 0.5) : 0);
  const expectedD20 = saveStat ? 10.5 : automatic ? null : advantage > 0 ? 13.825 : advantage < 0 ? 7.175 : 10.5;
  const combo = !cover && weapon && (template.effects ?? []).find((expr) => expr.trigger === "on_hit" && [...effectNodes(expr.effects, true)].some((node3) => node3.kind === "grantStatus" && node3.statusId === "bleed"));
  return {
    id: target2.id,
    targetId: target2.id,
    name: target2.name,
    x: at.x,
    y: at.y,
    ...geometry,
    recipientId: recipient.id,
    arc,
    backstab: Boolean(backstab),
    flanked,
    accuracy,
    defense,
    highGround: high,
    sizeModifier,
    distanceModifier: closeRange,
    weaponRangeModifier,
    stance,
    stanceRules: rules,
    accuracySources: { explicit: template.accuracy ?? 0, highGround: high, size: size + sizeModifier, distance: closeRange, weaponRange: weaponRangeModifier, status: changes(actor, "accuracy") },
    intent: context.intent ?? "normal",
    intentDifficulty: intentSpec.difficulty,
    intentMultiplier: intentSpec.multiplier,
    cover: penalty,
    coverId: protectedBy?.id ?? null,
    advantage,
    advantages,
    disadvantages,
    hitChance: hitChance2,
    critChance: critChance2,
    expectedD20,
    automatic: Boolean(automatic),
    guaranteeHit,
    guaranteeCrit,
    tierUp,
    arrow,
    saveStat,
    saveDC,
    saveBonus,
    saveChance: saveChance2,
    multiplier,
    damageType: damageType2,
    armorPierce,
    protocolInitial,
    coreBonus: dsl.check(state, actor, "coreBonus", strike),
    dodgeBonus: dodge,
    damageMultiplier: dsl.stat(state, actor, "damage", multiplier * dsl.damageFactor(state, actor, { ...strike, damageType: damageType2 }), { ...strike, damageType: damageType2 }),
    offHand: Boolean(weapon?.offHand?.template),
    armor: reduction.armor,
    damagePipeline: reduction.armorMultiplier,
    shield: absorb,
    damage,
    damageMin: damage[0],
    damageMax: damage[1],
    fixedDamage: Boolean(fixedDamage),
    criticalDamage,
    savedDamage,
    expectedDamage,
    dice: dice3,
    combo: combo ? {
      bleedStacks: [...effectNodes(combo.effects, true)].find((n) => n.statusId === "bleed").stacks ?? 1,
      bonusDamage: [...effectNodes(combo.effects, true)].find((n) => n.kind === "damage")?.amount ?? 0,
      on: backstab ? "hit" : "critical"
    } : null
  };
}
var ACTIONS = Object.freeze({
  move: { ap: 1, slot: "action" },
  sprint: { ap: 2, slot: "action" },
  disengage: { ap: 1, slot: "action" },
  attack: { ap: 1, slot: "attack" },
  reload: { ap: 1, slot: "action" },
  brace: { ap: 1, slot: "action" },
  block: { ap: 1, slot: "action" },
  shield_bash: { ap: 1, slot: "attack", sp: 2 },
  use_item: { ap: 0, slot: null },
  charge: { ap: 1, slot: "action" },
  lock_on: { ap: 1, slot: "action" },
  scan: { ap: 1, slot: "action" },
  grapple: { ap: 1, slot: "attack" },
  disarm: { ap: 1, slot: "attack" },
  trip: { ap: 1, slot: "attack" },
  push: { ap: 1, slot: "attack" },
  flee: { ap: 1, slot: "action" },
  detour: { ap: 1, slot: "action" },
  interact: { ap: 1, slot: "action" },
  end: { ap: 0, slot: null }
});
var movementNames = Object.freeze({ move: "\u79FB\u52A8", sprint: "\u75BE\u8DD1", disengage: "\u64A4\u79BB" });
var isMovement = (type) => Object.hasOwn(movementNames, type);
var needsTarget = (type) => isMovement(type) || ["attack", "skill", "shield_bash", "interact", "lock_on", "grapple", "disarm", "trip", "push"].includes(type);
var fail = (error2, extra = {}) => ({ ok: false, error: error2, ...extra });
var healMultiplier = (state, actor) => dsl.stat(state, actor, "healing", 1, { actionType: "skill" });
var healShieldRatio = (state, actor) => equipped(state, actor).reduce((sum, item) => sum + (findNode(item.template, "shield", (node3) => node3.percentOfHealing != null)?.percentOfHealing ?? 0), 0);
function inInteractionRange(state, actor, at) {
  return gridDistance(actor, at) <= 1 && Math.abs(elevation(state, actor) - elevation(state, at)) <= 1 && hasLOS(state, actor, at);
}
function nearbyCovers(state, at) {
  return values2(state.covers).filter((c) => c.hp > 0 && inInteractionRange(state, at, c)).sort(byId2);
}
function canExecute(state, actor, target2, effect, nonLethal) {
  return alive(target2) && target2.team !== actor.team && visibleEnemy(state, actor, target2) && (effect.strict ? target2.hp / target2.maxHp < effect.threshold : target2.hp / target2.maxHp <= effect.threshold) && !nonLethal && !target2.nonLethal && !changes(target2, "preserveLife") && (!effect.requiresPool || Boolean(resourcePool(state, actor, effect.requiresPool)));
}
function usableTiles(state, actor, template, weapon, nonLethal) {
  const execute = findNode(template, "execute", (node3) => node3.requiresPool);
  return allCells(state).filter((at) => validReach(state, actor, at, template, weapon?.ammo) && (!execute || canExecute(state, actor, locateUnit(state, at), execute, nonLethal)) && !((template.shape === "line" || template.shape === "cone" || template.shape === "fan") && sameCell(actor, at)));
}
function shapeTargets(state, actor, cells, template) {
  const keys = new Set(cells.map((at) => key2(at.x, at.y)));
  return living(state).filter((unit) => keys.has(key2(unit.x, unit.y)) && selectionAllows(template, actor, unit));
}
function preview(state, action) {
  if (state.outcome) return fail("\u6218\u6597\u5DF2\u7ECF\u7ED3\u675F");
  const unit = currentUnit(state);
  if (!alive(unit) && action?.type !== "end") return fail("\u5F53\u524D\u5355\u4F4D\u4E0D\u80FD\u884C\u52A8");
  if (!action || typeof action !== "object" || Array.isArray(action)) return fail("\u52A8\u4F5C\u683C\u5F0F\u9519\u8BEF");
  const { type, x, y, skillId } = action;
  if (!Object.keys(action).every((field) => ["type", "x", "y", "skillId", "bonusDice", "intent", "nonLethal", "maneuver"].includes(field))) return fail("\u52A8\u4F5C\u542B\u672A\u77E5\u5B57\u6BB5");
  if (action.bonusDice !== void 0 && (!Number.isInteger(action.bonusDice) || action.bonusDice < 0 || action.bonusDice > Math.min(2, unit?.bonusDice ?? 0))) return fail("\u5956\u52B1\u9AB0\u50A8\u5907\u4E0D\u8DB3");
  if (action.intent !== void 0 && !["normal", "function", "core", "kill", "concept"].includes(action.intent)) return fail("\u610F\u56FE\u7C7B\u578B\u65E0\u6548");
  const equipmentSkill = type === "skill" ? new Map(equippedActiveSkills(state, unit)).get(skillId) : null;
  const skill2 = type === "skill" ? equipmentSkill ?? tableEntry(state.skills, skillId) : null;
  if (type === "skill" && (!skill2 || !equipmentSkill && !unit.skills.includes(skillId))) return fail("\u5355\u4F4D\u6CA1\u6709\u6B64\u6280\u80FD");
  if (equipmentSkill && !dsl.available(state, unit, equipmentSkill.entry)) return fail("\u88C5\u5907\u6280\u80FD\u6B21\u6570\u5DF2\u7528\u5C3D\u6216\u51B7\u5374\u4E2D");
  if (skill2 && !equipmentSkill) {
    const entries2 = dsl.skillExpressions(skill2, skillId);
    if (entries2.length && entries2.length === skill2.effects.length && !skill2.damage && !skill2.heal && !entries2.some((entry) => dsl.available(state, unit, entry))) return fail("\u6280\u80FD\u6B21\u6570\u5DF2\u7528\u5C3D\u6216\u51B7\u5374\u4E2D");
  }
  const cost = skill2 ?? tableEntry(ACTIONS, type);
  if (!cost) return fail("\u672A\u77E5\u52A8\u4F5C");
  const aimed = needsTarget(type);
  const unplaced = x === void 0 && y === void 0;
  if (type !== "skill" && skillId !== void 0 || !unplaced && !aimed) return fail("\u52A8\u4F5C\u5E26\u6709\u4E0D\u9002\u7528\u7684\u53C2\u6570");
  if (!unplaced && (!Number.isInteger(x) || !Number.isInteger(y) || !cellAt(state, x, y))) return fail("\u76EE\u6807\u5750\u6807\u8D85\u51FA\u68CB\u76D8");
  const { ap, slot } = cost;
  const common = { ok: true, ap, cost: ap, slot, mp: cost.mp ?? 0, sp: cost.sp ?? 0 };
  if (type === "end") return common;
  if (changes(unit, "skip")) return fail("\u5F53\u524D\u5355\u4F4D\u53D7\u63A7\u5236\uFF0C\u53EA\u80FD\u7ED3\u675F\u56DE\u5408");
  const cannotPay = paymentError(state, unit, ap, slot, cost);
  if (cannotPay) return fail(cannotPay, { ap });
  const center = unplaced ? void 0 : pos(x, y);
  const weapon = weaponInfo(state, unit);
  if (type === "shield_bash" && !unit.shield) return fail("\u6CA1\u6709\u76FE\u724C");
  if (type === "reload") {
    if (!weapon.ammo || weapon.infiniteAmmo) return fail("\u5F53\u524D\u6B66\u5668\u4E0D\u9700\u8981\u88C5\u586B");
    if (weapon.ammoCount >= weapon.ammo.cap) return fail("\u5F39\u4ED3\u5DF2\u6EE1");
    return { ...common, ammo: weapon.ammoCount, capacity: weapon.ammo.cap };
  }
  if (type === "block") {
    if (stanceFor({ mainHand: weapon.template, offHand: weapon.offHand?.template, shield: equipmentFor(state, unit.shield).template }) !== "sword_shield") return fail("\u53EA\u6709\u5251\u76FE\u59FF\u6001\u53EF\u683C\u6321");
    return { ...common, name: "\u683C\u6321", reduction: unit.blockMode === "heavy" ? 0.45 : 0.25, turns: 1 };
  }
  if (type === "brace") {
    const [nearbyCover] = nearbyCovers(state, unit);
    return {
      ...common,
      name: "\u67B6\u52BF\u9632\u5FA1",
      coverId: nearbyCover?.id ?? null,
      reduction: STATUSES.guarded.modifiers.reduction,
      turns: nearbyCover ? 2 : 1
    };
  }
  if (type === "use_item") {
    const item = equipmentFor(state, unit.offHand);
    if (unit.stance !== "attunement" || item.template?.kind !== "consumable") return fail("\u53EA\u6709\u540C\u8C03\u59FF\u6001\u53EF\u4EE5\u514D\u8D39\u4F7F\u7528\u526F\u624B\u9053\u5177");
    if ((unit.attunementCharges ?? 0) <= 0) return fail("\u540C\u8C03\u9053\u5177\u6B21\u6570\u5DF2\u7528\u5C3D");
    return { ...common, name: `\u4F7F\u7528${item.template.name}`, maneuver: "use_item", itemId: unit.offHand };
  }
  if (type === "charge") return { ...common, name: "\u84C4\u529B", maneuver: "charge" };
  if (type === "scan") return { ...common, name: "\u63A2\u5BDF", maneuver: "scan" };
  if (type === "flee") return { ...common, name: "\u9003\u8DD1", maneuver: "flee" };
  if (type === "detour") return { ...common, name: "\u7ED5\u884C", maneuver: "detour" };
  if (type === "lock_on") {
    const target2 = locateUnit(state, center);
    if (!target2 || target2.team === unit.team) return fail("\u5B9A\u4F4D\u5FC5\u987B\u6307\u5B9A\u654C\u65B9\u5355\u4F4D");
    return { ...common, name: "\u5B9A\u4F4D", maneuver: "lock_on", targetId: target2.id };
  }
  if (["grapple", "disarm", "trip", "push"].includes(type)) {
    const target2 = locateUnit(state, center);
    if (!target2 || target2.team === unit.team) return fail("\u6218\u672F\u5BF9\u6297\u5FC5\u987B\u6307\u5B9A\u654C\u65B9\u5355\u4F4D");
    if (gridDistance(unit, target2) > 1 || !hasLOS(state, unit, target2)) return fail("\u6218\u672F\u5BF9\u6297\u9700\u8981\u8D34\u8EAB\u4E14\u89C6\u7EBF\u7545\u901A");
    return { ...common, name: { grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E" }[type], maneuver: type, targetId: target2.id };
  }
  if (isMovement(type)) {
    if (changes(unit, "rooted")) return fail("\u5B9A\u8EAB\u65F6\u4E0D\u80FD\u79FB\u52A8");
    const cells2 = reachable(state, type, unit);
    if (unplaced) return { ...common, cells: cells2 };
    const choice = cells2.find((at) => sameCell(at, center));
    if (!choice) return fail("\u65E0\u6CD5\u5230\u8FBE\uFF1A\u8DDD\u79BB\u3001\u5360\u4F4D\u3001\u5899\u4F53\u6216\u9661\u5D16\u963B\u6321", { cells: cells2 });
    return {
      ...common,
      cells: cells2,
      path: choice.path,
      steps: choice.steps,
      opportunities: choice.opportunities,
      dz: elevation(state, center) - elevation(state, unit)
    };
  }
  if (type === "interact") {
    const objects = values2(state.interactives).filter((v) => !v.spent && inInteractionRange(state, unit, v)).sort(byId2);
    if (unplaced) return { ...common, cells: objects.map((v) => pos(v.x, v.y)) };
    const item = objects.find((v) => sameCell(v, center));
    if (!item) return fail("\u6CA1\u6709\u53EF\u7528\u7684\u90BB\u8FD1\u4E92\u52A8\u70B9");
    const cells2 = item.kind === "barrel" ? area(state, unit, center, { shape: "circle", range: 2, radius: 1.5 }) : [center];
    const keyset = new Set(cells2.map((at) => key2(at.x, at.y)));
    const targets2 = item.kind === "altar" ? [{ id: unit.id, targetId: unit.id, name: unit.name, x: unit.x, y: unit.y, heal: [8, 8] }] : living(state).filter((u) => keyset.has(key2(u.x, u.y))).map((u) => {
      const guard = guardFor(state, u) ?? u;
      const hit = mitigation(state, guard, "energy", true, 0);
      const shield = statusOf(guard, "shield");
      const damage = Math.max(0, Math.floor(12 * hit.multiplier) - hit.armor - (shield ? statusAmount(shield) : 0));
      return { id: u.id, targetId: u.id, recipientId: guard.id, name: u.name, x: u.x, y: u.y, damage: [damage, damage], expectedDamage: damage, hitChance: 1 };
    });
    return { ...common, interactiveId: item.id, kind: item.kind, cells: cells2, targets: targets2, center };
  }
  const attack = type === "attack" || type === "shield_bash";
  const shieldBash = type === "shield_bash";
  const template = shieldBash ? { name: "\u76FE\u51FB", range: 1, accuracy: 0, damage: { count: 1, sides: 4, stat: "str", type: "physical" }, effects: shieldBashEffects } : attack ? weapon.template : skill2;
  const effect = attack ? void 0 : findNode(template, "teleportBackstab");
  if (effect && changes(unit, "rooted")) return fail("\u5B9A\u8EAB\u65F6\u4E0D\u80FD\u77AC\u79FB");
  if (attack && !shieldBash && weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail("\u5F39\u4ED3\u5DF2\u7A7A\uFF0C\u8BF7\u88C5\u586B");
  const triggers = attack && !shieldBash ? weapon.effects.map((e) => ({ ...e })) : (template.effects ?? []).map((e) => ({ ...e }));
  const stance = unit.stance ?? (unit.offHand ? unit.offHand.kind === "consumable" ? "attunement" : "dual_wield" : unit.shield ? "sword_shield" : "light_blade");
  const tuning = {
    name: template.name,
    shape: template.shape ?? "single",
    stance,
    effects: triggers,
    ...attack && !shieldBash ? {
      souls: weapon.souls,
      multiplier: weapon.soulMultiplier,
      ammo: weapon.ammoCount,
      infiniteAmmo: weapon.infiniteAmmo,
      instanceId: weapon.instance?.id ?? null
    } : {}
  };
  const corpseSkill = template.target === "corpse" || template.effects?.some((e) => isExpression(e) && e.target === "corpse" && ["active", "on_skill_cast"].includes(e.trigger));
  if (corpseSkill && unplaced) {
    return { ...common, ...tuning, cells: corpses(state).filter((c) => validReach(state, unit, c, template)).map((c) => pos(c.x, c.y)) };
  }
  if (unplaced) {
    return { ...common, ...tuning, cells: usableTiles(state, unit, template, attack && !shieldBash ? weapon : null, action.nonLethal ?? unit.nonLethal) };
  }
  const geometry = reaches(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  if (!isGround(state, center)) return fail("\u5899\u4F53\u65E0\u6CD5\u6307\u5B9A", geometry);
  if (geometry.distance > geometry.range + 1e-9) return fail("\u76EE\u6807\u8D85\u51FA\u5C04\u7A0B", geometry);
  if (!hasLOS(state, unit, center)) return fail("\u5899\u4F53\u963B\u65AD\u89C6\u7EBF", geometry);
  const aimedUnit = locateUnit(state, center);
  if (corpseSkill) {
    const corpse = corpses(state).find((c) => sameCell(c, center));
    return corpse ? { ...common, ...geometry, ...tuning, cells: [center], targets: [], center, corpseId: corpse.id } : fail("\u76EE\u6807\u683C\u6CA1\u6709\u53EF\u7528\u5C38\u4F53");
  }
  const execute = findNode(template, "execute", (node3) => node3.requiresPool);
  if (execute && !canExecute(state, unit, aimedUnit, execute, action.nonLethal ?? unit.nonLethal)) return fail("\u76EE\u6807\u6216\u88C5\u5907\u8D44\u6E90\u4E0D\u6EE1\u8DB3\u65A9\u6740\u6761\u4EF6");
  const solid = locateCover(state, center);
  const coverTarget = Boolean(solid && (attack || hasStrikeDamage(template)));
  const cells = area(state, unit, center, template, attack && !shieldBash ? weapon.ammo : null);
  const aoe = (template.shape ?? "single") !== "single";
  if (!cells.length) return fail("\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u5411", geometry);
  if (!aoe) {
    if (!(attack ? aimedUnit && aimedUnit.team !== unit.team : selectionAllows(template, unit, aimedUnit)) && !coverTarget && template.target !== "cell") {
      return fail("\u8BE5\u683C\u6CA1\u6709\u5408\u9002\u7684\u76EE\u6807", geometry);
    }
    if (aimedUnit && aimedUnit.team !== unit.team && !visibleEnemy(state, unit, aimedUnit)) return fail("\u76EE\u6807\u6B63\u5728\u9690\u8EAB", geometry);
  }
  const hostile = attack || template.target === "enemy" || hasStrikeDamage(template) && template.target !== "ally" && template.target !== "self";
  const taunter = hostile ? tauntFor(state, unit, template, attack && !shieldBash ? weapon.ammo : null) : null;
  if (taunter && (!aimedUnit || aimedUnit.id !== taunter.id)) return fail(`\u53D7\u5632\u8BBD\uFF0C\u5FC5\u987B\u6307\u5B9A${taunter.name}`, geometry);
  const blink = effect && aimedUnit ? backCell(state, aimedUnit) : null;
  if (effect && !blink) return fail("\u76EE\u6807\u80CC\u540E\u7684\u77AC\u79FB\u843D\u70B9\u88AB\u963B\u6321", geometry);
  const origin = blink ? { ...unit, ...blink } : unit;
  const templateForHit = blink ? { ...template, range: 1.5 } : template;
  const targetUnits = attack ? aimedUnit ? [aimedUnit] : [] : shapeTargets(state, unit, cells, template);
  const areaAttack = (template.shape ?? "single") !== "single";
  const declaredIntent = action.intent ?? unit.intent ?? "normal";
  const resolvedIntent = areaAttack ? "normal" : declaredIntent;
  const targets = targetUnits.map((t) => ({
    ...targetProfile(state, unit, t, t, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, teleport: effect, intent: resolvedIntent, skillId: action.skillId }),
    bonusDice: action.bonusDice ?? 0,
    intent: resolvedIntent,
    nonLethal: action.nonLethal ?? unit.nonLethal ?? false
  }));
  if (hasStrikeDamage(template)) {
    for (const c of values2(state.covers).filter((c2) => c2.hp > 0 && cells.some((at) => sameCell(at, c2))).sort(byId2)) {
      targets.push({ ...targetProfile(state, unit, c, c, templateForHit, { weapon: attack && !shieldBash ? weapon : null, origin, cover: true, intent: action.intent ?? unit.intent ?? "normal" }), kind: "cover" });
    }
  }
  if (template.heal != null) {
    const healing = diceBounds(diceFormula(state, template.heal, unit)).map((n) => Math.floor(n * healMultiplier(state, unit)));
    for (const target2 of targets) if (target2.kind !== "cover") {
      target2.heal = healing;
      target2.healMin = healing[0];
      target2.healMax = healing[1];
      target2.healingShield = healing.map((n) => Math.min(1e4, Math.floor(n * healShieldRatio(state, unit))));
    }
  }
  const first = targets.find((t) => sameCell(t, center)) ?? targets[0];
  return {
    ...first,
    ...common,
    ...geometry,
    ...tuning,
    ...first ? { damageMultiplier: first.damageMultiplier } : {},
    bonusDice: action.bonusDice ?? 0,
    intent: action.intent ?? unit.intent ?? "normal",
    nonLethal: action.nonLethal ?? unit.nonLethal ?? false,
    dXYZ: geometry.distance,
    cells,
    targets,
    center,
    ...blink ? { teleport: blink } : {},
    hostile
  };
}
function maneuverContest(state, actor, target2, maneuver) {
  const attackStat = maneuver === "grapple" ? "str" : "agi";
  const defenseStat = maneuver === "trip" ? "agi" : "str";
  const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
  const attackerTotal = effectiveStat(state, actor, attackStat) + attackerRoll;
  const defenderTotal = effectiveStat(state, target2, defenseStat) + defenderRoll;
  const success = attackerTotal >= defenderTotal;
  record(state, actor, "contest", `${actor.name}${success ? "\u6210\u529F" : "\u672A\u80FD"}${{ grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E" }[maneuver]}`, {
    maneuver,
    targetId: target2.id,
    attackerRoll,
    defenderRoll,
    attackerTotal,
    defenderTotal,
    success
  });
  return success;
}
function changeCounter(state, actor, weapon, effect, resource3, after) {
  const before = weapon.instance.counters?.[resource3] ?? effect.initial ?? 0;
  (weapon.instance.counters ??= {})[resource3] = after;
  record(
    state,
    actor,
    "counter",
    `${weapon.template.name} \xB7 ${resource3} ${before} \u2192 ${after}`,
    { instanceId: weapon.instance.id, counterKey: resource3, before, after }
  );
}
function resolveCheck(state, actor, profile) {
  if (profile.saveStat) {
    const saveRoll = randomDie(state, 20), saveTotal = saveRoll + profile.saveBonus;
    const saved = saveTotal >= profile.saveDC;
    record(
      state,
      actor,
      "save",
      `${profile.name}${saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}\u8C41\u514D (${saveTotal}/${profile.saveDC})`,
      { targetId: profile.id, saveStat: profile.saveStat, saveRoll, saveBonus: profile.saveBonus, saveTotal, saveDC: profile.saveDC, saved }
    );
    return { hit: true, critical: false, saved };
  }
  if (profile.automatic) return { hit: true, critical: profile.guaranteeCrit, rating: ratingFor(profile.guaranteeCrit ? 20 : 11), intent: { success: true, multiplier: 1 }, saved: false };
  const requestedBonus = profile.bonusDice ?? 0;
  const { rng, rolls: dice3, value: selected } = requestedBonus || actor.penaltyDice ? rollProtocolD20(state.rng, { bonus: requestedBonus, penalty: actor.penaltyDice ?? 0 }) : rollD20(state.rng, profile.advantages, profile.disadvantages);
  actor.bonusDice = Math.max(0, (actor.bonusDice ?? 0) - requestedBonus);
  actor.penaltyDice = 0;
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
  if (hit && defender && profile.intent && profile.intent !== "normal") {
    const defenderD20 = randomDie(state, 20);
    const weakness = changes(defender, "intentDifficulty");
    const intentSpec = { ...INTENTS[profile.intent] ?? INTENTS.normal, difficulty: Math.max(0, (INTENTS[profile.intent]?.difficulty ?? 0) + weakness) };
    const ratingBonus = { \u5E73\u66B4\u51FB: 10, \u5F3A\u66B4\u51FB: 20, \u8D85\u66B4\u51FB: 30 }[rating.name] ?? 0;
    const attackerTier = actor.tier ?? 1, defenderTier = defender.tier ?? 1;
    const attackerBase = attackerTier * 5, defenderBase = defenderTier * 5;
    const coreBonus = profile.intent === "core" ? profile.coreBonus : 0;
    const attackerTotal = attackerBase + selected + ratingBonus + coreBonus;
    const defenderTotal = defenderBase + defenderD20 + intentSpec.difficulty;
    intent = intentCheck(intentSpec, attackerTier, defenderTier, selected, defenderD20, ratingBonus + coreBonus);
    record(state, actor, "intent", `${profile.name}${intent.success ? "\u610F\u56FE\u6210\u7ACB" : "\u610F\u56FE\u53D7\u963B"}`, {
      targetId: profile.id,
      intent: profile.intent,
      attackerTier,
      defenderTier,
      attackerBase,
      attackerD20: selected,
      rating: rating.name,
      ratingBonus,
      ...coreBonus ? { coreBonus } : {},
      attackerTotal,
      defenderBase,
      defenderD20,
      intentDifficulty: intentSpec.difficulty,
      defenderTotal,
      ...intent
    });
  }
  const effectiveHit = hit;
  record(state, actor, "roll", `${profile.name}\uFF1A${critical ? "\u66B4\u51FB" : hit ? "\u547D\u4E2D" : "\u672A\u547D\u4E2D"} (${total}/${profile.defense})`, {
    targetId: profile.id,
    dice: dice3,
    selected,
    total,
    accuracy: profile.accuracy,
    defense: profile.defense,
    advantage: profile.advantage,
    advantages: profile.advantages,
    disadvantages: profile.disadvantages,
    highGround: profile.highGround,
    cover: profile.cover,
    ...profile.coverId ? { coverId: profile.coverId } : {},
    rating,
    distanceTier: distanceTier(profile.distance),
    bonusDice: requestedBonus,
    distance: profile.distance,
    dz: profile.dz,
    flanked: profile.flanked,
    arc: profile.arc,
    hit: effectiveHit,
    critical,
    intent
  });
  return { hit: effectiveHit, critical, rating, intent, saved: false };
}
function coverDamage(state, actor, cover, amount2, details) {
  const before = cover.hp;
  cover.hp = Math.max(0, before - Math.max(0, amount2 - (cover.armor ?? 0)));
  record(
    state,
    actor,
    "cover_damage",
    `${cover.name}\u53D7\u5230${before - cover.hp}\u70B9\u4F24\u5BB3`,
    { ...details, coverId: cover.id, amount: before - cover.hp, hpBefore: before, hpAfter: cover.hp }
  );
  if (!cover.hp) record(state, actor, "cover_break", `${cover.name}\u574D\u584C`, { coverId: cover.id });
}
function knockback(state, actor, target2, effect) {
  const [dx, dy] = facingToward(actor, target2);
  if (!dx && !dy) return;
  const from = pos(target2.x, target2.y);
  for (let i = 0; i < (effect.distance ?? 1); i++) {
    const at = pos(target2.x + dx, target2.y + dy);
    if (!canStep(state, target2, at)) {
      damageTarget(state, target2, actor.id, effect.collisionDamage ?? 5, "true", "\u649E\u51FB");
      if (alive(target2)) grantStatus(state, target2, effect.statusId ?? "stun", { sourceUnitId: actor.id });
      break;
    }
    Object.assign(target2, at);
  }
  record(state, actor, "knockback", `${target2.name}\u906D\u5230\u51FB\u9000`, { targetId: target2.id, from, to: pos(target2.x, target2.y) });
}
function healWithGear(state, actor, target2, spec, name, skillScale = 1) {
  const dice3 = diceRoll(state, diceFormula(state, spec, actor));
  restoreHP(state, target2, Math.floor(dice3.value * skillScale), actor.id, name, { dice: dice3, actionType: "skill" });
}
function offHandFollowup(state, actor, target2, primaryProfile, primaryRating) {
  const weapon = weaponInfo(state, actor);
  if (weapon.stance !== "dual_wield" || !weapon.offHand.template?.damage || !alive(target2)) return;
  const cost = (actor.tier ?? 1) * 10;
  if ((actor.sp ?? 0) < cost || (primaryRating?.multiplier ?? 0) < 0.8) return;
  actor.sp -= cost;
  const offTemplate = weapon.offHand.template;
  const profile = targetProfile(state, actor, target2, target2, offTemplate, { weapon: { ...weapon.offHand, stance: "dual_wield" } });
  profile.disadvantages = primaryRating?.multiplier >= 1.3 ? 0 : Math.max(1, profile.disadvantages ?? 0);
  profile.bonusDice = 0;
  record(state, actor, "followup", `${actor.name}\u53D1\u52A8\u526F\u624B\u8FFD\u51FB`, { targetId: target2.id, cost, weaponId: weapon.offHand.instance?.id ?? null });
  const result = resolveCheck(state, actor, profile);
  if (!result.hit) return;
  const dice3 = profile.protocolInitial != null ? flatDice(profile.protocolInitial) : diceRoll(state, profile.dice, result.critical);
  const scaled = Math.floor(dice3.value * profile.multiplier * (result.rating?.multiplier ?? 1) * 0.5);
  const { recipient } = damageTarget(state, target2, actor.id, scaled, profile.damageType, "\u526F\u624B\u8FFD\u51FB", {
    attacker: actor,
    hit: true,
    melee: profile.melee,
    armorPierce: profile.armorPierce,
    details: { dice: dice3, rating: result.rating?.name, followup: true, cost }
  });
  dispatchEffect(state, actor, "on_hit", { target: recipient, melee: profile.melee, arrow: profile.arrow, backstab: profile.backstab, critical: result.critical, weaponId: weapon.offHand.instance?.id, damageType: profile.damageType });
}
function effectSaved(state, actor, target2, effect) {
  const check = (unit, saveStat, saveDC) => {
    const saveRoll = randomDie(state, 20), saveBonus = effectiveStat(state, unit, saveStat);
    const saveTotal = saveRoll + saveBonus;
    return { saveStat, saveRoll, saveBonus, saveTotal, saveDC, saved: saveTotal >= saveDC };
  };
  let detail;
  const dc = resolveDC(state, actor, effect.contest?.dc ?? effect.dc);
  if (effect.contest) {
    const { attacker, defender } = effect.contest;
    const attack = check(actor, attacker, dc), defense = check(target2, defender, dc);
    detail = { contest: { attack, defense, dc }, saved: attack.saveTotal - defense.saveTotal < dc };
  } else if (Array.isArray(effect.save)) {
    const checks = effect.save.map((stat2) => check(target2, stat2, dc));
    detail = { checks, mode: effect.mode, saved: effect.mode === "all" ? checks.every((x) => x.saved) : checks.some((x) => x.saved) };
  } else detail = check(target2, effect.save, dc);
  const { saved } = detail;
  record(state, actor, "save", `${target2.name}${saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}\u8C41\u514D`, { targetId: target2.id, ...detail });
  return saved;
}
function removeStatus(state, actor, target2, effect) {
  const removed = [];
  for (const status2 of values2(target2.statuses)) {
    const categoryMatches = effect.category === "all_negative" ? ["control", "dot", "debuff"].includes(status2.category) : status2.category === effect.category;
    if (effect.statusId ? effect.statusId !== status2.id : !categoryMatches || status2.durationType === "persistent") continue;
    delete target2.statuses[status2.id];
    removed.push(status2.id);
  }
  if (effect.category) record(state, actor, "cleanse", `${target2.name}\u53D7\u5230\u51C0\u5316`, { targetId: target2.id, removed });
  return removed.length > 0;
}
function teleportBehind(state, actor, target2) {
  const to = backCell(state, target2);
  if (!to || changes(actor, "rooted")) return false;
  const from = pos(actor.x, actor.y);
  Object.assign(actor, to);
  record(state, actor, "teleport", `${actor.name}\u77AC\u79FB\u81F3\u76EE\u6807\u80CC\u540E`, { from, to });
  return true;
}
function applyStrike(state, actor, action, plan, opportunityWeapon = null) {
  const weapon = opportunityWeapon ?? (action.type === "attack" ? weaponInfo(state, actor) : null);
  const template = action.type === "shield_bash" ? { name: "\u76FE\u51FB", range: 1, damage: { count: 1, sides: 4, stat: "str", type: "physical" }, effects: shieldBashEffects } : weapon ? weapon.template : tableEntry(state.skills, action.skillId) ?? new Map(equippedActiveSkills(state, actor)).get(action.skillId);
  const skillEntries = template.entry ? [template.entry] : dsl.skillExpressions(weapon ? null : template, action.skillId);
  const mainTarget = state.units[plan.corpseId ?? plan.targets.find((t) => t.kind !== "cover")?.id];
  const multipliers = [];
  const skillScale = action.type === "skill" ? Math.max(0, dsl.stat(state, actor, "skillPower", 1, { target: mainTarget, school: template.school, actionType: "skill" })) : 1;
  const effectContext = {
    target: mainTarget,
    center: plan.center,
    actionType: action.type,
    school: template.school,
    multipliers,
    skillScale,
    entries: skillEntries,
    weaponId: weapon?.instance?.id ?? template.entry?.instance?.id,
    resourceCost: template.resourceCost?.amount,
    opportunityAttack: Boolean(opportunityWeapon),
    melee: plan.targets[0]?.melee,
    arrow: Boolean(weapon?.ammo),
    ...action.type === "skill" && template.shape !== "single" ? { skillArea: new Set(plan.targets.map((target2) => target2.id)) } : {},
    damageType: template.damage?.type,
    power: template.power ?? template.attack ?? Math.max(0, effectiveStat(state, actor, template.damage?.stat ?? "int") * 10),
    nonLethal: plan.nonLethal
  };
  if (action.type === "skill") {
    dispatchEffect(state, actor, "on_skill_cast", effectContext, skillEntries);
    if (template.shape !== "single" && plan.targets.length) {
      const perTarget = skillEntries.filter(({ expr }) => expr.target === "hitTarget");
      dsl.dispatch(state, actor, "active", effectContext, skillEntries.filter((entry) => !perTarget.includes(entry)));
      for (const target2 of plan.targets) if (target2.kind !== "cover") dsl.dispatch(state, actor, "active", { ...effectContext, target: state.units[target2.id] }, perTarget);
    } else dsl.dispatch(state, actor, "active", effectContext, skillEntries);
    if (!alive(actor)) return;
  }
  if (plan.hostile && statusOf(actor, "stealth")) {
    delete actor.statuses.stealth;
    record(state, actor, "reveal", `${actor.name}\u53D1\u52A8\u8FDB\u653B\uFF0C\u89E3\u9664\u9690\u8EAB`);
  }
  if (!sameCell(actor, plan.center)) actor.facing = facingToward(actor, plan.center);
  if (weapon || action.type === "shield_bash") dispatchEffect(state, actor, "on_attack", effectContext);
  for (const preview2 of plan.targets) {
    if (!alive(actor)) break;
    const cover = preview2.kind === "cover";
    const target2 = (cover ? state.covers : state.units)[preview2.id];
    if (!alive(target2)) continue;
    let profile = preview2;
    if (preview2.saveStat && typeof template.saveDC === "object") {
      profile = { ...profile, saveDC: resolveDC(state, actor, template.saveDC), saveBonus: effectiveStat(state, target2, preview2.saveStat) };
    }
    const { hit, critical, rating, intent, saved } = resolveCheck(state, actor, profile);
    if (!hit) continue;
    let recipient = target2, dealt = 0;
    const hitContext = { ...effectContext, target: target2, center: pos(target2.x, target2.y), damageType: profile.damageType, hitRating: rating?.name, melee: profile.melee, arrow: profile.arrow, backstab: profile.backstab, critical, saved };
    const factor = (damageType2) => dsl.damageFactor(state, actor, { ...hitContext, damageType: damageType2 }, multipliers);
    if (profile.dice) {
      const dice3 = profile.protocolInitial != null ? flatDice(profile.protocolInitial) : diceRoll(state, profile.dice, critical);
      const stance = actor.stance ?? stanceLabel[stanceFor({ mainHand: actor.mainHand ?? actor.weapon, offHand: actor.offHand, shield: actor.shield })];
      const sizeScale = meleeMultiplier(actor);
      const ratingScale = rating?.multiplier ?? (critical ? 2 : 1);
      const intentScale = intent?.success ? intent.multiplier ?? 1 : 1;
      const stanceScale = profile.stance === "greatsword" ? actor.greatswordMode === "defensive" ? 1.5 : 1.3 : 1;
      const offHandScale = profile.stance === "dual_wield" && profile.offHand ? 0.5 : 1;
      const attackDamage = profile.fixedDamage ? dice3.value : dice3.value * profile.multiplier * sizeScale * ratingScale * intentScale * stanceScale * offHandScale;
      const scaled = Math.floor(Math.max(0, dsl.stat(state, actor, "damage", attackDamage * skillScale * factor(profile.damageType), hitContext)) * (saved ? 0.5 : 1));
      const details = { dice: dice3, critical, saved, rating: rating?.name ?? "\u6709\u6548", ratingMultiplier: ratingScale, intent: intent ?? { success: true, multiplier: 1 }, attackMultiplier: profile.fixedDamage ? 1 : profile.multiplier * factor(profile.damageType), ...hitContext.weaponId ? { weaponId: hitContext.weaponId } : {}, stanceScale, offHandScale };
      if (profile.kind === "cover") {
        coverDamage(state, actor, target2, scaled, details);
        continue;
      }
      ({ recipient, dealt } = damageTarget(
        state,
        target2,
        actor.id,
        scaled,
        profile.damageType,
        template.name,
        { attacker: actor, hit: true, melee: profile.melee, armorPierce: profile.armorPierce, details, preserveLife: profile.nonLethal }
      ));
      if (profile.nonLethal && recipient.hp === 1 && dealt > 0) {
        record(state, actor, "nonlethal", `${recipient.name}\u88AB\u975E\u81F4\u6B7B\u653B\u51FB\u7559\u6709 1 HP`, { targetId: recipient.id, hpBefore: dealt + 1, hpAfter: 1 });
      }
    }
    if (profile.kind === "cover") continue;
    dispatchEffect(state, actor, "on_hit", { ...hitContext, target: recipient, dealt, damageFactor: factor }, skillEntries);
    if (alive(recipient) && template.heal != null) healWithGear(state, actor, recipient, template.heal, template.name, skillScale);
    if (profile.dice && action.type === "attack" && alive(actor) && alive(recipient) && recipient.team !== actor.team) {
      offHandFollowup(state, actor, recipient, profile, rating);
    }
  }
}
function applyMovement(state, actor, type, plan) {
  const from = pos(actor.x, actor.y), path = [];
  const canContinue = () => alive(actor) && !changes(actor, "skip") && !changes(actor, "rooted");
  for (const to2 of plan.path) {
    if (type !== "disengage") {
      const sources = opportunitySources(state, actor);
      for (const source of sources) {
        const { unit, weapon } = source;
        if (!canReact(state, source, actor) || !threatens(state, source, actor, actor) || threatens(state, source, actor, to2)) continue;
        unit.reactionAvailable = false;
        const center = pos(actor.x, actor.y);
        record(
          state,
          unit,
          "opportunity",
          `${unit.name}\u5BF9${actor.name}\u53D1\u52A8\u501F\u673A\u653B\u51FB`,
          { ...opportunityDetail(unit, center, to2), targetId: actor.id }
        );
        const profile = targetProfile(state, unit, actor, center, weapon.template, { weapon });
        applyStrike(state, unit, { type: "attack" }, { center, targets: [profile], hostile: true }, weapon);
        if (!canContinue()) break;
      }
    }
    if (!canContinue() || !canStep(state, actor, to2)) break;
    actor.facing = facingToward(actor, to2);
    Object.assign(actor, pos(to2.x, to2.y));
    path.push(to2);
  }
  const to = pos(actor.x, actor.y), interrupted = path.length !== plan.path.length;
  record(
    state,
    actor,
    type,
    `${actor.name}${movementNames[type]}${interrupted ? "\u53D7\u963B\uFF0C\u505C\u5728" : "\u81F3"} (${to.x}, ${to.y})`,
    { from, to, path, steps: path.length, interrupted }
  );
}
function applyInteraction(state, actor, plan) {
  const item = state.interactives[plan.interactiveId];
  item.spent = true;
  if (!sameCell(actor, item)) actor.facing = facingToward(actor, item);
  record(state, actor, "interact", `${actor.name}${item.kind === "barrel" ? "\u5F15\u7206" : "\u6FC0\u6D3B"}${item.name}`, { interactiveId: item.id });
  if (item.kind === "barrel") {
    for (const profile of plan.targets) {
      const target2 = state.units[profile.id];
      if (alive(target2)) damageTarget(state, target2, actor.id, 12, "energy", "\u7206\u6876", { attacker: actor, hit: true, direct: false });
    }
    for (const cover of values2(state.covers).filter((c) => c.hp > 0 && plan.cells.some((at) => sameCell(at, c))).sort(byId2)) {
      coverDamage(state, actor, cover, 12, { interactiveId: item.id });
    }
  } else {
    restoreHP(state, actor, 8, actor.id, "\u661F\u8F89\u796D\u575B");
    actor.mp = Math.min(actor.maxMp, actor.mp + 5);
    actor.sp = Math.min(actor.maxSp, actor.sp + 3);
    grantStatus(state, actor, "shield", { amount: 10, sourceUnitId: actor.id });
    grantStatus(state, actor, "haste", { sourceUnitId: actor.id });
  }
}
function applyAction(state, action) {
  const plan = preview(state, action);
  if (!plan.ok) throw new Error(plan.error);
  const { type, x, y, skillId } = action;
  if (needsTarget(type) && x === void 0) throw new Error("\u7F3A\u5C11\u76EE\u6807\u5750\u6807");
  const actor = currentUnit(state);
  const before = state.logs.length;
  const moving = ["move", "sprint", "disengage"].includes(type);
  const initialCover = moving ? new Set(nearbyCovers(state, actor).map((c) => c.id)) : null;
  if (type !== "end") {
    actor.ap -= plan.ap;
    actor.mp -= plan.mp;
    actor.sp -= plan.sp;
    if (type === "skill") {
      const skill2 = tableEntry(state.skills, skillId);
      if (skill2?.resourceCost) {
        const { resource: resource3, amount: cost } = skill2.resourceCost;
        const { item, effect, amount: amount2 } = resourcePool(state, actor, resource3);
        changeCounter(state, actor, item, effect, resource3, amount2 - cost);
      }
    }
    if (plan.ap === 2 && state.mode === "split") {
      actor.used.attack++;
      actor.used.action++;
    } else if (plan.slot) actor.used[plan.slot]++;
    const actionIntent = ["attack", "skill"].includes(type) && plan.intent && plan.intent !== "normal" && plan.shape === "single" ? plan.intent : "normal";
    const targetId = plan.targets?.find((target2) => target2.kind !== "cover")?.id ?? null;
    const intentNames = { function: "\u673A\u80FD\u9650\u5236", core: "\u6838\u5FC3\u8981\u5BB3", kill: "\u62B9\u6740", concept: "\u6982\u5FF5\u7834\u788E" };
    const actionLabel = plan.name ?? (movementNames[type] ?? { reload: "\u88C5\u586B", brace: "\u4F9D\u6258\u9632\u5FA1", interact: "\u4E92\u52A8" }[type]);
    const actionText = actionIntent !== "normal" ? `${actor.name}\uFF1A${actionLabel}\u4EE5\u610F\u56FE\uFF1A${intentNames[actionIntent]}\u653B\u51FB${state.units[targetId]?.name ?? "\u76EE\u6807"}` : `${actor.name}\uFF1A${actionLabel}`;
    record(
      state,
      actor,
      "action",
      actionText,
      {
        action: { type, ...x === void 0 ? {} : { x, y }, ...skillId === void 0 ? {} : { skillId } },
        intent: actionIntent,
        targetId,
        ap: plan.ap,
        mp: plan.mp,
        sp: plan.sp,
        remainingAP: actor.ap
      }
    );
  }
  switch (type) {
    case "move":
    case "sprint":
    case "disengage":
      applyMovement(state, actor, type, plan);
      break;
    case "attack":
    case "skill":
    case "shield_bash":
      applyStrike(state, actor, { type, skillId }, plan);
      break;
    case "use_item": {
      actor.attunementCharges = Math.max(0, (actor.attunementCharges ?? 2) - 1);
      record(state, actor, "item", `${actor.name}\u4F7F\u7528\u540C\u8C03\u526F\u624B\u9053\u5177`, { itemId: plan.itemId, remaining: actor.attunementCharges });
      grantStatus(state, actor, "haste", { sourceUnitId: actor.id });
      if (!actor.attunementCharges) actor.stance = "light_blade";
      break;
    }
    case "charge":
      grantStatus(state, actor, "charge", { sourceUnitId: actor.id });
      break;
    case "lock_on":
      actor.lockedTargetId = plan.targetId;
      grantStatus(state, actor, "lock_on", { sourceUnitId: actor.id });
      record(state, actor, "maneuver", `${actor.name}\u9501\u5B9A${state.units[plan.targetId].name}`, { targetId: plan.targetId });
      break;
    case "scan":
      grantStatus(state, actor, "weakness", { sourceUnitId: actor.id, stacks: 3 });
      break;
    case "flee": {
      const enemies = living(state).filter((u) => u.team !== actor.team).sort((a, b) => effectiveStat(state, b, "agi") - effectiveStat(state, a, "agi") || byId2(a, b));
      const target2 = enemies[0];
      const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
      const success = target2 ? effectiveStat(state, actor, "agi") + attackerRoll >= effectiveStat(state, target2, "agi") + defenderRoll : true;
      record(state, actor, "flee", `${actor.name}${success ? "\u9003\u8DD1\u6210\u529F" : "\u9003\u8DD1\u5931\u8D25"}`, { targetId: target2?.id ?? null, attackerRoll, defenderRoll, success });
      if (success) {
        actor.fled = true;
        state.outcome = actor.team === "blue" ? "red" : "blue";
      }
      break;
    }
    case "detour":
      record(state, actor, "maneuver", `${actor.name}\u9009\u62E9\u7ED5\u884C`, { maneuver: "detour" });
      break;
    case "grapple":
    case "disarm":
    case "trip":
    case "push": {
      const target2 = state.units[plan.targetId];
      if (target2 && maneuverContest(state, actor, target2, type)) {
        if (type === "grapple") grantStatus(state, target2, "grappled", { sourceUnitId: actor.id });
        if (type === "disarm") {
          const held = target2.mainHand ?? target2.weapon;
          target2.disarmedItem = held ?? null;
          target2.mainHand = null;
          target2.weapon = null;
          grantStatus(state, target2, "disarmed", { sourceUnitId: actor.id });
        }
        if (type === "trip") grantStatus(state, target2, "prone", { sourceUnitId: actor.id });
        if (type === "push") knockback(state, actor, target2, { distance: 1, collisionDamage: 3 });
      }
      break;
    }
    case "block":
      actor.blockMode = action.maneuver === "heavy" ? "heavy" : "normal";
      grantStatus(state, actor, "guarded", { sourceUnitId: actor.id, turns: 1, modifiers: { reduction: actor.blockMode === "heavy" ? 0.45 : 0.25 } });
      record(state, actor, "block", `${actor.name}${actor.blockMode === "heavy" ? "\u91CD" : ""}\u683C\u6321`, { reduction: actor.blockMode === "heavy" ? 0.45 : 0.25 });
      break;
    case "reload": {
      const weapon = weaponInfo(state, actor);
      dsl.changeResource(state, actor, actor, { kind: "produceResource", resource: weapon.ammo.resource, local: true }, weapon.ammo.cap, "\u88C5\u586B", { instance: weapon.instance });
      break;
    }
    case "brace":
      record(
        state,
        actor,
        "brace",
        `${actor.name}${plan.coverId ? `\u501F ${plan.coverId} ` : "\u539F\u5730"}\u67B6\u52BF\u9632\u5FA1\uFF08\u51CF\u4F24 35%\uFF0C${plan.turns} \u56DE\u5408\uFF09`,
        { coverId: plan.coverId, reduction: plan.reduction, turns: plan.turns }
      );
      grantStatus(state, actor, "guarded", { sourceUnitId: actor.id, turns: plan.turns });
      break;
    case "interact":
      applyInteraction(state, actor, plan);
      break;
  }
  if (moving && alive(actor)) {
    const stance = actor.stance ?? "unarmed";
    if (type === "move" && stance === "light_blade") actor.bonusDice = Math.min(2, (actor.bonusDice ?? 0) + 1);
    const coverIds = nearbyCovers(state, actor).filter((c) => !initialCover.has(c.id)).map((c) => c.id);
    if (coverIds.length) record(state, actor, "cover_approach", `${actor.name}\u79FB\u81F3\u63A9\u4F53 ${coverIds.join("\u3001")} \u65C1`, { coverIds });
  }
  if (refreshOutcome(state)) {
    if (actor) actor.ap = 0;
    return state.logs.slice(before);
  }
  if (type === "end" || !alive(actor) || !actor.ap) {
    endTurn(state, actor);
    if (!refreshOutcome(state)) {
      advanceCursor(state);
      settleTurn(state);
    }
  }
  return state.logs.slice(before);
}

// src/core/prebattle_resources.js
var hpTier = [1, 2, 4, 10, 20, 40, 100];
var manaTier = [1, 2.5, 6, 15, 35, 80, 160];
var attributes = ["str", "agi", "con", "int", "spi"];
var finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
var integer2 = (n, min, max) => Number.isSafeInteger(n) && finite(n, min, max);
var fail2 = (field) => {
  throw new Error(`\u6218\u524D\u8D44\u6E90\u63A8\u6F14\uFF1A${field}\u65E0\u6548`);
};
function calculatePrebattleResources(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail2("\u8F93\u5165");
  const { stats: stats2, tier, bodyLengthM = null, count = 1, summonCount = 1, previous = {} } = input;
  if (!stats2 || !attributes.every((k) => integer2(stats2[k], 0, 1e6))) fail2("\u4E94\u7EF4");
  if (!integer2(tier, 1, 7)) fail2("\u5C42\u7EA7");
  if (bodyLengthM !== null && !finite(bodyLengthM, Number.MIN_VALUE, 1e9)) fail2("\u4F53\u957F");
  if (!integer2(count, 1, 1e6) || !integer2(summonCount, 1, 1e6)) fail2("\u96C6\u7FA4\u6570\u91CF\u6216\u53EC\u5524\u521D\u59CB\u603B\u6570");
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) fail2("\u65E7\u8D44\u6E90");
  const { str, agi, con, int: int2, spi } = stats2;
  const statSum = str + agi + con + int2 + spi;
  const mc = bodyLengthM >= 10 ? 2 + Math.floor(Math.log2(bodyLengthM / 10)) : 1;
  const baseMultipliers = { hp: hpTier[tier - 1], mp: manaTier[tier - 1], sp: manaTier[tier - 1] };
  const hp = baseMultipliers.hp * mc / summonCount, mp = baseMultipliers.mp / summonCount;
  const raw = { hp: (con * 100 * hp + statSum) * count, mp: (int2 + spi) * 50 * mp * count, sp: (str + agi) * 50 * mp * count };
  const resources = {};
  for (const [key3, value] of Object.entries(raw)) {
    const old = previous[key3];
    if (Object.hasOwn(previous, key3) && (!old || !finite(old.max, 0, Number.MAX_SAFE_INTEGER) || !finite(old.current, 0, old.max))) fail2(`\u65E7 ${key3.toUpperCase()} `);
    const ratio2 = old ? old.max ? old.current / old.max : 0 : 1;
    resources[key3] = { rawMax: value, max: Math.round(value), current: Math.round(value * ratio2), ratio: ratio2 };
  }
  return { tier, statSum, mc, count, summonCount, baseMultipliers, multipliers: { hp, mp, sp: mp }, resources };
}
function protocolDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + Math.ceil(Math.abs(a.z - b.z) / 2);
}

// src/presets/catalog.js
var dice = (count, sides, stat2, type, bonus = 0) => ({ count, sides, stat: stat2, type, bonus });
var status = (id3, statusId2, extra = {}) => expression(id3, "on_hit", "hitTarget", [{ kind: "grantStatus", statusId: statusId2, ...extra }], { condition: { type: "saved", value: false } });
var skill = (name, range, target2, specs = {}) => ({
  name,
  quality: "\u666E\u901A",
  power: 50,
  ap: 1,
  slot: target2 === "enemy" ? "attack" : "action",
  mp: 2,
  range,
  shape: "single",
  target: target2,
  effects: [],
  ...specs
});
var EQUIPMENT = {
  soulblade: { name: "\u566C\u9B42\u592A\u5200", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 120, defense: 0, range: 1, accuracy: 5, damage: dice(2, 6, "str", "physical"), effects: [
    { id: "soulblade-0", trigger: "passive", target: "self", effects: [{ kind: "produceResource", resource: "souls", cap: 10 }, { kind: "multiplyDamage", local: true, resourceScale: { resource: "souls", perUnit: 0.5 } }], params: { source: "weapon" } },
    { id: "soulblade-0-kill", trigger: "on_kill", target: "self", effects: [{ kind: "produceResource", resource: "souls", amount: 1, local: true }], params: { source: "weapon" } }
  ] },
  frostplate: { name: "\u971C\u7EB9\u8346\u68D8\u91CD\u7532", quality: "\u666E\u901A", kind: "armor", armor: 2, defense: 25, effects: [
    { id: "frostplate-0", trigger: "on_damaged", target: "attacker", effects: [{ kind: "damage", amount: 3, label: "\u971C\u7EB9\u8346\u68D8" }], condition: [{ type: "melee", value: true }, { type: "reaction", value: false }, { type: "enemy", value: true }] },
    { id: "frostplate-0-status", trigger: "on_damaged", target: "attacker", effects: [{ kind: "grantStatus", statusId: "chill" }], condition: [{ type: "melee", value: true }, { type: "reaction", value: false }, { type: "enemy", value: true }], roll: { chance: 0.4 }, label: "\u971C\u7EB9\u8346\u68D8" }
  ] },
  bloodfang: { name: "\u53CC\u751F\u8840\u7259\u5315\u9996", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 80, defense: 0, range: 1, accuracy: 3, damage: dice(2, 4, "agi", "physical"), effects: [
    { id: "bloodfang-0", trigger: "passive", target: "self", effects: [{ kind: "multiplyDamage", factor: 1.4 }, { kind: "modifyCheck", advantage: 1 }], params: { source: "weapon" }, condition: { type: "backstab", value: true } },
    { id: "bloodfang-0-hit", trigger: "on_hit", target: "hitTarget", effects: [{ kind: "grantStatus", statusId: "bleed", stacks: 2 }, { kind: "damage", amount: 4, inheritDamageType: true, label: "\u53CC\u751F\u8840\u7259\u8FDE\u51FB" }], params: { source: "weapon" }, condition: { type: "or", conditions: [{ type: "backstab", value: true }, { type: "critical", value: true }] } }
  ] },
  revolver: { name: "\u730E\u9B54\u5DE6\u8F6E", kind: "weapon", weaponClass: "ranged", hand: "one_handed", ranged: true, rangeType: "ranged", attack: 100, defense: 0, range: 5, accuracy: 3, damage: dice(2, 6, "agi", "physical"), effects: [
    { id: "revolver-0", trigger: "passive", target: "self", effects: [{ kind: "produceResource", resource: "ammo", cap: 6, initial: 6, reloadable: true }, { kind: "modifyStat", stat: "armorPierce", flat: 3 }, { kind: "modifyCheck", highGroundRange: 1, highGroundAccuracy: 2 }], params: { source: "weapon" } },
    { id: "revolver-0-spend", trigger: "on_attack", target: "self", effects: [{ kind: "drainResource", resource: "ammo", local: true, amount: 1, requireFull: true }], params: { source: "weapon" }, condition: { type: "not", conditions: [{ type: "selfStatusModifier", key: "infiniteAmmo", value: true }] } }
  ] },
  crossbow: { name: "\u7834\u7532\u91CD\u5F29", kind: "weapon", weaponClass: "ranged", hand: "one_handed", ranged: true, attack: 150, defense: 0, rangeType: "ranged", range: 6, accuracy: 1, damage: dice(2, 8, "agi", "physical"), effects: [
    { id: "crossbow-0", trigger: "passive", target: "self", effects: [{ kind: "produceResource", resource: "ammo", cap: 3, initial: 3, reloadable: true }, { kind: "modifyStat", stat: "armorPierce", flat: 5 }, { kind: "modifyCheck", highGroundRange: 2, highGroundAccuracy: 2 }], params: { source: "weapon" } },
    { id: "crossbow-0-spend", trigger: "on_attack", target: "self", effects: [{ kind: "drainResource", resource: "ammo", local: true, amount: 1, requireFull: true }], params: { source: "weapon" }, condition: { type: "not", conditions: [{ type: "selfStatusModifier", key: "infiniteAmmo", value: true }] } }
  ] },
  hymnal: { name: "\u5723\u548F\u5E87\u62A4\u5FBD\u8BB0", quality: "\u666E\u901A", kind: "accessory", effects: [
    { id: "hymnal-0", trigger: "passive", target: "self", effects: [{ kind: "modifyStat", stat: "healing", percent: 0.25, condition: { type: "actionType", value: "skill" } }] },
    { id: "hymnal-0-shield", trigger: "on_heal", target: "hitTarget", condition: { type: "actionType", value: "skill" }, effects: [{ kind: "shield", percentOfHealing: 0.5, stack: true }] }
  ] },
  shortblade: { name: "\u526F\u624B\u77ED\u5203", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 50, defense: 0, range: 1, accuracy: 1, damage: dice(1, 4, "agi", "physical"), effects: [] },
  potion: { name: "\u8C03\u548C\u836F\u5242", kind: "consumable", weaponClass: "auxiliary", hand: "off_hand", effects: [] },
  greatsword: { name: "\u7384\u94C1\u91CD\u5251", kind: "weapon", weaponClass: "greatsword", hand: "two_handed", heavy: true, twoHanded: true, attack: 260, defense: 0, rangeType: "melee", range: 1, accuracy: 1, damage: dice(2, 8, "str", "physical"), effects: [] },
  towerShield: { name: "\u5854\u76FE", kind: "shield", weaponClass: "shield", hand: "off_hand", shield: true, defense: 8, effects: [] },
  pike: { name: "\u5DE1\u536B\u957F\u621F", kind: "weapon", weaponClass: "greatsword", hand: "two_handed", heavy: true, twoHanded: true, attack: 180, defense: 0, rangeType: "melee", range: 2, accuracy: 2, damage: dice(1, 8, "str", "physical"), effects: [{ id: "pike-0", trigger: "on_hit", target: "hitTarget", effects: [{ kind: "grantStatus", statusId: "root", turns: 1 }], params: { source: "weapon" }, condition: { type: "opportunityAttack", value: true } }] },
  staff: { name: "\u7075\u7EB9\u6CD5\u6756", kind: "weapon", weaponClass: "staff", hand: "one_handed", attack: 90, defense: 0, rangeType: "ranged", range: 4, accuracy: 2, damage: dice(1, 6, "int", "energy"), effects: [] }
};
var SKILLS = {
  brand: skill("\u7130\u5370", 4, "enemy", { damage: dice(1, 4, "int", "energy"), effects: [status("preset-burn-1", "burn"), status("preset-mark-2", "mark")] }),
  surge: skill("\u65AD\u5CB3\u91CD\u65A9", 1, "enemy", {
    ap: 2,
    mp: 0,
    sp: 4,
    accuracy: 3,
    damage: dice(3, 6, "str", "physical"),
    effects: [expression("surge-push", "on_hit", "hitTarget", [{ kind: "knockback", distance: 2, collisionDamage: 7 }]), status("preset-sunder-3", "sunder")]
  }),
  ward: skill("\u5B88\u9635", 2, "ally", { effects: [status("preset-guard-4", "guard"), status("preset-guarded-5", "guarded")] }),
  challenge: skill("\u6311\u8845", 4, "enemy", { effects: [status("preset-taunt-6", "taunt")] }),
  frost: skill("\u788E\u971C\u65B0\u661F", 5, "enemy", {
    ap: 2,
    mp: 5,
    shape: "circle",
    radius: 2,
    save: "con",
    saveDC: 14,
    damage: dice(2, 6, "int", "energy"),
    effects: [status("preset-freeze-7", "freeze")]
  }),
  fan: skill("\u8840\u7259\u6247\u65A9", 3, "enemy", { shape: "fan", width: 1, damage: dice(1, 6, "agi", "physical"), effects: [status("preset-bleed-8", "bleed")] }),
  toxin: skill("\u6BD2\u96FE\u9525", 4, "enemy", {
    shape: "cone",
    width: 1,
    save: "con",
    saveDC: 13,
    damage: dice(1, 4, "int", "mental"),
    effects: [status("preset-poison-9", "poison"), status("preset-blind-10", "blind")]
  }),
  beam: skill("\u8D2F\u661F\u76F4\u7EBF", 6, "enemy", {
    ap: 2,
    mp: 4,
    shape: "line",
    width: 0,
    damage: dice(2, 8, "int", "energy"),
    effects: [status("preset-root-11", "root")]
  }),
  blink: skill("\u5F71\u6B65\u80CC\u523A", 5, "enemy", { damage: dice(2, 6, "agi", "physical"), effects: [
    expression("blink-move", "active", "hitTarget", [{ kind: "teleportBackstab", bonusMultiplier: 0.5 }]),
    status("preset-bleed-12", "bleed"),
    status("preset-stealth-13", "stealth", { target: "self" })
  ] }),
  hymn: skill("\u7FA4\u661F\u5723\u548F", 4, "ally", {
    ap: 2,
    mp: 5,
    shape: "circle",
    radius: 2,
    heal: dice(2, 4, "spi", "true"),
    effects: [status("preset-regen-14", "regen")]
  }),
  cleanse: skill("\u51C0\u5316\u7977\u8A00", 4, "ally", { heal: dice(1, 4, "spi", "true"), effects: [expression("cleanse-negative", "on_hit", "hitTarget", [{ kind: "removeStatus", category: "all_negative" }])] }),
  shift: skill("\u8FC5\u5F71", 0, "ally", { effects: [status("preset-haste-15", "haste"), status("preset-stealth-16", "stealth")] }),
  armor: skill("\u8346\u58C1\u836F\u5242", 0, "ally", { mp: 0, sp: 3, effects: [status("preset-thorns-17", "thorns"), status("preset-shield-18", "shield", { amount: 6 })] }),
  curse: skill("\u8680\u5FC3\u5492", 4, "enemy", {
    save: "spi",
    saveDC: 13,
    damage: dice(1, 6, "spi", "mental"),
    effects: [status("preset-vulnerable-19", "vulnerable")]
  })
};

// src/core/battle_time.js
var timeOfDay = (hour, minute) => {
  const clock = hour * 60 + minute;
  if (clock < 300 || clock >= 1170) return "night";
  if (clock < 480) return "dawn";
  return clock < 1020 ? "day" : "dusk";
};
function parseBattleTime(...sources) {
  for (const source of sources) {
    if (typeof source !== "string") continue;
    const decoded = source.replaceAll("&lt;", "<").replaceAll("&gt;", ">");
    for (const [, block] of [...decoded.matchAll(/<tp>\s*([\s\S]*?)<\/tp>/gi)].reverse()) {
      const raw = block.split("@", 1)[0].trim();
      const match = raw.match(/\b(\d{1,2}):(\d{2})\b/);
      if (!match || raw.length > 500) continue;
      const [, hours, minutes] = match;
      const hour = Number(hours), minute = Number(minutes);
      if (hour > 23 || minute > 59) continue;
      return { raw, hour, minute, timeOfDay: timeOfDay(hour, minute), calendar: raw.slice(0, match.index).replace(/[-\s]+$/, "") };
    }
  }
  return null;
}

// src/api/validation.js
var own2 = Object.hasOwn;
var error = (message) => {
  throw new Error(message);
};
var requireThat = (yes, name) => {
  if (!yes) error(`\u65E0\u6548\u5B57\u6BB5\uFF1A${name}`);
};
var plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
var id2 = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) && !own2(Object.prototype, v) && v !== "prototype";
var int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
var num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
var text = (v, max = 100) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
var team = (v) => v === "blue" || v === "red";
var coord = (v) => int(v, 0, 9);
var attrs = ["str", "agi", "con", "int", "spi"];
var statusDurations = ["battle_turns", "until_removed", "persistent"];
var statusTickTimings = ["onTurnStart", "onTurnEnd"];
var statusStackRules = ["refresh", "stack", "replace"];
var statusLabels = ["name", "icon", "category", "description"];
var maxStatusTemplates = 64;
var has = (record2, key3) => id2(key3) && own2(record2, key3);
function fields(v, required, optional = []) {
  requireThat(plain(v) && required.every((k) => own2(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), required.join("/") || "\u5BF9\u8C61\u952E");
}
function checkOptional(o, key3, check) {
  if (own2(o, key3)) requireThat(check(o[key3]), key3);
}
function table2(v, test, max = 200) {
  requireThat(plain(v) && Object.keys(v).length <= max, "\u5B9E\u4F53\u8868");
  for (const [k, value] of Object.entries(v)) {
    requireThat(id2(k), "\u5B9E\u4F53 ID");
    test(value, k);
  }
}
function list(v, max, check, key3) {
  requireThat(Array.isArray(v) && v.length <= max && Array.from(v).every(check), key3);
}
function dice2(v) {
  fields(v, ["count", "sides"], ["bonus", "stat", "multiplier", "type"]);
  requireThat(int(v.count, 0, 1e6) && int(v.sides, 0, 1e6) && (v.count === 0 || v.sides >= 1), "\u4F24\u5BB3\u9AB0");
  checkOptional(v, "bonus", (x) => int(x, -1e9, 1e9));
  checkOptional(v, "stat", (x) => attrs.includes(x));
  checkOptional(v, "multiplier", (x) => num(x, 0, 8));
  checkOptional(v, "type", (x) => damageTypes.includes(x));
}
var customModifierKeys = [
  "damage",
  "damageType",
  "heal",
  "movement",
  "armor",
  "accuracy",
  "incomingAccuracy",
  "advantage",
  "disadvantage",
  "reduction",
  "vulnerability",
  "reflect",
  "dodgeBonus",
  "attackPercent",
  "attributePercent",
  "finalDamageMultiplier",
  "guaranteed_hit",
  "guaranteed_crit",
  "blockResourceRestore",
  "preserveLife",
  "skip"
];
function statusLifetime(v) {
  return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType) && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
}
function statusTemplate(v, key3 = v?.id) {
  fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers"], ["expireInto", "expireOn"]);
  checkOptional(v, "expireInto", id2);
  checkOptional(v, "expireOn", validExpireOn);
  requireThat(id2(key3) && !own2(STATUSES, key3) && v.id === key3, "\u81EA\u5B9A\u4E49\u72B6\u6001 ID");
  requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300) && ["buff", "debuff", "control", "dot", "hot"].includes(v.category), "\u72B6\u6001\u540D/\u56FE\u6807/\u63CF\u8FF0/\u7C7B\u522B");
  requireThat(statusLifetime(v) && int(v.maxStacks, 1, 10), "\u72B6\u6001\u65F6\u957F/\u5C42\u6570");
  fields(v.modifiers, [], customModifierKeys);
  requireThat(Object.keys(v.modifiers).length > 0 && (!own2(v.modifiers, "damageType") || own2(v.modifiers, "damage")), "\u72B6\u6001\u7279\u6548");
  validateStatusModifiers(v, v.modifiers);
}
function statusTemplateTable(v) {
  table2(v, statusTemplate, maxStatusTemplates);
  for (const t of Object.values(v)) if (t.expireInto) {
    requireThat(t.durationType === "battle_turns" && t.remainingTurns === 1 && t.expireInto !== t.id && (has(STATUSES, t.expireInto) || has(v, t.expireInto) && !v[t.expireInto].expireInto), "\u72B6\u6001\u5230\u671F\u76EE\u6807");
  }
}
function defineStatus(state, key3, template) {
  requireThat(plain(template) && (!own2(template, "id") || template.id === key3), "\u81EA\u5B9A\u4E49\u72B6\u6001 ID");
  const definition = { ...template, id: key3 };
  statusTemplate(definition, key3);
  requireThat(!getStatusTemplate(state, key3), "\u72B6\u6001\u6A21\u677F ID \u5DF2\u5B58\u5728");
  requireThat(Object.keys(state.statusTemplates ?? {}).length < maxStatusTemplates, "\u81EA\u5B9A\u4E49\u72B6\u6001\u6A21\u677F\u6570\u91CF");
  (state.statusTemplates ??= {})[key3] = structuredClone(definition);
  return structuredClone(definition);
}
var resourceCost = (x) => plain(x) && Object.keys(x).length === 2 && id2(x.resource) && int(x.amount, 1, 1e6);
function validateEffect(e, state) {
  requireThat(isExpression(e) && validExpression(e), "DSL expression");
  if (Array.isArray(e.roll?.save)) requireThat(e.roll.mode && new Set(e.roll.save).size === e.roll.save.length, "DSL save mode");
  else requireThat(!e.roll?.mode, "DSL save mode");
  for (const node3 of effectNodes(e.effects)) {
    if (node3.kind === "removeStatus") requireThat(Boolean(node3.statusId) !== Boolean(node3.category), "DSL removeStatus selector");
    if (node3.statusId) {
      const template = getStatusTemplate(state, node3.statusId);
      requireThat(template, `DSL status ${node3.statusId}`);
      if (node3.modifiers) validateStatusModifiers(template, node3.modifiers);
      if (node3.stacks && !has(STATUSES, node3.statusId)) requireThat(node3.stacks <= template.maxStacks, "DSL status stacks");
      if (node3.amount != null) requireThat(node3.statusId === "shield" && int(node3.amount, 1, 1e4), "DSL status amount");
    }
    if (node3.initial != null) requireThat(node3.cap != null && node3.initial <= node3.cap, "DSL resource initial");
  }
}
function effects(v, state) {
  requireThat(Array.isArray(v) && v.length <= 24, "effects");
  const seen = /* @__PURE__ */ new Set();
  for (const e of v) {
    validateEffect(e, state);
    requireThat(!seen.has(e.id), "\u91CD\u590D\u7279\u6548");
    seen.add(e.id);
  }
}
function equipmentTemplate(v, state) {
  fields(v, ["name", "effects"], ["quality", "kind", "weaponClass", "hand", "rangeType", "ranged", "heavy", "twoHanded", "shield", "range", "accuracy", "attack", "damage", "armor", "defense", "boundTo", "weaponType"]);
  checkOptional(v, "boundTo", id2);
  checkOptional(v, "weaponType", text);
  requireThat(text(v.name), "name");
  checkOptional(v, "quality", (x) => ["\u552F\u4E00", "\u666E\u901A", "\u4F18\u826F", "\u7A00\u6709", "\u53F2\u8BD7", "\u4F20\u8BF4", "\u795E\u8BDD"].includes(x));
  checkOptional(v, "range", (x) => int(x, 1, 15));
  checkOptional(v, "attack", (x) => int(x, 0, 1e9));
  checkOptional(v, "accuracy", (x) => int(x, -20, 30));
  checkOptional(v, "armor", (x) => int(x, 0, 1e6));
  checkOptional(v, "defense", (x) => int(x, 0, 1e6));
  checkOptional(v, "kind", (x) => ["weapon", "shield", "armor", "accessory", "consumable"].includes(x));
  checkOptional(v, "weaponClass", (x) => ["light_blade", "ranged", "greatsword", "staff", "shield", "auxiliary"].includes(x));
  checkOptional(v, "hand", (x) => ["one_handed", "two_handed", "off_hand"].includes(x));
  checkOptional(v, "rangeType", (x) => ["melee", "ranged"].includes(x));
  for (const field of ["ranged", "heavy", "twoHanded", "shield"]) checkOptional(v, field, (x) => typeof x === "boolean");
  if (own2(v, "damage")) dice2(v.damage);
  requireThat(own2(v, "range") === own2(v, "damage"), "\u6B66\u5668 range/damage");
  effects(v.effects, state);
  const pools = resourceDefinitions(v);
  requireThat(new Set(pools.map((pool) => pool.resource)).size === pools.length, "DSL \u91CD\u590D\u8D44\u6E90\u6C60");
}
function skillTemplate(v, state) {
  fields(v, ["name", "ap", "slot", "range", "shape", "target", "effects"], ["quality", "power", "mp", "sp", "radius", "width", "accuracy", "save", "saveDC", "damage", "heal", "resourceCost", "school"]);
  checkOptional(v, "school", text);
  checkOptional(v, "resourceCost", resourceCost);
  requireThat(text(v.name) && int(v.ap, 1, 2) && ["attack", "action"].includes(v.slot) && int(v.range, 0, 15) && ["single", "circle", "fan", "cone", "line"].includes(v.shape) && ["enemy", "ally", "self", "any", "corpse"].includes(v.target), "\u6280\u80FD");
  checkOptional(v, "power", (x) => int(x, 0, 1e9));
  for (const k of ["mp", "sp"]) checkOptional(v, k, (x) => int(x, 0, 25e3));
  for (const k of ["radius", "width"]) checkOptional(v, k, (x) => int(x, 0, 6));
  checkOptional(v, "accuracy", (x) => int(x, -20, 30));
  checkOptional(v, "save", (x) => attrs.includes(x));
  checkOptional(v, "saveDC", validSaveDC);
  requireThat(own2(v, "save") === own2(v, "saveDC"), "save/saveDC");
  for (const k of ["damage", "heal"]) if (own2(v, k)) dice2(v[k]);
  effects(v.effects, state);
}
function statusValue(v, key3, state) {
  const t = getStatusTemplate(state, key3);
  requireThat(id2(key3) && t, "\u72B6\u6001 ID");
  fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers", "stacks", "sourceUnitId"], ["appliedRound", "appliedTurn", "amount", "expireInto", "expireOn"]);
  checkOptional(v, "expireOn", (x) => x === null || validExpireOn(x));
  requireThat(v.expireInto === t.expireInto, "\u72B6\u6001\u5230\u671F\u76EE\u6807");
  requireThat(v.id === key3 && statusLabels.every((k) => v[k] === t[k]) && statusLifetime(v) && int(v.maxStacks, 1, t.maxStacks) && int(v.stacks, 1, v.maxStacks) && (v.sourceUnitId === null || id2(v.sourceUnitId)), "\u72B6\u6001\u5B9E\u4F8B");
  fields(v.modifiers, Object.keys(t.modifiers));
  validateStatusModifiers(t, v.modifiers);
  checkOptional(v, "appliedRound", (x) => int(x, 1, 1e6));
  checkOptional(v, "appliedTurn", (x) => int(x, 0, 199));
  requireThat(key3 === "shield" ? int(v.amount, 1, 1e9) : !own2(v, "amount"), "\u62A4\u76FE\u6C60");
}
function validateCell(v) {
  fields(v, ["kind", "z"]);
  requireThat(["floor", "slope", "wall"].includes(v.kind) && int(v.z, -4, 8), "\u5730\u5F62");
}
var unitKeys = ["id", "name", "team", "x", "y", "facing", "hp", "maxHp", "mp", "maxMp", "sp", "maxSp", "ap", "used", "stats", "armor", "size", "move", "weapon", "gear", "skills", "statuses"];
var protocolUnitKeys = ["mainHand", "offHand", "shield", "bodyLengthM", "tier", "mc", "nonLethal", "intent", "bonusDice", "penaltyDice", "stance", "moraleType", "moraleState", "greatswordMode", "parryQuota", "parryRefunded", "attunementCharges", "blockMode", "initiativePercent", "attackInit", "actionInit", "flatInitiative", "lockedTargetId", "deathrattle", "deathrattleTriggered", "moraleCheckedRound", "maneuvers"];
function unitValue(v, key3, state) {
  fields(v, unitKeys, ["reactionAvailable", ...protocolUnitKeys, "fled", "diedAt", "corpseOf", "corpseConsumed", "creatureType", "tags", "resources", "inventory", "effectUsage", "effectModifiers"]);
  for (const k of ["fled", "corpseConsumed"]) checkOptional(v, k, (x) => typeof x === "boolean");
  checkOptional(v, "corpseOf", id2);
  checkOptional(v, "diedAt", (x) => plain(x) && Object.keys(x).length === 2 && int(x.round, 1, state.round) && int(x.turn, 0, 199));
  checkOptional(v, "creatureType", (x) => text(x) || Array.isArray(x) && x.length <= 12 && Array.from(x).every((t) => text(t)));
  if (own2(v, "tags")) list(v.tags, 32, (x) => text(x), "tags");
  for (const k of ["resources", "inventory"]) if (own2(v, k)) table2(v[k], (x) => requireThat(int(x, 0, 1e9), k));
  for (const k of ["effectUsage", "effectModifiers"]) if (own2(v, k)) {
    requireThat(plain(v[k]) && Object.keys(v[k]).length <= 1e3 && jsonTree(v[k]), k);
    for (const entry of Object.values(v[k])) {
      if (k === "effectUsage") {
        fields(entry, ["count", "round"]);
        requireThat(int(entry.count, 1, 1e6) && int(entry.round, 1, state.round), k);
      } else {
        fields(entry, ["stat", "flat", "percent", "turns", "round", "turn"], ["damageType"]);
        checkOptional(entry, "damageType", (x) => damageTypes.includes(x));
        requireThat(int(entry.round, 1, state.round) && int(entry.turn, 0, 199), k);
        requireThat(text(entry.stat) && num(entry.flat, -1e9, 1e9) && num(entry.percent, -1, 10) && int(entry.turns, 1, 100), k);
      }
    }
  }
  checkOptional(v, "reactionAvailable", (x) => typeof x === "boolean");
  requireThat(v.id === key3 && text(v.name) && team(v.team) && coord(v.x) && coord(v.y), "\u68CB\u5B50");
  list(v.facing, 2, (x) => int(x, -1, 1), "\u671D\u5411");
  requireThat(v.facing.length === 2 && v.facing.some(Boolean), "\u671D\u5411");
  for (const [r, max] of [["hp", "maxHp"], ["mp", "maxMp"], ["sp", "maxSp"]]) requireThat(int(v[max], r === "hp" ? 1 : 0, 1e9) && int(v[r], 0, v[max]), r);
  fields(v.used, ["action", "attack"]);
  fields(v.stats, attrs);
  requireThat(attrs.every((k) => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2) && int(v.armor, 0, 1e6) && int(v.size, 1, 5) && int(v.move, 1, 10), "\u5355\u4F4D\u6570\u503C");
  requireThat(v.weapon === null || id2(v.weapon), "weapon");
  for (const slot of ["mainHand", "offHand", "shield"]) checkOptional(v, slot, (x) => x === null || id2(x));
  checkOptional(v, "bodyLengthM", (x) => num(x, 0.01, 1e9));
  checkOptional(v, "tier", (x) => int(x, 1, 7));
  checkOptional(v, "mc", (x) => int(x, 1, 64));
  checkOptional(v, "nonLethal", (x) => typeof x === "boolean");
  checkOptional(v, "deathrattle", (x) => plain(x) && typeof x.kind === "string");
  checkOptional(v, "deathrattleTriggered", (x) => typeof x === "boolean");
  checkOptional(v, "moraleCheckedRound", (x) => int(x, 1, 1e6));
  checkOptional(v, "maneuvers", (x) => Array.isArray(x) && x.length <= 32 && x.every(id2));
  checkOptional(v, "initiativePercent", (x) => num(x, -1, 10));
  checkOptional(v, "flatInitiative", (x) => int(x, -1e3, 1e3));
  for (const field of ["attackInit", "actionInit"]) checkOptional(v, field, (x) => Array.isArray(x) && x.length <= 16 && x.every((n) => int(n, -1e3, 1e3)));
  checkOptional(v, "lockedTargetId", (x) => x === null || id2(x));
  checkOptional(v, "intent", (x) => typeof x === "string" && ["normal", "function", "core", "kill", "concept"].includes(x));
  checkOptional(v, "bonusDice", (x) => int(x, 0, 2));
  checkOptional(v, "penaltyDice", (x) => int(x, 0, 1));
  checkOptional(v, "stance", (x) => typeof x === "string");
  checkOptional(v, "moraleType", (x) => typeof x === "string");
  checkOptional(v, "moraleState", (x) => typeof x === "string");
  checkOptional(v, "greatswordMode", (x) => ["offensive", "defensive"].includes(x));
  checkOptional(v, "parryQuota", (x) => int(x, 0, 2));
  checkOptional(v, "parryRefunded", (x) => typeof x === "boolean");
  checkOptional(v, "attunementCharges", (x) => int(x, 0, 2));
  checkOptional(v, "blockMode", (x) => ["normal", "heavy"].includes(x));
  list(v.gear, 12, id2, "gear");
  list(v.skills, 32, id2, "skills");
  table2(v.statuses, (status2, statusId2) => statusValue(status2, statusId2, state), maxStatusTemplates + Object.keys(STATUSES).length);
}
function jsonTree(v, depth = 0) {
  if (depth > 12) return false;
  if (v === null || ["string", "boolean"].includes(typeof v) || Number.isFinite(v)) return true;
  if (Array.isArray(v)) return v.length <= 500 && Array.from(v).every((x) => jsonTree(x, depth + 1));
  return plain(v) && Object.keys(v).length <= 250 && Object.entries(v).every(([key3, x]) => !own2(Object.prototype, key3) && jsonTree(x, depth + 1));
}
function validateState(s) {
  fields(s, ["scenarioId", "title", "mode", "ruleset", "round", "turn", "order", "units", "items", "equipment", "skills", "grid", "covers", "interactives", "rng", "logs", "outcome"], ["statusTemplates", "zones", "time", "effectTemplates", "summonTemplates"]);
  if (own2(s, "time")) {
    fields(s.time, ["raw", "hour", "minute", "timeOfDay", "calendar"]);
    requireThat(text(s.time.raw, 500) && typeof s.time.calendar === "string" && s.time.calendar.length <= 500 && int(s.time.hour, 0, 23) && int(s.time.minute, 0, 59) && s.time.timeOfDay === timeOfDay(s.time.hour, s.time.minute), "time");
  }
  if (own2(s, "effectTemplates")) table2(s.effectTemplates, (e, key3) => {
    requireThat(isExpression(e) && e.id === key3, "effectTemplates");
    validateEffect(e, s);
  });
  if (own2(s, "summonTemplates")) table2(s.summonTemplates, (u, key3) => {
    unitValue(u, key3, s);
    requireThat(u.skills.every((skill2) => has(s.skills, skill2)), "summon skills");
  });
  if (own2(s, "statusTemplates")) statusTemplateTable(s.statusTemplates);
  requireThat(id2(s.scenarioId) && text(s.title) && ["free", "split"].includes(s.mode) && ["protocol", "sandbox"].includes(s.ruleset) && int(s.round, 1, 1e6) && int(s.rng, 0, 4294967295) && [null, "blue", "red", "draw"].includes(s.outcome), "\u6218\u5C40");
  requireThat(Array.isArray(s.grid) && s.grid.length === 10, "\u68CB\u76D8");
  for (const row of s.grid) {
    requireThat(Array.isArray(row) && row.length === 10, "\u68CB\u76D8\u884C");
    for (const c of row) validateCell(c);
  }
  table2(s.equipment, (v) => equipmentTemplate(v, s));
  table2(s.skills, (v) => skillTemplate(v, s));
  const expressions = [...Object.values(s.effectTemplates ?? {}), ...[...Object.values(s.equipment), ...Object.values(s.skills)].flatMap((t) => t.effects.filter(isExpression))];
  const byId4 = new Map(expressions.map((expr) => [expr.id, expr]));
  requireThat(byId4.size === expressions.length, "DSL \u5168\u5C40\u6548\u679C ID \u91CD\u590D");
  const checked = /* @__PURE__ */ new Set();
  function checkReferences(expr, path = /* @__PURE__ */ new Set()) {
    requireThat(!path.has(expr.id), `DSL \u5FAA\u73AF\u5F15\u7528 ${expr.id}`);
    if (checked.has(expr.id)) return;
    path.add(expr.id);
    for (const node3 of effectNodes(expr.effects)) if (node3.kind === "procEffect") {
      requireThat(byId4.has(node3.ref), `DSL \u672A\u77E5\u5F15\u7528 ${node3.ref}`);
      checkReferences(byId4.get(node3.ref), path);
    }
    path.delete(expr.id);
    checked.add(expr.id);
  }
  expressions.forEach((expr) => checkReferences(expr));
  table2(s.items, (v, k) => {
    fields(v, ["id", "templateId", "counters"]);
    requireThat(v.id === k && has(s.equipment, v.templateId), "\u88C5\u5907\u5B9E\u4F8B");
    const counters = resourceDefinitions(s.equipment[v.templateId]);
    fields(v.counters, counters.map((e) => e.resource));
    for (const e of counters) requireThat(int(v.counters[e.resource], 0, e.cap), "\u8BA1\u6570\u5668");
  });
  table2(s.covers, (v, k) => {
    fields(v, ["id", "name", "x", "y", "material", "hp", "maxHp", "cover"]);
    requireThat(v.id === k && text(v.name) && text(v.material) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== "wall" && int(v.maxHp, 1, 1e9) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), "\u63A9\u4F53");
  });
  table2(s.zones ?? {}, (v, k) => {
    fields(v, ["id", "name", "x", "y", "radius", "remainingTurns", "damage", "damageType", "team"]);
    requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && int(v.radius, 0, 10) && int(v.remainingTurns, 1, 100) && int(v.damage, 0, 1e9) && ["physical", "energy", "mental", "true"].includes(v.damageType) && ["blue", "red", "all"].includes(v.team), "\u6301\u7EED\u533A\u57DF");
  }, 64);
  table2(s.interactives, (v, k) => {
    fields(v, ["id", "name", "x", "y", "kind", "spent"]);
    requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== "wall" && ["barrel", "altar"].includes(v.kind) && typeof v.spent === "boolean", "\u4E92\u52A8\u70B9");
  });
  const occupied = /* @__PURE__ */ new Set(), equipped2 = /* @__PURE__ */ new Set();
  table2(s.units, (v, k) => {
    unitValue(v, k, s);
    const point = `${v.x},${v.y}`;
    if (v.hp > 0) {
      requireThat(!occupied.has(point) && s.grid[v.y][v.x].kind !== "wall" && !Object.values(s.covers).some((c) => c.hp > 0 && c.x === v.x && c.y === v.y), "\u68CB\u5B50\u4F4D\u7F6E\u91CD\u53E0\u6216\u963B\u6321");
      occupied.add(point);
    }
    const slots = [v.weapon, v.mainHand, v.offHand, v.shield, ...v.gear].filter(Boolean);
    for (const i of new Set(slots)) {
      const template = has(s.items, i) ? s.equipment[s.items[i].templateId] : null;
      const weaponSlot = i === v.weapon || i === v.mainHand || i === v.offHand;
      const isShieldSlot = i === v.shield;
      const isDamageItem = Boolean(template && own2(template, "damage"));
      requireThat(has(s.items, i) && !equipped2.has(i) && (weaponSlot ? isDamageItem || template?.kind === "consumable" : isShieldSlot ? template?.kind === "shield" : true), "\u88C5\u5907\u5F15\u7528\u6216\u5F52\u5C5E");
      equipped2.add(i);
    }
    requireThat(v.skills.every((i) => has(s.skills, i)) && new Set(v.skills).size === v.skills.length, "\u6280\u80FD\u5F15\u7528");
  });
  list(s.order, 200, (x) => has(s.units, x), "\u5148\u653B\u961F\u5217");
  requireThat(new Set(s.order).size === s.order.length && int(s.turn, 0, Math.max(0, s.order.length - 1)) && Object.values(s.units).every((u) => u.hp <= 0 || s.order.includes(u.id)), "\u5148\u653B\u7D22\u5F15");
  requireThat(Array.isArray(s.logs) && s.logs.length <= 1e5, "\u65E5\u5FD7");
  for (const log of s.logs) {
    fields(log, ["round", "actor", "type", "text", "detail"]);
    requireThat(int(log.round, 1, s.round) && (log.actor === null || id2(log.actor)) && text(log.type, 64) && text(log.text, 1e3) && jsonTree(log.detail), "\u65E5\u5FD7\u4E8B\u4EF6");
  }
  return s;
}

// src/presets/scenarios.js
var SCENARIOS = Object.freeze({
  ruins: { title: "\u5E9F\u589F\u4F0F\u51FB\u6218", description: "\u6298\u65AD\u7684\u77F3\u5899\u6321\u4F4F\u89C6\u7EBF\u3002\u5148\u5904\u7406\u53D7\u4F24\u7684\u65A5\u5019\uFF0C\u8BD5\u7528\u7130\u5370\uFF0C\u518D\u4ECE\u4FA7\u7FFC\u7ED5\u8FC7\u8DEF\u969C\u3002", seed: 17 },
  altar: { title: "\u9AD8\u53F0\u796D\u575B\u593A\u53D6\u6218", description: "\u5761\u9053\u662F\u4E0A\u53F0\u7684\u6377\u5F84\uFF1B\u6FC0\u6D3B\u796D\u575B\u53EF\u83B7\u5F97\u62A4\u76FE\u4E0E\u75BE\u8D70\uFF0C\u9AD8\u53F0\u8FDC\u5C04\u6709\u989D\u5916\u5C04\u7A0B\u3002", seed: 43 },
  boss: { title: "BOSS \u4E0E\u6742\u5175\u6DF7\u7F16\u6218", description: "\u5B88\u95E8\u5DE8\u50CF\u62A4\u7532\u539A\u3001\u4F53\u578B\u5927\u3002\u5148\u62C6\u63F4\u519B\uFF0C\u518D\u7528\u51C0\u5316\u3001\u7A7F\u7532\u548C\u51FB\u9000\u5206\u644A\u538B\u529B\u3002", seed: 83 }
});
var own3 = (obj, key3) => Object.hasOwn(obj, key3);
var object2 = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
var safeId = (id3) => typeof id3 === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id3) && !own3(Object.prototype, id3) && id3 !== "prototype";
var entries = (record2) => {
  if (!object2(record2) || Object.keys(record2).length > 200 || !Object.keys(record2).every(safeId)) throw new Error("\u8DE8\u6218\u6863\u6848 ID \u65E0\u6548");
  return Object.entries(record2);
};
function importCarry(state, value) {
  fields(value, ["kind", "version", "items", "units"], ["statusTemplates"]);
  if (value.version !== 1 || value.kind !== "persistent") throw new Error("\u65E0\u6548\u7684\u8DE8\u6218\u6863\u6848");
  const carry = structuredClone(value);
  if (own3(carry, "statusTemplates")) {
    statusTemplateTable(carry.statusTemplates);
    state.statusTemplates = carry.statusTemplates;
  }
  for (const [id3, item] of entries(carry.items)) {
    if (!object2(item) || item.id !== id3 || !own3(state.equipment, item.templateId) || !object2(item.counters)) throw new Error(`\u65E0\u6548\u7684\u8DE8\u6218\u88C5\u5907\uFF1A${id3}`);
    if (!own3(state.items, id3) || state.items[id3].templateId === item.templateId) state.items[id3] = item;
    else throw new Error(`\u8DE8\u6218\u88C5\u5907\u6A21\u677F\u51B2\u7A81\uFF1A${id3}`);
  }
  const assigned = /* @__PURE__ */ new Set();
  const imported = [];
  for (const [id3, unit] of entries(carry.units)) {
    if (!object2(unit) || !["weapon", "gear", "statuses"].every((slot) => own3(unit, slot)) || !Array.isArray(unit.gear) || Object.keys(unit).some((key3) => !["weapon", "gear", "statuses", "mainHand", "offHand", "shield"].includes(key3))) throw new Error(`\u65E0\u6548\u7684\u8DE8\u6218\u5355\u4F4D\uFF1A${id3}`);
    const statuses = Object.fromEntries(entries(unit.statuses).map(([key3, status2]) => {
      if (!object2(status2) || status2.durationType !== "persistent") throw new Error(`\u8DE8\u6218\u72B6\u6001\u5FC5\u987B\u5E38\u9A7B\uFF1A${key3}`);
      statusValue(status2, key3, state);
      return [key3, status2];
    }));
    for (const [instanceId, isWeapon] of [[unit.weapon, true], ...[unit.mainHand, unit.offHand].filter(Boolean).map((i) => [i, true]), ...[unit.shield].filter(Boolean).map((i) => [i, true]), ...unit.gear.map((i) => [i, false])]) {
      if (instanceId === null && isWeapon) continue;
      if (!safeId(instanceId) || !own3(carry.items, instanceId) || assigned.has(instanceId) || own3(state.equipment[state.items[instanceId].templateId], "damage") !== isWeapon) throw new Error(`\u8DE8\u6218\u88C5\u5907\u5F52\u5C5E\u65E0\u6548\uFF1A${instanceId}`);
      assigned.add(instanceId);
    }
    if (own3(state.units, id3)) imported.push([id3, { statuses, weapon: unit.weapon, mainHand: unit.mainHand ?? unit.weapon, offHand: unit.offHand ?? null, shield: unit.shield ?? null, gear: unit.gear }]);
  }
  for (const u of Object.values(state.units)) {
    for (const slot of ["weapon", "mainHand", "offHand", "shield"]) if (assigned.has(u[slot])) u[slot] = null;
    u.gear = u.gear.filter((i) => !assigned.has(i));
  }
  for (const [id3, patch] of imported) Object.assign(state.units[id3], patch);
}
function buildScenario(request = "ruins") {
  if (request?.kind === "custom_state" && object2(request.state)) return migrateStateEffects(structuredClone(request.state));
  if (typeof request === "string") request = { scenarioId: request };
  if (!object2(request) || !Object.keys(request).every((key3) => ["scenarioId", "seed", "mode", "ruleset", "persistentSnapshot"].includes(key3))) throw new Error("\u65E0\u6548\u7684\u5F00\u5C40\u53C2\u6570");
  const { scenarioId = "ruins", mode = "free", ruleset = "protocol", persistentSnapshot } = request;
  if (typeof scenarioId !== "string" || !own3(SCENARIOS, scenarioId)) throw new Error("\u672A\u77E5\u9884\u8BBE\u5173\u5361");
  const { title, seed: defaultSeed } = SCENARIOS[scenarioId];
  const seed = request.seed ?? defaultSeed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || !["free", "split"].includes(mode) || !["protocol", "sandbox"].includes(ruleset)) throw new Error("\u65E0\u6548\u7684\u79CD\u5B50\u6216\u884C\u52A8\u89C4\u5219");
  const state = {
    scenarioId,
    title,
    mode,
    ruleset,
    round: 1,
    turn: 0,
    order: [],
    units: {},
    items: {},
    equipment: structuredClone(EQUIPMENT),
    skills: structuredClone(SKILLS),
    grid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: "floor", z: 0 }))),
    covers: {},
    interactives: {},
    zones: {},
    rng: seed,
    logs: [],
    outcome: null
  };
  function unit(id3, name, team2, x, y, weapon, skills, options = {}) {
    const { hp = 32, agi = 5, str = 4, con = 4, int: int2 = 4, spi = 4, armor = 1, size = 1, gear = [], weaponId = `${id3}-weapon`, offHandTemplate = null, shieldTemplate = null } = options;
    const equip = (id4, templateId) => {
      const counters = initialCounters(state.equipment[templateId]);
      state.items[id4] = { id: id4, templateId, counters };
      return id4;
    };
    const offHand = offHandTemplate ? equip(`${id3}-offhand`, offHandTemplate) : null;
    const shield = shieldTemplate ? equip(`${id3}-shield`, shieldTemplate) : null;
    const stance = shield ? "sword_shield" : offHandTemplate === "potion" ? "attunement" : offHand ? "dual_wield" : state.equipment[weapon]?.weaponClass === "greatsword" ? "greatsword" : "light_blade";
    const resources = ruleset === "protocol" ? calculatePrebattleResources({ stats: { str, agi, con, int: int2, spi }, tier: 1, bodyLengthM: 1.7 }).resources : null;
    const hpValue = resources?.hp.current ?? hp, mpValue = resources?.mp.current ?? 14, spValue = resources?.sp.current ?? 10;
    state.units[id3] = {
      id: id3,
      name,
      team: team2,
      x,
      y,
      facing: [team2 === "blue" ? 1 : -1, 0],
      hp: hpValue,
      maxHp: resources?.hp.max ?? hpValue,
      mainHand: weaponId,
      offHand,
      shield,
      tier: 1,
      bodyLengthM: 1.7,
      mc: 1,
      bonusDice: 0,
      penaltyDice: 0,
      intent: "normal",
      nonLethal: false,
      stance,
      greatswordMode: "offensive",
      parryQuota: stance === "greatsword" ? 2 : 0,
      parryRefunded: false,
      attunementCharges: stance === "attunement" ? 2 : 0,
      moraleType: "standard",
      mp: mpValue,
      maxMp: resources?.mp.max ?? mpValue,
      sp: spValue,
      maxSp: resources?.sp.max ?? spValue,
      ap: 0,
      used: { attack: 0, action: 0 },
      stats: { str, agi, con, int: int2, spi },
      armor,
      size,
      move: 3,
      statuses: {},
      weapon: equip(weaponId, weapon),
      gear: gear.map((templateId) => equip(`${id3}-${templateId}`, templateId)),
      skills
    };
  }
  function wall(x, y) {
    state.grid[y][x].kind = "wall";
  }
  function cover(id3, x, y, material, hp, shielding) {
    state.covers[id3] = { id: id3, name: `${material}\u63A9\u4F53`, material, x, y, hp, maxHp: hp, cover: shielding };
  }
  function interact(id3, x, y, kind) {
    state.interactives[id3] = { id: id3, name: kind === "barrel" ? "\u4F59\u70EC\u7206\u6876" : "\u661F\u8F89\u796D\u575B", x, y, kind, spent: false };
  }
  function heroes(x, y) {
    unit(
      "swordsman",
      "\u5C9A \xB7 \u566C\u9B42\u5251\u5BA2",
      "blue",
      x,
      y,
      "soulblade",
      ["brand", "surge", "challenge", "armor"],
      { hp: 44, agi: 21, str: 7, con: 6, gear: ["frostplate"], weaponId: "soulblade-lan" }
    );
    unit("ranger", "\u6816 \xB7 \u6E38\u4FA0", "blue", x, y + 2, "revolver", ["shift", "fan", "blink"], { hp: 35, agi: 9, offHandTemplate: "shortblade" });
    unit(
      "oracle",
      "\u7EEE \xB7 \u5723\u548F\u672F\u5E08",
      "blue",
      x - 1,
      y + 1,
      "staff",
      ["hymn", "cleanse", "frost", "ward", "beam"],
      { hp: 34, int: 7, spi: 7, gear: ["hymnal"], offHandTemplate: "potion" }
    );
  }
  if (scenarioId === "ruins") {
    heroes(1, 2);
    unit("scout", "\u53D7\u4F24\u65A5\u5019", "red", 3, 2, "bloodfang", ["fan"], { hp: 4 });
    unit("gunner", "\u5E9F\u589F\u67AA\u624B", "red", 7, 3, "crossbow", ["challenge"], { hp: 27, agi: 7 });
    unit("raider", "\u4F0F\u51FB\u9996\u9886", "red", 6, 6, "bloodfang", ["blink", "fan"], { hp: 38, str: 5, agi: 8 });
    [[5, 1], [5, 2], [5, 3], [5, 4], [4, 6], [4, 7], [3, 7]].forEach(([x, y]) => wall(x, y));
    cover("C1", 4, 2, "\u7802\u5CA9", 16, 3);
    cover("C2", 2, 5, "\u65E7\u6728", 9, 2);
    cover("C3", 8, 4, "\u77F3\u7816", 19, 3);
    cover("C4", 6, 8, "\u65E7\u94C1", 13, 2);
    interact("I1", 2, 3, "altar");
    interact("I2", 7, 6, "barrel");
    interact("I3", 8, 2, "barrel");
    interact("I4", 3, 8, "altar");
  } else if (scenarioId === "altar") {
    heroes(1, 3);
    for (let y = 2; y <= 6; y++) for (let x = 4; x <= 7; x++) state.grid[y][x].z = 2;
    state.grid[4][3] = { kind: "slope", z: 1 };
    state.grid[5][8] = { kind: "slope", z: 1 };
    wall(4, 2);
    wall(7, 6);
    wall(2, 7);
    wall(2, 8);
    unit("sentinel", "\u796D\u575B\u536B\u58EB", "red", 4, 4, "pike", ["challenge", "armor"], { hp: 39, armor: 3 });
    unit("seer", "\u9AD8\u53F0\u5492\u5E08", "red", 6, 3, "staff", ["toxin", "curse", "beam"], { hp: 29 });
    unit("lookout", "\u5854\u9876\u5F29\u624B", "red", 8, 5, "crossbow", ["shift"], { hp: 29 });
    cover("C1", 5, 3, "\u796D\u77F3", 17, 3);
    cover("C2", 3, 5, "\u65E7\u6728", 10, 2);
    cover("C3", 8, 3, "\u9752\u94DC", 20, 3);
    cover("C4", 6, 6, "\u7802\u5CA9", 14, 2);
    interact("I1", 5, 4, "altar");
    interact("I2", 8, 4, "barrel");
    interact("I3", 4, 6, "barrel");
    interact("I4", 2, 2, "altar");
  } else {
    heroes(1, 4);
    unit("colossus", "\u94DC\u68FA\u5B88\u95E8\u5DE8\u50CF", "red", 6, 4, "pike", ["surge", "challenge", "armor"], { hp: 140, armor: 5, size: 3, str: 9, con: 8, bodyLengthM: 10, mc: 2, deathrattle: { kind: "zone", name: "\u5893\u706B\u4F59\u70EC", radius: 1, remainingTurns: 2, amount: 2, damageType: "energy", team: "all" } });
    unit("acolyte", "\u68FA\u5EAD\u796D\u53F8", "red", 8, 5, "staff", ["ward", "hymn", "curse"], { hp: 32, spi: 7 });
    unit("knife", "\u5893\u9053\u523A\u5BA2", "red", 5, 7, "bloodfang", ["blink", "fan"], { hp: 29, agi: 8 });
    unit("rifle", "\u91CD\u5F29\u4F8D\u4ECE", "red", 8, 2, "crossbow", ["shift"], { hp: 28 });
    [[4, 3], [4, 5], [4, 6], [7, 3], [7, 6], [1, 1]].forEach(([x, y]) => wall(x, y));
    cover("C1", 3, 4, "\u68FA\u77F3", 20, 3);
    cover("C2", 5, 2, "\u94A2\u677F", 18, 3);
    cover("C3", 5, 5, "\u6728\u7BB1", 10, 2);
    cover("C4", 8, 6, "\u68FA\u77F3", 20, 3);
    state.zones["Z1"] = { id: "Z1", name: "\u5893\u706B\u9886\u57DF", x: 7, y: 4, radius: 1, remainingTurns: 99, damage: 2, damageType: "energy", team: "all" };
    interact("I1", 6, 5, "barrel");
    interact("I2", 4, 7, "altar");
    interact("I3", 7, 2, "barrel");
    interact("I4", 2, 4, "altar");
  }
  state.items["soulblade-spare"] = { id: "soulblade-spare", templateId: "soulblade", counters: { souls: 0 } };
  if (persistentSnapshot !== void 0) {
    importCarry(state, persistentSnapshot);
    state.order = Object.keys(state.units);
    validateState(state);
  }
  return beginBattle(state);
}

// src/core/ai.js
var END = Object.freeze({ type: "end" });
var byId3 = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var healthGap = (unit) => unit.maxHp - unit.hp;
var samePosition = (a, b) => a.x === b.x && a.y === b.y;
var canSee = (state, actor, target2) => !target2.statuses.stealth || gridDistance(actor, target2) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target2)) <= 1;
function tactics(state, actor, action, plan) {
  const skill2 = action.type === "skill" ? state.skills[action.skillId] : void 0;
  if (action.type === "interact" && plan.kind === "altar") return 4 + Math.min(8, healthGap(actor)) * 0.95 + Math.min(5, actor.maxMp - actor.mp) * 0.55;
  let score = 0;
  for (const profile of plan.targets ?? []) {
    if (profile.kind === "cover") {
      const cover = state.covers[profile.id];
      score += 0.5 + Math.min(cover.hp, profile.expectedDamage) * 0.12;
      continue;
    }
    const target2 = state.units[profile.recipientId ?? profile.id];
    if (!target2) continue;
    const enemy = target2.team !== actor.team;
    const sign = enemy ? 1 : target2 === actor ? -1.5 : -1.15;
    const damage = profile.expectedDamage ?? 0;
    const kill = profile.damageMax >= target2.hp ? Math.min(profile.hitChance ?? 1, damage / target2.hp) : 0;
    score += sign * (Math.min(target2.hp, damage) + kill * 6);
    if (profile.heal) {
      const healing = (profile.heal[0] + profile.heal[1]) / 2;
      score -= sign * (Math.min(healthGap(target2), healing) * 0.9 + (profile.healingShield?.[0] ?? 0) * (target2.statuses.shield ? 0.14 : 0.34));
    }
    for (const effect of skill2?.effects ?? []) {
      const applied = effect.target === "self" || enemy && effect.statusId === "stealth" ? actor : target2;
      const existing = applied.statuses[effect.statusId];
      const useful = !existing || existing.stackRule === "stack" && existing.stacks < existing.maxStacks;
      const chance = (profile.hitChance ?? 1) * (1 - (profile.saveChance ?? 0));
      const nearbyEnemy = Object.values(state.units).some((u) => u.hp > 0 && u.team !== applied.team && dist(u, applied) < 4.5);
      if (effect.kind === "cleanse") {
        const bad = Object.values(applied.statuses).filter((s) => s.durationType !== "persistent" && ["dot", "control", "debuff"].includes(s.category));
        score += bad.reduce((total, s) => total + (s.category === "control" ? 6 : 3), 0);
      } else if (effect.kind === "knockback") score += enemy ? 2 * chance : -2;
      else if (effect.kind === "status" && useful) {
        const weights = {
          stun: 8,
          freeze: 8,
          burn: 4,
          bleed: 3,
          poison: 4,
          chill: 2,
          blind: 2.5,
          root: 3,
          mark: 2,
          sunder: 3,
          vulnerable: 3,
          taunt: 1,
          regen: Math.min(healthGap(applied) * 0.2, 4),
          shield: nearbyEnemy ? 3 : 0.25,
          haste: nearbyEnemy ? 2 : 0.5,
          guarded: nearbyEnemy ? 3 : 0.25,
          guard: nearbyEnemy ? 2 : 0.25,
          thorns: nearbyEnemy ? 3 : 0.25,
          stealth: nearbyEnemy ? 2.5 : 0.5
        };
        score += (weights[effect.statusId] ?? 1) * chance * (applied.team !== actor.team && !enemy ? -1 : 1);
      }
    }
  }
  return score / (plan.ap === 2 ? 1.35 : 1) - plan.mp * 0.35 - plan.sp * 0.25;
}
function aimedOptions(state, actor, attacksOnly = false) {
  const units = Object.values(state.units).filter((u) => u.hp > 0).sort(byId3);
  const covers = Object.values(state.covers).filter((c) => c.hp > 0).sort(byId3);
  const choices = [];
  function consider(action) {
    const plan = preview(state, action);
    if (plan.ok) choices.push({ action, score: tactics(state, actor, action, plan) });
  }
  const enemies = units.filter((u) => u.team !== actor.team && canSee(state, actor, u));
  for (const target2 of [...enemies, ...attacksOnly ? [] : covers]) consider({ type: "attack", x: target2.x, y: target2.y });
  for (const skillId of [...actor.skills].sort()) {
    const skill2 = state.skills[skillId];
    if (!skill2 || attacksOnly && (skill2.slot !== "attack" || skill2.ap > 1)) continue;
    const query = preview(state, { type: "skill", skillId });
    if (!query.ok) continue;
    let candidates;
    if (skill2.shape === "single") {
      candidates = skill2.target === "enemy" ? enemies : skill2.target === "self" ? [actor] : units.filter((u) => skill2.target === "any" || u.team === actor.team);
    } else if (attacksOnly) {
      candidates = enemies;
    } else {
      candidates = query.cells;
    }
    for (const { x, y } of candidates) consider({ type: "skill", skillId, x, y });
  }
  if (!attacksOnly) for (const { x, y } of preview(state, { type: "interact" }).cells ?? []) consider({ type: "interact", x, y });
  return choices;
}
function approach(state, actor, enemies) {
  const weapon = state.equipment[state.items[actor.weapon]?.templateId];
  const range = weapon?.range ?? 1.5;
  const spots = [{ x: actor.x, y: actor.y, steps: 0 }, ...reachable(state, "move", actor, Infinity)];
  const clearAttackCell = (probe) => enemies.some((target2) => {
    const d = distance3D(state, probe, target2);
    if (d > range + 1) return false;
    const u = { ...actor, x: probe.x, y: probe.y, ap: 2, used: { attack: 0, action: 0 } };
    const s = { ...state, units: { ...state.units, [actor.id]: u } };
    const attack = preview(s, { type: "attack", x: target2.x, y: target2.y });
    if (attack.ok || attack.error === "\u5F39\u4ED3\u5DF2\u7A7A\uFF0C\u8BF7\u88C5\u586B" && d <= range && hasLOS(state, probe, target2)) return true;
    return false;
  });
  const pathToAttack = spots.find(clearAttackCell);
  if (pathToAttack?.steps > 0) return pathToAttack.path;
  if (pathToAttack?.steps === 0) return [];
  let best, bestValue = Infinity;
  for (const spot of spots) {
    const score = Math.min(...enemies.map((enemy) => dist(spot, enemy) + Math.abs(elevation(state, spot) - elevation(state, enemy)) * 0.7)) + spot.steps * 0.025;
    if (score < bestValue) {
      best = spot;
      bestValue = score;
    }
  }
  return best?.path ?? [];
}
function coverQuality(state, destination, enemies) {
  return Math.max(0, ...enemies.map((enemy) => (coverBetween(state, enemy, destination)?.cover ?? 0) * 0.35));
}
function chooseAction(state) {
  if (state.outcome) return null;
  const actor = currentUnit(state);
  if (!actor || !actor.hp || !actor.ap) return { ...END };
  const enemies = Object.values(state.units).filter((u) => u.hp > 0 && u.team !== actor.team).sort(byId3);
  if (!enemies.length) return { ...END };
  const visible = enemies.filter((u) => canSee(state, actor, u));
  const objectives = visible.length ? visible : enemies;
  let best = { action: END, score: 0.6 };
  function consider(choice) {
    if (choice.score > best.score + 1e-8) best = choice;
  }
  for (const choice of aimedOptions(state, actor)) consider(choice);
  const canReload = preview(state, { type: "reload" });
  if (canReload.ok) consider({ action: { type: "reload" }, score: canReload.ammo === 0 ? 7.5 : (canReload.capacity - canReload.ammo) * 0.5 });
  const plannedPath = approach(state, actor, objectives);
  const z0 = elevation(state, actor);
  const startingCover = coverQuality(state, actor, objectives);
  const baseline = Math.min(...objectives.map((u) => dist(actor, u)));
  const ordinary = preview(state, { type: "move" });
  const riskyDestinations = new Set((ordinary.cells ?? []).filter((c) => c.opportunities?.length).map((c) => `${c.x},${c.y}`));
  for (const type of ["move", "sprint", "disengage"]) {
    if (type === "disengage" && !riskyDestinations.size) continue;
    const options = type === "move" ? ordinary : preview(state, { type });
    if (!options.ok) continue;
    for (const cell of options.cells) {
      if (type === "disengage" && !riskyDestinations.has(`${cell.x},${cell.y}`)) continue;
      const projectedDepth = plannedPath.findIndex((point) => samePosition(point, cell)) + 1;
      const distance = Math.min(...objectives.map((u) => dist(cell, u)));
      const progress = baseline - distance;
      const high = elevation(state, cell) - z0;
      const cover = coverQuality(state, cell, objectives) - startingCover;
      let score = (projectedDepth ? 1.8 + projectedDepth * 0.55 : progress * 0.35) + high * 0.8 + cover;
      if (type === "sprint") score = score * 0.82 - 1.2;
      score -= (cell.opportunities?.length ?? 0) * 3.5;
      if (type === "disengage") score -= 0.2;
      const available = actor.ap - options.ap;
      if (available > 0) {
        const moved = {
          ...actor,
          x: cell.x,
          y: cell.y,
          ap: available,
          facing: facingToward(cell.path.at(-2) ?? actor, cell),
          used: { ...actor.used, action: actor.used.action + 1 }
        };
        const shadow = { ...state, units: { ...state.units, [actor.id]: moved } };
        const followup = Math.max(0, ...aimedOptions(shadow, moved, true).map((choice) => choice.score));
        if (followup > 0) score += followup * 0.84;
        if (followup === 0 && canReload.ok && canReload.ammo === 0) score -= 3;
      }
      consider({ action: { type, x: cell.x, y: cell.y }, score });
    }
  }
  const bracing = preview(state, { type: "brace" });
  if (bracing.ok && !actor.statuses.guarded && baseline <= 5) consider({ action: { type: "brace" }, score: bracing.coverId ? 2.5 : 1.4 });
  return { ...best.action };
}

// src/api/commands.js
var get = (table3, key3, label) => {
  requireThat(has(table3, key3), label);
  return table3[key3];
};
var nonempty = (patch) => requireThat(plain(patch) && Object.keys(patch).length > 0, "patch");
var commands = {
  set_unit_stat(s, c) {
    fields(c, ["type", "unitId", "patch"]);
    const u = get(s.units, c.unitId, "unitId");
    nonempty(c.patch);
    fields(c.patch, [], ["hp", "mp", "sp", "ap", "x", "y", "team", "stats", "weapon", "mainHand", "offHand", "shield", "bodyLengthM", "tier", "mc", "bonusDice", "penaltyDice", "intent", "nonLethal", "stance", "moraleType", "moraleState", "greatswordMode", "parryQuota", "parryRefunded", "attunementCharges", "blockMode", "deathrattle", "maneuvers"]);
    for (const k of ["hp", "mp", "sp", "ap", "x", "y", "team", "weapon", "mainHand", "offHand", "shield", "bodyLengthM", "tier", "mc", "bonusDice", "penaltyDice", "intent", "nonLethal", "stance", "moraleType", "moraleState", "greatswordMode", "parryQuota", "parryRefunded", "attunementCharges", "blockMode", "deathrattle", "maneuvers"]) if (own2(c.patch, k)) u[k] = c.patch[k];
    if (own2(c.patch, "stats")) {
      nonempty(c.patch.stats);
      fields(c.patch.stats, [], attrs);
      Object.assign(u.stats, c.patch.stats);
    }
    if (own2(c.patch, "mainHand")) u.weapon = c.patch.mainHand;
    if (own2(c.patch, "weapon")) u.mainHand = c.patch.weapon;
    if (own2(c.patch, "bonusDice")) u.bonusDice = Math.min(2, Math.max(0, c.patch.bonusDice));
    if (own2(c.patch, "penaltyDice")) u.penaltyDice = Math.min(1, Math.max(0, c.patch.penaltyDice));
    unitValue(u, u.id, s);
  },
  define_status_template(s, c) {
    fields(c, ["type", "template"]);
    defineStatus(s, c.template?.id, c.template);
  },
  patch_status(s, c) {
    fields(c, ["type", "unitId", "statusId", "patch"]);
    patchStatus(s, c.unitId, c.statusId, c.patch);
  },
  upsert_status(s, c) {
    fields(c, ["type", "unitId", "statusId"], ["options"]);
    const u = get(s.units, c.unitId, "unitId"), status2 = getStatusTemplate(s, c.statusId);
    requireThat(status2, "statusId");
    const options = own2(c, "options") ? c.options : {};
    fields(options, [], ["remainingTurns", "durationType", "stacks", "stackRule", "tickTiming", "amount", "sourceUnitId", "modifiers", "expireOn"]);
    checkOptional(options, "remainingTurns", (x) => int(x, 1, 100));
    checkOptional(options, "durationType", (x) => ["battle_turns", "until_removed", "persistent"].includes(x));
    checkOptional(options, "stacks", (x) => int(x, 1, status2.maxStacks));
    checkOptional(options, "stackRule", (x) => ["refresh", "stack", "replace"].includes(x));
    checkOptional(options, "tickTiming", (x) => ["onTurnStart", "onTurnEnd"].includes(x));
    checkOptional(options, "amount", (x) => c.statusId === "shield" && int(x, 1, 1e4));
    checkOptional(options, "sourceUnitId", (x) => has(s.units, x));
    if (c.statusId === "taunt") requireThat(has(s.units, options.sourceUnitId ?? u.statuses.taunt?.sourceUnitId) && s.units[options.sourceUnitId ?? u.statuses.taunt?.sourceUnitId].team !== u.team, "\u5632\u8BBD\u9700\u8981\u654C\u5BF9\u6765\u6E90");
    grantStatus(s, u, c.statusId, options);
  },
  remove_status(s, c) {
    fields(c, ["type", "unitId", "statusId"]);
    requireThat(getStatusTemplate(s, c.statusId), "statusId");
    delete get(s.units, c.unitId, "unitId").statuses[c.statusId];
  },
  adjust_item_counter(s, c) {
    fields(c, ["type", "instanceId", "counterKey", "operation", "value"]);
    const item = get(s.items, c.instanceId, "instanceId");
    requireThat(has(item.counters, c.counterKey) && ["set", "add"].includes(c.operation), "\u8BA1\u6570\u5668\u547D\u4EE4");
    const effect = resourceDefinitions(s.equipment[item.templateId]).find((e) => e.resource === c.counterKey);
    const limit = effect.cap;
    requireThat(int(c.value, -limit, limit), "\u8BA1\u6570\u5668\u547D\u4EE4");
    const next = c.operation === "set" ? c.value : item.counters[c.counterKey] + c.value;
    const cap = Math.max(effect.cap, item.counters[c.counterKey]);
    requireThat(int(next, 0, cap), `\u8BA1\u6570\u7ED3\u679C\u987B\u5728 0\u2013${cap}`);
    item.counters[c.counterKey] = next;
  },
  patch_equipment_template(s, c) {
    fields(c, ["type", "templateId", "patch"]);
    const old = get(s.equipment, c.templateId, "templateId");
    nonempty(c.patch);
    const next = { ...old, ...c.patch };
    if (Array.isArray(c.patch.effects)) next.effects = adaptLegacyEffects(next.effects, "equipment", `legacy-equipment-${c.templateId}`);
    equipmentTemplate(next, s);
    const counters = (t) => resourceDefinitions(t).map((e) => e.resource).sort().join("|");
    requireThat(counters(next) === counters(old) && own2(old, "damage") === own2(next, "damage"), "\u4E0D\u80FD\u70ED\u6539\u88C5\u5907\u69FD\u7C7B\u578B\u6216\u5B9E\u4F8B\u8BA1\u6570\u5668\u5B9A\u4E49");
    s.equipment[c.templateId] = next;
  },
  patch_skill_template(s, c) {
    fields(c, ["type", "templateId", "patch"]);
    nonempty(c.patch);
    const next = { ...get(s.skills, c.templateId, "templateId"), ...c.patch };
    if (Array.isArray(c.patch.effects)) next.effects = adaptLegacyEffects(next.effects, "skill", `legacy-skills-${c.templateId}`);
    skillTemplate(next, s);
    s.skills[c.templateId] = next;
  },
  spawn_unit(s, c) {
    fields(c, ["type", "unit"]);
    const v = c.unit;
    requireThat(plain(v) && id2(v.id) && !own2(s.units, v.id), "unit.id");
    unitValue(v, v.id, s);
    requireThat(v.hp > 0 && v.ap === 0 && v.used.action === 0 && v.used.attack === 0, "\u589E\u63F4\u987B\u5B58\u6D3B\u4E14\u884C\u52A8\u672A\u5F00\u59CB");
    v.mainHand = v.weapon;
    if (v.offHand === void 0) v.offHand = null;
    if (v.shield === void 0) v.shield = null;
    s.units[v.id] = v;
    s.order.push(v.id);
  },
  remove_unit(s, c) {
    fields(c, ["type", "unitId"]);
    get(s.units, c.unitId, "unitId");
    const index = s.order.indexOf(c.unitId);
    if (index >= 0) {
      s.order.splice(index, 1);
      if (index < s.turn) s.turn--;
      else if (s.turn >= s.order.length) {
        s.turn = 0;
        s.round++;
      }
    }
    delete s.units[c.unitId];
  },
  equip_item(s, c) {
    fields(c, ["type", "instanceId", "unitId"]);
    const instance = get(s.items, c.instanceId, "instanceId");
    const u = c.unitId === null ? null : get(s.units, c.unitId, "unitId");
    for (const v of Object.values(s.units)) {
      for (const slot of ["weapon", "mainHand", "offHand", "shield"]) if (v[slot] === instance.id) v[slot] = null;
      v.gear = v.gear.filter((i) => i !== instance.id);
    }
    if (u) {
      if (own2(s.equipment[instance.templateId], "damage")) {
        u.weapon = instance.id;
        u.mainHand = instance.id;
      } else u.gear.push(instance.id);
    }
  },
  set_zone(s, c) {
    fields(c, ["type", "zone"]);
    const z = structuredClone(c.zone);
    requireThat(plain(z) && id2(z.id), "\u533A\u57DF ID");
    const table3 = s.zones ??= {};
    table3[z.id] = z;
  },
  remove_zone(s, c) {
    fields(c, ["type", "zoneId"]);
    requireThat(has(s.zones ?? {}, c.zoneId), "\u533A\u57DF ID");
    delete s.zones[c.zoneId];
  },
  set_terrain_cell(s, c) {
    fields(c, ["type", "x", "y", "patch"]);
    requireThat(coord(c.x) && coord(c.y), "\u5750\u6807");
    nonempty(c.patch);
    const next = { ...s.grid[c.y][c.x], ...c.patch };
    validateCell(next);
    s.grid[c.y][c.x] = next;
  },
  set_interactive_status(s, c) {
    fields(c, ["type", "id"], ["spent", "hp"]);
    if (own2(s.covers, c.id)) {
      fields(c, ["type", "id", "hp"]);
      const cover = get(s.covers, c.id, "\u63A9\u4F53 ID");
      requireThat(int(c.hp, 0, cover.maxHp), "\u63A9\u4F53 HP");
      cover.hp = c.hp;
    } else {
      fields(c, ["type", "id", "spent"]);
      requireThat(typeof c.spent === "boolean", "spent");
      get(s.interactives, c.id, "\u4E92\u52A8\u70B9 ID").spent = c.spent;
    }
  }
};
function applyCommand(state, command) {
  requireThat(plain(command) && has(commands, command.type), "\u547D\u4EE4\u7C7B\u578B");
  commands[command.type](state, structuredClone(command));
}

// src/api/battle_report.js
function formatBattleReportText(report, unitNames = {}) {
  const lines = [report.title];
  const names = new Map(Object.entries(unitNames));
  for (const unit of report.units) names.set(unit.id, unit.name);
  const name = (id3) => names.get(id3) ?? id3;
  const digits = "\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D";
  const roundLabel = (n) => n < 10 ? digits[n] : n < 100 ? `${n >= 20 ? digits[Math.floor(n / 10)] : ""}\u5341${n % 10 ? digits[n % 10] : ""}` : n;
  for (const { round, events: events2 } of report.rounds) {
    const rows = [];
    let turn = null;
    const add = (text4) => {
      if (turn) turn.parts.push(text4);
      else rows.push(text4);
    };
    for (const [i, event] of events2.entries()) {
      const { type, text: text4, actor } = event;
      const detail = event.detail ?? {};
      switch (type) {
        case "initiative":
          rows.push(`\u786E\u5B9A\u5148\u653B\u6B21\u5E8F\uFF1A${detail.initiative.map((u) => name(u.unitId)).join(" \u2192 ")}`);
          break;
        case "turn":
          turn = { text: text4, actor, parts: [] };
          rows.push(turn);
          break;
        case "end":
          if (turn && !turn.parts.length) turn.parts.push("\u672A\u884C\u52A8\uFF0C\u7ED3\u675F\u56DE\u5408");
          turn = null;
          break;
        case "action": {
          const action = detail.action?.type;
          if (["move", "sprint", "disengage", "interact"].includes(action) || action === "brace" && events2[i + 1]?.type === "brace") break;
          const prefix = `${name(actor)}\uFF1A`;
          const label = text4.startsWith(prefix) ? text4.slice(prefix.length) : text4;
          add(action === "attack" || action === "skill" ? `\u4F7F\u7528${label}` : label);
          break;
        }
        case "roll":
          if (detail.cover > 0) {
            const cover = detail.coverId;
            add(`${name(detail.targetId)}\u53D7\u5230${cover ? ` ${cover} ` : ""}\u63A9\u4F53\u906E\u853D`);
          }
          if (!detail.hit) add(`${name(detail.targetId)}\u672A\u88AB\u51FB\u4E2D`);
          else if (detail.critical) add(`\u5BF9${name(detail.targetId)}\u6253\u51FA\u66B4\u51FB`);
          break;
        case "save":
          if (detail.saved) add(`${name(detail.targetId)}\u901A\u8FC7\u8C41\u514D`);
          break;
        case "intent":
          add(detail.success ? "\u610F\u56FE\u6210\u7ACB" : "\u610F\u56FE\u672A\u6210\u7ACB\uFF0C\u6309\u5E38\u89C4\u653B\u51FB\u7ED3\u7B97");
          break;
        case "status":
          if (detail.statusId === "guarded" && turn?.parts.some((p) => p.includes("\u67B6\u52BF\u9632\u5FA1"))) break;
          add(text4.replace(/ ×1$/, ""));
          break;
        case "proc":
        case "expire":
          break;
        case "counter":
          add(text4.replace(/\bsouls\b/g, "\u9B42\u6570").replace(/\bammo\b/g, "\u5F39\u836F"));
          break;
        case "outcome":
          turn = null;
          rows.push(text4);
          break;
        default: {
          if (["damage", "heal", "cover_damage"].includes(type) && detail.amount === 0) break;
          const ownAction = turn?.actor === actor && ["move", "sprint", "disengage", "teleport", "interact", "skip", "brace", "cover_approach"].includes(type);
          const label = ownAction && text4.startsWith(name(actor)) ? text4.slice(name(actor).length) : text4;
          add(label.replace(/ ×1$/, ""));
        }
      }
    }
    if (!rows.length) continue;
    lines.push("", `- \u56DE\u5408${roundLabel(round)}`);
    for (const row of rows) {
      lines.push(`  - ${typeof row === "string" ? row : row.text + (row.parts.length ? `\uFF1A${row.parts.join("\uFF1B")}` : "")}`);
    }
  }
  if (!report.outcome) lines.push("", "\u6218\u6597\u5C1A\u672A\u7ED3\u675F\u3002");
  return `${lines.join("\n")}
`;
}

// src/api/game_api.js
var copy = (value) => structuredClone(value);
var fail3 = (message) => {
  throw new Error(message);
};
var version = 1;
var battleVersion = 3;
var maxHistory = 2e3;
var maxBatch = 32;
var own4 = (obj, key3) => Object.hasOwn(obj, key3);
var shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every((key3) => own4(value, key3));
function diff(before, after, path = [], changes2 = []) {
  if (before === after) return changes2;
  if (before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after) && (!Array.isArray(before) || before.length === after.length)) {
    for (const key3 of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
      diff(
        own4(before, key3) ? before[key3] : void 0,
        own4(after, key3) ? after[key3] : void 0,
        [...path, Array.isArray(before) ? Number(key3) : key3],
        changes2
      );
    }
  } else {
    changes2.push({ path, ...before === void 0 ? {} : { before }, ...after === void 0 ? {} : { after } });
  }
  return changes2;
}
function simulate(base, transaction) {
  const isCommand = transaction?.kind === "commands";
  if (!shape(transaction, isCommand ? ["kind", "entries", "reason"] : ["kind", "entries"]) || !Array.isArray(transaction.entries) || transaction.entries.length < 1 || transaction.entries.length > maxBatch) fail3("\u4E8B\u52A1\u683C\u5F0F\u9519\u8BEF");
  if (isCommand && (typeof transaction.reason !== "string" || !transaction.reason.trim() || transaction.reason.length > 300)) fail3("\u65E0\u6548\u7684\u4E8B\u52A1\u7406\u7531");
  const next = copy(base);
  if (transaction.kind === "actions") {
    for (const action of transaction.entries) {
      if (!action || Object.getPrototypeOf(action) !== Object.prototype || Object.values(action).some((v) => typeof v !== "string" && typeof v !== "boolean" && !Number.isInteger(v))) fail3("\u52A8\u4F5C\u5FC5\u987B\u7531 JSON \u5B57\u6BB5\u7EC4\u6210");
      applyAction(next, action);
    }
  } else if (transaction.kind === "commands") {
    for (const command of transaction.entries) applyCommand(next, command);
    validateState(next);
    syncEquipmentEffects(next);
    const outcome = refreshOutcome(next);
    validateState(next);
    if (!outcome && (base.outcome || currentUnit(base)?.id !== currentUnit(next)?.id || currentUnit(next)?.hp === 0)) {
      settleTurn(next);
      validateState(next);
    }
  } else fail3("\u672A\u77E5\u4E8B\u52A1\u7C7B\u578B");
  return next;
}
function createGameAPI() {
  let state, origin, revision = 0, serial = 0;
  let frames = [];
  const pending = /* @__PURE__ */ new Map(), listeners = /* @__PURE__ */ new Set();
  function current() {
    return state ?? fail3("\u8BF7\u5148\u521B\u5EFA\u6218\u5C40");
  }
  function publish() {
    revision++;
    pending.clear();
    for (const listener of listeners) {
      try {
        listener(revision);
      } catch (error2) {
        globalThis.reportError?.(error2);
      }
    }
  }
  function commit(next, transaction) {
    if (frames.length >= maxHistory) fail3("\u6218\u5C40\u4E8B\u52A1\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5BFC\u51FA\u6218\u62A5\u540E\u91CD\u5F00");
    frames.push({ before: current(), transaction });
    state = next;
    publish();
    return { ok: true, revision };
  }
  function undo() {
    if (!frames.length) return { ok: false, error: "\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u4E8B\u52A1" };
    state = frames.pop().before;
    publish();
    return { ok: true, revision };
  }
  function restore(snapshot) {
    if (!shape(snapshot, ["kind", "version", "origin", "state", "journal"]) || snapshot.kind !== "battle" || ![1, 2, battleVersion].includes(snapshot.version) || !Array.isArray(snapshot.journal) || snapshot.journal.length > maxHistory) fail3("\u4E0D\u652F\u6301\u7684\u6218\u5C40\u5FEB\u7167\u683C\u5F0F");
    const needsMigration = snapshot.version < battleVersion;
    if (needsMigration) snapshot = { ...snapshot, origin: migrateStateEffects(copy(snapshot.origin)), state: migrateStateEffects(copy(snapshot.state)) };
    validateState(snapshot.origin);
    validateState(snapshot.state);
    if (needsMigration) {
      const resumed = copy(snapshot.state);
      syncEquipmentEffects(resumed);
      validateState(resumed);
      origin = state = resumed;
      frames = [];
      publish();
      return { ...api.getStateSummary(), migratedFrom: snapshot.version };
    }
    const start = copy(snapshot.origin), history = [];
    let next = start;
    for (const transaction of snapshot.journal) {
      const entry = copy(transaction);
      const result = simulate(next, entry);
      history.push({ before: next, transaction: entry });
      next = result;
    }
    if (diff(next, snapshot.state).length) fail3("\u5FEB\u7167\u72B6\u6001\u4E0E\u547D\u4EE4\u65E5\u5FD7\u91CD\u653E\u4E0D\u4E00\u81F4");
    origin = start;
    state = next;
    frames = history;
    publish();
    return api.getStateSummary();
  }
  function commitStatusCommand(command, reason) {
    const proposal = api.proposeCommands([command], { baseRevision: revision, reason });
    return proposal.ok ? api.commitProposal(proposal.proposalId) : proposal;
  }
  const api = {
    calculatePrebattleResources,
    protocolDistance,
    createBattle(scenarioOrImportSnapshot = "ruins") {
      if (scenarioOrImportSnapshot?.kind === "battle") return restore(scenarioOrImportSnapshot);
      const next = buildScenario(scenarioOrImportSnapshot);
      validateState(next);
      if (scenarioOrImportSnapshot?.kind === "custom_state") {
        syncEquipmentEffects(next);
        validateState(next);
      }
      origin = state = next;
      frames = [];
      publish();
      return api.getStateSummary();
    },
    restoreBattleSnapshot: restore,
    exportBattleSnapshot() {
      return copy({ kind: "battle", version: battleVersion, origin, state: current(), journal: frames.map((frame) => frame.transaction) });
    },
    exportPersistentCarryOver() {
      const s = current();
      return copy({
        kind: "persistent",
        version,
        units: Object.fromEntries(Object.values(s.units).map((u) => [u.id, {
          statuses: Object.fromEntries(Object.entries(u.statuses).filter(([, v]) => v.durationType === "persistent")),
          weapon: u.weapon,
          gear: u.gear
        }])),
        items: s.items,
        ...s.statusTemplates && Object.keys(s.statusTemplates).length ? { statusTemplates: s.statusTemplates } : {}
      });
    },
    exportBattleReport() {
      const s = current(), rounds = /* @__PURE__ */ new Map();
      for (const log of s.logs) {
        if (!rounds.has(log.round)) rounds.set(log.round, []);
        rounds.get(log.round).push(log);
      }
      const outcome = { blue: "\u84DD\u65B9\u80DC\u5229", red: "\u7EA2\u65B9\u80DC\u5229", draw: "\u5E73\u5C40" }[s.outcome] ?? "\u6218\u6597\u5C1A\u672A\u7ED3\u675F";
      return copy({
        version,
        scenarioId: s.scenarioId,
        title: s.title,
        outcome: s.outcome,
        rounds: [...rounds].map(([round, events2]) => ({ round, events: events2 })),
        units: api.listUnits(),
        journal: frames.map((frame) => frame.transaction),
        summary: `${s.title} \xB7 \u7B2C ${s.round} \u8F6E \xB7 ${outcome} \xB7 ${s.logs.length} \u6761\u4E8B\u4EF6`
      });
    },
    exportBattleReportText() {
      const names = new Map(Object.values(origin?.units ?? {}).map((u) => [u.id, u.name]));
      for (const frame of frames) {
        if (frame.transaction.kind !== "commands") continue;
        for (const command of frame.transaction.entries) if (command.type === "spawn_unit") names.set(command.unit.id, command.unit.name);
      }
      return formatBattleReportText(api.exportBattleReport(), Object.fromEntries(names));
    },
    getStateSummary() {
      const s = current();
      return {
        revision,
        scenarioId: s.scenarioId,
        title: s.title,
        mode: s.mode,
        ruleset: s.ruleset,
        round: s.round,
        currentUnitId: s.order[s.turn] ?? null,
        order: [...s.order],
        outcome: s.outcome,
        units: api.listUnits()
      };
    },
    listStatusTemplates() {
      const s = current();
      return copy({ ...STATUSES, ...s.statusTemplates });
    },
    statusModifierKeys(statusId2) {
      return statusModifierKeys(statusId2, state);
    },
    checkStealth(unitId, d20, dc) {
      const s = current();
      if (!own4(s.units, unitId) || !Number.isInteger(d20) || d20 < 1 || d20 > 20 || !Number.isFinite(dc)) fail3("\u65E0\u6548\u7684\u6F5C\u884C\u68C0\u5B9A\u53C2\u6570");
      return stealthCheck(s, s.units[unitId], d20, dc);
    },
    defineStatus(id3, template) {
      if (!template || Object.getPrototypeOf(template) !== Object.prototype || own4(template, "id") && template.id !== id3) {
        return { ok: false, error: "\u65E0\u6548\u72B6\u6001\u6A21\u677F\u6216 ID \u4E0D\u4E00\u81F4" };
      }
      return commitStatusCommand({ type: "define_status_template", template: { ...template, id: id3 } }, "\u6CE8\u518C\u72B6\u6001\u6A21\u677F");
    },
    patchStatus(unitId, statusId2, patch) {
      return commitStatusCommand({ type: "patch_status", unitId, statusId: statusId2, patch }, "\u66F4\u65B0\u72B6\u6001\u53C2\u6570");
    },
    listUnits() {
      return Object.values(current().units).map(({ id: id3, name, team: team2, x, y, hp, maxHp, ap, statuses, mainHand, offHand, shield, stance, moraleState, mc, deathrattle }) => ({
        id: id3,
        name,
        team: team2,
        x,
        y,
        hp,
        maxHp,
        ap,
        mainHand,
        offHand,
        shield,
        stance,
        moraleState: moraleState ?? "steady",
        mc: mc ?? 1,
        deathrattle: Boolean(deathrattle),
        statuses: Object.keys(statuses)
      }));
    },
    inspectWeaponSlots(unitId) {
      const s = current();
      if (!own4(s.units, unitId)) return null;
      const u = s.units[unitId];
      const item = (id3) => id3 ? { id: id3, ...s.items[id3], template: s.equipment[s.items[id3]?.templateId] } : null;
      return copy({
        unitId,
        stance: u.stance,
        mainHand: item(u.mainHand ?? u.weapon),
        offHand: item(u.offHand),
        shield: item(u.shield),
        greatswordMode: u.greatswordMode ?? "offensive",
        blockMode: u.blockMode ?? "normal"
      });
    },
    setWeaponStance(unitId, stance, options = {}) {
      const s = current();
      if (!own4(s.units, unitId)) return { ok: false, error: "\u672A\u77E5\u5355\u4F4D" };
      if (!["light_blade", "dual_wield", "attunement", "greatsword", "sword_shield"].includes(stance)) return { ok: false, error: "\u672A\u77E5\u6301\u68B0\u59FF\u6001" };
      const patch = { stance };
      if (options.greatswordMode !== void 0) patch.greatswordMode = options.greatswordMode;
      if (options.blockMode !== void 0) patch.blockMode = options.blockMode;
      const transaction = { kind: "commands", entries: [{ type: "set_unit_stat", unitId, patch }], reason: "\u5207\u6362\u6301\u68B0\u59FF\u6001" };
      return commit(simulate(s, transaction), transaction);
    },
    listManeuvers(unitId) {
      const s = current();
      const u = s.units[unitId];
      if (!u) return null;
      return copy(u.maneuvers ?? ["charge", "lock_on", "scan", "cover", "guard", "interrupt", "push", "knockback", "grapple", "disarm", "trip", "flee", "detour"]);
    },
    inspectUnit(unitId) {
      const s = current();
      if (!own4(s.units, unitId)) return null;
      const unit = s.units[unitId];
      return copy({ ...unit, equipment: [unit.weapon, unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean).filter((id3, i, all) => all.indexOf(id3) === i).map((id3) => ({
        ...s.items[id3],
        template: s.equipment[s.items[id3].templateId]
      })) });
    },
    listActionLogs(limit = 10) {
      if (!Number.isInteger(limit) || limit < 0 || limit > 200) fail3("\u65E5\u5FD7\u6761\u6570\u987B\u4E3A 0\u2013200 \u7684\u6574\u6570");
      return limit ? copy(current().logs.slice(-limit)) : [];
    },
    getBattleState() {
      return copy(current());
    },
    subscribe(listener) {
      if (typeof listener !== "function") fail3("\u76D1\u542C\u5668\u5FC5\u987B\u662F\u51FD\u6570");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    previewAction(action) {
      return copy(preview(current(), copy(action)));
    },
    playAction(action) {
      if (!action || Object.getPrototypeOf(action) !== Object.prototype) fail3("\u52A8\u4F5C\u987B\u4E3A\u666E\u901A\u5BF9\u8C61");
      const transaction = { kind: "actions", entries: [copy(action)] };
      return commit(simulate(current(), transaction), transaction);
    },
    stepEnemy() {
      const s = current();
      if (s.outcome || s.units[s.order[s.turn]]?.team !== "red") return { ok: false };
      return api.playAction(chooseAction(copy(s)) ?? { type: "end" });
    },
    proposeCommands(commands2, options = {}) {
      try {
        if (!shape(options, ["baseRevision", "reason"]) || options.baseRevision !== revision) fail3("\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BD5\u7B97");
        if (typeof options.reason !== "string" || !options.reason.trim() || options.reason.length > 300) fail3("\u8BF7\u586B\u5199\u8BD5\u7B97\u7406\u7531\uFF081\u2013300 \u5B57\uFF09");
        if (!Array.isArray(commands2) || commands2.length < 1 || commands2.length > maxBatch) fail3("\u547D\u4EE4\u5FC5\u987B\u662F 1\u201332 \u6761\u7684\u6570\u7EC4");
        const s = current();
        const isUndo = commands2.length === 1 && shape(commands2[0], ["type", "operation"]) && commands2[0].type === "replay_or_undo" && commands2[0].operation === "undo";
        const transaction = { kind: "commands", entries: copy(commands2), reason: options.reason };
        const next = isUndo ? frames.at(-1)?.before ?? fail3("\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u4E8B\u52A1") : simulate(s, transaction);
        const changes2 = diff(s, next);
        if (!changes2.length) fail3("\u547D\u4EE4\u6CA1\u6709\u6539\u53D8\u6218\u5C40");
        const proposalId = `p${++serial}`;
        if (pending.size >= 16) pending.delete(pending.keys().next().value);
        pending.set(proposalId, { transaction, next, isUndo, revision });
        return copy({ ok: true, dryRun: true, proposalId, baseRevision: revision, reason: options.reason, diff: changes2 });
      } catch (error2) {
        return { ok: false, dryRun: true, error: error2.message };
      }
    },
    commitProposal(proposalId) {
      const p = pending.get(proposalId);
      if (!p || p.revision !== revision) return { ok: false, error: "\u63D0\u6848\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u8BD5\u7B97" };
      try {
        return p.isUndo ? undo() : commit(p.next, p.transaction);
      } catch (error2) {
        return { ok: false, error: error2.message };
      }
    },
    undoLastCommit: undo
  };
  return Object.freeze(api);
}
var GameAPI = createGameAPI();
if (typeof window !== "undefined") window.FatedTacticalGame = GameAPI;

// src/ui/template.js
var TEMPLATE = `<main id="output-container" class="game-layout">
    <header class="action-panel game-header">
      <div class="game-brand"><p class="eyebrow">\u25C6\u3000\u547D\u5B9A\u4E4B\u8BD7 / \u6218\u672F\u7BB1\u5EAD</p><h1 id="battle-title">\u547D\u5B9A\u4E4B\u8BD7</h1><p id="scenario-preview" class="muted"></p></div>
      <div class="top-controls">
        <label>\u9884\u8BBE\u6218\u5C40 <select id="scenario-select" class="axis-select"></select></label>
        <label>\u884C\u52A8\u89C4\u5219 <select id="mode-select"><option value="free">\u81EA\u7531 2 AP</option><option value="split">1 \u52A8\u4F5C + 1 \u653B\u51FB</option></select></label>
        <label>\u9762\u677F\u914D\u8272 <select id="theme-select"><option value="amethyst">\u7D2B\u6676</option><option value="night-gold">\u591C\u91D1</option><option value="frost-silver">\u971C\u94F6</option></select></label>
        <label>\u968F\u673A\u79CD\u5B50 <input id="seed-input" type="number" min="0" max="4294967295" step="1" required></label>
        <button type="button" id="reset-button" class="game-button">\u91CD\u5F00</button>
      </div>
    </header>
    <div class="game-columns">
      <div class="battle-main">
        <section class="action-panel" aria-labelledby="board-title">
          <div class="panel-header-bar game-heading"><h2 class="panel-title" id="board-title">\u25C7\u300010\xD710 \u6218\u672F\u5E73\u9762\u56FE</h2><span id="round-badge" class="tag tag-round"></span><span id="ap-display" aria-label="\u884C\u52A8\u529B"></span></div>
          <div class="panel-content">
            <div id="battle-status" role="status" class="data-row"></div>
            <div id="turn-order" class="turn-order" aria-label="\u5148\u653B\u5E8F\u5217"></div>
            <div class="battle-axis">
              <div class="axis-meta"><span class="axis-caption">\u7AD9\u4F4D\u4E0E\u8DDD\u79BB \xB7 XYZ</span><span class="axis-bounds">X 0\u20139\u3000Y 0\u20139</span></div>
              <div class="axis-toolbar" aria-label="\u5355\u4F4D\u6D4B\u8DDD">
                <label>\u6D4B\u8DDD\u8D77\u70B9<select class="axis-select" id="measure-origin"></select></label>
                <label>\u6D4B\u8DDD\u76EE\u6807<select class="axis-select" id="measure-target"></select></label>
              </div>
              <div id="measure-readout" class="axis-readout" aria-live="polite"></div>
              <p id="board-instructions" class="axis-bounds">\u5148\u70B9\u76EE\u6807\u683C\uFF0C\u518D\u9009\u52A8\u4F5C\uFF1B\u70B9\u5F53\u524D\u5175\u724C\u5207\u6362\u75BE\u8DD1\u3002<span id="sprint-indicator"></span></p>
              <p class="axis-scroll-hint">\u7A84\u5C4F\u53EF\u5DE6\u53F3\u6ED1\u52A8\u67E5\u770B\u5B8C\u6574\u68CB\u76D8</p>
              <div class="axis-scroll" role="region" aria-label="\u6218\u672F\u68CB\u76D8\uFF0C\u53EF\u6A2A\u5411\u6EDA\u52A8" tabindex="0">
                <div class="tactical-board-wrap">
                  <div class="tactical-y-rail" id="board-y" aria-hidden="true"></div>
                  <div class="tactical-grid" id="board" aria-label="10\xD710 \u68CB\u76D8"></div>
                  <div class="tactical-x-rail" id="board-x" aria-hidden="true"></div>
                </div>
              </div>
              <div class="tactical-legend">\u89D2\u6807 = Z \u9AD8\u5EA6\uFF08\u91D1\u9AD8\uFF0F\u7070\u5E73\uFF0F\u84DD\u4F4E\uFF09 \xB7 \u68D5 C \u63A9\u4F53 \xB7 \u7D2B I \u4E92\u52A8 \xB7 # \u5899 \xB7 \u5761 \u659C\u5761 \xB7 \u7EA2\u8FB9 \u9661\u5D16 \xB7 <b class="tx-good">\u7EFF \u53EF\u8FBE</b> \xB7 <b class="tx-info">\u84DD \u666E\u653B\u5C04\u7A0B</b>\uFF08\u7EFF\u683C\u84DD\u70B9\uFF1D\u53EF\u8FBE\u4E14\u5728\u5C04\u7A0B\uFF09 \xB7 <b class="tx-violet">\u7D2B \u5F71\u54CD\u533A</b></div>
              <div id="terrain-inspector" class="tactical-inspector"></div>
            </div>
          </div>
        </section>
      </div>
      <aside class="battle-sidebar" aria-label="\u6218\u672F\u63A7\u5236\u4E0E\u65E5\u5FD7">
        <section class="action-panel" aria-labelledby="action-title">
          <div class="panel-header-bar game-heading"><h2 class="panel-title" id="action-title">\u2726\u3000\u56DE\u5408\u63A7\u5236</h2></div>
          <div class="panel-content">
            <div class="control-row turn-controls">
              <button id="end-turn" type="button" class="game-button primary">\u7ED3\u675F\u56DE\u5408</button>
              <button id="ai-step" type="button" class="game-button">\u654C\u65B9\u5355\u6B65</button>
              <button id="undo-button" type="button" class="game-button">\u64A4\u9500</button>
              <button id="resource-button" type="button" class="game-button">\u539F\u534F\u8BAE\u8D44\u6E90\u63A8\u6F14</button>
              <label><input id="auto-ai" type="checkbox" checked> \u81EA\u52A8\u654C\u65B9</label>
              <label>\u901F\u5EA6 <select id="ai-speed"><option value="800">\u6162\u901F</option><option value="350" selected>\u6807\u51C6</option><option value="80">\u5FEB\u901F</option></select></label>
            </div>
            <p id="action-error" class="tx-bad" role="alert" hidden></p>
          </div>
        </section>
        <section class="action-panel" aria-labelledby="card-title">
          <div class="panel-header-bar game-heading"><h2 id="card-title" class="panel-title">\u25C8\u3000\u5355\u4F4D / \u573A\u666F\u60C5\u62A5</h2></div>
          <div id="unit-card" class="panel-content"></div>
          <details class="feature-register"><summary>\u63A9\u4F53\u4E0E\u4E92\u52A8\u70B9</summary><div id="feature-cards" class="panel-content"></div></details>
        </section>
        <section class="action-panel" aria-labelledby="logs-title">
          <div class="panel-header-bar game-heading"><h2 id="logs-title" class="panel-title">\u2261\u3000\u6218\u51B5\u65E5\u5FD7</h2></div>
          <div id="combat-log" class="panel-content" aria-label="\u6218\u51B5\u65E5\u5FD7"></div>
          <div class="panel-content control-row export-controls">
            <button type="button" id="export-report" class="game-button" title="\u6253\u5F00\u4FBF\u4E8E\u7C98\u8D34\u7ED9 AI \u7684\u7CBE\u7B80\u6218\u62A5">\u5BFC\u51FA\u6218\u62A5</button>
            <button type="button" id="export-snapshot" class="game-button" title="\u4FDD\u5B58\u6574\u5C40 JSON\uFF0C\u5BFC\u5165\u540E\u539F\u5730\u7EE7\u7EED">\u5BFC\u51FA\u5FEB\u7167</button>
            <button type="button" id="export-persistent" class="game-button" title="\u4FDD\u5B58\u88C5\u5907\u8BA1\u6570\u4E0E\u5E38\u9A7B\u72B6\u6001\uFF0C\u4F9B\u4E0B\u4E00\u5173\u7EE7\u627F">\u5BFC\u51FA\u8DE8\u6218\u6570\u636E</button>
            <button type="button" id="import-button" class="game-button">\u5BFC\u5165 JSON</button>
            <button type="button" id="clear-persistent" class="game-button" hidden>\u6E05\u9664\u4E0B\u573A\u7EE7\u627F</button>
            <input id="import-snapshot" type="file" accept=".json,application/json" hidden>
          </div>
        </section>
        <details id="api-sandbox" class="action-panel">
          <summary class="panel-header-bar game-heading"><span class="panel-title">\u2318\u3000\u9884\u7559 GameAPI \u6C99\u76D2\u8C03\u8BD5\u9762\u677F</span></summary>
          <div class="panel-content">
            <p class="muted">\u8BD5\u7B97\u53EA\u663E\u793A\u5DEE\u5F02\uFF0C\u4E0D\u4FEE\u6539\u6218\u5C40\u3002\u786E\u8BA4\u540E\u624D\u63D0\u4EA4\u3002</p>
            <div class="control-row sandbox-examples">
              <button type="button" class="game-button" data-example="counter">\u88C5\u5907\u8BA1\u6570</button>
              <button type="button" class="game-button" data-example="status">\u65BD\u52A0\u72B6\u6001</button>
              <button type="button" class="game-button" data-example="custom-status">\u81EA\u5B9A\u4E49\u72B6\u6001</button>
              <button type="button" class="game-button" data-example="terrain">\u5730\u5F62\u4FEE\u6539</button>
            </div>
            <label for="sandbox-reason">\u8BD5\u7B97\u7406\u7531</label> <input id="sandbox-reason" value="\u5C40\u5185\u6D4B\u8BD5" maxlength="300">
            <label>\u63D0\u6848\u8BF4\u660E <input id="sandbox-reason" type="text" value="\u6C99\u76D2\u8C03\u8BD5" maxlength="160"></label>
            <label class="editor-label" for="sandbox-editor">\u547D\u4EE4 JSON</label><textarea id="sandbox-editor" rows="8" spellcheck="false">[]</textarea>
            <div class="control-row">
              <button type="button" id="sandbox-preview" class="game-button">\u8BD5\u7B97 Diff \u9884\u89C8</button>
              <button type="button" id="sandbox-commit" class="game-button primary" disabled>\u786E\u8BA4\u63D0\u4EA4</button>
              <button type="button" id="sandbox-undo" class="game-button">\u64A4\u9500</button>
            </div>
            <pre id="sandbox-output" aria-live="polite"></pre>
          </div>
        </details>
      </aside>
    </div>
  </main>
  <section id="target-actions" class="action-panel battle-axis" aria-labelledby="target-title" hidden>
    <div class="control-row target-head"><strong id="target-title"></strong><button type="button" id="close-target" class="game-button" aria-label="\u5173\u95ED\u76EE\u6807\u52A8\u4F5C">\xD7</button></div>
    <div class="control-row target-protocol-controls" aria-label="\u653B\u51FB\u534F\u8BAE\u53C2\u6570">
      <label>\u610F\u56FE <select id="intent-select"><option value="normal">\u5E38\u89C4</option><option value="function">\u673A\u80FD\u9650\u5236</option><option value="core">\u6838\u5FC3\u8981\u5BB3</option><option value="kill">\u62B9\u6740</option><option value="concept">\u6982\u5FF5\u7834\u788E</option></select></label>
      <label><input id="nonlethal-toggle" type="checkbox"> \u975E\u81F4\u6B7B</label>
      <label>\u5956\u52B1\u9AB0 <select id="bonus-dice-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    </div>
    <div id="action-toolbar" class="control-row action-toolbar" aria-label="\u76EE\u6807\u53EF\u7528\u52A8\u4F5C"></div>
    <button type="button" id="confirm-action" class="game-button primary" hidden>\u786E\u8BA4\u65BD\u653E</button>
    <details id="target-preview"><summary>\u6218\u672F\u9884\u89C8</summary><div id="tactical-preview" class="axis-readout" aria-label="\u6218\u672F\u9884\u89C8" tabindex="0"></div></details>
  </section>
  <dialog id="report-dialog" class="action-panel" aria-labelledby="report-title">
    <h2 id="report-title" class="panel-title">\u7CBE\u7B80\u6218\u62A5</h2>
    <p class="muted">\u53EF\u76F4\u63A5\u7C98\u8D34\u7ED9 AI \u6269\u5199\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u53D1\u9001\u3002</p>
    <textarea id="report-text" rows="13" readonly aria-label="\u6218\u62A5\u6587\u672C"></textarea>
    <div class="control-row">
      <button type="button" id="copy-report" class="game-button primary">\u590D\u5236\u6218\u62A5</button>
      <button type="button" id="download-report" class="game-button">\u4E0B\u8F7D TXT</button>
      <form method="dialog"><button class="game-button">\u5173\u95ED</button></form>
    </div>
    <p id="report-message" role="status"></p>
  </dialog>
  <dialog id="resource-dialog" class="action-panel" aria-labelledby="resource-title">
    <h2 id="resource-title" class="panel-title">\u539F\u534F\u8BAE \xB7 \u6218\u524D\u8D44\u6E90\u63A8\u6F14</h2>
    <p class="muted">\u9ED8\u8BA4\u586B\u5165\u6240\u9009\u68CB\u5B50\u7684\u4E94\u7EF4\uFF0C\u5C42\u7EA7\u6682\u586B\u4E00\u5C42\u3002\u4EC5\u5BF9\u8D26\uFF0C\u4E0D\u6539\u5F53\u524D\u6218\u6597\u3002</p>
    <textarea id="resource-input" rows="8" aria-label="\u539F\u534F\u8BAE\u63A8\u6F14\u8F93\u5165 JSON"></textarea>
    <div class="control-row"><button type="button" id="calculate-resources" class="game-button primary">\u8BA1\u7B97</button><form method="dialog"><button class="game-button">\u5173\u95ED</button></form></div>
    <pre id="resource-output" aria-live="polite"></pre>
  </dialog>`;

// src/ui/render.js
function createRenderer(root) {
  if (!root || typeof root.querySelector !== "function") throw new TypeError("renderer root must be a DOM element");
  const byId4 = (id3) => root.querySelector(`[id="${id3}"]`);
  const el2 = (tag, classes, text4) => {
    const node3 = root.ownerDocument.createElement(tag);
    if (classes) node3.className = classes;
    if (text4 !== void 0 && text4 !== null) node3.textContent = String(text4);
    return node3;
  };
  const key3 = (x, y) => `${x},${y}`;
  const value = (table3, id3) => table3 && Object.hasOwn(table3, id3) ? table3[id3] : void 0;
  const values3 = (table3) => Object.values(table3 ?? {});
  const sign = (n) => n > 0 ? `+${n}` : String(n);
  const percent = (n) => `${Math.round(n * 100)}%`;
  const interval = (pair) => pair?.length === 2 ? pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]}\u2013${pair[1]}` : null;
  const side = (team2) => team2 === "blue" ? "\u84DD\u65B9" : "\u7EA2\u65B9";
  const arrow = (facing) => ({ "-1,-1": "\u2199", "0,-1": "\u2193", "1,-1": "\u2198", "-1,0": "\u2190", "1,0": "\u2192", "-1,1": "\u2196", "0,1": "\u2191", "1,1": "\u2197" })[facing?.join(",")] ?? "\xB7";
  const terrainLabel = (tile) => tile.kind === "wall" ? "# \u5899\u4F53\uFF08\u963B\u65AD\u79FB\u52A8\u53CA\u89C6\u7EBF\uFF09" : tile.kind === "slope" ? "\u5761\u9053" : tile.z ? "\u9AD8\u4F4E\u53F0" : "\u5E73\u5730";
  const actions = { move: ["\u79FB\u52A8", 1], sprint: ["\u75BE\u8DD1", 2], attack: ["\u666E\u901A\u653B\u51FB", 1], reload: ["\u88C5\u586B", 1], brace: ["\u67B6\u52BF\u9632\u5FA1", 1], disengage: ["\u64A4\u79BB", 1], interact: ["\u4E92\u52A8", 1] };
  const statusIcon = { buff: "\u2191", debuff: "\u2193", control: "\u2298", dot: "\u2739", hot: "\u271A", shield: "\u2B21" };
  const statuses = (u) => values3(u.statuses);
  const statusText = (s) => `${statusIcon[s.category] ?? "\u25C6"} ${s.name ?? s.id}${s.stacks > 1 ? ` \xD7${s.stacks}` : ""}${Number.isInteger(s.remainingTurns) ? ` \xB7 ${s.remainingTurns}\u56DE\u5408` : s.durationType === "persistent" ? " \xB7 \u5E38\u9A7B" : ""}`;
  const ratio2 = (v, max) => max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
  const activeFeedback = /* @__PURE__ */ new Map();
  const boardCells = /* @__PURE__ */ new Map();
  let dimensions = "", renderedScenario = null, logKeys = [], lastRender = null, baselineRanges;
  function createButton(classes, text4) {
    const button = el2("button", classes, text4);
    button.type = "button";
    return button;
  }
  function initializeBoard(state) {
    const width = state.grid[0].length, height2 = state.grid.length;
    const size = key3(width, height2);
    if (dimensions === size) return;
    dimensions = size;
    const board = byId4("board"), xRail = byId4("board-x"), yRail = byId4("board-y");
    board.closest(".battle-axis").style.setProperty("--rows", height2);
    board.closest(".battle-axis").style.setProperty("--cols", width);
    board.replaceChildren();
    xRail.replaceChildren();
    yRail.replaceChildren();
    boardCells.clear();
    for (let x = 0; x < width; x++) xRail.append(el2("span", "", x));
    for (let y = height2 - 1; y >= 0; y--) {
      yRail.append(el2("span", "", y));
      for (let x = 0; x < width; x++) {
        const cell = createButton("tactical-cell");
        Object.assign(cell.dataset, { x, y, gx: x, gy: y });
        const coord2 = el2("span", "tactical-cell-coord", key3(x, y));
        const z = el2("span", "tactical-cell-tz");
        const units = el2("span", "tactical-cell-units");
        const features = el2("span", "tactical-cell-features");
        const cost = el2("span", "cell-cost");
        cell.append(coord2, z, units, features, cost);
        boardCells.set(key3(x, y), { cell, z, units, features, cost });
        board.append(cell);
      }
    }
  }
  function token(name, initial, z, cls = "", faction) {
    const node3 = el2("span", `axis-unit ${cls}`);
    if (faction) node3.dataset.faction = faction;
    const head = el2("span", "axis-token-head");
    const height2 = el2("span", "axis-z-badge", sign(z));
    height2.dataset.zSign = z > 0 ? "pos" : z < 0 ? "neg" : "zero";
    head.append(el2("span", "axis-unit-fallback-avatar", initial), height2);
    node3.append(head, el2("span", "axis-unit-name", name));
    return { node: node3, head };
  }
  function resource3(node3, item, stat2, full) {
    const cap = item[`max${stat2[0].toUpperCase()}${stat2[1]}`];
    if (full) {
      node3 = el2("span", `tag tag-resource resource-meter tag-${stat2}${cap && item[stat2] / cap <= 0.25 ? "-low" : ""}`, `${stat2.toUpperCase()} ${item[stat2]}/${cap}`);
    } else {
      const meter = el2("span", `token-meter ${stat2}`);
      meter.append(node3 = el2("i"));
    }
    node3.style.setProperty("--resource-ratio", ratio2(item[stat2], cap));
    return full ? node3 : node3.parentNode;
  }
  function unitToken(unit, z, isSelected) {
    const { node: node3, head } = token(unit.name, Array.from(unit.name)[0] ?? "?", z, "", unit.team);
    node3.dataset.unit = unit.id;
    node3.dataset.unitId = unit.id;
    node3.setAttribute("aria-pressed", String(isSelected));
    head.append(el2("span", "axis-facing-pip", arrow(unit.facing)));
    const bars = el2("span", "token-meters");
    for (const stat2 of ["hp", "mp", "sp"]) bars.append(resource3(null, unit, stat2, false));
    node3.append(bars);
    const marks = statuses(unit);
    if (marks.length) node3.append(el2("span", "token-statuses", marks.length > 1 ? `\u25C6${marks.length}` : statusIcon[marks[0].category] ?? "\u25C6"));
    return node3;
  }
  const coverText = (c) => `${c.id} ${c.name} \xB7 \u6750\u8D28 ${c.material} \xB7 HP ${c.hp}/${c.maxHp} \xB7 \u906E\u853D ${c.cover}${c.hp ? "" : " \xB7 \u5DF2\u574D\u584C"}`;
  const interactiveText = (i) => `${i.id} ${i.name} \xB7 ${i.kind === "barrel" ? "\u5F15\u7206" : "\u796D\u575B\u589E\u76CA"} \xB7 ${i.spent ? "\u5DF2\u6D88\u8017" : "\u53EF\u7528"}`;
  function featureToken(f, z, isCover) {
    const { node: node3 } = token(
      f.id,
      Array.from(isCover ? f.material || "\u63A9" : f.kind === "barrel" ? "\u6876" : "\u796D")[0],
      z,
      isCover ? `tactical-cover${f.hp ? "" : " is-broken"}` : `tactical-interact${f.spent ? " is-spent" : ""}`
    );
    if (isCover) {
      node3.dataset.cover = f.id;
      const bar = el2("span", "tactical-cover-bar");
      const fill = el2("i");
      fill.style.width = percent(ratio2(f.hp, f.maxHp));
      bar.append(fill);
      node3.append(bar);
    } else node3.dataset.interact = f.id;
    return node3;
  }
  function cliffs(state, x, y, tile) {
    if (tile.kind !== "floor") return [];
    return [["top", x, y + 1], ["bottom", x, y - 1], ["left", x - 1, y], ["right", x + 1, y]].filter(([, nx, ny]) => {
      const next = state.grid[ny]?.[nx];
      return next?.kind === "floor" && Math.abs(next.z - tile.z) >= 2;
    }).map(([direction]) => direction);
  }
  function atMap(list3) {
    const map = /* @__PURE__ */ new Map();
    for (const item of list3) {
      const xy = key3(item.x, item.y);
      if (!map.has(xy)) map.set(xy, []);
      map.get(xy).push(item);
    }
    return map;
  }
  function renderBoard(state, selected, action, hover, range, preview2, baseline) {
    initializeBoard(state);
    const move = ["move", "sprint", "disengage"].includes(action?.type);
    const unitLocations = atMap(values3(state.units).filter((u) => u.hp > 0));
    const corpseLocations = atMap(corpses(state));
    const coverLocations = atMap(values3(state.covers));
    const interactions = atMap(values3(state.interactives));
    const available = baseline.move;
    const shots = baseline.attack;
    const reach = new Set((!move && range?.ok && range.cells || []).map((p) => key3(p.x, p.y)));
    const affected = new Set((!move && preview2?.ok && preview2.cells || []).map((p) => key3(p.x, p.y)));
    const path = new Set((move && preview2?.ok && preview2.path || []).map((p) => key3(p.x, p.y)));
    const risks = new Set((move && preview2?.opportunities || []).map((o) => key3(o.from.x, o.from.y)));
    const hoverKey = hover ? key3(hover.x, hover.y) : null;
    let inspection = "\u60AC\u505C\u6216\u805A\u7126\u4EFB\u610F\u683C\u5B50\uFF0C\u67E5\u770B\u5730\u5F62\u3001\u5355\u4F4D\u6216\u573A\u666F\u8BBE\u65BD\u3002";
    for (const [xy, slot] of boardCells) {
      const { cell, z, units, features, cost } = slot;
      const x = Number(cell.dataset.x), y = Number(cell.dataset.y), tile = state.grid[y][x];
      const unit = unitLocations.get(xy)?.[0], cover = coverLocations.get(xy)?.[0], interactive = interactions.get(xy)?.[0];
      const chosen = !!unit && selected === unit.id, isHover = hoverKey === xy;
      const shelf = tile.kind === "floor" && tile.z !== 0;
      const cliff = cliffs(state, x, y, tile);
      cell.className = [
        "tactical-cell",
        tile.kind !== "floor" ? `terrain-${tile.kind}` : shelf ? "terrain-plateau" : "",
        ...cliff.map((c) => `cliff-${c}`),
        chosen ? "is-selected" : "",
        isHover ? "is-hovered" : "",
        isHover && preview2?.ok === false ? "is-invalid" : "",
        available.has(xy) ? "is-reachable reachable" : "",
        shots.has(xy) || reach.has(xy) ? "is-in-range in-range" : "",
        available.has(xy) && (tile.kind === "slope" || tile.z !== state.grid[state.units[selected]?.y]?.[state.units[selected]?.x]?.z) ? "is-elevated-reach" : "",
        affected.has(xy) ? "axis-covered" : "",
        path.has(xy) ? "is-path" : "",
        risks.has(xy) ? "is-opportunity" : ""
      ].filter(Boolean).join(" ");
      cell.dataset.terrainType = tile.kind;
      cell.dataset.terrainZ = tile.z;
      cell.dataset.terrainElev = tile.z < 0 ? "neg" : tile.z >= 2 ? "pos2" : "pos1";
      if (unit) cell.dataset.unitId = unit.id;
      else delete cell.dataset.unitId;
      if (cover) cell.dataset.coverId = cover.id;
      else delete cell.dataset.coverId;
      if (interactive) cell.dataset.interactiveId = interactive.id;
      else delete cell.dataset.interactiveId;
      cell.setAttribute("aria-pressed", String(chosen));
      const description = [
        `(${xy}, Z${sign(tile.z)})`,
        terrainLabel(tile),
        cliff.length ? "\u9661\u5D16\u8FB9\uFF1A\u8DE8\u9AD8\u5DEE\u81F3\u5C11 2" : "",
        unit ? `${side(unit.team)} ${unit.name}\uFF0C\u671D\u5411 ${arrow(unit.facing)} \xB7 HP ${unit.hp}/${unit.maxHp}${statuses(unit).length ? ` \xB7 ${statuses(unit).map(statusText).join("\u3001")}` : ""}` : "",
        cover ? coverText(cover) : "",
        interactive ? interactiveText(interactive) : "",
        available.has(xy) ? `\u53EF\u8FBE\uFF0C${baseline.ap} AP` : ""
      ].filter(Boolean).join(" \xB7 ");
      cell.setAttribute("aria-label", description);
      if (isHover) inspection = description;
      const bodies = corpseLocations.get(xy) ?? [];
      const signature = JSON.stringify([tile, unit, cover, interactive, chosen, bodies.map((body) => body.id)]);
      if (slot.signature !== signature) {
        slot.signature = signature;
        z.textContent = tile.kind !== "wall" && tile.z !== 0 ? `z${sign(tile.z)}` : "";
        const bodyTokens = bodies.map((body) => {
          const { node: node3 } = token(body.name, "\u2020", tile.z, "tactical-corpse", body.team);
          node3.dataset.corpseId = body.id;
          node3.style.filter = "grayscale(1)";
          node3.style.opacity = ".55";
          node3.style.pointerEvents = "none";
          node3.setAttribute("aria-label", `${body.name}\u7684\u5C38\u4F53`);
          return node3;
        });
        units.replaceChildren(...[
          ...bodyTokens,
          unit ? unitToken(unit, tile.z, chosen) : null,
          cover ? featureToken(cover, tile.z, true) : null,
          interactive ? featureToken(interactive, tile.z, false) : null
        ].filter(Boolean));
        features.replaceChildren(...tile.kind !== "floor" ? [el2("span", "tactical-cell-tag", tile.kind === "wall" ? "#" : "\u5761")] : []);
      }
      cost.textContent = "";
    }
    byId4("terrain-inspector").textContent = inspection;
  }
  function renderPreview(state, action, hover, range, p, current, selectedUnit) {
    const node3 = byId4("tactical-preview");
    const lines = [];
    if (!current) lines.push("\u7B49\u5F85\u5148\u653B\u5355\u4F4D\u3002");
    else {
      const label = range?.name ?? actions[action?.type]?.[0] ?? "\u6218\u672F\u9884\u89C8";
      const summary = [label, range?.ap !== void 0 ? `${range.ap} AP` : "", range?.mp ? `${range.mp} MP` : "", range?.sp ? `${range.sp} SP` : ""];
      if (action?.type === "brace" && range?.ok) summary.push(`${range.coverId ? `\u501F ${range.coverId}` : "\u7A7A\u5730"}\uFF1A\u51CF\u4F24 ${percent(range.reduction)}\uFF0F${range.turns} \u56DE\u5408`);
      if (range?.shape && range.shape !== "single") summary.push(`\u8303\u56F4\uFF1A${{ circle: "\u5706\u5F62", cone: "\u9525\u5F62", fan: "\u6247\u5F62", line: "\u76F4\u7EBF" }[range.shape] ?? range.shape}`);
      if (range?.ammo != null) summary.push(`\u5F39\u836F ${range.ammo}${range.capacity ? `/${range.capacity}` : "\uFF08\u547D\u4EE4\u7ED3\u7B97\u6D88\u8017\uFF09"}`);
      if (range?.effects?.length) summary.push(`\u7279\u6548\uFF1A${range.effects.map(effectLabel).join("\u3001")}`);
      lines.push(summary.filter(Boolean).join(" \xB7 "));
      if (hover) {
        const source = selectedUnit ?? current;
        const targetTile = state.grid[hover.y]?.[hover.x];
        const dz = p?.dz ?? (targetTile ? targetTile.z - state.grid[source.y][source.x].z : null);
        const distance = p?.distance ?? (targetTile ? Math.hypot(hover.x - source.x, hover.y - source.y, dz) : null);
        const geometry = [Number.isFinite(distance) ? `dXYZ ${distance.toFixed(2)}${p?.range == null ? "" : ` / \u5C04\u7A0B ${p.range}`}` : "", Number.isFinite(dz) ? `\u9AD8\u5DEE \u0394Z ${sign(dz)}` : ""];
        if (p?.ok === false) geometry.push(p.error);
        if (p?.steps) geometry.push(`${p.steps} \u6B65`);
        if (p?.targets) geometry.push(`\u8986\u76D6 ${p.cells.length} \u683C\uFF0F${p.targets.length} \u76EE\u6807`);
        if (p?.teleport) geometry.push(`\u77AC\u79FB\u843D\u70B9 (${p.teleport.x},${p.teleport.y})`);
        const heading = geometry.filter(Boolean).join(" \xB7 ");
        if (heading) lines.push(heading);
        if (p?.opportunities?.length) lines.push(`\u26A0 \u501F\u673A\u98CE\u9669\uFF1A${p.opportunities.map((o) => `${o.name}\uFF08\u79BB\u5F00 ${o.from.x},${o.from.y} \u65F6\uFF09`).join("\u3001")}\u3002\u53EF\u6539\u7528\u64A4\u79BB\u3002`);
        if (p?.ok && action?.type === "disengage") lines.push("\u64A4\u79BB\u8DEF\u7EBF\uFF1A\u672C\u6B21\u79FB\u52A8\u4E0D\u89E6\u53D1\u501F\u673A\u653B\u51FB\u3002");
        for (const t of p?.targets ?? []) {
          const check = t.saveStat ? `\u8C41\u514D ${t.saveStat.toUpperCase()} \xB7 d20${sign(t.saveBonus)} \u2265 ${t.saveDC}` : t.automatic ? "\u81EA\u52A8\u547D\u4E2D" : Number.isFinite(t.defense) ? `${t.advantage > 0 ? "2d20\u53D6\u9AD8" : t.advantage < 0 ? "2d20\u53D6\u4F4E" : "d20"}${sign(t.accuracy)} \u2265 ${t.defense}` : "";
          lines.push([
            t.name,
            check,
            t.saveStat ? `\u8C41\u514D\u901A\u8FC7 ${percent(t.saveChance)}` : Number.isFinite(t.hitChance) ? `\u547D\u4E2D ${percent(t.hitChance)}` : "",
            Number.isFinite(t.expectedD20) ? `\u9884\u8BA1\u9AB0\u503C ${t.expectedD20.toFixed(1)}` : "",
            t.coverId ? `\u906E\u853D ${t.coverId} \u2212${t.cover}` : Number.isFinite(t.cover) ? "\u65E0\u906E\u6321" : "",
            Number.isFinite(t.highGround) ? `\u9AD8\u7A0B\u4FEE\u6B63 ${sign(t.highGround)}` : "",
            t.flanked ? "\u5939\u51FB" : "",
            t.backstab ? "\u80CC\u51FB" : "",
            t.recipientId && t.recipientId !== t.id ? `\u63F4\u62A4\uFF1A${t.recipientId}` : "",
            t.shield ? `\u62A4\u76FE ${t.shield}` : "",
            t.damage && !t.heal ? `\u4F24\u5BB3 ${interval(t.damage)}` : "",
            t.savedDamage ? `\u8C41\u514D\u540E ${interval(t.savedDamage)}` : "",
            t.criticalDamage && !t.heal ? `\u66B4\u51FB ${interval(t.criticalDamage)}` : "",
            Number.isFinite(t.expectedDamage) && !t.heal ? `\u671F\u671B ${t.expectedDamage.toFixed(1)}` : "",
            t.heal ? `\u6CBB\u7597 ${interval(t.heal)}` : "",
            t.healingShield?.[1] ? `\u9644\u76FE ${interval(t.healingShield)}` : ""
          ].filter(Boolean).join(" \xB7 "));
        }
      } else if (range?.ok === false) lines.push(range.error);
      else lines.push("\u60AC\u505C\u6216\u805A\u7126\u68CB\u683C\u67E5\u770B\u8DDD\u79BB\u3001\u884C\u52A8\u4EE3\u4EF7\u4E0E\u9884\u6D4B\u7ED3\u7B97\u3002");
    }
    const signature = lines.join("\n");
    if (node3.dataset.signature !== signature) {
      node3.dataset.signature = signature;
      node3.replaceChildren(...lines.map((line) => el2("div", "preview-line", line)));
      node3.scrollTop = 0;
    }
  }
  function renderTurn(state, current, selected) {
    const node3 = byId4("turn-order"), existing = new Map([...node3.children].map((btn) => [btn.dataset.unitId, btn]));
    const buttons = state.order.map((id3, idx) => {
      const u = value(state.units, id3);
      if (!u) return null;
      const btn = existing.get(id3) ?? createButton();
      btn.className = `game-button turn-chip${u.hp <= 0 ? " is-defeated" : ""}`;
      btn.dataset.unitId = id3;
      btn.dataset.faction = u.team;
      btn.textContent = `${idx + 1} \xB7 ${u.name}`;
      btn.setAttribute("aria-current", String(id3 === current?.id));
      btn.setAttribute("aria-pressed", String(id3 === selected));
      return btn;
    }).filter(Boolean);
    syncChildren(node3, buttons);
    byId4("round-badge").textContent = `\u56DE\u5408 ${state.round}`;
    byId4("battle-status").textContent = state.outcome ? state.outcome === "draw" ? "\u6218\u6597\u7ED3\u675F \xB7 \u5E73\u5C40" : `\u6218\u6597\u7ED3\u675F \xB7 ${side(state.outcome)}\u83B7\u80DC` : current ? `${side(current.team)}\u884C\u52A8 \xB7 ${current.name}${state.mode === "split" ? ` \xB7 \u52A8\u4F5C ${current.used.action ? "\u5DF2\u7528" : "\u53EF\u7528"}\uFF0F\u653B\u51FB ${current.used.attack ? "\u5DF2\u7528" : "\u53EF\u7528"}` : ""}` : "\u7B49\u5F85\u884C\u52A8";
    const ap = byId4("ap-display");
    ap.replaceChildren(...[0, 1].map((i) => el2("span", `ap-crystal${i >= (current?.ap ?? 0) || state.outcome ? " is-used" : ""}`, i < (current?.ap ?? 0) && !state.outcome ? "\u25C6" : "\u25C7")));
    ap.setAttribute("aria-label", `\u5269\u4F59 ${state.outcome ? 0 : current?.ap ?? 0} / 2 AP`);
  }
  function syncChildren(parent, list3) {
    for (let i = 0; i < list3.length; i++) if (parent.children[i] !== list3[i]) parent.insertBefore(list3[i], parent.children[i] ?? null);
    while (parent.children.length > list3.length) parent.lastElementChild.remove();
  }
  function row(title, ...content) {
    const line = el2("div", "data-row");
    if (title) line.append(el2("b", "card-subtitle", title));
    line.append(...content);
    return line;
  }
  function renderCard(state, u, inspected) {
    const node3 = byId4("unit-card");
    if (inspected && !u) {
      node3.replaceChildren(row("\u573A\u666F\u60C5\u62A5", inspected.material ? coverText(inspected) : interactiveText(inspected)));
      return;
    }
    if (!u) {
      node3.replaceChildren(el2("p", "muted", "\u70B9\u9009\u6218\u68CB\u6216\u5148\u653B\u5E8F\u5217\uFF0C\u67E5\u770B\u5355\u4F4D\u60C5\u62A5\u3002"));
      return;
    }
    const head = row(null);
    head.classList.add("unit-resource-row");
    head.dataset.faction = u.team;
    const name = el2("strong", "resource-unit-name", u.name);
    name.dataset.faction = u.team;
    name.prepend(el2("span", "resource-faction-label", side(u.team)));
    head.append(name, el2("span", "tag tone-gold", `(${u.x},${u.y}, Z${sign(state.grid[u.y][u.x].z)}) \xB7 \u671D\u5411 ${arrow(u.facing)}`));
    if (!u.hp) head.append(el2("span", "tag tone-red", "\u5DF2\u5012\u4E0B"));
    else {
      const template = value(state.equipment, value(state.items, u.weapon)?.templateId);
      const melee = (template?.range ?? 1.5) <= 2 && !resourceDefinitions(template).some((node4) => node4.reloadable);
      if (melee) head.append(el2("span", "tag", u.reactionAvailable === false ? "\u501F\u673A\u5DF2\u7528" : "\u501F\u673A\u5C31\u7EEA"));
    }
    const bars = row(null, ...["hp", "mp", "sp"].map((stat2) => resource3(null, u, stat2, true)), el2("span", "tag tone-gold", `${u.ap} AP`));
    const stanceNames = { light_blade: "\u8F7B\u5251", dual_wield: "\u53CC\u6301", attunement: "\u540C\u8C03", greatsword: "\u91CD\u5251", sword_shield: "\u5251\u76FE" };
    const cardStats = row(
      null,
      ...Object.entries({ str: "\u529B\u91CF", agi: "\u654F\u6377", con: "\u4F53\u8D28", int: "\u667A\u529B", spi: "\u7CBE\u795E" }).map(([id3, label]) => el2("span", `stat stat-${id3}`, `${label} ${u.stats[id3]}`)),
      el2("span", "tag", `\u62A4\u7532 ${u.armor} \xB7 \u79FB\u52A8 ${u.move} \xB7 \u4F53\u578B ${u.size}`),
      el2("span", "tag tone-violet", `\u6301\u68B0[${stanceNames[u.stance] ?? "\u8F7B\u5251"}] \xB7 \u5956\u52B1\u9AB0 ${u.bonusDice ?? 0}/2 \xB7 \u60E9\u7F5A\u9AB0 ${u.penaltyDice ?? 0}/1`)
    );
    const marks = row("\u72B6\u6001", ...statuses(u).length ? statuses(u).map((s) => {
      const badge = el2("span", "status-effect", statusText(s));
      badge.title = [
        s.name,
        s.category,
        s.tickTiming,
        s.description,
        s.amount !== void 0 ? `\u5F53\u524D\u6C60 ${s.amount}` : "",
        s.modifiers ? JSON.stringify(s.modifiers) : ""
      ].filter(Boolean).join(" \xB7 ");
      return badge;
    }) : [el2("span", "muted", "\u65E0")]);
    const equipment = [.../* @__PURE__ */ new Set([u.mainHand, u.offHand, u.shield, u.weapon, ...u.gear])].filter(Boolean).map((id3) => {
      const instance = value(state.items, id3), template = value(state.equipment, instance?.templateId);
      if (!instance || !template) return el2("span", "tag", id3);
      const counters = Object.entries(instance.counters ?? {}).map(([k, n]) => `${{ souls: "\u9B42\u6570 souls", ammo: "\u5F39\u836F ammo" }[k] ?? k} ${n}`);
      const badge = el2("span", "tag tone-gold card-item", [template.name, ...counters].join(" \xB7 "));
      badge.dataset.instanceId = id3;
      badge.title = [id3, template.description, ...(template.effects ?? []).map(effectLabel)].filter(Boolean).join(" \xB7 ");
      return badge;
    });
    const zones = values3(state.zones).filter((z) => Math.max(Math.abs(z.x - u.x), Math.abs(z.y - u.y)) <= z.radius).map((z) => el2("span", "status-effect", `\u533A\u57DF ${z.name} \xB7 ${z.damage} ${z.damageType}`));
    node3.replaceChildren(head, bars, cardStats, marks, row("\u88C5\u5907\u5B9E\u4F8B", ...equipment.length ? equipment : [el2("span", "muted", "\u5F92\u624B")]), row("\u533A\u57DF", ...zones.length ? zones : [el2("span", "muted", "\u65E0")]));
  }
  function renderFeatures(state) {
    const node3 = byId4("feature-cards");
    const covers = values3(state.covers).map((c) => row(null, el2("span", `tag card-item ${c.hp ? "tone-amber" : "tone-slate"}`, `${coverText(c)} \xB7 (${c.x},${c.y})`)));
    const interactives = values3(state.interactives).map((i) => row(null, el2("span", `tag card-item ${i.spent ? "tone-slate" : "tone-violet"}`, `${interactiveText(i)} \xB7 (${i.x},${i.y})`)));
    node3.replaceChildren(...covers, ...interactives);
  }
  function renderLogs(state) {
    const node3 = byId4("combat-log");
    const logs = state.logs.slice(-100).reverse();
    const keys = logs.map((log) => JSON.stringify(log));
    if (keys.length === logKeys.length && keys.every((k, i) => k === logKeys[i]) && node3.hasChildNodes()) return;
    const existing = /* @__PURE__ */ new Map();
    [...node3.children].forEach((child, i) => {
      if (logKeys[i] != null) {
        if (!existing.has(logKeys[i])) existing.set(logKeys[i], []);
        existing.get(logKeys[i]).push(child);
      }
    });
    const entries2 = logs.map((log, i) => {
      const cached = existing.get(keys[i])?.shift();
      if (cached) return cached;
      const entry = el2("details", `data-row log-entry${["damage", "defeat", "cover_break", "outcome"].includes(log.type) ? " damage-outcome" : ""}`);
      entry.append(el2("summary", "", `R${log.round} \xB7 ${log.text}`));
      entry.append(el2("pre", "log-detail", log.detail && Object.keys(log.detail).length ? JSON.stringify(log.detail, null, 2) : "\u65E0\u989D\u5916\u68C0\u5B9A\u660E\u7EC6\u3002"));
      return entry;
    });
    syncChildren(node3, entries2.length ? entries2 : [el2("p", "muted", "\u6682\u65E0\u6218\u51B5\u3002")]);
    logKeys = keys;
    node3.scrollTop = 0;
  }
  function render(state, ui = {}) {
    const current = value(state.units, state.order[state.turn]);
    const selected = ui.selectedId ?? ui.selectedUnitId ?? ui.selectedUnit ?? current?.id;
    const raw = Object.hasOwn(ui, "action") ? ui.action : current?.team === "blue" ? { type: "move" } : null;
    const action = typeof raw === "string" ? { type: raw, ...raw === "skill" && ui.skillId ? { skillId: ui.skillId } : {} } : raw;
    const hover = ui.hover ?? ui.hoverCell ?? ui.target ?? ui.preview?.center ?? null;
    const canAct = current?.team === "blue" && !state.outcome;
    const previewRange = (command) => canAct ? preview(state, command) : null;
    const newSnapshot = lastRender?.state !== state;
    if (newSnapshot || lastRender?.sprint !== ui.sprint) {
      const plan = previewRange({ type: ui.sprint ? "sprint" : "move" });
      const hits = previewRange({ type: "attack" });
      const keys = (p) => new Set((p?.ok ? p.cells : []).map((c) => key3(c.x, c.y)));
      baselineRanges = { move: keys(plan), attack: keys(hits), ap: plan?.ap };
    }
    const range = action ? previewRange({ type: action.type, ...action.skillId ? { skillId: action.skillId } : {} }) : null;
    const aimed = ["move", "sprint", "disengage", "attack", "skill", "interact"].includes(action?.type);
    const result = canAct && aimed && hover ? preview(state, { ...action, x: hover.x, y: hover.y }) : null;
    if (renderedScenario !== state.scenarioId) {
      for (const anim of activeFeedback.values()) anim.cancel();
      renderedScenario = state.scenarioId;
    }
    const scenario = byId4("scenario-select");
    if (!scenario.options.length) for (const [id3, s] of Object.entries(ui.scenarioOptions ?? SCENARIOS)) {
      const opt = el2("option", "", s.title ?? s.label ?? s);
      opt.value = s.id ?? id3;
      scenario.append(opt);
    }
    const selectedUnit = value(state.units, selected);
    byId4("sprint-indicator").textContent = ui.sprint ? " \xB7 \u75BE\u8DD1\u8303\u56F4 \xB7 2 AP" : "";
    if (newSnapshot) {
      byId4("battle-title").textContent = state.title;
      renderFeatures(state);
      renderLogs(state);
    }
    if (newSnapshot || lastRender?.selected !== selected) renderTurn(state, current, selected);
    byId4("end-turn").disabled = !canAct;
    byId4("ai-step").disabled = !!state.outcome || current?.team !== "red";
    renderBoard(state, selected, action, hover, range, result, baselineRanges);
    if (ui.target) renderPreview(state, action, hover, range, result, current, action ? current : selectedUnit);
    if (newSnapshot || lastRender?.selected !== selected || lastRender?.inspectedId !== ui.inspectedId) {
      const feature = value(state.covers, ui.inspectedId) ?? value(state.interactives, ui.inspectedId);
      renderCard(state, feature ? null : selectedUnit, feature);
    }
    lastRender = { state, selected, inspectedId: ui.inspectedId, sprint: ui.sprint };
    const message = byId4("action-error");
    message.textContent = ui.error || "";
    message.hidden = !ui.error;
  }
  function feedback(before, after) {
    if (!before?.grid || !after?.grid || before.scenarioId !== after.scenarioId) return;
    const changes2 = /* @__PURE__ */ new Map();
    const push = (item, label, kind) => {
      const xy = key3(item.x, item.y);
      const previous = changes2.get(xy);
      changes2.set(xy, previous ? { label: `${previous.label} ${label}`, kind: kind === "damage" ? kind : previous.kind } : { label, kind });
    };
    for (const u of values3(after.units)) {
      const old = value(before.units, u.id);
      if (!old) continue;
      if (u.hp !== old.hp) push(u, sign(u.hp - old.hp), u.hp < old.hp ? "damage" : "heal");
      else if (u.x !== old.x || u.y !== old.y) push(u, "\u25C6", "move");
      else {
        const gained = statuses(u).filter((s) => (value(old.statuses, s.id)?.stacks ?? 0) < s.stacks);
        if (gained.length) push(u, gained.map((s) => s.name).join("\uFF0F"), "status");
      }
    }
    for (const c of values3(after.covers)) {
      const old = value(before.covers, c.id);
      if (old && old.hp !== c.hp) push(c, c.hp <= 0 ? "\u574D\u584C" : sign(c.hp - old.hp), c.hp < old.hp ? "damage" : "heal");
    }
    for (const i of values3(after.interactives)) if (i.spent && value(before.interactives, i.id)?.spent === false) push(i, i.kind === "barrel" ? "\u5F15\u7206" : "\u5DF2\u6FC0\u6D3B", "status");
    if (after.logs.length > before.logs.length) for (const log of after.logs.slice(before.logs.length)) {
      if (log.type === "roll" && log.detail?.hit === false) {
        const u = value(after.units, log.detail.targetId) ?? value(after.covers, log.detail.targetId);
        if (u && !changes2.has(key3(u.x, u.y))) push(u, "\u672A\u547D\u4E2D", "status");
      }
    }
    const reduced = root.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    for (const [xy, { label, kind }] of changes2) {
      const cell = boardCells.get(xy)?.cell;
      if (!cell) continue;
      activeFeedback.get(xy)?.cancel();
      const overlay = el2("span", `cell-feedback ${kind}`), text4 = el2("b", "", label);
      overlay.setAttribute("aria-hidden", "true");
      overlay.append(text4);
      cell.append(overlay);
      const motion = reduced ? [{ opacity: 1 }, { opacity: 0.85, offset: 0.45 }, { opacity: 0 }] : [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0.95, transform: "translateY(-7%)", offset: 0.4 }, { opacity: 0, transform: "translateY(-23%)" }];
      const anim = overlay.animate(motion, { duration: 280, easing: "cubic-bezier(.23, 1, .32, 1)" });
      activeFeedback.set(xy, anim);
      anim.oncancel = anim.onfinish = () => {
        overlay.remove();
        if (activeFeedback.get(xy) === anim) activeFeedback.delete(xy);
      };
    }
  }
  return { render, feedback };
}

// src/ui/target_card.js
function placeTargetCard(card, anchor, viewport = window.visualViewport) {
  const gutter = 8, gap = 6;
  const left = (viewport?.offsetLeft ?? 0) + gutter;
  const top = (viewport?.offsetTop ?? 0) + gutter;
  const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 2 * gutter;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 2 * gutter;
  card.style.maxWidth = `${Math.max(0, right - left)}px`;
  card.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const a = anchor.getBoundingClientRect();
  const { width, height: height2 } = card.getBoundingClientRect();
  const room = {
    right: right - a.right - gap,
    left: a.left - left - gap,
    below: bottom - a.bottom - gap,
    above: a.top - top - gap
  };
  const clamp2 = (v, min, max) => Math.max(min, Math.min(v, max));
  let x, y;
  if (room.right >= width || room.left >= width) {
    x = room.right >= width ? a.right + gap : a.left - gap - width;
    y = a.top + (a.height - height2) / 2;
  } else {
    const below = room.below >= height2 || room.above < height2 && room.below >= room.above;
    x = a.left + (a.width - width) / 2;
    y = below ? a.bottom + gap : a.top - gap - height2;
    const available = below ? room.below : room.above;
    if (available < height2 && available >= 80) {
      card.style.maxHeight = `${available}px`;
      if (!below) y = a.top - gap - available;
    }
  }
  card.style.left = `${clamp2(x, left, right - width)}px`;
  card.style.top = `${clamp2(y, top, bottom - card.getBoundingClientRect().height)}px`;
}

// src/ui/main.js
function initializeUI(root, { game = createGameAPI(), storageKey = "fated-tactical/battle-v1", crossedKey = "fated-tactical/carry-v1", signal, initialState, customBattle, storage: storageArea } = {}) {
  const document2 = root.ownerDocument, window2 = document2.defaultView;
  const localStorage2 = storageArea ?? window2?.localStorage;
  const $ = (id3) => root.querySelector(`[id="${id3}"]`);
  const view = createRenderer(root);
  const scenario = $("scenario-select"), mode = $("mode-select"), seed = $("seed-input");
  const storage = { getItem: (key3) => {
    try {
      return localStorage2?.getItem(key3) ?? null;
    } catch {
      return null;
    }
  }, setItem: (key3, value) => {
    try {
      localStorage2?.setItem(key3, value);
    } catch {
    }
  }, removeItem: (key3) => {
    try {
      localStorage2?.removeItem(key3);
    } catch {
    }
  } };
  let state, selectedId, action, hover, target2, sprint = false, timer, pending, carry, inspectedId, message = "";
  let menuButtons = /* @__PURE__ */ new Map();
  const active = () => state.units[state.order[state.turn]];
  const error2 = (value) => {
    message = value;
    $("action-error").hidden = !value;
    $("action-error").textContent = value ?? "";
  };
  const draw = () => {
    view.render(state, { selectedId, action, hover: target2 ?? hover, sprint, target: target2, inspectedId, error: message, scenarioOptions: customBattle ? {} : void 0 });
  };
  const drawPreview = draw;
  const measurement = [$("measure-origin"), $("measure-target")];
  function measure() {
    const [from, to] = measurement.map((input) => state.units[input.value]);
    if (!from || !to) {
      $("measure-readout").textContent = "\u6CA1\u6709\u53EF\u6D4B\u8DDD\u7684\u5355\u4F4D\u3002";
      return;
    }
    const dz = elevation(state, from) - elevation(state, to), cover = coverBetween(state, from, to);
    $("measure-readout").textContent = `${from.name} \u2192 ${to.name} \xB7 \u6218\u68CB ${distance3D(state, from, to).toFixed(2)}\uFF0F\u539F\u534F\u8BAE ${game.protocolDistance({ ...from, z: elevation(state, from) }, { ...to, z: elevation(state, to) })} \xB7 \u0394Z ${dz > 0 ? "+" : ""}${dz} \xB7 ${!hasLOS(state, from, to) ? "# \u5899\u4F53\u963B\u65AD" : cover ? `${cover.id} \u906E\u853D \u2212${cover.cover}` : "\u89C6\u7EBF\u901A\u7545"}`;
  }
  function refreshMeasurement() {
    const living2 = Object.values(state.units).filter((u) => u.hp > 0);
    for (const [i, input] of measurement.entries()) {
      const old = input.value;
      input.replaceChildren(...living2.map((u) => {
        const option = new window2.Option(`${u.name} (${u.x},${u.y},Z${elevation(state, u)})`, u.id);
        option.dataset.faction = u.team;
        return option;
      }));
      input.value = living2.some((u) => u.id === old) ? old : (i ? living2.find((u) => u.team === "red") : active())?.id ?? living2.at(-1)?.id ?? "";
      input.dataset.faction = state.units[input.value]?.team ?? "";
    }
    measure();
  }
  function safely(fn) {
    try {
      error2("");
      return fn();
    } catch (e) {
      error2(e.message);
      return void 0;
    }
  }
  if (customBattle) scenario.closest("label").hidden = true;
  else for (const [id3, { title }] of Object.entries(SCENARIOS)) scenario.add(new window2.Option(title, id3));
  function scenarioDescription() {
    $("scenario-preview").textContent = customBattle ? "\u6765\u81EA\u5F53\u524D\u804A\u5929 \xB7 10\xD710" : SCENARIOS[scenario.value].description + (carry ? " \xB7 \u5DF2\u8F7D\u5165\u8DE8\u6218\u88C5\u5907\u4E0E\u72B6\u6001" : "");
    $("clear-persistent").hidden = !!customBattle || !carry;
  }
  function configure(id3) {
    if (customBattle) seed.value = customBattle.seed ?? 0;
    else {
      scenario.value = Object.hasOwn(SCENARIOS, id3) ? id3 : "ruins";
      seed.value = SCENARIOS[scenario.value].seed;
    }
    scenarioDescription();
  }
  function restart() {
    if (!seed.value || !seed.checkValidity()) throw new Error("\u79CD\u5B50\u987B\u4E3A 0\u20134294967295 \u7684\u6574\u6570");
    if (customBattle) {
      const value = Number(seed.value);
      const state2 = customBattle.restart({ seed: value, mode: mode.value });
      game.createBattle({ kind: "custom_state", state: state2 });
      customBattle.seed = value;
      storage.setItem(`${storageKey}/seed`, String(value));
      return;
    }
    game.createBattle({ scenarioId: scenario.value, mode: mode.value, ruleset: "protocol", seed: Number(seed.value), ...carry ? { persistentSnapshot: carry } : {} });
  }
  function schedule() {
    clearTimeout(timer);
    if (!state?.outcome && active()?.team === "red" && $("auto-ai").checked) {
      timer = setTimeout(() => safely(() => game.stepEnemy()), Number($("ai-speed").value));
    }
  }
  function pauseAI() {
    $("auto-ai").checked = false;
    $("auto-ai").onchange();
  }
  function clearProposal() {
    pending = null;
    $("sandbox-commit").disabled = true;
  }
  function sandboxOutput(value) {
    $("sandbox-output").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  function update({ resetAction = false, save = false } = {}) {
    const previous = state;
    state = game.getBattleState();
    if (resetAction || !state.units[selectedId]) {
      selectedId = active()?.id;
      action = null;
      hover = target2 = null;
      sprint = false;
      inspectedId = null;
      $("target-actions").hidden = true;
    }
    draw();
    refreshMeasurement();
    if (save) {
      try {
        storage.setItem(storageKey, JSON.stringify(game.exportBattleSnapshot()));
      } catch {
        error2("\u6D4F\u89C8\u5668\u5B58\u50A8\u7A7A\u95F4\u4E0D\u8DB3\u6216\u5DF2\u5173\u95ED\uFF1B\u8BF7\u4E0B\u8F7D\u5FEB\u7167\u4FDD\u5B58\u6218\u5C40\u3002");
      }
      schedule();
    }
    return previous;
  }
  function execute(next) {
    return safely(() => game.playAction(next));
  }
  function pointFrom(el2) {
    const cell = el2.closest("[data-x][data-y]");
    return cell ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
  }
  const cellFor = (at) => $("board").querySelector(`[data-x="${at.x}"][data-y="${at.y}"]`);
  function layoutTargetCard() {
    if (!target2 || $("target-actions").hidden) return;
    const anchor = cellFor(target2);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect(), clip = anchor.closest(".axis-scroll").getBoundingClientRect();
    const viewport = window2?.visualViewport;
    if (r.right <= Math.max(clip.left, viewport?.offsetLeft ?? 0) || r.left >= Math.min(clip.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window2.innerWidth)) || r.bottom <= (viewport?.offsetTop ?? 0) || r.top >= (viewport?.offsetTop ?? 0) + (viewport?.height ?? window2.innerHeight)) {
      closeTarget();
      return;
    }
    placeTargetCard($("target-actions"), anchor, viewport);
  }
  function closeTarget(restoreFocus = false) {
    const at = target2;
    target2 = action = null;
    $("target-actions").hidden = true;
    draw();
    if (restoreFocus && at) cellFor(at)?.focus({ preventScroll: true });
  }
  const labelByType = { use_item: "\u4F7F\u7528\u526F\u624B\u9053\u5177", move: "\u79FB\u52A8", sprint: "\u75BE\u8DD1\u81F3\u6B64", disengage: "\u64A4\u79BB", attack: "\u666E\u653B", interact: "\u4E92\u52A8", brace: "\u67B6\u52BF\u9632\u5FA1", block: "\u683C\u6321", shield_bash: "\u76FE\u51FB", charge: "\u84C4\u529B", lock_on: "\u5B9A\u4F4D", scan: "\u63A2\u5BDF", grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E", flee: "\u9003\u8DD1", detour: "\u7ED5\u884C", reload: "\u88C5\u586B", end: "\u7ED3\u675F\u56DE\u5408" };
  function handlePoint(at, input = {}) {
    error2("");
    const unit = Object.values(state.units).find((u) => u.hp > 0 && u.x === at.x && u.y === at.y);
    const feature = [...Object.values(state.covers), ...Object.values(state.interactives)].find((v) => v.x === at.x && v.y === at.y);
    const actor = active();
    const canAct = actor?.team === "blue" && !state.outcome;
    const self = canAct && unit?.id === actor.id;
    if (self) {
      const check = game.previewAction({ type: "sprint" });
      sprint = !sprint && check.ok;
      if (!check.ok) error2(check.error);
    }
    selectedId = unit?.id ?? actor?.id;
    inspectedId = unit ? null : feature?.id;
    target2 = at;
    hover = at;
    action = null;
    const options = [];
    $("bonus-dice-select").value = String(Math.min(Number($("bonus-dice-select").value), actor?.bonusDice ?? 0));
    const add = (type, skill2) => {
      const targetless = ["brace", "block", "charge", "scan", "flee", "use_item", "detour", "reload", "end"].includes(type);
      const command = {
        type,
        ...targetless ? {} : at,
        ...skill2 ? { skillId: skill2 } : {},
        ...type === "attack" || type === "skill" ? {
          intent: $("intent-select").value,
          nonLethal: $("nonlethal-toggle").checked,
          bonusDice: Number($("bonus-dice-select").value)
        } : {}
      };
      const plan = game.previewAction(command);
      if (plan.ok) options.push({ command, plan, label: skill2 ? plan.name : labelByType[type] });
    };
    if (canAct) {
      if (self) {
        add("brace");
        add("block");
        add("charge");
        add("scan");
        add("flee");
        add("use_item");
        add("reload");
      } else {
        add(sprint ? "sprint" : "move");
        add("disengage");
        add("attack");
        add("lock_on");
        add("grapple");
        add("disarm");
        add("trip");
        add("push");
      }
      add("interact");
      for (const skill2 of actor.skills) add("skill", skill2);
      for (const [skill2] of equippedActiveSkills(state, actor)) add("skill", skill2);
      if (self) add("end");
    }
    $("target-title").textContent = `${unit?.name ?? feature?.name ?? "\u5730\u5757"} \xB7 (${at.x}, ${at.y})${self ? sprint ? " \xB7 \u75BE\u8DD1\u5DF2\u542F\u7528" : " \xB7 \u666E\u901A\u79FB\u52A8" : ""}`;
    const toolbar = $("action-toolbar");
    toolbar.replaceChildren();
    menuButtons = /* @__PURE__ */ new Map();
    for (const { command, plan, label } of options) {
      const button = document2.createElement("button");
      button.type = "button";
      button.className = "game-button";
      button.dataset.action = command.type;
      if (command.skillId) button.dataset.skillId = command.skillId;
      const risky = plan.opportunities?.length;
      button.textContent = [label, plan.ap ? `${plan.ap} AP` : "", plan.mp ? `${plan.mp} MP` : "", plan.sp ? `${plan.sp} SP` : "", risky ? "\u26A0" : ""].filter(Boolean).join(" \xB7 ");
      button.setAttribute("aria-pressed", "false");
      menuButtons.set(button, { command, plan, label });
      toolbar.append(button);
    }
    if (!options.length) toolbar.textContent = canAct ? "\u5F53\u524D\u6CA1\u6709\u9002\u7528\u4E8E\u8FD9\u4E00\u683C\u7684\u52A8\u4F5C\u3002" : "\u5F53\u524D\u4E0D\u80FD\u884C\u52A8\uFF0C\u4EC5\u67E5\u770B\u5730\u5757\u3002";
    $("target-preview").open = Boolean(options[0]?.plan.opportunities?.length);
    $("target-actions").hidden = false;
    $("target-actions").scrollTop = 0;
    $("confirm-action").hidden = true;
    if (options.length) action = options[0].command;
    draw();
    layoutTargetCard();
    if (input.detail === 0) (toolbar.querySelector("button") ?? $("close-target")).focus({ preventScroll: true });
  }
  function handleAction(button) {
    const choice = menuButtons.get(button);
    if (!choice) return;
    const { command, plan, label } = choice;
    error2("");
    if (!(["skill", "attack"].includes(command.type) || plan.opportunities?.length)) {
      execute(command);
      return;
    }
    action = command;
    for (const btn of menuButtons.keys()) btn.setAttribute("aria-pressed", String(btn === button));
    const confirm = $("confirm-action");
    confirm.hidden = false;
    confirm.textContent = `\u786E\u8BA4${label}`;
    $("target-preview").open = true;
    draw();
  }
  function hoverPoint(point) {
    hover = point;
    if (!target2) drawPreview();
  }
  function download(kind, value, format = "json") {
    const link = document2.createElement("a");
    const isText = format === "txt";
    const url = window2.URL.createObjectURL(new window2.Blob([isText ? value : JSON.stringify(value, null, 2)], { type: isText ? "text/plain;charset=utf-8" : "application/json" }));
    link.href = url;
    link.download = `fated-${state.scenarioId}-${kind}.${format}`;
    link.click();
    setTimeout(() => window2.URL.revokeObjectURL(url), 1e3);
  }
  function bindControls() {
    for (const input of measurement) input.onchange = () => {
      input.dataset.faction = state.units[input.value]?.team ?? "";
      measure();
    };
    scenario.addEventListener("change", () => configure(scenario.value), { signal });
    $("intent-select").onchange = () => {
      if (target2) handlePoint(target2);
    };
    $("nonlethal-toggle").onchange = () => {
      if (target2) handlePoint(target2);
    };
    $("bonus-dice-select").onchange = () => {
      if (target2) handlePoint(target2);
    };
    $("theme-select").onchange = () => {
      const theme = $("theme-select").value;
      root.dataset.dlcTheme = theme;
      try {
        storage.setItem("fated-tactical/theme", theme);
      } catch {
      }
    };
    $("clear-persistent").onclick = () => {
      carry = null;
      try {
        storage.removeItem(crossedKey);
      } catch {
      }
      scenarioDescription();
    };
    $("reset-button").onclick = () => safely(restart);
    $("end-turn").onclick = () => {
      if (active()?.team === "blue") execute({ type: "end" });
    };
    $("undo-button").onclick = () => safely(() => {
      pauseAI();
      const result = game.undoLastCommit();
      if (!result.ok) error2(result.error);
    });
    $("ai-step").onclick = () => safely(() => {
      clearTimeout(timer);
      game.stepEnemy();
    });
    $("auto-ai").onchange = () => {
      try {
        storage.setItem("fated-tactical/auto", String($("auto-ai").checked));
      } catch {
      }
      schedule();
    };
    $("ai-speed").onchange = schedule;
    const report = $("report-text"), reportMessage = $("report-message");
    $("export-report").onclick = () => {
      report.value = game.exportBattleReportText();
      reportMessage.textContent = "";
      $("report-dialog").showModal();
    };
    $("copy-report").onclick = async () => {
      try {
        await window2.navigator.clipboard.writeText(report.value);
        reportMessage.textContent = "\u5DF2\u590D\u5236\u3002";
      } catch {
        report.focus();
        report.select();
        reportMessage.textContent = "\u6D4F\u89C8\u5668\u4E0D\u5141\u8BB8\u81EA\u52A8\u590D\u5236\uFF0C\u8BF7\u6309 Ctrl+C \u6216\u4E0B\u8F7D TXT\u3002";
      }
    };
    $("download-report").onclick = () => download("report", report.value, "txt");
    $("export-snapshot").onclick = () => download("battle", game.exportBattleSnapshot());
    $("export-persistent").onclick = () => download("persistent", game.exportPersistentCarryOver());
    $("import-button").onclick = () => $("import-snapshot").click();
    $("import-snapshot").onchange = async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error("JSON \u6587\u4EF6\u5927\u4E8E 8 MiB");
        const data = JSON.parse(await file.text());
        if (data.kind === "persistent") {
          const previous = carry;
          carry = data;
          try {
            restart();
          } catch (e) {
            carry = previous;
            throw e;
          }
          try {
            storage.setItem(crossedKey, JSON.stringify(carry));
          } catch {
          }
          scenarioDescription();
        } else {
          const restored = game.restoreBattleSnapshot(data);
          configure(restored.scenarioId);
          mode.value = restored.mode;
          if (restored.migratedFrom) {
            error2("\u5DF2\u6062\u590D\u65E7\u6218\u5C40\uFF1B\u501F\u673A\u89C4\u5219\u4ECE\u73B0\u5728\u751F\u6548\uFF0C\u65E7\u64A4\u9500\u8BB0\u5F55\u672A\u8FC1\u79FB\u3002");
            return;
          }
        }
        error2("");
      } catch (e) {
        error2(`\u5BFC\u5165\u5931\u8D25\uFF1A${e.message}`);
      }
    };
    const editor = $("sandbox-editor"), reason = $("sandbox-reason");
    for (const input of [editor, reason]) input.addEventListener("input", clearProposal, { signal });
    $("api-sandbox").addEventListener("click", (event) => {
      const kind = event.target.closest("[data-example]")?.dataset.example;
      if (!kind) return;
      const commands2 = {
        counter: () => ({ type: "adjust_item_counter", instanceId: "soulblade-lan", counterKey: "souls", operation: "add", value: 1 }),
        status: () => ({ type: "upsert_status", unitId: selectedId ?? active()?.id, statusId: "haste", options: { durationType: "persistent" } }),
        "custom-status": () => {
          const id3 = "bone_frost";
          const apply = { type: "upsert_status", unitId: selectedId ?? active()?.id, statusId: id3 };
          if (Object.hasOwn(game.listStatusTemplates(), id3)) return [apply];
          return [{ type: "define_status_template", template: {
            id: id3,
            name: "\u8680\u9AA8\u5BD2\u971C",
            icon: "\u2744\uFE0F",
            description: "\u56DE\u5408\u521D\u53D7\u5230 3 \u70B9\u80FD\u91CF\u4F24\u5BB3\uFF0C\u79FB\u52A8\u8DDD\u79BB \u22121\u3002",
            category: "dot",
            remainingTurns: 2,
            durationType: "battle_turns",
            tickTiming: "onTurnStart",
            stackRule: "refresh",
            maxStacks: 1,
            modifiers: { damage: 3, damageType: "energy", movement: -1 }
          } }, apply];
        },
        terrain: () => ({ type: "set_terrain_cell", x: 0, y: 0, patch: { kind: "slope", z: 1 } })
      };
      const example = commands2[kind]();
      editor.value = JSON.stringify(Array.isArray(example) ? example : [example], null, 2);
      clearProposal();
    }, { signal });
    $("sandbox-preview").onclick = () => {
      clearProposal();
      try {
        const result = game.proposeCommands(JSON.parse(editor.value), { baseRevision: game.getStateSummary().revision, reason: reason.value });
        sandboxOutput(result);
        if (result.ok) {
          pending = result.proposalId;
          $("sandbox-commit").disabled = false;
        }
      } catch (e) {
        sandboxOutput(`JSON \u65E0\u6548\uFF1A${e.message}`);
      }
    };
    $("sandbox-commit").onclick = () => {
      const result = game.commitProposal(pending);
      clearProposal();
      sandboxOutput(result);
    };
    $("sandbox-undo").onclick = () => {
      pauseAI();
      sandboxOutput(game.undoLastCommit());
      clearProposal();
    };
    $("resource-button").onclick = () => {
      const unit = state.units[selectedId] ?? active();
      const previous = unit ? { hp: { current: unit.hp, max: unit.maxHp }, mp: { current: unit.mp, max: unit.maxMp }, sp: { current: unit.sp, max: unit.maxSp } } : void 0;
      $("resource-input").value = JSON.stringify({ stats: unit?.stats ?? { str: 4, agi: 4, con: 4, int: 4, spi: 4 }, tier: 1, previous }, null, 2);
      $("calculate-resources").click();
      $("resource-dialog").showModal();
    };
    $("calculate-resources").onclick = () => {
      try {
        const result = game.calculatePrebattleResources(JSON.parse($("resource-input").value));
        $("resource-output").textContent = [
          `\u4E94\u7EF4\u5408\u8BA1 ${result.statSum} \xB7 MC ${result.mc} \xB7 \u96C6\u7FA4 ${result.count} \xB7 \u53EC\u5524\u521D\u59CB\u603B\u6570 ${result.summonCount}`,
          ...Object.entries(result.resources).map(([k, v]) => `${k.toUpperCase()} ${v.current}/${v.max}\uFF08\u4E58\u6570 ${result.multipliers[k]}\uFF0C\u672A\u53D6\u6574\u4E0A\u9650 ${v.rawMax}\uFF09`)
        ].join("\n");
      } catch (e) {
        $("resource-output").textContent = e.message;
      }
    };
    $("close-target").onclick = () => closeTarget(true);
    $("target-preview").addEventListener("toggle", layoutTargetCard, { signal });
    document2.addEventListener("pointerdown", (e) => {
      if (target2 && !$("target-actions").contains(e.target) && !pointFrom(e.target)) closeTarget();
    }, { signal });
    window2.addEventListener("scroll", layoutTargetCard, { capture: true, passive: true, signal });
    window2.addEventListener("resize", layoutTargetCard, { signal });
    window2.visualViewport?.addEventListener("resize", layoutTargetCard, { signal });
    window2.visualViewport?.addEventListener("scroll", layoutTargetCard, { signal });
    $("confirm-action").onclick = () => {
      if (target2 && action) execute(action);
    };
    document2.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && target2 && !root.querySelector("dialog[open]")) closeTarget(true);
    }, { signal });
    $("action-toolbar").onclick = (e) => {
      const button = e.target.closest("[data-action]");
      if (button) handleAction(button);
    };
    $("turn-order").onclick = (e) => {
      const button = e.target.closest("[data-unit-id]");
      if (!button) return;
      selectedId = button.dataset.unitId;
      inspectedId = null;
      closeTarget();
    };
    $("board").onclick = (e) => {
      const at = pointFrom(e.target);
      if (at) handlePoint(at, e);
    };
    $("board").onpointerover = (e) => {
      const at = pointFrom(e.target), before = e.relatedTarget instanceof Element && pointFrom(e.relatedTarget);
      if (at && (!before || at.x !== before.x || at.y !== before.y)) hoverPoint(at);
    };
    $("board").onpointerleave = () => hoverPoint(null);
    $("board").onfocusin = (e) => {
      const at = pointFrom(e.target);
      if (at) hoverPoint(at);
    };
    $("board").onfocusout = (e) => {
      if (!$("board").contains(e.relatedTarget)) hoverPoint(null);
    };
  }
  configure("ruins");
  let snapshot;
  try {
    snapshot = initialState;
    if (!initialState || customBattle?.restoreSaved) {
      const saved = JSON.parse(storage.getItem(storageKey));
      if (saved?.state?.scenarioId === initialState?.scenarioId || !initialState) snapshot = saved ?? initialState;
    }
    carry = JSON.parse(storage.getItem(crossedKey));
    $("auto-ai").checked = storage.getItem("fated-tactical/auto") !== "false";
    const theme = storage.getItem("fated-tactical/theme");
    if (["amethyst", "night-gold", "frost-silver"].includes(theme)) {
      root.dataset.dlcTheme = theme;
      $("theme-select").value = theme;
    }
  } catch {
  }
  try {
    if (snapshot) {
      const restored = snapshot.kind === "battle" ? game.restoreBattleSnapshot(snapshot) : game.createBattle({ kind: "custom_state", state: snapshot });
      if (restored.migratedFrom) error2("\u5DF2\u7EED\u63A5\u65E7\u6218\u5C40\uFF1B\u501F\u673A\u89C4\u5219\u4ECE\u73B0\u5728\u751F\u6548\uFF0C\u65E7\u64A4\u9500\u8BB0\u5F55\u672A\u8FC1\u79FB\u3002");
    } else game.createBattle({ scenarioId: "ruins", ruleset: "protocol" });
  } catch (cause) {
    if (customBattle) {
      if (snapshot === initialState) throw cause;
      game.createBattle({ kind: "custom_state", state: initialState });
      error2("\u5B58\u6863\u683C\u5F0F\u4E0D\u517C\u5BB9\uFF0C\u5DF2\u91CD\u65B0\u52A0\u8F7D\u6B63\u6587\u6218\u5C40\u3002");
    } else {
      game.createBattle({ scenarioId: "ruins", ruleset: "protocol" });
      error2("\u5B58\u6863\u683C\u5F0F\u4E0D\u517C\u5BB9\uFF0C\u5DF2\u6253\u5F00\u9ED8\u8BA4\u6218\u5C40\u3002");
    }
  }
  if (customBattle) {
    const savedSeed = storage.getItem(`${storageKey}/seed`);
    if (snapshot?.kind === "battle" && savedSeed != null && /^\d+$/.test(savedSeed)) customBattle.seed = Number(savedSeed);
    else storage.setItem(`${storageKey}/seed`, String(customBattle.seed ?? 0));
  }
  const initial = game.getStateSummary();
  configure(initial.scenarioId);
  mode.value = initial.mode;
  bindControls();
  game.subscribe(() => {
    const hadProposal = Boolean(pending);
    clearProposal();
    if (hadProposal) sandboxOutput("\u6218\u5C40\u5DF2\u53D8\u5316\uFF0C\u9700\u91CD\u65B0\u8BD5\u7B97\u3002");
    const before = update({ resetAction: true, save: true });
    if (before && state.logs.length > before.logs.length) view.feedback(before, state);
  });
  update({ resetAction: true, save: true });
  return { loadState(snapshot2) {
    const result = snapshot2?.kind === "battle" ? game.restoreBattleSnapshot(snapshot2) : game.createBattle({ kind: "custom_state", state: snapshot2 });
    if (!customBattle) configure(result.scenarioId);
    mode.value = result.mode;
    error2("");
    update({ resetAction: true, save: true });
    return result;
  }, getState: () => game.getBattleState(), exportBattleReportText: () => game.exportBattleReportText(), exportMvuPatch: () => ({ kind: "battle", state: game.getBattleState() }), api: game, destroy() {
    clearTimeout(timer);
  } };
}

// src/ui/styles.js
var battleTheme = `:root{--ink-0:#141423;--ink-1:#1e1e32;--ink-2:#11111d;--surface:#252035;--surface-hover:#2f2a42;--raised-a:#393045;--raised-b:#292536;--field:#252035;--well-a:rgba(42, 34, 58, .85);--well-b:rgba(14, 15, 27, .94);--shade-rgb:12 11 20;--accent-rgb:176 142 92;--gold:#dfc080;--gold-rgb:223 192 128;--gold-bright:#ffd700;--gold-soft:#d7bb7c;--gold-dim:#8b7355;--frame-rgb:139 115 85;--glow-rgb:120 100 190;--hairline-rgb:255 215 0;--sheen-rgb:255 240 220;--accent-text:#f0dfb9;--accent-label:#e0cb9d;--selected-bg:#3a3045;--btn-a:#776044;--btn-b:#5b4b3e;--btn-hover-a:#856d4f;--btn-hover-b:#665342;--btn-text:#fff0ca;--btn-line-rgb:209 179 118;--focus:#ffe2a0;--text:#e8d5b7;--text-soft:#d2c3ab;--text-key:#c7b4e2;--text-muted:#c9c0d0;--neutral-rgb:200 188 208;--neutral-text:#ece0cd;--scrollbar:#927753;--panel-bg:linear-gradient(180deg, rgba(30, 30, 50, .95) 0%, rgba(20, 20, 35, .98) 100%);--panel-border:2px solid #8b7355;--topline:linear-gradient(90deg, transparent, #ffd700, transparent);--topline-left:0px;--topline-width:100%;--topline-height:3px;--header-bg:linear-gradient(90deg, #2d2d44 0%, #3d3d5c 50%, #2d2d44 100%);--header-hover:linear-gradient(90deg, #3d3d5c 0%, #4d4d6c 50%, #3d3d5c 100%);--header-line:#8b7355;--title-shadow:0 0 10px rgba(255, 215, 0, .3);--row-bg:rgba(0, 0, 0, .3);--row-border:rgba(139, 115, 85, .3);--row-edge:rgba(139, 115, 85, .3);--heading:#dfc080;--entry-text:#d2cbdc;--entry-current:#f4d98d;--icon-glow:0 0 10px rgba(255, 215, 0, .5);--font-display:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif;--font-body:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif}
:root[data-dlc-theme="amethyst"]{--ink-0:#141423;--ink-1:#1e1e32;--ink-2:#11111d;--surface:#252035;--surface-hover:#2f2a42;--raised-a:#393045;--raised-b:#292536;--field:#252035;--well-a:rgba(42, 34, 58, .85);--well-b:rgba(14, 15, 27, .94);--shade-rgb:12 11 20;--accent-rgb:176 142 92;--gold:#dfc080;--gold-rgb:223 192 128;--gold-bright:#ffd700;--gold-soft:#d7bb7c;--gold-dim:#8b7355;--frame-rgb:139 115 85;--glow-rgb:120 100 190;--hairline-rgb:255 215 0;--sheen-rgb:255 240 220;--accent-text:#f0dfb9;--accent-label:#e0cb9d;--selected-bg:#3a3045;--btn-a:#776044;--btn-b:#5b4b3e;--btn-hover-a:#856d4f;--btn-hover-b:#665342;--btn-text:#fff0ca;--btn-line-rgb:209 179 118;--focus:#ffe2a0;--text:#e8d5b7;--text-soft:#d2c3ab;--text-key:#c7b4e2;--text-muted:#c9c0d0;--neutral-rgb:200 188 208;--neutral-text:#ece0cd;--scrollbar:#927753;--panel-bg:linear-gradient(180deg, rgba(30, 30, 50, .95) 0%, rgba(20, 20, 35, .98) 100%);--panel-border:2px solid #8b7355;--topline:linear-gradient(90deg, transparent, #ffd700, transparent);--topline-left:0px;--topline-width:100%;--topline-height:3px;--header-bg:linear-gradient(90deg, #2d2d44 0%, #3d3d5c 50%, #2d2d44 100%);--header-hover:linear-gradient(90deg, #3d3d5c 0%, #4d4d6c 50%, #3d3d5c 100%);--header-line:#8b7355;--title-shadow:0 0 10px rgba(255, 215, 0, .3);--row-bg:rgba(0, 0, 0, .3);--row-border:rgba(139, 115, 85, .3);--row-edge:rgba(139, 115, 85, .3);--heading:#dfc080;--entry-text:#d2cbdc;--entry-current:#f4d98d;--icon-glow:0 0 10px rgba(255, 215, 0, .5)}
:root[data-dlc-theme="night-gold"]{--ink-0:#090c12;--ink-1:#0e121a;--ink-2:#0a0d14;--surface:#151a23;--surface-hover:#1b212c;--raised-a:#1f2531;--raised-b:#161b25;--field:#121721;--well-a:rgba(25, 30, 41, .92);--well-b:rgba(10, 13, 19, .96);--shade-rgb:5 7 11;--accent-rgb:185 149 89;--gold:#c9a463;--gold-rgb:201 164 99;--gold-bright:#e4cb92;--gold-soft:#b99559;--gold-dim:#8f7650;--frame-rgb:157 126 74;--glow-rgb:117 92 51;--hairline-rgb:215 183 121;--sheen-rgb:255 244 218;--accent-text:#f0dfb9;--accent-label:#dcc79f;--selected-bg:#211d16;--btn-a:#6d5732;--btn-b:#4d3d24;--btn-hover-a:#7d653b;--btn-hover-b:#5a482a;--btn-text:#fff0c4;--btn-line-rgb:214 180 112;--focus:#f0d79a;--text:#e4dccb;--text-soft:#c2b9a8;--text-key:#a39985;--text-muted:#948e83;--neutral-rgb:185 174 153;--neutral-text:#e7ddca;--scrollbar:#6b5838;--panel-bg:radial-gradient(120% 150% at 0% 0%, rgba(117, 92, 51, .12), transparent 46%), linear-gradient(160deg, #0e121a 0%, #090c12 60%, #0a0d14 100%);--panel-border:1px solid rgba(157, 126, 74, .36);--topline:linear-gradient(90deg, transparent, rgba(215, 183, 121, .62), transparent);--topline-left:18px;--topline-width:min(34%, 190px);--topline-height:1px;--header-bg:linear-gradient(90deg, rgba(185, 149, 89, .06), transparent 56%);--header-hover:rgba(185, 149, 89, .05);--header-line:rgba(185, 149, 89, .13);--title-shadow:none;--row-bg:rgba(255, 255, 255, .02);--row-border:rgba(185, 149, 89, .13);--row-edge:rgba(185, 149, 89, .16);--heading:#c9a463;--entry-text:#c2b9a8;--entry-current:#e4cb92;--icon-glow:none}
:root[data-dlc-theme="frost-silver"]{--ink-0:#0a0e14;--ink-1:#111821;--ink-2:#0b1017;--surface:#151c26;--surface-hover:#1c2532;--raised-a:#1d2531;--raised-b:#151c26;--field:#10161f;--well-a:rgba(24, 32, 44, .92);--well-b:rgba(9, 13, 19, .96);--shade-rgb:4 7 11;--accent-rgb:150 166 184;--gold:#b4c3d3;--gold-rgb:180 195 211;--gold-bright:#e2eaf3;--gold-soft:#a2b2c3;--gold-dim:#6d7b8a;--frame-rgb:112 128 146;--glow-rgb:78 104 138;--hairline-rgb:205 220 236;--sheen-rgb:232 240 250;--accent-text:#e6edf5;--accent-label:#bccad8;--selected-bg:#1b2533;--btn-a:#4a5d72;--btn-b:#34465a;--btn-hover-a:#566b82;--btn-hover-b:#3d5167;--btn-text:#f1f6fc;--btn-line-rgb:168 188 210;--focus:#d6e6f7;--text:#e3e8ee;--text-soft:#b8c1cc;--text-key:#8e9aa8;--text-muted:#8a95a2;--neutral-rgb:162 174 188;--neutral-text:#e3e8ef;--scrollbar:#4e5e70;--panel-bg:radial-gradient(120% 150% at 0% 0%, rgba(78, 104, 138, .14), transparent 46%), linear-gradient(160deg, #111821 0%, #0a0e14 60%, #0b1017 100%);--panel-border:1px solid rgba(112, 128, 146, .4);--topline:linear-gradient(90deg, transparent, rgba(205, 220, 236, .62), transparent);--topline-left:18px;--topline-width:min(34%, 190px);--topline-height:1px;--header-bg:linear-gradient(90deg, rgba(150, 166, 184, .08), transparent 56%);--header-hover:rgba(150, 166, 184, .06);--header-line:rgba(150, 166, 184, .16);--title-shadow:none;--row-bg:rgba(255, 255, 255, .022);--row-border:rgba(150, 166, 184, .14);--row-edge:rgba(150, 166, 184, .2);--heading:#b4c3d3;--entry-text:#b8c1cc;--entry-current:#e2eaf3;--icon-glow:none}
/* \u547D\u5B9A\u6218\u6597\u9762\u677F\uFF1A\u914D\u8272\u5168\u90E8\u6765\u81EA\u4E3B\u9898\u53D8\u91CF\uFF0C\u73A9\u5BB6\u53EF\u5728\u6218\u6597\u76EE\u5F55\u6216\u884C\u52A8\u9009\u62E9\u5668\u7684\u8C03\u8272\u677F\u6309\u94AE\u4E2D\u5207\u6362\u3002 */
    /* \u4E3B\u9898\u8272\u677F\uFF08--ink-*\u3001--gold*\u3001--text* \u7B49\uFF09\u7531 themes.js \u751F\u6210\u5E76\u63D2\u5728\u672C\u8868\u4E4B\u524D\uFF1B\u8FD9\u91CC\u53EA\u653E\u6D3E\u751F\u7EBF\u6761\u4E0E\u56FA\u5B9A\u8BED\u4E49\u8272\u3002 */
    :root {
      --line: rgb(var(--accent-rgb) / .13);
      --line-mid: rgb(var(--accent-rgb) / .26);
      --line-strong: rgb(var(--accent-rgb) / .46);
      --blue-line: #5f93c8;
      --blue-text: #cfe3f7;
      --red-line: #c0727a;
      --red-text: #f6d3d6;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { font-family: var(--font-body); color: var(--text); background: transparent; }
    #output-container { max-width: 800px; margin: 0 auto; }

    /* ---------- \u9762\u677F ---------- */
    .action-panel {
      position: relative;
      margin-bottom: 12px;
      overflow: hidden;
      color: var(--text);
      background: var(--panel-bg);
      border: var(--panel-border);
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .26), inset 0 1px 0 rgb(var(--sheen-rgb) / .035);
    }
    .action-panel::before {
      content: "";
      position: absolute;
      z-index: 1;
      top: 0;
      left: var(--topline-left);
      width: var(--topline-width);
      height: var(--topline-height);
      background: var(--topline);
      pointer-events: none;
    }
    .panel-header-bar {
      display: flex;
      align-items: center;
      min-width: 0;
      background: var(--header-bg);
      border-bottom: 1px solid var(--header-line);
    }
    .panel-header-bar:has(> .panel-header.collapsed) { border-bottom-color: transparent; }
    button.panel-header {
      appearance: none;
      flex: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px 14px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      user-select: none;
      transition: background-color .18s ease;
    }
    button.panel-header:hover { background: var(--header-hover); }
    button.panel-header:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
    /* \u6807\u9898\u56FE\u6807\u6CBF\u7528\u539F\u7248\uFF1A\u5404\u9636\u6BB5\u539F\u8272\u30011.2 \u500D\u5927\u5C0F\u4E0E\u6DE1\u91D1\u5149\u6655\uFF0C\u4E0D\u52A0\u5E95\u6846\u3002 */
    .panel-header .panel-icon {
      flex: none;
      width: 1.25em;
      font-size: 1.2em;
      text-align: center;
      text-shadow: var(--icon-glow);
    }
    .panel-title {
      flex: 1;
      min-width: 0;
      color: var(--gold-bright);
      font-family: var(--font-display);
      font-size: 1.12em;
      font-weight: 700;
      line-height: 1.45;
      letter-spacing: .07em;
      text-shadow: var(--title-shadow);
      overflow-wrap: anywhere;
    }
    .panel-range-number {
      flex: none;
      padding: 0 6px;
      border: 1px solid rgba(181, 154, 232, .5);
      border-radius: 4px;
      color: #d8c9f3;
      font-size: .75em;
      font-variant-numeric: tabular-nums;
    }
    .panel-expand-hint { color: var(--text-muted); font-size: .75em; white-space: nowrap; }
    .panel-toggle { flex: none; color: var(--gold-dim); font-size: .8em; transition: transform .22s ease, color .18s ease; }
    button.panel-header:hover .panel-toggle { color: var(--gold); }
    .panel-header.collapsed .panel-toggle { transform: rotate(-90deg); }
    .panel-content { padding: 9px 12px 12px; }

    /* ---------- \u89C6\u56FE\u5207\u6362 ---------- */
    .view-toolbar {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--line-mid);
      border-radius: 8px;
      background: rgba(0, 0, 0, .28);
      font-size: .82em;
    }
    .panel-header-bar > .view-toolbar { flex: none; margin: 0 12px 0 0; }
    .view-mode-button {
      appearance: none;
      min-height: 32px;
      padding: 3px 12px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-soft);
      font: inherit;
      cursor: pointer;
      transition: background-color .15s ease, color .15s ease;
    }
    .view-mode-button:hover { color: var(--gold-bright); }
    .view-mode-button[aria-pressed="true"] {
      background: rgb(var(--gold-rgb) / .17);
      box-shadow: inset 0 0 0 1px rgb(var(--gold-rgb) / .42);
      color: var(--gold-bright);
    }
    .row-details-toggle {
      appearance: none;
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      margin-top: 4px;
      padding: 5px 12px;
      border: 1px dashed rgb(var(--accent-rgb) / .34);
      border-radius: 6px;
      background: transparent;
      color: var(--text-soft);
      font: inherit;
      font-size: .84em;
      cursor: pointer;
      transition: border-color .15s ease, color .15s ease, background-color .15s ease;
    }
    .row-details-toggle:hover { border-color: var(--line-strong); color: var(--gold-bright); background: rgb(var(--accent-rgb) / .05); }
    .row-details-toggle[aria-expanded="true"] { border-style: solid; }
    .view-mode-button:focus-visible, .row-details-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

    /* ---------- \u6570\u636E\u884C ---------- */
    .data-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 7px;
      margin-bottom: 5px;
      padding: 7px 11px;
      border: 1px solid var(--row-border);
      border-left: 2px solid var(--row-edge);
      border-radius: 6px;
      background: var(--row-bg);
      font-size: .92em;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }
    .data-row:last-child { margin-bottom: 0; }
    /* A row's fields are its flex items; text inside a field flows inline. */
    .field { display: inline; min-width: 0; max-width: 100%; }
    .field .tag, .field .stat, .field .status-effect { margin-block: 2px; }
    .field-key, .field-label, .status-label { color: var(--text-key); font-weight: 400; }
    .field-sep { color: rgb(var(--accent-rgb) / .34); font-weight: 400; }
    /* The trailing separator stays with its field however the field wraps. */
    .field.has-sep { position: relative; padding-right: 13px; }
    .field.has-sep > .field-sep:last-child { position: absolute; right: 0; bottom: 0; }
    .field-group { display: inline-block; }
    .field-group > .tag { margin: 0 .3em; }
    .flow { color: var(--text-muted); white-space: nowrap; }
    .outcome-row { border-left-color: rgb(var(--gold-rgb) / .62); background: rgb(var(--accent-rgb) / .045); }
    .damage-outcome { border-color: rgb(var(--gold-rgb) / .3); border-left-color: var(--gold); background: rgb(var(--accent-rgb) / .09); }
    /* 1.7.5: unit groups in \u4F24\u5BB3\u57FA\u51C6\u8BA1\u7B97/\u7ED3\u7B97\u6E05\u5355. The \u5B88\u65B9 row heads each group (numbered when there are several); the group's rows sit indented under it. */
    .unit-group-row { margin-top: 20px; padding-block: 8px; border-color: rgb(var(--accent-rgb) / .6); border-left: 5px solid rgb(var(--accent-rgb)); background: linear-gradient(90deg, rgb(var(--accent-rgb) / .34), rgb(var(--accent-rgb) / .08) 70%); color: var(--accent-text); font-size: 1em; font-weight: 700; box-shadow: 0 2px 8px rgb(0 0 0 / .25); }
    .unit-group-row:first-child { margin-top: 0; }
    .unit-group-row::before { content: '\u76EE\u6807 ' attr(data-unit-group); padding: 0 9px; border-radius: 999px; background: var(--gold); color: var(--ink-0); font-size: .8em; font-weight: 700; line-height: 1.75; letter-spacing: .06em; white-space: nowrap; }
    .unit-group-only::before { display: none; }
    .unit-group-member { margin-left: 14px; }
    .final-damage-value { color: var(--gold-bright); font-size: 1.18em; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .attack-rating { display: inline-block; color: var(--gold-bright); border-bottom: 1px solid rgb(var(--gold-rgb) / .6); }
    .unit-resource-row[data-faction="blue"] { border-left-color: var(--blue-line); background: rgba(76, 128, 186, .055); }
    .unit-resource-row[data-faction="red"] { border-left-color: var(--red-line); background: rgba(176, 78, 90, .06); }
    .resource-unit-name { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0; max-width: 100%; font-weight: 600; overflow-wrap: anywhere; }
    .resource-unit-name[data-faction="blue"] { color: #a9d0f5; }
    .resource-unit-name[data-faction="red"] { color: #f2b3b9; }
    .resource-unit-name:not([data-faction]) { color: var(--text-key); }
    .resource-faction-label { display: inline-block; margin-right: 6px; padding: 0 5px; border: 1px solid currentColor; border-radius: 4px; font-size: .76em; font-weight: 400; letter-spacing: .06em; }

    /* ---------- \u6807\u7B7E\uFF1A\u540C\u4E00\u5957\u5F62\u72B6\uFF0C\u6309\u8BED\u4E49\u7740\u8272 ---------- */
    .tag {
      --tone: rgb(var(--neutral-rgb));
      --tone-text: var(--neutral-text);
      --tone-bg: rgb(var(--neutral-rgb) / .09);
      --tone-line: rgb(var(--neutral-rgb) / .26);
      display: inline-block;
      max-width: 100%;
      padding: .06em .56em;
      border: 1px solid var(--tone-line);
      border-radius: 5px;
      background: var(--tone-bg);
      color: var(--tone-text);
      font-size: .88em;
      font-weight: 600;
      line-height: 1.6;
      vertical-align: middle;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .tag > i { margin-right: .2em; color: var(--tone); font-size: .9em; }
    .tag-detail { position: relative; padding-left: 1.9em; font-weight: 400; line-height: 1.55; }
    .tag-detail > i { position: absolute; top: .42em; left: .62em; margin: 0; }
    .tag-round, .tone-neutral { --tone: rgb(var(--neutral-rgb)); }
    .tag-combat-role { --tone: var(--neutral-text); --tone-text: var(--neutral-text); --tone-bg: rgb(var(--neutral-rgb) / .1); --tone-line: rgb(var(--neutral-rgb) / .3); }
    .tone-slate { --tone: #9eabbd; --tone-text: #dfe5ee; --tone-bg: rgba(140, 156, 180, .1); --tone-line: rgba(140, 156, 180, .3); }
    .tag-type, .tone-violet { --tone: #b8a0ea; --tone-text: #e6dbfb; --tone-bg: rgba(150, 118, 214, .14); --tone-line: rgba(170, 140, 230, .38); }
    .tag-env, .tone-blue { --tone: #86b8e6; --tone-text: #d6e8f9; --tone-bg: rgba(84, 136, 196, .15); --tone-line: rgba(110, 160, 214, .4); }
    .tone-teal { --tone: #72c8bc; --tone-text: #d0f0eb; --tone-bg: rgba(72, 170, 158, .13); --tone-line: rgba(96, 186, 174, .38); }
    .tone-green { --tone: #80cc9a; --tone-text: #d5f0de; --tone-bg: rgba(84, 170, 116, .13); --tone-line: rgba(110, 190, 138, .38); }
    .tone-gold { --tone: var(--gold); --tone-text: var(--accent-text); --tone-bg: rgb(var(--gold-rgb) / .14); --tone-line: rgb(var(--gold-rgb) / .42); }
    .tone-amber { --tone: #e5a866; --tone-text: #f7dcbc; --tone-bg: rgba(212, 140, 72, .14); --tone-line: rgba(222, 156, 92, .4); }
    .tone-red { --tone: #e78886; --tone-text: #f9d6d5; --tone-bg: rgba(196, 84, 82, .15); --tone-line: rgba(214, 112, 110, .42); }

    /* \u8D44\u6E90\u4FDD\u6301\u5B9E\u8272\uFF0C\u6BD4\u4F8B\u8F68\u9053\u8865\u5145\u6570\u503C\u3002 */
    .tag-resource {
      border-color: transparent;
      color: #fff;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 0 rgba(0, 0, 0, .25);
    }
    .tag-resource > i { color: inherit; opacity: .92; }
    .tag-hp     { background: linear-gradient(135deg, #b03a35, #852a27); }
    .tag-hp-low { background: linear-gradient(135deg, #c46a27, #8d4419); }
    .tag-mp     { background: linear-gradient(135deg, #2f66a3, #234c7e); }
    .tag-mp-low { background: linear-gradient(135deg, #1b7b70, #135a53); }
    .tag-sp     { background: linear-gradient(135deg, #358657, #25633f); }
    .tag-sp-low { background: linear-gradient(135deg, #ad8024, #805e1a); }
    .tag-resource-neutral { background: #2b3039; color: #b8bdc6; text-shadow: none; }
    .tag-resource.resource-meter { position: relative; padding-bottom: 5px; }
    .tag-resource.resource-meter::before,
    .tag-resource.resource-meter::after {
      content: "";
      position: absolute;
      bottom: 1px;
      left: 3px;
      height: 2px;
      border-radius: 2px;
      pointer-events: none;
    }
    .tag-resource.resource-meter::before { width: calc(100% - 6px); background: rgba(0, 0, 0, .3); }
    .tag-resource.resource-meter::after { width: calc((100% - 6px) * var(--resource-ratio)); background: currentColor; opacity: .85; }

    /* \u4E94\u7EF4\u5C5E\u6027 */
    .stat {
      --stat: var(--gold);
      display: inline-flex;
      align-items: center;
      gap: .35em;
      padding: .02em .5em;
      border: 1px solid rgb(var(--gold-rgb) / .4);
      border: 1px solid color-mix(in srgb, var(--stat) 46%, transparent);
      border-radius: 5px;
      background: rgb(var(--gold-rgb) / .08);
      background: color-mix(in srgb, var(--stat) 10%, transparent);
      color: var(--stat);
      font-size: .88em;
      font-weight: 600;
      line-height: 1.6;
      font-variant-numeric: tabular-nums;
      vertical-align: middle;
    }
    .stat > i { font-size: .88em; }
    .stat-str { --stat: #ee948e; }
    .stat-agi { --stat: #83d3a0; }
    .stat-con { --stat: #eeb06a; }
    .stat-int { --stat: #7dbaec; }
    .stat-spi { --stat: #bda3f0; }

    .status-effect {
      display: inline-block;
      max-width: 100%;
      padding: .06em .56em;
      border: 1px solid rgba(170, 140, 230, .38);
      border-radius: 5px;
      background: rgba(150, 118, 214, .12);
      color: #e6dbfb;
      font-size: .88em;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .status-effect + .status-effect { margin-left: 4px; }

    /* \u6587\u672C\u5F3A\u8C03\u8272 */
    .tx-strong { font-weight: 700; }
    .tx-good { color: #8dd5a6; }
    .tx-bad { color: #f09494; }
    .tx-fatal { color: #ff7066; }
    .tx-gold { color: var(--gold-bright); }
    .tx-amber { color: #ecc58a; }
    .tx-violet { color: #cdb8f2; }
    .tx-lilac { color: #e3d8f8; }
    .tx-info { color: #98c9f1; }
    .tx-plain { color: var(--text); }
    .tx-narrative { color: var(--text); font-style: italic; }
    .tx-glow { text-shadow: 0 0 10px rgb(var(--gold-rgb) / .45); }
    .tx-good > i, .tx-bad > i, .tx-fatal > i, .tx-gold > i, .tx-info > i { margin-right: .3em; font-size: .9em; }
    .quality { font-weight: 600; }
    .quality[data-quality="\u666E\u901A"] { color: #c9c9c9; }
    .quality[data-quality="\u4F18\u826F"] { color: #8bddaa; }
    .quality[data-quality="\u7A00\u6709"] { color: #8bbbff; }
    .quality[data-quality="\u53F2\u8BD7"] { color: #ce9cff; }
    .quality[data-quality="\u4F20\u8BF4"] { color: #ffb35c; }
    .quality[data-quality="\u795E\u8BDD"] { color: #ff8585; text-shadow: 0 0 8px rgba(255, 133, 133, .45); }

    /* \u6218\u51B5\u603B\u89C8\u4E2D\u7684\u5750\u6807\u8303\u56F4\u4E0E\u5E38\u9A7B\u4FE1\u606F */
    .overview-field {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 3px 8px;
      max-width: 100%;
      min-width: 0;
      padding: 3px 9px;
      border: 1px solid rgb(var(--gold-rgb) / .3);
      border-radius: 5px;
      background: rgb(var(--accent-rgb) / .08);
      color: var(--text);
    }
    .overview-field-label { flex: 0 0 auto; color: var(--accent-label); font-weight: 600; }
    .overview-field-label i { margin-right: 3px; color: var(--gold); }
    .overview-field-value { min-width: 0; overflow-wrap: anywhere; }
    .overview-coordinate .overview-field-value { color: var(--gold-bright); font-variant-numeric: tabular-nums; }
    .overview-permanent { padding: 5px 10px; border-color: var(--line); border-left: 2px solid rgb(var(--gold-rgb) / .55); background: rgb(var(--accent-rgb) / .05); }
    .overview-permanent .overview-field-value { flex: 1 1 180px; }
    .overview-empty { border-color: rgba(150, 148, 156, .3); border-left-color: rgba(150, 148, 156, .45); background: rgba(122, 119, 130, .08); color: #b7b2bb; }
    .overview-empty .overview-field-label { color: #b9b3bd; }
    .overview-empty .overview-field-label i { color: inherit; }
    .overview-empty .overview-field-value { flex: 0 1 auto; }

    @media (max-width: 600px) {
      button.panel-header { gap: 8px; padding: 9px 11px; }
      .panel-title { font-size: 1em; letter-spacing: .04em; }
      .panel-content { padding: 8px 9px 10px; }
      .data-row { gap: 3px 6px; padding: 6px 8px; font-size: .88em; }
    }

    /* ---------- 10x10 \u6218\u672F\u5E73\u9762\u56FE (XYZ) ---------- */
    .battle-axis {
      --axis-gold: var(--gold);
      --axis-border: rgb(var(--accent-rgb) / .26);
      --axis-muted: var(--text-muted);
      width: 100%;
      max-width: 100%;
      min-width: 0;
      margin-bottom: 10px;
      padding: 12px;
      border: 1px solid var(--axis-border);
      border-radius: 8px;
      background: linear-gradient(165deg, var(--well-a), var(--well-b));
      color: var(--text);
      font-size: .9em;
      line-height: 1.5;
      isolation: isolate;
    }
    .battle-axis *, .battle-axis *::before, .battle-axis *::after { box-sizing: border-box; }
    .battle-axis .axis-meta { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; margin-bottom: 10px; }
    .battle-axis .axis-caption { min-width: 0; color: var(--axis-gold); font-family: var(--font-display); font-size: 1.04em; font-weight: 600; letter-spacing: .08em; overflow-wrap: anywhere; }
    .battle-axis .axis-bounds { color: var(--axis-muted); font-size: .84em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .battle-axis .axis-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: 10px; min-width: 0; }
    .battle-axis .axis-toolbar label { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: var(--axis-muted); font-size: .85em; }
    .battle-axis .axis-select {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 40px;
      padding: 6px 26px 6px 10px;
      border: 1px solid var(--line-mid);
      border-radius: 6px;
      background: var(--field);
      color: var(--text);
      font: inherit;
      font-size: 1em;
      text-overflow: ellipsis;
      color-scheme: dark;
      cursor: pointer;
    }
    .battle-axis .axis-select option { background: var(--field); color: var(--text); }
    .battle-axis .axis-select[data-faction="blue"] { border-color: var(--blue-line); color: var(--blue-text); }
    .battle-axis .axis-select[data-faction="red"] { border-color: var(--red-line); color: var(--red-text); }
    .battle-axis .axis-readout { min-height: 2.2em; margin: 8px 0 6px; padding: 6px 9px; border-radius: 6px; border: 1px solid rgb(var(--accent-rgb) / .16); background: rgb(var(--shade-rgb) / .38); color: var(--text-soft); font-size: .85em; overflow-wrap: anywhere; }
    .battle-axis .axis-readout-unit[data-faction="blue"] { color: #a9d0f5; font-weight: 600; }
    .battle-axis .axis-readout-unit[data-faction="red"] { color: #f2b3b9; font-weight: 600; }
    .battle-axis .axis-scroll-hint { padding: 1px 0 5px; color: var(--axis-muted); font-size: .78em; }
    .battle-axis .axis-scroll-hint[hidden] { display: none; }
    .battle-axis .axis-scroll {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 3px 0 8px;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar) transparent;
    }
    .battle-axis .axis-scroll::-webkit-scrollbar { height: 7px; }
    .battle-axis .axis-scroll::-webkit-scrollbar-track { background: transparent; }
    .battle-axis .axis-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }

    .battle-axis .tactical-board-wrap {
      display: grid;
      grid-template-columns: 22px minmax(520px, 1fr);
      gap: 4px;
      align-items: stretch;
      width: 100%;
    }
    .battle-axis .tactical-y-rail {
      display: grid;
      grid-template-rows: repeat(10, minmax(56px, 1fr));
      gap: 2px;
      color: var(--axis-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      user-select: none;
    }
    .battle-axis .tactical-y-rail > span {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 4px;
    }
    .battle-axis .tactical-x-rail {
      grid-column: 2;
      display: grid;
      grid-template-columns: repeat(10, minmax(0, 1fr));
      gap: 2px;
      color: var(--axis-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      text-align: center;
      user-select: none;
      padding-top: 2px;
    }
    .battle-axis .tactical-grid {
      display: grid;
      grid-template-columns: repeat(10, minmax(0, 1fr));
      grid-template-rows: repeat(10, minmax(56px, 1fr));
      gap: 2px;
      padding: 4px;
      border: 1px solid rgb(var(--accent-rgb) / .34);
      border-radius: 7px;
      background:
        radial-gradient(circle at 50% 45%, rgb(var(--accent-rgb) / .06), transparent 70%),
        rgb(var(--shade-rgb) / .72);
    }
    .battle-axis .tactical-cell {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
      min-height: 56px;
      padding: 3px 2px 2px;
      border: 1px solid rgb(var(--accent-rgb) / .11);
      border-radius: 4px;
      background: linear-gradient(170deg, rgba(255, 255, 255, .018), rgb(var(--shade-rgb) / .35));
      transition: border-color .14s ease, background .14s ease;
    }
    .battle-axis .tactical-cell:hover { border-color: rgb(var(--gold-rgb) / .45); }
    .battle-axis .tactical-cell.terrain-plateau[data-terrain-elev="pos1"] {
      background: linear-gradient(170deg, rgba(212, 175, 55, .07), rgba(180, 148, 52, .12));
    }
    .battle-axis .tactical-cell.terrain-plateau[data-terrain-elev="pos2"] {
      background: linear-gradient(170deg, rgba(212, 175, 55, .13), rgba(180, 148, 52, .20));
    }
    .battle-axis .tactical-cell.terrain-plateau[data-terrain-elev="neg"] {
      background: linear-gradient(170deg, rgba(72, 128, 180, .09), rgba(45, 92, 142, .16));
    }
    .battle-axis .tactical-cell.terrain-slope {
      background: linear-gradient(135deg, rgba(84, 168, 118, .12), rgba(56, 128, 86, .20));
      border-color: rgba(110, 194, 140, .32);
    }
    .battle-axis .tactical-cell.terrain-wall {
      background:
        repeating-linear-gradient(
          -45deg,
          rgba(78, 82, 92, .48) 0 5px,
          rgba(42, 45, 52, .62) 5px 10px
        );
      border-color: rgba(128, 134, 148, .38);
    }
    .battle-axis .tactical-cell-tz {
      position: absolute;
      bottom: 1px;
      left: 3px;
      font-size: 8px;
      line-height: 1;
      color: rgb(var(--gold-rgb) / .48);
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .battle-axis .tactical-cell.terrain-plateau[data-terrain-elev="neg"] .tactical-cell-tz {
      color: rgba(120, 182, 240, .52);
    }
    .battle-axis .tactical-cell-tag {
      font-size: 9px;
      line-height: 1.1;
      padding: 0 3px;
      border-radius: 3px;
      pointer-events: none;
      letter-spacing: .02em;
    }
    .battle-axis .tactical-cell.terrain-slope .tactical-cell-tag {
      color: rgba(154, 224, 178, .78);
      background: rgba(52, 112, 74, .28);
    }
    .battle-axis .tactical-cell.terrain-wall .tactical-cell-tag {
      color: rgba(188, 194, 208, .66);
      background: rgba(28, 30, 36, .45);
    }
    .battle-axis .tactical-cell.cliff-top { box-shadow: inset 0 2px 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-bottom { box-shadow: inset 0 -2px 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-left { box-shadow: inset 2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-right { box-shadow: inset -2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-top.cliff-left { box-shadow: inset 0 2px 0 rgba(205, 92, 68, .85), inset 2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-top.cliff-right { box-shadow: inset 0 2px 0 rgba(205, 92, 68, .85), inset -2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-bottom.cliff-left { box-shadow: inset 0 -2px 0 rgba(205, 92, 68, .85), inset 2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell.cliff-bottom.cliff-right { box-shadow: inset 0 -2px 0 rgba(205, 92, 68, .85), inset -2px 0 0 rgba(205, 92, 68, .85); }
    .battle-axis .tactical-cell-coord {
      position: absolute;
      top: 1px;
      left: 3px;
      font-size: 9px;
      line-height: 1.1;
      color: rgb(var(--accent-rgb) / .32);
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .battle-axis .tactical-cell-units {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 3px;
      margin-top: 8px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .battle-axis .tactical-cell-features {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 2px;
      margin-top: 2px;
      min-width: 0;
    }
    .battle-axis .tactical-cell.axis-covered {
      background: linear-gradient(180deg, rgba(160, 128, 210, .14), rgba(160, 128, 210, .28));
      border-color: rgba(190, 162, 236, .65);
      box-shadow: inset 0 0 0 1px rgba(190, 162, 236, .3);
    }
    .battle-axis .tactical-cell.axis-covered[data-range-pattern="1"] {
      background: repeating-linear-gradient(90deg, rgba(150, 112, 206, .22) 0 4px, rgba(118, 86, 170, .09) 4px 9px);
    }
    .battle-axis .tactical-cell.axis-covered[data-range-pattern="2"] {
      background: radial-gradient(circle, rgba(206, 180, 240, .28) 1px, transparent 1.5px) 0 0 / 7px 7px, rgba(118, 86, 170, .16);
    }

    /* \u68CB\u5B50\u5934\u50CF + Z\u8F74\u89D2\u6807\u6570\u5B57 */
    .battle-axis .axis-unit {
      position: relative;
      appearance: none;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      min-width: 0;
      max-width: 100%;
      margin: 0;
      padding: 2px 3px 2px;
      border: 1px solid rgb(var(--neutral-rgb) / .38);
      border-radius: 6px;
      background: linear-gradient(160deg, var(--raised-a), var(--raised-b));
      color: var(--text);
      font: inherit;
      font-size: 10px;
      line-height: 1.15;
      text-align: center;
      cursor: pointer;
      transition: border-color .15s ease, box-shadow .15s ease, transform .12s ease;
    }
    .battle-axis .axis-unit:hover { border-color: var(--gold); transform: translateY(-1px); z-index: 3; }
    .battle-axis .axis-unit[aria-pressed="true"] { border-color: var(--gold-bright); box-shadow: 0 0 0 2px rgb(var(--gold-rgb) / .88), 0 0 12px rgb(var(--gold-rgb) / .32); z-index: 4; }
    .battle-axis .axis-unit[data-faction="blue"] { --axis-side-border: var(--blue-line); --axis-side-text: var(--blue-text); --axis-side-bg: linear-gradient(160deg, #1e3753, #152740); }
    .battle-axis .axis-unit[data-faction="red"] { --axis-side-border: var(--red-line); --axis-side-text: var(--red-text); --axis-side-bg: linear-gradient(160deg, #4d252c, #351a20); }
    .battle-axis .axis-unit[data-faction] { border-color: var(--axis-side-border); background: var(--axis-side-bg); color: var(--axis-side-text); }
    .battle-axis .axis-unit.axis-origin { outline: 1.5px dashed rgba(235, 224, 248, .9); outline-offset: 1px; z-index: 4; }
    .battle-axis .axis-token-head {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      flex: none;
    }
    .battle-axis .axis-unit .unit-avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; }
    .battle-axis .axis-unit .unit-avatar-frame {
      position: relative;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      overflow: hidden;
      border: 1.5px solid var(--axis-side-border, rgb(var(--neutral-rgb) / .65));
      border-radius: 999px;
      background: rgb(var(--shade-rgb) / .65);
      box-shadow: 0 1px 4px rgb(0 0 0 / .45);
    }
    .battle-axis .axis-unit .unit-avatar-frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .battle-axis .axis-unit-fallback-avatar {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 1.5px solid var(--axis-side-border, rgb(var(--neutral-rgb) / .65));
      border-radius: 999px;
      background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.15), rgb(var(--shade-rgb) / .88));
      color: var(--axis-side-text, var(--text));
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      user-select: none;
    }
    .battle-axis .axis-token-head .unit-avatar + .axis-unit-fallback-avatar { display: none; }
    .battle-axis .axis-z-badge {
      position: absolute;
      top: -4px;
      right: -5px;
      min-width: 15px;
      height: 15px;
      padding: 0 3px;
      border: 1px solid rgba(15, 16, 26, .95);
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      line-height: 13px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,.6);
      z-index: 2;
    }
    .battle-axis .axis-z-badge[data-z-sign="pos"] { background: #e8b84e; color: #1a1204; }
    .battle-axis .axis-z-badge[data-z-sign="zero"] { background: #414a5c; color: #e2e8f0; }
    .battle-axis .axis-z-badge[data-z-sign="neg"] { background: #4880b8; color: #eef7ff; }
    .battle-axis .axis-facing-pip {
      position: absolute;
      bottom: -3px;
      left: -3px;
      min-width: 13px;
      height: 13px;
      padding: 0 2px;
      border-radius: 999px;
      background: rgba(14, 15, 25, .9);
      border: 1px solid rgb(var(--accent-rgb) / .45);
      color: var(--axis-gold);
      font-size: 9px;
      line-height: 11px;
      font-weight: 700;
      pointer-events: none;
    }
    .battle-axis .axis-unit-name {
      display: block;
      max-width: 48px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 600;
    }
    .battle-axis .axis-selection-markers { position: absolute; top: -6px; left: -4px; display: flex; gap: 1px; pointer-events: none; }
    .battle-axis .axis-selection-marker { display: inline-block; padding: 0 3px; border-radius: 3px; background: #10131e; font-size: 8px; line-height: 1.3; border: 1px solid currentColor; }
    .battle-axis .axis-selection-marker[hidden] { display: none; }
    .battle-axis .axis-origin-marker { color: #e4dcee; }
    .battle-axis .axis-target-marker { color: var(--gold-bright); }

    /* \u63A9\u4F53\u4E0E\u573A\u666F\u4E92\u52A8\u6807\u8BB0 */
    .battle-axis .tactical-feature {
      appearance: none;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      max-width: 100%;
      padding: 1px 4px;
      border-radius: 4px;
      font: inherit;
      font-size: 9px;
      line-height: 1.15;
      cursor: pointer;
    }
    .battle-axis .axis-unit.tactical-cover {
      --axis-side-border: rgba(204, 158, 92, .75);
      --axis-side-text: #f4dcb4;
      --axis-side-bg: linear-gradient(160deg, rgba(118, 86, 44, .78), rgba(76, 54, 26, .88));
      border-color: var(--axis-side-border);
      background: var(--axis-side-bg);
      color: var(--axis-side-text);
    }
    .battle-axis .axis-unit.tactical-cover.is-broken {
      opacity: .48;
      text-decoration: line-through;
      border-style: dashed;
    }
    .battle-axis .tactical-cover-bar {
      display: block;
      width: 24px;
      height: 3px;
      border-radius: 2px;
      background: rgba(0, 0, 0, .55);
      overflow: hidden;
    }
    .battle-axis .tactical-cover-bar > i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #d97a4a, #79c97b);
    }
    .battle-axis .axis-unit.tactical-interact {
      --axis-side-border: rgba(154, 126, 224, .75);
      --axis-side-text: #e6d8ff;
      --axis-side-bg: linear-gradient(160deg, rgba(82, 58, 138, .78), rgba(52, 36, 92, .88));
      border-color: var(--axis-side-border);
      background: var(--axis-side-bg);
      color: var(--axis-side-text);
    }
    .battle-axis .axis-unit.tactical-interact.is-spent {
      opacity: .42;
      filter: grayscale(.8);
      text-decoration: line-through;
      border-style: dashed;
    }

    .battle-axis .tactical-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      margin-top: 6px;
      padding: 5px 8px;
      border-radius: 5px;
      background: rgb(var(--shade-rgb) / .35);
      color: var(--axis-muted);
      font-size: .78em;
    }
    .battle-axis .tactical-inspector {
      margin-top: 6px;
      padding: 6px 9px;
      border-left: 3px solid var(--axis-gold);
      border-radius: 4px;
      background: rgb(var(--shade-rgb) / .45);
      color: var(--text-soft);
      font-size: .82em;
      overflow-wrap: anywhere;
    }
    .battle-axis .tactical-inspector[hidden] { display: none; }

    .battle-axis .axis-ranges { width: 100%; padding-top: 8px; }
    .battle-axis .axis-region {
      appearance: none;
      display: block;
      width: 100%;
      margin: 0 0 6px;
      padding: 4px 6px;
      border: 1px solid rgba(181, 154, 232, .2);
      border-radius: 5px;
      background: rgba(150, 118, 214, .06);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .battle-axis .axis-region:last-child { margin-bottom: 0; }
    .battle-axis .axis-region[aria-pressed="true"] { border-color: #cdb8f2; background: rgba(150, 118, 214, .18); }
    .battle-axis .axis-region-label { display: block; color: #c9bce0; font-size: .82em; line-height: 1.4; overflow-wrap: anywhere; }
    .battle-axis .axis-region-number { display: inline-block; min-width: 1.6em; padding: 0 4px; border: 1px solid rgba(181, 154, 232, .6); border-radius: 4px; background: rgba(150, 118, 214, .16); color: #e6dbfb; text-align: center; font-size: .95em; font-variant-numeric: tabular-nums; }
    .battle-axis .axis-coverage-note { margin-top: 4px; color: var(--axis-muted); font-size: .77em; line-height: 1.5; }
    .battle-axis .axis-raw { min-width: 0; margin-top: 8px; padding-top: 3px; border-top: 1px solid var(--line); }
    .battle-axis .axis-raw > summary { min-height: 38px; padding: 8px 2px; color: var(--axis-muted); font-size: .85em; cursor: pointer; }
    .battle-axis .axis-raw[open] > summary { color: var(--axis-gold); }
    .battle-axis .axis-raw .data-row { overflow-wrap: anywhere; }
    .battle-axis .axis-unit:focus-visible,
    .battle-axis .tactical-feature:focus-visible,
    .battle-axis .axis-select:focus-visible,
    .battle-axis .axis-region:focus-visible,
    .battle-axis .axis-raw > summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    @media (max-width: 540px) {
      .battle-axis { padding: 8px; }
      .battle-axis .axis-toolbar { grid-template-columns: minmax(0, 1fr); gap: 6px; }
      .battle-axis .tactical-board-wrap { grid-template-columns: 18px minmax(440px, 1fr); }
      .battle-axis .tactical-y-rail,
      .battle-axis .tactical-grid { grid-template-rows: repeat(10, minmax(48px, 1fr)); }
      .battle-axis .tactical-cell { min-height: 48px; }
    }

    /* ---------- \u5DE8\u517D MC \u5FBD\u6807 ---------- */

    /* \u8DDD\u79BB\u5C42\u6B21\uFF1A\u8D34\u8EAB / \u8FD1\u7A0B / \u4E2D\u7A0B / \u8FDC\u7A0B / \u8D85\u8DDD\uFF08\u8D85\u89C6\u8DDD\uFF09\uFF0C\u4E0E\u884C\u52A8\u9009\u62E9\u5668\u7684\u6280\u80FD\u6807\u7B7E\u540C\u8272 */
    .tier { font-weight: 600; color: var(--tier-color); }
    .tier[data-tier="\u8D34\u8EAB"] { --tier-color: #ef8f8a; }
    .tier[data-tier="\u8FD1\u7A0B"] { --tier-color: #e9a866; }
    .tier[data-tier="\u4E2D\u7A0B"] { --tier-color: #d9c66e; }
    .tier[data-tier="\u8FDC\u7A0B"] { --tier-color: #86b8e6; }
    .tier[data-tier="\u8D85\u8DDD"] { --tier-color: #bda3f0; }
    @media (forced-colors: active) { .tier { color: CanvasText; } }

    /* \u7AD9\u4F4D\u4E0E\u8DDD\u79BB\uFF1A\u9635\u8425\u53EA\u7528\u989C\u8272\u533A\u5206\uFF08\u4E0B\u62C9\u9009\u9879\u540C\u6837\u7740\u8272\uFF09\uFF1B\u6709\u72B6\u6001\u680F\u5934\u50CF\u7684\u89D2\u8272\u5728\u5355\u4F4D\u6846\u4E2D\u663E\u793A\u5934\u50CF */
    .battle-axis .axis-select option[data-faction="blue"] { color: var(--blue-text); }
    .battle-axis .axis-select option[data-faction="red"] { color: var(--red-text); }
    .battle-axis .axis-unit .unit-avatar { display: flex; flex: 0 0 100%; align-items: center; justify-content: center; }
    /* \u5934\u50CF\u6846\u4E0E\u72B6\u6001\u680F\u76F8\u540C\uFF1A\u65B9\u5F62\u5706\u6846\u5185\u56FE\u7247\u5BBD\u5EA6\u94FA\u6EE1\uFF0C\u7AD6\u957F\u56FE\u663E\u793A\u4E0A\u90E8\uFF08\u8138\u90E8\uFF09\uFF0C\u6A2A\u5BBD\u56FE\u5C45\u4E2D */
    .battle-axis .axis-unit .unit-avatar-frame { position: relative; display: grid; place-items: center; flex: none; align-self: center; box-sizing: border-box; width: 38px; height: 38px; overflow: hidden; border: 1.5px solid var(--axis-side-border, rgb(var(--neutral-rgb) / .5)); border-radius: 999px; background: rgb(var(--shade-rgb) / .5); box-shadow: 0 1px 4px rgb(0 0 0 / .35); }
    .battle-axis .axis-unit .unit-avatar-frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
    /* \u5355\u4F4D\u4E0B\u65B9\u7684\u72B6\u6001\u6807\u7B7E\uFF1A\u4E0E\u6218\u6597\u9762\u677F\u201C\u72B6\u6001\u201D\u4E00\u680F\u76F8\u540C\u7684\u7D2B\u8272\u8C03 */
    .battle-axis .axis-unit-tags > .axis-unit-note { padding: 1px 6px; border: 1px solid rgba(170, 140, 230, .38); border-radius: 5px; background: rgba(150, 118, 214, .12); color: #e6dbfb; }
.mc-badge{display:inline-block;width:3.5em;height:1.925em;vertical-align:-.48em;margin:0 .12em;line-height:1;white-space:nowrap;flex:none;isolation:isolate}
.mc-badge svg{display:block;width:100%;height:100%;overflow:visible}
.mc-orca-body{fill:#15222e;stroke:#bfd4df;stroke-width:1.15;stroke-linejoin:round}
.mc-orca-white{fill:#f3f6f4;stroke:none}
.mc-orca-eye{fill:#071018;stroke:none}
.mc-orca-saddle{fill:#8ca0aa;stroke:none}
.mc-orca-fin{fill:#15222e;stroke:none}
.mc-orca-fin-edge{fill:none;stroke:#bfd4df;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}
.mc-orca-number{fill:#fff;stroke:none;font:bold 21px Arial,sans-serif;letter-spacing:0}
.mc-badge-wide{width:3.9em}
.mc-badge-wide .mc-orca-number{font-size:19px}
.mc-select{display:inline-flex;position:relative;min-width:0;max-width:100%;vertical-align:middle;box-sizing:border-box}
.mc-native-select{position:absolute!important;width:1px!important;height:1px!important;min-width:0!important;max-width:1px!important;opacity:0!important;clip-path:inset(50%)!important;pointer-events:none!important;overflow:hidden!important}
.mc-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:6px 8px;border:1px solid var(--mc-select-border,rgb(var(--accent-rgb) / .42));border-radius:var(--mc-select-radius,5px);background:var(--mc-select-background,var(--field));color:var(--mc-select-color,var(--text));font:inherit;line-height:1.55;text-align:left;cursor:pointer;box-sizing:border-box}
.mc-select-caption{display:block;min-width:0;overflow-wrap:anywhere}
.mc-select-arrow{flex:none;color:inherit}
.mc-select-trigger:disabled{opacity:.5;cursor:not-allowed}
.mc-select-trigger:focus-visible,.mc-select-option:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
.mc-select-menu{position:fixed;z-index:2147483647;display:block;overflow:auto;overscroll-behavior:contain;padding:4px;border:1px solid rgb(var(--accent-rgb) / .46);border-radius:8px;background:var(--surface);color:var(--text);box-shadow:0 10px 28px rgba(0,0,0,.5),inset 0 1px 0 rgb(var(--sheen-rgb) / .04);box-sizing:border-box;scrollbar-width:thin;font:inherit;line-height:1.55}
.mc-select-menu[hidden]{display:none!important}
.mc-select-option{display:block;width:100%;padding:6px 8px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;font:inherit;line-height:1.55;white-space:normal;overflow-wrap:anywhere;cursor:pointer;box-sizing:border-box}
.mc-select-option[aria-selected=true]{background:rgb(var(--gold-rgb) / .16);color:var(--accent-label)}
.mc-select-option.mc-option-active,.mc-select-option:hover:not(:disabled){background:rgba(255,255,255,.065)}
.mc-select-option:disabled{opacity:.5;cursor:not-allowed}
`;
var tacticalUI = `/* Standalone layout and interactive states; exact r7 visual rules live in battle-theme.css. */
:root { color-scheme: dark; --ease-out: cubic-bezier(.23, 1, .32, 1); }
body { min-height: 100vh; background: radial-gradient(ellipse at 12% 0, rgb(var(--glow-rgb) / .18), transparent 44rem), var(--ink-2); }
#output-container.game-layout { max-width: 1430px; padding: clamp(8px, 2vw, 28px); }
.game-header { display: flex; justify-content: space-between; align-items: end; flex-wrap: wrap; gap: 14px 28px; padding: 19px clamp(13px, 2.5vw, 30px); }
.game-brand { flex: 1 1 22ch; min-width: 0; }
.eyebrow { color: var(--gold-soft); font-size: .78rem; letter-spacing: .2em; }
.game-brand h1 { margin: 2px 0 5px; font-size: clamp(1.48rem, 3.2vw, 2.35rem); color: var(--accent-text); text-shadow: var(--title-shadow); overflow-wrap: anywhere; }
.top-controls, .control-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.top-controls { align-items: end; }
.top-controls label { display: grid; gap: 3px; min-width: 0; }
.top-controls label, .turn-controls label { color: var(--text-soft); font-size: .82rem; }
.game-layout select, .game-layout textarea, .game-layout input:not([type="checkbox"]):not([type="file"]) { min-width: 0; max-width: 100%; color: var(--text); border: 1px solid var(--line-mid); border-radius: 6px; background: var(--field); font: inherit; }
.game-layout select, .game-layout input:not([type="checkbox"]):not([type="file"]) { min-height: 34px; padding: 3px 6px; }
#seed-input { width: 13ch; }
#sandbox-reason { width: 100%; }
.editor-label { display: block; margin-top: 8px; }
#scenario-select { width: min(100%, 11rem); }
.game-columns { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); align-items: start; gap: 12px; }
.game-heading { gap: 8px; padding: 9px 12px; }
.muted { color: var(--text-muted); font-size: .86rem; line-height: 1.5; }
.game-button { min-height: 34px; max-width: 100%; padding: 4px 8px; border: 1px solid var(--line-mid); border-radius: 5px; background: linear-gradient(160deg, var(--raised-a), var(--raised-b)); color: var(--text); font: inherit; font-size: .85rem; overflow-wrap: anywhere; cursor: pointer; }
.game-button.primary, .game-button[aria-pressed="true"] { background: linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color: rgb(var(--btn-line-rgb) / .75); color: var(--btn-text); }
.game-button:disabled { opacity: .5; cursor: not-allowed; }
.game-layout :is(button, select, input, summary, textarea, [tabindex]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) { .game-button:not(:disabled):hover { border-color: var(--gold); } }
.ap-crystal { font-size: 1.08em; color: var(--gold-bright); text-shadow: var(--icon-glow); }
.ap-crystal.is-used { color: var(--gold-dim); text-shadow: none; }
.turn-order { display: flex; flex-wrap: wrap; gap: 5px; padding-block: 2px 10px; }
.turn-chip[data-faction="blue"] { border-color: var(--blue-line); color: var(--blue-text); }
.turn-chip[data-faction="red"] { border-color: var(--red-line); color: var(--red-text); }
.turn-chip[aria-current="true"] { box-shadow: inset 0 -2px var(--gold); }
.turn-chip.is-defeated { opacity: .55; text-decoration: line-through; }
.turn-controls { padding-top: 9px; margin-top: 9px; border-top: 1px solid var(--line); }
#action-error { margin-top: 7px; font-size: .88em; }
#terrain-inspector { min-height: 2.25em; }
#tactical-preview { height: 6.15em; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; }
.preview-line + .preview-line { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
.battle-axis { margin-bottom: 0; }
.battle-axis .tactical-x-rail { padding-inline: 5px; }
.battle-axis .tactical-y-rail { padding-block: 5px; }
.battle-axis .tactical-grid, .battle-axis .tactical-y-rail { grid-auto-rows: minmax(62px, 1fr); grid-template-rows: repeat(var(--rows, 10), minmax(62px, 1fr)); }
.battle-axis .tactical-grid, .battle-axis .tactical-x-rail { grid-template-columns: repeat(var(--cols, 10), minmax(0, 1fr)); }
.battle-axis .tactical-cell { min-height: 62px; color: var(--text); font: inherit; cursor: pointer; align-items: stretch; transition: none; }
.battle-axis .tactical-cell:focus-visible { outline-offset: -2px; z-index: 2; }
.battle-axis .tactical-cell-units { margin-top: 7px; flex-wrap: nowrap; }
.battle-axis .tactical-cell-features { margin: 0; min-height: 9px; }
.battle-axis .tactical-cell .axis-unit { min-width: 0; padding: 1px 3px; pointer-events: none; transform: none; transition: none; }
.battle-axis .axis-token-head { width: 23px; height: 23px; }
.battle-axis .axis-unit-fallback-avatar { width: 23px; height: 23px; }
.battle-axis .axis-unit-name { max-width: min(100%, 9ch); }
.battle-axis .axis-z-badge { min-width: 13px; height: 13px; right: -4px; padding-inline: 2px; font-size: 8px; line-height: 11px; }
.battle-axis .axis-facing-pip { min-width: 11px; height: 11px; font-size: 8px; line-height: 9px; }
.token-meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; width: 100%; }
.token-meter, .token-meter > i { display: block; height: 2px; border-radius: 2px; }
.token-meter { background: rgba(0, 0, 0, .55); }
.token-meter > i { width: calc(100% * var(--resource-ratio)); background: var(--meter-color); }
.token-meter.hp { --meter-color: #e78886; }
.token-meter.mp { --meter-color: #86b8e6; }
.token-meter.sp { --meter-color: #80cc9a; }
.token-statuses { position: absolute; top: 1px; left: -2px; color: #e6dbfb; background: #4a3061; border: 1px solid #8168ac; border-radius: 4px; padding-inline: 1px; line-height: 1.2; font-size: 8px; }
.battle-axis .tactical-cell.is-reachable { border-color: rgba(125, 214, 157, .72); background-image: linear-gradient(150deg, rgba(109, 186, 137, .24), rgba(46, 104, 76, .3)); }
.battle-axis .tactical-cell.is-elevated-reach { border-style: dashed; background-image: repeating-linear-gradient(135deg, rgba(92, 184, 147, .28) 0 4px, rgba(57, 118, 90, .16) 4px 8px); }
.battle-axis .tactical-cell.is-in-range:not(.axis-covered) { border-color: rgba(110, 160, 214, .75); background-color: rgba(69, 137, 208, .22); }
.battle-axis .tactical-cell.is-path { border-color: #aeedd3; }
.battle-axis .tactical-cell.is-hovered, .battle-axis .tactical-cell.is-selected { outline: 1px solid var(--gold); outline-offset: -2px; }
.battle-axis .tactical-cell:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.battle-axis .tactical-cell.is-invalid { outline-color: #ed9b8f; }
.cell-cost { position: absolute; bottom: 1px; right: 2px; color: #b9efcc; font-size: 8px; line-height: 1; pointer-events: none; }
.battle-axis .axis-scroll-hint { display: none; }
#unit-card, #combat-log, #feature-cards { overflow-wrap: anywhere; }
#combat-log { max-height: 330px; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; }
.log-entry { display: block; }
.log-entry summary, .feature-register > summary, #api-sandbox > summary { cursor: pointer; color: var(--accent-label); }
.log-entry summary { font-weight: 600; }
.log-detail { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-soft); font: inherit; font-size: .88em; padding-top: 5px; }
.feature-register { border-top: 1px solid var(--line); }
.feature-register > summary { padding: 8px 12px; font-size: .88rem; }
.card-subtitle { flex: 1 0 100%; color: var(--accent-label); font-size: .86em; }
.card-item { width: 100%; }
#sandbox-editor { display: block; width: 100%; margin: 4px 0 8px; padding: 8px; resize: vertical; font: .87rem/1.45 monospace; }
.sandbox-examples { margin-block: 8px; }
#sandbox-output { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-soft); margin-top: 8px; }
/* Feedback is the only motion added: fixed nodes animate transform/opacity, no layout shifts. */
.cell-feedback { position: absolute; inset: 1px; z-index: 5; pointer-events: none; border: 1px solid currentColor; border-radius: 5px; color: #f9df8f; box-shadow: inset 0 0 8px currentColor; }
.cell-feedback > b { position: absolute; inset: 5px 0 auto; font: 700 12px/1.1 var(--font-display); text-align: center; text-shadow: 0 1px 3px #000, 0 0 5px #000; }
.cell-feedback.damage { color: #ffaaa3; }
.cell-feedback.heal { color: #adf1c5; }
@media (max-width: 980px) { .game-columns { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 650px) { .battle-axis .axis-scroll-hint { display: block; } }
@media (max-width: 540px) {
  .battle-axis .tactical-grid, .battle-axis .tactical-y-rail { grid-template-rows: repeat(var(--rows, 10), minmax(55px, 1fr)); grid-auto-rows: minmax(55px, 1fr); }
  .battle-axis .tactical-cell { min-height: 55px; }
  .battle-axis .axis-unit-name { max-width: 4ch; }
}
#report-dialog { box-sizing: border-box; color: var(--text); width: min(680px, calc(100% - 24px)); max-height: calc(100% - 24px); padding: 16px; }
#report-dialog::backdrop { background: rgb(8 7 14 / .72); }
#report-text { display: block; box-sizing: border-box; width: 100%; max-height: 55vh; margin-block: 8px 12px; padding: 10px; resize: vertical; color: var(--text); background: var(--field); border: 1px solid var(--line); font: .92rem/1.55 var(--font-body); }
#report-message { margin: 0; }
#report-message:not(:empty) { margin-top: 8px; }
.battle-axis .tactical-cell.is-opportunity { outline: 2px solid #e5a35e; outline-offset: -3px; }
#board-instructions { margin: 8px 0; }
#sprint-indicator { color: var(--gold-bright); }
#target-actions { position: fixed; z-index: 20; inset: 8px auto auto 8px; width: 268px; box-sizing: border-box; margin: 0; padding: 8px; overflow: auto; overscroll-behavior: contain; background: var(--ink-1); box-shadow: 0 8px 24px #0009; }
#target-actions[hidden] { display: none; }
.target-head { justify-content: space-between; flex-wrap: nowrap; margin-bottom: 4px; }
#target-title { min-width: 0; overflow-wrap: anywhere; }
#close-target { flex: 0 0 auto; }
#action-toolbar, #confirm-action { margin-block: 4px; }
#target-preview > summary { color: var(--text-muted); cursor: pointer; font-size: .84em; }
#target-actions #tactical-preview { height: auto; max-height: 7em; margin-bottom: 0; }
#resource-dialog { box-sizing: border-box; width: min(640px, calc(100% - 24px)); padding: 16px; color: var(--text); }
#resource-dialog::backdrop { background: rgb(8 7 14 / .72); }
#resource-input { box-sizing: border-box; width: 100%; padding: 8px; }
#resource-output { white-space: pre-wrap; overflow-wrap: anywhere; }
.battle-axis .tactical-cell.is-in-range.is-reachable { border-color: #86cdab; }
.battle-axis .tactical-cell.is-in-range.is-reachable::after { content: ''; pointer-events: none; position: absolute; inset: auto 4px 3px auto; width: 7px; height: 7px; border-radius: 50%; background: #7dbbfe; }
@media (max-width: 700px) {
  #target-actions { width: 242px; }
  #target-actions button { min-height: 44px; }
  #board button { touch-action: manipulation; }
}`;

// src/ui/mount.js
var STYLE_ID = "data-fated-tactical-style";
var themes = ["amethyst", "night-gold", "frost-silver"];
function resolveContainer(container) {
  if (typeof container === "string") return document.querySelector(container);
  return container;
}
function storageAdapter(storage, prefix) {
  const fallback = typeof localStorage !== "undefined" ? localStorage : null;
  const source = storage || fallback;
  return {
    getItem(key3) {
      try {
        return source?.getItem(`${prefix}/${key3}`) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key3, value) {
      try {
        source?.setItem(`${prefix}/${key3}`, value);
      } catch {
      }
    },
    removeItem(key3) {
      try {
        source?.removeItem(`${prefix}/${key3}`);
      } catch {
      }
    }
  };
}
function injectStyle(doc) {
  if (doc.querySelector(`style[${STYLE_ID}]`)) return;
  const style2 = doc.createElement("style");
  style2.setAttribute(STYLE_ID, "");
  const css2 = `${battleTheme}
${tacticalUI}`.replace(/(^|\})\s*:root(?:\[data-dlc-theme="([^"]+)"\])?/g, (_, lead, theme) => `${lead}.fated-tactical-root${theme ? `[data-dlc-theme="${theme}"]` : ""}`).replace(/(^|\})\s*(body|html)\b/g, "$1.fated-tactical-root").replace(/(^|\})\s*#output-container/g, "$1.fated-tactical-root #output-container");
  style2.textContent = css2;
  (doc.head || doc.documentElement).append(style2);
}
function mount(container, options = {}) {
  const target2 = resolveContainer(container);
  if (!target2 || !target2.appendChild) throw new TypeError("mount(container): container must be an HTMLElement or selector");
  const existing = target2.querySelector(':scope > .fated-tactical-root[data-fated-mounted="true"]');
  if (existing?.__fatedUnmount) existing.__fatedUnmount();
  const doc = target2.ownerDocument || document;
  injectStyle(doc);
  const root = doc.createElement("div");
  root.className = "fated-tactical-root";
  root.dataset.fatedMounted = "true";
  root.dataset.dlcTheme = themes.includes(options.theme) ? options.theme : "amethyst";
  root.innerHTML = TEMPLATE;
  target2.append(root);
  const controller = new AbortController();
  const prefix = `fated-tactical/${options.instanceId || "default"}`;
  const storage = storageAdapter(options.storage, prefix);
  const api = options.api || createGameAPI();
  const ui = initializeUI(root, { ...options, initialState: options.state ?? options.initialState, game: api, storage, signal: controller.signal });
  let active = true;
  const result = {
    api,
    unmount() {
      if (!active) return;
      active = false;
      controller.abort();
      ui.destroy?.();
      root.remove();
    },
    destroy() {
      result.unmount();
    },
    loadState(state) {
      return ui.loadState(state);
    },
    getState: ui.getState,
    exportBattleReportText: ui.exportBattleReportText,
    exportMvuPatch: ui.exportMvuPatch,
    root
  };
  root.__fatedUnmount = result.unmount;
  return result;
}
function mountStyles(document2 = globalThis.document) {
  if (document2) injectStyle(document2);
}

// src/tavern/descriptor.js
var identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var unsafeKey = (key3) => Object.hasOwn(Object.prototype, key3) || key3 === "prototype";
function parseBattleDescriptor(value) {
  if (typeof value !== "string") return null;
  const lines = value.trim().replace(/^```[^\r\n]*\r?\n/, "").replace(/\r?\n```$/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!/^\s*(battle|unit)\s*\|/i.test(lines[0] ?? "")) return null;
  const fail4 = (message) => {
    throw new Error(`battle_init \u63CF\u8FF0\u7B26\uFF1A${message}`);
  };
  const [kind, version2, battleId, sceneTitle, terrainMode, seedText, ...extra] = lines[0].split("|").map((x) => x.trim());
  if (kind !== "battle" || version2 !== "1" || extra.length || !identifier.test(battleId ?? "") || unsafeKey(battleId) || !sceneTitle || sceneTitle.length > 100 || !["flat", "terrain"].includes(terrainMode)) {
    fail4("\u9996\u884C\u5E94\u4E3A battle|1|ID|\u573A\u666F\u6807\u9898|flat \u6216 terrain\uFF0C\u53EF\u8FFD\u52A0 |seed");
  }
  if (seedText !== void 0 && (!/^\d+$/.test(seedText) || Number(seedText) > 4294967295)) fail4("seed \u5FC5\u987B\u662F 0\u20134294967295 \u7684\u6574\u6570");
  const ids = /* @__PURE__ */ new Set();
  const occupied = /* @__PURE__ */ new Set();
  const units = lines.slice(1).map((line, i) => {
    const [row, id3, team2, source, name, point, ...tail] = line.split("|").map((x2) => x2.trim());
    if (row !== "unit" || tail.length || !identifier.test(id3 ?? "") || unsafeKey(id3) || ids.has(id3.toLowerCase()) || !["blue", "red"].includes(team2) || !name || name.length > 100 || !/^\d\s*,\s*\d$/.test(point ?? "")) {
      fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u9700\u8981\u552F\u4E00 ID\u3001\u9635\u8425\u3001\u6765\u6E90\u3001\u663E\u793A\u540D\u53CA 0\u20139 \u8303\u56F4\u5185\u7684 x,y`);
    }
    const path = source?.startsWith("mvu:") ? source.slice(4).split("/") : [];
    if (source !== "char_info" && (!path.length || path.some((key3) => !key3 || key3 !== key3.trim() || unsafeKey(key3)))) {
      fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u6765\u6E90\u5E94\u4E3A char_info \u6216 mvu:\u7CBE\u786E/\u8DEF\u5F84`);
    }
    const [x, y] = point.split(",").map(Number);
    if (occupied.has(`${x},${y}`)) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u8D77\u70B9\u91CD\u590D`);
    occupied.add(`${x},${y}`);
    ids.add(id3.toLowerCase());
    return { id: id3, team: team2, source, name, x, y };
  });
  if (!units.length) fail4("\u81F3\u5C11\u9700\u8981\u4E00\u6761 unit \u8BB0\u5F55");
  return { version: 1, battleId, sceneTitle, terrainMode, ...seedText === void 0 ? {} : { seed: Number(seedText) }, units };
}

// src/tavern/terrain.js
var inBounds = (n) => Number.isInteger(n) && n >= 0 && n <= 9;
var height = (n) => Math.max(-4, Math.min(8, Math.round(Number(n) || 0)));
var list2 = (value) => Array.isArray(value) ? value : [];
function createBattleGrid(battle, seed, units, warnings) {
  const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: "floor", z: 0 })));
  if (battle.terrainMode === "flat") return grid;
  const legacyTerrain = battle.terrain ?? battle.grid;
  if (battle.terrainMode === "terrain" || battle.terrainMode == null && legacyTerrain == null) {
    const layout = seed % 8;
    const transform = (x, y) => [layout & 1 ? 9 - x : x, layout & 2 ? 9 - y : y];
    const occupied = new Set(units.map((u) => `${u.x},${u.y}`));
    const paint = (x, y, kind, z) => {
      const [a, b] = transform(x, y);
      const [px, py] = layout & 4 ? [b, a] : [a, b];
      if (kind !== "wall" || !occupied.has(`${px},${py}`)) grid[py][px] = { kind, z };
    };
    for (let y = 3; y <= 5; y++) {
      for (let x = 2; x <= 4; x++) paint(x, y, "floor", 2);
      paint(1, y, "slope", 1);
      paint(5, y, "slope", 1);
    }
    paint(6, 2, "wall", 0);
    paint(7, 6, "wall", 0);
    return grid;
  }
  const terrain = legacyTerrain;
  const place = (raw, kind, label) => {
    const [x, y, z] = Array.isArray(raw) ? raw : Array.isArray(raw?.xyz) ? raw.xyz : [raw?.x, raw?.y, raw?.z];
    if (!inBounds(x) || !inBounds(y)) {
      warnings.push(`\u5FFD\u7565\u65E0\u6548\u5730\u5F62\u5750\u6807\uFF1A${label}`);
      return;
    }
    grid[y][x] = { kind, z: z == null ? grid[y][x].z : height(z) };
  };
  if (Array.isArray(terrain)) {
    if (terrain.length === 10 && terrain.every((row) => Array.isArray(row) && row.length === 10)) {
      terrain.forEach((row, y) => row.forEach((cell, x) => place([x, y, cell?.z], cellKind(cell), "grid")));
    } else terrain.forEach((cell) => place(cell, cellKind(cell), "terrain"));
  } else {
    for (const region of list2(terrain?.elevation)) {
      const { x1, y1, x2, y2, z } = region ?? {};
      if (![x1, y1, x2, y2].every(inBounds) || x1 > x2 || y1 > y2) {
        warnings.push("\u5FFD\u7565\u65E0\u6548\u5730\u5F62\u5750\u6807\uFF1Agrid.elevation");
        continue;
      }
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x].z = height(z);
    }
    for (const slope of list2(terrain?.slopes)) place(slope, "slope", "grid.slopes");
    for (const wall of list2(terrain?.walls)) place(wall, "wall", "grid.walls");
  }
  return grid;
}
function cellKind(cell) {
  const kind = String(cell?.kind ?? cell?.type ?? "").toLowerCase();
  return ["wall", "slope"].includes(kind) ? kind : kind === "highground" ? "slope" : "floor";
}

// src/tavern/converter.js
var own5 = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
var object3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
var asObject = (v) => object3(v) ? v : {};
var finite2 = (v) => typeof v === "number" && Number.isFinite(v);
var number2 = (v, fallback = 0) => {
  if (finite2(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
var integer3 = (v, fallback = 0) => Math.round(number2(v, fallback));
var text2 = (v) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
var clone = (v) => structuredClone(v);
function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function deterministicId(value, prefix = "unit") {
  const raw = text2(value) || prefix;
  const ascii = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  let id3 = ascii || `${prefix}-${hash(raw).toString(36)}`;
  if (!/^[A-Za-z]/.test(id3)) id3 = `${prefix}-${id3}`;
  if (id3.length > 52) id3 = id3.slice(0, 52);
  if (["constructor", "prototype", "__proto__"].includes(id3)) id3 = `${prefix}-${hash(raw).toString(36)}`;
  return id3 || `${prefix}-${hash(raw).toString(36)}`;
}
var blockHeaders = /* @__PURE__ */ new Set(["|", ">", "|-", "|+", ">-", ">+", "|2", ">2"]);
function emptyEntry(value) {
  if (value == null || object3(value) && !Object.keys(value).length) return true;
  if (typeof value !== "string") return false;
  const s = value.trim();
  return !s || blockHeaders.has(s) || /^\{\s*\}$/.test(s);
}
function scalar(value) {
  const v = text2(value);
  if (!v) return "";
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/\\n/g, "\n");
  if (v === "true" || v === "false") return v === "true";
  if (v === "null" || v === "~") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v)) return Number(v);
  const equation = v.match(/=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i);
  if (equation) return Number(equation[1]);
  if (v.startsWith("{") && v.endsWith("}") || v.startsWith("[") && v.endsWith("]")) {
    try {
      return JSON.parse(v);
    } catch {
    }
  }
  return v;
}
function parseSimpleYaml(input) {
  if (object3(input) || Array.isArray(input)) return clone(input);
  const source = text2(input).replace(/^```(?:yaml|yml)?\s*/i, "").replace(/\s*```$/i, "");
  const lines = source.split(/\r?\n/).map((raw, index) => ({
    index,
    indent: raw.match(/^\s*/)[0].length,
    value: raw.trim(),
    raw
  })).filter((x) => x.value && !x.value.startsWith("#") && !x.value.startsWith("---") && !x.value.startsWith("..."));
  if (!lines.length) return {};
  const root = lines[0].value.startsWith("- ") ? [] : {};
  const stack = [{ indent: -1, value: root }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    while (stack.length > 1 && line.indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (line.value.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      const rest = line.value.slice(2).trim();
      if (!rest) {
        const child2 = {};
        parent.push(child2);
        stack.push({ indent: line.indent, value: child2 });
        continue;
      }
      const colon2 = rest.indexOf(":");
      if (colon2 > 0 && !rest.startsWith("{")) {
        const child2 = {};
        parent.push(child2);
        child2[rest.slice(0, colon2).trim()] = scalar(rest.slice(colon2 + 1));
        stack.push({ indent: line.indent, value: child2 });
      } else parent.push(scalar(rest));
      continue;
    }
    const colon = line.value.indexOf(":");
    if (colon < 1 || !object3(parent)) continue;
    const key3 = line.value.slice(0, colon).trim();
    const tail = line.value.slice(colon + 1).trim();
    if (blockHeaders.has(tail)) {
      const chunks = [];
      for (let j = i + 1; j < lines.length && lines[j].indent > line.indent; j++) {
        chunks.push(lines[j].value);
        i = j;
      }
      parent[key3] = chunks.join(tail.startsWith(">") ? " " : "\n");
      continue;
    }
    if (tail) {
      parent[key3] = scalar(tail);
      continue;
    }
    const next = lines[i + 1];
    const child = next && next.indent > line.indent && next.value.startsWith("- ") ? [] : {};
    parent[key3] = child;
    stack.push({ indent: line.indent, value: child });
  }
  return root;
}
function unwrap(value, tag) {
  if (typeof value !== "string") return value;
  const re = tag === "battle" ? /<(?:battle_init|battle-in|battle_in)>\s*([\s\S]*?)\s*<\/\s*(?:battle_init|battle-in|battle_in)>/i : /<char_info>\s*([\s\S]*?)\s*<\/char_info>/ig;
  if (tag === "battle") {
    const match = value.match(re);
    if (match) return parseBattleBody(match[1]);
    const legacy = value.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*([\s\S]*?)\s*\{\s*\/\s*(?:battle_in|战术沙盘)\s*\}/i);
    if (legacy) return parseBattleBody(legacy[1]);
    const brace = value.match(/^\s*\{\s*(?:battle_in|战术沙盘)\s*:\s*([\s\S]+)\}\s*$/i);
    return parseBattleBody(brace ? brace[1] : value);
  }
  return [...value.matchAll(re)].map((m) => parseSimpleYaml(m[1]));
}
function parseStructured(value) {
  if (object3(value)) return value;
  if (typeof value !== "string") return {};
  const source = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(source);
    return object3(parsed) ? parsed : {};
  } catch {
    let depth = 0, quoted = false, escaped = false;
    for (let start = 0; start < source.length; start++) {
      if (source[start] !== "{") continue;
      depth = 0;
      quoted = false;
      escaped = false;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') quoted = false;
          continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, i + 1));
            if (object3(parsed)) return parsed;
          } catch (_) {
          }
          break;
        }
      }
    }
    return parseSimpleYaml(source);
  }
}
function parseBattleBody(value) {
  const battle = parseBattleDescriptor(value) ?? parseStructured(value);
  return battle.battle_init ?? battle.battle_in ?? battle.\u6218\u672F\u6C99\u76D8 ?? battle;
}
function parseBattleInit(value) {
  return asObject(typeof value === "string" ? unwrap(value, "battle") : parseBattleBody(value));
}
function parseCharInfo(value) {
  if (Array.isArray(value)) return value.flatMap(parseCharInfo);
  if (object3(value)) return [clone(value)];
  if (typeof value !== "string") return [];
  const tagged = unwrap(value, "char");
  return tagged.length ? tagged : [parseSimpleYaml(value)].filter((x) => Object.keys(x).length);
}
var attrNames = ["str", "agi", "con", "int", "spi"];
var statAliases = { strength: "str", dexterity: "agi", agility: "agi", constitution: "con", intelligence: "int", spirit: "spi", wisdom: "spi", \u529B\u91CF: "str", \u654F\u6377: "agi", \u4F53\u8D28: "con", \u667A\u529B: "int", \u7CBE\u795E: "spi" };
function findValue(record2, names, fallback) {
  const r = asObject(record2);
  for (const name of names) if (own5(r, name)) return r[name];
  return fallback;
}
function statsOf(record2) {
  const r = asObject(record2), nested = asObject(r.stats && Object.keys(r.stats).length ? r.stats : r.attributes && Object.keys(r.attributes).length ? r.attributes : r.\u5C5E\u6027);
  const result = {};
  for (const key3 of attrNames) {
    const aliases = [key3, ...Object.entries(statAliases).filter(([, v]) => v === key3).map(([k]) => k)];
    result[key3] = Math.max(-20, Math.min(50, integer3(
      aliases.find((alias) => own5(nested, alias)) !== void 0 ? nested[aliases.find((alias) => own5(nested, alias))] : findValue(r, aliases, 0),
      0
    )));
  }
  return result;
}
function resource2(record2, key3, fallback) {
  const r = asObject(record2), nested = asObject(r.resources ?? r.resource ?? r.\u8D44\u6E90);
  const aliases = { hp: ["HP", "\u751F\u547D\u503C"], mp: ["MP", "\u6CD5\u529B\u503C"], sp: ["SP", "\u4F53\u529B\u503C"] }[key3] ?? [];
  const value = own5(r, key3) ? r[key3] : own5(r, key3.toUpperCase()) ? r[key3.toUpperCase()] : own5(r, aliases[1]) ? r[aliases[1]] : own5(nested, key3) ? nested[key3] : own5(nested, aliases[0]) ? nested[aliases[0]] : own5(nested, aliases[1]) ? nested[aliases[1]] : void 0;
  if (object3(value)) {
    const current2 = integer3(value.current ?? value.\u5F53\u524D ?? value.now ?? value.value, fallback);
    const upper = value.max ?? value.maximum ?? value.\u4E0A\u9650;
    const max2 = object3(upper) ? integer3((upper._\u57FA\u7840 ?? 0) + (upper.\u989D\u5916 ?? 0), fallback) : integer3(upper, fallback);
    return { current: current2, max: max2 };
  }
  const current = integer3(value, fallback);
  const maxValue = findValue(r, [`max${key3[0].toUpperCase()}${key3.slice(1)}`, `${key3}Max`, `${aliases[1]}\u4E0A\u9650`], current);
  const max = integer3(maxValue, current);
  return { current, max };
}
function safeResource(pair, key3, warnings) {
  let max = Math.max(key3 === "hp" ? 1 : 0, pair.max), current = Math.max(0, Math.min(max, pair.current));
  if (max > 1e9 || pair.current > 1e9) {
    warnings.push(`${key3} \u8D85\u51FA\u5F15\u64CE\u4E0A\u9650\uFF0C\u5DF2\u622A\u5230 1e9`);
    max = Math.min(max, 1e9);
    current = Math.min(current, max);
  }
  return { current, max };
}
function sourceName(record2, key3 = "") {
  return text2(findValue(record2, ["name", "displayName", "characterName", "\u89D2\u8272\u540D", "\u59D3\u540D", "\u540D\u79F0"], key3));
}
function tierNumber(value, fallback = 1) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = text2(value).match(/[一二三四五六七]层级?/);
  return match ? "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03".indexOf(match[0][0]) + 1 : fallback;
}
function sourceId(record2, key3 = "") {
  return text2(findValue(record2, ["id", "uid", "characterId", "instanceId", "ID"], key3));
}
var protagonistAliases = ["\u4E3B\u89D2", "\u73A9\u5BB6", "\u4E3B\u63A7", "protagonist", "player", "mvu_protagonist"];
var charSources = ["char_info", "narrative_char_info"];
var samePath = (a, b) => a.length === b.length && a.every((part, i) => String(part) === b[i]);
function resolveParticipant(participant, mvuRecords, chars, protagonist) {
  const source = text2(participant.source), name = text2(participant.name);
  if (source.startsWith("mvu:")) {
    const path = source.slice(4).split("/");
    return mvuRecords.find((record2) => samePath(record2.__sourcePath, path));
  }
  if (protagonistAliases.includes(source.toLowerCase())) return protagonist;
  const char = chars.find((record2) => sourceName(record2) === name);
  if (charSources.includes(source.toLowerCase())) return char;
  const matches2 = (record2, key3) => [sourceId(record2), sourceName(record2), record2.__sourceKey].includes(key3);
  if (source) return [...mvuRecords, ...chars].find((record2) => matches2(record2, source));
  const exact = [text2(participant.id ?? participant.uid), name].filter(Boolean);
  for (const key3 of exact) {
    const record2 = mvuRecords.find((record3) => matches2(record3, key3));
    if (record2) return record2;
  }
  return char;
}
function collectMvu(value) {
  const root = asObject(value?.stat_data ?? value?.statData ?? value);
  const found = [];
  const visit = (node3, key3 = "", path = []) => {
    if (Array.isArray(node3)) return node3.forEach((v, i) => visit(v, String(i), [...path, i]));
    if (!object3(node3)) return;
    const name = sourceName(node3, key3), hasStats = node3.stats || node3.attributes || node3.\u5C5E\u6027 || ["\u529B\u91CF", "\u654F\u6377", "\u4F53\u8D28", "\u667A\u529B", "\u7CBE\u795E"].some((k) => own5(node3, k));
    const hasResource = ["hp", "maxHp", "mp", "sp", "tier", "level", "equipment", "skills", "\u751F\u547D\u503C", "\u6CD5\u529B\u503C", "\u4F53\u529B\u503C", "\u88C5\u5907", "\u6280\u80FD", "\u8D44\u6E90"].some((k) => own5(node3, k));
    if (name && (hasStats || hasResource)) found.push({ ...clone(node3), __sourceKey: key3, __sourcePath: path, __sourceKind: "MVU" });
    for (const [k, v] of Object.entries(node3)) if (!["stats", "attributes", "\u5C5E\u6027", "resources", "\u8D44\u6E90", "equipment", "\u88C5\u5907", "skills", "\u6280\u80FD", "statuses", "\u72B6\u6001\u6548\u679C"].includes(k)) visit(v, k, [...path, k]);
  };
  visit(root);
  return found;
}
var effectAliases = {
  killcharge: "kill_charge_weapon",
  kill_charge: "kill_charge_weapon",
  ammo_charge: "ammo",
  bleed: "backstab",
  knock_back: "knockback",
  teleport_backstab: "teleport_backstab",
  cleanse_status: "cleanse",
  root: "opportunity_root"
};
var statusAliases = { burning: "burn", fire: "burn", bleeding: "bleed", frozen: "freeze", immobilize: "root", \u71C3\u70E7: "burn", \u51BB\u7ED3: "freeze", \u6655\u7729: "stun", \u52A0\u901F: "haste" };
var statusNames = new Map(Object.values(STATUSES).map((status2) => [status2.name, status2.id]));
function statusId(value) {
  const key3 = text2(value).toLowerCase();
  return own5(STATUSES, key3) ? key3 : statusNames.get(key3) ?? (own5(statusAliases, key3) ? statusAliases[key3] : null);
}
var bound = (value, min, max, fallback = min) => Math.max(min, Math.min(max, integer3(value, fallback)));
function statusTurns(value, fallback) {
  const turns2 = typeof value === "string" ? value.match(/^\s*(\d+)\s*(?:回合|轮)\s*$/)?.[1] ?? value : value;
  return bound(turns2, 1, 100, fallback);
}
function mapEffects(effects2, context = "skill", warnings = [], prefix = "imported") {
  let input = Array.isArray(effects2) ? effects2 : effects2 == null ? [] : [effects2];
  if (object3(effects2) && !["trigger", "kind", "type", "effect", "name", "\u7C7B\u578B"].some((key3) => own5(effects2, key3))) {
    input = Object.entries(effects2).flatMap(([kind, value]) => {
      if (!object3(value) && emptyEntry(value)) return [];
      if (object3(value)) return [{ kind, ...value }];
      warnings.push(`\u4E0D\u652F\u6301\u7684\u63CF\u8FF0\u6027\u6548\u679C\u5DF2\u5FFD\u7565\uFF1A${kind}${text2(value) ? `\uFF1A${text2(value)}` : ""}`);
      return [];
    });
  }
  const result = [], seen = /* @__PURE__ */ new Set();
  for (const [index, raw] of input.entries()) {
    if (emptyEntry(raw)) continue;
    let entry = raw;
    if (typeof raw === "string") {
      const body = raw.trim().replace(/^[|>](?:[-+2])?[^\S\r\n]*\r?\n/, "").trim();
      const labelled = body.match(/^[^\n:{}]+[:：]\s*([^\n]+)$/);
      const payload = labelled ? labelled[1].trim() : body;
      entry = payload;
      if (payload.startsWith("{")) {
        try {
          entry = JSON.parse(payload);
        } catch {
        }
      }
      if (emptyEntry(entry)) continue;
    }
    const source = typeof entry === "string" ? { kind: entry } : asObject(entry);
    let expressions;
    if (isExpression(source)) {
      expressions = validExpression(source) ? [clone(source)] : [];
    } else {
      const name = text2(source.kind ?? source.type ?? source.effect ?? source.name ?? source.\u7C7B\u578B).toLowerCase().replace(/[ -]/g, "_");
      const kind = own5(effectAliases, name) ? effectAliases[name] : name;
      const legacy = { ...source, kind };
      const id3 = statusId(source.statusId ?? source.status ?? source.value ?? source.\u72B6\u6001 ?? name);
      if (kind === "status" && !id3 && !source.statusId) {
        warnings.push(`\u6548\u679C\u5F15\u7528\u672A\u77E5\u72B6\u6001\uFF0C\u5DF2\u5FFD\u7565\uFF1A${source.status ?? source.value ?? source.\u72B6\u6001 ?? name}`);
        continue;
      }
      if (id3) {
        legacy.statusId = id3;
        if (kind === "status" || name === id3 && context === "skill" && kind !== "infinite_ammo") legacy.kind = "status";
        const turns2 = source.turns ?? source.\u5269\u4F59\u56DE\u5408 ?? source.\u6301\u7EED\u56DE\u5408;
        const stacks = source.stacks ?? source.\u5C42\u6570;
        if (turns2 != null) legacy.turns = statusTurns(turns2, STATUSES[id3].remainingTurns);
        if (stacks != null) legacy.stacks = bound(stacks, 1, STATUSES[id3].maxStacks);
      }
      expressions = adaptLegacyEffects([legacy], context, `${prefix.slice(0, 36)}-${index}`);
      try {
        for (const expr of expressions) validateEffect(expr);
      } catch (error2) {
        warnings.push(`\u6548\u679C ${typeof raw === "string" ? raw.trim() : name || "unknown"} \u5DF2\u62D2\u7EDD\uFF1A${error2.message}`);
        continue;
      }
    }
    if (!expressions.length || result.length + expressions.length > 24 || expressions.some((expr) => seen.has(expr.id))) {
      warnings.push(`\u65E0\u6548\u3001\u91CD\u590D\u6216\u8D85\u91CF\u6548\u679C\u5DF2\u5FFD\u7565\uFF1A${source.id ?? source.kind ?? "unknown"}`);
      continue;
    }
    result.push(...expressions);
    for (const expr of expressions) seen.add(expr.id);
  }
  return result;
}
var damageAliases = new Map(Object.entries({ \u7269\u7406: "physical", \u80FD\u91CF: "energy", \u7CBE\u795E: "mental", \u771F\u5B9E: "true" }));
var damageTypes2 = ["physical", "energy", "mental", "true"];
function normalizeDice(raw) {
  const dice3 = asObject(raw);
  const stat2 = own5(statAliases, dice3.stat) ? statAliases[dice3.stat] : dice3.stat;
  const type = damageAliases.get(dice3.type) ?? dice3.type;
  const count = bound(dice3.count, 0, 1e6, 1);
  return {
    count,
    sides: bound(dice3.sides, count ? 1 : 0, 1e6, 4),
    bonus: bound(dice3.bonus, -1e9, 1e9, 0),
    ...attrNames.includes(stat2) ? { stat: stat2 } : {},
    ...finite2(dice3.multiplier) ? { multiplier: Math.max(0, Math.min(8, dice3.multiplier)) } : {},
    type: damageTypes2.includes(type) ? type : "physical"
  };
}
function normalizeEquipment(raw, slot, owner, index, warnings) {
  const r = asObject(raw), name = text2(r.name ?? r.\u540D\u79F0 ?? r.itemName) || `${slot || "\u88C5\u5907"}${index + 1}`;
  const isShield = slot === "shield" || r.kind === "shield" || r.shield === true || r.weaponClass === "shield" || /盾/.test(name);
  const labels = Array.isArray(r.tags ?? r.\u6807\u7B7E) ? (r.tags ?? r.\u6807\u7B7E).join(" ") : text2(r.tags ?? r.\u6807\u7B7E);
  const kindAliases = /* @__PURE__ */ new Map([["\u6B66\u5668", "weapon"], ["\u9632\u5177", "armor"], ["\u9970\u54C1", "accessory"], ["\u6D88\u8017\u54C1", "consumable"]]);
  const declaredKind = ["weapon", "armor", "accessory", "consumable"].includes(r.kind) ? r.kind : kindAliases.get(r.\u7C7B\u578B);
  const kind = isShield ? "shield" : declaredKind || (["mainHand", "offHand", "twoHands"].includes(slot) || r.damage || r.attack != null || r.weaponClass || /攻击|双手|巨剑|长戟|弓|弩|法杖|发射器/.test(`${name} ${labels}`) ? "weapon" : "accessory");
  const isWeapon = kind === "weapon";
  const idBase = `item-${owner.length}-${owner.slice(0, 31)}-${hash(owner).toString(36)}-${index}`;
  const templateId = `template-${idBase}`;
  const effects2 = mapEffects(r.effects ?? r.effectsList ?? r.\u6548\u679C, "equipment", warnings, `fx-${hash(templateId).toString(36)}`);
  const template = { name: name.slice(0, 100), kind, effects: effects2 };
  const defenseTag = labels.match(/防御\s*[:：]\s*([\d.e+-]+)/i);
  const defense = bound(r.defense ?? r.\u9632\u5FA1 ?? defenseTag?.[1], 0, 1e6, kind === "shield" ? 1 : 0);
  if (kind === "shield") Object.assign(template, { weaponClass: "shield", hand: "off_hand", shield: true, defense });
  else if (isWeapon) {
    const classes = ["ranged", "light_blade", "greatsword", "staff", "auxiliary"];
    const weaponClassAlias = /* @__PURE__ */ new Map([["bow", "ranged"], ["crossbow", "ranged"], ["arcane", "staff"]]);
    const explicitClass = weaponClassAlias.get(r.weaponClass) ?? r.weaponClass;
    const ranged = r.ranged ?? (r.rangeType ? r.rangeType === "ranged" : ["ranged", "staff"].includes(explicitClass) || /弓|弩|法杖|远程|发射器/.test(`${name} ${labels}`));
    const twoHanded = slot === "twoHands" || r.twoHanded === true || r.hand === "two_handed" || explicitClass === "greatsword" || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${labels}`);
    const attackTag = labels.match(/攻击\s*[:：]\s*([\d.e+-]+)/i), rangeTag = labels.match(/(?:有效距离|射程)[^\d]*(\d+)/i);
    const weaponClass = classes.includes(explicitClass) ? explicitClass : ranged ? "ranged" : twoHanded ? "greatsword" : "light_blade";
    Object.assign(template, {
      weaponClass,
      hand: twoHanded ? "two_handed" : slot === "offHand" ? "off_hand" : "one_handed",
      ranged: Boolean(ranged),
      rangeType: ranged ? "ranged" : "melee",
      range: bound(r.range ?? r.\u6709\u6548\u8DDD\u79BB ?? rangeTag?.[1], 1, 15, ranged ? 4 : 1),
      attack: bound(r.attack ?? r.\u653B\u51FB ?? attackTag?.[1], 0, 1e9),
      accuracy: bound(r.accuracy ?? r.\u547D\u4E2D, -20, 30, 0),
      damage: normalizeDice(r.damage ?? { stat: "str" })
    });
    if (twoHanded) Object.assign(template, { twoHanded: true, heavy: r.heavy ?? !ranged });
  } else Object.assign(template, { armor: bound(r.armor, 0, 1e6, defense), defense });
  const counters = initialCounters(template);
  return { id: idBase, templateId, template, counters, slot, name };
}
function sourceEquipment(record2) {
  const value = record2.equipment ?? record2.equipments ?? record2.items ?? record2.\u88C5\u5907 ?? [];
  const slots = new Map(Object.entries({ mainHand: "mainHand", main: "mainHand", weapon: "mainHand", \u4E3B\u624B: "mainHand", \u53CC\u624B: "twoHands", \u53CC\u624B\u6B66\u5668: "twoHands", offHand: "offHand", off: "offHand", \u526F\u624B: "offHand", shield: "shield", \u76FE\u724C: "shield" }));
  const entries2 = Array.isArray(value) ? value.map((v) => ["", v]) : Object.entries(asObject(value));
  return entries2.filter(([, item]) => object3(item)).map(([key3, item], i) => {
    const rawSlot = text2(item.slot ?? item.position ?? item.\u4F4D\u7F6E) || key3;
    return [slots.get(rawSlot) ?? rawSlot, { ...item, name: item.name ?? item.\u540D\u79F0 ?? (slots.has(key3) ? "" : key3) }, i];
  });
}
function normalizeBattleDefinition(raw, id3 = "") {
  const value = clone(asObject(raw));
  if (!value.name) value.name = id3;
  if (value.weaponClass === "bow" || value.weaponClass === "crossbow" || value.weaponClass === "arcane") value.weaponClass = value.weaponClass === "arcane" ? "staff" : "ranged";
  if (value.hand === "one") value.hand = "one_handed";
  if (value.hand === "two") value.hand = "two_handed";
  if (value.hand === "off") value.hand = "off_hand";
  if (value.rangeType === "ranged") value.ranged = true;
  if (value.rangeType === "melee") value.ranged = false;
  const damageType2 = { "\u7269\u7406": "physical", "\u80FD\u91CF": "energy", "\u7CBE\u795E": "mental", "\u771F\u5B9E": "true" };
  if (object3(value.damage) && damageType2[value.damage.type]) value.damage.type = damageType2[value.damage.type];
  if (Array.isArray(value.effects)) value.effects = value.effects.map((effect) => typeof effect === "string" ? { kind: effect } : effect);
  return value;
}
function battleEquipmentRecord(participant, battle) {
  const definitions = asObject(battle?.equipment), result = {};
  for (const [field, slot] of [["mainHand", "mainHand"], ["offHand", "offHand"], ["shield", "shield"]]) {
    const id3 = text2(participant?.[field]), definition = definitions[id3];
    if (id3 && object3(definition)) result[slot] = normalizeBattleDefinition(definition, id3);
  }
  return Object.keys(result).length ? result : null;
}
function battleSkillsRecord(participant, battle) {
  const definitions = asObject(battle?.skills), result = {};
  for (const id3 of Array.isArray(participant?.skills) ? participant.skills : []) if (object3(definitions[id3])) result[id3] = clone(definitions[id3]);
  return Object.keys(result).length ? result : null;
}
function mergeBattleParticipant(record2, participant, battle) {
  const fallback = asObject(record2), inline = asObject(participant);
  const battleEquipment = battleEquipmentRecord(participant, battle), battleSkills = battleSkillsRecord(participant, battle);
  const merged = { ...fallback };
  if (!(merged.equipment ?? merged.equipments ?? merged.items ?? merged.\u88C5\u5907) && battleEquipment) merged.equipment = battleEquipment;
  if (!(merged.skills ?? merged.abilities ?? merged.\u6280\u80FD) && battleSkills) merged.skills = battleSkills;
  const fields3 = {
    bodyLengthM: ["bodyLengthM", "bodyLength", "bl", "\u4F53\u957F"],
    mc: ["mc", "MC", "massClass"],
    tier: ["tier", "levelTier", "\u5C42\u7EA7", "\u751F\u547D\u5C42\u7EA7"],
    armor: ["armor", "defense", "\u62A4\u7532"],
    stats: ["stats", "attributes", "\u5C5E\u6027", ...attrNames, ...Object.keys(statAliases)],
    statuses: ["statuses", "\u72B6\u6001\u6548\u679C", "\u72B6\u6001", "effects"],
    hp: ["hp", "HP", "\u751F\u547D\u503C", "resources", "resource", "\u8D44\u6E90"],
    mp: ["mp", "MP", "\u6CD5\u529B\u503C", "resources", "resource", "\u8D44\u6E90"],
    sp: ["sp", "SP", "\u4F53\u529B\u503C", "resources", "resource", "\u8D44\u6E90"]
  };
  for (const [field, aliases] of Object.entries(fields3)) {
    if (inline[field] != null && !aliases.some((alias) => own5(merged, alias))) merged[field] = clone(inline[field]);
  }
  for (const field of ["maxHp", "maxMp", "maxSp"]) if (!own5(merged, field) && inline[field] != null) merged[field] = inline[field];
  return merged;
}
function sourceSkills(record2) {
  const value = record2.skills ?? record2.abilities ?? record2.\u6280\u80FD ?? [];
  if (Array.isArray(value)) return value.map((v, i) => [v, i]);
  return Object.entries(asObject(value)).map(([name, v], i) => [{ ...asObject(v), name: v?.name ?? v?.\u540D\u79F0 ?? name }, i]);
}
function participantList(battle) {
  const value = Array.isArray(battle.units) ? battle.units : battle.participants ?? battle.roster ?? [];
  const list3 = Array.isArray(value) ? value : Object.entries(asObject(value)).map(([id3, participant]) => ({ ...asObject(participant), id: participant?.id ?? id3 }));
  const seen = /* @__PURE__ */ new Set();
  return list3.filter((participant, index) => {
    if (!object3(participant)) return false;
    const source = text2(participant.source);
    const key3 = text2(participant?.id || participant?.uid) || (source && !charSources.includes(source.toLowerCase()) ? source : `${source}|${text2(participant?.name) || index}`);
    if (seen.has(key3)) return false;
    seen.add(key3);
    return true;
  });
}
function teamOf(value, fallback = "red") {
  const t = text2(value).toLowerCase();
  return ["blue", "player", "ally", "\u53CB\u65B9", "\u6211\u65B9"].includes(t) ? "blue" : ["red", "enemy", "foe", "\u654C\u65B9"].includes(t) ? "red" : fallback;
}
function xyzOf(value) {
  const p = asObject(value);
  const xyz = Array.isArray(value) ? value : Array.isArray(p.xyz) ? p.xyz : [p.x, p.y, p.z];
  return { x: Math.max(0, Math.min(9, integer3(xyz[0], 0))), y: Math.max(0, Math.min(9, integer3(xyz[1], 0))), z: integer3(xyz[2], 0) };
}
function unitFrom(record2, participant, index, equipment, skills, items, warnings) {
  const p = participant ?? {};
  const name = text2(p.protagonistName || p.name) || sourceName(record2, p.id) || `\u5355\u4F4D ${index + 1}`;
  const id3 = p.id;
  const stats2 = statsOf(record2), level = Math.max(1, integer3(findValue(record2, ["level", "\u7B49\u7EA7"], 1), 1));
  const tier = Math.max(1, Math.min(7, tierNumber(findValue(record2, ["tier", "levelTier", "\u5C42\u7EA7", "\u751F\u547D\u5C42\u7EA7"], level), level)));
  const bodyLengthM = Math.max(0.01, Math.min(1e9, number2(findValue(record2, ["bodyLengthM", "bodyLength", "bl", "\u4F53\u957F"], 1.7), 1.7)));
  const size = Math.max(1, Math.min(5, sizeFor(bodyLengthM).value === 2 ? 1 : sizeFor(bodyLengthM).value === 1 ? 2 : sizeFor(bodyLengthM).value === 0 ? 3 : sizeFor(bodyLengthM).value === -1 ? 4 : 5));
  const mc = Math.max(1, Math.min(64, integer3(findValue(record2, ["mc", "MC", "massClass"], bodyLengthM >= 10 ? 2 : 1), 1)));
  const resources = { hp: safeResource(resource2(record2, "hp", Math.max(1, stats2.con * 100)), "hp", warnings), mp: safeResource(resource2(record2, "mp", Math.max(0, (stats2.int + stats2.spi) * 10)), "mp", warnings), sp: safeResource(resource2(record2, "sp", Math.max(0, (stats2.str + stats2.agi) * 10)), "sp", warnings) };
  const slotItems = sourceEquipment(record2).map(([slot, value, i]) => normalizeEquipment(value, slot, id3, i, warnings));
  for (const item of slotItems) {
    equipment[item.templateId] ??= item.template;
    items[item.id] = { id: item.id, templateId: item.templateId, counters: item.counters };
  }
  const main = slotItems.find((i) => i.template.kind === "weapon" && ["mainHand", "twoHands"].includes(i.slot)) ?? slotItems.find((i) => i.template.kind === "weapon" && i.slot !== "offHand");
  const off = !main?.template.twoHanded && slotItems.find((i) => i.slot === "offHand" && ["weapon", "consumable"].includes(i.template.kind));
  const shield = !main?.template.twoHanded && slotItems.find((i) => i.template.kind === "shield");
  const gear = slotItems.filter((i) => ![main, off, shield].includes(i));
  const mainId = main?.id ?? null, offId = off?.id ?? null, shieldId = shield?.id ?? null;
  const normalizedSkills = sourceSkills(record2).slice(0, 32).map(([raw, i]) => {
    const r = asObject(raw), sid = `skill-${id3.slice(0, 31)}-${hash(id3).toString(36)}-${i}`;
    const labels = [].concat(r.tags ?? r.\u6807\u7B7E ?? []).join(" ");
    const taggedPower = labels.match(/威力\s*[:：]\s*(\d+)/)?.[1];
    const taggedRange = labels.match(/有效距离\s*[:：][^\d\]]*(\d+)/)?.[1];
    skills[sid] = {
      name: text2(r.name ?? r.\u540D\u79F0).slice(0, 100) || `\u6280\u80FD${i + 1}`,
      quality: "\u666E\u901A",
      ap: bound(r.ap, 1, 2),
      slot: r.slot === "action" ? "action" : "attack",
      range: bound(r.range ?? taggedRange, 0, 15, 1),
      shape: ["single", "circle", "fan", "cone", "line"].includes(r.shape) ? r.shape : "single",
      target: ["enemy", "ally", "self", "any", "corpse"].includes(r.target) ? r.target : "enemy",
      ...text2(r.school) ? { school: text2(r.school).slice(0, 100) } : {},
      effects: mapEffects(r.effects ?? r.\u6548\u679C, "skill", warnings, `fx-${hash(sid).toString(36)}`)
    };
    for (const [key3, min, max] of [["mp", 0, 25e3], ["sp", 0, 25e3], ["radius", 0, 6], ["width", 0, 6], ["accuracy", -20, 30], ["power", 0, 1e9]]) {
      const value = r[key3] ?? (key3 === "power" ? taggedPower : void 0);
      if (value != null) skills[sid][key3] = bound(value, min, max);
    }
    if (attrNames.includes(r.save) && r.saveDC != null) {
      const saveDC = typeof r.saveDC === "object" ? r.saveDC : bound(r.saveDC, 1, 50);
      if (validSaveDC(saveDC)) Object.assign(skills[sid], { save: r.save, saveDC: structuredClone(saveDC) });
    }
    if (object3(r.resourceCost)) skills[sid].resourceCost = clone(r.resourceCost);
    for (const key3 of ["damage", "heal"]) if (object3(r[key3])) skills[sid][key3] = normalizeDice(r[key3]);
    return sid;
  });
  const pos2 = xyzOf(p.xyz ?? p);
  const sourceStatuses = record2.statuses ?? record2.\u72B6\u6001\u6548\u679C ?? record2.\u72B6\u6001 ?? record2.effects;
  const statuses = {};
  const statusEntries = Array.isArray(sourceStatuses) ? sourceStatuses.map((s) => [typeof s === "string" ? s : s?.id ?? s?.statusId ?? s?.name ?? s?.\u540D\u79F0, s]) : Object.entries(asObject(sourceStatuses));
  for (const [rawId, rawStatus] of statusEntries) {
    if (Array.isArray(sourceStatuses) && emptyEntry(rawStatus) || typeof rawId === "string" && emptyEntry(rawId)) continue;
    const sid = statusId(rawId) || statusId(rawStatus?.id ?? rawStatus?.name ?? rawStatus?.\u540D\u79F0);
    if (!sid) {
      const description = text2(rawStatus?.\u6548\u679C ?? rawStatus?.description);
      warnings.push(`\u5FFD\u7565\u672A\u77E5\u72B6\u6001\uFF1A${rawId ?? "unknown"}${description ? `\uFF1A${description}` : ""}`);
      continue;
    }
    const template = STATUSES[sid];
    const remainingTurns = statusTurns(rawStatus?.remainingTurns ?? rawStatus?.\u5269\u4F59\u56DE\u5408 ?? rawStatus?.\u5269\u4F59\u65F6\u95F4, template.remainingTurns);
    const stacks = bound(rawStatus?.stacks ?? rawStatus?.\u5C42\u6570, 1, template.maxStacks);
    const modifiers2 = { ...template.modifiers };
    if (rawStatus && own5(rawStatus, "modifiers") && !emptyEntry(rawStatus.modifiers)) {
      try {
        validateStatusModifiers(template, rawStatus.modifiers);
        Object.assign(modifiers2, rawStatus.modifiers);
      } catch (error2) {
        warnings.push(`\u72B6\u6001 ${sid} \u5DF2\u62D2\u7EDD\uFF1A${error2.message}`);
        continue;
      }
    }
    const durationType = ["battle_turns", "until_removed", "persistent"].includes(rawStatus?.durationType) ? rawStatus.durationType : template.durationType;
    statuses[sid] = {
      ...template,
      durationType,
      remainingTurns,
      stacks,
      sourceUnitId: null,
      modifiers: modifiers2,
      ...sid === "shield" ? { amount: bound(rawStatus?.amount ?? rawStatus?.\u62A4\u76FE\u503C, 1, 1e9, modifiers2.amount) } : {}
    };
  }
  const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
  const team2 = teamOf(p.faction ?? p.team, "red");
  const rawFacing = Array.isArray(p.facing) ? p.facing : [team2 === "blue" ? 1 : -1, 0];
  const facing = rawFacing.slice(0, 2).map((n) => Math.sign(integer3(n)));
  if (facing.length !== 2 || !facing.some(Boolean)) facing.splice(0, 2, team2 === "blue" ? 1 : -1, 0);
  const unit = { id: id3, name, team: team2, x: pos2.x, y: pos2.y, facing, hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats: stats2, armor: Math.max(0, Math.min(1e6, integer3(findValue(record2, ["armor", "defense", "\u62A4\u7532"], 0), 0))), size, move: Math.max(1, Math.min(10, integer3(findValue(record2, ["move", "movement", "\u79FB\u52A8"], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.slice(0, 12).map((item) => item.id), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: "offensive", parryQuota: stance === "greatsword" ? 2 : 0, parryRefunded: false, attunementCharges: stance === "attunement" ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: "normal", nonLethal: p.nonLethal === true, moraleType: text2(p.moraleType) || "standard" };
  const creatureType = p.creatureType ?? record2.creatureType;
  if (Array.isArray(creatureType)) unit.creatureType = creatureType.map(text2).filter(Boolean).slice(0, 12);
  else if (text2(creatureType)) unit.creatureType = text2(creatureType).slice(0, 100);
  const tags2 = p.tags ?? record2.tags;
  if (Array.isArray(tags2)) unit.tags = tags2.map((tag) => text2(tag).slice(0, 100)).filter(Boolean).slice(0, 32);
  return { unit, profile: { id: id3, level, tier, stats: stats2, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, equipment: clone(slotItems), sourcePath: record2.__sourcePath ?? null, sourceKind: record2.__sourceKind || "unknown", fieldSources: { numeric: record2.__sourceKind || "unknown", equipment: record2.__sourceKind || "unknown", placement: "battle_init", faction: "battle_init", name: p.protagonistName ? "persona" : p.name ? "battle_init" : record2.__sourceKind || "unknown" } }, participant: p };
}
function terrainState(battle, state, warnings) {
  state.grid = createBattleGrid(battle, state.rng, Object.values(state.units), warnings);
  for (const [i, raw] of (Array.isArray(battle.covers) ? battle.covers : []).entries()) {
    if (!object3(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw), id3 = deterministicId(raw.id ?? `cover-${i}`, "cover");
    if (state.grid[p.y][p.x].kind === "wall") {
      warnings.push(`\u5FFD\u7565\u4F4D\u4E8E\u5899\u4F53\u5185\u7684\u63A9\u4F53\uFF1A${id3}`);
      continue;
    }
    state.covers[id3] = { id: id3, name: text2(raw.name) || `\u63A9\u4F53${i + 1}`, x: p.x, y: p.y, material: text2(raw.material) || "\u672A\u77E5\u6750\u6599", hp: Math.max(0, Math.min(1e9, integer3(raw.hp ?? raw.maxHp, 10))), maxHp: Math.max(1, Math.min(1e9, integer3(raw.maxHp ?? raw.hp, 10))), cover: Math.max(0, Math.min(12, integer3(raw.cover ?? raw.shielding, 2))) };
    state.covers[id3].hp = Math.min(state.covers[id3].hp, state.covers[id3].maxHp);
  }
  const interactives = battle.interacts ?? battle.interactives;
  for (const [i, raw] of (Array.isArray(interactives) ? interactives : []).entries()) {
    if (!object3(raw)) continue;
    const p = xyzOf(raw.xyz ?? raw), id3 = deterministicId(raw.id ?? `interactive-${i}`, "interactive");
    if (state.grid[p.y][p.x].kind === "wall") {
      warnings.push(`\u5FFD\u7565\u4F4D\u4E8E\u5899\u4F53\u5185\u7684\u4E92\u52A8\u70B9\uFF1A${id3}`);
      continue;
    }
    const kind = text2(raw.kind ?? raw.type).toLowerCase() === "altar" || /祭坛|altar/.test(text2(raw.name)) ? "altar" : "barrel";
    state.interactives[id3] = { id: id3, name: text2(raw.name) || (kind === "altar" ? "\u661F\u8F89\u796D\u575B" : "\u4F59\u70EC\u7206\u6876"), x: p.x, y: p.y, kind, spent: Boolean(raw.spent) };
  }
  return state;
}
function uniquePositions(units, state) {
  const used = /* @__PURE__ */ new Set();
  for (const unit of Object.values(units)) {
    let x = unit.x, y = unit.y;
    for (let n = 0; n < 100 && (used.has(`${x},${y}`) || state.grid[y][x].kind === "wall" || Object.values(state.covers).some((c) => c.x === x && c.y === y && c.hp > 0)); n++) {
      x = (x + 1) % 10;
      if (x === 0) y = (y + 1) % 10;
    }
    unit.x = x;
    unit.y = y;
    used.add(`${x},${y}`);
  }
}
function hydrateFromSources(input = {}, options = {}) {
  const source = asObject(input), warnings = [];
  const protagonistName = text2(source.protagonistName ?? options.protagonistName);
  const mvu = source.mvu ?? source.statData ?? source.stat_data ?? {};
  const battle = parseBattleInit(source.battleInit ?? source.battle_init ?? source.battle ?? {});
  const chars = parseCharInfo(source.charInfo ?? source.char_info ?? "").map((record2) => ({ ...record2, __sourceKind: "char_info" }));
  const mvuRecords = collectMvu(mvu);
  const protagonist = protagonistAliases.flatMap((alias) => mvuRecords.filter((record2) => samePath(record2.__sourcePath, [alias])))[0];
  const descriptor = battle.version === 1 && ["flat", "terrain"].includes(battle.terrainMode);
  const participants = participantList(battle);
  const resolved = participants.map((participant) => resolveParticipant(participant, mvuRecords, chars, protagonist));
  if (!descriptor && protagonist && !resolved.includes(protagonist)) {
    const eligible = (p) => !text2(p.source) && teamOf(p.faction ?? p.team) === "blue";
    const byPersona = protagonistName ? participants.findIndex((p, i) => eligible(p) && text2(p.name) === protagonistName && resolved[i]?.__sourceKind !== "MVU") : -1;
    const fallbackIndex = byPersona >= 0 ? byPersona : participants.findIndex((p, i) => eligible(p) && !resolved[i]);
    if (fallbackIndex >= 0) resolved[fallbackIndex] = protagonist;
  }
  const equipment = clone(EQUIPMENT), skills = clone(SKILLS), items = {};
  const units = {}, profiles = {}, sourceMap = {};
  const add = (participant, record2, index) => {
    const base = descriptor ? participant.id : deterministicId(participant.id || participant.uid || participant.source || `${participant.name}-${index}`, "unit");
    let id3 = base;
    for (let suffix = 2; own5(units, id3); suffix++) id3 = `${base.slice(0, 52)}-${suffix}`;
    const persona = !descriptor && record2 === protagonist && protagonistName ? { protagonistName } : {};
    const made = unitFrom(mergeBattleParticipant(record2, participant, battle), { ...participant, ...persona, id: id3 }, index, equipment, skills, items, warnings);
    units[id3] = made.unit;
    profiles[id3] = made.profile;
    sourceMap[id3] = { path: record2?.__sourcePath, sourceId: sourceId(record2), sourceName: sourceName(record2) };
  };
  for (const [i, participant] of participants.entries()) {
    const record2 = resolved[i];
    if (!record2 && participant.source) warnings.push(`\u672A\u627E\u5230\u53C2\u6218\u6765\u6E90\uFF1A${participant.source}\uFF08${participant.name ?? participant.id}\uFF09`);
    add(participant, record2 ?? { __sourceKind: "battle_init" }, i);
  }
  if (!participants.length) {
    const records = [...mvuRecords, ...chars.filter((char) => !mvuRecords.some((record2) => sourceName(record2, record2.__sourceKey) === sourceName(char)))];
    for (const [i, record2] of records.entries()) {
      add({ name: sourceName(record2, record2.__sourceKey), source: sourceId(record2), faction: i ? "red" : "blue", x: i, y: 0 }, record2, i);
    }
  }
  const title = text2(battle.sceneTitle ?? battle.title ?? options.title).slice(0, 100) || "\u9152\u9986\u6218\u672F\u6218\u5C40";
  const seed = integer3(options.seed ?? battle.seed, hash(battle.battleId ?? title)) >>> 0;
  const mode = options.mode ?? battle.mode;
  const state = { scenarioId: descriptor ? battle.battleId : deterministicId(battle.battleId ?? title, "battle"), title, mode: ["free", "split"].includes(mode) ? mode : "free", ruleset: ["protocol", "sandbox"].includes(options.ruleset) ? options.ruleset : "protocol", round: 1, turn: 0, order: Object.keys(units), units, items, equipment, skills, statusTemplates: {}, grid: [], covers: {}, interactives: {}, zones: {}, rng: seed, logs: [], outcome: null };
  const time = parseBattleTime(source.task, source.battle, source.battleText, source.latestFloor, source.battleInit, source.battle_init);
  if (time) state.time = time;
  terrainState(battle, state, warnings);
  uniquePositions(state.units, state);
  let valid = true;
  try {
    validateState(state);
  } catch (error2) {
    valid = false;
    warnings.push(`\u8F6C\u6362\u7ED3\u679C\u672A\u901A\u8FC7\u6821\u9A8C\uFF1A${error2.message}`);
    if (options.throwOnValidation) throw error2;
  }
  if (valid) beginBattle(state);
  const roster = Object.values(units).map((unit) => ({ ...profiles[unit.id], ...clone(unit), source: profiles[unit.id].sourceKind }));
  return { state, roster, warnings, sourceMap, battleInit: battle, seed };
}
var convertSources = hydrateFromSources;
var buildState = (input, options) => hydrateFromSources(input, options).state;
function pointer(path) {
  return "/" + path.map((x) => String(x).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}
function battleReportToMvuPatch(report, sourceMap = {}, options = {}) {
  const state = report?.state ?? report?.battleState ?? report;
  const units = state?.units ?? (Array.isArray(report?.units) ? Object.fromEntries(report.units.map((u) => [u.id, u])) : {});
  const ops = [];
  for (const [id3, unit] of Object.entries(units)) {
    const mapping = sourceMap[id3] ?? {};
    const path = Array.isArray(mapping.path) ? mapping.path : ["characters", id3];
    for (const key3 of ["hp", "mp", "sp"]) if (unit && Number.isFinite(unit[key3])) ops.push({ op: "replace", path: pointer([options.root ?? "stat_data", ...path, key3]), value: unit[key3] });
    if (unit?.statuses && options.includeStatuses !== false) ops.push({ op: "replace", path: pointer([options.root ?? "stat_data", ...path, "statuses"]), value: clone(unit.statuses) });
  }
  return ops;
}
function buildMvuJsonPatch(report, sourceMap = {}, options = {}) {
  const patch = battleReportToMvuPatch(report, sourceMap, options);
  return `<UpdateVariable><JSONPatch>${JSON.stringify(patch)}</JSONPatch></UpdateVariable>`;
}

// src/tavern/host.js
function hostScopes(host, local = globalThis) {
  const scopes = /* @__PURE__ */ new Set([local, host]);
  for (const window2 of [...scopes]) {
    try {
      if (window2?.TavernHelper) scopes.add(window2.TavernHelper);
    } catch {
    }
  }
  return [...scopes].filter(Boolean);
}
function hostMethod(host, name) {
  for (const scope of hostScopes(host)) {
    try {
      if (typeof scope[name] === "function") return scope[name].bind(scope);
    } catch {
    }
  }
  return null;
}
function statData(variables) {
  const data = variables?.stat_data ?? variables?.statData ?? variables?.message?.stat_data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}
async function readBattleVariables(host, messageId) {
  const ids = [...new Set([messageId, -1].filter((id3) => Number.isInteger(id3)))];
  const readers = hostScopes(host).flatMap((scope) => {
    try {
      return typeof scope.Mvu?.getMvuData === "function" ? [scope.Mvu.getMvuData.bind(scope.Mvu)] : [];
    } catch {
      return [];
    }
  });
  const helper = hostMethod(host, "getVariables");
  if (helper) readers.push(helper);
  for (const id3 of ids) {
    for (const read of readers) {
      try {
        const data = statData(await read({ type: "message", message_id: id3 }));
        if (data && Object.keys(data).length) return data;
      } catch {
      }
    }
  }
  try {
    const context = host?.SillyTavern?.getContext?.();
    for (const id3 of ids) {
      const message = context?.chat?.at(id3);
      const variables = message?.variables;
      const data = statData(Array.isArray(variables) ? variables[message.swipe_id ?? 0] : variables);
      if (data && Object.keys(data).length) return data;
    }
    return statData(context?.chatMetadata?.variables) ?? statData(context?.chatMetadata) ?? {};
  } catch {
    return {};
  }
}
async function readChatMessages(host) {
  const getMessages = hostMethod(host, "getChatMessages");
  const getLastId = hostMethod(host, "getLastMessageId");
  if (getMessages) {
    try {
      const last = getLastId ? await getLastId() : -1;
      const messages = await getMessages(last >= 0 ? `0-${last}` : "0-{{lastMessageId}}", { include_swipes: false });
      if (Array.isArray(messages) && messages.length) return messages;
    } catch {
    }
  }
  try {
    const chat = host?.SillyTavern?.getContext?.()?.chat;
    if (Array.isArray(chat) && chat.length) return chat.map((message, message_id) => ({ ...message, message_id }));
  } catch {
  }
  return [];
}

// src/tavern/theme.js
var tavernTheme = `
:where([data-fated-tavern-overlay], .fated-battle-entry) {
  --ink-0:#141423; --ink-1:#1e1e32; --ink-2:#11111d;
  --surface:#252035; --surface-hover:#2f2a42; --raised-a:#393045; --raised-b:#292536;
  --field:#252035; --accent-rgb:176 142 92; --gold:#dfc080; --gold-rgb:223 192 128;
  --gold-bright:#ffd700; --gold-soft:#d7bb7c; --gold-dim:#8b7355;
  --frame-rgb:139 115 85; --glow-rgb:120 100 190; --sheen-rgb:255 240 220;
  --accent-text:#f0dfb9; --accent-label:#e0cb9d; --selected-bg:#3a3045;
  --btn-a:#776044; --btn-b:#5b4b3e; --btn-hover-a:#856d4f; --btn-hover-b:#665342;
  --btn-text:#fff0ca; --btn-line-rgb:209 179 118; --focus:#ffe2a0;
  --text:#e8d5b7; --text-soft:#d2c3ab; --text-key:#c7b4e2; --text-muted:#c9c0d0;
  --neutral-rgb:200 188 208; --scrollbar:#927753;
  --panel-bg:linear-gradient(180deg, rgba(30, 30, 50, .95) 0%, rgba(20, 20, 35, .98) 100%);
  --panel-border:2px solid #8b7355;
  --topline:linear-gradient(90deg, transparent, #ffd700, transparent);
  --topline-left:0px; --topline-width:100%; --topline-height:3px;
  --header-bg:linear-gradient(90deg, #2d2d44 0%, #3d3d5c 50%, #2d2d44 100%);
  --header-hover:linear-gradient(90deg, #3d3d5c 0%, #4d4d6c 50%, #3d3d5c 100%);
  --header-line:#8b7355; --title-shadow:0 0 10px rgba(255, 215, 0, .3);
  --row-bg:rgba(0, 0, 0, .3); --row-border:rgba(139, 115, 85, .3);
  --heading:#dfc080; --entry-text:#d2cbdc; --entry-current:#f4d98d;
  --icon-glow:0 0 10px rgba(255, 215, 0, .5);
  --font-display:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif;
  --font-body:"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", serif;
  --line:rgb(var(--accent-rgb) / .13); --line-mid:rgb(var(--accent-rgb) / .26); --line-strong:rgb(var(--accent-rgb) / .46);
  --blue-line:#5f93c8; --blue-text:#cfe3f7; --red-line:#c0727a; --red-text:#f6d3d6;
  color-scheme:dark; color:var(--text); text-align:start;
  font:14px/1.55 var(--font-body);
}
[data-fated-tavern-overlay] { position:fixed; z-index:2147483000; pointer-events:none }
[data-fated-tavern-overlay] *, .fated-battle-entry { box-sizing:border-box }
[data-fated-tavern-overlay] [hidden] { display:none !important }

/* ---------- panels ---------- */
[data-fated-tavern-overlay] :is(.action-panel,.form-card,.wf-card,.fated-battle-card,.fated-instance,.fated-prompt):not([data-sandbox-mount] *) {
  position:relative; overflow:hidden; margin:0 0 12px;
  color:var(--text); background:var(--panel-bg); border:var(--panel-border); border-radius:10px;
  box-shadow:0 6px 20px rgba(0,0,0,.26), inset 0 1px 0 rgb(var(--sheen-rgb) / .035);
  overflow-wrap:anywhere;
}
[data-fated-tavern-overlay] :is(.action-panel,.form-card,.wf-card,.fated-battle-card,.fated-instance,.fated-prompt):not([data-sandbox-mount] *)::before {
  content:""; position:absolute; z-index:1; top:0; left:var(--topline-left); width:var(--topline-width);
  height:var(--topline-height); background:var(--topline); pointer-events:none;
}
.panel-header-bar { display:flex; align-items:center; gap:8px; min-width:0; padding:8px 12px; background:var(--header-bg); border-bottom:1px solid var(--header-line) }
.panel-title { flex:1; min-width:0; color:var(--gold-bright); font-family:var(--font-display); font-size:1.02em; font-weight:700; line-height:1.45; letter-spacing:.06em; text-shadow:var(--title-shadow); overflow-wrap:anywhere }
.panel-content { padding:10px 12px 12px }

/* ---------- buttons ---------- */
[data-fated-tavern-overlay] button:not([data-sandbox-mount] *), .fated-battle-entry button {
  display:inline-flex; align-items:center; justify-content:center; gap:5px; cursor:pointer;
  min-height:30px; padding:4px 10px; border:1px solid var(--line-mid); border-radius:6px;
  background:linear-gradient(160deg, var(--raised-a), var(--raised-b)); color:var(--text);
  font:inherit; font-size:.88em; overflow-wrap:anywhere;
}
[data-fated-tavern-overlay] .game-button.primary, [data-fated-tavern-overlay] button:not([data-sandbox-mount] *)[data-tone=primary] {
  background:linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color:rgb(var(--btn-line-rgb) / .75); color:var(--btn-text); font-weight:600;
}
@media (hover:hover) and (pointer:fine) {
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *):not(:disabled):hover, .fated-battle-entry button:hover { border-color:var(--gold); background:linear-gradient(160deg, var(--btn-hover-a), var(--btn-hover-b)); }
}
[data-fated-tavern-overlay] button:disabled { opacity:.45; cursor:not-allowed }
[data-fated-tavern-overlay] :focus-visible, .fated-battle-entry :focus-visible { outline:2px solid var(--focus); outline-offset:2px }

/* ---------- fields ---------- */
[data-fated-tavern-overlay] :is(input:not([type=checkbox]),textarea,select):not([data-sandbox-mount] *) {
  width:100%; min-width:0; min-height:32px; padding:5px 8px; border:1px solid var(--line-mid); border-radius:6px;
  background:var(--field); color:var(--text); font:inherit; font-size:.9em;
}
[data-fated-tavern-overlay] :is(input,textarea,select):not([data-sandbox-mount] *):focus { border-color:var(--gold); box-shadow:0 0 0 2px rgb(var(--gold-rgb) / .22); outline:none }
[data-fated-tavern-overlay] textarea:not([data-sandbox-mount] *) { min-height:56px; resize:vertical; font:.86em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace }
[data-fated-tavern-overlay] .masked-key-input { -webkit-text-security:disc }
[data-fated-tavern-overlay] .field { display:grid; gap:3px; min-width:0 }
[data-fated-tavern-overlay] .field > label, [data-fated-tavern-overlay] label.field { display:grid; gap:3px; min-width:0; color:var(--text-soft); font-size:.84em }
[data-fated-tavern-overlay] .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr)); gap:8px 10px; padding:10px 12px 12px }
[data-fated-tavern-overlay] .row-inline { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0 }
[data-fated-tavern-overlay] .row-inline input:not([type=checkbox]) { flex:1 1 10rem }
[data-fated-tavern-overlay] .pill-btn { border-radius:999px; padding-inline:12px }

/* ---------- console shell ---------- */
[data-fated-tavern-overlay] .fated-tavern-launcher {
  position:fixed; right:18px; bottom:18px; width:52px; height:52px; border-radius:50%;
  border-color:var(--gold); font-size:22px; box-shadow:0 8px 24px rgb(var(--accent-rgb) / .25); pointer-events:auto;
}
.fated-tavern-panel {
  position:fixed; right:16px; bottom:16px; width:min(1100px,calc(100vw - 32px));
  height:min(820px,calc(100dvh - 32px)); display:flex; flex-direction:column;
  border:var(--panel-border); border-radius:10px; background:var(--panel-bg);
  box-shadow:0 18px 54px rgba(0,0,0,.55); pointer-events:auto; overflow:hidden;
}
[data-fated-tavern-overlay] .fated-tavern-panel::before {
  content:""; position:absolute; z-index:2; top:0; left:var(--topline-left); width:var(--topline-width);
  height:var(--topline-height); background:var(--topline); pointer-events:none;
}
.fated-tavern-header { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:move; touch-action:none; user-select:none; background:var(--header-bg); border-bottom:1px solid var(--header-line) }
.fated-tavern-header strong { flex:1; color:var(--gold); font-family:var(--font-display); font-size:1.02rem; font-weight:700; letter-spacing:.07em; text-shadow:var(--title-shadow) }
.fated-tavern-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px; background:var(--row-bg); border-bottom:1px solid var(--header-line) }
[data-fated-tavern-overlay] .fated-tavern-tabs button {
  min-height:28px; border-radius:5px; border-color:transparent; background:transparent; color:var(--text-soft); font-size:.85em; letter-spacing:.04em;
}
[data-fated-tavern-overlay] .fated-tavern-tabs button[aria-selected=true] {
  background:linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color:rgb(var(--btn-line-rgb) / .75); color:var(--btn-text); font-weight:600;
}
.fated-tavern-content { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:10px 12px 14px; scrollbar-color:var(--scrollbar) transparent; scrollbar-width:thin }
.fated-tab { display:none }.fated-tab.active { display:block }
.fated-tab > h3 { margin:0 0 10px; color:var(--gold); font-family:var(--font-display); font-size:1rem; font-weight:700; letter-spacing:.08em }

/* ---------- instances / sandbox chrome ---------- */
.fated-battle-card h4 { margin:2px 0 4px; padding:0 12px; color:var(--accent-text); font-family:var(--font-display); font-size:1.1rem }
.fated-card-kicker { padding:8px 12px 0; color:var(--gold-dim); font:600 .72em/1.5 ui-monospace,monospace; letter-spacing:.08em }
.fated-instance { padding:10px 12px 12px; overflow-wrap:anywhere }
.fated-instance > * { margin-inline:0 }
.fated-battle-card > :is(p,details,.fated-actions,.fated-status) { margin-inline:12px }
.fated-mini,.fated-battle-meta { margin:5px 0; color:var(--text-muted); font-size:.82em }
.fated-status,.fated-battle-source {
  margin:6px 0; padding:7px 10px; border:1px solid var(--row-border); border-radius:6px;
  background:var(--row-bg); color:var(--text-soft); max-height:10lh; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--scrollbar) transparent;
  overflow-wrap:anywhere; white-space:pre-wrap; font:.78em/1.5 ui-monospace,monospace;
}
.fated-status:empty { display:none }
:is(.fated-battle-source-box,.fated-diagnostics) > summary { cursor:pointer; color:var(--accent-label); padding-block:4px }
.fated-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:8px 0 }
.fated-instance > strong { display:block; color:var(--accent-text) }
.fated-instance > .fated-status { max-height:8lh; scrollbar-width:thin; scrollbar-color:var(--scrollbar) transparent }
.fated-chat { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:8px 0 }
.fated-chat textarea { flex:1 1 230px }
.fated-ai-log { display:flex; flex-direction:column; gap:8px; max-height:380px; min-height:180px; overflow:auto; padding:4px; border:1px solid var(--line); border-radius:8px; background:rgb(0 0 0/.12); }
.fated-ai-message { flex:none; max-width:92%; padding:7px 9px; border:1px solid var(--line); border-radius:8px; background:rgb(255 255 255/.04); white-space:pre-wrap; overflow-wrap:anywhere; }
.fated-ai-message[data-role=user] { align-self:flex-end; background:rgb(95 147 200/.12); }
.fated-ai-message[data-role=assistant] { align-self:flex-start; border-color:rgb(var(--gold-rgb)/.35); }
.fated-ai-message[data-role=system] { align-self:center; opacity:.78; font-size:.86em; }
.fated-ai-message[data-role=tool] { align-self:flex-start; border-style:dashed; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.84em; }
.fated-ai-message[data-status=error] { border-color:#d66; }.fated-ai-message[data-status=aborted] { opacity:.7; }
.fated-ai-message header { display:flex; justify-content:space-between; gap:12px; color:var(--gold); font-size:.72em; margin-bottom:4px; }
.fated-ai-message header time { color:var(--text-muted, var(--blue-text)); font-weight:400; }.fated-ai-body p { margin:0 0 6px; }.fated-ai-body p:last-child { margin-bottom:0; }.fated-ai-body pre { margin:5px 0; padding:6px; overflow:auto; background:#0005; border-radius:5px; }
.fated-ai-info { color:var(--text-muted, var(--blue-text)); font-size:.78em; margin:5px 0; }
.fated-toast {
  position:fixed; z-index:2; top:max(16px,env(safe-area-inset-top)); right:16px; width:min(380px,calc(100vw - 32px));
  padding:12px 14px; border:1px solid var(--header-line); border-inline-start:3px solid var(--notice-color,var(--blue-text)); border-radius:8px;
  background:var(--panel-bg); color:var(--text); box-shadow:0 12px 40px rgba(0,0,0,.5);
  pointer-events:auto; overflow-wrap:anywhere; max-height:calc(100dvh - 32px); overflow:auto;
}
.fated-toast[data-tone="success"] { --notice-color:var(--accent-text) }
.fated-toast[data-tone="error"] { --notice-color:var(--red-text) }
.fated-toast header { display:flex; align-items:center; gap:8px; color:var(--notice-color,var(--blue-text)) }
.fated-toast header span { display:grid; place-items:center; width:1.4em; height:1.4em; border:1px solid currentColor; border-radius:50%; font-weight:bold }
.fated-toast p { margin:6px 0; white-space:pre-wrap; color:var(--text-soft) }
.fated-toast-issues { border-top:1px solid var(--line); margin-top:8px; padding-top:8px }
.fated-toast-issues h4 { margin:0; color:var(--text-key) }.fated-toast-issues ul { margin:4px 0; padding-inline-start:1.5em }
.fated-toast-raw { margin-top:8px; border-top:1px solid var(--line); padding-top:8px }
.fated-toast-raw summary { display:list-item; cursor:pointer; color:var(--text-key) }
.fated-toast-raw summary:focus-visible { outline:2px solid var(--focus); outline-offset:2px }
.fated-toast-raw pre { margin:6px 0 0; padding:8px; max-height:min(12rem,35dvh); overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text); background:var(--surface); border-radius:4px }
.fated-toast footer { display:flex; justify-content:flex-end; gap:6px; margin-top:8px }.fated-toast footer:has(button:not([hidden])) { border-top:1px solid var(--line); padding-top:8px }

/* ---------- switch ---------- */
[data-fated-tavern-overlay] .switch { position:relative; flex:none; display:inline-flex; align-items:center; width:42px; height:22px; margin-left:auto; cursor:pointer }
[data-fated-tavern-overlay] .switch input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer }
[data-fated-tavern-overlay] .switch-track { position:absolute; inset:0; border:1px solid var(--line-mid); border-radius:999px; background:var(--row-bg); box-shadow:inset 0 1px 3px rgba(0,0,0,.45); transition:background-color .18s ease, border-color .18s ease; pointer-events:none }
[data-fated-tavern-overlay] .switch-track::after { content:""; position:absolute; top:1px; left:1px; width:18px; height:18px; border-radius:50%; background:var(--text-muted); box-shadow:0 1px 3px rgba(0,0,0,.55); transition:transform .18s cubic-bezier(.23,1,.32,1), background-color .18s ease }
[data-fated-tavern-overlay] .switch input:checked + .switch-track { background:rgb(var(--gold-rgb) / .22); border-color:var(--gold) }
[data-fated-tavern-overlay] .switch input:checked + .switch-track::after { transform:translateX(20px); background:var(--gold) }
[data-fated-tavern-overlay] .switch input:focus-visible + .switch-track { outline:2px solid var(--focus); outline-offset:2px }
@media (prefers-reduced-motion:reduce) { [data-fated-tavern-overlay] .switch-track, [data-fated-tavern-overlay] .switch-track::after { transition:none } }

/* ---------- sandbox game root keeps its own layout variables ---------- */
[data-fated-tavern-overlay] [data-sandbox-mount]:not(:empty) { min-width:0; margin:8px 0 }
[data-fated-tavern-overlay] .fated-tactical-root {
  --font-display:"Noto Sans SC",'PingFang SC','Microsoft YaHei',system-ui,sans-serif;
  --font-body:var(--font-display); min-height:0;
}
[data-fated-tavern-overlay] .fated-tactical-root[data-dlc-theme=amethyst] {
  --ink-0:#0b1120; --ink-1:#0f172a; --ink-2:#0b1120; --surface:#131c2e; --surface-hover:#18243a;
  --field:#0b1120; --gold:#d4af37; --gold-rgb:212 175 55; --gold-bright:#f1cd59; --focus:#38bdf8;
  --heading:#d4af37; --text:#e5edf8; --text-muted:#a7b8cf; --text-key:#a6e3ff;
  --frame-rgb:52 72 103; --accent-rgb:100 155 205; --glow-rgb:56 189 248;
  --panel-bg:#0f172a; --panel-border:1px solid #283750; --header-bg:linear-gradient(100deg,#18243a,#131c2e);
  --header-line:#283750; --title-shadow:none; --row-bg:#131c2e; --row-border:#283750;
  --line:#283750; --line-mid:#475979; --btn-a:#ebc751; --btn-b:#d4af37; --btn-text:#111827;
}
[data-fated-tavern-overlay] .fated-tactical-root > .game-layout { container:fated-board / inline-size; padding:0 }
[data-fated-tavern-overlay] .game-header { border-inline-start:3px solid var(--gold) }
[data-fated-tavern-overlay] .battle-main,[data-fated-tavern-overlay] .battle-sidebar { min-width:0 }
@container fated-board (max-width:850px) { [data-fated-tavern-overlay] .game-columns { grid-template-columns:minmax(0,1fr) } }
@media (max-width:660px),(max-height:460px) {
  .fated-tavern-panel { inset:6px !important; width:auto; height:auto }
  .fated-tavern-header { cursor:default; touch-action:auto }
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *) { min-height:36px }
}
`;

// src/tavern/effect-protocol.js
var { expression: expression2, condition: condition2, node: node2, expireOn } = effectSchema.$defs;
function describe(rule) {
  if (rule.$ref) return rule.$ref.split("/").at(-1);
  if (rule.oneOf) return rule.oneOf.map(describe).join(" \u6216 ");
  if (rule.enum) return rule.enum.join(" / ");
  if (Object.hasOwn(rule, "const")) return JSON.stringify(rule.const);
  if (rule.type === "array") return `${rule.minItems}\u2026${rule.maxItems} \u9879 ${describe(rule.items)} \u6570\u7EC4`;
  if (rule.type === "object") return rule.additionalProperties ? `\u952E\u2192${describe(rule.additionalProperties)}` : `{${fields2(rule)}}`;
  if (rule.type === "integer" || rule.type === "number") return `${rule.type === "integer" ? "\u6574\u6570" : "\u6570\u503C"} ${rule.minimum}\u2026${rule.maximum}`;
  if (rule.pattern) return `ID (${rule.pattern})`;
  if (rule.type === "string") return `\u975E\u7A7A\u5B57\u7B26\u4E32\uFF0C\u5B57\u6BB5\u957F\u5EA6 ${rule.minLength}\u2026${rule.maxLength}`;
  return rule.type;
}
function fields2(rule, skip = []) {
  return Object.entries(rule.properties).filter(([key3]) => !skip.includes(key3)).map(([key3, value]) => `${key3}${rule.required.includes(key3) ? "" : "?"}=${describe(value)}`).join("\uFF0C");
}
var EFFECT_PROTOCOL = `\u3010\u7EDF\u4E00\u6548\u679C DSL\u3011
\u88C5\u5907\u4E0E\u6280\u80FD effects \u90FD\u662F\u8868\u8FBE\u5F0F\u6570\u7EC4\uFF080\u202624 \u9879\uFF09\u3002\u6BCF\u6761\u8868\u8FBE\u5F0F\u4F7F\u7528\u6218\u5C40\u5185\u552F\u4E00 id\uFF0Clabel \u662F\u754C\u9762\u663E\u793A\u540D\u3002\u5916\u5C42\u6CA1\u6709 kind\uFF0C\u5185\u5C42\u8282\u70B9\u5FC5\u987B\u6709 kind\u3002\u4E94\u6BB5\u5199\u6CD5\uFF1AWHEN(trigger) \u2192 IF(condition\uFF0C\u53EF\u7701) \u2192 ROLL(\u53EF\u7701) \u2192 TARGET(target) \u2192 DO(effects)\uFF0CWITH \u4EE5\u8282\u70B9\u5B57\u6BB5\u6216\u5171\u4EAB params \u8868\u8FBE\u3002\u8282\u70B9\u540C\u540D\u5B57\u6BB5\u8986\u76D6 params\u3002\u9664\u8868\u4E2D\u58F0\u660E\u5B57\u6BB5\u5916\u4E0D\u5141\u8BB8\u989D\u5916\u5B57\u6BB5\uFF0C? \u8868\u793A\u53EF\u7701\u3002
\u8868\u8FBE\u5F0F\u5B57\u6BB5\uFF1A${fields2(expression2)}\u3002

WHEN\uFF1Apassive \u6301\u7EED\u8BFB\u53D6\uFF0C\u5E38\u9A7B\u4FEE\u6B63\u7528 self \u4E14\u7701\u7565 roll\u3002on_attack \u4E3A\u6B66\u5668\u51FA\u624B\u3001\u547D\u4E2D\u524D\u3002on_hit \u4E3A\u5224\u5B9A\u547D\u4E2D\u540E\uFF0C\u5BF9\u5B9E\u9645\u627F\u4F24\u8005\u89E6\u53D1\uFF0C\u82E5\u4E0D\u5E0C\u671B\u8C41\u514D\u6210\u529F\u65F6\u89E6\u53D1\u5219\u52A0 saved=false\u3002on_damaged \u4E3A\u5B9E\u9645\u6263\u8840\u540E\uFF0C\u53EF\u8BFB attacker\u3001\u4F24\u5BB3\u91CF\u548C melee \u7B49\u6807\u7B7E\u3002on_kill \u4E3A\u51FB\u5012\u654C\u4EBA\uFF0Con_death \u4E3A\u81EA\u8EAB\u6B7B\u4EA1\uFF0Con_ally_death \u4E3A\u961F\u53CB\u6B7B\u4EA1\uFF08\u4E8B\u4EF6\u76EE\u6807\u4E3A\u5012\u4E0B\u7684\u961F\u53CB\uFF09\u3002on_turn_start / on_turn_end \u5BF9\u5E94\u81EA\u8EAB\u56DE\u5408\u3002on_skill_cast \u4E3A\u6280\u80FD\u91CA\u653E\uFF0C\u7ED3\u7B97\u4E3B\u51FB\u524D\u3002on_equip \u88C5\u5907\u540C\u6B65\u65F6\u89E6\u53D1\uFF0C\u9ED8\u8BA4\u6BCF\u6218\u4E00\u6B21\u3002on_heal \u4E3A\u53D1\u51FA\u6CBB\u7597\u540E\uFF0C\u53EF\u8BFB\u6CBB\u7597\u91CF\u3002active \u4E3A\u6280\u80FD\u4E3B\u52A8\u53D1\u52A8\uFF0C\u5199\u5728\u88C5\u5907\u4E0A\u65F6\u72EC\u7ACB\u751F\u6210\u6309\u94AE\uFF0C\u9ED8\u8BA4 1AP \u548C action \u69FD\u3002usesPerBattle \u53EF\u7528 null \u8868\u793A\u65E0\u663E\u5F0F\u4E0A\u9650\uFF0Ccooldown \u4EE5\u6218\u6597\u8F6E\u8BA1\u3002params.source=weapon \u8868\u793A\u53EA\u5728\u672C\u6B21\u4F7F\u7528\u8BE5\u88C5\u5907\u5B9E\u4F8B\u65F6\u751F\u6548\u3002

IF\uFF1A\u6570\u7EC4\u7B49\u4EF7\u4E8E AND\uFF0Cor \u4EFB\u4E00\u6210\u7ACB\u3001not \u53D6\u53CD\u3002self \u4E3A\u53D7\u76CA\u8005\u65F6\uFF0C\u76EE\u6807\u6761\u4EF6\u4F18\u5148\u68C0\u67E5\u5F53\u524D\u653B\u51FB\u6216\u6280\u80FD\u5BF9\u8C61\u3002targetHasCategory \u7684 negative \u6307 debuff/dot/control\uFF0Cnone \u6307\u65E0\u4E09\u7C7B\u8D1F\u9762\u72B6\u6001\u3002timeOfDay \u6765\u81EA <tp>\uFF0CtargetLevel \u4E0E\u81EA\u8EAB\u6BD4\u8F83\u3002\u5E03\u5C14\u6761\u4EF6\u7701\u7565 value \u7B49\u540C true\u3002weaponType\u3001skillSchool\u3001\u6807\u7B7E\u53CA\u7269\u79CD\u5B57\u7B26\u4E32\u4E0E\u5FEB\u7167\u4E00\u81F4\u3002
\u2022 ${condition2.oneOf.map((rule) => rule.type === "array" ? describe(rule) : `${rule.properties.type.const} ${fields2(rule, ["type"])}`).join("\n\u2022 ")}

ROLL\uFF1A\u65E0 roll \u65F6\u4E00\u5B9A\u5C1D\u8BD5\u3002chance \u76F4\u63A5\u7528 0\u20261 \u6BD4\u4F8B\uFF0Cd20 \u6BD4\u8F83 >= gte\u3002save \u53D6\u76EE\u6807 d20+\u5C5E\u6027\uFF0C\u8FBE\u5230 dc \u5219\u901A\u8FC7\u5E76\u8DF3\u8FC7\u8282\u70B9\u3002save \u6570\u7EC4\u5FC5\u987B\u63D0\u4F9B mode\uFF0C\u6210\u5458\u552F\u4E00\uFF0C\u6BCF\u9879\u72EC\u7ACB\u63B7\u9AB0\u3002contest \u7684\u653B\u65B9 d20+attacker \u51CF\u5B88\u65B9 d20+defender \u8FBE\u5230 dc \u65F6\u6267\u884C\u8282\u70B9\u3002\u8C41\u514D\u6216\u5BF9\u6297\u53EF\u540C\u65F6\u63D0\u4F9B chance \u4F5C\u4E3A\u524D\u7F6E\u6982\u7387\u95E8\u3002dc \u4E0E\u6280\u80FD saveDC \u5747\u652F\u6301\u516C\u5F0F\uFF0C\u89C1\u4E0A\u8282\u6570\u503C\u534F\u8BAE\u3002

\u751F\u547D\u5468\u671F\uFF1A\u72B6\u6001\u6A21\u677F\u548C grantStatus \u8282\u70B9\u5747\u53EF\u58F0\u660E expireOn = ${describe(expireOn)}\u3002\u4EFB\u4E00\u89C4\u5219\u5339\u914D\u5C31\u7ACB\u5373\u79FB\u9664\u5E76\u8BB0\u5F55\u539F\u56E0\u3002on_damaged \u53EA\u5728\u5B9E\u9645\u6263 HP \u65F6\u5339\u914D\uFF1B\u7F3A\u7701\u6216 any \u5339\u914D\u5168\u90E8\uFF0Cdirect \u5339\u914D\u4E3B\u51FB\u6216\u4E3B\u52A8\u547D\u4E2D\u7684\u4F24\u5BB3\uFF0Cindirect \u5339\u914D\u5468\u671F\u3001\u53CD\u4F24\u53CA\u73AF\u5883\u7B49\u975E\u76F4\u63A5\u4F24\u5BB3\u3002on_heal \u5728\u6301\u6709\u8005\u5B9E\u9645\u6062\u590D HP \u65F6\u5339\u914D\uFF1B\u56DE\u5408\u4E8B\u4EF6\u5728\u5468\u671F\u7ED3\u7B97\u524D\u6253\u65AD\u3002exceptSource:self \u6392\u9664\u6765\u6E90\u4E3A\u72B6\u6001\u6301\u6709\u8005\u7684\u4E8B\u4EF6\u3002\u6388\u4E88\u8282\u70B9\u7684\u89C4\u5219\u4F18\u5148\uFF0C\u5176\u6B21\u4FDD\u7559\u5B9E\u4F8B\u89C4\u5219\uFF0C\u6700\u540E\u4F7F\u7528\u6A21\u677F\u89C4\u5219\u3002patchStatus \u53EF\u8986\u76D6\u5B9E\u4F8B expireOn\uFF0C\u4F20 null \u5173\u95ED\u3002
\u6548\u679C\u5F00\u5173\uFF1A\u6BCF\u4E2A\u8282\u70B9\u53EF\u5199 enabled:true \u6216 enabled:false\uFF0C\u7F3A\u7701\u89C6\u4E3A true\u3002false \u8DF3\u8FC7\u8BE5\u8282\u70B9\uFF08\u5982\u679C\u662F chainEffect\uFF0C\u4E5F\u8DF3\u8FC7\u5176\u5B50\u8282\u70B9\uFF09\uFF0C\u5176\u4ED6\u8282\u70B9\u7167\u5E38\u7ED3\u7B97\u3002\u5267\u60C5/\u8BED\u4E49\u5224\u65AD\u7531\u6A21\u578B\u81EA\u884C\u51B3\u5B9A\uFF0C\u901A\u8FC7 enabled \u5F00\u5173\u8868\u8FBE\uFF0C\u5F15\u64CE\u4E0D\u505A\u6761\u4EF6\u6C42\u503C\u3002\u5DF2\u7ED3\u7B97\u7684\u7ED3\u679C\u6309\u5404\u81EA\u7684\u89C4\u5219\u7EE7\u7EED\u5904\u7406\u3002\u9632\u5FA1\u8282\u70B9 modifyStat(stat:defense) \u4FEE\u6B63\u62A4\u7532\u7ED3\u7B97\uFF0Ccondition:intercepting \u5C06\u5176\u9650\u5236\u5728\u66FF\u961F\u53CB\u627F\u4F24\u65F6\u3002

TARGET\uFF1Aself \u81EA\u8EAB\uFF0ChitTarget \u5F53\u524D\u547D\u4E2D\u6216\u9009\u4E2D\u7684\u5355\u4F4D\uFF0Cattacker \u653B\u51FB\u8005\uFF0CkilledUnit \u88AB\u51FB\u5012\u5355\u4F4D\uFF0Ccorpse \u672A\u88AB\u6D88\u8017\u7684\u5C38\u4F53\u3002enemiesInRadius / alliesInRadius \u4F7F\u7528 params.radius \u6216\u8282\u70B9 radius\uFF08\u9ED8\u8BA41\u683C\uFF09\uFF0C\u65BD\u6CD5\u8303\u56F4\u5185\u4ECE\u8986\u76D6\u683C\u7B5B\u9009\u3002\u8282\u70B9\u53EF\u8986\u5199\u76EE\u6807\u3002\u5C38\u4F53\u4E0D\u4F1A\u963B\u6321\u79FB\u52A8\uFF0CraiseDead \u4F1A\u6D88\u8017\u5C38\u4F53\u3002

DO / WITH\uFF1A\u8282\u70B9\u6309\u6570\u7EC4\u987A\u5E8F\u6267\u884C\uFF0C\u6BCF\u4E2A\u8282\u70B9\u5747\u53EF\u52A0 label\u3001target\u3001condition \u548C radius\uFF080\u202615\uFF09\u3002
\u2022 ${node2.oneOf.map((rule) => `${rule.properties.kind.const} ${fields2(rule, ["kind", "enabled", "label", "target", "condition", "radius"])}`).join("\n\u2022 ")}

\u975E\u81F4\u547D\uFF1Adamage \u8282\u70B9 lethal \u9ED8\u8BA4\u4E3A true\u3002lethal:false \u53EA\u4FDD\u62A4\u8BE5\u8282\u70B9\u7684\u5B9E\u9645\u627F\u4F24\u8005\uFF0C\u5141\u8BB8\u7EC4\u5408 resourceMultiplier\u3001strikeBonus\uFF1B\u62B5\u6263\u7ED3\u7B97\u540E\u6700\u4F4E\u7559 1 HP\u3002\u627F\u4F24\u5355\u4F4D nonLethal:true \u6216\u5176\u72B6\u6001 modifiers.preserveLife:true \u4E5F\u4FDD\u547D\uFF0Clethal:true \u4E0D\u80FD\u7ED5\u5F00\u3002\u500D\u7387\u4E0D\u80FD\u4FDD\u8BC1\u4E0D\u81F4\u6B7B\u3002\u72EC\u7ACB\u7684\u4E3B\u51FB\u548C\u5176\u4ED6\u4F24\u5BB3\u8282\u70B9\u4E0D\u81EA\u52A8\u7EE7\u627F\u6B64\u5F00\u5173\u3002
\u6570\u503C\u4E0E\u7ED3\u7B97\uFF1Aamount/flat \u662F\u7EDD\u5BF9\u91CF\u3002\u767E\u5206\u6BD4\u4EE5\u5C0F\u6570\u8868\u793A\u3002percentOfPrevious \u8BFB\u53D6\u94FE\u5185\u4E0A\u4E00\u6570\u503C\u8282\u70B9\u7684\u5B9E\u9645\u7ED3\u679C\uFF0CpercentOfDamageDealt \u8BFB\u53D6\u672C\u6B21\u5B9E\u9645\u6263\u8840\uFF0CpercentOfPower \u4E58\u6280\u80FD\u57FA\u7840\u5A01\u529B\uFF0CpercentOfHealing \u8BFB\u53D6\u6CBB\u7597\u7ECF\u52A0\u6210\u540E\u7684\u91CF\u3002levelScaling.perLevel \u4ECE 1 \u9636\u57FA\u51C6\u6BCF\u9636\u589E\u957F\uFF0Cmin/max \u5219\u5728 1\u20267 \u9636\u7EBF\u6027\u63D2\u503C\u3002resourceScale \u8BFB\u53D6\u5B58\u91CF\uFF0C\u53EF\u7528 unitSize \u5411\u4E0B\u53D6\u6574\u5206\u7EC4\u3002multiplyDamage \u7684 factor \u662F\u603B\u7CFB\u6570\uFF08+12% \u5199 1.12\uFF09\uFF0Cadditive=true \u5408\u5E76\u5404\u7CFB\u6570\u76F8\u5BF9 1 \u7684\u589E\u91CF\u3002\u4E3B\u51FB\u4E58\u533A\u4F7F\u7528 passive/on_attack/on_skill_cast\u3002modifyDamageBase \u66FF\u6362\u8D77\u4F24\uFF0CignoreAttributes \u7F3A\u7701\u4E3A true\uFF0Cunscaled \u8DF3\u8FC7\u8BC4\u7EA7\u548C\u59FF\u6001\u7B49\u653B\u51FB\u500D\u7387\u3002forceOutcome \u4FDD\u969C\u547D\u4E2D\u6216\u66B4\u51FB\uFF0CupgradeHitTier \u63D0\u9AD8\u5DF2\u547D\u4E2D\u7684\u8BC4\u7EA7\u3002modifyCheck \u7684\u5404\u9879\u5206\u522B\u670D\u52A1\u4E8E\u5148\u653B\u3001\u95EA\u907F\u3001\u6F5C\u884C\u3001\u547D\u4E2D\u3001\u6838\u5FC3\u610F\u56FE\u3001\u9AD8\u5730\u548C\u4F18\u52BF\u3002teleportBackstab \u6821\u9A8C\u80CC\u540E\u7A7A\u683C\u518D\u79FB\u52A8\uFF0C\u63D0\u4F9B\u4F18\u52BF\u548C\u4F24\u5BB3\u500D\u7387\u3002knockback \u78B0\u649E\u9ED8\u8BA4\u4F24\u5BB3 5 \u5E76\u7729\u6655\u3002
\u8D44\u6E90\uFF1Ahp/mp/sp/ap \u548C attack/action \u4E3A\u5185\u7F6E\u8D44\u6E90\u3002\u5176\u4ED6\u8D44\u6E90\u53EF\u5B58\u4E8E\u5355\u4F4D\uFF0C\u6216\u7531 passive/self \u7684 produceResource(cap,initial) \u58F0\u660E\u4E3A\u88C5\u5907\u5B9E\u4F8B\u8BA1\u6570\uFF0Citems.counters \u5FC5\u987B\u4E0E\u8D44\u6E90\u58F0\u660E\u76F8\u7B26\u3002local=true \u53EA\u8BBF\u95EE\u8BE5\u88C5\u5907\u81EA\u5DF1\u7684\u6C60\u3002reloadable \u58F0\u660E\u53EF\u88C5\u586B\u8D44\u6E90\uFF0C\u914D on_attack \u7684 drainResource \u6D88\u8017\u3002\u65E0\u9650\u5F39\u836F\u662F\u72B6\u6001 infinite_ammo\uFF0C\u6D88\u8017\u6761\u4EF6\u53EF\u7528 selfStatusModifier(key=infiniteAmmo,value=false)\u3002requireFull \u4F59\u989D\u4E0D\u8DB3\u65F6\u505C\u6B62\u5F53\u524D\u8282\u70B9\u5217\u8868\uFF0CminimumRemaining \u8BBE\u7F6E\u6700\u4F4E\u4FDD\u7559\u91CF\u3002\u6280\u80FD resourceCost \u5728\u65BD\u653E\u524D\u6263\u9664\uFF0CpercentPerCost \u6309\u82B1\u8D39\u6062\u590D\u3002execute \u7684 strict \u9009\u62E9\u4E25\u683C\u4F4E\u4E8E\u9608\u503C\uFF0CrequiresPool \u68C0\u67E5\u6307\u5B9A\u88C5\u5907\u6C60\u3002stopOnFailure \u94FE\u4F1A\u5728\u9996\u4E2A\u672A\u4EA7\u751F\u6548\u679C\u7684\u8282\u70B9\u505C\u6B62\u3002
\u8D44\u6E90\u65B9\u6848\uFF1A\u5148\u5728\u6301\u6709\u88C5\u5907 effects \u52A0\u4E00\u6761 passive/self \u8868\u8FBE\u5F0F\uFF0C\u8282\u70B9 produceResource \u5199 resource\u3001cap \u548C initial\uFF1B\u540C\u6279\u5411\u5BF9\u5E94\u5B9E\u4F8B /items/<id>/counters/<resource> \u6DFB\u52A0\u521D\u503C\u3002\u53EA\u5199\u5B9E\u4F8B\u8BA1\u6570\u4F1A\u88AB\u62D2\u7EDD\u3002\u65A9\u6740\u6280\u80FD\u5148 execute\uFF0C\u6210\u529F\u540E\u5728\u540C\u94FE\u5BF9 self \u4F7F\u7528 produceResource(targetTierBase)\uFF0C\u8BE5\u6570\u503C\u6309\u76EE\u6807\u9636\u7EA7\u8BA1\u7B97\u3002\u81EA\u7528\u6280\u80FD\u8BBE target=self\u3001range=0\uFF0C\u901A\u8FC7\u6A21\u677F resourceCost \u6263\u88C5\u5907\u8D44\u6E90\uFF0C\u6062\u590D\u5404\u9879\u7528 restoreResource \u7684 percentPerCost\u3002\u88C5\u5907\u6210\u957F\u53EF\u5206\u522B\u653E\u4E94\u4E2A\u57FA\u7840\u5C5E\u6027\u8282\u70B9\uFF0C\u6216\u5BF9\u4F24\u5BB3\u7528 modifyStat(stat=damage)\uFF0C\u7528 percent=1 \u4E0E levelScaling:{min,max} \u8868\u793A\u6210\u957F\u6BD4\u4F8B\u8303\u56F4\u3002\u68C0\u5B9A\u52A0\u503C\u7528 modifyCheck\uFF0C\u7BAD\u77E2\u4E0E\u4E00\u822C\u8FDC\u7A0B\u5206\u522B\u7528 arrow=true \u4E0E melee=false\u3002
\u72B6\u6001\uFF1AgrantStatus \u4F7F\u7528\u5DF2\u6709 ID\uFF0C\u82E5\u9700\u81EA\u5B9A\u4E49\u5148\u5B9A\u4E49 statusTemplates\u3002modifiers \u53EA\u53EF\u8986\u76D6\u6A21\u677F\u5DF2\u6709\u952E\u3002amount \u4EC5\u7528\u4E8E shield \u72B6\u6001\uFF0C\u8303\u56F4 1\u202610000\u3002removeStatus \u5FC5\u987B\u9009 statusId \u6216 category \u4E4B\u4E00\uFF0Call_negative \u6E05\u9664\u975E\u6C38\u4E45 debuff/dot/control\u3002procEffect \u901A\u8FC7 ref \u67E5\u627E\u5DF2\u5B9A\u4E49\u8868\u8FBE\u5F0F\u5E76\u6267\u884C\uFF0C\u5176\u81EA\u8EAB\u95E8\u69DB\u4ECD\u6709\u6548\uFF0C\u7981\u6B62\u5FAA\u73AF\u5F15\u7528\u3002addItem \u6309\u7269\u54C1 ID \u589E\u52A0\u5355\u4F4D\u5E93\u5B58\u3002`;

// src/tavern/engine-summary.js
var PROTOCOL_RULES = `\u3010\u5224\u5B9A\uFF5Cprotocol \u5B9E\u6218\u3011
\u5148\u653B\uFF1Dagi\xD7(1+initiativePercent)+d20+max(0,...attackInit)+max(0,...actionInit)+flatInitiative\uFF1B\u603B\u5206\u964D\u5E8F\uFF0C\u540C\u5206\u5148\u6BD4\u654F\u6377\uFF0C\u518D\u6309 ID \u5347\u5E8F\u3002
\u666E\u901A\u653B\u51FB\u6309\u6240\u53D6 d20+accuracy \u5206\u6863\uFF08\u4E0B\u9650\u542B\u7B49\u53F7\uFF09\uFF1A<4 \u5931\u624B\xD70\uFF0C4 \u64E6\u4F24\xD70.3\uFF0C8 \u52C9\u5F3A\xD70.8\uFF0C11 \u6709\u6548\xD71\uFF0C20 \u5E73\u66B4\u51FB\xD71.3\uFF0C25 \u5F3A\u66B4\u51FB\xD71.6\uFF0C30 \u8D85\u66B4\u51FB\xD72\u3002\u81EA\u71361\u5FC5\u5931\uFF1B\u81EA\u713620\u6807\u8BB0 critical\uFF0C\u4F46\u4ECD\u987B\u603B\u5206\u22654\u3002\u5B9E\u6218\u4E0D\u4EE5\u9884\u89C8 defense \u4E3A\u547D\u4E2D\u95E8\u69DB\uFF1Battack \u662F\u4F24\u5BB3\uFF0C\u4E0D\u662F accuracy\u3002\u65E0\u9ED8\u8BA4\u529B/\u654F\u547D\u4E2D\u6216\u654F\u6377\u9632\u5FA1\u3002\u901A\u5E38\u51C0\u4F18\u52BF/\u52A3\u52BF\u63B72\u53D6\u9AD8/\u4F4E\uFF1B\u534F\u8BAE\u5956\u52B1\u9AB00~2\u3001\u60E9\u7F5A\u9AB00~1\uFF0C\u76F8\u7B49\u53D61\u9AB0\uFF0C\u5956\u52B1\u5360\u4F18\u4E14\u67092\u5956\u52B1\u53D63\u9AB0\u4E2D\u4F4D\u3002
\u5C04\u7A0B\u53D6\u4E09\u7EF4\u6B27\u6C0F\u8DDD\u79BB\uFF1B\u547D\u4E2D\u8BA1\u4F53\u578B(max(0,size\u22121)\uFF0Clarge+2\uFF0Csmall\u22121)\u3001\u9AD8\u5DEE\u3001\u8DDD\u79BB\u3001\u5C04\u7A0B\u3001\u72B6\u6001\u3001\u5939\u51FB\u3001\u63A9\u4F53\u3002

\u3010\u610F\u56FE\uFF5C\u96BE\u5EA6/\u6210\u529F\u500D\u7387\u3011normal \u5E38\u89C40/1\uFF0Cfunction \u673A\u80FD\u9650\u52365/1.1\uFF0Ccore \u6838\u5FC3\u8981\u5BB310/1.4\uFF0Ckill \u62B9\u674015/1.7\uFF0Cconcept \u6982\u5FF5\u7834\u788E20/2\u3002\u8303\u56F4\u653B\u51FB\u5BF9\u5355\u4F4D\u56FA\u5B9A\u5E38\u89C4\u3002\u547D\u4E2D\u540E\uFF0C\u96BE\u5EA6\u53D6max(0,\u57FA\u7840+\u5B88\u65B9intentDifficulty)\uFF0C\u4E3A0\u76F4\u63A5\u6210\u7ACB\uFF1B\u5426\u5219\u653B\u6BD4\u5B88\u4F4E\u22652\u7EA7\u5FC5\u8D25\u3002\u653B\u9636\xD75+\u539F\u653B\u51FB\u9AB0+\u8BC4\u7EA7\u5956\uFF08\u5E73/\u5F3A/\u8D85\u66B4\u51FB+10/20/30\uFF09\u2265\u5B88\u9636\xD75+\u5B88d20+\u96BE\u5EA6\u624D\u6210\u7ACB\uFF1B\u5931\u8D25\u4FDD\u7559\u539F\u547D\u4E2D\uFF0C\u610F\u56FE\u500D\u7387\u56DE\u52301\u3002\u81EA\u52A8\u547D\u4E2D\u53CA\u8C41\u514D\u5206\u652F\u4E0D\u4F5C\u8BE5\u5BF9\u6297\u3002

\u3010\u4F24\u5BB3\uFF5C\u8BA1\u7B97\u51FD\u6570\u4E0E\u5B9E\u6218\u4E0D\u53EF\u6DF7\u7528\u3011
\u534F\u8BAE\u8D77\u4F24\uFF1D\u5173\u8054\u5C5E\u6027\uFF08damage.stat\uFF0C\u7F3A\u7701\u8FD1\u6218str\u3001\u5426\u5219int\uFF09\xD710\xD7\u5C42\u7EA7\u7CFB\u6570(1~7\u9636:2/2.8/4/8/15/35/80)+power(\u9ED8\u8BA420)+\u6B66\u5668attack(\u9ED8\u8BA40)\u3002\u5B9E\u6218\u4E3B\u51FB\u4E58\u653B\u51FB\u589E\u76CA\u3001\u4F53\u578B\u500D\u7387\uFF08\u6B64\u5904\u4E0D\u9650\u8FD1\u6218\uFF09\u3001\u8BC4\u7EA7\u3001\u6210\u529F\u610F\u56FE\u3001\u59FF\u6001/\u526F\u624B\u7CFB\u6570\u3001\u8C41\u514D\u6210\u529F\xD70.5\uFF0C\u518D\u5411\u4E0B\u53D6\u6574\u3002\u8C41\u514D\u4E3A\u5B88d20+\u6307\u5B9A\u5C5E\u6027\u2265saveDC\uFF08\u9ED8\u8BA412+floor(\u653Bint/2)\uFF09\uFF0C\u6210\u529F\u514D\u9664\u8BE5\u6B21\u9644\u5E26\u6548\u679C\u3002
\u5C5E\u6027\u51CF\u4F24\uFF1Aphysical=(con+str+agi)\xD7.0025\uFF0Cenergy=(spi+int)\xD7.004\uFF0Cmental=spi\xD7.008\uFF0Ctrue=0\u3002
\u5B9E\u6218\u547D\u4E2D\u8D70\u53E6\u4E00\u7BA1\u7EBF\uFF1A\u53EF\u63F4\u62A4\u66FF\u4F24\u3001\u8FD1\u6218\u91CD\u5251\u5F39\u53CD\uFF1B\u6709\u6548\u7532=max(0,\u603B\u7532\xD7(1\u2212\u767E\u5206\u6BD4\u7A7F\u900F)\u2212\u56FA\u5B9A\u7A7F\u900F)\uFF0C\u7269\u7406\u5168\u7532\u3001\u80FD\u91CF\u534A\u7532\u3001\u5176\u4F590\u3002\u4E58(1+\u788E\u51B0\u52A0\u6210)(1+\u6613\u4F24)(1\u2212\u72B6\u6001\u603B\u51CF\u4F24[0,1])\u3001\u62A4\u7532\u500D\u7387\u548C(1\u2212\u5C5E\u6027\u51CF\u4F24)\uFF0C\u5411\u4E0B\u53D6\u6574\u4E14\u4E0D\u4F4E\u4E8E0\uFF1B\u62A4\u76FE\u5148\u5438\u6536\uFF0C\u4F59\u91CF\u6263HP\u3002\u6301\u7EED\u4F24\u7B49\u975E\u547D\u4E2D\u7C7B\u4F24\u5BB3\u6309\u500D\u7387\u53D6\u6574\u51CF\u6709\u6548\u7532\u3002DSL \u56FA\u5B9A\u51CF\u4F24\u5148\u4E8E\u62A4\u76FE\uFF1BnonLethal \u4FDD\u5E95 1 HP\u3002
\u8303\u56F4\u6280\u80FD\u6309\u8986\u76D6\u683C\u9010\u76EE\u6807\u7ED3\u7B97\u3002

\u3010\u59FF\u6001\u3011\u76FE\u2192\u5251\u76FE\uFF1B\u6D88\u8017/\u8F85\u52A9\u526F\u624B\u2192\u540C\u8C03\uFF1B\u91CD\u578B/\u53CC\u624B\u4E3B\u624B\u2192\u91CD\u5251\uFF1B\u5176\u4ED6\u526F\u624B\u2192\u53CC\u6301\uFF1B\u4EC5\u4E3B\u624B\u2192\u8F7B\u5251\uFF1B\u7A7A\u624B\u2192\u65E0\u68B0\u3002\u59FF\u6001\u51B3\u5B9A\u7A7F\u7532\u3001\u8FFD\u51FB\u3001\u5F39\u53CD\u548C\u683C\u6321\u3002

\u3010\u58EB\u6C14\u4E0E\u9003\u8DD1\u3011\u6362\u8F6E\u68C0\u67E5\u58EB\u6C14\u3002\u4E3B\u52A8flee\u4EE5\u81EA\u8EAB\u654F+d20\u5BF9\u5B58\u6D3B\u654C\u65B9\u6700\u9AD8\u654F+d20\uFF0C\u5E73\u624B\u53EF\u9003\u3002`;
var ENGINE_API_SUMMARY = `${PROTOCOL_RULES}

\u3010API \u6620\u5C04\u3011
\u72B6\u6001\u5148\u67E5 STATUSES\uFF0C\u518D\u67E5 statusTemplates\uFF1B\u62D2\u7EDD\u672A\u77E5 ID\u3002\u81EA\u5B9A\u4E49\u63A7\u5236\u72B6\u6001\u53EF\u7528 modifiers:{skip:true} \u8DF3\u8FC7\u884C\u52A8\u3002
\u6280\u80FD saveDC\u3001DSL roll.dc \u548C roll.contest.dc \u4F7F\u7528\u540C\u4E00\u89C4\u5219\u3002\u53EF\u4F20 1\u202650 \u7684\u6574\u6570\uFF0C\u6216 {base:6,scaleBy:{stat:'spi',perUnit:0.5},min:1,max:50}\u3002stat \u53EA\u80FD\u4E3A str/con/agi/int/spi\u3002base \u4E0E perUnit \u53EF\u4E3A\u5C0F\u6570\u6216\u8D1F\u6570\uFF0C\u8303\u56F4 \u22121e9\u20261e9\u3002\u8BA1\u7B97\u4E3A base + perUnit \xD7 \u65BD\u672F\u8005\u5F53\u524D\u751F\u6548\u5C5E\u6027\uFF0C\u4FDD\u7559\u5C0F\u6570\u5E76 clamp \u5230 min/max\uFF0C\u7F3A\u7701 1/50\u3002\u663E\u5F0F\u4E0A\u4E0B\u9650\u4E3A 1\u20261e9 \u7684\u6570\u503C\uFF0Cmin \u4E0D\u5F97\u9AD8\u4E8E max\u3002
\u88C5\u5907\u6A21\u677F equipment \u4E0E\u5B9E\u4F8B items \u7528 templateId \u5173\u8054\uFF1B\u8BA1\u6570\u5728\u5B9E\u4F8B counters\u3002

\u88C5\u5907\u4E0E\u6280\u80FD\u7EDF\u4E00\u4F7F\u7528\u6548\u679C DSL\u3002\u5916\u5C42\u58F0\u660E\u89E6\u53D1\u3001\u6761\u4EF6\u3001\u68C0\u5B9A\u3001\u76EE\u6807\u4E0E\u8282\u70B9\u5217\u8868\u3002\u5B9E\u4F8B\u8BA1\u6570\u7531\u88C5\u5907\u7684\u8D44\u6E90\u58F0\u660E\u51B3\u5B9A\u3002\u5B8C\u6574 DSL \u534F\u8BAE\u89C1\u4E0B\u8282\u3002
\u81EA\u5B9A\u4E49 statusTemplates \u989D\u5916\u652F\u6301 dodgeBonus(\u221230\u202630)\u3001attackPercent / attributePercent(\u22121\u20264)\u3001finalDamageMultiplier(0\u20268\uFF0C\u51CF\u4F24\u540E\u62A4\u76FE\u524D\u72EC\u7ACB\u4E58\u533A)\u3001guaranteed_hit / guaranteed_crit / blockResourceRestore / preserveLife(\u5E03\u5C14)\u3002\u4E00\u56DE\u5408 battle_turns \u6A21\u677F\u53EF\u52A0 expireInto \u6307\u5DF2\u5B9A\u4E49\u72B6\u6001\uFF0C\u81EA\u5DF1\u65BD\u52A0\u65F6\u672C\u56DE\u5408\u672B\u5230\u671F\uFF0C\u6218\u6597\u672A\u7ED3\u675F\u624D\u7EED\u63A5\u3002\u5148\u5B9A\u4E49\u7EED\u63A5\u72B6\u6001\uFF0C\u518D\u5B9A\u4E49\u524D\u7F6E\u72B6\u6001\u3002

\u3010\u72B6\u6001\u6570\u503C\u8986\u76D6\u3011
\u6A21\u677F\u6570\u503C\u662F\u9ED8\u8BA4\u503C\u3002grantStatus \u8282\u70B9\u53EF\u7528 modifiers \u8986\u76D6\u6A21\u677F\u5DF2\u6709\u952E\uFF0C\u6309\u72B6\u6001\u76EE\u5F55\u8303\u56F4\u6821\u9A8C\u3002DoT/HoT \u6BCF\u6B21\u7ED3\u7B97\u53D6\u5B9E\u4F8B\u503C\u4E58\u5C42\u6570\u3002
\u516C\u5F00 API\uFF1AdefineStatus(state,id,template) \u6CE8\u518C\u6218\u5C40\u81EA\u5B9A\u4E49\u6A21\u677F\uFF0C\u4E0D\u80FD\u8986\u76D6\u5DF2\u6709 ID\u3002patchStatus(state,unitId,statusId,{damage:12}) \u66F4\u65B0\u5DF2\u9644\u52A0\u5B9E\u4F8B\u5E76\u5199\u5165\u65E5\u5FD7\u3002statusModifierKeys(statusId,state?) \u67E5\u8BE2\u5408\u6CD5\u952E\u3002GameAPI \u5BF9\u5E94\u7684\u65E0 state \u65B9\u6CD5\u652F\u6301\u8FD0\u884C\u4E2D\u7684\u6218\u5C40\u3002
\u81EA\u5B9A\u4E49 modifiers \u57FA\u7840\u952E\uFF1A\u6574\u6570 damage/heal/reflect(1\u2026100000)\u3001armor(\u2212100000\u2026100000\uFF0C\u8986\u76D6\u987B\u4FDD\u6301\u65B9\u5411)\u3001movement(\u22123\u20263)\u3001accuracy/incomingAccuracy(\u221210\u202610)\u3001advantage/disadvantage(1\u20263)\uFF1Breduction/vulnerability(0\u20261)\u3002damageType \u968F damage\uFF0C\u53D6 physical/energy/mental/true\u3002`;

// src/tavern/status-catalog.js
var STATUS_CATALOG = `\u72B6\u6001 ID\uFF1A\u5185\u7F6E\u4EC5\u4EE5\u4E0B\u5404\u884C\uFF1B\u5176\u4ED6 ID \u5FC5\u987B\u5148\u5728 statusTemplates \u6CE8\u518C\u5E76\u901A\u8FC7\u6821\u9A8C\uFF0C\u4E0D\u53EF\u8986\u76D6\u5185\u7F6E\u3002
ID | \u56FE\u6807\u4E2D\u6587\u540D | \u7C7B\u522B | \u9ED8\u8BA4\u6301\u7EED\uFF08battle_turns\uFF0C\u81EA\u8EAB\u56DE\u5408\u6570\uFF09 | \u9ED8\u8BA4\u6570\u503C\uFF08\u53EF\u88AB\u6280\u80FD/\u88C5\u5907/API \u8986\u76D6\uFF0C\u62EC\u53F7\u5185\u4E3A\u5408\u6CD5\u8303\u56F4\uFF09 | \u91CD\u590D\u65BD\u52A0\u89C4\u5219/\u6A21\u677F\u5C42\u6570\u4E0A\u9650
\u4EE5\u4E0B\u6570\u503C\u5747\u4E3A\u6A21\u677F\u9ED8\u8BA4\u503C\u3002\u6280\u80FD\u3001\u88C5\u5907\u4E0E API \u53EF\u5728\u65BD\u52A0\u65F6\u8986\u76D6\uFF08\u89C1 modifiers \u53C2\u6570\uFF09\uFF0C\u4E0D\u5F71\u54CD\u6A21\u677F\u672C\u8EAB\u3002\u8BBE\u8BA1\u6280\u80FD\u65F6\u5E94\u6309\u6280\u80FD\u81EA\u5DF1\u7684\u5F3A\u5EA6\u8BBE\u5B9A\u6570\u503C\u3002
burn | \u{1F525}\u707C\u70E7 | dot | 2 | \u56DE\u5408\u521D\u53D7\u5230\u706B\u7130\u80FD\u91CF\u4F24\u5BB3\u3002 \u9ED8\u8BA4 damage=5\uFF081\u2013100000\uFF09\uFF0CdamageType=energy\uFF08physical/energy/mental/true\uFF09 | refresh/1
bleed | \u{1FA78}\u6D41\u8840 | dot | 3 | \u56DE\u5408\u672B\u6BCF\u5C42\u7ED3\u7B97\u4E00\u6B21\u4F24\u5BB3\u3002 \u9ED8\u8BA4 damage=3\uFF081\u2013100000\uFF09\uFF0CdamageType=true\uFF08physical/energy/mental/true\uFF09 | stack/5
poison | \u2620\uFE0F\u4E2D\u6BD2 | dot | 3 | \u56DE\u5408\u521D\u6BCF\u5C42\u7ED3\u7B97\u4E00\u6B21\u4F24\u5BB3\u3002 \u9ED8\u8BA4 damage=3\uFF081\u2013100000\uFF09\uFF0CdamageType=true\uFF08physical/energy/mental/true\uFF09 | stack/4
regen | \u{1F49A}\u518D\u751F | hot | 3 | \u56DE\u5408\u521D\u6062\u590D\u751F\u547D\u3002 \u9ED8\u8BA4 heal=5\uFF081\u2013100000\uFF09 | refresh/1
shield | \u{1F6E1}\uFE0F\u62A4\u76FE | shield | 2 | \u72EC\u7ACB\u5438\u6536\u4F24\u5BB3\uFF1B\u8017\u5C3D\u65F6\u7834\u88C2\u3002 \u9ED8\u8BA4 amount=8\uFF081\u2013100000\uFF09 | replace/1
guarded | \u{1F9F1}\u575A\u58C1 | buff | 1 | \u53D7\u5230\u7684\u4F24\u5BB3\u964D\u4F4E\u3002 \u9ED8\u8BA4 reduction=0.35\uFF080\u20131\uFF09 | refresh/1
taunt | \u{1F4E3}\u5632\u8BBD | control | 1 | \u53EF\u653B\u51FB\u5632\u8BBD\u6765\u6E90\u65F6\uFF0C\u8FDB\u653B\u5FC5\u987B\u6307\u5B9A\u8BE5\u6765\u6E90\u3002 \u9ED8\u8BA4 taunted=true\uFF08true/false\uFF09 | refresh/1
guard | \u{1F91D}\u63F4\u62A4 | buff | 2 | \u66FF\u76F8\u90BB\u53CB\u519B\u627F\u53D7\u4F24\u5BB3\uFF1B\u4E0D\u4F1A\u8FDE\u7EED\u8F6C\u4EA4\u3002\u4EC5\u975E\u53CD\u5E94\u6253\u51FB\uFF1B\u987B\u672A\u8DF3\u8FC7\u884C\u52A8\u3001\u9AD8\u5DEE\u22641\u4E14\u89C6\u7EBF\u901A\u7545\u3002 \u9ED8\u8BA4 intercept=true\uFF08true/false\uFF09 | refresh/1
thorns | \u{1F335}\u53CD\u4F24\u68D8\u7532 | buff | 2 | \u88AB\u8FD1\u6218\u547D\u4E2D\u65F6\uFF0C\u5BF9\u8FDB\u653B\u8005\u9020\u6210\u771F\u5B9E\u4F24\u5BB3\u3002\u4E0D\u5BF9\u53CD\u5E94\u4F24\u5BB3\u8FDE\u9501\u3002 \u9ED8\u8BA4 reflect=5\uFF081\u2013100000\uFF09 | refresh/1
stun | \u{1F4AB}\u7729\u6655 | control | 1 | \u8DF3\u8FC7\u884C\u52A8\u3002 \u9ED8\u8BA4 skip=true\uFF08true/false\uFF09 | refresh/1
freeze | \u{1F9CA}\u51B0\u51BB | control | 1 | \u8DF3\u8FC7\u884C\u52A8\uFF1B\u88AB\u6253\u51FB\u65F6\u788E\u51B0\uFF0C\u53D7\u5230\u989D\u5916\u4F24\u5BB3\u3002 \u9ED8\u8BA4 skip=true\uFF08true/false\uFF09\uFF0Cshatter=0.5\uFF080\u20131\uFF09 | refresh/1
root | \u26D3\uFE0F\u5B9A\u8EAB | control | 2 | \u65E0\u6CD5\u79FB\u52A8\u6216\u77AC\u79FB\uFF0C\u4ECD\u53EF\u653B\u51FB\u6216\u65BD\u6CD5\u3002 \u9ED8\u8BA4 rooted=true\uFF08true/false\uFF09 | refresh/1
blind | \u{1F311}\u81F4\u76F2 | debuff | 2 | \u547D\u4E2D\u68C0\u5B9A\u5E26\u52A3\u52BF\u3002 \u9ED8\u8BA4 disadvantage=1\uFF081\u20133\uFF09 | refresh/1
vulnerable | \u{1F4A2}\u6613\u4F24 | debuff | 2 | \u53D7\u5230\u7684\u4F24\u5BB3\u589E\u52A0\u3002 \u9ED8\u8BA4 vulnerability=0.35\uFF080\u20131\uFF09 | refresh/1
sunder | \u{1F528}\u7834\u7532 | debuff | 2 | \u62A4\u7532\u964D\u4F4E\u3002 \u9ED8\u8BA4 armor=-4\uFF08-100000\u2013-1\uFF09 | refresh/1
mark | \u{1F3AF}\u6807\u8BB0 | debuff | 2 | \u653B\u51FB\u6B64\u5355\u4F4D\u7684\u547D\u4E2D\u63D0\u9AD8\u3002 \u9ED8\u8BA4 incomingAccuracy=2\uFF08-10\u201310\uFF09 | refresh/1
stealth | \u{1F464}\u9690\u8EAB | buff | 2 | \u65E0\u6CD5\u88AB\u654C\u65B9\u8FDC\u8DDD\u76F4\u63A5\u9501\u5B9A\uFF1B\u53D1\u52A8\u8FDB\u653B\u6216\u906D\u653B\u51FB\u4F24\u5BB3\u65F6\u73B0\u5F62\u3002 \u9ED8\u8BA4 hidden=true\uFF08true/false\uFF09\uFF0Cadvantage=1\uFF081\u20133\uFF09 | refresh/1
haste | \u{1F4A8}\u75BE\u8D70 | buff | 2 | \u79FB\u52A8\u8DDD\u79BB\u589E\u52A0\u3002 \u9ED8\u8BA4 movement=1\uFF08-3\u20133\uFF09 | refresh/1
chill | \u2744\uFE0F\u5BD2\u51B7 | debuff | 2 | \u79FB\u52A8\u8DDD\u79BB\u548C\u547D\u4E2D\u964D\u4F4E\u3002 \u9ED8\u8BA4 movement=-1\uFF08-3\u20133\uFF09\uFF0Caccuracy=-2\uFF08-10\u201310\uFF09 | refresh/1
charge | \u26A1\u84C4\u529B | buff | 1 | \u672C\u56DE\u5408\u4E0B\u4E00\u6B21\u653B\u51FB\u589E\u4F24\u3002\u5B9E\u9645\u6301\u7EED\u671F\u95F4\u751F\u6548\uFF0C\u653B\u51FB\u4E0D\u6D88\u8017\u3002 \u9ED8\u8BA4 damageBonus=0.15\uFF080\u20131\uFF09 | refresh/1
lock_on | \u2316\u5B9A\u4F4D | buff | 1 | \u672C\u56DE\u5408\u5BF9\u9501\u5B9A\u76EE\u6807\u547D\u4E2D\u63D0\u9AD8\u3002\u5B9E\u9645\u547D\u4E2D\u52A0\u503C\u4E0D\u9650\u76EE\u6807\uFF1B\u5B9A\u4F4D\u52A8\u4F5C\u53E6\u8BB0\u671D\u5411\u76EE\u6807\u3002 \u9ED8\u8BA4 accuracy=1\uFF08-10\u201310\uFF09 | refresh/1
weakness | \u25C9\u5F31\u70B9\u8BC6\u522B | buff | 3 | \u6BCF\u5C42\u964D\u4F4E\u610F\u56FE\u96BE\u5EA6\u3002\u8BFB\u53D6\u9632\u5B88\u8005\u5C42\u6570\uFF0C\u96BE\u5EA6\u6700\u4F4E0\uFF1B\u626B\u63CF\u52A8\u4F5C\u7ED9\u81EA\u8EAB3\u5C42\u3002 \u9ED8\u8BA4 intentDifficulty=-2\uFF08-10\u201310\uFF09 | stack/3
grappled | \u26D3\u64D2\u62B1 | control | 1 | \u65E0\u6CD5\u79FB\u52A8\uFF0C\u4ECD\u53EF\u8FDB\u884C\u8FD1\u8EAB\u653B\u51FB\u3002 \u9ED8\u8BA4 rooted=true\uFF08true/false\uFF09 | refresh/1
prone | \u25BD\u5012\u5730 | debuff | 1 | \u65E0\u6CD5\u79FB\u52A8\uFF0C\u95EA\u907F\u964D\u4F4E\u3002\u653B\u51FB\u6B64\u5355\u4F4D\u83B7\u5F97 incomingAccuracy\u3002 \u9ED8\u8BA4 incomingAccuracy=2\uFF08-10\u201310\uFF09\uFF0Crooted=true\uFF08true/false\uFF09 | refresh/1
disarmed | \u2694\u7F34\u68B0 | debuff | 1 | \u65E0\u6CD5\u4F7F\u7528\u4E3B\u624B\u6B66\u5668\u3002\u4EC5\u8D34\u72B6\u6001\u4E0D\u4F1A\u5378\u6B66\u5668\uFF1B\u7F34\u68B0\u52A8\u4F5C\u53E6\u6E05\u4E3B\u624B\u548Cweapon\uFF0C\u5230\u671F\u4E0D\u81EA\u52A8\u5F52\u8FD8\u3002 \u9ED8\u8BA4 disarmed=true\uFF08true/false\uFF09 | refresh/1
infinite_ammo | \u{1F3F9}\u65E0\u9650\u5F39\u836F | buff | 1 | \u8FDC\u7A0B\u5C04\u51FB\u65E0\u9700\u88C5\u586B\uFF0C\u4E5F\u4E0D\u6D88\u8017\u5F39\u836F\u3002 \u9ED8\u8BA4 infiniteAmmo=true\uFF08true/false\uFF09 | refresh/1
\u9ED8\u8BA4 tickTiming\uFF1AonTurnStart\uFF1B\u4F8B\u5916\uFF1Ableed=onTurnEnd\u3002\u65BD\u52A0\u5F53\u56DE\u5408\u4E0D\u8DF3\u4F24/\u6CBB\u7597\u3001\u4E0D\u6263\u65F6\u957F\u3002
grantStatus\uFF1Arefresh \u91CD\u8BBE\u65F6\u957F\uFF0Creplace \u66FF\u6362\u4E0D\u7D2F\u52A0\uFF08\u62A4\u76FE\u91CD\u8BBE\u6C60\uFF09\uFF1Bstack \u7D2F\u52A0\u81F3\u4E0A\u9650\uFF0C\u672A\u6307\u5B9A\u65F6\u957F\u65F6\u53D6\u65E7\u5269\u4F59\u4E0E\u6A21\u677F\u9ED8\u8BA4\u7684\u8F83\u5927\u503C\uFF0C\u6307\u5B9A\u5219\u91CD\u8BBE\u3002
\u6821\u9A8C\u2260\u9ED8\u8BA4\uFF1AremainingTurns \u6574\u65701\u2013100\uFF1BdurationType \u53EF\u4E3A battle_turns\uFF08\u81EA\u8EAB\u56DE\u5408\u672B\u9012\u51CF\uFF09\u3001until_removed \u6216 persistent\uFF08\u540E\u4E24\u8005\u4E0D\u9012\u51CF\uFF0Cpersistent \u4E0D\u53D7 cleanse\uFF09\u3002
\u5B9E\u4F8B stacks\u3001maxStacks \u5747\u4E3A\u6574\u6570\uFF0C1\u2264stacks\u2264maxStacks\u2264\u6A21\u677F\u4E0A\u9650\uFF1B\u6280\u80FD status \u6548\u679C turns 1\u2013100\u3001stacks 1\u201310\uFF0C\u5185\u7F6E\u65BD\u52A0\u65F6\u4ECD\u622A\u81F3\u5B9E\u4F8B\u4E0A\u9650\uFF0C\u81EA\u5B9A\u4E49\u4E0D\u53EF\u8D85\u6A21\u677F\u4E0A\u9650\uFF08\u81EA\u5B9A\u4E49\u6A21\u677F maxStacks 1\u201310\uFF09\u3002
\u5B9E\u4F8B\u5C55\u793A\u5B57\u6BB5\u4E0E\u6A21\u677F\u4E00\u81F4\uFF0Cmodifiers \u952E\u96C6\u4E0E\u6A21\u677F\u4E00\u81F4\uFF0C\u503C\u53EF\u5728\u5408\u6CD5\u8303\u56F4\u5185\u53D8\u5316\u3002\u4EC5 shield \u5B9E\u4F8B\u6709 amount\uFF08\u5269\u4F59\u62A4\u76FE\u6C60\uFF09\uFF1B\u65BD\u52A0\u6216 patchStatus \u8986\u76D6 modifiers.amount \u4F1A\u8BBE\u7F6E\u62A4\u76FE\u6C60\uFF0C\u65BD\u52A0\u65F6\u65E7\u5F0F amount \u53C2\u6570\u4F18\u5148\u3002`;

// src/tavern/prompts.js
var IDENTITY = `\u4F60\u662F\u547D\u5B9A\u6218\u6597\u52A9\u624B\u3002\u4F60\u9700\u8981\u6839\u636E\u7528\u6237\u8F93\u5165\u5BF9\u6218\u5C40\u6570\u503C\u8FDB\u884C\u64CD\u4F5C\uFF0C\u4EE5\u5F53\u524D\u6218\u5C40\u3001\u53C2\u6218\u8005\u4E0E\u88C5\u5907\u5FEB\u7167\u3001\u6218\u6597\u534F\u8BAE\u4E3A\u4F9D\u636E\uFF0C\u6838\u5BF9\u64CD\u4F5C\u5BF9\u8C61\u3001\u5B57\u6BB5\u548C\u53D6\u503C\uFF0C\u4F7F\u7528\u5F15\u64CE\u8BA4\u53EF\u7684\u6807\u8BC6\u7B26\u3002

\u5F53\u300C\u5F85\u5904\u7406\u8B66\u544A\u300D\u975E\u7A7A\u65F6\uFF0C\u4F60\u5FC5\u987B\u9010\u9879\u6807\u51C6\u5316\u5176\u4E2D\u7684\u5185\u5BB9\u3002\u628A\u88C5\u5907\u3001\u6280\u80FD\u6216\u72B6\u6001\u4E2D\u4EE5\u81EA\u7136\u8BED\u8A00\u63CF\u8FF0\u7684\u6548\u679C\uFF0C\u8F6C\u6210\u5F15\u64CE\u53EF\u4F7F\u7528\u7684\u7279\u6548\uFF0C\u5E76\u5E94\u7528\u5230\u5BF9\u5E94\u7684\u89D2\u8272\u6216\u6B66\u5668\u4E0A\u3002\u82E5\u5355\u4E2A\u673A\u5236\u4E0D\u8DB3\u4EE5\u8868\u8FBE\uFF0C\u5148\u6309\u534F\u8BAE\u7EC4\u5408\u5DF2\u652F\u6301\u7684\u673A\u5236\uFF0C\u4FDD\u7559\u539F\u6548\u679C\u7684\u89E6\u53D1\u6761\u4EF6\u3001\u4F5C\u7528\u76EE\u6807\u3001\u6301\u7EED\u65F6\u95F4\u548C\u6570\u503C\u3002\u65E0\u6CD5\u5B8C\u6574\u8868\u8FBE\u65F6\uFF0C\u63D0\u4EA4\u80FD\u6267\u884C\u7684\u90E8\u5206\uFF0C\u5E76\u6309\u4EFB\u52A1\u6307\u4EE4\u6807\u660E\u4ECD\u5F85\u5904\u7406\u7684\u6548\u679C\u3002

\u4E0D\u505A\u53D9\u4E8B\u3001\u4E0D\u626E\u6F14\u89D2\u8272\u3001\u4E0D\u63A8\u8FDB\u5267\u60C5\uFF0C\u53EA\u8F93\u51FA\u5F15\u64CE\u53EF\u6267\u884C\u7684\u6570\u636E\u53D8\u66F4\u3002\u6309\u5F53\u524D\u4EFB\u52A1\u8981\u6C42\u7EC4\u7EC7\u8865\u4E01\u548C\u5F85\u5904\u7406\u9879\uFF0C\u6CBF\u7528\u5FEB\u7167\u4E2D\u7684\u89D2\u8272\u3001\u88C5\u5907\u3001\u6280\u80FD\u548C\u72B6\u6001 ID\uFF0C\u4FDD\u7559\u4E0E\u672C\u6B21\u64CD\u4F5C\u65E0\u5173\u7684\u6570\u636E\u3002\u63D0\u4EA4\u524D\u68C0\u67E5\u8DEF\u5F84\u3001\u53C2\u6570\u548C\u6570\u503C\u8303\u56F4\uFF0C\u786E\u4FDD\u6574\u6279\u53D8\u66F4\u53EF\u4EE5\u5728\u5F53\u524D\u6218\u5C40\u6267\u884C\u3002`;
var DEFAULT_SLOTS = [
  { id: "identity", label: "\u8EAB\u4EFD\u4E0E\u4EFB\u52A1\u58F0\u660E", role: "system", enabled: true, desc: "\u547D\u5B9A\u6218\u6597\u52A9\u624B\u7684\u804C\u8D23\u4E0E\u8FB9\u754C", content: IDENTITY },
  { id: "protocol", label: "\u6218\u6597\u534F\u8BAE\u4E0E\u89C4\u5219\u8BF4\u660E", role: "system", enabled: true, desc: "\u771F\u5B9E\u6218\u6597\u534F\u8BAE\u7684\u6570\u503C\u53E3\u5F84\u3001\u5224\u5B9A\u65B9\u5F0F\u3001\u8F93\u51FA\u7EA6\u675F" },
  { id: "roster", label: "\u53C2\u6218\u8005\u4E0E\u88C5\u5907\u5FEB\u7167", role: "system", enabled: true, desc: "\u5F53\u524D\u6218\u5C40\u7684\u5355\u4F4D\u3001\u88C5\u5907\u3001\u6280\u80FD\u3001\u72B6\u6001\uFF08\u542B MVU \u6765\u6E90\uFF09" },
  { id: "battle", label: "\u6218\u5C40\u4E0E\u5730\u5F62", role: "system", enabled: true, desc: "battle_init \u63CF\u8FF0\u7B26\u89E3\u6790\u540E\u7684\u68CB\u76D8\u3001\u5730\u5F62\u3001\u63A9\u4F53\u3001\u4E92\u52A8\u70B9" },
  { id: "warnings", label: "\u5F85\u5904\u7406\u8B66\u544A\u6E05\u5355", role: "system", enabled: true, desc: "\u6C99\u76D8\u8F6C\u6362\u65F6\u65E0\u6CD5\u7B49\u4EF7\u6620\u5C04\u7684\u88C5\u5907/\u6280\u80FD/\u6548\u679C\u53CA\u539F\u56E0" },
  { id: "task", label: "\u6807\u51C6\u5316\u4EFB\u52A1\u6307\u4EE4", role: "system", enabled: true, desc: "RFC 6902 \u8865\u4E01\u683C\u5F0F\u7EA6\u675F\u3001\u5141\u8BB8\u8DEF\u5F84\u767D\u540D\u5355\u3001\u7981\u6B62\u9879" },
  { id: "extra", label: "\u81EA\u5B9A\u4E49\u8865\u5145\uFF08\u53EF\u7A7A\uFF09", role: "system", enabled: false, desc: "\u7528\u6237\u81EA\u5DF1\u586B\u7684\u989D\u5916\u63D0\u793A\u8BCD" }
].map((slot) => ({ builtin: true, ...slot, content: slot.content ?? "" }));
var TAG_MAPPING = `\u3010\u4E16\u754C\u4E66\u6807\u7B7E \u2192 DSL / API \u6620\u5C04\u3011
\u2022 [\u5A01\u529B: X] + [\u4F24\u5BB3: \u7C7B\u578B] \u2192 \u4EE5 X \u4E3A\u5A01\u529B\u57FA\u51C6\uFF0Cdamage \u8282\u70B9\u7528 percentOfPower:1.0 \u548C\u5BF9\u5E94\u7684 damageType\u3002[\u5A01\u529B: X \u7269\u7406] \u7B49\u4EF7\u4E8E [\u5A01\u529B: X][\u4F24\u5BB3: \u7269\u7406]\uFF0C\u4E0D\u989D\u5916\u53E0\u52A0\u4F24\u5BB3\u3002
\u2022 \u6DF7\u5408\u4F24\u5BB3\uFF1A[\u5A01\u529B: 60][\u4F24\u5BB3: \u7269\u740640/\u80FD\u91CF20] \u4E2D\u5404\u5206\u91CF\u4E4B\u548C\u7B49\u4E8E\u5A01\u529B\u3002\u5FC5\u987B\u62C6\u6210\u591A\u4E2A damage \u8282\u70B9\uFF0C\u6BCF\u4E2A\u8282\u70B9\u53EA\u5199\u4E00\u4E2A damageType \u548C\u5BF9\u5E94\u6570\u503C\uFF0C\u4E0D\u5F97\u5728\u5355\u8282\u70B9\u91CC\u585E\u591A\u4E2A\u7C7B\u578B\u3002\u4F8B\uFF1A[{"kind":"damage","flat":40,"damageType":"physical"},{"kind":"damage","flat":20,"damageType":"energy"}]\u3002\u4E0D\u5F97\u518D\u53E0\u52A0\u4E00\u6B21\u603B\u5A01\u529B\u3002
\u2022 [\u5173\u8054\u5C5E\u6027: \u654F\u6377] \u2192 \u6280\u80FD\u7684\u5173\u8054\u68C0\u5B9A\u5C5E\u6027\u4E3A agi\uFF1B\u4E0D\u8981\u628A\u65BD\u672F\u8005\u7684\u5173\u8054\u5C5E\u6027\u8BEF\u4F5C\u76EE\u6807\u7684\u8C41\u514D\u5C5E\u6027\u3002[\u6709\u6548\u8DDD\u79BB: \u4E2D\u7A0B(5)] \u2192 range:5\u3002
\u2022 [\u5355\u4F53] \u2192 shape:single\uFF0Ctarget \u4F9D\u63CF\u8FF0\u9009\u53D6\uFF1B[\u8303\u56F4: \u4E2D\u7A0B(4)+\u6247(\u654C\u65B9)] \u2192 range:4\u3001shape:fan\u3001target:enemy\uFF0Cradius \u6309\u5B9E\u9645\u8986\u76D6\u534A\u5F84\u586B\u5199\uFF0C\u4E0D\u628A\u5C04\u7A0B\u5F53\u534A\u5F84\u3002
\u2022 \u7A7A\u6548\u679C\uFF1A\u76EE\u6807\u5BF9\u8C61\u7684\u6548\u679C\u5B57\u6BB5\u4E3A {} \u6216\u7F3A\u5931\u65F6\uFF0C\u8868\u793A\u8BE5\u5B57\u6BB5\u6CA1\u6709\u53EF\u6267\u884C\u6548\u679C\uFF0C\u4E0D\u4EA7\u751F\u4EFB\u4F55\u8865\u4E01\u64CD\u4F5C\uFF0C\u4E5F\u4E0D\u8BA1\u5165 unresolved\u3002\u7EAF\u4F4D\u79FB\u3001\u7EAF\u72B6\u6001\u6388\u4E88\u7B49\u6280\u80FD\u4ECD\u6709\u53EF\u6267\u884C\u8282\u70B9\uFF0C\u4E0D\u5C5E\u4E8E\u7A7A\u6548\u679C\u3002`;
var protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, EFFECT_PROTOCOL, STATUS_CATALOG].join("\n\n");
var PATCH_RULES = String.raw`【输出】逐项对照本战局警告、快照和战斗协议。只输出一个 JSON 对象：{"patch":[],"unresolved":[]}。两个键都是数组；不要解释、注释、Markdown 代码块、JS 调用或 battle_patch 包装。

【patch：有序的 RFC 6902 操作】
add 新增、replace 替换现有值：{"op":"replace","path":"…","value":值}；remove 删除现有值：{"op":"remove","path":"…"}。只允许这三种 op。路径以一个 / 开头。白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/
• /equipment/<id>：装备模板（如 /equipment/mainHand_dagger_01）；不是持有的道具实例。
• /skills/<id>：技能模板（如 /skills/skill_frost_arrow）。
• /items/<id>：道具实例（如 /items/item_01），不是模板属性。
• /statusTemplates/<id>：战局的自定义状态模板（如 /statusTemplates/status_custom_01），不能覆盖内置 ID。
• /units/<unitId>/statuses：单位状态实例映射（如 /units/p1/statuses）。
• /units/<unitId>/armor：单位护甲整数 0…1000000（如 /units/p1/armor）。
• /units/<unitId>/skills：完整技能 ID 数组，保留原有技能并加入新增技能 ID。
使用快照 ID，不用显示名、数组下标或 stat_data。新 ID 为英数开头，后续英数、_、-，≤64 字符。父对象须存在。替换 effects 时保留无关效果。

【值的形状：只用各表已定义的字段】
装备必有 name、effects。attack 为整数 0…1000000000，accuracy 为 −20…30。武器 range(1…15) 与 damage 骰子成对。
技能必有 name、ap(1或2)、slot(attack/action)、range(0…15)、shape(single/circle/fan/cone/line)、target(enemy/ally/self/any/corpse)、effects。save(str/agi/con/int/spi) 与 saveDC(1…50 的整数或协议中的公式对象) 必须成对；damage/heal 用 {count,sides}，可加 bonus、stat、multiplier、type。
所有 effects 使用统一 DSL 表达式。物品仅 {id,templateId,counters}，计数键与模板的资源声明对应，值在 0…cap。没有资源池时用 {}。
内置状态只认协议表 ID；另可引用当前已合法定义的自定义模板。自定义模板最多 64 个，必有 id,name,icon,category,description,remainingTurns,durationType,tickTiming,stackRule,maxStacks,modifiers。category 为 buff/debuff/control/dot/hot；remainingTurns 整数1…100；durationType=battle_turns/until_removed/persistent；tickTiming=onTurnStart/onTurnEnd；stackRule=refresh/stack/replace；maxStacks 整数1…10。
自定义 modifiers 非空，合法键、范围及 expireInto / expireOn 见协议。单位状态实例复制模板，再加 stacks(1…maxStacks)、sourceUnitId(ID或null)。shield 实例另有 amount。

整批须通过 validateState。禁止改阵营、资源及上限、坐标、先攻队列或日志。
【拆解原则】先尝试拆解，再考虑放弃。可用多状态 + 手动触发技能组合表达复杂效果。仅当引擎没有 kind 或组合可表达时才放入 unresolved，写明原效果并简述尝试过的方向（一句话）。部分可解时提交可解部分。
拆解后先在内部列出拟用的 kind / status，逐个自查：参数写全了吗？statusId 存在吗？数值在范围内吗？然后只输出最终 {"patch":[],"unresolved":[]}。
正例（仅当快照确有 p1，且警告明确其护甲应为 6）：
{"patch":[{"op":"replace","path":"/units/p1/armor","value":6}],"unresolved":[]}
【DSL 正例】先找事件、筛选条件及概率，再确定目标、节点字段与数值。下面每行是一条可放入 effects 的表达式，换成全局唯一 ID。
• 简单命中附状态：{"id":"hit_burn","label":"灼印","trigger":"on_hit","target":"hitTarget","effects":[{"kind":"grantStatus","statusId":"burn","turns":2}]}
• 条件加成：{"id":"night_edge","trigger":"passive","target":"self","condition":{"type":"timeOfDay","value":"night"},"effects":[{"kind":"multiplyDamage","factor":1.2}]}
• 概率反击：{"id":"cold_reply","trigger":"on_damaged","target":"attacker","condition":[{"type":"melee"},{"type":"enemy"}],"roll":{"dice":"d20","gte":16},"effects":[{"kind":"grantStatus","statusId":"chill"}]}
• 链式支付与回复：{"id":"blood_mana","trigger":"active","target":"self","effects":[{"kind":"chainEffect","stopOnFailure":true,"effects":[{"kind":"drainResource","resource":"hp","amount":12,"minimumRemaining":1,"requireFull":true},{"kind":"restoreResource","resource":"mp","percentOfPrevious":0.5}]}]}
• 叠加装备资源：{"id":"charge_pool","trigger":"passive","target":"self","effects":[{"kind":"produceResource","resource":"charge","cap":10000,"initial":0},{"kind":"multiplyDamage","resourceScale":{"resource":"charge","perUnit":0.02}}]}。同批在实例 counters 加入 charge:0，再写 on_kill/self 的 produceResource(amount:1) 增加存量。
• 捧腹失能：先添加 /statusTemplates/laugh_disabled，value 为 {"id":"laugh_disabled","name":"狂笑失能","icon":"😆","category":"control","description":"跳过行动，实际受到直接伤害时解除。","remainingTurns":1,"durationType":"battle_turns","tickTiming":"onTurnStart","stackRule":"refresh","maxStacks":1,"modifiers":{"skip":true},"expireOn":{"trigger":"on_damaged","damageType":"direct"}}。随后引用 {"id":"laugh_on_hit","trigger":"on_hit","target":"hitTarget","roll":{"save":"spi","dc":{"base":6,"scaleBy":{"stat":"spi","perUnit":0.5}}},"effects":[{"kind":"grantStatus","statusId":"laugh_disabled"}]}。
• 低伤校准（仅保留最低冲击力、避免致命）：用独立主动技能，不叠加普通武器主击；省略模板 damage，将全部冲击放入 {"id":"calibrated_impact","trigger":"active","target":"hitTarget","effects":[{"kind":"damage","amount":1,"damageType":"physical","lethal":false}]}。不可用减半倍率代替保命。
• 骑士誓言：{"id":"knight_oath","label":"骑士誓言","trigger":"passive","target":"self","condition":{"type":"intercepting"},"effects":[{"kind":"modifyStat","stat":"defense","percent":0.12,"enabled":true}]}。替队友承伤时防御提高 12%。若根据战局上下文判断誓言已破，使用现有 replace 操作将对应节点的 enabled 改为 false。例如 {"op":"replace","path":"/equipment/oath_armor/effects/0/effects/0/enabled","value":false}。若节点省略了 enabled，则 replace 整个节点并保留原字段，补上 enabled:false。
【实用组合】在角色已有装备上添加效果，替换整段 effects 时保留旧条目并追加新表达式。写完新技能后把其 ID 追加到持有者的 skills。对同一道具提供多条效果时，每条表达式使用不同 ID。description 是自定义状态模板必填字段。技能和装备模板省略 description。
• 临时强化与后续虚弱：先定义到期状态，再定义一回合强化状态并以 expireInto 引用前者。强化可用 guaranteed_hit、guaranteed_crit、finalDamageMultiplier；虚弱可用 attributePercent、blockResourceRestore。这些是状态模板的 modifiers 键。技能用 active/self 的 grantStatus 授予强化状态。
• 判定和成长：把多个检定加值放在同一个 passive/self 的 modifyCheck 节点。基础属性成长拆成五个 modifyStat 节点，每个写 percent:1 与 levelScaling:{min:0.25,max:1}。攻击成长把 stat 写成 damage。可执行的成长与未提供具体对象的合并可分别处理，已有装备未指定合并来源时无需构造新的装备。`;
var json = (value) => JSON.stringify(value, null, 2);
var lastCustomId = 0;
function makeCustomSlot() {
  lastCustomId = Math.max(Date.now(), lastCustomId + 1);
  return { id: `custom_${lastCustomId}`, label: "\u81EA\u5B9A\u4E49\u69FD\u4F4D", role: "system", enabled: true, desc: "", content: "", custom: true };
}
function describeSlots(saved) {
  if (!Array.isArray(saved)) return DEFAULT_SLOTS.map((slot) => ({ ...slot }));
  const defaults = new Map(DEFAULT_SLOTS.map((slot) => [slot.id, slot]));
  const entries2 = saved.filter((slot) => typeof slot?.id === "string");
  const legacy = entries2.length > 0 && entries2.every((slot) => defaults.has(slot.id) && Object.keys(slot).every((key3) => key3 === "id" || key3 === "enabled"));
  if (legacy) {
    const overrides = new Map(entries2.map((slot) => [slot.id, slot]));
    return DEFAULT_SLOTS.map((slot) => ({ ...slot, ...overrides.get(slot.id) }));
  }
  const needsIdentity = !entries2.some((slot) => slot.id === "identity");
  const slots = entries2.map((slot) => ({
    ...defaults.get(slot.id),
    ...slot,
    ...needsIdentity && defaults.has(slot.id) && slot.role === "user" ? { role: "system" } : {}
  }));
  return needsIdentity ? [{ ...DEFAULT_SLOTS[0] }, ...slots] : slots;
}
function resolveSlotContent(slot, ctx = {}) {
  const { sources = {}, state, instruction = "" } = ctx;
  const variables = {
    battle_init: () => sources.battleRaw || json(sources.battleInit ?? {}),
    battle_state: () => json(state ?? {}),
    warnings: () => json(sources.warnings ?? []),
    user_instruction: () => instruction,
    standardized_roster: () => sources.roster || "",
    roster: rosterText,
    battle: battleText,
    mvu_data: () => json(sources.mvuData ?? {}),
    latest_floor: () => sources.latestFloor || ""
  };
  const expand = (template) => String(template).replace(/\{\{(\w+)\}\}/g, (_, key3) => Object.hasOwn(variables, key3) ? variables[key3]() : "");
  function rosterText() {
    if (ctx.rosterText != null) return ctx.rosterText;
    if (!state) return sources.roster || "";
    const templates = new Set(Object.values(state.items ?? {}).map((item) => item.templateId));
    const skillIds = new Set(Object.values(state.units ?? {}).flatMap((unit) => unit.skills ?? []));
    const used = (table3, ids) => Object.fromEntries(Object.entries(table3 ?? {}).filter(([id3]) => ids.has(id3)));
    return json({ roster: ctx.roster ?? sources.roster, units: state.units, equipment: used(state.equipment, templates), skills: used(state.skills, skillIds), items: state.items, statusTemplates: state.statusTemplates });
  }
  function battleText() {
    if (ctx.battleText != null) return ctx.battleText;
    if (!sources.battleInit && !state) return "";
    const { units, equipment, items, skills, statusTemplates, ...board } = state ?? {};
    return `battle_init\uFF1A
${variables.battle_init()}
\u5F53\u524D\u6218\u5C40\uFF1A
${json(board)}`;
  }
  if (slot.custom === true || slot.content) return expand(slot.content ?? "");
  switch (slot.id) {
    case "protocol":
      return protocol;
    case "roster":
      return rosterText();
    case "battle":
      return battleText();
    case "warnings":
      return ctx.warningsText ?? (sources.warnings?.length ? `\u5F85\u5904\u7406\u8B66\u544A\uFF1A
${variables.warnings()}` : "");
    case "task":
      return expand(ctx.taskText ?? (ctx.kind === "chat" ? "\u3010\u8F85\u52A9 AI \u5BF9\u8BDD\u3011\u8EAB\u4EFD\u58F0\u660E\u4E2D\u7684\u6570\u636E\u8F93\u51FA\u8981\u6C42\u9002\u7528\u4E8E\u6218\u5C40\u53D8\u66F4\u3002\u73A9\u5BB6\u4EC5\u54A8\u8BE2\u65F6\uFF0C\u76F4\u63A5\u7528\u6587\u5B57\u56DE\u7B54\u6218\u6597\u4E0E\u5F15\u64CE\u95EE\u9898\u3002\u53EA\u6709\u73A9\u5BB6\u660E\u786E\u8981\u6C42\u8C03\u6574\u6218\u5C40\u4E14\u5DF2\u52A0\u8F7D\u6218\u5C40\u65F6\uFF0C\u624D\u8F93\u51FA battle_patch \u6216 unit_patch JSON\u3002\u5F85\u5904\u7406\u8B66\u544A\u7531\u72EC\u7ACB\u7684\u6807\u51C6\u5316\u4EFB\u52A1\u5904\u7406\u3002" : PATCH_RULES + (instruction ? "\n\u73A9\u5BB6\u8865\u5145\uFF1A{{user_instruction}}" : "")));
    case "extra":
      return expand(ctx.extraText || "");
    case "assistant":
      return ctx.assistantText || "";
    default:
      return "";
  }
}
function assembleMessages(slots = DEFAULT_SLOTS, ctx = {}) {
  const messages = [];
  let previousMergeable = false;
  for (const slot of slots) {
    if (!slot || slot.enabled === false) continue;
    const content = resolveSlotContent(slot, ctx);
    if (!content?.trim()) continue;
    const role = ["system", "assistant"].includes(slot.role) ? slot.role : "user";
    const previous = messages.at(-1);
    const mergeable = !slot.custom && role !== "assistant" && slot.id !== "assistant";
    if (previous?.role === role && previousMergeable && mergeable) {
      previous.content += "\n\n" + content;
      previous.slotId += "+" + slot.id;
      previous.slotLabel += " / " + slot.label;
    } else messages.push({ role, content, slotId: slot.id, slotLabel: slot.label });
    previousMergeable = mergeable;
  }
  return messages;
}

// src/tavern/api.js
function lookup(host, localWin, key3) {
  for (const scope of [localWin, host, localWin?.parent, localWin?.top, globalThis]) {
    try {
      for (const owner of [scope, scope?.TavernHelper]) {
        const value = owner?.[key3];
        if (value != null) return typeof value === "function" ? value.bind(owner) : value;
      }
    } catch {
    }
  }
}
function bindTavernStreamEvents(host, localWin, genId, onStreamChunk) {
  const get2 = (key3) => lookup(host, localWin, key3);
  const on = get2("eventOn"), remove = get2("eventRemoveListener");
  const cleanups = [];
  const stop = () => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
      }
    }
  };
  if (typeof on !== "function") return stop;
  try {
    for (const name of /* @__PURE__ */ new Set([
      get2("iframe_events")?.STREAM_TOKEN_RECEIVED_FULLY || "js_stream_token_received_fully",
      get2("tavern_events")?.STREAM_TOKEN_RECEIVED || "stream_token_received"
    ])) {
      const handler = (text4, id3) => {
        if (typeof text4 === "string" && text4 && (!id3 || id3 === genId)) onStreamChunk?.(text4, false);
      };
      const sub = on(name, handler);
      cleanups.push(() => {
        try {
          if (typeof sub === "function") sub();
          else sub?.stop?.();
        } finally {
          remove?.(name, handler);
        }
      });
    }
  } catch (error2) {
    stop();
    throw error2;
  }
  return stop;
}
var sequence = 0;
async function requestViaTavern(host, settings, messages, { onStreamChunk, signal } = {}) {
  signal?.throwIfAborted();
  const win = globalThis.window || globalThis;
  const generate = lookup(host, win, "generateRaw");
  if (!generate) throw new Error("\u672A\u68C0\u6D4B\u5230 generateRaw\uFF0C\u8BF7\u5728 API \u8BBE\u7F6E\u9875\u9009\u62E9\u4E3B\u63A5\u53E3\u6A21\u5F0F\u5E76\u786E\u8BA4\u9152\u9986\u52A9\u624B\u5DF2\u542F\u7528");
  const id3 = `fated-${Date.now()}-${++sequence}`;
  const stream = settings.stream ?? true;
  const cleanup = stream ? bindTavernStreamEvents(host, win, id3, onStreamChunk) : null;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => {
      try {
        Promise.resolve(lookup(host, win, "stopGenerationById")?.(id3)).catch(() => {
        });
      } catch {
      }
      reject(signal.reason || new DOMException("\u5DF2\u53D6\u6D88", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    const text4 = await Promise.race([generate({ generation_id: id3, should_stream: stream, ordered_prompts: messages }), cancelled]);
    if (typeof text4 !== "string" || !text4.trim()) throw new Error("\u9152\u9986\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u6587\u672C\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u4E3B\u63A5\u53E3");
    onStreamChunk?.(text4, true);
    return text4;
  } finally {
    cleanup?.();
    signal?.removeEventListener("abort", abort);
  }
}
function diagnoseApiError(rawText, status2) {
  let detail = String(rawText || "").trim();
  try {
    detail = JSON.parse(detail)?.error?.message || detail;
  } catch {
  }
  const hint = /mixed content/i.test(detail) ? "HTTPS \u9875\u9762\u4E0D\u80FD\u8BF7\u6C42 HTTP \u63A5\u53E3\uFF0C\u8BF7\u4F7F\u7528 HTTPS \u5730\u5740" : { 401: "\u5BC6\u94A5\u65E0\u6548", 403: "\u65E0\u8BBF\u95EE\u6743\u9650", 404: "\u6A21\u578B\u6216\u63A5\u53E3\u5730\u5740\u9519\u8BEF", 429: "\u8BF7\u6C42\u9650\u6D41\u6216\u989D\u5EA6\u4E0D\u8DB3" }[status2] || (status2 >= 500 ? "\u4E0A\u6E38\u670D\u52A1\u6545\u969C" : "API \u8BF7\u6C42\u5931\u8D25");
  return `${status2 ? `HTTP ${status2}\uFF1A` : ""}${hint}${detail ? `\uFF08${detail.slice(0, 500)}\uFF09` : ""}`;
}
async function readSseStream(readableStream, extractDelta, onStreamChunk) {
  const reader = readableStream.getReader(), decoder = new TextDecoder();
  const start = Date.now();
  let buffer = "", content = "", reasoning = "", args = "", heartbeatCount = 0;
  function line(raw) {
    const s = raw.trim();
    if (s.startsWith(":")) {
      onStreamChunk?.("", false, { isHeartbeat: true, heartbeatCount: ++heartbeatCount, elapsedSec: Math.floor((Date.now() - start) / 1e3) });
    } else if (s.startsWith("data:")) {
      const data = s.slice(5).trim();
      if (data === "[DONE]") return true;
      if (!data) return false;
      const event = JSON.parse(data);
      if (event.error) throw new Error(diagnoseApiError(event.error.message));
      const d = extractDelta(event) || {};
      const c = typeof d === "string" ? d : d.contentDelta;
      if (c || d.reasoningDelta || d.toolArgsDelta) {
        content += c || "";
        reasoning += d.reasoningDelta || "";
        args += d.toolArgsDelta || "";
        onStreamChunk?.(content || args || reasoning, false);
      }
    }
    return false;
  }
  let ended = false;
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      ended = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop();
      if (lines.some(line)) break;
    }
    return content || args || reasoning;
  } finally {
    if (!ended) reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
function connection(settings, needModel) {
  const base = settings.baseUrl?.trim().replace(/\/+$/, ""), key3 = settings.apiKey?.trim(), model = settings.model?.trim();
  if (!base || !key3 || needModel && !model) throw new Error(`\u8BF7\u5728 API \u8BBE\u7F6E\u4E2D\u586B\u5199${!base ? "\u63A5\u53E3\u5730\u5740\uFF08baseUrl\uFF09" : !key3 ? "\u5BC6\u94A5\uFF08apiKey\uFF09" : "\u6A21\u578B\uFF08model\uFF09"}`);
  if (globalThis.location?.protocol === "https:" && /^http:/i.test(base)) throw new Error(diagnoseApiError("Mixed Content"));
  const source = settings.apiSource || "openai";
  const headers = { "Content-Type": "application/json" };
  let root;
  if (source === "gemini") root = base.replace(/\/v1beta(?:\/.*)?$/i, "") + "/v1beta";
  else if (source === "claude") {
    root = base.replace(/\/messages$/i, "").replace(/\/v1$/i, "") + "/v1";
    Object.assign(headers, { "x-api-key": key3, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  } else if (source === "openai") {
    root = base.replace(/\/chat\/completions$/i, "");
    headers.Authorization = `Bearer ${key3}`;
  } else throw new Error(`\u672A\u77E5 API \u7C7B\u578B\uFF1A${source}`);
  return { root, source, headers, model, key: encodeURIComponent(key3) };
}
async function send(url, init, { fetchImpl = globalThis.fetch, signal }) {
  const res = await fetchImpl(url, { ...init, signal });
  if (!res.ok) throw new Error(diagnoseApiError(await res.text(), res.status));
  return res;
}
var json2 = (res) => res.json ? res.json() : res.text().then(JSON.parse);
async function fetchModels(settings, options = {}) {
  const { root, source, key: key3, headers } = connection(settings, false);
  const res = await send(`${root}/models${source === "gemini" ? `?key=${key3}` : ""}`, { method: "GET", headers }, options);
  const data = await json2(res);
  return (source === "gemini" ? data.models : data.data)?.map((m) => source === "gemini" ? m.name?.replace(/^models\//, "") : m.id).filter((id3) => typeof id3 === "string" && id3) || [];
}
function deltas(source, event) {
  if (source === "gemini") {
    const parts = event.candidates?.[0]?.content?.parts || [];
    return { contentDelta: parts.filter((p) => !p.thought).map((p) => p.text).join(""), reasoningDelta: parts.filter((p) => p.thought).map((p) => p.text).join("") };
  }
  if (source === "claude") {
    const d2 = event.delta || event.content_block || {};
    return { contentDelta: d2.text, reasoningDelta: d2.thinking, toolArgsDelta: d2.partial_json };
  }
  const choice = event.choices?.[0];
  const d = choice?.delta || choice?.message || {};
  return { contentDelta: d.content, reasoningDelta: d.reasoning_content, toolArgsDelta: d.tool_calls?.map((t) => t.function?.arguments).join("") || d.function_call?.arguments };
}
async function requestViaCustomApi(settings, messages, options = {}) {
  const { root, source, model, key: key3, headers } = connection(settings, true);
  const stream = settings.stream ?? true, temperature = Number(settings.temperature ?? 0.2), max_tokens = Number(settings.max_tokens || 2400);
  const wireMessages = messages.map(({ role, content }) => ({ role, content }));
  let url, body;
  if (source === "openai") {
    url = `${root}/chat/completions`;
    body = { model, messages: wireMessages, temperature, max_tokens, stream };
  } else {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const chat = wireMessages.filter((m) => m.role !== "system");
    if (!chat.length && system) chat.push({ role: "user", content: "\u8BF7\u6267\u884C\u4E0A\u8FF0\u4EFB\u52A1\u3002" });
    if (source === "claude") {
      url = `${root}/messages`;
      body = { model, system, messages: chat, temperature, max_tokens, stream };
    } else {
      url = `${root}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:${stream ? "streamGenerateContent?alt=sse&" : "generateContent?"}key=${key3}`;
      body = {
        ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
        contents: chat.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature, maxOutputTokens: max_tokens },
        safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT", "CIVIC_INTEGRITY"].map((name) => ({ category: `HARM_CATEGORY_${name}`, threshold: "BLOCK_NONE" }))
      };
    }
  }
  const res = await send(url, { method: "POST", headers, body: JSON.stringify(body) }, options);
  let text4;
  if (stream && res.body?.getReader && !/application\/json/i.test(res.headers?.get?.("content-type") || "")) {
    text4 = await readSseStream(res.body, (event) => deltas(source, event), options.onStreamChunk);
  } else {
    const data = await json2(res);
    if (data.error) throw new Error(diagnoseApiError(data.error.message));
    const d = deltas(source, data);
    text4 = source === "claude" ? (data.content || []).map((p) => p.text).join("") : d.contentDelta || d.toolArgsDelta || d.reasoningDelta || "";
  }
  if (typeof text4 !== "string" || !text4.trim()) throw new Error("\u72EC\u7ACB API \u672A\u8FD4\u56DE\u6709\u6548\u6587\u672C\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u548C\u534F\u8BAE\u7C7B\u578B");
  options.onStreamChunk?.(text4, true);
  return text4;
}

// src/tavern/settings.js
var css = `
.fated-settings {display:grid;gap:10px;min-width:0}
.fated-settings .wf-dashboard {margin:0}
.fated-settings .wf-dashboard .wf-hero {flex:none;color:var(--gold-soft);font-size:.8em;letter-spacing:.05em;font-family:var(--font-display)}
.fated-settings .wf-toolbar {display:flex;flex-wrap:wrap;gap:6px;padding:9px 12px}
.fated-settings .slot-pipeline {display:grid;gap:0;min-width:0}
.fated-settings .wf-card {display:block;margin:0 0 8px}
.fated-settings .slot-head {display:flex;align-items:center;gap:8px;min-width:0;padding:7px 10px 7px 12px;background:var(--header-bg);border-bottom:1px solid var(--header-line)}
.fated-settings .slot-head:last-child {border-bottom:0}
.fated-settings .slot-title {flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gold);font-family:var(--font-display);font-size:1em;font-weight:700;letter-spacing:.05em;text-shadow:var(--title-shadow)}
.fated-settings .wf-card:has(> .slot-head input.toggle-switch:not(:checked)) .slot-desc {opacity:.55}
.fated-settings .wf-card:has(> .slot-head input.toggle-switch:not(:checked)) .role-badge {opacity:.65}
.fated-settings .role-badge {flex:none;padding:0 7px;border:1px solid;border-radius:999px;background:transparent;font:600 .7em/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em;text-transform:lowercase}
.fated-settings .role-badge[data-role=system] {border-color:rgb(var(--gold-rgb)/.6);background:rgb(var(--gold-rgb)/.1);color:var(--gold)}
.fated-settings .role-badge[data-role=user] {border-color:var(--blue-line);background:rgb(95 147 200/.12);background:color-mix(in srgb, var(--blue-line) 14%, transparent);color:var(--blue-text)}
.fated-settings .role-badge[data-role=assistant] {border-color:rgb(var(--glow-rgb)/.6);background:rgb(var(--glow-rgb)/.16);color:var(--text-key)}
.fated-settings .slot-actions {display:flex;flex:none;gap:1px;margin-left:auto}
.fated-settings .slot-actions button {min-height:24px;padding:0 7px;border-color:transparent;background:transparent;color:var(--gold-soft);font-size:.8em;opacity:.85}
.fated-settings .slot-actions button:hover,.fated-settings .slot-actions button:focus-visible {border-color:var(--line-mid);background:var(--row-bg);opacity:1}
.fated-settings .slot-actions button:disabled {opacity:.22;border-color:transparent;background:transparent}
.fated-settings .slot-actions .danger:hover {border-color:var(--red-line);color:var(--red-text)}
.fated-settings .wf-card .switch {margin-left:6px}
.fated-settings .slot-desc {margin:0;padding:6px 12px 8px;color:var(--text-muted);font-size:.78em;line-height:1.5;overflow-wrap:anywhere}
.fated-settings .slot-editor {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));gap:8px 10px;padding:9px 12px 12px;border-top:1px solid var(--row-border);background:var(--row-bg)}
.fated-settings .slot-editor .wide {grid-column:1/-1}
.fated-settings .slot-editor .hint {color:var(--gold-dim);font-size:.74em;line-height:1.5;overflow-wrap:anywhere}
.fated-settings .slot-editor textarea {min-height:8.5em}
.fated-settings .slot-preview {margin:0;padding:7px 9px;border:1px solid var(--line-mid);border-radius:6px;background:var(--field);color:var(--text-soft);max-height:16em;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent;font:.8em/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}
.fated-settings .wf-empty {padding:14px 12px;color:var(--text-muted);text-align:center}
.fated-settings .fated-settings pre {margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:.78em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.fated-settings .preview-panel pre {max-height:22em;overflow:auto;padding:9px 12px 12px;color:var(--text-soft);background:var(--row-bg)}
.fated-settings .preview-panel summary {display:flex;align-items:center;gap:8px;padding:0;cursor:pointer;list-style:none}
.fated-settings .preview-panel summary::-webkit-details-marker {display:none}
.fated-settings .preview-panel summary::after {content:'\u25BE';flex:none;padding-right:12px;color:var(--gold-dim);font-size:.8em}
.fated-settings .preview-panel[open] summary {border-bottom:1px solid var(--header-line)}
.fated-settings .preview-panel summary .panel-title {padding:8px 12px}
.fated-settings .api-card .form-grid {grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:12px}
.fated-settings .field.wide {grid-column:1/-1}
.fated-settings .switch-field {display:flex;align-items:center;justify-content:flex-start;gap:14px;min-height:32px}
.fated-settings .switch-field > span {color:var(--text-soft);font-size:.84em}
.fated-settings .cmd-row {display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.fated-settings .api-card .api-status {margin:6px 0 0}
.fated-settings .api-status {margin:0 12px 12px;padding:7px 10px;border:1px solid var(--row-border);border-radius:6px;background:var(--row-bg);color:var(--text-soft);font-size:.82em;white-space:pre-wrap;overflow-wrap:anywhere}
.fated-settings .api-status:empty {display:none}
.fated-settings .api-status[data-error=true] {border-color:var(--red-line);color:var(--red-text);background:rgb(192 114 122/.1);background:color-mix(in srgb, var(--red-line) 12%, transparent)}
/* Narrow windows: keep the switch and target sizes usable without scaling the layout. */
@media (max-width:560px) {
  .fated-settings .slot-head {flex-wrap:wrap;row-gap:6px}
  .fated-settings .slot-title {flex:1 1 auto}
  .fated-settings .slot-head .switch {order:2}
  .fated-settings .slot-actions {order:3;flex-basis:100%;margin-left:0}
  .fated-settings .slot-actions button {min-height:32px;padding:0 10px;font-size:.85em}
  .fated-settings .slot-editor {grid-template-columns:1fr}
  .fated-settings .api-card .form-grid {grid-template-columns:1fr}
  .fated-settings .wf-toolbar button {min-height:34px}
  [data-fated-tavern-overlay] .fated-tavern-tabs {gap:2px;padding:5px 6px}
  [data-fated-tavern-overlay] .fated-tavern-tabs button {padding:4px 6px;font-size:.8em}
}
`;
function mount2(page) {
  const doc = page.ownerDocument;
  const make = (tag, cls, text4) => {
    const node3 = doc.createElement(tag);
    if (cls) node3.className = cls;
    if (text4 != null) node3.textContent = text4;
    return node3;
  };
  const root = make("div", "fated-settings");
  page.replaceChildren(make("style", "", css), root);
  const button = (text4, cls = "pill-btn") => Object.assign(make("button", cls, text4), { type: "button" });
  const panel = (title) => {
    const section = make("section", "action-panel form-card");
    const bar = make("div", "panel-header-bar");
    bar.append(make("h3", "panel-title", title));
    section.append(bar);
    return { section, bar };
  };
  return { make, root, button, panel };
}
function renderPromptTab(page, ctx) {
  const { make, root, button, panel } = mount2(page);
  let slots = describeSlots(ctx.slots ?? ctx.settings.slots);
  let editing = null;
  const editors = /* @__PURE__ */ new Map();
  const field = (title, control, wide = false) => {
    const label = make("label", wide ? "field wide" : "field", title);
    label.append(control);
    return label;
  };
  const dashboard = make("section", "action-panel form-card wf-dashboard");
  const dashBar = make("div", "panel-header-bar");
  const hero = make("strong", "wf-hero");
  dashBar.append(make("h3", "panel-title", "\u{1F9E9} \u63D0\u793A\u8BCD\u69FD\u4F4D"), hero);
  const toolbar = make("div", "wf-toolbar");
  const add = button("+ \u65B0\u5EFA\u69FD\u4F4D");
  const reset = button("\u6062\u590D\u9ED8\u8BA4");
  toolbar.append(add, reset);
  dashboard.append(dashBar, toolbar);
  const pipeline = make("div", "slot-pipeline");
  const preview2 = make("details", "action-panel form-card preview-panel");
  const summary = make("summary", "panel-header-bar");
  summary.append(make("span", "panel-title", "\u6700\u7EC8 messages \u9884\u89C8\uFF08JSON\uFF09"));
  const json3 = make("pre");
  preview2.append(summary, json3);
  root.append(dashboard, pipeline, preview2);
  const extraText = () => ctx.settings.extraText ?? "";
  const assembly = ctx.assemblyContext;
  const last = make("details", "action-panel form-card preview-panel");
  const lastSummary = make("summary", "panel-header-bar");
  lastSummary.append(make("span", "panel-title", "\u4E0A\u6B21\u5B9E\u9645\u53D1\u9001\u7684 messages\uFF08\u7EC4\u88C5\u5FEB\u7167\uFF09"));
  const lastJson = make("pre");
  last.append(lastSummary, lastJson);
  root.append(last);
  const showLast = () => {
    const messages = ctx.lastSent();
    last.hidden = !messages;
    if (messages) lastJson.textContent = JSON.stringify(messages, null, 2);
  };
  ctx.onPreview((messages, kind) => {
    summary.firstChild.textContent = `\u6700\u7EC8 messages \u9884\u89C8\uFF08${kind === "chat" ? "AI \u8C03\u6574" : "\u6807\u51C6\u5316"}\uFF09`;
    json3.textContent = JSON.stringify(messages, null, 2);
    showLast();
  });
  const refresh = () => {
    hero.textContent = `\u5DF2\u542F\u7528 ${slots.filter((s) => s.enabled !== false).length} / ${slots.length}`;
    ctx.prepareMessages();
  };
  function saveSlots(next, fields3 = {}) {
    const previous = slots;
    slots = next;
    ctx.save({ ...fields3, slots }, previous);
    refresh();
  }
  const blank = () => {
    pipeline.replaceChildren(make("p", "wf-empty", "\u6CA1\u6709\u69FD\u4F4D\u4E86\u3002\u70B9\u300C\u65B0\u5EFA\u69FD\u4F4D\u300D\u6DFB\u52A0\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\uFF0C\u6216\u70B9\u300C\u6062\u590D\u9ED8\u8BA4\u300D\u3002"));
  };
  function drawCards() {
    pipeline.replaceChildren();
    editors.clear();
    if (!slots.length) {
      refresh();
      return blank();
    }
    slots.forEach((slot, i) => {
      const card = make("article", "action-panel wf-card");
      const head = make("div", "slot-head");
      const switchWrap = make("label", "switch");
      const toggle = make("input", "toggle-switch");
      toggle.type = "checkbox";
      toggle.checked = slot.enabled !== false;
      switchWrap.append(toggle, make("span", "switch-track"));
      const title = make("strong", "slot-title");
      const badge = make("span", "role-badge", slot.role);
      badge.dataset.role = slot.role;
      const actions = make("div", "slot-actions");
      const edit = button("\u7F16\u8F91");
      const up = button("\u25B2");
      up.title = "\u4E0A\u79FB";
      const down = button("\u25BC");
      down.title = "\u4E0B\u79FB";
      const remove = button("\u2715", "pill-btn danger");
      remove.disabled = slot.id === "identity";
      remove.title = remove.disabled ? "\u53EF\u4F7F\u7528\u5F00\u5173\u505C\u7528\u8EAB\u4EFD\u58F0\u660E" : slot.custom ? "\u5220\u9664\u6B64\u69FD\u4F4D" : "\u9690\u85CF\u6B64\u5185\u7F6E\u69FD\u4F4D\uFF08\u53EF\u4ECE\u300C\u6062\u590D\u9ED8\u8BA4\u300D\u627E\u56DE\uFF09";
      actions.append(edit, up, down, remove);
      head.append(title, badge, actions, switchWrap);
      const setTitle = (value) => {
        title.textContent = value.trim() || "\u672A\u547D\u540D\u69FD\u4F4D";
        title.title = title.textContent;
        toggle.setAttribute("aria-label", `\u542F\u7528\uFF1A${title.textContent}`);
        for (const action of actions.children) action.setAttribute("aria-label", `${action.title}\uFF1A${title.textContent}`);
      };
      setTitle(slot.label);
      const desc = slot.desc || (slot.custom ? "\u81EA\u5B9A\u4E49\u69FD\u4F4D" : "");
      const body = make("p", "slot-desc", desc);
      const editable = slot.custom === true || slot.id === "extra";
      const form = make("div", "slot-editor");
      form.hidden = editing !== slot.id;
      const labelInput = make("input");
      labelInput.value = slot.label;
      labelInput.setAttribute("aria-label", "\u69FD\u4F4D\u6807\u9898");
      const role = make("select");
      role.setAttribute("aria-label", "\u6D88\u606F\u89D2\u8272");
      for (const value of ["system", "user", "assistant"]) role.append(Object.assign(make("option", "", value), { value }));
      role.value = slot.role;
      const staticContent = slot.content || (slot.id === "extra" ? extraText() : "");
      const content = editable ? make("textarea") : make("pre", "slot-preview");
      content.setAttribute("aria-label", "\u69FD\u4F4D\u5185\u5BB9");
      if (editable) content.value = staticContent;
      else {
        content.textContent = resolveSlotContent(slot, assembly());
        content.setAttribute("aria-readonly", "true");
        content.tabIndex = 0;
      }
      form.append(field("\u6807\u9898", labelInput), field("\u89D2\u8272", role), field(editable ? "\u5185\u5BB9" : "\u5185\u5BB9\uFF08\u52A8\u6001\u751F\u6210\uFF0C\u53EA\u8BFB\uFF09", content, true));
      if (editable) form.append(make("p", "hint wide", "\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{{battle_init}}\u3001{{battle_state}}\u3001{{warnings}}\u3001{{user_instruction}}\u3001{{roster}}\u3001{{battle}}\u3002\u7559\u7A7A\u5219\u4E0D\u53D1\u9001\u3002"));
      const expand = (open) => {
        form.hidden = !open;
        edit.setAttribute("aria-expanded", String(open));
      };
      expand(editing === slot.id);
      editors.set(slot.id, { edit, label: labelInput, content, expand });
      edit.onclick = () => {
        const open = form.hidden;
        editors.get(editing)?.expand(false);
        editing = open ? slot.id : null;
        expand(open);
        if (open) labelInput.focus();
      };
      const patch = (changes2) => saveSlots(slots.map((s, j) => j === i ? { ...s, ...changes2 } : s));
      toggle.onchange = () => patch({ enabled: toggle.checked });
      labelInput.oninput = () => {
        setTitle(labelInput.value);
        patch({ label: labelInput.value });
      };
      role.onchange = () => {
        badge.textContent = badge.dataset.role = role.value;
        patch({ role: role.value });
      };
      if (editable) {
        content.oninput = () => {
          if (slot.id === "extra") saveSlots(slots.map((s, j) => j === i ? { ...s, content: content.value } : s), { extraText: "" });
          else patch({ content: content.value });
        };
      }
      const move = (to) => {
        const next = slots.slice();
        [next[i], next[to]] = [next[to], next[i]];
        saveSlots(next);
        drawCards();
        editors.get(slot.id)?.edit.focus();
      };
      up.disabled = i === 0;
      down.disabled = i === slots.length - 1;
      up.onclick = () => move(i - 1);
      down.onclick = () => move(i + 1);
      remove.onclick = () => {
        if (editing === slot.id) editing = null;
        saveSlots(slots.filter((_, j) => j !== i));
        drawCards();
        (editors.get(slots[i]?.id ?? slots[i - 1]?.id)?.edit ?? add).focus();
      };
      card.append(head, body, form);
      pipeline.append(card);
    });
    refresh();
  }
  add.onclick = () => {
    const slot = makeCustomSlot();
    editing = slot.id;
    saveSlots([...slots, slot]);
    drawCards();
    editors.get(slot.id)?.label.focus();
  };
  reset.onclick = () => {
    editing = null;
    saveSlots(describeSlots(DEFAULT_SLOTS), { extraText: "" });
    drawCards();
  };
  drawCards();
}
function renderApiTab(page, ctx) {
  const { make, root, button, panel } = mount2(page);
  const settings = ctx.settings;
  const tavern = (settings.apiMode ?? "tavern") === "tavern";
  function card(title) {
    const { section } = panel(title);
    const grid = make("div", "form-grid");
    section.className = "action-panel form-card api-card";
    section.append(grid);
    root.append(section);
    return grid;
  }
  function field(grid, key3, title, input2, fallback, disabled = false, wide = false) {
    const wrap = make("div", wide ? "field wide" : "field");
    const label = make("label", "", title);
    input2.name = key3;
    input2.disabled = disabled;
    const checkbox = input2.type === "checkbox";
    if (checkbox) input2.checked = settings[key3] ?? fallback;
    else input2.value = settings[key3] ?? fallback;
    input2.onchange = () => {
      if (input2.type === "number" && (!input2.reportValidity() || !Number.isFinite(input2.valueAsNumber))) return;
      ctx.save({ [key3]: checkbox ? input2.checked : input2.type === "number" ? input2.valueAsNumber : input2.value });
      if (key3 === "apiMode") renderApiTab(page, ctx);
    };
    label.append(input2);
    wrap.append(label);
    grid.append(wrap);
    return wrap;
  }
  const select = (options) => {
    const input2 = make("select");
    for (const [value, text4] of options) input2.append(Object.assign(make("option", "", text4), { value }));
    return input2;
  };
  const input = (type, props = {}) => Object.assign(make("input"), { type }, props);
  const api = card("\u{1F50C} \u72EC\u7ACB API \u63A5\u53E3\u914D\u7F6E\uFF08\u4E0E\u4E3B\u804A\u5929\u5B8C\u5168\u89E3\u8026\uFF09");
  field(api, "apiMode", "\u63A5\u53E3\u8C03\u7528\u65B9\u5F0F", select([
    ["custom", "\u{1F680} \u72EC\u7ACB\u81EA\u5B9A\u4E49 API \u76F4\u8FDE\uFF08\u63A8\u8350\uFF0C\u4E0D\u5360\u4E3BAPI\u989D\u5EA6\uFF09"],
    ["tavern", "\u{1F37A} \u9152\u9986\u5F53\u524D\u8FDE\u63A5 API (TavernHelper.generateRaw)"]
  ]), "tavern");
  field(api, "apiSource", "\u72EC\u7ACB API \u534F\u8BAE\u7C7B\u578B", select([
    ["openai", "OpenAI \u517C\u5BB9\u63A5\u53E3 (\u53CD\u4EE3/DeepSeek/\u7845\u57FA/OneAPI\u7B49)"],
    ["gemini", "Google Gemini \u539F\u751F\u63A5\u53E3 (/v1beta/models)"],
    ["claude", "Anthropic Claude \u539F\u751F\u63A5\u53E3 (/v1/messages)"]
  ]), "openai", tavern);
  field(api, "baseUrl", "API \u5730\u5740 (Base URL)", input("text", { placeholder: "\u4F8B\u5982 https://api.deepseek.com \u6216 https://\u4F60\u7684\u53CD\u4EE3\u57DF\u540D/v1" }), "", tavern);
  field(api, "apiKey", "API \u5BC6\u94A5 (API Key)", input("password", { className: "masked-key-input", autocomplete: "off" }), "", tavern);
  const model = input("text");
  const modelField = field(api, "model", "\u6A21\u578B\u540D\u79F0", model, "", tavern, true);
  const commands2 = make("div", "cmd-row");
  const load = button("\u{1F504} \u62C9\u53D6\u6A21\u578B");
  const test = button("\u26A1 \u6D4B\u8BD5\u8FDE\u63A5");
  commands2.append(load, test);
  const status2 = make("div", "api-status");
  status2.setAttribute("role", "status");
  modelField.append(commands2, status2);
  load.disabled = tavern;
  async function run(pending, action) {
    load.disabled = test.disabled = true;
    status2.dataset.error = "false";
    status2.textContent = pending;
    try {
      status2.textContent = await action();
    } catch (err) {
      status2.dataset.error = "true";
      status2.textContent = `\u8BF7\u6C42\u5931\u8D25\uFF1A${err?.message || String(err)}`;
    } finally {
      load.disabled = tavern;
      test.disabled = false;
    }
  }
  let picker;
  load.onclick = () => run("\u6B63\u5728\u62C9\u53D6\u6A21\u578B\u2026", async () => {
    picker?.remove();
    const names = await fetchModels({ ...ctx.settings }, { fetchImpl: ctx.fetchImpl });
    if (!names.length) throw new Error("\u63A5\u53E3\u672A\u8FD4\u56DE\u53EF\u7528\u6A21\u578B");
    picker = select([["", "\u8BF7\u9009\u62E9\u6A21\u578B"], ...names.map((name) => [name, name])]);
    picker.setAttribute("aria-label", "\u53EF\u7528\u6A21\u578B");
    picker.onchange = () => {
      if (!picker.value) return;
      model.value = picker.value;
      ctx.save({ model: model.value });
    };
    modelField.append(picker);
    return `\u5DF2\u62C9\u53D6 ${names.length} \u4E2A\u6A21\u578B`;
  });
  test.onclick = () => run("\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026", async () => {
    const probe = { ...ctx.settings, max_tokens: 8 };
    const messages = [{ role: "user", content: "\u53EA\u56DE\u590D OK" }];
    if (tavern) await requestViaTavern(ctx.host, probe, messages, {});
    else await requestViaCustomApi(probe, messages, { fetchImpl: ctx.fetchImpl });
    return "\u6D4B\u8BD5\u8FDE\u63A5\u6210\u529F";
  });
  const sampling = card("\u2699 \u91C7\u6837\u53C2\u6570");
  field(sampling, "temperature", "\u6E29\u5EA6 (temperature)", input("number", { step: "any", required: true }), 0.2);
  field(sampling, "max_tokens", "\u6700\u5927\u8F93\u51FA\u957F\u5EA6 (max_tokens)", input("number", { min: "1", step: "1", required: true }), 2400);
  const streamField = make("div", "field switch-field");
  const streamSwitch = make("label", "switch");
  const streamInput = Object.assign(make("input"), { type: "checkbox", name: "stream", checked: settings.stream ?? true });
  streamSwitch.append(streamInput, make("span", "switch-track"));
  streamInput.onchange = () => ctx.save({ stream: streamInput.checked });
  streamField.append(make("span", "", "\u6D41\u5F0F\u54CD\u5E94 (stream)"), streamSwitch);
  sampling.append(streamField);
  const timeoutField = make("div", "field");
  const timeoutLabel = make("label", "", "\u8BF7\u6C42\u8D85\u65F6\uFF08\u79D2\uFF09");
  const timeout = input("number", { name: "timeoutMs", min: "5", max: "3600", step: "5", required: true, value: (settings.timeoutMs ?? 6e4) / 1e3 });
  timeout.onchange = () => {
    if (Number.isFinite(timeout.valueAsNumber)) timeout.value = Math.min(3600, Math.max(5, timeout.valueAsNumber));
    if (timeout.reportValidity()) ctx.save({ timeoutMs: timeout.valueAsNumber * 1e3 });
  };
  timeoutLabel.append(timeout);
  timeoutField.append(timeoutLabel);
  sampling.append(timeoutField);
}
function renderSettings(page, key3, ctx) {
  if (key3 === "prompt") return renderPromptTab(page, ctx);
  if (key3 === "api") return renderApiTab(page, ctx);
}

// src/tavern/ai-sessions.js
var roles = /* @__PURE__ */ new Set(["user", "assistant", "system", "tool"]);
function createAiSessions(saved, persist, now = Date.now) {
  const data = { sessions: Array.isArray(saved?.sessions) ? structuredClone(saved.sessions) : [], activeId: saved?.activeId };
  const get2 = (id3) => data.sessions.find((session) => session.id === id3);
  const active = () => get2(data.activeId);
  const save = () => persist(data);
  let lastId = 0;
  function create(title = "\u65B0\u5EFA\u4F1A\u8BDD") {
    const ts = now();
    do {
      lastId = Math.max(ts, lastId + 1);
    } while (get2(`sess_${lastId}`));
    const session = { id: `sess_${lastId}`, title, createdAt: ts, updatedAt: ts, messages: [] };
    data.sessions.push(session);
    data.activeId = session.id;
    return session;
  }
  if (!active()) {
    const first = data.sessions[0] ?? create();
    data.activeId = first.id;
  }
  function change(session) {
    session.updatedAt = now();
    save();
  }
  return {
    data,
    active,
    get: get2,
    create() {
      const session = create();
      save();
      return session;
    },
    select(id3) {
      if (get2(id3)) {
        data.activeId = id3;
        save();
      }
    },
    rename(id3, title) {
      const session = get2(id3);
      if (!session || !title.trim()) return;
      session.title = title.trim();
      change(session);
    },
    remove(id3) {
      const index = data.sessions.findIndex((session) => session.id === id3);
      if (index < 0) return;
      data.sessions.splice(index, 1);
      if (data.activeId === id3) data.activeId = (data.sessions[Math.min(index, data.sessions.length - 1)] ?? create()).id;
      save();
    },
    clear(id3) {
      const session = get2(id3);
      if (!session) return;
      session.messages.length = 0;
      change(session);
    },
    append(id3, ...messages) {
      const session = get2(id3);
      if (!session) return [];
      const entries2 = messages.map((message) => {
        if (!roles.has(message.role)) throw new TypeError(`\u672A\u77E5\u6D88\u606F\u89D2\u8272\uFF1A${message.role}`);
        return { ts: now(), ...message };
      });
      session.messages.push(...entries2);
      change(session);
      return entries2;
    },
    update(id3, message, fields3) {
      const session = get2(id3);
      if (!session?.messages.includes(message)) return;
      Object.assign(message, fields3);
      change(session);
    }
  };
}

// src/tavern/ai-page.js
var roleLabels = { user: "\u73A9\u5BB6", assistant: "\u8F85\u52A9 AI", system: "\u7CFB\u7EDF", tool: "\u5DE5\u5177" };
var statusLabels2 = { ok: "\u5B8C\u6210", error: "\u5931\u8D25", aborted: "\u5DF2\u4E2D\u6B62" };
var formatTime = (ts) => new Date(ts).toLocaleString();
function renderMarkdown(target2, content, make) {
  const blocks = content.split(/^```[^\n]*\n|^```[ \t]*(?:\n|$)/m);
  for (const [index, block] of blocks.entries()) {
    if (index % 2) {
      const pre = make("pre");
      pre.append(make("code", {}, block.replace(/\n$/, "")));
      target2.append(pre);
      continue;
    }
    for (const paragraph of block.trim().split(/\n\s*\n/).filter(Boolean)) {
      const node3 = make("p");
      for (const [i, part] of paragraph.split(/`([^`\n]+)`/).entries()) {
        node3.append(i % 2 ? make("code", {}, part) : part);
      }
      target2.append(node3);
    }
  }
}
function mountAiPage(page, { make, on, sessions, send: send2, normalize, stop }) {
  const button = (label) => make("button", { type: "button" }, label);
  const toolbar = make("div", { class: "fated-actions" });
  const select = make("select", { "aria-label": "\u5207\u6362\u4F1A\u8BDD" });
  const create = button("\u65B0\u5EFA"), rename = button("\u91CD\u547D\u540D"), remove = button("\u5220\u9664"), clear = button("\u6E05\u7A7A\u5F53\u524D\u4F1A\u8BDD");
  const check = button("\u6807\u51C6\u5316");
  toolbar.append(select, create, rename, remove, clear, check);
  const edit = make("form", { class: "fated-actions", hidden: "" });
  const title = make("input", { "aria-label": "\u4F1A\u8BDD\u540D\u79F0", maxlength: "80", required: "" });
  const cancel = button("\u53D6\u6D88");
  edit.append(title, make("button", { type: "submit" }, "\u4FDD\u5B58\u540D\u79F0"), cancel);
  const info = make("p", { class: "fated-ai-info" });
  const log = make("div", { class: "fated-ai-log", role: "log", "aria-label": "\u6D88\u606F\u6D41", tabindex: "0" });
  const composer = make("form", { class: "fated-chat" });
  const input = make("textarea", { rows: "3", "aria-label": "\u8F93\u5165\u6D88\u606F", placeholder: "\u8F93\u5165\u6D88\u606F \xB7 Shift+Enter \u6362\u884C" });
  const submit = make("button", { type: "submit" }, "\u53D1\u9001");
  const abort = button("\u505C\u6B62");
  const status2 = make("span", { role: "status" });
  composer.append(input, submit, abort, status2);
  page.append(make("h3", {}, "\u8F85\u52A9 AI"), toolbar, edit, info, log, composer);
  let shownId, busy = false, pinned = true;
  const rows = /* @__PURE__ */ new Map(), drafts = /* @__PURE__ */ new Map();
  function scrollToEnd() {
    if (pinned && log.clientHeight) log.scrollTop = log.scrollHeight;
  }
  function updateMessage(message) {
    let row = rows.get(message);
    if (!row) {
      const bubble = make("article", { class: "fated-ai-message", "data-role": message.role });
      const heading = make("header", {}, roleLabels[message.role] ?? message.role);
      const time = make("time", { datetime: new Date(message.ts).toISOString() }, formatTime(message.ts));
      const badge = make("span");
      heading.append(time, badge);
      const body = make("div", { class: "fated-ai-body" });
      bubble.append(heading, body);
      log.append(bubble);
      row = { bubble, badge, body };
      rows.set(message, row);
    }
    row.bubble.dataset.status = message.status ?? "";
    row.badge.textContent = statusLabels2[message.status] ?? "";
    row.body.replaceChildren();
    if (message.role === "assistant") renderMarkdown(row.body, message.content, make);
    else row.body.textContent = [message.toolName, message.content, message.toolResult == null ? "" : typeof message.toolResult === "string" ? message.toolResult : JSON.stringify(message.toolResult, null, 2)].filter(Boolean).join("\n");
  }
  function render() {
    const session = sessions.active();
    select.replaceChildren(...sessions.data.sessions.map((s) => make("option", { value: s.id }, s.title)));
    select.value = session.id;
    if (shownId !== session.id) {
      shownId = session.id;
      edit.hidden = true;
      input.value = drafts.get(shownId) ?? "";
      pinned = true;
    }
    rows.clear();
    log.replaceChildren();
    for (const message of session.messages) updateMessage(message);
    refresh();
  }
  function refresh() {
    const session = sessions.active();
    info.textContent = `${session.messages.length} \u6761\u6D88\u606F \xB7 \u521B\u5EFA\u4E8E ${formatTime(session.createdAt)}`;
    submit.disabled = busy || !input.value.trim();
    check.disabled = remove.disabled = clear.disabled = busy;
    abort.hidden = !busy;
    status2.textContent = busy ? "AI \u6B63\u5728\u56DE\u590D\u2026" : "";
    scrollToEnd();
  }
  function submitMessage() {
    const value = input.value.trim();
    if (busy || !value) return;
    input.value = "";
    drafts.delete(shownId);
    pinned = true;
    send2(value);
    refresh();
  }
  on(log, "scroll", () => {
    pinned = log.scrollHeight - log.clientHeight - log.scrollTop <= 24;
  });
  on(select, "change", () => {
    sessions.select(select.value);
    render();
  });
  on(create, "click", () => {
    sessions.create();
    render();
    input.focus();
  });
  on(rename, "click", () => {
    title.value = sessions.active().title;
    edit.hidden = false;
    title.focus();
    title.select();
  });
  on(cancel, "click", () => {
    edit.hidden = true;
  });
  on(edit, "submit", (event) => {
    event.preventDefault();
    if (!title.value.trim()) return;
    sessions.rename(shownId, title.value);
    edit.hidden = true;
    render();
  });
  on(remove, "click", () => {
    drafts.delete(shownId);
    sessions.remove(shownId);
    render();
  });
  on(clear, "click", () => {
    sessions.clear(shownId);
    render();
  });
  on(check, "click", normalize);
  on(abort, "click", stop);
  on(input, "input", () => {
    drafts.set(shownId, input.value);
    refresh();
  });
  on(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submitMessage();
  });
  on(composer, "submit", (event) => {
    event.preventDefault();
    submitMessage();
  });
  render();
  return {
    show: scrollToEnd,
    setBusy(value) {
      busy = value;
      refresh();
    },
    feed(id3, ...messages) {
      if (id3 !== shownId) return;
      for (const message of messages) updateMessage(message);
      refresh();
    }
  };
}

// src/tavern/overlay.js
var own6 = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
var isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
var safeProperty = (key3) => !["__proto__", "prototype", "constructor"].includes(key3);
var clone2 = (value) => {
  try {
    return structuredClone(value);
  } catch (_) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_2) {
      return value;
    }
  }
};
function hostWindow() {
  const w = typeof window !== "undefined" ? window : globalThis;
  try {
    return w.parent && w.parent.document ? w.parent : w;
  } catch (_) {
    return w;
  }
}
function hostDocument(preferred) {
  const w = preferred || hostWindow();
  try {
    return w.document || document;
  } catch (_) {
    return typeof document !== "undefined" ? document : null;
  }
}
function getGlobal(host, name) {
  try {
    return host?.[name] ?? globalThis?.[name];
  } catch (_) {
    return void 0;
  }
}
function safeStorage(host) {
  try {
    return host.localStorage;
  } catch (_) {
    return null;
  }
}
function text3(value) {
  return value == null ? "" : String(value);
}
function el(doc, tag, attrs2, content) {
  const n = doc.createElement(tag);
  for (const [key3, value] of Object.entries(attrs2 || {})) {
    if (key3 === "class") n.className = value;
    else if (key3 === "style") n.style.cssText = value;
    else if (key3 === "text") n.textContent = value;
    else if (value != null) n.setAttribute(key3, value);
  }
  if (content != null) n.textContent = content;
  return n;
}
function parseJSON(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}
function balancedJSONObjects(source) {
  const value = text3(source).replaceAll("&quot;", '"').replaceAll("&#34;", '"');
  const results = [];
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== "{") continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < value.length; i++) {
      const ch = value[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        const parsed = parseJSON(value.slice(start, i + 1), null);
        if (parsed) results.push(parsed);
        break;
      }
    }
  }
  return results;
}
function findBattleJSON(source) {
  return balancedJSONObjects(source).reverse().find((value) => isObject(value) && (Array.isArray(value.units) || Array.isArray(value.participants) || value.battleId || value.title || value.sceneTitle)) || null;
}
function deepMerge(base, extra) {
  const result = isObject(base) ? clone2(base) : {};
  if (!isObject(extra)) return result;
  for (const [key3, value] of Object.entries(extra)) {
    if (!safeProperty(key3)) continue;
    if (isObject(value) && isObject(result[key3])) result[key3] = deepMerge(result[key3], value);
    else result[key3] = clone2(value);
  }
  return result;
}
function deletePath(object4, path) {
  if (!path) return;
  const parts = String(path).trim().replace(/^\$\.?/, "").split(".").filter(Boolean);
  if (!parts.length || !parts.every(safeProperty)) return;
  let cursor = object4;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor || typeof cursor !== "object") return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === "object") delete cursor[parts.at(-1)];
}
function excludedList(value) {
  if (Array.isArray(value)) return value.flatMap(excludedList);
  if (typeof value !== "string") return [];
  return value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}
function buildAIRequest(config = {}, messages = []) {
  const body = deepMerge({
    model: config.model || "",
    messages: clone2(messages),
    ...config.temperature !== "" && config.temperature != null ? { temperature: Number(config.temperature) } : {},
    ...config.max_tokens !== "" && config.max_tokens != null ? { max_tokens: Number(config.max_tokens) } : {}
  }, parseJSON(config.extraBody ?? config.additionalBody ?? config.body, {}));
  for (const path2 of excludedList(config.excludeParams ?? config.excludedParams ?? config.excludeBodyParams)) deletePath(body, path2);
  const headers = { "Content-Type": "application/json", ...parseJSON(config.headers ?? config.extraHeaders ?? config.additionalHeaders ?? config.requestHeaders, {}) };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let url = text3(config.baseUrl || config.url || "").trim();
  if (!url) url = "/v1/chat/completions";
  const [endpoint, query] = url.split(/\?(.*)/s, 2);
  const path = endpoint.replace(/\/+$/, "");
  url = (/\/chat\/completions$/.test(path) ? path : `${path}/chat/completions`) + (query ? `?${query}` : "");
  return { url, body, headers };
}
async function requestAI(config, messages, fetchImpl, signal) {
  const request = buildAIRequest(config, messages);
  const fetcher = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetcher) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u6CA1\u6709 fetch");
  const response = await fetcher(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
  const raw = await response.text();
  const data = parseJSON(raw, { content: raw });
  if (!response.ok) throw new Error(`API ${response.status}: ${data?.error?.message || raw || response.statusText}`);
  return data;
}
function messageContent(message) {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  return text3(message.content ?? message.message ?? message.text ?? message.mes ?? message.data?.content ?? "");
}
function messageMeta(message, index = 0) {
  if (!message || typeof message !== "object") return { messageId: `floor-${index}`, swipeId: "0" };
  const messageId = message.message_id ?? message.messageId ?? message.mesid ?? message.mesId ?? message.id ?? message.data?.message_id ?? `floor-${index}`;
  const swipeId = message.swipe_id ?? message.swipeId ?? message.swipe_id_string ?? message.swipe ?? message.data?.swipe_id ?? "0";
  return { messageId: String(messageId), swipeId: String(swipeId) };
}
function fnv1a(value) {
  let hash2 = 2166136261;
  for (const char of String(value)) {
    hash2 ^= char.codePointAt(0);
    hash2 = Math.imul(hash2, 16777619);
  }
  return (hash2 >>> 0).toString(16).padStart(8, "0");
}
function safeKey(value) {
  return text3(value).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 96) || "unknown";
}
function battleKeyFor(chat, message, raw, battle) {
  const meta = messageMeta(message);
  const explicit = battle?.battleId ?? battle?.id ?? "unnamed";
  return [safeKey(chat), safeKey(meta.messageId), safeKey(meta.swipeId), safeKey(explicit), `h_${fnv1a(raw)}`].join("__");
}
function extractTag(source, names) {
  const value = text3(source);
  for (const name of names) {
    const re = new RegExp(`(?:<${name}[^>]*>|\\{${name}\\s*\\})([\\s\\S]*?)(?:<\\/${name}>|\\{\\/${name}\\s*\\})`, "i");
    const match = value.match(re);
    if (match) return match[1].trim();
    const open = new RegExp(`(?:<${name}[^>]*>|\\{${name}\\s*\\})([\\s\\S]*)$`, "i").exec(value);
    if (open) return open[1].replace(new RegExp(`(?:<\\/${name}>|\\{\\/${name}\\s*\\})[\\s\\S]*$`, "i"), "").trim();
  }
  return "";
}
function extractTags(source, name) {
  const value = text3(source), result = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  for (const match of value.matchAll(re)) result.push(match[1].trim());
  return result;
}
function parseLooseYaml(value) {
  try {
    return parseSimpleYaml(value);
  } catch (_) {
  }
  const output = {};
  const lines = text3(value).replace(/^```(?:yaml|yml)?\s*|\s*```$/gim, "").split(/\r?\n/);
  const stack = [{ indent: -1, object: output }];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^(\s*)([-\w\u4e00-\u9fff]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length, key3 = match[2], raw = match[3].trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    let valueOut = raw;
    if (!raw) {
      valueOut = {};
      stack.push({ indent, object: valueOut });
    } else if (/^(true|false)$/i.test(raw)) valueOut = raw.toLowerCase() === "true";
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) valueOut = Number(raw);
    else valueOut = parseJSON(raw, raw.replace(/^['"]|['"]$/g, ""));
    stack.at(-1).object[key3] = valueOut;
    if (isObject(valueOut)) stack.push({ indent, object: valueOut });
  }
  return output;
}
function parseAIResponse(value) {
  const source = typeof value === "object" ? JSON.stringify(value) : text3(value);
  const candidates = [];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  candidates.push(...fenced.map((x) => x.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()));
  candidates.push(source.trim());
  let parsed = null;
  for (const candidate of candidates) {
    parsed = parseJSON(candidate, null);
    if (parsed) break;
  }
  if (!parsed) {
    const objectMatch = source.match(/\{[\s\S]*\}/);
    parsed = parseJSON(objectMatch?.[0], null);
  }
  const patch = parsed?.battle_patch || parsed?.unit_patch || parsed?.patch || (parsed && (parsed.op || parsed.path || parsed.value) ? parsed : null);
  return { data: parsed, patch, text: source };
}
function requestTavernAI(host, config, messages, fetchImpl, signal, onStreamChunk) {
  const options = { fetchImpl, signal, onStreamChunk };
  return config.apiMode === "custom" || config.apiMode === "direct" ? requestViaCustomApi(config, messages, options) : requestViaTavern(host, config, messages, options);
}
function parseJSONPatch(value) {
  const parsed = parseAIResponse(value).data;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.patch)) return parsed.patch;
  if (Array.isArray(parsed?.jsonPatch)) return parsed.jsonPatch;
  if (Array.isArray(parsed?.battle_patch)) return parsed.battle_patch;
  if (Array.isArray(parsed?.unit_patch)) return parsed.unit_patch;
  if (Array.isArray(parsed?.battlePatch)) return parsed.battlePatch;
  if (Array.isArray(parsed?.unitPatch)) return parsed.unitPatch;
  return null;
}
var normalizationPath = /^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/;
var TAVERN_VERSION = "0.1.5";
var DEFAULT_CONFIG = {
  apiMode: "tavern",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.2,
  max_tokens: 2400,
  extraBody: "{}",
  excludeParams: "",
  headers: "{}",
  hideLauncher: false,
  autoScan: true,
  slots: describeSlots(),
  extraText: "",
  aiSessions: { sessions: [], activeId: null },
  debugPrompts: false,
  apiSource: "openai",
  stream: true,
  timeoutMs: 6e4
};
function configFor(storage, key3) {
  try {
    const saved = parseJSON(storage?.getItem(key3), {});
    const mode = saved?.apiMode ?? (saved?.baseUrl ? "direct" : "tavern");
    return deepMerge(DEFAULT_CONFIG, { ...saved, apiMode: mode === "direct" ? "custom" : mode, slots: describeSlots(saved?.slots) });
  } catch {
    return clone2(DEFAULT_CONFIG);
  }
}
function putConfig(storage, key3, value) {
  try {
    if (!storage) return false;
    storage.setItem(key3, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function chatId(host) {
  try {
    const id3 = hostMethod(host, "getChatId")?.() ?? getGlobal(host, "SillyTavern")?.getContext?.()?.chatId;
    if (id3 != null) return String(id3);
  } catch {
  }
  return text3(host?.location?.pathname || "default").replace(/[^\w.-]+/g, "_") || "default";
}
function tavernIdentity(host) {
  const helper = getGlobal(host, "TavernHelper");
  const st = getGlobal(host, "SillyTavern");
  const context = (() => {
    try {
      return st?.getContext?.() || {};
    } catch (_) {
      return {};
    }
  })();
  const candidates = [
    context.name1,
    context.personaName,
    context.persona_name,
    context.persona?.name,
    getGlobal(host, "personaName")
  ];
  for (const value of candidates) if (typeof value === "string" && value.trim()) return value.trim();
  for (const fn of [hostMethod(host, "getPersonaName")]) {
    try {
      const value = typeof fn === "function" ? fn.call(helper) : "";
      if (typeof value === "string" && value.trim()) return value.trim();
    } catch (_) {
    }
  }
  return "";
}
async function tavernMessages(host) {
  const messages = await readChatMessages(host);
  if (messages.length) return messages;
  const doc = hostDocument(host);
  const nodes = doc ? [...doc.querySelectorAll(".mes, .chat-msg, [data-message-id], [data-mesid]")] : [];
  return nodes.map((node3, index) => ({
    message_id: node3.getAttribute("mesid") ?? node3.dataset.messageId ?? node3.dataset.mesid ?? node3.dataset.id ?? `floor-${index}`,
    swipe_id: node3.dataset.swipeId ?? node3.dataset.swipe ?? "0",
    content: node3.querySelector(".mes_text, .message, [data-content]")?.textContent || node3.textContent
  })).filter((item) => item.content);
}
function sourceBundle(variables, messages, chat = "default", preferredMessageId) {
  const list3 = Array.isArray(messages) ? messages : [];
  const latestMessage = list3.at(-1);
  const latestFloor = messageContent(latestMessage ?? variables?.latest_floor ?? variables?.latestFloor ?? "");
  const eligible = list3.filter((message) => message?.role !== "user" && !message?.is_user && message?.role !== "system" && !message?.is_system && (preferredMessageId == null || messageMeta(message).messageId === String(preferredMessageId)));
  const tags2 = ["battle_init", "battle_in", "\u6218\u672F\u6C99\u76D8"];
  const decodeTags = (value) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"');
  const battleSource = eligible.findLast((message) => extractTag(decodeTags(messageContent(message)), tags2));
  const sourceIndex = battleSource ? list3.indexOf(battleSource) : list3.length - 1;
  const joined = list3.slice(0, sourceIndex + 1).map(messageContent).join("\n");
  const allText = decodeTags(messageContent(battleSource ?? eligible.at(-1)));
  let battleRaw = extractTag(allText, tags2);
  if (!battleRaw) {
    const legacy = allText.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*[:：]?\s*([\s\S]+)/i);
    if (legacy) battleRaw = legacy[1].trim();
    else {
      const wrapped = allText.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\\s\\S]+)\}/i);
      if (wrapped) battleRaw = wrapped[1].trim();
    }
  }
  let battleInit = battleRaw ? parseBattleInit(battleRaw) : null;
  if (!isObject(battleInit) || !Array.isArray(battleInit.units) && !Array.isArray(battleInit.participants)) {
    const recovered = battleRaw ? findBattleJSON(battleRaw) : null;
    if (recovered) {
      battleInit = recovered;
      battleRaw = JSON.stringify(recovered, null, 2);
    }
  }
  const charBlocks = extractTags(joined, "char_info");
  const charRaw = charBlocks[0] || "";
  const charInfo = charBlocks.flatMap((raw) => {
    const value = parseJSON(raw, null);
    return value ? [value] : [parseLooseYaml(raw)];
  });
  const mvuData = statData(variables) ?? variables ?? {};
  const sourceMessage = battleSource ?? eligible.at(-1);
  const battleKey = battleInit ? battleKeyFor(chat, sourceMessage, battleRaw, battleInit) : null;
  return {
    mvuData,
    latestFloor: battleSource ? messageContent(battleSource) : latestFloor,
    battleInit,
    charInfo,
    battleRaw,
    charRaw,
    roster: "",
    protagonistName: "",
    battleKey,
    source: sourceMessage ? { ...messageMeta(sourceMessage, sourceIndex), chatId: chat } : null
  };
}
function patchValue(value, table3) {
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(value.filter((item) => item && (item.id || item.name)).map((item, index) => {
    const normalized = clone2(item);
    if (table3 === "covers" || table3 === "interactives" || table3 === "zones") {
      const xyz = normalized.xyz;
      if (Array.isArray(xyz)) {
        normalized.x = Number(xyz[0] ?? 0);
        normalized.y = Number(xyz[1] ?? 0);
        delete normalized.xyz;
      }
    }
    if (table3 === "covers") {
      normalized.name ??= `\u63A9\u4F53${index + 1}`;
      normalized.material ??= "\u672A\u77E5\u6750\u6599";
      normalized.maxHp ??= normalized.hp ?? 1;
      normalized.hp ??= normalized.maxHp;
      normalized.cover ??= normalized.shielding ?? 2;
      for (const key4 of Object.keys(normalized)) if (!["id", "name", "x", "y", "material", "hp", "maxHp", "cover"].includes(key4)) delete normalized[key4];
    }
    if (table3 === "interactives") {
      normalized.name ??= "\u4E92\u52A8\u70B9";
      normalized.kind ??= "barrel";
      normalized.spent ??= false;
      for (const key4 of Object.keys(normalized)) if (!["id", "name", "x", "y", "kind", "spent"].includes(key4)) delete normalized[key4];
    }
    const key3 = String(normalized.id || normalized.name || index);
    return [key3, normalized];
  }));
}
function normalizeSemanticPatch(patch) {
  if (!isObject(patch)) return patch;
  const result = clone2(patch);
  for (const key3 of ["units", "covers", "interactives", "zones", "items", "equipment", "skills"]) if (Array.isArray(result[key3])) result[key3] = patchValue(result[key3], key3);
  if (isObject(result.unit_patch)) {
    const unitPatch = result.unit_patch;
    const id3 = unitPatch.unitId || unitPatch.id;
    if (id3 && isObject(unitPatch.patch)) result.units = { [id3]: unitPatch.patch };
  }
  return result;
}
function applyPatch(target2, patch, strict = false) {
  let result = clone2(target2);
  if (isObject(patch) && !Array.isArray(patch) && !Array.isArray(patch.patch) && !Array.isArray(patch.jsonPatch)) {
    return deepMerge(result, normalizeSemanticPatch(patch.battle_patch || patch));
  }
  const list3 = Array.isArray(patch) ? patch : patch?.patch || patch?.jsonPatch;
  if (!Array.isArray(list3)) return result;
  const pointer2 = (path) => String(path || "").split("/").slice(1).map((x) => x.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (const operation of list3) {
    if (!operation || !operation.op) continue;
    const keys = pointer2(operation.path);
    if (!keys.length || !keys.every(safeProperty)) throw new Error("AI \u8FD4\u56DE\u4E86\u4E0D\u652F\u6301\u7684\u8865\u4E01\u8DEF\u5F84");
    const last = keys.pop();
    let parent = result;
    for (const key3 of keys) {
      if (!own6(parent, key3)) throw new Error(`\u8865\u4E01\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${operation.path}`);
      parent = parent[key3];
    }
    if (parent == null || typeof parent !== "object") throw new Error(`\u8865\u4E01\u8DEF\u5F84\u4E0D\u53EF\u5199\uFF1A${operation.path}`);
    if (strict) {
      if (Array.isArray(parent)) {
        const append = last === "-" && operation.op === "add";
        if (!append && (!/^(0|[1-9]\d*)$/.test(last) || Number(last) > parent.length)) throw new Error(`\u6570\u7EC4\u7D22\u5F15\u65E0\u6548\uFF1A${operation.path}`);
      }
      if (operation.op !== "add" && !own6(parent, last)) throw new Error(`\u8865\u4E01\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${operation.path}`);
      if (operation.op === "add" && Array.isArray(parent) && last !== "-") {
        parent.splice(Number(last), 0, clone2(operation.value));
        continue;
      }
    }
    if (operation.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else if (operation.op === "add" || operation.op === "replace") {
      if (Array.isArray(parent) && last === "-") parent.push(clone2(operation.value));
      else parent[last] = clone2(operation.value);
    }
  }
  return result;
}
function style(doc) {
  const installed = doc.querySelector("style[data-fated-tavern-overlay]");
  if (installed) {
    installed.textContent = tavernTheme;
    return;
  }
  (doc.head || doc.documentElement)?.append(el(doc, "style", { "data-fated-tavern-overlay": "" }, tavernTheme));
}
function mountTavernOverlay(options = {}) {
  const host = options.host || hostWindow();
  const doc = options.document || hostDocument(host);
  if (!doc || !doc.createElement) return { dispose() {
  }, open() {
  }, close() {
  } };
  try {
    host.__fatedTacticalTavern?.dispose?.();
  } catch (_) {
  }
  style(doc);
  const storage = options.storage || safeStorage(host);
  const id3 = options.instanceId || chatId(host);
  const configKey = `fated-tactical/tavern/${id3}`;
  const stateKey = `fated-tactical/instances/${id3}`;
  let config = configFor(storage, configKey);
  const aiSessions = createAiSessions(config.aiSessions, (value) => persistSettings({ aiSessions: value }));
  let disposed = false, gameMount = null, sources = {}, currentState = null, scanEpoch = 0, activeBattleKey = null;
  let selectedMessageId = null, aiController = null, aiFinished, askAI, retryAI = null, aiPage = null;
  const attemptedBattles = /* @__PURE__ */ new Set(), normalizedBattles = /* @__PURE__ */ new Map();
  let battleObserver = null, removeOpenEvent = null, diagnostics = { phase: "created" };
  const listeners = [], controller = typeof AbortController === "function" ? new AbortController() : null;
  const on = (node3, event, fn, opts = {}) => {
    if (!node3) return;
    const options2 = controller ? { ...opts, signal: controller.signal } : opts;
    node3.addEventListener(event, fn, options2);
    if (!controller) listeners.push(() => node3.removeEventListener(event, fn, opts));
  };
  const root = el(doc, "div", { "data-fated-tavern-overlay": "" });
  const launcher = el(doc, "button", { class: "fated-tavern-launcher", title: `\u6253\u5F00\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0 \xB7 v${TAVERN_VERSION}`, "aria-label": `\u6253\u5F00\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0 \xB7 v${TAVERN_VERSION}`, type: "button" }, "\u{1FA84}");
  const panel = el(doc, "section", { class: "fated-tavern-panel", role: "dialog", "aria-label": "\u547D\u5B9A\u6218\u672F\u9152\u9986\u63A7\u5236\u53F0", hidden: "" });
  const header = el(doc, "header", { class: "fated-tavern-header" });
  const title = el(doc, "strong", {}, `\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0 v${TAVERN_VERSION}`);
  const minimize = el(doc, "button", { type: "button", title: "\u6700\u5C0F\u5316", "aria-label": "\u6700\u5C0F\u5316" }, "\u2212");
  const close = el(doc, "button", { type: "button", title: "\u5173\u95ED", "aria-label": "\u5173\u95ED" }, "\xD7");
  header.append(title, minimize, close);
  const tabs = el(doc, "nav", { class: "fated-tavern-tabs", role: "tablist" });
  const content = el(doc, "div", { class: "fated-tavern-content" });
  const pages = {};
  for (const [key3, label] of [["instances", "\u{1F4E6} \u5B9E\u4F8B\u7EF4\u62A4"], ["prompt", "\u{1F9E9} \u63D0\u793A\u8BCD\u7EC4\u88C5"], ["api", "\u{1F50C} API \u8BBE\u7F6E"], ["ai", "\u{1F916} \u8F85\u52A9 AI"], ["sandbox", "\u2694\uFE0F \u6C99\u76D8"]]) {
    const button = el(doc, "button", { type: "button", role: "tab", "aria-selected": key3 === "instances" ? "true" : "false", "data-tab": key3 }, label);
    const page = el(doc, "div", { class: `fated-tab ${key3 === "instances" ? "active" : ""}`, "data-page": key3 });
    tabs.append(button);
    content.append(page);
    pages[key3] = page;
    on(button, "click", () => {
      Object.entries(pages).forEach(([name, node3]) => {
        node3.classList.toggle("active", name === key3);
      });
      [...tabs.children].forEach((x) => x.setAttribute("aria-selected", String(x === button)));
      if (key3 === "prompt" || key3 === "api") renderSettings(page, key3, settingsContext());
      if (key3 === "ai") aiPage?.show();
    });
  }
  const toast = el(doc, "aside", { class: "fated-toast", hidden: "", role: "status", "aria-live": "polite" });
  const noticeTitle = el(doc, "strong"), noticeBody = el(doc, "p");
  const retry = el(doc, "button", { type: "button" }, "\u91CD\u8BD5");
  const dismiss = el(doc, "button", { type: "button" }, "\u5173\u95ED");
  const icon = el(doc, "span", { "aria-hidden": "true" });
  const heading = el(doc, "header");
  heading.append(icon, noticeTitle);
  const issues = el(doc, "section", { class: "fated-toast-issues" });
  const summary = el(doc, "p", { class: "fated-toast-summary" });
  const actions = el(doc, "footer");
  actions.append(retry, dismiss);
  toast.append(heading, noticeBody, summary, actions);
  on(retry, "click", () => retryAI?.());
  on(dismiss, "click", () => {
    toast.hidden = true;
  });
  let rawDetails;
  function notify(title2, detail = "", onRetry = null, busy = false, { tone = "neutral", applied, unresolved = [], raw = "" } = {}) {
    retryAI = onRetry;
    toast.dataset.tone = tone;
    icon.textContent = busy ? "\u2026" : tone === "success" ? "\u2713" : tone === "error" ? "!" : "\u24D8";
    summary.hidden = applied == null;
    summary.textContent = applied == null ? "" : `\u5DF2\u5E94\u7528 ${applied} \u9879\u8865\u4E01 \xB7 \u5269\u4F59 ${unresolved.length} \u9879\u672A\u89E3\u51B3`;
    rawDetails?.remove();
    rawDetails = null;
    issues.remove();
    if (unresolved.length) {
      const list3 = el(doc, "ul");
      for (const issue of unresolved) list3.append(el(doc, "li", {}, issue));
      issues.replaceChildren(el(doc, "h4", {}, `\u672A\u89E3\u51B3\uFF08${unresolved.length} \u9879\uFF09`), list3);
      toast.insertBefore(issues, actions);
    }
    if (raw) {
      rawDetails = el(doc, "details", { class: "fated-toast-raw" });
      rawDetails.append(el(doc, "summary", {}, `\u6A21\u578B\u8FD4\u56DE\u7ED3\u679C\uFF08\u5DF2\u5E94\u7528 ${applied ?? 0} \u9879\uFF09`), el(doc, "pre", {}, raw));
      toast.insertBefore(rawDetails, actions);
    }
    noticeTitle.textContent = title2;
    noticeBody.textContent = detail;
    noticeBody.hidden = !detail;
    retry.hidden = !onRetry;
    dismiss.hidden = busy;
    toast.hidden = false;
  }
  panel.append(header, tabs, content);
  root.append(launcher, panel, toast);
  (doc.body || doc.documentElement)?.append(root);
  const instances = (() => {
    try {
      return parseJSON(storage?.getItem(stateKey)) ?? config.instances;
    } catch {
      return config.instances;
    }
  })();
  config.instances = isObject(instances) ? instances : {};
  function save() {
    putConfig(storage, stateKey, config.instances);
  }
  let localOnly = false;
  function syncSettings() {
    if (localOnly || !storage) return;
    const { instances: _legacyInstances, aiSessions: _savedSessions, ...latest } = configFor(storage, configKey);
    Object.assign(config, latest);
  }
  function persistSettings(patch, previousSlots = config.slots) {
    syncSettings();
    if (patch.slots && JSON.stringify(previousSlots) !== JSON.stringify(config.slots)) {
      renderSettings(pages.prompt, "prompt", settingsContext());
      notify("\u69FD\u4F4D\u5DF2\u5728\u5176\u4ED6\u7A97\u53E3\u66F4\u65B0", "\u5DF2\u8F7D\u5165\u6700\u65B0\u5217\u8868\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C\u521A\u624D\u7684\u7F16\u8F91\u3002");
      return;
    }
    Object.assign(config, patch);
    const { instances: instances2, ...settings } = config;
    try {
      if (storage && storage.getItem(stateKey) == null) putConfig(storage, stateKey, instances2);
    } catch {
    }
    localOnly = !putConfig(storage, configKey, settings);
    if (localOnly) notify("\u8BBE\u7F6E\u4EC5\u5728\u672C\u7A97\u53E3\u751F\u6548", "\u65E0\u6CD5\u5199\u5165\u6D4F\u89C8\u5668\u5B58\u50A8\uFF1B\u91CD\u8F7D\u540E\u53EF\u80FD\u4E22\u5931\u3002");
  }
  if (!config.aiSessions?.sessions?.length || config.aiSessions.activeId !== aiSessions.data.activeId) {
    persistSettings({ aiSessions: aiSessions.data });
  } else config.aiSessions = aiSessions.data;
  async function open() {
    if (disposed) return;
    panel.hidden = false;
    launcher.hidden = true;
    if (config.autoScan !== false) {
      selectedMessageId = null;
      await scan();
    }
  }
  function hide() {
    panel.hidden = true;
    launcher.hidden = Boolean(config.hideLauncher);
  }
  function bindEventBus() {
    const eventOn = hostMethod(host, "eventOn");
    if (typeof eventOn !== "function") return;
    const handler = () => {
      open().catch(showError);
    };
    try {
      const result = eventOn("fated_tactical:open_ui", handler);
      if (typeof result === "function") removeOpenEvent = result;
      else if (result?.off && typeof result.off === "function") removeOpenEvent = () => result.off();
    } catch (_) {
    }
  }
  function closePanel() {
    hide();
  }
  on(launcher, "click", open);
  on(close, "click", closePanel);
  on(minimize, "click", hide);
  on(doc, "click", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    const trigger = path.find((node3) => node3?.matches?.("[data-fated-battle-open], .fated-battle-enter"));
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      const floor = trigger.closest("[mesid], [data-message-id], [data-mesid]");
      selectedMessageId = floor?.getAttribute("mesid") ?? floor?.dataset.messageId ?? floor?.dataset.mesid ?? null;
      panel.hidden = false;
      launcher.hidden = true;
      switchTab("sandbox");
      void scan();
    }
  }, { capture: true });
  function draggable(node3, handle) {
    const surface = handle || node3;
    let drag = null;
    on(surface, "pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = node3.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    });
    on(surface, "pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        node3.style.right = "auto";
        node3.style.bottom = "auto";
        node3.style.left = `${drag.left}px`;
        node3.style.top = `${drag.top}px`;
        surface.setPointerCapture?.(event.pointerId);
      }
      node3.style.left = `${Math.max(0, drag.left + dx)}px`;
      node3.style.top = `${Math.max(0, drag.top + dy)}px`;
      event.preventDefault();
    });
    const stop = (event) => {
      if (drag?.pointerId === event.pointerId) drag = null;
    };
    on(surface, "pointerup", stop);
    on(surface, "pointercancel", stop);
    on(surface, "lostpointercapture", stop);
  }
  draggable(panel, header);
  function battleEntry(raw) {
    const details = el(doc, "details", { class: "fated-battle-entry" });
    const summary2 = el(doc, "summary", {}, "\u2694 \u8FDB\u5165\u6218\u573A \xB7 \u70B9\u51FB\u5C55\u5F00\u5165\u53E3");
    const meta = el(doc, "div", { class: "fated-battle-meta" }, "\u5DF2\u8BC6\u522B battle_init \xB7 \u53EF\u5728\u63A7\u5236\u53F0\u52A0\u8F7D\u6218\u5C40");
    const pre = el(doc, "pre", { class: "fated-battle-source" }, raw);
    const enter = el(doc, "button", { type: "button", class: "fated-battle-enter" }, "\u6253\u5F00\u6218\u573A\u63A7\u5236\u53F0");
    details.append(summary2, meta, pre, enter);
    return details;
  }
  function foldBattleEntries() {
    const candidates = [...doc.querySelectorAll(".mes_text, .mes_text_wrap, .mes, .chat-msg, .message, [data-content], [data-message-id], [data-mesid]")];
    const seen = /* @__PURE__ */ new Set();
    for (const content2 of candidates) {
      const rootNode = content2.matches?.(".mes, .chat-msg, [data-message-id], [data-mesid]") ? content2.querySelector(".mes_text, .mes_text_wrap, .message, [data-content]") || content2 : content2;
      if (!rootNode || seen.has(rootNode) || rootNode.closest("[data-fated-tavern-overlay]") || rootNode.dataset.fatedBattleFolded === "true") continue;
      seen.add(rootNode);
      const tag = rootNode.querySelector?.("battle_init");
      if (tag) {
        tag.replaceWith(battleEntry(`<battle_init>
${tag.textContent || ""}
</battle_init>`));
        rootNode.dataset.fatedBattleFolded = "true";
        continue;
      }
      const walker = doc.createTreeWalker?.(rootNode, 4);
      if (!walker) continue;
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node3 of textNodes) {
        const raw = node3.nodeValue || "";
        const match = raw.match(/(?:<|&lt;)battle_init(?:\s[^>]*?)?(?:>|&gt;)[\s\S]*?(?:<|&lt;)\/battle_init(?:>|&gt;)/i);
        if (!match) continue;
        const replacement = doc.createDocumentFragment();
        if (match.index) replacement.append(doc.createTextNode(raw.slice(0, match.index)));
        replacement.append(battleEntry(match[0].replaceAll("&lt;", "<").replaceAll("&gt;", ">")));
        if (match.index + match[0].length < raw.length) replacement.append(doc.createTextNode(raw.slice(match.index + match[0].length)));
        node3.parentNode?.replaceChild(replacement, node3);
        rootNode.dataset.fatedBattleFolded = "true";
        break;
      }
    }
  }
  function renderInstances() {
    const page = pages.instances;
    page.replaceChildren(el(doc, "h3", {}, "\u6218\u573A\u5165\u53E3"));
    const battleCard = el(doc, "article", { class: "fated-battle-card" });
    const battle = sources.battleInit;
    battleCard.append(el(doc, "div", { class: "fated-card-kicker" }, `\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0 v${TAVERN_VERSION} \xB7 ${battle ? "BATTLE INIT \xB7 \u5DF2\u8BC6\u522B" : "BATTLE INIT \xB7 \u7B49\u5F85\u626B\u63CF"}`));
    battleCard.append(el(doc, "h4", {}, battle?.sceneTitle || battle?.title || "\u5C1A\u672A\u53D1\u73B0\u6B63\u6587\u6218\u573A"));
    battleCard.append(el(doc, "p", { class: "fated-mini" }, battle ? `${battle.battleType || "\u6807\u51C6\u6218\u6597"} \xB7 ${battle.units?.length || battle.participants?.length || 0} \u540D\u53C2\u4E0E\u8005 \xB7 ${battle.covers?.length || 0} \u4E2A\u63A9\u4F53` : "\u70B9\u51FB\u626B\u63CF\u5F53\u524D\u804A\u5929\uFF0C\u8BFB\u53D6\u6700\u65B0\u6B63\u6587\u4E2D\u7684 battle_init\u3002"));
    const battleActions = el(doc, "div", { class: "fated-actions" });
    const loadBattle = el(doc, "button", { type: "button", class: "fated-primary" }, battle ? "\u52A0\u8F7D\u6218\u573A" : "\u626B\u63CF\u5E76\u52A0\u8F7D");
    const showSource = el(doc, "details", { class: "fated-battle-source-box" });
    showSource.append(el(doc, "summary", {}, "\u67E5\u770B\u539F\u59CB battle_init"), el(doc, "pre", { class: "fated-battle-source" }, sources.battleRaw || "\u6682\u65E0\u539F\u59CB\u6570\u636E"));
    battleActions.append(loadBattle);
    battleCard.append(battleActions, showSource);
    page.append(battleCard);
    const diag = el(doc, "details", { class: "fated-diagnostics" });
    diag.append(el(doc, "summary", {}, "\u8BCA\u65AD\u65E5\u5FD7\uFF08\u626B\u63CF\u6765\u6E90 / \u53BB\u91CD\uFF09"));
    diag.append(el(doc, "pre", { class: "fated-status", "data-diagnostics": "" }, JSON.stringify(diagnostics, null, 2)));
    page.append(diag);
    on(loadBattle, "click", async () => {
      switchTab("sandbox");
      await scan();
    });
    const toolbar = el(doc, "div", { class: "fated-actions" });
    const refresh = el(doc, "button", { type: "button" }, "\u4ECE\u5F53\u524D\u804A\u5929\u91CD\u65B0\u6C34\u5408");
    toolbar.append(refresh);
    page.append(toolbar);
    const list3 = el(doc, "div");
    page.append(list3);
    const entries2 = Object.entries(config.instances);
    if (!entries2.length) list3.append(el(doc, "p", { class: "fated-mini" }, "\u6682\u65E0\u5B9E\u4F8B\u3002\u6253\u5F00\u6C99\u76D8\u4F1A\u81EA\u52A8\u8BFB\u53D6\u5F53\u524D MVU\u3001char_info \u548C battle_init\u3002"));
    for (const [key3, instance] of entries2) {
      const box = el(doc, "article", { class: "fated-instance" });
      box.append(el(doc, "strong", {}, instance.name || key3), el(doc, "div", { class: "fated-mini" }, `\u6765\u6E90\uFF1A${instance.source || "\u624B\u52A8\u6216 AI \u7F16\u8F91"} \xB7 ${instance.notes || "\u5DF2\u6807\u51C6\u5316"}`));
      box.append(el(doc, "pre", { class: "fated-status" }, JSON.stringify(instance, null, 2)));
      const actions2 = el(doc, "div", { class: "fated-actions" });
      const edit = el(doc, "button", { type: "button" }, "\u7F16\u8F91 JSON");
      const remove = el(doc, "button", { type: "button" }, "\u5220\u9664");
      actions2.append(edit, remove);
      box.append(actions2);
      list3.append(box);
      on(remove, "click", () => {
        delete config.instances[key3];
        save();
        renderInstances();
      });
      on(edit, "click", () => {
        const value = prompt("\u7F16\u8F91\u5B9E\u4F8B JSON", JSON.stringify(instance, null, 2));
        const parsed = parseJSON(value, null);
        if (parsed) {
          config.instances[key3] = parsed;
          save();
          renderInstances();
        }
      });
    }
    on(refresh, "click", () => {
      selectedMessageId = null;
      void scan(true);
    });
  }
  function switchTab(key3) {
    const button = tabs.querySelector(`[data-tab="${key3}"]`);
    button?.click();
  }
  let promptKind = "validate", promptInstruction = "";
  let previewSink, lastSent = null;
  function assemblyContext(kind = promptKind, instruction = promptInstruction) {
    return { kind, instruction, state: liveState(), sources, roster: Object.values(config.instances), extraText: config.extraText };
  }
  function publishMessages(messages, kind = promptKind) {
    previewSink?.(messages, kind);
    return messages;
  }
  function prepareMessages(kind = promptKind, instruction = promptInstruction, sending = false) {
    const slots = config.slots;
    const messages = assembleMessages(slots, assemblyContext(kind, instruction));
    if (config.debugPrompts) console.debug("[fated:prompts]", {
      kind,
      slots: slots.map((s) => ({ id: s.id, enabled: s.enabled })),
      messages: messages.map(({ slotId, role, content: content2 }) => ({ slotId, role, chars: content2.length }))
    });
    if (sending && messages.length) lastSent = messages;
    return publishMessages(messages, kind);
  }
  function settingsContext() {
    syncSettings();
    return {
      host,
      settings: config,
      slots: config.slots,
      assemblyContext,
      prepareMessages,
      lastSent: () => lastSent,
      onPreview(fn) {
        previewSink = fn;
      },
      fetchImpl: options.fetch,
      save: persistSettings
    };
  }
  function runNormalize(sessionId) {
    return askAI("validate", "", sessionId);
  }
  async function hydrate(epoch) {
    const messages = await tavernMessages(host);
    const nextSources = sourceBundle({}, messages, chatId(host), selectedMessageId);
    const messageId = Number(nextSources.source?.messageId);
    nextSources.mvuData = clone2(await readBattleVariables(host, messageId));
    nextSources.protagonistName = tavernIdentity(host);
    if (epoch !== scanEpoch || disposed) return null;
    sources = nextSources;
    foldBattleEntries();
    if (!sources.battleInit) {
      diagnostics = { phase: "no-battle" };
      config.instances = {};
      return null;
    }
    const converter = options.converter || getGlobal(host, "FatedTactical")?.hydrateBattleState || getGlobal(host, "hydrateBattleState") || hydrateFromSources;
    let hydrated = null;
    let conversionError = null;
    if (typeof converter === "function") {
      const input = { mvu: sources.mvuData, stat_data: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, protagonistName: sources.protagonistName };
      try {
        hydrated = await converter(input);
      } catch (error2) {
        conversionError = error2;
      }
    }
    if (epoch !== scanEpoch || disposed) return null;
    if (conversionError) {
      diagnostics = { phase: "conversion-error", error: conversionError?.stack || conversionError?.message || String(conversionError), mvuKeys: Object.keys(sources.mvuData || {}), charCount: sources.charInfo?.length || 0, participantCount: sources.battleInit?.units?.length || sources.battleInit?.participants?.length || 0 };
      try {
        console.error("[fated-tactical] hydrate failed", diagnostics);
      } catch (_) {
      }
      const diagnosticNode2 = pages.instances.querySelector("[data-diagnostics]");
      if (diagnosticNode2) diagnosticNode2.textContent = JSON.stringify(diagnostics, null, 2);
      throw conversionError;
    }
    sources.warnings = hydrated?.warnings ?? [];
    sources.sourceMap = hydrated?.sourceMap ?? {};
    sources.seed = hydrated?.seed ?? hydrated?.state?.rng;
    sources.input = { mvu: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, latestFloor: sources.latestFloor, battleText: sources.battleRaw, protagonistName: sources.protagonistName };
    if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
    const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
    const nextInstances = {};
    for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) {
      const key3 = item.id || item.uid || item.name || `unit-${Object.keys(nextInstances).length + 1}`;
      nextInstances[key3] = { ...clone2(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? "MVU \u4E3B\u89D2" : "\u6B63\u6587 <char_info>") };
    }
    config.instances = nextInstances;
    diagnostics = {
      phase: "hydrated",
      version: TAVERN_VERSION,
      mvuKeys: Object.keys(sources.mvuData || {}),
      protagonistName: sources.protagonistName || "",
      charCount: sources.charInfo?.length || 0,
      participantCount: sources.battleInit?.units?.length || sources.battleInit?.participants?.length || 0,
      rosterCount: Array.isArray(roster) ? roster.length : Object.keys(roster || {}).length,
      rosterIds: (Array.isArray(roster) ? roster : Object.values(roster || {})).map((item) => `${item.id || item.name}:${item.source || "unknown"}`),
      fieldSources: (Array.isArray(roster) ? roster : Object.values(roster || {})).map((item) => ({ id: item.id, name: item.name, source: item.source, fieldSources: item.fieldSources })),
      instanceCount: Object.keys(config.instances).length,
      unitIds: Object.values(hydrated?.state?.units || {}).map((unit) => `${unit.id}:${unit.name}:${unit.team}`),
      warnings: hydrated?.warnings || []
    };
    save();
    const diagnosticNode = pages.instances.querySelector("[data-diagnostics]");
    if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
    return hydrated;
  }
  function mountState(state, restoreSaved = false) {
    gameMount?.unmount?.();
    gameMount = null;
    if (!state) return;
    const battleInstanceId = sources.battleKey || id3;
    const battleInput = sources.input;
    const target2 = pages.sandbox.querySelector("[data-sandbox-mount]");
    const restart = ({ seed, mode }) => {
      const next = hydrateFromSources(battleInput, { seed, mode, throwOnValidation: true }).state;
      return applyNormalization(next, normalizedBattles.get(battleInstanceId));
    };
    gameMount = (options.mount || mount)(target2, {
      instanceId: battleInstanceId,
      storage,
      state,
      customBattle: { seed: sources.seed, restart, restoreSaved }
    });
  }
  function showError(error2) {
    const node3 = pages.sandbox.querySelector("[data-status]");
    if (node3) node3.textContent = `\u9519\u8BEF\uFF1A${error2?.message || error2}`;
  }
  function liveState() {
    return gameMount?.getState?.() ?? currentState;
  }
  function applyNormalization(state, patch) {
    if (!patch?.length) return state;
    const next = applyPatch(state, patch, true);
    (options.validateState || validateState)(next);
    refreshOpeningInitiative(next);
    syncEquipmentEffects(next);
    refreshOutcome(next);
    return next;
  }
  async function scan(force = false) {
    const epoch = ++scanEpoch;
    const node3 = pages.sandbox.querySelector("[data-status]");
    if (node3) node3.textContent = "\u6B63\u5728\u8BFB\u53D6 MVU\u3001\u6700\u65B0\u697C\u5C42\u5E76\u8F6C\u6362\u2026";
    try {
      const hydrated = await hydrate(epoch);
      if (epoch !== scanEpoch || disposed) return;
      const nextState = hydrated?.state ?? null;
      if (force || !gameMount || activeBattleKey !== sources.battleKey) {
        if (aiController) {
          const finished = aiFinished;
          aiController.abort();
          attemptedBattles.delete(activeBattleKey);
          await finished;
          if (epoch !== scanEpoch || disposed) return;
        }
        if (force) {
          attemptedBattles.delete(sources.battleKey);
          normalizedBattles.delete(sources.battleKey);
        }
        toast.hidden = true;
        currentState = nextState ? applyNormalization(nextState, normalizedBattles.get(sources.battleKey)) : null;
        activeBattleKey = sources.battleKey;
        mountState(currentState, !force);
      }
      renderInstances();
      if (currentState && !aiController && sources.warnings?.length && !attemptedBattles.has(activeBattleKey) && !normalizedBattles.has(activeBattleKey)) {
        attemptedBattles.add(activeBattleKey);
        void runNormalize();
      }
      if (node3) node3.textContent = currentState ? `\u626B\u63CF\u5B8C\u6210\uFF1A${Object.values(currentState.units || {}).map((unit) => `${unit.name}(${unit.id})`).join("\u3001")}` : "\u626B\u63CF\u5B8C\u6210\uFF08\u672A\u627E\u5230\u53EF\u6302\u8F7D\u7684\u6218\u5C40\uFF09\u3002";
    } catch (e) {
      diagnostics = { ...diagnostics, phase: "scan-error", error: e?.stack || e?.message || String(e) };
      try {
        console.error("[fated-tactical] scan failed", diagnostics);
      } catch (_) {
      }
      const diagnosticNode = pages.instances.querySelector("[data-diagnostics]");
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      showError(e);
      notify("\u6218\u5C40\u52A0\u8F7D\u5931\u8D25", e.message, () => scan(force));
    }
  }
  function renderSandbox() {
    const page = pages.sandbox;
    page.replaceChildren(el(doc, "h3", {}, "\u6C99\u76D8"));
    const status2 = el(doc, "div", { class: "fated-status", "data-status": "" }, "\u6253\u5F00\u6B64\u9875\u4F1A\u81EA\u52A8\u4FA6\u6D4B\u5F53\u524D\u804A\u5929\u3002");
    page.append(status2);
    const mountTarget = el(doc, "div", { "data-sandbox-mount": "" });
    page.append(mountTarget);
    const actions2 = el(doc, "div", { class: "fated-actions" });
    const check = el(doc, "button", { type: "button" }, "\u6807\u51C6\u5316");
    const report = el(doc, "button", { type: "button" }, "\u6218\u62A5\u4EA4\u4ED8");
    const refresh = el(doc, "button", { type: "button" }, "\u91CD\u65B0\u626B\u63CF");
    actions2.append(check, report, refresh);
    page.append(actions2);
    const output = status2;
    on(refresh, "click", () => scan(true).catch(showError));
    on(report, "click", () => {
      try {
        const reportText = gameMount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.() || (currentState ? `\u5F53\u524D\u6218\u5C40\uFF1A${currentState.title} \xB7 \u56DE\u5408 ${currentState.round} \xB7 ${Object.values(currentState.units || {}).length} \u4E2A\u5355\u4F4D` : "");
        const patch = liveState() ? buildMvuJsonPatch(liveState(), sources.sourceMap) : gameMount?.exportMvuPatch?.() || options.game?.exportMvuPatch?.() || "";
        const result = [reportText, patch].filter(Boolean).join("\n\n");
        const textarea = doc.querySelector("#send_textarea");
        if (textarea) {
          textarea.value = result;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(result).catch(() => {
        });
        output.textContent = result || "\u5F53\u524D\u6CA1\u6709\u53EF\u4EA4\u4ED8\u7684\u6218\u62A5\u3002";
      } catch (e) {
        showError(e);
      }
    });
    on(check, "click", () => runNormalize());
  }
  askAI = async (kind, requestText = "", sessionId = kind === "chat" ? aiSessions.active().id : void 0) => {
    if (aiController || kind === "chat" && !requestText) return;
    syncSettings();
    promptKind = kind;
    promptInstruction = requestText;
    const normalize = kind === "validate";
    const session = aiSessions.get(sessionId);
    if (sessionId && !session) return;
    const history = !normalize && session ? session.messages.filter(
      (m) => (m.role === "user" || m.role === "assistant") && m.content?.trim() && m.status !== "error" && m.status !== "aborted"
    ).map(({ role, content: content2 }) => ({ role, content: content2 })) : [];
    const entries2 = session ? aiSessions.append(
      session.id,
      { role: "user", content: normalize ? "\u6807\u51C6\u5316" : requestText, status: "ok" },
      { role: "assistant", content: "" }
    ) : [];
    const assistantMessage = entries2[1];
    const feed = (...messages) => {
      if (session) aiPage?.feed(session.id, ...messages);
    };
    const updateReply = (fields3, persist = true) => {
      if (!assistantMessage) return;
      if (persist) aiSessions.update(session.id, assistantMessage, fields3);
      else Object.assign(assistantMessage, fields3);
      feed(assistantMessage);
    };
    const postStatus = (content2, status2) => {
      if (session) feed(...aiSessions.append(session.id, { role: "system", content: content2, status: status2 }));
    };
    feed(...entries2);
    const key3 = activeBattleKey;
    const controller2 = new AbortController();
    aiController = controller2;
    let finish;
    aiFinished = new Promise((resolve) => {
      finish = resolve;
    });
    aiPage?.setBusy(true);
    const timeout = setTimeout(() => controller2.abort(new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u9152\u9986\u4E3B\u63A5\u53E3\u6216\u72EC\u7ACB API")), config.timeoutMs ?? 6e4);
    const label = normalize ? "\u6807\u51C6\u5316" : "AI \u8C03\u6574";
    const retryRequest = () => askAI(kind, requestText, sessionId);
    if (normalize) notify("\u6B63\u5728\u6807\u51C6\u5316\u4E2D\u2026", "", null, true);
    else toast.hidden = true;
    let receivedPatch = normalize, replyText = "", unresolved = [], appliedCount = 0;
    try {
      if (normalize && !liveState()) {
        if (!session) {
          toast.hidden = true;
          return;
        }
        throw new Error("\u6CA1\u6709\u53EF\u6807\u51C6\u5316\u7684\u6218\u5C40\uFF0C\u8BF7\u5148\u626B\u63CF\u6C99\u76D8");
      }
      let prompts = prepareMessages(kind, requestText, true);
      if (!normalize) {
        prompts = [...prompts, ...history, { role: "user", content: requestText }];
        lastSent = prompts;
        publishMessages(prompts, kind);
      }
      if (!prompts.length) throw new Error("\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u63D0\u793A\u8BCD\uFF0C\u8BF7\u5728\u63D0\u793A\u8BCD\u7EC4\u88C5\u9875\u542F\u7528\u6709\u5185\u5BB9\u7684\u69FD\u4F4D");
      const streamUpdate = (snapshot, done, info) => {
        if (disposed || controller2.signal.aborted || aiController !== controller2 || activeBattleKey !== key3) return;
        if (snapshot) updateReply({ content: snapshot }, false);
        if (!normalize) return;
        noticeBody.textContent = info?.isHeartbeat ? `\u5DF2\u7B49\u5F85 ${info.elapsedSec} \u79D2\uFF0C\u8FDE\u63A5\u4ECD\u5728\u4FDD\u6301\u2026` : done ? "\u5DF2\u6536\u5230\u5B8C\u6574\u54CD\u5E94\uFF0C\u6B63\u5728\u6821\u9A8C\u2026" : `\u5DF2\u6536\u5230 ${snapshot.length} \u5B57\u7B26\u2026`;
        noticeBody.hidden = false;
      };
      const cancelled = new Promise((_, reject) => controller2.signal.addEventListener("abort", () => reject(controller2.signal.reason), { once: true }));
      const validate = options.validateState || validateState;
      let patch, nextState, combined;
      for (let attempt = 0; ; attempt++) {
        const reply = await Promise.race([
          requestTavernAI(host, config, prompts, options.fetch, controller2.signal, streamUpdate),
          cancelled
        ]);
        controller2.signal.throwIfAborted();
        if (disposed || aiController !== controller2 || key3 !== activeBattleKey) return;
        replyText = reply;
        try {
          const parsed = parseAIResponse(reply);
          patch = parseJSONPatch(reply) ?? (normalize ? null : parsed.patch);
          const pending = parsed.data?.unresolved ?? [];
          if (!Array.isArray(pending) && normalize) throw new Error("unresolved \u5FC5\u987B\u662F JSON \u6570\u7EC4");
          unresolved = Array.isArray(pending) ? pending.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : [];
          receivedPatch = normalize || patch != null || ["patch", "battle_patch", "unit_patch"].some((field) => Object.hasOwn(parsed.data ?? {}, field));
          if (!receivedPatch) {
            updateReply({ content: reply, status: "ok" });
            return;
          }
          if (!patch) throw new Error("\u6A21\u578B\u672A\u8FD4\u56DE\u6709\u6548\u7684\u6218\u5C40\u8865\u4E01");
          if (!liveState()) throw new Error("\u6CA1\u6709\u53EF\u5E94\u7528\u8865\u4E01\u7684\u6218\u5C40\uFF0C\u8BF7\u5148\u626B\u63CF\u6C99\u76D8");
          if (normalize) {
            if (!Array.isArray(patch)) throw new Error("patch \u5FC5\u987B\u662F JSON \u6570\u7EC4");
            for (const [index, operation] of patch.entries()) {
              if (!["add", "replace", "remove"].includes(operation?.op) || typeof operation.path !== "string" || !normalizationPath.test(operation.path) || operation.op !== "remove" && !own6(operation, "value")) {
                throw new Error(`\u7B2C ${index + 1} \u9879\u8DEF\u5F84\u6216\u64CD\u4F5C\u65E0\u6548\uFF08${text3(operation?.path).slice(0, 120) || "\u7F3A\u5C11 path"}\uFF09`);
              }
            }
          }
          if (normalize && !patch.length) throw new Error("\u6A21\u578B\u8FD4\u56DE\u7A7A\u8865\u4E01\uFF0C\u6CA1\u6709\u53EF\u6CE8\u5165\u7684\u53D8\u66F4");
          nextState = (options.applyPatch ?? applyPatch)(liveState(), patch, normalize);
          validate(nextState);
          if (normalize && patch.length) {
            refreshOpeningInitiative(nextState);
            combined = [...normalizedBattles.get(key3) ?? [], ...patch];
            const baseline = hydrateFromSources(sources.input, { throwOnValidation: true }).state;
            validate(applyNormalization(baseline, combined));
          }
          syncEquipmentEffects(nextState);
          refreshOutcome(nextState);
          validate(nextState);
          break;
        } catch (error2) {
          if (!normalize || attempt > 0) throw error2;
          notify("\u6B63\u5728\u6807\u51C6\u5316\u4E2D\u2026", "\u6A21\u578B\u6B63\u5728\u4FEE\u6B63\u8865\u4E01\u683C\u5F0F", null, true);
          prompts = [...prompts, { role: "user", content: `\u4E0A\u4E00\u6761\u8F93\u51FA\u6821\u9A8C\u5931\u8D25\uFF08${error2.message}\uFF09\u3002\u6309\u4E0A\u9762\u7684\u4F8B\u5B50\u4F7F\u7528\u7CBE\u786E ID \u548C\u8DEF\u5F84\uFF0C\u91CD\u65B0\u8F93\u51FA\u5B8C\u6574 JSON \u5BF9\u8C61\u3002
\u4E0A\u4E00\u6761\u8F93\u51FA\uFF1A${reply.slice(0, 3500)}` }];
          lastSent = prompts;
          publishMessages(prompts, kind);
        }
      }
      if (!Array.isArray(patch) || patch.length) {
        if (typeof gameMount?.loadState !== "function") throw new Error("\u6C99\u76D8\u672A\u5C31\u7EEA\uFF0C\u65E0\u6CD5\u6CE8\u5165\u8865\u4E01");
        gameMount.loadState(nextState);
        appliedCount = Array.isArray(patch) ? patch.length : 1;
        currentState = nextState;
        for (const unit of Object.values(nextState.units)) config.instances[unit.id] = { ...config.instances[unit.id], ...unit };
        save();
        renderInstances();
      }
      if (combined) normalizedBattles.set(key3, combined);
      updateReply({ content: replyText, status: "ok" });
      const result = Array.isArray(patch) && !patch.length ? "\u65E0\u8865\u4E01\u53D8\u66F4" : "\u8865\u4E01\u5DF2\u5E94\u7528";
      postStatus(`${label}\uFF1A${result}${unresolved.length ? `\uFF0C\u5F85\u5904\u7406\uFF1A${unresolved.join("\uFF1B")}` : ""}`, "ok");
      if (normalize) notify(
        "\u6807\u51C6\u5316\u5B8C\u6210",
        "",
        unresolved.length ? retryRequest : null,
        false,
        { tone: "success", applied: appliedCount, unresolved, raw: replyText }
      );
    } catch (e) {
      if (aiController !== controller2) return;
      const aborted = e?.name === "AbortError";
      const status2 = aborted ? "aborted" : "error";
      const detail = e?.message || String(e);
      const partial = assistantMessage?.content || replyText;
      updateReply({ status: status2, content: aborted ? partial ?? "" : [partial, `\u9519\u8BEF\uFF1A${detail}`].filter(Boolean).join("\n\n") });
      if (receivedPatch) postStatus(`${label}${aborted ? "\u5DF2\u4E2D\u6B62" : "\u5931\u8D25"}\uFF1A${detail}${unresolved.length ? `\uFF1B\u672A\u89E3\u51B3\uFF1A${unresolved.join("\uFF1B")}` : ""}`, status2);
      if (normalize && !disposed) notify(
        `${label}${aborted ? "\u5DF2\u4E2D\u6B62" : "\u5931\u8D25"}`,
        detail,
        aborted ? null : retryRequest,
        false,
        aborted ? { raw: replyText } : { tone: "error", applied: appliedCount, unresolved, raw: replyText }
      );
    } finally {
      clearTimeout(timeout);
      if (aiController === controller2) aiController = null;
      if (!disposed) aiPage?.setBusy(false);
      finish();
    }
  };
  function updateMagic() {
    launcher.hidden = Boolean(config.hideLauncher) || !panel.hidden;
    const wand = doc.querySelector("#extensionsMenu, #data_bank_wand_container");
    if (!wand) return;
    let entry = wand.querySelector("[data-fated-tavern-entry]");
    if (config.hideLauncher) {
      if (!entry) {
        entry = el(doc, "button", { type: "button", "data-fated-tavern-entry": "" }, "\u{1FA84} \u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0");
        wand.append(entry);
        on(entry, "click", open);
      }
    } else entry?.remove();
  }
  renderInstances();
  renderSandbox();
  aiPage = mountAiPage(pages.ai, {
    make: (tag, attrs2, content2) => el(doc, tag, attrs2, content2),
    on,
    sessions: aiSessions,
    send: (message) => askAI("chat", message),
    normalize: () => runNormalize(aiSessions.active().id),
    stop: () => aiController?.abort(new DOMException("\u5DF2\u53D6\u6D88", "AbortError"))
  });
  updateMagic();
  bindEventBus();
  foldBattleEntries();
  if (typeof MutationObserver === "function" && doc.body) {
    battleObserver = new MutationObserver(() => foldBattleEntries());
    battleObserver.observe(doc.body, { childList: true, subtree: true });
  }
  const api = { version: TAVERN_VERSION, open, close: closePanel, dispose, scan, getConfig: () => clone2(config), getDiagnostics: () => clone2(diagnostics), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, getSources: () => clone2(sources), getState: () => clone2(liveState()) };
  function dispose() {
    if (disposed) return;
    disposed = true;
    aiController?.abort();
    battleObserver?.disconnect();
    removeOpenEvent?.();
    try {
      controller?.abort();
    } catch (_) {
    }
    for (const remove of listeners.splice(0)) remove();
    try {
      gameMount?.unmount?.();
    } catch (_) {
    }
    root.remove();
    try {
      if (host.__fatedTacticalTavern === api) delete host.__fatedTacticalTavern;
    } catch (_) {
    }
  }
  try {
    host.__fatedTacticalTavern = api;
  } catch (_) {
  }
  if (options.open) open();
  return api;
}

// src/tavern/regex.js
var BATTLE_INIT_DISPLAY_REGEX = /<battle_init\b[^>]*>([\s\S]*?)<\/battle_init>/gi;
var BATTLE_INIT_DISPLAY_REPLACEMENT = '<details class="fated-battle-entry" data-fated-battle-entry="true"><summary>\u2694 \u8FDB\u5165\u6218\u573A \xB7 \u70B9\u51FB\u5C55\u5F00\u5165\u53E3</summary><div class="fated-battle-meta">\u5DF2\u8BC6\u522B battle_init \xB7 \u53EF\u5728\u63A7\u5236\u53F0\u52A0\u8F7D\u6218\u5C40</div><pre class="fated-battle-source">$1</pre><button type="button" class="fated-battle-enter" data-fated-battle-open="true">\u6253\u5F00\u6218\u573A\u63A7\u5236\u53F0</button><script>(function(){var b=document.currentScript.previousElementSibling;if(!b)return;b.addEventListener("click",function(){if(typeof eventEmit==="function")eventEmit("fated_tactical:open_ui",{source:"battle_init"});});})();<\/script></details>';
var BATTLE_INIT_DISPLAY_RULE = Object.freeze({
  id: "fated-tactical-battle-init-display",
  name: "\u547D\u5B9A\u6218\u672F\uFF1Abattle_init \u6218\u573A\u5165\u53E3",
  find: BATTLE_INIT_DISPLAY_REGEX.source,
  replace: BATTLE_INIT_DISPLAY_REPLACEMENT,
  flags: "gmi",
  placement: "ai",
  disabled: false
});
function renderBattleInitEntry(source) {
  return String(source ?? "").replace(BATTLE_INIT_DISPLAY_REGEX, BATTLE_INIT_DISPLAY_REPLACEMENT);
}
export {
  BATTLE_INIT_DISPLAY_REGEX,
  BATTLE_INIT_DISPLAY_REPLACEMENT,
  BATTLE_INIT_DISPLAY_RULE,
  GameAPI,
  SCENARIOS,
  battleReportToMvuPatch,
  buildMvuJsonPatch,
  buildScenario,
  buildState,
  convertSources,
  corpses,
  createGameAPI,
  defineStatus,
  effectSchema,
  hydrateFromSources,
  living,
  mapEffects,
  mount,
  mountStyles,
  mountTavernOverlay,
  parseBattleInit,
  parseBattleTime,
  parseCharInfo,
  parseSimpleYaml,
  patchStatus,
  renderBattleInitEntry,
  statusModifierKeys,
  validateState
};
