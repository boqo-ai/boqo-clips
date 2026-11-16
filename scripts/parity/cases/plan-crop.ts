// boqo's planCrop (render/crop.ts): { placement, speaker } for each case's input (Fill, Track, a static path, no
// subject). RENDER_* variables unset, as on the production worker.
import { readFileSync } from "node:fs";
import { planCrop } from "../render/crop";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, ...planCrop(c.input) }))));
