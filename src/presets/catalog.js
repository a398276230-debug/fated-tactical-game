import { expression } from '../core/effects.js';
const dice = (count, sides, stat, type, bonus = 0) => ({ count, sides, stat, type, bonus });
const status = (id, statusId, extra = {}) => expression(id, 'on_hit', 'hitTarget', [{ kind: 'grantStatus', statusId, ...extra }], { condition: { type: 'saved', value: false } });
const skill = (name, range, target, specs = {}) => ({ name, quality:'普通', power:50, ap: 1, slot: target === 'enemy' ? 'attack' : 'action', mp: 2,
  range, shape: 'single', target, effects: [], ...specs });

export const EQUIPMENT = {
  soulblade: { name: '噬魂太刀', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', attack:120, defense:0, range: 1, accuracy: 5, damage: dice(2, 6, 'str', 'physical'), effects: [
    {id: 'soulblade-0', trigger: 'passive', target: 'self', effects: [{kind: 'produceResource', resource: 'souls', cap: 10}, {kind: 'multiplyDamage', local: true, resourceScale: {resource: 'souls', perUnit: 0.5}}], params: {source: 'weapon'}},
    {id: 'soulblade-0-kill', trigger: 'on_kill', target: 'self', effects: [{kind: 'produceResource', resource: 'souls', amount: 1, local: true}], params: {source: 'weapon'}},
  ] },
  frostplate: { name: '霜纹荆棘重甲', quality:'普通', kind:'armor', armor: 2, defense:25, effects: [{id: 'frostplate-0', trigger: 'on_damaged', target: 'attacker', effects: [{kind: 'damage', amount: 3, label: '霜纹荆棘'}], condition: [{type: 'melee', value: true}, {type: 'reaction', value: false}, {type: 'enemy', value: true}]},
    {id: 'frostplate-0-status', trigger: 'on_damaged', target: 'attacker', effects: [{kind: 'grantStatus', statusId: 'chill'}], condition: [{type: 'melee', value: true}, {type: 'reaction', value: false}, {type: 'enemy', value: true}], roll: {chance: 0.4}, label: '霜纹荆棘'}] },
  bloodfang: { name: '双生血牙匕首', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', attack:80, defense:0, range: 1, accuracy: 3, damage: dice(2, 4, 'agi', 'physical'), effects: [
    {id: 'bloodfang-0', trigger: 'passive', target: 'self', effects: [{kind: 'multiplyDamage', factor: 1.4}, {kind: 'modifyCheck', advantage: 1}], params: {source: 'weapon'}, condition: {type: 'backstab', value: true}},
    {id: 'bloodfang-0-hit', trigger: 'on_hit', target: 'hitTarget', effects: [{kind: 'grantStatus', statusId: 'bleed', stacks: 2}, {kind: 'damage', amount: 4, inheritDamageType: true, label: '双生血牙连击'}], params: {source: 'weapon'}, condition: {type: 'or', conditions: [{type: 'backstab', value: true}, {type: 'critical', value: true}]}},
  ] },
  revolver: { name: '猎魔左轮', kind:'weapon', weaponClass:'ranged', hand:'one_handed', ranged:true, rangeType:'ranged', attack:100, defense:0, range: 5, accuracy: 3, damage: dice(2, 6, 'agi', 'physical'), effects: [
    {id: 'revolver-0', trigger: 'passive', target: 'self', effects: [{kind: 'produceResource', resource: 'ammo', cap: 6, initial: 6, reloadable: true}, {kind: 'modifyStat', stat: 'armorPierce', flat: 3}, {kind: 'modifyCheck', highGroundRange: 1, highGroundAccuracy: 2}], params: {source: 'weapon'}},
    {id: 'revolver-0-spend', trigger: 'on_attack', target: 'self', effects: [{kind: 'drainResource', resource: 'ammo', local: true, amount: 1, requireFull: true}], params: {source: 'weapon'}, condition: {type: 'not', conditions: [{type: 'selfStatusModifier', key: 'infiniteAmmo', value: true}]}},
  ] },
  crossbow: { name: '破甲重弩', kind:'weapon', weaponClass:'ranged', hand:'one_handed', ranged:true, attack:150, defense:0, rangeType:'ranged', range: 6, accuracy: 1, damage: dice(2, 8, 'agi', 'physical'), effects: [
    {id: 'crossbow-0', trigger: 'passive', target: 'self', effects: [{kind: 'produceResource', resource: 'ammo', cap: 3, initial: 3, reloadable: true}, {kind: 'modifyStat', stat: 'armorPierce', flat: 5}, {kind: 'modifyCheck', highGroundRange: 2, highGroundAccuracy: 2}], params: {source: 'weapon'}},
    {id: 'crossbow-0-spend', trigger: 'on_attack', target: 'self', effects: [{kind: 'drainResource', resource: 'ammo', local: true, amount: 1, requireFull: true}], params: {source: 'weapon'}, condition: {type: 'not', conditions: [{type: 'selfStatusModifier', key: 'infiniteAmmo', value: true}]}},
  ] },
  hymnal: { name: '圣咏庇护徽记', quality:'普通', kind:'accessory', effects: [{id: 'hymnal-0', trigger: 'passive', target: 'self', effects: [{kind: 'modifyStat', stat: 'healing', percent: 0.25, condition: {type: 'actionType', value: 'skill'}}]},
    {id: 'hymnal-0-shield', trigger: 'on_heal', target: 'hitTarget', condition: {type: 'actionType', value: 'skill'}, effects: [{kind: 'shield', percentOfHealing: 0.5, stack: true}]}] },
  shortblade: { name:'副手短刃', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', attack:50, defense:0, range:1, accuracy:1, damage:dice(1,4,'agi','physical'), effects:[] },
  potion: { name:'调和药剂', kind:'consumable', weaponClass:'auxiliary', hand:'off_hand', effects:[] },
  greatsword: { name:'玄铁重剑', kind:'weapon', weaponClass:'greatsword', hand:'two_handed', heavy:true, twoHanded:true, attack:260, defense:0, rangeType:'melee', range:1, accuracy:1, damage:dice(2,8,'str','physical'), effects:[] },
  towerShield: { name:'塔盾', kind:'shield', weaponClass:'shield', hand:'off_hand', shield:true, defense:8, effects:[] },
  pike: { name: '巡卫长戟', kind:'weapon', weaponClass:'greatsword', hand:'two_handed', heavy:true, twoHanded:true, attack:180, defense:0, rangeType:'melee', range: 2, accuracy: 2, damage: dice(1, 8, 'str', 'physical'), effects: [{id: 'pike-0', trigger: 'on_hit', target: 'hitTarget', effects: [{kind: 'grantStatus', statusId: 'root', turns: 1}], params: {source: 'weapon'}, condition: {type: 'opportunityAttack', value: true}}] },
  staff: { name: '灵纹法杖', kind:'weapon', weaponClass:'staff', hand:'one_handed', attack:90, defense:0, rangeType:'ranged', range: 4, accuracy: 2, damage: dice(1, 6, 'int', 'energy'), effects: [] },
};

export const SKILLS = {
  brand: skill('焰印', 4, 'enemy', { damage: dice(1, 4, 'int', 'energy'), effects: [status('preset-burn-1', 'burn'), status('preset-mark-2', 'mark')] }),
  surge: skill('断岳重斩', 1, 'enemy', { ap: 2, mp: 0, sp: 4, accuracy: 3, damage: dice(3, 6, 'str', 'physical'),
    effects: [expression('surge-push', 'on_hit', 'hitTarget', [{ kind: 'knockback', distance: 2, collisionDamage: 7 }]), status('preset-sunder-3', 'sunder')] }),
  ward: skill('守阵', 2, 'ally', { effects: [status('preset-guard-4', 'guard'), status('preset-guarded-5', 'guarded')] }),
  challenge: skill('挑衅', 4, 'enemy', { effects: [status('preset-taunt-6', 'taunt')] }),
  frost: skill('碎霜新星', 5, 'enemy', { ap: 2, mp: 5, shape: 'circle', radius: 2, save: 'con', saveDC: 14,
    damage: dice(2, 6, 'int', 'energy'), effects: [status('preset-freeze-7', 'freeze')] }),
  fan: skill('血牙扇斩', 3, 'enemy', { shape: 'fan', width: 1, damage: dice(1, 6, 'agi', 'physical'), effects: [status('preset-bleed-8', 'bleed')] }),
  toxin: skill('毒雾锥', 4, 'enemy', { shape: 'cone', width: 1, save: 'con', saveDC: 13,
    damage: dice(1, 4, 'int', 'mental'), effects: [status('preset-poison-9', 'poison'), status('preset-blind-10', 'blind')] }),
  beam: skill('贯星直线', 6, 'enemy', { ap: 2, mp: 4, shape: 'line', width: 0,
    damage: dice(2, 8, 'int', 'energy'), effects: [status('preset-root-11', 'root')] }),
  blink: skill('影步背刺', 5, 'enemy', { damage: dice(2, 6, 'agi', 'physical'), effects: [
    expression('blink-move', 'active', 'hitTarget', [{ kind: 'teleportBackstab', bonusMultiplier: .5 }]), status('preset-bleed-12', 'bleed'), status('preset-stealth-13', 'stealth', { target: 'self' }),
  ] }),
  hymn: skill('群星圣咏', 4, 'ally', { ap: 2, mp: 5, shape: 'circle', radius: 2,
    heal: dice(2, 4, 'spi', 'true'), effects: [status('preset-regen-14', 'regen')] }),
  cleanse: skill('净化祷言', 4, 'ally', { heal: dice(1, 4, 'spi', 'true'), effects: [expression('cleanse-negative', 'on_hit', 'hitTarget', [{ kind: 'removeStatus', category: 'all_negative' }])] }),
  shift: skill('迅影', 0, 'ally', { effects: [status('preset-haste-15', 'haste'), status('preset-stealth-16', 'stealth')] }),
  armor: skill('荆壁药剂', 0, 'ally', { mp: 0, sp: 3, effects: [status('preset-thorns-17', 'thorns'), status('preset-shield-18', 'shield', { amount: 6 })] }),
  curse: skill('蚀心咒', 4, 'enemy', { save: 'spi', saveDC: 13, damage: dice(1, 6, 'spi', 'mental'),
    effects: [status('preset-vulnerable-19', 'vulnerable')] }),
};
