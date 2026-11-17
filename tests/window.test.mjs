import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { toolEnv } from '../engine/env.mjs';
import { prepareWindow } from '../engine/window.mjs';

const run = promisify(execFile);
// The injected exec: what the engine's callers pass. Rejects on a non-zero exit, with stderr on the error.
const exec = (command, args) => run(command, args, { env: toolEnv(), maxBuffer: 64 << 20, windowsHide: true });

const word = (w, s, e) => ({ w, s, e });

// ---- orchestration, with a fake exec ---------------------------------------------------------------

function fake(handlers) {
  const calls = [];
  const fn = async (command, args, options) => {
    calls.push({ command, args, options });
    const out = handlers(command, args, calls.length);
    if (out instanceof Error) throw out;
    return { stdout: '', stderr: '', ...out };
  };
  return { fn, calls };
}

test('prepareWindow: settles the end first, then extracts the settled window by stream copy', async () => {
  // The clip ends on "next"'s first sound. settleArgs reads 0.6 s before the edge, from 19.4: 30 frames of 20 ms,
  // quiet and then a loud fragment of two frames at the edge.
  const words = [word('last', 18.4, 19.99), word('next', 20.0, 20.4)];
  const db = (i) => (i < 28 ? -48 : [-12, -10][i - 28]);
  const stderr = Array.from({ length: 30 }, (_, i) => `[Parsed_ametadata_3 @ 0x1] frame:${i}    pts:${i * 320}       pts_time:${(i * 0.02).toFixed(2)}\n[Parsed_ametadata_3 @ 0x1] lavfi.astats.Overall.RMS_level=${db(i)}`).join('\n');
  const { fn, calls } = fake((command, args) => (command === 'ffmpeg' && args.join(' ').includes('asetnsamples') ? { stderr } : {}));
  const result = await prepareWindow({ source: '/s/sec.mp4', startSec: 2, endSec: 20, words, dir: '/w', exec: fn });
  assert.equal(result.settle.status, 'settled');
  assert.ok(Math.abs(result.endSec - 19.95) < 1e-6, `settled end ${result.endSec}`);
  assert.equal(result.startSec, 2);
  const extractAt = calls.findIndex((c) => c.command === 'ffmpeg' && c.args.includes('copy'));
  const extract = calls[extractAt];
  assert.deepEqual(extract.args.slice(extract.args.indexOf('-ss'), extract.args.indexOf('-i') + 2), ['-ss', '2', '-to', String(result.endSec), '-i', '/s/sec.mp4']);
  assert.equal(extract.args.at(-1), join('/w', 'window.mp4'));
  assert.equal(extractAt, 1, 'settle read the source before the extract');
});

test('prepareWindow: a window with no audio stream skips the detector and returns no cuts', async () => {
  const { fn, calls } = fake(() => ({ stdout: '' }));
  const result = await prepareWindow({ source: 's.mp4', startSec: 0, endSec: 10, words: [word('a', 0.5, 1), word('b', 5, 6)], dir: '/w', exec: fn });
  assert.equal(result.file, join('/w', 'window.mp4'));
  assert.deepEqual(result.cuts, []);
  assert.equal(result.pauses.skipped, 'no-audio');
  assert.equal(result.settle.status, 'untouched');
  assert.equal(calls.filter((c) => c.command === 'ffmpeg').length, 1, 'only the extract ran');
});

test('prepareWindow: a failing pause detector renders without cuts and says so', async () => {
  const { fn } = fake((command, args) => {
    if (command === 'ffprobe') return { stdout: 'audio\n' };
    if (args.includes('volumedetect')) return new Error('boom');
    return {};
  });
  const result = await prepareWindow({ source: 's.mp4', startSec: 0, endSec: 10, words: [word('a', 0.5, 1), word('b', 5, 6)], dir: '/w', exec: fn });
  assert.deepEqual(result.cuts, []);
  assert.equal(result.pauses.skipped, 'detect-failed');
  assert.equal(result.file, join('/w', 'window.mp4'));
});

test('prepareWindow: a failing extract throws', async () => {
  const { fn } = fake((command, args) => (args.includes('copy') ? new Error('no such file') : {}));
  await assert.rejects(() => prepareWindow({ source: 'missing.mp4', startSec: 0, endSec: 10, words: [], dir: '/w', exec: fn }), /no such file/);
});

// ---- real ffmpeg: a tone with 2 s of silence in the middle and a word gap over it -------------------------

const ffmpegPresent = await exec('ffmpeg', ['-version']).then(() => true, () => false);

async function durationOf(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

test('prepareWindow: 2 s of silence under a word gap is one cut, and the file is that much shorter', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-window-'));
  try {
    // 10 s of video and a 440 Hz tone, silent from 4 s to 6 s (source time).
    const source = join(dir, 'source.mp4');
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=10',
      '-af', "volume=enable='between(t,4,6)':volume=0",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source,
    ]);
    // The window is 1 s to 9 s: the words sit either side of the silence.
    const words = [word('before', 1.2, 3.8), word('after', 6.2, 8.8)];
    const result = await prepareWindow({ source, startSec: 1, endSec: 9, words, dir, exec });

    assert.equal(result.settle.status, 'untouched');
    assert.equal(result.pauses.skipped, null);
    assert.equal(result.cuts.length, 1, JSON.stringify(result));
    const [cut] = result.cuts;
    // window time: the silence is 3 s to 5 s, in the gap 2.8..5.2; keeps 0.15 s after the word, 0.25 s before the next.
    assert.ok(cut.start > 3.1 && cut.start < 3.4, `cut start ${cut.start}`);
    assert.ok(cut.end > 4.6 && cut.end < 4.9, `cut end ${cut.end}`);
    assert.equal(result.file, join(dir, 'window-cut.mp4'));
    assert.ok(existsSync(result.file));

    const uncut = await durationOf(join(dir, 'window.mp4'));
    const cutDur = await durationOf(result.file);
    assert.ok(Math.abs(cutDur - (uncut - (cut.end - cut.start))) <= 0.05, `cut file ${cutDur} s, window ${uncut} s, cut ${cut.end - cut.start} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test('prepareWindow: a window with no pause is returned as extracted', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-window-'));
  try {
    const source = join(dir, 'source.mp4');
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source,
    ]);
    const result = await prepareWindow({ source, startSec: 0.5, endSec: 5.5, words: [word('a', 0.6, 2), word('b', 2.1, 5)], dir, exec });
    assert.deepEqual(result.cuts, []);
    assert.equal(result.file, join(dir, 'window.mp4'));
    assert.ok(Math.abs((await durationOf(result.file)) - 5) < 0.2);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
