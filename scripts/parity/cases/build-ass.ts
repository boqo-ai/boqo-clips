// boqo's buildCaptions (render/captions.ts) on one synthetic 12-word clip with 2 emphasis words and a scene cut, at
// 9:16: each of the 15 gallery styles reached as a brand's style (`resolveProjectCaptions` under the brand key with
// `{ style }`, the way the skill reaches every style), each of the 5 legacy presets by key (`resolveCaptionStyle`),
// and `illustrated` and `none` by key. Each entry prints the resolved preset and buildCaptions' whole result. Then
// the legacy emitter's helpers (buildAss with DEFAULT_CAPTION_STYLE, scaleCaptionStyle, assTime, escapeText,
// captionLines) and caption-effects.ts's tag builders over the case's values.
import { readFileSync } from "node:fs";
import { BRAND_CAPTION_KEY, CAPTION_PRESETS } from "../../../../packages/core/src/caption-presets";
import { GALLERY_CAPTION_STYLE_KEYS } from "../../../../packages/core/src/caption-styles";
import { resolveCaptionStyle } from "../../../../packages/core/src/caption-style-registry";
import { resolveProjectCaptions } from "../../../../packages/core/src/caption-overrides";
import { DEFAULT_CAPTION_STYLE, assTime, buildAss, buildCaptions, captionLines, escapeText, scaleCaptionStyle } from "../render/captions";
import { glowTags, lineEntrance, markerEvent, opacityTags, popTags, shadowTags, wordEntrance } from "../render/caption-effects";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const build = (preset: any) => buildCaptions(input.words, preset, input.output, input.cutSec, input.emphasis);
const e = input.effects;
const speeds = e.speeds.map((s: number | null) => s ?? undefined);
const out = {
  gallery: GALLERY_CAPTION_STYLE_KEYS.map((key) => {
    const { preset, overridesApplied } = resolveProjectCaptions(BRAND_CAPTION_KEY, { style: key });
    return { key, preset, overridesApplied, result: build(preset) };
  }),
  legacy: CAPTION_PRESETS.filter((p) => p.key !== "none").map((p) => {
    const preset = resolveCaptionStyle(p.key);
    return { key: p.key, preset, result: build(preset) };
  }),
  extra: ["illustrated", "none"].map((key) => {
    const preset = resolveCaptionStyle(key);
    return { key, preset, result: build(preset) };
  }),
  buildAss: input.scaleOutputs.map((output: any) => buildAss(input.words, scaleCaptionStyle(DEFAULT_CAPTION_STYLE, output), output)),
  scaleCaptionStyle: input.scaleOutputs.map((output: any) => scaleCaptionStyle(DEFAULT_CAPTION_STYLE, output)),
  assTime: input.assTimes.map((t: number) => assTime(t)),
  escapeText: input.escape.map((t: string) => escapeText(t)),
  captionLines: input.lineWords.map((c: any) => captionLines(c.words, c.max).map((line) => line.map((w: any) => w.word))),
  effects: {
    glow: e.glows.flatMap((g: any) => e.capHeights.flatMap((c: number) => e.boosts.map((b: number) => glowTags(g, c, b)))),
    shadow: e.shadows.flatMap((s: any) => e.capHeights.map((c: number) => shadowTags(s, c))),
    opacity: e.opacities.flatMap((o: number) => [undefined, ...e.shadows].map((s: any) => opacityTags(o, s))),
    pop: e.stepMs.flatMap((ms: number) => speeds.map((s: number | undefined) => popTags(118, s, ms))),
    marker: e.markers.map((m: any) => markerEvent(m)),
    line: (["fade", "slide"] as const).flatMap((k) => e.stepMs.flatMap((ms: number) => speeds.map((s: number | undefined) => lineEntrance(k, 540, 1546, 45, ms, s)))),
    word: (["pop", "bounce", "type"] as const).flatMap((k) => e.stepMs.flatMap((ms: number) => speeds.map((s: number | undefined) => wordEntrance(k, ms, s)))),
  },
};
console.log(JSON.stringify(out));
