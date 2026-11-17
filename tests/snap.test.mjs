// snapAndFilter against boqo's own output (tests/golden/snap-and-filter.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapAndFilter } from '../engine/boqo/snap.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity/snap-and-filter.input.json'), 'utf8'));

test('snapAndFilter matches boqo on every case', () => {
  expectGolden('snap-and-filter', input.cases.map((c) => ({ name: c.name, result: snapAndFilter(c.candidates, c.segments, c.opts) })));
});
