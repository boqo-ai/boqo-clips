import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  wordsFromJson3,
  wordsFromWhisper,
  wordsInRange,
  transcriptChunks,
} from '../engine/words.mjs'

test('wordsFromJson3 builds words from overlapping events', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 3880, segs: [{ utf8: 'Hey' }, { utf8: " y'all,", tOffsetMs: 200 }] },
      { tStartMs: 1880, segs: [{ utf8: 'middle' }] },
      { segs: [{ utf8: '\n' }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j), [
    { w: 'Hey', s: 0, e: 0.2 },
    // next word starts at 1.88 but a word never runs longer than 1 s
    { w: "y'all,", s: 0.2, e: 1.2 },
    // no dDurationMs: the last word ends at the cap
    { w: 'middle', s: 1.88, e: 2.88 },
  ])
})

test('wordsFromJson3: a word ends at the next word start when that is under 1 s', () => {
  const j = { events: [{ tStartMs: 1000, dDurationMs: 900, segs: [{ utf8: 'a' }, { utf8: ' b', tOffsetMs: 400 }] }] }
  assert.deepEqual(wordsFromJson3(j), [
    { w: 'a', s: 1, e: 1.4 },
    { w: 'b', s: 1.4, e: 1.9 },
  ])
})

test('wordsFromJson3: last word ends at its event end, capped at 1 s', () => {
  const long = { events: [{ tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'x' }] }] }
  assert.deepEqual(wordsFromJson3(long), [{ w: 'x', s: 0, e: 1 }])
  const short = { events: [{ tStartMs: 0, dDurationMs: 300, segs: [{ utf8: 'x' }] }] }
  assert.deepEqual(wordsFromJson3(short), [{ w: 'x', s: 0, e: 0.3 }])
})

test('wordsFromJson3: sorts by start, trims text, skips empty segs, tolerates junk', () => {
  const j = {
    events: [
      { tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: '  late ' }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'early' }, { utf8: ' ' }, {}] },
      { tStartMs: 3000 },
    ],
  }
  assert.deepEqual(wordsFromJson3(j), [
    { w: 'early', s: 1, e: 2 },
    { w: 'late', s: 2, e: 2.5 },
  ])
  assert.deepEqual(wordsFromJson3({}), [])
  assert.deepEqual(wordsFromJson3(null), [])
})

test('wordsFromJson3: every word has s < e, even for duplicate starts', () => {
  const j = {
    events: [
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'a' }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'b' }] },
    ],
  }
  for (const w of wordsFromJson3(j)) assert.ok(w.s < w.e, JSON.stringify(w))
})

test('wordsFromWhisper converts ms offsets, skips empty text, adds the offset', () => {
  const j = {
    transcription: [
      { offsets: { from: 0, to: 0 }, text: '' },
      { offsets: { from: 0, to: 170 }, text: ' We' },
    ],
  }
  assert.deepEqual(wordsFromWhisper(j, 600), [{ w: 'We', s: 600, e: 600.17 }])
  assert.deepEqual(wordsFromWhisper(j), [{ w: 'We', s: 0, e: 0.17 }])
})

test('wordsFromWhisper: sorted, s < e, tolerates junk', () => {
  const j = {
    transcription: [
      { offsets: { from: 500, to: 500 }, text: ' b' },
      { offsets: { from: 100, to: 400 }, text: ' a' },
    ],
  }
  const out = wordsFromWhisper(j)
  assert.deepEqual(out.map((w) => w.w), ['a', 'b'])
  for (const w of out) assert.ok(w.s < w.e)
  assert.deepEqual(wordsFromWhisper({}), [])
  assert.deepEqual(wordsFromWhisper(null), [])
})

test('wordsInRange keeps overlapping words and rebases to 0', () => {
  const words = [
    { w: 'a', s: 1, e: 2 },
    { w: 'b', s: 5, e: 6 },
    { w: 'c', s: 9.5, e: 10.5 },
    { w: 'd', s: 12, e: 13 },
  ]
  assert.deepEqual(wordsInRange(words, 5, 10), [
    { w: 'b', s: 0, e: 1 },
    { w: 'c', s: 4.5, e: 5.5 },
  ])
  assert.deepEqual(wordsInRange(words, 20, 30), [])
})

test('transcriptChunks: [mm:ss] lines, a new line every lineSec', () => {
  const words = [
    { w: 'one', s: 0, e: 0.5 },
    { w: 'two', s: 3, e: 3.5 },
    { w: 'three', s: 8, e: 8.5 },
    { w: 'four', s: 75, e: 75.5 },
  ]
  const [chunk, ...rest] = transcriptChunks(words)
  assert.equal(rest.length, 0)
  assert.equal(chunk, '## Part 1 (00:00–01:16)\n[00:00] one two\n[00:08] three\n[01:15] four')
})

test('transcriptChunks: a new chunk every chunkSec with a Part N header', () => {
  const words = [
    { w: 'a', s: 1, e: 2 },
    { w: 'b', s: 11, e: 12 },
    { w: 'c', s: 21, e: 22 },
    { w: 'd', s: 25, e: 26 },
  ]
  const out = transcriptChunks(words, { lineSec: 3, chunkSec: 10 })
  assert.equal(out.length, 3)
  assert.equal(out[0], '## Part 1 (00:00–00:10)\n[00:01] a')
  assert.equal(out[1], '## Part 2 (00:10–00:20)\n[00:11] b')
  assert.equal(out[2], '## Part 3 (00:20–00:26)\n[00:21] c\n[00:25] d')
})

test('transcriptChunks: h:mm:ss from an hour up', () => {
  const words = [{ w: 'late', s: 3725, e: 3726 }]
  const [chunk] = transcriptChunks(words)
  assert.match(chunk, /\[1:02:05\] late/)
  assert.match(chunk, /^## Part 1 \(1:00:00–1:02:06\)/)
})

test('transcriptChunks: heat v >= 0.6 marks overlapping lines with a trailing triangle', () => {
  const words = [
    { w: 'cold', s: 0, e: 1 },
    { w: 'warm', s: 8, e: 9 },
    { w: 'hot', s: 16, e: 17 },
    { w: 'edge', s: 24, e: 25 },
  ]
  const heat = [
    { s: 4, e: 7, v: 0.9 }, // between lines: no overlap
    { s: 8.5, e: 12, v: 0.59 }, // too weak
    { s: 16.5, e: 20, v: 0.6 }, // marks the third line
    { s: 25, e: 30, v: 1 }, // starts exactly where the last line ends: no overlap
  ]
  const [chunk] = transcriptChunks(words, { heat })
  const lines = chunk.split('\n').slice(1)
  assert.deepEqual(lines, ['[00:00] cold', '[00:08] warm', '[00:16] hot ▲', '[00:24] edge'])
})

test('transcriptChunks: no words gives no chunks', () => {
  assert.deepEqual(transcriptChunks([]), [])
})
