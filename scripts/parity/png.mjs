// A minimal PNG reader and writer for the face parity tooling (tests/blazeface.test.mjs, scripts/parity/faces-compare.mjs,
// scripts/parity/make-face-fixture.mjs). Reads 8-bit, non-interlaced greyscale, RGB and RGBA; alpha is dropped
// without compositing, which is what OpenCV's IMREAD_COLOR does on the Python side of faces-compare. Writes 8-bit RGB.
// Always returns `{ width, height, data }` with `data` packed RGB24, rows top to bottom.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {{ width: number, height: number, data: Uint8Array }} image packed RGB24 */
export function encodePng({ width, height, data }) {
  if (data.length !== width * height * 3) throw new Error(`encodePng: expected ${width * height * 3} bytes, got ${data.length}`);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** @param {Uint8Array} bytes a PNG file */
export function decodePng(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng: not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8) throw new Error(`decodePng: bit depth ${depth} is not supported`);
      if (data[12] !== 0) throw new Error('decodePng: interlaced PNGs are not supported');
      if (![0, 2, 6].includes(colorType)) throw new Error(`decodePng: colour type ${colorType} is not supported`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`decodePng: unknown filter ${filter}`);
      px[y * stride + x] = v & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = px[i];
    else for (let k = 0; k < 3; k++) data[i * 3 + k] = px[i * channels + k];
  }
  return { width, height, data };
}
