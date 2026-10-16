import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { provider, zoomOf } from '../lib/provider.js';

// Needs geo/, which `npm run sync` builds. Without it these skip rather than fail; the sync job in
// CI is where they run.
const root = new URL('../', import.meta.url);
const synced = await access(new URL('geo/water-10m/index.json', root)).then(
  () => access(new URL('geo/h-lakes/index.json', root)).then(() => true),
  () => false,
);
const skip = synced ? false : 'geo/ not built; run `npm run sync`';
const read = async (path) => JSON.parse(await readFile(new URL(path, root)));

// Seattle, Lake Washington at about 47.61N 122.26W, framed 0.2 degrees across.
const seattleAt = (zoom) => {
  const lat = 47.61;
  const resolution = (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return { lat, resolution, lonMin: -122.36, lonMax: -122.16, latMin: 47.51, latMax: 47.71 };
};
const inRing = ([px, py], ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const polys = (f) =>
  f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

for (const zoom of [10.5, 12.5]) {
  test(
    `at Seattle, z${zoom}: Lake Washington is a lake, once, with no shore drawn twice`,
    { skip },
    async () => {
      const view = seattleAt(zoom);
      assert.ok(Math.abs(zoomOf(view) - zoom) < 1e-6);
      const fs = [];
      for await (const f of provider({ read }).features(view, 'water')) fs.push(f);
      const lakes = fs.filter((f) => /Polygon$/.test(f.geometry.type));
      // Natural Earth's lakes carry a `name` key, GSHHG's none
      const ne = lakes.filter((f) => 'name' in f.properties);
      const gshhg = lakes.filter((f) => !('name' in f.properties));
      assert.ok(
        ne.some((f) => f.properties.name === 'Lake Washington'),
        `lakes: ${ne.map((f) => f.properties.name).join(', ')}`,
      );
      const ids = ne.map((f) => f.id);
      assert.equal(new Set(ids).size, ids.length, 'a Natural Earth lake is yielded once');
      for (const l of ne)
        for (const poly of polys(l))
          for (const g of gshhg.flatMap(polys))
            assert.ok(
              !poly[0].some((p) => inRing(p, g[0]) && !g.slice(1).some((h) => inRing(p, h))),
              `${l.properties.name} has a vertex in a GSHHG lake`,
            );
    },
  );
}
