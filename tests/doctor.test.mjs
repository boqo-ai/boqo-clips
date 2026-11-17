import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_FONTS, hintsFor, runChecks, isOk, ytDlpAtLeast, MIN_YTDLP } from '../engine/doctor.mjs';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const chk = (name, ok, detail = '', required = true) => ({ name, ok, detail, required });
const fail = (name, detail = '', required = true) => chk(name, false, detail, required);
const all = (list, text) => list.some((l) => l.includes(text));

// ---- hintsFor: the right fix per OS

test('hintsFor darwin: ffmpeg-full that the engine finds by itself, yt-dlp, whisper-cpp; no PATH line', () => {
  const h = hintsFor([fail('ffmpeg'), fail('yt-dlp'), fail('whisper')], 'darwin');
  assert.ok(all(h, '`brew install ffmpeg-full`'));
  assert.ok(all(h, 'finds it by itself'));
  assert.ok(all(h, 'brew install yt-dlp'));
  assert.ok(all(h, 'brew install whisper-cpp'));
  // each agent command is a new shell: an export would be gone by the next one
  assert.ok(!all(h, 'export PATH'));
  assert.ok(!all(h, 'keg-only'));
  assert.equal(h.length, 3);
});

test('hintsFor darwin: missing filters means plain ffmpeg, so ffmpeg-full', () => {
  const h = hintsFor([fail('ffmpeg-filters', 'missing filters: ass')], 'darwin');
  assert.equal(h.length, 1);
  assert.ok(all(h, 'brew install ffmpeg-full'));
  assert.ok(!all(h, 'export PATH'));
});

test('hintsFor win32: winget ids and the whisper.cpp release zip, then restart the agent once', () => {
  const h = hintsFor([fail('ffmpeg'), fail('yt-dlp'), fail('whisper')], 'win32');
  assert.ok(all(h, 'winget install Gyan.FFmpeg'));
  assert.ok(all(h, 'winget install yt-dlp.yt-dlp'));
  assert.ok(all(h, 'https://github.com/ggml-org/whisper.cpp/releases'));
  assert.ok(!all(h, 'brew'));
  assert.equal(h.filter((l) => l.includes('restart the agent')).length, 1);
  assert.match(h.at(-1), /restart the agent so it sees the new PATH/);
});

test('hintsFor: the restart line is for Windows installs only', () => {
  assert.ok(!all(hintsFor([fail('ffmpeg')], 'darwin'), 'restart the agent'));
  assert.ok(!all(hintsFor([fail('ffmpeg')], 'linux'), 'restart the agent'));
  assert.ok(!all(hintsFor([fail('whisper-model', 'no ggml model found')], 'win32'), 'restart the agent'));
  assert.ok(!all(hintsFor([fail('ffmpeg-https', 'no network or blocked', false)], 'win32'), 'restart the agent'));
});

test('hintsFor linux: ffmpeg-https crash names the distro package and the BtbN build', () => {
  const h = hintsFor([fail('ffmpeg-https', 'ffmpeg crashed on HTTPS input (exit 139)', false)], 'linux');
  assert.equal(h.length, 1);
  assert.ok(all(h, '139'));
  assert.ok(all(h, 'BtbN'));
  assert.ok(all(h, 'github.com/BtbN/FFmpeg-Builds'));
  assert.ok(all(h, 'apt install ffmpeg'));
});

test('hintsFor ffmpeg-https with no network: says the ranged download falls back, no reinstall advice', () => {
  const h = hintsFor([fail('ffmpeg-https', 'no network or blocked', false)], 'linux');
  assert.equal(h.length, 1);
  assert.ok(all(h, 'whole download'));
  assert.ok(!all(h, 'BtbN'));
});

test('hintsFor: model download line goes to ~/.boqo/models/', () => {
  const was = process.env.BOQO_HOME;
  delete process.env.BOQO_HOME;
  try {
    for (const p of ['darwin', 'win32', 'linux']) {
      const h = hintsFor([fail('whisper-model', 'no ggml model found')], p);
      assert.equal(h.length, 1);
      assert.ok(all(h, 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'), p);
      assert.ok(all(h, '~/.boqo/models/'), p);
    }
  } finally {
    if (was !== undefined) process.env.BOQO_HOME = was;
  }
});

test('hintsFor: one line per failed check, none for passed ones, streamlink per OS', () => {
  assert.deepEqual(hintsFor([chk('node', true, 'node 22.1.0'), chk('ffmpeg', true, 'ffmpeg 7 at /x')], 'linux'), []);
  assert.ok(all(hintsFor([fail('streamlink', '', false)], 'darwin'), 'brew install streamlink'));
  assert.ok(all(hintsFor([fail('streamlink', '', false)], 'win32'), 'winget install Streamlink.Streamlink'));
  assert.ok(all(hintsFor([fail('streamlink', '', false)], 'linux'), 'streamlink'));
  assert.ok(all(hintsFor([fail('node', 'node 18.0.0, need 22+')], 'linux'), 'nodejs.org'));
});

test('hintsFor: a too-old yt-dlp says upgrade, a missing one says install', () => {
  const old = hintsFor([fail('yt-dlp', `yt-dlp 2025.1.1 is older than ${MIN_YTDLP}`)], 'darwin');
  assert.ok(all(old, 'brew upgrade yt-dlp'));
  const old2 = hintsFor([fail('yt-dlp', `yt-dlp 2025.1.1 is older than ${MIN_YTDLP}`)], 'win32');
  assert.ok(all(old2, 'winget upgrade yt-dlp.yt-dlp'));
  assert.ok(all(hintsFor([fail('yt-dlp', 'not found on PATH')], 'darwin'), 'brew install yt-dlp'));
});

test('hintsFor linux yt-dlp: the release binary or pipx with its extras, never a bare pip install', () => {
  for (const detail of ['not found on PATH', `yt-dlp 2025.1.1 is older than ${MIN_YTDLP}`]) {
    const h = hintsFor([fail('yt-dlp', detail)], 'linux');
    assert.equal(h.length, 1);
    assert.ok(all(h, 'curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp'), h[0]);
    assert.ok(all(h, 'chmod +x ~/.local/bin/yt-dlp'));
    assert.ok(all(h, 'pipx install "yt-dlp[default]"'));
    assert.ok(!all(h, 'pip install -U yt-dlp'));
  }
});

test('hintsFor: a missing ffprobe gets the ffmpeg install line; with ffmpeg missing too, only one', () => {
  for (const p of ['darwin', 'win32', 'linux']) {
    const one = hintsFor([fail('ffprobe', 'not found on PATH')], p);
    const ff = hintsFor([fail('ffmpeg', 'not found on PATH')], p);
    assert.equal(one[0], ff[0].replace(/^ffmpeg:/, 'ffprobe:'), p);
    const both = hintsFor([fail('ffmpeg', 'not found on PATH'), fail('ffprobe', 'not found on PATH')], p);
    assert.equal(both.filter((l) => /^ff/.test(l)).length, 1, p);
  }
});

test('hintsFor: with ffmpeg missing, its dependents add no second ffmpeg line', () => {
  const h = hintsFor([fail('ffmpeg', 'not found on PATH'), fail('ffmpeg-filters', 'needs ffmpeg'), fail('ffmpeg-https', 'needs ffmpeg', false)], 'linux');
  assert.equal(h.length, 1);
  const w = hintsFor([fail('ffmpeg', 'not found on PATH'), fail('ffmpeg-filters', 'needs ffmpeg'), fail('ffmpeg-https', 'needs ffmpeg', false)], 'win32');
  assert.deepEqual(w.map((l) => l.split(':')[0]), ['ffmpeg', 'After installing, restart the agent so it sees the new PATH.']);
});

// ---- the verdict and the version rule

test('isOk: only required checks decide', () => {
  assert.equal(isOk([chk('node', true), fail('ffmpeg-https', 'no network or blocked', false)]), true);
  assert.equal(isOk([chk('node', true), fail('ffmpeg')]), false);
  assert.equal(isOk([]), true);
});

test('ytDlpAtLeast compares dated versions', () => {
  assert.equal(MIN_YTDLP, '2026.10.26');
  assert.equal(ytDlpAtLeast('2026.10.26'), true);
  assert.equal(ytDlpAtLeast('2026.10.26.232815'), true);
  assert.equal(ytDlpAtLeast('2026.11.02'), true);
  assert.equal(ytDlpAtLeast('2027.1.1'), true);
  assert.equal(ytDlpAtLeast('2026.10.25'), false);
  assert.equal(ytDlpAtLeast('2025.12.31'), false);
  assert.equal(ytDlpAtLeast('garbage'), false);
});

// ---- runChecks against a controlled PATH (no dependence on the runner's tools)

async function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test('runChecks on an empty PATH: tools fail with where-to-look details, node still passes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-'));
  try {
    const checks = await withEnv({ PATH: dir, Path: dir, BOQO_HOME: dir, BOQO_WHISPER_MODEL: undefined, HOME: dir, USERPROFILE: dir }, () =>
      runChecks({ nodeMin: 20, whisper: 'required', streamlink: true, env: process.env }),
    );
    const c = byName(checks);
    assert.deepEqual(checks.map((x) => x.name), ['node', 'ffmpeg', 'ffprobe', 'ffmpeg-filters', 'ffmpeg-https', 'yt-dlp', 'whisper', 'whisper-model', 'onnxruntime', 'fonts', 'streamlink']);
    assert.equal(c.node.ok, true);
    assert.match(c.node.detail, /^node \d+\.\d+\.\d+/);
    for (const n of ['ffmpeg', 'ffprobe', 'ffmpeg-filters', 'yt-dlp', 'whisper', 'whisper-model']) assert.equal(c[n].ok, false, n);
    assert.equal(c.ffprobe.required, true);
    assert.equal(c['ffmpeg-https'].ok, false);
    assert.equal(c.whisper.required, true);
    assert.equal(c['whisper-model'].required, true);
    assert.equal(c['ffmpeg-https'].required, false);
    assert.equal(c.streamlink.required, false);
    assert.equal(isOk(checks), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runChecks: node too old fails; whisper optional and no streamlink flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-'));
  try {
    const checks = await withEnv({ PATH: dir, Path: dir, BOQO_HOME: dir, BOQO_WHISPER_MODEL: undefined, HOME: dir, USERPROFILE: dir }, () =>
      runChecks({ nodeMin: 99, whisper: 'optional', env: process.env }),
    );
    const c = byName(checks);
    assert.equal(c.node.ok, false);
    assert.match(c.node.detail, /need 99/);
    assert.equal(c.whisper.required, false);
    assert.equal(c['whisper-model'].required, false);
    assert.equal(c.streamlink, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const posix = { skip: process.platform === 'win32' && 'needs sh scripts' };

function fakeBin(scripts) {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-bin-'));
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const FFMPEG_OK = `case "$*" in
  *-version*) echo "ffmpeg version 7.1.1 Copyright (c) the FFmpeg developers";;
  *-filters*) echo " ... ass               V->V       Render ASS subtitles"; echo " ... ebur128           A->N       EBU R128 scanner.";;
  *https://*) exit 0;;
esac`;

const FFPROBE_OK = 'echo "ffprobe version 7.1.1 Copyright (c) the FFmpeg developers"';

test('runChecks: ffmpeg without its ffprobe fails the required ffprobe check', posix, async () => {
  const bin = fakeBin({ ffmpeg: FFMPEG_OK, 'yt-dlp': 'echo 2026.10.26' });
  const broken = fakeBin({ ffmpeg: FFMPEG_OK, ffprobe: 'exit 3', 'yt-dlp': 'echo 2026.10.26' });
  try {
    const opts = { nodeMin: 20, whisper: 'optional', env: process.env };
    const checks = await withEnv({ PATH: bin, BOQO_HOME: bin, BOQO_WHISPER_MODEL: undefined }, () => runChecks(opts));
    const c = byName(checks);
    assert.equal(c.ffmpeg.ok, true);
    assert.equal(c.ffprobe.ok, false);
    assert.equal(c.ffprobe.required, true);
    assert.equal(c.ffprobe.detail, 'not found on PATH');
    assert.equal(isOk(checks), false);
    assert.ok(all(hintsFor(checks.filter((x) => !x.ok), 'linux'), 'ffprobe: install a full ffmpeg'));
    const b = byName(await withEnv({ PATH: broken, BOQO_HOME: broken, BOQO_WHISPER_MODEL: undefined }, () => runChecks(opts)));
    assert.equal(b.ffprobe.ok, false);
    assert.match(b.ffprobe.detail, /did not run \(exit 3\)/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});

test('runChecks with fake tools: everything present is ok, details carry versions and paths', posix, async () => {
  const bin = fakeBin({
    ffmpeg: FFMPEG_OK,
    ffprobe: FFPROBE_OK,
    'yt-dlp': 'echo 2026.10.26',
    'whisper-cli': 'echo usage',
    streamlink: 'echo "streamlink 7.1.2"',
  });
  const home = mkdtempSync(join(tmpdir(), 'boqo-doctor-home-'));
  writeFileSync(join(home, 'ggml-base.bin'), 'x');
  try {
    const checks = await withEnv({ PATH: bin, BOQO_HOME: home, BOQO_WHISPER_MODEL: join(home, 'ggml-base.bin') }, () =>
      runChecks({ nodeMin: 20, whisper: 'required', streamlink: true, env: process.env }),
    );
    for (const x of checks) assert.equal(x.ok, true, `${x.name}: ${x.detail}`);
    const c = byName(checks);
    assert.equal(c.ffmpeg.detail, `ffmpeg 7.1.1 at ${join(bin, 'ffmpeg')}`);
    assert.equal(c.ffprobe.detail, `ffprobe 7.1.1 at ${join(bin, 'ffprobe')}`);
    assert.equal(c['yt-dlp'].detail, `yt-dlp 2026.10.26 at ${join(bin, 'yt-dlp')}`);
    assert.ok(c.whisper.detail.includes(join(bin, 'whisper-cli')));
    assert.ok(c['whisper-model'].detail.includes('ggml-base.bin'));
    assert.ok(c.streamlink.detail.includes('streamlink 7.1.2'));
    assert.equal(isOk(checks), true);
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('runChecks: an ffmpeg that dies with SIGSEGV on HTTPS fails ffmpeg-https with the BtbN hint', posix, async () => {
  const bin = fakeBin({
    ffmpeg: FFMPEG_OK.replace('*https://*) exit 0;;', () => '*https://*) kill -SEGV $$;;'),
    'yt-dlp': 'echo 2026.10.26',
  });
  try {
    const checks = await withEnv({ PATH: bin, BOQO_HOME: bin, BOQO_WHISPER_MODEL: undefined }, () => runChecks({ nodeMin: 20, whisper: 'optional', env: process.env }));
    const c = byName(checks);
    assert.equal(c.ffmpeg.ok, true);
    assert.equal(c['ffmpeg-filters'].ok, true);
    assert.equal(c['ffmpeg-https'].ok, false);
    assert.match(c['ffmpeg-https'].detail, /crash/);
    assert.equal(c['ffmpeg-https'].required, false);
    assert.ok(all(hintsFor(checks.filter((x) => !x.ok), 'linux'), 'BtbN'));
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('runChecks: an HTTPS failure that is not a crash is "no network or blocked"; a build without TLS says so', posix, async () => {
  const net = fakeBin({ ffmpeg: FFMPEG_OK.replace('*https://*) exit 0;;', () => '*https://*) echo "Connection refused" >&2; exit 1;;') });
  const tls = fakeBin({ ffmpeg: FFMPEG_OK.replace('*https://*) exit 0;;', () => '*https://*) echo "Protocol not found" >&2; exit 1;;') });
  try {
    const opts = { nodeMin: 20, whisper: 'optional', env: process.env };
    const a = byName(await withEnv({ PATH: net, BOQO_HOME: net, BOQO_WHISPER_MODEL: undefined }, () => runChecks(opts)));
    assert.equal(a['ffmpeg-https'].ok, false);
    assert.equal(a['ffmpeg-https'].detail, 'no network or blocked');
    const b = byName(await withEnv({ PATH: tls, BOQO_HOME: tls, BOQO_WHISPER_MODEL: undefined }, () => runChecks(opts)));
    assert.equal(b['ffmpeg-https'].detail, 'ffmpeg has no HTTPS support');
    assert.ok(all(hintsFor([b['ffmpeg-https']], 'linux'), 'without HTTPS support'));
  } finally {
    rmSync(net, { recursive: true, force: true });
    rmSync(tls, { recursive: true, force: true });
  }
});

test('runChecks: ffmpeg without libass fails ffmpeg-filters; an old yt-dlp fails yt-dlp', posix, async () => {
  const bin = fakeBin({
    ffmpeg: FFMPEG_OK.replace(' ... ass               V->V       Render ASS subtitles', ' ... aformat          A->A       Convert'),
    'yt-dlp': 'echo 2025.1.1',
  });
  try {
    const checks = await withEnv({ PATH: bin, BOQO_HOME: bin, BOQO_WHISPER_MODEL: undefined }, () => runChecks({ nodeMin: 20, whisper: 'optional', env: process.env }));
    const c = byName(checks);
    assert.equal(c['ffmpeg-filters'].ok, false);
    assert.match(c['ffmpeg-filters'].detail, /\bass\b/);
    assert.equal(c['yt-dlp'].ok, false);
    assert.match(c['yt-dlp'].detail, /older than 2026\.10\.26/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('runChecks looks for and runs the tools on the PATH of the env it is given', posix, async () => {
  const bin = fakeBin({ ffmpeg: FFMPEG_OK, 'yt-dlp': 'echo 2026.10.26' });
  const empty = mkdtempSync(join(tmpdir(), 'boqo-doctor-empty-'));
  try {
    const checks = await withEnv({ PATH: empty, BOQO_HOME: empty, BOQO_WHISPER_MODEL: undefined }, () =>
      runChecks({ nodeMin: 20, whisper: 'optional', env: { ...process.env, PATH: bin } }),
    );
    const c = byName(checks);
    assert.equal(c.ffmpeg.ok, true, c.ffmpeg.detail);
    assert.equal(c.ffmpeg.detail, `ffmpeg 7.1.1 at ${join(bin, 'ffmpeg')}`);
    assert.equal(c['ffmpeg-filters'].ok, true);
    assert.equal(c['yt-dlp'].ok, true);
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

// ---- the CLI

test('tools/doctor.mjs prints one JSON line, exits 0 even when checks fail, and only looks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-cli-'));
  try {
    const script = fileURLToPath(new URL('../tools/doctor.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script, '--node', '20', '--whisper', 'required', '--streamlink'], {
      encoding: 'utf8',
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')), PATH: dir, BOQO_HOME: dir, BOQO_WHISPER_MODEL: '', HOME: dir, USERPROFILE: dir },
    });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const out = JSON.parse(lines[0]);
    assert.equal(out.ok, false);
    assert.equal(out.checks.length, 11);
    assert.ok(out.hints.length >= 4);
    const bad = spawnSync(process.execPath, [script, '--node', '18'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(JSON.parse(bad.stdout).error, /--node/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- onnxruntime-node and the face model

test('runChecks: onnxruntime-node runs the face model here (the real binary), a required check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-'));
  try {
    const checks = await withEnv({ PATH: dir, Path: dir, BOQO_HOME: dir, BOQO_WHISPER_MODEL: undefined }, () =>
      runChecks({ nodeMin: 20, whisper: 'optional', env: process.env }),
    );
    const c = byName(checks);
    assert.equal(c.onnxruntime.ok, true, c.onnxruntime.detail);
    assert.equal(c.onnxruntime.required, true);
    assert.equal(c.onnxruntime.detail, 'onnxruntime-node runs the face model');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runChecks: onnxruntime-node that does not load fails the check with the cause, classified on loadBlazeFace codes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-doctor-'));
  try {
    const run = async (loadOnnx) =>
      byName(await withEnv({ PATH: dir, Path: dir, BOQO_HOME: dir, BOQO_WHISPER_MODEL: undefined }, () => runChecks({ nodeMin: 20, whisper: 'optional', env: process.env, loadOnnx }))).onnxruntime;
    const dll = await run(async () => { throw new Error('The specified module could not be found.\r\n\\\\?\\C:\\x\\onnxruntime_binding.node'); });
    assert.equal(dll.ok, false);
    assert.equal(dll.required, true);
    assert.equal(dll.detail, 'onnxruntime-node did not load: The specified module could not be found.');
    assert.equal(dll.cause, 'runtime');
    assert.equal(isOk([dll]), false);
    // Node's own error for a package that is not there
    const absent = await run(() => import('onnxruntime-node-is-not-a-package'));
    assert.equal(absent.detail, 'onnxruntime-node is not installed');
    assert.equal(absent.cause, 'not-installed');
    // onnxruntime's wording never decides the class: "face model" and "missing" from a session error stay runtime
    const session = await run(async () => ({ Tensor: class {}, InferenceSession: { create: async () => { throw new Error('the face model is missing a required input'); } } }));
    assert.equal(session.detail, 'onnxruntime-node could not open the face model: the face model is missing a required input');
    assert.equal(session.cause, 'runtime');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hintsFor onnxruntime: VC++ runtime on Windows, the packages reinstalled elsewhere, npm ci when not installed', () => {
  const runtime = (detail) => ({ ...fail('onnxruntime', detail), cause: 'runtime' });
  const win = hintsFor([runtime('onnxruntime-node did not load: The specified module could not be found.')], 'win32');
  assert.equal(win.length, 1, 'no restart line: a runtime install changes no PATH');
  assert.ok(all(win, 'Visual C++ 2019 or newer redistributable'));
  assert.ok(all(win, 'https://aka.ms/vs/17/release/vc_redist.x64.exe'));
  assert.ok(all(win, 'The specified module could not be found.'));
  for (const p of ['darwin', 'linux']) {
    const h = hintsFor([runtime('onnxruntime-node did not load: dlopen failed')], p);
    assert.equal(h.length, 1, p);
    assert.ok(all(h, '`cd "$HOME/.boqo-clips" && npm ci --omit=dev --ignore-scripts`'), p);
    assert.ok(all(h, 'dlopen failed'), p);
    assert.ok(!all(h, 'Visual C++'), p);
  }
  const absent = { ...fail('onnxruntime', 'onnxruntime-node is not installed'), cause: 'not-installed' };
  for (const p of ['darwin', 'linux']) {
    assert.deepEqual(hintsFor([absent], p), ["onnxruntime: the skill's packages are not installed: `cd \"$HOME/.boqo-clips\" && npm ci --omit=dev --ignore-scripts`"], p);
  }
  // Windows PowerShell 5.1 has no &&
  const winAbsent = hintsFor([absent], 'win32');
  assert.deepEqual(winAbsent, ["onnxruntime: the skill's packages are not installed: `cd \"$HOME/.boqo-clips\"; npm ci --omit=dev --ignore-scripts`"]);
  assert.ok(!all(winAbsent, '&&'));
  const model = hintsFor([{ ...fail('onnxruntime', "the face model's checksum does not match (x: a, expected b)"), cause: 'model' }], 'linux');
  assert.ok(all(model, 'reinstall the skill (https://github.com/boqo-ai/boqo-clips)'));
  // the class comes from `cause`, not from the words: a runtime error mentioning a missing face model is not a damaged copy
  const words = hintsFor([runtime('onnxruntime-node could not open the face model: the face model is missing a required input')], 'linux');
  assert.ok(!all(words, 'reinstall the skill (https'));
  assert.ok(all(words, 'npm ci'));
});

// ---- the bundled fonts

const FONTS = fileURLToPath(new URL('../engine/fonts/', import.meta.url));

test('BUNDLED_FONTS is every face engine/fonts holds, and the check passes on the shipped folder', async () => {
  const shipped = readdirSync(FONTS).filter((f) => /\.(ttf|otf)$/.test(f)).sort();
  assert.deepEqual([...BUNDLED_FONTS].sort(), shipped);
  const checks = await runChecks({ nodeMin: 20, whisper: 'optional', env: { PATH: '' } });
  const f = byName(checks).fonts;
  assert.equal(f.ok, true, f.detail);
  assert.equal(f.required, true);
});

test('runChecks: a missing or empty face fails the required fonts check, and the hint restores it with a command PowerShell 5.1 runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo doctor fonts '));
  try {
    for (const name of BUNDLED_FONTS) copyFileSync(join(FONTS, name), join(dir, name));
    rmSync(join(dir, 'Anton-Regular.ttf'));
    writeFileSync(join(dir, 'Bangers-Regular.ttf'), '');
    const checks = await runChecks({ nodeMin: 20, whisper: 'optional', env: { PATH: '' }, fontsDir: dir });
    const f = byName(checks).fonts;
    assert.equal(f.ok, false);
    assert.equal(f.detail, 'missing or empty: Anton-Regular.ttf, Bangers-Regular.ttf');
    for (const p of ['darwin', 'win32', 'linux']) {
      const h = hintsFor([f], p);
      assert.equal(h.length, 1, p);
      assert.match(h[0], /git -C "\$HOME\/\.boqo-clips" checkout -- engine\/fonts/);
      assert.ok(!h[0].includes('&&'), p);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
