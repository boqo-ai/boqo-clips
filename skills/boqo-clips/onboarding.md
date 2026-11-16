# Onboarding

Runs from INSTALL.md step 6, and from a run that finds no brand kit or no `<home>/boqo-clips/config.json`
(SKILL.md → The run, step 1). Three parts, in order: the brand kit, the boqo connection, the posting rule. Skip a part
that is done: a kit `node "$HOME/.boqo-clips/tools/brand.mjs" list` already shows (kits are shared by every boqo skill, so
another one may have made it), the rule already in `config.json`.

Open with two sentences: in about two minutes you set up their brand kit (a name, a logo, a colour or two, and a
caption style they pick by looking at it), then make their first clips. When they already gave a link or file, say it is
clipped right after.

## 1. The brand kit

`<samples>` is `<home>/boqo-clips/samples`, written out in full in every command, in double quotes (SKILL.md →
Overview, Paths in commands). `mkdir -p "<samples>"` first.

Four questions. Ask the first two in one message.
1. **Name:** the brand's name, 1 to 40 letters, digits, spaces, `-` or `_`.
2. **Logo:** a PNG or JPG, as a file path or a URL. A PNG with a transparent background looks best. No logo is fine:
   the clips then carry none. A URL is fetched once into a scratch home, which also checks it is a PNG or JPG under
   10 MB:
   ```sh
   echo '{"name": "logo"}' > "<samples>/logo.json"
   BOQO_HOME="<samples>/home" node "$HOME/.boqo-clips/tools/brand.mjs" save "<samples>/logo.json" --logo "<url>"
   ```
   From then on `<logo>` is the file its reply names in `brand.logo.file`.
3. **Colours:** the accent, which marks the spoken or key word, and the caption text colour when it is not white.
   Open the logo image and offer its strongest colour as the accent, in hex: "#E63946 from your logo?".
4. **Caption style,** by sight: render the sample sheet below, show it, and ask which one they want.

**The styles,** boqo's own, by the key a kit names: `karaoke`, `punch`, `clean`, `highlight`, `classic`, `bounce`,
`neon`, `boldkeys`, `typewriter`, `slide`, `comic`, `marker`, `stack`, `minimal`, `editorial`. **Headline styles** (the
title plate at the top): `plate`, `outline`, `neon`, `marker`, `tag`, `stack`.

**The samples.** The sample kits are saved into a scratch home inside `<samples>`, so nothing real is saved before
the person chooses.
1. A 5 s source:
   ```sh
   ffmpeg -v error -y -f lavfi -i color=c=0x24242C:s=1920x1080:r=30:d=5 -c:v libx264 -pix_fmt yuv420p \
     "<samples>/src.mp4"
   ```
2. `<samples>/words.json`, the sample line (in the person's language when it is not English: keep the times, change
   the words):
   ```json
   [{"w":"Every","s":0.2,"e":0.55},{"w":"clip","s":0.55,"e":0.9},{"w":"gets","s":0.9,"e":1.25},
    {"w":"your","s":1.25,"e":1.5},{"w":"captions,","s":1.5,"e":2.1},{"w":"your","s":2.3,"e":2.55},
    {"w":"colours","s":2.55,"e":3.05},{"w":"and","s":3.05,"e":3.25},{"w":"your","s":3.25,"e":3.5},
    {"w":"logo.","s":3.5,"e":4.2}]
   ```
3. `<samples>/pick.json`: `[{"s": 0, "e": 5, "title": "<name>"}]`.
4. For each style key above, in that order, numbered `01` to `15`: write `<samples>/<style>.json`,
   `{"name": "<style>", "captions": {"style": "<style>", "accentColours": ["<accent>"]}}` (add
   `"baseColour": "<text>"` when the text is not white), then
   ```sh
   BOQO_HOME="<samples>/home" node "$HOME/.boqo-clips/tools/brand.mjs" save "<samples>/<style>.json" --logo "<logo>"
   BOQO_HOME="<samples>/home" node "$HOME/.boqo-clips/tools/render.mjs" --src "<samples>/src.mp4" \
     --picks "<samples>/pick.json" --words "<samples>/words.json" --brand "<style>" --out "<samples>/<style>"
   ffmpeg -v error -y -ss 2.8 -i "<samples>/<style>/clip-01.mp4" -vf scale=360:640 -frames:v 1 "<samples>/f<NN>.jpg"
   ```
   With no logo, leave out `--logo`. Each sample is `<samples>/<style>/clip-01.mp4`.
5. One sheet, 5 across and 3 down, in the order of the list:
   ```sh
   ffmpeg -v error -y -framerate 1 -i "<samples>/f%02d.jpg" -vf tile=5x3 -frames:v 1 "<samples>/styles.jpg"
   ```
   Give the person `<samples>/styles.jpg` first, with the style names in order, then the clips of the ones they ask
   about, which show how the words move.

**The kit.** Once they choose, write `<samples>/brand.json` and save it for real:

```json
{
  "version": 2,
  "name": "<name>",
  "captions": { "style": "neon", "accentColours": ["#E63946"] },
  "logo": { "anchor": "top-right" }
}
```

```sh
node "$HOME/.boqo-clips/tools/brand.mjs" save "<samples>/brand.json" --logo "<logo>"
```

Then `rm -rf "<samples>"`, with the path written out in full (never empty), and tell the person in one line that the
kit is saved and every boqo skill uses it.
- A key not in the kit's schema is refused, and the error names it: fix the file, never work around it.
- What a kit leaves out is boqo's Default template: `captions` punch in `#E900FA` at 0.7, `headline` the lime title
  plate for the first 12 s, `logo` bottom-left at 0.1 of the frame's width and 0.35 opacity (the whole clip), `ratio`
  `9:16`. `"headline": null` is no title plate, `"logo": null` no logo.
- On the person's ask only, under `captions`: `positionFraction` 0.1 to 0.9, `sizeScale` 0.7 to 1.4, `baseColour`,
  `accentColours` (one or two), `textCase` (`upper`, `preserve`, `lower`), `font`, `keyFont`, `outlineColour`,
  `glowColour`, `glowStrength`, `shadowColour`, `cycle`, `speed`, `wordsTarget`. Under `headline`: `style`, `source`
  (`title` or `hook`), `plateColour`, `textCase`, `entrance`, `positionFraction` 0.08 to 0.92, `timing`; a block names
  the fields it changes, the other required ones are the Default's. Under `logo`: `anchor` (`top-left`, `top-centre`,
  `top-right`, `bottom-left`, `bottom-centre`, `bottom-right`), `width` up to 0.5, `marginX`, `marginY`, `opacity` 0.05
  to 1, `timing` (`{"kind": "whole"}` or `{"kind": "window", "startSec": 0, "holdSec": 12}`).
- The first kit saved becomes the default; `brand.mjs default "<name>"` changes it.
- **Changing a kit later:** `brand.mjs show "<name>"`, change the keys in its `brand`, and save that with `--logo`
  again, or with `logo.file` as `show` printed it. A save with neither drops the logo.
- **A kit made before boqo's template shape** (no `"version"`: `preset`, `colors`, `font`, `hook`) loads converted and
  stays as it is on disk until the person next saves it. One that used `"font": "Anton"` now draws as `boldkeys`; say
  so once, in one line, when you meet one.

## 2. The boqo connection

Look for boqo's tools: `list_accounts` among yours. A tool may be deferred (in Claude Code, search the tool list for
it) before its absence means anything.
- **With them:** call `list_accounts` and say, in one line, which accounts are connected (platform and handle: the
  text inside its `<data …>` tag), or that none are yet (they connect them in boqo, under Accounts).
- **Without them:** say once that clips work without boqo, and posting to TikTok, Instagram and YouTube from here
  needs the boqo connector. Give the one line for this agent:
  - Claude Code: `claude mcp add --transport http boqo https://mcp.boqo.ai/mcp`, then `/mcp` to sign in.
  - Cursor: the Add to Cursor button on https://boqo.ai/mcp, or `"boqo": {"url": "https://mcp.boqo.ai/mcp"}` under
    `mcpServers` in its `mcp.json`.
  - VS Code: `"boqo": {"type": "http", "url": "https://mcp.boqo.ai/mcp"}` under `servers` in its `mcp.json`.
  - Any other agent: add `https://mcp.boqo.ai/mcp` as a remote MCP server; https://boqo.ai/mcp has the steps per
    agent.

  Go on either way: nothing waits for it.

## 3. The posting rule

`mkdir -p "<home>/boqo-clips"`. With boqo's tools, ask once: post each clip only after they say yes (the default), or
post automatically, up to N a day, to the accounts they name. Without them, write the default and ask nothing.

`<home>/boqo-clips/config.json`:
- `{"posting": "ask"}`, the default;
- `{"posting": {"auto": 2}, "accounts": ["<account id>"]}`, with the ids from `list_accounts`.

The rule changes only when the person says so ("post them automatically", "ask me first"): rewrite the file then.

Onboarding is done. With a link or file from the person, go on at SKILL.md → The run, step 1; without one, ask for
it.
