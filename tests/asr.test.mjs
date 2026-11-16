import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { findModel, whisperArgs, transcribe } from '../engine/asr.mjs';
import { toolEnv } from '../engine/env.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'boqo-asr-test-'));
const touch = (dir, name) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, 'x');
  return p;
};

// run `fn` with env vars set, then put them back
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

test('whisperArgs: a multilingual model keeps the language', () => {
  assert.deepEqual(whisperArgs('a.wav', '/m/ggml-small.bin', '/t/out'), [
    '-m', '/m/ggml-small.bin', '-f', 'a.wav', '-ml', '1', '-sow', '-oj', '-of', '/t/out', '-np', '-l', 'auto',
  ]);
  assert.deepEqual(whisperArgs('a.wav', '/m/ggml-base.bin', '/t/out', 'ru'), [
    '-m', '/m/ggml-base.bin', '-f', 'a.wav', '-ml', '1', '-sow', '-oj', '-of', '/t/out', '-np', '-l', 'ru',
  ]);
});

test('whisperArgs: an English-only model forces -l en', () => {
  const want = ['-m', '/m/ggml-small.en.bin', '-f', 'a.wav', '-ml', '1', '-sow', '-oj', '-of', '/t/out', '-np', '-l', 'en'];
  assert.deepEqual(whisperArgs('a.wav', '/m/ggml-small.en.bin', '/t/out'), want);
  assert.deepEqual(whisperArgs('a.wav', '/m/ggml-small.en.bin', '/t/out', 'ru'), want);
});

test('findModel: BOQO_WHISPER_MODEL wins, then $BOQO_HOME/models, then ~/.cache/whisper', async () => {
  const root = tmp();
  try {
    const home = join(root, 'home');
    const boqo = join(root, 'boqo');
    const cache = touch(join(home, '.cache', 'whisper'), 'ggml-small.bin');
    await withEnv({ BOQO_HOME: boqo, BOQO_WHISPER_MODEL: undefined }, async () => {
      assert.equal(findModel(home), cache);
      const own = touch(join(boqo, 'models'), 'ggml-base.bin');
      assert.equal(findModel(home), own, 'BOQO_HOME models come before the cache');
      const pinned = touch(root, 'my-model.bin');
      await withEnv({ BOQO_WHISPER_MODEL: pinned }, () => assert.equal(findModel(home), pinned));
      // a pin that does not exist is ignored
      await withEnv({ BOQO_WHISPER_MODEL: join(root, 'nope.bin') }, () => assert.equal(findModel(home), own));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findModel: prefers small, then base, then any; ignores other files', async () => {
  const root = tmp();
  try {
    const dir = join(root, 'models');
    await withEnv({ BOQO_HOME: root, BOQO_WHISPER_MODEL: undefined }, () => {
      assert.equal(findModel(join(root, 'empty-home')), null);
      touch(dir, 'notes.txt');
      touch(dir, 'ggml-tiny.bin');
      assert.equal(basename(findModel(join(root, 'empty-home'))), 'ggml-tiny.bin');
      touch(dir, 'ggml-base.bin');
      assert.equal(basename(findModel(join(root, 'empty-home'))), 'ggml-base.bin');
      touch(dir, 'ggml-small.en.bin');
      assert.equal(basename(findModel(join(root, 'empty-home'))), 'ggml-small.en.bin');
      touch(dir, 'ggml-small.bin');
      assert.equal(basename(findModel(join(root, 'empty-home'))), 'ggml-small.bin', 'multilingual before .en');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcribe: no model gives the download line', async () => {
  const root = tmp();
  try {
    await withEnv({ BOQO_HOME: root, BOQO_WHISPER_MODEL: undefined, HOME: root, USERPROFILE: root }, async () => {
      await assert.rejects(
        transcribe(join(root, 'a.wav')),
        (err) =>
          /no whisper model/i.test(err.message) &&
          err.message.includes('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin') &&
          err.message.includes('models'),
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcribe: no whisper-cli says how to install it, before any work', async () => {
  const root = tmp();
  try {
    const model = touch(root, 'ggml-base.bin');
    await withEnv({ BOQO_WHISPER_MODEL: model, PATH: join(root, 'no-bin') }, async () => {
      await assert.rejects(transcribe(join(root, 'a.wav')), (err) => {
        const m = err.message;
        return m.includes('whisper-cli') && m.includes('brew install whisper-cpp') && m.includes('github.com/ggml-org/whisper.cpp/releases');
      });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcribe: a bad range is refused', async () => {
  const root = tmp();
  try {
    const model = touch(root, 'ggml-base.bin');
    await withEnv({ BOQO_WHISPER_MODEL: model }, async () => {
      await assert.rejects(transcribe('x.wav', { s: 10, e: 5 }), /range/);
      await assert.rejects(transcribe('x.wav', { s: -1, e: 5 }), /range/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', env: toolEnv() }).error === undefined;
const live = findModel() && has('whisper-cli', ['-h']) && has('ffmpeg', ['-version']) && has('espeak-ng', ['--version']);

test('transcribe: real speech gives words, offset by the cut start, temp files removed', { skip: !live && 'needs whisper-cli, a model, ffmpeg and espeak-ng' }, async () => {
  const root = tmp();
  try {
    const wav = join(root, 'speech.wav');
    const say = spawnSync('espeak-ng', ['-w', wav, 'The quick brown fox jumps over the lazy dog. Then it runs away.'], { encoding: 'utf8' });
    assert.equal(say.status, 0, say.stderr);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('boqo-asr-')).length;
    const all = await transcribe(wav);
    assert.ok(all.length >= 8, `got ${all.length} words`);
    assert.match(all.map((x) => x.w).join(' ').toLowerCase(), /fox/);
    for (const x of all) assert.ok(x.e > x.s && x.s >= 0);
    const cut = await transcribe(wav, { s: 1, e: 2.5 });
    assert.ok(cut.length > 0 && cut.length < all.length);
    assert.ok(cut.every((x) => x.s >= 0.9), 'cut words sit on the source timeline');
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('boqo-asr-')).length;
    assert.equal(after, before, 'work folders are removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
