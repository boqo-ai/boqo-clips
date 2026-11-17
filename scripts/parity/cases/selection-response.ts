// boqo's SelectionResponse zod schema and parseSelectionMessage over synthetic
// responses: every bound (title, hook, the five scores, 12 emphasis words), each
// required field, and what normaliseAlternatives keeps. For each case it records
// safeParse's issues (path, code, message) and, when the response is valid, the
// ClipCandidate list parseSelectionMessage returns.
import { readFileSync } from "node:fs";
import { SelectionResponse, parseSelectionMessage } from "../select/anthropic";

const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    cases.map((c: any) => {
      const parsed = SelectionResponse.safeParse(c.raw);
      return {
        name: c.name,
        ok: parsed.success,
        issues: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
        candidates: parsed.success
          ? parseSelectionMessage({ stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(c.raw) }] })
          : null,
      };
    }),
  ),
);
