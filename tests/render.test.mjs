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
import { logoFailure, realExec, renderClip } from '../engine/render.mjs';
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
  // Silent picture-and-audio, for telling which file a clip came from: digital silence leaves loudnorm nothing to
  // measure, so a clip rendered from it carries the loudness note and one from the tone does not.
  const silent = join(dir, 'silent.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', silent,
  ]);
  // Two downloaded sections: video 1..6 of the tone (clip 2..5 s) and 9..14 of the silence (clip 10..13 s).
  const secTone = join(dir, 'sec tone.mp4');
  ff(['-ss', '1', '-i', src, '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', secTone]);
  const secSilent = join(dir, 'sec silent.mp4');
  ff(['-ss', '9', '-i', silent, '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', secSilent]);
  fx = { dir, src, gap, section, words, gapWords, secTone, secSilent };
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
  assert.equal(r.notes.length, 1, r.notes.join('; '));
  assert.match(r.notes[0], /^Faces unavailable, every shot is Fit: .*onnxruntime-node is not installed/);
  assert.ok(!r.notes.some((n) => /kit has none/.test(n)), 'a kit with no logo is the run\'s note (tools/render.mjs), not each clip\'s');
  assert.deepEqual(r.layouts, ['fit']);
  assert.deepEqual(r.cuts, []);
  assert.deepEqual(r.window, { start: 0, end: 20 });
  assert.equal(existsSync(join(run, 'render', 'clip-01')), false, 'the work folder is gone');
  assert.equal(existsSync(join(run, 'render')), false, 'and so is the empty render folder it was in');
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

test('CLI with a kit that has no logo: "No logo: the kit has none." once, in the run\'s notes, and in no clip\'s', { skip }, () => {
  const run = runFolder([clipRow(1, 2, 5), clipRow(2, 10, 13)]);
  const r = cli(['--run', run, '--all', '--src', fx.src], { BOQO_HOME: emptyHome() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = last(r);
  assert.deepEqual(out.rendered.map((x) => x.n), [1, 2]);
  assert.deepEqual(out.notes, ['No logo: the kit has none.']);
  for (const x of [...out.rendered, ...readRecord(run).clips]) assert.ok(!x.notes.some((n) => /^No logo/.test(n)), JSON.stringify(x.notes));
});

test('CLI with sections.json: each clip renders from its own section; a section too short for its clip fails that clip only', { skip }, () => {
  const run = runFolder([clipRow(1, 6, 9), clipRow(2, 14, 17)]);
  // clip 1 from the section (video 5..13); clip 2 is claimed by an entry that says 5..20 for the same 8 s file.
  writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: fx.section, offset: 1, s: 5, e: 13 }, { pick: 1, file: fx.section, offset: 9, s: 5, e: 20 }] }));
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
  assert.equal(last(r).notes, undefined, 'the kit names a logo: no run note');
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

test('CLI after clips order re-ranks the rows: --n renders each clip from the section that holds its seconds, not the one at its place', { skip }, () => {
  // Fetched as picks 0 = the clip at 2..5 (tone), 1 = the clip at 10..13 (silence); then ranked: 10..13 is n 1, first.
  const run = runFolder([clipRow(1, 10, 13), clipRow(2, 2, 5)]);
  writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: [
    { pick: 0, file: fx.secTone, offset: 1, s: 1, e: 6 },
    { pick: 1, file: fx.secSilent, offset: 1, s: 9, e: 14 },
  ] }));
  const home = emptyHome();
  const first = cli(['--run', run, '--n', '1'], { BOQO_HOME: home });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = cli(['--run', run, '--n', '2'], { BOQO_HOME: home });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const rec = readRecord(run);
  const loudness = (r) => r.notes.filter((n) => /^Loudness not normalised/.test(n));
  assert.equal(loudness(rec.clips[0]).length, 1, 'clip 1 (10..13 s) came from the silent section');
  assert.equal(loudness(rec.clips[1]).length, 0, 'clip 2 (2..5 s) came from the tone section');
  assert.deepEqual(rec.clips.map((c) => c.window), [{ start: 10, end: 13 }, { start: 2, end: 5 }]);
});

test('CLI with a subset of sections: a covered clip renders, an uncovered one is refused by name; an older sections.json is refused', { skip }, () => {
  const run = runFolder([clipRow(1, 10, 13), clipRow(2, 2, 5)]);
  writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: fx.secSilent, offset: 1, s: 9, e: 14 }] }));
  const home = emptyHome();
  const refused = cli(['--run', run, '--n', '2'], { BOQO_HOME: home });
  assert.equal(refused.status, 1);
  assert.match(last(refused).error, /^no section in sections\.json holds clip 2 \(2-5 s\): fetch its section$/);
  assert.equal(readRecord(run).clips[1].rendered, false);
  const ok = cli(['--run', run, '--n', '1'], { BOQO_HOME: home });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(readRecord(run).clips[0].rendered, true);
  writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: fx.secSilent, offset: 1 }] }));
  assert.match(last(cli(['--run', run, '--n', '1'], { BOQO_HOME: home })).error, /re-fetch sections/);
});

// The encode's filter graph and argv, as the render hands them to ffmpeg.
function spying() {
  const encodes = [];
  const exec = (command, args, options) => {
    if (command === 'ffmpeg' && args.includes('-filter_complex')) encodes.push(args);
    return realExec(command, args, options);
  };
  return { exec, encodes, graph: () => encodes.at(-1)[encodes.at(-1).indexOf('-filter_complex') + 1] };
}

test('renderClip: the stream panels read is used only when its status is ok and its content is not other; the Default kit draws headline.ass', { skip }, async () => {
  const sample = (t) => ({ sourceSec: t, mode: 'panels', cameras: [{ x: 0.72, y: 0.05, w: 0.26, h: 0.3 }], game: { x: 0, y: 0, w: 1, h: 1 }, focus: null, why: 'x' });
  const read = (over = {}) => ({ version: 1, status: 'ok', promptVersion: 'v', model: 'agent', content: 'stream_with_game', gameTitle: null, samples: [sample(2.5), sample(3.5), sample(4.5)], trigger: 'first', ...over });
  const go = async (name, panels) => {
    const spy = spying();
    const r = await renderClip({ run: join(fx.dir, name), row: row({ panels }), brand: defaultBrand('t'), sourceFile: fx.src, words: fx.words, exec: spy.exec, load: noRuntime });
    return { r, graph: spy.graph() };
  };
  const used = await go('run panels ok', read());
  assert.deepEqual(used.r.layouts, ['panels']);
  assert.match(used.graph, /vstack=inputs=2/);
  // The Default kit's title plate: its own pass, after the captions.
  assert.match(used.graph, /subtitles=filename=[^;]*captions\.ass[^;]*\[vcapped\];\[vcapped\]subtitles=filename=[^;]*headline\.ass/);
  const other = await go('run panels other', read({ content: 'other' }));
  assert.deepEqual(other.r.layouts, ['fit']);
  assert.doesNotMatch(other.graph, /vstack/);
  const failed = await go('run panels failed', { version: 1, status: 'failed', reason: 'the read failed' });
  assert.deepEqual(failed.r.layouts, ['fit']);
  assert.match(failed.graph, /headline\.ass/);
});

test('renderClip: an encode failure on the logo costs the logo; any other encode failure fails the clip as itself', { skip }, async () => {
  const good = join(fx.dir, 'retry logo.png');
  writeFileSync(good, PNG);
  const kit = { ...defaultBrand('t'), logo: { ...defaultBrand('t').logo, file: good } };
  const failingOnce = (stderr) => {
    let failed = false;
    return (command, args, options) => {
      if (!failed && command === 'ffmpeg' && args.includes('-filter_complex') && args.includes('-loop')) {
        failed = true;
        return Promise.reject(Object.assign(new Error('ffmpeg failed (exit 1)'), { stderr }));
      }
      return realExec(command, args, options);
    };
  };
  const listing = `Input #1, png_pipe, from '${good}':\n  Duration: N/A\n  Stream #1:0: Video: png, rgba, 1x1\n`;
  const logoBroke = await renderClip({ run: join(fx.dir, 'run retry logo'), row: row(), brand: kit, sourceFile: fx.src, words: fx.words, exec: failingOnce(listing + '[png @ 0x1] chunk too big\n'), load: noRuntime });
  assert.ok(existsSync(logoBroke.file));
  assert.equal(logoBroke.notes.filter((n) => /^No logo: ffmpeg could not draw it/.test(n)).length, 1);
  await assert.rejects(
    renderClip({ run: join(fx.dir, 'run retry other'), row: row(), brand: kit, sourceFile: fx.src, words: fx.words, exec: failingOnce(listing + '[libx264 @ 0x2] Error initializing output stream\n'), load: noRuntime }),
    /ffmpeg failed \(exit 1\)/,
  );
});

test('logoFailure reads the message lines, not the input listing that names the logo on every run', () => {
  const listing = "Input #0, mov,mp4, from 'window.mp4':\nInput #1, png_pipe, from '/k/logo.png':\n  Stream #1:0: Video: png\n";
  assert.equal(logoFailure(listing + '[libx264 @ 0x1] broken\n', '/k/logo.png'), false);
  assert.equal(logoFailure(listing + '[png @ 0x1] chunk too big\n', '/k/logo.png'), true);
  assert.equal(logoFailure(listing + 'Error opening input file /k/logo.png.\n', '/k/logo.png'), true);
  assert.equal(logoFailure(listing + 'Error while decoding stream #1:0: Invalid data found\n', '/k/logo.png'), true);
  assert.equal(logoFailure(listing + '[Parsed_colorchannelmixer_2 @ 0x1] Failed to configure input pad\n', '/k/logo.png'), true);
  assert.equal(logoFailure('C:\\k\\logo.png: Invalid data found when processing input', 'C:\\k\\logo.png'), true);
});

test('renderClip: a PNG that is damaged after its signature is caught before the encode (which it would keep from ending): no logo, one note', { skip }, async () => {
  const bad = join(fx.dir, 'damaged logo.png');
  writeFileSync(bad, Buffer.concat([PNG.subarray(0, 8), Buffer.from('garbagegarbagegarbage')]));
  const kit = { ...defaultBrand('t'), logo: { ...defaultBrand('t').logo, file: bad } };
  const r = await renderClip({ run: join(fx.dir, 'run damaged logo'), row: row(), brand: kit, sourceFile: fx.src, words: fx.words, load: noRuntime });
  assert.ok(existsSync(r.file));
  const notes = r.notes.filter((n) => /logo/i.test(n));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^No logo: ffmpeg cannot read it/);
});
