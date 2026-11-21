import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
import { beginBattle } from '../src/core/combat.js';
import { formatBattleReportText } from '../src/api/battle_report.js';
import { RATING_TABLE } from '../src/core/combat_protocol.js';

const boot = () => { const a = createGameAPI(); a.createBattle({scenarioId:'ruins', ruleset:'sandbox'}); return a; };

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
  state.units[id].hp = state.units[id].maxHp - 1;
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
    { statusId: 'bleed', options: { sourceUnitId: sourceId, stacks: 2, remainingTurns: 4 } },
    { statusId: 'shield', options: { amount: 12, durationType: 'until_removed' } },
    { statusId: 'haste', options: { durationType: 'persistent' } },
    { statusId: 'freeze', options: { sourceUnitId: sourceId } },
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
  assert.match(report, /获得弱点识别 ×3（持续 3 回合，每层意图难度 -2）/);
  assert.match(report, /的冰冻结束/);
  assert.match(report, /的护盾吸收6点伤害/);

  const legacy = a.exportBattleSnapshot();
  legacy.version = 6;
  for (const event of legacy.state.logs.filter(e => e.type === 'status')) {
    for (const key of ['modifiers', 'durationType', 'tickTiming', 'expireOn']) delete event.detail[key];
  }
  const resumed = boot();
  assert.equal(resumed.restoreBattleSnapshot(legacy).migratedFrom, 6);
  assert.match(resumed.exportBattleReportText(), /获得冰冻（持续 1 回合，来源 [^；]+/);
  assert.deepEqual(resumed.exportBattleSnapshot().journal, []);

  const nextBattle = a.getBattleState();
  nextBattle.logs = [];
  a.createBattle({ kind: 'custom_state', state: beginBattle(nextBattle) });
  assert.match(a.exportBattleReportText(), /开场已有疾走（跨战斗持续，移动距离 \+1）/);
});

test('战报保留技能的三种消耗与 DSL 实际恢复的来源', () => {
  const a = boot();
  const state = a.getBattleState();
  const actor = state.units[state.order[state.turn]];
  actor.mp = actor.maxMp = 20;
  actor.sp = actor.maxSp = 20;
  const hp = actor.hp;
  state.skills.recovery = {
    name: '回气术', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self',
    resourceCost: { hp: 1, mp: 4, sp: 3 },
    effects: [{ id: 'recovery', trigger: 'active', target: 'self', roll: { dice: 'd20', gte: 1 }, effects: [
      { kind: 'restoreResource', resource: 'mp', amount: 2 },
      { kind: 'restoreResource', resource: 'sp', amount: 1 },
      { kind: 'modifyStat', stat: 'str', flat: 2, duration: 3 },
    ] }],
  };
  actor.skills.push('recovery');
  a.createBattle({ kind: 'custom_state', state });
  a.playAction({ type: 'skill', skillId: 'recovery', x: actor.x, y: actor.y });
  const report = a.exportBattleReportText();
  assert.match(report, /回气术触发检定(?:大成功|成功)/);
  assert.ok(report.includes(`施放 回气术 消耗 1 HP（HP ${hp} → ${hp - 1}）`));
  for (const text of [
    '因回气术消耗4点 MP（MP 20 → 16）', '因回气术消耗3点 SP（SP 20 → 17）',
    '因回气术恢复2点 MP（MP 16 → 18）', '因回气术恢复1点 SP（SP 17 → 18）',
    '获得回气术的属性修正（持续 3 回合，力量 +2）',
  ]) assert.ok(report.includes(text), report);
  const restored = boot();
  restored.restoreBattleSnapshot(a.exportBattleSnapshot());
  assert.equal(restored.exportBattleReportText(), report);
});
