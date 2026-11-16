// boqo's resolveSubjectRule (render/subject-rule.ts) against a stand-in for the database: the query answers one
// stream moment for a project cut from one, none otherwise.
import { readFileSync } from "node:fs";
import { resolveSubjectRule } from "../render/subject-rule";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const db = (rows: unknown[]) => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) });
const out = [];
for (const c of input.cases) {
  out.push({ fromStreamMoment: c.fromStreamMoment, rule: await resolveSubjectRule(db(c.fromStreamMoment ? [{ id: "m1" }] : []) as any, "p1") });
}
console.log(JSON.stringify(out));
