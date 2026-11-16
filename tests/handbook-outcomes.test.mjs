// handbookChips against boqo's own output (tests/golden/handbook-chips.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity', `${name}.input.json`), 'utf8'));

import { handbookChips } from '../engine/boqo/handbook-outcomes.mjs';

test('handbookChips matches boqo on every clip', () => {
  expectGolden(
    'handbook-chips',
    input('handbook-chips').cases.map((c) => ({ name: c.name, chips: handbookChips(c.clip) })),
  );
});
