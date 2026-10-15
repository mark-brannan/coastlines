import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../lib/fetch-retry.js';

// Stubs only: no download happens.
const ok = { ok: true, status: 200 };
const status = (code) => ({ ok: false, status: code });
const stub = (...answers) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
};
const sleeps = [];
const sleep = async (ms) => void sleeps.push(ms);

test('two network failures then an answer: the bytes arrive, after waits of 2 s and 6 s', async () => {
  sleeps.length = 0;
  const { fetchImpl, calls } = stub(new Error('connect timeout'), new Error('connect timeout'), ok);
  assert.equal(await fetchWithRetry('u', { fetchImpl, sleep }), ok);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 6000]);
});

test('HTTP 5xx is retried', async () => {
  const { fetchImpl, calls } = stub(status(503), ok);
  assert.equal(await fetchWithRetry('u', { fetchImpl, sleep }), ok);
  assert.equal(calls.length, 2);
});

test('a 404 fails at once, with no retry and no wait', async () => {
  sleeps.length = 0;
  const { fetchImpl, calls } = stub(status(404), ok);
  await assert.rejects(fetchWithRetry('u', { fetchImpl, sleep }), /HTTP 404/);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('three failures in a row give up with the last error', async () => {
  const { fetchImpl, calls } = stub(status(502), status(502), status(500), ok);
  await assert.rejects(fetchWithRetry('u', { fetchImpl, sleep }), /HTTP 500/);
  assert.equal(calls.length, 3);
});
