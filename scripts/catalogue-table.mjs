#!/usr/bin/env node
// Writes the catalogue table into README.md between the two marker comments,
// from manifest.json, and the cut-bands table from catalogue.json, so the README
// can never disagree with either. The test suite regenerates both and diffs,
// which is the check.
//
//   node scripts/catalogue-table.mjs          rewrite README.md
//   node scripts/catalogue-table.mjs --print  print the table only
import { readFile, writeFile } from 'node:fs/promises';
import { manifest, format } from '../lib/catalogue.js';
import { builtOf, catalogue } from '../lib/bands.js';

export const START = '<!-- catalogue:start -->';
export const END = '<!-- catalogue:end -->';
export const BANDS_START = '<!-- cut-bands:start -->';
export const BANDS_END = '<!-- cut-bands:end -->';

const kb = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/** The import subpath's tail: the bare id resolves to GeoJSON; any other format carries its extension. */
const subpath = (entry) =>
  format(entry) === 'geojson' ? entry.id : `${entry.id}.${format(entry)}`;

/** The Markdown table, one row per id, in manifest order; a notice file has no layer, scale or geometry. */
export function catalogueTable(files = manifest.files) {
  const lines = [
    '| Import `coastlines/data/…` | Layer | Scale | Geometry | Raw | Why a boat wants it |',
    '| --- | --- | --- | --- | ---: | --- |',
  ];
  for (const entry of files) {
    const cells = [
      `\`${subpath(entry)}\``,
      entry.layer ?? '—',
      entry.scale ?? '—',
      entry.geometry ?? '—',
      kb(entry.bytes),
      entry.about,
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Who a record's upstream is, for the table: the cut bands draw on Natural Earth or GSHHG. */
const sourceOf = (p) =>
  `${/gshhg/.test(p.upstream[0]) ? 'GSHHG' : 'Natural Earth'} ${p.version}, ${p.licence}`;

/** The Markdown table of the cut bands, one row per record with a grid, as measured when built. */
export function cutBandsTable(records = catalogue) {
  const lines = [
    '| Band | Layer | Zoom | Cell | Cells | Size | Source |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
  ];
  for (const r of records.filter((r) => r.grid)) {
    const zoom = `${r.zoom.min}–${r.zoom.max ?? '∞'}`;
    const cell = `${r.grid.cellDeg}° (+${r.grid.marginDeg}°)`;
    const built = builtOf(r);
    lines.push(
      `| \`${r.id}\` | ${r.layer} | ${zoom} | ${cell} | ${built.cells.toLocaleString('en-US')} | ${mb(built.bytes)} | ${sourceOf(r.provenance)} |`,
    );
  }
  return lines.join('\n');
}

/** `readme` with the table replaced between the markers; throws if a marker is missing. */
export function splice(readme, table, [from, to] = [START, END]) {
  const start = readme.indexOf(from);
  const end = readme.indexOf(to);
  if (start < 0 || end < 0 || end < start) throw new Error('README.md lacks the catalogue markers');
  return readme.slice(0, start + from.length) + '\n' + table + '\n' + readme.slice(end);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  if (process.argv.includes('--print')) {
    process.stdout.write(catalogueTable() + '\n\n' + cutBandsTable() + '\n');
  } else {
    const path = new URL('../README.md', import.meta.url);
    const readme = splice(await readFile(path, 'utf8'), catalogueTable());
    await writeFile(path, splice(readme, cutBandsTable(), [BANDS_START, BANDS_END]));
  }
}
