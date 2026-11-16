// boqo's sampleTimes, enoughFrames and frameArgs (panels/frames.ts).
import { readFileSync } from "node:fs";
import { enoughFrames, frameArgs, sampleTimes } from "../panels/frames";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    sampleTimes: input.sampleCases.map((c: any) => ({ name: c.name, times: sampleTimes(c.shots, c.stepSec, c.maxFrames) })),
    enough: input.enough.map(([extracted, wanted]: number[]) => ({ extracted, wanted, enough: enoughFrames(extracted!, wanted!) })),
    args: input.args.map((a: any) => frameArgs(a)),
  }),
);
