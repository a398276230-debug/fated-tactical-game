var FatedTacticalTavern = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target2, all) => {
    for (var name in all)
      __defProp(target2, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key4 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key4) && key4 !== except)
          __defProp(to, key4, { get: () => from[key4], enumerable: !(desc = __getOwnPropDesc(from, key4)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/tavern/main.js
  var main_exports = {};
  __export(main_exports, {
    BATTLE_INIT_DISPLAY_REGEX: () => BATTLE_INIT_DISPLAY_REGEX,
    BATTLE_INIT_DISPLAY_REPLACEMENT: () => BATTLE_INIT_DISPLAY_REPLACEMENT,
    BATTLE_INIT_DISPLAY_RULE: () => BATTLE_INIT_DISPLAY_RULE,
    mountTavernOverlay: () => mountTavernOverlay,
    renderBattleInitEntry: () => renderBattleInitEntry
  });

  // src/core/spatial.js
  var EPSILON = 1e-9;
  var CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  var DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  var NEIGHBORS = [...CARDINAL, ...DIAGONAL];
  var key = ({ x, y }) => `${x},${y}`;
  var same = (a, b) => a.x === b.x && a.y === b.y;
  var byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  var table = (collection) => Object.values(collection ?? {});
  var atBattleEdge = (state, { x, y }) => x === 0 || y === 0 || y === state.grid.length - 1 || x === state.grid[y]?.length - 1;
  function cellAt(state, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return void 0;
    return state.grid[y]?.[x];
  }
  var elevation = (state, at) => (cellAt(state, at.x, at.y)?.z ?? 0) + (at.altitude ?? 0);
  var isGround = (state, at) => {
    const cell = cellAt(state, at.x, at.y);
    return Boolean(cell && cell.kind !== "wall");
  };
  var unitAt = (state, x, y, exceptId) => table(state.units).filter((unit) => unit.hp > 0 && !unit.fled && unit.x === x && unit.y === y && unit.id !== exceptId).sort(byId)[0];
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
    const passable = (at) => from.altitude > 0 ? isGround(state, at) : passableEdge(state, from, at);
    if (gridDistance(from, to) !== 1 || !passable(to)) return false;
    const vacant = (at) => !unitAt(state, at.x, at.y, ignoreUnitId) && !coverAt(state, at.x, at.y);
    if (!vacant(to)) return false;
    if (!dx || !dy) return true;
    return diagonal && [{ x: from.x, y: to.y }, { x: to.x, y: from.y }].every((at) => vacant(at) && passable(at) && passableEdge(state, at, to));
  }
  function search(state, unit, limit, options, target2) {
    if (!isGround(state, unit) || !(limit >= 0)) return [];
    const start = { x: unit.x, y: unit.y, altitude: unit.altitude, z: elevation(state, unit), cost: 0, previous: null };
    const visited = /* @__PURE__ */ new Set([key(start)]), queue = [start];
    const stepOptions = { ignoreUnitId: unit.id, ...options };
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i];
      if (target2 && same(from, target2)) return [from];
      if (from.cost + 1 > limit) continue;
      for (const [dx, dy] of stepOptions.diagonal === false ? CARDINAL : NEIGHBORS) {
        const to = { x: from.x + dx, y: from.y + dy, altitude: unit.altitude };
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
    return table(state.units).some((ally) => ally.hp > 0 && !ally.fled && ally.id !== attacker.id && ally.team === attacker.team && adjacent(ally) && dx * (ally.x - defender.x) + dy * (ally.y - defender.y) < 0);
  }

  // src/core/effect_schema.js
  var enumOf = (...values4) => ({ enum: values4 });
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
  var nodeNotes = {
    damage: "\u5BF9\u76EE\u6807\u9020\u6210\u4E00\u6B21\u4F24\u5BB3\uFF1B\u4EC5\u6B64\u6BB5\u4E0D\u80FD\u81F4\u6B7B\u65F6\u5199 lethal:false\uFF0C\u4E0D\u8981\u7528\u964D\u4F4E\u4F24\u5BB3\u500D\u7387\u4EE3\u66FF\u3002",
    heal: "\u6062\u590D\u76EE\u6807\u751F\u547D\u5E76\u89E6\u53D1\u6CBB\u7597\u4E8B\u4EF6\uFF1B\u8981\u6062\u590D\u6CD5\u529B\u6216\u4F53\u529B\u8BF7\u7528 restoreResource\u3002",
    changeAltitude: "\u6539\u53D8\u65BD\u672F\u8005\u79BB\u5730\u9AD8\u5EA6\uFF0C\u9ED8\u8BA4\u5347\u9AD8 3\u3002delta \u4E3A\u6709\u7B26\u53F7\u9AD8\u5EA6\u5DEE\uFF0C0 \u79BB\u5730\u9AD8\u5EA6\u8868\u793A\u843D\u5730\uFF1Bland:true \u53EF\u76F4\u63A5\u843D\u5730\u3002\u4FDD\u6301\u5230\u518D\u6B21\u6539\u53D8\u9AD8\u5EA6\uFF0C\u9002\u7528\u4E8E\u98DE\u884C\u548C\u60AC\u6D6E\u3002",
    modifyTerrain: "\u6539\u53D8\u533A\u57DF\u5185\u683C\u5B50\u7684\u9AD8\u5EA6\uFF1Araise/lower \u662F\u76F8\u5BF9\u53D8\u5316\uFF0Cset \u662F\u7EDD\u5BF9\u9AD8\u5EA6\uFF1B\u4E0D\u6539\u53D8\u5730\u9762\u7C7B\u578B\u3002",
    setTerrainKind: "\u628A\u533A\u57DF\u6539\u4E3A\u5730\u9762\u3001\u5899\u6216\u5761\uFF1B\u9020\u5899\u8DF3\u8FC7\u5DF2\u5360\u7528\u683C\uFF0C\u4E34\u65F6\u5899\u7528 remainingTurns \u8BBE\u7F6E\u65F6\u9650\u3002",
    addCover: "\u5728\u53EF\u7528\u683C\u751F\u6210\u6709\u8010\u4E45\u7684\u63A9\u4F53\uFF1B\u8981\u5F7B\u5E95\u963B\u65AD\u89C6\u7EBF\u8BF7\u6539\u7528\u5899\u3002",
    restoreResource: "\u5411\u76EE\u6807\u8D44\u6E90\u6C60\u8FD4\u8FD8\u8D44\u6E90\uFF1B\u652F\u6301\u6309\u65BD\u653E\u8D39\u7528\u8FD4\u8FD8\uFF0C\u5E76\u53D7\u7981\u6B62\u6062\u590D\u6548\u679C\u9650\u5236\u3002",
    drainResource: "\u4ECE\u76EE\u6807\u8D44\u6E90\u6C60\u6263\u8D39\uFF1B\u5FC5\u987B\u4ED8\u8DB3\u624D\u7EE7\u7EED\u65F6\u7528 requireFull\u3002",
    produceResource: "\u4EA7\u751F\u6307\u5B9A\u8D44\u6E90\uFF1B\u8981\u5B9A\u4E49\u88C5\u5907\u5B9E\u4F8B\u8BA1\u6570\u5668\uFF0C\u5728 passive/self \u4E2D\u58F0\u660E cap \u548C initial\u3002",
    grantStatus: "\u65BD\u52A0\u5DF2\u6709\u72B6\u6001\u6A21\u677F\uFF1BstatusId \u662F\u6A21\u677F ID \u800C\u975E\u663E\u793A\u540D\uFF0C\u81EA\u5B9A\u4E49\u72B6\u6001\u8981\u5148\u5EFA\u6A21\u677F\u3002",
    removeStatus: "\u89E3\u9664\u72B6\u6001\uFF0C\u6309 statusId \u6216 category \u4E8C\u9009\u4E00\uFF1B\u4E0D\u80FD\u6E05\u9664\u6C38\u4E45\u72B6\u6001\u3002",
    modifyStat: "\u8C03\u6574\u5C5E\u6027\u6570\u503C\uFF1B\u88AB\u52A8\u7528\u4E8E\u5E38\u9A7B\u4FEE\u6B63\uFF0C\u89E6\u53D1\u5F0F\u7528\u4E8E\u6709\u671F\u9650\u7684\u4FEE\u6B63\u3002",
    modifyDamageBase: "\u88AB\u52A8\uFF1A\u66FF\u6362\u653B\u51FB\u8D77\u4F24\uFF0C\u4E0D\u662F\u989D\u5916\u9020\u6210\u4E00\u6BB5\u4F24\u5BB3\u3002",
    modifyCheck: "\u88AB\u52A8\uFF1A\u7ED9\u6307\u5B9A\u68C0\u5B9A\u52A0\u503C\uFF1B\u8981\u6539\u53D8\u57FA\u7840\u5C5E\u6027\u7528 modifyStat\u3002",
    forceOutcome: "\u88AB\u52A8\uFF1A\u8BA9\u5E26\u4F24\u5BB3\u7684\u4E3B\u51FB\u5FC5\u5B9A\u547D\u4E2D\u6216\u66B4\u51FB\uFF0C\u4E0D\u5355\u72EC\u9020\u6210\u4F24\u5BB3\u3002",
    upgradeHitTier: "\u88AB\u52A8\uFF1A\u5C06\u5DF2\u7ECF\u547D\u4E2D\u7684\u8BC4\u7EA7\u63D0\u5347\u4E00\u6863\uFF0C\u4E0D\u628A\u672A\u547D\u4E2D\u53D8\u6210\u547D\u4E2D\u3002",
    multiplyDamage: "\u8C03\u6574\u4F24\u5BB3\u500D\u7387\uFF1Bfactor \u662F\u603B\u7CFB\u6570\uFF0C\u589E\u4F24 12% \u5199 1.12\u3002",
    knockback: "\u5C06\u76EE\u6807\u9010\u683C\u63A8\u79BB\u65BD\u672F\u8005\uFF1B\u9047\u963B\u65F6\u7ED3\u7B97\u78B0\u649E\u4F24\u5BB3\u548C\u7729\u6655\u3002",
    teleportBackstab: "\u79FB\u5230\u76EE\u6807\u80CC\u540E\u7684\u53EF\u7528\u683C\u8FDB\u884C\u80CC\u523A\uFF0C\u4E0D\u662F\u4EFB\u610F\u5750\u6807\u4F20\u9001\u3002",
    shield: "\u4E3A\u76EE\u6807\u6DFB\u52A0\u9650\u65F6\u62A4\u76FE\u5438\u6536\u4F24\u5BB3\uFF1Bstack \u7528\u4E8E\u53E0\u52A0\u73B0\u6709\u76FE\u91CF\u3002",
    execute: "\u6309\u5269\u4F59\u751F\u547D\u6BD4\u4F8B\u5224\u65AD\u65A9\u6740\uFF1Bstrict \u8868\u793A\u4E25\u683C\u4F4E\u4E8E\u9608\u503C\uFF0C\u4ECD\u53D7\u4FDD\u547D\u89C4\u5219\u9650\u5236\u3002",
    summon: "\u514B\u9686\u5DF2\u6709\u539F\u578B\uFF1BtemplateId \u6307\u5411 summonTemplates \u6216\u573A\u4E0A\u5355\u4F4D\uFF0CstatScale \u7F29\u653E\u9762\u677F\uFF0C\u4E0D\u7EE7\u627F\u88C5\u5907\u3002\u6CA1\u6709\u539F\u578B\u7528 spawnUnit\u3002",
    spawnUnit: "\u65E0\u9700\u539F\u578B\uFF0C\u6309 name \u751F\u6210\u53CB\u65B9\u68CB\u5B50\uFF1B\u901A\u5E38\u7701\u7565\u4E94\u7EF4\u4E0E\u8D44\u6E90\uFF0C\u7531\u65BD\u672F\u8005\u9884\u7B97\u63A8\u7B97\uFF0Ctier \u4E0D\u9AD8\u4E8E\u65BD\u672F\u8005\u3002skills \u586B state.skills \u7684 ID\uFF0C\u88C5\u5907\u69FD\u586B state.equipment \u6A21\u677F ID\uFF08\u4E0D\u662F\u5B9E\u4F8B ID\uFF09\uFF0C\u6BCF\u53EA\u72EC\u7ACB\u94F8\u88C5\u3002",
    raiseDead: "\u6D88\u8017\u672A\u4F7F\u7528\u7684\u5C38\u4F53\u751F\u6210\u4EA1\u7075\uFF1B\u65E0\u5C38\u4F53\u7684\u53EC\u5524\u4E0D\u8981\u7528\u6B64\u8282\u70B9\u3002",
    addItem: "\u589E\u52A0\u5355\u4F4D\u5E93\u5B58\u4E2D\u7684\u7269\u54C1\u6570\u91CF\uFF0C\u4E0D\u94F8\u9020\u6216\u88C5\u5907 state.items \u5B9E\u4F8B\u3002",
    chainEffect: "\u4F9D\u6B21\u6267\u884C\u5B50\u8282\u70B9\uFF1B\u524D\u4E00\u6B65\u6CA1\u6709\u751F\u6548\u5C31\u5E94\u505C\u6B62\u65F6\u5199 stopOnFailure:true\u3002",
    procEffect: "\u901A\u8FC7 ref \u8C03\u7528\u5DF2\u6709\u8868\u8FBE\u5F0F\u7684 ID\uFF0C\u4ECD\u9700\u901A\u8FC7\u5176\u89E6\u53D1\u95E8\u69DB\uFF1B\u7981\u6B62\u5FAA\u73AF\u5F15\u7528\u3002"
  };
  var node = (kind, properties, required = []) => {
    if (!Object.hasOwn(nodeNotes, kind) || !nodeNotes[kind].trim()) throw new Error(`DSL \u8282\u70B9 ${kind} \u7F3A\u5C11\u7528\u6CD5\u8BF4\u660E`);
    return { ...object({ kind: { const: kind }, enabled: { ...bool, default: true }, label: string, target, condition: ref("condition"), radius: number(0, 15), ...properties }, ["kind", ...required]), description: nodeNotes[kind] };
  };
  var coord = integer(0, 9);
  var point = object({ x: coord, y: coord }, ["x", "y"]);
  var anchor = enumOf("self", "hitTarget");
  var terrainDuration = { area: ref("terrainArea"), remainingTurns: turns, persistent: bool };
  var resource = { resource: id, ...magnitudes, ...scaling };
  var attribute = enumOf("str", "agi", "con", "int", "spi");
  var events = ["on_attack", "on_hit", "on_damaged", "on_kill", "on_death", "on_turn_start", "on_turn_end", "on_skill_cast", "on_equip", "on_heal", "on_ally_death"];
  var expireRule = union(
    object({ trigger: enumOf("on_damaged"), damageType: enumOf("any", "direct", "indirect"), exceptSource: enumOf("self") }, ["trigger"]),
    object({ trigger: enumOf("on_struck", ...events.filter((event) => event !== "on_damaged")), exceptSource: enumOf("self") }, ["trigger"])
  );
  var checkKeys = ["iniBonus", "dodgeBonus", "stealthBonus", "accuracyBonus", "initiativeAgility", "dodgeAgility", "coreBonus", "highGroundRange", "highGroundAccuracy", "advantage"];
  var modifiers = { type: "object", additionalProperties: union(number(-1e9, 1e9), string, { type: "boolean" }) };
  var effectSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Fated Tactical Game effect expression",
    $ref: "#/$defs/expression",
    $defs: {
      terrainArea: union(
        object({ cells: array(point, 100) }, ["cells"]),
        object({ rect: object({ x1: coord, y1: coord, x2: coord, y2: coord }, ["x1", "y1", "x2", "y2"]) }, ["rect"]),
        object({ center: union(point, anchor), radius: number(0, 15), follow: { const: false } }, ["center", "radius"]),
        object({ center: anchor, radius: number(0, 15), follow: { const: true } }, ["center", "radius", "follow"])
      ),
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
        node("modifyTerrain", { ...terrainDuration, terrain: enumOf("raise", "lower"), amount: integer(0, 12) }, ["area", "terrain", "amount"]),
        node("modifyTerrain", { ...terrainDuration, terrain: enumOf("set"), amount: integer(-4, 8) }, ["area", "terrain", "amount"]),
        node("setTerrainKind", { ...terrainDuration, terrainKind: enumOf("floor", "wall", "slope") }, ["area", "terrainKind"]),
        node("addCover", { ...terrainDuration, hp: integer(1, 1e9) }, ["area", "hp"]),
        node("heal", { ...magnitudes, ...scaling, percentOfMaxHp: fraction }),
        ...["restoreResource", "drainResource", "produceResource"].map((kind) => node(kind, { ...resource, minimumRemaining: amount, requireFull: bool, local: bool, ...kind === "produceResource" ? { cap: integer(1, 1e9), initial: integer(0, 1e9), reloadable: bool, targetTierBase: integer(1, 8) } : {}, percentPerCost: fraction }, ["resource"])),
        node("grantStatus", { statusId: id, turns, stacks: integer(1, 10), modifiers, amount, expireOn: ref("expireOn"), durationType: enumOf("battle_turns", "until_removed", "persistent") }, ["statusId"]),
        node("removeStatus", { statusId: id, category: enumOf("all_negative", "buff", "debuff", "control", "dot", "hot", "shield") }),
        node("modifyStat", { stat: stats, flat: number(-1e9, 1e9), percent: number(-1, 10), duration: turns, damageType, levelScaling: scaling.levelScaling }, ["stat"]),
        node("modifyDamageBase", { value: amount, ignoreAttributes: bool, unscaled: bool, damageType }, ["value"]),
        node("modifyCheck", Object.fromEntries(checkKeys.map((key4) => [key4, number(-30, 30)]))),
        node("forceOutcome", { mode: enumOf("hit", "crit") }, ["mode"]),
        node("upgradeHitTier", {}),
        node("changeAltitude", { delta: integer(-12, 12), land: { type: "boolean" } }),
        node("knockback", { distance: integer(1, 5), collisionDamage: integer(0, 80) }),
        node("teleportBackstab", { bonusMultiplier: number(0, 4) }),
        node("shield", { ...magnitudes, ...scaling, turns, stack: bool, percentOfHealing: number(0, 4) }),
        node("spawnUnit", {
          name: string,
          count: integer(1, 10),
          tier: integer(1, 7),
          attribute,
          stats: object(Object.fromEntries(attribute.enum.map((k) => [k, integer(0, 20)])), attribute.enum),
          maxHp: integer(1, 1e9),
          maxMp: integer(0, 1e9),
          maxSp: integer(0, 1e9),
          armor: integer(0, 1e6),
          size: integer(1, 5),
          bodyLengthM: number(0.01, 1e9),
          mc: integer(1, 64),
          move: integer(1, 10),
          skills: array(id, 32, 0),
          gear: array(id, 12, 0),
          ...Object.fromEntries(["mainHand", "offHand", "shield"].map((k) => [k, union(id, { type: "null" })]))
        }, ["name"]),
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
        return value && Object.getPrototypeOf(value) === Object.prototype && schema.required?.every((key4) => Object.hasOwn(value, key4)) !== false && Object.entries(value).every(([key4, item]) => !Object.hasOwn(Object.prototype, key4) && key4 !== "prototype" && (Object.hasOwn(schema.properties ?? {}, key4) ? next(item, schema.properties[key4]) : schema.additionalProperties && next(item, schema.additionalProperties)));
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
  var terrainKinds = ["modifyTerrain", "setTerrainKind", "addCover"];
  var validTerrainNode = (node3) => terrainKinds.includes(node3?.kind) && matches(node3, effectSchema.$defs.node);
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
  var own = (table4, key4) => Object.hasOwn(table4 ?? {}, key4) ? table4[key4] : void 0;
  var values = (table4) => Object.values(table4 ?? {});
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
    for (const [table4, context] of [["equipment", "equipment"], ["skills", "skill"]]) {
      for (const [id3, template] of Object.entries(state[table4] ?? {})) {
        if (Array.isArray(template?.effects) && template.effects.some((e) => !isExpression(e))) {
          template.effects = adaptLegacyEffects(template.effects, context, `legacy-${table4}-${id3}`);
        }
      }
    }
    return state;
  }
  function createEffectEngine(io) {
    const expressions = (state, actor) => io.equipped(state, actor).flatMap(({ template, instance }) => {
      if (template?.boundTo && template.boundTo !== actor.id) return [];
      return (template?.effects ?? []).filter(isExpression).map((expr) => ({ expr, key: equippedKey(instance, expr), instance, sourceName: template.name }));
    });
    const skillExpressions2 = (skill2, id3) => (skill2?.effects ?? []).filter(isExpression).map((expr) => ({ expr, key: `skill-${id3}:${expr.id}`, sourceName: skill2.name }));
    const activeId = (key4) => `effect:${key4}`;
    function activeSkills(state, actor) {
      if (!actor) return [];
      return expressions(state, actor).filter(({ expr }) => expr.trigger === "active" && [...effectNodes(expr.effects, true)].some((node3) => node3.kind !== "chainEffect")).map((entry) => {
        const { expr, key: key4 } = entry, p = expr.params ?? {};
        return [activeId(key4), {
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
    function usageStatus(state, actor, { expr, key: key4 }) {
      const usage = own(actor.effectUsage, key4);
      const p = expr.params ?? {};
      const limit = p.usesPerBattle === void 0 && expr.trigger === "on_equip" ? 1 : p.usesPerBattle;
      return {
        usesLeft: limit == null ? null : Math.max(0, limit - (usage?.count ?? 0)),
        cooldownRemaining: usage ? Math.max(0, (p.cooldown ?? 0) - (state.round - usage.round)) : 0
      };
    }
    function available(state, actor, entry) {
      const { usesLeft, cooldownRemaining } = usageStatus(state, actor, entry);
      return usesLeft !== 0 && cooldownRemaining === 0;
    }
    function spendUse(state, actor, { key: key4 }) {
      const usage = actor.effectUsage ??= {};
      usage[key4] = { count: (own(usage, key4)?.count ?? 0) + 1, round: state.round };
    }
    function condition3(state, actor, subject3, rule, ctx, entry) {
      if (!rule) return true;
      const check2 = (child) => condition3(state, actor, subject3, child, ctx, entry);
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
          return compare2(ratio(subject3), op, value);
        case "targetLevel":
          return !!subject3 && compare2(subject3.tier ?? 1, op, actor.tier ?? 1);
        case "targetHasCategory": {
          if (!subject3) return false;
          const categories = values(subject3.statuses).map((s) => s.category);
          const negative = categories.some((x) => ["debuff", "dot", "control"].includes(x));
          return value === "none" ? !negative : value === "negative" ? negative : categories.includes(value);
        }
        case "targetCreatureType":
          return [].concat(subject3?.creatureType ?? []).includes(value);
        case "timeOfDay":
          return state.time?.timeOfDay === value;
        case "selfHasStatus":
          return !!own(actor.statuses, value);
        case "selfStatusModifier":
          return Boolean(io.statusModifier(actor, rule.key)) === value;
        case "targetHasStatus":
          return !!own(subject3?.statuses, value);
        case "selfHasTag":
          return actor.tags?.includes(value) ?? false;
        case "targetHasTag":
          return subject3?.tags?.includes(value) ?? false;
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
          return Boolean(subject3 && subject3.team !== actor.team) === (value ?? true);
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
          return !!subject3 && compare2(io.distance(state, actor, subject3), op, value);
        case "usesLeft":
          return (ctx.castUses?.has(entry.key) === true || available(state, actor, entry)) === (value ?? true);
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
    const subject2 = (actor, target2, ctx) => target2 === actor ? ctx.target ?? actor : target2;
    function magnitude(state, actor, target2, p, ctx) {
      const tier = actor.tier ?? 1;
      const ls = p.levelScaling;
      const level = levelScale(ls, tier);
      const rs = p.resourceScale;
      const units = rs ? resource3(state, actor, rs.resource) / (rs.unitSize ?? 1) : 0;
      const scaled = (p.amount ?? 0) * level + (p.perLevel ?? 0) * tier + (rs ? (rs.unitSize ? Math.floor(units) : units) * rs.perUnit : 0);
      return scaled + (p.flat ?? 0) + (p.percentOfHealing ?? 0) * (ctx.healing ?? 0) + (p.targetTierBase ? p.targetTierBase ** ((ctx.target?.tier ?? 1) - 1) : 0) + (p.percentOfDamageDealt ?? 0) * (ctx.dealt ?? 0) + (p.percentOfPrevious ?? 0) * (ctx.previous ?? 0) + (p.percentOfSelfMaxHp ?? 0) * actor.maxHp + (p.percentOfTargetMaxHp ?? p.percentOfMaxHp ?? 0) * target2.maxHp + (p.percentOfPower ?? 0) * (ctx.power ?? 0);
    }
    function nodeAmount(state, actor, target2, p, ctx) {
      const extra = ["heal", "shield", "damage"].includes(p.kind) ? (p.percent ?? 0) * target2.maxHp : 0;
      return Math.max(0, Math.min(1e9, Math.floor((magnitude(state, actor, target2, p, ctx) + extra) * (ctx.skillScale ?? 1))));
    }
    function damagePacket(state, actor, target2, p, ctx, amount2) {
      const type = (p.inheritDamageType ? ctx.damageType : p.damageType) ?? "true";
      const raw = amount2 * (p.resourceMultiplier ? resource3(state, actor, p.resourceMultiplier) : 1) * (p.strikeBonus ? 1 : ctx.damageFactor?.(type) ?? damageFactor(state, actor, { ...ctx, target: target2, damageType: type }));
      return { type, raw, hit: p.strikeBonus, ignoreArmor: p.ignoreArmor, preserveLife: p.lethal === false || ctx.nonLethal };
    }
    function previewEffects(state, actor, target2, trigger, ctx, extra, support) {
      const packets = [];
      let conditional = false;
      const entries2 = new Map([...trigger === "active" ? [] : expressions(state, actor), ...extra].map((entry) => [entry.key, entry]));
      for (const entry of entries2.values()) {
        const { expr } = entry;
        if (expr.trigger !== trigger || !available(state, actor, entry) || !sourceApplies(entry, ctx)) continue;
        const eligible = targets(state, actor, expr.target, ctx, expr.params?.radius ?? 1).filter((unit) => condition3(state, actor, subject2(actor, unit, ctx), expr.condition, ctx, entry));
        if (!eligible.length) continue;
        for (const node3 of expr.effects) {
          if (node3.enabled === false) continue;
          if (node3.kind === "procEffect" || node3.kind === "chainEffect") {
            conditional = true;
            continue;
          }
          if (!["damage", "heal", "shield"].includes(node3.kind)) continue;
          const p = { ...expr.params, ...node3 };
          const recipients = p.target && p.target !== expr.target ? targets(state, actor, p.target, ctx, p.radius ?? 1) : eligible;
          if (node3.kind !== "damage") {
            if (!support || expr.roll || p.percentOfPrevious || p.percentOfDamageDealt || p.percentOfHealing) continue;
            for (const recipient of recipients) {
              if (!livingUnit(recipient) || !condition3(state, actor, subject2(actor, recipient, ctx), p.condition, ctx, entry)) continue;
              const amount2 = nodeAmount(state, actor, recipient, p, ctx);
              if (amount2 > 0) support.push({ id: recipient.id, kind: node3.kind, amount: amount2, stack: p.stack });
            }
            continue;
          }
          if (!target2 || !recipients.some((unit) => unit.id === target2.id) || p.excludeHitTarget && target2.id === ctx.target?.id) continue;
          if (!condition3(state, actor, subject2(actor, target2, ctx), p.condition, ctx, entry)) continue;
          if (expr.roll || p.percentOfPrevious || p.percentOfDamageDealt || p.percentOfHealing) {
            conditional = true;
            continue;
          }
          packets.push(damagePacket(state, actor, target2, p, ctx, nodeAmount(state, actor, target2, p, ctx)));
        }
      }
      return { packets, conditional };
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
      if (name === "mp" || name === "sp") io.setResourceTotal(state, target2, name, after, actor.id, label);
      else if (name === "ap") target2.ap = after;
      else if (name === "action" || name === "attack") target2.used[name] = 1 - after;
      else if (pool?.effect) io.counter(state, target2, pool.item, pool.effect, name, after);
      else (target2.resources ??= {})[name] = after;
      return Math.abs(before - after);
    }
    function executeNodes(state, actor, source, nodes, inherited, ctx, entry, seen, depth, exprTarget = entry.expr.target, stopOnFailure = false) {
      let applied = false;
      for (const node3 of nodes) {
        if (actor.fled) break;
        if (node3.enabled === false) continue;
        const p = { ...entry.expr.params, ...node3 };
        const recipients = node3.target && node3.target !== exprTarget ? targets(state, actor, node3.target, ctx, p.radius ?? 1) : [inherited];
        for (const target2 of recipients) {
          if (target2?.fled) continue;
          if (!condition3(state, actor, subject2(actor, target2, ctx), p.condition, ctx, entry)) continue;
          const label = node3.label ?? entry.expr.label ?? entry.sourceName ?? entry.expr.id;
          const amount2 = nodeAmount(state, actor, target2, p, ctx);
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
            case "changeAltitude":
              if (livingUnit(actor)) result = io.changeAltitude(state, actor, p);
              break;
            case "modifyTerrain":
            case "setTerrainKind":
            case "addCover":
              result = io.terrain(state, actor, { ...node3, label }, ctx);
              break;
            case "raiseDead":
              result = io.raise(state, actor, target2, p.statScale ?? 0.5);
              break;
            case "spawnUnit":
              if (livingUnit(actor)) result = io.spawn(state, actor, p, ctx.center ?? target2 ?? actor);
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
                    const { type, raw, hit, ignoreArmor, preserveLife } = damagePacket(state, actor, target2, p, ctx, amount2);
                    result = io.damage(state, target2, actor.id, raw, type, label, {
                      attacker: actor,
                      hit,
                      melee: ctx.melee,
                      reaction: true,
                      direct: p.strikeBonus || !["on_damaged", "on_death", "on_ally_death", "on_turn_start", "on_turn_end"].includes(entry.expr.trigger),
                      committedRecipient: p.strikeBonus ? target2 : void 0,
                      preserveLife,
                      ignoreArmor,
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
                  if (amount2 > 0) result = io.grantShield(state, target2, amount2, { sourceUnitId: actor.id, turns: p.turns, stack: p.stack });
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
                  const modifiers3 = target2.effectModifiers ??= {};
                  const scale = levelScale(p.levelScaling, actor.tier ?? 1);
                  const modifier = {
                    stat: p.stat,
                    flat: (p.flat ?? 0) * scale,
                    percent: (p.percent ?? 0) * scale,
                    turns: p.duration ?? p.turns ?? 1,
                    ...p.damageType ? { damageType: p.damageType } : {},
                    round: state.round,
                    turn: state.turn
                  };
                  modifiers3[`${source.id}:${entry.key}:${p.stat}`] = modifier;
                  io.record(
                    state,
                    actor,
                    "stat_modifier",
                    `${target2.name}\u83B7\u5F97${label}\u7684\u5C5E\u6027\u4FEE\u6B63`,
                    { targetId: target2.id, ...modifier }
                  );
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
      const prepaid = ctx.castUses?.has(entry.key);
      if (depth > 8 || seen.has(entry.expr.id) || !prepaid && !available(state, actor, entry) || !sourceApplies(entry, ctx)) return false;
      const { expr, key: key4 } = entry;
      if (![...effectNodes(expr.effects, true)].some((node3) => node3.kind !== "chainEffect")) return false;
      const eligible = targets(state, actor, expr.target, ctx, expr.params?.radius ?? 1).filter((target2) => condition3(state, actor, subject2(actor, target2, ctx), expr.condition, ctx, entry));
      if (!eligible.length) return false;
      const roll = expr.roll;
      const label = expr.label ?? entry.sourceName ?? expr.id;
      const targetId = eligible.length === 1 && livingUnit(eligible[0]) ? eligible[0].id : null;
      if (roll?.dice) {
        const die = io.die(state, 20);
        const triggered = die >= roll.gte;
        io.record(state, actor, "proc", label, { targetId, die, dc: roll.gte, triggered });
        if (!triggered) return false;
      }
      if (roll?.chance != null && (!roll.save && !roll.contest || roll.chance < 1)) {
        const draw = io.random(state);
        const triggered = draw < roll.chance;
        io.record(state, actor, "proc", label, { targetId, roll: draw, chance: roll.chance, triggered });
        if (!triggered) return false;
      }
      seen.add(expr.id);
      let applied = false;
      for (const target2 of eligible) {
        if ((roll?.save || roll?.contest) && !livingUnit(target2)) continue;
        if ((roll?.save || roll?.contest) && io.saved(state, actor, target2, roll, label)) continue;
        applied = executeNodes(state, actor, actor, expr.effects, target2, { ...ctx }, entry, seen, depth) || applied;
      }
      seen.delete(expr.id);
      if (!prepaid && applied && (expr.params?.usesPerBattle != null || expr.params?.cooldown || expr.trigger === "on_equip" && expr.params?.usesPerBattle === void 0)) {
        spendUse(state, actor, entry);
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
        const equipment = expressions(state, actor).filter((entry) => !context.equippedItemId || entry.instance?.id === context.equippedItemId);
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
      const modifiers3 = values(actor.effectModifiers);
      if (!temporaryOnly) modifiers3.push(...passiveNodes(state, actor, ctx, ctx.entries).filter((n) => n.kind === "modifyStat"));
      let flat = 0, percent2 = 0;
      for (const m of modifiers3) if (m.stat === name && (!m.damageType || m.damageType === ctx.damageType)) {
        const scale = levelScale(m.levelScaling, actor.tier ?? 1);
        flat += (m.flat ?? 0) * scale;
        percent2 += (m.percent ?? 0) * scale;
      }
      return (base + flat) * Math.max(0, 1 + percent2);
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
    const check = (state, actor, key4, ctx = {}) => passiveNodes(state, actor, ctx, ctx.entries).reduce((sum, n) => sum + (n.kind === "modifyCheck" ? n[key4] ?? 0 : 0), 0);
    return { dispatch, stat: stat2, check, passiveNodes, damageFactor, previewEffects, activeSkills, skillExpressions: skillExpressions2, available, usageStatus, spendUse, condition: condition3, changeResource };
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
    const sign3 = edge(advantage, disadvantage);
    const result = rollDice(rng, sign3 ? 2 : 1, 20);
    const { rolls } = result;
    return {
      rng: result.rng,
      rolls,
      value: sign3 > 0 ? Math.max(...rolls) : sign3 < 0 ? Math.min(...rolls) : rolls[0],
      mode: sign3 > 0 ? "advantage" : sign3 < 0 ? "disadvantage" : "normal"
    };
  }
  function rollProtocolD20(rng, { bonus = 0, penalty = 0, tierAdvantage = 0 } = {}) {
    const b = Math.max(0, Math.min(2, bonus)), p = Math.max(0, Math.min(1, penalty));
    const sign3 = b > p ? 1 : p > b ? -1 : 0;
    const count = sign3 === 0 ? 1 : b === 2 && sign3 > 0 || tierAdvantage && sign3 < 0 ? 3 : 2;
    const result = rollDice(rng, count, 20);
    const sorted = [...result.rolls].sort((a, z) => a - z);
    const value = count === 3 ? sorted[1] : sign3 > 0 ? Math.max(...result.rolls) : sign3 < 0 ? Math.min(...result.rolls) : result.rolls[0];
    return { rng: result.rng, rolls: result.rolls, value, mode: count === 3 ? "middle" : sign3 > 0 ? "bonus" : sign3 < 0 ? "penalty" : "normal" };
  }
  function probability(successes, advantage, disadvantage) {
    const sign3 = edge(advantage, disadvantage);
    if (sign3 > 0) return (400 - (20 - successes) ** 2) / 400;
    if (sign3 < 0) return successes ** 2 / 400;
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
  function sizeClassFor(bodyLengthM) {
    return Math.min(5, 3 - sizeFor(bodyLengthM).value);
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
  function initiative({ agility = 0, percent: percent2 = 0, d20 = 0, attack = [], action = [], flat = 0 } = {}) {
    return agility * (1 + percent2) + d20 + Math.max(0, ...attack, 0) + Math.max(0, ...action, 0) + flat;
  }
  function bodySizeLabel(unit) {
    const meters2 = unit.bodyLengthM ?? 1.7;
    return `${sizeFor(meters2).name} (${meters2}m${unit.mc >= 2 ? ` \xB7 MC ${unit.mc}` : ""})`;
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
  var moraleTypes = Object.freeze({ \u6807\u51C6: "standard", \u5207\u78CB: "spar", \u7ADE\u6280: "arena", \u538B\u5236: "suppress", \u6B7B\u6597: "deathmatch", \u5B88\u536B: "guard" });
  var moraleTypeFor = (value) => Object.hasOwn(MORALE, value) ? value : Object.hasOwn(moraleTypes, value) ? moraleTypes[value] : null;
  var moraleLabels = Object.freeze({ steady: "\u575A\u5B88", shaken: "\u52A8\u6447", routed: "\u6E83\u9003" });
  var moraleModifiers = Object.freeze({ shaken: Object.freeze({ accuracy: -2 }), routed: Object.freeze({ accuracy: -4 }) });
  function moraleResult({ type = "standard", hp, maxHp, d20 } = {}) {
    const { threshold, check } = MORALE[type] ?? MORALE.standard;
    const triggered = maxHp > 0 && hp / maxHp < threshold;
    const roll = triggered && check ? d20 ?? null : null;
    return { threshold, check, triggered, roll, outcome: !triggered ? "steady" : !check ? "shaken" : roll !== null && roll < 12 ? "routed" : "steady" };
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
  var flags = ["taunted", "intercept", "skip", "rooted", "hidden", "infiniteAmmo", "guaranteed_hit", "guaranteed_crit", "blockResourceRestore", "preserveLife"];
  function rangeFor(key4, template) {
    if (key4 === "armor") {
      const base = template?.modifiers.armor;
      if (base == null) return [-1e5, 1e5];
      if (base < 0) return [-1e5, -1];
      if (base === 0) return [0, 1e5];
    }
    return Object.hasOwn(ranges, key4) ? ranges[key4] : void 0;
  }
  function statusModifierRange(key4, template) {
    const range = rangeFor(key4, template);
    if (range) return range.join("\u2013");
    if (key4 === "damageType") return damageTypes.join("/");
    if (flags.includes(key4)) return "true/false";
    throw new Error(`\u672A\u77E5\u72B6\u6001\u53C2\u6570\uFF1A${key4}`);
  }
  var modifierKeys = Object.freeze([...Object.keys(ranges), "damageType", ...flags]);
  function validateStatusModifiers(template, modifiers3) {
    if (!modifiers3 || Object.getPrototypeOf(modifiers3) !== Object.prototype) throw new Error("modifiers \u5FC5\u987B\u4E3A\u5BF9\u8C61");
    for (const [key4, value] of Object.entries(modifiers3)) {
      if (!Object.hasOwn(template.modifiers, key4)) throw new Error(`${template.id} \u4E0D\u5141\u8BB8\u8986\u76D6\u72B6\u6001\u53C2\u6570 ${key4}`);
      const range = rangeFor(key4, template);
      const valid = range ? (ratios.includes(key4) ? Number.isFinite(value) : Number.isInteger(value)) && value >= range[0] && value <= range[1] : key4 === "damageType" ? damageTypes.includes(value) : flags.includes(key4) && typeof value === "boolean";
      if (!valid) throw new Error(`\u65E0\u6548\u72B6\u6001\u53C2\u6570 ${template.id}.${key4}\uFF0C\u5408\u6CD5\u8303\u56F4\uFF1A${statusModifierRange(key4, template)}`);
    }
  }

  // src/core/terrain-effects.js
  var unitsAt = (state, x, y) => Object.values(state.units).filter((u) => u.x === x && u.y === y);
  var present = (unit) => unit && unit.hp > 0 && !unit.fled;
  var same2 = (a, b) => a.x === b.x && a.y === b.y;
  var occupiedByUnit = (state, point2) => unitsAt(state, point2.x, point2.y).some((unit) => unit.hp > 0);
  var blocked = (state, point2) => occupiedByUnit(state, point2) || [...Object.values(state.covers), ...Object.values(state.interactives)].some((other) => same2(other, point2));
  var maxPatches = 64;
  function cellsIn(state, area2, center) {
    const { rect } = area2;
    const points = area2.cells ?? state.grid.flatMap((row, y) => row.flatMap((_, x) => {
      const inside = rect ? x >= Math.min(rect.x1, rect.x2) && x <= Math.max(rect.x1, rect.x2) && y >= Math.min(rect.y1, rect.y2) && y <= Math.max(rect.y1, rect.y2) : center && Math.hypot(x - center.x, y - center.y) <= area2.radius;
      return inside ? [{ x, y }] : [];
    }));
    return [...new Map(points.filter((p) => cellAt(state, p.x, p.y)).map((p) => [`${p.x},${p.y}`, p])).values()];
  }
  function changeCell(cell, node3) {
    if (node3.kind === "setTerrainKind") return { ...cell, kind: node3.terrainKind };
    const z = node3.terrain === "set" ? node3.amount : cell.z + (node3.terrain === "raise" ? node3.amount : -node3.amount);
    return { ...cell, z: Math.min(8, Math.max(-4, z)) };
  }
  var effectiveHeight = (cell) => cell.kind === "slope" ? 1 : cell.z;
  function writeCell(state, { x, y }, after, changes2, restored = false) {
    const before = state.grid[y][x];
    state.grid[y][x] = after;
    changes2.push({ x, y, before, after, restored, units: unitsAt(state, x, y) });
  }
  function settleChanges(state, changes2, record2, damage) {
    for (const change of changes2) {
      const { x, y } = change;
      const cell = state.grid[y][x];
      if (cell.kind !== "wall") continue;
      for (const table4 of [state.covers, state.interactives]) {
        for (const [id3, item] of Object.entries(table4)) if (same2(item, change)) delete table4[id3];
      }
      for (const unit of unitsAt(state, x, y).filter((unit2) => unit2.hp > 0)) {
        const free = state.grid.flatMap((row, y2) => row.flatMap((tile, x2) => tile.kind !== "wall" && !unitAt(state, x2, y2) && !coverAt(state, x2, y2) ? [{ x: x2, y: y2 }] : []));
        const distance = (p) => (p.x - x) ** 2 + (p.y - y) ** 2;
        const landing = free.sort((a, b) => distance(a) - distance(b))[0];
        if (landing) {
          const from = { x: unit.x, y: unit.y, z: change.before.z + (unit.altitude ?? 0) };
          Object.assign(unit, landing);
          const to = { ...landing, z: elevation(state, unit) };
          record2(state, unit, "terrain_displace", `${unit.name}\u56E0\u5899\u4F53\u8FD8\u539F\u79FB\u81F3 (${to.x}, ${to.y}, z=${to.z})`, { x: to.x, y: to.y, from, to });
        } else damage(state, unit, unit.hp, "\u5899\u4F53\u8FD8\u539F\uFF0C\u65E0\u53EF\u7AD9\u7ACB\u683C", { forcedDisplacement: true });
      }
    }
    for (const { before, after, restored, units } of changes2) {
      const drop = effectiveHeight(before) - effectiveHeight(after);
      for (const unit of units.filter(present)) {
        if (drop > 0 && !unit.altitude) damage(state, unit, drop * 50, `\u5730\u5F62${restored ? "\u8FD8\u539F" : "\u53D8\u5316"}\u9AD8\u5EA6\u843D\u5DEE ${drop}\uFF0C`, { drop });
      }
    }
  }
  function applyTerrainEffect(state, actor, node3, context, record2, damage) {
    const area2 = node3.area;
    const center = area2.center === "self" ? actor : area2.center === "hitTarget" ? context.terrainTarget ?? context.target ?? context.center : area2.center;
    const name = node3.label ?? node3.kind;
    const unresolved = (reason) => {
      record2(state, actor, "terrain_unresolved", `\u5730\u5F62\u6548\u679C\u672A\u751F\u6548\uFF1A${reason}`, { unresolved: true, name });
      return false;
    };
    if (area2.follow && !present(center)) return unresolved("\u533A\u57DF\u6CA1\u6709\u5B58\u6D3B\u7684\u951A\u70B9\u5355\u4F4D");
    if (Object.keys(state.terrainPatches ?? {}).length >= maxPatches) return unresolved("\u5730\u5F62\u6548\u679C\u6570\u91CF\u8FBE\u5230\u4E0A\u9650");
    let n = 1;
    while (Object.hasOwn(state.terrainPatches ?? {}, `terrain-${n}`) || Object.keys(state.covers).some((id3) => id3.startsWith(`terrain-${n}-`))) n++;
    const entry = {
      id: `terrain-${n}`,
      name,
      node: node3,
      ...area2.follow ? { anchorUnitId: center.id, center: { x: center.x, y: center.y } } : {},
      remainingTurns: node3.remainingTurns ?? 1,
      persistent: node3.persistent === true,
      patch: [],
      covers: []
    };
    const points = cellsIn(state, area2, center);
    const changes2 = [];
    const count = place(state, entry, points, record2, actor, changes2);
    if (!count) {
      const occupied = points.length && points.every((p) => occupiedByUnit(state, p));
      return unresolved(occupied ? "\u76EE\u6807\u533A\u57DF\u5168\u90E8\u88AB\u5355\u4F4D\u5360\u7528" : "\u76EE\u6807\u533A\u57DF\u6CA1\u6709\u53EF\u7528\u683C\u5B50");
    }
    (state.terrainPatches ??= {})[entry.id] = entry;
    record2(state, actor, "terrain", `${name}\u5F71\u54CD\u4E86 ${count} \u683C`, { terrainId: entry.id, count });
    settleChanges(state, changes2, record2, damage);
    return true;
  }
  function place(state, entry, points, record2, actor, changes2) {
    const { node: node3 } = entry;
    let occupied = 0;
    for (const { x, y } of points) {
      const cell = cellAt(state, x, y);
      const point2 = { x, y };
      if (node3.terrainKind === "wall" || node3.kind === "addCover") {
        if (occupiedByUnit(state, point2)) occupied++;
        if (blocked(state, point2) || node3.kind === "addCover" && (cell.kind === "wall" || Object.keys(state.covers).length >= 200)) continue;
      }
      if (node3.kind === "addCover") {
        const id3 = `${entry.id}-${x}-${y}`;
        state.covers[id3] = { id: id3, name: entry.name, x, y, material: "\u5730\u5F62\u6548\u679C", hp: node3.hp, maxHp: node3.hp, cover: 2 };
        entry.covers.push({ id: id3, x, y, before: null });
      } else {
        const after = changeCell(cell, node3);
        entry.patch.push({ x, y, before: { ...cell }, after });
        writeCell(state, point2, after, changes2);
      }
    }
    if (occupied) record2(state, actor, "terrain_skip", `${occupied} \u683C\u56E0\u5355\u4F4D\u5360\u7528\u88AB\u8DF3\u8FC7`, { count: occupied });
    return entry.patch.length + entry.covers.length;
  }
  function remove(state, entry, entries2, changes2) {
    for (const { id: id3 } of entry.covers) delete state.covers[id3];
    for (const patch of entry.patch) {
      let cell = patch.before;
      const replay = [];
      for (const other of entries2.slice(entries2.indexOf(entry) + 1)) {
        const layer = other.patch.find((p) => same2(p, patch));
        if (!layer) continue;
        const after = changeCell(cell, other.node);
        replay.push({ layer, before: cell, after });
        cell = after;
      }
      for (const { layer, before, after } of replay) Object.assign(layer, { before, after });
      writeCell(state, patch, cell, changes2, true);
    }
    entry.patch = [];
    entry.covers = [];
  }
  function updateTerrainPatches(state, record2, damage, advance2 = false) {
    const entries2 = Object.values(state.terrainPatches ?? {});
    const moved = [], changes2 = [], movingChanges = [];
    for (const entry of entries2.slice().reverse()) {
      const anchor2 = state.units[entry.anchorUnitId];
      const lost = entry.anchorUnitId && !present(anchor2);
      if (advance2 && !entry.persistent && entry.remainingTurns > 0) entry.remainingTurns--;
      if (lost || !entry.persistent && entry.remainingTurns === 0) {
        entry.remainingTurns = 0;
        entry.persistent = false;
        remove(state, entry, entries2, changes2);
        delete state.terrainPatches[entry.id];
        record2(state, anchor2, "terrain_expire", `${entry.name}${lost ? "\u56E0\u951A\u70B9\u79BB\u573A\u800C\u6D88\u6563" : "\u5230\u671F\u8FD8\u539F"}`, { terrainId: entry.id });
      } else if (advance2 && anchor2 && !same2(anchor2, entry.center)) {
        remove(state, entry, entries2, movingChanges);
        entry.center = { x: anchor2.x, y: anchor2.y };
        moved.unshift(entry);
      }
    }
    for (const entry of moved) {
      delete state.terrainPatches[entry.id];
      state.terrainPatches[entry.id] = entry;
      place(state, entry, cellsIn(state, entry.node.area, entry.center), record2, state.units[entry.anchorUnitId], movingChanges);
    }
    const movedCells = /* @__PURE__ */ new Map();
    for (const change of movingChanges) {
      const key4 = `${change.x},${change.y}`;
      const first = movedCells.get(key4);
      if (first) first.after = change.after;
      else movedCells.set(key4, change);
    }
    settleChanges(state, [...changes2, ...movedCells.values()], record2, damage);
  }

  // src/core/prebattle_resources.js
  var hpTier = [1, 2, 4, 10, 20, 40, 100];
  var manaTier = [1, 2.5, 6, 15, 35, 80, 160];
  var attributes = ["str", "agi", "con", "int", "spi"];
  var finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  var integer2 = (n, min, max) => Number.isSafeInteger(n) && finite(n, min, max);
  var fail = (field) => {
    throw new Error(`\u6218\u524D\u8D44\u6E90\u63A8\u6F14\uFF1A${field}\u65E0\u6548`);
  };
  function calculatePrebattleResources(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("\u8F93\u5165");
    const { stats: stats2, tier, bodyLengthM = null, count = 1, summonCount = 1, previous = {} } = input;
    if (!stats2 || !attributes.every((k) => integer2(stats2[k], 0, 1e6))) fail("\u4E94\u7EF4");
    if (!integer2(tier, 1, 7)) fail("\u5C42\u7EA7");
    if (bodyLengthM !== null && !finite(bodyLengthM, Number.MIN_VALUE, 1e9)) fail("\u4F53\u957F");
    if (!integer2(count, 1, 1e6) || !integer2(summonCount, 1, 1e6)) fail("\u96C6\u7FA4\u6570\u91CF\u6216\u53EC\u5524\u521D\u59CB\u603B\u6570");
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) fail("\u65E7\u8D44\u6E90");
    const { str, agi, con, int: int2, spi } = stats2;
    const statSum = str + agi + con + int2 + spi;
    const mc = bodyLengthM >= 10 ? 2 + Math.floor(Math.log2(bodyLengthM / 10)) : 1;
    const baseMultipliers = { hp: hpTier[tier - 1], mp: manaTier[tier - 1], sp: manaTier[tier - 1] };
    const hp = baseMultipliers.hp * mc / summonCount, mp = baseMultipliers.mp / summonCount;
    const raw = { hp: (con * 100 * hp + statSum) * count, mp: (int2 + spi) * 50 * mp * count, sp: (str + agi) * 50 * mp * count };
    const resources = {};
    for (const [key4, value] of Object.entries(raw)) {
      const old = previous[key4];
      if (Object.hasOwn(previous, key4) && (!old || !finite(old.max, 0, Number.MAX_SAFE_INTEGER) || !finite(old.current, 0, old.max))) fail(`\u65E7 ${key4.toUpperCase()} `);
      const ratio4 = old ? old.max ? old.current / old.max : 0 : 1;
      resources[key4] = { rawMax: value, max: Math.round(value), current: Math.round(value * ratio4), ratio: ratio4 };
    }
    return { tier, statSum, mc, count, summonCount, baseMultipliers, multipliers: { hp, mp, sp: mp }, resources };
  }
  function protocolDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + Math.ceil(Math.abs(a.z - b.z) / 2);
  }

  // src/core/spawn-unit.js
  var attrs = ["str", "agi", "con", "int", "spi"];
  var tierCaps = [8, 10, 12, 14, 16, 18, 20];
  function budget(actor, spec) {
    const tier = Math.min(actor.tier ?? 1, spec.tier ?? 7);
    const a = spec.attribute ? actor.stats[spec.attribute] : Math.max(actor.stats.int, actor.stats.spi);
    return { tier, sum: Math.max(tier * 5, a * 5 - 30), cap: Math.min(a, tierCaps[tier - 1]) };
  }
  function spawnStatsAllowed(actor, spec) {
    const { cap, sum } = budget(actor, spec);
    return !spec.stats || attrs.every((k) => spec.stats[k] >= 0 && spec.stats[k] <= cap) && attrs.reduce((n, k) => n + spec.stats[k], 0) <= sum;
  }
  function spawnPanel(actor, spec) {
    const { tier, cap, sum } = budget(actor, spec);
    const total = Math.min(sum, 5 * cap);
    if (total < 0 || !spawnStatsAllowed(actor, spec)) return null;
    const stats2 = spec.stats ? { ...spec.stats } : Object.fromEntries(attrs.map((k, i) => [k, Math.floor(total / 5) + Number(i < total % 5)]));
    const bodyLengthM = spec.bodyLengthM ?? 1.7;
    const { resources, mc } = calculatePrebattleResources({ stats: stats2, tier, bodyLengthM, summonCount: spec.count ?? 1 });
    return {
      stats: stats2,
      tier,
      bodyLengthM,
      mc: spec.mc ?? mc,
      size: spec.size ?? sizeClassFor(bodyLengthM),
      armor: spec.armor ?? 0,
      move: spec.move ?? 3,
      maxHp: spec.maxHp ?? resources.hp.max,
      maxMp: spec.maxMp ?? resources.mp.max,
      maxSp: spec.maxSp ?? resources.sp.max
    };
  }

  // src/presets/status-defaults.js
  var actionStatuses = Object.freeze({
    brace: "guarded",
    block: "guarded",
    charge: "charge",
    lock_on: "lock_on",
    scan: "weakness",
    grapple: "grappled",
    trip: "prone",
    use_item: "haste",
    altar: "haste",
    shield: "shield",
    collision: "stun",
    shield_bash: "stun"
  });
  var def = (name, icon, category, remainingTurns, description, modifiers3 = {}, options = {}) => Object.freeze({
    name,
    icon,
    category,
    description,
    remainingTurns,
    durationType: "battle_turns",
    tickTiming: "onTurnStart",
    stackRule: "refresh",
    maxStacks: 1,
    modifiers: Object.freeze(modifiers3),
    ...options
  });
  var STATUSES = Object.freeze(Object.fromEntries(Object.entries({
    suppressed: def("\u88AB\u538B\u5236", "\u26D3\uFE0F", "control", 1, "\u65E0\u6CD5\u884C\u52A8\uFF0C\u81EA\u5DF1\u7684\u56DE\u5408\u5F00\u59CB\u65F6\u5C1D\u8BD5\u6323\u8131\u3002", { skip: true }, { durationType: "until_removed" }),
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
    freeze: def("\u51B0\u51BB", "\u{1F9CA}", "control", 1, "\u8DF3\u8FC7\u884C\u52A8\uFF1B\u88AB\u6253\u51FB\u65F6\u788E\u51B0\uFF0C\u53D7\u5230\u989D\u5916\u4F24\u5BB3\u3002", { skip: true, shatter: 0.5 }, { expireOn: Object.freeze({ trigger: "on_struck" }) }),
    root: def("\u5B9A\u8EAB", "\u26D3\uFE0F", "control", 2, "\u65E0\u6CD5\u79FB\u52A8\u6216\u77AC\u79FB\uFF0C\u4ECD\u53EF\u653B\u51FB\u6216\u65BD\u6CD5\u3002", { rooted: true }),
    blind: def("\u81F4\u76F2", "\u{1F311}", "debuff", 2, "\u547D\u4E2D\u68C0\u5B9A\u5E26\u52A3\u52BF\u3002", { disadvantage: 1 }),
    vulnerable: def("\u6613\u4F24", "\u{1F4A2}", "debuff", 2, "\u53D7\u5230\u7684\u4F24\u5BB3\u589E\u52A0 35%\u3002", { vulnerability: 0.35 }),
    sunder: def("\u7834\u7532", "\u{1F528}", "debuff", 2, "\u62A4\u7532\u964D\u4F4E 4 \u70B9\u3002", { armor: -4 }),
    mark: def("\u6807\u8BB0", "\u{1F3AF}", "debuff", 2, "\u653B\u51FB\u6B64\u5355\u4F4D\u7684\u547D\u4E2D\u52A0 2\u3002", { incomingAccuracy: 2 }),
    stealth: def("\u9690\u8EAB", "\u{1F464}", "buff", 2, "\u65E0\u6CD5\u88AB\u654C\u65B9\u8FDC\u8DDD\u76F4\u63A5\u9501\u5B9A\uFF1B\u53D1\u52A8\u8FDB\u653B\u6216\u906D\u653B\u51FB\u4F24\u5BB3\u65F6\u73B0\u5F62\u3002", { hidden: true, advantage: 1 }, { expireOn: Object.freeze([Object.freeze({ trigger: "on_attack" }), Object.freeze({ trigger: "on_struck" })]) }),
    haste: def("\u75BE\u8D70", "\u{1F4A8}", "buff", 2, "\u79FB\u52A8\u8DDD\u79BB\u589E\u52A0 1\u3002", { movement: 1 }),
    chill: def("\u5BD2\u51B7", "\u2744\uFE0F", "debuff", 2, "\u79FB\u52A8\u8DDD\u79BB\u548C\u547D\u4E2D\u964D\u4F4E\u3002", { movement: -1, accuracy: -2 }),
    charge: def("\u84C4\u529B", "\u26A1", "buff", 1, "\u672C\u56DE\u5408\u4E0B\u4E00\u6B21\u653B\u51FB\u589E\u4F24\u3002", { damageBonus: 0.15 }),
    lock_on: def("\u5B9A\u4F4D", "\u2316", "buff", 1, "\u672C\u56DE\u5408\u5BF9\u9501\u5B9A\u76EE\u6807\u547D\u4E2D\u63D0\u9AD8\u3002", { accuracy: 1 }),
    weakness: def("\u5F31\u70B9\u8BC6\u522B", "\u25C9", "buff", 3, "\u6BCF\u5C42\u4F7F\u610F\u56FE\u96BE\u5EA6\u964D\u4F4E 2\u3002", { intentDifficulty: -2 }, { stackRule: "stack", maxStacks: 3 }),
    grappled: def("\u64D2\u62B1", "\u26D3", "control", 1, "\u65E0\u6CD5\u79FB\u52A8\uFF0C\u4ECD\u53EF\u8FDB\u884C\u8FD1\u8EAB\u653B\u51FB\u3002", { rooted: true }),
    prone: def("\u5012\u5730", "\u25BD", "debuff", 1, "\u65E0\u6CD5\u79FB\u52A8\uFF0C\u95EA\u907F\u964D\u4F4E\u3002", { incomingAccuracy: 2, rooted: true }),
    infinite_ammo: def("\u65E0\u9650\u5F39\u836F", "\u{1F3F9}", "buff", 1, "\u8FDC\u7A0B\u5C04\u51FB\u65E0\u9700\u88C5\u586B\uFF0C\u4E5F\u4E0D\u6D88\u8017\u5F39\u836F\u3002", { infiniteAmmo: true })
  }).map(([id3, status2]) => [id3, Object.freeze({ id: id3, ...status2 })])));

  // src/core/combat.js
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
  var pointAt = (state, at) => ({ x: at.x, y: at.y, z: elevation(state, at) });
  function changeAltitude(state, actor, node3) {
    const from = pointAt(state, actor);
    const altitude = node3.land ? 0 : Math.max(0, Math.min(12, (actor.altitude ?? 0) + (node3.delta ?? 3)));
    if (altitude === (actor.altitude ?? 0)) return false;
    actor.altitude = altitude;
    const to = pointAt(state, actor);
    record(state, actor, "altitude", `${actor.name}\u9AD8\u5EA6\u4ECE z=${from.z} \u53D8\u4E3A z=${to.z}`, { from, to });
    return true;
  }
  var key2 = (x, y) => `${x},${y}`;
  var stat = (unit, id3) => Number(unit.stats?.[id3] ?? 0) * Math.max(0, 1 + changes(unit, "attributePercent"));
  var clamp = (number3, min, max) => Math.max(min, Math.min(max, number3));
  var statusModifier = (unit, name) => values2(unit.statuses).reduce((sum, s) => sum + Number(s.modifiers?.[name] ?? 0) * (s.stacks ?? 1), moraleModifiers[unit.moraleState]?.[name] ?? 0);
  var changes = statusModifier;
  var statusOf = (unit, id3) => Object.hasOwn(unit.statuses ?? {}, id3) ? unit.statuses[id3] : void 0;
  var currentUnit = (state) => Object.hasOwn(state.units, state.order[state.turn]) ? state.units[state.order[state.turn]] : void 0;
  function record(state, unit, type, text4, detail = {}) {
    const actor = typeof unit === "string" ? unit : unit?.id ?? null;
    const positions = Object.fromEntries(values2(state.units).map((current) => [current.id, pointAt(state, current)]));
    const event = { round: state.round, actor, text: text4, type, detail, positions };
    state.logs.push(event);
    return event;
  }
  function tableEntry(table4, id3) {
    return Object.hasOwn(table4 ?? {}, id3) ? table4[id3] : void 0;
  }
  function getStatusTemplate(state, statusId2) {
    if (typeof statusId2 !== "string") return void 0;
    return tableEntry(state?.statusTemplates, statusId2) ?? tableEntry(STATUSES, statusId2);
  }
  function equipmentFor(state, instanceId) {
    const instance = tableEntry(state.items, instanceId);
    const template = tableEntry(state.equipment, instance?.templateId);
    return { instance, template, effects: template?.effects ?? [] };
  }
  var isWeapon = (template) => template?.kind === "weapon" || Boolean(template?.damage && !template.kind);
  var gearFor = (state, unit) => (unit.gear ?? []).map((id3) => equipmentFor(state, id3)).filter(({ template }) => !isWeapon(template) && template?.kind !== "shield");
  function switchableWeapons(state, unit) {
    const main = unit.mainHand ?? unit.weapon;
    const bag = unit.bagWeapons ?? [];
    return [.../* @__PURE__ */ new Set([...isWeapon(equipmentFor(state, main).template) ? [unit.offHand, ...unit.gear ?? []] : [], ...bag])].filter((id3) => {
      if (!id3 || id3 === main) return false;
      const { template } = equipmentFor(state, id3);
      return isWeapon(template) && (!template.boundTo || template.boundTo === unit.id) && !(template.twoHanded && (unit.offHand || unit.shield));
    });
  }
  var equipped = (state, unit) => [...new Set([unit.mainHand ?? unit.weapon, unit.offHand, unit.shield, ...gearFor(state, unit).map((g) => g.instance?.id)].filter(Boolean))].map((id3) => equipmentFor(state, id3)).filter(({ template }) => !template?.boundTo || template.boundTo === unit.id);
  var effectiveStat = (state, unit, key4) => dsl.stat(state, unit, key4, stat(unit, key4));
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
  var shieldTotal = (unit) => values2(unit.statuses).reduce((total, status2) => total + (status2.amount ?? 0), 0);
  function statusModifierKeys(statusId2, state) {
    return Object.keys(getStatusTemplate(state, statusId2)?.modifiers ?? {});
  }
  function patchStatus(state, unitId, statusId2, patch) {
    const unit = tableEntry(state.units, unitId);
    const status2 = unit && statusOf(unit, statusId2);
    const template = getStatusTemplate(state, statusId2);
    if (!status2 || !template) throw new Error(`\u627E\u4E0D\u5230\u72B6\u6001\u5B9E\u4F8B\uFF1A${unitId}/${statusId2}`);
    if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || !Object.keys(patch).length) throw new Error("\u72B6\u6001\u53C2\u6570\u8865\u4E01\u987B\u4E3A\u975E\u7A7A\u5BF9\u8C61");
    const { expireOn: expireOn2, ...modifiers3 } = patch;
    const patchExpiry = Object.hasOwn(patch, "expireOn");
    validateStatusModifiers(template, modifiers3);
    if (patchExpiry && expireOn2 !== null && !validExpireOn(expireOn2)) throw new Error("\u65E0\u6548\u5B57\u6BB5\uFF1AexpireOn");
    status2.modifiers = { ...status2.modifiers, ...modifiers3 };
    if (patchExpiry) status2.expireOn = structuredClone(expireOn2);
    if (Object.hasOwn(modifiers3, "amount")) status2.amount = clamp(modifiers3.amount, 1, 1e5);
    record(
      state,
      unit,
      "status_patch",
      `${unit.name}\u7684${status2.name}\u53C2\u6570\u5DF2\u66F4\u65B0`,
      {
        ...statusLogDetail(unit, status2),
        effectiveModifiers: { ...status2.modifiers },
        modifiers: modifiers3,
        ...patchExpiry ? { expireOn: status2.expireOn } : {}
      }
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
    if (Object.hasOwn(applied.modifiers, "amount")) applied.amount = options.amount == null ? applied.modifiers.amount : clamp(options.amount, 1, 1e4);
    unit.statuses[statusId2] = applied;
    record(
      state,
      applied.sourceUnitId ?? unit.id,
      "status",
      `${unit.name}\u83B7\u5F97${template.name} \xD7${stacks}`,
      statusLogDetail(unit, applied)
    );
    return applied;
  }
  function statusLogDetail(unit, status2) {
    const { id: statusId2, stacks, remainingTurns, durationType, tickTiming, modifiers: modifiers3, amount: amount2, expireOn: expireOn2 } = status2;
    return {
      targetId: unit.id,
      statusId: statusId2,
      stacks,
      remainingTurns,
      durationType,
      tickTiming,
      modifiers: { ...modifiers3 },
      ...amount2 == null ? {} : { amount: amount2 },
      ...expireOn2 ? { expireOn: structuredClone(expireOn2) } : {}
    };
  }
  function grantShield(state, unit, amount2, { stack, ...options } = {}) {
    const statusId2 = actionStatuses.shield;
    const previous = stack ? statusOf(unit, statusId2)?.amount ?? 0 : 0;
    return grantStatus(state, unit, statusId2, { ...options, amount: amount2 + previous });
  }
  function concludeObjective(state, outcome, reason) {
    state.battleConclusion = reason;
    state.outcome = outcome;
    record(state, null, "outcome", `\u6218\u6597\u7ED3\u675F\uFF1A${reason}\uFF08${outcome === "draw" ? "\u5E73\u5C40" : outcome === "blue" ? "\u84DD\u65B9\u83B7\u80DC" : "\u7EA2\u65B9\u83B7\u80DC"}\uFF09`, { outcome, reason });
    return outcome;
  }
  function encounterNonlethal(state, source) {
    return state.battleType === "spar" || state.battleType === "arena";
  }
  function retireFromContest(state, unit, source) {
    if (unit.fled || unit.hp <= 0) return false;
    const label = state.battleType === "spar" && unit.hp * 10 < unit.maxHp * 3 ? "\u751F\u547D\u4F4E\u4E8E 30%\uFF0C\u5207\u78CB\u9000\u573A" : state.battleType === "arena" && unit.hp === 1 ? "\u7ADE\u6280\u843D\u8D25\u51FA\u5C40" : null;
    if (!label) return false;
    unit.fled = true;
    unit.ap = 0;
    record(state, unit, "yield", `${unit.name}${label}\uFF08HP ${unit.hp}/${unit.maxHp}\uFF09`, { targetId: unit.id, hp: unit.hp, maxHp: unit.maxHp });
    return true;
  }
  function refreshOutcome(state) {
    if (state.battleConclusion) return state.outcome;
    if (["spar", "arena"].includes(state.battleType)) for (const unit of living(state)) retireFromContest(state, unit);
    updateTerrainPatches(state, record, terrainDamage);
    let blue = false, red = false;
    for (const unit of values2(state.units)) if (alive(unit) && !unit.fled) {
      blue ||= unit.team === "blue";
      red ||= unit.team === "red";
    }
    if (state.battleType === "suppress") {
      const side2 = state.suppressingTeam, label = side2 === "blue" ? "\u84DD\u65B9" : "\u7EA2\u65B9";
      const defenders = values2(state.units).filter((u) => u.team !== side2);
      const present2 = defenders.filter((u) => alive(u) && !u.fled);
      const dead = defenders.filter((u) => !alive(u));
      if (!present2.length && defenders.length) return concludeObjective(
        state,
        side2 === "blue" ? "red" : "blue",
        dead.length === defenders.length ? `${label}\u8FC7\u5931\u81F4\u6B7B\uFF0C\u538B\u5236\u5931\u8D25` : `${label}\u672A\u80FD\u7559\u4F4F\u76EE\u6807\uFF0C\u538B\u5236\u5931\u8D25`
      );
      if ((side2 === "blue" ? blue : red) && present2.length && present2.every((u) => u.statuses.suppressed?.holdTotal != null))
        return concludeObjective(state, side2, `${label}\u538B\u5236\u6210\u529F${dead.length ? "\uFF0C\u8FC7\u5931\u81F4\u6B7B\uFF1A" + dead.map((u) => u.name).join("\u3001") : ""}`);
    }
    if (blue && red && state.battleType === "guard" && state.round > 5) return concludeObjective(state, "blue", "\u5B88\u65B9\u575A\u5B88\u4E94\u8F6E");
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
    on_struck: "\u53D7\u5230\u547D\u4E2D",
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
      const expiry = Object.hasOwn(status2, "expireOn") ? status2.expireOn : getStatusTemplate(state, status2.id)?.expireOn;
      if (!expiry) continue;
      const rule = [].concat(expiry).find((rule2) => rule2.trigger === trigger && (rule2.damageType == null || rule2.damageType === "any" || rule2.damageType === (direct ? "direct" : "indirect")) && (rule2.exceptSource !== "self" || sourceUnitId !== unit.id));
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
    if (!alive(target2) || target2.fled && !effectContext.forcedDisplacement) return 0;
    const hpBefore = target2.hp;
    const source = tableEntry(state.units, sourceUnitId);
    const preserveLife = encounterNonlethal(state, source) || !effectContext.forcedDisplacement && (effectContext.preserveLife || target2.nonLethal || changes(target2, "preserveLife"));
    target2.hp = Math.max(preserveLife ? 1 : 0, hpBefore - Math.max(0, Math.floor(raw)));
    const amount2 = hpBefore - target2.hp;
    record(
      state,
      sourceUnitId,
      "damage",
      `${effectContext.damagePrefix ?? ""}${target2.name}\u53D7\u5230${amount2}\u70B9${label}\u4F24\u5BB3`,
      { ...detail, targetId: target2.id, damageType: type, amount: amount2, hpBefore, hpAfter: target2.hp }
    );
    if (retireFromContest(state, target2, source)) return amount2;
    if (amount2 > 0) expireStatuses(state, target2, "on_damaged", { sourceUnitId, direct: effectContext.direct });
    if (!alive(target2)) {
      const allies = living(state).filter((unit) => unit.team === target2.team);
      target2.diedAt = { round: state.round, turn: state.turn };
      target2.corpseOf ??= target2.id;
      record(state, sourceUnitId, "defeat", `${target2.name}\u5012\u4E0B`, { targetId: target2.id });
      updateTerrainPatches(state, record, terrainDamage);
      triggerDeathrattle(state, target2, sourceUnitId);
      dispatchEffect(state, target2, "on_death", { target: source, attacker: source, killed: target2, dealt: amount2, damageType: type, weaponId: detail.weaponId, sourceUnitId });
      for (const ally of allies) if (alive(ally)) dispatchEffect(state, ally, "on_ally_death", { target: target2, killed: target2, attacker: source, sourceUnitId: target2.id });
      if (source && source.team !== target2.team) dispatchEffect(state, source, "on_kill", { target: target2, killed: target2, dealt: amount2, damageType: type, weaponId: detail.weaponId });
    } else if (amount2 > 0 && triggerDamage) {
      dsl.dispatch(state, target2, "on_damaged", { target: source, attacker: source, dealt: amount2, damageType: type, ...effectContext });
    }
    return amount2;
  }
  function terrainDamage(state, target2, raw, prefix, detail) {
    const { forcedDisplacement } = detail;
    return loseHP(
      state,
      target2,
      raw,
      null,
      "true",
      forcedDisplacement ? "\u574D\u584C" : "\u5760\u843D",
      { ...detail, raw },
      true,
      { direct: false, forcedDisplacement, damagePrefix: prefix }
    );
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
      if (unit.protagonist || unit.moraleCheckedRound === state.round) continue;
      const type = unit.moraleType ?? "standard", rule = MORALE[type];
      const low = unit.hp / unit.maxHp < rule.threshold;
      const impaired = ["shaken", "routed"].includes(unit.moraleState);
      if (low === impaired) continue;
      const result = moraleResult({ type, hp: unit.hp, maxHp: unit.maxHp, d20: low && rule.check ? randomDie(state, 20) : void 0 });
      unit.moraleCheckedRound = state.round;
      unit.moraleState = result.outcome;
      record(state, unit, "morale", `${unit.name}${low ? "\u6218\u610F\uFF1A" + moraleLabels[result.outcome] : "\u91CD\u632F\u6218\u610F"}`, { targetId: unit.id, ...result, recovered: !low });
    }
  }
  function restoreHP(state, target2, raw, sourceUnitId, label, detail = {}) {
    if (!alive(target2) || target2.fled) return 0;
    const healer = tableEntry(state.units, sourceUnitId);
    const healing = Math.max(0, Math.floor(healer ? dsl.stat(state, healer, "healing", raw, { target: target2, ...detail }) : raw));
    const hpBefore = target2.hp;
    const amount2 = Math.min(healing, target2.maxHp - hpBefore);
    target2.hp += amount2;
    record(
      state,
      sourceUnitId,
      "heal",
      `${target2.name}\u56E0${label}\u6062\u590D${amount2}\u70B9\u751F\u547D`,
      { ...detail, targetId: target2.id, amount: amount2, hpBefore, hpAfter: target2.hp }
    );
    if (amount2 > 0) expireStatuses(state, target2, "on_heal", { sourceUnitId });
    if (healer && healing) dsl.dispatch(state, healer, "on_heal", { target: target2, healing, actionType: detail.actionType });
    return amount2;
  }
  function setResourceTotal(state, target2, resource3, after, sourceUnitId, label) {
    const before = target2[resource3];
    if (before === after) return;
    target2[resource3] = after;
    const amount2 = Math.abs(after - before);
    record(
      state,
      sourceUnitId,
      "resource",
      `${target2.name}\u56E0${label}${after > before ? "\u6062\u590D" : "\u6D88\u8017"}${amount2}\u70B9 ${resource3.toUpperCase()}`,
      { targetId: target2.id, resource: resource3, amount: amount2, before, after }
    );
  }
  function armorOf(state, unit, damageType2, pierce = 0, context = {}) {
    const equipmentDefense = gearFor(state, unit).reduce((sum, g) => sum + (g.template?.defense ?? 0), 0) + (unit.shield ? equipmentFor(state, unit.shield).template?.defense ?? 0 : 0);
    const base = unit.armor + equipmentDefense + changes(unit, "armor") + gearFor(state, unit).reduce((sum, g) => sum + (g.template?.armor ?? 0), 0);
    const ctx = { ...context, target: context.attacker, damageType: damageType2 };
    const armor = Math.max(0, dsl.stat(state, unit, "defense", dsl.stat(state, unit, "armor", base, ctx), ctx));
    const flat = typeof pierce === "object" ? pierce.flat ?? 0 : pierce;
    const percent2 = typeof pierce === "object" ? pierce.percent ?? 0 : 0;
    const effective = Math.max(0, armor * (1 - percent2) - flat);
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
    const modified = mitigatedDamage(amount2, formula, hit, attacker);
    if (formula.shatter) {
      record(state, sourceUnitId, "shatter", `${recipient.name}\u53D7\u5230\u788E\u88C2\u589E\u4F24`, { targetId: recipient.id, multiplier: 1 + formula.shatter });
    }
    if (hit) expireStatuses(state, recipient, "on_struck", { sourceUnitId });
    const net = damageAfterFlatReduction(state, recipient, modified, attacker, type, recipient !== target2);
    let pending = net;
    for (const shield of values2(recipient.statuses).filter((status2) => status2.amount > 0).sort(byId2)) {
      if (!pending) break;
      const absorbed2 = Math.min(pending, shield.amount);
      pending -= absorbed2;
      shield.amount -= absorbed2;
      record(state, recipient, "shield", `${recipient.name}\u7684${shield.name}\u5438\u6536${absorbed2}\u70B9\u4F24\u5BB3`, { absorbed: absorbed2, remaining: shield.amount, statusId: shield.id });
      if (!shield.amount) {
        delete recipient.statuses[shield.id];
        record(state, recipient, "shield_break", `${recipient.name}\u7684${shield.name}\u7834\u88C2`, { targetId: recipient.id, statusId: shield.id });
      }
    }
    const absorbed = net - pending;
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
  function damageAfterFlatReduction(state, unit, amount2, attacker, damageType2, intercepting = false) {
    return Math.max(0, Math.floor(amount2 - dsl.stat(state, unit, "damageReductionFlat", 0, { target: attacker, damageType: damageType2, intercepting })));
  }
  function mitigatedDamage(amount2, formula, hit, attacker) {
    return Math.max(0, hit ? Math.floor(amount2 * formula.multiplier * formula.armorMultiplier * (1 - formula.attributeReduction) * (attacker ? finalDamageMultiplier(attacker) : 1)) : Math.floor(amount2 * formula.multiplier) - Math.floor(formula.armor));
  }
  function mitigation(state, unit, type, hit, pierce, ctx = {}) {
    const shatter = hit ? changes(unit, "shatter") : 0;
    const vulnerability = changes(unit, "vulnerability");
    const reduction = clamp(dsl.stat(state, unit, "damageReduction", changes(unit, "reduction"), { ...ctx, target: ctx.attacker, damageType: type }), 0, 1);
    const defense = ctx.ignoreArmor ? 0 : armorOf(state, unit, type, pierce, ctx);
    const armorMultiplier = type === "true" ? 1 : 2e3 / (defense + 2e3);
    const attributes3 = Object.fromEntries(Object.keys(unit.stats ?? {}).map((key4) => [key4, effectiveStat(state, unit, key4)]));
    const attributeReduction = state.ruleset === "protocol" ? type === "physical" ? (Number(attributes3.con ?? 0) + Number(attributes3.str ?? 0) + Number(attributes3.agi ?? 0)) * 25e-4 : type === "energy" ? (Number(attributes3.spi ?? 0) + Number(attributes3.int ?? 0)) * 4e-3 : type === "mental" ? Number(attributes3.spi ?? 0) * 8e-3 : 0 : 0;
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
      const detail = { statusId: status2.id, tickTiming: timing };
      if (amount2) damageTarget(state, unit, source, amount2 * status2.stacks, status2.modifiers.damageType ?? "true", status2.name, { details: detail });
      const heal = status2.modifiers?.heal;
      if (heal && alive(unit)) restoreHP(state, unit, heal * status2.stacks, source, status2.name, detail);
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
    updateTerrainPatches(state, record, terrainDamage, true);
  }
  function settleTurn(state) {
    for (let checked = 0; checked < state.order.length; checked++) {
      const unit = currentUnit(state);
      if (state.outcome) return;
      if (alive(unit) && !unit.fled) {
        unit.used = { attack: 0, action: 0 };
        unit.reactionAvailable = true;
        unit.ap = 2;
        record(state, unit, "turn", `${unit.name}\u5F00\u59CB\u56DE\u5408`, { turn: state.turn });
        const hold = unit.statuses.suppressed;
        if (hold?.holdTotal != null) {
          const roll = randomDie(state, 20), total = roll + Math.floor(effectiveStat(state, unit, "str") * unit.hp / unit.maxHp);
          const success = total > hold.holdTotal;
          if (success) delete unit.statuses.suppressed;
          record(state, unit, "break_hold", `${unit.name}\u6323\u8131\u68C0\u5B9A${success ? "\u6210\u529F\uFF0C\u89E3\u9664\u88AB\u538B\u5236" : "\u5931\u8D25\uFF0C\u4ECD\u88AB\u538B\u5236"}\uFF08${total} \u5BF9 ${hold.holdTotal}\uFF09`, { roll, total, threshold: hold.holdTotal, success });
        }
        expireStatuses(state, unit, "on_turn_start", { sourceUnitId: unit.id });
        tick(state, unit, "onTurnStart");
        tickZones(state, unit);
        dsl.dispatch(state, unit, "on_turn_start");
        if (refreshOutcome(state)) {
          unit.ap = 0;
          return;
        }
        if (unit.fled) {
          advanceCursor(state);
          continue;
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
    refreshOutcome(state);
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
    for (const unit of living(state)) for (const status2 of values2(unit.statuses)) {
      record(
        state,
        status2.sourceUnitId ?? unit.id,
        "status",
        `${unit.name}\u5F00\u573A\u5DF2\u6709${status2.name} \xD7${status2.stacks}`,
        { ...statusLogDetail(unit, status2), initial: true }
      );
    }
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
    const [entry, ...following] = state.logs;
    const turn = following.pop();
    if (state.round !== 1 || state.turn !== 0 || entry?.type !== "initiative" || turn?.type !== "turn" || following.some((log) => log.type !== "status" || !log.detail.initial)) return;
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
  function nextFreeId(table4, prefix) {
    let n = 1;
    while (Object.hasOwn(table4, `${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }
  function spawnUnitEffect(state, actor, spec, center) {
    const count = spec.count ?? 1;
    const reject = (reason) => {
      record(state, actor, "spawn_unresolved", `\u53EC\u5524${spec.name}\u5931\u8D25\uFF1A${reason}`, { unresolved: true });
      return false;
    };
    if (Object.keys(state.units).length + count > 200 || state.order.length + count > 200) return reject("\u5355\u4F4D\u6570\u91CF\u8FBE\u5230\u4E0A\u9650");
    const slots = [spec.mainHand, spec.offHand, spec.shield, ...spec.gear ?? []].filter(Boolean);
    if (Object.keys(state.items).length + slots.length * count > 200) return reject("\u88C5\u5907\u5B9E\u4F8B\u6570\u91CF\u8FBE\u5230\u4E0A\u9650");
    const panel = spawnPanel(actor, spec);
    if (!panel || panel.maxHp < 1) return reject("\u53EC\u5524\u8005\u5C5E\u6027\u9884\u7B97\u4E0D\u8DB3");
    const cells = allCells(state).filter((p) => emptyGround(state, p)).sort((a, b) => distance3D(state, center, a) - distance3D(state, center, b));
    if (cells.length < count) return reject("\u53EF\u7528\u7A7A\u683C\u4E0D\u8DB3");
    const mint = (templateId) => {
      if (!templateId) return null;
      const id3 = nextFreeId(state.items, "item");
      state.items[id3] = { id: id3, templateId, counters: initialCounters(state.equipment[templateId]) };
      return id3;
    };
    for (const at of cells.slice(0, count)) {
      const id3 = nextFreeId(state.units, "summon"), mainHand = mint(spec.mainHand);
      state.units[id3] = {
        ...panel,
        stats: { ...panel.stats },
        id: id3,
        name: spec.name,
        team: actor.team,
        ...at,
        facing: [...actor.facing],
        hp: panel.maxHp,
        mp: panel.maxMp,
        sp: panel.maxSp,
        ap: 0,
        used: { attack: 0, action: 0 },
        weapon: mainHand,
        mainHand,
        offHand: mint(spec.offHand),
        shield: mint(spec.shield),
        gear: (spec.gear ?? []).map(mint),
        skills: [...spec.skills ?? []],
        statuses: {}
      };
      state.order.push(id3);
      record(state, actor, "spawn", `${spec.name}\u767B\u573A`, { unitId: id3 });
    }
    return true;
  }
  var dsl = createEffectEngine({
    changeAltitude,
    spawn: spawnUnitEffect,
    terrain: (state, actor, node3, ctx) => applyTerrainEffect(state, actor, node3, ctx, record, terrainDamage),
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
    setResourceTotal,
    grant: grantStatus,
    grantShield,
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
  function skillExpressions(skill2, id3) {
    const entries2 = dsl.skillExpressions(skill2, id3);
    if (!skill2?.damageType) return entries2;
    return entries2.map((entry) => ({ ...entry, expr: { ...entry.expr, params: { damageType: skill2.damageType, ...entry.expr.params } } }));
  }
  function castLimits(skill2, id3) {
    const entries2 = skill2.entry ? [skill2.entry] : dsl.skillExpressions(skill2, id3);
    return entries2.filter(({ expr }) => ["active", "on_skill_cast"].includes(expr.trigger) && (expr.params?.usesPerBattle != null || expr.params?.cooldown != null));
  }
  function skillAvailability(state, actor, skill2, id3) {
    const entries2 = castLimits(skill2, id3);
    let usesLeft = null, cooldownRemaining = 0;
    for (const entry of entries2) {
      const status2 = dsl.usageStatus(state, actor, entry);
      if (status2.usesLeft != null) usesLeft = Math.min(usesLeft ?? Infinity, status2.usesLeft);
      cooldownRemaining = Math.max(cooldownRemaining, status2.cooldownRemaining);
    }
    return { usesLeft, cooldownRemaining };
  }
  function actorCost(template) {
    const cost = template.resourceCost;
    return { hp: cost?.hp ?? 0, mp: cost?.mp ?? template.mp ?? 0, sp: cost?.sp ?? template.sp ?? 0 };
  }
  var insufficientHP = "HP \u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u65BD\u653E";
  function paymentError(state, unit, ap, slot, template = {}) {
    if (unit.ap < ap) return `\u9700\u8981 ${ap} AP`;
    if (ap === 2 ? unit.used.attack || unit.used.action : unit.used[slot]) {
      return "\u672C\u56DE\u5408\u5BF9\u5E94\u7684\u884C\u52A8\u69FD\u5DF2\u4F7F\u7528";
    }
    const { hp, mp, sp } = actorCost(template);
    if (hp > 0 && hp >= unit.hp) return insufficientHP;
    if (unit.mp < mp) return "\u9B54\u529B\u4E0D\u8DB3";
    if (unit.sp < sp) return "\u4F53\u529B\u4E0D\u8DB3";
    if (template.resourceCost?.resource && (resourcePool(state, unit, template.resourceCost.resource)?.amount ?? 0) < template.resourceCost.amount) return "\u88C5\u5907\u8D44\u6E90\u4E0D\u8DB3";
    if (findNode(template, "restoreResource") && changes(unit, "blockResourceRestore")) return "\u5F53\u524D\u72B6\u6001\u7981\u6B62\u88C5\u5907\u8D44\u6E90\u6062\u590D";
    return null;
  }
  var normalAttack = Object.freeze({ name: "\u5F92\u624B", range: 1.5, accuracy: 0, damage: { count: 1, sides: 4, stat: "str", type: "physical" } });
  var findNode = (template, kind, predicate = () => true) => (template?.effects ?? []).flatMap((expr) => [...effectNodes(expr.effects, true)]).find((node3) => node3.kind === kind && predicate(node3));
  var shieldBashEffects = [expression("shield-bash-hit", "on_hit", "hitTarget", [
    { kind: "knockback", distance: 1 },
    { kind: "grantStatus", statusId: actionStatuses.shield_bash, turns: 1 }
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
  function reaches(state, actor, at, template, ammo, weaponId = actor.mainHand ?? actor.weapon) {
    const dz = elevation(state, actor) - elevation(state, at);
    const melee = isMelee(template) && !ammo;
    const range = (template.range ?? 1.5) + (melee || !dz ? 0 : dz > 0 ? ammo ? dsl.check(state, actor, "highGroundRange", { weaponId, highGround: true }) : 1 : -1);
    return { distance: distance3D(state, actor, at), dz, range: Math.max(0, range), melee };
  }
  function validReach(state, actor, at, template, ammo, weaponId) {
    const geometry = reaches(state, actor, at, template, ammo, weaponId);
    return isGround(state, at) && geometry.distance <= geometry.range + 1e-9 && hasLOS(state, actor, at);
  }
  function visibleEnemy(state, actor, target2) {
    return target2.team !== actor.team && (!changes(target2, "hidden") || gridDistance(actor, target2) <= 1 && Math.abs(elevation(state, actor) - elevation(state, target2)) <= 1);
  }
  function tauntFor(state, actor, template, ammo) {
    const teleport = findNode(template, "teleportBackstab");
    if (teleport && changes(actor, "rooted")) return null;
    for (const status2 of values2(actor.statuses).filter((status3) => status3.modifiers.taunted).sort(byId2)) {
      const source = tableEntry(state.units, status2.sourceUnitId);
      if (alive(source) && !source.fled && visibleEnemy(state, actor, source) && validReach(state, actor, source, template, ammo) && (!teleport || backCell(state, source))) return source;
    }
    return null;
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
    return visibleEnemy(state, source.unit, { ...mover, x: at.x, y: at.y }) && validReach(state, source.unit, { ...at, altitude: mover.altitude }, source.weapon.template);
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
    const key4 = `${count}d${dice3.sides}`;
    let probabilities = oddsCache.get(key4);
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
      oddsCache.set(key4, probabilities);
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
    const geometry = reaches(state, origin, at, template, weapon?.ammo, weapon?.instance?.id);
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
      damageType: template.damage?.type ?? template.damageType,
      entries: weapon ? [] : template.entry ? [template.entry] : skillExpressions(template, context.skillId ?? "preview")
    };
    const nodes = dsl.passiveNodes(state, actor, strike, strike.entries);
    const hasNode = (kind, mode) => nodes.some((node3) => node3.kind === kind && (!mode || node3.mode === mode));
    const guaranteeCrit = hasStrikeDamage(template) && Boolean(changes(actor, "guaranteed_crit") || hasNode("forceOutcome", "crit"));
    const guaranteeHit = hasStrikeDamage(template) && Boolean(guaranteeCrit || changes(actor, "guaranteed_hit") || hasNode("forceOutcome", "hit"));
    const tierUp = hasStrikeDamage(template) && hasNode("upgradeHitTier");
    const execution = !cover && target2?.team !== actor.team && ["shaken", "routed"].includes(target2?.moraleState) && ["kill", "concept"].includes(context.intent) && hasStrikeDamage(template);
    const dodge = execution || cover ? 0 : dsl.stat(state, target2, "dodge", dsl.check(state, target2, "dodgeBonus", { target: actor }) + dsl.check(state, target2, "dodgeAgility", { target: actor }) + changes(target2, "dodgeBonus"), { target: actor });
    const high = Math.sign(geometry.dz) * 2 + (geometry.dz > 0 ? dsl.check(state, actor, "highGroundAccuracy", strike) : 0);
    const flanked = target2 && !cover ? isFlanked(state, origin, target2) : false;
    const protectedBy = target2 && !cover && !geometry.melee ? coverBetween(state, origin, target2) : null;
    const penalty = protectedBy?.cover ?? 0;
    const size = cover ? 0 : typeof target2?.size === "number" ? Math.max(0, target2.size - 1) : target2?.size === "large" ? 2 : target2?.size === "small" ? -1 : 0;
    const sizeModifier = cover || !target2 ? 0 : sizeHitModifier(actor, target2);
    const sizeAccuracy = size + sizeModifier;
    const distanceModifier = distanceTier(geometry.distance).hit;
    const weaponRangeModifier = distanceTier(Math.max(geometry.distance, geometry.range)).range;
    const stance = weapon?.stance ?? actor.stance ?? "unarmed";
    const rules = stanceRules(stance);
    const rangedDistance = weapon && !geometry.melee && distanceModifier < 0 ? rules.rangedDistancePenalty ?? distanceModifier : distanceModifier;
    const closeRange = rules.closeRange && geometry.melee && geometry.distance <= 2 ? 4 : rangedDistance;
    const accuracy = dsl.stat(state, actor, "accuracy", (template.accuracy ?? 0) + (state.ruleset === "sandbox" ? effectiveStat(state, actor, geometry.melee ? "str" : "agi") : 0) + high + sizeAccuracy + closeRange + (state.ruleset === "sandbox" ? 0 : weaponRangeModifier) + changes(actor, "accuracy") + (execution || cover || !target2 ? 0 : changes(target2, "incomingAccuracy")) + (flanked ? 2 : 0) - penalty + dsl.check(state, actor, "accuracyBonus", strike), strike) - dodge;
    const explicitEvasion = execution ? 0 : changes(target2, "incomingAccuracy");
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
    const damageType2 = fixedDamage?.damageType ?? template.damage?.type ?? template.damageType ?? "physical";
    const tierPower = { 1: 2, 2: 2.8, 3: 4, 4: 8, 5: 15, 6: 35, 7: 80 }[actor.tier ?? 1] ?? 2;
    const attributeBase = () => state.ruleset === "protocol" ? effectiveStat(state, actor, template.damage.stat ?? (geometry.melee ? "str" : "int")) * 10 * tierPower : Math.floor(effectiveStat(state, actor, template.damage.stat) * (template.damage.multiplier ?? 1));
    const flatAttack = fixedAttack ? Math.max(0, fixedAttack.value + (fixedAttack.ignoreAttributes === false ? attributeBase() : 0)) : null;
    const protocolInitial = fixedDamage?.value ?? flatAttack ?? (state.ruleset === "protocol" && template.damage ? attributeBase() + Number(template.power ?? 20) + Number(weapon?.template?.attack ?? 0) : null);
    const armorPierce = { flat: dsl.stat(state, actor, "armorPierce", template.armorPierce ?? 0, { ...strike, damageType: damageType2 }), percent: rules.armorPenetration ?? 0 };
    const recipient = cover || !hasStrikeDamage(template) ? target2 : guardFor(state, target2) ?? target2;
    const reduction = cover ? { multiplier: 1, armorMultiplier: fixedDamage || fixedAttack ? 1 : void 0, armor: target2.armor ?? 0 } : mitigation(state, recipient, damageType2, true, armorPierce, { attacker: actor, intercepting: recipient !== target2 });
    const absorb = cover ? 0 : shieldTotal(recipient);
    const dice3 = fixedDamage ? flatDice(fixedDamage.value) : template.damage == null ? null : diceFormula(state, template.damage, actor);
    const shown = (raw, factor = 1) => Math.max(0, Math.floor(Math.floor(dsl.stat(state, actor, "damage", raw * (fixedDamage ? 1 : multiplier) * factor * dsl.damageFactor(state, actor, { ...strike, damageType: damageType2 }), { ...strike, damageType: damageType2 })) * reduction.multiplier * reduction.armorMultiplier * finalDamageMultiplier(actor) * (fixedDamage ? 1 - (reduction.attributeReduction ?? 0) : 1)) - absorb);
    const flat = fixedAttack || fixedDamage;
    const bounds = (critical = false, factor = 1) => (flat ? [protocolInitial, protocolInitial] : diceBounds(dice3, critical)).map((n) => shown(n, factor));
    const average = (critical = false, factor = 1) => flat ? shown(protocolInitial, factor) : diceAverage(dice3, (n) => shown(n, factor), critical);
    const minFactor = execution ? 1.3 : 1;
    const damage = dice3 ? protocolInitial == null ? bounds(false, minFactor) : [shown(protocolInitial, minFactor), shown(protocolInitial, minFactor)] : [0, 0];
    const criticalDamage = dice3 && critChance2 > 0 ? bounds(true) : null;
    const savedDamage = dice3 && saveStat ? bounds(false, 0.5) : null;
    const expectedDamage = !dice3 ? 0 : Math.max(0, hitChance2 - critChance2 - saveChance2) * average() + (criticalDamage ? critChance2 * average(true) : 0) + (savedDamage ? saveChance2 * average(false, 0.5) : 0);
    const expectedD20 = saveStat ? 10.5 : automatic ? null : advantage > 0 ? 13.825 : advantage < 0 ? 7.175 : 10.5;
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
      accuracySources: { explicit: template.accuracy ?? 0, highGround: high, size: sizeAccuracy, distance: closeRange, weaponRange: weaponRangeModifier, status: changes(actor, "accuracy") },
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
      execution,
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
      dice: dice3
    };
  }
  var ACTIONS = Object.freeze({
    move: { ap: 1, slot: "action" },
    sprint: { ap: 2, slot: "action" },
    disengage: { ap: 1, slot: "action" },
    end_encounter: { ap: 0, slot: null },
    switch_weapon: { ap: 0, slot: null },
    attack: { ap: 1, slot: "attack" },
    reload: { ap: 1, slot: "action" },
    brace: { ap: 1, slot: "action" },
    block: { ap: 1, slot: "action" },
    shield_bash: { ap: 1, slot: "attack", sp: 2 },
    use_item: { ap: 0, slot: null },
    charge: { ap: 1, slot: "action" },
    lock_on: { ap: 1, slot: "action" },
    scan: { ap: 1, slot: "action" },
    free_ally: { ap: 1, slot: "attack" },
    suppress: { ap: 1, slot: "attack" },
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
  var needsTarget = (type) => isMovement(type) || ["attack", "skill", "shield_bash", "interact", "lock_on", "free_ally", "suppress", "grapple", "disarm", "trip", "push"].includes(type);
  var fail2 = (error2, extra = {}) => ({ ok: false, error: error2, ...extra });
  var healMultiplier = (state, actor) => dsl.stat(state, actor, "healing", 1, { actionType: "skill" });
  var healShieldRatio = (state, actor) => equipped(state, actor).reduce((sum, item) => sum + (findNode(item.template, "shield", (node3) => node3.percentOfHealing != null)?.percentOfHealing ?? 0), 0);
  function inInteractionRange(state, actor, at) {
    return gridDistance(actor, at) <= 1 && Math.abs(elevation(state, actor) - elevation(state, at)) <= 1 && hasLOS(state, actor, at);
  }
  function nearbyCovers(state, at) {
    return values2(state.covers).filter((c) => c.hp > 0 && inInteractionRange(state, at, c)).sort(byId2);
  }
  function canExecute(state, actor, target2, effect, nonLethal) {
    return !encounterNonlethal(state, actor) && alive(target2) && !target2.fled && target2.team !== actor.team && visibleEnemy(state, actor, target2) && (effect.strict ? target2.hp / target2.maxHp < effect.threshold : target2.hp / target2.maxHp <= effect.threshold) && !nonLethal && !target2.nonLethal && !changes(target2, "preserveLife") && (!effect.requiresPool || Boolean(resourcePool(state, actor, effect.requiresPool)));
  }
  function usableTiles(state, actor, template, weapon, nonLethal) {
    const execute = findNode(template, "execute", (node3) => node3.requiresPool);
    return allCells(state).filter((at) => validReach(state, actor, template.target === "cell" ? at : locateUnit(state, at) ?? at, template, weapon?.ammo) && (!execute || canExecute(state, actor, locateUnit(state, at), execute, nonLethal)) && !((template.shape === "line" || template.shape === "cone" || template.shape === "fan") && sameCell(actor, at)));
  }
  function shapeTargets(state, actor, cells, template, aim) {
    const keys = new Set(cells.map((at) => key2(at.x, at.y)));
    return living(state).filter((unit) => {
      if (!selectionAllows(template, actor, unit)) return false;
      if ((template.shape ?? "single") === "single") return sameCell(unit, aim);
      if (template.shape === "circle") return distance3D(state, aim, unit) <= (template.radius ?? 1.5) + 1e-9 && hasLOS(state, aim, unit);
      return keys.has(key2(unit.x, unit.y)) && validReach(state, actor, unit, template);
    });
  }
  function preview(state, action) {
    if (state.outcome) return fail2("\u6218\u6597\u5DF2\u7ECF\u7ED3\u675F");
    const unit = currentUnit(state);
    if (!alive(unit) && action?.type !== "end") return fail2("\u5F53\u524D\u5355\u4F4D\u4E0D\u80FD\u884C\u52A8");
    if (!action || typeof action !== "object" || Array.isArray(action)) return fail2("\u52A8\u4F5C\u683C\u5F0F\u9519\u8BEF");
    const { type, x, y, skillId } = action;
    if (!Object.keys(action).every((field) => type === "switch_weapon" && field === "itemId" || ["type", "x", "y", "skillId", "bonusDice", "intent", "nonLethal", "maneuver"].includes(field))) return fail2("\u52A8\u4F5C\u542B\u672A\u77E5\u5B57\u6BB5");
    if (action.bonusDice !== void 0 && (!Number.isInteger(action.bonusDice) || action.bonusDice < 0 || action.bonusDice > Math.min(2, unit?.bonusDice ?? 0))) return fail2("\u5956\u52B1\u9AB0\u50A8\u5907\u4E0D\u8DB3");
    if (action.intent !== void 0 && !["normal", "function", "core", "kill", "concept"].includes(action.intent)) return fail2("\u610F\u56FE\u7C7B\u578B\u65E0\u6548");
    const equipmentSkill = type === "skill" ? new Map(equippedActiveSkills(state, unit)).get(skillId) : null;
    const skill2 = type === "skill" ? equipmentSkill ?? tableEntry(state.skills, skillId) : null;
    if (skill2?.backpackItem) {
      if (!(unit.inventory?.[skillId] > 0)) return fail2("\u80CC\u5305\u7269\u54C1\u6570\u91CF\u4E0D\u8DB3");
      if (!skill2.damage && !skill2.heal && !skill2.effects.some((e) => ["active", "on_skill_cast"].includes(e.trigger) && e.effects?.some((n) => n.enabled !== false))) return fail2("\u80CC\u5305\u7269\u54C1\u5C1A\u65E0\u53EF\u6267\u884C\u6548\u679C\uFF0C\u8BF7\u5148\u6807\u51C6\u5316");
    } else if (type === "skill" && (!skill2 || !equipmentSkill && !unit.skills.includes(skillId))) return fail2("\u5355\u4F4D\u6CA1\u6709\u6B64\u6280\u80FD");
    const availability = skill2 ? skillAvailability(state, unit, skill2, skillId) : {};
    if (availability.usesLeft === 0) return fail2("\u6280\u80FD\u6B21\u6570\u5DF2\u7528\u5C3D", availability);
    if (availability.cooldownRemaining > 0) return fail2(`\u6280\u80FD\u51B7\u5374\u4E2D\uFF0C\u8FD8\u9700 ${availability.cooldownRemaining} \u8F6E`, availability);
    if (type === "flee" && !atBattleEdge(state, unit)) return fail2("\u987B\u5148\u79FB\u52A8\u5230\u6218\u573A\u8FB9\u754C\u624D\u80FD\u9003\u8DD1");
    const cost = skill2 ?? tableEntry(ACTIONS, type);
    if (!cost) return fail2("\u672A\u77E5\u52A8\u4F5C");
    const aimed = needsTarget(type);
    const unplaced = x === void 0 && y === void 0;
    if (type !== "skill" && skillId !== void 0 || !unplaced && !aimed) return fail2("\u52A8\u4F5C\u5E26\u6709\u4E0D\u9002\u7528\u7684\u53C2\u6570");
    if (!unplaced && (!Number.isInteger(x) || !Number.isInteger(y) || !cellAt(state, x, y))) return fail2("\u76EE\u6807\u5750\u6807\u8D85\u51FA\u68CB\u76D8");
    if (type === "interact" && unplaced) {
      const cells2 = values2(state.interactives).filter((v) => !v.spent && preview(state, { type, x: v.x, y: v.y }).ok).sort(byId2).map((v) => pos(v.x, v.y));
      return cells2.length ? { ok: true, ap: 1, cost: 1, cells: cells2 } : fail2("\u6CA1\u6709\u53EF\u7528\u7684\u4E92\u52A8\u70B9", { cells: cells2 });
    }
    const item = !unplaced && (type === "interact" || type === "attack") ? values2(state.interactives).find((v) => !v.spent && v.x === x && v.y === y) : null;
    const detonate = item?.kind === "barrel";
    const drawFromBag = type === "switch_weapon" && unit.bagWeapons?.includes(action.itemId);
    const ap = drawFromBag ? 1 : cost.ap, slot = drawFromBag ? "action" : detonate ? "attack" : cost.slot;
    const common = { ok: true, ap, cost: ap, slot, ...actorCost(cost), ...availability };
    if (type === "end") return common;
    if (type === "end_encounter") return ["spar", "arena"].includes(state.battleType) ? { ...common, name: state.battleType === "spar" ? "\u53EB\u505C\u5207\u78CB\uFF08\u5E73\u5C40\uFF09" : "\u5168\u961F\u8BA4\u8F93" } : fail2("\u672C\u573A\u4E0D\u80FD\u76F4\u63A5\u53EB\u505C\u6216\u8BA4\u8F93");
    if (changes(unit, "skip")) return fail2("\u5F53\u524D\u5355\u4F4D\u53D7\u63A7\u5236\uFF0C\u53EA\u80FD\u7ED3\u675F\u56DE\u5408");
    const cannotPay = paymentError(state, unit, ap, slot, cost);
    if (cannotPay) return fail2(cannotPay, { ap, ...availability });
    const center = unplaced ? void 0 : pos(x, y);
    const weapon = weaponInfo(state, unit);
    if (type === "switch_weapon") {
      if (!switchableWeapons(state, unit).includes(action.itemId)) return fail2("\u6CA1\u6709\u53EF\u5207\u6362\u7684\u6B66\u5668");
      return { ...common, itemId: action.itemId, name: `${unit.bagWeapons?.includes(action.itemId) ? "\u4ECE\u80CC\u5305\u6362\u88C5" : "\u5207\u6362\u6B66\u5668"}\uFF1A${equipmentFor(state, action.itemId).template.name}` };
    }
    if (type === "shield_bash" && !unit.shield) return fail2("\u6CA1\u6709\u76FE\u724C");
    if (type === "reload") {
      if (!weapon.ammo || weapon.infiniteAmmo) return fail2("\u5F53\u524D\u6B66\u5668\u4E0D\u9700\u8981\u88C5\u586B");
      if (weapon.ammoCount >= weapon.ammo.cap) return fail2("\u5F39\u4ED3\u5DF2\u6EE1");
      return { ...common, ammo: weapon.ammoCount, capacity: weapon.ammo.cap };
    }
    if (type === "block") {
      if (stanceFor({ mainHand: weapon.template, offHand: weapon.offHand?.template, shield: equipmentFor(state, unit.shield).template }) !== "sword_shield") return fail2("\u53EA\u6709\u5251\u76FE\u59FF\u6001\u53EF\u683C\u6321");
      const modifiers3 = getStatusTemplate(state, actionStatuses.block).modifiers;
      return { ...common, name: "\u683C\u6321", reduction: Object.hasOwn(modifiers3, "reduction") ? action.maneuver === "heavy" ? 0.45 : 0.25 : 0, turns: 1 };
    }
    if (type === "brace") {
      const [nearbyCover] = nearbyCovers(state, unit);
      return {
        ...common,
        name: "\u67B6\u52BF\u9632\u5FA1",
        coverId: nearbyCover?.id ?? null,
        reduction: getStatusTemplate(state, actionStatuses.brace).modifiers.reduction ?? 0,
        turns: nearbyCover ? 2 : 1
      };
    }
    if (type === "use_item") {
      const item2 = equipmentFor(state, unit.offHand);
      if (unit.stance !== "attunement" || item2.template?.kind !== "consumable") return fail2("\u53EA\u6709\u540C\u8C03\u59FF\u6001\u53EF\u4EE5\u514D\u8D39\u4F7F\u7528\u526F\u624B\u9053\u5177");
      if ((unit.attunementCharges ?? 0) <= 0) return fail2("\u540C\u8C03\u9053\u5177\u6B21\u6570\u5DF2\u7528\u5C3D");
      return { ...common, name: `\u4F7F\u7528${item2.template.name}`, maneuver: "use_item", itemId: unit.offHand };
    }
    if (type === "charge") return { ...common, name: "\u84C4\u529B", maneuver: "charge" };
    if (type === "scan") return { ...common, name: "\u63A2\u5BDF", maneuver: "scan" };
    if (type === "flee") return { ...common, name: "\u9003\u8DD1", maneuver: "flee" };
    if (type === "detour") return { ...common, name: "\u7ED5\u884C", maneuver: "detour" };
    if (type === "lock_on") {
      const target2 = locateUnit(state, center);
      if (!target2 || target2.team === unit.team) return fail2("\u5B9A\u4F4D\u5FC5\u987B\u6307\u5B9A\u654C\u65B9\u5355\u4F4D");
      return { ...common, name: "\u5B9A\u4F4D", maneuver: "lock_on", targetId: target2.id };
    }
    if (type === "free_ally") {
      if (state.battleType !== "suppress" || unit.team === state.suppressingTeam || unit.statuses.suppressed || unit.fled) return fail2("\u4EC5\u672A\u88AB\u538B\u5236\u7684\u62B5\u6297\u65B9\u53EF\u4EE5\u6551\u63F4");
      const allies = living(state).filter((t) => t !== unit && t.team === unit.team && t.statuses.suppressed && distance3D(state, unit, t) <= 1 && hasLOS(state, unit, t));
      if (!center) return { ...common, cells: allies.map((t) => pos(t.x, t.y)) };
      const ally = allies.find((t) => sameCell(t, center));
      return ally ? { ...common, name: "\u89E3\u9664\u538B\u5236", targetId: ally.id } : fail2("\u9700\u8981\u8D34\u8FD1\u4E00\u683C\u5185\u88AB\u538B\u5236\u7684\u961F\u53CB");
    }
    if (type === "suppress") {
      if (state.battleType !== "suppress" || unit.team !== state.suppressingTeam) return fail2("\u4EC5\u538B\u5236\u65B9\u53EF\u4EE5\u4F7F\u7528\u538B\u5236");
      const available = living(state).filter((t) => t.team !== unit.team && t.statuses.suppressed?.holdTotal == null && distance3D(state, unit, t) <= 1 && visibleEnemy(state, unit, t) && hasLOS(state, unit, t));
      if (!center) return { ...common, cells: available.map((t) => pos(t.x, t.y)) };
      const target2 = available.find((t) => sameCell(t, center));
      if (!target2) return fail2("\u538B\u5236\u9700\u8981\u4E00\u683C\u5185\u53EF\u89C1\u4E14\u672A\u88AB\u538B\u5236\u7684\u654C\u4EBA");
      const profile = targetProfile(state, unit, target2, target2, normalAttack);
      return { ...common, name: "\u538B\u5236", targetId: target2.id, targets: [{ ...profile, damage: null, expectedDamage: 0 }] };
    }
    if (["grapple", "disarm", "trip", "push"].includes(type)) {
      const target2 = locateUnit(state, center);
      if (!target2 || target2.team === unit.team) return fail2("\u6218\u672F\u5BF9\u6297\u5FC5\u987B\u6307\u5B9A\u654C\u65B9\u5355\u4F4D");
      if (gridDistance(unit, target2) > 1 || !hasLOS(state, unit, target2)) return fail2("\u6218\u672F\u5BF9\u6297\u9700\u8981\u8D34\u8EAB\u4E14\u89C6\u7EBF\u7545\u901A");
      return { ...common, name: { grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E" }[type], maneuver: type, targetId: target2.id };
    }
    if (isMovement(type)) {
      if (changes(unit, "rooted")) return fail2("\u5B9A\u8EAB\u65F6\u4E0D\u80FD\u79FB\u52A8");
      const cells2 = reachable(state, type, unit);
      if (unplaced) return { ...common, cells: cells2 };
      const choice = cells2.find((at) => sameCell(at, center));
      if (!choice) return fail2("\u65E0\u6CD5\u5230\u8FBE\uFF1A\u8DDD\u79BB\u3001\u5360\u4F4D\u3001\u5899\u4F53\u6216\u9661\u5D16\u963B\u6321", { cells: cells2 });
      return {
        ...common,
        cells: cells2,
        path: choice.path,
        steps: choice.steps,
        opportunities: choice.opportunities,
        dz: elevation(state, center) - elevation(state, unit)
      };
    }
    if (type === "interact" || detonate) {
      if (!item) return fail2("\u6CA1\u6709\u53EF\u7528\u7684\u4E92\u52A8\u70B9");
      if (detonate) {
        if (weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail2("\u5F39\u4ED3\u5DF2\u7A7A\uFF0C\u8BF7\u88C5\u586B");
        if (!validReach(state, unit, item, weapon.template, weapon.ammo)) return fail2("\u7206\u6876\u8D85\u51FA\u6B66\u5668\u5C04\u7A0B\u6216\u88AB\u5899\u4F53\u963B\u6321");
      } else if (distance3D(state, unit, item) > 1.5 || !hasLOS(state, unit, item)) return fail2("\u9700\u8981\u9760\u8FD1\u4E92\u52A8\u70B9");
      const cells2 = detonate ? aoeCells(state, center, center, { shape: "circle", radius: item.radius ?? 1.5 }) : [center];
      const keyset = new Set(cells2.map((at) => key2(at.x, at.y)));
      const targets2 = item.kind === "altar" ? [{ id: unit.id, targetId: unit.id, name: unit.name, x: unit.x, y: unit.y, heal: [8, 8] }] : living(state).filter((u) => keyset.has(key2(u.x, u.y)) && distance3D(state, center, u) <= 1.5 + 1e-9).map((u) => {
        const guard = guardFor(state, u) ?? u;
        const formula = mitigation(state, guard, "energy", true, 0, { attacker: unit, intercepting: guard !== u });
        const damage = Math.max(0, mitigatedDamage(item.damage ?? 12, formula, true, unit) - shieldTotal(guard));
        return {
          id: u.id,
          targetId: u.id,
          recipientId: guard.id,
          name: u.name,
          x: u.x,
          y: u.y,
          damage: [damage, damage],
          expectedDamage: damage,
          damageMax: damage,
          hitChance: 1,
          automatic: true
        };
      });
      return {
        ...common,
        ...detonate ? reaches(state, unit, item, weapon.template, weapon.ammo) : {},
        name: `${detonate ? "\u5F15\u7206" : "\u6FC0\u6D3B"}${item.name}`,
        interactiveId: item.id,
        kind: item.kind,
        cells: cells2,
        targets: targets2,
        center
      };
    }
    const attack = type === "attack" || type === "shield_bash";
    const shieldBash = type === "shield_bash";
    const template = shieldBash ? { name: "\u76FE\u51FB", range: 1, accuracy: 0, damage: { count: 1, sides: 4, stat: "str", type: "physical" }, effects: shieldBashEffects } : attack ? weapon.template : skill2;
    const effect = attack ? void 0 : findNode(template, "teleportBackstab");
    if (effect && changes(unit, "rooted")) return fail2("\u5B9A\u8EAB\u65F6\u4E0D\u80FD\u77AC\u79FB");
    if (attack && !shieldBash && weapon.ammo && !weapon.infiniteAmmo && weapon.ammoCount <= 0) return fail2("\u5F39\u4ED3\u5DF2\u7A7A\uFF0C\u8BF7\u88C5\u586B");
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
    const aimedUnit = locateUnit(state, center);
    const aim = template.target === "cell" ? center : aimedUnit ?? center;
    const geometry = reaches(state, unit, aim, template, attack && !shieldBash ? weapon.ammo : null);
    if (!isGround(state, center)) return fail2("\u5899\u4F53\u65E0\u6CD5\u6307\u5B9A", geometry);
    if (geometry.distance > geometry.range + 1e-9) return fail2("\u76EE\u6807\u8D85\u51FA\u5C04\u7A0B", geometry);
    if (!hasLOS(state, unit, center)) return fail2("\u5899\u4F53\u963B\u65AD\u89C6\u7EBF", geometry);
    if (corpseSkill) {
      const corpse = corpses(state).find((c) => sameCell(c, center));
      return corpse ? { ...common, ...geometry, ...tuning, cells: [center], targets: [], center, corpseId: corpse.id } : fail2("\u76EE\u6807\u683C\u6CA1\u6709\u53EF\u7528\u5C38\u4F53");
    }
    const execute = findNode(template, "execute", (node3) => node3.requiresPool);
    if (execute && !canExecute(state, unit, aimedUnit, execute, action.nonLethal ?? unit.nonLethal)) return fail2("\u76EE\u6807\u6216\u88C5\u5907\u8D44\u6E90\u4E0D\u6EE1\u8DB3\u65A9\u6740\u6761\u4EF6");
    const solid = locateCover(state, center);
    const coverTarget = Boolean(solid && (attack || hasStrikeDamage(template)));
    const cells = area(state, unit, aim, template, attack && !shieldBash ? weapon.ammo : null);
    const aoe = (template.shape ?? "single") !== "single";
    if (!cells.length) return fail2("\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u5411", geometry);
    if (!aoe) {
      if (!(attack ? aimedUnit && aimedUnit.team !== unit.team : selectionAllows(template, unit, aimedUnit)) && !coverTarget && template.target !== "cell") {
        return fail2("\u8BE5\u683C\u6CA1\u6709\u5408\u9002\u7684\u76EE\u6807", geometry);
      }
      if (aimedUnit && aimedUnit.team !== unit.team && !visibleEnemy(state, unit, aimedUnit)) return fail2("\u76EE\u6807\u6B63\u5728\u9690\u8EAB", geometry);
    }
    const hostile = attack || template.target === "enemy" || hasStrikeDamage(template) && template.target !== "ally" && template.target !== "self";
    const taunter = hostile ? tauntFor(state, unit, template, attack && !shieldBash ? weapon.ammo : null) : null;
    if (taunter && (!aimedUnit || aimedUnit.id !== taunter.id)) return fail2(`\u53D7\u5632\u8BBD\uFF0C\u5FC5\u987B\u6307\u5B9A${taunter.name}`, geometry);
    const blink = effect && aimedUnit ? backCell(state, aimedUnit) : null;
    if (effect && !blink) return fail2("\u76EE\u6807\u80CC\u540E\u7684\u77AC\u79FB\u843D\u70B9\u88AB\u963B\u6321", geometry);
    const origin = blink ? { ...unit, ...blink } : unit;
    const templateForHit = blink ? { ...template, range: 1.5 } : template;
    const targetUnits = attack ? aimedUnit ? [aimedUnit] : [] : shapeTargets(state, unit, cells, template, aim);
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
    const support = type === "skill" ? previewSkillEffects(state, unit, template, skillId, common, targets, targetUnits, center, action.nonLethal ?? unit.nonLethal) : [];
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
      ...support.length ? { support } : {},
      ...blink ? { teleport: blink } : {},
      hostile
    };
  }
  function previewSkillEffects(state, unit, template, skillId, cost, profiles, units, center, nonLethal) {
    const entries2 = template.entry ? [template.entry] : skillExpressions(template, skillId);
    if (!entries2.length) return [];
    const mainTarget = units[0];
    const actor = {
      ...unit,
      hp: unit.hp - cost.hp,
      mp: unit.mp - cost.mp,
      sp: unit.sp - cost.sp,
      ap: unit.ap - cost.ap,
      used: { ...unit.used }
    };
    if (cost.ap === 2) {
      actor.used.attack++;
      actor.used.action++;
    } else if (cost.slot) actor.used[cost.slot]++;
    const area2 = template.shape !== "single";
    const context = {
      target: mainTarget,
      center,
      entries: entries2,
      actionType: "skill",
      school: template.school,
      weaponId: template.entry?.instance?.id,
      damageType: template.damage?.type ?? template.damageType,
      melee: profiles[0]?.melee,
      nonLethal,
      power: castPower(state, actor, template),
      skillScale: castSkillScale(state, actor, template, mainTarget),
      ...area2 ? { skillArea: new Set(units.map((target2) => target2.id)) } : {}
    };
    const perTarget = area2 ? entries2.filter(({ expr }) => expr.target === "hitTarget") : [];
    const shared = area2 ? entries2.filter((entry) => !perTarget.includes(entry)) : entries2;
    const support = [];
    if (!units.length) {
      dsl.previewEffects(state, actor, null, "on_skill_cast", context, entries2, support);
      dsl.previewEffects(state, actor, null, "active", context, entries2, support);
    }
    for (const [i, unitTarget] of units.entries()) {
      const target2 = unitTarget.id === actor.id ? actor : unitTarget;
      const profile = profiles[i];
      const effects2 = [
        dsl.previewEffects(state, actor, target2, "on_skill_cast", context, entries2, i === 0 ? support : void 0),
        dsl.previewEffects(state, actor, target2, "active", context, shared, i === 0 ? support : void 0)
      ];
      if (perTarget.length) effects2.push(dsl.previewEffects(state, actor, target2, "active", { ...context, target: target2 }, perTarget, support));
      const hitContext = {
        ...context,
        target: target2,
        center: pos(target2.x, target2.y),
        melee: profile.melee,
        backstab: profile.backstab,
        damageType: profile.damageType
      };
      const hit = dsl.previewEffects(state, actor, target2, "on_hit", hitContext, entries2);
      const packets = effects2.flatMap((result) => result.packets).filter((packet) => packet.raw > 0);
      const conditional = effects2.some((result) => result.conditional) || hit.conditional || hit.packets.some((packet) => packet.raw > 0);
      if (conditional) profile.conditionalDamage = true;
      if (!packets.length) returnIfNoDamage(profile);
      if (!packets.length) continue;
      let shield = shieldTotal(target2), hp = target2.hp;
      for (const packet of packets) {
        const hit2 = Boolean(packet.hit);
        const formula = mitigation(state, target2, packet.type, hit2, 0, { attacker: actor, ignoreArmor: packet.ignoreArmor });
        const modified = mitigatedDamage(packet.raw, formula, hit2, actor);
        const net = damageAfterFlatReduction(state, target2, modified, actor, packet.type);
        const absorbed = Math.min(shield, net);
        shield -= absorbed;
        const floor = encounterNonlethal(state, actor) || packet.preserveLife || target2.nonLethal || changes(target2, "preserveLife") ? 1 : 0;
        hp = Math.max(floor, hp - (net - absorbed));
        if (hp === 0) break;
      }
      const dealt = target2.hp - hp;
      profile.directEffectDamage = dealt;
      if (!profile.dice) {
        profile.damage = [dealt, dealt];
        profile.damageMin = profile.damageMax = profile.expectedDamage = dealt;
      } else {
        profile.damageMax = Math.min(target2.hp, profile.damageMax + dealt);
        profile.expectedDamage = Math.min(target2.hp, profile.expectedDamage + dealt);
      }
    }
    const recipients = /* @__PURE__ */ new Map();
    for (const { id: id3, kind, amount: amount2, stack } of support) {
      const target2 = id3 === actor.id ? actor : state.units[id3];
      const baseShield = statusOf(target2, actionStatuses.shield)?.amount ?? 0;
      if (!recipients.has(id3)) recipients.set(id3, { id: id3, heal: 0, shield: baseShield, baseShield });
      const result = recipients.get(id3);
      if (kind === "heal") {
        const healing = dsl.stat(state, actor, "healing", amount2, { target: target2, actionType: "skill" });
        result.heal = Math.min(target2.maxHp - target2.hp, result.heal + Math.max(0, Math.floor(healing)));
      } else {
        result.shield = clamp(amount2 + (stack ? result.shield : 0), 1, 1e4);
      }
    }
    return [...recipients.values()].map(({ id: id3, heal, shield, baseShield }) => ({ id: id3, heal, shieldGain: shield - baseShield }));
  }
  function returnIfNoDamage(profile) {
    if (!profile.dice && profile.conditionalDamage) profile.damage = null;
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
    const cover = profile.kind === "cover" ? { targetKind: "cover", targetName: profile.name } : {};
    if (profile.saveStat) {
      const saveRoll = randomDie(state, 20), saveTotal = saveRoll + profile.saveBonus;
      const saved = saveTotal >= profile.saveDC;
      record(
        state,
        actor,
        "save",
        `${profile.name}${saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}\u8C41\u514D (${saveTotal}/${profile.saveDC})`,
        { targetId: profile.id, ...cover, saveStat: profile.saveStat, saveRoll, saveBonus: profile.saveBonus, saveTotal, saveDC: profile.saveDC, saved }
      );
      return { hit: true, critical: false, saved };
    }
    if (profile.automatic) {
      const rating2 = ratingFor(profile.guaranteeCrit || profile.execution ? 20 : 11);
      if (profile.dice) record(state, actor, "hit_result", `${profile.name}\uFF1A\u81EA\u52A8\u547D\u4E2D`, {
        targetId: profile.id,
        ...cover,
        automatic: true,
        hit: true,
        critical: Boolean(profile.guaranteeCrit),
        ...profile.execution && { execution: true },
        rating: rating2
      });
      return { hit: true, critical: profile.guaranteeCrit, rating: rating2, intent: { success: true, multiplier: 1 }, saved: false };
    }
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
    if (profile.execution && hit && rating.multiplier < 1.3) rating = ratingFor(20);
    let intent = { required: false, success: true, multiplier: 1 };
    let intentDetail;
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
      intentDetail = {
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
      };
    }
    const effectiveHit = hit;
    record(state, actor, "roll", `${profile.name}\uFF1A${critical ? "\u66B4\u51FB" : hit ? "\u547D\u4E2D" : "\u672A\u547D\u4E2D"} (${total}/${profile.defense})`, {
      targetId: profile.id,
      ...cover,
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
      ...profile.execution && { execution: true },
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
    if (intent.required) record(state, actor, "intent", `${profile.name}${intent.success ? "\u610F\u56FE\u6210\u7ACB" : "\u610F\u56FE\u53D7\u963B"}`, intentDetail);
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
    const from = pointAt(state, target2);
    for (let i = 0; i < (effect.distance ?? 1); i++) {
      const at = pos(target2.x + dx, target2.y + dy);
      if (!canStep(state, target2, at)) {
        damageTarget(state, target2, actor.id, effect.collisionDamage ?? 5, "true", "\u649E\u51FB");
        if (alive(target2)) grantStatus(state, target2, effect.statusId ?? actionStatuses.collision, { sourceUnitId: actor.id });
        break;
      }
      Object.assign(target2, at);
    }
    record(state, actor, "knockback", `${target2.name}\u906D\u5230\u51FB\u9000`, { targetId: target2.id, from, to: pointAt(state, target2) });
  }
  function healWithGear(state, actor, target2, spec, name, skillScale = 1) {
    const dice3 = diceRoll(state, diceFormula(state, spec, actor));
    restoreHP(state, target2, Math.floor(dice3.value * skillScale), actor.id, name, { dice: dice3, actionType: "skill" });
  }
  function offHandFollowup(state, actor, target2, primaryProfile, primaryRating) {
    const weapon = weaponInfo(state, actor);
    if (weapon.stance !== "dual_wield" || !weapon.offHand.template?.damage || !alive(target2) || target2.fled) return;
    const cost = (actor.tier ?? 1) * 10;
    if ((actor.sp ?? 0) < cost || (primaryRating?.multiplier ?? 0) < 0.8) return;
    const offTemplate = weapon.offHand.template;
    const ammo = resourceDefinitions(offTemplate, true).find((node3) => node3.reloadable);
    if (!validReach(state, actor, target2, offTemplate, ammo, actor.offHand)) return;
    const profile = targetProfile(state, actor, target2, target2, offTemplate, { weapon: { ...weapon.offHand, ammo, stance: "dual_wield" } });
    profile.disadvantages = primaryRating?.multiplier >= 1.3 ? 0 : Math.max(1, profile.disadvantages ?? 0);
    profile.bonusDice = 0;
    record(state, actor, "followup", `${actor.name}\u4F7F\u7528${offTemplate.name}\u8FFD\u51FB${target2.name}`, { targetId: target2.id, cost, weaponId: weapon.offHand.instance?.id ?? null });
    setResourceTotal(state, actor, "sp", actor.sp - cost, actor.id, "\u526F\u624B\u8FFD\u51FB");
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
  function effectSaved(state, actor, target2, effect, sourceName2) {
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
    record(state, actor, "save", `${target2.name}${saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}\u8C41\u514D`, { targetId: target2.id, sourceName: sourceName2, ...detail });
    return saved;
  }
  function removeStatus(state, actor, target2, effect) {
    const removed = [];
    for (const status2 of values2(target2.statuses)) {
      const categoryMatches = effect.category === "all_negative" ? ["control", "dot", "debuff"].includes(status2.category) : status2.category === effect.category;
      if (effect.statusId ? effect.statusId !== status2.id : !categoryMatches || status2.durationType === "persistent") continue;
      delete target2.statuses[status2.id];
      removed.push(status2.id);
      record(state, actor, "expire", `${target2.name}\u7684${status2.name}\u88AB\u89E3\u9664`, { targetId: target2.id, statusId: status2.id });
    }
    if (effect.category) record(state, actor, "cleanse", `${target2.name}\u53D7\u5230\u51C0\u5316`, { targetId: target2.id, removed });
    return removed.length > 0;
  }
  function teleportBehind(state, actor, target2) {
    const to = backCell(state, target2);
    if (!to || changes(actor, "rooted")) return false;
    const from = pointAt(state, actor);
    Object.assign(actor, to);
    record(state, actor, "teleport", `${actor.name}\u77AC\u79FB\u81F3\u76EE\u6807\u80CC\u540E`, { from, to: pointAt(state, actor) });
    return true;
  }
  var castPower = (state, actor, template) => template.power ?? template.attack ?? Math.max(0, effectiveStat(state, actor, template.damage?.stat ?? "int") * 10);
  var castSkillScale = (state, actor, template, target2) => Math.max(
    0,
    dsl.stat(state, actor, "skillPower", 1, { target: target2, school: template.school, actionType: "skill" })
  );
  function applyStrike(state, actor, action, plan, opportunityWeapon = null, castUses) {
    const weapon = opportunityWeapon ?? (action.type === "attack" ? weaponInfo(state, actor) : null);
    const template = action.type === "shield_bash" ? { name: "\u76FE\u51FB", range: 1, damage: { count: 1, sides: 4, stat: "str", type: "physical" }, effects: shieldBashEffects } : weapon ? weapon.template : tableEntry(state.skills, action.skillId) ?? new Map(equippedActiveSkills(state, actor)).get(action.skillId);
    const skillEntries = template.entry ? [template.entry] : skillExpressions(weapon ? null : template, action.skillId);
    const mainTarget = state.units[plan.corpseId ?? plan.targets.find((t) => t.kind !== "cover")?.id];
    const multipliers = [];
    const skillScale = action.type === "skill" ? castSkillScale(state, actor, template, mainTarget) : 1;
    const effectContext = {
      target: mainTarget,
      center: plan.center,
      terrainTarget: template.target === "cell" ? locateUnit(state, plan.center) ?? plan.center : null,
      actionType: action.type,
      school: template.school,
      multipliers,
      skillScale,
      entries: skillEntries,
      castUses,
      weaponId: weapon?.instance?.id ?? template.entry?.instance?.id,
      resourceCost: template.resourceCost?.amount,
      opportunityAttack: Boolean(opportunityWeapon),
      melee: plan.targets[0]?.melee,
      arrow: Boolean(weapon?.ammo),
      ...action.type === "skill" && template.shape !== "single" ? { skillArea: new Set(plan.targets.map((target2) => target2.id)) } : {},
      damageType: template.damage?.type ?? template.damageType,
      power: castPower(state, actor, template),
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
    if (plan.hostile && !weapon && action.type !== "shield_bash") expireStatuses(state, actor, "on_attack", { sourceUnitId: actor.id });
    if (!sameCell(actor, plan.center)) actor.facing = facingToward(actor, plan.center);
    if (weapon || action.type === "shield_bash") dispatchEffect(state, actor, "on_attack", effectContext);
    for (const preview2 of plan.targets) {
      if (!alive(actor)) break;
      const cover = preview2.kind === "cover";
      const target2 = (cover ? state.covers : state.units)[preview2.id];
      if (!alive(target2) || target2.fled) continue;
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
    const from = pointAt(state, actor), path = [];
    const canContinue = () => alive(actor) && !actor.fled && !changes(actor, "skip") && !changes(actor, "rooted");
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
            `${unit.name}\u5BF9${actor.name}\u53D1\u52A8\u501F\u673A\u653B\u51FB\uFF08${weapon.template.name}\uFF09`,
            { ...opportunityDetail(unit, center, to2), targetId: actor.id }
          );
          const profile = targetProfile(state, unit, actor, actor, weapon.template, { weapon });
          applyStrike(state, unit, { type: "attack" }, { center, targets: [profile], hostile: true }, weapon);
          if (!canContinue()) break;
        }
      }
      if (!canContinue() || !canStep(state, actor, to2)) break;
      actor.facing = facingToward(actor, to2);
      Object.assign(actor, pos(to2.x, to2.y));
      path.push(to2);
    }
    const to = pointAt(state, actor), interrupted = path.length !== plan.path.length;
    record(
      state,
      actor,
      type,
      `${actor.name}${movementNames[type]}${interrupted ? "\u53D7\u963B\uFF0C\u505C\u5728" : "\u81F3"} (${to.x}, ${to.y}, z=${to.z})`,
      { from, to, path, steps: path.length, interrupted }
    );
  }
  function applyInteraction(state, actor, plan) {
    const item = state.interactives[plan.interactiveId];
    item.spent = true;
    if (!sameCell(actor, item)) actor.facing = facingToward(actor, item);
    record(state, actor, "interact", `${actor.name}${item.kind === "barrel" ? "\u5F15\u7206" : "\u6FC0\u6D3B"}${item.name}`, { interactiveId: item.id });
    const effect = item.effect ?? (item.kind === "barrel" ? "explode" : "heal");
    if (effect === "explode") {
      expireStatuses(state, actor, "on_attack", { sourceUnitId: actor.id });
      const weapon = weaponInfo(state, actor);
      if (weapon.ammo && !weapon.infiniteAmmo) dsl.changeResource(state, actor, actor, { kind: "drainResource", resource: weapon.ammo.resource, local: true }, 1, "\u5F15\u7206", { instance: weapon.instance });
      for (const profile of plan.targets) {
        const target2 = state.units[profile.id];
        if (alive(target2)) damageTarget(state, target2, actor.id, item.damage ?? 12, "energy", item.name, { attacker: actor, hit: true, direct: false });
      }
      for (const cover of values2(state.covers).filter((c) => c.hp > 0 && plan.cells.some((at) => sameCell(at, c))).sort(byId2)) {
        coverDamage(state, actor, cover, item.damage ?? 12, { interactiveId: item.id });
      }
    } else if (Object.hasOwn(item, "effect") && (effect === "restore" || effect === "heal")) {
      const amount2 = item.damage ?? 8;
      restoreHP(state, actor, amount2, actor.id, item.name);
      if (effect === "restore") {
        setResourceTotal(state, actor, "mp", Math.min(actor.maxMp, actor.mp + amount2), actor.id, item.name);
        setResourceTotal(state, actor, "sp", Math.min(actor.maxSp, actor.sp + amount2), actor.id, item.name);
      }
    } else if (Object.hasOwn(item, "effect") && effect === "shield") {
      grantShield(state, actor, item.damage ?? 10, { sourceUnitId: actor.id });
    } else {
      const amount2 = item.damage ?? 8;
      restoreHP(state, actor, amount2, actor.id, item.name);
      grantShield(state, actor, 10, { sourceUnitId: actor.id });
      grantStatus(state, actor, actionStatuses.altar, { sourceUnitId: actor.id });
    }
  }
  function applyAction(state, action) {
    const plan = preview(state, action);
    if (!plan.ok) {
      if (plan.error === insufficientHP) {
        record(state, currentUnit(state), "skill_rejected", insufficientHP, { skillId: action.skillId });
        return state.logs.slice(-1);
      }
      throw new Error(plan.error);
    }
    const { type, x, y, skillId } = action;
    if (needsTarget(type) && x === void 0) throw new Error("\u7F3A\u5C11\u76EE\u6807\u5750\u6807");
    const actor = currentUnit(state);
    const before = state.logs.length;
    const moving = ["move", "sprint", "disengage"].includes(type);
    const initialCover = moving ? new Set(nearbyCovers(state, actor).map((c) => c.id)) : null;
    let castUses;
    if (type === "skill") {
      const skill2 = tableEntry(state.skills, skillId) ?? new Map(equippedActiveSkills(state, actor)).get(skillId);
      const limits = castLimits(skill2, skillId);
      castUses = new Set(limits.map((entry) => entry.key));
      for (const entry of limits) dsl.spendUse(state, actor, entry);
    }
    if (type !== "end") {
      actor.ap -= plan.ap;
      const costSource = plan.name ?? movementNames[type] ?? type;
      if (plan.mp) setResourceTotal(state, actor, "mp", actor.mp - plan.mp, actor.id, costSource);
      if (plan.sp) setResourceTotal(state, actor, "sp", actor.sp - plan.sp, actor.id, costSource);
      if (type === "skill") {
        const skill2 = tableEntry(state.skills, skillId);
        if (skill2?.backpackItem) {
          const before2 = actor.inventory[skillId];
          actor.inventory[skillId] = before2 - 1;
          record(state, actor, "item_spent", `${actor.name}\u6D88\u8017${skill2.name}\uFF08\u6570\u91CF ${before2} \u2192 ${before2 - 1}\uFF09`, { itemId: skillId, before: before2, after: before2 - 1 });
        }
        if (plan.hp) {
          const hpBefore = actor.hp;
          actor.hp -= plan.hp;
          record(
            state,
            actor,
            "skill_cost",
            `\u65BD\u653E ${skill2.name} \u6D88\u8017 ${plan.hp} HP`,
            { skillId, hp: plan.hp, remainingHP: actor.hp, hpBefore, hpAfter: actor.hp }
          );
        }
        if (skill2?.resourceCost?.resource) {
          const { resource: resource3, amount: cost } = skill2.resourceCost;
          const { item, effect, amount: amount2 } = resourcePool(state, actor, resource3);
          changeCounter(state, actor, item, effect, resource3, amount2 - cost);
        }
      }
      if (plan.ap === 2) {
        actor.used.attack++;
        actor.used.action++;
      } else if (plan.slot) actor.used[plan.slot]++;
      const actionIntent = ["attack", "skill"].includes(type) && plan.intent && plan.intent !== "normal" && plan.shape === "single" ? plan.intent : "normal";
      const targetId = plan.targets?.find((target2) => target2.kind !== "cover")?.id ?? null;
      const intentNames = { function: "\u673A\u80FD\u9650\u5236", core: "\u6838\u5FC3\u8981\u5BB3", kill: "\u62B9\u6740", concept: "\u6982\u5FF5\u7834\u788E" };
      const actionLabel = plan.name ?? (movementNames[type] ?? { reload: "\u88C5\u586B", brace: "\u4F9D\u6258\u9632\u5FA1", interact: "\u4E92\u52A8" }[type]);
      const strike = ["attack", "skill", "shield_bash"].includes(type) && !plan.interactiveId;
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
          ...strike ? {
            attackSource: type === "shield_bash" ? `${equipmentFor(state, actor.shield).template?.name ?? "\u76FE\u724C"}\u76FE\u51FB` : actionLabel,
            attackTargets: (plan.targets ?? []).map((t) => t.kind === "cover" ? { cover: t.name } : { unit: t.id }),
            ...plan.corpseId ? { corpseId: plan.corpseId } : {}
          } : {},
          ap: plan.ap,
          mp: plan.mp,
          sp: plan.sp,
          remainingAP: actor.ap
        }
      );
    }
    if (type === "skill" && plan.hp) retireFromContest(state, actor);
    if (!actor.fled) switch (type) {
      case "move":
      case "sprint":
      case "disengage":
        applyMovement(state, actor, type, plan);
        break;
      case "attack":
        if (plan.interactiveId) {
          applyInteraction(state, actor, plan);
          break;
        }
      case "skill":
      case "shield_bash":
        applyStrike(state, actor, { type, skillId }, plan, null, castUses);
        break;
      case "end_encounter": {
        concludeObjective(state, state.battleType === "spar" ? "draw" : actor.team === "blue" ? "red" : "blue", state.battleType === "spar" ? "\u53CC\u65B9\u70B9\u5230\u4E3A\u6B62" : `${actor.name}\u4EE3\u8868\u672C\u961F\u8BA4\u8F93`);
        break;
      }
      case "switch_weapon": {
        const old = actor.mainHand ?? actor.weapon;
        const fromOff = plan.itemId === actor.offHand;
        if (fromOff) actor.offHand = old;
        else if (actor.bagWeapons?.includes(plan.itemId)) actor.bagWeapons.splice(actor.bagWeapons.indexOf(plan.itemId), 1, ...old ? [old] : []);
        else actor.gear[actor.gear.indexOf(plan.itemId)] = old;
        actor.mainHand = actor.weapon = plan.itemId;
        actor.stance = stanceFor({ mainHand: equipmentFor(state, plan.itemId).template, offHand: equipmentFor(state, actor.offHand).template, shield: equipmentFor(state, actor.shield).template });
        if (actor.stance === "attunement" && !actor.attunementCharges) actor.stance = "light_blade";
        if (!fromOff) dispatchEffect(state, actor, "on_equip", { equippedItemId: plan.itemId, weaponId: plan.itemId });
        break;
      }
      case "use_item": {
        actor.attunementCharges = Math.max(0, (actor.attunementCharges ?? 2) - 1);
        record(state, actor, "item", `${actor.name}\u4F7F\u7528\u540C\u8C03\u526F\u624B\u9053\u5177`, { itemId: plan.itemId, remaining: actor.attunementCharges });
        grantStatus(state, actor, actionStatuses.use_item, { sourceUnitId: actor.id });
        if (!actor.attunementCharges) actor.stance = "light_blade";
        break;
      }
      case "charge":
        grantStatus(state, actor, actionStatuses.charge, { sourceUnitId: actor.id });
        break;
      case "lock_on":
        actor.lockedTargetId = plan.targetId;
        grantStatus(state, actor, actionStatuses.lock_on, { sourceUnitId: actor.id });
        record(state, actor, "maneuver", `${actor.name}\u9501\u5B9A${state.units[plan.targetId].name}`, { targetId: plan.targetId });
        break;
      case "scan":
        grantStatus(state, actor, actionStatuses.scan, { sourceUnitId: actor.id, stacks: 3 });
        break;
      case "flee": {
        const enemies = living(state).filter((u) => u.team !== actor.team).sort((a, b) => effectiveStat(state, b, "agi") - effectiveStat(state, a, "agi") || byId2(a, b));
        const target2 = enemies[0];
        const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
        const success = target2 ? effectiveStat(state, actor, "agi") + attackerRoll >= effectiveStat(state, target2, "agi") + defenderRoll : true;
        record(state, actor, "flee", `${actor.name}${success ? "\u9003\u8DD1\u6210\u529F" : "\u9003\u8DD1\u5931\u8D25"}`, { targetId: target2?.id ?? null, attackerRoll, defenderRoll, success });
        if (success) {
          actor.fled = true;
          actor.ap = 0;
        }
        break;
      }
      case "detour":
        record(state, actor, "maneuver", `${actor.name}\u9009\u62E9\u7ED5\u884C`, { maneuver: "detour" });
        break;
      case "free_ally": {
        const ally = state.units[plan.targetId];
        delete ally.statuses.suppressed;
        record(state, actor, "free_ally", `${actor.name}\u4E3A${ally.name}\u89E3\u9664\u538B\u5236`, { targetId: ally.id });
        break;
      }
      case "suppress": {
        const target2 = state.units[plan.targetId];
        record(state, actor, "suppress_attack", `${actor.name}\u5C1D\u8BD5\u538B\u5236${target2.name}`, { targetId: target2.id });
        if (!resolveCheck(state, actor, plan.targets[0]).hit) break;
        const attackerRoll = randomDie(state, 20), defenderRoll = randomDie(state, 20);
        const attackerTotal = attackerRoll + effectiveStat(state, actor, "str"), defenderTotal = defenderRoll + effectiveStat(state, target2, "str");
        const success = attackerTotal > defenderTotal;
        record(state, actor, "suppress_check", `${actor.name}\u5BF9${target2.name}\u529B\u91CF\u5BF9\u6297${success ? "\u6210\u529F" : "\u5931\u8D25"}\uFF08${attackerTotal} \u5BF9 ${defenderTotal}\uFF09`, { targetId: target2.id, attackerRoll, defenderRoll, attackerTotal, defenderTotal, success });
        if (success) grantStatus(state, target2, "suppressed", { sourceUnitId: actor.id }).holdTotal = attackerTotal;
        else if (defenderTotal > attackerTotal) grantStatus(state, actor, "stun", { sourceUnitId: target2.id, turns: 1 });
        break;
      }
      case "grapple":
      case "disarm":
      case "trip":
      case "push": {
        const target2 = state.units[plan.targetId];
        if (target2 && maneuverContest(state, actor, target2, type)) {
          if (type === "grapple") grantStatus(state, target2, actionStatuses.grapple, { sourceUnitId: actor.id });
          if (type === "disarm") {
            target2.mainHand = null;
            target2.weapon = null;
          }
          if (type === "trip") grantStatus(state, target2, actionStatuses.trip, { sourceUnitId: actor.id });
          if (type === "push") knockback(state, actor, target2, { distance: 1, collisionDamage: 3 });
        }
        break;
      }
      case "block":
        actor.blockMode = action.maneuver === "heavy" ? "heavy" : "normal";
        grantStatus(state, actor, actionStatuses.block, {
          sourceUnitId: actor.id,
          turns: 1,
          ...Object.hasOwn(getStatusTemplate(state, actionStatuses.block).modifiers, "reduction") && { modifiers: { reduction: plan.reduction } }
        });
        record(state, actor, "block", `${actor.name}${actor.blockMode === "heavy" ? "\u91CD" : ""}\u683C\u6321`, { reduction: plan.reduction });
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
          `${actor.name}${plan.coverId ? `\u501F ${plan.coverId} ` : "\u539F\u5730"}\u67B6\u52BF\u9632\u5FA1\uFF08\u51CF\u4F24 ${Math.round(plan.reduction * 100)}%\uFF0C${plan.turns} \u56DE\u5408\uFF09`,
          { coverId: plan.coverId, reduction: plan.reduction, turns: plan.turns }
        );
        grantStatus(state, actor, actionStatuses.brace, { sourceUnitId: actor.id, turns: plan.turns });
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
      if (!actor.fled) endTurn(state, actor);
      if (!refreshOutcome(state)) {
        advanceCursor(state);
        settleTurn(state);
      }
    }
    return state.logs.slice(before);
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

  // src/core/resource_names.js
  var BUILTIN_RESOURCES = Object.freeze(["hp", "mp", "sp", "ap", "action", "attack"]);
  var RESOURCE_NAMES = Object.freeze({
    hp: "\u751F\u547D",
    mp: "\u6CD5\u529B",
    sp: "\u4F53\u529B",
    ap: "\u884C\u52A8\u70B9",
    action: "\u52A8\u4F5C",
    attack: "\u653B\u51FB",
    souls: "\u9B42\u6570",
    ammo: "\u5F39\u836F"
  });
  var resourceLabel = (name) => Object.hasOwn(RESOURCE_NAMES, name) ? RESOURCE_NAMES[name] : name;

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
  var coord2 = (v) => int(v, 0, 9);
  var attrs2 = ["str", "agi", "con", "int", "spi"];
  var statusDurations = ["battle_turns", "until_removed", "persistent"];
  var statusTickTimings = ["onTurnStart", "onTurnEnd"];
  var statusStackRules = ["refresh", "stack", "replace"];
  var statusLabels = ["name", "icon", "category", "description"];
  var maxStatusTemplates = 64;
  var has = (record2, key4) => id2(key4) && own2(record2, key4);
  function fields(v, required, optional = []) {
    requireThat(plain(v) && required.every((k) => own2(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), required.join("/") || "\u5BF9\u8C61\u952E");
  }
  function checkOptional(o, key4, check) {
    if (own2(o, key4)) requireThat(check(o[key4]), key4);
  }
  function table2(v, test, max = 200) {
    requireThat(plain(v) && Object.keys(v).length <= max, "\u5B9E\u4F53\u8868");
    for (const [k, value] of Object.entries(v)) {
      requireThat(id2(k), "\u5B9E\u4F53 ID");
      test(value, k);
    }
  }
  function list(v, max, check, key4) {
    requireThat(Array.isArray(v) && v.length <= max && Array.from(v).every(check), key4);
  }
  function dice2(v) {
    fields(v, ["count", "sides"], ["bonus", "stat", "multiplier", "type"]);
    requireThat(int(v.count, 0, 1e6) && int(v.sides, 0, 1e6) && (v.count === 0 || v.sides >= 1), "\u4F24\u5BB3\u9AB0");
    checkOptional(v, "bonus", (x) => int(x, -1e9, 1e9));
    checkOptional(v, "stat", (x) => attrs2.includes(x));
    checkOptional(v, "multiplier", (x) => num(x, 0, 8));
    checkOptional(v, "type", (x) => damageTypes.includes(x));
  }
  function statusLifetime(v) {
    return int(v.remainingTurns, 1, 100) && statusDurations.includes(v.durationType) && statusTickTimings.includes(v.tickTiming) && statusStackRules.includes(v.stackRule);
  }
  function statusTemplate(v, key4 = v?.id) {
    fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers"], ["expireInto", "expireOn"]);
    checkOptional(v, "expireInto", id2);
    checkOptional(v, "expireOn", validExpireOn);
    requireThat(id2(key4) && v.id === key4, "\u81EA\u5B9A\u4E49\u72B6\u6001 ID");
    requireThat(text(v.name) && text(v.icon, 24) && text(v.description, 300) && ["buff", "debuff", "control", "dot", "hot", "shield"].includes(v.category), "\u72B6\u6001\u540D/\u56FE\u6807/\u63CF\u8FF0/\u7C7B\u522B");
    requireThat(statusLifetime(v) && int(v.maxStacks, 1, 10), "\u72B6\u6001\u65F6\u957F/\u5C42\u6570");
    requireThat(plain(v.modifiers) && Object.keys(v.modifiers).length > 0 && (!own2(v.modifiers, "damageType") || own2(v.modifiers, "damage")), "\u72B6\u6001\u7279\u6548");
    validateStatusModifiers(v, v.modifiers);
    requireThat(key4 !== actionStatuses.shield || own2(v.modifiers, "amount"), "\u9ED8\u8BA4\u62A4\u76FE\u6A21\u677F\u9700\u8981 amount");
  }
  function statusTemplateTable(v) {
    table2(v, statusTemplate, maxStatusTemplates);
    for (const t of Object.values(v)) if (t.expireInto) {
      const next = getStatusTemplate({ statusTemplates: v }, t.expireInto);
      requireThat(t.durationType === "battle_turns" && t.remainingTurns === 1 && t.expireInto !== t.id && next && !next.expireInto, "\u72B6\u6001\u5230\u671F\u76EE\u6807");
    }
  }
  function defineStatus(state, key4, template) {
    requireThat(plain(template) && (!own2(template, "id") || template.id === key4), "\u81EA\u5B9A\u4E49\u72B6\u6001 ID");
    const definition = { ...template, id: key4 };
    statusTemplate(definition, key4);
    requireThat(!own2(state.statusTemplates ?? {}, key4), "\u81EA\u5B9A\u4E49\u72B6\u6001 ID \u5DF2\u5B58\u5728");
    requireThat(Object.keys(state.statusTemplates ?? {}).length < maxStatusTemplates, "\u81EA\u5B9A\u4E49\u72B6\u6001\u6A21\u677F\u6570\u91CF");
    (state.statusTemplates ??= {})[key4] = structuredClone(definition);
    return structuredClone(definition);
  }
  var resourceCost = (x) => plain(x) && (Object.keys(x).length === 2 && id2(x.resource) && int(x.amount, 1, 1e6) || Object.keys(x).length > 0 && Object.entries(x).every(([key4, amount2]) => ["hp", "mp", "sp"].includes(key4) && int(amount2, 0, 25e3)));
  function validateEffect(e, state) {
    requireThat(isExpression(e) && validExpression(e), "DSL expression");
    if (Array.isArray(e.roll?.save)) requireThat(e.roll.mode && new Set(e.roll.save).size === e.roll.save.length, "DSL save mode");
    else requireThat(!e.roll?.mode, "DSL save mode");
    for (const node3 of effectNodes(e.effects)) {
      if (node3.kind === "spawnUnit" && state) {
        const skills = node3.skills ?? [];
        requireThat(skills.every((k) => has(state.skills, k)) && new Set(skills).size === skills.length, "spawnUnit \u6280\u80FD\u5F15\u7528");
        for (const [slot, ids] of [["hand", [node3.mainHand, node3.offHand]], ["shield", [node3.shield]], ["gear", node3.gear ?? []]]) {
          for (const k of ids.filter(Boolean)) {
            requireThat(has(state.equipment, k), "spawnUnit \u88C5\u5907\u6A21\u677F\u5F15\u7528");
            const t = state.equipment[k];
            requireThat(slot === "shield" ? t.kind === "shield" : slot === "gear" ? ["armor", "accessory", "consumable"].includes(t.kind) : t.kind === "consumable" || (!t.kind || t.kind === "weapon") && !!t.damage, "spawnUnit \u88C5\u5907\u69FD");
          }
        }
      }
      if (node3.kind === "removeStatus") requireThat(Boolean(node3.statusId) !== Boolean(node3.category), "DSL removeStatus selector");
      if (node3.statusId) {
        const template = getStatusTemplate(state, node3.statusId);
        requireThat(template, `DSL status ${node3.statusId}`);
        if (node3.modifiers) validateStatusModifiers(template, node3.modifiers);
        if (node3.stacks && (!has(STATUSES, node3.statusId) || has(state?.statusTemplates ?? {}, node3.statusId))) requireThat(node3.stacks <= template.maxStacks, "DSL status stacks");
        if (node3.amount != null) requireThat(own2(template.modifiers, "amount") && int(node3.amount, 1, 1e4), "DSL status amount");
      }
      if (node3.local && ["produceResource", "restoreResource", "drainResource"].includes(node3.kind)) {
        requireThat(!BUILTIN_RESOURCES.includes(node3.resource), `DSL \u5B9E\u4F8B\u8BA1\u6570\u5668\u4E0D\u80FD\u4F7F\u7528\u5185\u7F6E\u8D44\u6E90 ${node3.resource}`);
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
    fields(v, ["name", "ap", "slot", "range", "shape", "target", "effects"], ["quality", "power", "mp", "sp", "radius", "width", "accuracy", "save", "saveDC", "damage", "heal", "resourceCost", "school", "damageType", "backpackItem"]);
    checkOptional(v, "backpackItem", (flag) => flag === true && v.ap === 1 && v.slot === "action");
    checkOptional(v, "damageType", (type) => damageTypes.includes(type));
    checkOptional(v, "school", text);
    checkOptional(v, "resourceCost", resourceCost);
    requireThat(text(v.name) && int(v.ap, 1, 2) && ["attack", "action"].includes(v.slot) && int(v.range, 0, 15) && ["single", "circle", "fan", "cone", "line"].includes(v.shape) && ["enemy", "ally", "self", "any", "corpse", "cell"].includes(v.target), "\u6280\u80FD");
    checkOptional(v, "power", (x) => int(x, 0, 1e9));
    for (const k of ["mp", "sp"]) checkOptional(v, k, (x) => int(x, 0, 25e3));
    for (const k of ["radius", "width"]) checkOptional(v, k, (x) => int(x, 0, 6));
    checkOptional(v, "accuracy", (x) => int(x, -20, 30));
    checkOptional(v, "save", (x) => attrs2.includes(x));
    checkOptional(v, "saveDC", validSaveDC);
    requireThat(own2(v, "save") === own2(v, "saveDC"), "save/saveDC");
    for (const k of ["damage", "heal"]) if (own2(v, k)) dice2(v[k]);
    effects(v.effects, state);
  }
  function statusValue(v, key4, state) {
    const t = getStatusTemplate(state, key4);
    requireThat(id2(key4) && t, "\u72B6\u6001 ID");
    fields(v, ["id", ...statusLabels, "remainingTurns", "durationType", "tickTiming", "stackRule", "maxStacks", "modifiers", "stacks", "sourceUnitId"], ["appliedRound", "appliedTurn", "amount", "expireInto", "expireOn", "holdTotal"]);
    checkOptional(v, "holdTotal", (x) => v.id === "suppressed" && Number.isFinite(x));
    checkOptional(v, "expireOn", (x) => x === null || validExpireOn(x));
    requireThat(v.expireInto === t.expireInto, "\u72B6\u6001\u5230\u671F\u76EE\u6807");
    requireThat(v.id === key4 && statusLabels.every((k) => v[k] === t[k]) && statusLifetime(v) && int(v.maxStacks, 1, t.maxStacks) && int(v.stacks, 1, v.maxStacks) && (v.sourceUnitId === null || id2(v.sourceUnitId)), "\u72B6\u6001\u5B9E\u4F8B");
    fields(v.modifiers, Object.keys(t.modifiers));
    validateStatusModifiers(t, v.modifiers);
    checkOptional(v, "appliedRound", (x) => int(x, 1, 1e6));
    checkOptional(v, "appliedTurn", (x) => int(x, 0, 199));
    requireThat(own2(t.modifiers, "amount") ? int(v.amount, 1, 1e9) : !own2(v, "amount"), "\u62A4\u76FE\u6C60");
  }
  function validateCell(v) {
    fields(v, ["kind", "z"]);
    requireThat(["floor", "slope", "wall"].includes(v.kind) && int(v.z, -4, 8), "\u5730\u5F62");
  }
  var unitKeys = ["id", "name", "team", "x", "y", "facing", "hp", "maxHp", "mp", "maxMp", "sp", "maxSp", "ap", "used", "stats", "armor", "size", "move", "weapon", "gear", "skills", "statuses"];
  var protocolUnitKeys = ["mainHand", "offHand", "shield", "bodyLengthM", "tier", "mc", "nonLethal", "intent", "bonusDice", "penaltyDice", "stance", "protagonist", "moraleType", "moraleState", "greatswordMode", "parryQuota", "parryRefunded", "attunementCharges", "blockMode", "initiativePercent", "attackInit", "actionInit", "flatInitiative", "lockedTargetId", "deathrattle", "deathrattleTriggered", "moraleCheckedRound", "maneuvers"];
  function unitValue(v, key4, state) {
    fields(v, unitKeys, ["reactionAvailable", ...protocolUnitKeys, "fled", "diedAt", "corpseOf", "corpseConsumed", "creatureType", "tags", "resources", "inventory", "bagWeapons", "effectUsage", "effectModifiers", "altitude"]);
    if (own2(v, "altitude")) requireThat(int(v.altitude, 0, 12), "\u79BB\u5730\u9AD8\u5EA6");
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
    requireThat(v.id === key4 && text(v.name) && team(v.team) && coord2(v.x) && coord2(v.y), "\u68CB\u5B50");
    list(v.facing, 2, (x) => int(x, -1, 1), "\u671D\u5411");
    requireThat(v.facing.length === 2 && v.facing.some(Boolean), "\u671D\u5411");
    for (const [r, max] of [["hp", "maxHp"], ["mp", "maxMp"], ["sp", "maxSp"]]) requireThat(int(v[max], r === "hp" ? 1 : 0, 1e9) && int(v[r], 0, v[max]), r);
    fields(v.used, ["action", "attack"]);
    fields(v.stats, attrs2);
    requireThat(attrs2.every((k) => int(v.stats[k], -20, 50)) && int(v.ap, 0, 2) && int(v.used.action, 0, 2) && int(v.used.attack, 0, 2) && int(v.armor, 0, 1e6) && int(v.size, 1, 5) && int(v.move, 1, 10), "\u5355\u4F4D\u6570\u503C");
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
    checkOptional(v, "protagonist", (x) => x === true);
    checkOptional(v, "moraleType", (x) => typeof x === "string" && Object.hasOwn(MORALE, x));
    checkOptional(v, "moraleState", (x) => typeof x === "string" && Object.hasOwn(moraleLabels, x));
    checkOptional(v, "greatswordMode", (x) => ["offensive", "defensive"].includes(x));
    checkOptional(v, "parryQuota", (x) => int(x, 0, 2));
    checkOptional(v, "parryRefunded", (x) => typeof x === "boolean");
    checkOptional(v, "attunementCharges", (x) => int(x, 0, 2));
    checkOptional(v, "blockMode", (x) => ["normal", "heavy"].includes(x));
    if (own2(v, "bagWeapons")) list(v.bagWeapons, 200, id2, "\u80CC\u5305\u6B66\u5668");
    list(v.gear, 12, id2, "gear");
    list(v.skills, 32, id2, "skills");
    table2(v.statuses, (status2, statusId2) => statusValue(status2, statusId2, state), maxStatusTemplates + Object.keys(STATUSES).length);
  }
  function jsonTree(v, depth = 0) {
    if (depth > 12) return false;
    if (v === null || ["string", "boolean"].includes(typeof v) || Number.isFinite(v)) return true;
    if (Array.isArray(v)) return v.length <= 500 && Array.from(v).every((x) => jsonTree(x, depth + 1));
    return plain(v) && Object.keys(v).length <= 250 && Object.entries(v).every(([key4, x]) => !own2(Object.prototype, key4) && jsonTree(x, depth + 1));
  }
  function validateState(s) {
    fields(s, ["scenarioId", "title", "mode", "ruleset", "round", "turn", "order", "units", "items", "equipment", "skills", "grid", "covers", "interactives", "rng", "logs", "outcome"], ["statusTemplates", "zones", "time", "effectTemplates", "summonTemplates", "terrainPatches", "battleType", "battleConclusion", "suppressingTeam"]);
    requireThat(s.battleType === "suppress" ? ["blue", "red"].includes(s.suppressingTeam) : s.suppressingTeam === void 0, "\u538B\u5236\u65B9");
    checkOptional(s, "battleType", (x) => typeof x === "string" && Object.hasOwn(MORALE, x));
    checkOptional(s, "battleConclusion", (x) => typeof x === "string" && x.trim().length > 0 && s.outcome != null);
    if (own2(s, "time")) {
      fields(s.time, ["raw", "hour", "minute", "timeOfDay", "calendar"]);
      requireThat(text(s.time.raw, 500) && typeof s.time.calendar === "string" && s.time.calendar.length <= 500 && int(s.time.hour, 0, 23) && int(s.time.minute, 0, 59) && s.time.timeOfDay === timeOfDay(s.time.hour, s.time.minute), "time");
    }
    if (own2(s, "effectTemplates")) table2(s.effectTemplates, (e, key4) => {
      requireThat(isExpression(e) && e.id === key4, "effectTemplates");
      validateEffect(e, s);
    });
    if (own2(s, "summonTemplates")) table2(s.summonTemplates, (u, key4) => {
      unitValue(u, key4, s);
      requireThat(u.skills.every((skill2) => has(s.skills, skill2)), "summon skills");
    });
    if (own2(s, "statusTemplates")) statusTemplateTable(s.statusTemplates);
    requireThat(id2(s.scenarioId) && text(s.title) && s.mode === "split" && ["protocol", "sandbox"].includes(s.ruleset) && int(s.round, 1, 1e6) && int(s.rng, 0, 4294967295) && [null, "blue", "red", "draw"].includes(s.outcome), "\u6218\u5C40");
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
      fields(v, ["id", "name", "x", "y", "material", "hp", "maxHp", "cover"], ["z"]);
      requireThat(!own2(v, "z") || int(v.z, -4, 8), "\u63A9\u4F53\u9AD8\u5EA6");
      requireThat(v.id === k && text(v.name) && text(v.material) && coord2(v.x) && coord2(v.y) && s.grid[v.y][v.x].kind !== "wall" && int(v.maxHp, 1, 1e9) && int(v.hp, 0, v.maxHp) && int(v.cover, 0, 12), "\u63A9\u4F53");
    });
    table2(s.zones ?? {}, (v, k) => {
      fields(v, ["id", "name", "x", "y", "radius", "remainingTurns", "damage", "damageType", "team"]);
      requireThat(v.id === k && text(v.name) && coord2(v.x) && coord2(v.y) && int(v.radius, 0, 10) && int(v.remainingTurns, 1, 100) && int(v.damage, 0, 1e9) && ["physical", "energy", "mental", "true"].includes(v.damageType) && ["blue", "red", "all"].includes(v.team), "\u6301\u7EED\u533A\u57DF");
    }, 64);
    table2(s.terrainPatches ?? {}, (v, k) => {
      fields(v, ["id", "name", "node", "remainingTurns", "persistent", "patch", "covers"], ["anchorUnitId", "center"]);
      requireThat(v.id === k && text(v.name) && validTerrainNode(v.node) && int(v.remainingTurns, 0, 100) && typeof v.persistent === "boolean", "\u5730\u5F62\u6548\u679C");
      const point2 = (p) => coord2(p.x) && coord2(p.y);
      if (v.node.area.follow) {
        requireThat(id2(v.anchorUnitId), "\u5730\u5F62\u951A\u70B9");
        fields(v.center, ["x", "y"]);
        requireThat(point2(v.center), "\u5730\u5F62\u5706\u5FC3");
      } else requireThat(!own2(v, "anchorUnitId") && !own2(v, "center"), "\u5730\u5F62\u951A\u70B9");
      list(v.patch, 100, (p) => {
        fields(p, ["x", "y", "before", "after"]);
        validateCell(p.before);
        validateCell(p.after);
        return point2(p);
      }, "\u5730\u5F62\u53D8\u66F4");
      list(v.covers, 100, (p) => {
        fields(p, ["id", "x", "y", "before"]);
        return id2(p.id) && p.id === `${k}-${p.x}-${p.y}` && point2(p) && p.before === null;
      }, "\u4E34\u65F6\u63A9\u4F53");
    }, 64);
    table2(s.interactives, (v, k) => {
      fields(v, ["id", "name", "x", "y", "kind", "spent"], ["z", "effect", "radius", "damage"]);
      requireThat(v.id === k && text(v.name) && coord2(v.x) && coord2(v.y) && (!own2(v, "z") || int(v.z, -4, 8)) && s.grid[v.y][v.x].kind !== "wall" && ["barrel", "altar"].includes(v.kind) && (!own2(v, "effect") || ["explode", "heal", "shield", "restore"].includes(v.effect)) && (!own2(v, "radius") || int(v.radius, 0, 10)) && (!own2(v, "damage") || int(v.damage, 0, 1e5)) && typeof v.spent === "boolean", "\u4E92\u52A8\u70B9");
    });
    const occupied = /* @__PURE__ */ new Set(), equipped2 = /* @__PURE__ */ new Set();
    table2(s.units, (v, k) => {
      unitValue(v, k, s);
      const point2 = `${v.x},${v.y}`;
      if (v.hp > 0 && !v.fled) {
        requireThat(!occupied.has(point2) && s.grid[v.y][v.x].kind !== "wall" && !Object.values(s.covers).some((c) => c.hp > 0 && c.x === v.x && c.y === v.y), "\u68CB\u5B50\u4F4D\u7F6E\u91CD\u53E0\u6216\u963B\u6321");
        occupied.add(point2);
      }
      const slots = [v.weapon, v.mainHand, v.offHand, v.shield, ...v.gear].filter(Boolean);
      for (const i of v.bagWeapons ?? []) {
        const t = s.equipment[s.items[i]?.templateId];
        requireThat(t?.damage && !slots.includes(i) && !equipped2.has(i), "\u80CC\u5305\u6B66\u5668\u5F15\u7528\u6216\u5F52\u5C5E");
        equipped2.add(i);
      }
      for (const i of new Set(slots)) {
        const template = has(s.items, i) ? s.equipment[s.items[i].templateId] : null;
        const weaponSlot = i === v.weapon || i === v.mainHand || i === v.offHand;
        const isShieldSlot = i === v.shield;
        const isDamageItem = Boolean(template && own2(template, "damage"));
        requireThat(has(s.items, i) && !equipped2.has(i) && (weaponSlot ? isDamageItem || template?.kind === "consumable" : isShieldSlot ? template?.kind === "shield" : true), "\u88C5\u5907\u5F15\u7528\u6216\u5F52\u5C5E");
        equipped2.add(i);
      }
      requireThat(v.skills.every((i) => has(s.skills, i)) && new Set(v.skills).size === v.skills.length, "\u6280\u80FD\u5F15\u7528");
      const visited = /* @__PURE__ */ new Set();
      function checkSpawnBudget(expr) {
        if (visited.has(expr.id)) return;
        visited.add(expr.id);
        for (const n of effectNodes(expr.effects)) {
          if (n.kind === "spawnUnit" && n.stats) requireThat(spawnStatsAllowed(v, n), "spawnUnit \u4E94\u7EF4\u9884\u7B97");
          if (n.kind === "procEffect") checkSpawnBudget(byId4.get(n.ref));
        }
      }
      for (const template of [...v.skills.map((id3) => s.skills[id3]), ...[...new Set(slots)].map((id3) => s.equipment[s.items[id3].templateId])])
        template.effects.forEach(checkSpawnBudget);
    });
    list(s.order, 200, (x) => has(s.units, x), "\u5148\u653B\u961F\u5217");
    requireThat(new Set(s.order).size === s.order.length && int(s.turn, 0, Math.max(0, s.order.length - 1)) && Object.values(s.units).every((u) => u.hp <= 0 || s.order.includes(u.id)), "\u5148\u653B\u7D22\u5F15");
    requireThat(Array.isArray(s.logs) && s.logs.length <= 1e5, "\u65E5\u5FD7");
    for (const log of s.logs) {
      fields(log, ["round", "actor", "type", "text", "detail"], ["positions"]);
      requireThat(int(log.round, 1, s.round) && (log.actor === null || id2(log.actor)) && text(log.type, 64) && text(log.text, 1e3) && jsonTree(log.detail) && (!log.positions || plain(log.positions) && Object.values(log.positions).every((point2) => plain(point2) && coord2(point2.x) && coord2(point2.y) && (!own2(point2, "z") || int(point2.z, -4, 20)))), "\u65E5\u5FD7\u4E8B\u4EF6");
    }
    return s;
  }

  // src/presets/scenarios.js
  var SCENARIOS = Object.freeze({
    ruins: { title: "\u5E9F\u589F\u4F0F\u51FB\u6218", description: "\u6298\u65AD\u7684\u77F3\u5899\u6321\u4F4F\u89C6\u7EBF\u3002\u5148\u5904\u7406\u53D7\u4F24\u7684\u65A5\u5019\uFF0C\u8BD5\u7528\u7130\u5370\uFF0C\u518D\u4ECE\u4FA7\u7FFC\u7ED5\u8FC7\u8DEF\u969C\u3002", seed: 17 },
    altar: { title: "\u9AD8\u53F0\u796D\u575B\u593A\u53D6\u6218", description: "\u5761\u9053\u662F\u4E0A\u53F0\u7684\u6377\u5F84\uFF1B\u6FC0\u6D3B\u796D\u575B\u53EF\u83B7\u5F97\u62A4\u76FE\u4E0E\u75BE\u8D70\uFF0C\u9AD8\u53F0\u8FDC\u5C04\u6709\u989D\u5916\u5C04\u7A0B\u3002", seed: 43 },
    boss: { title: "BOSS \u4E0E\u6742\u5175\u6DF7\u7F16\u6218", description: "\u5B88\u95E8\u5DE8\u50CF\u62A4\u7532\u539A\u3001\u4F53\u578B\u5927\u3002\u5148\u62C6\u63F4\u519B\uFF0C\u518D\u7528\u51C0\u5316\u3001\u7A7F\u7532\u548C\u51FB\u9000\u5206\u644A\u538B\u529B\u3002", seed: 83 }
  });
  var own3 = (obj, key4) => Object.hasOwn(obj, key4);
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
      if (!object2(unit) || !["weapon", "gear", "statuses"].every((slot) => own3(unit, slot)) || !Array.isArray(unit.gear) || Object.keys(unit).some((key4) => !["weapon", "gear", "statuses", "mainHand", "offHand", "shield"].includes(key4))) throw new Error(`\u65E0\u6548\u7684\u8DE8\u6218\u5355\u4F4D\uFF1A${id3}`);
      const statuses = Object.fromEntries(entries(unit.statuses).map(([key4, status2]) => {
        if (!object2(status2) || status2.durationType !== "persistent") throw new Error(`\u8DE8\u6218\u72B6\u6001\u5FC5\u987B\u5E38\u9A7B\uFF1A${key4}`);
        statusValue(status2, key4, state);
        return [key4, status2];
      }));
      for (const [instanceId, isWeapon2] of [[unit.weapon, true], ...[unit.mainHand, unit.offHand].filter(Boolean).map((i) => [i, true]), ...[unit.shield].filter(Boolean).map((i) => [i, true]), ...unit.gear.map((i) => [i, false])]) {
        if (instanceId === null && isWeapon2) continue;
        if (!safeId(instanceId) || !own3(carry.items, instanceId) || assigned.has(instanceId) || own3(state.equipment[state.items[instanceId].templateId], "damage") !== isWeapon2) throw new Error(`\u8DE8\u6218\u88C5\u5907\u5F52\u5C5E\u65E0\u6548\uFF1A${instanceId}`);
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
    if (!object2(request) || !Object.keys(request).every((key4) => ["scenarioId", "seed", "mode", "ruleset", "persistentSnapshot"].includes(key4))) throw new Error("\u65E0\u6548\u7684\u5F00\u5C40\u53C2\u6570");
    const { scenarioId = "ruins", ruleset = "protocol", persistentSnapshot } = request;
    if (typeof scenarioId !== "string" || !own3(SCENARIOS, scenarioId)) throw new Error("\u672A\u77E5\u9884\u8BBE\u5173\u5361");
    const { title, seed: defaultSeed } = SCENARIOS[scenarioId];
    const seed = request.seed ?? defaultSeed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || !["protocol", "sandbox"].includes(ruleset)) throw new Error("\u65E0\u6548\u7684\u79CD\u5B50\u6216\u884C\u52A8\u89C4\u5219");
    const state = {
      scenarioId,
      title,
      mode: "split",
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
  function tactics(state, actor, action, plan) {
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
      const sign3 = enemy ? 1 : target2 === actor ? -1.5 : -1.15;
      const damage = profile.expectedDamage ?? 0;
      const kill = profile.damageMax >= target2.hp ? Math.min(profile.hitChance ?? 1, damage / target2.hp) : 0;
      score += sign3 * (Math.min(target2.hp, damage) + kill * 6);
      if (profile.heal) {
        const healing = (profile.heal[0] + profile.heal[1]) / 2;
        score -= sign3 * (Math.min(healthGap(target2), healing) * 0.9 + (profile.healingShield?.[0] ?? 0) * (shieldTotal(target2) ? 0.14 : 0.34));
      }
    }
    for (const { id: id3, heal, shieldGain } of plan.support ?? []) {
      const target2 = state.units[id3];
      if (!target2) continue;
      const sign3 = target2.team === actor.team ? 1 : -1;
      score += sign3 * (heal * 0.9 + Math.min(shieldGain, target2.maxHp) * 0.5);
    }
    return score / (plan.ap === 2 ? 1.35 : 1) - plan.mp * 0.35 - plan.sp * 0.25;
  }
  function aimedOptions(state, actor, attacksOnly = false) {
    const units = Object.values(state.units).filter((u) => u.hp > 0 && !u.fled).sort(byId3);
    const covers = Object.values(state.covers).filter((c) => c.hp > 0).sort(byId3);
    const choices = [];
    function consider(action) {
      const plan = preview(state, action);
      if (plan.ok) choices.push({ action, score: tactics(state, actor, action, plan) });
    }
    const enemies = units.filter((u) => visibleEnemy(state, actor, u));
    for (const target2 of [...enemies, ...attacksOnly ? [] : covers]) consider({ type: "attack", x: target2.x, y: target2.y });
    const items = Object.entries(actor.inventory ?? {}).filter(([id3, count]) => count > 0 && state.skills[id3]?.backpackItem);
    const templates = new Map([...actor.skills.map((id3) => [id3, state.skills[id3]]), ...items.map(([id3]) => [id3, state.skills[id3]]), ...equippedActiveSkills(state, actor)]);
    for (const skillId of [...templates.keys()].sort()) {
      const skill2 = templates.get(skillId);
      if (!skill2 || attacksOnly && (skill2.slot !== "attack" || skill2.ap > 1)) continue;
      const query = preview(state, { type: "skill", skillId });
      if (!query.ok) continue;
      let candidates;
      if (skill2.target === "cell" || skill2.target === "corpse") {
        candidates = query.cells;
      } else if (skill2.shape === "single") {
        candidates = skill2.target === "enemy" ? enemies : skill2.target === "self" ? [actor] : units.filter((u) => skill2.target === "any" || u.team === actor.team);
      } else if (attacksOnly) {
        candidates = enemies;
      } else {
        candidates = query.cells;
      }
      for (const { x, y } of candidates) consider({ type: "skill", skillId, x, y });
    }
    for (const { x, y, kind, spent } of Object.values(state.interactives).sort(byId3)) {
      if (spent) continue;
      if (kind === "barrel") consider({ type: "attack", x, y });
      else if (!attacksOnly) consider({ type: "interact", x, y });
    }
    return choices;
  }
  function approach(state, actor, enemies, suppress = false) {
    const weapon = state.equipment[state.items[actor.weapon]?.templateId];
    const range = weapon?.range ?? 1.5;
    const spots = [{ x: actor.x, y: actor.y, steps: 0 }, ...reachable(state, "move", actor, Infinity)];
    const clearAttackCell = (probe) => enemies.some((target2) => {
      const d = distance3D(state, probe, target2);
      if (suppress) return d <= 1 && hasLOS(state, probe, target2);
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
    const enemies = Object.values(state.units).filter((u) => u.hp > 0 && !u.fled && u.team !== actor.team).sort(byId3);
    if (!enemies.length) return { ...END };
    if (actor.moraleState === "routed") {
      if (atBattleEdge(state, actor)) return preview(state, { type: "flee" }).ok ? { type: "flee" } : { ...END };
      const move = preview(state, { type: "move" });
      if (!move.ok) return { ...END };
      const exit = reachable(state, "move", actor, Infinity).filter((cell) => atBattleEdge(state, cell)).sort((a, b) => a.steps - b.steps)[0];
      const dest = exit?.path.slice().reverse().find((p) => move.cells.some((c) => samePosition(c, p)));
      return dest ? { type: "move", x: dest.x, y: dest.y } : { ...END };
    }
    if (state.battleType === "suppress" && state.suppressingTeam !== actor.team && !actor.used.attack && !actor.statuses.suppressed) {
      const held = Object.values(state.units).filter((t) => t.team === actor.team && t.hp > 0 && !t.fled && t.statuses.suppressed).sort(byId3);
      for (const ally of held) {
        const rescue = { type: "free_ally", x: ally.x, y: ally.y };
        if (preview(state, rescue).ok) return rescue;
      }
      if (held.length) {
        const move = preview(state, { type: "move" });
        if (move.ok) {
          const route = approach(state, actor, held, true);
          const dest = route.slice().reverse().find((p) => move.cells.some((c) => samePosition(c, p)));
          if (dest) return { type: "move", x: dest.x, y: dest.y };
        }
      }
    }
    if (state.battleType === "suppress" && state.suppressingTeam === actor.team) {
      for (const enemy of enemies) {
        const action = { type: "suppress", x: enemy.x, y: enemy.y };
        if (preview(state, action).ok) return action;
      }
      const targets = enemies.filter((t) => !t.statuses.suppressed && visibleEnemy(state, actor, t));
      const path = targets.length && approach(state, actor, targets, true);
      if (path?.length) {
        const move = preview(state, { type: "move" });
        const dest = path.slice().reverse().find((p) => move.cells?.some((c) => samePosition(c, p)));
        if (dest) return { type: "move", x: dest.x, y: dest.y };
      }
      return { ...END };
    }
    const visible = enemies.filter((u) => visibleEnemy(state, actor, u));
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
        const projectedDepth = plannedPath.findIndex((point2) => samePosition(point2, cell)) + 1;
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
    if (bracing.ok && !statusModifier(actor, "reduction") && baseline <= 5) consider({ action: { type: "brace" }, score: bracing.coverId ? 2.5 : 1.4 });
    return { ...best.action };
  }

  // src/api/commands.js
  var get = (table4, key4, label) => {
    requireThat(has(table4, key4), label);
    return table4[key4];
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
        fields(c.patch.stats, [], attrs2);
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
      checkOptional(options, "amount", (x) => own2(status2.modifiers, "amount") && int(x, 1, 1e4));
      checkOptional(options, "sourceUnitId", (x) => has(s.units, x));
      if (options.modifiers?.taunted ?? status2.modifiers.taunted) {
        const sourceId2 = options.sourceUnitId ?? u.statuses[c.statusId]?.sourceUnitId;
        requireThat(has(s.units, sourceId2) && s.units[sourceId2].team !== u.team, "\u5632\u8BBD\u9700\u8981\u654C\u5BF9\u6765\u6E90");
      }
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
      const table4 = s.zones ??= {};
      table4[z.id] = z;
    },
    remove_zone(s, c) {
      fields(c, ["type", "zoneId"]);
      requireThat(has(s.zones ?? {}, c.zoneId), "\u533A\u57DF ID");
      delete s.zones[c.zoneId];
    },
    set_terrain_cell(s, c) {
      fields(c, ["type", "x", "y", "patch"]);
      requireThat(coord2(c.x) && coord2(c.y), "\u5750\u6807");
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
  var damageNames = { physical: "\u7269\u7406", energy: "\u80FD\u91CF", mental: "\u7CBE\u795E", true: "\u771F\u5B9E" };
  var statNames = {
    str: "\u529B\u91CF",
    agi: "\u654F\u6377",
    con: "\u4F53\u8D28",
    int: "\u667A\u529B",
    spi: "\u7CBE\u795E",
    accuracy: "\u547D\u4E2D",
    dodge: "\u95EA\u907F",
    defense: "\u9632\u5FA1",
    initiative: "\u5148\u653B",
    armor: "\u62A4\u7532",
    armorPierce: "\u7A7F\u7532",
    damageReduction: "\u51CF\u4F24\u6BD4\u4F8B",
    damageReductionFlat: "\u56FA\u5B9A\u51CF\u4F24",
    damage: "\u4F24\u5BB3",
    healing: "\u6CBB\u7597",
    skillPower: "\u6280\u80FD\u5A01\u529B"
  };
  var flatModifiers = {
    armor: "\u62A4\u7532",
    movement: "\u79FB\u52A8\u8DDD\u79BB",
    accuracy: "\u547D\u4E2D",
    incomingAccuracy: "\u88AB\u547D\u4E2D\u4FEE\u6B63",
    advantage: "\u4F18\u52BF\u9AB0",
    disadvantage: "\u52A3\u52BF\u9AB0",
    intentDifficulty: "\u610F\u56FE\u96BE\u5EA6",
    dodgeBonus: "\u95EA\u907F"
  };
  var ratioModifiers = {
    reduction: "\u51CF\u4F24",
    vulnerability: "\u6613\u4F24",
    shatter: "\u788E\u88C2\u589E\u4F24",
    damageBonus: "\u589E\u4F24",
    attackPercent: "\u653B\u51FB",
    attributePercent: "\u5C5E\u6027"
  };
  var flagModifiers = {
    taunted: "\u88AB\u5632\u8BBD",
    intercept: "\u53EF\u62E6\u622A\u653B\u51FB",
    skip: "\u8DF3\u8FC7\u884C\u52A8",
    rooted: "\u65E0\u6CD5\u79FB\u52A8",
    hidden: "\u9690\u8EAB",
    infiniteAmmo: "\u5F39\u836F\u4E0D\u9650",
    guaranteed_hit: "\u5FC5\u5B9A\u547D\u4E2D",
    guaranteed_crit: "\u5FC5\u5B9A\u66B4\u51FB",
    blockResourceRestore: "\u7981\u6B62\u8D44\u6E90\u6062\u590D",
    preserveLife: "\u4FDD\u7559\u81F3\u5C11 1 HP"
  };
  var expiryEvents = {
    on_attack: "\u53D1\u52A8\u653B\u51FB",
    on_hit: "\u547D\u4E2D",
    on_struck: "\u53D7\u5230\u547D\u4E2D",
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
  var checkGrade = (success, roll) => success ? roll === 20 ? "\u5927\u6210\u529F" : "\u6210\u529F" : roll === 1 ? "\u5927\u5931\u8D25" : "\u5931\u8D25";
  var maneuvers = { grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E" };
  var signed = (value) => `${value > 0 ? "+" : ""}${value}`;
  var percent = (value) => Number((value * 100).toFixed(4));
  var notes = (parts) => parts.length ? `\uFF08${parts.join("\uFF0C")}\uFF09` : "";
  function statusNotes(detail) {
    const parts = [];
    if (detail.durationType === "persistent") parts.push("\u8DE8\u6218\u6597\u6301\u7EED");
    else if (detail.durationType === "until_removed") parts.push("\u6301\u7EED\u81F3\u89E3\u9664");
    else if (Number.isInteger(detail.remainingTurns)) parts.push(`\u6301\u7EED ${detail.remainingTurns} \u56DE\u5408`);
    const m = detail.effectiveModifiers ?? detail.modifiers ?? {};
    if (Number.isFinite(detail.amount ?? m.amount)) parts.push(`\u62A4\u76FE ${detail.amount ?? m.amount} \u70B9`);
    const ticks = [];
    const tickAmount = (value, label) => `\u6BCF\u5C42 ${value} \u70B9${label}` + (detail.stacks > 1 ? `\uFF08\u5F53\u524D\u5408\u8BA1 ${value * detail.stacks} \u70B9\uFF09` : "");
    if (m.damage) ticks.push(tickAmount(m.damage, `${damageNames[m.damageType ?? "true"]}\u4F24\u5BB3`));
    if (m.heal) ticks.push(tickAmount(m.heal, "\u6CBB\u7597"));
    if (ticks.length) parts.push(`\u6301\u6709\u8005\u56DE\u5408${detail.tickTiming === "onTurnEnd" ? "\u7ED3\u675F" : "\u5F00\u59CB"}\uFF1A${ticks.join("\u3001")}`);
    if (m.reflect) parts.push(`\u53CD\u4F24 ${m.reflect} \u70B9`);
    const perLayer = detail.stacks > 1 ? "\u6BCF\u5C42" : "";
    for (const [key4, label] of Object.entries(flatModifiers)) if (m[key4]) parts.push(`${perLayer}${label} ${signed(m[key4])}`);
    for (const [key4, label] of Object.entries(ratioModifiers)) if (m[key4]) parts.push(`${perLayer}${label} ${signed(percent(m[key4]))}%`);
    if (m.finalDamageMultiplier != null && m.finalDamageMultiplier !== 1) parts.push(`${perLayer}\u6700\u7EC8\u4F24\u5BB3 \xD7${m.finalDamageMultiplier}`);
    for (const [key4, label] of Object.entries(flagModifiers)) if (m[key4]) parts.push(label);
    if (detail.expireOn) {
      const triggers = [].concat(detail.expireOn).map((rule) => {
        const qualifier = rule.damageType === "direct" ? "\u53D7\u5230\u76F4\u63A5\u4F24\u5BB3" : rule.damageType === "indirect" ? "\u53D7\u5230\u95F4\u63A5\u4F24\u5BB3" : expiryEvents[rule.trigger];
        return qualifier + (rule.exceptSource === "self" ? "\uFF08\u81EA\u8EAB\u6765\u6E90\u9664\u5916\uFF09" : "");
      });
      parts.push(`${triggers.join("\u6216")}\u65F6\u89E3\u9664`);
    }
    return parts;
  }
  function formatBattleReportText(report, unitNames = {}) {
    const lines = [report.title];
    const names = new Map(Object.entries(unitNames));
    for (const unit of report.units) names.set(unit.id, unit.name);
    const digits = "\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D";
    const roundLabel = (n) => n < 10 ? digits[n] : n < 100 ? `${n >= 20 ? digits[Math.floor(n / 10)] : ""}\u5341${n % 10 ? digits[n % 10] : ""}` : n;
    const position = (event, id3) => {
      const point2 = event.positions?.[id3] ?? report.units.find((unit) => unit.id === id3);
      return point2 && Number.isInteger(point2.x) && Number.isInteger(point2.y) ? `(${point2.x}, ${point2.y}${Number.isInteger(point2.z) ? `, z=${point2.z}` : ""})` : "";
    };
    const name = (event, id3) => `${names.get(id3) ?? id3}${position(event, id3)}`;
    const replaceUnitNames = (event, text4) => {
      let result = text4;
      const ordered2 = [...names.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [id3, unitName] of ordered2) {
        if (!unitName || !result.includes(unitName)) continue;
        const replacement = `${unitName}${position(event, id3)}`;
        result = result.split(unitName).join(replacement);
      }
      return result;
    };
    const checkTarget = (event, detail) => detail.targetKind === "cover" ? detail.targetName ?? detail.targetId : name(event, detail.targetId);
    const change = (resource3, before, after) => Number.isFinite(before) && Number.isFinite(after) ? `\uFF08${resource3} ${before} \u2192 ${after}\uFF09` : "";
    for (const { round, events: events2 } of report.rounds) {
      const rows2 = [];
      let turn = null;
      const add = (text4) => {
        if (turn) turn.parts.push(text4);
        else rows2.push(text4);
      };
      for (const [i, event] of events2.entries()) {
        const { type, text: text4, actor } = event;
        const detail = event.detail ?? {};
        switch (type) {
          case "initiative":
            rows2.push(`\u786E\u5B9A\u5148\u653B\u6B21\u5E8F\uFF1A${detail.initiative.map((u) => name(event, u.unitId)).join(" \u2192 ")}`);
            break;
          case "turn":
            turn = { text: replaceUnitNames(event, text4), actor, parts: [] };
            rows2.push(turn);
            break;
          case "end":
            if (turn && !turn.parts.length) turn.parts.push("\u672A\u884C\u52A8\uFF0C\u7ED3\u675F\u56DE\u5408");
            turn = null;
            break;
          case "action": {
            const action = detail.action?.type;
            if (["move", "sprint", "disengage", "interact"].includes(action) || action === "brace" && events2[i + 1]?.type === "brace") break;
            const actorName = name(event, actor);
            if (detail.attackSource) {
              const targets = (detail.attackTargets ?? []).map((t) => t.unit ? name(event, t.unit) : t.cover);
              if (!targets.length && detail.corpseId) targets.push(name(event, detail.corpseId));
              const aim = targets.join("\u3001") || `\u683C\u5B50 (${detail.action.x}, ${detail.action.y})`;
              const intent = { function: "\u673A\u80FD\u9650\u5236", core: "\u6838\u5FC3\u8981\u5BB3", kill: "\u62B9\u6740", concept: "\u6982\u5FF5\u7834\u788E" }[detail.intent];
              add(`${actorName}\u4F7F\u7528${detail.attackSource}${intent ? `\u4EE5\u610F\u56FE\uFF1A${intent}` : ""}${action === "skill" ? "\uFF0C\u76EE\u6807\uFF1A" : "\u653B\u51FB"}${aim}`);
              break;
            }
            const prefix = `${actorName}\uFF1A`;
            const rawPrefix = `${names.get(actor) ?? actor}\uFF1A`;
            const label = text4.startsWith(prefix) ? text4.slice(prefix.length) : text4.startsWith(rawPrefix) ? text4.slice(rawPrefix.length) : text4;
            add(action === "attack" || action === "skill" ? `\u4F7F\u7528${replaceUnitNames(event, label)}` : replaceUnitNames(event, label));
            break;
          }
          case "roll":
          case "hit_result": {
            const target2 = checkTarget(event, detail);
            if (detail.cover > 0) add(`${target2}\u53D7\u5230${detail.coverId ? ` ${detail.coverId} ` : ""}\u63A9\u4F53\u906E\u853D`);
            if (!detail.hit) add(`${target2}\u672A\u88AB\u51FB\u4E2D\uFF08${checkGrade(false, detail.selected)}\uFF0C\u5931\u624B\uFF09`);
            else {
              const verdict = detail.critical ? `\u5BF9${target2}\u6253\u51FA\u66B4\u51FB` : `\u51FB\u4E2D${target2}`;
              const grade = detail.automatic ? "\u81EA\u52A8\u547D\u4E2D" : checkGrade(true, detail.selected);
              add(verdict + notes([grade, detail.rating?.name, detail.execution && "\u5904\u51B3\u52A0\u6210"].filter(Boolean)));
            }
            break;
          }
          case "save": {
            const target2 = checkTarget(event, detail);
            if (detail.contest) {
              const { attack, defense } = detail.contest;
              add(`${name(event, actor)}\u5BF9${target2}\u8FDB\u884C${statNames[attack.saveStat]}\u5BF9${statNames[defense.saveStat]}\u7684${detail.sourceName ?? "\u6548\u679C"}\u5BF9\u6297${notes([
                `\u65BD\u672F\u65B9${checkGrade(!detail.saved, attack.saveRoll)}`,
                `\u62B5\u6297\u65B9${checkGrade(detail.saved, defense.saveRoll)}`
              ])}`);
              break;
            }
            const checks = detail.checks?.map((check) => `${statNames[check.saveStat]}${checkGrade(check.saved, check.saveRoll)}`);
            const stat2 = statNames[detail.saveStat] ?? (checks ? "\u591A\u91CD" : "");
            const result = checks ? [checkGrade(detail.saved), detail.mode === "all" ? "\u987B\u5168\u90E8\u901A\u8FC7" : "\u4EFB\u4E00\u901A\u8FC7\u5373\u53EF", ...checks] : [checkGrade(detail.saved, detail.saveRoll)];
            const source = detail.sourceName ? `\u5BF9${detail.sourceName}\u7684` : "";
            add(`${target2}${detail.saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}${source}${stat2}\u8C41\u514D${notes(result)}`);
            break;
          }
          case "intent":
            add(`${detail.success ? "\u610F\u56FE\u6210\u7ACB" : "\u610F\u56FE\u672A\u6210\u7ACB"}${notes([checkGrade(detail.success, detail.attackerD20)])}${detail.success ? "" : "\uFF0C\u6309\u5E38\u89C4\u653B\u51FB\u7ED3\u7B97"}`);
            break;
          case "contest":
          case "flee": {
            const target2 = detail.targetId ? `\uFF08\u5BF9\u624B ${name(event, detail.targetId)}\uFF09` : "";
            const label = type === "flee" ? "\u9003\u8DD1" : maneuvers[detail.maneuver] ?? "\u5BF9\u6297";
            add(`${name(event, actor)}${label}\u68C0\u5B9A${checkGrade(detail.success, detail.attackerRoll)}${target2}`);
            break;
          }
          case "parry":
            add(replaceUnitNames(event, text4) + notes([detail.perfect ? "\u5927\u6210\u529F" : checkGrade(detail.success, detail.defenderRoll)]));
            break;
          case "morale":
            add(replaceUnitNames(event, text4) + (Number.isFinite(detail.roll) ? notes([`\u6218\u610F\u68C0\u5B9A${checkGrade(detail.outcome ? detail.roll >= 12 : detail.shaken, detail.roll)}`]) : ""));
            break;
          case "status":
          case "status_patch": {
            const brace = events2[i - 1];
            if (type === "status" && brace?.type === "brace" && brace.actor === detail.targetId && (detail.stacks ?? 1) === 1 && (!detail.durationType || detail.durationType === "battle_turns") && !detail.expireOn && !detail.amount && brace.detail?.turns === detail.remainingTurns && Object.keys(detail.modifiers ?? {}).every((key4) => key4 === "reduction" && detail.modifiers[key4] === brace.detail.reduction)) break;
            const parts = statusNotes(detail);
            if (type === "status_patch" && detail.stacks > 1) parts.unshift(`${detail.stacks} \u5C42`);
            if (type === "status" && actor && detail.targetId && actor !== detail.targetId) parts.push(`\u6765\u6E90 ${name(event, actor)}`);
            add(replaceUnitNames(event, text4).replace(/ ×1$/, "") + notes(parts));
            break;
          }
          case "stat_modifier": {
            const stat2 = (damageNames[detail.damageType] ?? "") + statNames[detail.stat];
            const parts = [`\u6301\u7EED ${detail.turns} \u56DE\u5408`];
            if (detail.flat) parts.push(`${stat2} ${signed(detail.flat)}`);
            if (detail.percent) parts.push(`${stat2} ${signed(percent(detail.percent))}%`);
            add(replaceUnitNames(event, text4) + notes(parts));
            break;
          }
          case "proc": {
            const target2 = detail.targetId && detail.targetId !== actor ? `\uFF08\u76EE\u6807 ${name(event, detail.targetId)}\uFF09` : "";
            const label = detail.die == null ? "\u89E6\u53D1\u5224\u5B9A" : "\u89E6\u53D1\u68C0\u5B9A";
            add(`${actor ? `${name(event, actor)}\u7684` : ""}${text4}${label}${checkGrade(detail.triggered, detail.die)}${target2}`);
            break;
          }
          case "damage":
          case "heal":
            if (detail.amount !== 0) {
              const origin = detail.statusId && actor && actor !== detail.targetId ? `\uFF08\u65BD\u52A0\u8005 ${name(event, actor)}\uFF09` : "";
              add(replaceUnitNames(event, text4) + change("HP", detail.hpBefore, detail.hpAfter) + origin);
            }
            break;
          case "skill_cost":
            add(replaceUnitNames(event, text4) + change("HP", detail.hpBefore ?? detail.remainingHP + detail.hp, detail.hpAfter ?? detail.remainingHP));
            break;
          case "resource":
            add(replaceUnitNames(event, text4) + change(detail.resource?.toUpperCase(), detail.before, detail.after));
            break;
          case "counter": {
            const { counterKey, before, after } = detail;
            const suffix = ` \xB7 ${counterKey} ${before} \u2192 ${after}`;
            const label = counterKey && text4.endsWith(suffix) ? `${text4.slice(0, -suffix.length)} \xB7 ${resourceLabel(counterKey)} ${before} \u2192 ${after}` : text4;
            add(replaceUnitNames(event, label));
            break;
          }
          case "outcome":
            turn = null;
            rows2.push(replaceUnitNames(event, text4));
            break;
          default: {
            if (type === "cover_damage" && detail.amount === 0) break;
            const ownAction = turn?.actor === actor && ["move", "sprint", "disengage", "teleport", "altitude", "interact", "skip", "brace", "cover_approach"].includes(type);
            let label = replaceUnitNames(event, text4);
            const actorRaw = names.get(actor) ?? actor;
            if (ownAction && label.startsWith(`${actorRaw}${position(event, actor)}`)) label = label.slice(`${actorRaw}${position(event, actor)}`.length);
            if (["teleport", "knockback"].includes(type) && Number.isInteger(detail.to?.z)) {
              label += `\uFF0C\u81F3 (${detail.to.x}, ${detail.to.y}, z=${detail.to.z})`;
            }
            add(label.replace(/ ×1$/, ""));
          }
        }
      }
      if (!rows2.length) continue;
      lines.push("", `- \u56DE\u5408${roundLabel(round)}`);
      for (const row of rows2) lines.push(`  - ${typeof row === "string" ? row : row.text + (row.parts.length ? `\uFF1A${row.parts.join("\uFF1B")}` : "")}`);
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
  var battleVersion = 8;
  var maxHistory = 2e3;
  var maxBatch = 32;
  var own4 = (obj, key4) => Object.hasOwn(obj, key4);
  var shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every((key4) => own4(value, key4));
  function diff(before, after, path = [], changes2 = []) {
    if (before === after) return changes2;
    if (before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after) && (!Array.isArray(before) || before.length === after.length)) {
      for (const key4 of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
        diff(
          own4(before, key4) ? before[key4] : void 0,
          own4(after, key4) ? after[key4] : void 0,
          [...path, Array.isArray(before) ? Number(key4) : key4],
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
      if (!shape(snapshot, ["kind", "version", "origin", "state", "journal"]) || snapshot.kind !== "battle" || ![1, 2, 3, 4, 5, 6, 7, battleVersion].includes(snapshot.version) || !Array.isArray(snapshot.journal) || snapshot.journal.length > maxHistory) fail3("\u4E0D\u652F\u6301\u7684\u6218\u5C40\u5FEB\u7167\u683C\u5F0F");
      const needsMigration = snapshot.version < battleVersion;
      if (needsMigration) {
        const migrate = (data) => {
          const next2 = migrateStateEffects(copy(data));
          next2.mode = "split";
          for (const unit of Object.values(next2.units ?? {})) {
            delete unit.statuses?.disarmed;
            delete unit.disarmedItem;
          }
          return next2;
        };
        snapshot = { ...snapshot, origin: migrate(snapshot.origin), state: migrate(snapshot.state) };
      }
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
          z: elevation(current(), current().units[id3]),
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
        const skills = [...unit.skills, ...Object.keys(unit.inventory ?? {}).filter((id3) => s.skills[id3]?.backpackItem)];
        const templates = [...skills.map((id3) => [id3, s.skills[id3]]), ...equippedActiveSkills(s, unit)];
        const skillUsage = Object.fromEntries(templates.filter(([, template]) => template).map(([id3, template]) => [id3, skillAvailability(s, unit, template, id3)]));
        return copy({ ...unit, skillUsage, equipment: [unit.weapon, unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean).filter((id3, i, all) => all.indexOf(id3) === i).map((id3) => ({
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
  var TEMPLATE = `<div class="ft-app" data-busy="false">
  <section class="ft-stage" aria-label="\u6218\u573A">
    <div class="axis-scroll ft-scroll" id="board-scroll">
      <div class="ft-board battle-axis" id="board-frame">
        <div class="tactical-grid ft-grid" id="board" aria-label="\u6218\u65D7\u68CB\u76D8"></div>
        <div class="ft-tokens" id="board-tokens" aria-hidden="true"></div>
        <div class="ft-fx" id="board-fx" aria-hidden="true"></div>
      </div>
    </div>

    <header class="ft-hud-top">
      <div class="ft-hud-title">
        <span class="ft-eyebrow">\u25C6 \u547D\u5B9A\u4E4B\u8BD7</span>
        <strong id="battle-title" class="ft-title"></strong>
        <span id="round-badge" class="ft-round"></span>
      </div>
      <div id="turn-order" class="ft-initiative" aria-label="\u5148\u653B\u5E8F\u5217"></div>
      <nav class="ft-hud-menu" aria-label="\u9762\u677F">
        <button type="button" id="fullscreen-toggle" class="ft-icon-button" aria-pressed="false" aria-label="\u5168\u5C4F" title="\u5168\u5C4F">\u26F6</button>
        <button type="button" class="ft-icon-button" data-open-drawer="log" aria-label="\u6218\u51B5\u65E5\u5FD7" title="\u6218\u51B5\u65E5\u5FD7">\u{1F4DC}<span id="log-unread" class="ft-dot" hidden></span></button>
        <button type="button" class="ft-icon-button" data-open-drawer="unit" aria-label="\u5355\u4F4D\u60C5\u62A5" title="\u5355\u4F4D\u60C5\u62A5">\u25C8</button>
        <button type="button" class="ft-icon-button" data-open-drawer="tools" aria-label="\u5DE5\u5177" title="\u5DE5\u5177">\u2692</button>
        <button type="button" class="ft-icon-button" data-open-drawer="settings" aria-label="\u6218\u5C40\u8BBE\u7F6E" title="\u6218\u5C40\u8BBE\u7F6E">\u2699</button>
      </nav>
    </header>

    <p id="terrain-inspector" class="ft-inspector" aria-live="polite"></p>
    <div class="ft-zoom" role="group" aria-label="\u68CB\u76D8\u7F29\u653E\uFF08\u6EDA\u8F6E\u6216\u53CC\u6307\u4E5F\u53EF\u7F29\u653E\uFF09">
      <button type="button" id="zoom-out" aria-label="\u7F29\u5C0F" title="\u7F29\u5C0F\uFF08\u2212\uFF09">\u2212</button>
      <button type="button" id="zoom-reset" aria-label="\u6062\u590D\u6574\u76D8\u53EF\u89C1" title="\u6062\u590D\u6574\u76D8\u53EF\u89C1\uFF080\uFF09">100%</button>
      <button type="button" id="zoom-in" aria-label="\u653E\u5927" title="\u653E\u5927\uFF08+\uFF09">+</button>
    </div>

    <div class="ft-overlay" aria-live="polite">
      <div id="turn-banner" class="ft-banner" hidden></div>
      <div id="action-ribbon" class="ft-ribbon" hidden></div>
      <div id="dice-stage" class="ft-dice-stage"></div>
      <ol id="caption" class="ft-caption"></ol>
    </div>
    <button type="button" id="skip-playback" class="ft-skip" hidden>\u8DF3\u8FC7\u52A8\u753B \u25B8\u25B8</button>

    <footer class="ft-dock">
      <div id="actor-card" class="ft-actor"></div>
      <div class="ft-dock-actions">
        <p id="battle-status" class="ft-status" role="status"></p>
        <p id="sprint-indicator" class="ft-hint"></p>
        <p id="action-error" class="ft-error" role="alert" hidden></p>
        <div class="ft-row">
          <button id="end-turn" type="button" class="game-button primary">\u7ED3\u675F\u56DE\u5408</button>
          <button id="undo-button" type="button" class="game-button">\u64A4\u9500</button>
          <button id="ai-step" type="button" class="game-button">\u654C\u65B9\u5355\u6B65</button>
          <label class="ft-switch"><input id="auto-ai" type="checkbox" checked> \u81EA\u52A8\u654C\u65B9</label>
          <label class="ft-mini-select">\u95F4\u9694 <select id="ai-speed"><option value="800">\u6162</option><option value="350" selected>\u6807\u51C6</option><option value="80">\u5FEB</option></select></label>
        </div>
      </div>
    </footer>
  </section>

  <section id="target-actions" class="ft-target-card" aria-labelledby="target-title" hidden>
    <div class="ft-target-head">
      <strong id="target-title"></strong>
      <button type="button" id="close-target" class="ft-close" aria-label="\u5173\u95ED">\xD7</button>
    </div>
    <div id="target-options" class="ft-target-options" hidden>
      <label>\u610F\u56FE <select id="intent-select"><option value="normal">\u5E38\u89C4</option><option value="function">\u673A\u80FD\u9650\u5236</option><option value="core">\u6838\u5FC3\u8981\u5BB3</option><option value="kill">\u62B9\u6740</option><option value="concept">\u6982\u5FF5\u7834\u788E</option></select></label>
      <label><input id="nonlethal-toggle" type="checkbox"> \u975E\u81F4\u6B7B</label>
      <label>\u5956\u52B1\u9AB0 <select id="bonus-dice-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    </div>
    <div id="action-toolbar" class="ft-actions" aria-label="\u53EF\u7528\u52A8\u4F5C"></div>
    <div id="tactical-preview" class="ft-preview" aria-label="\u6218\u672F\u9884\u89C8" tabindex="0"></div>
    <button type="button" id="confirm-action" class="game-button primary ft-confirm" hidden>\u786E\u8BA4</button>
  </section>

  <div class="ft-scrim" id="drawer-scrim" hidden></div>

  <aside class="ft-drawer" data-drawer="log" aria-label="\u6218\u51B5\u65E5\u5FD7" hidden>
    <header class="ft-drawer-head"><h2>\u{1F4DC} \u6218\u51B5\u65E5\u5FD7</h2><button type="button" class="ft-close" data-close-drawer aria-label="\u5173\u95ED">\xD7</button></header>
    <div id="combat-log" class="ft-log"></div>
  </aside>

  <aside class="ft-drawer" data-drawer="unit" aria-label="\u5355\u4F4D\u60C5\u62A5" hidden>
    <header class="ft-drawer-head"><h2>\u25C8 \u5355\u4F4D\u60C5\u62A5</h2><button type="button" class="ft-close" data-close-drawer aria-label="\u5173\u95ED">\xD7</button></header>
    <div id="unit-card" class="ft-unit-card"></div>
    <h3 class="ft-section">\u63A9\u4F53\u4E0E\u4E92\u52A8\u70B9</h3>
    <div id="feature-cards" class="ft-features"></div>
  </aside>

  <aside class="ft-drawer" data-drawer="settings" aria-label="\u6218\u5C40\u8BBE\u7F6E" hidden>
    <header class="ft-drawer-head"><h2>\u2699 \u6218\u5C40\u8BBE\u7F6E</h2><button type="button" class="ft-close" data-close-drawer aria-label="\u5173\u95ED">\xD7</button></header>
    <div class="ft-form">
      <label data-scenario-only>\u9884\u8BBE\u6218\u5C40 <select id="scenario-select"></select></label>
      <p id="scenario-preview" class="muted"></p>
      <span>\u6BCF\u56DE\u5408\uFF1A1 \u52A8\u4F5C + 1 \u653B\u51FB</span>
      <label>\u968F\u673A\u79CD\u5B50 <input id="seed-input" type="number" min="0" max="4294967295" step="1" required></label>
      <div class="ft-row">
        <button type="button" id="reset-button" class="game-button primary">\u91CD\u5F00\u6218\u5C40</button>
        <button type="button" id="clear-persistent" class="game-button" hidden>\u6E05\u9664\u8DE8\u6218\u6570\u636E</button>
      </div>
      <h3 class="ft-section">\u663E\u793A</h3>
      <label>\u52A8\u753B\u901F\u5EA6 <select id="anim-speed"><option value="1.6">\u6162\uFF08\u770B\u6E05\u6BCF\u4E00\u6B65\uFF09</option><option value="1" selected>\u6807\u51C6</option><option value="0.5">\u5FEB</option><option value="0">\u5173\u95ED</option></select></label>
      <label>\u9762\u677F\u914D\u8272 <select id="theme-select"><option value="amethyst">\u7D2B\u6676</option><option value="night-gold">\u591C\u91D1</option><option value="frost-silver">\u971C\u94F6</option></select></label>
    </div>
  </aside>

  <aside class="ft-drawer" data-drawer="tools" aria-label="\u5DE5\u5177" hidden>
    <header class="ft-drawer-head"><h2>\u2692 \u5DE5\u5177</h2><button type="button" class="ft-close" data-close-drawer aria-label="\u5173\u95ED">\xD7</button></header>
    <div class="ft-form">
      <h3 class="ft-section">\u6218\u62A5\u4E0E\u5B58\u6863</h3>
      <div class="ft-row">
        <button type="button" id="export-report" class="game-button primary">\u5BFC\u51FA\u6218\u62A5</button>
        <button type="button" id="export-snapshot" class="game-button">\u4E0B\u8F7D\u5FEB\u7167</button>
        <button type="button" id="export-persistent" class="game-button">\u4E0B\u8F7D\u8DE8\u6218\u6570\u636E</button>
        <button type="button" id="import-button" class="game-button">\u5BFC\u5165\u5B58\u6863</button>
        <input id="import-snapshot" type="file" accept=".json,application/json" hidden>
      </div>
      <h3 class="ft-section">\u6D4B\u8DDD</h3>
      <div class="ft-row">
        <label>\u8D77\u70B9 <select id="measure-origin"></select></label>
        <label>\u76EE\u6807 <select id="measure-target"></select></label>
      </div>
      <p id="measure-readout" class="ft-readout" aria-live="polite"></p>
      <h3 class="ft-section">\u63A8\u6F14</h3>
      <button type="button" id="resource-button" class="game-button">\u6218\u524D\u8D44\u6E90\u63A8\u6F14</button>
      <details id="api-sandbox" class="ft-dev">
        <summary>\u5F00\u53D1\u8005\u6C99\u76D2\uFF08GameAPI \u547D\u4EE4\uFF09</summary>
        <p class="muted">\u5148\u8BD5\u7B97\uFF0C\u53EA\u663E\u793A\u4F1A\u6539\u53D8\u4EC0\u4E48\uFF1B\u786E\u8BA4\u540E\u624D\u5199\u5165\u6218\u5C40\u3002</p>
        <div class="ft-row">
          <button type="button" class="game-button" data-example="counter">\u88C5\u5907\u8BA1\u6570 +1</button>
          <button type="button" class="game-button" data-example="status">\u65BD\u52A0\u75BE\u8D70</button>
          <button type="button" class="game-button" data-example="custom-status">\u81EA\u5B9A\u4E49\u72B6\u6001</button>
          <button type="button" class="game-button" data-example="terrain">\u6539\u5730\u5F62</button>
        </div>
        <label>\u8BF4\u660E <input id="sandbox-reason" type="text" value="\u6C99\u76D2\u8C03\u8BD5" maxlength="160"></label>
        <label>\u547D\u4EE4 <textarea id="sandbox-editor" rows="7" spellcheck="false">[]</textarea></label>
        <div class="ft-row">
          <button type="button" id="sandbox-preview" class="game-button">\u8BD5\u7B97</button>
          <button type="button" id="sandbox-commit" class="game-button primary" disabled>\u786E\u8BA4\u63D0\u4EA4</button>
          <button type="button" id="sandbox-undo" class="game-button">\u64A4\u9500</button>
        </div>
        <div id="sandbox-output" class="ft-readout" aria-live="polite"></div>
      </details>
    </div>
  </aside>

  <dialog id="report-dialog" class="ft-dialog" aria-labelledby="report-title">
    <h2 id="report-title">\u7CBE\u7B80\u6218\u62A5</h2>
    <p class="muted">\u53EF\u76F4\u63A5\u7C98\u8D34\u7ED9 AI \u6269\u5199\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u53D1\u9001\u3002</p>
    <textarea id="report-text" rows="13" readonly aria-label="\u6218\u62A5\u6587\u672C"></textarea>
    <div class="ft-row">
      <button type="button" id="copy-report" class="game-button primary">\u590D\u5236\u6218\u62A5</button>
      <button type="button" id="download-report" class="game-button">\u4E0B\u8F7D TXT</button>
      <form method="dialog"><button class="game-button">\u5173\u95ED</button></form>
    </div>
    <p id="report-message" role="status"></p>
  </dialog>

  <dialog id="resource-dialog" class="ft-dialog" aria-labelledby="resource-title">
    <h2 id="resource-title">\u6218\u524D\u8D44\u6E90\u63A8\u6F14</h2>
    <p class="muted">\u9ED8\u8BA4\u586B\u5165\u6240\u9009\u5355\u4F4D\u7684\u4E94\u7EF4\uFF0C\u5C42\u7EA7\u6682\u586B\u4E00\u5C42\u3002\u53EA\u505A\u8BA1\u7B97\uFF0C\u4E0D\u6539\u5F53\u524D\u6218\u6597\u3002</p>
    <textarea id="resource-input" rows="8" aria-label="\u63A8\u6F14\u8F93\u5165"></textarea>
    <div class="ft-row">
      <button type="button" id="calculate-resources" class="game-button primary">\u8BA1\u7B97</button>
      <form method="dialog"><button class="game-button">\u5173\u95ED</button></form>
    </div>
    <div id="resource-output" class="ft-readout" aria-live="polite"></div>
  </dialog>
</div>`;

  // src/ui/narrate.js
  var DAMAGE_TYPES = Object.freeze({ physical: "\u7269\u7406", energy: "\u80FD\u91CF", mental: "\u7CBE\u795E", true: "\u771F\u5B9E" });
  var STAT_NAMES = Object.freeze({ str: "\u529B\u91CF", agi: "\u654F\u6377", con: "\u4F53\u8D28", int: "\u667A\u529B", spi: "\u7CBE\u795E" });
  var MANEUVERS = { grapple: "\u64D2\u62B1", disarm: "\u7F34\u68B0", trip: "\u7ECA\u6454", push: "\u63A8\u649E" };
  var INTENT_NAMES = { normal: "\u5E38\u89C4", function: "\u673A\u80FD\u9650\u5236", core: "\u6838\u5FC3\u8981\u5BB3", kill: "\u62B9\u6740", concept: "\u6982\u5FF5\u7834\u788E" };
  var sign = (n) => n > 0 ? `+${n}` : `${n}`;
  var pct = (n) => `${Math.round(n * 100)}%`;
  var num2 = (n) => Number.isInteger(n) ? `${n}` : Number(n).toFixed(1);
  var table3 = (t, id3) => t && id3 != null && Object.hasOwn(t, id3) ? t[id3] : void 0;
  function nameOf(state, id3) {
    if (id3 == null) return "\u67D0\u4EBA";
    return table3(state?.units, id3)?.name ?? table3(state?.covers, id3)?.name ?? table3(state?.interactives, id3)?.name ?? String(id3);
  }
  function statusInfo(state, id3) {
    return table3(state?.statusTemplates, id3) ?? table3(STATUSES, id3) ?? { name: id3 };
  }
  function diceMode(dice3, kept, { advantages = 0, disadvantages = 0, bonusDice = 0 } = {}) {
    if (!Array.isArray(dice3) || dice3.length <= 1) return "normal";
    if (dice3.length === 3) return "middle";
    const hi = Math.max(...dice3), lo = Math.min(...dice3);
    if (hi !== lo) return kept === hi ? "advantage" : "disadvantage";
    return advantages + bonusDice > disadvantages ? "advantage" : "disadvantage";
  }
  function describeDice(dice3, kept, mode) {
    if (!Array.isArray(dice3) || !dice3.length) return `\u9AB0\u503C ${kept}`;
    if (mode === "normal") return `\u63B7 d20\uFF0C\u5F97 ${kept}`;
    const label = { advantage: `\u4F18\u52BF\uFF1A\u63B7 ${dice3.length} \u9897 d20 \u53D6\u9AD8`, disadvantage: `\u52A3\u52BF\uFF1A\u63B7 ${dice3.length} \u9897 d20 \u53D6\u4F4E`, middle: "\u63B7 3 \u9897 d20 \u53D6\u4E2D\u95F4\u503C" }[mode];
    return `${label}\uFF08${dice3.join("\u3001")}\uFF09\uFF0C\u5F97 ${kept}`;
  }
  function ratingLine(total, rating) {
    if (!rating) return null;
    if (!rating.multiplier) return `\u5408\u8BA1 ${total}\uFF0C\u4E0D\u8DB3 4\uFF0C\u5931\u624B`;
    const row = RATING_TABLE.find((r) => r.name === rating.name);
    return `\u5408\u8BA1 ${total}${row?.min != null ? ` \u2265 ${row.min}` : ""}\uFF0C\u8BC4\u7EA7\u300C${rating.name}\u300D\uFF0C\u4F24\u5BB3 \xD7${rating.multiplier}`;
  }
  function rollEntry(state, log) {
    const d = log.detail ?? {};
    const attacker = nameOf(state, log.actor), target2 = nameOf(state, d.targetId);
    const kept = d.selected ?? d.dice?.[0];
    const mode = diceMode(d.dice, kept, d);
    const verdict = d.critical ? "\u66B4\u51FB" : d.hit ? "\u547D\u4E2D" : "\u672A\u547D\u4E2D";
    const tone = d.critical ? "crit" : d.hit ? "hit" : "miss";
    const lines = [describeDice(d.dice, kept, mode)];
    if (Number.isFinite(d.accuracy)) lines.push(`\u547D\u4E2D\u4FEE\u6B63 ${sign(d.accuracy)}\uFF0C\u5408\u8BA1 ${d.total}`);
    const factors = [];
    if (d.distanceTier?.name && Number.isFinite(d.distance)) factors.push(`\u8DDD\u79BB ${num2(d.distance)} \u683C\uFF08${d.distanceTier.name}\uFF09`);
    if (d.highGround) factors.push(d.highGround > 0 ? `\u5C45\u9AD8\u4E34\u4E0B ${sign(d.highGround)}` : `\u4EF0\u653B ${sign(d.highGround)}`);
    if (d.cover) factors.push(`\u88AB${d.coverId ? nameOf(state, d.coverId) : "\u63A9\u4F53"}\u906E\u6321 \u2212${d.cover}`);
    if (d.flanked) factors.push("\u5939\u51FB +2");
    if (d.arc === "back") factors.push("\u4ECE\u80CC\u540E\u51FA\u624B");
    if (factors.length) lines.push(`\u4FEE\u6B63\u6765\u6E90\uFF1A${factors.join("\uFF0C")}`);
    if (kept === 1) lines.push("\u5929\u7136 1\uFF1A\u65E0\u8BBA\u52A0\u503C\u591A\u5C11\uFF0C\u5FC5\u5B9A\u5931\u624B");
    else if (kept === 20) lines.push("\u5929\u7136 20\uFF1A\u5FC5\u5B9A\u66B4\u51FB");
    const rl = ratingLine(d.total, d.rating);
    if (rl && kept !== 1) lines.push(rl);
    if (d.intent && d.intent.required === false && d.intent.name && d.intent.name !== "\u5E38\u89C4") lines.push(`\u610F\u56FE\uFF1A${d.intent.name}`);
    return {
      tone,
      icon: d.critical ? "\u{1F4A5}" : d.hit ? "\u2694\uFE0F" : "\u{1F4A8}",
      title: `${attacker} \u653B\u51FB ${target2}\uFF1A${verdict}${d.hit && d.rating?.name && !d.critical ? `\uFF08${d.rating.name}\uFF09` : ""}`,
      lines,
      targetId: d.targetId,
      roll: {
        kind: "d20",
        label: `${attacker} \u2192 ${target2} \xB7 \u547D\u4E2D\u68C0\u5B9A`,
        dice: d.dice ?? [kept],
        kept,
        mode,
        modifier: d.accuracy ?? 0,
        modifierLabel: "\u547D\u4E2D\u4FEE\u6B63",
        total: d.total,
        target: d.defense,
        targetLabel: "\u9632\u5FA1",
        verdict: d.critical ? `\u66B4\u51FB\uFF01${d.rating?.name ? `\u300C${d.rating.name}\u300D` : ""}` : d.hit ? `\u547D\u4E2D\u300C${d.rating?.name ?? "\u6709\u6548"}\u300D` : kept === 1 ? "\u5929\u7136 1 \xB7 \u5931\u624B" : "\u672A\u547D\u4E2D",
        tone,
        note: d.rating?.multiplier && d.hit ? `\u4F24\u5BB3 \xD7${d.rating.multiplier}` : null
      }
    };
  }
  function damageEntry(state, log) {
    const d = log.detail ?? {};
    const target2 = nameOf(state, d.targetId);
    const lines = [];
    const dice3 = d.dice;
    if (dice3 && typeof dice3 === "object") {
      if (dice3.count) lines.push(`\u57FA\u7840\u4F24\u5BB3 ${dice3.count}d${dice3.sides}\uFF08${dice3.rolls.join(" + ")}\uFF09${dice3.bonus ? ` + ${dice3.bonus}` : ""} = ${dice3.value}`);
      else if (Number.isFinite(dice3.value)) lines.push(`\u57FA\u7840\u4F24\u5BB3 ${dice3.value}`);
    }
    const mults = [];
    if (d.ratingMultiplier && d.ratingMultiplier !== 1) mults.push(`\u8BC4\u7EA7\u300C${d.rating}\u300D\xD7${d.ratingMultiplier}`);
    if (d.intent?.multiplier && d.intent.multiplier !== 1) mults.push(`\u610F\u56FE \xD7${d.intent.multiplier}`);
    if (d.attackMultiplier && d.attackMultiplier !== 1) mults.push(`\u653B\u51FB\u52A0\u6210 \xD7${num2(d.attackMultiplier)}`);
    if (d.multiplier && d.multiplier !== 1) mults.push(`\u589E\u4F24 \xD7${num2(d.multiplier)}`);
    if (d.stanceScale && d.stanceScale !== 1) mults.push(`\u67B6\u52BF \xD7${d.stanceScale}`);
    if (d.offHandScale && d.offHandScale !== 1) mults.push(`\u526F\u624B \xD7${d.offHandScale}`);
    if (d.shatter) mults.push(`\u788E\u51B0 +${pct(d.shatter)}`);
    if (d.vulnerability) mults.push(`\u6613\u4F24 +${pct(d.vulnerability)}`);
    if (d.reduction) mults.push(`\u51CF\u4F24 \u2212${pct(d.reduction)}`);
    if (d.attributeReduction) mults.push(`\u4F53\u9B44\u51CF\u4F24 \u2212${pct(d.attributeReduction)}`);
    if (d.armorMultiplier && d.armorMultiplier < 0.995) mults.push(`\u62A4\u7532 \u2212${pct(1 - d.armorMultiplier)}`);
    if (mults.length) lines.push(`\u500D\u7387\uFF1A${mults.join("\uFF0C")}`);
    if (d.absorbed) lines.push(`\u62A4\u76FE\u5438\u6536 ${d.absorbed} \u70B9`);
    if (Number.isFinite(d.hpBefore)) lines.push(`\u751F\u547D ${d.hpBefore} \u2192 ${d.hpAfter}`);
    return { tone: "damage", icon: "\u{1FA78}", title: log.text, lines, targetId: d.targetId, amount: d.amount ?? 0 };
  }
  function saveCheck(state, who, c) {
    const stat2 = STAT_NAMES[c.saveStat] ?? c.saveStat;
    return `${who} ${stat2}\u8C41\u514D\uFF1Ad20 \u5F97 ${c.saveRoll} ${sign(c.saveBonus)} = ${c.saveTotal}\uFF0C\u9700\u8981 ${c.saveDC} \u2192 ${c.saved ? "\u901A\u8FC7" : "\u5931\u8D25"}`;
  }
  function saveEntry(state, log) {
    const d = log.detail ?? {};
    const who = nameOf(state, d.targetId);
    const tone = d.saved ? "save-pass" : "save-fail";
    const base = { tone, icon: d.saved ? "\u{1F6E1}\uFE0F" : "\u26A0\uFE0F", title: `${who}${d.saved ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7"}\u8C41\u514D`, targetId: d.targetId };
    if (d.contest) {
      const { attack: a, defense: b, dc } = d.contest;
      return {
        ...base,
        lines: [saveCheck(state, nameOf(state, log.actor), a), saveCheck(state, who, b), `\u4E24\u8005\u5DEE\u503C\u9700\u5C0F\u4E8E ${dc} \u624D\u7B97\u62B5\u6297\u6210\u529F`],
        roll: {
          kind: "versus",
          label: `${who} \xB7 \u5BF9\u6297\u8C41\u514D`,
          verdict: d.saved ? "\u62B5\u6297\u6210\u529F" : "\u62B5\u6297\u5931\u8D25",
          tone,
          left: { name: nameOf(state, log.actor), dice: [a.saveRoll], bonus: a.saveBonus, total: a.saveTotal },
          right: { name: who, dice: [b.saveRoll], bonus: b.saveBonus, total: b.saveTotal }
        }
      };
    }
    if (Array.isArray(d.checks)) {
      return {
        ...base,
        lines: [...d.checks.map((c) => saveCheck(state, who, c)), d.mode === "all" ? "\u9700\u8981\u5168\u90E8\u901A\u8FC7" : "\u4EFB\u4E00\u901A\u8FC7\u5373\u53EF"],
        roll: {
          kind: "d20",
          label: `${who} \xB7 \u591A\u91CD\u8C41\u514D`,
          dice: d.checks.map((c) => c.saveRoll),
          kept: d.checks[0]?.saveRoll,
          mode: "normal",
          modifier: d.checks[0]?.saveBonus ?? 0,
          total: d.checks[0]?.saveTotal,
          verdict: d.saved ? "\u8C41\u514D\u901A\u8FC7" : "\u8C41\u514D\u5931\u8D25",
          tone
        }
      };
    }
    const stat2 = STAT_NAMES[d.saveStat] ?? d.saveStat ?? "";
    return {
      ...base,
      lines: [saveCheck(state, who, d)],
      roll: {
        kind: "d20",
        label: `${who} \xB7 ${stat2}\u8C41\u514D`,
        dice: [d.saveRoll],
        kept: d.saveRoll,
        mode: "normal",
        modifier: d.saveBonus ?? 0,
        modifierLabel: `${stat2}\u52A0\u503C`,
        total: d.saveTotal,
        target: d.saveDC,
        targetLabel: "\u96BE\u5EA6",
        verdict: d.saved ? "\u8C41\u514D\u901A\u8FC7" : "\u8C41\u514D\u5931\u8D25",
        tone
      }
    };
  }
  function versus(state, log, label, success, verdictYes, verdictNo) {
    const d = log.detail ?? {};
    const left = nameOf(state, log.actor), right = nameOf(state, d.targetId);
    const lt = d.attackerTotal ?? d.attackerRoll, rt = d.defenderTotal ?? d.defenderRoll;
    const tone = success ? "hit" : "miss";
    return {
      tone,
      icon: success ? "\u270A" : "\u270B",
      title: log.text,
      targetId: d.targetId,
      lines: [
        `${left}\uFF1Ad20 \u5F97 ${d.attackerRoll}${d.attackerTotal != null && d.attackerTotal !== d.attackerRoll ? `\uFF0C\u5408\u8BA1 ${d.attackerTotal}` : ""}`,
        `${right}\uFF1Ad20 \u5F97 ${d.defenderRoll}${d.defenderTotal != null && d.defenderTotal !== d.defenderRoll ? `\uFF0C\u5408\u8BA1 ${d.defenderTotal}` : ""}`,
        `${lt} \u5BF9 ${rt} \u2192 ${success ? verdictYes : verdictNo}`
      ],
      roll: {
        kind: "versus",
        label,
        verdict: success ? verdictYes : verdictNo,
        tone,
        left: { name: left, dice: [d.attackerRoll], bonus: (d.attackerTotal ?? d.attackerRoll) - d.attackerRoll, total: lt },
        right: { name: right, dice: [d.defenderRoll], bonus: (d.defenderTotal ?? d.defenderRoll) - d.defenderRoll, total: rt }
      }
    };
  }
  var MOVE_VERBS = { move: "\u79FB\u52A8", sprint: "\u75BE\u8DD1", disengage: "\u64A4\u79BB" };
  function narrate(log, state) {
    const d = log?.detail ?? {};
    const actor = nameOf(state, log?.actor);
    const base = { type: log?.type, tone: "info", icon: "\u25C6", title: log?.text ?? "", lines: [], quiet: false, actorId: log?.actor ?? null, targetId: d.targetId ?? null };
    const out = (extra) => ({ ...base, ...extra });
    switch (log?.type) {
      case "initiative": {
        const rows2 = [...d.initiative ?? []].sort((a, b) => b.total - a.total);
        return out({
          icon: "\u{1F3B2}",
          tone: "turn",
          title: "\u6295\u63B7\u5148\u653B\uFF0C\u51B3\u5B9A\u884C\u52A8\u987A\u5E8F",
          lines: rows2.map((r, i) => `${i + 1}. ${nameOf(state, r.unitId)}\uFF1Ad20 \u5F97 ${r.roll} + \u654F\u6377 ${r.agility}${r.flatInit ? ` ${sign(r.flatInit)}` : ""} = ${num2(r.total)}`)
        });
      }
      case "initiative_order":
        return out({ icon: "\u{1F500}", lines: (d.order ?? []).length ? [`\u65B0\u987A\u5E8F\uFF1A${d.order.map((id3) => nameOf(state, id3)).join(" \u2192 ")}`] : [] });
      case "turn":
        return out({ tone: "turn", icon: "\u23F3", title: `\u8F6E\u5230 ${actor} \u884C\u52A8`, quiet: true });
      case "end":
        return out({ icon: "\u23F9", title: `${actor} \u7ED3\u675F\u56DE\u5408`, quiet: true });
      case "skip":
        return out({ tone: "status", icon: "\u{1F4AB}", title: `${actor} \u53D7\u63A7\u5236\uFF0C\u8DF3\u8FC7\u672C\u56DE\u5408` });
      case "action":
        return out({ icon: "\u25B6", title: log.text, quiet: true });
      case "move":
      case "sprint":
      case "disengage": {
        const steps = d.steps ?? d.path?.length ?? 0;
        return out({
          tone: "move",
          icon: d.interrupted ? "\u26D4" : "\u{1F463}",
          title: `${actor}${MOVE_VERBS[log.type]} ${steps} \u683C${d.interrupted ? "\uFF0C\u9014\u4E2D\u88AB\u62E6\u4E0B" : ""}`,
          lines: [`(${d.from?.x}, ${d.from?.y}) \u2192 (${d.to?.x}, ${d.to?.y})`, ...log.type === "disengage" ? ["\u64A4\u79BB\u4E0D\u4F1A\u89E6\u53D1\u501F\u673A\u653B\u51FB"] : []]
        });
      }
      case "teleport":
        return out({ tone: "move", icon: "\u2728", lines: [`(${d.from?.x}, ${d.from?.y}) \u2192 (${d.to?.x}, ${d.to?.y})`] });
      case "knockback":
        return out({ tone: "damage", icon: "\u{1F4A8}", lines: d.to ? [`\u88AB\u63A8\u5230 (${d.to.x}, ${d.to.y})`] : [] });
      case "roll":
        return out(rollEntry(state, log));
      case "damage":
        return out(damageEntry(state, log));
      case "defeat":
        return out({ tone: "defeat", icon: "\u2620\uFE0F", title: `${nameOf(state, d.targetId)} \u5012\u4E0B\u4E86` });
      case "heal":
        return out({
          tone: "heal",
          icon: "\u{1F49A}",
          amount: d.amount ?? 0,
          lines: d.dice?.count ? [`\u6CBB\u7597\u91CF ${d.dice.count}d${d.dice.sides}\uFF08${d.dice.rolls.join(" + ")}\uFF09${d.dice.bonus ? ` + ${d.dice.bonus}` : ""}`] : []
        });
      case "status": {
        const s = statusInfo(state, d.statusId);
        return out({
          tone: "status",
          icon: s.icon ?? "\u25C6",
          lines: [s.description, Number.isInteger(d.remainingTurns) ? `\u6301\u7EED ${d.remainingTurns} \u56DE\u5408` : null].filter(Boolean),
          statusName: s.name
        });
      }
      case "expire":
        return out({ icon: "\u231B", quiet: true });
      case "status_patch":
        return out({ icon: "\u270E", quiet: true });
      case "shield":
        return out({ tone: "heal", icon: "\u{1F6E1}\uFE0F", lines: d.remaining ? [`\u62A4\u76FE\u5269\u4F59 ${d.remaining}`] : [] });
      case "shield_break":
        return out({ tone: "damage", icon: "\u{1F494}" });
      case "shatter":
        return out({ tone: "crit", icon: "\u{1F9CA}", lines: d.multiplier ? [`\u8FD9\u4E00\u51FB\u4F24\u5BB3 \xD7${d.multiplier}`] : [] });
      case "intent": {
        const ok = d.success;
        return out({
          tone: ok ? "hit" : "miss",
          icon: ok ? "\u{1F3AF}" : "\u{1F6E1}\uFE0F",
          title: `\u610F\u56FE\u300C${d.name ?? INTENT_NAMES[d.intent] ?? d.intent}\u300D${ok ? "\u6210\u7ACB" : "\u53D7\u963B"}`,
          lines: [
            `\u653B\u65B9\uFF1A\u9636\u4F4D ${d.attackerBase} + \u9AB0 ${d.attackerD20}${d.ratingBonus ? ` + \u8BC4\u7EA7 ${d.ratingBonus}` : ""} = ${d.attackerTotal}`,
            `\u5B88\u65B9\uFF1A\u9636\u4F4D ${d.defenderBase} + d20 ${d.defenderD20} + \u96BE\u5EA6 ${d.intentDifficulty} = ${d.defenderTotal}`,
            ok ? `\u4F24\u5BB3 \xD7${d.multiplier}` : "\u610F\u56FE\u843D\u7A7A\uFF0C\u6309\u666E\u901A\u547D\u4E2D\u7ED3\u7B97"
          ],
          roll: {
            kind: "versus",
            label: `\u610F\u56FE\u5BF9\u6297 \xB7 ${d.name ?? ""}`,
            verdict: ok ? "\u610F\u56FE\u6210\u7ACB" : "\u610F\u56FE\u53D7\u963B",
            tone: ok ? "hit" : "miss",
            left: { name: actor, dice: [d.attackerD20], bonus: d.attackerTotal - d.attackerD20, total: d.attackerTotal },
            right: { name: nameOf(state, d.targetId), dice: [d.defenderD20], bonus: d.defenderTotal - d.defenderD20, total: d.defenderTotal }
          }
        });
      }
      case "save":
        return out(saveEntry(state, log));
      case "contest":
        return out(versus(state, log, `${MANEUVERS[d.maneuver] ?? "\u5BF9\u6297"}\u68C0\u5B9A`, d.success, `${MANEUVERS[d.maneuver] ?? ""}\u6210\u529F`, `${MANEUVERS[d.maneuver] ?? ""}\u5931\u8D25`));
      case "flee":
        return out(versus(state, log, "\u9003\u8DD1\u68C0\u5B9A", d.success, "\u9003\u8DD1\u6210\u529F", "\u9003\u8DD1\u5931\u8D25"));
      case "morale":
        return out({
          tone: (d.outcome ?? (d.shaken ? "shaken" : "routed")) === "routed" ? "defeat" : "status",
          icon: "\u{1F3F3}\uFE0F",
          lines: [log.text, `${d.recovered ? "\u751F\u547D\u6062\u590D\u81F3\u9608\u503C" : "\u751F\u547D\u4F4E\u4E8E\u9608\u503C"} ${pct(d.threshold ?? 0)}`],
          roll: Number.isFinite(d.roll) ? {
            kind: "d20",
            label: `${nameOf(state, d.targetId)} \xB7 \u58EB\u6C14\u68C0\u5B9A`,
            dice: [d.roll],
            kept: d.roll,
            mode: "normal",
            modifier: 0,
            total: d.roll,
            verdict: d.outcome ? d.roll >= 12 ? "\u575A\u5B88" : "\u6E83\u9003" : d.shaken ? "\u52A8\u6447" : "\u6E83\u9003",
            tone: d.roll >= 12 ? "hit" : "miss"
          } : void 0
        });
      case "proc": {
        const hit = d.triggered;
        return out({
          tone: hit ? "status" : "info",
          icon: "\u{1F3B2}",
          title: `${log.text}${hit ? " \u89E6\u53D1" : " \u672A\u89E6\u53D1"}`,
          quiet: !hit,
          lines: Number.isFinite(d.chance) ? [`\u89E6\u53D1\u51E0\u7387 ${pct(d.chance)}\uFF0C\u63B7\u51FA ${pct(d.roll)} \u2192 ${hit ? "\u89E6\u53D1" : "\u672A\u89E6\u53D1"}`] : [],
          roll: Number.isFinite(d.chance) && hit ? { kind: "chance", label: `${log.text} \xB7 \u51E0\u7387\u5224\u5B9A`, chance: d.chance, rolled: d.roll, verdict: "\u89E6\u53D1\uFF01", tone: "status" } : void 0
        });
      }
      case "opportunity":
        return out({ tone: "crit", icon: "\u26A1", title: `\u501F\u673A\u653B\u51FB\uFF01${log.text}` });
      case "counter": {
        const item = log.text.split(" \xB7 ")[0];
        return out({ icon: "\u25C8", quiet: true, title: `${item} \u7684${resourceLabel(d.counterKey)} ${d.before} \u2192 ${d.after}` });
      }
      case "cover_damage":
        return out({ tone: "damage", icon: "\u{1FAB5}", lines: Number.isFinite(d.hpAfter) ? [`\u8010\u4E45 ${d.hpBefore} \u2192 ${d.hpAfter}`] : [] });
      case "cover_break":
        return out({ tone: "damage", icon: "\u{1F9F1}" });
      case "cover_approach":
        return out({ icon: "\u{1F9F1}", quiet: true });
      case "interact":
        return out({ tone: "status", icon: "\u2734\uFE0F" });
      case "brace":
      case "block":
      case "guard":
      case "parry":
        return out({ tone: "status", icon: "\u{1F6E1}\uFE0F" });
      case "followup":
        return out({ tone: "hit", icon: "\u2694\uFE0F" });
      case "reveal":
        return out({ icon: "\u{1F441}" });
      case "cleanse":
        return out({ tone: "heal", icon: "\u2728" });
      case "nonlethal":
        return out({ tone: "status", icon: "\u{1F91A}" });
      case "zone":
        return out({ tone: "status", icon: "\u{1F300}", lines: d.damage ? [`\u53D7\u5230 ${d.damage} \u70B9\u4F24\u5BB3`] : [] });
      case "zone_expire":
        return out({ icon: "\u{1F300}", quiet: true });
      case "spawn":
        return out({ tone: "status", icon: "\u{1F331}" });
      case "deathrattle":
        return out({ tone: "crit", icon: "\u{1F480}" });
      case "skill_cost":
        return out({ icon: "\u{1FA78}", quiet: true });
      case "item":
        return out({ tone: "status", icon: "\u{1F9EA}", lines: Number.isFinite(d.remaining) ? [`\u5269\u4F59 ${d.remaining} \u6B21`] : [] });
      case "outcome":
        return out({ tone: "outcome", icon: "\u{1F3C1}" });
      default:
        return out({});
    }
  }
  function narrateAll(logs, state) {
    return (logs ?? []).map((log, index) => ({ index, round: log.round, ...narrate(log, state) }));
  }

  // src/ui/render.js
  var STATUS_ICON = { buff: "\u2191", debuff: "\u2193", control: "\u2298", dot: "\u2739", hot: "\u271A", shield: "\u2B21" };
  var STANCES = { light_blade: "\u8F7B\u5251", dual_wield: "\u53CC\u6301", attunement: "\u540C\u8C03", greatsword: "\u91CD\u5251", sword_shield: "\u5251\u76FE" };
  var SHAPES = { circle: "\u5706\u5F62\u8303\u56F4", cone: "\u9525\u5F62\u8303\u56F4", fan: "\u6247\u5F62\u8303\u56F4", line: "\u76F4\u7EBF\u8303\u56F4" };
  var ARROWS = { "-1,-1": "\u2199", "0,-1": "\u2193", "1,-1": "\u2198", "-1,0": "\u2190", "1,0": "\u2192", "-1,1": "\u2196", "0,1": "\u2191", "1,1": "\u2197" };
  var ACTION_LABELS = {
    use_item: "\u4F7F\u7528\u9053\u5177",
    move: "\u79FB\u52A8",
    sprint: "\u75BE\u8DD1",
    disengage: "\u64A4\u79BB",
    attack: "\u666E\u653B",
    interact: "\u4E92\u52A8",
    brace: "\u67B6\u52BF\u9632\u5FA1",
    free_ally: "\u89E3\u9664\u538B\u5236",
    suppress: "\u538B\u5236",
    block: "\u683C\u6321",
    shield_bash: "\u76FE\u51FB",
    charge: "\u84C4\u529B",
    lock_on: "\u9501\u5B9A",
    scan: "\u63A2\u5BDF",
    grapple: "\u64D2\u62B1",
    disarm: "\u7F34\u68B0",
    trip: "\u7ECA\u6454",
    push: "\u63A8\u649E",
    flee: "\u9003\u8DD1",
    detour: "\u7ED5\u884C",
    reload: "\u88C5\u586B",
    end: "\u7ED3\u675F\u56DE\u5408"
  };
  var ACTION_HINTS = {
    move: "\u8D70\u5230\u8FD9\u4E00\u683C",
    sprint: "\u8DD1\u5F97\u66F4\u8FDC\uFF0C\u8017 2 AP",
    disengage: "\u79BB\u5F00\u65F6\u4E0D\u88AB\u501F\u673A",
    attack: "\u7528\u6B66\u5668\u653B\u51FB",
    interact: "\u4F7F\u7528\u573A\u666F\u8BBE\u65BD",
    free_ally: "\u7528\u653B\u51FB\u69FD\u76F4\u63A5\u89E3\u6551\u76F8\u90BB\u961F\u53CB",
    suppress: "\u4E00\u683C\u5185\u547D\u4E2D\u540E\u8FDB\u884C\u529B\u91CF\u5BF9\u6297\uFF0C\u4E0D\u9020\u6210\u4F24\u5BB3",
    brace: "\u672C\u56DE\u5408\u51CF\u4F24",
    block: "\u4E3E\u76FE\u683C\u6321",
    charge: "\u4E3A\u4E0B\u4E00\u51FB\u84C4\u529B",
    scan: "\u4FA6\u5BDF\u5468\u56F4",
    lock_on: "\u4E0B\u6B21\u653B\u51FB\u66F4\u51C6",
    grapple: "\u5BF9\u6297\u68C0\u5B9A\uFF0C\u64D2\u4F4F\u5BF9\u65B9",
    disarm: "\u5BF9\u6297\u68C0\u5B9A\uFF0C\u6253\u843D\u6B66\u5668",
    trip: "\u5BF9\u6297\u68C0\u5B9A\uFF0C\u7ECA\u5012\u5BF9\u65B9",
    push: "\u5BF9\u6297\u68C0\u5B9A\uFF0C\u63A8\u5F00\u5BF9\u65B9",
    flee: "\u5C1D\u8BD5\u8131\u79BB\u6218\u6597",
    use_item: "\u4F7F\u7528\u526F\u624B\u9053\u5177",
    reload: "\u8865\u5145\u5F39\u836F",
    end: "\u4FDD\u7559\u5269\u4F59 AP"
  };
  var sign2 = (n) => n > 0 ? `+${n}` : `${n}`;
  var pct2 = (n) => `${Math.round(n * 100)}%`;
  var interval = (pair) => pair?.length === 2 ? pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]}\u2013${pair[1]}` : null;
  var side = (team2) => team2 === "blue" ? "\u6211\u65B9" : "\u654C\u65B9";
  var ratio2 = (v, max) => max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
  var has2 = (table4, id3) => table4 && id3 != null && Object.hasOwn(table4, id3);
  var get2 = (table4, id3) => has2(table4, id3) ? table4[id3] : void 0;
  var values3 = (table4) => Object.values(table4 ?? {});
  var key3 = (x, y) => `${x},${y}`;
  var statusText = (s) => `${STATUS_ICON[s.category] ?? "\u25C6"} ${s.name ?? s.id}${s.stacks > 1 ? ` \xD7${s.stacks}` : ""}`;
  var duration = (s) => Number.isInteger(s.remainingTurns) ? `\u5269 ${s.remainingTurns} \u56DE\u5408` : s.durationType === "persistent" ? "\u5E38\u9A7B" : "";
  var terrainLabel = (t) => t.kind === "wall" ? "\u5899\u4F53\uFF0C\u6321\u4F4F\u79FB\u52A8\u548C\u89C6\u7EBF" : t.kind === "slope" ? "\u5761\u9053" : t.z > 0 ? `\u9AD8\u53F0\uFF08\u9AD8 ${t.z}\uFF09` : t.z < 0 ? `\u4F4E\u5730\uFF08${t.z}\uFF09` : "\u5E73\u5730";
  function createRenderer(root, portraitFor = () => []) {
    const doc = root.ownerDocument;
    const $ = (id3) => root.querySelector(`[id="${id3}"]`);
    const el2 = (tag, cls, text4) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text4 != null) n.textContent = String(text4);
      return n;
    };
    const cells = /* @__PURE__ */ new Map();
    let dims = "", last = null, baseline = { move: /* @__PURE__ */ new Set(), attack: /* @__PURE__ */ new Set(), interact: /* @__PURE__ */ new Set() }, logCount = -1;
    function initBoard(state) {
      const h = state.grid.length, w = state.grid[0].length;
      if (dims === key3(w, h)) return;
      dims = key3(w, h);
      const board = $("board"), frame = $("board-frame");
      frame.style.setProperty("--cols", w);
      frame.style.setProperty("--rows", h);
      board.replaceChildren();
      cells.clear();
      for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
        const cell = el2("button", "tactical-cell");
        cell.type = "button";
        Object.assign(cell.dataset, { x, y });
        const coord3 = el2("span", "tactical-cell-coord", key3(x, y)), z = el2("span", "tactical-cell-tz");
        const units = el2("span", "tactical-cell-units"), features = el2("span", "tactical-cell-features");
        cell.append(coord3, z, units, features);
        cells.set(key3(x, y), { cell, z, units, features });
        board.append(cell);
      }
    }
    function token(name, initial, z, cls, faction) {
      const node3 = el2("span", `axis-unit ${cls ?? ""}`.trim());
      if (faction) node3.dataset.faction = faction;
      const head = el2("span", "axis-token-head");
      const badge = el2("span", "axis-z-badge", sign2(z));
      badge.dataset.zSign = z > 0 ? "pos" : z < 0 ? "neg" : "zero";
      head.append(el2("span", "axis-unit-fallback-avatar", initial), badge);
      node3.append(head, el2("span", "axis-unit-name", name));
      return { node: node3, head };
    }
    function unitToken(state, unit, z, chosen, isActive) {
      const { node: node3, head } = token(unit.name, Array.from(unit.name)[0] ?? "?", z, isActive ? "is-active" : "", unit.team);
      node3.dataset.unitId = unit.id;
      node3.setAttribute("aria-pressed", String(chosen));
      const portraits = portraitFor(unit.id);
      if (portraits.length) {
        const image = el2("img", "axis-unit-portrait");
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        let index = 0;
        image.onload = () => {
          image.hidden = false;
        };
        image.onerror = () => {
          image.hidden = true;
          if (++index < portraits.length) image.src = portraits[index];
          else image.remove();
        };
        image.hidden = true;
        image.src = portraits[0];
        head.prepend(image);
      }
      head.append(el2("span", "axis-facing-pip", ARROWS[unit.facing?.join(",")] ?? "\xB7"));
      const bars = el2("span", "token-meters");
      for (const stat2 of ["hp", "mp", "sp"]) {
        const meter = el2("span", `token-meter ${stat2}`), fill = el2("i");
        fill.style.setProperty("--resource-ratio", ratio2(unit[stat2], unit[`max${stat2[0].toUpperCase()}${stat2[1]}`]));
        meter.append(fill);
        bars.append(meter);
      }
      node3.append(bars);
      const marks = values3(unit.statuses);
      if (marks.length) node3.append(el2("span", "token-statuses", marks.length > 1 ? `\u25C6${marks.length}` : STATUS_ICON[marks[0].category] ?? "\u25C6"));
      return node3;
    }
    function featureToken(f, z, isCover) {
      const initial = Array.from(isCover ? f.material || "\u63A9" : f.kind === "barrel" ? "\u6876" : "\u796D")[0];
      const { node: node3 } = token(f.name ?? f.id, initial, z, isCover ? `tactical-cover${f.hp ? "" : " is-broken"}` : `tactical-interact${f.spent ? " is-spent" : ""}`);
      if (isCover) {
        node3.dataset.cover = f.id;
        const bar2 = el2("span", "tactical-cover-bar"), fill = el2("i");
        fill.style.width = pct2(ratio2(f.hp, f.maxHp));
        bar2.append(fill);
        node3.append(bar2);
      } else node3.dataset.interact = f.id;
      return node3;
    }
    const coverText = (c) => `${c.name}\uFF1A${c.material}\u63A9\u4F53\uFF0C\u8010\u4E45 ${c.hp}/${c.maxHp}\uFF0C\u8EB2\u5728\u540E\u9762\u547D\u4E2D \u2212${c.cover}${c.hp ? "" : "\uFF08\u5DF2\u574D\u584C\uFF09"}`;
    const interactiveText = (i) => `${i.name}\uFF1A${i.kind === "barrel" ? "\u6B66\u5668\u5C04\u7A0B\u5185\u53EF\u5F15\u7206\uFF08\u653B\u51FB\u69FD\uFF09\uFF0C\u6CE2\u53CA\u5468\u56F4" : "\u76F8\u90BB\u6FC0\u6D3B\uFF08\u52A8\u4F5C\u69FD\uFF09"}${i.spent ? "\uFF08\u5DF2\u7528\u8FC7\uFF09" : ""}`;
    function cliffs(state, x, y, tile) {
      if (tile.kind !== "floor") return [];
      return [["top", x, y + 1], ["bottom", x, y - 1], ["left", x - 1, y], ["right", x + 1, y]].filter(([, nx, ny]) => {
        const n = state.grid[ny]?.[nx];
        return n?.kind === "floor" && Math.abs(n.z - tile.z) >= 2;
      }).map(([d]) => d);
    }
    function group(list3) {
      const map = /* @__PURE__ */ new Map();
      for (const item of list3) {
        const k = key3(item.x, item.y);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(item);
      }
      return map;
    }
    function renderBoard(state, { selected, action, hover, preview: preview2, current }) {
      initBoard(state);
      const moving = ["move", "sprint", "disengage"].includes(action?.type);
      const unitsAt2 = group(values3(state.units).filter((u) => u.hp > 0 && !u.fled));
      const bodiesAt = group(corpses(state)), coversAt = group(values3(state.covers)), itemsAt = group(values3(state.interactives));
      const affected = new Set((!moving && preview2?.ok && preview2.cells || []).map((p) => key3(p.x, p.y)));
      const path = new Set((moving && preview2?.ok && preview2.path || []).map((p) => key3(p.x, p.y)));
      const risks = new Set((moving && preview2?.opportunities || []).map((o) => key3(o.from.x, o.from.y)));
      const hoverKey = hover ? key3(hover.x, hover.y) : null;
      const origin = state.units[selected] ?? current;
      const originZ = origin ? elevation(state, origin) : 0;
      let inspection = "";
      for (const [xy, slot] of cells) {
        const { cell } = slot;
        const x = Number(cell.dataset.x), y = Number(cell.dataset.y), tile = state.grid[y][x];
        const unit = unitsAt2.get(xy)?.[0], cover = coversAt.get(xy)?.[0], item = itemsAt.get(xy)?.[0];
        const chosen = !!unit && selected === unit.id, isHover = hoverKey === xy, edges = cliffs(state, x, y, tile);
        const reach = baseline.move.has(xy);
        cell.className = [
          "tactical-cell",
          tile.kind !== "floor" ? `terrain-${tile.kind}` : tile.z ? "terrain-plateau" : "",
          ...edges.map((c) => `cliff-${c}`),
          chosen ? "is-selected" : "",
          isHover ? "is-hovered" : "",
          isHover && preview2?.ok === false ? "is-invalid" : "",
          reach ? "is-reachable" : "",
          (action?.type === "interact" ? baseline.interact : baseline.attack).has(xy) || item && baseline.interact.has(xy) ? "is-in-range" : "",
          reach && (tile.kind === "slope" || tile.z !== originZ) ? "is-elevated-reach" : "",
          affected.has(xy) ? "axis-covered" : "",
          path.has(xy) ? "is-path" : "",
          risks.has(xy) ? "is-opportunity" : ""
        ].filter(Boolean).join(" ");
        cell.dataset.terrainType = tile.kind;
        cell.dataset.terrainZ = tile.z;
        cell.dataset.terrainElev = tile.z < 0 ? "neg" : tile.z >= 2 ? "pos2" : "pos1";
        for (const [name, v] of [["unitId", unit?.id], ["coverId", cover?.id], ["interactiveId", item?.id]]) {
          if (v) cell.dataset[name] = v;
          else delete cell.dataset[name];
        }
        cell.setAttribute("aria-pressed", String(chosen));
        const label = [
          `(${xy}) ${terrainLabel(tile)}`,
          edges.length ? "\u9661\u5D16\u8FB9" : "",
          unit ? `${side(unit.team)}${unit.name}\uFF0C\u751F\u547D ${unit.hp}/${unit.maxHp}${values3(unit.statuses).length ? `\uFF0C${values3(unit.statuses).map((s) => s.name).join("\u3001")}` : ""}` : "",
          cover ? coverText(cover) : "",
          item ? interactiveText(item) : "",
          reach ? "\u53EF\u4EE5\u8D70\u5230\u8FD9\u91CC" : ""
        ].filter(Boolean).join(" \xB7 ");
        cell.setAttribute("aria-label", label);
        if (isHover) inspection = label;
        const bodies = bodiesAt.get(xy) ?? [];
        const signature = JSON.stringify([tile, unit, cover, item, chosen, unit?.id === current?.id, bodies.map((b) => b.id), unit && portraitFor(unit.id)]);
        if (slot.signature === signature) continue;
        slot.signature = signature;
        slot.z.textContent = tile.kind !== "wall" && tile.z ? `z${sign2(tile.z)}` : "";
        const dead = bodies.map((body) => {
          const { node: node3 } = token(body.name, "\u2020", tile.z, "tactical-corpse", body.team);
          node3.dataset.corpseId = body.id;
          Object.assign(node3.style, { filter: "grayscale(1)", opacity: ".55", pointerEvents: "none" });
          node3.setAttribute("aria-label", `${body.name}\u7684\u5C38\u4F53`);
          return node3;
        });
        slot.units.replaceChildren(...dead, ...[
          unit && unitToken(state, unit, tile.z, chosen, unit.id === current?.id),
          cover && featureToken(cover, tile.z, true),
          item && featureToken(item, tile.z, false)
        ].filter(Boolean));
        slot.features.replaceChildren(...tile.kind !== "floor" ? [el2("span", "tactical-cell-tag", tile.kind === "wall" ? "#" : "\u5761")] : []);
      }
      $("terrain-inspector").textContent = inspection;
    }
    function bar(stat2, cur, max) {
      const node3 = el2("span", `ft-bar ${stat2}`);
      node3.style.setProperty("--ratio", ratio2(cur, max));
      node3.append(el2("i"), el2("span", "", `${stat2.toUpperCase()} ${cur}/${max}`));
      return node3;
    }
    function renderTurnOrder(state, current, selected) {
      const node3 = $("turn-order");
      const old = new Map([...node3.children].map((b) => [b.dataset.unitId, b]));
      const chips = state.order.map((id3) => {
        const u = get2(state.units, id3);
        if (!u) return null;
        const chip = old.get(id3) ?? Object.assign(el2("button"), { type: "button" });
        chip.className = `turn-chip${u.hp <= 0 ? " is-defeated" : ""}`;
        chip.dataset.unitId = id3;
        chip.dataset.faction = u.team;
        chip.replaceChildren(el2("span", "chip-face", Array.from(u.name)[0]), el2("span", "", u.name.split(" \xB7 ")[0]));
        chip.title = `${side(u.team)} ${u.name} \xB7 \u751F\u547D ${u.hp}/${u.maxHp}`;
        chip.setAttribute("aria-current", String(id3 === current?.id));
        chip.setAttribute("aria-pressed", String(id3 === selected));
        return chip;
      }).filter(Boolean);
      node3.replaceChildren(...chips);
      node3.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
    }
    function renderActor(state, u) {
      const node3 = $("actor-card");
      if (!u) {
        node3.replaceChildren(el2("span", "muted", "\u7B49\u5F85\u884C\u52A8"));
        delete node3.dataset.faction;
        return;
      }
      node3.dataset.faction = u.team;
      const name = el2("div", "ft-actor-name");
      name.append(el2("span", "", u.name), el2("small", "", `${side(u.team)} \xB7 \u7B2C ${state.round} \u56DE\u5408`));
      const bars = el2("div", "ft-bars");
      bars.append(bar("hp", u.hp, u.maxHp), bar("mp", u.mp, u.maxMp), bar("sp", u.sp, u.maxSp));
      const meta = el2("div", "ft-actor-meta");
      const ap = state.outcome ? 0 : u.ap;
      const crystals = el2("span", "", "");
      crystals.append(el2("span", "", "\u884C\u52A8\u529B "), ...[0, 1].map((i) => el2("span", `ap-crystal${i >= ap ? " is-used" : ""}`, i < ap ? "\u25C6" : "\u25C7")));
      crystals.setAttribute("aria-label", `\u5269\u4F59 ${ap} / 2 AP`);
      meta.append(crystals);
      if (u.moraleState && u.moraleState !== "steady") meta.append(el2("span", "ft-chip", `\u6218\u610F${moraleLabels[u.moraleState]}`));
      meta.append(el2("span", "ft-chip", `\u52A8\u4F5C${u.used?.action ? "\u5DF2\u7528" : "\u53EF\u7528"} \xB7 \u653B\u51FB${u.used?.attack ? "\u5DF2\u7528" : "\u53EF\u7528"}`));
      for (const s of values3(u.statuses)) meta.append(el2("span", "ft-chip", statusText(s)));
      node3.replaceChildren(el2("span", "ft-actor-face", Array.from(u.name)[0]), name, bars, meta);
    }
    function renderUnitCard(state, u, inspected) {
      const node3 = $("unit-card");
      if (inspected && !u) {
        node3.replaceChildren(el2("p", "", inspected.material ? coverText(inspected) : interactiveText(inspected)));
        return;
      }
      if (!u) {
        node3.replaceChildren(el2("p", "muted", "\u70B9\u51FB\u68CB\u76D8\u4E0A\u7684\u5355\u4F4D\u6216\u9876\u90E8\u7684\u5148\u653B\u5934\u50CF\u67E5\u770B\u60C5\u62A5\u3002"));
        return;
      }
      const head = el2("div", "ft-card-head");
      const face = el2("span", "ft-actor-face", Array.from(u.name)[0]);
      head.dataset.faction = u.team;
      const title = el2("div");
      const tile = state.grid[u.y][u.x];
      title.append(el2("strong", "", u.name), el2("div", "muted", `${side(u.team)} \xB7 \u6218\u610F\uFF1A${u.protagonist ? "\u81EA\u4E3B" : moraleLabels[u.moraleState ?? "steady"]} \xB7 \u4F4D\u4E8E (${u.x}, ${u.y})${tile.z ? `\uFF0C\u9AD8\u5EA6 ${tile.z}` : ""} \xB7 \u671D\u5411 ${ARROWS[u.facing?.join(",")] ?? "\xB7"}${u.hp ? "" : " \xB7 \u5DF2\u5012\u4E0B"}`));
      head.append(face, title);
      const wrap = el2("div", "ft-actor");
      wrap.dataset.faction = u.team;
      wrap.style.width = "100%";
      wrap.append(head);
      const bars = el2("div", "ft-bars");
      bars.append(bar("hp", u.hp, u.maxHp), bar("mp", u.mp, u.maxMp), bar("sp", u.sp, u.maxSp));
      const stats2 = el2("div", "ft-kv");
      for (const [id3, label] of Object.entries(STAT_NAMES)) {
        const s = el2("span", "", label);
        s.prepend(el2("b", "", u.stats[id3]));
        stats2.append(s);
      }
      const template = get2(state.equipment, get2(state.items, u.weapon)?.templateId);
      const melee = (template?.range ?? 1.5) <= 2 && !resourceDefinitions(template).some((n) => n.reloadable);
      const facts = el2("p", "muted", [
        `\u62A4\u7532 ${u.armor}`,
        `\u79FB\u52A8 ${u.move} \u683C`,
        `\u4F53\u578B ${bodySizeLabel(u)}`,
        `\u9AD8\u5EA6 z=${elevation(state, u)}${u.altitude ? `\uFF08\u79BB\u5730 ${u.altitude}\uFF09` : ""}`,
        `\u6301\u68B0\uFF1A${STANCES[u.stance] ?? "\u8F7B\u5251"}`,
        `\u5956\u52B1\u9AB0 ${u.bonusDice ?? 0}/2`,
        u.hp && melee ? u.reactionAvailable === false ? "\u672C\u8F6E\u501F\u673A\u653B\u51FB\u5DF2\u7528" : "\u53EF\u4EE5\u501F\u673A\u653B\u51FB" : ""
      ].filter(Boolean).join(" \xB7 "));
      const statusList = el2("ul", "ft-list");
      for (const s of values3(u.statuses)) {
        const li = el2("li");
        li.append(el2("b", "", statusText(s)), document_text(` ${duration(s)}`));
        if (s.description) li.append(el2("p", "", s.description));
        if (s.amount != null) li.append(el2("p", "", `\u5269\u4F59 ${s.amount} \u70B9`));
        statusList.append(li);
      }
      if (!statusList.children.length) statusList.append(el2("li", "muted", "\u6CA1\u6709\u72B6\u6001"));
      const gear = el2("ul", "ft-list");
      for (const id3 of [.../* @__PURE__ */ new Set([u.mainHand, u.offHand, u.shield, u.weapon, ...u.gear ?? []])].filter(Boolean)) {
        const inst = get2(state.items, id3), tpl = get2(state.equipment, inst?.templateId);
        const li = el2("li");
        li.dataset.instanceId = id3;
        li.append(el2("b", "", tpl?.name ?? id3));
        const counters = Object.entries(inst?.counters ?? {}).map(([k, n]) => `${resourceLabel(k)} ${n}`);
        if (counters.length) li.append(document_text(` \xB7 ${counters.join(" \xB7 ")}`));
        const text4 = [tpl?.description, ...(tpl?.effects ?? []).map(effectLabel)].filter(Boolean).join("\uFF1B");
        if (text4) li.append(el2("p", "", text4));
        gear.append(li);
      }
      if (!gear.children.length) gear.append(el2("li", "muted", "\u5F92\u624B"));
      const zones = values3(state.zones).filter((z) => Math.max(Math.abs(z.x - u.x), Math.abs(z.y - u.y)) <= z.radius);
      const parts = [wrap, bars, stats2, facts, el2("h3", "ft-section", "\u72B6\u6001"), statusList, el2("h3", "ft-section", "\u88C5\u5907"), gear];
      if (zones.length) parts.push(el2("h3", "ft-section", "\u6240\u5904\u533A\u57DF"), el2("p", "", zones.map((z) => `${z.name}\uFF1A\u6BCF\u56DE\u5408 ${z.damage} \u70B9${DAMAGE_TYPES[z.damageType] ?? ""}\u4F24\u5BB3`).join("\uFF1B")));
      node3.replaceChildren(...parts);
    }
    const document_text = (t) => doc.createTextNode(t);
    function renderFeatures(state) {
      const list3 = [...values3(state.covers).map((c) => [`\u{1F9F1} ${coverText(c)}`, c]), ...values3(state.interactives).map((i) => [`\u2734\uFE0F ${interactiveText(i)}`, i])];
      const ul = el2("ul", "ft-list");
      for (const [text4, f] of list3) ul.append(el2("li", "", `${text4} \xB7 \u4F4D\u4E8E (${f.x}, ${f.y})`));
      $("feature-cards").replaceChildren(ul);
    }
    function renderLog(state) {
      if (state.logs.length === logCount && last?.state?.scenarioId === state.scenarioId) return false;
      const node3 = $("combat-log");
      const stick = node3.parentElement ? node3.parentElement.scrollHeight - node3.parentElement.scrollTop - node3.parentElement.clientHeight < 40 : true;
      const entries2 = narrateAll(state.logs.slice(-160), state);
      const out = [];
      let round = null;
      for (const e of entries2) {
        if (e.round !== round) {
          round = e.round;
          out.push(el2("div", "ft-log-round", `\u7B2C ${round} \u56DE\u5408`));
        }
        if (e.quiet || !e.lines.length) {
          const row2 = el2("div", `ft-log-entry${e.quiet ? " is-quiet" : ""}`);
          row2.dataset.tone = e.tone;
          const t = el2("div", "ft-log-title");
          t.append(el2("span", "ft-log-icon", e.icon), el2("span", "", e.title));
          row2.append(t);
          out.push(row2);
          continue;
        }
        const row = el2("details", "ft-log-entry");
        row.dataset.tone = e.tone;
        const summary = el2("summary");
        summary.append(el2("span", "ft-log-icon", e.icon), el2("span", "", e.title));
        const ul = el2("ul");
        for (const line of e.lines) ul.append(el2("li", "", line));
        row.append(summary, ul);
        out.push(row);
      }
      node3.replaceChildren(...out.length ? out : [el2("p", "muted", "\u6218\u6597\u8FD8\u6CA1\u5F00\u59CB\u3002")]);
      if (stick && node3.parentElement) node3.parentElement.scrollTop = node3.parentElement.scrollHeight;
      const grew = logCount >= 0 && state.logs.length > logCount;
      logCount = state.logs.length;
      return grew;
    }
    function renderPreview(state, action, hover, range, p, actor) {
      const node3 = $("tactical-preview");
      const lines = [];
      const line = (text4, cls) => {
        const d = el2("div", `preview-line${cls ? ` ${cls}` : ""}`);
        if (typeof text4 === "string") d.textContent = text4;
        else d.append(...text4);
        lines.push(d);
        return d;
      };
      if (!actor || !action) {
        node3.replaceChildren();
        return;
      }
      const label = p?.name ?? range?.name ?? ACTION_LABELS[action.type] ?? "\u52A8\u4F5C";
      const cost = [range?.ap ? `${range.ap} AP` : "", range?.mp ? `${range.mp} MP` : "", range?.sp ? `${range.sp} SP` : ""].filter(Boolean).join(" + ");
      const head = [el2("b", "", label)];
      if (cost) head.push(document_text(`\uFF0C\u6D88\u8017 ${cost}`));
      if (range?.shape && range.shape !== "single") head.push(document_text(`\uFF0C${SHAPES[range.shape] ?? range.shape}`));
      line(head);
      if (p?.kind === "barrel") line(`\u7206\u70B8\u6CE2\u53CA ${p.cells.length} \u683C\uFF0C\u53EF\u80FD\u4F24\u53CA\u53CB\u65B9\u3002`);
      if (range?.effects?.length) line(`\u6548\u679C\uFF1A${range.effects.map(effectLabel).join("\uFF1B")}`);
      if (action.type === "brace" && range?.ok) line(`${range.coverId ? `\u501F\u52A9${get2(state.covers, range.coverId)?.name ?? "\u63A9\u4F53"}` : "\u539F\u5730"}\u9632\u5FA1\uFF1A\u53D7\u5230\u4F24\u5BB3\u51CF\u5C11 ${pct2(range.reduction)}\uFF0C\u6301\u7EED ${range.turns} \u56DE\u5408`);
      if (range?.ammo != null) line(`\u5F39\u836F ${range.ammo}${range.capacity ? ` / ${range.capacity}` : ""}`);
      if (p?.ok === false) line(`\u2716 ${p.error}`, "is-warning");
      else if (range?.ok === false) line(`\u2716 ${range.error}`, "is-warning");
      if (hover && p) {
        const geo = [];
        if (p.steps) geo.push(`\u8D70 ${p.steps} \u683C`);
        if (Number.isFinite(p.distance)) geo.push(`\u8DDD\u79BB ${p.distance.toFixed(1)} \u683C${p.range != null ? `\uFF08\u5C04\u7A0B ${p.range}\uFF09` : ""}`);
        if (p.dz) geo.push(p.dz > 0 ? `\u76EE\u6807\u9AD8\u51FA ${p.dz}` : `\u76EE\u6807\u4F4E ${-p.dz}`);
        if (p.teleport) geo.push(`\u77AC\u79FB\u5230 (${p.teleport.x}, ${p.teleport.y})`);
        if (geo.length) line(geo.join("\uFF0C"));
        if (p.opportunities?.length) line(`\u26A0 \u501F\u673A\u98CE\u9669\uFF1A${p.opportunities.map((o) => `${o.name}\uFF08\u4F60\u79BB\u5F00 ${o.from.x},${o.from.y} \u65F6\u51FA\u624B\uFF09`).join("\u3001")}\u3002\u6539\u7528\u300C\u64A4\u79BB\u300D\u53EF\u4EE5\u907F\u514D\u3002`, "is-warning");
        if (p.ok && action.type === "disengage") line("\u64A4\u79BB\uFF1A\u8FD9\u6B21\u79FB\u52A8\u4E0D\u4F1A\u5F15\u53D1\u501F\u673A\u653B\u51FB\u3002");
        for (const t of p.targets ?? []) {
          const row = line([el2("b", "", t.name)]);
          const bits = [];
          let chance = null;
          if (t.saveStat) {
            chance = 1 - t.saveChance;
            bits.push(`\u5BF9\u65B9\u9700\u8981${STAT_NAMES[t.saveStat] ?? t.saveStat}\u8C41\u514D\uFF08d20 ${sign2(t.saveBonus)}\uFF0C\u81F3\u5C11 ${t.saveDC}\uFF09\uFF0C\u751F\u6548\u7387 ${pct2(chance)}`);
          } else if (t.automatic) bits.push("\u5FC5\u5B9A\u547D\u4E2D");
          else if (Number.isFinite(t.hitChance)) {
            chance = t.hitChance;
            const dice3 = t.advantage > 0 ? "\u4F18\u52BF\uFF08\u63B7\u4E24\u9897\u53D6\u9AD8\uFF09" : t.advantage < 0 ? "\u52A3\u52BF\uFF08\u63B7\u4E24\u9897\u53D6\u4F4E\uFF09" : "d20";
            bits.push(`\u547D\u4E2D\u7387 ${pct2(t.hitChance)}\uFF1A${dice3} + \u547D\u4E2D ${t.accuracy}\uFF0C\u5BF9\u6297\u9632\u5FA1 ${t.defense}`);
            if (t.accuracySources) bits.push(`\u547D\u4E2D\u4E2D\u7684\u4F53\u578B\u4FEE\u6B63 ${sign2(t.accuracySources.size)}`);
          }
          const mods = [
            t.coverId ? `\u88AB${get2(state.covers, t.coverId)?.name ?? "\u63A9\u4F53"}\u906E\u6321 \u2212${t.cover}` : "",
            t.highGround ? t.highGround > 0 ? `\u5C45\u9AD8\u4E34\u4E0B ${sign2(t.highGround)}` : `\u4EF0\u653B ${t.highGround}` : "",
            t.flanked ? "\u5939\u51FB" : "",
            t.backstab ? "\u80CC\u523A" : "",
            t.recipientId && t.recipientId !== t.id ? `${get2(state.units, t.recipientId)?.name ?? t.recipientId}\u4F1A\u66FF\u5B83\u6321\u4E0B` : "",
            t.shield ? `\u5BF9\u65B9\u6709 ${t.shield} \u70B9\u62A4\u76FE` : ""
          ].filter(Boolean);
          if (mods.length) bits.push(mods.join("\uFF0C"));
          if (t.heal) bits.push(`\u6CBB\u7597 ${interval(t.heal)}`);
          else if (t.damage) bits.push(`${t.execution ? "\u5904\u51B3\uFF1A\u5FFD\u7565\u95EA\u907F\uFF0C\u547D\u4E2D\u81F3\u5C11\u5E73\u66B4\u51FB\u3002" : ""}\u547D\u4E2D\u540E\u4F24\u5BB3\u7EA6 ${interval(t.damage)}${t.savedDamage ? `\uFF08\u8C41\u514D\u6210\u529F\u5219 ${interval(t.savedDamage)}\uFF09` : ""}`);
          row.append(el2("div", "", bits.join("\u3002")));
          if (chance != null) {
            const odds = el2("div", "ft-odds"), track = el2("span", "ft-odds-bar"), fill = el2("i");
            fill.style.setProperty("--p", chance);
            track.append(fill);
            odds.append(track, el2("span", "", pct2(chance)));
            row.append(odds);
          }
        }
      }
      node3.replaceChildren(...lines);
    }
    function render(state, ui = {}) {
      const current = get2(state.units, state.order[state.turn]);
      const selected = ui.selectedId ?? current?.id;
      const action = ui.action ?? null, hover = ui.hover ?? null;
      const canAct = !ui.busy && current?.team === "blue" && !state.outcome;
      const run = (cmd) => canAct ? preview(state, cmd) : null;
      const fresh = last?.state !== state;
      if (fresh || last?.sprint !== ui.sprint || last?.canAct !== canAct) {
        const cells2 = (p) => new Set((p?.ok ? p.cells : []).map((c) => key3(c.x, c.y)));
        baseline = { move: cells2(run({ type: ui.sprint ? "sprint" : "move" })), attack: cells2(run({ type: "attack" })), interact: cells2(run({ type: "interact" })) };
      }
      const range = action ? run({ type: action.type, ...action.skillId ? { skillId: action.skillId } : {} }) : null;
      const aimed = ["move", "sprint", "disengage", "attack", "skill", "interact", "lock_on", "grapple", "disarm", "trip", "push", "shield_bash"].includes(action?.type);
      const result = aimed && hover ? run({ ...action, x: hover.x, y: hover.y }) : null;
      if (fresh) {
        const battleKind = Object.keys(moraleTypes).find((k) => moraleTypes[k] === state.battleType);
        $("battle-title").textContent = battleKind ? `${state.title} \xB7 ${battleKind}${state.battleType === "guard" ? "\uFF08\u84DD\u65B9\u575A\u5B88\u4E94\u8F6E\uFF09" : ""}` : state.title;
        $("round-badge").textContent = `\u7B2C ${state.round} \u56DE\u5408`;
        renderFeatures(state);
      }
      if (fresh || last?.selected !== selected) renderTurnOrder(state, current, selected);
      if (fresh) renderActor(state, current);
      $("sprint-indicator").textContent = ui.sprint ? "\u75BE\u8DD1\u8303\u56F4\u5DF2\u663E\u793A \xB7 \u8D70\u66F4\u8FDC\u9700\u8981 2 AP" : "";
      renderBoard(state, { selected, action, hover, preview: result, current });
      if (ui.target) renderPreview(state, action, hover, range, result, current);
      if (fresh || last?.selected !== selected || last?.inspectedId !== ui.inspectedId) {
        const feature = get2(state.covers, ui.inspectedId) ?? get2(state.interactives, ui.inspectedId);
        renderUnitCard(state, feature ? null : get2(state.units, selected), feature);
      }
      $("battle-status").textContent = state.outcome ? state.outcome === "draw" ? "\u6218\u6597\u7ED3\u675F\uFF1A\u5E73\u5C40" : `\u6218\u6597\u7ED3\u675F\uFF1A${state.outcome === "blue" ? "\u6211\u65B9\u80DC\u5229" : "\u654C\u65B9\u80DC\u5229"}` : canAct ? "\u70B9\u51FB\u683C\u5B50\u9009\u62E9\u76EE\u6807\uFF0C\u518D\u9009\u8981\u505A\u7684\u4E8B" : current ? `${current.name} \u6B63\u5728\u884C\u52A8\u2026\u2026` : "";
      last = { state, canAct, selected, inspectedId: ui.inspectedId, sprint: ui.sprint };
    }
    function renderControls(state) {
      const current = get2(state.units, state.order[state.turn]);
      $("end-turn").disabled = !(current?.team === "blue" && !state.outcome);
      $("ai-step").disabled = !!state.outcome || current?.team !== "red";
    }
    return { render, renderControls, renderLog };
  }

  // src/ui/animation.js
  var STEP_MS = 150;
  var BANNER_MS = 750;
  var RIBBON_MS = 1300;
  var ROLL_MS = 560;
  var HOLD_MS = 1050;
  var HIT_MS = 420;
  var CAPTION_LIFE = 6500;
  function createPlayback(root, { show, onIdle } = {}) {
    const doc = root.ownerDocument, win = doc.defaultView;
    const $ = (id3) => root.querySelector(`[id="${id3}"]`);
    const app = root.querySelector(".ft-app") ?? root;
    const queue = [];
    const waiters = /* @__PURE__ */ new Set();
    let running = false, skipping = false, speed = 1, generation = 0, current = null;
    const reduced = () => win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const canAnimate = (el3) => typeof el3?.animate === "function" && !reduced();
    function wait(ms) {
      if (skipping || speed <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          win.clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = win.setTimeout(done, ms * speed);
        waiters.add(done);
      });
    }
    async function play(el3, frames, options) {
      if (skipping || speed <= 0 || !canAnimate(el3)) return;
      const anim = el3.animate(frames, { ...options, duration: options.duration * speed });
      const stop = () => anim.finish();
      waiters.add(stop);
      try {
        await anim.finished;
      } catch {
      } finally {
        waiters.delete(stop);
      }
    }
    const frame = () => $("board-frame");
    const cellAt2 = (x, y) => root.querySelector(`#board [data-x="${x}"][data-y="${y}"]`);
    const tokenOf = (id3) => root.querySelector(`#board .axis-unit[data-unit-id="${id3}"]`);
    const positions = /* @__PURE__ */ new Map();
    const homes = /* @__PURE__ */ new Map();
    function center(x, y) {
      const cell = cellAt2(x, y), box = frame()?.getBoundingClientRect();
      if (!cell || !box) return null;
      const r = cell.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, w: r.width };
    }
    function whereIs(state, id3) {
      if (positions.has(id3)) return positions.get(id3);
      const thing = state.units?.[id3] ?? state.covers?.[id3] ?? state.interactives?.[id3];
      return thing ? { x: thing.x, y: thing.y } : null;
    }
    function offset(id3, to) {
      const home = homes.get(id3), a = home && center(home.x, home.y), b = center(to.x, to.y);
      return a && b ? `translate(${b.x - a.x}px, ${b.y - a.y}px)` : "none";
    }
    async function walk(state, id3, path) {
      const token = tokenOf(id3);
      if (!token || !path?.length) return;
      if (!homes.has(id3)) homes.set(id3, { ...state.units[id3] });
      token.classList.add("is-moving");
      const cell = token.closest(".tactical-cell");
      if (cell) cell.style.zIndex = "25";
      for (const step of path) {
        const from = token.style.transform || "none", to = offset(id3, step);
        token.style.transform = to;
        positions.set(id3, { x: step.x, y: step.y });
        await play(token, [{ transform: from }, { transform: to }], { duration: STEP_MS, easing: "ease-in-out" });
      }
    }
    async function blink(state, id3, to) {
      const token = tokenOf(id3);
      if (!token) return;
      if (!homes.has(id3)) homes.set(id3, { ...state.units[id3] });
      await play(token, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
      token.style.transform = offset(id3, to);
      positions.set(id3, { x: to.x, y: to.y });
      await play(token, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    async function lunge(state, attackerId, targetId) {
      const token = tokenOf(attackerId), a = whereIs(state, attackerId), b = whereIs(state, targetId);
      if (!token || !a || !b) return;
      const p = center(a.x, a.y), q = center(b.x, b.y);
      if (!p || !q) return;
      const far = Math.hypot(q.x - p.x, q.y - p.y) > p.w * 1.6;
      const base = token.style.transform && token.style.transform !== "none" ? `${token.style.transform} ` : "";
      const dx = (q.x - p.x) * (far ? 0.08 : 0.32), dy = (q.y - p.y) * (far ? 0.08 : 0.32);
      const swing = play(token, [
        { transform: `${base}translate(0,0)` },
        { transform: `${base}translate(${-dx * 0.3}px, ${-dy * 0.3}px)`, offset: 0.3 },
        { transform: `${base}translate(${dx}px, ${dy}px)`, offset: 0.6 },
        { transform: `${base}translate(0,0)` }
      ], { duration: 380, easing: "ease-out" });
      if (far) await bolt(p, q);
      await swing;
    }
    async function bolt(p, q) {
      const fx = $("board-fx");
      if (!fx || skipping || speed <= 0) return;
      const dot = doc.createElement("i");
      dot.className = "ft-bolt";
      Object.assign(dot.style, { left: `${p.x}px`, top: `${p.y}px` });
      fx.append(dot);
      await play(dot, [{ transform: "translate(-50%, -50%) scale(.6)" }, { transform: `translate(calc(${q.x - p.x}px - 50%), calc(${q.y - p.y}px - 50%)) scale(1)` }], { duration: 260, easing: "ease-in" });
      dot.remove();
    }
    function shake(id3, heavy) {
      const token = tokenOf(id3) ?? root.querySelector(`#board [data-cover="${id3}"], #board [data-interact="${id3}"]`);
      if (!token) return Promise.resolve();
      const base = token.style.transform && token.style.transform !== "none" ? `${token.style.transform} ` : "";
      const k = heavy ? 7 : 4;
      return play(token, [
        { transform: `${base}translateX(0)`, filter: "brightness(1)" },
        { transform: `${base}translateX(${-k}px)`, filter: "brightness(2.2) saturate(.4)", offset: 0.2 },
        { transform: `${base}translateX(${k}px)`, offset: 0.45 },
        { transform: `${base}translateX(${-k / 2}px)`, offset: 0.7 },
        { transform: `${base}translateX(0)`, filter: "brightness(1)" }
      ], { duration: 300 });
    }
    function fall(id3) {
      const token = tokenOf(id3);
      if (!token) return Promise.resolve();
      token.style.opacity = ".4";
      token.style.filter = "grayscale(1)";
      return play(token, [{ opacity: 1, filter: "grayscale(0)" }, { opacity: 0.4, filter: "grayscale(1)" }], { duration: 520 });
    }
    function float(state, id3, text4, tone, sub) {
      const fx = $("board-fx"), at = whereIs(state, id3), c = at && center(at.x, at.y);
      if (!fx || !c || skipping || speed <= 0) return;
      const node3 = doc.createElement("div");
      node3.className = `ft-float ${tone}`;
      node3.textContent = text4;
      if (sub) {
        const s = doc.createElement("small");
        s.textContent = sub;
        node3.append(s);
      }
      const jitter = (fx.childElementCount % 3 - 1) * 14;
      Object.assign(node3.style, { left: `${c.x + jitter}px`, top: `${c.y - c.w * 0.2}px` });
      fx.append(node3);
      const anim = canAnimate(node3) ? node3.animate([
        { opacity: 0, transform: "translate(-50%, -30%) scale(.6)" },
        { opacity: 1, transform: "translate(-50%, -80%) scale(1.15)", offset: 0.15 },
        { opacity: 1, transform: "translate(-50%, -110%) scale(1)", offset: 0.7 },
        { opacity: 0, transform: "translate(-50%, -160%) scale(.95)" }
      ], { duration: 1300 * Math.max(speed, 0.6), easing: "ease-out", fill: "forwards" }) : null;
      const remove2 = () => node3.remove();
      if (anim) anim.finished.then(remove2, remove2);
      else win.setTimeout(remove2, 1200);
    }
    async function banner(text4, sub, faction, ms = BANNER_MS) {
      const node3 = $("turn-banner");
      if (!node3 || skipping || speed <= 0) return;
      const b = doc.createElement("b"), s = doc.createElement("small");
      b.textContent = text4;
      s.textContent = sub;
      node3.replaceChildren(b, s);
      node3.dataset.faction = faction ?? "";
      node3.hidden = false;
      await play(node3, [{ opacity: 0, transform: "translateY(-50%) scaleY(.4)" }, { opacity: 1, transform: "translateY(-50%) scaleY(1)" }], { duration: 200, easing: "ease-out" });
      await wait(ms);
      await play(node3, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
      node3.hidden = true;
    }
    function ribbon(text4, faction) {
      const node3 = $("action-ribbon");
      if (!node3 || skipping || speed <= 0) return;
      node3.textContent = text4;
      node3.dataset.faction = faction ?? "";
      node3.hidden = false;
      win.clearTimeout(ribbon.timer);
      ribbon.timer = win.setTimeout(() => {
        node3.hidden = true;
      }, Math.max(RIBBON_MS * speed, 600));
    }
    function caption(entry) {
      const list3 = $("caption");
      if (!list3) return;
      const li = doc.createElement("li");
      li.dataset.tone = entry.tone;
      const icon = doc.createElement("span"), text4 = doc.createElement("span");
      icon.textContent = entry.icon;
      text4.textContent = entry.title;
      li.append(icon, text4);
      if (entry.lines?.length && !entry.roll) {
        const s = doc.createElement("small");
        s.textContent = entry.lines.at(-1);
        li.append(s);
      }
      list3.append(li);
      while (list3.children.length > 4) list3.firstElementChild.remove();
      win.setTimeout(() => li.remove(), CAPTION_LIFE);
    }
    const el2 = (tag, cls, text4) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text4 != null) n.textContent = String(text4);
      return n;
    };
    const signed2 = (n) => n >= 0 ? `+ ${n}` : `\u2212 ${-n}`;
    function die(value) {
      const d = el2("span", "ft-die is-rolling", "?");
      d.dataset.value = value;
      return d;
    }
    async function tumble(dice3) {
      if (skipping || speed <= 0) return;
      const spin = win.setInterval(() => {
        for (const d of dice3) d.textContent = 1 + Math.floor(Math.random() * 20);
      }, 55);
      await wait(ROLL_MS);
      win.clearInterval(spin);
    }
    function settle(dice3, kept) {
      let marked = false;
      for (const d of dice3) {
        const v = Number(d.dataset.value);
        d.classList.remove("is-rolling");
        d.textContent = Number.isFinite(v) ? v : "\u2013";
        if (v === 20) d.classList.add("is-nat20");
        if (v === 1) d.classList.add("is-nat1");
        if (kept != null && dice3.length > 1) {
          const keep = !marked && v === kept;
          if (keep) marked = true;
          d.classList.add(keep ? "is-kept" : "is-dropped");
        } else d.classList.add("is-kept");
      }
    }
    function formula(parts) {
      const row = el2("div", "ft-formula");
      for (const [value, label, cls] of parts) {
        const cell = el2("span", "");
        cell.style.display = "grid";
        cell.style.justifyItems = "center";
        cell.append(el2("b", cls ?? "", value));
        if (label) cell.append(el2("i", "", label));
        row.append(cell);
      }
      return row;
    }
    const op = (t) => [t, "", "op"];
    async function diceCard(roll) {
      const stage2 = $("dice-stage");
      if (!stage2 || !roll || skipping || speed <= 0) return;
      const card = el2("div", "ft-dice-card");
      card.dataset.tone = roll.tone ?? "hit";
      card.append(el2("div", "ft-dice-label", roll.label));
      const verdict = el2("div", "ft-verdict", roll.verdict);
      verdict.style.visibility = "hidden";
      let dice3 = [], kept = null, details = [];
      if (roll.kind === "d20") {
        dice3 = (roll.dice?.length ? roll.dice : [roll.kept]).map(die);
        kept = roll.kept;
        const row = el2("div", "ft-dice-row");
        row.append(...dice3);
        card.append(row);
        if (roll.mode && roll.mode !== "normal") card.append(el2("div", "ft-dice-mode", { advantage: "\u4F18\u52BF\uFF1A\u53D6\u8F83\u9AD8\u7684\u4E00\u9897", disadvantage: "\u52A3\u52BF\uFF1A\u53D6\u8F83\u4F4E\u7684\u4E00\u9897", middle: "\u63B7\u4E09\u9897\uFF0C\u53D6\u4E2D\u95F4\u503C" }[roll.mode]));
        const parts = [[kept, "\u9AB0\u503C"], op(roll.modifier >= 0 ? "+" : "\u2212"), [Math.abs(roll.modifier ?? 0), roll.modifierLabel ?? "\u52A0\u503C"], op("="), [roll.total, "\u5408\u8BA1", "total"]];
        if (roll.target != null) parts.push(op("vs"), [roll.target, roll.targetLabel ?? "\u76EE\u6807"]);
        details.push(formula(parts));
      } else if (roll.kind === "versus") {
        const box = el2("div", "ft-versus");
        for (const [i, sideRoll] of [roll.left, roll.right].entries()) {
          const sideBox = el2("div", "ft-versus-side");
          const d = die(sideRoll.dice?.[0]);
          dice3.push(d);
          sideBox.append(el2("span", "", sideRoll.name), d);
          const sum = el2("div", "ft-formula");
          sum.append(el2("i", "", sideRoll.bonus ? `${signed2(sideRoll.bonus)} =` : "="), el2("b", "total", sideRoll.total));
          details.push(sum);
          sideBox.append(sum);
          box.append(sideBox);
          if (!i) box.append(el2("span", "ft-versus-vs", "VS"));
        }
        card.append(box);
        for (const d of details) d.style.visibility = "hidden";
        details = details.map((d) => ({ reveal: () => {
          d.style.visibility = "";
        } }));
      } else if (roll.kind === "chance") {
        const bar = el2("div", "ft-chance"), fill = el2("i"), mark = el2("b");
        bar.style.setProperty("--chance", roll.chance);
        bar.style.setProperty("--rolled", 0);
        bar.append(fill, mark);
        card.append(bar, el2("div", "ft-dice-note", `\u9700\u8981\u63B7\u8FDB ${Math.round(roll.chance * 100)}% \u4EE5\u5185`));
        details.push({ reveal: () => bar.style.setProperty("--rolled", roll.rolled) });
        mark.style.transition = "left .4s ease-out";
      }
      for (const d of details) if (d instanceof win.HTMLElement) {
        d.style.visibility = "hidden";
        card.append(d);
      }
      card.append(verdict);
      if (roll.note) card.append(el2("div", "ft-dice-note", roll.note));
      stage2.replaceChildren(card);
      await play(card, [{ opacity: 0, transform: "translateY(-12px) scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" });
      await tumble(dice3);
      settle(dice3, kept);
      await wait(220);
      for (const d of details) d instanceof win.HTMLElement ? d.style.visibility = "" : d.reveal();
      await wait(260);
      verdict.style.visibility = "";
      await play(verdict, [{ opacity: 0, transform: "scale(1.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2, 1.4, .4, 1)" });
      await wait(HOLD_MS);
      await play(card, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-6px)" }], { duration: 180 });
      card.remove();
    }
    async function stage(log, state, ctx) {
      const entry = narrate(log, state);
      const d = log.detail ?? {};
      const unit = state.units?.[log.actor];
      switch (log.type) {
        case "turn":
          if (unit) await banner(`${unit.name}`, `${unit.team === "blue" ? "\u6211\u65B9\u884C\u52A8" : "\u654C\u65B9\u884C\u52A8"} \xB7 \u7B2C ${log.round} \u56DE\u5408`, unit.team, unit.team === "blue" ? BANNER_MS * 0.8 : BANNER_MS);
          return;
        case "action":
          ribbon(log.text, unit?.team);
          await wait(250);
          return;
        case "move":
        case "sprint":
        case "disengage":
          caption(entry);
          await walk(state, log.actor, d.path ?? (d.to ? [d.to] : []));
          return;
        case "knockback":
          caption(entry);
          if (d.to) {
            await shake(d.targetId, true);
            await walk(state, d.targetId, [d.to]);
          }
          return;
        case "teleport":
          caption(entry);
          if (d.to) await blink(state, d.targetId ?? log.actor, d.to);
          return;
        case "roll":
          ctx.crit = !!d.critical;
          await Promise.all([lunge(state, log.actor, d.targetId), diceCard(entry.roll)]);
          caption(entry);
          if (!d.hit) float(state, d.targetId, kept1(d) ? "\u5927\u5931\u624B" : "\u672A\u547D\u4E2D", "miss");
          return;
        case "damage":
          caption(entry);
          float(state, d.targetId, `\u2212${entry.amount}`, ctx.crit ? "crit" : "", ctx.crit ? "\u66B4\u51FB" : d.absorbed ? `\u62A4\u76FE\u5438\u6536 ${d.absorbed}` : void 0);
          await shake(d.targetId, ctx.crit);
          await wait(HIT_MS);
          return;
        case "heal":
          caption(entry);
          float(state, d.targetId ?? log.actor, `+${entry.amount}`, "heal");
          await wait(HIT_MS);
          return;
        case "defeat":
          caption(entry);
          float(state, d.targetId, "\u5012\u4E0B", "miss");
          await fall(d.targetId);
          return;
        case "status":
          caption(entry);
          float(state, d.targetId, entry.statusName ?? entry.title, "status");
          await wait(320);
          return;
        case "shield":
          caption(entry);
          float(state, d.targetId ?? log.actor, "\u62A4\u76FE", "heal");
          await wait(300);
          return;
        case "cover_damage":
        case "cover_break":
          caption(entry);
          await shake(d.coverId ?? d.targetId, log.type === "cover_break");
          return;
        case "opportunity":
          caption(entry);
          ribbon(entry.title, state.units?.[log.actor]?.team);
          await wait(500);
          return;
        default:
          if (entry.roll) {
            await diceCard(entry.roll);
            caption(entry);
            return;
          }
          if (!entry.quiet && entry.title) {
            caption(entry);
            await wait(280);
          }
      }
    }
    const kept1 = (d) => (d.selected ?? d.dice?.[0]) === 1;
    async function run() {
      if (running) return;
      running = true;
      const mine = generation;
      app.dataset.busy = "true";
      const skipButton = $("skip-playback");
      if (skipButton) skipButton.hidden = false;
      while (queue.length && mine === generation) {
        const { before, after, logs } = queue.shift();
        current = after;
        positions.clear();
        homes.clear();
        show(before, { busy: true });
        const ctx = { crit: false };
        for (const log of logs) {
          if (mine !== generation) break;
          await stage(log, { ...after, units: { ...after.units, ...before.units }, grid: before.grid, covers: before.covers, interactives: before.interactives }, ctx);
          if (log.type === "turn") ctx.crit = false;
        }
        if (mine !== generation) break;
        positions.clear();
        homes.clear();
        settleTokens();
        show(after, { busy: queue.length > 0 });
        if (queue.length) await wait(120);
      }
      if (mine === generation) finish();
    }
    function settleTokens() {
      for (const t of root.querySelectorAll("#board .axis-unit:not(.tactical-corpse)")) {
        t.classList.remove("is-moving");
        t.style.transform = t.style.opacity = t.style.filter = "";
      }
      for (const c of root.querySelectorAll("#board .tactical-cell")) c.style.zIndex = "";
    }
    function finish() {
      running = false;
      skipping = false;
      app.dataset.busy = "false";
      const skipButton = $("skip-playback");
      if (skipButton) skipButton.hidden = true;
      onIdle?.();
    }
    return {
      /** 加入一次状态变化。返回 false 表示应直接显示（不演出）。 */
      enqueue(before, after) {
        if (!before || speed <= 0 || doc.hidden) return false;
        const logs = after.logs.slice(before.logs.length);
        if (!logs.length) return false;
        queue.push({ before, after, logs });
        run();
        return true;
      },
      /** 立即结束全部演出并显示最终画面（同步完成）。 */
      skip() {
        if (!running) return;
        const last = queue.at(-1)?.after ?? current;
        this.reset();
        if (last) show(last, { busy: false });
        onIdle?.();
      },
      /** 战局被替换（撤销、读档、重开）时丢弃演出。 */
      reset() {
        generation++;
        queue.length = 0;
        for (const done of [...waiters]) done();
        $("dice-stage")?.replaceChildren();
        $("board-fx")?.replaceChildren();
        $("caption")?.replaceChildren();
        settleTokens();
        for (const id3 of ["turn-banner", "action-ribbon", "skip-playback"]) {
          const n = $(id3);
          if (n) n.hidden = true;
        }
        running = false;
        skipping = false;
        app.dataset.busy = "false";
      },
      setSpeed(value) {
        speed = Number.isFinite(value) && value >= 0 ? value : 1;
      },
      get busy() {
        return running;
      }
    };
  }

  // src/ui/target_card.js
  function placeTargetCard(card, anchor2, viewport = window.visualViewport) {
    const gutter = 8, gap = 6;
    const left = (viewport?.offsetLeft ?? 0) + gutter;
    const top = (viewport?.offsetTop ?? 0) + gutter;
    const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 2 * gutter;
    const bottom = top + (viewport?.height ?? window.innerHeight) - 2 * gutter;
    card.style.maxWidth = `${Math.max(0, right - left)}px`;
    card.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const a = anchor2.getBoundingClientRect();
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
  var THEMES = ["amethyst", "night-gold", "frost-silver"];
  var TARGETLESS = ["end_encounter", "switch_weapon", "brace", "block", "charge", "scan", "flee", "use_item", "detour", "reload", "end"];
  var PATH_NAMES = { units: "\u5355\u4F4D", items: "\u7269\u54C1", grid: "\u5730\u5F62", statuses: "\u72B6\u6001", counters: "\u8BA1\u6570", statusTemplates: "\u72B6\u6001\u6A21\u677F", covers: "\u63A9\u4F53", interactives: "\u4E92\u52A8\u70B9" };
  function describeProposal(result) {
    if (!result?.ok) return `\u2716 \u65E0\u6CD5\u6267\u884C\uFF1A${result?.error ?? "\u672A\u77E5\u9519\u8BEF"}`;
    if (result.revision != null && !result.diff) return `\u2714 \u5DF2\u5199\u5165\u6218\u5C40\uFF08\u7248\u672C ${result.revision}\uFF09\u3002`;
    const short = (v) => v == null ? "\u65E0" : typeof v === "object" ? v.name ? `\u300C${v.name}\u300D` : "\u4E00\u7EC4\u6570\u636E" : String(v);
    const lines = (result.diff ?? []).filter((d) => d.path[0] !== "logs").map((d) => {
      const path = d.path.map((p) => PATH_NAMES[p] ?? p).join(" \u203A ");
      if (!("before" in d)) return `\uFF0B \u65B0\u589E ${path}\uFF1A${short(d.after)}`;
      if (!("after" in d)) return `\uFF0D \u79FB\u9664 ${path}`;
      return `\u2022 ${path}\uFF1A${short(d.before)} \u2192 ${short(d.after)}`;
    });
    return [`\u8BD5\u7B97\u901A\u8FC7\uFF0C\u786E\u8BA4\u540E\u4F1A\u6539\u53D8 ${lines.length} \u5904\uFF1A`, ...lines].join("\n");
  }
  function initializeUI(root, { game = createGameAPI(), storageKey = "fated-tactical/battle-v1", crossedKey = "fated-tactical/carry-v1", signal, initialState, customBattle, onVictory, storage: storageArea } = {}) {
    const document2 = root.ownerDocument, window2 = document2.defaultView;
    const localStorage2 = storageArea ?? window2?.localStorage;
    const $ = (id3) => root.querySelector(`[id="${id3}"]`);
    let portraits = {};
    const view = createRenderer(root, (id3) => Object.hasOwn(portraits, id3) ? portraits[id3] : []);
    const scenario = $("scenario-select"), seed = $("seed-input");
    const storage = {
      getItem: (key4) => {
        try {
          return localStorage2?.getItem(key4) ?? null;
        } catch {
          return null;
        }
      },
      setItem: (key4, value) => {
        try {
          localStorage2?.setItem(key4, value);
        } catch {
        }
      },
      removeItem: (key4) => {
        try {
          localStorage2?.removeItem(key4);
        } catch {
        }
      }
    };
    let bagAim = null;
    let state, live, selectedId, action, hover, target2, sprint = false, timer, pending, carry, inspectedId, busy = false;
    let menuButtons = /* @__PURE__ */ new Map(), openDrawer = null, seenLogs = 0;
    const active = (s = state) => s?.units[s.order[s.turn]];
    const error2 = (value) => {
      const node3 = $("action-error");
      node3.hidden = !value;
      node3.textContent = value ?? "";
    };
    const safely = (fn) => {
      try {
        error2("");
        return fn();
      } catch (e) {
        error2(e.message);
        return void 0;
      }
    };
    const draw = () => view.render(state, { selectedId, action, hover: target2 ?? hover, sprint, target: target2, inspectedId, busy });
    const app = root.querySelector(".ft-app");
    function fitLayout() {
      if (!app) return;
      const box = app.getBoundingClientRect();
      if (!box.width) return;
      const hud = root.querySelector(".ft-hud-top").getBoundingClientRect(), dock = root.querySelector(".ft-dock").getBoundingClientRect();
      const side2 = dock.height > box.height * 0.7;
      app.style.setProperty("--hud-top", `${Math.round(hud.height)}px`);
      app.style.setProperty("--hud-bottom", side2 ? "0px" : `${Math.round(dock.height)}px`);
      app.style.setProperty("--hud-right", side2 ? `${Math.round(dock.width)}px` : "0px");
      const cell = $("board").querySelector(".tactical-cell")?.offsetWidth || 50;
      $("board-frame").dataset.compact = String(cell < 44);
    }
    const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
    let zoom = 1;
    function setZoom(next, anchor2) {
      const value = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
      const scroller = $("board-scroll"), frame = $("board-frame");
      const view2 = scroller.getBoundingClientRect();
      const at = anchor2 ?? { x: view2.left + view2.width / 2, y: view2.top + view2.height / 2 };
      const before = frame.getBoundingClientRect();
      const rx = (at.x - before.left) / (before.width || 1), ry = (at.y - before.top) / (before.height || 1);
      zoom = value;
      app.style.setProperty("--zoom", String(zoom));
      $("zoom-reset").textContent = `${Math.round(zoom * 100)}%`;
      $("zoom-out").disabled = zoom <= ZOOM_MIN;
      $("zoom-in").disabled = zoom >= ZOOM_MAX;
      const after = frame.getBoundingClientRect();
      scroller.scrollLeft += after.left + rx * after.width - at.x;
      scroller.scrollTop += after.top + ry * after.height - at.y;
      storage.setItem("fated-tactical/zoom", String(zoom));
      fitLayout();
      layoutTargetCard();
    }
    const ZOOM_STEP = 1.25;
    function bindZoom() {
      const scroller = $("board-scroll");
      on("zoom-in", "click", () => setZoom(zoom * ZOOM_STEP));
      on("zoom-out", "click", () => setZoom(zoom / ZOOM_STEP));
      on("zoom-reset", "click", () => setZoom(1));
      scroller.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        setZoom(zoom * Math.exp(-delta * (e.ctrlKey ? 0.01 : 15e-4)), { x: e.clientX, y: e.clientY });
      }, { passive: false, signal });
      let pan = null, dragged = false;
      scroller.addEventListener("pointerdown", (e) => {
        dragged = false;
        if (e.pointerType === "mouse" && e.button === 0) pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      }, { signal });
      scroller.addEventListener("pointermove", (e) => {
        if (!pan || e.pointerId !== pan.id) return;
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (!dragged && Math.hypot(dx, dy) <= 5) return;
        if (!dragged) {
          dragged = true;
          app.classList.add("is-panning");
          scroller.setPointerCapture?.(e.pointerId);
        }
        scroller.scrollLeft = pan.left - dx;
        scroller.scrollTop = pan.top - dy;
      }, { signal });
      for (const type of ["pointerup", "pointercancel"]) scroller.addEventListener(type, () => {
        pan = null;
        app.classList.remove("is-panning");
      }, { signal });
      scroller.addEventListener("click", (e) => {
        if (dragged) {
          e.stopPropagation();
          e.preventDefault();
          dragged = false;
        }
      }, { capture: true, signal });
      let pinch = null;
      const span = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) });
      scroller.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
          pinch = { d: span(e.touches).d, zoom };
          dragged = true;
        }
      }, { passive: true, signal });
      scroller.addEventListener("touchmove", (e) => {
        if (e.touches.length < 2 || !pinch) return;
        e.preventDefault();
        const m = span(e.touches);
        if (pinch.d > 0) setZoom(pinch.zoom * m.d / pinch.d, m);
      }, { passive: false, signal });
      scroller.addEventListener("touchend", (e) => {
        if (e.touches.length < 2) pinch = null;
      }, { passive: true, signal });
      scroller.addEventListener("gesturestart", (e) => e.preventDefault(), { signal });
      document2.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable]") || root.querySelector("dialog[open]")) return;
        if (!root.contains(e.target) && e.target !== document2.body) return;
        if (e.key === "+" || e.key === "=") setZoom(zoom * ZOOM_STEP);
        else if (e.key === "-" || e.key === "_") setZoom(zoom / ZOOM_STEP);
        else if (e.key === "0") setZoom(1);
        else return;
        e.preventDefault();
      }, { signal });
    }
    async function toggleFullscreen() {
      if (document2.fullscreenElement) {
        await document2.exitFullscreen().catch(() => {
        });
        return;
      }
      if (app.classList.contains("is-expanded")) {
        app.classList.remove("is-expanded");
        return;
      }
      try {
        await app.requestFullscreen({ navigationUI: "hide" });
      } catch {
        app.classList.add("is-expanded");
      }
    }
    function syncFullscreen() {
      const pressed = document2.fullscreenElement === app || app.classList.contains("is-expanded");
      $("fullscreen-toggle").setAttribute("aria-pressed", String(pressed));
      $("fullscreen-toggle").title = pressed ? "\u9000\u51FA\u5168\u5C4F" : "\u5168\u5C4F";
      window2.requestAnimationFrame(fitLayout);
    }
    let victoryPending = false;
    function finishPlayback() {
      busy = false;
      show(live);
      schedule();
      if (victoryPending) {
        victoryPending = false;
        onVictory?.();
      }
    }
    const playback = createPlayback(root, {
      show(next, opts) {
        busy = !!opts?.busy;
        show(next);
      },
      onIdle: finishPlayback
    });
    function show(next) {
      const changed = state !== next;
      state = next;
      if (changed && !target2) selectedId = state.units[selectedId]?.hp > 0 ? selectedId : active()?.id;
      draw();
      if (view.renderLog(state) && openDrawer !== "log") $("log-unread").hidden = false;
      refreshMeasurement();
    }
    function resetSelection() {
      bagAim = null;
      selectedId = active(live ?? state)?.id;
      action = null;
      hover = target2 = null;
      sprint = false;
      inspectedId = null;
      $("target-actions").hidden = true;
    }
    const measurement = [$("measure-origin"), $("measure-target")];
    function measure() {
      const [from, to] = measurement.map((input) => state.units[input.value]);
      if (!from || !to) {
        $("measure-readout").textContent = "\u6CA1\u6709\u53EF\u6D4B\u8DDD\u7684\u5355\u4F4D\u3002";
        return;
      }
      const dz = elevation(state, from) - elevation(state, to), cover = coverBetween(state, from, to);
      const height2 = dz > 0 ? `${from.name}\u9AD8\u51FA ${dz}` : dz < 0 ? `${from.name}\u4F4E ${-dz}` : "\u4E24\u8005\u540C\u9AD8";
      const sight = !hasLOS(state, from, to) ? "\u89C6\u7EBF\u88AB\u5899\u4F53\u6321\u4F4F" : cover ? `\u89C6\u7EBF\u7ECF\u8FC7${cover.name ?? cover.id}\uFF0C\u547D\u4E2D \u2212${cover.cover}` : "\u89C6\u7EBF\u901A\u7545";
      $("measure-readout").textContent = `${from.name} \u2192 ${to.name}
\u68CB\u76D8\u8DDD\u79BB ${distance3D(state, from, to).toFixed(1)} \u683C\uFF08\u534F\u8BAE\u8DDD\u79BB ${game.protocolDistance({ ...from, z: elevation(state, from) }, { ...to, z: elevation(state, to) })}\uFF09
${height2}\uFF0C${sight}`;
    }
    function refreshMeasurement() {
      const living2 = Object.values(state.units).filter((u) => u.hp > 0);
      for (const [i, input] of measurement.entries()) {
        const old = input.value;
        input.replaceChildren(...living2.map((u) => {
          const option = new window2.Option(`${u.name}\uFF08${u.x}, ${u.y}\uFF09`, u.id);
          option.dataset.faction = u.team;
          return option;
        }));
        input.value = living2.some((u) => u.id === old) ? old : (i ? living2.find((u) => u.team === "red") : active())?.id ?? living2.at(-1)?.id ?? "";
        input.dataset.faction = state.units[input.value]?.team ?? "";
      }
      measure();
    }
    function setDrawer(name) {
      const same3 = openDrawer === name;
      closeDrawer();
      if (same3 || !name) return;
      const panel = root.querySelector(`aside[data-drawer="${name}"]`);
      if (!panel) return;
      closeTarget();
      panel.hidden = false;
      openDrawer = name;
      $("drawer-scrim").hidden = false;
      root.querySelector(`[data-open-drawer="${name}"]`)?.setAttribute("aria-pressed", "true");
      if (name === "log") {
        $("log-unread").hidden = true;
        const scroller = $("combat-log").parentElement;
        scroller.scrollTop = scroller.scrollHeight;
      }
    }
    function closeDrawer() {
      if (!openDrawer) return;
      root.querySelector(`aside[data-drawer="${openDrawer}"]`).hidden = true;
      root.querySelector(`[data-open-drawer="${openDrawer}"]`)?.setAttribute("aria-pressed", "false");
      $("drawer-scrim").hidden = true;
      openDrawer = null;
    }
    if (customBattle) for (const node3 of root.querySelectorAll("[data-scenario-only]")) node3.hidden = true;
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
        game.createBattle({ kind: "custom_state", state: customBattle.restart({ seed: value }) });
        customBattle.seed = value;
        storage.setItem(`${storageKey}/seed`, String(value));
      } else game.createBattle({ scenarioId: scenario.value, ruleset: "protocol", seed: Number(seed.value), ...carry ? { persistentSnapshot: carry } : {} });
      closeDrawer();
    }
    function schedule() {
      window2.clearTimeout(timer);
      if (busy || playback.busy || live?.outcome || active(live)?.team !== "red" || !$("auto-ai").checked) return;
      timer = window2.setTimeout(() => safely(() => game.stepEnemy()), Number($("ai-speed").value) || 350);
    }
    function pauseAI() {
      $("auto-ai").checked = false;
      storage.setItem("fated-tactical/auto", "false");
      window2.clearTimeout(timer);
    }
    const continues = (a, b) => a && b && b.logs.length > a.logs.length && a.scenarioId === b.scenarioId && JSON.stringify(a.logs.at(-1)) === JSON.stringify(b.logs[a.logs.length - 1]);
    function onChange() {
      const before = live;
      live = game.getBattleState();
      if (!live.outcome) victoryPending = false;
      else if (before && !before.outcome) victoryPending = true;
      try {
        storage.setItem(storageKey, JSON.stringify(game.exportBattleSnapshot()));
      } catch {
        error2("\u6D4F\u89C8\u5668\u5B58\u50A8\u7A7A\u95F4\u4E0D\u8DB3\u6216\u5DF2\u5173\u95ED\uFF1B\u8BF7\u4E0B\u8F7D\u5FEB\u7167\u4FDD\u5B58\u6218\u5C40\u3002");
      }
      view.renderControls(live);
      resetSelection();
      if (continues(before, live) && playback.enqueue(before, live)) {
        window2.clearTimeout(timer);
        return;
      }
      playback.reset();
      finishPlayback();
    }
    const execute = (command) => safely(() => {
      const result = game.playAction(command);
      if (result && result.ok === false) error2(result.error);
      return result;
    });
    const pointFrom = (node3) => {
      const cell = node3?.closest?.("[data-x][data-y]");
      return cell && $("board").contains(cell) ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
    };
    const cellFor = (at) => $("board").querySelector(`[data-x="${at.x}"][data-y="${at.y}"]`);
    function layoutTargetCard() {
      const card = $("target-actions");
      if (!target2 || card.hidden) return;
      const anchor2 = cellFor(target2);
      if (!anchor2) return;
      const r = anchor2.getBoundingClientRect(), clip = $("board-scroll").getBoundingClientRect();
      if (r.right <= clip.left || r.left >= clip.right || r.bottom <= clip.top || r.top >= clip.bottom) {
        closeTarget();
        return;
      }
      placeTargetCard(card, anchor2, window2.visualViewport);
    }
    function closeTarget(restoreFocus = false) {
      const at = target2;
      if (!at && !bagAim && $("target-actions").hidden) return;
      bagAim = null;
      target2 = action = null;
      $("target-actions").hidden = true;
      draw();
      if (restoreFocus && at) cellFor(at)?.focus({ preventScroll: true });
    }
    function handlePoint(at, input = {}) {
      error2("");
      const unit = Object.values(state.units).find((u) => u.hp > 0 && u.x === at.x && u.y === at.y);
      const feature = [...Object.values(state.covers), ...Object.values(state.interactives)].find((v) => v.x === at.x && v.y === at.y);
      const actor = active();
      const canAct = actor?.team === "blue" && !state.outcome;
      const self = canAct && unit?.id === actor.id;
      if (bagAim) {
        const command = { type: "skill", skillId: bagAim, ...at };
        const plan = game.previewAction(command);
        if (!plan.ok) {
          error2(plan.error);
          return;
        }
        target2 = at;
        hover = at;
        action = command;
        bagAim = null;
        $("target-title").textContent = `${plan.name} \xB7 (${at.x}, ${at.y})`;
        $("action-toolbar").replaceChildren();
        $("target-options").hidden = true;
        $("target-actions").hidden = false;
        $("confirm-action").hidden = false;
        $("confirm-action").textContent = `\u786E\u8BA4\u4F7F\u7528${plan.name}`;
        draw();
        layoutTargetCard();
        return;
      }
      if (self) {
        const check = game.previewAction({ type: "sprint" });
        sprint = !sprint && check.ok;
        if (!check.ok) error2(`\u4E0D\u80FD\u75BE\u8DD1\uFF1A${check.error}`);
      }
      selectedId = unit?.id ?? actor?.id;
      inspectedId = unit ? null : feature?.id;
      target2 = at;
      hover = at;
      action = null;
      const bonus = $("bonus-dice-select");
      bonus.value = String(Math.min(Number(bonus.value), actor?.bonusDice ?? 0));
      const options = [];
      const add = (type, skill2, itemId, skillName) => {
        const command = {
          type,
          ...TARGETLESS.includes(type) ? {} : at,
          ...skill2 ? { skillId: skill2 } : {},
          ...itemId ? { itemId } : {},
          ...type === "attack" || type === "skill" ? { intent: $("intent-select").value || "normal", nonLethal: $("nonlethal-toggle").checked, bonusDice: Number(bonus.value) } : {}
        };
        const plan = game.previewAction(command);
        const limited = plan.usesLeft === 0 || plan.cooldownRemaining > 0;
        if ((plan.ok || limited || type === "flee" && plan.error?.includes("\u8FB9\u754C")) && !(plan.interactiveId && options.some((o) => o.plan.interactiveId === plan.interactiveId))) {
          const label = skillName ?? (skill2 || itemId || plan.interactiveId || type === "end_encounter" ? plan.name : ACTION_LABELS[type]);
          options.push({ command, plan, label });
        }
      };
      if (canAct) {
        if (self) for (const t of ["brace", "block", "charge", "scan", "flee", "use_item", "reload"]) add(t);
        else for (const t of [sprint ? "sprint" : "move", "disengage", "attack", "lock_on", "free_ally", "suppress", "grapple", "disarm", "trip", "push"]) add(t);
        if (self) for (const itemId of switchableWeapons(state, actor)) add("switch_weapon", null, itemId);
        add("interact");
        for (const skill2 of actor.skills) add("skill", skill2, void 0, state.skills[skill2]?.name);
        for (const [skill2, template] of equippedActiveSkills(state, actor)) add("skill", skill2, void 0, template.name);
        if (self) {
          for (const [skillId, count] of Object.entries(actor.inventory ?? {})) {
            const item = state.skills[skillId];
            if (!item?.backpackItem || count < 1) continue;
            const command = { type: "skill", skillId };
            const plan = game.previewAction(command);
            options.push({ command, plan, bag: true, label: `\u4F7F\u7528\u80CC\u5305\u7269\u54C1\uFF1A${item.name} \xD7${count}` });
          }
          add("end_encounter");
          add("end");
        }
      }
      const who = unit ? `${unit.team === "blue" ? "\u6211\u65B9" : "\u654C\u65B9"} ${unit.name}` : feature?.name ?? "\u7A7A\u5730";
      $("target-title").textContent = `${who} \xB7 (${at.x}, ${at.y})${self ? sprint ? " \xB7 \u75BE\u8DD1\u8303\u56F4" : "" : ""}`;
      $("target-options").hidden = !options.some((o) => ["attack", "skill"].includes(o.command.type));
      const toolbar = $("action-toolbar");
      toolbar.replaceChildren();
      menuButtons = /* @__PURE__ */ new Map();
      for (const choice of options) {
        const { command, plan, label } = choice;
        const button = document2.createElement("button");
        button.type = "button";
        button.className = "game-button";
        button.dataset.action = command.type;
        if (command.skillId) button.dataset.skillId = command.skillId;
        const cost = [plan.ap ? `${plan.ap} AP` : "", plan.mp ? `${plan.mp} MP` : "", plan.sp ? `${plan.sp} SP` : ""].filter(Boolean).join(" \xB7 ");
        const odds = plan.targets?.[0]?.hitChance;
        const note = [cost, Number.isFinite(odds) && !plan.targets[0].automatic ? `\u547D\u4E2D ${Math.round(odds * 100)}%` : "", plan.opportunities?.length ? "\u26A0 \u4F1A\u88AB\u501F\u673A" : ""].filter(Boolean).join(" \xB7 ");
        button.append(Number.isFinite(plan.usesLeft) ? `${label}\uFF08\u5269\u4F59 ${plan.usesLeft} \u6B21\uFF09` : label);
        const small = document2.createElement("small");
        small.textContent = note || ACTION_HINTS[command.type] || "";
        if (small.textContent) button.append(small);
        button.disabled = !plan.ok;
        button.title = plan.error || ACTION_HINTS[command.type] || label;
        if (!plan.ok) small.textContent = plan.error;
        if (!plan.ok && !small.parentNode) button.append(small);
        button.setAttribute("aria-pressed", "false");
        menuButtons.set(button, choice);
        toolbar.append(button);
      }
      if (!options.length) toolbar.textContent = canAct ? "\u8FD9\u4E00\u683C\u6CA1\u6709\u80FD\u505A\u7684\u4E8B\u3002" : "\u73B0\u5728\u4E0D\u662F\u4F60\u7684\u56DE\u5408\uFF0C\u53EA\u80FD\u67E5\u770B\u3002";
      const card = $("target-actions");
      card.hidden = false;
      card.scrollTop = 0;
      $("confirm-action").hidden = true;
      if (options.length) action = options[0].command;
      draw();
      layoutTargetCard();
      if (input.detail === 0) (toolbar.querySelector("button") || $("close-target")).focus({ preventScroll: true });
    }
    function handleAction(button) {
      const choice = menuButtons.get(button);
      if (!choice) return;
      if (choice.bag) {
        bagAim = choice.command.skillId;
        action = choice.command;
        target2 = null;
        sprint = false;
        $("target-actions").hidden = true;
        error2(`\u8BF7\u9009\u62E9${choice.plan.name}\u7684\u76EE\u6807\uFF08Esc \u53D6\u6D88\uFF09`);
        draw();
        return;
      }
      const { command, plan, label } = choice;
      error2("");
      if (!(["skill", "attack", "end_encounter"].includes(command.type) || plan.opportunities?.length)) {
        execute(command);
        return;
      }
      action = command;
      for (const btn of menuButtons.keys()) btn.setAttribute("aria-pressed", String(btn === button));
      const confirm = $("confirm-action");
      confirm.hidden = false;
      confirm.textContent = `\u786E\u8BA4${label}`;
      draw();
      layoutTargetCard();
    }
    function download(kind, value, format = "json") {
      const link = document2.createElement("a");
      const text4 = format === "txt";
      const url = window2.URL.createObjectURL(new window2.Blob([text4 ? value : JSON.stringify(value, null, 2)], { type: text4 ? "text/plain;charset=utf-8" : "application/json" }));
      link.href = url;
      link.download = `fated-${live.scenarioId}-${kind}.${format}`;
      link.click();
      window2.setTimeout(() => window2.URL.revokeObjectURL(url), 1e3);
    }
    const on = (id3, event, fn) => $(id3)?.addEventListener(event, fn, { signal });
    function bindControls() {
      for (const input of measurement) input.addEventListener("change", () => {
        input.dataset.faction = state.units[input.value]?.team ?? "";
        measure();
      }, { signal });
      on("scenario-select", "change", () => configure(scenario.value));
      for (const id3 of ["intent-select", "nonlethal-toggle", "bonus-dice-select"]) on(id3, "change", () => {
        if (target2) handlePoint(target2);
      });
      on("theme-select", "change", () => {
        root.dataset.dlcTheme = $("theme-select").value;
        storage.setItem("fated-tactical/theme", root.dataset.dlcTheme);
      });
      on("anim-speed", "change", () => {
        playback.setSpeed(Number($("anim-speed").value));
        storage.setItem("fated-tactical/anim", $("anim-speed").value);
      });
      on("clear-persistent", "click", () => {
        carry = null;
        storage.removeItem(crossedKey);
        scenarioDescription();
      });
      on("reset-button", "click", () => safely(restart));
      on("end-turn", "click", () => {
        playback.skip();
        if (active(live)?.team === "blue") execute({ type: "end" });
      });
      on("undo-button", "click", () => safely(() => {
        pauseAI();
        const r = game.undoLastCommit();
        if (!r.ok) error2(r.error);
      }));
      on("ai-step", "click", () => safely(() => {
        window2.clearTimeout(timer);
        playback.skip();
        game.stepEnemy();
      }));
      on("auto-ai", "change", () => {
        storage.setItem("fated-tactical/auto", String($("auto-ai").checked));
        schedule();
      });
      on("ai-speed", "change", () => {
        storage.setItem("fated-tactical/ai-speed", $("ai-speed").value);
        schedule();
      });
      on("skip-playback", "click", () => playback.skip());
      bindZoom();
      on("fullscreen-toggle", "click", () => {
        toggleFullscreen().then(syncFullscreen);
      });
      document2.addEventListener("fullscreenchange", syncFullscreen, { signal });
      if (window2.ResizeObserver) {
        let frame = 0;
        const observer = new window2.ResizeObserver(() => {
          window2.cancelAnimationFrame(frame);
          frame = window2.requestAnimationFrame(fitLayout);
        });
        for (const node3 of [app, root.querySelector(".ft-hud-top"), root.querySelector(".ft-dock")]) if (node3) observer.observe(node3);
        signal?.addEventListener("abort", () => observer.disconnect());
      } else window2.addEventListener("resize", fitLayout, { signal });
      const report = $("report-text"), reportMessage = $("report-message");
      on("export-report", "click", () => {
        report.value = game.exportBattleReportText();
        reportMessage.textContent = "";
        $("report-dialog").showModal();
      });
      on("copy-report", "click", async () => {
        try {
          await window2.navigator.clipboard.writeText(report.value);
          reportMessage.textContent = "\u5DF2\u590D\u5236\u3002";
        } catch {
          report.focus();
          report.select();
          reportMessage.textContent = "\u6D4F\u89C8\u5668\u4E0D\u5141\u8BB8\u81EA\u52A8\u590D\u5236\uFF0C\u8BF7\u6309 Ctrl+C \u6216\u4E0B\u8F7D TXT\u3002";
        }
      });
      on("download-report", "click", () => download("report", report.value, "txt"));
      on("export-snapshot", "click", () => download("battle", game.exportBattleSnapshot()));
      on("export-persistent", "click", () => download("persistent", game.exportPersistentCarryOver()));
      on("import-button", "click", () => $("import-snapshot").click());
      on("import-snapshot", "change", async (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (!file) return;
        try {
          if (file.size > 8 * 1024 * 1024) throw new Error("\u6587\u4EF6\u5927\u4E8E 8 MiB");
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
            storage.setItem(crossedKey, JSON.stringify(carry));
            scenarioDescription();
          } else {
            const restored = game.restoreBattleSnapshot(data);
            configure(restored.scenarioId);
            closeDrawer();
            if (restored.migratedFrom) {
              error2("\u5DF2\u6062\u590D\u65E7\u6218\u5C40\uFF0C\u65E7\u64A4\u9500\u8BB0\u5F55\u672A\u8FC1\u79FB\u3002");
              return;
            }
          }
          error2("");
        } catch (e) {
          error2(`\u5BFC\u5165\u5931\u8D25\uFF1A${e.message}`);
        }
      });
      const editor = $("sandbox-editor"), reason = $("sandbox-reason");
      const clearProposal = () => {
        pending = null;
        $("sandbox-commit").disabled = true;
      };
      for (const input of [editor, reason]) input.addEventListener("input", clearProposal, { signal });
      on("api-sandbox", "click", (event) => {
        const kind = event.target.closest("[data-example]")?.dataset.example;
        if (!kind) return;
        const unitId = selectedId ?? active(live)?.id;
        const examples = {
          counter: () => ({ type: "adjust_item_counter", instanceId: "soulblade-lan", counterKey: "souls", operation: "add", value: 1 }),
          status: () => ({ type: "upsert_status", unitId, statusId: "haste", options: { durationType: "persistent" } }),
          "custom-status": () => {
            const id3 = "bone_frost", apply = { type: "upsert_status", unitId, statusId: id3 };
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
        const example = examples[kind]?.();
        if (example) editor.value = JSON.stringify([example].flat(), null, 2);
        clearProposal();
      });
      on("sandbox-preview", "click", () => {
        clearProposal();
        let commands2;
        try {
          commands2 = JSON.parse(editor.value);
        } catch (e) {
          $("sandbox-output").textContent = `\u547D\u4EE4\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${e.message}`;
          return;
        }
        const result = game.proposeCommands(commands2, { baseRevision: game.getStateSummary().revision, reason: reason.value });
        $("sandbox-output").textContent = describeProposal(result);
        if (result.ok) {
          pending = result.proposalId;
          $("sandbox-commit").disabled = false;
        }
      });
      on("sandbox-commit", "click", () => {
        const result = game.commitProposal(pending);
        clearProposal();
        $("sandbox-output").textContent = describeProposal(result);
      });
      on("sandbox-undo", "click", () => {
        pauseAI();
        const result = game.undoLastCommit();
        clearProposal();
        $("sandbox-output").textContent = result.ok ? `\u21B6 \u5DF2\u64A4\u9500\u4E0A\u4E00\u6B21\u6539\u52A8\uFF08\u7248\u672C ${result.revision}\uFF09\u3002` : `\u2716 ${result.error}`;
      });
      on("resource-button", "click", () => {
        const unit = state.units[selectedId] ?? active();
        const previous = unit ? { hp: { current: unit.hp, max: unit.maxHp }, mp: { current: unit.mp, max: unit.maxMp }, sp: { current: unit.sp, max: unit.maxSp } } : void 0;
        $("resource-input").value = JSON.stringify({ stats: unit?.stats ?? { str: 4, agi: 4, con: 4, int: 4, spi: 4 }, tier: 1, previous }, null, 2);
        $("calculate-resources").click();
        $("resource-dialog").showModal();
      });
      on("calculate-resources", "click", () => {
        try {
          const r = game.calculatePrebattleResources(JSON.parse($("resource-input").value));
          $("resource-output").textContent = [
            `\u4E94\u7EF4\u5408\u8BA1 ${r.statSum} \xB7 MC ${r.mc} \xB7 \u96C6\u7FA4 ${r.count} \xB7 \u53EC\u5524\u521D\u59CB\u603B\u6570 ${r.summonCount}`,
            ...Object.entries(r.resources).map(([k, v]) => `${k.toUpperCase()} ${v.current}/${v.max}\uFF08\u4E58\u6570 ${r.multipliers[k]}\uFF0C\u672A\u53D6\u6574\u4E0A\u9650 ${v.rawMax}\uFF09`)
          ].join("\n");
        } catch (e) {
          $("resource-output").textContent = e.message;
        }
      });
      on("close-target", "click", () => closeTarget(true));
      on("confirm-action", "click", () => {
        if (target2 && action) execute(action);
      });
      on("action-toolbar", "click", (e) => {
        const button = e.target.closest("[data-action]");
        if (button) handleAction(button);
      });
      on("turn-order", "click", (e) => {
        const button = e.target.closest("[data-unit-id]");
        if (!button) return;
        selectedId = button.dataset.unitId;
        inspectedId = null;
        closeTarget();
        draw();
        setDrawer(openDrawer === "unit" ? null : "unit");
      });
      document2.addEventListener("pointerdown", (e) => {
        if (target2 && !$("target-actions").contains(e.target) && !pointFrom(e.target)) closeTarget();
      }, { signal });
      document2.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || root.querySelector("dialog[open]")) return;
        if (target2 || bagAim) closeTarget(true);
        else if (openDrawer) closeDrawer();
        else playback.skip();
      }, { signal });
      for (const [node3, event] of [[window2, "resize"], [window2.visualViewport, "resize"], [window2.visualViewport, "scroll"]]) node3?.addEventListener(event, layoutTargetCard, { signal });
      window2.addEventListener("scroll", layoutTargetCard, { capture: true, passive: true, signal });
      const board = $("board");
      board.addEventListener("click", (e) => {
        const at = pointFrom(e.target);
        if (!at) return;
        if (playback.busy) playback.skip();
        handlePoint(at, e);
      }, { signal });
      const hoverPoint = (point2) => {
        hover = point2;
        if (!target2) draw();
      };
      board.addEventListener("pointerover", (e) => {
        const at = pointFrom(e.target), before = pointFrom(e.relatedTarget);
        if (at && (!before || at.x !== before.x || at.y !== before.y)) hoverPoint(at);
      }, { signal });
      board.addEventListener("pointerleave", () => hoverPoint(null), { signal });
      board.addEventListener("focusin", (e) => {
        const at = pointFrom(e.target);
        if (at) hoverPoint(at);
      }, { signal });
      board.addEventListener("focusout", (e) => {
        if (!board.contains(e.relatedTarget)) hoverPoint(null);
      }, { signal });
      root.addEventListener("click", (e) => {
        const opener = e.target.closest("[data-open-drawer]");
        if (opener) setDrawer(opener.dataset.openDrawer);
        else if (e.target.closest("[data-close-drawer]") || e.target === $("drawer-scrim")) closeDrawer();
      }, { signal });
    }
    configure("ruins");
    let snapshot = initialState;
    try {
      if (!initialState || customBattle?.restoreSaved) {
        const saved = JSON.parse(storage.getItem(storageKey));
        if (saved?.state?.scenarioId === initialState?.scenarioId || !initialState) snapshot = saved ?? initialState;
      }
      carry = JSON.parse(storage.getItem(crossedKey));
    } catch {
    }
    $("auto-ai").checked = storage.getItem("fated-tactical/auto") !== "false";
    const theme = storage.getItem("fated-tactical/theme");
    if (THEMES.includes(theme)) {
      root.dataset.dlcTheme = theme;
      $("theme-select").value = theme;
    } else if (THEMES.includes(root.dataset.dlcTheme)) $("theme-select").value = root.dataset.dlcTheme;
    for (const [id3, key4] of [["anim-speed", "fated-tactical/anim"], ["ai-speed", "fated-tactical/ai-speed"]]) {
      const value = storage.getItem(key4);
      if (value != null && [...$(id3).options].some((o) => o.value === value)) $(id3).value = value;
    }
    playback.setSpeed(Number($("anim-speed").value));
    try {
      if (snapshot) {
        const restored = snapshot.kind === "battle" ? game.restoreBattleSnapshot(snapshot) : game.createBattle({ kind: "custom_state", state: snapshot });
        if (restored.migratedFrom) error2("\u5DF2\u7EED\u63A5\u65E7\u6218\u5C40\uFF0C\u65E7\u64A4\u9500\u8BB0\u5F55\u672A\u8FC1\u79FB\u3002");
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
    bindControls();
    const unsubscribe = game.subscribe(() => {
      if (pending) {
        pending = null;
        $("sandbox-commit").disabled = true;
      }
      onChange();
    });
    onChange();
    fitLayout();
    setZoom(Number(storage.getItem("fated-tactical/zoom")) || 1);
    seenLogs = live.logs.length;
    $("log-unread").hidden = seenLogs <= 2;
    return {
      setPortraits(next) {
        portraits = next;
        draw();
      },
      loadState(next) {
        const result = next?.kind === "battle" ? game.restoreBattleSnapshot(next) : game.createBattle({ kind: "custom_state", state: next });
        if (!customBattle) configure(result.scenarioId);
        error2("");
        return result;
      },
      getState: () => game.getBattleState(),
      exportBattleReportText: () => game.exportBattleReportText(),
      exportMvuPatch: () => ({ kind: "battle", state: game.getBattleState() }),
      api: game,
      destroy() {
        window2.clearTimeout(timer);
        playback.reset();
        closeDrawer();
        if (typeof unsubscribe === "function") unsubscribe();
      }
    };
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
    .battle-axis .axis-unit-portrait {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      object-fit: cover;
      object-position: center 30%;
      border: 1.5px solid var(--axis-side-border, rgb(var(--neutral-rgb) / .65));
      border-radius: 50%;
      background: rgb(var(--shade-rgb) / .88);
    }
    .battle-axis .axis-unit-portrait:not([hidden]) + .axis-unit-fallback-avatar { visibility: hidden; }
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
  var tacticalUI = `/* \u5168\u5C4F\u6218\u65D7\u5E03\u5C40\u3002\u5730\u5F62\u3001\u5175\u724C\u7B49\u539F r7 \u7F8E\u672F\u89C4\u5219\u5728 battle-theme.css\uFF0C\u8FD9\u91CC\u53EA\u505A\u5E03\u5C40\u3001\u62BD\u5C49\u4E0E\u6F14\u51FA\u3002 */
:root { color-scheme: dark; --ease-out: cubic-bezier(.23, 1, .32, 1); --ease-spring: cubic-bezier(.34, 1.56, .64, 1); }
body { margin: 0; background: var(--ink-2); }

.ft-app {
  /* --hud-top / --hud-bottom / --hud-right \u7531 main.js \u6309 HUD \u5B9E\u6D4B\u5C3A\u5BF8\u5199\u5165\uFF1B\u8FD9\u91CC\u662F\u9996\u5E27\u9ED8\u8BA4\u503C */
  --hud-top: 58px; --hud-bottom: 118px; --hud-right: 0px; --zoom: 1; --drawer-w: min(400px, 92vw);
  --safe-t: env(safe-area-inset-top, 0px); --safe-r: env(safe-area-inset-right, 0px); --safe-b: env(safe-area-inset-bottom, 0px); --safe-l: env(safe-area-inset-left, 0px);
  --tone-hit: #f2d58b; --tone-crit: #ffd700; --tone-miss: #a9b0c2; --tone-damage: #ff9a90;
  --tone-heal: #96e6b3; --tone-status: #c6aef2; --tone-move: #a6e3c8; --tone-turn: #dfc080; --tone-defeat: #e07a7a;
  position: relative; box-sizing: border-box; width: 100%; height: min(84vh, 860px); height: min(84dvh, 860px); min-height: min(540px, 80vh); min-height: min(540px, 80dvh); overflow: hidden;
  color: var(--text); font-family: var(--font-body); font-size: 14px; line-height: 1.5;
  background:
    radial-gradient(ellipse 70% 60% at 50% 42%, rgb(var(--glow-rgb) / .16), transparent 70%),
    radial-gradient(ellipse at 50% 120%, rgb(var(--accent-rgb) / .1), transparent 60%),
    var(--ink-2);
  border-radius: 10px;
}
.ft-app.ft-fullscreen, .ft-app.is-expanded { position: fixed; z-index: 30; inset: 0; width: auto; height: auto; min-height: 0; border-radius: 0; }
.ft-app.is-expanded { z-index: 2147483000; }
.ft-app:fullscreen { width: 100%; height: 100%; min-height: 0; border-radius: 0; }
.ft-app *, .ft-app *::before, .ft-app *::after { box-sizing: border-box; }
.ft-app [hidden] { display: none !important; }
.ft-app :is(button, select, input, summary, textarea, [tabindex]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

/* ---------- \u821E\u53F0\u4E0E\u68CB\u76D8 ---------- */
.ft-stage { position: absolute; inset: 0; container-type: size; }
.ft-scroll {
  position: absolute; inset: 0; display: grid; place-items: start; overflow: auto; touch-action: pan-x pan-y;
  padding: calc(var(--hud-top) + 10px) calc(var(--hud-right) + 16px) calc(var(--hud-bottom) + 10px) calc(var(--safe-l) + 16px);
  overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent;
}
.ft-board.battle-axis {
  /* --cell-fit \u8BA9\u6574\u76D8\u521A\u597D\u653E\u8FDB\u53EF\u89C6\u533A\uFF08\u5373 100%\uFF09\uFF1B--zoom \u7531\u7F29\u653E\u63A7\u4EF6\u5199\u5165\uFF0C\u653E\u5927\u540E\u68CB\u76D8\u53EF\u62D6\u52A8 */
  --cell-fit: min(calc((100cqw - 44px - var(--hud-right) - var(--safe-l)) / var(--cols, 10) - 2px), calc((100cqh - var(--hud-top) - var(--hud-bottom) - 32px) / var(--rows, 10) - 2px));
  --cell: max(14px, calc(var(--cell-fit) * var(--zoom, 1)));
  position: relative; width: max-content; margin: auto; padding: 0; border: 0; background: none; box-shadow: none;
}
.ft-board.battle-axis .tactical-grid {
  grid-template-columns: repeat(var(--cols, 10), var(--cell));
  grid-template-rows: repeat(var(--rows, 10), var(--cell));
  gap: 2px; padding: 5px; border-radius: 9px;
  box-shadow: 0 18px 50px rgb(0 0 0 / .45), 0 0 0 1px rgb(var(--accent-rgb) / .16), inset 0 0 40px rgb(0 0 0 / .35);
}
.ft-board.battle-axis .tactical-cell {
  min-height: 0; height: var(--cell); padding: 2px; color: var(--text); font: inherit; cursor: pointer;
  align-items: stretch; justify-content: center; overflow: visible; transition: border-color .14s ease, background-color .14s ease;
}
.ft-board .tactical-cell-coord { opacity: .45; font-size: 8px; }
.ft-board .tactical-cell-units { display: flex; justify-content: center; align-items: center; flex: 1; min-height: 0; margin: 0; gap: 2px; flex-wrap: nowrap; }
.ft-board .tactical-cell-features { position: absolute; top: 1px; right: 3px; margin: 0; }
.ft-board.battle-axis .tactical-cell .axis-unit { width: calc(var(--cell) - 10px); max-width: 100%; padding: 2px; pointer-events: none; transform: none; transition: none; will-change: transform; }
.ft-board.battle-axis .axis-token-head, .ft-board.battle-axis .axis-unit-fallback-avatar { width: calc(var(--cell) * .42); height: calc(var(--cell) * .42); }
.ft-board.battle-axis .axis-unit-fallback-avatar { font-size: calc(var(--cell) * .2); }
.ft-board.battle-axis .axis-unit-name { max-width: 100%; font-size: max(9px, calc(var(--cell) * .14)); }
.ft-board.battle-axis .axis-z-badge { min-width: 13px; height: 13px; right: -5px; padding-inline: 2px; font-size: 8px; line-height: 11px; }
.ft-board.battle-axis .axis-facing-pip { min-width: 12px; height: 12px; font-size: 8px; line-height: 10px; }
.ft-board .axis-unit.is-active { box-shadow: 0 0 0 2px var(--gold-bright), 0 0 16px rgb(var(--gold-rgb) / .55); animation: ft-breathe 1.8s ease-in-out infinite; }
.ft-board .axis-unit.is-moving { z-index: 30; }
@keyframes ft-breathe { 50% { box-shadow: 0 0 0 2px var(--gold-bright), 0 0 4px rgb(var(--gold-rgb) / .2); } }

.token-meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; width: 100%; }
.token-meter, .token-meter > i { display: block; height: 3px; border-radius: 2px; }
.token-meter { background: rgba(0, 0, 0, .6); overflow: hidden; }
.token-meter > i { width: calc(100% * var(--resource-ratio)); background: var(--meter-color); transition: width .45s var(--ease-out); }
.token-meter.hp { --meter-color: #e78886; }
.token-meter.mp { --meter-color: #86b8e6; }
.token-meter.sp { --meter-color: #80cc9a; }
.token-statuses { position: absolute; top: 1px; left: -3px; color: #e6dbfb; background: #4a3061; border: 1px solid #8168ac; border-radius: 4px; padding-inline: 2px; line-height: 1.2; font-size: 9px; }

.battle-axis .tactical-cell.is-reachable { border-color: rgba(125, 214, 157, .72); background-image: linear-gradient(150deg, rgba(109, 186, 137, .24), rgba(46, 104, 76, .3)); }
.battle-axis .tactical-cell.is-elevated-reach { border-style: dashed; background-image: repeating-linear-gradient(135deg, rgba(92, 184, 147, .28) 0 4px, rgba(57, 118, 90, .16) 4px 8px); }
.battle-axis .tactical-cell.is-in-range:not(.axis-covered) { border-color: rgba(110, 160, 214, .75); background-color: rgba(69, 137, 208, .22); }
.battle-axis .tactical-cell.is-in-range.is-reachable { border-color: #86cdab; }
.battle-axis .tactical-cell.is-in-range.is-reachable::after { content: ''; pointer-events: none; position: absolute; inset: auto 4px 3px auto; width: 7px; height: 7px; border-radius: 50%; background: #7dbbfe; }
.battle-axis .tactical-cell.is-path { border-color: #aeedd3; box-shadow: inset 0 0 0 1px #aeedd3; }
.battle-axis .tactical-cell.is-hovered, .battle-axis .tactical-cell.is-selected { outline: 2px solid var(--gold); outline-offset: -2px; }
.battle-axis .tactical-cell.is-invalid { outline-color: #ed9b8f; }
.battle-axis .tactical-cell.is-opportunity { outline: 2px solid #e5a35e; outline-offset: -3px; }
.battle-axis .tactical-cell:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; z-index: 2; }
.ft-app[data-busy="true"] .battle-axis .tactical-cell:is(.is-reachable, .is-in-range) { background-image: none; background-color: transparent; }

/* \u7279\u6548\u5C42\uFF1A\u6D6E\u5B57\u3001\u5F39\u9053\u3001\u843D\u70B9 */
.ft-tokens, .ft-fx { position: absolute; inset: 0; pointer-events: none; }
.ft-fx { z-index: 40; }
.ft-float {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; pointer-events: none;
  font: 800 22px/1 var(--font-display); color: var(--tone-damage);
  text-shadow: 0 2px 0 #000, 0 0 10px rgb(0 0 0 / .9), 0 0 18px currentColor;
}
.ft-float.heal { color: var(--tone-heal); }
.ft-float.status { color: var(--tone-status); font-size: 14px; font-weight: 700; }
.ft-float.miss { color: var(--tone-miss); font-size: 16px; }
.ft-float.crit { color: var(--tone-crit); font-size: 32px; }
.ft-float small { display: block; margin-top: 2px; font-size: 11px; font-weight: 600; text-align: center; letter-spacing: .1em; }
.ft-bolt { position: absolute; height: 3px; transform-origin: 0 50%; border-radius: 3px; background: linear-gradient(90deg, transparent, var(--gold-bright) 70%, #fff); box-shadow: 0 0 10px var(--gold-bright); }
.ft-ring { position: absolute; width: var(--cell); height: var(--cell); transform: translate(-50%, -50%); border: 2px solid currentColor; border-radius: 50%; color: var(--tone-crit); }
.ft-mark { position: absolute; width: var(--cell); height: var(--cell); transform: translate(-50%, -50%); border-radius: 6px; border: 2px solid var(--tone-damage); box-shadow: inset 0 0 14px rgb(255 110 100 / .5); }

/* ---------- HUD ---------- */
.ft-hud-top {
  position: absolute; inset: 0 0 auto; z-index: 50; display: flex; align-items: center; gap: 14px; min-height: 58px;
  padding: max(8px, var(--safe-t)) max(14px, var(--safe-r)) 8px max(14px, var(--safe-l));
  background: linear-gradient(180deg, rgb(var(--shade-rgb) / .92), rgb(var(--shade-rgb) / .55) 70%, transparent);
}
.ft-hud-title { display: grid; flex: none; line-height: 1.2; }
.ft-eyebrow { color: var(--gold-soft); font-size: 10px; letter-spacing: .24em; }
.ft-title { color: var(--accent-text); font: 700 16px/1.25 var(--font-display); text-shadow: var(--title-shadow); white-space: nowrap; }
.ft-round { color: var(--text-muted); font-size: 11px; }
.ft-initiative { display: flex; flex: 1; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: none; padding-block: 2px; }
.ft-initiative::-webkit-scrollbar { display: none; }
.ft-app .turn-chip {
  flex: none; display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 9px 2px 3px; border: 1px solid var(--line-mid); border-radius: 15px;
  background: rgb(var(--shade-rgb) / .75); color: var(--text-soft); font: inherit; font-size: 12px; cursor: pointer; transition: transform .2s var(--ease-out), background-color .2s;
}
.ft-app .turn-chip .chip-face { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--raised-b); font-size: 11px; }
.ft-app .turn-chip[data-faction="blue"] { border-color: var(--blue-line); color: var(--blue-text); }
.ft-app .turn-chip[data-faction="blue"] .chip-face { background: #1e3753; }
.ft-app .turn-chip[data-faction="red"] { border-color: var(--red-line); color: var(--red-text); }
.ft-app .turn-chip[data-faction="red"] .chip-face { background: #4d252c; }
.ft-app .turn-chip[aria-current="true"] { background: linear-gradient(160deg, var(--btn-a), var(--btn-b)); color: var(--btn-text); box-shadow: 0 0 0 1px var(--gold), 0 0 12px rgb(var(--gold-rgb) / .35); transform: translateY(1px) scale(1.04); }
.ft-app .turn-chip.is-defeated { opacity: .45; text-decoration: line-through; }
.ft-hud-menu { display: flex; flex: none; gap: 6px; }
.ft-icon-button {
  position: relative; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--line-mid); border-radius: 9px;
  background: linear-gradient(160deg, var(--raised-a), var(--raised-b)); color: var(--accent-text); font-size: 17px; cursor: pointer;
  transition: transform .15s var(--ease-out), border-color .15s;
}
.ft-icon-button:active { transform: scale(.94); }
.ft-icon-button[aria-pressed="true"] { border-color: var(--gold); background: linear-gradient(160deg, var(--btn-a), var(--btn-b)); }
.ft-dot { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--gold-bright); box-shadow: 0 0 6px var(--gold-bright); }
@media (hover: hover) and (pointer: fine) { .ft-icon-button:hover { border-color: var(--gold); } }

.ft-inspector {
  position: absolute; z-index: 45; top: calc(var(--hud-top) + 2px); left: 50%; transform: translateX(-50%); max-width: min(720px, 92%); margin: 0; padding: 3px 12px;
  border-radius: 12px; background: rgb(var(--shade-rgb) / .72); color: var(--text-muted); font-size: 12px; text-align: center; pointer-events: none;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.ft-inspector:empty { display: none; }

.ft-dock {
  position: absolute; inset: auto 0 0; z-index: 50; display: flex; align-items: flex-end; gap: 14px;
  padding: 12px max(14px, var(--safe-r)) max(12px, var(--safe-b)) max(14px, var(--safe-l));
  background: linear-gradient(0deg, rgb(var(--shade-rgb) / .95), rgb(var(--shade-rgb) / .6) 72%, transparent); pointer-events: none;
}
.ft-dock > * { pointer-events: auto; }
.ft-actor {
  display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: center; width: min(340px, 46%); padding: 9px 11px;
  border: 1px solid var(--line-mid); border-radius: 10px; background: var(--panel-bg); box-shadow: 0 8px 22px rgb(0 0 0 / .4);
}
.ft-actor[data-faction="blue"] { border-color: rgb(95 147 200 / .7); }
.ft-actor[data-faction="red"] { border-color: rgb(192 114 122 / .7); }
.ft-actor-face { grid-row: span 3; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 10px; font: 700 20px var(--font-display); background: var(--raised-b); }
.ft-actor[data-faction="blue"] .ft-actor-face { background: linear-gradient(160deg, #1e3753, #152740); color: var(--blue-text); }
.ft-actor[data-faction="red"] .ft-actor-face { background: linear-gradient(160deg, #4d252c, #351a20); color: var(--red-text); }
.ft-actor-name { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--accent-text); font-weight: 700; }
.ft-actor-name > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ft-actor-name small { color: var(--text-muted); font-weight: 400; font-size: 11px; }
.ft-bars { display: grid; gap: 3px; }
.ft-bar { position: relative; height: 12px; border-radius: 6px; background: rgb(0 0 0 / .55); overflow: hidden; font-size: 9px; line-height: 12px; }
.ft-bar > i { position: absolute; inset: 0 auto 0 0; width: calc(100% * var(--ratio, 0)); background: var(--bar); transition: width .5s var(--ease-out); }
.ft-bar > span { position: relative; padding-left: 5px; color: #fff; text-shadow: 0 1px 2px #000; font-variant-numeric: tabular-nums; }
.ft-bar.hp { --bar: linear-gradient(90deg, #a8474a, #e78886); }
.ft-bar.mp { --bar: linear-gradient(90deg, #3f6c9b, #86b8e6); }
.ft-bar.sp { --bar: linear-gradient(90deg, #3e7f57, #80cc9a); }
.ft-actor-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; color: var(--text-soft); }
.ft-chip { display: inline-flex; align-items: center; gap: 3px; padding: 0 6px; border: 1px solid rgba(170, 140, 230, .38); border-radius: 9px; background: rgba(150, 118, 214, .14); color: #e6dbfb; font-size: 11px; }
.ap-crystal { font-size: 1.15em; color: var(--gold-bright); text-shadow: var(--icon-glow); }
.ap-crystal.is-used { color: var(--gold-dim); text-shadow: none; }

.ft-dock-actions { display: grid; flex: 1; justify-items: end; gap: 4px; min-width: 0; }
.ft-status { margin: 0; color: var(--accent-label); font-size: 13px; text-align: right; }
.ft-hint { margin: 0; color: var(--gold-bright); font-size: 12px; }
.ft-hint:empty { display: none; }
.ft-error { margin: 0; padding: 2px 10px; border-radius: 6px; background: rgb(120 30 30 / .6); color: #ffd0c8; font-size: 12px; }
.ft-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
.ft-app .game-button {
  min-height: 34px; padding: 4px 12px; border: 1px solid var(--line-mid); border-radius: 7px; background: linear-gradient(160deg, var(--raised-a), var(--raised-b));
  color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: transform .12s var(--ease-out), border-color .15s;
}
.ft-app .game-button:active:not(:disabled) { transform: scale(.97); }
.ft-app .game-button.primary, .ft-app .game-button[aria-pressed="true"] { background: linear-gradient(160deg, var(--btn-a), var(--btn-b)); border-color: rgb(var(--btn-line-rgb) / .75); color: var(--btn-text); }
.ft-app .game-button:disabled { opacity: .45; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) { .ft-app .game-button:not(:disabled):hover { border-color: var(--gold); } }
.ft-switch, .ft-mini-select { display: inline-flex; align-items: center; gap: 4px; color: var(--text-soft); font-size: 12px; }
.ft-app select, .ft-app textarea, .ft-app input:not([type="checkbox"]):not([type="file"]) {
  min-width: 0; max-width: 100%; min-height: 32px; padding: 3px 7px; border: 1px solid var(--line-mid); border-radius: 6px; background: var(--field); color: var(--text); font: inherit; font-size: 13px;
}
.ft-skip {
  position: absolute; z-index: 60; right: 14px; bottom: calc(var(--hud-bottom) + 6px); padding: 5px 12px; border: 1px solid var(--line-mid); border-radius: 16px;
  background: rgb(var(--shade-rgb) / .85); color: var(--text-soft); font: inherit; font-size: 12px; cursor: pointer;
}

/* ---------- \u6F14\u51FA\u5C42\uFF1A\u56DE\u5408\u6A2A\u5E45\u3001\u884C\u52A8\u7F0E\u5E26\u3001\u9AB0\u5B50\u5361\u3001\u5B57\u5E55 ---------- */
.ft-overlay { position: absolute; inset: 0; z-index: 55; pointer-events: none; }
.ft-banner {
  position: absolute; top: 38%; left: 0; right: 0; display: grid; justify-items: center; gap: 2px; padding: 14px 0; transform: translateY(-50%);
  background: linear-gradient(90deg, transparent, rgb(var(--shade-rgb) / .9) 25%, rgb(var(--shade-rgb) / .9) 75%, transparent);
  border-block: 1px solid rgb(var(--gold-rgb) / .35);
}
.ft-banner b { font: 800 30px/1.2 var(--font-display); letter-spacing: .12em; color: var(--accent-text); text-shadow: var(--title-shadow); }
.ft-banner small { color: var(--text-muted); font-size: 12px; letter-spacing: .3em; }
.ft-banner[data-faction="blue"] b { color: var(--blue-text); text-shadow: 0 0 16px rgb(95 147 200 / .7); }
.ft-banner[data-faction="red"] b { color: var(--red-text); text-shadow: 0 0 16px rgb(192 114 122 / .7); }
.ft-ribbon {
  position: absolute; top: calc(var(--hud-top) + 30px); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 18px;
  border: 1px solid var(--line-mid); border-radius: 20px; background: rgb(var(--shade-rgb) / .9); color: var(--accent-text); font-weight: 700; white-space: nowrap;
  box-shadow: 0 6px 20px rgb(0 0 0 / .4);
}
.ft-ribbon[data-faction="blue"] { border-color: var(--blue-line); }
.ft-ribbon[data-faction="red"] { border-color: var(--red-line); }

.ft-dice-stage { position: absolute; top: calc(var(--hud-top) + 72px); left: 50%; transform: translateX(-50%); display: grid; gap: 8px; justify-items: center; }
.ft-dice-card {
  --tone: var(--tone-hit);
  display: grid; justify-items: center; gap: 8px; min-width: 300px; max-width: min(460px, 92vw); padding: 14px 20px 16px;
  border: 1px solid rgb(var(--gold-rgb) / .45); border-radius: 14px; background: linear-gradient(165deg, rgba(40, 32, 56, .97), rgba(14, 13, 24, .97));
  box-shadow: 0 16px 40px rgb(0 0 0 / .55), 0 0 0 1px rgb(0 0 0 / .4), inset 0 1px 0 rgb(var(--sheen-rgb) / .06);
}
.ft-dice-card[data-tone="crit"] { --tone: var(--tone-crit); border-color: rgb(255 215 0 / .75); }
.ft-dice-card[data-tone="miss"], .ft-dice-card[data-tone="save-pass"] { --tone: var(--tone-miss); }
.ft-dice-card[data-tone="save-fail"], .ft-dice-card[data-tone="damage"] { --tone: var(--tone-damage); }
.ft-dice-card[data-tone="status"] { --tone: var(--tone-status); }
.ft-dice-label { color: var(--gold-soft); font-size: 12px; letter-spacing: .08em; text-align: center; }
.ft-dice-row { display: flex; justify-content: center; gap: 10px; }
.ft-die {
  position: relative; display: grid; place-items: center; width: 62px; height: 62px; color: #1a1306; font: 800 24px/1 var(--font-display); font-variant-numeric: tabular-nums;
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  background: linear-gradient(160deg, #fff1c8, #d9b467 55%, #9d7a35);
}
.ft-die::after { content: ''; position: absolute; inset: 0; clip-path: polygon(50% 12%, 82% 68%, 18% 68%); background: rgb(255 255 255 / .16); }
.ft-die.is-rolling { animation: ft-tumble .14s linear infinite; }
.ft-die.is-dropped { filter: grayscale(.9) brightness(.55); transform: scale(.82); transition: filter .3s, transform .3s var(--ease-out); }
.ft-die.is-kept { filter: drop-shadow(0 0 10px var(--tone)); }
.ft-die.is-nat20 { background: linear-gradient(160deg, #fffbe0, #ffd700 50%, #c89400); }
.ft-die.is-nat1 { background: linear-gradient(160deg, #ffd6d0, #c65a50 55%, #6e2622); color: #fff; }
@keyframes ft-tumble { 0% { transform: rotate(0) scale(.94); } 50% { transform: rotate(14deg) scale(1.04); } 100% { transform: rotate(0) scale(.94); } }
.ft-dice-mode { color: var(--text-muted); font-size: 11px; }
.ft-formula { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 4px 6px; font-variant-numeric: tabular-nums; }
.ft-formula b { font: 700 20px/1 var(--font-display); color: var(--accent-text); }
.ft-formula i { font-style: normal; color: var(--text-muted); font-size: 11px; }
.ft-formula .op { color: var(--gold-soft); font-size: 16px; }
.ft-formula .total { font-size: 26px; color: var(--tone); }
.ft-verdict { font: 800 24px/1.1 var(--font-display); letter-spacing: .1em; color: var(--tone); text-shadow: 0 0 14px var(--tone); }
.ft-dice-note { color: var(--text-soft); font-size: 12px; }
.ft-versus { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.ft-versus-side { display: grid; justify-items: center; gap: 4px; min-width: 0; }
.ft-versus-side > span { max-width: 140px; overflow: hidden; color: var(--text-soft); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
.ft-versus-vs { color: var(--gold-soft); font: 700 14px var(--font-display); }
.ft-chance { position: relative; width: 260px; height: 14px; border-radius: 7px; background: rgb(0 0 0 / .5); overflow: hidden; }
.ft-chance > i { position: absolute; inset: 0 auto 0 0; width: calc(100% * var(--chance)); background: rgb(var(--gold-rgb) / .5); }
.ft-chance > b { position: absolute; top: -2px; bottom: -2px; left: calc(100% * var(--rolled)); width: 3px; background: #fff; box-shadow: 0 0 6px #fff; }

.ft-caption { position: absolute; left: 14px; bottom: calc(var(--hud-bottom) + 6px); display: grid; gap: 4px; width: min(520px, 70%); margin: 0; padding: 0; list-style: none; }
.ft-caption li {
  --tone: var(--text-soft);
  display: flex; gap: 7px; align-items: baseline; width: fit-content; max-width: 100%; padding: 4px 11px; border-left: 3px solid var(--tone); border-radius: 0 8px 8px 0;
  background: rgb(var(--shade-rgb) / .86); color: var(--text); font-size: 13px; box-shadow: 0 4px 12px rgb(0 0 0 / .35);
}
.ft-caption li small { color: var(--text-muted); font-size: 11px; }

[data-tone="hit"] { --tone: var(--tone-hit); }
[data-tone="crit"] { --tone: var(--tone-crit); }
[data-tone="miss"], [data-tone="save-pass"] { --tone: var(--tone-miss); }
[data-tone="damage"], [data-tone="save-fail"] { --tone: var(--tone-damage); }
[data-tone="heal"] { --tone: var(--tone-heal); }
[data-tone="status"] { --tone: var(--tone-status); }
[data-tone="move"] { --tone: var(--tone-move); }
[data-tone="turn"], [data-tone="outcome"] { --tone: var(--tone-turn); }
[data-tone="defeat"] { --tone: var(--tone-defeat); }

/* ---------- \u76EE\u6807\u6D6E\u5361 ---------- */
#target-actions.ft-target-card {
  position: fixed; z-index: 70; inset: 8px auto auto 8px; width: 290px; margin: 0; padding: 10px; overflow: auto; overscroll-behavior: contain;
  border: 1px solid rgb(var(--gold-rgb) / .45); border-radius: 12px; background: var(--ink-1); color: var(--text); font-size: 13px;
  box-shadow: 0 14px 34px rgb(0 0 0 / .6);
}
.ft-target-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
#target-title { min-width: 0; color: var(--accent-text); overflow-wrap: anywhere; }
.ft-close { flex: none; width: 30px; height: 30px; padding: 0; border: 1px solid var(--line-mid); border-radius: 7px; background: var(--raised-b); color: var(--text); font-size: 17px; cursor: pointer; }
.ft-target-options { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; color: var(--text-soft); font-size: 12px; }
.ft-actions { display: flex; flex-wrap: wrap; gap: 5px; }
.ft-actions .game-button { flex: 1 1 calc(50% - 5px); padding-inline: 8px; text-align: left; }
.ft-actions .game-button small { display: block; color: var(--text-muted); font-size: 10px; }
.ft-actions .game-button[aria-pressed="true"] small { color: inherit; opacity: .8; }
.ft-preview { margin-top: 8px; max-height: 13em; overflow: auto; color: var(--text-soft); font-size: 12px; }
.ft-preview:empty { display: none; }
.preview-line + .preview-line { margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--line); }
.preview-line b { color: var(--accent-text); }
.preview-line.is-warning { color: #f3c58c; }
.ft-odds { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.ft-odds-bar { flex: 1; height: 6px; border-radius: 3px; background: rgb(0 0 0 / .5); overflow: hidden; }
.ft-odds-bar > i { display: block; height: 100%; width: calc(100% * var(--p)); background: linear-gradient(90deg, #b48a3c, var(--gold-bright)); }
.ft-confirm { width: 100%; margin-top: 8px; }

/* ---------- \u62BD\u5C49 ---------- */
.ft-drawer {
  position: absolute; z-index: 80; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; width: var(--drawer-w);
  border-left: 1px solid rgb(var(--gold-rgb) / .3); background: var(--panel-bg); box-shadow: -18px 0 40px rgb(0 0 0 / .45);
  animation: ft-drawer-in .28s var(--ease-out);
}
@keyframes ft-drawer-in { from { transform: translateX(100%); } }
.ft-drawer-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line-mid); background: var(--header-bg); }
.ft-drawer-head h2 { margin: 0; color: var(--heading); font: 700 16px var(--font-display); }
.ft-drawer > :not(.ft-drawer-head) { padding-inline: 14px; }
.ft-drawer > :last-child { flex: 1; overflow: auto; padding-bottom: 16px; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; }
.ft-section { margin: 14px 0 6px; color: var(--accent-label); font: 600 13px var(--font-display); letter-spacing: .06em; }
.ft-form { display: grid; align-content: start; gap: 8px; padding-top: 4px; }
.ft-form > label, .ft-dev label { display: grid; gap: 3px; color: var(--text-soft); font-size: 12px; }
.ft-form .ft-row { justify-content: flex-start; }
.ft-readout { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--row-bg); color: var(--text-soft); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ft-readout:empty { display: none; }
.ft-dev { margin-top: 10px; padding: 8px 10px; border: 1px dashed var(--line-mid); border-radius: 8px; }
.ft-dev > summary { color: var(--text-muted); cursor: pointer; font-size: 12px; }
.ft-dev[open] { display: grid; gap: 8px; }
#sandbox-editor { width: 100%; font: 12px/1.45 ui-monospace, Consolas, monospace; resize: vertical; }
.muted { color: var(--text-muted); font-size: 12px; line-height: 1.5; }

/* \u65E5\u5FD7 */
.ft-log { display: grid; align-content: start; gap: 4px; padding-top: 8px; }
.ft-log-round { position: sticky; top: 0; z-index: 1; margin: 8px 0 2px; padding: 3px 0; color: var(--gold); background: var(--ink-1); font: 700 12px var(--font-display); letter-spacing: .2em; text-align: center; }
.ft-log-entry { --tone: var(--line-mid); padding: 6px 9px; border-left: 3px solid var(--tone); border-radius: 0 7px 7px 0; background: var(--row-bg); }
.ft-log-entry.is-quiet { padding-block: 2px; border-left-color: transparent; background: none; color: var(--text-muted); font-size: 12px; }
.ft-log-entry > summary, .ft-log-entry > .ft-log-title { display: flex; gap: 6px; align-items: baseline; list-style: none; cursor: default; }
.ft-log-entry > summary { cursor: pointer; }
.ft-log-entry > summary::-webkit-details-marker { display: none; }
.ft-log-entry > summary::after { content: '\u8BA1\u7B97 \u25BE'; margin-left: auto; flex: none; color: var(--text-muted); font-size: 10px; }
.ft-log-entry[open] > summary::after { content: '\u6536\u8D77 \u25B4'; }
.ft-log-entry ul { margin: 5px 0 0; padding-left: 20px; color: var(--text-soft); font-size: 12px; }
.ft-log-entry li { margin: 1px 0; }
.ft-log-icon { flex: none; width: 1.3em; text-align: center; }

/* \u5355\u4F4D\u60C5\u62A5 */
.ft-unit-card { display: grid; gap: 10px; padding-top: 10px; }
.ft-card-head { display: flex; align-items: center; gap: 10px; }
.ft-card-head strong { color: var(--accent-text); font: 700 17px var(--font-display); }
.ft-kv { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.ft-kv > span { display: grid; justify-items: center; padding: 4px 0; border-radius: 6px; background: var(--row-bg); font-size: 11px; color: var(--text-muted); }
.ft-kv b { color: var(--accent-text); font-size: 15px; }
.ft-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.ft-list > li { padding: 5px 9px; border-radius: 7px; background: var(--row-bg); font-size: 12px; }
.ft-list > li b { color: var(--accent-text); }
.ft-list > li p { margin: 2px 0 0; color: var(--text-muted); font-size: 11px; }
.ft-features { display: grid; gap: 5px; }

/* \u5BF9\u8BDD\u6846 */
.ft-dialog { width: min(660px, calc(100% - 24px)); max-height: calc(100% - 24px); padding: 18px; border: 1px solid rgb(var(--gold-rgb) / .45); border-radius: 12px; background: var(--ink-1); color: var(--text); }
.ft-dialog::backdrop { background: rgb(8 7 14 / .72); }
.ft-dialog h2 { margin: 0 0 6px; color: var(--heading); font: 700 17px var(--font-display); }
.ft-dialog textarea { display: block; width: 100%; max-height: 55vh; margin-block: 8px 12px; padding: 10px; resize: vertical; }
.ft-dialog .ft-row { justify-content: flex-start; }
#report-message:not(:empty) { margin-top: 8px; }

/* ---------- \u68CB\u76D8\u7F29\u653E ---------- */
.ft-board.battle-axis[data-compact="true"] .axis-unit-name { display: none; }
.ft-board.battle-axis[data-compact="true"] .tactical-cell-coord { display: none; }
.ft-app.is-panning .ft-scroll { cursor: grabbing; user-select: none; }
.ft-zoom {
  position: absolute; z-index: 52; top: calc(var(--hud-top) + 8px); right: calc(var(--hud-right) + max(12px, var(--safe-r)));
  display: flex; align-items: center; padding: 2px; border: 1px solid var(--line-mid); border-radius: 18px;
  background: rgb(var(--shade-rgb) / .82); box-shadow: 0 4px 14px rgb(0 0 0 / .35);
}
.ft-zoom button {
  display: grid; place-items: center; min-width: 32px; height: 30px; padding: 0 6px; border: 0; border-radius: 15px; background: none;
  color: var(--accent-text); font: inherit; font-size: 17px; line-height: 1; cursor: pointer; font-variant-numeric: tabular-nums;
}
.ft-zoom #zoom-reset { min-width: 52px; font-size: 12px; color: var(--text-soft); }
.ft-zoom button:disabled { opacity: .35; cursor: default; }
.ft-zoom button:active:not(:disabled) { background: rgb(var(--gold-rgb) / .18); }
@media (hover: hover) and (pointer: fine) { .ft-zoom button:not(:disabled):hover { background: rgb(var(--gold-rgb) / .14); color: var(--gold-bright); } }

/* ---------- \u7A84\u5C4F\uFF08\u7AD6\u5C4F\u624B\u673A\uFF09 ---------- */
@media (max-width: 760px) {
  .ft-hud-top { flex-wrap: wrap; gap: 6px 8px; padding-bottom: 6px; }
  .ft-hud-title { flex: 1; min-width: 0; }
  .ft-title { overflow: hidden; text-overflow: ellipsis; }
  .ft-eyebrow { display: none; }
  .ft-initiative { order: 3; flex-basis: 100%; }
  .ft-hud-menu { gap: 4px; }
  .ft-dock { flex-direction: column; align-items: stretch; gap: 6px; padding-top: 8px; padding-inline: max(8px, var(--safe-l)) max(8px, var(--safe-r)); }
  .ft-actor { width: 100%; grid-template-columns: auto 1fr; padding: 6px 9px; }
  .ft-actor-face { width: 38px; height: 38px; font-size: 17px; }
  .ft-dock-actions { justify-items: stretch; }
  .ft-status { text-align: left; }
  .ft-row { justify-content: flex-start; gap: 5px; }
  .ft-dice-card { min-width: 0; width: min(360px, 92vw); padding: 10px 12px; }
  .ft-die { width: 50px; height: 50px; font-size: 20px; }
  .ft-chance { width: min(260px, 70vw); }
  #target-actions.ft-target-card { width: min(270px, calc(100vw - 16px)); }
  #target-actions button { min-height: 44px; }
  .ft-caption { left: max(8px, var(--safe-l)); width: calc(100% - 16px); }
  .ft-skip { right: max(8px, var(--safe-r)); }
  .ft-banner b { font-size: 24px; }
  /* \u7AD6\u5C4F\u62BD\u5C49\u4ECE\u5E95\u90E8\u5F39\u51FA\uFF0C\u5355\u624B\u597D\u591F */
  .ft-drawer { top: auto; left: 0; width: auto; height: min(78%, 640px); border-left: 0; border-top: 1px solid rgb(var(--gold-rgb) / .35); border-radius: 14px 14px 0 0;
    padding-bottom: var(--safe-b); box-shadow: 0 -18px 40px rgb(0 0 0 / .5); animation-name: ft-sheet-in; }
}
@keyframes ft-sheet-in { from { transform: translateY(100%); } }

/* ---------- \u77EE\u5C4F\uFF08\u6A2A\u5C4F\u624B\u673A\uFF09\uFF1A\u9876\u680F\u538B\u6241\uFF0C\u52A8\u4F5C\u533A\u6539\u4E3A\u53F3\u4FA7\u7AD6\u680F ---------- */
@media (orientation: landscape) and (max-height: 520px) {
  .ft-app { --drawer-w: min(380px, 60vw); }
  .ft-zoom { top: calc(var(--hud-top) + 4px); }
  .ft-hud-top { z-index: 52; flex-wrap: nowrap; min-height: 0; gap: 8px; padding-block: max(4px, var(--safe-t)) 4px; padding-right: calc(var(--hud-right) + 8px); }
  .ft-eyebrow, .ft-round { display: none; }
  .ft-title { font-size: 14px; }
  .ft-initiative { order: 0; flex-basis: auto; }
  .ft-dock {
    inset: 0 0 0 auto; width: min(270px, 34vw); flex-direction: column; align-items: stretch; justify-content: flex-end; gap: 6px; overflow-y: auto;
    padding: calc(var(--hud-top) + 4px) max(8px, var(--safe-r)) max(8px, var(--safe-b)) 8px;
    background: linear-gradient(270deg, rgb(var(--shade-rgb) / .95), rgb(var(--shade-rgb) / .75) 80%, transparent);
  }
  .ft-actor { width: 100%; padding: 6px 8px; }
  .ft-actor-face { width: 34px; height: 34px; font-size: 15px; }
  .ft-dock-actions { justify-items: stretch; }
  .ft-status { text-align: left; font-size: 12px; }
  .ft-row { justify-content: flex-start; gap: 5px; }
  .ft-row > .game-button { flex: 1 1 calc(50% - 5px); }
  .ft-inspector, .ft-ribbon { left: calc(50% - var(--hud-right) / 2); }
  .ft-dice-stage { top: calc(var(--hud-top) + 8px); left: calc(50% - var(--hud-right) / 2); }
  .ft-dice-card { min-width: 0; gap: 4px; padding: 8px 12px; }
  .ft-die { width: 44px; height: 44px; font-size: 18px; }
  .ft-verdict { font-size: 19px; }
  .ft-caption { left: max(8px, var(--safe-l)); bottom: max(8px, var(--safe-b)); width: calc(100% - var(--hud-right) - 24px); }
  .ft-skip { right: calc(var(--hud-right) + 8px); bottom: max(8px, var(--safe-b)); }
  .ft-banner b { font-size: 22px; }
}

/* ---------- \u89E6\u5C4F\uFF1A\u89E6\u63A7\u76EE\u6807\u4E0D\u5C0F\u4E8E 44px ---------- */
@media (pointer: coarse) {
  .ft-icon-button { width: 44px; height: 44px; }
  .ft-app .game-button, .ft-app .turn-chip, .ft-skip, .ft-dev > summary { min-height: 44px; }
  .ft-app select, .ft-app input:not([type="checkbox"]):not([type="file"]) { min-height: 44px; font-size: 16px; }
  .ft-switch, .ft-mini-select, .ft-target-options label { min-height: 44px; }
  .ft-app input[type="checkbox"] { width: 22px; height: 22px; }
  .ft-close { width: 44px; height: 44px; }
  .ft-zoom button { min-width: 44px; height: 40px; }
  .ft-log-entry > summary { min-height: 32px; }
  .ft-board button { touch-action: manipulation; }
}
@media (prefers-reduced-motion: reduce) {
  .ft-drawer { animation: none; }
  .ft-board .axis-unit.is-active { animation: none; }
  .ft-die.is-rolling { animation: none; }
}
`;

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
      getItem(key4) {
        try {
          return source?.getItem(`${prefix}/${key4}`) ?? null;
        } catch {
          return null;
        }
      },
      setItem(key4, value) {
        try {
          source?.setItem(`${prefix}/${key4}`, value);
        } catch {
        }
      },
      removeItem(key4) {
        try {
          source?.removeItem(`${prefix}/${key4}`);
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
      setPortraits(portraits) {
        if (active) ui.setPortraits(portraits);
      },
      getState: ui.getState,
      exportBattleReportText: ui.exportBattleReportText,
      exportMvuPatch: ui.exportMvuPatch,
      root
    };
    root.__fatedUnmount = result.unmount;
    return result;
  }

  // src/tavern/descriptor.js
  var identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  var unsafeKey = (key4) => Object.hasOwn(Object.prototype, key4) || key4 === "prototype";
  function parseBattleDescriptor(value) {
    if (typeof value !== "string") return null;
    const lines = value.trim().replace(/^```[^\r\n]*\r?\n/, "").replace(/\r?\n```$/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!/^\s*(battle|unit)\s*\|/i.test(lines[0] ?? "")) return null;
    const fail4 = (message) => {
      throw new Error(`battle_init \u63CF\u8FF0\u7B26\uFF1A${message}`);
    };
    const [kind, version2, battleId, sceneTitle, terrainMode, ...options] = lines[0].split("|").map((x) => x.trim());
    const sideToken = options.at(-1)?.match(/^压制方=(blue|red)$/);
    if (sideToken) options.pop();
    const typeToken = options.at(-1)?.match(/^战斗类型=(.+)$/);
    const moraleType = typeToken && moraleTypeFor(typeToken[1]);
    if (typeToken && !moraleType) fail4("\u672A\u77E5\u6218\u6597\u7C7B\u578B\uFF0C\u53EF\u9009\uFF1A\u6807\u51C6\u3001\u5207\u78CB\u3001\u7ADE\u6280\u3001\u538B\u5236\u3001\u6B7B\u6597\u3001\u5B88\u536B");
    if (moraleType === "suppress" !== !!sideToken) fail4("\u538B\u5236\u6218\u5FC5\u987B\u5728\u6218\u6597\u7C7B\u578B\u540E\u58F0\u660E |\u538B\u5236\u65B9=blue \u6216 |\u538B\u5236\u65B9=red\uFF1B\u5176\u4ED6\u7C7B\u578B\u4E0D\u586B\u538B\u5236\u65B9");
    if (typeToken) options.pop();
    const [seedText, ...extra] = options;
    if (kind !== "battle" || version2 !== "1" || extra.length || !identifier.test(battleId ?? "") || unsafeKey(battleId) || !sceneTitle || sceneTitle.length > 100 || !["flat", "terrain"].includes(terrainMode)) {
      fail4("\u9996\u884C\u5E94\u4E3A battle|1|ID|\u573A\u666F\u6807\u9898|flat \u6216 terrain\uFF0C\u53EF\u8FFD\u52A0 |seed");
    }
    if (seedText !== void 0 && (!/^\d+$/.test(seedText) || Number(seedText) > 4294967295)) fail4("seed \u5FC5\u987B\u662F 0\u20134294967295 \u7684\u6574\u6570");
    const ids = /* @__PURE__ */ new Set();
    const occupied = /* @__PURE__ */ new Set();
    const units = [], covers = [], interactives = [];
    const claim = (id3, x, y, i) => {
      if (!identifier.test(id3 ?? "") || unsafeKey(id3) || ids.has(id3.toLowerCase())) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u9700\u8981\u552F\u4E00 ID`);
      if (occupied.has(`${x},${y}`)) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u4F4D\u7F6E\u91CD\u590D`);
      occupied.add(`${x},${y}`);
      ids.add(id3.toLowerCase());
    };
    for (const [i, line] of lines.slice(1).entries()) {
      const parts = line.split("|").map((x2) => x2.trim());
      if (parts[0] === "cover" || parts[0] === "interact") {
        if (parts[0] === "cover") {
          const [row3, id5, kind3, name3, point4] = parts;
          if (parts.length !== 5 || !name3 || !["\u534A", "\u5168"].includes(kind3) || !/^\d\s*,\s*\d\s*,\s*-?\d+$/.test(point4 ?? "")) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u63A9\u4F53\u683C\u5F0F\u65E0\u6548`);
          const [x3, y3, z3] = point4.split(",").map(Number);
          claim(id5, x3, y3, i);
          covers.push({ id: id5, name: name3, x: x3, y: y3, z: z3, cover: kind3 === "\u5168" ? 5 : 2, material: kind3 });
          continue;
        }
        const [row2, id4, kind2, effect, radiusText, damageText, name2, point3] = parts;
        const radius = Number(radiusText), damage = Number(damageText);
        if (parts.length !== 8 || !name2 || !["altar", "barrel"].includes(kind2) || !["explode", "heal", "shield", "restore"].includes(effect) || !Number.isInteger(radius) || radius < 0 || radius > 10 || !Number.isInteger(damage) || damage < 0 || damage > 1e5 || !/^\d\s*,\s*\d\s*,\s*-?\d+$/.test(point3 ?? "")) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u4E92\u52A8\u683C\u5F0F\u65E0\u6548`);
        const [x2, y2, z2] = point3.split(",").map(Number);
        claim(id4, x2, y2, i);
        if (interactives.length === 2) fail4("\u6700\u591A\u4E24\u6761 interact \u8BB0\u5F55");
        interactives.push({ id: id4, name: name2, x: x2, y: y2, z: z2, kind: kind2, effect, radius, damage });
        continue;
      }
      const [row, id3, team2, source, name, point2, ...tail] = line.split("|").map((x2) => x2.trim());
      const coordinates = point2?.split(",").map((x2) => x2.trim()) ?? [];
      const altitudeToken = coordinates[2];
      const altitudeMatch = altitudeToken?.match(/^(?:飞行|悬浮)=(-?\d+)$/);
      const validPoint = /^\d\s*,\s*\d(?:\s*,\s*(?:-?\d+|(?:飞行|悬浮)=-?\d+))?$/.test(point2 ?? "");
      if (row !== "unit" || tail.length || !identifier.test(id3 ?? "") || unsafeKey(id3) || ids.has(id3.toLowerCase()) || !["blue", "red"].includes(team2) || !name || name.length > 100 || !validPoint) {
        fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u9700\u8981\u552F\u4E00 ID\u3001\u9635\u8425\u3001\u6765\u6E90\u3001\u663E\u793A\u540D\u53CA 0\u20139 \u8303\u56F4\u5185\u7684 x,y`);
      }
      const path = source?.startsWith("mvu:") ? source.slice(4).split("/") : [];
      if (source !== "char_info" && (!path.length || path.some((key4) => !key4 || key4 !== key4.trim() || unsafeKey(key4)))) {
        fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u6765\u6E90\u5E94\u4E3A char_info \u6216 mvu:\u7CBE\u786E/\u8DEF\u5F84`);
      }
      const x = Number(coordinates[0]), y = Number(coordinates[1]);
      const z = altitudeMatch ? 0 : coordinates[2] === void 0 ? 0 : Number(coordinates[2]);
      const altitude = altitudeMatch ? Number(altitudeMatch[1]) : 0;
      if (z < -4 || z > 8 || altitude < 0 || altitude > 12) fail4(`\u7B2C ${i + 2} \u6761\u8BB0\u5F55\u7684\u9AD8\u5EA6\u5FC5\u987B\u5728 z -4 \u81F3 8\u3001\u79BB\u5730 0 \u81F3 12 \u8303\u56F4\u5185`);
      claim(id3, x, y, i);
      units.push({
        id: id3,
        team: team2,
        source,
        name,
        x,
        y,
        ...altitudeMatch ? { altitude } : coordinates[2] !== void 0 ? { z } : {}
      });
    }
    if (!units.length) fail4("\u81F3\u5C11\u9700\u8981\u4E00\u6761 unit \u8BB0\u5F55");
    return { version: 1, battleId, sceneTitle, terrainMode, ...moraleType && { moraleType }, ...sideToken && { suppressingTeam: sideToken[1] }, ...seedText === void 0 ? {} : { seed: Number(seedText) }, units, ...covers.length && { covers }, ...interactives.length && { interactives } };
  }

  // src/tavern/terrain.js
  var inBounds = (n) => Number.isInteger(n) && n >= 0 && n <= 9;
  var height = (n) => Math.max(-4, Math.min(8, Math.round(Number(n) || 0)));
  var list2 = (value) => Array.isArray(value) ? value : [];
  function createBattleGrid(battle, seed, units, warnings) {
    const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: "floor", z: 0 })));
    const anchors = battle.version === 1 ? [...list2(battle.units), ...list2(battle.covers), ...list2(battle.interactives)].filter((unit) => Number.isInteger(unit.z)) : [];
    if (anchors.some((anchor2) => anchor2.z !== 0)) {
      const reserved = new Set([...battle.units ?? [], ...list2(battle.covers), ...list2(battle.interactives)].map((at) => `${at.x},${at.y}`));
      const painted = /* @__PURE__ */ new Set();
      for (const { x, y, z } of anchors) {
        grid[y][x] = { kind: "floor", z };
        if (!z) continue;
        const offsets = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        const start = (seed + x * 13 + y * 7 >>> 0) % offsets.length;
        for (let i = 0; i < offsets.length; i++) {
          const [dx, dy] = offsets[(start + i) % offsets.length];
          const points = [[x + dx, y + dy, z], [x + 2 * dx, y + 2 * dy, Math.abs(z) > 1 ? z - Math.sign(z) : 0]];
          if (!points.every(([a, b]) => inBounds(a) && inBounds(b) && !reserved.has(`${a},${b}`) && !painted.has(`${a},${b}`))) continue;
          for (const [a, b, h] of points) {
            grid[b][a] = { kind: h === z ? "floor" : "slope", z: h };
            painted.add(`${a},${b}`);
          }
          break;
        }
      }
      for (let pass = 0; pass < 4; pass++) {
        const previous = grid.map((row) => row.map((cell) => cell.z));
        grid.forEach((row, y) => row.forEach((cell, x) => {
          if (reserved.has(`${x},${y}`) || painted.has(`${x},${y}`)) return;
          for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            const h = previous[b]?.[a];
            if (h !== void 0 && Math.abs(h) > Math.abs(cell.z) + 2) Object.assign(cell, { kind: "slope", z: h - 2 * Math.sign(h) });
          }
        }));
      }
      return grid;
    }
    if (battle.terrainMode === "flat") return grid;
    const legacyTerrain = battle.terrain ?? battle.grid;
    if (battle.terrainMode === "terrain" || battle.terrainMode == null && legacyTerrain == null) {
      const layout = seed % 8;
      const transform = (x, y) => [layout & 1 ? 9 - x : x, layout & 2 ? 9 - y : y];
      const occupied = new Set([...units, ...list2(battle.covers), ...list2(battle.interactives)].map((u) => `${u.x},${u.y}`));
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
    const place2 = (raw, kind, label) => {
      const [x, y, z] = Array.isArray(raw) ? raw : Array.isArray(raw?.xyz) ? raw.xyz : [raw?.x, raw?.y, raw?.z];
      if (!inBounds(x) || !inBounds(y)) {
        warnings.push(`\u5FFD\u7565\u65E0\u6548\u5730\u5F62\u5750\u6807\uFF1A${label}`);
        return;
      }
      grid[y][x] = { kind, z: z == null ? grid[y][x].z : height(z) };
    };
    if (Array.isArray(terrain)) {
      if (terrain.length === 10 && terrain.every((row) => Array.isArray(row) && row.length === 10)) {
        terrain.forEach((row, y) => row.forEach((cell, x) => place2([x, y, cell?.z], cellKind(cell), "grid")));
      } else terrain.forEach((cell) => place2(cell, cellKind(cell), "terrain"));
    } else {
      for (const region of list2(terrain?.elevation)) {
        const { x1, y1, x2, y2, z } = region ?? {};
        if (![x1, y1, x2, y2].every(inBounds) || x1 > x2 || y1 > y2) {
          warnings.push("\u5FFD\u7565\u65E0\u6548\u5730\u5F62\u5750\u6807\uFF1Agrid.elevation");
          continue;
        }
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x].z = height(z);
      }
      for (const slope of list2(terrain?.slopes)) place2(slope, "slope", "grid.slopes");
      for (const wall of list2(terrain?.walls)) place2(wall, "wall", "grid.walls");
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
      const colon = line.value.search(/[:：]/);
      if (colon < 1 || !object3(parent)) continue;
      const key4 = line.value.slice(0, colon).trim();
      const tail = line.value.slice(colon + 1).trim();
      if (blockHeaders.has(tail)) {
        const chunks = [];
        for (let j = i + 1; j < lines.length && lines[j].indent > line.indent; j++) {
          chunks.push(lines[j].value);
          i = j;
        }
        parent[key4] = chunks.join(tail.startsWith(">") ? " " : "\n");
        continue;
      }
      if (tail) {
        parent[key4] = scalar(tail);
        continue;
      }
      const next = lines[i + 1];
      const child = next && next.indent > line.indent && next.value.startsWith("- ") ? [] : {};
      parent[key4] = child;
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
    for (const key4 of attrNames) {
      const aliases2 = [key4, ...Object.entries(statAliases).filter(([, v]) => v === key4).map(([k]) => k)];
      result[key4] = Math.max(-20, Math.min(50, integer3(
        aliases2.find((alias) => own5(nested, alias)) !== void 0 ? nested[aliases2.find((alias) => own5(nested, alias))] : findValue(r, aliases2, 0),
        0
      )));
    }
    return result;
  }
  function resource2(record2, key4, fallback) {
    const r = asObject(record2), nested = asObject(r.resources ?? r.resource ?? r.\u8D44\u6E90);
    const aliases2 = { hp: ["HP", "\u751F\u547D\u503C"], mp: ["MP", "\u6CD5\u529B\u503C"], sp: ["SP", "\u4F53\u529B\u503C"] }[key4] ?? [];
    const value = own5(r, key4) ? r[key4] : own5(r, key4.toUpperCase()) ? r[key4.toUpperCase()] : own5(r, aliases2[1]) ? r[aliases2[1]] : own5(nested, key4) ? nested[key4] : own5(nested, aliases2[0]) ? nested[aliases2[0]] : own5(nested, aliases2[1]) ? nested[aliases2[1]] : void 0;
    if (object3(value)) {
      const current2 = integer3(value.current ?? value.\u5F53\u524D ?? value.now ?? value.value, fallback);
      const upper = value.max ?? value.maximum ?? value.\u4E0A\u9650;
      const max2 = object3(upper) ? integer3((upper._\u57FA\u7840 ?? 0) + (upper.\u989D\u5916 ?? 0), fallback) : integer3(upper, fallback);
      return { current: current2, max: max2 };
    }
    const current = integer3(value, fallback);
    const maxValue = findValue(r, [`max${key4[0].toUpperCase()}${key4.slice(1)}`, `${key4}Max`, `${aliases2[1]}\u4E0A\u9650`], current);
    const max = integer3(maxValue, current);
    return { current, max };
  }
  function safeResource(pair, key4, warnings) {
    let max = Math.max(key4 === "hp" ? 1 : 0, pair.max), current = Math.max(0, Math.min(max, pair.current));
    if (max > 1e9 || pair.current > 1e9) {
      warnings.push(`${key4} \u8D85\u51FA\u5F15\u64CE\u4E0A\u9650\uFF0C\u5DF2\u622A\u5230 1e9`);
      max = Math.min(max, 1e9);
      current = Math.min(current, max);
    }
    return { current, max };
  }
  function sourceName(record2, key4 = "") {
    return text2(findValue(record2, ["name", "displayName", "characterName", "\u89D2\u8272\u540D", "\u59D3\u540D", "\u540D\u79F0"], key4));
  }
  function tierNumber(value, fallback = 1) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = text2(value).match(/[一二三四五六七]层级?/);
    return match ? "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03".indexOf(match[0][0]) + 1 : fallback;
  }
  function sourceId(record2, key4 = "") {
    return text2(findValue(record2, ["id", "uid", "characterId", "instanceId", "ID"], key4));
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
    const matches3 = (record2, key4) => [sourceId(record2), sourceName(record2), record2.__sourceKey].includes(key4);
    if (source) return [...mvuRecords, ...chars].find((record2) => matches3(record2, source));
    const exact = [text2(participant.id ?? participant.uid), name].filter(Boolean);
    for (const key4 of exact) {
      const record2 = mvuRecords.find((record3) => matches3(record3, key4));
      if (record2) return record2;
    }
    return char;
  }
  function collectMvu(value) {
    const root = asObject(value?.stat_data ?? value?.statData ?? value);
    const lengths = asObject(root.\u4E8B\u4EF6?.\u6218\u672F\u6269\u5C55?.\u4F53\u957F);
    const companionLengths = asObject(lengths.\u4F19\u4F34);
    const found = [];
    const visit = (node3, key4 = "", path = []) => {
      if (Array.isArray(node3)) return node3.forEach((v, i) => visit(v, String(i), [...path, i]));
      if (!object3(node3)) return;
      const name = sourceName(node3, key4), hasStats = node3.stats || node3.attributes || node3.\u5C5E\u6027 || ["\u529B\u91CF", "\u654F\u6377", "\u4F53\u8D28", "\u667A\u529B", "\u7CBE\u795E"].some((k) => own5(node3, k));
      const hasResource = ["hp", "maxHp", "mp", "sp", "tier", "level", "equipment", "skills", "\u751F\u547D\u503C", "\u6CD5\u529B\u503C", "\u4F53\u529B\u503C", "\u88C5\u5907", "\u6280\u80FD", "\u8D44\u6E90"].some((k) => own5(node3, k));
      if (name && (hasStats || hasResource)) {
        const length = path.length === 1 && protagonistAliases.includes(path[0]) ? lengths.\u4E3B\u89D2 : path.length === 2 && path[0] === "\u5173\u7CFB\u5217\u8868" && own5(companionLengths, key4) ? companionLengths[key4] : void 0;
        const record2 = clone(node3);
        if (Number.isFinite(length) && length > 0) record2.bodyLengthM = length;
        found.push({ ...record2, __sourceKey: key4, __sourcePath: path, __sourceKind: "MVU" });
      }
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
    const key4 = text2(value).toLowerCase();
    return own5(STATUSES, key4) ? key4 : statusNames.get(key4) ?? (own5(statusAliases, key4) ? statusAliases[key4] : null);
  }
  var bound = (value, min, max, fallback = min) => Math.max(min, Math.min(max, integer3(value, fallback)));
  function statusTurns(value, fallback) {
    const turns2 = typeof value === "string" ? value.match(/^\s*(\d+)\s*(?:回合|轮)\s*$/)?.[1] ?? value : value;
    return bound(turns2, 1, 100, fallback);
  }
  function warningSink(warnings, unitId, source, scope, originPath) {
    return { push: (message) => warnings.push({ message, unitId, source, scope, ...originPath && { originPath } }) };
  }
  function convertEffects(effects2, context, warnings, prefix) {
    let input = Array.isArray(effects2) ? effects2 : effects2 == null ? [] : [effects2];
    if (object3(effects2) && !["trigger", "kind", "type", "effect", "name", "\u7C7B\u578B"].some((key4) => own5(effects2, key4))) {
      input = Object.entries(effects2).flatMap(([kind, value]) => {
        if (!object3(value) && emptyEntry(value)) return [];
        if (isExpression(value)) return [{ ...value, id: value.id ?? (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(kind) ? kind : `${prefix}-${hash(kind).toString(36)}`) }];
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
  function skillCosts(value) {
    const cost = object3(value) ? Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(" ") : text2(value);
    const slots = [...cost.matchAll(/(攻击|动作)\s*[:：]\s*(\d+)/g)];
    const resources = {};
    for (const [, n, key4] of cost.matchAll(/(\d+)\s*(SP|MP|HP)\b/gi)) resources[key4.toLowerCase()] = Number(n);
    return { ...resources, slot: slots[0]?.[1] === "\u52A8\u4F5C" ? "action" : "attack", ap: new Set(slots.map((s) => s[1])).size === 2 ? 2 : 1 };
  }
  function damageTags(value, power) {
    if (!value) return [];
    const single = damageAliases.get(value);
    if (single) return [{ kind: "damage", percentOfPower: 1, damageType: single }];
    const parts = value.split(/[/／]/).map((s) => s.trim().match(/^(物理|能量|精神|真实)\s*(\d+(?:\.\d+)?)\s*([%％]?)$/));
    if (parts.length < 2 || parts.some((p) => !p)) return [];
    const percent2 = parts.every((p) => p[3]);
    if (!percent2 && !(parts.every((p) => !p[3]) && parts.reduce((n, p) => n + Number(p[2]), 0) === Number(power))) return [];
    return parts.map(([, type, n]) => ({ kind: "damage", damageType: damageAliases.get(type), ...percent2 ? { percentOfPower: Number(n) / 100 } : { flat: Number(n) } }));
  }
  function legacyPercentDamage(raw) {
    const entries2 = Array.isArray(raw) ? raw : object3(raw) && !isExpression(raw) ? Object.values(raw) : [raw];
    if (!entries2.length || entries2.some((entry) => typeof entry !== "string")) return [];
    const parts = entries2.flatMap((entry) => entry.trim().replace(/^[|>][-+2]?[^\S\r\n]*\r?\n/, "").trim().split(/[/／、+＋]/)).map((part) => part.trim().match(/^(\d+(?:\.\d+)?)\s*[%％]\s*(物理|能量|精神|真实)(?:伤害)?[。.]?$/));
    if (parts.some((part) => !part || Number(part[1]) <= 0 || Number(part[1]) > 1e3)) return [];
    return parts.map(([, percent2, type]) => ({ kind: "damage", percentOfPower: Number(percent2) / 100, damageType: damageAliases.get(type) }));
  }
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
  function normalizeEquipment(raw, slot, owner, index, sink) {
    const r = asObject(raw), name = text2(r.name ?? r.\u540D\u79F0 ?? r.itemName) || `${slot || "\u88C5\u5907"}${index + 1}`;
    const isShield = slot === "shield" || r.kind === "shield" || r.shield === true || r.weaponClass === "shield" || /盾/.test(name);
    const labels = Array.isArray(r.tags ?? r.\u6807\u7B7E) ? (r.tags ?? r.\u6807\u7B7E).join(" ") : text2(r.tags ?? r.\u6807\u7B7E);
    const kindAliases = /* @__PURE__ */ new Map([["\u6B66\u5668", "weapon"], ["\u9632\u5177", "armor"], ["\u9970\u54C1", "accessory"], ["\u6D88\u8017\u54C1", "consumable"]]);
    const declaredKind = ["weapon", "armor", "accessory", "consumable"].includes(r.kind) ? r.kind : kindAliases.get(r.\u7C7B\u578B);
    const kind = isShield ? "shield" : declaredKind || (["mainHand", "offHand", "twoHands"].includes(slot) || r.damage || r.attack != null || r.weaponClass || /攻击|双手|巨剑|长戟|弓|弩|法杖|发射器/.test(`${name} ${labels}`) ? "weapon" : "accessory");
    const isWeapon2 = kind === "weapon";
    const idBase = `item-${owner.length}-${owner.slice(0, 31)}-${hash(owner).toString(36)}-${index}`;
    const templateId = `template-${idBase}`;
    const effects2 = convertEffects(r.effects ?? r.effectsList ?? r.\u6548\u679C, "equipment", sink("effect", `/equipment/${templateId}`), `fx-${hash(templateId).toString(36)}`);
    const template = { name: name.slice(0, 100), kind, effects: effects2 };
    const defenseTag = labels.match(/防御\s*[:：]\s*([\d.e+-]+)/i);
    const defense = bound(r.defense ?? r.\u9632\u5FA1 ?? defenseTag?.[1], 0, 1e6, kind === "shield" ? 1 : 0);
    if (kind === "shield") Object.assign(template, { weaponClass: "shield", hand: "off_hand", shield: true, defense });
    else if (isWeapon2) {
      const classes = ["ranged", "light_blade", "greatsword", "staff", "auxiliary"];
      const weaponClassAlias = /* @__PURE__ */ new Map([["bow", "ranged"], ["crossbow", "ranged"], ["arcane", "staff"]]);
      const explicitClass = weaponClassAlias.get(r.weaponClass) ?? r.weaponClass;
      const ranged = r.ranged ?? (r.rangeType ? r.rangeType === "ranged" : ["ranged", "staff"].includes(explicitClass) || /弓|弩|法杖|远程|发射器/.test(`${name} ${labels}`));
      const twoHanded = slot === "twoHands" || r.twoHanded === true || r.hand === "two_handed" || explicitClass === "greatsword" || /双手|巨剑|重剑|长戟|重斧|重锤|长枪/.test(`${name} ${labels}`);
      const attackTag = labels.match(/攻击(?:力)?\s*[:：]\s*([\d.e+-]+)/i), rangeTag = labels.match(/(?:有效距离|射程)[^\d]*(\d+)/i);
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
    const declared = new Set(resourceDefinitions(template).map((node3) => node3.resource));
    const missing = /* @__PURE__ */ new Set();
    for (const expr of effects2) for (const node3 of effectNodes(expr.effects)) {
      if (node3.local && ["produceResource", "restoreResource", "drainResource"].includes(node3.kind) && !declared.has(node3.resource)) missing.add(node3.resource);
    }
    for (const key4 of missing) sink("effect", `/equipment/${templateId}`).push(`\u88C5\u5907\u300C${name}\u300D\u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u5B9E\u4F8B\u8BA1\u6570\u5668 ${key4}\uFF0C\u8FD0\u884C\u65F6\u4F1A\u88AB\u8DF3\u8FC7`);
    const counters = initialCounters(template);
    return { id: idBase, templateId, template, counters, slot, name };
  }
  function sourceEquipment(record2) {
    const value = record2.equipment ?? record2.equipments ?? record2.items ?? record2.\u88C5\u5907 ?? [];
    const slots = new Map(Object.entries({ mainHand: "mainHand", main: "mainHand", weapon: "mainHand", \u4E3B\u624B: "mainHand", \u53CC\u624B: "twoHands", \u53CC\u624B\u6B66\u5668: "twoHands", offHand: "offHand", off: "offHand", \u526F\u624B: "offHand", shield: "shield", \u76FE\u724C: "shield" }));
    const entries2 = Array.isArray(value) ? value.map((v) => ["", v]) : Object.entries(asObject(value));
    return entries2.filter(([, item]) => object3(item)).map(([key4, item], i) => {
      const position = [item.slot, item.position, item.\u4F4D\u7F6E].map(text2).find(Boolean);
      const tags2 = [].concat(item.tags ?? item.\u6807\u7B7E ?? []).map(text2).join(",");
      const hand = tags2.match(/(?:^|[\s,，、;；\[\]【】])(?:位置\s*[:：]\s*)?(主手|副手|双手(?:武器)?|盾牌)(?=$|[\s,，、;；\[\]【】])/u)?.[1];
      const rawSlot = position || (slots.has(key4) ? key4 : hand || key4);
      return [slots.get(rawSlot) ?? rawSlot, { ...item, name: item.name ?? item.\u540D\u79F0 ?? (slots.has(key4) ? "" : key4) }, i];
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
  var lengthKeys = ["bodyLengthM", "bodyLength", "BL", "bl", "\u4F53\u957F", "\u8EAB\u9AD8"];
  var lengthToken = /(\d+(?:\.\d+)?|\.\d+)\s*(厘米|cm|米|m)?/i;
  var modifiers2 = "(?:\u5927\u7EA6|\u7EA6|[~\uFF5E])?\\s*";
  var explicitLength = new RegExp(`^${modifiers2}${lengthToken.source}$`, "i");
  var describedLength = new RegExp(`(?:\u8EAB\u9AD8|\u4F53\u957F|\u9AD8\u5EA6|\u9AD8\u7EA6|\u957F\u7EA6)\\s*[:\uFF1A]?\\s*${modifiers2}${lengthToken.source}(?![\\d.a-z])`, "gi");
  function meters(match) {
    if (!match) return null;
    const n = Number(match[1]) / (/^(cm|厘米)$/i.test(match[2]) ? 100 : 1);
    return Number.isFinite(n) && n > 0 ? Math.max(0.01, Math.min(1e9, n)) : null;
  }
  function readBodyLength(record2, warnings) {
    const keys = lengthKeys.filter((key4) => own5(record2, key4));
    for (const key4 of keys) {
      const raw = record2[key4];
      const length = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.max(0.01, Math.min(1e9, raw)) : typeof raw === "string" ? meters(explicitLength.exec(raw.replace(/\([^()]*\)|（[^（）]*）/g, "").trim())) : null;
      if (length !== null) return length;
    }
    for (const field of ["\u5916\u8C8C\u7279\u8D28", "\u5916\u8C8C", "\u63CF\u8FF0", "appearance", "description"]) {
      const value = record2[field];
      const prose = Array.isArray(value) ? value.filter((s) => typeof s === "string").join("\n") : object3(value) ? Object.entries(value).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => `${k}: ${v}`).join("\n") : value;
      if (typeof prose !== "string") continue;
      for (const match of prose.matchAll(describedLength)) {
        const length = meters(match);
        if (length !== null) return length;
      }
    }
    if (keys.length) warnings.push(`\u4F53\u957F\u300C${text2(record2[keys[0]])}\u300D\u65E0\u6CD5\u89E3\u6790\uFF0C\u5DF2\u6309\u9ED8\u8BA4 1.7 \u7C73\u5904\u7406`);
    return 1.7;
  }
  function mergeBattleParticipant(record2, participant, battle) {
    const fallback = asObject(record2), inline = asObject(participant);
    const battleEquipment = battleEquipmentRecord(participant, battle), battleSkills = battleSkillsRecord(participant, battle);
    const merged = { ...fallback };
    if (!(merged.equipment ?? merged.equipments ?? merged.items ?? merged.\u88C5\u5907) && battleEquipment) merged.equipment = battleEquipment;
    if (!(merged.skills ?? merged.abilities ?? merged.\u6280\u80FD) && battleSkills) merged.skills = battleSkills;
    const fields3 = {
      bodyLengthM: lengthKeys,
      mc: ["mc", "MC", "massClass"],
      tier: ["tier", "levelTier", "\u5C42\u7EA7", "\u751F\u547D\u5C42\u7EA7"],
      armor: ["armor", "defense", "\u62A4\u7532"],
      stats: ["stats", "attributes", "\u5C5E\u6027", ...attrNames, ...Object.keys(statAliases)],
      statuses: ["statuses", "\u72B6\u6001\u6548\u679C", "\u72B6\u6001", "effects"],
      hp: ["hp", "HP", "\u751F\u547D\u503C", "resources", "resource", "\u8D44\u6E90"],
      mp: ["mp", "MP", "\u6CD5\u529B\u503C", "resources", "resource", "\u8D44\u6E90"],
      sp: ["sp", "SP", "\u4F53\u529B\u503C", "resources", "resource", "\u8D44\u6E90"]
    };
    for (const [field, aliases2] of Object.entries(fields3)) {
      if (inline[field] != null && !aliases2.some((alias) => own5(merged, alias))) merged[field] = clone(inline[field]);
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
      const key4 = text2(participant?.id || participant?.uid) || (source && !charSources.includes(source.toLowerCase()) ? source : `${source}|${text2(participant?.name) || index}`);
      if (seen.has(key4)) return false;
      seen.add(key4);
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
  function importBackpack(bag, owner, skills, sink) {
    const inventory = {};
    for (const [name, item] of Object.entries(asObject(bag))) {
      if (item?.\u7C7B\u578B !== "\u6D88\u8017\u54C1" && item?.kind !== "consumable") continue;
      const count = bound(item.\u6570\u91CF ?? item.count, 0, 1e9, 1);
      if (!count) continue;
      const id3 = `bag-${hash(owner).toString(36)}-${hash(name).toString(36)}`;
      const warnings = sink("effect", `/skills/${id3}`);
      const raw = item.effects ?? item.\u6548\u679C;
      const tags2 = [].concat(item.tags ?? item.\u6807\u7B7E ?? []).join(" ");
      const range = bound(item.range ?? tags2.match(/(?:射程|有效距离)\s*[:：][^\d]*(\d+)/)?.[1], 0, 15, 3);
      let effects2;
      const entries2 = Object.entries(asObject(raw));
      const simple = entries2.length === 1 && /^(物理|能量|精神|真实)伤害$/.exec(entries2[0][0]);
      const amount2 = simple && /^造成\s*(\d+)\s*(?:点)?伤害[。.]?$/.exec(entries2[0][1]);
      if (amount2) effects2 = [{ id: `${id3}-use`, trigger: "active", target: "hitTarget", effects: [{ kind: "damage", damageType: damageAliases.get(simple[1]), flat: bound(amount2[1], 0, 1e9) }] }];
      else {
        const notes2 = [];
        effects2 = convertEffects(raw, "skill", notes2, id3);
        for (const note of notes2) warnings.push(`\u80CC\u5305\u6D88\u8017\u54C1\u300C${name}\u300D\uFF1A${note}`);
        if (!effects2.length && !notes2.length) warnings.push(`\u80CC\u5305\u6D88\u8017\u54C1\u300C${name}\u300D\u7F3A\u5C11\u6548\u679C\uFF1A\u8BF7\u6309\u540D\u79F0\u63A8\u5B9A\u7528\u9014\u3001\u76EE\u6807\u548C\u6570\u503C\uFF0C\u8865\u5168\u53EF\u6267\u884C\u6548\u679C`);
      }
      const target2 = ["enemy", "ally", "self", "any", "cell", "corpse"].includes(item.target) ? item.target : "enemy";
      const shape2 = ["circle", "line", "fan", "cone"].includes(item.shape) ? item.shape : "single";
      skills[id3] = {
        name: name.slice(0, 100),
        backpackItem: true,
        ap: 1,
        slot: "action",
        range,
        shape: shape2,
        target: target2,
        effects: effects2,
        ...item.radius != null && { radius: bound(item.radius, 0, 6) },
        ...item.width != null && { width: bound(item.width, 0, 6) }
      };
      inventory[id3] = count;
    }
    return inventory;
  }
  function unitFrom(record2, participant, index, equipment, skills, items, sink, isProtagonist) {
    const resourcesSink = sink("resource"), warnings = sink("status");
    const p = participant ?? {};
    const name = text2(p.protagonistName || p.name) || sourceName(record2, p.id) || `\u5355\u4F4D ${index + 1}`;
    const id3 = p.id;
    const stats2 = statsOf(record2), level = Math.max(1, integer3(findValue(record2, ["level", "\u7B49\u7EA7"], 1), 1));
    const tier = Math.max(1, Math.min(7, tierNumber(findValue(record2, ["tier", "levelTier", "\u5C42\u7EA7", "\u751F\u547D\u5C42\u7EA7"], level), level)));
    const bodyLengthM = readBodyLength(record2, sink("state"));
    const size = sizeClassFor(bodyLengthM);
    const mc = Math.max(1, Math.min(64, integer3(findValue(record2, ["mc", "MC", "massClass"], bodyLengthM >= 10 ? 2 : 1), 1)));
    const resources = { hp: safeResource(resource2(record2, "hp", Math.max(1, stats2.con * 100)), "hp", resourcesSink), mp: safeResource(resource2(record2, "mp", Math.max(0, (stats2.int + stats2.spi) * 10)), "mp", resourcesSink), sp: safeResource(resource2(record2, "sp", Math.max(0, (stats2.str + stats2.agi) * 10)), "sp", resourcesSink) };
    const slotItems = sourceEquipment(record2).map(([slot, value, i]) => normalizeEquipment(value, slot, id3, i, sink));
    for (const item of slotItems) {
      equipment[item.templateId] ??= item.template;
      items[item.id] = { id: item.id, templateId: item.templateId, counters: item.counters };
    }
    const main = slotItems.find((i) => i.template.kind === "weapon" && i.template.twoHanded) ?? slotItems.find((i) => i.template.kind === "weapon" && i.slot === "mainHand") ?? slotItems.find((i) => i.template.kind === "weapon" && i.slot !== "offHand");
    const off = !main?.template.twoHanded && slotItems.find((i) => i.slot === "offHand" && ["weapon", "consumable"].includes(i.template.kind));
    const shield = !main?.template.twoHanded && slotItems.find((i) => i.template.kind === "shield");
    const gear = slotItems.filter((i) => ![main, off, shield].includes(i));
    const mainId = main?.id ?? null, offId = off?.id ?? null, shieldId = shield?.id ?? null;
    const skillInfo = {};
    const normalizedSkills = sourceSkills(record2).slice(0, 32).map(([raw, i]) => {
      const r = asObject(raw), sid = `skill-${id3.slice(0, 31)}-${hash(id3).toString(36)}-${i}`;
      const labels = [].concat(r.tags ?? r.\u6807\u7B7E ?? [], r.description ?? r.\u63CF\u8FF0 ?? "").join(" ");
      const taggedPower = labels.match(/威力\s*[:：]\s*(\d+)/)?.[1];
      const taggedRange = labels.match(/有效距离\s*[:：][^\d\]]*(\d+)/)?.[1];
      const costs = skillCosts(r.cost ?? r.\u6D88\u8017);
      const tag = labels.match(/伤害\s*[:：]\s*([^\]]+)/)?.[1]?.trim();
      const rawEffects = r.effects ?? r.\u6548\u679C;
      const power = r.power ?? taggedPower;
      const legacyDamage = !r.damage && power != null ? legacyPercentDamage(rawEffects) : [];
      const damageType2 = r.damageType ?? (legacyDamage.length === 1 ? legacyDamage[0].damageType : damageAliases.get(tag));
      skillInfo[sid] = { description: text2(r.description ?? r.\u63CF\u8FF0), damageType: damageType2, hp: costs.hp };
      skills[sid] = {
        name: text2(r.name ?? r.\u540D\u79F0).slice(0, 100) || `\u6280\u80FD${i + 1}`,
        quality: "\u666E\u901A",
        ap: bound(r.ap ?? costs.ap, 1, 2),
        slot: (r.slot ?? costs.slot) === "action" ? "action" : "attack",
        range: bound(r.range ?? taggedRange, 0, 15, 1),
        shape: ["single", "circle", "fan", "cone", "line"].includes(r.shape) ? r.shape : "single",
        target: ["enemy", "ally", "self", "any", "corpse", "cell"].includes(r.target) ? r.target : "enemy",
        ...text2(r.school) ? { school: text2(r.school).slice(0, 100) } : {},
        effects: legacyDamage.length ? [] : convertEffects(rawEffects, "skill", sink("effect", `/skills/${sid}`), `fx-${hash(sid).toString(36)}`)
      };
      const emptyEffects = Array.isArray(rawEffects) ? rawEffects.every(emptyEntry) : emptyEntry(rawEffects);
      const nodes = legacyDamage.length ? legacyDamage : emptyEffects && !r.damage && power != null ? damageTags(tag, power) : [];
      if (nodes.length) {
        skills[sid].effects.push({ id: `fx-${hash(sid).toString(36)}-damage`, trigger: "active", target: "hitTarget", effects: nodes });
      }
      if (damageType2 != null) skills[sid].damageType = damageType2;
      for (const [key4, min, max] of [["mp", 0, 25e3], ["sp", 0, 25e3], ["radius", 0, 6], ["width", 0, 6], ["accuracy", -20, 30], ["power", 0, 1e9]]) {
        const value = r[key4] ?? (key4 === "power" ? taggedPower : costs[key4]);
        if (value != null) skills[sid][key4] = bound(value, min, max);
      }
      if (attrNames.includes(r.save) && r.saveDC != null) {
        const saveDC = typeof r.saveDC === "object" ? r.saveDC : bound(r.saveDC, 1, 50);
        if (validSaveDC(saveDC)) Object.assign(skills[sid], { save: r.save, saveDC: structuredClone(saveDC) });
      }
      if (object3(r.resourceCost)) skills[sid].resourceCost = clone(r.resourceCost);
      if (costs.hp != null) skills[sid].resourceCost = { hp: bound(costs.hp, 0, 25e3), ...skills[sid].resourceCost };
      for (const key4 of ["damage", "heal"]) if (object3(r[key4])) skills[sid][key4] = normalizeDice(r[key4]);
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
      const modifiers3 = { ...template.modifiers };
      if (rawStatus && own5(rawStatus, "modifiers") && !emptyEntry(rawStatus.modifiers)) {
        try {
          validateStatusModifiers(template, rawStatus.modifiers);
          Object.assign(modifiers3, rawStatus.modifiers);
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
        modifiers: modifiers3,
        ...own5(modifiers3, "amount") ? { amount: bound(rawStatus?.amount ?? rawStatus?.\u62A4\u76FE\u503C, 1, 1e9, modifiers3.amount) } : {}
      };
    }
    const stance = stanceFor({ mainHand: main ? main.template : null, offHand: off?.template ?? null, shield: shield?.template ?? null });
    const team2 = teamOf(p.faction ?? p.team, "red");
    const rawFacing = Array.isArray(p.facing) ? p.facing : [team2 === "blue" ? 1 : -1, 0];
    const facing = rawFacing.slice(0, 2).map((n) => Math.sign(integer3(n)));
    if (facing.length !== 2 || !facing.some(Boolean)) facing.splice(0, 2, team2 === "blue" ? 1 : -1, 0);
    const unit = { id: id3, name, team: team2, x: pos2.x, y: pos2.y, ...Number.isInteger(p.altitude) && p.altitude > 0 ? { altitude: p.altitude } : {}, facing, hp: resources.hp.current, maxHp: resources.hp.max, mp: resources.mp.current, maxMp: resources.mp.max, sp: resources.sp.current, maxSp: resources.sp.max, ap: 0, used: { action: 0, attack: 0 }, stats: stats2, armor: Math.max(0, Math.min(1e6, integer3(findValue(record2, ["armor", "defense", "\u62A4\u7532"], 0), 0))), size, move: Math.max(1, Math.min(10, integer3(findValue(record2, ["move", "movement", "\u79FB\u52A8"], 3), 3))), weapon: mainId, mainHand: mainId, offHand: offId, shield: shieldId, gear: gear.slice(0, 12).map((item) => item.id), skills: normalizedSkills, statuses, tier, bodyLengthM, mc, stance, greatswordMode: "offensive", parryQuota: stance === "greatsword" ? 2 : 0, parryRefunded: false, attunementCharges: stance === "attunement" ? 2 : 0, bonusDice: 0, penaltyDice: 0, intent: "normal", nonLethal: p.nonLethal === true, moraleType: moraleTypeFor(p.moraleType) ?? "standard", ...isProtagonist && { protagonist: true } };
    if (p.moraleType && !moraleTypeFor(p.moraleType)) sink("state").push(`\u672A\u77E5\u6218\u6597\u7C7B\u578B\u300C${p.moraleType}\u300D\uFF0C\u6309\u6807\u51C6\u5904\u7406`);
    if (isProtagonist) {
      const bagWeapons = [];
      for (const [slot, raw, index2] of sourceEquipment({ \u88C5\u5907: record2.\u80CC\u5305 })) {
        if (raw.\u7C7B\u578B !== "\u6B66\u5668" && raw.kind !== "weapon" || bound(raw.\u6570\u91CF ?? raw.count, 0, 1e9, 1) === 0) continue;
        const item = normalizeEquipment(raw, slot, id3, `bag-${index2}`, sink);
        if (item.template.kind !== "weapon") continue;
        equipment[item.templateId] = item.template;
        items[item.id] = { id: item.id, templateId: item.templateId, counters: item.counters };
        bagWeapons.push(item.id);
      }
      if (bagWeapons.length) unit.bagWeapons = bagWeapons;
      const inventory = importBackpack(record2.\u80CC\u5305, id3, skills, sink);
      if (Object.keys(inventory).length) unit.inventory = inventory;
    }
    const creatureType = p.creatureType ?? record2.creatureType;
    if (Array.isArray(creatureType)) unit.creatureType = creatureType.map(text2).filter(Boolean).slice(0, 12);
    else if (text2(creatureType)) unit.creatureType = text2(creatureType).slice(0, 100);
    const tags2 = p.tags ?? record2.tags;
    if (Array.isArray(tags2)) unit.tags = tags2.map((tag) => text2(tag).slice(0, 100)).filter(Boolean).slice(0, 32);
    return { unit, profile: { id: id3, skillInfo, level, tier, stats: stats2, bodyLengthM, size, mc, hp: resources.hp, mp: resources.mp, sp: resources.sp, equipment: clone(slotItems), sourcePath: record2.__sourcePath ?? null, sourceKind: record2.__sourceKind || "unknown", fieldSources: { numeric: record2.__sourceKind || "unknown", equipment: record2.__sourceKind || "unknown", placement: "battle_init", faction: "battle_init", name: p.protagonistName ? "persona" : p.name ? "battle_init" : record2.__sourceKind || "unknown" } }, participant: p };
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
      state.covers[id3] = { id: id3, name: text2(raw.name) || `\u63A9\u4F53${i + 1}`, x: p.x, y: p.y, z: p.z, material: text2(raw.material) || "\u672A\u77E5\u6750\u6599", hp: Math.max(0, Math.min(1e9, integer3(raw.hp ?? raw.maxHp ?? 10, 10))), maxHp: Math.max(1, Math.min(1e9, integer3(raw.maxHp ?? raw.hp ?? 10, 10))), cover: Math.max(0, Math.min(12, integer3(raw.cover ?? raw.shielding, 2))) };
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
      const declared = text2(raw.kind ?? raw.type).toLowerCase();
      const kind = ["altar", "barrel"].includes(declared) ? declared : /祭坛|altar/.test(text2(raw.name)) ? "altar" : "barrel";
      state.interactives[id3] = { id: id3, name: text2(raw.name) || (kind === "altar" ? "\u661F\u8F89\u796D\u575B" : "\u4F59\u70EC\u7206\u6876"), x: p.x, y: p.y, z: p.z, kind, effect: text2(raw.effect) || (kind === "barrel" ? "explode" : "heal"), radius: integer3(raw.radius, 2), damage: integer3(raw.damage, kind === "barrel" ? 12 : 0), spent: Boolean(raw.spent) };
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
    const sink = (unitId, source2, scope, path) => warningSink(warnings, unitId, source2, scope, path);
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
      const origin = record2.__sourceKind?.toLowerCase() ?? "battle_init";
      if (index < participants.length && !resolved[index] && participant.source) sink(id3, "battle_init", "state").push(`\u672A\u627E\u5230\u53C2\u6218\u6765\u6E90\uFF1A${participant.source}\uFF08${participant.name ?? participant.id}\uFF09`);
      const made = unitFrom(mergeBattleParticipant(record2, participant, battle), { moraleType: battle.moraleType, ...participant, ...persona, id: id3 }, index, equipment, skills, items, (scope, path) => sink(id3, origin, scope, path), record2 === protagonist);
      units[id3] = made.unit;
      profiles[id3] = made.profile;
      sourceMap[id3] = { path: record2?.__sourcePath, sourceId: sourceId(record2), sourceName: sourceName(record2), isProtagonist: record2 === protagonist };
    };
    for (const [i, participant] of participants.entries()) {
      const record2 = resolved[i];
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
    const state = { ...battle.suppressingTeam && { suppressingTeam: battle.suppressingTeam }, battleType: moraleTypeFor(battle.moraleType) ?? "standard", scenarioId: descriptor ? battle.battleId : deterministicId(battle.battleId ?? title, "battle"), title, mode: "split", ruleset: ["protocol", "sandbox"].includes(options.ruleset) ? options.ruleset : "protocol", round: 1, turn: 0, order: Object.keys(units), units, items, equipment, skills, statusTemplates: {}, grid: [], covers: {}, interactives: {}, zones: {}, rng: seed, logs: [], outcome: null };
    const time = parseBattleTime(source.task, source.battle, source.battleText, source.latestFloor, source.battleInit, source.battle_init);
    if (time) state.time = time;
    terrainState(battle, state, sink(null, "terrain", "terrain"));
    uniquePositions(state.units, state);
    let valid = true;
    try {
      validateState(state);
    } catch (error2) {
      valid = false;
      sink(null, null, "state").push(`\u8F6C\u6362\u7ED3\u679C\u672A\u901A\u8FC7\u6821\u9A8C\uFF1A${error2.message}`);
      if (options.throwOnValidation) throw error2;
    }
    if (valid) beginBattle(state);
    const roster = Object.values(units).map((unit) => ({ ...profiles[unit.id], ...clone(unit), source: profiles[unit.id].sourceKind }));
    Object.defineProperty(state, "warnings", { value: warnings });
    return { state, roster, warnings, sourceMap, battleInit: battle, seed };
  }
  function warningsForUnit(warnings = [], unitIds, includeGlobal = true) {
    if (!unitIds?.length) return warnings;
    const selected = new Set(unitIds);
    return warnings.filter((w) => w.unitId === null ? includeGlobal : selected.has(w.unitId));
  }
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
      for (const key4 of ["hp", "mp", "sp"]) if (unit && Number.isFinite(unit[key4])) ops.push({ op: "replace", path: pointer([options.root ?? "stat_data", ...path, key4]), value: unit[key4] });
      if (unit?.statuses && options.includeStatuses !== false) ops.push({ op: "replace", path: pointer([options.root ?? "stat_data", ...path, "statuses"]), value: clone(unit.statuses) });
    }
    return ops;
  }
  function buildMvuJsonPatch(report, sourceMap = {}, options = {}) {
    const patch = battleReportToMvuPatch(report, sourceMap, options);
    return `<UpdateVariable><JSONPatch>${JSON.stringify(patch)}</JSONPatch></UpdateVariable>`;
  }

  // src/tavern/resolved-warnings.js
  var warningKey = (w) => JSON.stringify([w.source, w.scope, w.originPath ?? "", w.message]);
  var strings = (v) => (Array.isArray(v) ? v : [v]).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  var matches2 = (message, s) => message.includes(s) || s.includes(message);
  var subject = (message) => message.match(/已忽略[：:]\s*([^：:，。]+)/)?.[1]?.trim() ?? message.match(/^(?:效果|状态)\s+(.+?)\s*已拒绝/)?.[1]?.trim();
  var describesWarning = (item, warning) => {
    const label = subject(warning.message);
    return matches2(warning.message, item) || Boolean(label && item.includes(label));
  };
  function pendingDiagnostics(warnings, unresolved) {
    const notes2 = [...new Set(strings(unresolved))];
    return [
      ...warnings.map((warning) => {
        const details = notes2.filter((note) => note !== warning.message && describesWarning(note, warning));
        return details.length ? `${warning.message}\uFF08\u6A21\u578B\u8BF4\u660E\uFF1A${details.join("\uFF1B")}\uFF09` : warning.message;
      }),
      ...notes2.filter((note) => !warnings.some((warning) => describesWarning(note, warning)))
    ];
  }
  function resolvedDiagnostics(sent, records, patch, reply) {
    const top = [...strings(reply.resolved), ...strings(reply.resolvedWarnings)];
    const declared = top.length || patch.some((op) => op.resolves != null);
    const identified = (op, warning) => [].concat(op.resolves ?? []).some((receipt) => receipt && typeof receipt === "object" && receipt.unitId === warning.unitId && receipt.originPath === (warning.originPath ?? null) && receipt.message === warning.message);
    const pending = strings(reply.unresolved);
    const isPending = (w) => pending.some((item) => describesWarning(item, w));
    return sent.filter((w) => {
      if (w.unitId == null || !Object.hasOwn(records, w.unitId) || isPending(w)) return false;
      const label = subject(w.message);
      if (top.some((s) => w.message.includes(s) && sent.filter((other) => other.unitId != null && Object.hasOwn(records, other.unitId) && other.message.includes(s)).length === 1)) return true;
      return patch.some((op) => {
        const owner = op.path.match(/^\/units\/([^/]+)/)?.[1];
        if (owner && owner !== w.unitId) return false;
        const path = op.path.split("/").slice(0, 3).join("/");
        if (w.originPath && path.split("/")[1] === w.originPath.split("/")[1] && path !== w.originPath) return false;
        if (declared) return identified(op, w) || strings(op.resolves).some((s) => w.message.includes(s) && sent.filter((other) => Object.hasOwn(records, other.unitId) && other.message.includes(s) && (!owner || other.unitId === owner) && (!other.originPath || path.split("/")[1] !== other.originPath.split("/")[1] || path === other.originPath)).length === 1);
        if (!w.originPath) {
          const [, , , field, statusId2] = op.path.split("/");
          return owner === w.unitId && field === "statuses" && w.scope === "status" && !!statusId2 && w.message.includes(statusId2);
        }
        if (path !== w.originPath) return false;
        return sent.filter((other) => other.unitId === w.unitId && other.originPath === path && !isPending(other)).length === 1 || label && JSON.stringify(op.value ?? "").includes(label);
      });
    });
  }
  function activeWarningReceipts(batches) {
    const receipts = /* @__PURE__ */ new Map();
    for (const batch of batches) for (const { unitId, key: key4 } of batch.receipts ?? []) {
      if (!receipts.has(unitId)) receipts.set(unitId, /* @__PURE__ */ new Set());
      receipts.get(unitId).add(key4);
    }
    return receipts;
  }
  function normalizationCandidates(characters, snapshots, warnings) {
    const pending = new Set(warnings.map((w) => w.unitId));
    return Object.keys(characters).filter((id3) => pending.has(id3) || !snapshots[id3]?.normalized || snapshots[id3].hash !== characters[id3].hash);
  }
  function remainingDiagnostics(warnings, snapshots, characters, batches = []) {
    const receipts = activeWarningReceipts(batches);
    return warnings.filter((w) => {
      const snapshot = snapshots[w.unitId];
      const key4 = warningKey(w);
      return !receipts.get(w.unitId)?.has(key4) && (!snapshot || snapshot.hash !== characters[w.unitId]?.hash || !snapshot.resolvedWarnings?.includes(key4));
    });
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
  var ciDark = `--ci-bg:#121417;--ci-surface:#1b1e22;--ci-surface-raised:#23272c;--ci-surface-soft:#2c3137;--ci-input:#0f1114;--ci-border:#494236;--ci-border-strong:#6a5b43;--ci-text:#f7f2e9;--ci-text-secondary:#d9cfbf;--ci-text-muted:#aea290;--ci-primary:#d2ac6d;--ci-primary-strong:#b88a46;--ci-primary-soft:rgb(210 172 109 / 18%);--ci-on-primary:#1d1811;--ci-success:#88a18e;--ci-danger:#d4878c;--ci-warning:#d2ad71;--ci-shadow:rgb(0 0 0 / 58%);color-scheme:dark`;
  var ciLight = `--ci-bg:#e3ded6;--ci-surface:#f0ece6;--ci-surface-raised:#f6f2ec;--ci-surface-soft:#d5cec4;--ci-input:#f8f5ef;--ci-border:#b9aa96;--ci-border-strong:#806b50;--ci-text:#1f1d1a;--ci-text-secondary:#403a34;--ci-text-muted:#5d544a;--ci-primary:#6b4a22;--ci-primary-strong:#513615;--ci-primary-soft:rgb(107 74 34 / 12%);--ci-on-primary:#fff8ee;--ci-success:#365844;--ci-danger:#873941;--ci-warning:#68451f;--ci-shadow:rgb(58 47 36 / 24%);color-scheme:light`;
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
  touch-action:none; user-select:none; cursor:grab;
}
[data-fated-tavern-overlay] .fated-tavern-launcher[data-dragged="true"] { cursor:grabbing }
.fated-tavern-panel {
  position:fixed; right:16px; bottom:16px; width:min(1100px,calc(100vw - 32px));
  height:min(820px,calc(100dvh - 32px)); display:flex; flex-direction:column;
  border:var(--panel-border); border-radius:10px; background:var(--panel-bg);
  box-shadow:0 18px 54px rgba(0,0,0,.55); pointer-events:auto; overflow:hidden; min-width:480px; min-height:360px;
}
.fated-tavern-panel.is-fullscreen { border-radius:0; max-width:none; max-height:none }
.fated-tavern-resize { position:absolute; z-index:5; right:0; bottom:0; width:20px; height:20px; cursor:nwse-resize; touch-action:none }
.fated-tavern-resize::after { content:'\u25E2'; position:absolute; right:2px; bottom:0; color:var(--gold-dim); font-size:14px; opacity:.85 }
.fated-tavern-panel.is-fullscreen .fated-tavern-resize { display:none }
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
[data-fated-tavern-overlay] { ${ciDark} }
@media(prefers-color-scheme:light) { [data-fated-tavern-overlay] { ${ciLight} } }
.fated-ci-dark,.fated-ci-dark [data-fated-tavern-overlay] { ${ciDark} }
.fated-ci-light,.fated-ci-light [data-fated-tavern-overlay] { ${ciLight} }
[data-fated-tavern-overlay] article.fated-instance.fated-instance { position:relative; padding:0; margin-block:8px; overflow:hidden; color:var(--ci-text); border:1px solid var(--ci-border); border-radius:10px; background:var(--ci-surface); box-shadow:0 2px 10px var(--ci-shadow) }
[data-fated-tavern-overlay] article.fated-instance::before { display:none }
.fated-char-card { --team:var(--ci-primary); --hp:#d9575a; --mp:#4f8fd8; --sp:#4fae6d }
.fated-char-card[data-team=blue] { --team:#6a9fd6 }.fated-char-card[data-team=red] { --team:#d6737b }
.fated-char-card::after { content:""; position:absolute; inset:0 auto 0 0; width:3px; background:var(--team); pointer-events:none }
.fated-char-heading { display:flex; align-items:center; gap:10px; padding:10px 12px 10px 15px; cursor:pointer; user-select:none }
.fated-char-card[data-collapsed=false] .fated-char-heading { border-bottom:1px solid var(--ci-border) }
.fated-char-heading:hover { background:var(--ci-surface-raised) }
.fated-char-heading input { flex:none; width:18px; height:18px; margin:0; accent-color:var(--ci-primary); cursor:pointer }
.fated-char-avatar { flex:none; display:grid; place-items:center; width:38px; height:38px; border-radius:9px; border:1px solid color-mix(in srgb,var(--team) 60%,transparent);
  background:color-mix(in srgb,var(--team) 22%,var(--ci-surface-soft)); color:var(--ci-text); font-weight:700; font-size:1.05em }
.fated-char-title { flex:1; min-width:0; display:grid; gap:3px }
.fated-char-name-row { display:flex; align-items:baseline; gap:8px; min-width:0 }
.fated-char-name { overflow:hidden; color:var(--ci-text); font-size:1.02em; white-space:nowrap; text-overflow:ellipsis }
.fated-char-warn { flex:none; padding:0 6px; border-radius:8px; background:rgb(210 173 113 / 18%); color:var(--ci-warning); font-size:.75em }
.fated-char-tags { display:flex; flex-wrap:wrap; gap:4px }
.fated-char-tag { padding:0 7px; border:1px solid var(--ci-border); border-radius:9px; color:var(--ci-text-muted); font-size:.74em; line-height:1.6 }
.fated-char-tag:first-child { border-color:color-mix(in srgb,var(--team) 55%,transparent); color:var(--team) }
.fated-char-mini { flex:none; display:grid; gap:3px; width:72px }
.fated-char-mini-bar { position:relative; display:block; height:5px; overflow:hidden; border-radius:3px; background:var(--ci-input) }
.fated-char-mini-bar::after { content:""; position:absolute; inset:0 auto 0 0; width:calc(100% * var(--ratio,0)); border-radius:3px; background:var(--bar) }
.fated-char-card[data-collapsed=false] .fated-char-mini { display:none }
[data-fated-tavern-overlay] .fated-char-card .fated-char-toggle { font-size:1.15em !important;  flex:none; display:grid; place-items:center; width:30px; min-width:0; height:30px; padding:0; border-radius:7px; line-height:1; transition:transform .2s ease }
.fated-char-card[data-collapsed=true] .fated-char-toggle { transform:rotate(-90deg) }
.fated-char-toggle::before { content:""; width:8px; height:8px; margin-top:-4px; border:solid currentColor; border-width:0 2px 2px 0; transform:rotate(45deg) }
.fated-char-body { display:grid; gap:10px; padding:12px 14px 12px 17px }
.fated-char-body[hidden] { display:none }
.is-hp { --bar:linear-gradient(90deg,#a83a3e,var(--hp)) }.is-mp { --bar:linear-gradient(90deg,#2f63a3,var(--mp)) }.is-sp { --bar:linear-gradient(90deg,#327a4a,var(--sp)) }
.fated-char-resources { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin:0 }
.fated-char-bar { position:relative; display:flex; align-items:center; justify-content:space-between; gap:6px; height:22px; padding:0 8px; overflow:hidden; border-radius:6px; background:var(--ci-input); font-size:.8em; font-variant-numeric:tabular-nums }
.fated-char-bar > i { position:absolute; inset:0 auto 0 0; width:calc(100% * var(--ratio,0)); background:var(--bar); opacity:.9; transition:width .4s ease }
.fated-char-bar > b, .fated-char-bar > span { position:relative; color:#fff; text-shadow:0 1px 2px rgb(0 0 0 / 70%); white-space:nowrap }
.fated-char-bar > span { overflow:hidden; text-overflow:ellipsis }
.fated-char-stats { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:5px; margin:0 }
.fated-char-stats div { display:grid; justify-items:center; padding:5px 2px; border:1px solid var(--ci-border); border-radius:7px; background:var(--ci-surface-raised) }
.fated-char-stats dt { color:var(--ci-text-muted); font-size:.74em }.fated-char-stats dd { margin:0; color:var(--ci-primary); font-size:1.08em; font-weight:700; font-variant-numeric:tabular-nums }
.fated-char-section { display:grid; gap:4px }
.fated-instance h5 { margin:0; color:var(--ci-primary); font-size:.82em; letter-spacing:.06em }
.fated-char-row { padding:6px 9px; border:1px solid var(--ci-border); border-radius:7px; background:var(--ci-surface-raised) }
.fated-char-row > summary { list-style:none }.fated-char-row > summary::-webkit-details-marker { display:none }
.fated-char-row-head { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px }
.fated-char-row-name { color:var(--ci-text); font-weight:600; margin-inline-end:2px }
.fated-char-chip { padding:0 6px; border-radius:8px; background:var(--ci-surface-soft); color:var(--ci-text-secondary); font-size:.75em; line-height:1.6 }
.fated-char-fx { margin-inline-start:auto; color:var(--ci-primary); font-size:.75em }
.fated-char-fx::after { content:" \u25BE" }.fated-char-row[open] .fated-char-fx::after { content:" \u25B4" }
.fated-char-row > p { margin:5px 0 0; padding-top:5px; border-top:1px dashed var(--ci-border) }
.fated-instance .fated-mini { color:var(--ci-text-muted); font-size:.82em }.fated-instance summary { cursor:pointer }
.fated-char-diagnostics { padding:6px 9px; border:1px solid rgb(210 173 113 / 45%); border-radius:7px; background:rgb(210 173 113 / 8%); color:var(--ci-warning) }
.fated-char-diagnostics ul { margin:5px 0 0; padding-inline-start:18px; color:var(--ci-text-secondary) }
.fated-char-raw { padding:6px 9px; border:1px dashed var(--ci-border); border-radius:7px; background:var(--ci-input); color:var(--ci-text-secondary); font-size:.85em }.fated-char-raw pre { max-height:12rem; overflow:auto; color:inherit }
.fated-char-body > .fated-actions { justify-content:flex-end; margin:0 }
@media (max-width:520px) { .fated-char-stats { grid-template-columns:repeat(5,minmax(0,1fr)); gap:3px } .fated-char-resources { grid-template-columns:1fr } .fated-char-mini { width:52px } }
[data-fated-tavern-overlay] .fated-instance button:not([data-sandbox-mount] *) {background:var(--ci-surface-raised);border-color:var(--ci-border);color:var(--ci-text-secondary)}
[data-fated-tavern-overlay] .fated-instance button:not([data-sandbox-mount] *):hover {background:var(--ci-primary-soft);border-color:var(--ci-primary);color:var(--ci-primary)}
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
  .fated-tavern-panel { inset:6px !important; width:auto; height:auto; min-width:0; min-height:0 }
  .fated-tavern-header { cursor:default; touch-action:auto }
  [data-fated-tavern-overlay] button:not([data-sandbox-mount] *) { min-height:36px }
}
`;

  // src/tavern/portraits.js
  function readStatusAvatars(dbFactory, scope) {
    if (!dbFactory) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const open = dbFactory.open("status-avatar-db");
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const request = db.transaction("avatars").objectStore("avatars").index("scope_key").getAll(scope);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } catch {
          resolve([]);
        } finally {
          db.close();
        }
      };
    });
  }
  function imageUrl(value, base) {
    if (typeof value !== "string" || !value.trim() || value.includes("{{")) return "";
    const text4 = value.trim();
    if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(text4)) return text4;
    try {
      const url = new URL(text4, base);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || /\.svgz?$/i.test(url.pathname)) return "";
      return url.href;
    } catch {
      return "";
    }
  }
  async function predefinedAvatars(host, readVariables) {
    const variables = await readVariables?.({ type: "character" });
    const version2 = String(variables?.\u8D44\u6E90\u7248\u672C?.\u547D\u5B9A\u4E4B\u8BD7 ?? "").trim().replace(/^v/i, "");
    for (const candidate of /* @__PURE__ */ new Set([version2, "1.2.5"])) {
      if (!/^\d+\.\d+\.\d+$/.test(candidate)) continue;
      try {
        const response = await host.fetch(`https://cdn.poem-of-destiny.com/assets/${candidate}/frontend/assets/data/predefined-avatars.json`, { signal: AbortSignal.timeout(3e3) });
        if (!response.ok) continue;
        const text4 = await response.text();
        const fields3 = text4.replace(
          /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
          (token) => token.startsWith("/") ? "" : token
        );
        return JSON.parse(fields3.replace(/,\s*}/g, "}"));
      } catch {
      }
    }
    return {};
  }
  async function readBattlePortraits(host, units, sourceMap, isCurrent = () => true) {
    const readVariables = hostMethod(host, "getVariables");
    const getCharacterName = hostMethod(host, "getCurrentCharacterName");
    const entries2 = Object.values(units).map((unit) => {
      const source = sourceMap[unit.id];
      const name = source?.path?.[0] === "\u5173\u7CFB\u5217\u8868" ? source.path[1] : source?.sourceName || unit.name;
      return [unit.id, source?.isProtagonist ? "player" : "partner", source?.isProtagonist ? "\u4E3B\u89D2" : name];
    });
    const attempt = async (fn) => {
      try {
        return await fn();
      } catch {
        return void 0;
      }
    };
    const [records, persona, chat] = await Promise.all([
      attempt(async () => readStatusAvatars(host.indexedDB, `status:${await getCharacterName?.() || "unknown-character"}`)),
      attempt(async () => {
        if (!entries2.some(([, type]) => type === "player")) return "";
        for (const scope of hostScopes(host)) {
          const tavern = scope.SillyTavern;
          const macros = tavern?.substituteParams ? tavern : tavern?.getContext?.();
          const value = await macros?.substituteParams?.("{{userAvatarPath}}");
          if (value && value !== "{{userAvatarPath}}") return value;
        }
        return hostMethod(host, "substituteParams")?.("{{userAvatarPath}}");
      }),
      attempt(() => readVariables?.({ type: "chat" }))
    ]);
    const base = host.location?.href;
    const overrides = new Map((records ?? []).map((row) => [`${row.owner_type}::${row.owner_name}`, row]));
    const portraits = {};
    const missing = [];
    for (const [id3, type, name] of entries2) {
      const record2 = overrides.get(`${type}::${name}`);
      if (record2?.source_type === "removed") continue;
      const fallback = type === "player" ? persona : Object.hasOwn(chat?.status?.externalAvatars?.partners ?? {}, name) ? chat.status.externalAvatars.partners[name]?.url : "";
      const candidates = [...new Set([imageUrl(record2?.value, base), imageUrl(fallback, base)].filter(Boolean))];
      if (candidates.length) portraits[id3] = candidates;
      else if (type === "partner" && sourceMap[id3]?.path?.[0] === "\u5173\u7CFB\u5217\u8868") missing.push([id3, name]);
    }
    if (missing.length && isCurrent()) {
      const defaults = await attempt(() => predefinedAvatars(host, readVariables)) ?? {};
      for (const [id3, name] of missing) {
        const url = imageUrl(Object.hasOwn(defaults, name) ? defaults[name] : "", base);
        if (url) portraits[id3] = [url];
      }
    }
    return portraits;
  }

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
    return Object.entries(rule.properties).filter(([key4]) => !skip.includes(key4)).map(([key4, value]) => `${key4}${rule.required.includes(key4) ? "" : "?"}=${describe(value)}`).join("\uFF0C");
  }
  var EFFECT_PROTOCOL = `\u3010\u7EDF\u4E00\u6548\u679C DSL\u3011
\u573A\u666F\u58F0\u660E\u89C4\u5219\uFF1Abattle_init \u7684 unit \u884C\u53EF\u5199 x,y,z\uFF0Cz \u4E3A\u521D\u59CB\u5730\u5F62\u9AD8\u5EA6\uFF08-4\u20268\uFF09\uFF1B\u7701\u7565 z \u4E3A 0\u3002terrain \u6A21\u5F0F\u4F1A\u56F4\u7ED5\u663E\u5F0F\u9AD8\u7A0B\u5408\u7406\u751F\u6210\u9AD8\u53F0\u548C\u5761\u9053\uFF0Cflat \u6A21\u5F0F\u4ECD\u5168\u4E3A z=0\u3002\u521D\u59CB\u98DE\u884C\u6216\u60AC\u6D6E\u7531 unit \u5750\u6807\u672B\u5C3E\u7684 \u98DE\u884C=n \u6216 \u60AC\u6D6E=n \u58F0\u660E\uFF0C\u8868\u793A\u79BB\u5F00\u811A\u4E0B\u5730\u5F62\u7684\u9AD8\u5EA6\uFF0C\u672A\u6CE8\u660E\u9AD8\u5EA6\u65F6\u6309 3 \u5904\u7406\u3002\u53EF\u9009 0\u20132 \u6761 cover \u884C\uFF0C\u683C\u5F0F\u4E3A cover|\u63A9\u4F53ID|\u534A\u6216\u5168|\u63A9\u4F53\u540D\u79F0|x,y,z\uFF0C\u534A\u63A9\u4F53 cover=2\u3001\u5168\u63A9\u4F53 cover=5\uFF1B\u53EF\u9009 0\u20132 \u6761 interact \u884C\uFF0C\u683C\u5F0F\u4E3A interact|\u4E92\u52A8ID|altar\u6216barrel|\u6548\u679C|\u8303\u56F4|\u4F24\u5BB3\u6570\u503C|\u4E92\u52A8\u540D\u79F0|x,y,z\u3002\u6548\u679C\u679A\u4E3E\u4E3A explode\u3001heal\u3001shield\u3001restore\u3002explode \u7528\u653B\u51FB\u69FD\u5E76\u6309\u6B66\u5668\u5C04\u7A0B\u548C\u89C6\u7EBF\u89E6\u53D1\uFF0C\u8303\u56F4\u4E3A\u534A\u5F84\u3001\u4F24\u5BB3\u6570\u503C\u4E3A\u7206\u70B8\u4F24\u5BB3\uFF1Bheal \u7528\u52A8\u4F5C\u69FD\u76F8\u90BB\u6FC0\u6D3B\u5E76\u56DE\u590D\u4F24\u5BB3\u6570\u503C\u7684 HP\uFF1Bshield \u7528\u52A8\u4F5C\u69FD\u76F8\u90BB\u6FC0\u6D3B\u5E76\u7ED9\u4E88\u4F24\u5BB3\u6570\u503C\u7684\u62A4\u76FE\uFF1Brestore \u7528\u52A8\u4F5C\u69FD\u76F8\u90BB\u6FC0\u6D3B\u5E76\u540C\u65F6\u56DE\u590D\u4F24\u5BB3\u6570\u503C\u7684 HP\u3001MP\u3001SP\u3002
changeAltitude \u662F\u8F85\u52A9\u6A21\u578B\u7528\u4E8E\u628A\u6280\u80FD\u3001\u88C5\u5907\u6216\u72B6\u6001\u6548\u679C\u6807\u51C6\u5316\u4E3A\u98DE\u884C/\u60AC\u6D6E\u7684 DSL \u8282\u70B9\u3002\u5B83\u4E0D\u5C5E\u4E8E battle_init\u3002\u8282\u70B9\u9ED8\u8BA4 delta \u4E3A 3\uFF0C\u53EF\u7528\u8D1F\u503C\u4E0B\u964D\uFF0Cland:true \u76F4\u63A5\u843D\u5730\u3002\u5355\u4F4D\u79BB\u5730\u9AD8\u5EA6\u4F1A\u8FDB\u5165\u4E09\u7EF4\u8DDD\u79BB\u3001\u79FB\u52A8\u3001\u89C6\u7EBF\u548C\u6218\u62A5 z \u5FEB\u7167\u3002\u5730\u5F62\u8282\u70B9 modifyTerrain\uFF08terrain: raise/lower/set\uFF0C\u6574\u6570 amount\uFF1Bz \u9650 \u22124\u20268\uFF09\u3001setTerrainKind\uFF08terrainKind: floor/wall/slope\uFF09\u3001addCover\uFF08hp\uFF09\u5747\u5FC5\u586B area\u3002area \u56DB\u79CD\u5199\u6CD5\uFF1A{"cells":[{"x":3,"y":4}]}\u3001{"rect":{"x1":3,"y1":4,"x2":5,"y2":6}}\u3001{"center":"hitTarget","radius":1}\uFF08\u4E5F\u53EF self \u6216 {x,y}\uFF09\u3001{"center":"self","radius":1,"follow":true}\u3002\u5706\u4EE5\u68CB\u76D8\u5E73\u9762\u6B27\u6C0F\u8DDD\u79BB\u8BA1\u7B97\u3002\u4E3B\u52A8\u5730\u5F62\u6280\u80FD\u7528\u6280\u80FD\u6A21\u677F target: cell \u9009\u62E9\u5730\u9762\u683C\uFF0C\u8868\u8FBE\u5F0F target: self\uFF0Carea.center: hitTarget \u53D6\u7784\u51C6\u683C\u3002follow \u5FC5\u987B\u6709\u771F\u5B9E\u5355\u4F4D\u951A\u70B9\uFF0C\u56DE\u5408\u7ED3\u675F\u66F4\u65B0\uFF0C\u6B7B\u4EA1\u6216\u79BB\u573A\u6D88\u6563\u3002
remainingTurns \u4EE5\u5355\u4F4D\u56DE\u5408\u7ED3\u675F\u9012\u51CF\uFF0C\u7701\u7565\u4E3A 1\uFF0Cpersistent:true \u5728\u672C\u573A\u6301\u7EED\uFF08\u8DDF\u968F\u533A\u57DF\u4ECD\u53D7\u951A\u70B9\u751F\u5B58\u9650\u5236\uFF09\u3002\u5230\u671F\u6216\u6D88\u6563\u65F6\u7ACB\u5373\u8FD8\u539F\u539F\u9AD8\u5EA6\u3001\u7C7B\u578B\u5E76\u79FB\u9664\u4E34\u65F6\u63A9\u4F53\uFF0C\u4E0D\u56E0\u5360\u7528\u5EF6\u8FDF\u3002\u65BD\u52A0\u6216\u8FD8\u539F\u5730\u5F62\u65F6\uFF0C\u5761\u7684\u7B49\u6548\u9AD8\u5EA6\u56FA\u5B9A\u4E3A 1\uFF0C\u5176\u4ED6\u683C\u6309 z\uFF1B\u7B49\u6548\u9AD8\u5EA6\u4E0B\u964D\u65F6\uFF0C\u683C\u4E0A\u7684\u5B58\u6D3B\u4E14\u672A\u79BB\u573A\u5355\u4F4D\u6309\u6BCF 1 \u9AD8\u5EA6\u5DEE\u53D7\u5230 50 \u70B9\u56FA\u5B9A\u5760\u843D\u4F24\u5BB3\u3002\u62AC\u9AD8\u65F6\u5355\u4F4D\u968F\u811A\u4E0B\u5730\u5F62\u5347\u9AD8\u3002\u65B0\u9020\u5899\u8DF3\u8FC7\u5360\u7528\u683C\uFF0C\u5168\u90E8\u56E0\u5355\u4F4D\u5360\u7528\u65F6\u8BB0\u5F55\u672A\u89E3\u51B3\u3002\u5DF2\u6709\u63A9\u4F53\u6216\u4E92\u52A8\u70B9\u4E5F\u4F1A\u963B\u6B62\u9020\u5899\u3002
\u88C5\u5907\u4E0E\u6280\u80FD effects \u90FD\u662F\u8868\u8FBE\u5F0F\u6570\u7EC4\uFF080\u202624 \u9879\uFF09\u3002\u6BCF\u6761\u8868\u8FBE\u5F0F\u4F7F\u7528\u6218\u5C40\u5185\u552F\u4E00 id\uFF0Clabel \u662F\u754C\u9762\u663E\u793A\u540D\u3002\u5916\u5C42\u6CA1\u6709 kind\uFF0C\u5185\u5C42\u8282\u70B9\u5FC5\u987B\u6709 kind\u3002\u4E94\u6BB5\u5199\u6CD5\uFF1AWHEN(trigger) \u2192 IF(condition\uFF0C\u53EF\u7701) \u2192 ROLL(\u53EF\u7701) \u2192 TARGET(target) \u2192 DO(effects)\uFF0CWITH \u4EE5\u8282\u70B9\u5B57\u6BB5\u6216\u5171\u4EAB params \u8868\u8FBE\u3002\u8282\u70B9\u540C\u540D\u5B57\u6BB5\u8986\u76D6 params\u3002\u9664\u8868\u4E2D\u58F0\u660E\u5B57\u6BB5\u5916\u4E0D\u5141\u8BB8\u989D\u5916\u5B57\u6BB5\uFF0C? \u8868\u793A\u53EF\u7701\u3002
\u8868\u8FBE\u5F0F\u5B57\u6BB5\uFF1A${fields2(expression2)}\u3002

WHEN\uFF1Apassive \u6301\u7EED\u8BFB\u53D6\uFF0C\u5E38\u9A7B\u4FEE\u6B63\u7528 self \u4E14\u7701\u7565 roll\u3002on_attack \u4E3A\u6B66\u5668\u51FA\u624B\u3001\u547D\u4E2D\u524D\u3002on_hit \u4E3A\u5224\u5B9A\u547D\u4E2D\u540E\uFF0C\u5BF9\u5B9E\u9645\u627F\u4F24\u8005\u89E6\u53D1\uFF0C\u82E5\u4E0D\u5E0C\u671B\u8C41\u514D\u6210\u529F\u65F6\u89E6\u53D1\u5219\u52A0 saved=false\u3002on_damaged \u4E3A\u5B9E\u9645\u6263\u8840\u540E\uFF0C\u53EF\u8BFB attacker\u3001\u4F24\u5BB3\u91CF\u548C melee \u7B49\u6807\u7B7E\u3002on_kill \u4E3A\u51FB\u5012\u654C\u4EBA\uFF0Con_death \u4E3A\u81EA\u8EAB\u6B7B\u4EA1\uFF0Con_ally_death \u4E3A\u961F\u53CB\u6B7B\u4EA1\uFF08\u4E8B\u4EF6\u76EE\u6807\u4E3A\u5012\u4E0B\u7684\u961F\u53CB\uFF09\u3002on_turn_start / on_turn_end \u5BF9\u5E94\u81EA\u8EAB\u56DE\u5408\u3002on_skill_cast \u4E3A\u6280\u80FD\u91CA\u653E\uFF0C\u7ED3\u7B97\u4E3B\u51FB\u524D\u3002on_equip \u88C5\u5907\u540C\u6B65\u65F6\u89E6\u53D1\uFF0C\u9ED8\u8BA4\u6BCF\u6218\u4E00\u6B21\u3002on_heal \u4E3A\u53D1\u51FA\u6CBB\u7597\u540E\uFF0C\u53EF\u8BFB\u6CBB\u7597\u91CF\u3002active \u4E3A\u6280\u80FD\u4E3B\u52A8\u53D1\u52A8\uFF0C\u5199\u5728\u88C5\u5907\u4E0A\u65F6\u72EC\u7ACB\u751F\u6210\u6309\u94AE\uFF0C\u9ED8\u8BA4 1AP \u548C action \u69FD\u3002\u6280\u80FD\u7684 active / on_skill_cast \u8868\u8FBE\u5F0F\u58F0\u660E params.usesPerBattle \u6216 cooldown \u65F6\u9650\u5236\u6574\u62DB\uFF0C\u5408\u6CD5\u65BD\u653E\u5373\u6263\u4E00\u6B21\uFF0C\u5931\u624B\u3001\u8C41\u514D\u6216\u7A7A\u653E\u4E5F\u8BA1\u6570\uFF1B\u88C5\u5907\u751F\u6210\u7684 active \u6280\u80FD\u540C\u7406\u3002\u53EA\u9650\u5236\u547D\u4E2D\u8FFD\u52A0\u6548\u679C\u65F6\u5728 on_hit \u8868\u8FBE\u5F0F\u58F0\u660E\uFF0C\u5B9E\u9645\u751F\u6548\u624D\u8BA1\u6570\u3002usesPerBattle:null \u8868\u793A\u4E0D\u9650\u6B21\u6570\uFF08\u4E5F\u8986\u76D6 on_equip \u9ED8\u8BA4\u6BCF\u6218\u4E00\u6B21\uFF09\uFF0Ccooldown \u4EE5\u6218\u6597\u8F6E\u8BA1\u3002params.source=weapon \u8868\u793A\u53EA\u5728\u672C\u6B21\u4F7F\u7528\u8BE5\u88C5\u5907\u5B9E\u4F8B\u65F6\u751F\u6548\u3002

IF\uFF1A\u6570\u7EC4\u7B49\u4EF7\u4E8E AND\uFF0Cor \u4EFB\u4E00\u6210\u7ACB\u3001not \u53D6\u53CD\u3002self \u4E3A\u53D7\u76CA\u8005\u65F6\uFF0C\u76EE\u6807\u6761\u4EF6\u4F18\u5148\u68C0\u67E5\u5F53\u524D\u653B\u51FB\u6216\u6280\u80FD\u5BF9\u8C61\u3002targetHasCategory \u7684 negative \u6307 debuff/dot/control\uFF0Cnone \u6307\u65E0\u4E09\u7C7B\u8D1F\u9762\u72B6\u6001\u3002timeOfDay \u6765\u81EA <tp>\uFF0CtargetLevel \u4E0E\u81EA\u8EAB\u6BD4\u8F83\u3002\u5E03\u5C14\u6761\u4EF6\u7701\u7565 value \u7B49\u540C true\u3002weaponType\u3001skillSchool\u3001\u6807\u7B7E\u53CA\u7269\u79CD\u5B57\u7B26\u4E32\u4E0E\u5FEB\u7167\u4E00\u81F4\u3002
\u2022 ${condition2.oneOf.map((rule) => rule.type === "array" ? describe(rule) : `${rule.properties.type.const} ${fields2(rule, ["type"])}`).join("\n\u2022 ")}

ROLL\uFF1A\u65E0 roll \u65F6\u4E00\u5B9A\u5C1D\u8BD5\u3002chance \u76F4\u63A5\u7528 0\u20261 \u6BD4\u4F8B\uFF0Cd20 \u6BD4\u8F83 >= gte\u3002save \u53D6\u76EE\u6807 d20+\u5C5E\u6027\uFF0C\u8FBE\u5230 dc \u5219\u901A\u8FC7\u5E76\u8DF3\u8FC7\u8282\u70B9\u3002save \u6570\u7EC4\u5FC5\u987B\u63D0\u4F9B mode\uFF0C\u6210\u5458\u552F\u4E00\uFF0C\u6BCF\u9879\u72EC\u7ACB\u63B7\u9AB0\u3002contest \u7684\u653B\u65B9 d20+attacker \u51CF\u5B88\u65B9 d20+defender \u8FBE\u5230 dc \u65F6\u6267\u884C\u8282\u70B9\u3002\u8C41\u514D\u6216\u5BF9\u6297\u53EF\u540C\u65F6\u63D0\u4F9B chance \u4F5C\u4E3A\u524D\u7F6E\u6982\u7387\u95E8\u3002dc \u4E0E\u6280\u80FD saveDC \u5747\u652F\u6301\u516C\u5F0F\uFF0C\u89C1\u4E0A\u8282\u6570\u503C\u534F\u8BAE\u3002

\u751F\u547D\u5468\u671F\uFF1A\u72B6\u6001\u6A21\u677F\u548C grantStatus \u8282\u70B9\u5747\u53EF\u58F0\u660E expireOn = ${describe(expireOn)}\u3002\u4EFB\u4E00\u89C4\u5219\u5339\u914D\u5C31\u7ACB\u5373\u79FB\u9664\u5E76\u8BB0\u5F55\u539F\u56E0\u3002on_struck \u5728\u547D\u4E2D\u7ED3\u7B97\u4E2D\u3001\u8BA1\u7B97\u788E\u88C2\u589E\u4F24\u4E4B\u540E\u4E14\u6263\u51CF\u62A4\u76FE\u4E4B\u524D\u5339\u914D\uFF0C\u5373\u4F7F\u62A4\u76FE\u5B8C\u5168\u5438\u6536\u4E5F\u89E6\u53D1\uFF1Bon_attack \u5728\u53D1\u52A8\u653B\u51FB\u6216\u654C\u5BF9\u6280\u80FD\u65F6\u5339\u914D\u3002on_damaged \u53EA\u5728\u5B9E\u9645\u6263 HP \u65F6\u5339\u914D\uFF1B\u7F3A\u7701\u6216 any \u5339\u914D\u5168\u90E8\uFF0Cdirect \u5339\u914D\u4E3B\u51FB\u6216\u4E3B\u52A8\u547D\u4E2D\u7684\u4F24\u5BB3\uFF0Cindirect \u5339\u914D\u5468\u671F\u3001\u53CD\u4F24\u53CA\u73AF\u5883\u7B49\u975E\u76F4\u63A5\u4F24\u5BB3\u3002on_heal \u5728\u6301\u6709\u8005\u5B9E\u9645\u6062\u590D HP \u65F6\u5339\u914D\uFF1B\u56DE\u5408\u4E8B\u4EF6\u5728\u5468\u671F\u7ED3\u7B97\u524D\u6253\u65AD\u3002exceptSource:self \u6392\u9664\u6765\u6E90\u4E3A\u72B6\u6001\u6301\u6709\u8005\u7684\u4E8B\u4EF6\u3002\u6388\u4E88\u8282\u70B9\u7684\u89C4\u5219\u4F18\u5148\uFF0C\u5176\u6B21\u4FDD\u7559\u5B9E\u4F8B\u89C4\u5219\uFF0C\u6700\u540E\u4F7F\u7528\u6A21\u677F\u89C4\u5219\u3002patchStatus \u53EF\u8986\u76D6\u5B9E\u4F8B expireOn\uFF0C\u4F20 null \u5173\u95ED\u3002
\u6548\u679C\u5F00\u5173\uFF1A\u6BCF\u4E2A\u8282\u70B9\u53EF\u5199 enabled:true \u6216 enabled:false\uFF0C\u7F3A\u7701\u89C6\u4E3A true\u3002false \u8DF3\u8FC7\u8BE5\u8282\u70B9\uFF08\u5982\u679C\u662F chainEffect\uFF0C\u4E5F\u8DF3\u8FC7\u5176\u5B50\u8282\u70B9\uFF09\uFF0C\u5176\u4ED6\u8282\u70B9\u7167\u5E38\u7ED3\u7B97\u3002\u5267\u60C5/\u8BED\u4E49\u5224\u65AD\u7531\u6A21\u578B\u81EA\u884C\u51B3\u5B9A\uFF0C\u901A\u8FC7 enabled \u5F00\u5173\u8868\u8FBE\uFF0C\u5F15\u64CE\u4E0D\u505A\u6761\u4EF6\u6C42\u503C\u3002\u5DF2\u7ED3\u7B97\u7684\u7ED3\u679C\u6309\u5404\u81EA\u7684\u89C4\u5219\u7EE7\u7EED\u5904\u7406\u3002\u9632\u5FA1\u8282\u70B9 modifyStat(stat:defense) \u4FEE\u6B63\u62A4\u7532\u7ED3\u7B97\uFF0Ccondition:intercepting \u5C06\u5176\u9650\u5236\u5728\u66FF\u961F\u53CB\u627F\u4F24\u65F6\u3002

TARGET\uFF1Aself \u81EA\u8EAB\uFF0ChitTarget \u5F53\u524D\u547D\u4E2D\u6216\u9009\u4E2D\u7684\u5355\u4F4D\uFF0Cattacker \u653B\u51FB\u8005\uFF0CkilledUnit \u88AB\u51FB\u5012\u5355\u4F4D\uFF0Ccorpse \u672A\u88AB\u6D88\u8017\u7684\u5C38\u4F53\u3002enemiesInRadius / alliesInRadius \u4F7F\u7528 params.radius \u6216\u8282\u70B9 radius\uFF08\u9ED8\u8BA41\u683C\uFF09\uFF0C\u65BD\u6CD5\u8303\u56F4\u5185\u4ECE\u8986\u76D6\u683C\u7B5B\u9009\u3002\u8282\u70B9\u53EF\u8986\u5199\u76EE\u6807\u3002\u5C38\u4F53\u4E0D\u4F1A\u963B\u6321\u79FB\u52A8\uFF0CraiseDead \u4F1A\u6D88\u8017\u5C38\u4F53\u3002

DO / WITH\uFF1A\u8282\u70B9\u6309\u6570\u7EC4\u987A\u5E8F\u6267\u884C\uFF0C\u6BCF\u4E2A\u8282\u70B9\u5747\u53EF\u52A0 label\u3001target\u3001condition \u548C radius\uFF080\u202615\uFF09\u3002
\u2022 ${node2.oneOf.map((rule) => `${rule.properties.kind.const}\uFF1A${rule.description} ${fields2(rule, ["kind", "enabled", "label", "target", "condition", "radius"])}`).join("\n\u2022 ")}

\u975E\u81F4\u547D\uFF1Adamage \u8282\u70B9 lethal \u9ED8\u8BA4\u4E3A true\u3002lethal:false \u53EA\u4FDD\u62A4\u8BE5\u8282\u70B9\u7684\u5B9E\u9645\u627F\u4F24\u8005\uFF0C\u5141\u8BB8\u7EC4\u5408 resourceMultiplier\u3001strikeBonus\uFF1B\u62B5\u6263\u7ED3\u7B97\u540E\u6700\u4F4E\u7559 1 HP\u3002\u627F\u4F24\u5355\u4F4D nonLethal:true \u6216\u5176\u72B6\u6001 modifiers.preserveLife:true \u4E5F\u4FDD\u547D\uFF0Clethal:true \u4E0D\u80FD\u7ED5\u5F00\u3002\u500D\u7387\u4E0D\u80FD\u4FDD\u8BC1\u4E0D\u81F4\u6B7B\u3002\u72EC\u7ACB\u7684\u4E3B\u51FB\u548C\u5176\u4ED6\u4F24\u5BB3\u8282\u70B9\u4E0D\u81EA\u52A8\u7EE7\u627F\u6B64\u5F00\u5173\u3002
\u6570\u503C\u4E0E\u7ED3\u7B97\uFF1Aamount/flat \u662F\u7EDD\u5BF9\u91CF\u3002\u767E\u5206\u6BD4\u4EE5\u5C0F\u6570\u8868\u793A\u3002percentOfPrevious \u8BFB\u53D6\u94FE\u5185\u4E0A\u4E00\u6570\u503C\u8282\u70B9\u7684\u5B9E\u9645\u7ED3\u679C\uFF0CpercentOfDamageDealt \u8BFB\u53D6\u672C\u6B21\u5B9E\u9645\u6263\u8840\uFF0CpercentOfPower \u4E58\u6280\u80FD\u57FA\u7840\u5A01\u529B\uFF0CpercentOfHealing \u8BFB\u53D6\u6CBB\u7597\u7ECF\u52A0\u6210\u540E\u7684\u91CF\u3002levelScaling.perLevel \u4ECE 1 \u9636\u57FA\u51C6\u6BCF\u9636\u589E\u957F\uFF0Cmin/max \u5219\u5728 1\u20267 \u9636\u7EBF\u6027\u63D2\u503C\u3002resourceScale \u8BFB\u53D6\u5B58\u91CF\uFF0C\u53EF\u7528 unitSize \u5411\u4E0B\u53D6\u6574\u5206\u7EC4\u3002multiplyDamage \u7684 factor \u662F\u603B\u7CFB\u6570\uFF08+12% \u5199 1.12\uFF09\uFF0Cadditive=true \u5408\u5E76\u5404\u7CFB\u6570\u76F8\u5BF9 1 \u7684\u589E\u91CF\u3002\u4E3B\u51FB\u4E58\u533A\u4F7F\u7528 passive/on_attack/on_skill_cast\u3002modifyDamageBase \u66FF\u6362\u8D77\u4F24\uFF0CignoreAttributes \u7F3A\u7701\u4E3A true\uFF0Cunscaled \u8DF3\u8FC7\u8BC4\u7EA7\u548C\u59FF\u6001\u7B49\u653B\u51FB\u500D\u7387\u3002forceOutcome \u4FDD\u969C\u547D\u4E2D\u6216\u66B4\u51FB\uFF0CupgradeHitTier \u63D0\u9AD8\u5DF2\u547D\u4E2D\u7684\u8BC4\u7EA7\u3002modifyCheck \u7684\u5404\u9879\u5206\u522B\u670D\u52A1\u4E8E\u5148\u653B\u3001\u95EA\u907F\u3001\u6F5C\u884C\u3001\u547D\u4E2D\u3001\u6838\u5FC3\u610F\u56FE\u3001\u9AD8\u5730\u548C\u4F18\u52BF\u3002teleportBackstab \u6821\u9A8C\u80CC\u540E\u7A7A\u683C\u518D\u79FB\u52A8\uFF0C\u63D0\u4F9B\u4F18\u52BF\u548C\u4F24\u5BB3\u500D\u7387\u3002knockback \u78B0\u649E\u9ED8\u8BA4\u4F24\u5BB3 5 \u5E76\u7729\u6655\u3002
\u8D44\u6E90\uFF1Ahp/mp/sp/ap \u548C attack/action \u4E3A\u5185\u7F6E\u8D44\u6E90\u3002\u5176\u4ED6\u8D44\u6E90\u53EF\u5B58\u4E8E\u5355\u4F4D\uFF0C\u6216\u7531 passive/self \u7684 produceResource(cap,initial) \u58F0\u660E\u4E3A\u88C5\u5907\u5B9E\u4F8B\u8BA1\u6570\uFF0Citems.counters \u5FC5\u987B\u4E0E\u8D44\u6E90\u58F0\u660E\u76F8\u7B26\u3002local=true \u53EA\u8BBF\u95EE\u8BE5\u88C5\u5907\u81EA\u5DF1\u7684\u6C60\u3002reloadable \u58F0\u660E\u53EF\u88C5\u586B\u8D44\u6E90\uFF0C\u914D on_attack \u7684 drainResource \u6D88\u8017\u3002\u65E0\u9650\u5F39\u836F\u662F\u72B6\u6001 infinite_ammo\uFF0C\u6D88\u8017\u6761\u4EF6\u53EF\u7528 selfStatusModifier(key=infiniteAmmo,value=false)\u3002requireFull \u4F59\u989D\u4E0D\u8DB3\u65F6\u505C\u6B62\u5F53\u524D\u8282\u70B9\u5217\u8868\uFF0CminimumRemaining \u8BBE\u7F6E\u6700\u4F4E\u4FDD\u7559\u91CF\u3002\u6280\u80FD resourceCost \u5728\u65BD\u653E\u524D\u6263\u9664\uFF0CpercentPerCost \u6309\u82B1\u8D39\u6062\u590D\u3002execute \u7684 strict \u9009\u62E9\u4E25\u683C\u4F4E\u4E8E\u9608\u503C\uFF0CrequiresPool \u68C0\u67E5\u6307\u5B9A\u88C5\u5907\u6C60\u3002stopOnFailure \u94FE\u4F1A\u5728\u9996\u4E2A\u672A\u4EA7\u751F\u6548\u679C\u7684\u8282\u70B9\u505C\u6B62\u3002
\u8D44\u6E90\u65B9\u6848\uFF1A\u5148\u5728\u6301\u6709\u88C5\u5907 effects \u52A0\u4E00\u6761 passive/self \u8868\u8FBE\u5F0F\uFF0C\u8282\u70B9 produceResource \u5199 resource\u3001cap \u548C initial\uFF1B\u540C\u6279\u5411\u5BF9\u5E94\u5B9E\u4F8B /items/<id>/counters/<resource> \u6DFB\u52A0\u521D\u503C\u3002\u53EA\u5199\u5B9E\u4F8B\u8BA1\u6570\u4F1A\u88AB\u62D2\u7EDD\u3002\u65A9\u6740\u6280\u80FD\u5148 execute\uFF0C\u6210\u529F\u540E\u5728\u540C\u94FE\u5BF9 self \u4F7F\u7528 produceResource(targetTierBase)\uFF0C\u8BE5\u6570\u503C\u6309\u76EE\u6807\u9636\u7EA7\u8BA1\u7B97\u3002\u81EA\u7528\u6280\u80FD\u8BBE target=self\u3001range=0\uFF0C\u901A\u8FC7\u6A21\u677F resourceCost \u6263\u88C5\u5907\u8D44\u6E90\uFF0C\u6062\u590D\u5404\u9879\u7528 restoreResource \u7684 percentPerCost\u3002\u88C5\u5907\u6210\u957F\u53EF\u5206\u522B\u653E\u4E94\u4E2A\u57FA\u7840\u5C5E\u6027\u8282\u70B9\uFF0C\u6216\u5BF9\u4F24\u5BB3\u7528 modifyStat(stat=damage)\uFF0C\u7528 percent=1 \u4E0E levelScaling:{min,max} \u8868\u793A\u6210\u957F\u6BD4\u4F8B\u8303\u56F4\u3002\u68C0\u5B9A\u52A0\u503C\u7528 modifyCheck\uFF0C\u7BAD\u77E2\u4E0E\u4E00\u822C\u8FDC\u7A0B\u5206\u522B\u7528 arrow=true \u4E0E melee=false\u3002
\u72B6\u6001\uFF1AgrantStatus \u4F7F\u7528\u5DF2\u6709 ID\uFF0C\u82E5\u9700\u81EA\u5B9A\u4E49\u5148\u5B9A\u4E49 statusTemplates\u3002modifiers \u53EA\u53EF\u8986\u76D6\u6A21\u677F\u5DF2\u6709\u952E\u3002amount \u4EC5\u7528\u4E8E\u6A21\u677F\u58F0\u660E\u4E86 modifiers.amount \u7684\u72B6\u6001\uFF0C\u8303\u56F4 1\u202610000\u3002removeStatus \u5FC5\u987B\u9009 statusId \u6216 category \u4E4B\u4E00\uFF0Call_negative \u6E05\u9664\u975E\u6C38\u4E45 debuff/dot/control\u3002procEffect \u901A\u8FC7 ref \u67E5\u627E\u5DF2\u5B9A\u4E49\u8868\u8FBE\u5F0F\u5E76\u6267\u884C\uFF0C\u5176\u81EA\u8EAB\u95E8\u69DB\u4ECD\u6709\u6548\uFF0C\u7981\u6B62\u5FAA\u73AF\u5F15\u7528\u3002addItem \u6309\u7269\u54C1 ID \u589E\u52A0\u5355\u4F4D\u5E93\u5B58\u3002`;

  // src/tavern/engine-summary.js
  var PROTOCOL_RULES = `\u3010\u5224\u5B9A\uFF5Cprotocol \u5B9E\u6218\u3011
\u884C\u52A8\u89C4\u5219\u56FA\u5B9A\u4E3A\u6BCF\u56DE\u5408 1 \u52A8\u4F5C\u69FD + 1 \u653B\u51FB\u69FD\uFF1B2 AP \u884C\u52A8\u540C\u65F6\u7528\u4E24\u69FD\u3002\u796D\u575B\u76F8\u90BB\u6FC0\u6D3B\u8017\u52A8\u4F5C\u69FD\uFF1B\u7206\u6876\u5728\u6B66\u5668\u5C04\u7A0B\u53CA\u89C6\u7EBF\u5185\u5F15\u7206\u8017\u653B\u51FB\u69FD\uFF0C\u7206\u70B8\u53EF\u4F24\u53CA\u53CB\u65B9\u3002
\u5148\u653B\uFF1Dagi\xD7(1+initiativePercent)+d20+max(0,...attackInit)+max(0,...actionInit)+flatInitiative\uFF1B\u603B\u5206\u964D\u5E8F\uFF0C\u540C\u5206\u5148\u6BD4\u654F\u6377\uFF0C\u518D\u6309 ID \u5347\u5E8F\u3002
\u666E\u901A\u653B\u51FB\u6309\u6240\u53D6 d20+accuracy \u5206\u6863\uFF08\u4E0B\u9650\u542B\u7B49\u53F7\uFF09\uFF1A<4 \u5931\u624B\xD70\uFF0C4 \u64E6\u4F24\xD70.3\uFF0C8 \u52C9\u5F3A\xD70.8\uFF0C11 \u6709\u6548\xD71\uFF0C20 \u5E73\u66B4\u51FB\xD71.3\uFF0C25 \u5F3A\u66B4\u51FB\xD71.6\uFF0C30 \u8D85\u66B4\u51FB\xD72\u3002\u81EA\u71361\u5FC5\u5931\uFF1B\u81EA\u713620\u6807\u8BB0 critical\uFF0C\u4F46\u4ECD\u987B\u603B\u5206\u22654\u3002\u5B9E\u6218\u4E0D\u4EE5\u9884\u89C8 defense \u4E3A\u547D\u4E2D\u95E8\u69DB\uFF1Battack \u662F\u4F24\u5BB3\uFF0C\u4E0D\u662F accuracy\u3002\u65E0\u9ED8\u8BA4\u529B/\u654F\u547D\u4E2D\u6216\u654F\u6377\u9632\u5FA1\u3002\u901A\u5E38\u51C0\u4F18\u52BF/\u52A3\u52BF\u63B72\u53D6\u9AD8/\u4F4E\uFF1B\u534F\u8BAE\u5956\u52B1\u9AB00~2\u3001\u60E9\u7F5A\u9AB00~1\uFF0C\u76F8\u7B49\u53D61\u9AB0\uFF0C\u5956\u52B1\u5360\u4F18\u4E14\u67092\u5956\u52B1\u53D63\u9AB0\u4E2D\u4F4D\u3002
\u5C04\u7A0B\u53D6\u4E09\u7EF4\u6B27\u6C0F\u8DDD\u79BB\uFF1B\u547D\u4E2D\u8BA1\u4F53\u578B\u3001\u9AD8\u5DEE\u3001\u8DDD\u79BB\u3001\u5C04\u7A0B\u3001\u72B6\u6001\u3001\u5939\u51FB\u3001\u63A9\u4F53\u3002\u4F53\u578B\u547D\u4E2D\u52A0\u503C\uFF1D\u76EE\u6807\u57FA\u7840\u9879\uFF0B\u653B\u5B88\u6863\u5DEE\uFF0C\u5408\u8BA1\u53EA\u52A0\u4E00\u6B21\uFF1B\u6253\u63A9\u4F53\u4E3A0\u3002\u57FA\u7840\u9879=max(0,\u76EE\u6807size\u22121)\uFF08\u65E7\u5B57\u7B26\u4E32large\u4E3A+2\u3001small\u4E3A\u22121\uFF0C\u5176\u4F590\uFF09\u3002\u6309\u4F53\u957F\u4F9D\u6B21\u5206\u5FAE/\u5C0F/\u4E2D/\u5927/\u5DE8/\u8D85\u5DE8\uFF0C\u5206\u754C\u4E3A0.6/1.3/2.6/5.5/10\u7C73\uFF08\u7B49\u4E8E\u5206\u754C\u8FDB\u4E0B\u4E00\u6863\uFF09\uFF0C\u6863\u503C\u4F9D\u6B21\u4E3A2/1/0/\u22121/\u22122/\u22124\u3002\u76EE\u6807MC<2\u65F6\u6863\u5DEE=\u653B\u51FB\u8005\u6863\u503C\u2212\u76EE\u6807\u6863\u503C\uFF1B\u76EE\u6807MC\u22652\u65F6\u6539\u7528\u653B\u51FB\u8005\u6863\u503C\uFF0B2\xD7(\u76EE\u6807MC\u22121)\u3002

\u3010\u610F\u56FE\uFF5C\u96BE\u5EA6/\u6210\u529F\u500D\u7387\u3011normal \u5E38\u89C40/1\uFF0Cfunction \u673A\u80FD\u9650\u52365/1.1\uFF0Ccore \u6838\u5FC3\u8981\u5BB310/1.4\uFF0Ckill \u62B9\u674015/1.7\uFF0Cconcept \u6982\u5FF5\u7834\u788E20/2\u3002\u8303\u56F4\u653B\u51FB\u5BF9\u5355\u4F4D\u56FA\u5B9A\u5E38\u89C4\u3002\u547D\u4E2D\u540E\uFF0C\u96BE\u5EA6\u53D6max(0,\u57FA\u7840+\u5B88\u65B9intentDifficulty)\uFF0C\u4E3A0\u76F4\u63A5\u6210\u7ACB\uFF1B\u5426\u5219\u653B\u6BD4\u5B88\u4F4E\u22652\u7EA7\u5FC5\u8D25\u3002\u653B\u9636\xD75+\u539F\u653B\u51FB\u9AB0+\u8BC4\u7EA7\u5956\uFF08\u5E73/\u5F3A/\u8D85\u66B4\u51FB+10/20/30\uFF09\u2265\u5B88\u9636\xD75+\u5B88d20+\u96BE\u5EA6\u624D\u6210\u7ACB\uFF1B\u5931\u8D25\u4FDD\u7559\u539F\u547D\u4E2D\uFF0C\u610F\u56FE\u500D\u7387\u56DE\u52301\u3002\u81EA\u52A8\u547D\u4E2D\u53CA\u8C41\u514D\u5206\u652F\u4E0D\u4F5C\u8BE5\u5BF9\u6297\u3002

\u3010\u4F24\u5BB3\uFF5C\u8BA1\u7B97\u51FD\u6570\u4E0E\u5B9E\u6218\u4E0D\u53EF\u6DF7\u7528\u3011
\u534F\u8BAE\u8D77\u4F24\uFF1D\u5173\u8054\u5C5E\u6027\uFF08damage.stat\uFF0C\u7F3A\u7701\u8FD1\u6218str\u3001\u5426\u5219int\uFF09\xD710\xD7\u5C42\u7EA7\u7CFB\u6570(1~7\u9636:2/2.8/4/8/15/35/80)+power(\u9ED8\u8BA420)+\u6B66\u5668attack(\u9ED8\u8BA40)\u3002\u5B9E\u6218\u4E3B\u51FB\u4E58\u653B\u51FB\u589E\u76CA\u3001\u4F53\u578B\u500D\u7387\uFF08\u6B64\u5904\u4E0D\u9650\u8FD1\u6218\uFF09\u3001\u8BC4\u7EA7\u3001\u6210\u529F\u610F\u56FE\u3001\u59FF\u6001/\u526F\u624B\u7CFB\u6570\u3001\u8C41\u514D\u6210\u529F\xD70.5\uFF0C\u518D\u5411\u4E0B\u53D6\u6574\u3002\u8C41\u514D\u4E3A\u5B88d20+\u6307\u5B9A\u5C5E\u6027\u2265saveDC\uFF08\u9ED8\u8BA412+floor(\u653Bint/2)\uFF09\uFF0C\u6210\u529F\u514D\u9664\u8BE5\u6B21\u9644\u5E26\u6548\u679C\u3002
\u5C5E\u6027\u51CF\u4F24\uFF1Aphysical=(con+str+agi)\xD7.0025\uFF0Cenergy=(spi+int)\xD7.004\uFF0Cmental=spi\xD7.008\uFF0Ctrue=0\u3002
\u5B9E\u6218\u547D\u4E2D\u8D70\u53E6\u4E00\u7BA1\u7EBF\uFF1A\u53EF\u63F4\u62A4\u66FF\u4F24\u3001\u8FD1\u6218\u91CD\u5251\u5F39\u53CD\uFF1B\u6709\u6548\u7532=max(0,\u603B\u7532\xD7(1\u2212\u767E\u5206\u6BD4\u7A7F\u900F)\u2212\u56FA\u5B9A\u7A7F\u900F)\uFF0C\u7269\u7406\u5168\u7532\u3001\u80FD\u91CF\u534A\u7532\u3001\u5176\u4F590\u3002\u4E58(1+\u788E\u51B0\u52A0\u6210)(1+\u6613\u4F24)(1\u2212\u72B6\u6001\u603B\u51CF\u4F24[0,1])\u3001\u62A4\u7532\u500D\u7387\u548C(1\u2212\u5C5E\u6027\u51CF\u4F24)\uFF0C\u5411\u4E0B\u53D6\u6574\u4E14\u4E0D\u4F4E\u4E8E0\uFF1B\u62A4\u76FE\u5148\u5438\u6536\uFF0C\u4F59\u91CF\u6263HP\u3002\u6301\u7EED\u4F24\u7B49\u975E\u547D\u4E2D\u7C7B\u4F24\u5BB3\u6309\u500D\u7387\u53D6\u6574\u51CF\u6709\u6548\u7532\u3002DSL \u56FA\u5B9A\u51CF\u4F24\u5148\u4E8E\u62A4\u76FE\uFF1BnonLethal \u4FDD\u5E95 1 HP\u3002
\u8303\u56F4\u6280\u80FD\u6309\u8986\u76D6\u683C\u9010\u76EE\u6807\u7ED3\u7B97\u3002

\u3010\u59FF\u6001\u3011\u76FE\u2192\u5251\u76FE\uFF1B\u6D88\u8017/\u8F85\u52A9\u526F\u624B\u2192\u540C\u8C03\uFF1B\u91CD\u578B/\u53CC\u624B\u4E3B\u624B\u2192\u91CD\u5251\uFF1B\u5176\u4ED6\u526F\u624B\u2192\u53CC\u6301\uFF1B\u4EC5\u4E3B\u624B\u2192\u8F7B\u5251\uFF1B\u7A7A\u624B\u2192\u65E0\u68B0\u3002\u59FF\u6001\u51B3\u5B9A\u7A7F\u7532\u3001\u8FFD\u51FB\u3001\u5F39\u53CD\u548C\u683C\u6321\u3002

\u3010\u58EB\u6C14\u4E0E\u9003\u8DD1\u3011\u5207\u78CB\u65E0\u6761\u4EF6\u975E\u81F4\u6B7B\uFF0C\u4EFB\u4F55\u5355\u4F4D HP \u4F4E\u4E8E 30% \u7ACB\u5373\u5207\u78CB\u9000\u573A\uFF0C\u4E0D\u7B97\u9003\u8DD1\u6216\u51FB\u6740\u3002\u7ADE\u6280\u53CC\u65B9\u975E\u81F4\u6B7B\uFF0C1 HP \u843D\u8D25\u51FA\u5C40\u3002\u538B\u5236\u6218\u53CC\u65B9\u666E\u901A\u653B\u51FB\u4ECD\u53EF\u81F4\u6B7B\uFF0C\u53EA\u6709\u538B\u5236\u65B9\u53EF\u7528\u65E0\u4F24\u5BB3\u76841\u683C\u538B\u5236\u653B\u51FB\uFF1A\u547D\u4E2D\u540E\u4EE5d20+\u529B\u91CF\u5BF9\u6297\uFF0C\u653B\u65B9\u80DC\u4F7F\u5BF9\u624B\u88AB\u538B\u5236\uFF0C\u5B88\u65B9\u80DC\u5219\u653B\u65B9\u7729\u66551\u56DE\u5408\uFF0C\u5E73\u624B\u65E0\u72B6\u6001\uFF1B\u88AB\u538B\u5236\u8005\u56DE\u5408\u5F00\u59CB\u65F6d20+floor(\u529B\u91CF\xD7\u5F53\u524DHP\u6BD4\u4F8B)\u5927\u4E8E\u539F\u653B\u65B9\u603B\u70B9\u6570\u624D\u6323\u8131\uFF1B\u672A\u88AB\u538B\u5236\u7684\u62B5\u6297\u65B9\u961F\u53CB\u53EF\u57281\u683C\u5185\u7528\u653B\u51FB\u69FD\u76F4\u63A5\u89E3\u9664\u538B\u5236\u3002\u573A\u4E0A\u62B5\u6297\u65B9\u5168\u90E8\u88AB\u538B\u5236\u5373\u80DC\uFF0C\u5168\u90E8\u6B7B\u4EA1\u5219\u538B\u5236\u5931\u8D25\u3002\u6362\u8F6E\u68C0\u67E5\u975E\u4E3B\u89D2\u6218\u610F\u3002\u5207\u78CB40%\u3001\u7ADE\u628030%\u3001\u538B\u523650%\u4EE5\u4E0B\u81EA\u52A8\u52A8\u6447\uFF08\u547D\u4E2D\u22122\uFF09\uFF1B\u6807\u51C630%\u3001\u5B88\u536B35%\u3001\u6B7B\u659710%\u4EE5\u4E0B d20<12 \u6E83\u9003\uFF08\u547D\u4E2D\u22124\uFF0CAI \u5C1D\u8BD5\u9003\u8DD1\uFF09\uFF0C\u5426\u5219\u575A\u5B88\u3002\u56DE\u8840\u8FBE\u9608\u503C\u540E\u4E0B\u8F6E\u6062\u590D\u3002\u5BF9\u52A8\u6447\u6216\u6E83\u9003\u8005\u7528\u62B9\u6740/\u6982\u5FF5\u7834\u788E\uFF0C\u5FFD\u7565\u95EA\u907F\uFF0C\u547D\u4E2D\u8BC4\u7EA7\u81F3\u5C11\u5E73\u66B4\u51FB\uFF0C\u4E0D\u4FDD\u8BC1\u547D\u4E2D\u3002\u6240\u6709\u6218\u6597\u5747\u987B\u7AD9\u5728\u5730\u56FE\u6700\u5916\u5708\u624D\u80FD\u5C1D\u8BD5\u9003\u8DD1\u3002\u4E3B\u52A8flee\u4EE5\u81EA\u8EAB\u654F+d20\u5BF9\u5B58\u6D3B\u654C\u65B9\u6700\u9AD8\u654F+d20\uFF0C\u5E73\u624B\u53EF\u9003\u3002`;
  var ENGINE_API_SUMMARY = `${PROTOCOL_RULES}

\u3010API \u6620\u5C04\u3011
\u72B6\u6001\u5148\u67E5\u6218\u5C40 statusTemplates\uFF0C\u518D\u67E5\u9ED8\u8BA4\u6A21\u677F\uFF1B\u62D2\u7EDD\u672A\u77E5 ID\u3002\u81EA\u5B9A\u4E49\u72B6\u6001\u4F7F\u7528\u540C\u4E00\u5957\u4FEE\u9970\u952E\uFF0C\u89C1\u4E0B\u65B9\u72B6\u6001\u76EE\u5F55\u3002
\u6280\u80FD saveDC\u3001DSL roll.dc \u548C roll.contest.dc \u4F7F\u7528\u540C\u4E00\u89C4\u5219\u3002\u53EF\u4F20 1\u202650 \u7684\u6574\u6570\uFF0C\u6216 {base:6,scaleBy:{stat:'spi',perUnit:0.5},min:1,max:50}\u3002stat \u53EA\u80FD\u4E3A str/con/agi/int/spi\u3002base \u4E0E perUnit \u53EF\u4E3A\u5C0F\u6570\u6216\u8D1F\u6570\uFF0C\u8303\u56F4 \u22121e9\u20261e9\u3002\u8BA1\u7B97\u4E3A base + perUnit \xD7 \u65BD\u672F\u8005\u5F53\u524D\u751F\u6548\u5C5E\u6027\uFF0C\u4FDD\u7559\u5C0F\u6570\u5E76 clamp \u5230 min/max\uFF0C\u7F3A\u7701 1/50\u3002\u663E\u5F0F\u4E0A\u4E0B\u9650\u4E3A 1\u20261e9 \u7684\u6570\u503C\uFF0Cmin \u4E0D\u5F97\u9AD8\u4E8E max\u3002
\u88C5\u5907\u6A21\u677F equipment \u4E0E\u5B9E\u4F8B items \u7528 templateId \u5173\u8054\uFF1B\u8BA1\u6570\u5728\u5B9E\u4F8B counters\u3002

\u88C5\u5907\u4E0E\u6280\u80FD\u7EDF\u4E00\u4F7F\u7528\u6548\u679C DSL\u3002\u5916\u5C42\u58F0\u660E\u89E6\u53D1\u3001\u6761\u4EF6\u3001\u68C0\u5B9A\u3001\u76EE\u6807\u4E0E\u8282\u70B9\u5217\u8868\u3002\u5B9E\u4F8B\u8BA1\u6570\u7531\u88C5\u5907\u7684\u8D44\u6E90\u58F0\u660E\u51B3\u5B9A\u3002\u5B8C\u6574 DSL \u534F\u8BAE\u89C1\u4E0B\u8282\u3002
\u4E00\u56DE\u5408 battle_turns \u6A21\u677F\u53EF\u52A0 expireInto \u6307\u5DF2\u5B9A\u4E49\u72B6\u6001\uFF0C\u81EA\u5DF1\u65BD\u52A0\u65F6\u672C\u56DE\u5408\u672B\u5230\u671F\uFF0C\u6218\u6597\u672A\u7ED3\u675F\u624D\u7EED\u63A5\u3002\u5148\u5B9A\u4E49\u7EED\u63A5\u72B6\u6001\uFF0C\u518D\u5B9A\u4E49\u524D\u7F6E\u72B6\u6001\u3002

\u3010\u72B6\u6001\u6570\u503C\u8986\u76D6\u3011
\u6A21\u677F\u6570\u503C\u662F\u9ED8\u8BA4\u503C\u3002grantStatus \u8282\u70B9\u53EF\u7528 modifiers \u8986\u76D6\u6A21\u677F\u5DF2\u6709\u952E\uFF0C\u6309\u72B6\u6001\u76EE\u5F55\u8303\u56F4\u6821\u9A8C\u3002DoT/HoT \u6BCF\u6B21\u7ED3\u7B97\u53D6\u5B9E\u4F8B\u503C\u4E58\u5C42\u6570\u3002
\u516C\u5F00 API\uFF1AdefineStatus(state,id,template) \u6CE8\u518C\u6218\u5C40\u6A21\u677F\uFF0C\u53EF\u8986\u76D6\u540C\u540D\u9ED8\u8BA4\u6A21\u677F\uFF0C\u4F46\u4E0D\u80FD\u91CD\u590D\u6CE8\u518C\u6218\u5C40\u5DF2\u6709\u5B9A\u4E49\u3002patchStatus(state,unitId,statusId,{damage:12}) \u66F4\u65B0\u5DF2\u9644\u52A0\u5B9E\u4F8B\u5E76\u5199\u5165\u65E5\u5FD7\u3002statusModifierKeys(statusId,state?) \u67E5\u8BE2\u5408\u6CD5\u952E\u3002GameAPI \u5BF9\u5E94\u7684\u65E0 state \u65B9\u6CD5\u652F\u6301\u8FD0\u884C\u4E2D\u7684\u6218\u5C40\u3002
damageType \u968F damage\uFF1B\u53D7\u51FB\u788E\u88C2\u7528 shatter \u914D\u5408 expireOn:on_struck\uFF08\u89C4\u5219\u5199\u4E3A {trigger:'on_struck'}\uFF09\u3002`;

  // src/tavern/status-catalog.js
  var rows = Object.values(STATUSES).map((status2) => {
    const modifiers3 = Object.entries(status2.modifiers).map(([key4, value]) => `${key4}=${value}\uFF08${statusModifierRange(key4, status2)}\uFF09`).join("\uFF0C");
    const expiry = [].concat(status2.expireOn ?? []).map((rule) => rule.trigger).join("/");
    return [
      status2.id,
      `${status2.icon}${status2.name}`,
      status2.category,
      status2.remainingTurns,
      status2.tickTiming,
      `${status2.stackRule}/${status2.maxStacks}`,
      modifiers3,
      expiry || "\u2014",
      status2.description
    ].join(" | ");
  });
  var STATUS_CATALOG = [
    "\u9ED8\u8BA4\u72B6\u6001\u6A21\u677F\uFF1A\u6218\u5C40 statusTemplates \u4F18\u5148\uFF0C\u65E0\u540C\u540D\u5B9A\u4E49\u65F6\u4F7F\u7528\u4EE5\u4E0B\u6A21\u677F\u3002\u672A\u77E5 ID \u5FC5\u987B\u5148\u6CE8\u518C\u3002",
    "ID | \u540D\u79F0 | \u7C7B\u522B | \u9ED8\u8BA4\u56DE\u5408\u6570 | \u5468\u671F\u65F6\u70B9 | \u53E0\u5C42\u89C4\u5219/\u4E0A\u9650 | \u9ED8\u8BA4\u4FEE\u9970\u952E | \u63D0\u524D\u89E3\u9664\u4E8B\u4EF6 | \u8BF4\u660E",
    ...rows,
    `\u6240\u6709\u6A21\u677F\u5171\u7528\u7684\u5408\u6CD5\u4FEE\u9970\u952E\uFF1A${modifierKeys.map((key4) => `${key4}\uFF08${statusModifierRange(key4)}\uFF09`).join("\u3001")}\u3002\u62A4\u7532\u5B9E\u4F8B\u8986\u76D6\u4FDD\u6301\u6A21\u677F\u7684\u6B63\u8D1F\u65B9\u5411\u3002`,
    "\u6388\u4E88\u548C patchStatus \u53EA\u8986\u76D6\u6A21\u677F\u5DF2\u58F0\u660E\u7684\u4FEE\u9970\u952E\u3002\u58F0\u660E modifiers.amount \u5373\u62E5\u6709\u62A4\u76FE\u6C60\uFF08\u4E0E\u7C7B\u522B\u65E0\u5173\uFF09\uFF1B\u5B9E\u4F8B amount \u662F\u5269\u4F59\u91CF\u3002\u591A\u6C60\u6309\u72B6\u6001 ID \u987A\u5E8F\u6263\u51CF\u3002taunted \u9700\u8981\u654C\u5BF9\u6765\u6E90\u3002",
    "\u6A21\u677F\u7C7B\u522B\uFF1Abuff/debuff/control/dot/hot/shield\u3002\u6301\u7EED\u7C7B\u578B\uFF1Abattle_turns\uFF08\u81EA\u8EAB\u56DE\u5408\u672B\u9012\u51CF\uFF09/until_removed/persistent\uFF1B\u540E\u4E24\u8005\u4E0D\u9012\u51CF\u3002"
  ].join("\n");

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
\u2022 \u65E7\u6863\u300C\u6548\u679C\uFF1A100%\u7269\u7406\u4F24\u5BB3\u300D\u914D\u5408\u5A01\u529B\u6807\u7B7E\uFF0C\u4F7F\u7528 damage \u8282\u70B9 percentOfPower:1\u3001damageType:"physical"\u3002\u6BD4\u4F8B\u6DF7\u5408\u4F24\u5BB3\u6BCF\u79CD\u7C7B\u578B\u7528\u72EC\u7ACB\u8282\u70B9\uFF0C\u4F8B\u5982 60%\u7269\u7406\u4F24\u5BB3/40%\u80FD\u91CF\u4F24\u5BB3\u5199 0.6 \u4E0E 0.4\u3002
\u2022 \u6DF7\u5408\u4F24\u5BB3\uFF1A[\u5A01\u529B: 60][\u4F24\u5BB3: \u7269\u740640/\u80FD\u91CF20] \u4E2D\u5404\u5206\u91CF\u4E4B\u548C\u7B49\u4E8E\u5A01\u529B\u3002\u5FC5\u987B\u62C6\u6210\u591A\u4E2A damage \u8282\u70B9\uFF0C\u6BCF\u4E2A\u8282\u70B9\u53EA\u5199\u4E00\u4E2A damageType \u548C\u5BF9\u5E94\u6570\u503C\uFF0C\u4E0D\u5F97\u5728\u5355\u8282\u70B9\u91CC\u585E\u591A\u4E2A\u7C7B\u578B\u3002\u4F8B\uFF1A[{"kind":"damage","flat":40,"damageType":"physical"},{"kind":"damage","flat":20,"damageType":"energy"}]\u3002\u4E0D\u5F97\u518D\u53E0\u52A0\u4E00\u6B21\u603B\u5A01\u529B\u3002
\u2022 [\u5173\u8054\u5C5E\u6027: \u654F\u6377] \u2192 \u6280\u80FD\u7684\u5173\u8054\u68C0\u5B9A\u5C5E\u6027\u4E3A agi\uFF1B\u4E0D\u8981\u628A\u65BD\u672F\u8005\u7684\u5173\u8054\u5C5E\u6027\u8BEF\u4F5C\u76EE\u6807\u7684\u8C41\u514D\u5C5E\u6027\u3002[\u6709\u6548\u8DDD\u79BB: \u4E2D\u7A0B(5)] \u2192 range:5\u3002
\u2022 [\u5355\u4F53] \u2192 shape:single\uFF0Ctarget \u4F9D\u63CF\u8FF0\u9009\u53D6\uFF1B[\u8303\u56F4: \u4E2D\u7A0B(4)+\u6247(\u654C\u65B9)] \u2192 range:4\u3001shape:fan\u3001target:enemy\uFF0Cradius \u6309\u5B9E\u9645\u8986\u76D6\u534A\u5F84\u586B\u5199\uFF0C\u4E0D\u628A\u5C04\u7A0B\u5F53\u534A\u5F84\u3002
\u2022 \u7A7A\u6548\u679C\uFF1A\u76EE\u6807\u5BF9\u8C61\u7684\u6548\u679C\u5B57\u6BB5\u4E3A {} \u6216\u7F3A\u5931\u65F6\uFF0C\u8868\u793A\u8BE5\u5B57\u6BB5\u6CA1\u6709\u53EF\u6267\u884C\u6548\u679C\uFF0C\u4E0D\u4EA7\u751F\u4EFB\u4F55\u8865\u4E01\u64CD\u4F5C\uFF0C\u4E5F\u4E0D\u8BA1\u5165 unresolved\u3002\u7EAF\u4F4D\u79FB\u3001\u7EAF\u72B6\u6001\u6388\u4E88\u7B49\u6280\u80FD\u4ECD\u6709\u53EF\u6267\u884C\u8282\u70B9\uFF0C\u4E0D\u5C5E\u4E8E\u7A7A\u6548\u679C\u3002`;
  var diagnosisProtocol = "\u8BCA\u65AD\u5F52\u5C5E\uFF1A\u5728\u89E3\u51B3\u95EE\u9898\u7684 patch \u64CD\u4F5C\u4E0A\u586B\u5199 resolves \u6570\u7EC4\uFF0C\u6BCF\u9879\u590D\u5236\u8B66\u544A\u7684 {unitId, originPath, message}\uFF08\u65E0\u6765\u6E90\u8DEF\u5F84\u7528 null\uFF09\u3002\u65E7\u5F0F\u8BCA\u65AD\u5B57\u7B26\u4E32\u4EC5\u5728\u80FD\u552F\u4E00\u5339\u914D\u65F6\u6709\u6548\u3002\u8FD9\u4E9B\u5B57\u6BB5\u4E0D\u662F DSL \u8282\u70B9\u6216\u6218\u5C40\u5B57\u6BB5\u3002";
  var protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join("\n\n");
  var PATCH_RULES = String.raw`【输出】逐项对照本战局警告、快照和战斗协议。只输出一个 JSON 对象：{"patch":[],"unresolved":[]}。两个键都是数组。针对警告生成补丁时，在操作的 resolves 数组中复制已解决警告的 {unitId, originPath, message}。只声明本次已修复的诊断；未解决或仅部分解决的条目仍列在 unresolved 并保留原效果名。不要解释、注释、Markdown 代码块、JS 调用或 battle_patch 包装。

【patch：有序的 RFC 6902 操作】
add 新增、replace 替换现有值：{"op":"replace","path":"…","value":值}；remove 删除现有值：{"op":"remove","path":"…"}。只允许这三种 op。路径以一个 / 开头。白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/
• /equipment/<id>：装备模板（如 /equipment/mainHand_dagger_01）；不是持有的道具实例。
• /skills/<id>：技能模板（如 /skills/skill_frost_arrow）。backpackItem:true 是背包消耗品的使用模板，不是角色技能。若消耗品没写效果，按物品名、标签主动推定合理的目标、距离、范围和数值，补出可执行的 active DSL；不可仅因原文缺数值而列为 unresolved。按警告路径修改模板，不要改库存、移除 backpackItem 或加入单位 skills。保留 ap:1、slot:action。
• /items/<id>：道具实例（如 /items/item_01），不是模板属性。
• /statusTemplates/<id>：战局的自定义状态模板（如 /statusTemplates/status_custom_01），同名定义覆盖默认模板；已有实例须同时与新模板对齐。普通新增状态使用新 ID。
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
{"patch":[{"op":"replace","path":"/units/p1/armor","value":6,"resolves":[{"unitId":"p1","originPath":null,"message":"基础护甲缺失"}]}],"unresolved":[]}
【DSL 正例】先找事件、筛选条件及概率，再确定目标、节点字段与数值。下面每行是一条可放入 effects 的表达式，换成全局唯一 ID。
• 简单命中附状态：{"id":"hit_burn","label":"灼印","trigger":"on_hit","target":"hitTarget","effects":[{"kind":"grantStatus","statusId":"burn","turns":2}]}
• 条件加成：{"id":"night_edge","trigger":"passive","target":"self","condition":{"type":"timeOfDay","value":"night"},"effects":[{"kind":"multiplyDamage","factor":1.2}]}
• 概率反击：{"id":"cold_reply","trigger":"on_damaged","target":"attacker","condition":[{"type":"melee"},{"type":"enemy"}],"roll":{"dice":"d20","gte":16},"effects":[{"kind":"grantStatus","statusId":"chill"}]}
• 链式支付与回复：{"id":"blood_mana","trigger":"active","target":"self","effects":[{"kind":"chainEffect","stopOnFailure":true,"effects":[{"kind":"drainResource","resource":"hp","amount":12,"minimumRemaining":1,"requireFull":true},{"kind":"restoreResource","resource":"mp","percentOfPrevious":0.5}]}]}
• 叠加装备资源：{"id":"charge_pool","trigger":"passive","target":"self","effects":[{"kind":"produceResource","resource":"charge","cap":10000,"initial":0},{"kind":"multiplyDamage","resourceScale":{"resource":"charge","perUnit":0.02}}]}。同批在实例 counters 加入 charge:0，再写 on_kill/self 的 produceResource(amount:1) 增加存量。
• 捧腹失能：先添加 /statusTemplates/laugh_disabled，value 为 {"id":"laugh_disabled","name":"狂笑失能","icon":"😆","category":"control","description":"跳过行动，实际受到直接伤害时解除。","remainingTurns":1,"durationType":"battle_turns","tickTiming":"onTurnStart","stackRule":"refresh","maxStacks":1,"modifiers":{"skip":true},"expireOn":{"trigger":"on_damaged","damageType":"direct"}}。随后引用 {"id":"laugh_on_hit","trigger":"on_hit","target":"hitTarget","roll":{"save":"spi","dc":{"base":6,"scaleBy":{"stat":"spi","perUnit":0.5}}},"effects":[{"kind":"grantStatus","statusId":"laugh_disabled"}]}。
• 临时土墙（指定格周围半径 1，持续 3 回合）：技能模板 target 为 cell，effects 包含 {"id":"temporary_wall","trigger":"active","target":"self","effects":[{"kind":"setTerrainKind","terrainKind":"wall","area":{"center":"hitTarget","radius":1},"remainingTurns":3}]}。固定矩形则将 area 换为 {"rect":{"x1":3,"y1":4,"x2":5,"y2":6}}。
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
    const legacy = entries2.length > 0 && entries2.every((slot) => defaults.has(slot.id) && Object.keys(slot).every((key4) => key4 === "id" || key4 === "enabled"));
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
    const warnings = warningsForUnit(sources.warnings, ctx.onlyUnitIds);
    const variables = {
      battle_init: () => sources.battleRaw || json(sources.battleInit ?? {}),
      battle_state: () => json(state ?? {}),
      warnings: () => json(warnings.map(({ unitId, originPath = null, message }) => ({ unitId, originPath, message }))),
      user_instruction: () => instruction,
      standardized_roster: () => ctx.onlyUnitIds ? rosterText() : sources.roster || "",
      roster: rosterText,
      battle: battleText,
      mvu_data: () => json(sources.mvuData ?? {}),
      latest_floor: () => sources.latestFloor || ""
    };
    const expand = (template) => String(template).replace(/\{\{(\w+)\}\}/g, (_, key4) => Object.hasOwn(variables, key4) ? variables[key4]() : "");
    function rosterText() {
      if (ctx.onlyUnitIds && state) {
        const pick = (table4, ids) => Object.fromEntries([...new Set(ids)].filter((id3) => Object.hasOwn(table4 ?? {}, id3)).map((id3) => [id3, table4[id3]]));
        const units = pick(state.units, ctx.onlyUnitIds), rows2 = Object.values(units);
        const items = pick(state.items, rows2.flatMap((u) => [u.mainHand, u.weapon, u.offHand, u.shield, ...u.gear ?? [], ...u.bagWeapons ?? []]));
        return json({ raw: pick(ctx.rawCharacters, ctx.onlyUnitIds), units, items, equipment: pick(state.equipment, Object.values(items).map((i) => i.templateId)), skills: pick(state.skills, rows2.flatMap((u) => [...u.skills ?? [], ...Object.keys(u.inventory ?? {})])), statusTemplates: state.statusTemplates });
      }
      if (ctx.rosterText != null) return ctx.rosterText;
      if (!state) return sources.roster || "";
      const templates = new Set(Object.values(state.items ?? {}).map((item) => item.templateId));
      const skillIds = new Set(Object.values(state.units ?? {}).flatMap((unit) => [...unit.skills ?? [], ...Object.keys(unit.inventory ?? {})]));
      const used = (table4, ids) => Object.fromEntries(Object.entries(table4 ?? {}).filter(([id3]) => ids.has(id3)));
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
        return ctx.warningsText ?? (warnings.length ? `\u5F85\u5904\u7406\u8B66\u544A\uFF1A
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
  function lookup(host, localWin, key4) {
    for (const scope of [localWin, host, localWin?.parent, localWin?.top, globalThis]) {
      try {
        for (const owner of [scope, scope?.TavernHelper]) {
          const value = owner?.[key4];
          if (value != null) return typeof value === "function" ? value.bind(owner) : value;
        }
      } catch {
      }
    }
  }
  function bindTavernStreamEvents(host, localWin, genId, onStreamChunk) {
    const get3 = (key4) => lookup(host, localWin, key4);
    const on = get3("eventOn"), remove2 = get3("eventRemoveListener");
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
        get3("iframe_events")?.STREAM_TOKEN_RECEIVED_FULLY || "js_stream_token_received_fully",
        get3("tavern_events")?.STREAM_TOKEN_RECEIVED || "stream_token_received"
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
            remove2?.(name, handler);
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
  async function readSseStream(readableStream, extractDelta, onStreamChunk, trace = {}) {
    const reader = readableStream.getReader(), decoder = new TextDecoder();
    const start = Date.now();
    let buffer = "", content = "", args = "", heartbeatCount = 0;
    let jsonBody = null;
    function line(raw) {
      const s = raw.trim();
      if (trace.relay && (jsonBody !== null || !trace.events && s.startsWith("{"))) {
        jsonBody = (jsonBody ?? "") + raw + "\n";
        return false;
      }
      if (s.startsWith(":")) {
        onStreamChunk?.("", false, { isHeartbeat: true, heartbeatCount: ++heartbeatCount, elapsedSec: Math.floor((Date.now() - start) / 1e3) });
      } else if (s.startsWith("data:")) {
        const data = s.slice(5).trim();
        if (data === "[DONE]") {
          trace.done = true;
          return true;
        }
        if (!data) return false;
        const event = JSON.parse(data);
        trace.events = (trace.events || 0) + 1;
        if (event.error) throw new Error(diagnoseApiError(event.error.message));
        const d = extractDelta(event) || {};
        const c = typeof d === "string" ? d : d.contentDelta;
        if (c || d.toolArgsDelta) {
          content += c || "";
          args += d.toolArgsDelta || "";
          onStreamChunk?.(content || args, false);
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
      if (jsonBody !== null) {
        const event = JSON.parse(jsonBody);
        if (event.error) throw new Error(diagnoseApiError(event.error.message));
        trace.json = true;
        const d = extractDelta(event);
        return d.contentDelta || d.toolArgsDelta || "";
      }
      return content || args;
    } finally {
      if (!ended) reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
  function connection(settings, needModel) {
    const base = settings.baseUrl?.trim().replace(/\/+$/, ""), key4 = settings.apiKey?.trim(), model = settings.model?.trim();
    if (!base || !key4 || needModel && !model) throw new Error(`\u8BF7\u5728 API \u8BBE\u7F6E\u4E2D\u586B\u5199${!base ? "\u63A5\u53E3\u5730\u5740\uFF08baseUrl\uFF09" : !key4 ? "\u5BC6\u94A5\uFF08apiKey\uFF09" : "\u6A21\u578B\uFF08model\uFF09"}`);
    if (settings.apiTransport !== "tavern" && globalThis.location?.protocol === "https:" && /^http:/i.test(base)) {
      throw new Error(diagnoseApiError("Mixed Content"));
    }
    const source = settings.apiTransport === "tavern" ? "openai" : settings.apiSource || "openai";
    const headers = { "Content-Type": "application/json" };
    let root;
    if (source === "gemini") root = base.replace(/\/v1beta(?:\/.*)?$/i, "") + "/v1beta";
    else if (source === "claude") {
      root = base.replace(/\/messages$/i, "").replace(/\/v1$/i, "") + "/v1";
      Object.assign(headers, { "x-api-key": key4, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    } else if (source === "openai") {
      root = base.replace(/\/chat\/completions$/i, "");
      headers.Authorization = `Bearer ${key4}`;
    } else throw new Error(`\u672A\u77E5 API \u7C7B\u578B\uFF1A${source}`);
    return { root, source, headers, model, key: encodeURIComponent(key4) };
  }
  async function send(url, init, { fetchImpl = globalThis.fetch, signal }) {
    const res = await fetchImpl(url, { ...init, signal });
    if (!res.ok) throw new Error(diagnoseApiError(await res.text(), res.status));
    return res;
  }
  var json2 = (res) => res.json ? res.json() : res.text().then(JSON.parse);
  async function sendViaTavernBackend(endpoint, { root, headers }, body, options) {
    const host = options.host ?? globalThis.window;
    const origin = host?.location?.origin;
    if (!origin || !/^https?:\/\//.test(origin)) throw new Error("\u8BF7\u5728\u9152\u9986\u9875\u9762\u5185\u4F7F\u7528\u540E\u7AEF\u8F6C\u53D1");
    let upstream;
    try {
      upstream = new URL(root);
    } catch {
      throw new Error("\u8BF7\u586B\u5199\u5B8C\u6574\u7684 API \u5730\u5740");
    }
    if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) {
      throw new Error("API \u5730\u5740\u5E94\u4E3A\u4E0D\u542B\u767B\u5F55\u4FE1\u606F\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u7247\u6BB5\u7684 HTTP(S) \u5730\u5740");
    }
    const transport = { ...options, fetchImpl: options.fetchImpl ?? host.fetch.bind(host) };
    const sameOrigin = { credentials: "same-origin", mode: "same-origin", redirect: "error" };
    const tokenReply = await send(`${origin}/csrf-token`, sameOrigin, transport);
    const { token } = await json2(tokenReply);
    if (typeof token !== "string" || !token) throw new Error("\u9152\u9986\u672A\u8FD4\u56DE CSRF \u4EE4\u724C\uFF0C\u8BF7\u5237\u65B0\u9152\u9986\u9875\u9762");
    return send(`${origin}/api/backends/chat-completions/${endpoint}`, {
      ...sameOrigin,
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({
        ...body,
        chat_completion_source: "custom",
        custom_url: root,
        // SillyTavern parses this field as YAML, which also accepts JSON objects.
        custom_include_headers: JSON.stringify({ Authorization: headers.Authorization })
      })
    }, transport);
  }
  async function fetchModels(settings, options = {}) {
    const conn = connection(settings, false);
    const { root, source, key: key4, headers } = conn;
    const viaTavern = settings.apiTransport === "tavern";
    const res = viaTavern ? await sendViaTavernBackend("status", conn, {}, options) : await send(`${root}/models${source === "gemini" ? `?key=${key4}` : ""}`, { method: "GET", headers }, options);
    const data = await json2(res);
    if (viaTavern && data.error) throw new Error("\u9152\u9986\u540E\u7AEF\u62C9\u53D6\u6A21\u578B\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 API \u5730\u5740\u3001\u5BC6\u94A5\u548C\u9152\u9986\u540E\u7AEF\u7F51\u7EDC");
    return (source === "gemini" ? data.models : data.data)?.map((m) => source === "gemini" ? m.name?.replace(/^models\//, "") : m.id).filter((id3) => typeof id3 === "string" && id3) || [];
  }
  function deltas(source, event) {
    if (source === "gemini") {
      const parts = event.candidates?.[0]?.content?.parts || [];
      return { contentDelta: parts.filter((p) => !p.thought).map((p) => p.text).join("") };
    }
    if (source === "claude") {
      const d2 = event.delta || event.content_block || {};
      return { contentDelta: d2.text, toolArgsDelta: d2.partial_json };
    }
    const choice = event.choices?.[0];
    const d = choice?.delta || choice?.message || {};
    return { contentDelta: d.content, toolArgsDelta: d.tool_calls?.map((t) => t.function?.arguments).join("") || d.function_call?.arguments };
  }
  async function requestViaCustomApi(settings, messages, options = {}) {
    const conn = connection(settings, true);
    const { root, source, model, key: key4, headers } = conn;
    const stream = settings.stream ?? true, temperature = Number(settings.temperature ?? 0.8), max_tokens = Number(settings.max_tokens || 2400);
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
        url = `${root}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:${stream ? "streamGenerateContent?alt=sse&" : "generateContent?"}key=${key4}`;
        body = {
          ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
          contents: chat.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { temperature, maxOutputTokens: max_tokens },
          safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT", "CIVIC_INTEGRITY"].map((name) => ({ category: `HARM_CATEGORY_${name}`, threshold: "BLOCK_NONE" }))
        };
      }
    }
    const res = settings.apiTransport === "tavern" ? await sendViaTavernBackend("generate", conn, body, options) : await send(url, { method: "POST", headers, body: JSON.stringify(body) }, options);
    let text4;
    const trace = { relay: settings.apiTransport === "tavern", reasoning: 0 };
    const extract = (event) => {
      const choice = event.choices?.[0];
      const reasoning = (choice?.delta || choice?.message)?.reasoning_content;
      if (typeof reasoning === "string") trace.reasoning += reasoning.length;
      if (choice?.finish_reason) trace.finish = choice.finish_reason;
      return deltas(source, event);
    };
    if (stream && res.body?.getReader && (trace.relay || !/application\/json/i.test(res.headers?.get?.("content-type") || ""))) {
      text4 = await readSseStream(res.body, extract, options.onStreamChunk, trace);
    } else {
      const data = await json2(res);
      if (data.error) throw new Error(diagnoseApiError(data.error.message || (settings.apiTransport === "tavern" ? "\u9152\u9986\u540E\u7AEF\u672A\u80FD\u751F\u6210\u56DE\u590D\uFF0C\u8BF7\u68C0\u67E5 API \u5730\u5740\u3001\u5BC6\u94A5\u548C\u9152\u9986\u540E\u7AEF\u7F51\u7EDC" : "")));
      trace.json = true;
      const d = extract(data);
      text4 = source === "claude" ? (data.content || []).filter((p) => p.type === "text" || !p.type).map((p) => p.text).join("") : d.contentDelta || d.toolArgsDelta || "";
    }
    if (typeof text4 !== "string" || !text4.trim()) {
      const format = trace.json ? "JSON" : `\u6D41\u4E8B\u4EF6 ${trace.events ?? 0} \u4E2A\uFF0C${trace.done ? "\u6536\u5230 [DONE]" : "\u8FDE\u63A5\u5DF2\u7ED3\u675F\uFF0C\u672A\u6536\u5230 [DONE]"}`;
      throw new Error(`\u72EC\u7ACB API \u672A\u8FD4\u56DE\u6709\u6548\u6587\u672C\uFF08${trace.relay ? "\u9152\u9986\u540E\u7AEF" : "\u6D4F\u89C8\u5668\u76F4\u8FDE"}\uFF1B${format}\uFF1B\u63A8\u7406 ${trace.reasoning} \u5B57\u7B26\uFF0C\u6B63\u6587 0\uFF1Bfinish_reason=${trace.finish || "\u672A\u63D0\u4F9B"}\uFF09`);
    }
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
        const remove2 = button("\u2715", "pill-btn danger");
        remove2.disabled = slot.id === "identity";
        remove2.title = remove2.disabled ? "\u53EF\u4F7F\u7528\u5F00\u5173\u505C\u7528\u8EAB\u4EFD\u58F0\u660E" : slot.custom ? "\u5220\u9664\u6B64\u69FD\u4F4D" : "\u9690\u85CF\u6B64\u5185\u7F6E\u69FD\u4F4D\uFF08\u53EF\u4ECE\u300C\u6062\u590D\u9ED8\u8BA4\u300D\u627E\u56DE\uFF09";
        actions.append(edit, up, down, remove2);
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
        remove2.onclick = () => {
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
    function field(grid, key4, title, input2, fallback, disabled = false, wide = false) {
      const wrap = make("div", wide ? "field wide" : "field");
      const label = make("label", "", title);
      input2.name = key4;
      input2.disabled = disabled;
      const checkbox = input2.type === "checkbox";
      if (checkbox) input2.checked = settings[key4] ?? fallback;
      else input2.value = settings[key4] ?? fallback;
      input2.onchange = () => {
        if (input2.type === "number" && (!input2.reportValidity() || !Number.isFinite(input2.valueAsNumber))) return;
        ctx.save({ [key4]: checkbox ? input2.checked : input2.type === "number" ? input2.valueAsNumber : input2.value });
        if (key4 === "apiMode" || key4 === "apiTransport") renderApiTab(page, ctx);
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
      ["custom", "\u{1F680} \u72EC\u7ACB\u81EA\u5B9A\u4E49 API"],
      ["tavern", "\u{1F37A} \u9152\u9986\u5F53\u524D\u8FDE\u63A5 API (TavernHelper.generateRaw)"]
    ]), "tavern");
    field(api, "apiTransport", "\u72EC\u7ACB API \u8BF7\u6C42\u8DEF\u5F84", select([
      ["direct", "\u6D4F\u89C8\u5668\u76F4\u8FDE"],
      ["tavern", "\u7ECF\u9152\u9986\u540E\u7AEF\uFF08OpenAI \u517C\u5BB9\uFF09"]
    ]), "direct", tavern);
    if (settings.apiTransport !== "tavern") field(api, "apiSource", "\u72EC\u7ACB API \u534F\u8BAE\u7C7B\u578B", select([
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
      const names = await fetchModels({ ...ctx.settings }, { host: ctx.host, fetchImpl: ctx.fetchImpl });
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
      else await requestViaCustomApi(probe, messages, { host: ctx.host, fetchImpl: ctx.fetchImpl });
      return "\u6D4B\u8BD5\u8FDE\u63A5\u6210\u529F";
    });
    const sampling = card("\u2699 \u91C7\u6837\u53C2\u6570");
    field(sampling, "temperature", "\u6E29\u5EA6 (temperature)", input("number", { step: "any", required: true }), 0.8);
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
  function renderSettings(page, key4, ctx) {
    if (key4 === "prompt") return renderPromptTab(page, ctx);
    if (key4 === "api") return renderApiTab(page, ctx);
  }

  // src/tavern/ai-sessions.js
  var roles = /* @__PURE__ */ new Set(["user", "assistant", "system", "tool"]);
  function createAiSessions(saved, persist, now = Date.now) {
    const data = { sessions: Array.isArray(saved?.sessions) ? structuredClone(saved.sessions) : [], activeId: saved?.activeId };
    const get3 = (id3) => data.sessions.find((session) => session.id === id3);
    const active = () => get3(data.activeId);
    const save = () => persist(data);
    let lastId = 0;
    function create(title = "\u65B0\u5EFA\u4F1A\u8BDD") {
      const ts = now();
      do {
        lastId = Math.max(ts, lastId + 1);
      } while (get3(`sess_${lastId}`));
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
      get: get3,
      create() {
        const session = create();
        save();
        return session;
      },
      select(id3) {
        if (get3(id3)) {
          data.activeId = id3;
          save();
        }
      },
      rename(id3, title) {
        const session = get3(id3);
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
        const session = get3(id3);
        if (!session) return;
        session.messages.length = 0;
        change(session);
      },
      append(id3, ...messages) {
        const session = get3(id3);
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
        const session = get3(id3);
        if (!session?.messages.includes(message)) return;
        Object.assign(message, fields3);
        change(session);
      }
    };
  }

  // src/tavern/char-snapshots.js
  var transient = /* @__PURE__ */ new Set(["x", "y", "z", "xyz", "position", "pos", "coordinates", "facing", "ap", "used", "round", "turn", "initiativeRoll", "reactionAvailable", "\u4F4D\u7F6E", "\u5750\u6807", "\u884C\u52A8\u70B9", "\u56DE\u5408", "\u671D\u5411"]);
  var clean = (record2) => Object.fromEntries(Object.entries(record2 ?? {}).filter(([key4]) => !transient.has(key4) && !key4.startsWith("__source")));
  var ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v;
  var aliases = (r) => [r?.id, r?.uid, r?.characterId, r?.instanceId, r?.ID, r?.name, r?.displayName, r?.characterName, r?.\u540D\u79F0, r?.\u59D3\u540D, r?.\u89D2\u8272\u540D, r?.__sourceKey].filter(Boolean);
  async function characterRecords(sources, hydrated) {
    const mvu = collectMvu(sources.mvuData), battle = sources.battleInit;
    const participants = battle.units ?? battle.participants ?? [];
    const rows2 = await Promise.all((hydrated?.roster ?? []).map(async (unit, i) => {
      const mapping = hydrated.sourceMap?.[unit.id] ?? {};
      const p = participants.find?.((p2) => p2.id === unit.id) ?? participants[unit.id] ?? participants[i];
      const names = new Set([unit.id, unit.name, p?.name, mapping.sourceId, mapping.sourceName].filter(Boolean));
      const matches3 = (r) => aliases(r).some((x) => names.has(x));
      const samePath2 = mvu.find((r) => mapping.path && JSON.stringify(r.__sourcePath) === JSON.stringify(mapping.path));
      const mv = samePath2 ?? mvu.find(matches3);
      if (mv) aliases(mv).forEach((name) => names.add(name));
      const char = sources.charInfo?.find(matches3);
      const sourceKind = unit.source === "MVU" || mv && !char ? "mvu" : char ? "char_info" : "battle_init";
      const defs = (table4, ids) => Object.fromEntries(ids.filter((id3) => typeof id3 === "string" && Object.hasOwn(table4 ?? {}, id3)).map((id3) => [id3, table4[id3]]));
      const raw = {
        ...mv && { mvu: clean(mv) },
        ...char && { char_info: clean(char) },
        battle_init: clean(p),
        equipment: defs(battle.equipment, [p?.mainHand, p?.offHand, p?.shield, ...Array.isArray(p?.gear) ? p.gear : []]),
        skills: defs(battle.skills, Array.isArray(p?.skills) ? p.skills : [])
      };
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered(raw))));
      return [unit.id, { raw, sourceKind, hash: Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("") }];
    }));
    return Object.fromEntries(rows2);
  }

  // src/tavern/instance-card.js
  var attributes2 = { str: "\u529B\u91CF", agi: "\u654F\u6377", con: "\u4F53\u8D28", int: "\u667A\u529B", spi: "\u7CBE\u795E" };
  var types = { physical: "\u7269\u7406", energy: "\u80FD\u91CF", mental: "\u7CBE\u795E", true: "\u771F\u5B9E" };
  var when = { passive: "\u88AB\u52A8", active: "\u4E3B\u52A8", on_hit: "\u547D\u4E2D\u65F6", on_attack: "\u653B\u51FB\u65F6", on_skill_cast: "\u65BD\u653E\u65F6", on_damaged: "\u53D7\u4F24\u65F6", on_heal: "\u6CBB\u7597\u65F6", on_turn_start: "\u56DE\u5408\u5F00\u59CB", on_turn_end: "\u56DE\u5408\u7ED3\u675F", on_kill: "\u51FB\u5012\u65F6", on_death: "\u5012\u4E0B\u65F6", on_equip: "\u88C5\u5907\u65F6", on_ally_death: "\u961F\u53CB\u5012\u4E0B\u65F6" };
  var verbs = { heal: "\u6CBB\u7597", modifyStat: "\u5C5E\u6027\u4FEE\u6B63", modifyCheck: "\u68C0\u5B9A\u4FEE\u6B63", restoreResource: "\u6062\u590D\u8D44\u6E90", drainResource: "\u6D88\u8017\u8D44\u6E90", produceResource: "\u83B7\u5F97\u8D44\u6E90", removeStatus: "\u79FB\u9664\u72B6\u6001", shield: "\u62A4\u76FE", knockback: "\u51FB\u9000", teleportBackstab: "\u77AC\u79FB\u80CC\u523A", execute: "\u65A9\u6740", raiseDead: "\u590D\u751F", chainEffect: "\u6548\u679C\u94FE", procEffect: "\u89E6\u53D1\u6548\u679C", addItem: "\u83B7\u5F97\u7269\u54C1", upgradeHitTier: "\u63D0\u5347\u547D\u4E2D\u8BC4\u7EA7", forceOutcome: "\u5F3A\u5236\u5224\u5B9A", multiplyDamage: "\u4F24\u5BB3\u500D\u7387", modifyDamageBase: "\u57FA\u7840\u4F24\u5BB3", summon: "\u53EC\u5524" };
  function effectSummary(expr, state) {
    const status2 = (id3) => state?.statusTemplates?.[id3]?.name ?? STATUSES[id3]?.name ?? id3;
    const node3 = (n) => (n.enabled === false ? "[\u5DF2\u5173\u95ED] " : "") + (n.kind === "damage" ? ["\u4F24\u5BB3", n.percentOfPower != null ? `\u5A01\u529B${Math.round(n.percentOfPower * 100)}%` : n.amount ?? n.flat, types[n.damageType]].filter((v) => v != null).join(" ") : n.kind === "grantStatus" ? `\u65BD\u52A0 ${status2(n.statusId)}${n.turns ? ` ${n.turns} \u56DE\u5408` : ""}` : n.kind === "chainEffect" ? n.effects.map(node3).join("\uFF0C") : [verbs[n.kind] ?? "\u6548\u679C", n.label ?? attributes2[n.stat] ?? n.stat ?? n.resource ?? "", n.amount ?? n.flat ?? n.factor ?? (n.percent != null ? `${n.percent * 100}%` : "")].filter((v) => v !== "").join(" "));
    const roll = expr.roll;
    return `${when[expr.trigger] ?? "\u89E6\u53D1"}${roll?.dice ? ` ${roll.dice}\u2265${roll.gte}` : roll?.save ? " \u8C41\u514D\u5931\u8D25" : roll?.chance != null ? ` ${Math.round(roll.chance * 100)}%` : ""} \u2192 ${(expr.effects ?? []).map(node3).join("\uFF1B")}`;
  }
  var RESOURCES = [["hp", "HP", "maxHp"], ["mp", "MP", "maxMp"], ["sp", "SP", "maxSp"]];
  var TEAMS = { blue: "\u6211\u65B9", red: "\u654C\u65B9" };
  var ratio3 = (v, max) => max ? Math.min(1, Math.max(0, (Number(v) || 0) / max)) : 0;
  function fillInstance(box, make, unit, state, raw, select, { collapsed = false, onToggle, warnings = 0 } = {}) {
    const line = (tag, cls, value) => make(tag, { class: cls }, value);
    const name = unit.name ?? unit.id;
    box.classList.add("fated-char-card");
    if (unit.team) box.dataset.team = unit.team;
    const header = line("div", "fated-char-heading");
    const avatar = line("span", "fated-char-avatar", [...String(name)][0] ?? "?");
    const title = line("div", "fated-char-title");
    const nameRow = line("div", "fated-char-name-row");
    nameRow.append(line("strong", "fated-char-name", name));
    if (warnings) nameRow.append(make("span", { class: "fated-char-warn", title: `${warnings} \u6761\u8BCA\u65AD` }, `\u26A0 ${warnings}`));
    const tags2 = line("div", "fated-char-tags");
    for (const text4 of [TEAMS[unit.team], unit.tier ? `\u7B2C ${unit.tier} \u5C42\u7EA7` : null, `\u4F53\u578B ${bodySizeLabel(unit)}`, unit.source ?? "AI \u7F16\u8F91"]) if (text4) tags2.append(line("span", "fated-char-tag", text4));
    title.append(nameRow, tags2);
    const mini = line("div", "fated-char-mini");
    for (const [key4, label, maxKey] of RESOURCES) {
      const bar = make("span", { class: `fated-char-mini-bar is-${key4}`, title: `${label} ${unit[key4] ?? "\u2014"} / ${unit[maxKey] ?? "\u2014"}` });
      bar.style.setProperty("--ratio", ratio3(unit[key4], unit[maxKey]));
      mini.append(bar);
    }
    const toggle = make("button", { type: "button", class: "fated-char-toggle", "aria-expanded": String(!collapsed), "aria-label": `${collapsed ? "\u5C55\u5F00" : "\u6298\u53E0"} ${name}`, title: collapsed ? "\u5C55\u5F00" : "\u6298\u53E0" }, "");
    header.append(avatar, title, mini, select, toggle);
    box.append(header);
    const body = line("div", "fated-char-body");
    body.hidden = collapsed;
    box.dataset.collapsed = String(collapsed);
    const setCollapsed = (next) => {
      body.hidden = next;
      box.dataset.collapsed = String(next);
      toggle.setAttribute("aria-expanded", String(!next));
      toggle.title = next ? "\u5C55\u5F00" : "\u6298\u53E0";
      toggle.setAttribute("aria-label", `${next ? "\u5C55\u5F00" : "\u6298\u53E0"} ${name}`);
      onToggle?.(next);
    };
    toggle.addEventListener("click", () => setCollapsed(!body.hidden));
    header.addEventListener("click", (e) => {
      if (e.target === header || e.target === avatar || title.contains(e.target) || mini.contains(e.target)) setCollapsed(!body.hidden);
    });
    const resources = line("div", "fated-char-resources");
    for (const [key4, label, maxKey] of RESOURCES) {
      const max = unit[maxKey], v = unit[key4];
      const bar = line("div", `fated-char-bar is-${key4}`);
      bar.style.setProperty("--ratio", ratio3(v, max));
      bar.style.setProperty("--fill", `${Math.round(ratio3(v, max) * 100)}%`);
      bar.append(make("i"), line("b", "", label), line("span", "", `${v ?? "\u2014"} / ${max ?? "\u2014"}`));
      resources.append(bar);
    }
    body.append(resources);
    const stats2 = line("dl", "fated-char-stats");
    for (const [key4, label] of Object.entries(attributes2)) {
      const pair = make("div");
      pair.append(make("dt", {}, label), make("dd", {}, unit.stats?.[key4] ?? "\u2014"));
      stats2.append(pair);
    }
    body.append(stats2);
    const section = (heading, rows2) => {
      const block = line("section", "fated-char-section");
      block.append(make("h5", {}, `${heading}${rows2.length ? ` \xB7 ${rows2.length}` : ""}`));
      if (!rows2.length) block.append(line("p", "fated-mini", `\u6682\u65E0${heading}`));
      for (const { label, meta, template } of rows2) {
        const fx = template?.effects ?? [];
        const row = make(fx.length ? "details" : "div", { class: "fated-char-row" });
        const head = make(fx.length ? "summary" : "div", { class: "fated-char-row-head" });
        head.append(line("span", "fated-char-row-name", label));
        for (const m of meta) head.append(line("span", "fated-char-chip", m));
        if (fx.length) head.append(line("span", "fated-char-fx", `${fx.length} \u4E2A\u6548\u679C`));
        row.append(head);
        for (const e of fx) row.append(line("p", "fated-mini", effectSummary(e, state)));
        block.append(row);
      }
      body.append(block);
    };
    const wear = [["\u4E3B\u624B", unit.mainHand ?? unit.weapon], ["\u526F\u624B", unit.offHand], ["\u76FE\u724C", unit.shield], ...(unit.gear ?? []).map((id3) => ["\u7A7F\u6234", id3])];
    const gear = wear.filter(([, id3]) => id3).map(([slot, id3]) => {
      const item = state?.items?.[id3], t = state?.equipment?.[item?.templateId] ?? unit.equipment?.find((e) => e.id === id3)?.template;
      const d = t?.damage;
      const dice3 = d ? `${d.count}d${d.sides}${d.bonus ? ` ${d.bonus > 0 ? "+" : ""}${d.bonus}` : ""}${d.stat ? ` + ${attributes2[d.stat] ?? d.stat}` : ""} ${types[d.type] ?? ""}`.trim() : null;
      return { label: `[${slot}] ${t?.name ?? id3}`, meta: [t?.attack != null ? `\u653B\u51FB ${t.attack}` : null, t?.defense ? `\u9632\u5FA1 ${t.defense}` : null, t?.range != null ? `\u8DDD\u79BB ${t.range}` : null, dice3].filter(Boolean), template: t };
    });
    section("\u88C5\u5907", gear);
    const skills = (unit.skills ?? []).map((id3) => {
      const t = state?.skills?.[id3];
      const damage = [...new Set([t?.damage?.type, t?.damageType, ...(t?.effects ?? []).flatMap((e) => e.effects.filter((n) => n.kind === "damage").map((n) => n.damageType)), unit.skillInfo?.[id3]?.damageType].filter(Boolean))].map((type) => types[type]).join("/");
      const cost = [`${t?.resourceCost?.sp ?? t?.sp ?? 0} SP`, t?.resourceCost?.mp ?? t?.mp ? `${t.resourceCost?.mp ?? t.mp} MP` : null, t?.resourceCost?.hp ? `${t.resourceCost.hp} HP` : null].filter(Boolean).join(" / ");
      return { label: t?.name ?? id3, meta: [`\u6D88\u8017 ${cost}`, `\u5A01\u529B ${t?.power ?? "\u2014"}`, damage || "\u65E0\u4F24\u5BB3\u7C7B\u578B", `\u8DDD\u79BB ${t?.range ?? "\u2014"}`], template: t };
    });
    section("\u6280\u80FD", skills);
    const details = make("details", { class: "fated-char-raw" });
    details.append(make("summary", {}, "\u539F\u59CB\u6570\u636E"), make("pre", {}, JSON.stringify({ instance: unit, source: raw, equipment: gear.map((r) => r.template), skills: skills.map((r) => r.template) }, null, 2)));
    body.append(details);
    box.append(body);
    return { body, setCollapsed };
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
  function mountAiPage(page, { make, on, sessions, send: send2, stop }) {
    const button = (label) => make("button", { type: "button" }, label);
    const toolbar = make("div", { class: "fated-actions" });
    const select = make("select", { "aria-label": "\u5207\u6362\u4F1A\u8BDD" });
    const create = button("\u65B0\u5EFA"), rename = button("\u91CD\u547D\u540D"), remove2 = button("\u5220\u9664"), clear = button("\u6E05\u7A7A\u5F53\u524D\u4F1A\u8BDD");
    toolbar.append(select, create, rename, remove2, clear);
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
    const rows2 = /* @__PURE__ */ new Map(), drafts = /* @__PURE__ */ new Map();
    function scrollToEnd() {
      if (pinned && log.clientHeight) log.scrollTop = log.scrollHeight;
    }
    function updateMessage(message) {
      let row = rows2.get(message);
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
        rows2.set(message, row);
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
      rows2.clear();
      log.replaceChildren();
      for (const message of session.messages) updateMessage(message);
      refresh();
    }
    function refresh() {
      const session = sessions.active();
      info.textContent = `${session.messages.length} \u6761\u6D88\u606F \xB7 \u521B\u5EFA\u4E8E ${formatTime(session.createdAt)}`;
      submit.disabled = busy || !input.value.trim();
      remove2.disabled = clear.disabled = busy;
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
    on(remove2, "click", () => {
      drafts.delete(shownId);
      sessions.remove(shownId);
      render();
    });
    on(clear, "click", () => {
      sessions.clear(shownId);
      render();
    });
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
  var safeProperty = (key4) => !["__proto__", "prototype", "constructor"].includes(key4);
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
  function el(doc, tag, attrs3, content) {
    const n = doc.createElement(tag);
    for (const [key4, value] of Object.entries(attrs3 || {})) {
      if (key4 === "class") n.className = value;
      else if (key4 === "style") n.style.cssText = value;
      else if (key4 === "text") n.textContent = value;
      else if (value != null) n.setAttribute(key4, value);
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
    for (const [key4, value] of Object.entries(extra)) {
      if (!safeProperty(key4)) continue;
      if (isObject(value) && isObject(result[key4])) result[key4] = deepMerge(result[key4], value);
      else result[key4] = clone2(value);
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
  function safeKey(value) {
    return text3(value).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 96) || "unknown";
  }
  function battleKeyFor(chat, message, battle) {
    const meta = messageMeta(message);
    const explicit = battle?.battleId ?? battle?.id ?? "unnamed";
    return [safeKey(chat), safeKey(meta.messageId), safeKey(meta.swipeId), safeKey(explicit)].join("__");
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
      const indent = match[1].length, key4 = match[2], raw = match[3].trim();
      while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
      let valueOut = raw;
      if (!raw) {
        valueOut = {};
        stack.push({ indent, object: valueOut });
      } else if (/^(true|false)$/i.test(raw)) valueOut = raw.toLowerCase() === "true";
      else if (/^-?\d+(?:\.\d+)?$/.test(raw)) valueOut = Number(raw);
      else valueOut = parseJSON(raw, raw.replace(/^['"]|['"]$/g, ""));
      stack.at(-1).object[key4] = valueOut;
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
    const options = { host, fetchImpl, signal, onStreamChunk };
    return config.apiMode === "custom" || config.apiMode === "direct" ? requestViaCustomApi(config, messages, options) : requestViaTavern(host, config, messages, options);
  }
  function parseJSONPatch(value) {
    const parsed = parseAIResponse(value).data;
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.patch)) return parsed.patch;
    if (Array.isArray(parsed?.patches)) return parsed.patches;
    if (Array.isArray(parsed?.jsonPatch)) return parsed.jsonPatch;
    if (Array.isArray(parsed?.battle_patch)) return parsed.battle_patch;
    if (Array.isArray(parsed?.unit_patch)) return parsed.unit_patch;
    if (Array.isArray(parsed?.battlePatch)) return parsed.battlePatch;
    if (Array.isArray(parsed?.unitPatch)) return parsed.unitPatch;
    return null;
  }
  function fingerprintAt(state, path) {
    let value = state;
    for (const key4 of path.slice(1).split("/").map((key5) => key5.replaceAll("~1", "/").replaceAll("~0", "~"))) {
      if (value == null || !own6(value, key4)) return void 0;
      value = value[key4];
    }
    return JSON.stringify(value);
  }
  var normalizationPath = /^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/;
  var TAVERN_VERSION = "0.2.12";
  var DEFAULT_CONFIG = {
    apiMode: "tavern",
    baseUrl: "",
    apiKey: "",
    model: "",
    temperature: 0.8,
    max_tokens: 2400,
    extraBody: "{}",
    excludeParams: "",
    headers: "{}",
    hideLauncher: false,
    autoScan: true,
    autoDeliverBattleReport: true,
    charSnapshots: {},
    rosterSelection: null,
    normalizationBatches: {},
    slots: describeSlots(),
    extraText: "",
    aiSessions: { sessions: [], activeId: null },
    debugPrompts: false,
    apiSource: "openai",
    stream: true,
    timeoutMs: 6e4
  };
  function configFor(storage, key4) {
    try {
      const saved = parseJSON(storage?.getItem(key4), {});
      const mode = saved?.apiMode ?? (saved?.baseUrl ? "direct" : "tavern");
      return deepMerge(DEFAULT_CONFIG, { ...saved, apiMode: mode === "direct" ? "custom" : mode, slots: describeSlots(saved?.slots) });
    } catch {
      return clone2(DEFAULT_CONFIG);
    }
  }
  function putConfig(storage, key4, value) {
    try {
      if (!storage) return false;
      storage.setItem(key4, JSON.stringify(value));
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
    const charBlocks = extractTags(joined, "char_info").reverse();
    const charRaw = charBlocks[0] || "";
    const charInfo = charBlocks.flatMap((raw) => {
      const value = parseJSON(raw, null);
      return Array.isArray(value) ? value : value ? [value] : [parseLooseYaml(raw)];
    });
    const mvuData = statData(variables) ?? variables ?? {};
    const sourceMessage = battleSource ?? eligible.at(-1);
    const battleKey = battleInit ? battleKeyFor(chat, sourceMessage, battleInit) : null;
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
  function patchValue(value, table4) {
    if (!Array.isArray(value)) return value;
    return Object.fromEntries(value.filter((item) => item && (item.id || item.name)).map((item, index) => {
      const normalized = clone2(item);
      if (table4 === "covers" || table4 === "interactives" || table4 === "zones") {
        const xyz = normalized.xyz;
        if (Array.isArray(xyz)) {
          normalized.x = Number(xyz[0] ?? 0);
          normalized.y = Number(xyz[1] ?? 0);
          delete normalized.xyz;
        }
      }
      if (table4 === "covers") {
        normalized.name ??= `\u63A9\u4F53${index + 1}`;
        normalized.material ??= "\u672A\u77E5\u6750\u6599";
        normalized.maxHp ??= normalized.hp ?? 1;
        normalized.hp ??= normalized.maxHp;
        normalized.cover ??= normalized.shielding ?? 2;
        for (const key5 of Object.keys(normalized)) if (!["id", "name", "x", "y", "material", "hp", "maxHp", "cover"].includes(key5)) delete normalized[key5];
      }
      if (table4 === "interactives") {
        normalized.name ??= "\u4E92\u52A8\u70B9";
        normalized.kind ??= "barrel";
        normalized.spent ??= false;
        for (const key5 of Object.keys(normalized)) if (!["id", "name", "x", "y", "kind", "spent"].includes(key5)) delete normalized[key5];
      }
      const key4 = String(normalized.id || normalized.name || index);
      return [key4, normalized];
    }));
  }
  function normalizeSemanticPatch(patch) {
    if (!isObject(patch)) return patch;
    const result = clone2(patch);
    for (const key4 of ["units", "covers", "interactives", "zones", "items", "equipment", "skills"]) if (Array.isArray(result[key4])) result[key4] = patchValue(result[key4], key4);
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
      for (const key4 of keys) {
        if (!own6(parent, key4)) throw new Error(`\u8865\u4E01\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${operation.path}`);
        parent = parent[key4];
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
    let selectedMessageId = null, selectedBattleText = "", aiController = null, aiFinished, askAI, retryAI = null, aiPage = null;
    let characters = {}, scanStatus = "";
    const openingSources = /* @__PURE__ */ new Map();
    const enteredBattles = /* @__PURE__ */ new Set();
    const selectedIds = () => (config.rosterSelection ?? Object.keys(config.instances)).filter((key4) => own6(config.instances, key4));
    const batches = (key4) => config.normalizationBatches?.[key4] ?? [];
    const operations = (key4) => batches(key4).flatMap((batch) => batch.patch);
    let battleObserver = null, diagnostics = { phase: "created" };
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
    const fullscreen = el(doc, "button", { type: "button", class: "fated-tavern-fullscreen", title: "\u5168\u5C4F", "aria-label": "\u5168\u5C4F" }, "\u25A1");
    const minimize = el(doc, "button", { type: "button", title: "\u6700\u5C0F\u5316", "aria-label": "\u6700\u5C0F\u5316" }, "\u2212");
    const close = el(doc, "button", { type: "button", title: "\u5173\u95ED", "aria-label": "\u5173\u95ED" }, "\xD7");
    const resizeHandle = el(doc, "span", { class: "fated-tavern-resize", "aria-hidden": "true" });
    header.append(title, fullscreen, minimize, close);
    const tabs = el(doc, "nav", { class: "fated-tavern-tabs", role: "tablist" });
    const content = el(doc, "div", { class: "fated-tavern-content" });
    const pages = {};
    for (const [key4, label] of [["instances", "\u{1F4E6} \u5B9E\u4F8B\u7EF4\u62A4"], ["prompt", "\u{1F9E9} \u63D0\u793A\u8BCD\u7EC4\u88C5"], ["api", "\u{1F50C} API \u8BBE\u7F6E"], ["ai", "\u{1F916} \u8F85\u52A9 AI"], ["sandbox", "\u2694\uFE0F \u6C99\u76D8"]]) {
      const button = el(doc, "button", { type: "button", role: "tab", "aria-selected": key4 === "instances" ? "true" : "false", "data-tab": key4 }, label);
      const page = el(doc, "div", { class: `fated-tab ${key4 === "instances" ? "active" : ""}`, "data-page": key4 });
      tabs.append(button);
      content.append(page);
      pages[key4] = page;
      on(button, "click", () => {
        Object.entries(pages).forEach(([name, node3]) => {
          node3.classList.toggle("active", name === key4);
        });
        [...tabs.children].forEach((x) => x.setAttribute("aria-selected", String(x === button)));
        if (key4 === "prompt" || key4 === "api") renderSettings(page, key4, settingsContext());
        if (key4 === "ai") aiPage?.show();
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
    panel.append(header, tabs, content, resizeHandle);
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
        selectedBattleText = "";
        await scan();
      }
    }
    async function openBattleEntry(messageId, battleText = "") {
      if (messageId == null && !battleText) return open();
      selectedMessageId = messageId == null ? null : String(messageId);
      selectedBattleText = battleText;
      panel.hidden = false;
      launcher.hidden = true;
      switchTab("sandbox");
      await scan();
    }
    let panelFullscreen = false;
    let panelRestore = null;
    function setFullscreen(value) {
      panelFullscreen = Boolean(value);
      if (panelFullscreen) {
        const rect = panel.getBoundingClientRect();
        panelRestore = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: panel.style.right, bottom: panel.style.bottom };
        panel.classList.add("is-fullscreen");
        panel.style.left = "0px";
        panel.style.top = "0px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.width = "100vw";
        panel.style.height = "100dvh";
        fullscreen.textContent = "\u2750";
        fullscreen.title = "\u8FD8\u539F";
        fullscreen.setAttribute("aria-label", "\u8FD8\u539F");
      } else {
        panel.classList.remove("is-fullscreen");
        const restore = panelRestore;
        panelRestore = null;
        panel.style.right = restore?.right || "16px";
        panel.style.bottom = restore?.bottom || "16px";
        panel.style.left = restore ? `${restore.left}px` : "";
        panel.style.top = restore ? `${restore.top}px` : "";
        panel.style.width = restore ? `${restore.width}px` : "";
        panel.style.height = restore ? `${restore.height}px` : "";
        fullscreen.textContent = "\u25A1";
        fullscreen.title = "\u5168\u5C4F";
        fullscreen.setAttribute("aria-label", "\u5168\u5C4F");
      }
    }
    function hide() {
      panel.hidden = true;
      launcher.hidden = Boolean(config.hideLauncher);
    }
    function bindEventBus() {
      const eventOn = hostMethod(host, "eventOn");
      if (typeof eventOn !== "function") return;
      const bind = (name, handler) => {
        try {
          const result = eventOn(name, handler);
          listeners.push(typeof result === "function" ? result : typeof result?.off === "function" ? () => result.off() : () => hostMethod(host, "eventRemoveListener")?.(name, handler));
        } catch (_) {
        }
      };
      bind("fated_tactical:open_ui", (entry) => {
        openBattleEntry(entry?.messageId, text3(entry?.battleText)).catch(showError);
      });
    }
    function closePanel() {
      hide();
    }
    on(launcher, "click", (event) => {
      if (launcher.dataset.dragged === "true") {
        delete launcher.dataset.dragged;
        event.preventDefault();
        return;
      }
      open();
    });
    on(fullscreen, "click", () => setFullscreen(!panelFullscreen));
    on(close, "click", closePanel);
    on(minimize, "click", hide);
    on(doc, "click", (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
      const trigger = path.find((node3) => node3?.matches?.("[data-fated-battle-open], .fated-battle-enter"));
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        const floor = trigger.closest("[mesid], [data-message-id], [data-mesid]");
        void openBattleEntry(floor?.getAttribute("mesid") ?? floor?.dataset.messageId ?? floor?.dataset.mesid);
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
          try {
            surface.setPointerCapture?.(event.pointerId);
          } catch (_) {
          }
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
    function draggableLauncher() {
      let drag = null;
      const start = (event) => {
        if (event.button !== 0) return;
        const rect = launcher.getBoundingClientRect();
        drag = { pointerId: event.pointerId ?? null, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      };
      on(launcher, "pointerdown", start);
      on(launcher, "mousedown", (event) => {
        if (!drag) start(event);
      });
      const move = (event) => {
        if (!drag || drag.pointerId != null && event.pointerId != null && event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
        if (!drag.moved) {
          drag.moved = true;
          launcher.dataset.dragged = "true";
          launcher.style.right = "auto";
          launcher.style.bottom = "auto";
          launcher.style.left = `${drag.left}px`;
          launcher.style.top = `${drag.top}px`;
          try {
            launcher.setPointerCapture?.(event.pointerId);
          } catch (_) {
          }
        }
        const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
        const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
        launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`;
        launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
        event.preventDefault();
      };
      on(doc, "pointermove", move);
      on(launcher, "pointermove", move);
      on(doc, "mousemove", (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
        drag.moved = true;
        launcher.dataset.dragged = "true";
        launcher.style.right = "auto";
        launcher.style.bottom = "auto";
        const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
        const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
        launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`;
        launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
        event.preventDefault();
      });
      const stop = (event) => {
        if (drag && (drag.pointerId == null || event.pointerId == null || drag.pointerId === event.pointerId)) drag = null;
      };
      on(doc, "pointerup", stop);
      on(doc, "pointercancel", stop);
      on(doc, "mouseup", stop);
      on(launcher, "lostpointercapture", stop);
    }
    draggableLauncher();
    draggable(panel, header);
    function resizable() {
      let resize = null;
      on(resizeHandle, "pointerdown", (event) => {
        if (panelFullscreen || event.button !== 0) return;
        const rect = panel.getBoundingClientRect();
        resize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        try {
          resizeHandle.setPointerCapture?.(event.pointerId);
        } catch (_) {
        }
        event.preventDefault();
      });
      on(resizeHandle, "pointermove", (event) => {
        if (!resize || event.pointerId !== resize.pointerId) return;
        const vw = host.innerWidth || doc.documentElement.clientWidth || resize.width;
        const vh = host.innerHeight || doc.documentElement.clientHeight || resize.height;
        const width = Math.min(vw - 16, Math.max(480, resize.width + event.clientX - resize.x));
        const height2 = Math.min(vh - 16, Math.max(360, resize.height + event.clientY - resize.y));
        panel.style.width = `${width}px`;
        panel.style.height = `${height2}px`;
        event.preventDefault();
      });
      const stop = (event) => {
        if (resize?.pointerId === event.pointerId) resize = null;
      };
      on(resizeHandle, "pointerup", stop);
      on(resizeHandle, "pointercancel", stop);
      on(resizeHandle, "lostpointercapture", stop);
    }
    resizable();
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
      const normalize = el(doc, "button", { type: "button", "data-normalize": "" }, "\u6807\u51C6\u5316");
      normalize.disabled = !selectedIds().length || !activeBattleKey || !!aiController;
      const hint = !selectedIds().length ? [scanStatus, "\u8BF7\u5148\u52FE\u9009\u8981\u6807\u51C6\u5316\u7684\u89D2\u8272"].filter(Boolean).join(" \xB7 ") : scanStatus;
      normalize.title = hint;
      on(normalize, "click", () => runNormalize(selectedIds(), { force: true }));
      battleActions.append(loadBattle, normalize);
      battleCard.append(battleActions, el(doc, "p", { class: "fated-mini", "data-normalize-status": "" }, hint), showSource);
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
      const choose = (ids) => {
        persistSettings({ rosterSelection: ids });
        renderInstances();
      };
      for (const [label, all] of [["\u5168\u9009", true], ["\u53D6\u6D88\u5168\u9009", false]]) {
        const b = el(doc, "button", { type: "button" }, label);
        on(b, "click", () => choose(all ? Object.keys(config.instances) : []));
        toolbar.append(b);
      }
      const collapsed = () => isObject(config.collapsedInstances) ? config.collapsedInstances : {};
      const setFolded = (ids, value) => {
        const next = { ...collapsed() };
        for (const id4 of ids) {
          if (value) next[id4] = true;
          else delete next[id4];
        }
        persistSettings({ collapsedInstances: next });
      };
      for (const [label, value] of [["\u5168\u90E8\u6298\u53E0", true], ["\u5168\u90E8\u5C55\u5F00", false]]) {
        const b = el(doc, "button", { type: "button", "data-fold-all": String(value) }, label);
        on(b, "click", () => {
          setFolded(Object.keys(config.instances), value);
          renderInstances();
        });
        toolbar.append(b);
      }
      const list3 = el(doc, "div");
      page.append(list3);
      const entries2 = Object.entries(config.instances);
      if (!entries2.length) list3.append(el(doc, "p", { class: "fated-mini" }, "\u6682\u65E0\u5B9E\u4F8B\u3002\u6253\u5F00\u6C99\u76D8\u4F1A\u81EA\u52A8\u8BFB\u53D6\u5F53\u524D MVU\u3001char_info \u548C battle_init\u3002"));
      for (const [key4, instance] of entries2) {
        const box = el(doc, "article", { class: "fated-instance" });
        box.dataset.unitId = key4;
        const select = el(doc, "input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${instance.name || key4}` });
        select.checked = selectedIds().includes(key4);
        on(select, "change", () => choose(select.checked ? [.../* @__PURE__ */ new Set([...selectedIds(), key4])] : selectedIds().filter((k) => k !== key4)));
        const messages = warningsForUnit(sources.warnings, [key4], false);
        const { body } = fillInstance(
          box,
          (tag, attrs3, value) => el(doc, tag, attrs3, value),
          instance,
          liveState(),
          characters[key4]?.raw,
          select,
          { collapsed: Boolean(collapsed()[key4]), warnings: messages.length, onToggle: (value) => setFolded([key4], value) }
        );
        if (messages.length) {
          const details = el(doc, "details", { class: "fated-char-diagnostics" }), list4 = el(doc, "ul");
          for (const { message } of messages) list4.append(el(doc, "li", {}, message));
          details.append(el(doc, "summary", {}, `\u26A0 ${messages.length} \u6761\u8BCA\u65AD`), list4);
          body.append(details);
        }
        const actions2 = el(doc, "div", { class: "fated-actions" });
        const edit = el(doc, "button", { type: "button" }, "\u7F16\u8F91 JSON");
        const remove2 = el(doc, "button", { type: "button" }, "\u5220\u9664");
        actions2.append(edit, remove2);
        body.append(actions2);
        list3.append(box);
        on(remove2, "click", () => {
          delete config.instances[key4];
          save();
          choose(selectedIds());
        });
        on(edit, "click", () => {
          const value = prompt("\u7F16\u8F91\u5B9E\u4F8B JSON", JSON.stringify(instance, null, 2));
          const parsed = parseJSON(value, null);
          if (isObject(parsed)) {
            config.instances[key4] = { ...parsed, id: key4, source: "AI \u7F16\u8F91" };
            save();
            renderInstances();
          }
        });
      }
      on(refresh, "click", () => {
        if (!host.confirm("\u4ECE\u5F53\u524D\u804A\u5929\u91CD\u65B0\u8BFB\u53D6\u672C\u573A\u53C2\u6218\u8005\uFF1F\u8FD9\u4F1A\u91CD\u7F6E\u672C\u573A\u6218\u6597\u8FDB\u5EA6\u3001\u6E05\u9664\u672C\u573A\u6807\u51C6\u5316\u8865\u4E01\u5E76\u6062\u590D\u539F\u59CB\u8BCA\u65AD\u3002\u4E0D\u4F1A\u8BF7\u6C42 AI\uFF0C\u4E5F\u4E0D\u5F71\u54CD\u5176\u4ED6\u6218\u573A\u3002")) return;
        void scan({ rehydrate: true });
      });
    }
    function switchTab(key4) {
      const button = tabs.querySelector(`[data-tab="${key4}"]`);
      button?.click();
    }
    let promptKind = "validate", promptInstruction = "";
    let previewSink, lastSent = null;
    function assemblyContext(kind = promptKind, instruction = promptInstruction, onlyUnitIds = kind === "validate" ? selectedIds() : void 0) {
      return { kind, instruction, onlyUnitIds, rawCharacters: Object.fromEntries(Object.entries(characters).map(([id4, c]) => [id4, c.raw])), state: liveState(), sources, roster: Object.values(config.instances), extraText: config.extraText };
    }
    function publishMessages(messages, kind = promptKind) {
      previewSink?.(messages, kind);
      return messages;
    }
    function prepareMessages(kind = promptKind, instruction = promptInstruction, sending = false, unitIds) {
      const slots = config.slots;
      const messages = assembleMessages(slots, assemblyContext(kind, instruction, unitIds));
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
    function runNormalize(unitIds = Object.keys(characters), { force = false, sessionId = force ? aiSessions.active().id : void 0 } = {}) {
      const stored = config.charSnapshots[activeBattleKey] ?? {};
      const eligible = force ? Object.keys(characters) : normalizationCandidates(characters, stored, sources.warnings ?? []);
      const ids = unitIds.filter((id4) => eligible.includes(id4));
      if (!ids.length) return;
      const records = Object.fromEntries(ids.map((id4) => [id4, { hash: characters[id4].hash, sourceKind: characters[id4].sourceKind }]));
      return askAI("validate", "", sessionId, records);
    }
    const battleStorageKey = (key4, field) => `fated-tactical/${key4}/${field}`;
    function readBattleStorage(key4, field) {
      try {
        return parseJSON(storage?.getItem(battleStorageKey(key4, field)));
      } catch {
        return null;
      }
    }
    async function hydrate(epoch, candidate, rehydrate) {
      const key4 = candidate.battleKey;
      const opening = !rehydrate && key4 && (openingSources.get(key4) ?? readBattleStorage(key4, "opening-source"));
      const nextSources = opening ? clone2(opening) : candidate;
      if (key4 && !opening) {
        nextSources.mvuData = clone2(await readBattleVariables(host, Number(candidate.source?.messageId)));
        nextSources.protagonistName = tavernIdentity(host);
      }
      if (epoch !== scanEpoch || disposed) return null;
      const openingSource = !opening && key4 ? clone2(nextSources) : null;
      if (!nextSources.battleInit) {
        sources = nextSources;
        diagnostics = { phase: "no-battle" };
        config.instances = {};
        return null;
      }
      const converter = options.converter || getGlobal(host, "FatedTactical")?.hydrateBattleState || getGlobal(host, "hydrateBattleState") || hydrateFromSources;
      let hydrated = null;
      let conversionError = null;
      if (typeof converter === "function") {
        const { mvuData, charInfo, battleInit, protagonistName } = nextSources;
        const input = { mvu: mvuData, stat_data: mvuData, charInfo, battleInit, protagonistName };
        try {
          hydrated = await converter(input);
        } catch (error2) {
          conversionError = error2;
        }
      }
      if (epoch !== scanEpoch || disposed) return null;
      if (conversionError) {
        diagnostics = { phase: "conversion-error", error: conversionError?.stack || conversionError?.message || String(conversionError), mvuKeys: Object.keys(nextSources.mvuData || {}), charCount: nextSources.charInfo?.length || 0, participantCount: nextSources.battleInit?.units?.length || nextSources.battleInit?.participants?.length || 0 };
        try {
          console.error("[fated-tactical] hydrate failed", diagnostics);
        } catch (_) {
        }
        const diagnosticNode2 = pages.instances.querySelector("[data-diagnostics]");
        if (diagnosticNode2) diagnosticNode2.textContent = JSON.stringify(diagnostics, null, 2);
        throw conversionError;
      }
      sources = nextSources;
      sources.warnings = hydrated?.warnings ?? [];
      sources.sourceMap = hydrated?.sourceMap ?? {};
      sources.seed = hydrated?.seed ?? hydrated?.state?.rng;
      sources.input = { mvu: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, latestFloor: sources.latestFloor, battleText: sources.battleRaw, protagonistName: sources.protagonistName };
      if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
      const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
      const nextInstances = {};
      for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) {
        const key5 = item.id || item.uid || item.name || `unit-${Object.keys(nextInstances).length + 1}`;
        nextInstances[key5] = { ...clone2(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? "MVU \u4E3B\u89D2" : "\u6B63\u6587 <char_info>") };
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
      if (openingSource && hydrated?.state) {
        openingSources.set(key4, openingSource);
        putConfig(storage, battleStorageKey(key4, "opening-source"), openingSource);
      }
      return hydrated;
    }
    let stopTerrainNotices;
    function refreshPortraits(state, epoch) {
      const mount3 = gameMount;
      if (!mount3?.setPortraits || !state) return;
      const isCurrent = () => !disposed && gameMount === mount3 && scanEpoch === epoch;
      void readBattlePortraits(host, state.units, sources.sourceMap ?? {}, isCurrent).then((portraits) => {
        if (isCurrent()) mount3.setPortraits(portraits);
      }).catch(() => {
      });
    }
    function mountState(state, restoreSaved = false) {
      stopTerrainNotices?.();
      stopTerrainNotices = void 0;
      gameMount?.unmount?.();
      gameMount = null;
      if (!state) return;
      const battleInstanceId = sources.battleKey || id3;
      const battleInput = sources.input;
      const target2 = pages.sandbox.querySelector("[data-sandbox-mount]");
      const restart = ({ seed }) => {
        const next = hydrateFromSources(battleInput, { seed, throwOnValidation: true }).state;
        return applyNormalization(next, operations(battleInstanceId));
      };
      gameMount = (options.mount || mount)(target2, {
        instanceId: battleInstanceId,
        storage,
        state,
        customBattle: { seed: sources.seed, restart, restoreSaved },
        onVictory() {
          syncSettings();
          if (config.autoDeliverBattleReport !== false) void deliverBattleReport();
        }
      });
      const game = gameMount?.api;
      if (game?.subscribe) {
        let seen = game.getBattleState().logs.length;
        stopTerrainNotices = game.subscribe(() => {
          const logs = game.getBattleState().logs;
          const unresolved = logs.slice(seen).filter((log) => log.type === "terrain_unresolved").map((log) => log.text);
          seen = logs.length;
          if (unresolved.length) notify("\u5730\u5F62\u6548\u679C", "", null, false, { tone: "error", unresolved });
        });
      }
    }
    function showError(error2) {
      const node3 = pages.sandbox.querySelector("[data-status]");
      if (node3) node3.textContent = `\u9519\u8BEF\uFF1A${error2?.message || error2}`;
    }
    function filterResolved(stored, records, retained = batches(activeBattleKey)) {
      const warnings = sources.warnings ??= [];
      const remaining = remainingDiagnostics(warnings, stored, records, retained);
      warnings.splice(0, warnings.length, ...remaining);
      diagnostics.warnings = warnings;
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
    async function scan({ rehydrate = false } = {}) {
      const epoch = ++scanEpoch;
      const node3 = pages.sandbox.querySelector("[data-status]");
      if (node3) node3.textContent = "\u6B63\u5728\u8BFB\u53D6 MVU\u3001\u6700\u65B0\u697C\u5C42\u5E76\u8F6C\u6362\u2026";
      try {
        const chat = chatId(host);
        const messages = await tavernMessages(host);
        if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
        let entryId = selectedMessageId;
        if (entryId == null && selectedBattleText) {
          const entryIndex = messages.findLastIndex((message) => message?.role !== "user" && !message?.is_user && extractTag(messageContent(message), ["battle_init"])?.trim() === selectedBattleText.trim());
          if (entryIndex >= 0) entryId = messageMeta(messages[entryIndex], entryIndex).messageId;
        }
        const candidate = sourceBundle({}, messages, chat, entryId);
        const key4 = candidate.battleKey;
        foldBattleEntries();
        if (!rehydrate && key4 && activeBattleKey === key4 && gameMount) {
          refreshPortraits(currentState, epoch);
          if (node3) node3.textContent = `\u5DF2\u7EED\u63A5\u5F53\u524D\u6218\u5C40 \xB7 ${scanStatus}`;
          return;
        }
        if ((rehydrate || activeBattleKey !== key4) && aiController) {
          const finished = aiFinished;
          aiController.abort();
          await finished;
          if (epoch !== scanEpoch || disposed) return;
        }
        const savedBattle = Boolean(key4 && readBattleStorage(key4, "fated-tactical/battle-v1")?.kind === "battle");
        const hydrated = await hydrate(epoch, candidate, rehydrate);
        if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
        const nextState = hydrated?.state ?? null;
        const fresh = key4 ? await characterRecords(sources, hydrated) : {};
        if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
        syncSettings();
        const ids = Object.keys(fresh), stored = rehydrate ? {} : { ...config.charSnapshots[key4] ?? {} };
        const removed = Object.keys(stored).filter((id4) => !fresh[id4]);
        diagnostics.removedCharacters = removed;
        for (const id4 of removed) delete stored[id4];
        const rawWarnings = sources.warnings ?? [];
        const kept = [];
        let replay = nextState;
        for (const batch of rehydrate ? [] : batches(key4)) {
          const owners = Object.entries(batch.hashes);
          const matchesHash = ([id4, hash2]) => fresh[id4]?.hash === hash2;
          const sameInput = batch.receipts ? owners.every(matchesHash) : owners.some(matchesHash);
          const sameDiagnostics = batch.receipts?.length && batch.receipts.every(({ unitId, key: key5 }) => fresh[unitId] && rawWarnings.some((w) => w.unitId === unitId && warningKey(w) === key5));
          if (!sameInput && !sameDiagnostics) continue;
          if (batch.guards && !batch.guards.every(([path, value]) => (fingerprintAt(replay, path) ?? null) === value)) continue;
          try {
            replay = applyPatch(replay, batch.patch, true);
            kept.push(batch);
          } catch (_) {
          }
        }
        const invalid = batches(key4).length !== kept.length;
        const remaining = remainingDiagnostics(rawWarnings, stored, fresh, kept);
        const changed = normalizationCandidates(fresh, stored, remaining);
        toast.hidden = true;
        currentState = nextState ? applyNormalization(nextState, kept.flatMap((batch) => batch.patch)) : null;
        if (invalid) persistSettings({ normalizationBatches: { ...config.normalizationBatches, [key4]: kept } });
        mountState(currentState, savedBattle && !rehydrate);
        refreshPortraits(currentState, epoch);
        activeBattleKey = key4;
        characters = fresh;
        for (const id4 of changed) if (stored[id4]?.hash !== fresh[id4].hash) stored[id4] = { hash: fresh[id4].hash, sourceKind: fresh[id4].sourceKind, at: Date.now(), normalized: false };
        if (key4 && (rehydrate || changed.length || removed.length)) persistSettings({ charSnapshots: { ...config.charSnapshots, [key4]: stored } });
        if ((rehydrate || config.rosterSelection === null) && ids.length) persistSettings({ rosterSelection: ids });
        filterResolved(stored, fresh, kept);
        const live = liveState();
        for (const unit of Object.values(live?.units ?? {})) if (config.instances[unit.id]) Object.assign(config.instances[unit.id], unit);
        const firstEntry = !rehydrate && currentState && key4 && !savedBattle && !enteredBattles.has(key4);
        if (key4 && currentState) enteredBattles.add(key4);
        scanStatus = firstEntry && changed.length ? `\u5F85\u6807\u51C6\u5316 ${changed.length} \u4E2A\u89D2\u8272` : "\u53EF\u624B\u52A8\u6807\u51C6\u5316\u6240\u9009\u89D2\u8272";
        renderInstances();
        if (firstEntry && changed.length) void runNormalize(changed, { force: false });
        if (node3) node3.textContent = currentState ? `\u626B\u63CF\u5B8C\u6210\uFF1A${Object.values(currentState.units || {}).map((unit) => `${unit.name}(${unit.id})`).join("\u3001")} \xB7 ${scanStatus}` : "\u626B\u63CF\u5B8C\u6210\uFF08\u672A\u627E\u5230\u53EF\u6302\u8F7D\u7684\u6218\u5C40\uFF09\u3002";
      } catch (e) {
        diagnostics = { ...diagnostics, phase: "scan-error", error: e?.stack || e?.message || String(e) };
        try {
          console.error("[fated-tactical] scan failed", diagnostics);
        } catch (_) {
        }
        const diagnosticNode = pages.instances.querySelector("[data-diagnostics]");
        if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
        showError(e);
        notify("\u6218\u5C40\u52A0\u8F7D\u5931\u8D25", e.message, () => scan({ rehydrate }));
      }
    }
    async function deliverBattleReport() {
      const mount3 = gameMount;
      try {
        const result = mount3?.exportBattleReportText?.() || options.game?.exportBattleReportText?.();
        if (!result?.trim()) throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u4EA4\u4ED8\u7684\u6218\u62A5\u3002");
        const textarea = doc.querySelector("#send_textarea");
        const clipboard = doc.defaultView?.navigator?.clipboard;
        if (textarea) {
          textarea.value = result;
          textarea.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
          clipboard?.writeText(result).catch(() => {
          });
        } else {
          if (!clipboard) throw new Error("\u627E\u4E0D\u5230\u804A\u5929\u8F93\u5165\u6846\uFF0C\u4E5F\u65E0\u6CD5\u5199\u5165\u526A\u8D34\u677F\u3002");
          await clipboard.writeText(result);
        }
        if (disposed || gameMount !== mount3) return;
        pages.sandbox.querySelector("[data-status]").textContent = result;
        closePanel();
      } catch (error2) {
        showError(error2);
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
      const report = el(doc, "button", { type: "button" }, "\u6218\u62A5\u4EA4\u4ED8");
      const refresh = el(doc, "button", { type: "button" }, "\u91CD\u65B0\u626B\u63CF");
      actions2.append(report, refresh);
      page.append(actions2);
      const autoDeliver = el(doc, "input", { type: "checkbox", "data-auto-deliver-report": "" });
      autoDeliver.checked = config.autoDeliverBattleReport !== false;
      const deliveryLabel = el(doc, "label");
      deliveryLabel.append(autoDeliver, " \u80DC\u8D1F\u5DF2\u5B9A\u65F6\u81EA\u52A8\u4EA4\u4ED8\u6218\u62A5");
      actions2.append(deliveryLabel);
      on(autoDeliver, "change", () => persistSettings({ autoDeliverBattleReport: autoDeliver.checked }));
      const hideLauncher = el(doc, "input", { type: "checkbox", "data-hide-launcher": "" });
      hideLauncher.checked = Boolean(config.hideLauncher);
      const hideLabel = el(doc, "label");
      hideLabel.append(hideLauncher, " \u9690\u85CF\u60AC\u6D6E\u6309\u94AE\u5230\u9B54\u672F\u68D2\u83DC\u5355");
      actions2.append(hideLabel);
      on(hideLauncher, "change", () => {
        persistSettings({ hideLauncher: hideLauncher.checked });
        updateMagic();
      });
      on(refresh, "click", () => scan().catch(showError));
      on(report, "click", deliverBattleReport);
    }
    askAI = async (kind, requestText = "", sessionId = kind === "chat" ? aiSessions.active().id : void 0, records) => {
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
      const key4 = activeBattleKey;
      const controller2 = new AbortController();
      aiController = controller2;
      let finish;
      aiFinished = new Promise((resolve) => {
        finish = resolve;
      });
      aiPage?.setBusy(true);
      const normalizeButton = pages.instances.querySelector("[data-normalize]");
      if (normalizeButton) normalizeButton.disabled = true;
      const timeout = setTimeout(() => controller2.abort(new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u9152\u9986\u4E3B\u63A5\u53E3\u6216\u72EC\u7ACB API")), config.timeoutMs ?? 6e4);
      const label = normalize ? "\u6807\u51C6\u5316" : "AI \u8C03\u6574";
      const retryRequest = () => normalize ? runNormalize(Object.keys(records), { force: true, sessionId: sessionId ?? null }) : askAI(kind, requestText, sessionId);
      if (normalize) notify("\u6B63\u5728\u6807\u51C6\u5316\u4E2D\u2026", "", null, true);
      else toast.hidden = true;
      let receivedPatch = normalize, replyText = "", unresolved = [], appliedCount = 0;
      const scopedWarnings = normalize ? warningsForUnit(sources.warnings, Object.keys(records)) : [];
      try {
        if (normalize && !liveState()) {
          if (!session) {
            toast.hidden = true;
            return;
          }
          throw new Error("\u6CA1\u6709\u53EF\u6807\u51C6\u5316\u7684\u6218\u5C40\uFF0C\u8BF7\u5148\u626B\u63CF\u6C99\u76D8");
        }
        let prompts = prepareMessages(kind, requestText, true, records && Object.keys(records));
        const sentWarnings = scopedWarnings.filter((w) => prompts.some((m) => m.content.includes(JSON.stringify(w.message))));
        if (!normalize) {
          prompts = [...prompts, ...history, { role: "user", content: requestText }];
          lastSent = prompts;
          publishMessages(prompts, kind);
        }
        if (!prompts.length) throw new Error("\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u63D0\u793A\u8BCD\uFF0C\u8BF7\u5728\u63D0\u793A\u8BCD\u7EC4\u88C5\u9875\u542F\u7528\u6709\u5185\u5BB9\u7684\u69FD\u4F4D");
        const streamUpdate = (snapshot, done, info) => {
          if (disposed || controller2.signal.aborted || aiController !== controller2 || activeBattleKey !== key4) return;
          if (!normalize) {
            if (snapshot) updateReply({ content: snapshot }, false);
            return;
          }
          noticeBody.textContent = info?.isHeartbeat ? `\u5DF2\u7B49\u5F85 ${info.elapsedSec} \u79D2\uFF0C\u8FDE\u63A5\u4ECD\u5728\u4FDD\u6301\u2026` : done ? "\u5DF2\u6536\u5230\u5B8C\u6574\u54CD\u5E94\uFF0C\u6B63\u5728\u6821\u9A8C\u2026" : `\u5DF2\u6536\u5230 ${snapshot.length} \u5B57\u7B26\u2026`;
          noticeBody.hidden = false;
        };
        const cancelled = new Promise((_, reject) => controller2.signal.addEventListener("abort", () => reject(controller2.signal.reason), { once: true }));
        const validate = options.validateState || validateState;
        let patch, nextState, combined, solved2, baseline;
        for (let attempt = 0; ; attempt++) {
          replyText = "";
          unresolved = [];
          const reply = await Promise.race([
            requestTavernAI(host, config, prompts, options.fetch, controller2.signal, streamUpdate),
            cancelled
          ]);
          controller2.signal.throwIfAborted();
          if (disposed || aiController !== controller2 || key4 !== activeBattleKey) return;
          try {
            const parsed = parseAIResponse(reply);
            patch = parseJSONPatch(reply) ?? (normalize ? null : parsed.patch);
            replyText = normalize ? patch ? JSON.stringify(parsed.data, null, 2) : "" : reply;
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
            if (normalize) {
              solved2 = resolvedDiagnostics(sentWarnings, records, patch, { ...parsed.data, unresolved });
              patch = patch.map(({ resolves, ...operation }) => operation);
            }
            nextState = (options.applyPatch ?? applyPatch)(liveState(), patch, normalize);
            validate(nextState);
            if (normalize && patch.length) {
              refreshOpeningInitiative(nextState);
              combined = [...operations(key4), ...patch];
              baseline = hydrateFromSources(sources.input, { throwOnValidation: true }).state;
              validate(applyNormalization(baseline, combined));
            }
            syncEquipmentEffects(nextState);
            refreshOutcome(nextState);
            validate(nextState);
            break;
          } catch (error2) {
            if (!normalize || attempt > 0) throw error2;
            notify("\u6B63\u5728\u6807\u51C6\u5316\u4E2D\u2026", "\u6A21\u578B\u6B63\u5728\u4FEE\u6B63\u8865\u4E01\u683C\u5F0F", null, true);
            prompts = [...prompts, { role: "user", content: `\u4E0A\u4E00\u6761\u8F93\u51FA\u6821\u9A8C\u5931\u8D25\uFF08${error2.message}\uFF09\u3002\u6309\u4E0A\u9762\u7684\u4F8B\u5B50\u4F7F\u7528\u7CBE\u786E ID \u548C\u8DEF\u5F84\uFF0C\u91CD\u65B0\u8F93\u51FA\u5B8C\u6574 JSON \u5BF9\u8C61\u3002${replyText ? `
\u4E0A\u4E00\u6761\u8865\u4E01\uFF1A${replyText.slice(0, 3500)}` : ""}` }];
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
        if (combined) {
          const stored = { ...config.charSnapshots[key4] }, hashes = {};
          for (const [id4, rec] of Object.entries(records)) {
            const previous = stored[id4]?.hash === rec.hash ? stored[id4].resolvedWarnings ?? [] : [];
            stored[id4] = { ...rec, at: Date.now(), normalized: true, resolvedWarnings: previous };
            hashes[id4] = rec.hash;
          }
          const before = applyPatch(baseline, operations(key4), true);
          const additions = solved2.length ? [{
            patch,
            hashes,
            receipts: solved2.map((w) => ({ unitId: w.unitId, key: warningKey(w) })),
            guards: [.../* @__PURE__ */ new Set([...patch.map((op) => op.path.split("/").slice(0, 3).join("/")), ...solved2.map((w) => w.originPath).filter(Boolean)])].map((path) => [path, fingerprintAt(before, path) ?? null])
          }] : patch.map((op) => {
            const [, table4, target2] = op.path.split("/");
            const owners = Object.keys(records).filter((id4) => {
              const u = nextState.units[id4];
              const items = [u?.weapon, u?.mainHand, u?.offHand, u?.shield, ...u?.gear ?? []];
              if (table4 === "units") return target2 === id4;
              if (table4 === "skills") return u?.skills?.includes(target2);
              if (table4 === "items") return items.includes(target2);
              if (table4 === "equipment") return items.some((k) => nextState.items[k]?.templateId === target2);
              return false;
            });
            return { patch: [op], hashes: owners.length ? Object.fromEntries(owners.map((id4) => [id4, hashes[id4]])) : hashes };
          });
          persistSettings({ charSnapshots: { ...config.charSnapshots, [key4]: stored }, normalizationBatches: { ...config.normalizationBatches, [key4]: [...batches(key4), ...additions] } });
          filterResolved(stored, characters);
          scanStatus = `\u5DF2\u6807\u51C6\u5316 ${Object.keys(records).length} \u4E2A\u89D2\u8272`;
          renderInstances();
          prepareMessages();
        }
        if (normalize) unresolved = pendingDiagnostics(scopedWarnings.filter((w) => !solved2.includes(w)), unresolved);
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
        if (normalize) unresolved = pendingDiagnostics(appliedCount ? scopedWarnings.filter((w) => !solved?.includes(w)) : scopedWarnings, unresolved);
        const partial = assistantMessage?.content || replyText;
        updateReply({ status: status2, content: aborted ? partial ?? "" : [partial, `\u9519\u8BEF\uFF1A${detail}`].filter(Boolean).join("\n\n") });
        if (receivedPatch) postStatus(`${label}${aborted ? "\u5DF2\u4E2D\u6B62" : "\u5931\u8D25"}\uFF1A${detail}${unresolved.length ? `\uFF1B\u672A\u89E3\u51B3\uFF1A${unresolved.join("\uFF1B")}` : ""}`, status2);
        if (normalize && !disposed) notify(
          `${label}${aborted ? "\u5DF2\u4E2D\u6B62" : "\u5931\u8D25"}`,
          detail,
          aborted ? null : retryRequest,
          false,
          { tone: aborted ? "neutral" : "error", applied: appliedCount, unresolved, raw: replyText }
        );
      } finally {
        clearTimeout(timeout);
        if (aiController === controller2) aiController = null;
        if (!disposed) {
          aiPage?.setBusy(false);
          renderInstances();
        }
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
      make: (tag, attrs3, content2) => el(doc, tag, attrs3, content2),
      on,
      sessions: aiSessions,
      send: (message) => askAI("chat", message),
      stop: () => aiController?.abort(new DOMException("\u5DF2\u53D6\u6D88", "AbortError"))
    });
    updateMagic();
    bindEventBus();
    foldBattleEntries();
    if (typeof MutationObserver === "function" && doc.body) {
      battleObserver = new MutationObserver(() => foldBattleEntries());
      battleObserver.observe(doc.body, { childList: true, subtree: true });
    }
    const api = { version: TAVERN_VERSION, open, close: closePanel, dispose, scan, getConfig: () => clone2(config), getDiagnostics: () => clone2(diagnostics), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, getSources: () => clone2(sources), getState: () => {
      const state = clone2(liveState());
      if (state) Object.defineProperty(state, "warnings", { value: clone2(sources.warnings ?? []) });
      return state;
    } };
    function dispose() {
      if (disposed) return;
      disposed = true;
      stopTerrainNotices?.();
      aiController?.abort();
      battleObserver?.disconnect();
      try {
        controller?.abort();
      } catch (_) {
      }
      for (const remove2 of listeners.splice(0)) remove2();
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
  var BATTLE_INIT_DISPLAY_REPLACEMENT = '<details class="fated-battle-entry" data-fated-battle-entry="true"><summary>\u2694 \u8FDB\u5165\u6218\u573A \xB7 \u70B9\u51FB\u5C55\u5F00\u5165\u53E3</summary><div class="fated-battle-meta">\u5DF2\u8BC6\u522B battle_init \xB7 \u53EF\u5728\u63A7\u5236\u53F0\u52A0\u8F7D\u6218\u5C40</div><pre class="fated-battle-source">$1</pre><button type="button" class="fated-battle-enter" data-fated-battle-open="true">\u6253\u5F00\u6218\u573A\u63A7\u5236\u53F0</button><script>(function(){var b=document.currentScript.previousElementSibling;if(!b)return;b.addEventListener("click",function(){if(typeof eventEmit!=="function")return;var selector="[mesid], [data-message-id], [data-mesid]",floor=b.closest(selector);try{floor=floor||window.frameElement?.closest(selector);}catch(_){}eventEmit("fated_tactical:open_ui",{source:"battle_init",messageId:floor?.getAttribute("mesid")??floor?.dataset.messageId??floor?.dataset.mesid,battleText:b.previousElementSibling.textContent});});})();<\/script></details>';
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

  // src/tavern/main.js
  if (typeof window !== "undefined") {
    const host = (() => {
      try {
        return window.parent?.document ? window.parent : window;
      } catch {
        return window;
      }
    })();
    mountTavernOverlay({ host, mount, hydrateFromSources, validateState, buildMvuJsonPatch });
  }
  return __toCommonJS(main_exports);
})();
