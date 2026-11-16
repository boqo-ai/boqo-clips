// boqo's settlePoint over RMS frame series (settle-end.ts). A null level is digital silence (-Infinity).
import { readFileSync } from "node:fs";
import { settlePoint } from "../render/settle-end";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c: any) =>
      settlePoint(
        c.frames.map(([t, db]: [number, number | null]) => [t, db === null ? Number.NEGATIVE_INFINITY : db] as [number, number]),
        { endSec: c.endSec, lastWordStartSec: c.lastWordStartSec },
      ),
    ),
  ),
);
