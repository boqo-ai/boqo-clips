import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractArgs } from '../engine/boqo/extract.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(new URL('./fixtures/parity/extract-args.input.json', import.meta.url), 'utf8'));

test('extractArgs matches boqo on every case (a bad window is an error)', () => {
  expectGolden(
    'extract-args',
    input.cases.map((c) => {
      try {
        return extractArgs({ url: c.url, startSec: c.startSec, endSec: c.endSec, outPath: c.outPath });
      } catch (error) {
        return { error: error.message };
      }
    }),
  );
});

test('extractArgs seeks on the input and copies the streams', () => {
  const args = extractArgs({ url: 'in.mp4', startSec: 3, endSec: 9, outPath: 'out.mp4' });
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), '-ss before -i is input seeking');
  assert.deepEqual(args.slice(args.indexOf('-c')), ['-c', 'copy', 'out.mp4']);
});
