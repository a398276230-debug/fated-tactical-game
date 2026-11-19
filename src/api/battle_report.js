// Narrative projection only: the structured report remains the audit record.
export function formatBattleReportText(report, unitNames = {}) {
  const lines = [report.title];
  const names = new Map(Object.entries(unitNames));
  for (const unit of report.units) names.set(unit.id, unit.name);
  const name = id => names.get(id) ?? id;
  const digits = '零一二三四五六七八九';
  const roundLabel = n => n < 10 ? digits[n] : n < 100
    ? `${n >= 20 ? digits[Math.floor(n / 10)] : ''}十${n % 10 ? digits[n % 10] : ''}` : n;
  for (const { round, events } of report.rounds) {
    const rows = [];
    let turn = null;
    const add = text => { if (turn) turn.parts.push(text); else rows.push(text); };
    for (const [i, event] of events.entries()) {
      const { type, text, actor } = event;
      const detail = event.detail ?? {};
      switch (type) {
        case 'initiative':
          rows.push(`确定先攻次序：${detail.initiative.map(u => name(u.unitId)).join(' → ')}`);
          break;
        case 'turn':
          turn = { text, actor, parts: [] }; rows.push(turn);
          break;
        case 'end':
          if (turn && !turn.parts.length) turn.parts.push('未行动，结束回合');
          turn = null;
          break;
        case 'action': {
          const action = detail.action?.type;
          if (['move', 'sprint', 'disengage', 'interact'].includes(action) || (action === 'brace' && events[i + 1]?.type === 'brace')) break;
          const prefix = `${name(actor)}：`;
          const label = text.startsWith(prefix) ? text.slice(prefix.length) : text;
          add(action === 'attack' || action === 'skill' ? `使用${label}` : label);
          break;
        }
        case 'roll':
          if (detail.cover > 0) {
            const cover = detail.coverId;
            add(`${name(detail.targetId)}受到${cover ? ` ${cover} ` : ''}掩体遮蔽`);
          }
          if (!detail.hit) add(`${name(detail.targetId)}未被击中`);
          else if (detail.critical) add(`对${name(detail.targetId)}打出暴击`);
          break;
        case 'save':
          if (detail.saved) add(`${name(detail.targetId)}通过豁免`);
          break;
        case 'status':
          if (detail.statusId === 'guarded' && turn?.parts.some(p => p.includes('架势防御'))) break;
          add(text.replace(/ ×1$/, '')); break;
        case 'proc': case 'expire': // Secondary bookkeeping is available in the structured log.
          break;
        case 'counter':
          add(text.replace(/\bsouls\b/g, '魂数').replace(/\bammo\b/g, '弹药'));
          break;
        case 'outcome':
          turn = null; rows.push(text);
          break;
        default: {
          if (['damage', 'heal', 'cover_damage'].includes(type) && detail.amount === 0) break;
          const ownAction = turn?.actor === actor && ['move', 'sprint', 'disengage', 'teleport', 'interact', 'skip', 'brace', 'cover_approach'].includes(type);
          const label = ownAction && text.startsWith(name(actor)) ? text.slice(name(actor).length) : text;
          add(label.replace(/ ×1$/, ''));
        }
      }
    }
    if (!rows.length) continue;
    lines.push('', `- 回合${roundLabel(round)}`);
    for (const row of rows) {
      lines.push(`  - ${typeof row === 'string' ? row : row.text + (row.parts.length ? `：${row.parts.join('；')}` : '')}`);
    }
  }
  if (!report.outcome) lines.push('', '战斗尚未结束。');
  return `${lines.join('\n')}\n`;
}
