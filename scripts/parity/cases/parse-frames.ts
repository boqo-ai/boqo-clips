// boqo's parseFrames over synthetic ametadata stderr (settle-end.ts): frames or null for each case.
import { readFileSync } from "node:fs";
import { parseFrames } from "../render/settle-end";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => parseFrames(c.stderrLines.join("\n"), c.fromSec))));
