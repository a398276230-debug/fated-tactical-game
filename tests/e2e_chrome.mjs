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
  const normalizationRequests = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/csrf-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'test-csrf' }));
        return;
      }
      if (url.pathname.startsWith('/api/backends/chat-completions/')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        if (body.custom_url === 'https://normalization.example.test/v1') {
          const valid = req.method === 'POST' && req.headers['x-csrf-token'] === 'test-csrf'
            && body.chat_completion_source === 'custom'
            && JSON.parse(body.custom_include_headers).Authorization === 'Bearer normalization-test';
          let data;
          if (!valid) data = { error: { message: 'unexpected normalization credentials' } };
          else if (url.pathname.endsWith('/status')) data = { data: [{ id: 'normalization-model' }] };
          else if (body.model !== 'normalization-model') data = { error: { message: 'unexpected normalization model' } };
          else if (body.messages.at(-1).content === '只回复 OK') data = { choices: [{ message: { content: 'OK' } }] };
          else {
            normalizationRequests.push(body.messages);
            const content = normalizationRequests.length === 2 ? '{"patch":[]}' : JSON.stringify({ patch: [
              { op: 'replace', path: '/units/p1/armor', value: 7 },
              { op: 'replace', path: '/skills/missing/rules', value: [{ op: 'bad_op' }] },
            ], unresolved: ['模拟待处理项'] });
            data = { choices: [{ message: { content } }] };
          }
          res.writeHead(data.error ? 400 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
          return;
        }
        const valid = req.method === 'POST' && req.headers['x-csrf-token'] === 'test-csrf'
          && body.chat_completion_source === 'custom' && body.custom_url === 'https://upstream.example.test/v1'
          && JSON.parse(body.custom_include_headers).Authorization === 'Bearer aux-test';
        const data = url.pathname.endsWith('/status') ? { data: [{ id: 'aux-model' }] }
          : body.model === 'aux-model' ? { choices: [{ message: { content: 'OK' } }] } : { error: { message: 'unexpected model' } };
        res.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        return;
      }
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
    // 新界面把次要控件收在抽屉里：先像玩家一样点开对应抽屉
    const drawer = await run(`(() => { const el = ${get(selector)}; for (let d = el?.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
      const d = el?.closest('aside[data-drawer]'); if (!d) { const open = document.querySelector('aside[data-drawer]:not([hidden]) [data-close-drawer]'); open?.click(); }
      return d?.hidden ? d.dataset.drawer : null; })()`);
    if (drawer) await click(`[data-open-drawer="${drawer}"]`);
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
  const souls = async () => {
    const battle = await state();
    return battle.pools[battle.items['soulblade-lan'].pools.souls].current;
  };
  const actor = async () => { const s = await state(); return s.units[s.order[s.turn]]; };
  const cell = (x, y) => `#board [data-x="${x}"][data-y="${y}"]`;
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tavern.html` });
  await until(() => run('!!window.__fatedTacticalTavern'), '酒馆控制台加载');
  await run(`(async () => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    document.body.append(iframe);
    const bundle = await (await fetch('/dist/tavern.iife.js')).text();
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    window.SillyTavern = { substituteParams: macro => macro === '{{userAvatarPath}}' ? pixel : macro };
    window.getCurrentCharacterName = () => '头像测试卡';
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('status-avatar-db', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('avatars', { keyPath:'key' }).createIndex('scope_key', 'scope_key');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('avatars', 'readwrite');
        tx.objectStore('avatars').put({ key:'status:头像测试卡::partner::对手', scope_key:'status:头像测试卡', owner_type:'partner', owner_name:'对手', source_type:'upload', value:pixel });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    window.hostEvents = new Map();
    window.eventOn = (name, fn) => { hostEvents.set(name, fn); return () => hostEvents.delete(name); };
    iframe.contentWindow.eval(bundle);
    const battle = '<battle_init>\\nbattle|1|chrome-host|酒馆联调|terrain|1\\nunit|p1|blue|mvu:主角|玩家|2,2\\nunit|e1|red|char_info|对手|7,7\\nunit|e2|red|char_info|对手|8,7\\n</battle_init>';
    window.battleFixture = battle;
    window.overlayFrame = iframe;
    window.overlayBundle = bundle;
    const messages = window.hostMessages = [
      {message_id:0, role:'assistant', message:'<char_info>{"name":"对手","原始资料校验":"对手私有原文","stats":{"agi":-20},"装备":{"木弩":{"类型":"武器","位置":"主手","标签":["弩","攻击: 10"],"效果":{"恒定发射":"以稳定机括发射钝头木矢，攻击力恒定为10。"}}}}</char_info>' + battle},
      {message_id:1, role:'assistant', message:'后续叙事'},
    ];
    window.hostCalls = [];
    window.emitMvuUpdate = () => hostEvents.get('mag_variable_update_ended')?.(Mvu.getMvuData({message_id:0}));
    window.getLastMessageId = () => messages.at(-1).message_id;
    window.getChatMessages = (range) => { window.hostRange = range; return messages; };
    window.Mvu = {getMvuData({message_id}) {
      hostCalls.push(message_id);
      // The new clauses belong to floor 4; reopening floor 0 reads its own equipment text.
      const effects = message_id >= 4 ? window.extraBowEffects : undefined;
      return {stat_data:{主角:{原始资料校验:'玩家私有原文',属性:{敏捷:50},生命值:{当前:window.narrativeHp ?? 321,上限:321},背包:window.battleBag,装备:{...window.reserveWeapons,旧弩:{类型:'武器',位置:'主手',标签:['弩','攻击: 14'],效果:{恒定拉距:'弩箭攻击恒定为10',...effects}}}}}};
    }};
    window.generateRaw = async config => new Promise((resolve,reject) => {
      window.hostRequests ||= [];
      // Independent enemy lane. Keep the manually stepped transcript below specific to the player.
      const live=window.__fatedTacticalTavern.getState();
      const enemy=live.warnings.find(w=>w.unitId==='e1' && w.message.includes('恒定发射'));
      const warningSlot=config.ordered_prompts.find(m=>m.content.includes('待处理警告：'))?.content.split('待处理警告：').at(-1);
      if (enemy && warningSlot?.includes(JSON.stringify(enemy.message))) {
        const calls=window.enemyRequests??=[]; calls.push(config);
        if (calls.length<=2) return resolve('无有效补丁');
        const {unitId,originPath,message}=enemy, id=originPath.split('/').at(-1);
        return resolve(JSON.stringify({patch:[{op:'replace',path:originPath+'/rules',resolves:[{unitId,originPath,message}],value:[...live.equipment[id].rules,
          {id:'fixed-shot',hook:'before_commit',filter:"event.actorId == self.id && event.actionType == 'attack' && event.weaponTemplateId == '"+id+"' && event.damageType == 'physical'",program:[{op:'mutate_event',patch:{finalAmount:10}}]}]}]}));
      }
      hostRequests.push(config);
      window.completeHostAI = () => {
        if (hostRequests.length === 1 || hostRequests.length === 2) return resolve('推理草稿：先分析冰冻箭和恒定发射，然后输出 {"patch":');
        const state = window.__fatedTacticalTavern.getState();
        const id = state.items[state.units.p1.mainHand].templateId;
        if (!config.ordered_prompts.some(m => m.role === 'system' && m.content.includes(JSON.stringify(id)) && m.content.includes('旧弩'))) return reject(new Error('系统槽位缺少战局装备快照'));
        const warning = state.warnings.find(w => w.message.includes('恒定拉距'));
        const resolves = warning ? [{unitId:warning.unitId, originPath:warning.originPath, message:warning.message}] : [];
        const fixedShot = templateId => ({
          id:'fixed-shot', hook:'before_commit',
          filter:"event.actorId == self.id && event.actionType == 'attack' && event.weaponTemplateId == '"+templateId+"' && event.damageType == 'physical'",
          program:[{op:'mutate_event',patch:{finalAmount:hostRequests.length === 6 ? 14 : 10}}],
        });
        const rulePatch = (path, resolves) => {
          const templateId = path.split('/').at(-1);
          return {op:'replace',path:path+'/rules',value:[...state.equipment[templateId].rules,fixedShot(templateId)],resolves};
        };
        const patch = [rulePatch('/equipment/'+id,resolves)];
        const unresolved = state.warnings.filter(w => w.message.includes('冰冻箭')).map(({unitId,originPath,message}) =>
          ({unitId,originPath,message,effectName:'冰冻箭',reason:'仍缺冰冻持续时间'}));
        if (hostRequests.length === 4 && unresolved.length) {
          const {unitId,originPath,message} = unresolved[0];
          patch.unshift({op:'add',path:'/statusTemplates/freeze',value:{id:'freeze',name:'冰冻',category:'control',mods:[{locks:['attack','action','move','cast']}]}});
          patch.push({op:'add',path:originPath+'/rules/-',resolves:[{unitId,originPath,message}],value:{
            id:'ice-partial',hook:'after_hit',filter:'attacker.id == self.id',
            program:[{op:'apply_status',target:'target',statusId:'freeze'}],
          }});
        }
        if (hostRequests.length === 4) {
          const missing = state.warnings.find(w => w.message.includes('震荡尾音'));
          if (missing) unresolved.push({unitId:missing.unitId,originPath:missing.originPath,message:missing.message,
            reason:'原文没有写持续时间',kind:'missing_info'});
          patch.find(operation => operation.op === 'replace').value.at(-1).program = [{op:'mutate_event'}];
          patch.push({op:'add',path:'/statusTemplates/repair_probe',value:{id:'repair_probe',name:'校验探针',category:'special'}});
          unresolved.push({unitId:'p1',originPath:'/equipment/typo',effectName:'写错引用',reason:'缺少细节'});
        }
        resolve(JSON.stringify(hostRequests.length === 5 ? {unresolved:[{unitId:'p1',originPath:'/equipment/typo',effectName:'写错引用',reason:'缺少细节'}]} : {patch, unresolved}));
      };
    });
  })()`);
  const launcherBefore = await run(`(() => { const r=document.querySelector('.fated-tavern-launcher').getBoundingClientRect(); return {left:r.left,top:r.top}; })()`);
  await run(`(() => { const b=document.querySelector('.fated-tavern-launcher'); const fire=(type,x,y)=>b.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:9,button:0,clientX:x,clientY:y})); fire('pointerdown',${launcherBefore.left+20},${launcherBefore.top+20}); fire('pointermove',${launcherBefore.left+120},${launcherBefore.top+70}); fire('pointerup',${launcherBefore.left+120},${launcherBefore.top+70}); })()`);
  const launcherAfter = await run(`(() => { const r=document.querySelector('.fated-tavern-launcher').getBoundingClientRect(); return {left:r.left,top:r.top,hidden:document.querySelector('.fated-tavern-launcher').hidden}; })()`);
  assert.ok(launcherAfter.left !== launcherBefore.left || launcherAfter.top !== launcherBefore.top, JSON.stringify({ launcherBefore, launcherAfter, style: await run(`document.querySelector('.fated-tavern-launcher').getAttribute('style')`) }));
  assert.equal(launcherAfter.hidden, false);
  assert.equal(await run('document.querySelector(".fated-tavern-panel").hidden'), true);
  await run('document.querySelector(".fated-tavern-launcher").removeAttribute("data-dragged")');
  await click('.fated-tavern-launcher');
  await until(() => run('window.hostRequests?.length === 1'), '有警告自动调用酒馆助手').catch(async error => { throw new Error(`${error.message}: ${await run('window.__fatedTacticalTavern.getDiagnostics().error')} / ${pageErrors.join('\n')} / ${consoleErrors.join('\n')}`); });
  await until(() => run(`['p1', 'e1'].every(id => {
    const image = document.querySelector('#board [data-unit-id="' + id + '"] .axis-unit-portrait');
    return image && !image.hidden && image.naturalWidth > 0 && getComputedStyle(image.nextElementSibling).visibility === 'hidden';
  })`), '主角酒馆头像与对手本地立绘显示在兵牌上').catch(async error => {
    throw new Error(`${error.message} ${await run(`JSON.stringify([...document.querySelectorAll('#board [data-unit-id]')].map(n => [n.dataset.unitId, n.querySelector('img')?.outerHTML]))`)}`);
  });
  assert.equal(await run(`document.querySelectorAll('article.fated-instance').length`), 2);
  assert.match(await run(`${get('.fated-instance[data-unit-id="e1"]')}.textContent`), /×2/);
  assert.equal(await run(`window.__fatedTacticalTavern.getDiagnostics().warnings.filter(w => w.message.includes('恒定发射')).length`), 1);
  assert.match(await run(`${get('article.fated-instance')}.textContent`), /体型 中型 \(1\.7m\)/);
  const cardWarnings = '.fated-instance[data-unit-id="p1"] .fated-char-diagnostics';
  assert.match(await run(`${get(cardWarnings)}.textContent`), /待编译词条（1 项）.*恒定拉距/);
  assert.doesNotMatch(await run(`${get(cardWarnings)}.textContent`), /请用 VM|\/statusTemplates/);
  // 实例卡：三色资源条、折叠后只剩卡头，状态刷新后保留
  const card = '.fated-instance[data-unit-id="p1"]';
  assert.deepEqual(await run(`[...document.querySelectorAll('${card} .fated-char-bar')].map(b => b.className.split(' ').pop())`), ['is-hp', 'is-mp', 'is-sp']);
  await run(`document.querySelector('${card} .fated-char-toggle').click()`);
  assert.deepEqual(await run(`({ hidden: document.querySelector('${card} .fated-char-body').hidden, mini: getComputedStyle(document.querySelector('${card} .fated-char-mini')).display !== 'none' })`), { hidden: true, mini: true });
  await run(`document.querySelector('[data-fold-all="false"]').click()`);
  assert.equal(await run(`document.querySelector('${card} .fated-char-body').hidden`), false);
  await run(`document.querySelector('[data-fold-all="true"]').click()`);
  assert.equal(await run(`[...document.querySelectorAll('.fated-instance .fated-char-body')].every(b => b.hidden)`), true);
  await run(`document.querySelector('[data-fold-all="false"]').click()`);
  assert.equal(await run('window.hostRange'), '0-1');
  assert.deepEqual(await run('window.hostCalls'), [0]);
  assert.equal(await run(`document.querySelector('.fated-toast strong').textContent`), '正在标准化中…');
  assert.equal(await run('hostRequests[0].should_stream'), true);
  await run('window.__fatedTacticalTavern.scan()');
  assert.equal(await run('window.hostRequests.length'), 1);
  assert.equal(await run(`document.querySelector('.fated-toast strong').textContent`), '正在标准化中…');
  await run('window.completeHostAI()');
  await until(() => run('hostRequests.length === 2'), '自动纠正模型补丁');
  assert.doesNotMatch(await run('hostRequests[1].ordered_prompts.at(-1).content'), /推理草稿/);
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent === '标准化失败'`), '错误提示');
  assert.match(await run(`document.querySelector('.fated-toast > p:not(.fated-toast-summary)').textContent`), /模型未返回有效的战局补丁/);
  assert.equal(await run(`document.querySelector('.fated-toast-summary').textContent`), '已应用 0 项补丁');
  assert.match(await run(`document.querySelector('.fated-toast-issues').textContent`), /待编译词条（2 项）.*恒定拉距.*恒定发射/);
  assert.equal(await run(`!!document.querySelector('.fated-toast-raw')`), false);
  await run('window.__fatedTacticalTavern.scan()');
  assert.equal(await run('hostRequests.length'), 2);
  await click('.fated-toast button');
  await until(() => run('hostRequests.length === 3'), '重试请求');
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent === '标准化完成'`), '应用校验补丁');
  await click('.fated-toast button:nth-of-type(2)');
  for (const rescan of [false,true]) {
    if(rescan) await run('window.__fatedTacticalTavern.scan()');
    assert.equal(await run(`!!${get(cardWarnings)}`),false);
    assert.deepEqual(await run(`window.__fatedTacticalTavern.getState().warnings.filter(w=>w.unitId==='p1')`),[]);
    assert.equal(await run('hostRequests.length'),3);
  }
  const tavernState = () => run('window.__fatedTacticalTavern.getState()');
  const activeStorageKey = () => run('window.__fatedTacticalTavern.getSources().battleKey');
  const savedBattleKeys = () => run(`Object.keys(localStorage).filter(k => k.endsWith('/fated-tactical/battle-v1'))`);
  const assertCurrentBattleStorage = async key => {
    assert.deepEqual(await savedBattleKeys(), [`fated-tactical/${key}/fated-tactical/battle-v1`]);
    const storage = await run('window.__fatedTacticalTavern.getDiagnostics().storage');
    const count = await run(`Object.keys(localStorage).filter(k => k.startsWith('fated-tactical/')).length`);
    assert.equal(storage.activeBattleKey, key);
    assert.equal(storage.keyCount, count);
    assert.equal(Object.values(storage.categories).reduce((sum, bytes) => sum + bytes, 0), storage.totalBytes);
    assert.ok(storage.categories.battleSnapshotBytes > 0 && storage.categories.openingSourceBytes > 0);
    assert.deepEqual(await run(`JSON.parse(document.querySelector('[data-diagnostics]').textContent).storage`), storage);
  };
  assert.equal(await run('enemyRequests.length'),3,'敌方独立泳道经历首次失败、一次返修和手动重试');
  const opening = await tavernState();
  assert.deepEqual(await run(`JSON.parse(document.querySelector('[data-diagnostics]').textContent).scale`), opening.scale);
  const openingBow = state => state.equipment[state.items[state.units.p1.mainHand].templateId];
  const notesKey = await run(`Object.keys(localStorage).find(k => k.startsWith('fated-tactical/tavern/') && k.split('/').length === 3) + '/unresolvedNotes'`);
  const originalKey = await activeStorageKey();
  const notesA = { p1: { example: { reason: '原战局需确认' } } };
  const notesB = { p1: { example: { reason: '新战局需确认' } } };
  const seedNotes = record => run(`localStorage.setItem(${JSON.stringify(notesKey)}, ${JSON.stringify(JSON.stringify(record))})`);
  await seedNotes({ [originalKey]: notesA });
  await run(`hostMessages.push({message_id:8,role:'assistant',message:battleFixture.replace('chrome-host','chrome-reuse')});
    window.__fatedTacticalTavern.open()`);
  await until(async () => (await tavernState())?.scenarioId === 'chrome-reuse', '新战场复用同一聊天的条目补丁');
  assert.deepEqual(openingBow(await tavernState()), openingBow(opening));
  assert.equal(await run('hostRequests.length'), 3);
  const reuseKey = await activeStorageKey();
  const notes = () => run('window.__fatedTacticalTavern.getConfig().unresolvedNotes');
  assert.deepEqual(await notes(), { [originalKey]: notesA }, '空战局不写入空说明');
  await seedNotes({ [originalKey]: notesA, [reuseKey]: notesB });
  await run(`hostMessages.pop(); window.__fatedTacticalTavern.open()`);
  await until(async () => (await tavernState())?.scenarioId === opening.scenarioId, '返回原战场');
  assert.deepEqual(await notes(), { [reuseKey]: notesB }, '返回原战局清除已核销的说明，但保留另一场说明');
  await run(`document.querySelector('[data-tab="sandbox"]').click();
    const auto = document.querySelector('#auto-ai'); if (auto.checked) auto.click();
    document.querySelector('#end-turn').click();`);
  const halfBattle = await tavernState();
  assert.ok(halfBattle.logs.length > opening.logs.length);
  await run(`const draft = document.createElement('textarea'); draft.id = 'send_textarea'; document.body.append(draft);
    document.querySelector('[data-page="sandbox"] > .fated-actions button').click();`);
  assert.match(await run(`document.querySelector('#send_textarea').value`), /战斗尚未结束/);
  assert.equal(await run(`document.querySelector('.fated-tavern-panel').hidden`), true);
  await run(`window.narrativeHp=123; window.extraBowEffects={冰冻箭:'命中后冰冻目标',震荡尾音:'命中后令目标晕眩'};
    hostMessages.push({message_id:2,role:'user',message:document.querySelector('#send_textarea').value},
      {message_id:3,role:'assistant',message:'续写<char_info>{"name":"对手","stats":{"agi":99}}</char_info>'});
    document.querySelector('#send_textarea').remove(); window.emitMvuUpdate();
    window.__fatedTacticalTavern.open();`);
  await run('window.__fatedTacticalTavern.scan()');
  assert.deepEqual(await tavernState(), halfBattle);
  assert.equal(await run('hostRequests.length'), 3);
  await run(`(async () => { const frame = document.createElement('iframe'); frame.hidden = true;
    document.body.append(frame); frame.contentWindow.eval(overlayBundle); overlayFrame.remove(); window.overlayFrame = frame;
    await window.__fatedTacticalTavern.open(); })()`);
  assert.deepEqual(await tavernState(), halfBattle);
  assert.equal(await run('hostRequests.length'), 3);
  const hostBattleKey = await activeStorageKey();
  await assertCurrentBattleStorage(hostBattleKey);
  await run(`hostMessages.push({message_id:4,role:'assistant',message:battleFixture.replace('chrome-host','chrome-next')});
    window.__fatedTacticalTavern.open()`);
  await until(() => run('hostRequests.length === 4'), '新战场发起首次自动标准化');
  const nextBattleKey = await activeStorageKey();
  assert.notEqual(nextBattleKey, hostBattleKey);
  await assertCurrentBattleStorage(nextBattleKey);
  assert.equal(await run(`localStorage.getItem(${JSON.stringify(`fated-tactical/${hostBattleKey}/opening-source`)})`), null);
  assert.deepEqual(await run('Object.keys(window.__fatedTacticalTavern.getConfig().charSnapshots)'), [nextBattleKey]);
  assert.equal(await run(`localStorage.getItem('fated-tactical/auto')`), 'false');
  assert.equal(await run(`Object.keys(localStorage).some(k => k.endsWith('/fated-tactical/auto'))`), false);
  assert.equal((await tavernState()).units.p1.hp, 123);
  await run('window.completeHostAI()');
  await until(() => run('hostRequests.length === 5'), '拒收项自动修复');
  const repairPrompt = await run('hostRequests[4].ordered_prompts.at(-1).content');
  assert.match(repairPrompt, /mutate_event/);
  assert.match(repairPrompt, /patch/);
  const partialState = await tavernState();
  assert.equal(partialState.statusTemplates?.repair_probe?.name, '校验探针', '坏收据未回滚同批模板');
  assert.ok(openingBow(partialState).rules.some(rule => rule.id === 'ice-partial'), '坏收据未回滚同批战斗规则');
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent.startsWith('标准化部分完成')`), '保留部分结果与漏答警告');
  const reviewedSelector = '[data-normalization-diagnostics="approximated"]';
  const pendingSelector = '[data-normalization-diagnostics="pending"]';
  const toastIssues = await run(`document.querySelector('.fated-toast-issues').textContent`);
  assert.match(toastIssues, /待编译词条（1 项）.*恒定拉距/);
  assert.match(toastIssues, /已近似实装（1 项）.*「冰冻箭」.*仍缺冰冻持续时间/);
  assert.match(toastIssues, /无法唯一匹配本批词条/);
  assert.equal(toastIssues.match(/「冰冻箭」/g)?.length, 1);
  assert.doesNotMatch(toastIssues, /"unitId"|"originPath"|"reason"|请用 VM/);
  const playerCard = '.fated-instance[data-unit-id="p1"]';
  assert.match(await run(`${get(`${playerCard} ${pendingSelector}`)}.textContent`), /待编译词条（1 项）.*恒定拉距/);
  assert.match(await run(`${get(`${playerCard} ${reviewedSelector}`)}.textContent`), /「冰冻箭」.*仍缺冰冻持续时间/);
  assert.doesNotMatch(await run(`${get(`${playerCard} ${reviewedSelector} li`)}.title`), /请用 VM|\/statusTemplates/);
  await run(`(async () => { const frame = document.createElement('iframe'); frame.hidden = true;
    document.body.append(frame); frame.contentWindow.eval(overlayBundle); overlayFrame.remove(); window.overlayFrame = frame;
    await window.__fatedTacticalTavern.open(); await window.__fatedTacticalTavern.scan(); })()`);
  assert.match(await run(`${get(`${playerCard} ${reviewedSelector}`)}.textContent`), /「冰冻箭」.*仍缺冰冻持续时间/);
  assert.match(await run(`${get(`${playerCard} ${pendingSelector}`)}.textContent`), /待编译词条（1 项）.*恒定拉距/);
  assert.equal(await run('hostRequests.length'), 5);
  const attention = `${playerCard} [data-normalization-diagnostics="needsAttention"]`;
  const ignored = `${playerCard} [data-normalization-diagnostics="nonCombat"]`;
  assert.match(await run(`${get(attention)}.textContent`), /震荡尾音.*原文缺参/);
  assert.doesNotMatch(await run(`${get(`${playerCard} ${pendingSelector}`)}.textContent`), /震荡尾音/);
  const repairMessages = await run('hostRequests[4].ordered_prompts.map(prompt => prompt.content)');
  const reviewedMessage = await run(`window.__fatedTacticalTavern.getDiagnostics().warnings.find(w => w.message.includes('震荡尾音')).message`);
  assert.ok(repairMessages.every(content => !content.includes(JSON.stringify(reviewedMessage))), '已审阅词条不进修复批次');
  await run(`${get(`${attention} [data-warning-action="supplement"]`)}.click()`);
  assert.equal(await run(`${get('[data-tab="ai"]')}.getAttribute('aria-selected')`), 'true');
  assert.match(await run(`${get('[data-page="ai"] textarea[aria-label="输入消息"]')}.value`), /震荡尾音[\s\S]*原文没有写持续时间/);
  await run(`${get('[data-page="ai"] textarea[aria-label="输入消息"]')}.value = ''; ${get('[data-page="ai"] textarea[aria-label="输入消息"]')}.dispatchEvent(new Event('input')); ${get('[data-tab="instances"]')}.click()`);
  await run(`${get(`${attention} [data-warning-action="ignore"]`)}.click()`);
  assert.equal(await run(`!!${get(attention)}`), false);
  assert.match(await run(`${get(ignored)}.textContent`), /震荡尾音.*玩家已设为非战斗忽略/);
  await run(`(async () => { const frame = document.createElement('iframe'); frame.hidden = true;
    document.body.append(frame); frame.contentWindow.eval(overlayBundle); overlayFrame.remove(); window.overlayFrame = frame;
    await window.__fatedTacticalTavern.open(); })()`);
  assert.match(await run(`${get(ignored)}.textContent`), /震荡尾音/);
  await run(`${get(`${ignored} [data-warning-action="restore"]`)}.click()`);
  assert.equal(await run(`!!${get(ignored)}`), false);
  assert.match(await run(`${get(`${playerCard} ${pendingSelector}`)}.textContent`), /震荡尾音/);
  assert.equal(await run('hostRequests.length'), 5);

  await run(`(() => {
    const { renderBattleInitEntry } = overlayFrame.contentWindow.FatedTacticalTavern;
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const entry = frame.contentDocument;
    entry.body.insertAdjacentHTML('beforeend', renderBattleInitEntry(battleFixture));
    frame.contentWindow.eventEmit = (name, payload) => hostEvents.get(name)?.(payload);
    const script = entry.querySelector('script');
    const executable = entry.createElement('script'); executable.textContent = script.textContent;
    script.replaceWith(executable);
    entry.querySelector('button').click();
    frame.remove();
  })()`);
  await until(async () => (await tavernState())?.scenarioId === halfBattle.scenarioId, '旧楼入口重建原战场');
  const reopened = await tavernState();
  assert.equal(reopened.logs.length, opening.logs.length, '被淘汰的快照不会恢复战斗进度');
  assert.equal(reopened.units.p1.hp, 123, '从 MVU 重建开场而非恢复旧快照');
  assert.deepEqual(openingBow(reopened), openingBow(opening), '保留旧场标准化装备规则');
  assert.equal(await run('hostRequests.length'), 5, '回到旧楼不额外请求 AI');
  await assertCurrentBattleStorage(hostBattleKey);
  assert.equal(await run(`!!${get(`${playerCard} ${reviewedSelector}`)}`), false);
  // Whole-entry reset and reroll: restore the raw warning and only this
  // equipment root; sibling entries and combat progress remain intact.
  const rerollEntry = '.fated-instance[data-unit-id="p1"] .fated-entry-discard';
  assert.equal(await run(`document.querySelectorAll('${rerollEntry}').length`), 1);
  const combatBeforeReset = await tavernState();
  await run(`document.querySelector('${rerollEntry}').click()`);
  await until(() => run(`document.querySelector('${cardWarnings}').textContent.includes('恒定拉距')`), '重置后恢复原始警告');
  const afterReset = await tavernState();
  assert.equal(afterReset.logs.length, combatBeforeReset.logs.length);
  assert.equal(afterReset.units.p1.hp, combatBeforeReset.units.p1.hp);
  const itemTemplateId = afterReset.items[afterReset.units.p1.mainHand].templateId;
  assert.equal(afterReset.equipment[itemTemplateId].rules.length, 0);
  await run(`(async () => { const frame = document.createElement('iframe'); frame.hidden = true;
    document.body.append(frame); frame.contentWindow.eval(overlayBundle); overlayFrame.remove(); window.overlayFrame = frame;
    hostEvents.get('fated_tactical:open_ui')({messageId: 0}); })()`);
  await until(async () => (await tavernState())?.scenarioId === afterReset.scenarioId, '重载所选旧楼战场');
  assert.deepEqual(await tavernState(), afterReset);
  assert.match(await run(`${get(cardWarnings)}.textContent`), /恒定拉距/);
  assert.equal(await run(`document.querySelectorAll('${rerollEntry}').length`), 0);
  await run(`document.querySelector('[data-normalize]').click()`);
  await until(() => run('hostRequests.length === 6'), '重roll请求');
  await run('window.completeHostAI()');
  await until(() => run(`document.querySelector('.fated-toast strong').textContent === '标准化部分完成' || document.querySelector('.fated-toast strong').textContent === '标准化完成'`), '重roll应用补丁');
  assert.doesNotMatch(await run(`document.querySelector('${cardWarnings}')?.textContent ?? ''`), /恒定拉距/);
  const rerolled = await tavernState();
  assert.equal(rerolled.logs.length, combatBeforeReset.logs.length);
  assert.deepEqual(rerolled.equipment[itemTemplateId].rules.map(rule => rule.program[0].patch.finalAmount), [14]);
  assert.equal(await run('hostRequests.length'), 6);
  await click('.fated-toast footer button:last-child');
  await run(`document.querySelector('#reset-button').click(); document.querySelector('[data-tab="instances"]').click();`);
  const panelBefore = await run(`(() => { const r=document.querySelector('.fated-tavern-panel').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
  await click('.fated-tavern-fullscreen');
  assert.equal(await run('document.querySelector(".fated-tavern-panel").classList.contains("is-fullscreen")'), true);
  assert.equal(await run('document.querySelector(".fated-tavern-fullscreen").getAttribute("aria-label")'), '还原');
  await click('.fated-tavern-fullscreen');
  const panelRestored = await run(`(() => { const r=document.querySelector('.fated-tavern-panel').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
  assert.ok(Math.abs(panelRestored.width-panelBefore.width)<2 && Math.abs(panelRestored.height-panelBefore.height)<2);
  const resizeBefore = panelRestored;
  await run(`(() => { const h=document.querySelector('.fated-tavern-resize'),r=h.getBoundingClientRect(); const fire=(type,x,y)=>h.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:10,button:0,clientX:x,clientY:y})); fire('pointerdown',r.left+2,r.top+2); fire('pointermove',r.left+52,r.top+42); fire('pointerup',r.left+52,r.top+42); })()`);
  const resized = await run(`(() => { const r=document.querySelector('.fated-tavern-panel').getBoundingClientRect(); return {width:r.width,height:r.height}; })()`);
  assert.ok(resized.width > resizeBefore.width && resized.height > resizeBefore.height);
  await click('[data-tab="prompt"]');
  const preview = () => run(`JSON.parse(document.querySelector('[data-page="prompt"] .preview-panel pre').textContent)`);
  const toggle = '[data-page="prompt"] .wf-card:nth-child(2) .toggle-switch';
  const enabledMessages = await preview();
  assert.deepEqual(enabledMessages.map(m => m.role), ['system']);
  assert.match(enabledMessages[0].slotId, /^identity\+protocol\+/);
  await click(toggle);
  assert.deepEqual((await preview()).map(m => m.role), ['system']);
  assert.ok(!(await preview())[0].slotId.split('+').includes('protocol'));
  assert.equal(await run(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('fated-tactical/tavern/') && k.split('/').length === 3))).slots.find(s => s.id === 'protocol').enabled`), false);
  await click('[data-tab="api"]');
  assert.equal(await run(`document.querySelector('[name="apiSource"]').disabled`), true);
  const batchFields = `['normalizationConcurrency','normalizationWarningsPerBatch'].map(name => Number(document.querySelector('[name="'+name+'"]').value))`;
  assert.deepEqual(await run(batchFields), [1, 5]);
  await select('[name="normalizationConcurrency"]', '3');
  await select('[name="normalizationWarningsPerBatch"]', '4');
  assert.deepEqual(await run(`(() => { const c = window.__fatedTacticalTavern.getConfig(); return [c.normalizationConcurrency, c.normalizationWarningsPerBatch]; })()`), [3, 4]);
  await select('[name="apiMode"]', 'custom');
  await select('[name="apiTransport"]', 'tavern');
  await select('[name="baseUrl"]', 'https://upstream.example.test/v1');
  await select('[name="apiKey"]', 'aux-test');
  const apiButton = text => run(`Array.from(document.querySelectorAll('[data-page="api"] .cmd-row button')).find(b => b.textContent.includes(${JSON.stringify(text)})).click()`);
  await apiButton('拉取模型');
  await until(() => run(`!!document.querySelector('[aria-label="可用模型"]')`), '后端返回模型列表');
  await select('[aria-label="可用模型"]', 'aux-model');
  await apiButton('测试连接');
  await until(() => run(`document.querySelector('.api-status').textContent === '测试连接成功'`), '经酒馆后端测试生成');
  await select('[name="apiTransport"]', 'direct');
  await select('[name="apiMode"]', 'tavern');
  assert.equal(await run(`document.querySelector('[name="normalizationAiMode"]').value`), 'same');
  assert.equal(await run(`document.querySelector('[name="normalizationAiModel"]').disabled`), true);
  await select('[name="normalizationAiMode"]', 'custom');
  await select('[name="normalizationAiApiTransport"]', 'tavern');
  await select('[name="normalizationAiBaseUrl"]', 'https://normalization.example.test/v1');
  await select('[name="normalizationAiApiKey"]', 'normalization-test');
  const normalizationCard = `document.querySelector('[name="normalizationAiModel"]').closest('.api-card')`;
  const normalizationButton = text => run(`Array.from(${normalizationCard}.querySelectorAll('.cmd-row button')).find(b => b.textContent.includes(${JSON.stringify(text)})).click()`);
  await normalizationButton('拉取模型');
  await until(() => run(`!!document.querySelector('[aria-label="标准化可用模型"]')`), '标准化通道返回独立模型列表');
  await select('[aria-label="标准化可用模型"]', 'normalization-model');
  await normalizationButton('测试连接');
  await until(() => run(`${normalizationCard}.querySelector('.api-status').textContent === '测试连接成功'`), '标准化通道测试生成');
  await click('[data-tab="prompt"]');
  assert.equal(await run(`${get(toggle)}.checked`), false);
  await click(toggle);
  assert.deepEqual(await preview(), enabledMessages);
  await click('[data-tab="sandbox"]');
  let imported = await tavernState();
  assert.equal(imported.title, '酒馆联调');
  assert.equal(imported.order[0], 'p1');
  assert.equal(imported.units.p1.ap, 2);
  assert.equal(imported.units.p1.hp, reopened.units.p1.hp);
  const fixedShotRule = state => state.equipment[state.items[state.units.p1.mainHand].templateId].rules.find(rule => rule.id === 'fixed-shot');
  assert.notEqual(imported.units.e1.mainHand, imported.units.e2.mainHand);
  for (const id of ['e1', 'e2']) {
    const templateId = imported.items[imported.units[id].mainHand].templateId;
    const rule = imported.equipment[templateId].rules.find(rule => rule.id === 'fixed-shot');
    assert.ok(rule?.filter.includes(`'${templateId}'`), `standardized crossbow on ${id}`);
  }
  assert.deepEqual(fixedShotRule(imported)?.program,[{op:'mutate_event',patch:{finalAmount:14}}]);
  assert.equal(await run(`document.querySelector('#scenario-select').options.length`), 0);
  assert.equal(await run(`document.querySelectorAll('#seed-input').length`), 1);
  assert.equal(await run(`document.querySelector('#seed-input').value`), '1');
  await select('#seed-input', '13');
  await click('#reset-button');
  const restarted = await tavernState();
  assert.equal(restarted.title, imported.title);
  assert.notDeepEqual(restarted.grid, imported.grid);
  assert.equal(restarted.units.p1.ap, 2);
  assert.deepEqual(fixedShotRule(restarted), fixedShotRule(imported));
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-tab]'), b => b.dataset.tab)`), ['instances', 'prompt', 'api', 'ai', 'sandbox']);
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-page="sandbox"] > .fated-actions button'), b => b.textContent)`), ['战报交付', '重新扫描']);
  assert.equal(await run(`!!document.querySelector('[data-page="sandbox"] > .fated-chat')`), false);
  await run(`
    window.aiListeners = new Map();
    window.eventOn = (name, fn) => { aiListeners.set(name, fn); return () => aiListeners.delete(name); };
    window.stopGenerationById = id => { window.stoppedId = id; };
    window.generateRaw = args => new Promise((resolve, reject) => {
      window.aiProbe = { args, resolve, reject, chunk: text => aiListeners.get('js_stream_token_received_fully')(text, args.generation_id) };
    });
    window.aiButton = name => [...document.querySelectorAll('[data-page="ai"] button')].find(b => b.textContent === name);
    window.aiInput = document.querySelector('[data-page="ai"] textarea');
    window.aiSend = value => {
      aiProbe = null;
      aiInput.value = value;
      aiInput.dispatchEvent(new Event('input'));
      aiInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    };
    window.aiProbe = null;
  `);
  await click('[data-tab="instances"]');
  const sourceCheck = '.fated-instance[data-unit-id="e1"] input[type="checkbox"]';
  await run(`if (document.querySelector('${sourceCheck}').checked) document.querySelector('${sourceCheck}').click()`);
  await click('[data-tab="prompt"]');
  await select('[aria-label="提示词预览类型"]', 'chat');
  assert.match(JSON.stringify(await preview()), /玩家私有原文/);
  assert.doesNotMatch(JSON.stringify(await preview()), /对手私有原文/);
  await click('[data-tab="ai"]');
  assert.match(await run(`document.querySelector('[data-page="ai"] small.fated-ai-info').textContent`), /已勾选 1 名角色 · 待发送 [1-9]\d* 字符/);
  await run(`aiButton('清空当前会话').click()`);
  const selectSession = id => select('[aria-label="切换会话"]', id);
  const aiData = () => run(`window.__fatedTacticalTavern.getConfig().aiSessions`);
  const bubble = () => run(`(() => { const b = [...document.querySelectorAll('.fated-ai-message[data-role="assistant"]')].at(-1); return b && {status:b.dataset.status, body:b.querySelector('.fated-ai-body').textContent}; })()`);
  const sessions = [];
  for (let i = 1; i <= 3; i++) {
    if (i > 1) await run(`aiButton('新建').click()`);
    await run(`aiButton('重命名').click(); document.querySelector('[aria-label="会话名称"]').value = '会话 ${i}'; aiButton('保存名称').click()`);
    sessions.push((await aiData()).activeId);
    await run(`aiSend('问题 ${i}')`);
    assert.deepEqual(await run(`aiProbe.args.ordered_prompts.filter(m => m.role !== 'system').map(m => m.content)`), [`问题 ${i}`]);
    assert.equal(await run(`aiButton('发送').disabled && !aiButton('停止').hidden`), true);
    if (i === 1) {
      const payload = await run('JSON.stringify(aiProbe.args.ordered_prompts)');
      assert.match(payload, /玩家私有原文/);
      assert.doesNotMatch(payload, /对手私有原文/);
      const snapshots = [];
      for (const word of ['答', '回答', '回答 1']) {
        await run(`aiProbe.chunk(${JSON.stringify(word)})`);
        snapshots.push((await bubble()).body);
      }
      assert.deepEqual(snapshots, ['答', '回答', '回答 1']);
      t.diagnostic('G54 流式 DOM 答 → 回答 → 回答 1');
    }
    await run(`aiProbe.resolve('回答 ${i}')`);
    await until(async () => (await bubble())?.status === 'ok', '会话回复完成');
    assert.equal((await aiData()).sessions.find(s => s.id === sessions[i - 1]).messages.length, 2);
  }
  await click('[data-tab="instances"]');
  await click(sourceCheck);
  await click('[data-tab="ai"]');
  for (const [index, id] of sessions.entries()) {
    await selectSession(id);
    assert.equal((await bubble()).body, `回答 ${index + 1}`);
  }
  t.diagnostic('G49/G50 三会话切换分别恢复 问题 1/回答 1、问题 2/回答 2、问题 3/回答 3');
  await run(`aiSend('中止测试'); aiProbe.chunk('已收到的片段')`);
  const generation = await run(`aiProbe.args.generation_id`);
  await selectSession(sessions[0]);
  await run(`aiButton('停止').click()`);
  await until(() => run(`aiButton('停止').hidden`), '停止后恢复输入');
  assert.equal(await run('stoppedId'), generation);
  assert.equal((await bubble()).body, '回答 1');
  await selectSession(sessions[2]);
  assert.deepEqual(await bubble(), { status: 'aborted', body: '已收到的片段' });
  t.diagnostic(`G51 ${JSON.stringify(await bubble())}`);
  await run(`aiSend('失败测试'); aiProbe.reject(new Error('模拟网络断开'))`);
  await until(async () => (await bubble())?.status === 'error', '气泡显示失败');
  assert.deepEqual(await bubble(), { status: 'error', body: '错误：模拟网络断开' });
  t.diagnostic(`G52 ${JSON.stringify(await bubble())}`);
  const chatPatch = { patch: [
    { op: 'replace', path: '/units/p1/armor', value: 6 },
    { op: 'replace', path: '/units/p1/name', value: '补丁即时刷新验证' },
  ] };
  const currentBoard = 'document.querySelector(".fated-tavern-panel #board")';
  const boardUnitName = () => run(`${currentBoard}.querySelector('.axis-unit[data-unit-id="p1"] .axis-unit-name').textContent`);
  const originalName = await boardUnitName();
  await run(`window.boardBeforeChatPatch = ${currentBoard}; aiSend('调整护甲'); aiProbe.resolve(${JSON.stringify(JSON.stringify(chatPatch))})`);
  await until(async () => (await bubble())?.status === 'ok', '会话补丁到达');
  const lastAssistant = `[...document.querySelectorAll('.fated-ai-message[data-role="assistant"]')].at(-1)`;
  const originalArmor = (await tavernState()).units.p1.armor;
  assert.notEqual(originalArmor, 6);
  assert.equal(await boardUnitName(), originalName, '收到回复后仍等待手动应用');
  await run(`${lastAssistant}.querySelector('[data-ai-apply]').click()`);
  await until(async () => (await tavernState()).units.p1.armor === 6, '点击应用才写入护甲');
  await until(async () => (await boardUnitName()) === '补丁即时刷新验证', '当前棋盘原位刷新');
  assert.equal(await run(`${currentBoard} === window.boardBeforeChatPatch`), true);
  assert.match(await run(`${lastAssistant}.querySelector('.fated-ai-msg-feedback').textContent`), /已应用/);
  const restartKey = await activeStorageKey();
  const retainedBeforeRestart = (await run('window.__fatedTacticalTavern.getConfig().normalizationBatches'))[restartKey];
  assert.ok(retainedBeforeRestart.some(batch => batch.receipts?.length), '需覆盖已核销警告的批次');
  await run(`(() => {
    const base = Object.keys(localStorage).find(k => k.startsWith('fated-tactical/tavern/') && k.split('/').length === 3);
    const storageKey = base + '/normalizationBatches', battle = ${JSON.stringify(restartKey)};
    const map = JSON.parse(localStorage.getItem(storageKey));
    map[battle].push({ entries: [], receipts: [], patch: [{ op: 'replace', path: '/zones/no-longer-present/name', value: '过期区域' }] });
    localStorage.setItem(storageKey, JSON.stringify(map));
    document.querySelector('[data-tab="prompt"]').click();
    document.querySelector('[data-tab="sandbox"]').click();
    document.querySelector('.fated-tavern-panel #reset-button').click();
  })()`);
  assert.deepEqual((await run('window.__fatedTacticalTavern.getConfig().normalizationBatches'))[restartKey], retainedBeforeRestart,
    '重开只剔除无效区域批次，保留有核销收据的有效补丁');
  assert.equal((await tavernState()).units.p1.armor, 6, '重开保留已应用的辅助 AI 补丁');
  assert.equal(await boardUnitName(), '补丁即时刷新验证');
  await run(`document.querySelector('[data-tab="ai"]').click()`);
  const beforeReroll = await aiData();
  await run(`${lastAssistant}.querySelector('[data-ai-reroll]').click(); aiProbe.resolve(JSON.stringify([{op:'replace',path:'/units/missing/armor',value:9}]))`);
  assert.equal(await run(`aiProbe.args.ordered_prompts.some(m => m.role === 'system' && m.content.includes('玩家私有原文'))`), true);
  await until(() => run(`Boolean(${lastAssistant}.querySelector('[data-ai-apply]:not(:disabled)'))`), '重生成原位显示应用按钮');
  assert.equal((await aiData()).sessions.at(-1).messages.length, beforeReroll.sessions.at(-1).messages.length);
  await run(`${lastAssistant}.querySelector('[data-ai-apply]').click()`);
  assert.match(await run(`${lastAssistant}.querySelector('.fated-ai-msg-feedback[data-tone="error"]').textContent`), /\/units\/missing\/armor/);
  assert.equal((await tavernState()).units.p1.armor, 6);
  await run(`${lastAssistant}.querySelector('[aria-label="上一个回复版本"]').click()`);
  assert.equal(await run(`${lastAssistant}.querySelector('[data-ai-versions]').textContent`), '1 / 2');
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: `http://127.0.0.1:${server.address().port}` });
  await run(`${lastAssistant}.querySelector('[data-ai-copy]').click()`);
  await until(() => run(`${lastAssistant}.querySelector('.fated-ai-msg-feedback').textContent === '已复制回复'`), '复制回复完成');
  assert.deepEqual(JSON.parse(await run('navigator.clipboard.readText()')), chatPatch);
  await run(`${lastAssistant}.querySelector('[data-ai-undo]').click()`);
  assert.equal((await tavernState()).units.p1.armor, originalArmor);
  await until(async () => (await boardUnitName()) === originalName, '撤销后当前棋盘原位刷新');
  await run(`document.querySelector('[data-tab="sandbox"]').click(); document.querySelector('.fated-tavern-panel #reset-button').click();`);
  assert.equal((await tavernState()).units.p1.armor, originalArmor, '重开不会恢复已撤销的补丁');
  assert.equal(await boardUnitName(), originalName);
  await run(`document.querySelector('[data-tab="ai"]').click()`);
  await run(`document.querySelector('[data-ai-edit]:not([hidden])').click()`);
  const editor = `document.querySelector('.fated-ai-editor:not([hidden])')`;
  assert.equal(await run(`${editor}.querySelector('textarea').value`), '调整护甲');
  await run(`${editor}.querySelector('textarea').value='编辑后的护甲问题'; ${editor}.requestSubmit()`);
  assert.equal(await run('aiProbe.args.ordered_prompts.at(-1).content'), '编辑后的护甲问题');
  assert.equal(await run(`aiProbe.args.ordered_prompts.some(m => m.role === 'system' && m.content.includes('玩家私有原文'))`), true);
  await run(`aiProbe.resolve('编辑后回复')`);
  await until(async () => (await bubble())?.body === '编辑后回复', '编辑后重新生成完成');
  assert.equal((await aiData()).sessions.at(-1).messages.at(-2).content, '编辑后的护甲问题');
  const beforeNormalize = await aiData();
  await run(`document.querySelector('[data-tab="instances"]').click();`);
  assert.equal(await run(`${get('[data-normalize]')}.disabled`), true, '没有待编译词条时不发送空批次');
  await run(`${get(rerollEntry)}.click(); document.querySelector('[data-normalize]').click(); document.querySelector('[data-tab="ai"]').click();`);
  await until(async () => (await tavernState()).units.p1.armor === 7, '手动标准化通过独立 API 写入');
  await until(() => normalizationRequests.length === 2, '已生效护甲后仅补答静默漏项一次');
  assert.match(normalizationRequests[1].at(-1).content, /上一轮静默遗漏/);
  assert.doesNotMatch(JSON.stringify(normalizationRequests[0]), /编辑后的护甲问题|调整错误路径/);
  assert.equal(await run('aiProbe.args.ordered_prompts.at(-1).content'), '编辑后的护甲问题');
  assert.deepEqual(await aiData(), beforeNormalize);
  await until(() => run(`document.querySelector('.fated-toast[data-tone="warning"]')?.textContent.includes('/skills/missing/rules')`), '局部返修未进展仍报告原始拒收');
  assert.match(await run(`document.querySelector('.fated-toast[data-tone="warning"]').textContent`), /1 项报错未应用.*\/skills\/missing\/rules/s);
  await run(`aiSend('Markdown 测试'); aiProbe.resolve(${JSON.stringify('一段 `行内代码`。\n\n```js\nconst n = 1;\n```\n\n下一段。')})`);
  await until(async () => (await bubble())?.status === 'ok', 'Markdown 回复完成');
  assert.equal(await run(`[...document.querySelectorAll('.fated-ai-message[data-role="assistant"]')].at(-1).querySelector('p code').textContent`), '行内代码');
  assert.equal(await run(`[...document.querySelectorAll('.fated-ai-message[data-role="assistant"]')].at(-1).querySelector('pre code').textContent`), 'const n = 1;');
  await run(`aiSend('滚动测试'); aiProbe.chunk('长回复\\n\\n'.repeat(60))`);
  const scroll = () => run(`(() => { const log = document.querySelector('.fated-ai-log'); return {top:log.scrollTop, bottom:log.scrollHeight-log.clientHeight-log.scrollTop}; })()`);
  assert.ok((await scroll()).bottom <= 2, '跟随时滚到底部');
  await run(`(() => { const log = document.querySelector('.fated-ai-log'); log.scrollTop = 0; log.dispatchEvent(new Event('scroll')); aiProbe.chunk('长回复\\n\\n'.repeat(80)); })()`);
  assert.ok((await scroll()).top <= 2, '回看时保持滚动位置');
  await run(`aiButton('停止').click()`);
  await until(() => run(`aiButton('停止').hidden`), '滚动测试结束');
  await selectSession(sessions[1]);
  await run(`aiButton('清空当前会话').click()`);
  assert.deepEqual((await aiData()).sessions[1].messages, []);
  await run(`aiButton('删除').click()`);
  assert.deepEqual((await aiData()).sessions.map(s => s.id), [sessions[0], sessions[2]]);
  await selectSession(sessions[0]);
  await click('[data-tab="sandbox"]');
  const reportToggle = '[data-auto-deliver-report]';
  const panelHidden = () => run(`${get('.fated-tavern-panel')}.hidden`);
  assert.equal(await run(`${get(reportToggle)}.checked`), true);
  // 悬浮按钮可收进魔术棒菜单，取消勾选后恢复
  await run(`document.body.append(Object.assign(document.createElement('div'), { id: 'extensionsMenu' }))`);
  await run(`${get('[data-hide-launcher]')}.click()`);
  assert.deepEqual(await run(`({ launcher: document.querySelector('.fated-tavern-launcher').hidden, entry: Boolean(document.querySelector('#extensionsMenu [data-fated-tavern-entry]')),
    saved: Object.values(localStorage).some(v => v.includes('"hideLauncher":true')) })`), { launcher: true, entry: true, saved: true });
  await run(`${get('[data-hide-launcher]')}.click()`);
  assert.equal(await run(`Boolean(document.querySelector('#extensionsMenu [data-fated-tavern-entry]'))`), false);
  await run(`(() => {
    const input = document.createElement('textarea');
    input.id = 'send_textarea';
    input.hidden = true;
    document.body.append(input);
    window.deliveredReports = [];
    input.addEventListener('input', () => deliveredReports.push(input.value));
  })()`);
  const winBattle = () => run(`(() => {
    document.querySelector('#sandbox-editor').value = JSON.stringify([
      {type:'set_unit_stat', unitId:'e1', patch:{hp:0}},
      {type:'set_unit_stat', unitId:'e2', patch:{hp:0}}
    ]);
    document.querySelector('#sandbox-preview').click();
    document.querySelector('#sandbox-commit').click();
    return { outcome: window.__fatedTacticalTavern.getState().outcome, deliveries: deliveredReports.length };
  })()`);
  await select('#anim-speed', '1');
  assert.deepEqual(await winBattle(), { outcome: 'blue', deliveries: 0 });
  await until(panelHidden, '胜利演出后自动交付并关闭');
  const reports = () => run('window.deliveredReports');
  assert.equal((await reports()).length, 1);
  assert.match((await reports())[0], /蓝方/);
  assert.doesNotMatch((await reports())[0], /<UpdateVariable>/);
  await run('window.__fatedTacticalTavern.open()');
  assert.equal(await panelHidden(), false);
  assert.equal((await reports()).length, 1);
  await click(reportToggle);
  await select('#anim-speed', '0');
  await run(`${get('#sandbox-undo')}.click()`);
  assert.deepEqual(await winBattle(), { outcome: 'blue', deliveries: 1 });
  assert.equal(await panelHidden(), false);
  await click('[data-page="sandbox"] > .fated-actions button:first-child');
  assert.equal(await panelHidden(), true);
  assert.equal((await reports()).length, 2);
  assert.equal((await reports())[1], (await reports())[0]);
  await run(`window.__fatedTacticalTavern.open()`);
  await click('[data-tab="instances"]');
  const requestsBeforeHydrate = await run('hostRequests.length');
  const resetKey=await run('window.__fatedTacticalTavern.getSources().battleKey');
  assert.ok(await run(`window.__fatedTacticalTavern.getConfig().normalizationBatches[${JSON.stringify(resetKey)}].length`));
  const openingPatchKey = JSON.stringify(`fated-tactical/${resetKey}/chat-opening-patches`);
  await run(`localStorage.setItem(${openingPatchKey}, '[]')`);
  assert.deepEqual(await savedBattleKeys(), [`fated-tactical/${resetKey}/fated-tactical/battle-v1`]);
  await run(`for (const id of ['p1','e1']) [...document.querySelectorAll('.fated-instance[data-unit-id="'+id+'"] button')].find(b=>b.textContent==='删除').click()`);
  assert.equal(await run(`document.querySelectorAll('article.fated-instance').length`), 0);
  assert.deepEqual(await savedBattleKeys(), []);
  assert.equal(await run(`localStorage.getItem(${openingPatchKey})`), null);
  await run(`window.confirm = () => true; window.battleBag={急救包:{类型:'消耗品',数量:3,target:'self',rules:[{id:'heal_self',hook:'active',usesPerBattle:1,program:[{op:'heal',target:'self',amount:10}]}]}}; window.reserveWeapons={黑灵:{类型:'武器',标签:['匕首','攻击：150'],位置:''}}; window.narrativeHp = 245; [...document.querySelectorAll('[data-page="instances"] button')].find(b=>b.textContent==='从当前聊天重新水合').click()`);
  await until(() => run(`document.querySelectorAll('article.fated-instance').length===2`), '手动重新水合恢复已删除的角色');
  const raw = await tavernState();
  assert.deepEqual(await run(`window.__fatedTacticalTavern.getConfig().normalizationBatches[${JSON.stringify(resetKey)}]`),[],'删除角色后重读不会回放旧标准化');
  assert.equal(raw.units.p1.hp, 245);
  const staleSkillId = Object.keys(raw.units.p1.inventory)[0];
  await run(`(() => {
    const key='fated-tactical/'+window.__fatedTacticalTavern.getSources().battleKey+'/fated-tactical/battle-v1';
    const snapshot=JSON.parse(localStorage.getItem(key));
    for (const section of [snapshot.origin,snapshot.state]) section.skills[${JSON.stringify(staleSkillId)}].rules=[];
    localStorage.setItem(key,JSON.stringify(snapshot));
  })()`);
  await run('window.__fatedTacticalTavern.scan({rehydrate:true})');
  assert.ok((await tavernState()).skills[staleSkillId].rules.length, '相同来源：重新水合不能恢复缺机制的旧模板');
  assert.ok(await run(`window.__fatedTacticalTavern.getDiagnostics().warnings.some(w=>w.message.includes('恒定拉距'))`));
  assert.equal(raw.equipment[raw.items[raw.units.p1.mainHand].templateId].attack, 14);
  await run('window.__fatedTacticalTavern.scan()');
  assert.deepEqual(await tavernState(), raw);
  const quotaProbe = await run(`(async () => {
    const { scan } = window.__fatedTacticalTavern;
    const stale = 'fated-tactical/old-quota-probe/fated-tactical/battle-v1';
    const snapshot = ${JSON.stringify(`fated-tactical/${resetKey}/fated-tactical/battle-v1`)};
    const nativeSetItem = Storage.prototype.setItem;
    localStorage.setItem(stale, '{}');
    let blocked = 0, alwaysFail = false;
    Storage.prototype.setItem = function(key, value) {
      if (key === snapshot && (alwaysFail || this.getItem(stale))) {
        blocked += 1;
        throw new DOMException('quota probe', 'QuotaExceededError');
      }
      return nativeSetItem.call(this, key, value);
    };
    try {
      await scan({ rehydrate: true });
      const healed = !localStorage.getItem(stale) && document.querySelector('#action-error').hidden;
      alwaysFail = true;
      await scan({ rehydrate: true });
      const status = document.querySelector('#action-error');
      return { blocked, healed, visible: !status.hidden, message: status.textContent };
    } finally { Storage.prototype.setItem = nativeSetItem; }
  })()`);
  assert.deepEqual(quotaProbe, { blocked: 2, healed: true, visible: true,
    message: '浏览器存储空间不足或已关闭；请下载快照保存战局。' });
  await click('[data-tab="prompt"]');
  const configWriteProbe = await run(`(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('fated-tactical/tavern/') && k.split('/').length === 3);
    const stale = 'fated-tactical/old-config-probe/fated-tactical/battle-v1';
    const setItem = Storage.prototype.setItem;
    const toggleProtocol = () => document.querySelector('[data-page="prompt"] .wf-card:nth-child(2) .toggle-switch').click();
    localStorage.setItem(stale, '{}');
    const before = localStorage.getItem(key);
    let quota = false, failures = 0;
    Storage.prototype.setItem = function(k, value) {
      if (k === key && this.getItem(stale)) {
        failures++;
        throw quota ? new DOMException('quota', 'QuotaExceededError') : new Error('not a quota error');
      }
      return setItem.call(this, k, value);
    };
    try {
      toggleProtocol();
      const ordinaryFailurePreservedOldBattle = localStorage.getItem(stale) !== null && localStorage.getItem(key) === before;
      quota = true;
      toggleProtocol();
      return { ordinaryFailurePreservedOldBattle, quotaEvictedOldBattle: localStorage.getItem(stale) === null, failures };
    } finally { Storage.prototype.setItem = setItem; localStorage.removeItem(stale); }
  })()`);
  assert.deepEqual(configWriteProbe, { ordinaryFailurePreservedOldBattle: true, quotaEvictedOldBattle: true, failures: 2 });
  assert.equal(await run('hostRequests.length'), requestsBeforeHydrate);
  await click('[data-tab="sandbox"]');
  await click(`#board [data-x="${raw.units.p1.x}"][data-y="${raw.units.p1.y}"]`);
  const bagId = Object.keys(raw.units.p1.inventory)[0];
  assert.equal(await run(`${get(`#target-actions [data-skill-id="${bagId}"]`)}.disabled`),false,await run(`${get(`#target-actions [data-skill-id="${bagId}"]`)}.title`));
  assert.match(await run(`${get(`#target-actions [data-skill-id="${bagId}"]`)}.textContent`), /剩余 1 次/);
  await click(`#target-actions [data-skill-id="${bagId}"]`);
  await click(`#board [data-x="${raw.units.p1.x}"][data-y="${raw.units.p1.y}"]`);
  assert.equal((await tavernState()).units.p1.inventory[bagId],3);
  await click('#confirm-action');
  const afterHeal = await tavernState();
  assert.equal(afterHeal.units.p1.hp, 255);
  assert.equal(afterHeal.units.p1.inventory[bagId],2);
  await run('window.__fatedTacticalTavern.scan({rehydrate:true})');
  assert.deepEqual(await tavernState(), afterHeal, '相同来源和开场模板：重新水合保留已消耗的物品和战斗进度');
  await click(`#board [data-x="${raw.units.p1.x}"][data-y="${raw.units.p1.y}"]`);
  assert.equal(await run(`${get(`#target-actions [data-skill-id="${bagId}"]`)}.disabled`), true);
  assert.match(await run(`${get(`#target-actions [data-skill-id="${bagId}"]`)}.textContent`), /剩余 0 次.*次数已用尽/);
  await run(`${get('#sandbox-undo')}.click()`);
  assert.equal((await tavernState()).units.p1.inventory[bagId],3);
  await click(`#board [data-x="${raw.units.p1.x}"][data-y="${raw.units.p1.y}"]`);
  const swapButton = '#target-actions [data-action="switch_weapon"]';
  assert.match(await run(`${get(swapButton)}.textContent`), /切换武器：黑灵/);
  await click(swapButton);
  const switched = await tavernState();
  assert.equal(switched.equipment[switched.items[switched.units.p1.mainHand].templateId].name, '黑灵');
  assert.deepEqual(switched.units.p1.used,{action:0,attack:0});
  await run(`(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('fated-tactical/tavern/') && k.endsWith('/ai-sessions'));
    const data = JSON.parse(localStorage.getItem(key));
    data.sessions[0].messages.push({role:'tool', content:'占位', ts:Date.now(), toolName:'test', toolResult:{ok:true}});
    localStorage.setItem(key, JSON.stringify(data));
  })()`);
  const storedBatches = await run('window.__fatedTacticalTavern.getConfig().normalizationBatches');
  assert.ok(Object.values(storedBatches).some(batches => batches.length), '刷新前确有标准化批次');
  await send('Page.reload');
  await until(() => run(`window.__fatedTacticalTavern?.getConfig().aiSessions.activeId === ${JSON.stringify(sessions[0])}`), '刷新恢复会话');
  assert.deepEqual(await run('window.__fatedTacticalTavern.getConfig().normalizationBatches'), storedBatches, '刷新逐批恢复标准化补丁');
  assert.equal(await run(`${get(reportToggle)}.checked`), false);
  await click('.fated-tavern-launcher');
  await click('[data-tab="ai"]');
  assert.deepEqual((await aiData()).sessions[0].messages.map(m => m.role), ['user', 'assistant', 'tool']);
  assert.equal((await bubble()).body, '回答 1');
  assert.match(await run(`document.querySelector('.fated-ai-message[data-role="tool"]').textContent`), /test[\s\S]*占位/);
  assert.equal(await run(`getComputedStyle(document.querySelector('.fated-ai-message[data-role="tool"]')).borderTopStyle`), 'dashed');
  t.diagnostic('G47–G54 通过，刷新后恢复会话与工具占位');
  await click('[data-tab="instances"]');
  assert.equal(await run(`document.querySelector('[data-script-reset]').previousElementSibling.textContent`),'从当前聊天重新水合');
  await run(`localStorage.setItem('other-script/probe','keep'); localStorage.setItem('fated-tactical/reset-probe','old'); window.confirm=()=>false`);
  await click('[data-script-reset]'); assert.equal(await run(`localStorage.getItem('fated-tactical/reset-probe')`),'old');
  await run(`window.confirm=()=>true; document.querySelector('[data-script-reset]').click()`);
  await until(()=>run(`!!window.__fatedTacticalTavern && !localStorage.getItem('fated-tactical/reset-probe')`),'清理脚本缓存后重新初始化');
  assert.equal(await run(`localStorage.getItem('other-script/probe')`),'keep');
  assert.deepEqual(await run('window.__fatedTacticalTavern.getConfig().normalizationBatches'),{});
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(() => run('!!window.FatedTacticalGame && document.querySelectorAll("#board .tactical-cell").length === 100'), '100 格棋盘加载');
  await click('#auto-ai');
  // 逐格断言 DOM 的步骤关闭演出；演出本身在自动敌方回合处单独验证
  await select('#anim-speed', '0');
  const multi = await run(`(() => {
    const game = window.FatedTacticalGame, fixture = game.getBattleState();
    const actor = fixture.units[fixture.order[fixture.turn]];
    fixture.skills.multi_choice = { name:'多选测试', ap:1, slot:'attack', range:0, shape:'single', target:'self',
      rules:[{ id:'multi_choice', hook:'active', program:[
        { op:'ask', chooser:'self', kind:'entity', prompt:'选择多个单位', out:'chosen', aiPolicy:'first',
          maxSelect:2, select:{ from:'units', where:'candidate.team != self.team' } },
        { op:'for_each', select:{ from:'vars.chosen' }, bind:'victim', body:[
          { op:'damage', target:'vars.victim', amount:1, damageType:'true' },
        ] },
      ] }] };
    actor.skills.push('multi_choice');
    game.createBattle({ kind:'custom_state', state:fixture });
    game.playAction({ type:'skill', skillId:'multi_choice', x:actor.x, y:actor.y });
    return game.getBattleState().vm.pendingAsk.options.map(({id}) => ({id, hp:fixture.units[id].hp}));
  })()`);
  const choice = id => `#pending-ask [data-ask-entity="${id}"]`;
  const unitCell = id => `#board .tactical-cell[data-unit-id="${id}"]`;
  const confirmChoices = '#pending-ask .primary';
  await until(() => run(`!${get('#pending-ask')}.hidden`), '多选面板打开');
  assert.equal(await run(`${get(confirmChoices)}.disabled`), true);
  await click(unitCell(multi[1].id));
  assert.equal(await run(`${get(choice(multi[1].id))}.getAttribute('aria-pressed')`), 'true');
  await click(choice(multi[0].id));
  assert.equal(await run(`${get(unitCell(multi[0].id))}.classList.contains('is-ask-selected')`), true);
  assert.equal(await run(`${get(choice(multi[2].id))}.disabled`), true);
  assert.match(await run(`${get('#pending-ask output')}.textContent`), /2 \/ 2/);
  assert.ok((await state()).vm.pendingAsk);
  await click(choice(multi[1].id));
  assert.equal(await run(`${get(choice(multi[2].id))}.disabled`), false);
  await click(unitCell(multi[2].id));
  await click(confirmChoices);
  const chosenState = await state();
  assert.equal(chosenState.vm.pendingAsk, null);
  assert.deepEqual(multi.map(({id, hp}) => chosenState.units[id].hp - hp), [-1, 0, -1]);
  await click('#reset-button');
  // 桌面：100% 时整盘放满舞台；滚轮以指针为锚点缩放
  const wheelAt = async (deltaY) => { const b = await run(`(() => { const r=${get('#board')}.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
    await send('Input.dispatchMouseEvent', { type:'mouseWheel', x:b.x, y:b.y, deltaX:0, deltaY }); await pause(120); };
  const cellSize = () => run(`Math.round(${get('#board .tactical-cell')}.getBoundingClientRect().width)`);
  const fitted = await cellSize();
  assert.ok(fitted > 60, `1440×920 下 100% 应放大填满舞台，实际每格 ${fitted}px`);
  await wheelAt(-300);
  assert.ok(await cellSize() > fitted, '滚轮向上放大');
  assert.notEqual(await run(`${get('#zoom-reset')}.textContent`), '100%');
  await click('#zoom-reset');
  assert.equal(await cellSize(), fitted);
  await select('#scenario-select', 'altar');
  assert.match(await run(`${get('#scenario-preview')}.textContent`), /坡道/);
  await click('#reset-button');
  assert.equal((await state()).scenarioId, 'altar');
  assert.ok(await run('document.querySelectorAll("#board .terrain-slope").length >= 2'));
  await select('#scenario-select', 'ruins'); await click('#reset-button');
  assert.equal((await state()).scenarioId, 'ruins');
  const layout = await run(`(() => { const board = ${get('#board')}.getBoundingClientRect(), box = ${get('.axis-scroll')}.getBoundingClientRect();
    return {cells:document.querySelectorAll('#board .tactical-cell').length, covers:document.querySelectorAll('#board .tactical-cover').length,
    items:document.querySelectorAll('#board .tactical-interact').length, fit:board.width>350&&board.left>=box.left&&board.right<=box.right+1&&box.right<=innerWidth,
    spill:document.documentElement.scrollWidth>innerWidth }; })()`);
  assert.deepEqual(layout, { cells:100, covers:4, items:4, fit:true, spill:false });
  assert.equal(await run('document.querySelector("#mode-select")'), null);
  assert.equal((await state()).mode, 'split');
  await run(`(() => { const g = window.FatedTacticalGame, s = g.getBattleState();
    const a = s.units[s.order[s.turn]], enemy = Object.values(s.units).find(u => u.team !== a.team);
    s.items['audit-shield'] = {id:'audit-shield',templateId:'towerShield'};
    Object.assign(a,{x:0,y:0,shield:'audit-shield',stance:'sword_shield'}); Object.assign(enemy,{x:1,y:0});
    g.createBattle({kind:'custom_state',state:s}); })()`);
  await click(cell(1,0));
  await click('#target-actions [data-action="shield_bash"]');
  assert.ok((await state()).tape.some(record => record.actionType === 'shield_bash') && (await actor()).used.attack === 1, '点击盾击实际消耗攻击槽');
  await click('#reset-button');
  await t.test('同格扇形技能可沿当前朝向命中敌方', async () => {
    await run(`(() => {
      const game = window.FatedTacticalGame, s = game.getBattleState();
      const a = s.units[s.order[s.turn]], enemy = s.units.scout;
      Object.assign(a, {x:1,y:2,facing:[1,0],skills:['overlap_fan']});
      Object.assign(enemy, {x:1,y:2,hp:1});
      s.pools[enemy.pools.hp].current = 1;
      s.skills.overlap_fan = {name:'碧海潮生',ap:1,slot:'attack',shape:'fan',target:'enemy',range:3,radius:2,
        damage:{count:1,sides:1,bonus:5,type:'physical'}};
      game.createBattle({kind:'custom_state',state:s});
    })()`);
    await click(`${cell(1,2)} [data-unit-id="scout"]`);
    const skill = '#target-actions [data-skill-id="overlap_fan"]';
    assert.equal(await run(`${get(skill)}.disabled`), false, await run(`${get(skill)}.title`));
    await click(skill);
    await click('#confirm-action');
    assert.ok((await state()).logs.some(log => log.type === 'hit_result' && log.detail.targetId === 'scout'));
  });
  await click('#reset-button');
  await t.test('玩家可在同一回合切换附随召唤物并操控其走位', async () => {
    await run(`(() => {
      const game = window.FatedTacticalGame, s = game.getBattleState();
      const a = s.units[s.order[s.turn]];
      s.skills.squad_proof = {name:'协战测试召唤',ap:1,slot:'action',shape:'single',target:'self',range:0,
        rules:[{id:'squad_proof_spawn',hook:'active',program:[{op:'spawn',entityKind:'unit',at:{x:1,y:1},
          spec:{name:'协战测试单位',turnMode:'linked_each'}}]}]};
      a.skills.push('squad_proof');
      game.createBattle({kind:'custom_state',state:s});
      const result = game.playAction({type:'skill',skillId:'squad_proof',x:a.x,y:a.y});
      if (!result.ok) throw new Error(result.error);
    })()`);
    const summon = Object.values((await state()).units).find(unit => unit.summoned);
    assert.ok(summon);
    await click(`${cell(summon.x,summon.y)} [data-unit-id="${summon.id}"]`);
    await click(cell(1,0));
    await click('#action-toolbar [data-action="move"]');
    const s = await state();
    assert.deepEqual([s.units[summon.id].x, s.units[summon.id].y], [1, 0]);
    assert.equal(s.order.includes(summon.id), false);
    assert.equal(s.order[s.turn], 'swordsman');
    assert.equal(s.units.swordsman.y, 2);
  });
  await click('#reset-button');
  const actions = type => `#action-toolbar [data-action="${type}"]`;
  await run(`(() => {
    const game = window.FatedTacticalGame;
    const fixture = game.getBattleState();
    Object.assign(fixture.units.swordsman, {x:7,y:9,weapon:'ranger-weapon',mainHand:'ranger-weapon'});
    Object.assign(fixture.units.ranger, {weapon:null,mainHand:null});
    Object.assign(fixture.units.scout, {x:7,y:7,hp:1,armor:0});
    fixture.pools[fixture.units.scout.pools.hp].current = 1;
    game.createBattle({kind:'custom_state',state:fixture});
  })()`);
  assert.ok(await run(`${get(cell(7,6))}.classList.contains('is-in-range')`));
  await click(cell(7,6));
  assert.match(await run(`${get(actions('attack'))}.textContent`), /引爆/);
  await click(actions('attack'));
  assert.match(await run(`${get('#tactical-preview')}.textContent`), /爆炸波及/);
  assert.ok(await run(`${get(cell(7,7))}.classList.contains('axis-covered')`));
  await click('#confirm-action');
  assert.equal((await state()).interactives.I2.spent, true);
  assert.equal((await state()).units.scout.hp, 0);
  await click('#reset-button');
  assert.equal((await actor()).id, 'swordsman');
  assert.ok(await run(`${get(cell(2, 2))}.classList.contains('is-reachable')`));
  await click(cell(1, 2));
  assert.match(await run(`${get('#unit-card')}.textContent`), /体型 中型 \(1\.7m\)/);
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
  const corpse = await run(`(() => {
    const token = document.querySelector('[data-corpse-id="scout"]');
    const tile = token?.closest('.tactical-cell');
    return token && { filter: getComputedStyle(token).filter, pointer: getComputedStyle(token).pointerEvents,
      unit: tile.dataset.unitId ?? null, selected: tile.getAttribute('aria-pressed') };
  })()`);
  assert.deepEqual(corpse, { filter: 'grayscale(1)', pointer: 'none', unit: null, selected: 'false' });
  t.diagnostic(`G57 ${JSON.stringify(corpse)}`);
  assert.equal(await souls(), 1);
  const returnToSwordsman = async () => {
    for (let step = 0; (await actor()).id !== 'swordsman'; step++) {
    assert.ok(step < 20, '先攻队列应回到剑客');
    if ((await actor()).team === 'red') {
      const n = (await state()).logs.length;
      await click('#ai-step'); assert.ok((await state()).logs.length > n);
    } else await click('#end-turn');
    }
  };
  await returnToSwordsman();
  await click(cell(2, 3)); await click(actions('interact'));
  assert.equal((await state()).interactives.I1.spent, true);
  assert.ok((await state()).units.swordsman.statuses.haste);
  await click(cell(2, 2));
  assert.equal(await run('document.querySelector(\'#action-toolbar [data-skill-id="armor"]\')'), null);
  await click('#end-turn');
  await returnToSwordsman();
  await click(cell(2, 2)); await click('#action-toolbar [data-skill-id="armor"]'); await click('#confirm-action');
  assert.ok((await state()).units.swordsman.statuses.thorns);
  await click('#api-sandbox summary'); await click('[data-example="counter"]'); await click('#sandbox-preview');
  assert.match(await run(`${get('#sandbox-output')}.textContent`), /souls/);
  assert.equal(await souls(), 1);
  await click('#sandbox-commit'); assert.equal(await souls(), 2);
  await click('#sandbox-undo'); assert.equal(await souls(), 1);
  await t.test('自定义状态示例可通过 VM 校验', async () => {
    await click('[data-example="custom-status"]');
    await click('#sandbox-preview');
    assert.equal(await run(`${get('#sandbox-commit')}.disabled`), false, await run(`${get('#sandbox-output')}.textContent`));
  });
  await run(`(() => {
    const editor = ${get('#sandbox-editor')};
    editor.value = JSON.stringify([
      {type:'define_status_template',template:{id:'bone_frost',name:'蚀骨寒霜',category:'dot',
        remainingTurns:2,durationType:'battle_turns',stackMode:'refresh',maxStacks:1,
        rules:[{id:'bone-frost-tick',hook:'turn_start',program:[{op:'damage',target:'self',amount:3,damageType:'energy',direct:false}]}]}},
      {type:'upsert_status',unitId:'swordsman',statusId:'bone_frost'},
    ]);
    editor.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await click('#sandbox-preview');
  assert.match(await run(`${get('#sandbox-output')}.textContent`), /bone_frost/);
  assert.equal((await state()).statusTemplates?.bone_frost, undefined);
  await click('#sandbox-commit');
  assert.equal((await state()).statusTemplates.bone_frost.name, '蚀骨寒霜');
  assert.ok((await state()).units.swordsman.statuses.bone_frost);
  await click('#sandbox-undo');
  assert.equal((await state()).statusTemplates?.bone_frost, undefined);
  await send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath: profile });
  await click('#export-report');
  assert.equal(await run(`${get('#report-dialog')}.open`), true);
  const deliveredReport = await run(`${get('#report-text')}.value`);
  assert.match(deliveredReport, /回合一[\s\S]*确定先攻次序[\s\S]*受伤斥候\(\d+, \d+, z=-?\d+\)倒下/);
  assert.doesNotMatch(deliveredReport, /<UpdateVariable>/);
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
  await until(async () => await souls() === 1, '导入恢复');
  assert.deepEqual(await state(), exported.state);
  await send('Page.reload');
  await until(() => run('!!window.FatedTacticalGame && document.querySelectorAll("#board .tactical-cell").length === 100'), '刷新恢复');
  assert.deepEqual(await state(), exported.state);
  let red = await actor();
  for (let i=0; red.team !== 'red' && i<8; i++) { await click('#end-turn'); red = await actor(); }
  assert.equal(red.team,'red');
  const logsBeforeAuto = (await state()).logs.length;
  await select('#anim-speed', '0.5');
  await select('#ai-speed','80'); await click('#auto-ai');
  await until(() => run(`document.querySelector('.ft-app').dataset.busy === 'true'`), '敌方行动有演出');
  await until(async () => (await state()).logs.length > logsBeforeAuto, '自动敌方回合');
  await until(() => run(`document.querySelector('.ft-app').dataset.busy === 'false'`), '演出播完');
  await select('#anim-speed', '0');
  await click('#auto-ai');
  await send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath: profile });
  const soulsBeforeCarry = await souls();
  assert.equal(soulsBeforeCarry, 1);
  await click('#export-persistent');
  const carry = join(profile, 'fated-ruins-persistent.json');
  await until(async () => { try { return JSON.parse(await readFile(carry, 'utf8')); } catch { return null; } }, '跨战文件下载');
  await select('#scenario-select', 'boss');
  const doc = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', { nodeId:doc.root.nodeId, selector:'#import-snapshot' });
  await send('DOM.setFileInputFiles', { nodeId:input.nodeId, files:[carry] });
  await until(async () => (await state()).scenarioId === 'boss', '导入跨战文件').catch(async e => { throw new Error(e.message + ' | ' + await run(`document.querySelector('#action-error').textContent + ' | ' + window.FatedTacticalGame.getBattleState().scenarioId`)); });
  await t.test('跨战存档保留武器灵魂池', async () => {
    assert.equal(await souls(), soulsBeforeCarry);
  });
  await run(`(() => {
    const g=window.FatedTacticalGame;
    const p=g.proposeCommands([{type:'set_unit_stat',unitId:'colossus',patch:{x:2,y:4}}],{baseRevision:g.getStateSummary().revision,reason:'测试撤离'});
    if (!p.ok || !g.commitProposal(p.proposalId).ok) throw new Error(p.error);
  })()`);
  await click(cell(0,3));
  assert.match(await run(`${get('#tactical-preview')}.textContent`), /借机风险.*守门巨像/);
  await click(actions('disengage')); assert.equal((await state()).units.swordsman.x,0);
  assert.equal((await state()).logs.some(e=>e.type==='opportunity'),false);
  // 手机：默认整盘可见且不被 HUD 遮挡；放大后棋盘可拖动
  const boardFit = () => run(`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const g=document.querySelector('#board').getBoundingClientRect(), s=document.querySelector('.axis-scroll'), hud=document.querySelector('.ft-hud-top').getBoundingClientRect(), dock=document.querySelector('.ft-dock').getBoundingClientRect();
    const side = dock.height > innerHeight*.7;
    done({ pageFits: document.documentElement.scrollWidth<=innerWidth, scrollable: s.scrollWidth>s.clientWidth+1 || s.scrollHeight>s.clientHeight+1,
      clear: g.top>=hud.bottom-1 && g.left>=0 && (side ? g.right<=dock.left+1 : g.bottom<=dock.top+1 && g.right<=innerWidth),
      side, compact: document.querySelector('#board-frame').dataset.compact, cell: Math.round(document.querySelector('#board .tactical-cell').getBoundingClientRect().width) });
  })))`);
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  let fit = await boardFit();
  assert.deepEqual({ ...fit, cell: fit.cell >= 30 }, { pageFits:true, scrollable:false, clear:true, side:false, compact:'true', cell:true }, '竖屏手机整盘可见');
  await click('#zoom-in'); await click('#zoom-in'); await click('#zoom-in');
  fit = await boardFit();
  assert.deepEqual([fit.scrollable, fit.cell >= 50, fit.compact, await run(`${get('#zoom-reset')}.textContent`)], [true, true, 'false', '195%'], '放大后可拖动');
  await click('#zoom-reset');
  assert.equal(await run(`${get('#zoom-reset')}.textContent`), '100%');
  await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:2 });
  { const c = await run(`(() => { const r=${get('#board')}.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
    const at = d => [{ x:c.x-d, y:c.y, id:1 }, { x:c.x+d, y:c.y, id:2 }];
    await send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:at(40) });
    for (const d of [60, 80, 100]) await send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:at(d) });
    await send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }); }
  assert.equal(await run(`${get('#zoom-reset')}.textContent`), '250%', '双指张开放大');
  assert.equal(await run('visualViewport.scale'), 1, '双指不缩放整页');
  await click('#zoom-reset');
  await send('Emulation.setDeviceMetricsOverride', { width:844, height:390, deviceScaleFactor:1, mobile:true });
  fit = await boardFit();
  assert.deepEqual({ ...fit, cell: fit.cell >= 28 }, { pageFits:true, scrollable:false, clear:true, side:true, compact:'true', cell:true }, '横屏手机：动作区在右侧，棋盘不被遮挡');
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:850, deviceScaleFactor:1, mobile:true });
  await boardFit();
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
  assert.equal(await run(`Boolean(${get(actions('brace'))})`), false);
  await click('#end-turn');
  await returnToSwordsman();
  await run(`(() => {
    const game = window.FatedTacticalGame, fixture = game.getBattleState();
    for (let i=0; i<24; i++) {
      const id='mobile-armor-'+i;
      fixture.skills[id]={...fixture.skills.armor,name:'竖屏护甲 '+i};
      fixture.units.swordsman.skills.push(id);
    }
    game.createBattle({kind:'custom_state',state:fixture});
  })()`);
  const rested = (await state()).units.swordsman;
  await tap(cell(rested.x, rested.y));
  await until(() => run(`Boolean(${get(actions('brace'))})`), '下一回合恢复动作槽');
  assert.ok(await run(`${get(actions('brace'))}.getBoundingClientRect().height>=44`));
  const armorButton = '#action-toolbar [data-skill-id="armor"]';
  await tap(armorButton);
  await until(() => run(`!${get('#confirm-action')}.hidden`), '触屏选择技能等待确认');
  const offset = await run(`(() => { const card=${get('#target-actions')}; card.scrollTop=card.scrollHeight; return card.scrollTop; })()`);
  assert.ok(offset > 0, '竖屏长菜单确实需要滚动');
  await run('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
  assert.equal(await run(`${get('#target-actions')}.scrollTop`), offset, '浮卡滚动不能把确认按钮刷走');
  await tap('#confirm-action');
  await until(async () => (await state()).units.swordsman.statuses.thorns, '触屏滚动后确认技能');
  await click('#resource-button');
  await run(`${get('#resource-input')}.value = JSON.stringify({stats:{str:7,agi:21,con:6,int:4,spi:4},tier:1,previous:{hp:{current:22,max:44}}})`);
  await click('#calculate-resources');
  assert.match(await run(`${get('#resource-output')}.textContent`), /HP 321\/642/);
  await click('#resource-dialog form button');
  assert.deepEqual({ pageErrors, consoleErrors }, { pageErrors:[], consoleErrors:[] });
  t.diagnostic('实测 100 格、4 掩体、4 互动点；1440px 无重叠，390 竖屏与 844×390 横屏整盘可见；0 pageerror / 0 console.error');
});

test('真实 Chrome：黑灵灵魂计数跨两场 0→3→5，MVU 写回幂等、Swipe 拦截、重开回滚与战报交付', { timeout: 45000 }, async t => {
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
  const profile = await mkdtemp(join(tmpdir(), 'fated-black-spirit-'));
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let socket;
  t.after(async () => {
    socket?.close(); child.kill(); server.close(); await pause(400);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  });
  const port = await until(async () => {
    if (spawnError) throw spawnError;
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; }
  }, '黑灵 Chrome CDP 端口');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  });
  let serial = 0;
  const responses = new Map(), pageErrors = [], consoleErrors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const reply = responses.get(message.id); responses.delete(message.id);
      if (message.error) reply.reject(new Error(`${reply.method}: ${message.error.message}`)); else reply.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.description ?? arg.value));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    responses.set(++serial, { method, resolve, reject }); socket.send(JSON.stringify({ id: serial, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const run = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const get = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const click = async selector => {
    const box = await run(`(() => { const element=${get(selector)}; if (!element) return null; element.scrollIntoView({block:'center',inline:'center'}); const r=element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:element.disabled}; })()`);
    assert.ok(box && !box.disabled, `黑灵场景可点击 ${selector}; ${await run(`JSON.stringify({output:${get('#sandbox-output')}.textContent,editor:${get('#sandbox-editor')}.value,state:window.__fatedTacticalTavern.getState()})`)}`);
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:box.x, y:box.y, button:'left', clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:box.x, y:box.y, button:'left', clickCount:1 });
  };
  const select = (selector, value) => run(`(() => { const input=${get(selector)}; input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const state = () => run('window.__fatedTacticalTavern.getState()');
  const battleFixture = id => `<battle_init>\nbattle|1|${id}|黑灵测试|flat|7\nunit|p1|blue|mvu:主角|玩家|1,1\nunit|e1|red|char_info|木桩|2,1\n</battle_init>`;
  const statData = souls => ({ 主角: {
    属性: { 力量:6, 敏捷:6, 体质:6, 智力:5, 精神:5 },
    生命值: { 当前:100, 上限:{ _基础:100, 额外:0 } },
    法力值: { 当前:20, 上限:{ _基础:20, 额外:0 } },
    体力值: { 当前:20, 上限:{ _基础:20, 额外:0 } },
    装备: { 黑灵: { 类型:'武器', 位置:'主手', pools:{ souls:{ cap:10, initial:souls } }, 标签:['匕首','攻击: 100',`灵魂计数：${souls}`] } },
  } });
  await send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/tavern.html` });
  await until(() => run('document.readyState === "complete"'), '黑灵酒馆页面加载');
  await run(`(async () => {
    window.hostEvents = new Map();
    window.eventOn = (name, fn) => { hostEvents.set(name, fn); return () => hostEvents.delete(name); };
    window.eventEmit = (name, payload) => hostEvents.get(name)?.(payload);
    window.SillyTavern = { substituteParams: value => value };
    window.deliveredReports = [];
    const textarea = document.createElement('textarea'); textarea.id = 'send_textarea';
    textarea.addEventListener('input', () => deliveredReports.push(textarea.value)); document.body.append(textarea);
    const bundle = await (await fetch('/dist/tavern.iife.js')).text();
    const iframe = document.createElement('iframe'); iframe.hidden = true; document.body.append(iframe);
    window.overlayFrame = iframe; window.overlayBundle = bundle;
    window.hostMessages = [
      { message_id:10, swipe_id:0, role:'assistant', message:'<char_info>{"name":"木桩","stats":{"agi":-20}}</char_info>'+${JSON.stringify(battleFixture('black-spirit-b1'))} },
      { message_id:11, swipe_id:0, role:'assistant', message:'首战后续' },
    ];
    window.mvuEnvelopes = Object.fromEntries([[10,0],[11,0]].map(([message_id,souls]) => [message_id,{ swipe_id:0, stat_data:${JSON.stringify(statData(0))}, initialized_lorebooks:['原卡'] }]));
    window.mvuWrites = [];
    window.Mvu = {
      getMvuData({message_id}) { return structuredClone(mvuEnvelopes[message_id]); },
      replaceMvuData(next, {message_id}) { mvuWrites.push({messageId:message_id,next:structuredClone(next)}); mvuEnvelopes[message_id]=structuredClone(next); },
    };
    window.getLastMessageId = () => hostMessages.at(-1).message_id;
    window.getChatMessages = () => hostMessages;
    iframe.contentWindow.eval(bundle);
  })()`);
  await until(() => run('!!window.__fatedTacticalTavern'), '黑灵 overlay 挂载');
  await run(`window.__fatedTacticalTavern.open()`);
  await until(() => run(`window.__fatedTacticalTavern.getState()?.scenarioId === 'black-spirit-b1'`), '首战状态加载');
  await click('[data-tab="sandbox"]');
  await run(`(() => {
    const state=window.__fatedTacticalTavern.getState();
    const poolId=state.pools[state.items[state.units.p1.mainHand].pools.souls].id;
    const editor=document.querySelector('#sandbox-editor');
    const enemyHp=state.pools[state.units.e1.pools.hp].id;
    editor.value=JSON.stringify([{type:'adjust_pool',poolId,operation:'set',value:3},{type:'adjust_pool',poolId:enemyHp,operation:'set',value:0}]);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await run(`document.querySelector('#sandbox-preview').click()`);
  await until(() => run(`${get('#sandbox-output')}.textContent.length > 0`), '首战沙盒试算');
  await run(`document.querySelector('#sandbox-commit').click()`);
  await until(() => run(`window.__fatedTacticalTavern.getState().outcome === 'blue'`), '首战胜负结算').catch(async error => { throw new Error(`${error.message}: ${await run(`JSON.stringify({output:${get('#sandbox-output')}.textContent,state:window.__fatedTacticalTavern.getState()})`)}`); });
  await until(() => run(`!${get('[data-mvu-settlement]')}.hidden`), '首战显示 MVU 结算');
  assert.match(await run(`${get('[data-mvu-summary]')}.textContent`), /灵魂计数/);
  await run('window.mvuEnvelopes[10].swipe_id=9');
  await click('[data-mvu-writeback]');
  await until(() => run(`${get('[data-page="sandbox"] [data-status]')}.textContent.includes('SWIPE_MISMATCH')`), '首战 Swipe 错误提示');
  assert.equal(await run('window.mvuWrites.length'), 0);
  await run('window.mvuEnvelopes[10].swipe_id=0');
  await click('[data-mvu-writeback]');
  await until(() => run('window.mvuWrites.length === 1'), '首战 MVU 写回');
  assert.equal(await run(`window.mvuEnvelopes[11].stat_data.主角.装备.黑灵.标签[2]`), '灵魂计数：3');
  assert.equal(await run(`window.mvuEnvelopes[11].initialized_lorebooks[0]`), '原卡');
  assert.equal(await run('window.deliveredReports.length'), 1);
  assert.doesNotMatch(await run('window.deliveredReports[0]'), /<UpdateVariable>[\s\S]*<\/UpdateVariable>/);
  await run('window.__fatedTacticalTavern.open()'); await click('[data-tab="sandbox"]');
  await click('[data-page="sandbox"] > .fated-actions button:first-child');
  await until(() => run(`!${get('[data-mvu-settlement]')}.hidden`), '首战重复确认界面');
  assert.equal(await run(`${get('[data-mvu-writeback]')}.disabled`), true);
  assert.equal(await run('window.mvuWrites.length'), 1);
  await click('[data-mvu-deliver-only]');
  await until(() => run(`${get('.fated-tavern-panel')}.hidden`), '仅交付首战战报');
  assert.equal(await run('window.mvuWrites.length'), 1);
  assert.equal(await run('window.deliveredReports.length'), 2);
  await run(`(() => {
    window.hostMessages.push({message_id:12,swipe_id:0,role:'assistant',message:'<char_info>{"name":"木桩","stats":{"agi":-20}}</char_info>'+${JSON.stringify(battleFixture('black-spirit-b2'))}});
    window.hostMessages.push({message_id:13,swipe_id:0,role:'assistant',message:'次战后续'});
    window.mvuEnvelopes[12]={swipe_id:0,stat_data:${JSON.stringify(statData(3))},initialized_lorebooks:['原卡']};
    window.mvuEnvelopes[13]={swipe_id:0,stat_data:${JSON.stringify(statData(3))},initialized_lorebooks:['原卡']};
  })()`);
  await run('window.__fatedTacticalTavern.open()');
  await until(() => run(`window.__fatedTacticalTavern.getState()?.scenarioId === 'black-spirit-b2'`), '次战状态加载');
  await click('[data-tab="sandbox"]');
  await run(`(() => {
    const state=window.__fatedTacticalTavern.getState();
    const poolId=state.pools[state.items[state.units.p1.mainHand].pools.souls].id;
    const editor=document.querySelector('#sandbox-editor');
    const enemyHp=state.pools[state.units.e1.pools.hp].id;
    editor.value=JSON.stringify([{type:'adjust_pool',poolId,operation:'set',value:5},{type:'adjust_pool',poolId:enemyHp,operation:'set',value:0}]);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await run(`document.querySelector('#sandbox-preview').click()`);
  await until(() => run(`${get('#sandbox-output')}.textContent.length > 0`), '次战沙盒试算');
  await run(`document.querySelector('#sandbox-commit').click()`);
  await until(() => run(`window.__fatedTacticalTavern.getState().outcome === 'blue'`), '次战胜负结算');
  await until(() => run(`!${get('[data-mvu-settlement]')}.hidden`), '次战显示 MVU 结算');
  assert.deepEqual(await run(`Array.from(${get('[data-mvu-target]')}.options).map(option=>option.value)`), ['latestFloor','battleFloor']);
  await select('[data-mvu-target]', 'latestFloor');
  await click('[data-mvu-writeback]');
  await until(() => run('window.mvuWrites.length === 2'), '次战 MVU 写回');
  assert.equal(await run(`window.mvuEnvelopes[13].stat_data.主角.装备.黑灵.标签[2]`), '灵魂计数：5');
  assert.equal(await run('window.deliveredReports.at(-1).includes("无需在 <UpdateVariable> 中重复扣减")'), true);
  await run('window.__fatedTacticalTavern.open()'); await click('[data-tab="sandbox"]');
  await click('[data-page="sandbox"] > .fated-actions button:first-child');
  await until(() => run(`!${get('[data-mvu-settlement]')}.hidden`), '次战重复确认界面');
  assert.equal(await run(`${get('[data-mvu-writeback]')}.disabled`), true);
  assert.equal(await run('window.mvuWrites.length'), 2);
  await run(`document.querySelector('#reset-button').click()`);
  await until(() => run(`window.__fatedTacticalTavern.getState().outcome === null`), '次战重开');
  assert.equal(await run(`window.__fatedTacticalTavern.getState().pools[window.__fatedTacticalTavern.getState().items[window.__fatedTacticalTavern.getState().units.p1.mainHand].pools.souls].current`), 3);
  assert.equal(await run(`window.mvuEnvelopes[13].stat_data.主角.装备.黑灵.标签[2]`), '灵魂计数：3');
  assert.equal(await run('window.mvuWrites.length'), 3);
  assert.deepEqual({ pageErrors, consoleErrors }, { pageErrors:[], consoleErrors:[] });
  t.diagnostic('黑灵两战完成 0→3→5；重复写回未增加 host write，Swipe 错误未写入，重开回滚次战至 3，战报交付不含 UpdateVariable');

  await t.test('战场区域独立编译、重置、跨楼豁免和撤回', async () => {
    const scene = (battleId, flavorId, mechanical = false) => `<!-- endingSheet: 并输出<battle_init>块。 -->
<think>讨论<battle_init>语法</think>
${battleFixture(battleId).replace('</battle_init>', `${mechanical ? '效果|fog|红|雾障：区域内闪避降低4点|全场(0-1)\n' : ''}效果|${flavorId}|全体|海风：空气微咸|全场\n</battle_init>`)}`;
    const nextFloor = async (id, battleId, flavorId, mechanical = false) => {
      await run(`hostMessages.push({message_id:${id},swipe_id:0,role:'assistant',message:${JSON.stringify(scene(battleId, flavorId, mechanical))}});
        mvuEnvelopes[${id}]={swipe_id:0,stat_data:${JSON.stringify(statData(id - 13))}};
        void window.__fatedTacticalTavern.open()`);
      await until(() => run(`window.__fatedTacticalTavern.getState()?.scenarioId === ${JSON.stringify(battleId)}`), '环境战场加载');
      await click('[data-tab="instances"]');
    };
    await run(`window.sceneRequests=[]; window.generateRaw=async config=>{
      sceneRequests.push(config.ordered_prompts);
      const warnings=window.__fatedTacticalTavern.getState().warnings.filter(w=>w.scope==='scene' && config.ordered_prompts.some(p=>p.content.includes(JSON.stringify(w.message))));
      const fog=warnings.find(w=>w.originPath==='/zones/fog');
      return JSON.stringify({patch:fog?[{op:'replace',path:'/zones/fog/mods',resolves:[{unitId:null,originPath:fog.originPath,effectName:'雾障'}],value:[{stat:'dodge',flat:-4,when:"self.team == 'red'"}]}]:[],
        narrative:warnings.filter(w=>w!==fog).map(w=>({unitId:null,originPath:w.originPath,message:w.message,reason:'纯背景风味'}))});
    }`);
    await nextFloor(14, 'scene-one', 'flavor1', true);
    const fog = '.fated-battle-zone-item[data-zone-id="fog"]';
    const flavor = id => `.fated-battle-zone-item[data-zone-id="${id}"]`;
    const zoneRow = selector => run(`${get(selector)}?.textContent ?? ''`);
    await until(async () => (await zoneRow(fog)).includes('已编译') && (await zoneRow(flavor('flavor1'))).includes('已豁免'), '仅环境自动编译及 AI 豁免').catch(async error => {
      throw new Error(`${error.message}: ${await zoneRow(fog)} / ${await zoneRow(flavor('flavor1'))} / ${await run('sceneRequests.length')} 请求 / ${await run(`document.querySelector('.fated-toast')?.textContent`)} / ${JSON.stringify(consoleErrors)}`);
    });
    assert.equal(await run(`${get('[data-normalize]')}.disabled`), true, await run(`JSON.stringify(window.__fatedTacticalTavern.getState().warnings)`));
    assert.equal(await run('sceneRequests.length'), 1);
    assert.match(await run(`JSON.stringify(sceneRequests[0])`), /rawZones/);
    await click('[data-tab="sandbox"]');
    await click('#board [data-unit-id="e1"]');
    assert.match(await run(`${get('#unit-card')}.textContent`), /所处区域.*雾障（常驻）/);
    await click('[data-tab="instances"]');
    await run(`${get('[data-zone-discard="fog"]')}.click(); [...${get('[data-page="instances"]')}.querySelectorAll('button')].find(b=>b.textContent==='取消全选').click()`);
    assert.equal(await run(`${get('[data-normalize]')}.disabled`), false, '取消全选仍可编译待处理区域');
    await run(`${get('.fated-battle-card [data-warning-action="ignore"]')}.click()`);
    assert.match(await zoneRow(fog), /已豁免/);
    assert.equal(await run(`${get('[data-normalize]')}.disabled`), true);
    await run(`[...document.querySelectorAll('.fated-battle-card [data-warning-action="restore"]')].find(b=>b.closest('li').textContent.includes('雾障')).click()`);
    await run(`${get('[data-normalize]')}.click()`);
    await until(async () => (await zoneRow(fog)).includes('已编译') && await run(`${get('[data-normalize]')}.disabled`), '零角色手动重编译区域');
    await nextFloor(15, 'scene-two', 'flavor2');
    assert.match(await zoneRow(flavor('flavor2')), /已豁免/, '不同楼层与 ID、不同 MVU 不影响 AI 豁免');
    assert.equal(await run('sceneRequests.length'), 2);
    await run(`${get('.fated-battle-card [data-warning-action="restore"]')}.click()`);
    assert.match(await zoneRow(flavor('flavor2')), /待标准化/);
    // Rehydrate on another floor, outside the automatic first-entry job, to
    // check that the new tombstone suppresses the older receipt across floors.
    await run(`hostMessages[hostMessages.length-1].message=${JSON.stringify(scene('scene-two', 'flavor3'))};
      window.__fatedTacticalTavern.scan({rehydrate:true})`);
    await until(async () => (await zoneRow(flavor('flavor3'))).includes('待标准化'), '撤回墓碑保留');
    assert.deepEqual({ pageErrors, consoleErrors }, { pageErrors:[], consoleErrors:[] });
  });
});
