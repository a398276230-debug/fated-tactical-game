import { classifyWarnings, diagnosticText, diagnosticTitle, remainingDiagnostics, normalizationCandidates, isSceneZoneWarning, hasPendingSceneWarnings, warningEntryKey, warningKey } from './resolved-warnings.js';
import { hydrateFromSources as hydrateBattleState, parseBattleInit, parseSimpleYaml, warningsForUnit } from './converter.js';
import { semanticExemptionKey } from './exemption-ledger.js';
import { activeNarrativeExemptions, normalizationLimit, normalizationLimits, normalizationPath, planNormalizationBatches, runOrderedBatches, warningReference } from './normalization-batches.js';
import { mount as defaultMount } from '../ui/mount.js';
import { validateState as defaultValidateState } from '../api/validation.js';
import { refreshOpeningInitiative, refreshOutcome, syncEquipmentEffects } from '../core/combat.js';
import { battleReportToMvuPatch } from './converter-patch.js';
import { outcomeDigest, rollbackBattleOutcome, writeBattleOutcome, writebackReceipt } from './mvu-writeback.js';
import { hostMethod, probeMvuWriteCapability, readBattleVariables, readChatMessages, statData } from './host.js';
import { tavernTheme } from './theme.js';
import { readBattlePortraits } from './portraits.js';
import { assembleMessages, describeSlots } from './prompts.js';
import { normalizationApiConfig, requestViaTavern, requestViaCustomApi } from './api.js';
import { renderSettings } from './settings.js';
import { createAiSessions } from './ai-sessions.js';
import { characterRecords, stableSourceJson } from './char-snapshots.js';
import { entryRoot, normalizationTransactions, replayNormalization } from './normalization-replay.js';
import { duplicateMappings, duplicateOperations, instanceGroups } from './instance-groups.js';
import { fillInstance } from './instance-card.js';
import { mountAiPage } from './ai-page.js';
import { chatUndoChanges, chatInversePatch } from './ai-patch-undo.js';
import { acceptNormalizationResponse, rejectedWarning, repairWarnings, runNormalizationRepair } from './normalization-commit.js';
import { buildAIRequest, extractJsonBlocks, extractTag, messageContent, messageMeta, parseAIResponse, preferredJson, requestAI, requestTavernAI, safeKey, stripMetaAndReasoning } from './overlay-ai.js';
import { applyPatch, chatPatch, fingerprintAt, formatRejectedItem, parseJSONPatch } from './overlay-patch.js';
import { LARGE_CONFIG_KEYS, TAVERN_VERSION, chatId, configFor, putConfig, separateConfigKey, sourceBundle, tavernIdentity, tavernMessages } from './overlay-sources.js';
import { style } from './overlay-diagnostics-view.js';
import { computeStorageDiagnostics, pruneBattleScopedMap, pruneBattleStorageExcept as pruneStoredBattles,
  toPersistedOpeningSource, toStoredCharSnapshot } from './overlay-storage.js';

/*
 * Tavern integration.  This file deliberately has no dependency on SillyTavern: it
 * can be loaded from an iframe, from a normal web page, or from a test DOM.  The
 * game and converter are supplied by the library entry point (or by options).
 */

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const safeProperty = key => !['__proto__', 'prototype', 'constructor'].includes(key);
const clone = value => {
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

function hostWindow() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  try { return w.parent && w.parent.document ? w.parent : w; } catch (_) { return w; }
}
function hostDocument(preferred) {
  const w = preferred || hostWindow();
  try { return w.document || document; } catch (_) { return typeof document !== 'undefined' ? document : null; }
}
function getGlobal(host, name) {
  try { return host?.[name] ?? globalThis?.[name]; } catch (_) { return undefined; }
}
function safeStorage(host) {
  try { return host.localStorage; } catch (_) { return null; }
}
function text(value) { return value == null ? '' : String(value); }
function el(doc, tag, attrs, content) {
  const n = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') n.className = value;
    else if (key === 'style') n.style.cssText = value;
    else if (key === 'text') n.textContent = value;
    else if (value != null) n.setAttribute(key, value);
  }
  if (content != null) n.textContent = content;
  return n;
}
function parseJSON(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function balancedJSONObjects(source) {
  const value = text(source).replaceAll('&quot;', '"').replaceAll('&#34;', '"');
  const results = [];
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < value.length; i++) {
      const ch = value[i];
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        const parsed = parseJSON(value.slice(start, i + 1), null);
        if (parsed) results.push(parsed);
        break;
      }
    }
  }
  return results;
}
function findBattleJSON(source) {
  return balancedJSONObjects(source).reverse().find(value => isObject(value) && (Array.isArray(value.units) || Array.isArray(value.participants) || value.battleId || value.title || value.sceneTitle)) || null;
}
function deepMerge(base, extra) {
  const result = isObject(base) ? clone(base) : {};
  if (!isObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (!safeProperty(key)) continue;
    if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}
function deletePath(object, path) {
  if (!path) return;
  const parts = String(path).trim().replace(/^\$\.?/, '').split('.').filter(Boolean);
  if (!parts.length || !parts.every(safeProperty)) return;
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts.at(-1)];
}
function excludedList(value) {
  if (Array.isArray(value)) return value.flatMap(excludedList);
  if (typeof value !== 'string') return [];
  return value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
}

/** Build an OpenAI-compatible request without mutating user configuration. */
export function mountTavernOverlay(options = {}) {
  const host = options.host || hostWindow();
  const doc = options.document || hostDocument(host);
  if (!doc || !doc.createElement) return { dispose() {}, open() {}, close() {} };
  try { host.__fatedTacticalTavern?.dispose?.(); } catch (_) { /* stale instance */ }
  style(doc);
  const storage = options.storage || safeStorage(host);
  const id = options.instanceId || chatId(host);
  const configKey = `fated-tactical/tavern/${id}`;
  const stateKey = `fated-tactical/instances/${id}`;
  let config = configFor(storage, configKey);
  const aiSessions = createAiSessions(config.aiSessions, value => persistSettings({ aiSessions: value }));

  let disposed = false, gameMount = null, sources = {}, currentState = null, scanEpoch = 0, activeBattleKey = null;
  let selectedMessageId = null, selectedBattleText = '', aiController = null, aiFinished, retryAI = null, aiPage = null;
  let characters = {}, scanStatus = '', duplicatePaths = new Map();
  const groupId = id => config.instances[id]?.archetypeId ?? characters[id]?.archetypeId ?? id;
  const openingSources = new Map();
  const selectedIds = () => [...new Set((config.rosterSelection ?? Object.keys(config.instances)).filter(key => own(config.instances,key)).map(groupId))];
  const batches = key => config.normalizationBatches?.[key] ?? [];
  const operations = key => batches(key).flatMap(batch=>batch.patch);
  let battleObserver = null, diagnostics = { phase: 'created' };
  const listeners = [], controller = typeof AbortController === 'function' ? new AbortController() : null;
  const on = (node, event, fn, opts = {}) => { if (!node) return; const options2 = controller ? { ...opts, signal: controller.signal } : opts; node.addEventListener(event, fn, options2); if (!controller) listeners.push(() => node.removeEventListener(event, fn, opts)); };
  const root = el(doc, 'div', { 'data-fated-tavern-overlay': '' });
  const baselineCache = { key: null, state: null };
function hydrateBaseline(input, { seed } = {}) {
  const custom = getGlobal(document?.defaultView ?? globalThis, 'FatedTactical')?.hydrateBattleState;
  if (custom) return custom(input, { seed, throwOnValidation: true }).state;
  const key = JSON.stringify([input, seed ?? null]);
  if (baselineCache.key === key && baselineCache.state) return structuredClone(baselineCache.state);
  const state = hydrateBattleState(input, { seed, throwOnValidation: true }).state;
  baselineCache.key = key;
  baselineCache.state = structuredClone(state);
  return structuredClone(state);
}

const launcher = el(doc, 'button', { class: 'fated-tavern-launcher', title: `打开命定战术控制台 · v${TAVERN_VERSION}`, 'aria-label': `打开命定战术控制台 · v${TAVERN_VERSION}`, type: 'button' }, '🪄');
  const panel = el(doc, 'section', { class: 'fated-tavern-panel', role: 'dialog', 'aria-label': '命定战术酒馆控制台', hidden: '' });
  const header = el(doc, 'header', { class: 'fated-tavern-header' });
  const title = el(doc, 'strong', {}, `命定战术控制台 v${TAVERN_VERSION}`);
  const fullscreen = el(doc, 'button', { type: 'button', class: 'fated-tavern-fullscreen', title: '全屏', 'aria-label': '全屏' }, '□');
  const minimize = el(doc, 'button', { type: 'button', title: '最小化', 'aria-label': '最小化' }, '−');
  const close = el(doc, 'button', { type: 'button', title: '关闭', 'aria-label': '关闭' }, '×');
  const resizeHandle = el(doc, 'span', { class: 'fated-tavern-resize', 'aria-hidden': 'true' });
  header.append(title, fullscreen, minimize, close);
  const tabs = el(doc, 'nav', { class: 'fated-tavern-tabs', role: 'tablist' });
  const content = el(doc, 'div', { class: 'fated-tavern-content' });
  const pages = {};
  for (const [key, label] of [['instances', '📦 实例维护'], ['prompt', '🧩 提示词组装'], ['api', '🔌 API 设置'], ['ai', '🤖 辅助 AI'], ['sandbox', '⚔️ 沙盘']]) {
    const button = el(doc, 'button', { type: 'button', role: 'tab', 'aria-selected': key === 'instances' ? 'true' : 'false', 'data-tab': key }, label);
    const page = el(doc, 'div', { class: `fated-tab ${key === 'instances' ? 'active' : ''}`, 'data-page': key });
    tabs.append(button); content.append(page); pages[key] = page;
    on(button, 'click', () => { Object.entries(pages).forEach(([name, node]) => { node.classList.toggle('active', name === key); }); [...tabs.children].forEach(x => x.setAttribute('aria-selected', String(x === button))); if (key === 'prompt' || key === 'api') renderSettings(page, key, settingsContext()); if (key === 'ai') aiPage?.show(); });
  }
  const toast = el(doc, 'aside', { class: 'fated-toast', hidden: '', role: 'status', 'aria-live': 'polite' });
  const noticeTitle = el(doc, 'strong'), noticeBody = el(doc, 'p');
  const retry = el(doc, 'button', { type: 'button' }, '重试');
  const dismiss = el(doc, 'button', { type: 'button' }, '关闭');
  const icon = el(doc, 'span', { 'aria-hidden': 'true' });
  const heading = el(doc, 'header'); heading.append(icon, noticeTitle);
  const issues = el(doc, 'section', { class: 'fated-toast-issues' });
  const summary = el(doc, 'p', { class: 'fated-toast-summary' });
  const actions = el(doc, 'footer'); actions.append(retry, dismiss);
  toast.append(heading, noticeBody, summary, actions);
  on(retry, 'click', () => retryAI?.());
  on(dismiss, 'click', () => { toast.hidden = true; });
  const warningDisplay = warning => warning.userSummary || diagnosticText(warning.message);
  function exemptionRecords(key, warnings = []) {
    const local = config.narrativeExemptions[key] ?? [];
    if (!key || !warnings.some(isSceneZoneWarning)) return local;
    const prefix = `${safeKey(chatId(host))}__`;
    return [...local, ...Object.entries(config.narrativeExemptions)
      .filter(([other]) => other !== key && other.startsWith(prefix))
      .flatMap(([, receipts]) => receipts.filter(isSceneZoneWarning))];
  }
  function warningGroups(warnings = sources.warnings ?? []) {
    const live = liveState();
    return classifyWarnings(warnings, {
      notes: config.unresolvedNotes[activeBattleKey], exemptions: exemptionRecords(activeBattleKey, warnings),
      sourceFor: narrativeSourceFor(characters), fingerprint: path => fingerprintAt(live, path),
    });
  }
  function updateWarningExemption(warning, ignore) {
    if (!activeBattleKey || aiController) return;
    syncSettings();
    const battle = activeBattleKey;
    const key = warningKey(warning), { unitId } = warning;
    const scene = isSceneZoneWarning(warning);
    if (unitId === null && !scene) return;
    const semanticKey = scene ? semanticExemptionKey(warning) : undefined;
    const receipts = (config.narrativeExemptions[battle] ?? []).filter(entry =>
      (entry.key !== key || entry.unitId !== unitId) && (!scene || entry.semanticKey !== semanticKey));
    const notes = { ...config.unresolvedNotes[battle] };
    const bucket = unitId ?? '';
    notes[bucket] = { ...notes[bucket] };
    delete notes[bucket][key];
    if (!Object.keys(notes[bucket]).length) delete notes[bucket];
    if (ignore || scene) {
      const source = narrativeSourceFor(characters)(unitId, warningEntryKey(warning));
      if (!source) return;
      const reason = ignore ? '玩家已设为非战斗忽略' : '玩家已恢复为待编译';
      receipts.push(scene ? { unitId, key, source, reason, semanticKey, originPath: warning.originPath,
        origin: 'manual', status: ignore ? 'active' : 'revoked', updatedAt: Date.now() }
        : { unitId, key, source, reason, dismissed: true });
    }
    persistSettings({ narrativeExemptions: { ...config.narrativeExemptions, [battle]: receipts },
      unresolvedNotes: { ...config.unresolvedNotes, [battle]: notes } });
    filterResolved(config.charSnapshots[battle] ?? {}, characters);
    toast.hidden = true;
    renderInstances();
  }
  function openWarningComposer(warning, reason) {
    const name = liveState()?.units?.[warning.unitId]?.name ?? characters[warning.unitId]?.raw?.name ?? '本场战斗';
    tabs.querySelector('[data-tab="ai"]').click();
    toast.hidden = true;
    const original = warning.rawExcerpt ? `\n原文：${warning.rawExcerpt}` : '';
    aiPage?.prefill(`请协助补充 ${name} 的战斗词条。\n词条：${warningDisplay(warning)}${original}\n当前缺口：${reason}\n我的补充：`);
  }
  function appendWarningGroups(container, groups, expandable = false) {
    for (const [kind, label] of [['autoAdjusted', '🧭 战场自动适配'], ['pending', '⏳ 待编译词条'],
      ['approximated', '✨ 已近似实装'], ['needsAttention', 'ⓘ 未能自动转换'], ['nonCombat', '📖 非战斗词条 · 本场跳过']]) {
      const rows = groups[kind];
      if (!rows.length) continue;
      const group = el(doc, expandable ? 'details' : 'div', { class: 'fated-char-diagnostics', 'data-normalization-diagnostics': kind });
      const list = el(doc, 'ul');
      for (const row of rows) {
        const warning = row.warning ?? row;
        const category = row.kind === 'missing_info' ? '原文缺参 · ' : row.kind === 'engine_limit' ? '机制暂不支持 · ' : '';
        const item = el(doc, 'li', { title: warning.rawExcerpt || warningDisplay(warning) },
          `${warningDisplay(warning)}${row.reason ? ` — ${category}${row.reason}` : ''}`);
        const action = (name, label, handler) => {
          const button = el(doc, 'button', { type: 'button', 'data-warning-action': name }, label);
          button.disabled = Boolean(aiController) && expandable;
          on(button, 'click', handler);
          item.append(' ', button);
        };
        if (kind === 'needsAttention' || kind === 'pending' && isSceneZoneWarning(warning)) action('ignore', '设为非战斗忽略', () => updateWarningExemption(warning, true));
        if (kind === 'needsAttention' || kind === 'approximated') action('supplement', '去辅助 AI 补充', () => openWarningComposer(warning, row.reason));
        if (kind === 'nonCombat') action('restore', '恢复为待编译', () => updateWarningExemption(warning, false));
        list.append(item);
      }
      group.append(el(doc, expandable ? 'summary' : 'h4', {}, `${label}（${rows.length} 项）`), list);
      container.append(group);
    }
  }
  let rawDetails;
  function notify(title, detail = '', onRetry = null, busy = false, { tone = 'neutral', applied, unresolved = [], warningGroups: groups, raw = '' } = {}) {
    retryAI = onRetry;
    toast.dataset.tone = tone;
    icon.textContent = busy ? '…' : tone === 'success' ? '✓' : tone === 'warning' ? '⚠' : tone === 'error' ? '!' : 'ⓘ';
    summary.hidden = applied == null;
    summary.textContent = applied == null ? '' : `已应用 ${applied} 项补丁${groups ? '' : ` · 剩余 ${unresolved.length} 项未解决`}`;
    rawDetails?.remove();
    rawDetails = null;
    issues.remove();
    issues.replaceChildren();
    if (groups) appendWarningGroups(issues, groups);
    if (unresolved.length) {
      const list = el(doc, 'ul');
      for (const issue of unresolved) list.append(el(doc, 'li', {}, issue));
      issues.append(el(doc, 'h4', {}, `未解决（${unresolved.length} 项）`), list);
    }
    if (issues.childElementCount) toast.insertBefore(issues, actions);
    if (raw) {
      rawDetails = el(doc, 'details', { class: 'fated-toast-raw' });
      rawDetails.append(el(doc, 'summary', {}, `模型返回结果（已应用 ${applied ?? 0} 项）`), el(doc, 'pre', {}, raw));
      toast.insertBefore(rawDetails, actions);
    }
    noticeTitle.textContent = title;
    noticeBody.textContent = detail;
    noticeBody.hidden = !detail;
    retry.hidden = !onRetry;
    dismiss.hidden = busy;
    toast.hidden = false;
  }
  panel.append(header, tabs, content, resizeHandle); root.append(launcher, panel, toast); (doc.body || doc.documentElement)?.append(root);
  const instances = (() => { try { return parseJSON(storage?.getItem(stateKey)); } catch { return null; } })();
  config.instances = isObject(instances) ? instances : {};

  function pruneBattleStorageExcept(key) {
    for (const cachedKey of openingSources.keys()) if (cachedKey !== key) openingSources.delete(cachedKey);
    return pruneStoredBattles(storage, key);
  }
  function writeWithEvictionRetry(key, value) {
    if (putConfig(storage, key, value)) return true;
    return !!activeBattleKey && pruneBattleStorageExcept(activeBattleKey).removedKeys > 0 && putConfig(storage, key, value);
  }
  const notifyStorageFailure = () => notify('数据仅在本窗口生效', '无法写入浏览器存储。请先下载战局备份；如需彻底初始化，可在实例维护点「清理脚本缓存」。');
  function save() { if (!writeWithEvictionRetry(stateKey, config.instances)) notifyStorageFailure(); }

  // Don't overwrite a failed local write on the next sync, or rewrite it during unrelated edits.
  const unsavedSettings = new Set();
  const separateSettings = new Set(['aiSessions', ...LARGE_CONFIG_KEYS]);
  function syncSettings() {
    if (!storage) return;
    const { aiSessions: _savedSessions, ...latest } = configFor(storage, configKey);
    for (const [field, value] of Object.entries(latest)) {
      if (!unsavedSettings.has(separateSettings.has(field) ? field : configKey)) config[field] = value;
    }
  }
  function persistSettings(patch, previousSlots = config.slots) {
    syncSettings();
    if (patch.slots && JSON.stringify(previousSlots) !== JSON.stringify(config.slots)) {
      renderSettings(pages.prompt, 'prompt', settingsContext());
      notify('槽位已在其他窗口更新', '已载入最新列表，请重新执行刚才的编辑。');
      return;
    }
    Object.assign(config, patch);
    const { instances: _instances, aiSessions, ...settingsWithLarge } = config;
    const settings = Object.fromEntries(Object.entries(settingsWithLarge).filter(([key]) => !LARGE_CONFIG_KEYS.includes(key)));
    const fields = [['aiSessions', `${configKey}/ai-sessions`, aiSessions],
      ...LARGE_CONFIG_KEYS.map(field => [field, separateConfigKey(configKey, field), config[field]])];
    let failed = false;
    const write = (field, key, value) => {
      if (writeWithEvictionRetry(key, value)) unsavedSettings.delete(field);
      else { unsavedSettings.add(field); failed = true; }
    };
    for (const [field, key, value] of fields) {
      if (Object.hasOwn(patch, field)) write(field, key, value);
    }
    const hasMainSettings = (() => { try { return storage?.getItem(configKey) != null; } catch { return false; } })();
    if (!hasMainSettings || Object.keys(patch).some(field => field !== 'instances' && !separateSettings.has(field))) {
      write(configKey, configKey, settings);
    }
    if (failed) notifyStorageFailure();
  }
  if (!config.aiSessions?.sessions?.length || config.aiSessions.activeId !== aiSessions.data.activeId) {
    persistSettings({ aiSessions: aiSessions.data });
  } else config.aiSessions = aiSessions.data;
  async function open() {
    if (disposed) return;
    panel.hidden = false;
    launcher.hidden = true;
    if (config.autoScan !== false) { selectedMessageId = null; selectedBattleText = ''; await scan(); }
  }
  async function openBattleEntry(messageId, battleText = '') {
    if (messageId == null && !battleText) return open();
    selectedMessageId = messageId == null ? null : String(messageId);
    selectedBattleText = battleText;
    panel.hidden = false;
    launcher.hidden = true;
    switchTab('sandbox');
    await scan({ refreshSource: true });
  }
  let panelFullscreen = false;
  let panelRestore = null;
  function setFullscreen(value) {
    panelFullscreen = Boolean(value);
    if (panelFullscreen) {
      const rect = panel.getBoundingClientRect();
      panelRestore = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: panel.style.right, bottom: panel.style.bottom };
      panel.classList.add('is-fullscreen');
      panel.style.left = '0px'; panel.style.top = '0px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.width = '100vw'; panel.style.height = '100dvh';
      fullscreen.textContent = '❐'; fullscreen.title = '还原'; fullscreen.setAttribute('aria-label', '还原');
    } else {
      panel.classList.remove('is-fullscreen');
      const restore = panelRestore;
      panelRestore = null;
      panel.style.right = restore?.right || '16px'; panel.style.bottom = restore?.bottom || '16px';
      panel.style.left = restore ? `${restore.left}px` : '';
      panel.style.top = restore ? `${restore.top}px` : '';
      panel.style.width = restore ? `${restore.width}px` : '';
      panel.style.height = restore ? `${restore.height}px` : '';
      fullscreen.textContent = '□'; fullscreen.title = '全屏'; fullscreen.setAttribute('aria-label', '全屏');
    }
  }
  function hide() { panel.hidden = true; launcher.hidden = Boolean(config.hideLauncher); }
  function bindEventBus() {
    const eventOn = hostMethod(host, 'eventOn');
    if (typeof eventOn !== 'function') return;
    const bind = (name, handler) => {
      try {
        const result = eventOn(name, handler);
        listeners.push(typeof result === 'function' ? result : typeof result?.off === 'function'
          ? () => result.off() : () => hostMethod(host, 'eventRemoveListener')?.(name, handler));
      } catch (_) { /* event bus is optional outside JS-Slash-Runner */ }
    };
    bind('fated_tactical:open_ui', entry => { openBattleEntry(entry?.messageId, text(entry?.battleText)).catch(showError); });
  }
  function closePanel() { hide(); }
  on(launcher, 'click', event => { if (launcher.dataset.dragged === 'true') { delete launcher.dataset.dragged; event.preventDefault(); return; } open(); });
  on(fullscreen, 'click', () => setFullscreen(!panelFullscreen));
  on(close, 'click', closePanel); on(minimize, 'click', hide);
  // The Tavern regex processor may inject the entry after this overlay mounts,
  // so bind the generated button through delegation instead of only binding
  // buttons created by our own DOM renderer.
  on(doc, 'click', event => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const trigger = path.find(node => node?.matches?.('[data-fated-battle-open], .fated-battle-enter'));
    if (trigger) {
      event.preventDefault(); event.stopPropagation();
      const floor = trigger.closest('[mesid], [data-message-id], [data-mesid]');
      void openBattleEntry(floor?.getAttribute('mesid') ?? floor?.dataset.messageId ?? floor?.dataset.mesid);
    }
  }, { capture: true });

  // Dragging works for both the launcher and the large window. Coordinates are
  // clamped only by CSS; no browser-specific pointer API is required.
  function draggable(node, handle) {
    const surface = handle || node;
    let drag = null;
    on(surface, 'pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = node.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    });
    on(surface, 'pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        node.style.right = 'auto'; node.style.bottom = 'auto';
        node.style.left = `${drag.left}px`; node.style.top = `${drag.top}px`;
        try { surface.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      node.style.left = `${Math.max(0, drag.left + dx)}px`;
      node.style.top = `${Math.max(0, drag.top + dy)}px`;
      event.preventDefault();
    });
    const stop = event => { if (drag?.pointerId === event.pointerId) drag = null; };
    on(surface, 'pointerup', stop); on(surface, 'pointercancel', stop); on(surface, 'lostpointercapture', stop);
  }
  function draggableLauncher() {
    let drag = null;
    const start = event => {
      if (event.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      drag = { pointerId: event.pointerId ?? null, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    };
    on(launcher, 'pointerdown', start);
    on(launcher, 'mousedown', event => { if (!drag) start(event); });
    const move = event => {
      if (!drag || (drag.pointerId != null && event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
      if (!drag.moved) {
        drag.moved = true; launcher.dataset.dragged = 'true';
        launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
        launcher.style.left = `${drag.left}px`; launcher.style.top = `${drag.top}px`;
        try { launcher.setPointerCapture?.(event.pointerId); } catch (_) {}
      }
      const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
      const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
      launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`;
      launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
      event.preventDefault();
    };
    on(doc, 'pointermove', move); on(launcher, 'pointermove', move);
    on(doc, 'mousemove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
      drag.moved = true; launcher.dataset.dragged = 'true'; launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
      const maxX = Math.max(0, (host.innerWidth || doc.documentElement.clientWidth || 0) - launcher.offsetWidth);
      const maxY = Math.max(0, (host.innerHeight || doc.documentElement.clientHeight || 0) - launcher.offsetHeight);
      launcher.style.left = `${Math.min(maxX, Math.max(0, drag.left + dx))}px`; launcher.style.top = `${Math.min(maxY, Math.max(0, drag.top + dy))}px`;
      event.preventDefault();
    });
    const stop = event => { if (drag && (drag.pointerId == null || event.pointerId == null || drag.pointerId === event.pointerId)) drag = null; };
    on(doc, 'pointerup', stop); on(doc, 'pointercancel', stop); on(doc, 'mouseup', stop); on(launcher, 'lostpointercapture', stop);
  }
  draggableLauncher();
  draggable(panel, header);
  function resizable() {
    let resize = null;
    on(resizeHandle, 'pointerdown', event => {
      if (panelFullscreen || event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      resize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      try { resizeHandle.setPointerCapture?.(event.pointerId); } catch (_) {} event.preventDefault();
    });
    on(resizeHandle, 'pointermove', event => {
      if (!resize || event.pointerId !== resize.pointerId) return;
      const vw = host.innerWidth || doc.documentElement.clientWidth || resize.width;
      const vh = host.innerHeight || doc.documentElement.clientHeight || resize.height;
      const width = Math.min(vw - 16, Math.max(480, resize.width + event.clientX - resize.x));
      const height = Math.min(vh - 16, Math.max(360, resize.height + event.clientY - resize.y));
      panel.style.width = `${width}px`; panel.style.height = `${height}px`; event.preventDefault();
    });
    const stop = event => { if (resize?.pointerId === event.pointerId) resize = null; };
    on(resizeHandle, 'pointerup', stop); on(resizeHandle, 'pointercancel', stop); on(resizeHandle, 'lostpointercapture', stop);
  }
  resizable();

  function battleEntry(raw) {
    const details = el(doc, 'details', { class: 'fated-battle-entry' });
    const summary = el(doc, 'summary', {}, '⚔ 进入战场 · 点击展开入口');
    const meta = el(doc, 'div', { class: 'fated-battle-meta' }, '已识别 battle_init · 可在控制台加载战局');
    const pre = el(doc, 'pre', { class: 'fated-battle-source' }, raw);
    const enter = el(doc, 'button', { type: 'button', class: 'fated-battle-enter' }, '打开战场控制台');
    details.append(summary, meta, pre, enter);
    return details;
  }
  function foldBattleEntries() {
    const candidates = [...doc.querySelectorAll('.mes_text, .mes_text_wrap, .mes, .chat-msg, .message, [data-content], [data-message-id], [data-mesid]')];
    const seen = new Set();
    for (const content of candidates) {
      const rootNode = content.matches?.('.mes, .chat-msg, [data-message-id], [data-mesid]') ? content.querySelector('.mes_text, .mes_text_wrap, .message, [data-content]') || content : content;
      if (!rootNode || seen.has(rootNode) || rootNode.closest('[data-fated-tavern-overlay]') || rootNode.dataset.fatedBattleFolded === 'true') continue;
      seen.add(rootNode);
      const tag = rootNode.querySelector?.('battle_init');
      if (tag) {
        tag.replaceWith(battleEntry(`<battle_init>\n${tag.textContent || ''}\n</battle_init>`));
        rootNode.dataset.fatedBattleFolded = 'true';
        continue;
      }
      const walker = doc.createTreeWalker?.(rootNode, 4);
      if (!walker) continue;
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node of textNodes) {
        const raw = node.nodeValue || '';
        const match = raw.match(/(?:<|&lt;)battle_init(?:\s[^>]*?)?(?:>|&gt;)[\s\S]*?(?:<|&lt;)\/battle_init(?:>|&gt;)/i);
        if (!match) continue;
        const replacement = doc.createDocumentFragment();
        if (match.index) replacement.append(doc.createTextNode(raw.slice(0, match.index)));
        replacement.append(battleEntry(match[0].replaceAll('&lt;', '<').replaceAll('&gt;', '>')));
        if (match.index + match[0].length < raw.length) replacement.append(doc.createTextNode(raw.slice(match.index + match[0].length)));
        node.parentNode?.replaceChild(replacement, node);
        rootNode.dataset.fatedBattleFolded = 'true';
        break;
      }
    }
  }

  function appendBattleZones(card, groups, zones) {
    const entries = Object.values(sources.zoneEntries ?? {});
    if (!entries.length) return;
    const list = el(doc, 'ul', { class: 'fated-battle-zones' });
    for (const entry of entries) {
      const { id, name, area, description, targetTeam } = entry;
      const zone = zones[id];
      const team = targetTeam === 'red' ? '仅红方' : targetTeam === 'blue' ? '仅蓝方' : '全体';
      const { rect, z1, z2 } = area;
      const horizontal = area.shape === 'board' ? '全场' : `(${rect.x1}-${rect.x2})(${rect.y1}-${rect.y2})`;
      const range = `${horizontal}${z1 !== undefined || z2 !== undefined ? `(${z1 ?? -4}-${z2 ?? 20})` : ''}`;
      const row = el(doc, 'li', { class: 'fated-battle-zone-item', 'data-zone-id': id });
      row.append(`[${team}] `, el(doc, 'strong', {}, name), ` · ${range} · `);
      const rules = zone?.rules?.length ?? 0, mods = zone?.mods?.length ?? 0;
      const path = `/zones/${id}`;
      const has = kind => groups[kind].some(({ warning }) => pathUnder(warning.originPath, path));
      const status = has('needsAttention') || has('approximated') ? '部分实现 / 待关注'
        : rules || mods ? `已编译（${rules}规则/${mods}修饰）`
          : has('nonCombat') ? '已豁免（非战斗环境）' : !zone ? '已离场' : '待标准化';
      row.append(status);
      if (rules || mods) {
        const reset = el(doc, 'button', { type: 'button', class: 'fated-entry-discard', 'data-zone-discard': id }, '重置并重roll');
        reset.disabled = Boolean(aiController);
        on(reset, 'click', () => discardStandardizedEntry(activeBattleKey, { unitId: null, path, name }));
        row.append(' ', reset);
      }
      row.append(el(doc, 'p', { class: 'fated-mini' }, description));
      list.append(row);
    }
    card.append(list);
  }
  function renderInstances() {
    diagnostics.storage = computeStorageDiagnostics(storage, activeBattleKey);
    const page = pages.instances; page.replaceChildren(el(doc, 'h3', {}, '战场入口'));
    const battleCard = el(doc, 'article', { class: 'fated-battle-card' });
    const battle = sources.battleInit;
    battleCard.append(el(doc, 'div', { class: 'fated-card-kicker' }, `命定战术控制台 v${TAVERN_VERSION} · ${battle ? 'BATTLE INIT · 已识别' : 'BATTLE INIT · 等待扫描'}`));
    battleCard.append(el(doc, 'h4', {}, battle?.sceneTitle || battle?.title || '尚未发现正文战场'));
    const zones = liveState()?.zones ?? {};
    const zoneCount = Object.keys(zones).length;
    battleCard.append(el(doc, 'p', { class: 'fated-mini' }, battle ? `${battle.battleType || '标准战斗'} · ${battle.units?.length || battle.participants?.length || 0} 名参与者 · ${battle.covers?.length || 0} 个掩体${zoneCount ? ` · ${zoneCount} 项战场效果` : ''}` : '点击扫描当前聊天，读取最新正文中的 battle_init。'));
    const globalGroups = warningGroups((sources.warnings ?? []).filter(w => w.unitId === null));
    appendBattleZones(battleCard, globalGroups, zones);
    const battleActions = el(doc, 'div', { class: 'fated-actions' });
    const loadBattle = el(doc, 'button', { type: 'button', class: 'fated-primary' }, battle ? '加载战场' : '扫描并加载');
    const showSource = el(doc, 'details', { class: 'fated-battle-source-box' });
    showSource.append(el(doc, 'summary', {}, '查看原始 battle_init'), el(doc, 'pre', { class: 'fated-battle-source' }, sources.battleRaw || '暂无原始数据'));
    const normalize = el(doc,'button',{type:'button','data-normalize':''},'标准化');
    const selected = selectedIds();
    const unitPending = selected.length ? warningGroups(warningsForUnit(sources.warnings, selected, false)).pending : [];
    const scenePending = globalGroups.pending.filter(isSceneZoneWarning);
    const canNormalize = unitPending.length > 0 || scenePending.length > 0;
    normalize.disabled = !canNormalize || !activeBattleKey || !!aiController;
    const hint = canNormalize ? scanStatus : !selected.length ? '请先勾选要标准化的角色' : '所选角色和战场均无待编译词条';
    normalize.title = hint;
    on(normalize, 'click', () => runNormalize(unitPending.length ? selected : [], { includeScene: scenePending.length > 0 }));
    appendWarningGroups(battleCard, globalGroups, true);
    battleActions.append(loadBattle, normalize);
    if (scenePending.length && unitPending.length) {
      const sceneOnly = el(doc, 'button', { type: 'button', 'data-normalize-scene': '' }, `仅标准化环境 (${scenePending.length})`);
      sceneOnly.disabled = normalize.disabled;
      on(sceneOnly, 'click', () => runNormalize([], { includeScene: true }));
      battleActions.append(sceneOnly);
    }
    battleCard.append(battleActions, el(doc,'p',{class:'fated-mini','data-normalize-status':''},hint), showSource); page.append(battleCard);
    const diag = el(doc, 'details', { class: 'fated-diagnostics' });
    diag.append(el(doc, 'summary', {}, '诊断日志（扫描来源 / 去重）'));
    diag.append(el(doc, 'pre', { class: 'fated-status', 'data-diagnostics': '' }, JSON.stringify(diagnostics, null, 2)));
    page.append(diag);
    on(loadBattle, 'click', async () => { switchTab('sandbox'); await scan(); });
    const toolbar = el(doc, 'div', { class: 'fated-actions' });
    const refresh = el(doc, 'button', { type: 'button' }, '从当前聊天重新水合'); toolbar.append(refresh); page.append(toolbar);
    const cleanup = el(doc,'button',{type:'button','data-script-reset':''},'清理脚本缓存'); toolbar.append(cleanup);
    on(cleanup,'click',()=>{
      if (!host.confirm('彻底初始化本浏览器当前站点的命定战术脚本？将删除所有聊天的沙盘战局（含当前进度）、实例、标准化结果、辅助 AI 会话与补丁、API 密钥和设置。不会删除酒馆聊天、MVU、世界书或其他脚本数据。此操作不可撤销，建议先下载快照。')) return;
      try {
        const keys = Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith('fated-tactical/'));
        for (const key of keys) storage.removeItem(key);
      } catch { notify('未完成初始化','浏览器拒绝清理存储；未重新加载。'); return; }
      dispose(); host.location.reload();
    });
    const choose = ids => { persistSettings({rosterSelection:ids}); renderInstances(); };
    for (const [label,all] of [['全选',true],['取消全选',false]]) { const b=el(doc,'button',{type:'button'},label); on(b,'click',()=>choose(all?Object.keys(config.instances):[])); toolbar.append(b); }
    // 折叠状态按实例 ID 保存，人多时可以只展开正在看的那几张
    const collapsed = () => isObject(config.collapsedInstances) ? config.collapsedInstances : {};
    const setFolded = (ids, value) => { const next = { ...collapsed() }; for (const id of ids) { if (value) next[id] = true; else delete next[id]; } persistSettings({ collapsedInstances: next }); };
    for (const [label,value] of [['全部折叠',true],['全部展开',false]]) { const b=el(doc,'button',{type:'button','data-fold-all':String(value)},label); on(b,'click',()=>{ setFolded(Object.keys(config.instances),value); renderInstances(); }); toolbar.append(b); }
    const list = el(doc, 'div'); page.append(list);
    const entries = instanceGroups(config.instances);
    if (!entries.length) list.append(el(doc, 'p', { class: 'fated-mini' }, '暂无实例。打开沙盘会自动读取当前 MVU、char_info 和 battle_init。'));
    for (const members of entries) {
      const [key] = members;
      const instance = config.instances[key];
      const box = el(doc, 'article', { class: 'fated-instance' });
      box.dataset.unitId = key;
      const select = el(doc,'input',{type:'checkbox','aria-label':`选择 ${instance.name || key}`});
      select.checked = selectedIds().includes(key);
      on(select,'change',()=>choose(select.checked?[...new Set([...selectedIds(),key])]:selectedIds().filter(k=>k!==key)));
      const groups = warningGroups(warningsForUnit(sources.warnings, [key], false));
      const { body } = fillInstance(box,(tag,attrs,value)=>el(doc,tag,attrs,value),instance,liveState(),characters[key]?.raw,select,
        { collapsed: Boolean(collapsed()[key]), warnings: groups.pending.length, attention: groups.needsAttention.length, count: members.length,
          canDiscardEntry: path => operations(activeBattleKey).some(operation => operation.path === path || operation.path.startsWith(`${path}/`)) ||
            groups.approximated.some(({ warning }) => warning.originPath === path), onDiscardEntry: ref => discardStandardizedEntry(activeBattleKey, { ...ref, unitId: key }), onToggle: value => setFolded([key], value) });
      appendWarningGroups(body, groups, true);
      const actions = el(doc, 'div', { class: 'fated-actions' }); const edit = el(doc, 'button', { type: 'button' }, '编辑 JSON'); const remove = el(doc, 'button', { type: 'button' }, '删除');
      actions.append(edit, remove); body.append(actions); list.append(box);
      remove.title = '删除本场该角色及其标准化结果；重新水合时从源数据重读';
      on(remove, 'click', () => {
        const battle = activeBattleKey;
        if (!battle || aiController) { notify('暂不可删除','请先加载战局并等待当前 AI 请求结束。'); return; }
        const deleting = new Set(members);
        const omit = record => Object.fromEntries(Object.entries(record ?? {}).filter(([id])=>!deleting.has(id)));
        const retained = batches(battle).filter(batch => ![...(batch.entries ?? []).map(([id])=>id),
          ...(batch.receipts ?? []).map(r=>r.unitId), ...(batch.ownerIds ?? []), ...Object.keys(batch.hashes ?? {})].some(id=>deleting.has(id)));
        for (const id of members) delete config.instances[id];
        if (!Object.keys(config.instances).length) {
          for (const field of ['chat-opening-patches', 'fated-tactical/battle-v1']) {
            try { storage?.removeItem(battleStorageKey(battle, field)); } catch { notifyStorageFailure(); }
          }
        }
        save(); persistSettings({ rosterSelection:selectedIds(),
          normalizationBatches:pruneBattleScopedMap({...config.normalizationBatches,[battle]:retained}, battle),
          charSnapshots:{[battle]:omit(config.charSnapshots[battle])},
          narrativeExemptions:{...config.narrativeExemptions,[battle]:(config.narrativeExemptions[battle]??[]).filter(r=>!deleting.has(r.unitId))},
          unresolvedNotes:{[battle]:omit(config.unresolvedNotes[battle])},
          pendingInstanceResets:{[battle]:true} });
        renderInstances();
      });
      on(edit, 'click', () => { const value = prompt('编辑实例 JSON', JSON.stringify(instance, null, 2)); const parsed = parseJSON(value, null); if (isObject(parsed)) { config.instances[key] = { ...parsed, id:key, source:'AI 编辑' }; save(); renderInstances(); } });
    }
    on(refresh, 'click', () => {
      if (!host.confirm('从当前聊天重新读取本场参战者？来源和转换后的技能均无变化时保留战斗进度；有变化时重建开场，并保留未变化条目的标准化结果。不会请求 AI，也不影响其他战场。')) return;
      void scan({ rehydrate: true });
    });
  }
  function switchTab(key) {
    const button = tabs.querySelector(`[data-tab="${key}"]`);
    button?.click();
  }

  let promptKind = 'validate', promptInstruction = '';
  let previewSink, lastSent = null;
  const characterEntries = () => Object.fromEntries(Object.entries(characters).map(([id,c])=>[id,c.entryValues]));
  function assemblyContext(kind = promptKind, instruction = promptInstruction, onlyUnitIds = kind === 'validate' ? selectedIds() : undefined) {
    return { kind, instruction, onlyUnitIds, characterEntries:characterEntries(), rawCharacters:Object.fromEntries(Object.entries(characters).map(([id,c])=>[id,c.raw])), state: liveState(), sources, roster: Object.values(config.instances), extraText: config.extraText };
  }
  function publishMessages(messages, kind = promptKind) {
    previewSink?.(messages, kind);
    return messages;
  }
  function prepareMessages(kind = promptKind, instruction = promptInstruction, sending = false, unitIds, warnings) {
    const slots = config.slots;
    const context = assemblyContext(kind, instruction, unitIds);
    if (kind === 'chat') context.warnings = [];
    else if (Array.isArray(warnings)) context.warnings = warnings;
    else context.sources = { ...sources, warnings: warningGroups().pending };
    const messages = assembleMessages(slots, context);
    if (config.debugPrompts) console.debug('[fated:prompts]', { kind, slots: slots.map(s => ({ id: s.id, enabled: s.enabled })),
      messages: messages.map(({ slotId, role, content }) => ({ slotId, role, chars: content.length })) });
    if (sending && messages.length) lastSent = messages;
    return publishMessages(messages, kind);
  }
  function settingsContext() {
    syncSettings();
    return { host, settings: config, slots: config.slots, assemblyContext, prepareMessages, lastSent: () => lastSent,
      onPreview(fn) { previewSink = fn; }, fetchImpl: options.fetch, save: persistSettings };
  }
  async function runNormalize(unitIds = Object.keys(characters), { includeScene = true } = {}) {
    if (aiController || !activeBattleKey || !liveState()) return;
    syncSettings();
    const key = activeBattleKey;
    const requestConfig = normalizationApiConfig(config);
    const pending = warningGroups().pending;
    const ids = [...new Set(unitIds.map(groupId))].filter(id => own(characters, id));
    const queue = planNormalizationBatches(ids, pending, liveState(), {
      includeScene, maxWarnings: normalizationLimit(requestConfig, 'normalizationWarningsPerBatch'), rawSources: characterEntries(),
    });
    if (!queue.length) return;
    const controller = new AbortController();
    aiController = controller;
    let finish;
    aiFinished = new Promise(resolve => { finish = resolve; });
    aiPage?.setBusy(true);
    renderInstances();
    let applied = 0, completed = 0, failure;
    const replies = [], unmatchedNotes = [], rejectedItems = [];
    const createdTemplates = new Map();
    const progress = detail => notify('正在标准化中…', detail ?? `已完成 ${completed} / ${queue.length} 批`, null, true);
    const request = async (batch, index, correction) => {
      const snapshot = clone(liveState());
      const warnings = batch.warnings.filter(warning => sources.warnings.includes(warning));
      let prompts = prepareMessages('validate', '', true, batch.unitIds, warnings);
      const sent = warnings.filter(warning => prompts.some(message => message.content.includes(JSON.stringify(warning.message))));
      if (!prompts.length) throw new Error('没有可发送的提示词，请在提示词组装页启用有内容的槽位');
      if (correction) {
        prompts = [...prompts, { role: 'user', content: `上一条输出无法应用（${correction.message}）。请根据此消息中的最新快照调整，重新输出完整 JSON 对象。${correction.raw ? `\n上一条输出：${correction.raw.slice(0, 3500)}` : ''}` }];
        lastSent = prompts;
        publishMessages(prompts, 'validate');
      }
      const timeout = new AbortController();
      const signal = AbortSignal.any([controller.signal, timeout.signal]);
      signal.throwIfAborted();
      const timer = setTimeout(() => timeout.abort(new Error('请求超时，请检查酒馆主接口或独立 API')), requestConfig.timeoutMs ?? 240000);
      try {
        const reply = await requestTavernAI(host, requestConfig, prompts, options.fetch, signal, (text, done, info) => {
          if (!disposed && !signal.aborted) progress(`第 ${index + 1} 批${info?.isHeartbeat ? `已等待 ${info.elapsedSec} 秒` : done ? '已收到响应，等待校验' : `已收到 ${text.length} 字符`}`);
        });
        signal.throwIfAborted();
        return { snapshot, sent, reply };
      } finally { clearTimeout(timer); }
    };
    progress();
    try {
      await runOrderedBatches(queue, normalizationLimit(requestConfig, 'normalizationConcurrency'), request, async (result, batch, index) => {
        controller.signal.throwIfAborted();
        try {
          if (result.error) throw result.error;
          const repairResult = await runNormalizationRepair({
            batch, index, result: result.value,
            commit: (repairBatch, payload, options = {}) => {
              controller.signal.throwIfAborted();
              if (key !== activeBattleKey) throw new Error('战场已切换，不应用旧战场补丁');
              return commitNormalization(key, repairBatch, payload, createdTemplates, options);
            },
            request,
            onRepair: ({ kind }) => progress(`第 ${index + 1} 批正在${kind === 'initial' ? '修正输出' : '修复拒收项'}`),
          });
          controller.signal.throwIfAborted();
          const accepted = repairResult.accepted;
          const repaired = repairResult.repaired;
          if (repaired) {
            applied += repaired.applied;
            replies.push(repaired.data);
            unmatchedNotes.push(...repaired.unmatchedNotes);
            rejectedItems.push(...repaired.rejected);
            const outstanding = new Set(repaired.missing);
            const repairedWarnings = repairWarnings(accepted);
            accepted.rejected = accepted.rejected.filter(item => {
              const related = repairedWarnings.filter(warning => rejectedWarning(item, warning));
              return !related.length || related.some(warning => outstanding.has(warning));
            });
          }
          applied += accepted.applied;
          replies.push(accepted.data);
          unmatchedNotes.push(...accepted.unmatchedNotes);
          rejectedItems.push(...accepted.rejected);
          completed++;
          progress();
        } catch (error) {
          failure ??= error;
          if (controller.signal.aborted) throw error;
          completed++;
          progress(`第 ${index + 1} 批失败；继续处理其余批次`);
        }
      }, controller.signal);
    } catch (error) { failure ??= error; }
    finally {
      const selected = new Set(ids);
      const groups = warningGroups(sources.warnings.filter(warning => isSceneZoneWarning(warning)
        ? includeScene : selected.has(warning.unitId) || ids.length > 0 && warning.unitId === null));
      const unresolved = [...rejectedItems.map(item => formatRejectedItem(item, liveState())), ...new Set(unmatchedNotes)];
      const followUp = groups.needsAttention.length + groups.nonCombat.length;
      const raw = replies.length ? JSON.stringify(replies.length === 1 ? replies[0] : replies, null, 2) : failure?.raw ?? '';
      const aborted = failure?.name === 'AbortError';
      const partial = applied > 0 && (rejectedItems.length || failure || groups.pending.length);
      const title = aborted ? '标准化已中止' : partial && rejectedItems.length
        ? `标准化部分完成（已生效 ${applied} 项，${rejectedItems.length} 项报错未应用）`
        : partial || (!failure && groups.pending.length) ? '标准化部分完成' : failure ? '标准化失败'
          : followUp ? `标准化已完成（${followUp} 项需确认或已跳过）` : '标准化完成';
      const detail = failure ? diagnosticText(failure.message ?? failure, '请求或补丁校验失败，未返回可读的错误说明') : '';
      if (!disposed && key === activeBattleKey) {
        const retry = () => key === activeBattleKey && runNormalize(ids, { includeScene });
        notify(title, detail, !aborted && groups.pending.length ? retry : null,
          false, { tone: aborted ? 'neutral' : partial || groups.pending.length && !failure ? 'warning' : failure ? 'error' : 'success', applied, unresolved, warningGroups: groups, raw });
      }
      aiController = null;
      if (!disposed) { aiPage?.setBusy(false); renderInstances(); }
      finish();
    }
  }

  const battleStorageKey = (key, field) => `fated-tactical/${key}/${field}`;
  function readBattleStorage(key, field) {
    try { return parseJSON(storage?.getItem(battleStorageKey(key, field))); }
    catch { return null; }
  }
  function battleHasProgress(snapshot) {
    return snapshot?.kind === 'battle' && (snapshot.journal?.length > 0 || snapshot.state?.logs?.length > 0);
  }
  async function hydrate(epoch, candidate, rehydrate, refreshSource = false, snapshot = null) {
    const key = candidate.battleKey;
    const preserveOpening = battleHasProgress(snapshot) || battleHasProgress(readBattleStorage(key, 'fated-tactical/battle-v1'));
    const protectedOpening = key && readBattleStorage(key, 'mvu-pre-writeback');
    const opening = (protectedOpening || (!rehydrate && (!refreshSource || preserveOpening))) && key && (openingSources.get(key) ?? readBattleStorage(key, 'opening-source'));
    const nextSources = opening ? clone(opening) : candidate;
    if (key && !opening) {
      nextSources.mvuData = clone(await readBattleVariables(host, Number(candidate.source?.messageId)));
      nextSources.protagonistName = tavernIdentity(host);
    }
    if (epoch !== scanEpoch || disposed) return null;
    const openingSource = !opening && key ? toPersistedOpeningSource(nextSources) : null;
    if (!nextSources.battleInit) {
      sources = nextSources;
      diagnostics = { phase: 'no-battle' };
      config.instances = {};
      return null;
    }
    const converter = options.converter || getGlobal(host, 'FatedTactical')?.hydrateBattleState || getGlobal(host, 'hydrateBattleState') || hydrateBattleState;
    let hydrated = null;
    let conversionError = null;
    if (typeof converter === 'function') {
      const { mvuData, charInfo, battleInit, protagonistName } = nextSources;
      const input = { mvu: mvuData, stat_data: mvuData, charInfo, battleInit, protagonistName };
      try { hydrated = await converter(input); }
      catch (error) { conversionError = error; }
    }
    if (epoch !== scanEpoch || disposed) return null;
    if (conversionError) {
      diagnostics = { phase: 'conversion-error', error: conversionError?.stack || conversionError?.message || String(conversionError), mvuKeys: Object.keys(nextSources.mvuData || {}), charCount: nextSources.charInfo?.length || 0, participantCount: nextSources.battleInit?.units?.length || nextSources.battleInit?.participants?.length || 0 };
      try { console.error('[fated-tactical] hydrate failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      throw conversionError;
    }
    sources = nextSources;
    sources.warnings = hydrated?.warnings ?? [];
    sources.sourceMap = hydrated?.sourceMap ?? {};
    sources.zoneEntries = hydrated?.zoneEntries ?? {};
    duplicatePaths = hydrated?.roster && hydrated.state ? duplicateMappings(hydrated.roster, hydrated.state) : new Map();
    sources.seed = hydrated?.seed ?? hydrated?.state?.rng;
    sources.input = { mvu: sources.mvuData, charInfo: sources.charInfo, battleInit: sources.battleInit, latestFloor: sources.latestFloor, battleText: sources.battleRaw, protagonistName: sources.protagonistName };
    if (hydrated?.roster) sources.roster = JSON.stringify(hydrated.roster, null, 2);
    const roster = hydrated?.roster || hydrated?.instances || hydrated?.units || (sources.charInfo ? [sources.charInfo] : []);
    // Instances are a projection of the latest scan, not an append-only log.
    // Keeping old entries here made a previous narrative_char_info enemy appear
    // twice and could hide the current MVU protagonist in the maintenance page.
    const nextInstances = {};
    for (const item of Array.isArray(roster) ? roster : Object.values(roster || {})) {
      const key = item.id || item.uid || item.name || `unit-${Object.keys(nextInstances).length + 1}`;
      nextInstances[key] = { ...clone(item), source: item.source || (sources.mvuData && Object.keys(sources.mvuData).length ? 'MVU 主角' : '正文 <char_info>') };
    }
    config.instances = nextInstances;
    diagnostics = {
      phase: 'hydrated',
      version: TAVERN_VERSION,
      mvuKeys: Object.keys(sources.mvuData || {}),
      protagonistName: sources.protagonistName || '',
      charCount: sources.charInfo?.length || 0,
      participantCount: sources.battleInit?.units?.length || sources.battleInit?.participants?.length || 0,
      rosterCount: Array.isArray(roster) ? roster.length : Object.keys(roster || {}).length,
      rosterIds: (Array.isArray(roster) ? roster : Object.values(roster || {})).map(item => `${item.id || item.name}:${item.source || 'unknown'}`),
      fieldSources: (Array.isArray(roster) ? roster : Object.values(roster || {})).map(item => ({ id: item.id, name: item.name, source: item.source, fieldSources: item.fieldSources })),
      instanceCount: Object.keys(config.instances).length,
      unitIds: Object.values(hydrated?.state?.units || {}).map(unit => `${unit.id}:${unit.name}:${unit.team}`),
      warnings: hydrated?.warnings || [],
    };
    return { hydrated, openingSource };
  }
  let stopTerrainNotices;
  function refreshPortraits(state, epoch) {
    const mount = gameMount;
    if (!mount?.setPortraits || !state) return;
    const isCurrent = () => !disposed && gameMount === mount && scanEpoch === epoch;
    void readBattlePortraits(host, state.units, sources.sourceMap ?? {}, isCurrent).then(portraits => {
      if (isCurrent()) mount.setPortraits(portraits);
    }).catch(() => { /* Portraits are optional. */ });
  }

  function mountState(state, restoreSaved = false) {
    stopTerrainNotices?.();
    stopTerrainNotices = undefined;
    gameMount?.unmount?.();
    gameMount = null;
    if (!state) return;
    const battleInstanceId = sources.battleKey || id;
    const battleInput = sources.input;
    const target = pages.sandbox.querySelector('[data-sandbox-mount]');
    const rebuild = ({ seed }) => {
      const opening = hydrateBaseline(battleInput, { seed });
      const normalized = applyNormalization(opening, operations(battleInstanceId));
      const next = restoreChatOpening(normalized, battleInstanceId);
      updateChatInstances(next, liveState());
      return next;
    };
    const restart = opts => {
      const bar = pages.sandbox.querySelector('[data-mvu-settlement]');
      if (bar) bar.hidden = true;
      if (!readBattleStorage(battleInstanceId, 'mvu-pre-writeback')) return rebuild(opts);
      return currentFloor().then(last => rollbackBattleOutcome({ host, storage, key: battleInstanceId, lastMessageId: last.messageId,
        assertContext: () => checkWriteContext(battleInstanceId) })).then(() => rebuild(opts));
    };
    const bar = pages.sandbox.querySelector('[data-mvu-settlement]');
    if (bar) bar.hidden = true;
    gameMount = (options.mount || defaultMount)(target, {
      instanceId: battleInstanceId, storage, state, customBattle: { seed: sources.seed, restart, restoreSaved },
      onQuotaExceeded: () => pruneBattleStorageExcept(battleInstanceId).removedKeys > 0,
      battleAiRequest: async (messages, signal) => {
        syncSettings();
        const battleConfig = config.battleAiMode === 'custom'
          ? { ...config, apiMode: 'custom', baseUrl: config.battleAiBaseUrl, apiKey: config.battleAiApiKey, model: config.battleAiModel,
              apiTransport: config.battleAiApiTransport, apiSource: config.battleAiApiSource, stream: false, max_tokens: 32000 }
          : { ...config, stream: false, max_tokens: 32000 };
        return requestTavernAI(host, battleConfig, messages, options.fetch, signal);
      },
      onVictory() {
        syncSettings();
        queueMicrotask(() => { if (!disposed && activeBattleKey === battleInstanceId) void prepareDelivery(true).catch(showError); });
      },
    });
    const game = gameMount?.api;
    if (game?.subscribe) {
      let seen = game.getBattleState().logs.length;
      stopTerrainNotices = game.subscribe(() => {
        const logs = game.getBattleState().logs;
        const unresolved = logs.slice(seen).filter(log => log.type === 'terrain_unresolved').map(log => log.text);
        seen = logs.length;
        if (unresolved.length) notify('地形效果', '', null, false, { tone: 'error', unresolved });
      });
    }
  }
  function showError(error) { const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = `错误：${error?.message || error}`; }
  function narrativeSourceFor(records) {
    return (id, entryKey) => {
      if (id !== null) return records[id]?.entryHashes?.[entryKey] ?? records[id]?.hash;
      if (entryKey?.startsWith('zones:')) return JSON.stringify(sources.zoneEntries?.[entryKey.slice(6)] ?? '');
      return JSON.stringify([sources.battleRaw, sources.mvuData, sources.charInfo]);
    };
  }
  function filterResolved(stored, records, retained = batches(activeBattleKey)) {
    const warnings = sources.warnings ??= [];
    const raw = diagnostics.inputWarnings ?? warnings;
    const exempt = activeNarrativeExemptions(raw,
      exemptionRecords(activeBattleKey, raw), narrativeSourceFor(records));
    const remaining = remainingDiagnostics(raw, stored, records, retained);
    warnings.splice(0, warnings.length, ...remaining);
    diagnostics.warnings = warnings;
    diagnostics.narrativeExemptions = exempt.map(({ warning, receipt }) => ({ ...warningReference(warning), reason: receipt.reason }));
  }
  function reconcileUnresolvedNotes(key, records, warnings, additions = [], { reset = false } = {}) {
    const previous = config.unresolvedNotes[key] ?? {};
    const next = {};
    const sourceFor = narrativeSourceFor(records);
    for (const warning of warnings) {
      const unitId = warning.unitId ?? '';
      const id = warningKey(warning);
      const source = sourceFor(warning.unitId, warningEntryKey(warning));
      if (!source) continue;
      const matching = additions.filter(note => note.warning === warning);
      const details = [...new Set(matching.map(note => note.detail).filter(Boolean))];
      const old = reset || previous[unitId]?.[id]?.source !== source ? undefined : previous[unitId][id];
      const evidence = [...(old?.evidence ?? []), ...matching.flatMap(note => note.evidence ?? [])];
      const note = details.length ? {
        source,
        effectName: diagnosticTitle(warning),
        reason: details.join('；'),
        kind: matching.find(note => note.kind)?.kind,
        ...(evidence.length ? { evidence: [...new Map(evidence)] } : {}),
      } : old;
      if (note) (next[unitId] ??= {})[id] = note;
    }
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    persistSettings({ unresolvedNotes: Object.keys(next).length ? { [key]: next } : {} });
  }
  function liveState() { return gameMount?.getState?.() ?? currentState; }
  function pathUnder(path, root) { return path === root || path?.startsWith(`${root}/`); }
  function discardStandardizedEntry(key, ref) {
    const source = ref.path;
    if (!source || !/^\/(?:equipment|skills|items|statusTemplates|zones)\/[^/]+$/.test(source)) return;
    const [, table, id] = source.split('/');
    const baseline = hydrateBaseline(sources.input);
    const current = liveState();
    if (!current?.[table] || !Object.hasOwn(current[table], id)) return;
    if (aiController) { notify('标准化进行中', '请等待当前批次完成后再重置大词条。'); return; }
    const rawWarnings = diagnostics.inputWarnings ?? [];
    const targets = [source, ...(duplicatePaths.get(source) ?? []).map(copy => copy.path)];
    const matchesTarget = path => targets.some(target => pathUnder(path, target));
    const matchedKeys = new Set(rawWarnings.filter(warning => matchesTarget(warning.originPath)).map(warningKey));
    const retained = [];
    for (const batch of batches(key)) {
      const patch = (batch.patch ?? []).filter(operation => !matchesTarget(operation.path));
      const guards = (batch.guards ?? []).filter(([path]) => !matchesTarget(path));
      const receipts = (batch.receipts ?? []).filter(receipt => !matchedKeys.has(receipt.key));
      if (patch.length || receipts.length || guards.length) retained.push({ ...batch, patch, guards, receipts });
    }
    // Restore exactly this named entry from the immutable hydrated snapshot. The
    // live state supplies combat progress and every unrelated entry, so this is
    // additive rollback rather than a battle rewind.
    const next = clone(current);
    next[table] = { ...next[table] };
    for (const target of targets) {
      const targetId = target.split('/')[2];
      if (baseline[table][targetId] === undefined) delete next[table][targetId];
      else next[table][targetId] = clone(baseline[table][targetId]);
    }
    try { (options.validateState || defaultValidateState)(next); } catch (error) { showError(error); return; }
    gameMount?.loadState?.(next);
    currentState = next;
    const sceneResets = rawWarnings.filter(warning => isSceneZoneWarning(warning) && matchedKeys.has(warningKey(warning)))
      .map(warning => ({ unitId: null, originPath: warning.originPath, key: warningKey(warning), semanticKey: semanticExemptionKey(warning),
        origin: 'manual', status: 'revoked', updatedAt: Date.now() }));
    const exemptions = [...(config.narrativeExemptions[key] ?? []).filter(receipt => !matchedKeys.has(receipt.key) &&
      !sceneResets.some(reset => reset.semanticKey === receipt.semanticKey)), ...sceneResets];
    const notes = clone(config.unresolvedNotes[key] ?? {});
    for (const [unitId, entries] of Object.entries(notes)) {
      for (const warningId of Object.keys(entries)) if (matchedKeys.has(warningId)) delete entries[warningId];
      if (!Object.keys(entries).length) delete notes[unitId];
    }
    const snapshots = clone(config.charSnapshots);
    for (const snapshot of Object.values(snapshots[key] ?? {})) {
      if (snapshot.resolvedWarnings) snapshot.resolvedWarnings = snapshot.resolvedWarnings.filter(item => !matchedKeys.has(item.key ?? item));
    }
    const nextWarnings = [...rawWarnings];
    sources.warnings = nextWarnings;
    diagnostics.warnings = nextWarnings;
    persistSettings({
      normalizationBatches: pruneBattleScopedMap({ ...config.normalizationBatches, [key]: retained }, key),
      narrativeExemptions: { ...config.narrativeExemptions, [key]: exemptions },
      unresolvedNotes: { [key]: notes },
      charSnapshots: snapshots,
    });
    filterResolved(snapshots[key] ?? {}, characters, retained);
    reconcileUnresolvedNotes(key, characters, sources.warnings, [], { reset: false });
    renderInstances();
  }
  function applyNormalization(state, patch) {
    if (!patch?.length) return state;
    const next = applyPatch(state, patch, true);
    (options.validateState || defaultValidateState)(next);
    refreshOpeningInitiative(next);
    syncEquipmentEffects(next);
    refreshOutcome(next);
    return next;
  }
  function chatOpeningPatches(key) {
    const stored = readBattleStorage(key, 'chat-opening-patches');
    return Array.isArray(stored) ? stored : [];
  }
  function replayChatPatches(state, entries, onConflict) {
    let applied = false;
    for (const { patch } of entries) {
      try {
        const next = applyPatch(state, patch, Array.isArray(patch));
        syncEquipmentEffects(next);
        refreshOutcome(next);
        (options.validateState || defaultValidateState)(next);
        state = next;
        applied = true;
      } catch (error) {
        if (!onConflict) throw error;
        onConflict(error);
      }
    }
    if (applied) refreshOpeningInitiative(state);
    return state;
  }
  function restoreChatOpening(state, key) {
    const conflicts = [];
    const next = replayChatPatches(state, chatOpeningPatches(key), error => conflicts.push(error.message));
    if (conflicts.length) notify('部分辅助 AI 补丁未能重放', '', null, false, { tone: 'warning', unresolved: conflicts });
    return next;
  }
  async function scan({ rehydrate = false, refreshSource = false } = {}) {
    const epoch = ++scanEpoch;
    const node = pages.sandbox.querySelector('[data-status]'); if (node) node.textContent = '正在读取 MVU、最新楼层并转换…';
    try {
      const chat = chatId(host);
      const messages = await tavernMessages(host);
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      let entryId = selectedMessageId;
      if (entryId == null && selectedBattleText) {
        const entryIndex = messages.findLastIndex(message => message?.role !== 'user' && !message?.is_user &&
          extractTag(stripMetaAndReasoning(messageContent(message)), ['battle_init'])?.trim() === selectedBattleText.trim());
        if (entryIndex >= 0) entryId = messageMeta(messages[entryIndex], entryIndex).messageId;
      }
      const candidate = sourceBundle({}, messages, chat, entryId);
      const key = candidate.battleKey;
      foldBattleEntries();
      if (!rehydrate && !refreshSource && key && activeBattleKey === key && gameMount) {
        refreshPortraits(currentState, epoch);
        diagnostics.storage = computeStorageDiagnostics(storage, activeBattleKey);
        const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
        if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
        if (node) node.textContent = `已续接当前战局 · ${scanStatus}`;
        return;
      }
      if ((rehydrate || activeBattleKey !== key) && aiController) {
        const finished = aiFinished;
        aiController.abort();
        await finished;
        if (epoch !== scanEpoch || disposed) return;
      }
      const snapshot = key && readBattleStorage(key, 'fated-tactical/battle-v1');
      const savedBattle = snapshot?.kind === 'battle';
      const previousOpening = rehydrate && key && (openingSources.get(key) ?? readBattleStorage(key, 'opening-source'));
      const { hydrated, openingSource } = (await hydrate(epoch, candidate, rehydrate, refreshSource, snapshot)) ?? {};
      const latestOpening = openingSource ?? (key && openingSources.get(key));
      const openingInput = opening => [opening.battleInit, opening.mvuData, opening.charInfo, opening.protagonistName];
      const unchangedOpening = previousOpening && latestOpening && stableSourceJson(openingInput(previousOpening)) === stableSourceJson(openingInput(latestOpening));
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      const nextState = hydrated?.state ?? null;
      const fresh=key ? await characterRecords(sources,hydrated) : {};
      if (epoch !== scanEpoch || disposed || chat !== chatId(host)) return;
      syncSettings();
      const ids=Object.keys(fresh), stored={...(config.charSnapshots[key]??{})};
      const removed=Object.keys(stored).filter(id=>!fresh[id]);
      diagnostics.removedCharacters=removed;
      for(const id of removed) delete stored[id];
      const rawWarnings = sources.warnings ?? [];
      diagnostics.inputWarnings = [...rawWarnings];
      // Reuse only source-bound transactions from this chat. Existing battles
      // keep their own history, including deliberate entry resets.
      const resetDeleted = Boolean(config.pendingInstanceResets?.[key]);
      const firstEntry = !resetDeleted && !rehydrate && nextState && key && !savedBattle && !own(config.normalizationBatches, key);
      const chatPrefix = `${safeKey(chat)}__`;
      const ownBatches = batches(key);
      const candidates = firstEntry && !ownBatches.length ? Object.entries(config.normalizationBatches)
        .filter(([other]) => other !== key && other.startsWith(chatPrefix))
        .reverse().flatMap(([, transactions]) => transactions.filter(batch => batch.entries?.length && !batch.receipts?.some(receipt => receipt.unitId === null) &&
          !batch.patch?.some(operation => pathUnder(operation.path, '/zones')))) : ownBatches;
      const { kept } = nextState ? replayNormalization(nextState, candidates, fresh, rawWarnings, {
        apply: applyPatch, validate: options.validateState || defaultValidateState, fingerprint: fingerprintAt,
      }) : { kept: [] };
      const imported = candidates !== ownBatches;
      const invalid = ownBatches.length !== kept.length || imported || kept.some((batch, i) => batch !== ownBatches[i]);
      const ownExemptions = config.narrativeExemptions[key] ?? [];
      const exemptionCandidates = imported ? [...ownExemptions, ...Object.entries(config.narrativeExemptions)
        .filter(([other]) => other !== key && other.startsWith(chatPrefix)).reverse()
        .flatMap(([, receipts]) => receipts.filter(receipt => receipt.unitId != null && !receipt.dismissed))] : ownExemptions;
      const activeExemptions = activeNarrativeExemptions(rawWarnings, exemptionCandidates, narrativeSourceFor(fresh));
      if (imported && activeExemptions.length) persistSettings({ narrativeExemptions: {
        ...config.narrativeExemptions, [key]: [...ownExemptions, ...activeExemptions.map(({ receipt }) => receipt)
          .filter(receipt => !ownExemptions.some(local => local.unitId === receipt.unitId && local.key === receipt.key))],
      } });
      const remaining = remainingDiagnostics(rawWarnings, stored, fresh, kept);
      toast.hidden = true;
      currentState = nextState ? applyNormalization(nextState, kept.flatMap(batch => batch.patch)) : null;
      if (currentState && (resetDeleted || rehydrate || !savedBattle)) currentState = restoreChatOpening(currentState, key);
      // Identical raw text can produce different skill mechanics after a converter fix.
      // Compare effective opening templates, not the board after turns have been played.
      const restoreSaved = !resetDeleted && battleHasProgress(snapshot) && (!rehydrate || (unchangedOpening && !invalid &&
        stableSourceJson(snapshot.origin?.skills) === stableSourceJson(currentState?.skills)));
      mountState(currentState, restoreSaved);
      activeBattleKey = currentState ? key : null;
      refreshPortraits(currentState, epoch);
      characters = fresh;
      if (activeBattleKey) {
        pruneBattleStorageExcept(key);
        if (openingSource) {
          openingSources.set(key, openingSource);
          if (!writeWithEvictionRetry(battleStorageKey(key, 'opening-source'), openingSource)) notifyStorageFailure();
        }
        const nextSettings = {
          normalizationBatches: pruneBattleScopedMap({ ...config.normalizationBatches, [key]: kept }, key),
          unresolvedNotes: own(config.unresolvedNotes, key) ? { [key]: config.unresolvedNotes[key] } : {},
          pendingInstanceResets: {},
        };
        for (const id of ids) {
          const previous = stored[id];
          stored[id] = toStoredCharSnapshot(fresh[id], rawWarnings.filter(w => w.unitId === id &&
            previous?.resolvedWarnings?.includes(warningKey(w)) && !remainingDiagnostics([w], { [id]: previous }, fresh).length).map(warningKey));
        }
        nextSettings.charSnapshots = { [key]: stored };
        const patch = Object.fromEntries(Object.entries(nextSettings).filter(([field, value]) =>
          JSON.stringify(value) !== JSON.stringify(config[field] ?? {})));
        if (Object.keys(patch).length) persistSettings(patch);
      }
      const pending = warningGroups(remaining).pending;
      const changed = normalizationCandidates(fresh, stored, pending).filter(id => groupId(id) === id);
      const sceneNeedsNorm = hasPendingSceneWarnings(pending);
      if((rehydrate || config.rosterSelection===null) && ids.length) persistSettings({rosterSelection:ids});
      filterResolved(stored, fresh, kept);
      if (key) reconcileUnresolvedNotes(key, fresh, sources.warnings, [], { reset: false });
      const live = liveState();
      if (live) updateChatInstances(live, nextState);
      scanStatus = firstEntry && (changed.length || sceneNeedsNorm) ? `待标准化 ${changed.length} 个角色${sceneNeedsNorm ? '及战场效果' : ''}` : '可手动标准化待编译词条';
      renderInstances();
      if (firstEntry && (changed.length || sceneNeedsNorm)) void runNormalize(changed, { includeScene: sceneNeedsNorm });
      if (node) node.textContent = currentState
        ? `扫描完成：${Object.values(currentState.units || {}).map(unit => `${unit.name}(${unit.id})`).join('、')} · ${scanStatus}`
        : '扫描完成（未找到可挂载的战局）。';
    } catch (e) {
      diagnostics = { ...diagnostics, phase: 'scan-error', error: e?.stack || e?.message || String(e),
        storage: computeStorageDiagnostics(storage, activeBattleKey) };
      try { console.error('[fated-tactical] scan failed', diagnostics); } catch (_) {}
      const diagnosticNode = pages.instances.querySelector('[data-diagnostics]');
      if (diagnosticNode) diagnosticNode.textContent = JSON.stringify(diagnostics, null, 2);
      showError(e);
      notify('战局加载失败', e.message, () => scan({ rehydrate }));
    }
  }
  function checkWriteContext(key) {
    if (disposed || key !== activeBattleKey || chatId(host) !== sources.source?.chatId) throw new Error('战场或聊天已切换，未写入');
  }
  async function currentFloor() {
    const rows = await tavernMessages(host);
    if (!rows.length) throw new Error('无法定位最新楼层');
    const meta = messageMeta(rows.at(-1), rows.length - 1);
    if (!Number.isSafeInteger(Number(meta.messageId))) throw new Error('无法定位最新楼层');
    return { messageId: Number(meta.messageId), swipeId: meta.swipeId };
  }
  async function prepareDelivery(automatic = false) {
    syncSettings();
    const page = pages.sandbox, bar = page.querySelector('[data-mvu-settlement]');
    bar.hidden = true;
    const state = liveState();
    const capability = probeMvuWriteCapability(host);
    if (!state?.outcome || config.mvuWritebackMode === 'off' || capability.driver === 'none') {
      if (!automatic || config.autoDeliverBattleReport !== false) await deliverBattleReport();
      return;
    }
    const key = activeBattleKey, source = sources.source;
    const patch = battleReportToMvuPatch(state, sources.sourceMap);
    if (!patch.length && !readBattleStorage(key, 'mvu-pre-writeback')) { if (!automatic || config.autoDeliverBattleReport !== false) await deliverBattleReport(); return; }
    const last = await currentFloor(), digest = await outcomeDigest(patch);
    checkWriteContext(key);
    const historical = last.messageId > Number(source.messageId);
    const selector = bar.querySelector('[data-mvu-target]'); selector.replaceChildren();
    if (historical) selector.append(el(doc, 'option', { value: 'latestFloor' }, `按战损差量写至最新楼层 #${last.messageId}`));
    selector.append(el(doc, 'option', { value: 'battleFloor' }, `仅写战斗楼层 #${source.messageId}`));
    selector.hidden = !historical;
    const button = bar.querySelector('[data-mvu-writeback]');
    const target = () => selector.value === 'latestFloor' ? last : { messageId: Number(source.messageId), swipeId: source.swipeId };
    const force = bar.querySelector('[data-mvu-refresh]');
    const update = () => {
      const receipt = writebackReceipt(storage, key), t = target();
      button.disabled = receipt?.outcomeDigest === digest && receipt.targetMessageId === t.messageId && String(receipt.targetSwipeId) === String(t.swipeId);
      force.hidden = !button.disabled;
      button.textContent = button.disabled ? '已写回 MVU ✓' : '同步至 MVU 并交付战报';
    };
    selector.onchange = update; update();
    bar.querySelector('[data-mvu-summary]').textContent = patch.map(op => {
      const labels = op.path.slice('/stat_data/'.length).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
      const before = labels.reduce((obj, k) => obj?.[k], sources.mvuData);
      return `${labels.join('/')}：${JSON.stringify(before) ?? '无'} → ${JSON.stringify(op.value) ?? '移除'}`;
    }).join(' ｜ ') || '本次无战损；将按写回前基线撤销上次战果。';
    const confirm = async (forceRefresh = false) => {
      if ((button.disabled && !forceRefresh) || force.disabled) return;
      button.disabled = force.disabled = true;
      try {
        checkWriteContext(key);
        if (!liveState()?.outcome || await outcomeDigest(battleReportToMvuPatch(liveState(), sources.sourceMap)) !== digest) throw new Error('战果已变更，请重新确认');
        const t = target(), latest = await currentFloor();
        if (latest.messageId !== last.messageId) throw new Error('最新楼层已变更，请重新确认写回目标');
        await writeBattleOutcome({ storage, host, key, battleId: state.battleId ?? key, source, opening: sources.mvuData, patch,
          targetMessageId: t.messageId, targetSwipeId: t.swipeId, force: forceRefresh, assertContext: () => checkWriteContext(key) });
        checkWriteContext(key); update(); await deliverBattleReport();
      } catch (error) { update(); showError(error); }
      finally { force.disabled = false; }
    };
    force.onclick = () => confirm(true);
    button.onclick = () => confirm(); bar.hidden = false;
    if (automatic && config.autoDeliverBattleReport !== false && config.mvuWritebackMode === 'auto' && !historical) await confirm();
  }
  async function deliverBattleReport() {
    const mount = gameMount;
    try {
      let result = mount?.exportBattleReportText?.() || options.game?.exportBattleReportText?.();
      if (!result?.trim()) throw new Error('当前没有可交付的战报。');
      const receipt = activeBattleKey && writebackReceipt(storage, activeBattleKey);
      if (receipt && receipt.outcomeDigest === await outcomeDigest(battleReportToMvuPatch(liveState(), sources.sourceMap))) {
        result += `\n（注：本场战斗结算后的生命/法力/体力、装备计数与消耗品变动已同步写入楼层 #${receipt.targetMessageId} 状态变量，请基于最新变量面板续写剧情，无需在 <UpdateVariable> 中重复扣减本场已结算战损。）`;
      }
      if (disposed || gameMount !== mount) return;
      const textarea = doc.querySelector('#send_textarea');
      const clipboard = doc.defaultView?.navigator?.clipboard;
      if (textarea) {
        textarea.value = result;
        textarea.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        clipboard?.writeText(result).catch(() => {});
      } else {
        if (!clipboard) throw new Error('找不到聊天输入框，也无法写入剪贴板。');
        await clipboard.writeText(result);
      }
      if (disposed || gameMount !== mount) return;
      pages.sandbox.querySelector('[data-status]').textContent = result;
      closePanel();
    } catch (error) {
      showError(error);
    }
  }
  function renderSandbox() {
    const page = pages.sandbox; page.replaceChildren(el(doc, 'h3', {}, '沙盘'));
    const status = el(doc, 'div', { class: 'fated-status', 'data-status': '' }, '打开此页会自动侦测当前聊天。'); page.append(status);
    const mountTarget = el(doc, 'div', { 'data-sandbox-mount': '' }); page.append(mountTarget);
    const actions = el(doc, 'div', { class: 'fated-actions' }); const report = el(doc, 'button', { type: 'button' }, '战报交付'); const refresh = el(doc, 'button', { type: 'button' }, '重新扫描'); actions.append(report, refresh); page.append(actions);
    const autoDeliver = el(doc, 'input', { type: 'checkbox', 'data-auto-deliver-report': '' });
    autoDeliver.checked = config.autoDeliverBattleReport !== false;
    const deliveryLabel = el(doc, 'label');
    deliveryLabel.append(autoDeliver, ' 胜负已定时自动交付战报');
    actions.append(deliveryLabel);
    on(autoDeliver, 'change', () => persistSettings({ autoDeliverBattleReport: autoDeliver.checked }));
    const hideLauncher = el(doc, 'input', { type: 'checkbox', 'data-hide-launcher': '' });
    hideLauncher.checked = Boolean(config.hideLauncher);
    const hideLabel = el(doc, 'label');
    hideLabel.append(hideLauncher, ' 隐藏悬浮按钮到魔术棒菜单');
    actions.append(hideLabel);
    on(hideLauncher, 'change', () => { persistSettings({ hideLauncher: hideLauncher.checked }); updateMagic(); });
    on(refresh, 'click', () => scan().catch(showError));
    const settlement = el(doc, 'section', { 'data-mvu-settlement': '', hidden: '' });
    const plain = el(doc, 'button', { type: 'button', 'data-mvu-deliver-only': '' }, '仅交付战报');
    settlement.append(el(doc, 'p', { 'data-mvu-summary': '' }), el(doc, 'select', { 'aria-label': '写回目标楼层', 'data-mvu-target': '' }),
      el(doc, 'button', { type: 'button', 'data-mvu-writeback': '' }, '同步至 MVU 并交付战报'), plain,
      el(doc, 'button', { type: 'button', 'data-mvu-refresh': '', hidden: '' }, '按基线重刷本次战果'));
    page.append(settlement);
    on(plain, 'click', deliverBattleReport);
    on(report, 'click', () => prepareDelivery().catch(showError));
  }
  function commitNormalization(key, { unitIds, sceneZoneIds = [] }, { snapshot, sent, reply }, createdTemplates, { acceptPartial = false } = {}) {
    const current = liveState();
    const records = Object.fromEntries(unitIds.map(id => [id, characters[id]]));
    const accepted = acceptNormalizationResponse({
      reply, snapshot, sent, unitIds, current,
      baseline: hydrateBaseline(sources.input),
      existingOps: operations(key),
      createdTemplates,
      records,
      sourceFor: narrativeSourceFor(records),
      duplicateOperations: operation => duplicateOperations(operation, duplicatePaths),
      apply: options.applyPatch ?? applyPatch,
      validate: options.validateState || defaultValidateState,
      normalize: state => { refreshOpeningInitiative(state); syncEquipmentEffects(state); refreshOutcome(state); },
      acceptPartial,
    });
    const { data, notes, unmatchedNotes, rejected, missing, repairWarnings: rejectedWarnings,
      repairError, baseline, before, next, effective, patch, solved, verified, narrative } = accepted;
    const additions = [];
    if (patch.length || verified.length) {
      const validate = options.validateState || defaultValidateState;
      validate(next);
      validate(applyNormalization(baseline, [...operations(key), ...patch]));
      additions.push(...normalizationTransactions({ patch, solved, verified, records: characters, before, fingerprint: fingerprintAt,
        linkedRoots: effective.map(operation => [operation.path, ...duplicateOperations(operation, duplicatePaths).map(copy => copy.path)]) }).map(batch =>
        batch.entries.length || batch.receipts.length ? batch : { ...batch, ownerIds: [...unitIds] }));
      if (patch.length) {
        refreshOpeningInitiative(next);
        syncEquipmentEffects(next);
        refreshOutcome(next);
        validate(next);
        if (typeof gameMount?.loadState !== 'function') throw new Error('沙盘未就绪，无法注入补丁');
        gameMount.loadState(next);
        currentState = next;
        for (const unit of Object.values(next.units)) config.instances[unit.id] = { ...config.instances[unit.id], ...unit };
        save();
      }
    }
    const stored = { ...config.charSnapshots[key] };
    for (const [id, record] of Object.entries(records)) {
      const previous = stored[id]?.hash === record.hash ? stored[id].resolvedWarnings : undefined;
      stored[id] = toStoredCharSnapshot(record, previous);
    }
    syncSettings();
    const receipts = narrative.map(({ warning, receipt }) => isSceneZoneWarning(warning)
      ? { ...receipt, originPath: warning.originPath, updatedAt: Date.now() } : receipt);
    const previousExemptions = config.narrativeExemptions[key] ?? [];
    persistSettings({
      charSnapshots: { [key]: stored },
      normalizationBatches: pruneBattleScopedMap({ ...config.normalizationBatches, [key]: [...batches(key), ...additions] }, key),
      narrativeExemptions: { ...config.narrativeExemptions, [key]: [...previousExemptions.filter(previous => !receipts.some(receipt => receipt.unitId === previous.unitId && receipt.key === previous.key)), ...receipts] },
    });
    for (const operation of effective) {
      if (operation.op === 'add' && /^\/(?:statusTemplates|skills)\/[^/]+$/.test(operation.path) && fingerprintAt(current, operation.path) === undefined) {
        const fingerprint = fingerprintAt(next, operation.path);
        if (fingerprint !== undefined) createdTemplates.set(operation.path, fingerprint);
      }
    }
    filterResolved(stored, characters);
    reconcileUnresolvedNotes(key, characters, sources.warnings, notes);
    scanStatus = `已标准化 ${unitIds.length} 个角色${sceneZoneIds.length ? `、${sceneZoneIds.length} 项战场效果` : ''}`;
    renderInstances();
    return { applied: effective.length, data, unmatchedNotes, rejected, missing, repairWarnings: rejectedWarnings, repairError };
  }
  function updateChatInstances(next, previous) {
    for (const id of Object.keys(previous?.units ?? {})) if (!own(next.units, id)) delete config.instances[id];
    for (const unit of Object.values(next.units)) {
      const metadata = { ...config.instances[unit.id] };
      for (const key of Object.keys(previous?.units?.[unit.id] ?? {})) delete metadata[key];
      config.instances[unit.id] = { ...metadata, ...clone(unit) };
    }
    save();
  }

  function changeChatPatch(message, payload, undo = false) {
    if (aiController) return;
    const sessionId = aiSessions.active().id;
    if (!aiSessions.active().messages.includes(message) || message.status !== 'ok' || Boolean(message.undoReceipt) !== undo) return;
    try {
      const current = liveState();
      if (!activeBattleKey || !current || typeof gameMount?.loadState !== 'function') throw new Error('当前没有已加载的沙盘战局，请先扫描或进入战局');
      if (undo && message.undoReceipt.battleKey !== activeBattleKey) throw new Error('请返回应用补丁时的战局');
      const patch = undo ? chatInversePatch(current, message.undoReceipt.changes) : chatPatch(current, payload);
      const next = applyPatch(current, patch, Array.isArray(patch));
      if (!undo) {
        syncEquipmentEffects(next);
        refreshOutcome(next);
        if (!chatUndoChanges(current, next).length) throw new Error('此补丁没有改变当前战局');
      }
      (options.validateState || defaultValidateState)(next);
      const key = activeBattleKey;
      const entries = chatOpeningPatches(key);
      let nextEntries = entries;
      let openingId = null;
      let openingError;
      const validateOpening = records => {
        const savedSeed = storage?.getItem(battleStorageKey(key, 'fated-tactical/battle-v1/seed'));
        const seed = savedSeed != null && /^\d+$/.test(savedSeed) ? Number(savedSeed) : sources.seed;
        const source = hydrateBaseline(sources.input, { seed });
        return replayChatPatches(applyNormalization(source, operations(key)), records);
      };
      if (undo && message.undoReceipt.openingId) {
        nextEntries = entries.filter(entry => entry.id !== message.undoReceipt.openingId);
        // Later patches may depend on a template or unit added by this one.
        validateOpening(nextEntries);
      } else if (!undo) {
        try {
          openingId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
          nextEntries = [...entries, { id: openingId, patch }];
          validateOpening(nextEntries);
        } catch (error) {
          nextEntries = entries;
          openingId = null;
          openingError = error.message;
        }
      }
      const storageKey = battleStorageKey(key, 'chat-opening-patches');
      const persisted = nextEntries === entries || writeWithEvictionRetry(storageKey, nextEntries);
      if (undo && !persisted) throw new Error('无法更新浏览器中的开场补丁，未撤销');
      try { gameMount.loadState(next); }
      catch (error) {
        if (nextEntries !== entries && persisted && !writeWithEvictionRetry(storageKey, entries)) notifyStorageFailure();
        throw error;
      }
      currentState = liveState();
      updateChatInstances(currentState, current);
      renderInstances(); prepareMessages();
      const undoReceipt = undo ? null : { battleKey: key, changes: chatUndoChanges(current, currentState), openingId };
      const applyNotice = undo ? '✓ 已撤销' : openingError
        ? `✓ 已应用至当前战局，重开时重置（${openingError}）`
        : persisted
          ? '✓ 已应用至当前战局，重开时保留'
          : '✓ 已应用至当前战局，但浏览器存储失败，重载或重开后可能丢失';
      aiSessions.update(sessionId, message, { undoReceipt, applyError: null, applyNotice });
    } catch (error) {
      aiSessions.update(sessionId, message, { applyError: `${undo ? '撤销' : '应用'}失败：${error.message}` });
    }
    aiPage.feed(sessionId, message);
  }

  async function copyChatText(text) {
    try {
      await doc.defaultView.navigator.clipboard.writeText(text);
      return;
    } catch {
      // SillyTavern may be opened over plain HTTP on a LAN address.
    }
    const previousFocus = doc.activeElement;
    const field = el(doc, 'textarea', { readonly: '', tabindex: '-1' });
    field.value = text;
    field.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0';
    doc.body.append(field);
    try {
      field.select();
      if (!doc.execCommand?.('copy')) throw new Error('无法访问剪贴板');
    } finally {
      field.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
  }

  function regenerateChat(prepare) {
    if (aiController) return;
    const id = aiSessions.active().id;
    const turn = prepare(id);
    if (!turn) return;
    aiPage.render();
    askChat(turn.userMessage.content, id, turn);
  }
  async function askChat(requestText, sessionId = aiSessions.active().id, rerollTurn) {
    const session = aiSessions.get(sessionId);
    if (aiController || !requestText || !session) return;
    syncSettings();
    promptKind = 'chat';
    promptInstruction = requestText;
    const history = (rerollTurn?.historyBeforeUser ?? session.messages).filter(message =>
      ['user', 'assistant'].includes(message.role) && message.content?.trim() && !['error', 'aborted'].includes(message.status)
    ).map(({ role, content }) => ({ role, content }));
    const entries = rerollTurn ? [rerollTurn.userMessage, rerollTurn.assistantMessage] : aiSessions.append(session.id,
      { role: 'user', content: requestText, status: 'ok' }, { role: 'assistant', content: '' });
    const assistant = entries[1];
    const update = (fields, persist) => {
      if (persist) aiSessions.update(session.id, assistant, fields);
      else Object.assign(assistant, fields);
      aiPage?.feed(session.id, assistant);
    };
    aiPage?.feed(session.id, ...entries);
    const key = activeBattleKey;
    const controller = new AbortController();
    aiController = controller;
    let finish;
    aiFinished = new Promise(resolve => { finish = resolve; });
    aiPage?.setBusy(true);
    renderInstances();
    toast.hidden = true;
    const timeout = setTimeout(() => controller.abort(new Error('请求超时，请检查酒馆主接口或独立 API')), config.timeoutMs ?? 240000);
    try {
      const prompts = [...prepareMessages('chat', requestText, true), ...history, { role: 'user', content: requestText }];
      lastSent = prompts;
      publishMessages(prompts, 'chat');
      const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      const reply = await Promise.race([requestTavernAI(host, config, prompts, options.fetch, controller.signal, snapshot => {
        if (snapshot && !disposed && !controller.signal.aborted && activeBattleKey === key) update({ content: snapshot }, false);
      }), cancelled]);
      controller.signal.throwIfAborted();
      if (!disposed && activeBattleKey === key) update({ content: reply, status: 'ok' }, true);
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      if (!disposed) update({ status: aborted ? 'aborted' : 'error', content: aborted ? assistant.content
        : [assistant.content, `错误：${diagnosticText(error?.message ?? error, '请求失败')}`].filter(Boolean).join('\n\n') }, true);
    } finally {
      clearTimeout(timeout);
      if (aiController === controller) aiController = null;
      if (!disposed) { aiPage?.setBusy(false); renderInstances(); }
      finish();
    }
  }
  function updateMagic() {
    launcher.hidden = Boolean(config.hideLauncher) || !panel.hidden;
    const wand = doc.querySelector('#extensionsMenu, #data_bank_wand_container'); if (!wand) return;
    let entry = wand.querySelector('[data-fated-tavern-entry]');
    if (config.hideLauncher) { if (!entry) { entry = el(doc, 'button', { type: 'button', 'data-fated-tavern-entry': '' }, '🪄 命定战术控制台'); wand.append(entry); on(entry, 'click', open); } }
    else entry?.remove();
    // Do not call replaceScriptButtons() without its required button array. The
    // native launcher is already mounted; the optional magic-wand entry above is
    // deliberately managed as a normal DOM button.
  }
  renderInstances(); renderSandbox();
  aiPage = mountAiPage(pages.ai, { make: (tag, attrs, content) => el(doc, tag, attrs, content), on, sessions: aiSessions,
    send: message => askChat(message),
    reroll: message => regenerateChat(id => aiSessions.prepareReroll(id, message)),
    editMessage: (message, content) => regenerateChat(id => aiSessions.prepareEdit(id, message, content)),
    applyJson: changeChatPatch,
    undoJson: message => changeChatPatch(message, undefined, true),
    copyText: copyChatText,
    extractJson: text => { const candidate = preferredJson(text); return candidate ? [candidate] : []; }, stop: () => aiController?.abort(new DOMException('已取消', 'AbortError')) });
  updateMagic();
  bindEventBus();
  foldBattleEntries();
  if (typeof MutationObserver === 'function' && doc.body) {
    battleObserver = new MutationObserver(() => foldBattleEntries());
    battleObserver.observe(doc.body, { childList: true, subtree: true });
  }
  const api = { version: TAVERN_VERSION, open, close: closePanel, dispose, scan, getConfig: () => clone(config), getDiagnostics: () => clone(diagnostics), buildAIRequest, requestAI, parseAIResponse, parseJSONPatch, extractJsonBlocks, getSources: () => clone(sources), getState: () => { const state = clone(liveState()); if (state) Object.defineProperty(state,'warnings',{value:clone(sources.warnings ?? [])}); return state; } };
  function dispose() {
    if (disposed) return; disposed = true; stopTerrainNotices?.(); aiController?.abort(); battleObserver?.disconnect(); try { controller?.abort(); } catch (_) {} for (const remove of listeners.splice(0)) remove(); try { gameMount?.unmount?.(); } catch (_) {} root.remove(); try { if (host.__fatedTacticalTavern === api) delete host.__fatedTacticalTavern; } catch (_) {} }
  try { host.__fatedTacticalTavern = api; } catch (_) {}
  if (options.open) open();
  return api;
}
export const mount = mountTavernOverlay;
export { hydrateBattleState };
export default mountTavernOverlay;
