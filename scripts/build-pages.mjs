#!/usr/bin/env node
// Assembles the GitHub Pages site into _site/: the demo page, the three
// charts' styles, and the data files those charts draw, copied from data/.
// The page is MapLibre over plain GeoJSON sources -- no tile server -- so what
// Pages shows is exactly the styles the plugin will serve, over exactly the
// files it will cut. Needs data/ (`npm run sync`).
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { charts } from '../lib/charts.js';
import { find, localUrl } from '../lib/catalogue.js';

const site = new URL('../_site/', import.meta.url);
const root = new URL('../', import.meta.url);

await rm(site, { recursive: true, force: true });
await mkdir(new URL('data/', site), { recursive: true });
await mkdir(new URL('styles/', site), { recursive: true });

for (const file of ['demo/index.html', 'demo/map.js', 'charts.json', 'manifest.json']) {
  await cp(new URL(file, root), new URL(file.replace(/^demo\//, ''), site));
}
let bytes = 0;
const ids = new Set(charts.flatMap((chart) => chart.layers.map((layer) => layer.id)));
for (const chart of charts) {
  await cp(new URL(`styles/${chart.id}.json`, root), new URL(`styles/${chart.id}.json`, site));
}
for (const id of ids) {
  const entry = find(id);
  await cp(localUrl(entry), new URL(`data/${id}.geojson`, site));
  bytes += (await stat(localUrl(entry))).size;
}
process.stderr.write(
  `_site: ${charts.length} charts, ${ids.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB of GeoJSON\n`,
);
