// boqo's captionGroups (packages/core/src/caption-layout.ts) over the case's scenarios (bounds, gap, scene cuts;
// speakers, sentence ends, abbreviations), printed as the words' indices per group; plus distributeEvenly over
// counts, endsSentence over words, and keyFlagsFor over groups, emphasis lists and the Illustrated key fields;
// buildEmphasisSet over the stopwords; captionText and captionDisplayText (each censor mask) over words and cases;
// and layoutCaptions with stored caption timings and cover texts (the two inputs a skill render never passes).
import { readFileSync } from "node:fs";
import { captionGroups, distributeEvenly, endsSentence, keyFlagsFor, layoutCaptions } from "../../../../packages/core/src/caption-layout";
import { buildEmphasisSet, captionDisplayText, captionText, emphasisKey } from "../../../../packages/core/src/caption-words";
import { resolveCaptionStyle } from "../../../../packages/core/src/caption-style-registry";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    groups: input.scenarios.map((s: any) => ({
      name: s.name,
      groups: captionGroups(s.words, s.bounds, s.gap, s.cuts).map((g) => g.map((w: any) => w.index)),
    })),
    distribute: input.distribute.map(([n, count]: [number, number]) => distributeEvenly(Array.from({ length: n }, (_, i) => i), count)),
    endsSentence: input.endsSentence.map((t: string) => endsSentence(t)),
    keyFlags: input.keyFlags.map((c: any) => ({
      set: [...buildEmphasisSet(c.emphasis)],
      flags: c.presets.map((p: any) => keyFlagsFor(c.group, buildEmphasisSet(c.emphasis), p)),
    })),
    emphasisSets: input.emphasisSets.map((list: string[] | null) => [...buildEmphasisSet(list)]),
    texts: input.texts.map((t: string) => ({
      key: emphasisKey(t),
      text: (["upper", "preserve", "lower"] as const).flatMap((textCase) => [true, false].map((stripPunctuation) => captionText(t, { textCase, stripPunctuation }))),
      display: input.masks.flatMap((mask: any) => (["upper", "preserve", "lower"] as const).map((textCase) => captionDisplayText(mask === null ? { word: t } : { word: t, mask }, { textCase, stripPunctuation: true }))),
    })),
    layout: input.layout.presets.map((key: string) => {
      const l = input.layout;
      const preset = resolveCaptionStyle(key) as any;
      return {
        key,
        plain: layoutCaptions(l.words, preset, l.output, l.cutSec, l.emphasis),
        timed: layoutCaptions(l.words, preset, l.output, l.cutSec, l.emphasis, l.coverTexts, l.timeSpans),
      };
    }),
  }),
);
