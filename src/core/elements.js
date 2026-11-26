const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

const definitions = [
  ['physical', '物理', 'physical', ['物理', '劈砍', '穿刺', '钝击', '斩击', '打击', '物伤', 'physical', 'slashing', 'piercing', 'bludgeoning']],
  ['energy', '能量', 'energy', ['能量', '魔法', '法术', '魔力伤害', 'energy', 'magic', 'spell']],
  ['mental', '精神', 'mental', ['精神', '灵魂伤害', '神识', 'mental']],
  ['true', '真实', 'true', ['真实', '纯粹', '真伤', '绝对', 'true', 'pure']],
  ['fire', '火焰', 'energy', ['火', '火焰', '火属性', '烈焰', '灼热', '炎', '业火', 'fire', 'flame', 'pyro']],
  ['cold', '冰霜', 'energy', ['冰', '寒', '冰霜', '寒冷', '寒冰', '冰属性', '冰冻', '凛冬', 'cold', 'ice', 'frost', 'cryo']],
  ['lightning', '雷电', 'energy', ['雷', '电', '雷电', '闪电', '雷属性', '电属性', '雷霆', '电击', 'lightning', 'electric', 'thunderbolt', 'shock']],
  ['thunder', '雷鸣', 'energy', ['雷鸣', '音波', '声波', '震荡', '轰鸣', '音属性', 'thunder', 'sonic']],
  ['acid', '酸蚀', 'energy', ['酸', '酸蚀', '强酸', '腐蚀', '酸属性', '酸液', 'acid', 'corrosive']],
  ['poison', '毒素', 'energy', ['毒', '毒素', '剧毒', '毒属性', '毒液', '瘴气', 'poison', 'toxic', 'venom']],
  ['necrotic', '暗蚀', 'energy', ['暗', '暗蚀', '死灵', '暗影', '凋零', '负能量', '暗属性', '腐蚀死气', 'necrotic', 'dark', 'shadow', 'unholy']],
  ['radiant', '光耀', 'energy', ['光', '光耀', '神圣', '圣光', '阳炎', '光属性', '圣属性', '辉光', 'radiant', 'holy', 'light', 'sacred']],
  ['force', '力场', 'energy', ['力场', '奥术', '纯魔力', '奥能', '力场属性', 'force', 'arcane']],
  ['psychic', '心灵', 'mental', ['心灵', '心智', '念力', '念能', '幻象', '心灵属性', 'psychic']],
];

export const BUILTIN_DAMAGE_TYPES = Object.freeze(definitions.map(([id]) => id));
export const ELEMENT_DEFINITIONS = Object.freeze(Object.fromEntries(definitions.map(([id, name, category, aliases]) => [id,
  Object.freeze({ id, name, category, aliases: Object.freeze(aliases) })])));
const aliases = new Map(definitions.flatMap(([id, , , names]) => names.map(name => [name.toLocaleLowerCase(), id])));

export function resolveElementAlias(value) {
  return typeof value === 'string' ? aliases.get(value.trim().toLocaleLowerCase()) ?? null : null;
}
export function elementMitigationCategory(type, customElements = {}) {
  if (ELEMENT_DEFINITIONS[type]) return ELEMENT_DEFINITIONS[type].category;
  const category = customElements?.[type]?.category;
  return ['physical', 'energy', 'mental', 'true'].includes(category) ? category : 'energy';
}
export function typedArmorForElement(type, armor, customElements) {
  const category = elementMitigationCategory(type, customElements);
  return category === 'physical' ? armor : category === 'energy' ? armor / 2 : 0;
}
export function attributeReductionForElement(type, stats = {}, customElements) {
  const category = elementMitigationCategory(type, customElements);
  if (category === 'physical') return (stats.con + stats.str + stats.agi) * .0025;
  if (category === 'energy') return (stats.spi + stats.int) * .004;
  return category === 'mental' ? stats.spi * .008 : 0;
}
export function elementLabel(type, customElements = {}) {
  return ELEMENT_DEFINITIONS[type]?.name ?? customElements?.[type]?.name ?? type;
}
export function validateCustomElements(value) {
  if (value === undefined) return;
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length > 64) {
    throw new Error('自定义元素表无效');
  }
  for (const [key, entry] of Object.entries(value)) {
    if (reserved.has(key) || !/^[a-z][a-z0-9_-]{0,31}$/.test(key) || BUILTIN_DAMAGE_TYPES.includes(key)) throw new Error(`自定义元素 ID 无效：${key}`);
    if (!entry || Object.getPrototypeOf(entry) !== Object.prototype || entry.id !== key || typeof entry.name !== 'string' || entry.name.length < 1 || entry.name.length > 24) throw new Error(`自定义元素定义无效：${key}`);
    if (entry.aliases !== undefined && (!Array.isArray(entry.aliases) || entry.aliases.length > 8 || entry.aliases.some(alias => typeof alias !== 'string' || alias.length < 1 || alias.length > 24))) throw new Error(`自定义元素别名无效：${key}`);
    if (entry.category !== undefined && !['energy', 'physical', 'mental'].includes(entry.category)) throw new Error(`自定义元素归类无效：${key}`);
  }
}
