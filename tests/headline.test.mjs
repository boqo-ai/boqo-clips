// The headline plate and the logo (Task A13, spec §7.5 steps 8 and 9): the ported modules, each held by a golden from
// boqo's own functions (scripts/parity/cases/), the skill's track over them (engine/headline.mjs) held to boqo's own
// steps, and real ffmpeg runs: the headline ASS burned through libass with the bundled fonts, the logo overlaid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fontMetrics } from '../engine/boqo/caption-metrics.mjs';
import { BrandTiming } from '../engine/boqo/brand-timing.mjs';
import {
  BrandHeadline, DEFAULT_HEADLINE, HEADLINE_BOX_MAX, HEADLINE_BOX_MIN, HEADLINE_CAP_CEILING, HEADLINE_CAP_MAX, HEADLINE_CAP_MIN,
  HEADLINE_FIELDS, HEADLINE_GLYPH_BOX_RATIO, HEADLINE_INK_DARK, HEADLINE_INK_LIGHT, HEADLINE_LINE_SPACING_RATIO, HEADLINE_MAX_LINES,
  HEADLINE_MIN_CONTRAST, HEADLINE_PAD_X_RATIO, HEADLINE_PAD_Y_RATIO, HEADLINE_PLATE_OPACITY_MIN, HEADLINE_POSITION_MAX,
  HEADLINE_POSITION_MIN, HEADLINE_RADIUS_MAX, HEADLINE_RADIUS_MIN, HEADLINE_SOURCES, HeadlineSource, contrastRatio, headlineBoxCeiling,
  headlineInk, headlinePlateHeight, headlineStyleFor, headlineText, headlineWindow, relativeLuminance,
} from '../engine/boqo/headline.mjs';
import { HEADLINE_STYLES, HEADLINE_STYLE_KEYS, headlineKnobsFor, headlineStyleFingerprint, headlineStyleTier } from '../engine/boqo/headline-styles.mjs';
import { buildHeadlineAss, buildTextAss, headlinePlate, layoutHeadline, roundedRectPath, stacked, textElementExtent } from '../engine/boqo/headline-ass.mjs';
import { LOGO_FADE_SEC, logoChain, logoFits, logoOverlayPosition, shiftLogoTiming } from '../engine/boqo/brand-logo.mjs';
import { DEFAULT_TEMPLATE_HEADLINE, DEFAULT_TEMPLATE_LOGO, headlineTrack, logoStage } from '../engine/headline.mjs';
import { FONTS_DIR, fontFallbacks, subtitlesFilter, textPassFilter } from '../engine/captions.mjs';
import { toolEnv } from '../engine/env.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));
const golden = (name) => JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), 'utf8'));
const TOL0 = { tol: 0 };
// 'headlineStyleFor' (hosted's call), 'none' (a headline with no style), or a style key (the table's own entry).
const styleOf = (how, headline) => (how === 'headlineStyleFor' ? headlineStyleFor(headline) : how === 'none' ? undefined : HEADLINE_STYLES.find((s) => s.key === how));
const thrown = (f) => { try { return f(); } catch (e) { return { error: e.message }; } };

// ---- the copies against boqo's goldens ----------------------------------------------------------------------------

test('layoutHeadline, headlinePlate and roundedRectPath match boqo: 1, 2 and 3 lines, shrink to fit, overflow (golden layout-headline)', () => {
  const i = input('layout-headline');
  expectGolden('layout-headline', {
    scenarios: i.scenarios.map((s) => {
      const layout = layoutHeadline(s.text, s.headline, s.frame);
      const plate = headlinePlate(layout, s.headline, s.frame, fontMetrics(s.headline.font.name));
      return { name: s.name, layout, plate, path: roundedRectPath(plate.width, plate.height, plate.radius) };
    }),
    paths: i.paths.map(([w, h, r]) => ({ w, h, r, path: roundedRectPath(w, h, r) })),
  }, TOL0);
  // The golden holds each case it is meant to: the line counts and the shrink.
  const at = (name) => golden('layout-headline').scenarios.find((s) => s.name === name).layout;
  assert.deepEqual([at('one 9:16 default'), at('two 9:16 default'), at('three 9:16 default')].map((l) => l.lines.length), [1, 2, 3]);
  assert.equal(at('three 9:16 default').shrunk, true);
  assert.equal(at('three 9:16 default').overflow, false);
  assert.equal(at('two 9:16 default').shrunk, false);
  assert.equal(at('shrink 9:16 default').overflow, true, 'the widest text does not fit at the smallest size and says so');
  assert.equal(at('shrink 1:1 default').shrunk, true);
  assert.equal(at('shrink 1:1 default').overflow, false);
});

test('buildHeadlineAss, buildTextAss, stacked and textElementExtent match boqo, from the Default template on (golden build-headline-ass)', () => {
  const i = input('build-headline-ass');
  const sb = i.stacked.k;
  expectGolden('build-headline-ass', {
    scenarios: i.scenarios.map((s) => ({
      name: s.name,
      style: styleOf(s.style, s.headline) ?? null,
      result: buildHeadlineAss(s.text, s.headline, s.clipDurationSec, s.frame, s.offsetSec, styleOf(s.style, s.headline)),
    })),
    elements: i.elements.map((e) => ({
      name: e.name,
      result: buildTextAss(e.list.map((x) => ({ ...x, style: styleOf(x.style, x.settings) })), e.clipDurationSec, e.frame, e.offsetSec),
    })),
    extents: i.extents.map((x) => textElementExtent({ text: x.text, settings: x.settings, style: styleOf(x.style, x.settings) }, x.frame)),
    stacked: sb.map((k) => {
      const head = i.scenarios[0].headline;
      const part = buildHeadlineAss(i.stacked.text, head, 30, i.scenarios[0].frame, 0, styleOf('headlineStyleFor', head));
      return { k, result: stacked({ styleLine: part.ass.split('\n').find((l) => l.startsWith('Style: headline,')), events: part.ass.split('\n').filter((l) => l.startsWith('Dialogue:')), layout: part.layout }, k) };
    }),
    stackedBroken: thrown(() => stacked({ styleLine: 'Style: headline,x', events: ['Comment: 0,0:00:00.00,0:00:01.00,headline,,x'], layout: {} }, 1)),
  }, TOL0);
});

test('the Default template headline draws as boqo draws it: a #C8FF4D plate, Montserrat ExtraBold, upper case, 0 to 12 s, popping in', () => {
  const g = golden('build-headline-ass').scenarios.find((s) => s.name === 'default template one').result.ass;
  const lines = g.split('\n');
  const style = lines.find((l) => l.startsWith('Style: headline,')).split(',');
  assert.equal(style[1], 'Montserrat ExtraBold');
  assert.equal(style[6], '-1', 'Bold is the face\'s measured flag');
  assert.equal(style[3], '&H00000000', 'black ink on the lime plate (headlineInk)');
  const plate = lines.find((l) => l.startsWith('Dialogue: 0,'));
  assert.match(plate, /^Dialogue: 0,0:00:00\.00,0:00:12\.00,headline,/);
  assert.match(plate, /\\1c&H4DFFC8&\\1a&H00&\\p1\}/, '#C8FF4D as ASS BGR, fully opaque');
  assert.match(plate, /\\fscx0\\fscy0\\t\(0,380,\\fscx100\\fscy100\)/, 'the pop');
  assert.match(lines.find((l) => l.startsWith('Dialogue: 1,')), /\}WHY THIS CLIP WORKS$/);
  // The skill's constant is the template's row, and boqo's own DEFAULT_HEADLINE is the base a new headline starts from.
  const parsed = BrandHeadline.parse(DEFAULT_TEMPLATE_HEADLINE);
  assert.deepEqual(parsed.timing, { kind: 'window', startSec: 0, holdSec: 12 });
  assert.equal(DEFAULT_HEADLINE.timing.holdSec, 3, 'R14: core\'s DEFAULT_HEADLINE holds 3 s; the Default template says 12 and the skill follows the template');
  assert.deepEqual(DEFAULT_TEMPLATE_HEADLINE.font, { kind: 'builtin', name: 'Montserrat ExtraBold' });
});

test('the six headline styles match boqo: the table, tiers, knobs, headlineStyleFor and each look through buildHeadlineAss (golden headline-styles)', () => {
  const i = input('headline-styles');
  expectGolden('headline-styles', {
    styles: HEADLINE_STYLES,
    keys: HEADLINE_STYLE_KEYS,
    tiers: i.keys.map((k) => ({ key: k, tier: headlineStyleTier(k) })),
    knobs: HEADLINE_STYLES.map((s) => ({ key: s.key, knobs: headlineKnobsFor(s) })),
    fingerprint: headlineStyleFingerprint(),
    noStyle: i.noStyle.map((h) => headlineStyleFor(h) ?? null),
    scenarios: i.scenarios.map((s) => {
      const style = headlineStyleFor(s.headline);
      return { name: s.name, style: style ?? null, result: buildHeadlineAss(s.text, s.headline, s.clipDurationSec, s.frame, s.offsetSec, style) };
    }),
  }, TOL0);
  assert.deepEqual(HEADLINE_STYLE_KEYS, ['plate', 'outline', 'neon', 'marker', 'tag', 'stack']);
  // Each look draws what it is: the golden's ASS carries the effect.
  const ass = (name) => golden('headline-styles').scenarios.find((s) => s.name === name).result.ass;
  assert.match(ass('outline two 9:16'), /\\bord\d+\\3c&H000000&/);
  assert.match(ass('neon two 9:16'), /\\blur|\\be/);
  assert.match(ass('marker two 9:16'), /\\clip\(/);
  assert.match(ass('tag two 9:16'), /\\frz3\b/, 'the sticker tilt, negated for libass');
  assert.match(ass('stack two 9:16'), /\\shad\d+/);
  assert.match(ass('stack entrance type speed default one'), /\\alpha&HFF&\\t\(/, 'the typewriter');
});

test('the headline schema and rules match boqo: BrandHeadline, headlineInk, headlineText, headlineWindow, the geometry (golden headline-core)', () => {
  const i = input('headline-core');
  const parse = (h) => {
    const r = BrandHeadline.safeParse(h);
    return r.success ? { ok: true, data: r.data } : { ok: false, paths: r.error.issues.map((x) => x.path.join('.') || '(block)') };
  };
  expectGolden('headline-core', {
    constants: {
      HEADLINE_BOX_MAX, HEADLINE_BOX_MIN, HEADLINE_CAP_CEILING, HEADLINE_CAP_MAX, HEADLINE_CAP_MIN, HEADLINE_GLYPH_BOX_RATIO,
      HEADLINE_INK_DARK, HEADLINE_INK_LIGHT, HEADLINE_LINE_SPACING_RATIO, HEADLINE_MAX_LINES, HEADLINE_MIN_CONTRAST,
      HEADLINE_PAD_X_RATIO, HEADLINE_PAD_Y_RATIO, HEADLINE_PLATE_OPACITY_MIN, HEADLINE_POSITION_MAX, HEADLINE_POSITION_MIN,
      HEADLINE_RADIUS_MAX, HEADLINE_RADIUS_MIN, HEADLINE_SOURCES, HEADLINE_FIELDS, DEFAULT_HEADLINE,
    },
    sourceOptions: HeadlineSource.options,
    timing: [{ kind: 'whole' }, { kind: 'window', startSec: 0, holdSec: 12 }, { kind: 'window', startSec: 0, holdSec: 0.4 }, { kind: 'x' }].map((t) => {
      const r = BrandTiming.safeParse(t);
      return r.success ? { ok: true, data: r.data } : { ok: false };
    }),
    ink: i.inks.map((c) => ({ c, ink: headlineInk(c) })),
    luminance: i.luminance.map((c) => ({ c, l: relativeLuminance(c) })),
    contrast: i.contrast.map(([a, b]) => ({ a, b, ratio: contrastRatio(a, b) })),
    valid: i.valid.map(parse),
    invalid: i.invalid.map(parse),
    boxCeilings: i.boxFrames.map((f) => ({ f, ceiling: headlineBoxCeiling(f) })),
    plateHeights: i.plateHeights.map(([lines, cap]) => ({ lines, cap, h: headlinePlateHeight(lines, cap) })),
    texts: i.texts.headlines.map((h, hi) => i.texts.clips.map((c) => ({ hi, c, text: headlineText(h ?? undefined, c) }))),
    windows: i.windows.map((w) => ({ ...w, window: headlineWindow({ ...DEFAULT_HEADLINE, timing: w.timing }, w.clipDurationSec) })),
  }, TOL0);
  // The Default template's block parses; a style this build does not know reads as no style; an empty hook is no headline.
  assert.equal(parse(DEFAULT_TEMPLATE_HEADLINE).ok, true);
  assert.equal(golden('headline-core').valid[11].data.style, undefined);
  assert.equal(headlineText(BrandHeadline.parse({ ...DEFAULT_TEMPLATE_HEADLINE, source: 'hook' }), { title: 'T', hook: '   ' }), null);
  assert.equal(headlineInk('#C8FF4D'), '#000000');
  assert.equal(headlineInk('#07060B'), '#FFFFFF');
});

test('logoChain, logoOverlayPosition, logoFits and shiftLogoTiming match boqo, from the Default logo on (golden logo-chain)', () => {
  const i = input('logo-chain');
  expectGolden('logo-chain', {
    LOGO_FADE_SEC,
    logos: i.logos.map((l) => ({
      name: l.name,
      frames: i.frames.map((f) => ({ f, chain: logoChain(l.logo, f), position: logoOverlayPosition(l.logo, f) })),
      fits: i.durations.map((d) => ({ d, fits: logoFits(d, l.logo) })),
      shifted: i.offsets.map((o) => ({ o, logo: shiftLogoTiming(l.logo, o), chain: logoChain(shiftLogoTiming(l.logo, o), i.frames[0]) })),
    })),
  }, TOL0);
  // The Default logo at 1080x1920: a 108 px mark at 35% opacity, 92 px in from the left, 115 px up from the bottom.
  const d = golden('logo-chain').logos[0].frames[0];
  assert.equal(d.chain, '[1:v]scale=108:-2,format=rgba,colorchannelmixer=aa=0.35[blogo]');
  assert.deepEqual(d.position, { x: '92', y: 'H-h-115' });
  assert.equal(LOGO_FADE_SEC, 0.32);
});

// ---- the skill's track, against boqo's steps -----------------------------------------------------------------------

test('headlineTrack is hosted\'s headlineText + headlineStyleFor + buildHeadlineAss on the Default template (golden build-headline-ass)', () => {
  const i = input('build-headline-ass');
  const g = golden('build-headline-ass');
  const frameOf = (name) => i.scenarios.find((s) => s.name === name);
  for (const name of ['default template one', 'default template two', 'default template three', 'default template shrink', 'default template cyrillic',
    'default template braces', 'default template two 1:1', 'default template two 16:9', 'default template three, lead 1.7', 'default template overflow']) {
    const s = frameOf(name);
    const got = headlineTrack({ title: s.text, hook: 'unused hook', durationSec: s.clipDurationSec, leadSec: s.offsetSec, output: s.frame });
    assert.deepEqual({ ass: got.ass, layout: got.layout }, g.scenarios.find((x) => x.name === name).result, name);
    assert.equal(got.text, s.text);
  }
  // Defaults: the Default template, a 9:16 frame, no lead.
  const bare = headlineTrack({ title: 'Why this clip works', durationSec: 30 });
  assert.equal(bare.ass, g.scenarios.find((x) => x.name === 'default template one').result.ass);
  // A hook template on a clip with no hook draws nothing; so does `headline: null`.
  assert.equal(headlineTrack({ title: 'T', hook: null, durationSec: 30, headline: { ...DEFAULT_TEMPLATE_HEADLINE, source: 'hook' } }), null);
  assert.equal(headlineTrack({ title: 'T', hook: '  ', durationSec: 30, headline: { ...DEFAULT_TEMPLATE_HEADLINE, source: 'hook' } }), null);
  assert.equal(headlineTrack({ title: 'T', durationSec: 30, headline: null }), null);
  assert.equal(headlineTrack({ title: '   ', durationSec: 30 }), null);
  // A hook template with a hook draws the hook; a bare plate (no style) is today's headline.
  const hook = headlineTrack({ title: 'Title', hook: 'The hook', durationSec: 30, headline: { ...DEFAULT_TEMPLATE_HEADLINE, source: 'hook' } });
  assert.equal(hook.text, 'The hook');
  assert.match(hook.ass, /\}THE HOOK$/m);
  const { style: _s, textCase: _c, entrance: _e, ...BARE } = DEFAULT_TEMPLATE_HEADLINE;
  assert.deepEqual(headlineTrack({ title: 'Why this clip works', durationSec: 30, headline: BARE }).ass, g.scenarios.find((x) => x.name === 'bare plate one').result.ass);
  // Layout facts reach the caller.
  const long = headlineTrack({ title: frameOf('default template overflow').text, durationSec: 30 });
  assert.equal(long.layout.overflow, true);
  assert.equal(headlineTrack({ title: frameOf('default template three').text, durationSec: 30 }).layout.shrunk, true);
});

test('headlineTrack refuses a malformed call with the cause', () => {
  assert.throws(() => headlineTrack({ durationSec: 30 }), /title must be a string/);
  assert.throws(() => headlineTrack({ title: 'T', hook: 5, durationSec: 30 }), /hook must be/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: 0 }), /durationSec must be positive/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: NaN }), /durationSec must be positive/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: 30, leadSec: -1 }), /leadSec/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: 30, output: { width: 1080.5, height: 1920 } }), /whole pixels/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: 30, headline: { ...DEFAULT_TEMPLATE_HEADLINE, plateOpacity: 0.5 } }), /plateOpacity/);
  assert.throws(() => headlineTrack({ title: 'T', durationSec: 30, headline: { ...DEFAULT_TEMPLATE_HEADLINE, plateColour: 'red' } }), /plateColour/);
  assert.throws(() => headlineTrack(undefined), /title must be a string/);
});

test('logoStage is hosted\'s logoFits + logoOverlayPosition + logoChain, with the window moved by a hook\'s lead (golden logo-chain)', () => {
  const g = golden('logo-chain');
  const l0 = g.logos[0];
  const stage = logoStage({ durationSec: 30 });
  assert.deepEqual(stage, { chain: l0.frames[0].chain, x: l0.frames[0].position.x, y: l0.frames[0].position.y });
  assert.deepEqual(DEFAULT_TEMPLATE_LOGO, { ...DEFAULT_TEMPLATE_LOGO, width: 0.1, anchor: 'bottom-left', marginX: 0.0854, marginY: 0.06, opacity: 0.35, timing: { kind: 'whole' } });
  // Another frame, and the 1:1 position.
  const sq = logoStage({ durationSec: 30, output: { width: 1080, height: 1080 } });
  const f11 = l0.frames.find((f) => f.f.width === 1080 && f.f.height === 1080);
  assert.deepEqual([sq.chain, sq.x, sq.y], [f11.chain, f11.position.x, f11.position.y]);
  // A whole-clip logo behind a hook: the chain is the same, the overlay is enabled from the lead.
  assert.deepEqual(logoStage({ durationSec: 30, leadSec: 1.7 }), { ...stage, enableFromSec: 1.7 });
  // A windowed logo: fades move by the lead and it fits on clip time only.
  const win = { ...DEFAULT_TEMPLATE_LOGO, opacity: 1, timing: { kind: 'window', startSec: 3, holdSec: 4 } };
  const w0 = g.logos.find((l) => l.name === 'window opacity 1');
  assert.equal(logoStage({ logo: win, durationSec: 30 }).chain, w0.frames[0].chain);
  assert.equal(logoStage({ logo: win, durationSec: 30, leadSec: 1.7 }).chain, w0.shifted.find((s) => s.o === 1.7).chain);
  assert.equal(logoStage({ logo: win, durationSec: 7.28 }), null, 'a window that does not fit draws no logo');
  assert.notEqual(logoStage({ logo: win, durationSec: 7.7 }), null);
  assert.throws(() => logoStage({ durationSec: 0 }), /durationSec/);
  assert.throws(() => logoStage({ durationSec: 30, logo: { ...DEFAULT_TEMPLATE_LOGO, anchor: 'middle' } }), /anchor/);
  assert.throws(() => logoStage({ durationSec: 30, logo: { ...DEFAULT_TEMPLATE_LOGO, width: 0 } }), /width/);
  assert.throws(() => logoStage({ durationSec: 30, logo: { ...DEFAULT_TEMPLATE_LOGO, opacity: 0.01 } }), /opacity/);
  assert.throws(() => logoStage({ durationSec: 30, logo: { ...DEFAULT_TEMPLATE_LOGO, timing: { kind: 'window', startSec: 0, holdSec: 0.1 } } }), /holdSec/);
});

// ---- real ffmpeg: the headline through libass, the logo through overlay ----------------------------------------------

const ffmpeg = (args) => spawnSync('ffmpeg', args, { encoding: 'utf8', env: toolEnv(), maxBuffer: 256 << 20 });
const W = 1080;
const H = 1920;
const BASE = [51, 102, 153]; // 0x336699
// One frame at `at` seconds as packed rgb24, through `vf`; `extra` are more inputs.
function frameAt(vf, at, { assPath, inputs = [], filterComplex } = {}) {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'verbose', '-f', 'lavfi', '-i', `color=c=0x336699:s=${W}x${H}:r=5:d=3`, ...inputs];
  if (filterComplex) args.push('-filter_complex', filterComplex, '-map', '[out]');
  else args.push('-vf', vf);
  args.push('-ss', String(at), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
  const r = spawnSync('ffmpeg', args, { env: toolEnv(), maxBuffer: 256 << 20 });
  return { status: r.status, stderr: String(r.stderr), data: r.stdout };
}
const px = (data, x, y) => [data[(y * W + x) * 3], data[(y * W + x) * 3 + 1], data[(y * W + x) * 3 + 2]];
const near = (got, want, tol, msg) => assert.ok(got.every((v, k) => Math.abs(v - want[k]) <= tol), `${msg}: ${got} vs ${want}`);
const selected = (log) => log.split(/\r?\n/).filter((l) => /fontselect:/.test(l)).map((l) => l.replace(/^.*fontselect: /, ''));

test('the Default template headline burns through libass from the bundled fonts: exit 0, no fallback, Montserrat ExtraBold from the folder, the lime plate drawn', () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo headline '));
  try {
    const fonts = join(root, 'bundled fonts');
    cpSync(FONTS_DIR, fonts, { recursive: true });
    const title = 'Why this clip works';
    const track = headlineTrack({ title, durationSec: 3 });
    const assPath = join(root, 'headline.ass');
    writeFileSync(assPath, track.ass);
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'verbose', '-f', 'lavfi', '-i', `color=c=0x336699:s=${W}x${H}:r=5:d=3`, '-vf', subtitlesFilter(assPath, fonts), '-f', 'null', '-'];
    const r = ffmpeg(args);
    assert.equal(r.status, 0, r.stderr.slice(-3000));
    assert.deepEqual(fontFallbacks(r.stderr), [], selected(r.stderr).join('\n'));
    // Positive control: libass loaded the face from the folder and selected it for the headline's family and weight.
    assert.match(r.stderr, /Loading font file '[^']*bundled fonts[\\/]Montserrat-ExtraBold\.ttf'/);
    assert.ok(selected(r.stderr).some((l) => l.startsWith('(Montserrat ExtraBold, 700, 0) -> Montserrat-ExtraBold')), selected(r.stderr).join('\n'));
    // Negative control: the same ASS in a family the folder lacks exits 0 too, and the detector says it fell back.
    const missing = join(root, 'missing face.ass');
    writeFileSync(missing, track.ass.replace('Style: headline,Montserrat ExtraBold,', 'Style: headline,Nonexistent Face,'));
    const m = ffmpeg(args.map((a) => (a.startsWith('subtitles=') ? subtitlesFilter(missing, fonts) : a)));
    assert.equal(m.status, 0);
    assert.ok(fontFallbacks(m.stderr).length > 0, selected(m.stderr).join('\n'));
    // The plate is drawn: after the 380 ms pop, inside the plate above the text it is #C8FF4D, and outside it is the base.
    const frame = { width: W, height: H };
    const layout = layoutHeadline(title.toUpperCase(), DEFAULT_TEMPLATE_HEADLINE, frame);
    const plate = headlinePlate(layout, DEFAULT_TEMPLATE_HEADLINE, frame, fontMetrics('Montserrat ExtraBold'));
    const f = frameAt(subtitlesFilter(assPath, fonts), 1);
    assert.equal(f.status, 0, f.stderr.slice(-2000));
    near(px(f.data, Math.round(plate.left + plate.width / 2), plate.top + 6), [0xc8, 0xff, 0x4d], 14, 'inside the plate');
    near(px(f.data, 5, 5), BASE, 6, 'outside the plate');
    // The text is drawn in black ink on it: some pixel across the text's band is dark.
    let dark = 0;
    for (let x = plate.left + 20; x < plate.left + plate.width - 20; x++) if (px(f.data, x, Math.round(plate.top + plate.height / 2))[0] < 60) dark++;
    assert.ok(dark > 40, `ink pixels across the text line: ${dark}`);
    // Before the window opens and after it closes (0 to 12 s on a 3 s clip: the window is clamped), nothing else is drawn.
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every headline style burns from the bundled fonts with nothing falling back, Latin, Cyrillic and Hindi', () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo headline styles '));
  try {
    const fonts = join(root, 'bundled fonts');
    cpSync(FONTS_DIR, fonts, { recursive: true });
    for (const style of HEADLINE_STYLE_KEYS) {
      for (const [label, title] of [
        ['latin', 'Why this clip works and why it matters'], ['cyrillic', 'Почему этот ролик набрал миллион'],
        // An evaluation clip's title (E2-fix3): Latin and Devanagari on one plate.
        ['hindi', '7200 mAh बैटरी और वेट सिर्फ 205 ग्राम'],
      ]) {
        const track = headlineTrack({ title, durationSec: 3, headline: { ...DEFAULT_TEMPLATE_HEADLINE, style } });
        const assPath = join(root, `${style} ${label}.ass`);
        writeFileSync(assPath, track.ass);
        const filter = textPassFilter(assPath, track.ass, fonts);
        // Hindi alone is burned with complex shaping; Latin and Cyrillic keep boqo's `subtitles` filter.
        assert.equal(filter, label === 'hindi' ? subtitlesFilter(assPath, fonts, { complex: true }) : subtitlesFilter(assPath, fonts), `${style} ${label}`);
        const r = ffmpeg(['-hide_banner', '-nostdin', '-loglevel', 'verbose', '-f', 'lavfi', '-i', `color=c=0x336699:s=${W}x${H}:r=5:d=3`, '-vf', filter, '-f', 'null', '-']);
        assert.equal(r.status, 0, `${style} ${label}: ${r.stderr.slice(-2000)}`);
        assert.deepEqual(fontFallbacks(r.stderr), [], `${style} ${label}:\n${selected(r.stderr).join('\n')}`);
        if (label === 'hindi') {
          assert.match(track.ass, /\{\\b1\\fnNoto Sans Devanagari\}बैटरी\{\\fn[^\\}]+\\b\d+\}/, style);
          assert.ok(selected(r.stderr).some((l) => l.startsWith('(Noto Sans Devanagari, 700, 0) -> NotoSansDevanagari-Bold,')), `${style}:\n${selected(r.stderr).join('\n')}`);
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Default logo chain runs in ffmpeg on a synthetic PNG: scaled to a tenth of the frame, 35% opaque, at the bottom-left margins', () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo logo '));
  try {
    // A synthetic 400x200 opaque red PNG with a fully transparent right half, made by ffmpeg itself.
    const png = join(root, 'logo.png');
    const made = ffmpeg(['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=400x200,format=rgba',
      '-vf', "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,200),255,0)'", '-frames:v', '1', '-y', png]);
    assert.equal(made.status, 0, made.stderr);
    assert.ok(existsSync(png));
    const stage = logoStage({ durationSec: 3 });
    const fc = `${stage.chain.replace('[1:v]', '[1:v]')};[0:v][blogo]overlay=${stage.x}:${stage.y}[out]`;
    const f = frameAt(null, 1, { inputs: ['-loop', '1', '-t', '3', '-i', png], filterComplex: fc });
    assert.equal(f.status, 0, f.stderr.slice(-2000));
    // 108 px wide, so 54 px tall at the 2:1 aspect: x 92..200, y (1920-115-54)..(1920-115) = 1751..1805. The opaque left half
    // is x 92..146; 35% red over the base: 0.35 * (255,0,0) + 0.65 * (51,102,153).
    const want = [0.35 * 255 + 0.65 * 51, 0.65 * 102, 0.65 * 153];
    near(px(f.data, 110, 1775), want, 8, 'the logo\'s opaque half, blended at 35%');
    near(px(f.data, 180, 1775), BASE, 6, 'the transparent half shows the footage');
    near(px(f.data, 110, 1740), BASE, 6, 'above the mark');
    near(px(f.data, 80, 1775), BASE, 6, 'left of the mark');
    near(px(f.data, 110, 1815), BASE, 6, 'below the mark');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
