#!/usr/bin/env node
// node scripts/parity/make-face-fixture.mjs [--out tests/fixtures/face-synthetic.png] [--size 256]
//   Draws tests/fixtures/face-synthetic.png, the face tests/blazeface.test.mjs detects: a frontal head made only of
//   shaded ellipses and strokes (skin, hair, ears, eyes, brows, nose, lips, neck, shoulders) on a plain background.
//   Nobody's likeness and no photograph: every pixel comes from the numbers below, so the file is reproducible
//   byte for byte from this script (and needs no licence). Deterministic: no randomness, no clock.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SS = 4; // supersamples per axis

/** A canvas in linear 0..1 RGB, painted with coverage-weighted alpha. */
function canvas(size, top, bottom) {
  const px = new Float64Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) px[(y * size + x) * 3 + c] = top[c] * (1 - t) + bottom[c] * t;
  }
  return { size, px };
}

/**
 * Paints `inside(u, v)` (u, v in 0..1 canvas units), colour `color(u, v)` (0..1 RGB), at `opacity`, within the
 * bounding box [x0, x1] x [y0, y1] (canvas units).
 */
function paint(cv, [x0, y0, x1, y1], inside, color, opacity = 1) {
  const { size, px } = cv;
  const lo = (v) => Math.max(0, Math.floor(v * size));
  const hi = (v) => Math.min(size - 1, Math.ceil(v * size));
  for (let y = lo(y0); y <= hi(y1); y++) {
    for (let x = lo(x0); x <= hi(x1); x++) {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const u = (x + (i + 0.5) / SS) / size;
          const v = (y + (j + 0.5) / SS) / size;
          if (!inside(u, v)) continue;
          const c = color(u, v);
          n++;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      if (!n) continue;
      const a = (n / (SS * SS)) * opacity;
      const k = (y * size + x) * 3;
      px[k] = px[k] * (1 - a) + (r / n) * a;
      px[k + 1] = px[k + 1] * (1 - a) + (g / n) * a;
      px[k + 2] = px[k + 2] * (1 - a) + (b / n) * a;
    }
  }
}

const ellipse = (cx, cy, rx, ry) => ({
  box: [cx - rx, cy - ry, cx + rx, cy + ry],
  inside: (u, v) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1,
  // 0 at the centre, 1 on the rim
  r: (u, v) => Math.sqrt(((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2),
});

/** A stroke along a quadratic arc from (ax, ay) through control (qx, qy) to (bx, by), `w` wide. */
function arc(ax, ay, qx, qy, bx, by, w) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * qx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * qy + t * t * by, t]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    box: [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w],
    inside: (u, v) => pts.some(([x, y, t]) => (u - x) ** 2 + (v - y) ** 2 <= (w * (0.55 + 0.45 * Math.sin(Math.PI * t))) ** 2),
  };
}

const mix = (a, b, t) => a.map((x, i) => x * (1 - t) + b[i] * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export function drawFace(size = 256) {
  const SKIN = [0.87, 0.67, 0.53];
  const SHADE = [0.62, 0.42, 0.31];
  const HAIR = [0.17, 0.11, 0.07];
  const cv = canvas(size, [0.55, 0.62, 0.7], [0.34, 0.4, 0.48]);

  // shoulders and shirt, then the neck
  const torso = ellipse(0.5, 1.12, 0.46, 0.3);
  paint(cv, torso.box, torso.inside, (u, v) => mix([0.2, 0.3, 0.45], [0.12, 0.18, 0.3], clamp01((v - 0.85) / 0.3)));
  const neck = ellipse(0.5, 0.8, 0.11, 0.16);
  paint(cv, neck.box, neck.inside, (u) => mix(SKIN, SHADE, clamp01(Math.abs(u - 0.5) / 0.11) * 0.8));

  // hair behind the head
  const back = ellipse(0.5, 0.42, 0.25, 0.3);
  paint(cv, back.box, back.inside, () => HAIR);

  // ears
  for (const side of [-1, 1]) {
    const ear = ellipse(0.5 + side * 0.205, 0.5, 0.035, 0.065);
    paint(cv, ear.box, ear.inside, (u, v) => mix(SKIN, SHADE, 0.35 + 0.4 * ear.r(u, v)));
  }

  // the head: lit from the front-left, darker towards the rim and the jaw
  const head = ellipse(0.5, 0.49, 0.2, 0.26);
  paint(cv, head.box, head.inside, (u, v) => {
    const rim = head.r(u, v) ** 3;
    const light = clamp01(0.5 - (u - 0.47) * 1.2 - (v - 0.45) * 0.5);
    return mix(mix(SKIN, SHADE, rim * 0.75), [0.96, 0.8, 0.68], light * 0.35);
  });

  // fringe over the forehead
  const fringe = ellipse(0.5, 0.25, 0.22, 0.1);
  paint(cv, fringe.box, (u, v) => fringe.inside(u, v) && v < 0.3 - 0.05 * Math.cos((u - 0.5) * 6), () => HAIR);

  // brows
  for (const brow of [arc(0.355, 0.405, 0.4, 0.375, 0.455, 0.395, 0.013), arc(0.545, 0.395, 0.6, 0.375, 0.645, 0.405, 0.013)]) {
    paint(cv, brow.box, brow.inside, () => HAIR);
  }

  // eyes: socket shadow, white, iris, pupil, catch-light, upper lid
  for (const cx of [0.41, 0.59]) {
    const socket = ellipse(cx, 0.445, 0.062, 0.034);
    paint(cv, socket.box, socket.inside, () => SHADE, 0.45);
    const white = ellipse(cx, 0.448, 0.045, 0.019);
    paint(cv, white.box, white.inside, () => [0.95, 0.94, 0.92]);
    const iris = ellipse(cx, 0.448, 0.018, 0.018);
    paint(cv, iris.box, (u, v) => iris.inside(u, v) && white.inside(u, v), (u, v) => mix([0.36, 0.22, 0.12], [0.18, 0.1, 0.05], iris.r(u, v)));
    const pupil = ellipse(cx, 0.448, 0.008, 0.008);
    paint(cv, pupil.box, pupil.inside, () => [0.03, 0.02, 0.02]);
    const glint = ellipse(cx - 0.006, 0.442, 0.004, 0.004);
    paint(cv, glint.box, glint.inside, () => [1, 1, 1]);
    const lid = arc(cx - 0.048, 0.45, cx, 0.418, cx + 0.048, 0.45, 0.005);
    paint(cv, lid.box, lid.inside, () => [0.12, 0.07, 0.05]);
  }

  // nose: a shaded bridge, the tip's light, the nostrils
  const bridge = ellipse(0.5, 0.52, 0.03, 0.075);
  paint(cv, bridge.box, bridge.inside, (u) => mix(SKIN, SHADE, clamp01((u - 0.49) / 0.03)), 0.55);
  const tip = ellipse(0.497, 0.575, 0.03, 0.022);
  paint(cv, tip.box, tip.inside, () => [0.93, 0.74, 0.6], 0.8);
  for (const cx of [0.477, 0.523]) {
    const nostril = ellipse(cx, 0.592, 0.011, 0.007);
    paint(cv, nostril.box, nostril.inside, () => [0.3, 0.17, 0.12]);
  }

  // mouth: upper and lower lip, the line between
  const upper = ellipse(0.5, 0.655, 0.06, 0.016);
  paint(cv, upper.box, upper.inside, () => [0.66, 0.3, 0.3]);
  const lower = ellipse(0.5, 0.675, 0.052, 0.019);
  paint(cv, lower.box, lower.inside, () => [0.74, 0.38, 0.37]);
  const line = arc(0.44, 0.662, 0.5, 0.672, 0.56, 0.662, 0.004);
  paint(cv, line.box, line.inside, () => [0.3, 0.12, 0.12]);

  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp01(cv.px[i]) * 255);
  return { width: size, height: size, data };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, size: { type: 'string' } } });
  const out = resolve(values.out ?? join(root, 'tests/fixtures/face-synthetic.png'));
  writeFileSync(out, encodePng(drawFace(Number(values.size ?? 256))));
  process.stdout.write(`${out}\n`);
}
