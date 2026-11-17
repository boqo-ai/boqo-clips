// fallbackCopy (hosted's post caption from a clip's title and hook, §6.8) for every
// platform over fixed clips. `emoji at the cut` has a surrogate pair astride Instagram's
// 2000-character cut: boqo's slice leaves half of it, and the golden records that.
import { readFileSync } from "node:fs";
import { PUBLISH_PLATFORMS } from "../../../../packages/core/src/publish";
import { fallbackCopy } from "../../../../packages/core/src/publish-posts";

type Case = { name: string; title: string; hook: string | null; tags: string[] };
const input: { cases: Case[] } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    input.cases.map((c) => ({
      name: c.name,
      copy: Object.fromEntries(PUBLISH_PLATFORMS.map((p) => [p, fallbackCopy(p, { title: c.title, hook: c.hook }, c.tags)])),
    })),
  ),
);
