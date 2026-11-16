// boqo's headline ASS (apps/worker/src/render/headline.ts): `buildHeadlineAss` with the Default template's headline
// (plate #C8FF4D, Montserrat ExtraBold, upper, title, 0-12 s, pop) the way hosted calls it (`headlineStyleFor` as the
// style), the bare plate with no style, `buildTextAss` over element lists (split parts, restacking), `stacked` and
// `textElementExtent`.
import { readFileSync } from "node:fs";
import { headlineStyleFor } from "../../../../packages/core/src/headline";
import { HEADLINE_STYLES } from "../../../../packages/core/src/headline-styles";
import { buildHeadlineAss, buildTextAss, stacked, textElementExtent } from "../render/headline";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
// 'headlineStyleFor' (hosted's call), 'none' (a headline with no style), or a style key (the table's own entry).
const styleOf = (how: string, headline: any) => (how === "headlineStyleFor" ? headlineStyleFor(headline) : how === "none" ? undefined : HEADLINE_STYLES.find((s) => s.key === how));
console.log(
  JSON.stringify({
    scenarios: input.scenarios.map((s: any) => ({
      name: s.name,
      style: styleOf(s.style, s.headline) ?? null,
      result: buildHeadlineAss(s.text, s.headline, s.clipDurationSec, s.frame, s.offsetSec, styleOf(s.style, s.headline)),
    })),
    elements: input.elements.map((e: any) => ({
      name: e.name,
      result: buildTextAss(e.list.map((x: any) => ({ ...x, style: styleOf(x.style, x.settings) })), e.clipDurationSec, e.frame, e.offsetSec),
    })),
    extents: input.extents.map((x: any) => textElementExtent({ text: x.text, settings: x.settings, style: styleOf(x.style, x.settings) }, x.frame)),
    stacked: input.stacked.k.map((k: number) => {
      const part = buildHeadlineAss(input.stacked.text, input.scenarios[0].headline, 30, input.scenarios[0].frame, 0, styleOf("headlineStyleFor", input.scenarios[0].headline));
      return { k, result: stacked({ styleLine: part.ass.split("\n").find((l: string) => l.startsWith("Style: headline,"))!, events: part.ass.split("\n").filter((l: string) => l.startsWith("Dialogue:")), layout: part.layout }, k) };
    }),
    stackedBroken: (() => { try { return stacked({ styleLine: "Style: headline,x", events: ["Comment: 0,0:00:00.00,0:00:01.00,headline,,x"], layout: {} as any }, 1); } catch (e) { return { error: (e as Error).message }; } })(),
  }),
);
