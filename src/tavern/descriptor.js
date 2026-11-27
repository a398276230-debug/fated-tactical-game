import { moraleTypeFor } from '../core/combat_protocol.js';
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const unsafeKey = key => Object.hasOwn(Object.prototype, key) || key === 'prototype';
const fail = message => { throw new Error(`battle_init 描述符：${message}`); };
const groundHeight = /^-?\d+$/;
const airborneHeight = /^(?:飞行|悬浮)\s*=\s*(-?\d+)$/u;
const xy = /^\d{1,2}$/;
const fieldTeams = new Map([
  ['全体', null], ['全部', null], ['all', null], ['any', null],
  ['蓝', 'blue'], ['蓝方', 'blue'], ['blue', 'blue'],
  ['红', 'red'], ['红方', 'red'], ['red', 'red'],
]);
const effectPrefix = /^(?:效果|effect)$/iu;

function parseHeader(line) {
  const [kind, version, battleId, sceneTitle, terrainMode, ...options] = line.split('|').map(x => x.trim());
  if (kind !== 'battle') fail(`首行前缀必须为 battle|（当前为「${kind}」）`);
  if (version !== '1') fail(`首行版本号必须为 1（当前为「${version ?? ''}」，应为 battle|1|ID|场景标题|flat或terrain）`);
  if (!identifier.test(battleId ?? '') || unsafeKey(battleId)) fail(`首行战场 ID「${battleId ?? ''}」格式无效（须以字母或数字开头，仅含 ASCII 字母、数字、_、-，长度 ≤64）`);
  if (!sceneTitle || sceneTitle.length > 100) fail('首行场景标题不能为空且长度不超过 100 字');
  if (!['flat', 'terrain'].includes(terrainMode)) fail(`首行地形模式「${terrainMode ?? ''}」无效，必须为 flat 或 terrain`);

  const sizeToken = options.find(value => /^棋盘\s*=/.test(value));
  const scaleToken = options.find(value => /^比例尺\s*=/.test(value));
  const tierTokens = options.filter(value => /^(?:战场层级|尺度层级)\s*=/.test(value));
  if (tierTokens.length > 1) fail('战场层级只能声明一次（不可同时重复战场层级或尺度层级）');
  const tierToken = tierTokens[0];
  const tierMatch = tierToken?.match(/^(?:战场层级|尺度层级)\s*=\s*(?:第\s*)?([1-7])(?:\s*(?:层级?|阶级?|级))?$/u);
  if (tierToken && !tierMatch) fail('战场层级必须是 1 至 7 的整数（可写作第 N 层级或 N 阶）');
  const sizeMatch = sizeToken?.match(/^棋盘\s*=\s*(\d+)\s*[xX×*]\s*(\d+)$/u);
  if (sizeToken && (!sizeMatch || Number(sizeMatch[1]) < 8 || Number(sizeMatch[1]) > 20 || Number(sizeMatch[2]) < 8 || Number(sizeMatch[2]) > 20)) fail('棋盘尺寸必须在 8x8 至 20x20 之间');
  const width = sizeMatch ? Number(sizeMatch[1]) : 10, height = sizeMatch ? Number(sizeMatch[2]) : 10;
  const scaleMatch = scaleToken?.match(/^比例尺\s*=\s*(\d+(?:\.\d+)?)\s*(km|千米|公里|m|米)?$/iu);
  const cellM = scaleMatch ? Number(scaleMatch[1]) * (/^(km|千米|公里)$/iu.test(scaleMatch[2] ?? '') ? 1000 : 1) : null;
  if (scaleToken && (!scaleMatch || !Number.isFinite(cellM) || cellM < 1 || cellM > 10000)) fail('比例尺必须是 1m 至 10000m 的正数');
  const sideValue = options.find(value => /^压制方=/.test(value));
  const sideToken = sideValue?.match(/^压制方=(blue|red)$/u);
  const typeValue = options.find(value => /^战斗类型=/.test(value));
  const moraleType = typeValue && moraleTypeFor(typeValue.slice('战斗类型='.length));
  if (typeValue && !moraleType) fail('未知战斗类型，可选：标准、切磋、竞技、压制、死斗、守卫');
  if ((sideValue && !sideToken) || (moraleType === 'suppress') !== !!sideToken) fail('压制战必须在战斗类型后声明 |压制方=blue 或 |压制方=red；其他类型不填压制方');
  const physicsTokens = options.filter(value => /^元素交互\s*=|^法则\s*=\s*无元素涌现$/u.test(value));
  if (physicsTokens.length > 1) fail('元素交互只能声明一次');
  const physicsToken = physicsTokens[0];
  if (physicsToken && !/^(?:元素交互\s*=\s*[开关]|法则\s*=\s*无元素涌现)$/u.test(physicsToken)) fail('元素交互必须是 开 或 关');
  const physicsOff = /^(?:元素交互\s*=\s*关|法则\s*=\s*无元素涌现)$/u.test(physicsToken ?? '');
  const remainingOptions = options.slice();
  for (const token of [sizeToken, scaleToken, tierToken, sideValue, typeValue, physicsToken]) {
    if (token !== undefined) remainingOptions.splice(remainingOptions.indexOf(token), 1);
  }
  const [seedText, ...extra] = remainingOptions;
  if (extra.length) fail(`首行包含无法识别的选项「${extra.join('|')}」`);
  if (seedText !== undefined && (!/^\d+$/.test(seedText) || Number(seedText) > 0xffffffff)) fail('seed 必须是 0–4294967295 的整数');
  const scaleExplicit = cellM != null || tierMatch != null;
  return { version: 1, battleId, sceneTitle, terrainMode, width, height,
    ...(cellM != null && { cellM }), ...(tierMatch && { scaleTier: Number(tierMatch[1]) }),
    ...(scaleExplicit && { explicitScale: true }), ...(physicsOff && { elementalPhysics: 'off' }),
    ...(moraleType && { moraleType }), ...(sideToken && { suppressingTeam: sideToken[1] }),
    ...(seedText === undefined ? {} : { seed: Number(seedText) }) };
}

function parsePoint(point, row, { width, height }, unit = false) {
  const coords = (point ?? '').split(',').map(x => x.trim());
  const [rawX, rawY, third, fourth] = coords;
  if ((unit ? coords.length < 2 || coords.length > 4 : coords.length !== 3 || !groundHeight.test(third))
    || !xy.test(rawX) || !xy.test(rawY ?? '')) {
    const syntax = unit ? '支持 x,y、x,y,z、x,y,飞行=N 或 x,y,z,飞行=N' : '应为 x,y,z';
    fail(`${row}的坐标「${point ?? ''}」格式无效，${syntax}`);
  }
  const [x, y] = [Number(rawX), Number(rawY)];
  if (x >= width || y >= height) fail(`${row}坐标超出棋盘范围（${x},${y} 超出 ${width}x${height}）`);
  const badSegment = seg => fail(`${row}的坐标段「${seg}」无效，第 3 段应为整数 z 或 飞行=N/悬浮=N，第 4 段应为 飞行=N/悬浮=N`);
  const result = { x, y };
  let altitudeMatch;
  if (third !== undefined) {
    if (groundHeight.test(third)) result.z = Number(third);
    else if (fourth !== undefined || !(altitudeMatch = third.match(airborneHeight))) badSegment(third);
  }
  if (fourth !== undefined && !(altitudeMatch = fourth.match(airborneHeight))) badSegment(fourth);
  if (result.z < -4 || result.z > 8) fail(`${row}的地形高度 z=${result.z} 超出范围（允许 -4 至 8）`);
  if (altitudeMatch) {
    const altitude = Number(altitudeMatch[1]);
    if (altitude < 0 || altitude > 12) fail(`${row}的离地高度 ${altitude} 超出范围（允许 0 至 12）`);
    result.altitude = altitude;
  }
  return result;
}

function parseEffectArea(token, row, { width, height }) {
  const board = token.match(/^(?:全场|全图|board)(?:\s*\(\s*(-?\d+)\s*-\s*(-?\d+)\s*\))?$/iu);
  const box = board ? null : token.match(/^\(\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\)\s*\(\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\)(?:\s*\(\s*(-?\d+)\s*-\s*(-?\d+)\s*\))?$/u);
  if (!board && !box) fail(`${row}的范围「${token}」格式无效，应为 全场、全场(z1-z2)、(x1-x2)(y1-y2)(z1-z2) 或 (x1-x2)(y1-y2)`);
  const area = { shape: board ? 'board' : 'rect' };
  if (box) {
    const [x1, x2, y1, y2] = box.slice(1, 5).map(Number);
    if (x1 > x2 || y1 > y2 || x2 >= width || y2 >= height) fail(`${row}坐标超出棋盘范围或区间起止颠倒（${token}，当前棋盘 ${width}x${height}）`);
    area.rect = { x1, y1, x2, y2 };
  }
  const [low, high] = board ? board.slice(1) : box.slice(5);
  if (low !== undefined) {
    const z1 = Number(low), z2 = Number(high);
    if (!(z1 >= -4 && z1 <= z2 && z2 <= 20)) fail(`${row}的高度区间 (${z1}-${z2}) 无效（须满足 -4 <= z1 <= z2 <= 20）`);
    Object.assign(area, { z1, z2 });
  }
  return area;
}

function parseEffect(parts, row, battle) {
  const [, id, teamToken, first, second] = parts;
  const targetTeam = fieldTeams.get(teamToken.toLowerCase());
  if (targetTeam === undefined) fail(`${row}的目标阵营「${teamToken}」无效，必须为 全体、蓝 或 红`);
  const separate = parts.length === 6 && !effectPrefix.test(first);
  const rawText = separate ? `${first}：${second}` : parts.length === 6 ? second : first;
  let name = rawText, description = rawText;
  if (separate) [name, description] = [first, second];
  else {
    const colon = rawText.search(/[:：]/u);
    const prefix = colon > 0 ? rawText.slice(0, colon).trim() : '';
    if (prefix) [name, description] = [prefix, rawText.slice(colon + 1).trim() || prefix];
  }
  if (!name || name.length > 100) fail(`${row}的名称不能为空且不超过 100 字（可用「名字：详细效果」分隔长描述）`);
  if (!description || description.length > 500 || (!separate && rawText.length > 500)) fail(`${row}的效果描述不能为空且不超过 500 字（合并写法总长 ≤500 字）`);
  return { id, targetTeam, name, description, rawText, area: parseEffectArea(parts.at(-1), row, battle) };
}

function checkSource(source, row, allowMvu = false) {
  const path = source.startsWith('mvu:') ? source.slice(4).split('/') : [];
  if (source === 'char_info' || (allowMvu && source === 'mvu')) return;
  if (!path.length || path.some(key => !key || key !== key.trim() || unsafeKey(key) || key === '.' || key === '..')) {
    fail(`${row}的来源「${source}」无效，应为 char_info 或 mvu:精确/路径`);
  }
}

const summonModes = { 随动: 'linked_group', 集群: 'linked_group', 独立: 'independent', 各自随动: 'linked_each', 瞬发: 'none' };
const summonPolicies = { 顶替: 'replace', 队列: 'fifo', 封顶: 'cap' };
function parseSummon(parts, row, battle) {
  const [, id, ownerId, source, name, ...options] = parts;
  if (!identifier.test(ownerId) || unsafeKey(ownerId)) fail(`${row}的归属单位 ID 无效`);
  checkSource(source, row, true);
  if (!name || name.length > 100) fail(`${row}的显示名不能为空且不超过 100 字`);
  const summon = { id, ownerId, source, name, group: id };
  const seen = new Set();
  for (const option of options) {
    const [, key, value] = option.match(/^([^=]+?)\s*=\s*(.+)$/u) ?? [];
    if (!key || seen.has(key)) fail(`${row}含无效或重复选项「${option}」`);
    seen.add(key);
    if (key === '分组' && identifier.test(value) && !unsafeKey(value)) summon.group = value;
    else if (key === '模式' && Object.values(summonModes).includes(summonModes[value] ?? value)) summon.turnMode = summonModes[value] ?? value;
    else if (key === '策略' && Object.values(summonPolicies).includes(summonPolicies[value] ?? value)) summon.stackPolicy = summonPolicies[value] ?? value;
    else if (key === '上限' && /^(?:[1-9]|1\d|20)$/.test(value)) summon.maxActive = Number(value);
    else if (key === '类型' && value.length <= 100) summon.archetypeHint = value;
    else if (key === '开场') summon.opening = value === '随主' ? 'owner' : parsePoint(value, row, battle, true);
    else fail(`${row}含无效选项「${option}」`);
  }
  return summon;
}

/** Parse a versioned, pipe-delimited battle body. Return null for legacy input. */
export function parseBattleDescriptor(value) {
  if (typeof value !== 'string') return null;
  const lines = value.trim().replace(/^```[^\r\n]*\r?\n/, '').replace(/\r?\n```$/, '')
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!/^(?:battle|unit|summon|cover|interact|效果|effect)\s*\|/iu.test(lines[0] ?? '')) return null;
  const battle = parseHeader(lines[0]);
  const ids = new Set(), occupied = new Set(), unitCounts = new Map();
  const units = [], covers = [], interactives = [], effects = [], summons = [];
  const claimId = (id, row) => {
    if (!identifier.test(id ?? '') || unsafeKey(id)) fail(`${row}的 ID「${id ?? ''}」格式无效（须以字母或数字开头，仅含 ASCII 字母、数字、_、-，长度 ≤64）`);
    const key = id.toLowerCase();
    if (ids.has(key)) fail(`${row}需要唯一 ID（「${id}」与前序记录重复）`);
    ids.add(key);
  };
  const claimPosition = ({ x, y }, row, unit = false) => {
    const key = `${x},${y}`;
    if (!unit && occupied.has(key)) fail(`${row}的位置重复`);
    if (unit) {
      const count = unitCounts.get(key) ?? 0;
      if (count >= 4) fail(`${row}的同格单位超过容量 4`);
      unitCounts.set(key, count + 1);
    }
    occupied.add(key);
  };
  for (const [i, line] of lines.slice(1).entries()) {
    const parts = line.split('|').map(x => x.trim());
    const [kind, id] = parts, rowNo = i + 2;
    const row = `第 ${rowNo} 条 ${kind} 记录`;
    if (effectPrefix.test(kind)) {
      const label = `第 ${rowNo} 条 效果 记录`;
      if (![5, 6].includes(parts.length)) fail(`${label}需要 5 段字段（效果|ID|全体/蓝/红|名称与效果描述|范围，当前为 ${parts.length} 段）`);
      if (effects.length === 16) fail('最多 16 条 效果 记录');
      claimId(id, label);
      effects.push(parseEffect(parts, label, battle));
    } else if (kind === 'unit') {
      if (parts.length !== 6) fail(`${row}需要 6 段字段（unit|ID|阵营|来源|显示名|坐标，当前为 ${parts.length} 段）`);
      claimId(id, row);
      const [, , team, source, name, point] = parts;
      if (!['blue', 'red'].includes(team)) fail(`${row}的阵营「${team}」无效，必须为 blue 或 red`);
      checkSource(source, row);
      if (!name || name.length > 100) fail(`${row}的显示名不能为空且不超过 100 字`);
      const position = parsePoint(point, row, battle, true);
      claimPosition(position, row, true);
      units.push({ id, team, source, name, ...position });
    } else if (kind === 'summon') {
      if (parts.length < 5) fail(`${row}需要 summon|ID|归属单位ID|来源|显示名`);
      if (summons.length >= 24) fail('最多 24 条 summon 记录');
      claimId(id, row);
      summons.push(parseSummon(parts, row, battle));
    } else if (kind === 'cover') {
      if (parts.length !== 5) fail(`${row}需要 5 段字段（cover|ID|半或全|名称|坐标，当前为 ${parts.length} 段）`);
      claimId(id, row);
      const [, , material, name, point] = parts;
      if (!['半', '全'].includes(material)) fail(`${row}的掩体类型「${material}」无效，必须为 半 或 全`);
      if (!name) fail(`${row}的掩体名称不能为空`);
      const position = parsePoint(point, row, battle);
      claimPosition(position, row);
      covers.push({ id, name, ...position, cover: material === '全' ? 5 : 2, material });
    } else if (kind === 'interact') {
      if (parts.length !== 8) fail(`${row}需要 8 段字段（interact|ID|类型|效果|半径|数值|名称|坐标，当前为 ${parts.length} 段）`);
      claimId(id, row);
      const [, , type, effect, radiusText, damageText, name, point] = parts;
      const radius = Number(radiusText), damage = Number(damageText);
      if (!['altar', 'barrel'].includes(type)) fail(`${row}的互动类型「${type}」无效，必须为 altar 或 barrel`);
      if (!['explode', 'heal', 'shield', 'restore'].includes(effect)) fail(`${row}的互动效果「${effect}」无效，必须为 explode、heal、shield 或 restore`);
      if (!radiusText || !Number.isInteger(radius) || radius < 0 || radius > 10) fail(`${row}的半径必须是 0–10 的整数`);
      if (!damageText || !Number.isInteger(damage) || damage < 0 || damage > 100000) fail(`${row}的数值必须是 0–100000 的整数`);
      if (!name) fail(`${row}的互动名称不能为空`);
      const position = parsePoint(point, row, battle);
      claimPosition(position, row);
      if (interactives.length === 2) fail('最多两条 interact 记录');
      interactives.push({ id, name, ...position, kind: type, effect, radius, damage });
    } else fail(`第 ${rowNo} 条记录未知行类型「${kind}」，允许前缀：unit、summon、cover、interact、效果`);
  }
  if (!units.length) fail('至少需要一条 unit 记录');
  for (const summon of summons) {
    if (!units.some(unit => unit.id === summon.ownerId)) fail(`召唤物「${summon.id}」的归属单位「${summon.ownerId}」不存在`);
  }
  return { ...battle, units, ...(summons.length && { summons }), ...(covers.length && { covers }), ...(interactives.length && { interactives }), ...(effects.length && { effects }) };
}
