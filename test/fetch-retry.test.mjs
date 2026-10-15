import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBytesWithRetry } from '../lib/fetch-retry.js';

// Stubs only: no download happens.
const bytes = new Uint8Array([1, 2, 3]);
const ok = () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });
const cutOff = () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => {
    throw new TypeError('terminated');
  },
});
const status = (code) => () => ({ ok: false, status: code });
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
const recorder = () => {
  const sleeps = [];
  const retries = [];
  return {
    sleeps,
    retries,
    sleep: async (ms) => void sleeps.push(ms),
    onRetry: (error, attempt, attempts, wait) => retries.push([attempt, attempts, wait]),
  };
};

test('two network failures then an answer: the bytes arrive, after waits of 2 s and 6 s', async () => {
  const { sleeps, retries, sleep, onRetry } = recorder();
  const { fetchImpl, calls } = stub(new Error('connect timeout'), new Error('connect timeout'), ok);
  assert.deepEqual(await fetchBytesWithRetry('u', { fetchImpl, sleep, onRetry }), bytes);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 6000]);
  assert.deepEqual(retries, [
    [1, 3, 2000],
    [2, 3, 6000],
  ]);
});

test('a body cut off mid-download is retried', async () => {
  const { sleep } = recorder();
  const { fetchImpl, calls } = stub(cutOff, ok);
  assert.deepEqual(await fetchBytesWithRetry('u', { fetchImpl, sleep }), bytes);
  assert.equal(calls.length, 2);
});

test('HTTP 5xx is retried', async () => {
  const { sleep } = recorder();
  const { fetchImpl, calls } = stub(status(503), ok);
  assert.deepEqual(await fetchBytesWithRetry('u', { fetchImpl, sleep }), bytes);
  assert.equal(calls.length, 2);
});

test('a 404 fails at once, with no retry and no wait', async () => {
  const { sleeps, sleep } = recorder();
  const { fetchImpl, calls } = stub(status(404), ok);
  await assert.rejects(fetchBytesWithRetry('u', { fetchImpl, sleep }), /HTTP 404/);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('three failures in a row give up with the last error', async () => {
  const { sleep } = recorder();
  const { fetchImpl, calls } = stub(status(502), status(502), status(500), ok);
  await assert.rejects(fetchBytesWithRetry('u', { fetchImpl, sleep }), /HTTP 500/);
  assert.equal(calls.length, 3);
});
