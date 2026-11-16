// boqo's wrapGroup and wrapGroupMeasured (packages/core/src/caption-layout.ts): every face at the case's cap heights
// (Fontsize from assFontSize), every group, max width and line count through wrapGroup; then wrapGroupMeasured with
// per-word widths where the key words are measured in a key face at keyPct of the cap height, as layoutCaptions does.
// `lines` prints as word indices, a space between words and `|` between lines, to keep the golden small.
import { readFileSync } from "node:fs";
import { wrapGroup, wrapGroupMeasured } from "../../../../packages/core/src/caption-layout";
import { assFontSize, fontMetrics, measureWidth } from "../../../../packages/core/src/caption-metrics";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const flat = (r: { lines: number[][]; overflow: boolean }) => ({ lines: r.lines.map((l) => l.join(" ")).join("|"), overflow: r.overflow });
const plain: unknown[] = [];
for (const face of input.faces) {
  const metrics = fontMetrics(face);
  for (const cap of input.capHeights) {
    const fontSize = assFontSize(metrics, cap);
    for (const [g, texts] of input.groups.entries())
      for (const maxWidth of input.maxWidths)
        for (const maxLines of input.maxLines) plain.push({ face, cap, g, maxWidth, maxLines, ...flat(wrapGroup(texts, { metrics, fontSize, maxWidth, maxLines })) });
  }
}
const measured: unknown[] = [];
for (const m of input.measured) {
  const metrics = fontMetrics(m.face);
  const keyMetrics = fontMetrics(m.keyFace);
  const fontSize = assFontSize(metrics, m.cap);
  const keyFontSize = assFontSize(keyMetrics, Math.round(m.cap * (m.keyPct / 100)));
  const space = measureWidth(metrics, " ", fontSize);
  for (const [g, texts] of input.groups.entries()) {
    const keys = m.keys[g];
    const widthOfWord = (i: number) => (keys[i] ? measureWidth(keyMetrics, texts[i], keyFontSize) : measureWidth(metrics, texts[i], fontSize));
    for (const maxWidth of input.maxWidths)
      for (const maxLines of input.maxLines)
        measured.push({ face: m.face, g, maxWidth, maxLines, ...flat(wrapGroupMeasured(texts, widthOfWord, space, { maxWidth, maxLines })) });
  }
}
console.log(JSON.stringify({ plain, measured }));
