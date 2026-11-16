// boqo's brand caption block (packages/core/src/caption-overrides.ts) and the tables under it: BrandCaptions.safeParse
// over valid and invalid blocks (success and data; zod's messages are not compared); applyCaptionOverrides of every
// valid block over every preset and style (identity, and a result that is not the preset itself as one JSON string
// so the golden stays small); resolveProjectCaptions under the case's keys (a table entry returned as itself prints
// its key only); resolveClipCaptions; defaultCaptionStyle, countCaptionOverrides,
// captionOverridesReach, captionStyleTier and knobsFor; the band constants, CAPTION_FONTS, the gallery's keys and the
// pickable list; the fingerprints; sizeCeilingOf and captionSizeCeiling per ratio, with the three numbers scalePreset
// and scalePresetExact scale (cap height, outline, side margin).
// The first block is boqo's Default template's captions (spec §6).
import { readFileSync } from "node:fs";
import {
  BrandCaptions, CAPTION_FONTS, CAPTION_POSITION_MAX, CAPTION_POSITION_MIN, applyCaptionOverrides, captionOverridesReach,
  countCaptionOverrides, defaultCaptionStyle, resolveClipCaptions, resolveProjectCaptions,
} from "../../../../packages/core/src/caption-overrides";
import {
  BRAND_CAPTION_KEY, CAPTION_PRESETS, CAPTION_SIZE_MAX, CAPTION_SIZE_MIN, CAPTION_WORDS_MAX, CAPTION_WORDS_MIN,
  DEFAULT_CAPTION_PRESET_KEY, POSITIONED_PRESETS, captionPresetFingerprint, captionSizeCeiling, scalePreset,
  scalePresetExact, sizeCeilingOf,
} from "../../../../packages/core/src/caption-presets";
import { CAPTION_STYLES, GALLERY_CAPTION_STYLE_KEYS, GALLERY_CAPTION_STYLES, captionStyleFingerprint, knobsFor } from "../../../../packages/core/src/caption-styles";
import { PICKABLE_CAPTION_STYLES, captionStyleTier, resolveCaptionStyle } from "../../../../packages/core/src/caption-style-registry";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const parse = (c: unknown) => {
  const r = BrandCaptions.safeParse(c);
  return r.success ? { success: true, data: r.data } : { success: false };
};
const blocks = input.captions.map((c: unknown) => BrandCaptions.parse(c));
const all = [...CAPTION_PRESETS, ...CAPTION_STYLES];
console.log(
  JSON.stringify({
    parse: [...input.captions, ...input.invalid].map(parse),
    apply: blocks.flatMap((captions: any, b: number) =>
      [undefined, ...all].map((preset) => {
        const p = preset ?? all[0]!;
        const result = applyCaptionOverrides(p, preset === undefined ? undefined : captions);
        return { b, key: p.key, undefinedBlock: preset === undefined, identity: result === p, result: result === p ? null : JSON.stringify(result) };
      }),
    ),
    project: input.keys.flatMap((key: string | null) =>
      [undefined, ...blocks].map((captions: any, b: number) => {
        const r = resolveProjectCaptions(key, captions);
        const table = all.find((p) => p.key === r.preset.key);
        return { key, b: b - 1, presetKey: r.preset.key, tableEntry: table !== undefined && r.preset === table, preset: table !== undefined && r.preset === table ? null : JSON.stringify(r.preset), overridesApplied: r.overridesApplied };
      }),
    ),
    clip: input.clip.map((c: any) => {
      const r = resolveClipCaptions({ ...c, brandCaptions: c.brandCaptions === undefined ? undefined : BrandCaptions.parse(c.brandCaptions) });
      return { preset: JSON.stringify(r.preset), overridesApplied: r.overridesApplied, clipOverridesApplied: r.clipOverridesApplied };
    }),
    defaultStyle: [undefined, ...blocks].map((c: any) => defaultCaptionStyle(c)),
    count: [undefined, ...blocks].map((c: any) => countCaptionOverrides(c)),
    reach: input.keys.map((k: string | null) => captionOverridesReach(k)),
    tier: input.keys.map((k: string | null) => captionStyleTier(k)),
    resolve: input.keys.map((k: string | null) => resolveCaptionStyle(k).key),
    knobs: [...GALLERY_CAPTION_STYLES, ...CAPTION_STYLES].map((p) => ({ key: p.key, knobs: knobsFor(p) })),
    constants: {
      BRAND_CAPTION_KEY, DEFAULT_CAPTION_PRESET_KEY, CAPTION_WORDS_MIN, CAPTION_WORDS_MAX, CAPTION_SIZE_MIN, CAPTION_SIZE_MAX,
      CAPTION_POSITION_MIN, CAPTION_POSITION_MAX, CAPTION_FONTS, GALLERY_CAPTION_STYLE_KEYS,
      positioned: POSITIONED_PRESETS.map((p) => p.key), pickable: PICKABLE_CAPTION_STYLES.map((p) => p.key),
    },
    fingerprints: { presets: captionPresetFingerprint(), styles: captionStyleFingerprint() },
    sizes: input.outputs.map((output: any) => ({
      output,
      ceiling: captionSizeCeiling(output),
      perPreset: [...POSITIONED_PRESETS, ...CAPTION_STYLES].map((p) => {
        const [sc, ex] = [scalePreset(p, output), scalePresetExact(p, output)];
        const pick = (q: any) => [q.capHeightPx, q.outlineWidth, q.sideMarginPx];
        return { key: p.key, ceiling: sizeCeilingOf(p, output), scaled: pick(sc), exact: pick(ex), scaledIsPreset: sc === p };
      }),
    })),
  }),
);
