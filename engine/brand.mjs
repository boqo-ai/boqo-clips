// The brand kit: colours, font, caption look and logo, saved once under
// $BOQO_HOME/brands/<name>/ and shared by every boqo skill.
//   brand.json         the kit (logo.file is the bare file name)
//   logo.png|logo.jpg  at most one logo
//   ../default.txt     the name of the default kit
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';

export const FONTS = ['Inter', 'Anton'];
export const PRESETS = ['karaoke', 'punch', 'clean', 'highlight'];
export const CORNERS = ['tl', 'tr', 'bl', 'br'];
const NAME_RE = /^[A-Za-z0-9 _-]{1,40}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const LOGO_NAMES = ['logo.png', 'logo.jpg'];

export const boqoHome = () => process.env.BOQO_HOME || join(homedir(), '.boqo');
export const brandsDir = () => join(boqoHome(), 'brands');
const kitDir = (name) => join(brandsDir(), name);
const defaultFile = () => join(brandsDir(), 'default.txt');

export function defaultBrand(name) {
  return {
    name,
    colors: { text: '#FFFFFF', accent: '#C8FF4D' },
    font: 'Inter',
    captions: { preset: 'karaoke', position: 0.72, size: 1.0 },
    logo: { file: null, corner: 'tr', scale: 0.16 },
    hook: true,
  };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const inRange = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

// Missing sections and fields fall back to defaultBrand; wrong values are errors.
// Every error is collected, not just the first.
export function validateBrand(b) {
  if (!isObj(b)) return { ok: false, errors: ['brand must be an object'] };
  const errors = [];
  const name = typeof b.name === 'string' ? b.name.trim() : b.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    errors.push('name must be 1-40 characters: letters, digits, space, _ or -');
  }
  const d = defaultBrand(typeof name === 'string' ? name : '');
  const section = (key) => {
    if (b[key] === undefined) return {};
    if (!isObj(b[key])) {
      errors.push(`${key} must be an object`);
      return {};
    }
    return b[key];
  };
  const colors = { ...d.colors, ...section('colors') };
  for (const k of ['text', 'accent']) {
    if (typeof colors[k] !== 'string' || !HEX_RE.test(colors[k])) errors.push(`colors.${k} must be a hex colour like #C8FF4D`);
    else colors[k] = colors[k].toUpperCase();
  }
  const font = b.font === undefined ? d.font : b.font;
  if (!FONTS.includes(font)) errors.push(`font must be one of ${FONTS.join(', ')}`);
  const captions = { ...d.captions, ...section('captions') };
  if (!PRESETS.includes(captions.preset)) errors.push(`captions.preset must be one of ${PRESETS.join(', ')}`);
  if (!inRange(captions.position, 0.1, 0.9)) errors.push('captions.position must be a number from 0.1 to 0.9');
  if (!inRange(captions.size, 0.7, 1.4)) errors.push('captions.size must be a number from 0.7 to 1.4');
  const logo = { ...d.logo, ...section('logo') };
  if (logo.file !== null && (typeof logo.file !== 'string' || logo.file === '')) errors.push('logo.file must be a file name or null');
  if (!CORNERS.includes(logo.corner)) errors.push(`logo.corner must be one of ${CORNERS.join(', ')}`);
  if (!inRange(logo.scale, 0.08, 0.3)) errors.push('logo.scale must be a number from 0.08 to 0.3');
  const hook = b.hook === undefined ? d.hook : b.hook;
  if (typeof hook !== 'boolean') errors.push('hook must be true or false');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    brand: {
      name,
      colors: { text: colors.text, accent: colors.accent },
      font,
      captions: { preset: captions.preset, position: captions.position, size: captions.size },
      logo: { file: logo.file, corner: logo.corner, scale: logo.scale },
      hook,
    },
  };
}

function checkName(name) {
  const n = typeof name === 'string' ? name.trim() : name;
  if (typeof n !== 'string' || !NAME_RE.test(n)) {
    throw new Error('brand name must be 1-40 characters: letters, digits, space, _ or -');
  }
  return n;
}

const exists = (p) => stat(p).then((s) => s.isFile(), () => false);

function logoFileName(src) {
  const ext = extname(src).toLowerCase();
  if (ext === '.png') return 'logo.png';
  if (ext === '.jpg' || ext === '.jpeg') return 'logo.jpg';
  throw new Error(`logo must be a PNG or JPG file (got ${extname(src) || 'no extension'})`);
}

// Saves the kit and, when logoSrc (a local path) is given, copies the logo in as
// logo.png / logo.jpg. Returns the kit folder. The first kit saved becomes the default.
export async function saveBrand(b, logoSrc) {
  const v = validateBrand(b);
  if (!v.ok) throw new Error(`invalid brand: ${v.errors.join('; ')}`);
  const brand = v.brand;
  const dir = kitDir(brand.name);

  // work out the logo before touching the disk, so a failed save changes nothing
  let copyFrom = null;
  let fileName = null;
  if (logoSrc) {
    fileName = logoFileName(logoSrc);
    if (!(await exists(logoSrc))) throw new Error(`logo file not found: ${logoSrc}`);
    copyFrom = logoSrc;
  } else if (brand.logo.file !== null) {
    const given = brand.logo.file;
    if (isAbsolute(given)) {
      fileName = logoFileName(given);
      if (!(await exists(given))) throw new Error(`logo file not found: ${given}`);
      if (given !== join(dir, fileName)) copyFrom = given; // already the kit's own file: keep it
    } else {
      if (!LOGO_NAMES.includes(given) || !(await exists(join(dir, given)))) {
        throw new Error(`logo file not found in the kit: ${given}; pass the image as the logo source`);
      }
      fileName = given;
    }
  }

  await mkdir(dir, { recursive: true });
  if (copyFrom) await copyFile(copyFrom, join(dir, fileName));
  for (const other of LOGO_NAMES) if (other !== fileName) await rm(join(dir, other), { force: true });
  brand.logo.file = fileName;
  await writeFile(join(dir, 'brand.json'), JSON.stringify(brand, null, 2) + '\n');
  if (!(await exists(defaultFile()))) await writeFile(defaultFile(), brand.name + '\n');
  return dir;
}

export async function defaultBrandName() {
  try {
    return (await readFile(defaultFile(), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function setDefaultBrand(name) {
  const n = checkName(name);
  if (!(await exists(join(kitDir(n), 'brand.json')))) throw new Error(`no brand kit named "${n}"`);
  await mkdir(brandsDir(), { recursive: true });
  await writeFile(defaultFile(), n + '\n');
  return n;
}

// The kit by name, or the default kit. logo.file comes back as an absolute path.
export async function loadBrand(name) {
  let n;
  if (name === undefined) {
    n = await defaultBrandName();
    if (!n) throw new Error('no brand kit saved yet');
  } else {
    n = checkName(name);
  }
  let text;
  try {
    text = await readFile(join(kitDir(n), 'brand.json'), 'utf8');
  } catch {
    throw new Error(`no brand kit named "${n}"`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`brand kit "${n}" is damaged: brand.json is not valid JSON`);
  }
  const v = validateBrand({ ...raw, name: n });
  if (!v.ok) throw new Error(`brand kit "${n}" is damaged: ${v.errors.join('; ')}`);
  const brand = v.brand;
  if (brand.logo.file !== null) {
    const abs = join(kitDir(n), basename(brand.logo.file));
    brand.logo.file = (await exists(abs)) ? abs : null;
  }
  return brand;
}

export async function listBrands() {
  let entries;
  try {
    entries = await readdir(brandsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const e of entries) {
    if (e.isDirectory() && (await exists(join(brandsDir(), e.name, 'brand.json')))) names.push(e.name);
  }
  return names.sort();
}
