import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipAss, ffmpegArgs, renderClip } from '../engine/render.mjs';
import { defaultBrand, saveBrand } from '../engine/brand.mjs';

const CLI = fileURLToPath(new URL('../tools/render.mjs', import.meta.url));

const base = (over = {}) => ({
  input: 'src.mp4',
  startSec: 3,
  durSec: 12,
  ass: 'captions.ass',
  logo: 'logo.png',
  brand: defaultBrand('t'),
  layout: 'blur',
  fps: 30,
  out: 'out.mp4',
  fontsDir: 'fonts',
  ...over,
});

const filterOf = (args) => args[args.indexOf('-filter_complex') + 1];
const count = (s, re) => (s.match(re) ?? []).length;

test('ffmpegArgs blur: blurred fill behind a fitted copy, captions, logo, loudnorm', () => {
  const args = ffmpegArgs(base());
  const f = filterOf(args);
  assert.match(f, /boxblur/);
  assert.ok(count(f, /scale=/g) >= 2, 'two scales at least');
  assert.match(f, /overlay/);
  const ass = f.indexOf('ass=captions.ass:fontsdir=fonts');
  const logo = f.indexOf('overlay=W-w-48:48');
  const loud = f.indexOf('loudnorm=I=-14:TP=-1.5:LRA=11');
  assert.ok(ass > 0, 'ass filter');
  assert.ok(logo > ass, 'logo overlay after the captions');
  assert.ok(loud > logo, 'loudnorm after the logo');
});

test('ffmpegArgs crop: centre crop to 9:16', () => {
  const f = filterOf(ffmpegArgs(base({ layout: 'crop' })));
  assert.match(f, /crop=ih\*9\/16:ih/);
  assert.doesNotMatch(f, /boxblur/);
  assert.ok(f.indexOf('ass=captions.ass:fontsdir=fonts') > f.indexOf('crop='));
});

test('ffmpegArgs output encoding', () => {
  const args = ffmpegArgs(base({ fps: 29.97 }));
  const pair = (k) => args[args.indexOf(k) + 1];
  assert.equal(pair('-c:v'), 'libx264');
  assert.equal(pair('-preset'), 'veryfast');
  assert.equal(pair('-crf'), '20');
  assert.equal(pair('-pix_fmt'), 'yuv420p');
  assert.equal(pair('-c:a'), 'aac');
  assert.equal(pair('-b:a'), '128k');
  assert.equal(pair('-movflags'), '+faststart');
  assert.equal(pair('-r'), '29.97');
  assert.equal(pair('-ar'), '48000');
  assert.equal(pair('-ss'), '3');
  assert.equal(pair('-t'), '12');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), '-ss before -i (seek, then decode)');
  assert.equal(args.at(-1), 'out.mp4');
});

test('ffmpegArgs puts no absolute path in the filter string', () => {
  for (const layout of ['blur', 'crop']) {
    for (const logo of ['logo.png', null]) {
      const f = filterOf(ffmpegArgs(base({ layout, logo })));
      assert.doesNotMatch(f, /[A-Za-z]:[\\/]/, 'no drive path');
      assert.doesNotMatch(f, /\\/, 'no backslash');
      for (const tok of f.split(/[;,:=[\]]/)) {
        assert.ok(!tok.startsWith('/'), `token ${tok} starts with /`);
      }
    }
  }
});

test('ffmpegArgs logo: width from the brand, 48 px margin at each corner', () => {
  const at = (corner, scale = 0.16) => {
    const brand = { ...defaultBrand('t'), logo: { file: null, corner, scale } };
    return filterOf(ffmpegArgs(base({ brand })));
  };
  assert.match(at('tr'), /\[1:v\]scale=173:-1/);
  assert.match(at('tr', 0.3), /\[1:v\]scale=324:-1/);
  assert.match(at('tr'), /overlay=W-w-48:48/);
  assert.match(at('tl'), /overlay=48:48/);
  assert.match(at('bl'), /overlay=48:H-h-48/);
  assert.match(at('br'), /overlay=W-w-48:H-h-48/);
});

test('ffmpegArgs without a logo has no second input and no logo overlay', () => {
  const args = ffmpegArgs(base({ logo: null }));
  assert.equal(args.filter((a) => a === '-i').length, 1);
  assert.doesNotMatch(filterOf(args), /\[1:v\]/);
});

test('ffmpegArgs keeps the logo as the second input, relative', () => {
  const args = ffmpegArgs(base());
  const ins = args.map((a, i) => (a === '-i' ? args[i + 1] : null)).filter(Boolean);
  assert.deepEqual(ins, ['src.mp4', 'logo.png']);
});

test('ffmpegArgs with no audio maps no audio', () => {
  const args = ffmpegArgs(base({ hasAudio: false }));
  assert.doesNotMatch(filterOf(args), /loudnorm|\[0:a\]/);
  assert.ok(!args.includes('-c:a'));
});

test('clipAss shows the hook only when the brand has hook on', () => {
  const words = [{ w: 'hello', s: 10, e: 10.3 }, { w: 'world', s: 10.4, e: 10.7 }];
  const on = clipAss(words, 10, 14, { ...defaultBrand('t'), hook: true }, 'My big hook');
  const off = clipAss(words, 10, 14, { ...defaultBrand('t'), hook: false }, 'My big hook');
  assert.match(on, /My big hook/);
  assert.doesNotMatch(off, /My big hook/);
  assert.match(on, /hello/); // words are rebased: the first starts at 0
  assert.match(on, /Dialogue: 0,0:00:00\.00,/);
});

// ---- real ffmpeg -------------------------------------------------------------

const probe = (file, extra = ['-show_streams', '-show_format']) => {
  const r = spawnSync('ffprobe', ['-v', 'error', ...extra, '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

let fx;
function fixtures() {
  if (fx) return fx;
  const dir = mkdtempSync(join(tmpdir(), 'boqo-render-fx-'));
  const src = join(dir, 'source file.mp4'); // a space on purpose
  run([
    '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
  ]);
  const logo = join(dir, 'my logo.png'); // a space on purpose
  run(['-f', 'lavfi', '-i', 'color=c=0xFF0066:s=300x150,format=rgba', '-frames:v', '1', logo]);
  const words = Array.from({ length: 50 }, (_, i) => ({
    w: `word${i}`,
    s: Math.round(i * 0.4 * 1000) / 1000,
    e: Math.round((i * 0.4 + 0.3) * 1000) / 1000,
  }));
  const brand = { ...defaultBrand('fx'), logo: { file: logo, corner: 'tr', scale: 0.16 } };
  fx = { dir, src, logo, words, brand };
  return fx;
}

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo-render-t-'));
  return { root, outDir: join(root, 'out'), tmpRoot: join(root, 'work') };
};

test('renderClip makes a 1080x1920 h264 yuv420p clip of the right length, with audio', async () => {
  const { src, words, brand } = fixtures();
  const { root, outDir, tmpRoot } = sandbox();
  for (const layout of ['blur', 'crop']) {
    let log = '';
    const t0 = Date.now();
    const r = await renderClip({
      src, s: 3, e: 15, words, brand, layout, hook: 'Watch this', outDir, name: `clip-${layout}`,
      tmpRoot, loglevel: 'verbose', onLog: (t) => (log += t),
    });
    console.log(`# ${layout} render: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    assert.equal(r.out, join(outDir, `clip-${layout}.mp4`));
    assert.ok(existsSync(r.out));
    assert.ok(Math.abs(r.seconds - 12) <= 0.2, `duration ${r.seconds}`);
    const p = probe(r.out);
    const v = p.streams.find((s) => s.codec_type === 'video');
    const a = p.streams.find((s) => s.codec_type === 'audio');
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.pix_fmt, 'yuv420p');
    assert.equal(v.width, 1080);
    assert.equal(v.height, 1920);
    assert.ok(a, 'audio stream');
    assert.ok(Math.abs(Number(p.format.duration) - 12) <= 0.2);
    // the work folder is gone after a success
    assert.deepEqual(readdirSync(tmpRoot), []);
    // libass loaded the bundled Inter from the work folder's fonts/ (ffmpeg's cwd,
    // so the logged path is relative) and the style's font resolved to it: a
    // silent fallback would log another face
    const fontLog = log.split('\n').filter((l) => /font/i.test(l)).join('\n');
    assert.match(log, /Loading font file 'fonts[\\/]Inter-Bold\.ttf'/, fontLog);
    const line = log.split('\n').find((l) => /fontselect/.test(l) && /Inter/.test(l));
    console.log(`# fontselect (${layout}): ${line?.trim()}`);
    assert.ok(line, `no fontselect line resolving Inter:\n${fontLog}`);
    assert.match(line, /\(Inter, 700, 0\) -> Inter-Bold/);
  }
  rmSync(root, { recursive: true, force: true });
});

test('renderClip: a failed render keeps the work folder and names it', async () => {
  const { src, words, brand } = fixtures();
  const { root, outDir, tmpRoot } = sandbox();
  const fake = join(root, 'logo.png');
  writeFileSync(fake, 'not a png');
  const broken = { ...brand, logo: { ...brand.logo, file: fake } };
  await assert.rejects(renderClip({ src, s: 0, e: 5, words, brand: broken, outDir, name: 'x', tmpRoot }), (err) => {
    const m = /work folder kept at (.+)\)$/.exec(err.message);
    assert.ok(m, err.message);
    assert.ok(existsSync(m[1]), 'the folder is still there');
    assert.ok(existsSync(join(m[1], 'captions.ass')));
    assert.ok(existsSync(join(m[1], 'fonts', 'Inter-Bold.ttf')), 'the font is in the work folder');
    assert.ok(existsSync(join(m[1], 'logo.png')));
    return true;
  });
  assert.equal(existsSync(join(outDir, 'x.mp4')), false);
  rmSync(root, { recursive: true, force: true });
});

test('renderClip: a source ffprobe cannot read is a clear error', async () => {
  const { words, brand } = fixtures();
  const { root, outDir } = sandbox();
  const bad = join(root, 'not-a-video.mp4');
  mkdirSync(root, { recursive: true });
  writeFileSync(bad, 'nope');
  await assert.rejects(renderClip({ src: bad, s: 0, e: 5, words, brand, outDir, name: 'x' }), /ffprobe could not read/);
  rmSync(root, { recursive: true, force: true });
});

test('renderClip refuses a name that is a path', async () => {
  const { src, words, brand } = fixtures();
  const { root, outDir } = sandbox();
  await assert.rejects(renderClip({ src, s: 0, e: 5, words, brand, outDir, name: '../x' }), /name/);
  rmSync(root, { recursive: true, force: true });
});

// ---- the CLI -----------------------------------------------------------------

// a BOQO_HOME holding one saved kit (with the fixture logo)
async function homeWithKit(root) {
  const home = join(root, 'home');
  const prev = process.env.BOQO_HOME;
  process.env.BOQO_HOME = home;
  try {
    await saveBrand({ ...defaultBrand('kit'), hook: true }, fixtures().logo);
  } finally {
    if (prev === undefined) delete process.env.BOQO_HOME;
    else process.env.BOQO_HOME = prev;
  }
  return home;
}

const cli = (args, env = {}) =>
  new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });

test('CLI renders every pick and prints one JSON line', async () => {
  const { dir, src, words } = fixtures();
  const { root, outDir } = sandbox();
  const picks = join(dir, 'picks.json');
  writeFileSync(picks, JSON.stringify([{ s: 1, e: 5, title: 'First' }, { s: 6, e: 10, title: 'Second', hook: 'A hook' }]));
  const wf = join(dir, 'words.json');
  writeFileSync(wf, JSON.stringify(words));
  const home = await homeWithKit(root);
  const r = await cli(['--src', src, '--picks', picks, '--words', wf, '--layout', 'crop', '--out', outDir], { BOQO_HOME: home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.clips.length, 2);
  assert.deepEqual(j.clips.map((c) => [c.s, c.e, c.title]), [[1, 5, 'First'], [6, 10, 'Second']]);
  for (const c of j.clips) {
    assert.ok(existsSync(c.file), c.file);
    const p = probe(c.file);
    assert.equal(p.streams.find((s) => s.codec_type === 'video').height, 1920);
  }
  rmSync(root, { recursive: true, force: true });
});

test('CLI sections mode renders pick i from its own file at its offset', async () => {
  const { dir, src, words } = fixtures();
  const { root, outDir } = sandbox();
  // pick 0 is at 12-16 on the source timeline, but its file starts at the pick (offset 3 in "src")
  const picks = join(dir, 'picks-sec.json');
  writeFileSync(picks, JSON.stringify({ picks: [{ s: 12, e: 16, title: 'Sec' }] }));
  const sections = join(dir, 'sections.json');
  writeFileSync(sections, JSON.stringify({ files: [{ pick: 0, file: src, offset: 3 }] }));
  const wf = join(dir, 'words.json');
  writeFileSync(wf, JSON.stringify(words));
  const r = await cli(['--sections', sections, '--picks', picks, '--words', wf, '--out', outDir], { BOQO_HOME: await homeWithKit(root) });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.clips.length, 1);
  assert.ok(Math.abs(probe(j.clips[0].file).format.duration - 4) <= 0.2);
  rmSync(root, { recursive: true, force: true });
});

test('CLI wants exactly one of --src and --sections', async () => {
  const { dir, src, words } = fixtures();
  const picks = join(dir, 'p.json');
  writeFileSync(picks, '[]');
  const wf = join(dir, 'w.json');
  writeFileSync(wf, JSON.stringify(words));
  const both = await cli(['--src', src, '--sections', picks, '--picks', picks, '--words', wf, '--out', dir]);
  assert.equal(both.code, 1);
  assert.match(JSON.parse(both.stdout).error, /--src/);
  const none = await cli(['--picks', picks, '--words', wf, '--out', dir]);
  assert.equal(none.code, 1);
  assert.match(JSON.parse(none.stdout).error, /--src/);
});

test('CLI: a damaged brand kit is {"error"} and exit 1, no stack trace', async () => {
  const { dir, src, words } = fixtures();
  const home = mkdtempSync(join(tmpdir(), 'boqo-render-home-'));
  mkdirSync(join(home, 'brands', 'broken'), { recursive: true });
  writeFileSync(join(home, 'brands', 'broken', 'brand.json'), '{ not json');
  const picks = join(dir, 'p2.json');
  writeFileSync(picks, JSON.stringify([{ s: 1, e: 5 }]));
  const wf = join(dir, 'w2.json');
  writeFileSync(wf, JSON.stringify(words));
  const r = await cli(['--src', src, '--picks', picks, '--words', wf, '--brand', 'broken', '--out', join(home, 'o')], { BOQO_HOME: home });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /damaged/);
  assert.doesNotMatch(r.stderr, /\bat .*\.mjs/);
  rmSync(home, { recursive: true, force: true });
});

test('CLI: a missing flag value is {"error"}', async () => {
  const r = await cli(['--src']);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.stdout).error);
});
