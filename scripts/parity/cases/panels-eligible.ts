// boqo's panelsEligible, panelsSourceEligible and panelsOutputEligible (render/panels-plan.ts) for every source frame
// against every output size of the case's input.
import { readFileSync } from "node:fs";
import { panelsEligible, panelsOutputEligible, panelsSourceEligible } from "../render/panels-plan";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const out: unknown[] = [];
for (const frame of input.frames) {
  for (const output of input.outputs) {
    out.push({ frame, output, eligible: panelsEligible(frame, output), source: panelsSourceEligible(frame), output_: panelsOutputEligible(output) });
  }
}
console.log(JSON.stringify(out));
