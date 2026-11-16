// The loudness pass: engine/boqo/loudness.mjs, held to boqo's own output at the pin (golden apply-args), and
// `applyLoudness` dropping, never throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectGolden } from './helpers/golden.mjs';
import { CLIP_LOUDNESS, applyArgs, applyLoudness, clipLoudnessTarget, measureArgs, parseLoudnormJson } from '../engine/boqo/loudness.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('measureArgs, applyArgs, clipLoudnessTarget and parseLoudnormJson (golden apply-args)', () => {
  const input = fixture('apply-args');
  const targets = [CLIP_LOUDNESS, ...input.targets];
  expectGolden(
    'apply-args',
    {
      CLIP_LOUDNESS,
      targets: input.loudness.map((l) => ({ l, target: clipLoudnessTarget(l) })),
      measure: targets.map((t) => measureArgs(input.inPath, t)),
      apply: targets.flatMap((t) => input.measures.map((m) => applyArgs(input.inPath, input.outPath, t, m))),
      parsed: input.stderr.map((s) => parseLoudnormJson(s)),
    },
    { tol: 0 },
  );
});

const MEASURED = `{\n "input_i" : "-21.75", "input_tp" : "-18.06", "input_lra" : "0.00", "input_thresh" : "-31.75", "target_offset" : "-0.05"\n}`;
const APPLIED = `{\n "output_i" : "-14.02", "output_tp" : "-6.10", "output_lra" : "0.00", "normalization_type" : "linear"\n}`;

test('applyLoudness: measure, apply into clip-loud.mp4, rename over the clip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-loud-'));
  try {
    const clip = join(dir, 'clip.mp4');
    writeFileSync(clip, 'composed');
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push(args);
      if (calls.length === 1) return { stdout: '', stderr: MEASURED };
      writeFileSync(args.at(-1), 'loud');
      return { stdout: '', stderr: APPLIED };
    };
    const r = await applyLoudness({ exec }, { path: clip, dir, target: CLIP_LOUDNESS, timeoutMs: () => 1000 });
    assert.equal(r.status, 'applied');
    assert.equal(r.outputI, -14.02);
    assert.equal(r.type, 'linear');
    assert.equal(readFileSync(clip, 'utf8'), 'loud');
    assert.equal(existsSync(join(dir, 'clip-loud.mp4')), false);
    assert.ok(calls[1].join(' ').includes('measured_I=-21.75'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyLoudness: a failed or unparseable pass leaves the clip as composed and says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-loud-'));
  try {
    const clip = join(dir, 'clip.mp4');
    writeFileSync(clip, 'composed');
    const failing = async () => {
      throw Object.assign(new Error('ffmpeg failed (exit 1)'), { stderr: '' });
    };
    assert.deepEqual(await applyLoudness({ exec: failing }, { path: clip, dir, target: CLIP_LOUDNESS, timeoutMs: () => 1 }), { status: 'skipped', reason: 'ffmpeg-failed' });
    const silent = async () => ({ stdout: '', stderr: '{ "input_i" : "-inf" }' });
    assert.deepEqual(await applyLoudness({ exec: silent }, { path: clip, dir, target: CLIP_LOUDNESS, timeoutMs: () => 1 }), { status: 'skipped', reason: 'parse-failed' });
    let n = 0;
    const empty = async (cmd, args) => {
      n += 1;
      if (n === 1) return { stdout: '', stderr: MEASURED };
      writeFileSync(args.at(-1), '');
      return { stdout: '', stderr: APPLIED };
    };
    assert.deepEqual(await applyLoudness({ exec: empty }, { path: clip, dir, target: CLIP_LOUDNESS, timeoutMs: () => 1 }), { status: 'skipped', reason: 'ffmpeg-failed' });
    assert.equal(readFileSync(clip, 'utf8'), 'composed');
    assert.equal(existsSync(join(dir, 'clip-loud.mp4')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
