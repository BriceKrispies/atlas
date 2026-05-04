/**
 * Argon2id password hashing.
 *
 * Plan-fixed parameters (Tier 3 cryptography choices):
 *   - memoryCost: 64 MiB
 *   - timeCost: 3
 *   - parallelism: 4
 *
 * These are tuned for ~250ms hash time on a modest server — slow enough
 * to defeat offline brute-force, fast enough to stay under per-request
 * latency budgets. Calibrate per deployment if profiling shows drift.
 *
 * `@node-rs/argon2` ships prebuilt napi binaries for major platforms
 * (no native build required). The encoded output includes the algorithm,
 * params, and salt — no need to track them separately.
 */

import { hash, verify } from '@node-rs/argon2';
import { IdentityError, codes } from '../errors.ts';

// Argon2id is the default algorithm in @node-rs/argon2 — pinning it
// inline via the const-enum value (2) would trip verbatimModuleSyntax,
// and the library accepts the numeric form. We omit `algorithm` instead
// and rely on the default. If a future bump changes the default we'll
// catch it via the verify roundtrip in the unit tests.
const ARGON2_OPTIONS = {
  memoryCost: 64 * 1024, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Tier 3 password complexity rules.
 *
 * Minimum 12 characters. NIST SP 800-63B-recommended approach: length over
 * character-class diversity. We keep one cheap class check (mixed case OR
 * a digit/symbol) so trivial all-lowercase passwords are blocked, but we
 * deliberately don't require all four classes — that's known to push users
 * toward `Password1!`-style patterns that are weaker than longer
 * passphrases.
 */
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
    // Argon2 handles arbitrary lengths but a 1MB password is suspicious
    // and DoS-shaped. Cap at a generous 256.
    throw new IdentityError(
      codes.PASSWORD_COMPLEXITY,
      `password must be at most ${MAX_LENGTH} characters`,
      400,
    );
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigitOrSymbol = /[^A-Za-z]/.test(password);
  // At least two of {lower, upper, digit-or-symbol}. Length carries
  // most of the entropy; this is a floor against `aaaaaaaaaaaa`.
  const classes = [hasLower, hasUpper, hasDigitOrSymbol].filter(Boolean).length;
  if (classes < 2) {
    throw new IdentityError(
      codes.PASSWORD_COMPLEXITY,
      'password must mix at least two of: lowercase, uppercase, digit/symbol',
      400,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a presented password against a stored Argon2id hash.
 * Returns false on mismatch, throws on malformed hash (a stored hash
 * that fails to parse is a programming error, not a wrong password).
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return verify(storedHash, password);
}
