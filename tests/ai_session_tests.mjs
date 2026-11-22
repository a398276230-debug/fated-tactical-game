import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiSessions } from '../src/tavern/ai-sessions.js';
import { fetchModels, requestViaCustomApi } from '../src/tavern/api.js';
import { assembleMessages, DEFAULT_SLOTS, describeSlots, makeCustomSlot, resolveSlotContent } from '../src/tavern/prompts.js';

import { validVmRule, vmSchema } from '../src/core/vm-schema.js';
import { applyAction, currentUnit, refreshOpeningInitiative } from '../src/core/combat.js';
import { validateState } from '../src/api/validation.js';
import { dispatchVMHook } from '../src/core/vm-runtime.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { applyPatch } from '../src/tavern/overlay.js';

test('每个 VM 指令的用法说明进入实际组装的默认助手消息', () => {
  const messages = assembleMessages(DEFAULT_SLOTS, {});
  for (const opcode of vmSchema.$defs.opcode.oneOf) {
    const op = opcode.properties.op.const;
    assert.match(opcode.description, /\p{Script=Han}/u, op);
    assert.ok(messages.some(m => m.content.includes(`• ${op}：${opcode.description}`)), op);
  }
});

const gate = (id, description, fn) => test(`${id} ${description}`, fn);

gate('G41', '身份槽位在首位且包含完整职责', () => {
  const identity = DEFAULT_SLOTS[0];
  assert.equal(identity.id, 'identity');
  assert.equal(identity.role, 'system');
  assert.ok(identity.content.length >= 300 && identity.content.length <= 600);
  for (const text of ['你是命定战斗助手', '待处理警告', '必须', '不做叙事、不扮演角色、不推进剧情']) assert.ok(identity.content.includes(text));
});

gate('G42', '内置与新建自定义槽位默认均为 system', () => {
  assert.ok([...DEFAULT_SLOTS, makeCustomSlot()].every(slot => slot.role === 'system'));
});

gate('G43', '合并保持内容和顺序，跳过空槽位，assistant 独立', () => {
  const slots = DEFAULT_SLOTS.map(slot => ({ ...slot, enabled: true }));
  const ctx = { rosterText: '参战快照', battleText: '地形快照', warningsText: '警告清单', extraText: '额外约定' };
  assert.deepEqual(assembleMessages(slots, ctx), [{
    role: 'system', slotId: slots.map(slot => slot.id).join('+'), slotLabel: slots.map(slot => slot.label).join(' / '),
    content: slots.map(slot => resolveSlotContent(slot, ctx)).join('\n\n'),
  }]);
  const [message] = assembleMessages(slots, { ...ctx, extraText: '   ' });
  assert.equal(message.slotId, slots.slice(0, -1).map(slot => slot.id).join('+'));
  assert.equal(message.content, slots.slice(0, -1).map(slot => resolveSlotContent(slot, ctx)).join('\n\n'));
  assert.equal(assembleMessages(slots.slice(0, 2).map(slot => ({ ...slot, role: 'assistant' }))).length, 2);
});

gate('G44', '旧内置 user 一次迁移，自定义 role 保留', () => {
  const custom = { ...makeCustomSlot(), role: 'user', content: '保留自定义角色' };
  const legacy = [...DEFAULT_SLOTS.slice(1).map(slot => ({ ...slot, role: 'user' })), custom];
  const migrated = describeSlots(legacy);
  assert.equal(migrated[0].id, 'identity');
  assert.ok(migrated.slice(0, -1).every(slot => slot.role === 'system'));
  assert.deepEqual(migrated.at(-1), custom);
  migrated[2].role = 'user';
  assert.deepEqual(describeSlots(migrated), migrated);
});

gate('G45', '任务拆解、自查与 VM 示例', () => {
  const task = resolveSlotContent({ id: 'task' });
  const examples = [...task.matchAll(/^• [^\n：]+值：(\{.*\})$/gm)].map(([, json]) => JSON.parse(json));
  assert.equal(examples.length, 11);
  const statusTemplates = { laugh_disabled: examples.find(example => example.id === 'laugh_disabled') };
  for (const example of examples) {
    for (const rule of example.rules ?? [example]) assert.equal(validVmRule(rule, { statusTemplates }), true, rule.id);
  }
  assert.match(task, /低伤校准[^\n]+"lethal":false/);
  assert.match(task, /飞行规则值[^\n]+"mode":"altitude","deltaZ":3/);
  for (const text of ['先尝试拆解，再考虑放弃', '未解决或仅部分解决', '{unitId, originPath, message}，附简短中文 reason', '检查 hook 和 op 字段、目标引用、池名称、状态 ID 与数值范围']) assert.ok(task.includes(text));
  assert.doesNotMatch(task, /卡在哪一步/);
});

test('默认发送的召唤食谱可直接应用，生成的亡卫持有同批新增的专属技能', () => {
  const message = assembleMessages(DEFAULT_SLOTS, { kind: 'validate' }).map(row => row.content).join('\n');
  assert.doesNotMatch(message, /平暴击×1\.3|切磋40%/);
  const { patch } = JSON.parse(message.match(/^\{"patch":.*$/m)[0]);
  const initial = buildScenario('ruins');
  initial.statusTemplates ??= {};
  initial.skills.call_guard = { name: '召唤亡卫', ap: 1, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [] };
  currentUnit(initial).skills.push('call_guard');
  const state = validateState(applyPatch(initial, patch, true));
  const actor = currentUnit(state);
  applyAction(state, { type: 'skill', skillId: 'call_guard', x: actor.x, y: actor.y });
  const guard = Object.values(state.units).find(unit => unit.name === '亡卫');
  assert.deepEqual(guard?.skills, ['guard_slash']);
  assert.equal(state.statusTemplates.guard_chill.name, '星霜');
});

test('默认天气、磁带重放和资源封印食谱在生产 VM 中结算', () => {
  const task = resolveSlotContent({ id: 'task' });
  const recipe = label => JSON.parse(task.match(new RegExp(`^• ${label}规则值：(.*)$`, 'm'))[1]);
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  const enemy = Object.values(state.units).find(unit => unit.team !== actor.team);
  actor.rules = [recipe('封印资源')];
  state.skills.weather = { name: '天气', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [recipe('天气')] };
  state.skills.probe = { name: '资源探针', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [{
    id: 'probe_changes', hook: 'active', program: [
      { op: 'damage', target: 'self', amount: 3, damageType: 'true' },
      { op: 'heal', target: 'self', amount: 2 },
      { op: 'resource', target: 'self', pool: ['mp', 'sp'], mode: 'set', amount: 0 },
    ],
  }] };
  state.skills.reprise = { name: '重放', ap: 0, slot: 'action', range: 0, shape: 'single', target: 'self', rules: [recipe('本回合重放')] };
  actor.skills.push('weather', 'probe', 'reprise');
  const cast = skillId => applyAction(state, { type: 'skill', skillId, x: actor.x, y: actor.y });
  const probe = structuredClone(state);
  delete probe.units[actor.id].rules;
  applyAction(probe, { type: 'skill', skillId: 'probe', x: actor.x, y: actor.y });
  assert.notEqual(probe.units[actor.id].hp, actor.hp);
  const resources = [actor.hp, actor.mp, actor.sp];
  assert.ok(actor.mp > 0 && actor.sp > 0);
  cast('probe');
  assert.deepEqual([actor.hp, actor.mp, actor.sp], resources);
  assert.deepEqual(cast('reprise').filter(row => row.type === 'action').map(row => row.detail.action.skillId), ['reprise', 'probe']);
  cast('weather');
  const hp = enemy.hp;
  dispatchVMHook(state, 'turn_start', { actorId: enemy.id, targetId: enemy.id, ownerIds: [enemy.id] });
  assert.equal(enemy.hp, hp - 10);
});

test('技能先手按槽取最大值并复用开场骰，模板接受 30 格但拒绝 31 格', () => {
  const state = buildScenario('ruins');
  const actor = currentUnit(state);
  for (const [id, slot, initiativeBonus] of [['one', 'attack', 8], ['two', 'attack', 5], ['three', 'action', 6]]) {
    state.skills[id] = { name: id, ap: 0, slot, initiativeBonus, range: 30, radius: 30, shape: 'circle', target: 'cell' };
    actor.skills.push(id);
  }
  validateState(state);
  const opening = () => state.logs[0].detail.initiative.find(row => row.unitId === actor.id);
  const { roll, total } = opening();
  refreshOpeningInitiative(state);
  assert.deepEqual([opening().roll, opening().total, opening().attackInit, opening().actionInit], [roll, total + 14, 8, 6]);
  state.skills.one.radius = 31;
  assert.throws(() => validateState(state));
  state.skills.one.radius = 30;
  state.skills.one.range = 31;
  assert.throws(() => validateState(state));
});

test('G97 protocol maps mixed damage, empty effects and worldbook tags', () => {
  const protocol = resolveSlotContent({ id: 'protocol' });
  assert.match(protocol, /混合伤害：.*拆成两个指令.*不再额外造成总威力伤害/);
  const program = JSON.parse(protocol.match(/混合伤害：.*?例：(\[.*?\])。/)[1]);
  assert.deepEqual(program, [{ op: 'damage', target: 'target', amount: 40, damageType: 'physical' }, { op: 'damage', target: 'target', amount: 20, damageType: 'energy' }]);
  assert.match(protocol, /原文效果为 \{\} 或缺失且没有其他可执行描述时，无需补丁，也不计入 unresolved。位移、治疗、资源和状态授予均可形成独立规则/);
  for (const tag of ['[威力: X 物理]', '[关联属性: 敏捷]', '[有效距离: 中程(5)]', '[单体]', '[范围: 中程(4)+扇(敌方)]']) assert.ok(protocol.includes(tag), tag);
});

test('默认标准化消息教模型读实体寄存器、动态生成和使用带签名的查询', () => {
  const text = assembleMessages(DEFAULT_SLOTS, {}).map(message => message.content).join('\n');
  for (const snippet of ['target:"vars.victim"', 'vars.victim.id', "has_status(vars.victim, 'taunt')",
    'vars.lostStacks', 'self.vars.cooldown == null', 'min(a, b)', 'clamp(value, lo, hi)', 'count_units(predicate)',
    'tier:"max(1, self.tier - 1)"', 'single 只覆盖中心格', '都不写时按施术者预算自动生成面板']) {
    assert.ok(text.includes(snippet), snippet);
  }
});

test('纯 system 提示词可发送给 Claude 和 Gemini', async () => {
  const messages = [{ role: 'system', content: '标准化任务' }];
  for (const apiSource of ['claude', 'gemini']) {
    const claude = apiSource === 'claude';
    const reply = await requestViaCustomApi({ apiSource, baseUrl: 'https://example.test', apiKey: 'test', model: 'test', stream: false }, messages, {
      async fetchImpl(_url, options) {
        const body = JSON.parse(options.body);
        if (claude) {
          assert.equal(body.system, '标准化任务');
          assert.deepEqual(body.messages, [{ role: 'user', content: '请执行上述任务。' }]);
          return Response.json({ content: [{ type: 'text', text: '完成' }] });
        }
        assert.deepEqual(body.systemInstruction.parts, [{ text: '标准化任务' }]);
        assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: '请执行上述任务。' }] }]);
        return Response.json({ candidates: [{ content: { parts: [{ text: '完成' }] } }] });
      },
    });
    assert.equal(reply, '完成');
  }
  assert.deepEqual(messages, [{ role: 'system', content: '标准化任务' }]);
});

test('独立 API 经酒馆后端拉取模型并生成，使用独立地址和密钥', async () => {
  const origin = 'https://tavern.example.test';
  const settings = { apiTransport: 'tavern', baseUrl: 'https://upstream.example.test/v1/', apiKey: 'aux-key', model: 'aux-model' };
  const messages = [{ role: 'user', content: '测试', source: 'ui' }];
  const signal = new AbortController().signal;
  const routes = [];
  const options = {
    host: { location: { origin } }, signal,
    async fetchImpl(url, init) {
      assert.equal(init.signal, signal);
      assert.equal(init.mode, 'same-origin');
      assert.equal(init.redirect, 'error');
      const route = new URL(url);
      assert.equal(route.origin, origin);
      routes.push(route.pathname);
      if (route.pathname === '/csrf-token') return Response.json({ token: 'csrf-test' });
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-CSRF-Token'], 'csrf-test');
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.chat_completion_source, 'custom');
      assert.equal(body.custom_url, 'https://upstream.example.test/v1');
      assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer aux-key' });
      if (route.pathname.endsWith('/status')) return Response.json({ data: [{ id: 'aux-model' }] });
      assert.equal(body.model, 'aux-model');
      assert.deepEqual(body.messages, [{ role: 'user', content: '测试' }]);
      return body.stream
        ? new Response('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json({ choices: [{ message: { content: '完成' } }] });
    },
  };
  assert.deepEqual(await fetchModels(settings, options), ['aux-model']);
  for (const stream of [true, false]) {
    assert.equal(await requestViaCustomApi({ ...settings, stream }, messages, options), '完成');
  }
  const endpoint = '/api/backends/chat-completions';
  assert.deepEqual(routes, ['/csrf-token', `${endpoint}/status`, '/csrf-token', `${endpoint}/generate`, '/csrf-token', `${endpoint}/generate`]);
});

test('酒馆转发按实际报文识别 SSE 与 JSON，并区分仅推理的结束原因', async () => {
  const settings = { apiTransport: 'tavern', baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'deepseek' };
  const call = (body, type) => requestViaCustomApi(settings, [], { host: { location: { origin: 'https://tavern.test' } },
    fetchImpl: async url => url.endsWith('/csrf-token') ? Response.json({token:'csrf'}) : new Response(body, { headers: { 'Content-Type': type } }) });
  const reasoning = 'data: {"choices":[{"delta":{"reasoning_content":"草稿"}}]}\n\n';
  assert.equal(await call(reasoning + 'data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n', 'application/json'), '正文');
  assert.equal(await call(JSON.stringify({choices:[{message:{content:'正文'}}]}, null, 2), 'text/plain'), '正文');
  await assert.rejects(call(reasoning, 'text/plain'), /未收到 \[DONE\].*推理 2 字符，正文 0/);
  await assert.rejects(call(reasoning + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n', 'text/plain'), /收到 \[DONE\].*finish_reason=length/);
});

test('独立 API 的推理字段不会进入回复或流式回调', async () => {
  const settings = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' };
  for (const stream of [true, false]) {
    const chunks = [];
    await assert.rejects(requestViaCustomApi({ ...settings, stream }, [], {
      onStreamChunk: text => chunks.push(text),
      async fetchImpl() {
        return stream
          ? new Response('data: {"choices":[{"delta":{"reasoning_content":"推理草稿"}}]}\n\ndata: [DONE]\n\n')
          : Response.json({ choices: [{ message: { reasoning_content: '推理草稿' } }] });
      },
    }), /未返回有效文本/);
    assert.deepEqual(chunks, []);
  }
  const chunks = [];
  const text = await requestViaCustomApi(settings, [], {
    onStreamChunk: text => chunks.push(text),
    async fetchImpl() {
      return new Response('data: {"choices":[{"delta":{"reasoning_content":"推理草稿"}}]}\n\ndata: {"choices":[{"delta":{"content":"正式回复"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(text, '正式回复');
  assert.deepEqual(chunks, ['正式回复', '正式回复']);
});

test('会话增删改查、消息追加与持久化保持隔离', () => {
  let stored;
  const store = createAiSessions(null, data => { stored = JSON.stringify(data); }, () => 100);
  const first = store.active();
  const second = store.create();
  const third = store.create();
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  for (const [i, session] of [first, second, third].entries()) {
    store.select(session.id);
    store.rename(session.id, `会话${i + 1}`);
    const [user, assistant] = store.append(session.id, { role: 'user', content: `问题${i + 1}` }, { role: 'assistant', content: '' });
    store.update(session.id, assistant, { content: `回答${i + 1}`, status: 'ok' });
    assert.deepEqual(store.active().messages, [user, assistant]);
  }
  store.select(second.id);
  const restored = createAiSessions(JSON.parse(stored), () => {});
  assert.equal(restored.active().title, '会话2');
  assert.deepEqual(restored.data.sessions.map(s => s.messages[1].content), ['回答1', '回答2', '回答3']);
  store.remove(second.id);
  assert.equal(store.active().id, third.id);
  store.update(second.id, second.messages[1], { content: '已删除会话的迟到响应' });
  assert.equal(store.get(second.id), undefined);
  assert.equal(store.active().messages[1].content, '回答3');
  store.clear(third.id);
  assert.equal(store.active().messages.length, 0);
  assert.equal(store.get(first.id).messages.length, 2);
  store.remove(first.id);
  store.remove(third.id);
  assert.equal(store.data.sessions.length, 1);
  assert.deepEqual(store.active().messages, []);
});
