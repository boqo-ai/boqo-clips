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
  CAPTION_POSITION_MAX, HEADLINE_POSITION_MAX, HEADLINE_POSITION_MIN, MIN_PART_SEC, PANELS_TEXT_GAP_FRACTION, captionFloor, panelsCaptionFloor,
  panelsCaptionStyle, panelsTextElements, panelsTextPosition, panelsTextRuns,
} from '../engine/boqo/panels-text.mjs';
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

// The golden prints each text element's extent (boqo's own `textElementExtent`, keyed by the element's text): the copy
// takes that function as a parameter, and the test hands it those numbers.
const asElement = (t) => ({ text: t.text, settings: { positionFraction: t.positionFraction }, style: undefined, span: t.span });

test('captionFloor and panelsCaptionFloor match boqo (golden panels-caption-floor)', () => {
  const want = golden('panels-caption-floor');
  const actual = input('panels-caption-floor').cases.map((c, k) => {
    const extents = want[k].extents;
    const text = c.text.map(asElement);
    return { name: c.name, seam: captionFloor(c.placed, c.output.height), floor: panelsCaptionFloor(c.placed, c.output, text, (el) => extents[el.text]), extents };
  });
  expectGolden('panels-caption-floor', actual, TOL0);
  assert.equal(PANELS_TEXT_GAP_FRACTION, 0.01);
});

test('a text element on a seam needs the extent function: no silent skip', () => {
  const c = input('panels-caption-floor').cases.find((x) => x.text.length > 0);
  assert.throws(() => panelsCaptionFloor(c.placed, c.output, c.text.map(asElement)), /textElementExtent/);
  // No text, or no panels shot: nothing to measure, so no parameter is needed.
  assert.equal(panelsCaptionFloor(c.placed, c.output, []), captionFloor(c.placed, c.output.height));
});

test('panelsCaptionStyle matches boqo for every gallery style (golden panels-caption-style)', () => {
  const i = input('panels-caption-style');
  const want = golden('panels-caption-style');
  const actual = want.map((w) => {
    const scenario = i.scenarios.find((s) => s.name === w.scenario);
    const text = scenario.text.map(asElement);
    const result = panelsCaptionStyle(w.style, scenario.placed, i.output, text, { scalePreset: () => w.scaled, textElementExtent: (el) => w.extents[el.text] });
    return { scenario: w.scenario, style: w.style, scaled: w.scaled, extents: w.extents, result };
  });
  expectGolden('panels-caption-style', actual, TOL0);
  assert.ok(actual.some((a) => a.result.centreFraction !== a.style.centreFraction), 'some scenario must move the block');
});

test('panelsTextElements matches boqo (golden panels-text-elements)', () => {
  // core's headlineWindow at the pin (packages/core/src/headline.ts:399), the function A13 ports; the golden holds this
  // stand-in to hosted's own through the elements whose span is null.
  const headlineWindow = (headline, clipDurationSec) => {
    if (headline.timing.kind === 'whole') return { startSec: 0, endSec: clipDurationSec };
    const startSec = Math.min(headline.timing.startSec, clipDurationSec);
    return { startSec, endSec: Math.min(startSec + headline.timing.holdSec, clipDurationSec) };
  };
  const actual = input('panels-text-elements').scenarios.map((s) => {
    const elements = s.elements.map((e) => ({ text: e.text, settings: { positionFraction: e.positionFraction, timing: e.timing }, style: undefined, span: e.span }));
    const placed = panelsTextElements(elements, s.placed, s.output, s.clipDurationSec, headlineWindow);
    return {
      name: s.name,
      sameArray: placed === elements,
      elements: placed.map((p) => ({ text: p.text, positionFraction: p.settings.positionFraction, span: p.span, part: p.part ?? null, sameObject: elements.includes(p) })),
    };
  });
  expectGolden('panels-text-elements', actual, TOL0);
  const noSpan = input('panels-text-elements').scenarios[1];
  assert.throws(() => panelsTextElements(noSpan.elements.map((e) => ({ ...e, settings: { positionFraction: e.positionFraction, timing: e.timing } })), noSpan.placed, noSpan.output, 12), /headlineWindow/);
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
