// boqo's cutFilterChains (cut-window.ts): the chains, or { error } when a case throws.
import { readFileSync } from "node:fs";
import { cutFilterChains } from "../render/cut-window";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) => {
      try {
        return cutFilterChains(c.keep, c.hasAudio);
      } catch (error) {
        return { error: (error as Error).message };
      }
    }),
  ),
);
