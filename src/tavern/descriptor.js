const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const unsafeKey = key => Object.hasOwn(Object.prototype, key) || key === 'prototype';

/** Parse a versioned, pipe-delimited battle body. Return null for legacy input. */
export function parseBattleDescriptor(value) {
  if (typeof value !== 'string') return null;
  const lines = value.trim().replace(/^```[^\r\n]*\r?\n/, '').replace(/\r?\n```$/, '')
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!/^\s*(battle|unit)\s*\|/i.test(lines[0] ?? '')) return null;
  const fail = message => { throw new Error(`battle_init 描述符：${message}`); };
  const [kind, version, battleId, sceneTitle, terrainMode, seedText, ...extra] = lines[0].split('|').map(x => x.trim());
  if (kind !== 'battle' || version !== '1' || extra.length || !identifier.test(battleId ?? '') || unsafeKey(battleId)
    || !sceneTitle || sceneTitle.length > 100 || !['flat', 'terrain'].includes(terrainMode)) {
    fail('首行应为 battle|1|ID|场景标题|flat 或 terrain，可追加 |seed');
  }
  if (seedText !== undefined && (!/^\d+$/.test(seedText) || Number(seedText) > 0xffffffff)) fail('seed 必须是 0–4294967295 的整数');
  const ids = new Set();
  const occupied = new Set();
  const units = lines.slice(1).map((line, i) => {
    const [row, id, team, source, name, point, ...tail] = line.split('|').map(x => x.trim());
    if (row !== 'unit' || tail.length || !identifier.test(id ?? '') || unsafeKey(id) || ids.has(id.toLowerCase())
      || !['blue', 'red'].includes(team) || !name || name.length > 100 || !/^\d\s*,\s*\d$/.test(point ?? '')) {
      fail(`第 ${i + 2} 条记录需要唯一 ID、阵营、来源、显示名及 0–9 范围内的 x,y`);
    }
    const path = source?.startsWith('mvu:') ? source.slice(4).split('/') : [];
    if (source !== 'char_info' && (!path.length || path.some(key => !key || key !== key.trim() || unsafeKey(key)))) {
      fail(`第 ${i + 2} 条记录的来源应为 char_info 或 mvu:精确/路径`);
    }
    const [x, y] = point.split(',').map(Number);
    if (occupied.has(`${x},${y}`)) fail(`第 ${i + 2} 条记录的起点重复`);
    occupied.add(`${x},${y}`);
    ids.add(id.toLowerCase());
    return { id, team, source, name, x, y };
  });
  if (!units.length) fail('至少需要一条 unit 记录');
  return { version: 1, battleId, sceneTitle, terrainMode, ...(seedText === undefined ? {} : { seed: Number(seedText) }), units };
}
