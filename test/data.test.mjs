import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

// These tests decode the shipped data with their own nine-line decoder rather
// than importing portolani's. The point of the split is that the format is a
// spec: if the only thing that can read this package is the thing that wrote
// it, the spec is not being tested.

const dataDir = new URL('../data/', import.meta.url)
const files = (await readdir(dataDir)).filter((name) => name.endsWith('.json'))
const load = async (name) => JSON.parse(await readFile(new URL(name, dataDir), 'utf8'))
const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/portolano-fixtures.json', import.meta.url), 'utf8')
)

/** docs/portolano-format.md §3, written from the spec. */
function decode(encoded, precision) {
  const scale = Math.pow(10, precision)
  const points = []
  let index = 0
  let x = 0
  let y = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0
      let bits = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        bits |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = bits & 1 ? ~(bits >> 1) : bits >> 1
      if (axis === 0) x += delta
      else y += delta
    }
    points.push([x / scale, y / scale])
  }
  return points
}

const rings = (portolano) =>
  portolano.kind === 'polygons' ? portolano.geometry.flat() : portolano.geometry

test('every profile is a portolano/1 document', async () => {
  assert.ok(files.length > 0)
  for (const name of files) {
    const portolano = await load(name)
    assert.equal(portolano.format, 'portolano/1', name)
    assert.equal(portolano.encoding.order, 'lon,lat', name)
    assert.match(portolano.digest, /^sha256:[0-9a-f]{64}$/, name)
  }
})

test('every profile carries the provenance to regenerate it', async () => {
  for (const name of files) {
    const { provenance } = await load(name)
    assert.equal(provenance.generator.name, 'portolani', name)
    assert.match(provenance.source.url, /^https:\/\//, name)
    assert.match(provenance.source.ref, /^v\d+\.\d+/, `${name} pins a release, not a branch`)
    assert.match(provenance.source.sha256, /^sha256:[0-9a-f]{64}$/, name)
    for (const knob of ['kind', 'tolerance', 'precision', 'minExtent']) {
      assert.notEqual(provenance.options[knob], undefined, `${name} records ${knob}`)
    }
  }
})

test('the digest of every profile is the digest of its geometry', async () => {
  for (const name of files) {
    const portolano = await load(name)
    const digest =
      'sha256:' + createHash('sha256').update(JSON.stringify(portolano.geometry)).digest('hex')
    assert.equal(digest, portolano.digest, name)
  }
})

test('decoding reproduces the declared counts and bounds', async () => {
  for (const name of files) {
    const portolano = await load(name)
    const decoded = rings(portolano).map((ring) => decode(ring, portolano.encoding.precision))
    assert.equal(decoded.length, portolano.counts.rings, `${name} rings`)
    assert.equal(
      decoded.reduce((total, ring) => total + ring.length, 0),
      portolano.counts.points,
      `${name} points`
    )
    const flat = decoded.flat()
    const box = [
      Math.min(...flat.map((p) => p[0])),
      Math.min(...flat.map((p) => p[1])),
      Math.max(...flat.map((p) => p[0])),
      Math.max(...flat.map((p) => p[1])),
    ]
    assert.deepEqual(box.map((v) => Number(v.toFixed(6))), portolano.bounds, `${name} bounds`)
  }
})

test('coordinates are on the planet, in lon,lat order', async () => {
  for (const name of files) {
    const portolano = await load(name)
    for (const [lon, lat] of decode(rings(portolano)[0], portolano.encoding.precision)) {
      assert.ok(lon >= -180 && lon <= 180, `${name} lon ${lon}`)
      assert.ok(lat >= -90 && lat <= 90, `${name} lat ${lat}`)
    }
  }
})

test('every polygon ring is closed and fillable', async () => {
  for (const name of files) {
    const portolano = await load(name)
    if (portolano.kind !== 'polygons') continue
    for (const polygon of portolano.geometry) {
      for (const ring of polygon) {
        const points = decode(ring, portolano.encoding.precision)
        assert.ok(points.length >= 4, name)
        assert.deepEqual(points[0], points[points.length - 1], name)
      }
    }
  }
})

test('the fixtures describe the files that are actually shipped', async () => {
  assert.equal(fixtures.format, 'portolano-fixtures/1')
  assert.equal(fixtures.documents.length, files.length)
  for (const document of fixtures.documents) {
    const portolano = await load(document.path)
    assert.equal(document.digest, portolano.digest, document.path)
    assert.deepEqual(document.counts, portolano.counts, document.path)
    const first = decode(rings(portolano)[0], portolano.encoding.precision).slice(0, 3)
    assert.deepEqual(first, document.firstPoints, document.path)
  }
})

test('the fixture vectors round-trip through an independent decoder', () => {
  for (const vector of fixtures.vectors) {
    assert.deepEqual(decode(vector.encoded, vector.precision), vector.degrees, vector.name)
  }
})
