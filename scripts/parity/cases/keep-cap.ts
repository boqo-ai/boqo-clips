// boqo's keepCapFor, the cap a project's first selection keeps, at SELECT_KEEP_SHARE_DEFAULT (production's:
// the worker has no SELECT_KEEP_SHARE variable, read 2026-11-17) and at the other shares hosted's own tests use
// (the headroom 1.25, and 3, past it), for every target clipTargetFor can return (1 to 120).
import { readFileSync } from "node:fs";
import { keepCapFor } from "../../../../packages/core/src/clip-target";
import { SELECT_KEEP_SHARE_DEFAULT } from "../../../../packages/core/src/constants";

const { targets, shares }: { targets: number[]; shares: number[] } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    shareDefault: SELECT_KEEP_SHARE_DEFAULT,
    byShare: shares.map((share) => ({ share, caps: targets.map((t) => keepCapFor(t, share)) })),
  }),
);
