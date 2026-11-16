// Smoke case: boqo's clipTargetFor over fixed durations (seconds). §6 fixes the
// result: [1, 2, 40, 120], the 1-to-120 clamp of round(minutes).
import { readFileSync } from "node:fs";
import { clipTargetFor } from "../../../../packages/core/src/clip-target";

const durations: number[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(durations.map((d) => clipTargetFor(d))));
