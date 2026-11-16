import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abuttingEdge, parseFrames, settleArgs, settleEnd, settlePoint } from '../engine/boqo/settle-end.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('abuttingEdge matches boqo on every case', () => {
  expectGolden('abutting-edge', input('abutting-edge').cases.map((c) => abuttingEdge(c.words, c.endSec)));
});

test('parseFrames matches boqo on every case', () => {
  expectGolden('parse-frames', input('parse-frames').cases.map((c) => parseFrames(c.stderrLines.join('\n'), c.fromSec)));
});

test('settlePoint matches boqo on every case (null level = digital silence)', () => {
  const frames = (c) => c.frames.map(([t, db]) => [t, db === null ? Number.NEGATIVE_INFINITY : db]);
  expectGolden('settle-point', input('settle-point').cases.map((c) => settlePoint(frames(c), { endSec: c.endSec, lastWordStartSec: c.lastWordStartSec })));
});

test('settleArgs matches boqo on every case', () => {
  expectGolden('settle-args', input('settle-args').cases.map((c) => settleArgs(c.sourceUrl, c.endSec)));
});

// settleEnd is boqo's too, but it runs ffmpeg: a fake exec stands in, and the
// frames are the settle-point case's "steep onset" series.
const w = (start, end) => ({ word: 'x', start, end });
const WORDS = [w(544.475, 544.715), w(544.715, 545.355), w(545.355, 545.435), w(545.435, 545.915)];
const onsetFrames = input('settle-point').cases[0].frames;
const stderrFor = (frames, from) =>
  frames.map(([t, db], i) => `[Parsed_ametadata_3 @ 0x1] frame:${i}    pts:${i * 320}       pts_time:${t - from}\n[Parsed_ametadata_3 @ 0x1] lavfi.astats.Overall.RMS_level=${db}`).join('\n');
const base = { sourceUrl: 'file.mp4', words: WORDS, startSec: 498.13, endSec: 545.355, enabled: true, timeoutMs: 30_000 };

test('settleEnd: an end that is not an abutting edge reads nothing', async () => {
  let calls = 0;
  const exec = async () => { calls += 1; return { stdout: '', stderr: '' }; };
  const result = await settleEnd({ exec }, { ...base, endSec: 546 });
  assert.deepEqual(result, { status: 'untouched' });
  assert.equal(calls, 0);
});

test('settleEnd: disabled keeps an abutting end without reading', async () => {
  const exec = async () => assert.fail('must not run');
  assert.deepEqual(await settleEnd({ exec }, { ...base, enabled: false }), { status: 'kept', reason: 'disabled' });
});

test('settleEnd: moves the end back and says by how much', async () => {
  const from = 544.755;
  let args;
  const exec = async (cmd, a, opts) => { args = { cmd, a, opts }; return { stdout: '', stderr: stderrFor(onsetFrames, from) }; };
  const result = await settleEnd({ exec }, base);
  assert.equal(args.cmd, 'ffmpeg');
  assert.equal(args.opts.timeoutMs, 30_000);
  assert.equal(result.status, 'settled');
  assert.ok(Math.abs(result.endSec - 545.285) < 1e-6);
  assert.ok(Math.abs(result.movedSec - 0.07) < 1e-6);
});

test('settleEnd: an ffmpeg failure keeps the end; a Stop propagates', async () => {
  const failing = async () => { throw new Error('boom'); };
  assert.deepEqual(await settleEnd({ exec: failing }, base), { status: 'kept', reason: 'ffmpeg-failed' });
  const stopped = async () => { throw Object.assign(new Error('stopped'), { name: 'StoppedError' }); };
  await assert.rejects(() => settleEnd({ exec: stopped }, base), /stopped/);
});

test('settleEnd: unreadable output keeps the end', async () => {
  const exec = async () => ({ stdout: '', stderr: 'nothing useful' });
  assert.deepEqual(await settleEnd({ exec }, base), { status: 'kept', reason: 'parse-failed' });
});

test('settleEnd: the clip start bounds the last word (never settles into the clip start)', async () => {
  const exec = async () => ({ stdout: '', stderr: stderrFor(onsetFrames, 544.755) });
  // last word starts 544.715, but the clip starts at 545.2: a settled end must clear 545.2 + 0.1.
  const result = await settleEnd({ exec }, { ...base, startSec: 545.2 });
  assert.deepEqual(result, { status: 'kept', reason: 'too-early' });
});
