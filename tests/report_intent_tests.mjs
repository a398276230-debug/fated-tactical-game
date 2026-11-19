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
  assert.match(report, /意图成立|意图未成立，按常规攻击结算/);

  const b = boot();
  for (let i = 0; i < 12 && b.getStateSummary().currentUnitId !== 'ranger'; i++) b.playAction({ type:'end' });
  const state = b.getBattleState();
  b.playAction({ type:'skill', x:3, y:2, skillId:'fan', intent:'core' });
  const attack = b.exportBattleReport().rounds.flatMap(r => r.events).find(e => e.type === 'action' && e.detail.action?.skillId === 'fan');
  assert.equal(attack.detail.intent, 'normal');
  assert.doesNotMatch(b.exportBattleReportText(), /血牙扇斩以意图：核心要害/);
  assert.ok(state.units.swordsman);
});
