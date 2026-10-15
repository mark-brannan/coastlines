import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutCells, cutLakes } from '../lib/detail-cells.js';

const area = (ring) =>
  Math.abs(ring.slice(1).reduce((s, [x, y], i) => s + ring[i][0] * y - x * ring[i][1], 0)) / 2;

test('land spanning four cells is cut into four pieces with the same area', () => {
  const square = [
    [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
      [2, 2],
    ],
  ];
  const cells = cutCells({ land: [square], coast: [] }, 5);
  assert.deepEqual([...cells.keys()].sort(), ['0_0', '0_1', '1_0', '1_1']);
  const total = [...cells.values()].reduce(
    (s, c) => s + c.land.reduce((t, p) => t + area(p[0]), 0),
    0,
  );
  assert.equal(total, 36);
  for (const c of cells.values())
    for (const p of c.land) assert.deepEqual(p[0][0], p[0][p[0].length - 1]); // closed
});

test('a hole is cut with its polygon', () => {
  const holed = [
    [
      [1, 1],
      [9, 1],
      [9, 4],
      [1, 4],
      [1, 1],
    ],
    [
      [2, 2],
      [8, 2],
      [8, 3],
      [2, 3],
      [2, 2],
    ],
  ];
  const cells = cutCells({ land: [holed], coast: [] }, 5);
  for (const k of ['0_0', '1_0']) assert.equal(cells.get(k).land[0].length, 2);
});

test('a coast line crossing cells is split into pieces that share their end points', () => {
  const line = [
    [1, 1],
    [4, 1],
    [6, 1],
    [9, 1],
    [9, 9],
  ]; // a segment goes to the cell of its midpoint
  const cells = cutCells({ land: [], coast: [line] }, 5);
  assert.deepEqual(cells.get('0_0').coast, [
    [
      [1, 1],
      [4, 1],
    ],
  ]);
  assert.deepEqual(cells.get('1_0').coast, [
    [
      [4, 1],
      [6, 1],
      [9, 1],
    ],
  ]);
  assert.deepEqual(cells.get('1_1').coast, [
    [
      [9, 1],
      [9, 9],
    ],
  ]);
});

test('a lake across cells keeps its id and whole box in every piece, and its shore its id', () => {
  const lake = Object.assign(
    [
      [
        [2, 2],
        [8, 2],
        [8, 4],
        [2, 4],
        [2, 2],
      ],
      [
        [3, 3],
        [4, 3],
        [4, 3.5],
        [3, 3],
      ],
    ],
    { id: 7 },
  );
  const cells = cutLakes([lake], 5);
  assert.deepEqual([...cells.keys()].sort(), ['0_0', '1_0']);
  for (const c of cells.values()) {
    assert.deepEqual(c.m, [[7, 2, 2, 8, 4]]);
    assert.ok(c.coast.length && c.cm.every((id) => id === 7));
  }
  assert.equal(cells.get('0_0').land[0].length, 2); // the island, a hole
});
