/**
 * Argon2id password hashing — browser-safe via `hash-wasm`.
 *
 * `hash-wasm` ships a wasm Argon2 implementation that runs identically
 * in Node (server) and the browser (apps/sim, BDD harness). API is
 * promise-based; encoded output is the standard PHC string
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`).
 *
 * Plan-fixed parameters (Tier 3 cryptography choices):
 *   - memoryCost: 64 MiB (memorySize=65536 in hash-wasm's KB units)
 *   - timeCost: 3 (iterations)
 *   - parallelism: 4
 *
 * Tuned for ~250ms hash time on a modest server. WebCrypto's
 * `getRandomValues` for the salt — works in both runtimes.
 */

import { argon2id, argon2Verify } from 'hash-wasm';
import { IdentityError, codes } from '../errors.ts';

const MEMORY_KB = 64 * 1024;
const ITERATIONS = 3;
const PARALLELISM = 4;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

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

function randomSalt(): Uint8Array {
  const buf = new Uint8Array(SALT_LENGTH);
  // `crypto.getRandomValues` is on the global `crypto` in Node 20+
  // and the browser. No `node:crypto` import — keeps the module
  // browser-bundleable without conditional branches.
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomSalt(),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KB,
    hashLength: HASH_LENGTH,
    outputType: 'encoded',
  });
}

/**
 * Verify a presented password against a stored Argon2id PHC string.
 * Returns false on mismatch. Throws on malformed hash (a stored hash
 * that fails to parse is a programming error, not a wrong password).
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return argon2Verify({ password, hash: storedHash });
}
