import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED, engineHash, gitattributes } from '../engine/hash.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

const tmp = (p) => mkdtempSync(join(tmpdir(), `boqo-${p}-`));
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// A temp boqo-clips: the real SHARED files, the sync script, committed.
function makeSource() {
  const dir = tmp('src');
  for (const p of SHARED) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    cpSync(join(repoRoot, p), join(dir, p), { recursive: true });
  }
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(repoRoot, 'scripts/sync-engine.mjs'), join(dir, 'scripts/sync-engine.mjs'));
  cpSync(join(repoRoot, 'package.json'), join(dir, 'package.json'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  return dir;
}

function makeTarget() {
  const dir = tmp('tgt');
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

const sync = (source, target) =>
  spawnSync(process.execPath, [join(source, 'scripts/sync-engine.mjs'), target], { encoding: 'utf8' });

// ---- engineHash

test('SHARED is the agreed list', () => {
  assert.deepEqual(SHARED, [
    'engine/', 'tools/doctor.mjs', 'tools/fetch.mjs', 'tools/render.mjs',
    'tools/picks-check.mjs', 'tools/brand.mjs', 'tools/asr.mjs', 'tools/boqo-upload.mjs', 'tools/transcript.mjs',
    'scripts/parity/golden.mjs', 'scripts/parity/strip.mjs', 'scripts/boqo-drift.mjs', 'tests/helpers/golden.mjs',
  ]);
});

test('engineHash is stable across runs and is a sha256 hex', () => {
  const a = engineHash(repoRoot);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(engineHash(repoRoot), a);
});

test('engineHash changes when a byte under engine/ changes', () => {
  const src = makeSource();
  const before = engineHash(src);
  writeFileSync(join(src, 'engine/words.mjs'), readFileSync(join(src, 'engine/words.mjs'), 'utf8') + '\n// x\n');
  assert.notEqual(engineHash(src), before);
});

test('engineHash changes when a byte in a binary under engine/ changes', () => {
  const src = makeSource();
  const before = engineHash(src);
  const f = join(src, 'engine/fonts/Inter-Bold.ttf');
  const b = readFileSync(f);
  b[b.length - 1] ^= 0xff;
  writeFileSync(f, b);
  assert.notEqual(engineHash(src), before);
});

test('engineHash changes when a shared tool changes', () => {
  const src = makeSource();
  const before = engineHash(src);
  writeFileSync(join(src, 'tools/render.mjs'), readFileSync(join(src, 'tools/render.mjs'), 'utf8') + '\n// x\n');
  assert.notEqual(engineHash(src), before);
});

test('engineHash changes when a file is added or removed under engine/', () => {
  const src = makeSource();
  const before = engineHash(src);
  writeFileSync(join(src, 'engine/extra.mjs'), '');
  const added = engineHash(src);
  assert.notEqual(added, before);
  rmSync(join(src, 'engine/extra.mjs'));
  assert.equal(engineHash(src), before);
});

test('engineHash ignores engine/ENGINE.json and files outside SHARED', () => {
  const src = makeSource();
  const before = engineHash(src);
  writeFileSync(join(src, 'engine/ENGINE.json'), '{"hash":"x"}');
  writeFileSync(join(src, 'tools/not-shared.mjs'), 'x');
  writeFileSync(join(src, 'README.md'), 'x');
  assert.equal(engineHash(src), before);
});

test('engineHash throws when a listed tool is missing', () => {
  const src = makeSource();
  rmSync(join(src, 'tools/asr.mjs'));
  assert.throws(() => engineHash(src), /tools\/asr\.mjs/);
});

test('engineHash does not depend on where the tree lives', () => {
  assert.equal(engineHash(makeSource()), engineHash(makeSource()));
});

// ---- sync

test('sync copies SHARED, writes ENGINE.json whose hash equals engineHash(target)', () => {
  const src = makeSource();
  const tgt = makeTarget();
  const r = sync(src, tgt);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.synced, realpathSync(tgt));
  const meta = JSON.parse(readFileSync(join(tgt, 'engine/ENGINE.json'), 'utf8'));
  assert.equal(meta.from, 'boqo-ai/boqo-clips');
  assert.equal(meta.commit, git(src, 'rev-parse', 'HEAD'));
  assert.equal(meta.hash, engineHash(tgt));
  assert.equal(meta.hash, engineHash(src));
  assert.equal(out.hash, meta.hash);
  assert.deepEqual(meta.files, SHARED);
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.deepEqual(meta.deps, { zod: pkg.dependencies.zod, 'onnxruntime-node': pkg.dependencies['onnxruntime-node'] });
  assert.match(meta.deps['onnxruntime-node'], /^\d+\.\d+\.\d+$/, 'onnxruntime-node is pinned exactly');
  assert.ok(out.files > 10);
  for (const f of ['engine/words.mjs', 'engine/fonts/Anton-Regular.ttf', 'tools/doctor.mjs', 'tools/boqo-upload.mjs']) {
    assert.deepEqual(readFileSync(join(tgt, f)), readFileSync(join(src, f)), f);
  }
  assert.equal(r.stdout.trim().split('\n').length, 1, 'exactly one stdout line');
});

test('sync refuses when the source package.json lacks an engine dependency', () => {
  const src = makeSource();
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  delete pkg.dependencies.zod;
  writeFileSync(join(src, 'package.json'), JSON.stringify(pkg));
  const tgt = makeTarget();
  const r = sync(src, tgt);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /zod/);
});

test('sync propagates deletions and replaces stale files', () => {
  const src = makeSource();
  const tgt = makeTarget();
  assert.equal(sync(src, tgt).status, 0);
  mkdirSync(join(tgt, 'engine/old'), { recursive: true });
  writeFileSync(join(tgt, 'engine/old/gone.mjs'), 'x');
  writeFileSync(join(tgt, 'engine/words.mjs'), 'hand edit');
  const r = sync(src, tgt);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(tgt, 'engine/old')), false);
  assert.deepEqual(readFileSync(join(tgt, 'engine/words.mjs')), readFileSync(join(src, 'engine/words.mjs')));
  assert.equal(JSON.parse(readFileSync(join(tgt, 'engine/ENGINE.json'), 'utf8')).hash, engineHash(src));
});

test('sync leaves the target own files alone', () => {
  const src = makeSource();
  const tgt = makeTarget();
  mkdirSync(join(tgt, 'tools'));
  writeFileSync(join(tgt, 'tools/own.mjs'), 'mine');
  writeFileSync(join(tgt, 'README.md'), 'mine');
  assert.equal(sync(src, tgt).status, 0);
  assert.equal(readFileSync(join(tgt, 'tools/own.mjs'), 'utf8'), 'mine');
  assert.equal(readFileSync(join(tgt, 'README.md'), 'utf8'), 'mine');
});

test('sync refuses a target without .git', () => {
  const src = makeSource();
  const r = sync(src, tmp('nogit'));
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /\.git/);
});

test('sync refuses the source repo as its own target', () => {
  const src = makeSource();
  const r = sync(src, src);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /source/i);
});

test('sync refuses with no target argument', () => {
  const src = makeSource();
  const r = spawnSync(process.execPath, [join(src, 'scripts/sync-engine.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).error);
});

test('sync refuses when SHARED paths have uncommitted changes, and touches nothing', () => {
  const src = makeSource();
  const tgt = makeTarget();
  writeFileSync(join(src, 'tools/fetch.mjs'), readFileSync(join(src, 'tools/fetch.mjs'), 'utf8') + '\n// wip\n');
  let r = sync(src, tgt);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /uncommitted/i);
  assert.equal(existsSync(join(tgt, 'engine')), false);
  git(src, 'checkout', '--', 'tools/fetch.mjs');
  writeFileSync(join(src, 'engine/new-untracked.mjs'), '');
  r = sync(src, tgt);
  assert.equal(r.status, 1, 'an untracked file under engine/ counts too');
});

test('sync does not refuse over changes outside SHARED', () => {
  const src = makeSource();
  writeFileSync(join(src, 'README.md'), 'wip');
  assert.equal(sync(src, makeTarget()).status, 0);
});

test('sync refuses and touches nothing when a listed tool is missing in the source', () => {
  const src = makeSource();
  git(src, 'rm', '-q', 'tools/brand.mjs');
  git(src, 'commit', '-q', '-m', 'rm');
  const tgt = makeTarget();
  const r = sync(src, tgt);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /tools\/brand\.mjs/);
  assert.equal(existsSync(join(tgt, 'engine')), false);
});

// ---- line endings: the hash must be the same on every OS

test('every SHARED file in this repo has text unset, so no checkout rewrites its bytes', () => {
  const files = git(repoRoot, 'ls-files', '--', ...SHARED).split('\n').filter(Boolean);
  assert.ok(files.length > 15);
  const attrs = git(repoRoot, 'check-attr', 'text', '--', ...files).split('\n');
  for (const line of attrs) assert.match(line, /: text: unset$/, line);
});

test('this repo .gitattributes carries the same block the sync writes', () => {
  // .gitattributes itself is not hashed, so a Windows checkout may make it CRLF.
  const text = readFileSync(join(repoRoot, '.gitattributes'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text.includes(gitattributes()));
});

test('a synced target checked out with core.autocrlf=true hashes the same (and without the sync .gitattributes it would not)', () => {
  const src = makeSource();
  const tgt = makeTarget();
  assert.equal(sync(src, tgt).status, 0);
  assert.ok(existsSync(join(tgt, '.gitattributes')));
  git(tgt, 'add', '-A');
  git(tgt, 'commit', '-q', '-m', 'sync');
  const want = JSON.parse(readFileSync(join(tgt, 'engine/ENGINE.json'), 'utf8')).hash;

  const crlf = join(tmp('crlf'), 'clone');
  git(tmpdir(), 'clone', '-q', '-c', 'core.autocrlf=true', tgt, crlf);
  assert.equal(engineHash(crlf), want, 'bytes must survive a CRLF-converting checkout');

  // Negative control: strip the attributes and the same checkout does change bytes.
  rmSync(join(tgt, '.gitattributes'));
  git(tgt, 'add', '-A');
  git(tgt, 'commit', '-q', '-m', 'no attrs');
  const bad = join(tmp('crlf'), 'clone');
  git(tmpdir(), 'clone', '-q', '-c', 'core.autocrlf=true', tgt, bad);
  assert.notEqual(engineHash(bad), want, 'control: autocrlf does rewrite without .gitattributes');
});

test('sync keeps a target .gitattributes of its own and does not duplicate the block', () => {
  const src = makeSource();
  const tgt = makeTarget();
  writeFileSync(join(tgt, '.gitattributes'), '*.png binary\n');
  assert.equal(sync(src, tgt).status, 0);
  assert.equal(sync(src, tgt).status, 0);
  const text = readFileSync(join(tgt, '.gitattributes'), 'utf8');
  assert.ok(text.startsWith('*.png binary\n'));
  assert.equal(text.split(gitattributes()).length, 2, 'block present exactly once');
});
