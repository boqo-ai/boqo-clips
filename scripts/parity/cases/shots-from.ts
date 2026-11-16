// boqo's shotsFrom (render/scenes.ts): the contiguous shots for each { cutTimes, durationSec, minShotSec }.
import { readFileSync } from "node:fs";
import { shotsFrom } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => shotsFrom(c.cutTimes, c.durationSec, c.minShotSec))));
