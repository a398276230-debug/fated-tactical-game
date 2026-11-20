import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hydrateFromSources} from '../src/tavern/converter.js';

const descriptor = `<battle_init>\nbattle|1|test-arena-01|模拟战斗测试场地|terrain|20260412\nunit|p1|blue|mvu:主角|全能测试王|2,2,0\nunit|e1|red|char_info|靶场木偶|6,6,0\ncover|c1|半|演练石矮墙|4,3,0\ncover|c2|全|厚重靶垛|5,5,0\n</battle_init>`;

test('terrain 模式即使所有显式 z 都是 0 仍生成种子地形', () => {
  const { state } = hydrateFromSources({ battleInit: descriptor }, { throwOnValidation: true });
  const cells = state.grid.flat();
  assert.equal(cells.length, 100);
  assert.ok(cells.some(cell => cell.kind !== 'floor' || cell.z !== 0));
});
