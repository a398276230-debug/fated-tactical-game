import { VM_EFFECT_PROTOCOL } from './vm-effect-protocol.js';
import { ENGINE_API_SUMMARY } from './engine-summary.js';
import { STATUS_CATALOG } from './status-catalog.js';

const IDENTITY = `你是命定战斗助手。你需要根据用户输入对战局数值进行操作，以当前战局、参战者与装备快照、战斗协议为依据，核对操作对象、字段和取值，使用引擎认可的标识符。

标准化任务中，「待处理警告」非空时，你必须逐项处理。把装备、技能或状态中以自然语言描述的效果转成战术 VM 规则、修饰或池声明，写到快照中对应的模板。先按协议组合已支持的机制，保留触发条件、作用目标、持续时间和数值。无法完整表达时，提交能执行的部分，并按任务指令标明仍待处理的效果。

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

const TAG_MAPPING = `【世界书标签 → VM 映射】
• [威力: X] + [伤害: 类型] → 用 X 作为原文给出的伤害基准，在 damage 指令写 amount 和 damageType。[威力: X 物理] 等价于 [威力: X][伤害: 物理]，只结算一次。
• 混合伤害：[威力: 60][伤害: 物理40/能量20] 拆成两个指令，例：[{"op":"damage","target":"target","amount":40,"damageType":"physical"},{"op":"damage","target":"target","amount":20,"damageType":"energy"}]。按原文比例拆分时各分量按同一基准求值，不再额外造成总威力伤害。
• [关联属性: 敏捷] → 指向施术者敏捷；需要属性缩放时读取 self.agi。只有原文明确豁免时才为防守方选择检定属性。[有效距离: 中程(5)] → range:5。
• [单体] → shape:single，target 依描述选取；[范围: 中程(4)+扇(敌方)] → radius:4、shape:fan、target:enemy，range 由有效距离另行确定。角度标签映射到 angle。
• 原文效果为 {} 或缺失且没有其他可执行描述时，无需补丁，也不计入 unresolved。位移、治疗、资源和状态授予均可形成独立规则；背包消耗品按任务约定处理。`;
const diagnosisProtocol = '诊断归属：在解决问题的 patch 操作上填写 resolves 数组，每项复制警告的 {unitId, originPath, message}（无来源路径用 null）。resolves 只属于补丁操作。';
const protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, VM_EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`【输出】逐项对照本战局警告、快照和战斗协议。只输出一个 JSON 对象：{"patch":[],"unresolved":[]}。两个键都是数组。针对警告生成补丁时，在操作的 resolves 数组中复制已解决警告的 {unitId, originPath, message}。只声明本次确实改变并修复的诊断。未解决或仅部分解决的条目仍列在 unresolved 并保留原效果名。不要解释、注释、Markdown 代码块、JS 调用或 battle_patch 包装。

【patch：有序的 RFC 6902 操作】
add 新增、replace 替换现有值：{"op":"replace","path":"…","value":值}；remove 删除现有值：{"op":"remove","path":"…"}。只允许这三种 op。路径以一个 / 开头。白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/
• /equipment/<id>：装备模板（如 /equipment/mainHand_dagger_01）；不是持有的道具实例。
• /skills/<id>：技能模板。backpackItem:true 是背包消耗品的使用模板。若消耗品没写效果，按名称和标签推定合理的目标、距离、范围和数值，补出可执行的 active 规则。保留 backpackItem:true、ap:1、slot:"action" 及库存，且不把消耗品加入单位 skills。
• /items/<id>：道具实例。装备模板的规则、修饰与池声明写在 /equipment/<id>。实例已自带 rules 或 mods 时，同批同步相关条目，保留该实例独有的内容。
• /statusTemplates/<id>：战局的自定义状态模板。新增模板使用新的 ID。
• /units/<unitId>/statuses：单位状态实例映射。实例形状见状态协议。
• /units/<unitId>/armor：单位护甲整数 0…1000000。
• /units/<unitId>/skills：完整技能 ID 数组，保留已有技能并加入新技能 ID。
使用快照中的 ID。新 ID 为英数开头，后续英数、_、-，≤64 字符。父对象须存在。替换模板或数组时保留无关字段与条目。

【模板值】
• 装备必有 name。保留已有武器字段，range(1…15) 与 damage 骰子成对。attack 为整数 0…1000000000，accuracy 为 −20…30。装备提供主动按钮时，在技能表定义技能，并将技能 ID 写入装备模板的 skills 数组。
• 技能必有 name、ap(1或2)、slot(attack/action)、range(0…15)、shape(single/circle/ring/fan/cone/line)、target(enemy/ally/self/any/corpse/cell)。范围字段 radius、innerRadius、width 为 0…6，angle 为整数 1…360。新主动效果写入 rules 的 active 规则，避免与模板原有主击或治疗重复结算。
• 装备和技能均可声明 rules、mods、tags、tier、vars、pools。rules 和 mods 是数组。tags 是小写标签数组，tier 为整数 1…7，vars 为 ID → Expr 的对象。pools 格式为 {"charge":{"cap":10,"initial":0}}，每池必填 cap，可加 initial、reloadable。cap / initial 优先写非负数，initial 不得超过 cap。已有装备初始化需要数值 cap。通过 resource 指令访问池，装备规则中 local:true 访问该实例的池。
• 自定义状态先定义模板，再通过 apply_status 或初始状态实例引用，见状态协议。

【VM 模板正例】用快照 ID 和警告字段，把对应的值写入 patch 操作。技能值可放在 /skills/<id>，装备值可放在 /equipment/<id>，状态值可放在 /statusTemplates/<id>，规则值则放入相关模板的 rules 数组。
• 技能值：{"name":"低伤校准","ap":1,"slot":"attack","range":1,"shape":"single","target":"enemy","rules":[{"id":"calibrated_impact","hook":"active","program":[{"op":"damage","target":"target","amount":1,"damageType":"physical","lethal":false}]}]}
• 装备值：{"name":"蓄能徽记","kind":"accessory","pools":{"charge":{"cap":10,"initial":0}},"mods":[{"stat":"armor","flat":2}],"rules":[{"id":"collect_charge","hook":"on_kill","program":[{"op":"resource","target":"self","pool":"charge","mode":"add","amount":1,"local":true}]}]}
• 状态值：{"id":"laugh_disabled","name":"狂笑失能","category":"control","remainingTurns":1,"mods":[{"locks":["action","attack"]}],"rules":[{"id":"laugh_break","hook":"after_damage","filter":"target.id == self.id && event.direct && event.dealt > 0","program":[{"op":"remove_status","target":"self","where":"status.id == 'laugh_disabled'","reason":"expired"}]}]}
• 授予上例状态的规则值：{"id":"laugh_on_hit","hook":"after_hit","filter":"attacker.id == self.id","program":[{"op":"check","kind":"save","stat":"spi","dc":"6 + self.spi * 0.5","onFail":[{"op":"apply_status","target":"target","statusId":"laugh_disabled"}]}]}
• 飞行规则值：{"id":"lift_off","hook":"active","program":[{"op":"move","target":"self","mode":"altitude","deltaZ":3}]}

【完整补丁示例】假设快照已有 /equipment/wing_charm，尚无 skills，且此诊断要求为翼徽加上主动飞行。已有技能 ID 时，在原数组中保留它们。
{"patch":[{"op":"add","path":"/skills/wing_charm_lift","value":{"name":"翼徽飞行","ap":1,"slot":"action","range":0,"shape":"single","target":"self","rules":[{"id":"lift_off","hook":"active","program":[{"op":"move","target":"self","mode":"altitude","deltaZ":3}]}]}},{"op":"add","path":"/equipment/wing_charm/skills","value":["wing_charm_lift"],"resolves":[{"unitId":"p1","originPath":"/equipment/wing_charm","message":"翼徽缺少主动飞行规则"}]}],"unresolved":[]}

整批须通过 validateState。禁止直接改运行时池、当前资源及上限、阵营、坐标、先攻队列或日志。先尝试拆解，再考虑放弃。只有仍无法表达的部分列入 unresolved，并保留原效果名及简短原因。检查 hook 和 op 字段、目标引用、池名称、状态 ID 与数值范围。最后只输出 {"patch":[],"unresolved":[]}。`;
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
    battle_state: () => json(state ?? {}), warnings: () => json(warnings.map(({unitId, originPath = null, message}) => ({unitId, originPath, message}))),
    user_instruction: () => instruction, standardized_roster: () => ctx.onlyUnitIds ? rosterText() : sources.roster || '',
    roster: rosterText, battle: battleText,
    mvu_data: () => json(sources.mvuData ?? {}), latest_floor: () => sources.latestFloor || '',
  };
  const expand = template => String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => Object.hasOwn(variables, key) ? variables[key]() : '');
  function rosterText() {
    if (ctx.onlyUnitIds && state) {
      const pick = (table, ids) => Object.fromEntries([...new Set(ids)].filter(id => Object.hasOwn(table ?? {}, id)).map(id => [id, table[id]]));
      const units = pick(state.units, ctx.onlyUnitIds), rows = Object.values(units);
      const items = pick(state.items, rows.flatMap(u => [u.mainHand,u.weapon,u.offHand,u.shield,...(u.gear??[]),...(u.bagWeapons??[])]));
      return json({raw:pick(ctx.rawCharacters,ctx.onlyUnitIds), units, items, equipment:pick(state.equipment,Object.values(items).map(i=>i.templateId)), skills:pick(state.skills,rows.flatMap(u=>[...(u.skills??[]), ...Object.keys(u.inventory??{})])), statusTemplates:state.statusTemplates});
    }
    if (ctx.rosterText != null) return ctx.rosterText;
    if (!state) return sources.roster || '';
    const templates = new Set(Object.values(state.items ?? {}).map(item => item.templateId));
    const skillIds = new Set(Object.values(state.units ?? {}).flatMap(unit => [...(unit.skills ?? []), ...Object.keys(unit.inventory ?? {})]));
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
    case 'task': return expand(ctx.taskText ?? (ctx.kind === 'chat' ? '【辅助 AI 对话】玩家咨询时，直接用文字回答。玩家明确要求调整已加载的战局时，输出 {"patch":[{"op":"replace","path":"/units/p1/armor","value":6}],"unresolved":[]} 形状的 JSON，按请求使用快照中的真实路径和值。装备、技能和状态的变更值遵循上面的 VM 协议。标准化任务单独处理警告。' : PATCH_RULES + (instruction ? '\n玩家补充：{{user_instruction}}' : '')));
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
