// The encode pass: engine/boqo/compose.mjs `buildFilterGraph` and `composeArgs`, posted-encode.mjs and thumbnail.mjs,
// held to boqo's own output at the pin (goldens build-filter-graph and compose-args).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectGolden } from './helpers/golden.mjs';
import { buildFilterGraph, composeArgs, escapeFilterPath } from '../engine/boqo/compose.mjs';
import { POSTED_MAX_SIZE, POSTED_VIDEO_ENCODE, postedFrame } from '../engine/boqo/posted-encode.mjs';
import { thumbnailArgs } from '../engine/boqo/thumbnail.mjs';
import { logoChain, logoOverlayPosition } from '../engine/boqo/brand-logo.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));

test('buildFilterGraph: fill, track, fit-blur, stack and panels plans, with captions, headline and logo (golden build-filter-graph)', () => {
  const input = fixture('build-filter-graph');
  const output = input.output;
  const logo = (l) => {
    const position = logoOverlayPosition(l, output);
    return { chain: logoChain(l, output), x: position.x, y: position.y, ...(l.enableFromSec !== undefined && { enableFromSec: l.enableFromSec }) };
  };
  const plan = (name) => input.shots.map((shot, i) => ({ shot, placement: input.placements[input.plans[name][i]] }));
  const graphs = Object.keys(input.plans).map((name) => ({
    name,
    variants: input.variants.map((v) => ({
      name: v.name,
      graph: buildFilterGraph({
        shots: plan(name),
        output,
        assPath: v.assPath ?? null,
        headlineAssPath: v.headlineAssPath ?? null,
        textBelowAssPath: v.textBelowAssPath ?? null,
        brandLogo: v.logo ? logo(v.logo) : null,
        blurSigma: input.blurSigma,
      }),
    })),
  }));
  const backdrops = input.backdrops.map((backdrop) => ({
    backdrop,
    graph: buildFilterGraph({ shots: plan('fit-blur'), output, assPath: 'captions.ass', blurSigma: input.blurSigma, backdrop }),
  }));
  expectGolden('build-filter-graph', { graphs, backdrops }, { tol: 0 });
});

test('composeArgs, POSTED_VIDEO_ENCODE, postedFrame and thumbnailArgs (golden compose-args)', () => {
  const input = fixture('compose-args');
  expectGolden(
    'compose-args',
    {
      POSTED_VIDEO_ENCODE,
      POSTED_MAX_SIZE,
      frames: input.frames.map((f) => ({ f, frame: postedFrame(f) })),
      compose: input.compose.map((c) => ({ c, args: composeArgs(c) })),
      thumbnails: input.durations.map((d) => ({
        d,
        args: thumbnailArgs({ videoPath: input.videoPath, atSec: Math.min(1, d / 2), outPath: input.thumbPath }),
      })),
    },
    { tol: 0 },
  );
});

test('the encode is the production one: libx264 fast CRF 18, yuv420p, at most 60 fps; AAC; faststart; audio as the source has it', () => {
  const args = composeArgs({ videoPath: 'w.mp4', filterGraph: '[0:v]null[vout]', outPath: 'clip.mp4', filterThreads: 2, encodeThreads: 4 });
  const pair = (k) => args[args.indexOf(k) + 1];
  assert.equal(pair('-c:v'), 'libx264');
  assert.equal(pair('-preset'), 'fast');
  assert.equal(pair('-crf'), '18');
  assert.equal(pair('-pix_fmt'), 'yuv420p');
  assert.equal(pair('-fpsmax'), '60');
  assert.equal(pair('-c:a'), 'aac');
  assert.equal(pair('-movflags'), '+faststart');
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '[vout]', '-map', '0:a?']);
});

test('a subtitles pass can be drawn by another filter (the skill names its fonts folder); the default is boqo\'s', () => {
  const shots = [{ shot: { startSec: 0, endSec: 2 }, placement: { kind: 'fit' } }];
  const base = { shots, output: { width: 1080, height: 1920 }, assPath: 'captions.ass', headlineAssPath: 'headline.ass', blurSigma: 40 };
  assert.match(buildFilterGraph(base), /\[vcat\]subtitles=captions\.ass\[vcapped\];\[vcapped\]subtitles=headline\.ass\[vout\]$/);
  const drawn = buildFilterGraph({ ...base, subtitles: (p) => `subtitles=filename=${p}:fontsdir=fonts` });
  assert.match(drawn, /\[vcat\]subtitles=filename=captions\.ass:fontsdir=fonts\[vcapped\];\[vcapped\]subtitles=filename=headline\.ass:fontsdir=fonts\[vout\]$/);
  assert.equal(escapeFilterPath('C:\\a:b'), 'C\\:\\\\a\\:b');
});
