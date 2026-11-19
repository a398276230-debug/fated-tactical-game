import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAPI } from '../src/api/game_api.js';
const stance = u => u.stance;
test('预设装备分类与姿态不是全部轻剑',()=>{
 const a=createGameAPI(); a.createBattle('ruins');
 const s=a.getBattleState();
 assert.equal(stance(s.units.swordsman),'light_blade');
 assert.equal(stance(s.units.ranger),'dual_wield');
 assert.equal(stance(s.units.oracle),'attunement');
 assert.equal(s.equipment.shortblade.weaponClass,'light_blade');
 assert.equal(s.equipment.potion.kind,'consumable');
 assert.equal(s.equipment.greatsword.twoHanded,true);
});
test('旧 weapon 字段与 mainHand 保持兼容，槽位实例不重复占用',()=>{
 const a=createGameAPI();a.createBattle('ruins'); const s=a.getBattleState();
 for(const u of Object.values(s.units)) assert.equal(u.weapon,u.mainHand);
 const all=[]; for(const u of Object.values(s.units)) all.push(u.mainHand,u.offHand,u.shield,...u.gear);
 assert.equal(new Set(all.filter(Boolean)).size,all.filter(Boolean).length);
});
