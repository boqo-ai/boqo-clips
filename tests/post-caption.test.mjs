// fallbackCopy against boqo's own output (tests/golden/post-caption.json), and the skill's captionFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_LIMITS, captionFor, clampCopy, fallbackCopy, tagsOf } from '../engine/boqo/post-caption.mjs';
import { expectGolden } from './helpers/golden.mjs';

const input = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parity/post-caption.input.json'), 'utf8'));
const PLATFORMS = ['tiktok', 'instagram', 'youtube'];
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('fallbackCopy matches boqo on every case and platform', () => {
  expectGolden(
    'post-caption',
    input.cases.map((c) => ({
      name: c.name,
      copy: Object.fromEntries(PLATFORMS.map((p) => [p, fallbackCopy(p, { title: c.title, hook: c.hook }, c.tags)])),
    })),
  );
});

test('the limits are the platforms', () => {
  assert.equal(PLATFORM_LIMITS.tiktok.text, 2200);
  assert.equal(PLATFORM_LIMITS.instagram.text, 2000);
  assert.equal(PLATFORM_LIMITS.youtube.text, 5000);
  assert.equal(PLATFORM_LIMITS.youtube.title, 100);
});

test('the rule: hook, title, tags, separated by a blank line', () => {
  assert.deepEqual(fallbackCopy('tiktok', { title: 'T', hook: 'H' }, ['a', 'b']), { text: 'H\n\nT\n\n#a #b' });
  assert.deepEqual(fallbackCopy('instagram', { title: ' T ', hook: null }, []), { text: 'T' });
  assert.deepEqual(fallbackCopy('youtube', { title: 'T', hook: 'H' }, ['a']), { title: 'T', text: 'H\n\n#a' });
});

test('captionFor leaves no half of an emoji at the cut', () => {
  const clip = { title: 'Edge', hook: 'a'.repeat(1999) + '😀' + 'tail' };
  const raw = fallbackCopy('instagram', clip, []);
  assert.equal(raw.text.length, 2000);
  assert.match(raw.text.at(-1), /[\ud800-\udbff]/); // hosted's cut keeps the high half
  const ours = captionFor('instagram', clip, []);
  assert.equal(ours.text.length, 1999);
  assert.doesNotMatch(ours.text, LONE_SURROGATE);
  assert.deepEqual(captionFor('tiktok', { title: 'T', hook: 'H' }, ['x']), fallbackCopy('tiktok', { title: 'T', hook: 'H' }, ['x']));
  const yt = captionFor('youtube', { title: '😀'.repeat(60), hook: null }, []);
  assert.doesNotMatch(yt.title, LONE_SURROGATE);
  assert.ok(yt.title.length <= 100);
});

test('clampCopy cuts as hosted does', () => {
  assert.equal(clampCopy('tiktok', { text: 'x'.repeat(3000) }).text.length, 2200);
  assert.equal(clampCopy('youtube', { title: 'y'.repeat(150), text: 'z' }).title.length, 100);
});

test('tagsOf turns a list of tags into names without a #', () => {
  assert.deepEqual(tagsOf('#clips, gaming ,, #fyp'), ['clips', 'gaming', 'fyp']);
  assert.deepEqual(tagsOf(''), []);
  assert.throws(() => tagsOf('two words'), /tag/);
});
