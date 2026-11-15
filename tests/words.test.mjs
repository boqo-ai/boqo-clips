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

test('wordsFromJson3 drops caption sound tags, whole and split across segs', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '[Music]' }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '[Applause]' }, { utf8: ' [Laughter]', tOffsetMs: 300 }] },
      { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '(upbeat' }, { utf8: ' music)', tOffsetMs: 200 }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: '[' }, { utf8: 'Music', tOffsetMs: 100 }, { utf8: ']', tOffsetMs: 200 }] },
      { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: '\u266a' }] },
      { tStartMs: 5000, dDurationMs: 600, segs: [{ utf8: 'Hello' }, { utf8: ' [word]s', tOffsetMs: 300 }, { utf8: ' (yes) no', tOffsetMs: 450 }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j), [
    { w: 'Hello', s: 5, e: 5.3 },
    { w: '[word]s', s: 5.3, e: 5.45 },
    { w: '(yes) no', s: 5.45, e: 5.6 },
  ])
})

test('wordsFromJson3: a tag-only track gives no words', () => {
  const j = { events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '[Music]' }] }] }
  assert.deepEqual(wordsFromJson3(j), [])
})

test('wordsFromJson3: speech then a tag then speech keeps both sides', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'before' }] },
      { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: '[Music]' }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'after' }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j).map((x) => x.w), ['before', 'after'])
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

test("wordsFromWhisper drops whisper's non-speech markers", () => {
  const item = (text, i) => ({ offsets: { from: i * 100, to: i * 100 + 90 }, text })
  const j = {
    transcription: [
      item(' [_BEG_]', 0),
      item(' [BLANK_AUDIO]', 1),
      item(' [Music]', 2),
      item(' (music)', 3),
      item(' (laughs)', 4),
      item(' [ Silence ]', 5),
      item(' \u266a', 6),
      item(' \u266a\u266a ', 7),
      item(' Hello', 8),
      item(' [word]s', 9),
      item(' (yes) no', 10),
    ],
  }
  assert.deepEqual(
    wordsFromWhisper(j).map((x) => x.w),
    ['Hello', '[word]s', '(yes) no'],
  )
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
    { w: 'c', s: 4.5, e: 5 },
  ])
  assert.deepEqual(wordsInRange(words, 20, 30), [])
})

test('wordsInRange clamps words that straddle either edge into [0, e - s]', () => {
  const words = [
    { w: 'in', s: 4.5, e: 5.5 }, // starts before the range
    { w: 'out', s: 9.5, e: 10.8 }, // ends after the range
    { w: 'wide', s: 4, e: 11 }, // straddles both
  ]
  assert.deepEqual(wordsInRange(words, 5, 10), [
    { w: 'in', s: 0, e: 0.5 },
    { w: 'out', s: 4.5, e: 5 },
    { w: 'wide', s: 0, e: 5 },
  ])
  for (const x of wordsInRange(words, 5, 10)) assert.ok(x.s >= 0 && x.s < x.e && x.e <= 5, JSON.stringify(x))
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

const wItems = (texts, step = 100) =>
  texts.map((text, i) => ({ offsets: { from: i * step, to: i * step + step - 10 }, text }))

test('wordsFromWhisper drops a sound tag split across items', () => {
  const j = { transcription: wItems([' Hi', ' (upbeat', ' music)', ' there', ' [Music', ']', ' ok', ' (keyboard', ' clicking).', ' end']) }
  assert.deepEqual(
    wordsFromWhisper(j).map((x) => x.w),
    ['Hi', 'there', 'ok', 'end'],
  )
})

test('wordsFromWhisper drops a split tag whose closer is the last item, and a split music span', () => {
  const j = { transcription: wItems([' a', ' (soft', ' gentle', ' music)', ' ♪', ' la']) }
  assert.deepEqual(wordsFromWhisper(j).map((x) => x.w), ['a', 'la'])
  const k = { transcription: wItems([' x', ' [Music', ']']) }
  assert.deepEqual(wordsFromWhisper(k).map((x) => x.w), ['x'])
})

test('wordsFromWhisper drops an item holding several markers and the double note', () => {
  const j = { transcription: wItems([' [Music] [Applause]', ' (laughs) (cheers)', ' ♬', ' Hello']) }
  assert.deepEqual(wordsFromWhisper(j).map((x) => x.w), ['Hello'])
})

test('wordsFromWhisper keeps an unmatched opening bracket in real speech', () => {
  const j = { transcription: wItems([' (really', ' this', ' is', ' normal', ' speech', ' with', ' no', ' closer']) }
  assert.deepEqual(
    wordsFromWhisper(j).map((x) => x.w),
    ['(really', 'this', 'is', 'normal', 'speech', 'with', 'no', 'closer'],
  )
  // the closer is 6 items away: too far, so nothing is dropped
  const k = { transcription: wItems([' [oh', ' a', ' b', ' c', ' d', ' e', ' f]', ' g']) }
  assert.equal(wordsFromWhisper(k).length, 8)
  // exactly 6 items is still a tag
  const m = { transcription: wItems([' [oh', ' a', ' b', ' c', ' d', ' e]', ' g']) }
  assert.deepEqual(wordsFromWhisper(m).map((x) => x.w), ['g'])
})

test('wordsFromWhisper spreads words stacked on one timestamp', () => {
  const at = (ms, text) => ({ offsets: { from: ms, to: ms + 10 }, text })
  const j = { transcription: [at(1000, ' Hey'), at(1000, ' bro'), at(1000, ' it'), at(1500, ' is')] }
  const out = wordsFromWhisper(j)
  assert.deepEqual(out.map((x) => x.w), ['Hey', 'bro', 'it', 'is'])
  assert.deepEqual(out.map((x) => x.s), [1, 1.167, 1.333, 1.5])
  assert.deepEqual(out.slice(0, 3).map((x) => x.e), [1.167, 1.333, 1.5])
  assert.deepEqual(out[3], { w: 'is', s: 1.5, e: 1.51 })
  for (let i = 0; i < out.length; i++) {
    assert.ok(out[i].s < out[i].e)
    if (i) assert.ok(out[i].s > out[i - 1].s)
  }
})

test('wordsFromWhisper: a stacked run is capped at 0.35 s a word and may end the list', () => {
  const at = (ms, text) => ({ offsets: { from: ms, to: ms + 10 }, text })
  const far = { transcription: [at(2000, ' a'), at(2010, ' b'), at(9000, ' c')] }
  assert.deepEqual(wordsFromWhisper(far), [
    { w: 'a', s: 2, e: 2.35 },
    { w: 'b', s: 2.35, e: 2.7 },
    { w: 'c', s: 9, e: 9.01 },
  ])
  const last = { transcription: [at(500, ' x'), at(500, ' y')] }
  assert.deepEqual(wordsFromWhisper(last), [
    { w: 'x', s: 0.5, e: 0.505 },
    { w: 'y', s: 0.505, e: 0.51 },
  ])
})

test('wordsFromWhisper leaves words that are not stacked alone', () => {
  const j = { transcription: wItems([' one', ' two', ' three', ' four']) }
  assert.deepEqual(wordsFromWhisper(j), [
    { w: 'one', s: 0, e: 0.09 },
    { w: 'two', s: 0.1, e: 0.19 },
    { w: 'three', s: 0.2, e: 0.29 },
    { w: 'four', s: 0.3, e: 0.39 },
  ])
})

test('wordsFromWhisper: a stacked run never passes the next word, even when its last end does', () => {
  const j = {
    transcription: [
      { offsets: { from: 1000, to: 1010 }, text: ' a' },
      { offsets: { from: 1000, to: 1010 }, text: ' b' },
      { offsets: { from: 1000, to: 1400 }, text: ' c' },
      { offsets: { from: 1100, to: 1200 }, text: ' d' },
    ],
  }
  const out = wordsFromWhisper(j)
  assert.deepEqual(out.map((x) => x.w), ['a', 'b', 'c', 'd'])
  assert.deepEqual(out.map((x) => x.s), [1, 1.033, 1.067, 1.1])
  assert.deepEqual(out.slice(0, 3).map((x) => x.e), [1.033, 1.067, 1.1])
  for (let i = 0; i < out.length; i++) {
    assert.ok(out[i].s < out[i].e, JSON.stringify(out[i]))
    if (i) {
      assert.ok(out[i].s > out[i - 1].s)
      assert.ok(out[i].s >= out[i - 1].e, `overlap at ${i}`)
    }
  }
})

test('wordsFromWhisper: a tight gap keeps starts strictly increasing and below the next word', () => {
  const at = (ms, text) => ({ offsets: { from: ms, to: ms + 10 }, text })
  const j = { transcription: [at(1000, ' a'), at(1030, ' b'), at(1030, ' c'), at(1031, ' d')] }
  const out = wordsFromWhisper(j)
  assert.deepEqual(out.map((x) => x.w), ['a', 'b', 'c', 'd'])
  assert.deepEqual(out.map((x) => x.s), [1, 1.029, 1.03, 1.031])
  for (let i = 0; i < out.length; i++) {
    assert.ok(out[i].s < out[i].e, JSON.stringify(out[i]))
    if (i) assert.ok(out[i].s > out[i - 1].s && out[i].s >= out[i - 1].e)
  }
})
