// Run: node roming/frontend-refactor-v3/smoke_v3.mjs (CHROME_PATH overrides Chrome).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dir = fileURLToPath(new URL('../../src/tavern/', import.meta.url));
const prompts = () => import('../../src/tavern/prompts.js');
const api = () => import('../../src/tavern/api.js');
const ctx = { rosterText: '参战者A', battleText: '地形B', warningsText: '警告C', taskText: '任务D' };
const settings = { apiMode: 'custom', baseUrl: 'https://smoke.invalid', apiKey: 'smoke-key', model: 'smoke-model', temperature: 0.37, max_tokens: 413, stream: false };
const messages = [{ role: 'system', content: '规则' }, { role: 'user', content: '任务' }];
async function check(id, name, fn) {
  try { const detail = await fn(); console.log(`G${id} PASS ${name}${detail ? `：${detail}` : ''}`); }
  catch (e) { console.error(`G${id} FAIL ${name}\n${e.stack || e}`); process.exitCode = 1; }
}
async function mockFetch(handler, fn) {
  const original = globalThis.fetch;
  try { globalThis.fetch = handler; return await fn(); } finally { globalThis.fetch = original; }
}
await check(5, '解析所有酒馆模块及其导入', async () => {
  const files = (await readdir(dir, { recursive: true })).filter(f => /\.m?js$/.test(f));
  assert.ok(files.length);
  await build({ absWorkingDir: dir, entryPoints: files, outdir: 'unused', bundle: true, write: false, logLevel: 'silent' });
  return `${files.length} 个入口`;
});
await check(6, '槽位开关改变最终消息数', async () => {
  const { assembleMessages, DEFAULT_SLOTS } = await prompts();
  const before = assembleMessages(DEFAULT_SLOTS, ctx);
  const after = assembleMessages(DEFAULT_SLOTS.map(s => s.id === 'protocol' ? { ...s, enabled: false } : s), ctx);
  assert.ok(before.some(m => m.role === 'system' && m.content.trim()));
  assert.equal(after.length, before.length);
  assert.ok(before[0].slotId.split('+').includes('protocol'));
  assert.ok(!after[0].slotId.split('+').includes('protocol') && after[0].content.includes(ctx.rosterText));
  assert.ok(after[0].content.length < before[0].content.length);
});
await check(7, 'generateRaw 参数与流式事件', async () => {
  const { requestViaTavern } = await api();
  for (const stream of [true, false]) {
    const listeners = new Map(), chunks = []; let calls = 0;
    const host = { eventOn: (k, fn) => { listeners.set(k, fn); }, eventRemoveListener: k => listeners.delete(k), TavernHelper: { async generateRaw(args) {
      calls++; assert.equal(args.should_stream, stream); assert.ok(args.generation_id); assert.deepEqual(args.ordered_prompts, messages);
      if (stream) { const cb = listeners.get('js_stream_token_received_fully'); cb('串流', 'other'); cb('片段', args.generation_id); }
      return '完成';
    } } };
    assert.equal(await requestViaTavern(host, { apiMode: 'tavern', stream }, messages, { onStreamChunk: (...args) => chunks.push(args) }), '完成');
    assert.equal(calls, 1); assert.equal(listeners.size, 0); assert.deepEqual(chunks.at(-1).slice(0, 2), ['完成', true]);
    if (stream) { assert.ok(chunks.some(([s, end]) => s === '片段' && end === false)); assert.ok(!chunks.some(([s]) => s === '串流')); }
  }
});
await check(8, '三个独立协议的实际 HTTP 请求', async () => {
  const { requestViaCustomApi } = await api();
  for (const apiSource of ['openai', 'gemini', 'claude']) {
    let calls = 0;
    await mockFetch(async (input, init) => {
      calls++; const req = new Request(input, init), url = new URL(req.url), h = req.headers, b = await req.json();
      assert.equal(req.method, 'POST'); assert.equal(url.origin, settings.baseUrl); assert.match(h.get('content-type'), /application\/json/);
      if (apiSource === 'gemini') {
        assert.equal(url.pathname, `/v1beta/models/${settings.model}:generateContent`); assert.equal(url.searchParams.get('key'), settings.apiKey); assert.equal(h.has('authorization'), false);
        assert.deepEqual(b.systemInstruction.parts, [{ text: '规则' }]); assert.deepEqual(b.contents, [{ role: 'user', parts: [{ text: '任务' }] }]);
        assert.equal(b.generationConfig.maxOutputTokens, settings.max_tokens); assert.equal(b.generationConfig.temperature, settings.temperature);
        assert.equal(b.safetySettings.length, 5); assert.ok(b.safetySettings.every(s => s.threshold === 'BLOCK_NONE'));
        return Response.json({ candidates: [{ content: { parts: [{ text: '成功' }] } }] });
      }
      assert.equal(b.temperature, settings.temperature); assert.equal(b.max_tokens, settings.max_tokens); assert.equal(b.model, settings.model); assert.equal(b.stream, false);
      if (apiSource === 'claude') {
        assert.equal(url.pathname, '/v1/messages'); assert.equal(h.get('x-api-key'), settings.apiKey); assert.equal(h.get('anthropic-version'), '2023-06-01'); assert.equal(h.get('anthropic-dangerous-direct-browser-access'), 'true');
        assert.equal(b.system, '规则'); assert.deepEqual(b.messages, messages.slice(1)); return Response.json({ content: [{ type: 'text', text: '成功' }] });
      }
      assert.equal(url.pathname, '/chat/completions'); assert.equal(h.get('authorization'), `Bearer ${settings.apiKey}`); assert.deepEqual(b.messages, messages);
      return Response.json({ choices: [{ message: { content: '成功' } }] });
    }, async () => assert.equal(await requestViaCustomApi({ ...settings, apiSource }, messages, {}), '成功'));
    assert.equal(calls, 1, apiSource);
  }
  return 'OpenAI / Gemini / Claude';
});
await check(9, 'SSE 心跳、分块增量与完成回调', async () => {
  const { requestViaCustomApi } = await api(); const chunks = [];
  const data = s => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\r\n\r\n`;
  const bytes = new TextEncoder().encode(': ping\r\n\r\n' + data('一') + data('二') + 'data: [DONE]\r\n\r\n');
  await mockFetch((_, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    let pos = 0;
    return new Response(new ReadableStream({ pull(c) { if (pos < bytes.length) { c.enqueue(bytes.slice(pos, pos + 5)); pos += 5; } else c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }, async () => assert.equal(await requestViaCustomApi({ ...settings, apiSource: 'openai', stream: true }, messages, { onStreamChunk: (...args) => chunks.push(args) }), '一二'));
  assert.ok(chunks.some(([s, end, m]) => s === '' && end === false && m?.isHeartbeat));
  assert.deepEqual(chunks.filter(([s, end]) => s && !end).map(([s]) => s), ['一', '一二']);
  assert.deepEqual(chunks.at(-1).slice(0, 2), ['一二', true]);
});

// These probes run inside Chrome against production source, not a synthetic DOM.
async function browserProbe(id, cfg) {
  const visible = el => !!el?.getClientRects().length && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const button = re => [...document.querySelectorAll('button')].find(b => visible(b) && !b.disabled && re.test(b.innerText));
  const until = async (probe, label) => { for (let i = 0; i < 200; i++) { const v = probe(); if (v) return v; await new Promise(r => setTimeout(r, 25)); } throw Error(`未观察到${label}`); };
  if (id === 10) {
    const page = document.body.appendChild(document.createElement('main'));
    const settings = { ...cfg, apiSource: 'openai' };
    let requests = 0; window.fetch = () => { requests++; throw Error('不应发送请求'); };
    renderApiTab(page, { settings, slots: DEFAULT_SLOTS, assemblyCtx: {}, save: patch => Object.assign(settings, patch), host: window });
    const model = [...page.querySelectorAll('input')].find(el => el.value === cfg.model);
    if (!visible(model)) throw Error('没有可见模型输入框');
    model.value = ''; model.dispatchEvent(new Event('change', { bubbles: true }));
    const missing = /(?:请.{0,10}(?:填写|设置|输入|配置|选择|提供).{0,12}(?:模型|model)|(?:模型|model).{0,12}(?:为空|空白|未填|未设|必填|不能为空|缺失)|缺少.{0,8}(?:模型|model))/i;
    const diagnostic = () => [...document.body.querySelectorAll('*')].find(e => !e.children.length && visible(e) && missing.test(e.innerText));
    (await until(() => button(/测试连接/), '测试连接按钮')).click();
    const error = await until(diagnostic, '可见的模型缺失诊断'); if (requests) throw Error('缺模型仍发送请求'); return error.innerText;
  }
  const requests = [];
  window.getLastMessageId = () => 0;
  window.getChatMessages = () => [{ message_id: 0, role: 'assistant', message: '<char_info>{"name":"对手"}</char_info><battle_init>\nbattle|1|smoke|冒烟|terrain|12\nunit|p1|blue|mvu:主角|玩家|2,2\nunit|e1|red|char_info|对手|7,7\n</battle_init>' }];
  window.Mvu = { getMvuData: () => ({ stat_data: { 主角: { 装备: { 旧弩: { 类型: '武器', 位置: '主手', 标签: ['弩','攻击: 14'], 效果: { 恒定拉距: '弩箭攻击恒定为10' } } } } } }) };
  window.generateRaw = async args => { requests.push({ args, stack: new Error().stack }); return JSON.stringify({ patch: [{op:'replace',path:'/units/p1/armor',value:3}], unresolved: ['旧弩效果无法映射'] }); };
  const app = mountTavernOverlay({ host: window, document });
  await app.open(); await until(() => requests.length, '警告触发自动标准化');
  await until(() => document.body.innerText.includes('标准化完成'), '自动标准化完成');
  let manual = button(/标准化/);
  for (const tab of document.querySelectorAll('[data-tab]')) { if (manual) break; tab.click(); manual = button(/标准化/); }
  if (!manual) throw Error('未找到可见手动标准化按钮');
  manual.click(); await until(() => requests.length === 2, '手动标准化请求');
  for (const { args, stack } of requests) if (!args.ordered_prompts?.length || !/\brunNormalize\b/.test(stack)) throw Error(`请求未经过 runNormalize：${stack}`);
  return '自动、手动两次 generateRaw 均经过 runNormalize';
}

async function inChrome(id, probe = id >= 13 ? slotProbe : browserProbe) {
  const imports = id >= 13 ? "import {mountTavernOverlay} from './overlay.js'; import {DEFAULT_SLOTS, assembleMessages} from './prompts.js';" : id === 10 ? "import {renderApiTab} from './settings.js'; import {DEFAULT_SLOTS} from './prompts.js';" : "import {mountTavernOverlay} from './overlay.js';";
  const { outputFiles } = await build({ stdin: { contents: `${imports}\nconst report = fetch.bind(window);\n(${probe})(${id}, ${JSON.stringify(settings)}).then(ok => report('/result',{method:'POST',body:JSON.stringify({ok})}), e => report('/result',{method:'POST',body:JSON.stringify({error:e.stack})}));`, resolveDir: dir }, bundle: true, write: false, logLevel: 'silent', keepNames: true });
  const profile = await mkdtemp(join(tmpdir(), 'fated-smoke-'));
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    if (req.url === '/probe.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(outputFiles[0].contents);
    else if (req.url === '/result' && req.method === 'POST') {
      let data = ''; for await (const chunk of req) data += chunk; res.end();
      try { const result = JSON.parse(data); if (result.error) reject(Error(result.error)); else resolve(result.ok); } catch (e) { reject(e); }
    } else res.end('<!doctype html><meta charset="utf-8"><body><script src="/probe.js"></script>');
  });
  let child, timer;
  try {
    await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
    const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
    child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
    child.on('error', reject); child.once('exit', code => reject(Error(`Chrome 退出 ${code}`)));
    timer = setTimeout(() => reject(Error('等待 Chrome 冒烟结果超时')), 20000);
    return await promise;
  } finally { clearTimeout(timer); child?.kill(); server.close(); server.closeAllConnections(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
}
await check(10, '缺模型时真实 UI 呈现错误', () => inChrome(10));
await check(11, '自动/手动共用唯一 runNormalize', async () => {
  const files = (await readdir(dir, { recursive: true })).filter(f => /\.m?js$/.test(f));
  const sources = (await Promise.all(files.map(f => readFile(join(dir, f), 'utf8')))).join('\n');
  assert.equal([...sources.matchAll(/\b(?:function\s+runNormalize\s*\(|(?:const|let)\s+runNormalize\s*=)/g)].length, 1, '应只有一处 runNormalize 实现');
  return inChrome(11);
});

// Each case gets an isolated Chrome profile and drives the production overlay.
async function slotProbe(id) {
  const expect = (value, message) => { if (!value) throw Error(message); };
  const equal = (actual, expected, message) => expect(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  const instanceId = 'slot-smoke', storageKey = `fated-tactical/tavern/${instanceId}`;
  const reload = () => { location.reload(); return new Promise(() => {}); };
  const legacy = DEFAULT_SLOTS.filter(s => s.id !== 'identity').map(({ id, enabled }) => ({ id, enabled: id === 'protocol' ? false : enabled }));
  if (id === 18 && !sessionStorage.seeded) {
    localStorage.setItem(storageKey, JSON.stringify({ slots: legacy }));
    sessionStorage.seeded = '1';
    return reload();
  }
  if (id === 19 && !sessionStorage.seeded) {
    localStorage.setItem(storageKey, JSON.stringify({ extraText: '遗留补充内容', slots: legacy }));
    sessionStorage.seeded = '1';
    return reload();
  }
  const app = mountTavernOverlay({ host: window, document, instanceId });
  await app.open();
  document.querySelector('[data-tab="prompt"]').click();
  const page = document.querySelector('[data-page="prompt"]');
  const slots = () => app.getConfig().slots;
  const visible = e => !!e?.getClientRects().length && e.checkVisibility();
  function click(root, pattern) {
    // Icon buttons carry their Chinese name in title/aria-label rather than innerText.
    const name = b => `${b.innerText} ${b.title} ${b.getAttribute('aria-label') ?? ''}`;
    const btn = [...root.querySelectorAll('button')].find(b => visible(b) && !b.disabled && pattern.test(name(b)));
    expect(btn, `找不到可用按钮 ${pattern}`); btn.click();
  }
  function preview() {
    const summary = [...page.querySelectorAll('summary')].find(e => /messages/i.test(e.textContent));
    expect(summary, '没有 messages 预览');
    if (!summary.parentElement.open) summary.click();
    const pre = summary.parentElement.querySelector('pre');
    expect(visible(pre), '预览不可见'); return JSON.parse(pre.textContent);
  }
  const card = slotId => {
    const i = slots().findIndex(s => s.id === slotId);
    const node = page.querySelectorAll('.wf-card')[i];
    expect(node, `没有槽位卡片 ${slotId}`); return node;
  };
  function field(slotId, selector) {
    if (![...card(slotId).querySelectorAll(selector)].some(visible)) click(card(slotId), /编辑/);
    const el = [...card(slotId).querySelectorAll(selector)].find(visible);
    expect(el, `编辑器缺少 ${selector}`); return el;
  }
  const title = 'input:not([type=checkbox])';
  function write(slotId, selector, value) {
    const el = field(slotId, selector);
    expect(!el.readOnly && !el.disabled, `不能编辑 ${selector}`);
    el.value = value;
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function create(label, content) {
    const before = new Set(slots().map(s => s.id));
    click(page, /新建槽位/);
    const added = slots().filter(s => !before.has(s.id));
    expect(added.length === 1 && added[0].custom === true, '新建未保存独立自定义槽位');
    const key = added[0].id;
    write(key, title, label); write(key, 'textarea', content); return key;
  }
  const ids = () => preview().map(m => m.slotId);
  if (id === 18) {
    for (const def of DEFAULT_SLOTS) {
      const migrated = slots().find(s => s.id === def.id);
      expect(migrated?.builtin === true && typeof migrated.content === 'string', `${def.id} 未补全内置字段`);
      for (const key of ['label', 'role', 'desc']) equal(migrated[key], def[key], `${def.id}.${key}`);
      equal(migrated.enabled, legacy.find(slot => slot.id === def.id)?.enabled ?? def.enabled, '旧开关未保留');
    }
    expect(!ids().some(s => s.split('+').includes('protocol')) && preview().length > 0, '旧配置未用于组装'); return;
  }
  if (id === 17 && sessionStorage.expected) {
    const { saved, order } = JSON.parse(sessionStorage.expected);
    equal(slots(), saved, '重载后顺序或编辑丢失'); equal(ids(), order, '重载后消息顺序错误');
    window.confirm = () => true;
    click(page, /恢复默认/); equal(slots(), DEFAULT_SLOTS, '恢复默认未还原完整槽位列表'); return;
  }
  const initial = preview();
  if (id === 19) {
    // V5 removed the standalone extraText form; old values must still surface in the extra slot.
    equal(app.getConfig().extraText, '遗留补充内容', '旧 extraText 未被保留');
    const extra = card('extra');
    const content = field('extra', 'textarea');
    expect(!content.readOnly, '补充槽位内容应可编辑');
    equal(content.value, '遗留补充内容', '补充槽位未显示旧 extraText');
    const toggle = extra.querySelector('input.toggle-switch');
    toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    // The builtin extra slot merges into the system message.
    equal(preview().at(-1).content.split('\n\n').at(-1), '遗留补充内容', '启用后未发送旧 extraText');
    write('extra', 'textarea', '新补充');
    equal(app.getConfig().extraText, '', '编辑后旧 extraText 未迁移清理');
    equal(preview().at(-1).content.split('\n\n').at(-1), '新补充', '迁移后未使用槽位内容');
    return;
  }
  if (id === 15) {
    const key = 'protocol', before = initial.find(m => m.slotId.split('+').includes(key));
    expect(before?.role === 'system', '缺少内置 system 槽位');
    const content = field(key, '.slot-preview');
    expect(content.getAttribute('aria-readonly') === 'true' && before.content.includes(content.textContent), '内置内容应展示只读动态预览');
    const protocol = content.textContent;
    write(key, title, '规则别名'); write(key, 'select', 'assistant');
    equal(preview().find(m => m.slotId === key), { role: 'assistant', content: protocol, slotId: key, slotLabel: '规则别名' }, '内置标题/角色未生效'); return;
  }
  const key = create('冒烟自定义', '独立消息');
  const message = () => preview().find(m => m.slotId === key);
  if (id === 13) {
    equal(preview().length, initial.length + 1, '消息数未增加'); equal(message()?.slotLabel, '冒烟自定义', '标题未生效');
  } else if (id === 14) {
    write(key, 'textarea', '新内容：{{user_instruction}}!');
    equal(message()?.content, '新内容：!', '编辑未立即刷新预览');
    const template = '{{battle_init}}|{{battle_state}}|{{warnings}}|{{user_instruction}}|{{roster}}|{{battle}}';
    write(key, 'textarea', template);
    const context = { instruction: '向右', rosterText: '参战者', battleText: '地形', state: { turn: 3 }, sources: { battleRaw: '初始', warnings: ['缺失'] } };
    const expected = ['初始', JSON.stringify(context.state, null, 2), JSON.stringify(context.sources.warnings, null, 2), '向右', '参战者', '地形'].join('|');
    equal(assembleMessages(slots(), context).find(m => m.slotId === key)?.content, expected, '非空宏展开错误');
  } else if (id === 16) {
    equal(preview().length, initial.length + 1, '删除前应存在新消息');
    window.confirm = () => true; click(card(key), /删除/);
    expect(!slots().some(s => s.id === key), '仅隐藏而非删除'); equal(preview(), initial, '删除后消息未复原');
  } else if (id === 17) {
    const next = create('第二条', '保留编辑和顺序'); write(next, 'select', 'assistant');
    click(card('protocol'), /隐藏/);
    expect(!ids().some(s => s.split('+').includes('protocol')), '隐藏后仍组装内置消息');
    const order = ids(), pos = order.indexOf(next);
    expect(pos > 0 && order[pos - 1] === key, '上移前消息不相邻');
    click(card(next), /上移/); [order[pos - 1], order[pos]] = [next, key];
    equal(ids(), order, '上移未改变组装顺序');
    sessionStorage.expected = JSON.stringify({ saved: slots(), order }); return reload();
  }
}
await check(12, '转换器保留新特效与合法覆盖，拒绝非法覆盖', async () => {
  const { mapEffects } = await import('../../src/tavern/converter.js');
  const warnings = [];
  const equipment = [
    { kind: 'save_or_status', save: 'int', saveDC: 14, statusId: 'freeze', turns: 1 },
    { kind: 'fixed_attack', value: 10 },
  ];
  const skills = [
    { kind: 'fixed_damage', amount: 10, damageType: 'physical' },
    { kind: 'status', statusId: 'burn', modifiers: { damage: 12 } },
    { kind: 'status', statusId: 'infinite_ammo' },
  ];
  assert.deepEqual(mapEffects(equipment, 'equipment', warnings).flatMap(e => e.effects.map(n => n.kind)), ['grantStatus','modifyDamageBase']);
  assert.deepEqual(mapEffects(skills, 'skill', warnings).flatMap(e => e.effects.map(n => n.kind)), ['modifyDamageBase','grantStatus','grantStatus']);
  assert.deepEqual(warnings, []);
  assert.deepEqual(mapEffects([{ kind: 'status', statusId: 'stun', modifiers: { damage: 1 } }], 'skill', warnings), []);
  assert.match(warnings[0], /stun.*damage/);
});
await check(13, '新建自定义槽位增加具名消息', () => inChrome(13));
await check(14, '编辑静态内容并展开宏', () => inChrome(14));
await check(15, '内置动态内容只读，改名与角色立即生效', () => inChrome(15));
await check(16, '删除自定义槽位还原原有消息', () => inChrome(16));
await check(17, '上移改变消息顺序，现代配置跨页面重载', () => inChrome(17));
await check(18, '旧版存储跨页面重载后补全内置字段并保留开关', () => inChrome(18));
await check(19, '旧 extraText 在补充槽位中显示并可迁移', () => inChrome(19));

async function defaultContent(id) {
  const { DEFAULT_SLOTS, resolveSlotContent } = await prompts();
  const slot = DEFAULT_SLOTS.find(s => s.id === id);
  assert.ok(slot, `缺少默认槽位 ${id}`);
  const content = resolveSlotContent(slot, { kind: 'normalize' });
  assert.ok(content?.trim(), `${id} 槽位为空`);
  return content;
}
await check(20, '协议状态目录覆盖全部引擎 ID', async () => {
  const { STATUSES } = await import('../../src/core/combat.js');
  const lines = (await defaultContent('protocol')).split(/\r?\n/);
  const ids = Object.keys(STATUSES);
  assert.ok(ids.length, '引擎状态表为空');
  const missing = ids.filter(id => !lines.some(line => line.startsWith(`${id} |`) && line.slice(id.length + 2).trim()));
  assert.deepEqual(missing, [], '缺少以精确 ID 开头的状态行：' + missing.join(', '));
  return `${ids.length} 个状态`;
});
await check(21, '标准化任务列出全部白名单路径', async () => {
  const task = await defaultContent('task');
  for (const prefix of ['/equipment/', '/skills/', '/items/', '/statusTemplates/']) {
    assert.ok(task.includes(prefix), `缺少白名单路径 ${prefix}`);
  }
  for (const path of ['/units/<unitId>/statuses', '/units/<unitId>/armor']) {
    assert.ok(task.includes(path), `缺少白名单路径 ${path}`);
  }

  // Exercise the documented p1 armor correction, not a copy of its JSON.
  const example = task.match(/^正例[^\n]*\n(\{[^\n]+\})/m);
  assert.ok(example, '正例缺少 JSON');
  const reply = JSON.parse(example[1]);
  assert.deepEqual(reply.unresolved, []);
  const { hydrateFromSources } = await import('../../src/tavern/converter.js');
  const { applyPatch } = await import('../../src/tavern/overlay.js');
  const { validateState } = await import('../../src/api/validation.js');
  const { state } = hydrateFromSources({ battleInit: { units: [
    { id: 'p1', name: '玩家', team: 'blue', x: 2, y: 2 },
    { id: 'e1', name: '对手', team: 'red', x: 7, y: 7 },
  ] } });
  const expected = structuredClone(state);
  expected.units.p1.armor = 6;
  const patched = applyPatch(state, reply.patch);
  validateState(patched);
  assert.deepEqual(patched, expected, '正例应只修正 p1 的护甲');
});
await check(22, '报告默认提示词长度', async () => {
  const lengths = [];
  for (const id of ['protocol','task']) lengths.push(`${id}=${(await defaultContent(id)).length}`);
  return lengths.join(', ');
});

await check(23, '自定义 system 槽位经过 JSON 配置往返后仍参与组装', async () => {
  const { makeCustomSlot, describeSlots, assembleMessages } = await prompts();
  const slot = { ...makeCustomSlot(), role: 'system', content: '保留我的指令' };
  const config = JSON.parse(JSON.stringify({ slots: [...describeSlots(), slot] }));
  const restored = describeSlots(config.slots);
  assert.deepEqual(restored.find(s => s.id === slot.id), slot);
  assert.deepEqual(assembleMessages(restored, ctx).filter(m => m.slotId === slot.id), [
    { role: slot.role, content: slot.content, slotId: slot.id, slotLabel: slot.label },
  ]);
});

async function normalizeProbe(id) {
  const expect = (ok, message) => { if (!ok) throw Error(message); };
  const instanceId = 'manual-normalize', storageKey = `fated-tactical/tavern/${instanceId}`;
  const timerCase = id >= 26, marker = '仅此自定义槽位的 system 指令';
  const tab = key => document.querySelector(`[data-tab="${key}"]`).click();
  const page = key => document.querySelector(`[data-page="${key}"]`);
  const click = (root, name) => {
    const button = [...root.querySelectorAll('button')].find(b => b.checkVisibility() && !b.disabled && b.textContent.includes(name));
    expect(button, `找不到可见按钮 ${name}`); button.click();
  };
  if (timerCase) localStorage.setItem(storageKey, JSON.stringify(id === 26 ? {} : { timeoutMs: 1800000 }));
  window.getLastMessageId = () => 0;
  window.getChatMessages = () => [{ message_id: 0, role: 'assistant', message: '<char_info>{"name":"对手"}</char_info><battle_init>\nbattle|1|smoke|冒烟|terrain|12\nunit|p1|blue|mvu:主角|玩家|2,2\nunit|e1|red|char_info|对手|7,7\n</battle_init>' }];
  window.Mvu = { getMvuData: () => ({ stat_data: { 主角: {} } }) };
  const calls = [];
  window.generateRaw = async args => {
    calls.push(structuredClone(args.ordered_prompts));
    return JSON.stringify({ patch: [{op:'replace',path:'/units/p1/armor',value:3}], unresolved: ['测试请求'] });
  };
  const app = mountTavernOverlay({ host: window, document, instanceId });
  await app.open();
  // Let any auto-normalize response settle before counting the manual click.
  await new Promise(resolve => setTimeout(resolve, 0));
  let preview;
  if (!timerCase) {
    tab('prompt');
    const root = page('prompt');
    if (!sessionStorage.customKey) {
      click(root, '新建槽位');
      const slot = app.getConfig().slots.find(s => s.custom);
      expect(slot, '没有新建槽位');
      const card = () => root.querySelectorAll('.wf-card')[app.getConfig().slots.findIndex(s => s.id === slot.id)];
      const input = card().querySelector('textarea'), role = card().querySelector('select');
      role.value = 'system'; role.dispatchEvent(new Event('change'));
      input.value = marker; input.dispatchEvent(new Event('input'));
      // Put it before the built-in protocol so default order cannot pass G25.
      while (!card().querySelector('[title="上移"]').disabled) card().querySelector('[title="上移"]').click();
      sessionStorage.customKey = slot.id;
      location.reload(); return new Promise(() => {});
    }
    const details = root.querySelector('.preview-panel');
    if (!details.open) details.querySelector('summary').click();
    const pre = details.querySelector('pre');
    expect(pre.checkVisibility(), 'messages 预览不可见'); preview = JSON.parse(pre.textContent);
    expect(preview.some(m => m.slotId === sessionStorage.customKey && m.content === marker && m.role === 'system'), '重载后预览里缺少自定义 system 消息');
  }
  tab('sandbox');
  const before = calls.length, delays = [], original = window.setTimeout;
  try {
    // Stub only while dispatching the real manual request, never during scan/polling.
    if (timerCase) window.setTimeout = (_callback, ms) => { delays.push(ms); return -delays.length; };
    click(page('sandbox'), '标准化');
    await Promise.resolve();
  } finally { window.setTimeout = original; }
  expect(calls.length === before + 1, '手动标准化未产生唯一的新请求');
  const sent = calls[before];
  if (timerCase) {
    const expected = id === 26 ? 60000 : 1800000;
    expect(delays.includes(expected), `请求未安排 ${expected}ms 超时，实际 ${JSON.stringify(delays)}`);
  } else if (id === 24) {
    expect(JSON.stringify(preview) === JSON.stringify(sent), '重载后的预览与手动请求 ordered_prompts 不同');
  } else {
    const systems = sent.filter(m => m.role === 'system');
    expect(systems.length === 2 && systems[0].slotId === sessionStorage.customKey && systems[0].content === marker && systems[1].slotId.startsWith('identity+protocol+') && systems[1].content.trim(), '请求未按保存的顺序包含独立的自定义与内置 system 消息');
  }
}
await check(24, '重载后的可见预览逐字段等于手动标准化请求', () => inChrome(24, normalizeProbe));
await check(25, '手动标准化保留两个 system 槽位及其顺序', () => inChrome(25, normalizeProbe));
await check(26, '旧配置缺省请求超时为 60000ms', () => inChrome(26, normalizeProbe));
await check(27, '配置的 1800000ms 用于请求超时定时器', () => inChrome(27, normalizeProbe));

async function checkMappings(id, terms) {
  const content = await defaultContent(id);
  for (const term of terms) assert.ok(content.includes(term), `${id} 缺少 ${term}`);
  return `${content.length} 字符`;
}
const checkCatalog = () => execFileSync(process.execPath, [fileURLToPath(new URL('./extract_statuses.mjs', import.meta.url)), '--check'], { encoding: 'utf8' }).trim();
await check(28, 'protocol 槽位包含新增映射', () => checkMappings('protocol', ['modifyDamageBase','forceOutcome','grantStatus','infinite_ammo','procEffect']));
await check(29, 'task 槽位包含 DSL 正例', () => checkMappings('task', ['hit_burn','night_edge','cold_reply','blood_mana']));
await check(30, '状态目录生成校验', checkCatalog);

async function statusBattle() {
  const { createGameAPI } = await import('../../src/index.js');
  const game = createGameAPI();
  const { buildScenario } = await import('../../src/index.js');
  const state = buildScenario({ scenarioId: 'ruins', ruleset: 'protocol' });
  state.units.scout.armor = 0;
  game.createBattle({ kind: 'custom_state', state });
  const proposeEffects = (...effects) => game.proposeCommands([
    { type: 'patch_skill_template', templateId: 'challenge', patch: { effects } },
  ], { reason: '校验状态覆盖', baseRevision: game.getStateSummary().revision });
  const castBurn = () => {
    const proposal = proposeEffects({ kind: 'status', statusId: 'burn', modifiers: { damage: 12 } });
    assert.equal(proposal.ok, true, proposal.error);
    assert.equal(game.commitProposal(proposal.proposalId).ok, true);
    game.playAction({ type: 'skill', skillId: 'challenge', x: 3, y: 2 });
  };
  const advanceToScout = () => {
    for (let i = 0; i < 12 && game.getStateSummary().currentUnitId !== 'scout'; i++) game.playAction({ type: 'end' });
    assert.equal(game.getStateSummary().currentUnitId, 'scout');
  };
  return { game, proposeEffects, castBurn, advanceToScout };
}
await check(31, '技能覆盖灼烧实例，实际跳伤为 12×层数', async () => {
  const { game, castBurn, advanceToScout } = await statusBattle();
  castBurn();
  const before = game.inspectUnit('scout');
  assert.equal(before.statuses.burn.modifiers.damage, 12);
  advanceToScout();
  assert.equal(game.inspectUnit('scout').hp, before.hp - 12 * before.statuses.burn.stacks);
});
await check(32, '非法 modifier 键被拒绝并显示原因', async () => {
  const { game, proposeEffects } = await statusBattle();
  const before = game.exportBattleSnapshot();
  const result = proposeEffects({ kind: 'status', statusId: 'stun', modifiers: { damage: 12 } });
  assert.equal(result.ok, false);
  assert.match(result.error, /stun.*damage/);
  assert.deepEqual(game.exportBattleSnapshot(), before);
  return result.error;
});
await check(33, '越界 modifier 数值被拒绝', async () => {
  const { game, proposeEffects } = await statusBattle();
  const before = game.exportBattleSnapshot();
  for (const damage of [0, 99999999]) {
    const result = proposeEffects({ kind: 'status', statusId: 'burn', modifiers: { damage } });
    assert.equal(result.ok, false);
    assert.match(result.error, /burn\.damage.*1–100000/);
  }
  assert.deepEqual(game.exportBattleSnapshot(), before);
});
await check(34, 'patchStatus 后下一次跳伤使用新值', async () => {
  const { game, castBurn, advanceToScout } = await statusBattle();
  castBurn();
  const before = game.inspectUnit('scout');
  const result = game.patchStatus('scout', 'burn', { damage: 27 });
  assert.equal(result.ok, true, result.error);
  assert.equal(game.inspectUnit('scout').statuses.burn.remainingTurns, before.statuses.burn.remainingTurns);
  advanceToScout();
  assert.equal(game.inspectUnit('scout').hp, before.hp - 27 * before.statuses.burn.stacks);
  assert.equal(game.listStatusTemplates().burn.modifiers.damage, 5);
});
await check(35, '灼烧、流血、中毒、再生、护盾目录行标注范围', async () => {
  const { STATUS_CATALOG } = await import('../../src/tavern/status-catalog.js');
  const lines = STATUS_CATALOG.split('\n');
  for (const [id, key] of [['burn', 'damage'], ['bleed', 'damage'], ['poison', 'damage'], ['regen', 'heal'], ['shield', 'amount']]) {
    assert.match(lines.find(line => line.startsWith(`${id} |`)) ?? '', new RegExp(`${key}=\\d+（1–100000）`));
  }
});
await check(36, '验收结束时状态目录仍与生成器一致', checkCatalog);
