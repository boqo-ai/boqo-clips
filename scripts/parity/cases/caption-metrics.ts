// boqo's caption metrics (packages/core/src/caption-metrics.ts and its generated caption-metrics-table.ts): the whole
// table, assFontSize over cap heights, measureWidth over texts (a character the table lacks takes fallbackAdvance),
// and what fontMetrics throws for a face the table does not hold.
import { readFileSync } from "node:fs";
import { CAPTION_METRICS, assFontSize, fontMetrics, measureWidth } from "../../../../packages/core/src/caption-metrics";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    table: CAPTION_METRICS,
    sizes: input.sizes.map(([cap, face]: [number, string]) => assFontSize(fontMetrics(face), cap)),
    widths: input.widths.map(([face, text, size]: [string, string, number]) => measureWidth(fontMetrics(face), text, size)),
    unknown: input.unknown.map((face: string) => { try { fontMetrics(face); return null; } catch (e) { return (e as Error).message; } }),
  }),
);
