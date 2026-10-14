import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapefilePolygons, signedArea } from '../lib/shapefile.js';

// A .shp built here from the white paper: header, then records with
// big-endian framing and little-endian content.

/** A polygon shapefile of `records`, each an array of rings (arrays of [x, y]) or null. */
function buildShp(records) {
  const contents = records.map((rings) => {
    if (rings === null) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, 0, true);
      return buf;
    }
    const points = rings.flat();
    const buf = new ArrayBuffer(44 + 4 * rings.length + 16 * points.length);
    const dv = new DataView(buf);
    dv.setInt32(0, 5, true);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) =>
      dv.setFloat64(4 + 8 * i, v, true),
    );
    dv.setInt32(36, rings.length, true);
    dv.setInt32(40, points.length, true);
    let first = 0;
    rings.forEach((ring, i) => {
      dv.setInt32(44 + 4 * i, first, true);
      first += ring.length;
    });
    const at = 44 + 4 * rings.length;
    points.forEach(([x, y], i) => {
      dv.setFloat64(at + 16 * i, x, true);
      dv.setFloat64(at + 16 * i + 8, y, true);
    });
    return buf;
  });
  const total = 100 + contents.reduce((sum, c) => sum + 8 + c.byteLength, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, total / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, 5, true);
  let at = 100;
  contents.forEach((c, i) => {
    dv.setInt32(at, i + 1, false);
    dv.setInt32(at + 4, c.byteLength / 2, false);
    out.set(new Uint8Array(c), at + 8);
    at += 8 + c.byteLength;
  });
  return out;
}

// Clockwise, so an outer boundary; anticlockwise inside it, so a hole.
const outer = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];
const hole = [
  [2, 2],
  [4, 2],
  [4, 4],
  [2, 4],
  [2, 2],
];
const island = [
  [20, 20],
  [20, 21],
  [21, 21],
  [21, 20],
  [20, 20],
];

test('signed area is negative clockwise, positive anticlockwise', () => {
  assert.equal(signedArea(outer), -100);
  assert.equal(signedArea(hole), 4);
});

test('one record with an outer and a hole is one polygon of two rings, outer first', () => {
  const polygons = shapefilePolygons(buildShp([[hole, outer]]));
  assert.equal(polygons.length, 1);
  assert.deepEqual(polygons[0], [outer, hole]);
});

test('two outers in one record become two polygons; the hole goes to the outer that contains it', () => {
  const polygons = shapefilePolygons(buildShp([[island, outer, hole]]));
  assert.deepEqual(polygons, [[island], [outer, hole]]);
});

test('a record of only anticlockwise rings, a reversed writer, is one polygon per ring', () => {
  const polygons = shapefilePolygons(buildShp([[hole, [...island].reverse()]]));
  assert.deepEqual(polygons, [[hole], [[...island].reverse()]]);
});

test('null shapes are skipped and an unclosed ring is closed', () => {
  const open = outer.slice(0, -1);
  const polygons = shapefilePolygons(buildShp([null, [open], null]));
  assert.deepEqual(polygons, [[outer]]);
});

test('not a shapefile, a wrong shape type and a truncated file are refused', () => {
  assert.throws(() => shapefilePolygons(new Uint8Array(100)), /bad file code/);
  const lines = buildShp([[outer]]);
  new DataView(lines.buffer).setInt32(32, 3, true);
  assert.throws(() => shapefilePolygons(lines), /shape type 3/);
  assert.throws(() => shapefilePolygons(buildShp([[outer]]).subarray(0, 120)), /header says/);
});
