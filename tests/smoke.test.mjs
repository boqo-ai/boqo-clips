import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolEnv } from '../engine/env.mjs';

// On macOS CI ffmpeg-full is installed but kept off PATH: toolEnv() must find it.
test('ffmpeg has the ass, subtitles and ebur128 filters', () => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', env: toolEnv() });
  assert.equal(r.error, undefined, 'ffmpeg must be on PATH (or macOS ffmpeg-full)');
  assert.equal(r.status, 0);
  for (const name of ['ass', 'subtitles', 'ebur128']) {
    assert.match(r.stdout, new RegExp(`\\s${name}\\s`), `missing filter: ${name}`);
  }
});

// The run, end to end on a synthetic video (no network): select-request, a fixture selection.json, select-check,
// clips order, sections (what `fetch.mjs sections` writes, cut from a lavfi source), render --first 2, clips order,
// clips summary. BOQO_HOME is a temp folder whose name holds a space, as a person's can.
const ffmpegHere = spawnSync('ffmpeg', ['-version'], { env: toolEnv() }).status === 0;
const TOOLS = fileURLToPath(new URL('../tools/', import.meta.url));
const SKILL_DIR = fileURLToPath(new URL('../skills/boqo-clips/', import.meta.url));

const wire = (start, end) => ({
  start_sec: start, end_sec: end, title: `Clip at ${start}`, hook: `Hook ${start}`, score: 80, hook_score: 78, flow_score: 76,
  standalone_score: 74, value_score: 72, emphasis_words: ['word'], stands_alone: true, claim: 'A claim.', bridge_from_sec: null,
  context_line: null, title_alternatives: [`First ${start}`, `Second ${start}`],
});

test('the run end to end: select-request, select-check, clips order, sections, render --first 2, order, summary', { skip: ffmpegHere ? false : 'ffmpeg is not on PATH', timeout: 600_000 }, () => {
  const home = mkdtempSync(join(tmpdir(), 'boqo smoke home '));
  try {
    const env = { ...process.env, BOQO_HOME: home };
    const tool = (name, args) => {
      const r = spawnSync(process.execPath, [join(TOOLS, `${name}.mjs`), ...args], { encoding: 'utf8', env });
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.length, 1, `${name} printed ${lines.length} lines: ${r.stdout}${r.stderr}`);
      return { status: r.status, out: JSON.parse(lines[0]) };
    };
    const ff = (args) => {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { encoding: 'utf8', env: toolEnv() });
      assert.equal(r.status, 0, r.stderr);
    };

    const run = join(home, 'boqo-clips', 'runs', '20261116-1200-smoke test');
    mkdirSync(run, { recursive: true });

    // A 120 s video's transcript: 5 s sentences, a word every 0.4 s.
    const segments = Array.from({ length: 24 }, (_, i) => ({ start: 5 * i, end: 5 * i + 5, text: `Line ${i} has some words in it.`, speaker: null }));
    const words = Array.from({ length: 300 }, (_, i) => ({ w: `word${i}`, s: Math.round(i * 40) / 100, e: Math.round((i * 40 + 30)) / 100 }));
    writeFileSync(join(run, 'segments.json'), JSON.stringify(segments));
    writeFileSync(join(run, 'words.json'), JSON.stringify(words));
    writeFileSync(join(run, 'info.json'), JSON.stringify({ id: 'smoke', title: 'A synthetic talk', duration: 120, language: 'en' }));

    // 1. the request
    const req = tool('select-request', ['--run', run]);
    assert.equal(req.status, 0, JSON.stringify(req.out));
    assert.equal(req.out.segments, 24);
    assert.ok(existsSync(join(run, 'select-request.md')));

    // 2. the agent's answer, from a fixture; 3. the check
    writeFileSync(join(run, 'selection.json'), JSON.stringify({ clips: [wire(10, 30), wire(60, 80)] }));
    const chk = tool('select-check', ['--run', run]);
    assert.equal(chk.status, 0, JSON.stringify(chk.out));
    assert.equal(chk.out.kept, 2);

    // 4. the pre-render order
    const ord = tool('clips', ['order', '--run', run]);
    assert.equal(ord.status, 0, JSON.stringify(ord.out));
    const rows = JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.rendered === false));

    // 5. sections, as fetch.mjs writes them: each file holds the padded seconds s..e, the clip starts `offset` in
    const source = join(home, 'source video.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=15:duration=85', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=85',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
    const entries = rows.map((r, pick) => {
      const s = r.start - 2;
      const e = r.end + 2;
      const file = join(run, `sec-${pick}.mp4`);
      ff(['-ss', String(s), '-i', source, '-t', String(e - s), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
      return { pick, file, offset: r.start - s, s, e };
    });
    writeFileSync(join(run, 'sections.json'), JSON.stringify({ files: entries }));

    // 6. render the first two. The CLI loads onnxruntime-node when it is installed and must end by returning.
    const rend = tool('render', ['--run', run, '--first', '2']);
    assert.equal(rend.status, 0, JSON.stringify(rend.out));
    assert.deepEqual(rend.out.failed, []);
    assert.equal(rend.out.rendered.length, 2);
    for (const name of ['clip-01.mp4', 'clip-02.mp4', 'clip-01.jpg', 'clip-02.jpg']) {
      assert.ok(statSync(join(run, 'out', name)).size > 1000, name);
    }
    const rec = JSON.parse(readFileSync(join(run, 'clips.json'), 'utf8')).clips;
    assert.deepEqual(rec.map((r) => r.rendered), [true, true]);
    assert.deepEqual(rec.map((r) => r.file), ['out/clip-01.mp4', 'out/clip-02.mp4']);
    assert.ok(!existsSync(join(run, 'render')) || readdirSync(join(run, 'render')).length === 0, 'a finished clip leaves no work folder');

    // 7. the final order and the chat summary
    assert.equal(tool('clips', ['order', '--run', run]).status, 0);
    const sum = spawnSync(process.execPath, [join(TOOLS, 'clips.mjs'), 'summary', '--run', run], { encoding: 'utf8', env });
    assert.equal(sum.status, 0, sum.stdout + sum.stderr);
    assert.equal(sum.stdout.trim().split('\n').length, 2, sum.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The commands the skill's docs give are the tools' own: every tool a command names exists, and every flag it
// passes is one that tool's source reads. (A flag that was renamed in a tool but not in the docs fails here.)
test('the commands in the skill docs name tools and flags that exist', () => {
  const docs = ['SKILL.md', 'onboarding.md', 'post.md', 'panels.md', 'stranger.md'].map((f) => readFileSync(join(SKILL_DIR, f), 'utf8'));
  let checked = 0;
  for (const text of docs) {
    const joined = text.replace(/\\\n\s*/g, ' ');
    for (const m of joined.matchAll(/node "\$HOME\/\.boqo-clips\/tools\/([a-z-]+)\.mjs"([^\n`]*)/g)) {
      const source = join(TOOLS, `${m[1]}.mjs`);
      assert.ok(existsSync(source), `no tool ${m[1]}`);
      const code = readFileSync(source, 'utf8');
      const lib = ['boqo-upload'].includes(m[1]) ? readFileSync(join(TOOLS, '..', 'engine', 'boqo-upload-lib.mjs'), 'utf8') : '';
      for (const flag of m[2].match(/--[a-z][a-z-]*/g) ?? []) {
        assert.ok(code.includes(`'${flag}'`) || code.includes(`"${flag}"`) || lib.includes(flag) || code.includes(`${flag} `), `${m[1]} does not read ${flag}: ${m[0].slice(0, 100)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 40, `only ${checked} flags checked`);
});

// A16b's review: get_transcript answering {not_found: true} is final; the run stops polling and falls back in one line.
test('SKILL.md stops polling get_transcript on not_found', () => {
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(skill, /\{not_found: true\}` is final, so stop polling/);
});
