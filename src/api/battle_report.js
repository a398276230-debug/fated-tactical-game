import { resourceLabel } from '../core/resource_names.js';

import { evaluateExpr } from '../core/formula.js';

const damageNames = { physical: '物理', energy: '能量', mental: '精神', true: '真实' };
const statNames = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神', accuracy: '命中', dodge: '闪避',
  defense: '防御', initiative: '先攻', armor: '护甲', armorPierce: '穿甲', incomingAccuracy: '被命中修正', intentBonus: '意图加值', intentDifficulty: '意图难度', shatter: '碎裂增伤', damageReduction: '减伤比例',
  damageReductionFlat: '固定减伤', damage: '伤害', healing: '治疗', skillPower: '技能威力',
};
const modifierNames = {
  ...statNames, movement: '移动距离', apMax: '行动点上限', incomingDistanceOffset: '表观距离',
  checkBonus: '检定加值', initiativeFlat: '先攻', dcBonus: '豁免难度', resistBonus: '豁免加值',
  damageFlat: '固定增伤', damageMult: '增伤', finalDamageMult: '最终伤害', incomingDamageMult: '易伤',
  healingMult: '治疗', incomingHealMult: '受治疗', costMult: '消耗',
  damageReduction: '减伤', dr: '最终减伤', armorPiercePercent: '穿甲比例',
};
const ratios = new Set(['damageReduction', 'dr', 'armorPiercePercent', 'shatter']);
const flagModifiers = {
  taunted: '被嘲讽', intercept: '可拦截攻击', hidden: '隐身', infiniteAmmo: '弹药不限',
  guaranteed_hit: '必定命中', guaranteed_crit: '必定暴击', untargetableSingle: '不可被单体选中',
  blockResourceRestore: '禁止资源恢复', preserveLife: '保留至少 1 HP', blockRevive: '禁止复活',
  harmless: '无害', undispellable: '不可驱散', concept_immune: '概念免疫',
};
const slotNames = { action: '动作', move: '移动', attack: '攻击', cast: '施法', reaction: '反应', fly: '飞行', teleport: '瞬移' };
const hookNames = {
  active: '主动使用', before_action: '行动前', before_target: '选定目标前', before_check: '检定前',
  after_natural_roll: '掷出自然骰后', after_check: '检定后', before_commit: '结算前', before_status: '施加状态前',
  on_lethal_p1: '首次致命结算', on_lethal_p2: '二次致命结算', after_action: '行动结束', after_move: '移动后',
  after_hit: '命中', after_damage: '受到伤害', after_heal: '受到治疗', after_status_applied: '施加状态后',
  after_status_removed: '移除状态后', on_status_immunized: '免疫状态', on_summon_evict: '召唤物退场',
  on_death: '倒下', on_ally_death: '队友倒下', on_kill: '击杀', turn_start: '回合开始', turn_end: '回合结束',
  round_start: '轮次开始', round_end: '轮次结束',
};
const checkGrade = (success, roll) => success ? (roll === 20 ? '大成功' : '成功') : (roll === 1 ? '大失败' : '失败');
const contestLabels = { grapple: '擒抱', disarm: '缴械', trip: '绊摔', push: '推撞' };
import { proseNumber, attributionLine, choiceProse, movementProgressText } from '../core/log-attribution.js';
const signed = value => `${value > 0 ? '+' : ''}${proseNumber(value)}`;
const percent = value => Number((value * 100).toFixed(4));
const notes = parts => parts.length ? `（${parts.join('，')}）` : '';
const attributionText = detail => {
  const cause = attributionLine(detail);
  return cause ? `（${cause}）` : '';
};

function statusNotes(detail) {
  const parts = [];
  if (detail.durationType === 'persistent') parts.push('跨战斗持续');
  else if (detail.durationType === 'until_removed') parts.push('持续至解除');
  else if (Number.isInteger(detail.remainingTurns)) parts.push(`持续 ${detail.remainingTurns} 回合`);
  const mods = detail.mods ?? [];
  const vars = detail.vars ?? {};
  const resolve = (value, stacks = detail.stacks ?? 1) => evaluateExpr(value, { status: { ...detail, stacks, vars }, vars });
  const scaled = value => typeof value === 'string' && /\bstatus\.stacks\b/.test(value);
  const shield = detail.category === 'shield' ? vars.shieldAmount : undefined;
  if (Number.isFinite(shield)) parts.push(`护盾 ${shield} 点`);
  for (const hook of ['turn_start', 'turn_end']) {
    const effects = (detail.rules ?? []).filter(rule => rule.hook === hook).flatMap(rule => rule.program).flatMap(op => {
      if (op.op !== 'damage' && op.op !== 'heal') return [];
      const perLayer = scaled(op.amount);
      const amount = resolve(op.amount, perLayer ? 1 : undefined);
      const label = op.op === 'heal' ? '治疗' : `${damageNames[op.damageType ?? 'true']}伤害`;
      if (!Number.isFinite(amount)) return [`${label}（${op.amount}）`];
      const total = perLayer && detail.stacks > 1 ? `（当前合计 ${proseNumber(resolve(op.amount))} 点）` : '';
      return [`${perLayer || detail.stacks === 1 ? '每层 ' : ''}${proseNumber(amount)} 点${label}${total}`];
    });
    if (effects.length) parts.push(`持有者${hookNames[hook]}：${effects.join('、')}`);
  }
  for (const mod of mods) for (const field of ['flat', 'additivePercent', 'mult']) {
    if (mod[field] === undefined) continue;
    const perLayer = scaled(mod[field]);
    const value = resolve(mod[field], perLayer ? 1 : undefined);
    let label = mod.stat === 'checkBonus' && mod.checkKind === 'attack' ? '命中' : modifierNames[mod.stat];
    if (mod.stat === 'advantage') label = value < 0 ? '劣势骰' : '优势骰';
    const ratio = ratios.has(mod.stat) && field === 'flat' || field === 'additivePercent';
    const shown = !Number.isFinite(value) ? `（${mod[field]}）` : field === 'mult' ? `×${proseNumber(value)}`
      : ratio ? `${signed(percent(value))}%` : signed(mod.stat === 'advantage' ? Math.abs(value) : value);
    parts.push(`${perLayer && detail.stacks > 1 ? '每层' : ''}${label} ${shown}`);
  }
  const flags = new Set([...(detail.flags ?? []), ...mods.flatMap(mod => mod.flags ?? [])]);
  for (const flag of flags) if (flagModifiers[flag]) parts.push(flagModifiers[flag]);
  const locks = new Set(mods.flatMap(mod => mod.locks ?? []));
  if (Object.keys(slotNames).every(slot => locks.has(slot))) parts.push('跳过行动');
  else if (locks.size === 1 && locks.has('move')) parts.push('无法移动');
  else if (locks.size) parts.push(`封锁：${[...locks].map(slot => slotNames[slot]).join('、')}`);
  if (detail.expireOn) {
    const triggers = [].concat(detail.expireOn).map(rule => {
      const filter = rule.filter ?? '';
      const qualifier = rule.hook === 'after_hit' && /target\.id\s*==\s*self\.id/.test(filter) ? '受到命中'
        : rule.hook === 'after_damage' && /event\.direct\s*==\s*(true|false)\b/.test(filter)
          ? (/event\.direct\s*==\s*true\b/.test(filter) ? '受到直接伤害' : '受到间接伤害') : hookNames[rule.hook];
      return qualifier + (/source\.id\s*!=\s*self\.id/.test(filter) ? '（自身来源除外）' : '');
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
  const idsByName = new Map();
  for (const [id, label] of names) if (label) {
    if (!idsByName.has(label)) idsByName.set(label, []);
    idsByName.get(label).push(id);
  }
  const duplicateNames = new Set([...idsByName].filter(([, ids]) => ids.length > 1).map(([label]) => label));
  const name = (event, id) => {
    const label = names.get(id) ?? id;
    const identity = duplicateNames.has(label) ? `〔${id}〕` : '';
    return `${label}${identity}${position(event, id)}`;
  };
  const labels = [...idsByName.keys()].sort((a, b) => b.length - a.length);
  const unitPattern = labels.length ? new RegExp(labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  const targetNarration = new Set(['status', 'status_patch', 'damage', 'heal', 'resource', 'shield', 'defeat', 'expire', 'cleanse', 'teleport', 'knockback', 'revive']);
  const replaceUnitNames = (event, text) => {
    if (!unitPattern) return text;
    const target = event.detail?.targetId;
    const contextIds = targetNarration.has(event.type) ? [target, event.actor] : [event.actor, target];
    return cleanProse(text).replace(unitPattern, label => {
      const ids = idsByName.get(label);
      const id = contextIds.find(candidate => ids.includes(candidate)) ?? (ids.length === 1 ? ids[0] : undefined);
      return id === undefined ? label : name(event, id);
    });
  };
  const checkTarget = (event, detail) => detail.targetKind === 'cover'
    ? detail.targetName ?? detail.targetId : name(event, detail.targetId);
  const change = (resource, before, after) => Number.isFinite(before) && Number.isFinite(after)
    ? `（${resource} ${proseNumber(before)} → ${proseNumber(after)}）` : '';
  const cleanProse = text => typeof text === 'string'
    ? text.replace(/-?\d+\.\d{3,}/g, value => proseNumber(Number(value))) : text;
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
          if (detail.attackSource) {
            const targets = (detail.attackTargets ?? []).map(t => t.unit ? name(event, t.unit) : t.cover);
            if (!targets.length && detail.corpseId) targets.push(name(event, detail.corpseId));
            const aim = targets.join('、') || `格子 (${detail.action.x}, ${detail.action.y})`;
            const intent = {function:'机能限制', core:'核心要害', kill:'抹杀', concept:'概念破碎'}[detail.intent];
            add(`${actorName}使用${detail.attackSource}${intent ? `以意图：${intent}` : ''}${action === 'skill' ? '，目标：' : '攻击'}${aim}`);
            break;
          }
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
          const dodgeNote = detail.ignoreDodge && detail.rawDodgeBonus ? `无视闪避 ${signed(detail.rawDodgeBonus)}`
            : detail.dodgeBonus ? `守方闪避 ${signed(detail.dodgeBonus)}` : null;
          if (!detail.hit) add(`${target}未被击中` + notes([checkGrade(false, detail.selected), '失手', dodgeNote].filter(Boolean)));
          else {
            const verdict = detail.critical ? `对${target}打出暴击` : `击中${target}`;
            const grade = detail.automatic ? '自动命中' : checkGrade(true, detail.selected);
            add(verdict + notes([grade, detail.rating?.name, detail.execution && '处决加成', dodgeNote].filter(Boolean)));
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
          add(`${target}${detail.saved ? '通过' : '未通过'}${source}${stat}豁免${notes(result)}${attributionText(detail)}`);
          break;
        }
        case 'choice': {
          if (!detail.choice) { add(replaceUnitNames(event, text) + attributionText(detail)); break; }
          const { title, lines } = choiceProse(detail.choice, name(event, actor), id => name(event, id));
          add(title + notes(lines) + attributionText(detail));
          break;
        }
        case 'intent':
          add(`${detail.success ? '意图成立' : '意图未成立'}${notes([checkGrade(detail.success, detail.attackerD20)])}${detail.success ? '' : '，按常规攻击结算'}`);
          break;
        case 'contest': case 'flee': {
          const target = detail.targetId ? `（对手 ${name(event, detail.targetId)}）` : '';
          const label = type === 'flee' ? '逃跑' : contestLabels[detail.maneuver] ?? '对抗';
          add(`${name(event, actor)}${label}检定${checkGrade(detail.success, detail.attackerRoll)}${target}`);
          break;
        }
        case 'morale':
          add(replaceUnitNames(event, text) + (Number.isFinite(detail.roll) ? notes([`战意检定${checkGrade(detail.outcome ? detail.roll >= 12 : detail.shaken, detail.roll)}`]) : ''));
          break;
        case 'status': case 'status_patch': {
          const brace = events[i - 1];
          if (type === 'status' && brace?.type === 'brace' && brace.actor === detail.targetId
            && (detail.stacks ?? 1) === 1 && (!detail.durationType || detail.durationType === 'battle_turns')
            && !detail.expireOn && !detail.amount && brace.detail?.turns === detail.remainingTurns
            && detail.mods?.length === 1 && detail.mods[0].stat === 'damageReduction' && detail.vars?.reduction === brace.detail.reduction) break;
          const parts = statusNotes(detail);
          if (type === 'status_patch' && detail.stacks > 1) parts.unshift(`${detail.stacks} 层`);
          if (type === 'status' && actor && detail.targetId && actor !== detail.targetId) parts.push(`来源 ${name(event, actor)}`);
          add(replaceUnitNames(event, text).replace(/ ×1$/, '') + notes(parts) + attributionText(detail));
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
        case 'vm_check':
          add(replaceUnitNames(event, text) + (detail.targetId && detail.targetId !== actor ? `（目标 ${name(event, detail.targetId)}）` : '') + attributionText(detail));
          break;
        case 'damage': case 'heal':
          if (detail.amount !== 0) {
            const origin = detail.statusId && actor && actor !== detail.targetId ? `（施加者 ${name(event, actor)}）` : '';
            add(replaceUnitNames(event, text) + change('HP', detail.hpBefore, detail.hpAfter) + origin + attributionText(detail));
          }
          break;
        case 'skill_cost':
          add(replaceUnitNames(event, text) + change('HP', detail.hpBefore ?? detail.remainingHP + detail.hp, detail.hpAfter ?? detail.remainingHP));
          break;
        case 'resource':
          add(replaceUnitNames(event, text) + change(detail.resourceLabel ?? detail.resource?.toUpperCase(), detail.before, detail.after) + attributionText(detail));
          break;
        case 'counter': {
          const { counterKey, before, after } = detail;
          const suffix = ` · ${counterKey} ${before} → ${after}`;
          const label = counterKey && text.endsWith(suffix)
            ? `${text.slice(0, -suffix.length)} · ${resourceLabel(counterKey)} ${before} → ${after}` : text;
          add(replaceUnitNames(event, label) + attributionText(detail));
          break;
        }
        case 'outcome':
          turn = null; rows.push(replaceUnitNames(event, text));
          break;
        default: {
          if (type === 'cover_damage' && detail.amount === 0) break;
          const ownAction = turn?.actor === actor && ['move', 'sprint', 'disengage', 'teleport', 'altitude', 'interact', 'skip', 'brace', 'cover_approach'].includes(type);
          const banked = Number.isFinite(detail.progressPermille) && ['move', 'sprint', 'disengage'].includes(type);
          const verb = type === 'sprint' ? '疾跑推进' : '蓄步推进';
          let label = banked ? `${ownAction ? '' : name(event, actor)}${verb}，跨区进度${movementProgressText(detail.progressPermille)}`
            : replaceUnitNames(event, text);
          const actorRaw = names.get(actor) ?? actor;
          if (!banked && ownAction && label.startsWith(`${actorRaw}${position(event, actor)}`)) label = label.slice(`${actorRaw}${position(event, actor)}`.length);
          if (['teleport','knockback'].includes(type) && Number.isInteger(detail.to?.z)) {
            const destination = `(${detail.to.x}, ${detail.to.y}, z=${detail.to.z})`;
            if (!text.includes(`至 ${destination}`)) label += `，至 ${destination}`;
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
