import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findModel, whisperArgs, whisperLang, transcribe } from '../engine/asr.mjs';
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

test('findModel: a non-English language prefers a multilingual model of any size', async () => {
  const root = tmp();
  try {
    const home = join(root, 'home');
    const dir = join(root, 'models');
    await withEnv({ BOQO_HOME: root, BOQO_WHISPER_MODEL: undefined }, () => {
      touch(dir, 'ggml-small.en.bin');
      touch(dir, 'ggml-base.bin');
      assert.equal(basename(findModel(home)), 'ggml-small.en.bin', 'English or auto: small first, as before');
      assert.equal(basename(findModel(home, 'auto')), 'ggml-small.en.bin');
      assert.equal(basename(findModel(home, 'en')), 'ggml-small.en.bin');
      assert.equal(basename(findModel(home, 'ru')), 'ggml-base.bin');
      assert.equal(basename(findModel(home, 'pt-BR')), 'ggml-base.bin');
    });
    // across folders: an .en model in $BOQO_HOME/models, a multilingual one in the cache
    const root2 = tmp();
    const home2 = join(root2, 'home');
    touch(join(root2, 'models'), 'ggml-small.en.bin');
    const cached = touch(join(home2, '.cache', 'whisper'), 'ggml-tiny.bin');
    await withEnv({ BOQO_HOME: root2, BOQO_WHISPER_MODEL: undefined }, () => {
      assert.equal(findModel(home2, 'de'), cached);
      assert.equal(basename(findModel(home2, 'auto')), 'ggml-small.en.bin');
    });
    // only .en models: the .en one, and asr says englishOnly
    const root3 = tmp();
    touch(join(root3, 'models'), 'ggml-small.en.bin');
    await withEnv({ BOQO_HOME: root3, BOQO_WHISPER_MODEL: undefined }, () => {
      assert.equal(basename(findModel(join(root3, 'h'), 'de')), 'ggml-small.en.bin');
    });
    rmSync(root2, { recursive: true, force: true });
    rmSync(root3, { recursive: true, force: true });
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

// ---- the language a transcription ran in (an `.en` model forces English)

test('whisperLang: an English-only model is English, whatever was asked or heard', () => {
  assert.deepEqual(whisperLang('/m/ggml-small.en.bin', 'auto', { result: { language: 'en' } }), { lang: 'en', englishOnly: true });
  assert.deepEqual(whisperLang('/m/ggml-base.en.bin', 'ru', {}), { lang: 'en', englishOnly: true });
  assert.deepEqual(whisperLang('C:\\m\\GGML-SMALL.EN.BIN', 'auto', null), { lang: 'en', englishOnly: true });
});

test('whisperLang: a multilingual model reports the language whisper heard, else the one asked', () => {
  assert.deepEqual(whisperLang('/m/ggml-small.bin', 'auto', { result: { language: 'de' } }), { lang: 'de', englishOnly: false });
  assert.deepEqual(whisperLang('/m/ggml-small.bin', 'fr', {}), { lang: 'fr', englishOnly: false });
  assert.deepEqual(whisperLang('/m/ggml-small.bin', 'auto', { result: {} }), { lang: 'auto', englishOnly: false });
  assert.deepEqual(whisperLang('/m/ggml-small.bin', undefined, null), { lang: 'auto', englishOnly: false });
});

const CLI = fileURLToPath(new URL('../tools/asr.mjs', import.meta.url));
const ffmpegOk = has('ffmpeg', ['-version']);

// A whisper-cli stand-in: `-h` exits 0; a run writes `<-of>.json` with one word.
function fakeWhisper(dir, language) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'whisper-cli');
  const json = JSON.stringify({ result: { language }, transcription: [{ offsets: { from: 0, to: 0 }, text: '' }, { offsets: { from: 100, to: 400 }, text: ' Hello' }] });
  writeFileSync(p, `#!/bin/sh\nout=""; prev=""\nfor a in "$@"; do [ "$prev" = "-of" ] && out="$a"; prev="$a"; done\n[ -z "$out" ] && exit 0\nprintf '%s' '${json}' > "$out.json"\n`);
  chmodSync(p, 0o755);
  return dir;
}

const runCli = (args, env) =>
  new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

test('tools/asr.mjs says the language it ran in, and englishOnly for an .en model', { skip: (process.platform === 'win32' || !ffmpegOk) && 'needs sh and ffmpeg' }, async () => {
  const root = tmp();
  try {
    const audio = join(root, 'a b.wav');
    const mk = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audio], { env: toolEnv() });
    assert.equal(mk.status, 0, String(mk.stderr));
    const bin = fakeWhisper(join(root, 'bin'), 'en');
    const env = { ...toolEnv(), PATH: [bin, toolEnv().PATH].join(delimiter) };
    const en = touch(root, 'ggml-small.en.bin');
    const out = join(root, 'words.json');
    const r = await runCli([audio, '--out', out], { ...env, BOQO_WHISPER_MODEL: en });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.words, 1);
    assert.equal(j.model, 'ggml-small.en.bin');
    assert.equal(j.lang, 'en');
    assert.equal(j.englishOnly, true);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).map((x) => x.w), ['Hello']);

    const multi = touch(root, 'ggml-small.bin');
    fakeWhisper(bin, 'de');
    const m = JSON.parse((await runCli([audio, '--out', out], { ...env, BOQO_WHISPER_MODEL: multi })).stdout);
    assert.equal(m.lang, 'de');
    assert.equal(m.englishOnly, false);

    // SKILL's remedy: the multilingual model beside the .en one, and --lang on the rerun
    const home = join(root, 'boqo home');
    touch(join(home, 'models'), 'ggml-small.en.bin');
    touch(join(home, 'models'), 'ggml-base.bin');
    const base = { ...env, BOQO_HOME: home, BOQO_WHISPER_MODEL: '', HOME: root, USERPROFILE: root };
    const auto = JSON.parse((await runCli([audio, '--out', out], base)).stdout);
    assert.equal(auto.model, 'ggml-small.en.bin');
    assert.equal(auto.englishOnly, true);
    const de = JSON.parse((await runCli([audio, '--lang', 'de', '--out', out], base)).stdout);
    assert.equal(de.model, 'ggml-base.bin');
    assert.equal(de.englishOnly, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
