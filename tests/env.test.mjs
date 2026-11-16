import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAC_BREW_BINS, MAC_FFMPEG_DIRS, toolEnv } from '../engine/env.mjs';

const ARM = '/opt/homebrew/opt/ffmpeg-full/bin';
const INTEL = '/usr/local/opt/ffmpeg-full/bin';
const only = (...dirs) => (p) => dirs.includes(p);

test('toolEnv: the ffmpeg-full folders, Apple silicon first', () => {
  assert.deepEqual(MAC_FFMPEG_DIRS, [ARM, INTEL]);
  assert.deepEqual(MAC_BREW_BINS, ['/opt/homebrew/bin', '/usr/local/bin']);
});

test('toolEnv on macOS puts an existing ffmpeg-full first on PATH, keeping the rest in order', () => {
  const base = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: '/Users/a b' };
  const env = toolEnv(base, 'darwin', only(ARM, '/opt/homebrew/bin'));
  assert.equal(env.PATH, `${ARM}:/usr/bin:/bin:/opt/homebrew/bin`);
  assert.equal(env.HOME, '/Users/a b');
  assert.equal(base.PATH, '/usr/bin:/bin:/opt/homebrew/bin', 'the base env is not changed');
});

test('toolEnv on an Intel Mac uses /usr/local/opt; both are first when both exist', () => {
  assert.equal(toolEnv({ PATH: '/usr/bin:/usr/local/bin' }, 'darwin', only(INTEL, '/usr/local/bin')).PATH, `${INTEL}:/usr/bin:/usr/local/bin`);
  assert.equal(toolEnv({ PATH: '/usr/bin' }, 'darwin', only(ARM, INTEL)).PATH, `${ARM}:${INTEL}:/usr/bin`);
});

test('toolEnv on macOS moves ffmpeg-full to the front once, never twice', () => {
  const env = toolEnv({ PATH: `/usr/bin:${ARM}:/bin` }, 'darwin', only(ARM));
  assert.equal(env.PATH, `${ARM}:/usr/bin:/bin`);
});

test('toolEnv on macOS adds a missing Homebrew bin folder at the end, when it exists', () => {
  const env = toolEnv({ PATH: '/usr/bin:/bin' }, 'darwin', only('/opt/homebrew/bin', '/usr/local/bin'));
  assert.equal(env.PATH, '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(toolEnv({}, 'darwin', only(ARM)).PATH, ARM);
});

test('toolEnv on macOS with nothing installed gives the env as it is', () => {
  const base = { PATH: '/usr/bin:/bin' };
  assert.equal(toolEnv(base, 'darwin', () => false), base);
});

test('toolEnv on Linux and Windows gives the env as it is, whatever exists', () => {
  const base = { PATH: '/usr/bin' };
  assert.equal(toolEnv(base, 'linux', () => true), base);
  const win = { Path: 'C:\\Windows;C:\\ffmpeg\\bin' };
  assert.equal(toolEnv(win, 'win32', () => true), win);
  assert.equal(toolEnv(win, 'win32', () => true).Path, 'C:\\Windows;C:\\ffmpeg\\bin');
});

test('toolEnv defaults to this process and this OS', () => {
  const env = toolEnv();
  if (process.platform !== 'darwin') assert.equal(env, process.env);
  else assert.ok(String(env.PATH).includes(String(process.env.PATH ?? '')));
});

// Every engine file and shared tool that starts a process (ffmpeg, ffprobe,
// yt-dlp, whisper-cli) hands it toolEnv(): a macOS agent shell has no
// ffmpeg-full on PATH.
test('every engine file and tool that starts a process runs it with toolEnv', () => {
  const files = [
    ...readdirSync(new URL('../engine/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `engine/${f}`),
    ...readdirSync(new URL('../tools/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `tools/${f}`),
  ];
  const spawners = [];
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
    if (!/from ['"]node:child_process['"]/.test(src)) continue;
    spawners.push(f);
    assert.match(src, /import \{[^}]*\btoolEnv\b[^}]*\} from ['"]\.\.?\/(?:engine\/)?env\.mjs['"]/, `${f} imports toolEnv`);
    const sites = src
      .split('\n')
      .filter((l) => /(?<![.\w])(?:spawn|spawnSync|execFile|execFileSync|execFileAsync|execSync)\s*\(/.test(l))
      .filter((l) => !/^\s*(?:\/\/|\*)/.test(l) && !/\bimport\b|promisify\(|=>\s*$/.test(l));
    assert.ok(sites.length > 0, `${f} has a call site`);
    for (const line of sites) assert.match(line, /toolEnv\(\)|\benv\b/, `${f}: ${line.trim()}`);
  }
  assert.deepEqual(spawners.sort(), ['engine/asr.mjs', 'engine/doctor.mjs', 'engine/fetch.mjs', 'engine/render.mjs', 'tools/boqo-upload.mjs']);
});
