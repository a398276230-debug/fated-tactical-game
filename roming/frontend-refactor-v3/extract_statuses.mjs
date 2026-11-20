// Inspect the live status catalog or verify that every default is represented.
import assert from 'node:assert/strict';
import { STATUSES } from '../../src/presets/status-defaults.js';
import { STATUS_CATALOG } from '../../src/tavern/status-catalog.js';

switch (process.argv[2]) {
  case undefined: console.log(STATUS_CATALOG); break;
  case '--json': console.log(JSON.stringify(STATUSES, null, 2)); break;
  case '--check': {
    const rows = STATUS_CATALOG.split('\n').filter(line => Object.keys(STATUSES).some(id => line.startsWith(`${id} | `)));
    assert.deepEqual(rows.map(row => row.split(' | ')[0]), Object.keys(STATUSES));
    console.log(`${rows.length} statuses; ${STATUS_CATALOG.length} UTF-16 code units`);
    break;
  }
  default: throw Error('Expected --check, --json, or no option');
}
