// Different TavernHelper versions expose methods on different windows (or on the helper).
function lookup(host, localWin, key) {
  for (const scope of [localWin, host, localWin?.parent, localWin?.top, globalThis]) {
    try {
      for (const owner of [scope, scope?.TavernHelper]) {
        const value = owner?.[key];
        if (value != null) return typeof value === 'function' ? value.bind(owner) : value;
      }
    } catch { /* Cross-origin window. */ }
  }
}

export function bindTavernStreamEvents(host, localWin, genId, onStreamChunk) {
  const get = key => lookup(host, localWin, key);
  const on = get('eventOn'), remove = get('eventRemoveListener');
  const cleanups = [];
  const stop = () => { for (const fn of cleanups.splice(0)) { try { fn(); } catch {} } };
  if (typeof on !== 'function') return stop;
  try {
    for (const name of new Set([
      get('iframe_events')?.STREAM_TOKEN_RECEIVED_FULLY || 'js_stream_token_received_fully',
      get('tavern_events')?.STREAM_TOKEN_RECEIVED || 'stream_token_received',
    ])) {
      const handler = (text, id) => {
        if (typeof text === 'string' && text && (!id || id === genId)) onStreamChunk?.(text, false);
      };
      const sub = on(name, handler);
      cleanups.push(() => { try { if (typeof sub === 'function') sub(); else sub?.stop?.(); } finally { remove?.(name, handler); } });
    }
  } catch (error) { stop(); throw error; }
  return stop;
}

let sequence = 0;
export async function requestViaTavern(host, settings, messages, { onStreamChunk, signal } = {}) {
  signal?.throwIfAborted();
  const win = globalThis.window || globalThis;
  const generate = lookup(host, win, 'generateRaw');
  if (!generate) throw new Error('未检测到 generateRaw，请在 API 设置页选择主接口模式并确认酒馆助手已启用');
  const id = `fated-${Date.now()}-${++sequence}`;
  const stream = settings.stream ?? true;
  const cleanup = stream ? bindTavernStreamEvents(host, win, id, onStreamChunk) : null;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => {
      try { Promise.resolve(lookup(host, win, 'stopGenerationById')?.(id)).catch(() => {}); } catch { /* optional helper */ }
      reject(signal.reason || new DOMException('已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const text = await Promise.race([generate({ generation_id: id, should_stream: stream, ordered_prompts: messages }), cancelled]);
    if (typeof text !== 'string' || !text.trim()) throw new Error('酒馆模型没有返回文本，请检查当前主接口');
    onStreamChunk?.(text, true);
    return text;
  } finally { cleanup?.(); signal?.removeEventListener('abort', abort); }
}

export function diagnoseApiError(rawText, status) {
  let detail = String(rawText || '').trim();
  try { detail = JSON.parse(detail)?.error?.message || detail; } catch {}
  const hint = /mixed content/i.test(detail) ? 'HTTPS 页面不能请求 HTTP 接口，请使用 HTTPS 地址' :
    ({401: '密钥无效', 403: '无访问权限', 404: '模型或接口地址错误', 429: '请求限流或额度不足'})[status] ||
    (status >= 500 ? '上游服务故障' : 'API 请求失败');
  return `${status ? `HTTP ${status}：` : ''}${hint}${detail ? `（${detail.slice(0, 500)}）` : ''}`;
}

export async function readSseStream(readableStream, extractDelta, onStreamChunk) {
  const reader = readableStream.getReader(), decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '', content = '', reasoning = '', args = '', heartbeatCount = 0;
  function line(raw) {
    const s = raw.trim();
    if (s.startsWith(':')) {
      onStreamChunk?.('', false, { isHeartbeat: true, heartbeatCount: ++heartbeatCount, elapsedSec: Math.floor((Date.now() - start) / 1000) });
    } else if (s.startsWith('data:')) {
      const data = s.slice(5).trim();
      if (data === '[DONE]') return true;
      if (!data) return false;
      const event = JSON.parse(data);
      if (event.error) throw new Error(diagnoseApiError(event.error.message));
      const d = extractDelta(event) || {};
      const c = typeof d === 'string' ? d : d.contentDelta;
      if (c || d.reasoningDelta || d.toolArgsDelta) {
        content += c || ''; reasoning += d.reasoningDelta || ''; args += d.toolArgsDelta || '';
        onStreamChunk?.(content || args || reasoning, false);
      }
    }
    return false;
  }
  let ended = false;
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      ended = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();
      if (lines.some(line)) break;
    }
    return content || args || reasoning;
  } finally {
    if (!ended) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function connection(settings, needModel) {
  const base = settings.baseUrl?.trim().replace(/\/+$/, ''), key = settings.apiKey?.trim(), model = settings.model?.trim();
  if (!base || !key || (needModel && !model)) throw new Error(`请在 API 设置中填写${!base ? '接口地址（baseUrl）' : !key ? '密钥（apiKey）' : '模型（model）'}`);
  if (globalThis.location?.protocol === 'https:' && /^http:/i.test(base)) throw new Error(diagnoseApiError('Mixed Content'));
  const source = settings.apiSource || 'openai';
  const headers = { 'Content-Type': 'application/json' };
  let root;
  if (source === 'gemini') root = base.replace(/\/v1beta(?:\/.*)?$/i, '') + '/v1beta';
  else if (source === 'claude') {
    root = base.replace(/\/messages$/i, '').replace(/\/v1$/i, '') + '/v1';
    Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  } else if (source === 'openai') {
    root = base.replace(/\/chat\/completions$/i, '');
    headers.Authorization = `Bearer ${key}`;
  } else throw new Error(`未知 API 类型：${source}`);
  return { root, source, headers, model, key: encodeURIComponent(key) };
}

async function send(url, init, { fetchImpl = globalThis.fetch, signal }) {
  const res = await fetchImpl(url, { ...init, signal });
  if (!res.ok) throw new Error(diagnoseApiError(await res.text(), res.status));
  return res;
}
const json = res => res.json ? res.json() : res.text().then(JSON.parse);

export async function fetchModels(settings, options = {}) {
  const { root, source, key, headers } = connection(settings, false);
  const res = await send(`${root}/models${source === 'gemini' ? `?key=${key}` : ''}`, { method: 'GET', headers }, options);
  const data = await json(res);
  return (source === 'gemini' ? data.models : data.data)?.map(m => source === 'gemini' ? m.name?.replace(/^models\//, '') : m.id).filter(id => typeof id === 'string' && id) || [];
}

function deltas(source, event) {
  if (source === 'gemini') {
    const parts = event.candidates?.[0]?.content?.parts || [];
    return { contentDelta: parts.filter(p => !p.thought).map(p => p.text).join(''), reasoningDelta: parts.filter(p => p.thought).map(p => p.text).join('') };
  }
  if (source === 'claude') {
    const d = event.delta || event.content_block || {};
    return { contentDelta: d.text, reasoningDelta: d.thinking, toolArgsDelta: d.partial_json };
  }
  const choice = event.choices?.[0];
  const d = choice?.delta || choice?.message || {};
  return { contentDelta: d.content, reasoningDelta: d.reasoning_content, toolArgsDelta: d.tool_calls?.map(t => t.function?.arguments).join('') || d.function_call?.arguments };
}

export async function requestViaCustomApi(settings, messages, options = {}) {
  const { root, source, model, key, headers } = connection(settings, true);
  const stream = settings.stream ?? true, temperature = Number(settings.temperature ?? 0.2), max_tokens = Number(settings.max_tokens || 2400);
  // Strict native APIs reject UI-only provenance keys on individual messages.
  const wireMessages = messages.map(({ role, content }) => ({ role, content }));
  let url, body;
  if (source === 'openai') {
    url = `${root}/chat/completions`;
    body = { model, messages: wireMessages, temperature, max_tokens, stream };
  } else {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const chat = wireMessages.filter(m => m.role !== 'system');
    if (source === 'claude') {
      url = `${root}/messages`;
      body = { model, system, messages: chat, temperature, max_tokens, stream };
    } else {
      url = `${root}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${key}`;
      body = {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: chat.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature, maxOutputTokens: max_tokens },
        safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT', 'CIVIC_INTEGRITY'].map(name => ({ category: `HARM_CATEGORY_${name}`, threshold: 'BLOCK_NONE' })),
      };
    }
  }
  const res = await send(url, { method: 'POST', headers, body: JSON.stringify(body) }, options);
  let text;
  if (stream && res.body?.getReader && !/application\/json/i.test(res.headers?.get?.('content-type') || '')) {
    text = await readSseStream(res.body, event => deltas(source, event), options.onStreamChunk);
  } else {
    const data = await json(res);
    if (data.error) throw new Error(diagnoseApiError(data.error.message));
    const d = deltas(source, data);
    text = source === 'claude' ? (data.content || []).map(p => p.text).join('') : d.contentDelta || d.toolArgsDelta || d.reasoningDelta || '';
  }
  if (typeof text !== 'string' || !text.trim()) throw new Error('独立 API 未返回有效文本，请检查模型和协议类型');
  options.onStreamChunk?.(text, true);
  return text;
}
