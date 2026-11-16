import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PAUSE_DETECT_CONFIG, EDIT_PAUSES_ENABLED, PAUSE_REASONS, detectPauses, meanVolumeArgs, parseMeanVolumeDb, parseQuietRuns, pauseSkipped, silenceDetectArgs } from '../engine/boqo/pauses.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('the detector args and parsers match boqo', () => {
  const { meanVolume, quietRuns, args } = input('pause-parsers').cases;
  expectGolden('pause-parsers', {
    meanVolume: meanVolume.map((c) => parseMeanVolumeDb(c.stderr)),
    quietRuns: quietRuns.map((c) => parseQuietRuns(c.stderr, c.windowDurationSec)),
    meanVolumeArgs: meanVolumeArgs(args.path),
    silenceDetectArgs: silenceDetectArgs(args.path, args.noiseDb, args.minSec),
  });
});

test('the production detect config: floor 25 dB under the mean, 1.2 s, keeps 0.15 and 0.25, 50% cap', () => {
  assert.deepEqual(DEFAULT_PAUSE_DETECT_CONFIG, { minSec: 1.2, keepAfterWordSec: 0.15, keepBeforeWordSec: 0.25, maxFraction: 0.5, floorDb: 25 });
});

const words = [{ start: 0.5, end: 1 }, { start: 5, end: 6 }];
const volume = (db) => `[Parsed_volumedetect_0 @ 0x1] mean_volume: ${db} dB\n`;
const silence = '[silencedetect @ 0x1] silence_start: 1\n[silencedetect @ 0x1] silence_end: 5 | silence_duration: 4\n';
const run = (exec, over = {}) => detectPauses({ exec }, { windowPath: '/w/window.mp4', windowDurationSec: 10, words, config: DEFAULT_PAUSE_DETECT_CONFIG, timeoutMs: () => 30_000, ...over });

test('Tighten pauses is on', () => {
  assert.equal(EDIT_PAUSES_ENABLED, true);
});

test('detectPauses: mean level, then silencedetect at (mean - 25) dB for 1.2 s, then core\'s rule', async () => {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { stdout: '', stderr: calls.length === 1 ? volume(-20) : silence };
  };
  const out = await run(exec);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'ffmpeg');
  assert.ok(calls[0].args.includes('volumedetect'));
  assert.ok(calls[1].args.includes('silencedetect=noise=-45dB:d=1.2'));
  assert.deepEqual(out, { cuts: [{ start: 1.15, end: 4.75 }], skipped: null, gaps: 1, quiet: 1, pauses: 1, meanDb: -20, floorDb: -45 });
});

test('detectPauses: under two words nothing is run', async () => {
  const exec = async () => assert.fail('must not run');
  assert.deepEqual(await run(exec, { words: [words[0]] }), pauseSkipped(PAUSE_REASONS.noWords));
});

test('detectPauses: no signal at all is no-audio, and only the first pass ran', async () => {
  let n = 0;
  const exec = async () => { n += 1; return { stdout: '', stderr: volume('-inf') }; };
  assert.deepEqual(await run(exec), pauseSkipped('no-audio'));
  assert.equal(n, 1);
});

test('detectPauses: an unparseable level or a failing ffmpeg is detect-failed, never a throw', async () => {
  assert.deepEqual(await run(async () => ({ stdout: '', stderr: 'nothing' })), pauseSkipped('detect-failed'));
  assert.deepEqual(await run(async () => { throw new Error('boom'); }), pauseSkipped('detect-failed'));
});

test('detectPauses: pauses over half the window cut nothing and say over-limit', async () => {
  const exec = async (cmd, args) => ({ stdout: '', stderr: args.includes('volumedetect') ? volume(-20) : '[silencedetect @ 0x1] silence_start: 1\n[silencedetect @ 0x1] silence_end: 5\n' });
  const out = await run(exec, { windowDurationSec: 7 });
  assert.equal(out.skipped, 'over-limit');
  assert.deepEqual(out.cuts, []);
  assert.equal(out.pauses, 1);
});

test('detectPauses: the module never imports child_process', () => {
  const text = readFileSync(new URL('../engine/boqo/pauses.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import\b.*child_process|require\(.*child_process/m);
});
