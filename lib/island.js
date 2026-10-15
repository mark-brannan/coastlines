// What the land treatments need to know about an island: its area in km2 and a colour that stays
// with it. Computed once per land polygon, from the whole polygon (so before lib/detail-cells.js
// cuts it into cells, which carry the result along), and shared by the scene and the cutter.

export const ISLAND_KM2 = 5000; // coloured islands are the land polygons smaller than this
export const ISLAND_HUES = 3; // red, green, gold

const R_KM = 6371.0088,
  RAD = Math.PI / 180;

// Area of a [lon, lat] ring (open or closed) in km2: equirectangular about the ring's own latitude,
// good to a percent or two at this size.
function ringKm2(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length,
    lon0 = ring[0][0],
    c = Math.cos(lat0 * RAD);
  const pt = ([lon, lat]) => [(((lon - lon0 + 540) % 360) - 180) * c, lat];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = pt(ring[i]),
      [x2, y2] = pt(ring[(i + 1) % ring.length]);
    s += x1 * y2 - x2 * y1;
  }
  return (Math.abs(s) / 2) * (R_KM * RAD) ** 2;
}

// { km2, hue } of a polygon [outer, ...holes]. The hue comes from the centre of the outer ring's
// box, to a tenth of a degree: the same island has the same colour in every view and, to within a
// tenth of a degree of disagreement between data sets, at every zoom.
export function islandInfo(poly) {
  const km2 = Math.round(ringKm2(poly[0]) - poly.slice(1).reduce((s, r) => s + ringKm2(r), 0));
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const lon0 = poly[0][0][0];
  for (const [lon, lat] of poly[0]) {
    const x = ((lon - lon0 + 540) % 360) - 180;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (lat < y0) y0 = lat;
    if (lat > y1) y1 = lat;
  }
  let h =
    Math.imul(Math.round((lon0 + (x0 + x1) / 2) * 10), 0x9e3779b1) ^
    Math.imul(Math.round((y0 + y1) * 5), 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return { km2, hue: (h >>> 0) % ISLAND_HUES };
}
