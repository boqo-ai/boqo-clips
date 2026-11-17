// Without the skill's npm packages (a v0.1 install updated by `git pull` alone, a failed `npm ci`), the doctor still
// runs and says how to install them, and every other tool prints one JSON line naming the command instead of Node's
// stack trace. The skill is copied, with no node_modules, into a temp folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingPackage, needPackages, notInstalled, npmCi } from '../engine/packages.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NPM = 'npm ci --omit=dev --ignore-scripts';

test('missingPackage names a bare package Node could not find, and nothing else', () => {
  const err = (code, message) => Object.assign(new Error(message), { code });
  assert.equal(missingPackage(err('ERR_MODULE_NOT_FOUND', "Cannot find package 'zod' imported from /x/engine/boqo/rank.mjs")), 'zod');
  assert.equal(missingPackage(err('ERR_MODULE_NOT_FOUND', "Cannot find package 'onnxruntime-node' imported from C:\\x\\b.mjs")), 'onnxruntime-node');
  assert.equal(missingPackage(err('ERR_MODULE_NOT_FOUND', "Cannot find module '/x/engine/nope.mjs' imported from /x/a.mjs")), null);
  assert.equal(missingPackage(err('ERR_UNKNOWN', "Cannot find package 'zod'")), null);
  assert.equal(missingPackage(null), null);
});

test('npmCi is INSTALL.md\'s one command, with ; on Windows (PowerShell 5.1 has no &&)', () => {
  assert.equal(npmCi('linux'), `cd "$HOME/.boqo-clips" && ${NPM}`);
  assert.equal(npmCi('darwin'), `cd "$HOME/.boqo-clips" && ${NPM}`);
  assert.equal(npmCi('win32'), `cd "$HOME/.boqo-clips"; ${NPM}`);
  assert.equal(notInstalled('zod', 'linux'), `the skill's packages are not installed (no zod): cd "$HOME/.boqo-clips" && ${NPM}`);
});

test('needPackages hands back the modules, and throws any error that is not a missing package', async () => {
  assert.deepEqual(await needPackages(async () => ({ a: 1 })), { a: 1 });
  await assert.rejects(needPackages(() => import('./no-such-file-here.mjs')), /Cannot find module/);
  await assert.rejects(needPackages(async () => { throw new SyntaxError('bad'); }), /bad/);
});

// ---- from a copy with no node_modules

let copy;
let skip = false;

before(() => {
  copy = mkdtempSync(join(tmpdir(), 'boqo no packages '));
  for (const part of ['engine', 'tools', 'package.json']) cpSync(join(ROOT, part), join(copy, part), { recursive: true });
  // A node_modules above the temp folder would hand the copy its packages: nothing to prove then.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('zod').then(() => console.log('found'), () => console.log('none'))"], { cwd: copy, encoding: 'utf8' });
  if (r.stdout.trim() !== 'none') skip = 'zod resolves from the temp folder';
});

after(() => rmSync(copy, { recursive: true, force: true }));

const runTool = (name, args = []) => {
  const empty = join(copy, 'empty');
  mkdirSync(empty, { recursive: true });
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')),
    PATH: empty,
    NODE_PATH: empty,
    BOQO_HOME: empty,
    BOQO_WHISPER_MODEL: '',
    HOME: empty,
    USERPROFILE: empty,
  };
  return spawnSync(process.execPath, [join(copy, 'tools', `${name}.mjs`), ...args], { encoding: 'utf8', env, timeout: 60_000 });
};

const oneLine = (r, name) => {
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `${name}: ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /Cannot find package|ERR_MODULE_NOT_FOUND|at async/, `${name} printed a stack trace: ${r.stderr}`);
  return JSON.parse(lines[0]);
};

test('the doctor runs with no node_modules: one JSON line, zod and onnxruntime not installed, one npm line', (t) => {
  if (skip) return t.skip(skip);
  const r = runTool('doctor', ['--whisper', 'optional']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = oneLine(r, 'doctor');
  assert.equal(out.ok, false);
  const c = Object.fromEntries(out.checks.map((x) => [x.name, x]));
  assert.deepEqual([c.zod.ok, c.zod.required, c.zod.cause, c.zod.detail], [false, true, 'not-installed', 'zod is not installed']);
  assert.deepEqual([c.onnxruntime.ok, c.onnxruntime.cause], [false, 'not-installed']);
  const npm = out.hints.filter((h) => h.includes(NPM));
  assert.equal(npm.length, 1, out.hints.join('\n'));
  assert.match(npm[0], /^onnxruntime: the skill's packages are not installed: `cd "\$HOME\/\.boqo-clips"(;| &&) npm ci/);
});

// The tools that load hosted's schemas (zod) say so; the rest need no package and answer their usage error.
const NEEDS_ZOD = ['brand', 'clips', 'fetch', 'panels', 'render', 'select-check', 'select-request', 'stranger', 'transcript-boqo'];

test('every tool with no node_modules prints one JSON line; those that need zod name the npm command', (t) => {
  if (skip) return t.skip(skip);
  const tools = readdirSync(join(copy, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4));
  assert.ok(tools.length >= 14, tools.join(' '));
  for (const name of tools) {
    if (name === 'doctor') continue;
    const r = runTool(name);
    const out = oneLine(r, name);
    assert.equal(r.status, 1, `${name}: ${r.stdout}`);
    if (NEEDS_ZOD.includes(name)) {
      assert.equal(out.error, notInstalled('zod'), name);
    } else {
      assert.ok(typeof out.error === 'string' && !/packages/.test(out.error), `${name}: ${out.error}`);
    }
  }
});
