export const damageTypes = Object.freeze(['physical', 'energy', 'mental', 'true']);

// 数值区间供战斗、快照校验与状态目录共用。
const ranges = {
  damage: [1, 100000], heal: [1, 100000], amount: [1, 100000], reflect: [1, 100000],
  armor: [1, 100000], movement: [-3, 3], accuracy: [-10, 10], incomingAccuracy: [-10, 10],
  advantage: [1, 3], disadvantage: [1, 3], intentDifficulty: [-10, 10],
  reduction: [0, 1], vulnerability: [0, 1], shatter: [0, 1], damageBonus: [0, 1],
};
Object.assign(ranges, { dodgeBonus: [-30, 30], attackPercent: [-1, 4], attributePercent: [-1, 4], finalDamageMultiplier: [0, 8] });
const ratios = ['reduction', 'vulnerability', 'shatter', 'damageBonus', 'attackPercent', 'attributePercent', 'finalDamageMultiplier'];
const flags = ['taunted', 'intercept', 'skip', 'rooted', 'hidden', 'infiniteAmmo', 'guaranteed_hit', 'guaranteed_crit', 'blockResourceRestore', 'preserveLife'];
function rangeFor(key, template) {
  if (key === 'armor') {
    const base = template?.modifiers.armor;
    if (base == null) return [-100000, 100000];
    if (base < 0) return [-100000, -1];
    if (base === 0) return [0, 100000];
  }
  return Object.hasOwn(ranges, key) ? ranges[key] : undefined;
}

export function statusModifierRange(key, template) {
  const range = rangeFor(key, template);
  if (range) return range.join('–');
  if (key === 'damageType') return damageTypes.join('/');
  if (flags.includes(key)) return 'true/false';
  throw new Error(`未知状态参数：${key}`);
}

export const modifierKeys = Object.freeze([...Object.keys(ranges), 'damageType', ...flags]);

export function validateStatusModifiers(template, modifiers) {
  if (!modifiers || Object.getPrototypeOf(modifiers) !== Object.prototype) throw new Error('modifiers 必须为对象');
  for (const [key, value] of Object.entries(modifiers)) {
    if (!Object.hasOwn(template.modifiers, key)) throw new Error(`${template.id} 不允许覆盖状态参数 ${key}`);
    const range = rangeFor(key, template);
    const valid = range ? (ratios.includes(key) ? Number.isFinite(value) : Number.isInteger(value))
      && value >= range[0] && value <= range[1]
      : key === 'damageType' ? damageTypes.includes(value) : flags.includes(key) && typeof value === 'boolean';
    if (!valid) throw new Error(`无效状态参数 ${template.id}.${key}，合法范围：${statusModifierRange(key, template)}`);
  }
}
