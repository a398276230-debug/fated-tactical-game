var FatedTacticalTavern = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/tavern/main.js
  var main_exports = {};
  __export(main_exports, {
    mountTavernOverlay: () => mountTavernOverlay
  });

  // src/presets/catalog.js
  var dice = (count, sides, stat, type, bonus = 0) => ({ count, sides, stat, type, bonus });
  var status = (statusId2, extra = {}) => ({ kind: "status", statusId: statusId2, ...extra });
  var skill = (name, range, target, specs = {}) => ({
    name,
    quality: "\u666E\u901A",
    power: 50,
    ap: 1,
    slot: target === "enemy" ? "attack" : "action",
    mp: 2,
    range,
    shape: "single",
    target,
    effects: [],
    ...specs
  });
  var EQUIPMENT = {
    soulblade: { name: "\u566C\u9B42\u592A\u5200", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 120, defense: 0, range: 1, accuracy: 5, damage: dice(2, 6, "str", "physical"), effects: [
      { kind: "kill_charge_weapon", counterKey: "souls", bonusPerStack: 0.5, maxStacks: 10 }
    ] },
    frostplate: { name: "\u971C\u7EB9\u8346\u68D8\u91CD\u7532", quality: "\u666E\u901A", kind: "armor", armor: 2, defense: 25, effects: [{ kind: "frost_thorns", damage: 3, chance: 0.4, statusId: "chill" }] },
    bloodfang: { name: "\u53CC\u751F\u8840\u7259\u5315\u9996", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 80, defense: 0, range: 1, accuracy: 3, damage: dice(2, 4, "agi", "physical"), effects: [
      { kind: "backstab", bonusMultiplier: 0.4, bleedStacks: 2, comboDamage: 4 }
    ] },
    revolver: { name: "\u730E\u9B54\u5DE6\u8F6E", kind: "weapon", weaponClass: "ranged", hand: "one_handed", ranged: true, rangeType: "ranged", attack: 100, defense: 0, range: 5, accuracy: 3, damage: dice(2, 6, "agi", "physical"), effects: [
      { kind: "ammo", counterKey: "ammo", capacity: 6, armorPierce: 3, highGroundRange: 1, highGroundAccuracy: 2 }
    ] },
    crossbow: { name: "\u7834\u7532\u91CD\u5F29", kind: "weapon", weaponClass: "ranged", hand: "one_handed", ranged: true, attack: 150, defense: 0, rangeType: "ranged", range: 6, accuracy: 1, damage: dice(2, 8, "agi", "physical"), effects: [
      { kind: "ammo", counterKey: "ammo", capacity: 3, armorPierce: 5, highGroundRange: 2, highGroundAccuracy: 2 }
    ] },
    hymnal: { name: "\u5723\u548F\u5E87\u62A4\u5FBD\u8BB0", quality: "\u666E\u901A", kind: "accessory", effects: [{ kind: "healing_shield", healBonus: 0.25, shieldRatio: 0.5 }] },
    shortblade: { name: "\u526F\u624B\u77ED\u5203", kind: "weapon", weaponClass: "light_blade", hand: "one_handed", rangeType: "melee", attack: 50, defense: 0, range: 1, accuracy: 1, damage: dice(1, 4, "agi", "physical"), effects: [] },
    potion: { name: "\u8C03\u548C\u836F\u5242", kind: "consumable", weaponClass: "auxiliary", hand: "off_hand", effects: [] },
    greatsword: { name: "\u7384\u94C1\u91CD\u5251", kind: "weapon", weaponClass: "greatsword", hand: "two_handed", heavy: true, twoHanded: true, attack: 260, defense: 0, rangeType: "melee", range: 1, accuracy: 1, damage: dice(2, 8, "str", "physical"), effects: [] },
    towerShield: { name: "\u5854\u76FE", kind: "shield", weaponClass: "shield", hand: "off_hand", shield: true, defense: 8, effects: [] },
    pike: { name: "\u5DE1\u536B\u957F\u621F", kind: "weapon", weaponClass: "greatsword", hand: "two_handed", heavy: true, twoHanded: true, attack: 180, defense: 0, rangeType: "melee", range: 2, accuracy: 2, damage: dice(1, 8, "str", "physical"), effects: [{ kind: "opportunity_root" }] },
    staff: { name: "\u7075\u7EB9\u6CD5\u6756", kind: "weapon", weaponClass: "staff", hand: "one_handed", attack: 90, defense: 0, rangeType: "ranged", range: 4, accuracy: 2, damage: dice(1, 6, "int", "energy"), effects: [] }
  };
  var SKILLS = {
    brand: skill("\u7130\u5370", 4, "enemy", { damage: dice(1, 4, "int", "energy"), effects: [status("burn"), status("mark")] }),
    surge: skill("\u65AD\u5CB3\u91CD\u65A9", 1, "enemy", {
      ap: 2,
      mp: 0,
      sp: 4,
      accuracy: 3,
      damage: dice(3, 6, "str", "physical"),
      effects: [{ kind: "knockback", distance: 2, collisionDamage: 7 }, status("sunder")]
    }),
    ward: skill("\u5B88\u9635", 2, "ally", { effects: [status("guard"), status("guarded")] }),
    challenge: skill("\u6311\u8845", 4, "enemy", { effects: [status("taunt")] }),
    frost: skill("\u788E\u971C\u65B0\u661F", 5, "enemy", {
      ap: 2,
      mp: 5,
      shape: "circle",
      radius: 2,
      save: "con",
      saveDC: 14,
      damage: dice(2, 6, "int", "energy"),
      effects: [status("freeze")]
    }),
    fan: skill("\u8840\u7259\u6247\u65A9", 3, "enemy", { shape: "fan", width: 1, damage: dice(1, 6, "agi", "physical"), effects: [status("bleed")] }),
    toxin: skill("\u6BD2\u96FE\u9525", 4, "enemy", {
      shape: "cone",
      width: 1,
      save: "con",
      saveDC: 13,
      damage: dice(1, 4, "int", "mental"),
      effects: [status("poison"), status("blind")]
    }),
    beam: skill("\u8D2F\u661F\u76F4\u7EBF", 6, "enemy", {
      ap: 2,
      mp: 4,
      shape: "line",
      width: 0,
      damage: dice(2, 8, "int", "energy"),
      effects: [status("root")]
    }),
    blink: skill("\u5F71\u6B65\u80CC\u523A", 5, "enemy", { damage: dice(2, 6, "agi", "physical"), effects: [
      { kind: "teleport_backstab", bonusMultiplier: 0.5 },
      status("bleed"),
      status("stealth")
    ] }),
    hymn: skill("\u7FA4\u661F\u5723\u548F", 4, "ally", {
      ap: 2,
      mp: 5,
      shape: "circle",
      radius: 2,
      heal: dice(2, 4, "spi", "true"),
      effects: [status("regen")]
    }),
    cleanse: skill("\u51C0\u5316\u7977\u8A00", 4, "ally", { heal: dice(1, 4, "spi", "true"), effects: [{ kind: "cleanse" }] }),
    shift: skill("\u8FC5\u5F71", 0, "ally", { effects: [status("haste"), status("stealth")] }),
    armor: skill("\u8346\u58C1\u836F\u5242", 0, "ally", { mp: 0, sp: 3, effects: [status("thorns"), status("shield", { amount: 6 })] }),
    curse: skill("\u8680\u5FC3\u5492", 4, "enemy", {
      save: "spi",
      saveDC: 13,
      damage: dice(1, 6, "spi", "mental"),
      effects: [status("vulnerable")]
    })
  };

  // src/core/spatial.js
  var CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  var DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  var NEIGHBORS = [...CARDINAL, ...DIAGONAL];

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
  function sizeFor(bodyLengthM) {
    return BL_SIZE_TABLE.find((x) => Number.isFinite(bodyLengthM) && bodyLengthM < x.max) ?? BL_SIZE_TABLE[2];
  }

  // src/core/combat.js
  var def = (name, icon, category, remainingTurns, description, modifiers = {}, options = {}) => Object.freeze({
    name,
    icon,
    category,
    description,
    remainingTurns,
    durationType: "battle_turns",
    tickTiming: "onTurnStart",
    stackRule: "refresh",
    maxStacks: 1,
    modifiers: Object.freeze(modifiers),
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
    disarmed: def("\u7F34\u68B0", "\u2694", "debuff", 1, "\u65E0\u6CD5\u4F7F\u7528\u4E3B\u624B\u6B66\u5668\u3002", { disarmed: true })
  }).map(([id2, status2]) => [id2, Object.freeze({ id: id2, ...status2 })])));
  function tableEntry(table2, id2) {
    return Object.hasOwn(table2 ?? {}, id2) ? table2[id2] : void 0;
  }
  function getStatusTemplate(state, statusId2) {
    if (typeof statusId2 !== "string") return void 0;
    return tableEntry(STATUSES, statusId2) ?? tableEntry(state?.statusTemplates, statusId2);
  }
  var normalAttack = Object.freeze({ name: "\u5F92\u624B", range: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: "str", type: "physical" } });
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

  // src/api/validation.js
  var own = Object.hasOwn;
  var error = (message) => {
    throw new Error(message);
  };
  var requireThat = (yes, name) => {
    if (!yes) error(`\u65E0\u6548\u5B57\u6BB5\uFF1A${name}`);
  };
  var plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
  var id = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) && !own(Object.prototype, v) && v !== "prototype";
  var int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  var num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  var text = (v, max = 100) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  var team = (v) => v === "blue" || v === "red";
  var coord = (v) => int(v, 0, 9);
  var attrs = ["str", "agi", "con", "int", "spi"];
  var damageTypes = ["physical", "energy", "mental", "true"];
  var statusDurations = ["battle_turns", "until_removed", "persistent"];
  var statusTickTimings = ["onTurnStart", "onTurnEnd"];
  var statusStackRules = ["refresh", "stack", "replace"];
  var statusLabels = ["name", "icon", "category", "description"];
  var maxStatusTemplates = 64;
  var has = (record, key) => id(key) && own(record, key);
  function fields(v, required, optional = []) {
    requireThat(plain(v) && required.every((k) => own(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), required.join("/") || "\u5BF9\u8C61\u952E");
  }
  function checkOptional(o, key, check) {
    if (own(o, key)) requireThat(check(o[key]), key);
  }
  function table(v, test, max = 200) {
    requireThat(plain(v) && Object.keys(v).length <= max, "\u5B9E\u4F53\u8868");
    for (const [k, value] of Object.entries(v)) {
      requireThat(id(k), "\u5B9E\u4F53 ID");
      test(value, k);
    }
  }
  function list(v, max, check, key) {
    requireThat(Array.isArray(v) && v.length <= max && Array.from(v).every(check), key);
  }
  function dice2(v) {
    fields(v, ["count", "sides"], ["bonus", "stat", "multiplier", "type"]);
    requireThat(int(v.count, 0, 1e6) && int(v.sides, 0, 1e6) && (v.count === 0 || v.sides >= 1), "\u4F24\u5BB3\u9AB0");
    checkOptional(v, "bonus", (x) => int(x, -1e9, 1e9));
    checkOptional(v, "stat", (x) => attrs.includes(x));
    checkOptional(v, "multiplier", (x) => num(x, 0, 8));
    checkOptional(v, "type", (x) => damageTypes.includes(x));
  }
  var customModifiers = {
    damage: (x) => int(x, 1, 50),
    damageType: (x) => damageTypes.includes(x),
    heal: (x) => int(x, 1, 50),
    movement: (x) => int(x, -3, 3),
    armor: (x) => int(x, -10, 10),
    accuracy: (x) => int(x, -10, 10),
    incomingAccuracy: (x) => int(x, -10, 10),
    advantage: (x) => int(x, 1, 3),
    disadvantage: (x) => int(x, 1, 3),
    reduction: (x) => num(x, 0, 1),
    vulnerability: (x) => num(x, 0, 1),
    reflect: (x) => int(x, 1, 30)
  };
  function statusLifetime(v) {
    return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType) && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
  }
  function statusTemplate(v, key = v?.id) {
    fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers"]);
    requireThat(id(key) && !own(STATUSES, key) && v.id === key, "\u81EA\u5B9A\u4E49\u72B6\u6001 ID");
    requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300) && ["buff", "debuff", "control", "dot", "hot"].includes(v.category), "\u72B6\u6001\u540D/\u56FE\u6807/\u63CF\u8FF0/\u7C7B\u522B");
    requireThat(statusLifetime(v) && int(v.maxStacks, 1, 10), "\u72B6\u6001\u65F6\u957F/\u5C42\u6570");
    fields(v.modifiers, [], Object.keys(customModifiers));
    requireThat(Object.keys(v.modifiers).length > 0 && (!own(v.modifiers, "damageType") || own(v.modifiers, "damage")), "\u72B6\u6001\u7279\u6548");
    for (const [key2, check] of Object.entries(customModifiers)) checkOptional(v.modifiers, key2, check);
  }
  function statusTemplateTable(v) {
    table(v, statusTemplate, maxStatusTemplates);
  }
  var effectSpecs = {
    kill_charge_weapon: { counterKey: id, bonusPerStack: (x) => num(x, 0, 2), maxStacks: (x) => int(x, 1, 50) },
    ammo: { counterKey: id, capacity: (x) => int(x, 1, 50), armorPierce: (x) => int(x, 0, 50), highGroundRange: (x) => int(x, 0, 6), highGroundAccuracy: (x) => int(x, 0, 12) },
    frost_thorns: { damage: (x) => int(x, 0, 50), chance: (x) => num(x, 0, 1), statusId: (x, s) => id(x) && !!getStatusTemplate(s, x) },
    backstab: { bonusMultiplier: (x) => num(x, 0, 4), bleedStacks: (x) => int(x, 1, 5), comboDamage: (x) => int(x, 0, 50) },
    healing_shield: { healBonus: (x) => num(x, 0, 4), shieldRatio: (x) => num(x, 0, 4) },
    status: { statusId: (x, s) => id(x) && !!getStatusTemplate(s, x), turns: (x) => int(x, 1, 100), stacks: (x) => int(x, 1, 10), amount: (x) => int(x, 1, 500) },
    knockback: { distance: (x) => int(x, 1, 5), collisionDamage: (x) => int(x, 0, 80) },
    teleport_backstab: { bonusMultiplier: (x) => num(x, 0, 4) },
    cleanse: {},
    opportunity_root: {}
  };
  function effects(v, kinds, state) {
    requireThat(Array.isArray(v) && v.length <= 12, "effects");
    const seen = /* @__PURE__ */ new Set();
    for (const e of v) {
      requireThat(plain(e) && kinds.includes(e.kind), "effect kind");
      const spec = effectSpecs[e.kind], keys = Object.keys(spec);
      const required = e.kind === "status" ? ["statusId"] : keys;
      fields(e, ["kind", ...required], keys.filter((k) => !required.includes(k)));
      for (const [key, check] of Object.entries(spec)) checkOptional(e, key, (x) => check(x, state));
      if (e.kind === "status" && !has(STATUSES, e.statusId)) {
        requireThat(!own(e, "amount"), "amount \u4EC5\u7528\u4E8E\u62A4\u76FE");
        checkOptional(e, "stacks", (x) => int(x, 1, getStatusTemplate(state, e.statusId).maxStacks));
      }
      requireThat(!seen.has(e.counterKey ?? e.kind) || e.kind === "status", "\u91CD\u590D\u7279\u6548");
      seen.add(e.counterKey ?? e.kind);
    }
  }
  function equipmentTemplate(v, state) {
    fields(v, ["name", "effects"], ["quality", "kind", "weaponClass", "hand", "rangeType", "ranged", "heavy", "twoHanded", "shield", "range", "accuracy", "attack", "damage", "armor", "defense"]);
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
    if (own(v, "damage")) dice2(v.damage);
    requireThat(own(v, "range") === own(v, "damage"), "\u6B66\u5668 range/damage");
    effects(v.effects, ["kill_charge_weapon", "ammo", "frost_thorns", "backstab", "healing_shield", "opportunity_root"], state);
    requireThat(v.effects.every((e) => ["kill_charge_weapon", "ammo", "backstab", "opportunity_root"].includes(e.kind) === own(v, "damage")), "\u88C5\u5907\u7279\u6548\u4E0D\u5339\u914D");
  }
  function skillTemplate(v, state) {
    fields(v, ["name", "ap", "slot", "range", "shape", "target", "effects"], ["quality", "power", "mp", "sp", "radius", "width", "accuracy", "save", "saveDC", "damage", "heal"]);
    requireThat(text(v.name) && int(v.ap, 1, 2) && ["attack", "action"].includes(v.slot) && int(v.range, 0, 15) && ["single", "circle", "fan", "cone", "line"].includes(v.shape) && ["enemy", "ally", "self", "any"].includes(v.target), "\u6280\u80FD");
    checkOptional(v, "power", (x) => int(x, 0, 1e9));
    for (const k of ["mp", "sp"]) checkOptional(v, k, (x) => int(x, 0, 25e3));
    for (const k of ["radius", "width"]) checkOptional(v, k, (x) => int(x, 0, 6));
    checkOptional(v, "accuracy", (x) => int(x, -20, 30));
    checkOptional(v, "save", (x) => attrs.includes(x));
    checkOptional(v, "saveDC", (x) => int(x, 1, 50));
    requireThat(own(v, "save") === own(v, "saveDC"), "save/saveDC");
    for (const k of ["damage", "heal"]) if (own(v, k)) dice2(v[k]);
    effects(v.effects, ["status", "knockback", "teleport_backstab", "cleanse"], state);
  }
  function statusValue(v, key, state) {
    const t = getStatusTemplate(state, key);
    requireThat(id(key) && t, "\u72B6\u6001 ID");
    fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers", "stacks", "sourceUnitId"], ["appliedRound", "appliedTurn", "amount"]);
    requireThat(v.id === key && statusLabels.every((k) => v[k] === t[k]) && statusLifetime(v) && int(v.maxStacks, 1, t.maxStacks) && int(v.stacks, 1, v.maxStacks) && (v.sourceUnitId === null || id(v.sourceUnitId)), "\u72B6\u6001\u5B9E\u4F8B");
    fields(v.modifiers, Object.keys(t.modifiers));
    for (const [k, def2] of Object.entries(t.modifiers)) requireThat(v.modifiers[k] === def2 || key === "guarded" && k === "reduction" && [0.25, 0.35, 0.45, 0.5].includes(v.modifiers[k]), `\u72B6\u6001\u53C2\u6570 ${k}`);
    checkOptional(v, "appliedRound", (x) => int(x, 1, 1e6));
    checkOptional(v, "appliedTurn", (x) => int(x, 0, 199));
    requireThat(key === "shield" ? int(v.amount, 1, 1e9) : !own(v, "amount"), "\u62A4\u76FE\u6C60");
  }
  function validateCell(v) {
    fields(v, ["kind", "z"]);
    requireThat(["floor", "slope", "wall"].includes(v.kind) && int(v.z, -4, 8), "\u5730\u5F62");
  }
  var unitKeys = ["id", "name", "team", "x", "y", "facing", "hp", "maxHp", "mp", "maxMp", "sp", "maxSp", "ap", "used", "stats", "armor", "size", "move", "weapon", "gear", "skills", "statuses"];
  var protocolUnitKeys = ["mainHand", "offHand", "shield", "bodyLengthM", "tier", "mc", "nonLethal", "intent", "bonusDice", "penaltyDice", "stance", "moraleType", "moraleState", "greatswordMode", "parryQuota", "parryRefunded", "attunementCharges", "blockMode", "initiativePercent", "attackInit", "actionInit", "flatInitiative", "lockedTargetId", "deathrattle", "deathrattleTriggered", "moraleCheckedRound", "maneuvers"];
  function unitValue(v, key, state) {
    fields(v, unitKeys, ["reactionAvailable", ...protocolUnitKeys]);
    checkOptional(v, "reactionAvailable", (x) => typeof x === "boolean");
    requireThat(v.id === key && text(v.name) && team(v.team) && coord(v.x) && coord(v.y), "\u68CB\u5B50");
    list(v.facing, 2, (x) => int(x, -1, 1), "\u671D\u5411");
    requireThat(v.facing.length === 2 && v.facing.some(Boolean), "\u671D\u5411");
    for (const [r, max] of [["hp", "maxHp"], ["mp", "maxMp"], ["sp", "maxSp"]]) requireThat(int(v[max], r === "hp" ? 1 : 0, 1e9) && int(v[r], 0, v[max]), r);
    fields(v.used, ["action", "attack"]);
    fields(v.stats, attrs);
    requireThat(attrs.every((k) => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2) && int(v.armor, 0, 1e6) && int(v.size, 1, 5) && int(v.move, 1, 10), "\u5355\u4F4D\u6570\u503C");
    requireThat(v.weapon === null || id(v.weapon), "weapon");
    for (const slot of ["mainHand", "offHand", "shield"]) checkOptional(v, slot, (x) => x === null || id(x));
    checkOptional(v, "bodyLengthM", (x) => num(x, 0.01, 1e9));
    checkOptional(v, "tier", (x) => int(x, 1, 7));
    checkOptional(v, "mc", (x) => int(x, 1, 64));
    checkOptional(v, "nonLethal", (x) => typeof x === "boolean");
    checkOptional(v, "deathrattle", (x) => plain(x) && typeof x.kind === "string");
    checkOptional(v, "deathrattleTriggered", (x) => typeof x === "boolean");
    checkOptional(v, "moraleCheckedRound", (x) => int(x, 1, 1e6));
    checkOptional(v, "maneuvers", (x) => Array.isArray(x) && x.length <= 32 && x.every(id));
    checkOptional(v, "initiativePercent", (x) => num(x, -1, 10));
    checkOptional(v, "flatInitiative", (x) => int(x, -1e3, 1e3));
    for (const field of ["attackInit", "actionInit"]) checkOptional(v, field, (x) => Array.isArray(x) && x.length <= 16 && x.every((n) => int(n, -1e3, 1e3)));
    checkOptional(v, "lockedTargetId", (x) => x === null || id(x));
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
    list(v.gear, 12, id, "gear");
    list(v.skills, 32, id, "skills");
    table(v.statuses, (status2, statusId2) => statusValue(status2, statusId2, state), maxStatusTemplates + Object.keys(STATUSES).length);
  }
  function jsonTree(v, depth = 0) {
    if (depth > 12) return false;
    if (v === null || ["string", "boolean"].includes(typeof v) || Number.isFinite(v)) return true;
    if (Array.isArray(v)) return v.length <= 500 && Array.from(v).every((x) => jsonTree(x, depth + 1));
    return plain(v) && Object.keys(v).length <= 250 && Object.entries(v).every(([key, x]) => !own(Object.prototype, key) && jsonTree(x, depth + 1));
  }
  function validateState(s) {
    fields(s, ["scenarioId", "title", "mode", "ruleset", "round", "turn", "order", "units", "items", "equipment", "skills", "grid", "covers", "interactives", "rng", "logs", "outcome"], ["statusTemplates", "zones"]);
    if (own(s, "statusTemplates")) statusTemplateTable(s.statusTemplates);
    requireThat(id(s.scenarioId) && text(s.title) && ["free", "split"].includes(s.mode) && ["protocol", "sandbox"].includes(s.ruleset) && int(s.round, 1, 1e6) && int(s.rng, 0, 4294967295) && [null, "blue", "red", "draw"].includes(s.outcome), "\u6218\u5C40");
    requireThat(Array.isArray(s.grid) && s.grid.length === 10, "\u68CB\u76D8");
    for (const row of s.grid) {
      requireThat(Array.isArray(row) && row.length === 10, "\u68CB\u76D8\u884C");
      for (const c of row) validateCell(c);
    }
    table(s.equipment, (v) => equipmentTemplate(v, s));
    table(s.skills, (v) => skillTemplate(v, s));
    table(s.items, (v, k) => {
      fields(v, ["id", "templateId", "counters"]);
      requireThat(v.id === k && has(s.equipment, v.templateId), "\u88C5\u5907\u5B9E\u4F8B");
      const counterKeys = s.equipment[v.templateId].effects.filter((e) => e.counterKey).map((e) => e.counterKey);
      fields(v.counters, counterKeys);
      for (const n of Object.values(v.counters)) requireThat(int(n, 0, 50), "\u8BA1\u6570\u5668");
    });
    table(s.covers, (v, k) => {
      fields(v, ["id", "name", "x", "y", "material", "hp", "maxHp", "cover"]);
      requireThat(v.id === k && text(v.name) && text(v.material) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== "wall" && int(v.maxHp, 1, 1e9) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), "\u63A9\u4F53");
    });
    table(s.zones ?? {}, (v, k) => {
      fields(v, ["id", "name", "x", "y", "radius", "remainingTurns", "damage", "damageType", "team"]);
      requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && int(v.radius, 0, 10) && int(v.remainingTurns, 1, 100) && int(v.damage, 0, 1e9) && ["physical", "energy", "mental", "true"].includes(v.damageType) && ["blue", "red", "all"].includes(v.team), "\u6301\u7EED\u533A\u57DF");
    }, 64);
    table(s.interactives, (v, k) => {
      fields(v, ["id", "name", "x", "y", "kind", "spent"]);
      requireThat(v.id === k && text(v.name) && coord(v.x) && coord(v.y) && s.grid[v.y][v.x].kind !== "wall" && ["barrel", "altar"].includes(v.kind) && typeof v.spent === "boolean", "\u4E92\u52A8\u70B9");
    });
    const occupied = /* @__PURE__ */ new Set(), equipped = /* @__PURE__ */ new Set();
    table(s.units, (v, k) => {
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
        const isDamageItem = Boolean(template && own(template, "damage"));
        requireThat(has(s.items, i) && !equipped.has(i) && (weaponSlot ? isDamageItem || template?.kind === "consumable" : isShieldSlot ? template?.kind === "shield" : true), "\u88C5\u5907\u5F15\u7528\u6216\u5F52\u5C5E");
        equipped.add(i);
      }
      requireThat(v.skills.every((i) => has(s.skills, i)) && new Set(v.skills).size === v.skills.length, "\u6280\u80FD\u5F15\u7528");
    });
    list(s.order, 200, (x) => has(s.units, x), "\u5148\u653B\u961F\u5217");
    requireThat(new Set(s.order).size === s.order.length && int(s.turn, 0, Math.max(0, s.order.length - 1)) && Object.values(s.units).every((u) => u.hp <= 0 || s.order.includes(u.id)), "\u5148\u653B\u7D22\u5F15");
    requireThat(Array.isArray(s.logs) && s.logs.length <= 1e5, "\u65E5\u5FD7");
    for (const log of s.logs) {
      fields(log, ["round", "actor", "type", "text", "detail"]);
      requireThat(int(log.round, 1, s.round) && (log.actor === null || id(log.actor)) && text(log.type, 64) && text(log.text, 1e3) && jsonTree(log.detail), "\u65E5\u5FD7\u4E8B\u4EF6");
    }
    return s;
  }

  // src/tavern/converter.js
  var own2 = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
  var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  var asObject = (v) => object(v) ? v : {};
  var finite = (v) => typeof v === "number" && Number.isFinite(v);
  var number = (v, fallback = 0) => {
    if (finite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return fallback;
  };
  var integer = (v, fallback = 0) => Math.round(number(v, fallback));
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
    let id2 = ascii || `${prefix}-${hash(raw).toString(36)}`;
    if (!/^[A-Za-z]/.test(id2)) id2 = `${prefix}-${id2}`;
    if (id2.length > 52) id2 = id2.slice(0, 52);
    if (["constructor", "prototype", "__proto__"].includes(id2)) id2 = `${prefix}-${hash(raw).toString(36)}`;
    return id2 || `${prefix}-${hash(raw).toString(36)}`;
  }
  function scalar(value) {
    const v = text2(value);
    if (!v) return "";
    if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/\\n/g, "\n");
    if (v === "true" || v === "false") return v === "true";
    if (v === "null" || v === "~") return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v)) return Number(v);
    if (v.startsWith("{") && v.endsWith("}") || v.startsWith("[") && v.endsWith("]")) {
      try {
        return JSON.parse(v);
      } catch {
      }
    }
    return v;
  }
  function parseSimpleYaml(input) {
    if (object(input) || Array.isArray(input)) return clone(input);
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
      if (colon < 1 || !object(parent)) continue;
      const key = line.value.slice(0, colon).trim();
      const tail = line.value.slice(colon + 1).trim();
      if (tail) {
        parent[key] = scalar(tail);
        continue;
      }
      const next = lines[i + 1];
      const child = next && next.indent > line.indent && next.value.startsWith("- ") ? [] : {};
      parent[key] = child;
      stack.push({ indent: line.indent, value: child });
    }
    return root;
  }
  function unwrap(value, tag) {
    if (typeof value !== "string") return value;
    const re = tag === "battle" ? /<(?:battle_init|battle-in|battle_in)>\s*([\s\S]*?)\s*<\/\s*(?:battle_init|battle-in|battle_in)>/i : /<char_info>\s*([\s\S]*?)\s*<\/char_info>/ig;
    if (tag === "battle") {
      const match = value.match(re);
      if (match) return parseStructured(match[1]);
      const legacy = value.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*([\s\S]*?)\s*\{\s*\/\s*(?:battle_in|战术沙盘)\s*\}/i);
      if (legacy) return parseStructured(legacy[1]);
      const brace = value.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\s\S]+?)\s*\}/i);
      return brace ? parseStructured(brace[1]) : parseStructured(value);
    }
    return [...value.matchAll(re)].map((m) => parseSimpleYaml(m[1]));
  }
  function parseStructured(value) {
    if (object(value)) return value;
    if (typeof value !== "string") return {};
    try {
      const parsed = JSON.parse(value);
      return object(parsed) ? parsed : {};
    } catch {
      return parseSimpleYaml(value);
    }
  }
  function parseBattleInit(value) {
    return asObject(unwrap(value, "battle"));
  }
  function parseCharInfo(value) {
    if (Array.isArray(value)) return value.flatMap(parseCharInfo);
    if (object(value)) return [clone(value)];
    if (typeof value !== "string") return [];
    const tagged = unwrap(value, "char");
    return tagged.length ? tagged : [parseSimpleYaml(value)].filter((x) => Object.keys(x).length);
  }
  var attrNames = ["str", "agi", "con", "int", "spi"];
  var statAliases = { strength: "str", dexterity: "agi", agility: "agi", constitution: "con", intelligence: "int", spirit: "spi", wisdom: "spi", \u529B\u91CF: "str", \u654F\u6377: "agi", \u4F53\u8D28: "con", \u667A\u529B: "int", \u7CBE\u795E: "spi" };
  function findValue(record, names, fallback) {
    const r = asObject(record);
    for (const name of names) if (own2(r, name)) return r[name];
    return fallback;
  }
  function statsOf(record) {
    const r = asObject(record), nested = asObject(r.stats ?? r.attributes ?? r.\u5C5E\u6027);
    const result = {};
    for (const key of attrNames) {
      const aliases = [key, ...Object.entries(statAliases).filter(([, v]) => v === key).map(([k]) => k)];
      result[key] = Math.max(-20, Math.min(50, integer(
        aliases.find((alias) => own2(nested, alias)) !== void 0 ? nested[aliases.find((alias) => own2(nested, alias))] : findValue(r, aliases, 0),
        0
      )));
    }
    return result;
  }
  function resource(record, key, fallback) {
    const r = asObject(record), nested = asObject(r.resources ?? r.resource ?? r.\u8D44\u6E90);
    const aliases = { hp: ["HP", "\u751F\u547D\u503C"], mp: ["MP", "\u6CD5\u529B\u503C"], sp: ["SP", "\u4F53\u529B\u503C"] }[key] ?? [];
    const value = own2(r, key) ? r[key] : own2(r, key.toUpperCase()) ? r[key.toUpperCase()] : own2(r, aliases[1]) ? r[aliases[1]] : own2(nested, key) ? nested[key] : own2(nested, aliases[1]) ? nested[aliases[1]] : void 0;
    if (object(value)) {
      const current2 = integer(value.current ?? value.\u5F53\u524D ?? value.now ?? value.value, fallback);
      const upper = value.max ?? value.maximum ?? value.\u4E0A\u9650;
      const max2 = object(upper) ? integer((upper._\u57FA\u7840 ?? 0) + (upper.\u989D\u5916 ?? 0), fallback) : integer(upper, fallback);
      return { current: current2, max: max2 };
    }
    const current = integer(value, fallback);
    const maxValue = findValue(r, [`max${key[0].toUpperCase()}${key.slice(1)}`, `${key}Max`, `${aliases[1]}\u4E0A\u9650`], current);
    const max = integer(maxValue, current);
    return { current, max };
  }
  function safeResource(pair, key, warnings) {
    let max = Math.max(key === "hp" ? 1 : 0, pair.max), current = Math.max(0, Math.min(max, pair.current));
    if (max > 1e9 || pair.current > 1e9) {
      warnings.push(`${key} \u8D85\u51FA\u5F15\u64CE\u4E0A\u9650\uFF0C\u5DF2\u622A\u5230 1e9`);
      max = Math.min(max, 1e9);
      current = Math.min(current, max);
    }
    return { current, max };
  }
  function sourceName(record, key = "") {
    return text2(findValue(record, ["name", "displayName", "characterName", "\u89D2\u8272\u540D", "\u540D\u79F0"], key));
  }
  function sourceId(record, key = "") {
    return text2(findValue(record, ["id", "uid", "characterId", "instanceId", "ID"], key));
  }
  function collectMvu(value) {
    const root = asObject(value?.stat_data ?? value?.statData ?? value);
    const found = [];
    const visit = (node, key = "", path = []) => {
      if (Array.isArray(node)) return node.forEach((v, i) => visit(v, String(i), [...path, i]));
      if (!object(node)) return;
      const name = sourceName(node, key), hasStats = node.stats || node.attributes || attrNames.some((k) => own2(node, k));
      const hasResource = ["hp", "maxHp", "mp", "sp", "tier", "level", "equipment", "skills"].some((k) => own2(node, k));
      if (name && (hasStats || hasResource)) found.push({ ...clone(node), __sourceKey: key, __sourcePath: path });
      for (const [k, v] of Object.entries(node)) if (!["stats", "attributes", "resources", "equipment", "skills", "statuses"].includes(k)) visit(v, k, [...path, k]);
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
  var equipmentEffects = /* @__PURE__ */ new Set(["kill_charge_weapon", "ammo", "frost_thorns", "backstab", "healing_shield", "opportunity_root"]);
  var skillEffects = /* @__PURE__ */ new Set(["status", "knockback", "teleport_backstab", "cleanse"]);
  var statusAliases = { burning: "burn", fire: "burn", poison: "poison", bleeding: "bleed", frozen: "freeze", stun: "stun", immobilize: "root", shield: "shield", regen: "regen", haste: "haste", blind: "blind", mark: "mark" };
  function statusId(value) {
    const key = text2(value).toLowerCase();
    return STATUSES[key] ? key : statusAliases[key] ?? null;
  }
  function mapEffect(raw, context = "skill", warnings = []) {
    if (!object(raw) && typeof raw !== "string") return null;
    const input = typeof raw === "string" ? { kind: raw } : raw;
    let kind = text2(input.kind ?? input.type ?? input.effect ?? input.name).toLowerCase().replace(/[ -]/g, "_");
    kind = effectAliases[kind] ?? kind;
    const allowed = context === "equipment" ? equipmentEffects : skillEffects;
    if (allowed.has(kind)) {
      if (kind === "status") {
        const id3 = statusId(input.statusId ?? input.status ?? input.value);
        return id3 ? { kind, statusId: id3, ...Number.isInteger(input.turns) ? { turns: Math.max(1, Math.min(100, input.turns)) } : {}, ...Number.isInteger(input.stacks) ? { stacks: Math.max(1, Math.min(10, input.stacks)) } : {} } : null;
      }
      if (kind === "cleanse" || kind === "opportunity_root") return { kind };
      if (kind === "knockback") return { kind, distance: Math.max(1, Math.min(5, integer(input.distance ?? input.amount, 1))), collisionDamage: Math.max(0, Math.min(80, integer(input.collisionDamage, 0))) };
      if (kind === "teleport_backstab") return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, 0.5))) };
      if (kind === "kill_charge_weapon") return { kind, counterKey: deterministicId(input.counterKey ?? "souls", "counter"), bonusPerStack: Math.max(0, Math.min(2, number(input.bonusPerStack, 0.5))), maxStacks: Math.max(1, Math.min(50, integer(input.maxStacks, 10))) };
      if (kind === "ammo") return { kind, counterKey: deterministicId(input.counterKey ?? "ammo", "counter"), capacity: Math.max(1, Math.min(50, integer(input.capacity, 6))), armorPierce: Math.max(0, Math.min(50, integer(input.armorPierce, 0))), highGroundRange: Math.max(0, Math.min(6, integer(input.highGroundRange, 0))), highGroundAccuracy: Math.max(0, Math.min(12, integer(input.highGroundAccuracy, 0))) };
      if (kind === "frost_thorns") {
        const id3 = statusId(input.statusId ?? "chill");
        return id3 ? { kind, damage: Math.max(0, Math.min(50, integer(input.damage, 3))), chance: Math.max(0, Math.min(1, number(input.chance, 0.4))), statusId: id3 } : null;
      }
      if (kind === "backstab") return { kind, bonusMultiplier: Math.max(0, Math.min(4, number(input.bonusMultiplier, 0.4))), bleedStacks: Math.max(1, Math.min(5, integer(input.bleedStacks, 1))), comboDamage: Math.max(0, Math.min(50, integer(input.comboDamage, 0))) };
      if (kind === "healing_shield") return { kind, healBonus: Math.max(0, Math.min(4, number(input.healBonus, 0.25))), shieldRatio: Math.max(0, Math.min(4, number(input.shieldRatio, 0.5))) };
    }
    const id2 = statusId(input.statusId ?? input.status ?? (statusAliases[kind] ? kind : null));
    if (context === "skill" && id2) {
      warnings.push(`\u6548\u679C ${kind} \u6309\u72B6\u6001\u522B\u540D\u964D\u7EA7\u4E3A ${id2}`);
      return { kind: "status", statusId: id2 };
    }
    warnings.push(`\u4E0D\u652F\u6301\u7684\u6548\u679C\u5DF2\u5FFD\u7565\uFF1A${kind || "unknown"}`);
    return null;
  }
  function mapEffects(effects2, context = "skill", warnings = []) {
    const input = Array.isArray(effects2) ? effects2 : effects2 == null ? [] : [effects2];
    const result = [], seen = /* @__PURE__ */ new Set();
    for (const raw of input) {
      const effect = mapEffect(raw, context, warnings);
      if (effect && (!seen.has(effect.kind) || effect.kind === "status")) {
        result.push(effect);
        seen.add(effect.kind);
      }
    }
    return result;
  }
  function normalizeEquipment(raw, slot, owner, index, warnings) {
    const r = asObject(raw), name = text2(r.name ?? r.\u540D\u79F0 ?? r.itemName) || `${slot || "\u88C5\u5907"}${index + 1}`;
    const isShield = slot === "shield" || r.shield === true || /盾/.test(name);
    const isWeapon = !isShield && (slot === "mainHand" || slot === "offHand" || r.damage || r.attack != null || r.weaponClass || r.kind === "weapon");
    const kind = isShield ? "shield" : isWeapon ? "weapon" : ["armor", "accessory", "consumable"].includes(r.kind) ? r.kind : "accessory";
    const idBase = deterministicId(`${owner}-${slot || "gear"}-${name}-${index}`, "item");
    const templateId = deterministicId(`template-${name}-${kind}-${index}`, "equipment");
    const effects2 = mapEffects(r.effects ?? r.effectsList ?? r.\u6548\u679C, "equipment", warnings);
    const template = { name, kind, effects: effects2 };
    if (kind === "shield") Object.assign(template, { weaponClass: "shield", hand: "off_hand", shield: true, defense: Math.max(0, integer(r.defense ?? r.\u9632\u5FA1, 1)) });
    else if (isWeapon) {
      const ranged = r.ranged === true || r.rangeType === "ranged" || r.weaponClass === "ranged" || /弓|弩|枪|法杖|远程/.test(name);
      const twoHanded = r.twoHanded === true || r.hand === "two_handed" || r.weaponClass === "greatsword" || /双手|巨剑|重剑/.test(name);
      Object.assign(template, { weaponClass: text2(r.weaponClass) || (twoHanded ? "greatsword" : ranged ? "ranged" : "light_blade"), hand: twoHanded ? "two_handed" : slot === "offHand" ? "off_hand" : "one_handed", ranged, rangeType: ranged ? "ranged" : "melee", range: Math.max(1, Math.min(15, integer(r.range ?? r.\u6709\u6548\u8DDD\u79BB, ranged ? 4 : 1))), attack: Math.max(0, Math.min(1e9, integer(r.attack ?? r.\u653B\u51FB, 0))), accuracy: Math.max(-20, Math.min(30, integer(r.accuracy ?? r.\u547D\u4E2D, 0))), damage: r.damage && object(r.damage) ? { count: Math.max(0, Math.min(1e6, integer(r.damage.count, 1))), sides: Math.max(1, Math.min(1e6, integer(r.damage.sides, 6))), ...r.damage.stat ? { stat: r.damage.stat } : {}, type: ["physical", "energy", "mental", "true"].includes(r.damage.type) ? r.damage.type : "physical", bonus: integer(r.damage.bonus, 0) } : { count: 1, sides: 4, stat: "str", type: "physical", bonus: 0 } });
      if (twoHanded) template.heavy = r.heavy !== false, template.twoHanded = true;
    } else Object.assign(template, { armor: Math.max(0, Math.min(1e6, integer(r.armor ?? r.\u9632\u5FA1, 0))), defense: Math.max(0, Math.min(1e6, integer(r.defense ?? r.\u9632\u5FA1, 0))) });
    const counters = Object.fromEntries(effects2.flatMap((e) => e.kind === "ammo" ? [[e.counterKey || "ammo", integer(e.capacity, 1)]] : e.kind === "kill_charge_weapon" ? [[e.counterKey || "souls", 0]] : []));
    return { id: idBase, templateId, template, counters, slot, name };
  }
  function sourceEquipment(record) {
    const value = record.equipment ?? record.equipments ?? record.items ?? record.\u88C5\u5907 ?? [];
    if (Array.isArray(value)) return value.map((v, i) => [text2(v?.slot ?? v?.position ?? v?.\u4F4D\u7F6E), v, i]);
    return Object.entries(asObject(value)).map(([slot, v], i) => [slot, v, i]);
  }
  function sourceSkills(record) {
    const value = record.skills ?? record.abilities ?? record.\u6280\u80FD ?? [];
    return (Array.isArray(value) ? value : Object.values(asObject(value))).map((v, i) => [v, i]);
  }
  function mergeRecords(records) {
    const result = /* @__PURE__ */ new Map();
    for (const record of records) {
      const key = sourceId(record) || sourceName(record) || record.__sourceKey;
      if (!key) continue;
      const id2 = deterministicId(key);
      result.set(id2, { ...result.get(id2) ?? {}, ...record, stats: { ...result.get(id2)?.stats ?? {}, ...record.stats ?? {} } });
    }
    return result;
  }
  function participantList(battle) {
    const value = battle.participants ?? battle.units ?? battle.roster ?? [];
    return Array.isArray(value) ? value : Object.entries(asObject(value)).map(([id2, participant]) => ({ ...asObject(participant), id: participant?.id ?? id2 }));
  }
  function teamOf(value, fallback = "red") {
    const t = text2(value).toLowerCase();
    return ["blue", "player", "ally", "\u53CB\u65B9", "\u6211\u65B9"].includes(t) ? "blue" : ["red", "enemy", "foe", "\u654C\u65B9"].includes(t) ? "red" : fallback;
  }
  function xyzOf(value) {
    const p = asObject(value);
    const xyz = Array.isArray(value) ? value : Array.isArray(p.xyz) ? p.xyz : [p.x, p.y, p.z];
    return { x: Math.max(0, Math.min(9, integer(xyz[0], 0))), y: Math.max(0, Math.min(9, integer(xyz[1], 0))), z: integer(xyz[2], 0) };
  }
  function unitFrom(record, participant, index, equipment, skills, items, warnings) {
    const name = sourceName(record, participant?.name ?? participant?.id ?? `unit-${index}`) || `\u5355\u4F4D ${index + 1}`;
    const id2 = deterministicId(sourceId(record) || participant?.id || participant?.source || name);
    const stats = statsOf(record), level = Math.max(1, integer(findValue(record, ["level", "\u7B49\u7EA7"], 1), 1));
    const tier = Math.max(1, Math.min(7, integer(findValue(record, ["tier", "levelTier", "\u5C42\u7EA7"], level), level)));
    const bodyLengthM = Math.max(0.01, Math.min(1e9, number(findValue(record, ["bodyLengthM", "bodyLength", "bl", "\u4F53\u957F"], 1.7), 1.7)));
    const size = Math.max(1, Math.min(5, sizeFor(bodyLengthM).value === 2 ? 1 : sizeFor(bodyLengthM).value === 1 ? 2 : sizeFor(bodyLengthM).value === 0 ? 3 : sizeFor(bodyLengthM).value === -1 ? 4 : 5));
    const mc = Math.max(1, Math.min(64, integer(findValue(record, ["mc", "MC", "massClass"], bodyLengthM >= 10 ? 2 : 1), 1)));
    const resources = { hp: safeResource(resource(record, "hp", Math.max(1, stats.con * 100)), "hp", warnings), mp: safeResource(resource(record, "mp", Math.max(0, (stats.int + stats.spi) * 10)), "mp", warnings), sp: safeResource(resource(record, "sp", Math.max(0, (stats.str + stats.agi) * 10)), "sp", warnings) };
    const slotItems = sourceEquipment(record).map(([slot, value, i]) => normalizeEquipment(value, slot, id2, i, warnings));
    for (const item of slotItems) {
      equipment[item.templateId] ??= item.template;
      items[item.id] = { id: item.id, templateId: item.templateId, counters: item.counters };
    }
    const bySlot = (slot) => slotItems.find((i) => ["mainHand", "main", "weapon", "\u4E3B\u624B", "\u53CC\u624B"].includes(slot) && ["mainHand", "main", "weapon", "\u4E3B\u624B", "\u53CC\u624B"].includes(i.slot) || slot === "offHand" && ["offHand", "off", "\u526F\u624B"].includes(i.slot) || slot === "shield" && ["shield", "\u76FE\u724C"].includes(i.slot));
    const main = bySlot("mainHand") ?? slotItems.find((i) => i.template.kind === "weapon") ?? null;
    const off = bySlot("offHand");
    const shield = bySlot("shield") ?? slotItems.find((i) => i.template.kind === "shield") ?? null;
    const gear = slotItems.filter((i) => ![main, off, shield].includes(i));
    const put = (item) => {
      if (!item) return null;
      const id22 = item.id;
      skills.__items ??= {};
      return id22;
    };
    const mainId = put(main), offId = put(off), shieldId = put(shield);
    for (const item of gear) put(item);
    const normalizedSkills = sourceSkills(record).map(([raw, i]) => {
      const r = asObject(raw), sid = deterministicId(`${id2}-skill-${r.id ?? r.name ?? i}`, "skill");
      skills[sid] ??= { name: text2(r.name ?? r.\u540D\u79F0) || `\u6280\u80FD${i + 1}`, quality: "\u666E\u901A", ap: Math.max(1, Math.min(2, integer(r.ap, 1))), slot: "attack", range: Math.max(0, Math.min(15, integer(r.range, 1))), shape: "single", target: "enemy", effects: mapEffects(r.effects, "skill", warnings), ...r.damage && object(r.damage) ? { damage: { count: 1, sides: 4, stat: "str", type: "physical", bonus: 0, ...r.damage } } : {} };
      return sid;
    });
    const p = participant ?? {};
    const pos = xyzOf(p.xyz ?? p);
    const sourceStatuses = record.statuses ?? record.effects ?? record.\u72B6\u6001 ?? {};
    const statuses = {};
    for (const [rawId, rawStatus] of Object.entries(Array.isArray(sourceStatuses) ? Object.fromEntries(sourceStatuses.map((x) => [x.id ?? x.statusId, x])) : asObject(sourceStatuses))) {
      const sid = statusId(rawId) || statusId(rawStatus?.id ?? rawStatus?.name);
      if (!sid) {
        warnings.push(`\u5FFD\u7565\u672A\u77E5\u72B6\u6001\uFF1A${rawId}`);
        continue;
      }
      const template = STATUSES[sid], stacks = Math.max(1, Math.min(template.maxStacks, integer(rawStatus?.stacks ?? 1)));
      statuses[sid] = { ...template, remainingTurns: Math.max(1, Math.min(100, integer(rawStatus?.remainingTurns, template.remainingTurns))), stacks, maxStacks: template.maxStacks, sourceUnitId: null, modifiers: { ...template.modifiers }, appliedRound: 1, appliedTurn: 0, ...sid === "shield" ? { amount: Math.max(1, integer(rawStatus?.amount ?? template.modifiers.amount, 1)) } : {} };
    }
    const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
    const unit = { id: id2, name, team: teamOf(p.faction ?? p.team, "red"), x: pos.x, y: pos.y, facing: [teamOf(p.faction ?? p.team, "red") === "blue" ? 1 : -1, 0], hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats, armor: Math.max(0, Math.min(1e6, integer(findValue(record, ["armor", "defense", "\u62A4\u7532"], 0), 0))), size, move: Math.max(1, Math.min(10, integer(findValue(record, ["move", "movement", "\u79FB\u52A8"], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.map(put), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: "offensive", parryQuota: stance === "greatsword" ? 2 : 0, parryRefunded: false, attunementCharges: stance === "attunement" ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: "normal", nonLethal: false, moraleType: "standard" };
    return { unit, profile: { id: id2, level, tier, stats, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, sourcePath: record.__sourcePath ?? null }, participant: p };
  }
  function terrainState(battle, state, warnings) {
    const terrain = battle.terrain ?? battle.grid;
    if (Array.isArray(terrain)) for (const cell of terrain) {
      const p = xyzOf(cell.xyz ?? cell);
      if (p.x > 9 || p.y > 9) continue;
      const kind = text2(cell.kind ?? cell.type).toLowerCase();
      state.grid[p.y][p.x] = { kind: ["floor", "slope", "wall"].includes(kind) ? kind : kind === "highground" ? "slope" : "floor", z: Math.max(-4, Math.min(8, p.z)) };
    }
    for (const [i, raw] of (battle.covers ?? []).entries()) {
      const p = xyzOf(raw.xyz ?? raw), id2 = deterministicId(raw.id ?? `cover-${i}`, "cover");
      if (state.grid[p.y][p.x].kind === "wall") state.grid[p.y][p.x].kind = "floor";
      state.covers[id2] = { id: id2, name: text2(raw.name) || `\u63A9\u4F53${i + 1}`, x: p.x, y: p.y, material: text2(raw.material) || "\u672A\u77E5\u6750\u6599", hp: Math.max(0, Math.min(1e9, integer(raw.hp ?? raw.maxHp, 10))), maxHp: Math.max(1, Math.min(1e9, integer(raw.maxHp ?? raw.hp, 10))), cover: Math.max(0, Math.min(12, integer(raw.cover ?? raw.shielding, 2))) };
      state.covers[id2].hp = Math.min(state.covers[id2].hp, state.covers[id2].maxHp);
    }
    for (const [i, raw] of (battle.interacts ?? battle.interactives ?? []).entries()) {
      const p = xyzOf(raw.xyz ?? raw), id2 = deterministicId(raw.id ?? `interactive-${i}`, "interactive");
      const kind = text2(raw.kind ?? raw.type).toLowerCase() === "altar" || /祭坛|altar/.test(text2(raw.name)) ? "altar" : "barrel";
      state.interactives[id2] = { id: id2, name: text2(raw.name) || (kind === "altar" ? "\u661F\u8F89\u796D\u575B" : "\u4F59\u70EC\u7206\u6876"), x: p.x, y: p.y, kind, spent: Boolean(raw.spent) };
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
    const mvu = source.mvu ?? source.statData ?? source.stat_data ?? {};
    const battle = parseBattleInit(source.battleInit ?? source.battle_init ?? source.battle ?? {});
    const chars = parseCharInfo(source.charInfo ?? source.char_info ?? "");
    const records = [...collectMvu(mvu), ...chars];
    const merged = mergeRecords(records);
    const participants = participantList(battle);
    const equipment = clone(EQUIPMENT), skills = clone(SKILLS), items = {};
    const units = {}, roster = [], sourceMap = {};
    for (const [i, participant] of participants.entries()) {
      const ref = text2(participant?.source ?? participant?.id ?? participant?.uid ?? participant?.name);
      const record = [...merged.values()].find((r) => sourceId(r) && sourceId(r) === ref || sourceName(r) === text2(participant?.name)) ?? [...merged.values()][i] ?? { name: participant?.name ?? `\u5355\u4F4D${i + 1}` };
      const made = unitFrom(record, participant, i, equipment, skills, items, warnings);
      if (units[made.unit.id]) {
        made.unit.id = deterministicId(`${made.unit.id}-${i}`, "unit");
        made.profile.id = made.unit.id;
      }
      units[made.unit.id] = made.unit;
      roster.push({ ...made.profile, name: made.unit.name, team: made.unit.team, source: record.__sourcePath ? "MVU" : "char_info" });
      sourceMap[made.unit.id] = { path: record.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record) };
    }
    if (!participants.length) for (const [i, record] of merged.values().entries()) {
      const made = unitFrom(record, { name: sourceName(record), source: sourceId(record), faction: i ? "red" : "blue", x: i, y: 0 }, i, equipment, skills, items, warnings);
      units[made.unit.id] = made.unit;
      roster.push({ ...made.profile, name: made.unit.name, team: made.unit.team, source: "MVU" });
      sourceMap[made.unit.id] = { path: record.__sourcePath, sourceId: sourceId(record), sourceName: sourceName(record) };
    }
    delete skills.__items;
    const title = text2(battle.sceneTitle ?? battle.title) || options.title || "\u9152\u9986\u6218\u672F\u6218\u5C40";
    const state = { scenarioId: deterministicId(battle.battleId ?? title, "battle"), title, mode: ["free", "split"].includes(options.mode) ? options.mode : "free", ruleset: ["protocol", "sandbox"].includes(options.ruleset) ? options.ruleset : "protocol", round: 1, turn: 0, order: Object.keys(units), units, items, equipment, skills, grid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: "floor", z: 0 }))), covers: {}, interactives: {}, zones: {}, rng: integer(battle.seed ?? options.seed, hash(title)) >>> 0, logs: [], outcome: null };
    terrainState(battle, state, warnings);
    uniquePositions(state.units, state);
    for (const unit of Object.values(state.units)) for (const itemId of [unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean)) {
      const templateId = itemId.includes("-") ? Object.keys(state.equipment).find((t) => itemId.includes(deterministicId(state.equipment[t].name, "x"))) : null;
      const template = Object.entries(state.equipment).find(([tid, t]) => itemId.includes(tid) || t.name && itemId.includes(deterministicId(t.name, "item")))?.[0] ?? Object.keys(state.equipment).find((t) => state.equipment[t].name === itemId);
      if (template && !state.items[itemId]) state.items[itemId] = { id: itemId, templateId: template, counters: Object.fromEntries((state.equipment[template].effects ?? []).flatMap((e) => e.kind === "ammo" ? [[e.counterKey || "ammo", integer(e.capacity, 1)]] : e.kind === "kill_charge_weapon" ? [[e.counterKey || "souls", 0]] : [])) };
    }
    for (const unit of Object.values(state.units)) for (const itemId of [unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean)) if (!state.items[itemId]) {
      const candidates = Object.keys(state.equipment).filter((t2) => !Object.values(state.items).some((i) => i.templateId === t2 && false));
      const t = candidates.find((t2) => unit.mainHand === itemId && state.equipment[t2].kind === "weapon" || unit.shield === itemId && state.equipment[t2].kind === "shield") ?? candidates[0];
      if (t) state.items[itemId] = { id: itemId, templateId: t, counters: {} };
    }
    try {
      validateState(state);
    } catch (error2) {
      warnings.push(`\u8F6C\u6362\u7ED3\u679C\u672A\u901A\u8FC7\u6821\u9A8C\uFF1A${error2.message}`);
      if (options.throwOnValidation) throw error2;
    }
    return { state, roster, warnings, sourceMap, battleInit: battle };
  }

  // src/tavern/overlay.js
  var isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
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
    for (const [key, value] of Object.entries(attrs2 || {})) {
      if (key === "class") n.className = value;
      else if (key === "style") n.style.cssText = value;
      else if (key === "text") n.textContent = value;
      else if (value != null) n.setAttribute(key, value);
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
  function deepMerge(base, extra) {
    const result = isObject(base) ? clone2(base) : {};
    if (!isObject(extra)) return result;
    for (const [key, value] of Object.entries(extra)) {
      if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
      else result[key] = clone2(value);
    }
    return result;
  }
  function deletePath(object2, path) {
    if (!path) return;
    const parts = String(path).trim().replace(/^\$\.?/, "").split(".").filter(Boolean);
    if (!parts.length) return;
    let cursor = object2;
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
    for (const path of excludedList(config.excludeParams ?? config.excludedParams ?? config.excludeBodyParams)) deletePath(body, path);
    const headers = { "Content-Type": "application/json", ...parseJSON(config.headers ?? config.extraHeaders ?? config.additionalHeaders ?? config.requestHeaders, {}) };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let url = text3(config.baseUrl || config.url || "").trim();
    if (!url) url = "/v1/chat/completions";
    url = url.replace(/\/$/, "");
    if (!/\/chat\/completions(?:\?.*)?$/.test(url)) url += "/chat/completions";
    return { url, body, headers };
  }
  async function requestAI(config, messages, fetchImpl) {
    const request = buildAIRequest(config, messages);
    const fetcher = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u6CA1\u6709 fetch");
    const response = await fetcher(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
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
      const indent = match[1].length, key = match[2], raw = match[3].trim();
      while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
      let valueOut = raw;
      if (!raw) {
        valueOut = {};
        stack.push({ indent, object: valueOut });
      } else if (/^(true|false)$/i.test(raw)) valueOut = raw.toLowerCase() === "true";
      else if (/^-?\d+(?:\.\d+)?$/.test(raw)) valueOut = Number(raw);
      else valueOut = parseJSON(raw, raw.replace(/^['"]|['"]$/g, ""));
      stack.at(-1).object[key] = valueOut;
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
  var DEFAULT_PROMPTS = [
    { title: "\u5C5E\u6027\u4E0E\u6218\u5C40\u6807\u51C6\u5316\u6821\u9A8C", role: "system", enabled: true, content: "\u8BF7\u6821\u9A8C {{mvu_data}}\u3001{{latest_floor}} \u4E0E {{standardized_roster}} \u7684\u6570\u503C\u548C\u7ED3\u6784\uFF0C\u8FD4\u56DE JSON patch\u3002" },
    { title: "\u5730\u5F62/\u53C2\u6570\u5FAE\u8C03\u6307\u4EE4\u8F93\u51FA", role: "user", enabled: true, content: "\u4F9D\u636E\u6218\u573A {{battle_init}} \u548C\u5F53\u524D\u72B6\u6001 {{battle_state}}\uFF0C\u5904\u7406\u73A9\u5BB6\u6307\u4EE4\uFF1A{{user_instruction}}\u3002\u53EA\u8F93\u51FA battle_patch \u6216 unit_patch JSON\u3002" }
  ];
  var DEFAULT_CONFIG = {
    baseUrl: "",
    apiKey: "",
    model: "",
    temperature: 0.2,
    max_tokens: 1200,
    extraBody: "{}",
    excludeParams: "",
    headers: "{}",
    hideLauncher: false,
    autoScan: true,
    prompts: DEFAULT_PROMPTS
  };
  function configFor(storage, key) {
    try {
      return deepMerge(DEFAULT_CONFIG, parseJSON(storage?.getItem(key), {}));
    } catch (_) {
      return clone2(DEFAULT_CONFIG);
    }
  }
  function putConfig(storage, key, value) {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch (_) {
    }
  }
  function chatId(host) {
    const helper = getGlobal(host, "TavernHelper");
    for (const fn of [helper?.getChatId, getGlobal(host, "getChatId")]) {
      try {
        if (typeof fn === "function") {
          const id2 = fn.call(helper);
          if (id2 != null) return String(id2);
        }
      } catch (_) {
      }
    }
    return text3(host?.location?.pathname || "default").replace(/[^\w.-]+/g, "_") || "default";
  }
  function tavernVariables(host) {
    const helper = getGlobal(host, "TavernHelper");
    const funcs = [helper?.getVariables, getGlobal(host, "getVariables")].filter((fn) => typeof fn === "function");
    for (const fn of funcs) {
      for (const arg of [{ type: "message" }, void 0]) {
        try {
          const result = fn.call(helper, arg);
          if (result && typeof result.then === "function") continue;
          if (result != null) return result;
        } catch (_) {
        }
      }
    }
    try {
      return getGlobal(host, "SillyTavern")?.getContext?.()?.chatMetadata?.stat_data || {};
    } catch (_) {
      return {};
    }
  }
  async function tavernVariablesAsync(host) {
    const helper = getGlobal(host, "TavernHelper");
    const funcs = [helper?.getVariables, getGlobal(host, "getVariables")].filter((fn) => typeof fn === "function");
    for (const fn of funcs) for (const arg of [{ type: "message" }, void 0]) {
      try {
        const result = await fn.call(helper, arg);
        if (result != null) return result;
      } catch (_) {
      }
    }
    return tavernVariables(host);
  }
  async function tavernMessages(host) {
    const helper = getGlobal(host, "TavernHelper");
    const funcs = [helper?.getChatMessages, getGlobal(host, "getChatMessages")].filter((fn) => typeof fn === "function");
    for (const fn of funcs) {
      for (const arg of [-1, "0-999"]) {
        try {
          const result = await fn.call(helper, arg, { include_swipes: false });
          if (result != null) return Array.isArray(result) ? result : [result];
        } catch (_) {
        }
      }
    }
    const doc = hostDocument();
    const nodes = doc ? [...doc.querySelectorAll(".mes, .chat-msg, [data-message-id], [data-mesid]")] : [];
    return nodes.map((node, index) => ({
      message_id: node.dataset.messageId ?? node.dataset.mesid ?? node.dataset.id ?? `floor-${index}`,
      swipe_id: node.dataset.swipeId ?? node.dataset.swipe ?? "0",
      content: node.querySelector(".mes_text, .message, [data-content]")?.textContent || node.textContent
    })).filter((item) => item.content);
  }
  function fillTemplate(value, sources, instruction = "") {
    const values = {
      battle_init: sources.battleInit || "",
      standardized_roster: sources.roster || "",
      mvu_data: JSON.stringify(sources.mvuData ?? {}, null, 2),
      latest_floor: sources.latestFloor || "",
      battle_state: JSON.stringify(sources.state ?? {}, null, 2),
      user_instruction: instruction
    };
    return text3(value).replace(/\{\{([\w]+)\}\}/g, (_, key) => values[key] ?? "");
  }
  function sourceBundle(variables, messages, chat = "default") {
    const list2 = Array.isArray(messages) ? messages : [];
    const latestMessage = list2.at(-1);
    const latestFloor = messageContent(latestMessage ?? variables?.latest_floor ?? variables?.latestFloor ?? "");
    const joined = list2.map(messageContent).join("\n");
    const allText = joined || latestFloor;
    let battleRaw = extractTag(allText, ["battle_init", "battle_in", "\u6218\u672F\u6C99\u76D8"]);
    if (!battleRaw) {
      const legacy = allText.match(/\{\s*(?:battle_in|战术沙盘)\s*\}\s*[:：]?\s*([\\s\\S]+)/i);
      if (legacy) battleRaw = legacy[1].trim();
      else {
        const wrapped = allText.match(/\{\s*"?(?:battle_in|战术沙盘)"?\s*:\s*([\\s\\S]+)\}/i);
        if (wrapped) battleRaw = wrapped[1].trim();
      }
    }
    const battleInit = parseJSON(battleRaw, battleRaw ? parseLooseYaml(battleRaw) : null);
    const charBlocks = extractTags(joined, "char_info");
    const charRaw = charBlocks[0] || "";
    const charInfo = charBlocks.flatMap((raw) => {
      const value = parseJSON(raw, null);
      return value ? [value] : [parseLooseYaml(raw)];
    });
    const mvuData = variables?.stat_data ?? variables?.message?.stat_data ?? variables ?? {};
    const battleSource = list2.findLast?.((message) => extractTag(messageContent(message), ["battle_init", "battle_in", "\u6218\u672F\u6C99\u76D8"])) ?? latestMessage;
    const battleKey = battleInit ? battleKeyFor(chat, battleSource, battleRaw, battleInit) : null;
    return {
      mvuData,
      latestFloor,
      battleInit,
      charInfo,
      battleRaw,
      charRaw,
      messages: list2,
      roster: "",
      battleKey,
      source: battleSource ? { ...messageMeta(battleSource, list2.length - 1), chatId: chat } : null
    };
  }
  function applyPatch(target, patch) {
    let result = clone2(target);
    if (isObject(patch) && !Array.isArray(patch) && !Array.isArray(patch.patch) && !Array.isArray(patch.jsonPatch)) {
      return deepMerge(result, patch);
    }
    const list2 = Array.isArray(patch) ? patch : patch?.patch || patch?.jsonPatch;
    if (!Array.isArray(list2)) return result;
    const pointer = (path) => String(path || "").split("/").slice(1).map((x) => x.replaceAll("~1", "/").replaceAll("~0", "~"));
    for (const operation of list2) {
      if (!operation || !operation.op) continue;
      const keys = pointer(operation.path), last = keys.pop();
      let parent = result;
      for (const key of keys) {
        if (parent == null) break;
        parent = parent[key];
      }
      if (parent == null) continue;
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
    if (doc.querySelector("style[data-fated-tavern-overlay]")) return;
    const css = `
[data-fated-tavern-overlay]{position:fixed;z-index:2147483000;color:#e8edf5;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
[data-fated-tavern-overlay] *{box-sizing:border-box}[data-fated-tavern-overlay] button{cursor:pointer;color:inherit;background:#263348;border:1px solid #52627d;border-radius:4px;padding:5px 9px}[data-fated-tavern-overlay] button:hover{background:#354968}
.fated-tavern-launcher{pointer-events:auto;position:fixed;right:18px;bottom:18px;border-radius:50%!important;width:44px;height:44px;background:#566bea!important;border:0!important;font-size:20px}.fated-tavern-panel{pointer-events:auto;position:fixed;right:64px;bottom:50px;width:min(860px,calc(100vw - 30px));height:min(700px,calc(100vh - 50px));min-width:360px;min-height:260px;resize:both;overflow:hidden;background:#141a25;border:1px solid #56627a;border-radius:8px;box-shadow:0 12px 44px #000b;display:flex;flex-direction:column}.fated-tavern-panel[hidden]{display:none}.fated-tavern-header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#202a3c;cursor:move}.fated-tavern-header strong{flex:1}.fated-tavern-header button{padding:2px 8px}.fated-tavern-tabs,.fated-tavern-subtabs{display:flex;gap:4px;padding:7px;background:#1a2231;border-bottom:1px solid #39465b}.fated-tavern-tabs button[aria-selected=true],.fated-tavern-subtabs button[aria-selected=true]{background:#566bea}.fated-tavern-content{overflow:auto;flex:1;padding:12px}.fated-tab{display:none}.fated-tab.active{display:block}.fated-tavern-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.fated-tavern-grid label{display:flex;flex-direction:column;gap:3px}.fated-tavern-grid input,.fated-tavern-grid textarea,.fated-tavern-grid select,[data-fated-tavern-overlay] textarea{background:#0d121b;color:#e8edf5;border:1px solid #4a5870;border-radius:4px;padding:6px}.fated-tavern-grid textarea{min-height:66px}.fated-prompt{border:1px solid #3c4a61;padding:8px;margin:7px 0;border-radius:5px}.fated-prompt textarea{width:100%;min-height:70px}.fated-instance{border:1px solid #3c4a61;padding:8px;margin:7px 0;border-radius:5px;white-space:pre-wrap}.fated-status{padding:7px;background:#0d121b;border-radius:4px;white-space:pre-wrap;max-height:150px;overflow:auto}.fated-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.fated-chat{display:flex;gap:6px}.fated-chat textarea{flex:1;min-height:54px}.fated-mini{opacity:.75;font-size:12px}`;
    (doc.head || doc.documentElement)?.append(el(doc, "style", { "data-fated-tavern-overlay": "" }, css));
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
    const id2 = options.instanceId || chatId(host);
    const configKey = `fated-tactical/tavern/${id2}`;
    const stateKey = `fated-tactical/instances/${id2}`;
    let config = configFor(storage, configKey);
    let disposed = false, gameMount = null, sources = {}, currentState = null;
    const listeners = [], controller = typeof AbortController === "function" ? new AbortController() : null;
    const on = (node, event, fn, opts = {}) => {
      if (!node) return;
      const options2 = controller ? { ...opts, signal: controller.signal } : opts;
      node.addEventListener(event, fn, options2);
      if (!controller) listeners.push(() => node.removeEventListener(event, fn, opts));
    };
    const root = el(doc, "div", { "data-fated-tavern-overlay": "" });
    const launcher = el(doc, "button", { class: "fated-tavern-launcher", title: "\u6253\u5F00\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0", "aria-label": "\u6253\u5F00\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0", type: "button" }, "\u{1FA84}");
    const panel = el(doc, "section", { class: "fated-tavern-panel", role: "dialog", "aria-label": "\u547D\u5B9A\u6218\u672F\u9152\u9986\u63A7\u5236\u53F0", hidden: "" });
    const header = el(doc, "header", { class: "fated-tavern-header" });
    const title = el(doc, "strong", {}, "\u547D\u5B9A\u6218\u672F\u63A7\u5236\u53F0");
    const minimize = el(doc, "button", { type: "button", title: "\u6700\u5C0F\u5316", "aria-label": "\u6700\u5C0F\u5316" }, "\u2212");
    const close = el(doc, "button", { type: "button", title: "\u5173\u95ED", "aria-label": "\u5173\u95ED" }, "\xD7");
    header.append(title, minimize, close);
    const tabs = el(doc, "nav", { class: "fated-tavern-tabs", role: "tablist" });
    const content = el(doc, "div", { class: "fated-tavern-content" });
    const pages = {};
    for (const [key, label] of [["instances", "\u7EF4\u62A4\u5B9E\u4F8B"], ["config", "\u914D\u7F6E / API + prompts"], ["sandbox", "\u6C99\u76D8"]]) {
      const button = el(doc, "button", { type: "button", role: "tab", "aria-selected": key === "instances" ? "true" : "false", "data-tab": key }, label);
      const page = el(doc, "div", { class: `fated-tab ${key === "instances" ? "active" : ""}`, "data-page": key });
      tabs.append(button);
      content.append(page);
      pages[key] = page;
      on(button, "click", () => {
        Object.entries(pages).forEach(([name, node]) => {
          node.classList.toggle("active", name === key);
        });
        [...tabs.children].forEach((x) => x.setAttribute("aria-selected", String(x === button)));
        if (key === "sandbox") scan();
      });
    }
    panel.append(header, tabs, content);
    root.append(launcher, panel);
    (doc.body || doc.documentElement)?.append(root);
    const instances = config.instances || (() => {
      try {
        return parseJSON(storage?.getItem(stateKey), {}) || {};
      } catch (_) {
        return {};
      }
    })();
    config.instances = isObject(instances) ? instances : {};
    function save() {
      putConfig(storage, configKey, config);
      putConfig(storage, stateKey, config.instances);
    }
    function open() {
      if (disposed) return;
      panel.hidden = false;
      launcher.hidden = true;
    }
    function hide() {
      panel.hidden = true;
      launcher.hidden = Boolean(config.hideLauncher);
    }
    function closePanel() {
      hide();
    }
    on(launcher, "click", open);
    on(close, "click", closePanel);
    on(minimize, "click", hide);
    function draggable(node, handle) {
      let drag = null;
      on(handle || node, "pointerdown", (event) => {
        if (event.target.closest("button") && handle) return;
        const rect = node.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        node.style.right = "auto";
        node.style.bottom = "auto";
        node.style.left = `${rect.left}px`;
        node.style.top = `${rect.top}px`;
        node.setPointerCapture?.(event.pointerId);
      });
      on(handle || node, "pointermove", (event) => {
        if (!drag) return;
        node.style.left = `${Math.max(0, drag.left + event.clientX - drag.x)}px`;
        node.style.top = `${Math.max(0, drag.top + event.clientY - drag.y)}px`;
      });
      on(handle || node, "pointerup", () => {
        drag = null;
      });
      on(handle || node, "pointercancel", () => {
        drag = null;
      });
    }
    draggable(launcher);
    draggable(panel, header);
    function renderInstances() {
      const page = pages.instances;
      page.replaceChildren(el(doc, "h3", {}, "\u5DF2\u7EF4\u62A4\u7684\u5B9E\u4F8B"));
      const toolbar = el(doc, "div", { class: "fated-actions" });
      const refresh = el(doc, "button", { type: "button" }, "\u4ECE\u5F53\u524D\u804A\u5929\u91CD\u65B0\u6C34\u5408");
      toolbar.append(refresh);
      page.append(toolbar);
      const list2 = el(doc, "div");
      page.append(list2);
      const entries = Object.entries(config.instances);
      if (!entries.length) list2.append(el(doc, "p", { class: "fated-mini" }, "\u6682\u65E0\u5B9E\u4F8B\u3002\u6253\u5F00\u6C99\u76D8\u4F1A\u81EA\u52A8\u8BFB\u53D6\u5F53\u524D MVU\u3001char_info \u548C battle_init\u3002"));
      for (const [key, instance] of entries) {
        const box = el(doc, "article", { class: "fated-instance" });
        box.append(el(doc, "strong", {}, instance.name || key), el(doc, "div", { class: "fated-mini" }, `\u6765\u6E90\uFF1A${instance.source || "\u624B\u52A8\u6216 AI \u7F16\u8F91"} \xB7 ${instance.notes || "\u5DF2\u6807\u51C6\u5316"}`));
        box.append(el(doc, "pre", { class: "fated-status" }, JSON.stringify(instance, null, 2)));
        const actions = el(doc, "div", { class: "fated-actions" });
        const edit = el(doc, "button", { type: "button" }, "\u7F16\u8F91 JSON");
        const remove = el(doc, "button", { type: "button" }, "\u5220\u9664");
        actions.append(edit, remove);
        box.append(actions);
        list2.append(box);
        on(remove, "click", () => {
          delete config.instances[key];
          save();
          renderInstances();
        });
        on(edit, "click", () => {
          const value = prompt("\u7F16\u8F91\u5B9E\u4F8B JSON", JSON.stringify(instance, null, 2));
          const parsed = parseJSON(value, null);
          if (parsed) {
            config.instances[key] = parsed;
            save();
            renderInstances();
          }
        });
      }
      on(refresh, "click", () => scan().catch(showError));
    }
    function field(label, value, type = "text") {
      const labelNode = el(doc, "label", {}, label);
      const input = el(doc, type === "textarea" ? "textarea" : "input", { type: type === "textarea" ? void 0 : type });
      input.value = value ?? "";
      labelNode.append(input);
      return { labelNode, input };
    }
    function renderConfig() {
      const page = pages.config;
      page.replaceChildren();
      const subtabs = el(doc, "nav", { class: "fated-tavern-subtabs" });
      const apiPage = el(doc, "div");
      const promptPage = el(doc, "div");
      for (const [name, label, target] of [["api", "API \u4E0E\u754C\u9762", apiPage], ["prompts", "\u63D0\u793A\u8BCD", promptPage]]) {
        const b = el(doc, "button", { type: "button", "aria-selected": name === "api" ? "true" : "false" }, label);
        subtabs.append(b);
        on(b, "click", () => {
          apiPage.hidden = name !== "api";
          promptPage.hidden = name !== "prompts";
          [...subtabs.children].forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        });
      }
      apiPage.className = promptPage.className = "fated-tavern-grid";
      page.append(subtabs, apiPage, promptPage);
      promptPage.hidden = true;
      const fields2 = [["baseUrl", "API \u5730\u5740"], ["apiKey", "API Key", "password"], ["model", "\u6A21\u578B\u540D\u79F0"], ["temperature", "temperature", "number"], ["max_tokens", "max_tokens", "number"], ["excludeParams", "\u6392\u9664\u4E3B\u4F53\u53C2\u6570\uFF08\u9017\u53F7\u5206\u9694\uFF09"], ["extraBody", "\u9644\u52A0\u4E3B\u4F53\u53C2\u6570 JSON", "textarea"], ["headers", "\u9644\u52A0\u8BF7\u6C42\u6807\u5934 JSON", "textarea"]];
      for (const [key, label, type] of fields2) {
        const f = field(label, config[key], type);
        apiPage.append(f.labelNode);
        on(f.input, "change", () => {
          config[key] = f.input.value;
          save();
        });
      }
      const hide2 = el(doc, "label", {});
      const checkbox = el(doc, "input", { type: "checkbox" });
      checkbox.checked = Boolean(config.hideLauncher);
      hide2.append(checkbox, " \u9690\u85CF\u60AC\u6D6E\u6309\u94AE\u5230\u9B54\u672F\u68D2\u83DC\u5355");
      apiPage.append(hide2);
      const auto = el(doc, "label", {});
      const autoCheck = el(doc, "input", { type: "checkbox" });
      autoCheck.checked = config.autoScan !== false;
      auto.append(autoCheck, " \u6253\u5F00\u6C99\u76D8\u65F6\u81EA\u52A8\u626B\u63CF");
      apiPage.append(auto);
      on(checkbox, "change", () => {
        config.hideLauncher = checkbox.checked;
        updateMagic();
        save();
      });
      on(autoCheck, "change", () => {
        config.autoScan = autoCheck.checked;
        save();
      });
      const test = el(doc, "button", { type: "button" }, "\u6D4B\u8BD5\u8FDE\u901A\u6027");
      const models = el(doc, "button", { type: "button" }, "\u62C9\u53D6\u6A21\u578B");
      const result = el(doc, "div", { class: "fated-status" });
      apiPage.append(test, models, result);
      on(test, "click", async () => {
        result.textContent = "\u8BF7\u6C42\u4E2D\u2026";
        try {
          const response = await requestAI(config, [{ role: "user", content: "\u8BF7\u53EA\u56DE\u590D OK" }]);
          result.textContent = JSON.stringify(response).slice(0, 1e3);
        } catch (e) {
          result.textContent = `\u5931\u8D25\uFF1A${e.message}`;
        }
      });
      on(models, "click", async () => {
        try {
          const fetcher = options.fetch || (typeof fetch === "function" ? fetch : null);
          if (!fetcher) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u6CA1\u6709 fetch");
          const url = text3(config.baseUrl).replace(/\/$/, "").replace(/\/chat\/completions$/, "") + "/models";
          const r = await fetcher(url, { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
          result.textContent = await r.text();
        } catch (e) {
          result.textContent = `\u5931\u8D25\uFF1A${e.message}`;
        }
      });
      const promptList = el(doc, "div");
      promptPage.append(promptList);
      const add = el(doc, "button", { type: "button" }, "\u65B0\u5EFA\u63D0\u793A\u8BCD");
      const reset = el(doc, "button", { type: "button" }, "\u91CD\u7F6E\u9ED8\u8BA4\u6A21\u677F");
      promptPage.append(add, reset);
      const renderPrompts = () => {
        promptList.replaceChildren();
        (config.prompts || []).forEach((prompt2, index) => {
          const box = el(doc, "article", { class: "fated-prompt" });
          const titleF = field("\u6807\u9898", prompt2.title);
          const role = el(doc, "select");
          for (const r of ["system", "user", "assistant"]) role.append(el(doc, "option", { value: r, text: r }));
          role.value = prompt2.role;
          const contentF = field("\u5185\u5BB9", prompt2.content, "textarea");
          const enabled = el(doc, "input", { type: "checkbox" });
          enabled.checked = prompt2.enabled !== false;
          box.append(titleF.labelNode, role, contentF.labelNode, enabled, " \u542F\u7528 ");
          const up = el(doc, "button", { type: "button" }, "\u4E0A\u79FB");
          const down = el(doc, "button", { type: "button" }, "\u4E0B\u79FB");
          const del = el(doc, "button", { type: "button" }, "\u5220\u9664");
          box.append(up, down, del);
          promptList.append(box);
          const changed = () => {
            prompt2.title = titleF.input.value;
            prompt2.role = role.value;
            prompt2.content = contentF.input.value;
            prompt2.enabled = enabled.checked;
            save();
          };
          on(titleF.input, "change", changed);
          on(role, "change", changed);
          on(contentF.input, "change", changed);
          on(enabled, "change", changed);
          on(up, "click", () => {
            if (index) [config.prompts[index - 1], config.prompts[index]] = [config.prompts[index], config.prompts[index - 1]];
            save();
            renderPrompts();
          });
          on(down, "click", () => {
            if (index < config.prompts.length - 1) [config.prompts[index + 1], config.prompts[index]] = [config.prompts[index], config.prompts[index + 1]];
            save();
            renderPrompts();
          });
          on(del, "click", () => {
            config.prompts.splice(index, 1);
            save();
            renderPrompts();
          });
        });
      };
      on(add, "click", () => {
        config.prompts.push({ title: "\u65B0\u63D0\u793A\u8BCD", role: "user", enabled: true, content: "{{user_instruction}}" });
        save();
        renderPrompts();
      });
      on(reset, "click", () => {
        config.prompts = clone2(DEFAULT_PROMPTS);
        save();
        renderPrompts();
      });
      renderPrompts();
    }
    async function hydrate() {
      const variables = await tavernVariablesAsync(host), messages = await tavernMessages(host);
      sources = sourceBundle(variables, messages, id2);
      const converter = options.converter || getGlobal(host, "FatedTactical")?.hydrateBattleState || getGlobal(host, "hydrateBattleState") || hydrateFromSources;
      let hydrated = null;
      if (typeof converter === "function") {
        const input = { mvu: sources.mvuData, stat_data: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit };
        try {
          hydrated = await converter(input);
        } catch (_) {
          try {
            hydrated = await converter(sources.mvuData, sources.charInfo, sources.battleInit);
          } catch (_2) {
          }
        }
      }
      if (hydrated?.state) currentState = hydrated.state;
      else if (hydrated && (hydrated.units || hydrated.grid)) currentState = hydrated;
      if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
      const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
      for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) {
        const key = item.id || item.uid || item.name || `unit-${Object.keys(config.instances).length + 1}`;
        config.instances[key] = { ...clone2(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? "MVU \u4E3B\u89D2" : "\u6B63\u6587 <char_info>") };
      }
      save();
      return hydrated;
    }
    async function mountState(state) {
      if (!state) return;
      const battleInstanceId = sources.battleKey || id2;
      const mount = options.mount || getGlobal(host, "FatedTactical")?.mount || getGlobal(host, "mount");
      if (typeof mount !== "function") return;
      const target = pages.sandbox.querySelector("[data-sandbox-mount]");
      try {
        gameMount?.unmount?.();
        gameMount = await mount(target, { instanceId: battleInstanceId, storage, state });
        gameMount?.loadState?.(state);
      } catch (e) {
        showError(e);
      }
    }
    function showError(error2) {
      const node = pages.sandbox.querySelector("[data-status]");
      if (node) node.textContent = `\u9519\u8BEF\uFF1A${error2?.message || error2}`;
    }
    async function scan() {
      const node = pages.sandbox.querySelector("[data-status]");
      if (node) node.textContent = "\u6B63\u5728\u8BFB\u53D6 MVU\u3001\u6700\u65B0\u697C\u5C42\u5E76\u8F6C\u6362\u2026";
      try {
        const hydrated = await hydrate();
        await mountState(currentState || hydrated?.state);
        renderInstances();
        if (node) node.textContent = currentState ? "\u626B\u63CF\u5B8C\u6210\uFF0C\u5DF2\u52A0\u8F7D\u6807\u51C6\u5316\u72B6\u6001\u3002" : "\u626B\u63CF\u5B8C\u6210\uFF08\u672A\u627E\u5230\u53EF\u6302\u8F7D\u7684\u6218\u5C40\uFF09\u3002";
      } catch (e) {
        showError(e);
      }
    }
    function renderSandbox() {
      const page = pages.sandbox;
      page.replaceChildren(el(doc, "h3", {}, "\u6C99\u76D8"));
      const status2 = el(doc, "div", { class: "fated-status", "data-status": "" }, "\u6253\u5F00\u6B64\u9875\u4F1A\u81EA\u52A8\u4FA6\u6D4B\u5F53\u524D\u804A\u5929\u3002");
      page.append(status2);
      const mountTarget = el(doc, "div", { "data-sandbox-mount": "", style: "min-height:90px;margin:8px 0;border:1px dashed #465675;padding:8px" }, "\u6218\u68CB\u754C\u9762\u6302\u8F7D\u533A");
      page.append(mountTarget);
      const actions = el(doc, "div", { class: "fated-actions" });
      const check = el(doc, "button", { type: "button" }, "\u6821\u9A8C");
      const report = el(doc, "button", { type: "button" }, "\u6218\u62A5\u4EA4\u4ED8");
      const refresh = el(doc, "button", { type: "button" }, "\u91CD\u65B0\u626B\u63CF");
      actions.append(check, report, refresh);
      page.append(actions);
      const instruction = el(doc, "textarea", { placeholder: "\u8BA9\u8F85\u52A9 AI \u8C03\u6574\u5730\u5F62\u3001\u7AD9\u4F4D\u6216\u89D2\u8272\u53C2\u6570\u2026" });
      instruction.style.width = "100%";
      page.append(instruction);
      const chat = el(doc, "div", { class: "fated-chat" });
      const send = el(doc, "button", { type: "button" }, "\u53D1\u9001");
      chat.append(instruction, send);
      page.append(chat);
      const output = el(doc, "pre", { class: "fated-status", "data-ai-output": "" });
      page.append(output);
      on(refresh, "click", () => scan().catch(showError));
      on(report, "click", () => {
        try {
          const reportText = gameMount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.() || "";
          const patch = gameMount?.exportMvuPatch?.() || options.game?.exportMvuPatch?.() || "";
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
      async function ask() {
        const prompts = (config.prompts || []).filter((x) => x.enabled !== false).map((x) => ({ role: x.role || "user", content: fillTemplate(x.content, { ...sources, state: currentState }) }));
        prompts.push({ role: "user", content: instruction.value });
        try {
          const response = await requestAI(config, prompts, options.fetch || void 0);
          const content2 = response?.choices?.[0]?.message?.content || response?.content || JSON.stringify(response);
          output.textContent = content2;
          const parsed = parseAIResponse(content2);
          if (parsed.patch && currentState) {
            currentState = applyPatch(currentState, parsed.patch);
            await mountState(currentState);
          }
        } catch (e) {
          output.textContent = `AI \u5931\u8D25\uFF1A${e.message}`;
        }
      }
      on(check, "click", ask);
      on(send, "click", ask);
    }
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
      try {
        getGlobal(host, "replaceScriptButtons")?.();
      } catch (_) {
      }
    }
    renderInstances();
    renderConfig();
    renderSandbox();
    updateMagic();
    const api = { open, close: closePanel, dispose, scan, getConfig: () => clone2(config), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, getSources: () => clone2(sources), getState: () => clone2(currentState) };
    function dispose() {
      if (disposed) return;
      disposed = true;
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

  // src/tavern/main.js
  if (typeof window !== "undefined") {
    const host = (() => {
      try {
        return window.parent?.document ? window.parent : window;
      } catch {
        return window;
      }
    })();
    mountTavernOverlay({ host });
  }
  return __toCommonJS(main_exports);
})();
