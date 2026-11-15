import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('ffmpeg has the ass, subtitles and ebur128 filters', () => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'ffmpeg must be on PATH');
  assert.equal(r.status, 0);
  for (const name of ['ass', 'subtitles', 'ebur128']) {
    assert.match(r.stdout, new RegExp(`\\s${name}\\s`), `missing filter: ${name}`);
  }
});
