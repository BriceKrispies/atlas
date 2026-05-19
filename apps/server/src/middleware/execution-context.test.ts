/**
 * Wiring tests for the execution-context middleware + per-request ctx.
 *
 * Asserts:
 *   - executionContextMiddleware builds a ctx with a correlationId
 *   - inbound X-Correlation-Id is preserved
 *   - missing inbound is generated
 *   - response carries X-Correlation-Id
 *   - ctx is anonymous-principal until principal middleware upgrades it
 *   - ctx.tenantId defaults to config.tenantId pre-auth
 *   - logs from ctx.logger include the request's correlationId
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { CollectorSink, InMemoryLevelController, LogPipeline, } from '@atlas/logging';
import type { LogEvent } from '@atlas/logging';
import { executionContextMiddleware } from './execution-context.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from './principal.ts';
interface TestRig {
    app: Hono<{
        Variables: ServerVariables;
    }>;
    collector: CollectorSink;
    pipeline: LogPipeline;
}
/**
 * Filter collector to user-emitted events (skip boundary events like
 * Request.Received / Request.Completed that the middleware itself emits).
 * Existing assertions count user log lines only.
 */
function testEvents(collector: CollectorSink): LogEvent[] {
    return collector.events.filter(function (e) {
        return e.eventName?.startsWith('Test.');
    });
}
function boundaryEvents(collector: CollectorSink): LogEvent[] {
    return collector.events.filter(function (e) {
        return e.eventName === 'Request.Received' || e.eventName === 'Request.Completed';
    });
}
/** First test event — invariant-asserted, so callers can read fields. */
function firstTestEvent(collector: CollectorSink): LogEvent {
    return assertDefined(testEvents(collector)[0], 'expected at least one Test.* event in collector');
}
function makeRig(): TestRig {
    const collector = new CollectorSink();
    const pipeline = new LogPipeline([collector], new InMemoryLevelController('debug'));
    // The middleware reads only logPipeline + config from AppState. Building
    // a full AppState here would pull in Postgres pools / JWKS / adapters
    // that aren't relevant to this wiring test. Suppress the boundary cast
    // once at the construction site.
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: middleware reads only logPipeline + config; full AppState wiring is out-of-scope for this unit test
    const state = {
        logPipeline: pipeline,
        config: { tenantId: 'dev-tenant', environment: 'test' },
    } as unknown as AppState;
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.use('*', executionContextMiddleware(state));
    return { app, collector, pipeline };
}
describe('executionContextMiddleware', function () {
    it('builds a ctx with mint-fresh correlationId when no header inbound', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            const ctx = c.get('ctx');
            ctx.logger.info('probe received', { event: 'Test.Probe' });
            return c.text('ok');
        });
        const res = await app.request('/probe');
        expect(res.status).toBe(200);
        expect(testEvents(collector)).toHaveLength(1);
        const e = firstTestEvent(collector);
        expect(e.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        // Response carries it back.
        expect(res.headers.get('x-correlation-id')).toBe(e.correlationId);
    });
    it('preserves a valid inbound X-Correlation-Id', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            c.get('ctx').logger.info('probe', { event: 'Test.Probe' });
            return c.text('ok');
        });
        const res = await app.request('/probe', {
            headers: { 'X-Correlation-Id': 'corr-fixed-1' },
        });
        expect(res.status).toBe(200);
        expect(firstTestEvent(collector).correlationId).toBe('corr-fixed-1');
        expect(res.headers.get('x-correlation-id')).toBe('corr-fixed-1');
    });
    it('rejects malformed inbound id and mints a fresh one', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            c.get('ctx').logger.info('probe', { event: 'Test.Probe' });
            return c.text('ok');
        });
        // The existing correlationIdFor accepts any non-empty string. The
        // sanitization happens inside createRootContext via
        // sanitizeIncomingCorrelationId. Embedded newlines would never be
        // sent via real HTTP (HTTP/1.1 strips control chars), but the
        // sanitizer is the belt-and-suspenders layer — verify it.
        const res = await app.request('/probe', {
            headers: { 'X-Correlation-Id': 'has spaces and bad chars!@#' },
        });
        expect(res.status).toBe(200);
        // Bad chars → sanitizer rejects → fresh UUID minted.
        const id = firstTestEvent(collector).correlationId;
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
    it('ctx is anonymous-principal pre-auth, with default tenant', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
            return c.text('ok');
        });
        await app.request('/probe');
        const e = firstTestEvent(collector);
        expect(e.principalId).toBe('anonymous');
        expect(e.tenantId).toBe('dev-tenant');
    });
    it('multiple log lines from the same request share the same correlationId', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            const ctx = c.get('ctx');
            ctx.logger.info('one', { event: 'Test.One' });
            // `cause` is caller-supplied data — it belongs under `properties`,
            // not at top level (only the LogFields reserved keys are valid there).
            ctx.logger.warn('two', {
                event: 'Test.Two',
                properties: { cause: 'just a warn' },
            });
            ctx.logger.error('three', {
                event: 'Test.Three',
                error: { code: 'X', message: 'y' },
            });
            return c.text('ok');
        });
        await app.request('/probe', { headers: { 'X-Correlation-Id': 'fixed' } });
        expect(testEvents(collector).length).toBe(3);
        for (const e of testEvents(collector)) {
            expect(e.correlationId).toBe('fixed');
        }
    });
    it('different requests get different correlationIds', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
            return c.text('ok');
        });
        await app.request('/probe');
        await app.request('/probe');
        expect(testEvents(collector)).toHaveLength(2);
        const ids = testEvents(collector).map(function (e: LogEvent) {
            return e.correlationId;
        });
        expect(new Set(ids).size).toBe(2);
    });
    it('every emitted event carries a fresh requestId per request', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
            return c.text('ok');
        });
        await app.request('/probe');
        await app.request('/probe');
        const requestIds = testEvents(collector).map(function (e) {
            return e.requestId;
        }).filter(Boolean);
        expect(requestIds).toHaveLength(2);
        expect(new Set(requestIds).size).toBe(2);
    });
    it('emits Request.Received and Request.Completed boundary events', async function () {
        const { app, collector } = makeRig();
        app.get('/probe', function (c) {
            return c.text('ok');
        });
        const res = await app.request('/probe', {
            headers: { 'X-Correlation-Id': 'corr-boundary' },
        });
        expect(res.status).toBe(200);
        const boundary = boundaryEvents(collector);
        expect(boundary.map(function (e) {
            return e.eventName;
        })).toEqual([
            'Request.Received',
            'Request.Completed',
        ]);
        for (const e of boundary) {
            expect(e.correlationId).toBe('corr-boundary');
        }
        const completed = assertDefined(boundary[1], 'expected Request.Completed boundary event at index 1');
        expect(completed.properties).toMatchObject({
            method: 'GET',
            path: '/probe',
            status: 200,
        });
        expect(typeof completed.durationMs).toBe('number');
    });
});
