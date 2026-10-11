#!/usr/bin/env node
// Fetches every file in manifest.json from the pinned Natural Earth release
// into data/, and refuses any byte that disagrees with the manifest.
//
//   node scripts/sync.mjs            fetch what is missing, verify everything
//   node scripts/sync.mjs --check    verify only; exit 1 if anything is missing
//   node scripts/sync.mjs --refresh  fetch everything and rewrite the manifest's
//                                    bytes and sha256 from what arrived -- the
//                                    one way to move the pin; review the diff
//
// data/ is gitignored, so the manifest is the record: an entry's sha256 is the
// promise that `coastlines/data/<id>` is the published file, byte for byte.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { manifest, localUrl, upstreamUrl } from '../lib/catalogue.js'
import { digest, verify } from '../lib/verify.js'

const flags = new Set(process.argv.slice(2))
const refresh = flags.has('--refresh')
const checkOnly = flags.has('--check')

const say = (line) => process.stderr.write(line + '\n')

async function fetchBytes(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function onDisk(entry) {
  try {
    return await readFile(localUrl(entry))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** Write to a sibling, then rename: an interrupted sync leaves no truncated file to fail every later run. */
async function writeAtomically(url, bytes) {
  const partial = new URL(url.href + '.partial')
  await writeFile(partial, bytes)
  await rename(partial, url)
}

/** One entry: returns 'ok', 'fetched', 'missing' or throws on a mismatch. */
async function syncOne(entry) {
  const existing = refresh ? null : await onDisk(entry)
  if (existing) {
    verify(entry, existing)
    return 'ok'
  }
  if (checkOnly) return 'missing'
  const bytes = await fetchBytes(upstreamUrl(entry))
  if (refresh) Object.assign(entry, { bytes: bytes.byteLength, sha256: digest(bytes) })
  else verify(entry, bytes)
  await writeAtomically(localUrl(entry), bytes)
  return 'fetched'
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true })
const counts = { ok: 0, fetched: 0, missing: 0 }
for (const entry of manifest.files) {
  const outcome = await syncOne(entry)
  counts[outcome] += 1
  if (outcome !== 'ok') say(`${outcome}: ${entry.id}`)
}

if (refresh) {
  const path = new URL('../manifest.json', import.meta.url)
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
  say('manifest.json rewritten; review the diff before committing')
}
say(`${counts.ok} verified, ${counts.fetched} fetched, ${counts.missing} missing`)
if (counts.missing > 0) process.exit(1)
