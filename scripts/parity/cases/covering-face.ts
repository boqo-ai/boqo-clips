// boqo's coveringFace and faceFor (packages/core/src/caption-faces.ts): every face in CAPTION_FACES over the case's
// texts (Latin, Cyrillic upper and lower, mixed, Ukrainian, Greek, accented, digits, emoji, empty); the registry
// itself; and what faceFor and coveringFace throw for a name that is not a face.
import { readFileSync } from "node:fs";
import { CAPTION_FACES, NEW_CAPTION_FACES, coveringFace, faceFor } from "../../../../packages/core/src/caption-faces";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const thrown = (f: () => unknown) => { try { return { value: f() }; } catch (e) { return { error: (e as Error).message }; } };
console.log(
  JSON.stringify({
    faces: CAPTION_FACES,
    newFaces: NEW_CAPTION_FACES,
    cover: Object.keys(CAPTION_FACES).map((name) => ({
      name,
      faceFor: faceFor(name),
      covering: input.texts.map((t: any) => ({ texts: t.name, face: coveringFace(name, t.texts) })),
    })),
    unknown: input.unknownFaces.map((name: string) => ({ name, faceFor: thrown(() => faceFor(name)), covering: thrown(() => coveringFace(name, ["x"])) })),
  }),
);
