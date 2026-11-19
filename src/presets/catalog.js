const dice = (count, sides, stat, type, bonus = 0) => ({ count, sides, stat, type, bonus });
const status = (statusId, extra = {}) => ({ kind: 'status', statusId, ...extra });
const skill = (name, range, target, specs = {}) => ({ name, ap: 1, slot: target === 'enemy' ? 'attack' : 'action', mp: 2,
  range, shape: 'single', target, effects: [], ...specs });

export const EQUIPMENT = {
  soulblade: { name: '噬魂太刀', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', range: 1, accuracy: 5, damage: dice(2, 6, 'str', 'physical'), effects: [
    { kind: 'kill_charge_weapon', counterKey: 'souls', bonusPerStack: .5, maxStacks: 10 },
  ] },
  frostplate: { name: '霜纹荆棘重甲', kind:'armor', armor: 2, effects: [{ kind: 'frost_thorns', damage: 3, chance: .4, statusId: 'chill' }] },
  bloodfang: { name: '双生血牙匕首', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', range: 1, accuracy: 3, damage: dice(2, 4, 'agi', 'physical'), effects: [
    { kind: 'backstab', bonusMultiplier: .4, bleedStacks: 2, comboDamage: 4 },
  ] },
  revolver: { name: '猎魔左轮', kind:'weapon', weaponClass:'ranged', hand:'one_handed', ranged:true, rangeType:'ranged', range: 5, accuracy: 3, damage: dice(2, 6, 'agi', 'physical'), effects: [
    { kind: 'ammo', counterKey: 'ammo', capacity: 6, armorPierce: 3, highGroundRange: 1, highGroundAccuracy: 2 },
  ] },
  crossbow: { name: '破甲重弩', kind:'weapon', weaponClass:'ranged', hand:'one_handed', ranged:true, rangeType:'ranged', range: 6, accuracy: 1, damage: dice(2, 8, 'agi', 'physical'), effects: [
    { kind: 'ammo', counterKey: 'ammo', capacity: 3, armorPierce: 5, highGroundRange: 2, highGroundAccuracy: 2 },
  ] },
  hymnal: { name: '圣咏庇护徽记', kind:'accessory', effects: [{ kind: 'healing_shield', healBonus: .25, shieldRatio: .5 }] },
  shortblade: { name:'副手短刃', kind:'weapon', weaponClass:'light_blade', hand:'one_handed', rangeType:'melee', range:1, accuracy:1, damage:dice(1,4,'agi','physical'), effects:[] },
  potion: { name:'调和药剂', kind:'consumable', weaponClass:'auxiliary', hand:'off_hand', effects:[] },
  greatsword: { name:'玄铁重剑', kind:'weapon', weaponClass:'greatsword', hand:'two_handed', heavy:true, twoHanded:true, rangeType:'melee', range:1, accuracy:1, damage:dice(2,8,'str','physical'), effects:[] },
  towerShield: { name:'塔盾', kind:'shield', weaponClass:'shield', hand:'off_hand', shield:true, defense:8, effects:[] },
  pike: { name: '巡卫长戟', kind:'weapon', weaponClass:'greatsword', hand:'two_handed', heavy:true, twoHanded:true, rangeType:'melee', range: 2, accuracy: 2, damage: dice(1, 8, 'str', 'physical'), effects: [{ kind: 'opportunity_root' }] },
  staff: { name: '灵纹法杖', kind:'weapon', weaponClass:'staff', hand:'one_handed', rangeType:'ranged', range: 4, accuracy: 2, damage: dice(1, 6, 'int', 'energy'), effects: [] },
};

export const SKILLS = {
  brand: skill('焰印', 4, 'enemy', { damage: dice(1, 4, 'int', 'energy'), effects: [status('burn'), status('mark')] }),
  surge: skill('断岳重斩', 1, 'enemy', { ap: 2, mp: 0, sp: 4, accuracy: 3, damage: dice(3, 6, 'str', 'physical'),
    effects: [{ kind: 'knockback', distance: 2, collisionDamage: 7 }, status('sunder')] }),
  ward: skill('守阵', 2, 'ally', { effects: [status('guard'), status('guarded')] }),
  challenge: skill('挑衅', 4, 'enemy', { effects: [status('taunt')] }),
  frost: skill('碎霜新星', 5, 'enemy', { ap: 2, mp: 5, shape: 'circle', radius: 2, save: 'con', saveDC: 14,
    damage: dice(2, 6, 'int', 'energy'), effects: [status('freeze')] }),
  fan: skill('血牙扇斩', 3, 'enemy', { shape: 'fan', width: 1, damage: dice(1, 6, 'agi', 'physical'), effects: [status('bleed')] }),
  toxin: skill('毒雾锥', 4, 'enemy', { shape: 'cone', width: 1, save: 'con', saveDC: 13,
    damage: dice(1, 4, 'int', 'mental'), effects: [status('poison'), status('blind')] }),
  beam: skill('贯星直线', 6, 'enemy', { ap: 2, mp: 4, shape: 'line', width: 0,
    damage: dice(2, 8, 'int', 'energy'), effects: [status('root')] }),
  blink: skill('影步背刺', 5, 'enemy', { damage: dice(2, 6, 'agi', 'physical'), effects: [
    { kind: 'teleport_backstab', bonusMultiplier: .5 }, status('bleed'), status('stealth'),
  ] }),
  hymn: skill('群星圣咏', 4, 'ally', { ap: 2, mp: 5, shape: 'circle', radius: 2,
    heal: dice(2, 4, 'spi', 'true'), effects: [status('regen')] }),
  cleanse: skill('净化祷言', 4, 'ally', { heal: dice(1, 4, 'spi', 'true'), effects: [{ kind: 'cleanse' }] }),
  shift: skill('迅影', 0, 'ally', { effects: [status('haste'), status('stealth')] }),
  armor: skill('荆壁药剂', 0, 'ally', { mp: 0, sp: 3, effects: [status('thorns'), status('shield', { amount: 6 })] }),
  curse: skill('蚀心咒', 4, 'enemy', { save: 'spi', saveDC: 13, damage: dice(1, 6, 'spi', 'mental'),
    effects: [status('vulnerable')] }),
};
