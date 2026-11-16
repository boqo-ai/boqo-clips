// boqo's parseSceneScores (render/scenes.ts): [{ timeSec, score }] for each ffmpeg stdout text.
import { readFileSync } from "node:fs";
import { parseSceneScores } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(Object.fromEntries(Object.entries(input.cases).map(([k, text]) => [k, parseSceneScores(text as string)]))));
