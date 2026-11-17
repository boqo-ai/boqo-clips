// boqo's keptSegments and cutsDurationSec (packages/core cut-map.ts).
import { readFileSync } from "node:fs";
import { cutsDurationSec, keptSegments } from "../../../../packages/core/src/cut-map";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(input.cases.map((c: any) => ({ kept: keptSegments(c.windowDurationSec, c.cuts), cutSec: cutsDurationSec(c.cuts) }))),
);
