import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import catalogue, {
  band,
  catalogue as same,
  CUTTER,
  drift,
  inputsOf,
  sourcesOf,
} from '../lib/bands.js';
import { cutBand, modifiedGshhg, stampBuilt } from '../lib/cut.js';
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
    for (const s of r.inputs) if (typeof s === 'string') count.set(s, count.get(s) + 1);
  for (const [id, n] of count) assert.equal(n, 1, `${id} is in ${n} records`);
});

test('the catalogue agrees with the manifest and charts.json', () => {
  assert.deepEqual(drift(), []);
});

/** Drift after `change` is made to a record, the change undone afterwards. */
function driftWith(id, field, change) {
  const record = band(id);
  const was = structuredClone(record[field]);
  change(record);
  try {
    return drift().join('\n');
  } finally {
    record[field] = was;
  }
}

test('drift notices a changed pin, member, date, bytes or zoom', () => {
  const zero = (r) => (r.provenance.sha256[0] = 'sha256:0');
  assert.match(driftWith('ne-land-50m', 'provenance', zero), /ne-land-50m: sha256 differs/);
  const unnamed = (r) => (r.provenance.member[0] = null);
  assert.match(driftWith('gshhg-f-land', 'provenance', unnamed), /gshhg-f-land: member differs/);
  const undated = (r) => (r.provenance.date = null);
  assert.match(driftWith('gshhg-f-land', 'provenance', undated), /gshhg-f-land: date null/);
  assert.match(
    driftWith('ne-land-50m', 'bytes', (r) => (r.bytes += 1)),
    /ne-land-50m: bytes/,
  );
  const later = (r) => (r.zoom.min += 1);
  assert.match(driftWith('ne-glaciated-areas-110m', 'zoom', later), /110m: zoom 3-4/);
});

test('sources say where the geometry is fetched from, one kind and url each', () => {
  for (const r of catalogue) {
    assert.ok(r.sources.length > 0, r.id);
    for (const s of r.sources) assert.deepEqual(Object.keys(s), ['kind', 'url'], r.id);
  }
  assert.deepEqual(band('gshhg-f-land').sources, [{ kind: 'cells', url: 'geo/f/' }]);
});

test('a cut band draws on inputs, and is measured later', () => {
  for (const r of catalogue.filter((r) => r.grid)) {
    assert.ok(inputsOf(r).length > 0, r.id);
    assert.equal(r.bytesPerCell, null, 'null until measured');
  }
});

test('catalogue.json ships and is exported', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./catalogue'], './lib/bands.js');
  assert.ok(pkg.files.includes('catalogue.json'));
});

test('a cut band names its cutter and build date, and draws on one upstream', () => {
  for (const r of catalogue.filter((r) => r.grid)) {
    assert.equal(r.provenance.cutter, CUTTER, r.id);
    assert.match(r.provenance.built, /^\d{4}-\d{2}-\d{2}$/, r.id);
  }
  for (const r of catalogue.filter((r) => !r.grid)) assert.equal(r.provenance.cutter, undefined);
  assert.match(
    driftWith('ne-10m-land', 'provenance', (r) => (r.provenance.cutter = 'portolani')),
    /ne-10m-land: cutter portolani/,
  );
  assert.deepEqual(
    modifiedGshhg(catalogue).map((r) => r.id),
    ['gshhg-h-land', 'gshhg-f-land', 'gshhg-h-lakes', 'gshhg-f-lakes'],
  );
});

test('stampBuilt rewrites one record and refuses the wrong one', () => {
  const text = `[
  {
    "id": "a",
    "provenance": { "built": "2026-01-01" }
  },
  {
    "id": "b",
    "provenance": { "built": "2026-01-01" }
  },
  {
    "id": "c",
    "provenance": {}
  }
]`;
  const out = stampBuilt(text, 'b', '2026-10-15');
  assert.equal(out.replace('2026-10-15', '2026-01-01'), text, 'nothing but b changes');
  assert.match(out, /"id": "a",\n\s+"provenance": \{ "built": "2026-01-01" \}/);
  assert.match(out, /"id": "b",\n\s+"provenance": \{ "built": "2026-10-15" \}/);
  assert.throws(() => stampBuilt(text, 'z', '2026-10-15'), /z: not in catalogue.json/);
  assert.throws(() => stampBuilt(text, 'c', '2026-10-15'), /c: no provenance.built/);
  assert.equal(stampBuilt(text, 'a', '2026-01-01'), text, 'a stamp already there is a no-op');
});

test('no geometry file is built from more than one source', async () => {
  for (const r of catalogue) assert.equal(sourcesOf(r).size, 1, `${r.id} names one source`);
  for (const f of manifest.files)
    assert.ok(manifest.sources[f.source], `${f.id} names a known source`);
  const mixed = {
    ...band('gshhg-h-land'),
    inputs: [...band('gshhg-h-land').inputs, 'ne-land-10m'],
  };
  assert.deepEqual([...sourcesOf(mixed)].sort(), ['gshhg', 'ne']);
  await assert.rejects(
    cutBand(mixed, async () => new Uint8Array()),
    /more than one source/,
  );
  assert.match(
    driftWith('gshhg-h-land', 'inputs', (r) => r.inputs.push('ne-land-10m')),
    /gshhg-h-land: built from 2 sources/,
  );
});
