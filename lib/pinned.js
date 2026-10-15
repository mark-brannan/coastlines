// Bytes pinned by sha256, acquired once: from the cache directory when the file
// is there and right, else fetched with retry, checked, and kept. The cut and
// sync share it, and so can a consumer that holds its own pins. The sha256
// check is the only trust; the cache and the retry change how bytes arrive.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { digest } from './verify.js';
import { fetchBytesWithRetry } from './fetch-retry.js';

/** Write to a sibling, then rename: an interrupted run leaves no truncated file to fail every later one. */
export async function writeAtomically(url, bytes) {
  const partial = new URL(url.href + '.partial');
  await writeFile(partial, bytes);
  await rename(partial, url);
}

/** An `onRetry` for fetchBytesWithRetry that says which url failed, why, and how long the wait is. */
export const retryNotice = (url, say) => (error, attempt, attempts, wait) => {
  // An HTTP failure's message already names the url; say it once.
  const why = error.cause?.code ?? error.message.replace(`${url}: `, '');
  say(`${url}: ${why}; attempt ${attempt} of ${attempts} failed, retrying in ${wait / 1000} s`);
};

/**
 * The bytes whose sha256 is `sha256`, from `<dir>/<name>` when it holds them,
 * else fetched from `url` and written there. `dir` is a directory URL. A cached
 * file that disagrees is fetched over; fetched bytes that disagree throw and are
 * not kept. `say` gets progress lines; `fetchImpl`, `sleep` and `waits` pass to
 * fetchBytesWithRetry.
 */
export async function pinnedBytes({ url, sha256, name, dir, say = () => {}, ...retry }) {
  if (!name || name !== name.split(/[/\\]/).pop() || name === '..' || name === '.')
    throw new Error(`${name}: a cache name is a file name, not a path`);
  const where = new URL(name, dir);
  const held = await readFile(where).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (held && digest(held) === sha256) return held;
  const started = performance.now();
  say(`fetching ${url}`);
  const bytes = await fetchBytesWithRetry(url, {
    ...retry,
    onRetry: retryNotice(url, say),
  });
  say(
    `${name}: ${bytes.byteLength} bytes in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  if (digest(bytes) !== sha256) throw new Error(`${name}: ${digest(bytes)}, pinned ${sha256}`);
  await mkdir(dir, { recursive: true });
  await writeAtomically(where, bytes);
  return bytes;
}
