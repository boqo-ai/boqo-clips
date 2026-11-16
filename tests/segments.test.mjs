import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SEGMENT_WORDS, PAUSE_SPLIT_SEC, segmentsFromWords } from '../engine/segments.mjs';
import { wordsFromJson3 } from '../engine/words.mjs';

const CLI = fileURLToPath(new URL('../tools/transcript.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'boqo-segments-test-'));

// words at 0.3 s steps, each 0.25 s long, from `t0`
const spoken = (text, t0 = 0) =>
  text.split(' ').map((w, i) => ({ w, s: Math.round((t0 + i * 0.3) * 1000) / 1000, e: Math.round((t0 + i * 0.3 + 0.25) * 1000) / 1000 }));

test('constants: 0.6 s pause (provisional), 40 words', () => {
  assert.equal(PAUSE_SPLIT_SEC, 0.6);
  assert.equal(MAX_SEGMENT_WORDS, 40);
});

for (const source of ['manual', 'whisper']) {
  test(`${source}: "Hello there. How are you? Fine" splits after . and ?, the tail is a segment`, () => {
    const segs = segmentsFromWords(spoken('Hello there. How are you? Fine'), { source });
    assert.deepEqual(segs.map((x) => x.text), ['Hello there.', 'How are you?', 'Fine']);
  });
}

test('manual and whisper ignore pauses: only punctuation and the word cap split', () => {
  const words = [...spoken('no stop'), ...spoken('here either', 5)];
  for (const source of ['manual', 'whisper']) {
    assert.equal(segmentsFromWords(words, { source }).length, 1);
  }
});

test('85 unpunctuated words with no pause give segments of 40, 40 and 5', () => {
  const words = spoken(Array.from({ length: 85 }, (_, i) => `w${i}`).join(' '));
  for (const source of ['manual', 'auto', 'whisper']) {
    const segs = segmentsFromWords(words, { source });
    assert.deepEqual(segs.map((x) => x.text.split(' ').length), [40, 40, 5], source);
  }
});

test('the hosted terminal rule: . ! ? with an optional closing double quote, nothing else', () => {
  const segs = segmentsFromWords(spoken('Stop! Really? He said "go." Then, (maybe) 5.5 done'), { source: 'whisper' });
  assert.deepEqual(segs.map((x) => x.text), ['Stop!', 'Really?', 'He said "go."', 'Then, (maybe) 5.5 done']);
});

test('auto: a 0.7 s gap splits, a 0.5 s gap does not (default 0.6); exactly 0.6 splits', () => {
  const mk = (gap) => [
    { w: 'one', s: 0, e: 0.3 },
    { w: 'two', s: 0.3, e: 0.6 },
    { w: 'three', s: 0.6 + gap, e: 0.9 + gap },
  ];
  assert.deepEqual(segmentsFromWords(mk(0.7), { source: 'auto' }).map((x) => x.text), ['one two', 'three']);
  assert.equal(segmentsFromWords(mk(0.5), { source: 'auto' }).length, 1);
  assert.equal(segmentsFromWords(mk(0.6), { source: 'auto' }).length, 2);
  assert.equal(segmentsFromWords(mk(0.5), { source: 'auto', pauseSplitSec: 0.4 }).length, 2);
  assert.equal(segmentsFromWords(mk(0.7), { source: 'auto', pauseSplitSec: 1 }).length, 1);
});

test('auto still splits on .!? and at 40 words', () => {
  const segs = segmentsFromWords(spoken('hi there. you again'), { source: 'auto' });
  assert.deepEqual(segs.map((x) => x.text), ['hi there.', 'you again']);
});

test('a segment starts at its first word s and ends at its last word e; speaker is null', () => {
  const words = [
    { w: 'Hello', s: 1.2, e: 1.5 },
    { w: 'there.', s: 1.6, e: 2.1 },
    { w: 'Next', s: 4, e: 4.4 },
    { w: 'one', s: 4.5, e: 5.25 },
  ];
  assert.deepEqual(segmentsFromWords(words, { source: 'whisper' }), [
    { start: 1.2, end: 2.1, text: 'Hello there.', speaker: null },
    { start: 4, end: 5.25, text: 'Next one', speaker: null },
  ]);
});

test('Russian auto captions: "привет как дела" + 0.8 s + "хорошо" is 2 segments', () => {
  const words = [
    { w: 'привет', s: 0, e: 0.4 },
    { w: 'как', s: 0.4, e: 0.7 },
    { w: 'дела', s: 0.7, e: 1.0 },
    { w: 'хорошо', s: 1.8, e: 2.3 },
  ];
  const segs = segmentsFromWords(words, { source: 'auto' });
  assert.deepEqual(segs.map((x) => x.text), ['привет как дела', 'хорошо']);
  assert.deepEqual([segs[0].start, segs[0].end, segs[1].start, segs[1].end], [0, 1.0, 1.8, 2.3]);
});

test('a manual track through wordsFromJson3 splits on the cue text, not the cue edge', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello there. How' }] },
      { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'are you? Fine' }] },
    ],
  };
  const segs = segmentsFromWords(wordsFromJson3(j), { source: 'manual' });
  assert.deepEqual(segs.map((x) => x.text), ['Hello there.', 'How are you?', 'Fine']);
  assert.ok(segs.every((x) => x.start < x.end && x.speaker === null));
});

test('an auto track through wordsFromJson3: a long silence between word events splits', () => {
  const ev = (t, w) => ({ tStartMs: t, dDurationMs: 1000, segs: [{ utf8: w, tOffsetMs: 0 }] });
  const j = { events: [ev(0, 'one'), ev(500, 'two'), ev(4000, 'three')] };
  const segs = segmentsFromWords(wordsFromJson3(j), { source: 'auto' });
  assert.deepEqual(segs.map((x) => x.text), ['one two', 'three']);
});

test('blank words are skipped; input order is by start time; empty in, empty out', () => {
  assert.deepEqual(segmentsFromWords([], { source: 'whisper' }), []);
  const segs = segmentsFromWords([{ w: 'b', s: 1, e: 1.2 }, { w: ' ', s: 0.5, e: 0.6 }, { w: 'a', s: 0, e: 0.2 }], { source: 'whisper' });
  assert.deepEqual(segs, [{ start: 0, end: 1.2, text: 'a b', speaker: null }]);
});

test('the input is not mutated, and an unknown or missing source throws', () => {
  const words = spoken('a. b');
  const copy = JSON.parse(JSON.stringify(words));
  segmentsFromWords(words, { source: 'auto' });
  assert.deepEqual(words, copy);
  assert.throws(() => segmentsFromWords(words, { source: 'deepgram' }), /source/);
  assert.throws(() => segmentsFromWords(words), /source/);
  assert.throws(() => segmentsFromWords(words, { source: 'auto', pauseSplitSec: -1 }), /pauseSplitSec/);
});

// ---- tools/transcript.mjs --segments

test('transcript.mjs --segments <out> --source writes segments.json and prints one JSON line', () => {
  const d = tmp();
  const wf = join(d, 'words.json');
  const out = join(d, 'segments.json');
  writeFileSync(wf, JSON.stringify(spoken('Hello there. How are you?')));
  const r = spawnSync(process.execPath, [CLI, '--words', wf, '--segments', out, '--source', 'whisper'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(r.stdout), { out, segments: 2, words: 5 });
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).map((x) => x.text), ['Hello there.', 'How are you?']);
});

test('transcript.mjs --segments: --pause-split reaches auto; --source is required and checked', () => {
  const d = tmp();
  const wf = join(d, 'words.json');
  const out = join(d, 'segments.json');
  writeFileSync(wf, JSON.stringify([{ w: 'a', s: 0, e: 0.3 }, { w: 'b', s: 1, e: 1.3 }]));
  const run = (...a) => spawnSync(process.execPath, [CLI, '--words', wf, ...a], { encoding: 'utf8' });
  assert.equal(run('--segments', out, '--source', 'auto').status, 0);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).length, 2);
  assert.equal(run('--segments', out, '--source', 'auto', '--pause-split', '1').status, 0);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).length, 1);
  for (const bad of [['--segments', out], ['--segments', out, '--source', 'deepgram'], ['--segments', out, '--source', 'auto', '--pause-split', '0'], ['--segments', out, '--out', join(d, 't.md'), '--source', 'auto'], ['--source', 'auto', '--out', join(d, 't.md')]]) {
    const r = run(...bad);
    assert.equal(r.status, 1, bad.join(' '));
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.ok(JSON.parse(r.stdout).error, bad.join(' '));
  }
});
