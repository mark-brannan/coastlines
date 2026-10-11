import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, verify } from '../lib/verify.js';

const bytes = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}');
const entry = { id: 'ne-example-50m', bytes: bytes.byteLength, sha256: digest(bytes) };

test('digest is sha256 in the manifest form', () => {
  assert.match(digest(bytes), /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    digest(new Uint8Array()),
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('the published bytes verify', () => {
  assert.equal(verify(entry, bytes), true);
});

test('a different length is refused, naming the id and both lengths', () => {
  assert.throws(
    () => verify(entry, bytes.slice(1)),
    /ne-example-50m: \d+ bytes, manifest says \d+/,
  );
});

test('the same length with different bytes is refused by digest', () => {
  const tampered = Uint8Array.from(bytes);
  tampered[0] = 0x20;
  assert.throws(
    () => verify(entry, tampered),
    /ne-example-50m: sha256:[0-9a-f]{64}, manifest says sha256:/,
  );
});
