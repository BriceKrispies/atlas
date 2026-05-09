/**
 * Per-process Crypto resolver for the identity module.
 *
 * Identity's crypto helpers (id factories, password hashing, secret
 * encoding, TOTP encrypt/decrypt) are sync today and called from
 * dozens of code paths. Threading a `Crypto` port through every
 * caller would be massive churn for no abstraction gain at the
 * call site. Instead the host wires a `Crypto` once at boot via
 * `setIdentityCrypto`, and the leaf utilities resolve through here.
 *
 * Closes ADR 0008 leak #1: modules MUST NOT import `node:crypto`.
 * The resolver is the only seam; the actual implementation lives in
 * an adapter (NodeCrypto today, future swap-ins same surface).
 *
 * The resolver throws if no Crypto has been wired — fail loud at
 * first call rather than silently use a broken default.
 */

import type { Crypto } from '@atlas/ports';

let _crypto: Crypto | null = null;

export function setIdentityCrypto(crypto: Crypto): void {
  _crypto = crypto;
}

export function getIdentityCrypto(): Crypto {
  if (_crypto === null) {
    throw new Error(
      'identity Crypto not configured — call setIdentityCrypto(new NodeCrypto()) at boot',
    );
  }
  return _crypto;
}
