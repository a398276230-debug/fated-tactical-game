const damageNames = { physical: '物理', energy: '能量', mental: '精神', true: '真实' };
const statNames = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神', accuracy: '命中', dodge: '闪避',
  defense: '防御', initiative: '先攻', armor: '护甲', armorPierce: '穿甲', damageReduction: '减伤比例',
  damageReductionFlat: '固定减伤', damage: '伤害', healing: '治疗', skillPower: '技能威力',
};
const flatModifiers = {
  armor: '护甲', movement: '移动距离', accuracy: '命中', incomingAccuracy: '被命中修正',
  advantage: '优势骰', disadvantage: '劣势骰', intentDifficulty: '意图难度', dodgeBonus: '闪避',
};
const ratioModifiers = {
  reduction: '减伤', vulnerability: '易伤', shatter: '碎裂增伤', damageBonus: '增伤',
  attackPercent: '攻击', attributePercent: '属性',
};
const flagModifiers = {
  taunted: '被嘲讽', intercept: '可拦截攻击', skip: '跳过行动', rooted: '无法移动', hidden: '隐身',
  infiniteAmmo: '弹药不限', guaranteed_hit: '必定命中', guaranteed_crit: '必定暴击',
  blockResourceRestore: '禁止资源恢复', preserveLife: '保留至少 1 HP',
};
const expiryEvents = {
  on_attack: '发动攻击', on_hit: '命中', on_struck: '受到命中', on_damaged: '受到伤害', on_kill: '击杀',
  on_death: '倒下', on_turn_start: '回合开始', on_turn_end: '回合结束', on_skill_cast: '施放技能',
  on_equip: '装备生效', on_heal: '受到治疗', on_ally_death: '队友倒下',
};
const checkGrade = (success, roll) => success ? (roll === 20 ? '大成功' : '成功') : (roll === 1 ? '大失败' : '失败');
const maneuvers = { grapple: '擒抱', disarm: '缴械', trip: '绊摔', push: '推撞' };
const signed = value => `${value > 0 ? '+' : ''}${value}`;
const percent = value => Number((value * 100).toFixed(4));
const notes = parts => parts.length ? `（${parts.join('，')}）` : '';

function statusNotes(detail) {
  const parts = [];
  if (detail.durationType === 'persistent') parts.push('跨战斗持续');
  else if (detail.durationType === 'until_removed') parts.push('持续至解除');
  else if (Number.isInteger(detail.remainingTurns)) parts.push(`持续 ${detail.remainingTurns} 回合`);
  const m = detail.effectiveModifiers ?? detail.modifiers ?? {};
  if (Number.isFinite(detail.amount ?? m.amount)) parts.push(`护盾 ${detail.amount ?? m.amount} 点`);
  const ticks = [];
  const tickAmount = (value, label) => `每层 ${value} 点${label}`
    + (detail.stacks > 1 ? `（当前合计 ${value * detail.stacks} 点）` : '');
  if (m.damage) ticks.push(tickAmount(m.damage, `${damageNames[m.damageType ?? 'true']}伤害`));
  if (m.heal) ticks.push(tickAmount(m.heal, '治疗'));
  if (ticks.length) parts.push(`持有者回合${detail.tickTiming === 'onTurnEnd' ? '结束' : '开始'}：${ticks.join('、')}`);
  if (m.reflect) parts.push(`反伤 ${m.reflect} 点`);
  const perLayer = detail.stacks > 1 ? '每层' : '';
  for (const [key, label] of Object.entries(flatModifiers)) if (m[key]) parts.push(`${perLayer}${label} ${signed(m[key])}`);
  for (const [key, label] of Object.entries(ratioModifiers)) if (m[key]) parts.push(`${perLayer}${label} ${signed(percent(m[key]))}%`);
  if (m.finalDamageMultiplier != null && m.finalDamageMultiplier !== 1) parts.push(`${perLayer}最终伤害 ×${m.finalDamageMultiplier}`);
  for (const [key, label] of Object.entries(flagModifiers)) if (m[key]) parts.push(label);
  if (detail.expireOn) {
    const triggers = [].concat(detail.expireOn).map(rule => {
      const qualifier = rule.damageType === 'direct' ? '受到直接伤害' : rule.damageType === 'indirect' ? '受到间接伤害' : expiryEvents[rule.trigger];
      return qualifier + (rule.exceptSource === 'self' ? '（自身来源除外）' : '');
    });
    parts.push(`${triggers.join('或')}时解除`);
  }
  return parts;
}

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
  const checkTarget = (event, detail) => detail.targetKind === 'cover'
    ? detail.targetName ?? detail.targetId : name(event, detail.targetId);
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
        case 'roll': case 'hit_result': {
          const target = checkTarget(event, detail);
          if (detail.cover > 0) add(`${target}受到${detail.coverId ? ` ${detail.coverId} ` : ''}掩体遮蔽`);
          if (!detail.hit) add(`${target}未被击中（${checkGrade(false, detail.selected)}，失手）`);
          else {
            const verdict = detail.critical ? `对${target}打出暴击` : `击中${target}`;
            const grade = detail.automatic ? '自动命中' : checkGrade(true, detail.selected);
            add(verdict + notes([grade, detail.rating?.name].filter(Boolean)));
          }
          break;
        }
        case 'save': {
          const target = checkTarget(event, detail);
          if (detail.contest) {
            const { attack, defense } = detail.contest;
            add(`${name(event, actor)}对${target}进行${statNames[attack.saveStat]}对${statNames[defense.saveStat]}的${detail.sourceName ?? '效果'}对抗${notes([
              `施术方${checkGrade(!detail.saved, attack.saveRoll)}`, `抵抗方${checkGrade(detail.saved, defense.saveRoll)}`,
            ])}`);
            break;
          }
          const checks = detail.checks?.map(check => `${statNames[check.saveStat]}${checkGrade(check.saved, check.saveRoll)}`);
          const stat = statNames[detail.saveStat] ?? (checks ? '多重' : '');
          const result = checks ? [checkGrade(detail.saved), detail.mode === 'all' ? '须全部通过' : '任一通过即可', ...checks]
            : [checkGrade(detail.saved, detail.saveRoll)];
          const source = detail.sourceName ? `对${detail.sourceName}的` : '';
          add(`${target}${detail.saved ? '通过' : '未通过'}${source}${stat}豁免${notes(result)}`);
          break;
        }
        case 'intent':
          add(`${detail.success ? '意图成立' : '意图未成立'}${notes([checkGrade(detail.success, detail.attackerD20)])}${detail.success ? '' : '，按常规攻击结算'}`);
          break;
        case 'contest': case 'flee': {
          const target = detail.targetId ? `（对手 ${name(event, detail.targetId)}）` : '';
          const label = type === 'flee' ? '逃跑' : maneuvers[detail.maneuver] ?? '对抗';
          add(`${name(event, actor)}${label}检定${checkGrade(detail.success, detail.attackerRoll)}${target}`);
          break;
        }
        case 'parry':
          add(replaceUnitNames(event, text) + notes([detail.perfect ? '大成功' : checkGrade(detail.success, detail.defenderRoll)]));
          break;
        case 'morale':
          add(replaceUnitNames(event, text) + (detail.check ? notes([`士气检定${checkGrade(detail.shaken, detail.roll)}`]) : ''));
          break;
        case 'status': case 'status_patch': {
          const brace = events[i - 1];
          if (type === 'status' && brace?.type === 'brace' && brace.actor === detail.targetId
            && (detail.stacks ?? 1) === 1 && (!detail.durationType || detail.durationType === 'battle_turns')
            && !detail.expireOn && !detail.amount && brace.detail?.turns === detail.remainingTurns
            && Object.keys(detail.modifiers ?? {}).every(key => key === 'reduction' && detail.modifiers[key] === brace.detail.reduction)) break;
          const parts = statusNotes(detail);
          if (type === 'status_patch' && detail.stacks > 1) parts.unshift(`${detail.stacks} 层`);
          if (type === 'status' && actor && detail.targetId && actor !== detail.targetId) parts.push(`来源 ${name(event, actor)}`);
          add(replaceUnitNames(event, text).replace(/ ×1$/, '') + notes(parts));
          break;
        }
        case 'stat_modifier': {
          const stat = (damageNames[detail.damageType] ?? '') + statNames[detail.stat];
          const parts = [`持续 ${detail.turns} 回合`];
          if (detail.flat) parts.push(`${stat} ${signed(detail.flat)}`);
          if (detail.percent) parts.push(`${stat} ${signed(percent(detail.percent))}%`);
          add(replaceUnitNames(event, text) + notes(parts));
          break;
        }
        case 'proc': {
          const target = detail.targetId && detail.targetId !== actor ? `（目标 ${name(event, detail.targetId)}）` : '';
          const label = detail.die == null ? '触发判定' : '触发检定';
          add(`${actor ? `${name(event, actor)}的` : ''}${text}${label}${checkGrade(detail.triggered, detail.die)}${target}`);
          break;
        }
        case 'damage': case 'heal':
          if (detail.amount !== 0) {
            const origin = detail.statusId && actor && actor !== detail.targetId ? `（施加者 ${name(event, actor)}）` : '';
            add(replaceUnitNames(event, text) + change('HP', detail.hpBefore, detail.hpAfter) + origin);
          }
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
