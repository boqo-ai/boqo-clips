import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { assFor, assColor, assEscape, groupWords, FONT_FILES } from '../engine/captions-ass.mjs'
import { defaultBrand, FONTS } from '../engine/brand.mjs'

const FONTS_DIR = fileURLToPath(new URL('../engine/fonts/', import.meta.url))

const brandWith = (captions = {}, rest = {}) => {
  const b = defaultBrand('t')
  return { ...b, ...rest, captions: { ...b.captions, ...captions } }
}

// n words, 0.3 s each, 0.1 s apart, no sentence ends
const flow = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    w: `w${i}`,
    s: Math.round((from + i * 0.4) * 1000) / 1000,
    e: Math.round((from + i * 0.4 + 0.3) * 1000) / 1000,
  }))

const toSec = (t) => {
  const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(t)
  assert.ok(m, `bad ASS time ${t}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
}

const dialogues = (ass) =>
  ass
    .split('\n')
    .filter((l) => l.startsWith('Dialogue:'))
    .map((l) => {
      const f = l.slice('Dialogue:'.length).trim().split(',')
      return {
        layer: f[0],
        start: toSec(f[1]),
        end: toSec(f[2]),
        style: f[3],
        text: f.slice(9).join(','),
      }
    })

const styleLine = (ass, name) => ass.split('\n').find((l) => l.startsWith(`Style: ${name},`))

test('assColor is &HAABBGGRR', () => {
  assert.equal(assColor('#C8FF4D'), '&H004DFFC8')
  assert.equal(assColor('#000000', 255), '&HFF000000')
  assert.equal(assColor('#c8ff4d', 0x80), '&H804DFFC8')
  assert.throws(() => assColor('C8FF4D'))
  assert.throws(() => assColor('#12345'))
})

test('assEscape leaves no raw brace or backslash', () => {
  const out = assEscape('a{b}c\\d')
  assert.ok(!/[{}\\]/.test(out), out)
  assert.equal(out, 'a｛b｝c＼d')
  assert.equal(assEscape('line\nbreak\r\nhere'), 'line break here')
  assert.equal(assEscape('plain 🙂 text'), 'plain 🙂 text')
})

test('groupWords sizes groups by preset', () => {
  const words = flow(24)
  for (const g of groupWords(words, 'punch')) assert.ok(g.length >= 1 && g.length <= 2, 'punch 1-2')
  for (const p of ['karaoke', 'highlight']) {
    for (const g of groupWords(words, p)) assert.ok(g.length >= 3 && g.length <= 4, `${p} 3-4`)
  }
  const clean = groupWords(words, 'clean')
  assert.ok(clean.every((g) => g.length <= 6))
  assert.ok(clean.some((g) => g.length >= 5))
  // every word lands in exactly one group, in order
  assert.deepEqual(clean.flat(), words)
  assert.deepEqual(groupWords([], 'karaoke'), [])
  assert.throws(() => groupWords(words, 'bold'))
})

test('a group never spans a gap over 0.6 s', () => {
  const words = [
    { w: 'a', s: 0, e: 0.3 },
    { w: 'b', s: 0.4, e: 0.7 },
    { w: 'c', s: 1.4, e: 1.7 }, // 0.7 s after b: split
    { w: 'd', s: 1.8, e: 2.1 },
    { w: 'e', s: 2.7, e: 3.0 }, // exactly 0.6 s after d: stays
  ]
  const groups = groupWords(words, 'clean')
  assert.deepEqual(groups.map((g) => g.map((x) => x.w)), [['a', 'b'], ['c', 'd', 'e']])
})

test('a group never crosses a sentence end', () => {
  const words = [
    { w: 'Hello', s: 0, e: 0.3 },
    { w: 'there.', s: 0.3, e: 0.6 },
    { w: 'How', s: 0.7, e: 0.9 },
    { w: 'are', s: 0.9, e: 1.1 },
    { w: 'you?!', s: 1.1, e: 1.4 },
    { w: 'Fine', s: 1.5, e: 1.8 },
    { w: '"ok."', s: 1.8, e: 2.1 },
    { w: 'yes', s: 2.1, e: 2.4 },
  ]
  for (const p of ['karaoke', 'punch', 'clean', 'highlight']) {
    for (const g of groupWords(words, p)) {
      const i = g.findIndex((x) => /[.!?]["')\]]*$/.test(x.w))
      assert.ok(i === -1 || i === g.length - 1, `${p}: ${g.map((x) => x.w).join(' ')}`)
    }
  }
  assert.deepEqual(groupWords(words, 'clean').map((g) => g.length), [2, 3, 2, 1])
})

test('FONT_FILES names the family of the bundled file', () => {
  assert.deepEqual(Object.keys(FONT_FILES).sort(), [...FONTS].sort())
  for (const [font, m] of Object.entries(FONT_FILES)) {
    const path = join(FONTS_DIR, m.file)
    assert.ok(existsSync(path), `${font}: ${m.file} bundled`)
    const info = readFontNames(readFileSync(path))
    assert.equal(info.family, m.family, `${font}: ASS Fontname is the real family`)
    assert.equal(info.bold, m.bold !== 0, `${font}: Bold flag matches the file`)
    assert.ok(existsSync(join(FONTS_DIR, m.license)), `${font}: licence bundled`)
  }
})

test('the style uses the brand font and round(0.045 * 1920 * size)', () => {
  for (const font of FONTS) {
    for (const size of [0.7, 1, 1.4]) {
      const ass = assFor(flow(6), brandWith({ size }, { font }))
      const st = styleLine(ass, 'Default')
      assert.ok(st, 'a Default style')
      assert.ok(ass.includes('[V4+ Styles]'))
      const f = st.slice('Style: '.length).split(',')
      assert.equal(f[1], FONT_FILES[font].family)
      assert.equal(Number(f[2]), Math.round(0.045 * 1920 * size))
      assert.equal(Number(f[7]), FONT_FILES[font].bold, 'Bold flag')
    }
  }
  assert.throws(() => assFor(flow(3), brandWith({}, { font: 'Comic' })))
})

test('script info carries the frame and outline is black, ~0.004 of the height', () => {
  const ass = assFor(flow(4), brandWith())
  assert.match(ass, /PlayResX: 1080/)
  assert.match(ass, /PlayResY: 1920/)
  const f = styleLine(ass, 'Default').slice('Style: '.length).split(',')
  assert.equal(f[5], '&H00000000', 'OutlineColour')
  assert.equal(Number(f[16]), Math.round(0.004 * 1920), 'Outline')
  assert.equal(Number(f[17]), 0, 'Shadow')
  assert.equal(f[15], '1', 'BorderStyle 1')
  const small = assFor(flow(4), brandWith(), { w: 720, h: 1280 })
  assert.match(small, /PlayResX: 720/)
  assert.match(small, /PlayResY: 1280/)
  assert.match(small, new RegExp(`\\\\pos\\(360,${Math.round(0.72 * 1280)}\\)`))
})

test('clean: one Dialogue per group at \\pos(540, position * 1920), text colour', () => {
  const words = flow(12)
  const brand = brandWith({ preset: 'clean', position: 0.7 })
  const ass = assFor(words, brand)
  const groups = groupWords(words, 'clean')
  const d = dialogues(ass)
  assert.equal(d.length, groups.length)
  d.forEach((x, i) => {
    assert.match(x.text, new RegExp(`\\\\pos\\(540,${Math.round(0.7 * 1920)}\\)`))
    assert.equal(x.start, groups[i][0].s)
    assert.equal(x.end, groups[i].at(-1).e)
    assert.ok(x.text.endsWith(groups[i].map((w) => w.w).join(' ')))
    assert.ok(!x.text.includes('\\1c'), 'no accent in clean')
  })
  assert.equal(styleLine(ass, 'Default').split(',')[3], '&H00FFFFFF')
})

test('karaoke: one Dialogue per word inside the group, spoken word in the accent', () => {
  const words = flow(8)
  const brand = brandWith({ preset: 'karaoke' }, { colors: { text: '#FFFFFF', accent: '#C8FF4D' } })
  const ass = assFor(words, brand)
  const groups = groupWords(words, 'karaoke')
  const d = dialogues(ass)
  assert.equal(d.length, words.length)
  let k = 0
  for (const g of groups) {
    g.forEach((w, i) => {
      const x = d[k++]
      assert.equal(x.start, w.s)
      assert.equal(x.end, i < g.length - 1 ? g[i + 1].s : w.e)
      assert.ok(x.start >= g[0].s && x.end <= g.at(-1).e, 'inside the group time')
      assert.match(x.text, /\\pos\(540,1382\)/)
      // exactly the spoken word is wrapped in the accent colour
      const accents = [...x.text.matchAll(/\{\\1c&H4DFFC8&\}([^{]*)\{/g)].map((m) => m[1])
      assert.deepEqual(accents, [w.w])
      for (const o of g.filter((y) => y !== w)) assert.ok(x.text.includes(o.w))
    })
  }
})

test('highlight: an accent box behind the spoken word (BorderStyle 3, \\3c)', () => {
  const words = flow(8)
  const brand = brandWith({ preset: 'highlight' }, { colors: { text: '#FFFFFF', accent: '#C8FF4D' } })
  const ass = assFor(words, brand)
  const box = styleLine(ass, 'Box')
  assert.ok(box, 'a second style')
  assert.equal(box.slice('Style: '.length).split(',')[15], '3', 'BorderStyle=3')
  const d = dialogues(ass)
  assert.equal(d.length, words.length)
  for (const x of d) {
    const m = [...x.text.matchAll(/\{\\rBox[^}]*\\3c&H4DFFC8&[^}]*\}([^{]*)\{\\r\}/g)]
    assert.equal(m.length, 1, x.text)
  }
  assert.equal(styleLine(ass, 'Default').split(',')[15], '1', 'other words keep an outline')
})

test('punch: 1-2 words, 1.25x bigger, uppercase', () => {
  const words = flow(6).map((x, i) => ({ ...x, w: ['ok', 'this', 'is', 'Wild', 'stuff', 'now'][i] }))
  const brand = brandWith({ preset: 'punch', size: 1 })
  const ass = assFor(words, brand)
  const d = dialogues(ass)
  assert.equal(d.length, groupWords(words, 'punch').length)
  assert.equal(Number(styleLine(ass, 'Punch').split(',')[2]), Math.round(0.045 * 1920 * 1.25))
  for (const x of d) {
    assert.equal(x.style, 'Punch')
    const shown = x.text.replace(/\{[^}]*\}/g, '')
    assert.equal(shown, shown.toUpperCase())
    assert.ok(shown.split(' ').length <= 2)
  }
})

test('hook: a top Dialogue for the first 3 s at y = 0.12 * 1920', () => {
  const words = flow(12)
  const ass = assFor(words, brandWith({ preset: 'clean' }), undefined, 'Wait for it')
  const h = dialogues(ass).filter((x) => x.style === 'Hook')
  assert.equal(h.length, 1)
  assert.equal(h[0].start, 0)
  assert.equal(h[0].end, 3)
  assert.match(h[0].text, new RegExp(`\\\\pos\\(540,${Math.round(0.12 * 1920)}\\)`))
  assert.match(h[0].text, /\\an8/)
  assert.ok(h[0].text.endsWith('Wait for it'))
  assert.ok(styleLine(ass, 'Hook'))
  // shorter than 3 s: ends with the clip
  const short = dialogues(assFor(flow(3), brandWith(), undefined, 'Hi')).find((x) => x.style === 'Hook')
  assert.equal(short.end, 1.1)
  // no hook, no Hook line; a blank hook is no hook
  assert.equal(dialogues(assFor(words, brandWith())).filter((x) => x.style === 'Hook').length, 0)
  assert.equal(dialogues(assFor(words, brandWith(), undefined, '  ')).filter((x) => x.style === 'Hook').length, 0)
  // hook text is escaped too
  const esc = dialogues(assFor(words, brandWith(), undefined, 'a{b}')).find((x) => x.style === 'Hook')
  assert.ok(esc.text.endsWith('a｛b｝'))
})

test('times are H:MM:SS.cc, never negative, never past the last word', () => {
  const words = [
    { w: 'one', s: 0, e: 0.5 },
    { w: 'two', s: 0.5, e: 1.15 },
    { w: 'three', s: 3661.5, e: 3662.07 },
  ]
  for (const preset of ['karaoke', 'punch', 'clean', 'highlight']) {
    const ass = assFor(words, brandWith({ preset }), undefined, 'Hook')
    for (const l of ass.split('\n').filter((x) => x.startsWith('Dialogue:'))) {
      assert.match(l, /^Dialogue: 0,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,/)
    }
    for (const x of dialogues(ass)) {
      assert.ok(x.start >= 0 && x.end > x.start, `${preset} ${x.start}-${x.end}`)
      assert.ok(x.end <= 3662.07 + 1e-9, `${preset} ends ${x.end}`)
    }
  }
  const c = dialogues(assFor(words, brandWith({ preset: 'clean' })))
  assert.equal(c[0].end, 1.15, 'float rounding does not shave a centisecond')
  assert.equal(c.at(-1).start, 3661.5)
})

test('hostile words render one clean line each', () => {
  const words = [
    { w: '{\\an1}x', s: 0, e: 0.3 },
    { w: 'a\nb', s: 0.3, e: 0.6 },
    { w: 'C:\\path}', s: 0.6, e: 0.9 },
  ]
  for (const preset of ['karaoke', 'punch', 'clean', 'highlight']) {
    const ass = assFor(words, brandWith({ preset }))
    const lines = ass.split('\n')
    assert.ok(!lines.some((l) => l === 'b' || l.startsWith('b')), 'a newline in a word did not break a line')
    for (const x of dialogues(ass)) {
      // after removing our own override blocks, nothing brace-like is left
      const shown = x.text.replace(/\{\\[^{}]*\}/g, '')
      assert.ok(!/[{}\\]/.test(shown), `${preset}: ${shown}`)
    }
  }
})

test('no words: just the header; unknown preset throws', () => {
  const ass = assFor([], brandWith())
  assert.ok(ass.includes('[Events]'))
  assert.equal(dialogues(ass).length, 0)
  assert.throws(() => assFor(flow(3), brandWith({ preset: 'bold' })))
})

// A tiny TrueType reader: family from the `name` table (ID 16, else 1) and the
// bold bit of `head.macStyle`.
function readFontNames(buf) {
  const nTables = buf.readUInt16BE(4)
  const tables = {}
  for (let i = 0; i < nTables; i++) {
    const o = 12 + i * 16
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8)
  }
  const nameOff = tables.name
  const count = buf.readUInt16BE(nameOff + 2)
  const strOff = nameOff + buf.readUInt16BE(nameOff + 4)
  const names = {}
  for (let i = 0; i < count; i++) {
    const o = nameOff + 6 + i * 12
    const platform = buf.readUInt16BE(o)
    const id = buf.readUInt16BE(o + 6)
    const len = buf.readUInt16BE(o + 8)
    const off = strOff + buf.readUInt16BE(o + 10)
    if (platform !== 3 && platform !== 0) continue
    const be = buf.subarray(off, off + len)
    names[id] = Buffer.from(be).swap16().toString('utf16le')
  }
  return {
    family: names[16] ?? names[1],
    bold: (buf.readUInt16BE(tables.head + 44) & 1) === 1,
  }
}
