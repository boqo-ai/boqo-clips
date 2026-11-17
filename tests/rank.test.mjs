// rankClips and rankTerms against boqo's own output (tests/golden/rank-clips.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity', `${name}.input.json`), 'utf8'));

import { rankClips, rankTerms } from '../engine/boqo/rank.mjs';

test('rankClips and rankTerms match boqo on every case', () => {
  expectGolden(
    'rank-clips',
    input('rank-clips').cases.map((c) => ({
      name: c.name,
      order: rankClips(c.clips).map((x) => x.id),
      terms: Object.fromEntries(c.clips.map((x) => [x.id, rankTerms(x)])),
    })),
  );
});
