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

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';

/** Random 20-byte (160-bit) TOTP secret — RFC 6238 §4. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** Base32 encoding (no padding) — for the otpauth URI. */
export function base32Encode(buf: Buffer): string {
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
  secret: Buffer;
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
export function totpAt(secret: Buffer, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

/** HOTP — the per-counter primitive. Exported for tests. */
export function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // Big-endian uint64.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac(TOTP_ALGORITHM, secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
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
  secret: Buffer,
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

function deriveKeyForTenant(tenantId: string): Buffer {
  const root = process.env['IDENTITY_ENCRYPTION_KEY'] ?? '';
  // For tests + dev, fall back to a constant. PRODUCTION MUST set
  // IDENTITY_ENCRYPTION_KEY (32 bytes base64).
  const rootBytes =
    root.length > 0 ? Buffer.from(root, 'base64') : Buffer.alloc(32, 1);
  return createHash('sha256')
    .update(rootBytes)
    .update('|')
    .update(tenantId)
    .digest();
}

/**
 * Encrypt the TOTP secret. Returns base64-encoded `iv|tag|ciphertext`.
 */
export function encryptSecret(plaintext: Buffer, tenantId: string): string {
  const key = deriveKeyForTenant(tenantId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt. Throws on AEAD failure (tampered ciphertext / wrong key).
 */
export function decryptSecret(encoded: string, tenantId: string): Buffer {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < 28) {
    throw new Error('encrypted secret too short');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const key = deriveKeyForTenant(tenantId);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
