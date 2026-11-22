import { beginBattle } from '../core/combat.js';
import { calculatePrebattleResources } from '../core/prebattle_resources.js';
import { createPool } from '../core/vm-pools.js';
import { EQUIPMENT, SKILLS } from './catalog.js';
import { fields, validateState, statusTemplateTable, statusValue } from '../api/validation.js';

export const SCENARIOS = Object.freeze({
  ruins: { title: '废墟伏击战', description: '折断的石墙挡住视线。先处理受伤的斥候，试用焰印，再从侧翼绕过路障。', seed: 17 },
  altar: { title: '高台祭坛夺取战', description: '坡道是上台的捷径；激活祭坛可获得护盾与疾走，高台远射有额外射程。', seed: 43 },
  boss: { title: 'BOSS 与杂兵混编战', description: '守门巨像护甲厚、体型大。先拆援军，再用净化、穿甲和击退分摊压力。', seed: 83 },
});

const own = (obj, key) => Object.hasOwn(obj, key);
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)
  && !own(Object.prototype, id) && id !== 'prototype';
const entries = record => {
  if (!object(record) || Object.keys(record).length > 200 || !Object.keys(record).every(safeId)) throw new Error('跨战档案 ID 无效');
  return Object.entries(record);
};
const gravefire = {
  name: '墓火余烬', templateId: 'gravefire', tags: ['fire'], tier: 1, vars: {}, mods: [],
  area: { shape: 'circle', radius: 1 }, follow: false, remainingTurns: 2, persistent: false,
  rules: [{ id: 'gravefire-tick', hook: 'turn_start',
    program: [{ op: 'damage', target: 'self', amount: 2, damageType: 'energy', direct: false }] }],
};
const colossusDeath = {
  id: 'colossus-death', hook: 'on_death',
  program: [{ op: 'spawn', entityKind: 'zone', at: 'self', spec: gravefire }],
};

function equipItem(state, id, templateId, sourceId, carriedAmounts = {}) {
  for (const poolId of Object.values(state.items[id]?.pools ?? {})) delete state.pools[poolId];
  const { name, tags = [], tier = 1, vars = {}, mods = [], rules = [], pools = {} } = state.equipment[templateId];
  state.items[id] = { id, templateId, sourceId, ...structuredClone({ name, tags, tier, vars, mods, rules }), pools: {} };
  for (const [key, { cap, initial = cap, reloadable = false }] of Object.entries(pools)) {
    createPool(state, { key, ownerKind: 'item', ownerId: id, max: cap, current: carriedAmounts[key] ?? initial, reloadable });
  }
  return id;
}
function importCarry(state, value) {
  // v1 carry records only had weapon; normalize them into mainHand without changing replay data.
  fields(value, ['kind', 'version', 'items', 'units'], ['statusTemplates', 'pools']);
  if (value.version !== 1 || value.kind !== 'persistent') throw new Error('无效的跨战档案');
  const carry = structuredClone(value);
  if (own(carry, 'statusTemplates')) {
    statusTemplateTable(carry.statusTemplates);
    state.statusTemplates = carry.statusTemplates;
  }
  for (const [id, item] of entries(carry.items)) {
    if (!object(item) || item.id !== id || !own(state.equipment, item.templateId)) throw new Error(`无效的跨战装备：${id}`);
    if (own(state.items, id) && state.items[id].templateId !== item.templateId) throw new Error(`跨战装备模板冲突：${id}`);
    const amounts = { ...item.counters };
    for (const [key, poolId] of Object.entries(item.pools ?? {})) {
      const amount = carry.pools?.[poolId]?.current;
      if (Number.isFinite(amount)) amounts[key] = amount;
    }
    equipItem(state, id, item.templateId, item.sourceId ?? null, amounts);
  }
  const assigned = new Set();
  const imported = [];
  for (const [id, unit] of entries(carry.units)) {
    if (!object(unit) || !['weapon','gear','statuses'].every(slot => own(unit, slot)) || !Array.isArray(unit.gear)
      || Object.keys(unit).some(key => !['weapon','gear','statuses','mainHand','offHand','shield'].includes(key))) throw new Error(`无效的跨战单位：${id}`);
    const statuses = Object.fromEntries(entries(unit.statuses).map(([key, status]) => {
      if (!object(status) || status.durationType !== 'persistent') throw new Error(`跨战状态必须常驻：${key}`);
      statusValue(status, key, state);
      return [key, status];
    }));
    const mainHand = unit.mainHand ?? unit.weapon;
    const slots = [[mainHand, 'mainHand'], [unit.offHand ?? null, 'offHand'], [unit.shield ?? null, 'shield'],
      ...unit.gear.map(instanceId => [instanceId, 'gear'])];
    for (const [instanceId, slot] of slots) {
      if (instanceId === null && slot !== 'gear') continue;
      if (!safeId(instanceId) || !own(carry.items, instanceId) || assigned.has(instanceId)) throw new Error(`跨战装备归属无效：${instanceId}`);
      const template = state.equipment[state.items[instanceId].templateId];
      const allowed = slot === 'shield' ? template.kind === 'shield' : slot === 'gear' ? !own(template, 'damage')
        : own(template, 'damage') || slot === 'offHand' && template.kind === 'consumable';
      if (!allowed) throw new Error(`跨战装备槽位无效：${instanceId}`);
      assigned.add(instanceId);
    }
    if (own(state.units, id)) imported.push([id, { statuses, weapon: mainHand, mainHand, offHand: unit.offHand ?? null, shield: unit.shield ?? null, gear: unit.gear }]);
  }
  // Carried ownership is authoritative. An absent unit's slot becomes inventory,
  // and a different scenario's default slot must not duplicate that instance.
  for (const u of Object.values(state.units)) {
    for (const slot of ['weapon', 'mainHand', 'offHand', 'shield']) if (assigned.has(u[slot])) u[slot] = null;
    u.gear = u.gear.filter(i => !assigned.has(i));
  }
  for (const [id, patch] of imported) Object.assign(state.units[id], patch);
}

export function buildScenario(request = 'ruins') {
  if (request?.kind === 'custom_state' && object(request.state)) return structuredClone(request.state);
  if (typeof request === 'string') request = { scenarioId: request };
  if (!object(request) || !Object.keys(request).every(key => ['scenarioId', 'seed', 'mode', 'ruleset', 'persistentSnapshot'].includes(key))) throw new Error('无效的开局参数');
  const { scenarioId = 'ruins', ruleset = 'protocol', persistentSnapshot } = request;
  if (typeof scenarioId !== 'string' || !own(SCENARIOS, scenarioId)) throw new Error('未知预设关卡');
  const { title, seed: defaultSeed } = SCENARIOS[scenarioId];
  const seed = request.seed ?? defaultSeed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !['protocol','sandbox'].includes(ruleset)) throw new Error('无效的种子或行动规则');
  const state = { scenarioId, title, mode:'split', ruleset, round: 1, turn: 0, order: [], units: {}, items: {},
    equipment: structuredClone(EQUIPMENT), skills: structuredClone(SKILLS),
    grid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: 'floor', z: 0 }))),
    covers: {}, interactives: {}, zones: {}, pools: {}, rng: seed, logs: [], outcome: null };
  function unit(id, name, team, x, y, weapon, skills, options = {}) {
    const { hp = 32, agi = 5, str = 4, con = 4, int = 4, spi = 4, armor = 1, size = 1, gear = [],
      weaponId = `${id}-weapon`, offHandTemplate = null, shieldTemplate = null, bodyLengthM = 1.7, mc = 1, rules = [] } = options;
    const equip = (itemId, templateId) => equipItem(state, itemId, templateId, id);
    const offHand = offHandTemplate ? equip(`${id}-offhand`, offHandTemplate) : null;
    const shield = shieldTemplate ? equip(`${id}-shield`, shieldTemplate) : null;
    const stance = shield ? 'sword_shield' : offHandTemplate === 'potion' ? 'attunement' : offHand ? 'dual_wield' : state.equipment[weapon]?.weaponClass === 'greatsword' ? 'greatsword' : 'light_blade';
    const resources = ruleset === 'protocol' ? calculatePrebattleResources({ stats:{str, agi, con, int, spi}, tier:1, bodyLengthM }).resources : null;
    const hpValue = resources?.hp.current ?? hp, mpValue = resources?.mp.current ?? 14, spValue = resources?.sp.current ?? 10;
    state.units[id] = { id, name, team, x, y, facing: [team === 'blue' ? 1 : -1, 0], hp:hpValue, maxHp:resources?.hp.max ?? hpValue,
      mainHand: weaponId, offHand, shield, tier: 1, bodyLengthM, mc, templateId: id, tags: [], vars: {}, mods: [], rules,
      bonusDice: 0, penaltyDice: 0, intent: 'normal', nonLethal: false, stance, greatswordMode: 'offensive', parryQuota: stance === 'greatsword' ? 2 : 0, parryRefunded: false, attunementCharges: stance === 'attunement' ? 2 : 0, moraleType: 'standard',
      mp: mpValue, maxMp:resources?.mp.max ?? mpValue, sp: spValue, maxSp:resources?.sp.max ?? spValue, ap: 0, used: { attack: 0, action: 0 },
      stats: { str, agi, con, int, spi }, armor, size, move: 3, statuses: {},
      weapon: equip(weaponId, weapon), gear: gear.map(templateId => equip(`${id}-${templateId}`, templateId)), skills };
  }
  function wall(x, y) { state.grid[y][x].kind = 'wall'; }
  function cover(id, x, y, material, hp, shielding) {
    state.covers[id] = { id, name: `${material}掩体`, material, x, y, hp, maxHp: hp, cover: shielding };
  }
  function interact(id, x, y, kind) {
    state.interactives[id] = { id, name: kind === 'barrel' ? '余烬爆桶' : '星辉祭坛', x, y, kind, spent: false };
  }
  function heroes(x, y) {
    unit('swordsman', '岚 · 噬魂剑客', 'blue', x, y, 'soulblade', ['brand', 'surge', 'challenge', 'armor'],
      { hp: 44, agi: 21, str: 7, con: 6, gear: ['frostplate'], weaponId: 'soulblade-lan' });
    unit('ranger', '栖 · 游侠', 'blue', x, y + 2, 'revolver', ['shift', 'fan', 'blink'], { hp: 35, agi: 9, offHandTemplate:'shortblade' });
    unit('oracle', '绮 · 圣咏术师', 'blue', x - 1, y + 1, 'staff', ['hymn', 'cleanse', 'frost', 'ward', 'beam'],
      { hp: 34, int: 7, spi: 7, gear: ['hymnal'], offHandTemplate:'potion' });
    /* The explicit slot configuration demonstrates attunement. */
  }
  if (scenarioId === 'ruins') {
    heroes(1, 2);
    unit('scout', '受伤斥候', 'red', 3, 2, 'bloodfang', ['fan'], { hp: 4 });
    unit('gunner', '废墟枪手', 'red', 7, 3, 'crossbow', ['challenge'], { hp: 27, agi: 7 });
    unit('raider', '伏击首领', 'red', 6, 6, 'bloodfang', ['blink', 'fan'], { hp: 38, str: 5, agi: 8 });
    [[5, 1], [5, 2], [5, 3], [5, 4], [4, 6], [4, 7], [3, 7]].forEach(([x, y]) => wall(x, y));
    cover('C1', 4, 2, '砂岩', 16, 3); cover('C2', 2, 5, '旧木', 9, 2); cover('C3', 8, 4, '石砖', 19, 3); cover('C4', 6, 8, '旧铁', 13, 2);
    interact('I1', 2, 3, 'altar'); interact('I2', 7, 6, 'barrel'); interact('I3', 8, 2, 'barrel'); interact('I4', 3, 8, 'altar');
  } else if (scenarioId === 'altar') {
    heroes(1, 3);
    for (let y = 2; y <= 6; y++) for (let x = 4; x <= 7; x++) state.grid[y][x].z = 2;
    state.grid[4][3] = { kind: 'slope', z: 1 };
    state.grid[5][8] = { kind: 'slope', z: 1 };
    wall(4, 2); wall(7, 6); wall(2, 7); wall(2, 8);
    unit('sentinel', '祭坛卫士', 'red', 4, 4, 'pike', ['challenge', 'armor'], { hp: 39, armor: 3 });
    unit('seer', '高台咒师', 'red', 6, 3, 'staff', ['toxin', 'curse', 'beam'], { hp: 29 });
    unit('lookout', '塔顶弩手', 'red', 8, 5, 'crossbow', ['shift'], { hp: 29 });
    cover('C1', 5, 3, '祭石', 17, 3); cover('C2', 3, 5, '旧木', 10, 2); cover('C3', 8, 3, '青铜', 20, 3); cover('C4', 6, 6, '砂岩', 14, 2);
    interact('I1', 5, 4, 'altar'); interact('I2', 8, 4, 'barrel'); interact('I3', 4, 6, 'barrel'); interact('I4', 2, 2, 'altar');
  } else {
    heroes(1, 4);
    unit('colossus', '铜棺守门巨像', 'red', 6, 4, 'pike', ['surge', 'challenge', 'armor'],
      { hp: 140, armor: 5, size: 3, str: 9, con: 8, bodyLengthM: 10, mc: 2, rules: [colossusDeath] });
    unit('acolyte', '棺庭祭司', 'red', 8, 5, 'staff', ['ward', 'hymn', 'curse'], { hp: 32, spi: 7 });
    unit('knife', '墓道刺客', 'red', 5, 7, 'bloodfang', ['blink', 'fan'], { hp: 29, agi: 8 });
    unit('rifle', '重弩侍从', 'red', 8, 2, 'crossbow', ['shift'], { hp: 28 });
    [[4, 3], [4, 5], [4, 6], [7, 3], [7, 6], [1, 1]].forEach(([x, y]) => wall(x, y));
    cover('C1', 3, 4, '棺石', 20, 3); cover('C2', 5, 2, '钢板', 18, 3); cover('C3', 5, 5, '木箱', 10, 2); cover('C4', 8, 6, '棺石', 20, 3);
    state.zones.Z1 = { ...structuredClone(gravefire), id: 'Z1', name: '墓火领域', sourceId: null,
      area: { ...gravefire.area, center: { x: 7, y: 4 } }, remainingTurns: 99 };
    interact('I1', 6, 5, 'barrel'); interact('I2', 4, 7, 'altar'); interact('I3', 7, 2, 'barrel'); interact('I4', 2, 4, 'altar');
  }
  // A spare of the same template stays in the inventory, not in a unit slot.
  equipItem(state, 'soulblade-spare', 'soulblade', null);
  if (persistentSnapshot !== undefined) {
    importCarry(state, persistentSnapshot);
    state.order = Object.keys(state.units);
    validateState(state);
  }
  return beginBattle(state);
}
