---
name: boqo-clips
description: "Use when the person gives a video link or file and wants short clips from it, or runs /boqo-clips (also /boqo-clips render to render more of a run's clips): branded vertical 9:16 clips with captions and their logo, made on their own machine (yt-dlp, ffmpeg, optional whisper.cpp) by boqo's own pipeline with the moments picked by you, and posted through boqo only on their rule."
argument-hint: "<YouTube link or video file> [brand name] | render [<run>] [N|all|<numbers>]"
---

# /boqo-clips

## Overview

You turn one long video into short vertical clips in the person's brand, by boqo's own pipeline: 1080×1920, burned
captions in their style, their logo. Everything runs on this machine: yt-dlp reads the video's captions and downloads
only the seconds that get rendered; you select the moments from the whole transcript (`select.md`); `select-check`
snaps, scores and ranks them; the first 10 render with face-aware framing; you judge each one as a stranger would
(`stranger.md`); the final order puts the best first. boqo's servers are touched only to post, and only on the
person's rule (`post.md`), or to transcribe, when the person chose that and said yes to its cost.

- **Tools:** `node "$HOME/.boqo-clips/tools/<tool>.mjs"`, always by that path.
- **`<home>`:** `$BOQO_HOME`, or `~/.boqo` when it is unset; `echo "${BOQO_HOME:-$HOME/.boqo}"` prints it. Brand kits
  live in `<home>/brands/` and are shared by every boqo skill; this skill's own files are
  `<home>/boqo-clips/config.json` (the posting rule, and `"transcript": "local"` or `"boqo"`, default `local`) and
  `<home>/boqo-clips/runs.md` (one line per run).
- **`<run>`:** `<home>/boqo-clips/runs/<YYYYMMDD-HHMM>-<slug>`, one folder per run; the clips land in `<run>/out/`.
  `<slug>` is the YouTube video id (`v=` or `youtu.be/<id>`), for another link its last path part, for a file its
  name without the extension; lowercased, with every character outside `a-z`, `0-9` and `-` turned into `-`.
- **Paths in commands:** write `<home>`, `<run>` and every other path out in full, as the absolute path, inside
  double quotes, in every command: `"/Users/ana/.boqo/boqo-clips/runs/20261115-1637-lcemirjpetq/clips.json"`. A shell
  variable set in one command is gone in the next (Claude Code runs each command in a new shell), and a home folder
  can hold a space.

## Rules

- **Every tool prints one JSON line** on stdout and exits 0, or exits 1 with `{"error": "..."}`; hints go to stderr.
  `summary` prints plain lines. On an error, tell the person in one sentence what failed, in the error's words, and
  stop that step. Do not work around a tool with your own ffmpeg or yt-dlp commands, except the ones these files give.
- **Never post without the rule** in `<home>/boqo-clips/config.json`. With `ask` (the default), every post waits for
  the person's yes. With `auto`, a link already posted from (its `runs.md` line) is asked about first. `post_video`
  goes once per clip, never again after an unclear reply. `post.md` has the steps.
- **Ask before whisper on a whole file.** Local transcription is slow on a CPU: about 13 s per minute of audio on an
  8-core CPU with the small model, more on fewer cores. Say the estimate for this video, and wait for a yes.
- **Ask before boqo transcribes.** It spends credits: 1 for each started 10 minutes of audio, at least 1. One line
  with the minutes and the credits, then wait for a yes.
- **The person's language.** Answer in the language the person writes in. Titles and hooks are in the video's
  language. Files stay in English.
- **Short messages:** what happened, what comes next. No tour of the tools unless asked.
- **Long steps run in the background:** sections, whisper and the boqo transcript wait always, render when the
  clips to render add up to more than 4 minutes. Each writes its one line to a file in `<run>`, and is done when that
  file holds the line. In Claude Code use the shell tool's background mode, which tells you when the command ends;
  elsewhere end the command with ` &` and look at the file about once a minute. Never wait with a foreground `sleep`.
  Any other command gets up to 10 minutes (Claude Code: the shell tool's `timeout` of 600000).
- **One yt-dlp call at a time.** YouTube rate-limits parallel requests.
- Install nothing without the person's yes; INSTALL.md's one `npm ci` is the only npm command. An error naming ffmpeg,
  ffprobe, yt-dlp, whisper-cli or onnxruntime: run `node "$HOME/.boqo-clips/tools/doctor.mjs" --whisper optional` and
  give the person its `hints`.

## The run

`/boqo-clips <link or file> [brand]`. With no link or file, ask for one. A file instead of a link: An uploaded or
local file, below. `/boqo-clips render …`: Render more, below.

1. **Brand.** `node "$HOME/.boqo-clips/tools/brand.mjs" show ["<brand>"]` (no name: the default kit).
   - `no brand kit saved yet`, or no `<home>/boqo-clips/config.json`: run `onboarding.md` (it skips what is done),
     then come back here.
   - `no brand kit named …`: `brand.mjs list`, and ask which.

   Keep the kit's `name` for `--brand`. Then `mkdir -p "<run>"`, and delete the upload replies an earlier run left
   (they hold live signed URLs; one under an hour old may be another chat's, posting now):
   ```sh
   find "<home>/boqo-clips/runs" -mindepth 2 -maxdepth 2 -type f -name 'upload-*.json' -mmin +60 -delete
   ```
2. **Info, captions and comments.**
   ```sh
   node "$HOME/.boqo-clips/tools/fetch.mjs" info "<url>" --dir "<run>"
   node "$HOME/.boqo-clips/tools/fetch.mjs" comments "<url>" --dir "<run>"
   ```
   `info` gives `{id, title, duration, captions}` with no video download; with captions it writes `<run>/words.json`,
   `<run>/segments.json` and `<run>/transcript-language.txt` (the language of the track it took, which
   `select-request` prints). It takes only a track of the video's own speech, never a translation, so a video whose
   speech has no such track says `"captions": "none"` with a `note`. `comments` is best effort (`{"comments": null}`
   is fine) and runs now, before `select-request`, which reads `<run>/comments.json` once and without it the viewers'
   reactions are left out. Tell the person, in one line, the title and the length.
3. **No captions** (`"captions": "none"`; with a `note`, say it in one line: the captions were not the video's own
   speech, so whisper is the way). `"transcript": "boqo"` in `config.json`: the boqo transcript, below.
   Otherwise (and after a boqo failure) local whisper:
   run `node "$HOME/.boqo-clips/tools/doctor.mjs" --whisper optional`. When its `whisper` or `whisper-model` check
   fails, tell the person the video has no captions and local transcription is not set up, give that check's hint,
   and stop. Otherwise say the video has no captions, and offer local whisper with the estimate (Rules). On a no,
   stop: the video cannot be clipped without its words. On a yes:
   1. The audio only, then `ls "<run>"` for its name (`audio.m4a`, or `audio.webm`):
      ```sh
      yt-dlp -q --js-runtimes node --no-playlist -f "ba[ext=m4a]/ba" -o "<run>/audio.%(ext)s" "<url>"
      ```
   2. Whisper, in the background (Rules):
      ```sh
      node "$HOME/.boqo-clips/tools/asr.mjs" "<run>/audio.<ext>" --out "<run>/words.json" > "<run>/asr.json"
      ```
      `{"words": N, …}` in `<run>/asr.json` is done, and `<run>/segments.json` is written beside the words; `{"error": …}`
      stops the run. `"englishOnly": true` is a model that hears every video as English: when this one is not in
      English (`info.json`'s `language`, the title, the person), say so, and offer the multilingual model (about
      150 MB). On a yes:
      ```sh
      mkdir -p "<home>/models" && curl -L -o "<home>/models/ggml-base.bin" \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
      ```
      then run whisper again with the video's language, `--lang <code>` (`--lang ru`) before `--out`: with a
      language other than English it takes a multilingual model, and `select-request` gets the same
      `--lang <code>` (step 5).
      `the words file has no words`: whisper heard no speech. Tell the person, and stop. Known limit: whisper can
      hear a word that is not there ("Oh") in silence at a multiple of 30 s, its window edge; never set an edge on one.

   **The boqo transcript** (`"transcript": "boqo"`), Deepgram's own sentences, identical to hosted's:
   1. The person's yes, first. One line, then wait: "No captions: boqo can transcribe it, <N> minutes, <C> credits
      (1 for each started 10 minutes). Yes?" `<N>` is `duration` rounded up to whole minutes, `<C>` is `duration`
      divided by 600, rounded up, at least 1. A no: the whisper offer above. With no `create_upload` among your
      tools (onboarding.md → 2 says how to find a deferred one), skip to item 6 without asking.
   2. The audio, from this machine's own address (never mp3: boqo reads m4a, webm/opus, ogg, flac and wav):
      ```sh
      yt-dlp -q --js-runtimes node --no-playlist -f "ba[ext=m4a]/ba[ext=webm]" -o "<run>/audio.%(ext)s" "<url>"
      node "$HOME/.boqo-clips/tools/boqo-upload.mjs" probe-audio "<run>/audio.<ext>"
      ```
      `ls "<run>"` gives `<ext>`. `probe-audio` gives `sizeBytes` and `contentType`.
   3. `create_upload {filename: "audio.<ext>", contentType, sizeBytes, kind: "transcribe"}`. Write its reply, exactly
      as it came, to `<run>/upload-audio.json` (live signed URLs: never print them). Then
      `node "$HOME/.boqo-clips/tools/boqo-upload.mjs" put "<run>/audio.<ext>" --reply "<run>/upload-audio.json"`
      gives `{"ok": true, "upload_id", …}`; delete `<run>/upload-audio.json`.
   4. `complete_upload {upload_id}`, then `transcribe {upload_id}`: `{id, credits, minutes}`. A link in either reply
      (the connection's daily cap): give it to the person and go to item 6.
   5. `get_transcript {id}`, about every 20 seconds (a background `sleep 20`, post.md), until `status` is `done`
      (with a `url`) or `failed` (with an `error`); an answer of `{not_found: true}` is final, so stop polling and go
      to item 6. Then, with the `url` exactly as it came and never shown:
      ```sh
      node "$HOME/.boqo-clips/tools/transcript-boqo.mjs" --url "<url>" --run "<run>"
      ```
      It writes `<run>/words.json`, `<run>/segments.json` and `<run>/transcript-language.txt`, which `select-request`
      reads. Say in one line that boqo transcribed it and the credits spent.
   6. On any failure above (no boqo tools, a refusal, a failed job, an error from a tool): one line, "boqo's
      transcript failed (<the reason, as it came>), transcribing here instead", then the local path above: its doctor
      check, its offer, its yes.
4. **Segments.** `<run>/segments.json` (sentences, `speaker` null locally) exists after step 2, step 3's whisper or
   step 3's boqo transcript. Nothing to run; with no file there, the transcript step failed: say so and stop.
5. **Request.** With the person's choices when they made any (`--genre podcast|talk|gaming|vlog|entertainment`,
   `--length under_30|30_60|60_90|90_120|120_180`, `--prompt "<their words>"`, `--lang <code>`):
   ```sh
   node "$HOME/.boqo-clips/tools/select-request.mjs" --run "<run>"
   ```
   It writes `<run>/select-request.md` and prints `{"target", "segments", "chars"}`. Tell the person, in one line,
   how many clips it aims for (`target`). The language comes from `info.json`, or from
   `<run>/transcript-language.txt` on the boqo path; `--lang` overrides both.
6. **Select.** Read `select.md`, then the whole of `<run>/select-request.md` (in pages when it is long), and write
   `<run>/selection.json` once.
7. **Check.**
   ```sh
   node "$HOME/.boqo-clips/tools/select-check.mjs" --run "<run>"
   ```
   - `{"ok": false, "errors": [...]}`: each error is `clips[i].field: what is wrong`, `clips[0]` being the first
     clip. Fix them in `<run>/selection.json` and run the check again.
   - `{"ok": true, "kept": n, "dropped": {...}}`: `<run>/clips.json` is the run's record, one row for each clip kept,
     its edges set on sentence edges, with its scores and its replay percentile. `dropped` counts what was left out,
     by reason. Re-running the check rebuilds the record, and every clip is unrendered again.
8. **Order.** `node "$HOME/.boqo-clips/tools/clips.mjs" order --run "<run>"`: the rows are numbered in boqo's
   Ranked order (clips that fail the stand-alone test last, then the replay percentile, then the score). Clips 1 to
   10 are the ones rendered. Say so in one line when there are more than 10.
9. **Sections** for the render set, in the background (Rules):
   ```sh
   node "$HOME/.boqo-clips/tools/fetch.mjs" sections "<url>" --run "<run>" > "<run>/sections.json"
   ```
   (`--first 10` is the default; `--n 1,2,3` or `--all` as `render.mjs` takes them.) Done when
   `<run>/sections.json` holds `{"files": […]}`, or an error. It downloads only the seconds of those clips; when one
   comes back short it downloads the whole video once and cuts locally (a stderr line says so), which is the
   fallback working, not a failure, and takes longer. Every entry carries the video seconds it holds (`s`, `e`):
   the render finds a clip's file by them, and a `sections.json` an older version wrote is fetched again.
10. **Panels,** for a landscape source of 480 lines or more: `panels.md`. The probe, once a run; when it says
    `isStream: true`, the per-clip read for each of the clips 1 to 10, before their render. A portrait or small source
    says `{"eligible": false}`: skip it.
11. **Render** the first 10, in the background when they add up to more than 4 minutes (Rules):
    ```sh
    node "$HOME/.boqo-clips/tools/render.mjs" --run "<run>" --first 10 --brand "<name>" > "<run>/render.json"
    ```
    `<run>/render.json` gets `{"rendered": [{n, file, thumb, seconds, notes}], "failed": [{n, error}]}`, and each
    rendered row of `clips.json` says `rendered: true`. A failed clip does not stop the others; its work folder stays
    at `<run>/render/clip-<nn>/` (`<nn>` its number, two digits). Say each `n` and error in one line, and where that
    folder is. A render takes about 1–2× the clips' length, longer on a laptop. A note is a step that was
    skipped, not a failure (no face model: every shot framed to fit; no logo): give the person the notes that
    matter, one line each, with no file paths. Framing, captions, headline, logo, pauses and loudness are boqo's own
    defaults, from the kit.
12. **Stranger.** For each rendered clip, `stranger.md`: its frames, your annotation, the record.
13. **Order again.** `node "$HOME/.boqo-clips/tools/clips.mjs" order --run "<run>"`: the rendered clips are ranked
    with the stranger judgment, the files renamed to their new places (`clip-01.mp4` is the best), and the clips not
    rendered follow in their earlier order.
14. **Show.** `node "$HOME/.boqo-clips/tools/clips.mjs" summary --run "<run>"` prints one line per rendered clip in
    order (rank, score, the four letters, the chips, title, length), then `+N not rendered`. Show the lines as they
    are, each with its file, `<run>/out/clip-<rank, two digits>.mp4`; then the `<run>/out` folder. When clips are not
    rendered, say once how to render the rest: `/boqo-clips render [N|all|<numbers>]`.
    Then delete what the run downloaded or no longer needs, with `<run>` written out in full (never empty, never
    relative: `find` would then start in the current folder). `find`, because zsh stops a whole `rm` on a pattern
    that matches nothing:
    ```sh
    find "<run>" -maxdepth 1 -type f \( -name 'sec-*' -o -name 'whole.*' -o -name 'audio.*' -o -name '*.part' \
      -o -name '*.part-*' -o -name '*.ytdl' -o -name 'captions.*.json3' -o -name sections.json \
      -o -name asr.json -o -name render.json -o -name 'upload-*.json' \) -delete
    rm -rf "<run>/stranger" "<run>/panels"
    ```
    Keep `out/`, a failed clip's `render/clip-<nn>/` and the small files (`clips.json`, `selection.json`,
    `select-request.md`, `segments.json`, `words.json`, `info.json`, `comments.json`): they let you redo a clip or
    render more in this chat. A run that stopped half way is cleaned the same way.
15. **Post**, by `post.md`, the clips in final order.
16. **Log.** Append one line to `<home>/boqo-clips/runs.md`:
    `<YYYY-MM-DD HH:MM> | <url or file> | <n> clips | <run>/out | posted <m>`.

## Render more

`/boqo-clips render [<run>] [N|all|<numbers>]`. `<run>` is the folder named, else the last one in
`<home>/boqo-clips/runs` (the highest name). Read its `clips.json`: `N` is the clips numbered 1 to N, `all` every
clip, `<numbers>` the ones listed, as `clips.json` numbers them now; a clip with `rendered: true` is skipped unless
the person named its number. Then, for the numbers that are left (`<list>`, like `11,12,13`):
1. Sections, from the link in `<run>/info.json` (`webpage_url`) or the run's line in `runs.md`, a file run uses `--src`
   below:
   `node "$HOME/.boqo-clips/tools/fetch.mjs" sections "<url>" --run "<run>" --n <list> > "<run>/sections.json"`
2. Panels (step 10; the probe is already recorded), render
   `node "$HOME/.boqo-clips/tools/render.mjs" --run "<run>" --n <list> --brand "<name>" > "<run>/render.json"`
   (step 11), stranger (12), order (13), summary (14) and its cleanup. The brand is the `--brand` the first render
   used, or the default kit.

## An uploaded or local file

The same run, with three changes:
- **No info step.** The length: `node "$HOME/.boqo-clips/tools/boqo-upload.mjs" probe "<file>"` gives `durationSec`
  (it finds macOS ffmpeg-full's ffprobe, which a plain shell may not have). No `fetch comments`, no `sections`.
- **The transcript,** after asking (Rules): whisper on the whole file, step 3's check, offer and whisper, with
  `"<file>"` itself in place of the audio. With `"transcript": "boqo"`, the boqo transcript with the audio made from
  the file, `ffmpeg -nostdin -v error -y -i "<file>" -vn -c:a aac -b:a 64k "<run>/audio.m4a"` in place of yt-dlp;
  the minutes come from `probe`'s `durationSec`.
- **Render and panels from the file:** `--src "<file>"` on `render.mjs` and on every `panels.mjs` call.

The cleanup deletes only what the run made. Never move, change or delete the person's file.

## Redo one clip

- **Another title or hook:** change that row's `title` (60 characters at most) or `hook` (140) in `<run>/clips.json`,
  then `render.mjs --run "<run>" --n <n> --brand "<name>"` (sections first when step 14's cleanup deleted them: step
  9 with `--n <n>`), step 12 for it, and steps 13 and 14.
- **Other edges, or a clip left out:** the clips need a new selection. Change `<run>/selection.json` (step 6, the
  new edge on a transcript line's timestamp), run the check (step 7), which rebuilds the record, delete `<run>/out`,
  and go on at step 8. Every clip renders again.

## Red flags

| Thought | Reality |
|---|---|
| "No captions: I'll download the video and run whisper" | Ask first, with the time it takes (Rules) |
| "boqo can transcribe it, I'll just do it" | It spends credits: name them and wait for the yes (Rules) |
| "The person said 'nice', so I'll post them" | Only the rule posts. With `ask`, a post needs a yes to posting |
| "I'll download the whole video, it's simpler" | Sections first. `fetch.mjs` falls back to the whole video by itself |
| "I'll read comments after the request" | `select-request` reads `comments.json` once: fetch them first |
| "I'll write `selection.json` in two goes" | One read of the whole request, one answer |
| "select-check moved an edge, I'll put it back" | Edges snap to sentence edges on purpose; choose the line you mean |
| "A ▲ line, so it's a clip" | ▲ is evidence, not an order (`select.md`) |
| "Render all of them, ten is stingy" | 10 by default; the rest on `/boqo-clips render` |
| "The stranger frames cost time, I'll skip them" | The final order reads them: record each rendered clip's judgment |
| "The tool failed, I'll write my own ffmpeg line" | Say the error and stop that step |
| "`RUN=…` once, then `$RUN` in every command" | The variable is gone in the next command. Write the path out |
