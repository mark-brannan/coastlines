// The scene's data side: which band a view draws from, which of its cells, and what it falls back
// to. A drawing library pulls rings from here through its port, an async iterable of rings, so
// neither package imports the other; the caller owns the projection and hands over a view.
//
// A view is the lon/lat frame a caller paints and its scale at the centre:
// `{ lat, resolution, lonMin, lonMax, latMin, latMax }`, `resolution` in metres per pixel (the old
// name, `metresPerPixel`, still reads, deprecated). The frame may run past the
// antimeridian. The catalogue keys bands by web-mercator zoom (a 512 px world at zoom 0), so the
// scale is turned into that zoom at the view's latitude to choose one.
//
// A band of cells keeps `<dir>/<xi>_<yi>.json`, `grid.cellDeg` degrees square, each
// `{ land, coast }` (land and lakes) or `{ rivers, lakes }` (water), and `<dir>/index.json`,
// `{ cell, cells }`, listing the cells that hold anything, under its `cells` source. A view draws
// from the finest band whose zoom it has passed, over the cells within `grid.marginDeg` of its
// frame. For that view, a band whose index cannot be read is skipped, and a band with a cell that
// cannot be read gives way to the band below it; the last of these is the whole file. Both are
// read again for the next view.
//
// The cells format, as lib/detail-cells.js writes it. A `{ land, coast }` cell holds `land`, an array
// of polygons (each `[outer, ...holes]`, closed rings, clipped to the cell), and `coast`, an array
// of lines (shore pieces split at the cell's edges, so no cut edge is inked). Beside them, per
// piece, the facts the cutter knew that the piece alone no longer shows:
// - land bands (`geo/10m`, `geo/h`, `geo/f`): `m[i]`, for `land[i]`, is `[km2, hue]` of the WHOLE
//   island the piece was cut from (lib/island.js), so a piece of Sicily in one cell is drawn as
//   Sicily, not as a sliver. No `cm`.
// - lake bands (`geo/h-lakes`, `geo/f-lakes`): `m[i]`, for `land[i]`, is `[id, x0, y0, x1, y1]`, the
//   lake's id and the box of the whole lake; `cm[i]`, for `coast[i]`, is that shore piece's lake id.
// The provider hands these on: `land` Features carry `{ km2, hue }` as `properties`; `lakes` and
// `lakeshore` Features carry the lake id as the GeoJSON `id` (`gshhg:<id>`) and the lake's whole
// box as `bbox`, so a consumer needs no cell-format code of its own.
// The JSON itself, not lib/bands.js, so the provider runs in a browser too.
import catalogue from '../catalogue.json' with { type: 'json' };

const EARTH_R = 6378137; // metres, web mercator's sphere
const WORLD_PX = 512; // the width of the world at zoom 0, as the catalogue's zooms count it
const RAD = Math.PI / 180;

// A view's metres per pixel: `resolution`, or the deprecated `metresPerPixel` when that is all it has.
const resolutionOf = (view) => {
  if (view.resolution === undefined && view.metresPerPixel !== undefined)
    warnOnce('metresPerPixel', 'resolution');
  return view.resolution ?? view.metresPerPixel;
};

/** The web-mercator zoom of a view's scale at its centre. */
// Rounded, so a view at a band's edge zoom, turned into a scale and back, does not pass it.
export const zoomOf = (view) =>
  Math.round(
    1e9 *
      Math.log2(
        (2 * Math.PI * EARTH_R * Math.cos(view.lat * RAD)) / (WORLD_PX * resolutionOf(view)),
      ),
  ) / 1e9;

// The catalogue's layers a provider vends: the layer whose cells each is read from, the whole file
// it falls back to, and how a cell becomes GeoJSON Features. A cell's polygons are arrays of
// rings, the outer ring first and its holes after, so a Feature keeps them. `props(i)` gives the
// i-th Feature's `properties`.
const polygonFeatures = (polys, props = () => ({})) =>
  (polys ?? []).map((coordinates, i) => ({
    type: 'Feature',
    properties: props(i),
    geometry: { type: 'Polygon', coordinates },
  }));
const lineFeatures = (lines) =>
  (lines ?? []).map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  }));
const isArea = (f) => /Polygon$/.test(f.geometry?.type ?? '');
// A land cell's `m[i]` is [km2, hue] of the whole island `land[i]` was cut from (see the header).
const islandProps = (c) => (i) => {
  const m = c.m?.[i];
  return m ? { km2: m[0], hue: m[1] } : {};
};
// A lake's id as a Feature's `id`: GSHHG's, so a consumer can tell it from a Natural Earth lake's.
const lakeId = (id) => `gshhg:${id}`;
// A Feature of one piece of a GSHHG lake, with the lake's id and whole box when the cell knows them.
const lakeFeature = (poly, m) => ({
  type: 'Feature',
  ...(m ? { id: lakeId(m[0]), bbox: [m[1], m[2], m[3], m[4]] } : {}),
  properties: {},
  geometry: { type: 'Polygon', coordinates: poly },
});
// The shore pieces of a lake cell as LineStrings, each with its lake's id when the cell has `cm`.
const shoreFeatures = (c) =>
  lineFeatures(c.coast).map((f, i) =>
    c.cm?.[i] === undefined ? f : { type: 'Feature', id: lakeId(c.cm[i]), ...f },
  );
const LAYERS = {
  coastline: { cells: 'land', whole: 'ne-50m-coastline', of: (c) => lineFeatures(c.coast) },
  land: {
    cells: 'land',
    whole: 'ne-50m-land',
    of: (c) => polygonFeatures(c.land, islandProps(c)),
  },
  lakes: {
    cells: 'lakes',
    whole: 'ne-50m-lakes',
    of: (c) => lakePieces(c).map(({ poly, m }) => lakeFeature(poly, m)),
  },
  // The lake shores, split at cell edges, from the same cells as `lakes`. No whole file holds
  // these, so below the lake bands the layer yields nothing.
  lakeshore: { cells: 'lakes', whole: null, of: shoreFeatures },
  water: {
    cells: 'water',
    whole: 'ne-50m-rivers-lake-centerlines',
    of: (c) => [...(c.rivers?.features ?? []), ...(c.lakes?.features ?? [])],
    // cutWater writes a feature whole into every cell it reaches, with its index in the source file
    // as `id`; a river and a lake may share one, so the kind is part of the identity.
    key: (f) => (f.id === undefined ? null : `${isArea(f) ? 'lake' : 'river'}:${f.id}`),
  },
};
// The deprecated `kind` words, as the layers they became.
const KIND_LAYER = { coast: 'coastline', land: 'land' };

// { id, dir, zoom, inclusive, cell, margin, bytesPerCell } of a cut record: `dir` is its `cells`
// source's url, `zoom` the zoom it draws past (or from, when `inclusive`), `cell` and `margin` its
// grid in degrees.
const bandOf = (r) => ({
  id: r.id,
  dir: r.sources.find((s) => s.kind === 'cells').url.replace(/\/$/, ''),
  zoom: r.zoom.min,
  inclusive: r.zoom.minInclusive,
  cell: r.grid.cellDeg,
  margin: r.grid.marginDeg,
  bytesPerCell: r.bytesPerCell,
});
const passed = (zoom, b) => (b.inclusive ? zoom >= b.zoom : zoom > b.zoom);

const cellKey = (xi, yi) => `${xi}_${yi}`;

// The band's cells, '<dir>/<xi>_<yi>', that meet the view's frame widened by its margin and that
// the band's index (`known`) lists.
function cellsAround(b, view, known) {
  const deg = b.cell,
    n = 360 / deg;
  const lonMin = view.lonMin - b.margin,
    lonMax = view.lonMax + b.margin;
  const latMin = view.latMin - b.margin,
    latMax = view.latMax + b.margin;
  const keys = new Set();
  for (let xi = Math.floor(lonMin / deg); xi <= Math.floor(lonMax / deg); xi++) {
    const wx = ((((xi + n / 2) % n) + n) % n) - n / 2; // wrapped across the antimeridian
    for (
      let yi = Math.max(-90 / deg, Math.floor(latMin / deg));
      yi <= Math.min(90 / deg - 1, Math.floor(latMax / deg));
      yi++
    ) {
      if (known.has(cellKey(wx, yi))) keys.add(`${b.dir}/${cellKey(wx, yi)}`);
    }
  }
  return [...keys];
}

// The rings of a GeoJSON object: a line's points, a polygon's rings.
function geojsonRings(geo) {
  const of = (g) => {
    if (!g) return [];
    if (g.type === 'FeatureCollection') return g.features.flatMap(of);
    if (g.type === 'Feature') return of(g.geometry);
    if (g.type === 'GeometryCollection') return g.geometries.flatMap(of);
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'MultiLineString' || g.type === 'Polygon') return g.coordinates;
    if (g.type === 'MultiPolygon') return g.coordinates.flat();
    return [];
  };
  return of(geo);
}

// The Features of a whole file: a FeatureCollection, a Feature or a bare geometry.
function geojsonFeatures(geo) {
  if (!geo) return [];
  if (geo.type === 'FeatureCollection') return geo.features;
  if (geo.type === 'Feature') return [geo];
  return [{ type: 'Feature', properties: {}, geometry: geo }];
}

// A Feature's polygons, each an array of rings (outer first, holes after).
function featurePolygons(f) {
  const g = f.geometry;
  if (g?.type === 'Polygon') return [g.coordinates];
  if (g?.type === 'MultiPolygon') return g.coordinates;
  return [];
}

// The lake rule (portolani bdb223c). A Natural Earth lake and a GSHHG lake can be one lake drawn
// twice, two shores a few pixels apart. A Natural Earth lake gives way to a GSHHG lake when its box
// lies inside the GSHHG lake's within LAKE_SLACK degrees (about Natural Earth 10m's vertex spacing)
// and a point of it, a ring's centroid or a vertex, lies in the GSHHG water. The box alone would
// drop every lake inside Superior's or the Caspian's box (Lake Panache by Sudbury, say), and at
// Seattle GSHHG's land has Lake Washington as water, so the lake itself is kept from Natural Earth.
const LAKE_SLACK = 0.02;
const boxOf = (rings) => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const ring of rings)
    for (const [x, y] of ring) {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  return b;
};
const within = (a, b) =>
  a.x0 >= b.x0 - LAKE_SLACK &&
  a.x1 <= b.x1 + LAKE_SLACK &&
  a.y0 >= b.y0 - LAKE_SLACK &&
  a.y1 <= b.y1 + LAKE_SLACK;
const inRing = ([px, py], ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inWater = (p, poly) => inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole));
const centroid = (ring) => {
  let a = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i],
      [x1, y1] = ring[i + 1],
      w = x0 * y1 - x1 * y0;
    a += w;
    x += (x0 + x1) * w;
    y += (y0 + y1) * w;
  }
  return a ? [x / (3 * a), y / (3 * a)] : ring[0];
};
// `ne`: { box, polys } of a Natural Earth lake; `g`: { box, poly } of one piece of a GSHHG lake,
// whose box is the whole lake's.
const sameLake = (ne, g) =>
  within(ne.box, g.box) &&
  ne.polys.some(
    (poly) =>
      inWater(centroid(poly[0]), g.poly) ||
      poly[0].some((p, i) => i % 4 === 0 && inWater(p, g.poly)),
  );

// The pieces of GSHHG lakes in a cell: each polygon with the box of the whole lake it is a piece
// of, which the cell's `m` holds as [id, x0, y0, x1, y1] (the piece's own box when it has none),
// and that `m` itself.
const lakePieces = (cell) =>
  (cell.land ?? []).map((poly, i) => {
    const m = cell.m?.[i];
    return { poly, m, box: m ? { x0: m[1], y0: m[2], x1: m[3], y1: m[4] } : boxOf([poly[0]]) };
  });

/**
 * A provider of GeoJSON for views. `read(path)` resolves to the parsed JSON at a catalogue source
 * path (`geo/h/12_45.json`, `data/ne-coastline-50m.geojson`) and rejects when it cannot.
 *
 * `layer` names one of the catalogue's layers, `coastline`, `land`, `lakes` or `water`, or
 * `lakeshore`, the lake shores from the `lakes` cells.
 *
 * `features(view, layer)` yields the view's GeoJSON Features: Polygon or MultiPolygon for the area
 * layers with their interior rings (holes) kept, LineString or MultiLineString for the line
 * layers. `rings(view, layer)` yields every ring of those, outer and holes flattened into one
 * stream, as a drawing port pulls; `polygons(view, layer)` yields each polygon as an array of
 * rings, outer first, for a fill that must tell an island from a lake.
 *
 * A Feature from a band's cells carries what the cutter knew of the whole it is a piece of (see
 * the cells format in the header): a `land` Feature has `properties: { km2, hue }` of its whole
 * island (`{}` for a cell without them); a GSHHG `lakes` Feature has the lake's id as its `id`
 * (`gshhg:<id>`) and the whole lake's box as `bbox`, a Natural Earth lake keeping its own `id` and
 * `properties`; a `lakeshore` Feature is a LineString with its lake's `id`. The lake shores have
 * no whole file: below the lake bands `lakeshore` yields nothing (`bandFor(view, 'lakes')` is
 * then the whole file's id), and a Natural Earth lake's shore is its polygon's rings.
 *
 * `bandFor(view, layer)` is synchronous: the id of the band the view would draw from, from the
 * indexes already loaded, or the whole file's id when the view has passed no band. It is `null`
 * when an index the choice depends on is not yet known: not asked for, in flight, or failed and
 * awaiting the next view's retry. So it is `null` before the first async call for that view
 * (`features`, `loaded` or `pending`) settles, and the same answer as `pending(view, layer).band`
 * after. A cell that cannot be read gives the view to the band below (see `features`); neither
 * this nor `pending` sees that.
 *
 * Where a view has both Natural Earth water and GSHHG lakes (past zoom 10), `water` and `lakes` both
 * serve the reconciled lakes: every GSHHG lake, and each Natural Earth lake that is not one of
 * them (see the lake rule above). `water` adds the rivers. Lake Washington, which GSHHG's land has
 * as water and its lakes lack, stays a lake, once.
 *
 * `loaded(view, layer)` says whether the view's features are all in hand, so drawing them fetches
 * nothing; `pending(view, layer)` is what drawing it would fetch: the band, the cells not yet
 * loaded, and their bytes where the catalogue knows them. `held` and `cost` are the old names of
 * those two.
 *
 * `kind` (`coast` or `land`) is deprecated: it maps to `layer` (`coastline` or `land`), is the
 * layer these methods use when called without one, and warns once. With neither, that layer is
 * `coastline`.
 */
export function provider({ read, kind }) {
  if (kind !== undefined) warnOnce('kind', 'layer');
  const defaultLayer = kind === undefined ? 'coastline' : KIND_LAYER[kind];
  if (!defaultLayer) throw new Error(`unknown kind ${kind}`);

  const index = new Map(); // dir -> promise of its Set of cell keys, or null when unreadable
  const indexed = new Map(); // dir -> that Set once read: the sync mirror `bandFor` reads
  const loadIndex = (b) => {
    if (!index.has(b.dir))
      index.set(
        b.dir,
        read(`${b.dir}/index.json`).then(
          (i) => {
            const keys = new Set(i.cells);
            indexed.set(b.dir, keys);
            return keys;
          },
          () => {
            index.delete(b.dir); // skipped for this view, tried again for the next
            indexed.set(b.dir, null); // and `bandFor` skips it until that retry lands
            return null;
          },
        ),
      );
    return index.get(b.dir);
  };

  const inflight = new Map(); // path -> promise of its parsed JSON
  const got = new Set(); // paths read
  const fetch = (path) => {
    if (!inflight.has(path))
      inflight.set(
        path,
        read(path).then(
          (json) => {
            got.add(path);
            return json;
          },
          (e) => {
            inflight.delete(path); // a failed read is tried again for the next view
            throw e;
          },
        ),
      );
    return inflight.get(path);
  };

  // A layer's spec, the bands cut for it and its whole file.
  const setups = new Map();
  const setup = (layer = defaultLayer) => {
    const spec = LAYERS[layer];
    if (!spec) throw new Error(`unknown layer ${layer}`);
    if (!setups.has(layer)) {
      const bands = catalogue
        .filter((r) => r.layer === spec.cells && r.grid)
        .map(bandOf)
        .sort((a, b) => a.zoom - b.zoom);
      // `file` and `wholePath` are null for a layer with no whole file (`lakeshore`).
      const file = catalogue.find((r) => r.id === spec.whole) ?? null;
      const wholePath = file?.sources.find((s) => s.kind === 'file').url ?? null;
      setups.set(layer, { spec, bands, file, wholePath });
    }
    return setups.get(layer);
  };

  // The bands the view may draw from, finest first, each with its index: passed, with an index.
  async function candidates(view, { bands }) {
    const zoom = zoomOf(view);
    const all = bands.filter((b) => passed(zoom, b));
    const known = await Promise.all(all.map(loadIndex));
    return all
      .map((b, i) => ({ b, known: known[i] }))
      .filter((c) => c.known !== null)
      .reverse();
  }

  // The finest candidate band with every cell it needs read: { b, keys, cells, parts }, `parts`
  // the cells as lists of Features, one copy of a feature that several cells hold. Null when none.
  async function fromBands(view, s) {
    for (const { b, known } of await candidates(view, s)) {
      const keys = cellsAround(b, view, known);
      try {
        const cells = await Promise.all(keys.map((k) => fetch(`${k}.json`)));
        const seen = new Set();
        const parts = cells.map(s.spec.of).map((part) =>
          part.filter((f) => {
            const id = s.spec.key?.(f) ?? null;
            return id === null || (!seen.has(id) && seen.add(id));
          }),
        );
        return { b, keys, cells, parts };
      } catch {
        // a cell it lacks: the band below draws the whole view, rather than leave a hole
      }
    }
    return null;
  }

  // What the view draws from: that band, else the whole file, else nothing. Each part is a list of
  // Features.
  async function draw(view, s) {
    const parts = (await fromBands(view, s))?.parts;
    if (parts) return parts;
    return s.wholePath === null ? [] : [geojsonFeatures(await fetch(s.wholePath))];
  }

  // The band the view would ask for first, from the indexes read so far: its id, the whole file's
  // (null for a layer without one) below every band, and null while an index it turns on is unread.
  function bandFor(view, layer) {
    const s = setup(layer);
    const zoom = zoomOf(view);
    for (const b of s.bands.filter((b) => passed(zoom, b)).reverse()) {
      if (!indexed.has(b.dir)) return null;
      if (indexed.get(b.dir) !== null) return b.id; // a failed index is skipped, as candidates does
    }
    return s.file?.id ?? null;
  }

  // Past the lake bands, `water` and `lakes` share their lakes: { rivers, lakes } with the Natural
  // Earth lakes that are none of the GSHHG ones, then those. Null where either source is missing.
  async function reconciled(view) {
    const [w, g] = [await fromBands(view, setup('water')), await fromBands(view, setup('lakes'))];
    if (!w || !g) return null;
    const pieces = g.cells.flatMap(lakePieces);
    const nes = w.parts.flat().filter(isArea);
    const kept = nes.filter((f) => {
      const polys = featurePolygons(f),
        ne = { polys, box: boxOf(polys.map((p) => p[0])) };
      return !pieces.some((g) => sameLake(ne, g));
    });
    const gshhg = pieces.map(({ poly, m }) => lakeFeature(poly, m));
    return { rivers: w.parts.flat().filter((f) => !isArea(f)), lakes: [...kept, ...gshhg] };
  }

  // The band the view would ask for first, and the paths it needs, each with its bytes (null when
  // unknown). Past the lake bands `water` and `lakes` need the paths of both, as the reconciled
  // lakes read both.
  async function wants(view, layer) {
    const s = setup(layer);
    const [first] = await candidates(view, s);
    if (!first)
      return {
        band: s.file?.id ?? null,
        paths: new Map(s.wholePath === null ? [] : [[s.wholePath, s.file.bytes ?? null]]),
      };
    const of = (c) =>
      cellsAround(c.b, view, c.known).map((k) => [`${k}.json`, c.b.bytesPerCell ?? null]);
    const mate = layer === 'water' ? 'lakes' : layer === 'lakes' ? 'water' : null;
    const hasWater = layer === 'water' || (await candidates(view, setup('water'))).length > 0;
    const other = mate && hasWater ? (await candidates(view, setup(mate)))[0] : null;
    return { band: first.b.id, paths: new Map([...of(first), ...(other ? of(other) : [])]) };
  }

  async function* features(view, layer) {
    if (layer === 'water' || layer === 'lakes') {
      const r = await reconciled(view);
      if (r) {
        if (layer === 'water') yield* r.rivers;
        yield* r.lakes;
        return;
      }
    }
    for (const part of await draw(view, setup(layer))) yield* part;
  }

  async function loaded(view, layer) {
    return [...(await wants(view, layer)).paths.keys()].every((p) => got.has(p));
  }

  async function pending(view, layer) {
    const { band, paths } = await wants(view, layer);
    const todo = [...paths].filter(([p]) => !got.has(p));
    const known = todo.every(([, n]) => n !== null);
    return { band, cells: todo.length, bytes: known ? todo.reduce((t, [, n]) => t + n, 0) : null };
  }

  return {
    features,
    async *rings(view, layer) {
      for await (const f of features(view, layer)) yield* geojsonRings(f);
    },
    async *polygons(view, layer) {
      for await (const f of features(view, layer)) yield* featurePolygons(f);
    },
    loaded,
    pending,
    bandFor,
    /** @deprecated Use `loaded`. */
    held(view, layer) {
      warnOnce('held', 'loaded');
      return loaded(view, layer);
    },
    /** @deprecated Use `pending`. */
    cost(view, layer) {
      warnOnce('cost', 'pending');
      return pending(view, layer);
    },
  };
}

const warned = new Set();
function warnOnce(old, now) {
  if (warned.has(old)) return;
  warned.add(old);
  console.warn(`coastlines provider: \`${old}\` is deprecated, use \`${now}\``);
}
