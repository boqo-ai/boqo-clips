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
  captionGaps,
  captionPlan,
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

test('captionTrackOf: a manual track in another language is a translation, so never taken; live chat is not a track', () => {
  assert.equal(
    captionTrackOf({
      language: 'ru',
      subtitles: { live_chat: [{ ext: 'json' }], ja: [{ ext: 'json3' }] },
      automatic_captions: { 'en-orig': [{ ext: 'json3' }] },
    }),
    null,
  );
  assert.deepEqual(captionTrackOf({ language: 'ru', subtitles: { live_chat: [{}], ru: [{}], ja: [{}] } }), { kind: 'manual', lang: 'ru' });
});

test('captionTrackOf: language unknown takes the one -orig track, else the one manual track, else none', () => {
  assert.deepEqual(captionTrackOf({ automatic_captions: { 'de-orig': [{}] } }), { kind: 'auto', lang: 'de-orig' });
  // two -orig tracks and no language: which is the speech cannot be told
  assert.equal(captionTrackOf({ automatic_captions: { 'en-orig': [{}], 'de-orig': [{}] } }), null);
  // an -orig track is the speech as spoken, word-timed: it beats a manual one
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { 'en-orig': [{}] } }), { kind: 'auto', lang: 'en-orig' });
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { 'de-orig': [{}] } }), { kind: 'auto', lang: 'de-orig' });
  assert.deepEqual(captionTrackOf({ subtitles: { en: [{}] }, automatic_captions: { fr: [{}] } }), { kind: 'manual', lang: 'en' });
  assert.equal(captionTrackOf({ subtitles: { en: [{}], de: [{}] } }), null, 'two manual tracks, no language');
});

// Shaped like the Urdu-speech vivo review (yt-dlp -J, 2026-11-16): `language` ur, automatic tracks en-orig, en, ur and
// hi-orig and no ur-orig. Every URL there is a plain object with `url`; only the translations carry `tlang`.
const URDU = (over = {}) => ({
  language: 'ur',
  subtitles: {},
  automatic_captions: {
    ab: [{ ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=en&variant=timing-optimized&tlang=ab&fmt=json3' }],
    'en-orig': [{ ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=en&variant=timing-optimized&fmt=json3' }],
    en: [
      { ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=en&variant=timing-optimized&fmt=json3' },
      { ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=hi&variant=gemini&tlang=en&fmt=json3' },
    ],
    ur: [
      { ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=en&variant=timing-optimized&tlang=ur&fmt=json3' },
      { ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=hi&variant=gemini&tlang=ur&fmt=json3' },
    ],
    'hi-orig': [{ ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=hi&variant=gemini&fmt=json3' }],
  },
  ...over,
});

test('captionTrackOf: Urdu speech takes hi-orig (the same spoken language), never the English en-orig', () => {
  assert.deepEqual(captionTrackOf(URDU()), { kind: 'auto', lang: 'hi-orig' });
});

test('captionTrackOf: a video in a language with no -orig of its own or a cognate has no usable track, so whisper', () => {
  const info = URDU();
  delete info.automatic_captions['hi-orig'];
  assert.equal(captionTrackOf(info), null);
  const plan = captionPlan(info);
  assert.equal(plan.track, null);
  assert.match(plan.note, /translation/);
  // the video really is English: en-orig is its speech
  assert.deepEqual(captionTrackOf({ ...URDU(), language: 'en' }), { kind: 'auto', lang: 'en-orig' });
});

test('captionTrackOf: an Urdu manual track wins over nothing, and the exact -orig over a cognate', () => {
  assert.deepEqual(captionTrackOf({ ...URDU(), automatic_captions: {}, subtitles: { ur: [{ ext: 'json3' }], en: [{ ext: 'json3' }] } }), { kind: 'manual', lang: 'ur' });
  const both = URDU();
  both.automatic_captions['ur-orig'] = [{ ext: 'json3', url: 'https://x/api/timedtext?kind=asr&lang=ur&fmt=json3' }];
  assert.deepEqual(captionTrackOf(both), { kind: 'auto', lang: 'ur-orig' });
});

test('captionTrackOf: a track every URL of which is a tlang translation is never the speech', () => {
  const info = { language: 'fr', automatic_captions: { 'fr-orig': [{ ext: 'json3', url: 'https://x/t?lang=en&tlang=fr&fmt=json3' }] } };
  assert.equal(captionTrackOf(info), null);
});

test('captionPlan: no note when the video has no captions at all', () => {
  assert.deepEqual(captionPlan({ language: 'en' }), { track: null, note: null });
});

test('captionTrackOf: a normal English video (en-orig, en, manual en, translations) takes en-orig', () => {
  const t = (q) => [{ ext: 'json3', url: `https://x/t?kind=asr&lang=en&${q}fmt=json3` }];
  const info = {
    language: 'en',
    subtitles: { en: [{ ext: 'json3', url: 'https://x/t?lang=en&fmt=json3' }] },
    automatic_captions: { 'en-orig': t(''), en: t(''), de: t('tlang=de&'), ur: t('tlang=ur&') },
  };
  assert.deepEqual(captionTrackOf(info), { kind: 'auto', lang: 'en-orig' });
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
    id: 'abc123', title: 'Talk', duration: 4, language: 'en-US',
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
  assert.deepEqual(out, { id: 'abc123', title: 'Talk', duration: 4, captions: 'auto', chunks: 1 });
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
    id: 'ted', title: 'Talk', duration: 4, language: 'en',
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

test('fetchSections: all ok gives sec files with offsets, no fallback, one download at a time', async () => {
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
  assert.equal(peak, 1, 'serial: YouTube rate-limits parallel requests, and the skill runs one yt-dlp call at a time');
  assert.deepEqual(out.files[0], { pick: 0, file: join(dir, 'sec-0.mp4'), offset: 1, s: 99, e: 131 });
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
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, sectionRetryMs: 0 });
  const wholeCalls = calls.filter((a) => !a.includes('--download-sections'));
  assert.equal(wholeCalls.length, 1);
  assert.equal(cuts.length, 1, 'only the short section is cut');
  assert.equal(cuts[0].cwd, dir);
  assert.deepEqual(cuts[0].args.slice(0, 7), ['-y', '-v', 'error', '-ss', '597', '-i', 'whole.mp4']);
  assert.deepEqual(out.files, [
    // s..e: the video seconds each file holds (the local cut starts 2 s before the padded start)
    { pick: 0, file: join(dir, 'sec-0.mp4'), offset: 3, s: 597, e: 631 },
    { pick: 1, file: join(dir, 'sec-1.mp4'), offset: 1, s: 999, e: 1031 },
  ]);
  assert.equal(existsSync(join(dir, 'whole.mp4')), false, 'whole download removed after cutting');
  rmSync(dir, { recursive: true });
});

test('fetchSections: a failed section is tried once more, alone', async () => {
  const dir = tmp();
  let sections = 0;
  let wholes = 0;
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('--download-sections')) {
        sections++;
        if (sections === 2) throw new Error('HTTP 403');
      } else wholes++;
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    probe: async () => 40,
    ffmpeg: async (args, cwd) => writeFileSync(join(cwd, args.at(-1)), 'x'),
  });
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, sectionRetryMs: 0 });
  assert.equal(out.files.length, 2);
  assert.equal(out.files.filter((f) => f.offset === 3).length, 1, 'the retried section carries 3 s of padding');
  assert.equal(wholes, 0, 'no whole-video download');
  rmSync(dir, { recursive: true });
});

test('fetchSections: a section a hair short is ok, no retry and no fallback', async () => {
  const dir = tmp();
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    probe: async () => 31.7, // of 32 s asked
  });
  await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, sectionRetryMs: 0 });
  assert.equal(calls.length, 2);
  rmSync(dir, { recursive: true });
});

test('fetchSections: a short section is tried again with 3 s of padding, and the whole video is not fetched', async () => {
  const dir = tmp();
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    // the first try of section 0 comes back at 17 of 32 s; its second, wider try (asked 36 s) is whole
    probe: async (file) => (file.endsWith('sec-0.mp4') && calls.filter((a) => outOf(a).endsWith('sec-0')).length === 1 ? 17 : 40),
  });
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, sectionRetryMs: 0 });
  const ranges = calls.map((a) => a[a.indexOf('--download-sections') + 1]);
  assert.deepEqual(ranges, ['*599-631', '*999-1031', '*597-633'], 'serial: every section once, then the short one again alone with 3 s of padding');
  assert.ok(calls.every((a) => a.includes('--download-sections')), 'no whole-video download');
  assert.deepEqual(out.files[0], { pick: 0, file: join(dir, 'sec-0.mp4'), offset: 3, s: 597, e: 633 });
  assert.deepEqual(out.files[1], { pick: 1, file: join(dir, 'sec-1.mp4'), offset: 1, s: 999, e: 1031 });
  rmSync(dir, { recursive: true });
});

test('fetchSections: stderr names the section and what came back', async () => {
  const dir = tmp();
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('--download-sections') && outOf(args).endsWith('sec-1')) throw new Error('yt-dlp failed: HTTP 403');
      writeFileSync(outOf(args) + '.mp4', 'x');
      return { stdout: '', stderr: '' };
    },
    probe: async () => 32,
    ffmpeg: async (args, cwd) => writeFileSync(join(cwd, args.at(-1)), 'x'),
  });
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (c) => (lines.push(String(c)), true);
  try {
    await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, sectionRetryMs: 0, retryMs: 0 });
  } finally {
    process.stderr.write = orig;
  }
  assert.match(lines.join(''), /section 2 failed \(yt-dlp failed: HTTP 403\); trying it once more/);
  assert.match(lines.join(''), /1 section\(s\) came back short or failed, downloading the whole video once/);
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
  const out = await fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, retryMs: 0, sectionRetryMs: 0 });
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
    () => fetchSections({ url: URL1, picks: picks2, dir, duration: 3600, run, retryMs: 0, sectionRetryMs: 0 }),
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

test('CLI sections --run: refusals for a run with no clips.json, a clip it does not have, mixed flags, and flags on another command', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'info.json'), JSON.stringify({ duration: 100 }));
  const say = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' ') + r.stdout);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    return JSON.parse(r.stdout.trim()).error;
  };
  assert.match(say(['sections', URL1, '--run', dir]), /cannot read clips\.json/);
  writeFileSync(join(dir, 'clips.json'), JSON.stringify({ clips: [{ n: 1, start: 10, end: 40 }, { n: 2, start: 50, end: 80 }] }));
  assert.match(say(['sections', URL1, '--run', dir, '--n', '3']), /no clip 3/);
  assert.match(say(['sections', URL1, '--run', dir, '--n', '1', '--all']), /at most one/);
  assert.match(say(['sections', URL1, '--run', dir, '--picks', join(dir, 'p.json')]), /not both/);
  assert.match(say(['sections', URL1, '--n', '1', '--dir', dir]), /go with --run/);
  assert.match(say(['info', URL1, '--dir', dir, '--first', '3']), /takes only/);
  rmSync(dir, { recursive: true });
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

test('fetchInfo on the Urdu case asks for hi-orig and records the transcript language hi', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'transcript-language.txt'), 'xx\n');
  const info = { id: 'u', title: 'Urdu', duration: 4, ...URDU() };
  const json3 = { events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'ek' }, { utf8: ' do', tOffsetMs: 500 }] }] };
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      if (args.includes('-J')) return { stdout: JSON.stringify(info), stderr: '' };
      writeFileSync(join(dir, 'captions.hi-orig.json3'), JSON.stringify(json3));
      return { stdout: '', stderr: '' };
    },
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.equal(out.captions, 'auto');
  assert.equal(calls[1][calls[1].indexOf('--sub-langs') + 1], 'hi-orig');
  assert.equal(readFileSync(join(dir, 'transcript-language.txt'), 'utf8'), 'hi\n');
  rmSync(dir, { recursive: true });
});

test('fetchInfo with only a translation: captions none with a one-line note, no old language file left', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'transcript-language.txt'), 'hi\n');
  const info = URDU();
  delete info.automatic_captions['hi-orig'];
  const calls = [];
  const run = fakeRun({
    ytdlp: async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ id: 'u', title: 'Urdu', duration: 600, ...info }), stderr: '' };
    },
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.equal(out.captions, 'none');
  assert.equal(calls.length, 1, 'no caption download');
  assert.match(out.note, /translation/);
  assert.equal(out.note.includes('\n'), false);
  assert.equal(existsSync(join(dir, 'transcript-language.txt')), false);
  rmSync(dir, { recursive: true });
});

// ---- partial captions

// Words half a second apart over [0, duration], except inside the `holes` ([from, to) seconds).
const wordsOver = (duration, holes = []) => {
  const out = [];
  for (let t = 0; t < duration; t += 0.5) if (!holes.some(([a, b]) => t >= a && t < b)) out.push({ w: 'w', s: t, e: t + 0.4 });
  return out;
};

test('captionGaps: the Rothenburg shape (a 41-minute video whose track has three English-speech holes) lists the three, and normal pauses are not gaps', () => {
  // Measured 2026-11-16 on the real fil-orig words.json of CYHCq4Qe61A: holes after 186 s (66 s), 501 s (74 s) and 1167 s (42 s).
  const gaps = captionGaps(wordsOver(2469, [[186, 252], [501, 575], [1167, 1209]]), 2469);
  assert.deepEqual(gaps.map((g) => [Math.round(g.start), Math.round(g.end)]), [[186, 252], [501, 575], [1167, 1209]]);
  // the largest pauses of the four other real runs were 20, 15 and 31 s, and a 39 s one is still a pause
  assert.deepEqual(captionGaps(wordsOver(1437, [[300, 320], [648, 668]]), 1437), []);
  assert.deepEqual(captionGaps(wordsOver(1812, [[332, 363]]), 1812), []);
  assert.deepEqual(captionGaps(wordsOver(600, [[100, 139]]), 600), []);
  assert.equal(captionGaps(wordsOver(600, [[100, 141]]), 600).length, 1);
});

test('captionGaps: a stretch before the first word or after the last counts, and an unknown duration skips the end', () => {
  assert.equal(captionGaps(wordsOver(1000, [[0, 90]]), 1000).length, 1);
  assert.equal(captionGaps(wordsOver(900), 1000).length, 1, 'the last 100 s have no words');
  assert.deepEqual(captionGaps(wordsOver(900), undefined), []);
  assert.deepEqual(captionGaps([], 100), []);
});

test('fetchInfo: a track with a long hole is "partial", with the gap list; its files are written as usual', async () => {
  const dir = tmp();
  const info = { id: 'r', title: 'Travel', duration: 600, language: 'fil', subtitles: {}, automatic_captions: { 'fil-orig': [{ ext: 'json3' }] } };
  const events = wordsOver(600, [[100, 190]]).filter((_, i) => i % 4 === 0).map((w) => ({ tStartMs: Math.round(w.s * 1000), dDurationMs: 400, segs: [{ utf8: 'ang' }] }));
  const run = fakeRun({
    ytdlp: async (args) => {
      if (args.includes('-J')) return { stdout: JSON.stringify(info), stderr: '' };
      writeFileSync(join(dir, 'captions.fil-orig.json3'), JSON.stringify({ events }));
      return { stdout: '', stderr: '' };
    },
  });
  const out = await fetchInfo({ url: URL1, dir, run });
  assert.equal(out.captions, 'partial');
  assert.equal(out.source, 'auto');
  assert.equal(out.gaps.length, 1);
  assert.ok(out.gaps[0].start >= 98 && out.gaps[0].start <= 102 && out.gaps[0].end >= 188 && out.gaps[0].end <= 192, JSON.stringify(out.gaps));
  assert.ok(existsSync(join(dir, 'words.json')) && existsSync(join(dir, 'segments.json')) && existsSync(join(dir, 'transcript.md')));
  rmSync(dir, { recursive: true });
});
