// Offline reproduction of the slot serialization and four transport boundaries.
// Run from any directory: node roming/frontend-refactor-v3/repro_slots.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assembleMessages, describeSlots, makeCustomSlot } from '../../src/tavern/prompts.js';
import { requestViaTavern, requestViaCustomApi } from '../../src/tavern/api.js';
const slot = { ...makeCustomSlot(), label: '任务', role: 'system', content: '你是命定战斗助手【V6 复现】' };
const config = { slots: [...describeSlots(), slot] };
const stored = JSON.stringify(config);
const reloaded = describeSlots(JSON.parse(stored).slots);
const ctx = { kind: 'validate', rosterText: '角色 A', warningsText: '警告 A' };
const preview = assembleMessages(config.slots, ctx);
const messages = assembleMessages(reloaded, ctx);
for (const [stage, items] of [['新建', config.slots], ['序列化', JSON.parse(stored).slots], ['重载', reloaded], ['组装', messages]]) {
  const row = items.find(m => (m.slotId ?? m.id) === slot.id);
  assert.equal(row?.content, slot.content, stage);
  console.log(stage, JSON.stringify(row));
}
assert.equal(JSON.stringify(preview), JSON.stringify(messages));
await requestViaTavern({ generateRaw: args => { assert.deepEqual(args.ordered_prompts, preview); console.log('generateRaw：保留'); return 'OK'; } }, {}, messages);
for (const source of ['openai', 'claude', 'gemini']) {
  const settings = { apiMode: 'custom', apiSource: source, baseUrl: 'https://example.invalid', apiKey: 'stub', model: 'stub', stream: false };
  await requestViaCustomApi(settings, messages, { fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body);
    const text = source === 'openai' ? body.messages.find(m => m.content === slot.content)?.content : source === 'claude' ? body.system : body.systemInstruction.parts[0].text;
    assert.ok(text?.includes(slot.content), source); console.log(source + '：保留' + (source === 'openai' ? '（messages）' : '（专用 system 字段）'));
    return Response.json({ choices: [{ message: { content: 'OK' } }], content: [{ text: 'OK' }], candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
  } });
}

// This function runs in the Chrome parent page. Each frame loads its own overlay module.
async function exerciseWindows() {
  const frame = async () => {
    const el = document.createElement('iframe');
    const loaded = new Promise(resolve => { el.onload = resolve; });
    el.src = '/mount'; document.body.append(el); await loaded;
    return el;
  };
  const first = await frame(), second = await frame();
  const editor = first.contentWindow, scanner = second.contentWindow;
  const key = 'fated-tactical/tavern/slot-race';
  const marker = 'Synthetic cross-window slot';
  const check = (ok, why) => { if (!ok) throw new Error(why); };
  check(editor.app && scanner.app, 'Both overlays must be mounted before editing');
  await editor.app.open(); // No battle in this frame yet.
  const doc = editor.document;
  doc.querySelector('[data-tab="prompt"]').click();
  doc.querySelector('.wf-toolbar button').click();
  const field = doc.querySelector('.slot-editor:not([hidden]) textarea');
  const role = doc.querySelector('.slot-editor:not([hidden]) select');
  role.value = 'system'; role.dispatchEvent(new editor.Event('change', { bubbles: true }));
  field.value = marker; field.dispatchEvent(new editor.Event('input', { bubbles: true }));
  const previewRow = JSON.parse(doc.querySelector('.preview-panel pre').textContent).find(m => m.content === marker);
  check(previewRow, 'Custom slot missing from editor preview');
  const stored = () => JSON.parse(scanner.localStorage.getItem(key));
  const persisted = () => stored()?.slots?.some(s => s.content === marker);
  check(persisted(), 'Editor did not persist slot to shared key');

  scanner.hasBattle = true;
  await scanner.app.scan(true);
  check(scanner.app.getDiagnostics().phase === 'hydrated' && scanner.app.getState(), 'Second overlay did not hydrate');
  const survivedScan = persisted(); // Diagnose loss, but always exercise the transport after reload.
  const loaded = new Promise(resolve => { first.onload = resolve; });
  editor.location.reload(); await loaded;
  const fresh = first.contentWindow;
  fresh.hasBattle = true;
  await fresh.app.open();
  check(fresh.app.getDiagnostics().phase === 'hydrated', 'Reloaded overlay did not hydrate');
  if (!fresh.calls.length) { // A fixture with warnings already triggers normalization on scan.
    fresh.document.querySelector('[data-tab="sandbox"]').click();
    fresh.document.querySelector('[data-page="sandbox"] .fated-actions button').click();
  }
  const sent = fresh.calls[0];
  check(Array.isArray(sent), 'Reloaded overlay did not invoke generateRaw with ordered_prompts');
  check(sent.some(m => m.content === marker && m.role === previewRow.role),
    `Reloaded generateRaw lost preview slot (present in storage after second scan: ${survivedScan})`);
  check(survivedScan, 'Second scan removed persisted slot');
}

const { outputFiles } = await build({
  stdin: { resolveDir: fileURLToPath(new URL('../../src/tavern/', import.meta.url)), contents: `
    import { mountTavernOverlay } from '${process.argv.includes('--dist') ? '../../dist/index.mjs' : './overlay.js'}';
    window.getLastMessageId = () => 0;
    window.getChatMessages = () => window.hasBattle ? [{ message_id: 0, role: 'assistant', message:
      '<battle_init>\\nbattle|1|slots|Synthetic|terrain|12\\nunit|p1|blue|mvu:主角|Blue|2,2\\nunit|e1|red|char_info|Red|7,7\\n</battle_init>' }] : [];
    window.Mvu = { getMvuData: () => ({ stat_data: { 主角: { 属性: { 力量: 7 } } } }) };
    window.calls = [];
    window.generateRaw = args => { window.calls.push(structuredClone(args.ordered_prompts)); return '{"patch":[],"unresolved":["fixture"]}'; };
    window.app = mountTavernOverlay({ host: window, document, instanceId: 'slot-race' });` },
  bundle: true, write: false, logLevel: 'silent',
});
const result = Promise.withResolvers();
const server = createServer(async (req, res) => {
  if (req.url === '/result' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    res.end(); result.resolve(body);
  } else if (req.url === '/overlay.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(outputFiles[0].contents);
  else if (req.url === '/mount') res.end('<!doctype html><meta charset=utf-8><body><script src=/overlay.js></script>');
  else if (req.url === '/') res.end(`<!doctype html><meta charset=utf-8><body><script>(${exerciseWindows})().then(() => 'PASS', e => String(e.stack || e)).then(body => fetch('/result', {method:'POST', body}));</script>`);
  else res.writeHead(404).end();
});
const profile = await mkdtemp(join(tmpdir(), 'slot-race-'));
let child, closed, timeout;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
  child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
  child.once('error', result.reject);
  closed = new Promise(resolve => child.once('close', code => { resolve(); result.reject(new Error(`Chrome exited (${code})`)); }));
  timeout = setTimeout(() => result.reject(new Error('Chrome slot regression timed out')), 30000);
  const outcome = await result.promise;
  assert.equal(outcome, 'PASS', outcome);
  console.log('Chrome: custom preview slot survived concurrent hydration and reached reloaded generateRaw');
} finally {
  clearTimeout(timeout); child?.kill(); await closed;
  server.closeAllConnections(); server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
