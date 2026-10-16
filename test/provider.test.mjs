import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provider, zoomOf } from '../lib/provider.js';

// A view at web-mercator zoom `z` on the equator, over the given frame.
const viewAt = (z, frame) => ({
  lat: 0,
  resolution: (2 * Math.PI * 6378137) / (512 * 2 ** z),
  ...frame,
});
const GENOA = { lonMin: 8.5, lonMax: 9.5, latMin: 44.2, latMax: 44.6 };

// A source of bands and the whole files, as `read` sees them, logging every path asked for.
function source(files) {
  const asked = [];
  const read = async (path) => {
    asked.push(path);
    if (!(path in files)) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
    return structuredClone(files[path]);
  };
  return { read, asked };
}
const cell = (tag) => ({
  land: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    [
      [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 2],
      ],
    ],
  ].map((p) => p.map((ring) => ring.map(([x, y]) => [x, y, tag]))),
  coast: [
    [
      [0, 0, tag],
      [1, 1, tag],
    ],
  ],
});
const coarse = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0, '50m'],
          [1, 1, '50m'],
        ],
      },
    },
  ],
};
const sites = () => ({
  'data/ne-coastline-50m.geojson': coarse,
  'geo/10m/index.json': { cell: 5, cells: ['1_8', '-36_0'] },
  'geo/10m/-36_0.json': cell('10m past 180'),
  'geo/10m/1_8.json': cell('10m'),
  'geo/h/index.json': { cell: 1, cells: ['8_44', '9_44', '30_30'] },
  'geo/h/8_44.json': cell('h 8_44'),
  'geo/h/9_44.json': cell('h 9_44'),
});
const tags = async (iterable) => {
  const out = [];
  for await (const ring of iterable) out.push(ring[0][2]);
  return out;
};

test('a view whose scale is the 512 px world is zoom 0, and each halving one zoom more', () => {
  assert.equal(zoomOf(viewAt(0, GENOA)), 0);
  assert.ok(Math.abs(zoomOf(viewAt(11, GENOA)) - 11) < 1e-9);
  const north = { ...viewAt(11, GENOA), lat: 60 };
  assert.ok(Math.abs(zoomOf(north) - 10) < 1e-9, 'at 60N a metre is two at the equator');
});

test('rings are an async iterable, the shape a drawing port pulls', () => {
  const { read } = source(sites());
  const rings = provider({ read }).rings(viewAt(11, GENOA));
  assert.equal(typeof rings[Symbol.asyncIterator], 'function');
});

test('a close view draws from the finest band it has passed, over the cells near its frame', async () => {
  const { read, asked } = source(sites());
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(11, GENOA))), ['h 8_44', 'h 9_44']);
  assert.ok(!asked.includes('geo/h/30_30.json'), 'a cell far from the frame is not read');
});

test('a band edge is passed, not reached', async () => {
  const { read } = source(sites());
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(10, GENOA))), ['10m']);
});

test('a view short of every band draws the whole file', async () => {
  const { read, asked } = source(sites());
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(5, GENOA))), ['50m']);
  assert.deepEqual(asked, ['data/ne-coastline-50m.geojson']);
});

test('a band with a cell it cannot read gives the whole view to the band below', async () => {
  const files = sites();
  delete files['geo/h/9_44.json'];
  const { read } = source(files);
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(11, GENOA))), ['10m']);
});

test('a band whose index cannot be read is skipped', async () => {
  const files = sites();
  delete files['geo/h/index.json'];
  const { read } = source(files);
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(11, GENOA))), ['10m']);
});

test('with no band to stand on, the view falls to the whole file', async () => {
  const files = sites();
  delete files['geo/h/9_44.json'];
  delete files['geo/10m/1_8.json'];
  const { read } = source(files);
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(11, GENOA))), ['50m']);
});

test('a cell that failed is asked for again by the next view', async () => {
  const files = sites();
  const saved = files['geo/h/9_44.json'];
  delete files['geo/h/9_44.json'];
  const { read } = source(files);
  const p = provider({ read });
  await tags(p.rings(viewAt(11, GENOA)));
  files['geo/h/9_44.json'] = saved;
  assert.deepEqual(await tags(p.rings(viewAt(11, GENOA))), ['h 8_44', 'h 9_44']);
});

test('an index that failed is asked for again by the next view', async () => {
  const files = sites();
  const saved = files['geo/h/index.json'];
  delete files['geo/h/index.json'];
  const { read } = source(files);
  const p = provider({ read });
  assert.deepEqual(await tags(p.rings(viewAt(11, GENOA))), ['10m']);
  files['geo/h/index.json'] = saved;
  assert.deepEqual(await tags(p.rings(viewAt(11, GENOA))), ['h 8_44', 'h 9_44']);
});

test('a frame across the antimeridian reads the cells on the far side', async () => {
  const { read } = source(sites());
  const pacific = { lonMin: 178, lonMax: 182, latMin: 1, latMax: 2 };
  assert.deepEqual(await tags(provider({ read }).rings(viewAt(9.5, pacific))), ['10m past 180']);
});

test('loaded and pending say what a view would fetch, and drawing it fetches it', async () => {
  const { read } = source(sites());
  const p = provider({ read });
  const view = viewAt(11, GENOA);
  assert.equal(await p.loaded(view), false);
  // two cells at gshhg-h-land's measured bytesPerCell (catalogue.json)
  assert.deepEqual(await p.pending(view), { band: 'gshhg-h-land', cells: 2, bytes: 2 * 3717 });
  await tags(p.rings(view));
  assert.equal(await p.loaded(view), true);
  assert.deepEqual(await p.pending(view), { band: 'gshhg-h-land', cells: 0, bytes: 0 });
  const far = viewAt(5, GENOA);
  assert.deepEqual(await p.pending(far), { band: 'ne-50m-coastline', cells: 1, bytes: 1640858 });
});

test('held and cost still answer as loaded and pending, warning once each', async () => {
  const { read } = source(sites());
  const p = provider({ read });
  const view = viewAt(11, GENOA);
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    assert.equal(await p.held(view), await p.loaded(view));
    assert.deepEqual(await p.cost(view), await p.pending(view));
    await p.held(view);
    await p.cost(view);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2);
});

test('a view with metresPerPixel still draws, warning once', async () => {
  const { read } = source(sites());
  const p = provider({ read });
  const { resolution, ...rest } = viewAt(11, GENOA);
  const old = { ...rest, metresPerPixel: resolution };
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    assert.equal(zoomOf(old), zoomOf(viewAt(11, GENOA)));
    assert.deepEqual(await tags(p.rings(old)), await tags(p.rings(viewAt(11, GENOA))));
    assert.equal(await p.loaded(old), true);
    // `resolution` wins when both are given, without a warning
    zoomOf({ ...old, resolution: 1e9 });
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /`metresPerPixel` is deprecated, use `resolution`/);
});

test('land yields every ring of every polygon', async () => {
  const files = { ...sites(), 'data/ne-land-50m.geojson': coarse };
  const { read } = source(files);
  const rings = await tags(provider({ read, kind: 'land' }).rings(viewAt(11, GENOA)));
  assert.deepEqual(rings, ['h 8_44', 'h 8_44', 'h 9_44', 'h 9_44']);
});

test('an unknown kind is refused', () => {
  assert.throws(() => provider({ read: async () => ({}), kind: 'reefs' }), /unknown kind reefs/);
});

// A land cell with one island that has a lake in it: an outer ring and a hole.
const ring = (x, y, s, tag) => [
  [x, y, tag],
  [x + s, y, tag],
  [x + s, y + s, tag],
  [x, y, tag],
];
const withLake = () => {
  const files = sites();
  files['geo/h/8_44.json'] = {
    land: [[ring(8, 44, 4, 'outer'), ring(9, 45, 1, 'lake')]],
    coast: [ring(8, 44, 4, 'outer')],
  };
  return files;
};
const collect = async (iterable) => {
  const out = [];
  for await (const x of iterable) out.push(x);
  return out;
};

test('features yields GeoJSON Features, and a polygon keeps its hole', async () => {
  const { read } = source(withLake());
  const fs = await collect(provider({ read }).features(viewAt(11, GENOA), 'land'));
  assert.equal(fs.length, 3);
  for (const f of fs) {
    assert.equal(f.type, 'Feature');
    assert.equal(f.geometry.type, 'Polygon');
    assert.ok(
      f.geometry.coordinates.every((r) => r.length >= 4 && r[0].join() === r.at(-1).join()),
    );
  }
  const island = fs[0].geometry.coordinates;
  assert.deepEqual(
    island.map((r) => r[0][2]),
    ['outer', 'lake'],
  );
});

test('features of the coastline are LineStrings', async () => {
  const { read } = source(withLake());
  const fs = await collect(provider({ read }).features(viewAt(11, GENOA), 'coastline'));
  assert.deepEqual([...new Set(fs.map((f) => f.geometry.type))], ['LineString']);
});

test('polygons give each polygon as outer ring then holes; rings still flatten them', async () => {
  const { read } = source(withLake());
  const p = provider({ read });
  const polys = await collect(p.polygons(viewAt(11, GENOA), 'land'));
  assert.deepEqual(
    polys[0].map((r) => r[0][2]),
    ['outer', 'lake'],
  );
  assert.deepEqual(await tags(p.rings(viewAt(11, GENOA), 'land')), [
    'outer',
    'lake',
    'h 9_44',
    'h 9_44',
  ]);
});

test('a whole file is read into Features, a MultiPolygon split into polygons', async () => {
  const multi = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[ring(0, 0, 1, 'a')], [ring(2, 2, 1, 'b'), ring(2.2, 2.2, 0.2, 'c')]],
        },
      },
    ],
  };
  const { read } = source({ ...sites(), 'data/ne-land-50m.geojson': multi });
  const p = provider({ read });
  const view = viewAt(5, GENOA);
  assert.equal((await collect(p.features(view, 'land')))[0].geometry.type, 'MultiPolygon');
  assert.equal((await collect(p.polygons(view, 'land'))).length, 2);
  assert.equal((await collect(p.rings(view, 'land'))).length, 3);
});

test('an unknown layer is refused', async () => {
  const { read } = source(withLake());
  const p = provider({ read });
  await assert.rejects(collect(p.features(viewAt(11, GENOA), 'reefs')), /unknown layer reefs/);
});

test('kind still picks the default layer, and warns once', async () => {
  // a fresh copy of the module, its warn-once memory empty
  const { provider } = await import('../lib/provider.js?kind');
  const { read } = source(withLake());
  const view = viewAt(11, GENOA);
  const plain = provider({ read });
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    const land = provider({ read, kind: 'land' });
    const coast = provider({ read, kind: 'coast' });
    assert.deepEqual(await collect(land.rings(view)), await collect(plain.rings(view, 'land')));
    assert.deepEqual(
      await collect(coast.rings(view)),
      await collect(plain.rings(view, 'coastline')),
    );
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /`kind` is deprecated, use `layer`/);
});

test('lakes read c.land of a lake cell, keep islands as holes, and yield Polygons', async () => {
  const files = {
    ...sites(),
    'geo/h-lakes/index.json': { cell: 1, cells: ['8_44'] },
    'geo/h-lakes/8_44.json': {
      land: [[ring(8, 44, 4, 'shore'), ring(9, 45, 1, 'island')]],
      coast: [ring(8, 44, 4, 'shore')],
    },
  };
  const { read, asked } = source(files);
  const p = provider({ read });
  const view = viewAt(11, GENOA);
  const fs = await collect(p.features(view, 'lakes'));
  assert.deepEqual(
    fs.map((f) => f.geometry.type),
    ['Polygon'],
  );
  assert.ok(asked.includes('geo/h-lakes/8_44.json'));
  const polys = await collect(p.polygons(view, 'lakes'));
  assert.equal(polys.length, 1);
  assert.deepEqual(
    polys[0].map((r) => r[0][2]),
    ['shore', 'island'],
  );
  assert.equal((await collect(p.rings(view, 'lakes'))).length, 2);
});

test('water reads the { rivers, lakes } cell: LineStrings and Polygons, in that order', async () => {
  const river = {
    type: 'Feature',
    properties: { name: 'Po' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [7, 44, 'river'],
        [8, 45, 'river'],
      ],
    },
  };
  const lake = {
    type: 'Feature',
    properties: { name: 'Lago' },
    geometry: { type: 'Polygon', coordinates: [ring(8, 44, 4, 'shore'), ring(9, 45, 1, 'island')] },
  };
  const files = {
    ...sites(),
    'geo/water-10m/index.json': { cell: 5, cells: ['1_8'] },
    'geo/water-10m/1_8.json': {
      rivers: { type: 'FeatureCollection', features: [river] },
      lakes: { type: 'FeatureCollection', features: [lake] },
    },
  };
  const { read, asked } = source(files);
  const p = provider({ read });
  const view = viewAt(11, GENOA);
  const fs = await collect(p.features(view, 'water'));
  assert.deepEqual(
    fs.map((f) => f.geometry.type),
    ['LineString', 'Polygon'],
  );
  assert.deepEqual(
    fs.map((f) => f.properties.name),
    ['Po', 'Lago'],
  );
  assert.ok(asked.includes('geo/water-10m/1_8.json'));
  const polys = await collect(p.polygons(view, 'water'));
  assert.deepEqual(
    polys[0].map((r) => r[0][2]),
    ['shore', 'island'],
  );
  assert.equal((await collect(p.rings(view, 'water'))).length, 3);
});
