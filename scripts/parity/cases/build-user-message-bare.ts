// boqo's own chain for ONE selection request, from what the skill has (a
// yt-dlp info dict, sentence segments, raw top-level comments, a genre key, a
// length key, the person's words) to the system rubric and the user message:
//   parseSourceMetadata (ingest) -> project columns -> pickReactions ->
//   loadSelectionInput's `input` (production defaults: no feedback, no seed)
//   -> buildUserMessage.
// Production values: replay tunables and bridge span are the defaults.
import { readFileSync } from "node:fs";
import { clipTargetFor } from "../../../../packages/core/src/clip-target";
import { normalizePrompt } from "../../../../packages/core/src/prompt";
import { curveBins, discountHeatmap, DEFAULT_REPLAY_TUNABLES } from "../../../../packages/core/src/replay";
import { resolveClipLength, resolveGenre } from "../../../../packages/core/src/selection-presets";
import { pickReactions } from "../../../../packages/core/src/viewer-reactions";
import { parseSourceMetadata } from "../ingest/metadata";
import { DEFAULT_BRIDGE_MAX_SEC } from "../select/replay-config";
import { findPeakRegions } from "../select/peaks";
import { SELECTION_RUBRIC, buildUserMessage } from "../select/prompt";
import { videoContextOf } from "../select/video-context";

const raw = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const meta = parseSourceMetadata(raw.info);
const durationSec = meta.durationSec;
const reactions = raw.comments === null ? null : pickReactions(raw.comments, durationSec);
const replay = discountHeatmap(meta.heatmap, (meta.chapters ?? []).map((c) => c.startSec), DEFAULT_REPLAY_TUNABLES);
const maxClips = clipTargetFor(durationSec);
const input = {
  language: raw.info.language ?? "en",
  durationSec,
  segments: raw.segments,
  peaks: findPeakRegions(replay === null ? null : curveBins(replay), durationSec),
  bridgeMaxSec: DEFAULT_BRIDGE_MAX_SEC,
  maxClips,
  sceneTarget: 0,
  genre: resolveGenre(raw.genre),
  clipLength: resolveClipLength(raw.length),
  source: videoContextOf({
    sourceKind: "youtube",
    title: meta.title,
    channelName: meta.channelName,
    description: meta.description,
    chapters: meta.chapters,
    viewerReactions: reactions,
  }),
  prompt: normalizePrompt(raw.prompt),
  model: "none",
  selectionModel: "clipper",
  feedback: [],
  seed: null,
} as any;
console.log(JSON.stringify({ target: maxClips, rubric: SELECTION_RUBRIC, message: buildUserMessage(input) }));
