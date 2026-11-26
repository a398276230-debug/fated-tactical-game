import { createGameAPI } from '../api/game_api.js';
import { SCENARIOS } from '../presets/scenarios.js';
import { createRenderer, ACTION_LABELS, ACTION_HINTS } from './render.js';
import { createPlayback } from './animation.js';
import { equippedActiveSkills, isPassiveSkill, switchableWeapons } from '../core/combat.js';
import { placeTargetCard } from './target_card.js';
import { coverBetween, distance3D, elevation, hasLOS } from '../core/spatial.js';
import { requestBattleAi } from '../core/battle-ai.js';

const THEMES = ['amethyst', 'night-gold', 'frost-silver'];
const TARGETLESS = ['end_encounter','switch_weapon','stance_mode', 'brace', 'block', 'charge', 'scan', 'flee', 'use_item', 'reload', 'end'];
const PATH_NAMES = { units: '单位', items: '物品', grid: '地形', statuses: '状态', counters: '计数', statusTemplates: '状态模板', covers: '掩体', interactives: '互动点' };

/** 把沙盒试算结果写成人能读的句子（保留原始键名，便于对照命令）。 */
function describeProposal(result) {
  if (!result?.ok) return `✖ 无法执行：${result?.error ?? '未知错误'}`;
  if (result.revision != null && !result.diff) return `✔ 已写入战局（版本 ${result.revision}）。`;
  const short = v => (v == null ? '无' : typeof v === 'object' ? (v.name ? `「${v.name}」` : '一组数据') : String(v));
  const lines = (result.diff ?? []).filter(d => d.path[0] !== 'logs').map(d => {
    const path = d.path.map(p => PATH_NAMES[p] ?? p).join(' › ');
    if (!('before' in d)) return `＋ 新增 ${path}：${short(d.after)}`;
    if (!('after' in d)) return `－ 移除 ${path}`;
    return `• ${path}：${short(d.before)} → ${short(d.after)}`;
  });
  return [`试算通过，确认后会改变 ${lines.length} 处：`, ...lines].join('\n');
}

export function initializeUI(root, { game = createGameAPI(), storageKey = 'fated-tactical/battle-v1', crossedKey = 'fated-tactical/carry-v1', signal, initialState, customBattle, onVictory, storage: storageArea, battleAiRequest } = {}) {
  const document = root.ownerDocument, window = document.defaultView;
  let rawStorage = storageArea;
  try { rawStorage ??= window?.localStorage; } catch { /* storage is disabled */ }
  const saveError = '浏览器存储空间不足或已关闭；请下载快照保存战局。';
  const $ = id => root.querySelector(`[id="${id}"]`);
  let portraits = {};
  const view = createRenderer(root, id => Object.hasOwn(portraits, id) ? portraits[id] : []);
  const scenario = $('scenario-select'), seed = $('seed-input');
  const storage = {
    getItem: key => { try { return rawStorage?.getItem(key) ?? null; } catch { return null; } },
    setItem: (key, value) => {
      try {
        if (!rawStorage) throw new Error('浏览器存储不可用');
        rawStorage.setItem(key, value);
      } catch (error) {
        if (key === storageKey || key === crossedKey) throw error;
      }
    },
    removeItem: key => { try { rawStorage?.removeItem(key); } catch { /* optional */ } },
  };
  // state：屏幕上正在展示的战局（演出时会落后于真实战局）；live：规则层的真实战局。
  let bagAim = null;
  let state, live, selectedId, action, hover, target, sprint = false, timer, pending, carry, inspectedId, busy = false;
  let menuButtons = new Map(), openDrawer = null, seenLogs = 0, battleAiBusy = false;
  let visibleAsk = null, askCells = null, entityChoices = null;
  let toggleEntityChoice;

  const pendingAsk = () => live?.vm?.pendingAsk;
  const active = (s = state) => s?.units[s.order[s.turn]];
  const TARGETED = new Set(['attack', 'skill', 'lock_on', 'free_ally', 'suppress', 'grapple', 'disarm', 'trip', 'push', 'shield_bash']);
  let snapshotSaveFailed = false;
  const error = value => {
    const node = $('action-error');
    node.textContent = value || (snapshotSaveFailed ? saveError : '');
    node.hidden = !node.textContent;
  };
  const safely = fn => { try { error(''); return fn(); } catch (e) { error(e.message); return undefined; } };
  const draw = () => view.render(state, { selectedId, action, hover: target ?? hover, sprint, target, inspectedId, busy,
    askLocked: !!pendingAsk(), askCells, entityChoices });

  // ---------- 屏幕适配 ----------
  // HUD 高度随换行、横竖屏变化，实测后写回 CSS 变量，棋盘据此留白并计算格子尺寸。
  const app = root.querySelector('.ft-app');
  function fitLayout() {
    if (!app) return;
    const box = app.getBoundingClientRect();
    if (!box.width) return;
    const hud = root.querySelector('.ft-hud-top').getBoundingClientRect(), dock = root.querySelector('.ft-dock').getBoundingClientRect();
    const side = dock.height > box.height * .7; // 横屏时动作区是右侧竖栏
    app.style.setProperty('--hud-top', `${Math.round(hud.height)}px`);
    app.style.setProperty('--hud-bottom', side ? '0px' : `${Math.round(dock.height)}px`);
    app.style.setProperty('--hud-right', side ? `${Math.round(dock.width)}px` : '0px');
    const cell = $('board').querySelector('.tactical-cell')?.offsetWidth || 50;
    $('board-frame').dataset.compact = String(cell < 44);
  }
  // 缩放：100% = 整盘刚好放进可视区。以指针（或屏幕中心）为锚点缩放，锚点下的格子保持不动。
  const ZOOM_MIN = .5, ZOOM_MAX = 3;
  let zoom = 1;
  function setZoom(next, anchor) {
    const value = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
    const scroller = $('board-scroll'), frame = $('board-frame');
    const view = scroller.getBoundingClientRect();
    const at = anchor ?? { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const before = frame.getBoundingClientRect();
    const rx = (at.x - before.left) / (before.width || 1), ry = (at.y - before.top) / (before.height || 1);
    zoom = value;
    app.style.setProperty('--zoom', String(zoom));
    $('zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
    $('zoom-out').disabled = zoom <= ZOOM_MIN;
    $('zoom-in').disabled = zoom >= ZOOM_MAX;
    const after = frame.getBoundingClientRect();
    scroller.scrollLeft += after.left + rx * after.width - at.x;
    scroller.scrollTop += after.top + ry * after.height - at.y;
    storage.setItem('fated-tactical/zoom', String(zoom));
    fitLayout();
    layoutTargetCard();
  }
  const ZOOM_STEP = 1.25;
  function bindZoom() {
    const scroller = $('board-scroll');
    on('zoom-in', 'click', () => setZoom(zoom * ZOOM_STEP));
    on('zoom-out', 'click', () => setZoom(zoom / ZOOM_STEP));
    on('zoom-reset', 'click', () => setZoom(1));
    // 滚轮 / 触控板捏合（浏览器以 ctrl+wheel 上报）
    scroller.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setZoom(zoom * Math.exp(-delta * (e.ctrlKey ? .01 : .0015)), { x: e.clientX, y: e.clientY });
    }, { passive: false, signal });
    // 鼠标拖拽平移（单指拖动由浏览器原生滚动处理）。移动超过 5px 视为拖动，并吞掉随后那次点击。
    let pan = null, dragged = false;
    scroller.addEventListener('pointerdown', e => {
      dragged = false;
      if (e.pointerType === 'mouse' && e.button === 0) pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    }, { signal });
    scroller.addEventListener('pointermove', e => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!dragged && Math.hypot(dx, dy) <= 5) return;
      if (!dragged) { dragged = true; app.classList.add('is-panning'); scroller.setPointerCapture?.(e.pointerId); }
      scroller.scrollLeft = pan.left - dx; scroller.scrollTop = pan.top - dy;
    }, { signal });
    for (const type of ['pointerup', 'pointercancel']) scroller.addEventListener(type, () => { pan = null; app.classList.remove('is-panning'); }, { signal });
    scroller.addEventListener('click', e => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, { capture: true, signal });
    // 双指缩放：用 touch 事件而非 pointer 事件，因为浏览器一旦开始原生平移就会取消 pointer。
    // preventDefault 同时阻止浏览器把整页缩放。
    let pinch = null;
    const span = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) });
    scroller.addEventListener('touchstart', e => { if (e.touches.length === 2) { pinch = { d: span(e.touches).d, zoom }; dragged = true; } }, { passive: true, signal });
    scroller.addEventListener('touchmove', e => {
      if (e.touches.length < 2 || !pinch) return;
      e.preventDefault();
      const m = span(e.touches);
      if (pinch.d > 0) setZoom(pinch.zoom * m.d / pinch.d, m);
    }, { passive: false, signal });
    scroller.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true, signal });
    // iOS Safari 的整页捏合手势
    scroller.addEventListener('gesturestart', e => e.preventDefault(), { signal });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]') || root.querySelector('dialog[open]')) return;
      if (!root.contains(e.target) && e.target !== document.body) return;
      if (e.key === '+' || e.key === '=') setZoom(zoom * ZOOM_STEP);
      else if (e.key === '-' || e.key === '_') setZoom(zoom / ZOOM_STEP);
      else if (e.key === '0') setZoom(1);
      else return;
      e.preventDefault();
    }, { signal });
  }
  // 优先用浏览器原生全屏（手机上能藏掉地址栏）；不支持时退回为铺满视口的 is-expanded。
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (app.classList.contains('is-expanded')) { app.classList.remove('is-expanded'); return; }
    try { await app.requestFullscreen({ navigationUI: 'hide' }); }
    catch { app.classList.add('is-expanded'); }
  }
  function syncFullscreen() {
    const pressed = document.fullscreenElement === app || app.classList.contains('is-expanded');
    $('fullscreen-toggle').setAttribute('aria-pressed', String(pressed));
    $('fullscreen-toggle').title = pressed ? '退出全屏' : '全屏';
    window.requestAnimationFrame(fitLayout);
  }

  let victoryPending = false;
  function finishPlayback() {
    busy = false;
    show(live);
    schedule();
    if (victoryPending) {
      victoryPending = false;
      onVictory?.();
    }
  }
  const playback = createPlayback(root, {
    show(next, opts) { busy = !!opts?.busy; show(next); },
    onIdle: finishPlayback,
  });

  function show(next) {
    const changed = state !== next;
    state = next;
    if (changed && !target) selectedId = state.units[selectedId]?.hp > 0 ? selectedId : active()?.id;
    const askChanged = renderAsk(!busy && state === live ? pendingAsk() : null);
    draw();
    if (askChanged) {
      const firstCell = $('board').querySelector('.is-ask-option');
      (firstCell ?? $('pending-ask-prompt')).focus({ preventScroll: true });
    }
    if (view.renderLog(state) && openDrawer !== 'log') $('log-unread').hidden = false;
    refreshMeasurement();
  }
  function resetSelection() {
    bagAim = null;
    selectedId = active(live ?? state)?.id;
    action = null; hover = target = null; sprint = false; inspectedId = null;
    $('target-actions').hidden = true;
  }

  // ---------- 挂起选择 ----------
  function answer(ask, fields) {
    if (visibleAsk === ask && pendingAsk() === ask && !busy) {
      execute({ type: 'answer', askId: ask.askId, ...fields });
    }
  }

  function renderAsk(ask) {
    if (visibleAsk === (ask ?? null)) return;
    visibleAsk = ask ?? null;
    askCells = null;
    entityChoices = null;
    toggleEntityChoice = undefined;
    const panel = $('pending-ask'), prompt = $('pending-ask-prompt'), choices = $('pending-ask-choices');
    choices.replaceChildren();
    panel.hidden = !ask;
    if (!ask) return;

    const chooser = live.units[ask.chooserId];
    prompt.textContent = chooser ? `${chooser.name} · ${ask.prompt}` : ask.prompt;
    function addButton(label, getValue, primary = false) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'game-button primary' : 'game-button';
      button.textContent = label;
      button.addEventListener('click', () => answer(ask, { value: getValue() }), { signal });
      choices.append(button);
    }

    if (ask.kind === 'cell') {
      askCells = new Set(ask.options.map(({ x, y }) => `${x},${y}`));
      choices.textContent = '请选择棋盘上高亮的一格。';
    } else if (ask.kind === 'entity' && ask.maxSelect !== undefined) {
      const selected = new Set(), buttons = new Map();
      const limit = Math.min(ask.maxSelect, ask.options.length);
      entityChoices = { selected, eligible: new Set(ask.options.map(option => option.id)), limit };
      const count = document.createElement('output');
      count.setAttribute('aria-live', 'polite');
      choices.append(count);
      for (const { id, label } of ask.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'game-button';
        button.dataset.askEntity = id;
        button.textContent = label;
        button.addEventListener('click', () => toggleEntityChoice?.(id), { signal });
        choices.append(button);
        buttons.set(id, button);
      }
      addButton('确认选择', () => ask.options.filter(({ id }) => selected.has(id)).map(({ id }) => id), true);
      const confirm = choices.lastElementChild;
      const sync = () => {
        count.textContent = `已选 ${selected.size} / ${limit}`;
        confirm.disabled = selected.size === 0;
        for (const [id, button] of buttons) {
          button.setAttribute('aria-pressed', String(selected.has(id)));
          button.disabled = !selected.has(id) && selected.size >= limit;
        }
      };
      toggleEntityChoice = id => {
        if (visibleAsk !== ask || pendingAsk() !== ask || busy || !buttons.has(id)) return;
        if (!selected.delete(id) && selected.size < limit) selected.add(id);
        sync();
        draw();
      };
      sync();
    } else if (ask.kind === 'option' || ask.kind === 'entity') {
      for (const { id, label } of ask.options) addButton(label, () => id);
    } else if (ask.kind === 'number') {
      const { min, max, step = 1 } = ask.options;
      const slider = document.createElement('input'), readout = document.createElement('output');
      slider.type = 'range';
      slider.id = 'pending-ask-number';
      slider.setAttribute('aria-labelledby', prompt.id);
      Object.assign(slider, { min, max, step, value: min });
      readout.setAttribute('for', slider.id);
      const updateReadout = () => { readout.value = slider.value; };
      slider.addEventListener('input', updateReadout, { signal });
      updateReadout();
      choices.append(slider, readout);
      addButton('确认数值', () => slider.valueAsNumber, true);
    }
    return true;
  }

  // ---------- 测距 ----------
  const measurement = [$('measure-origin'), $('measure-target')];
  function measure() {
    const [from, to] = measurement.map(input => state.units[input.value]);
    if (!from || !to) { $('measure-readout').textContent = '没有可测距的单位。'; return; }
    const dz = elevation(state, from) - elevation(state, to), cover = coverBetween(state, from, to);
    const height = dz > 0 ? `${from.name}高出 ${dz}` : dz < 0 ? `${from.name}低 ${-dz}` : '两者同高';
    const sight = !hasLOS(state, from, to) ? '视线被墙体挡住' : cover ? `视线经过${cover.name ?? cover.id}，命中 −${cover.cover}` : '视线通畅';
    $('measure-readout').textContent = `${from.name} → ${to.name}\n棋盘距离 ${distance3D(state, from, to).toFixed(1)} 格（协议距离 ${game.protocolDistance({ ...from, z: elevation(state, from) }, { ...to, z: elevation(state, to) })}）\n${height}，${sight}`;
  }
  function refreshMeasurement() {
    const living = Object.values(state.units).filter(u => u.hp > 0);
    for (const [i, input] of measurement.entries()) {
      const old = input.value;
      input.replaceChildren(...living.map(u => {
        const option = new window.Option(`${u.name}（${u.x}, ${u.y}）`, u.id);
        option.dataset.faction = u.team;
        return option;
      }));
      input.value = living.some(u => u.id === old) ? old : (i ? living.find(u => u.team === 'red') : active())?.id ?? living.at(-1)?.id ?? '';
      input.dataset.faction = state.units[input.value]?.team ?? '';
    }
    measure();
  }

  // ---------- 抽屉 ----------
  function setDrawer(name) {
    if (pendingAsk()) return;
    const same = openDrawer === name;
    closeDrawer();
    if (same || !name) return;
    const panel = root.querySelector(`aside[data-drawer="${name}"]`);
    if (!panel) return;
    closeTarget();
    panel.hidden = false;
    openDrawer = name;
    $('drawer-scrim').hidden = false;
    root.querySelector(`[data-open-drawer="${name}"]`)?.setAttribute('aria-pressed', 'true');
    if (name === 'log') {
      $('log-unread').hidden = true;
      const scroller = $('combat-log').parentElement;
      scroller.scrollTop = scroller.scrollHeight;
    }
  }
  function closeDrawer() {
    if (!openDrawer) return;
    root.querySelector(`aside[data-drawer="${openDrawer}"]`).hidden = true;
    root.querySelector(`[data-open-drawer="${openDrawer}"]`)?.setAttribute('aria-pressed', 'false');
    $('drawer-scrim').hidden = true;
    openDrawer = null;
  }

  // ---------- 战局配置 ----------
  if (customBattle) for (const node of root.querySelectorAll('[data-scenario-only]')) node.hidden = true;
  else for (const [id, { title }] of Object.entries(SCENARIOS)) scenario.add(new window.Option(title, id));
  function scenarioDescription() {
    $('scenario-preview').textContent = customBattle ? '来自当前聊天 · 10×10' : SCENARIOS[scenario.value].description + (carry ? ' · 已载入跨战装备与状态' : '');
    $('clear-persistent').hidden = !!customBattle || !carry;
  }
  function configure(id) {
    if (customBattle) seed.value = customBattle.seed ?? 0;
    else {
      scenario.value = Object.hasOwn(SCENARIOS, id) ? id : 'ruins';
      seed.value = SCENARIOS[scenario.value].seed;
    }
    scenarioDescription();
  }
  async function restart() {
    if (!seed.value || !seed.checkValidity()) throw new Error('种子须为 0–4294967295 的整数');
    if (customBattle) {
      const value = Number(seed.value);
      const opening = await customBattle.restart({ seed: value });
      if (signal?.aborted) return;
      game.createBattle({ kind: 'custom_state', state: opening });
      customBattle.seed = value;
      storage.setItem(`${storageKey}/seed`, String(value));
    } else game.createBattle({ scenarioId: scenario.value, ruleset: 'protocol', seed: Number(seed.value), ...(carry ? { persistentSnapshot: carry } : {}) });
    closeDrawer();
  }

  // ---------- 敌方自动 ----------
  async function runBattleAiTurn() {
    const initial = live;
    if (!battleAiRequest || !$('llm-enemy-ai')?.checked || battleAiBusy || !initial || pendingAsk() || initial.outcome || active(initial)?.team !== 'red') return false;
    battleAiBusy = true;
    try {
      const entries = await requestBattleAi(initial, battleAiRequest);
      let executed = false, expected = initial;
      for (const entry of entries) {
        if (signal?.aborted || live !== expected || pendingAsk()) break;
        const actor = active(live);
        if (!actor || actor.team !== 'red' || actor.id !== entry.unitId || live.outcome) break;
        const plan = game.previewAction(entry.action);
        if (!plan.ok) throw new Error(plan.error || '外部战斗 AI 返回了非法动作');
        game.playAction(entry.action);
        expected = live;
        executed = true;
      }
      return executed;
    } catch (error) {
      console.warn('[fated:battle-ai] fallback to local AI', error);
      return false;
    } finally { battleAiBusy = false; }
  }
  function schedule() {
    window.clearTimeout(timer);
    if (busy || playback.busy || pendingAsk() || live?.outcome || active(live)?.team !== 'red' || !$('auto-ai').checked || battleAiBusy) return;
    timer = window.setTimeout(stepEnemy, Number($('ai-speed').value) || 350);
  }
  async function stepEnemy() {
    if (pendingAsk() || battleAiBusy) return;
    const before = live;
    const usedExternal = await runBattleAiTurn();
    if (signal?.aborted) return;
    if (!usedExternal && live === before && !pendingAsk() && !live?.outcome && active(live)?.team === 'red') safely(() => game.stepEnemy());
    else if (live !== before) schedule();
  }
  function pauseAI() { $('auto-ai').checked = false; storage.setItem('fated-tactical/auto', 'false'); window.clearTimeout(timer); }

  // ---------- 战局变化 ----------
  const continues = (a, b) => a && b && b.logs.length > a.logs.length && a.scenarioId === b.scenarioId
    && JSON.stringify(a.logs.at(-1)) === JSON.stringify(b.logs[a.logs.length - 1]);
  function onChange() {
    const before = live;
    live = game.getBattleState();
    if (!live.outcome) victoryPending = false;
    else if (before && !before.outcome) victoryPending = true;
    try {
      storage.setItem(storageKey, JSON.stringify(game.exportBattleSnapshot()));
      if (snapshotSaveFailed) { snapshotSaveFailed = false; error(''); }
    } catch { snapshotSaveFailed = true; error(saveError); }
    view.renderControls(live);
    if (pendingAsk()) {
      closeDrawer();
      for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
    }
    resetSelection();
    if (continues(before, live) && playback.enqueue(before, live)) { window.clearTimeout(timer); return; }
    playback.reset();
    finishPlayback();
  }
  const execute = command => safely(() => {
    if (pendingAsk() && command.type !== 'answer') return;
    const result = game.playAction(command);
    if (result && result.ok === false) error(result.error);
    return result;
  });

  // ---------- 目标浮卡 ----------
  const pointFrom = node => {
    const cell = node?.closest?.('[data-x][data-y]');
    return cell && $('board').contains(cell) ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
  };
  const cellFor = at => $('board').querySelector(`[data-x="${at.x}"][data-y="${at.y}"]`);
  function layoutTargetCard() {
    const card = $('target-actions');
    if (!target || card.hidden) return;
    const anchor = cellFor(target);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect(), clip = $('board-scroll').getBoundingClientRect();
    if (r.right <= clip.left || r.left >= clip.right || r.bottom <= clip.top || r.top >= clip.bottom) { closeTarget(); return; }
    placeTargetCard(card, anchor, window.visualViewport);
  }
  function closeTarget(restoreFocus = false) {
    const at = target;
    if (!at && !bagAim && $('target-actions').hidden) return;
    bagAim = null;
    target = action = null;
    $('target-actions').hidden = true;
    draw();
    if (restoreFocus && at) cellFor(at)?.focus({ preventScroll: true });
  }

  function handlePoint(at, input = {}) {
    if (pendingAsk()) return;
    error('');
    const actor = active();
    const canAct = actor?.team === 'blue' && !state.outcome;
    const units = Object.values(state.units).filter(u => u.hp > 0 && !u.fled && u.x === at.x && u.y === at.y);
    const clickedToken = input?.target?.closest?.('.tactical-cell-units > [data-unit-id]');
    const clickedUnitId = clickedToken?.dataset.unitId;
    const preferredUnit = units.find(u => u.id === (at.targetId ?? clickedUnitId))
      ?? units.find(u => u.id === action?.targetId)
      ?? (canAct ? units.find(u => u.team !== actor.team) : null)
      ?? units[0];
    const unit = preferredUnit;
    const chosenTargetId = unit?.id;
    const selectTarget = id => {
      if (!units.some(u => u.id === id)) return;
      handlePoint({ x: at.x, y: at.y, targetId: id }, { preserveSprint: true });
    };
    const feature = [...Object.values(state.covers), ...Object.values(state.interactives)].find(v => v.x === at.x && v.y === at.y);
    const self = canAct && unit?.id === actor.id;
    const onActorCell = canAct && actor.x === at.x && actor.y === at.y;
    if (bagAim) {
      const command = { type:'skill', skillId:bagAim, x: at.x, y: at.y, ...(unit?.id ? { targetId: unit.id } : {}) };
      const plan = game.previewAction(command);
      if (!plan.ok) { error(plan.error); return; }
      target = { x: at.x, y: at.y, ...(unit?.id ? { targetId: unit.id } : {}) }; hover = target; action = command; bagAim = null;
      $('target-title').textContent = `${plan.name} · (${at.x}, ${at.y})`;
      $('action-toolbar').replaceChildren(); $('target-options').hidden = true;
      $('target-actions').hidden = false; $('confirm-action').hidden = false;
      $('confirm-action').textContent = `确认使用${plan.name}`;
      draw(); layoutTargetCard(); return;
    }
    if (self && !input.preserveSprint) {
      const check = game.previewAction({ type: 'sprint' });
      sprint = !sprint && check.ok;
      if (!check.ok) error(`不能疾跑：${check.error}`);
    }
    selectedId = unit?.id ?? actor?.id;
    inspectedId = unit ? null : feature?.id;
    target = { x: at.x, y: at.y, ...(unit?.id ? { targetId: unit.id } : {}) }; hover = target; action = null;
    const bonus = $('bonus-dice-select');
    bonus.value = String(Math.min(Number(bonus.value), actor?.bonusDice ?? 0));
    const options = [];
    const add = (type, skill, itemId, skillName, maneuver) => {
      const command = { type, ...(maneuver && { maneuver }), ...(TARGETLESS.includes(type) ? {} : { x: at.x, y: at.y }), ...(skill ? { skillId: skill } : {}), ...(itemId ? { itemId } : {}),
        ...(chosenTargetId && !self && TARGETED.has(type) ? { targetId: chosenTargetId } : {}),
        ...(type === 'attack' || type === 'skill' ? { intent: $('intent-select').value || 'normal', nonLethal: $('nonlethal-toggle').checked, bonusDice: Number(bonus.value) } : {}) };
      const plan = game.previewAction(command);
      if (onActorCell && ['move', 'sprint'].includes(type) && !(plan.bankedProgress > (actor.moveCarryPermille ?? 0))) return;
      const limited = plan.usesLeft === 0 || plan.cooldownRemaining > 0;
      if ((plan.ok || limited || (type === 'flee' && plan.error?.includes('边界'))) && !(plan.interactiveId && options.some(o => o.plan.interactiveId === plan.interactiveId))) {
        const label = plan.bankedProgress != null ? (type === 'sprint' ? '疾跑推进' : '蓄步推进')
          : skillName ?? (skill || itemId || plan.interactiveId || type === 'end_encounter' ? plan.name : ACTION_LABELS[type]);
        options.push({ command, plan, label });
      }
    };
    if (canAct) {
      if (onActorCell) { add('move'); add('sprint'); }
      if (self) for (const t of ['brace', 'block', 'charge', 'scan', 'flee', 'use_item', 'reload']) add(t);
      else for (const t of [...(onActorCell ? [] : [sprint ? 'sprint' : 'move']), 'disengage', 'attack', 'shield_bash', 'lock_on', 'free_ally', 'suppress', 'grapple', 'disarm', 'trip', 'push']) add(t);
      if (self && actor.stance === 'greatsword') {
        const defensive = actor.greatswordMode !== 'defensive';
        add('stance_mode', null, null, defensive ? '重剑：转为沉势' : '重剑：转为攻势', defensive ? 'defensive' : 'offensive');
      }
      if (self) add('block', null, null, '重格挡', 'heavy');
      if (self) for (const itemId of switchableWeapons(state, actor)) add('switch_weapon', null, itemId);
      add('interact');
      const skills = new Map([...actor.skills.map(id => [id, state.skills[id]]), ...equippedActiveSkills(state, actor)]);
      for (const [skill, template] of skills) {
        if (!template || isPassiveSkill(template) || (template.itemId && !self)) continue;
        add('skill', skill, undefined, template.name);
      }
      if (self) {
        for (const [skillId, count] of Object.entries(actor.inventory ?? {})) {
          const item = state.skills[skillId];
          if (!item?.backpackItem || count < 1) continue;
          const command = { type:'skill', skillId };
          const plan = game.previewAction(command);
          options.push({ command, plan, bag:true, label:`使用背包物品：${item.name} ×${count}` });
        }
        add('end_encounter');
        add('end');
      }
    }
    const who = unit ? `${unit.team === 'blue' ? '我方' : '敌方'} ${unit.name}` : feature?.name ?? '空地';
    $('target-title').textContent = `${who} · (${at.x}, ${at.y})${self ? (sprint ? ' · 疾跑范围' : '') : ''}`;
    const targetOptions = $('target-unit-options');
    targetOptions.replaceChildren();
    targetOptions.hidden = units.length < 2;
    for (const candidate of units) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ft-target-unit'; button.dataset.targetId = candidate.id;
      button.dataset.faction = candidate.team; button.setAttribute('aria-pressed', String(candidate.id === unit?.id));
      button.textContent = `${candidate.name} · ${Math.round((candidate.hp / Math.max(1, candidate.maxHp)) * 100)}%`;
      button.addEventListener('click', () => selectTarget(candidate.id), { signal });
      targetOptions.append(button);
    }
    $('target-options').hidden = !options.some(o => ['attack', 'skill'].includes(o.command.type));
    const toolbar = $('action-toolbar');
    toolbar.replaceChildren();
    menuButtons = new Map();
    for (const choice of options) {
      const { command, plan, label } = choice;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'game-button'; button.dataset.action = command.type;
      if (command.skillId) button.dataset.skillId = command.skillId;
      const cost = [plan.ap ? `${plan.ap} AP` : '', plan.mp ? `${plan.mp} MP` : '', plan.sp ? `${plan.sp} SP` : ''].filter(Boolean).join(' · ');
      const odds = plan.targets?.[0]?.hitChance;
      const note = [cost, Number.isFinite(odds) && !plan.targets[0].automatic ? `命中 ${Math.round(odds * 100)}%` : '', plan.opportunities?.length ? '⚠ 会被借机' : ''].filter(Boolean).join(' · ');
      button.append(Number.isFinite(plan.usesLeft) ? `${label}（剩余 ${plan.usesLeft} 次）` : label);
      const small = document.createElement('small');
      small.textContent = note || ACTION_HINTS[command.type] || '';
      if (small.textContent) button.append(small);
      button.disabled = !plan.ok;
      button.title = plan.error || ACTION_HINTS[command.type] || label;
      if (!plan.ok) small.textContent = plan.error;
      if (!plan.ok && !small.parentNode) button.append(small);
      button.setAttribute('aria-pressed', 'false');
      menuButtons.set(button, choice);
      toolbar.append(button);
    }
    if (!options.length) toolbar.textContent = canAct ? '这一格没有能做的事。' : '现在不是你的回合，只能查看。';
    const card = $('target-actions');
    card.hidden = false;
    card.scrollTop = 0;
    $('confirm-action').hidden = true;
    if (options.length) action = options[0].command;
    draw();
    layoutTargetCard();
    if (input.detail === 0) (toolbar.querySelector('button') || $('close-target')).focus({ preventScroll: true });
  }
  function handleAction(button) {
    if (pendingAsk()) return;
    const choice = menuButtons.get(button);
    if (!choice) return;
    if (choice.bag) {
      bagAim = choice.command.skillId; action = choice.command; target = null; sprint = false;
      $('target-actions').hidden = true; error(`请选择${choice.plan.name}的目标（Esc 取消）`); draw(); return;
    }
    const { command, plan, label } = choice;
    error('');
    // 攻击、技能和有借机风险的移动要二次确认，其余直接执行
    if (!(['skill', 'attack','end_encounter'].includes(command.type) || plan.opportunities?.length)) { execute(command); return; }
    action = command;
    for (const btn of menuButtons.keys()) btn.setAttribute('aria-pressed', String(btn === button));
    const confirm = $('confirm-action');
    confirm.hidden = false;
    confirm.textContent = `确认${label}`;
    draw();
    layoutTargetCard();
  }

  function download(kind, value, format = 'json') {
    const link = document.createElement('a');
    const text = format === 'txt';
    const url = window.URL.createObjectURL(new window.Blob([text ? value : JSON.stringify(value, null, 2)], { type: text ? 'text/plain;charset=utf-8' : 'application/json' }));
    link.href = url;
    link.download = `fated-${live.scenarioId}-${kind}.${format}`;
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  const on = (id, event, fn) => $(id)?.addEventListener(event, fn, { signal });

  function bindControls() {
    for (const input of measurement) input.addEventListener('change', () => { input.dataset.faction = state.units[input.value]?.team ?? ''; measure(); }, { signal });
    on('scenario-select', 'change', () => configure(scenario.value));
    for (const id of ['intent-select', 'nonlethal-toggle', 'bonus-dice-select']) on(id, 'change', () => { if (target) handlePoint(target, { preserveSprint: true }); });
    on('theme-select', 'change', () => { root.dataset.dlcTheme = $('theme-select').value; storage.setItem('fated-tactical/theme', root.dataset.dlcTheme); });
    on('anim-speed', 'change', () => { playback.setSpeed(Number($('anim-speed').value)); storage.setItem('fated-tactical/anim', $('anim-speed').value); });
    on('clear-persistent', 'click', () => {
      if (pendingAsk()) return;
      carry = null;
      storage.removeItem(crossedKey);
      scenarioDescription();
    });
    on('reset-button', 'click', () => { if (!pendingAsk()) void restart().catch(e => error(e.message)); });
    on('end-turn', 'click', () => {
      if (pendingAsk()) return;
      playback.skip();
      if (active(live)?.team === 'blue') execute({ type: 'end' });
    });
    on('undo-button', 'click', () => safely(() => {
      if (pendingAsk()) return;
      pauseAI();
      const result = game.undoLastCommit();
      if (!result.ok) error(result.error);
    }));
    on('ai-step', 'click', () => {
      if (pendingAsk()) return;
      window.clearTimeout(timer);
      playback.skip();
      window.clearTimeout(timer);
      void stepEnemy();
    });
    on('auto-ai', 'change', () => { storage.setItem('fated-tactical/auto', String($('auto-ai').checked)); schedule(); });
    on('llm-enemy-ai', 'change', () => { storage.setItem('fated-tactical/llm-enemy-ai', String($('llm-enemy-ai').checked)); schedule(); });
    on('ai-speed', 'change', () => { storage.setItem('fated-tactical/ai-speed', $('ai-speed').value); schedule(); });
    on('skip-playback', 'click', () => playback.skip());
    bindZoom();
    on('fullscreen-toggle', 'click', () => { toggleFullscreen().then(syncFullscreen); });
    document.addEventListener('fullscreenchange', syncFullscreen, { signal });
    if (window.ResizeObserver) {
      let frame = 0; // 延后一帧，避免在观察回调里改尺寸触发 ResizeObserver 循环警告
      const observer = new window.ResizeObserver(() => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(fitLayout); });
      for (const node of [app, root.querySelector('.ft-hud-top'), root.querySelector('.ft-dock')]) if (node) observer.observe(node);
      signal?.addEventListener('abort', () => observer.disconnect());
    } else window.addEventListener('resize', fitLayout, { signal });

    const report = $('report-text'), reportMessage = $('report-message');
    on('export-report', 'click', () => { report.value = game.exportBattleReportText(); reportMessage.textContent = ''; $('report-dialog').showModal(); });
    on('copy-report', 'click', async () => {
      try { await window.navigator.clipboard.writeText(report.value); reportMessage.textContent = '已复制。'; }
      catch { report.focus(); report.select(); reportMessage.textContent = '浏览器不允许自动复制，请按 Ctrl+C 或下载 TXT。'; }
    });
    on('download-report', 'click', () => download('report', report.value, 'txt'));
    on('export-snapshot', 'click', () => download('battle', game.exportBattleSnapshot()));
    on('export-persistent', 'click', () => download('persistent', game.exportPersistentCarryOver()));
    on('import-button', 'click', () => { if (!pendingAsk()) $('import-snapshot').click(); });
    on('import-snapshot', 'change', async event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file || pendingAsk()) return;
      const before = live;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('文件大于 8 MiB');
        const data = JSON.parse(await file.text());
        if (signal?.aborted || live !== before || pendingAsk()) return;
        if (data.kind === 'persistent') {
          const previous = carry;
          carry = data;
          try { await restart(); } catch (e) { carry = previous; throw e; }
          scenarioDescription();
          try { storage.setItem(crossedKey, JSON.stringify(carry)); }
          catch { error(saveError); return; }
        } else {
          const restored = game.restoreBattleSnapshot(data);
          configure(restored.scenarioId);
          closeDrawer();
          if (restored.migratedFrom) { error('已恢复旧战局，旧撤销记录未迁移。'); return; }
        }
        error('');
      } catch (e) { error(`导入失败：${e.message}`); }
    });

    // 开发者沙盒
    const editor = $('sandbox-editor'), reason = $('sandbox-reason');
    const clearProposal = () => { pending = null; $('sandbox-commit').disabled = true; };
    for (const input of [editor, reason]) input.addEventListener('input', clearProposal, { signal });
    on('api-sandbox', 'click', event => {
      const kind = event.target.closest('[data-example]')?.dataset.example;
      if (!kind) return;
      const unitId = selectedId ?? active(live)?.id;
      const examples = {
        counter: () => ({ type: 'adjust_pool', poolId: game.getBattleState().items['soulblade-lan']?.pools?.souls ?? '', operation: 'add', value: 1 }),
        status: () => {
          const [registeredId] = Object.keys(game.getBattleState().statusTemplates ?? {});
          const statusId = registeredId ?? 'sandbox_buff';
          const apply = { type: 'upsert_status', unitId, statusId, options: { durationType: 'persistent' } };
          if (registeredId) return apply;
          return [{ type: 'define_status_template', template: { id: statusId, name: '沙盒增益', category: 'buff' } }, apply];
        },
        'custom-status': () => {
          const id = 'bone_frost', apply = { type: 'upsert_status', unitId, statusId: id };
          if (Object.hasOwn(game.listStatusTemplates(), id)) return [apply];
          return [{ type: 'define_status_template', template: { id, name: '蚀骨寒霜', icon: '❄️', description: '回合初受到 3 点能量伤害。',
            category: 'dot', remainingTurns: 2, durationType: 'battle_turns', stackMode: 'refresh', maxStacks: 1,
            rules: [{ id: 'bone-frost-tick', hook: 'turn_start', program: [{ op: 'damage', target: 'self', amount: 3, damageType: 'energy', direct: false }] }] } }, apply];
        },
        terrain: () => ({ type: 'set_terrain_cell', x: 0, y: 0, patch: { kind: 'slope', z: 1 } }),
      };
      const example = examples[kind]?.();
      if (example) editor.value = JSON.stringify([example].flat(), null, 2);
      clearProposal();
    });
    on('sandbox-preview', 'click', () => {
      if (pendingAsk()) return;
      clearProposal();
      let commands;
      try { commands = JSON.parse(editor.value); } catch (e) { $('sandbox-output').textContent = `命令不是合法 JSON：${e.message}`; return; }
      const result = game.proposeCommands(commands, { baseRevision: game.getStateSummary().revision, reason: reason.value });
      $('sandbox-output').textContent = describeProposal(result);
      if (result.ok) { pending = result.proposalId; $('sandbox-commit').disabled = false; }
    });
    on('sandbox-commit', 'click', () => {
      if (pendingAsk()) return;
      const result = game.commitProposal(pending);
      clearProposal();
      $('sandbox-output').textContent = describeProposal(result);
    });
    on('sandbox-undo', 'click', () => {
      if (pendingAsk()) return;
      pauseAI();
      const result = game.undoLastCommit();
      clearProposal();
      $('sandbox-output').textContent = result.ok ? `↶ 已撤销上一次改动（版本 ${result.revision}）。` : `✖ ${result.error}`;
    });

    on('resource-button', 'click', () => {
      const unit = state.units[selectedId] ?? active();
      const previous = unit ? { hp: { current: unit.hp, max: unit.maxHp }, mp: { current: unit.mp, max: unit.maxMp }, sp: { current: unit.sp, max: unit.maxSp } } : undefined;
      $('resource-input').value = JSON.stringify({ stats: unit?.stats ?? { str: 4, agi: 4, con: 4, int: 4, spi: 4 }, tier: 1, previous }, null, 2);
      $('calculate-resources').click();
      $('resource-dialog').showModal();
    });
    on('calculate-resources', 'click', () => {
      try {
        const r = game.calculatePrebattleResources(JSON.parse($('resource-input').value));
        $('resource-output').textContent = [`五维合计 ${r.statSum} · MC ${r.mc} · 集群 ${r.count} · 召唤初始总数 ${r.summonCount}`,
          ...Object.entries(r.resources).map(([k, v]) => `${k.toUpperCase()} ${v.current}/${v.max}（乘数 ${r.multipliers[k]}，未取整上限 ${v.rawMax}）`)].join('\n');
      } catch (e) { $('resource-output').textContent = e.message; }
    });

    on('close-target', 'click', () => closeTarget(true));
    on('confirm-action', 'click', () => { if (target && action) execute(action); });
    on('action-toolbar', 'click', e => { const button = e.target.closest('[data-action]'); if (button) handleAction(button); });
    on('turn-order', 'click', e => {
      if (pendingAsk()) return;
      const button = e.target.closest('[data-unit-id]');
      if (!button) return;
      selectedId = button.dataset.unitId;
      inspectedId = null;
      closeTarget();
      draw();
      setDrawer(openDrawer === 'unit' ? null : 'unit');
    });
    document.addEventListener('pointerdown', e => {
      if (target && !$('target-actions').contains(e.target) && !pointFrom(e.target)) closeTarget();
    }, { signal });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || root.querySelector('dialog[open]')) return;
      if (target || bagAim) closeTarget(true);
      else if (openDrawer) closeDrawer();
      else playback.skip();
    }, { signal });
    for (const [node, event] of [[window, 'resize'], [window.visualViewport, 'resize'], [window.visualViewport, 'scroll']]) node?.addEventListener(event, layoutTargetCard, { signal });
    window.addEventListener('scroll', event => {
      // Scrolling inside the card does not move the board anchor.
      if (!(event.target instanceof window.Node && $('target-actions').contains(event.target))) layoutTargetCard();
    }, { capture: true, passive: true, signal });

    const board = $('board');
    board.addEventListener('click', e => {
      const at = pointFrom(e.target);
      if (!at) return;
      if (pendingAsk()) {
        if (askCells?.has(`${at.x},${at.y}`)) answer(visibleAsk, at);
        else {
          const picked = e.target.closest?.('.tactical-cell-units > [data-unit-id]')?.dataset.unitId
            ?? Object.values(state.units).find(u => u.hp > 0 && !u.fled && u.x === at.x && u.y === at.y && entityChoices?.eligible.has(u.id))?.id
            ?? e.target.closest('.tactical-cell')?.dataset.unitId;
          toggleEntityChoice?.(picked);
        }
        return;
      }
      if (playback.busy) playback.skip(); // 演出中点棋盘 = 跳过演出
      handlePoint(at, e);
    }, { signal });
    const hoverPoint = point => { if (!pendingAsk()) { hover = point; if (!target) draw(); } };
    board.addEventListener('pointerover', e => {
      const at = pointFrom(e.target), before = pointFrom(e.relatedTarget);
      if (at && (!before || at.x !== before.x || at.y !== before.y)) hoverPoint(at);
    }, { signal });
    board.addEventListener('pointerleave', () => hoverPoint(null), { signal });
    board.addEventListener('focusin', e => { const at = pointFrom(e.target); if (at) hoverPoint(at); }, { signal });
    board.addEventListener('focusout', e => { if (!board.contains(e.relatedTarget)) hoverPoint(null); }, { signal });

    root.addEventListener('click', e => {
      const opener = e.target.closest('[data-open-drawer]');
      if (opener) setDrawer(opener.dataset.openDrawer);
      else if (e.target.closest('[data-close-drawer]') || e.target === $('drawer-scrim')) closeDrawer();
    }, { signal });
  }

  // ---------- 启动 ----------
  configure('ruins');
  let snapshot = initialState;
  try {
    if (!initialState || customBattle?.restoreSaved) {
      const saved = JSON.parse(storage.getItem(storageKey));
      if (saved?.state?.scenarioId === initialState?.scenarioId || !initialState) snapshot = saved ?? initialState;
    }
    carry = JSON.parse(storage.getItem(crossedKey));
  } catch { /* 存储不可用不影响游戏 */ }
  $('auto-ai').checked = storage.getItem('fated-tactical/auto') !== 'false';
  $('llm-enemy-ai').checked = storage.getItem('fated-tactical/llm-enemy-ai') === 'true';
  const theme = storage.getItem('fated-tactical/theme');
  if (THEMES.includes(theme)) { root.dataset.dlcTheme = theme; $('theme-select').value = theme; }
  else if (THEMES.includes(root.dataset.dlcTheme)) $('theme-select').value = root.dataset.dlcTheme;
  for (const [id, key] of [['anim-speed', 'fated-tactical/anim'], ['ai-speed', 'fated-tactical/ai-speed']]) {
    const value = storage.getItem(key);
    if (value != null && [...$(id).options].some(o => o.value === value)) $(id).value = value;
  }
  playback.setSpeed(Number($('anim-speed').value));
  try {
    if (snapshot) {
      const restored = snapshot.kind === 'battle' ? game.restoreBattleSnapshot(snapshot) : game.createBattle({ kind: 'custom_state', state: snapshot });
      if (restored.migratedFrom) error('已续接旧战局，旧撤销记录未迁移。');
    } else game.createBattle({ scenarioId: 'ruins', ruleset: 'protocol' });
  } catch (cause) {
    if (customBattle) {
      if (snapshot === initialState) throw cause;
      game.createBattle({ kind: 'custom_state', state: initialState });
      error('存档格式不兼容，已重新加载正文战局。');
    } else {
      game.createBattle({ scenarioId: 'ruins', ruleset: 'protocol' });
      error('存档格式不兼容，已打开默认战局。');
    }
  }
  if (customBattle) {
    const savedSeed = storage.getItem(`${storageKey}/seed`);
    if (snapshot?.kind === 'battle' && savedSeed != null && /^\d+$/.test(savedSeed)) customBattle.seed = Number(savedSeed);
    else storage.setItem(`${storageKey}/seed`, String(customBattle.seed ?? 0));
  }
  const initial = game.getStateSummary();
  configure(initial.scenarioId);
  bindControls();
  const unsubscribe = game.subscribe(() => {
    if (pending) { pending = null; $('sandbox-commit').disabled = true; }
    onChange();
  });
  onChange();
  fitLayout();
  setZoom(Number(storage.getItem('fated-tactical/zoom')) || 1);
  seenLogs = live.logs.length;
  $('log-unread').hidden = seenLogs <= 2;

  return {
    setPortraits(next) { portraits = next; draw(); },
    loadState(next) {
      const result = next?.kind === 'battle' ? game.restoreBattleSnapshot(next) : game.createBattle({ kind: 'custom_state', state: next });
      if (!customBattle) configure(result.scenarioId);
      error('');
      return result;
    },
    getState: () => game.getBattleState(),
    exportBattleReportText: () => game.exportBattleReportText(),
    exportMvuPatch: () => ({ kind: 'battle', state: game.getBattleState() }),
    api: game,
    destroy() { window.clearTimeout(timer); playback.reset(); closeDrawer(); if (typeof unsubscribe === 'function') unsubscribe(); },
  };
}
