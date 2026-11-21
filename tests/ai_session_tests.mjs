import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiSessions } from '../src/tavern/ai-sessions.js';
import { fetchModels, requestViaCustomApi } from '../src/tavern/api.js';
import { assembleMessages, DEFAULT_SLOTS, describeSlots, makeCustomSlot, resolveSlotContent } from '../src/tavern/prompts.js';

import { effectSchema } from '../src/core/effect_schema.js';

test('每个 DSL 节点的用法说明进入实际组装的默认助手消息', () => {
  const messages = assembleMessages(DEFAULT_SLOTS, {});
  for (const rule of effectSchema.$defs.node.oneOf) {
    const kind = rule.properties.kind.const;
    assert.match(rule.description, /\p{Script=Han}/u, kind);
    assert.ok(messages.some(m => m.content.includes(`• ${kind}：${rule.description}`)), kind);
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

gate('G45', '任务拆解、自查与 DSL 示例', () => {
  const task = resolveSlotContent({ id: 'task' });
  assert.equal(task.split('\n').filter(line => line.startsWith('• ') && line.includes('"trigger"')).length, 9);
  assert.match(task, /临时土墙[^\n]+"remainingTurns":3/);
  assert.match(task, /低伤校准[^\n]+"lethal":false/);
  for (const text of ['先尝试拆解，再考虑放弃', '多状态 + 手动触发技能', '简述尝试过的方向', '参数写全了吗？statusId 存在吗？数值在范围内吗？']) assert.ok(task.includes(text));
  assert.doesNotMatch(task, /卡在哪一步/);
});

test('G97 protocol maps mixed damage, empty effects and worldbook tags', () => {
  const protocol = resolveSlotContent({ id: 'protocol' });
  assert.match(protocol, /混合伤害：.*必须拆成多个 damage 节点.*每个节点只写一个 damageType/);
  const nodes = JSON.parse(protocol.match(/混合伤害：.*?例：(\[.*?\])。/)[1]);
  assert.deepEqual(nodes, [{ kind: 'damage', flat: 40, damageType: 'physical' }, { kind: 'damage', flat: 20, damageType: 'energy' }]);
  assert.match(protocol, /空效果：.*为 \{\} 或缺失.*不产生任何补丁操作，也不计入 unresolved.*纯位移、纯状态授予.*不属于空效果/);
  for (const tag of ['[威力: X 物理]', '[关联属性: 敏捷]', '[有效距离: 中程(5)]', '[单体]', '[范围: 中程(4)+扇(敌方)]']) assert.ok(protocol.includes(tag), tag);
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
