/**
 * Integration test: full intent flow + correlated debug log trace.
 *
 * Submits a real ContentPages.Page.Create intent through the running
 * apps/server, then verifies that the in-memory ring sink captured every
 * expected boundary event for the request's correlationId. Mirrors the
 * standalone smoke driver (`scripts/e2e-smoke.ts`) but runs as a
 * Playwright integration test for CI gates.
 *
 * Pre-requisites (all checked in `beforeAll`):
 *   - apps/server reachable at `INGRESS_BASE_URL` (default
 *     http://localhost:3000), running with TEST_AUTH_ENABLED=true
 *   - control-plane DB reachable at `CONTROL_PLANE_DB_URL` so the
 *     test can ensure `dev-tenant` exists
 *   - server log level at `debug` (or smoke explicitly bumps it). The
 *     test bumps the global level via `POST /api/v1/admin/logging/levels/global`
 *     so it works regardless of how the server was started.
 *
 * Skipped silently when `apps/server` isn't reachable, matching the
 * existing `*.itest.ts` pattern (see `public-signup.itest.ts:138-160`,
 * `custom-domains.itest.ts:36-46`).
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { fetchTrace, assertContainsEvents, assertAllCorrelated, } from './helpers/log-trace.ts';
const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const CP_URL = process.env['CONTROL_PLANE_DB_URL'];
const TENANT_ID = 'dev-tenant';
const ADMIN_PRINCIPAL = `user:tester:${TENANT_ID}:admin`;
const REQUIRED_EVENTS = [
    'Request.Received',
    'Authn.Resolved',
    'Intent.Submitted',
    'Intent.Accepted',
    'Request.Completed',
];
test.describe('intent submission emits a correlated debug log trace', function () {
    let sql: postgres.Sql | null = null;
    test.beforeAll(async function () {
        if (!CP_URL) {
            test.skip(true, 'CONTROL_PLANE_DB_URL not set');
            return;
        }
        try {
            const ping = await fetch(`${INGRESS}/healthz`);
            if (!ping.ok) {
                test.skip(true, `apps/server at ${INGRESS} not healthy`);
                return;
            }
        }
        catch {
            test.skip(true, `apps/server at ${INGRESS} not reachable`);
            return;
        }
        sql = postgres(CP_URL, { max: 2 });
        await sql `
      INSERT INTO control_plane.tenants (tenant_id, name)
      VALUES (${TENANT_ID}, 'Smoke Dev')
      ON CONFLICT (tenant_id) DO NOTHING
    `;
        // Bump the global log level so debug-level boundary events are
        // captured regardless of how the server was started.
        const bump = await fetch(`${INGRESS}/api/v1/admin/logging/levels/global`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Debug-Principal': ADMIN_PRINCIPAL,
            },
            body: JSON.stringify({ level: 'debug' }),
        });
        if (!bump.ok) {
            test.skip(true, `could not bump server log level to debug: ${bump.status}`);
        }
    });
    test.afterAll(async function () {
        if (sql)
            await sql.end({ timeout: 5 });
    });
    test('full pipeline produces all required boundary events with one correlationId', async function () {
        const correlationId = randomUUID();
        const pageId = `intent-itest-${Date.now().toString(36)}`;
        const envelope = {
            eventId: randomUUID(),
            eventType: 'ContentPages.PageCreated',
            schemaId: 'content_pages.page.create.v1',
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            tenantId: TENANT_ID,
            correlationId,
            idempotencyKey: randomUUID(),
            payload: {
                actionId: 'ContentPages.Page.Create',
                resourceType: 'Page',
                pageId,
                title: 'Intent ITest Page',
                slug: pageId,
            },
        };
        const submit = await fetch(`${INGRESS}/api/v1/intents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId,
                'X-Debug-Principal': ADMIN_PRINCIPAL,
            },
            body: JSON.stringify(envelope),
        });
        expect(submit.status).toBe(202);
        const trace = await fetchTrace(INGRESS, correlationId, {
            principal: ADMIN_PRINCIPAL,
        });
        expect(trace.length).toBeGreaterThanOrEqual(REQUIRED_EVENTS.length);
        assertAllCorrelated(trace, correlationId);
        assertContainsEvents(trace, REQUIRED_EVENTS);
        // Specific shape checks on the canonical events — surfaces
        // regressions where someone changes a field name without realising
        // the trace contract is now load-bearing for incident response.
        const submitted = trace.find(function (r) {
            return r.eventName === 'Intent.Submitted';
        });
        expect(submitted?.properties).toMatchObject({
            actionId: 'ContentPages.Page.Create',
            eventType: 'ContentPages.PageCreated',
        });
        const accepted = trace.find(function (r) {
            return r.eventName === 'Intent.Accepted';
        });
        expect(accepted?.properties).toHaveProperty('eventId');
        const completed = trace.find(function (r) {
            return r.eventName === 'Request.Completed';
        });
        expect(completed?.properties).toMatchObject({
            method: 'POST',
            path: '/api/v1/intents',
            status: 202,
        });
        expect(typeof completed?.durationMs).toBe('number');
        // At least one Dispatcher.Ran fired (in-band) — proves the
        // dispatcher chain ran for this event. We don't pin a specific count
        // because the chain set varies by build (policy-cache wires only
        // when cedar engine is bound).
        const dispatched = trace.filter(function (r) {
            return r.eventName === 'Dispatcher.Ran';
        });
        expect(dispatched.length).toBeGreaterThan(0);
        // Side-effect check — the page is reachable, proving the
        // dispatcher chain rebuilt the projection (not just dispatched the
        // event). 200 here means the cache-tag dispatcher invalidated stale
        // entries AND the projection write landed.
        const get = await fetch(`${INGRESS}/api/v1/pages/${encodeURIComponent(pageId)}`, {
            headers: { 'X-Debug-Principal': ADMIN_PRINCIPAL },
        });
        expect(get.status).toBe(200);
        const body = (await get.json()) as {
            title?: string;
        };
        expect(body.title).toBe('Intent ITest Page');
    });
});
