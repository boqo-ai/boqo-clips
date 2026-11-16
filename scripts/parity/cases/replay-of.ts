// boqo's replayOf on a clip's window over a discounted most-replayed curve:
// windows inside, straddling and outside the bins, a chapter discount, custom
// tunables, no heatmap, a flat heatmap. A null tunables entry means DEFAULT_REPLAY_TUNABLES.
import { readFileSync } from "node:fs";
import { DEFAULT_REPLAY_TUNABLES, discountHeatmap, replayOf } from "../../../../packages/core/src/replay";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => {
      const t = c.tunables ?? DEFAULT_REPLAY_TUNABLES;
      const curve = discountHeatmap(c.heatmap, c.chapterStartsSec, t);
      return { name: c.name, replays: c.windows.map((w: any) => replayOf(curve, w, t, c.sha)) };
    }),
  ),
);
