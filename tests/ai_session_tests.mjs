import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiSessions } from '../src/tavern/ai-sessions.js';
import { chatUndoChanges, chatInversePatch } from '../src/tavern/ai-patch-undo.js';
import { fetchModels, requestViaCustomApi } from '../src/tavern/api.js';
import { assembleMessages, DEFAULT_SLOTS, describeSlots, makeCustomSlot, resolveSlotContent } from '../src/tavern/prompts.js';

import { validVmRule, vmHooks, vmSchema } from '../src/core/vm-schema.js';
import { applyAction, currentUnit, refreshOpeningInitiative } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { dispatchVMHook } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyPatch, extractJsonBlocks, parseAIResponse, stripReasoningBlocks, partitionNormalizationPatch, formatRejectedItem } from '../src/tavern/overlay.js';

test('多信封只合并完整的处置数组，不抢救残缺或嵌套信封', () => {
  const p = {op:'add',path:'/skills/a/mods',value:[]};
  const first = JSON.stringify({patch:[p]}), second = JSON.stringify({patch:[p],narrative:[]});
  for (const raw of [first + second, '```json\n'+first+'\n'+second+'\n```', '```json\n' + first + '\n```\n```json\n' + second + '\n```', first+'\n'+second+'\n完成。']) {
    assert.deepEqual(parseAIResponse(raw+'</std_audit></thinking></thought></analysis></think>').data,{patch:[p,p],narrative:[]});
  }
  for (const tail of ['}', '{"patch":[', '{"patch":[], broken}', '{"patch":{}}', '{"other":[]}', '```json\n{"patch":\n```']) {
    const r=parseAIResponse(first+'\n'+tail); assert.equal(r.data,null,tail); assert.match(r.parseError,/JSON/);
  }
});

test('实际 roster 槽只发目标原文；附属技能入表，活状态与兄弟机制只读', () => {
  const state={units:{a:{skills:['core','sib'],mainHand:'i'},b:{skills:['alien']}},items:{i:{templateId:'gear'}},equipment:{gear:{name:'剑',skills:['derived']}},
    skills:{core:{name:'定义'},sib:{name:'余波',passive:true,rules:[{}]},derived:{name:'剑技'},alien:{name:'他人技能'}},statusTemplates:{ice:{name:'冻伤',maxStacks:5,stackMode:'stack',tags:['冰'],mods:[{stat:'speed'}],rules:[{hook:'turn_end'}]}}};
  const long='未命中载体全文'.repeat(500), entries={a:{unit:[{等级:7}], 'skills:core':{效果:'本批定义原文'}, 'skills:sib':{效果:`「冻伤」${long}`}}};
  const ctx={state,onlyUnitIds:['a'],characterEntries:entries,rawCharacters:{a:{技能:{定义:'本批定义原文',余波:long}}},sources:{warnings:[{unitId:'a',originPath:'/skills/core/mods',message:'待处理'}]}};
  const [payload,index]=assembleMessages(DEFAULT_SLOTS.filter(s=>s.id==='roster'),ctx)[0].content.split('\n<role_readonly_index DO_NOT_PATCH="true">');
  const roster=JSON.parse(payload); assert.deepEqual(Object.keys(roster.skills),['core','sib','derived']);
  assert.deepEqual(roster.raw.a,{unit:[{等级:7}],'skills:core':{效果:'本批定义原文'}}); assert.ok(!payload.includes(long));
  assert.match(index,/ice\|冻伤\|5\/stack\|冰\|speed\|turn_end/); assert.match(index,/被动技能\]sib.*冻伤.*1规则/);
  assert.match(index,/主动技能\]derived/); assert.doesNotMatch(index,/定义|他人技能/); assert.ok(index.length < 600);
});

test('场景批次只读本批警告与目标区域，其他区域只进联动索引', () => {
  const scene = { unitId: null, originPath: '/zones/mist', message: '雾区编译' };
  const character = { unitId: 'p1', originPath: '/skills/s1', message: '非本批角色诊断' };
  const legacy = { unitId: null, originPath: null, message: '非本批全局诊断' };
  const state = { units: { p1: { name: '角色私有数据' } }, zones: {
    mist: { name: '雾区', area: { shape: 'board', z1: 1 }, mods: [], rules: [] },
    wind: { name: '风区', area: { shape: 'rect' }, tags: ['gust'], mods: [{ stat: 'dodge' }], rules: [{ hook: 'turn_end' }] },
  } };
  const zoneEntries = { mist: { description: '本批区域原文' }, wind: { description: '非目标区域原文' } };
  const ctx = { state, onlyUnitIds: [null], warnings: [scene], sources: { warnings: [scene, character, legacy], zoneEntries } };
  const slots = DEFAULT_SLOTS.filter(s => ['roster', 'warnings'].includes(s.id));
  const [message] = assembleMessages(slots, ctx);
  const [payload, index] = message.content.split('\n<role_readonly_index DO_NOT_PATCH="true">');
  assert.deepEqual(JSON.parse(payload), { raw: {}, units: {}, items: {}, equipment: {}, skills: {},
    zones: { mist: state.zones.mist }, rawZones: { mist: zoneEntries.mist } });
  assert.match(index, /sharedZoneLedger[\s\S]*wind\|风区\|rect\|gust\|dodge\|turn_end/);
  assert.match(index, /"unitId": null/);
  assert.match(index, /雾区编译/);
  assert.doesNotMatch(message.content, /非本批角色诊断|非本批全局诊断|非目标区域原文|角色私有数据/);
  const role = resolveSlotContent({ id: 'roster' }, { ...ctx, onlyUnitIds: ['p1'], warnings: [character] });
  const [rolePayload, roleIndex] = role.split('\n<role_readonly_index');
  assert.equal('zones' in JSON.parse(rolePayload), false);
  assert.equal('rawZones' in JSON.parse(rolePayload), false);
  assert.match(roleIndex, /mist\|雾区\|board/);
  assert.equal(resolveSlotContent({ id: 'warnings' }, { ...ctx, warnings: [] }), '');
});

test('每个 VM 指令的用法说明进入实际组装的默认助手消息', () => {
  const messages = assembleMessages(DEFAULT_SLOTS, {});
  for (const opcode of vmSchema.$defs.opcode.oneOf) {
    const op = opcode.properties.op.const;
    assert.match(opcode.description, /\p{Script=Han}/u, op);
    assert.ok(messages.some(m => m.content.includes(`• ${op}：${opcode.description}`)), op);
  }
});

const gate = (id, description, fn) => test(`${id} ${description}`, fn);

gate('G41', '身份槽位在首位且包含完整职责', () => {
  const identity = DEFAULT_SLOTS[0];
  assert.equal(identity.id, 'identity');
  assert.equal(identity.role, 'system');
  assert.ok(identity.content.length >= 300 && identity.content.length <= 600);
  for (const text of ['你是命定战斗助手', '待处理警告', '必须', '不做叙事、不扮演角色、不推进剧情']) assert.ok(identity.content.includes(text));
});

gate('G42', '内置与新建自定义槽位默认均为 system', () => {
  assert.deepEqual(DEFAULT_SLOTS.map(slot => slot.id), ['identity', 'protocol', 'roster', 'battle', 'raw', 'warnings', 'task', 'extra']);
  assert.equal(DEFAULT_SLOTS.find(slot => slot.id === 'raw').enabled, true);
  assert.ok([...DEFAULT_SLOTS, makeCustomSlot()].every(slot => slot.role === 'system'));
});

gate('G43', '合并保持内容和顺序，跳过空槽位，assistant 独立', () => {
  const slots = DEFAULT_SLOTS.map(slot => ({ ...slot, enabled: true }));
  const ctx = { kind: 'chat', rawCharacters: { p1: { mvu: { 原文: '角色资料' } } }, rosterText: '参战快照', battleText: '地形快照', warningsText: '警告清单', extraText: '额外约定' };
  assert.deepEqual(assembleMessages(slots, ctx), [{
    role: 'system', slotId: slots.map(slot => slot.id).join('+'), slotLabel: slots.map(slot => slot.label).join(' / '),
    content: slots.map(slot => resolveSlotContent(slot, ctx)).join('\n\n'),
  }]);
  const [message] = assembleMessages(slots, { ...ctx, extraText: '   ' });
  assert.equal(message.slotId, slots.slice(0, -1).map(slot => slot.id).join('+'));
  assert.equal(message.content, slots.slice(0, -1).map(slot => resolveSlotContent(slot, ctx)).join('\n\n'));
  assert.equal(assembleMessages(slots.slice(0, 2).map(slot => ({ ...slot, role: 'assistant' }))).length, 2);
});

gate('G44', '旧内置 user 一次迁移，自定义 role 保留', () => {
  const custom = { ...makeCustomSlot(), role: 'user', content: '保留自定义角色' };
  const legacy = [...DEFAULT_SLOTS.slice(1).map(slot => ({ ...slot, role: 'user' })), custom];
  const migrated = describeSlots(legacy);
  assert.equal(migrated[0].id, 'identity');
  assert.ok(migrated.slice(0, -1).every(slot => slot.role === 'system'));
  assert.deepEqual(migrated.at(-1), custom);
  migrated[2].role = 'user';
  assert.deepEqual(describeSlots(migrated), migrated);
});

test('旧提示词配置自动补原始资料槽，保留各槽顺序和停用状态', () => {
  const get = id => ({ ...DEFAULT_SLOTS.find(slot => slot.id === id) });
  const saved = [get('identity'), { ...get('task'), enabled: false }, makeCustomSlot(), get('battle'), get('roster')];
  const next = describeSlots(saved);
  assert.deepEqual(next.filter(slot => slot.id !== 'raw'), saved);
  assert.equal(next[next.findIndex(slot => slot.id === 'battle') + 1].id, 'raw');
  assert.deepEqual(describeSlots(describeSlots([{ id: 'battle', enabled: false }])),
    DEFAULT_SLOTS.map(slot => slot.id === 'battle' ? { ...slot, enabled: false } : slot));
  next.find(slot => slot.id === 'raw').enabled = false;
  assert.deepEqual(describeSlots(next), next);
});

gate('G45', '去样板化协议全貌、四步编译流与闭合枚举披露', () => {
  const protocol = resolveSlotContent({ id: 'protocol' });
  const task = resolveSlotContent({ id: 'task' });
  const combined = `${protocol}\n${task}`;
  // Zero concrete business JSON recipes or character-specific templates may remain
  for (const boilerplate of ['低伤校准', '蓄能徽记', '狂笑失能', '雪域', '亡卫斩', '星霜', '裂隙投射', '汲血打击', '旋风横扫', '物理40/能量20']) {
    assert.ok(!combined.includes(boilerplate), `提示词不应残留具体业务样板：${boilerplate}`);
  }
  // Neutral envelope skeleton parses cleanly as valid JSON with the three required top-level arrays
  const envelope = JSON.parse(task.match(/^\s*(\{"patch":\[\{.*\}\],"unresolved":\[\],"narrative":\[\]\})/m)[1]);
  assert.deepEqual(Object.keys(envelope), ['patch', 'unresolved', 'narrative']);
  // Complete VM hook & opcode & closed template enum disclosure
  assert.deepEqual(protocol.match(/^允许 hook 枚举：(.+)。$/m)[1].split(' / '), vmHooks);
  const opcodeSection = protocol.split('【Opcode】')[1].split('\ncheck：')[0];
  const defs = vmSchema.$defs;
  assert.deepEqual([...opcodeSection.matchAll(/^• (\w+)：(.+?) (?=\{[A-Za-z]+\??: )/gm)].map(match => match.slice(1)),
    defs.opcode.oneOf.map(schema => [schema.properties.op.const, schema.description]));
  const askLine = opcodeSection.match(/^• ask：.*$/m)[0];
  assert.deepEqual(askLine.match(/aiPolicy: ([^，}]+)/)[1].split(' / '),
    defs.opcode.oneOf.find(schema => schema.properties.op.const === 'ask').properties.aiPolicy.enum);
  const modsLine = protocol.match(/^mods 数组每项：.*$/m)[0];
  assert.deepEqual(modsLine.match(/stat\?: ([^，}]+)/)[1].split(' / '), defs.statMod.properties.stat.enum);
  assert.deepEqual(modsLine.match(/flags\?: 数组<([^>]+)>/)[1].split(' / '), defs.statMod.properties.flags.items.enum);
  assert.deepEqual(protocol.match(/顶层 flags 枚举为 (.+?)。/)[1].split(' / '), defs.spawn_zone.properties.flags.items.enum);
  for (const token of [
    'event.skillId == skill.id', 'candidate.alive && candidate.team != self.team',
    'light_blade / ranged / greatsword / staff / shield / auxiliary',
    'one_handed / two_handed / off_hand', 'single / circle / ring / fan / cone / line',
    'enemy / ally / self / any / corpse / cell', 'battle_turns / until_removed / persistent',
    'refresh / stack / replace / extend', 'undispellable / concept_immune',
    'intentBonus', 'intentDifficulty', '{stat:"intentBonus", flat:5, when:"event.intent == \'core\'"}',
    'when:"event.intent != \'normal\'"', 'overrides.intent', 'controlPolicy:{intentLock:"kill"}',
    'sharedPoolLedger', 'siblingCarriersIndex', 'sharedZoneLedger', 'initial ?? 0', '/zones/<id>/', '{locks:["fly"]}',
    'hand:"off_hand"', 'kind:"consumable"', 'reloadable:true', '无内置弹反结算',
    'normal / function / core / kill / concept', '超暴击 / 强暴击 / 平暴击 / 有效 / 勉强 / 擦伤 / 失手',
    'physical / energy / mental / true', '同时缺少 damage 骰子对象和 active 主击伤害规则时，才缺少主击',
    '先尝试用正交原语拆解组合，再考虑放弃', '仍无法表达的部分列入 unresolved', '检查 hook 枚举、op 闭合字段、目标引用、池名称、状态 ID 与数值范围',
  ]) assert.ok(combined.includes(token), `提示词漏披露关键语义或枚举：${token}`);
  assert.doesNotMatch(protocol, /spirit/);
  assert.doesNotMatch(task, /卡在哪一步/);
});

test('主动吸血 out 链、周身选敌与 skill.id 作用域隔离在生产 VM 中互不串味且不误伤自身', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const ally = Object.values(state.units).find(u => u.team === actor.team && u.id !== actor.id);
  const enemy = Object.values(state.units).find(u => u.team !== actor.team);
  ally.x = actor.x; ally.y = actor.y;
  const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => ({ x: actor.x + dx, y: actor.y + dy }))
    .find(at => state.grid[at.y]?.[at.x]?.kind === 'floor');
  enemy.x = adj.x; enemy.y = adj.y;
  if (state.pools?.[enemy.pools?.hp]) {
    state.pools[enemy.pools.hp].contributors[0].maxBase = state.pools[enemy.pools.hp].max = state.pools[enemy.pools.hp].current = 300;
  }
  enemy.hp = enemy.maxHp = 300;
  const damagedHp = Math.max(1, actor.maxHp - 50);
  if (state.pools?.[actor.pools?.hp]) state.pools[actor.pools.hp].current = damagedHp;
  actor.hp = damagedHp;
  const startActorHp = actor.hp, startAllyHp = ally.hp, startEnemyHp = enemy.hp;

  state.statusTemplates ??= {};
  state.statusTemplates.kiss_mark = { id: 'kiss_mark', name: '血印', category: 'debuff', remainingTurns: 2 };
  state.skills.blood_kiss = {
    name: '汲血之吻', ap: 1, slot: 'attack', range: 2, shape: 'single', target: 'enemy',
    rules: [
      { id: 'blood_kiss', hook: 'active', program: [
        { op: 'damage', target: 'target', amount: '40 + self.spi', damageType: 'energy', out: 'dealt' },
        { op: 'if', cond: 'vars.dealt > 0', then: [{ op: 'heal', target: 'self', amount: 'floor(vars.dealt * 0.5)' }] },
      ] },
      { id: 'kiss_mark_on_damage', hook: 'after_damage', filter: 'attacker.id == self.id && event.skillId == skill.id && event.dealt > 0',
        program: [{ op: 'apply_status', target: 'target', statusId: 'kiss_mark' }] },
    ],
  };
  state.skills.dark_realm = {
    name: '蒂露万暗界M', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self',
    rules: [{ id: 'whirl_cut', hook: 'active', program: [
      { op: 'for_each', select: { from: 'units', area: { shape: 'circle', origin: 'self', radius: 'scale_cells(2)' }, where: 'candidate.alive && candidate.team != self.team' },
        bind: 'foe', body: [{ op: 'damage', target: 'vars.foe', amount: '30 + self.str', damageType: 'physical' }] },
    ] }],
  };
  actor.skills.push('blood_kiss', 'dark_realm');
  validateState(state);

  applyAction(state, { type: 'skill', skillId: 'dark_realm', x: actor.x, y: actor.y });
  assert.equal(actor.hp, startActorHp, 'AoE 选敌不得误伤自身，且不得触发汲血之吻回血');
  assert.equal(ally.hp, startAllyHp, 'AoE 选敌不得误伤同格友军');
  assert.ok(enemy.hp < startEnemyHp, 'AoE 选敌应命中范围内敌军');
  assert.equal(enemy.statuses?.kiss_mark, undefined, '其他技能造成伤害不得触发锁了 skill.id 的汲血之吻钩子');

  const beforeKissEnemyHp = enemy.hp;
  applyAction(state, { type: 'skill', skillId: 'blood_kiss', x: enemy.x, y: enemy.y, targetId: enemy.id });
  const dealt = beforeKissEnemyHp - enemy.hp;
  assert.ok(dealt > 0);
  assert.equal(actor.hp, Math.min(actor.maxHp, startActorHp + Math.floor(dealt * 0.5)));
  assert.ok(enemy.statuses?.kiss_mark, '施放汲血之吻本体时触发 skill.id 匹配的钩子');
});

test('同批新增状态与召唤物专属技能补丁在生产战局中按拓扑序直接执行', () => {
  const message = assembleMessages(DEFAULT_SLOTS, { kind: 'validate' }).map(row => row.content).join('\n');
  assert.doesNotMatch(message, /平暴击×1\.3|切磋40%/);
  const patch = [
    { op: 'add', path: '/statusTemplates/guard_chill', value: { id: 'guard_chill', name: '星霜', category: 'control', remainingTurns: 2, mods: [{ locks: ['move'] }] } },
    { op: 'add', path: '/skills/guard_slash', value: { name: '亡卫斩', ap: 1, slot: 'attack', range: 2, shape: 'single', target: 'enemy', power: 20,
      damage: { count: 1, sides: 4, type: 'physical' },
      rules: [{ id: 'chill_on_hit', hook: 'after_hit', filter: 'attacker.id == self.id && event.skillId == skill.id', program: [{ op: 'apply_status', target: 'target', statusId: 'guard_chill' }] }] } },
    { op: 'add', path: '/skills/call_guard/rules/-', value: { id: 'summon_guard', hook: 'active', program: [{ op: 'spawn', entityKind: 'unit', spec: { name: '亡卫', spawnPanel: { skills: ['guard_slash'] } } }] } },
  ];
  const initial = buildScenario('ruins');
  initial.statusTemplates ??= {};
  initial.skills.call_guard = { name: '召唤亡卫', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [] };
  currentUnit(initial).skills.push('call_guard');
  const state = validateState(applyPatch(initial, patch, true));
  const actor = currentUnit(state);
  applyAction(state, { type: 'skill', skillId: 'call_guard', x: actor.x, y: actor.y });
  const guard = Object.values(state.units).find(unit => unit.name === '亡卫');
  assert.deepEqual(guard?.skills, ['guard_slash']);
  assert.equal(state.statusTemplates.guard_chill.name, '星霜');
});

test('结界生成、磁带重放与资源落盘拦截在生产 VM 中结算', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
  actor.rules = [
    { id: 'seal_resources', hook: 'before_commit', filter: "event.targetId == self.id && (event.pool == 'hp' || event.pool == 'mp' || event.pool == 'sp') && event.sourceRuleId != 'seal_release'",
      program: [{ op: 'mutate_event', patch: { cancel: true } }] },
    { id: 'repeat_turn', hook: 'turn_end', usesPerBattle: 1, filter: 'self.resource.attack == 0 && self.resource.action == 0',
      program: [{ op: 'for_each', select: { from: 'tape', where: 'candidate.actorId == self.id && candidate.round == round && candidate.turn == turn' },
        bind: 'entry', body: [{ op: 'perform', actor: 'self', actionKind: 'replay', tapeRecord: 'vars.entry' }] }] },
  ];
  state.skills.weather = { name: '天气', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [{
    id: 'place_zone', hook: 'active', program: [{ op: 'spawn', entityKind: 'zone', spec: {
      name: '结界', tags: ['frost_zone'], remainingTurns: 2, area: { shape: 'circle', center: 'center', radius: 10 },
      rules: [{ id: 'zone_tick', hook: 'turn_start', filter: 'self.team != source.team', program: [{ op: 'damage', target: 'self', amount: 10, damageType: 'true', direct: false }] }],
    } }],
  }] };
  state.skills.probe = { name: '资源探针', ap: 1, slot: 'attack', range: 0, shape: 'single', target: 'self', rules: [{
    id: 'probe_changes', hook: 'active', program: [
      { op: 'damage', target: 'self', amount: 3, damageType: 'true' },
      { op: 'heal', target: 'self', amount: 2 },
      { op: 'resource', target: 'self', pool: ['mp', 'sp'], mode: 'set', amount: 0 },
    ],
  }] };
  actor.skills.push('weather', 'probe');
  const cast = skillId => applyAction(state, { type: 'skill', skillId, x: actor.x, y: actor.y });
  const probe = structuredClone(state);
  delete probe.units[actor.id].rules;
  applyAction(probe, { type: 'skill', skillId: 'probe', x: actor.x, y: actor.y });
  assert.notEqual(probe.units[actor.id].hp, actor.hp);
  const resources = [actor.hp, actor.mp, actor.sp];
  assert.ok(actor.mp > 0 && actor.sp > 0);
  cast('probe');
  assert.deepEqual([actor.hp, actor.mp, actor.sp], resources);
  cast('weather');
  const hp = enemy.hp;
  dispatchVMHook(state, 'turn_start', { actorId: enemy.id, targetId: enemy.id, ownerIds: [enemy.id] });
  assert.equal(enemy.hp, hp - 10);
  const replay = applyAction(state, { type: 'brace' }).filter(row => row.type === 'action').map(row => row.detail.action.skillId ?? row.detail.action.type);
  assert.deepEqual(replay, ['brace', 'probe', 'weather', 'brace']);
  assert.equal(state.tape.length, 3);
});

test('技能先手按槽取最大值并复用开场骰，模板上限为射程 64 格、半径 30 格', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  for (const [id, slot, initiativeBonus] of [['one', 'attack', 8], ['two', 'attack', 5], ['three', 'action', 6]]) {
    state.skills[id] = { name: id, ap: 0, slot, initiativeBonus, range: 30, radius: 30, shape: 'circle', target: 'cell' };
    actor.skills.push(id);
  }
  validateState(state);
  const opening = () => state.logs[0].detail.initiative.find(row => row.unitId === actor.id);
  const { roll, total } = opening();
  refreshOpeningInitiative(state);
  assert.deepEqual([opening().roll, opening().total, opening().attackInit, opening().actionInit], [roll, total + 14, 8, 6]);
  state.skills.one.radius = 31;
  assert.throws(() => validateState(state));
  state.skills.one.radius = 30;
  state.skills.one.range = 64;
  validateState(state);
  state.skills.one.range = 65;
  assert.throws(() => validateState(state));
});

test('G97 protocol maps mixed damage, empty effects and worldbook tags without concrete number anchoring', () => {
  const protocol = resolveSlotContent({ id: 'protocol' });
  assert.match(protocol, /混合伤害.*拆为多条按序执行的 damage 指令.*不再额外叠加模板总威力主击/);
  assert.match(protocol, /转换器遇到 \[威力: X\].*自动生成 damage/);
  assert.match(protocol, /原文效果为空且无其他待实现战斗描述时无需补丁，也不列入 unresolved/);
  for (const tag of ['[威力: X 物理]', '[关联属性: <属性>]', '[单体]', '[范围: <档位>(N)+<形状>(<阵营>)]']) assert.ok(protocol.includes(tag), tag);
});

test('标准化协议不暴露失效字段或区域单位池', () => {
  const protocol = resolveSlotContent({ id: 'protocol' });
  assert.doesNotMatch(protocol, /\b(?:controller|allegiance|forcedActionKinds|charged)\b/);
  const zoneSpec = protocol.split('\n').find(line => line.startsWith('• zone：'));
  assert.ok(zoneSpec);
  assert.doesNotMatch(zoneSpec, /\bunitPools\b/);
  assert.match(protocol, /circle\/ring 必填 radius/);
});

test('标准化发送的任务区分只读来源、输出数组和部分实现收据', () => {
  const text = assembleMessages(DEFAULT_SLOTS, { kind: 'validate' }).map(message => message.content).join('\n');
  assert.match(text, /raw、MVU 和 char_info 是只读来源/);
  assert.match(text, /narrative 数组每项为 \{unitId,originPath,message,reason\}/);
  assert.match(text, /sp、maxSp 等不是 mods\.stat/);
  assert.match(text, /只实现了一部分.*写 resolves.*在 unresolved 里用同一引用/);
});

test('默认标准化消息教模型读实体寄存器、动态生成和使用带签名的查询', () => {
  const text = assembleMessages(DEFAULT_SLOTS, {}).map(message => message.content).join('\n');
  for (const snippet of ['target:"vars.<名>"', 'vars.<名>.hp', 'vars.victim.hp',
    '加 vars. 前缀', '空值用 null', 'min(a, b, ...)', 'max(a, b, ...)', 'clamp(value, lo, hi)', 'count_units(predicate)',
    'tier、count、remainingTurns、area.radius 支持数值表达式', 'single 仅中心格', '均省略时按施术者预算自动生成面板']) {
    assert.ok(text.includes(snippet), snippet);
  }
});

test('纯 system 提示词可发送给 Claude 和 Gemini', async () => {
  const messages = [{ role: 'system', content: '标准化任务' }];
  for (const apiSource of ['claude', 'gemini']) {
    const claude = apiSource === 'claude';
    const reply = await requestViaCustomApi({ apiSource, baseUrl: 'https://example.test', apiKey: 'test', model: 'test', stream: false }, messages, {
      async fetchImpl(_url, options) {
        const body = JSON.parse(options.body);
        if (claude) {
          assert.equal(body.system, '标准化任务');
          assert.deepEqual(body.messages, [{ role: 'user', content: '请执行上述任务。' }]);
          return Response.json({ content: [{ type: 'text', text: '完成' }] });
        }
        assert.deepEqual(body.systemInstruction.parts, [{ text: '标准化任务' }]);
        assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: '请执行上述任务。' }] }]);
        return Response.json({ candidates: [{ content: { parts: [{ text: '完成' }] } }] });
      },
    });
    assert.equal(reply, '完成');
  }
  assert.deepEqual(messages, [{ role: 'system', content: '标准化任务' }]);
});

test('独立 API 经酒馆后端拉取模型并生成，使用独立地址和密钥', async () => {
  const origin = 'https://tavern.example.test';
  const settings = { apiTransport: 'tavern', baseUrl: 'https://upstream.example.test/v1/', apiKey: 'aux-key', model: 'aux-model' };
  const messages = [{ role: 'user', content: '测试', source: 'ui' }];
  const signal = new AbortController().signal;
  const routes = [];
  const options = {
    host: { location: { origin } }, signal,
    async fetchImpl(url, init) {
      assert.equal(init.signal, signal);
      assert.equal(init.mode, 'same-origin');
      assert.equal(init.redirect, 'error');
      const route = new URL(url);
      assert.equal(route.origin, origin);
      routes.push(route.pathname);
      if (route.pathname === '/csrf-token') return Response.json({ token: 'csrf-test' });
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-CSRF-Token'], 'csrf-test');
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.chat_completion_source, 'custom');
      assert.equal(body.custom_url, 'https://upstream.example.test/v1');
      assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer aux-key' });
      if (route.pathname.endsWith('/status')) return Response.json({ data: [{ id: 'aux-model' }] });
      assert.equal(body.model, 'aux-model');
      assert.deepEqual(body.messages, [{ role: 'user', content: '测试' }]);
      return body.stream
        ? new Response('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json({ choices: [{ message: { content: '完成' } }] });
    },
  };
  assert.deepEqual(await fetchModels(settings, options), ['aux-model']);
  for (const stream of [true, false]) {
    assert.equal(await requestViaCustomApi({ ...settings, stream }, messages, options), '完成');
  }
  const endpoint = '/api/backends/chat-completions';
  assert.deepEqual(routes, ['/csrf-token', `${endpoint}/status`, '/csrf-token', `${endpoint}/generate`, '/csrf-token', `${endpoint}/generate`]);
});

test('酒馆转发按实际报文识别 SSE 与 JSON，并区分仅推理的结束原因', async () => {
  const settings = { apiTransport: 'tavern', baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'deepseek' };
  const call = (body, type) => requestViaCustomApi(settings, [], { host: { location: { origin: 'https://tavern.test' } },
    fetchImpl: async url => url.endsWith('/csrf-token') ? Response.json({token:'csrf'}) : new Response(body, { headers: { 'Content-Type': type } }) });
  const reasoning = 'data: {"choices":[{"delta":{"reasoning_content":"草稿"}}]}\n\n';
  assert.equal(await call(reasoning + 'data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n', 'application/json'), '正文');
  assert.equal(await call(JSON.stringify({choices:[{message:{content:'正文'}}]}, null, 2), 'text/plain'), '正文');
  await assert.rejects(call(reasoning, 'text/plain'), /未收到 \[DONE\].*推理 2 字符，正文 0/);
  await assert.rejects(call(reasoning + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n', 'text/plain'), /收到 \[DONE\].*finish_reason=length/);
});

test('Claude 和 Gemini 的纯思考回复显示输出长度诊断', async () => {
  for (const [apiSource, finish, response] of [
    ['claude', 'max_tokens', { content: [{ type: 'thinking', thinking: '推理' }], stop_reason: 'max_tokens' }],
    ['gemini', 'MAX_TOKENS', { candidates: [{ content: { parts: [{ thought: true, text: '推理' }] }, finishReason: 'MAX_TOKENS' }] }],
  ]) {
    const settings = { apiSource, baseUrl: 'https://example.test', apiKey: 'test', model: 'test', stream: false };
    await assert.rejects(requestViaCustomApi(settings, [], { fetchImpl: async () => Response.json(response) }),
      new RegExp(`API 设置.*max_tokens.*推理 2 字符，正文 0.*finish_reason=${finish}`));
  }
});

test('独立 API 的推理字段不会进入回复或流式回调', async () => {
  const settings = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' };
  for (const stream of [true, false]) {
    const chunks = [];
    await assert.rejects(requestViaCustomApi({ ...settings, stream }, [], {
      onStreamChunk: text => chunks.push(text),
      async fetchImpl() {
        return stream
          ? new Response('data: {"choices":[{"delta":{"reasoning_content":"推理草稿"}}]}\n\ndata: [DONE]\n\n')
          : Response.json({ choices: [{ message: { reasoning_content: '推理草稿' } }] });
      },
    }), /模型只返回了思考内容.*API 设置.*max_tokens.*每批警告条数.*正文 0/);
    assert.deepEqual(chunks, []);
  }
  const chunks = [];
  const text = await requestViaCustomApi(settings, [], {
    onStreamChunk: text => chunks.push(text),
    async fetchImpl() {
      return new Response('data: {"choices":[{"delta":{"reasoning_content":"推理草稿"}}]}\n\ndata: {"choices":[{"delta":{"content":"正式回复"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(text, '正式回复');
  assert.deepEqual(chunks, ['正式回复', '正式回复']);
});

test('JSON 提取器忽略花括号干扰并支持围栏、裸数组和残缺文本', () => {
  const block = '{"patch":[{"op":"replace","path":"/units/p1/armor","value":9}]}';
  assert.deepEqual(extractJsonBlocks('说明 `{armor}`，配置如下：```json\n' + block + '\n```'), [JSON.parse(block)]);
  const bare = extractJsonBlocks('正文 ' + JSON.stringify(JSON.parse(block).patch));
  assert.deepEqual(bare.find(Array.isArray), JSON.parse(block).patch);
  assert.deepEqual(extractJsonBlocks('普通聊天或 {"patch":[{"op":'), []);
});

test('会话重Roll原位替换助手且不重复用户消息', () => {
  const store = createAiSessions(null, () => {}, () => 100);
  const [user, assistant] = store.append(store.active().id, { role: 'user', content: '把护甲改成8' }, { role: 'assistant', content: '改成6', status: 'ok' });
  const turn = store.prepareReroll(store.active().id, assistant);
  assert.equal(turn.userMessage, user);
  assert.equal(store.active().messages.filter(message => message.role === 'user').length, 1);
  assert.equal(store.active().messages.at(-1), turn.assistantMessage);
});

test('重生成保留旧版本及后续消息，编辑仅替换最后一轮且保留原上下文', () => {
  let saved;
  let store = createAiSessions(null, data => { saved = JSON.parse(JSON.stringify(data)); });
  const id = store.active().id;
  const [, first, last, lastReply] = store.append(id, { role: 'user', content: '第一问' },
    { role: 'assistant', content: '原答', status: 'ok' }, { role: 'user', content: '第二问' },
    { role: 'assistant', content: '第二答', status: 'ok', undoReceipt: { battleKey: 'battle' } });
  const { assistantMessage } = store.prepareReroll(id, first);
  assert.equal(store.active().messages.at(-1), lastReply);
  store.update(id, assistantMessage, { content: '再答', status: 'ok' });
  store = createAiSessions(saved, () => {});
  store.selectVersion(id, store.active().messages[1], 0);
  assert.equal(store.active().messages[1].content, '原答');
  store.selectVersion(id, store.active().messages[1], 1);
  assert.equal(store.active().messages[1].content, '再答');
  assert.equal(store.prepareEdit(id, store.active().messages[0], '不能改'), null);
  assert.equal(store.prepareEdit(id, last, '旧引用不能改'), null);
  const latestUser = store.active().messages[2];
  assert.throws(() => store.prepareEdit(id, latestUser, '编辑'), /先撤销/);
  store.update(id, store.active().messages[3], { undoReceipt: null });
  const edited = store.prepareEdit(id, latestUser, ' 编辑后 ');
  assert.equal(edited.userMessage.content, '编辑后');
  assert.deepEqual(edited.historyBeforeUser, [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '再答' }]);
  assert.equal(store.active().messages.length, 4);
});

test('聊天补丁按实际改动生成逆补丁，保留无关字段并拒绝冲突', () => {
  const before = { units: { 'a/b': { armor: 1, hp: 50, statuses: ['old'] } }, skills: { old: {} } };
  const after = { units: { 'a/b': { armor: 6, hp: 50, statuses: ['new'] } }, skills: { new: {} } };
  const changes = JSON.parse(JSON.stringify(chatUndoChanges(before, after)));
  const current = structuredClone(after);
  current.units['a/b'].hp = 40;
  assert.deepEqual(applyPatch(current, chatInversePatch(current, changes), true), {
    ...before, units: { 'a/b': { ...before.units['a/b'], hp: 40 } },
  });
  current.units['a/b'].armor = 8;
  assert.throws(() => chatInversePatch(current, changes), /\/units\/a~1b\/armor/);
  assert.equal(current.units['a/b'].armor, 8);
});

test('标准化分区放行合法项并保留坏项原因', () => {
  const state = { skills: { good: { name: '好技能' } }, units: { p1: { name: '主角', armor: 1 } } };
  const result = partitionNormalizationPatch({ liveState: state, baselineState: state, rawPatch: [
    { op: 'replace', path: '/units/p1/armor', value: 9 },
    { op: 'replace', path: '/units/ghost/armor', value: 4 },
  ], validate: () => {} });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(formatRejectedItem(result.rejected[0], state), /ghost/);
});

test('标准化分区多轮收敛倒序依赖，并隔离坏项', () => {
  const state = { equipment: { charm: { name: '翼饰', skills: [] } }, skills: {} };
  const patch = [
    { op: 'replace', path: '/equipment/charm/skills', value: ['wing_lift'] },
    { op: 'add', path: '/skills/wing_lift', value: { id: 'wing_lift', name: '翼升', rules: [] } },
    { op: 'add', path: '/skills/broken_sk', value: { id: 'broken_sk', name: '坏技能', rules: [{ program: [{ op: 'explode_planet' }] }] } },
  ];
  const result = partitionNormalizationPatch({
    liveState: state, baselineState: state, rawPatch: patch,
    validate: candidate => {
      const refs = candidate.equipment.charm?.skills ?? [];
      for (const id of refs) if (!candidate.skills[id]) throw new Error(`技能 ${id} 尚未定义`);
      if (candidate.skills.broken_sk) throw new Error('未知 VM 指令 explode_planet');
    },
  });
  assert.deepEqual(result.accepted.map(item => item.index), [1, 0]);
  assert.deepEqual(result.rejected.map(item => item.index), [2]);
  assert.equal(result.workLive.equipment.charm.skills[0], 'wing_lift');
  assert.match(formatRejectedItem(result.rejected[0], result.workLive), /broken_sk.*explode_planet/);
});

test('会话增删改查、消息追加与持久化保持隔离', () => {
  let stored;
  const store = createAiSessions(null, data => { stored = JSON.stringify(data); }, () => 100);
  const first = store.active();
  const second = store.create();
  const third = store.create();
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  for (const [i, session] of [first, second, third].entries()) {
    store.select(session.id);
    store.rename(session.id, `会话${i + 1}`);
    const [user, assistant] = store.append(session.id, { role: 'user', content: `问题${i + 1}` }, { role: 'assistant', content: '' });
    store.update(session.id, assistant, { content: `回答${i + 1}`, status: 'ok' });
    assert.deepEqual(store.active().messages, [user, assistant]);
  }
  store.select(second.id);
  const restored = createAiSessions(JSON.parse(stored), () => {});
  assert.equal(restored.active().title, '会话2');
  assert.deepEqual(restored.data.sessions.map(s => s.messages[1].content), ['回答1', '回答2', '回答3']);
  store.remove(second.id);
  assert.equal(store.active().id, third.id);
  store.update(second.id, second.messages[1], { content: '已删除会话的迟到响应' });
  assert.equal(store.get(second.id), undefined);
  assert.equal(store.active().messages[1].content, '回答3');
  store.clear(third.id);
  assert.equal(store.active().messages.length, 0);
  assert.equal(store.get(first.id).messages.length, 2);
  store.remove(first.id);
  store.remove(third.id);
  assert.equal(store.data.sessions.length, 1);
  assert.deepEqual(store.active().messages, []);
});

test('标准化高阶契约标签、关键不变式与 std_audit 自审块剥离兼容', () => {
  const messages = assembleMessages(DEFAULT_SLOTS, { warningsText: '1. [unitId="p1", originPath="/equipment/e1"] 测试警告', stateJson: '{}' });
  const joined = messages.map(m => m.content).join('\n\n');
  for (const tag of ['<role_core>', '<disposition_ledger>', '<output_contract>', '<compilation_invariants>', '<std_audit_workflow>', '<tail_anchor>']) {
    assert.ok(joined.includes(tag), `缺少契约标签 ${tag}`);
  }
  assert.match(joined, /additivePercent.*小数制/);
  assert.match(joined, /persistent.*force:true/);
  assert.match(joined, /self\.stacks\./);
  assert.match(joined, /guaranteed_hit.*guaranteed_crit/);
  assert.match(joined, /命运点|FP/);
  assert.match(joined, /二次叠加/);

  const rawReply = `<std_audit>
Step 0: W1 | p1 | /equipment/e1 | 测试警告
Step 2: 伪代码草稿 {"patch":[{"op":"add","path":"/invalid/draft","value":123}]}
Step 4: Coverage: PASS | Schema: PASS
</std_audit>
{"patch":[{"op":"add","path":"/equipment/e1/mods","value":[{"stat":"dodge","flat":2}],"resolves":[{"unitId":"p1","originPath":"/equipment/e1","message":"测试警告"}]}],"unresolved":[],"narrative":[]}`;
  assert.ok(!stripReasoningBlocks(rawReply).includes('/invalid/draft'));
  const parsed = parseAIResponse(rawReply);
  assert.equal(parsed.patch.length, 1);
  assert.equal(parsed.patch[0].path, '/equipment/e1/mods');
});

