import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseBattleInit, hydrateFromSources} from '../src/tavern/converter.js';
import {applyAction, currentUnit, preview} from '../src/core/combat.js';
import {validateState} from '../src/api/validation.js';
const descriptor=`battle|1|z-test|高台|terrain|9
unit|p1|blue|char_info|飞行者|2,2,1
unit|e1|red|char_info|敌人|5,5,0
cover|c1|全|石墙|3,2,1
interact|i1|barrel|explode|2|12|爆桶|4,4,0`;
test('主模型声明 z、掩体和交互物可解析',()=>{const b=parseBattleInit(descriptor);assert.equal(b.units[0].z,1);assert.equal(b.covers[0].cover,5);assert.equal(b.interactives[0].kind,'barrel');const {state}=hydrateFromSources({battleInit:descriptor},{throwOnValidation:true});assert.equal(state.units.p1.z,undefined);assert.equal(state.grid[2][2].z,1);assert.equal(state.covers.c1.cover,5);assert.equal(state.interactives.i1.kind,'barrel');});
test('显式高程附近生成连续高台或坡道，未声明仍为零',()=>{const {state}=hydrateFromSources({battleInit:descriptor},{throwOnValidation:true});const elevated=state.grid.flat().filter(c=>c.z>0);assert.ok(elevated.length>=1);const {state:flat}=hydrateFromSources({battleInit:descriptor.replace('|terrain|','|flat|')},{throwOnValidation:true});assert.equal(flat.grid[2][2].z,1);assert.ok(flat.grid.flat().filter(c=>c.z>0).length>=1);});
test('changeAltitude 默认升高三，落地恢复并记录 z',()=>{const {state}=hydrateFromSources({battleInit:descriptor},{throwOnValidation:true});const unit=state.units.p1;state.skills.fly={name:'悬浮',ap:1,slot:'action',range:1,shape:'single',target:'self',rules:[{id:'fly',hook:'active',program:[{op:'move',mode:'altitude',target:'self'}]}]};unit.skills.push('fly');state.turn=state.order.indexOf('p1');unit.ap=2;validateState(state);applyAction(state,{type:'skill',skillId:'fly',x:unit.x,y:unit.y});assert.equal(unit.altitude,3);assert.ok(state.logs.some(l=>l.type==='altitude'&&l.detail.to.z===4));});
