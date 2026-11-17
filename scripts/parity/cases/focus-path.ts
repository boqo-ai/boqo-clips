// boqo's focusPath (render/panels-plan.ts): a move-and-hold path through keys.
import { readFileSync } from "node:fs";
import { focusPath } from "../render/panels-plan";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, path: focusPath(c.keys, c.holdPx) }))));
