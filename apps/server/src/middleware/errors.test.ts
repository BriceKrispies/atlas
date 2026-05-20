/**
 * Tests for `apps/server/src/middleware/errors.ts` — focused on the error
 * envelope wiring at the HTTP boundary. The handler-side error taxonomy
 * lives in `specs/error_taxonomy.json` and is exercised end-to-end by the
 * routes that throw module/adapter errors; this file pins the few mappings
 * that have first-class branches in `mapError` so a regression flips a
 * deterministic assertion (rather than silently collapsing to a generic
 * 500).
 *
 * F3 follow-up from the db-per-tenant slice: the connection-seam
 * `TenantDatabaseNotProvisionedError` (from `@atlas/adapter-node`) must
 * surface as HTTP 503 with the original `code` and remediation `message`
 * — not as the catch-all `TRANSACTION_FAILED` / 500. See
 * `tickets/db-per-tenant-followups/error-envelope-mapping.md`.
 */
import { describe, it, expect } from '@atlas/test';
import { Hono } from 'hono';
import { TenantDatabaseNotProvisionedError } from '@atlas/adapter-node';
import {
    CollectorSink,
    InMemoryLevelController,
    LogPipeline,
    createRootContext,
} from '@atlas/logging';
import type { LogEvent } from '@atlas/logging';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { mapError } from './errors.ts';
import type { ServerVariables } from './principal.ts';

interface EnvelopeBody {
    error: {
        code: string;
        message: string;
        correlationId: string;
        supportId: string;
    };
}

interface Rig {
    app: Hono<{ Variables: ServerVariables }>;
    collector: CollectorSink;
}

function makeRig(thrown: unknown): Rig {
    const collector = new CollectorSink();
    const pipeline = new LogPipeline([collector], new InMemoryLevelController('debug'));
    const ctx = createRootContext({
        pipeline,
        tenantId: 'dev-tenant',
        principalId: 'tester',
        environment: 'test',
        incomingCorrelationId: 'corr-errors-test',
    });
    const app = new Hono<{ Variables: ServerVariables }>();
    app.use('*', async function (c, next) {
        c.set('ctx', ctx);
        await next();
    });
    app.get('/boom', function (c) {
        try {
            throw thrown;
        }
        catch (e) {
            return mapError(c, e, 'corr-errors-test');
        }
    });
    return { app, collector };
}

function eventsNamed(c: CollectorSink, name: string): LogEvent[] {
    return c.events.filter(function (e) {
        return e.eventName === name;
    });
}

describe('mapError — TenantDatabaseNotProvisionedError', function () {
    it('returns HTTP 503 with code=TENANT_DATABASE_NOT_PROVISIONED', async function () {
        const err = new TenantDatabaseNotProvisionedError('dev-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        expect(res.status).toBe(503);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).toBe('TENANT_DATABASE_NOT_PROVISIONED');
    });

    it('passes the remediation message from the error through to the envelope', async function () {
        const err = new TenantDatabaseNotProvisionedError('dev-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        // The exact message is owned by `@atlas/adapter-node`; assert on the
        // load-bearing substrings (dev + prod remediation pointers + ADR
        // ref) rather than pinning the full string, so message wording
        // tweaks don't break the boundary contract.
        expect(body.error.message).toContain('dev-tenant');
        expect(body.error.message).toContain('per-tenant database not provisioned');
        expect(body.error.message).toContain('pnpm dev:up');
        expect(body.error.message).toContain('ADR 0005');
    });

    it('stamps the correlationId + a fresh supportId on the envelope', async function () {
        const err = new TenantDatabaseNotProvisionedError('dev-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.correlationId).toBe('corr-errors-test');
        expect(typeof body.error.supportId).toBe('string');
        expect(body.error.supportId.length).toBeGreaterThan(0);
    });

    it('still emits a structured server-side log under Tenancy.DatabaseNotProvisioned', async function () {
        const err = new TenantDatabaseNotProvisionedError('dev-tenant');
        const { app, collector } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        const lines = eventsNamed(collector, 'Tenancy.DatabaseNotProvisioned');
        expect(lines).toHaveLength(1);
        const e = assertDefined(lines[0], 'Tenancy.DatabaseNotProvisioned log event present');
        expect(e.level).toBe('error');
        // The log line MUST carry the structured error (code + remediation
        // message) so operators can join the user-facing supportId back to
        // a root cause without the client text leaking it.
        expect(e.error?.code).toBe('TENANT_DATABASE_NOT_PROVISIONED');
        expect(e.error?.message).toContain('per-tenant database not provisioned');
        // supportId pairs the log line with the user-facing envelope.
        expect(e.properties).toMatchObject({
            supportId: body.error.supportId,
            tenantId: 'dev-tenant',
        });
    });

    it('does NOT collapse to TRANSACTION_FAILED / 500 (the regression this slice closes)', async function () {
        // Belt-and-braces against re-introducing the old behaviour: the
        // pre-F3 mapper sent this class down the catch-all path and the
        // client got `TRANSACTION_FAILED` / 500 / "Internal storage
        // failure" — a misleading envelope for what is in fact config
        // drift on the tenant row.
        const err = new TenantDatabaseNotProvisionedError('dev-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        expect(res.status).not.toBe(500);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).not.toBe('TRANSACTION_FAILED');
        expect(body.error.code).not.toBe('UNMAPPED_ERROR');
        expect(body.error.message).not.toBe('Internal storage failure');
    });
});
