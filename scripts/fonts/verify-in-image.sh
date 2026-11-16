#!/bin/sh
# Do the bundled fonts draw as boqo's worker image draws its own? Dev tooling, run on a box holding the built image:
#
#   docker run --rm --network none -u 0 -v "$PWD/engine/fonts:/fonts:ro" -v "$PWD/scripts/fonts:/check:ro" \
#     --entrypoint /bin/sh boqo-render:latest /check/verify-in-image.sh
#
# For every face in caption-faces.ts's CAPTION_FACES, at the Bold flag it is drawn at: four lines rendered with the
# image's own system fonts (A), then, with the image's caption font files moved away, the same lines through
# `fontsdir=/fonts` (B). Prints each side's fontselect line, whether every line's ink box is the same (left and right
# edges to the pixel, top and bottom within one row), the ink sum of B over A, and the count of pixels that differ.
# Exit 1 when a box differs or the ink sum moves by more than 1%.
set -eu
cd /tmp
LATIN='HAMBURGEFONSTIV 0123456789|the quick brown fox, jumps! WAVE?|{\fscx130\fscy130}YOU'"'"'VE BRAND-NEW 1ST'
FULL="$LATIN|ПРИВЕТ МИР ЭТО ЖЁЛТЫЙ щука"
ROWS='Montserrat ExtraBold|-1|full
Oswald|-1|full
Inter|-1|full
DejaVu Sans|-1|full
Anton|0|latin
Bebas Neue|0|latin
Bangers|0|latin
Poppins Black|-1|latin
Archivo Black|0|latin
Luckiest Guy|0|latin
Permanent Marker|0|latin'

ass() { # family bold lines out
  {
    printf '[Script Info]\nScriptType: v4.00+\nPlayResX: 2400\nPlayResY: 900\nWrapStyle: 2\n\n[V4+ Styles]\n'
    printf 'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    printf 'Style: p,%s,100,&H00FFFFFF,&H00000000,&H00000000,%s,0,0,0,100,100,0,0,1,7,0,7,0,0,0,1\n\n[Events]\n' "$1" "$2"
    printf 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    echo "$3" | tr '|' '\n' | awk '{ printf "Dialogue: 0,0:00:00.00,0:00:01.00,p,,0,0,0,,{\\pos(20,%d)}%s\n", 20 + (NR - 1) * 220, $0 }'
  } > "$4"
}
render() { # ass out fontsdir-suffix -> prints the fontselect lines
  ffmpeg -hide_banner -nostdin -v debug -f lavfi -i color=c=black:s=2400x900:d=0.1:r=1 -vf "subtitles=$1$3" \
    -frames:v 1 -f rawvideo -pix_fmt gray "$2" 2>&1 | sed -n 's/.*\(fontselect: .*\)/\1/p' | sort -u | tr '\n' ' '
}
i=0
echo "$ROWS" | while IFS='|' read -r fam bold set; do
  i=$((i + 1)); [ "$set" = full ] && lines="$FULL" || lines="$LATIN"
  ass "$fam" "$bold" "$lines" "f$i.ass"; echo "$fam|$bold" > "f$i.name"
  render "f$i.ass" "f$i.a.raw" "" > "f$i.a.sel"
done
mv /usr/share/fonts/truetype/boqo /tmp/hidden-boqo
mv /usr/share/fonts/opentype/inter/Inter-Bold.otf /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf /tmp/
fc-cache -f
fail=0
for a in f*.ass; do
  n="${a%.ass}"
  render "$a" "$n.b.raw" ":fontsdir=/fonts" > "$n.b.sel"
  node -e '
    const fs = require("fs");
    const [n] = process.argv.slice(1);
    const a = fs.readFileSync(`${n}.a.raw`), b = fs.readFileSync(`${n}.b.raw`), W = 2400;
    const box = (buf, y0, y1) => { let l = W, r = -1, t = 1e9, bt = -1, s = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { const v = buf[y * W + x]; if (v) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); bt = Math.max(bt, y); s += v; } } return { k: `${l},${t},${r},${bt}`, l, r, t, bt, s }; };
    // Advances decide the line breaks: the left and right ink edges must agree to the pixel; the top and bottom may move
    // by one anti-aliased row (an instanced outline is rounded to whole font units).
    const near = (A, B) => A.l === B.l && A.r === B.r && Math.abs(A.t - B.t) <= 1 && Math.abs(A.bt - B.bt) <= 1;
    let same = true, sa = 0, sb = 0, diff = 0;
    const boxes = [];
    for (let k = 0; k < 4; k++) { const A = box(a, k * 220, k * 220 + 220), B = box(b, k * 220, k * 220 + 220); same &&= near(A, B); sa += A.s; sb += B.s; if (A.k !== B.k) boxes.push(`line ${k + 1}: A ${A.k} B ${B.k}`); }
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    const ratio = sb / sa;
    console.log(`${fs.readFileSync(`${n}.name`, "utf8").trim()}\n  A ${fs.readFileSync(`${n}.a.sel`, "utf8").trim()}\n  B ${fs.readFileSync(`${n}.b.sel`, "utf8").trim()}\n  boxes ${same ? (boxes.length ? `same within a row (${boxes.join("; ")})` : "same") : `DIFFER (${boxes.join("; ")})`}, ink B/A ${ratio.toFixed(4)}, ${diff} px differ`);
    process.exit(same && Math.abs(ratio - 1) <= 0.01 ? 0 : 1);
  ' "$n" || fail=1
done
exit $fail
