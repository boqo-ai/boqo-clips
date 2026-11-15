import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPicks, snapPick, SNAP_MAX_SEC } from '../engine/picks.mjs';

const CLI = fileURLToPath(new URL('../tools/picks-check.mjs', import.meta.url));
const good = (s, e, title = 'A moment') => ({ s, e, title });

test('checkPicks accepts good picks', () => {
  assert.deepEqual(checkPicks([good(10, 40), good(100, 130)], { duration: 600 }), { ok: true, errors: [] });
});

test('checkPicks rejects a pick outside the video', () => {
  const r = checkPicks([good(-2, 30), good(580, 610)], { duration: 600 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    'pick 1 starts before 0 s',
    'pick 2 ends at 610 s, past the video end at 600 s',
  ]);
});

test('checkPicks rejects a pick under the minimum or over the maximum', () => {
  const r = checkPicks([good(10, 19.5), good(100, 200)], { duration: 600 });
  assert.deepEqual(r.errors, [
    'pick 1 is 9.5 s, under the 15 s minimum',
    'pick 2 is 100 s, over the 90 s maximum',
  ]);
  const custom = checkPicks([good(0, 25)], { duration: 600, minSec: 30, maxSec: 60 });
  assert.deepEqual(custom.errors, ['pick 1 is 25 s, under the 30 s minimum']);
});

test('checkPicks rejects overlapping picks, whatever their order', () => {
  const r = checkPicks([good(100, 130), good(10, 40), good(120, 150)], { duration: 600 });
  assert.deepEqual(r.errors, ['pick 3 overlaps pick 1']);
  // touching is fine
  assert.equal(checkPicks([good(10, 40), good(40, 70)], { duration: 600 }).ok, true);
});

test('checkPicks rejects an empty title', () => {
  const r = checkPicks([good(10, 40, '   '), { s: 100, e: 130 }], { duration: 600 });
  assert.deepEqual(r.errors, ['pick 1 has an empty title', 'pick 2 has an empty title']);
});

test('checkPicks rejects a count outside the range', () => {
  assert.deepEqual(checkPicks([], { duration: 600 }).errors, ['0 picks, under the 1 minimum']);
  const many = Array.from({ length: 11 }, (_, i) => good(i * 50, i * 50 + 30));
  assert.deepEqual(checkPicks(many, { duration: 900 }).errors, ['11 picks, over the 10 maximum']);
  assert.equal(checkPicks(many, { duration: 900, countMax: 11 }).ok, true);
});

test('checkPicks rejects malformed picks and a non-array', () => {
  assert.deepEqual(checkPicks([{ s: 'a', e: 5, title: 'x' }], { duration: 60 }).errors, [
    'pick 1 needs numeric s and e in seconds',
  ]);
  assert.deepEqual(checkPicks([good(30, 20)], { duration: 60 }).errors, ['pick 1 ends before it starts']);
  assert.deepEqual(checkPicks({}, { duration: 60 }).errors, ['picks must be an array']);
});

const words = [
  { w: 'a', s: 9.5, e: 9.9 },
  { w: 'one', s: 10.0, e: 10.4 },
  { w: 'two', s: 10.4, e: 10.9 },
  { w: 'x', s: 39.4, e: 39.8 },
  { w: 'y', s: 40.0, e: 40.2 },
  { w: 'z', s: 40.2, e: 40.5 },
  { w: 'late', s: 40.6, e: 41.0 },
];

test('snapPick moves s to the first word starting at or after s - 0.3', () => {
  // s - 0.3 = 9.8: "a" starts 9.5 (too early), "one" at 10.0 qualifies
  const p = snapPick({ s: 10.1, e: 40.3, title: 't', hook: 'h' }, words);
  assert.equal(p.s, 10.0);
  assert.equal(p.title, 't');
  assert.equal(p.hook, 'h');
});

test('snapPick moves e to the last word ending at or before e + 0.3', () => {
  // e + 0.3 = 40.6: "z" ends 40.5 qualifies, "late" ends 41.0 does not
  assert.equal(snapPick({ s: 10.0, e: 40.3, title: 't' }, words).e, 40.5);
});

test('snapPick edge is inclusive at exactly 0.3', () => {
  const w = [{ w: 'p', s: 9.7, e: 10.0 }, { w: 'q', s: 30.0, e: 30.3 }];
  const p = snapPick({ s: 10.0, e: 30.0, title: 't' }, w);
  assert.deepEqual([p.s, p.e], [9.7, 30.3]);
});

test('snapPick leaves a side alone when no word qualifies', () => {
  const w = [{ w: 'a', s: 1, e: 2 }];
  assert.deepEqual(snapPick({ s: 50, e: 80, title: 't' }, w), { s: 50, e: 80, title: 't' });
  assert.deepEqual(snapPick({ s: 50, e: 80, title: 't' }, []), { s: 50, e: 80, title: 't' });
  // only the start has a qualifying word: no word ends by e + 0.3
  const w2 = [{ w: 'a', s: 50.1, e: 90 }];
  assert.deepEqual(snapPick({ s: 50, e: 80, title: 't' }, w2), { s: 50.1, e: 80, title: 't' });
  // only the end has one: no word starts at or after s - 0.3
  const w3 = [{ w: 'a', s: 10, e: 79.9 }];
  assert.deepEqual(snapPick({ s: 50, e: 80, title: 't' }, w3), { s: 50, e: 79.9, title: 't' });
});

test('snapPick never shortens a pick under 1 s', () => {
  const w = [{ w: 'a', s: 20.0, e: 20.4 }];
  const p = { s: 19.9, e: 20.5, title: 't' };
  assert.deepEqual(snapPick(p, w), p);
});

test('snapPick does not mutate its input', () => {
  const p = { s: 10.1, e: 40.3, title: 't' };
  snapPick(p, words);
  assert.deepEqual(p, { s: 10.1, e: 40.3, title: 't' });
});

test('SNAP_MAX_SEC is 1.5', () => {
  assert.equal(SNAP_MAX_SEC, 1.5);
});

test('snapPick does not jump across a silence (review repro 1)', () => {
  const w = [
    { w: 'a', s: 100.2, e: 100.6 },
    { w: 'b', s: 125, e: 125.4 },
    { w: 'c', s: 140, e: 140.4 },
    { w: 'd', s: 150, e: 150.4 },
    { w: 'e', s: 160, e: 160.4 },
  ];
  // the next word starts 24 s after s; the last one ending by e + 0.3 ends 9.6 s before e
  assert.deepEqual(snapPick({ s: 101, e: 160, title: 't' }, w), { s: 101, e: 160, title: 't' });
});

test('snapPick keeps the end when the last word ends just past e + 0.3 (review repro 2)', () => {
  const w = [{ w: 'x', s: 100, e: 100.4 }, { w: 'y', s: 120, e: 120.4 }, { w: 'z', s: 159.9, e: 160.4 }];
  const p = snapPick({ s: 100, e: 160, title: 't' }, w);
  // z straddles e and ends 0.4 s after it: back out to the whole word
  assert.deepEqual([p.s, p.e], [100, 160.4]);
  // without z there is no word near e; e stays, it is not pulled back to 120.4
  assert.deepEqual(snapPick({ s: 100, e: 160, title: 't' }, w.slice(0, 2)), { s: 100, e: 160, title: 't' });
});

test('snapPick backs up to the start of a word straddling s', () => {
  const w = [{ w: 'long', s: 8.9, e: 10.2 }, { w: 'next', s: 10.2, e: 10.6 }];
  // s = 10.0 is 1.1 s into "long": back up to 8.9, not forward to "next"
  assert.equal(snapPick({ s: 10.0, e: 40, title: 't' }, w).s, 8.9);
});

test('snapPick extends to the end of a word straddling e', () => {
  const w = [{ w: 'a', s: 10, e: 10.5 }, { w: 'long', s: 39.0, e: 40.4 }];
  // e = 40.0 is 0.4 s from the end of "long"; the word before ends far earlier
  assert.equal(snapPick({ s: 10, e: 40.0, title: 't' }, w).e, 40.4);
});

test('snapPick leaves an edge alone when the straddling or nearest word is over 1.5 s away', () => {
  // straddling word starts 3 s before s
  const w1 = [{ w: 'slow', s: 7.0, e: 11.0 }];
  assert.equal(snapPick({ s: 10.0, e: 40, title: 't' }, w1).s, 10.0);
  // straddling word ends 3 s after e
  const w2 = [{ w: 'slow', s: 38.0, e: 43.0 }];
  assert.equal(snapPick({ s: 10, e: 40.0, title: 't' }, w2).e, 40.0);
  // nearest word at or after s - 0.3 starts 1.6 s after s
  const w3 = [{ w: 'far', s: 11.6, e: 12.0 }];
  assert.equal(snapPick({ s: 10.0, e: 40, title: 't' }, w3).s, 10.0);
  // ... but 1.4 s after s is taken
  const w4 = [{ w: 'near', s: 11.4, e: 11.8 }];
  assert.equal(snapPick({ s: 10.0, e: 40, title: 't' }, w4).s, 11.4);
  // nearest word at or before e + 0.3 ends 1.6 s before e
  const w5 = [{ w: 'far', s: 37.8, e: 38.4 }];
  assert.equal(snapPick({ s: 10, e: 40.0, title: 't' }, w5).e, 40.0);
  // ... but 1.4 s before e is taken
  const w6 = [{ w: 'near', s: 38.0, e: 38.6 }];
  assert.equal(snapPick({ s: 10, e: 40.0, title: 't' }, w6).e, 38.6);
});

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

test('CLI snaps then checks, printing one JSON line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const pf = join(dir, 'picks.json');
  const wf = join(dir, 'words.json');
  writeFileSync(pf, JSON.stringify([{ s: 10.1, e: 40.3, title: 't' }]));
  writeFileSync(wf, JSON.stringify(words));
  const r = run([pf, '--duration', '600', '--words', wf]);
  assert.equal(r.status, 0);
  assert.equal(r.out.trim().split('\n').length, 1);
  assert.deepEqual(r.json, { ok: true, picks: [{ s: 10.0, e: 40.5, title: 't', moved: { s: -0.1, e: 0.2 } }] });
});

test('CLI reports 0 moved for an edge that stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const pf = join(dir, 'picks.json');
  const wf = join(dir, 'words.json');
  writeFileSync(pf, JSON.stringify([{ s: 10, e: 40, title: 't' }]));
  writeFileSync(wf, JSON.stringify([{ w: 'a', s: 10, e: 10.4 }, { w: 'b', s: 39.5, e: 40 }]));
  assert.deepEqual(run([pf, '--duration', '600', '--words', wf]).json.picks[0].moved, { s: 0, e: 0 });
});

test('CLI rejects a malformed words file with {"error"}', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const pf = join(dir, 'picks.json');
  writeFileSync(pf, JSON.stringify([{ s: 10, e: 40, title: 't' }]));
  for (const bad of [[null], [5], [{ w: 'a', s: 'x', e: 2 }], [{ w: 'a', s: 1 }], [{ w: 'a', s: 1, e: null }]]) {
    const wf = join(dir, 'words.json');
    writeFileSync(wf, JSON.stringify(bad));
    const r = run([pf, '--duration', '600', '--words', wf]);
    assert.equal(r.status, 1, JSON.stringify(bad));
    assert.deepEqual(Object.keys(r.json), ['error']);
  }
});

test('CLI works without --words and accepts {"picks":[...]}', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const pf = join(dir, 'picks.json');
  writeFileSync(pf, JSON.stringify({ picks: [{ s: 10, e: 40, title: 't' }] }));
  assert.deepEqual(run([pf, '--duration', '600']).json, { ok: true, picks: [{ s: 10, e: 40, title: 't' }] });
});

test('CLI exits 1 with the errors for bad picks, honouring flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const pf = join(dir, 'picks.json');
  writeFileSync(pf, JSON.stringify([{ s: 10, e: 20, title: 't' }]));
  const r = run([pf, '--duration', '600']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json, { ok: false, errors: ['pick 1 is 10 s, under the 15 s minimum'] });
  assert.equal(run([pf, '--duration', '600', '--min', '5']).status, 0);
});

test('CLI exits 1 with {"error"} for a missing file, bad JSON or no duration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'picks-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{nope');
  for (const args of [[join(dir, 'none.json'), '--duration', '60'], [bad, '--duration', '60'], [bad]]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.equal(typeof r.json.error, 'string');
    assert.deepEqual(Object.keys(r.json), ['error']);
  }
});
