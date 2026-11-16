// boqo's fpsFromScores (render/scenes.ts): the frame rate for each { scores }.
import { readFileSync } from "node:fs";
import { fpsFromScores } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => fpsFromScores(c.scores))));
