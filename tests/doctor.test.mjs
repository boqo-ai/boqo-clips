import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hintsFor, runChecks, isOk, ytDlpAtLeast, MIN_YTDLP } from '../engine/doctor.mjs';

const chk = (name, ok, detail = '', required = true) => ({ name, ok, detail, required });
const fail = (name, detail = '', required = true) => chk(name, false, detail, required);
const all = (list, text) => list.some((l) => l.includes(text));

// ---- hintsFor: the right fix per OS

test('hintsFor darwin: ffmpeg-full, its PATH line, yt-dlp, whisper-cpp', () => {
  const h = hintsFor([fail('ffmpeg'), fail('yt-dlp'), fail('whisper')], 'darwin');
  assert.ok(all(h, 'brew install ffmpeg-full'));
  assert.ok(all(h, 'export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"'));
  assert.ok(all(h, 'brew install yt-dlp'));
  assert.ok(all(h, 'brew install whisper-cpp'));
});

test('hintsFor darwin: missing filters means plain ffmpeg, so ffmpeg-full and the PATH line', () => {
  const h = hintsFor([fail('ffmpeg-filters', 'missing filters: ass')], 'darwin');
  assert.ok(all(h, 'brew install ffmpeg-full'));
  assert.ok(all(h, 'export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"'));
  assert.equal(h.filter((l) => l.includes('export PATH')).length, 1);
});

test('hintsFor win32: winget ids and the whisper.cpp release zip', () => {
  const h = hintsFor([fail('ffmpeg'), fail('yt-dlp'), fail('whisper')], 'win32');
  assert.ok(all(h, 'winget install Gyan.FFmpeg'));
  assert.ok(all(h, 'winget install yt-dlp.yt-dlp'));
  assert.ok(all(h, 'https://github.com/ggml-org/whisper.cpp/releases'));
  assert.ok(!all(h, 'brew'));
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

test('hintsFor: with ffmpeg missing, its dependents add no second ffmpeg line', () => {
  const h = hintsFor([fail('ffmpeg', 'not found on PATH'), fail('ffmpeg-filters', 'needs ffmpeg'), fail('ffmpeg-https', 'needs ffmpeg', false)], 'win32');
  assert.equal(h.length, 1);
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
      runChecks({ nodeMin: 20, whisper: 'required', streamlink: true }),
    );
    const c = byName(checks);
    assert.deepEqual(checks.map((x) => x.name), ['node', 'ffmpeg', 'ffmpeg-filters', 'ffmpeg-https', 'yt-dlp', 'whisper', 'whisper-model', 'streamlink']);
    assert.equal(c.node.ok, true);
    assert.match(c.node.detail, /^node \d+\.\d+\.\d+/);
    for (const n of ['ffmpeg', 'ffmpeg-filters', 'yt-dlp', 'whisper', 'whisper-model']) assert.equal(c[n].ok, false, n);
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
      runChecks({ nodeMin: 99, whisper: 'optional' }),
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

test('runChecks with fake tools: everything present is ok, details carry versions and paths', posix, async () => {
  const bin = fakeBin({
    ffmpeg: FFMPEG_OK,
    'yt-dlp': 'echo 2026.10.26',
    'whisper-cli': 'echo usage',
    streamlink: 'echo "streamlink 7.1.2"',
  });
  const home = mkdtempSync(join(tmpdir(), 'boqo-doctor-home-'));
  writeFileSync(join(home, 'ggml-base.bin'), 'x');
  try {
    const checks = await withEnv({ PATH: bin, BOQO_HOME: home, BOQO_WHISPER_MODEL: join(home, 'ggml-base.bin') }, () =>
      runChecks({ nodeMin: 20, whisper: 'required', streamlink: true }),
    );
    for (const x of checks) assert.equal(x.ok, true, `${x.name}: ${x.detail}`);
    const c = byName(checks);
    assert.equal(c.ffmpeg.detail, `ffmpeg 7.1.1 at ${join(bin, 'ffmpeg')}`);
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
    const checks = await withEnv({ PATH: bin, BOQO_HOME: bin, BOQO_WHISPER_MODEL: undefined }, () => runChecks({ nodeMin: 20, whisper: 'optional' }));
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
    const opts = { nodeMin: 20, whisper: 'optional' };
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
    const checks = await withEnv({ PATH: bin, BOQO_HOME: bin, BOQO_WHISPER_MODEL: undefined }, () => runChecks({ nodeMin: 20, whisper: 'optional' }));
    const c = byName(checks);
    assert.equal(c['ffmpeg-filters'].ok, false);
    assert.match(c['ffmpeg-filters'].detail, /\bass\b/);
    assert.equal(c['yt-dlp'].ok, false);
    assert.match(c['yt-dlp'].detail, /older than 2026\.10\.26/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
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
    assert.equal(out.checks.length, 8);
    assert.ok(out.hints.length >= 4);
    const bad = spawnSync(process.execPath, [script, '--node', '18'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(JSON.parse(bad.stdout).error, /--node/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
