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
• 常规评级主击用模板 power 配合 damage 骰子对象。[威力: X 物理] 等价于 [威力: X][伤害: 物理]。转换器遇到 [威力: X] 且没有自定义 active 主伤规则时，会自动生成 damage:{count:1,sides:4,stat}，单一伤害标签存在时再写入 type。只有混合伤害或明确的独立公式才由 active 规则替代模板主击，不要重复添加主击。混合伤害、固定伤害包或独立公式才由 active 规则写 damage 指令，同一笔伤害只结算一次。
• 混合伤害（如物理与能量按数值或百分比并列）在 hook:"active" 内拆为多条按序执行的 damage 指令，各分量按同一基准求值，不再额外叠加模板总威力主击。标准伤害标签如 [威力:75][伤害:能量45/真实30] 即使另有叙事效果，也已自动解析威力与主击；范围规则用 for_each 的 from:"action_targets" 逐个处理本次行动已圈定的单位。保留已生成的规则，只补尚未实现的附加效果，不要再按总威力或各分量重复添加伤害。
• [关联属性: <属性>] 或标签中的五维名称指向施术者主属性（str / agi / con / int / spi），需属性缩放时写入 damage.stat 或在公式中读 self.<stat>；原文要求抵抗范围技能的附带效果时，在 after_hit 规则里用 check(kind:"save")，并在 onPass/onFail 中结算附带效果。用 event.skillId == skill.id 限定来源。
• [单体] → shape:"single"，target 依描述选取；[范围: <档位>(N)+<形状>(<阵营>)] → rawRadius:N、shape 对应枚举、target 对应枚举，有效距离另映射至 rawRange；角度标签映射至 angle。原生范围主击按 shape 自动命中，无需额外配置命中检定。附带效果的豁免写 DSL，不要用模板 save/saveDC 表达附带效果。原生范围伤害用 target:"enemy" 限定敌方，target:"any" 为无差别波及（覆盖自身格时也会命中自身）。VM 选择器 from:"units" 为未过滤全集，必须在 where 中按原描述显式声明存活与敌我条件。
• 原文效果为空且无其他待实现战斗描述时无需补丁，也不列入 unresolved。位移、治疗、资源恢复、状态授予与场地生成均按原描述拆解为对应指令。`;
const diagnosisProtocol = '诊断归属：在解决问题的 patch 操作上填写 resolves 数组，每项复制警告的 {unitId, originPath, message}（无来源路径用 null）。同一路径内标题唯一时也可用短收据 {unitId, originPath, effectName}，effectName 逐字复制「」内标题（包括微弱法则及方括号）。resolves 只属于补丁操作。逐条交代警告：实现的用实际补丁的 resolves 或已有实现的 existing；未实现的用带原因的 unresolved；纯叙事用 narrative。若同一条警告只实现了一部分，在实现该部分的操作上写 resolves，并在 unresolved 里用同一引用说明还缺什么。只创建状态模板而未接回原技能不算完成。已有规则不是 VM 缺口：如果该行为已由先前标准化补丁实现，本次不再改动，必须附顶层 existing 数组。若警告为合并描述，复制完整 message；只有带唯一「效果名」的警告可用 effectName 代替 message。每项给 {unitId,originPath,message,path,value}，也可按上述规则用 effectName 替代 message；path 指向该模板的具体 rules/N 或 mods/N，value 完整复制该条规则或修饰。引擎会核对既有写入和当前值；不准用同路径无关条目冒充证据，不要重复 add 或报 unresolved。';
const protocol = [ENGINE_API_SUMMARY, TAG_MAPPING, VM_EFFECT_PROTOCOL, STATUS_CATALOG, diagnosisProtocol].join('\n\n');

// Wire contract: normalization in overlay.js; value schemas in api/validation.js.
export const PATCH_RULES = String.raw`【输出目标】
输出一个 JSON 对象。patch、unresolved、narrative 是数组，已有实现的证据用 existing 数组。补丁路径以当前战局快照为准。快照的 raw、MVU 和 char_info 是只读来源，里面的「效果」/ effects 只用于理解词条。禁止写 /effects/... 或修改来源资料，写入对应模板的 rules / mods / pools 等合法字段。narrative 数组每项为 {unitId,originPath,message,reason}，只收录纯叙事条目。无法实现的战斗机制用同样形状写进 unresolved。

【四步编译工作流（提交前逐条自检）】
1. 核对宿主模板基座（防漏主击 damage / 防双倍结算 / 防错绑按钮）：
   • 主击完备性：同时缺少 damage 骰子对象和 active 主击伤害规则时，才缺少主击。转换器会为 [威力: X] 自动写入 damage。若伤害类型没有结构化标签，转换器会保留 damage 主击并单独产生“主击伤害类型待标准化”警告，若原始效果明确给出单一主击类型，用 add 写入缺失的 /skills/<id>/damage/type（已有该字段才用 replace），保留原生主击。若原文明确要求混合伤害或独立公式替代主击，同批 remove /skills/<id>/damage 并写 active 规则。原文无法确认类型时写 unresolved 并说明原因。若快照仍是旧数据、已有 power 但缺 damage，只有在确认原文是单一常规主击时才补 damage。混合伤害或明确自定义公式主伤在 hook:"active" 内替代模板主击。二者必居其一，严禁重复结算。
   • 模式与入口：被动技能必设 passive:true、ap:0 且不写 active 规则。装备自身的无目标 0 AP 开关写装备模板 hook:"active"（配 label 与限次字段）；需选目标、有射程或耗资源的装备主动技，先 add /skills/<id> 再将该 ID 加入装备模板 skills 数组，同一效果只用一种方式挂载。
2. 选择机制落点（mods vs active 顺序链 vs 常驻事件 hook）：
   • 常驻属性、加减伤、穿甲、行动锁、先手、敌方测距偏移 → 写声明式 mods（动态条件写 when，stat 必须取协议枚举）。HP/MP/SP 是资源池，sp、maxSp 等不是 mods.stat。若来源数值已计入快照的资源上限，保留当前面板，避免叠加；若还需装备联动且没有等价实现，逐项写 unresolved 并说明原因。
   • 单次主动施放内的因果链（结算伤害 → 按实扣量回血／回能／推拉／二段检定） → 全部按序写在同一个 hook:"active" 内，用指令的 out / outCount 把实际结算结果存入 vars.<名> 供后续指令读取，不要拆成事件钩子。
   • 跨行动触发或配合模板 power + damage 主击的附加效果 → 挂对应事件 hook。单位持有的所有技能的非 active 规则默认全局常驻，若某规则仅在施放本主动技能时触发，filter 必须包含 event.skillId == skill.id（命中／伤害事件配 attacker.id == self.id && event.skillId == skill.id；切勿误用仅属召唤物顶替事件的 event.sourceSkillId）。
3. 显式声明集合边界与跨阶尺度：
   • select.from == "units" 包含全场存活者、阵亡尸体、友军与 self 自身！选敌写 where:"candidate.alive && candidate.team != self.team"；无差别波及但排除自身写 where:"candidate.alive && candidate.id != self.id"；选友军写 where:"candidate.alive && candidate.team == self.team"。原生范围模板若不应波及施术者，勿设 target:"any"。
   • 词条相对档位距离／半径在模板上写 rawRange / rawRadius / rawInnerRadius / rawWidth，在 VM 选择器与公式中写 scale_cells(n)；位移标签 [位移: X] 写 move 的 distance:X 与 distanceUnit:"position"。
4. 同批拓扑顺序与交互完整性：
   • 新建的 /statusTemplates/<id> 与 /skills/<id>（含召唤物专属技能）排在 patch 数组前部先 add，后部再引用。任意主动或被动钩子需要玩家点选格子／目标／分支／数值时直接使用 ask（配 aiPolicy），不得以“需要交互”为由放弃。

【宿主模板闭合字段与枚举全表】
所有模板对象均为闭合结构，禁止写入未列出的键；缺键用 add，已有键用 replace：
• 骰子对象 dice（用于 damage / heal）：必填 count（整数 0…1000000）、sides（count>0 时整数 ≥1）；可选 bonus（整数）、stat（枚举：str / agi / con / int / spi）、multiplier（数值 0…8）、type（damage 伤害类型枚举：physical / energy / mental / true）。协议规则下常规主击由模板 power、关联属性 stat 与伤害类型 type 驱动，但 damage 对象必须存在（如 {"count":1,"sides":4,"stat":"str","type":"physical"}）。
• 额外消耗对象 resourceCost：{"hp"?:0…25000, "mp"?:0…25000, "sp"?:0…25000}（至少一项），或自定义装备池 {"resource":"<池ID>", "amount":1…1000000}。
• 自定义池表 pools：{"<池ID>": {"cap": 非负数或数值Expr, "initial"?: 非负数或数值Expr（≤cap）, "reloadable"?: boolean}}（已有装备初始化需数值 cap；装备规则内用 resource 的 local:true 读写本实例池）。
• 通用载体字段（装备、技能、状态模板均支持）：tags（小写标签数组 ^[a-z0-9][a-z0-9_-]{0,31}$）、tier（整数 1…7）、vars（ID → Expr）、flags（枚举数组：undispellable / concept_immune）、mods（statMod 数组）、rules（rule 数组）、pools（装备与技能支持）。
• 技能模板 /skills/<id>：
  - 必填：name（非空文本）、ap（整数 0 / 1 / 2，0 不占槽）、slot（枚举：attack / action）、range（整数 0…64）、shape（枚举：single / circle / ring / fan / cone / line）、target（枚举：enemy / ally / self / any / corpse / cell）。
  - 可选：quality（枚举：唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、power（整数 0…1000000000）、mp（整数 0…25000）、sp（整数 0…25000）、resourceCost、damage（dice 对象）、heal（dice 对象）、damageType（枚举：physical / energy / mental / true）、accuracy（整数 -20…30）、initiativeBonus（整数 -100…100，按 slot 计入开场先手）、passive（boolean）、backpackItem（仅背包消耗品为 true，须配 ap:1、slot:"action"，保留库存且不加入单位 skills）、school（文本）、save（枚举：str / agi / con / int / spi，须与 saveDC 成对出现）、saveDC（整数 1…50、缩放对象或 Expr 字符串）、radius / innerRadius / width（数值 0…30）、angle（整数 1…360）、rawRange / rawRadius / rawInnerRadius / rawWidth / rawMoveDistance（非负数）。
• 装备模板 /equipment/<id>：
  - 必填：name。武器若声明 range（整数 0…64）则必须同时声明 damage（dice 对象），二者成对出现；武器斜杠分段距离第一项归模板普攻，后续项依次归挂载的装备主动技能。
  - 可选枚举：quality（唯一 / 普通 / 优良 / 稀有 / 史诗 / 传说 / 神话）、kind（weapon / shield / armor / accessory / consumable）、weaponClass（light_blade / ranged / greatsword / staff / shield / auxiliary）、hand（one_handed / two_handed / off_hand）、rangeType（melee / ranged）、shape（single / circle / ring / fan / cone / line）、target（enemy / ally / self / any / cell）。
  - 可选数值与布尔：attack（整数 0…1000000000）、accuracy（整数 -20…30）、armor（整数 0…1000000）、defense（整数 0…1000000）、ranged / closeQuarters / heavy / twoHanded / shield（boolean）、boundTo（单位 ID）、weaponType（文本）、skills（技能 ID 数组，去重）、radius / innerRadius / width / angle / raw* 距离字段及通用载体字段。

【输出与 RFC 6902 补丁协议】
• 只输出一个顶层 JSON 对象，结构固定为：
  {"patch":[{"op":"add","path":"<允许路径>","value":"<合法模板或字段值>","resolves":[{"unitId":"<单位ID>","originPath":"<来源路径或null>","message":"<原警告全文>"}]}],"unresolved":[],"narrative":[]}
  三个顶层数组键必填；如引用先前批次已落地的规则作为证据，必须另附 existing 数组，逐项填写 {unitId,originPath,message,path,value}；带唯一效果名时可用 effectName 替代 message。正文声称“已完成”而 JSON 没有对应 patch.resolves 或 existing 收据，视为未核销，不能用空 patch 代替。不要输出解释、注释、Markdown 代码块、JS 调用或额外包装。
• 允许 op 枚举：add / replace / remove。允许 path 白名单正则：/^\/(?:equipment|skills|items|statusTemplates)\/|^\/units\/[^/]+\/(?:(?:statuses|armor)(?:\/|$)|skills$)/
  - /equipment/<id>：装备模板；若对应道具实例 /items/<id> 已自带 rules 或 mods，同批同步更新并保留实例独有内容。
  - /skills/<id>：技能模板或其合法子字段（如 /skills/<id>/damage、/skills/<id>/rules/-）。
  - /statusTemplates/<id>：自定义状态模板（新英文 ID 匹配 ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$，不覆盖内置状态名）。
  - /units/<unitId>/statuses、/units/<unitId>/armor（整数 0…1000000）、/units/<unitId>/skills（完整技能 ID 数组，保留原有项）。
• 诊断核销：只处理本批警告。同一模板多项警告部分解决时，在 resolves 中逐条列出已实现警告的完整 {unitId, originPath, message}；仍无法表达的部分列入 unresolved，复制原警告 {unitId, originPath, message} 并附简短中文 reason；仅纯叙事、日常储物空间（如 1km³ 次元戒）、跨位面非战斗传送或元设定可列入 narrative（附完整引用与 reason），含任何战斗机制的条目严禁豁免。
• 禁止直接修改运行时资源池当前值、单位当前 HP/MP/SP、阵营、坐标、先攻队列或日志。先尝试用正交原语拆解组合，再考虑放弃；提交前逐项检查 hook 枚举、op 闭合字段、目标引用、池名称、状态 ID 与数值范围。`;
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
