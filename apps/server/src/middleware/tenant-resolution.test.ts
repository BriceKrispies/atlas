import { describe, it, expect, beforeEach } from 'vitest';
import type { CustomDomain, CustomDomainStore } from '@atlas/ports';
import { resolveHostTenant, TenantHostCache } from './tenant-resolution.ts';
class FakeStore implements CustomDomainStore {
    private rows = new Map<string, CustomDomain>();
    hits = 0;
    seed(rows: CustomDomain[]): void {
        for (const r of rows)
            this.rows.set(r.hostname, r);
    }
    async getByHostname(hostname: string): Promise<CustomDomain | null> {
        this.hits += 1;
        const r = this.rows.get(hostname);
        if (!r || r.status !== 'active')
            return null;
        return r;
    }
    // Unused in resolver tests.
    async getPrimary(): Promise<CustomDomain | null> { return null; }
    async list(): Promise<CustomDomain[]> { return []; }
    async add(): Promise<CustomDomain> { throw new Error('not implemented'); }
    async disable(): Promise<void> { }
}
function activeRow(hostname: string, tenantId: string): CustomDomain {
    return {
        hostname,
        tenantId,
        status: 'active',
        isPrimary: false,
        createdAt: '2026-01-01T00:00:00Z',
    };
}
describe('resolveHostTenant', function () {
    let store: FakeStore;
    let cache: TenantHostCache;
    beforeEach(function () {
        store = new FakeStore();
        cache = new TenantHostCache();
    });
    it('returns null for empty / undefined Host', async function () {
        expect(await resolveHostTenant(undefined, store, cache)).toBeNull();
        expect(await resolveHostTenant('', store, cache)).toBeNull();
        expect(await resolveHostTenant('   ', store, cache)).toBeNull();
    });
    it('returns the tenant id for an active hostname', async function () {
        store.seed([activeRow('community.acme.test', 'acme')]);
        expect(await resolveHostTenant('community.acme.test', store, cache)).toBe('acme');
    });
    it('returns null for unregistered hostnames', async function () {
        expect(await resolveHostTenant('nope.example.test', store, cache)).toBeNull();
    });
    it('does not return disabled rows', async function () {
        store.seed([{ ...activeRow('disabled.acme.test', 'acme'), status: 'disabled' }]);
        expect(await resolveHostTenant('disabled.acme.test', store, cache)).toBeNull();
    });
    it('normalizes Host before lookup (case + port + trailing dot)', async function () {
        store.seed([activeRow('community.acme.test', 'acme')]);
        expect(await resolveHostTenant('Community.Acme.Test', store, cache)).toBe('acme');
        expect(await resolveHostTenant('community.acme.test:8080', store, cache)).toBe('acme');
        expect(await resolveHostTenant('community.acme.test.', store, cache)).toBe('acme');
    });
    it('caches positive lookups (one DB hit across multiple calls)', async function () {
        store.seed([activeRow('community.acme.test', 'acme')]);
        await resolveHostTenant('community.acme.test', store, cache);
        await resolveHostTenant('community.acme.test', store, cache);
        await resolveHostTenant('community.acme.test', store, cache);
        expect(store.hits).toBe(1);
    });
    it('caches negative lookups (so the DB does not absorb every bad host)', async function () {
        await resolveHostTenant('attacker.example.test', store, cache);
        await resolveHostTenant('attacker.example.test', store, cache);
        expect(store.hits).toBe(1);
    });
    it('cache TTL expires; next call hits the store', async function () {
        let now = 1000000;
        const tickingClock = function (): number {
            return now;
        };
        const ttlCache = new TenantHostCache(60000, tickingClock);
        store.seed([activeRow('community.acme.test', 'acme')]);
        await resolveHostTenant('community.acme.test', store, ttlCache);
        now += 60001;
        await resolveHostTenant('community.acme.test', store, ttlCache);
        expect(store.hits).toBe(2);
    });
    it('cache.invalidate forces a re-lookup', async function () {
        store.seed([activeRow('community.acme.test', 'acme')]);
        await resolveHostTenant('community.acme.test', store, cache);
        cache.invalidate('community.acme.test');
        await resolveHostTenant('community.acme.test', store, cache);
        expect(store.hits).toBe(2);
    });
});
