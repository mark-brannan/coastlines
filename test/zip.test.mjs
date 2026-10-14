import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, zipMember, zipMembers } from '../lib/zip.js';

// A zip built here, byte by byte, so the reader is tested against the layout
// and not against another library's idea of it.

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const utf8 = (s) => [...new TextEncoder().encode(s)];

/** A plain zip of `{ path: bytes }`, stored (method 0) or deflated (method 8), with an archive comment. */
function buildZip(members, { comment = '' } = {}) {
  const out = [];
  const central = [];
  for (const { path, data, method } of members) {
    const packed = method === 8 ? [...deflateRawSync(data)] : [...data];
    const crc = crc32(data);
    const name = utf8(path);
    const offset = out.length;
    out.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(packed.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...packed,
    );
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(packed.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
  }
  const directoryAt = out.length;
  out.push(...central);
  const note = utf8(comment);
  out.push(
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(members.length),
    ...u16(members.length),
    ...u32(central.length),
    ...u32(directoryAt),
    ...u16(note.length),
    ...note,
  );
  return Uint8Array.from(out);
}

const text = new TextEncoder().encode('Permission to use, copy, modify, and distribute.\n');
const shape = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 251);
const zip = buildZip(
  [
    { path: 'LICENSE.TXT', data: text, method: 0 },
    { path: 'GSHHS_shp/h/GSHHS_h_L1.shp', data: shape, method: 8 },
  ],
  { comment: 'a comment after the record' },
);

test('crc32 is the IEEE polynomial, as zip records it', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('the central directory lists every member with its sizes and method', () => {
  const members = zipMembers(zip);
  assert.deepEqual([...members.keys()], ['LICENSE.TXT', 'GSHHS_shp/h/GSHHS_h_L1.shp']);
  assert.equal(members.get('LICENSE.TXT').method, 0);
  assert.equal(members.get('GSHHS_shp/h/GSHHS_h_L1.shp').method, 8);
  assert.equal(members.get('GSHHS_shp/h/GSHHS_h_L1.shp').size, 5000);
});

test('a stored member comes back as stored, a deflated one inflated', () => {
  assert.deepEqual(zipMember(zip, 'LICENSE.TXT'), text);
  assert.deepEqual(zipMember(zip, 'GSHHS_shp/h/GSHHS_h_L1.shp'), shape);
});

test('an absent member is refused by name', () => {
  assert.throws(
    () => zipMember(zip, 'GSHHS_shp/h/GSHHS_h_L2.shp'),
    /no member GSHHS_shp\/h\/GSHHS_h_L2\.shp/,
  );
});

test('a member whose bytes disagree with the directory crc is refused', () => {
  const tampered = Uint8Array.from(zip);
  const start = 30 + 'LICENSE.TXT'.length; // first byte of the stored member
  tampered[start] ^= 0xff;
  assert.throws(() => zipMember(tampered, 'LICENSE.TXT'), /crc32/);
});

test('not a zip, and zip64, are named as such', () => {
  assert.throws(() => zipMembers(new Uint8Array(40)), /not a zip archive/);
  const big = Uint8Array.from(zip);
  const eocd = big.length - 22 - 'a comment after the record'.length;
  big.set([0xff, 0xff, 0xff, 0xff], eocd + 16); // directory offset deferred to the zip64 record
  assert.throws(() => zipMembers(big), /zip64/);
});

test('a buffer too short to hold a directory record is not a zip', () => {
  assert.throws(() => zipMembers(new Uint8Array(10)), /not a zip archive/);
});
