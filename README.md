# boqo-clips

Free branded 9:16 clips with captions from any video, made on your own machine by your own agent.

<!-- demo GIF -->

## Install

Tell your agent (tested with Claude Code; any agent with a terminal, such as Cursor or Codex, can follow the same steps):

> Read https://raw.githubusercontent.com/boqo-ai/boqo-clips/main/INSTALL.md and follow it.

It clones boqo-clips to `~/.boqo-clips` and links the skill, checks your tools, installs nothing without your yes, and starts with your
brand kit.

## What it does

Give your agent a video link or a file. It runs boqo's own clipping pipeline on your machine: your agent selects the
moments from the whole transcript on boqo's rubric, they are snapped to sentence edges, scored and ranked (most-replayed
data, the stand-alone test), the first 10 render as 1080×1920 shorts with face-aware framing, burned-in word-level
captions, a title plate and your logo, and your agent then judges each rendered clip as a stranger would and sets the
final order. The rest render on request.

- **Captions first.** It starts from the video's own captions when it has them; whisper.cpp transcribes only videos that have none.
- **Your model picks.** The moments are chosen by your own agent's model, not by a boqo server. boqo 1.1, hosted, runs
  Opus 5.5: for the closest picks to hosted's, use a model of that class.
- **Only the seconds that render are downloaded,** not the whole video.
- **Rendered locally with your brand:** logo, caption style and colours from your brand kit, with ffmpeg.

## Requirements

- Node 20 or newer
- ffmpeg with libass (macOS: `brew install ffmpeg-full`)
- yt-dlp
- Two npm packages, installed into `~/.boqo-clips` after your yes: `onnxruntime-node` (face detection; about 258 MB unpacked) and `zod`
- Optional: whisper.cpp (`whisper-cli`) and a model, for videos without captions

The install runs `tools/doctor.mjs`, which checks all of these and the bundled fonts, and says how to get what is
missing on macOS, Windows and Linux.

## What runs where

| Where | What |
| --- | --- |
| Your machine | Captions and transcript, section download, scoring and ranking, face detection and rendering, your brand kits and the finished clips |
| Your agent | Picking the moments, titles and hooks, and judging each rendered clip |
| Transcript | Local by default: the video's captions, or whisper.cpp. Optional, with `"transcript": "boqo"` in the skill's config: boqo's `transcribe` tool (Deepgram) for videos without captions, 1 credit for each started 10 minutes, asked before each use |
| boqo | Posting and scheduling, through the boqo MCP connector (`https://mcp.boqo.ai/mcp`). Autoposting comes with the 7-day trial, or with Starter from $12. Without boqo you keep the files |

Want boqo to do the whole job instead? Hand it over at boqo.ai — that runs on credits.

## Engine

`engine/` and the shared tools are vendored into [boqo-channel](https://github.com/boqo-ai/boqo-channel) and
[boqo-sniper](https://github.com/boqo-ai/boqo-sniper) with `scripts/sync-engine.mjs`. Edit them here.

## Demo

A demo GIF is coming.

## Licence

MIT, see [LICENSE](LICENSE). © SSD Technologies LLC. Made by [boqo](https://boqo.ai).
