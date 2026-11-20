import { collectMvu } from './converter.js';

// Strip combat cursor/placement at the character boundary only: a skill's AP cost is source data.
const transient = new Set(['x','y','z','xyz','position','pos','coordinates','facing','ap','used','round','turn','initiativeRoll','reactionAvailable','位置','坐标','行动点','回合','朝向']);
const clean = record => Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !transient.has(key) && !key.startsWith('__source')));
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const aliases = r => [r?.id,r?.uid,r?.characterId,r?.instanceId,r?.ID,r?.name,r?.displayName,r?.characterName,r?.名称,r?.姓名,r?.角色名,r?.__sourceKey].filter(Boolean);
export async function characterRecords(sources, hydrated) {
  const mvu = collectMvu(sources.mvuData), battle = sources.battleInit;
  const participants = battle.units ?? battle.participants ?? [];
  const rows = await Promise.all((hydrated?.roster ?? []).map(async (unit, i) => {
    const mapping = hydrated.sourceMap?.[unit.id] ?? {};
    const p = participants.find?.(p => p.id === unit.id) ?? participants[unit.id] ?? participants[i];
    const names = new Set([unit.id, unit.name, p?.name, mapping.sourceId, mapping.sourceName].filter(Boolean));
    const matches = r => aliases(r).some(x => names.has(x));
    const samePath = mvu.find(r => mapping.path && JSON.stringify(r.__sourcePath) === JSON.stringify(mapping.path));
    const mv = samePath ?? mvu.find(matches);
    if (mv) aliases(mv).forEach(name => names.add(name));
    const char = sources.charInfo?.find(matches);
    const sourceKind = unit.source === 'MVU' || mv && !char ? 'mvu' : char ? 'char_info' : 'battle_init';
    const defs = (table, ids) => Object.fromEntries(ids.filter(id => typeof id === 'string' && Object.hasOwn(table ?? {}, id)).map(id => [id,table[id]]));
    const raw = { ...(mv && {mvu:clean(mv)}), ...(char && {char_info:clean(char)}), battle_init: clean(p),
      equipment: defs(battle.equipment,[p?.mainHand,p?.offHand,p?.shield,...(Array.isArray(p?.gear)?p.gear:[])]), skills: defs(battle.skills,Array.isArray(p?.skills)?p.skills:[]) };
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered(raw))));
    return [unit.id,{raw,sourceKind,hash:Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('')}];
  }));
  return Object.fromEntries(rows);
}
