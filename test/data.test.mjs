import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { manifest, format, localUrl } from '../lib/catalogue.js';
import { verify } from '../lib/verify.js';
import { shapefilePolygons, signedArea } from '../lib/shapefile.js';

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

for (const entry of manifest.files.filter((entry) => format(entry) === 'txt')) {
  test(`${entry.id} is the published notice, readable text`, { skip }, async () => {
    const bytes = await readFile(localUrl(entry));
    verify(entry, bytes);
    const text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    assert.match(
      text,
      entry.id === 'gshhg-licence' ? /Permission to use, copy/ : /LESSER GENERAL PUBLIC LICENSE/,
    );
  });
}

for (const entry of manifest.files.filter((entry) => format(entry) === 'shp')) {
  test(
    `${entry.id} is the published shapefile: polygons, closed, outer rings clockwise`,
    { skip },
    async () => {
      const bytes = await readFile(localUrl(entry));
      verify(entry, bytes);
      const polygons = shapefilePolygons(bytes);
      assert.equal(polygons.length, 144749, 'one polygon per GSHHS record');
      let points = 0;
      for (const polygon of polygons) {
        assert.equal(
          polygon.length,
          1,
          'GSHHS stores one ring per record; holes are their own level',
        );
        const ring = polygon[0];
        points += ring.length; // the closing point counts, as the .shp counts it
        assert.deepEqual(ring[0], ring[ring.length - 1], 'closed');
        assert.ok(signedArea(ring) < 0, 'outer ring clockwise');
      }
      assert.equal(points, 1626467, 'the point count the shapefile carries');
      for (const [lon, lat] of polygons[0][0]) {
        // The shapefile release splits at the antimeridian, so every point is on -180..180.
        assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, `${entry.id} lon,lat ${lon},${lat}`);
      }
    },
  );
}

for (const entry of manifest.files.filter((entry) => format(entry) === 'geojson')) {
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
