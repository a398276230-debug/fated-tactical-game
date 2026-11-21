// 静态呈现：棋盘、HUD、抽屉内容。动画演出在 animation.js，文字叙述在 narrate.js。
import { resourceLabel } from '../core/resource_names.js';
import { effectLabel, resourceDefinitions } from '../core/effects.js';
import { preview as rulesPreview, corpses } from '../core/combat.js';
import { elevation } from '../core/spatial.js';
import { bodySizeLabel } from '../core/combat_protocol.js';
import { narrateAll, STAT_NAMES, DAMAGE_TYPES } from './narrate.js';

const STATUS_ICON = { buff: '↑', debuff: '↓', control: '⊘', dot: '✹', hot: '✚', shield: '⬡' };
const STANCES = { light_blade: '轻剑', dual_wield: '双持', attunement: '同调', greatsword: '重剑', sword_shield: '剑盾' };
const SHAPES = { circle: '圆形范围', cone: '锥形范围', fan: '扇形范围', line: '直线范围' };
const ARROWS = { '-1,-1': '↙', '0,-1': '↓', '1,-1': '↘', '-1,0': '←', '1,0': '→', '-1,1': '↖', '0,1': '↑', '1,1': '↗' };
export const ACTION_LABELS = { use_item: '使用道具', move: '移动', sprint: '疾跑', disengage: '撤离', attack: '普攻', interact: '互动', brace: '架势防御',
  block: '格挡', shield_bash: '盾击', charge: '蓄力', lock_on: '锁定', scan: '探察', grapple: '擒抱', disarm: '缴械', trip: '绊摔', push: '推撞',
  flee: '逃跑', detour: '绕行', reload: '装填', end: '结束回合' };
export const ACTION_HINTS = { move: '走到这一格', sprint: '跑得更远，耗 2 AP', disengage: '离开时不被借机', attack: '用武器攻击', interact: '使用场景设施',
  brace: '本回合减伤', block: '举盾格挡', charge: '为下一击蓄力', scan: '侦察周围', lock_on: '下次攻击更准', grapple: '对抗检定，擒住对方',
  disarm: '对抗检定，打落武器', trip: '对抗检定，绊倒对方', push: '对抗检定，推开对方', flee: '尝试脱离战斗', use_item: '使用副手道具',
  reload: '补充弹药', end: '保留剩余 AP' };

const sign = n => (n > 0 ? `+${n}` : `${n}`);
const pct = n => `${Math.round(n * 100)}%`;
const interval = pair => (pair?.length === 2 ? (pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]}–${pair[1]}`) : null);
const side = team => (team === 'blue' ? '我方' : '敌方');
const ratio = (v, max) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0);
const has = (table, id) => table && id != null && Object.hasOwn(table, id);
const get = (table, id) => (has(table, id) ? table[id] : undefined);
const values = table => Object.values(table ?? {});
const key = (x, y) => `${x},${y}`;
const statusText = s => `${STATUS_ICON[s.category] ?? '◆'} ${s.name ?? s.id}${s.stacks > 1 ? ` ×${s.stacks}` : ''}`;
const duration = s => (Number.isInteger(s.remainingTurns) ? `剩 ${s.remainingTurns} 回合` : s.durationType === 'persistent' ? '常驻' : '');
const terrainLabel = t => (t.kind === 'wall' ? '墙体，挡住移动和视线' : t.kind === 'slope' ? '坡道' : t.z > 0 ? `高台（高 ${t.z}）` : t.z < 0 ? `低地（${t.z}）` : '平地');

export function createRenderer(root, portraitFor = () => []) {
  const doc = root.ownerDocument;
  const $ = id => root.querySelector(`[id="${id}"]`);
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const cells = new Map();
  let dims = '', last = null, baseline = { move: new Set(), attack: new Set(), interact: new Set() }, logCount = -1;

  function initBoard(state) {
    const h = state.grid.length, w = state.grid[0].length;
    if (dims === key(w, h)) return;
    dims = key(w, h);
    const board = $('board'), frame = $('board-frame');
    frame.style.setProperty('--cols', w); frame.style.setProperty('--rows', h);
    board.replaceChildren(); cells.clear();
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const cell = el('button', 'tactical-cell');
      cell.type = 'button';
      Object.assign(cell.dataset, { x, y });
      const coord = el('span', 'tactical-cell-coord', key(x, y)), z = el('span', 'tactical-cell-tz');
      const units = el('span', 'tactical-cell-units'), features = el('span', 'tactical-cell-features');
      cell.append(coord, z, units, features);
      cells.set(key(x, y), { cell, z, units, features });
      board.append(cell);
    }
  }

  function token(name, initial, z, cls, faction) {
    const node = el('span', `axis-unit ${cls ?? ''}`.trim());
    if (faction) node.dataset.faction = faction;
    const head = el('span', 'axis-token-head');
    const badge = el('span', 'axis-z-badge', sign(z));
    badge.dataset.zSign = z > 0 ? 'pos' : z < 0 ? 'neg' : 'zero';
    head.append(el('span', 'axis-unit-fallback-avatar', initial), badge);
    node.append(head, el('span', 'axis-unit-name', name));
    return { node, head };
  }

  function unitToken(state, unit, z, chosen, isActive) {
    const { node, head } = token(unit.name, Array.from(unit.name)[0] ?? '?', z, isActive ? 'is-active' : '', unit.team);
    node.dataset.unitId = unit.id;
    node.setAttribute('aria-pressed', String(chosen));
    const portraits = portraitFor(unit.id);
    if (portraits.length) {
      const image = el('img', 'axis-unit-portrait');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      let index = 0;
      image.onload = () => { image.hidden = false; };
      image.onerror = () => {
        image.hidden = true;
        if (++index < portraits.length) image.src = portraits[index];
        else image.remove();
      };
      image.hidden = true;
      image.src = portraits[0];
      head.prepend(image);
    }
    head.append(el('span', 'axis-facing-pip', ARROWS[unit.facing?.join(',')] ?? '·'));
    const bars = el('span', 'token-meters');
    for (const stat of ['hp', 'mp', 'sp']) {
      const meter = el('span', `token-meter ${stat}`), fill = el('i');
      fill.style.setProperty('--resource-ratio', ratio(unit[stat], unit[`max${stat[0].toUpperCase()}${stat[1]}`]));
      meter.append(fill); bars.append(meter);
    }
    node.append(bars);
    const marks = values(unit.statuses);
    if (marks.length) node.append(el('span', 'token-statuses', marks.length > 1 ? `◆${marks.length}` : STATUS_ICON[marks[0].category] ?? '◆'));
    return node;
  }

  function featureToken(f, z, isCover) {
    const initial = Array.from(isCover ? f.material || '掩' : f.kind === 'barrel' ? '桶' : '祭')[0];
    const { node } = token(f.name ?? f.id, initial, z, isCover ? `tactical-cover${f.hp ? '' : ' is-broken'}` : `tactical-interact${f.spent ? ' is-spent' : ''}`);
    if (isCover) {
      node.dataset.cover = f.id;
      const bar = el('span', 'tactical-cover-bar'), fill = el('i');
      fill.style.width = pct(ratio(f.hp, f.maxHp));
      bar.append(fill); node.append(bar);
    } else node.dataset.interact = f.id;
    return node;
  }

  const coverText = c => `${c.name}：${c.material}掩体，耐久 ${c.hp}/${c.maxHp}，躲在后面命中 −${c.cover}${c.hp ? '' : '（已坍塌）'}`;
  const interactiveText = i => `${i.name}：${i.kind === 'barrel' ? '武器射程内可引爆（攻击槽），波及周围' : '相邻激活（动作槽）'}${i.spent ? '（已用过）' : ''}`;

  function cliffs(state, x, y, tile) {
    if (tile.kind !== 'floor') return [];
    return [['top', x, y + 1], ['bottom', x, y - 1], ['left', x - 1, y], ['right', x + 1, y]]
      .filter(([, nx, ny]) => { const n = state.grid[ny]?.[nx]; return n?.kind === 'floor' && Math.abs(n.z - tile.z) >= 2; })
      .map(([d]) => d);
  }

  function group(list) {
    const map = new Map();
    for (const item of list) { const k = key(item.x, item.y); if (!map.has(k)) map.set(k, []); map.get(k).push(item); }
    return map;
  }

  function renderBoard(state, { selected, action, hover, preview, current }) {
    initBoard(state);
    const moving = ['move', 'sprint', 'disengage'].includes(action?.type);
    const unitsAt = group(values(state.units).filter(u => u.hp > 0));
    const bodiesAt = group(corpses(state)), coversAt = group(values(state.covers)), itemsAt = group(values(state.interactives));
    const affected = new Set((!moving && preview?.ok && preview.cells || []).map(p => key(p.x, p.y)));
    const path = new Set((moving && preview?.ok && preview.path || []).map(p => key(p.x, p.y)));
    const risks = new Set((moving && preview?.opportunities || []).map(o => key(o.from.x, o.from.y)));
    const hoverKey = hover ? key(hover.x, hover.y) : null;
    const origin = state.units[selected] ?? current;
    const originZ = origin ? elevation(state, origin) : 0;
    let inspection = '';
    for (const [xy, slot] of cells) {
      const { cell } = slot;
      const x = Number(cell.dataset.x), y = Number(cell.dataset.y), tile = state.grid[y][x];
      const unit = unitsAt.get(xy)?.[0], cover = coversAt.get(xy)?.[0], item = itemsAt.get(xy)?.[0];
      const chosen = !!unit && selected === unit.id, isHover = hoverKey === xy, edges = cliffs(state, x, y, tile);
      const reach = baseline.move.has(xy);
      cell.className = ['tactical-cell', tile.kind !== 'floor' ? `terrain-${tile.kind}` : tile.z ? 'terrain-plateau' : '', ...edges.map(c => `cliff-${c}`),
        chosen ? 'is-selected' : '', isHover ? 'is-hovered' : '', isHover && preview?.ok === false ? 'is-invalid' : '',
        reach ? 'is-reachable' : '', (action?.type === 'interact' ? baseline.interact : baseline.attack).has(xy) || (item && baseline.interact.has(xy)) ? 'is-in-range' : '',
        reach && (tile.kind === 'slope' || tile.z !== originZ) ? 'is-elevated-reach' : '',
        affected.has(xy) ? 'axis-covered' : '', path.has(xy) ? 'is-path' : '', risks.has(xy) ? 'is-opportunity' : ''].filter(Boolean).join(' ');
      cell.dataset.terrainType = tile.kind;
      cell.dataset.terrainZ = tile.z;
      cell.dataset.terrainElev = tile.z < 0 ? 'neg' : tile.z >= 2 ? 'pos2' : 'pos1';
      for (const [name, v] of [['unitId', unit?.id], ['coverId', cover?.id], ['interactiveId', item?.id]]) {
        if (v) cell.dataset[name] = v; else delete cell.dataset[name];
      }
      cell.setAttribute('aria-pressed', String(chosen));
      const label = [`(${xy}) ${terrainLabel(tile)}`, edges.length ? '陡崖边' : '',
        unit ? `${side(unit.team)}${unit.name}，生命 ${unit.hp}/${unit.maxHp}${values(unit.statuses).length ? `，${values(unit.statuses).map(s => s.name).join('、')}` : ''}` : '',
        cover ? coverText(cover) : '', item ? interactiveText(item) : '', reach ? '可以走到这里' : ''].filter(Boolean).join(' · ');
      cell.setAttribute('aria-label', label);
      if (isHover) inspection = label;
      const bodies = bodiesAt.get(xy) ?? [];
      const signature = JSON.stringify([tile, unit, cover, item, chosen, unit?.id === current?.id, bodies.map(b => b.id), unit && portraitFor(unit.id)]);
      if (slot.signature === signature) continue;
      slot.signature = signature;
      slot.z.textContent = tile.kind !== 'wall' && tile.z ? `z${sign(tile.z)}` : '';
      const dead = bodies.map(body => {
        const { node } = token(body.name, '†', tile.z, 'tactical-corpse', body.team);
        node.dataset.corpseId = body.id;
        Object.assign(node.style, { filter: 'grayscale(1)', opacity: '.55', pointerEvents: 'none' });
        node.setAttribute('aria-label', `${body.name}的尸体`);
        return node;
      });
      slot.units.replaceChildren(...dead, ...[unit && unitToken(state, unit, tile.z, chosen, unit.id === current?.id),
        cover && featureToken(cover, tile.z, true), item && featureToken(item, tile.z, false)].filter(Boolean));
      slot.features.replaceChildren(...(tile.kind !== 'floor' ? [el('span', 'tactical-cell-tag', tile.kind === 'wall' ? '#' : '坡')] : []));
    }
    $('terrain-inspector').textContent = inspection;
  }

  function bar(stat, cur, max) {
    const node = el('span', `ft-bar ${stat}`);
    node.style.setProperty('--ratio', ratio(cur, max));
    node.append(el('i'), el('span', '', `${stat.toUpperCase()} ${cur}/${max}`));
    return node;
  }

  function renderTurnOrder(state, current, selected) {
    const node = $('turn-order');
    const old = new Map([...node.children].map(b => [b.dataset.unitId, b]));
    const chips = state.order.map(id => {
      const u = get(state.units, id);
      if (!u) return null;
      const chip = old.get(id) ?? Object.assign(el('button'), { type: 'button' });
      chip.className = `turn-chip${u.hp <= 0 ? ' is-defeated' : ''}`;
      chip.dataset.unitId = id; chip.dataset.faction = u.team;
      chip.replaceChildren(el('span', 'chip-face', Array.from(u.name)[0]), el('span', '', u.name.split(' · ')[0]));
      chip.title = `${side(u.team)} ${u.name} · 生命 ${u.hp}/${u.maxHp}`;
      chip.setAttribute('aria-current', String(id === current?.id));
      chip.setAttribute('aria-pressed', String(id === selected));
      return chip;
    }).filter(Boolean);
    node.replaceChildren(...chips);
    node.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  function renderActor(state, u) {
    const node = $('actor-card');
    if (!u) { node.replaceChildren(el('span', 'muted', '等待行动')); delete node.dataset.faction; return; }
    node.dataset.faction = u.team;
    const name = el('div', 'ft-actor-name');
    name.append(el('span', '', u.name), el('small', '', `${side(u.team)} · 第 ${state.round} 回合`));
    const bars = el('div', 'ft-bars');
    bars.append(bar('hp', u.hp, u.maxHp), bar('mp', u.mp, u.maxMp), bar('sp', u.sp, u.maxSp));
    const meta = el('div', 'ft-actor-meta');
    const ap = state.outcome ? 0 : u.ap;
    const crystals = el('span', '', '');
    crystals.append(el('span', '', '行动力 '), ...[0, 1].map(i => el('span', `ap-crystal${i >= ap ? ' is-used' : ''}`, i < ap ? '◆' : '◇')));
    crystals.setAttribute('aria-label', `剩余 ${ap} / 2 AP`);
    meta.append(crystals);
    meta.append(el('span', 'ft-chip', `动作${u.used?.action ? '已用' : '可用'} · 攻击${u.used?.attack ? '已用' : '可用'}`));
    for (const s of values(u.statuses)) meta.append(el('span', 'ft-chip', statusText(s)));
    node.replaceChildren(el('span', 'ft-actor-face', Array.from(u.name)[0]), name, bars, meta);
  }

  function renderUnitCard(state, u, inspected) {
    const node = $('unit-card');
    if (inspected && !u) {
      node.replaceChildren(el('p', '', inspected.material ? coverText(inspected) : interactiveText(inspected)));
      return;
    }
    if (!u) { node.replaceChildren(el('p', 'muted', '点击棋盘上的单位或顶部的先攻头像查看情报。')); return; }
    const head = el('div', 'ft-card-head');
    const face = el('span', 'ft-actor-face', Array.from(u.name)[0]);
    head.dataset.faction = u.team;
    const title = el('div');
    const tile = state.grid[u.y][u.x];
    title.append(el('strong', '', u.name), el('div', 'muted', `${side(u.team)} · 位于 (${u.x}, ${u.y})${tile.z ? `，高度 ${tile.z}` : ''} · 朝向 ${ARROWS[u.facing?.join(',')] ?? '·'}${u.hp ? '' : ' · 已倒下'}`));
    head.append(face, title);
    const wrap = el('div', 'ft-actor'); wrap.dataset.faction = u.team; wrap.style.width = '100%';
    wrap.append(head);
    const bars = el('div', 'ft-bars');
    bars.append(bar('hp', u.hp, u.maxHp), bar('mp', u.mp, u.maxMp), bar('sp', u.sp, u.maxSp));
    const stats = el('div', 'ft-kv');
    for (const [id, label] of Object.entries(STAT_NAMES)) { const s = el('span', '', label); s.prepend(el('b', '', u.stats[id])); stats.append(s); }
    const template = get(state.equipment, get(state.items, u.weapon)?.templateId);
    const melee = (template?.range ?? 1.5) <= 2 && !resourceDefinitions(template).some(n => n.reloadable);
    const facts = el('p', 'muted', [`护甲 ${u.armor}`, `移动 ${u.move} 格`, `体型 ${bodySizeLabel(u)}`, `高度 z=${elevation(state, u)}${u.altitude ? `（离地 ${u.altitude}）` : ''}`, `持械：${STANCES[u.stance] ?? '轻剑'}`,
      `奖励骰 ${u.bonusDice ?? 0}/2`, u.hp && melee ? (u.reactionAvailable === false ? '本轮借机攻击已用' : '可以借机攻击') : ''].filter(Boolean).join(' · '));
    const statusList = el('ul', 'ft-list');
    for (const s of values(u.statuses)) {
      const li = el('li'); li.append(el('b', '', statusText(s)), document_text(` ${duration(s)}`));
      if (s.description) li.append(el('p', '', s.description));
      if (s.amount != null) li.append(el('p', '', `剩余 ${s.amount} 点`));
      statusList.append(li);
    }
    if (!statusList.children.length) statusList.append(el('li', 'muted', '没有状态'));
    const gear = el('ul', 'ft-list');
    for (const id of [...new Set([u.mainHand, u.offHand, u.shield, u.weapon, ...(u.gear ?? [])])].filter(Boolean)) {
      const inst = get(state.items, id), tpl = get(state.equipment, inst?.templateId);
      const li = el('li'); li.dataset.instanceId = id;
      li.append(el('b', '', tpl?.name ?? id));
      const counters = Object.entries(inst?.counters ?? {}).map(([k, n]) => `${resourceLabel(k)} ${n}`);
      if (counters.length) li.append(document_text(` · ${counters.join(' · ')}`));
      const text = [tpl?.description, ...(tpl?.effects ?? []).map(effectLabel)].filter(Boolean).join('；');
      if (text) li.append(el('p', '', text));
      gear.append(li);
    }
    if (!gear.children.length) gear.append(el('li', 'muted', '徒手'));
    const zones = values(state.zones).filter(z => Math.max(Math.abs(z.x - u.x), Math.abs(z.y - u.y)) <= z.radius);
    const parts = [wrap, bars, stats, facts, el('h3', 'ft-section', '状态'), statusList, el('h3', 'ft-section', '装备'), gear];
    if (zones.length) parts.push(el('h3', 'ft-section', '所处区域'), el('p', '', zones.map(z => `${z.name}：每回合 ${z.damage} 点${DAMAGE_TYPES[z.damageType] ?? ''}伤害`).join('；')));
    node.replaceChildren(...parts);
  }
  const document_text = t => doc.createTextNode(t);

  function renderFeatures(state) {
    const list = [...values(state.covers).map(c => [`🧱 ${coverText(c)}`, c]), ...values(state.interactives).map(i => [`✴️ ${interactiveText(i)}`, i])];
    const ul = el('ul', 'ft-list');
    for (const [text, f] of list) ul.append(el('li', '', `${text} · 位于 (${f.x}, ${f.y})`));
    $('feature-cards').replaceChildren(ul);
  }

  function renderLog(state) {
    if (state.logs.length === logCount && last?.state?.scenarioId === state.scenarioId) return false;
    const node = $('combat-log');
    const stick = node.parentElement ? node.parentElement.scrollHeight - node.parentElement.scrollTop - node.parentElement.clientHeight < 40 : true;
    const entries = narrateAll(state.logs.slice(-160), state);
    const out = [];
    let round = null;
    for (const e of entries) {
      if (e.round !== round) { round = e.round; out.push(el('div', 'ft-log-round', `第 ${round} 回合`)); }
      if (e.quiet || !e.lines.length) {
        const row = el('div', `ft-log-entry${e.quiet ? ' is-quiet' : ''}`); row.dataset.tone = e.tone;
        const t = el('div', 'ft-log-title'); t.append(el('span', 'ft-log-icon', e.icon), el('span', '', e.title)); row.append(t);
        out.push(row);
        continue;
      }
      const row = el('details', 'ft-log-entry'); row.dataset.tone = e.tone;
      const summary = el('summary'); summary.append(el('span', 'ft-log-icon', e.icon), el('span', '', e.title));
      const ul = el('ul'); for (const line of e.lines) ul.append(el('li', '', line));
      row.append(summary, ul);
      out.push(row);
    }
    node.replaceChildren(...(out.length ? out : [el('p', 'muted', '战斗还没开始。')]));
    if (stick && node.parentElement) node.parentElement.scrollTop = node.parentElement.scrollHeight;
    const grew = logCount >= 0 && state.logs.length > logCount;
    logCount = state.logs.length;
    return grew;
  }

  /** 目标浮卡里的战术预览：全部写成句子。 */
  function renderPreview(state, action, hover, range, p, actor) {
    const node = $('tactical-preview');
    const lines = [];
    const line = (text, cls) => { const d = el('div', `preview-line${cls ? ` ${cls}` : ''}`); if (typeof text === 'string') d.textContent = text; else d.append(...text); lines.push(d); return d; };
    if (!actor || !action) { node.replaceChildren(); return; }
    const label = p?.name ?? range?.name ?? ACTION_LABELS[action.type] ?? '动作';
    const cost = [range?.ap ? `${range.ap} AP` : '', range?.mp ? `${range.mp} MP` : '', range?.sp ? `${range.sp} SP` : ''].filter(Boolean).join(' + ');
    const head = [el('b', '', label)];
    if (cost) head.push(document_text(`，消耗 ${cost}`));
    if (range?.shape && range.shape !== 'single') head.push(document_text(`，${SHAPES[range.shape] ?? range.shape}`));
    line(head);
    if (p?.kind === 'barrel') line(`爆炸波及 ${p.cells.length} 格，可能伤及友方。`);
    if (range?.effects?.length) line(`效果：${range.effects.map(effectLabel).join('；')}`);
    if (action.type === 'brace' && range?.ok) line(`${range.coverId ? `借助${get(state.covers, range.coverId)?.name ?? '掩体'}` : '原地'}防御：受到伤害减少 ${pct(range.reduction)}，持续 ${range.turns} 回合`);
    if (range?.ammo != null) line(`弹药 ${range.ammo}${range.capacity ? ` / ${range.capacity}` : ''}`);
    if (p?.ok === false) line(`✖ ${p.error}`, 'is-warning');
    else if (range?.ok === false) line(`✖ ${range.error}`, 'is-warning');
    if (hover && p) {
      const geo = [];
      if (p.steps) geo.push(`走 ${p.steps} 格`);
      if (Number.isFinite(p.distance)) geo.push(`距离 ${p.distance.toFixed(1)} 格${p.range != null ? `（射程 ${p.range}）` : ''}`);
      if (p.dz) geo.push(p.dz > 0 ? `目标高出 ${p.dz}` : `目标低 ${-p.dz}`);
      if (p.teleport) geo.push(`瞬移到 (${p.teleport.x}, ${p.teleport.y})`);
      if (geo.length) line(geo.join('，'));
      if (p.opportunities?.length) line(`⚠ 借机风险：${p.opportunities.map(o => `${o.name}（你离开 ${o.from.x},${o.from.y} 时出手）`).join('、')}。改用「撤离」可以避免。`, 'is-warning');
      if (p.ok && action.type === 'disengage') line('撤离：这次移动不会引发借机攻击。');
      for (const t of p.targets ?? []) {
        const row = line([el('b', '', t.name)]);
        const bits = [];
        let chance = null;
        if (t.saveStat) {
          chance = 1 - t.saveChance;
          bits.push(`对方需要${STAT_NAMES[t.saveStat] ?? t.saveStat}豁免（d20 ${sign(t.saveBonus)}，至少 ${t.saveDC}），生效率 ${pct(chance)}`);
        } else if (t.automatic) bits.push('必定命中');
        else if (Number.isFinite(t.hitChance)) {
          chance = t.hitChance;
          const dice = t.advantage > 0 ? '优势（掷两颗取高）' : t.advantage < 0 ? '劣势（掷两颗取低）' : 'd20';
          bits.push(`命中率 ${pct(t.hitChance)}：${dice} + 命中 ${t.accuracy}，对抗防御 ${t.defense}`);
          if (t.accuracySources) bits.push(`命中中的体型修正 ${sign(t.accuracySources.size)}`);
        }
        const mods = [t.coverId ? `被${get(state.covers, t.coverId)?.name ?? '掩体'}遮挡 −${t.cover}` : '', t.highGround ? (t.highGround > 0 ? `居高临下 ${sign(t.highGround)}` : `仰攻 ${t.highGround}`) : '',
          t.flanked ? '夹击' : '', t.backstab ? '背刺' : '', t.recipientId && t.recipientId !== t.id ? `${get(state.units, t.recipientId)?.name ?? t.recipientId}会替它挡下` : '',
          t.shield ? `对方有 ${t.shield} 点护盾` : ''].filter(Boolean);
        if (mods.length) bits.push(mods.join('，'));
        if (t.heal) bits.push(`治疗 ${interval(t.heal)}`);
        else if (t.damage) bits.push(`命中后伤害约 ${interval(t.damage)}${t.savedDamage ? `（豁免成功则 ${interval(t.savedDamage)}）` : ''}`);
        row.append(el('div', '', bits.join('。')));
        if (chance != null) {
          const odds = el('div', 'ft-odds'), track = el('span', 'ft-odds-bar'), fill = el('i');
          fill.style.setProperty('--p', chance); track.append(fill); odds.append(track, el('span', '', pct(chance)));
          row.append(odds);
        }
      }
    }
    node.replaceChildren(...lines);
  }

  function render(state, ui = {}) {
    const current = get(state.units, state.order[state.turn]);
    const selected = ui.selectedId ?? current?.id;
    const action = ui.action ?? null, hover = ui.hover ?? null;
    const canAct = !ui.busy && current?.team === 'blue' && !state.outcome;
    const run = cmd => (canAct ? rulesPreview(state, cmd) : null);
    const fresh = last?.state !== state;
    if (fresh || last?.sprint !== ui.sprint || last?.canAct !== canAct) {
      const cells = p => new Set((p?.ok ? p.cells : []).map(c => key(c.x, c.y)));
      baseline = { move: cells(run({ type: ui.sprint ? 'sprint' : 'move' })), attack: cells(run({ type: 'attack' })), interact: cells(run({ type: 'interact' })) };
    }
    const range = action ? run({ type: action.type, ...(action.skillId ? { skillId: action.skillId } : {}) }) : null;
    const aimed = ['move', 'sprint', 'disengage', 'attack', 'skill', 'interact', 'lock_on', 'grapple', 'disarm', 'trip', 'push', 'shield_bash'].includes(action?.type);
    const result = aimed && hover ? run({ ...action, x: hover.x, y: hover.y }) : null;
    if (fresh) {
      $('battle-title').textContent = state.title;
      $('round-badge').textContent = `第 ${state.round} 回合`;
      renderFeatures(state);
    }
    if (fresh || last?.selected !== selected) renderTurnOrder(state, current, selected);
    if (fresh) renderActor(state, current);
    $('sprint-indicator').textContent = ui.sprint ? '疾跑范围已显示 · 走更远需要 2 AP' : '';
    renderBoard(state, { selected, action, hover, preview: result, current });
    if (ui.target) renderPreview(state, action, hover, range, result, current);
    if (fresh || last?.selected !== selected || last?.inspectedId !== ui.inspectedId) {
      const feature = get(state.covers, ui.inspectedId) ?? get(state.interactives, ui.inspectedId);
      renderUnitCard(state, feature ? null : get(state.units, selected), feature);
    }
    $('battle-status').textContent = state.outcome
      ? (state.outcome === 'draw' ? '战斗结束：平局' : `战斗结束：${state.outcome === 'blue' ? '我方胜利' : '敌方胜利'}`)
      : canAct ? '点击格子选择目标，再选要做的事' : current ? `${current.name} 正在行动……` : '';
    last = { state, canAct, selected, inspectedId: ui.inspectedId, sprint: ui.sprint };
  }

  /** 按钮可用性不等动画，总是立刻跟随真实战局。 */
  function renderControls(state) {
    const current = get(state.units, state.order[state.turn]);
    $('end-turn').disabled = !(current?.team === 'blue' && !state.outcome);
    $('ai-step').disabled = !!state.outcome || current?.team !== 'red';
  }

  return { render, renderControls, renderLog };
}
