// The Pages demo: one MapLibre map, the three default charts as toggles. Each
// chart's style is the file the plugin serves; here its one vector source is
// replaced with a GeoJSON source per layer, which is the only change, so what
// the page shows is the style as authored.

const charts = await (await fetch('charts.json')).json()
const DEFAULT_ON = new Set(['ne-50m'])

/** A chart's style, every layer re-pointed at its GeoJSON file. */
async function geojsonStyle(chart) {
  const style = await (await fetch(`styles/${chart.id}.json`)).json()
  const sources = {}
  const layers = style.layers.map((layer) => {
    const cut = chart.layers.find((entry) => entry.name === layer['source-layer'])
    const source = `${chart.id}:${cut.id}`
    sources[source] = { type: 'geojson', data: `data/${cut.id}.geojson` }
    const { 'source-layer': _dropped, ...rest } = layer
    return { ...rest, id: `${chart.id}:${layer.id}`, source, layout: { ...(layer.layout ?? {}), visibility: DEFAULT_ON.has(chart.id) ? 'visible' : 'none' } }
  })
  return { sources, layers }
}

const parts = await Promise.all(charts.map(geojsonStyle))
const map = new maplibregl.Map({
  container: 'map',
  center: [-5, 45],
  zoom: 3,
  style: {
    version: 8,
    sources: Object.assign({}, ...parts.map((part) => part.sources)),
    layers: parts.flatMap((part) => part.layers),
  },
  attributionControl: { customAttribution: 'Natural Earth' },
})
map.addControl(new maplibregl.NavigationControl())

const panel = document.getElementById('charts')
for (const chart of charts) {
  const label = document.createElement('label')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = DEFAULT_ON.has(chart.id)
  box.addEventListener('change', () => {
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith(`${chart.id}:`)) map.setLayoutProperty(layer.id, 'visibility', box.checked ? 'visible' : 'none')
    }
  })
  label.append(box, ` ${chart.name} `, Object.assign(document.createElement('code'), { textContent: `z${chart.minzoom}–${chart.maxzoom}` }))
  label.title = chart.description
  panel.append(label)
}
const zoom = document.getElementById('zoom')
map.on('zoom', () => (zoom.textContent = map.getZoom().toFixed(1)))
map.on('load', () => (zoom.textContent = map.getZoom().toFixed(1)))
