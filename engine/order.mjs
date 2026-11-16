// The order of a run's clips and the chat summary (§6 step 6, §7.4). Hosted's "Ranked" order (engine/boqo/rank.mjs)
// is applied to the rows of <run>/clips.json:
//   - the pre-render order is Ranked with the judgment held at its neutral value 3: outcome `fails` last, then
//     pct + 0.5, then score, then start. The first 10 in it are rendered;
//   - the final order is Ranked over the rendered clips with their stranger judgments, then the unrendered ones in the
//     pre-render order.
// `n` is a clip's place in that order and `clip-<nn>.mp4` is named by it, so `reorderRun` renumbers the record and
// renames the files (and a thumbnail next to one) to match, going through temporary names so a swap loses nothing.
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { rankClips } from './boqo/rank.mjs';
import { scoreBand, scoreToGrade } from './boqo/score-grade.mjs';
import { handbookChips } from './boqo/handbook-outcomes.mjs';

/** How many clips a run renders by default (P2). */
export const RENDER_FIRST = 10;

/** The judgment the pre-render order holds every clip at, so the term does not move it. */
export const NEUTRAL_JUDGMENT = 3;

/** Frames a stranger judgment reads (§7.4); only the stand-alone chip's reason line quotes it, and chat does not show that. */
const JUDGMENT_FRAMES = 12;

// A ClipRow's replay is {pct, mean}; hosted's rank reads the whole Replay blob through parseReplay.
const replayBlob = (replay) =>
  replay && typeof replay === 'object'
    ? { v: 1, pct: replay.pct, pctRaw: null, heat: replay.mean ?? null, discounted: true, bins: 0, factor: 1, introBins: 0, chapterBins: 0, sha: null }
    : null;

// A ClipRow's judgment is {overall, why, annotation} or null; hosted's rank reads a Stranger.
const strangerBlob = (judgment) =>
  judgment && typeof judgment === 'object' ? { judgment: judgment.overall, why: judgment.why ?? '', frames: JUDGMENT_FRAMES } : null;

const rankInput = (row, judgment) => ({
  score: row.score,
  startSec: row.start,
  replay: replayBlob(row.replay),
  stranger: strangerBlob(judgment),
  standaloneTest: row.standalone ?? null,
  row,
});

const rankRows = (rows, judgmentOf) => rankClips(rows.map((row) => rankInput(row, judgmentOf(row)))).map((x) => x.row);

/** Ranked with `judgment = 3` for every clip. Returns a new array of the same rows. */
export function preRenderOrder(clips) {
  return rankRows(clips, () => ({ overall: NEUTRAL_JUDGMENT }));
}

/** Ranked over the rendered clips with their judgments, then the unrendered ones in pre-render order. */
export function finalOrder(clips) {
  const rendered = clips.filter((c) => c.rendered === true);
  const rest = clips.filter((c) => c.rendered !== true);
  return [...rankRows(rendered, (c) => c.judgment ?? null), ...preRenderOrder(rest)];
}

/** The clip numbers rendered by default: the first `n` in the pre-render order. */
export function renderSet(clips, n = RENDER_FIRST) {
  return preRenderOrder(clips).slice(0, n).map((c) => c.n);
}

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// A B C D for hook, flow, standalone and value: the axes in the order the record keeps them.
const lettersOf = (axes) => ['hook', 'flow', 'standalone', 'value'].map((k) => scoreToGrade(axes?.[k] ?? 0)).join(' ');

/**
 * One line a rendered clip, in the final order, then `+N not rendered` when some are not:
 *   `1 · 87 exceptional · A B C D · Replayed · top 3% · Keeps watching · 4/5 · Needs context · <title> · 0:42`
 * `Replayed` appears only when the video has a heatmap (the row's replay is not null), `Keeps watching` only when a
 * judgment is stored, and the stand-alone chip (`Opens on context` / `Needs context`) only when hosted shows one. Every
 * chip is hosted's own `handbookChips` text. The clip's place in the order is the rank.
 */
export function summaryLines(record) {
  const order = finalOrder(record.clips);
  const lines = [];
  let unrendered = 0;
  order.forEach((c, i) => {
    if (c.rendered !== true) {
      unrendered++;
      return;
    }
    const chips = handbookChips({ startSec: c.start, replay: replayBlob(c.replay), stranger: strangerBlob(c.judgment), standaloneTest: c.standalone ?? null });
    lines.push(
      [`${i + 1}`, `${c.score} ${scoreBand(c.score)}`, lettersOf(c.axes), ...chips.map((x) => x.text), c.title, clock(c.end - c.start)].join(' · '),
    );
  });
  if (unrendered > 0) lines.push(`+${unrendered} not rendered`);
  return lines;
}

const THUMB_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const nn = (n) => String(n).padStart(2, '0');

// The files of one rendered row: the video, and the thumbnail named by row.thumb or, failing that, one beside the video
// with the same stem. Each is {from, ext, field} with absolute paths.
function filesOf(run, row) {
  if (typeof row.file !== 'string' || row.file === '') return [];
  const abs = (p) => (isAbsolute(p) ? p : resolve(run, p));
  const video = abs(row.file);
  const out = [{ from: video, field: 'file', stored: row.file }];
  if (typeof row.thumb === 'string' && row.thumb !== '') {
    out.push({ from: abs(row.thumb), field: 'thumb', stored: row.thumb });
  } else {
    const stem = join(dirname(video), basename(video, extname(video)));
    for (const ext of THUMB_EXTS) if (existsSync(stem + ext)) out.push({ from: stem + ext, field: null, stored: null });
  }
  return out;
}

// A file that is mid-move waits as `<its dir>/.order-tmp.<its own name>`, so a crash leaves it findable by name. The journal
// (`<run>/.order-tmp.journal.json`) lists every move and the phase (1: out of the way, 2: into place), so the next run can
// put everything back exactly, even when a file already sits where another one used to be.
const TMP = '.order-tmp.';
const JOURNAL = `${TMP}journal.json`;

function undoJournal(run, rename) {
  const file = join(run, JOURNAL);
  let journal;
  try {
    journal = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new Error(`cannot read ${JOURNAL}: ${err.code ?? err.message}`);
  }
  const moves = Array.isArray(journal?.moves) ? journal.moves : [];
  // Phase 2 began with every file waiting in its temp name, so a missing temp file means that move was done: back to the temp name.
  if (journal.phase === 2) for (const m of moves) if (!existsSync(m.tmp) && existsSync(m.to)) rename(m.to, m.tmp);
  for (const m of moves) if (existsSync(m.tmp)) rename(m.tmp, m.from);
  rmSync(file, { force: true });
}

// Temp files with no journal (it was lost): back to the name they carry, unless a different file has taken it.
function restoreByName(dirs, rename) {
  const errors = [];
  for (const dir of dirs) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(TMP) || name === JOURNAL) continue;
      const original = join(dir, name.slice(TMP.length));
      if (existsSync(original)) errors.push(`${name.slice(TMP.length)} is already there; ${name} is left from an interrupted order and is the file that was moved away from that name`);
      else rename(join(dir, name), original);
    }
  }
  return errors;
}

/**
 * Put `<run>/clips.json` in the final order: `n` becomes the place in it (the array follows), and every rendered clip's
 * file (and thumbnail) is renamed to `clip-<nn><ext>` for its new `n`. Two clips that swap are moved through temporary
 * names. Nothing is touched if a file is missing or a target would overwrite a file that is not moving. A run that was
 * interrupted mid-rename is put back first (see the journal above), so every file is under its own name before planning.
 * `rename` is injectable for tests.
 * @returns {{ ok: false, errors: string[] } | { ok: true, clips: number, rendered: number, renamed: number }}
 */
export function reorderRun(run, { rename = renameSync } = {}) {
  const file = join(run, 'clips.json');
  let record;
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`cannot read clips.json: ${err.code ?? err.message}`] };
  }
  if (!record || !Array.isArray(record.clips)) return { ok: false, errors: ['clips.json has no clips array'] };

  undoJournal(run, rename);
  const dirs = new Set([run]);
  for (const row of record.clips) for (const f of filesOf(run, row)) dirs.add(dirname(f.from));
  const leftover = restoreByName(dirs, rename);
  if (leftover.length > 0) return { ok: false, errors: leftover };

  const ordered = finalOrder(record.clips);
  const moves = [];
  const errors = [];
  ordered.forEach((row, i) => {
    const n = i + 1;
    if (row.rendered !== true) return;
    for (const f of filesOf(run, row)) {
      if (!existsSync(f.from)) {
        if (f.field === 'file') errors.push(`clip ${row.n}: ${row.file} is not there`);
        continue;
      }
      const name = `clip-${nn(n)}${extname(f.from)}`;
      const to = join(dirname(f.from), name);
      if (to !== f.from) moves.push({ ...f, to, row, name, tmp: join(dirname(f.from), `${TMP}${basename(f.from)}`) });
    }
  });
  const moving = new Set(moves.map((m) => m.from));
  for (const m of moves) if (existsSync(m.to) && !moving.has(m.to)) errors.push(`${basename(m.to)} is already there and is not one of the clips`);
  if (errors.length > 0) return { ok: false, errors };

  // Out of the way first, then into place: a swap never loses a file.
  const journal = (phase) => writeFileSync(join(run, JOURNAL), JSON.stringify({ phase, moves: moves.map((m) => ({ from: m.from, tmp: m.tmp, to: m.to })) }));
  if (moves.length > 0) journal(1);
  for (const m of moves) rename(m.from, m.tmp);
  if (moves.length > 0) journal(2);
  for (const m of moves) {
    rename(m.tmp, m.to);
    // the stored path keeps its own folder and separators; only the file name changes
    if (m.field !== null) m.row[m.field] = m.stored.slice(0, m.stored.length - basename(m.stored).length) + m.name;
  }

  ordered.forEach((row, i) => {
    row.n = i + 1;
  });
  record.clips = ordered;
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  rmSync(join(run, JOURNAL), { force: true });
  return { ok: true, clips: ordered.length, rendered: ordered.filter((c) => c.rendered === true).length, renamed: moves.length };
}
