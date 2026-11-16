// The hosted order of work after the model answers, run on boqo's own functions:
// parseSelectionMessage, then snapAndFilter with the project's target, keep
// ceiling, length band and minScore 0 (apps/worker/src/select/handler.ts, the
// clip path), then replayOf and deriveStandaloneTest for each kept clip with
// sha null. The skill's checkSelection must produce these numbers.
import { readFileSync } from "node:fs";
import { DEFAULT_REPLAY_TUNABLES, discountHeatmap, replayOf } from "../../../../packages/core/src/replay";
import { clipTargetFor, keepCeilingFor } from "../../../../packages/core/src/clip-target";
import { resolveClipLength } from "../../../../packages/core/src/selection-presets";
import { deriveStandaloneTest } from "../../../../packages/core/src/standalone";
import { parseSelectionMessage } from "../select/anthropic";
import { snapAndFilter } from "../select/snap";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => {
      const candidates = parseSelectionMessage({ stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(c.raw) }] });
      const target = clipTargetFor(c.durationSec);
      const cap = keepCeilingFor(target);
      const length = resolveClipLength(c.length);
      const { kept, dropped } = snapAndFilter(candidates, c.segments, { minScore: 0, maxClips: cap, hardMinSec: length.hardMinSec, hardMaxSec: length.hardMaxSec, seedWindow: null });
      const curve = discountHeatmap(c.heatmap, c.chapterStartsSec, DEFAULT_REPLAY_TUNABLES);
      const starts = c.segments.map((s: any) => s.start);
      return {
        name: c.name,
        target,
        cap,
        kept: kept.map((clip) => ({
          clip,
          replay: replayOf(curve, { startSec: clip.startSec, endSec: clip.endSec }, DEFAULT_REPLAY_TUNABLES, null),
          standalone: deriveStandaloneTest(clip.standalone, starts, null, clip.startSec),
        })),
        dropped: dropped.map((d) => d.reason),
      };
    }),
  ),
);
