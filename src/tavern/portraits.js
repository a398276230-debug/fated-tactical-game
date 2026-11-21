import { hostMethod, hostScopes } from './host.js';

function readStatusAvatars(dbFactory, scope) {
  if (!dbFactory) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const open = dbFactory.open('status-avatar-db');
    // An absent status bar database must not be created by the sandbox.
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const request = db.transaction('avatars').objectStore('avatars').index('scope_key').getAll(scope);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch { resolve([]); }
      finally { db.close(); }
    };
  });
}

function imageUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.includes('{{')) return '';
  const text = value.trim();
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(text)) return text;
  try {
    const url = new URL(text, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /\.svgz?$/i.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

async function predefinedAvatars(host, readVariables) {
  const variables = await readVariables?.({ type: 'character' });
  const version = String(variables?.资源版本?.命定之诗 ?? '').trim().replace(/^v/i, '');
  for (const candidate of new Set([version, '1.2.5'])) {
    if (!/^\d+\.\d+\.\d+$/.test(candidate)) continue;
    try {
      const response = await host.fetch(`https://cdn.poem-of-destiny.com/assets/${candidate}/frontend/assets/data/predefined-avatars.json`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) continue;
      // The published JSON5 is a flat map with quoted names and URLs.
      const text = await response.text();
      const fields = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        token => token.startsWith('/') ? '' : token);
      return JSON.parse(fields.replace(/,\s*}/g, '}'));
    } catch { /* try the status bar's bundled default version */ }
  }
  return {};
}

export async function readBattlePortraits(host, units, sourceMap, isCurrent = () => true) {
  const readVariables = hostMethod(host, 'getVariables');
  const getCharacterName = hostMethod(host, 'getCurrentCharacterName');
  const entries = Object.values(units).map(unit => {
    const source = sourceMap[unit.id];
    const name = source?.path?.[0] === '关系列表' ? source.path[1] : source?.sourceName || unit.name;
    return [unit.id, source?.isProtagonist ? 'player' : 'partner', source?.isProtagonist ? '主角' : name];
  });
  const attempt = async fn => { try { return await fn(); } catch { return undefined; } };
  const [records, persona, chat] = await Promise.all([
    attempt(async () => readStatusAvatars(host.indexedDB, `status:${await getCharacterName?.() || 'unknown-character'}`)),
    attempt(async () => {
      if (!entries.some(([, type]) => type === 'player')) return '';
      for (const scope of hostScopes(host)) {
        const tavern = scope.SillyTavern;
        const macros = tavern?.substituteParams ? tavern : tavern?.getContext?.();
        const value = await macros?.substituteParams?.('{{userAvatarPath}}');
        if (value && value !== '{{userAvatarPath}}') return value;
      }
      return hostMethod(host, 'substituteParams')?.('{{userAvatarPath}}');
    }),
    attempt(() => readVariables?.({ type: 'chat' })),
  ]);
  const base = host.location?.href;
  const overrides = new Map((records ?? []).map(row => [`${row.owner_type}::${row.owner_name}`, row]));
  const portraits = {};
  const missing = [];
  for (const [id, type, name] of entries) {
    const record = overrides.get(`${type}::${name}`);
    if (record?.source_type === 'removed') continue;
    const fallback = type === 'player' ? persona : Object.hasOwn(chat?.status?.externalAvatars?.partners ?? {}, name)
      ? chat.status.externalAvatars.partners[name]?.url : '';
    const candidates = [...new Set([imageUrl(record?.value, base), imageUrl(fallback, base)].filter(Boolean))];
    if (candidates.length) portraits[id] = candidates;
    else if (type === 'partner' && sourceMap[id]?.path?.[0] === '关系列表') missing.push([id, name]);
  }
  if (missing.length && isCurrent()) {
    const defaults = await attempt(() => predefinedAvatars(host, readVariables)) ?? {};
    for (const [id, name] of missing) {
      const url = imageUrl(Object.hasOwn(defaults, name) ? defaults[name] : '', base);
      if (url) portraits[id] = [url];
    }
  }
  return portraits;
}
