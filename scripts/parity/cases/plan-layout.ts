// boqo's planLayout (render/crop.ts) for each case's input (Fit with no faces, Stack, Fill, a refused stack, the
// overrides and the fit pin), and stackAllowed and countedFaces on the same faces. RENDER_* variables unset.
import { readFileSync } from "node:fs";
import { countedFaces, planLayout, stackAllowed } from "../render/crop";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => ({
      name: c.name,
      layout: planLayout(c.input),
      stackAllowed: stackAllowed({ faces: c.input.faces, minCoverage: c.input.minCoverage, minCopresence: c.input.minCopresence }),
      countedFaces: countedFaces(c.input.faces, c.input.minCoverage),
    })),
  ),
);
