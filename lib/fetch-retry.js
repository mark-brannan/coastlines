// A download that tries again on a network error, a body cut off mid-stream, or
// an HTTP 5xx; never on a 4xx. Three attempts, waiting 2 s and then 6 s between
// them. The caller's sha256 check stays the only trust: a retry changes how
// bytes arrive, not whether they are believed.
export const WAITS_MS = [2000, 6000];

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One attempt: the bytes, or a failure, with `retry` false when trying again cannot help. */
async function attempt(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url);
    if (response.ok) return { bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { failure: error, retry: true };
  }
  await response.body?.cancel();
  return {
    failure: new Error(`${url}: HTTP ${response.status}`),
    retry: response.status >= 500,
  };
}

/** The bytes at `url`; throws on a 4xx at once, or with the last failure once the waits run out. */
export async function fetchBytesWithRetry(
  url,
  { fetchImpl = fetch, sleep = sleepFor, waits = WAITS_MS, onRetry = () => {} } = {},
) {
  for (let tried = 0; ; tried++) {
    const { bytes, failure, retry } = await attempt(url, fetchImpl);
    if (bytes) return bytes;
    if (!retry || tried >= waits.length) throw failure;
    onRetry(failure, tried + 1, waits.length + 1, waits[tried]);
    await sleep(waits[tried]);
  }
}
