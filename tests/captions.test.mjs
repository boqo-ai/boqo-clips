// Captions (Task A12): the ported caption modules, each held by a golden from boqo's own functions
// (scripts/parity/cases/), the skill's track (engine/captions.mjs) held to boqo's own steps, the bundled fonts, and a
// real libass burn through `fontsdir` in a folder with a space in its path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assFontSize, CAPTION_METRICS, fontMetrics, measureWidth } from '../engine/boqo/caption-metrics.mjs';
import { CAPTION_FACES, NEW_CAPTION_FACES, coveringFace, faceFor } from '../engine/boqo/caption-faces.mjs';
import { captionGroups, distributeEvenly, endsSentence, keyFlagsFor, layoutCaptions, wrapGroup, wrapGroupMeasured } from '../engine/boqo/caption-layout.mjs';
import {
  BRAND_CAPTION_KEY, CAPTION_PRESETS, CAPTION_SIZE_MAX, CAPTION_SIZE_MIN, CAPTION_WORDS_MAX, CAPTION_WORDS_MIN,
  DEFAULT_CAPTION_PRESET_KEY, POSITIONED_PRESETS, captionPresetFingerprint, captionSizeCeiling, scalePreset, scalePresetExact,
  sizeCeilingOf,
} from '../engine/boqo/caption-presets.mjs';
import { CAPTION_STYLES, GALLERY_CAPTION_STYLE_KEYS, GALLERY_CAPTION_STYLES, captionStyleFingerprint, knobsFor } from '../engine/boqo/caption-styles.mjs';
import { PICKABLE_CAPTION_STYLES, captionStyleTier, resolveCaptionStyle } from '../engine/boqo/caption-style-registry.mjs';
import {
  BrandCaptions, CAPTION_FONTS, CAPTION_POSITION_MAX, CAPTION_POSITION_MIN, applyCaptionOverrides, captionOverridesReach,
  countCaptionOverrides, defaultCaptionStyle, resolveClipCaptions, resolveProjectCaptions,
} from '../engine/boqo/caption-overrides.mjs';
import { buildEmphasisSet, captionDisplayText, captionText, emphasisKey } from '../engine/boqo/caption-words.mjs';
import { DEFAULT_CAPTION_STYLE, assTime, buildAss, buildCaptions, captionLines, escapeText, scaleCaptionStyle } from '../engine/boqo/captions.mjs';
import { glowTags, lineEntrance, markerEvent, opacityTags, popTags, shadowTags, wordEntrance } from '../engine/boqo/caption-effects.mjs';
import { cutSecFromShots } from '../engine/boqo/caption-cuts.mjs';
import {
  BUNDLED_FACES, DEFAULT_OUTPUT, DEFAULT_TEMPLATE_CAPTIONS, FONTS_DIR, captionsAss, captionsTrack, emphasisForWords, filterPath,
  fontFallbacks, subtitlesFilter, tolerantKey,
} from '../engine/captions.mjs';
import { toolEnv } from '../engine/env.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = (name) => JSON.parse(readFileSync(new URL(`./fixtures/parity/${name}.input.json`, import.meta.url), 'utf8'));
const golden = (name) => JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), 'utf8'));
const TOL0 = { tol: 0 };

// ---- the copies against boqo's goldens ----------------------------------------------------------------------------

test('buildCaptions matches boqo for the 15 gallery styles, the 5 legacy presets, illustrated and none (golden build-ass)', () => {
  const i = input('build-ass');
  const build = (preset) => buildCaptions(i.words, preset, i.output, i.cutSec, i.emphasis);
  const e = i.effects;
  const speeds = e.speeds.map((s) => s ?? undefined);
  expectGolden('build-ass', {
    gallery: GALLERY_CAPTION_STYLE_KEYS.map((key) => {
      const { preset, overridesApplied } = resolveProjectCaptions(BRAND_CAPTION_KEY, { style: key });
      return { key, preset, overridesApplied, result: build(preset) };
    }),
    legacy: CAPTION_PRESETS.filter((p) => p.key !== 'none').map((p) => {
      const preset = resolveCaptionStyle(p.key);
      return { key: p.key, preset, result: build(preset) };
    }),
    extra: ['illustrated', 'none'].map((key) => {
      const preset = resolveCaptionStyle(key);
      return { key, preset, result: build(preset) };
    }),
    buildAss: i.scaleOutputs.map((output) => buildAss(i.words, scaleCaptionStyle(DEFAULT_CAPTION_STYLE, output), output)),
    scaleCaptionStyle: i.scaleOutputs.map((output) => scaleCaptionStyle(DEFAULT_CAPTION_STYLE, output)),
    assTime: i.assTimes.map((t) => assTime(t)),
    escapeText: i.escape.map((t) => escapeText(t)),
    captionLines: i.lineWords.map((c) => captionLines(c.words, c.max).map((line) => line.map((w) => w.word))),
    effects: {
      glow: e.glows.flatMap((g) => e.capHeights.flatMap((c) => e.boosts.map((b) => glowTags(g, c, b)))),
      shadow: e.shadows.flatMap((s) => e.capHeights.map((c) => shadowTags(s, c))),
      opacity: e.opacities.flatMap((o) => [undefined, ...e.shadows].map((s) => opacityTags(o, s))),
      pop: e.stepMs.flatMap((ms) => speeds.map((s) => popTags(118, s, ms))),
      marker: e.markers.map((m) => markerEvent(m)),
      line: ['fade', 'slide'].flatMap((k) => e.stepMs.flatMap((ms) => speeds.map((s) => lineEntrance(k, 540, 1546, 45, ms, s)))),
      word: ['pop', 'bounce', 'type'].flatMap((k) => e.stepMs.flatMap((ms) => speeds.map((s) => wordEntrance(k, ms, s)))),
    },
  }, TOL0);
  // The case is what the brief names: 15 gallery styles and 5 legacy presets, 12 words, 2 emphasis words.
  assert.equal(i.words.length, 12);
  assert.equal(i.emphasis.length, 2);
  assert.equal(GALLERY_CAPTION_STYLE_KEYS.length, 15);
  assert.equal(golden('build-ass').legacy.length, 5);
});

test('captionGroups, keyFlagsFor, the emphasis set, captionText and layoutCaptions match boqo (golden caption-groups)', () => {
  const i = input('caption-groups');
  expectGolden('caption-groups', {
    groups: i.scenarios.map((s) => ({ name: s.name, groups: captionGroups(s.words, s.bounds, s.gap, s.cuts).map((g) => g.map((w) => w.index)) })),
    distribute: i.distribute.map(([n, count]) => distributeEvenly(Array.from({ length: n }, (_, k) => k), count)),
    endsSentence: i.endsSentence.map((t) => endsSentence(t)),
    keyFlags: i.keyFlags.map((c) => ({ set: [...buildEmphasisSet(c.emphasis)], flags: c.presets.map((p) => keyFlagsFor(c.group, buildEmphasisSet(c.emphasis), p)) })),
    emphasisSets: i.emphasisSets.map((list) => [...buildEmphasisSet(list)]),
    texts: i.texts.map((t) => ({
      key: emphasisKey(t),
      text: ['upper', 'preserve', 'lower'].flatMap((textCase) => [true, false].map((stripPunctuation) => captionText(t, { textCase, stripPunctuation }))),
      display: i.masks.flatMap((mask) => ['upper', 'preserve', 'lower'].map((textCase) => captionDisplayText(mask === null ? { word: t } : { word: t, mask }, { textCase, stripPunctuation: true }))),
    })),
    layout: i.layout.presets.map((key) => {
      const l = i.layout;
      const preset = resolveCaptionStyle(key);
      return { key, plain: layoutCaptions(l.words, preset, l.output, l.cutSec, l.emphasis), timed: layoutCaptions(l.words, preset, l.output, l.cutSec, l.emphasis, l.coverTexts, l.timeSpans) };
    }),
  }, TOL0);
});

test('wrapGroup and wrapGroupMeasured match boqo in every face (golden wrap-group-measured)', () => {
  const i = input('wrap-group-measured');
  const flat = (r) => ({ lines: r.lines.map((l) => l.join(' ')).join('|'), overflow: r.overflow });
  const plain = [];
  for (const face of i.faces) {
    const metrics = fontMetrics(face);
    for (const cap of i.capHeights) {
      const fontSize = assFontSize(metrics, cap);
      for (const [g, texts] of i.groups.entries())
        for (const maxWidth of i.maxWidths) for (const maxLines of i.maxLines) plain.push({ face, cap, g, maxWidth, maxLines, ...flat(wrapGroup(texts, { metrics, fontSize, maxWidth, maxLines })) });
    }
  }
  const measured = [];
  for (const m of i.measured) {
    const metrics = fontMetrics(m.face);
    const keyMetrics = fontMetrics(m.keyFace);
    const fontSize = assFontSize(metrics, m.cap);
    const keyFontSize = assFontSize(keyMetrics, Math.round(m.cap * (m.keyPct / 100)));
    const space = measureWidth(metrics, ' ', fontSize);
    for (const [g, texts] of i.groups.entries()) {
      const widthOfWord = (k) => (m.keys[g][k] ? measureWidth(keyMetrics, texts[k], keyFontSize) : measureWidth(metrics, texts[k], fontSize));
      for (const maxWidth of i.maxWidths) for (const maxLines of i.maxLines) measured.push({ face: m.face, g, maxWidth, maxLines, ...flat(wrapGroupMeasured(texts, widthOfWord, space, { maxWidth, maxLines })) });
    }
  }
  expectGolden('wrap-group-measured', { plain, measured }, TOL0);
});

test('coveringFace and faceFor match boqo: Latin keeps the face, Cyrillic takes the covering one (golden covering-face)', () => {
  const i = input('covering-face');
  const thrown = (f) => { try { return { value: f() }; } catch (e) { return { error: e.message }; } };
  expectGolden('covering-face', {
    faces: CAPTION_FACES,
    newFaces: NEW_CAPTION_FACES,
    cover: Object.keys(CAPTION_FACES).map((name) => ({ name, faceFor: faceFor(name), covering: i.texts.map((t) => ({ texts: t.name, face: coveringFace(name, t.texts) })) })),
    unknown: i.unknownFaces.map((name) => ({ name, faceFor: thrown(() => faceFor(name)), covering: thrown(() => coveringFace(name, ['x'])) })),
  }, TOL0);
  const g = golden('covering-face').cover;
  const on = (name, texts) => g.find((c) => c.name === name).covering.find((c) => c.texts === texts).face;
  assert.equal(on('Bangers', 'latin'), 'Bangers');
  assert.equal(on('Bangers', 'cyrillic lower'), 'Montserrat ExtraBold');
  assert.equal(on('Anton', 'cyrillic upper'), 'Oswald');
  assert.equal(on('Oswald', 'cyrillic upper'), 'Oswald');
});

test('the metrics table is boqo\'s generated data, and assFontSize and measureWidth read it as boqo does (golden caption-metrics)', () => {
  const i = input('caption-metrics');
  expectGolden('caption-metrics', {
    table: CAPTION_METRICS,
    sizes: i.sizes.map(([cap, face]) => assFontSize(fontMetrics(face), cap)),
    widths: i.widths.map(([face, text, size]) => measureWidth(fontMetrics(face), text, size)),
    unknown: i.unknown.map((face) => { try { fontMetrics(face); return null; } catch (e) { return e.message; } }),
  }, TOL0);
  assert.match(readFileSync(new URL('../engine/boqo/caption-metrics-table.mjs', import.meta.url), 'utf8'), /^\/\/ ported from .*\n\/\/ GENERATED FILE -- do not edit by hand\./);
});

test('the brand caption block and applyCaptionOverrides match boqo, from the Default template on (golden apply-caption-overrides)', () => {
  const i = input('apply-caption-overrides');
  const parse = (c) => {
    const r = BrandCaptions.safeParse(c);
    return r.success ? { success: true, data: r.data } : { success: false };
  };
  const blocks = i.captions.map((c) => BrandCaptions.parse(c));
  const all = [...CAPTION_PRESETS, ...CAPTION_STYLES];
  expectGolden('apply-caption-overrides', {
    parse: [...i.captions, ...i.invalid].map(parse),
    apply: blocks.flatMap((captions, b) => [undefined, ...all].map((preset) => {
      const p = preset ?? all[0];
      const result = applyCaptionOverrides(p, preset === undefined ? undefined : captions);
      return { b, key: p.key, undefinedBlock: preset === undefined, identity: result === p, result: result === p ? null : JSON.stringify(result) };
    })),
    project: i.keys.flatMap((key) => [undefined, ...blocks].map((captions, b) => {
      const r = resolveProjectCaptions(key, captions);
      const table = all.find((p) => p.key === r.preset.key);
      return { key, b: b - 1, presetKey: r.preset.key, tableEntry: table !== undefined && r.preset === table, preset: table !== undefined && r.preset === table ? null : JSON.stringify(r.preset), overridesApplied: r.overridesApplied };
    })),
    clip: i.clip.map((c) => {
      const r = resolveClipCaptions({ ...c, brandCaptions: c.brandCaptions === undefined ? undefined : BrandCaptions.parse(c.brandCaptions) });
      return { preset: JSON.stringify(r.preset), overridesApplied: r.overridesApplied, clipOverridesApplied: r.clipOverridesApplied };
    }),
    defaultStyle: [undefined, ...blocks].map((c) => defaultCaptionStyle(c)),
    count: [undefined, ...blocks].map((c) => countCaptionOverrides(c)),
    reach: i.keys.map((k) => captionOverridesReach(k)),
    tier: i.keys.map((k) => captionStyleTier(k)),
    resolve: i.keys.map((k) => resolveCaptionStyle(k).key),
    knobs: [...GALLERY_CAPTION_STYLES, ...CAPTION_STYLES].map((p) => ({ key: p.key, knobs: knobsFor(p) })),
    constants: {
      BRAND_CAPTION_KEY, DEFAULT_CAPTION_PRESET_KEY, CAPTION_WORDS_MIN, CAPTION_WORDS_MAX, CAPTION_SIZE_MIN, CAPTION_SIZE_MAX,
      CAPTION_POSITION_MIN, CAPTION_POSITION_MAX, CAPTION_FONTS, GALLERY_CAPTION_STYLE_KEYS,
      positioned: POSITIONED_PRESETS.map((p) => p.key), pickable: PICKABLE_CAPTION_STYLES.map((p) => p.key),
    },
    fingerprints: { presets: captionPresetFingerprint(), styles: captionStyleFingerprint() },
    sizes: i.outputs.map((output) => ({
      output,
      ceiling: captionSizeCeiling(output),
      perPreset: [...POSITIONED_PRESETS, ...CAPTION_STYLES].map((p) => {
        const [sc, ex] = [scalePreset(p, output), scalePresetExact(p, output)];
        const pick = (q) => [q.capHeightPx, q.outlineWidth, q.sideMarginPx];
        return { key: p.key, ceiling: sizeCeilingOf(p, output), scaled: pick(sc), exact: pick(ex), scaledIsPreset: sc === p };
      }),
    })),
  }, TOL0);
});

test('the skill\'s caption track is boqo\'s: words through the window and cuts, the brand\'s style, buildCaptions (golden caption-track)', () => {
  const i = input('caption-track');
  expectGolden('caption-track', i.scenarios.map((s) => {
    const t = captionsTrack({
      words: i.words[s.words], clipStart: s.startSec, clipEnd: s.endSec, cuts: s.cuts, sceneCuts: s.sceneCuts,
      emphasis: s.emphasis, brandCaptions: s.brandCaptions, output: s.output,
    });
    return { name: s.name, words: t.words, result: { ass: t.ass, overflowGroups: t.overflowGroups, emphasisMatched: t.emphasisMatched, fallbackUsed: t.fallbackUsed } };
  }), TOL0);
});

// ---- the skill's own: the default kit, emphasis tolerance, the Cyrillic face ---------------------------------------

const SRC = input('caption-track');
const EN = SRC.words.en;
const RU = SRC.words.ru;
const WIN = { clipStart: 99.9, clipEnd: 105.2 };
const styleLine = (ass) => ass.split('\n').find((l) => l.startsWith('Style: '))?.slice('Style: '.length).split(',');

test('the default kit is boqo\'s Default template: Punch, #E900FA keywords, centred at 0.7, 9:16', () => {
  assert.deepEqual({ ...DEFAULT_TEMPLATE_CAPTIONS, accentColours: [...DEFAULT_TEMPLATE_CAPTIONS.accentColours] }, { style: 'punch', accentColours: ['#E900FA'], positionFraction: 0.7 });
  assert.deepEqual(DEFAULT_OUTPUT, { width: 1080, height: 1920 });
  const t = captionsTrack({ words: EN, ...WIN, emphasis: ['rockets'] });
  assert.equal(t.preset.key, BRAND_CAPTION_KEY);
  assert.equal(t.preset.fontName, 'Oswald');
  assert.equal(t.preset.centreFraction, 0.7);
  assert.deepEqual(t.preset.accentColours, ['#E900FA']);
  assert.equal(t.ass, captionsAss({ words: EN, ...WIN, emphasis: ['rockets'], brandCaptions: DEFAULT_TEMPLATE_CAPTIONS, output: { width: 1080, height: 1920 } }));
  assert.match(t.ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.equal(styleLine(t.ass)[1], 'Oswald');
  // Every style resolves by family: no embedded [Fonts] section, and every face named is a bundled one.
  for (const key of GALLERY_CAPTION_STYLE_KEYS) {
    const ass = captionsAss({ words: EN, ...WIN, emphasis: ['rockets', 'coming'], brandCaptions: { style: key } });
    assert.ok(!ass.includes('[Fonts]'), key);
    const faces = [styleLine(ass)[1], ...[...ass.matchAll(/\\fn([^\\}]+)/g)].map((m) => m[1])];
    for (const f of faces) assert.ok(BUNDLED_FACES[f], `${key}: ${f} is bundled`);
  }
  // The skill's `{ w, s, e }` words read the same as hosted's `{ word, start, end }`.
  const skillWords = EN.map((x) => ({ w: x.word, s: x.start, e: x.end }));
  assert.equal(captionsAss({ words: skillWords, ...WIN, cuts: [{ start: 3.55, end: 4.35 }] }), captionsAss({ words: EN, ...WIN, cuts: [{ start: 3.55, end: 4.35 }] }));
});

test('emphasis words match the clip\'s words through case, punctuation and quote marks; hosted\'s exact matches are untouched', () => {
  const words = [{ word: 'Rockets,' }, { word: 'didn’t' }, { word: '"Really?"' }, { word: 'can\'t' }];
  assert.deepEqual(emphasisForWords(['rockets', "didn't", '\'really\'', 'nowhere'], words), ['rockets', "didn't", '\'really\'', 'nowhere', 'didn’t']);
  assert.deepEqual(emphasisForWords(['CAN’T'], words), ['CAN’T', "can't"]);
  assert.equal(emphasisForWords(null, words), null);
  assert.deepEqual(emphasisForWords([], words), []);
  assert.equal(tolerantKey('“Didn’t”'), tolerantKey("didn't"));
  assert.equal(tolerantKey('Ｒｏｃｋｅｔｓ'), 'rockets');
  // On a clip: a sanitised spelling ("didn’t" asked as "didn't") highlights what hosted's matcher alone would not.
  const curly = EN.map((w) => (w.word === "didn't" ? { ...w, word: 'didn’t' } : w));
  const bare = buildCaptions(captionsTrack({ words: curly, ...WIN }).words, captionsTrack({ words: curly, ...WIN }).preset, DEFAULT_OUTPUT, [], ["didn't"]);
  const tolerant = captionsTrack({ words: curly, ...WIN, emphasis: ["didn't"] });
  assert.equal(bare.emphasisMatched, 0);
  assert.equal(tolerant.emphasisMatched, 1);
  // The Default template has one accent, so its keyword shows as the spoken colour; a two-colour brand shows it as the key colour.
  const two = captionsTrack({ words: curly, ...WIN, emphasis: ["didn't"], brandCaptions: { style: 'karaoke', accentColours: ['#F8F800', '#00F020'] } });
  assert.match(two.ass, /\{\\c&H20F000&\\fscx128\\fscy128\}DIDN’T/);
});

test('a Cyrillic clip\'s style resolves to its covering face; Latin keeps the style\'s own', () => {
  const ru = (brandCaptions) => captionsTrack({ words: RU, ...WIN, emphasis: ['ракеты'], brandCaptions });
  // Comic draws Bangers, which has no Cyrillic: the clip is drawn in Montserrat ExtraBold, at its own Bold flag.
  const comic = ru({ style: 'comic' });
  assert.equal(comic.fallbackUsed, true);
  assert.deepEqual([styleLine(comic.ass)[1], styleLine(comic.ass)[6]], ['Montserrat ExtraBold', '-1']);
  assert.equal(coveringFace('Bangers', RU.map((w) => w.word)), 'Montserrat ExtraBold');
  // Bold Keys: Poppins Black and its Anton key face both fall back; the key words switch to Oswald, never Anton.
  const boldkeys = ru({ style: 'boldkeys' });
  assert.equal(boldkeys.fallbackUsed, true);
  assert.equal(styleLine(boldkeys.ass)[1], 'Montserrat ExtraBold');
  assert.match(boldkeys.ass, /\\fnOswald\\fs\d+\\b1/);
  assert.doesNotMatch(boldkeys.ass, /Anton|Poppins/);
  // Punch (the Default template) draws Oswald, which covers Cyrillic: no fallback.
  const punch = ru(undefined);
  assert.equal(punch.fallbackUsed, false);
  assert.equal(styleLine(punch.ass)[1], 'Oswald');
  assert.match(punch.ass, /РАКЕТЫ/);
  // The same style on Latin text keeps Bangers.
  const latin = captionsTrack({ words: EN, ...WIN, brandCaptions: { style: 'comic' } });
  assert.equal(latin.fallbackUsed, false);
  assert.equal(styleLine(latin.ass)[1], 'Bangers');
});

test('captionsTrack refuses a malformed call with the cause, and a brand block that does not parse', () => {
  assert.throws(() => captionsTrack({ words: EN, clipStart: 5, clipEnd: 5 }), /clipStart < clipEnd/);
  assert.throws(() => captionsTrack({ words: 'x', ...WIN }), /words must be an array/);
  assert.throws(() => captionsTrack({ words: [{ w: 'a', s: 'x', e: 1 }], ...WIN }), /words\[0\]/);
  assert.throws(() => captionsTrack({ words: EN, ...WIN, cuts: [{ start: 2, end: 1 }] }), /cuts must be/);
  assert.throws(() => captionsTrack({ words: EN, ...WIN, cuts: [{ start: 3, end: 4 }, { start: 1, end: 2 }] }), /sorted and disjoint: cuts\[1\]/);
  assert.throws(() => captionsTrack({ words: EN, ...WIN, cuts: [{ start: 1, end: 3 }, { start: 2, end: 4 }] }), /sorted and disjoint/);
  assert.doesNotThrow(() => captionsTrack({ words: EN, ...WIN, cuts: [{ start: 1, end: 2 }, { start: 2, end: 3 }] }));
  assert.throws(() => captionsTrack({ words: EN, ...WIN, emphasis: 'rockets' }), /emphasis must be/);
  assert.throws(() => captionsTrack({ words: EN, ...WIN, output: { width: 1080.5, height: 1920 } }), /whole pixels/);
  assert.throws(() => captionsTrack({ words: EN, ...WIN, brandCaptions: { positionFraction: 0.95 } }), /positionFraction/);
  // A style this build does not know reads as absent (zod .catch, as hosted): karaoke under the brand key.
  assert.equal(captionsTrack({ words: EN, ...WIN, brandCaptions: { style: 'sparkle' } }).preset.fontName, 'Montserrat ExtraBold');
  // A resolved preset passed in is drawn as it is (the stream panels' adjusted style).
  const own = { ...resolveCaptionStyle('punch'), centreFraction: 0.4 };
  assert.equal(captionsTrack({ words: EN, ...WIN, preset: own }).ass, buildCaptions(captionsTrack({ words: EN, ...WIN }).words, own, DEFAULT_OUTPUT, [], null).ass);
  assert.deepEqual(cutSecFromShots([{ startSec: 0 }, { startSec: 1.62 }, { startSec: 4 }]), [1.62, 4]);
});

// ---- the bundled fonts ------------------------------------------------------------------------------------------

function fontNames(buf) {
  const tables = {};
  for (let k = 0, n = buf.readUInt16BE(4); k < n; k++) tables[buf.toString('latin1', 12 + k * 16, 16 + k * 16)] = buf.readUInt32BE(12 + k * 16 + 8);
  const at = tables.name;
  const strings = at + buf.readUInt16BE(at + 4);
  const names = {};
  for (let k = 0, n = buf.readUInt16BE(at + 2); k < n; k++) {
    const o = at + 6 + k * 12;
    if (buf.readUInt16BE(o) !== 3) continue;
    const off = strings + buf.readUInt16BE(o + 10);
    names[buf.readUInt16BE(o + 6)] = Buffer.from(buf.subarray(off, off + buf.readUInt16BE(o + 8))).swap16().toString('utf16le');
  }
  return { family: names[1], postscript: names[6], weight: buf.readUInt16BE(tables['OS/2'] + 4), hasFvar: 'fvar' in tables };
}

test('every caption face is bundled once, by its family, with its licence, and each file is the one SOURCES.md lists', () => {
  assert.deepEqual(Object.keys(BUNDLED_FACES).sort(), Object.keys(CAPTION_FACES).sort());
  assert.deepEqual([...CAPTION_FONTS].sort(), Object.keys(CAPTION_FACES).sort());
  const sources = readFileSync(join(FONTS_DIR, 'SOURCES.md'), 'utf8');
  const shaOf = (file) => new RegExp(`^- \`${file.replace(/[.[\]]/g, '\\$&')}\` ([0-9a-f]{64})$`, 'm').exec(sources)?.[1];
  for (const [family, f] of Object.entries(BUNDLED_FACES)) {
    const buf = readFileSync(join(FONTS_DIR, f.file));
    const n = fontNames(buf);
    assert.equal(n.family === family || `${n.family}` === family, true, `${f.file}: family ${n.family}, not ${family}`);
    assert.equal(n.postscript, f.postscript, f.file);
    assert.equal(n.hasFvar, false, `${f.file}: a static face (libass registers only a variable font's default instance from fontsdir)`);
    assert.ok(existsSync(join(FONTS_DIR, f.license)), `${f.file}: licence ${f.license}`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), shaOf(f.file), `${f.file}: sha256 as SOURCES.md lists`);
    assert.equal(createHash('sha256').update(readFileSync(join(FONTS_DIR, f.license))).digest('hex'), shaOf(f.license), `${f.license}: sha256`);
  }
  // One face per family in the folder: a second file of a family would make libass's choice depend on load order.
  const fontFiles = readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();
  assert.deepEqual(fontFiles, Object.values(BUNDLED_FACES).map((f) => f.file).sort());
  // The two static copies carry the variable font's default-instance weight, which makes libass embolden them as it
  // emboldens the named instances in boqo's image (scripts/fonts/static_instance.py).
  assert.equal(fontNames(readFileSync(join(FONTS_DIR, 'Montserrat-ExtraBold.ttf'))).weight, 100);
  assert.equal(fontNames(readFileSync(join(FONTS_DIR, 'Oswald-Bold.ttf'))).weight, 400);
});

test('filterPath escapes a path for both filtergraph levels; subtitlesFilter names the ASS and the fonts dir', () => {
  assert.equal(filterPath('C:\\Users\\Jo Doe\\fonts'), 'C\\\\:/Users/Jo Doe/fonts');
  assert.equal(filterPath("/home/o'brien/a,b;[c]"), "/home/o\\\\\\'brien/a\\,b\\;\\[c\\]");
  assert.equal(filterPath('/plain/path'), '/plain/path');
  assert.equal(subtitlesFilter('/a/c.ass', '/f d'), 'subtitles=filename=/a/c.ass:fontsdir=/f d');
});

test('fontFallbacks: a bundled face is clean; a system face, a wrong instance, an unknown family or a missing glyph is not', () => {
  const ok = '[Parsed_subtitles_0 @ 0x1] fontselect: (Oswald, 700, 0) -> Oswald-Bold, 0, Oswald-Bold';
  assert.deepEqual(fontFallbacks(['Using font provider fontconfig', ok, "Loading font file 'x/Oswald-Bold.ttf'"].join('\n')), []);
  const bad = [
    'fontselect: (Montserrat ExtraBold, 700, 0) -> /usr/share/fonts/truetype/noto/NotoSans-Bold.ttf, 0, NotoSans-Bold',
    'fontselect: (Oswald, 700, 0) -> Oswald-Regular, 0, Oswald-Regular',
    // A system copy of the same face: another file (perhaps another version), even under the bundled name.
    'fontselect: (Oswald, 700, 0) -> /Library/Fonts/Oswald-Bold.ttf, 0, Oswald-Bold',
    'fontselect: (Comic Sans, 400, 0) -> ComicSans, 0, ComicSans',
    'Glyph 0x41F not found, selecting one more font for (Anton, 400, 0)',
    'fontselect: failed to find any fallback with glyph 0x41F for font: (Anton, 400, 0)',
    "Error opening font: 'x.ttf', 0",
  ];
  assert.deepEqual(fontFallbacks([ok, ...bad].join('\r\n')), bad);
});

// ---- a real burn: libass, fontsdir, a path with a space ------------------------------------------------------------

const ffmpeg = (args) => spawnSync('ffmpeg', args, { encoding: 'utf8', env: toolEnv(), maxBuffer: 64 << 20 });
const burn = (assPath, fontsDir) => ffmpeg([
  '-hide_banner', '-nostdin', '-loglevel', 'verbose', '-f', 'lavfi', '-i', 'color=c=0x336699:s=1080x1920:r=5:d=3',
  '-vf', subtitlesFilter(assPath, fontsDir), '-f', 'null', '-',
]);
const selected = (log) => log.split(/\r?\n/).filter((l) => /fontselect:/.test(l)).map((l) => l.replace(/^.*fontselect: /, ''));

test('the punch golden ASS burns through fontsdir in a folder with a space: exit 0, every face from the folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo captions '));
  try {
    const fonts = join(root, 'bundled fonts');
    cpSync(FONTS_DIR, fonts, { recursive: true });
    const assPath = join(root, 'punch golden.ass');
    writeFileSync(assPath, golden('build-ass').gallery.find((g) => g.key === 'punch').result.ass);
    const r = burn(assPath, fonts);
    assert.equal(r.status, 0, r.stderr.slice(-3000));
    assert.deepEqual(fontFallbacks(r.stderr), [], selected(r.stderr).join('\n'));
    // Positive control: the detector saw libass load the face from the folder and select it.
    assert.match(r.stderr, /Loading font file '[^']*bundled fonts[\\/]Oswald-Bold\.ttf'/);
    assert.ok(selected(r.stderr).some((l) => l.startsWith('(Oswald, 700, 0) -> Oswald-Bold')), selected(r.stderr).join('\n'));
    // Negative control: a family the folder lacks is drawn from somewhere else, silently, and the detector says so.
    const missing = join(root, 'missing face.ass');
    writeFileSync(missing, golden('build-ass').gallery.find((g) => g.key === 'punch').result.ass.replace('Style: boqo,Oswald,', 'Style: boqo,Nonexistent Face,'));
    const m = burn(missing, fonts);
    assert.equal(m.status, 0, 'libass draws it anyway');
    assert.ok(fontFallbacks(m.stderr).length > 0, `a missing family must show: ${selected(m.stderr).join('\n')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every bundled face burns from fontsdir at its Bold flag, and a Cyrillic clip in a Latin-only style draws with no missing glyph', () => {
  const root = mkdtempSync(join(tmpdir(), 'boqo faces '));
  try {
    // A folder with a space and filtergraph specials in its name (a colon too, where the OS allows one).
    const fonts = join(root, process.platform === 'win32' ? "it's, [odd]; fonts" : "it's, [odd]; fo:nts");
    mkdirSync(fonts);
    cpSync(FONTS_DIR, fonts, { recursive: true });
    const styles = Object.entries(CAPTION_FACES).map(([name, f], k) =>
      `Style: f${k},${name},80,&H00FFFFFF,&H00000000,&H00000000,${f.bold},0,0,0,100,100,0,0,1,4,0,5,0,0,0,1`);
    const lines = Object.entries(CAPTION_FACES).map(([name, f], k) =>
      `Dialogue: 0,0:00:00.00,0:00:02.00,f${k},,0,0,0,,{\\pos(540,${100 + k * 160})}HAMBURG 0123 you've${f.fallback === null ? ' ПРИВЕТ' : ''}`);
    const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 2', '', '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      ...styles, '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...lines, ''].join('\n');
    const all = join(root, 'all faces.ass');
    writeFileSync(all, ass);
    const r = burn(all, fonts);
    assert.equal(r.status, 0, r.stderr.slice(-3000));
    assert.deepEqual(fontFallbacks(r.stderr), [], selected(r.stderr).join('\n'));
    for (const [name, f] of Object.entries(BUNDLED_FACES)) {
      assert.ok(selected(r.stderr).some((l) => l.startsWith(`(${name}, `) && l.includes(`-> ${f.postscript},`)), `${name} -> ${f.postscript}:\n${selected(r.stderr).join('\n')}`);
    }
    // The Cyrillic clip in Comic and in Bold Keys: drawn in the covering faces, every glyph found.
    for (const style of ['comic', 'boldkeys']) {
      const cyr = join(root, `cyrillic ${style}.ass`);
      writeFileSync(cyr, captionsAss({ words: RU, ...WIN, emphasis: ['ракеты', 'этого'], brandCaptions: { style } }));
      const c = burn(cyr, fonts);
      assert.equal(c.status, 0, c.stderr.slice(-3000));
      assert.deepEqual(fontFallbacks(c.stderr), [], `${style}:\n${selected(c.stderr).join('\n')}`);
      assert.ok(selected(c.stderr).some((l) => l.startsWith('(Montserrat ExtraBold, 700, 0) -> Montserrat-ExtraBold')), style);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- A11's parameters, against this task's copies ------------------------------------------------------------------

test('the stream panels golden\'s styles are this copy\'s table entries, and this copy\'s scalePreset gives the numbers it printed', () => {
  // panels-caption-style's golden printed boqo's styles and the scalePreset numbers (panels-text.mjs calls scalePreset
  // itself since A13, as hosted does; tests/panels.test.mjs holds that call to the golden).
  const output = input('panels-caption-style').output;
  for (const entry of golden('panels-caption-style')) {
    assert.deepEqual(entry.style, JSON.parse(JSON.stringify(resolveCaptionStyle(entry.style.key))), entry.style.key);
    if (entry.scaled === null) continue;
    const s = scalePreset(entry.style, output);
    assert.deepEqual(entry.scaled, { maxLines: s.maxLines, lineSpacingRatio: s.lineSpacingRatio, capHeightPx: s.capHeightPx, outlineWidth: s.outlineWidth }, entry.style.key);
  }
});
