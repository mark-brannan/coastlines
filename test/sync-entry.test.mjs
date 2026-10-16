import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEntry } from '../lib/sync-entry.js';
import { digest } from '../lib/verify.js';

const fresh = new TextEncoder().encode('new pin bytes');
const stale = new TextEncoder().encode('old pin bytes!');
const entry = { id: 'ne.shp', bytes: fresh.length, sha256: digest(fresh) };

const harness = (disk, upstream, opts = {}) => {
  const seen = { fetched: 0, written: null, stale: [] };
  return {
    seen,
    run: () =>
      syncEntry(entry, {
        read: async () => disk,
        fetch: async () => (seen.fetched++, upstream),
        write: async (bytes) => (seen.written = bytes),
        onStale: (error) => seen.stale.push(error.message),
        ...opts,
      }),
  };
};

test('a data/ file that disagrees with its pin is fetched again and the fresh bytes stored', async () => {
  const { seen, run } = harness(stale, fresh);
  assert.equal(await run(), 'fetched');
  assert.equal(seen.fetched, 1);
  assert.deepEqual(seen.written, fresh);
  assert.match(seen.stale[0], /ne\.shp/);
});

test('fresh bytes that disagree with the pin too throw, and nothing is written', async () => {
  const { seen, run } = harness(stale, stale);
  await assert.rejects(run(), /ne\.shp/);
  assert.equal(seen.written, null);
});

test('a verified file is kept with no fetch; a missing one is fetched', async () => {
  const kept = harness(fresh, stale);
  assert.equal(await kept.run(), 'ok');
  assert.equal(kept.seen.fetched, 0);
  const missing = harness(null, fresh);
  assert.equal(await missing.run(), 'fetched');
});

test('--check never fetches: a missing file is reported, a disagreeing one throws', async () => {
  const gone = harness(null, fresh, { checkOnly: true });
  assert.equal(await gone.run(), 'missing');
  const wrong = harness(stale, fresh, { checkOnly: true });
  await assert.rejects(wrong.run(), /ne\.shp/);
  assert.equal(wrong.seen.fetched, 0);
});

test('--refresh never reads data/: the fetched bytes re-pin the entry and are stored', async () => {
  const pin = { id: 'ne.shp', bytes: 0, sha256: 'sha256:old' };
  let read = 0;
  let written = null;
  const outcome = await syncEntry(pin, {
    read: async () => (read++, fresh),
    fetch: async () => stale,
    write: async (bytes) => (written = bytes),
    refresh: true,
  });
  assert.equal(outcome, 'fetched');
  assert.equal(read, 0);
  assert.deepEqual(pin, { id: 'ne.shp', bytes: stale.length, sha256: digest(stale) });
  assert.deepEqual(written, stale);
});
