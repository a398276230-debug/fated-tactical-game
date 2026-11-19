import { GameAPI as game } from '../api/game_api.js';
import { SCENARIOS } from '../presets/scenarios.js';
import * as view from './render.js';
import { placeTargetCard } from './target_card.js';
import { coverBetween, distance3D, elevation, hasLOS } from '../core/spatial.js';

const $ = id => document.getElementById(id);
const storageKey = 'fated-tactical/battle-v1';
const crossedKey = 'fated-tactical/carry-v1';
const scenario = $('scenario-select'), mode = $('mode-select'), seed = $('seed-input');
let state, selectedId, action, hover, target, sprint = false, timer, pending, carry, inspectedId, message = '';
let menuButtons = new Map();
const active = () => state.units[state.order[state.turn]];
const error = value => { message = value; $('action-error').hidden = !value; $('action-error').textContent = value ?? ''; };
const draw = () => {
  view.render(state, { selectedId, action, hover: target ?? hover, sprint, target, inspectedId, error: message });
  layoutTargetCard();
};
const drawPreview = draw;
const measurement = [$('measure-origin'), $('measure-target')];
function measure() {
  const [from, to] = measurement.map(input => state.units[input.value]);
  if (!from || !to) { $('measure-readout').textContent = '没有可测距的单位。'; return; }
  const dz = elevation(state, from) - elevation(state, to), cover = coverBetween(state, from, to);
  $('measure-readout').textContent = `${from.name} → ${to.name} · 战棋 ${distance3D(state,from,to).toFixed(2)}／原协议 ${game.protocolDistance({ ...from, z:elevation(state,from) }, { ...to, z:elevation(state,to) })} · ΔZ ${dz > 0 ? '+' : ''}${dz} · ${!hasLOS(state,from,to) ? '# 墙体阻断' : cover ? `${cover.id} 遮蔽 −${cover.cover}` : '视线通畅'}`;
}
function refreshMeasurement() {
  const living = Object.values(state.units).filter(u => u.hp > 0);
  for (const [i, input] of measurement.entries()) {
    const old = input.value;
    input.replaceChildren(...living.map(u => {
      const option = new Option(`${u.name} (${u.x},${u.y},Z${elevation(state,u)})`,u.id);
      option.dataset.faction = u.team;
      return option;
    }));
    input.value = living.some(u => u.id === old) ? old : (i ? living.find(u => u.team === 'red') : active())?.id ?? living.at(-1)?.id ?? '';
    input.dataset.faction = state.units[input.value]?.team ?? '';
  }
  measure();
}
function safely(fn) { try { error(''); return fn(); } catch (e) { error(e.message); return undefined; } }

for (const [id, { title }] of Object.entries(SCENARIOS)) scenario.add(new Option(title, id));
function scenarioDescription() {
  $('scenario-preview').textContent = SCENARIOS[scenario.value].description + (carry ? ' · 已载入跨战装备与状态' : '');
  $('clear-persistent').hidden = !carry;
}
function configure(id) {
  scenario.value = Object.hasOwn(SCENARIOS, id) ? id : 'ruins';
  seed.value = SCENARIOS[scenario.value].seed;
  scenarioDescription();
}
function restart() {
  if (!seed.value || !seed.checkValidity()) throw new Error('种子须为 0–4294967295 的整数');
  game.createBattle({ scenarioId: scenario.value, mode: mode.value, seed: Number(seed.value), ...(carry ? { persistentSnapshot: carry } : {}) });
}
function schedule() {
  clearTimeout(timer);
  if (!state?.outcome && active()?.team === 'red' && $('auto-ai').checked) {
    timer = setTimeout(() => safely(() => game.stepEnemy()), Number($('ai-speed').value));
  }
}
function pauseAI() {
  $('auto-ai').checked = false;
  $('auto-ai').onchange();
}
function clearProposal() {
  pending = null;
  $('sandbox-commit').disabled = true;
}
function sandboxOutput(value) { $('sandbox-output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function update({ resetAction = false, save = false } = {}) {
  const previous = state;
  state = game.getBattleState();
  if (resetAction || !state.units[selectedId]) {
    selectedId = active()?.id;
    action = null;
    hover = target = null;
    sprint = false;
    inspectedId = null;
    $('target-actions').hidden = true;
  }
  draw();
  refreshMeasurement();
  if (save) {
    try { localStorage.setItem(storageKey, JSON.stringify(game.exportBattleSnapshot())); }
    catch { error('浏览器存储空间不足或已关闭；请下载快照保存战局。'); }
    schedule();
  }
  return previous;
}
function execute(next) { return safely(() => game.playAction(next)); }
function pointFrom(el) {
  const cell = el.closest('#board [data-x][data-y]');
  return cell ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
}
const cellFor = at => $('board').querySelector(`[data-x="${at.x}"][data-y="${at.y}"]`);
function layoutTargetCard() {
  if (!target || $('target-actions').hidden) return;
  const anchor = cellFor(target);
  if (!anchor) return;
  const r = anchor.getBoundingClientRect(), clip = anchor.closest('.axis-scroll').getBoundingClientRect();
  const viewport = window.visualViewport;
  if (r.right <= Math.max(clip.left, viewport?.offsetLeft ?? 0)
    || r.left >= Math.min(clip.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth))
    || r.bottom <= (viewport?.offsetTop ?? 0) || r.top >= (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)) {
    closeTarget();
    return;
  }
  placeTargetCard($('target-actions'), anchor, viewport);
}
function closeTarget(restoreFocus = false) {
  const at = target;
  target = action = null;
  $('target-actions').hidden = true;
  draw();
  if (restoreFocus && at) cellFor(at)?.focus({ preventScroll:true });
}
const labelByType = { move:'移动', sprint:'疾跑至此', disengage:'撤离', attack:'普攻', interact:'互动', brace:'架势防御', block:'格挡', shield_bash:'盾击', charge:'蓄力', lock_on:'定位', scan:'探察', grapple:'擒抱', disarm:'缴械', trip:'绊摔', push:'推撞', flee:'逃跑', detour:'绕行', reload:'装填', end:'结束回合' };
function handlePoint(at, input = {}) {
  error('');
  const unit = Object.values(state.units).find(u => u.hp > 0 && u.x === at.x && u.y === at.y);
  const feature = [...Object.values(state.covers), ...Object.values(state.interactives)].find(v => v.x === at.x && v.y === at.y);
  const actor = active();
  const canAct = actor?.team === 'blue' && !state.outcome;
  const self = canAct && unit?.id === actor.id;
  if (self) {
    const check = game.previewAction({type:'sprint'});
    sprint = !sprint && check.ok;
    if (!check.ok) error(check.error);
  }
  selectedId = unit?.id ?? actor?.id;
  inspectedId = unit ? null : feature?.id;
  target = at; hover = at; action = null;
  const options = [];
  $('bonus-dice-select').value = String(Math.min(Number($('bonus-dice-select').value), actor?.bonusDice ?? 0));
  const add = (type, skill) => {
    const targetless = ['brace','block','charge','scan','flee','detour','reload','end'].includes(type);
    const command = { type, ...(targetless ? {} : at), ...(skill ? { skillId:skill } : {}),
      ...(type === 'attack' || type === 'skill' ? { intent:$('intent-select').value, nonLethal:$('nonlethal-toggle').checked,
        bonusDice:Number($('bonus-dice-select').value) } : {}) };
    const plan = game.previewAction(command);
    if (plan.ok) options.push({ command, plan, label: skill ? state.skills[skill].name : labelByType[type] });
  };
  if (canAct) {
    if (self) { add('brace'); add('block'); add('charge'); add('scan'); add('flee'); add('reload'); }
    else { add(sprint ? 'sprint' : 'move'); add('disengage'); add('attack'); add('lock_on'); add('grapple'); add('disarm'); add('trip'); add('push'); }
    add('interact');
    for (const skill of actor.skills) add('skill', skill);
    if (self) add('end');
  }
  $('target-title').textContent = `${unit?.name ?? feature?.name ?? '地块'} · (${at.x}, ${at.y})${self ? sprint ? ' · 疾跑已启用' : ' · 普通移动' : ''}`;
  const toolbar = $('action-toolbar'); toolbar.replaceChildren(); menuButtons = new Map();
  for (const { command, plan, label } of options) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'game-button'; button.dataset.action = command.type;
    if (command.skillId) button.dataset.skillId = command.skillId;
    const risky = plan.opportunities?.length;
    button.textContent = [label, plan.ap ? `${plan.ap} AP` : '', plan.mp ? `${plan.mp} MP` : '', plan.sp ? `${plan.sp} SP` : '', risky ? '⚠' : ''].filter(Boolean).join(' · ');
    button.setAttribute('aria-pressed','false');
    menuButtons.set(button, { command, plan, label }); toolbar.append(button);
  }
  if (!options.length) toolbar.textContent = canAct ? '当前没有适用于这一格的动作。' : '当前不能行动，仅查看地块。';
  $('target-preview').open = Boolean(options[0]?.plan.opportunities?.length);
  $('target-actions').hidden = false;
  $('target-actions').scrollTop = 0;
  $('confirm-action').hidden = true;
  if (options.length) action = options[0].command;
  draw();
  if (input.detail === 0) (toolbar.querySelector('button') ?? $('close-target')).focus({ preventScroll:true });
}
function handleAction(button) {
  const choice = menuButtons.get(button);
  if (!choice) return;
  const { command, plan, label } = choice;
  error('');
  if (!(['skill','attack'].includes(command.type) || plan.opportunities?.length)) { execute(command); return; }
  action = command;
  for (const btn of menuButtons.keys()) btn.setAttribute('aria-pressed', String(btn === button));
  const confirm = $('confirm-action');
  confirm.hidden = false; confirm.textContent = `确认${label}`;
  $('target-preview').open = true;
  draw();
}
function hoverPoint(point) { hover = point; if (!target) drawPreview(); }
function download(kind, value, format = 'json') {
  const link = document.createElement('a');
  const isText = format === 'txt';
  const url = URL.createObjectURL(new Blob([isText ? value : JSON.stringify(value, null, 2)], { type:isText ? 'text/plain;charset=utf-8' : 'application/json' }));
  link.href = url;
  link.download = `fated-${state.scenarioId}-${kind}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindControls() {
  for (const input of measurement) input.onchange = () => { input.dataset.faction = state.units[input.value]?.team ?? ''; measure(); };
  scenario.addEventListener('change', () => configure(scenario.value));
  $('intent-select').onchange = () => { if (target) handlePoint(target); };
  $('nonlethal-toggle').onchange = () => { if (target) handlePoint(target); };
  $('bonus-dice-select').onchange = () => { if (target) handlePoint(target); };
  $('theme-select').onchange = () => {
    const theme = $('theme-select').value;
    document.documentElement.dataset.dlcTheme = theme;
    try { localStorage.setItem('fated-tactical/theme', theme); } catch { /* optional preference */ }
  };
  $('clear-persistent').onclick = () => {
    carry = null;
    try { localStorage.removeItem(crossedKey); } catch { /* optional preference */ }
    scenarioDescription();
  };
  $('reset-button').onclick = () => safely(restart);
  $('end-turn').onclick = () => { if (active()?.team === 'blue') execute({ type:'end' }); };
  $('undo-button').onclick = () => safely(() => {
    // Pause so the just-undone red decision is not immediately applied again.
    pauseAI();
    const result = game.undoLastCommit(); if (!result.ok) error(result.error);
  });
  $('ai-step').onclick = () => safely(() => { clearTimeout(timer); game.stepEnemy(); });
  $('auto-ai').onchange = () => {
    try { localStorage.setItem('fated-tactical/auto', String($('auto-ai').checked)); } catch { /* optional preference */ }
    schedule();
  };
  $('ai-speed').onchange = schedule;
  const report = $('report-text'), reportMessage = $('report-message');
  $('export-report').onclick = () => {
    report.value = game.exportBattleReportText();
    reportMessage.textContent = '';
    $('report-dialog').showModal();
  };
  $('copy-report').onclick = async () => {
    try {
      await navigator.clipboard.writeText(report.value);
      reportMessage.textContent = '已复制。';
    } catch {
      report.focus(); report.select();
      reportMessage.textContent = '浏览器不允许自动复制，请按 Ctrl+C 或下载 TXT。';
    }
  };
  $('download-report').onclick = () => download('report', report.value, 'txt');
  $('export-snapshot').onclick = () => download('battle', game.exportBattleSnapshot());
  $('export-persistent').onclick = () => download('persistent', game.exportPersistentCarryOver());
  $('import-button').onclick = () => $('import-snapshot').click();
  $('import-snapshot').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('JSON 文件大于 8 MiB');
      const data = JSON.parse(await file.text());
      if (data.kind === 'persistent') {
        const previous = carry;
        carry = data;
        try { restart(); } catch (e) { carry = previous; throw e; }
        try { localStorage.setItem(crossedKey, JSON.stringify(carry)); } catch { /* downloaded file remains the source */ }
        scenarioDescription();
      } else {
        const restored = game.restoreBattleSnapshot(data);
        configure(restored.scenarioId);
        mode.value = restored.mode;
        if (restored.migratedFrom) { error('已恢复旧战局；借机规则从现在生效，旧撤销记录未迁移。'); return; }
      }
      error('');
    } catch (e) { error(`导入失败：${e.message}`); }
  };
  const editor = $('sandbox-editor'), reason = $('sandbox-reason');
  for (const input of [editor, reason]) input.addEventListener('input', clearProposal);
  $('api-sandbox').addEventListener('click', event => {
    const kind = event.target.closest('[data-example]')?.dataset.example;
    if (!kind) return;
    const commands = {
      counter: () => ({ type:'adjust_item_counter', instanceId:'soulblade-lan', counterKey:'souls', operation:'add', value:1 }),
      status: () => ({ type:'upsert_status', unitId:selectedId ?? active()?.id, statusId:'haste', options:{durationType:'persistent'} }),
      'custom-status': () => {
        const id = 'bone_frost';
        const apply = { type:'upsert_status', unitId:selectedId ?? active()?.id, statusId:id };
        if (Object.hasOwn(game.listStatusTemplates(), id)) return [apply];
        return [{ type:'define_status_template', template:{ id, name:'蚀骨寒霜', icon:'❄️', description:'回合初受到 3 点能量伤害，移动距离 −1。',
          category:'dot', remainingTurns:2, durationType:'battle_turns', tickTiming:'onTurnStart', stackRule:'refresh', maxStacks:1,
          modifiers:{ damage:3, damageType:'energy', movement:-1 } } }, apply];
      },
      terrain: () => ({ type:'set_terrain_cell', x:0, y:0, patch:{kind:'slope',z:1} }),
    };
    const example = commands[kind]();
    editor.value = JSON.stringify(Array.isArray(example) ? example : [example], null, 2);
    clearProposal();
  });
  $('sandbox-preview').onclick = () => {
    clearProposal();
    try {
      const result = game.proposeCommands(JSON.parse(editor.value), { baseRevision: game.getStateSummary().revision, reason: reason.value });
      sandboxOutput(result);
      if (result.ok) { pending = result.proposalId; $('sandbox-commit').disabled = false; }
    } catch (e) { sandboxOutput(`JSON 无效：${e.message}`); }
  };
  $('sandbox-commit').onclick = () => { const result = game.commitProposal(pending); clearProposal(); sandboxOutput(result); };
  $('sandbox-undo').onclick = () => {
    pauseAI();
    sandboxOutput(game.undoLastCommit()); clearProposal();
  };
  $('resource-button').onclick = () => {
    const unit = state.units[selectedId] ?? active();
    const previous = unit ? { hp:{current:unit.hp,max:unit.maxHp}, mp:{current:unit.mp,max:unit.maxMp}, sp:{current:unit.sp,max:unit.maxSp} } : undefined;
    $('resource-input').value = JSON.stringify({ stats:unit?.stats ?? {str:4,agi:4,con:4,int:4,spi:4}, tier:1, previous }, null, 2);
    $('calculate-resources').click();
    $('resource-dialog').showModal();
  };
  $('calculate-resources').onclick = () => {
    try {
      const result = game.calculatePrebattleResources(JSON.parse($('resource-input').value));
      $('resource-output').textContent = [`五维合计 ${result.statSum} · MC ${result.mc} · 集群 ${result.count} · 召唤初始总数 ${result.summonCount}`,
        ...Object.entries(result.resources).map(([k,v]) => `${k.toUpperCase()} ${v.current}/${v.max}（乘数 ${result.multipliers[k]}，未取整上限 ${v.rawMax}）`)].join('\n');
    } catch(e) { $('resource-output').textContent = e.message; }
  };
  $('close-target').onclick = () => closeTarget(true);
  $('target-preview').addEventListener('toggle', layoutTargetCard);
  document.addEventListener('pointerdown', e => {
    if (target && !$('target-actions').contains(e.target) && !pointFrom(e.target)) closeTarget();
  });
  window.addEventListener('scroll', layoutTargetCard, {capture:true,passive:true});
  window.addEventListener('resize', layoutTargetCard);
  window.visualViewport?.addEventListener('resize', layoutTargetCard);
  window.visualViewport?.addEventListener('scroll', layoutTargetCard);
  $('confirm-action').onclick = () => { if (target && action) execute(action); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && target && !document.querySelector('dialog[open]')) closeTarget(true); });
  $('action-toolbar').onclick = e => {
    const button = e.target.closest('[data-action]');
    if (button) handleAction(button);
  };
  $('turn-order').onclick = e => {
    const button = e.target.closest('[data-unit-id]');
    if (!button) return;
    selectedId = button.dataset.unitId;
    inspectedId = null;
    closeTarget();
  };
  $('board').onclick = e => { const at = pointFrom(e.target); if (at) handlePoint(at, e); };
  $('board').onpointerover = e => {
    const at = pointFrom(e.target), before = e.relatedTarget instanceof Element && pointFrom(e.relatedTarget);
    if (at && (!before || at.x !== before.x || at.y !== before.y)) hoverPoint(at);
  };
  $('board').onpointerleave = () => hoverPoint(null);
  $('board').onfocusin = e => { const at = pointFrom(e.target); if (at) hoverPoint(at); };
  $('board').onfocusout = e => { if (!$('board').contains(e.relatedTarget)) hoverPoint(null); };
}

configure('ruins');
let snapshot;
try {
  snapshot = JSON.parse(localStorage.getItem(storageKey));
  carry = JSON.parse(localStorage.getItem(crossedKey));
  $('auto-ai').checked = localStorage.getItem('fated-tactical/auto') !== 'false';
  const theme = localStorage.getItem('fated-tactical/theme');
  if (['amethyst','night-gold','frost-silver'].includes(theme)) {
    document.documentElement.dataset.dlcTheme = theme;
    $('theme-select').value = theme;
  }
} catch { /* unavailable local storage does not block play */ }
try {
  if (snapshot) {
    const restored = game.restoreBattleSnapshot(snapshot);
    if (restored.migratedFrom) error('已续接旧战局；借机规则从现在生效，旧撤销记录未迁移。');
  } else game.createBattle('ruins');
}
catch { game.createBattle('ruins'); error('存档格式不兼容，已打开默认战局。'); }
const initial = game.getStateSummary();
configure(initial.scenarioId); mode.value = initial.mode;
bindControls();
game.subscribe(() => {
  const hadProposal = Boolean(pending);
  clearProposal();
  if (hadProposal) sandboxOutput('战局已变化，需重新试算。');
  const before = update({ resetAction:true, save:true });
  if (before && state.logs.length > before.logs.length) view.feedback(before, state);
});
update({ resetAction:true, save:true });
