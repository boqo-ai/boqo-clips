import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { toolEnv } from '../engine/env.mjs';
import {
  CUT_FLOOR, CUT_MIN_PERSIST, CUT_MIN_RATIO, CUT_OPTIONS, CUT_STRONG_RATIO, CUT_WINDOW, GRAY_HEIGHT, GRAY_WIDTH, MIN_SHOT_SEC,
  SCENE_THRESHOLD_OVERRIDE, cutsFromSignals, fpsFromScores, frameRatios, framePersistence, isCut, parseGrayFrames, parseSceneScores,
  sceneSignalArgs, shotsFrom,
} from '../engine/boqo/scenes.mjs';
import { detectShots } from '../engine/shots.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('parseSceneScores matches boqo, including the pairs it drops', () => {
  const { cases } = input('parse-scene-scores');
  expectGolden('parse-scene-scores', Object.fromEntries(Object.entries(cases).map(([k, text]) => [k, parseSceneScores(text)])));
});

test('frameRatios matches boqo', () => {
  expectGolden('frame-ratios', input('frame-ratios').cases.map((c) => frameRatios(c.scores, c.window)));
});

test('isCut matches boqo at and around the production thresholds', () => {
  expectGolden('is-cut', input('is-cut').cases.map((c) => isCut(c.input, c.opts)));
});

test('cutsFromSignals matches boqo: strong arm, persistence arm, flashes, ends, mismatched counts', () => {
  const { cases } = input('cuts-from-signals');
  expectGolden('cuts-from-signals', cases.map((c) => cutsFromSignals(c.scores, c.frames.map((f) => Float32Array.from(f)), c.opts)));
});

test('shotsFrom matches boqo: shots under 0.5 s merge into the one before', () => {
  expectGolden('shots-from', input('shots-from').cases.map((c) => shotsFrom(c.cutTimes, c.durationSec, c.minShotSec)));
});

test('sceneSignalArgs matches boqo', () => {
  expectGolden('scene-signal-args', { gray: [GRAY_WIDTH, GRAY_HEIGHT], args: input('scene-signal-args').cases.map((c) => sceneSignalArgs(c)) });
});

test('parseGrayFrames matches boqo, dropping a trailing partial frame', () => {
  expectGolden('parse-gray-frames', input('parse-gray-frames').cases.map((c) => parseGrayFrames(Uint8Array.from(c.bytes), c.width, c.height).map((f) => Array.from(f))));
});

test('framePersistence matches boqo', () => {
  expectGolden('frame-persistence', input('frame-persistence').cases.map((c) => framePersistence(c.frames.map((f) => Float32Array.from(f)), c.lead)));
});

test('fpsFromScores matches boqo', () => {
  expectGolden('fps-from-scores', input('fps-from-scores').cases.map((c) => fpsFromScores(c.scores)));
});

test('the production thresholds: adaptive mode, floor 0.02, ratios 10 and 20, persist 0.12, window 3, shots of 0.5 s', () => {
  assert.equal(SCENE_THRESHOLD_OVERRIDE, null);
  assert.deepEqual({ CUT_FLOOR, CUT_MIN_RATIO, CUT_STRONG_RATIO, CUT_MIN_PERSIST, CUT_WINDOW, MIN_SHOT_SEC }, { CUT_FLOOR: 0.02, CUT_MIN_RATIO: 10, CUT_STRONG_RATIO: 20, CUT_MIN_PERSIST: 0.12, CUT_WINDOW: 3, MIN_SHOT_SEC: 0.5 });
  assert.deepEqual(CUT_OPTIONS, { floor: 0.02, minRatio: 10, strongRatio: 20, minPersist: 0.12, window: 3 });
  assert.equal(Object.isFrozen(CUT_OPTIONS), true);
  assert.equal(GRAY_WIDTH, 64);
  assert.equal(GRAY_HEIGHT, 36);
});

// ---- detectShots, with a fake exec -----------------------------------------------------------------------

test('detectShots: one scene pass on the window, the scores from stdout and the greyscale frames from the file, at the production rule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-shots-'));
  try {
    const calls = [];
    const text = Array.from({ length: 40 }, (_, i) => `frame:${i}    pts:${i * 40}      pts_time:${(i * 0.04).toFixed(2)}\nlavfi.scene_score=${i === 20 ? 0.3 : 0.01}`).join('\n');
    const exec = async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: text, stderr: '' };
    };
    const out = await detectShots({ exec }, { windowPath: '/w/window.mp4', dir, durationSec: 1.6 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'ffmpeg');
    assert.deepEqual(calls[0].args, sceneSignalArgs({ path: '/w/window.mp4', grayPath: join(dir, 'frames.gray') }));
    // The fake never wrote the greyscale file: the weak arm is dead, the strong one (ratio 30) still cuts.
    assert.deepEqual(out.shots, [{ startSec: 0, endSec: 0.8 }, { startSec: 0.8, endSec: 1.6 }]);
    assert.deepEqual({ frames: out.frames, grayFrames: out.grayFrames, cutsStrong: out.cutsStrong, cutsWeak: out.cutsWeak }, { frames: 40, grayFrames: 0, cutsStrong: 1, cutsWeak: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the real ffmpeg --------------------------------------------------------------------------------------

const run = promisify(execFile);
const realExec = (command, args) => run(command, args, { env: toolEnv(), maxBuffer: 64 << 20, windowsHide: true });

test('a lavfi clip of red for 2 s then blue for 2 s has exactly one cut, at 2.0 s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-shots-'));
  try {
    const clip = join(dir, 'redblue.mp4');
    await realExec('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=25:d=2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25:d=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip,
    ]);
    const out = await detectShots({ exec: realExec }, { windowPath: clip, dir, durationSec: 4 });
    assert.equal(out.frames, 100);
    assert.equal(out.grayFrames, 100);
    assert.equal(out.cutsStrong + out.cutsWeak, 1);
    assert.equal(out.shots.length, 2);
    assert.ok(Math.abs(out.shots[0].endSec - 2) <= 0.05, `cut at ${out.shots[0].endSec}`);
    assert.deepEqual([out.shots[0].startSec, out.shots[1].endSec], [0, 4]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
