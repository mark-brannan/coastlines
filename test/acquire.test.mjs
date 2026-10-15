import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquire } from '../lib/acquire.js';
import { digest } from '../lib/verify.js';

const body = new TextEncoder().encode('pinned bytes');
const pin = { url: 'https://example.test/a/pinned.bin', sha256: digest(body), bytes: body.length };
const ok = (counter) => async () => (counter.n++, new Response(body));
const dir = () => mkdtemp(join(tmpdir(), 'acquire-'));

test('a miss fetches, verifies and stores; the next call is a cache hit with no fetch', async () => {
  const cacheDir = await dir();
  const calls = { n: 0 };
  const first = await acquire(pin, { cacheDir, fetchImpl: ok(calls) });
  assert.deepEqual(first, body);
  assert.deepEqual(await readFile(join(cacheDir, 'pinned.bin')), Buffer.from(body));
  assert.deepEqual(await readdir(cacheDir), ['pinned.bin'], 'no .partial left behind');
  await acquire(pin, { cacheDir, fetchImpl: ok(calls) });
  assert.equal(calls.n, 1);
});

test('a wrong sha256 throws with no retry and stores nothing', async () => {
  const cacheDir = await dir();
  const calls = { n: 0 };
  const retried = [];
  await assert.rejects(
    acquire(
      { ...pin, sha256: digest(new Uint8Array(1)) },
      {
        cacheDir,
        fetchImpl: ok(calls),
        sleep: async () => {},
        onRetry: (_e, a) => retried.push(a),
      },
    ),
    /pinned sha256:/,
  );
  assert.equal(calls.n, 1);
  assert.deepEqual(retried, [], 'a wrong hash is never retried');
  assert.deepEqual(await readdir(cacheDir).catch(() => []), []);
});

test('a cached file that no longer matches is fetched again; a wrong length throws', async () => {
  const cacheDir = await dir();
  const calls = { n: 0 };
  await acquire(pin, { cacheDir, fetchImpl: ok(calls) });
  await writeFile(join(cacheDir, 'pinned.bin'), 'bad');
  assert.deepEqual(await acquire(pin, { cacheDir, fetchImpl: ok(calls) }), body);
  assert.equal(calls.n, 2);
  await assert.rejects(
    acquire({ ...pin, bytes: 1 }, { cacheDir: await dir(), fetchImpl: ok(calls) }),
    /12 bytes, pinned 1/,
  );
});

test('a transient failure is retried; the retry report names the attempt', async () => {
  let n = 0;
  const seen = [];
  const bytes = await acquire(pin, {
    cacheDir: await dir(),
    fetchImpl: async () => (n++ ? new Response(body) : Promise.reject(new Error('reset'))),
    sleep: async () => {},
    onRetry: (_e, attempt) => seen.push(attempt),
  });
  assert.deepEqual(bytes, body);
  assert.deepEqual(seen, [1]);
});
