// boqo's parseStranger and AnnotationSchema (packages/core/src/stranger.ts): a full valid column, a valid one with
// an extra annotation key (zod strips it), and columns that must come back null (judgment 0 and 6, a fraction, a
// bad enum, a missing field, a wrong type, null, a string). Each annotation is also read on its own.
import { readFileSync } from "node:fs";
import { AnnotationSchema, parseStranger } from "../../../../packages/core/src/stranger";

const { cases, annotations } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    stranger: cases.map((c: any) => ({ name: c.name, parsed: parseStranger(c.raw) })),
    annotation: annotations.map((a: any) => {
      const r = AnnotationSchema.safeParse(a.raw);
      return { name: a.name, ok: r.success, data: r.success ? r.data : null, issues: r.success ? [] : r.error.issues.map((i) => ({ path: i.path, message: i.message })) };
    }),
  }),
);
