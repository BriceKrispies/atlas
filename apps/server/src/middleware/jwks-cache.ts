/**
 * Per-tenant JWKS cache.
 *
 * The principal middleware verifies a JWT against the issuing tenant's
 * IdentityProvider's JWKS (NOT a global JWKS). Resolving JWKS on every
 * request would mean an HTTP fetch in the auth path — unacceptable.
 * The cache holds parsed `JWKSet` instances keyed by
 * `(tenantId, idpId, jwksUri)`.
 *
 * Refresh policy:
 *   - on cache MISS → fetch
 *   - on `kid` MISS during verify → refresh, but rate-limited (one
 *     refetch per `MIN_REFETCH_MS` per (tenantId, idpId)) so a flood
 *     of bad-kid requests can't DoS the IDP
 *   - on RotateJwks intent → invalidate (sets entry to null,
 *     next-fetch refreshes); also invalidated by the
 *     `Jwks:<idpId>` cache tag emitted on the RotateJwks event.
 *
 * Process-local — for multi-replica deployments the cache divergence
 * is bounded by `MIN_REFETCH_MS` (5min). Tighter coherence is a
 * Phase A4-or-later refinement.
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

interface CacheEntry {
  /** The parsed JWKS resolver. */
  resolver: JWTVerifyGetKey;
  /** Wall-clock of the most recent fetch. Drives the refetch rate-limit. */
  fetchedAt: number;
  /** The `jwks_uri` this entry resolved against. */
  jwksUri: string;
}

const MIN_REFETCH_MS = 5 * 60 * 1000;

export class JwksCache {
  private readonly entries = new Map<string, CacheEntry>();

  private key(tenantId: string, idpId: string): string {
    return `${tenantId}::${idpId}`;
  }

  /**
   * Resolve a JWKS for `(tenantId, idpId)`. Rebuilds when the URI
   * changed, fetched-at is missing, or the caller forces a refresh
   * (e.g., `kid` miss path).
   */
  resolve(
    tenantId: string,
    idpId: string,
    jwksUri: string,
    opts: { forceRefetch?: boolean } = {},
  ): JWTVerifyGetKey {
    const k = this.key(tenantId, idpId);
    const existing = this.entries.get(k);
    const now = Date.now();
    const uriChanged = existing && existing.jwksUri !== jwksUri;
    const wantsRefetch = opts.forceRefetch ?? false;
    const refetchAllowed =
      !existing || now - existing.fetchedAt >= MIN_REFETCH_MS;
    const shouldRebuild =
      !existing ||
      uriChanged ||
      (wantsRefetch && refetchAllowed);
    if (existing && !shouldRebuild) {
      return existing.resolver;
    }
    const resolver = createRemoteJWKSet(new URL(jwksUri));
    this.entries.set(k, { resolver, fetchedAt: now, jwksUri });
    return resolver;
  }

  /**
   * Invalidate a single (tenantId, idpId) entry — called from the
   * `RotateJwks` cache-tag dispatcher when a `Jwks:<idpId>` tag is
   * emitted. Next `resolve` rebuilds.
   */
  invalidate(tenantId: string, idpId: string): void {
    this.entries.delete(this.key(tenantId, idpId));
  }

  /** Drop everything (test reset, process-wide invalidation). */
  invalidateAll(): void {
    this.entries.clear();
  }
}
