/**
 * Tenant resolution from the request Host header.
 *
 * Pure resolver function plus a tiny TTL cache wrapper. The cache exists
 * because the lookup runs on every request to a custom-domain hostname
 * (one DB round trip per request would be wasteful).
 *
 * The cache is **per-process** with a 60-second TTL. When the
 * `Tenancy.CustomDomainAdded` / `…Disabled` events ship in the real flow,
 * the dispatcher should call `cache.invalidate(hostname)` so changes
 * propagate immediately. For the stub, 60s eventual consistency is fine.
 *
 * Hostname normalization (lowercase + strip port + strip trailing dot) is
 * done here so the principal middleware can pass the raw Host header
 * value verbatim.
 */
import type { CustomDomainStore } from '@atlas/ports';
import { normalizeHost } from '@atlas/platform-core';
const DEFAULT_TTL_MS = 60000;
interface CacheEntry {
    /**
     * Tenant id resolved for the hostname, or null if the hostname has no
     * registered (active) row. Negative caching matters: every request to
     * an unrecognised host shouldn't hit the DB.
     */
    tenantId: string | null;
    expiresAt: number;
}
export class TenantHostCache {
    private readonly entries = new Map<string, CacheEntry>();
    constructor(private readonly ttlMs: number = DEFAULT_TTL_MS, private readonly clock: () => number = function () {
        return Date.now();
    }) { }
    get(hostname: string): string | null | undefined {
        const e = this.entries.get(hostname);
        if (!e)
            return undefined;
        if (e.expiresAt <= this.clock()) {
            this.entries.delete(hostname);
            return undefined;
        }
        return e.tenantId;
    }
    set(hostname: string, tenantId: string | null): void {
        this.entries.set(hostname, {
            tenantId,
            expiresAt: this.clock() + this.ttlMs,
        });
    }
    /** Drop a specific hostname. Wired to events when the real flow lands. */
    invalidate(hostname: string): void {
        this.entries.delete(hostname);
    }
    /** Drop everything. Used by tests; useful if cert / status changes en masse. */
    clear(): void {
        this.entries.clear();
    }
    /** Visible for tests. */
    size(): number {
        return this.entries.size;
    }
}
/**
 * Resolve a Host header to a tenant id, with caching.
 *
 * Returns `null` when:
 *   - the host is missing / empty
 *   - the host is registered but disabled
 *   - the host has no row at all
 *
 * Callers handle each of those the same way: no Host-derived tenant
 * constraint applies; fall through to the existing auth flow.
 */
export async function resolveHostTenant(rawHost: string | undefined, store: CustomDomainStore, cache: TenantHostCache): Promise<string | null> {
    if (!rawHost || rawHost.trim().length === 0)
        return null;
    const host = normalizeHost(rawHost);
    if (host.length === 0)
        return null;
    const cached = cache.get(host);
    if (cached !== undefined)
        return cached;
    const row = await store.getByHostname(host);
    const tenantId = row?.tenantId ?? null;
    cache.set(host, tenantId);
    return tenantId;
}
