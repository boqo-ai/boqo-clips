// engine/boqo/detect-faces.mjs against hosted boqo's own detect_faces.py (goldens written by
// scripts/parity/py/faces_golden.py at the pin), and engine/faces.mjs's detectShotFaces end to end with a scripted
// detector and a fake ffmpeg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as df from '../engine/boqo/detect-faces.mjs';
import { FACE_MIN_CONFIDENCE, TILE_MAX_ASPECT, TILE_OVERLAP, TRACK_SAMPLE_HZ, detectShotFaces } from '../engine/faces.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url)), 'utf8')).calls;

/** A call that throws records what detect_faces.py's runner records for a raise. */
async function settle(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.name === 'ValueError' || e?.name === 'RuntimeError') return { error: e.name, message: e.message };
    throw e;
  }
}

async function golden(name, run) {
  const out = [];
  for (const call of input(name)) out.push(await settle(() => run(call)));
  expectGolden(name, out);
}

const kp = (points) => (points == null ? null : points.map(([x, y]) => ({ x, y })));

const fakeDetection = (d) => ({
  score: [d.score],
  location_data: {
    relative_bounding_box: { xmin: d.box[0], ymin: d.box[1], width: d.box[2], height: d.box[3] },
    relative_keypoints: kp(d.keypoints),
  },
});

/** Answers each process() call with the next scripted list, recording the image it was given. */
function scriptedDetector(script) {
  const queue = [...script];
  const calls = [];
  return {
    calls,
    queue,
    async process(image) {
      const px = (i) => [image.data[i], image.data[i + 1], image.data[i + 2]];
      const n = image.width * image.height;
      calls.push({ height: image.height, width: image.width, contiguous: true, first: n ? px(0) : null, last: n ? px((n - 1) * 3) : null });
      if (!queue.length) throw new Error('the scripted detector ran out of answers');
      const answer = queue.shift();
      return { detections: answer === null ? null : answer.map(fakeDetection) };
    },
  };
}

/** Pixel (y, x) is (x % 256, y % 256, (7x + y) % 256): any window shows where it came from. */
function patternFrame(height, width) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 3;
      data[k] = x % 256;
      data[k + 1] = y % 256;
      data[k + 2] = (7 * x + y) % 256;
    }
  }
  return { width, height, data };
}

// ---- the pure helpers

test('face_geometry: facing, eye line, mouth drop and face centre from the six keypoints', () =>
  golden('faces-face-geometry', (c) => df.face_geometry(kp(c.keypoints), c.box)));

test('tile_windows: square windows above 1.5:1, half-even stride rounding, the last window at the right edge', () =>
  golden('faces-tile-windows', (c) => df.tile_windows(c.width, c.height, c.maxAspect, c.overlap)));

test('to_absolute: window-local boxes and faceCentreX into whole-frame units', () =>
  golden('faces-to-absolute', (c) => df.to_absolute(c.box, c.x0, c.win, c.frameWidth)));

test('_intersection_over_union', () => golden('faces-iou', (c) => df._intersection_over_union(c.a, c.b)));

test('merge_detections: highest confidence wins, stable on ties, IoU strictly under the threshold survives', () =>
  golden('faces-merge-detections', (c) => df.merge_detections(c.boxes, c.iou)));

test('boxes_from_windows: one entry per window or a ValueError, then merged at the threshold', () =>
  golden('faces-boxes-from-windows', (c) => df.boxes_from_windows(c.results, c.windows, c.frameWidth, c.iou)));

test('match_box_for_point: containment first, else the nearest centre within 0.2', () =>
  golden('faces-match-box-for-point', (c) => df.match_box_for_point(c.boxes, c.point)));

test('_frames_with_boxes keeps each frame its original sample index', () =>
  golden('faces-frames-with-boxes', (c) => df._frames_with_boxes(c.indexed)));

test('_track_face walks with the face, both ways, sorted by index', () =>
  golden('faces-track-face', (c) => {
    const [entries, drops] = df._track_face(c.frames, c.startIndex, c.seed);
    return { entries, drops };
  }));

test('_median_box: component-wise median, keypoint fields only over the samples that carried them', () =>
  golden('faces-median-box', (c) => df._median_box(c.boxes)));

test('sample_count: 2 Hz floored at 12, Python rounding', () =>
  golden('faces-sample-count', (c) => ('floor' in c ? df.sample_count(c.duration, c.hz, c.floor) : df.sample_count(c.duration, c.hz))));

test('sample_time: index over the REQUESTED count, rounded to 4 places half to even', () =>
  golden('faces-sample-time', (c) => df.sample_time(c.index, c.requested, c.duration)));

test('summarise_faces: roster, median box, mouth motion, track, coverage and the 25% floor', () =>
  golden('faces-summarise-faces', (c) => df.summarise_faces(c.frames, c.duration, c.requested)));

// ---- the frame source, the window and the shot, with fakes where detect_faces.py's runner has them

test('shot_frames: the same ffmpeg argv (the output a file, not stdout), whole frames only, the failure message', () =>
  golden('faces-shot-frames', async (c) => {
    let argv;
    const exec = async (command, args) => {
      argv = [command, ...args];
      const width = Math.min(c.width, df.DETECT_MAX_WIDTH);
      let height = df.py_round(c.height * width / c.width);
      height -= height % 2;
      const size = width * height * 3;
      const bytes = Buffer.alloc(size * c.stdoutFrames + (c.extraBytes ?? 0), 7);
      for (let i = 0; i < c.stdoutFrames; i++) bytes.fill(i % 256, i * size, (i + 1) * size);
      await writeFile(args.at(-1), bytes);
      if (c.returncode) throw Object.assign(new Error(`ffmpeg exited with ${c.returncode}`), { stderr: '' });
      return { stdout: '', stderr: '' };
    };
    const frames = [];
    let raised = null;
    try {
      for await (const [index, frame] of df.shot_frames({ exec }, c.video, c.start, c.end, c.width, c.height, c.count)) {
        frames.push({ index, shape: [frame.height, frame.width, 3], first: frame.data[0] });
      }
    } catch (e) {
      raised = { error: e.name, message: e.message };
    }
    return { argv: [...argv.slice(0, -1), '-'], frames, raised };
  }));

test('_process_window: the window cut from the scaled frame, the confidence re-check, keypoint geometry', () =>
  golden('faces-process-window', async (c) => {
    const detector = scriptedDetector([c.detections]);
    const found = await df._process_window(patternFrame(c.frameHeight, c.frameWidth), c.x0, c.win, c.scale, detector, c.minConfidence);
    return { found, image: detector.calls[0] };
  }));

test('analyse_shot: sampling, tiling, merging and summarising one shot', () =>
  golden('faces-analyse-shot', async (c) => {
    let shotFrames;
    const frames = async function* (video, start, end, width, height, count) {
      shotFrames = { video, start, end, width, height, count };
      const frame = patternFrame(c.scaledHeight, c.scaledWidth);
      for (let i = 0; i < c.frames; i++) yield [i, frame];
    };
    const detector = scriptedDetector(c.script);
    const faces = await df.analyse_shot('clip.mp4', detector, c.start, c.end, c.minConfidence, c.width, c.height, c.maxAspect, c.overlap, c.hz, { shot_frames: frames });
    return { faces, shotFrames, detectorCalls: detector.calls, unusedAnswers: detector.queue.length };
  }));

// ---- python formatting the argv depends on

test('py_repr formats a float as Python 3.11 str() does', () => {
  const cases = [
    [0, '0.0'], [2, '2.0'], [12.5, '12.5'], [-0, '-0.0'], [1e-4, '0.0001'], [1e-5, '1e-05'], [4e-5, '4e-05'],
    [9.720000403411509e-7, '9.720000403411509e-07'], [1e15, '1000000000000000.0'], [1e16, '1e+16'], [1.5e16, '1.5e+16'],
    [123456789012345680, '1.2345678901234568e+17'], [0.1 + 0.2, '0.30000000000000004'], [-2.5e-7, '-2.5e-07'], [12000, '12000.0'],
  ];
  for (const [v, want] of cases) assert.equal(df.py_repr(v), want, String(v));
});

test('py_round: half to even on the exact binary value', () => {
  assert.equal(df.py_round(2.5), 2);
  assert.equal(df.py_round(3.5), 4);
  assert.equal(df.py_round(-2.5), -2);
  assert.equal(df.py_round(2.4999999999999996), 2);
  assert.equal(df.py_round(0.03125, 4), 0.0312);
  assert.equal(df.py_round(0.09375, 4), 0.0938);
  assert.equal(df.py_round(0.12345, 4), 0.1235); // 0.12345 is stored just above the tie
  assert.equal(df.py_round(2.675, 2), 2.67); // stored just below
  assert.equal(df.py_round(-0.03125, 4), -0.0312);
});

// ---- detectShotFaces

test('the production constants are the ones render/config.ts and detect_faces.py default to', () => {
  assert.equal(FACE_MIN_CONFIDENCE, 0.8);
  assert.equal(TILE_MAX_ASPECT, 1.5);
  assert.equal(TILE_OVERLAP, 0.5);
  assert.equal(TRACK_SAMPLE_HZ, 2);
  assert.equal(df.SAMPLES_PER_SHOT, 12);
  assert.equal(df.MIN_COVERAGE_RATIO, 0.25);
  assert.equal(df.MAX_MATCH_DISTANCE, 0.2);
  assert.equal(df.MERGE_IOU, 0.3);
  assert.equal(df.DETECT_MAX_WIDTH, 1280);
});

/** A fake ffprobe/ffmpeg pair: ffprobe answers `width`x`height`; ffmpeg writes `frames` frames to its output file. */
function fakeTools({ width, height, frames, calls }) {
  return async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ width, height }] }), stderr: '' };
    const w = Math.min(width, 1280);
    let h = Math.round((height * w) / width);
    h -= h % 2;
    await writeFile(args.at(-1), Buffer.alloc(w * h * 3 * frames, 128));
    return { stdout: '', stderr: '' };
  };
}

test('detectShotFaces: one entry per shot, keyed by shotIndex, frame size from ffprobe', async () => {
  const calls = [];
  const exec = fakeTools({ width: 1920, height: 1080, frames: 12, calls });
  const answer = [{ score: 0.95, box: [0.4, 0.3, 0.2, 0.36], keypoints: [[0.45, 0.4], [0.55, 0.4], [0.5, 0.47], [0.5, 0.56], [0.41, 0.43], [0.59, 0.43]] }];
  // 2 shots x 12 frames x 3 windows; the face only in the middle window
  const detector = scriptedDetector(Array.from({ length: 72 }, (_, i) => (i % 3 === 1 ? answer : [])));
  const shots = [{ startSec: 0, endSec: 2.5 }, { startSec: 2.5, endSec: 5 }];
  const out = await detectShotFaces({ file: 'clip with space.mp4', shots, exec, detector });
  assert.equal(out.unavailable, undefined);
  assert.equal(out.frameWidth, 1920);
  assert.equal(out.frameHeight, 1080);
  assert.deepEqual(out.shots.map((s) => s.shotIndex), [0, 1]);
  for (const s of out.shots) {
    assert.equal(s.faces.length, 1);
    assert.equal(s.faces[0].coverage, 1);
    assert.equal(s.faces[0].track.length, 12);
  }
  // the path is one argv element, never part of a shell string
  assert.ok(calls.every((c) => c.includes('clip with space.mp4')));
  assert.deepEqual(calls[0].slice(0, 1), ['ffprobe']);
  const ffmpeg = calls.filter((c) => c[0] === 'ffmpeg');
  assert.equal(ffmpeg.length, 2);
  assert.ok(ffmpeg[1].includes('2.5'));
  assert.equal(detector.queue.length, 0);
});

test('detectShotFaces: onnxruntime that cannot load gives {unavailable, reason} and no exception', async () => {
  const calls = [];
  const exec = fakeTools({ width: 1920, height: 1080, frames: 12, calls });
  const load = async () => {
    throw new Error('The specified module could not be found.\r\n\\\\?\\C:\\x\\onnxruntime_binding.node');
  };
  const out = await detectShotFaces({ file: 'clip.mp4', shots: [{ startSec: 0, endSec: 3 }], exec, load });
  assert.equal(out.unavailable, true);
  assert.match(out.reason, /^onnxruntime-node did not load: The specified module could not be found\.$/);
  assert.equal(calls.length, 0, 'nothing runs when the detector cannot load');
});

test('detectShotFaces: a detector that fails mid-run is unavailable too, not a failed render', async () => {
  const calls = [];
  const exec = fakeTools({ width: 1280, height: 720, frames: 12, calls });
  const detector = { process: async () => { throw new Error('ORT run failed'); } };
  const out = await detectShotFaces({ file: 'clip.mp4', shots: [{ startSec: 0, endSec: 3 }], exec, detector });
  assert.deepEqual(out, { unavailable: true, reason: 'the face detector failed: ORT run failed' });
});

test('detectShotFaces: an ffprobe failure still throws, as hosted fails the clip', async () => {
  const exec = async () => {
    throw Object.assign(new Error('ffprobe failed'), { stderr: 'clip.mp4: No such file or directory' });
  };
  const detector = scriptedDetector([]);
  await assert.rejects(() => detectShotFaces({ file: 'clip.mp4', shots: [{ startSec: 0, endSec: 3 }], exec, detector }), /ffprobe failed on clip\.mp4: clip\.mp4: No such file or directory/);
});

test('detectShotFaces: no shots, no detector call', async () => {
  const calls = [];
  const exec = fakeTools({ width: 640, height: 480, frames: 0, calls });
  const out = await detectShotFaces({ file: join('a dir', 'clip.mp4'), shots: [], exec, detector: scriptedDetector([]) });
  assert.deepEqual(out, { frameWidth: 640, frameHeight: 480, shots: [] });
});
