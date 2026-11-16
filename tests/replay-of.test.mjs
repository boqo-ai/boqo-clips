// replayOf, as the record uses it, against boqo's own output (tests/golden/replay-of.json).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPLAY_TUNABLES, discountHeatmap, replayOf } from '../engine/boqo/replay.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity/replay-of.input.json'), 'utf8'));

test('replayOf matches boqo on every window', () => {
  expectGolden(
    'replay-of',
    input.cases.map((c) => {
      const t = c.tunables ?? DEFAULT_REPLAY_TUNABLES;
      const curve = discountHeatmap(c.heatmap, c.chapterStartsSec, t);
      return { name: c.name, replays: c.windows.map((w) => replayOf(curve, w, t, c.sha)) };
    }),
  );
});
