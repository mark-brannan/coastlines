import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { pinnedBytes } from '../lib/pinned.js';
import { digest } from '../lib/verify.js';

// Stubs and a temp directory only: no download happens.
const bytes = new Uint8Array([1, 2, 3]);
const sha256 = digest(bytes);
const ok = () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });
const stub = (...answers) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next();
  };
  return { fetchImpl, calls };
};
const same = (got) => assert.ok(Buffer.from(got).equals(bytes), `got ${[...got]}`);
const fresh = async () => pathToFileURL((await mkdtemp(`${tmpdir()}/pinned-`)) + '/');
const base = { url: 'https://example.test/a.bin', sha256, name: 'a.bin', sleep: async () => {} };

test('fetches once, keeps the bytes, and answers the next call from the cache', async () => {
  const dir = await fresh();
  const { fetchImpl, calls } = stub(ok);
  same(await pinnedBytes({ ...base, dir, fetchImpl }));
  same(await pinnedBytes({ ...base, dir, fetchImpl }));
  assert.equal(calls.length, 1);
  same(await readFile(new URL('a.bin', dir)));
});

test('a cached file that disagrees with the pin is fetched over', async () => {
  const dir = await fresh();
  await writeFile(new URL('a.bin', dir), 'stale');
  const { fetchImpl, calls } = stub(ok);
  same(await pinnedBytes({ ...base, dir, fetchImpl }));
  assert.equal(calls.length, 1);
  same(await readFile(new URL('a.bin', dir)));
});

test('retries a 5xx, says so, and still verifies', async () => {
  const dir = await fresh();
  const said = [];
  const { fetchImpl, calls } = stub(() => ({ ok: false, status: 503 }), ok);
  await pinnedBytes({ ...base, dir, fetchImpl, say: (l) => said.push(l) });
  assert.equal(calls.length, 2);
  assert.ok(said.some((l) => /HTTP 503|503; attempt 1 of 3 failed, retrying in 2 s/.test(l)));
});

test('bytes that disagree with the pin throw and are not kept', async () => {
  const dir = await fresh();
  const { fetchImpl } = stub(ok);
  await assert.rejects(
    pinnedBytes({ ...base, sha256: 'sha256:' + '0'.repeat(64), dir, fetchImpl }),
    /a\.bin: sha256:.*, pinned sha256:0+/,
  );
  assert.deepEqual(await readdir(dir), []);
});

test('a name that is a path, or empty, is refused before anything is fetched', async () => {
  const dir = await fresh();
  const { fetchImpl, calls } = stub(ok);
  for (const name of ['../a.bin', ''])
    await assert.rejects(pinnedBytes({ ...base, name, dir, fetchImpl }), /file name/);
  assert.equal(calls.length, 0);
});

test('a 4xx is not retried and keeps nothing', async () => {
  const dir = await fresh();
  const { fetchImpl, calls } = stub(() => ({ ok: false, status: 404 }), ok);
  await assert.rejects(pinnedBytes({ ...base, dir, fetchImpl }), /HTTP 404/);
  assert.equal(calls.length, 1);
  assert.deepEqual(await readdir(dir), []);
});
