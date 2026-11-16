import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  brandsDir,
  defaultBrand,
  defaultBrandV1,
  listBrands,
  legacyView,
  loadBrand,
  migrateV1,
  saveBrand,
  setDefaultBrand,
  validateBrand,
} from '../engine/brand.mjs';
import { DEFAULT_TEMPLATE_CAPTIONS } from '../engine/captions.mjs';
import { DEFAULT_TEMPLATE_HEADLINE, DEFAULT_TEMPLATE_LOGO } from '../engine/headline.mjs';
import { HEADLINE_STYLE_KEYS } from '../engine/boqo/headline-styles.mjs';
import { DEFAULT_HEADLINE } from '../engine/boqo/headline.mjs';
import { GALLERY_CAPTION_STYLES, GALLERY_CAPTION_STYLE_KEYS } from '../engine/boqo/caption-styles.mjs';

const CLI = fileURLToPath(new URL('../tools/brand.mjs', import.meta.url));

// a real 1x1 PNG and a JPEG header, generated in memory (no binary files in the repo)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'boqo-brand-'));
  process.env.BOQO_HOME = home;
  return home;
}
const mk = (over = {}) => ({ ...defaultBrand('mine'), ...over });

test("defaultBrand('x').captions is boqo's Default template's captions", () => {
  assert.deepEqual(defaultBrand('x').captions, DEFAULT_TEMPLATE_CAPTIONS);
  assert.deepEqual(defaultBrand('x').captions, { style: 'punch', accentColours: ['#E900FA'], positionFraction: 0.7 });
});

test("defaultBrand is the Default template: lime title plate for 12 s, logo bottom-left, no file", () => {
  const { key, ...logo } = DEFAULT_TEMPLATE_LOGO;
  assert.deepEqual(defaultBrand('x'), {
    version: 2,
    name: 'x',
    ratio: '9:16',
    captions: DEFAULT_TEMPLATE_CAPTIONS,
    headline: DEFAULT_TEMPLATE_HEADLINE,
    logo: { file: null, ...logo },
  });
  assert.equal(defaultBrand('x').headline.timing.holdSec, 12);
  assert.deepEqual(
    { ...defaultBrand('x').logo },
    { file: null, anchor: 'bottom-left', width: 0.1, marginX: 0.0854, marginY: 0.06, opacity: 0.35, timing: { kind: 'whole' } },
  );
  assert.equal(key, 'logo');
});

test('defaultBrand hands out copies: editing one does not change the next', () => {
  const a = defaultBrand('a');
  a.captions.accentColours.push('#000000');
  a.headline.timing.holdSec = 1;
  a.logo.timing.kind = 'window';
  const b = defaultBrand('b');
  assert.deepEqual(b.captions, DEFAULT_TEMPLATE_CAPTIONS);
  assert.equal(b.headline.timing.holdSec, 12);
  assert.equal(b.logo.timing.kind, 'whole');
});

test('brandsDir follows BOQO_HOME', () => {
  const home = tempHome();
  assert.equal(brandsDir(), join(home, 'brands'));
});

test('validateBrand accepts the default and upper-cases nothing it does not own', () => {
  const r = validateBrand(mk());
  assert.equal(r.ok, true);
  assert.deepEqual(r.brand, defaultBrand('mine'));
  assert.equal(r.brand.version, 2);
});

test('validateBrand takes a kit with no version as v2 when it has no v1 keys', () => {
  const r = validateBrand({ name: 'tiny', captions: { style: 'neon' } });
  assert.equal(r.ok, true, r.errors?.join(' | '));
  assert.equal(r.brand.version, 2);
  assert.deepEqual(r.brand.captions, { style: 'neon' });
  assert.deepEqual(r.brand.headline, DEFAULT_TEMPLATE_HEADLINE);
  assert.deepEqual(validateBrand({ name: 'tiny' }).brand, defaultBrand('tiny'));
});

test('validateBrand collects every error', () => {
  const r = validateBrand({
    version: 2,
    name: 'mine',
    ratio: '4:3',
    captions: { style: 'disco', accentColours: ['red'], positionFraction: 0.95 },
    headline: { ...DEFAULT_TEMPLATE_HEADLINE, style: 'wavy', plateColour: 'lime' },
    logo: { file: null, anchor: 'middle', width: 0.9, marginX: 2, marginY: -1, opacity: 0, timing: { kind: 'sometimes' } },
  });
  assert.equal(r.ok, false);
  for (const word of [
    'ratio',
    'captions.style',
    'captions.accentColours',
    'captions.positionFraction',
    'headline.style',
    'headline.plateColour',
    'logo.anchor',
    'logo.width',
    'logo.marginX',
    'logo.marginY',
    'logo.opacity',
    'logo.timing',
  ]) {
    assert.ok(r.errors.some((e) => e.includes(word)), `no error about ${word}: ${r.errors.join(' | ')}`);
  }
});

test('validateBrand rejects each out-of-range value on its own', () => {
  const bad = [
    ['ratio', mk({ ratio: '16:9' })],
    ['bad hex', mk({ captions: { style: 'punch', accentColours: ['#GGGGGG'] } })],
    ['three accents', mk({ captions: { style: 'punch', accentColours: ['#111111', '#222222', '#333333'] } })],
    ['position low', mk({ captions: { positionFraction: 0.05 } })],
    ['position high', mk({ captions: { positionFraction: 0.91 } })],
    ['size low', mk({ captions: { sizeScale: 0.6 } })],
    ['size high', mk({ captions: { sizeScale: 1.41 } })],
    ['style', mk({ captions: { style: 'bold' } })],
    ['style illustrated (not in the gallery)', mk({ captions: { style: 'illustrated' } })],
    ['caption font', mk({ captions: { font: { kind: 'builtin', name: 'Comic Sans' } } })],
    ['speed', mk({ captions: { speed: 3 } })],
    ['headline source', mk({ headline: { ...DEFAULT_TEMPLATE_HEADLINE, source: 'caption' } })],
    ['headline style', mk({ headline: { ...DEFAULT_TEMPLATE_HEADLINE, style: 'wavy' } })],
    ['headline position', mk({ headline: { ...DEFAULT_TEMPLATE_HEADLINE, positionFraction: 0.99 } })],
    ['headline plate opacity', mk({ headline: { ...DEFAULT_TEMPLATE_HEADLINE, plateOpacity: 0.5 } })],
    ['headline font', mk({ headline: { ...DEFAULT_TEMPLATE_HEADLINE, font: { kind: 'builtin', name: 'Comic Sans' } } })],
    ['anchor', mk({ logo: { ...defaultBrand('x').logo, anchor: 'top' } })],
    ['width zero', mk({ logo: { ...defaultBrand('x').logo, width: 0 } })],
    ['width high', mk({ logo: { ...defaultBrand('x').logo, width: 0.51 } })],
    ['opacity low', mk({ logo: { ...defaultBrand('x').logo, opacity: 0.04 } })],
    ['margin', mk({ logo: { ...defaultBrand('x').logo, marginX: 0.46 } })],
    ['timing window hold', mk({ logo: { ...defaultBrand('x').logo, timing: { kind: 'window', startSec: 0, holdSec: 0.1 } } })],
    ['logo file empty', mk({ logo: { ...defaultBrand('x').logo, file: '' } })],
    ['NaN', mk({ captions: { positionFraction: NaN } })],
    ['version', mk({ version: 3 })],
  ];
  for (const [label, b] of bad) {
    const r = validateBrand(b);
    assert.equal(r.ok, false, label);
    assert.equal(r.errors.length, 1, `${label}: ${r.errors.join(' | ')}`);
  }
  for (const v of [0.1, 0.9]) assert.equal(validateBrand(mk({ captions: { style: 'punch', positionFraction: v } })).ok, true);
  for (const style of GALLERY_CAPTION_STYLE_KEYS) assert.equal(validateBrand(mk({ captions: { style } })).ok, true, style);
});

test('validateBrand: headline null and logo null are kept as null', () => {
  const r = validateBrand(mk({ headline: null, logo: null }));
  assert.equal(r.ok, true);
  assert.equal(r.brand.headline, null);
  assert.equal(r.brand.logo, null);
});

test("validateBrand fills a partly given headline's required fields from the Default template, never its optional ones", () => {
  const r = validateBrand({ name: 'h', headline: { plateColour: '#E63946' } });
  assert.equal(r.ok, true, r.errors?.join(' | '));
  const { style, textCase, entrance, ...required } = DEFAULT_TEMPLATE_HEADLINE;
  assert.deepEqual(r.brand.headline, { ...required, plateColour: '#E63946' });
  const o = validateBrand({ name: 'h', headline: { style: 'outline' } });
  assert.equal(o.brand.headline.style, 'outline');
  assert.equal(o.brand.headline.timing.holdSec, 12);
});

test('validateBrand fills a partly given logo from the Default template', () => {
  const r = validateBrand({ name: 'p', logo: { anchor: 'top-right', width: 0.16 } });
  assert.equal(r.ok, true, r.errors?.join(' | '));
  assert.deepEqual(r.brand.logo, { ...defaultBrand('p').logo, anchor: 'top-right', width: 0.16 });
});

test('validateBrand rejects non-objects and unsafe names', () => {
  for (const x of [null, 'brand', 4, [], undefined]) assert.equal(validateBrand(x).ok, false);
  for (const name of ['', '   ', '..', '../x', 'a/b', 'a\\b', 'x'.repeat(41), 'C:evil', 'a.b', 5, undefined]) {
    const r = validateBrand(mk({ name }));
    assert.equal(r.ok, false, `name ${JSON.stringify(name)}`);
    assert.ok(r.errors.some((e) => e.startsWith('name')));
  }
  const ok = validateBrand(mk({ name: '  My Brand_2-b  ' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.brand.name, 'My Brand_2-b');
});

test('validateBrand rejects unknown keys at every level and names them', () => {
  const r = validateBrand({
    version: 2,
    name: 't',
    captons: {},
    captions: { stile: 'punch' },
    headline: { ...DEFAULT_TEMPLATE_HEADLINE, plateColor: '#ffffff' },
    logo: { anchor: 'top-left', anchr: 'top-left' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4, r.errors.join(' | '));
  assert.ok(r.errors.some((e) => e.includes('unknown key "captons"') && e.includes('"captions"')));
  assert.ok(r.errors.some((e) => e.includes('unknown key "stile"') && e.includes('"style"') && e.includes('captions')));
  assert.ok(r.errors.some((e) => e.includes('unknown key "plateColor"') && e.includes('"plateColour"') && e.includes('headline')));
  assert.ok(r.errors.some((e) => e.includes('unknown key "anchr"') && e.includes('"anchor"') && e.includes('logo')));
});

test('a kit that is not a plain object on disk is damaged, not the default', async () => {
  const home = tempHome();
  for (const [i, text] of ['null', '[]', '"brand"', '7', '{"colour":{"accent":"#ff0000"}}'].entries()) {
    await saveBrand(mk({ name: `k${i}` }));
    writeFileSync(join(home, 'brands', `k${i}`, 'brand.json'), text);
    await assert.rejects(loadBrand(`k${i}`), /is damaged/, text);
  }
});

test('a kit whose logo file is gone throws instead of loading without a logo', async () => {
  const home = tempHome();
  const src = join(mkdtempSync(join(tmpdir(), 'boqo-logo-')), 'l.png');
  writeFileSync(src, PNG);
  const dir = await saveBrand(mk(), src);
  rmSync(join(dir, 'logo.png'));
  await assert.rejects(loadBrand('mine'), /brand "mine": logo file logo\.png is missing .* --logo/);
  assert.ok(home);
});

test('a save that fails on its logo leaves the saved kit as it was', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'a.png'), PNG);
  const dir = await saveBrand(mk(), join(d, 'a.png'));
  const before = readFileSync(join(dir, 'brand.json'), 'utf8');
  await assert.rejects(saveBrand(mk({ captions: { style: 'neon' } }), join(d, 'gone.png')), /logo/);
  assert.equal(readFileSync(join(dir, 'brand.json'), 'utf8'), before);
  assert.deepEqual(readdirSync(dir).sort(), ['brand.json', 'logo.png']);
});

test('save then load round-trips under BOQO_HOME', async () => {
  const home = tempHome();
  const b = mk({ captions: { style: 'boldkeys', accentColours: ['#FF5500'], positionFraction: 0.6, baseColour: '#101010' }, headline: null });
  const dir = await saveBrand(b);
  assert.equal(dir, join(home, 'brands', 'mine'));
  assert.ok(existsSync(join(dir, 'brand.json')));
  assert.deepEqual(await loadBrand('mine'), b);
  assert.deepEqual(await listBrands(), ['mine']);
});

test('save refuses an invalid brand with every error in the message', async () => {
  tempHome();
  await assert.rejects(
    saveBrand(mk({ captions: { baseColour: 'x', accentColours: ['y'] } })),
    (e) => /captions\.baseColour/.test(e.message) && /captions\.accentColours/.test(e.message),
  );
  assert.deepEqual(await listBrands(), []);
});

test('default sets what loadBrand() returns', async () => {
  tempHome();
  await saveBrand(mk({ name: 'one' }));
  await saveBrand(mk({ name: 'two', captions: { style: 'neon' } }));
  assert.equal((await loadBrand()).name, 'one', 'the first saved kit becomes the default');
  await setDefaultBrand('two');
  assert.equal((await loadBrand()).name, 'two');
  assert.equal((await loadBrand()).captions.style, 'neon');
  assert.deepEqual(await listBrands(), ['one', 'two']);
});

test('a missing kit throws "no brand kit"', async () => {
  tempHome();
  await assert.rejects(loadBrand(), /no brand kit/);
  await assert.rejects(loadBrand('ghost'), /no brand kit/);
  await assert.rejects(setDefaultBrand('ghost'), /no brand kit/);
  await assert.rejects(loadBrand('../x'), /name/);
  assert.deepEqual(await listBrands(), []);
});

test('a logo path with a space is copied as logo.png and loads as an absolute path', async () => {
  tempHome();
  const src = join(mkdtempSync(join(tmpdir(), 'boqo-logo-')), 'my logo.png');
  writeFileSync(src, PNG);
  const dir = await saveBrand(mk(), src);
  assert.deepEqual(readdirSync(dir).sort(), ['brand.json', 'logo.png']);
  assert.deepEqual(readFileSync(join(dir, 'logo.png')), PNG);
  assert.equal(JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8')).logo.file, 'logo.png');
  const b = await loadBrand('mine');
  assert.ok(isAbsolute(b.logo.file));
  assert.equal(b.logo.file, join(dir, 'logo.png'));
});

test('.jpeg becomes logo.jpg and a new logo replaces the old one', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'a.PNG'), PNG);
  writeFileSync(join(d, 'b.jpeg'), JPG);
  const dir = await saveBrand(mk(), join(d, 'a.PNG'));
  assert.ok(existsSync(join(dir, 'logo.png')));
  await saveBrand(mk(), join(d, 'b.jpeg'));
  assert.deepEqual(readdirSync(dir).sort(), ['brand.json', 'logo.jpg']);
  assert.equal((await loadBrand('mine')).logo.file, join(dir, 'logo.jpg'));
});

test('re-saving a loaded brand keeps its logo; saving with no logo drops it', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'l.png'), PNG);
  const dir = await saveBrand(mk(), join(d, 'l.png'));
  const loaded = await loadBrand('mine');
  await saveBrand({ ...loaded, captions: { style: 'neon' } });
  const again = await loadBrand('mine');
  assert.equal(again.captions.style, 'neon');
  assert.equal(again.logo.file, join(dir, 'logo.png'));
  await saveBrand({ ...again, logo: { ...again.logo, file: null } });
  assert.deepEqual(readdirSync(dir), ['brand.json']);
});

test('a logo that is not PNG/JPG or does not exist is rejected', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'l.svg'), '<svg/>');
  await assert.rejects(saveBrand(mk(), join(d, 'l.svg')), /PNG or JPG/);
  await assert.rejects(saveBrand(mk(), join(d, 'nope.png')), /logo/);
  assert.deepEqual(await listBrands(), [], 'a failed save leaves no kit behind');
});

// ---- v1 kits ----

const v1 = (over = {}) => ({ ...defaultBrandV1('old'), ...over });
const writeKit = (home, name, kit) => {
  mkdirSync(join(home, 'brands', name), { recursive: true });
  const file = join(home, 'brands', name, 'brand.json');
  writeFileSync(file, JSON.stringify(kit, null, 2) + '\n');
  return file;
};

test('migrateV1 on the v1 default: karaoke, the lime accent, 0.72, boqo lime Default headline for 3 s, no logo', () => {
  const m = migrateV1(defaultBrandV1('old'));
  assert.equal(m.version, 2);
  assert.equal(m.name, 'old');
  assert.equal(m.ratio, '9:16');
  assert.equal(m.captions.style, 'karaoke');
  assert.deepEqual(m.captions.accentColours, ['#C8FF4D']);
  assert.equal(m.captions.positionFraction, 0.72);
  assert.equal('baseColour' in m.captions, false, 'white text is the preset own');
  assert.equal('sizeScale' in m.captions, false, 'size 1 is the preset own');
  assert.equal(m.logo.file, null);
  assert.equal(validateBrand(m).ok, true);
});

test('migrateV1: corner and scale become anchor and width, and the v1 render margin carries over', () => {
  const corners = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };
  for (const [corner, anchor] of Object.entries(corners)) {
    const m = migrateV1(v1({ logo: { file: null, corner, scale: 0.16 } }));
    assert.equal(m.logo.anchor, anchor);
    assert.equal(m.logo.width, 0.16);
    assert.equal(m.logo.opacity, 1);
    assert.deepEqual(m.logo.timing, { kind: 'whole' });
    // v1 drew the logo 48 px from the edge on the 1080x1920 frame
    assert.equal(Math.round(m.logo.marginX * 1080), 48);
    assert.equal(Math.round(m.logo.marginY * 1920), 48);
  }
});

test('migrateV1: hook true is the Default headline block with source title, hook false is no headline', () => {
  assert.deepEqual(migrateV1(v1({ hook: true })).headline, { ...DEFAULT_HEADLINE, source: 'title' });
  assert.equal(migrateV1(v1({ hook: true })).headline.timing.holdSec, 3, 'v1 held its hook for 3 s');
  assert.equal(migrateV1(v1({ hook: false })).headline, null);
});

test('migrateV1: font Anton maps to the hosted style that uses Anton, named from caption-styles', () => {
  const anton = GALLERY_CAPTION_STYLES.filter((s) => s.fontName === 'Anton' || s.keyFont === 'Anton').map((s) => s.key);
  assert.deepEqual(anton, ['boldkeys']);
  const m = migrateV1(v1({ font: 'Anton', captions: { preset: 'punch', position: 0.6, size: 1 } }));
  assert.equal(m.captions.style, anton[0]);
  assert.equal(m.captions.positionFraction, 0.6);
  assert.equal(migrateV1(v1({ font: 'Inter', captions: { preset: 'punch', position: 0.6, size: 1 } })).captions.style, 'punch');
});

test('migrateV1: text colour and size are kept when they are not the preset own', () => {
  const m = migrateV1(v1({ colors: { text: '#101010', accent: '#e63946' }, captions: { preset: 'highlight', position: 0.5, size: 1.2 } }));
  assert.equal(m.captions.baseColour, '#101010');
  assert.deepEqual(m.captions.accentColours, ['#E63946']);
  assert.equal(m.captions.sizeScale, 1.2);
  assert.equal(validateBrand(m).ok, true);
});

test('migrateV1 of every v1 value that v1 accepted gives a v2 kit that validates', () => {
  for (const preset of ['karaoke', 'punch', 'clean', 'highlight']) {
    for (const font of ['Inter', 'Anton']) {
      for (const corner of ['tl', 'tr', 'bl', 'br']) {
        for (const hook of [true, false]) {
          const m = migrateV1(v1({ font, hook, captions: { preset, position: 0.1, size: 0.7 }, logo: { file: null, corner, scale: 0.3 } }));
          const r = validateBrand(m);
          assert.equal(r.ok, true, `${preset} ${font} ${corner} ${hook}: ${r.errors?.join(' | ')}`);
        }
      }
    }
  }
});

test('validateBrand takes a v1 kit (version 1, or none with v1 keys) and answers v2; v1 errors keep their wording', () => {
  assert.deepEqual(validateBrand(defaultBrandV1('old')).brand, migrateV1(defaultBrandV1('old')));
  assert.deepEqual(validateBrand({ ...defaultBrandV1('old'), version: 1 }).brand, migrateV1(defaultBrandV1('old')));
  const r = validateBrand({ ...defaultBrandV1('old'), captions: { preset: 'disco', position: 2, size: 1 } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('captions.preset')));
  assert.ok(r.errors.some((e) => e.includes('captions.position')));
});

test('loadBrand of a v1 file answers v2 and does not rewrite the file', async () => {
  const home = tempHome();
  const file = writeKit(home, 'old', { ...defaultBrandV1('old'), name: undefined });
  const before = readFileSync(file);
  const b = await loadBrand('old');
  assert.equal(b.version, 2);
  assert.equal(b.captions.style, 'karaoke');
  assert.deepEqual(b, { ...migrateV1(defaultBrandV1('old')) });
  assert.deepEqual(readFileSync(file), before, 'the file on disk is byte for byte the v1 kit');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, undefined);
  await loadBrand('old');
  assert.deepEqual(readFileSync(file), before);
});

test('a v1 kit with a logo loads its logo as an absolute path and still is not rewritten', async () => {
  const home = tempHome();
  const file = writeKit(home, 'old', { ...defaultBrandV1('old'), logo: { file: 'logo.png', corner: 'bl', scale: 0.2 } });
  writeFileSync(join(home, 'brands', 'old', 'logo.png'), PNG);
  const before = readFileSync(file);
  const b = await loadBrand('old');
  assert.equal(b.logo.file, join(home, 'brands', 'old', 'logo.png'));
  assert.equal(b.logo.anchor, 'bottom-left');
  assert.equal(b.logo.width, 0.2);
  assert.deepEqual(readFileSync(file), before);
});

test('saveBrand writes version 2, and the next edit of a v1 kit writes it as v2', async () => {
  const home = tempHome();
  const dir = await saveBrand(mk());
  const saved = JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(Object.keys(saved), ['version', 'name', 'ratio', 'captions', 'headline', 'logo']);

  const file = writeKit(home, 'old', { ...defaultBrandV1('old'), logo: { file: 'logo.png', corner: 'tr', scale: 0.16 } });
  writeFileSync(join(home, 'brands', 'old', 'logo.png'), PNG);
  const loaded = await loadBrand('old');
  await saveBrand({ ...loaded, captions: { ...loaded.captions, positionFraction: 0.6 } });
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(after.version, 2);
  assert.equal(after.captions.style, 'karaoke');
  assert.equal(after.captions.positionFraction, 0.6);
  assert.equal(after.logo.file, 'logo.png', 'the logo file is the bare name on disk');
  assert.deepEqual(readdirSync(join(home, 'brands', 'old')).sort(), ['brand.json', 'logo.png']);
  assert.deepEqual(await loadBrand('old'), { ...loaded, captions: { ...loaded.captions, positionFraction: 0.6 } });
});

test('saveBrand of a v1 object writes v2; brand.json is replaced atomically (no temp file left)', async () => {
  const home = tempHome();
  const dir = await saveBrand(defaultBrandV1('viaold'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8')).version, 2);
  assert.deepEqual(readdirSync(dir), ['brand.json']);
  assert.ok(home);
});

test('a v2 kit with a null logo and a null headline round-trips', async () => {
  tempHome();
  await saveBrand(mk({ logo: null, headline: null }));
  const b = await loadBrand('mine');
  assert.equal(b.logo, null);
  assert.equal(b.headline, null);
});

test('onboarding.md names every gallery caption style and headline style, in order, and the Anton move; its kits validate', () => {
  const doc = readFileSync(fileURLToPath(new URL('../skills/boqo-clips/onboarding.md', import.meta.url)), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  const keys = (list) => list.map((k) => `\`${k}\``).join(', ');
  assert.ok(flat.includes(keys(GALLERY_CAPTION_STYLE_KEYS)), 'the 15 caption styles, in the gallery order');
  assert.ok(flat.includes(keys(HEADLINE_STYLE_KEYS)), 'the 6 headline styles');
  assert.match(doc, /"font": "Anton"` now draws as `boldkeys`/);
  assert.match(doc, /styles\.jpg/);
  assert.match(doc, /tile=5x3/);
  assert.equal(GALLERY_CAPTION_STYLE_KEYS.length, 15);
  for (const [, json] of doc.matchAll(/```json\n(\{\n[\s\S]*?\n\})\n```/g)) {
    const kit = JSON.parse(json.replaceAll('<name>', 'mine'));
    const r = validateBrand(kit);
    assert.equal(r.ok, true, `${json}: ${r.errors?.join(' | ')}`);
    assert.equal(r.brand.version, 2);
  }
  const sample = validateBrand({ name: 'neon', captions: { style: 'neon', accentColours: ['#E63946'], baseColour: '#101010' } });
  assert.equal(sample.ok, true);
});

test('a logo given with the kit logo null turns the logo on at the Default values', async () => {
  tempHome();
  const src = join(mkdtempSync(join(tmpdir(), 'boqo-logo-')), 'l.png');
  writeFileSync(src, PNG);
  await saveBrand(mk({ logo: null }), src);
  const b = await loadBrand('mine');
  assert.equal(b.logo.anchor, 'bottom-left');
  assert.equal(b.logo.opacity, 0.35);
  assert.ok(isAbsolute(b.logo.file));
});

test('legacyView (until the render reads v2): the v1 fields the render reads, from a v2 kit', () => {
  const v = legacyView({ ...defaultBrand('x'), logo: { ...defaultBrand('x').logo, anchor: 'top-right', width: 0.6 } });
  assert.deepEqual(v, {
    name: 'x',
    colors: { text: '#FFFFFF', accent: '#E900FA' },
    font: 'Inter',
    captions: { preset: 'punch', position: 0.7, size: 1 },
    logo: { file: null, corner: 'tr', scale: 0.3 },
    hook: true,
  });
  assert.equal(legacyView(defaultBrand('x')).logo.corner, 'bl');
  assert.equal(legacyView({ ...defaultBrand('x'), captions: { style: 'neon' }, logo: null, headline: null }).captions.preset, 'karaoke');
  assert.equal(legacyView({ ...defaultBrand('x'), logo: null, headline: null }).hook, false);
  const round = legacyView(migrateV1(defaultBrandV1('x')));
  assert.deepEqual(round, defaultBrandV1('x'));
});

// ---- CLI ----

function run(home, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, BOQO_HOME: home }, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `one stdout line, got: ${r.stdout}`);
  return { status: r.status, json: JSON.parse(lines[0]) };
}

test('CLI: save, list, show, default', () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const json = join(d, 'brand file.json');
  writeFileSync(join(d, 'my logo.png'), PNG);
  writeFileSync(json, JSON.stringify(mk({ name: 'alpha' })));

  let r = run(home, ['list']);
  assert.deepEqual(r, { status: 0, json: { brands: [], default: null } });

  r = run(home, ['save', json, '--logo', join(d, 'my logo.png')]);
  assert.equal(r.status, 0);
  assert.equal(r.json.saved, 'alpha');
  assert.equal(r.json.brand.name, 'alpha');
  assert.ok(isAbsolute(r.json.brand.logo.file));

  writeFileSync(json, JSON.stringify(mk({ name: 'beta', captions: { style: 'neon' } })));
  assert.equal(run(home, ['save', json]).status, 0);

  r = run(home, ['list']);
  assert.deepEqual(r.json, { brands: ['alpha', 'beta'], default: 'alpha' });

  r = run(home, ['show']);
  assert.equal(r.json.brand.name, 'alpha');
  assert.ok(isAbsolute(r.json.brand.logo.file));
  assert.equal(run(home, ['show', 'beta']).json.brand.captions.style, 'neon');

  assert.equal(run(home, ['default', 'beta']).status, 0);
  assert.equal(run(home, ['show']).json.brand.name, 'beta');
  assert.equal(run(home, ['list']).json.default, 'beta');
});

test('CLI: save of a v1 kit file writes v2, and show of an untouched v1 kit answers v2 without rewriting it', () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const json = join(d, 'v1.json');
  writeFileSync(json, JSON.stringify({ ...defaultBrandV1('legacy'), font: 'Anton', hook: false }));
  let r = run(home, ['save', json]);
  assert.equal(r.status, 0, JSON.stringify(r.json));
  assert.equal(r.json.brand.version, 2);
  assert.equal(r.json.brand.captions.style, 'boldkeys');
  assert.equal(r.json.brand.headline, null);
  assert.equal(JSON.parse(readFileSync(join(home, 'brands', 'legacy', 'brand.json'), 'utf8')).version, 2);

  const file = writeKit(home, 'untouched', defaultBrandV1('untouched'));
  const before = readFileSync(file);
  r = run(home, ['show', 'untouched']);
  assert.equal(r.json.brand.version, 2);
  assert.equal(r.json.brand.captions.style, 'karaoke');
  assert.deepEqual(readFileSync(file), before);
});

test('CLI: failures exit 1 with {"error"}', () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const bad = join(d, 'bad.json');
  writeFileSync(bad, JSON.stringify(mk({ captions: { style: 'disco', positionFraction: 2 } })));
  const notJson = join(d, 'nj.json');
  writeFileSync(notJson, '{oops');

  for (const args of [
    ['show'],
    ['show', 'ghost'],
    ['default', 'ghost'],
    ['save', bad],
    ['save', notJson],
    ['save', join(d, 'missing.json')],
    ['save'],
    ['default'],
    ['frobnicate'],
    [],
  ]) {
    const r = run(home, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(typeof r.json.error, 'string', args.join(' '));
  }
  const typo = join(d, 'typo.json');
  writeFileSync(typo, JSON.stringify({ name: 't', color: { accent: '#ff0000' }, fonts: 'Anton' }));
  const t = run(home, ['save', typo]);
  assert.equal(t.status, 1);
  assert.match(t.json.error, /unknown key "color"/);
  assert.match(t.json.error, /unknown key "fonts"/);
  const r = run(home, ['save', bad]);
  assert.match(r.json.error, /captions\.style/);
  assert.match(r.json.error, /captions\.positionFraction/);
});

function serve(routes) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const route = routes[req.url];
      if (!route) {
        res.writeHead(404).end('no');
        return;
      }
      res.writeHead(route.status ?? 200, route.headers ?? {});
      res.end(route.body);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function runAsync(home, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, BOQO_HOME: home } }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, json: JSON.parse(stdout.trim()) });
    });
  });
}

test('CLI: --logo with a URL downloads it (and refuses a 404, a non-image and an oversize file)', async () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const json = join(d, 'b.json');
  writeFileSync(json, JSON.stringify(mk({ name: 'web' })));
  const { srv, base } = await serve({
    '/logo.png': { body: PNG, headers: { 'content-type': 'image/png' } },
    '/noext': { body: JPG },
    '/page': { body: '<html>not an image</html>', headers: { 'content-type': 'text/html' } },
    '/huge.png': { body: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) },
  });
  try {
    let r = await runAsync(home, ['save', json, '--logo', `${base}/logo.png`]);
    assert.equal(r.status, 0, JSON.stringify(r.json));
    assert.deepEqual(readFileSync(join(home, 'brands', 'web', 'logo.png')), PNG);

    r = await runAsync(home, ['save', json, '--logo', `${base}/noext`]);
    assert.equal(r.status, 0, JSON.stringify(r.json));
    assert.deepEqual(readdirSync(join(home, 'brands', 'web')).sort(), ['brand.json', 'logo.jpg']);

    r = await runAsync(home, ['save', json, '--logo', `${base}/missing.png`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /404/);

    r = await runAsync(home, ['save', json, '--logo', `${base}/page`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /PNG or JPG/);

    r = await runAsync(home, ['save', json, '--logo', `${base}/huge.png`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /10 MB/);
  } finally {
    srv.close();
  }
  // the failed saves left the kit as the last good save wrote it
  assert.deepEqual(readdirSync(join(home, 'brands', 'web')).sort(), ['brand.json', 'logo.jpg']);
});
