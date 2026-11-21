import { applyAction, equippedActiveSkills, preview, switchableWeapons } from './combat.js';
import { elevation, atBattleEdge } from './spatial.js';
const RULES = `你是命定战术沙盘的敌方陪玩 AI。你的身份是 user 一方的对手，只控制当前连续行动的敌方角色，不替玩家做决定。
行动：每回合每个角色有1个攻击槽和1个动作槽。移动、装填、互动、换装、架势和逃跑使用动作槽，普通攻击、技能攻击、压制和解除压制使用攻击槽，重型技能可同时使用两槽。一个动作只能使用当前行动者自己的槽位。动作、技能和背包物品的实际 ap、slot、资源、次数与冷却以输入数据为准。
距离与高度：攻击和技能按三维欧氏距离 sqrt(dx²+dy²+dz²) 检查射程。z 是格子高度加单位离地高度。高处攻击低处时，远程攻击通常获得最多+1格射程，低处攻击高处时通常减少1格射程，实际值以技能/装备数据和预览规则为准。移动每跨一格有高度限制，平地通常只能跨1级高度，坡地可跨2级，墙不能通行。移动到高处或低处会消耗路径允许的动作预算，不能把二维相邻当作一定可达。
视线与隔断：墙体和非可站立格会阻断视线。攻击、远程技能、爆桶引爆和范围效果都要有通畅视线。范围技能以实际形状、半径、宽度、角度和三维距离取格，不能穿墙或隔断。
掩体：掩体位于攻击者与目标的射线或目标迎击侧时生效，按掩体 cover 数值降低命中或保护目标。攻击者或目标比掩体高至少2级时可以越过该掩体，掩体不再提供遮挡。掩体有自己的 HP，可以被攻击或爆炸破坏，破坏后不再遮挡。不要把掩体当成墙，掩体通常不阻断视线，只改变命中与伤害条件。
互动：祭坛需要相邻且有视线，消耗动作槽，按其声明的效果回复生命、MP、SP、护盾或状态。爆桶需要使用者的当前武器射程和视线，消耗攻击槽与弹药，按互动点声明的半径和伤害对范围内单位与掩体造成能量伤害，也可能波及友方。互动点使用一次后不可重复使用，必须依据输入里的 effect、radius、damage、x、y、z 判断，不能仅凭名称猜测。
全览：allUnits 列出场上每个单位的 id、名称、阵营、存活/撤离、三维位置、离地高度、HP/MP/SP及上限、行动槽、反应、战意、全部状态、当前装备、装备计数器、背包、技能、技能范围和可移动格。不要只看 units 中的当前敌方行动者。
战斗类型：切磋双方非致死并在低于30%生命时退场，竞技双方非致死至1生命出局，压制战只有压制方的压制动作留活口，守卫战蓝方坚持5轮。战意会影响命中，所有战斗只有站在地图边界才能逃跑。技能、装备主动效果和背包消耗品都可能有次数、冷却和资源费用，必须优先依据输入中的实际数据。
你必须依据输入中的实际单位、技能、装备、行动范围、互动点和地图做决策。只输出 JSON，不要 Markdown、解释、思考过程。格式为 {"actions":[{"unitId":"敌方单位ID","action":{"type":"attack|skill|move|sprint|disengage|brace|reload|interact|suppress|free_ally|flee|switch_weapon|end","x":整数,"y":整数,"skillId":"技能ID"}}]}。非技能动作不要输出 skillId，未使用的坐标不要输出。动作按执行顺序排列，最多覆盖当前到下一个玩家单位之前的敌方回合。每个动作都必须有 unitId。`;

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
  const equipment = {};
  for (const instanceId of [...new Set([unit.mainHand, unit.weapon, unit.offHand, unit.shield, ...(unit.gear ?? [])].filter(Boolean))]) {
    const instance = state.items[instanceId];
    const template = instance && state.equipment[instance.templateId];
    if (template) equipment[instanceId] = { instanceId, templateId: instance.templateId, ...template, counters: instance.counters ?? {} };
  }
  const actions = [];
  const shadow = copy(state);
  shadow.turn = shadow.order.indexOf(unit.id);
  for (const type of ['attack','move','sprint','disengage','brace','reload','flee','suppress','free_ally','end']) {
    const plan = preview(shadow, { type });
    if (plan.ok || type === 'move') actions.push(type);
  }
  return { id: unit.id, name: unit.name, team: unit.team, faction: unit.team === 'red' ? '敌方' : '玩家方',
    alive: unit.hp > 0, fled: !!unit.fled, hp: unit.hp, maxHp: unit.maxHp, mp: unit.mp, maxMp: unit.maxMp, sp: unit.sp, maxSp: unit.maxSp,
    x: unit.x, y: unit.y, z: elevation(state, unit), altitude: unit.altitude ?? 0, ap: unit.ap, used: unit.used, reactionAvailable: unit.reactionAvailable, statuses: unit.statuses,
    moraleState: unit.moraleState ?? 'steady', routed: unit.moraleState === 'routed',
    retreatTarget: unit.moraleState === 'routed' ? (state.grid.flatMap((row,y) => row.map((cell,x) => ({x,y}))).filter(at => atBattleEdge(state, at)).sort((a,b) => Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y))[0] ?? null) : null,
    mainHand: unit.mainHand ?? unit.weapon, offHand: unit.offHand, skills, actions, atEdge: atBattleEdge(state, unit),
    equipment, inventory: unit.inventory ?? {}, switchableWeapons: switchableWeapons(state, unit).map(id => ({ id, name: state.equipment[state.items[id]?.templateId]?.name ?? id })),
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
  for (const unit of Object.values(state.units)) {
    if (unit.hp <= 0 || unit.fled) continue;
    const shadow = copy(state);
    shadow.turn = shadow.order.indexOf(unit.id);
    const plan = preview(shadow, { type:'move' });
    movement[unit.id] = (plan.cells ?? []).map(({x,y,z}) => [x,y,z ?? elevation(state,{x,y})]);
  }
  return { rules: RULES, battle: { title: state.title, type: state.battleType, suppressingTeam: state.suppressingTeam ?? null, round: state.round, turnUnitId: current,
    units: actors, allUnits: Object.values(state.units).map(unit => unitView(state, unit)),
    covers: Object.values(state.covers).map(c => ({ id:c.id, name:c.name, x:c.x, y:c.y, z:elevation(state,c), hp:c.hp, maxHp:c.maxHp, cover:c.cover, material:c.material })),
    interactives: Object.values(state.interactives).map(i => ({ id:i.id, name:i.name, kind:i.kind, effect:i.effect, radius:i.radius ?? 0, damage:i.damage ?? 0, x:i.x, y:i.y, z:elevation(state,i), spent:!!i.spent })), movement, grid }, actorIds: actors.map(u => u.id) };
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
        if (actor.moraleState === 'routed' && !['move','flee','end'].includes(entry.action.type)) throw new Error('溃逃单位只能撤向边界或逃跑');
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
