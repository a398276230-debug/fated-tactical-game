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
const until = async (probe, description) => {
  for (let i = 0; i < 120; i++) {
    const answer = await probe();
    if (answer) return answer;
    await pause(50);
  }
  throw new Error(`超时：${description}`);
};

test('真实 Chrome：开局、移动、击杀、祭坛、技能、AI、沙盒、下载/导入、窄屏与刷新', { timeout: 45000 }, async t => {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)];
      res.writeHead(200, { 'Content-Type': `${type ?? 'application/octet-stream'}; charset=utf-8` }).end(await readFile(path));
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'fated-chrome-'));
  const child = spawn(chrome, ['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'], { stdio: 'ignore' });
  let spawnError;
  child.on('error', e => { spawnError = e; });
  let socket;
  t.after(async () => {
    socket?.close();
    child.kill();
    server.close();
    await pause(400);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  });
  const port = await until(async () => {
    if (spawnError) throw spawnError;
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; }
  }, 'Chrome CDP 端口');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  });
  let serial = 0;
  const responses = new Map(), pageErrors = [], consoleErrors = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const reply = responses.get(m.id); responses.delete(m.id);
      if (m.error) reply.reject(new Error(`${reply.method}: ${m.error.message}`)); else reply.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.description ?? a.value));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    responses.set(++serial, { method, resolve, reject }); socket.send(JSON.stringify({ id: serial, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false });
  const run = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const get = s => `document.querySelector(${JSON.stringify(s)})`;
  const click = async (selector, hover = false) => {
    const box = await run(`(() => { const el = ${get(selector)}; if (!el) return null; el.scrollIntoView({block:'center',inline:'center'});
      const r=el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, clickable:!el.disabled && el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) }; })()`);
    assert.ok(box?.clickable, `可点击 ${selector}: ${JSON.stringify(box)}`);
    const { x, y } = box;
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
    if (hover) return;
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
  };
  const select = (selector, value) => run(`(() => { const input = ${get(selector)}; input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const state = () => run('window.FatedTacticalGame.getBattleState()');
  const actor = async () => { const s = await state(); return s.units[s.order[s.turn]]; };
  const cell = (x, y) => `#board [data-x="${x}"][data-y="${y}"]`;
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tavern.html` });
  await until(() => run('!!window.__fatedTacticalTavern'), '酒馆控制台加载');
  await run(`(async () => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    document.body.append(iframe);
    const bundle = await (await fetch('/dist/tavern.iife.js')).text();
    iframe.contentWindow.eval(bundle);
    const battle = '<battle_init>\\nbattle|1|chrome-host|酒馆联调|terrain|12\\nunit|p1|blue|mvu:主角|玩家|2,2\\nunit|e1|red|char_info|对手|7,7\\n</battle_init>';
    const messages = [
      {message_id:0, role:'assistant', message:'<char_info>{"name":"对手","stats":{"agi":-20}}</char_info>' + battle},
      {message_id:1, role:'assistant', message:'后续叙事'},
    ];
    window.hostCalls = [];
    window.getLastMessageId = () => 1;
    window.getChatMessages = (range) => { window.hostRange = range; return range === '0-1' ? messages : [messages.at(-1)]; };
    window.Mvu = {getMvuData({message_id}) {
      hostCalls.push(message_id);
      return {stat_data:{主角:{属性:{敏捷:50},生命值:{当前:321,上限:321},装备:{旧弩:{类型:'武器',位置:'主手',标签:['弩','攻击: 14'],效果:{恒定拉距:'弩箭攻击恒定为10'}}}}}};
    }};
    window.generateRaw = async config => new Promise((resolve,reject) => {
      window.hostRequests ||= [];
      hostRequests.push(config);
      window.completeHostAI = () => {
        if (hostRequests.length === 1) return reject(new Error('联调模拟网络错误'));
        if (hostRequests.length === 2) return resolve(JSON.stringify({ patch: [{ op: 'replace', path: '/stat_data/主角/attack', value: 999 }] }));
        const {equipment} = JSON.parse(config.ordered_prompts.at(-2).content);
        const id = Object.keys(equipment).find(id => equipment[id].name === '旧弩');
        resolve(JSON.stringify({patch:[{op:'replace',path:'/equipment/'+id+'/attack',value:10}]}));
      };
    });
  })()`);
  await click('.fated-tavern-launcher');
  await until(() => run('window.hostRequests?.length === 1'), '有警告自动调用酒馆助手');
  assert.equal(await run('window.hostRange'), '0-1');
  assert.deepEqual(await run('window.hostCalls'), [0]);
  assert.equal(await run(`document.querySelector('.fated-toast strong').textContent`), '正在标准化中…');
  assert.equal(await run('hostRequests[0].should_stream'), false);
  await run('window.__fatedTacticalTavern.scan()');
  assert.equal(await run('window.hostRequests.length'), 1);
  assert.equal(await run(`document.querySelector('.fated-toast strong').textContent`), '正在标准化中…');
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent === '标准化失败'`), '错误提示');
  assert.match(await run(`document.querySelector('.fated-toast p').textContent`), /联调模拟网络错误/);
  await click('.fated-toast button');
  await until(() => run('hostRequests.length === 2'), '重试请求');
  await run('window.completeHostAI()');
  await until(() => run('hostRequests.length === 3'), '自动纠正模型补丁');
  assert.match(await run('hostRequests[2].ordered_prompts.at(-1).content'), /stat_data/);
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent === '标准化完成'`), '应用校验补丁');
  await click('.fated-toast button:nth-of-type(2)');
  await click('[data-tab="sandbox"]');
  const tavernState = () => run('window.__fatedTacticalTavern.getState()');
  let imported = await tavernState();
  assert.equal(imported.title, '酒馆联调');
  assert.equal(imported.order[0], 'p1');
  assert.equal(imported.units.p1.ap, 2);
  assert.equal(imported.units.p1.hp, 321);
  assert.equal(imported.equipment[imported.items[imported.units.p1.mainHand].templateId].attack, 10);
  assert.equal(await run(`document.querySelector('#scenario-select').options.length`), 0);
  assert.equal(await run(`document.querySelectorAll('#seed-input').length`), 1);
  assert.equal(await run(`document.querySelector('#seed-input').value`), '12');
  await select('#seed-input', '13');
  await click('#reset-button');
  const restarted = await tavernState();
  assert.equal(restarted.title, imported.title);
  assert.notDeepEqual(restarted.grid, imported.grid);
  assert.equal(restarted.units.p1.ap, 2);
  assert.equal(restarted.equipment[restarted.items[restarted.units.p1.mainHand].templateId].attack, 10);
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(() => run('!!window.FatedTacticalGame && document.querySelectorAll("#board .tactical-cell").length === 100'), '100 格棋盘加载');
  await click('#auto-ai');
  await select('#scenario-select', 'altar');
  assert.match(await run(`${get('#scenario-preview')}.textContent`), /坡道/);
  await click('#reset-button');
  assert.equal((await state()).scenarioId, 'altar');
  assert.ok(await run('document.querySelectorAll("#board .terrain-slope").length >= 2'));
  await select('#scenario-select', 'ruins'); await click('#reset-button');
  assert.equal((await state()).scenarioId, 'ruins');
  const layout = await run(`(() => { const board = ${get('#board')}.getBoundingClientRect(), box = ${get('.axis-scroll')}.getBoundingClientRect(), side = ${get('.battle-sidebar')}.getBoundingClientRect();
    return {cells:document.querySelectorAll('#board .tactical-cell').length, covers:document.querySelectorAll('#board .tactical-cover').length,
    items:document.querySelectorAll('#board .tactical-interact').length, fit:board.width>350&&board.left>=box.left&&board.right<=box.right+1&&box.right<=side.left,
    spill:document.documentElement.scrollWidth>innerWidth }; })()`);
  assert.deepEqual(layout, { cells:100, covers:4, items:4, fit:true, spill:false });
  const actions = type => `#action-toolbar [data-action="${type}"]`;
  assert.equal((await actor()).id, 'swordsman');
  assert.ok(await run(`${get(cell(2, 2))}.classList.contains('is-reachable')`));
  await click(cell(1, 2));
  assert.match(await run(`${get('#sprint-indicator')}.textContent`), /疾跑范围/);
  await click(cell(1, 2));
  const scrollBefore = await run('scrollY');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
  assert.equal(await run(`${get('#target-actions')}.hidden`), true);
  assert.equal(await run('scrollY'),scrollBefore);
  await click(cell(2, 2)); assert.equal((await state()).units.swordsman.x, 1);
  await click(actions('move')); assert.equal((await state()).units.swordsman.x, 2);
  await click(cell(3, 2)); await click(actions('attack'));
  assert.match(await run(`${get('#tactical-preview')}.textContent`), /dXYZ|命中/);
  await click('#confirm-action');
  assert.equal((await state()).units.scout.hp, 0);
  assert.equal((await state()).items['soulblade-lan'].counters.souls, 1);
  for (let step = 0; (await actor()).id !== 'swordsman'; step++) {
    assert.ok(step < 20, '先攻队列应回到剑客');
    if ((await actor()).team === 'red') {
      const n = (await state()).logs.length;
      await click('#ai-step'); assert.ok((await state()).logs.length > n);
    } else await click('#end-turn');
  }
  await click(cell(2, 3)); await click(actions('interact'));
  assert.equal((await state()).interactives.I1.spent, true);
  assert.ok((await state()).units.swordsman.statuses.haste);
  await click(cell(2, 2)); await click('#action-toolbar [data-skill-id="armor"]'); await click('#confirm-action');
  assert.ok((await state()).units.swordsman.statuses.thorns);
  await click('#api-sandbox summary'); await click('[data-example="counter"]'); await click('#sandbox-preview');
  assert.match(await run(`${get('#sandbox-output')}.textContent`), /souls/);
  assert.equal((await state()).items['soulblade-lan'].counters.souls, 1);
  await click('#sandbox-commit'); assert.equal((await state()).items['soulblade-lan'].counters.souls, 2);
  await click('#sandbox-undo'); assert.equal((await state()).items['soulblade-lan'].counters.souls, 1);
  await click('[data-example="custom-status"]'); await click('#sandbox-preview');
  assert.match(await run(`${get('#sandbox-output')}.textContent`), /bone_frost/);
  assert.equal((await state()).statusTemplates, undefined);
  await click('#sandbox-commit');
  assert.equal((await state()).statusTemplates.bone_frost.name, '蚀骨寒霜');
  assert.ok(Object.values((await state()).units).some(u=>u.statuses.bone_frost));
  await click('#sandbox-undo'); assert.equal((await state()).statusTemplates, undefined);
  await send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath: profile });
  await click('#export-report');
  assert.equal(await run(`${get('#report-dialog')}.open`), true);
  assert.match(await run(`${get('#report-text')}.value`), /回合一[\s\S]*确定先攻次序[\s\S]*受伤斥候倒下/);
  await click('#download-report');
  const reportFile = join(profile, 'fated-ruins-report.txt');
  const reportText = await until(async () => { try { return await readFile(reportFile, 'utf8'); } catch { return null; } }, '战报 TXT 下载');
  assert.equal(reportText, await run(`${get('#report-text')}.value`));
  await click('#report-dialog form button');
  await click('#export-snapshot');
  const download = join(profile, 'fated-ruins-battle.json');
  const exported = await until(async () => { try { return JSON.parse(await readFile(download, 'utf8')); } catch { return null; } }, '快照下载');
  assert.deepEqual(exported.state, await state());
  await click('#reset-button'); assert.notDeepEqual(await state(), exported.state);
  const { root: { nodeId } } = await send('DOM.getDocument');
  const { nodeId: inputId } = await send('DOM.querySelector', { nodeId, selector:'#import-snapshot' });
  await send('DOM.setFileInputFiles', { nodeId: inputId, files:[download] });
  await until(async () => (await state()).items['soulblade-lan'].counters.souls === 1, '导入恢复');
  assert.deepEqual(await state(), exported.state);
  await send('Page.reload');
  await until(() => run('!!window.FatedTacticalGame && document.querySelectorAll("#board .tactical-cell").length === 100'), '刷新恢复');
  assert.deepEqual(await state(), exported.state);
  let red = await actor();
  for (let i=0; red.team !== 'red' && i<8; i++) { await click('#end-turn'); red = await actor(); }
  assert.equal(red.team,'red');
  const logsBeforeAuto = (await state()).logs.length;
  await select('#ai-speed','80'); await click('#auto-ai');
  await until(async () => (await state()).logs.length > logsBeforeAuto, '自动敌方回合');
  await click('#auto-ai');
  await send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath: profile });
  await click('#export-persistent');
  const carry = join(profile, 'fated-ruins-persistent.json');
  await until(async () => { try { return JSON.parse(await readFile(carry, 'utf8')); } catch { return null; } }, '跨战文件下载');
  await select('#scenario-select', 'boss');
  const doc = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', { nodeId:doc.root.nodeId, selector:'#import-snapshot' });
  await send('DOM.setFileInputFiles', { nodeId:input.nodeId, files:[carry] });
  await until(async () => (await state()).scenarioId === 'boss', '导入跨战文件');
  assert.equal((await state()).items['soulblade-lan'].counters.souls,1);
  await run(`(() => {
    const g=window.FatedTacticalGame;
    const p=g.proposeCommands([{type:'set_unit_stat',unitId:'colossus',patch:{x:2,y:4}}],{baseRevision:g.getStateSummary().revision,reason:'测试撤离'});
    if (!p.ok || !g.commitProposal(p.proposalId).ok) throw new Error(p.error);
  })()`);
  await click(cell(0,3));
  assert.match(await run(`${get('#tactical-preview')}.textContent`), /借机风险.*守门巨像/);
  await click(actions('disengage')); assert.equal((await state()).units.swordsman.x,0);
  assert.equal((await state()).logs.some(e=>e.type==='opportunity'),false);
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:850, deviceScaleFactor:1, mobile:false });
  assert.deepEqual(await run('({pageFits:document.documentElement.scrollWidth<=innerWidth, gridScrollable:document.querySelector(".axis-scroll").scrollWidth>document.querySelector(".axis-scroll").clientWidth})'), {pageFits:true,gridScrollable:true});
  await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 });
  const tap = async selector => {
    const box = await run(`(() => { const e=${get(selector)}; e.scrollIntoView({block:'center',inline:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[box]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await tap(cell(0,3));
  await until(() => run(`!${get('#target-actions')}.hidden`), '触屏打开目标动作');
  assert.ok(await run(`(() => {
    const a=${get(cell(0,3))}.getBoundingClientRect(), c=${get('#target-actions')}.getBoundingClientRect();
    const separation=Math.max(a.left-c.right,c.left-a.right,a.top-c.bottom,c.top-a.bottom);
    return separation>=4 && separation<=10 && c.left>=0 && c.right<=innerWidth && c.top>=0 && c.bottom<=innerHeight && c.width<innerWidth*.8;
  })()`), '触屏浮卡紧贴目标且不盖住目标格');
  assert.ok(await run(`${get(actions('brace'))}.getBoundingClientRect().height>=44`));
  await tap(actions('brace'));
  await until(async () => (await state()).units.swordsman.statuses.guarded, '触屏施放架势');
  await click('#resource-button');
  await run(`${get('#resource-input')}.value = JSON.stringify({stats:{str:7,agi:21,con:6,int:4,spi:4},tier:1,previous:{hp:{current:22,max:44}}})`);
  await click('#calculate-resources');
  assert.match(await run(`${get('#resource-output')}.textContent`), /HP 321\/642/);
  await click('#resource-dialog form button');
  assert.deepEqual({ pageErrors, consoleErrors }, { pageErrors:[], consoleErrors:[] });
  t.diagnostic('实测 100 格、4 掩体、4 互动点；1440px 无重叠，390px 仅棋盘内部横滚；0 pageerror / 0 console.error');
});
