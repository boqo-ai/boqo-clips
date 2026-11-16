// boqo's cropSize (render/crop.ts) for each case, with the geometry it builds on: evenDown, targetRatio, panelSize
// and baseWindowWidth.
import { readFileSync } from "node:fs";
import { baseWindowWidth, cropSize, evenDown, panelSize, targetRatio } from "../render/crop";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    sizes: input.sizes.map((c: any) => cropSize(c)),
    evenDown: input.evenDown.map((v: number) => evenDown(v)),
    targetRatio: input.outputs.map((o: any) => targetRatio(o)),
    panelSize: input.outputs.map((o: any) => panelSize(o)),
    baseWindowWidth: input.baseWindowWidth.map((c: any) => baseWindowWidth(c.frameWidth, c.frameHeight, c.output)),
  }),
);
