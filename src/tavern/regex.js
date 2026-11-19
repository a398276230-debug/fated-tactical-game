/*
 * SillyTavern regex-script companion for battle_init.
 *
 * Apply this rule to assistant message output (AI response), before normal
 * markdown rendering. The replacement is intentionally only a marker card;
 * overlay.js owns the click handler and opens the console safely.
 */
export const BATTLE_INIT_DISPLAY_REGEX = /<battle_init\b[^>]*>([\s\S]*?)<\/battle_init>/gi;
export const BATTLE_INIT_DISPLAY_REPLACEMENT =
  '<details class="fated-battle-entry" data-fated-battle-entry="true">' +
  '<summary>⚔ 进入战场 · 点击展开入口</summary>' +
  '<div class="fated-battle-meta">已识别 battle_init · 可在控制台加载战局</div>' +
  '<pre class="fated-battle-source">$1</pre>' +
  '<button type="button" class="fated-battle-enter" data-fated-battle-open="true">打开战场控制台</button>' +
  '<script>(function(){var b=document.currentScript.previousElementSibling;if(!b)return;b.addEventListener("click",function(){if(typeof eventEmit==="function")eventEmit("fated_tactical:open_ui",{source:"battle_init"});});})();</script>' +
  '</details>';

export const BATTLE_INIT_DISPLAY_RULE = Object.freeze({
  id: 'fated-tactical-battle-init-display',
  name: '命定战术：battle_init 战场入口',
  find: BATTLE_INIT_DISPLAY_REGEX.source,
  replace: BATTLE_INIT_DISPLAY_REPLACEMENT,
  flags: 'gmi',
  placement: 'ai',
  disabled: false,
});

export function renderBattleInitEntry(source) {
  return String(source ?? '').replace(BATTLE_INIT_DISPLAY_REGEX, BATTLE_INIT_DISPLAY_REPLACEMENT);
}
