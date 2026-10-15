// The band catalogue: one record per geometry band the resources provider vends, read from
// catalogue.json (the manifest, by contrast, is the pins of the files the bands come from).
//
// A record's `sources` are what it owns, each exactly once across the catalogue: a manifest id
// (a pinned file), `{ source: 'gshhg', member }` (a member of the pinned zip, so pinned by the
// zip's sha256) or `{ source: 'ne', name, sha256 }` (a Natural Earth file the manifest does not
// ship, pinned here). A cut band may also name the whole-file records it is cut `from`.
import { createRequire } from 'node:module';
import { find, manifest, upstreamUrl } from './catalogue.js';

const require = createRequire(import.meta.url);

/** The parsed catalogue.json: one record per band, whole Natural Earth files first. */
export const catalogue = require('../catalogue.json');

/** The record with this id, or `undefined`. */
export const band = (id) => catalogue.find((record) => record.id === id);

/** What a source of a record should say upstream: `{ upstream, sha256 }`, `sha256` null where only the record can pin it. */
export function pinOf(src) {
  if (typeof src === 'string') {
    const entry = find(src);
    if (!entry) throw new Error(`${src}: not in the manifest`);
    return { upstream: upstreamUrl(entry), sha256: entry.sha256 };
  }
  const from = manifest.sources[src.source];
  if (!from) throw new Error(`unknown source ${src.source}`);
  if (src.member) return { upstream: from.url, sha256: from.sha256 };
  return { upstream: new URL(src.name, from.base).href, sha256: src.sha256 ?? null };
}

/** Every source a record draws on, its own and those of the records it is cut `from`, in that order. */
export function sourcesOf(record) {
  const own = record.sources ?? [];
  const inherited = (record.from ?? []).flatMap((id) => sourcesOf(band(id)));
  return [...own, ...inherited];
}

/**
 * Where the catalogue and the manifest disagree, as sentences; empty when they agree. Every
 * record's upstream URLs and sha256s must be what its sources pin, its licence and version those
 * of its upstream, and every manifest file must be owned by exactly one record.
 */
export function drift() {
  const problems = [];
  const owners = new Map(manifest.files.map((entry) => [entry.id, []]));
  for (const record of catalogue) {
    for (const src of record.sources) if (typeof src === 'string') owners.get(src)?.push(record.id);
    try {
      const pins = sourcesOf(record).map(pinOf);
      const { upstream, sha256, licence, version } = record.provenance;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (
        !same(
          upstream,
          pins.map((p) => p.upstream),
        )
      )
        problems.push(`${record.id}: upstream differs from its sources`);
      if (
        !same(
          sha256,
          pins.map((p) => p.sha256),
        )
      )
        problems.push(`${record.id}: sha256 differs from its sources`);
      const keys = new Set(
        sourcesOf(record).map((src) => (typeof src === 'string' ? find(src).source : src.source)),
      );
      for (const key of keys) {
        const from = manifest.sources[key];
        if (licence !== from.licence)
          problems.push(`${record.id}: licence ${licence} is not ${key}'s ${from.licence}`);
        if (version !== (from.ref ?? from.version))
          problems.push(`${record.id}: version ${version} is not ${key}'s`);
      }
    } catch (error) {
      problems.push(`${record.id}: ${error.message}`);
    }
  }
  for (const [id, who] of owners) {
    if (who.length !== 1)
      problems.push(`${id}: owned by ${who.length} records (${who.join(', ') || 'none'}), not one`);
  }
  return problems;
}

export default catalogue;
