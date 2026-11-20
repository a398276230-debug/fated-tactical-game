import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';

const boot = () => { const a = createGameAPI(); a.createBattle({scenarioId:'ruins', ruleset:'sandbox'}); return a; };

test('单体攻击战报明确显示意图，范围攻击不显示部位意图', () => {
  const a = boot();
  a.playAction({ type:'move', x:2, y:2 });
  a.playAction({ type:'attack', x:3, y:2, intent:'core' });
  const report = a.exportBattleReportText();
  assert.match(report, /使用噬魂太刀以意图：核心要害攻击受伤斥候/);
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
  assert.ok(state.units.swordsman);
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
  assert.ok(report.includes(`受到3点中毒伤害（HP ${before} → ${before - 3}）`));
  assert.ok(report.includes(`因再生恢复4点生命（HP ${before - 3} → ${before + 1}）`));
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
    effects: [{ id: 'recovery', trigger: 'active', target: 'self', effects: [
      { kind: 'restoreResource', resource: 'mp', amount: 2 },
      { kind: 'restoreResource', resource: 'sp', amount: 1 },
    ] }],
  };
  actor.skills.push('recovery');
  a.createBattle({ kind: 'custom_state', state });
  a.playAction({ type: 'skill', skillId: 'recovery', x: actor.x, y: actor.y });
  const report = a.exportBattleReportText();
  assert.ok(report.includes(`施放 回气术 消耗 1 HP（HP ${hp} → ${hp - 1}）`));
  for (const text of [
    '因回气术消耗4点 MP（MP 20 → 16）', '因回气术消耗3点 SP（SP 20 → 17）',
    '因回气术恢复2点 MP（MP 16 → 18）', '因回气术恢复1点 SP（SP 17 → 18）',
  ]) assert.ok(report.includes(text), report);
  const restored = boot();
  restored.restoreBattleSnapshot(a.exportBattleSnapshot());
  assert.equal(restored.exportBattleReportText(), report);
});
