import { mount } from '../ui/mount.js';
import { hydrateFromSources, buildMvuJsonPatch } from './converter.js';
import { validateState } from '../api/validation.js';
import { mountTavernOverlay } from './overlay.js';
export { BATTLE_INIT_DISPLAY_REGEX, BATTLE_INIT_DISPLAY_REPLACEMENT, BATTLE_INIT_DISPLAY_RULE, renderBattleInitEntry } from './regex.js';

if (typeof window !== 'undefined') {
  const host = (() => { try { return window.parent?.document ? window.parent : window; } catch { return window; } })();
  mountTavernOverlay({ host, mount, hydrateFromSources, validateState, buildMvuJsonPatch });
}

export { mountTavernOverlay };
