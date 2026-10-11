#!/usr/bin/env node
// Renders every id in the manifest to one labelled sheet, docs/layers.png:
// equirectangular, one tile per file, so the README shows the catalogue rather
// than describing it. Needs data/ (`npm run sync`) and @napi-rs/canvas.
//
//   node scripts/render-sheet.mjs [docs/layers.png]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { manifest, localUrl } from '../lib/catalogue.js';
import { drawCollection, equirectangular } from '../lib/draw.js';

const out = new URL(`../${process.argv[2] ?? 'docs/layers.png'}`, import.meta.url);
const COLUMNS = 3;
const TILE = { width: 360, height: 180, label: 34, gap: 12 };
const INK = {
  polygons: { fill: '#c9d9c4', stroke: '#6d8a66', lineWidth: 0.4 },
  lines: { stroke: '#4f6f8b', lineWidth: 0.7 },
  points: { fill: '#8a5a44', radius: 1.2 },
};

const rows = Math.ceil(manifest.files.length / COLUMNS);
const cell = { width: TILE.width + TILE.gap, height: TILE.height + TILE.label + TILE.gap };
const canvas = createCanvas(COLUMNS * cell.width + TILE.gap, rows * cell.height + TILE.gap);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);

const kb = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

for (const [index, entry] of manifest.files.entries()) {
  const x = TILE.gap + (index % COLUMNS) * cell.width;
  const y = TILE.gap + Math.floor(index / COLUMNS) * cell.height;
  const collection = JSON.parse(await readFile(localUrl(entry), 'utf8'));

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#eef4f8';
  ctx.fillRect(0, 0, TILE.width, TILE.height);
  ctx.beginPath();
  ctx.rect(0, 0, TILE.width, TILE.height);
  ctx.clip();
  drawCollection(ctx, collection, equirectangular(TILE.width, TILE.height), INK[entry.geometry]);
  ctx.restore();

  ctx.fillStyle = '#222';
  ctx.font = '13px sans-serif';
  ctx.fillText(entry.id, x, y + TILE.height + 16, TILE.width);
  ctx.fillStyle = '#666';
  ctx.font = '11px sans-serif';
  ctx.fillText(
    `${kb(entry.bytes)} · ${collection.features.length} features · ${entry.about}`,
    x,
    y + TILE.height + 30,
    TILE.width,
  );
  process.stderr.write(`${entry.id}\n`);
}

await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, canvas.toBuffer('image/png'));
process.stderr.write(`${out.pathname}: ${canvas.width}x${canvas.height}\n`);
