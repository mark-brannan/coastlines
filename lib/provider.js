// The scene's data side: which band a view draws from, which of its cells, and what it falls back
// to. A drawing library pulls rings from here through its port, an async iterable of rings, so
// neither package imports the other; the caller owns the projection and hands over a view.
//
// A view is the lon/lat frame a caller paints and its scale at the centre:
// `{ lat, metresPerPixel, lonMin, lonMax, latMin, latMax }`. The frame may run past the
// antimeridian. The catalogue keys bands by web-mercator zoom (a 512 px world at zoom 0), so the
// scale is turned into that zoom at the view's latitude to choose one.
//
// A band of cells keeps `<dir>/<xi>_<yi>.json`, `grid.cellDeg` degrees square, each
// `{ land, coast }`, and `<dir>/index.json`, `{ cell, cells }`, listing the cells that hold
// anything, under its `cells` source. A view draws from the finest band whose zoom it has passed,
// over the cells within `grid.marginDeg` of its frame. For that view, a band whose index cannot be
// read is skipped, and a band with a cell that cannot be read gives way to the band below it; the
// last of these is the whole file. Both are read again for the next view.
// The JSON itself, not lib/bands.js, so the provider runs in a browser too.
import catalogue from '../catalogue.json' with { type: 'json' };

const EARTH_R = 6378137; // metres, web mercator's sphere
const WORLD_PX = 512; // the width of the world at zoom 0, as the catalogue's zooms count it
const RAD = Math.PI / 180;

/** The web-mercator zoom of a view's scale at its centre. */
// Rounded, so a view at a band's edge zoom, turned into a scale and back, does not pass it.
export const zoomOf = (view) =>
  Math.round(
    1e9 *
      Math.log2(
        (2 * Math.PI * EARTH_R * Math.cos(view.lat * RAD)) / (WORLD_PX * view.metresPerPixel),
      ),
  ) / 1e9;

// What each kind of ring is read from: the bands are cut from both, and a cell carries both.
const KINDS = {
  coast: { layer: 'land', part: 'coast', whole: 'ne-coastline-50m' },
  land: { layer: 'land', part: 'land', whole: 'ne-land-50m' },
};

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

/**
 * A provider of rings for views. `read(path)` resolves to the parsed JSON at a catalogue source
 * path (`geo/h/12_45.json`, `data/ne-coastline-50m.geojson`) and rejects when it cannot. `kind`
 * is `coast`, the coastline's lines, or `land`, the land polygons' rings.
 *
 * `rings(view)` yields the view's rings; `loaded(view)` says whether they are all in hand, so
 * drawing them fetches nothing; `pending(view)` is what drawing it would fetch: the band, the cells
 * not yet loaded, and their bytes where the catalogue knows them. `held` and `cost` are the old
 * names of those two.
 */
export function provider({ read, kind = 'coast' }) {
  const { layer, part, whole } = KINDS[kind] ?? {};
  if (!layer) throw new Error(`unknown kind ${kind}`);
  const bands = catalogue
    .filter((r) => r.layer === layer && r.grid)
    .map(bandOf)
    .sort((a, b) => a.zoom - b.zoom);
  const file = catalogue.find((r) => r.id === whole);
  const wholePath = file.sources.find((s) => s.kind === 'file').url;

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

  const inflight = new Map(); // path -> promise of its rings
  const got = new Map(); // path -> its rings, once read
  const fetch = (path, ringsOf) => {
    if (!inflight.has(path))
      inflight.set(
        path,
        read(path).then(
          (json) => {
            const rings = ringsOf(json);
            got.set(path, rings);
            return rings;
          },
          (e) => {
            inflight.delete(path); // a failed read is tried again for the next view
            throw e;
          },
        ),
      );
    return inflight.get(path);
  };
  const cellRings = (cell) => (part === 'land' ? cell.land.flat() : cell.coast);

  // The bands the view may draw from, finest first, each with its index: passed, with an index.
  async function candidates(view) {
    const zoom = zoomOf(view);
    const all = bands.filter((b) => passed(zoom, b));
    const known = await Promise.all(all.map(loadIndex));
    return all
      .map((b, i) => ({ b, known: known[i] }))
      .filter((c) => c.known !== null)
      .reverse();
  }

  // What the view draws from: the finest candidate band with every cell it needs read, else the
  // whole file.
  async function draw(view) {
    for (const { b, known } of await candidates(view)) {
      const keys = cellsAround(b, view, known);
      try {
        const parts = await Promise.all(keys.map((k) => fetch(`${k}.json`, cellRings)));
        return { band: b.id, parts };
      } catch {
        // a cell it lacks: the band below draws the whole view, rather than leave a hole
      }
    }
    return { band: file.id, parts: [await fetch(wholePath, geojsonRings)] };
  }

  // The band the view would ask for first, and the paths it needs.
  async function wants(view) {
    const [first] = await candidates(view);
    if (!first) return { band: file.id, paths: [wholePath], bytes: () => file.bytes };
    const { b, known } = first;
    const paths = cellsAround(b, view, known).map((k) => `${k}.json`);
    return {
      band: b.id,
      paths,
      bytes: (n) => (b.bytesPerCell == null ? null : n * b.bytesPerCell),
    };
  }

  async function loaded(view) {
    return (await wants(view)).paths.every((p) => got.has(p));
  }

  async function pending(view) {
    const { band, paths, bytes } = await wants(view);
    const cells = paths.filter((p) => !got.has(p)).length;
    return { band, cells, bytes: cells ? bytes(cells) : 0 };
  }

  return {
    async *rings(view) {
      for (const p of (await draw(view)).parts) yield* p;
    },
    loaded,
    pending,
    /** @deprecated Use `loaded`. */
    held(view) {
      warnOnce('held', 'loaded');
      return loaded(view);
    },
    /** @deprecated Use `pending`. */
    cost(view) {
      warnOnce('cost', 'pending');
      return pending(view);
    },
  };
}

const warned = new Set();
function warnOnce(old, now) {
  if (warned.has(old)) return;
  warned.add(old);
  console.warn(`coastlines provider: \`${old}\` is deprecated, use \`${now}\``);
}
