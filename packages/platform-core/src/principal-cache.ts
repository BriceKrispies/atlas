/**
 * In-process LRU+TTL cache for `enrichPrincipal` results.
 *
 * Why this exists: principal enrichment runs three tenant-pool queries
 * (`findUserByIdpSubject`, optional `getUserEntity` fallback, and
 * `getMembershipEntity`) every authenticated request. Profiling under
 * sustained POST `/api/v1/intents` load showed the per-tenant pool was
 * spending most of its time serving these reads. Caching the enriched
 * `Principal` for a short window collapses N requests per principal back
 * down to one DB round-trip per TTL.
 *
 * Scope: in-process. Single-replica reference instance per current
 * deployment; cross-replica fan-out is on the roadmap with the same
 * Redis broadcast that will replace `ServerEventBroadcast`.
 *
 * Invalidation: write paths emit `User:<userId>` and
 * `Membership:<tenantId>:<userId>` cache-invalidation tags. The
 * `principalCacheDispatcher` (wired in `apps/server`) calls
 * `invalidate(tenantId, userId)` whenever such a tag flows through. The
 * TTL is a safety net for events that bypass the dispatcher; it should
 * not be the primary correctness mechanism.
 *
 * Negative results (`userId: null` — bootstrap / service principals)
 * are cached too, with a shorter TTL, so an unknown-principal storm
 * cannot DOS the pool either.
 */

import type { Principal } from '@atlas/abi';

export interface PrincipalCacheOptions {
  /** Maximum cached entries before LRU eviction. Default 10000. */
  readonly capacity?: number;
  /** TTL for entries with a resolved `userId`. Default 60s. */
  readonly positiveTtlMs?: number;
  /** TTL for entries that resolved to `userId: null`. Default 5s. */
  readonly negativeTtlMs?: number;
  /** Override for `Date.now()` — testing only. */
  readonly now?: () => number;
}

interface Entry {
  readonly principal: Principal;
  readonly expiresAt: number;
}

const DEFAULT_CAPACITY = 10_000;
const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 5_000;

export class PrincipalCache {
  private readonly capacity: number;
  private readonly positiveTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly now: () => number;
  // Map preserves insertion order, which we abuse as recency: on access
  // we delete-and-reinsert so the most recently used key is last.
  private readonly entries = new Map<string, Entry>();

  constructor(opts: PrincipalCacheOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.positiveTtlMs = opts.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS;
    this.negativeTtlMs = opts.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  get(tenantId: string, principalId: string): Principal | undefined {
    const key = makeKey(tenantId, principalId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU touch.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.principal;
  }

  set(tenantId: string, principalId: string, principal: Principal): void {
    const key = makeKey(tenantId, principalId);
    const ttl = principal.userId == null ? this.negativeTtlMs : this.positiveTtlMs;
    const expiresAt = this.now() + ttl;
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { principal, expiresAt });
  }

  /**
   * Drop every cached principal in `tenantId` whose enrichment resolved
   * to `userId`. Scan-based — invalidation traffic is event-driven and
   * low-volume; a secondary index would cost more on the read path
   * than it saves on this one.
   */
  invalidate(tenantId: string, userId: string): void {
    for (const [key, entry] of this.entries) {
      if (
        entry.principal.tenantId === tenantId &&
        entry.principal.userId === userId
      ) {
        this.entries.delete(key);
      }
    }
  }

  /** Drop every cached principal in `tenantId`. Used for tenant-wide events. */
  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId}::`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /** Drop everything. Testing / shutdown only. */
  clear(): void {
    this.entries.clear();
  }

  /** Current entry count. Testing / metrics. */
  size(): number {
    return this.entries.size;
  }
}

function makeKey(tenantId: string, principalId: string): string {
  // Tenant prefix satisfies I9 (cache keys MUST include tenantId).
  return `${tenantId}::${principalId}`;
}
