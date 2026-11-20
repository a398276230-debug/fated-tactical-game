import { initializeUI } from './main.js';
import { TEMPLATE } from './template.js';
import { createGameAPI } from '../api/game_api.js';

if (typeof document !== 'undefined') {
  const target = document.body;
  if (target && !target.dataset.fatedStandalone) {
    target.dataset.fatedStandalone = 'true';
    const root = document.createElement('div');
    root.className = 'fated-tactical-root';
    root.dataset.dlcTheme = document.documentElement.dataset.dlcTheme || 'amethyst';
    root.innerHTML = TEMPLATE;
    root.querySelector('.ft-app')?.classList.add('ft-fullscreen');
    target.append(root);
    const game = createGameAPI();
    window.FatedTacticalGame = game;
    initializeUI(root, { game, signal: new AbortController().signal });
  }
}
