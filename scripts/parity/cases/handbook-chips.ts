// boqo's handbookChips (the Replayed, Keeps watching and stand-alone chips on a clip card) over synthetic clips:
// every stand-alone outcome, a drawn and an undrawn context line, a bridged clip with and without a bridge
// time, replay at the top and bottom of the curve, null and malformed columns.
//
// handbook-outcomes.ts is NOT in the tree at the pin: the clips page (group E) was deleted at f28d1217e
// ("chore(web): Phase 12 — delete group E (clips page)"), before the pin bcc9d99cc. Its last version is the
// parent of that commit (a962e174e touched it last). This case reads that blob out of the checkout's git
// history, puts it next to itself as an untracked file for the run, imports it, and removes it again: the
// chips are still boqo's own code, from the commit that last held it. The file only imports `@boqo/core`
// (resolved by the worker's workspace link) and a type from ./montage-outcomes, which tsx erases.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAST = "f28d1217e^";
const PATH = "apps/web/src/components/clips/handbook-outcomes.ts";
const here = dirname(fileURLToPath(import.meta.url));
const copy = join(here, "handbook-outcomes-historic.ts");
const source = execFileSync("git", ["-C", here, "show", `${LAST}:${PATH}`], { encoding: "utf8", maxBuffer: 1 << 20 });
writeFileSync(copy, source);
try {
  const { handbookChips } = await import("./handbook-outcomes-historic");
  const { cases } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
  console.log(JSON.stringify(cases.map((c: any) => ({ name: c.name, chips: handbookChips(c.clip) }))));
} finally {
  rmSync(copy, { force: true });
}
