// boqo's cutWindowArgs, frameTimesArgs and parseFrameTimes (cut-window.ts).
import { readFileSync } from "node:fs";
import { cutWindowArgs, frameTimesArgs, parseFrameTimes } from "../render/cut-window";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    cutWindowArgs: input.cases.map((c: any) => cutWindowArgs(c.args)),
    frameTimesArgs: frameTimesArgs(input.frameTimes.path),
    parseFrameTimes: parseFrameTimes(input.frameTimes.stdout),
  }),
);
