// A reader for a polygon shapefile (.shp, shape type 5) held in memory, as
// ESRI's 1998 white paper lays it out: a 100-byte header, then records, each a
// big-endian number and length followed by little-endian content. Geometry
// only: the .dbf attributes and the .shx index are not read.
//
// A shapefile ring runs clockwise for an outer boundary and anticlockwise for
// a hole, and is stored closed, first point repeated last, which is also what
// GeoJSON wants. Rings come back as stored, so outer rings here are clockwise.

const FILE_CODE = 9994;
const POLYGON = 5;
const NULL_SHAPE = 0;
const HEADER = 100;

/** The signed area of a ring in coordinate units: positive anticlockwise, negative clockwise. */
export function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** Whether a point lies inside a ring, by ray casting; a point on the edge is indeterminate. */
function contains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The rings of one record grouped into polygons, `[outer, ...holes]`, each
 * hole with the outer that contains its first point. One outer, the common
 * case, takes every hole without a test.
 */
function polygonsOf(rings) {
  const outers = [];
  const holes = [];
  for (const ring of rings) (signedArea(ring) < 0 ? outers : holes).push(ring);
  if (outers.length === 0) return holes.length > 0 ? [holes] : []; // holes only: keep them as found
  const polygons = outers.map((outer) => [outer]);
  for (const hole of holes) {
    const home =
      outers.length === 1
        ? 0
        : Math.max(
            0,
            outers.findIndex((outer) => contains(outer, hole[0])),
          );
    polygons[home].push(hole);
  }
  return polygons;
}

/**
 * Every polygon in a .shp of shape type 5, as `[outerRing, ...holeRings]`,
 * each ring an array of closed `[lon, lat]` pairs. Null shapes are skipped.
 * Throws if the bytes are not a polygon shapefile.
 */
export function shapefilePolygons(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < HEADER || dv.getInt32(0, false) !== FILE_CODE) {
    throw new Error('not a shapefile: bad file code');
  }
  const length = dv.getInt32(24, false) * 2; // the header counts 16-bit words
  if (length !== bytes.byteLength) {
    throw new Error(`shapefile: header says ${length} bytes, got ${bytes.byteLength}`);
  }
  const type = dv.getInt32(32, true);
  if (type !== POLYGON) throw new Error(`shapefile: shape type ${type}, want ${POLYGON} (Polygon)`);

  const polygons = [];
  let at = HEADER;
  while (at + 8 <= length) {
    const contentLength = dv.getInt32(at + 4, false) * 2;
    const content = at + 8;
    at = content + contentLength;
    const shape = dv.getInt32(content, true);
    if (shape === NULL_SHAPE) continue;
    if (shape !== POLYGON) throw new Error(`shapefile: record of shape type ${shape}`);
    const numParts = dv.getInt32(content + 36, true);
    const numPoints = dv.getInt32(content + 40, true);
    const partsAt = content + 44;
    const pointsAt = partsAt + 4 * numParts;
    const rings = [];
    for (let part = 0; part < numParts; part += 1) {
      const first = dv.getInt32(partsAt + 4 * part, true);
      const last = part + 1 < numParts ? dv.getInt32(partsAt + 4 * (part + 1), true) : numPoints;
      if (last <= first) continue;
      const ring = new Array(last - first);
      for (let p = first; p < last; p += 1) {
        const at = pointsAt + 16 * p;
        ring[p - first] = [dv.getFloat64(at, true), dv.getFloat64(at + 8, true)];
      }
      const [x0, y0] = ring[0];
      const [xn, yn] = ring[ring.length - 1];
      if (x0 !== xn || y0 !== yn) ring.push([x0, y0]);
      rings.push(ring);
    }
    polygons.push(...polygonsOf(rings));
  }
  return polygons;
}
