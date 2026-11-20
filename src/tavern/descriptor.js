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
  const units = [], covers = [], interactives = [];
  const claim = (id, x, y, i) => {
    if (!identifier.test(id ?? '') || unsafeKey(id) || ids.has(id.toLowerCase())) fail(`第 ${i + 2} 条记录需要唯一 ID`);
    if (occupied.has(`${x},${y}`)) fail(`第 ${i + 2} 条记录的位置重复`);
    occupied.add(`${x},${y}`);
    ids.add(id.toLowerCase());
  };
  for (const [i, line] of lines.slice(1).entries()) {
    const parts = line.split('|').map(x => x.trim());
    if (parts[0] === 'cover' || parts[0] === 'interact') {
      if (parts[0] === 'cover') {
        const [row,id,kind,name,point] = parts;
        if (parts.length !== 5 || !name || !['半','全'].includes(kind) || !/^\d\s*,\s*\d\s*,\s*-?\d+$/.test(point ?? '')) fail(`第 ${i + 2} 条记录的掩体格式无效`);
        const [x,y,z] = point.split(',').map(Number); claim(id,x,y,i);
        covers.push({id,name,x,y,z,cover:kind === '全' ? 5 : 2,material: kind});
        continue;
      }
      const [row,id,kind,effect,radiusText,damageText,name,point] = parts;
      const radius = Number(radiusText), damage = Number(damageText);
      if (parts.length !== 8 || !name || !['altar','barrel'].includes(kind) || !['explode','heal','shield','restore'].includes(effect)
        || !Number.isInteger(radius) || radius < 0 || radius > 10 || !Number.isInteger(damage) || damage < 0 || damage > 100000 || !/^\d\s*,\s*\d\s*,\s*-?\d+$/.test(point ?? '')) fail(`第 ${i + 2} 条记录的互动格式无效`);
      const [x,y,z] = point.split(',').map(Number); claim(id,x,y,i);
      if (interactives.length === 2) fail('最多两条 interact 记录');
      interactives.push({id,name,x,y,z,kind,effect,radius,damage});
      continue;
    }
    const [row, id, team, source, name, point, ...tail] = line.split('|').map(x => x.trim());
    const coordinates = point?.split(',').map(x => x.trim()) ?? [];
    const altitudeToken = coordinates[2];
    const altitudeMatch = altitudeToken?.match(/^(?:飞行|悬浮)=(-?\d+)$/);
    const validPoint = /^\d\s*,\s*\d(?:\s*,\s*(?:-?\d+|(?:飞行|悬浮)=-?\d+))?$/.test(point ?? '');
    if (row !== 'unit' || tail.length || !identifier.test(id ?? '') || unsafeKey(id) || ids.has(id.toLowerCase())
      || !['blue', 'red'].includes(team) || !name || name.length > 100 || !validPoint) {
      fail(`第 ${i + 2} 条记录需要唯一 ID、阵营、来源、显示名及 0–9 范围内的 x,y`);
    }
    const path = source?.startsWith('mvu:') ? source.slice(4).split('/') : [];
    if (source !== 'char_info' && (!path.length || path.some(key => !key || key !== key.trim() || unsafeKey(key)))) {
      fail(`第 ${i + 2} 条记录的来源应为 char_info 或 mvu:精确/路径`);
    }
    const x = Number(coordinates[0]), y = Number(coordinates[1]);
    const z = altitudeMatch ? 0 : coordinates[2] === undefined ? 0 : Number(coordinates[2]);
    const altitude = altitudeMatch ? Number(altitudeMatch[1]) : 0;
    if (z < -4 || z > 8 || altitude < 0 || altitude > 12) fail(`第 ${i + 2} 条记录的高度必须在 z -4 至 8、离地 0 至 12 范围内`);
    claim(id,x,y,i);
    units.push({ id, team, source, name, x, y,
      ...(altitudeMatch ? { altitude } : coordinates[2] !== undefined ? { z } : {}) });
  }
  if (!units.length) fail('至少需要一条 unit 记录');
  return { version: 1, battleId, sceneTitle, terrainMode, ...(seedText === undefined ? {} : { seed: Number(seedText) }), units, ...(covers.length && {covers}), ...(interactives.length && {interactives}) };
}
