// boqo's extractArgs (render/extract.ts): the stream-copy extract argv, or { error } for a bad window.
import { readFileSync } from "node:fs";
import { extractArgs } from "../render/extract";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => {
      try {
        return extractArgs({ url: c.url, startSec: c.startSec, endSec: c.endSec, outPath: c.outPath });
      } catch (error) {
        return { error: (error as Error).message };
      }
    }),
  ),
);
