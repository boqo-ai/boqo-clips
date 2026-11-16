import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { wordsWithin } from '../engine/boqo/words.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(new URL('./fixtures/parity/words-within.input.json', import.meta.url), 'utf8'));

test('wordsWithin (and clampOverrunningEnds under it) matches boqo on every case', () => {
  expectGolden('words-within', input.cases.map((c) => wordsWithin(c.words, c.startSec, c.endSec)));
});
