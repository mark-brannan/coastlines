#!/usr/bin/env node
// Regenerates every profile in data/. Needs the network; run by hand when a
// profile changes or Natural Earth cuts a release, and commit the result.
//
// There is deliberately no bespoke generation logic here. Everything this
// script knows is which knobs each profile uses -- portolani does the rest,
// and stamps those knob values into each file so this script is not the only
// record of them.
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { buildPortolano, buildFixtures, loadSource, resolveSource } from 'portolani'

const require = createRequire(import.meta.url)
const generator = {
  name: 'portolani',
  version: require('portolani/package.json').version,
}

/** One entry per shipped file. Adding a profile means adding a line here. */
const PROFILES = [
  {
    file: 'coastline-110m.json',
    note: 'Annotation grade: finer than any global data grid drawn under it.',
    source: 'ne_110m_coastline',
    options: { kind: 'lines', tolerance: 0.25, precision: 1, minExtent: 1 },
  },
  {
    file: 'coastline-50m.json',
    note: 'A world map the reader looks at rather than through.',
    source: 'ne_50m_coastline',
    options: { kind: 'lines', tolerance: 0.1, precision: 2, minExtent: 0.5 },
  },
  {
    file: 'land-110m.json',
    note: 'The same coarse world, fillable: outer rings and holes kept.',
    source: 'ne_110m_land',
    options: { kind: 'polygons', tolerance: 0.25, precision: 1, minExtent: 1 },
  },
]

const built = []
for (const profile of PROFILES) {
  const source = resolveSource(profile.source)
  const { geojson, sha256, bytes } = await loadSource(source)
  const portolano = buildPortolano({
    geojson,
    source: { ...source, sha256, bytes },
    options: profile.options,
    generator,
  })
  const path = new URL(`../data/${profile.file}`, import.meta.url)
  await writeFile(path, JSON.stringify(portolano) + '\n')
  built.push({ path: profile.file, portolano })
  const { shapes, points } = portolano.counts
  process.stderr.write(`${profile.file}: ${shapes} shapes, ${points} points\n`)
}

await writeFile(
  new URL('../fixtures/portolano-fixtures.json', import.meta.url),
  JSON.stringify(buildFixtures(built, { generator }), null, 2) + '\n'
)
