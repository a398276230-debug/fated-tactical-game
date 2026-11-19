import { initializeUI } from './main.js';
import { createGameAPI } from '../api/game_api.js';

if (typeof document !== 'undefined') {
  const target = document.body;
  if (target && !target.dataset.fatedStandalone) {
    target.dataset.fatedStandalone = 'true';
    const game = createGameAPI();
    window.FatedTacticalGame = game;
    initializeUI(target, { game, signal: new AbortController().signal });
  }
}
