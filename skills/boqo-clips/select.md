# Picking the moments

You read the transcript and choose the moments that work as shorts on their own. The person sees the clips, not
your reasons: every pick has to earn its place.

## What you read

`<run>/transcript.md`: `## Part N (start–end)` sections of 15 minutes. Each line is `[mm:ss] words` (`h:mm:ss` past
an hour), a new line about every 8 s. A line that ends in `▲` falls in a stretch YouTube's viewers replayed most.

## What makes a short

- **It stands alone.** Someone who never saw the video understands it from its first line. It does not open on
  "so", "and that's why", or a "he" or "this" that points at something said before.
- **It opens on its strongest line:** a claim, a question, a number, a confession, a disagreement. Never a greeting,
  a wind-up or "yeah, um". When the strong line follows a setup the viewer does not need, start at the strong line.
- **It has a payoff:** an answer, a punchline, a turn, a concrete example. It ends on the sentence that lands it,
  before the next thought starts. No payoff, no pick.
- **20 to 60 s,** unless the person asked for another length. Shorter is better when the payoff lands early: never
  pad to fill the time.
- **One idea.** Two good ideas back to back are two picks, or the better one.
- **The ▲ marks are evidence, not orders.** They say viewers rewatched that stretch, not why: it may be a visual gag,
  a chapter skip or an ad. A ▲ moment still passes every rule above, and the best pick may have no mark at all.
- **Words carry it.** You cannot see the video. Skip a moment that depends on the screen ("look at this", a demo, a
  chart) unless the words alone work.
- **Not a pick:** a sponsor read, an intro or outro, "like and subscribe", housekeeping, an inside joke that needs
  the episode. Never cut a line so the speaker seems to say what they did not mean.

## How many

`n` is the video's minutes divided by 6, rounded, at least 3 and at most 10: a 40-minute talk gets 7. Pick fewer
only when fewer moments pass the rules, and tell the person why. Never fill the count with weak ones. Picks never
overlap.

## How to read

1. **One part at a time.** For each candidate, note its start and end stamps, its first words and its payoff, in a
   line; then read the next part. Several candidates in a part is normal.
2. **Rank,** after the last part: the strongest opening line and the clearest payoff win. Keep `n`. Spread them over
   the video only to break a tie.
3. **Set the edges** from the words (SKILL.md → Helpers → Words around a time), at each pick's start and end:
   `s` a little inside the opening word (its start + 0.05), `e` a little inside the payoff's last word (its end −
   0.05). `picks-check.mjs` then moves each edge out to that word's boundary. An edge set exactly on a boundary can
   take in the neighbouring word ("and", "but") instead.
4. **Keep sound tags out.** YouTube's automatic captions carry `[Music]` and `[Applause]` as words: inside a pick
   they burn into the captions. End before one, or start after it.

## Titles and hooks

- **`title`:** under 60 characters, in the video's language, saying what the viewer gets from this clip. No promise
  the clip does not keep: the "secret" is in the clip, the "shocking" part shocks. No hashtags, no emoji, no
  all-caps sentence. At least two words, and no `-`, `_` or `/`: the title becomes the post's file name, where boqo
  reads `-` and `_` as spaces.
- **`hook`** (optional): at most 6 words, shown at the top of the clip for its first 3 s when the brand has hooks
  on. Without one, the title is shown there. Write one when the title runs long; the opening line's sharpest words
  often are the hook.

## The file

`<run>/picks.json`, best first: `clip-01` is the strongest.

```json
[
  { "s": 754.2, "e": 801.9, "title": "Why most startups die in year two", "hook": "Year two kills startups" },
  { "s": 1312.0, "e": 1349.5, "title": "The one question he asks every founder" }
]
```

`s` and `e` are seconds on the video's timeline (`[12:34]` is 754). The type is `Pick[]`, with
`Pick = { s: number, e: number, title: string, hook?: string }`.
