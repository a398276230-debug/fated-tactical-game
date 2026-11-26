// 演出导演：把一次行动产生的日志按顺序演给玩家看。
// 规则状态是瞬时结算的；演出期间棋盘停留在行动前的画面，逐条播放
// 移动 → 掷骰 → 命中/伤害 → 字幕，播完再切到结算后的画面。
import { narrate } from './narrate.js';
import { elementLabel } from '../core/elements.js';

const STEP_MS = 150, BANNER_MS = 750, RIBBON_MS = 1300, ROLL_MS = 560, HOLD_MS = 1050, HIT_MS = 420, CAPTION_LIFE = 6500;

export function createPlayback(root, { show, onIdle } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const $ = id => root.querySelector(`[id="${id}"]`);
  const app = root.querySelector('.ft-app') ?? root;
  const queue = [];
  const waiters = new Set();
  let running = false, skipping = false, speed = 1, generation = 0, current = null;

  const reduced = () => win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const canAnimate = el => typeof el?.animate === 'function' && !reduced();

  function wait(ms) {
    if (skipping || speed <= 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { win.clearTimeout(timer); waiters.delete(done); resolve(); };
      const timer = win.setTimeout(done, ms * speed);
      waiters.add(done);
    });
  }
  async function play(el, frames, options) {
    if (skipping || speed <= 0 || !canAnimate(el)) return;
    const anim = el.animate(frames, { ...options, duration: options.duration * speed });
    const stop = () => anim.finish();
    waiters.add(stop);
    try { await anim.finished; } catch { /* cancelled */ } finally { waiters.delete(stop); }
  }

  // ---------- 棋盘坐标 ----------
  const frame = () => $('board-frame');
  const cellAt = (x, y) => root.querySelector(`#board [data-x="${x}"][data-y="${y}"]`);
  const tokenOf = id => [...root.querySelectorAll('#board .axis-unit[data-unit-id]')].find(node => node.dataset.unitId === id);
  const positions = new Map(); // 演出中单位的“视觉位置”
  const homes = new Map();     // token 原本所在格
  function center(x, y, id) {
    const cell = cellAt(x, y), box = frame()?.getBoundingClientRect();
    if (!cell || !box) return null;
    const token = id && [...cell.querySelectorAll('.axis-unit[data-unit-id]')].find(node => node.dataset.unitId === id);
    const r = (token ?? cell).getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, w: r.width };
  }
  function whereIs(state, id) {
    if (positions.has(id)) return positions.get(id);
    const thing = state.units?.[id] ?? state.covers?.[id] ?? state.interactives?.[id];
    return thing ? { x: thing.x, y: thing.y } : null;
  }
  function offset(id, to) {
    const home = homes.get(id), a = home && center(home.x, home.y, id), b = center(to.x, to.y);
    return a && b ? `translate(${b.x - a.x}px, ${b.y - a.y}px)` : 'none';
  }

  // ---------- 演出元件 ----------
  async function walk(state, id, path) {
    const token = tokenOf(id);
    if (!token || !path?.length) return;
    if (!homes.has(id)) homes.set(id, { ...state.units[id] });
    token.classList.add('is-moving');
    const cell = token.closest('.tactical-cell');
    if (cell) cell.style.zIndex = '25';
    for (const step of path) {
      const from = token.style.transform || 'none', to = offset(id, step);
      token.style.transform = to;
      positions.set(id, { x: step.x, y: step.y });
      await play(token, [{ transform: from }, { transform: to }], { duration: STEP_MS, easing: 'ease-in-out' });
    }
  }
  async function blink(state, id, to) {
    const token = tokenOf(id);
    if (!token) return;
    if (!homes.has(id)) homes.set(id, { ...state.units[id] });
    await play(token, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
    token.style.transform = offset(id, to);
    positions.set(id, { x: to.x, y: to.y });
    await play(token, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }
  async function lunge(state, attackerId, targetId) {
    const token = tokenOf(attackerId), a = whereIs(state, attackerId), b = whereIs(state, targetId);
    if (!token || !a || !b) return;
    const p = center(a.x, a.y, attackerId), q = center(b.x, b.y, targetId);
    if (!p || !q) return;
    const far = Math.hypot(q.x - p.x, q.y - p.y) > p.w * 1.6;
    const base = token.style.transform && token.style.transform !== 'none' ? `${token.style.transform} ` : '';
    const dx = (q.x - p.x) * (far ? .08 : .32), dy = (q.y - p.y) * (far ? .08 : .32);
    const swing = play(token, [{ transform: `${base}translate(0,0)` }, { transform: `${base}translate(${-dx * .3}px, ${-dy * .3}px)`, offset: .3 },
      { transform: `${base}translate(${dx}px, ${dy}px)`, offset: .6 }, { transform: `${base}translate(0,0)` }], { duration: 380, easing: 'ease-out' });
    if (far) await bolt(p, q);
    await swing;
  }
  async function bolt(p, q) {
    const fx = $('board-fx');
    if (!fx || skipping || speed <= 0) return;
    const dot = doc.createElement('i');
    dot.className = 'ft-bolt';
    Object.assign(dot.style, { left: `${p.x}px`, top: `${p.y}px` });
    fx.append(dot);
    await play(dot, [{ transform: 'translate(-50%, -50%) scale(.6)' }, { transform: `translate(calc(${q.x - p.x}px - 50%), calc(${q.y - p.y}px - 50%)) scale(1)` }], { duration: 260, easing: 'ease-in' });
    dot.remove();
  }
  function shake(id, heavy) {
    const token = tokenOf(id) ?? root.querySelector(`#board [data-cover="${id}"], #board [data-interact="${id}"]`);
    if (!token) return Promise.resolve();
    const base = token.style.transform && token.style.transform !== 'none' ? `${token.style.transform} ` : '';
    const k = heavy ? 7 : 4;
    return play(token, [{ transform: `${base}translateX(0)`, filter: 'brightness(1)' }, { transform: `${base}translateX(${-k}px)`, filter: 'brightness(2.2) saturate(.4)', offset: .2 },
      { transform: `${base}translateX(${k}px)`, offset: .45 }, { transform: `${base}translateX(${-k / 2}px)`, offset: .7 }, { transform: `${base}translateX(0)`, filter: 'brightness(1)' }], { duration: 300 });
  }
  function fall(id) {
    const token = tokenOf(id);
    if (!token) return Promise.resolve();
    token.style.opacity = '.4'; token.style.filter = 'grayscale(1)';
    return play(token, [{ opacity: 1, filter: 'grayscale(0)' }, { opacity: .4, filter: 'grayscale(1)' }], { duration: 520 });
  }
  function float(state, id, text, tone, sub, damageType) {
    const fx = $('board-fx'), at = whereIs(state, id), c = at && center(at.x, at.y, id);
    if (!fx || !c || skipping || speed <= 0) return;
    const node = doc.createElement('div');
    node.className = `ft-float ${tone}`;
    if (damageType) node.dataset.damageType = damageType;
    node.textContent = text;
    if (sub) { const s = doc.createElement('small'); s.textContent = sub; node.append(s); }
    const jitter = (fx.childElementCount % 3 - 1) * 14;
    Object.assign(node.style, { left: `${c.x + jitter}px`, top: `${c.y - c.w * .2}px` });
    fx.append(node);
    const anim = canAnimate(node) ? node.animate([{ opacity: 0, transform: 'translate(-50%, -30%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%, -80%) scale(1.15)', offset: .15 },
      { opacity: 1, transform: 'translate(-50%, -110%) scale(1)', offset: .7 }, { opacity: 0, transform: 'translate(-50%, -160%) scale(.95)' }], { duration: 1300 * Math.max(speed, .6), easing: 'ease-out', fill: 'forwards' }) : null;
    const remove = () => node.remove();
    if (anim) anim.finished.then(remove, remove); else win.setTimeout(remove, 1200);
  }

  async function banner(text, sub, faction, ms = BANNER_MS) {
    const node = $('turn-banner');
    if (!node || skipping || speed <= 0) return;
    const b = doc.createElement('b'), s = doc.createElement('small');
    b.textContent = text; s.textContent = sub;
    node.replaceChildren(b, s);
    node.dataset.faction = faction ?? '';
    node.hidden = false;
    await play(node, [{ opacity: 0, transform: 'translateY(-50%) scaleY(.4)' }, { opacity: 1, transform: 'translateY(-50%) scaleY(1)' }], { duration: 200, easing: 'ease-out' });
    await wait(ms);
    await play(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
    node.hidden = true;
  }
  function ribbon(text, faction) {
    const node = $('action-ribbon');
    if (!node || skipping || speed <= 0) return;
    node.textContent = text;
    node.dataset.faction = faction ?? '';
    node.hidden = false;
    win.clearTimeout(ribbon.timer);
    ribbon.timer = win.setTimeout(() => { node.hidden = true; }, Math.max(RIBBON_MS * speed, 600));
  }
  function caption(entry) {
    const list = $('caption');
    if (!list) return;
    const li = doc.createElement('li');
    li.dataset.tone = entry.tone;
    const icon = doc.createElement('span'), text = doc.createElement('span');
    icon.textContent = entry.icon; text.textContent = entry.title;
    li.append(icon, text);
    if (entry.lines?.length && !entry.roll) { const s = doc.createElement('small'); s.textContent = entry.lines.at(-1); li.append(s); }
    list.append(li);
    while (list.children.length > 4) list.firstElementChild.remove();
    win.setTimeout(() => li.remove(), CAPTION_LIFE);
  }

  // ---------- 骰子卡 ----------
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const signed = n => (n >= 0 ? `+ ${n}` : `− ${-n}`);
  function die(value) {
    const d = el('span', 'ft-die is-rolling', '?');
    d.dataset.value = value;
    return d;
  }
  async function tumble(dice) {
    if (skipping || speed <= 0) return;
    const spin = win.setInterval(() => { for (const d of dice) d.textContent = 1 + Math.floor(Math.random() * 20); }, 55);
    await wait(ROLL_MS);
    win.clearInterval(spin);
  }
  function settle(dice, kept) {
    let marked = false;
    for (const d of dice) {
      const v = Number(d.dataset.value);
      d.classList.remove('is-rolling');
      d.textContent = Number.isFinite(v) ? v : '–';
      if (v === 20) d.classList.add('is-nat20');
      if (v === 1) d.classList.add('is-nat1');
      if (kept != null && dice.length > 1) {
        const keep = !marked && v === kept;
        if (keep) marked = true;
        d.classList.add(keep ? 'is-kept' : 'is-dropped');
      } else d.classList.add('is-kept');
    }
  }
  function formula(parts) {
    const row = el('div', 'ft-formula');
    for (const [value, label, cls] of parts) {
      const cell = el('span', '');
      cell.style.display = 'grid'; cell.style.justifyItems = 'center';
      cell.append(el('b', cls ?? '', value));
      if (label) cell.append(el('i', '', label));
      row.append(cell);
    }
    return row;
  }
  const op = t => [t, '', 'op'];
  async function diceCard(roll) {
    const stage = $('dice-stage');
    if (!stage || !roll || skipping || speed <= 0) return;
    const card = el('div', 'ft-dice-card');
    card.dataset.tone = roll.tone ?? 'hit';
    card.append(el('div', 'ft-dice-label', roll.label));
    const verdict = el('div', 'ft-verdict', roll.verdict);
    verdict.style.visibility = 'hidden';
    let dice = [], kept = null, details = [];
    if (roll.kind === 'd20') {
      dice = (roll.dice?.length ? roll.dice : [roll.kept]).map(die);
      kept = roll.kept;
      const row = el('div', 'ft-dice-row'); row.append(...dice); card.append(row);
      if (roll.mode && roll.mode !== 'normal') card.append(el('div', 'ft-dice-mode', { advantage: '优势：取较高的一颗', disadvantage: '劣势：取较低的一颗', middle: '掷三颗，取中间值' }[roll.mode]));
      const parts = [[kept, '骰值'], op(roll.modifier >= 0 ? '+' : '−'), [Math.abs(roll.modifier ?? 0), roll.modifierLabel ?? '加值'], op('='), [roll.total, '合计', 'total']];
      if (roll.target != null) parts.push(op('vs'), [roll.target, roll.targetLabel ?? '目标']);
      details.push(formula(parts));
    } else if (roll.kind === 'versus') {
      const box = el('div', 'ft-versus');
      for (const [i, sideRoll] of [roll.left, roll.right].entries()) {
        const sideBox = el('div', 'ft-versus-side');
        const d = die(sideRoll.dice?.[0]);
        dice.push(d);
        sideBox.append(el('span', '', sideRoll.name), d);
        const sum = el('div', 'ft-formula');
        sum.append(el('i', '', sideRoll.bonus ? `${signed(sideRoll.bonus)} =` : '='), el('b', 'total', sideRoll.total));
        details.push(sum); sideBox.append(sum);
        box.append(sideBox);
        if (!i) box.append(el('span', 'ft-versus-vs', 'VS'));
      }
      card.append(box);
      for (const d of details) d.style.visibility = 'hidden';
      details = details.map(d => ({ reveal: () => { d.style.visibility = ''; } }));
    } else if (roll.kind === 'chance') {
      const bar = el('div', 'ft-chance'), fill = el('i'), mark = el('b');
      bar.style.setProperty('--chance', roll.chance); bar.style.setProperty('--rolled', 0);
      bar.append(fill, mark); card.append(bar, el('div', 'ft-dice-note', `需要掷进 ${Math.round(roll.chance * 100)}% 以内`));
      details.push({ reveal: () => bar.style.setProperty('--rolled', roll.rolled) });
      mark.style.transition = 'left .4s ease-out';
    }
    for (const d of details) if (d instanceof win.HTMLElement) { d.style.visibility = 'hidden'; card.append(d); }
    card.append(verdict);
    if (roll.note) card.append(el('div', 'ft-dice-note', roll.note));
    stage.replaceChildren(card);
    await play(card, [{ opacity: 0, transform: 'translateY(-12px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    await tumble(dice);
    settle(dice, kept);
    await wait(220);
    for (const d of details) d instanceof win.HTMLElement ? (d.style.visibility = '') : d.reveal();
    await wait(260);
    verdict.style.visibility = '';
    await play(verdict, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2, 1.4, .4, 1)' });
    await wait(HOLD_MS);
    await play(card, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 180 });
    card.remove();
  }

  // ---------- 单条日志 ----------
  async function stage(log, state, ctx) {
    const entry = narrate(log, state);
    const d = log.detail ?? {};
    const unit = state.units?.[log.actor];
    switch (log.type) {
      case 'turn':
        if (unit) await banner(`${unit.name}`, `${unit.team === 'blue' ? '我方行动' : '敌方行动'} · 第 ${log.round} 回合`, unit.team, unit.team === 'blue' ? BANNER_MS * .8 : BANNER_MS);
        return;
      case 'action': ribbon(log.text, unit?.team); await wait(250); return;
      case 'move': case 'sprint': case 'disengage':
        caption(entry);
        await walk(state, log.actor, d.path ?? (d.to ? [d.to] : []));
        return;
      case 'knockback':
        caption(entry);
        if (d.to) { await shake(d.targetId, true); await walk(state, d.targetId, [d.to]); }
        return;
      case 'teleport':
        caption(entry);
        if (d.to) await blink(state, d.targetId ?? log.actor, d.to);
        return;
      case 'roll':
        ctx.crit = !!d.critical;
        await Promise.all([lunge(state, log.actor, d.targetId), diceCard(entry.roll)]);
        caption(entry);
        if (!d.hit) float(state, d.targetId, kept1(d) ? '大失手' : '未命中', 'miss');
        return;
      case 'damage':
        caption(entry);
        float(state, d.targetId, `−${entry.amount}`, ctx.crit ? 'crit' : '', [d.damageType ? elementLabel(d.damageType, state.customElements) : '', ctx.crit ? '暴击' : d.absorbed ? `护盾吸收 ${d.absorbed}` : ''].filter(Boolean).join(' · ') || undefined, d.damageType);
        await shake(d.targetId, ctx.crit);
        await wait(HIT_MS);
        return;
      case 'heal':
        caption(entry); float(state, d.targetId ?? log.actor, `+${entry.amount}`, 'heal', d.damageType ? elementLabel(d.damageType, state.customElements) : undefined, d.damageType); await wait(HIT_MS); return;
      case 'defeat':
        caption(entry); float(state, d.targetId, '倒下', 'miss'); await fall(d.targetId); return;
      case 'status':
        caption(entry); float(state, d.targetId, entry.statusName ?? entry.title, 'status'); await wait(320); return;
      case 'shield':
        caption(entry); float(state, d.targetId ?? log.actor, '护盾', 'heal'); await wait(300); return;
      case 'cover_damage': case 'cover_break':
        caption(entry); await shake(d.coverId ?? d.targetId, log.type === 'cover_break'); return;
      case 'opportunity':
        caption(entry); ribbon(entry.title, state.units?.[log.actor]?.team); await wait(500); return;
      default:
        if (entry.roll) { await diceCard(entry.roll); caption(entry); return; }
        if (!entry.quiet && entry.title) { caption(entry); await wait(280); }
    }
  }
  const kept1 = d => (d.selected ?? d.dice?.[0]) === 1;

  // ---------- 队列 ----------
  async function run() {
    if (running) return;
    running = true;
    const mine = generation;
    app.dataset.busy = 'true';
    const skipButton = $('skip-playback');
    if (skipButton) skipButton.hidden = false;
    while (queue.length && mine === generation) {
      const { before, after, logs } = queue.shift();
      current = after;
      positions.clear(); homes.clear();
      const visible = structuredClone(before);
      show(visible, { busy: true });
      const ctx = { crit: false };
      for (const log of logs) {
        if (mine !== generation) break;
        applyVisualLog(visible, log);
        show(visible, { busy: true });
        // 所有命名都用结算后状态，保证新召唤单位、尸体也能找到名字
        // 坐标取行动前，名字补上结算后才出现的单位（召唤物）
        await stage(log, { ...after, units: { ...after.units, ...before.units }, grid: before.grid, covers: before.covers, interactives: before.interactives }, ctx);
        if (log.type === 'turn') ctx.crit = false;
      }
      if (mine !== generation) break;
      positions.clear(); homes.clear();
      settleTokens();
      show(after, { busy: queue.length > 0 });
      if (queue.length) await wait(120);
    }
    if (mine === generation) finish();
  }
  function applyVisualLog(state, log) {
    const detail = log.detail ?? {};
    // Cover damage records its own HP and identifies the cover, not a unit.
    const target = detail.coverId != null || detail.targetKind === 'cover'
      ? null : state.units?.[detail.targetId ?? log.actor];
    if (target) {
      if (Number.isFinite(detail.hpAfter)) target.hp = detail.hpAfter;
      if (Number.isFinite(detail.mpAfter)) target.mp = detail.mpAfter;
      if (Number.isFinite(detail.spAfter)) target.sp = detail.spAfter;
      if (Number.isFinite(detail.remainingHP)) target.hp = detail.remainingHP;
      if (detail.fled === true) target.fled = true;
    }
    if (detail.resource && Number.isFinite(detail.after)) {
      const owner = state.units?.[detail.targetId ?? log.actor];
      if (owner && detail.resource in owner) owner[detail.resource] = detail.after;
    }
    if (log.type === 'defeat' && target) target.hp = 0;
  }

  function settleTokens() {
    for (const t of root.querySelectorAll('#board .axis-unit:not(.tactical-corpse)')) {
      t.classList.remove('is-moving');
      t.style.transform = t.style.opacity = t.style.filter = '';
    }
    for (const c of root.querySelectorAll('#board .tactical-cell')) c.style.zIndex = '';
  }
  function finish() {
    running = false;
    skipping = false;
    app.dataset.busy = 'false';
    const skipButton = $('skip-playback');
    if (skipButton) skipButton.hidden = true;
    onIdle?.();
  }

  return {
    /** 加入一次状态变化。返回 false 表示应直接显示（不演出）。 */
    enqueue(before, after) {
      if (!before || speed <= 0 || doc.hidden) return false;
      const logs = after.logs.slice(before.logs.length);
      if (!logs.length) return false;
      queue.push({ before, after, logs });
      run();
      return true;
    },
    /** 立即结束全部演出并显示最终画面（同步完成）。 */
    skip() {
      if (!running) return;
      const last = queue.at(-1)?.after ?? current;
      this.reset();
      if (last) show(last, { busy: false });
      onIdle?.();
    },
    /** 战局被替换（撤销、读档、重开）时丢弃演出。 */
    reset() {
      generation++;
      queue.length = 0;
      for (const done of [...waiters]) done();
      $('dice-stage')?.replaceChildren();
      $('board-fx')?.replaceChildren();
      $('caption')?.replaceChildren();
      settleTokens();
      for (const id of ['turn-banner', 'action-ribbon', 'skip-playback']) { const n = $(id); if (n) n.hidden = true; }
      running = false; skipping = false;
      app.dataset.busy = 'false';
    },
    setSpeed(value) { speed = Number.isFinite(value) && value >= 0 ? value : 1; },
    get busy() { return running; },
  };
}
