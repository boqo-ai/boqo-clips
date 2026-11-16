// boqo's abuttingEdge over word lists (settle-end.ts): null or { lastWordStartSec } for each case.
import { readFileSync } from "node:fs";
import { abuttingEdge } from "../render/settle-end";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => abuttingEdge(c.words, c.endSec))));
