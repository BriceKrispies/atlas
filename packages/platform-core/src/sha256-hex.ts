/**
 * SHA-256 of `input`, hex-encoded (lowercase, 64 chars).
 *
 * Re-exported from `@atlas/platform-core` per
 * `specs/crosscut/scenario-fuzzing.md` §7 ("Re-export `prngFromSeed`,
 * `sha256Hex`, `canonicalJsonStringify` from `@atlas/platform-core`").
 * One canonical implementation lives here; modules + adapters that
 * need a hex-encoded sha256 (seeder `contentHash`, idempotency-key
 * derivation, repository upload hash check, etc.) import it rather
 * than rolling their own.
 *
 * Goes through the `Crypto` port — never imports `node:crypto`
 * directly. ADR 0008 leak #1: modules MUST NOT pull `node:crypto`;
 * they take a `Crypto` from the host. This utility honours that by
 * accepting the port and delegating the digest to it.
 *
 * Determinism: identical `input` MUST always produce identical
 * output. Used as the basis for `contentHash` (seed-corpus.md §4.1)
 * and `idempotencyKey` (seed-corpus.md §4.3); both contracts hinge
 * on this invariant.
 */

/**
 * Minimal structural shape of the `Crypto` port required by
 * `sha256Hex`. Declared structurally (rather than imported from
 * `@atlas/ports`) to avoid a circular dependency: `@atlas/ports`
 * already depends on `@atlas/platform-core`. Anything implementing
 * `@atlas/ports`'s `Crypto` interface satisfies this shape
 * automatically — the parameter accepts the full `Crypto` port at
 * call sites without further adaptation.
 */
interface CryptoSha256Shape {
  sha256(input: string | Uint8Array): Uint8Array;
}

export function sha256Hex(input: string | Uint8Array, crypto: CryptoSha256Shape): string {
  const digest = crypto.sha256(input);
  let hex = '';
  for (let i = 0; i < digest.length; i += 1) {
    const b = digest[i];
    if (b === undefined) continue;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
