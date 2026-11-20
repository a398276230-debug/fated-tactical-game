// 战斗日志 → 玩家可读的叙述。纯函数，不触碰 DOM，便于测试。
// 每条叙述：{ type, tone, icon, title, lines[], roll?, quiet, actorId, targetId }
// roll 用于“骰子卡”演出：
//   { kind:'d20', label, dice, kept, mode, modifier, total, verdict, tone, note? }
//   { kind:'versus', label, left:{name,dice,bonus,total}, right:{...}, verdict, tone }
//   { kind:'chance', label, chance, rolled, verdict, tone }
import { STATUSES } from '../core/combat.js';
import { RATING_TABLE } from '../core/combat_protocol.js';

export const DAMAGE_TYPES = Object.freeze({ physical: '物理', energy: '能量', mental: '精神', true: '真实' });
export const STAT_NAMES = Object.freeze({ str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神' });
const MANEUVERS = { grapple: '擒抱', disarm: '缴械', trip: '绊摔', push: '推撞' };
const INTENT_NAMES = { normal: '常规', function: '机能限制', core: '核心要害', kill: '抹杀', concept: '概念破碎' };
const COUNTER_NAMES = { souls: '魂数', ammo: '弹药' };

const sign = n => (n > 0 ? `+${n}` : `${n}`);
const pct = n => `${Math.round(n * 100)}%`;
const num = n => (Number.isInteger(n) ? `${n}` : Number(n).toFixed(1));
const table = (t, id) => (t && id != null && Object.hasOwn(t, id) ? t[id] : undefined);

export function nameOf(state, id) {
  if (id == null) return '某人';
  return table(state?.units, id)?.name ?? table(state?.covers, id)?.name ?? table(state?.interactives, id)?.name ?? String(id);
}

export function teamOf(state, id) { return table(state?.units, id)?.team ?? null; }

export function statusInfo(state, id) {
  return table(state?.statusTemplates, id) ?? table(STATUSES, id) ?? { name: id };
}

/** 判断一组 d20 的取法。 */
export function diceMode(dice, kept, { advantages = 0, disadvantages = 0, bonusDice = 0 } = {}) {
  if (!Array.isArray(dice) || dice.length <= 1) return 'normal';
  if (dice.length === 3) return 'middle';
  const hi = Math.max(...dice), lo = Math.min(...dice);
  if (hi !== lo) return kept === hi ? 'advantage' : 'disadvantage';
  return advantages + bonusDice > disadvantages ? 'advantage' : 'disadvantage';
}

export function describeDice(dice, kept, mode) {
  if (!Array.isArray(dice) || !dice.length) return `骰值 ${kept}`;
  if (mode === 'normal') return `掷 d20，得 ${kept}`;
  const label = { advantage: `优势：掷 ${dice.length} 颗 d20 取高`, disadvantage: `劣势：掷 ${dice.length} 颗 d20 取低`, middle: '掷 3 颗 d20 取中间值' }[mode];
  return `${label}（${dice.join('、')}），得 ${kept}`;
}

function ratingLine(total, rating) {
  if (!rating) return null;
  if (!rating.multiplier) return `合计 ${total}，不足 4，失手`;
  const row = RATING_TABLE.find(r => r.name === rating.name);
  return `合计 ${total}${row?.min != null ? ` ≥ ${row.min}` : ''}，评级「${rating.name}」，伤害 ×${rating.multiplier}`;
}

function rollEntry(state, log) {
  const d = log.detail ?? {};
  const attacker = nameOf(state, log.actor), target = nameOf(state, d.targetId);
  const kept = d.selected ?? d.dice?.[0];
  const mode = diceMode(d.dice, kept, d);
  const verdict = d.critical ? '暴击' : d.hit ? '命中' : '未命中';
  const tone = d.critical ? 'crit' : d.hit ? 'hit' : 'miss';
  const lines = [describeDice(d.dice, kept, mode)];
  if (Number.isFinite(d.accuracy)) lines.push(`命中修正 ${sign(d.accuracy)}，合计 ${d.total}`);
  const factors = [];
  if (d.distanceTier?.name && Number.isFinite(d.distance)) factors.push(`距离 ${num(d.distance)} 格（${d.distanceTier.name}）`);
  if (d.highGround) factors.push(d.highGround > 0 ? `居高临下 ${sign(d.highGround)}` : `仰攻 ${sign(d.highGround)}`);
  if (d.cover) factors.push(`被${d.coverId ? nameOf(state, d.coverId) : '掩体'}遮挡 −${d.cover}`);
  if (d.flanked) factors.push('夹击 +2');
  if (d.arc === 'back') factors.push('从背后出手');
  if (factors.length) lines.push(`修正来源：${factors.join('，')}`);
  if (kept === 1) lines.push('天然 1：无论加值多少，必定失手');
  else if (kept === 20) lines.push('天然 20：必定暴击');
  const rl = ratingLine(d.total, d.rating);
  if (rl && kept !== 1) lines.push(rl);
  if (d.intent && d.intent.required === false && d.intent.name && d.intent.name !== '常规') lines.push(`意图：${d.intent.name}`);
  return {
    tone, icon: d.critical ? '💥' : d.hit ? '⚔️' : '💨',
    title: `${attacker} 攻击 ${target}：${verdict}${d.hit && d.rating?.name && !d.critical ? `（${d.rating.name}）` : ''}`,
    lines, targetId: d.targetId,
    roll: { kind: 'd20', label: `${attacker} → ${target} · 命中检定`, dice: d.dice ?? [kept], kept, mode, modifier: d.accuracy ?? 0,
      modifierLabel: '命中修正', total: d.total, target: d.defense, targetLabel: '防御', verdict: d.critical ? `暴击！${d.rating?.name ? `「${d.rating.name}」` : ''}` : d.hit ? `命中「${d.rating?.name ?? '有效'}」` : kept === 1 ? '天然 1 · 失手' : '未命中', tone,
      note: d.rating?.multiplier && d.hit ? `伤害 ×${d.rating.multiplier}` : null },
  };
}

function damageEntry(state, log) {
  const d = log.detail ?? {};
  const target = nameOf(state, d.targetId);
  const lines = [];
  const dice = d.dice;
  if (dice && typeof dice === 'object') {
    if (dice.count) lines.push(`基础伤害 ${dice.count}d${dice.sides}（${dice.rolls.join(' + ')}）${dice.bonus ? ` + ${dice.bonus}` : ''} = ${dice.value}`);
    else if (Number.isFinite(dice.value)) lines.push(`基础伤害 ${dice.value}`);
  }
  const mults = [];
  if (d.ratingMultiplier && d.ratingMultiplier !== 1) mults.push(`评级「${d.rating}」×${d.ratingMultiplier}`);
  if (d.intent?.multiplier && d.intent.multiplier !== 1) mults.push(`意图 ×${d.intent.multiplier}`);
  if (d.attackMultiplier && d.attackMultiplier !== 1) mults.push(`攻击加成 ×${num(d.attackMultiplier)}`);
  if (d.multiplier && d.multiplier !== 1) mults.push(`增伤 ×${num(d.multiplier)}`);
  if (d.stanceScale && d.stanceScale !== 1) mults.push(`架势 ×${d.stanceScale}`);
  if (d.offHandScale && d.offHandScale !== 1) mults.push(`副手 ×${d.offHandScale}`);
  if (d.shatter) mults.push(`碎冰 +${pct(d.shatter)}`);
  if (d.vulnerability) mults.push(`易伤 +${pct(d.vulnerability)}`);
  if (d.reduction) mults.push(`减伤 −${pct(d.reduction)}`);
  if (d.attributeReduction) mults.push(`体魄减伤 −${pct(d.attributeReduction)}`);
  if (d.armorMultiplier && d.armorMultiplier < .995) mults.push(`护甲 −${pct(1 - d.armorMultiplier)}`);
  if (mults.length) lines.push(`倍率：${mults.join('，')}`);
  if (d.absorbed) lines.push(`护盾吸收 ${d.absorbed} 点`);
  if (Number.isFinite(d.hpBefore)) lines.push(`生命 ${d.hpBefore} → ${d.hpAfter}`);
  return { tone: 'damage', icon: '🩸', title: log.text, lines, targetId: d.targetId, amount: d.amount ?? 0 };
}

function saveCheck(state, who, c) {
  const stat = STAT_NAMES[c.saveStat] ?? c.saveStat;
  return `${who} ${stat}豁免：d20 得 ${c.saveRoll} ${sign(c.saveBonus)} = ${c.saveTotal}，需要 ${c.saveDC} → ${c.saved ? '通过' : '失败'}`;
}

function saveEntry(state, log) {
  const d = log.detail ?? {};
  const who = nameOf(state, d.targetId);
  const tone = d.saved ? 'save-pass' : 'save-fail';
  const base = { tone, icon: d.saved ? '🛡️' : '⚠️', title: `${who}${d.saved ? '通过' : '未通过'}豁免`, targetId: d.targetId };
  if (d.contest) {
    const { attack: a, defense: b, dc } = d.contest;
    return { ...base, lines: [saveCheck(state, nameOf(state, log.actor), a), saveCheck(state, who, b), `两者差值需小于 ${dc} 才算抵抗成功`],
      roll: { kind: 'versus', label: `${who} · 对抗豁免`, verdict: d.saved ? '抵抗成功' : '抵抗失败', tone,
        left: { name: nameOf(state, log.actor), dice: [a.saveRoll], bonus: a.saveBonus, total: a.saveTotal },
        right: { name: who, dice: [b.saveRoll], bonus: b.saveBonus, total: b.saveTotal } } };
  }
  if (Array.isArray(d.checks)) {
    return { ...base, lines: [...d.checks.map(c => saveCheck(state, who, c)), d.mode === 'all' ? '需要全部通过' : '任一通过即可'],
      roll: { kind: 'd20', label: `${who} · 多重豁免`, dice: d.checks.map(c => c.saveRoll), kept: d.checks[0]?.saveRoll, mode: 'normal',
        modifier: d.checks[0]?.saveBonus ?? 0, total: d.checks[0]?.saveTotal, verdict: d.saved ? '豁免通过' : '豁免失败', tone } };
  }
  const stat = STAT_NAMES[d.saveStat] ?? d.saveStat ?? '';
  return { ...base, lines: [saveCheck(state, who, d)],
    roll: { kind: 'd20', label: `${who} · ${stat}豁免`, dice: [d.saveRoll], kept: d.saveRoll, mode: 'normal', modifier: d.saveBonus ?? 0,
      modifierLabel: `${stat}加值`, total: d.saveTotal, target: d.saveDC, targetLabel: '难度', verdict: d.saved ? '豁免通过' : '豁免失败', tone } };
}

function versus(state, log, label, success, verdictYes, verdictNo) {
  const d = log.detail ?? {};
  const left = nameOf(state, log.actor), right = nameOf(state, d.targetId);
  const lt = d.attackerTotal ?? d.attackerRoll, rt = d.defenderTotal ?? d.defenderRoll;
  const tone = success ? 'hit' : 'miss';
  return {
    tone, icon: success ? '✊' : '✋', title: log.text, targetId: d.targetId,
    lines: [`${left}：d20 得 ${d.attackerRoll}${d.attackerTotal != null && d.attackerTotal !== d.attackerRoll ? `，合计 ${d.attackerTotal}` : ''}`,
      `${right}：d20 得 ${d.defenderRoll}${d.defenderTotal != null && d.defenderTotal !== d.defenderRoll ? `，合计 ${d.defenderTotal}` : ''}`,
      `${lt} 对 ${rt} → ${success ? verdictYes : verdictNo}`],
    roll: { kind: 'versus', label, verdict: success ? verdictYes : verdictNo, tone,
      left: { name: left, dice: [d.attackerRoll], bonus: (d.attackerTotal ?? d.attackerRoll) - d.attackerRoll, total: lt },
      right: { name: right, dice: [d.defenderRoll], bonus: (d.defenderTotal ?? d.defenderRoll) - d.defenderRoll, total: rt } },
  };
}

const MOVE_VERBS = { move: '移动', sprint: '疾跑', disengage: '撤离' };

export function narrate(log, state) {
  const d = log?.detail ?? {};
  const actor = nameOf(state, log?.actor);
  const base = { type: log?.type, tone: 'info', icon: '◆', title: log?.text ?? '', lines: [], quiet: false, actorId: log?.actor ?? null, targetId: d.targetId ?? null };
  const out = extra => ({ ...base, ...extra });
  switch (log?.type) {
    case 'initiative': {
      const rows = [...(d.initiative ?? [])].sort((a, b) => b.total - a.total);
      return out({ icon: '🎲', tone: 'turn', title: '投掷先攻，决定行动顺序',
        lines: rows.map((r, i) => `${i + 1}. ${nameOf(state, r.unitId)}：d20 得 ${r.roll} + 敏捷 ${r.agility}${r.flatInit ? ` ${sign(r.flatInit)}` : ''} = ${num(r.total)}`) });
    }
    case 'initiative_order': return out({ icon: '🔀', lines: (d.order ?? []).length ? [`新顺序：${d.order.map(id => nameOf(state, id)).join(' → ')}`] : [] });
    case 'turn': return out({ tone: 'turn', icon: '⏳', title: `轮到 ${actor} 行动`, quiet: true });
    case 'end': return out({ icon: '⏹', title: `${actor} 结束回合`, quiet: true });
    case 'skip': return out({ tone: 'status', icon: '💫', title: `${actor} 受控制，跳过本回合` });
    case 'action': return out({ icon: '▶', title: log.text, quiet: true });
    case 'move': case 'sprint': case 'disengage': {
      const steps = d.steps ?? d.path?.length ?? 0;
      return out({ tone: 'move', icon: d.interrupted ? '⛔' : '👣',
        title: `${actor}${MOVE_VERBS[log.type]} ${steps} 格${d.interrupted ? '，途中被拦下' : ''}`,
        lines: [`(${d.from?.x}, ${d.from?.y}) → (${d.to?.x}, ${d.to?.y})`, ...(log.type === 'disengage' ? ['撤离不会触发借机攻击'] : [])] });
    }
    case 'teleport': return out({ tone: 'move', icon: '✨', lines: [`(${d.from?.x}, ${d.from?.y}) → (${d.to?.x}, ${d.to?.y})`] });
    case 'knockback': return out({ tone: 'damage', icon: '💨', lines: d.to ? [`被推到 (${d.to.x}, ${d.to.y})`] : [] });
    case 'roll': return out(rollEntry(state, log));
    case 'damage': return out(damageEntry(state, log));
    case 'defeat': return out({ tone: 'defeat', icon: '☠️', title: `${nameOf(state, d.targetId)} 倒下了` });
    case 'heal': return out({ tone: 'heal', icon: '💚', amount: d.amount ?? 0,
      lines: d.dice?.count ? [`治疗量 ${d.dice.count}d${d.dice.sides}（${d.dice.rolls.join(' + ')}）${d.dice.bonus ? ` + ${d.dice.bonus}` : ''}`] : [] });
    case 'status': {
      const s = statusInfo(state, d.statusId);
      return out({ tone: 'status', icon: s.icon ?? '◆',
        lines: [s.description, Number.isInteger(d.remainingTurns) ? `持续 ${d.remainingTurns} 回合` : null].filter(Boolean), statusName: s.name });
    }
    case 'expire': return out({ icon: '⌛', quiet: true });
    case 'status_patch': return out({ icon: '✎', quiet: true });
    case 'shield': return out({ tone: 'heal', icon: '🛡️', lines: d.remaining ? [`护盾剩余 ${d.remaining}`] : [] });
    case 'shield_break': return out({ tone: 'damage', icon: '💔' });
    case 'shatter': return out({ tone: 'crit', icon: '🧊', lines: d.multiplier ? [`这一击伤害 ×${d.multiplier}`] : [] });
    case 'intent': {
      const ok = d.success;
      return out({ tone: ok ? 'hit' : 'miss', icon: ok ? '🎯' : '🛡️',
        title: `意图「${d.name ?? INTENT_NAMES[d.intent] ?? d.intent}」${ok ? '成立' : '受阻'}`,
        lines: [`攻方：阶位 ${d.attackerBase} + 骰 ${d.attackerD20}${d.ratingBonus ? ` + 评级 ${d.ratingBonus}` : ''} = ${d.attackerTotal}`,
          `守方：阶位 ${d.defenderBase} + d20 ${d.defenderD20} + 难度 ${d.intentDifficulty} = ${d.defenderTotal}`,
          ok ? `伤害 ×${d.multiplier}` : '意图落空，按普通命中结算'],
        roll: { kind: 'versus', label: `意图对抗 · ${d.name ?? ''}`, verdict: ok ? '意图成立' : '意图受阻', tone: ok ? 'hit' : 'miss',
          left: { name: actor, dice: [d.attackerD20], bonus: d.attackerTotal - d.attackerD20, total: d.attackerTotal },
          right: { name: nameOf(state, d.targetId), dice: [d.defenderD20], bonus: d.defenderTotal - d.defenderD20, total: d.defenderTotal } } });
    }
    case 'save': return out(saveEntry(state, log));
    case 'contest': return out(versus(state, log, `${MANEUVERS[d.maneuver] ?? '对抗'}检定`, d.success, `${MANEUVERS[d.maneuver] ?? ''}成功`, `${MANEUVERS[d.maneuver] ?? ''}失败`));
    case 'flee': return out(versus(state, log, '逃跑检定', d.success, '逃跑成功', '逃跑失败'));
    case 'morale': return out({ tone: d.shaken ? 'status' : 'defeat', icon: '🏳️',
      lines: [`生命跌破 ${pct(d.threshold ?? 0)}，士气动摇`, Number.isFinite(d.roll) ? `士气检定 d20 得 ${d.roll}` : null].filter(Boolean),
      roll: Number.isFinite(d.roll) ? { kind: 'd20', label: `${nameOf(state, d.targetId)} · 士气检定`, dice: [d.roll], kept: d.roll, mode: 'normal', modifier: 0, total: d.roll,
        verdict: d.shaken ? '动摇' : '溃逃', tone: d.shaken ? 'status' : 'miss' } : undefined });
    case 'proc': {
      const hit = d.triggered;
      return out({ tone: hit ? 'status' : 'info', icon: '🎲', title: `${log.text}${hit ? ' 触发' : ' 未触发'}`, quiet: !hit,
        lines: Number.isFinite(d.chance) ? [`触发几率 ${pct(d.chance)}，掷出 ${pct(d.roll)} → ${hit ? '触发' : '未触发'}`] : [],
        roll: Number.isFinite(d.chance) && hit ? { kind: 'chance', label: `${log.text} · 几率判定`, chance: d.chance, rolled: d.roll, verdict: '触发！', tone: 'status' } : undefined });
    }
    case 'opportunity': return out({ tone: 'crit', icon: '⚡', title: `借机攻击！${log.text}` });
    case 'counter': {
      const item = log.text.split(' · ')[0];
      return out({ icon: '◈', quiet: true, title: `${item} 的${COUNTER_NAMES[d.counterKey] ?? d.counterKey} ${d.before} → ${d.after}` });
    }
    case 'cover_damage': return out({ tone: 'damage', icon: '🪵', lines: Number.isFinite(d.hpAfter) ? [`耐久 ${d.hpBefore} → ${d.hpAfter}`] : [] });
    case 'cover_break': return out({ tone: 'damage', icon: '🧱' });
    case 'cover_approach': return out({ icon: '🧱', quiet: true });
    case 'interact': return out({ tone: 'status', icon: '✴️' });
    case 'brace': case 'block': case 'guard': case 'parry': return out({ tone: 'status', icon: '🛡️' });
    case 'followup': return out({ tone: 'hit', icon: '⚔️' });
    case 'reveal': return out({ icon: '👁' });
    case 'cleanse': return out({ tone: 'heal', icon: '✨' });
    case 'nonlethal': return out({ tone: 'status', icon: '🤚' });
    case 'zone': return out({ tone: 'status', icon: '🌀', lines: d.damage ? [`受到 ${d.damage} 点伤害`] : [] });
    case 'zone_expire': return out({ icon: '🌀', quiet: true });
    case 'spawn': return out({ tone: 'status', icon: '🌱' });
    case 'deathrattle': return out({ tone: 'crit', icon: '💀' });
    case 'skill_cost': return out({ icon: '🩸', quiet: true });
    case 'item': return out({ tone: 'status', icon: '🧪', lines: Number.isFinite(d.remaining) ? [`剩余 ${d.remaining} 次`] : [] });
    case 'outcome': return out({ tone: 'outcome', icon: '🏁' });
    default: return out({});
  }
}

/** 把整份日志按轮次与行动单位分组，供日志抽屉使用。 */
export function narrateAll(logs, state) {
  return (logs ?? []).map((log, index) => ({ index, round: log.round, ...narrate(log, state) }));
}
