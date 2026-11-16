import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EYE_LINE_TARGET, FACE_HEIGHT_TARGET, LOOKING_ROOM, MAX_UPSCALE, MOTION_FLOOR, TRACK_DEADZONE, TRACK_MAX_PAN,
  baseWindowWidth, chooseSpeaker, countedFaces, cropPosition, cropSize, cropWindow, evenDown, panelSize, planCrop,
  planLayout, stackAllowed, targetRatio,
} from '../engine/boqo/crop.mjs';
import { compressPath, pathExpression, smoothPath } from '../engine/boqo/track.mjs';
import { resolveSubjectRule } from '../engine/boqo/subject-rule.mjs';
import { MIN_STACK_COPRESENCE, MIN_SUBJECT_COVERAGE, TRACK_ENABLED, layoutNameFor, planShots } from '../engine/boqo/plan-shots.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));
const golden = (name) => JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), 'utf8'));
const OUTPUT = { width: 1080, height: 1920 };

test('the framing tunables are production\'s code defaults', () => {
  assert.deepEqual(
    { MAX_UPSCALE, EYE_LINE_TARGET, FACE_HEIGHT_TARGET, LOOKING_ROOM, MOTION_FLOOR, TRACK_DEADZONE, TRACK_MAX_PAN, TRACK_ENABLED, MIN_SUBJECT_COVERAGE, MIN_STACK_COPRESENCE },
    { MAX_UPSCALE: 2.5, EYE_LINE_TARGET: 0.33, FACE_HEIGHT_TARGET: 0.3, LOOKING_ROOM: 0.15, MOTION_FLOOR: 1.5e-6, TRACK_DEADZONE: 0.2, TRACK_MAX_PAN: 200, TRACK_ENABLED: true, MIN_SUBJECT_COVERAGE: 0.2, MIN_STACK_COPRESENCE: 0.5 },
  );
});

test('chooseSpeaker matches boqo: mouth motion, then size, and the presence pool', () => {
  expectGolden('choose-speaker', input('choose-speaker').cases.map((c) => chooseSpeaker(c.faces, c.motionFloor, c.rule)), { tol: 0 });
});

test('cropSize matches boqo, with evenDown, targetRatio, panelSize and baseWindowWidth', () => {
  const i = input('crop-size');
  expectGolden('crop-size', {
    sizes: i.sizes.map((c) => cropSize(c)),
    evenDown: i.evenDown.map((v) => evenDown(v)),
    targetRatio: i.outputs.map((o) => targetRatio(o)),
    panelSize: i.outputs.map((o) => panelSize(o)),
    baseWindowWidth: i.baseWindowWidth.map((c) => baseWindowWidth(c.frameWidth, c.frameHeight, c.output)),
  }, { tol: 0 });
});

test('cropPosition and cropWindow match boqo: looking room, the head-box clamp, the eye line', () => {
  const i = input('crop-position');
  expectGolden('crop-position', { positions: i.positions.map((c) => cropPosition(c)), windows: i.windows.map((c) => cropWindow(c)) }, { tol: 0 });
});

test('planCrop matches boqo: Fill, Track, a static path that stays a rect, no subject', () => {
  expectGolden('plan-crop', input('plan-crop').cases.map((c) => ({ name: c.name, ...planCrop(c.input) })), { tol: 0 });
});

test('planLayout matches boqo: Fit with no faces, Stack, a refused stack, Fill, the overrides and the fit pin', () => {
  expectGolden('plan-layout', input('plan-layout').cases.map((c) => ({
    name: c.name,
    layout: planLayout(c.input),
    stackAllowed: stackAllowed({ faces: c.input.faces, minCoverage: c.input.minCoverage, minCopresence: c.input.minCopresence }),
    countedFaces: countedFaces(c.input.faces, c.input.minCoverage),
  })), { tol: 0 });
});

test('smoothPath matches boqo', () => {
  expectGolden('smooth-path', input('smooth-path').cases.map((c) => smoothPath(c.samples, c.options)), { tol: 0 });
});

test('compressPath matches boqo', () => {
  expectGolden('compress-path', input('compress-path').cases.map((c) => (c.quantum === undefined ? compressPath(c.points) : compressPath(c.points, c.quantum))), { tol: 0 });
});

test('pathExpression matches boqo', () => {
  expectGolden('path-expression', input('path-expression').cases.map((c) => pathExpression(c.points)), { tol: 0 });
});

test('resolveSubjectRule matches boqo: presence for a stream moment\'s clip, speaker otherwise', () => {
  expectGolden('resolve-subject-rule', input('resolve-subject-rule').cases.map((c) => ({ fromStreamMoment: c.fromStreamMoment, rule: resolveSubjectRule(c) })), { tol: 0 });
});

const planned = (c) => planShots({ shots: c.shots, faces: c.faces, frame: c.frame, output: c.output, subjectRule: c.subjectRule, layout: c.layout });

test('planShots matches boqo\'s planShots run whole: track, stack, fit, a missing entry, a bystander, presence, the fit pin', () => {
  expectGolden('plan-shots', input('plan-shots').cases.map((c) => {
    const { placed, coverageDropped, stacksRefused } = planned(c);
    return { name: c.name, placed, coverageDropped, stacksRefused };
  }), { tol: 0 });
});

const scenario = (name) => input('plan-shots').cases.find((c) => c.name === name);

test('a 1080x1920 source: boqo fills a shot with a face (zoomed, or the whole frame for a big face) and fits one without', () => {
  const c = scenario('portrait 1080x1920');
  const { placed, notes } = planned(c);
  assert.deepEqual(placed.map((p) => p.layout), ['fill', 'fill', 'fit']);
  assert.deepEqual(placed.map((p) => p.layout), golden('plan-shots').find((g) => g.name === c.name).placed.map((p) => p.layout));
  // A face 0.1 of the frame tall zooms to the upscale ceiling (1080/2.5 = 432 wide); one 0.35 tall takes the frame.
  assert.deepEqual(placed[0].placement.rect, { width: 432, height: 768, x: 324, y: 207 });
  assert.deepEqual(placed[1].placement.rect, { width: 1080, height: 1920, x: 0, y: 0 });
  assert.deepEqual(notes, []);
});

test('a source narrower than 9:16 (720x1440): Fit with no face; with a face boqo still fills', () => {
  const c = scenario('narrow 720x1440');
  const shots = c.shots;
  const none = planShots({ shots, faces: shots.map((_, i) => ({ shotIndex: i, faces: [] })), frame: c.frame, output: OUTPUT, subjectRule: 'speaker' });
  assert.deepEqual(none.placed.map((p) => p.layout), ['fit', 'fit']);
  const withFace = planned(c);
  assert.deepEqual(withFace.placed.map((p) => p.layout), ['fill', 'fit']);
  assert.deepEqual(withFace.placed.map((p) => p.layout), golden('plan-shots').find((g) => g.name === c.name).placed.map((p) => p.layout));
});

test('faces unavailable and no panels reading: every shot Fit and one note line', () => {
  const c = scenario('podcast 1920x1080');
  for (const reason of ['onnxruntime-node is not installed', 'the face detector failed: boom\n    at stack', '', undefined]) {
    const { placed, notes, coverageDropped, stacksRefused } = planShots({
      shots: c.shots, faces: { unavailable: true, reason }, frame: c.frame, output: OUTPUT, subjectRule: 'speaker',
    });
    assert.equal(placed.length, c.shots.length);
    assert.ok(placed.every((p) => p.layout === 'fit' && p.placement.kind === 'fit' && p.speaker === null && p.faces === 0));
    assert.equal(notes.length, 1);
    assert.equal(typeof notes[0], 'string');
    assert.ok(!notes[0].includes('\n'), notes[0]);
    assert.match(notes[0], /^Faces unavailable, every shot is Fit/);
    assert.equal(coverageDropped + stacksRefused, 0);
  }
  const named = planShots({ shots: c.shots, faces: { unavailable: true, reason: 'onnxruntime-node is not installed' }, frame: c.frame, output: OUTPUT, subjectRule: 'speaker' });
  assert.deepEqual(named.notes, ['Faces unavailable, every shot is Fit: onnxruntime-node is not installed']);
  const bare = planShots({ shots: c.shots, faces: { unavailable: true }, frame: c.frame, output: OUTPUT, subjectRule: 'speaker' });
  assert.deepEqual(bare.notes, ['Faces unavailable, every shot is Fit.']);
});

test('the frame defaults to the detection\'s own and must agree with it when both are given', () => {
  const c = scenario('podcast 1920x1080');
  const detection = { frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces };
  const given = planShots({ shots: c.shots, faces: detection, frame: c.frame, output: c.output, subjectRule: c.subjectRule });
  const defaulted = planShots({ shots: c.shots, faces: detection, output: c.output, subjectRule: c.subjectRule });
  assert.deepEqual(defaulted, given);
  assert.throws(() => planShots({ shots: c.shots, faces: detection, frame: { width: 1280, height: 720 }, output: c.output, subjectRule: c.subjectRule }), /not the detector's 1920x1080/);
  // No frame anywhere: the array form and `unavailable` carry none.
  assert.throws(() => planShots({ shots: c.shots, faces: c.faces, output: c.output, subjectRule: c.subjectRule }), /frame is required/);
  assert.throws(() => planShots({ shots: c.shots, faces: { unavailable: true, reason: 'x' }, output: c.output, subjectRule: c.subjectRule }), /frame is required/);
  assert.equal(planShots({ shots: c.shots, faces: c.faces, frame: c.frame, output: c.output, subjectRule: c.subjectRule }).placed.length, c.shots.length);
});

test('faces available: no note; the detection object and its shots array place the same', () => {
  const c = scenario('podcast 1920x1080');
  const fromArray = planned(c);
  const fromObject = planShots({ ...c, faces: { frameWidth: 1920, frameHeight: 1080, shots: c.faces } });
  assert.deepEqual(fromArray.notes, []);
  assert.deepEqual(fromObject, fromArray);
});

test('the path resets at every scene cut: each tracked shot starts from its own seed, on its own clock', () => {
  const c = scenario('podcast 1920x1080');
  const { placed } = planned(c);
  const [a, b] = placed;
  assert.equal(a.layout, 'track');
  assert.equal(b.layout, 'track');
  for (const p of [a, b]) {
    const dur = p.shot.endSec - p.shot.startSec;
    for (const point of [...p.placement.path.x, ...p.placement.path.y]) assert.ok(point.t >= 0 && point.t <= dur, `${point.t} outside 0..${dur}`);
  }
  // Shot 0 walks right and ends far right; shot 1 starts at its own subject, right of frame, and walks left.
  assert.ok(a.placement.path.x.at(-1).v > a.placement.path.x[0].v);
  assert.ok(b.placement.path.x.at(-1).v < b.placement.path.x[0].v);
  assert.notEqual(b.placement.path.x[0].v, a.placement.path.x.at(-1).v);
});

test('the shot plan names each placement: crop is fill', () => {
  assert.deepEqual(['crop', 'track', 'fit', 'stack', 'panels'].map(layoutNameFor), ['fill', 'track', 'fit', 'stack', 'panels']);
});

test('panels: a reading replaces a shot\'s placement unless it is none, and the fit pin ignores it', () => {
  const c = scenario('podcast 1920x1080');
  const base = planned(c);
  const game = { size: { width: 608, height: 1080 }, x: [{ t: 0, v: 10 }], y: [{ t: 0, v: 0 }] };
  const plans = c.shots.map((_, i) => (i === 2 ? { mode: 'game', game } : i === 5 ? { mode: 'broken' } : { mode: 'none' }));
  const calls = [];
  const placement = (plan, faces, w, h) => {
    calls.push([plan.mode, faces.length, w, h]);
    if (plan.mode === 'broken') throw new Error('bad geometry');
    return plan.mode === 'game' ? { placement: { kind: 'track', path: plan.game }, speaker: null } : null;
  };
  const withPanels = planShots({ ...c, panels: { plans, placement } });
  assert.deepEqual(withPanels.placed.map((p) => p.layout), ['track', 'track', 'track', 'fit', 'fit', 'fill']);
  assert.deepEqual(withPanels.placed[2].placement, { kind: 'track', path: game });
  assert.equal(withPanels.placed[2].speaker, null);
  assert.equal(withPanels.placed[2].faces, base.placed[2].faces);
  for (const i of [0, 1, 3, 4, 5]) assert.deepEqual(withPanels.placed[i], base.placed[i]);
  assert.equal(withPanels.stacksRefused, base.stacksRefused);
  assert.equal(withPanels.coverageDropped, base.coverageDropped);
  assert.deepEqual(calls.map((x) => x[0]), ['none', 'none', 'game', 'none', 'none', 'broken']);
  assert.deepEqual(calls[2], ['game', 2, 1920, 1080]);

  const pinned = planShots({ ...c, layout: 'fit', panels: { plans, placement } });
  assert.ok(pinned.placed.every((p) => p.layout === 'fit' && p.placement.chosen === true));
});

test('planShots requires a subject rule', () => {
  const c = scenario('podcast 1920x1080');
  assert.throws(() => planShots({ ...c, subjectRule: undefined }), TypeError);
  assert.throws(() => planShots({ ...c, subjectRule: 'nobody' }), TypeError);
});
