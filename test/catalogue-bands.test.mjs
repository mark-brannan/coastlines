import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import catalogue, {
  band,
  catalogue as same,
  builtOf,
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
  assert.equal(band('ne-50m-land').grid, null, 'a whole file has no grid');
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
  assert.match(driftWith('ne-50m-land', 'provenance', zero), /ne-50m-land: sha256 differs/);
  const unnamed = (r) => (r.provenance.member[0] = null);
  assert.match(driftWith('gshhg-f-land', 'provenance', unnamed), /gshhg-f-land: member differs/);
  const undated = (r) => (r.provenance.date = null);
  assert.match(driftWith('gshhg-f-land', 'provenance', undated), /gshhg-f-land: date null/);
  assert.match(
    driftWith('ne-50m-land', 'bytes', (r) => (r.bytes += 1)),
    /ne-50m-land: bytes/,
  );
  const later = (r) => (r.zoom.min += 1);
  assert.match(
    driftWith('ne-110m-glaciated-areas', 'zoom', later),
    /ne-110m-glaciated-areas: zoom 3-4/,
  );
});

test('sources say where the geometry is fetched from, one kind and url each', () => {
  for (const r of catalogue) {
    assert.ok(r.sources.length > 0, r.id);
    for (const s of r.sources) assert.deepEqual(Object.keys(s).slice(0, 2), ['kind', 'url'], r.id);
  }
  assert.deepEqual(band('gshhg-f-land').sources, [{ kind: 'cells', url: 'geo/f/' }]);
});

test('a cut band draws on inputs, and carries the cells and bytes of its build', () => {
  for (const r of catalogue.filter((r) => r.grid)) {
    assert.ok(inputsOf(r).length > 0, r.id);
    const { cells, bytes } = builtOf(r);
    assert.ok(cells > 0 && bytes > 0, `${r.id}: measured`);
    assert.equal(r.bytesPerCell, Math.round(bytes / cells), `${r.id}: bytesPerCell`);
  }
});

test('catalogue.json ships and is exported', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./catalogue'], './lib/bands.js');
  assert.ok(pkg.files.includes('catalogue.json'));
});

test('a cut band names its cutter and build date, and draws on one upstream', () => {
  for (const r of catalogue.filter((r) => r.grid)) {
    assert.equal(builtOf(r).cutter, CUTTER, r.id);
    assert.match(builtOf(r).built, /^\d{4}-\d{2}-\d{2}$/, r.id);
  }
  for (const r of catalogue.filter((r) => !r.grid)) assert.equal(r.provenance.cutter, undefined);
  assert.match(
    driftWith('ne-10m-land', 'sources', (r) => (r.sources[1].cutter = 'portolani')),
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

// Every id a record went by before `<source>-<scale>-<layer>`, and the id it has now.
const RENAMED = [
  ['ne-coastline-110m', 'ne-110m-coastline'],
  ['ne-land-110m', 'ne-110m-land'],
  ['ne-ocean-110m', 'ne-110m-ocean'],
  ['ne-geographic-lines-110m', 'ne-110m-geographic-lines'],
  ['ne-admin-0-boundary-lines-land-110m', 'ne-110m-admin-0-boundary-lines-land'],
  ['ne-admin-0-countries-110m', 'ne-110m-admin-0-countries'],
  ['ne-populated-places-110m', 'ne-110m-populated-places'],
  ['ne-lakes-110m', 'ne-110m-lakes'],
  ['ne-rivers-lake-centerlines-110m', 'ne-110m-rivers-lake-centerlines'],
  ['ne-glaciated-areas-110m', 'ne-110m-glaciated-areas'],
  ['ne-coastline-50m', 'ne-50m-coastline'],
  ['ne-land-50m', 'ne-50m-land'],
  ['ne-ocean-50m', 'ne-50m-ocean'],
  ['ne-geographic-lines-50m', 'ne-50m-geographic-lines'],
  ['ne-admin-0-boundary-lines-land-50m', 'ne-50m-admin-0-boundary-lines-land'],
  [
    'ne-admin-0-boundary-lines-maritime-indicator-50m',
    'ne-50m-admin-0-boundary-lines-maritime-indicator',
  ],
  ['ne-admin-0-countries-50m', 'ne-50m-admin-0-countries'],
  ['ne-populated-places-50m', 'ne-50m-populated-places'],
  ['ne-urban-areas-50m', 'ne-50m-urban-areas'],
  ['ne-lakes-50m', 'ne-50m-lakes'],
  ['ne-rivers-lake-centerlines-50m', 'ne-50m-rivers-lake-centerlines'],
  ['ne-glaciated-areas-50m', 'ne-50m-glaciated-areas'],
  ['ne-antarctic-ice-shelves-polys-50m', 'ne-50m-antarctic-ice-shelves-polys'],
  ['ne-coastline-10m', 'ne-10m-coastline'],
  ['ne-land-10m', 'ne-10m-land'],
  ['ne-minor-islands-10m', 'ne-10m-minor-islands'],
  ['ne-reefs-10m', 'ne-10m-reefs'],
  ['ne-geographic-lines-10m', 'ne-10m-geographic-lines'],
  ['ne-time-zones-10m', 'ne-10m-time-zones'],
  ['ne-admin-0-boundary-lines-land-10m', 'ne-10m-admin-0-boundary-lines-land'],
  [
    'ne-admin-0-boundary-lines-maritime-indicator-10m',
    'ne-10m-admin-0-boundary-lines-maritime-indicator',
  ],
  ['ne-admin-0-disputed-areas-10m', 'ne-10m-admin-0-disputed-areas'],
  ['ne-ports-10m', 'ne-10m-ports'],
  ['ne-antarctic-ice-shelves-polys-10m', 'ne-10m-antarctic-ice-shelves-polys'],
  ['gshhg-land-h', 'gshhg-h-land'],
];

test('every id a band once had still finds it, as an alias of its new id', () => {
  assert.equal(RENAMED.length, 35);
  for (const [old, now] of RENAMED) {
    assert.equal(band(old), band(now), `${old} finds ${now}`);
    assert.equal(band(now)?.id, now, `${now} is a record`);
    assert.ok(band(now).aliases.includes(old), `${now} lists ${old} as an alias`);
    assert.equal(band(old).id === old, false, `${old} is no longer an id`);
  }
});

test('ids follow <source>-<scale>-<layer>, and no id or alias is taken twice', () => {
  const names = catalogue.flatMap((r) => [r.id, ...(r.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
  for (const r of catalogue) {
    const [source, scale, ...layer] = r.id.split('-');
    assert.ok(['ne', 'gshhg'].includes(source), r.id);
    assert.ok(['10m', '50m', '110m', 'h', 'f'].includes(scale), r.id);
    assert.equal(layer.join('_'), r.layer, r.id);
  }
});

test('one record per data set: the 10m land file and its cells share ne-10m-land', () => {
  const r = band('ne-land-10m');
  assert.equal(r.id, 'ne-10m-land');
  assert.deepEqual(
    r.sources.map((s) => s.kind),
    ['file', 'cells'],
  );
  assert.deepEqual(r.inputs, ['ne-land-10m'], 'the file is owned by the manifest id');
  assert.equal(r.bytes, manifest.files.find((f) => f.id === 'ne-land-10m').bytes);
  assert.equal(r.provenance.cutter, undefined, "the cutter is the cells source's");
  assert.ok(builtOf(r).cells > 0);
});
