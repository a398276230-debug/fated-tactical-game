const dice = (count, sides, stat, type, bonus = 0) => ({ count, sides, stat, type, bonus });
const rule = (id, hook, program, filter) => ({ id, hook, program, ...(filter === undefined ? {} : { filter }) });
const apply = (statusId, target = 'target', options = {}) => ({ op: 'apply_status', target, statusId, ...options });
const onHit = (id, program) => rule(id, 'after_hit', program, 'event.actorId == self.id && event.saved != true');
const skill = (name, range, target, specs = {}) => ({
  name, quality: '普通', power: 50, ap: 1, slot: target === 'enemy' ? 'attack' : 'action', mp: 2,
  range, shape: 'single', target, ...specs,
});
const weapon = (templateId, filter) => `event.weaponTemplateId == '${templateId}' && event.actorId == self.id${filter ? ` && (${filter})` : ''}`;
const meleeRetaliation = 'event.targetId == self.id && event.melee == true && event.direct == true && attacker.alive && attacker.team != self.team';
const rangedWeapon = (templateId, ammo, armorPierce, highGroundRange) => ({
  pools: { ammo: { cap: ammo, initial: ammo, reloadable: true } },
  vars: { highGroundRange, highGroundAccuracy: 2 },
  mods: [{ stat: 'armorPierce', flat: armorPierce, when: weapon(templateId) }],
  rules: [rule(`${templateId}-spend`, 'before_action', [
    { op: 'resource', target: 'self', pool: 'ammo', mode: 'sub', amount: 1, local: true, requireFull: true },
  ], weapon(templateId, "event.actionType == 'attack' && !has_status(self, 'infinite_ammo')"))],
});

export const EQUIPMENT = {
  soulblade: {
    name: '噬魂太刀', kind: 'weapon', weaponClass: 'light_blade', hand: 'one_handed', rangeType: 'melee', attack: 120,
    defense: 0, range: 1, accuracy: 5, damage: dice(2, 6, 'str', 'physical'),
    pools: { souls: { cap: 10, initial: 0, reloadable: false } },
    mods: [{ stat: 'damageMult', mult: '1 + 0.5 * event.souls', when: weapon('soulblade') }],
    rules: [rule('soulblade-kill', 'after_damage', [
      { op: 'resource', target: 'self', pool: 'souls', mode: 'add', amount: 1, local: true },
    ], weapon('soulblade', 'event.direct == true && event.dealt > 0 && !target.alive && target.team != self.team'))],
  },
  frostplate: {
    name: '霜纹荆棘重甲', quality: '普通', kind: 'armor', armor: 2, defense: 25,
    rules: [rule('frostplate-retaliate', 'after_damage', [
      { op: 'damage', target: 'attacker', amount: 3, damageType: 'physical', direct: false, label: '霜纹荆棘' },
      { op: 'for_each', select: { from: 'attacker' }, body: [
        { op: 'check', kind: 'chance', dc: 40, onPass: [apply('chill', 'target')] },
      ] },
    ], meleeRetaliation)],
  },
  bloodfang: {
    name: '双生血牙匕首', kind: 'weapon', weaponClass: 'light_blade', hand: 'one_handed', rangeType: 'melee', attack: 80,
    defense: 0, range: 1, accuracy: 3, damage: dice(2, 4, 'agi', 'physical'),
    mods: [
      { stat: 'damageMult', mult: 1.4, when: weapon('bloodfang', 'event.backstab == true') },
      { stat: 'advantage', flat: 1, checkKind: 'attack', when: weapon('bloodfang', 'event.backstab == true') },
    ],
    rules: [rule('bloodfang-combo', 'after_hit', [
      apply('bleed', 'target', { stacks: 2 }),
      { op: 'damage', target: 'target', amount: 4, damageType: 'physical', direct: false, label: '双生血牙连击' },
    ], weapon('bloodfang', 'event.backstab == true || event.critical == true'))],
  },
  revolver: {
    name: '猎魔左轮', kind: 'weapon', weaponClass: 'ranged', hand: 'one_handed', ranged: true, rangeType: 'ranged',
    attack: 100, defense: 0, range: 5, accuracy: 3, damage: dice(2, 6, 'agi', 'physical'), ...rangedWeapon('revolver', 6, 3, 1),
  },
  crossbow: {
    name: '破甲重弩', kind: 'weapon', weaponClass: 'ranged', hand: 'one_handed', ranged: true, rangeType: 'ranged',
    attack: 150, defense: 0, range: 6, accuracy: 1, damage: dice(2, 8, 'agi', 'physical'), ...rangedWeapon('crossbow', 3, 5, 2),
  },
  hymnal: {
    name: '圣咏庇护徽记', quality: '普通', kind: 'accessory',
    mods: [{ stat: 'healingMult', mult: 1.25, when: "event.actionType == 'skill'" }],
    rules: [rule('hymnal-shield', 'after_heal', [
      { op: 'let', name: 'existingShield', value: 0 },
      { op: 'for_each', select: { from: 'statuses', of: 'target', where: "status.id == 'shield'" }, body: [
        { op: 'let', name: 'existingShield', value: 'status.vars.shieldAmount' },
      ] },
      apply('shield', 'target', { vars: { shieldAmount: 'vars.existingShield + floor(event.healing / 2)' } }),
    ], "event.actorId == self.id && event.actionType == 'skill' && event.healing >= 2")],
  },
  shortblade: { name: '副手短刃', kind: 'weapon', weaponClass: 'light_blade', hand: 'one_handed', rangeType: 'melee', attack: 50, defense: 0, range: 1, accuracy: 1, damage: dice(1, 4, 'agi', 'physical') },
  potion: { name: '调和药剂', kind: 'consumable', weaponClass: 'auxiliary', hand: 'off_hand' },
  greatsword: { name: '玄铁重剑', kind: 'weapon', weaponClass: 'greatsword', hand: 'two_handed', heavy: true, twoHanded: true, attack: 260, defense: 0, rangeType: 'melee', range: 1, accuracy: 1, damage: dice(2, 8, 'str', 'physical') },
  towerShield: { name: '塔盾', kind: 'shield', weaponClass: 'shield', hand: 'off_hand', shield: true, defense: 8 },
  pike: {
    name: '巡卫长戟', kind: 'weapon', weaponClass: 'greatsword', hand: 'two_handed', heavy: true, twoHanded: true,
    attack: 180, defense: 0, rangeType: 'melee', range: 2, accuracy: 2, damage: dice(1, 8, 'str', 'physical'),
    rules: [rule('pike-root', 'after_hit', [apply('root', 'target', { turns: 1 })], weapon('pike', 'event.opportunityAttack == true'))],
  },
  staff: { name: '灵纹法杖', kind: 'weapon', weaponClass: 'staff', hand: 'one_handed', attack: 90, defense: 0, rangeType: 'ranged', range: 4, accuracy: 2, damage: dice(1, 6, 'int', 'energy') },
};

export const SKILLS = {
  brand: skill('焰印', 4, 'enemy', { damage: dice(1, 4, 'int', 'energy'), rules: [onHit('brand-status', [apply('burn'), apply('mark')])] }),
  surge: skill('断岳重斩', 1, 'enemy', {
    ap: 2, mp: 0, sp: 4, accuracy: 3, damage: dice(3, 6, 'str', 'physical'),
    rules: [rule('surge-push', 'after_hit', [{ op: 'move', target: 'target', mode: 'push', distance: 2,
      collisionDamage: 7, onCollide: [apply('stun', 'target', { turns: 1 })] }], 'event.actorId == self.id'),
      onHit('surge-sunder', [apply('sunder')])],
  }),
  ward: skill('守阵', 2, 'ally', { rules: [onHit('ward-status', [apply('guard'), apply('guarded')])] }),
  challenge: skill('挑衅', 4, 'enemy', { rules: [onHit('challenge-taunt', [apply('taunt')])] }),
  frost: skill('碎霜新星', 5, 'enemy', {
    ap: 2, mp: 5, shape: 'circle', radius: 2, save: 'con', saveDC: 14,
    damage: dice(2, 6, 'int', 'energy'), rules: [onHit('frost-freeze', [apply('freeze')])],
  }),
  fan: skill('血牙扇斩', 3, 'enemy', { shape: 'fan', width: 1, damage: dice(1, 6, 'agi', 'physical'), rules: [onHit('fan-bleed', [apply('bleed')])] }),
  toxin: skill('毒雾锥', 4, 'enemy', {
    shape: 'cone', width: 1, save: 'con', saveDC: 13, damage: dice(1, 4, 'int', 'mental'),
    rules: [onHit('toxin-status', [apply('poison'), apply('blind')])],
  }),
  beam: skill('贯星直线', 6, 'enemy', {
    ap: 2, mp: 4, shape: 'line', width: 0, damage: dice(2, 8, 'int', 'energy'), rules: [onHit('beam-root', [apply('root')])],
  }),
  blink: skill('影步背刺', 5, 'enemy', {
    damage: dice(2, 6, 'agi', 'physical'),
    rules: [
      rule('blink-move', 'before_target', [
        { op: 'for_each', select: { from: 'cells', where: 'candidate.x == event.backX && candidate.y == event.backY' }, bind: 'landing', body: [
          { op: 'move', target: 'self', mode: 'teleport', to: 'vars.landing' },
          { op: 'if', cond: 'self.x == event.backX && self.y == event.backY', then: [
            { op: 'mutate_event', patch: { damageScale: 1.5 } },
          ], else: [{ op: 'mutate_event', patch: { cancel: true } }] },
        ] },
      ]),
      rule('blink-advantage', 'before_check', [{ op: 'mutate_event', patch: { advantageDelta: 1 } }], "event.actorId == self.id && event.checkKind == 'attack'"),
      onHit('blink-status', [apply('bleed'), apply('stealth', 'self')]),
    ],
  }),
  hymn: skill('群星圣咏', 4, 'ally', {
    ap: 2, mp: 5, shape: 'circle', radius: 2, heal: dice(2, 4, 'spi', 'true'), rules: [onHit('hymn-regen', [apply('regen')])],
  }),
  cleanse: skill('净化祷言', 4, 'ally', {
    heal: dice(1, 4, 'spi', 'true'), rules: [onHit('cleanse-negative', [
      { op: 'remove_status', target: 'target', where: "status.category == 'debuff' || status.category == 'control' || status.category == 'dot'", reason: 'cleansed' },
    ])],
  }),
  shift: skill('迅影', 0, 'ally', { rules: [onHit('shift-status', [apply('haste'), apply('stealth')])] }),
  armor: skill('荆壁药剂', 0, 'ally', {
    mp: 0, sp: 3, rules: [onHit('armor-status', [apply('thorns'), apply('shield', 'target', { vars: { shieldAmount: 6 } })])],
  }),
  curse: skill('蚀心咒', 4, 'enemy', {
    save: 'spi', saveDC: 13, damage: dice(1, 6, 'spi', 'mental'), rules: [onHit('curse-vulnerable', [apply('vulnerable')])],
  }),
};
