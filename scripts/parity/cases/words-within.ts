// boqo's wordsWithin and clampOverrunningEnds (packages/core words.ts): the words of a window, rebased to zero.
import { readFileSync } from "node:fs";
import { wordsWithin } from "../../../../packages/core/src/words";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => wordsWithin(c.words, c.startSec, c.endSec))));
