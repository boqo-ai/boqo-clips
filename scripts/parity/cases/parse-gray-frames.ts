// boqo's parseGrayFrames (render/scenes.ts): the frames (0..1) for each { bytes, width, height }.
import { readFileSync } from "node:fs";
import { parseGrayFrames } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => parseGrayFrames(Uint8Array.from(c.bytes), c.width, c.height).map((f) => Array.from(f))),
  ),
);
