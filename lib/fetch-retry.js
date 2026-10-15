// A fetch that tries again on a network error or an HTTP 5xx, never on a 4xx.
// Three attempts, waiting 2 s and then 6 s between them. The caller's sha256
// check stays the only trust: a retry changes how bytes arrive, not whether
// they are believed.
export const WAITS_MS = [2000, 6000];

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Response of `fetchImpl(url)`; throws on a 4xx at once, or on the last failure. */
export async function fetchWithRetry(
  url,
  { fetchImpl = fetch, sleep = sleepFor, waits = WAITS_MS, onRetry = () => {} } = {},
) {
  for (let attempt = 0; ; attempt++) {
    let failure;
    try {
      const response = await fetchImpl(url);
      if (response.ok) return response;
      failure = new Error(`${url}: HTTP ${response.status}`);
      if (response.status < 500) throw Object.assign(failure, { final: true });
    } catch (error) {
      if (error.final) throw error;
      failure = error;
    }
    if (attempt >= waits.length) throw failure;
    onRetry(failure, attempt + 1, waits[attempt]);
    await sleep(waits[attempt]);
  }
}
