// boqo's planShots (render/pipeline.ts), run whole with a stand-in exec: the extract is a no-op, the scene pass
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
  const dir = mkdtempSync(path.join(tmpdir(), "plan-shots-"));
  try {
    const exec = async (command: string, args: string[]) => {
      if (command === "python3") {
        return { stdout: JSON.stringify({ frameWidth: c.frame.width, frameHeight: c.frame.height, shots: c.faces }), stderr: "" };
      }
      if (command === "ffmpeg" && args.join(" ").includes("scene")) return { stdout: sceneStdout(c.shots), stderr: "" };
      if (command === "ffmpeg") return { stdout: "", stderr: "" };
      throw new Error(`unexpected command ${command}`);
    };
    const result = await planShots({ exec } as any, {
      sourceUrl: "source.mp4",
      startSec: 0,
      endSec: c.shots[c.shots.length - 1].endSec,
      dir,
      remainingMs: () => 600_000,
      layout: c.layout ?? "auto",
      output: c.output,
      layoutOverrides: [],
      lookingRoom: null,
      subjectRule: c.subjectRule,
      cuts: [],
      pauses: null,
    });
    if (JSON.stringify(result.shots) !== JSON.stringify(c.shots)) {
      throw new Error(`case ${c.name}: boqo found shots ${JSON.stringify(result.shots)}, the case has ${JSON.stringify(c.shots)}`);
    }
    if (result.frameWidth !== c.frame.width || result.frameHeight !== c.frame.height || !result.trackEnabled || !result.layoutEnabled) {
      throw new Error(`case ${c.name}: unexpected frame or switches`);
    }
    return {
      name: c.name,
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
