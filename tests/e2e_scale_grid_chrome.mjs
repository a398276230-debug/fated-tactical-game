import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('Chrome UI: dynamic rectangle, scale badge, stacked units, exact target picker', { timeout: 30000 }, async t => {
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
      if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)];
      res.writeHead(200, { 'Content-Type': `${type ?? 'application/octet-stream'}; charset=utf-8` }).end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
  const profile = await mkdtemp(join(tmpdir(), 'fated-scale-chrome-'));
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let socket;
  t.after(async () => { socket?.close(); child.kill(); server.close(); await pause(300); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await pause(50); } }
  assert.ok(port, 'Chrome CDP port');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveSocket, reject) => { socket.addEventListener('open', resolveSocket, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0; const responses = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (!message.id) return; const pending = responses.get(message.id); responses.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolveCall, reject) => { const id = ++serial; responses.set(id, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const run = async expression => { for (let i = 0; i < 100; i++) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); if (result.result?.value !== undefined) return result.result.value; await pause(50); } throw new Error(`timeout: ${expression}`); };
  for (let i = 0; i < 100 && !(await run('document.readyState === "complete" && !!window.FatedTacticalGame')); i++) await pause(30);
  assert.ok(await run('!!window.FatedTacticalGame'), 'standalone UI loaded');
  await run(`(() => {
    const game = window.FatedTacticalGame;
    const state = game.getBattleState();
    const floor = () => ({ kind: 'floor', z: 0 });
    state.grid = Array.from({ length: 12 }, () => Array.from({ length: 14 }, floor));
    state.scale = { cellM: 50, width: 14, height: 12, anchorTier: 5, explicit: true };
    const units = Object.values(state.units);
    const actor = state.units[state.order[state.turn]];
    actor.x = 2; actor.y = 2; actor.team = 'blue';
    const enemies = units.filter(unit => unit.id !== actor.id).slice(0, 2);
    enemies.forEach(unit => { unit.x = 3; unit.y = 2; unit.team = 'red'; });
    for (const unit of units.filter(unit => unit.id !== actor.id && !enemies.includes(unit))) { unit.x = 10; unit.y = 9; }
    const playAction = game.playAction.bind(game);
    game.playAction = command => { window.__scaleTargetCommand = command; return playAction(command); };
    game.createBattle({ kind: 'custom_state', state });
    return true;
  })()`);
  const waitFor = async expression => { for (let i = 0; i < 100; i++) { const value = await run(expression); if (value) return value; await pause(30); } throw new Error(`timeout: ${expression}`); };
  await waitFor('document.querySelectorAll("#board .tactical-cell").length === 168 && document.querySelector("#board .tactical-cell[data-x=\\"3\\"][data-y=\\"2\\"] .tactical-cell-units").dataset.stack === "2"');
  assert.equal(await run('document.querySelector("#round-badge").textContent'), '第 1 回合 · 14×12 · 1格=50m (700m×600m)');
  assert.equal(await run('document.querySelector("#board .tactical-cell[data-x=\\"3\\"][data-y=\\"2\\"] .tactical-cell-units").dataset.stack'), '2');
  assert.equal(await run('document.querySelectorAll("#board .tactical-cell[data-x=\\"3\\"][data-y=\\"2\\"] [data-unit-id]").length'), 2);
  await run('(() => { document.querySelector("#board .tactical-cell[data-x=\\"3\\"][data-y=\\"2\\"]").click(); return true; })()');
  await waitFor('!document.querySelector("#target-actions").hidden');
  assert.equal(await run('document.querySelectorAll("#target-unit-options [data-target-id]").length'), 2);
  const targetIds = await run('[...document.querySelectorAll("#target-unit-options [data-target-id]")].map(button => button.dataset.targetId)');
  const targetId = targetIds[1];
  await run(`(() => { document.querySelector('#target-unit-options [data-target-id="${targetId}"]').click(); return true; })()`);
  await run('(() => { document.querySelector("#action-toolbar [data-action=\\"attack\\"]")?.click(); return true; })()');
  await waitFor('!document.querySelector("#confirm-action").hidden');
  assert.equal(await run('document.querySelector("#target-unit-options [aria-pressed=\\"true\\"]")?.dataset.targetId'), targetId);
  assert.equal(await run('document.querySelector("#board .tactical-cell[data-x=\\"3\\"][data-y=\\"2\\"] [data-unit-id][aria-pressed=\\"true\\"]")?.dataset.unitId'), targetId);

  for (const [count, withInteractive] of [[2, false], [3, false], [4, false], [1, true], [2, true]]) {
    const layout = await run(`(() => {
      const game = window.FatedTacticalGame;
      const state = game.getBattleState();
      const actorId = state.order[state.turn];
      const others = Object.values(state.units).filter(unit => unit.id !== actorId);
      others.forEach((unit, index) => {
        if (index < ${count}) Object.assign(unit, { x: 3, y: 2 });
        else if (unit.x === 3 && unit.y === 2) Object.assign(unit, { x: 10, y: 9 });
      });
      if (${withInteractive}) Object.assign(Object.values(state.interactives)[0], { x: 3, y: 2 });
      game.createBattle({ kind: 'custom_state', state });
      const stack = document.querySelector('#board .tactical-cell[data-x="3"][data-y="2"] .tactical-cell-units');
      const rect = element => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const cards = [...stack.children].map(rect);
      const hitCell = cards.every(card => document.elementFromPoint(card.left + card.width / 2, card.top + card.height / 2)?.closest('.tactical-cell') === stack.parentElement);
      return { box: rect(stack), cards, hitCell };
    })()`);
    const { box, cards } = layout;
    assert.equal(cards.length, count + Number(withInteractive));
    assert.ok(layout.hitCell, 'clicking a shared card still activates its cell');
    for (const card of cards) {
      assert.ok(card.width > 0 && card.height > 0 && card.left >= box.left - 1 && card.top >= box.top - 1
        && card.right <= box.right + 1 && card.bottom <= box.bottom + 1, `stack ${count} exceeds its cell: ${JSON.stringify(layout)}`);
    }
    for (const [i, card] of cards.entries()) {
      for (const other of cards.slice(i + 1)) {
        assert.ok(card.right <= other.left + 1 || card.bottom <= other.top + 1, `stack ${count} cards overlap`);
      }
    }
    assert.ok(Math.abs(cards[0].left - box.left) < 1 && Math.abs(cards[1].right - box.right) < 1);
    assert.ok(Math.abs(cards.at(-1).bottom - box.bottom) < 1);
    if (cards.length === 3) assert.ok(Math.abs(cards[2].width - box.width) < 1);
  }

  const openMovementMenu = anchorTier => run(`(() => {
    const game = window.FatedTacticalGame;
    const state = game.getBattleState();
    Object.assign(state.scale, { anchorTier: ${anchorTier}, cellM: ${anchorTier === 5 ? 50 : 15} });
    const actor = state.units[state.order[state.turn]];
    actor.moveM = state.scale.cellM * 0.3;
    actor.moveCarryPermille = 0;
    game.createBattle({ kind: 'custom_state', state });
    document.querySelector('#board .tactical-cell[data-x="2"][data-y="2"]').click();
    return true;
  })()`);
  await openMovementMenu(5);
  assert.equal(await run('document.querySelectorAll("#action-toolbar [data-action=move], #action-toolbar [data-action=sprint]").length'), 0);
  await openMovementMenu(4);
  assert.match(await run('document.querySelector("#action-toolbar [data-action=move]")?.textContent ?? ""'), /蓄步推进/);
  assert.match(await run('document.querySelector("#action-toolbar [data-action=sprint]")?.textContent ?? ""'), /疾跑推进/);
  await run('document.querySelector("#action-toolbar [data-action=move]").click(); true');
  await waitFor('document.querySelector("#actor-card").textContent.includes("蓄步 30%")');
  await waitFor('document.querySelector("#caption").textContent.includes("约 30%")');
  const banked = await run(`(() => {
    const state = window.FatedTacticalGame.getBattleState();
    const actor = state.units[state.order[state.turn]];
    return [actor.x, actor.y, actor.moveCarryPermille, actor.used.action];
  })()`);
  assert.deepEqual(banked, [2, 2, 300, 1]);
  const report = await run('window.FatedTacticalGame.exportBattleReportText()');
  assert.match(report, /约 30%/);
  assert.doesNotMatch(report, /\d+(?:\.\d+)?\s*m\b|移动 0 格/);

  await run(`(() => {
    const game = window.FatedTacticalGame;
    const state = game.exportBattleSnapshot().origin;
    game.createBattle({ kind: 'custom_state', state });
    document.querySelector('#board .tactical-cell[data-x="2"][data-y="2"]').click();
    document.querySelector('#action-toolbar [data-action=sprint]').click();
    return true;
  })()`);
  await waitFor('Object.values(window.FatedTacticalGame.getBattleState().units).some(unit => unit.moveCarryPermille === 600)');
  assert.match(await run('window.FatedTacticalGame.exportBattleReportText()'), /疾跑推进.*约 60%/);
});
