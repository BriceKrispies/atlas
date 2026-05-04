// Generic environment-variable helpers shared by Node services.
//
// The Rust ingress's strict-mode semantics live in
// `crates/atlas_config/src/lib.rs`; the helpers below mirror them so any
// TS service can opt into the same envelope without copying private
// implementations. Keep additions strictly generic — service-specific
// defaults (e.g. OIDC audience fallbacks) belong in the consuming app.

/** Parses an env var as a boolean. Returns false when unset. */
export function envBool(name: string): boolean {
  const v = process.env[name];
  if (v === undefined) return false;
  const lower = v.toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

/** Returns the env var's value, or `fallback` when unset/empty. */
export function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Returns the env var's value, or throws when unset/empty. */
export function envRequired(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`required env var ${name} is unset`);
  }
  return v;
}

/**
 * Strict mode is the default. It is relaxed only when the test-auth
 * pathway is explicitly enabled (`TEST_AUTH_ENABLED=true`) or when
 * `ATLAS_ENV=dev` is set. Mirrors `atlas_env()` in
 * `crates/atlas_config/src/lib.rs`, with the additional TS-side
 * convention that `TEST_AUTH_ENABLED` also implies dev mode.
 */
export function isStrictMode(): boolean {
  if (process.env['ATLAS_ENV'] === 'dev') return false;
  if (envBool('TEST_AUTH_ENABLED')) return false;
  return true;
}

/**
 * Asserts that an env var is NOT set in strict mode. Mirrors
 * `forbid_in_strict(key, reason)` in `crates/atlas_config/src/lib.rs`.
 */
export function forbidInStrict(name: string, reason: string): void {
  if (isStrictMode() && process.env[name] !== undefined) {
    throw new Error(
      `Environment variable '${name}' is forbidden in strict mode. ${reason}`,
    );
  }
}
