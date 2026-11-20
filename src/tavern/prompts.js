import { ENGINE_API_SUMMARY } from './engine-summary.js';
import { STATUS_CATALOG } from './status-catalog.js';

export const DEFAULT_SLOTS = [
  { id: 'protocol', label: '战斗协议与规则说明', role: 'system', enabled: true, desc: '真实战斗协议的数值口径、判定方式、输出约束' },
  { id: 'roster', label: '参战者与装备快照', role: 'user', enabled: true, desc: '当前战局的单位、装备、技能、状态（含 MVU 来源）' },
  { id: 'battle', label: '战局与地形', role: 'user', enabled: true, desc: 'battle_init 描述符解析后的棋盘、地形、掩体、互动点' },
  { id: 'warnings', label: '待处理警告清单', role: 'user', enabled: true, desc: '沙盘转换时无法等价映射的装备/技能/效果及原因' },
  { id: 'task', label: '标准化任务指令', role: 'user', enabled: true, desc: 'RFC 6902 补丁格式约束、允许路径白名单、禁止项' },
  { id: 'extra', label: '自定义补充（可空）', role: 'user', enabled: false, desc: '用户自己填的额外提示词' },
].map(slot => ({ ...slot, builtin: true, content: '' }));

const protocol = [ENGINE_API_SUMMARY, STATUS_CATALOG].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`【输出】逐项对照本战局警告、快照和战斗协议。只输出一个 JSON 对象：{"patch":[],"unresolved":[]}。两个键都是数组；不要解释、注释、Markdown 代码块、JS 调用或 battle_patch 包装。

【patch：有序的 RFC 6902 操作】
add 新增、replace 替换现有值：{"op":"replace","path":"…","value":值}；remove 删除现有值：{"op":"remove","path":"…"}。只允许这三种 op。路径以一个 / 开头。白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:statuses|armor)(?:\/|$)/
• /equipment/<id>：装备模板（如 /equipment/mainHand_dagger_01）；不是持有的道具实例。
• /skills/<id>：技能模板（如 /skills/skill_frost_arrow）。
• /items/<id>：道具实例（如 /items/item_01），不是模板属性。
• /statusTemplates/<id>：战局的自定义状态模板（如 /statusTemplates/status_custom_01），不能覆盖内置 ID。
• /units/<unitId>/statuses：单位状态实例映射（如 /units/p1/statuses）。
• /units/<unitId>/armor：单位护甲整数 0…1000000（如 /units/p1/armor）。
上述对象可寻址其合法子字段，数值等标量没有子路径。使用快照里的精确 ID，不用角色/装备显示名、数组下标、stat_data 路径。新定义的 ID 只用合法唯一键（首字符英数，后续英数、_、-，总长≤64），必须有原始资料依据。父对象必须已存在；不能靠深路径自动创建 /statusTemplates 根表。修改 effects 时提供完整数组，保留无关特效，不得误删。

【值的形状：只用各表已定义的字段】
装备必有 name、effects；attack 为整数 0…1000000000，accuracy 为 −20…30。武器 range(1…15) 与 damage 骰子必须成对。攻击值不是命中修正。
技能必有 name、ap(1或2)、slot(attack/action)、range(0…15)、shape(single/circle/fan/cone/line)、target(enemy/ally/self/any)、effects。save(str/agi/con/int/spi) 与 saveDC(1…50) 必须成对；damage/heal 用 {count,sides}，可加 bonus、stat、multiplier、type。
装备特效仅限：武器 kill_charge_weapon(counterKey,bonusPerStack,maxStacks)、ammo(counterKey,capacity,armorPierce,highGroundRange,highGroundAccuracy)、backstab(bonusMultiplier,bleedStacks,comboDamage)、opportunity_root()；非武器 frost_thorns(damage,chance,statusId)、healing_shield(healBonus,shieldRatio)。括号内均为必填字段；每项另有 kind，chance 为 0…1。
技能特效仅限 status(statusId，选填 turns/stacks；amount 仅用于 shield)、knockback(distance,collisionDamage)、teleport_backstab(bonusMultiplier)、cleanse()。两类 effects 不混用；每表项最多 12 个特效。同一 counterKey（无则按 kind）不重复，status 例外。
物品仅 {id,templateId,counters}：id 等于表键，templateId 必须指向 equipment，counters 与模板特效的 counterKey 一一对应，值为 0…50 的整数。移除被引用的模板会破坏校验。
内置状态只认协议表 ID；另可引用当前已合法定义的自定义模板。自定义模板最多 64 个，必有 id,name,icon,category,description,remainingTurns,durationType,tickTiming,stackRule,maxStacks,modifiers。category 为 buff/debuff/control/dot/hot；remainingTurns 整数1…100；durationType=battle_turns/until_removed/persistent；tickTiming=onTurnStart/onTurnEnd；stackRule=refresh/stack/replace；maxStacks 整数1…10。
自定义 modifiers 非空，仅可用整数 damage/heal(1…50)、movement(−3…3)、armor/accuracy/incomingAccuracy(−10…10)、advantage/disadvantage(1…3)、reflect(1…30)，或比例 reduction/vulnerability(0…1)。damageType 只能随 damage，取 physical/energy/mental/true。没有事件钩子或脚本字段。
单位 statuses 是以状态 ID 为键的对象，不是字符串列表。实例还须有 stacks(1…maxStacks)、sourceUnitId(ID 或 null)；id、展示信息及 modifiers 与模板匹配。只有 shield 实例带正整数 amount；不要将技能的 {kind:"status",statusId:…} 当作单位状态实例。

【整批生效条件】每条操作必须能按序由 applyPatch 应用；新状态还需通过 validateState，标准化补丁也要能在原始战局重新应用。任何一条失败，整批不落地。只改警告指出且有可靠数值依据的部分。禁止改 team、hp/ap/mp/sp 及上限、x/y、order、日志 logs，禁止间接绕过白名单。
【unresolved】每项是一句话“原效果 + 无法等价转换的原因”。缺模板、超上限、触发时机或机制不同、缺少必要数值时，说明原因，不编造类型、不截断数值冒充等价。部分可解可同时输出两个非空数组；有警告但无合法改动时，patch 为 [] 并填写 unresolved。
正例（仅当快照确有 p1，且警告明确其护甲应为 6）：
{"patch":[{"op":"replace","path":"/units/p1/armor","value":6}],"unresolved":[]}
反例：不能把“命中后冻结时间并倒转整轮”冒充 prone，更不能 replace /units/p1/ap；应返回：
{"patch":[],"unresolved":["命中后倒转整轮：引擎没有回滚回合和行动序列的状态或特效。"]}`;
const json = value => JSON.stringify(value, null, 2);

let lastCustomId = 0;
export function makeCustomSlot() {
  lastCustomId = Math.max(Date.now(), lastCustomId + 1);
  return { id: `custom_${lastCustomId}`, label: '自定义槽位', role: 'user', enabled: true, desc: '', content: '', custom: true };
}

export function describeSlots(saved) {
  if (!Array.isArray(saved)) return DEFAULT_SLOTS.map(slot => ({ ...slot }));
  const defaults = new Map(DEFAULT_SLOTS.map(slot => [slot.id, slot]));
  const entries = saved.filter(slot => typeof slot?.id === 'string');
  const legacy = entries.length > 0 && entries.every(slot => defaults.has(slot.id) && Object.keys(slot).every(key => key === 'id' || key === 'enabled'));
  if (legacy) {
    const overrides = new Map(entries.map(slot => [slot.id, slot]));
    return DEFAULT_SLOTS.map(slot => ({ ...slot, ...overrides.get(slot.id) }));
  }
  // Modern snapshots are authoritative, including an intentionally empty list.
  return entries.map(slot => ({ ...defaults.get(slot.id), ...slot }));
}

export function resolveSlotContent(slot, ctx = {}) {
  const { sources = {}, state, instruction = '' } = ctx;
  const variables = {
    battle_init: () => sources.battleRaw || json(sources.battleInit ?? {}),
    battle_state: () => json(state ?? {}), warnings: () => json(sources.warnings ?? []),
    user_instruction: () => instruction, standardized_roster: () => sources.roster || '',
    roster: rosterText, battle: battleText,
    mvu_data: () => json(sources.mvuData ?? {}), latest_floor: () => sources.latestFloor || '',
  };
  const expand = template => String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => Object.hasOwn(variables, key) ? variables[key]() : '');
  function rosterText() {
    if (ctx.rosterText != null) return ctx.rosterText;
    if (!state) return sources.roster || '';
    const templates = new Set(Object.values(state.items ?? {}).map(item => item.templateId));
    const skillIds = new Set(Object.values(state.units ?? {}).flatMap(unit => unit.skills ?? []));
    const used = (table, ids) => Object.fromEntries(Object.entries(table ?? {}).filter(([id]) => ids.has(id)));
    return json({ roster: ctx.roster ?? sources.roster, units: state.units, equipment: used(state.equipment, templates), skills: used(state.skills, skillIds), items: state.items, statusTemplates: state.statusTemplates });
  }
  function battleText() {
    if (ctx.battleText != null) return ctx.battleText;
    if (!sources.battleInit && !state) return '';
    // The unit and template tables live in the independently switchable roster slot.
    const { units, equipment, items, skills, statusTemplates, ...board } = state ?? {};
    return `battle_init：\n${variables.battle_init()}\n当前战局：\n${json(board)}`;
  }
  if (slot.custom === true || slot.content) return expand(slot.content ?? '');
  switch (slot.id) {
    case 'protocol': return protocol;
    case 'roster': return rosterText();
    case 'battle': return battleText();
    case 'warnings': return ctx.warningsText ?? (sources.warnings?.length ? `待处理警告：\n${variables.warnings()}` : '');
    case 'task': return expand(ctx.taskText ?? (ctx.kind === 'chat' ? '处理玩家指令：{{user_instruction}}。只输出 battle_patch 或 unit_patch JSON。' : PATCH_RULES + (instruction ? '\n玩家补充：{{user_instruction}}' : '')));
    case 'extra': return expand(ctx.extraText || '');
    case 'assistant': return ctx.assistantText || '';
    default: return '';
  }
}

export function assembleMessages(slots = DEFAULT_SLOTS, ctx = {}) {
  const messages = [];
  let previousMergeable = false;
  for (const slot of slots) {
    if (!slot || slot.enabled === false) continue;
    const content = resolveSlotContent(slot, ctx);
    if (!content?.trim()) continue;
    const role = ['system', 'assistant'].includes(slot.role) ? slot.role : 'user';
    const previous = messages.at(-1);
    const mergeable = !slot.custom && slot.id !== 'assistant';
    if (previous?.role === role && previousMergeable && mergeable) {
      previous.content += '\n\n' + content;
      previous.slotId += '+' + slot.id;
      previous.slotLabel += ' / ' + slot.label;
    } else messages.push({ role, content, slotId: slot.id, slotLabel: slot.label });
    previousMergeable = mergeable;
  }
  return messages;
}
