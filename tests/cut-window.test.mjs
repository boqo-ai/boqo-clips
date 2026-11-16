import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CUT_FADE_SEC, cutFilterChains, cutWindowArgs, frameTimesArgs, parseFrameTimes, snapCutsToFrames } from '../engine/boqo/cut-window.mjs';
import { cutsDurationSec, keptSegments } from '../engine/boqo/cut-map.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('snapCutsToFrames matches boqo on every case', () => {
  expectGolden('snap-cuts-to-frames', input('snap-cuts-to-frames').cases.map((c) => snapCutsToFrames(c.cuts, c.frameTimes)));
});

test('snapCutsToFrames: snapping a snapped list returns it unchanged', () => {
  for (const c of input('snap-cuts-to-frames').cases) {
    const once = snapCutsToFrames(c.cuts, c.frameTimes);
    assert.deepEqual(snapCutsToFrames(once, c.frameTimes), once, c.name);
  }
});

test('cutFilterChains matches boqo on every case (no kept segment is an error)', () => {
  expectGolden(
    'cut-filter-chains',
    input('cut-filter-chains').cases.map((c) => {
      try {
        return cutFilterChains(c.keep, c.hasAudio);
      } catch (error) {
        return { error: error.message };
      }
    }),
  );
});

test('cutWindowArgs, frameTimesArgs and parseFrameTimes match boqo', () => {
  const i = input('cut-window-args');
  expectGolden('cut-window-args', {
    cutWindowArgs: i.cases.map((c) => cutWindowArgs(c.args)),
    frameTimesArgs: frameTimesArgs(i.frameTimes.path),
    parseFrameTimes: parseFrameTimes(i.frameTimes.stdout),
  });
});

test('the intermediate is x264 veryfast CRF 16 with AAC 192k', () => {
  const args = cutWindowArgs({ inPath: 'a', outPath: 'b', keep: [{ start: 0, end: 1 }], hasAudio: true, filterThreads: 1, encodeThreads: 1 });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('-c:v'), 'libx264');
  assert.equal(at('-preset'), 'veryfast');
  assert.equal(at('-crf'), '16');
  assert.equal(at('-c:a'), 'aac');
  assert.equal(at('-b:a'), '192k');
  assert.equal(CUT_FADE_SEC, 0.01);
});

test('keptSegments and cutsDurationSec match boqo', () => {
  expectGolden('kept-segments', input('kept-segments').cases.map((c) => ({ kept: keptSegments(c.windowDurationSec, c.cuts), cutSec: cutsDurationSec(c.cuts) })));
});
