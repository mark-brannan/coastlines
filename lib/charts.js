// The charts: which ids a Web Mercator plotter sees as one tickable layer, and
// the zoom range each layer is drawn at. The styles in styles/ and, later, the
// plugin's tile cutter both read this table, so a layer outside its range is
// neither styled nor cut.
import { createRequire } from 'node:module'
import { find } from './catalogue.js'

const require = createRequire(import.meta.url)

/** The parsed charts.json: one entry per chart, in the order a plotter lists them. */
export const charts = require('../charts.json')

/** The chart with this id, or `undefined`. */
export const chart = (id) => charts.find((entry) => entry.id === id)

/**
 * The catalogue entries of a chart drawn at a zoom, with their layer name.
 * MVT layer names drop the scale -- `coastline`, not `ne-coastline-50m` -- so a
 * consumer written against one chart reads any.
 */
export function layersAt(chartId, zoom) {
  const entry = chart(chartId)
  if (!entry) return []
  return entry.layers
    .filter(({ minzoom, maxzoom }) => zoom >= minzoom && zoom <= maxzoom)
    .map((layer) => ({ ...layer, entry: find(layer.id) }))
}
