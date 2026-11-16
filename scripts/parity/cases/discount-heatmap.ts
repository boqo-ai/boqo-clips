// boqo's discountHeatmap, curveBins and replayOf over synthetic heatmaps and
// windows. A null tunables entry means DEFAULT_REPLAY_TUNABLES.
import { readFileSync } from "node:fs";
import { DEFAULT_REPLAY_TUNABLES, curveBins, discountHeatmap, replayOf } from "../../../../packages/core/src/replay";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => {
      const t = c.tunables ?? DEFAULT_REPLAY_TUNABLES;
      const curve = discountHeatmap(c.heatmap, c.chapterStartsSec, t);
      return {
        name: c.name,
        curve,
        bins: curve === null ? null : curveBins(curve),
        replays: (c.windows ?? []).map((w: any) => replayOf(curve, w, t, c.sha ?? null)),
      };
    }),
  ),
);
