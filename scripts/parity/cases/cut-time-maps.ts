// boqo's windowToClipSec and clipToWindowSec (packages/core/src/cut-map.ts) over cut sets and times.
import { readFileSync } from "node:fs";
import { clipToWindowSec, windowToClipSec } from "../../../../packages/core/src/cut-map";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cutSets.map((cuts: any) => ({
      cuts,
      windowToClip: input.times.map((t: number) => windowToClipSec(t, cuts)),
      clipToWindow: input.times.map((t: number) => clipToWindowSec(t, cuts)),
    })),
  ),
);
