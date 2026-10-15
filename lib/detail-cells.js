// Cuts Natural Earth 10m land and coast into square lon/lat cells, so a close view fetches only the
// few cells around it rather than the whole 10m world. Land polygons are clipped to each cell (fill
// is even-odd, so the cut edges vanish; each cell's `m` holds, for its land polygons in order, the
// area in km2 and colour of the island each is a piece of, worked out before the cut); coast lines are split where they pass from one cell to the
// next, each piece keeping the shared point so the line stays joined. Coordinates are rounded to
// `digits` decimals (5 is about a metre). Cell keys are `${xi}_${yi}`, xi = floor(lon / size).

import { islandInfo } from './island.js';

const key = (xi, yi) => `${xi}_${yi}`;

// Sutherland-Hodgman against one axis-aligned half-plane: keep points with p[axis] <= v (keep < 0)
// or >= v (keep > 0). `ring` is open (last point not repeated).
function clipHalf(ring, axis, v, keep) {
  const out = [],
    inside = (p) => (keep < 0 ? p[axis] <= v : p[axis] >= v);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      ia = inside(a),
      ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (v - a[axis]) / (b[axis] - a[axis]);
      const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      p[axis] = v;
      out.push(p);
    }
  }
  return out;
}

function ringBox(ring) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Polygons ([[outer, ...holes]], open rings) into cells by recursive halving along cell lines, so
// each point is clipped about log2(cells) times rather than once per cell.
function splitPolygons(polys, box, size, emit) {
  if (!polys.length) return;
  const [x0, y0, x1, y1] = box,
    nx = Math.round((x1 - x0) / size),
    ny = Math.round((y1 - y0) / size);
  if (nx <= 1 && ny <= 1) {
    emit(Math.round(x0 / size), Math.round(y0 / size), polys);
    return;
  }
  const axis = nx >= ny ? 0 : 1,
    mid = axis === 0 ? x0 + Math.floor(nx / 2) * size : y0 + Math.floor(ny / 2) * size;
  const lo = [],
    hi = [];
  for (const poly of polys) {
    const b = ringBox(poly[0]);
    if (b[axis + 2] <= mid) {
      lo.push(poly);
      continue;
    }
    if (b[axis] >= mid) {
      hi.push(poly);
      continue;
    }
    for (const [side, keep] of [
      [lo, -1],
      [hi, 1],
    ]) {
      const [outer, ...holes] = poly.map((r) => clipHalf(r, axis, mid, keep));
      if (outer.length >= 3)
        side.push(Object.assign([outer, ...holes.filter((r) => r.length >= 3)], { isl: poly.isl }));
    }
  }
  const loBox = axis === 0 ? [x0, y0, mid, y1] : [x0, y0, x1, mid],
    hiBox = axis === 0 ? [mid, y0, x1, y1] : [x0, mid, x1, y1];
  splitPolygons(lo, loBox, size, emit);
  splitPolygons(hi, hiBox, size, emit);
}

// `land`: GeoJSON polygons as [[outer, ...holes]] of closed [lon, lat] rings; `coast`: lines of
// [lon, lat]. Returns Map(key -> { land, coast, m }), rings closed again, coordinates rounded; `m`
// holds `meta` of the whole polygon each land piece was cut from (by default its island's area and colour).
const islandMeta = (poly) => {
  const i = islandInfo(poly);
  return [i.km2, i.hue];
};
export function cutCells({ land, coast }, size = 5, digits = 5, meta = islandMeta) {
  const f = 10 ** digits,
    round = (p) => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
  const tidy = (pts) =>
    pts.map(round).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  const cells = new Map(),
    cell = (k) => cells.get(k) ?? cells.set(k, { land: [], coast: [], m: [] }).get(k);
  const ids = coast.some((l) => l.id !== undefined); // and if lines carry an `id`, `cm` holds each piece's

  const open = (r) =>
    r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
      ? r.slice(0, -1)
      : r;
  splitPolygons(
    land.map((poly) => Object.assign(poly.map(open), { isl: meta(poly) })),
    [-180, -90, 180, 90],
    size,
    (xi, yi, polys) => {
      const c = cell(key(xi, yi)),
        out = c.land;
      for (const poly of polys) {
        const rings = poly
          .map(tidy)
          .filter((r) => r.length >= 3)
          .map((r) => [...r, r[0]]);
        if (rings.length) {
          out.push(rings);
          c.m.push(poly.isl);
        }
      }
    },
  );

  // A segment belongs to the cell holding its midpoint; a run of segments in one cell is one piece.
  const cellOf = (a, b) =>
    key(Math.floor((a[0] + b[0]) / 2 / size), Math.floor((a[1] + b[1]) / 2 / size));
  const put = (k, piece, id) => {
    const c = cell(k);
    c.coast.push(piece);
    if (ids) (c.cm ??= []).push(id);
  };
  for (const line of coast) {
    let piece = null,
      at = null;
    for (let i = 0; i < line.length - 1; i++) {
      const k = cellOf(line[i], line[i + 1]);
      if (k !== at) {
        if (piece) put(at, piece, line.id);
        piece = [line[i]];
        at = k;
      }
      piece.push(line[i + 1]);
    }
    if (piece) put(at, piece, line.id);
  }
  for (const c of cells.values()) {
    const lines = c.coast.map(tidy),
      keep = lines.map((l) => l.length > 1);
    c.coast = lines.filter((_, i) => keep[i]);
    if (c.cm) c.cm = c.cm.filter((_, i) => keep[i]);
  }
  return cells;
}

// The Natural Earth 10m water downloads, the world file first and then the regional supplements,
// which hold what the world file leaves out (Lake Washington, Como, the Snohomish) and repeat none of
// it. joinWater makes one collection of several, in this order, so cutWater's ids stay unique.
export const WATER_FILES = {
  rivers: [
    'ne_10m_rivers_lake_centerlines.geojson',
    'ne_10m_rivers_north_america.geojson',
    'ne_10m_rivers_europe.geojson',
  ],
  lakes: [
    'ne_10m_lakes.geojson',
    'ne_10m_lakes_north_america.geojson',
    'ne_10m_lakes_europe.geojson',
  ],
};
export const joinWater = (geos) => ({
  type: 'FeatureCollection',
  features: geos.flatMap((g) => g?.features ?? []),
});

// Natural Earth rivers and lakes into the same square cells, for scripts/water.mjs past WATER_ZOOM.
// A feature goes whole into every cell it reaches (a river, each cell its segments' midpoints and
// vertices fall in; a lake, each cell its box meets), so a river keeps one wiggle and a lake one
// outline wherever the view is cut; its index in the source file is its GeoJSON `id`, by which
// the scene keeps one copy of a feature fetched from several cells. Properties are cut to `keep`.
// Returns Map(key -> { rivers, lakes }), each a FeatureCollection.
export function cutWater(
  riversGeo,
  lakesGeo,
  {
    keep = { rivers: ['name', 'featurecla', 'min_zoom'], lakes: ['name', 'min_zoom'] },
    size = 5,
    digits = 5,
  } = {},
) {
  const f = 10 ** digits,
    round = (c) =>
      typeof c[0] === 'number'
        ? [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f]
        : c.map(round);
  const cells = new Map(),
    cell = (k) => cells.get(k) ?? cells.set(k, { rivers: [], lakes: [] }).get(k);
  // 180 east and 90 north fall in the last cell, not one past it
  const xiOf = (lon) => Math.min(180 / size - 1, Math.floor(lon / size)),
    yiOf = (lat) => Math.min(90 / size - 1, Math.floor(lat / size));
  const at = (lon, lat) => key(xiOf(lon), yiOf(lat));
  const lines = (g) =>
    g.type === 'LineString'
      ? [g.coordinates]
      : g.type === 'MultiLineString'
        ? g.coordinates
        : g.type === 'Polygon'
          ? g.coordinates
          : g.type === 'MultiPolygon'
            ? g.coordinates.flat()
            : [];
  const reach = {
    rivers: (g) => {
      const ks = new Set();
      for (const l of lines(g))
        l.forEach((p, i) => {
          ks.add(at(p[0], p[1]));
          if (i) ks.add(at((p[0] + l[i - 1][0]) / 2, (p[1] + l[i - 1][1]) / 2));
        });
      return ks;
    },
    lakes: (g) => {
      const [x0, y0, x1, y1] = ringBox(lines(g).flat()),
        ks = new Set();
      for (let xi = xiOf(x0); xi <= xiOf(x1); xi++)
        for (let yi = yiOf(y0); yi <= yiOf(y1); yi++) ks.add(key(xi, yi));
      return ks;
    },
  };
  for (const [kind, geo] of [
    ['rivers', riversGeo],
    ['lakes', lakesGeo],
  ]) {
    (geo?.features ?? []).forEach((ft, id) => {
      if (!ft.geometry) return;
      const slim = {
        type: 'Feature',
        id,
        properties: Object.fromEntries(keep[kind].map((k) => [k, ft.properties[k]])),
        geometry: { type: ft.geometry.type, coordinates: round(ft.geometry.coordinates) },
      };
      for (const k of reach[kind](ft.geometry)) cell(k)[kind].push(slim);
    });
  }
  for (const [k, c] of cells)
    cells.set(k, {
      rivers: { type: 'FeatureCollection', features: c.rivers },
      lakes: { type: 'FeatureCollection', features: c.lakes },
    });
  return cells;
}

// GSHHG lakes (level 2, river-lakes among them) with their islands (level 3) as holes, from the
// shapefiles' polygons and dBASE records, for cutLakes. Each lake carries its GSHHG id and its
// whole lon/lat box, which its cut pieces keep: the scene drops a 10m lake inside one.
export function dbfRecords(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = b.readUInt32LE(4),
    headLength = b.readUInt16LE(8),
    recordLength = b.readUInt16LE(10),
    fields = [];
  for (let at = 32, o = 1; b[at] !== 0x0d; at += 32) {
    const name = b.toString('latin1', at, at + 11).replace(/\0.*/s, ''),
      length = b[at + 16];
    fields.push([name, o, length]);
    o += length;
  }
  return Array.from({ length: n }, (_, i) =>
    Object.fromEntries(
      fields.map(([k, o, l]) => [
        k,
        b
          .toString(
            'latin1',
            headLength + i * recordLength + o,
            headLength + i * recordLength + o + l,
          )
          .trim(),
      ]),
    ),
  );
}
export function gshhgLakes(lakes, lakeRecords, islands, islandRecords) {
  const byId = new Map(
    lakes.map((poly, i) => [
      lakeRecords[i].id,
      Object.assign([...poly], { id: +lakeRecords[i].id }),
    ]),
  );
  islands.forEach((poly, i) => byId.get(islandRecords[i].parent_id)?.push(poly[0]));
  return [...byId.values()];
}
// Lakes into cells as land is (cutCells): pieces clipped to each cell to fill, and the shores split
// at cell edges to ink, so a cut edge is never drawn. `m` holds, per piece, [id, x0, y0, x1, y1]: the
// lake's id and whole box, rounded out to `digits`; `cm` each shore piece's lake id.
export function cutLakes(lakes, size, digits = 5) {
  const f = 10 ** digits;
  const shores = lakes.flatMap((lake) =>
    lake.map((ring) => Object.assign([...ring], { id: lake.id })),
  );
  return cutCells({ land: lakes, coast: shores }, size, digits, (poly) => {
    const [x0, y0, x1, y1] = ringBox(poly[0]);
    return [
      poly.id,
      Math.floor(x0 * f) / f,
      Math.floor(y0 * f) / f,
      Math.ceil(x1 * f) / f,
      Math.ceil(y1 * f) / f,
    ];
  });
}
