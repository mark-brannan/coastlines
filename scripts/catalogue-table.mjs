#!/usr/bin/env node
// Writes the catalogue table into README.md between the two marker comments,
// from manifest.json, so the README can never disagree with the manifest. The
// test suite regenerates it and diffs, which is the check.
//
//   node scripts/catalogue-table.mjs          rewrite README.md
//   node scripts/catalogue-table.mjs --print  print the table only
import { readFile, writeFile } from 'node:fs/promises';
import { manifest } from '../lib/catalogue.js';

export const START = '<!-- catalogue:start -->';
export const END = '<!-- catalogue:end -->';

const kb = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/** The Markdown table, one row per id, grouped by scale in manifest order. */
export function catalogueTable(files = manifest.files) {
  const lines = [
    '| Import `coastlines/data/…` | Layer | Scale | Geometry | Raw | Why a boat wants it |',
    '| --- | --- | --- | --- | ---: | --- |',
  ];
  for (const entry of files) {
    lines.push(
      `| \`${entry.id}\` | ${entry.layer} | ${entry.scale} | ${entry.geometry} | ${kb(entry.bytes)} | ${entry.about} |`,
    );
  }
  return lines.join('\n');
}

/** `readme` with the table replaced between the markers; throws if a marker is missing. */
export function splice(readme, table) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0 || end < start) throw new Error('README.md lacks the catalogue markers');
  return readme.slice(0, start + START.length) + '\n' + table + '\n' + readme.slice(end);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  if (process.argv.includes('--print')) {
    process.stdout.write(catalogueTable() + '\n');
  } else {
    const path = new URL('../README.md', import.meta.url);
    await writeFile(path, splice(await readFile(path, 'utf8'), catalogueTable()));
  }
}
