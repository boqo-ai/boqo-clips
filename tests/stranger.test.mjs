// The stranger judgment (A6). The ported modules are checked against boqo's own output
// (tests/golden/thin-indexes.json, stranger-transcript.json, parse-stranger.json); the rest tests the two tool
// commands, `frames` and `record`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectGolden } from './helpers/golden.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const input = (name) => JSON.parse(readFileSync(join(HERE, 'fixtures/parity', `${name}.input.json`), 'utf8'));

import { frameLabel, pyRound0, thinIndexes } from '../engine/boqo/stranger-frames.mjs';
import { STRANGER_SYSTEM, strangerContent, strangerTranscript } from '../engine/boqo/stranger-prompt.mjs';
import { AnnotationSchema, parseStranger } from '../engine/boqo/stranger.mjs';

test('thinIndexes and frameLabel match boqo for n = 0..999 with max 12, and pyRound0 for its ties', () => {
  const { ns, max, ties } = input('thin-indexes');
  expectGolden('thin-indexes', {
    cases: ns.map((n) => {
      const idx = thinIndexes(n, max);
      return { n, max, indexes: idx, labels: idx.map((_, i) => frameLabel(i, n, idx.length)) };
    }),
    rounds: ties.map((x) => ({ x, r: pyRound0(x) })),
  });
});

test('the system prompt, the transcript (6,000-char cap) and the user turn match boqo', () => {
  const { cases, contents } = input('stranger-transcript');
  expectGolden('stranger-transcript', {
    system: STRANGER_SYSTEM,
    transcripts: cases.map((c) => {
      const text = strangerTranscript(c);
      return { name: c.name, length: text.length, text };
    }),
    contents: contents.map((c) => ({
      name: c.name,
      content: strangerContent(c.frames.map((f) => ({ label: f.label, jpeg: Buffer.from(f.jpeg) })), c.durationSec, c.transcript),
    })),
  });
});

test('parseStranger and AnnotationSchema match boqo, valid and invalid', () => {
  const { cases, annotations } = input('parse-stranger');
  expectGolden('parse-stranger', {
    stranger: cases.map((c) => ({ name: c.name, parsed: parseStranger(c.raw) })),
    annotation: annotations.map((a) => {
      const r = AnnotationSchema.safeParse(a.raw);
      return { name: a.name, ok: r.success, data: r.success ? r.data : null, issues: r.success ? [] : r.error.issues.map((i) => ({ path: i.path, message: i.message })) };
    }),
  });
});
