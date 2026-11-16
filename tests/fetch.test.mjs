import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickReactions } from '../engine/boqo/viewer-reactions.mjs';
import {
  FORMAT,
  captionArgs,
  captionTrackOf,
  commentArgs,
  commentsFromInfo,
  fetchComments,
  fetchInfo,
  fetchSections,
  heatOf,
  infoArgs,
  planFallback,
  sectionArgs,
  sectionBounds,
  sectionResult,
  wholeArgs,
} from '../engine/fetch.mjs';

const CLI = fileURLToPath(new URL('../tools/fetch.mjs', import.meta.url));
const URL1 = 'https://www.youtube.com/watch?v=abc123';
const tmp = () => mkdtempSync(join(tmpdir(), 'boqo-fetch-'));

test('format string is the measured one', () => {
  assert.equal(FORMAT, 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]');
});

test('arg builders produce exact arrays', () => {
  assert.deepEqual(infoArgs(URL1), ['--js-runtimes', 'node', '--no-playlist', '-J', URL1]);
  assert.deepEqual(captionArgs(URL1, { kind: 'auto', lang: 'en-orig' }, 'w'), [
    '--js-runtimes', 'node', '--no-playlist', '--skip-download',
    '--write-auto-subs', '--sub-langs', 'en-orig', '--sub-format', 'json3',
    '-o', join('w', 'captions.%(ext)s'), URL1,
  ]);
  assert.deepEqual(captionArgs(URL1, { kind: 'manual', lang: 'fr' }, 'w').slice(4, 8), [
    '--write-subs', '--sub-langs', 'fr', '--sub-format',
  ]);
  assert.deepEqual(sectionArgs(URL1, 599, 661.5, join('w', 'sec-0')), [
    '--js-runtimes', 'node', '--no-playlist', '-f', FORMAT, '--merge-output-format', 'mp4',
    '--download-sections', '*599-661.5', '-o', join('w', 'sec-0') + '.%(ext)s', URL1,
  ]);
  assert.deepEqual(wholeArgs(URL1, join('w', 'whole')), [
    '--js-runtimes', 'node', '--no-playlist', '-f', FORMAT, '--merge-output-format', 'mp4',
    '-o', join('w', 'whole') + '.%(ext)s', URL1,
  ]);
});

test('captionTrackOf: the word-timed <base>-orig track beats a manual one in the video language', () => {
  // measured on a TED talk: manual `en` has one seg per line and no word times
  const info = {
    language: 'en',
    subtitles: { en: [{ ext: 'json3' }], de: [{ ext: 'json3' }] },
    automatic_captions: { 'en-orig': [{ ext: 'json3' }], en: [{ ext: 'json3' }], de: [{ ext: 'json3' }] },
  };
  assert.deepEqual(captionTrackOf(info), { kind: 'auto', lang: 'en-orig' });
  assert.deepEqual(captionTrackOf({ ...info, language: 'en-US', subtitles: { 'en-GB': [{ ext: 'json3' }] } }), {
    kind: 'auto',
    lang: 'en-orig',
  });
});

test('captionTrackOf: with no <base>-orig, a manual track in the video language comes first', () => {
  const info = {
    language: 'en-US',
    subtitles: { 'en-GB': [{ ext: 'json3' }], de: [{ ext: 'json3' }] },
    automatic_captions: { en: [{ ext: 'json3' }], fr: [{ ext: 'json3' }] },
  };
  assert.deepEqual(captionTrackOf(info), { kind: 'manual', lang: 'en-GB' });
  assert.deepEqual(captionTrackOf({ ...info, subtitles: { en: [{ ext: 'json3' }], 'en-GB': [{ ext: 'json3' }] } }), {
    kind: 'manual',
    lang: 'en',
  });
  assert.deepEqual(captionTrackOf({ ...info, subtitles: { 'en-US': [{}], en: [{}] } }), { kind: 'manual', lang: 'en-US' });
});

test('captionTrackOf: auto only gives en-orig when the language is en-US', () => {
  const info = {
    language: 'en-US',
    subtitles: {},
    automatic_captions: { en: [{ ext: 'json3' }], 'en-orig': [{ ext: 'json3' }], fr: [{ ext: 'json3' }] },
  };
  assert.deepEqual(captionTrackOf(info), { kind: 'auto', lang: 'en-orig' });
});

test('captionTrackOf: a different -orig for another language', () => {
  const info = {
    language: 'fr',
    automatic_captions: { 'fr-orig': [{ ext: 'json3' }], en: [{ ext: 'json3' }] },
  };
  assert.deepEqual(captionTrackOf(info), { kind: 'auto', lang: 'fr-orig' });
});

test('captionTrackOf: any manual track beats a foreign auto one; live chat is not a track', () => {
  assert.deepEqual(
    captionTrackOf({
      language: 'ru',
      subtitles: { live_chat: [{ ext: 'json' }], ja: [{ ext: 'json3' }] },
      automatic_captions: { 'en-orig': [{ ext: 'json3' }] },
    }),
    { kind: 'manual', lang: 'ja' },
  );
});

test('captionTrackOf: language unknown gives en-orig, then any -orig, then a manual track', () => {
  assert.deepEqual(captionTrackOf({ automatic_captions: { 'en-orig': [{}], 'de-orig': [{}] } }), { kind: 'auto', lang: 'en-orig' });
  assert.deepEqual(captionTrackOf({ automatic_captions: { 'de-orig': [{}] } }), { kind: 'auto', lang: 'de-orig' });
  // an -orig track is the speech as spoken, word-timed: it beats a manual one
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { 'en-orig': [{}] } }), { kind: 'auto', lang: 'en-orig' });
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { 'de-orig': [{}] } }), { kind: 'auto', lang: 'de-orig' });
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { fr: [{}] } }), { kind: 'manual', lang: 'en' });
});

test('captionTrackOf: no captions at all is null', () => {
  assert.equal(captionTrackOf({ language: 'en', subtitles: {}, automatic_captions: {} }), null);
  assert.equal(captionTrackOf({}), null);
  assert.equal(captionTrackOf({ language: 'en', automatic_captions: { en: [{}], fr: [{}] } }), null);
});

test('heatOf maps the yt-dlp heatmap, or gives []', () => {
  assert.deepEqual(heatOf({ heatmap: [{ start_time: 0, end_time: 5.5, value: 0.9 }] }), [{ s: 0, e: 5.5, v: 0.9 }]);
  assert.deepEqual(heatOf({}), []);
  assert.deepEqual(heatOf({ heatmap: null }), []);
});

test('sectionResult: ok, short, failed', () => {
  assert.equal(sectionResult({ asked: 60, got: 60 }), 'ok');
  assert.equal(sectionResult({ asked: 60, got: 54 }), 'ok');
  assert.equal(sectionResult({ asked: 60, got: 53.9 }), 'short');
  assert.equal(sectionResult({ asked: 60, got: 31 }), 'short');
  assert.equal(sectionResult({ asked: 60, got: null }), 'failed');
});

test('sectionBounds pads one second each side and clamps to the video', () => {
  assert.deepEqual(sectionBounds({ s: 600, e: 630 }, 3600), { s: 599, e: 631 });
  assert.deepEqual(sectionBounds({ s: 0.5, e: 30 }, 3600), { s: 0, e: 31 });
  assert.deepEqual(sectionBounds({ s: 3570, e: 3599.5 }, 3600), { s: 3569, e: 3600 });
  assert.deepEqual(sectionBounds({ s: 10, e: 40 }), { s: 9, e: 41 });
});

test('planFallback: one whole download plus one cut per pick, 2 s earlier than the padded start', () => {
  const picks = [{ s: 600, e: 630, title: 'a' }, { s: 1000, e: 1040, title: 'b' }];
  const plan = planFallback(URL1, picks, 'w', 3600);
  assert.deepEqual(plan.whole, wholeArgs(URL1, join('w', 'whole')));
  assert.equal(plan.wholeFile, join('w', 'whole.mp4'));
  assert.equal(plan.cuts.length, 2);
  assert.deepEqual(plan.cuts[0], {
    pick: 0,
    file: join('w', 'sec-0.mp4'),
    offset: 3,
    asked: 34,
    args: ['-y', '-v', 'error', '-ss', '597', '-i', 'whole.mp4', '-t', '34', '-c', 'copy', 'sec-0.mp4'],
  });
  assert.equal(plan.cuts[1].offset, 3);
  assert.equal(plan.cuts[1].args[4], '997');
  // near the start: no negative seek, offset follows
  const early = planFallback(URL1, [{ s: 1.5, e: 40, title: 'x' }], 'w', 3600).cuts[0];
  assert.equal(early.args[4], '0');
  assert.equal(early.offset, 1.5);
});

// ---- injected runners: no network, no binaries

const fakeRun = (over = {}) => ({
  ytdlp: async () => ({ stdout: '', stderr: '' }),
  probe: async () => null,
  ffmpeg: async () => {},
  ...over,
});
const outOf = (args) => args[args.indexOf('-o') + 1].replace('.%(ext)s', '');

test('fetchInfo writes info, words, transcript and reports the counts', async () => {
  const dir = tmp();
  const info = {
    id: 'abc123', title: 'Talk', duration: 1800, language: 'en-US',
    subtitles: {}, automatic_captions: { 'en-orig': [{ ext: 'json3' }] },
    heatmap: [{ start_time: 0, end_time: 10, value: 0.8 }],
  };
  const json3 = { events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 500 }] }] };
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      if (args.includes('-J')) return { stdout: JSON.stringify(info), stderr: '' };
      writeFileSync(join(dir, 'captions.en-orig.json3'), JSON.stringify(json3));
      return { stdout: '', stderr: '' };
    },
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.deepEqual(out, { id: 'abc123', title: 'Talk', duration: 1800, captions: 'auto', chunks: 1 });
  assert.equal(calls.length, 2, 'info call, then exactly one caption call');
  assert.equal(JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8')).id, 'abc123');
  const words = JSON.parse(readFileSync(join(dir, 'words.json'), 'utf8'));
  assert.deepEqual(words.map((w) => w.w), ['hello', 'world']);
  const md = readFileSync(join(dir, 'transcript.md'), 'utf8');
  assert.match(md, /^## Part 1/);
  assert.match(md, /\[00:01\] hello world ▲/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'segments.json'), 'utf8')), [{ start: words[0].s, end: words[1].e, text: 'hello world', speaker: null }]);
  rmSync(dir, { recursive: true });
});

test('fetchInfo: a video with manual and en-orig captions asks for en-orig only, once', async () => {
  const dir = tmp();
  const info = {
    id: 'ted', title: 'Talk', duration: 1200, language: 'en',
    subtitles: { en: [{ ext: 'json3' }] }, automatic_captions: { 'en-orig': [{ ext: 'json3' }], en: [{ ext: 'json3' }] },
  };
  const json3 = { events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'good' }, { utf8: ' morning', tOffsetMs: 400 }] }] };
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      if (args.includes('-J')) return { stdout: JSON.stringify(info), stderr: '' };
      writeFileSync(join(dir, 'captions.en-orig.json3'), JSON.stringify(json3));
      return { stdout: '', stderr: '' };
    },
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.equal(out.captions, 'auto');
  assert.equal(calls.length, 2);
  const cap = calls[1];
  assert.ok(cap.includes('--write-auto-subs') && !cap.includes('--write-subs'));
  assert.equal(cap[cap.indexOf('--sub-langs') + 1], 'en-orig');
  rmSync(dir, { recursive: true });
});

test('fetchInfo with no captions: captions none, chunks 0, no words or transcript', async () => {
  const dir = tmp();
  const run = fakeRun({
    ytdlp: async () => ({ stdout: JSON.stringify({ id: 'x', title: 'Upload', duration: 90, subtitles: {}, automatic_captions: {} }), stderr: '' }),
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.deepEqual(out, { id: 'x', title: 'Upload', duration: 90, captions: 'none', chunks: 0 });
  assert.ok(existsSync(join(dir, 'info.json')));
  assert.equal(existsSync(join(dir, 'words.json')), false);
  assert.equal(existsSync(join(dir, 'transcript.md')), false);
  assert.equal(existsSync(join(dir, 'segments.json')), false);
  rmSync(dir, { recursive: true });
});

const picks2 = [{ s: 600, e: 630, title: 'a' }, { s: 1000, e: 1030, title: 'b' }];

test('fetchSections: all ok gives sec files with offsets, no fallback, concurrency capped at 3', async () => {
  const dir = tmp();
  let live = 0;
  let peak = 0;
  const wrote = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 15));
      writeFileSync(outOf(args) + '.mp4', 'x');
      wrote.push(args);
      live--;
      return { stdout: '', stderr: '' };
    },
    probe: async () => 32,
  });
  const many = Array.from({ length: 7 }, (_, i) => ({ s: 100 * (i + 1), e: 100 * (i + 1) + 30, title: String(i) }));
  const out = await fetchSections({ url: URL1, picks: many, dir, duration: 3600, run });
  assert.equal(out.files.length, 7);
  assert.equal(peak, 3);
  assert.deepEqual(out.files[0], { pick: 0, file: join(dir, 'sec-0.mp4'), offset: 1 });
  assert.ok(wrote.every((a) => a.includes('--download-sections')));
  rmSync(dir, { recursive: true });
});

test('fetchSections: a short section triggers one whole download and a local cut', async () => {
  const dir = tmp();
  const calls = [];
  const cuts = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    // section 0 comes back at 31 s of 32; section 1 is fine, 0 comes back short
    probe: async (file) => (file.endsWith('sec-0.mp4') && !cuts.length ? 17 : 32),
    ffmpeg: async (args, cwd) => {
      cuts.push({ args, cwd });
      writeFileSync(join(cwd, args.at(-1)), 'x');
    },
  });
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run });
  const wholeCalls = calls.filter((a) => !a.includes('--download-sections'));
  assert.equal(wholeCalls.length, 1);
  assert.equal(cuts.length, 1, 'only the short section is cut');
  assert.equal(cuts[0].cwd, dir);
  assert.deepEqual(cuts[0].args.slice(0, 7), ['-y', '-v', 'error', '-ss', '597', '-i', 'whole.mp4']);
  assert.deepEqual(out.files, [
    { pick: 0, file: join(dir, 'sec-0.mp4'), offset: 3 },
    { pick: 1, file: join(dir, 'sec-1.mp4'), offset: 1 },
  ]);
  assert.equal(existsSync(join(dir, 'whole.mp4')), false, 'whole download removed after cutting');
  rmSync(dir, { recursive: true });
});

test('fetchSections: a failed section also falls back', async () => {
  const dir = tmp();
  let sections = 0;
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('--download-sections')) {
        sections++;
        if (sections === 2) throw new Error('HTTP 403');
      }
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    probe: async () => 32,
    ffmpeg: async (args, cwd) => writeFileSync(join(cwd, args.at(-1)), 'x'),
  });
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run });
  assert.equal(out.files.length, 2);
  assert.equal(out.files.filter((f) => f.offset === 3).length, 1);
  rmSync(dir, { recursive: true });
});

test('fetchSections: the whole download gets one retry', async () => {
  const dir = tmp();
  let wholeTries = 0;
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('--download-sections')) throw new Error('range failed');
      if (++wholeTries === 1) throw new Error('HTTP 403');
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    probe: async () => 40,
    ffmpeg: async (args, cwd) => writeFileSync(join(cwd, args.at(-1)), 'x'),
  });
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, retryMs: 0 });
  assert.equal(wholeTries, 2);
  assert.equal(out.files.length, 2);
  rmSync(dir, { recursive: true });
});

test('fetchSections: fallback failing too names both failures', async () => {
  const dir = tmp();
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('--download-sections')) throw new Error('HTTP 403 on range');
      throw new Error('HTTP 429 on whole');
    },
  });
  await assert.rejects(
    () => fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, retryMs: 0 }),
    (err) => /section/.test(err.message) && /HTTP 403 on range/.test(err.message) && /whole/.test(err.message) && /HTTP 429 on whole/.test(err.message),
  );
  rmSync(dir, { recursive: true });
});

test('fetchInfo keeps chapters, description and channel in info.json', async () => {
  const dir = tmp();
  const info = {
    id: 'abc123', title: 'Talk', duration: 1800, channel: 'Some Channel', description: 'About this talk',
    chapters: [{ start_time: 0, end_time: 60, title: 'Start' }], subtitles: {}, automatic_captions: {},
  };
  await fetchInfo({ url: URL1, dir, run: fakeRun({ ytdlp: async () => ({ stdout: JSON.stringify(info), stderr: '' }) }) });
  const kept = JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8'));
  assert.equal(kept.channel, 'Some Channel');
  assert.equal(kept.description, 'About this talk');
  assert.deepEqual(kept.chapters, info.chapters);
  rmSync(dir, { recursive: true });
});

// ---- viewer comments (best effort)

const COMMENTS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/ytdlp-comments.json', import.meta.url)), 'utf8'));

test('commentArgs: top order, at most 200 top-level comments, no replies', () => {
  assert.deepEqual(commentArgs(URL1), [
    '--js-runtimes', 'node', '--no-playlist', '--skip-download', '--write-comments',
    '--extractor-args', 'youtube:max_comments=200,200,0,0,1;comment_sort=top', '-J', URL1,
  ]);
});

test('commentsFromInfo maps yt-dlp comments onto {text, likes}: top level only, text only, likes a whole number', () => {
  assert.deepEqual(commentsFromInfo(COMMENTS_FIXTURE), [
    { text: '12:30 the split colony part made me laugh', likes: 410 },
    { text: 'At 31:05 never open a hive on a cold afternoon', likes: 230 },
    { text: 'no timestamp, just praise', likes: 80 },
    { text: '0:00 intro 3:10 winter 12:30 splits 31:05 wax 38:00 outro', likes: 55 },
    { text: 'a comment with no parent field, 20:00 counts as top level', likes: 7 },
    { text: '40:00 likes missing', likes: 0 },
    { text: '40:00 likes not a number', likes: 0 },
  ]);
  assert.equal(commentsFromInfo({}), null);
  assert.equal(commentsFromInfo({ comments: 'x' }), null);
  assert.equal(commentsFromInfo(null), null);
  const many = { comments: Array.from({ length: 250 }, (_, i) => ({ parent: 'root', text: `c${i}`, like_count: i })) };
  assert.equal(commentsFromInfo(many).length, 200);
});

test('the mapped comments feed the hosted filter: timestamped ones only, chapter list and replies out', () => {
  const reactions = pickReactions(commentsFromInfo(COMMENTS_FIXTURE), 2400);
  assert.deepEqual(reactions.map((r) => [r.sec, r.likes]), [[750, 410], [1200, 7], [1865, 230], [2400, 0]]);
});

test('fetchComments writes comments.json and returns it', async () => {
  const dir = tmp();
  const seen = [];
  const run = fakeRun({ ytdlp: async (args, opts) => { seen.push([args, opts]); return { stdout: JSON.stringify(COMMENTS_FIXTURE), stderr: '' }; } });
  const out = await fetchComments({ url: URL1, dir, run });
  assert.equal(out.count, 7);
  assert.equal(out.file, join(dir, 'comments.json'));
  assert.deepEqual(JSON.parse(readFileSync(out.file, 'utf8')), commentsFromInfo(COMMENTS_FIXTURE));
  assert.deepEqual(seen[0][0], commentArgs(URL1));
  assert.ok(seen[0][1].signal instanceof AbortSignal);
  rmSync(dir, { recursive: true });
});

test('fetchComments never throws: a failed run, bad JSON and an info with no comments are all null, and an old file is removed', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'comments.json'), '[{"text":"stale","likes":1}]');
  const fails = [
    async () => { throw new Error('HTTP 429'); },
    () => { throw new Error('threw before returning a promise'); },
    async () => ({ stdout: 'not json', stderr: '' }),
    async () => ({ stdout: JSON.stringify({ id: 'x' }), stderr: '' }),
  ];
  for (const ytdlp of fails) {
    assert.equal(await fetchComments({ url: URL1, dir, run: fakeRun({ ytdlp }) }), null);
    assert.equal(existsSync(join(dir, 'comments.json')), false);
  }
  rmSync(dir, { recursive: true });
});

test('fetchComments: a run that hangs is aborted at timeoutMs and returns null', async () => {
  const dir = tmp();
  let signal;
  const run = fakeRun({ ytdlp: (args, opts) => { signal = opts.signal; return new Promise(() => {}); } });
  const t0 = Date.now();
  assert.equal(await fetchComments({ url: URL1, dir, run, timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 2000, 'returned long before any real timeout');
  assert.equal(signal.aborted, true, 'the run was told to stop');
  rmSync(dir, { recursive: true });
});

test('CLI: usage errors are one JSON line and exit 1', () => {
  for (const args of [[], ['nope'], ['info'], ['comments'], ['comments', 'ftp://x', '--dir', 'd'], ['info', 'https://x.test/v'], ['sections', URL1, '--dir', 'd'], ['info', 'ftp://x', '--dir', 'd']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' '));
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(typeof JSON.parse(lines[0]).error, 'string');
  }
});

// Live: needs the network, yt-dlp, ffmpeg. Never in CI.
const LIVE = process.env.BOQO_LIVE === '1';
test('live: info then two sections', { skip: !LIVE, timeout: 900_000 }, () => {
  const url = process.env.BOQO_LIVE_URL;
  assert.ok(url, 'set BOQO_LIVE_URL to a public 20-60 min video');
  const dir = tmp();
  const info = spawnSync(process.execPath, [CLI, 'info', url, '--dir', dir], { encoding: 'utf8' });
  assert.equal(info.status, 0, info.stdout + info.stderr);
  const head = JSON.parse(info.stdout.trim());
  assert.equal(head.captions, 'auto');
  assert.ok(head.chunks >= 1);
  const picks = [{ s: 300, e: 330, title: 'one' }, { s: 600, e: 630, title: 'two' }];
  writeFileSync(join(dir, 'picks.json'), JSON.stringify(picks));
  const sec = spawnSync(process.execPath, [CLI, 'sections', url, '--picks', join(dir, 'picks.json'), '--dir', dir], { encoding: 'utf8' });
  assert.equal(sec.status, 0, sec.stdout + sec.stderr);
  const out = JSON.parse(sec.stdout.trim());
  assert.equal(out.files.length, 2);
  for (const f of out.files) assert.ok(existsSync(f.file));
  rmSync(dir, { recursive: true });
});
