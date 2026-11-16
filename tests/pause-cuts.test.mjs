import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAUSE_DEFAULTS, planPauseCuts, transcriptGaps } from '../engine/boqo/pause-cuts.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('transcriptGaps matches boqo on every case', () => {
  expectGolden('transcript-gaps', input('transcript-gaps').cases.map((c) => transcriptGaps(c.words, c.minSec)));
});

test('planPauseCuts matches boqo on every case (50% cap, 0.15 and 0.25 s keeps)', () => {
  expectGolden(
    'plan-pause-cuts',
    input('plan-pause-cuts').cases.map((c) => planPauseCuts({ words: c.words, quietRuns: c.quietRuns, windowDurationSec: c.windowDurationSec, config: c.config })),
  );
});

test('the production pause numbers: 1.2 s minimum, keeps 0.15 after and 0.25 before, 50% cap', () => {
  assert.deepEqual(PAUSE_DEFAULTS, { minSec: 1.2, keepAfterWordSec: 0.15, keepBeforeWordSec: 0.25, maxFraction: 0.5 });
});

test('planPauseCuts does not mutate its input', () => {
  const words = [{ start: 0, end: 1 }, { start: 5, end: 6 }];
  const quietRuns = [{ start: 1, end: 5 }];
  const before = JSON.stringify([words, quietRuns]);
  planPauseCuts({ words, quietRuns, windowDurationSec: 10, config: PAUSE_DEFAULTS });
  assert.equal(JSON.stringify([words, quietRuns]), before);
});
