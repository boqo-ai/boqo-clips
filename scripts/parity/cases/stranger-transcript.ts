// boqo's strangerTranscript and strangerContent (apps/worker/src/stranger/prompt.ts) over synthetic segments:
// a plain window, cuts, a hook, both, a segment already in progress at the window's start, a segment inside a cut,
// an empty transcript, and one long enough to meet the 6,000-character cap. Frame bytes are synthetic strings.
import { readFileSync } from "node:fs";
import { STRANGER_SYSTEM, strangerContent, strangerTranscript } from "../stranger/prompt";

const { cases, contents } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify({
    system: STRANGER_SYSTEM,
    transcripts: cases.map((c: any) => {
      const text = strangerTranscript(c);
      return { name: c.name, length: text.length, text };
    }),
    contents: contents.map((c: any) => ({
      name: c.name,
      content: strangerContent(
        c.frames.map((f: any) => ({ label: f.label, jpeg: Buffer.from(f.jpeg) })),
        c.durationSec,
        c.transcript,
      ),
    })),
  }),
);
