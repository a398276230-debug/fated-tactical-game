// Narrative projection only: the structured report remains the audit record.
export function formatBattleReportText(report, unitNames = {}) {
  const lines = [report.title];
  const names = new Map(Object.entries(unitNames));
  for (const unit of report.units) names.set(unit.id, unit.name);
  const digits = '零一二三四五六七八九';
  const roundLabel = n => n < 10 ? digits[n] : n < 100
    ? `${n >= 20 ? digits[Math.floor(n / 10)] : ''}十${n % 10 ? digits[n % 10] : ''}` : n;
  const position = (event, id) => {
    const point = event.positions?.[id] ?? report.units.find(unit => unit.id === id);
    return point && Number.isInteger(point.x) && Number.isInteger(point.y) ? `(${point.x}, ${point.y}${Number.isInteger(point.z) ? `, z=${point.z}` : ''})` : '';
  };
  const name = (event, id) => `${names.get(id) ?? id}${position(event, id)}`;
  const replaceUnitNames = (event, text) => {
    let result = text;
    const ordered = [...names.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [id, unitName] of ordered) {
      if (!unitName || !result.includes(unitName)) continue;
      const replacement = `${unitName}${position(event, id)}`;
      result = result.split(unitName).join(replacement);
    }
    return result;
  };
  const change = (resource, before, after) => Number.isFinite(before) && Number.isFinite(after)
    ? `（${resource} ${before} → ${after}）` : '';
  for (const { round, events } of report.rounds) {
    const rows = [];
    let turn = null;
    const add = text => { if (turn) turn.parts.push(text); else rows.push(text); };
    for (const [i, event] of events.entries()) {
      const { type, text, actor } = event;
      const detail = event.detail ?? {};
      switch (type) {
        case 'initiative':
          rows.push(`确定先攻次序：${detail.initiative.map(u => name(event, u.unitId)).join(' → ')}`);
          break;
        case 'turn':
          turn = { text: replaceUnitNames(event, text), actor, parts: [] }; rows.push(turn);
          break;
        case 'end':
          if (turn && !turn.parts.length) turn.parts.push('未行动，结束回合');
          turn = null;
          break;
        case 'action': {
          const action = detail.action?.type;
          if (['move', 'sprint', 'disengage', 'interact'].includes(action) || (action === 'brace' && events[i + 1]?.type === 'brace')) break;
          const actorName = name(event, actor);
          const prefix = `${actorName}：`;
          const rawPrefix = `${names.get(actor) ?? actor}：`;
          const label = text.startsWith(prefix) ? text.slice(prefix.length)
            : text.startsWith(rawPrefix) ? text.slice(rawPrefix.length) : text;
          add(action === 'attack' || action === 'skill' ? `使用${replaceUnitNames(event, label)}` : replaceUnitNames(event, label));
          break;
        }
        case 'roll':
          if (detail.cover > 0) add(`${name(event, detail.targetId)}受到${detail.coverId ? ` ${detail.coverId} ` : ''}掩体遮蔽`);
          if (!detail.hit) add(`${name(event, detail.targetId)}未被击中`);
          else if (detail.critical) add(`对${name(event, detail.targetId)}打出暴击`);
          else if (detail.intent?.required) add(`击中${name(event, detail.targetId)}`);
          break;
        case 'save':
          if (detail.saved) add(`${name(event, detail.targetId)}通过豁免`);
          break;
        case 'intent':
          add(detail.success ? '意图成立' : '意图未成立，按常规攻击结算');
          break;
        case 'status':
          if (detail.statusId === 'guarded' && turn?.parts.some(p => p.includes('架势防御'))) break;
          add(replaceUnitNames(event, text).replace(/ ×1$/, '')); break;
        case 'proc': case 'expire':
          break;
        case 'damage': case 'heal':
          if (detail.amount !== 0) add(replaceUnitNames(event, text) + change('HP', detail.hpBefore, detail.hpAfter));
          break;
        case 'skill_cost':
          add(replaceUnitNames(event, text) + change('HP', detail.hpBefore ?? detail.remainingHP + detail.hp, detail.hpAfter ?? detail.remainingHP));
          break;
        case 'resource':
          add(replaceUnitNames(event, text) + change(detail.resource?.toUpperCase(), detail.before, detail.after));
          break;
        case 'counter':
          add(replaceUnitNames(event, text).replace(/\bsouls\b/g, '魂数').replace(/\bammo\b/g, '弹药'));
          break;
        case 'outcome':
          turn = null; rows.push(replaceUnitNames(event, text));
          break;
        default: {
          if (type === 'cover_damage' && detail.amount === 0) break;
          const ownAction = turn?.actor === actor && ['move', 'sprint', 'disengage', 'teleport', 'altitude', 'interact', 'skip', 'brace', 'cover_approach'].includes(type);
          let label = replaceUnitNames(event, text);
          const actorRaw = names.get(actor) ?? actor;
          if (ownAction && label.startsWith(`${actorRaw}${position(event, actor)}`)) label = label.slice(`${actorRaw}${position(event, actor)}`.length);
          if (['teleport','knockback'].includes(type) && Number.isInteger(detail.to?.z)) {
            label += `，至 (${detail.to.x}, ${detail.to.y}, z=${detail.to.z})`;
          }
          add(label.replace(/ ×1$/, ''));
        }
      }
    }
    if (!rows.length) continue;
    lines.push('', `- 回合${roundLabel(round)}`);
    for (const row of rows) lines.push(`  - ${typeof row === 'string' ? row : row.text + (row.parts.length ? `：${row.parts.join('；')}` : '')}`);
  }
  if (!report.outcome) lines.push('', '战斗尚未结束。');
  return `${lines.join('\n')}\n`;
}
