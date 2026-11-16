// boqo's transcriptGaps (packages/core pause-cuts.ts).
import { readFileSync } from "node:fs";
import { transcriptGaps } from "../../../../packages/core/src/pause-cuts";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => transcriptGaps(c.words, c.minSec))));
