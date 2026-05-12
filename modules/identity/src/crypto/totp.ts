/**
 * TOTP — RFC 6238 with SHA-1 HMAC, 30s step, 6-digit codes.
 *
 * Standalone implementation: no external dep needed. Uses Node's
 * `crypto` (also available in browsers via Web Crypto for the future
 * sim-side wiring; the current Node-only entry point is sufficient
 * for Phase A5).
 *
 * Key derivation for the encrypted secret column happens here too —
 * AES-256-GCM with a per-tenant key. For Phase A5 the key derivation
 * uses a process-wide root key (env `IDENTITY_ENCRYPTION_KEY`, 32
 * bytes base64) hashed with the tenantId — the entity-level shape is
 * KMS-ready, the integration is post-A5 polish.
 */

import type { SecretStore } from '@atlas/ports';
import { must } from '../internal/assert.ts';
import { getIdentityCrypto } from './runtime.ts';

/** Name under which `IDENTITY_ENCRYPTION_KEY` (32 bytes base64) is read from `SecretStore`. */
export const IDENTITY_ENCRYPTION_KEY_NAME = 'IDENTITY_ENCRYPTION_KEY';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';

/** Random 20-byte (160-bit) TOTP secret — RFC 6238 §4. */
export function generateTotpSecret(): Uint8Array {
  return getIdentityCrypto().randomBytes(20);
}

/** Base32 encoding (no padding) — for the otpauth URI. */
export function base32Encode(buf: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Build the otpauth URI per the Google Authenticator spec.
 * `otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30`
 */
export function buildOtpauthUri(opts: {
  issuer: string;
  accountLabel: string;
  secret: Uint8Array;
}): string {
  const enc = encodeURIComponent;
  const label = `${enc(opts.issuer)}:${enc(opts.accountLabel)}`;
  const params = new URLSearchParams({
    secret: base32Encode(opts.secret),
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Compute the TOTP code at a given UNIX timestamp (seconds). */
export function totpAt(secret: Uint8Array, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

/** HOTP — the per-counter primitive. Exported for tests. */
export function hotp(secret: Uint8Array, counter: number): string {
  const counterBuf = new Uint8Array(8);
  // Big-endian uint64.
  new DataView(counterBuf.buffer).setUint32(0, Math.floor(counter / 0x100000000), false);
  new DataView(counterBuf.buffer).setUint32(4, counter & 0xffffffff, false);
  const hmac = getIdentityCrypto().hmacSha1(secret, counterBuf);
  // HMAC-SHA1 produces 20 bytes; offset is bounded to [0,15] by the low
  // nibble of the last byte, so offset..offset+3 are always in range.
  const lastByte = must(hmac[hmac.length - 1], 'hotp: hmac has trailing byte');
  const offset = lastByte & 0x0f;
  const b0 = must(hmac[offset], 'hotp: hmac[offset] in range');
  const b1 = must(hmac[offset + 1], 'hotp: hmac[offset+1] in range');
  const b2 = must(hmac[offset + 2], 'hotp: hmac[offset+2] in range');
  const b3 = must(hmac[offset + 3], 'hotp: hmac[offset+3] in range');
  const code = ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export interface TotpVerifyResult {
  ok: boolean;
  /** Counter the matching code was at. Undefined when no match. */
  matchedCounter?: number;
}

/**
 * Verify a presented TOTP code against the secret with ±1-step skew
 * (handles the natural 30s drift between client + server clocks).
 *
 * `lastUsedCounter` is the counter at the previous successful verify
 * — replay-protection: if the presented code is at counter <= last
 * used, reject. Caller persists the matched counter on success.
 */
export function verifyTotp(
  secret: Uint8Array,
  presented: string,
  opts: { lastUsedCounter?: number; nowSeconds?: number } = {},
): TotpVerifyResult {
  if (!/^\d{6}$/.test(presented)) return { ok: false };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const baseCounter = Math.floor(now / TOTP_STEP_SECONDS);
  for (const offset of [0, -1, 1] as const) {
    const counter = baseCounter + offset;
    if (counter < 0) continue;
    if (opts.lastUsedCounter !== undefined && counter <= opts.lastUsedCounter) {
      // Replay: a later counter has already been used.
      continue;
    }
    if (hotp(secret, counter) === presented) {
      return { ok: true, matchedCounter: counter };
    }
  }
  return { ok: false };
}

// =====================================================================
// AES-256-GCM secret encryption.
// =====================================================================

/**
 * Encryption-key id format: `tenant:<tenantId>:v1`. The actual key
 * material is derived per-tenant from a process-wide root via SHA-256
 * — sufficient for the trust model where the database can be
 * compromised but not the process memory. Production deployments
 * should swap to KMS-backed key derivation; the shape stays the same
 * (`encryptionKeyId` carries the kms-key-arn instead).
 */
export function encryptionKeyIdForTenant(tenantId: string): string {
  return `tenant:${tenantId}:v1`;
}

function deriveKeyForTenant(tenantId: string, secrets: SecretStore): Uint8Array {
  const crypto = getIdentityCrypto();
  const root = secrets.get(IDENTITY_ENCRYPTION_KEY_NAME) ?? '';
  // For tests + dev, fall back to a constant. PRODUCTION MUST seed
  // IDENTITY_ENCRYPTION_KEY (32 bytes base64) into the SecretStore.
  const rootBytes = root.length > 0 ? b64Decode(root) : new Uint8Array(32).fill(1);
  // sha256(rootBytes || '|' || tenantId)
  const sep = new TextEncoder().encode('|');
  const tid = new TextEncoder().encode(tenantId);
  const buf = new Uint8Array(rootBytes.length + sep.length + tid.length);
  buf.set(rootBytes, 0);
  buf.set(sep, rootBytes.length);
  buf.set(tid, rootBytes.length + sep.length);
  return crypto.sha256(buf);
}

/**
 * Encrypt the TOTP secret. Returns base64-encoded `iv|tag|ciphertext`.
 */
export function encryptSecret(
  plaintext: Uint8Array,
  tenantId: string,
  secrets: SecretStore,
): string {
  const crypto = getIdentityCrypto();
  const key = deriveKeyForTenant(tenantId, secrets);
  const iv = crypto.randomBytes(12);
  const { ciphertext, tag } = crypto.aesGcmEncrypt(key, iv, plaintext);
  const out = new Uint8Array(iv.length + tag.length + ciphertext.length);
  out.set(iv, 0);
  out.set(tag, iv.length);
  out.set(ciphertext, iv.length + tag.length);
  return b64Encode(out);
}

/**
 * Decrypt. Throws on AEAD failure (tampered ciphertext / wrong key).
 */
export function decryptSecret(
  encoded: string,
  tenantId: string,
  secrets: SecretStore,
): Uint8Array {
  const crypto = getIdentityCrypto();
  const buf = b64Decode(encoded);
  if (buf.length < 28) {
    throw new Error('encrypted secret too short');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const key = deriveKeyForTenant(tenantId, secrets);
  return crypto.aesGcmDecrypt(key, iv, ct, tag);
}

function b64Encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(must(bytes[i], 'b64Encode: index within bounds'));
  }
  return globalThis.btoa(s);
}

function b64Decode(str: string): Uint8Array {
  const bin = globalThis.atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
