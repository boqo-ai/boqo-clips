// boqo's compressPath (render/track.ts) for each { points, quantum? } case.
import { readFileSync } from "node:fs";
import { compressPath } from "../render/track";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => (c.quantum === undefined ? compressPath(c.points) : compressPath(c.points, c.quantum)))));
