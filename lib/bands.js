// The band catalogue: one record per geometry band the resources provider vends, read from
// catalogue.json (the manifest, by contrast, is the pins of the files the bands come from).
//
// A record's id is `<source>-<scale>-<layer>`: `ne-50m-coastline`, `gshhg-h-land`. One record
// stands for one data set, whatever forms it ships in, and an id it once went by stays in its
// `aliases`, so `band()` finds it by either.
//
// A record's `sources` say where its geometry can be fetched from, one `{ kind, url }` each (a
// `cells` source also carries the `cells`, `bytes`, `cutter` and `built` of its build, where the
// record ships a whole file too), so that new kinds of hosting can be added without renaming
// anything. Its `inputs` are the upstream
// files it owns, each exactly once across the catalogue: a manifest id (a pinned file),
// `{ source: 'gshhg', member }` (a member of the pinned zip) or `{ source: 'ne', name, sha256 }`
// (a Natural Earth file the manifest does not ship, pinned here). A cut band may also name the
// whole-file records it is cut `from`.
//
// `provenance.upstream`, `member` and `sha256` run parallel to those inputs: download
// `upstream[i]`, check it against `sha256[i]`, and take `member[i]` out of it when that is set.
import { createRequire } from 'node:module';
import { find, localPath, manifest, upstreamUrl } from './catalogue.js';
import { charts } from './charts.js';

const require = createRequire(import.meta.url);

/** What a cut band's `provenance.cutter` names: the module that builds its cells. */
export const CUTTER = 'coastlines/lib/cut.js';

/** The parsed catalogue.json: one record per band, whole Natural Earth files first. */
export const catalogue = require('../catalogue.json');

/** The record with this id or alias, or `undefined`. */
export const band = (id) =>
  catalogue.find((record) => record.id === id || record.aliases?.includes(id));

/** A record's `cells` source, or `undefined` when it ships no cells. */
export const cellsOf = (record) => record.sources.find((src) => src.kind === 'cells');

/**
 * What the build of a record's cells measured: `{ cells, bytes, cutter, built }`. A record that
 * ships a whole file as well keeps these on its `cells` source, where its own `bytes` are the
 * file's; a record of cells alone keeps them on itself and in `provenance`.
 */
export const builtOf = (record) => {
  const src = cellsOf(record) ?? {};
  return {
    cells: src.cells ?? record.cells,
    bytes: src.bytes ?? record.bytes,
    cutter: src.cutter ?? record.provenance.cutter,
    built: src.built ?? record.provenance.built,
  };
};

/** The manifest entry a record's whole file is, or `undefined` when it ships none. */
export const fileOf = (record) =>
  record.sources.some((src) => src.kind === 'file')
    ? find(record.inputs.find((input) => typeof input === 'string'))
    : undefined;

/**
 * What an input of a record should say upstream: `{ upstream, member, sha256 }`. `sha256` is the
 * hash of the download at `upstream` (the zip, for a member of one), null where only the record
 * can pin it.
 */
export function pinOf(input) {
  const entry = typeof input === 'string' ? find(input) : null;
  if (typeof input === 'string' && !entry) throw new Error(`${input}: not in the manifest`);
  const key = entry ? entry.source : input.source;
  const from = manifest.sources[key];
  if (!from) throw new Error(`unknown source ${key}`);
  const member = (entry ?? input).member ?? null;
  if (member) return { upstream: from.url, member, sha256: from.sha256 };
  if (entry) return { upstream: upstreamUrl(entry), member, sha256: entry.sha256 };
  return { upstream: new URL(input.name, from.base).href, member, sha256: input.sha256 ?? null };
}

/** Every input a record draws on, its own and those of the records it is cut `from`, in that order. */
export function inputsOf(record) {
  const own = record.inputs ?? [];
  const inherited = (record.from ?? []).flatMap((id) => inputsOf(band(id)));
  return [...own, ...inherited];
}

/** The source keys a record's geometry is built from; a geometry file must name exactly one. */
export const sourcesOf = (record) =>
  new Set(
    inputsOf(record).map((input) =>
      typeof input === 'string' ? find(input).source : input.source,
    ),
  );

/** The zoom range charts.json draws a whole file at, across every chart that lists it; nulls when none does. */
function chartZoom(id) {
  const layers = charts.flatMap((chart) => chart.layers).filter((layer) => layer.id === id);
  if (!layers.length) return { min: null, max: null };
  return {
    min: Math.min(...layers.map((layer) => layer.minzoom)),
    max: Math.max(...layers.map((layer) => layer.maxzoom)),
  };
}

/**
 * Where a record's whole file and the manifest entry and charts.json layers it copies disagree. The
 * zoom is the file's only where the record has no cells; with cells it is theirs.
 */
function wholeFileDrift(record) {
  const problems = [];
  const entry = fileOf(record);
  if (!entry) return [`${record.id}: a whole file not in the manifest`];
  if (record.bytes !== entry.bytes)
    problems.push(`${record.id}: bytes ${record.bytes} is not the manifest's ${entry.bytes}`);
  const zoom = chartZoom(entry.id);
  if (!record.grid && (record.zoom.min !== zoom.min || record.zoom.max !== zoom.max))
    problems.push(`${record.id}: zoom ${record.zoom.min}-${record.zoom.max} is not charts.json's`);
  const url = localPath(entry);
  if (!record.sources.some((src) => src.kind === 'file' && src.url === url))
    problems.push(`${record.id}: sources do not name ${url}`);
  return problems;
}

/** A record with cells names its cutter and the day it was built. */
function cutDrift(record) {
  const problems = [];
  const { cutter, built } = builtOf(record);
  if (cutter !== CUTTER) problems.push(`${record.id}: cutter ${cutter} is not ${CUTTER}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(built ?? ''))
    problems.push(`${record.id}: built ${built} is not a date`);
  return problems;
}

/**
 * Where the catalogue and the manifest disagree, as sentences; empty when they agree. Every
 * record's upstream URLs, members and sha256s must be what its inputs pin, its licence, version
 * and date those of its upstream, a whole file's bytes and zoom what the manifest and charts.json
 * say, and every manifest file must be owned by exactly one record.
 */
export function drift() {
  const problems = [];
  const owners = new Map(manifest.files.map((entry) => [entry.id, []]));
  for (const record of catalogue) {
    for (const input of record.inputs)
      if (typeof input === 'string') owners.get(input)?.push(record.id);
    try {
      const inputs = inputsOf(record);
      const pins = inputs.map(pinOf);
      const { licence, version, date } = record.provenance;
      for (const field of ['upstream', 'member', 'sha256']) {
        const want = JSON.stringify(pins.map((pin) => pin[field]));
        if (JSON.stringify(record.provenance[field]) !== want)
          problems.push(`${record.id}: ${field} differs from its inputs`);
      }
      const keys = sourcesOf(record);
      if (keys.size !== 1)
        problems.push(
          `${record.id}: built from ${keys.size} sources (${[...keys].join(', ')}), not one; each licence stays in its own file`,
        );
      for (const key of keys) {
        const from = manifest.sources[key];
        if (licence !== from.licence)
          problems.push(`${record.id}: licence ${licence} is not ${key}'s ${from.licence}`);
        if (version !== (from.ref ?? from.version))
          problems.push(`${record.id}: version ${version} is not ${key}'s`);
        if (date !== from.date) problems.push(`${record.id}: date ${date} is not ${key}'s`);
      }
      if (record.sources.some((src) => src.kind === 'file'))
        problems.push(...wholeFileDrift(record));
      if (cellsOf(record)) problems.push(...cutDrift(record));
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
