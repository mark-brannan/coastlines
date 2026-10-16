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
// `{ land, coast }` (land and lakes) or `{ rivers, lakes }` (water), and `<dir>/index.json`, `{ cell, cells }`, listing the cells that hold
// anything, under its `cells` source. A view draws from the finest band whose zoom it has passed,
// over the cells within `grid.marginDeg` of its frame. For that view, a band whose index cannot be
// read is skipped, and a band with a cell that cannot be read gives way to the band below it; the
// last of these is the whole file. Both are read again for the next view.
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
// rings, the outer ring first and its holes after, so a Feature keeps them.
const polygonFeatures = (polys) =>
  (polys ?? []).map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates },
  }));
const lineFeatures = (lines) =>
  (lines ?? []).map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  }));
const LAYERS = {
  coastline: { cells: 'land', whole: 'ne-50m-coastline', of: (c) => lineFeatures(c.coast) },
  land: { cells: 'land', whole: 'ne-50m-land', of: (c) => polygonFeatures(c.land) },
  lakes: { cells: 'lakes', whole: 'ne-50m-lakes', of: (c) => polygonFeatures(c.land) },
  water: {
    cells: 'water',
    whole: 'ne-50m-rivers-lake-centerlines',
    of: (c) => [...(c.rivers?.features ?? []), ...(c.lakes?.features ?? [])],
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

/**
 * A provider of GeoJSON for views. `read(path)` resolves to the parsed JSON at a catalogue source
 * path (`geo/h/12_45.json`, `data/ne-coastline-50m.geojson`) and rejects when it cannot.
 *
 * `layer` names one of the catalogue's layers: `coastline`, `land`, `lakes` or `water`.
 *
 * `features(view, layer)` yields the view's GeoJSON Features: Polygon or MultiPolygon for the area
 * layers with their interior rings (holes) kept, LineString or MultiLineString for the line
 * layers. `rings(view, layer)` yields every ring of those, outer and holes flattened into one
 * stream, as a drawing port pulls; `polygons(view, layer)` yields each polygon as an array of
 * rings, outer first, for a fill that must tell an island from a lake.
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
  const loadIndex = (b) => {
    if (!index.has(b.dir))
      index.set(
        b.dir,
        read(`${b.dir}/index.json`).then(
          (i) => new Set(i.cells),
          () => {
            index.delete(b.dir); // skipped for this view, tried again for the next
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
      const file = catalogue.find((r) => r.id === spec.whole);
      const wholePath = file.sources.find((s) => s.kind === 'file').url;
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

  // What the view draws from: the finest candidate band with every cell it needs read, else the
  // whole file. Each part is a list of Features.
  async function draw(view, s) {
    for (const { b, known } of await candidates(view, s)) {
      const keys = cellsAround(b, view, known);
      try {
        const cells = await Promise.all(keys.map((k) => fetch(`${k}.json`)));
        return cells.map(s.spec.of);
      } catch {
        // a cell it lacks: the band below draws the whole view, rather than leave a hole
      }
    }
    return [geojsonFeatures(await fetch(s.wholePath))];
  }

  // The band the view would ask for first, and the paths it needs.
  async function wants(view, s) {
    const [first] = await candidates(view, s);
    if (!first) return { band: s.file.id, paths: [s.wholePath], bytes: () => s.file.bytes };
    const { b, known } = first;
    const paths = cellsAround(b, view, known).map((k) => `${k}.json`);
    return {
      band: b.id,
      paths,
      bytes: (n) => (b.bytesPerCell == null ? null : n * b.bytesPerCell),
    };
  }

  async function* features(view, layer) {
    for (const part of await draw(view, setup(layer))) yield* part;
  }

  async function loaded(view, layer) {
    return (await wants(view, setup(layer))).paths.every((p) => got.has(p));
  }

  async function pending(view, layer) {
    const { band, paths, bytes } = await wants(view, setup(layer));
    const cells = paths.filter((p) => !got.has(p)).length;
    return { band, cells, bytes: cells ? bytes(cells) : 0 };
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
