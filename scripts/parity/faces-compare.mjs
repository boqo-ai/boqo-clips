#!/usr/bin/env node
// node scripts/parity/faces-compare.mjs --boqo <boqo at the pin> (--frames <dir> | --synthetic | --video <file> --shots <json>)
//                                       [--mode production|raw] [--python <path>] [--json] [--golden]
//   The face-box parity check of Task E2: hosted boqo's detector (mediapipe 0.10.18, through
//   scripts/parity/py/mp_detect.py and detect_faces.py at the pin) and the skill's (engine/blazeface.mjs through
//   engine/boqo/detect-faces.mjs) on the SAME frames, every PNG in --frames (or the synthetic set of
//   scripts/parity/face-frames.mjs with --synthetic). Prints, one fact a line: frames, detections on each side,
//   matched pairs, the IoU distribution over mediapipe's detections (an unmatched one counts as IoU 0), the share
//   at IoU >= 0.9 (the gate: >= 95%), and the largest differences in confidence and in the keypoint-derived fields.
//
//   --video <file> --shots '[{"startSec":0,"endSec":4}, ...]': the whole thing on a video instead of frames:
//     detect_faces.py itself, with the flags faces.ts passes in production, against engine/faces.mjs's
//     detectShotFaces, both running the ffprobe and ffmpeg on the engine's PATH (toolEnv). Compares, per shot,
//     the face count and each face's median box (IoU), coverage, mouthMotion and track.
//   --mode production (default): what detect_faces.py does to one sampled frame, tiled at 1.5:1, the 0.8 re-check,
//     merged at IoU 0.3; each frame is taken as already scaled (scale 1).
//   --mode raw: the detector alone on the whole frame, keypoints compared too.
//   --python: the venv's interpreter (default $BOQO_MP_PYTHON, else ~/.boqo-mp/bin/python); run with -I.
//   --json: one JSON document instead of the lines.
//   --golden: with --synthetic --mode raw, also writes mediapipe's output to tests/golden/blazeface-synthetic.json
//     (tests/blazeface.test.mjs compares the ONNX path with it on every OS).
//
//   Parity tooling: it needs the Python venv, so CI never runs it. Frames of real videos are measured, never
//   committed.
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadBlazeFace } from '../../engine/blazeface.mjs';
import { MERGE_IOU, _intersection_over_union, _process_window, boxes_from_windows, tile_windows } from '../../engine/boqo/detect-faces.mjs';
import { toolEnv } from '../../engine/env.mjs';
import { FACE_MIN_CONFIDENCE, TILE_MAX_ASPECT, TILE_OVERLAP, TRACK_SAMPLE_HZ, detectShotFaces } from '../../engine/faces.mjs';
import { syntheticFrames } from './face-frames.mjs';
import { decodePng, encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const die = (msg) => {
  process.stderr.write(`faces-compare: ${msg}\n`);
  process.exit(2);
};

const { values } = parseArgs({
  options: {
    boqo: { type: 'string' },
    frames: { type: 'string' },
    synthetic: { type: 'boolean' },
    mode: { type: 'string', default: 'production' },
    python: { type: 'string' },
    json: { type: 'boolean' },
    golden: { type: 'boolean' },
    video: { type: 'string' },
    shots: { type: 'string' },
  },
});
if (!values.boqo || !(values.frames || values.synthetic || (values.video && values.shots))) {
  die('usage: --boqo <dir> (--frames <dir> | --synthetic | --video <file> --shots <json>) [--mode production|raw]');
}
if (!['production', 'raw'].includes(values.mode)) die('--mode is production or raw');
if (values.golden && !(values.synthetic && values.mode === 'raw')) die('--golden needs --synthetic --mode raw');
const python = values.python ?? process.env.BOQO_MP_PYTHON ?? join(homedir(), '.boqo-mp', 'bin', 'python');

if (values.video) {
  await compareVideo();
  process.exit(0);
}

/** --video: detect_faces.py and detectShotFaces on the same file and shots. */
async function compareVideo() {
  const video = resolve(values.video);
  const shots = JSON.parse(values.shots);
  const env = toolEnv();
  const helper = join(resolve(values.boqo), 'apps/worker/python/detect_faces.py');
  // faces.ts's argv, with render/config.ts's production values.
  const args = ['-I', helper, '--video', video, '--min-confidence', String(FACE_MIN_CONFIDENCE), '--model-selection', '0',
    '--tile-max-aspect', String(TILE_MAX_ASPECT), '--tile-overlap', String(TILE_OVERLAP), '--track-sample-hz', String(TRACK_SAMPLE_HZ),
    '--shots', JSON.stringify(shots)];
  const py = spawnSync(python, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (py.error) die(`could not run ${python}: ${py.error.message}`);
  if (py.status !== 0) die(`detect_faces.py exited ${py.status}:\n${py.stderr.slice(-2000)}`);
  const hosted = JSON.parse(py.stdout);
  const exec = (command, argv, { timeoutMs } = {}) =>
    new Promise((ok, fail) => {
      execFile(command, argv, { env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
        err ? fail(Object.assign(err, { stderr })) : ok({ stdout, stderr }),
      );
    });
  const skill = await detectShotFaces({ file: video, shots, exec });
  if (skill.unavailable) die(`the ONNX path is unavailable: ${skill.reason}`);

  let sameCount = 0;
  let faces = 0;
  let matched = 0;
  const ious = [];
  const worst = { coverage: 0, mouthMotion: 0, trackCx: 0, trackCy: 0, trackT: 0, faceCentreX: 0 };
  let trackLengthsDiffer = 0;
  for (const shot of hosted.shots) {
    const A = shot.faces;
    const B = skill.shots.find((s) => s.shotIndex === shot.shotIndex)?.faces ?? [];
    if (A.length === B.length) sameCount++;
    faces += A.length;
    const pairs = [];
    A.forEach((a, p) => B.forEach((b, q) => pairs.push([_intersection_over_union(a, b), p, q])));
    pairs.sort((u, v) => v[0] - u[0]);
    const usedA = new Set();
    const usedB = new Set();
    for (const [iou, p, q] of pairs) {
      if (iou <= 0 || usedA.has(p) || usedB.has(q)) continue;
      usedA.add(p);
      usedB.add(q);
      matched++;
      ious.push(iou);
      const a = A[p];
      const b = B[q];
      worst.coverage = Math.max(worst.coverage, Math.abs(a.coverage - b.coverage));
      worst.mouthMotion = Math.max(worst.mouthMotion, Math.abs(a.mouthMotion - b.mouthMotion));
      if ('faceCentreX' in a && 'faceCentreX' in b) worst.faceCentreX = Math.max(worst.faceCentreX, Math.abs(a.faceCentreX - b.faceCentreX));
      if (a.track.length !== b.track.length) trackLengthsDiffer++;
      for (let k = 0; k < Math.min(a.track.length, b.track.length); k++) {
        worst.trackT = Math.max(worst.trackT, Math.abs(a.track[k].t - b.track[k].t));
        worst.trackCx = Math.max(worst.trackCx, Math.abs(a.track[k].cx - b.track[k].cx));
        worst.trackCy = Math.max(worst.trackCy, Math.abs(a.track[k].cy - b.track[k].cy));
      }
    }
    for (let p = 0; p < A.length; p++) if (!usedA.has(p)) ious.push(0);
  }
  const atGate = ious.filter((v) => v >= 0.9).length;
  const report = {
    frame: [hosted.frameWidth, hosted.frameHeight, skill.frameWidth, skill.frameHeight],
    shots: hosted.shots.length,
    sameFaceCount: sameCount,
    faces,
    skillFaces: skill.shots.reduce((n, s) => n + s.faces.length, 0),
    matched,
    iouMin: ious.length ? Math.min(...ious) : null,
    atIou09: ious.length ? atGate / ious.length : null,
    trackLengthsDiffer,
    maxDiff: worst,
  };
  if (values.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    process.stdout.write(
      [
        `frame: detect_faces.py ${hosted.frameWidth}x${hosted.frameHeight}, skill ${skill.frameWidth}x${skill.frameHeight}`,
        `shots ${report.shots}, same face count in ${sameCount}`,
        `faces: detect_faces.py ${faces}, skill ${report.skillFaces}, matched ${matched}`,
        `median-box IoU: min ${report.iouMin?.toFixed(6) ?? 'n/a'}; >= 0.9 in ${atGate} of ${ious.length}`,
        `track lengths differ for ${trackLengthsDiffer} faces`,
        `largest differences: ${Object.entries(worst).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(', ')}`,
      ].join('\n') + '\n',
    );
  }
}

let dir = values.frames && resolve(values.frames);
let scratch = null;
if (values.synthetic) {
  scratch = mkdtempSync(join(tmpdir(), 'boqo-faces-compare-'));
  for (const { name, image } of syntheticFrames()) writeFileSync(join(scratch, `${name}.png`), encodePng(image));
  dir = scratch;
}

try {
  // mediapipe
  const py = spawnSync(python, ['-I', join(root, 'scripts/parity/py/mp_detect.py'), '--boqo', resolve(values.boqo), '--frames', dir, '--mode', values.mode], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (py.error) die(`could not run ${python}: ${py.error.message}`);
  if (py.status !== 0) die(`mp_detect.py exited ${py.status}:\n${py.stderr.slice(-2000)}`);
  const mp = JSON.parse(py.stdout).frames;

  // onnxruntime
  const detector = await loadBlazeFace();
  const names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png')).sort();
  const onnx = [];
  for (const name of names) {
    const image = decodePng(readFileSync(join(dir, name)));
    let boxes;
    if (values.mode === 'raw') {
      const { detections } = await detector.process(image);
      boxes = (detections ?? []).map((d) => ({
        x: d.location_data.relative_bounding_box.xmin,
        y: d.location_data.relative_bounding_box.ymin,
        width: d.location_data.relative_bounding_box.width,
        height: d.location_data.relative_bounding_box.height,
        confidence: d.score[0],
        keypoints: d.location_data.relative_keypoints,
      }));
    } else {
      const windows = tile_windows(image.width, image.height, TILE_MAX_ASPECT, TILE_OVERLAP);
      const perWindow = [];
      for (const [x0, win] of windows) perWindow.push(await _process_window(image, x0, win, 1.0, detector, FACE_MIN_CONFIDENCE));
      boxes = boxes_from_windows(perWindow, windows, image.width, MERGE_IOU);
    }
    onnx.push({ file: name, width: image.width, height: image.height, boxes });
  }
  await detector.release();
  if (mp.length !== onnx.length || mp.some((f, i) => f.file !== onnx[i].file)) die('the two sides read different frame lists');

  // pair them up per frame, best IoU first
  const ious = [];
  let matched = 0;
  let onnxOnly = 0;
  const worst = { confidence: 0, faceCentreX: 0, eyeLineY: 0, facing: 0, mouthDrop: 0, keypoints: 0 };
  for (let i = 0; i < mp.length; i++) {
    const A = mp[i].boxes;
    const B = onnx[i].boxes;
    const pairs = [];
    A.forEach((a, p) => B.forEach((b, q) => pairs.push([_intersection_over_union(a, b), p, q])));
    pairs.sort((u, v) => v[0] - u[0]);
    const usedA = new Set();
    const usedB = new Set();
    for (const [iou, p, q] of pairs) {
      if (iou <= 0 || usedA.has(p) || usedB.has(q)) continue;
      usedA.add(p);
      usedB.add(q);
      matched++;
      ious.push(iou);
      const a = A[p];
      const b = B[q];
      worst.confidence = Math.max(worst.confidence, Math.abs(a.confidence - b.confidence));
      for (const k of ['faceCentreX', 'eyeLineY', 'facing', 'mouthDrop']) {
        if (k in a && k in b) worst[k] = Math.max(worst[k], Math.abs(a[k] - b[k]));
      }
      if (a.keypoints && b.keypoints) {
        a.keypoints.forEach((kp, j) => {
          worst.keypoints = Math.max(worst.keypoints, Math.abs(kp.x - b.keypoints[j].x), Math.abs(kp.y - b.keypoints[j].y));
        });
      }
    }
    for (let p = 0; p < A.length; p++) if (!usedA.has(p)) ious.push(0);
    onnxOnly += B.length - usedB.size;
  }

  const sorted = [...ious].sort((u, v) => u - v);
  const q = (f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : null);
  const atGate = ious.filter((v) => v >= 0.9).length;
  const report = {
    mode: values.mode,
    frames: mp.length,
    mediapipe: mp.reduce((n, f) => n + f.boxes.length, 0),
    onnx: onnx.reduce((n, f) => n + f.boxes.length, 0),
    matched,
    mediapipeOnly: ious.length - matched,
    onnxOnly,
    iou: { min: sorted[0] ?? null, p5: q(0.05), median: q(0.5) },
    atIou09: ious.length ? atGate / ious.length : null,
    maxDiff: values.mode === 'raw' ? { confidence: worst.confidence, keypoints: worst.keypoints } : { confidence: worst.confidence, faceCentreX: worst.faceCentreX, eyeLineY: worst.eyeLineY, facing: worst.facing, mouthDrop: worst.mouthDrop },
  };

  if (values.golden) {
    const out = join(root, 'tests/golden/blazeface-synthetic.json');
    writeFileSync(out, `${JSON.stringify(mp, null, 2)}\n`);
    process.stderr.write(`${out}\n`);
  }

  if (values.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    const lines = [
      `mode ${report.mode}`,
      `frames ${report.frames}`,
      `detections: mediapipe ${report.mediapipe}, onnx ${report.onnx}, matched ${report.matched}, mediapipe only ${report.mediapipeOnly}, onnx only ${report.onnxOnly}`,
      `IoU over mediapipe's detections: min ${report.iou.min?.toFixed(6) ?? 'n/a'}, p5 ${report.iou.p5?.toFixed(6) ?? 'n/a'}, median ${report.iou.median?.toFixed(6) ?? 'n/a'}`,
      `IoU >= 0.9: ${atGate} of ${ious.length} (${pct(report.atIou09)}; the gate is 95%)`,
      `largest differences: ${Object.entries(report.maxDiff).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(', ')}`,
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  }
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
