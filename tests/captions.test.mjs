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

// ---- A11's parameters, against this task's copies ------------------------------------------------------------------

test('the stream panels text module\'s copied caption bound and its scalePreset numbers are this copy\'s', async () => {
  const { CAPTION_POSITION_MAX: PANELS_CAPTION_POSITION_MAX } = await import('../engine/boqo/panels-text.mjs');
  assert.equal(PANELS_CAPTION_POSITION_MAX, CAPTION_POSITION_MAX);
  // panels-caption-style's golden printed boqo's styles and the scalePreset numbers A11's copy takes as a parameter:
  // the styles are this copy's table entries, and this copy's scalePreset gives the same numbers.
  const output = input('panels-caption-style').output;
  for (const entry of golden('panels-caption-style')) {
    assert.deepEqual(entry.style, JSON.parse(JSON.stringify(resolveCaptionStyle(entry.style.key))), entry.style.key);
    if (entry.scaled === null) continue;
    const s = scalePreset(entry.style, output);
    assert.deepEqual(entry.scaled, { maxLines: s.maxLines, lineSpacingRatio: s.lineSpacingRatio, capHeightPx: s.capHeightPx, outlineWidth: s.outlineWidth }, entry.style.key);
  }
});
