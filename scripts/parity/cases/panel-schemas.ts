// boqo's zod schemas for the panel read (packages/core/src/panels.ts): whether each raw value parses, and what it
// parses to. Hosted's zod and the skill's are both ^4.4.3.
import { readFileSync } from "node:fs";
import { PanelDecision, PanelProbe, PanelRect, PanelSample } from "../../../../packages/core/src/panels";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const parse = (schema: any, raw: unknown) => {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, paths: r.error.issues.map((i: any) => i.path.join(".")) };
};
console.log(
  JSON.stringify({
    rects: input.rects.map((r: unknown) => parse(PanelRect, r)),
    samples: input.samples.map((r: unknown) => parse(PanelSample, r)),
    decisions: input.decisions.map((r: unknown) => parse(PanelDecision, r)),
    probes: input.probes.map((r: unknown) => parse(PanelProbe, r)),
  }),
);
