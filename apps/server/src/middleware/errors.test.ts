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
import {
    TenantDatabaseNotProvisionedError,
    TenantNotFoundError,
} from '@atlas/adapter-node';
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

/**
 * F2 follow-up from the db-per-tenant slice (sibling of F3 above): the
 * provisioner-precondition `TenantNotFoundError` (from `@atlas/adapter-node`)
 * must surface as HTTP 404 with the canonical `TENANT_NOT_FOUND` code — not
 * as the catch-all `TRANSACTION_FAILED` / 500. See
 * `tickets/db-per-tenant-followups/tenant-not-found-http-mapping.md`.
 */
describe('mapError — TenantNotFoundError', function () {
    it('returns HTTP 404 with code=TENANT_NOT_FOUND', async function () {
        const err = new TenantNotFoundError('some-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        expect(res.status).toBe(404);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('passes the precondition message from the error through to the envelope', async function () {
        const err = new TenantNotFoundError('some-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        // The exact message is owned by `@atlas/adapter-node`; assert on
        // the load-bearing substrings (tenantId + the load-bearing "no row
        // in control_plane.tenants" phrasing the provisioner uses) rather
        // than pinning the full string.
        expect(body.error.message).toContain('some-tenant');
        expect(body.error.message).toContain('control_plane.tenants');
    });

    it('stamps the correlationId + a fresh supportId on the envelope', async function () {
        const err = new TenantNotFoundError('some-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.correlationId).toBe('corr-errors-test');
        expect(typeof body.error.supportId).toBe('string');
        expect(body.error.supportId.length).toBeGreaterThan(0);
    });

    it('still emits a structured server-side log under Tenancy.TenantNotFound', async function () {
        const err = new TenantNotFoundError('some-tenant');
        const { app, collector } = makeRig(err);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        const lines = eventsNamed(collector, 'Tenancy.TenantNotFound');
        expect(lines).toHaveLength(1);
        const e = assertDefined(lines[0], 'Tenancy.TenantNotFound log event present');
        expect(e.level).toBe('error');
        // The log line MUST carry the structured error (code + message)
        // so operators can join the user-facing supportId back to a root
        // cause without the client text leaking it.
        expect(e.error?.code).toBe('TENANT_NOT_FOUND');
        expect(e.error?.message).toContain('control_plane.tenants');
        // supportId pairs the log line with the user-facing envelope.
        expect(e.properties).toMatchObject({
            supportId: body.error.supportId,
            tenantId: 'some-tenant',
        });
    });

    it('does NOT collapse to TRANSACTION_FAILED / 500 (the regression this slice closes)', async function () {
        // Belt-and-braces against re-introducing the old behaviour: an
        // unmapped TenantNotFoundError would send this class down the
        // catch-all path and the client would get `TRANSACTION_FAILED` /
        // 500 / "Internal storage failure" — a misleading envelope for
        // what is in fact a missing tenant registry row.
        const err = new TenantNotFoundError('some-tenant');
        const { app } = makeRig(err);
        const res = await app.request('/boom');
        expect(res.status).not.toBe(500);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).not.toBe('TRANSACTION_FAILED');
        expect(body.error.code).not.toBe('UNMAPPED_ERROR');
        expect(body.error.message).not.toBe('Internal storage failure');
    });
});

/**
 * Wrapped-cause coverage for the two tenant-error branches. A handler that
 * wraps a tenant error for logging clarity — e.g.
 * `throw new Error('outer', { cause: tnfe })` — must still get the right
 * envelope. `mapError` calls `findCause` to look one level down the
 * `Error.cause` chain before falling through to the catch-all. See
 * `tickets/db-per-tenant-followups/wrapped-tenant-errors-unmapped.md`.
 */
describe('mapError — wrapped Error.cause (one-level unwrap)', function () {
    // Wrapper-text sentinel: chosen so the substring does NOT appear in
    // either inner error's message (which already mention "signup-approve",
    // "pnpm dev:up", etc.). Lets us assert the wrapper's text is discarded
    // without false positives from the inner message's natural content.
    const WRAPPER_SENTINEL = 'xx-outer-wrapper-context-xx';

    it('maps a TenantNotFoundError wrapped in `new Error(..., { cause })` to 404 / TENANT_NOT_FOUND', async function () {
        const inner = new TenantNotFoundError('some-tenant');
        const outer = new Error(WRAPPER_SENTINEL, { cause: inner });
        const { app } = makeRig(outer);
        const res = await app.request('/boom');
        expect(res.status).toBe(404);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).toBe('TENANT_NOT_FOUND');
        // The envelope MUST surface the INNER error's message, not the
        // wrapper's text — the operational signal is the tenant condition.
        expect(body.error.message).toContain('some-tenant');
        expect(body.error.message).toContain('control_plane.tenants');
        expect(body.error.message).not.toContain(WRAPPER_SENTINEL);
    });

    it('preserves the inner error code/message/tenantId in the server-side log for a wrapped TenantNotFoundError', async function () {
        const inner = new TenantNotFoundError('some-tenant');
        const outer = new Error(WRAPPER_SENTINEL, { cause: inner });
        const { app, collector } = makeRig(outer);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        const lines = eventsNamed(collector, 'Tenancy.TenantNotFound');
        expect(lines).toHaveLength(1);
        const e = assertDefined(lines[0], 'Tenancy.TenantNotFound log event present');
        // The log carries the INNER error's structured fields — wrapping
        // for context MUST NOT degrade the operational signal.
        expect(e.error?.code).toBe('TENANT_NOT_FOUND');
        expect(e.error?.message).toContain('control_plane.tenants');
        expect(e.error?.message).not.toContain(WRAPPER_SENTINEL);
        expect(e.properties).toMatchObject({
            supportId: body.error.supportId,
            tenantId: 'some-tenant',
        });
    });

    it('maps a TenantDatabaseNotProvisionedError wrapped in `new Error(..., { cause })` to 503 / TENANT_DATABASE_NOT_PROVISIONED', async function () {
        const inner = new TenantDatabaseNotProvisionedError('dev-tenant');
        const outer = new Error(WRAPPER_SENTINEL, { cause: inner });
        const { app } = makeRig(outer);
        const res = await app.request('/boom');
        expect(res.status).toBe(503);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).toBe('TENANT_DATABASE_NOT_PROVISIONED');
        // The envelope MUST surface the INNER error's remediation message,
        // not the wrapper's text.
        expect(body.error.message).toContain('dev-tenant');
        expect(body.error.message).toContain('per-tenant database not provisioned');
        expect(body.error.message).toContain('pnpm dev:up');
        expect(body.error.message).not.toContain(WRAPPER_SENTINEL);
    });

    it('preserves the inner error code/message/tenantId in the server-side log for a wrapped TenantDatabaseNotProvisionedError', async function () {
        const inner = new TenantDatabaseNotProvisionedError('dev-tenant');
        const outer = new Error(WRAPPER_SENTINEL, { cause: inner });
        const { app, collector } = makeRig(outer);
        const res = await app.request('/boom');
        const body = (await res.json()) as EnvelopeBody;
        const lines = eventsNamed(collector, 'Tenancy.DatabaseNotProvisioned');
        expect(lines).toHaveLength(1);
        const e = assertDefined(lines[0], 'Tenancy.DatabaseNotProvisioned log event present');
        expect(e.error?.code).toBe('TENANT_DATABASE_NOT_PROVISIONED');
        expect(e.error?.message).toContain('per-tenant database not provisioned');
        expect(e.error?.message).not.toContain(WRAPPER_SENTINEL);
        expect(e.properties).toMatchObject({
            supportId: body.error.supportId,
            tenantId: 'dev-tenant',
        });
    });

    it('does NOT unwrap a generic wrapper whose `cause` is unrelated — falls through to TRANSACTION_FAILED / 500', async function () {
        // Negative case: only the two tenant-error classes are unwrapped.
        // A wrapper whose cause is some other Error (or undefined) MUST
        // hit the catch-all so we never silently re-interpret arbitrary
        // chained errors as tenant conditions.
        const outer = new Error('something else', { cause: new Error('plain inner') });
        const { app } = makeRig(outer);
        const res = await app.request('/boom');
        expect(res.status).toBe(500);
        const body = (await res.json()) as EnvelopeBody;
        expect(body.error.code).toBe('TRANSACTION_FAILED');
        expect(body.error.message).toBe('Internal storage failure');
    });
});
