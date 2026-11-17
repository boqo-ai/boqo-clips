// boqo's deriveStandaloneTest over synthetic answers: all four outcomes (stands,
// bridged, context, fails), the inconsistent and dropped-line flags, a reversed
// bridge, the claim clamp. A null answer in the input stands for `undefined`.
// Each derived test is also run through StandaloneTestSchema.
import { readFileSync } from "node:fs";
import { StandaloneTestSchema, deriveStandaloneTest } from "../../../../packages/core/src/standalone";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => {
      const derived = deriveStandaloneTest(c.answer === null ? undefined : c.answer, c.segmentStarts, c.sha, c.startSec);
      return { name: c.name, ...derived, schemaOk: derived.test === null ? null : StandaloneTestSchema.safeParse(derived.test).success };
    }),
  ),
);
