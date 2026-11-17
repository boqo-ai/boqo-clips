// engine/boqo/detect-faces.mjs against hosted boqo's own detect_faces.py (goldens written by
// scripts/parity/py/faces_golden.py at the pin), and engine/faces.mjs's detectShotFaces end to end with a scripted
// detector and a fake ffmpeg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as df from '../engine/boqo/detect-faces.mjs';
import { toolEnv } from '../engine/env.mjs';
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

/**
 * A fake ffmpeg for shot_frames: the one-pass stream is `total` frames (frame i filled with byte i % 256, or
 * `fill(i)`) then `extraBytes` of a partial frame; a call writes the part its `select='gte(pts,A)'` and `-frames:v K`
 * ask for, to its output path (the last argument). Returns whether the call reached the stream's end, where a
 * failing ffmpeg fails: a call cut by -frames:v before that point exits cleanly.
 */
function chunkedFfmpeg({ frameSize, total, extraBytes = 0, fill = (i) => i % 256 }) {
  return async (args) => {
    const first = Number(/select='gte\(pts,(\d+)\)'/.exec(args[args.indexOf('-vf') + 1])?.[1] ?? 0);
    const cap = args.includes('-frames:v') ? Number(args[args.indexOf('-frames:v') + 1]) : Infinity;
    const last = Math.min(total, first + cap);
    const n = Math.max(0, last - first);
    const bytes = Buffer.alloc(n * frameSize + (first + cap > total ? extraBytes : 0), 7);
    for (let i = 0; i < n; i++) bytes.fill(fill(first + i), i * frameSize, (i + 1) * frameSize);
    await writeFile(args.at(-1), bytes);
    return first + cap > total;
  };
}

const scaledSize = (width, height) => {
  const w = Math.min(width, df.DETECT_MAX_WIDTH);
  let h = df.py_round((height * w) / width);
  h -= h % 2;
  return w * h * 3;
};

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

test('shot_frames: the same ffmpeg argv, whole frames only, the failure message (one chunk and many)', async () => {
  for (const chunk_bytes of [undefined, 1]) {
    await golden('faces-shot-frames', async (c) => {
      const base = df.shot_frames_command(c.video, c.start, c.end, c.width, c.height, c.count).argv;
      const ffmpeg = chunkedFfmpeg({ frameSize: scaledSize(c.width, c.height), total: c.stdoutFrames, extraBytes: c.extraBytes ?? 0 });
      const exec = async (command, args) => {
        // each call is the one-pass argv with only -frames:v added, writing to a file; a later chunk (and only a
        // later one) also adds its select and -fps_mode passthrough
        const vf = args[args.indexOf('-vf') + 1];
        const later = /select='gte\(pts,[1-9]\d*\)',/.test(vf);
        assert.equal(args.includes('-fps_mode'), later);
        if (later) assert.equal(args[args.indexOf('-fps_mode') + 1], 'passthrough');
        assert.ok(!/select=/.test(vf) || later, vf);
        const flags = ['-frames:v', '-fps_mode'];
        const plain = args.filter((a, i) => !flags.includes(a) && !flags.includes(args[i - 1])).slice(0, -1);
        if (later) assert.ok(vf.includes(`,trim=duration=${base[base.indexOf('-t') + 1]},select=`), vf);
        plain[plain.indexOf(vf)] = vf.replace(/trim=duration=[^,]+,select='gte\(pts,\d+\)',/, '');
        assert.deepEqual(['ffmpeg', ...plain, '-'], base);
        const reachedEnd = await ffmpeg(args);
        if (c.returncode && reachedEnd) throw Object.assign(new Error(`ffmpeg exited with ${c.returncode}`), { stderr: '' });
        return { stdout: '', stderr: '' };
      };
      const frames = [];
      let raised = null;
      try {
        for await (const [index, frame] of df.shot_frames({ exec, chunk_bytes }, c.video, c.start, c.end, c.width, c.height, c.count)) {
          frames.push({ index, shape: [frame.height, frame.width, 3], first: frame.data[0] });
        }
      } catch (e) {
        raised = { error: e.name, message: e.message };
      }
      return { argv: base, frames, raised };
    });
  }
});

test('shot_frames chunks: at most chunk_frames + 1 frames a call, the file gone before the next call, no empty last call', async () => {
  for (const [w, h, perChunk] of [[1280, 720, 23], [1080, 1920, 9], [2160, 3840, 6]]) {
    assert.equal(df.chunk_frames(scaledSize(w, h)), perChunk, `${w}x${h}`);
    assert.ok((perChunk + 1) * scaledSize(w, h) <= df.SHOT_FRAMES_CHUNK_BYTES, `${w}x${h} stays within 64 MiB`);
  }
  assert.equal(df.SHOT_FRAMES_CHUNK_BYTES, 64 * 1024 * 1024);
  assert.equal(df.chunk_frames(40 * 1024 * 1024), 1);

  const dir = mkdtempSync(join(tmpdir(), 'boqo-faces-test-'));
  try {
    const frameSize = scaledSize(64, 36);
    for (const total of [0, 1, 6, 7, 12, 13, 20]) {
      const ffmpeg = chunkedFfmpeg({ frameSize, total });
      const calls = [];
      const exec = async (command, args) => {
        assert.deepEqual(readdirSync(dir), [], 'the previous chunk was removed before this call');
        calls.push(Number(args[args.indexOf('-frames:v') + 1]));
        await ffmpeg(args);
        return { stdout: '', stderr: '' };
      };
      const got = [];
      for await (const [index, frame] of df.shot_frames({ exec, dir, chunk_bytes: frameSize * 7 }, 'v.mp4', 0, 6, 64, 36, 12)) {
        assert.equal(frame.data[0], index % 256);
        got.push(index);
      }
      assert.deepEqual(got, [...Array(total).keys()], `total ${total}`);
      // 6 yielded a call, each call asking for 7: a call returning 6 or fewer is the last
      assert.equal(calls.length, Math.max(1, Math.ceil(total / 6)), `total ${total}: ${calls.length} calls`);
      assert.ok(calls.every((k) => k === 7));
      assert.deepEqual(readdirSync(dir), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

/** A fake ffprobe/ffmpeg pair: ffprobe answers `width`x`height`; ffmpeg's stream is `frames` frames of 128. */
function fakeTools({ width, height, frames, calls }) {
  const ffmpeg = chunkedFfmpeg({ frameSize: scaledSize(width, height), total: frames, fill: () => 128 });
  return async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ width, height }] }), stderr: '' };
    await ffmpeg(args);
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

// ---- bounded disk: chunks, disk errors, cleanup

/** A detector that sees each frame's first byte (its sample index here) and puts a face where that says. */
function indexReadingDetector() {
  return {
    async process(image) {
      const k = image.data[0];
      return { detections: [{ score: [0.95], location_data: { relative_bounding_box: { xmin: 0.2 + 0.01 * (k % 40), ymin: 0.3, width: 0.3, height: 0.4 }, relative_keypoints: null } }] };
    },
  };
}

test('analyse_shot over many chunks equals one pass: same faces, same track, same coverage', async () => {
  // 1920x1080 at 2 Hz for 37 s: 74 samples; chunk_bytes for 3 frames a call -> 2 yielded a call, 37 calls
  const frameSize = scaledSize(1920, 1080);
  const run = async (chunk_bytes) => {
    const ffmpeg = chunkedFfmpeg({ frameSize, total: 74 });
    let calls = 0;
    const exec = async (command, args) => {
      calls++;
      await ffmpeg(args);
      return { stdout: '', stderr: '' };
    };
    const faces = await df.analyse_shot('v.mp4', indexReadingDetector(), 3, 40, 0.8, 1920, 1080, 1.5, 0.5, 2, {
      shot_frames: (...a) => df.shot_frames({ exec, chunk_bytes }, ...a),
    });
    return { faces, calls };
  };
  const one = await run(frameSize * 1000);
  const many = await run(frameSize * 3);
  assert.equal(one.calls, 1);
  assert.equal(many.calls, 37);
  assert.deepEqual(many.faces, one.faces);
  assert.equal(one.faces[0].track.length, 74);
  assert.deepEqual(one.faces[0].track.map((p) => p.t).slice(0, 3), [0, 0.5, 1]);
});

const run = (command, args) =>
  new Promise((ok, fail) =>
    execFile(command, args, { env: toolEnv(), maxBuffer: 64 << 20, windowsHide: true }, (e, stdout, stderr) => (e ? fail(Object.assign(e, { stderr })) : ok({ stdout, stderr }))),
  );
const ffmpegPresent = await run('ffmpeg', ['-version']).then(() => true, () => false);

/** md5 of each `frameSize` frame in `buf`, in order. */
const frameHashes = (buf, frameSize) => {
  const out = [];
  for (let k = 0; k + frameSize <= buf.length; k += frameSize) out.push(createHash('md5').update(buf.subarray(k, k + frameSize)).digest('hex'));
  return out;
};

test('real ffmpeg: a shot sampled in chunks is frame for frame the one-pass sampling, with audio, below zero, video late', { skip: !ffmpegPresent && 'no ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-faces-chunks-'));
  try {
    const plain = join(dir, 'b frames.mp4');
    const withAudio = join(dir, 'with audio.mp4');
    const cut = join(dir, 'cut.mp4');
    const late = join(dir, 'late.mp4');
    const src = ['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30000/1001', '-t', '24'];
    const h264 = ['-c:v', 'libx264', '-bf', '3', '-g', '48', '-pix_fmt', 'yuv420p'];
    await run('ffmpeg', ['-v', 'error', '-y', ...src, ...h264, plain]);
    // A second stream is what made ffmpeg's default output mode constant-rate (a chunk then came out as copies of
    // its first frame); hosted's windows all carry the source's audio.
    await run('ffmpeg', ['-v', 'error', '-y', ...src, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', ...h264, '-c:a', 'aac', '-shortest', withAudio]);
    // Cut the way hosted's extractArgs cuts a window (`-ss -to -i -c copy`): the cut opens on the keyframe before
    // 5.3 s, so its first packets are stamped below zero, as the E2 gate's real windows were (-3.52 s).
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', '5.3', '-to', '21.9', '-i', withAudio, '-c', 'copy', cut]);
    // Video starting 1.5 s after the audio: the one-pass output opens with copies of its first frame.
    await run('ffmpeg', ['-v', 'error', '-y', '-itsoffset', '1.5', '-i', plain, '-f', 'lavfi', '-i', 'sine=duration=24', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', late]);

    const firstPts = async (file) =>
      Number((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', '-read_intervals', '%+#1', file])).stdout.trim().split(/\s+/)[0]);
    const streams = async (file) =>
      (await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file])).stdout.trim().split(/\s+/).sort();
    assert.ok((await firstPts(cut)) < 0, 'the stream-copied cut starts below zero');
    for (const f of [withAudio, cut, late]) assert.deepEqual(await streams(f), ['audio', 'video'], f);

    const frameSize = 160 * 90 * 3;
    const cases = [
      // [video, start, end, count, chunk_frames]
      [plain, 0.73, 11.1, 23, 2], [plain, 3, 9, 12, 5], [plain, 0, 12, 30, 1],
      [withAudio, 0, 16.4, 33, 5], [withAudio, 2.37, 21.5, 38, 4],
      [cut, 0, 16.6, 33, 5], [cut, 0, 16.6, 33, 23], [cut, 4.21, 16.6, 25, 3],
      [late, 0, 12.2, 24, 5], [late, 6.1, 20, 28, 6],
      // The E2 gate's shot whose 34th stamp (16.349665 s) falls 2 microseconds inside -t: the one pass ends at 33
      // (its -t trim counts from the shot's first frame) and a chunk must too. The stamps depend only on the rate.
      [plain, 0, 16.349667, 33, 5], [withAudio, 0, 16.349667, 33, 23], [cut, 0, 16.349667, 33, 10],
    ];
    for (const [video, start, end, count, chunk_frames] of cases) {
      const what = `${video.split(/[\\/]/).at(-1)} ${start}-${end} @${count}, ${chunk_frames} a chunk`;
      const one = join(dir, 'one.rgb');
      const { argv } = df.shot_frames_command(video, start, end, 160, 90, count, one);
      await run(argv[0], argv.slice(1));
      const want = frameHashes(await readFile(one), frameSize);
      rmSync(one);
      const got = [];
      const work = join(dir, 'work');
      mkdirSync(work);
      let calls = 0;
      const counted = (command, args) => {
        calls++;
        return run(command, args);
      };
      for await (const [index, frame] of df.shot_frames({ exec: counted, dir: work, chunk_bytes: frameSize * (chunk_frames + 1) }, video, start, end, 160, 90, count)) {
        assert.equal(index, got.length);
        got.push(createHash('md5').update(frame.data).digest('hex'));
      }
      assert.deepEqual(readdirSync(work), []);
      rmSync(work, { recursive: true });
      assert.ok(calls > 1, `${what}: sampled in more than one chunk`);
      assert.equal(want.length, count, `${what}: the one pass yields the shot's sample count`);
      assert.deepEqual(got, want, `${what}: frames differ`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectShotFaces: no space for the frames (ffmpeg says so, or ENOSPC) gives {unavailable}, and the frames dir is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-faces-test-'));
  try {
    const answer = [{ score: 0.95, box: [0.4, 0.3, 0.2, 0.36], keypoints: null }];
    for (const fail of [
      async (args) => {
        await writeFile(args.at(-1), Buffer.alloc(scaledSize(1280, 720) * 2, 9));
        throw Object.assign(new Error('Command failed: ffmpeg'), { stderr: '[out#0/rawvideo @ 0x1] Error muxing a packet\nav_interleaved_write_frame(): No space left on device\n' });
      },
      async () => {
        throw Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' });
      },
    ]) {
      const exec = async (command, args) => {
        if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ width: 1280, height: 720 }] }), stderr: '' };
        return fail(args);
      };
      const out = await detectShotFaces({ file: 'clip.mp4', shots: [{ startSec: 0, endSec: 6 }], exec, dir, detector: scriptedDetector(Array(12).fill(answer)) });
      assert.equal(out.unavailable, true);
      assert.match(out.reason, /^the face frames could not be written: (ENOSPC )?.*(No space left on device|write ENOSPC)/);
      assert.deepEqual(readdirSync(dir), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the frames dir is empty after success, an ffmpeg failure and a detector failure; an own temp dir is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boqo-faces-test-'));
  const own = () => readdirSync(tmpdir()).filter((n) => n.startsWith('boqo-faces-') && !n.startsWith('boqo-faces-test-')).sort();
  try {
    const before = own();
    const shots = [{ startSec: 0, endSec: 6 }, { startSec: 6, endSec: 9 }];
    const calls = [];
    const ok = await detectShotFaces({ file: 'clip.mp4', shots, exec: fakeTools({ width: 640, height: 360, frames: 12, calls }), dir, detector: indexReadingDetector() });
    assert.equal(ok.shots.length, 2);
    assert.deepEqual(readdirSync(dir), []);

    const broken = async (command, args) => {
      if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ width: 640, height: 360 }] }), stderr: '' };
      await writeFile(args.at(-1), Buffer.alloc(scaledSize(640, 360) * 3, 1));
      throw Object.assign(new Error('Command failed: ffmpeg'), { stderr: 'clip.mp4: Invalid data found when processing input' });
    };
    await assert.rejects(() => detectShotFaces({ file: 'clip.mp4', shots, exec: broken, dir, detector: indexReadingDetector() }), /ffmpeg failed sampling clip\.mp4 \[0\.0,6\.0\]: clip\.mp4: Invalid data/);
    assert.deepEqual(readdirSync(dir), []);

    let n = 0;
    const flaky = { process: async (image) => { if (++n === 5) throw new Error('ORT run failed'); return indexReadingDetector().process(image); } };
    const unavailable = await detectShotFaces({ file: 'clip.mp4', shots, exec: fakeTools({ width: 640, height: 360, frames: 12, calls }), dir, detector: flaky });
    assert.equal(unavailable.unavailable, true);
    assert.deepEqual(readdirSync(dir), []);

    // without `dir`, each shot's own temporary directory goes too
    await detectShotFaces({ file: 'clip.mp4', shots, exec: fakeTools({ width: 640, height: 360, frames: 12, calls }), detector: indexReadingDetector() });
    await assert.rejects(() => detectShotFaces({ file: 'clip.mp4', shots, exec: broken, detector: indexReadingDetector() }));
    assert.deepEqual(own(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
