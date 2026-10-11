import { test } from 'node:test'
import assert from 'node:assert/strict'
import { charts, chart, layersAt } from '../lib/charts.js'
import { find } from '../lib/catalogue.js'

test('the three default charts exist, in plotter order', () => {
  assert.deepEqual(
    charts.map((entry) => entry.id),
    ['ne-110m', 'ne-50m', 'ne-coastline-10m']
  )
})

test('every chart layer is a catalogue id at one scale, named without it', () => {
  for (const entry of charts) {
    const scales = new Set()
    for (const layer of entry.layers) {
      const file = find(layer.id)
      assert.ok(file, `${entry.id}: ${layer.id} is in the manifest`)
      assert.equal(layer.name, file.layer, `${entry.id}: MVT layer name is the Natural Earth layer`)
      scales.add(file.scale)
    }
    assert.equal(scales.size, 1, `${entry.id} draws one scale`)
    assert.equal(new Set(entry.layers.map((layer) => layer.name)).size, entry.layers.length, 'layer names unique')
  }
})

test('zoom ranges nest inside the chart and are integers', () => {
  for (const entry of charts) {
    assert.ok(Number.isInteger(entry.minzoom) && Number.isInteger(entry.maxzoom))
    assert.ok(entry.minzoom <= entry.maxzoom, entry.id)
    for (const layer of entry.layers) {
      assert.ok(Number.isInteger(layer.minzoom) && Number.isInteger(layer.maxzoom), `${entry.id}/${layer.name}`)
      assert.ok(layer.minzoom >= entry.minzoom && layer.maxzoom <= entry.maxzoom, `${entry.id}/${layer.name} inside the chart`)
      assert.ok(layer.minzoom <= layer.maxzoom, `${entry.id}/${layer.name}`)
    }
  }
})

test('the 10m coastline chart is what distance-to-shore reads: layer `coastline`, z0-12', () => {
  const entry = chart('ne-coastline-10m')
  assert.deepEqual(entry.layers.map((layer) => layer.name), ['coastline'])
  assert.equal(entry.minzoom, 0)
  assert.equal(entry.maxzoom, 12)
})

test('layersAt drops a layer outside its zoom range and resolves the file', () => {
  const atZero = layersAt('ne-50m', 0).map((layer) => layer.name)
  assert.ok(atZero.includes('coastline'))
  assert.ok(!atZero.includes('populated_places'), 'places wait for zoom 3')
  const atSeven = layersAt('ne-50m', 7)
  assert.equal(atSeven.length, chart('ne-50m').layers.length, 'everything at the top zoom')
  assert.equal(atSeven[0].entry.scale, '50m')
  assert.deepEqual(layersAt('ne-50m', 8), [], 'past the chart')
  assert.deepEqual(layersAt('no-such-chart', 0), [])
})
