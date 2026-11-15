# Posting through boqo

Runs after the clips are shown (SKILL.md → The run, step 9). It posts only through boqo's tools, and only by the rule
in `<home>/boqo-clips/config.json`. Posting the clip as it is costs no credits.

## Before the first clip

1. **No boqo tools** (no `list_accounts`, onboarding.md → 2): stop here. Posting is not offered unless the person
   asks; then give the one line for this agent from onboarding.md → 2.
2. **The rule.**
   - `ask`, or no config file: offer it in one line ("Post any of these? Which, and where?") and wait. A no, or no
     answer: stop; the files stay where they are.
   - `{"auto": N}`: the clips go best first (`clip-01` first), up to N minus the posts already made today (the
     `posted` counts of today's lines in `runs.md`), to the config's `accounts`, with no question. The person is told
     what went (step 8). No `accounts` in the config: as `ask`.
3. **The plan.** `get_account`. Its `planKey` `none` (the plan "Free"): say "Autoposting comes with the 7-day trial
   or Starter from $12", and stop. Do not call `billing_link`; give a link only when the person asks how to start.
4. **The accounts.** `list_accounts`, the ones with status `active`. With `ask`, the person names them; several and
   no name: ask which, never choose for them. None active: say so (they connect or reconnect it in boqo, under
   Accounts), and stop.

## Each clip

One clip at a time. `<file>` is its path, `<k>` its number.
1. `node ~/.boqo-clips/tools/boqo-upload.mjs probe <file>` gives `sizeBytes`, `contentType` and `passthrough`.
   `passthrough: false`: say its `reasons` and skip the clip.
2. `node ~/.boqo-clips/tools/boqo-upload.mjs name "<the clip's title>"` gives `filename`. An error (a `-`, `_` or `/`,
   a single word): reword the title without it, and use the new title from here on.
3. `create_upload {filename, contentType: "video/mp4", sizeBytes, kind: "post"}`. Write its reply, exactly as it came,
   to `<run>/upload-<k>.json`. It holds signed upload URLs: never print them, quote them or put them in `runs.md`.
4. `node ~/.boqo-clips/tools/boqo-upload.mjs put <file> --reply <run>/upload-<k>.json` gives
   `{"ok": true, "projectId", …}`: delete `<run>/upload-<k>.json`. `"ok": false` or an error: say which part failed,
   keep the reply file and stop this clip; its URLs live 48 hours, so a retry in that time runs `put` again with it.
5. `complete_upload {projectId}`. A link in its reply (a daily credit cap on this connection): give it to the person,
   and stop this clip.
6. `get_project {projectId}` until its `status` is `ready`; a clip is usually ready within a minute or two, and after
   10 minutes you give up on it. `failed`: say its error, and stop this clip.
7. `post_video {items: [{source: "<projectId>", accountIds: ["<id>", …], when: "queue"}]}`. `"queue"` is each
   account's next free slot; a time the person named is `{date: "YYYY-MM-DD", time: "HH:MM"}` on the account's own
   clock. No `caption` (The caption) and no `uniqueize`.
8. One line: the clip, the accounts, and when it goes out.

## The caption

Leave `caption` out. The post's words are then the clip's title (its upload file name) plus the account's default
tags. Say once, the first time you post: a caption written here needs "Captions written by the agent" switched on in
boqo (Accounts, the account, Defaults). Only after the person says it is on, pass `caption` in step 7, in words they
approved. A refusal naming that setting: post again without `caption`.

## Refusals

A refusal from boqo is its own sentence: say it as it came, keep the files, stop that clip. "Publishing needs a paid
plan." stops them all, with the plan line: "Autoposting comes with the 7-day trial or Starter from $12".

The number of clips posted goes into the run's line in `runs.md` (SKILL.md → The run, step 10).
