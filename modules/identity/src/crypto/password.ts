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

import { IdentityError, codes } from '../errors.ts';
import { must } from '../internal/assert.ts';
import { getIdentityCrypto } from './runtime.ts';

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

function encode(salt: Uint8Array, hash: Uint8Array): string {
  return `$scrypt$N=${N},r=${R},p=${P}$${b64Encode(salt)}$${b64Encode(hash)}`;
}

interface Decoded {
  N: number;
  r: number;
  p: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function b64Encode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(must(bytes[i], 'b64Encode: index within bounds'));
  }
  return globalThis.btoa(str);
}

function b64Decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
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
  const params = must(segments[2], 'decode: segments[2] present (length checked)');
  const saltB64 = must(segments[3], 'decode: segments[3] present (length checked)');
  const hashB64 = must(segments[4], 'decode: segments[4] present (length checked)');
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
  const nParam = paramMap['N'];
  const rParam = paramMap['r'];
  const pParam = paramMap['p'];
  if (!nParam || !rParam || !pParam) {
    return { ok: false, reason: 'missing_required_params' };
  }
  let salt: Uint8Array;
  let hash: Uint8Array;
  try {
    salt = b64Decode(saltB64);
    hash = b64Decode(hashB64);
  } catch (e) {
    // Preserve the underlying decode failure for callers that
    // want to log it. We don't take a logger here — a tagged result
    // keeps the leaf utility port-surface-free per the convention.
    return { ok: false, reason: 'base64_decode_failed', cause: e };
  }
  if (salt.length === 0) return { ok: false, reason: 'empty_salt' };
  if (hash.length === 0) return { ok: false, reason: 'empty_hash' };
  return {
    ok: true,
    value: {
      N: nParam,
      r: rParam,
      p: pParam,
      salt,
      hash,
    },
  };
}

export async function hashPassword(password: string): Promise<string> {
  // The crypto port's `scrypt` is sync (CPU-bound); we keep this
  // function async to preserve the pre-port `hash-wasm` interface
  // (Promise<string>) so call sites don't churn. For server-side
  // use the sync behavior is fine — at ~100ms per call we're not
  // blocking the event loop meaningfully on a lightly-loaded auth path.
  const crypto = getIdentityCrypto();
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scrypt(password, salt, DK_LEN, { N, r: R, p: P });
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
  const crypto = getIdentityCrypto();
  let computed: Uint8Array;
  try {
    computed = crypto.scrypt(password, params.salt, params.hash.length, {
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
  return { ok: true, matched: crypto.timingSafeEqual(computed, params.hash) };
}
