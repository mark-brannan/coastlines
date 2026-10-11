import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { manifest, localUrl } from '../lib/catalogue.js';
import { verify } from '../lib/verify.js';

// Needs data/, which `npm run sync` fetches. Without it every test here skips
// rather than fails: `npm test` passes offline, and the sync job in CI is
// where the bytes are proven.

const synced = await access(localUrl(manifest.files[0])).then(
  () => true,
  () => false,
);
const skip = synced ? false : 'data/ not synced; run `npm run sync`';

const GEOJSON_TYPES = {
  lines: ['LineString', 'MultiLineString'],
  polygons: ['Polygon', 'MultiPolygon'],
  points: ['Point', 'MultiPoint'],
};

const firstPosition = (coordinates) =>
  coordinates.length === 0
    ? undefined
    : Array.isArray(coordinates[0])
      ? firstPosition(coordinates[0])
      : coordinates;

for (const entry of manifest.files) {
  test(`${entry.id} is the published file and parses as what it says`, { skip }, async () => {
    const bytes = await readFile(localUrl(entry));
    verify(entry, bytes);
    const collection = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(collection.type, 'FeatureCollection');
    assert.ok(collection.features.length > 0);
    for (const feature of collection.features) {
      if (feature.geometry === null) continue; // Natural Earth ships a few empty features
      assert.ok(
        GEOJSON_TYPES[entry.geometry].includes(feature.geometry.type),
        `${entry.id}: ${feature.geometry.type}`,
      );
      const position = firstPosition(feature.geometry.coordinates);
      if (!position) continue; // an empty MultiLineString: Natural Earth ships a few
      const [lon, lat] = position;
      // Natural Earth overshoots the antimeridian by a few thousandths of a degree.
      assert.ok(
        Math.abs(lon) <= 180.01 && Math.abs(lat) <= 90.01,
        `${entry.id} lon,lat ${lon},${lat}`,
      );
    }
  });
}
