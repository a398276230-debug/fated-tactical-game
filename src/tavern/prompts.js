import { EFFECT_PROTOCOL } from './effect-protocol.js';
import { ENGINE_API_SUMMARY } from './engine-summary.js';
import { STATUS_CATALOG } from './status-catalog.js';

const IDENTITY = `你是命定战斗助手。你需要根据用户输入对战局数值进行操作，以当前战局、参战者与装备快照、战斗协议为依据，核对操作对象、字段和取值，使用引擎认可的标识符。

当「待处理警告」非空时，你必须逐项标准化其中的内容。把装备、技能或状态中以自然语言描述的效果，转成引擎可使用的特效，并应用到对应的角色或武器上。若单个机制不足以表达，先按协议组合已支持的机制，保留原效果的触发条件、作用目标、持续时间和数值。无法完整表达时，提交能执行的部分，并按任务指令标明仍待处理的效果。

不做叙事、不扮演角色、不推进剧情，只输出引擎可执行的数据变更。按当前任务要求组织补丁和待处理项，沿用快照中的角色、装备、技能和状态 ID，保留与本次操作无关的数据。提交前检查路径、参数和数值范围，确保整批变更可以在当前战局执行。`;

import { warningsForUnit } from './converter.js';

export const DEFAULT_SLOTS = [
  { id: 'identity', label: '身份与任务声明', role: 'system', enabled: true, desc: '命定战斗助手的职责与边界', content: IDENTITY },
  { id: 'protocol', label: '战斗协议与规则说明', role: 'system', enabled: true, desc: '真实战斗协议的数值口径、判定方式、输出约束' },
  { id: 'roster', label: '参战者与装备快照', role: 'system', enabled: true, desc: '当前战局的单位、装备、技能、状态（含 MVU 来源）' },
  { id: 'battle', label: '战局与地形', role: 'system', enabled: true, desc: 'battle_init 描述符解析后的棋盘、地形、掩体、互动点' },
  { id: 'warnings', label: '待处理警告清单', role: 'system', enabled: true, desc: '沙盘转换时无法等价映射的装备/技能/效果及原因' },
  { id: 'task', label: '标准化任务指令', role: 'system', enabled: true, desc: 'RFC 6902 补丁格式约束、允许路径白名单、禁止项' },
  { id: 'extra', label: '自定义补充（可空）', role: 'system', enabled: false, desc: '用户自己填的额外提示词' },
].map(slot => ({ builtin: true, ...slot, content: slot.content ?? '' }));

const TAG_MAPPING = `【世界书标签 → DSL / API 映射】
• [威力: X] + [伤害: 类型] → 以 X 为威力基准，damage 节点用 percentOfPower:1.0 和对应的 damageType。[威力: X 物理] 等价于 [威力: X][伤害: 物理]，不额外叠加伤害。
• 混合伤害：[威力: 60][伤害: 物理40/能量20] 中各分量之和等于威力。必须拆成多个 damage 节点，每个节点只写一个 damageType 和对应数值，不得在单节点里塞多个类型。例：[{"kind":"damage","flat":40,"damageType":"physical"},{"kind":"damage","flat":20,"damageType":"energy"}]。不得再叠加一次总威力。
• [关联属性: 敏捷] → 技能的关联检定属性为 agi；不要把施术者的关联属性误作目标的豁免属性。[有效距离: 中程(5)] → range:5。
• [单体] → shape:single，target 依描述选取；[范围: 中程(4)+扇(敌方)] → range:4、shape:fan、target:enemy，radius 按实际覆盖半径填写，不把射程当半径。
• 空效果：目标对象的效果字段为 {} 或缺失时，表示该字段没有可执行效果，不产生任何补丁操作，也不计入 unresolved。纯位移、纯状态授予等技能仍有可执行节点，不属于空效果。`;
const diagnosisProtocol = '诊断归属：patch 操作的可选 resolves（字符串或字符串数组）说明该操作解决的原诊断；也可在响应顶层使用 resolved 或 resolvedWarnings 字符串数组。这些字段不是 DSL 节点或战局字段。';
const protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`【输出】逐项对照本战局警告、快照和战斗协议。只输出一个 JSON 对象：{"patch":[],"unresolved":[]}。两个键都是数组。针对警告生成补丁时，优先在操作上填写 resolves，复制已解决诊断原文或足以唯一定位的效果名；也可用顶层 resolved 或 resolvedWarnings 数组。只声明本次已修复的诊断；未解决或仅部分解决的条目仍列在 unresolved 并保留原效果名。不要解释、注释、Markdown 代码块、JS 调用或 battle_patch 包装。

【patch：有序的 RFC 6902 操作】
add 新增、replace 替换现有值：{"op":"replace","path":"…","value":值}；remove 删除现有值：{"op":"remove","path":"…"}。只允许这三种 op。路径以一个 / 开头。白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/
• /equipment/<id>：装备模板（如 /equipment/mainHand_dagger_01）；不是持有的道具实例。
• /skills/<id>：技能模板（如 /skills/skill_frost_arrow）。
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
{"patch":[{"op":"replace","path":"/units/p1/armor","value":6,"resolves":["基础护甲缺失"]}],"unresolved":[]}
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
const json = value => JSON.stringify(value, null, 2);

let lastCustomId = 0;
export function makeCustomSlot() {
  lastCustomId = Math.max(Date.now(), lastCustomId + 1);
  return { id: `custom_${lastCustomId}`, label: '自定义槽位', role: 'system', enabled: true, desc: '', content: '', custom: true };
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
  // The identity slot marks snapshots already migrated to the new role defaults.
  const needsIdentity = !entries.some(slot => slot.id === 'identity');
  const slots = entries.map(slot => ({ ...defaults.get(slot.id), ...slot,
    ...(needsIdentity && defaults.has(slot.id) && slot.role === 'user' ? { role: 'system' } : {}),
  }));
  return needsIdentity ? [{ ...DEFAULT_SLOTS[0] }, ...slots] : slots;
}

export function resolveSlotContent(slot, ctx = {}) {
  const { sources = {}, state, instruction = '' } = ctx;
  const warnings = warningsForUnit(sources.warnings, ctx.onlyUnitIds);
  const variables = {
    battle_init: () => sources.battleRaw || json(sources.battleInit ?? {}),
    battle_state: () => json(state ?? {}), warnings: () => json(warnings.map(w => w.message)),
    user_instruction: () => instruction, standardized_roster: () => ctx.onlyUnitIds ? rosterText() : sources.roster || '',
    roster: rosterText, battle: battleText,
    mvu_data: () => json(sources.mvuData ?? {}), latest_floor: () => sources.latestFloor || '',
  };
  const expand = template => String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => Object.hasOwn(variables, key) ? variables[key]() : '');
  function rosterText() {
    if (ctx.onlyUnitIds && state) {
      const pick = (table, ids) => Object.fromEntries([...new Set(ids)].filter(id => Object.hasOwn(table ?? {}, id)).map(id => [id, table[id]]));
      const units = pick(state.units, ctx.onlyUnitIds), rows = Object.values(units);
      const items = pick(state.items, rows.flatMap(u => [u.mainHand,u.weapon,u.offHand,u.shield,...(u.gear??[])]));
      return json({raw:pick(ctx.rawCharacters,ctx.onlyUnitIds), units, items, equipment:pick(state.equipment,Object.values(items).map(i=>i.templateId)), skills:pick(state.skills,rows.flatMap(u=>u.skills??[])), statusTemplates:state.statusTemplates});
    }
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
    case 'warnings': return ctx.warningsText ?? (warnings.length ? `待处理警告：\n${variables.warnings()}` : '');
    case 'task': return expand(ctx.taskText ?? (ctx.kind === 'chat' ? '【辅助 AI 对话】身份声明中的数据输出要求适用于战局变更。玩家仅咨询时，直接用文字回答战斗与引擎问题。只有玩家明确要求调整战局且已加载战局时，才输出 battle_patch 或 unit_patch JSON。待处理警告由独立的标准化任务处理。' : PATCH_RULES + (instruction ? '\n玩家补充：{{user_instruction}}' : '')));
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
    const mergeable = !slot.custom && role !== 'assistant' && slot.id !== 'assistant';
    if (previous?.role === role && previousMergeable && mergeable) {
      previous.content += '\n\n' + content;
      previous.slotId += '+' + slot.id;
      previous.slotLabel += ' / ' + slot.label;
    } else messages.push({ role, content, slotId: slot.id, slotLabel: slot.label });
    previousMergeable = mergeable;
  }
  return messages;
}
