// boqo's cutsFromSignals (render/scenes.ts): { cuts, strong, weak } for each case. Frames are flat 0..1 values.
import { readFileSync } from "node:fs";
import { cutsFromSignals } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => cutsFromSignals(c.scores, c.frames.map((f: number[]) => Float32Array.from(f)), c.opts)),
  ),
);
