#!/usr/bin/env node
// node scripts/sync-engine.mjs <target-repo-dir>
//   Copies the shared engine and tools (SHARED in engine/hash.mjs) into a
//   sibling skill repo, byte for byte, and writes <target>/engine/ENGINE.json
//   {from, commit, hash, files}. Deleted source files disappear from the
//   target. Prints one JSON line {"synced","hash","files"}; exit 1 with
//   {"error"} if it refuses (no .git in the target, the target is this repo,
//   uncommitted changes in a SHARED path, a SHARED file missing).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTR_BEGIN, ATTR_END, SHARED, engineHash, gitattributes, sharedFiles } from '../engine/hash.mjs';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');

const fail = (msg) => {
  process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
};

const git = (args) => spawnSync('git', args, { cwd: source, encoding: 'utf8' });

function main() {
  const arg = process.argv[2];
  if (!arg || process.argv.length > 3) fail('usage: node scripts/sync-engine.mjs <target-repo-dir>');
  if (!existsSync(arg)) fail(`target does not exist: ${arg}`);
  const target = realpathSync(arg);
  if (target === realpathSync(source)) fail('target is the source repo (boqo-clips); give a different repo');
  if (!existsSync(join(target, '.git'))) fail(`target has no .git: ${target}`);

  let files;
  try {
    files = sharedFiles(source);
  } catch (e) {
    fail(e.message);
  }

  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0) fail('cannot read the boqo-clips commit (git rev-parse HEAD failed)');
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', ...SHARED]);
  if (status.status !== 0) fail('cannot read git status of boqo-clips');
  if (status.stdout.trim()) {
    fail(`boqo-clips has uncommitted changes in shared paths; commit first:\n${status.stdout.trim()}`);
  }
  const commit = head.stdout.trim();

  // engine/ is wholly vendored: replace it so deletions propagate.
  rmSync(join(target, 'engine'), { recursive: true, force: true });
  for (const rel of files) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    cpSync(join(source, rel), join(target, rel));
  }

  const hash = engineHash(target);
  if (hash !== engineHash(source)) fail('copy does not hash like the source; target left as is for inspection');
  writeFileSync(
    join(target, 'engine/ENGINE.json'),
    JSON.stringify({ from: 'boqo-ai/boqo-clips', commit, hash, files: SHARED }, null, 2) + '\n',
  );
  writeAttributes(join(target, '.gitattributes'));

  process.stdout.write(JSON.stringify({ synced: target, hash, files: files.length }) + '\n');
}

// Put (or refresh) our managed block in the target's .gitattributes, keeping
// anything else the target has there.
function writeAttributes(path) {
  const block = gitattributes();
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const a = text.indexOf(ATTR_BEGIN);
  const b = text.indexOf(ATTR_END);
  if (a !== -1 && b > a) {
    text = text.slice(0, a) + block + text.slice(b + ATTR_END.length).replace(/^\n/, '');
  } else {
    if (text && !text.endsWith('\n')) text += '\n';
    text += block;
  }
  writeFileSync(path, text);
}

main();
