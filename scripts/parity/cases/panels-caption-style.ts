// boqo's panelsCaptionStyle (render/panels-text.ts) for every style in the gallery and the legacy and `none` presets, over the case's scenarios. Printed with each preset: the style as hosted holds it and its
// `scalePreset` numbers the function reads (maxLines, lineSpacingRatio, capHeightPx, outlineWidth), because the
// skill's copy takes `scalePreset` as a parameter and its test hands it these numbers. Each scenario's text
// elements are the default headline at the case's position, and the function gets hosted's `textElementExtent`
// for them; their extents are printed too.
import { readFileSync } from "node:fs";
import { CAPTION_PRESETS, scalePreset } from "../../../../packages/core/src/caption-presets";
import { GALLERY_CAPTION_STYLES } from "../../../../packages/core/src/caption-styles";
import { DEFAULT_HEADLINE } from "../../../../packages/core/src/headline";
import { textElementExtent } from "../render/headline";
import { panelsCaptionStyle } from "../render/panels-text";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const out: unknown[] = [];
for (const s of input.scenarios) {
  const text = s.text.map((t: any) => ({ text: t.text, settings: { ...DEFAULT_HEADLINE, positionFraction: t.positionFraction }, style: undefined, span: t.span }));
  const extents: Record<string, unknown> = {};
  for (const el of text) extents[el.text] = textElementExtent(el, input.output);
  // The gallery's positioned styles, then the legacy and `none` presets (which the function returns as they are).
  for (const style of [...GALLERY_CAPTION_STYLES, ...CAPTION_PRESETS.filter((p) => p.emission !== "positioned")]) {
    const scaled = style.emission === "positioned" ? scalePreset(style, input.output) : null;
    out.push({
      scenario: s.name,
      style,
      scaled: scaled && { maxLines: scaled.maxLines, lineSpacingRatio: scaled.lineSpacingRatio, capHeightPx: scaled.capHeightPx, outlineWidth: scaled.outlineWidth },
      extents,
      result: panelsCaptionStyle(style, s.placed, input.output, text),
    });
  }
}
console.log(JSON.stringify(out));
