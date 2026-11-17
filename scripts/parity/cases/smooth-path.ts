// boqo's smoothPath (render/track.ts) for each { samples, options } case.
import { readFileSync } from "node:fs";
import { smoothPath } from "../render/track";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => smoothPath(c.samples, c.options))));
