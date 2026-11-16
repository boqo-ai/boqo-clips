// boqo's sceneSignalArgs (render/scenes.ts): the ffmpeg argv, plus the greyscale size, for each { path, grayPath }.
import { readFileSync } from "node:fs";
import { GRAY_HEIGHT, GRAY_WIDTH, sceneSignalArgs } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify({ gray: [GRAY_WIDTH, GRAY_HEIGHT], args: input.cases.map((c: any) => sceneSignalArgs(c)) }));
