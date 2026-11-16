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

import { findPeakRegions } from '../engine/boqo/peaks.mjs';
import { DEFAULT_REPLAY_TUNABLES as TUNABLES_FROM_REPLAY, curveBins, discountHeatmap, replayOf, parseReplay } from '../engine/boqo/replay.mjs';
import { DEFAULT_BRIDGE_MAX_SEC, DEFAULT_REPLAY_TUNABLES } from '../engine/boqo/replay-config.mjs';

import { sanitiseQuote } from '../engine/boqo/quote-text.mjs';
import { REACTION_MAX, REACTION_TEXT_MAX, parseTimestamps, pickReactions } from '../engine/boqo/viewer-reactions.mjs';

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

test('find-peak-regions matches the golden', () => {
  expectGolden('find-peak-regions', input('find-peak-regions').cases.map((c) => ({ name: c.name, regions: findPeakRegions(c.heatmap, c.durationSec) })));
});

test('discount-heatmap matches the golden (curve, bins and replayOf)', () => {
  expectGolden(
    'discount-heatmap',
    input('discount-heatmap').cases.map((c) => {
      const t = c.tunables ?? DEFAULT_REPLAY_TUNABLES;
      const curve = discountHeatmap(c.heatmap, c.chapterStartsSec, t);
      return {
        name: c.name,
        curve,
        bins: curve === null ? null : curveBins(curve),
        replays: (c.windows ?? []).map((w) => replayOf(curve, w, t, c.sha ?? null)),
      };
    }),
  );
});

test('replay-config holds the production defaults as constants', () => {
  assert.deepEqual(DEFAULT_REPLAY_TUNABLES, { factor: 0.5, introBins: 2, chapterBins: 1 });
  assert.equal(DEFAULT_REPLAY_TUNABLES, TUNABLES_FROM_REPLAY);
  assert.equal(DEFAULT_BRIDGE_MAX_SEC, 20);
});

test('a Replay blob parses back, and junk is null', () => {
  const curve = discountHeatmap(input('discount-heatmap').cases[3].heatmap, [], DEFAULT_REPLAY_TUNABLES);
  const r = replayOf(curve, { startSec: 290, endSec: 345 }, DEFAULT_REPLAY_TUNABLES, null);
  assert.deepEqual(parseReplay(JSON.parse(JSON.stringify(r))), r);
  assert.equal(parseReplay({ v: 2 }), null);
});

test('pick-reactions matches the golden (timestamp grammar and the pick)', () => {
  const { cases, stamps } = input('pick-reactions');
  expectGolden('pick-reactions', {
    stamps: stamps.map((text) => ({ text, seconds: parseTimestamps(text) })),
    cases: cases.map((c) => ({ name: c.name, reactions: pickReactions(c.comments, c.durationSec) })),
  });
});

test('reactions: at most 12, each cut to 120 characters', () => {
  assert.equal(REACTION_MAX, 12);
  assert.equal(REACTION_TEXT_MAX, 120);
});

test('sanitiseQuote is idempotent and removes links, quotes, markers and breaks', () => {
  const dirty = 'a\nb "q" <<<<< x >>>>> see https://example.com/p and www.example.org\u0007';
  const once = sanitiseQuote(dirty, 200);
  assert.equal(once, "a b 'q' < x > see and");
  assert.equal(sanitiseQuote(once, 200), once);
  assert.equal(sanitiseQuote('0123456789', 5), '0123…');
  assert.equal(sanitiseQuote('x', 0), '');
});
