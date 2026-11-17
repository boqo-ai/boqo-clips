// boqo's headline schema and rules (packages/core/src/headline.ts): `BrandHeadline` over valid and invalid blocks,
// `headlineInk` over a colour grid (and its luminance and contrast), `headlineText`, `headlineWindow`, the geometry
// constants and ceilings, `headlinePlateHeight`, `DEFAULT_HEADLINE` and the field list.
import { readFileSync } from "node:fs";
import {
  BrandHeadline, DEFAULT_HEADLINE, HEADLINE_BOX_MAX, HEADLINE_BOX_MIN, HEADLINE_CAP_CEILING, HEADLINE_CAP_MAX, HEADLINE_CAP_MIN,
  HEADLINE_FIELDS, HEADLINE_GLYPH_BOX_RATIO, HEADLINE_INK_DARK, HEADLINE_INK_LIGHT, HEADLINE_LINE_SPACING_RATIO, HEADLINE_MAX_LINES,
  HEADLINE_MIN_CONTRAST, HEADLINE_PAD_X_RATIO, HEADLINE_PAD_Y_RATIO, HEADLINE_PLATE_OPACITY_MIN, HEADLINE_POSITION_MAX,
  HEADLINE_POSITION_MIN, HEADLINE_RADIUS_MAX, HEADLINE_RADIUS_MIN, HEADLINE_SOURCES, HeadlineSource, contrastRatio, headlineBoxCeiling,
  headlineInk, headlinePlateHeight, headlineText, headlineWindow, relativeLuminance,
} from "../../../../packages/core/src/headline";
import { BrandTiming } from "../../../../packages/core/src/brand-timing";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const parse = (h: unknown) => {
  const r = BrandHeadline.safeParse(h);
  return r.success ? { ok: true, data: r.data } : { ok: false, paths: r.error.issues.map((i) => i.path.join(".") || "(block)") };
};
console.log(
  JSON.stringify({
    constants: {
      HEADLINE_BOX_MAX, HEADLINE_BOX_MIN, HEADLINE_CAP_CEILING, HEADLINE_CAP_MAX, HEADLINE_CAP_MIN, HEADLINE_GLYPH_BOX_RATIO,
      HEADLINE_INK_DARK, HEADLINE_INK_LIGHT, HEADLINE_LINE_SPACING_RATIO, HEADLINE_MAX_LINES, HEADLINE_MIN_CONTRAST,
      HEADLINE_PAD_X_RATIO, HEADLINE_PAD_Y_RATIO, HEADLINE_PLATE_OPACITY_MIN, HEADLINE_POSITION_MAX, HEADLINE_POSITION_MIN,
      HEADLINE_RADIUS_MAX, HEADLINE_RADIUS_MIN, HEADLINE_SOURCES, HEADLINE_FIELDS, DEFAULT_HEADLINE,
    },
    sourceOptions: HeadlineSource.options,
    timing: [{ kind: "whole" }, { kind: "window", startSec: 0, holdSec: 12 }, { kind: "window", startSec: 0, holdSec: 0.4 }, { kind: "x" }].map((t) => {
      const r = BrandTiming.safeParse(t);
      return r.success ? { ok: true, data: r.data } : { ok: false };
    }),
    ink: input.inks.map((c: string) => ({ c, ink: headlineInk(c) })),
    luminance: input.luminance.map((c: string) => ({ c, l: relativeLuminance(c) })),
    contrast: input.contrast.map(([a, b]: number[]) => ({ a, b, ratio: contrastRatio(a!, b!) })),
    valid: input.valid.map(parse),
    invalid: input.invalid.map(parse),
    boxCeilings: input.boxFrames.map((f: any) => ({ f, ceiling: headlineBoxCeiling(f) })),
    plateHeights: input.plateHeights.map(([lines, cap]: number[]) => ({ lines, cap, h: headlinePlateHeight(lines!, cap!) })),
    texts: input.texts.headlines.map((h: any, hi: number) => input.texts.clips.map((c: any) => ({ hi, c, text: headlineText(h ?? undefined, c) }))),
    windows: input.windows.map((w: any) => ({ ...w, window: headlineWindow({ ...DEFAULT_HEADLINE, timing: w.timing }, w.clipDurationSec) })),
  }),
);
