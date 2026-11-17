// boqo's `buildFilterGraph` (apps/worker/src/render/compose.ts): the one encode pass's filter graph, over 3-shot plans
// whose placements are fill (`crop`), track, fit over the blur, stack and stream panels, with captions, a headline, a
// text-below pass and a brand logo (the logo stage from render/brand.ts `logoChain` and `logoOverlayPosition` over the
// case's logo values). Every variant passes `hasAudio: true` and none of the hook, cutaway, viral, uniqueize, censor,
// shot-transition, branding or grade inputs: the skill's render (one copy, no boqo lockup, hard cuts) never sets them.
// A last group lays a fit-heavy plan over the black, colour and crop backdrops.
import { readFileSync } from "node:fs";
import { buildFilterGraph } from "../render/compose";
import { logoChain, logoOverlayPosition } from "../render/brand";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const output = input.output;
const logo = (l: any) => {
  const position = logoOverlayPosition(l, output);
  return { chain: logoChain(l, output), x: position.x, y: position.y, ...(l.enableFromSec !== undefined && { enableFromSec: l.enableFromSec }) };
};
const plan = (name: string) =>
  input.shots.map((shot: any, i: number) => ({ shot, placement: input.placements[input.plans[name][i]] }));

const graphs = Object.keys(input.plans).map((name) => ({
  name,
  variants: input.variants.map((v: any) => ({
    name: v.name,
    graph: buildFilterGraph({
      shots: plan(name),
      output,
      assPath: v.assPath ?? null,
      headlineAssPath: v.headlineAssPath ?? null,
      textBelowAssPath: v.textBelowAssPath ?? null,
      brandLogo: v.logo ? logo(v.logo) : null,
      blurSigma: input.blurSigma,
      hasAudio: true,
    }),
  })),
}));
const backdrops = input.backdrops.map((backdrop: any) => ({
  backdrop,
  graph: buildFilterGraph({
    shots: plan("fit-blur"),
    output,
    assPath: "captions.ass",
    blurSigma: input.blurSigma,
    backdrop,
    hasAudio: true,
  }),
}));
console.log(JSON.stringify({ graphs, backdrops }));
