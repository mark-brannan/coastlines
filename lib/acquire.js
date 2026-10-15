// Pinned-source acquisition: give it `{url, sha256}` (a manifest pin, or any
// source pinned the same way) and get back verified bytes from a local cache.
// Cache hit: no fetch. Miss, or a cached file that no longer matches: fetch
// with retry, check, keep. A wrong sha256 throws and nothing is stored or
// retried -- retry changes how bytes arrive, never whether they are believed.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './verify.js';
import { fetchBytesWithRetry } from './fetch-retry.js';

async function cached(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The bytes pinned by `{url, sha256, bytes?}`, from `cacheDir/<name>` when they are there and
 * right, else fetched, checked and kept. `name` defaults to the url's last path segment (empty for a url ending in /) and must be a file name, not a
 * path. `fetchImpl`, `sleep`, `waits` and `onRetry` go to the retry; `onFetch(url)` is told before a download.
 */
export async function acquire(
  { url, sha256, bytes: length },
  { cacheDir, name = new URL(url).pathname.split('/').pop(), onFetch, ...retry },
) {
  if (!name || name !== name.split(/[/\\]/).pop() || name === '..' || name === '.')
    throw new Error(`${name}: a cache name is a file name, not a path`);
  const file = join(cacheDir, name);
  const held = await cached(file);
  if (held && digest(held) === sha256) return held;
  onFetch?.(url);
  const bytes = await fetchBytesWithRetry(url, retry);
  const actual = digest(bytes);
  if (actual !== sha256) throw new Error(`${name}: ${actual}, pinned ${sha256}`);
  if (length !== undefined && bytes.byteLength !== length)
    throw new Error(`${name}: ${bytes.byteLength} bytes, pinned ${length}`);
  await mkdir(cacheDir, { recursive: true });
  // Sibling then rename: an interrupted run leaves no truncated file to fail every later one.
  await writeFile(`${file}.partial`, bytes);
  await rename(`${file}.partial`, file);
  return bytes;
}
