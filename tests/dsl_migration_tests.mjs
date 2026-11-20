import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI, buildScenario } from '../src/index.js';
import { applyAction, preview } from '../src/core/combat.js';
import { adaptLegacyEffects, expression, migrateStateEffects } from '../src/core/effects.js';
import { validateEffect, validateState } from '../src/api/validation.js';

test('every legacy kind translates to valid DSL and translation is idempotent', () => {
  const samples = {
    status: { statusId: 'burn' }, save_or_status: { statusId: 'freeze', save: 'con', saveDC: 13 },
    fixed_attack: { value: 20 }, fixed_damage: { amount: 10, damageType: 'true' },
    bonus_damage: { scope: 'melee', amount: 5, damageType: 'physical' }, check_bonus: { iniBonus: 2 },
    guaranteed_hit: {}, guaranteed_crit: {}, hit_tier_up: {}, infinite_ammo: {},
    on_hit_status: { scope: 'arrow', statusId: 'bleed' }, tier_growth: { stat: 'attributes', value: { min: .25, max: 1 } },
    resource_pool: { counterKey: 'souls', capacity: 10 }, resource_scale: { resource: 'souls', perUnit: .1 },
    resource_restore: { perUnit: .25 }, execute_threshold: { threshold: .25, resource: 'souls', perTier: 4 },
    kill_charge_weapon: { counterKey: 'souls', bonusPerStack: .5, maxStacks: 10 }, ammo: { counterKey: 'ammo', capacity: 3 },
    frost_thorns: { chance: .4, damage: 3, statusId: 'chill' }, backstab: { bonusMultiplier: .4, bleedStacks: 2, comboDamage: 4 },
    healing_shield: { healBonus: .25, shieldRatio: .5 }, opportunity_root: {},
    knockback: { distance: 2, collisionDamage: 7 }, teleport_backstab: { bonusMultiplier: .5 }, cleanse: {},
  };
  for (const [kind, fields] of Object.entries(samples)) {
    const expressions = adaptLegacyEffects([{ kind, ...fields }], 'equipment', `test-${kind}`);
    assert.ok(expressions.length, kind);
    assert.equal(new Set(expressions.map(expr => expr.id)).size, expressions.length, kind);
    for (const expr of expressions) validateEffect(expr);
    assert.deepEqual(adaptLegacyEffects(expressions, 'equipment'), expressions, kind);
  }
});

const legacy = { kind: 'kill_charge_weapon', counterKey: 'souls', bonusPerStack: .5, maxStacks: 10 };
const attack = { type: 'attack', x: 3, y: 2 };
function fixture(souls) {
  const state = buildScenario('ruins');
  const actor = state.units.swordsman;
  state.turn = state.order.indexOf(actor.id);
  actor.ap = 2;
  actor.x = 2;
  state.units.scout.hp = 1;
  state.items[actor.weapon].counters.souls = souls;
  state.equipment.soulblade.effects.push(expression('migration-guarantee', 'passive', 'self', [{ kind: 'forceOutcome', mode: 'hit' }]));
  return state;
}

test('G65 legacy kill-charge loads and applies the same multiplier, kill credit, and cap', () => {
  for (const souls of [0, 2, 10]) {
    const native = fixture(souls);
    const old = structuredClone(native);
    old.equipment.soulblade.effects.splice(0, 2, legacy);
    const api = createGameAPI();
    const oldSnapshot = { kind: 'battle', version: 2, origin: old, state: old, journal: [] };
    assert.equal(api.restoreBattleSnapshot(oldSnapshot).migratedFrom, 2);
    const migrated = api.getBattleState();
    assert.deepEqual(migrateStateEffects(structuredClone(migrated)), migrated);
    validateState(migrated);
    assert.equal(preview(migrated, attack).damageMultiplier, 1 + souls * .5);
    assert.deepEqual(preview(migrated, attack).targets[0].damage, preview(native, attack).targets[0].damage);
    applyAction(migrated, attack);
    applyAction(native, attack);
    assert.equal(migrated.units.scout.hp, 0);
    assert.equal(migrated.items['soulblade-lan'].counters.souls, Math.min(10, souls + 1));
    assert.deepEqual(migrated.items, native.items);
  }
});
