/**
 * Unit tests for `emitNotificationsForA7Event` (the dispatcher
 * surface for `Authorization.Impersonation*` and
 * `Authorization.BreakGlass*` source events).
 *
 * Scope: cache-tag (I10) + idempotency-key shape coverage on the
 * notification follow-up emit-sites. Channel-default + payload-secrecy
 * branches are owned by `test/a7-notifications.test.ts`; this file is
 * focused on the I10 contract and is the unit test the SDET pass
 * flagged as missing.
 */
import { describe, it, expect } from '@atlas/test';
import type { EventEnvelope } from '@atlas/platform-core';
import { emitNotificationsForA7Event, IMPERSONATION_RETENTION_TAG, } from '../../src/index.ts';
import { assertEventTags, newFixture } from '../lib/fixtures.ts';
function impersonationStartedEvent(tenantId: string): EventEnvelope {
    return {
        eventId: 'evt-imp-start-1',
        eventType: 'Authorization.ImpersonationStarted',
        schemaId: 'domain.authorization.impersonation_started.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-01T00:00:00Z',
        tenantId,
        correlationId: 'corr-1',
        idempotencyKey: 'authz.impersonation.start.x',
        causationId: null,
        principalId: 'ops:bob',
        userId: 'usr-alice',
        retentionTag: IMPERSONATION_RETENTION_TAG,
        cacheInvalidationTags: [
            `Tenant:${tenantId}`,
            'User:usr-alice',
            'Impersonation:imp-1',
        ],
        payload: {
            impersonationId: 'imp-1',
            operatorId: 'ops:bob',
            targetUserId: 'usr-alice',
            reason: 'SUP-1234',
            ticketUrl: 'https://example.com/SUP-1234',
        },
    };
}
describe('emitNotificationsForA7Event — cache-tag invariant (I10)', function () {
    it('every Notifications.* follow-up carries Tenant:<tenantId>', async function () {
        const fx = newFixture();
        const source = impersonationStartedEvent(fx.tenantId);
        const followups = await emitNotificationsForA7Event(source, fx.events);
        expect(followups.length).toBeGreaterThan(0);
        for (const f of followups) {
            assertEventTags(f, [`Tenant:${fx.tenantId}`]);
        }
    });
    it('idempotency key is deterministic (notif.<sourceEventId>.<channel>) so dispatcher replays dedupe', async function () {
        const fx = newFixture();
        const source = impersonationStartedEvent(fx.tenantId);
        const first = await emitNotificationsForA7Event(source, fx.events);
        expect(first).toHaveLength(2);
        const keys = first.map(function (e) {
            return e.idempotencyKey;
        }).sort();
        expect(keys).toEqual([
            `notif.${source.eventId}.tenant_admin`,
            `notif.${source.eventId}.ops_pager`,
        ].sort());
        // Replaying produces the same key shape; with the InMemoryEventStore
        // semantics in fixtures.ts (no idempotency-dedup on append) we just
        // assert the keys remain stable.
        const second = await emitNotificationsForA7Event(source, fx.events);
        const secondKeys = second.map(function (e) {
            return e.idempotencyKey;
        }).sort();
        expect(secondKeys).toEqual(keys);
    });
});
