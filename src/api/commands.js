import { getStatusTemplate, grantStatus } from '../core/combat.js';
import { attrs, checkOptional, coord, equipmentTemplate, fields, has, id, int, maxStatusTemplates, own,
  plain, requireThat as check, skillTemplate, statusTemplate, unitValue, validateCell } from './validation.js';

const get = (table, key, label) => { check(has(table, key), label); return table[key]; };
const nonempty = patch => check(plain(patch) && Object.keys(patch).length > 0, 'patch');

const commands = {
  set_unit_stat(s, c) {
    fields(c, ['type','unitId','patch']);
    const u = get(s.units, c.unitId, 'unitId');
    nonempty(c.patch);
    fields(c.patch, [], ['hp','mp','sp','ap','x','y','team','stats','weapon','mainHand','offHand','shield','bodyLengthM','tier','mc','bonusDice','penaltyDice','intent','nonLethal','stance','moraleType','moraleState','greatswordMode','parryQuota','blockMode','deathrattle','swarm','formation','maneuvers']);
    for (const k of ['hp','mp','sp','ap','x','y','team','mainHand','offHand','shield','bodyLengthM','tier','mc','bonusDice','penaltyDice','intent','nonLethal','stance','moraleType','moraleState','greatswordMode','parryQuota','blockMode','deathrattle','swarm','formation','maneuvers']) if (own(c.patch, k)) u[k] = c.patch[k];
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
  },
  define_status_template(s, c) {
    fields(c, ['type','template']);
    statusTemplate(c.template);
    check(!getStatusTemplate(s, c.template.id), '状态模板 ID 已存在');
    check(Object.keys(s.statusTemplates ?? {}).length < maxStatusTemplates, '自定义状态模板数量');
    (s.statusTemplates ??= {})[c.template.id] = c.template;
  },
  upsert_status(s, c) {
    fields(c, ['type','unitId','statusId'], ['options']);
    const u = get(s.units, c.unitId, 'unitId'), status = getStatusTemplate(s, c.statusId);
    check(status, 'statusId');
    const options = own(c, 'options') ? c.options : {};
    fields(options, [], ['remainingTurns','durationType','stacks','stackRule','tickTiming','amount','sourceUnitId']);
    checkOptional(options, 'remainingTurns', x => int(x, 1, 100));
    checkOptional(options, 'durationType', x => ['battle_turns','until_removed','persistent'].includes(x));
    checkOptional(options, 'stacks', x => int(x, 1, status.maxStacks));
    checkOptional(options, 'stackRule', x => ['refresh','stack','replace'].includes(x));
    checkOptional(options, 'tickTiming', x => ['onTurnStart','onTurnEnd'].includes(x));
    checkOptional(options, 'amount', x => c.statusId === 'shield' && int(x, 1, 10000));
    checkOptional(options, 'sourceUnitId', x => has(s.units, x));
    if (c.statusId === 'taunt') check(has(s.units, options.sourceUnitId ?? u.statuses.taunt?.sourceUnitId)
      && s.units[options.sourceUnitId ?? u.statuses.taunt?.sourceUnitId].team !== u.team, '嘲讽需要敌对来源');
    grantStatus(s, u, c.statusId, options);
  },
  remove_status(s, c) {
    fields(c, ['type','unitId','statusId']);
    check(getStatusTemplate(s, c.statusId), 'statusId');
    delete get(s.units, c.unitId, 'unitId').statuses[c.statusId];
  },
  adjust_item_counter(s, c) {
    fields(c, ['type','instanceId','counterKey','operation','value']);
    const item = get(s.items, c.instanceId, 'instanceId');
    check(has(item.counters, c.counterKey) && ['set','add'].includes(c.operation) && int(c.value, -50, 50), '计数器命令');
    const effect = s.equipment[item.templateId].effects.find(e => e.counterKey === c.counterKey);
    const next = c.operation === 'set' ? c.value : item.counters[c.counterKey] + c.value;
    const cap = Math.max(effect.capacity ?? effect.maxStacks, item.counters[c.counterKey]);
    check(int(next, 0, cap), `计数结果须在 0–${cap}`);
    item.counters[c.counterKey] = next;
  },
  patch_equipment_template(s, c) {
    fields(c, ['type','templateId','patch']);
    const old = get(s.equipment, c.templateId, 'templateId');
    nonempty(c.patch);
    const next = { ...old, ...c.patch };
    equipmentTemplate(next, s);
    const counters = t => t.effects.filter(e => e.counterKey).map(e => `${e.kind}:${e.counterKey}`).sort().join('|');
    check(counters(next) === counters(old) && own(old, 'damage') === own(next, 'damage'), '不能热改装备槽类型或实例计数器定义');
    s.equipment[c.templateId] = next;
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
    check(v.hp > 0 && v.ap === 0 && v.used.action === 0 && v.used.attack === 0, '增援须存活且行动未开始');
    v.mainHand = v.weapon;
    if (v.offHand === undefined) v.offHand = null;
    if (v.shield === undefined) v.shield = null;
    s.units[v.id] = v;
    s.order.push(v.id);
  },
  remove_unit(s, c) {
    fields(c, ['type','unitId']);
    get(s.units, c.unitId, 'unitId');
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
    if (u) {
      if (own(s.equipment[instance.templateId], 'damage')) { u.weapon = instance.id; u.mainHand = instance.id; }
      else u.gear.push(instance.id);
    }
  },
  set_zone(s, c) {
    fields(c, ['type','zone']);
    const z = structuredClone(c.zone);
    check(plain(z) && id(z.id), '区域 ID');
    const table = s.zones ??= {};
    table[z.id] = z;
  },
  remove_zone(s, c) {
    fields(c, ['type','zoneId']);
    check(has(s.zones ?? {}, c.zoneId), '区域 ID');
    delete s.zones[c.zoneId];
  },
  set_terrain_cell(s, c) {
    fields(c, ['type','x','y','patch']);
    check(coord(c.x) && coord(c.y), '坐标');
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
