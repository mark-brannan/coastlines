// One manifest entry's sync: keep a data/ file that verifies, fetch one that is missing or
// disagrees with its pin (a restored older cache holds the previous pin's bytes), and believe
// only fetched bytes that verify -- the same way acquire() treats a stale cache file.
import { digest, verify } from './verify.js';

/**
 * Returns 'ok', 'fetched' or 'missing'. `read()` gives the file on disk or null, `fetch()` the
 * published bytes, `write(bytes)` stores them; `onStale(error)` is told before a refetch.
 * Fresh bytes that disagree with the pin throw -- nothing is written. With `refresh` the
 * fetched bytes re-pin the entry instead; with `checkOnly` nothing is fetched and a file that
 * disagrees throws.
 */
export async function syncEntry(entry, { read, fetch, write, refresh, checkOnly, onStale }) {
  const existing = refresh ? null : await read();
  if (existing) {
    try {
      verify(entry, existing);
      return 'ok';
    } catch (error) {
      if (checkOnly) throw error;
      onStale?.(error);
    }
  }
  if (checkOnly) return 'missing';
  const bytes = await fetch();
  if (refresh) Object.assign(entry, { bytes: bytes.byteLength, sha256: digest(bytes) });
  else verify(entry, bytes);
  await write(bytes);
  return 'fetched';
}
