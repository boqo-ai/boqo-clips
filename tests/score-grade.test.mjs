// The score bands, meter fill and axis letters against boqo's own output (tests/golden/score-bands.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity', `${name}.input.json`), 'utf8'));

import { bandLabel, meterFill, scoreBand, scoreToGrade } from '../engine/boqo/score-grade.mjs';

test('bands, meter fill and axis letters match boqo around every floor', () => {
  expectGolden(
    'score-bands',
    input('score-bands').scores.map((score) => {
      const band = scoreBand(score);
      return { score, band, label: bandLabel(band), fill: meterFill(score), grade: scoreToGrade(score) };
    }),
  );
});
