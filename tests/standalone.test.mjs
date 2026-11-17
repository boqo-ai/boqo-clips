// deriveStandaloneTest against boqo's own output (tests/golden/derive-standalone.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAIM_MAX, CONTEXT_LINE_MAX, STANDALONE_OUTCOMES, StandaloneTestSchema, deriveStandaloneTest } from '../engine/boqo/standalone.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity/derive-standalone.input.json'), 'utf8'));

test('deriveStandaloneTest matches boqo on every case', () => {
  expectGolden(
    'derive-standalone',
    input.cases.map((c) => {
      const derived = deriveStandaloneTest(c.answer === null ? undefined : c.answer, c.segmentStarts, c.sha, c.startSec);
      return { name: c.name, ...derived, schemaOk: derived.test === null ? null : StandaloneTestSchema.safeParse(derived.test).success };
    }),
  );
});

test('the four outcomes are all reached, and the limits are boqo\'s', () => {
  assert.deepEqual([...STANDALONE_OUTCOMES], ['stands', 'bridged', 'context', 'fails']);
  assert.equal(CONTEXT_LINE_MAX, 60);
  assert.equal(CLAIM_MAX, 200);
  const reached = new Set(input.cases.map((c) => deriveStandaloneTest(c.answer === null ? undefined : c.answer, c.segmentStarts, c.sha, c.startSec).test?.outcome));
  for (const o of STANDALONE_OUTCOMES) assert.ok(reached.has(o), o);
});
