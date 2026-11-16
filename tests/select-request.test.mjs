// The selection request (A3): boqo's own functions at the pin produced every
// tests/golden/*.json used here (scripts/parity/golden.mjs), so a drifted copy
// fails by value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';
import { clipTargetFor, keepCeilingFor } from '../engine/boqo/clip-target.mjs';
import { CLIP_LENGTH_PRESETS, GENRE_PRESETS, resolveClipLength, resolveGenre } from '../engine/boqo/selection-presets.mjs';

const input = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url)), 'utf8'));

test('clipTargetFor matches the golden, and 2400 s is 40', () => {
  expectGolden('clip-target', input('clip-target').map(clipTargetFor));
  assert.equal(clipTargetFor(2400), 40);
});

test('keepCeilingFor is min(round(target x 1.25), 120)', () => {
  assert.deepEqual([1, 40, 96, 100, 120].map(keepCeilingFor), [1, 50, 120, 120, 120]);
});

test('presets: auto is 20-75 s soft and 15-90 s hard, series_film is gone', () => {
  assert.deepEqual(GENRE_PRESETS.map((g) => g.key), ['auto', 'podcast', 'talk', 'gaming', 'vlog', 'entertainment']);
  assert.deepEqual(CLIP_LENGTH_PRESETS.map((l) => l.key), ['auto', 'under_30', '30_60', '60_90', '90_120', '120_180']);
  const auto = resolveClipLength(null);
  assert.deepEqual([auto.softMinSec, auto.softMaxSec, auto.hardMinSec, auto.hardMaxSec], [20, 75, 15, 90]);
  assert.equal(resolveGenre('auto').guidance, null);
  const seen = [];
  assert.equal(resolveGenre('series_film', (v) => seen.push(v)).key, 'auto');
  assert.deepEqual(seen, ['series_film']);
});
