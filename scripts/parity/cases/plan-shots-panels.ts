// boqo's planShots (render/pipeline.ts) with the stream panels callback, run whole with a stand-in exec (case
// `plan-shots`, plus a callback that answers the case's own samples, stored in SOURCE seconds, and the window's
// start and cuts). The panels read is asked only with layout modes on and no `fit` pin, as hosted. Like `plan-shots`: the extract is a no-op, the scene pass
// answers a score spike at every boundary of the case's own shots (30 fps; no greyscale file, so the strong arm
// alone decides), and detect_faces.py answers the case's own face JSON. Fails unless the shots boqo found are exactly
// the case's, so the golden cannot describe other shots. Prints, per case, the placement loop's `placed` with each
// shot's `layoutNameFor` name (@boqo/core) beside it, and the two placement counts. RENDER_* variables unset, as on
// the production worker; boqo's log lines go to stderr.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { layoutNameFor } from "../../../../packages/core/src/editor-sidecar";
import { planShots } from "../render/pipeline";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(" ")}\n`);

const FPS = 30;

function sceneStdout(shots: { startSec: number; endSec: number }[]): string {
  const end = shots[shots.length - 1]!.endSec;
  const cuts = new Set(shots.slice(1).map((s) => Math.round(s.startSec * FPS)));
  const lines: string[] = [];
  for (let n = 0; n <= Math.round(end * FPS); n += 1) {
    lines.push(`frame:${n}    pts:${n * 512}    pts_time:${(n / FPS).toFixed(6)}`);
    lines.push(`lavfi.scene_score=${cuts.has(n) ? "1.000000" : "0.000000"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function run(c: any) {
  const cutSec = c.cuts.reduce((a: number, cut: any) => a + (cut.end - cut.start), 0);
  const windowSec = c.shots[c.shots.length - 1].endSec + cutSec;
  const dir = mkdtempSync(path.join(tmpdir(), "plan-shots-"));
  try {
    const exec = async (command: string, args: string[]) => {
      if (command === "python3") {
        return { stdout: JSON.stringify({ frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces }), stderr: "" };
      }
      if (command === "ffprobe") {
        // The window's video frame times, 30 fps, for snapping the case's cuts onto frames.
        const total = Math.round(windowSec * FPS);
        return { stdout: Array.from({ length: total + 1 }, (_, n) => (n / FPS).toFixed(6)).join("\n"), stderr: "" };
      }
      if (command === "ffmpeg" && args.join(" ").includes("scene")) return { stdout: sceneStdout(c.shots), stderr: "" };
      if (command === "ffmpeg") return { stdout: "", stderr: "" };
      throw new Error(`unexpected command ${command}`);
    };
    const result = await planShots({ exec } as any, {
      sourceUrl: "source.mp4",
      startSec: c.startSec,
      endSec: c.startSec + windowSec,
      dir,
      remainingMs: () => 600_000,
      layout: c.layout ?? "auto",
      output: c.output,
      layoutOverrides: [],
      lookingRoom: null,
      subjectRule: c.subjectRule,
      cuts: c.cuts,
      pauses: null,
      panels: async () => ({ action: "ask", samples: c.samples, costUsdMicros: 0, reason: null }),
      panelsGameZoom: c.gameZoom,
    });
    // With cuts, the window's length less the cuts is a float sum, so the last edge can differ from the case's by an
    // ulp; the shots are printed (hosted's own) and the skill's test places those.
    const same = result.shots.length === c.shots.length && result.shots.every((s: any, i: number) => Math.abs(s.startSec - c.shots[i].startSec) < 1e-9 && Math.abs(s.endSec - c.shots[i].endSec) < 1e-9);
    if (!same) {
      throw new Error(`case ${c.name}: boqo found shots ${JSON.stringify(result.shots)}, the case has ${JSON.stringify(c.shots)}`);
    }
    if (result.frameWidth !== c.frame.width || result.frameHeight !== c.frame.height || !result.trackEnabled || !result.layoutEnabled) {
      throw new Error(`case ${c.name}: unexpected frame or switches`);
    }
    return {
      name: c.name,
      shots: result.shots,
      placed: result.placed.map((p) => ({ ...p, layout: layoutNameFor(p.placement.kind) })),
      coverageDropped: result.coverageDropped,
      stacksRefused: result.stacksRefused,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const out = [];
for (const c of input.cases) out.push(await run(c));
process.stdout.write(`${JSON.stringify(out)}\n`);
