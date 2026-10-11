// The catalogue: what this package ships, read from manifest.json.
//
// Every consumer -- the sync script, the renderers, the tests and later the
// Signal K plugin -- goes through here rather than reading the manifest or
// guessing a path, so the layout of data/ is decided in exactly one place.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** The parsed manifest. `source` is the pinned upstream; `files` one entry per shipped id. */
export const manifest = require('../manifest.json')

/** The Natural Earth file name an entry came from, e.g. `ne_50m_coastline.geojson`. */
export const upstreamName = ({ layer, scale }) => `ne_${scale}_${layer}.geojson`

/** The URL an entry is fetched from, pinned to the manifest's ref. */
export const upstreamUrl = (entry) => new URL(upstreamName(entry), manifest.source.base).href

/** Where an entry lives on disk once synced: `data/<id>.geojson`, relative to the package root. */
export const localPath = ({ id }) => `data/${id}.geojson`

/** The file URL of an entry on disk, for `readFile`. */
export const localUrl = (entry) => new URL(`../${localPath(entry)}`, import.meta.url)

/** The entry for an id, or `undefined`: a provider rejects ids it does not own. */
export const find = (id) => manifest.files.find((entry) => entry.id === id)

/** Every id, in manifest order. */
export const ids = () => manifest.files.map((entry) => entry.id)

/** The entries of one scale: `'10m'`, `'50m'` or `'110m'`. */
export const atScale = (scale) => manifest.files.filter((entry) => entry.scale === scale)
