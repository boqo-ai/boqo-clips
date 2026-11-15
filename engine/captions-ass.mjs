// Captions as an ASS subtitle file: a clip's words and the person's brand in
// one of four presets (karaoke, punch, clean, highlight), plus an optional hook
// title. The render burns it with `ass=captions.ass:fontsdir=<engine/fonts>`.
import { PRESETS } from './brand.mjs';

/** @typedef {import('./words.mjs').Word} Word */
/** @typedef {import('./brand.mjs').Brand} Brand */

/**
 * The bundled font for each brand font. `family` is the family name in the
 * TTF's `name` table: libass matches the style's Fontname against it and
 * silently falls back to another font on a mismatch. `bold` is the style's
 * Bold flag (-1 selects the bold file; Anton ships one weight, already heavy).
 * The render copies exactly these files, and their licences, into its fonts dir.
 */
export const FONT_FILES = {
  Inter: { family: 'Inter', file: 'Inter-Bold.ttf', bold: -1, license: 'OFL-Inter.txt' },
  Anton: { family: 'Anton', file: 'Anton-Regular.ttf', bold: 0, license: 'OFL-Anton.txt' },
};

const DEFAULT_FRAME = { w: 1080, h: 1920 };
const MAX_GAP_SEC = 0.6;
const HOOK_SEC = 3;
const CAP_FRACTION = 0.045; // font size, as a fraction of frame height
const PUNCH_SCALE = 1.25;
const OUTLINE_FRACTION = 0.004;
const HOOK_Y_FRACTION = 0.12;
const SIDE_MARGIN_FRACTION = 0.055;

// words per group: [min, max]
const GROUP_SIZE = { punch: [1, 2], karaoke: [3, 4], highlight: [3, 4], clean: [1, 6] };

/**
 * `#RRGGBB` as an ASS colour, `&HAABBGGRR` (alpha 0 opaque .. 255 clear).
 * @param {string} hex
 * @param {number} [alpha]
 */
export function assColor(hex, alpha = 0) {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`colour must be #RRGGBB, got ${JSON.stringify(hex)}`);
  }
  const a = Math.min(255, Math.max(0, Math.round(alpha)));
  const h = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  const x = hex.slice(1).toUpperCase();
  return `&H${h(a)}${x.slice(4, 6)}${x.slice(2, 4)}${x.slice(0, 2)}`;
}

/**
 * Text safe to put in a Dialogue. ASS has no escape for `{`, `}` or `\`, so
 * they become their full-width look-alikes; control characters (a newline
 * would end the Dialogue line) become spaces.
 * @param {string} text
 */
export function assEscape(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\\/g, '＼')
    .trim();
}

const endsSentence = (w) => /[.!?]["'”’)\]]*$/.test(w);

/**
 * Words in on-screen groups. A group never spans a gap over 0.6 s and never
 * crosses a sentence end (`.`, `!`, `?`). Each run between those breaks is
 * cut into the fewest groups the preset's maximum allows, evenly, so a run
 * never ends in a one-word orphan. A run shorter than the preset's minimum
 * stays one short group.
 * @param {Word[]} words
 * @param {'karaoke'|'punch'|'clean'|'highlight'} preset
 * @returns {Word[][]}
 */
export function groupWords(words, preset) {
  const size = GROUP_SIZE[preset];
  if (!size) throw new Error(`unknown caption preset ${JSON.stringify(preset)}`);
  const max = size[1];

  const runs = [];
  let run = [];
  for (const w of words) {
    const prev = run.at(-1);
    if (prev && w.s - prev.e > MAX_GAP_SEC + 1e-9) {
      runs.push(run);
      run = [];
    }
    run.push(w);
    if (endsSentence(w.w)) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  const groups = [];
  for (const r of runs) {
    const k = Math.ceil(r.length / max);
    const base = Math.floor(r.length / k);
    const extra = r.length % k;
    let at = 0;
    for (let i = 0; i < k; i++) {
      const n = base + (i < extra ? 1 : 0);
      groups.push(r.slice(at, at + n));
      at += n;
    }
  }
  return groups;
}

// centiseconds, floored (with a nudge for 1.15 * 100 = 114.999...) so a time
// never lands past the word it came from
const cs = (sec) => Math.max(0, Math.floor(sec * 100 + 1e-6));
function stamp(centis) {
  const h = Math.floor(centis / 360000);
  const m = Math.floor((centis % 360000) / 6000);
  const s = Math.floor((centis % 6000) / 100);
  const c = centis % 100;
  const p = (n) => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(s)}.${p(c)}`;
}

// black or white, whichever reads on this colour (the highlight box's text)
function contrastOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#000000' : '#FFFFFF';
}

// a colour inside an override tag: \1c wants &HBBGGRR& (no alpha digits)
const tagColor = (hex) => `${assColor(hex).replace(/^&H00/, '&H')}&`;

// one `Style:` line; the outline colour is also BorderStyle 3's box colour
function styleLine(name, font, size, { primary, outlineColor = '#000000', borderStyle = 1, outline, alignment = 5 }, side) {
  return [
    `Style: ${name}`, font.family, size, primary, primary, assColor(outlineColor), assColor('#000000'),
    font.bold, 0, 0, 0, 100, 100, 0, 0, borderStyle, outline, 0, alignment, side, side, 0, 1,
  ].join(',');
}

/**
 * The ASS file for a clip.
 * @param {Word[]} words rebased to the clip (see `wordsInRange`)
 * @param {Brand} brand
 * @param {{ w: number, h: number }} [frame] default 1080x1920
 * @param {string} [hook] a title shown at the top for the first 3 s
 * @returns {string}
 */
export function assFor(words, brand, frame = DEFAULT_FRAME, hook) {
  const { w, h } = frame ?? DEFAULT_FRAME;
  const preset = brand.captions.preset;
  if (!PRESETS.includes(preset)) throw new Error(`unknown caption preset ${JSON.stringify(preset)}`);
  const font = FONT_FILES[brand.font];
  if (!font) throw new Error(`unknown brand font ${JSON.stringify(brand.font)}`);

  const text = assColor(brand.colors.text);
    const size = Math.round(CAP_FRACTION * h * brand.captions.size);
  const outline = Math.round(OUTLINE_FRACTION * h);
  const side = Math.round(SIDE_MARGIN_FRACTION * w);
  const x = Math.round(w / 2);
  const y = Math.round(brand.captions.position * h);
  const place = `\\an5\\pos(${x},${y})`;

  const sorted = [...words].sort((a, b) => a.s - b.s);
  const hookText = typeof hook === 'string' ? assEscape(hook) : '';

  const styles = [styleLine('Default', font, size, { primary: text, outline }, side)];
  if (preset === 'punch') {
    styles.push(styleLine('Punch', font, Math.round(size * PUNCH_SCALE), { primary: text, outline }, side));
  }
  if (preset === 'highlight') {
    // BorderStyle 3 draws the outline colour as a box; its width is the padding
    const box = { primary: text, outlineColor: brand.colors.accent, borderStyle: 3, outline: outline * 2 };
    styles.push(styleLine('Box', font, size, box, side));
  }
  if (hookText) {
    styles.push(styleLine('Hook', font, Math.round(size * 1.1), { primary: text, outline, alignment: 8 }, side));
  }

  const events = [];
  const add = (style, startSec, endSec, body) => {
    const a = cs(startSec);
    const b = cs(endSec);
    if (b <= a) return;
    events.push(`Dialogue: 0,${stamp(a)},${stamp(b)},${style},,0,0,0,,${body}`);
  };

  if (hookText) {
    const last = sorted.at(-1);
    const end = last ? Math.min(HOOK_SEC, last.e) : HOOK_SEC;
    add('Hook', 0, end, `{\\an8\\pos(${x},${Math.round(HOOK_Y_FRACTION * h)})\\fad(150,150)}${hookText}`);
  }

  const shown = (word) => assEscape(preset === 'punch' ? word.w.toUpperCase() : word.w);
  for (const group of groupWords(sorted, preset)) {
    if (preset === 'clean') {
      add('Default', group[0].s, group.at(-1).e, `{${place}}${group.map(shown).join(' ')}`);
    } else if (preset === 'punch') {
      const pop = '\\fscx85\\fscy85\\t(0,100,\\fscx100\\fscy100)';
      add('Punch', group[0].s, group.at(-1).e, `{${place}${pop}}${group.map(shown).join(' ')}`);
    } else {
      // karaoke and highlight: the whole group stays up, one Dialogue per
      // spoken word, each running to the next word's start
      const accent = tagColor(brand.colors.accent);
      const plain = tagColor(brand.colors.text);
      const boxText = tagColor(contrastOn(brand.colors.accent));
      group.forEach((spoken, i) => {
        const parts = group.map((word) => {
          if (word !== spoken) return shown(word);
          return preset === 'karaoke'
            ? `{\\1c${accent}}${shown(word)}{\\1c${plain}}`
            : `{\\rBox\\3c${accent}\\1c${boxText}}${shown(word)}{\\r}`;
        });
        add('Default', spoken.s, i < group.length - 1 ? group[i + 1].s : spoken.e, `{${place}}${parts.join(' ')}`);
      });
    }
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    ...events,
    '',
  ].join('\n');
}
