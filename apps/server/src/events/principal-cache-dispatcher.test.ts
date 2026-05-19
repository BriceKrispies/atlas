import { describe, expect, it } from 'vitest';
import { PrincipalCache } from '@atlas/platform-core';
import type { EventEnvelope, Principal } from '@atlas/platform-core';
import { principalCacheDispatcher } from './principal-cache-dispatcher.ts';
function principal(overrides: Partial<Principal> = {}): Principal {
    return {
        principalId: 'p-1',
        tenantId: 't-1',
        userId: 'u-1',
        roles: [],
        attributes: {},
        ...overrides,
    };
}
function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
    return {
        eventId: 'evt-1',
        eventType: 'Identity.UserUpdated',
        schemaId: 'identity.user.update.v1',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: 't-1',
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
        principalId: null,
        userId: null,
        payload: { actionId: 'Identity.User.Update', resourceType: 'User' },
        ...overrides,
    };
}
describe('principalCacheDispatcher', function () {
    it('is a no-op when the envelope carries no tags', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-1', principal());
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({ cacheInvalidationTags: null }));
        expect(cache.get('t-1', 'p-1')).toBeDefined();
    });
    it('invalidates the matching principal on a User:<userId> tag', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A', userId: 'u-1' }));
        cache.set('t-1', 'p-B', principal({ principalId: 'p-B', userId: 'u-2' }));
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({ cacheInvalidationTags: ['User:u-1'] }));
        expect(cache.get('t-1', 'p-A')).toBeUndefined();
        expect(cache.get('t-1', 'p-B')).toBeDefined();
    });
    it('invalidates by tenantId + userId on a Membership:<tenantId>:<userId> tag', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A', userId: 'u-1' }));
        cache.set('t-2', 'p-A', principal({ tenantId: 't-2', principalId: 'p-A', userId: 'u-1' }));
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({ cacheInvalidationTags: ['Membership:t-1:u-1'] }));
        expect(cache.get('t-1', 'p-A')).toBeUndefined();
        expect(cache.get('t-2', 'p-A')).toBeDefined();
    });
    it('invalidates every principal in the tenant on a Tenant:<id> tag', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A' }));
        cache.set('t-1', 'p-B', principal({ principalId: 'p-B' }));
        cache.set('t-2', 'p-C', principal({ tenantId: 't-2', principalId: 'p-C' }));
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({ cacheInvalidationTags: ['Tenant:t-1'] }));
        expect(cache.get('t-1', 'p-A')).toBeUndefined();
        expect(cache.get('t-1', 'p-B')).toBeUndefined();
        expect(cache.get('t-2', 'p-C')).toBeDefined();
    });
    it('handles compound tag lists (Tenant + User + Membership) in one pass', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A', userId: 'u-1' }));
        cache.set('t-1', 'p-B', principal({ principalId: 'p-B', userId: 'u-2' }));
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({
            cacheInvalidationTags: [
                `Tenant:t-1`,
                `User:u-1`,
                `Membership:t-1:u-1`,
            ],
        }));
        expect(cache.get('t-1', 'p-A')).toBeUndefined();
        expect(cache.get('t-1', 'p-B')).toBeUndefined();
    });
    it('ignores tags it does not recognise', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A', userId: 'u-1' }));
        const dispatch = principalCacheDispatcher(cache);
        await dispatch(envelope({ cacheInvalidationTags: ['Page:somepage', 'Catalog:taxonomies'] }));
        expect(cache.get('t-1', 'p-A')).toBeDefined();
    });
    it('is idempotent: running twice produces the same end state', async function () {
        const cache = new PrincipalCache();
        cache.set('t-1', 'p-A', principal({ principalId: 'p-A', userId: 'u-1' }));
        const dispatch = principalCacheDispatcher(cache);
        const env = envelope({ cacheInvalidationTags: ['User:u-1'] });
        await dispatch(env);
        await dispatch(env);
        expect(cache.get('t-1', 'p-A')).toBeUndefined();
    });
});
