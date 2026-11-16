// boqo's panel prompts (panels/prompt.ts) and wordsText (panels/decide.ts). The two system texts and the prompt
// version are printed whole. The user turns are hosted's own blocks with each image block reduced to its place in the
// order (the frame bytes are not data here): `readContent` for each read case, `probeContent` for each probe size.
import { readFileSync } from "node:fs";
import { wordsText } from "../panels/decide";
import { PANELS_PROBE_SYSTEM, PANELS_PROMPT_VERSION, PANELS_SYSTEM, probeContent, readContent } from "../panels/prompt";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const blocks = (content: any[]) => content.map((b) => (b.type === "text" ? { type: "text", text: b.text } : { type: "image" }));
console.log(
  JSON.stringify({
    promptVersion: PANELS_PROMPT_VERSION,
    system: PANELS_SYSTEM,
    probeSystem: PANELS_PROBE_SYSTEM,
    reads: input.reads.map((c: any) => ({
      name: c.name,
      blocks: blocks(readContent({ frames: c.frames.map((f: any) => ({ jpeg: Buffer.from("x"), sourceSec: f.sourceSec })), words: c.words })),
    })),
    probes: input.probes.map((c: any) => ({ frames: c.frames, blocks: blocks(probeContent({ frames: Array.from({ length: c.frames }, () => ({ jpeg: Buffer.from("x") })) })) })),
    words: input.words.map((c: any) => ({ name: c.name, text: wordsText(c.words, c.ctx, c.span) })),
  }),
);
