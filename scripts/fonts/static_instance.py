"""Static copies of the two variable caption faces, drawn by libass through `fontsdir` as boqo's image draws them.

    python -I scripts/fonts/static_instance.py <Montserrat[wght].ttf> <Oswald[wght].ttf> <out dir>

Dev tooling, never shipped or run on the person's machine (fontTools==4.60.1 in a scratch venv). The inputs are the
files boqo's worker Dockerfile downloads at google/fonts 6a003b5eb672dc8bf5bff5937cf5863f8b175445 (engine/fonts/
SOURCES.md has the URLs and sha256s); the outputs are engine/fonts/Montserrat-ExtraBold.ttf and Oswald-Bold.ttf.

Why not the variable files themselves: libass loads a `fontsdir` font as a memory font and registers only its
default instance, never its named ones. Measured 2026-11-16 (BtbN ffmpeg 8.1, libass through fontsdir): "Montserrat
ExtraBold" found no face at all and fell back to the system's Noto Sans Bold, and "Oswald" Bold resolved to the
default instance, Oswald-Regular. boqo's image installs the files system-wide, where fontconfig lists every named
instance, so hosted gets Montserrat_800wght and Oswald_700wght.

Each output is the named instance (wght 800, wght 700) cut out of its variable font with names updated from STAT,
then given the OS/2 weight and style bits of the variable font's DEFAULT instance (Thin 100 for Montserrat, Regular
400 for Oswald). In the image libass draws the named instance with a synthetic bold on top of its own weight, and
these bits are what made it embolden the static copy the same way (the default instance's weight is presumably what
it reads off the named one; not read from libass's source). Measured 2026-11-16 in boqo-render (the worker
image), four lines (Latin, digits, punctuation, Cyrillic, a 130% run) at size 100, the image's system instance
against this file through fontsdir with the system file hidden: on every line the left and right ink edges agree to
the pixel (Montserrat's bottom moves by one anti-aliased row on one line) and the ink sum is within 0.2%
(Montserrat 1.0017, Oswald 1.0000). With the true weights (800, 700) the edges still agree within 1 px but the ink
falls by 9-10%: the synthetic bold is missing. Bold 0 gave the same match for Montserrat; Oswald is only ever drawn
at Bold -1 (CAPTION_FACES). scripts/fonts/verify-in-image.sh is that check, over every caption face.

Deterministic: the head.modified timestamp is kept from the input, so a rerun writes the same bytes.
"""

import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# (input file name prefix, wght of the named instance boqo draws, output, the default instance's usWeightClass)
FACES = [
    ("Montserrat", 800, "Montserrat-ExtraBold.ttf", 100),
    ("Oswald", 700, "Oswald-Bold.ttf", 400),
]


def main(montserrat, oswald, out_dir):
    for (name, wght, out, default_weight), src in zip(FACES, (montserrat, oswald)):
        font = TTFont(src, recalcTimestamp=False)
        assert font["OS/2"].usWeightClass == default_weight, (name, font["OS/2"].usWeightClass)
        static = instancer.instantiateVariableFont(font, {"wght": wght}, updateFontNames=True)
        os2 = static["OS/2"]
        os2.usWeightClass = default_weight
        os2.fsSelection = (os2.fsSelection & ~((1 << 0) | (1 << 5))) | (1 << 6)  # not ITALIC, not BOLD; REGULAR
        static["head"].macStyle &= ~1  # not bold
        static.recalcTimestamp = False
        static.save(f"{out_dir}/{out}")
        print(out, {i: static["name"].getDebugName(i) for i in (1, 2, 4, 6, 16, 17)})


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
