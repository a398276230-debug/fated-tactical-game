import { applyAction, equippedActiveSkills, preview, switchableWeapons } from './combat.js';
import { elevation, atBattleEdge } from './spatial.js';
const RULES = `你是命定战术沙盘的敌方陪玩 AI。你的身份是 user 一方的对手，只控制当前连续行动的敌方角色，不替玩家做决定。
规则摘要：每回合每个角色有1个攻击槽和1个动作槽，移动、装填、互动、换装使用动作槽，攻击使用攻击槽，重型技能可同时用两槽。攻击使用三维距离、视线、射程、地形和掩体判定。切磋双方非致死并在低于30%生命时退场，竞技双方非致死至1生命出局，压制战只有压制方的压制动作留活口，守卫战蓝方坚持5轮。战意会影响命中，所有战斗只有站在地图边界才能逃跑。技能、装备主动效果和背包消耗品都可能有次数、冷却和资源费用，必须优先依据输入中的实际数据。
你必须依据输入中的实际单位、技能、装备、行动范围、互动点和地图做决策。
只输出 JSON，不要 Markdown、解释、思考过程。格式为 {"actions":[{"unitId":"敌方单位ID","action":{"type":"attack|skill|move|sprint|disengage|brace|reload|interact|suppress|free_ally|flee|switch_weapon|end","x":整数,"y":整数,"skillId":"技能ID"。非技能动作不要输出 skillId，未使用的坐标也不要输出。}}]}。动作按执行顺序排列，最多覆盖当前到下一个玩家单位之前的敌方回合。每个动作都必须有 unitId。`;

const own = (o, k) => o != null && Object.hasOwn(o, k);
const copy = value => structuredClone(value);
function compactSkill(state, unit, id) {
  const s = state.skills[id];
  if (!s) return null;
  return { id, name: s.name, slot: s.slot, ap: s.ap, range: s.range, shape: s.shape, target: s.target,
    power: s.power, damageType: s.damageType, damage: s.damage, effects: s.effects,
    usage: state.units[unit.id]?.skillUsage?.[id] };
}
function unitView(state, unit) {
  const skills = [...new Set([...(unit.skills ?? []), ...Object.keys(unit.inventory ?? {}), ...Object.keys(state.skills).filter(id => state.skills[id]?.backpackItem),
    ...equippedActiveSkills(state, unit).map(([id]) => id)])]
    .map(id => compactSkill(state, unit, id)).filter(Boolean);
  const actions = [];
  const shadow = copy(state);
  shadow.turn = shadow.order.indexOf(unit.id);
  for (const type of ['attack','move','sprint','disengage','brace','reload','flee','suppress','free_ally','end']) {
    const plan = preview(shadow, { type });
    if (plan.ok || type === 'move') actions.push(type);
  }
  return { id: unit.id, name: unit.name, team: unit.team, hp: unit.hp, maxHp: unit.maxHp, mp: unit.mp, sp: unit.sp,
    x: unit.x, y: unit.y, z: elevation(state, unit), ap: unit.ap, used: unit.used, statuses: unit.statuses,
    mainHand: unit.mainHand ?? unit.weapon, offHand: unit.offHand, skills, actions, atEdge: atBattleEdge(state, unit),
    switchableWeapons: switchableWeapons(state, unit).map(id => ({ id, name: state.equipment[state.items[id]?.templateId]?.name ?? id })),
    rangeHint: { attack: state.equipment[state.items[unit.mainHand ?? unit.weapon] ? state.items[unit.mainHand ?? unit.weapon].templateId : '']?.range ?? 1.5 },
  };
}
export function battleAiPayload(state) {
  const current = state.order[state.turn];
  const start = state.order.indexOf(current);
  const actors = [];
  for (let i = 0; i < state.order.length; i++) {
    const unit = state.units[state.order[(start + i) % state.order.length]];
    if (!unit || unit.hp <= 0 || unit.fled) continue;
    if (actors.length && unit.team === 'blue') break;
    if (unit.team === 'red') actors.push(unitView(state, unit));
  }
  const grid = state.grid.map(row => row.map(cell => cell.kind === 'wall' ? '#' : cell.kind === 'slope' ? `^${cell.z ?? 0}` : cell.kind === 'floor' ? String(cell.z ?? 0) : `${cell.kind}:${cell.z ?? 0}`).join(' '));
  const movement = {};
  for (const unit of actors) {
    const shadow = copy(state);
    shadow.turn = shadow.order.indexOf(unit.id);
    const plan = preview(shadow, { type:'move' });
    movement[unit.id] = (plan.cells ?? []).map(({x,y}) => [x,y]);
  }
  return { rules: RULES, battle: { title: state.title, type: state.battleType, round: state.round, turnUnitId: current,
    units: actors, allUnits: Object.values(state.units).filter(u => u.hp > 0 && !u.fled).map(u => ({ id:u.id, team:u.team, x:u.x, y:u.y, hp:u.hp, maxHp:u.maxHp })),
    covers: state.covers, interactives: state.interactives, movement, grid }, actorIds: actors.map(u => u.id) };
}
function parse(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  const data = JSON.parse(match?.[0] ?? text);
  if (!Array.isArray(data.actions) || data.actions.length > 64) throw new Error('战斗 AI 必须返回 actions 数组');
  return data.actions;
}
export async function requestBattleAi(state, request, { signal } = {}) {
  const payload = battleAiPayload(state);
  if (!payload.actorIds.length) return [];
  let messages = [{ role:'system', content: RULES }, { role:'user', content: JSON.stringify(payload) }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await request(messages, signal);
    try {
      const actions = parse(reply);
      const valid = [];
      const shadow = copy(state);
      for (const entry of actions) {
        if (!entry || typeof entry.unitId !== 'string' || !entry.action || typeof entry.action.type !== 'string') throw new Error('动作缺少 unitId 或 action.type');
        const actor = shadow.units[entry.unitId];
        if (!actor || actor.team !== 'red') throw new Error(`不能控制单位 ${entry.unitId}`);
        if (shadow.units[shadow.order[shadow.turn]]?.id !== entry.unitId) throw new Error(`行动顺序错误，应轮到 ${shadow.order[shadow.turn]}`);
        const action = Object.fromEntries(Object.entries(entry.action).filter(([, value]) => value !== null));
        if (action.type === 'skill' && typeof action.skillId !== 'string') throw new Error('技能动作必须提供 skillId');
        if (action.type !== 'skill') delete action.skillId;
        const plan = preview(shadow, action);
        if (!plan.ok) throw new Error(`${entry.unitId} 的 ${entry.action.type} 不合法：${plan.error}`);
        applyAction(shadow, action);
        valid.push({ ...entry, action });
        const next = shadow.units[shadow.order[shadow.turn]];
        if (!next || next.team !== 'red') break;
      }
      if (!valid.length) throw new Error('actions 为空');
      return valid;
    } catch (error) {
      if (attempt) throw error;
      messages = [...messages, { role:'assistant', content: reply }, { role:'user', content:`上一份 JSON 或动作无效：${error.message}。只输出修正后的完整 JSON。` }];
    }
  }
  throw new Error('战斗 AI 未返回有效动作');
}
export { RULES };
