// boqo's frameRatios (render/scenes.ts): the ratio list for each { scores, window }.
import { readFileSync } from "node:fs";
import { frameRatios } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => frameRatios(c.scores, c.window))));
