// boqo's brand logo (apps/worker/src/render/brand.ts): `logoChain` (the `[1:v] ... [blogo]` filter stage),
// `logoOverlayPosition`, `logoFits` and `shiftLogoTiming`, over the Default template's logo values (bottom-left,
// width 0.1, margins 0.0854/0.0600, opacity 0.35, whole), every anchor, opacities, widths, margins, windows and frames.
import { readFileSync } from "node:fs";
import { LOGO_FADE_SEC } from "../render/branding";
import { logoChain, logoFits, logoOverlayPosition, shiftLogoTiming } from "../render/brand";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    LOGO_FADE_SEC,
    logos: input.logos.map((l: any) => ({
      name: l.name,
      frames: input.frames.map((f: any) => ({ f, chain: logoChain(l.logo, f), position: logoOverlayPosition(l.logo, f) })),
      fits: input.durations.map((d: number) => ({ d, fits: logoFits(d, l.logo) })),
      shifted: input.offsets.map((o: number) => ({ o, logo: shiftLogoTiming(l.logo, o), chain: logoChain(shiftLogoTiming(l.logo, o), input.frames[0]) })),
    })),
  }),
);
