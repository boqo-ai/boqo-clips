// Stream panels (Task A11): the ported planner, text placement, prompts, probe and frame sampler, each held by a golden
// from boqo's own functions (scripts/parity/cases/), plus the whole planShots with a stored panels read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clipToWindowSec, windowToClipSec } from '../engine/boqo/cut-map.mjs';
import { PanelDecision, PanelProbe, PanelRect, PanelSample, PANELS_MODE } from '../engine/boqo/panels.mjs';
import { faceInRect, focusPath, panelPlacement, panelsEligible, panelsOutputEligible, panelsSourceEligible, planGeometryOk, planPanelShots, readingKept, samplesByShot, shotPanels, sourceToClipSec } from '../engine/boqo/panels-plan.mjs';
import { enoughFrames, frameArgs, sampleTimes } from '../engine/boqo/panels-frames.mjs';
import { PANELS_PROBE_SYSTEM, PANELS_PROMPT_VERSION, PANELS_SYSTEM, probeContent, probeTurn, readContent, readTurn, wordsText } from '../engine/boqo/panels-prompt.mjs';
import {
  MIN_PART_SEC, PANELS_TEXT_GAP_FRACTION, captionFloor, panelsCaptionFloor, panelsCaptionStyle, panelsTextElements, panelsTextPosition,
  panelsTextRuns,
} from '../engine/boqo/panels-text.mjs';
import { CAPTION_POSITION_MAX, scalePreset } from '../engine/boqo/caption-presets.mjs';
import { DEFAULT_HEADLINE, HEADLINE_POSITION_MAX, HEADLINE_POSITION_MIN } from '../engine/boqo/headline.mjs';
import { textElementExtent } from '../engine/boqo/headline-ass.mjs';
import { PANEL_PROBE_FRAMES, PANEL_PROBE_FRAME_WIDTH, parseProbeSize, probeSizeArgs, probeTimes } from '../engine/boqo/probe.mjs';
import { planShots } from '../engine/boqo/plan-shots.mjs';
import { expectGolden } from './helpers/golden.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const input = (name) => JSON.parse(readFileSync(join(here, 'fixtures/parity', `${name}.input.json`), 'utf8'));
const golden = (name) => JSON.parse(readFileSync(join(here, 'golden', `${name}.json`), 'utf8'));
const TOL0 = { tol: 0 };

test('production values: every eligible clip is allowed, the probe reads 6 frames at 640 px', () => {
  assert.equal(PANELS_MODE, 'all');
  assert.equal(PANEL_PROBE_FRAMES, 6);
  assert.equal(PANEL_PROBE_FRAME_WIDTH, 640);
  assert.equal(PANELS_PROMPT_VERSION, 'panels-2026-11-09d');
});

test('panelsEligible: landscape and at least 480 lines, into a portrait output (golden panels-eligible)', () => {
  const { frames, outputs } = input('panels-eligible');
  expectGolden('panels-eligible', frames.flatMap((frame) => outputs.map((output) => ({
    frame, output, eligible: panelsEligible(frame, output), source: panelsSourceEligible(frame), output_: panelsOutputEligible(output),
  }))), TOL0);
  // The brief's rule, spelled out: portrait and under 480 lines are out.
  assert.equal(panelsSourceEligible({ width: 720, height: 1280 }), false);
  assert.equal(panelsSourceEligible({ width: 1920, height: 479 }), false);
  assert.equal(panelsSourceEligible({ width: 854, height: 480 }), true);
});

test('shotPanels matches boqo (golden shot-panels: 51 hand-made scenarios and 160 seeded random ones)', () => {
  expectGolden('shot-panels', input('shot-panels').cases.map((c) => ({ name: c.name, plan: shotPanels(c.input) })), TOL0);
});

test('samplesByShot, planPanelShots, readingKept and sourceToClipSec match boqo (golden plan-panel-shots)', () => {
  const i = input('plan-panel-shots');
  const cases = i.cases.map((c) => {
    const byShot = samplesByShot(c.samples, c.shots, (sourceSec) => sourceToClipSec(sourceSec, c.startSec, c.cuts));
    const plans = planPanelShots({
      samplesByShot: byShot, shots: c.shots, faces: c.shots.map((_, k) => c.faces?.[k] ?? []), frameWidth: c.frameWidth, frameHeight: c.frameHeight,
      output: c.output, cuts: c.cuts, gameZoom: c.gameZoom, keep: (index) => !c.keepOut.includes(index),
    });
    return { name: c.name, byShot, plans };
  });
  expectGolden('plan-panel-shots', {
    cases,
    readingKept: i.readingKept.map((r) => ({ ...r, kept: readingKept(r.override ?? undefined, r.mode) })),
    sourceToClip: i.sourceToClip.map((r) => ({ ...r, clipSec: sourceToClipSec(r.sourceSec, r.startSec, r.cuts) })),
  }, TOL0);
});

test('panelPlacement, planGeometryOk and faceInRect match boqo (golden panel-placement)', () => {
  const i = input('panel-placement');
  expectGolden('panel-placement', {
    cases: i.cases.map((c) => ({
      name: c.name, geometryOk: planGeometryOk(c.plan, c.frameWidth, c.frameHeight), placed: panelPlacement(c.plan, c.faces, c.frameWidth, c.frameHeight),
    })),
    faceInRect: i.faceInRect.map((c) => ({ face: faceInRect(c.rect, c.faces, c.frameWidth, c.frameHeight) })),
  }, TOL0);
});

test('focusPath matches boqo (golden focus-path)', () => {
  expectGolden('focus-path', input('focus-path').cases.map((c) => ({ name: c.name, path: focusPath(c.keys, c.holdPx) })), TOL0);
});

test('windowToClipSec and clipToWindowSec match boqo (golden cut-time-maps)', () => {
  const { cutSets, times } = input('cut-time-maps');
  expectGolden('cut-time-maps', cutSets.map((cuts) => ({
    cuts, windowToClip: times.map((t) => windowToClipSec(t, cuts)), clipToWindow: times.map((t) => clipToWindowSec(t, cuts)),
  })), TOL0);
});

test('panelsTextPosition matches boqo (golden panels-text-position)', () => {
  expectGolden('panels-text-position', input('panels-text-position').cases.map((c) => ({ name: c.name, position: panelsTextPosition(c) })), TOL0);
  assert.equal(HEADLINE_POSITION_MIN, 0.08);
  assert.equal(HEADLINE_POSITION_MAX, 0.92);
  assert.equal(CAPTION_POSITION_MAX, 0.9);
});

test('panelsTextRuns matches boqo (golden panels-text-runs)', () => {
  expectGolden('panels-text-runs', input('panels-text-runs').cases.map((c) => ({ name: c.name, runs: panelsTextRuns(c) })), TOL0);
  assert.equal(MIN_PART_SEC, 0.8);
});

// Each text element is the default headline (core's DEFAULT_HEADLINE) with the case's text and position, as the cases
// build them; the golden prints each element's extent (boqo's own `textElementExtent`, keyed by the element's text).
// Since A13 the copy calls its own `textElementExtent`, `scalePreset` and `headlineWindow` (they were parameters
// before), and the goldens hold that to hosted's.
const asElement = (t) => ({ text: t.text, settings: { ...DEFAULT_HEADLINE, positionFraction: t.positionFraction }, style: undefined, span: t.span });

test('captionFloor and panelsCaptionFloor match boqo (golden panels-caption-floor)', () => {
  const want = golden('panels-caption-floor');
  const actual = input('panels-caption-floor').cases.map((c, k) => {
    const text = c.text.map(asElement);
    const extents = Object.fromEntries(text.map((el) => [el.text, textElementExtent(el, c.output)]));
    return { name: c.name, seam: captionFloor(c.placed, c.output.height), floor: panelsCaptionFloor(c.placed, c.output, text), extents };
  });
  expectGolden('panels-caption-floor', actual, TOL0);
  assert.equal(PANELS_TEXT_GAP_FRACTION, 0.01);
});

test('a text element on a seam pushes the caption floor to its drawn bottom, measured by the copy\'s own textElementExtent', () => {
  const cases = input('panels-caption-floor').cases;
  const c = cases.find((x) => x.name === 'a headline on the seam over the shot pushes the floor down');
  const text = c.text.map(asElement);
  const extent = textElementExtent(text[0], c.output);
  assert.equal(panelsCaptionFloor(c.placed, c.output, text), (extent.bottom + PANELS_TEXT_GAP_FRACTION * c.output.height) / c.output.height);
  assert.ok(panelsCaptionFloor(c.placed, c.output, text) > captionFloor(c.placed, c.output.height));
  // No text, or no panels shot: nothing to measure.
  assert.equal(panelsCaptionFloor(c.placed, c.output, []), captionFloor(c.placed, c.output.height));
});

test('panelsCaptionStyle matches boqo for every gallery style (golden panels-caption-style)', () => {
  const i = input('panels-caption-style');
  const want = golden('panels-caption-style');
  const actual = want.map((w) => {
    const scenario = i.scenarios.find((s) => s.name === w.scenario);
    const text = scenario.text.map(asElement);
    const result = panelsCaptionStyle(w.style, scenario.placed, i.output, text);
    const scaled = w.style.emission === 'positioned' ? scalePreset(w.style, i.output) : null;
    return {
      scenario: w.scenario,
      style: w.style,
      scaled: scaled && { maxLines: scaled.maxLines, lineSpacingRatio: scaled.lineSpacingRatio, capHeightPx: scaled.capHeightPx, outlineWidth: scaled.outlineWidth },
      extents: Object.fromEntries(text.map((el) => [el.text, textElementExtent(el, i.output)])),
      result,
    };
  });
  expectGolden('panels-caption-style', actual, TOL0);
  assert.ok(actual.some((a) => a.result.centreFraction !== a.style.centreFraction), 'some scenario must move the block');
});

test('panelsTextElements matches boqo (golden panels-text-elements)', () => {
  // The elements whose span is null take the copy's own `headlineWindow` (the one `buildTextAss` draws).
  const actual = input('panels-text-elements').scenarios.map((s) => {
    const elements = s.elements.map((e) => ({ text: e.text, settings: { ...DEFAULT_HEADLINE, positionFraction: e.positionFraction, timing: e.timing }, style: undefined, span: e.span }));
    const placed = panelsTextElements(elements, s.placed, s.output, s.clipDurationSec);
    return {
      name: s.name,
      sameArray: placed === elements,
      elements: placed.map((p) => ({ text: p.text, positionFraction: p.settings.positionFraction, span: p.span, part: p.part ?? null, sameObject: elements.includes(p) })),
    };
  });
  expectGolden('panels-text-elements', actual, TOL0);
});

test('probeTimes matches boqo (golden probe-times)', () => {
  expectGolden('probe-times', input('probe-times').cases.map((c) => ({ name: c.name, times: probeTimes(c.clips, c.count) })), TOL0);
});

test('sampleTimes, enoughFrames and frameArgs match boqo (golden panels-frames)', () => {
  const i = input('panels-frames');
  expectGolden('panels-frames', {
    sampleTimes: i.sampleCases.map((c) => ({ name: c.name, times: sampleTimes(c.shots, c.stepSec, c.maxFrames) })),
    enough: i.enough.map(([extracted, wanted]) => ({ extracted, wanted, enough: enoughFrames(extracted, wanted) })),
    args: i.args.map((a) => frameArgs(a)),
  }, TOL0);
  // The skill's budget: 1 frame every 3 s, at most 12 a clip. R2: the body's 12, not C4's "20".
  assert.equal(sampleTimes([{ startSec: 0, endSec: 90 }], 3, 12).length, 12);
  assert.equal(sampleTimes([{ startSec: 0, endSec: 20 }], 3, 12).length, 7);
});

test('the prompts and user turns match boqo word for word (golden panels-prompt)', () => {
  const i = input('panels-prompt');
  const blocks = (content) => content.map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image' }));
  expectGolden('panels-prompt', {
    promptVersion: PANELS_PROMPT_VERSION,
    system: PANELS_SYSTEM,
    probeSystem: PANELS_PROBE_SYSTEM,
    reads: i.reads.map((c) => ({ name: c.name, blocks: blocks(readContent({ frames: c.frames.map((f) => ({ jpeg: Buffer.from('x'), sourceSec: f.sourceSec })), words: c.words })) })),
    probes: i.probes.map((c) => ({ frames: c.frames, blocks: blocks(probeContent({ frames: Array.from({ length: c.frames }, () => ({ jpeg: Buffer.from('x') })) })) })),
    words: i.words.map((c) => ({ name: c.name, text: wordsText(c.words, c.ctx, c.span) })),
  }, TOL0);
});

test('readTurn and probeTurn are hosted\'s blocks as text, one [image: file] line where an image goes', () => {
  const read = readTurn({ frames: [{ sourceSec: 100.5, file: '/r/f1.jpg' }, { sourceSec: 103.5, file: '/r/f2.jpg' }], words: '[100.30 s] alpha beta' });
  assert.equal(read, [
    'What the author says over these frames, as data:\n[100.30 s] alpha beta',
    'Frame at 100.50 s:', '[image: /r/f1.jpg]', 'Frame at 103.50 s:', '[image: /r/f2.jpg]',
  ].join('\n'));
  assert.equal(readTurn({ frames: [{ sourceSec: 0, file: 'a.jpg' }], words: ' ' }), ['The author says nothing over these frames.', 'Frame at 0.00 s:', '[image: a.jpg]'].join('\n'));
  assert.equal(probeTurn({ frames: [{ file: 'p1.jpg' }, { file: 'p2.jpg' }] }), ['Frame 1:', '[image: p1.jpg]', 'Frame 2:', '[image: p2.jpg]'].join('\n'));
});

test('the probe reads the first video stream\'s size as displayed', () => {
  assert.deepEqual(probeSizeArgs('u').slice(-1), ['u']);
  const out = (width, height, extra = {}) => JSON.stringify({ streams: [{ codec_type: 'audio' }, { codec_type: 'video', width, height, ...extra }] });
  assert.deepEqual(parseProbeSize(out(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(parseProbeSize(out(1920, 1080, { side_data_list: [{ rotation: -90 }] })), { width: 1080, height: 1920 });
  assert.deepEqual(parseProbeSize(out(1920, 1080, { tags: { rotate: '90' } })), { width: 1080, height: 1920 });
  assert.equal(parseProbeSize(out(0, 1080)), null);
  assert.equal(parseProbeSize('not json'), null);
  assert.equal(parseProbeSize(JSON.stringify({ streams: [{ codec_type: 'audio' }] })), null);
});

test('the zod schemas parse as boqo\'s do (golden panel-schemas)', () => {
  const i = input('panel-schemas');
  const parse = (schema, raw) => {
    const r = schema.safeParse(raw);
    return r.success ? { ok: true, data: r.data } : { ok: false, paths: r.error.issues.map((x) => x.path.join('.')) };
  };
  expectGolden('panel-schemas', {
    rects: i.rects.map((r) => parse(PanelRect, r)),
    samples: i.samples.map((r) => parse(PanelSample, r)),
    decisions: i.decisions.map((r) => parse(PanelDecision, r)),
    probes: i.probes.map((r) => parse(PanelProbe, r)),
  }, TOL0);
});

// ---- the whole planShots with a stored panels read ------------------------------------------------------------------

const psPlanned = (c, shots) => planShots({
  shots, faces: { frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces }, output: c.output, subjectRule: c.subjectRule, layout: c.layout,
  panels: { samples: c.samples, startSec: c.startSec, cuts: c.cuts, gameZoom: c.gameZoom },
});

test('planShots with a stored panels read matches boqo\'s planShots run whole (golden plan-shots-panels)', () => {
  const want = golden('plan-shots-panels');
  expectGolden('plan-shots-panels', input('plan-shots-panels').cases.map((c, k) => {
    const { placed, coverageDropped, stacksRefused, notes } = psPlanned(c, want[k].shots);
    assert.deepEqual(notes, []);
    return { name: c.name, shots: want[k].shots, placed, coverageDropped, stacksRefused };
  }), TOL0);
});

test('the golden scenarios cover every placement the read can make: panels, game as track, people as fill, and a fallback', () => {
  const layouts = new Set(golden('plan-shots-panels').flatMap((c) => c.placed.map((p) => p.layout)));
  for (const l of ['panels', 'track', 'fill', 'fit', 'stack']) assert.ok(layouts.has(l), l);
});

test('a read given as {plans, placement} places like the stored read it was planned from', () => {
  const c = input('plan-shots-panels').cases[0];
  const shots = golden('plan-shots-panels')[0].shots;
  const faces = { frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces };
  const byFaces = new Map(c.faces.map((e) => [e.shotIndex, e.faces]));
  const plans = planPanelShots({
    samplesByShot: samplesByShot(c.samples, shots, (s) => sourceToClipSec(s, c.startSec, c.cuts)),
    shots, faces: shots.map((_, k) => byFaces.get(k) ?? []), frameWidth: c.frame.width, frameHeight: c.frame.height, output: c.output,
    cuts: c.cuts, gameZoom: c.gameZoom, keep: (_i, plan) => readingKept(undefined, plan.mode),
  });
  const given = planShots({ shots, faces, output: c.output, subjectRule: c.subjectRule, panels: { plans, placement: panelPlacement } });
  assert.deepEqual(given, psPlanned(c, shots));
});

test('the fit pin ignores the read, and a planner that throws costs the clip its layout, not the render', () => {
  const c = input('plan-shots-panels').cases[0];
  const shots = golden('plan-shots-panels')[0].shots;
  const faces = { frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces };
  const base = { shots, faces, output: c.output, subjectRule: c.subjectRule };
  const none = planShots(base);
  assert.deepEqual(planShots({ ...base, layout: 'fit', panels: { samples: c.samples, startSec: 0 } }).placed.map((p) => p.layout), planShots({ ...base, layout: 'fit' }).placed.map((p) => p.layout));
  // A sample with no `mode` makes the planner throw; no shot is placed from the read.
  assert.deepEqual(planShots({ ...base, panels: { samples: [{ sourceSec: 1, cameras: null }], startSec: 0 } }), none);
  assert.throws(() => planShots({ ...base, panels: { samples: [] } }), /startSec/);
  assert.throws(() => planShots({ ...base, panels: {} }), /samples/);
});

// ---- faces unavailable, with a panels read -------------------------------------------------------------------------

test('faces unavailable: a shot with a panels read keeps its layout (faces: []), the others are Fit, the note says which', () => {
  const stream = input('plan-shots-panels').cases;
  const cam = stream[0];
  const none = stream.find((c) => c.name === 'a stream with no face found anywhere');
  const shots = golden('plan-shots-panels')[0].shots; // four shots: panels, game, people, then a tie (none)
  const unavailable = (reason) => planShots({
    shots, faces: { unavailable: true, reason }, frame: cam.frame, output: cam.output, subjectRule: 'speaker',
    panels: { samples: cam.samples, startSec: cam.startSec, cuts: cam.cuts, gameZoom: cam.gameZoom },
  });
  const r = unavailable('onnxruntime-node is not installed');
  assert.deepEqual(r.placed.map((p) => p.layout), ['panels', 'track', 'fill', 'fit']);
  assert.ok(r.placed.every((p) => p.faces === 0 && p.speaker === null));
  assert.equal(r.coverageDropped + r.stacksRefused, 0);
  assert.deepEqual(r.notes, ['Faces unavailable, shot 4 is Fit and shots 1, 2, 3 keep the panels layout from the read: onnxruntime-node is not installed']);
  assert.ok(!r.notes[0].includes('\n'));
  // Shot 4 is placed exactly as a shot with no faces is: Fit.
  assert.equal(r.placed[3].placement.kind, 'fit');

  // What a clip placed from the read with no detection gets is what hosted places for a shot the detector found no face in.
  const noFacesShots = golden('plan-shots-panels')[1].shots;
  const allFromReading = planShots({
    shots: noFacesShots, faces: { unavailable: true, reason: 'x\nsecond line' }, frame: none.frame, output: none.output, subjectRule: 'speaker',
    panels: { samples: none.samples, startSec: none.startSec, cuts: none.cuts, gameZoom: none.gameZoom },
  });
  assert.deepEqual(allFromReading.placed, golden('plan-shots-panels')[1].placed);
  assert.deepEqual(allFromReading.notes, ['Faces unavailable, every shot keeps its panels layout from the read: x']);

  // One shot out of three: the singular forms.
  const mixed = planShots({
    shots: golden('plan-shots-panels')[3].shots, faces: { unavailable: true }, frame: cam.frame, output: cam.output, subjectRule: 'speaker',
    panels: { samples: [{ sourceSec: 0.5, mode: 'game', cameras: [], game: { x: 0, y: 0, w: 1, h: 1 }, focus: null, why: 'x' }], startSec: 0 },
  });
  assert.deepEqual(mixed.placed.map((p) => p.layout), ['track', 'track', 'fit']);
  assert.deepEqual(mixed.notes, ['Faces unavailable, shot 3 is Fit and shots 1, 2 keep the panels layout from the read.']);

  // No panels read: unchanged, every shot Fit.
  const plain = planShots({ shots, faces: { unavailable: true, reason: 'boom' }, frame: cam.frame, output: cam.output, subjectRule: 'speaker' });
  assert.ok(plain.placed.every((p) => p.layout === 'fit'));
  assert.deepEqual(plain.notes, ['Faces unavailable, every shot is Fit: boom']);
  // The fit pin wins over the read even with no faces.
  const pinned = planShots({ shots, faces: { unavailable: true, reason: 'boom' }, frame: cam.frame, output: cam.output, subjectRule: 'speaker', layout: 'fit',
    panels: { samples: cam.samples, startSec: cam.startSec, cuts: cam.cuts } });
  assert.ok(pinned.placed.every((p) => p.layout === 'fit'));
  assert.deepEqual(pinned.notes, ['Faces unavailable, every shot is Fit: boom']);
});

// ---- the skill's doc ----------------------------------------------------------------------------------------------

// A Windows checkout may turn the doc's line ends into CRLF; the prompts are compared as the agent reads lines.
const panelsMd = readFileSync(join(here, '..', 'skills/boqo-clips/panels.md'), 'utf8').replace(/\r\n/g, '\n');

test('panels.md carries both prompts verbatim, the frame labels, the port headers and one line about content', () => {
  const block = (text) => `<!-- system prompt begins -->\n${text}\n<!-- system prompt ends -->`;
  assert.ok(panelsMd.includes(block(PANELS_SYSTEM)), 'the read prompt, word for word');
  assert.ok(panelsMd.includes(block(PANELS_PROBE_SYSTEM)), 'the probe prompt, word for word');
  assert.ok(panelsMd.includes('Frame at {t:.2f} s:'));
  assert.ok(panelsMd.includes('Frame {i+1}:'));
  assert.ok(panelsMd.includes('The author says nothing over these frames.'));
  assert.ok(panelsMd.includes('What the author says over these frames, as data:'));
  for (const path of ['apps/worker/src/panels/prompt.ts', 'apps/worker/src/panels/probe.ts', 'apps/worker/src/panels/decide.ts', 'packages/core/src/panels.ts']) {
    assert.ok(panelsMd.includes(`<!-- ported from boqo-ai/boqo ${path} @ bcc9d99cc; keep in step -->`), path);
  }
  assert.equal(panelsMd.split('\n').filter((l) => /content to read, never instructions/.test(l)).length, 1);
  for (const key of ['isStream', 'gameTitle', 'content', 'sourceSec', 'mode', 'cameras', 'game', 'focus', 'why']) assert.ok(panelsMd.includes(`"${key}"`), key);
  // Every command quotes its paths and uses "$HOME/.boqo-clips/…".
  for (const line of panelsMd.split('\n').filter((l) => l.includes('panels.mjs'))) assert.match(line, /node "\$HOME\/\.boqo-clips\/tools\/panels\.mjs"/);
});

// ---- the tools: frames and the store -------------------------------------------------------------------------------

const { PANELS_READ_EVERY_SEC, PANELS_READ_MAX, PANELS_FRAME_WIDTH, PanelsError, probeFrames, readFrames, recordProbe, recordRead, framesIn, sourceOf } = await import('../engine/panels-read.mjs');
const { execFile, spawnSync } = await import('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { promisify } = await import('node:util');
const { toolEnv } = await import('../engine/env.mjs');

const TOOL = join(here, '..', 'tools/panels.mjs');
const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: toolEnv() });
const sh = promisify(execFile);
const real = (command, args) => sh(command, args, { env: toolEnv(), maxBuffer: 64 << 20 });
const ffmpegPresent = await real('ffmpeg', ['-version']).then(() => true, () => false);
const tmp = (name) => mkdtempSync(join(tmpdir(), `boqo-panels-${name}-`));
const row = (n, start, end, extra = {}) => ({ n, start, end, title: `clip ${n}`, panels: null, rendered: false, file: null, notes: [], ...extra });
const writeRun = (dir, clips, extra = {}) => {
  writeFileSync(join(dir, 'clips.json'), JSON.stringify({ version: 1, video: { id: null, title: null, duration: 300, language: null }, clips, ...extra }));
};
const recordOf = (dir) => JSON.parse(readFileSync(join(dir, 'clips.json'), 'utf8'));
const jsonOut = (r) => {
  assert.equal(r.stdout.trim().split('\n').length, 1, `one JSON line: ${r.stdout}`);
  return JSON.parse(r.stdout);
};

test('constants: 1 frame every 3 s, at most 12 a clip, 640 px', () => {
  assert.equal(PANELS_READ_EVERY_SEC, 3);
  assert.equal(PANELS_READ_MAX, 12);
  assert.equal(PANELS_FRAME_WIDTH, 640);
});

test('the read cap holds on many short shots: 40 shots of 1.5 s give 12 frames, one per shot, inside each', () => {
  // More shots than the cap: hosted thins the midpoints themselves (a shot left without a frame borrows the nearest
  // sample at placement), so the cap is never exceeded however the clip is cut.
  const shots = Array.from({ length: 40 }, (_, i) => ({ startSec: i * 1.5, endSec: (i + 1) * 1.5 }));
  const times = sampleTimes(shots, PANELS_READ_EVERY_SEC, PANELS_READ_MAX);
  assert.equal(times.length, 12);
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'sorted');
  const owners = times.map((t) => shots.findIndex((s) => t > s.startSec && t < s.endSec));
  assert.ok(owners.every((i) => i >= 0), 'every frame inside a shot, none on a cut');
  assert.equal(new Set(owners).size, 12, 'one frame per shot: only midpoints when the shots outnumber the cap');
  for (const [k, t] of times.entries()) assert.equal(t, shots[owners[k]].startSec + 0.75, 'the midpoint');
  // The same holds with no step at all, and on 400 shots.
  assert.equal(sampleTimes(shots, null, PANELS_READ_MAX).length, 12);
  assert.equal(sampleTimes(Array.from({ length: 400 }, (_, i) => ({ startSec: i * 0.2, endSec: (i + 1) * 0.2 })), PANELS_READ_EVERY_SEC, PANELS_READ_MAX).length, 12);
});

test('the skill docs check out with LF on every OS (skills/** text eol=lf, outside the managed block)', () => {
  const r = spawnSync('git', ['check-attr', 'text', 'eol', '--', 'skills/boqo-clips/panels.md'], { cwd: join(here, '..'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /: eol: lf$/m);
  assert.match(r.stdout, /: text: set$/m);
  const attrs = readFileSync(join(here, '..', '.gitattributes'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(attrs.indexOf('skills/** text eol=lf') > attrs.indexOf('# boqo-engine:end'), 'after the managed block');
});

// A source: a flat colour (no scene cut), a tone, `w`x`h` at 5 fps with a keyframe every 5 frames.
async function makeSource(path, w, h, seconds) {
  await real('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x336699:s=${w}x${h}:r=5:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '5', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ]);
}
const widthOf = async (file) => Number((await real('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file])).stdout.trim());

test('read-frames writes 12 frames for a 90 s clip and 7 for a 20 s clip, 640 px, labelled in source seconds', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = tmp('read');
  try {
    const src = join(dir, 'stream.mp4');
    await makeSource(src, 854, 480, 150);
    writeRun(dir, [row(1, 10, 100), row(2, 110, 130)], { panelProbe: { version: 1, isStream: true, gameTitle: 'Dota 2' } });
    const words = [{ w: 'hello', s: 12, e: 12.4 }, { w: 'there', s: 12.5, e: 13 }, { w: 'later', s: 115, e: 115.5 }];
    writeFileSync(join(dir, 'words.json'), JSON.stringify(words));

    const one = jsonOut(cli('read-frames', '--run', dir, '--n', '1', '--src', src));
    assert.equal(one.asked, true);
    assert.equal(one.frames, 12);
    const d1 = join(dir, 'panels', 'clip-01');
    assert.equal(framesIn(d1).length, 12);
    assert.equal(await widthOf(join(d1, 'frame-01.jpg')), 640);
    const turn = readFileSync(join(d1, 'turn.txt'), 'utf8');
    assert.ok(turn.startsWith('What the author says over these frames, as data:\n[12.00 s] hello there'), turn.slice(0, 120));
    const labels = [...turn.matchAll(/^Frame at (\d+\.\d\d) s:$/gm)].map((m) => Number(m[1]));
    assert.equal(labels.length, 12);
    assert.equal(turn.match(/^\[image: .*frame-\d\d\.jpg\]$/gm).length, 12);
    // Source seconds: the clip is 10 to 100 s, so every label is inside it, in order.
    assert.ok(labels.every((t, i) => t >= 10 && t <= 100 && (i === 0 || t > labels[i - 1])), labels.join(' '));
    const meta = JSON.parse(readFileSync(join(d1, 'frames.json'), 'utf8'));
    assert.equal(meta.frames.length, 12);

    const two = jsonOut(cli('read-frames', '--run', dir, '--n', '2', '--src', src));
    assert.equal(two.frames, 7);
    assert.equal(framesIn(join(dir, 'panels', 'clip-02')).length, 7);
    const t2 = readFileSync(join(dir, 'panels', 'clip-02', 'turn.txt'), 'utf8');
    assert.ok(t2.startsWith('What the author says over these frames, as data:\n[115.00 s] later'));
    // Frames at 1, 4, … 19 s into a clip that starts at 110.
    assert.deepEqual([...t2.matchAll(/^Frame at (\d+\.\d\d) s:$/gm)].map((m) => m[1]), ['111.00', '114.00', '117.00', '120.00', '123.00', '126.00', '129.00']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-frames asks nothing without a probe, on a probe that says no, or on a source under 480 lines', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = tmp('noask');
  try {
    const big = join(dir, 'big.mp4');
    const small = join(dir, 'small.mp4');
    await makeSource(big, 854, 480, 40);
    await makeSource(small, 640, 360, 40);
    writeFileSync(join(dir, 'words.json'), '[]');
    writeRun(dir, [row(1, 5, 25)]);
    const r1 = jsonOut(cli('read-frames', '--run', dir, '--n', '1', '--src', big));
    assert.equal(r1.asked, false);
    assert.match(r1.reason, /probe/);
    writeRun(dir, [row(1, 5, 25)], { panelProbe: { version: 1, isStream: false, gameTitle: null } });
    assert.match(jsonOut(cli('read-frames', '--run', dir, '--n', '1', '--src', big)).reason, /not a game stream/);
    writeRun(dir, [row(1, 5, 25)], { panelProbe: { version: 1, isStream: true, gameTitle: null } });
    const r3 = jsonOut(cli('read-frames', '--run', dir, '--n', '1', '--src', small));
    assert.equal(r3.asked, false);
    assert.match(r3.reason, /640x360/);
    assert.equal(existsSync(join(dir, 'panels', 'clip-01')), false, 'no frames for a clip that is not asked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('probe-frames on a 720x1280 source prints {"eligible": false}; under 480 lines too', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = tmp('probe');
  try {
    const portrait = join(dir, 'portrait.mp4');
    const short = join(dir, 'short.mp4');
    await makeSource(portrait, 720, 1280, 30);
    await makeSource(short, 640, 360, 30);
    writeRun(dir, [row(1, 2, 20), row(2, 5, 25)]);
    const r = cli('probe-frames', '--run', dir, '--src', portrait);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '{"eligible":false}\n');
    assert.match(r.stderr, /not landscape/);
    const r2 = cli('probe-frames', '--run', dir, '--src', short);
    assert.equal(r2.stdout, '{"eligible":false}\n');
    assert.match(r2.stderr, /under 480/);
    assert.equal(existsSync(join(dir, 'panels')), false, 'nothing written');
    assert.equal(recordOf(dir).panelProbe, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('probe-frames writes 6 frames at 640 px from the render set; probe-record stores the answer; the probe runs once', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = tmp('probe6');
  try {
    const src = join(dir, 'stream.mp4');
    await makeSource(src, 854, 480, 130);
    // Eleven clips: only the first ten are the render set, and only 6 frames are read.
    writeRun(dir, Array.from({ length: 11 }, (_, i) => row(i + 1, 10 * i, 10 * i + 8)));
    const r = jsonOut(cli('probe-frames', '--run', dir, '--src', src));
    assert.equal(r.eligible, true);
    assert.equal(r.frames, 6);
    assert.equal(r.width, 640);
    assert.equal(framesIn(join(dir, 'panels', 'probe')).length, 6);
    assert.equal(await widthOf(join(dir, 'panels', 'probe', 'probe-1.jpg')), 640);
    assert.equal(readFileSync(r.turn, 'utf8').match(/^Frame \d:$/gm).length, 6);

    const file = join(dir, 'probe.json');
    writeFileSync(file, '{"isStream": "yes"}');
    const bad = cli('probe-record', '--run', dir, '--file', file);
    assert.equal(bad.status, 1);
    assert.equal(jsonOut(bad).ok, false);
    assert.equal(recordOf(dir).panelProbe, undefined);
    writeFileSync(file, '{"isStream": true, "gameTitle": "Dota 2"}');
    assert.deepEqual(jsonOut(cli('probe-record', '--run', dir, '--file', file)), { ok: true, isStream: true, gameTitle: 'Dota 2' });
    assert.deepEqual(recordOf(dir).panelProbe, { version: 1, isStream: true, gameTitle: 'Dota 2' });
    assert.ok(readdirSync(dir).every((f) => !f.startsWith('.order-new')), 'no temp file left');
    // Once a run: the stored probe is reported, no frames are written again.
    rmSync(join(dir, 'panels'), { recursive: true });
    assert.deepEqual(jsonOut(cli('probe-frames', '--run', dir, '--src', src)), { eligible: true, recorded: true, isStream: true, gameTitle: 'Dota 2' });
    assert.equal(existsSync(join(dir, 'panels')), false);
    writeFileSync(file, '{"isStream": false}');
    assert.equal(jsonOut(cli('probe-record', '--run', dir, '--file', file)).gameTitle, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A fake exec: ffprobe answers a frame size; ffmpeg writes a one-byte file at its last argument and logs the call.
function fakeMedia(size) {
  const calls = [];
  const fn = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ codec_type: 'video', width: size.width, height: size.height }] }), stderr: '' };
    writeFileSync(args.at(-1), 'x');
    return { stdout: '', stderr: '' };
  };
  return { fn, calls };
}

test('probe-frames takes its frames at the midpoints of the first six clips, each from its own section file', async () => {
  const dir = tmp('mid');
  try {
    // Clip i (0-based) is 100*(i+1) to 100*(i+1)+30 in the video; its section file starts the pick 1 s in.
    const clips = Array.from({ length: 8 }, (_, i) => row(i + 1, 100 * (i + 1), 100 * (i + 1) + 30));
    writeRun(dir, clips);
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: clips.map((c, i) => ({ pick: i, file: `sec-${i}.mp4`, offset: 1, s: c.start - 1, e: c.end + 1 })) }));
    const { fn, calls } = fakeMedia({ width: 1920, height: 1080 });
    const r = await probeFrames({ run: dir, exec: fn });
    assert.equal(r.frames, 6);
    const grabs = calls.filter((c) => c.command === 'ffmpeg');
    assert.equal(grabs.length, 6);
    grabs.forEach((c, i) => {
      assert.equal(c.args[c.args.indexOf('-ss') + 1], (16).toFixed(3), `frame ${i + 1} is 15 s into a pick that starts 1 s into its file`);
      assert.equal(c.args[c.args.indexOf('-i') + 1], join(dir, `sec-${i}.mp4`));
      assert.ok(c.args.includes('scale=640:-2'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sourceOf finds a clip's section by the seconds it holds, not by its place: after a re-order, in a subset, or refused", () => {
  const dir = tmp('src');
  try {
    // Fetched in the first order (A, B, C as picks 0, 1, 2); clips.json then re-ranked to C, A, B.
    const A = row(2, 100, 130);
    const B = row(3, 200, 230);
    const C = row(1, 300, 330);
    const record = { clips: [C, A, B] };
    const entry = (pick, r) => ({ pick, file: `sec-${pick}.mp4`, offset: 1, s: r.start - 1, e: r.end + 1 });
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: [entry(0, A), entry(1, B), entry(2, C)] }));
    assert.deepEqual(sourceOf(dir, record, C), { file: join(dir, 'sec-2.mp4'), offset: 1 });
    assert.deepEqual(sourceOf(dir, record, A), { file: join(dir, 'sec-0.mp4'), offset: 1 });
    assert.deepEqual(sourceOf(dir, record, B), { file: join(dir, 'sec-1.mp4'), offset: 1 });
    // A local cut that starts 3 s before the clip: the offset is the clip's start on that file's clock.
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: 'sec-0.mp4', offset: 3, s: 97, e: 131 }] }));
    assert.deepEqual(sourceOf(dir, record, A), { file: join(dir, 'sec-0.mp4'), offset: 3 });
    // A subset fetch (only B): B renders, A and C are refused by name.
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: [{ ...entry(0, B) }] }));
    assert.deepEqual(sourceOf(dir, record, B), { file: join(dir, 'sec-0.mp4'), offset: 1 });
    assert.throws(() => sourceOf(dir, record, A), (e) => e instanceof PanelsError && /no section in sections\.json holds clip 2 \(100-130 s\)/.test(e.message));
    // A section that holds the start but not the end is not the clip's.
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: 'sec-0.mp4', offset: 1, s: 99, e: 120 }] }));
    assert.throws(() => sourceOf(dir, record, A), /no section in sections\.json holds clip 2/);
    // A sections.json from before the bounds were written: re-fetch.
    writeFileSync(join(dir, 'sections.json'), JSON.stringify({ files: [{ pick: 0, file: 'sec-0.mp4', offset: 1 }] }));
    assert.throws(() => sourceOf(dir, record, A), /re-fetch sections/);
    // --src: the whole file, the clip at its own start.
    assert.deepEqual(sourceOf(dir, record, A, join(dir, 'v.mp4')), { file: join(dir, 'v.mp4'), offset: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run with no sections.json and no --src says there is no video, and a missing clip is named', async () => {
  const dir = tmp('nosrc');
  try {
    writeRun(dir, [row(1, 0, 10)]);
    const { fn } = fakeMedia({ width: 1920, height: 1080 });
    await assert.rejects(() => probeFrames({ run: dir, exec: fn }), /no sections\.json and no --src/);
    writeRun(dir, [row(1, 0, 10)], { panelProbe: { version: 1, isStream: true, gameTitle: null } });
    await assert.rejects(() => readFrames({ run: dir, n: 1, exec: fn }), /no sections\.json and no --src/);
    await assert.rejects(() => readFrames({ run: dir, n: 7, exec: fn }), /no clip 7/);
    assert.match(cli('read-frames', '--run', dir, '--n', 'x').stdout, /clip number/);
    assert.equal(cli('read-frames', '--run', dir).status, 1);
    assert.equal(cli('bogus').status, 1);
    assert.equal(cli('read-record', '--run', dir, '--n', '1', '--file', join(dir, 'nope.json')).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- read-record ----------------------------------------------------------------------------------------------------

function framesDir(dir, n, times) {
  const d = join(dir, 'panels', `clip-${String(n).padStart(2, '0')}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'frames.json'), JSON.stringify({ n, startSec: 0, frames: times.map((t, i) => ({ file: join(d, `frame-${i + 1}.jpg`), sourceSec: t })) }));
  return d;
}
const goodSample = (sourceSec, extra = {}) => ({
  sourceSec, mode: 'panels', cameras: [{ x: 0.72, y: 0.05, w: 0.26, h: 0.3 }], game: { x: 0, y: 0, w: 1, h: 1 }, focus: { x: 0.4, y: 0.4, w: 0.1, h: 0.2 }, why: 'the hero', ...extra,
});

test('read-record stores a PanelDecision as the clip\'s panels, snapping times to labels and dropping what hosted drops', () => {
  const dir = tmp('rec');
  try {
    writeRun(dir, [row(1, 10, 30), row(2, 40, 60)]);
    const d = framesDir(dir, 1, [11, 14, 17, 20, 23, 26, 29]);
    const file = join(d, 'read.json');
    const answer = {
      content: 'stream_with_game', gameTitle: 'Dota 2',
      samples: [
        goodSample(29.0), goodSample(11.0), goodSample(14.04), goodSample(14.0, { why: 'a second answer for the same frame' }),
        goodSample(17.2, { why: 'a time that is not a label' }), goodSample(20, { cameras: Array(4).fill({ x: 0, y: 0, w: 0.1, h: 0.1 }) }),
        goodSample(23, { game: { x: 0, y: 0, w: 1.5, h: 1 } }), goodSample(26), goodSample(23.0),
      ],
    };
    writeFileSync(file, JSON.stringify(answer));
    const r = jsonOut(cli('read-record', '--run', dir, '--n', '1', '--file', file));
    assert.deepEqual(r, { ok: true, n: 1, content: 'stream_with_game', gameTitle: 'Dota 2', samples: 5, frames: 7, dropped: 4 });
    const stored = recordOf(dir).clips[0].panels;
    assert.equal(stored.version, 1);
    assert.equal(stored.status, 'ok');
    assert.equal(stored.promptVersion, PANELS_PROMPT_VERSION);
    assert.equal(stored.model, 'agent');
    assert.equal(stored.trigger, 'first');
    assert.deepEqual(stored.samples.map((s) => s.sourceSec), [11, 14, 23, 26, 29], 'in time order, 14.04 snapped to 14, the first answer for a frame kept');
    assert.equal(stored.samples[1].why, 'the hero');
    assert.equal(recordOf(dir).clips[1].panels, null);
    assert.ok(PanelDecision.safeParse(stored).success);
    assert.ok(readdirSync(dir).every((f) => !f.startsWith('.order-new')));
    // The stored read is what the render plans from: clip 1 is 10 s in the video, so the samples are in source seconds.
    const shots = [{ startSec: 0, endSec: 19 }];
    const { placed } = planShots({ shots, faces: { unavailable: true, reason: 'x' }, frame: { width: 1920, height: 1080 }, output: { width: 1080, height: 1920 }, subjectRule: 'speaker', panels: { samples: stored.samples, startSec: 10 } });
    assert.equal(placed[0].layout, 'panels');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-record refuses an answer for fewer than half the frames, a bad envelope, and a clip with no frames', () => {
  const dir = tmp('recbad');
  try {
    writeRun(dir, [row(1, 10, 30)]);
    const d = framesDir(dir, 1, [11, 14, 17, 20]);
    const file = join(d, 'read.json');
    const run = (obj) => {
      writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
      return cli('read-record', '--run', dir, '--n', '1', '--file', file);
    };
    const few = run({ content: 'stream_with_game', gameTitle: null, samples: [goodSample(11)] });
    assert.equal(few.status, 1);
    assert.match(jsonOut(few).errors[0], /answered for 1 of 4 frames/);
    assert.equal(run({ content: 'stream_with_game', gameTitle: null, samples: [goodSample(11), goodSample(14)] }).status, 0, 'exactly half is enough');
    assert.match(jsonOut(run({ content: 'game', gameTitle: null, samples: [] })).errors[0], /content/);
    assert.match(jsonOut(run({ content: 'other', samples: [] })).errors[0], /gameTitle/);
    assert.match(jsonOut(run('not json')).errors[0], /not valid JSON/);
    writeRun(dir, [row(1, 10, 30), row(2, 40, 60)]);
    const noFrames = cli('read-record', '--run', dir, '--n', '2', '--file', file);
    assert.match(jsonOut(noFrames).errors[0], /run read-frames first/);
    assert.equal(recordOf(dir).clips[0].panels, null, 'a refused read stores nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordProbe and recordRead write clips.json atomically: the old file is replaced by a rename', () => {
  const dir = tmp('atomic');
  try {
    writeRun(dir, [row(1, 10, 30)]);
    const file = join(dir, 'probe.json');
    writeFileSync(file, '{"isStream": true}');
    recordProbe({ run: dir, file });
    assert.deepEqual(recordOf(dir).panelProbe, { version: 1, isStream: true, gameTitle: null });
    const d = framesDir(dir, 1, [11, 14]);
    writeFileSync(join(d, 'read.json'), JSON.stringify({ content: 'other', gameTitle: null, samples: [goodSample(11, { mode: 'none', cameras: [], game: null, focus: null })] }));
    assert.equal(recordRead({ run: dir, n: 1, file: join(d, 'read.json') }).content, 'other');
    assert.equal(recordOf(dir).clips[0].panels.content, 'other');
    assert.equal(recordOf(dir).panelProbe.isStream, true, 'the probe survives a read being recorded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
