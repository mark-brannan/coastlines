// The catalogue: what this package ships, read from manifest.json.
//
// Every consumer -- the sync script, the renderers, the tests and later the
// Signal K plugin -- goes through here rather than reading the manifest or
// guessing a path, so the layout of data/ is decided in exactly one place.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The parsed manifest. `sources` is the pinned upstreams keyed by short name
 * (`ne`, `gshhg`); `files` one entry per shipped id, each naming its source.
 */
export const manifest = require('../manifest.json');

/** The source an entry comes from: the `sources` object it names. */
export const source = (entry) => manifest.sources[entry.source];

/** An entry's on-disk format: `'geojson'` unless the manifest says `'shp'` or `'txt'`. */
export const format = (entry) => entry.format ?? 'geojson';

/**
 * The upstream file name: for Natural Earth `ne_50m_coastline.geojson`; for a
 * member of a zip, its path inside the archive.
 */
export const upstreamName = (entry) => entry.member ?? `ne_${entry.scale}_${entry.layer}.geojson`;

/**
 * The URL an entry is fetched from, pinned. A Natural Earth file has one of its
 * own; a zip member comes from the zip, and `upstreamName` says which member.
 */
export const upstreamUrl = (entry) => {
  const from = source(entry);
  return from.url ?? new URL(upstreamName(entry), from.base).href;
};

/** Where an entry lives on disk once synced: `data/<id>.<format>`, relative to the package root. */
export const localPath = (entry) => `data/${entry.id}.${format(entry)}`;

/** The file URL of an entry on disk, for `readFile`. */
export const localUrl = (entry) => new URL(`../${localPath(entry)}`, import.meta.url);

/** The entry for an id, or `undefined`: a provider rejects ids it does not own. */
export const find = (id) => manifest.files.find((entry) => entry.id === id);

/** Every id, in manifest order. */
export const ids = () => manifest.files.map((entry) => entry.id);

/** The entries of one scale: Natural Earth's `'10m'`, `'50m'`, `'110m'`, or GSHHG's `'h'`. */
export const atScale = (scale) => manifest.files.filter((entry) => entry.scale === scale);
