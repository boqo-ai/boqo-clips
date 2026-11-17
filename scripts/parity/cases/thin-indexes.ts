// boqo's thinIndexes and frameLabel (apps/worker/src/stranger/frames.ts): which of n extracted keyframes are sent
// (max 12) and the label each carries, `keyframe {i+1} at ~{N}s`. n = 13 is the tie that Python's rounding sends
// to the even number (32.5 -> 32), where Math.round would say 33.
import { readFileSync } from "node:fs";
import { frameLabel, pyRound0, thinIndexes } from "../stranger/frames";

const { ns, max, ties } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    cases: ns.map((n: number) => {
      const idx = thinIndexes(n, max);
      return { n, max, indexes: idx, labels: idx.map((_: number, i: number) => frameLabel(i, n, idx.length)) };
    }),
    rounds: ties.map((x: number) => ({ x, r: pyRound0(x) })),
  }),
);
