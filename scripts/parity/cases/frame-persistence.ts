// boqo's framePersistence (render/scenes.ts): the persistence list for each { frames, lead }.
import { readFileSync } from "node:fs";
import { framePersistence } from "../render/scenes";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(input.cases.map((c: any) => framePersistence(c.frames.map((f: number[]) => Float32Array.from(f)), c.lead))),
);
