import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  manifest,
  ids,
  find,
  atScale,
  format,
  localPath,
  source,
  upstreamName,
  upstreamUrl,
} from '../lib/catalogue.js';

// Everything here runs without data/ and without the network: the manifest is
// the contract, and these are its terms.

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const MB = 1024 * 1024;
const NE_SCALES = ['10m', '50m', '110m'];
const GEOMETRIES = ['lines', 'polygons', 'points'];
const FORMATS = ['geojson', 'shp', 'txt'];
const ne = manifest.files.filter((entry) => entry.source === 'ne');
const gshhg = manifest.files.filter((entry) => entry.source === 'gshhg');

test('two pinned sources, keyed by short name', () => {
  assert.deepEqual(Object.keys(manifest.sources), ['ne', 'gshhg']);
  assert.equal(manifest.source, undefined, 'the single `source` is gone; read `sources`');
});

test('Natural Earth is one pinned release, not a branch', () => {
  const { ne } = manifest.sources;
  assert.match(ne.ref, /^v\d+\.\d+\.\d+$/);
  assert.ok(ne.base.includes(`/${ne.ref}/`), 'base URL carries the ref');
  assert.match(ne.base, /^https:\/\/raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\//);
  assert.equal(ne.licence, 'public domain');
});

test('GSHHG is one pinned zip, its own bytes and sha256 promised, under the LGPL', () => {
  const { gshhg } = manifest.sources;
  assert.equal(gshhg.version, '2.3.7');
  assert.equal(gshhg.url, 'https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip');
  assert.ok(gshhg.url.includes(gshhg.version), 'the URL carries the version');
  assert.ok(Number.isInteger(gshhg.bytes) && gshhg.bytes > 100 * MB);
  assert.match(gshhg.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(gshhg.licence, 'LGPL-3.0-or-later');
  assert.match(gshhg.site, /^https:\/\/www\.soest\.hawaii\.edu\//);
});

test('every entry names a known source and a known format', () => {
  assert.equal(new Set(ids()).size, manifest.files.length, 'ids unique');
  for (const entry of manifest.files) {
    assert.ok(source(entry), `${entry.id}: source ${entry.source}`);
    assert.ok(FORMATS.includes(format(entry)), `${entry.id}: format ${entry.format}`);
    assert.ok(entry.about.length > 0, `${entry.id} says why a boat wants it`);
    if (entry.layer) {
      assert.ok(GEOMETRIES.includes(entry.geometry), entry.id);
      assert.ok(entry.scale, `${entry.id} has a scale`);
    } else {
      assert.equal(format(entry), 'txt', `${entry.id}: only a notice has no layer`);
    }
  }
});

test('Natural Earth ids follow the file: ne-<layer>-<scale>, GeoJSON', () => {
  for (const entry of ne) {
    assert.equal(entry.id, `ne-${entry.layer.replaceAll('_', '-')}-${entry.scale}`, entry.id);
    assert.ok(NE_SCALES.includes(entry.scale), entry.id);
    assert.equal(format(entry), 'geojson', entry.id);
    assert.equal(entry.member, undefined, `${entry.id} is a file of its own`);
  }
});

test('GSHHG ships the h land polygons and the two notices the licence makes travel', () => {
  assert.deepEqual(
    gshhg.map((entry) => entry.id),
    ['gshhg-land-h', 'gshhg-licence', 'gshhg-copying-lesser'],
  );
  for (const entry of gshhg) assert.ok(entry.member, `${entry.id} names its member of the zip`);
  const land = find('gshhg-land-h');
  assert.equal(land.member, 'GSHHS_shp/h/GSHHS_h_L1.shp');
  assert.deepEqual(
    [land.format, land.layer, land.scale, land.geometry],
    ['shp', 'land', 'h', 'polygons'],
  );
  assert.equal(find('gshhg-licence').member, 'LICENSE.TXT');
  assert.equal(find('gshhg-copying-lesser').member, 'COPYING.LESSERv3');
  assert.deepEqual(atScale('h'), [land]);
});

test('every entry promises exact bytes', () => {
  for (const entry of manifest.files) {
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0, entry.id);
    assert.match(entry.sha256, /^sha256:[0-9a-f]{64}$/, entry.id);
  }
});

test('paths and URLs derive from the entry alone', () => {
  const entry = find('ne-coastline-50m');
  assert.equal(upstreamName(entry), 'ne_50m_coastline.geojson');
  assert.equal(upstreamUrl(entry), manifest.sources.ne.base + 'ne_50m_coastline.geojson');
  assert.equal(localPath(entry), 'data/ne-coastline-50m.geojson');
  const land = find('gshhg-land-h');
  assert.equal(upstreamName(land), 'GSHHS_shp/h/GSHHS_h_L1.shp');
  assert.equal(upstreamUrl(land), manifest.sources.gshhg.url, 'a member is fetched by its zip');
  assert.equal(localPath(land), 'data/gshhg-land-h.shp');
  assert.equal(localPath(find('gshhg-licence')), 'data/gshhg-licence.txt');
  assert.equal(find('gshhg-l1'), undefined, 'an id this package does not mint');
});

test('the Natural Earth share: every 50m and 110m file; at 10m, coastline, land and what fits a 5 MB body', () => {
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
    for (const scale of NE_SCALES) {
      if (layer === 'ocean' && scale === '10m') continue; // over the cap: coastlines-10m
      assert.ok(find(`ne-${layer.replaceAll('_', '-')}-${scale}`), `${layer} at ${scale}`);
    }
  }
});

test('the Natural Earth raw set stays under its coarse line', () => {
  // Design §2e: the gate is 30 MB packed (R4), which the sync job in CI
  // measures with `npm pack`. Raw bytes are what the manifest knows, so this
  // is a coarse ceiling that trips only if a companion package's share leaks
  // in. The GSHHG set is fixed by id above, so it needs no line here.
  const raw = ne.reduce((sum, entry) => sum + entry.bytes, 0);
  assert.ok(raw < 60 * MB, `${(raw / MB).toFixed(1)} MB raw from Natural Earth`);
});

test('package.json exports every shipped thing by subpath, and ships it', () => {
  assert.equal(pkg.exports['./data/*'], './data/*.geojson');
  assert.equal(pkg.exports['./data/*.shp'], './data/*.shp');
  assert.equal(pkg.exports['./data/*.txt'], './data/*.txt');
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
