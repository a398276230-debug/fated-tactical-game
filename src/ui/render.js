import { preview as rulesPreview, STATUSES } from '../core/combat.js';
import { SCENARIOS } from '../presets/scenarios.js';

const byId = id => document.getElementById(id);
const el = (tag, classes, text) => {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};
const key = (x, y) => `${x},${y}`;
const value = (table, id) => table && Object.hasOwn(table, id) ? table[id] : undefined;
const values = table => Object.values(table ?? {});
const sign = n => n > 0 ? `+${n}` : String(n);
const percent = n => `${Math.round(n * 100)}%`;
const interval = pair => pair?.length === 2 ? pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]}–${pair[1]}` : null;
const side = team => team === 'blue' ? '蓝方' : '红方';
const arrow = facing => ({ '-1,-1': '↙', '0,-1': '↓', '1,-1': '↘', '-1,0': '←', '1,0': '→', '-1,1': '↖', '0,1': '↑', '1,1': '↗' })[facing?.join(',')] ?? '·';
const terrainLabel = tile => tile.kind === 'wall' ? '# 墙体（阻断移动及视线）' : tile.kind === 'slope' ? '坡道' : tile.z ? '高低台' : '平地';
const actions = { move: ['移动', 1], sprint: ['疾跑', 2], attack: ['普通攻击', 1], reload: ['装填', 1], brace: ['架势防御', 1], disengage: ['撤离', 1], interact: ['互动', 1] };
const effectNames = { ammo: '消耗弹药', kill_charge_weapon: '直杀收魂', backstab: '背击优势／流血', teleport_backstab: '瞬移背刺', knockback: '击退', status: '施加状态', apply_status: '施加状态', cleanse: '净化', healing_shield: '治疗强化／护盾', thorns: '荆棘反伤', frost_thorns: '霜纹荆棘反伤', opportunity_root: '借机命中时定身' };
const statusIcon = { buff: '↑', debuff: '↓', control: '⊘', dot: '✹', hot: '✚', shield: '⬡' };
const statuses = u => values(u.statuses);
const statusText = s => `${statusIcon[s.category] ?? '◆'} ${s.name ?? s.id}${s.stacks > 1 ? ` ×${s.stacks}` : ''}${Number.isInteger(s.remainingTurns) ? ` · ${s.remainingTurns}回合` : s.durationType === 'persistent' ? ' · 常驻' : ''}`;
const ratio = (v, max) => max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
const activeFeedback = new Map();
const boardCells = new Map();
let dimensions = '', renderedScenario = null, logKeys = [], lastRender = null, baselineRanges;

function createButton(classes, text) {
  const button = el('button', classes, text);
  button.type = 'button';
  return button;
}

function initializeBoard(state) {
  const width = state.grid[0].length, height = state.grid.length;
  const size = key(width, height);
  if (dimensions === size) return;
  dimensions = size;
  const board = byId('board'), xRail = byId('board-x'), yRail = byId('board-y');
  board.closest('.battle-axis').style.setProperty('--rows', height);
  board.closest('.battle-axis').style.setProperty('--cols', width);
  board.replaceChildren(); xRail.replaceChildren(); yRail.replaceChildren(); boardCells.clear();
  for (let x = 0; x < width; x++) xRail.append(el('span', '', x));
  for (let y = height - 1; y >= 0; y--) {
    yRail.append(el('span', '', y));
    for (let x = 0; x < width; x++) {
      const cell = createButton('tactical-cell');
      Object.assign(cell.dataset, { x, y, gx: x, gy: y });
      const coord = el('span', 'tactical-cell-coord', key(x, y));
      const z = el('span', 'tactical-cell-tz');
      const units = el('span', 'tactical-cell-units');
      const features = el('span', 'tactical-cell-features');
      const cost = el('span', 'cell-cost');
      cell.append(coord, z, units, features, cost);
      boardCells.set(key(x, y), { cell, z, units, features, cost });
      board.append(cell);
    }
  }
}

function token(name, initial, z, cls = '', faction) {
  const node = el('span', `axis-unit ${cls}`);
  if (faction) node.dataset.faction = faction;
  const head = el('span', 'axis-token-head');
  const height = el('span', 'axis-z-badge', sign(z));
  height.dataset.zSign = z > 0 ? 'pos' : z < 0 ? 'neg' : 'zero';
  head.append(el('span', 'axis-unit-fallback-avatar', initial), height);
  node.append(head, el('span', 'axis-unit-name', name));
  return { node, head };
}

function resource(node, item, stat, full) {
  const cap = item[`max${stat[0].toUpperCase()}${stat[1]}`];
  if (full) {
    node = el('span', `tag tag-resource resource-meter tag-${stat}${cap && item[stat] / cap <= .25 ? '-low' : ''}`, `${stat.toUpperCase()} ${item[stat]}/${cap}`);
  } else {
    const meter = el('span', `token-meter ${stat}`);
    meter.append(node = el('i'));
  }
  node.style.setProperty('--resource-ratio', ratio(item[stat], cap));
  return full ? node : node.parentNode;
}

function unitToken(unit, z, isSelected) {
  const { node, head } = token(unit.name, Array.from(unit.name)[0] ?? '?', z, '', unit.team);
  node.dataset.unit = unit.id;
  node.dataset.unitId = unit.id;
  node.setAttribute('aria-pressed', String(isSelected));
  head.append(el('span', 'axis-facing-pip', arrow(unit.facing)));
  const bars = el('span', 'token-meters');
  for (const stat of ['hp', 'mp', 'sp']) bars.append(resource(null, unit, stat, false));
  node.append(bars);
  const marks = statuses(unit);
  if (marks.length) node.append(el('span', 'token-statuses', marks.length > 1 ? `◆${marks.length}` : statusIcon[marks[0].category] ?? '◆'));
  return node;
}

const coverText = c => `${c.id} ${c.name} · 材质 ${c.material} · HP ${c.hp}/${c.maxHp} · 遮蔽 ${c.cover}${c.hp ? '' : ' · 已坍塌'}`;
const interactiveText = i => `${i.id} ${i.name} · ${i.kind === 'barrel' ? '引爆' : '祭坛增益'} · ${i.spent ? '已消耗' : '可用'}`;

function featureToken(f, z, isCover) {
  const { node } = token(f.id, Array.from(isCover ? f.material || '掩' : f.kind === 'barrel' ? '桶' : '祭')[0], z,
    isCover ? `tactical-cover${f.hp ? '' : ' is-broken'}` : `tactical-interact${f.spent ? ' is-spent' : ''}`);
  if (isCover) {
    node.dataset.cover = f.id;
    const bar = el('span', 'tactical-cover-bar');
    const fill = el('i');
    fill.style.width = percent(ratio(f.hp, f.maxHp));
    bar.append(fill); node.append(bar);
  } else node.dataset.interact = f.id;
  return node;
}

function cliffs(state, x, y, tile) {
  if (tile.kind !== 'floor') return [];
  return [['top', x, y + 1], ['bottom', x, y - 1], ['left', x - 1, y], ['right', x + 1, y]].filter(([, nx, ny]) => {
    const next = state.grid[ny]?.[nx];
    return next?.kind === 'floor' && Math.abs(next.z - tile.z) >= 2;
  }).map(([direction]) => direction);
}

function atMap(list) {
  const map = new Map();
  for (const item of list) {
    const xy = key(item.x, item.y);
    if (!map.has(xy)) map.set(xy, []);
    map.get(xy).push(item);
  }
  return map;
}

function renderBoard(state, selected, action, hover, range, preview, baseline) {
  initializeBoard(state);
  const move = ['move', 'sprint', 'disengage'].includes(action?.type);
  const unitLocations = atMap(values(state.units).filter(u => u.hp > 0));
  const coverLocations = atMap(values(state.covers));
  const interactions = atMap(values(state.interactives));
  const available = baseline.move;
  const shots = baseline.attack;
  const reach = new Set((!move && range?.ok && range.cells || []).map(p => key(p.x, p.y)));
  const affected = new Set((!move && preview?.ok && preview.cells || []).map(p => key(p.x, p.y)));
  const path = new Set((move && preview?.ok && preview.path || []).map(p => key(p.x, p.y)));
  const risks = new Set((move && preview?.opportunities || []).map(o => key(o.from.x, o.from.y)));
  const hoverKey = hover ? key(hover.x, hover.y) : null;
  let inspection = '悬停或聚焦任意格子，查看地形、单位或场景设施。';
  for (const [xy, slot] of boardCells) {
    const { cell, z, units, features, cost } = slot;
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y), tile = state.grid[y][x];
    const unit = unitLocations.get(xy)?.[0], cover = coverLocations.get(xy)?.[0], interactive = interactions.get(xy)?.[0];
    const chosen = !!unit && selected === unit.id, isHover = hoverKey === xy;
    const shelf = tile.kind === 'floor' && tile.z !== 0;
    const cliff = cliffs(state, x, y, tile);
    cell.className = ['tactical-cell', tile.kind !== 'floor' ? `terrain-${tile.kind}` : shelf ? 'terrain-plateau' : '',
      ...cliff.map(c => `cliff-${c}`), chosen ? 'is-selected' : '', isHover ? 'is-hovered' : '',
      isHover && preview?.ok === false ? 'is-invalid' : '', available.has(xy) ? 'is-reachable reachable' : '', shots.has(xy) || reach.has(xy) ? 'is-in-range in-range' : '',
      available.has(xy) && (tile.kind === 'slope' || tile.z !== state.grid[state.units[selected]?.y]?.[state.units[selected]?.x]?.z) ? 'is-elevated-reach' : '',
      affected.has(xy) ? 'axis-covered' : '', path.has(xy) ? 'is-path' : '', risks.has(xy) ? 'is-opportunity' : ''].filter(Boolean).join(' ');
    cell.dataset.terrainType = tile.kind;
    cell.dataset.terrainZ = tile.z;
    cell.dataset.terrainElev = tile.z < 0 ? 'neg' : tile.z >= 2 ? 'pos2' : 'pos1';
    if (unit) cell.dataset.unitId = unit.id;
    else delete cell.dataset.unitId;
    if (cover) cell.dataset.coverId = cover.id;
    else delete cell.dataset.coverId;
    if (interactive) cell.dataset.interactiveId = interactive.id;
    else delete cell.dataset.interactiveId;
    cell.setAttribute('aria-pressed', String(chosen));
    const description = [`(${xy}, Z${sign(tile.z)})`, terrainLabel(tile), cliff.length ? '陡崖边：跨高差至少 2' : '',
      unit ? `${side(unit.team)} ${unit.name}，朝向 ${arrow(unit.facing)} · HP ${unit.hp}/${unit.maxHp}${statuses(unit).length ? ` · ${statuses(unit).map(statusText).join('、')}` : ''}` : '',
      cover ? coverText(cover) : '', interactive ? interactiveText(interactive) : '',
      available.has(xy) ? `可达，${baseline.ap} AP` : ''].filter(Boolean).join(' · ');
    cell.setAttribute('aria-label', description);
    if (isHover) inspection = description;
    const signature = JSON.stringify([tile, unit, cover, interactive, chosen]);
    if (slot.signature !== signature) {
      slot.signature = signature;
      z.textContent = tile.kind !== 'wall' && tile.z !== 0 ? `z${sign(tile.z)}` : '';
      units.replaceChildren(...[unit ? unitToken(unit, tile.z, chosen) : null, cover ? featureToken(cover, tile.z, true) : null,
        interactive ? featureToken(interactive, tile.z, false) : null].filter(Boolean));
      features.replaceChildren(...(tile.kind !== 'floor' ? [el('span', 'tactical-cell-tag', tile.kind === 'wall' ? '#' : '坡')] : []));
    }
    cost.textContent = '';
  }
  byId('terrain-inspector').textContent = inspection;
}

function renderPreview(state, action, hover, range, p, current, selectedUnit) {
  const node = byId('tactical-preview');
  const lines = [];
  if (!current) lines.push('等待先攻单位。');
  else {
    const label = range?.name ?? actions[action?.type]?.[0] ?? '战术预览';
    const summary = [label, range?.ap !== undefined ? `${range.ap} AP` : '', range?.mp ? `${range.mp} MP` : '', range?.sp ? `${range.sp} SP` : ''];
    if (action?.type === 'brace' && range?.ok) summary.push(`${range.coverId ? `借 ${range.coverId}` : '空地'}：减伤 ${percent(range.reduction)}／${range.turns} 回合`);
    if (range?.shape && range.shape !== 'single') summary.push(`范围：${({ circle: '圆形', cone: '锥形', fan: '扇形', line: '直线' })[range.shape] ?? range.shape}`);
    if ((range?.effects ?? []).some(e => e.kind === 'kill_charge_weapon')) summary.push(`魂 ${range.souls} / ×${range.multiplier} · 直杀 +1 魂`);
    if (range?.ammo != null) summary.push(`弹药 ${range.ammo}${range.capacity ? `/${range.capacity}` : '（命令结算消耗）'}`);
    if (range?.effects?.length) summary.push(`特效：${range.effects.map(e => e.statusId && ['status', 'apply_status'].includes(e.kind) ? `施加${value(state.statusTemplates ?? {}, e.statusId)?.name ?? value(STATUSES, e.statusId)?.name ?? e.statusId}` : effectNames[e.kind] ?? e.kind).join('、')}`);
    lines.push(summary.filter(Boolean).join(' · '));
    if (hover) {
      const source = selectedUnit ?? current;
      const targetTile = state.grid[hover.y]?.[hover.x];
      const dz = p?.dz ?? (targetTile ? targetTile.z - state.grid[source.y][source.x].z : null);
      const distance = p?.distance ?? (targetTile ? Math.hypot(hover.x - source.x, hover.y - source.y, dz) : null);
      const geometry = [Number.isFinite(distance) ? `dXYZ ${distance.toFixed(2)}${p?.range == null ? '' : ` / 射程 ${p.range}`}` : '', Number.isFinite(dz) ? `高差 ΔZ ${sign(dz)}` : ''];
      if (p?.ok === false) geometry.push(p.error);
      if (p?.steps) geometry.push(`${p.steps} 步`);
      if (p?.targets) geometry.push(`覆盖 ${p.cells.length} 格／${p.targets.length} 目标`);
      if (p?.teleport) geometry.push(`瞬移落点 (${p.teleport.x},${p.teleport.y})`);
      const heading = geometry.filter(Boolean).join(' · ');
      if (heading) lines.push(heading);
      if (p?.opportunities?.length) lines.push(`⚠ 借机风险：${p.opportunities.map(o => `${o.name}（离开 ${o.from.x},${o.from.y} 时）`).join('、')}。可改用撤离。`);
      if (p?.ok && action?.type === 'disengage') lines.push('撤离路线：本次移动不触发借机攻击。');
      for (const t of p?.targets ?? []) {
        const check = t.saveStat ? `豁免 ${t.saveStat.toUpperCase()} · d20${sign(t.saveBonus)} ≥ ${t.saveDC}` : t.automatic ? '自动命中' : Number.isFinite(t.defense) ? `${t.advantage > 0 ? '2d20取高' : t.advantage < 0 ? '2d20取低' : 'd20'}${sign(t.accuracy)} ≥ ${t.defense}` : '';
        lines.push([t.name, check, t.saveStat ? `豁免通过 ${percent(t.saveChance)}` : Number.isFinite(t.hitChance) ? `命中 ${percent(t.hitChance)}` : '', Number.isFinite(t.expectedD20) ? `预计骰值 ${t.expectedD20.toFixed(1)}` : '',
          t.coverId ? `遮蔽 ${t.coverId} −${t.cover}` : Number.isFinite(t.cover) ? '无遮挡' : '',
          Number.isFinite(t.highGround) ? `高程修正 ${sign(t.highGround)}` : '', t.flanked ? '夹击' : '', t.backstab ? '背击' : '',
          t.recipientId && t.recipientId !== t.id ? `援护：${t.recipientId}` : '', t.shield ? `护盾 ${t.shield}` : '',
          t.damage && !t.heal ? `伤害 ${interval(t.damage)}` : '', t.savedDamage ? `豁免后 ${interval(t.savedDamage)}` : '', t.criticalDamage && !t.heal ? `暴击 ${interval(t.criticalDamage)}` : '',
          Number.isFinite(t.expectedDamage) && !t.heal ? `期望 ${t.expectedDamage.toFixed(1)}` : '', t.heal ? `治疗 ${interval(t.heal)}` : '',
          t.healingShield?.[1] ? `附盾 ${interval(t.healingShield)}` : ''].filter(Boolean).join(' · '));
      }
    } else if (range?.ok === false) lines.push(range.error);
    else lines.push('悬停或聚焦棋格查看距离、行动代价与预测结算。');
  }
  const signature = lines.join('\n');
  if (node.dataset.signature !== signature) {
    node.dataset.signature = signature;
    node.replaceChildren(...lines.map(line => el('div', 'preview-line', line)));
    node.scrollTop = 0;
  }
}

function renderTurn(state, current, selected) {
  const node = byId('turn-order'), existing = new Map([...node.children].map(btn => [btn.dataset.unitId, btn]));
  const buttons = state.order.map((id, idx) => {
    const u = value(state.units, id);
    if (!u) return null;
    const btn = existing.get(id) ?? createButton();
    btn.className = `game-button turn-chip${u.hp <= 0 ? ' is-defeated' : ''}`;
    btn.dataset.unitId = id;
    btn.dataset.faction = u.team;
    btn.textContent = `${idx + 1} · ${u.name}`;
    btn.setAttribute('aria-current', String(id === current?.id));
    btn.setAttribute('aria-pressed', String(id === selected));
    return btn;
  }).filter(Boolean);
  syncChildren(node, buttons);
  byId('round-badge').textContent = `回合 ${state.round}`;
  byId('battle-status').textContent = state.outcome ? state.outcome === 'draw' ? '战斗结束 · 平局' : `战斗结束 · ${side(state.outcome)}获胜` :
    current ? `${side(current.team)}行动 · ${current.name}${state.mode === 'split' ? ` · 动作 ${current.used.action ? '已用' : '可用'}／攻击 ${current.used.attack ? '已用' : '可用'}` : ''}` : '等待行动';
  const ap = byId('ap-display');
  ap.replaceChildren(...[0, 1].map(i => el('span', `ap-crystal${i >= (current?.ap ?? 0) || state.outcome ? ' is-used' : ''}`, i < (current?.ap ?? 0) && !state.outcome ? '◆' : '◇')));
  ap.setAttribute('aria-label', `剩余 ${state.outcome ? 0 : current?.ap ?? 0} / 2 AP`);
}

function syncChildren(parent, list) {
  for (let i = 0; i < list.length; i++) if (parent.children[i] !== list[i]) parent.insertBefore(list[i], parent.children[i] ?? null);
  while (parent.children.length > list.length) parent.lastElementChild.remove();
}

function row(title, ...content) {
  const line = el('div', 'data-row');
  if (title) line.append(el('b', 'card-subtitle', title));
  line.append(...content);
  return line;
}

function renderCard(state, u, inspected) {
  const node = byId('unit-card');
  if (inspected && !u) {
    node.replaceChildren(row('场景情报', inspected.material ? coverText(inspected) : interactiveText(inspected)));
    return;
  }
  if (!u) {
    node.replaceChildren(el('p', 'muted', '点选战棋或先攻序列，查看单位情报。'));
    return;
  }
  const head = row(null);
  head.classList.add('unit-resource-row'); head.dataset.faction = u.team;
  const name = el('strong', 'resource-unit-name', u.name);
  name.dataset.faction = u.team; name.prepend(el('span', 'resource-faction-label', side(u.team)));
  head.append(name, el('span', 'tag tone-gold', `(${u.x},${u.y}, Z${sign(state.grid[u.y][u.x].z)}) · 朝向 ${arrow(u.facing)}`));
  if (!u.hp) head.append(el('span', 'tag tone-red', '已倒下'));
  else {
    const template = value(state.equipment, value(state.items, u.weapon)?.templateId);
    const melee = (template?.range ?? 1.5) <= 2 && !template?.effects?.some(e => e.kind === 'ammo');
    if (melee) head.append(el('span', 'tag', u.reactionAvailable === false ? '借机已用' : '借机就绪'));
  }
  const bars = row(null, ...['hp', 'mp', 'sp'].map(stat => resource(null, u, stat, true)), el('span', 'tag tone-gold', `${u.ap} AP`));
  const cardStats = row(null, ...Object.entries({ str: '力量', agi: '敏捷', con: '体质', int: '智力', spi: '精神' }).map(([id, label]) =>
    el('span', `stat stat-${id}`, `${label} ${u.stats[id]}`)), el('span', 'tag', `护甲 ${u.armor} · 移动 ${u.move} · 体型 ${u.size}`));
  const marks = row('状态', ...(statuses(u).length ? statuses(u).map(s => {
    const badge = el('span', 'status-effect', statusText(s));
    badge.title = [s.name, s.category, s.tickTiming, s.description, s.amount !== undefined ? `当前池 ${s.amount}` : '',
      s.modifiers ? JSON.stringify(s.modifiers) : ''].filter(Boolean).join(' · ');
    return badge;
  }) : [el('span', 'muted', '无')]));
  const equipment = [...new Set([u.weapon, ...u.gear])].filter(Boolean).map(id => {
    const instance = value(state.items, id), template = value(state.equipment, instance?.templateId);
    if (!instance || !template) return el('span', 'tag', id);
    const counters = Object.entries(instance.counters ?? {}).map(([k, n]) => `${({ souls: '魂数 souls', ammo: '弹药 ammo' })[k] ?? k} ${n}`);
    const soul = template.effects?.find(effect => effect.kind === 'kill_charge_weapon');
    if (soul) {
      const souls = Math.max(0, Math.min(soul.maxStacks ?? 10, value(instance.counters, soul.counterKey ?? 'souls') ?? 0));
      counters.push(`伤害 ×${1 + souls * (soul.bonusPerStack ?? .5)}`);
    }
    const badge = el('span', 'tag tone-gold card-item', [template.name, ...counters].join(' · '));
    badge.dataset.instanceId = id;
    badge.title = `${id}${template.description ? ` · ${template.description}` : ''}`;
    return badge;
  });
  node.replaceChildren(head, bars, cardStats, marks, row('装备实例', ...(equipment.length ? equipment : [el('span', 'muted', '徒手')])));
}

function renderFeatures(state) {
  const node = byId('feature-cards');
  const covers = values(state.covers).map(c => row(null, el('span', `tag card-item ${c.hp ? 'tone-amber' : 'tone-slate'}`, `${coverText(c)} · (${c.x},${c.y})`)));
  const interactives = values(state.interactives).map(i => row(null, el('span', `tag card-item ${i.spent ? 'tone-slate' : 'tone-violet'}`, `${interactiveText(i)} · (${i.x},${i.y})`)));
  node.replaceChildren(...covers, ...interactives);
}

function renderLogs(state) {
  const node = byId('combat-log');
  const logs = state.logs.slice(-100).reverse();
  const keys = logs.map(log => JSON.stringify(log));
  if (keys.length === logKeys.length && keys.every((k, i) => k === logKeys[i]) && node.hasChildNodes()) return;
  const existing = new Map();
  [...node.children].forEach((child, i) => {
    if (logKeys[i] != null) {
      if (!existing.has(logKeys[i])) existing.set(logKeys[i], []);
      existing.get(logKeys[i]).push(child);
    }
  });
  const entries = logs.map((log, i) => {
    const cached = existing.get(keys[i])?.shift();
    if (cached) return cached;
    const entry = el('details', `data-row log-entry${['damage', 'defeat', 'cover_break', 'outcome'].includes(log.type) ? ' damage-outcome' : ''}`);
    entry.append(el('summary', '', `R${log.round} · ${log.text}`));
    entry.append(el('pre', 'log-detail', log.detail && Object.keys(log.detail).length ? JSON.stringify(log.detail, null, 2) : '无额外检定明细。'));
    return entry;
  });
  syncChildren(node, entries.length ? entries : [el('p', 'muted', '暂无战况。')]);
  logKeys = keys;
  node.scrollTop = 0;
}

/** Update presentation only. Cell and toolbar button identities survive normal renders. */
export function render(state, ui = {}) {
  const current = value(state.units, state.order[state.turn]);
  const selected = ui.selectedId ?? ui.selectedUnitId ?? ui.selectedUnit ?? current?.id;
  const raw = Object.hasOwn(ui, 'action') ? ui.action : (current?.team === 'blue' ? { type: 'move' } : null);
  const action = typeof raw === 'string' ? { type: raw, ...(raw === 'skill' && ui.skillId ? { skillId: ui.skillId } : {}) } : raw;
  const hover = ui.hover ?? ui.hoverCell ?? ui.target ?? ui.preview?.center ?? null;
  const canAct = current?.team === 'blue' && !state.outcome;
  const previewRange = command => canAct ? rulesPreview(state, command) : null;
  const newSnapshot = lastRender?.state !== state;
  if (newSnapshot || lastRender.sprint !== ui.sprint) {
    const plan = previewRange({ type:ui.sprint ? 'sprint' : 'move' });
    const hits = previewRange({ type:'attack' });
    const keys = p => new Set((p?.ok ? p.cells : []).map(c => key(c.x,c.y)));
    baselineRanges = { move:keys(plan), attack:keys(hits), ap:plan?.ap };
  }
  const range = action ? previewRange({ type:action.type, ...(action.skillId ? {skillId:action.skillId} : {}) }) : null;
  const aimed = ['move', 'sprint', 'disengage', 'attack', 'skill', 'interact'].includes(action?.type);
  const result = canAct && aimed && hover ? rulesPreview(state, { ...action, x: hover.x, y: hover.y }) : null;
  if (renderedScenario !== state.scenarioId) {
    for (const anim of activeFeedback.values()) anim.cancel();
    renderedScenario = state.scenarioId;
  }
  const scenario = byId('scenario-select');
  if (!scenario.options.length) for (const [id, s] of Object.entries(ui.scenarioOptions ?? SCENARIOS)) {
    const opt = el('option', '', s.title ?? s.label ?? s);
    opt.value = s.id ?? id; scenario.append(opt);
  }
  const selectedUnit = value(state.units, selected);
  byId('sprint-indicator').textContent = ui.sprint ? ' · 疾跑范围 · 2 AP' : '';
  if (newSnapshot) {
    byId('battle-title').textContent = state.title;
    renderFeatures(state);
    renderLogs(state);
  }
  if (newSnapshot || lastRender.selected !== selected) renderTurn(state, current, selected);
  byId('end-turn').disabled = !canAct;
  byId('ai-step').disabled = !!state.outcome || current?.team !== 'red';
  renderBoard(state, selected, action, hover, range, result, baselineRanges);
  if (ui.target) renderPreview(state, action, hover, range, result, current, action ? current : selectedUnit);
  if (newSnapshot || lastRender.selected !== selected || lastRender.inspectedId !== ui.inspectedId) {
    const feature = value(state.covers, ui.inspectedId) ?? value(state.interactives, ui.inspectedId);
    renderCard(state, feature ? null : selectedUnit, feature);
  }
  lastRender = { state, selected, inspectedId: ui.inspectedId, sprint: ui.sprint };
  const message = byId('action-error');
  message.textContent = ui.error || '';
  message.hidden = !ui.error;
}

/** Compare committed snapshots; cosmetic only, no queues, no input blocking. */
export function feedback(before, after) {
  if (!before?.grid || !after?.grid || before.scenarioId !== after.scenarioId) return;
  const changes = new Map();
  const push = (item, label, kind) => {
    const xy = key(item.x, item.y);
    const previous = changes.get(xy);
    changes.set(xy, previous ? { label: `${previous.label} ${label}`, kind: kind === 'damage' ? kind : previous.kind } : { label, kind });
  };
  for (const u of values(after.units)) {
    const old = value(before.units, u.id);
    if (!old) continue;
    if (u.hp !== old.hp) push(u, sign(u.hp - old.hp), u.hp < old.hp ? 'damage' : 'heal');
    else if (u.x !== old.x || u.y !== old.y) push(u, '◆', 'move');
    else {
      const gained = statuses(u).filter(s => (value(old.statuses, s.id)?.stacks ?? 0) < s.stacks);
      if (gained.length) push(u, gained.map(s => s.name).join('／'), 'status');
    }
  }
  for (const c of values(after.covers)) {
    const old = value(before.covers, c.id);
    if (old && old.hp !== c.hp) push(c, c.hp <= 0 ? '坍塌' : sign(c.hp - old.hp), c.hp < old.hp ? 'damage' : 'heal');
  }
  for (const i of values(after.interactives)) if (i.spent && value(before.interactives, i.id)?.spent === false) push(i, i.kind === 'barrel' ? '引爆' : '已激活', 'status');
  if (after.logs.length > before.logs.length) for (const log of after.logs.slice(before.logs.length)) {
    if (log.type === 'roll' && log.detail?.hit === false) {
      const u = value(after.units, log.detail.targetId) ?? value(after.covers, log.detail.targetId);
      if (u && !changes.has(key(u.x, u.y))) push(u, '未命中', 'status');
    }
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const [xy, { label, kind }] of changes) {
    const cell = boardCells.get(xy)?.cell;
    if (!cell) continue;
    activeFeedback.get(xy)?.cancel();
    const overlay = el('span', `cell-feedback ${kind}`), text = el('b', '', label);
    overlay.setAttribute('aria-hidden', 'true'); overlay.append(text); cell.append(overlay);
    const motion = reduced ? [{ opacity: 1 }, { opacity: .85, offset: .45 }, { opacity: 0 }]
      : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: .95, transform: 'translateY(-7%)', offset: .4 }, { opacity: 0, transform: 'translateY(-23%)' }];
    const anim = overlay.animate(motion, { duration: 280, easing: 'cubic-bezier(.23, 1, .32, 1)' });
    activeFeedback.set(xy, anim);
    anim.oncancel = anim.onfinish = () => {
      overlay.remove();
      if (activeFeedback.get(xy) === anim) activeFeedback.delete(xy);
    };
  }
}
