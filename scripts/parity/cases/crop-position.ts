// boqo's cropPosition and cropWindow (render/crop.ts), one result per case.
import { readFileSync } from "node:fs";
import { cropPosition, cropWindow } from "../render/crop";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    positions: input.positions.map((c: any) => cropPosition(c)),
    windows: input.windows.map((c: any) => cropWindow(c)),
  }),
);
