#!/usr/bin/env node
// Fetches every file in manifest.json from its pinned source into data/, and
// refuses any byte that disagrees with the manifest.
//
//   node scripts/sync.mjs            fetch what is missing, verify everything
//   node scripts/sync.mjs --check    verify only; exit 1 if anything is missing
//   node scripts/sync.mjs --refresh  fetch everything and rewrite the manifest's
//                                    bytes and sha256 from what arrived -- the
//                                    one way to move a pin; review the diff
//   node scripts/sync.mjs --no-cells the files only; build no cells (the tarball
//                                    ships none, and a build would stamp
//                                    catalogue.json away from the tagged one).
//                                    With --check it is prepack: verifies data/,
//                                    never downloads
//
// Two kinds of source. A Natural Earth entry is one file at one URL. A GSHHG
// entry is a member of the published zip: the zip (149 MB) is fetched once,
// only when a member or a cut band needs it, checked against the bytes and
// sha256 the manifest records for the zip itself, and each member is lifted out
// and checked against its own entry. Nothing of the zip touches the repository.
//
// Then the catalogue's cut bands (`cells` sources) are built into geo/ by
// lib/cut.js where a band's index.json is missing, and each band's
// provenance.built is stamped with the day; geo/gshhg-modified.txt names the
// GSHHG bands among them.
//
// cache/ (gitignored, not in the package) keeps the inputs that are pinned but
// never shipped -- the zip, and the Natural Earth files only a cut band draws
// on -- so the next run and CI's cache need not fetch them again. data/ holds
// the manifest's files alone: the package ships all of it, under a 30 MB cap.
//
// catalogue.json is checked against the manifest first (lib/bands.js drift): every record's
// upstream, member and sha256 must be what its inputs pin, so the two cannot drift.
//
// data/ is gitignored, so the manifest is the record: an entry's sha256 is the
// promise that `coastlines/data/<id>` is the published file, byte for byte.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { manifest, localUrl, source, upstreamUrl } from '../lib/catalogue.js';
import { catalogue, drift, pinOf } from '../lib/bands.js';
import {
  cellsDir,
  cutBand,
  modifiedGshhg,
  modifiedNotice,
  stampBuilt,
  writeBand,
} from '../lib/cut.js';
import { digest, verify } from '../lib/verify.js';
import { zipMember } from '../lib/zip.js';
import { fetchBytesWithRetry } from '../lib/fetch-retry.js';
import { pinnedBytes, retryNotice, writeAtomically } from '../lib/pinned.js';

const flags = new Set(process.argv.slice(2));
const refresh = flags.has('--refresh');
const checkOnly = flags.has('--check');
const noCells = flags.has('--no-cells');

const say = (line) => process.stderr.write(line + '\n');

const cacheDir = new URL('../cache/', import.meta.url);

/** The bytes at `url`, retried; unpinned, so only --refresh and the manifest's own check trust them. */
function fetchBytes(url) {
  return fetchBytesWithRetry(url, { onRetry: retryNotice(url, say) });
}

async function onDisk(entry) {
  try {
    return await readFile(localUrl(entry));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** The zips fetched this run, by source key: one download however many members want it. */
const zips = new Map();

const pinned = (url, sha256, name) => pinnedBytes({ url, sha256, name, dir: cacheDir, say });

/** The bytes of a source's zip, fetched on first use and checked against the manifest (or, on --refresh, re-pinned). */
async function zipOf(key) {
  if (!zips.has(key)) {
    const from = manifest.sources[key];
    if (refresh) {
      say(`fetching ${from.url} (${(from.bytes / 1024 / 1024).toFixed(0)} MB)`);
      const bytes = await fetchBytes(from.url);
      Object.assign(from, { bytes: bytes.byteLength, sha256: digest(bytes) });
      zips.set(key, bytes);
    } else {
      const bytes = await pinned(from.url, from.sha256, from.url.split('/').pop());
      verify({ id: `${key} zip`, ...from }, bytes);
      zips.set(key, bytes);
    }
  }
  return zips.get(key);
}

/** The published bytes of an entry: its own URL, or its member of the source's zip. */
async function fetchEntry(entry) {
  if (!entry.member) return fetchBytes(upstreamUrl(entry));
  return zipMember(await zipOf(entry.source), entry.member);
}

/** The bytes of one input of a cut band: a manifest file, a zip member or a pinned Natural Earth file. */
async function readInput(input) {
  if (typeof input === 'string')
    return readFile(localUrl(manifest.files.find((e) => e.id === input)));
  const { upstream, member, sha256 } = pinOf(input);
  if (member) return zipMember(await zipOf(input.source), member);
  return pinned(upstream, sha256, input.name);
}

/** One entry: returns 'ok', 'fetched', 'missing' or throws on a mismatch. */
async function syncOne(entry) {
  const existing = refresh ? null : await onDisk(entry);
  if (existing) {
    verify(entry, existing);
    return 'ok';
  }
  if (checkOnly) return 'missing';
  const bytes = await fetchEntry(entry);
  if (refresh) Object.assign(entry, { bytes: bytes.byteLength, sha256: digest(bytes) });
  else verify(entry, bytes);
  await writeAtomically(localUrl(entry), bytes);
  return 'fetched';
}

const drifted = drift();
if (drifted.length)
  throw new Error(`catalogue.json disagrees with manifest.json:\n  ${drifted.join('\n  ')}`);
for (const entry of manifest.files) {
  if (!source(entry)) throw new Error(`${entry.id}: unknown source ${entry.source}`);
}
for (const dir of ['../data/', '../cache/'])
  await mkdir(new URL(dir, import.meta.url), { recursive: true });
const counts = { ok: 0, fetched: 0, missing: 0 };
for (const entry of manifest.files) {
  const outcome = await syncOne(entry);
  counts[outcome] += 1;
  if (outcome !== 'ok') say(`${outcome}: ${entry.id}`);
}

/** Stamps `provenance.built` on one record in catalogue.json, in place so the file's formatting stands. */
async function stamp(id, day) {
  const path = new URL('../catalogue.json', import.meta.url);
  await writeFile(path, stampBuilt(await readFile(path, 'utf8'), id, day));
  catalogue.find((r) => r.id === id).provenance.built = day;
}

const exists = (url) =>
  access(url).then(
    () => true,
    () => false,
  );

if (!refresh && !noCells) {
  const root = new URL('../', import.meta.url);
  const notice = new URL('../geo/gshhg-modified.txt', import.meta.url);
  const day = new Date().toISOString().slice(0, 10);
  const cut = catalogue.filter((r) => r.grid);
  const missing = [];
  for (const record of cut)
    if (!(await exists(new URL(`../geo/${cellsDir(record)}/index.json`, import.meta.url))))
      missing.push(record);
  say(`cells: ${cut.length - missing.length} built, ${missing.length} missing`);
  if (checkOnly) {
    if (!(await exists(notice))) say('missing: geo/gshhg-modified.txt');
  } else {
    for (const record of missing) {
      const started = performance.now();
      const n = await writeBand(record, await cutBand(record, readInput), root);
      await stamp(record.id, day);
      say(
        `built: ${record.id}, ${n} cells in ${((performance.now() - started) / 1000).toFixed(1)} s`,
      );
    }
    if (missing.length || !(await exists(notice)))
      await writeFile(notice, modifiedNotice(modifiedGshhg(catalogue)));
  }
}

if (refresh) {
  const path = new URL('../manifest.json', import.meta.url);
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  say('manifest.json rewritten; review the diff before committing');
}
say(`${counts.ok} verified, ${counts.fetched} fetched, ${counts.missing} missing`);
if (counts.missing > 0) process.exit(1);
