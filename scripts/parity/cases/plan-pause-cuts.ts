// boqo's planPauseCuts (packages/core pause-cuts.ts): { cuts, skipped, gaps, pauses } for each case.
import { readFileSync } from "node:fs";
import { planPauseCuts } from "../../../../packages/core/src/pause-cuts";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => planPauseCuts({ words: c.words, quietRuns: c.quietRuns, windowDurationSec: c.windowDurationSec, config: c.config })),
  ),
);
