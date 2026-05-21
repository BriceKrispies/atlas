/**
 * Crypto — synchronous primitives for identity and other modules.
 *
 * Sync because the existing call sites (id factories, password verify,
 * secret hash, TOTP encrypt/decrypt) are sync today and threading
 * promises through every caller is gratuitous churn for ~100µs of
 * work. Adapters that have async-only backends (browser WebCrypto for
 * sha256/HMAC, scrypt over WASM) must satisfy this contract by
 * blocking-or-throwing — see ADR 0008 §5: the IDB adapter is scoped
 * to tenant-app data, so it isn't expected to implement the AEAD or
 * scrypt methods.
 *
 * Per ADR 0008 (Atlas-on-Atlas) leak #1: modules MUST NOT import
 * `node:crypto`. They get a `Crypto` from the host (apps/server boots
 * it once; identity reads it through `setIdentityCrypto` at boot).
 */
export interface Crypto {
  /** Cryptographically secure random bytes. */
  randomBytes(n: number): Uint8Array;

  /** SHA-256 of `input`. Returns the 32-byte digest. */
  sha256(input: Uint8Array | string): Uint8Array;

  /** HMAC-SHA-1. Used by RFC 6238 TOTP. */
  hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array;

  /**
   * AES-256-GCM authenticated encryption. `key` MUST be 32 bytes;
   * `iv` is taken from inside `randomBytes(12)` by the caller.
   * Returns `iv || tag || ciphertext` concatenated.
   */
  aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
  ): {
    ciphertext: Uint8Array;
    tag: Uint8Array;
  };
  aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    tag: Uint8Array,
  ): Uint8Array;

  /**
   * scrypt password derivation (RFC 7914). Sync because Node's
   * `scryptSync` is sync; browser adapters that lack sync scrypt
   * (i.e. all of them, today) are expected to throw.
   */
  scrypt(
    password: string,
    salt: Uint8Array,
    dkLen: number,
    params: { N: number; r: number; p: number },
  ): Uint8Array;

  /** Constant-time byte comparison. */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
