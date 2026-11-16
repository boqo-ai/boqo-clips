// Synthetic frames for the face parity checks: tests/fixtures/face-synthetic.png placed, flipped, halved and
// doubled-up on plain backgrounds at the frame sizes that matter (16:9 and wider ones the production path tiles,
// a portrait one, sizes whose letterbox lands the sampler on half steps). Integer arithmetic only, so every OS
// builds the same pixels. Used by tests/blazeface.test.mjs and scripts/parity/faces-compare.mjs --synthetic.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';

export const FIXTURE = fileURLToPath(new URL('../../tests/fixtures/face-synthetic.png', import.meta.url));

function background(width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 3;
      data[k] = 70 + ((x * 31) % 40);
      data[k + 1] = 84 + ((y * 17) % 30);
      data[k + 2] = 104 + (((x + y) * 7) % 24);
    }
  }
  return { width, height, data };
}

function paste(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
      dst.data.set(src.data.subarray((y * src.width + x) * 3, (y * src.width + x) * 3 + 3), (Y * dst.width + X) * 3);
    }
  }
  return dst;
}

function mirror(img) {
  const data = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) data.set(img.data.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3), (y * img.width + img.width - 1 - x) * 3);
  }
  return { ...img, data };
}

/** A 2x2 box average, rounded half up, in integers. */
function half(img) {
  const width = img.width >> 1;
  const height = img.height >> 1;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const p = (xx, yy) => img.data[(yy * img.width + xx) * 3 + c];
        data[(y * width + x) * 3 + c] = (p(2 * x, 2 * y) + p(2 * x + 1, 2 * y) + p(2 * x, 2 * y + 1) + p(2 * x + 1, 2 * y + 1) + 2) >> 2;
      }
    }
  }
  return { width, height, data };
}

/** @returns {{ name: string, image: { width: number, height: number, data: Uint8Array } }[]} */
export function syntheticFrames(face = decodePng(readFileSync(FIXTURE))) {
  return [
    { name: '00-face-256x256', image: face },
    { name: '01-face-in-962x541', image: paste(background(962, 541), face, 353, 142) },
    { name: '02-face-in-541x962', image: paste(background(541, 962), face, 140, 300) },
    { name: '03-face-left-in-1280x720', image: paste(background(1280, 720), face, 100, 230) },
    { name: '04-face-on-seam-in-1280x720', image: paste(background(1280, 720), face, 500, 200) },
    { name: '05-half-face-in-640x360', image: paste(background(640, 360), half(face), 60, 100) },
    { name: '06-two-faces-in-1280x544', image: paste(paste(background(1280, 544), face, 150, 140), mirror(face), 880, 150) },
    { name: '07-mirrored-face-in-854x480', image: paste(background(854, 480), mirror(face), 300, 112) },
    { name: '08-face-in-333x517', image: paste(background(333, 517), face, 40, 120) },
    { name: '09-empty-1280x720', image: background(1280, 720) },
  ];
}
