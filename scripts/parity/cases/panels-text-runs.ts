// boqo's panelsTextRuns (render/panels-text.ts): a text element's time on screen cut into runs of shots.
import { readFileSync } from "node:fs";
import { panelsTextRuns } from "../render/panels-text";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, runs: panelsTextRuns(c) }))));
