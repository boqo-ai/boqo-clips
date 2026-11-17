// boqo's settleArgs (settle-end.ts): the ffmpeg argv that reads the half second before an edge.
import { readFileSync } from "node:fs";
import { settleArgs } from "../render/settle-end";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => settleArgs(c.sourceUrl, c.endSec))));
