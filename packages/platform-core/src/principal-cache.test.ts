import { describe, expect, it } from '@atlas/test';
import { PrincipalCache } from './principal-cache.ts';
import type { Principal } from './types.ts';
function makePrincipal(overrides: Partial<Principal> = {}): Principal {
    return {
        principalId: 'p-1',
        tenantId: 't-1',
        userId: 'u-1',
        roles: ['member'],
        attributes: { email: 'a@b.c' },
        ...overrides,
    };
}
describe('PrincipalCache', function () {
    it('returns undefined on miss', function () {
        const c = new PrincipalCache();
        expect(c.get('t-1', 'p-1')).toBeUndefined();
    });
    it('round-trips a stored principal', function () {
        const c = new PrincipalCache();
        const p = makePrincipal();
        c.set('t-1', 'p-1', p);
        expect(c.get('t-1', 'p-1')).toBe(p);
    });
    it('isolates by tenant (I9)', function () {
        const c = new PrincipalCache();
        c.set('t-1', 'p-shared', makePrincipal({ tenantId: 't-1' }));
        c.set('t-2', 'p-shared', makePrincipal({ tenantId: 't-2' }));
        expect(c.get('t-1', 'p-shared')?.tenantId).toBe('t-1');
        expect(c.get('t-2', 'p-shared')?.tenantId).toBe('t-2');
    });
    it('expires positive entries after positiveTtlMs', function () {
        let now = 1000;
        const c = new PrincipalCache({
            positiveTtlMs: 100,
            now: function () {
                return now;
            },
        });
        c.set('t-1', 'p-1', makePrincipal({ userId: 'u-1' }));
        now = 1099;
        expect(c.get('t-1', 'p-1')).toBeDefined();
        now = 1101;
        expect(c.get('t-1', 'p-1')).toBeUndefined();
    });
    it('expires negative entries after negativeTtlMs', function () {
        let now = 1000;
        const c = new PrincipalCache({
            positiveTtlMs: 60000,
            negativeTtlMs: 50,
            now: function () {
                return now;
            },
        });
        c.set('t-1', 'p-1', makePrincipal({ userId: null }));
        now = 1049;
        expect(c.get('t-1', 'p-1')).toBeDefined();
        now = 1051;
        expect(c.get('t-1', 'p-1')).toBeUndefined();
    });
    it('evicts the oldest entry when at capacity', function () {
        const c = new PrincipalCache({ capacity: 2 });
        c.set('t', 'p-1', makePrincipal({ principalId: 'p-1' }));
        c.set('t', 'p-2', makePrincipal({ principalId: 'p-2' }));
        c.set('t', 'p-3', makePrincipal({ principalId: 'p-3' }));
        expect(c.get('t', 'p-1')).toBeUndefined();
        expect(c.get('t', 'p-2')).toBeDefined();
        expect(c.get('t', 'p-3')).toBeDefined();
    });
    it('LRU-touches on get so recently accessed entries survive eviction', function () {
        const c = new PrincipalCache({ capacity: 2 });
        c.set('t', 'p-1', makePrincipal({ principalId: 'p-1' }));
        c.set('t', 'p-2', makePrincipal({ principalId: 'p-2' }));
        c.get('t', 'p-1');
        c.set('t', 'p-3', makePrincipal({ principalId: 'p-3' }));
        expect(c.get('t', 'p-1')).toBeDefined();
        expect(c.get('t', 'p-2')).toBeUndefined();
        expect(c.get('t', 'p-3')).toBeDefined();
    });
    it('invalidate(tenantId, userId) drops only matching entries', function () {
        const c = new PrincipalCache();
        c.set('t-1', 'p-A', makePrincipal({ principalId: 'p-A', userId: 'u-1' }));
        c.set('t-1', 'p-B', makePrincipal({ principalId: 'p-B', userId: 'u-2' }));
        c.set('t-2', 'p-C', makePrincipal({ tenantId: 't-2', principalId: 'p-C', userId: 'u-1' }));
        c.invalidate('t-1', 'u-1');
        expect(c.get('t-1', 'p-A')).toBeUndefined();
        expect(c.get('t-1', 'p-B')).toBeDefined();
        expect(c.get('t-2', 'p-C')).toBeDefined();
    });
    it('invalidateTenant drops every principal in the tenant', function () {
        const c = new PrincipalCache();
        c.set('t-1', 'p-A', makePrincipal({ principalId: 'p-A' }));
        c.set('t-1', 'p-B', makePrincipal({ principalId: 'p-B' }));
        c.set('t-2', 'p-C', makePrincipal({ tenantId: 't-2', principalId: 'p-C' }));
        c.invalidateTenant('t-1');
        expect(c.get('t-1', 'p-A')).toBeUndefined();
        expect(c.get('t-1', 'p-B')).toBeUndefined();
        expect(c.get('t-2', 'p-C')).toBeDefined();
    });
    it('overwrites on repeated set without growing past capacity', function () {
        const c = new PrincipalCache({ capacity: 2 });
        c.set('t', 'p', makePrincipal({ roles: ['old'] }));
        c.set('t', 'p', makePrincipal({ roles: ['new'] }));
        expect(c.size()).toBe(1);
        expect(c.get('t', 'p')?.roles).toEqual(['new']);
    });
});
