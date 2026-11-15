import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  wordsFromJson3,
  wordsFromWhisper,
  wordsInRange,
  wordsAround,
  findPhrase,
  transcriptChunks,
  transcriptMarkdown,
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

test('wordsFromJson3: a speaker mark alone is dropped, in every spelling', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'before' }] },
      { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: '>>' }, { utf8: ' >>', tOffsetMs: 100 }, { utf8: '>', tOffsetMs: 150 }, { utf8: ' &gt;&gt;', tOffsetMs: 200 }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'after' }] },
    ],
  }
  // the word before a mark ends where the next kept word starts, not at the mark
  assert.deepEqual(wordsFromJson3(j), [
    { w: 'before', s: 0, e: 1 },
    { w: 'after', s: 1, e: 1.5 },
  ])
})

test('wordsFromJson3: a leading speaker mark is stripped, one inside a word is not', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '>>I' }, { utf8: ' &gt;&gt;think', tOffsetMs: 300 }, { utf8: ' a>>b', tOffsetMs: 600 }, { utf8: ' x>', tOffsetMs: 900 }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j).map((x) => x.w), ['I', 'think', 'a>>b', 'x>'])
})

test('wordsFromJson3: a speaker dash at the start of an event is stripped or dropped', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '- Yeah' }] },
      { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: '-' }, { utf8: ' No', tOffsetMs: 100 }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: '>>' }, { utf8: ' - Okay', tOffsetMs: 100 }] },
      { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: 'so' }, { utf8: ' -', tOffsetMs: 100 }, { utf8: ' it', tOffsetMs: 200 }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j).map((x) => x.w), ['Yeah', 'No', 'Okay', 'so', 'it'])
})

test('wordsFromJson3: real hyphens and negative numbers are kept', () => {
  const j = {
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'well-known' }, { utf8: ' -5', tOffsetMs: 300 }, { utf8: ' -ish', tOffsetMs: 600 }, { utf8: ' a-', tOffsetMs: 900 }] },
      { tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: '-5' }] },
    ],
  }
  assert.deepEqual(wordsFromJson3(j).map((x) => x.w), ['well-known', '-5', '-ish', 'a-', '-5'])
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

test('transcriptMarkdown joins chunks with a blank line and ends with a newline', () => {
  const words = [
    { w: 'one', s: 0, e: 0.5 },
    { w: 'two', s: 3, e: 3.5 },
    { w: 'late', s: 1000, e: 1000.5 },
  ]
  const opts = { chunkSec: 900 }
  const out = transcriptMarkdown(words, opts)
  const chunks = transcriptChunks(words, opts)
  assert.equal(out.chunks, 2)
  assert.equal(out.text, chunks.join('\n\n') + '\n')
  assert.deepEqual(transcriptMarkdown([]), { text: '', chunks: 0 })
})

const W = (w, s, e) => ({ w, s, e });

test('wordsAround: lines of "[m:ss] text (s-e)" for the words overlapping [around - span, around + span]', () => {
  const words = [W('far', 1, 1.4), W('Hello', 59, 59.4), W('there.', 60, 60.52), W('Next', 61.2, 61.5), W('gone', 200, 200.4)];
  const r = wordsAround(words, 60, 10);
  assert.deepEqual(r, {
    lines: ['[0:59] Hello there. (59.00-60.52)', '[1:01] Next (61.20-61.50)'],
    from: 50,
    to: 70,
  });
})

test('wordsAround: from clamps at 0, span defaults to 30, to is not clamped', () => {
  const r = wordsAround([W('a', 0, 0.5), W('b', 29, 29.5), W('c', 31, 31.5)], 5);
  assert.equal(r.from, 0)
  assert.equal(r.to, 35)
  assert.deepEqual(r.lines, ['[0:00] a (0.00-0.50)', '[0:29] b (29.00-29.50)', '[0:31] c (31.00-31.50)'])
})

test('wordsAround: a word straddling an edge is kept; one wholly outside is not', () => {
  const words = [W('in', 48, 50.5), W('out', 40, 49.9), W('also', 69.9, 71), W('no', 70, 71)];
  const r = wordsAround(words, 60, 10);
  assert.match(r.lines.join(' '), /in/)
  assert.match(r.lines.join(' '), /also/)
  assert.doesNotMatch(r.lines.join(' '), /out|no /)
})

test('wordsAround groups like the sniper tool: sentence end, a pause over 0.7 s, or 8 s closes a line', () => {
  const words = [
    W('one', 10, 10.3), W('two.', 10.4, 10.8), W('three', 11, 11.3),
    W('four', 12.5, 12.8), W('five', 12.9, 13.2),
    ...Array.from({ length: 12 }, (_, i) => W(`w${i}`, 20 + i, 20.5 + i)),
  ];
  const r = wordsAround(words, 15, 30);
  assert.equal(r.lines[0], '[0:10] one two. (10.00-10.80)')
  assert.equal(r.lines[1], '[0:11] three (11.00-11.30)')
  assert.equal(r.lines[2], '[0:12] four five (12.50-13.20)')
  assert.match(r.lines[3], /^\[0:20\] w0 w1 w2 w3 w4 w5 w6 w7 \(20\.00-27\.50\)$/)
  assert.match(r.lines[4], /^\[0:28\] w8 w9 w10 w11 \(28\.00-31\.50\)$/)
})

test('wordsAround: unsorted input, blank and malformed words are tolerated; nothing near gives no lines', () => {
  const words = [W('b', 11, 11.4), W('  ', 10.5, 10.6), { w: 'x', s: 'n', e: 1 }, null, W('a', 10, 10.4)];
  assert.deepEqual(wordsAround(words, 10, 5).lines, ['[0:10] a b (10.00-11.40)'])
  assert.deepEqual(wordsAround(words, 500, 5), { lines: [], from: 495, to: 505 })
})

test('wordsAround: minutes keep counting past an hour', () => {
  const r = wordsAround([W('late', 3725, 3725.5)], 3725, 5)
  assert.equal(r.lines[0], '[62:05] late (3725.00-3725.50)')
})

// A YouTube auto-caption line: tokens bunched at its start, 0.1 s apart.
const LINE = [
  W('And', 259.994, 260.094), W('what', 260.094, 260.194), W('we', 260.194, 260.294),
  W('like', 260.294, 260.394), W('to', 260.394, 260.494), W('say', 260.494, 260.594),
  W('around', 260.594, 260.694), W('here', 260.694, 261.2), W('is', 262.5, 262.7),
  W('ship', 262.7, 263.0), W('it.', 263.0, 263.4),
];

test('findPhrase: an exact phrase gives its first word start and last word end', () => {
  assert.deepEqual(findPhrase(LINE, 'what we like to say', 262, 60), {
    s: 260.094, e: 260.594, match: 'what we like to say', score: 1,
  })
  assert.deepEqual(findPhrase(LINE, 'is ship it', 262, 60), { s: 262.5, e: 263.4, match: 'is ship it.', score: 1 })
})

test('findPhrase ignores case, punctuation and the kind of apostrophe; match is the words as written', () => {
  const words = [W('So,', 10, 10.2), W('Don’t', 10.2, 10.5), W('STOP.', 10.5, 10.9), W('"Ever"', 11, 11.3), W('well-known', 11.3, 11.8)]
  assert.deepEqual(findPhrase(words, "don't stop ever", 10, 60), { s: 10.2, e: 11.3, match: 'Don’t STOP. "Ever"', score: 1 })
  assert.deepEqual(findPhrase(words, 'Ever, well-known!', 10, 60), { s: 11, e: 11.8, match: '"Ever" well-known', score: 1 })
  // punctuation inside a word is dropped, not split on: Q&A is QA, 5.5 is 55
  const caps = [W('uh', 20, 20.2), W('QA', 20.2, 20.5), W('on', 20.5, 20.7), W('Opus', 20.7, 21), W('55', 21, 21.4)]
  assert.deepEqual(findPhrase(caps, 'Q&A on Opus 5.5', 20, 60), { s: 20.2, e: 21.4, match: 'QA on Opus 55', score: 1 })
})

test('findPhrase: one misspelt word (auto-caption spelling) still matches, scored under 1', () => {
  const words = [W('Justin', 30, 30.3), W('Shroder', 30.3, 30.8), W('from', 30.8, 31), W('Standard', 31, 31.5), W('Agents', 31.5, 32)]
  const r = findPhrase(words, 'Justin Schroeder from Standard', 31, 60)
  assert.equal(r.s, 30)
  assert.equal(r.e, 31.5)
  assert.equal(r.match, 'Justin Shroder from Standard')
  assert.ok(r.score >= 0.6 && r.score < 1, String(r.score))
  // a wholly different word in four is still a match; in two it is not
  const other = findPhrase(LINE, 'what we love to', 262, 60)
  assert.equal(other.s, 260.094)
  assert.equal(other.e, 260.494)
  assert.ok(other.score >= 0.6 && other.score < 1)
  assert.equal(findPhrase(LINE, 'we hate', 262, 60), null)
})

test('findPhrase: a caption word the quote leaves out is taken in, never cut', () => {
  const words = [W('what', 50, 50.2), W('uh', 50.2, 50.4), W('we', 50.4, 50.6), W('like', 50.6, 50.8), W('to', 50.8, 51), W('do', 51, 51.3)]
  const r = findPhrase(words, 'what we like to', 50, 60)
  assert.equal(r.s, 50)
  assert.equal(r.e, 51)
  assert.equal(r.match, 'what uh we like to')
})

test('findPhrase: a caption word before the first quoted word is not taken in; one in its place is', () => {
  const words = [W('uh', 70, 70.2), W('what', 70.2, 70.4), W('we', 70.4, 70.6), W('like', 70.6, 70.8), W('to', 70.8, 71)]
  // "really" is not in the captions: the window still opens on "what", not "uh"
  const r = findPhrase(words, 'what we really like', 70.5, 60)
  assert.equal(r.s, 70.2)
  assert.equal(r.match, 'what we like')
  // "so" is not in the captions, and "uh" stands where it would be: taken in
  const sub = findPhrase(words, 'so what we like', 70.5, 60)
  assert.equal(sub.s, 70)
  assert.equal(sub.match, 'uh what we like')
  // the same at the end: "to" stands in for "eat", but nothing past it is taken
  const end = findPhrase([...words, W('ok', 71, 71.2)], 'we like eat', 70.5, 60)
  assert.equal(end.e, 71)
  assert.equal(end.match, 'we like to')
})

test('findPhrase: two occurrences give the one closest to near', () => {
  const words = [
    W('you', 100, 100.2), W('know', 100.2, 100.4), W('what', 100.4, 100.6), W('filler', 101, 101.5),
    W('you', 140, 140.2), W('know', 140.2, 140.4), W('what', 140.4, 140.6),
  ]
  assert.equal(findPhrase(words, 'you know what', 130, 60).s, 140)
  assert.equal(findPhrase(words, 'you know what', 112, 60).s, 100)
  // an exact match beats a closer near-miss
  const near = [...words, W('you', 129, 129.2), W('knew', 129.2, 129.4), W('that', 129.4, 129.6)]
  assert.equal(findPhrase(near, 'you know what', 129, 60).s, 140)
})

test('findPhrase searches only [near - span, near + span], from clamped at 0', () => {
  const words = [W('opening', 0.5, 0.9), W('words', 0.9, 1.2), W('far', 300, 300.3), W('away', 300.3, 300.6)]
  assert.equal(findPhrase(words, 'opening words', 10, 60).s, 0.5)
  assert.equal(findPhrase(words, 'far away', 100, 60), null)
  assert.equal(findPhrase(words, 'far away', 100, 250).s, 300)
  assert.equal(findPhrase(words, 'purple elephant', 10, 60), null)
})

test('findPhrase: unsorted, blank, punctuation-only and malformed words are tolerated', () => {
  const words = [W('ship', 262.7, 263.0), W('-', 262.6, 262.65), null, { w: 'x', s: 'n', e: 1 }, W('  ', 262.65, 262.69), W('is', 262.5, 262.6), W('it.', 263.0, 263.4)]
  assert.deepEqual(findPhrase(words, 'is ship it', 262, 60), { s: 262.5, e: 263.4, match: 'is ship it.', score: 1 })
})

test('findPhrase: a phrase with no words throws', () => {
  assert.throws(() => findPhrase(LINE, ' ... ', 262, 60), /no words/)
})
