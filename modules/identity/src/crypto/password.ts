/**
 * Password hashing — scrypt (RFC 7914) on Node's stdlib `crypto`.
 *
 * Replaces the prior Argon2id-via-`hash-wasm` implementation. scrypt
 * is older but still NIST-acceptable + OWASP-acceptable, and ships
 * in Node's stdlib so we don't carry a native or wasm dep. Same
 * threat model: defeat offline brute-force on stolen hashes.
 *
 * Parameters tuned for ~100ms hash time on a modest server:
 *   N=16384 (cost — 2^14 iterations of the inner loop)
 *   r=8     (block size)
 *   p=1     (parallelization)
 *   dkLen=32
 *   16-byte random salt
 *
 * Memory usage: 128 * N * r * p ≈ 16 MiB — comfortably under Node's
 * default `crypto.scrypt` maxmem cap (32 MiB) without touching it.
 *
 * Encoded format (PHC-flavored, parameter-self-describing so verify
 * can re-derive the params):
 *   `$scrypt$N=<N>,r=<r>,p=<p>$<saltBase64>$<hashBase64>`
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { IdentityError, codes } from '../errors.ts';

const N = 16384;
const R = 8;
const P = 1;
const DK_LEN = 32;
const SALT_LEN = 16;

const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

export function validatePasswordComplexity(password: string): void {
  if (password.length < MIN_LENGTH) {
    throw new IdentityError(
      codes.PASSWORD_COMPLEXITY,
      `password must be at least ${MIN_LENGTH} characters`,
      400,
    );
  }
  if (password.length > MAX_LENGTH) {
    throw new IdentityError(
      codes.PASSWORD_COMPLEXITY,
      `password must be at most ${MAX_LENGTH} characters`,
      400,
    );
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigitOrSymbol = /[^A-Za-z]/.test(password);
  const classes = [hasLower, hasUpper, hasDigitOrSymbol].filter(Boolean).length;
  if (classes < 2) {
    throw new IdentityError(
      codes.PASSWORD_COMPLEXITY,
      'password must mix at least two of: lowercase, uppercase, digit/symbol',
      400,
    );
  }
}

function encode(salt: Buffer, hash: Buffer): string {
  return `$scrypt$N=${N},r=${R},p=${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

interface Decoded {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Tagged decode result. `ok=false` carries a `reason` (machine-readable)
 * + optional `cause` (preserves the underlying Error). Callers can
 * surface this through their own logger / IdentityError without the
 * leaf utility taking a logger of its own — keeps the crypto module
 * port-surface-free.
 */
export type DecodeResult =
  | { ok: true; value: Decoded }
  | { ok: false; reason: string; cause?: unknown };

function decode(encoded: string): DecodeResult {
  // Split on `$`. PHC strings start with `$` so segments[0] is empty.
  const segments = encoded.split('$');
  if (segments.length !== 5 || segments[1] !== 'scrypt') {
    return { ok: false, reason: 'malformed_phc_envelope' };
  }
  const params = segments[2]!;
  const saltB64 = segments[3]!;
  const hashB64 = segments[4]!;
  const paramMap: Record<string, number> = {};
  for (const kv of params.split(',')) {
    const [k, v] = kv.split('=');
    if (!k || !v) return { ok: false, reason: 'malformed_param_kv' };
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: 'param_out_of_range' };
    }
    paramMap[k] = n;
  }
  if (!paramMap['N'] || !paramMap['r'] || !paramMap['p']) {
    return { ok: false, reason: 'missing_required_params' };
  }
  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    hash = Buffer.from(hashB64, 'base64');
  } catch (e) {
    // Preserve the underlying Buffer.from failure for callers that
    // want to log it. We don't take a logger here — a tagged result
    // keeps the leaf utility port-surface-free per the convention.
    return { ok: false, reason: 'base64_decode_failed', cause: e };
  }
  if (salt.length === 0) return { ok: false, reason: 'empty_salt' };
  if (hash.length === 0) return { ok: false, reason: 'empty_hash' };
  return {
    ok: true,
    value: {
      N: paramMap['N']!,
      r: paramMap['r']!,
      p: paramMap['p']!,
      salt,
      hash,
    },
  };
}

export async function hashPassword(password: string): Promise<string> {
  // `scryptSync` is CPU-bound; calling it from an async function
  // matches the pre-swap `hash-wasm` interface (Promise<string>)
  // without changing call sites. For server-side use the
  // synchronous behavior is fine — at ~100ms per call we're not
  // blocking the event loop meaningfully on a lightly-loaded auth
  // path.
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, DK_LEN, { N, r: R, p: P });
  return encode(salt, hash);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const result = verifyPasswordDetailed(password, storedHash);
  return result.then((r) => r.ok && r.matched);
}

/**
 * Detailed variant — surfaces decode + scrypt failures as a tagged
 * `reason` so callers can log without each call site re-implementing
 * the introspection. The boolean-returning `verifyPassword` wrapper
 * preserves the historical contract for hot-path code that doesn't
 * care about the failure mode.
 */
export type VerifyPasswordResult =
  | { ok: true; matched: boolean }
  | { ok: false; reason: string; cause?: unknown };

export async function verifyPasswordDetailed(
  password: string,
  storedHash: string,
): Promise<VerifyPasswordResult> {
  const decoded = decode(storedHash);
  if (!decoded.ok) {
    const out: VerifyPasswordResult = { ok: false, reason: decoded.reason };
    if (decoded.cause !== undefined) (out as { cause?: unknown }).cause = decoded.cause;
    return out;
  }
  const params = decoded.value;
  let computed: Buffer;
  try {
    computed = scryptSync(password, params.salt, params.hash.length, {
      N: params.N,
      r: params.r,
      p: params.p,
    });
  } catch (e) {
    // scrypt throws on illegal params — surface as a tagged failure
    // so the caller can decide whether to log + treat as a failed
    // verify. We do NOT take a logger here on purpose; leaf utility.
    return { ok: false, reason: 'scrypt_failed', cause: e };
  }
  if (computed.length !== params.hash.length) {
    return { ok: true, matched: false };
  }
  return { ok: true, matched: timingSafeEqual(computed, params.hash) };
}
