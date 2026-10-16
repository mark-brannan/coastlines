// Builds the catalogue's `cells` sources: each cut band's inputs, read through `read`, cut into
// square lon/lat cells under geo/<dir>/ (<xi>_<yi>.json and index.json). A band is cut from one
// upstream only, so no geometry file mixes sources.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { band, builtOf, cellsOf, CUTTER, inputsOf, sourcesOf } from './bands.js';
import { find } from './catalogue.js';
import { shapefilePolygons } from './shapefile.js';
import { cutCells, cutLakes, cutWater, dbfRecords, gshhgLakes, joinWater } from './detail-cells.js';

/** The folder under geo/ of a band's `cells` source: `geo/f/` is `f`. */
export const cellsDir = (record) => cellsOf(record).url.replace(/^geo\/|\/$/g, '');

const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

function polygons(geojson) {
  const out = [];
  for (const { geometry } of geojson.features) {
    if (geometry?.type === 'Polygon') out.push(geometry.coordinates);
    else if (geometry?.type === 'MultiPolygon') for (const p of geometry.coordinates) out.push(p);
  }
  return out;
}

function lines(geojson) {
  const out = [];
  for (const { geometry } of geojson.features) {
    if (geometry?.type === 'LineString') out.push(geometry.coordinates);
    else if (geometry?.type === 'MultiLineString')
      for (const l of geometry.coordinates) out.push(l);
  }
  return out;
}

/**
 * The cells of a band: Map(key -> cell). `read(input)` returns the bytes of one input, as
 * `inputsOf(record)` lists them.
 */
export async function cutBand(record, read) {
  if (sourcesOf(record).size !== 1)
    throw new Error(`${record.id}: inputs from more than one source`);
  const size = record.grid.cellDeg;
  const bytes = await Promise.all(inputsOf(record).map(read));
  if (record.id === 'ne-10m-land') {
    const [land, coast, minor] = bytes.map(json);
    return cutCells(
      { land: polygons(land), coast: [...lines(coast), ...polygons(minor).map((p) => p[0])] },
      size,
    );
  }
  if (record.layer === 'land') {
    const land = shapefilePolygons(bytes[0]);
    return cutCells({ land, coast: land.flat() }, size);
  }
  if (record.layer === 'water') {
    const [rivers, lakes] = [bytes.slice(0, 3), bytes.slice(3)].map((half) =>
      joinWater(half.map(json)),
    );
    return cutWater(rivers, lakes, { size });
  }
  if (record.layer === 'lakes') {
    const [l2, d2, l3, d3] = bytes;
    return cutLakes(
      gshhgLakes(shapefilePolygons(l2), dbfRecords(d2), shapefilePolygons(l3), dbfRecords(d3)),
      size,
    );
  }
  throw new Error(`${record.id}: no cutter for layer ${record.layer}`);
}

/** Writes a band's cells to `root`/geo/<dir>/, complete or not at all; returns the cell count. */
export async function writeBand(record, cells, root) {
  const final = new URL(`geo/${cellsDir(record)}/`, root);
  const partial = new URL(`geo/${cellsDir(record)}.partial/`, root);
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  // in batches: "f" has some 70,000 cells, past an open-file limit if written at once
  const all = [...cells];
  for (let i = 0; i < all.length; i += 512)
    await Promise.all(
      all
        .slice(i, i + 512)
        .map(([k, c]) => writeFile(new URL(`${k}.json`, partial), JSON.stringify(c))),
    );
  await writeFile(
    new URL('index.json', partial),
    JSON.stringify({ cell: record.grid.cellDeg, cells: [...cells.keys()] }),
  );
  await rm(final, { recursive: true, force: true });
  await rename(partial, final);
  return cells.size;
}

/**
 * catalogue.json's text with one record's `built` set to `day`, every other byte as it
 * was. Throws rather than touch the wrong record: the id must be there, and the `built` must sit
 * in that record, before the next `"id":`.
 */
export function stampBuilt(text, id, day) {
  const at = text.indexOf(`"id": "${id}"`);
  if (at < 0) throw new Error(`${id}: not in catalogue.json`);
  const end = text.indexOf('"id": "', at + 1);
  const record = text.slice(at, end < 0 ? undefined : end);
  const stamped = record.replace(/("built": )"[^"]*"/, `$1"${day}"`);
  if (stamped === record && !record.includes(`"built": "${day}"`))
    throw new Error(`${id}: no built to stamp`);
  return text.slice(0, at) + stamped + (end < 0 ? '' : text.slice(end));
}

/** The cut bands whose inputs are GSHHG's, which the notice below covers. */
export const modifiedGshhg = (catalogue) =>
  catalogue.filter(
    (r) =>
      r.grid &&
      inputsOf(r).some((i) => (typeof i === 'string' ? find(i).source : i.source) === 'gshhg'),
  );

/** The text of geo/gshhg-modified.txt for the bands built, with the dates they were cut. */
export function modifiedNotice(records) {
  const rows = records
    .map((r) => `  geo/${cellsDir(r)}/   ${r.id}, cut ${builtOf(r).built}`)
    .join('\n');
  return `GSHHG, modified
===============

The cell files below are modified GSHHG ${band(records[0].id).provenance.version} (Wessel & Smith), not the
published shapefiles. They were made by ${CUTTER} from the pinned zip: polygons
clipped to square lon/lat cells, shorelines split where they pass from one cell to the next,
coordinates rounded to 5 decimals, and each land polygon annotated with the area and colour of the
island it is a piece of.

${rows}

Licence: GNU Lesser General Public License version 3 or later, conveyed under section 5(a) of the
GNU General Public License version 3, which asks for a notice that the work was modified and the
date of the modification: this file. The unmodified originals are fetched, byte for byte, by
\`npm run sync\`; their copyright and permission notice and the licence text are in
data/gshhg-licence.txt and data/gshhg-copying-lesser.txt and apply to the cells too.
`;
}
