// The render (engine/render.mjs `renderClip`, tools/render.mjs) end to end on real ffmpeg: a synthetic lavfi source
// (testsrc2, a 440 Hz tone, a word every 0.4 s), the brand kit v2 and boqo's pipeline. The graph builders and the
// loudness argv are held to boqo's own output in tests/compose.test.mjs and tests/loudness.test.mjs.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultBrand, saveBrand } from '../engine/brand.mjs';
import { toolEnv } from '../engine/env.mjs';
import { reorderRun } from '../engine/order.mjs';
import { renderClip } from '../engine/render.mjs';
import { CLIP_LOUDNESS, measureArgs, parseLoudnormJson } from '../engine/boqo/loudness.mjs';

const CLI = fileURLToPath(new URL('../tools/render.mjs', import.meta.url));
const ffmpegHere = spawnSync('ffmpeg', ['-version'], { env: toolEnv() }).status === 0;
const skip = ffmpegHere ? false : 'ffmpeg is not on PATH';

const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', env: toolEnv() });
  assert.equal(r.status, 0, r.stderr);
};
const probe = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', env: toolEnv() });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const integrated = (file) => {
  const r = spawnSync('ffmpeg', ['-nostdin', ...measureArgs(file, CLIP_LOUDNESS)], { encoding: 'utf8', env: toolEnv() });
  assert.equal(r.status, 0, r.stderr);
  return Number(parseLoudnormJson(r.stderr).input_i);
};

// onnxruntime-node standing in as not loadable: faces are unavailable, every shot is Fit.
const noRuntime = async () => {
  throw new Error('onnxruntime-node is not installed');
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

let fx;
before(() => {
  if (!ffmpegHere) return;
  const dir = mkdtempSync(join(tmpdir(), 'boqo render fx ')); // a space on purpose
  const src = join(dir, 'source file.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
  ]);
  // The same picture with 8 to 10.5 s silent, and no word there: a pause the render cuts.
  const gap = join(dir, 'gap.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', "sine=frequency=440:duration=20,volume=enable='between(t,8,10.5)':volume=0",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', gap,
  ]);
  // A downloaded section of it: video seconds 5 to 13, so the clip at 6 starts 1 s in.
  const section = join(dir, 'sec 0.mp4');
  ff(['-ss', '5', '-i', gap, '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', section]);
  const word = (t, i) => ({ w: `word${i}`, s: Math.round(t * 100) / 100, e: Math.round((t + 0.3) * 100) / 100 });
  const words = Array.from({ length: 50 }, (_, i) => word(i * 0.4, i));
  const gapWords = words.filter((x) => x.e <= 8 || x.s >= 10.5);
  fx = { dir, src, gap, section, words, gapWords };
});

const row = (over = {}) => ({ n: 1, start: 2, end: 5, title: 'A synthetic clip', hook: 'Its hook', emphasis_words: ['word10'], panels: null, ...over });

test('renderClip: 20 s of testsrc2 and a tone become a 1080x1920 h264/aac 48 kHz clip at -14 LUFS, a thumbnail, and the Fit note', { skip }, async (t) => {
  const run = join(fx.dir, 'run e2e');
  const started = Date.now();
  const r = await renderClip({ run, row: row({ start: 0, end: 20 }), brand: defaultBrand('t'), sourceFile: fx.src, words: fx.words, load: noRuntime });
  t.diagnostic(`20 s clip rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  assert.equal(r.file, join(run, 'out', 'clip-01.mp4'));
  assert.equal(r.thumb, join(run, 'out', 'clip-01.jpg'));
  const j = probe(r.file);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264');
  assert.equal(v.pix_fmt, 'yuv420p');
  assert.deepEqual([v.width, v.height], [1080, 1920]);
  assert.equal(a.codec_name, 'aac');
  assert.equal(a.sample_rate, '48000');
  assert.ok(Math.abs(Number(j.format.duration) - 20) < 0.2, `duration ${j.format.duration}`);
  assert.ok(Math.abs(r.seconds - Number(j.format.duration)) < 0.01);
  const loud = integrated(r.file);
  assert.ok(Math.abs(loud - -14) <= 1, `integrated loudness ${loud} LUFS`);
  assert.ok(existsSync(r.thumb));
  const th = probe(r.thumb).streams[0];
  assert.deepEqual([th.width, th.height], [1080, 1920]);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /^Faces unavailable, every shot is Fit: .*onnxruntime-node is not installed/);
  assert.deepEqual(r.layouts, ['fit']);
  assert.deepEqual(r.cuts, []);
  assert.deepEqual(r.window, { start: 0, end: 20 });
  assert.equal(existsSync(join(run, 'render', 'clip-01')), false, 'the work folder is gone');
});

test('renderClip: a downloaded section renders the clip on the section\'s own clock: the same window, pause cut and length as the whole video', { skip }, async () => {
  const whole = await renderClip({ run: join(fx.dir, 'run whole'), row: row({ start: 6, end: 12 }), brand: defaultBrand('t'), sourceFile: fx.gap, words: fx.gapWords, load: noRuntime });
  const part = await renderClip({ run: join(fx.dir, 'run section'), row: row({ start: 6, end: 12 }), brand: defaultBrand('t'), sourceFile: fx.section, offset: 1, words: fx.gapWords, load: noRuntime });
  // The silence from video 8 to 10.5 s is window 2 to 4.5 s, less the 0.15 s kept after a word and 0.25 s before one.
  assert.equal(whole.cuts.length, 1);
  assert.ok(whole.cuts[0].start > 2 && whole.cuts[0].start < 2.5, JSON.stringify(whole.cuts));
  assert.ok(whole.cuts[0].end > 4 && whole.cuts[0].end < 4.5, JSON.stringify(whole.cuts));
  assert.deepEqual(part.cuts, whole.cuts);
  assert.deepEqual(part.window, whole.window);
  assert.deepEqual(whole.window, { start: 6, end: 12 });
  const cut = whole.cuts[0].end - whole.cuts[0].start;
  assert.ok(Math.abs(whole.seconds - (6 - cut)) < 0.1, `${whole.seconds} vs ${6 - cut}`);
  assert.ok(Math.abs(part.seconds - whole.seconds) < 0.05);
});

test('renderClip: a logo file that is missing, or not an image, costs the logo and one note, never the clip; a PNG draws with none', { skip }, async () => {
  const notAnImage = join(fx.dir, 'logo.png');
  writeFileSync(notAnImage, 'this is text, not a PNG');
  const good = join(fx.dir, 'real logo.png');
  writeFileSync(good, PNG);
  const kit = (file) => ({ ...defaultBrand('t'), logo: { ...defaultBrand('t').logo, file } });
  const go = (name, file) => renderClip({ run: join(fx.dir, name), row: row(), brand: kit(file), sourceFile: fx.src, words: fx.words, load: noRuntime });

  const missing = await go('run logo missing', join(fx.dir, 'no such logo.png'));
  assert.ok(existsSync(missing.file));
  const logoNotes = (r) => r.notes.filter((n) => /logo/i.test(n));
  assert.equal(logoNotes(missing).length, 1);
  assert.match(logoNotes(missing)[0], /^No logo: the file is missing/);

  const wrong = await go('run logo wrong', notAnImage);
  assert.ok(existsSync(wrong.file));
  assert.deepEqual(logoNotes(wrong).map((n) => n.replace(/ \(.*\)\.$/, '')), ['No logo: it is not a PNG or JPEG image']);

  const drawn = await go('run logo drawn', good);
  assert.ok(existsSync(drawn.file));
  assert.deepEqual(logoNotes(drawn), []);
});

// ---- the CLI

const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const last = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));
const clipRow = (n, start, end, over = {}) => ({
  n, start, end, title: `Clip ${n}`, title_alternatives: [], hook: null, score: 90 - n, axes: { hook: 80, flow: 80, standalone: 80, value: 80 },
  emphasis_words: [], standalone: null, replay: null, judgment: null, panels: null, rendered: false, file: null, notes: [], ...over,
});
function runFolder(rows) {
  const run = mkdtempSync(join(tmpdir(), 'boqo render run '));
  writeFileSync(join(run, 'clips.json'), JSON.stringify({ version: 1, video: { id: null, title: null, duration: 20, language: null }, target: 2, cap: 3, clips: rows }, null, 2) + '\n');
  writeFileSync(join(run, 'words.json'), JSON.stringify(fx?.words ?? []));
  return run;
}
const readRecord = (run) => JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8'));
const emptyHome = () => mkdtempSync(join(tmpdir(), 'boqo home '));

test('CLI --first and --n render rows by number into clips.json; clips order then keeps each clip and thumbnail together', { skip }, () => {
  const run = runFolder([clipRow(1, 2, 5), clipRow(2, 10, 13), clipRow(3, 14, 17)]);
  const home = emptyHome();
  const first = cli(['--run', run, '--first', '1', '--src', fx.src], { BOQO_HOME: home });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(first.stdout.trim().split('\n').length, 1);
  const out = last(first);
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.rendered.map((r) => r.n), [1]);
  let rec = readRecord(run);
  assert.equal(rec.clips[0].rendered, true);
  assert.equal(rec.clips[0].file, 'out/clip-01.mp4');
  assert.equal(rec.clips[0].thumb, 'out/clip-01.jpg');
  assert.ok(rec.clips[0].seconds > 2.5 && rec.clips[0].seconds < 3.5);
  assert.deepEqual(rec.clips[0].window, { start: 2, end: 5 });
  assert.ok(Array.isArray(rec.clips[0].cuts) && Array.isArray(rec.clips[0].notes));
  assert.equal(rec.clips[1].rendered, false);
  assert.equal(rec.clips[2].rendered, false);

  const second = cli(['--run', run, '--n', '3', '--src', fx.src], { BOQO_HOME: home });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  rec = readRecord(run);
  assert.equal(rec.clips[2].file, 'out/clip-03.mp4');
  assert.equal(rec.clips[1].rendered, false);

  // A judgment that puts clip 3 first: the order renames clip-03.mp4 and clip-03.jpg to clip-01 together.
  rec.clips[2].judgment = { overall: 5, why: 'x' };
  rec.clips[0].judgment = { overall: 1, why: 'y' };
  writeFileSync(join(run, 'clips.json'), JSON.stringify(rec, null, 2) + '\n');
  const before = readFileSync(join(run, 'out', 'clip-03.jpg'));
  const ordered = reorderRun(run);
  assert.equal(ordered.ok, true, JSON.stringify(ordered));
  rec = readRecord(run);
  assert.equal(rec.clips[0].title, 'Clip 3');
  assert.equal(rec.clips[0].file, 'out/clip-01.mp4');
  assert.equal(rec.clips[0].thumb, 'out/clip-01.jpg');
  assert.deepEqual(readFileSync(join(run, 'out', 'clip-01.jpg')), before);
  assert.equal(rec.clips[1].title, 'Clip 1');
  assert.equal(rec.clips[1].file, 'out/clip-02.mp4');
  assert.ok(existsSync(join(run, 'out', 'clip-02.jpg')));
});

test('CLI with sections.json: each clip renders from its own section; a section too short for its clip fails that clip only', { skip }, () => {
  const run = runFolder([clipRow(1, 6, 9), clipRow(2, 14, 17)]);
  // clip 1 from the section (video 5..13, offset 1); clip 2 is given the same file at an offset it does not reach.
  writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: fx.section, offset: 1 }, { pick: 1, file: fx.section, offset: 9 }] }));
  const r = cli(['--run', run, '--all'], { BOQO_HOME: emptyHome() });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = last(r);
  assert.deepEqual(out.rendered.map((x) => x.n), [1]);
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].n, 2);
  assert.match(out.failed[0].error, /too short for clip 2/);
  const rec = readRecord(run);
  assert.equal(rec.clips[0].rendered, true);
  assert.deepEqual(rec.clips[0].window, { start: 6, end: 9 });
  assert.equal(rec.clips[1].rendered, false);
});

test('CLI renders with a saved kit whose logo file is gone: no logo, one note, the clip', { skip }, async () => {
  const home = emptyHome();
  const prev = process.env.BOQO_HOME;
  process.env.BOQO_HOME = home;
  try {
    const logo = join(home, 'l.png');
    writeFileSync(logo, PNG);
    const dir = await saveBrand(defaultBrand('kit'), logo);
    rmSync(join(dir, 'logo.png'));
  } finally {
    if (prev === undefined) delete process.env.BOQO_HOME;
    else process.env.BOQO_HOME = prev;
  }
  const run = runFolder([clipRow(1, 2, 5)]);
  const r = cli(['--run', run, '--brand', 'kit', '--src', fx.src], { BOQO_HOME: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rec = readRecord(run);
  assert.equal(rec.clips[0].rendered, true);
  assert.equal(rec.clips[0].notes.filter((n) => /^No logo: the file is missing/.test(n)).length, 1);
});

test('CLI refusals: no --run, a pending order, an unknown clip, two selections, no sections and no --src', () => {
  assert.match(last(cli([])).error, /--run/);
  const run = runFolder([clipRow(1, 2, 5)]);
  assert.match(last(cli(['--run', run, '--n', '7'])).error, /no clip 7/);
  assert.match(last(cli(['--run', run, '--n', '1', '--all'])).error, /at most one/);
  assert.match(last(cli(['--run', run, '--n', 'x'])).error, /clip numbers/);
  assert.match(last(cli(['--run', run, '--layout', 'crop'])).error, /unknown flag --layout/);
  assert.match(last(cli(['--run', run], { BOQO_HOME: emptyHome() })).error, /sections\.json/);
  writeFileSync(join(run, '.order-tmp.journal.json'), '{}');
  const pending = cli(['--run', run]);
  assert.equal(pending.status, 1);
  assert.match(last(pending).error, /interrupted order/);
});
