// boqo's rankClips and rankTerms (the hosted "Ranked" order, packages/core/src/rank.ts) over synthetic
// clips: a failing clip with a high score last, pct plus judgment, score and start tie-breaks, null and
// malformed columns (each contributes 0 and is never a failure), a stable order for full ties.
// The columns come in whole (as the jsonb columns hold them); a null column is null.
import { readFileSync } from "node:fs";
import { rankClips, rankTerms } from "../../../../packages/core/src/rank";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => ({
      name: c.name,
      order: rankClips(c.clips).map((x: any) => x.id),
      terms: Object.fromEntries(c.clips.map((x: any) => [x.id, rankTerms(x)])),
    })),
  ),
);
