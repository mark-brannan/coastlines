import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import catalogue, { band, catalogue as same, drift, sourcesOf } from '../lib/bands.js';
import { manifest } from '../lib/catalogue.js';

const require = createRequire(import.meta.url);

test('coastlines/catalogue exports the records, one per id', () => {
  assert.equal(catalogue, same);
  assert.equal(new Set(catalogue.map((r) => r.id)).size, catalogue.length);
  for (const id of [
    'ne-10m-land',
    'gshhg-h-land',
    'gshhg-f-land',
    'ne-10m-water',
    'gshhg-h-lakes',
    'gshhg-f-lakes',
  ])
    assert.ok(band(id)?.grid?.cellDeg > 0, `${id} is a cut band with a grid`);
  assert.equal(band('ne-land-50m').grid, null, 'a whole file has no grid');
});

test('every manifest file appears in exactly one record', () => {
  const count = new Map(manifest.files.map((f) => [f.id, 0]));
  for (const r of catalogue)
    for (const s of r.sources) if (typeof s === 'string') count.set(s, count.get(s) + 1);
  for (const [id, n] of count) assert.equal(n, 1, `${id} is in ${n} records`);
});

test('the catalogue agrees with the manifest: upstream, sha256, licence, version', () => {
  assert.deepEqual(drift(), []);
});

test('drift notices a changed pin', () => {
  const record = band('ne-land-50m');
  const was = record.provenance.sha256[0];
  record.provenance.sha256[0] = 'sha256:0';
  try {
    assert.match(drift().join('\n'), /ne-land-50m: sha256 differs/);
  } finally {
    record.provenance.sha256[0] = was;
  }
});

test('a cut band draws from sources, and is measured later', () => {
  for (const r of catalogue.filter((r) => r.grid)) {
    assert.ok(sourcesOf(r).length > 0, r.id);
    assert.equal(r.bytesPerCell, null, 'null until measured');
  }
});

test('catalogue.json ships and is exported', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./catalogue'], './lib/bands.js');
  assert.ok(pkg.files.includes('catalogue.json'));
});
