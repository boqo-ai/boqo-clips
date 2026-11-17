// boqo's parseTimestamps and pickReactions over synthetic comments: the
// timestamp grammar, chapter lists, duplicates inside ten seconds, a cap of
// twelve, and the sanitiser's cut.
import { readFileSync } from "node:fs";
import { parseTimestamps, pickReactions } from "../../../../packages/core/src/viewer-reactions";

const { cases, stamps } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    stamps: stamps.map((s: string) => ({ text: s, seconds: parseTimestamps(s) })),
    cases: cases.map((c: any) => ({ name: c.name, reactions: pickReactions(c.comments, c.durationSec) })),
  }),
);
