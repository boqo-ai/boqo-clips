// boqo's findPeakRegions over several synthetic heatmaps (camelCase bins, as
// HeatmapEntry): absent, too few bins, flat, a normal graph, a plateau beside
// a bad bin, and one with more than twelve regions.
import { readFileSync } from "node:fs";
import { findPeakRegions } from "../select/peaks";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(cases.map((c: any) => ({ name: c.name, regions: findPeakRegions(c.heatmap, c.durationSec) }))));
