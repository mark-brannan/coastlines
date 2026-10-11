import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawCollection, equirectangular } from '../lib/draw.js'

/** A 2D context that records what was asked of it. */
function recorder() {
  const calls = []
  const record = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    beginPath: record('beginPath'), moveTo: record('moveTo'), lineTo: record('lineTo'),
    fill: record('fill'), stroke: record('stroke'), arc: record('arc'),
  }
}

const collection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]], [[2, 2], [4, 2], [2, 4], [2, 2]]] } },
    { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[-180, 0], [180, 0]], [[0, -90], [0, 90]]] } },
    { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[0, 0], [90, 45]] } },
    { type: 'Feature', geometry: null },
  ],
}

test('equirectangular maps the corners and the origin', () => {
  const project = equirectangular(360, 180)
  assert.deepEqual(project([-180, 90]), [0, 0])
  assert.deepEqual(project([180, -90]), [360, 180])
  assert.deepEqual(project([0, 0]), [180, 90])
})

test('polygons fill even-odd and stroke, lines stroke, points become dots, null geometry is skipped', () => {
  const ctx = recorder()
  drawCollection(ctx, collection, equirectangular(360, 180), { fill: '#eee', stroke: '#333', radius: 2 })
  const names = ctx.calls.map(([name]) => name)
  assert.equal(names.filter((name) => name === 'fill' ).length, 1 + 2, 'one polygon fill, two dots')
  assert.deepEqual(ctx.calls.find(([name]) => name === 'fill'), ['fill', 'evenodd'])
  assert.equal(names.filter((name) => name === 'stroke').length, 2, 'the polygon and the multiline')
  assert.equal(names.filter((name) => name === 'moveTo').length, 2 + 2, 'two rings, two lines')
  assert.equal(names.filter((name) => name === 'arc').length, 2)
  assert.deepEqual(ctx.calls.find(([name]) => name === 'arc').slice(1, 4), [180, 90, 2])
})

test('without a fill, polygons only stroke', () => {
  const ctx = recorder()
  drawCollection(ctx, collection, equirectangular(360, 180), { stroke: '#333' })
  assert.ok(!ctx.calls.some(([name, rule]) => name === 'fill' && rule === 'evenodd'))
})
