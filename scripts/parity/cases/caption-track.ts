// The path a skill render takes to its captions, in boqo's own functions: the source words through the window and
// its snapped pause cuts (`captionWordsFor` with the plan a render carries when it tightens pauses and has no filler
// marks and no censor: render/pipeline.ts hands it the snapped cuts), the brand's captions under the brand key
// (`resolveProjectCaptions(BRAND_CAPTION_KEY, BrandCaptions.parse(block))`), then `buildCaptions` with the scene cuts
// (cutSecFromShots, clip seconds) and the emphasis words. Per scenario: the clip words and buildCaptions' result.
import { readFileSync } from "node:fs";
import { BrandCaptions, resolveProjectCaptions } from "../../../../packages/core/src/caption-overrides";
import { BRAND_CAPTION_KEY } from "../../../../packages/core/src/caption-presets";
import { captionWordsFor, type ClipEnhancePlan } from "../../../../packages/core/src/clip-enhance";
import { buildCaptions } from "../render/captions";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.scenarios.map((s: any) => {
      const plan: ClipEnhancePlan = { cuts: s.cuts, cutSkipped: null, cutFillers: false, censor: null, fillerIndices: new Set(), tightenPauses: true };
      const words = captionWordsFor(plan, input.words[s.words], s.startSec, s.endSec);
      const { preset } = resolveProjectCaptions(BRAND_CAPTION_KEY, BrandCaptions.parse(s.brandCaptions));
      return { name: s.name, words, result: buildCaptions(words, preset, s.output, s.sceneCuts, s.emphasis) };
    }),
  ),
);
