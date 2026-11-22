import { getStatusTemplate, grantStatus, patchStatus } from '../core/combat.js';
import { evaluateExpr } from '../core/formula.js';
import { getPool, initializeUnitPools, unlinkPools, updatePoolCurrent } from '../core/vm-pools.js';
import { recordVM } from '../core/vm-runtime.js';
import { attrs, checkOptional, inGrid, defineStatus, equipmentTemplate, fields, has, id, int, own,
  plain, requireThat as check, skillTemplate, statusValue, unitValue, validateCell, zoneValue } from './validation.js';

const get = (table, key, label) => { check(has(table, key), label); return table[key]; };
const nonempty = patch => check(plain(patch) && Object.keys(patch).length > 0, 'patch');
const builtins = ['hp', 'mp', 'sp'];
const deleteOwnedPools = (state, owner) => {
  for (const poolId of Object.values(owner.pools ?? {})) delete state.pools[poolId];
};
const statusPatchFields = ['remainingTurns', 'durationType', 'stackMode', 'stacks', 'vars', 'mods', 'expireOn'];

const commands = {
  set_unit_stat(s, c) {
    fields(c, ['type','unitId','patch']);
    const u = get(s.units, c.unitId, 'unitId');
    nonempty(c.patch);
    fields(c.patch, [], ['hp','mp','sp','ap','x','y','team','stats','weapon','mainHand','offHand','shield','bodyLengthM','tier','mc','bonusDice','penaltyDice','intent','nonLethal','stance','moraleType','moraleState','greatswordMode','parryQuota','parryRefunded','attunementCharges','blockMode','deathrattle','maneuvers']);
    for (const k of ['hp','mp','sp','ap','x','y','team','weapon','mainHand','offHand','shield','bodyLengthM','tier','mc','bonusDice','penaltyDice','intent','nonLethal','stance','moraleType','moraleState','greatswordMode','parryQuota','parryRefunded','attunementCharges','blockMode','deathrattle','maneuvers']) if (own(c.patch, k)) u[k] = c.patch[k];
    if (own(c.patch, 'stats')) {
      nonempty(c.patch.stats);
      fields(c.patch.stats, [], attrs);
      Object.assign(u.stats, c.patch.stats);
    }
    if (own(c.patch, 'mainHand')) u.weapon = c.patch.mainHand;
    if (own(c.patch, 'weapon')) u.mainHand = c.patch.weapon;
    if (own(c.patch, 'bonusDice')) u.bonusDice = Math.min(2, Math.max(0, c.patch.bonusDice));
    if (own(c.patch, 'penaltyDice')) u.penaltyDice = Math.min(1, Math.max(0, c.patch.penaltyDice));
    unitValue(u, u.id, s);
    for (const key of builtins) if (own(c.patch, key) && u.pools?.[key]) updatePoolCurrent(s, u.pools[key], 'set', u[key]);
  },
  define_status_template(s, c) {
    fields(c, ['type','template']);
    defineStatus(s, c.template?.id, c.template);
  },
  patch_status(s, c) {
    fields(c, ['type','unitId','statusId','patch']);
    const unit = get(s.units, c.unitId, 'unitId');
    const status = get(unit.statuses, c.statusId, 'statusId');
    if (!own(status, 'templateId')) return patchStatus(s, c.unitId, c.statusId, c.patch);
    nonempty(c.patch);
    fields(c.patch, [], statusPatchFields);
    const next = { ...status, ...c.patch };
    if (own(c.patch, 'vars')) {
      check(plain(c.patch.vars), 'VM 状态变量');
      next.vars = { ...status.vars, ...c.patch.vars };
    }
    statusValue(next, c.statusId, s, unit.id);
    unit.statuses[c.statusId] = next;
    recordVM(s, unit, 'status_patch', `${unit.name}的${next.name}参数已更新`, { targetId: unit.id, statusId: next.id });
  },
  upsert_status(s, c) {
    fields(c, ['type','unitId','statusId'], ['options']);
    const u = get(s.units, c.unitId, 'unitId'), status = getStatusTemplate(s, c.statusId);
    check(status, 'statusId');
    const options = own(c, 'options') ? c.options : {};
    if (!own(status, 'modifiers')) {
      fields(options, [], [...statusPatchFields, 'sourceId', 'extendTurns']);
      checkOptional(options, 'sourceId', source => source === null || has(s.units, source));
      checkOptional(options, 'remainingTurns', turns => int(turns, 1, 100));
      checkOptional(options, 'stacks', count => int(count, 1, status.maxStacks ?? 1));
      checkOptional(options, 'extendTurns', turns => int(turns, 1, 100));
      if (own(options, 'vars')) check(plain(options.vars), 'VM 状态变量');
      const previous = u.statuses[c.statusId];
      const { extendTurns = 1, ...patch } = options;
      const sourceId = own(patch, 'sourceId') ? patch.sourceId : previous?.sourceId ?? null;
      const source = s.units[sourceId];
      const vars = Object.fromEntries(Object.entries(status.vars ?? {}).flatMap(([key, expr]) => {
        const value = evaluateExpr(expr, { self: source, source, target: u, event: {} });
        return value === null ? [] : [[key, value]];
      }));
      const instance = { remainingTurns: 1, durationType: 'battle_turns', stackMode: 'refresh', stacks: 1,
        ...status, ...patch, templateId: status.id, ownerId: u.id, sourceId, vars: { ...vars, ...patch.vars } };
      if (previous && instance.stackMode === 'stack') instance.stacks = Math.min(status.maxStacks ?? 1, previous.stacks + instance.stacks);
      if (previous && instance.stackMode === 'extend') instance.remainingTurns = Math.min(100, previous.remainingTurns + extendTurns);
      if (previous?.pools) instance.pools = previous.pools;
      statusValue(instance, c.statusId, s, u.id);
      if (u.hp <= 0 || u.fled) return;
      u.statuses[c.statusId] = instance;
      recordVM(s, source ?? u, 'status', `${u.name}获得${instance.name} ×${instance.stacks}`, { targetId: u.id, statusId: instance.id });
      return;
    }
    fields(options, [], ['remainingTurns','durationType','stacks','stackRule','tickTiming','amount','sourceUnitId','modifiers','expireOn']);
    checkOptional(options, 'remainingTurns', x => int(x, 1, 100));
    checkOptional(options, 'durationType', x => ['battle_turns','until_removed','persistent'].includes(x));
    checkOptional(options, 'stacks', x => int(x, 1, status.maxStacks));
    checkOptional(options, 'stackRule', x => ['refresh','stack','replace'].includes(x));
    checkOptional(options, 'tickTiming', x => ['onTurnStart','onTurnEnd'].includes(x));
    checkOptional(options, 'amount', x => own(status.modifiers, 'amount') && int(x, 1, 10000));
    checkOptional(options, 'sourceUnitId', x => has(s.units, x));
    if (options.modifiers?.taunted ?? status.modifiers.taunted) {
      const sourceId = options.sourceUnitId ?? u.statuses[c.statusId]?.sourceUnitId;
      check(has(s.units, sourceId) && s.units[sourceId].team !== u.team, '嘲讽需要敌对来源');
    }
    grantStatus(s, u, c.statusId, options);
  },
  remove_status(s, c) {
    fields(c, ['type','unitId','statusId']);
    check(getStatusTemplate(s, c.statusId), 'statusId');
    const unit = get(s.units, c.unitId, 'unitId');
    const status = unit.statuses[c.statusId];
    check(!status?.flags?.includes('undispellable'), '该状态不可驱散');
    if (status) deleteOwnedPools(s, status);
    delete unit.statuses[c.statusId];
  },
  adjust_pool(s, c) {
    fields(c, ['type', 'poolId', 'operation', 'value']);
    const pool = typeof c.poolId === 'string' && plain(s.pools) && own(s.pools, c.poolId) ? s.pools[c.poolId] : undefined;
    check(pool && ['set', 'add'].includes(c.operation) && Number.isFinite(c.value), '资源池命令');
    const next = c.operation === 'set' ? c.value : pool.current + c.value;
    check(Number.isFinite(next) && next >= 0 && next <= pool.max, `资源池须在 0–${pool.max}`);
    updatePoolCurrent(s, pool.id, 'set', next);
  },
  patch_equipment_template(s, c) {
    fields(c, ['type','templateId','patch']);
    const old = get(s.equipment, c.templateId, 'templateId');
    nonempty(c.patch);
    const next = { ...old, ...c.patch };
    equipmentTemplate(next, s);
    const sameSlot = old.kind === next.kind && own(old, 'damage') === own(next, 'damage');
    const instances = Object.values(s.items).filter(item => item.templateId === c.templateId);
    if (instances.length) check(sameSlot && !own(c.patch, 'pools'), '不能热改已实例化装备的槽类型或资源池定义');
    s.equipment[c.templateId] = next;
    for (const item of instances) {
      for (const key of ['name', 'tags', 'tier', 'rules', 'mods']) if (own(c.patch, key) && own(item, key)) item[key] = structuredClone(next[key]);
    }
  },
  patch_skill_template(s, c) {
    fields(c, ['type','templateId','patch']);
    nonempty(c.patch);
    const next = { ...get(s.skills, c.templateId, 'templateId'), ...c.patch };
    skillTemplate(next, s);
    s.skills[c.templateId] = next;
  },
  spawn_unit(s, c) {
    fields(c, ['type','unit']);
    const v = c.unit;
    check(plain(v) && id(v.id) && !own(s.units, v.id), 'unit.id');
    unitValue(v, v.id, s);
    check(!own(v, 'pools'), '增援资源池由战局初始化');
    check(v.hp > 0 && v.ap === 0 && v.used.action === 0 && v.used.attack === 0, '增援须存活且行动未开始');
    v.mainHand = v.weapon;
    if (v.offHand === undefined) v.offHand = null;
    if (v.shield === undefined) v.shield = null;
    s.units[v.id] = v;
    if (s.vm || s.pools) initializeUnitPools(s, v.id);
    s.order.push(v.id);
  },
  remove_unit(s, c) {
    fields(c, ['type','unitId']);
    const unit = get(s.units, c.unitId, 'unitId');
    const linked = builtins.filter(key => (getPool(s, unit.id, key)?.contributors.length ?? 0) > 1);
    if (linked.length) unlinkPools(s, [unit.id], linked);
    deleteOwnedPools(s, unit);
    for (const status of Object.values(unit.statuses)) deleteOwnedPools(s, status);
    for (const item of Object.values(s.items)) if (item.ownerId === unit.id) item.ownerId = null;
    for (const zone of Object.values(s.zones ?? {})) if (zone.area?.anchorUnitId === unit.id) {
      deleteOwnedPools(s, zone);
      delete s.zones[zone.id];
    }
    const index = s.order.indexOf(c.unitId);
    if (index >= 0) {
      s.order.splice(index, 1);
      if (index < s.turn) s.turn--;
      else if (s.turn >= s.order.length) { s.turn = 0; s.round++; }
    }
    delete s.units[c.unitId];
  },
  equip_item(s, c) {
    fields(c, ['type','instanceId','unitId']);
    const instance = get(s.items, c.instanceId, 'instanceId');
    const u = c.unitId === null ? null : get(s.units, c.unitId, 'unitId');
    for (const v of Object.values(s.units)) {
      for (const slot of ['weapon', 'mainHand', 'offHand', 'shield']) if (v[slot] === instance.id) v[slot] = null;
      v.gear = v.gear.filter(i => i !== instance.id);
    }
    if (own(instance, 'ownerId')) instance.ownerId = u?.id ?? null;
    if (u) {
      if (own(s.equipment[instance.templateId], 'damage')) { u.weapon = instance.id; u.mainHand = instance.id; }
      else u.gear.push(instance.id);
    }
  },
  set_zone(s, c) {
    fields(c, ['type','zone']);
    const z = structuredClone(c.zone);
    zoneValue(z, z?.id, s);
    check(!own(z, 'pools'), '区域资源池由战局绑定');
    const table = s.zones ??= {};
    if (table[z.id]?.pools) deleteOwnedPools(s, table[z.id]);
    table[z.id] = z;
  },
  remove_zone(s, c) {
    fields(c, ['type','zoneId']);
    const zone = get(s.zones ?? {}, c.zoneId, '区域 ID');
    deleteOwnedPools(s, zone);
    delete s.zones[c.zoneId];
  },
  set_terrain_cell(s, c) {
    fields(c, ['type','x','y','patch']);
    check(inGrid(s, c.x, c.y), '坐标');
    nonempty(c.patch);
    const next = { ...s.grid[c.y][c.x], ...c.patch };
    validateCell(next);
    s.grid[c.y][c.x] = next;
  },
  set_interactive_status(s, c) {
    fields(c, ['type','id'], ['spent','hp']);
    if (own(s.covers, c.id)) {
      fields(c, ['type','id','hp']);
      const cover = get(s.covers, c.id, '掩体 ID');
      check(int(c.hp, 0, cover.maxHp), '掩体 HP');
      cover.hp = c.hp;
    } else {
      fields(c, ['type','id','spent']);
      check(typeof c.spent === 'boolean', 'spent');
      get(s.interactives, c.id, '互动点 ID').spent = c.spent;
    }
  },
};
export function applyCommand(state, command) {
  check(plain(command) && has(commands, command.type), '命令类型');
  // Transactions retain the original command. Never insert reference-bearing input into mutable battle state.
  commands[command.type](state, structuredClone(command));
}
