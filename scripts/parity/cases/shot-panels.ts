// boqo's shotPanels (render/panels-plan.ts) for each case: one shot's plan from the model's samples, its cameras'
// crops and its moving game window. RENDER_PANELS_GAME_ZOOM is not read here; the case passes the zoom.
import { readFileSync } from "node:fs";
import { shotPanels } from "../render/panels-plan";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(JSON.stringify(input.cases.map((c: any) => ({ name: c.name, plan: shotPanels(c.input) }))));
