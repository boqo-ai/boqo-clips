import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

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
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

// ---- expectGolden

function goldenDir(name, value) {
  const dir = tmp('golden');
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  return dir;
}

test('expectGolden passes within the tolerance', () => {
  const dir = goldenDir('t', { a: 1 });
  expectGolden('t', { a: 1.0000000001 }, { dir });
});

test('expectGolden throws outside the tolerance, and honours a custom tol', () => {
  const dir = goldenDir('t', { a: 1 });
  assert.throws(() => expectGolden('t', { a: 1.001 }, { dir }), /a/);
  expectGolden('t', { a: 1.001 }, { dir, tol: 0.01 });
});

test('expectGolden names the path of a nested mismatch', () => {
  const dir = goldenDir('t', { a: { b: [1, 2, 3] } });
  assert.throws(() => expectGolden('t', { a: { b: [1, 2, 4] } }, { dir }), /a\.b\[2\]/);
});

test('expectGolden catches shape differences: keys, lengths, types, strings', () => {
  const dir = goldenDir('t', { a: [1, 2], s: 'x', n: null });
  const ok = { a: [1, 2], s: 'x', n: null };
  expectGolden('t', ok, { dir });
  assert.throws(() => expectGolden('t', { ...ok, extra: 1 }, { dir }), /extra/);
  assert.throws(() => expectGolden('t', { a: [1, 2], s: 'x' }, { dir }), /\bn\b/);
  assert.throws(() => expectGolden('t', { ...ok, a: [1] }, { dir }), /a/);
  assert.throws(() => expectGolden('t', { ...ok, s: 'y' }, { dir }), /\bs\b/);
  assert.throws(() => expectGolden('t', { ...ok, n: 0 }, { dir }), /\bn\b/);
});

test('expectGolden compares what JSON would keep (undefined keys drop, NaN is null)', () => {
  const dir = goldenDir('t', { a: 1, n: null });
  expectGolden('t', { a: 1, gone: undefined, n: NaN }, { dir });
});

test('expectGolden fails on a missing golden file, naming it', () => {
  assert.throws(() => expectGolden('no-such-case', 1, { dir: tmp('empty') }), /no-such-case/);
});

test('the committed clip-target golden is the fixed §6 value', () => {
  expectGolden('clip-target', [1, 2, 40, 120]);
  assert.deepEqual(JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/parity/clip-target.input.json'), 'utf8')), [60, 125, 2400, 9000]);
});

// ---- golden.mjs

test('golden.mjs refuses without --boqo/--case, and on a checkout that is not boqo', () => {
  const run = (...a) => spawnSync(process.execPath, [join(repoRoot, 'scripts/parity/golden.mjs'), ...a], { encoding: 'utf8' });
  assert.equal(run().status, 2);
  const r = run('--boqo', tmp('notboqo'), '--case', 'clip-target');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /apps\/worker/);
});

// ---- strip.mjs

test('strip.mjs removes types, keeps comments, adds the port header with the pin', () => {
  const boqo = tmp('strip-src');
  git(boqo, 'init', '-q', '-b', 'main');
  put(boqo, 'packages/core/src/m.ts', [
    '/** Measured: 12% of clips. */',
    'export function f(x: number): number {',
    '  // keep this note',
    '  return x * 2;',
    '}',
    'export type T = { a: number };',
    '',
  ].join('\n'));
  const out = join(tmp('strip-out'), 'm.mjs');
  const r = spawnSync(process.execPath, [join(repoRoot, 'scripts/parity/strip.mjs'), join(boqo, 'packages/core/src/m.ts'), out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pin = readFileSync(join(repoRoot, 'engine/boqo/PIN'), 'utf8').split('\n')[0];
  const text = readFileSync(out, 'utf8');
  assert.ok(text.startsWith(`// ported from boqo-ai/boqo packages/core/src/m.ts @ ${pin}; keep in step (scripts/boqo-drift.mjs)\n`), text);
  assert.ok(text.includes('/** Measured: 12% of clips. */'));
  assert.ok(text.includes('// keep this note'));
  assert.ok(!text.includes(': number'));
  assert.ok(!text.includes('type T'));
  const mod = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(out).href)}).then(m=>console.log(m.f(21)))`], { encoding: 'utf8' });
  assert.equal(mod.stdout.trim(), '42', mod.stderr);
});

// ---- boqo-drift.mjs: a temp boqo (two commits) and a temp skill repo holding a copy of the script

function drift({ ported, ref } = {}) {
  const boqo = tmp('drift-boqo');
  git(boqo, 'init', '-q', '-b', 'main');
  put(boqo, 'packages/core/src/same.ts', 'export const same = 1;\n');
  put(boqo, 'packages/core/src/moves.ts', 'export const moves = 1;\n');
  put(boqo, 'prompts/p.txt', 'prompt v1\n');
  put(boqo, 'packages/core/src/del.ts', 'export const del = 1;\n');
  git(boqo, 'add', '-A');
  git(boqo, 'commit', '-q', '-m', 'one');
  const pin = git(boqo, 'rev-parse', '--short=9', 'HEAD');
  put(boqo, 'packages/core/src/moves.ts', 'export const moves = 2;\n');
  put(boqo, 'prompts/p.txt', 'prompt v2\n');
  put(boqo, 'packages/core/src/unrelated.ts', 'x\n');
  git(boqo, 'rm', '-q', 'packages/core/src/del.ts');
  git(boqo, 'add', '-A');
  git(boqo, 'commit', '-q', '-m', 'two');

  const skill = tmp('drift-skill');
  cpSync(join(repoRoot, 'scripts/boqo-drift.mjs'), join(skill, 'scripts/boqo-drift.mjs'), { recursive: true });
  put(skill, 'engine/boqo/PIN', `${pin}\n2026-11-16\n`);
  for (const [rel, text] of Object.entries(ported ?? {})) put(skill, rel, text.replaceAll('<pin>', pin));
  const args = [join(skill, 'scripts/boqo-drift.mjs'), boqo, ...(ref ? ['--ref', ref] : [])];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

const hdr = (p) => `// ported from boqo-ai/boqo ${p} @ <pin>; keep in step (scripts/boqo-drift.mjs)\nexport {};\n`;

test('drift: a ported file whose source changed is reported, exit 1', () => {
  const r = drift({ ported: { 'engine/boqo/moves.mjs': hdr('packages/core/src/moves.ts') } });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, 'packages/core/src/moves.ts changed\n');
});

test('drift: unchanged sources print nothing, exit 0', () => {
  const r = drift({ ported: { 'engine/boqo/same.mjs': hdr('packages/core/src/same.ts') } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('drift: lists only the changed ones, once each, under engine/boqo and lib/boqo and in skill prompts', () => {
  const r = drift({
    ported: {
      'engine/boqo/same.mjs': hdr('packages/core/src/same.ts'),
      'engine/boqo/moves.mjs': hdr('packages/core/src/moves.ts'),
      'lib/boqo/moves-again.mjs': hdr('packages/core/src/moves.ts'),
      'skills/boqo-clips/references/p.md': '<!-- ported from boqo-ai/boqo prompts/p.txt @ <pin>; keep in step -->\nprompt v1\n',
    },
  });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, 'packages/core/src/moves.ts changed\nprompts/p.txt changed\n');
});

test('drift: --ref compares against that revision (the pin itself is never changed)', () => {
  const ported = { 'engine/boqo/moves.mjs': hdr('packages/core/src/moves.ts') };
  const r = drift({ ported, ref: 'HEAD~1' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('drift: a source deleted at the ref counts as changed', () => {
  const r = drift({ ported: { 'engine/boqo/del.mjs': hdr('packages/core/src/del.ts') } });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, 'packages/core/src/del.ts changed\n');
});

test('drift: a bad header path, ref or checkout is an error, not a clean run', () => {
  const r = drift({ ported: { 'engine/boqo/gone.mjs': hdr('packages/core/src/gone.ts') } });
  assert.equal(r.status, 2, 'a header naming a path absent at the pin is an error');
  assert.equal(drift({ ported: { 'engine/boqo/same.mjs': hdr('packages/core/src/same.ts') }, ref: 'no-such-rev' }).status, 2);
  const skill = tmp('drift-skill');
  cpSync(join(repoRoot, 'scripts/boqo-drift.mjs'), join(skill, 'scripts/boqo-drift.mjs'), { recursive: true });
  put(skill, 'engine/boqo/PIN', 'deadbeef\n2026-11-16\n');
  assert.equal(spawnSync(process.execPath, [join(skill, 'scripts/boqo-drift.mjs'), tmp('nogit')], { encoding: 'utf8' }).status, 2);
});
