// boqo's pathExpression (render/track.ts) for each { points } case.
import { readFileSync } from "node:fs";
import { pathExpression } from "../render/track";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => pathExpression(c.points))));
