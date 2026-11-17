// boqo's panelPlacement and planGeometryOk, and faceInRect (render/panels-plan.ts), for hand-made and random plans.
import { readFileSync } from "node:fs";
import { faceInRect, panelPlacement, planGeometryOk } from "../render/panels-plan";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    cases: input.cases.map((c: any) => ({
      name: c.name,
      geometryOk: planGeometryOk(c.plan, c.frameWidth, c.frameHeight),
      placed: panelPlacement(c.plan, c.faces, c.frameWidth, c.frameHeight),
    })),
    faceInRect: input.faceInRect.map((c: any) => ({ face: faceInRect(c.rect, c.faces, c.frameWidth, c.frameHeight) })),
  }),
);
