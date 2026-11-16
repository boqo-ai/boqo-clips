// boqo's loudness pass (apps/worker/src/render/loudness.ts): `measureArgs` and `applyArgs` at `CLIP_LOUDNESS`
// (@boqo/core, -14 LUFS, -1 dBTP, LRA 7) and at the case's other targets, `clipLoudnessTarget`, and
// `parseLoudnormJson` over loudnorm's stderr as ffmpeg 5.1.9 and 8.1 print it, and over broken blocks.
import { readFileSync } from "node:fs";
import { CLIP_LOUDNESS } from "../../../../packages/core/src/loudness";
import { applyArgs, clipLoudnessTarget, measureArgs, parseLoudnormJson } from "../render/loudness";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const targets = [CLIP_LOUDNESS, ...input.targets];
console.log(
  JSON.stringify({
    CLIP_LOUDNESS,
    targets: input.loudness.map((l: any) => ({ l, target: clipLoudnessTarget(l) })),
    measure: targets.map((t: any) => measureArgs(input.inPath, t)),
    apply: targets.flatMap((t: any) => input.measures.map((m: any) => applyArgs(input.inPath, input.outPath, t, m))),
    parsed: input.stderr.map((s: string) => parseLoudnormJson(s)),
  }),
);
