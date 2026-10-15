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
// entry is a member of the published zip: the zip (149 MB) is fetched once per
// run, only when one of its members is missing, checked against the bytes and
// sha256 the manifest records for the zip itself, held in memory, and each
// member is lifted out and checked against its own entry. Nothing of the zip
// touches the repository.
//
// catalogue.json is checked against the manifest first (lib/bands.js drift): every record's
// upstream, member and sha256 must be what its inputs pin, so the two cannot drift.
//
// data/ is gitignored, so the manifest is the record: an entry's sha256 is the
// promise that `coastlines/data/<id>` is the published file, byte for byte.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { manifest, localUrl, source, upstreamUrl } from '../lib/catalogue.js';
import { drift } from '../lib/bands.js';
import { digest, verify } from '../lib/verify.js';
import { zipMember } from '../lib/zip.js';
import { fetchWithRetry } from '../lib/fetch-retry.js';

const flags = new Set(process.argv.slice(2));
const refresh = flags.has('--refresh');
const checkOnly = flags.has('--check');

const say = (line) => process.stderr.write(line + '\n');

async function fetchBytes(url) {
  const response = await fetchWithRetry(url, {
    onRetry: (error, attempt, wait) =>
      say(`${url}: ${error.cause?.code ?? error.message}; attempt ${attempt} of 3 failed, retrying in ${wait / 1000} s`),
  });
  return new Uint8Array(await response.arrayBuffer());
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

/** The bytes of a source's zip, fetched on first use and checked against the manifest (or, on --refresh, re-pinned). */
async function zipOf(key) {
  if (!zips.has(key)) {
    const from = manifest.sources[key];
    say(`fetching ${from.url} (${(from.bytes / 1024 / 1024).toFixed(0)} MB)`);
    const started = performance.now();
    const bytes = await fetchBytes(from.url);
    say(
      `${key}: ${bytes.byteLength} bytes in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    if (refresh) Object.assign(from, { bytes: bytes.byteLength, sha256: digest(bytes) });
    else verify({ id: `${key} zip`, ...from }, bytes);
    zips.set(key, bytes);
  }
  return zips.get(key);
}

/** The published bytes of an entry: its own URL, or its member of the source's zip. */
async function fetchEntry(entry) {
  if (!entry.member) return fetchBytes(upstreamUrl(entry));
  return zipMember(await zipOf(entry.source), entry.member);
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

if (refresh) {
  const path = new URL('../manifest.json', import.meta.url);
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  say('manifest.json rewritten; review the diff before committing');
}
say(`${counts.ok} verified, ${counts.fetched} fetched, ${counts.missing} missing`);
if (counts.missing > 0) process.exit(1);
