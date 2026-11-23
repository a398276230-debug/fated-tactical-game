import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./standardize.mjs', import.meta.url), 'utf8');

test('offline corpus runner caps repairs at one and defaults to no model retries', () => {
  assert.match(source, /process\.env\.REPAIR_ROUNDS \?\? process\.env\.REPAIR \?\? 0/);
  assert.match(source, /Math\.min\(1,/);
  assert.match(source, /!outcome\.explicitUnresolved && \(outcome\.error \|\| !outcome\.ok\)/);
  assert.match(source, /VM_API_KEY plus VM_API/);
});
