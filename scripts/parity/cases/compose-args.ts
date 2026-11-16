// boqo's encode argv: `composeArgs` (apps/worker/src/render/compose.ts) with and without the logo input and with the
// progress stream, `POSTED_VIDEO_ENCODE` and `postedFrame` (render/posted-encode.ts), and `thumbnailArgs`
// (render/thumbnail.ts) at the times the render asks for (`min(1, dur / 2)`).
import { readFileSync } from "node:fs";
import { composeArgs } from "../render/compose";
import { POSTED_MAX_SIZE, POSTED_VIDEO_ENCODE, postedFrame } from "../render/posted-encode";
import { thumbnailArgs } from "../render/thumbnail";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    POSTED_VIDEO_ENCODE,
    POSTED_MAX_SIZE,
    frames: input.frames.map((f: any) => ({ f, frame: postedFrame(f) })),
    compose: input.compose.map((c: any) => ({ c, args: composeArgs(c) })),
    thumbnails: input.durations.map((d: number) => ({
      d,
      args: thumbnailArgs({ videoPath: input.videoPath, atSec: Math.min(1, d / 2), outPath: input.thumbPath }),
    })),
  }),
);
