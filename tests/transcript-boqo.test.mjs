// tools/transcript-boqo.mjs on a synthetic get_transcript result (tests/fixtures/transcript-boqo.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTranscriptJson, parseBoqoTranscript } from '../engine/transcript-boqo.mjs';
import { segmentsFromWords } from '../engine/segments.mjs';

const CLI = fileURLToPath(new URL('../tools/transcript-boqo.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/transcript-boqo.json', import.meta.url));
const REQUEST = fileURLToPath(new URL('../tools/select-request.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'boqo transcript test '));
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const lastJson = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));
const payload = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const serve = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/t.json?X-Amz-Signature=secret` }));
  });

test('--file writes words.json, segments.json and transcript-language.txt in the skill shapes', () => {
  const run = tmp();
  const r = cli(['--file', FIXTURE, '--run', run]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const p = payload();
  assert.deepEqual(lastJson(r), { words: p.words.length, segments: p.segments.length, language: 'en', durationSec: p.segments.at(-1).end });
  assert.deepEqual(readdirSync(run).sort(), ['segments.json', 'transcript-language.txt', 'words.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(run, 'words.json'), 'utf8')), p.words);
  const segments = JSON.parse(readFileSync(join(run, 'segments.json'), 'utf8'));
  assert.deepEqual(segments, p.segments);
  // speakers stay whole numbers, null stays null; every segment has exactly the four keys
  assert.deepEqual(segments.map((s) => s.speaker), [0, 1, 0, null]);
  for (const s of segments) assert.deepEqual(Object.keys(s), ['start', 'end', 'text', 'speaker']);
  assert.equal(readFileSync(join(run, 'transcript-language.txt'), 'utf8'), 'en\n');
});

test('the words file is what tools/transcript.mjs reads, and the segments are what select-request reads', () => {
  const run = tmp();
  assert.equal(cli(['--file', FIXTURE, '--run', run]).status, 0);
  const out = join(run, 'transcript.md');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/transcript.mjs', import.meta.url)), '--words', join(run, 'words.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const q = spawnSync(process.execPath, [REQUEST, '--run', run], { encoding: 'utf8' });
  assert.equal(q.status, 0, q.stdout + q.stderr);
  // hosted prints a line with its speaker, `S1: ` for speaker 1
  assert.match(readFileSync(join(run, 'select-request.md'), 'utf8'), /S1: Today we talk about a very silly thing\./);
});

test('select-request reads the language the boqo transcript wrote, and --lang still wins', () => {
  const run = tmp();
  const p = payload();
  p.language = 'ru';
  writeFileSync(join(run, 'in.json'), JSON.stringify(p));
  assert.equal(cli(['--file', join(run, 'in.json'), '--run', run]).status, 0);
  const sel = (extra) => {
    const r = spawnSync(process.execPath, [REQUEST, '--run', run, ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(readFileSync(join(run, 'select-options.json'), 'utf8')).language;
  };
  assert.equal(sel([]), 'ru');
  assert.equal(sel(['--lang', 'de']), 'de');
});

test('a language that is not a tag reads as English', () => {
  const run = tmp();
  const p = payload();
  p.language = 'multi-lingual-mix-beyond-eight';
  writeFileSync(join(run, 'in.json'), JSON.stringify(p));
  assert.equal(cli(['--file', join(run, 'in.json'), '--run', run]).status, 0);
  assert.equal(readFileSync(join(run, 'transcript-language.txt'), 'utf8'), 'en\n');
});

const BAD = {
  'not an object': () => [],
  'no language': (p) => { delete p.language; return p; },
  'empty language': (p) => ({ ...p, language: '' }),
  'language not a string': (p) => ({ ...p, language: 5 }),
  'no segments': (p) => { delete p.segments; return p; },
  'empty segments': (p) => ({ ...p, segments: [] }),
  'no words': (p) => { delete p.words; return p; },
  'empty words': (p) => ({ ...p, words: [] }),
  'segment text not a string': (p) => { p.segments[0].text = 7; return p; },
  'segment end before start': (p) => { p.segments[1].end = 0; return p; },
  'segment start as a string': (p) => { p.segments[0].start = '1'; return p; },
  'segments out of order': (p) => { p.segments.reverse(); return p; },
  'speaker 1.5': (p) => { p.segments[0].speaker = 1.5; return p; },
  'speaker a string': (p) => { p.segments[0].speaker = '1'; return p; },
  'speaker negative': (p) => { p.segments[0].speaker = -1; return p; },
  'speaker missing': (p) => { delete p.segments[0].speaker; return p; },
  'word w not a string': (p) => { p.words[0].w = null; return p; },
  'word end before start': (p) => { p.words[2].e = p.words[2].s - 1; return p; },
  'word time as a string': (p) => { p.words[0].s = '0'; return p; },
  'word negative start': (p) => { p.words[0].s = -1; return p; },
  'word is an array': (p) => { p.words[0] = ['a', 0, 1]; return p; },
  'huge word': (p) => { p.words[0].w = 'x'.repeat(1000); return p; },
  'huge segment': (p) => { p.segments[0].text = 'x'.repeat(100001); return p; },
};

for (const [name, mutate] of Object.entries(BAD)) {
  test(`a malformed payload is rejected, nothing written: ${name}`, () => {
    const run = tmp();
    const file = join(run, 'in.json');
    writeFileSync(file, JSON.stringify(mutate(payload())));
    const r = cli(['--file', file, '--run', run]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.ok(typeof lastJson(r).error === 'string' && !lastJson(r).error.includes('\n'));
    assert.deepEqual(readdirSync(run), ['in.json']);
    assert.throws(() => parseBoqoTranscript(mutate(payload())));
  });
}

test('text that is not JSON, and a missing file, are one-line errors with nothing written', () => {
  const run = tmp();
  writeFileSync(join(run, 'in.json'), '{"language": "en", ');
  for (const args of [['--file', join(run, 'in.json')], ['--file', join(run, 'nope.json')]]) {
    const r = cli([...args, '--run', run]);
    assert.equal(r.status, 1);
    assert.ok(lastJson(r).error);
  }
  assert.deepEqual(readdirSync(run), ['in.json']);
});

test('a hostile key cannot reach the output', () => {
  const p = JSON.parse(readFileSync(FIXTURE, 'utf8').replace('"language"', '"__proto__": {"x": 1}, "constructor": 1, "language"'));
  const out = parseBoqoTranscript(p);
  assert.deepEqual(Object.keys(out).sort(), ['language', 'segments', 'words']);
  assert.equal({}.x, undefined);
});

test('usage: one source, a run, nothing else', () => {
  const run = tmp();
  for (const args of [[], ['--run', run], ['--file', FIXTURE], ['--file', FIXTURE, '--url', 'http://127.0.0.1:1/x', '--run', run], ['--run', run, '--file', FIXTURE, '--bogus', '1'], ['--run', join(run, 'nope'), '--file', FIXTURE]]) {
    const r = cli(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.ok(lastJson(r).error);
  }
  assert.deepEqual(readdirSync(run), []);
});

const cliAsync = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr }));
  });

test('--url downloads the JSON and writes the files; the signed link is never printed', async () => {
  const { server, url } = await serve((req, res) => res.end(readFileSync(FIXTURE)));
  try {
    const run = tmp();
    const r = await cliAsync(['--url', url, '--run', run]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(readdirSync(run).sort(), ['segments.json', 'transcript-language.txt', 'words.json']);
    assert.ok(!r.stdout.includes('secret') && !r.stderr.includes('secret'));
  } finally {
    server.close();
  }
});

test('--url with an error status or a redirect is a one-line error with no link in it', async () => {
  const { server, url } = await serve((req, res) => {
    if (req.url.startsWith('/t.json')) { res.statusCode = 403; res.end('denied X-Amz-Signature=secret'); }
  });
  try {
    for (const target of [url, url.replace('/t.json', '/other.json')]) {
      const run = tmp();
      const r = await cliAsync(['--url', target, '--run', run]);
      assert.equal(r.status, 1);
      assert.ok(JSON.parse(r.stdout.trim()).error);
      assert.ok(!r.stdout.includes('secret') && !r.stdout.includes('127.0.0.1'));
      assert.deepEqual(readdirSync(run), []);
    }
  } finally {
    server.close();
  }
});

test('--url refuses a link that is not https (http only to this machine), with credentials, or of another scheme', async () => {
  for (const url of ['http://example.com/t.json', 'ftp://example.com/t.json', 'file:///etc/passwd', 'https://user:pw@example.com/t.json', 'not a url']) {
    const run = tmp();
    const r = await cliAsync(['--url', url, '--run', run]);
    assert.equal(r.status, 1, url);
    assert.ok(JSON.parse(r.stdout.trim()).error);
    assert.ok(!r.stdout.includes('pw@'));
    assert.deepEqual(readdirSync(run), []);
  }
});

test('fetchTranscriptJson stops at the size cap, on a declared length and on a body that runs on', async () => {
  const big = Buffer.alloc(5000, 0x20);
  const declared = await serve((req, res) => { res.setHeader('content-length', big.length); res.end(big); });
  const chunked = await serve((req, res) => { res.write(big); res.end(big); });
  const small = await serve((req, res) => res.end('{"a":1}'));
  try {
    for (const { url } of [declared, chunked]) {
      await assert.rejects(fetchTranscriptJson(url, { maxBytes: 4000 }), /larger than/);
    }
    assert.deepEqual(await fetchTranscriptJson(small.url, { maxBytes: 4000 }), { a: 1 });
  } finally {
    for (const { server } of [declared, chunked, small]) server.close();
  }
});

test('fetchTranscriptJson gives up on a server that does not answer', async () => {
  const { server, url } = await serve(() => {});
  try {
    const t0 = Date.now();
    await assert.rejects(fetchTranscriptJson(url, { timeoutMs: 200 }), /did not answer in time|timed out/);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
