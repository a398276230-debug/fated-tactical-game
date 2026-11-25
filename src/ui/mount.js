import { createGameAPI } from '../api/game_api.js';
import { TEMPLATE } from './template.js';
import { initializeUI } from './main.js';
import { battleTheme, tacticalUI } from './styles.js';

const STYLE_ID = 'data-fated-tactical-style';
const themes = ['amethyst', 'night-gold', 'frost-silver'];

function resolveContainer(container) {
  if (typeof container === 'string') return document.querySelector(container);
  return container;
}
export const GLOBAL_UI_PREF_KEYS = new Set(['zoom', 'theme', 'anim', 'auto', 'llm-enemy-ai', 'ai-speed']
  .map(key => `fated-tactical/${key}`));

export function storageAdapter(source, prefix, onQuotaExceeded) {
  const resolveKey = key => GLOBAL_UI_PREF_KEYS.has(key) ? key : `${prefix}/${key}`;
  return {
    getItem(key) { return source?.getItem(resolveKey(key)) ?? null; },
    setItem(key, value) {
      if (!source) throw new Error('浏览器存储不可用');
      const resolvedKey = resolveKey(key);
      try { source.setItem(resolvedKey, value); }
      catch (error) {
        if (error.name !== 'QuotaExceededError' || !onQuotaExceeded?.(resolvedKey)) throw error;
        source.setItem(resolvedKey, value);
      }
    },
    removeItem(key) { source?.removeItem(resolveKey(key)); },
  };
}
function injectStyle(doc) {
  if (doc.querySelector(`style[${STYLE_ID}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ID, '');
  // The UI is mounted in a marked root and all layout selectors are constrained
  // by this wrapper. Theme variables remain local to the root rather than :root.
  const css = `${battleTheme}\n${tacticalUI}`
    .replace(/(^|\})\s*:root(?:\[data-dlc-theme="([^"]+)"\])?/g, (_, lead, theme) => `${lead}.fated-tactical-root${theme ? `[data-dlc-theme="${theme}"]` : ''}`)
    .replace(/(^|\})\s*(body|html)\b/g, '$1.fated-tactical-root')
    .replace(/(^|\})\s*#output-container/g, '$1.fated-tactical-root #output-container');
  style.textContent = css;
  (doc.head || doc.documentElement).append(style);
}

export function mount(container, options = {}) {
  const target = resolveContainer(container);
  if (!target || !target.appendChild) throw new TypeError('mount(container): container must be an HTMLElement or selector');
  const existing = target.querySelector(':scope > .fated-tactical-root[data-fated-mounted="true"]');
  if (existing?.__fatedUnmount) existing.__fatedUnmount();
  const doc = target.ownerDocument || document;
  injectStyle(doc);
  const root = doc.createElement('div');
  root.className = 'fated-tactical-root';
  root.dataset.fatedMounted = 'true';
  root.dataset.dlcTheme = themes.includes(options.theme) ? options.theme : 'amethyst';
  root.innerHTML = TEMPLATE;
  target.append(root);
  const controller = new AbortController();
  const prefix = `fated-tactical/${options.instanceId || 'default'}`;
  let source = options.storage;
  try { source ??= doc.defaultView?.localStorage; } catch { /* storage is disabled */ }
  const storage = storageAdapter(source, prefix, options.onQuotaExceeded);
  const api = options.api || createGameAPI();
  const ui = initializeUI(root, { ...options, initialState: options.state ?? options.initialState, game: api, storage, signal: controller.signal });
  let active = true;
  const result = {
    api,
    unmount() { if (!active) return; active = false; controller.abort(); ui.destroy?.(); root.remove(); },
    destroy() { result.unmount(); },
    loadState(state) { return ui.loadState(state); },
    setPortraits(portraits) { if (active) ui.setPortraits(portraits); },
    getState: ui.getState,
    exportBattleReportText: ui.exportBattleReportText,
    exportMvuPatch: ui.exportMvuPatch,
    root,
  };
  root.__fatedUnmount = result.unmount;
  return result;
}

export function mountStyles(document = globalThis.document) { if (document) injectStyle(document); }
export { STYLE_ID };
