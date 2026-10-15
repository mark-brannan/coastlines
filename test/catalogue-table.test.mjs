import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BANDS_END,
  BANDS_START,
  catalogueTable,
  cutBandsTable,
  splice,
  START,
  END,
} from '../scripts/catalogue-table.mjs';
import { manifest } from '../lib/catalogue.js';

test('the README carries the table the manifest generates', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(splice(readme, catalogueTable()), readme, 'run `npm run build:readme`');
});

test('one row per id, sizes humanised', () => {
  const table = catalogueTable();
  assert.equal(table.split('\n').length, manifest.files.length + 2);
  assert.match(table, /`ne-coastline-10m` \| coastline \| 10m \| lines \| 9\.6 MB/);
  assert.match(table, /`ne-coastline-110m` \| coastline \| 110m \| lines \| 137 KB/);
});

test('a non-GeoJSON entry shows its import suffix; a notice shows no layer', () => {
  const table = catalogueTable();
  assert.match(table, /`gshhg-land-h\.shp` \| land \| h \| polygons \| 32\.5 MB/);
  assert.match(table, /`gshhg-licence\.txt` \| — \| — \| — \| 1 KB/);
});

test('splice refuses a README without markers and replaces only between them', () => {
  assert.throws(() => splice('no markers', 'x'), /markers/);
  assert.equal(splice(`a\n${START}\nold\n${END}\nb`, 'new'), `a\n${START}\nnew\n${END}\nb`);
});

test('the README carries the cut-bands table catalogue.json generates', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(
    splice(readme, cutBandsTable(), [BANDS_START, BANDS_END]),
    readme,
    'run `npm run build:readme`',
  );
});

test('one row per cut band, with its cells, size and source', () => {
  const rows = cutBandsTable().split('\n');
  assert.equal(rows.length, 6 + 2);
  assert.match(
    cutBandsTable(),
    /`gshhg-f-land` \| land \| 12–∞ \| 0\.5° \(\+0\.25°\) \| 70,692 \| 383\.8 MB \| GSHHG 2\.3\.7, LGPL-3\.0-or-later/,
  );
});
