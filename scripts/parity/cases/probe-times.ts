// boqo's probeTimes (panels/probe.ts): the midpoints of the first `count` clips with a length.
import { readFileSync } from "node:fs";
import { probeTimes } from "../panels/probe";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, times: probeTimes(c.clips, c.count) }))));
