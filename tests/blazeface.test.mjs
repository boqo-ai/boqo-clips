// engine/blazeface.mjs: BlazeFace short-range through onnxruntime-node, rebuilt from mediapipe 0.10.18's
// FaceDetection graph. The first test that loads onnxruntime-node's native binary on every CI OS.
//
// tests/golden/blazeface-synthetic.json is mediapipe's own output on scripts/parity/face-frames.mjs's frames, written
// by `node scripts/parity/faces-compare.mjs --boqo "$PARITY" --synthetic --mode raw --golden`;
// tests/golden/blazeface-cv-matrices.json is cv2 4.11's getPerspectiveTransform and invert for four frame sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_FILE, MODEL_SHA256, OPTIONS, SCORE_FLOOR, getPerspectiveTransform, invert3, letterboxRoi, loadBlazeFace, loadOnnxRuntime,
  sourceQuad, ssdAnchors, weightedNms,
} from '../engine/blazeface.mjs';
import { FIXTURE, syntheticFrames } from '../scripts/parity/face-frames.mjs';
import { decodePng } from '../scripts/parity/png.mjs';

const golden = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./golden/${name}.json`, import.meta.url)), 'utf8'));

// ---- the model file

test('the shipped model is the one SOURCE.md records, and loadBlazeFace checks it', () => {
  const sha = createHash('sha256').update(readFileSync(MODEL_FILE)).digest('hex');
  assert.equal(sha, MODEL_SHA256);
  const source = readFileSync(fileURLToPath(new URL('../engine/models/SOURCE.md', import.meta.url)), 'utf8');
  assert.ok(source.includes(MODEL_SHA256), 'SOURCE.md names the ONNX sha256');
  assert.match(source, /Apache License, Version 2\.0/);
});

// ---- the graph's pieces

test('ssdAnchors: 896 centres, two per 8-px cell then six per 16-px cell', () => {
  const a = ssdAnchors();
  assert.equal(a.length, OPTIONS.numBoxes);
  assert.deepEqual(a[0], { x: 0.03125, y: 0.03125 });
  assert.deepEqual(a[1], a[0]);
  assert.deepEqual(a[2], { x: 0.09375, y: 0.03125 });
  assert.deepEqual(a[511], { x: 0.96875, y: 0.96875 });
  assert.deepEqual(a[512], { x: 0.0625, y: 0.0625 });
  assert.deepEqual(a[517], a[512]);
  assert.deepEqual(a[518], { x: 0.1875, y: 0.0625 });
  assert.deepEqual(a[895], { x: 0.9375, y: 0.9375 });
});

test('letterboxRoi pads the frame to a square around its centre', () => {
  assert.deepEqual(letterboxRoi(1280, 720), { cx: 640, cy: 360, width: 1280, height: 1280 });
  assert.deepEqual(letterboxRoi(541, 962), { cx: 270.5, cy: 481, width: 962, height: 962 });
  assert.deepEqual(letterboxRoi(256, 256), { cx: 128, cy: 128, width: 256, height: 256 });
});

test("the sampling matrices are OpenCV's, bit for bit (cv2 4.11, the one mediapipe 0.10.18 installs)", () => {
  const same = (got, want, what) => {
    assert.equal(got.length, want.length, what);
    // === rather than deepEqual: OpenCV's -0 and an arithmetic 0 sample the same pixel.
    got.forEach((v, i) => assert.ok(v === want[i], `${what}[${i}]: ${v} !== ${want[i]}`));
  };
  for (const g of golden('blazeface-cv-matrices')) {
    const quad = sourceQuad(letterboxRoi(g.width, g.height));
    same(quad.flat(), g.src.flat(), `${g.width}x${g.height} quad`);
    const M = getPerspectiveTransform(quad, [[0, 128], [0, 0], [128, 0], [128, 128]]);
    same(M, g.M, `${g.width}x${g.height} M`);
    same(invert3(M), g.inverse, `${g.width}x${g.height} inverse`);
  }
});

test('weightedNms: overlapping boxes fold into their score-weighted mean, the leader keeps its score', () => {
  const box = (score, xmin, k) => ({ score, xmin, ymin: 0.2, width: 0.2, height: 0.2, keypoints: [{ x: k, y: k }] });
  const out = weightedNms([box(0.6, 0.12, 0.3), box(0.9, 0.1, 0.1), box(0.7, 0.7, 0.8)]);
  assert.equal(out.length, 2);
  assert.equal(out[0].score, 0.9);
  assert.ok(Math.abs(out[0].xmin - (0.9 * 0.1 + 0.6 * 0.12) / 1.5) < 1e-6);
  assert.ok(Math.abs(out[0].width - 0.2) < 1e-6);
  assert.ok(Math.abs(out[0].keypoints[0].x - (0.9 * 0.1 + 0.6 * 0.3) / 1.5) < 1e-6);
  assert.equal(out[1].score, 0.7);
  assert.ok(Math.abs(out[1].xmin - 0.7) < 1e-6);
  assert.deepEqual(weightedNms([]), []);
});

test('the pre-NMS floor is the graph’s 0.5, not min_detection_confidence', () => {
  assert.equal(SCORE_FLOOR, 0.5);
});

// ---- the model, through onnxruntime-node

const detector = await loadBlazeFace();

test('the synthetic face: one box, confidence at least 0.8, six keypoints inside it', async () => {
  const image = decodePng(readFileSync(FIXTURE));
  const { detections } = await detector.process(image);
  assert.equal(detections.length, 1);
  const d = detections[0];
  assert.ok(d.score[0] >= 0.8, `confidence ${d.score[0]}`);
  const b = d.location_data.relative_bounding_box;
  const kps = d.location_data.relative_keypoints;
  assert.equal(kps.length, 6);
  for (const k of kps) {
    assert.ok(k.x >= b.xmin && k.x <= b.xmin + b.width && k.y >= b.ymin && k.y <= b.ymin + b.height, `keypoint ${JSON.stringify(k)} outside the box`);
  }
  // the subject's right eye is on the image's left
  assert.ok(kps[0].x < kps[1].x);
});

test("mediapipe's own detections on the synthetic frames, to float32 rounding (1e-4 across CPUs)", async () => {
  const want = golden('blazeface-synthetic');
  const frames = syntheticFrames();
  assert.deepEqual(frames.map((f) => `${f.name}.png`), want.map((f) => f.file));
  const TOL = 1e-4;
  for (const [i, { name, image }] of frames.entries()) {
    const { detections } = await detector.process(image);
    assert.equal(detections.length, want[i].boxes.length, `${name}: detection count`);
    detections.forEach((d, j) => {
      const w = want[i].boxes[j];
      const b = d.location_data.relative_bounding_box;
      const diffs = [b.xmin - w.x, b.ymin - w.y, b.width - w.width, b.height - w.height, d.score[0] - w.confidence];
      d.location_data.relative_keypoints.forEach((k, q) => diffs.push(k.x - w.keypoints[q].x, k.y - w.keypoints[q].y));
      const worst = Math.max(...diffs.map(Math.abs));
      assert.ok(worst < TOL, `${name} detection ${j}: off by ${worst}`);
    });
  }
});

test('an empty frame finds nothing; a 1x1 and a very wide frame do not throw', async () => {
  assert.deepEqual((await detector.process({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 3) })).detections, []);
  await detector.process({ width: 1, height: 1, data: new Uint8Array(3) });
  await detector.process({ width: 640, height: 4, data: new Uint8Array(640 * 4 * 3).fill(200) });
});

// ---- load failures: a reason, never a crash

test('loadBlazeFace: onnxruntime-node failing to load names it', async () => {
  const load = async () => {
    throw new Error('libonnxruntime.so.1: cannot open shared object file: No such file or directory\n    at Module._extensions');
  };
  await assert.rejects(() => loadBlazeFace({ load }), {
    code: 'ORT_LOAD',
    message: 'onnxruntime-node did not load: libonnxruntime.so.1: cannot open shared object file: No such file or directory',
  });
  await assert.rejects(() => loadBlazeFace({ load: () => import('onnxruntime-node-is-not-a-package') }), {
    code: 'ORT_NOT_INSTALLED',
    message: 'onnxruntime-node is not installed',
  });
});

test('loadBlazeFace: a module without InferenceSession, a session that cannot open, a model that is missing or altered', async () => {
  await assert.rejects(() => loadBlazeFace({ load: async () => ({}) }), { code: 'ORT_LOAD', message: /onnxruntime-node did not load: the module has no InferenceSession/ });
  const broken = { Tensor: class {}, InferenceSession: { create: async () => { throw new Error('bad model'); } } };
  await assert.rejects(() => loadBlazeFace({ load: async () => broken }), { code: 'ORT_SESSION', message: /onnxruntime-node could not open the face model: bad model/ });
  const noRun = {
    Tensor: class {},
    InferenceSession: { create: async () => ({ inputNames: ['input'], run: async () => { throw new Error('kernel failed'); } }) },
  };
  await assert.rejects(() => loadBlazeFace({ load: async () => noRun }), { code: 'ORT_RUN', message: /onnxruntime-node could not run the face model: kernel failed/ });
  await assert.rejects(() => loadBlazeFace({ modelFile: join(tmpdir(), 'no-such-dir', 'blazeface-short.onnx') }), { code: 'MODEL_MISSING', message: /the face model is missing/ });
  await assert.rejects(() => loadBlazeFace({ sha256: '0'.repeat(64) }), { code: 'MODEL_CHECKSUM', message: /the face model's checksum does not match/ });
});

test('loadBlazeFace: a model under a home path with spaces and non-ASCII loads (bytes, never a path)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'boqo home é '));
  try {
    const dir = join(home, '.boqo-clips', 'engine', 'models');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'blazeface-short.onnx');
    copyFileSync(MODEL_FILE, file);
    const d = await loadBlazeFace({ modelFile: file, load: loadOnnxRuntime });
    const { detections } = await d.process(decodePng(readFileSync(FIXTURE)));
    assert.equal(detections.length, 1);
    await d.release();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('release', async () => {
  await detector.release();
});
