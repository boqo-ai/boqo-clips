// boqo's headline styles (packages/core/src/headline-styles.ts and `headlineStyleFor`, headline.ts): the six looks, their
// tiers, knobs and fingerprint; `headlineStyleFor` over the brand's knobs; and each look through `buildHeadlineAss`
// (every entrance and speed, both cases, eleven faces' worth of covering, three ratios, a tilted tag, a marker's
// highlighter, a glow, an outline, a hard shadow, the typewriter).
import { readFileSync } from "node:fs";
import { headlineStyleFor } from "../../../../packages/core/src/headline";
import { HEADLINE_STYLES, HEADLINE_STYLE_KEYS, headlineKnobsFor, headlineStyleFingerprint, headlineStyleTier } from "../../../../packages/core/src/headline-styles";
import { buildHeadlineAss } from "../render/headline";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    styles: HEADLINE_STYLES,
    keys: HEADLINE_STYLE_KEYS,
    tiers: input.keys.map((k: any) => ({ key: k, tier: headlineStyleTier(k) })),
    knobs: HEADLINE_STYLES.map((s) => ({ key: s.key, knobs: headlineKnobsFor(s) })),
    fingerprint: headlineStyleFingerprint(),
    noStyle: input.noStyle.map((h: any) => headlineStyleFor(h) ?? null),
    scenarios: input.scenarios.map((s: any) => {
      const style = headlineStyleFor(s.headline);
      return { name: s.name, style: style ?? null, result: buildHeadlineAss(s.text, s.headline, s.clipDurationSec, s.frame, s.offsetSec, style) };
    }),
  }),
);
