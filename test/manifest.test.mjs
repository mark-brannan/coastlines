import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  manifest,
  ids,
  find,
  atScale,
  localPath,
  upstreamName,
  upstreamUrl,
} from '../lib/catalogue.js';

// Everything here runs without data/ and without the network: the manifest is
// the contract, and these are its terms.

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const MB = 1024 * 1024;
const SCALES = ['10m', '50m', '110m'];
const GEOMETRIES = ['lines', 'polygons', 'points'];

test('the source is one pinned Natural Earth release, not a branch', () => {
  assert.match(manifest.source.ref, /^v\d+\.\d+\.\d+$/);
  assert.ok(manifest.source.base.includes(`/${manifest.source.ref}/`), 'base URL carries the ref');
  assert.match(
    manifest.source.base,
    /^https:\/\/raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\//,
  );
  assert.equal(manifest.source.licence, 'public domain');
});

test('ids are unique and follow the file: ne-<layer>-<scale>', () => {
  assert.equal(new Set(ids()).size, manifest.files.length);
  for (const entry of manifest.files) {
    assert.equal(entry.id, `ne-${entry.layer.replaceAll('_', '-')}-${entry.scale}`, entry.id);
    assert.ok(SCALES.includes(entry.scale), entry.id);
    assert.ok(GEOMETRIES.includes(entry.geometry), entry.id);
    assert.ok(entry.about.length > 0, `${entry.id} says why a boat wants it`);
  }
});

test('every entry promises exact bytes', () => {
  for (const entry of manifest.files) {
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0, entry.id);
    assert.match(entry.sha256, /^sha256:[0-9a-f]{64}$/, entry.id);
  }
});

test('paths and URLs derive from the id alone', () => {
  const entry = find('ne-coastline-50m');
  assert.equal(upstreamName(entry), 'ne_50m_coastline.geojson');
  assert.equal(upstreamUrl(entry), manifest.source.base + 'ne_50m_coastline.geojson');
  assert.equal(localPath(entry), 'data/ne-coastline-50m.geojson');
  assert.equal(find('gshhg-l1'), undefined, 'an id this package does not mint');
});

test("this package's share: every 50m and 110m file; at 10m, coastline, land and what fits a 5 MB body", () => {
  // Design 2026-10-10 §2e: the 10m files over the 5 MB body cap and the
  // bathymetry set belong to the companion packages, not here.
  for (const entry of atScale('10m')) {
    assert.ok(
      !entry.layer.startsWith('bathymetry'),
      `${entry.id} belongs to coastlines-bathymetry`,
    );
    if (!['coastline', 'land'].includes(entry.layer)) {
      assert.ok(
        entry.bytes <= 5 * MB,
        `${entry.id} is over the 5 MB body cap; it belongs to coastlines-10m`,
      );
    }
  }
  assert.ok(atScale('50m').length >= 12);
  assert.ok(atScale('110m').length >= 10);
  for (const layer of ['coastline', 'land', 'ocean', 'geographic_lines']) {
    for (const scale of SCALES) {
      if (layer === 'ocean' && scale === '10m') continue; // over the cap: coastlines-10m
      assert.ok(find(`ne-${layer.replaceAll('_', '-')}-${scale}`), `${layer} at ${scale}`);
    }
  }
});

test('the raw set stays under the package line', () => {
  // Design §2e: `npm pack` of this package was 14.5 MB gzipped against a 30 MB
  // line (R4). Raw bytes are what the manifest knows, so this is a coarse
  // ceiling that trips only if a companion package's share leaks in.
  const raw = manifest.files.reduce((sum, entry) => sum + entry.bytes, 0);
  assert.ok(raw < 60 * MB, `${(raw / MB).toFixed(1)} MB raw`);
});

test('package.json exports every shipped thing by subpath, and ships it', () => {
  assert.equal(pkg.exports['./data/*'], './data/*.geojson');
  assert.equal(pkg.exports['./styles/*'], './styles/*.json');
  assert.equal(pkg.exports['./manifest.json'], './manifest.json');
  assert.equal(pkg.exports['./charts.json'], './charts.json');
  for (const shipped of ['lib', 'data', 'styles', 'manifest.json', 'charts.json', 'LICENSE']) {
    assert.ok(pkg.files.includes(shipped), shipped);
  }
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
  assert.equal(
    pkg.scripts.prepack,
    'node scripts/sync.mjs',
    'the tarball is never built without the data',
  );
});
