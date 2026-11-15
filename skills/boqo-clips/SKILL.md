---
name: boqo-clips
description: "Use when the person gives a video link or file and wants short clips from it, or runs /boqo-clips: branded vertical 9:16 clips with captions and their logo, made on their own machine (yt-dlp, ffmpeg, optional whisper.cpp) with the moments picked by you, and posted through boqo only on their rule."
argument-hint: "<YouTube link or video file> [brand name]"
---

# /boqo-clips

## Overview

You turn one long video into 3 to 10 short vertical clips in the person's brand: 1080×1920, burned captions in their
style, their logo. Everything runs on this machine: yt-dlp reads the video's captions and then downloads only the
picked sections, you pick the moments (`select.md`), ffmpeg renders. boqo's servers are touched only to post, and only
on the person's rule (`post.md`).

- **Tools:** `node ~/.boqo-clips/tools/<tool>.mjs`, always by that path.
- **`<home>`:** `$BOQO_HOME`, or `~/.boqo` when it is unset (`echo "${BOQO_HOME:-$HOME/.boqo}"`). Brand kits live in
  `<home>/brands/` and are shared by every boqo skill; this skill's own files are `<home>/boqo-clips/config.json`
  (the posting rule) and `<home>/boqo-clips/runs.md` (one line per run).
- **`<run>`:** `<home>/boqo-clips/runs/<YYYYMMDD-HHMM>-<slug>/`, one folder per run. `<slug>` is the video id from
  the link (`v=` or `youtu.be/<id>`), or the file's name without its extension, in letters, digits and `-` only. The
  clips land in `<run>/out/`.

## Rules

- **Every tool prints one JSON line** on stdout and exits 0, or exits 1 with `{"error": "..."}`; hints go to stderr.
  On an error, tell the person in one sentence what failed, in the error's words, and stop that step. Do not work
  around a tool with your own ffmpeg or yt-dlp commands, except the ones this file gives.
- **Never post without the rule** in `<home>/boqo-clips/config.json`. With `ask` (the default), every post waits for
  the person's yes. `post.md` has the steps.
- **Ask before whisper on a whole file.** Local transcription is slow on a CPU: about 10 s per minute of video on an
  8-core machine, more on fewer cores. Say the estimate for this video, and wait for a yes.
- **The person's language.** Answer in the language the person writes in. Titles and hooks are in the video's
  language. Files stay in English.
- **Short messages:** what happened, what comes next. No tour of the tools unless asked.
- **Long steps** (sections, render, whisper) take minutes: give each such command up to 10 minutes (Claude Code: the
  shell tool's `timeout` of 600000). Whisper, and a long render, run in the background (The run, steps 3 and 7).
- **One yt-dlp call at a time.** YouTube rate-limits parallel requests.
- Install nothing without the person's yes; never run `npm install`. An error naming ffmpeg, ffprobe, yt-dlp or
  whisper-cli: run `node ~/.boqo-clips/tools/doctor.mjs --whisper optional` and give the person its `hints`.

## The run

`/boqo-clips <link or file> [brand]`. With no link or file, ask for one. A file instead of a link: An uploaded or
local file, below.

1. **Brand.** `node ~/.boqo-clips/tools/brand.mjs show [<brand>]` (no name: the default kit).
   - `no brand kit saved yet`, or no `<home>/boqo-clips/config.json`: run `onboarding.md` (it skips what is done),
     then come back here.
   - `no brand kit named …`: `brand.mjs list`, and ask which.

   Keep the kit's `name` for `--brand`. Then `mkdir -p <run>`.
2. **Info.** `node ~/.boqo-clips/tools/fetch.mjs info "<url>" --dir <run>` gives `{id, title, duration, captions,
   chunks}`, with no video download. With captions it writes `<run>/words.json` and `<run>/transcript.md`. Tell the
   person, in one line, the title, the length and how many clips you will pick (`select.md` → How many).
3. **No captions** (`"captions": "none"`). Run `node ~/.boqo-clips/tools/doctor.mjs --whisper optional`. When its
   `whisper` or `whisper-model` check fails, tell the person the video has no captions and local transcription is
   not set up, give that check's hint, and stop. Otherwise say the video has no captions, and offer local whisper
   with the estimate (Rules). On a no, stop: the video cannot be clipped without its words. On a yes:
   1. The audio only, then `ls <run>/audio.*` for its name:
      ```sh
      yt-dlp -q --js-runtimes node --no-playlist -f "ba[ext=m4a]/ba" -o "<run>/audio.%(ext)s" "<url>"
      ```
   2. Whisper, in the background (Claude Code: the shell tool's background mode; elsewhere end the line with ` &`):
      ```sh
      node ~/.boqo-clips/tools/asr.mjs <run>/audio.<ext> --out <run>/words.json > <run>/asr.json
      ```
      Until it finishes, look at `<run>/asr.json` about once a minute: `{"words": N, …}` is done, `{"error": …}`
      stops the run.
   3. The transcript: Helpers → Words to transcript, below.
4. **Pick.** Read `select.md`, then `<run>/transcript.md` one part at a time (`grep -n '^## Part' <run>/transcript.md`
   gives each part's first line), and write `<run>/picks.json`.
5. **Check.**
   ```sh
   node ~/.boqo-clips/tools/picks-check.mjs <run>/picks.json --duration <duration> --words <run>/words.json \
     --min 20 --max 60 --count-min 3 --count-max 10 > <run>/checked.json
   ```
   `<duration>` is step 2's. Read `<run>/checked.json`.
   - `"ok": false`: fix each pick its `errors` name in `picks.json`, and check again.
   - `"ok": true`: every pick is snapped to whole words and carries `moved: {s, e}`, how far each edge moved. An edge
     that moved 1 s or more landed somewhere you did not choose: read the words around it (Words around a time,
     below), set that edge in `picks.json` yourself, and check again, once.
   - Other lengths only on the person's ask ("30-second clips": `--min 25 --max 35`), within 15 to 90 s. A video
     under 3 minutes: `--count-min 1`.
6. **Sections.**
   ```sh
   node ~/.boqo-clips/tools/fetch.mjs sections "<url>" --picks <run>/checked.json --dir <run> > <run>/sections.json
   ```
   Read `<run>/sections.json`: `{"files": […]}`, or an error. It downloads only the picked seconds; when one comes
   back short it downloads the whole video once and cuts locally (a stderr line says so), which is the fallback
   working, not a failure.
7. **Render.**
   ```sh
   node ~/.boqo-clips/tools/render.mjs --sections <run>/sections.json --picks <run>/checked.json \
     --words <run>/words.json --brand "<name>" --out <run>/out
   ```
   gives `{"clips": [{file, s, e, title}]}`. The layout is `blur` (the whole picture over a blurred fill of itself);
   `--layout crop` (a centre crop that fills the frame) only when the person asks. A render takes about as long as
   the clips run, and longer on a laptop: when the picks add up to more than 4 minutes, run it in the background as
   whisper runs (step 3), its line going to `<run>/render.json`.
8. **Show.** One line per clip: its number, title, length (`e - s`, in whole seconds) and file path; then the
   `<run>/out` folder. Then delete what the run downloaded or no longer needs (`find`, because zsh stops a whole `rm`
   on a pattern that matches nothing):
   ```sh
   find <run> -maxdepth 1 -type f \( -name 'sec-*.mp4' -o -name 'audio.*' -o -name 'captions.*.json3' \
     -o -name info.json -o -name sections.json -o -name asr.json -o -name render.json \) -delete
   ```
   Keep `out/` and the small text files (`picks.json`, `checked.json`, `words.json`, `transcript.md`): they let you
   redo a clip in this chat.
9. **Post**, by `post.md`.
10. **Log.** Append one line to `<home>/boqo-clips/runs.md`:
    `<YYYY-MM-DD HH:MM> | <url or file> | <n> clips | <run>/out | posted <m>`.

## An uploaded or local file

The same run, with three changes:
- **No info step.** The length: `ffprobe -v error -show_entries format=duration -of csv=p=0 "<file>"`.
- **Whisper on the whole file**, after asking (Rules): step 3's doctor check, whisper and transcript, with
  `"<file>"` itself in place of the audio.
- **No sections step.** Render from the file: `--src "<file>"` in place of `--sections <run>/sections.json`.

The cleanup deletes only what the run made. Never move, change or delete the person's file.

## Redo one clip

"Clip 2 should start earlier", "another title": change only that pick in `picks.json`, check it (step 5), then write
a picks file holding only that checked pick and run steps 6 and 7 on it with `--out <run>/redo`. Move
`<run>/redo/clip-01.mp4` over `<run>/out/clip-<k>.mp4` (`k` with two digits: `02`), and remove `<run>/redo`. A local
file skips step 6.

## Helpers

**Words to transcript** (`<run>/words.json` into `<run>/transcript.md`, the way captions come):

```sh
node -e "const p=require('path'),f=require('fs'),d=process.argv[1];import(require('url').pathToFileURL(p.join(require('os').homedir(),'.boqo-clips','engine','words.mjs'))).then(m=>{const c=m.transcriptChunks(JSON.parse(f.readFileSync(p.join(d,'words.json'),'utf8')));f.writeFileSync(p.join(d,'transcript.md'),c.join('\n\n')+'\n');console.log(JSON.stringify({chunks:c.length}))})" "<run>"
```

**Words around a time** (`<sec>` in seconds; each line is `start end word`, exact to the millisecond):

```sh
node -e "const w=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')),t=+process.argv[2];console.log(w.filter(x=>x.s>t-8&&x.s<t+8).map(x=>x.s+' '+x.e+' '+x.w).join('\n'))" "<run>/words.json" <sec>
```

## Red flags

| Thought | Reality |
|---|---|
| "No captions: I'll download the video and run whisper" | Ask first, with the time it takes (Rules) |
| "The person said 'nice', so I'll post them" | Only the rule posts. With `ask`, a post needs a yes to posting |
| "I'll download the whole video, it's simpler" | Sections first. `fetch.mjs` falls back to the whole video by itself |
| "picks-check moved an edge 1.4 s, close enough" | 1 s or more: look at the words there and set it yourself |
| "A ▲ line, so it's a clip" | ▲ is evidence, not an order (`select.md`) |
| "Ten clips look generous" | One per ~6 minutes, 3 to 10, and fewer when fewer pass `select.md` |
| "The tool failed, I'll write my own ffmpeg line" | Say the error and stop that step |
