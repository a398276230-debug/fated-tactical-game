import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatOnlyStats, statNames, vmHooks, vmOpcodes } from '../src/core/vm-schema.js';
import { STATUSES } from '../src/presets/status-defaults.js';
import { DEMO_STATUSES } from '../src/presets/demo-statuses.js';
import { buildScenario } from '../src/presets/scenarios.js';
import { COMMAND_TYPES } from '../src/api/commands.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const jsonBlocks = file => [...read(file).matchAll(/```json\s*([\s\S]*?)```/g)].map(match => ({ file, value: JSON.parse(match[1]) }));
const files = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter(file => file.endsWith('.md')).map(file => `docs/${file}`)];

function graphFor(directory) {
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(root, directory));
  const graph = new Map(files.map(file => [file, new Set()]));
  for (const file of files) for (const match of read(path.relative(root, file)).matchAll(/from ['"](\.\/[^'"]+\.js)['"]/g)) {
    const target = path.normalize(path.join(path.dirname(file), match[1]));
    if (graph.has(target)) graph.get(file).add(target);
  }
  return graph;
}

function cycleCount(graph) {
  const active = new Set(), pathStack = [], cycles = [];
  const visit = node => {
    if (active.has(node)) { cycles.push([...pathStack.slice(pathStack.indexOf(node)), node]); return; }
    active.add(node); pathStack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    pathStack.pop(); active.delete(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

test('documentation JSON fences are parseable', () => {
  for (const block of files.flatMap(jsonBlocks)) assert.doesNotThrow(() => block.value, block.file);
});

test('documentation counts match authoritative sources', () => {
  const docs = files.map(read).join('\n');
  assert.equal(vmHooks.length, 26);
  assert.equal(vmOpcodes.length, 17);
  assert.equal(Object.keys(STATUSES).length, 9);
  assert.equal(Object.keys(DEMO_STATUSES).length, 17);
  assert.deepEqual(Object.keys(buildScenario('ruins').statusTemplates).sort(), Object.keys(DEMO_STATUSES).sort());
  assert.equal(COMMAND_TYPES.length, 15);
  assert.match(docs, /Hooks（26）/);
  assert.match(docs, /Opcodes（17）/);
  assert.match(docs, /9 个内核状态/);
  assert.doesNotMatch(docs, /26 个内置状态/);
  assert.match(read('README.md'), /version: 11/);
  assert.match(docs, /15 项|15 个|Commands（15）/);
  assert.doesNotMatch(docs, /adjust_item_counter/);
});

test('DSL modifier lists in the handbook match the schema', () => {
  const lines = read('docs/dsl.md').split('\n');
  const names = line => [...line.matchAll(/`(\w+)`/g)].map(match => match[1]);
  assert.deepEqual(names(lines.find(line => line.startsWith('`statMod.stat`'))), statNames.filter(stat => !['str', 'agi', 'con', 'int', 'spi'].includes(stat)));
  assert.deepEqual(names(lines.find(line => line.startsWith('- flat-only stats：'))), flatOnlyStats);
});

test('Tavern module graph has no cycles', () => {
  assert.equal(cycleCount(graphFor('src/tavern')).length, 0);
});

test('core and Tavern facade/module size guard', () => {
  for (const file of ['src/core/combat.js', 'src/tavern/converter.js', 'src/tavern/overlay.js']) {
    assert.ok(read(file).split('\n').length <= 50, `${file} must remain a facade`);
  }
  const modules = [
    'src/tavern/converter-parse.js', 'src/tavern/converter-effects.js', 'src/tavern/converter-unit.js', 'src/tavern/converter-patch.js',
    'src/tavern/overlay-ai.js', 'src/tavern/overlay-patch.js', 'src/tavern/overlay-sources.js', 'src/tavern/overlay-diagnostics-view.js',
  ];
  for (const file of modules) assert.ok(read(file).split('\n').length >= 30, `${file} is an empty shell`);
  for (const file of ['src/core/combat-modifiers.js', 'src/core/combat-status.js', 'src/core/combat-turn.js', 'src/core/combat-geo-preview.js']) assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must stay deleted`);
});
