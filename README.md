# boqo-clips

Free branded 9:16 clips with captions from any video, made on your own machine by your own agent.

<!-- demo GIF -->

## Install

Tell your agent (tested with Claude Code; any agent with a terminal, such as Cursor or Codex, can follow the same steps):

> Read https://raw.githubusercontent.com/boqo-ai/boqo-clips/main/INSTALL.md and follow it.

It clones boqo-clips to `~/.boqo-clips` and links the skill, checks your tools, installs nothing without your yes, and starts with your
brand kit.

## What it does

Give your agent a video link or a file. It reads the words, picks the moments worth clipping, and renders each one as
a 1080×1920 short with burned-in captions and your logo if you set one. On an 8-core Linux box, a 39-minute talk became 7 clips in
about 5 minutes of tool time.

- **Captions first.** It starts from the video's own captions when it has them; whisper.cpp transcribes only videos that have none.
- **Your model picks.** The moments are chosen by your own agent's model, not by a boqo server.
- **Only the picked sections are downloaded,** not the whole video.
- **Rendered locally with your brand:** logo, caption style and colours from your brand kit, with ffmpeg.

## Requirements

- Node 20 or newer
- ffmpeg with libass (macOS: `brew install ffmpeg-full`)
- yt-dlp
- Optional: whisper.cpp (`whisper-cli`) and a model, for videos without captions

The install runs `tools/doctor.mjs`, which checks all of these and says how to get what is missing on macOS, Windows
and Linux.

## What runs where

| Where | What |
| --- | --- |
| Your machine | Captions and transcript, section download, rendering, your brand kits and the finished clips |
| Your agent | Picking the moments, titles and hooks |
| boqo | Posting and scheduling, through the boqo MCP connector (`https://mcp.boqo.ai/mcp`). Autoposting comes with the 3-day trial, or with Starter from $12. Without boqo you keep the files |

Want boqo to do the whole job instead? Hand it over at boqo.ai — that runs on credits.

## Engine

`engine/` and the shared tools are vendored into [boqo-channel](https://github.com/boqo-ai/boqo-channel) and
[boqo-sniper](https://github.com/boqo-ai/boqo-sniper) with `scripts/sync-engine.mjs`. Edit them here.

## Demo

A demo GIF is coming.

## Licence

MIT, see [LICENSE](LICENSE). © PRAC INC. Made by [boqo](https://boqo.ai).
