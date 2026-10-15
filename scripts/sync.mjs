#!/usr/bin/env node
// Fetches every file in manifest.json from its pinned source into data/, and
// refuses any byte that disagrees with the manifest.
//
//   node scripts/sync.mjs            fetch what is missing, verify everything
//   node scripts/sync.mjs --check    verify only; exit 1 if anything is missing
//   node scripts/sync.mjs --refresh  fetch everything and rewrite the manifest's
//                                    bytes and sha256 from what arrived -- the
//                                    one way to move a pin; review the diff
//
// Two kinds of source. A Natural Earth entry is one file at one URL. A GSHHG
// entry is a member of the published zip: the zip (149 MB) is fetched once,
// only when a member or a cut band needs it, checked against the bytes and
// sha256 the manifest records for the zip itself, kept in data/ so the next run
// and CI's cache need not fetch it again, and each member is lifted out and
// checked against its own entry. Nothing of the zip touches the repository.
//
// Then the catalogue's cut bands (`cells` sources) are built into geo/ by
// lib/cut.js where a band's index.json is missing, and each band's
// provenance.built is stamped with the day; geo/gshhg-modified.txt names the
// GSHHG bands among them.
//
// catalogue.json is checked against the manifest first (lib/bands.js drift): every record's
// upstream, member and sha256 must be what its inputs pin, so the two cannot drift.
//
// data/ is gitignored, so the manifest is the record: an entry's sha256 is the
// promise that `coastlines/data/<id>` is the published file, byte for byte.
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { manifest, localUrl, source, upstreamUrl } from '../lib/catalogue.js';
import { catalogue, drift, pinOf } from '../lib/bands.js';
import { cellsDir, cutBand, modifiedGshhg, modifiedNotice, writeBand } from '../lib/cut.js';
import { digest, verify } from '../lib/verify.js';
import { zipMember } from '../lib/zip.js';
import { fetchBytesWithRetry } from '../lib/fetch-retry.js';

const flags = new Set(process.argv.slice(2));
const refresh = flags.has('--refresh');
const checkOnly = flags.has('--check');

const say = (line) => process.stderr.write(line + '\n');

function fetchBytes(url) {
  return fetchBytesWithRetry(url, {
    onRetry: (error, attempt, attempts, wait) => {
      // An HTTP failure's message already names the url; say it once.
      const why = error.cause?.code ?? error.message.replace(`${url}: `, '');
      say(`${url}: ${why}; attempt ${attempt} of ${attempts} failed, retrying in ${wait / 1000} s`);
    },
  });
}

async function onDisk(entry) {
  try {
    return await readFile(localUrl(entry));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Write to a sibling, then rename: an interrupted sync leaves no truncated file to fail every later run. */
async function writeAtomically(url, bytes) {
  const partial = new URL(url.href + '.partial');
  await writeFile(partial, bytes);
  await rename(partial, url);
}

/** The zips fetched this run, by source key: one download however many members want it. */
const zips = new Map();

/** Bytes pinned by `sha256`, from data/<cache> when it is there and right, else fetched and kept. */
async function pinned(url, sha256, cache) {
  const where = new URL(`../data/${cache}`, import.meta.url);
  const held = await readFile(where).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (held && digest(held) === sha256) return held;
  const started = performance.now();
  say(`fetching ${url}`);
  const bytes = await fetchBytes(url);
  say(
    `${cache}: ${bytes.byteLength} bytes in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  if (digest(bytes) !== sha256) throw new Error(`${cache}: ${digest(bytes)}, pinned ${sha256}`);
  await writeAtomically(where, bytes);
  return bytes;
}

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
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const counts = { ok: 0, fetched: 0, missing: 0 };
for (const entry of manifest.files) {
  const outcome = await syncOne(entry);
  counts[outcome] += 1;
  if (outcome !== 'ok') say(`${outcome}: ${entry.id}`);
}

/** Whether this band's cells are already built. */
const built = (record) =>
  access(new URL(`../geo/${cellsDir(record)}/index.json`, import.meta.url)).then(
    () => true,
    () => false,
  );

/** Stamps `provenance.built` on one record in catalogue.json, in place so the file's formatting stands. */
async function stamp(id, day) {
  const path = new URL('../catalogue.json', import.meta.url);
  const text = await readFile(path, 'utf8');
  const at = text.indexOf(`"id": "${id}"`);
  const next = text.slice(at).replace(/("built": )"[^"]*"/, `$1"${day}"`);
  await writeFile(path, text.slice(0, at) + next);
  catalogue.find((r) => r.id === id).provenance.built = day;
}

if (!refresh) {
  const root = new URL('../', import.meta.url);
  const day = new Date().toISOString().slice(0, 10);
  const cut = catalogue.filter((r) => r.grid);
  const missing = [];
  for (const record of cut) if (!(await built(record))) missing.push(record);
  say(`cells: ${cut.length - missing.length} built, ${missing.length} missing`);
  if (!checkOnly) {
    for (const record of missing) {
      const started = performance.now();
      const n = await writeBand(record, await cutBand(record, readInput), root);
      await stamp(record.id, day);
      say(
        `built: ${record.id}, ${n} cells in ${((performance.now() - started) / 1000).toFixed(1)} s`,
      );
    }
    if (
      missing.length ||
      !(await access(new URL('../geo/gshhg-modified.txt', import.meta.url)).then(
        () => true,
        () => false,
      ))
    )
      await writeFile(
        new URL('../geo/gshhg-modified.txt', import.meta.url),
        modifiedNotice(modifiedGshhg(catalogue)),
      );
  }
}

if (refresh) {
  const path = new URL('../manifest.json', import.meta.url);
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  say('manifest.json rewritten; review the diff before committing');
}
say(`${counts.ok} verified, ${counts.fetched} fetched, ${counts.missing} missing`);
if (counts.missing > 0) process.exit(1);
