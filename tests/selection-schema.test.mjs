// The ported SelectionResponse schema against boqo's own safeParse and
// parseSelectionMessage (tests/golden/selection-response.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SelectionResponse, normaliseAlternatives } from '../engine/boqo/selection-schema.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity/selection-response.input.json'), 'utf8'));

// parseSelectionMessage's mapping from the wire's snake_case, the part after safeParse.
const candidates = (clips) =>
  clips.map((clip) => ({
    startSec: clip.start_sec,
    endSec: clip.end_sec,
    title: clip.title,
    hook: clip.hook,
    score: clip.score,
    hookScore: clip.hook_score,
    flowScore: clip.flow_score,
    standaloneScore: clip.standalone_score,
    valueScore: clip.value_score,
    emphasisWords: clip.emphasis_words,
    standalone: { standsAlone: clip.stands_alone, claim: clip.claim, bridgeFromSec: clip.bridge_from_sec, contextLine: clip.context_line },
    titleAlternatives: normaliseAlternatives(clip.title, clip.title_alternatives),
  }));

test('SelectionResponse and normaliseAlternatives match boqo on every response', () => {
  expectGolden(
    'selection-response',
    input.cases.map((c) => {
      const parsed = SelectionResponse.safeParse(c.raw);
      return {
        name: c.name,
        ok: parsed.success,
        issues: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
        candidates: parsed.success ? candidates(parsed.data.clips) : null,
      };
    }),
  );
});
