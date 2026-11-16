// boqo's chooseSpeaker (render/crop.ts): the face each { faces, motionFloor, rule? } case aims at, or null.
import { readFileSync } from "node:fs";
import { chooseSpeaker } from "../render/crop";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => chooseSpeaker(c.faces, c.motionFloor, c.rule))));
