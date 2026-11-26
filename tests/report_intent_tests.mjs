import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { beginBattle, currentUnit } from '../src/core/combat.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { narrate } from '../src/ui/narrate.js';
import { createRenderer } from '../src/ui/render.js';
import { fillInstance } from '../src/tavern/instance-card.js';
import { getPool, updatePoolCurrent } from '../src/core/vm-pools.js';
import { formatBattleReportText } from '../src/api/battle_report.js';
import { RATING_TABLE } from '../src/core/combat_protocol.js';

const boot = () => { const a = createGameAPI(); a.createBattle({scenarioId:'ruins', ruleset:'sandbox'}); return a; };

test('寄居蟹攻击瑞吉：合计 19 判有效，不把防御 150 当作命中 DC', () => {
  const detail = { targetId:'p1', dice:[14], selected:14, accuracy:5, total:19, defense:150,
    rating:{min:11,name:'有效',multiplier:1}, hit:true, critical:false };
  const entry = narrate({type:'roll',actor:'e2',detail}, {units:{e2:{name:'刺壳寄居蟹'},p1:{name:'瑞吉'}}});
  assert.deepEqual([entry.roll.kept, entry.roll.modifier, entry.roll.total, entry.roll.verdict], [14,5,19,'命中「有效」']);
  assert.equal(entry.roll.target, undefined, '卡片不能渲染 vs 防御');
  assert.match(entry.roll.label, /命中评级/);
});

// 只提供 DOM 写入与文本读取；预览计算、单位面板和酒馆词条均走生产渲染器。
function textNode(tag, attrs = {}, value = '') {
  return {
    tag, className: attrs.class, dataset: {}, children: value === '' ? [] : [String(value)], style: { setProperty() {} }, classList: { add() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, querySelector() { return null; },
    append(...nodes) { this.children.push(...nodes); }, prepend(...nodes) { this.children.unshift(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    set textContent(text) { this.replaceChildren(String(text)); },
    get textContent() { return this.children.map(node => typeof node === 'string' ? node : node.textContent).join(''); },
  };
}

function dodgeScene(ruleset, dodge, kind = 'unit') {
  const state = buildScenario('ruins');
  state.ruleset = ruleset;
  const unit = state.units.scout;
  unit.armor = 3;
  unit.gear = ['boots'];
  const mods = [{ stat: 'dodge', flat: dodge }];
  state.equipment.boots = { name: '试验靴', kind: 'armor', defense: 160, mods };
  state.items.boots = { id: 'boots', templateId: 'boots', mods: structuredClone(mods) };
  const target = kind === 'cover' ? state.covers.C1 : unit;
  target.x = 2; target.y = 2;
  const nodes = new Map();
  const root = { ownerDocument: { createElement: textNode, createTextNode: String }, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, textNode('div'));
    return nodes.get(selector);
  } };
  createRenderer(root).render(state, { selectedId: unit.id, action: { type: 'attack' }, target, hover: target });
  return { preview: nodes.get('[id="tactical-preview"]').textContent, card: nodes.get('[id="unit-card"]').textContent };
}

for (const [ruleset, dodge, kind, formula] of [
  ['protocol', 15, 'unit', '攻方命中 +11 − 守方闪避 +15 = 净修正 -4（≥4 擦伤 / ≥11 有效 / ≥20 暴击）'],
  ['protocol', 0, 'unit', '净命中 +11（≥4 擦伤 / ≥11 有效 / ≥20 暴击）'],
  ['protocol', 0, 'cover', '命中 +11，目标阈值 8'],
  ['sandbox', 0, 'unit', '命中 +16，目标阈值 172'],
]) test(`实际战术预览：${ruleset} ${kind} 闪避 ${dodge}`, () => {
  const { preview } = dodgeScene(ruleset, dodge, kind);
  assert.ok(preview.includes(formula), preview);
  assert.match(preview, /命中中的体型修正 0/);
  if (ruleset === 'protocol' && kind === 'unit') assert.doesNotMatch(preview, /对抗防御|目标阈值/);
  else assert.doesNotMatch(preview, /≥4 擦伤/);
});

test('实际单位卡：有效护甲包含穿戴防御，闪避来自装备', () => {
  const { card } = dodgeScene('protocol', 15);
  assert.match(card, /护甲 163\b/);
  assert.match(card, /闪避 \+15\b/);
});

test('酒馆装备卡：六种修饰有中文名，命中芯片只显示非零值', () => {
  const mods = [{ stat: 'dodge', flat: 15 }, { stat: 'movement', flat: 2 }, { stat: 'incomingDistanceOffset', flat: -1 },
    { stat: 'critDamageBonus', flat: 4 }, { stat: 'incomingDamageMult', mult: 1.5 }, { stat: 'apMax', flat: 1 }];
  for (const accuracy of [5, -3, 0]) {
    const unit = { id: 'test', gear: ['boots'] };
    const state = { items: { boots: { templateId: 'boots' } }, equipment: { boots: { name: '试验靴', accuracy, mods } } };
    const { body } = fillInstance(textNode('article'), textNode, unit, state, {}, textNode('input'));
    const section = body.children.find(node => node.tag === 'section' && node.textContent.startsWith('装备'));
    const row = section.children.find(node => node.className === 'fated-char-row');
    const chips = row.children.find(node => node.className === 'fated-char-row-head').children.filter(node => node.className === 'fated-char-chip');
    assert.deepEqual(chips.map(node => node.textContent).filter(text => text.startsWith('命中')), accuracy ? [`命中 ${accuracy > 0 ? '+' : ''}${accuracy}`] : []);
    assert.deepEqual(row.children.filter(node => node.tag === 'p').map(node => node.textContent),
      ['闪避 +15', '移动距离 +2', '表观距离 -1', '暴击伤害加成 +4', '受击易伤倍率 ×1.5', '行动点上限 +1']);
  }
});

for (const [label, detail, modifierLabel, summary, factor] of [
  ['常规', { attackAccuracy: 5, dodgeBonus: 0 }, '命中修正', '命中修正 +5，合计 19', null],
  ['有闪避', { attackAccuracy: 20, dodgeBonus: 15 }, '净修正（攻+20 / 闪+15）', '攻方命中 +20 − 守方闪避 +15 = 净修正 +5，合计 19', '守方闪避 −15'],
  ['负闪避', { attackAccuracy: 2, dodgeBonus: -3 }, '净修正（攻+2 / 闪-3）', '攻方命中 +2 − 守方闪避 -3 = 净修正 +5，合计 19', '守方闪避 +3'],
  ['无视', { attackAccuracy: 5, dodgeBonus: 0, ignoreDodge: true, rawDodgeBonus: 15 }, '命中修正', '命中修正 +5（无视守方闪避 +15），合计 19', '无视闪避（原 +15）'],
]) test(`命中回放：${label}，骰面加净修正仍等于合计`, () => {
  const entry = narrate({ type: 'roll', actor: 'a', detail: { targetId: 'b', dice: [14], selected: 14, accuracy: 5,
    total: 19, hit: true, rating: { name: '有效' }, ...detail } }, { units: { a: { id: 'a', name: '甲' }, b: { id: 'b', name: '乙' } } });
  assert.deepEqual([entry.roll.kept, entry.roll.modifier, entry.roll.total, entry.roll.verdict], [14, 5, 19, '命中「有效」']);
  assert.equal(entry.roll.target, undefined);
  assert.equal(entry.roll.label, '甲 → 乙 · 命中评级');
  assert.equal(entry.roll.modifierLabel, modifierLabel);
  assert.ok(entry.lines.includes(summary), entry.lines.join('\n'));
  if (factor) assert.equal(entry.lines.find(line => line.startsWith('修正来源：')), `修正来源：${factor}`);
  else assert.doesNotMatch(entry.lines.join('\n'), /闪避/);
});

test('回放来源分别列出面板、体型、受击暴露、检定、战意与检定前修正', () => {
  const entry = narrate({ type: 'roll', detail: { dice: [10], selected: 10, accuracy: 9, total: 19, hit: true, bonusDelta: 1,
    accuracySources: { explicit: 5, size: -2, incomingAccuracy: 1, checkBonus: 3, morale: 1 } } }, { units: {} });
  assert.equal(entry.lines.find(line => line.startsWith('修正来源：')), '修正来源：面板命中 +5，体型 -2，受击暴露 +1，检定加值 +3，战意 +1，检定前修正 +1');
});

test('战报：零闪避与旧日志逐字一致；擦伤、失手和无视闪避各自附注', () => {
  const format = detail => formatBattleReportText({ title: '闪避', units: [{ id: 'b', name: '瑞吉', x: 2, y: 2, z: 0 }],
    rounds: [{ round: 1, events: [{ type: 'roll', detail: { targetId: 'b', selected: 12, hit: true, rating: { name: '有效' }, ...detail } }] }] });
  assert.equal(format({ dodgeBonus: 0 }), format({}));
  for (const [detail, expected] of [
    [{ dodgeBonus: 0 }, '击中瑞吉(2, 2, z=0)（成功，有效）'],
    [{ dodgeBonus: 15, hit: false }, '瑞吉(2, 2, z=0)未被击中（失败，失手，守方闪避 +15）'],
    [{ dodgeBonus: 15, rating: { name: '擦伤' } }, '击中瑞吉(2, 2, z=0)（成功，擦伤，守方闪避 +15）'],
    [{ dodgeBonus: -3 }, '击中瑞吉(2, 2, z=0)（成功，有效，守方闪避 -3）'],
    [{ dodgeBonus: 0, ignoreDodge: true, rawDodgeBonus: 15 }, '击中瑞吉(2, 2, z=0)（成功，有效，无视闪避 +15）'],
  ]) assert.ok(format(detail).includes(expected), format(detail));
});

function castProbe(program, configure = () => {}) {
  const state = buildScenario('ruins');
  const actor = currentUnit(state), target = state.units.scout;
  actor.skills.push('probe');
  state.skills.probe = { name: '试验', range: 3, ap: 1, slot: 'action', shape: 'single', target: 'enemy',
    rules: [{ id: 'probe', hook: 'active', program }] };
  configure(state, actor, target);
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  api.playAction({ type: 'skill', skillId: 'probe', x: target.x, y: target.y });
  return api;
}

test('VM 概率、普通、对抗与攻击检定的显示服从实际分支', () => {
  for (const [kind, dc, success] of [['chance', 100, true], ['chance', 0, false], ['d20', 1, true], ['contest', 1, true], ['attack', 1, true]]) {
    const api = castProbe([{ op: 'check', kind, dc, stat: 'str', onPass: [{ op: 'apply_status', target: 'target', statusId: 'stun' }] }],
      (_state, actor, target) => { actor.stats.str = 50; target.stats.str = -20; });
    const state = api.getBattleState();
    const log = state.logs.find(entry => entry.type === 'vm_check');
    assert.equal(log?.detail.success, success);
    assert.equal(Boolean(state.units.scout.statuses.stun), success);
    const entry = narrate(log, state);
    const verdict = success ? '成功' : '失败';
    assert.equal(entry.roll.verdict, verdict);
    assert.match(entry.title, new RegExp(`${verdict}（${kind === 'chance' ? 'd100' : 'd20'} 掷出`));
    assert.ok(api.exportBattleReportText().includes(entry.title.slice(state.units.swordsman.name.length)));
    assert.doesNotMatch(api.exportBattleReportText(), /触发判定失败|undefined/);
  }
});

test('VM 状态与护盾记录施加当时的数值，同名单位各用自己的坐标', () => {
  const api = castProbe([
    { op: 'apply_status', target: 'target', statusId: 'freeze', turns: 3 },
    { op: 'apply_status', target: 'self', statusId: 'probe_shield', turns: 3 },
  ], (state, actor, target) => {
    actor.name = target.name = '同名';
    state.skills.probe.mp = 2;
    state.statusTemplates = { ...state.statusTemplates, probe_shield: { id: 'probe_shield', name: '试验护盾', category: 'shield', vars: { shieldAmount: 40 } } };
  });
  const state = api.getBattleState();
  const logs = state.logs.filter(log => log.type === 'status');
  for (const id of ['freeze', 'probe_shield']) {
    const log = logs.find(entry => entry.detail.statusId === id);
    const entry = narrate(log, state);
    assert.ok(entry.lines.includes('持续 3 回合'));
    if (id === 'probe_shield') assert.ok(entry.lines.includes('护盾 40 点'));
  }
  const report = api.exportBattleReportText();
  assert.match(report, /同名〔scout〕\(3, 2, z=0\)获得冰冻[^；]*持续 3 回合[^；]*来源 同名〔swordsman〕\(1, 2, z=0\)/);
  assert.match(report, /同名〔swordsman〕\(1, 2, z=0\)获得试验护盾[^；]*护盾 40 点/);
  assert.match(report, /同名〔swordsman〕\(1, 2, z=0\)因试验消耗/);
  assert.doesNotMatch(report, /同名\([^)]+\)\(/);
});

test('同名单位在同格战报中仍用稳定 ID 区分', () => {
  const report = formatBattleReportText({ title: '同名测试', units: [
    { id: 'e1', name: '刺壳寄居蟹', x: 2, y: 2, z: 0 },
    { id: 'e2', name: '刺壳寄居蟹', x: 2, y: 2, z: 0 },
  ], rounds: [{ round: 1, events: [
    { type: 'turn', actor: 'e1', text: '刺壳寄居蟹的回合', positions: { e1: { x: 2, y: 2, z: 0 }, e2: { x: 2, y: 2, z: 0 } } },
    { type: 'damage', actor: 'e1', text: '刺壳寄居蟹受到伤害', detail: { targetId: 'e2', amount: 3, hpBefore: 10, hpAfter: 7 } },
  ] }] });
  assert.match(report, /刺壳寄居蟹〔e1〕\(2, 2, z=0\)/);
  assert.match(report, /刺壳寄居蟹〔e2〕\(2, 2, z=0\)/);
});

test('VM 瞬移和拉拽的落点只写一次，掩体攻击摘要显示名称', () => {
  const vm = castProbe([
    { op: 'move', target: 'target', mode: 'pull', to: { x: 2, y: 2 }, distance: 1 },
    { op: 'move', target: 'self', mode: 'teleport', to: { x: 3, y: 1 } },
  ]);
  const report = vm.exportBattleReportText();
  assert.match(report, /被拉近至 \(2, 2, z=0\)(?=；|\n|$)/);
  assert.match(report, /瞬移至 \(3, 1, z=0\)(?=；|\n|$)/);
  const state = buildScenario('ruins');
  state.covers.C1.x = 2;
  const api = createGameAPI();
  api.createBattle({ kind: 'custom_state', state });
  api.playAction({ type: 'attack', x: 2, y: 2 });
  assert.match(api.exportBattleReportText(), /攻击砂岩掩体/);
  assert.doesNotMatch(api.exportBattleReportText(), /攻击格子 \(2, 2\)/);
});

test('单体攻击战报明确显示意图，范围攻击不显示部位意图', () => {
  const a = boot();
  a.playAction({ type:'move', x:2, y:2 });
  a.playAction({ type:'attack', x:3, y:2, intent:'core' });
  const report = a.exportBattleReportText();
  assert.match(report, /使用噬魂太刀以意图：核心要害攻击受伤斥候/);
  assert.match(report, /[^；]+\(2, 2, z=\d+\)使用噬魂太刀以意图：核心要害攻击受伤斥候\(3, 2, z=\d+\)/);
  const events = a.exportBattleReport().rounds.flatMap(r => r.events);
  const rollIndex = events.findIndex(e => e.type === 'roll' && e.detail.intent?.required);
  assert.ok(rollIndex >= 0);
  assert.equal(events[rollIndex + 1].type, 'intent');
  assert.match(report, /(?:击中|暴击)[^；\n]*；意图(?:成立|未成立)/);
  const damage = events.find(e => e.type === 'damage' && e.detail.targetId === 'scout');
  assert.ok(damage);
  assert.match(report, /噬魂太刀伤害（HP \d+ → \d+）/);

  const b = boot();
  for (let i = 0; i < 12 && b.getStateSummary().currentUnitId !== 'ranger'; i++) b.playAction({ type:'end' });
  const state = b.getBattleState();
  b.playAction({ type:'skill', x:3, y:2, skillId:'fan', intent:'core' });
  const attack = b.exportBattleReport().rounds.flatMap(r => r.events).find(e => e.type === 'action' && e.detail.action?.skillId === 'fan');
  assert.equal(attack.detail.intent, 'normal');
  assert.doesNotMatch(b.exportBattleReportText(), /血牙扇斩以意图：核心要害/);
  assert.match(b.exportBattleReportText(), /使用血牙扇斩，目标：[^；\n]+\(/);
  assert.ok(state.units.swordsman);
});

test('战报呈现全部命中评级、自然骰分级与多重豁免结果', () => {
  const targetId = 'dummy';
  const events = [
    ...RATING_TABLE.map(rating => ({ type: 'roll', detail: { targetId, hit: rating.multiplier > 0, selected: 10, rating } })),
    { type: 'roll', detail: { targetId, hit: true, selected: 20, critical: true, rating: RATING_TABLE[1] } },
    { type: 'roll', detail: { targetId, hit: false, selected: 1, rating: RATING_TABLE[0] } },
    { type: 'save', detail: { targetId, saved: true, mode: 'any', checks: [
      { saveStat: 'agi', saved: true, saveRoll: 20 }, { saveStat: 'con', saved: false, saveRoll: 1 },
    ] } },
    { type: 'save', detail: { targetId, saveStat: 'spi', saved: false, saveRoll: 20 } },
    { type: 'contest', actor: 'caster', detail: { targetId, maneuver: 'trip', success: true, attackerRoll: 1 } },
  ];
  const report = formatBattleReportText({ title: '检定', units: [{ id: targetId, name: '木偶', x: 1, y: 1, z: 0 }], rounds: [{ round: 1, events }] }, { caster: '术师' });
  for (const { name, multiplier } of RATING_TABLE) assert.ok(report.includes(`（${multiplier ? '成功' : '失败'}，${name}）`), report);
  for (const text of ['打出暴击（大成功，强暴击）', '未被击中（大失败，失手）',
    '多重豁免（成功，任一通过即可，敏捷大成功，体质大失败）', '未通过精神豁免（失败）', '绊摔检定成功']) {
    assert.ok(report.includes(text), report);
  }
});

test('持续伤害与恢复按每次实际结算展示来源和 HP', () => {
  const a = boot();
  const state = a.getBattleState();
  const id = state.order[(state.turn + 1) % state.order.length];
  updatePoolCurrent(state, getPool(state, id, 'hp').id, 'set', state.units[id].maxHp - 1);
  a.createBattle({ kind: 'custom_state', state });
  const proposal = a.proposeCommands(['poison', 'regen'].map(statusId => ({
    type: 'upsert_status', unitId: id, statusId,
  })), { baseRevision: a.getStateSummary().revision, reason: '测试持续效果战报' });
  assert.ok(proposal.ok, proposal.error);
  assert.ok(a.commitProposal(proposal.proposalId).ok);
  const before = a.getBattleState().units[id].hp;
  a.playAction({ type: 'end' });
  const report = a.exportBattleReportText();
  assert.match(report, /获得中毒（持续 \d+ 回合，持有者回合开始：每层 \d+ 点真实伤害）/);
  assert.match(report, /获得再生（持续 3 回合，持有者回合开始：每层 5 点治疗）/);
  assert.ok(report.includes(`受到3点中毒伤害（HP ${before} → ${before - 3}）`));
  assert.ok(report.includes(`因再生恢复4点生命（HP ${before - 3} → ${before + 1}）`));
});

test('战报用施加时的状态实例呈现层数、护盾、解除条件和非计时状态', () => {
  const a = boot();
  const state = a.getBattleState();
  const sourceId = state.order[state.turn];
  const id = state.order[(state.turn + 1) % state.order.length];
  const proposal = a.proposeCommands([
    { statusId: 'bleed', options: { sourceId, stacks: 2, remainingTurns: 4 } },
    { statusId: 'shield', options: { amount: 12, durationType: 'until_removed' } },
    { statusId: 'haste', options: { durationType: 'persistent' } },
    { statusId: 'freeze', options: { sourceId } },
    { statusId: 'weakness', options: { stacks: 3 } },
  ].map(command => ({ type: 'upsert_status', unitId: id, ...command })), {
    baseRevision: a.getStateSummary().revision, reason: '测试状态战报',
  });
  assert.ok(proposal.ok, proposal.error);
  assert.ok(a.commitProposal(proposal.proposalId).ok);
  a.playAction({ type: 'end' });
  const report = a.exportBattleReportText();
  assert.match(report, /获得流血 ×2（持续 4 回合，持有者回合结束：每层 3 点真实伤害（当前合计 6 点），来源 [^；]+/);
  assert.match(report, /获得护盾（持续至解除，护盾 12 点）/);
  assert.match(report, /获得疾走（跨战斗持续，移动距离 \+1）/);
  assert.match(report, /获得冰冻（持续 1 回合，碎裂增伤 \+50%，跳过行动，受到命中时解除，来源 [^；]+/);
  assert.match(report, /获得弱点识别 ×3（持续 3 回合，每层意图加值 \+2）/);
  assert.match(report, /的冰冻结束/);
  assert.match(report, /的护盾吸收6点伤害/);

  const legacy = a.exportBattleSnapshot();
  legacy.version = 6;
  assert.throws(() => boot().restoreBattleSnapshot(legacy), /仅支持版本 11/);

  const nextBattle = a.getBattleState();
  nextBattle.logs = [];
  a.createBattle({ kind: 'custom_state', state: beginBattle(nextBattle) });
  assert.match(a.exportBattleReportText(), /开场已有疾走（跨战斗持续，移动距离 \+1）/);
});

test('战报保留技能的三种消耗与 DSL 实际恢复的来源', () => {
  const a = boot();
  const state = a.getBattleState();
  const actor = state.units[state.order[state.turn]];
  for (const [key, max] of [['mp', 'maxMp'], ['sp', 'maxSp']]) {
    const pool = getPool(state, actor.id, key);
    actor[max] = pool.max = pool.contributors[0].maxBase = 20;
    updatePoolCurrent(state, pool.id, 'set', 20);
  }
  const hp = actor.hp;
  state.skills.recovery = {
    name: '回气术', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self',
    resourceCost: { hp: 1, mp: 4, sp: 3 },
    rules: [{ id: 'recovery', hook: 'active', program: [
      { op: 'resource', target: 'self', pool: 'mp', mode: 'add', amount: 2 },
      { op: 'resource', target: 'self', pool: 'sp', mode: 'add', amount: 1 },
    ] }],
  };
  actor.skills.push('recovery');
  a.createBattle({ kind: 'custom_state', state });
  a.playAction({ type: 'skill', skillId: 'recovery', x: actor.x, y: actor.y });
  const report = a.exportBattleReportText();
  assert.ok(report.includes(`因回气术消耗1点 HP（HP ${hp} → ${hp - 1}）`), report);
  for (const text of [
    '因回气术消耗4点 MP（MP 20 → 16）', '因回气术消耗3点 SP（SP 20 → 17）',
    '因回气术恢复2点 MP（MP 16 → 18）', '因回气术恢复1点 SP（SP 17 → 18）',
  ]) assert.ok(report.includes(text), report);
  const restored = boot();
  restored.restoreBattleSnapshot(a.exportBattleSnapshot());
  assert.equal(restored.exportBattleReportText(), report);
});
