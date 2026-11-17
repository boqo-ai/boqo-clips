// The stranger judgment (A6). The ported modules are checked against boqo's own output
// (tests/golden/thin-indexes.json, stranger-transcript.json, parse-stranger.json); the rest tests the two tool
// commands, `frames` and `record`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const input = (name) => JSON.parse(readFileSync(join(HERE, 'fixtures/parity', `${name}.input.json`), 'utf8'));

import { frameLabel, pyRound0, thinIndexes } from '../engine/boqo/stranger-frames.mjs';
import { STRANGER_SYSTEM, strangerContent, strangerTranscript } from '../engine/boqo/stranger-prompt.mjs';
import { AnnotationSchema, parseStranger } from '../engine/boqo/stranger.mjs';

test('thinIndexes and frameLabel match boqo for n = 0..999 with max 12, and pyRound0 for its ties', () => {
  const { ns, max, ties } = input('thin-indexes');
  expectGolden('thin-indexes', {
    cases: ns.map((n) => {
      const idx = thinIndexes(n, max);
      return { n, max, indexes: idx, labels: idx.map((_, i) => frameLabel(i, n, idx.length)) };
    }),
    rounds: ties.map((x) => ({ x, r: pyRound0(x) })),
  });
});

test('the system prompt, the transcript (6,000-char cap) and the user turn match boqo', () => {
  const { cases, contents } = input('stranger-transcript');
  expectGolden('stranger-transcript', {
    system: STRANGER_SYSTEM,
    transcripts: cases.map((c) => {
      const text = strangerTranscript(c);
      return { name: c.name, length: text.length, text };
    }),
    contents: contents.map((c) => ({
      name: c.name,
      content: strangerContent(c.frames.map((f) => ({ label: f.label, jpeg: Buffer.from(f.jpeg) })), c.durationSec, c.transcript),
    })),
  });
});

test('parseStranger and AnnotationSchema match boqo, valid and invalid', () => {
  const { cases, annotations } = input('parse-stranger');
  expectGolden('parse-stranger', {
    stranger: cases.map((c) => ({ name: c.name, parsed: parseStranger(c.raw) })),
    annotation: annotations.map((a) => {
      const r = AnnotationSchema.safeParse(a.raw);
      return { name: a.name, ok: r.success, data: r.success ? r.data : null, issues: r.success ? [] : r.error.issues.map((i) => ({ path: i.path, message: i.message })) };
    }),
  });
});

// ---- the tool: record and frames

const TOOL = join(HERE, '..', 'tools', 'stranger.mjs');
const PROBE = join(HERE, '..', 'engine', 'fixtures', 'probe.mp4');
const tool = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const lastJson = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));
const tmp = () => mkdtempSync(join(tmpdir(), 'stranger-'));

const ANNOTATION = input('parse-stranger').annotations[0].raw;
const row = (n) => ({ n, start: 100, end: 130, title: `Clip ${n}`, score: 80, judgment: null, rendered: true, file: null });

// A run folder with clips.json and an annotation file; returns its paths.
function runWith(annotation = ANNOTATION, rows = [row(1), row(2)]) {
  const run = tmp();
  writeFileSync(join(run, 'clips.json'), JSON.stringify({ version: 1, clips: rows }, null, 2) + '\n');
  const file = join(run, 'annotation.json');
  writeFileSync(file, JSON.stringify(annotation));
  return { run, file };
}

test('record rejects overall_quality_judgment 6 and changes nothing', () => {
  const { run, file } = runWith({ ...ANNOTATION, overall_quality_judgment: 6 });
  const before = readFileSync(join(run, 'clips.json'), 'utf8');
  const r = tool('record', '--run', run, '--n', '1', '--file', file);
  assert.equal(r.status, 1);
  const out = lastJson(r);
  assert.equal(out.ok, false);
  assert.match(out.errors.join('\n'), /overall_quality_judgment/);
  assert.equal(readFileSync(join(run, 'clips.json'), 'utf8'), before);
  rmSync(run, { recursive: true });
});

test('record stores judgment {overall, why, annotation} in the row, and only in that row', () => {
  const { run, file } = runWith();
  const r = tool('record', '--run', run, '--n', '2', '--file', file);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(lastJson(r), { ok: true, n: 2, overall: 4 });
  const clips = JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips;
  assert.equal(clips[0].judgment, null);
  assert.deepEqual(clips[1].judgment, { overall: 4, why: ANNOTATION.one_line_why, annotation: ANNOTATION });
  // no scratch file is left, and a second record replaces the first
  assert.deepEqual(readdirSync(run).sort(), ['annotation.json', 'clips.json']);
  writeFileSync(file, JSON.stringify({ ...ANNOTATION, overall_quality_judgment: 2, one_line_why: 'Slow start.' }));
  assert.equal(tool('record', '--run', run, '--n', '2', '--file', file).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips[1].judgment.overall, 2);
  rmSync(run, { recursive: true });
});

test('record drops a key the schema does not know, as hosted\'s parse does', () => {
  const { run, file } = runWith({ ...ANNOTATION, extra: 'x' });
  assert.equal(tool('record', '--run', run, '--n', '1', '--file', file).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips[0].judgment.annotation, ANNOTATION);
  rmSync(run, { recursive: true });
});

test('record names every wrong field, and refuses a missing clip, a bad file and a pending order', () => {
  const { run, file } = runWith({ ...ANNOTATION, layout: 'x', hook_type: 'y', one_line_why: undefined });
  const errs = lastJson(tool('record', '--run', run, '--n', '1', '--file', file)).errors;
  assert.equal(errs.length, 3, errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('layout:')) && errs.some((e) => e.startsWith('hook_type:')) && errs.some((e) => e.startsWith('one_line_why:')));

  writeFileSync(file, JSON.stringify(ANNOTATION));
  assert.match(lastJson(tool('record', '--run', run, '--n', '9', '--file', file)).errors[0], /no clip 9/);
  assert.match(lastJson(tool('record', '--run', run, '--n', '1', '--file', join(run, 'nope.json'))).errors[0], /cannot read annotation file/);
  writeFileSync(file, 'not json');
  assert.match(lastJson(tool('record', '--run', run, '--n', '1', '--file', file)).errors[0], /not valid JSON/);
  assert.match(lastJson(tool('record', '--run', run, '--n', '0', '--file', file)).errors[0], /clip number/);

  writeFileSync(file, JSON.stringify(ANNOTATION));
  writeFileSync(join(run, '.order-tmp.journal.json'), '{}');
  const pending = tool('record', '--run', run, '--n', '1', '--file', file);
  assert.equal(pending.status, 1);
  assert.match(lastJson(pending).errors[0], /interrupted order/);
  assert.equal(JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips[0].judgment, null);
  rmSync(run, { recursive: true });
});

const ffmpegHere = spawnSync('ffmpeg', ['-version']).status === 0;
const skipFfmpeg = ffmpegHere ? false : 'ffmpeg is not on PATH';

// A synthetic clip of `sec` seconds (lavfi, nothing real).
function synthetic(dir, sec) {
  const f = join(dir, `syn${sec}.mp4`);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', String(sec), '-pix_fmt', 'yuv420p', f]);
  assert.equal(r.status, 0, String(r.stderr));
  return f;
}
const frameFiles = (dir) => readdirSync(dir).filter((n) => /^k\d+\.jpg$/.test(n)).sort();

test('frames on a 5 s clip made from probe.mp4 writes 1 frame', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const clip = join(dir, 'probe5.mp4');
  // probe.mp4 itself is 1 s: fps=1/5 gives a clip that short no frame (see the next test)
  const r0 = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '4', '-i', PROBE, '-c', 'copy', clip]);
  assert.equal(r0.status, 0, String(r0.stderr));
  const out = join(dir, 'f');
  const r = tool('frames', '--clip', clip, '--dir', out);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(lastJson(r).frames, 1);
  assert.deepEqual(frameFiles(out), ['k01.jpg']);
  assert.deepEqual(readdirSync(out).sort(), ['k01.jpg', 'transcript.txt', 'turn.txt']);
  assert.equal(readFileSync(join(out, 'transcript.txt'), 'utf8'), '');
  assert.equal(readFileSync(join(out, 'turn.txt'), 'utf8').split('\n')[0], 'keyframe 1 at ~0s');
  rmSync(dir, { recursive: true });
});

test('frames on a 60 s synthetic clip writes 12, thinned from 12 extracted', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const out = join(dir, 'f');
  const r = tool('frames', '--clip', synthetic(dir, 60), '--dir', out);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(lastJson(r).frames, 12);
  assert.deepEqual(frameFiles(out), Array.from({ length: 12 }, (_, i) => `k${String(i + 1).padStart(2, '0')}.jpg`));
  const turn = readFileSync(join(out, 'turn.txt'), 'utf8').split('\n');
  assert.equal(turn[0], 'keyframe 1 at ~0s');
  assert.equal(turn[1], '[image: k01.jpg]');
  assert.equal(turn[22], 'keyframe 12 at ~55s');
  assert.match(turn[24], /^Clip duration: 60\.0s\. Timed transcript:$/);
  assert.equal(readFileSync(join(out, 'turn.txt'), 'utf8').endsWith('\n\nAnnotate this clip.\n'), true);
  rmSync(dir, { recursive: true });
});

test('frames on a 100 s clip thins 20 extracted frames to 12 and labels them as hosted does', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const out = join(dir, 'f');
  const r = tool('frames', '--clip', synthetic(dir, 100), '--dir', out);
  assert.equal(lastJson(r).frames, 12);
  const labels = readFileSync(join(out, 'turn.txt'), 'utf8').split('\n').filter((l) => l.startsWith('keyframe'));
  const idx = thinIndexes(20, 12);
  assert.deepEqual(labels, idx.map((_, i) => frameLabel(i, 20, 12)));
  assert.equal(labels[1], 'keyframe 2 at ~8s'); // 1 * 5 * (20 / 12) = 8.33
  rmSync(dir, { recursive: true });
});

test('frames with --run and --n writes the clip\'s transcript in the clip\'s own time, and refuses half of the pair', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const { run } = runWith(ANNOTATION, [row(1)]);
  const segs = [
    { start: 90, end: 95, text: 'before the clip', speaker: null },
    { start: 100, end: 104, text: '  first line ', speaker: null },
    { start: 112, end: 118, text: 'second line', speaker: null },
    { start: 140, end: 145, text: 'after the clip', speaker: null },
  ];
  writeFileSync(join(run, 'segments.json'), JSON.stringify(segs));
  const out = join(dir, 'f');
  const r = tool('frames', '--clip', synthetic(dir, 30), '--dir', out, '--run', run, '--n', '1');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(lastJson(r).frames, 6);
  assert.equal(readFileSync(join(out, 'transcript.txt'), 'utf8'), '[0.0s] first line\n[12.0s] second line');
  assert.match(readFileSync(join(out, 'turn.txt'), 'utf8'), /Timed transcript:\n\[0\.0s\] first line\n\[12\.0s\] second line\n\nAnnotate this clip\.\n$/);

  assert.match(lastJson(tool('frames', '--clip', synthetic(dir, 30), '--dir', out, '--run', run)).error, /go together/);
  assert.match(lastJson(tool('frames', '--clip', synthetic(dir, 30), '--dir', out, '--run', run, '--n', '7')).error, /no clip 7/);
  rmSync(dir, { recursive: true });
  rmSync(run, { recursive: true });
});

test('frames stamps the transcript on the rendered window: its settled end and its pause cuts (stored by the render)', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  // Rendered from 100 to 126 (the end settled from 130), with 105-108 of the window cut out (window seconds 5-8).
  const { run } = runWith(ANNOTATION, [{ ...row(1), window: { start: 100, end: 126 }, cuts: [{ start: 5, end: 8 }] }]);
  const segs = [
    { start: 100, end: 104, text: 'first line', speaker: null },
    { start: 112, end: 118, text: 'second line', speaker: null },
    { start: 127, end: 129, text: 'past the settled end', speaker: null },
  ];
  writeFileSync(join(run, 'segments.json'), JSON.stringify(segs));
  const out = join(dir, 'f');
  const r = tool('frames', '--clip', synthetic(dir, 30), '--dir', out, '--run', run, '--n', '1');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(readFileSync(join(out, 'transcript.txt'), 'utf8'), '[0.0s] first line\n[9.0s] second line');
  rmSync(dir, { recursive: true });
  rmSync(run, { recursive: true });
});

test('record refuses a clip that is not rendered, and changes nothing', () => {
  const { run, file } = runWith(ANNOTATION, [{ ...row(1), rendered: false }]);
  const before = readFileSync(join(run, 'clips.json'), 'utf8');
  const r = tool('record', '--run', run, '--n', '1', '--file', file);
  assert.equal(r.status, 1);
  assert.match(lastJson(r).errors[0], /clip 1 is not rendered/);
  assert.equal(readFileSync(join(run, 'clips.json'), 'utf8'), before);
  rmSync(run, { recursive: true });
});

test('frames clears an earlier run\'s extra frames and leaves no work folder', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const out = join(dir, 'f');
  tool('frames', '--clip', synthetic(dir, 60), '--dir', out);
  assert.equal(frameFiles(out).length, 12);
  tool('frames', '--clip', synthetic(dir, 20), '--dir', out);
  assert.equal(frameFiles(out).length, 4);
  assert.deepEqual(readdirSync(out).sort(), ['k01.jpg', 'k02.jpg', 'k03.jpg', 'k04.jpg', 'transcript.txt', 'turn.txt']);
  rmSync(dir, { recursive: true });
});

test('frames fails with one JSON line on a clip too short for a frame, a missing clip and a non-video', { skip: skipFfmpeg }, () => {
  const dir = tmp();
  const short = tool('frames', '--clip', PROBE, '--dir', join(dir, 'a')); // 1 s: fps=1/5 emits nothing
  assert.equal(short.status, 1);
  assert.match(lastJson(short).error, /no keyframes were extracted/);
  assert.equal(existsSync(join(dir, 'a', '.stranger-work')), false);
  assert.match(lastJson(tool('frames', '--clip', join(dir, 'none.mp4'), '--dir', join(dir, 'b'))).error, /no such clip/);
  writeFileSync(join(dir, 'x.mp4'), 'not a video');
  assert.match(lastJson(tool('frames', '--clip', join(dir, 'x.mp4'), '--dir', join(dir, 'c'))).error, /could not be probed/);
  rmSync(dir, { recursive: true });
});
