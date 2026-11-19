import { mountTavernOverlay } from './overlay.js';

if (typeof window !== 'undefined') {
  const host = (() => { try { return window.parent?.document ? window.parent : window; } catch { return window; } })();
  mountTavernOverlay({ host });
}

export { mountTavernOverlay };
