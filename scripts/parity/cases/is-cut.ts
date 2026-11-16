// boqo's isCut (render/scenes.ts): the verdict for each { input, opts }.
import { readFileSync } from "node:fs";
import { isCut } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => isCut(c.input, c.opts))));
