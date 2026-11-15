import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  brandsDir,
  defaultBrand,
  listBrands,
  loadBrand,
  saveBrand,
  setDefaultBrand,
  validateBrand,
} from '../engine/brand.mjs';

const CLI = fileURLToPath(new URL('../tools/brand.mjs', import.meta.url));

// a real 1x1 PNG and a JPEG header, generated in memory (no binary files in the repo)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'boqo-brand-'));
  process.env.BOQO_HOME = home;
  return home;
}
const mk = (over = {}) => ({ ...defaultBrand('mine'), ...over });

test('defaultBrand is boqo lime, Inter, karaoke, no logo', () => {
  assert.deepEqual(defaultBrand('x'), {
    name: 'x',
    colors: { text: '#FFFFFF', accent: '#C8FF4D' },
    font: 'Inter',
    captions: { preset: 'karaoke', position: 0.72, size: 1.0 },
    logo: { file: null, corner: 'tr', scale: 0.16 },
    hook: true,
  });
});

test('brandsDir follows BOQO_HOME', () => {
  const home = tempHome();
  assert.equal(brandsDir(), join(home, 'brands'));
});

test('validateBrand accepts the default and upper-cases hex', () => {
  const r = validateBrand(mk({ colors: { text: '#ffffff', accent: '#c8ff4d' } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.brand.colors, { text: '#FFFFFF', accent: '#C8FF4D' });
});

test('validateBrand collects every error', () => {
  const r = validateBrand({
    name: 'mine',
    colors: { text: 'white', accent: '#12345' },
    font: 'Comic Sans',
    captions: { preset: 'disco', position: 0.95, size: 1.5 },
    logo: { file: null, corner: 'middle', scale: 0.5 },
    hook: 'yes',
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 9);
  for (const word of ['colors.text', 'colors.accent', 'font', 'preset', 'position', 'size', 'corner', 'scale', 'hook']) {
    assert.ok(r.errors.some((e) => e.includes(word)), `no error about ${word}: ${r.errors.join(' | ')}`);
  }
});

test('validateBrand rejects each out-of-range value on its own', () => {
  const bad = [
    ['bad hex', mk({ colors: { text: '#GGGGGG', accent: '#C8FF4D' } })],
    ['position low', mk({ captions: { preset: 'karaoke', position: 0.05, size: 1 } })],
    ['position high', mk({ captions: { preset: 'karaoke', position: 0.91, size: 1 } })],
    ['size low', mk({ captions: { preset: 'karaoke', position: 0.7, size: 0.6 } })],
    ['size high', mk({ captions: { preset: 'karaoke', position: 0.7, size: 1.41 } })],
    ['preset', mk({ captions: { preset: 'bold', position: 0.7, size: 1 } })],
    ['corner', mk({ logo: { file: null, corner: 'top', scale: 0.16 } })],
    ['scale low', mk({ logo: { file: null, corner: 'tr', scale: 0.07 } })],
    ['scale high', mk({ logo: { file: null, corner: 'tr', scale: 0.31 } })],
    ['NaN', mk({ captions: { preset: 'karaoke', position: NaN, size: 1 } })],
  ];
  for (const [label, b] of bad) {
    const r = validateBrand(b);
    assert.equal(r.ok, false, label);
    assert.equal(r.errors.length, 1, `${label}: ${r.errors.join(' | ')}`);
  }
  for (const v of [0.1, 0.9]) assert.equal(validateBrand(mk({ captions: { preset: 'punch', position: v, size: 0.7 } })).ok, true);
});

test('validateBrand rejects non-objects and unsafe names', () => {
  for (const x of [null, 'brand', 4, [], undefined]) assert.equal(validateBrand(x).ok, false);
  for (const name of ['', '   ', '..', '../x', 'a/b', 'a\\b', 'x'.repeat(41), 'C:evil', 'a.b', 5, undefined]) {
    const r = validateBrand(mk({ name }));
    assert.equal(r.ok, false, `name ${JSON.stringify(name)}`);
    assert.ok(r.errors.some((e) => e.startsWith('name')));
  }
  const ok = validateBrand(mk({ name: '  My Brand_2-b  ' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.brand.name, 'My Brand_2-b');
});

test('validateBrand fills missing sections from the defaults', () => {
  const r = validateBrand({ name: 'tiny', colors: { accent: '#ff0000' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.brand, { ...defaultBrand('tiny'), colors: { text: '#FFFFFF', accent: '#FF0000' } });
});

test('save then load round-trips under BOQO_HOME', async () => {
  const home = tempHome();
  const b = mk({ colors: { text: '#101010', accent: '#FF5500' }, font: 'Anton', hook: false });
  const dir = await saveBrand(b);
  assert.equal(dir, join(home, 'brands', 'mine'));
  assert.ok(existsSync(join(dir, 'brand.json')));
  assert.deepEqual(await loadBrand('mine'), b);
  assert.deepEqual(await listBrands(), ['mine']);
});

test('save refuses an invalid brand with every error in the message', async () => {
  tempHome();
  await assert.rejects(
    saveBrand(mk({ colors: { text: 'x', accent: 'y' } })),
    (e) => /colors\.text/.test(e.message) && /colors\.accent/.test(e.message),
  );
  assert.deepEqual(await listBrands(), []);
});

test('default sets what loadBrand() returns', async () => {
  tempHome();
  await saveBrand(mk({ name: 'one' }));
  await saveBrand(mk({ name: 'two', font: 'Anton' }));
  assert.equal((await loadBrand()).name, 'one', 'the first saved kit becomes the default');
  await setDefaultBrand('two');
  assert.equal((await loadBrand()).name, 'two');
  assert.equal((await loadBrand()).font, 'Anton');
  assert.deepEqual(await listBrands(), ['one', 'two']);
});

test('a missing kit throws "no brand kit"', async () => {
  tempHome();
  await assert.rejects(loadBrand(), /no brand kit/);
  await assert.rejects(loadBrand('ghost'), /no brand kit/);
  await assert.rejects(setDefaultBrand('ghost'), /no brand kit/);
  await assert.rejects(loadBrand('../x'), /name/);
  assert.deepEqual(await listBrands(), []);
});

test('a logo path with a space is copied as logo.png and loads as an absolute path', async () => {
  tempHome();
  const src = join(mkdtempSync(join(tmpdir(), 'boqo-logo-')), 'my logo.png');
  writeFileSync(src, PNG);
  const dir = await saveBrand(mk(), src);
  assert.deepEqual(readdirSync(dir).sort(), ['brand.json', 'logo.png']);
  assert.deepEqual(readFileSync(join(dir, 'logo.png')), PNG);
  assert.equal(JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8')).logo.file, 'logo.png');
  const b = await loadBrand('mine');
  assert.ok(isAbsolute(b.logo.file));
  assert.equal(b.logo.file, join(dir, 'logo.png'));
});

test('.jpeg becomes logo.jpg and a new logo replaces the old one', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'a.PNG'), PNG);
  writeFileSync(join(d, 'b.jpeg'), JPG);
  const dir = await saveBrand(mk(), join(d, 'a.PNG'));
  assert.ok(existsSync(join(dir, 'logo.png')));
  await saveBrand(mk(), join(d, 'b.jpeg'));
  assert.deepEqual(readdirSync(dir).sort(), ['brand.json', 'logo.jpg']);
  assert.equal((await loadBrand('mine')).logo.file, join(dir, 'logo.jpg'));
});

test('re-saving a loaded brand keeps its logo; saving with no logo drops it', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'l.png'), PNG);
  const dir = await saveBrand(mk(), join(d, 'l.png'));
  const loaded = await loadBrand('mine');
  await saveBrand({ ...loaded, font: 'Anton' });
  const again = await loadBrand('mine');
  assert.equal(again.font, 'Anton');
  assert.equal(again.logo.file, join(dir, 'logo.png'));
  await saveBrand({ ...again, logo: { ...again.logo, file: null } });
  assert.deepEqual(readdirSync(dir), ['brand.json']);
});

test('a logo that is not PNG/JPG or does not exist is rejected', async () => {
  tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-logo-'));
  writeFileSync(join(d, 'l.svg'), '<svg/>');
  await assert.rejects(saveBrand(mk(), join(d, 'l.svg')), /PNG or JPG/);
  await assert.rejects(saveBrand(mk(), join(d, 'nope.png')), /logo/);
  assert.deepEqual(await listBrands(), [], 'a failed save leaves no kit behind');
});

// ---- CLI ----

function run(home, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, BOQO_HOME: home }, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `one stdout line, got: ${r.stdout}`);
  return { status: r.status, json: JSON.parse(lines[0]) };
}

test('CLI: save, list, show, default', () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const json = join(d, 'brand file.json');
  writeFileSync(join(d, 'my logo.png'), PNG);
  writeFileSync(json, JSON.stringify(mk({ name: 'alpha' })));

  let r = run(home, ['list']);
  assert.deepEqual(r, { status: 0, json: { brands: [], default: null } });

  r = run(home, ['save', json, '--logo', join(d, 'my logo.png')]);
  assert.equal(r.status, 0);
  assert.equal(r.json.saved, 'alpha');

  writeFileSync(json, JSON.stringify(mk({ name: 'beta', font: 'Anton' })));
  assert.equal(run(home, ['save', json]).status, 0);

  r = run(home, ['list']);
  assert.deepEqual(r.json, { brands: ['alpha', 'beta'], default: 'alpha' });

  r = run(home, ['show']);
  assert.equal(r.json.brand.name, 'alpha');
  assert.ok(isAbsolute(r.json.brand.logo.file));
  assert.equal(run(home, ['show', 'beta']).json.brand.font, 'Anton');

  assert.equal(run(home, ['default', 'beta']).status, 0);
  assert.equal(run(home, ['show']).json.brand.name, 'beta');
  assert.equal(run(home, ['list']).json.default, 'beta');
});

test('CLI: failures exit 1 with {"error"}', () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const bad = join(d, 'bad.json');
  writeFileSync(bad, JSON.stringify(mk({ captions: { preset: 'disco', position: 2, size: 1 } })));
  const notJson = join(d, 'nj.json');
  writeFileSync(notJson, '{oops');

  for (const args of [
    ['show'],
    ['show', 'ghost'],
    ['default', 'ghost'],
    ['save', bad],
    ['save', notJson],
    ['save', join(d, 'missing.json')],
    ['save'],
    ['default'],
    ['frobnicate'],
    [],
  ]) {
    const r = run(home, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(typeof r.json.error, 'string', args.join(' '));
  }
  const r = run(home, ['save', bad]);
  assert.match(r.json.error, /preset/);
  assert.match(r.json.error, /position/);
});

function serve(routes) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const route = routes[req.url];
      if (!route) {
        res.writeHead(404).end('no');
        return;
      }
      res.writeHead(route.status ?? 200, route.headers ?? {});
      res.end(route.body);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function runAsync(home, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, BOQO_HOME: home } }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, json: JSON.parse(stdout.trim()) });
    });
  });
}

test('CLI: --logo with a URL downloads it (and refuses a 404, a non-image and an oversize file)', async () => {
  const home = tempHome();
  const d = mkdtempSync(join(tmpdir(), 'boqo-cli-'));
  const json = join(d, 'b.json');
  writeFileSync(json, JSON.stringify(mk({ name: 'web' })));
  const { srv, base } = await serve({
    '/logo.png': { body: PNG, headers: { 'content-type': 'image/png' } },
    '/noext': { body: JPG },
    '/page': { body: '<html>not an image</html>', headers: { 'content-type': 'text/html' } },
    '/huge.png': { body: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) },
  });
  try {
    let r = await runAsync(home, ['save', json, '--logo', `${base}/logo.png`]);
    assert.equal(r.status, 0, JSON.stringify(r.json));
    assert.deepEqual(readFileSync(join(home, 'brands', 'web', 'logo.png')), PNG);

    r = await runAsync(home, ['save', json, '--logo', `${base}/noext`]);
    assert.equal(r.status, 0, JSON.stringify(r.json));
    assert.deepEqual(readdirSync(join(home, 'brands', 'web')).sort(), ['brand.json', 'logo.jpg']);

    r = await runAsync(home, ['save', json, '--logo', `${base}/missing.png`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /404/);

    r = await runAsync(home, ['save', json, '--logo', `${base}/page`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /PNG or JPG/);

    r = await runAsync(home, ['save', json, '--logo', `${base}/huge.png`]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /10 MB/);
  } finally {
    srv.close();
  }
  // the failed saves left the kit as the last good save wrote it
  assert.deepEqual(readdirSync(join(home, 'brands', 'web')).sort(), ['brand.json', 'logo.jpg']);
});
