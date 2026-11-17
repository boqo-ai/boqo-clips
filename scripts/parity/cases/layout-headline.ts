// boqo's headline layout (apps/worker/src/render/headline.ts): `layoutHeadline` (wrap and shrink to fit), the plate
// `headlinePlate` draws around it and `roundedRectPath`, over the case's scenarios: 1, 2 and 3 lines, shrink to fit and
// overflow, at three ratios, in all eleven faces, at the schema's knob extremes, with Cyrillic, braces and spaces.
import { readFileSync } from "node:fs";
import { fontMetrics } from "../../../../packages/core/src/caption-metrics";
import { headlinePlate, layoutHeadline, roundedRectPath } from "../render/headline";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    scenarios: input.scenarios.map((s: any) => {
      const layout = layoutHeadline(s.text, s.headline, s.frame);
      const plate = headlinePlate(layout, s.headline, s.frame, fontMetrics(s.headline.font.name));
      return { name: s.name, layout, plate, path: roundedRectPath(plate.width, plate.height, plate.radius) };
    }),
    paths: input.paths.map(([w, h, r]: number[]) => ({ w, h, r, path: roundedRectPath(w!, h!, r!) })),
  }),
);
