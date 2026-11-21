export const BUILTIN_RESOURCES = Object.freeze(['hp', 'mp', 'sp', 'ap', 'action', 'attack']);
export const RESOURCE_NAMES = Object.freeze({
  hp: '生命', mp: '法力', sp: '体力', ap: '行动点', action: '动作', attack: '攻击',
  souls: '魂数', ammo: '弹药',
});
export const resourceLabel = name => Object.hasOwn(RESOURCE_NAMES, name) ? RESOURCE_NAMES[name] : name;
