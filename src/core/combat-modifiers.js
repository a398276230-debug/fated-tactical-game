// Modifier, mitigation, weapon and shield exports. The implementation remains
// in combat-actions.js to preserve the existing dependency graph during cutover.
export {
  damageAfterFlatReduction, mitigation, shieldTotal, syncEquipmentEffects, weaponInfo,
} from './combat-actions.js';
