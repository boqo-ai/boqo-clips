// boqo's samplesByShot, planPanelShots, readingKept and sourceToClipSec (render/panels-plan.ts), composed the way
// pipeline.ts's planShots composes them: stored samples (source seconds) mapped onto the clip's timeline through the
// window's start and cuts, split by shot, then planned with `keep` false for the case's `keepOut` shots.
import { readFileSync } from "node:fs";
import { planPanelShots, readingKept, samplesByShot, sourceToClipSec } from "../render/panels-plan";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const cases = input.cases.map((c: any) => {
  const byShot = samplesByShot(c.samples, c.shots, (sourceSec: number) => sourceToClipSec(sourceSec, c.startSec, c.cuts));
  const plans = planPanelShots({
    samplesByShot: byShot,
    shots: c.shots,
    faces: c.shots.map((_: unknown, i: number) => c.faces?.[i] ?? []),
    frameWidth: c.frameWidth,
    frameHeight: c.frameHeight,
    output: c.output,
    cuts: c.cuts,
    gameZoom: c.gameZoom,
    keep: (index: number) => !c.keepOut.includes(index),
  });
  return { name: c.name, byShot, plans };
});
console.log(
  JSON.stringify({
    cases,
    readingKept: input.readingKept.map((r: any) => ({ ...r, kept: readingKept(r.override ?? undefined, r.mode) })),
    sourceToClip: input.sourceToClip.map((r: any) => ({ ...r, clipSec: sourceToClipSec(r.sourceSec, r.startSec, r.cuts) })),
  }),
);
