// boqo's panelsTextElements (render/panels-text.ts): each text element placed per run of shots. Elements are the
// default headline with the case's text, position, span and timing. Printed per element: its text, position, span
// and part, and whether the function returned the very array and the very objects it was given.
import { readFileSync } from "node:fs";
import { DEFAULT_HEADLINE } from "../../../../packages/core/src/headline";
import { panelsTextElements } from "../render/panels-text";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const out = input.scenarios.map((s: any) => {
  const elements = s.elements.map((e: any) => ({ text: e.text, settings: { ...DEFAULT_HEADLINE, positionFraction: e.positionFraction, timing: e.timing }, style: undefined, span: e.span }));
  const placed = panelsTextElements(elements, s.placed, s.output, s.clipDurationSec);
  return {
    name: s.name,
    sameArray: placed === elements,
    elements: placed.map((p: any) => ({
      text: p.text,
      positionFraction: p.settings.positionFraction,
      span: p.span,
      part: p.part ?? null,
      sameObject: elements.includes(p),
    })),
  };
});
console.log(JSON.stringify(out));
