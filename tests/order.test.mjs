// The order of a run's clips, the render set and the chat summary (A5). rankClips, the bands and the chips are
// checked against boqo's own output in rank.test.mjs, score-grade.test.mjs and handbook-outcomes.test.mjs; this
// file tests what the skill builds on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameSync } from 'node:fs';
import { finalOrder, preRenderOrder, renderSet, reorderRun, selectRows, summaryLines } from '../engine/order.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'clips.mjs');

const standalone = (outcome, o = {}) => ({ v: 1, outcome, claim: 'A claim.', bridgeFromSec: null, contextLine: null, sha: null, ...o });
// A ClipRow as clips.json holds it, in the fields the order and the summary read.
const row = (n, o = {}) => ({
  n, start: n * 100, end: n * 100 + 42, title: `Clip ${n}`, title_alternatives: ['a', 'b'], hook: 'h', score: 80,
  axes: { hook: 92, flow: 81, standalone: 75, value: 66 }, emphasis_words: [], standalone: standalone('stands'),
  replay: null, judgment: null, panels: null, rendered: false, file: null, notes: [], ...o,
});
const judged = (overall) => ({ overall, why: 'Why.', annotation: {} });
const nums = (rows) => rows.map((c) => c.n);

// ---- the pre-render order

test('with no heatmap (replay null everywhere) the order is by score and no line says Replayed', () => {
  const clips = [row(1, { score: 60 }), row(2, { score: 91 }), row(3, { score: 75 }), row(4, { score: 91, start: 5 })].map((c) => ({ ...c, rendered: true }));
  assert.deepEqual(nums(preRenderOrder(clips)), [4, 2, 3, 1]); // score, then the earlier start
  const lines = summaryLines({ clips });
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => !l.includes('Replayed')), lines.join('\n'));
});

test('a fails clip with score 95 sorts after a stands clip with score 40', () => {
  const clips = [row(1, { score: 95, standalone: standalone('fails') }), row(2, { score: 40 })];
  assert.deepEqual(nums(preRenderOrder(clips)), [2, 1]);
});

test('the pre-render order holds the judgment at 3: a stored judgment does not move a clip', () => {
  const clips = [row(1, { score: 70, judgment: judged(1) }), row(2, { score: 80, judgment: judged(5) }), row(3, { score: 90, judgment: judged(1) })];
  assert.deepEqual(nums(preRenderOrder(clips)), [3, 2, 1]);
});

test('pct leads the score, and does not need a judgment', () => {
  const clips = [row(1, { score: 95, replay: { pct: 0.2, mean: 0.1 } }), row(2, { score: 50, replay: { pct: 0.9, mean: 0.8 } }), row(3, { score: 99 })];
  // a clip with no replay reads pct 0: the one at 0.9 first, then 0.2, then none
  assert.deepEqual(nums(preRenderOrder(clips)), [2, 1, 3]);
});

test('preRenderOrder returns a new array and leaves the input alone', () => {
  const clips = [row(1, { score: 10 }), row(2, { score: 90 })];
  const out = preRenderOrder(clips);
  assert.deepEqual(nums(clips), [1, 2]);
  assert.notEqual(out, clips);
});

// ---- the render set

test('the render set is the first 10 in the pre-render order, as clip numbers', () => {
  const clips = Array.from({ length: 13 }, (_, i) => row(i + 1, { score: 50 + i })); // clip 13 scores highest
  assert.deepEqual(renderSet(clips), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
  assert.deepEqual(renderSet(clips, 3), [13, 12, 11]);
  assert.deepEqual(renderSet(clips.slice(0, 4)), [4, 3, 2, 1]);
});

test('selectRows: the first 10 by default, the first K, the numbers given, all; a bad count or number is one line', () => {
  const record = { clips: Array.from({ length: 12 }, (_, i) => ({ n: 12 - i, start: i, end: i + 20 })) };
  const ns = (o) => selectRows(record, o).map((r) => r.n);
  assert.deepEqual(ns({}), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(ns({ first: '3' }), [1, 2, 3]);
  assert.deepEqual(ns({ n: '11,2,2' }), [2, 11]);
  assert.equal(ns({ all: true }).length, 12);
  assert.throws(() => selectRows(record, { n: '13' }), /no clip 13/);
  assert.throws(() => selectRows(record, { n: '1,x' }), /--n takes clip numbers/);
  assert.throws(() => selectRows(record, { first: '0' }), /--first takes a count/);
  assert.throws(() => selectRows(record, { first: '2', all: true }), /at most one/);
});

// ---- the final order

test('the final order ranks the rendered clips by their judgments, then the unrendered in the pre-render order', () => {
  const clips = [
    row(1, { score: 99 }), // unrendered, highest score
    row(2, { score: 60, rendered: true, file: 'clip-02.mp4', judgment: judged(5) }),
    row(3, { score: 90, rendered: true, file: 'clip-03.mp4', judgment: judged(1) }),
    row(4, { score: 70 }),
    row(5, { score: 85, rendered: true, file: 'clip-05.mp4', judgment: judged(3) }),
  ];
  assert.deepEqual(nums(finalOrder(clips)), [2, 5, 3, 1, 4]);
});

test('a rendered clip with no judgment yet reads 0 for it, as hosted does', () => {
  const clips = [row(1, { rendered: true, file: 'a.mp4', score: 99 }), row(2, { rendered: true, file: 'b.mp4', score: 10, judgment: judged(2) })];
  assert.deepEqual(nums(finalOrder(clips)), [2, 1]);
});

// ---- the summary

test('a line: rank, score and band, axis letters, Replayed, title, length', () => {
  const clips = [row(1, { score: 87, title: 'The bees', replay: { pct: 0.97, mean: 0.5 }, rendered: true })];
  assert.deepEqual(summaryLines({ clips }), ['1 · 87 exceptional · A B C D · Replayed · top 3% · The bees · 0:42']);
});

test('Keeps watching · N/5 is appended only when a judgment exists, after Replayed', () => {
  const base = row(1, { score: 87, title: 'The bees', replay: { pct: 0.97, mean: 0.5 }, rendered: true });
  assert.ok(!summaryLines({ clips: [base] })[0].includes('Keeps watching'));
  assert.deepEqual(summaryLines({ clips: [{ ...base, judgment: judged(4) }] }), ['1 · 87 exceptional · A B C D · Replayed · top 3% · Keeps watching · 4/5 · The bees · 0:42']);
});

test('the stand-alone chip sits after Keeps watching and before the title: Needs context and Opens on context', () => {
  const fails = row(1, { score: 70, title: 'No setup', rendered: true, judgment: judged(2), standalone: standalone('fails') });
  const bridged = row(2, { score: 70, title: 'Bridged', rendered: true, replay: { pct: 0.6, mean: 0.5 }, standalone: standalone('bridged', { bridgeFromSec: 210 }) });
  const stands = row(3, { score: 70, title: 'Stands', rendered: true });
  const context = row(4, { score: 70, title: 'Line', rendered: true, standalone: standalone('context', { contextLine: 'A line' }) });
  const lines = summaryLines({ clips: [fails, bridged, stands, context] });
  // bridged leads on pct 0.6; the others tie at 0 (stands, context) and the failing one is last
  assert.deepEqual(lines, [
    '1 · 70 strong · A B C D · Replayed · top 40% · Opens on context · Bridged · 0:42',
    '2 · 70 strong · A B C D · Stands · 0:42',
    '3 · 70 strong · A B C D · Line · 0:42', // the context line is not drawn in the skill's render, so hosted shows no chip
    '4 · 70 strong · A B C D · Keeps watching · 2/5 · Needs context · No setup · 0:42',
  ]);
});

test('the axis letters follow the four axes: 92/81/75/66 is A B C D, 60 is D, 59 is F', () => {
  const clips = [row(1, { rendered: true, axes: { hook: 92, flow: 81, standalone: 60, value: 59 } })];
  assert.match(summaryLines({ clips })[0], / · A B D F · /);
});

test('the bands: 85 exceptional, 70 strong, 60 decent, 40 watchable, 39 weak', () => {
  const lines = [85, 70, 60, 40, 39].map((score, i) => summaryLines({ clips: [row(i + 1, { score, rendered: true })] })[0]);
  assert.deepEqual(lines.map((l) => l.split(' · ')[1]), ['85 exceptional', '70 strong', '60 decent', '40 watchable', '39 weak']);
});

test('the length is m:ss and the lines come in the final order, with the rank as the place in it', () => {
  const clips = [row(1, { score: 50, end: 100 + 75, start: 100, rendered: true }), row(2, { score: 90, rendered: true })];
  const lines = summaryLines({ clips });
  assert.ok(lines[0].startsWith('1 · 90 '), lines[0]);
  assert.ok(lines[0].endsWith(' · 0:42'));
  assert.ok(lines[1].startsWith('2 · 50 ') && lines[1].endsWith(' · 1:15'), lines[1]);
});

test('the last line reads +N not rendered when unrendered clips exist, and only then', () => {
  const some = [row(1, { rendered: true }), row(2), row(3)];
  const lines = summaryLines({ clips: some });
  assert.equal(lines.length, 2);
  assert.equal(lines.at(-1), '+2 not rendered');
  assert.ok(!summaryLines({ clips: [row(1, { rendered: true })] }).some((l) => l.includes('not rendered')));
  assert.deepEqual(summaryLines({ clips: [row(1), row(2)] }), ['+2 not rendered']);
});

// ---- clips order

function runDir(clips, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clips-order-'));
  writeFileSync(join(dir, 'clips.json'), JSON.stringify({ version: 1, video: {}, target: 3, cap: 4, clips }, null, 2));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const order = (dir) => {
  const r = spawnSync(process.execPath, [TOOL, 'order', '--run', dir], { encoding: 'utf8' });
  return { code: r.status, out: JSON.parse(r.stdout) };
};
const record = (dir) => JSON.parse(readFileSync(join(dir, 'clips.json'), 'utf8'));
const files = (dir) => readdirSync(dir).filter((f) => f !== 'clips.json').sort();

test('order: a rendered clip-03.mp4 that moves to first becomes clip-01.mp4, and its thumbnail follows', () => {
  const dir = runDir(
    [
      row(1, { score: 50 }),
      row(2, { score: 60 }),
      row(3, { score: 70, rendered: true, file: 'clip-03.mp4', judgment: judged(4) }),
    ],
    { 'clip-03.mp4': 'video three', 'clip-03.jpg': 'thumb three' },
  );
  try {
    const r = order(dir);
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, { ok: true, clips: 3, rendered: 1, renamed: 2 });
    assert.deepEqual(files(dir), ['clip-01.jpg', 'clip-01.mp4']);
    assert.equal(readFileSync(join(dir, 'clip-01.mp4'), 'utf8'), 'video three');
    assert.equal(readFileSync(join(dir, 'clip-01.jpg'), 'utf8'), 'thumb three');
    const rec = record(dir);
    assert.deepEqual(nums(rec.clips), [1, 2, 3]);
    assert.equal(rec.clips[0].title, 'Clip 3');
    assert.equal(rec.clips[0].file, 'clip-01.mp4');
    assert.deepEqual(rec.clips.map((c) => c.title), ['Clip 3', 'Clip 2', 'Clip 1']); // then unrendered, by score
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order: two clips that swap keep every file (temporary names), thumbnails included', () => {
  const dir = runDir(
    [
      row(1, { score: 50, rendered: true, file: 'clip-01.mp4', judgment: judged(1) }),
      row(2, { score: 50, rendered: true, file: 'clip-02.mp4', judgment: judged(5) }),
    ],
    { 'clip-01.mp4': 'one', 'clip-02.mp4': 'two', 'clip-01.jpg': 'one thumb', 'clip-02.jpg': 'two thumb' },
  );
  try {
    assert.equal(order(dir).code, 0);
    assert.deepEqual(files(dir), ['clip-01.jpg', 'clip-01.mp4', 'clip-02.jpg', 'clip-02.mp4']);
    assert.equal(readFileSync(join(dir, 'clip-01.mp4'), 'utf8'), 'two');
    assert.equal(readFileSync(join(dir, 'clip-02.mp4'), 'utf8'), 'one');
    assert.equal(readFileSync(join(dir, 'clip-01.jpg'), 'utf8'), 'two thumb');
    assert.equal(readFileSync(join(dir, 'clip-02.jpg'), 'utf8'), 'one thumb');
    const rec = record(dir);
    assert.deepEqual(rec.clips.map((c) => [c.n, c.title, c.file]), [[1, 'Clip 2', 'clip-01.mp4'], [2, 'Clip 1', 'clip-02.mp4']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order: a three-way rotation and a file kept in a sub folder', () => {
  const dir = runDir(
    [1, 2, 3].map((n) => row(n, { score: 50, rendered: true, file: `clips/clip-0${n}.mp4`, judgment: judged([3, 1, 5][n - 1]) })),
  );
  try {
    mkdirSync(join(dir, 'clips'));
    for (const n of [1, 2, 3]) writeFileSync(join(dir, 'clips', `clip-0${n}.mp4`), `v${n}`);
    assert.equal(order(dir).code, 0);
    assert.deepEqual(readdirSync(join(dir, 'clips')).sort(), ['clip-01.mp4', 'clip-02.mp4', 'clip-03.mp4']);
    // judgments 5, 3, 1 -> old 3 first, old 1 second, old 2 third
    assert.deepEqual(['01', '02', '03'].map((k) => readFileSync(join(dir, 'clips', `clip-${k}.mp4`), 'utf8')), ['v3', 'v1', 'v2']);
    assert.deepEqual(record(dir).clips.map((c) => c.file), ['clips/clip-01.mp4', 'clips/clip-02.mp4', 'clips/clip-03.mp4']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order before any render only renumbers: n follows the pre-render order and nothing is renamed', () => {
  const dir = runDir([row(1, { score: 40 }), row(2, { score: 95 }), row(3, { score: 70, standalone: standalone('fails') })]);
  try {
    const r = order(dir);
    assert.deepEqual(r.out, { ok: true, clips: 3, rendered: 0, renamed: 0 });
    assert.deepEqual(record(dir).clips.map((c) => c.title), ['Clip 2', 'Clip 1', 'Clip 3']);
    assert.deepEqual(nums(record(dir).clips), [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order is idempotent', () => {
  const dir = runDir([row(1, { score: 50, rendered: true, file: 'clip-01.mp4', judgment: judged(2) }), row(2, { score: 60, rendered: true, file: 'clip-02.mp4', judgment: judged(4) })], { 'clip-01.mp4': 'a', 'clip-02.mp4': 'b' });
  try {
    order(dir);
    const once = readFileSync(join(dir, 'clips.json'), 'utf8');
    const second = order(dir);
    assert.deepEqual(second.out, { ok: true, clips: 2, rendered: 2, renamed: 0 });
    assert.equal(readFileSync(join(dir, 'clips.json'), 'utf8'), once);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order refuses, touching nothing, when a rendered file is missing or a target would overwrite a stranger', () => {
  const missing = runDir([row(1, { score: 50, rendered: true, file: 'clip-01.mp4' }), row(2, { score: 60, rendered: true, file: 'clip-02.mp4' })], { 'clip-01.mp4': 'a' });
  const stray = runDir([row(1, { score: 50, rendered: true, file: 'clip-05.mp4', judgment: judged(5) })], { 'clip-05.mp4': 'a', 'clip-01.mp4': 'not a clip of this record' });
  try {
    const before = readFileSync(join(missing, 'clips.json'), 'utf8');
    const m = order(missing);
    assert.equal(m.code, 1);
    assert.equal(m.out.ok, false);
    assert.match(m.out.errors[0], /clip 2: clip-02\.mp4 is not there/);
    assert.equal(readFileSync(join(missing, 'clips.json'), 'utf8'), before);
    assert.deepEqual(files(missing), ['clip-01.mp4']);

    const s = order(stray);
    assert.equal(s.code, 1);
    assert.match(s.out.errors[0], /clip-01\.mp4 is already there/);
    assert.deepEqual(files(stray), ['clip-01.mp4', 'clip-05.mp4']);
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(stray, { recursive: true, force: true });
  }
});

test('order and summary: usage and a missing clips.json are errors, not crashes', () => {
  const none = spawnSync(process.execPath, [TOOL, 'nope'], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  const dir = mkdtempSync(join(tmpdir(), 'clips-order-'));
  try {
    for (const cmd of ['order', 'summary']) {
      const r = spawnSync(process.execPath, [TOOL, cmd, '--run', dir], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(JSON.parse(r.stdout).errors[0], /cannot read clips\.json/);
    }
    assert.equal(existsSync(join(dir, 'clips.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summary prints the lines, one each', () => {
  const dir = runDir([row(1, { score: 87, title: 'The bees', replay: { pct: 0.97, mean: 0.5 }, rendered: true, file: 'clip-01.mp4' }), row(2)]);
  try {
    const r = spawnSync(process.execPath, [TOOL, 'summary', '--run', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '1 · 87 exceptional · A B C D · Replayed · top 3% · The bees · 0:42\n+1 not rendered\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- a crash in the middle of the renames

// Two clips that swap, each with a thumbnail: 4 moves. The journal is written, the files go out of the way, the journal
// moves to phase 2, the files go into place, clips.json is replaced, the journal is removed: 11 renames and one removal.
const swapRun = () =>
  runDir(
    [
      row(1, { score: 50, rendered: true, file: 'clip-01.mp4', judgment: judged(1) }),
      row(2, { score: 50, rendered: true, file: 'clip-02.mp4', judgment: judged(5) }),
    ],
    { 'clip-01.mp4': 'one', 'clip-02.mp4': 'two', 'clip-01.jpg': 'one thumb', 'clip-02.jpg': 'two thumb' },
  );
// A rename (and a removal) that throws on its k-th call, as a crash would stop the process there; 0 never throws.
const crashAt = (k, { counter = { calls: 0, rms: 0 }, rmAt = 0 } = {}) => ({
  counter,
  rename: (from, to) => {
    if (++counter.calls === k) throw new Error('simulated crash');
    renameSync(from, to);
  },
  rm: (p) => {
    if (++counter.rms === rmAt) throw new Error('simulated crash');
    rmSync(p, { force: true });
  },
});
const crashed = (dir, k, rmAt = 0) => assert.throws(() => reorderRun(dir, crashAt(k, { rmAt })), /simulated crash/, `crash at ${rmAt ? `rm ${rmAt}` : `rename ${k}`}`);
// What a finished swap looks like: every file present under its final name, nothing else, the record in the new order.
function assertSwapped(dir, where) {
  assert.deepEqual(files(dir), ['clip-01.jpg', 'clip-01.mp4', 'clip-02.jpg', 'clip-02.mp4'], `${where}: no temp file or journal left`);
  assert.equal(readFileSync(join(dir, 'clip-01.mp4'), 'utf8'), 'two', where);
  assert.equal(readFileSync(join(dir, 'clip-02.mp4'), 'utf8'), 'one', where);
  assert.equal(readFileSync(join(dir, 'clip-01.jpg'), 'utf8'), 'two thumb', where);
  assert.equal(readFileSync(join(dir, 'clip-02.jpg'), 'utf8'), 'one thumb', where);
  assert.deepEqual(record(dir).clips.map((c) => [c.n, c.title, c.file, c.judgment.overall]), [[1, 'Clip 2', 'clip-01.mp4', 5], [2, 'Clip 1', 'clip-02.mp4', 1]], where);
}
const RENAMES = 11;

test('order: the renames of a swap are 11 and one removal (the crash tests below cover every one)', () => {
  const dir = swapRun();
  try {
    const probe = crashAt(0);
    assert.equal(reorderRun(dir, probe).ok, true);
    assert.deepEqual(probe.counter, { calls: RENAMES, rms: 1 });
    assertSwapped(dir, 'no crash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order: a crash at any rename is finished by the next run, every file present and every clip under its own name', () => {
  for (let k = 1; k <= RENAMES; k++) {
    const dir = swapRun();
    try {
      crashed(dir, k);
      // a file that is mid-move waits under its own name
      for (const f of files(dir)) if (f.startsWith('.order-tmp.') && f !== '.order-tmp.journal.json') assert.match(f, /^\.order-tmp\.clip-0[12]\.(mp4|jpg)$/);
      const r = order(dir);
      assert.equal(r.code, 0, `rerun after a crash at rename ${k}: ${JSON.stringify(r.out)}`);
      assertSwapped(dir, `rerun after a crash at rename ${k}`);
      assert.equal(order(dir).out.renamed, 0); // and a further run changes nothing
      assertSwapped(dir, `second rerun after a crash at rename ${k}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('order (case A): a crash after clips.json was replaced and before the journal was removed leaves the run as it should be', () => {
  const dir = swapRun();
  try {
    crashed(dir, 0, 1); // every rename done, the removal of the journal throws
    assert.ok(files(dir).includes('.order-tmp.journal.json'));
    assert.deepEqual(record(dir).clips.map((c) => c.title), ['Clip 2', 'Clip 1']); // the new record is already in place
    assert.equal(order(dir).code, 0);
    assertSwapped(dir, 'rerun after the journal removal crashed'); // clip 1 is not relabelled by a replay
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order (case E): a crash inside the recovery, at every rename and at the removal, is finished by the run after it', () => {
  for (let k = 1; k <= RENAMES; k++) {
    for (let j = 1; j <= RENAMES + 1; j++) {
      const dir = swapRun();
      try {
        crashed(dir, k);
        // the recovery itself crashes at its j-th rename (j past its last rename: at the removal of the journal)
        const second = crashAt(j <= RENAMES ? j : 0, { rmAt: j <= RENAMES ? 0 : 1 });
        try {
          reorderRun(dir, second);
        } catch (err) {
          assert.match(err.message, /simulated crash/);
        }
        assert.equal(order(dir).code, 0, `crash at ${k}, then at ${j}`);
        assertSwapped(dir, `crash at ${k}, then at ${j}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});

test('order: a truncated, an empty or an unparseable journal is treated as absent: the files in temp names go back by name, then the order completes', () => {
  for (const garbage of ['{"phase":2,"mov', '', 'not json', '{"phase":3}', 'null']) {
    const dir = swapRun();
    try {
      crashed(dir, 3); // the journal is written; one video is out of the way
      assert.ok(files(dir).includes('.order-tmp.clip-02.mp4'));
      writeFileSync(join(dir, '.order-tmp.journal.json'), garbage);
      const r = order(dir);
      assert.equal(r.code, 0, `journal ${JSON.stringify(garbage)}: ${JSON.stringify(r.out)}`);
      assertSwapped(dir, `journal ${JSON.stringify(garbage)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('order: a leftover temp file whose original name is held by a different file is refused, touching nothing', () => {
  const dir = runDir([row(1, { score: 50, rendered: true, file: 'clip-01.mp4' })], { 'clip-01.mp4': 'current', '.order-tmp.clip-01.mp4': 'stranded' });
  try {
    const r = order(dir);
    assert.equal(r.code, 1);
    assert.match(r.out.errors[0], /clip-01\.mp4 is already there/);
    assert.equal(readFileSync(join(dir, 'clip-01.mp4'), 'utf8'), 'current');
    assert.equal(readFileSync(join(dir, '.order-tmp.clip-01.mp4'), 'utf8'), 'stranded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('order: a journal whose target is held by a file that is not ours is refused and left for the person', () => {
  const dir = swapRun();
  try {
    crashed(dir, 7); // phase 2 has begun and a file is placed
    const stray = files(dir).find((f) => f.startsWith('.order-tmp.clip-') && f !== '.order-tmp.journal.json');
    assert.ok(stray, files(dir).join(','));
    const target = JSON.parse(readFileSync(join(dir, '.order-tmp.journal.json'), 'utf8')).moves.find((m) => m.tmp.endsWith(stray)).to;
    writeFileSync(target, 'someone else'); // the name the stranded file was to take
    const r = order(dir);
    assert.equal(r.code, 1);
    assert.match(r.out.errors[0], /is already there/);
    assert.equal(readFileSync(target, 'utf8'), 'someone else');
    assert.ok(files(dir).includes(stray));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
