// boqo's snapCutsToFrames (cut-window.ts).
import { readFileSync } from "node:fs";
import { snapCutsToFrames } from "../render/cut-window";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => snapCutsToFrames(c.cuts, c.frameTimes))));
