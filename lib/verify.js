// The byte check behind every data file: sha256 and length against the manifest.
import { createHash } from 'node:crypto'

/** `sha256:<hex>` of a byte array, the form the manifest records. */
export const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex')

/**
 * Throws unless `bytes` are exactly the file the manifest entry promises.
 * Length first: it is the cheaper check and the better message.
 */
export function verify(entry, bytes) {
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`${entry.id}: ${bytes.byteLength} bytes, manifest says ${entry.bytes}`)
  }
  const actual = digest(bytes)
  if (actual !== entry.sha256) {
    throw new Error(`${entry.id}: ${actual}, manifest says ${entry.sha256}`)
  }
  return true
}
