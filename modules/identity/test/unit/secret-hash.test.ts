/**
 * Regression pin for `hashSecret` / `lookupOf` — the security-critical
 * helpers used to derive invite-token, recovery-code, and API-key hashes
 * stored in the document body (never the plaintext; per
 * `crosscut/events.md` plaintext stays out of event history).
 *
 * Why pin this with known SHA-256 test vectors:
 *
 *   Any drift in the underlying digest silently invalidates the entire
 *   stored hash corpus. Login + invite-accept compare `hashSecret(input)`
 *   against the stored row; if the digest function shifts byte-for-byte,
 *   every existing user with a hashed secret is locked out without an
 *   error message any operator could attribute to the cause.
 *
 *   The recent `sha256Hex` extraction (ticket
 *   `chore/sha256hex-extract-to-platform-core`) replaced the inline
 *   `toHex(getIdentityCrypto().sha256(secret))` with
 *   `sha256Hex(secret, getIdentityCrypto())`. Behaviour MUST be
 *   byte-identical. These pins make a regression loud — they fail on
 *   the literal hex output, not on a round-trip property.
 *
 * Test vectors come from FIPS 180-4 §B.1 and the NIST CAVS suite — the
 * same vectors the platform-core `sha256-hex.test.ts` uses for the
 * canonical extracted helper, so the two tests pin the same surface
 * from both sides.
 */
import { describe, expect, it } from '@atlas/test';
import { hashSecret, lookupOf } from '../../src/index.ts';
describe('hashSecret — pinned SHA-256 test vectors (security-critical)', function () {
    it('hashes the empty string to the FIPS 180-4 zero-length digest', function () {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
        expect(hashSecret('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
    it('hashes "abc" to the FIPS 180-4 §B.1 digest', function () {
        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.
        expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
    it('produces lowercase 64-char hex (no uppercase drift, no leading-zero pruning)', function () {
        // The inline impl previously used `.toString(16).padStart(2, '0')` which
        // is lowercase. The extracted impl must match. Pin the shape.
        const hex = hashSecret('regression-pin');
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
        expect(hex).toBe(hex.toLowerCase());
    });
    it('is deterministic — identical input always yields identical hex', function () {
        const a = hashSecret('a-particular-secret-value-here');
        const b = hashSecret('a-particular-secret-value-here');
        expect(a).toBe(b);
    });
});
describe('lookupOf — first-8-hex-char prefix invariant', function () {
    it('returns the first 8 chars of hashSecret(input)', function () {
        // SHA-256("abc") starts with ba7816bf, so lookupOf("abc") = "ba7816bf".
        expect(lookupOf('abc')).toBe('ba7816bf');
    });
    it('is exactly 8 lowercase hex chars', function () {
        const prefix = lookupOf('any-secret');
        expect(prefix).toMatch(/^[0-9a-f]{8}$/);
    });
    it('stays stable across calls — invite-accept lookups depend on this', function () {
        expect(lookupOf('invite-token-fixture')).toBe(lookupOf('invite-token-fixture'));
    });
});
