import { mount } from '../ui/mount.js';
import { hydrateFromSources, buildMvuJsonPatch } from './converter.js';
import { validateState } from '../api/validation.js';
import { mountTavernOverlay } from './overlay.js';

if (typeof window !== 'undefined') {
  const host = (() => { try { return window.parent?.document ? window.parent : window; } catch { return window; } })();
  mountTavernOverlay({ host, mount, hydrateFromSources, validateState, buildMvuJsonPatch });
}

export { mountTavernOverlay };
