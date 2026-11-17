// boqo's captionFloor and panelsCaptionFloor (render/panels-text.ts). A text element is the default headline
// (core's DEFAULT_HEADLINE) with the case's text and position, so its drawn extent is hosted's own
// `textElementExtent`; each element's extent is printed beside the answer, keyed by its text, because the skill's
// copy takes that function as a parameter and its test hands it these numbers.
import { readFileSync } from "node:fs";
import { DEFAULT_HEADLINE } from "../../../../packages/core/src/headline";
import { textElementExtent } from "../render/headline";
import { captionFloor, panelsCaptionFloor } from "../render/panels-text";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const out = input.cases.map((c: any) => {
  const text = c.text.map((t: any) => ({ text: t.text, settings: { ...DEFAULT_HEADLINE, positionFraction: t.positionFraction }, style: undefined, span: t.span }));
  const extents: Record<string, unknown> = {};
  for (const el of text) extents[el.text] = textElementExtent(el, c.output);
  return { name: c.name, seam: captionFloor(c.placed, c.output.height), floor: panelsCaptionFloor(c.placed, c.output, text), extents };
});
console.log(JSON.stringify(out));
