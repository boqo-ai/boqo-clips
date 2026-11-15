import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptChunks } from '../engine/words.mjs';
import { heatOf } from '../engine/fetch.mjs';

const CLI = fileURLToPath(new URL('../tools/transcript.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'boqo-transcript-test-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const lastJson = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));

const WORDS = [
  { w: 'one', s: 0, e: 0.5 },
  { w: 'two', s: 3, e: 3.5 },
  { w: 'three', s: 9, e: 9.5 },
  { w: 'late', s: 1000, e: 1000.5 },
];

test('transcript.mjs writes the same text fetch writes, prints one JSON line', () => {
  const d = tmp();
  const wf = join(d, 'words.json');
  const out = join(d, 'transcript.md');
  writeFileSync(wf, JSON.stringify(WORDS));
  const r = run(['--words', wf, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.deepEqual(lastJson(r), { out, chunks: 2, words: 4 });
  assert.equal(readFileSync(out, 'utf8'), transcriptChunks(WORDS).join('\n\n') + '\n');
});

test('transcript.mjs --heat reads the heatmap of a yt-dlp info file; --line-sec and --chunk-sec apply', () => {
  const d = tmp();
  const wf = join(d, 'words.json');
  const hf = join(d, 'info.json');
  const out = join(d, 't.md');
  const info = { heatmap: [{ start_time: 2, end_time: 4, value: 0.9 }, { start_time: 9, end_time: 10, value: 0.2 }] };
  writeFileSync(wf, JSON.stringify(WORDS));
  writeFileSync(hf, JSON.stringify(info));
  const r = run(['--words', wf, '--out', out, '--heat', hf, '--line-sec', '4', '--chunk-sec', '500']);
  assert.equal(r.status, 0, r.stderr);
  const want = transcriptChunks(WORDS, { heat: heatOf(info), lineSec: 4, chunkSec: 500 }).join('\n\n') + '\n';
  assert.equal(readFileSync(out, 'utf8'), want);
  assert.match(want, /▲/);
  assert.equal(lastJson(r).chunks, 2);
});

test('transcript.mjs: an info file with no heatmap is fine', () => {
  const d = tmp();
  writeFileSync(join(d, 'w.json'), JSON.stringify(WORDS));
  writeFileSync(join(d, 'i.json'), JSON.stringify({ id: 'x' }));
  const r = run(['--words', join(d, 'w.json'), '--out', join(d, 't.md'), '--heat', join(d, 'i.json')]);
  assert.equal(r.status, 0, r.stderr);
});

test('transcript.mjs errors are one JSON line, exit 1', () => {
  const d = tmp();
  const out = join(d, 't.md');
  const bad = join(d, 'bad.json');
  writeFileSync(bad, 'nope');
  const empty = join(d, 'empty.json');
  writeFileSync(empty, '[]');
  const obj = join(d, 'obj.json');
  writeFileSync(obj, '{"a":1}');
  const cases = [
    [[], /--words is required/],
    [['--words', join(d, 'w.json')], /--out is required/],
    [['--words', join(d, 'missing.json'), '--out', out], /cannot read/],
    [['--words', bad, '--out', out], /not valid JSON/],
    [['--words', obj, '--out', out], /array of words/],
    [['--words', empty, '--out', out], /no words/],
    [['--words', empty, '--out', out, '--nope', '1'], /unknown flag/],
    [['--words', empty, '--out'], /needs a value/],
    [['--words', empty, '--out', out, '--line-sec', 'x'], /--line-sec/],
    [['--words', empty, '--out', out, '--chunk-sec', '0'], /--chunk-sec/],
  ];
  for (const [args, re] of cases) {
    const r = run(args);
    assert.equal(r.status, 1, args.join(' '));
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(JSON.parse(lines[0]).error, re, args.join(' '));
  }
  assert.equal(existsSync(out), false);
});

test('transcript.mjs rejects a word that is not {w,s,e}', () => {
  const d = tmp();
  const wf = join(d, 'w.json');
  writeFileSync(wf, JSON.stringify([{ w: 'a', s: 0, e: 1 }, { w: 'b', s: 'x', e: 2 }]));
  const r = run(['--words', wf, '--out', join(d, 't.md')]);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /word 2/);
});
