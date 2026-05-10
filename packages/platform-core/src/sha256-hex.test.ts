import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Crypto } from '@atlas/ports';
import { sha256Hex } from '@atlas/platform-core';

/**
 * Spec: `specs/crosscut/scenario-fuzzing.md` §7 — `sha256Hex` is the
 * canonical hex-encoded SHA-256 helper. Used for `contentHash` and
 * `idempotencyKey` derivation; determinism contract is that identical
 * input yields identical output.
 *
 * The helper takes the `Crypto` port — never imports `node:crypto`
 * directly. The test wires a tiny Node-backed `Crypto` shim so the
 * unit can be exercised in isolation without spinning up a full
 * adapter.
 */

const nodeCrypto: Pick<Crypto, 'sha256'> = {
  sha256: (input) => {
    const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    const buf = createHash('sha256').update(data).digest();
    const out = new Uint8Array(buf.length);
    out.set(buf);
    return out;
  },
};

describe('sha256Hex', () => {
  it('hashes the empty string to the well-known SHA-256 zero-length digest', () => {
    // RFC test vector: SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
    expect(sha256Hex('', nodeCrypto as Crypto)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes an ASCII string to the well-known "abc" digest', () => {
    // RFC test vector: SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.
    expect(sha256Hex('abc', nodeCrypto as Crypto)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a UTF-8 string with non-ASCII codepoints (string is encoded as UTF-8 bytes)', () => {
    // The Crypto port's contract is that string input is UTF-8 encoded
    // before hashing. "héllo" UTF-8 = 68 c3 a9 6c 6c 6f.
    const expected = createHash('sha256').update('héllo', 'utf8').digest('hex');
    expect(sha256Hex('héllo', nodeCrypto as Crypto)).toBe(expected);
  });

  it('hashes Uint8Array input identically to the same bytes passed as a string-encoded value', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
    expect(sha256Hex(bytes, nodeCrypto as Crypto)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic — repeated calls with the same input return identical hex', () => {
    const a = sha256Hex('determinism', nodeCrypto as Crypto);
    const b = sha256Hex('determinism', nodeCrypto as Crypto);
    expect(a).toBe(b);
    // Hex output is exactly 64 lowercase chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
