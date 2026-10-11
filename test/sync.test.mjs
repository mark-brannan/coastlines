import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { manifest, localUrl } from '../lib/catalogue.js'

// `--check` never touches the network, so it is safe to run under test: it
// reports the state of data/ and exits 1 when a file is missing.

test('sync --check reports data/ honestly and never fetches', async () => {
  const synced = await access(localUrl(manifest.files[0])).then(() => true, () => false)
  const script = new URL('../scripts/sync.mjs', import.meta.url)
  const run = spawnSync(process.execPath, [script.pathname, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, synced ? 0 : 1, run.stderr)
  assert.match(run.stderr, /\d+ verified, 0 fetched, \d+ missing/)
})
