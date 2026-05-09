/**
 * SecretStore — read-only key/value lookup for boot-loaded secrets.
 *
 * Synchronous because secrets are loaded once at process startup; at
 * request time the store is just an in-memory map. The shape is
 * deliberately narrow — write paths (rotation, sealed-secret unsealing,
 * KMS bridging) live in the adapter implementations, not in the port.
 *
 * Returns `null` for absent keys. Callers decide whether absence is a
 * fatal boot error (e.g. `IDENTITY_ENCRYPTION_KEY` in production) or a
 * legitimate default (dev fallback).
 *
 * Per ADR 0008 (Atlas-on-Atlas) leak #4: modules MUST NOT read
 * `process.env` directly. They take a `SecretStore` and ask for the
 * named key. The runtime adapter (Node/k8s) decides where the bytes
 * actually come from.
 */
export interface SecretStore {
  get(name: string): string | null;
}
