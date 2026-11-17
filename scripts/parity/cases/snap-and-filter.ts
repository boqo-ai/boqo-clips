// boqo's snapAndFilter over synthetic 5 s segments: inverted, too short, too long,
// overlap at 30% (dropped) and at 20% and 25% (kept), over the cap, below the
// threshold, snapping ties, a seed window, a custom length band.
import { readFileSync } from "node:fs";
import { snapAndFilter } from "../select/snap";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => ({ name: c.name, result: snapAndFilter(c.candidates, c.segments, c.opts) })),
  ),
);
