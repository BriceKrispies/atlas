import { describe, test, expect, beforeEach } from 'vitest';
import type { Crypto } from '@atlas/ports';
const utf8 = new TextEncoder();
const SHA256_HELLO_WORLD_HEX = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
/**
 * Contract any full `Crypto` adapter must satisfy. `NodeCrypto`
 * (`@atlas/adapter-node`) is the only adapter that runs the full suite.
 * `WebCrypto` (`@atlas/adapter-idb`) is partial by design — see ADR
 * 0008 §5 — and runs the random + timingSafeEqual subset only.
 */
export function cryptoContract(makeCrypto: () => Promise<Crypto>): void {
    describe('Crypto contract — full', function () {
        let c: Crypto;
        beforeEach(async function () {
            c = await makeCrypto();
        });
        test('randomBytes returns a Uint8Array of the requested length', function () {
            const buf = c.randomBytes(16);
            expect(buf).toBeInstanceOf(Uint8Array);
            expect(buf.length).toBe(16);
        });
        test('randomBytes returns different bytes across calls (probabilistic)', function () {
            const a = c.randomBytes(32);
            const b = c.randomBytes(32);
            expect(a).not.toEqual(b);
        });
        test('sha256 of "hello world" matches the canonical vector', function () {
            const digest = c.sha256('hello world');
            expect(Buffer.from(digest).toString('hex')).toBe(SHA256_HELLO_WORLD_HEX);
        });
        test('sha256 accepts both Uint8Array and string input', function () {
            const fromStr = c.sha256('atlas');
            const fromBytes = c.sha256(utf8.encode('atlas'));
            expect(fromStr).toEqual(fromBytes);
        });
        test('hmacSha1 produces the RFC 2202 test-1 vector', function () {
            const key = new Uint8Array(20).fill(0x0b);
            const msg = utf8.encode('Hi There');
            const mac = c.hmacSha1(key, msg);
            expect(Buffer.from(mac).toString('hex')).toBe('b617318655057264e28bc0b6fb378c8ef146be00');
        });
        test('aesGcm round-trips plaintext under the same key + iv', function () {
            const key = c.randomBytes(32);
            const iv = c.randomBytes(12);
            const plaintext = utf8.encode('the quick brown fox');
            const { ciphertext, tag } = c.aesGcmEncrypt(key, iv, plaintext);
            const decrypted = c.aesGcmDecrypt(key, iv, ciphertext, tag);
            expect(decrypted).toEqual(plaintext);
        });
        test('aesGcm rejects tampered ciphertext (AEAD)', function () {
            const key = c.randomBytes(32);
            const iv = c.randomBytes(12);
            const plaintext = utf8.encode('atlas');
            const { ciphertext, tag } = c.aesGcmEncrypt(key, iv, plaintext);
            const tampered = new Uint8Array(ciphertext);
            const first = tampered[0];
            if (first === undefined)
                throw new Error('ciphertext empty');
            tampered[0] = first ^ 0xff;
            expect(function () {
                return c.aesGcmDecrypt(key, iv, tampered, tag);
            }).toThrow();
        });
        test('scrypt is deterministic for the same inputs', function () {
            const salt = new Uint8Array(16).fill(0x42);
            const a = c.scrypt('password', salt, 32, { N: 1024, r: 8, p: 1 });
            const b = c.scrypt('password', salt, 32, { N: 1024, r: 8, p: 1 });
            expect(a).toEqual(b);
            expect(a.length).toBe(32);
        });
        test('timingSafeEqual returns true on equal byte arrays', function () {
            const a = new Uint8Array([1, 2, 3, 4]);
            const b = new Uint8Array([1, 2, 3, 4]);
            expect(c.timingSafeEqual(a, b)).toBe(true);
        });
        test('timingSafeEqual returns false on length mismatch', function () {
            expect(c.timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
        });
    });
}
