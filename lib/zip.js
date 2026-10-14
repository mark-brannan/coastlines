// A reader for a plain zip archive held in memory: enough to lift one member
// out of a published bundle and nothing more. No zip64, no encryption, no
// multi-disk archives; methods 0 (stored) and 8 (deflate) only, which is what
// a data publisher's zip uses. The byte layout is PKWARE's APPNOTE.
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50; // end of central directory
const CENTRAL = 0x02014b50; // central directory file header
const LOCAL = 0x04034b50; // local file header
const EOCD_MIN = 22; // the fixed part, before the archive comment

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const text = (bytes, start, length) =>
  new TextDecoder('utf8').decode(bytes.subarray(start, start + length));

/** The end-of-central-directory record: where the directory is and how many entries it holds. */
function endOfCentralDirectory(bytes) {
  if (bytes.byteLength < EOCD_MIN) throw new Error('not a zip archive: too short');
  const dv = view(bytes);
  // The record ends with a comment of up to 65535 bytes, so scan back for its signature.
  const floor = Math.max(0, bytes.byteLength - EOCD_MIN - 0xffff);
  for (let at = bytes.byteLength - EOCD_MIN; at >= floor; at -= 1) {
    if (dv.getUint32(at, true) !== EOCD) continue;
    const entries = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 12, true);
    const offset = dv.getUint32(at + 16, true);
    if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new Error('zip64 archive: not supported');
    }
    return { entries, size, offset };
  }
  throw new Error('not a zip archive: no end-of-central-directory record');
}

/**
 * Every member of the archive, keyed by its path, from the central directory.
 * Each record carries `method`, `crc32`, `compressedSize`, `size` and the
 * offset of its local header; the bytes are not read until `zipMember`.
 */
export function zipMembers(bytes) {
  const dv = view(bytes);
  const { entries, offset } = endOfCentralDirectory(bytes);
  const members = new Map();
  let at = offset;
  for (let index = 0; index < entries; index += 1) {
    if (dv.getUint32(at, true) !== CENTRAL) {
      throw new Error(`zip: bad central directory entry at byte ${at}`);
    }
    const method = dv.getUint16(at + 10, true);
    const crc32 = dv.getUint32(at + 16, true);
    const compressedSize = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const localOffset = dv.getUint32(at + 42, true);
    const path = text(bytes, at + 46, nameLength);
    members.set(path, { path, method, crc32, compressedSize, size, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

/**
 * The inflated bytes of one member, checked against the crc32 the directory
 * recorded. Throws if the path is absent, the method is neither stored nor
 * deflated, or the bytes do not match their crc.
 */
export function zipMember(bytes, path) {
  const member = zipMembers(bytes).get(path);
  if (!member) throw new Error(`zip: no member ${path}`);
  const dv = view(bytes);
  const { localOffset } = member;
  if (dv.getUint32(localOffset, true) !== LOCAL) {
    throw new Error(`zip: bad local header for ${path}`);
  }
  // Sizes come from the central directory: a local header may defer them to a
  // data descriptor after the member, and the directory always has them.
  const start =
    localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
  const packed = bytes.subarray(start, start + member.compressedSize);
  let data;
  if (member.method === 0) data = packed;
  else if (member.method === 8) data = new Uint8Array(inflateRawSync(packed));
  else throw new Error(`zip: ${path} uses compression method ${member.method}`);
  if (data.byteLength !== member.size) {
    throw new Error(
      `zip: ${path} inflated to ${data.byteLength} bytes, directory says ${member.size}`,
    );
  }
  const crc = crc32(data);
  if (crc !== member.crc32) {
    throw new Error(
      `zip: ${path} crc32 ${crc.toString(16)}, directory says ${member.crc32.toString(16)}`,
    );
  }
  return data;
}

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** IEEE crc32 of a byte array, as zip records it. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
