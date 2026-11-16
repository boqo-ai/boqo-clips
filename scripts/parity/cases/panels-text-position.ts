// boqo's panelsTextPosition (render/panels-text.ts): where a text element's centre goes over a clip's panels shots.
import { readFileSync } from "node:fs";
import { panelsTextPosition } from "../render/panels-text";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, position: panelsTextPosition(c) }))));
